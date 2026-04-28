/**
 * Honoka Token Budget - Content script for Notion pages
 *
 * - Auto-analyzes when Notion page loads
 * - Live-refreshes when content changes (MutationObserver)
 * - Auto-detects best estimation method based on content profile
 * - Uses Anthropic's official Claude BPE tokenizer for exact counts
 */

import { Tiktoken } from "js-tiktoken/lite";
import claudeRanks from "./claude.json";
import {
  analyzePageViaAPI,
  loadPageChunk,
  getSnapshotsList,
  getPageDiscussions,
  getActivityLog,
  loadFullPage,
  extractCollectionSchema,
  extractPageMeta,
  extractPageProperties as extractAPIProperties,
  getRecordValues,
  getCurrentUser,
} from "./notion-api.js";

let claudeEncoder = null;
try {
  claudeEncoder = new Tiktoken(claudeRanks);
  claudeEncoder.encode("init");
} catch (e) {
  console.warn("Honoka: Claude BPE tokenizer failed to init, using heuristics", e);
  claudeEncoder = null;
}

const ESTIMATION_METHODS = {
  "claude": {
    name: "Claude BPE (exact)",
    description: "Anthropic's official tokenizer. Exact token count matching Claude / Opus models.",
    estimate: (text) => {
      if (!claudeEncoder) return Math.ceil(text.trim().length / 4);
      return claudeEncoder.encode(text.trim()).length;
    },
  },
  "chars/4": {
    name: "Character ÷ 4",
    description: "~4 characters per token. Fast heuristic, reasonable for English text.",
    estimate: (text) => Math.ceil(text.trim().length / 4),
  },
  "words*1.3": {
    name: "Words × 1.3",
    description: "~1.3 tokens per word. Better for mixed text and code.",
    estimate: (text) => Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.3),
  },
  "chars/3": {
    name: "Character ÷ 3",
    description: "~3 characters per token. Conservative estimate, use for CJK-heavy docs.",
    estimate: (text) => Math.ceil(text.trim().length / 3),
  },
  "code": {
    name: "Code-weighted",
    description: "~3.5 chars/token. Code and diagram DSLs have more symbols than regular text.",
    estimate: (text) => Math.ceil(text.trim().length / 3.5),
  },
};

let currentMethod = claudeEncoder ? "claude" : "chars/4";
let methodOverride = null;
let currentBudget = 24000;
let observer = null;
let refreshTimer = null;
let overlayExpanded = false;

// ── Page UUID extraction ────────────────────────────────────────────

function getNotionPageId() {
  // Peek mode: UUID in query param ?p=<uuid> or &p=<uuid>
  const params = new URLSearchParams(window.location.search);
  const peekId = params.get("p");
  if (peekId && /^[a-f0-9]{32}$/.test(peekId)) return peekId;
  if (peekId && /^[a-f0-9-]{36}$/.test(peekId)) return peekId.replace(/-/g, "");

  // Normal page: UUID at end of pathname
  const path = window.location.pathname;
  const match = path.match(/([a-f0-9]{32})(?:[?#]|$)/);
  if (match) return match[1];
  const match2 = path.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
  return match2 ? match2[1].replace(/-/g, "") : null;
}

function isUsableTitle(t) {
  if (!t || t === "Untitled") return false;
  // Reject if the entire string is just emoji/symbols (no letters or CJK)
  const stripped = t.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\u200d\ufe0f]/gu, "");
  return stripped.length > 0;
}

function getNotionPageTitle() {
  const selectors = [
    '[placeholder="Untitled"]',
    "h1.notranslate",
    '[data-block-id] h1',
    ".notion-selectable.notion-page-block",
    ".notion-page-block",
    '[contenteditable="true"][data-root="true"]',
    ".notion-page-block .notranslate",
  ];

  function extractFrom(root) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (!el) continue;
      const t = (el.textContent || "").trim();
      if (isUsableTitle(t)) return t;
    }
    return null;
  }

  // Peek mode: scope selectors inside the modal
  const peek = document.querySelector(".notion-peek-renderer");
  if (peek) {
    const t = extractFrom(peek);
    if (t) return t;
  }

  // Normal page
  const t = extractFrom(document);
  if (t) return t;

  // Fallback 1: document.title (strip " | Notion" / " – Notion" suffix)
  const titleMatch = document.title.match(/^(.+?)(?:\s*[|–—]\s*Notion)?$/);
  const docTitle = titleMatch ? titleMatch[1].trim() : document.title;
  if (isUsableTitle(docTitle)) return docTitle;

  // Fallback 2: extract readable title from Notion URL slug
  const urlTitle = extractTitleFromUrl();
  if (urlTitle) return urlTitle;

  return null;
}

function extractTitleFromUrl() {
  const url = decodeURIComponent(window.location.href);
  // Notion URLs: notion.so/workspace/Page-Title-UUID or notion.so/Page-Title-UUID
  // Use [^/]+ to capture any characters (including CJK) before the 32-char hex ID
  const match = url.match(/notion\.so\/(?:[^/]+\/)?(.+)-[a-f0-9]{32}(?:\?|$)/);
  if (match) {
    return match[1].replace(/-/g, " ").trim();
  }
  return null;
}

function extractPageProperties() {
  const props = {};
  const peek = document.querySelector(".notion-peek-renderer");
  const scope = peek || document;

  // Strategy 1: Notion's known property container classes
  const selectorSets = [
    '.notion-collection-page-properties .notion-collection-property',
    '[class*="property-row"]',
    '[class*="collection_page_properties"] [class*="property"]',
    '[class*="page-properties"] [class*="row"]',
    '[class*="page_properties"] [class*="row"]',
  ];

  for (const sel of selectorSets) {
    const rows = scope.querySelectorAll(sel);
    rows.forEach((row) => {
      const pair = extractPairFromRow(row);
      if (pair) props[pair[0]] = pair[1];
    });
    if (Object.keys(props).length > 0) break;
  }

  // Strategy 2: Structural scan — find the area between title and first
  // content block, then look for rows with a short label + value.
  // Notion property rows use a consistent layout: a narrow left column
  // (icon + name, typically 140-160px wide) and a flexible right column.
  if (Object.keys(props).length === 0) {
    const contentStart = scope.querySelector('[data-block-id]');
    if (contentStart) {
      let propArea = contentStart.previousElementSibling;
      const candidates = [];
      while (propArea) {
        candidates.push(propArea);
        propArea = propArea.previousElementSibling;
      }
      for (const area of candidates) {
        // Each child of the property area is typically a row
        const rowEls = area.querySelectorAll(":scope > div");
        if (rowEls.length === 0) continue;
        rowEls.forEach((row) => {
          const pair = extractPairFromRow(row);
          if (pair) props[pair[0]] = pair[1];
        });
      }
    }
  }

  // Strategy 3: Scan all divs that look like property rows by structure.
  // A Notion property row typically has exactly 2 direct child divs:
  // [label div (short text)] [value div (content)]
  if (Object.keys(props).length === 0) {
    const pageContent = scope.querySelector('.notion-page-content') ||
                        scope.querySelector('.notion-scroller');
    if (pageContent) {
      const allDivs = pageContent.querySelectorAll(':scope > div > div > div');
      allDivs.forEach((row) => {
        const pair = extractPairFromRow(row);
        if (pair) props[pair[0]] = pair[1];
      });
    }
  }

  return Object.keys(props).length > 0 ? props : null;
}

const KNOWN_PROP_NAMES = new Set([
  "status", "type", "tag", "tags", "priority", "reviewer", "reviewers",
  "member", "members", "assignee", "assignees", "owner", "author",
  "created", "created by", "created time", "last edited", "last edited by",
  "last edited time", "due", "due date", "date", "sprint", "team",
  "category", "label", "labels", "project", "epic", "component",
  "description", "summary", "notes", "url", "link", "email", "phone",
  "company", "department", "role", "stage", "phase", "version",
]);

function extractPairFromRow(row) {
  const children = row.children;
  if (children.length < 2) return null;

  // Try first two children as name/value
  const nameEl = children[0];
  const valueEl = children[1];
  const name = (nameEl.textContent || "").trim();
  const value = (valueEl.textContent || "").trim();

  if (!name || !value) return null;
  if (name.length > 50 || name.length < 1) return null;
  // Skip if "name" looks like a paragraph (too many words)
  if (name.split(/\s+/).length > 5) return null;
  // Skip if value is extremely long (likely body content, not a property)
  if (value.length > 500) return null;

  // Accept if name matches known property names, or if the row has
  // a structure consistent with Notion properties (short label + value)
  const nameLower = name.toLowerCase();
  if (KNOWN_PROP_NAMES.has(nameLower) || name.split(/\s+/).length <= 3) {
    return [name, value];
  }
  return null;
}

function _splitKeyForPage(pageId) { return `honoka_page_${pageId}`; }

// Storage writes are delegated to the background service worker via message
// passing. The background serializes all get→set operations through a Promise
// queue, preventing the race condition where concurrent tabs overwrite each
// other's honoka_global_index updates.
function savePageEntry(pageId, title, totalTokens, properties, extras) {
  chrome.runtime.sendMessage({
    action: "upsertPageEntry",
    pageId,
    title,
    url: window.location.href,
    tokenSnapshot: totalTokens,
    properties: properties || null,
    extras: extras || null,
  });
}

function logPageVisit(totalTokens, extras) {
  const pageId = getNotionPageId();
  if (!pageId) return;
  const title = getNotionPageTitle();
  const properties = extractPageProperties();

  try {
    savePageEntry(pageId, title, totalTokens, properties, extras);
    fetchAndStorePageMeta(pageId);
    detectAndStoreCurrentUser();

    if (!title || title === "Untitled") {
      // Retry: DOM re-read after 2s (Notion may still be rendering)
      setTimeout(() => {
        const retryTitle = getNotionPageTitle();
        const retryProps = extractPageProperties();
        if (retryTitle && retryTitle !== "Untitled") {
          patchPageTitle(pageId, retryTitle, retryProps);
        } else {
          // Fallback: Chrome browsing history
          chrome.runtime.sendMessage(
            { action: "getTitleFromHistory", url: window.location.href, pageId },
            (resp) => {
              if (chrome.runtime.lastError) return;
              if (resp?.title) patchPageTitle(pageId, resp.title, null);
            }
          );
        }
      }, 2000);
    }
  } catch (_) {}
}

let _currentUserDetected = false;
async function detectAndStoreCurrentUser() {
  if (_currentUserDetected) return;
  _currentUserDetected = true;
  try {
    const stored = await new Promise((r) =>
      chrome.storage.local.get({ honoka_notion_user: null }, r)
    );
    if (stored.honoka_notion_user?.id) return;
    const user = await getCurrentUser();
    if (user?.id) {
      chrome.storage.local.set({ honoka_notion_user: user });
    }
  } catch {}
}

async function fetchAndStorePageMeta(pageId) {
  try {
    const data = await loadPageChunk(pageId, { limit: 30 });
    const rm = data.recordMap || {};
    const blockMap = rm.block || {};
    const users = rm.notion_user || {};
    const collections = rm.collection || {};
    const pageBlock = blockMap[pageId]?.value || blockMap[formatPageId(pageId)]?.value;
    if (!pageBlock) return;

    const meta = {
      created_time: pageBlock.created_time,
      last_edited_time: pageBlock.last_edited_time,
    };
    if (pageBlock.created_by_id) meta.created_by_id = pageBlock.created_by_id;
    if (pageBlock.last_edited_by_id) meta.last_edited_by_id = pageBlock.last_edited_by_id;

    const missingUserIds = [];
    if (pageBlock.created_by_id && users[pageBlock.created_by_id]?.value) {
      meta.created_by = users[pageBlock.created_by_id].value.name;
    } else if (pageBlock.created_by_id) {
      missingUserIds.push(pageBlock.created_by_id);
    }
    if (pageBlock.last_edited_by_id && users[pageBlock.last_edited_by_id]?.value) {
      meta.last_edited_by = users[pageBlock.last_edited_by_id].value.name;
    } else if (pageBlock.last_edited_by_id) {
      missingUserIds.push(pageBlock.last_edited_by_id);
    }
    if (missingUserIds.length > 0) {
      try {
        const userRecords = await getRecordValues(
          [...new Set(missingUserIds)].map((id) => ({ table: "notion_user", id }))
        );
        const fetched = userRecords?.results || [];
        fetched.forEach((r) => {
          if (!r?.value) return;
          if (r.value.id === pageBlock.created_by_id && !meta.created_by) {
            meta.created_by = r.value.name;
          }
          if (r.value.id === pageBlock.last_edited_by_id && !meta.last_edited_by) {
            meta.last_edited_by = r.value.name;
          }
        });
      } catch {}
    }

    let apiProps = null;
    if (pageBlock.parent_table === "collection" && pageBlock.parent_id) {
      const collectionRecord = collections[pageBlock.parent_id];
      const schema = collectionRecord?.value?.schema;
      if (schema) {
        apiProps = extractAPIProperties(pageBlock, schema, users);
      }
    }

    // Delegate storage write to background (serialized queue)
    chrome.runtime.sendMessage({
      action: "patchPageMeta",
      pageId,
      meta,
      apiProperties: apiProps && Object.keys(apiProps).length > 0 ? apiProps : null,
    });
  } catch (err) {
    console.warn("Honoka: API metadata fetch failed:", err.message);
  }
}

function formatPageId(raw) {
  const hex = raw.replace(/-/g, "");
  if (hex.length !== 32) return raw;
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function patchPageTitle(pageId, title, properties) {
  chrome.runtime.sendMessage({
    action: "patchPageTitle",
    pageId,
    title,
    properties: properties || null,
  });
}

// Token overhead per media type when doc is exported as .md and fed to AI.
const TOKENS_PER_IMAGE = 50;       // ![alt text](https://notion-url...) ≈ 40-60 tokens
const TOKENS_PER_TABLE_ROW = 15;   // markdown table row with pipes and alignment
const TOKENS_PER_SVG_INLINE = 800; // inline SVG averages 800-2000+ tokens of path data
const TOKENS_PER_DRAWIO_XML = 2000; // draw.io XML is extremely verbose

// ── Token estimation ────────────────────────────────────────────────

function estimateTokens(text) {
  if (!text || typeof text !== "string") return 0;
  return ESTIMATION_METHODS[currentMethod].estimate(text);
}

function getEstimationInfo() {
  const m = ESTIMATION_METHODS[currentMethod];
  return {
    id: currentMethod,
    name: m.name,
    description: m.description,
    autoDetected: !methodOverride,
  };
}

// ── Content profiling & auto-detection ──────────────────────────────

function profileContent(container) {
  const allText = (container.innerText || container.textContent || "").trim();
  if (!allText) return { cjkRatio: 0, codeRatio: 0, tableCount: 0, imageCount: 0, mermaidCount: 0 };

  const cjkChars = (allText.match(/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/g) || []).length;
  const cjkRatio = cjkChars / allText.length;

  const codeBlocks = container.querySelectorAll(
    'code, pre, [class*="code"], [data-block-id] [spellcheck="false"]'
  );
  let codeChars = 0;
  let mermaidCount = 0;
  let plantumlCount = 0;
  codeBlocks.forEach((el) => {
    const t = (el.innerText || "").trim();
    codeChars += t.length;
    const type = isDiagramDSL(t);
    if (type === "mermaid") mermaidCount++;
    else if (type === "plantuml") plantumlCount++;
  });
  const codeRatio = codeChars / allText.length;

  const tableCount = container.querySelectorAll("table").length;
  const tableRows = container.querySelectorAll("tr").length;
  let imageCount = 0;
  container.querySelectorAll("img").forEach((img) => {
    if (isContentImage(img)) imageCount++;
  });

  let svgCount = 0;
  container.querySelectorAll("svg").forEach((svg) => {
    if (isContentSvg(svg)) svgCount++;
  });
  const drawioCount = (container.innerHTML || "").includes("mxGraphModel") ? 1 : 0;

  return { cjkRatio, codeRatio, tableCount, tableRows, imageCount, mermaidCount, plantumlCount, svgCount, drawioCount, totalChars: allText.length };
}

function autoDetectMethod(container) {
  if (methodOverride) return;

  const profile = profileContent(container);

  // Claude BPE handles all languages/content natively -- no need for heuristic selection
  if (claudeEncoder) {
    currentMethod = "claude";
  } else if (profile.cjkRatio > 0.15) {
    currentMethod = "chars/3";
  } else if (profile.codeRatio > 0.3) {
    currentMethod = "code";
  } else if (profile.codeRatio > 0.1) {
    currentMethod = "words*1.3";
  } else {
    currentMethod = "chars/4";
  }

  return profile;
}

// ── DOM helpers ─────────────────────────────────────────────────────

/**
 * Get text content from a DOM element.
 * Uses textContent (not innerText) so collapsed toggles are included --
 * exported .md contains all toggle content regardless of collapse state.
 */
function getTextContent(el) {
  if (!el) return "";
  return el.textContent || "";
}

/**
 * Check if a block is a leaf block (has no child blocks with data-block-id).
 * Used to avoid double-counting in multi-column layouts where
 * both the column container and the inner blocks have data-block-id.
 */
function isLeafBlock(block) {
  return block.querySelector("[data-block-id]") === null;
}

/**
 * Get text only from leaf-level content of a block.
 * If the block contains child blocks, we skip its own text to avoid
 * double-counting -- the children will be counted separately.
 */
function getLeafText(block) {
  if (isLeafBlock(block)) {
    return block.textContent || "";
  }
  // For container blocks (columns, toggles), only get direct text nodes
  // not inside a child [data-block-id]
  let text = "";
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let parent = node.parentElement;
      while (parent && parent !== block) {
        if (parent.hasAttribute("data-block-id")) return NodeFilter.FILTER_REJECT;
        parent = parent.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) {
    text += walker.currentNode.textContent;
  }
  return text;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function getNotionContainer() {
  // Peek mode has its own scroller/content area inside the modal
  const peek =
    document.querySelector(".notion-peek-renderer .notion-page-content") ||
    document.querySelector(".notion-peek-renderer .notion-scroller");
  if (peek) return peek;

  return (
    document.querySelector(".notion-page-content") ||
    document.querySelector('[role="document"]') ||
    document.querySelector(".notion-scroller") ||
    document.body
  );
}

// ── Section detection ───────────────────────────────────────────────

/**
 * Count media elements within a set of blocks.
 */
const MERMAID_KEYWORDS = [
  "graph ", "flowchart ", "sequencediagram", "classdiagram",
  "statediagram", "erdiagram", "gantt", "pie", "gitgraph",
];

const PLANTUML_KEYWORDS = ["@startuml", "@startmindmap", "@startsalt", "@startgantt", "@startwbs"];

function isDiagramDSL(text) {
  const lower = text.toLowerCase();
  for (const kw of MERMAID_KEYWORDS) {
    if (lower.startsWith(kw)) return "mermaid";
  }
  for (const kw of PLANTUML_KEYWORDS) {
    if (lower.startsWith(kw)) return "plantuml";
  }
  return null;
}

/**
 * Check if an SVG is actual content (diagram, illustration) vs a Notion UI icon.
 * Content SVGs are large with path data; UI SVGs are small icons (< 64px, few children).
 */
function isContentSvg(svg) {
  const width = svg.getAttribute("width");
  const height = svg.getAttribute("height");
  if (width && height) {
    const w = parseFloat(width);
    const h = parseFloat(height);
    if (w > 0 && w <= 24 && h > 0 && h <= 24) return false;
  }
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] <= 24 && parts[3] <= 24) return false;
  }
  if (svg.querySelectorAll("path, line, polyline, polygon, rect, circle, ellipse").length <= 2) {
    return false;
  }
  return true;
}

/**
 * Check if an img is actual page content vs a Notion UI element.
 * Notion pages are full of small icons, avatars, emoji images, and
 * property-type indicators that we must skip.
 */
function isContentImage(img) {
  const src = (img.getAttribute("src") || "");
  if (!src) return false;

  // Skip inline SVG data URIs
  if (src.startsWith("data:image/svg")) return false;

  // Skip Notion UI icons (/icons/ path)
  if (src.includes("/icons/") || src.includes("/emoji/")) return false;

  // Skip Slack/external avatars (small profile photos, not page content)
  if (src.includes("avatars.slack-edge.com")) return false;

  // Skip images loaded at tiny sizes via Notion's proxy (width <= 80 in URL)
  const widthParam = src.match(/[?&]width=(\d+)/);
  if (widthParam && parseInt(widthParam[1], 10) <= 80) return false;

  // Skip by rendered/natural size — anything under 64px is UI chrome
  const w = img.naturalWidth || img.width || parseInt(img.getAttribute("width") || "0", 10);
  const h = img.naturalHeight || img.height || parseInt(img.getAttribute("height") || "0", 10);
  if (w > 0 && w < 64 && h > 0 && h < 64) return false;

  // Skip if parent is a known Notion UI container (property row, breadcrumb, etc.)
  let parent = img.parentElement;
  for (let i = 0; i < 4 && parent; i++) {
    const cls = parent.className || "";
    if (cls.includes("notion-record-icon") ||
        cls.includes("notion-page-icon") ||
        cls.includes("notion-emoji") ||
        cls.includes("notion-collection-property") ||
        cls.includes("notion-bulleted_list-block") && w < 100) {
      return false;
    }
    parent = parent.parentElement;
  }

  return true;
}

function countMedia(blocks) {
  let images = 0;
  let tableRows = 0;
  let mermaidBlocks = 0;
  let plantumlBlocks = 0;
  let svgInline = 0;
  let drawioXml = 0;

  // Only count media in leaf blocks to prevent double-counting
  // when parent and child blocks both have data-block-id
  const leafBlocks = blocks.filter((b) => isLeafBlock(b));

  leafBlocks.forEach((block) => {
    const imgs = block.querySelectorAll("img");
    imgs.forEach((img) => {
      if (!isContentImage(img)) return;
      const src = (img.getAttribute("src") || "").toLowerCase();
      const alt = (img.getAttribute("alt") || "").toLowerCase();
      if (src.includes("drawio") || src.includes("diagrams.net") || alt.includes("drawio")) {
        drawioXml++;
      } else {
        images++;
      }
    });

    tableRows += block.querySelectorAll("tr").length;

    block.querySelectorAll("svg").forEach((svg) => {
      if (isContentSvg(svg)) svgInline++;
    });

    const html = block.innerHTML || "";
    if (html.includes("mxGraphModel") || html.includes("mxfile")) {
      drawioXml++;
    }

    const codeEls = block.querySelectorAll('code, pre, [class*="code"]');
    codeEls.forEach((el) => {
      const text = (el.innerText || "").trim();
      const type = isDiagramDSL(text);
      if (type === "mermaid") mermaidBlocks++;
      else if (type === "plantuml") plantumlBlocks++;
    });
  });

  return { images, tableRows, mermaidBlocks, plantumlBlocks, svgInline, drawioXml };
}

function mediaTokenOverhead(media) {
  return (
    media.images * TOKENS_PER_IMAGE +
    media.tableRows * TOKENS_PER_TABLE_ROW +
    media.svgInline * TOKENS_PER_SVG_INLINE +
    media.drawioXml * TOKENS_PER_DRAWIO_XML
    // mermaid & plantuml: already counted as text tokens (their DSL code is the content)
  );
}

function detectSections() {
  const container = getNotionContainer();
  const blocks = container.querySelectorAll("[data-block-id]");
  const sections = [];
  let currentSection = { title: "Intro", blocks: [], blockId: null };

  blocks.forEach((block) => {
    const heading =
      block.querySelector("h1, h2, h3, h4") ||
      block.querySelector('[role="heading"]') ||
      block.querySelector(".notion-header-block");

    if (heading) {
      const level =
        parseInt(heading.getAttribute?.("aria-level"), 10) ||
        parseInt(heading.tagName?.[1], 10) ||
        2;
      const title = getTextContent(heading).trim() || `Heading ${level}`;

      if (currentSection.blocks.length > 0 || sections.length === 0) {
        finalizeSection(currentSection);
        sections.push({ ...currentSection });
      }

      currentSection = {
        title,
        level,
        blocks: [block],
        blockId: block.getAttribute("data-block-id") || null,
        text: "",
        tokens: 0,
      };
    } else {
      currentSection.blocks.push(block);
    }
  });

  if (currentSection.blocks.length > 0) {
    finalizeSection(currentSection);
    sections.push(currentSection);
  }

  return sections;
}

function finalizeSection(section) {
  // Use getLeafText to avoid double-counting in multi-column / toggle containers
  section.text = section.blocks.map((b) => getLeafText(b)).join("\n");
  section.media = countMedia(section.blocks);
  const textTokens = estimateTokens(section.text);
  const overhead = mediaTokenOverhead(section.media);
  section.tokens = textTokens + overhead;
  section.textTokens = textTokens;
  section.mediaTokens = overhead;
}

// ── Bridge communication ────────────────────────────────────────────

const isLite = chrome.runtime.getManifest().name.includes("Lite");
const BRIDGE_URL = isLite ? "http://127.0.0.1:44124" : "http://127.0.0.1:7749";
let bridgeAvailable = null;

async function checkBridge() {
  try {
    const r = await fetch(`${BRIDGE_URL}/status`, { signal: AbortSignal.timeout(1500) });
    bridgeAvailable = r.ok;
  } catch {
    bridgeAvailable = false;
  }
  return bridgeAvailable;
}

function resolveNotionUrl(src) {
  if (!src) return src;
  if (src.startsWith("http://") || src.startsWith("https://")) return src;
  if (src.startsWith("data:")) return src;
  if (src.startsWith("/")) return `https://www.notion.so${src}`;
  return src;
}

async function fetchImageAsBase64(url) {
  try {
    const resp = await fetch(url, { credentials: "include" });
    if (!resp.ok) {
      console.warn(`Honoka: fetch failed for image (${resp.status}): ${url.substring(0, 80)}…`);
      return null;
    }
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn(`Honoka: fetch error for image: ${err.message}`);
    return null;
  }
}

/**
 * Capture an already-rendered <img> element via canvas.
 * Works for same-origin images that the browser has loaded, even if
 * fetch() would fail due to auth/CORS issues with the proxy URL.
 */
function captureImageViaCanvas(imgEl) {
  try {
    if (!imgEl.complete || imgEl.naturalWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = imgEl.naturalWidth;
    canvas.height = imgEl.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(imgEl, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * Try to extract the original filename from a Notion image URL.
 * Notion attachment URLs look like: /image/attachment%3Auuid%3Afilename.jpg?...
 * Notion S3 URLs look like: /image/https%3A...%2Ffilename.jpg?...
 */
function extractImageFilename(src, index) {
  // Try attachment:uuid:filename pattern
  const attachMatch = src.match(/attachment%3A[^%]+%3A([^?&]+)/i);
  if (attachMatch) {
    return decodeURIComponent(attachMatch[1]);
  }
  // Try to get filename from end of path (before query params)
  const urlPath = src.split("?")[0];
  const segments = urlPath.split(/[/%]/).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const decoded = decodeURIComponent(segments[i]);
    if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|tiff)$/i.test(decoded)) {
      return decoded;
    }
  }
  // Fallback
  const ext = src.match(/\.(png|jpg|jpeg|gif|webp|svg)/i)?.[1] || "png";
  return `img-${index}.${ext}`;
}

function extractMarkdown() {
  const container = getNotionContainer();
  const sections = detectSections();
  const title = getNotionPageTitle() || "Untitled";
  const lines = [`# ${title}`, ""];

  sections.forEach((s) => {
    if (s.title && s.title !== "Intro") {
      const prefix = "#".repeat(Math.min(s.level || 2, 4));
      lines.push(`${prefix} ${s.title}`, "");
    }
    if (s.text) lines.push(s.text.trim(), "");
  });

  // Collect content images with resolved URLs
  const images = [];
  const seenSrc = new Set();
  container.querySelectorAll("img").forEach((img) => {
    if (!isContentImage(img)) return;
    const rawSrc = img.getAttribute("src") || "";
    if (!rawSrc || rawSrc.startsWith("data:")) return;
    // Deduplicate — skip if we've already captured this src
    const srcKey = rawSrc.split("?")[0];
    if (seenSrc.has(srcKey)) return;
    seenSrc.add(srcKey);

    const src = resolveNotionUrl(rawSrc);
    const alt = (img.getAttribute("alt") || "").trim();
    const filename = extractImageFilename(rawSrc, images.length + 1);
    images.push({ url: src, filename, alt, originalSrc: rawSrc, domElement: img });
    lines.push(`![${alt || filename}](<images/${filename}>)`, "");
  });

  return { markdown: lines.join("\n"), images, title };
}

async function saveLocally() {
  if (!bridgeAvailable) {
    await checkBridge();
    if (!bridgeAvailable) return { ok: false, error: "Bridge not running. Start with: node honoka-bridge/index.js" };
  }

  const { markdown, images, title } = extractMarkdown();
  const pageId = getNotionPageId();
  const properties = extractPageProperties();
  const url = window.location.href;

  // Fetch images — try fetch first, fall back to canvas capture
  const enrichedImages = [];
  for (const img of images) {
    let dataUrl = await fetchImageAsBase64(img.url);

    // Fallback: capture from the rendered DOM element via canvas
    if (!dataUrl && img.domElement) {
      dataUrl = captureImageViaCanvas(img.domElement);
      if (dataUrl) console.log(`Honoka: captured ${img.filename} via canvas fallback`);
    }

    // Don't send domElement to bridge (not serializable)
    const { domElement, ...rest } = img;
    enrichedImages.push({ ...rest, dataUrl: dataUrl || null });
  }

  // Auto-detect category: user ID match (strongest) → alias match → default "reference"
  let category = "reference";
  try {
    const keysToGet = ["honoka_my_name", "honoka_notion_user"];
    if (pageId) keysToGet.push(_splitKeyForPage(pageId));
    const stored = await new Promise((r) => chrome.storage.local.get(keysToGet, r));
    if (pageId) {
      const entry = stored[_splitKeyForPage(pageId)];
      const createdById = entry?.meta?.created_by_id;
      const createdByName = (entry?.meta?.created_by || "").toLowerCase();
      const myUserId = stored.honoka_notion_user?.id;

      if (myUserId && createdById && createdById === myUserId) {
        category = "mine";
      } else if (stored.honoka_my_name && createdByName) {
        const aliases = stored.honoka_my_name.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
        if (aliases.some((alias) => createdByName.includes(alias))) {
          category = "mine";
        }
      }
    }
  } catch {}

  try {
    const resp = await fetch(`${BRIDGE_URL}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId, title, markdown, images: enrichedImages, properties, url, category }),
    });
    return await resp.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Overlay rendering ───────────────────────────────────────────────

function buildRingSvg(pct, ringColor, size, strokeWidth, radius) {
  const circumference = 2 * Math.PI * radius;
  const clampedPct = Math.min(pct, 100);
  const dashOffset = circumference * (1 - clampedPct / 100);
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="${strokeWidth}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="${ringColor}" stroke-width="${strokeWidth}"
      stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"
      stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"
      style="transition: stroke-dashoffset 0.5s ease"/>
  </svg>`;
}

function renderOverlay(sections, budgetTotal) {
  const existing = document.getElementById("honoka-token-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "honoka-token-overlay";
  overlay.className = "honoka-token-overlay";

  const totalTokens = sections.reduce((a, s) => a + s.tokens, 0);
  const totalMediaTokens = sections.reduce((a, s) => a + (s.mediaTokens || 0), 0);
  const totalChars = sections.reduce((a, s) => a + (s.text?.length || 0), 0);
  const totalImages = sections.reduce((a, s) => a + (s.media?.images || 0), 0);
  const totalMermaid = sections.reduce((a, s) => a + (s.media?.mermaidBlocks || 0), 0);
  const totalPlantUML = sections.reduce((a, s) => a + (s.media?.plantumlBlocks || 0), 0);
  const totalSvg = sections.reduce((a, s) => a + (s.media?.svgInline || 0), 0);
  const totalDrawio = sections.reduce((a, s) => a + (s.media?.drawioXml || 0), 0);
  const totalTableRows = sections.reduce((a, s) => a + (s.media?.tableRows || 0), 0);
  const pct = Math.round((totalTokens / budgetTotal) * 100);
  const method = getEstimationInfo();
  const ringColor = pct > 100 ? "#d93025" : pct > 85 ? "#f4b400" : "#0f9d58";

  // ── Collapsed pill (default) ──
  const pill = document.createElement("div");
  pill.className = "honoka-pill";
  const tokLabel = totalTokens >= 1000 ? Math.round(totalTokens / 1000) + "k" : String(totalTokens);
  pill.innerHTML = `
    <div class="honoka-pill-ring">${buildRingSvg(pct, ringColor, 32, 3, 13)}<span class="honoka-pill-pct">${pct}%</span></div>
    <span class="honoka-pill-tok">${tokLabel} tok</span>
    <button class="honoka-pill-save" title="Save locally">💾</button>
    <button class="honoka-pill-close" title="Dismiss">×</button>
  `;
  overlay.appendChild(pill);

  // ── Expanded panel ──
  const panel = document.createElement("div");
  panel.className = "honoka-panel";
  if (!overlayExpanded) panel.style.display = "none";

  const autoLabel = method.autoDetected ? " (auto)" : " (manual)";
  const mediaParts = [];
  if (totalImages > 0) mediaParts.push(`${totalImages} img`);
  if (totalMermaid > 0) mediaParts.push(`${totalMermaid} mermaid`);
  if (totalPlantUML > 0) mediaParts.push(`${totalPlantUML} plantuml`);
  if (totalDrawio > 0) mediaParts.push(`${totalDrawio} draw.io`);
  if (totalSvg > 0) mediaParts.push(`${totalSvg} svg`);
  if (totalTableRows > 0) mediaParts.push(`${totalTableRows} table rows`);
  const mediaLine = mediaParts.length > 0
    ? `<span>${mediaParts.join(" · ")} (+${totalMediaTokens.toLocaleString()} tok)</span>`
    : "";

  const header = document.createElement("div");
  header.className = "honoka-header";
  header.innerHTML = `
    <div class="honoka-header-top">
      <strong>Honoka Token Budget</strong>
      <button class="honoka-panel-close">×</button>
    </div>
    <div class="honoka-ring-row">
      <div class="honoka-ring-wrap">${buildRingSvg(pct, ringColor, 56, 5, 23)}<span class="honoka-ring-label">${pct}%</span></div>
      <div class="honoka-stats">
        <span><strong>${totalTokens.toLocaleString()}</strong> / ${budgetTotal.toLocaleString()} tokens</span>
        <span>${totalChars.toLocaleString()} chars · ${sections.length} sections</span>
        ${mediaLine}
        <span class="honoka-method" title="${method.description}">Method: ${method.name}${autoLabel}</span>
      </div>
    </div>
  `;
  panel.appendChild(header);

  const list = document.createElement("div");
  list.className = "honoka-sections";
  let cumulative = 0;
  sections.forEach((s) => {
    cumulative += s.tokens;
    const remaining = Math.max(0, budgetTotal - cumulative);
    let status;
    if (cumulative > budgetTotal) status = "over";
    else if (remaining < budgetTotal * 0.15) status = "warn";
    else status = "ok";

    const row = document.createElement("div");
    row.className = `honoka-section honoka-${status}`;
    if (s.level) row.style.paddingLeft = `${8 + (s.level - 1) * 12}px`;
    row.innerHTML = `
      <span class="honoka-title">${escapeHtml(s.title)}</span>
      <span class="honoka-tokens">${s.tokens.toLocaleString()} tok</span>
      <span class="honoka-remaining">${cumulative <= budgetTotal ? remaining.toLocaleString() + " left" : "TRUNCATED"}</span>
    `;
    if (s.blockId) {
      row.style.cursor = "pointer";
      row.addEventListener("click", () => {
        const target = document.querySelector(`[data-block-id="${s.blockId}"]`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    list.appendChild(row);
  });
  panel.appendChild(list);
  overlay.appendChild(panel);

  // Click pill to expand
  pill.querySelector(".honoka-pill-ring").addEventListener("click", () => {
    overlayExpanded = true;
    pill.style.display = "none";
    panel.style.display = "";
  });
  pill.querySelector(".honoka-pill-tok").addEventListener("click", () => {
    overlayExpanded = true;
    pill.style.display = "none";
    panel.style.display = "";
  });

  // Save locally via bridge
  const saveBtn = pill.querySelector(".honoka-pill-save");
  checkBridge().then(async (ok) => {
    if (!ok) {
      saveBtn.style.opacity = "0.3";
      saveBtn.title = "Bridge not running — start with: node honoka-bridge/index.js";
      return;
    }
    try {
      const pageId = getPageId();
      const resp = await fetch(`${BRIDGE_URL}/list`, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) {
        const { docs } = await resp.json();
        const saved = docs.find(d => d.pageId === pageId);
        if (saved) {
          saveBtn.style.filter = "hue-rotate(90deg) saturate(2)";
          saveBtn.title = `Previously saved → ${saved.folder} (${saved.lastModified ? new Date(saved.lastModified).toLocaleDateString() : "unknown"})`;
        }
      }
    } catch {}
  });
  saveBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    saveBtn.textContent = "⏳";
    const result = await saveLocally();
    saveBtn.textContent = result.ok ? "✅" : "❌";
    saveBtn.title = result.ok ? `Saved to ${result.folder}` : (result.error || "Failed");
    saveBtn.style.filter = result.ok ? "hue-rotate(90deg) saturate(2)" : "";
    setTimeout(() => { saveBtn.textContent = "💾"; }, 3000);
  });

  // Close pill entirely
  pill.querySelector(".honoka-pill-close").addEventListener("click", (e) => {
    e.stopPropagation();
    overlay.remove();
    stopObserver();
  });

  // Collapse panel back to pill
  header.querySelector(".honoka-panel-close").addEventListener("click", () => {
    overlayExpanded = false;
    panel.style.display = "none";
    pill.style.display = "";
  });

  // If already expanded (user clicked expand before a refresh), show panel
  if (overlayExpanded) {
    pill.style.display = "none";
    panel.style.display = "";
  }

  document.body.appendChild(overlay);
}

// ── Core analyze function ───────────────────────────────────────────

function analyze(budgetTotal) {
  const container = getNotionContainer();
  autoDetectMethod(container);
  const sections = detectSections();
  renderOverlay(sections, budgetTotal || currentBudget);

  const totalTokens = sections.reduce((a, s) => a + s.tokens, 0);
  const totalMermaid = sections.reduce((a, s) => a + (s.media?.mermaidBlocks || 0), 0);
  logPageVisit(totalTokens, { totalMermaid });
  try {
    chrome.runtime.sendMessage({ action: "updateBadge", totalTokens });
  } catch (_) {}

  return {
    sections,
    totalTokens,
    totalChars: sections.reduce((a, s) => a + (s.text?.length || 0), 0),
    totalImages: sections.reduce((a, s) => a + (s.media?.images || 0), 0),
    totalMermaid: sections.reduce((a, s) => a + (s.media?.mermaidBlocks || 0), 0),
    totalPlantUML: sections.reduce((a, s) => a + (s.media?.plantumlBlocks || 0), 0),
    totalSvg: sections.reduce((a, s) => a + (s.media?.svgInline || 0), 0),
    totalDrawio: sections.reduce((a, s) => a + (s.media?.drawioXml || 0), 0),
    totalTableRows: sections.reduce((a, s) => a + (s.media?.tableRows || 0), 0),
    totalMediaTokens: sections.reduce((a, s) => a + (s.mediaTokens || 0), 0),
  };
}

// ── Live refresh via MutationObserver ────────────────────────────────

function debouncedRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (document.getElementById("honoka-token-overlay")) {
      analyze(currentBudget);
    }
  }, 1500);
}

function startObserver() {
  if (observer) return;

  const container = getNotionContainer();
  observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) => {
      if (m.type === "characterData") return true;
      if (m.type === "childList" && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
        // Ignore mutations that are just image lazy-loading (src swap placeholders).
        // These add/remove img or loading-spinner nodes without changing content.
        const isImageSwap = [...m.addedNodes, ...m.removedNodes].every(
          (n) => n.nodeName === "IMG" || (n.nodeType === 1 && n.querySelector && !n.querySelector("[data-block-id]") && n.querySelectorAll("img, svg").length > 0 && !n.textContent?.trim())
        );
        return !isImageSwap;
      }
      return false;
    });
    if (relevant) debouncedRefresh();
  });

  observer.observe(container, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

// ── Serialization for popup communication ───────────────────────────

function serializeSections(sections) {
  return sections.map((s) => ({
    title: s.title,
    level: s.level || 0,
    tokens: s.tokens,
  }));
}

// ── Message listener (popup) ────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "analyze") {
    if (msg.method && ESTIMATION_METHODS[msg.method]) {
      methodOverride = msg.method;
      currentMethod = msg.method;
    }
    if (msg.autoDetect) {
      methodOverride = null;
    }
    currentBudget = msg.budgetTotal || 24000;

    const result = analyze(currentBudget);
    startObserver();

    sendResponse({
      sections: serializeSections(result.sections),
      totalTokens: result.totalTokens,
      totalChars: result.totalChars,
      totalImages: result.totalImages,
      totalMermaid: result.totalMermaid,
      totalPlantUML: result.totalPlantUML,
      totalSvg: result.totalSvg,
      totalDrawio: result.totalDrawio,
      totalTableRows: result.totalTableRows,
      totalMediaTokens: result.totalMediaTokens,
      sectionCount: result.sections.length,
      method: getEstimationInfo(),
      budgetUsedPct: Math.round((result.totalTokens / currentBudget) * 100),
    });
  }

  if (msg.action === "saveLocally") {
    saveLocally().then((result) => sendResponse(result));
    return true;
  }

  if (msg.action === "checkBridge") {
    checkBridge().then((ok) => sendResponse({ available: ok }));
    return true;
  }

  if (msg.action === "fetchPageMeta") {
    const pids = msg.pageIds || [];
    Promise.all(pids.map((pid) => fetchAndStorePageMeta(pid)))
      .then(() => sendResponse({ ok: true, count: pids.length }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  return true;
});

// ── Auto-load & SPA navigation detection ────────────────────────────

function waitForNotionContent(onReady) {
  let attempts = 0;
  const check = setInterval(() => {
    attempts++;
    const container = getNotionContainer();
    const blocks = container.querySelectorAll("[data-block-id]");

    if (blocks.length > 0) {
      clearInterval(check);
      onReady();
    }

    if (attempts > 30) clearInterval(check);
  }, 500);
}

function onPageReady() {
  stopObserver();
  analyze(currentBudget);
  startObserver();
}

// Notion is an SPA — URL changes without page reloads.
// Poll for URL changes to detect navigation and peek mode.
let lastUrl = window.location.href;
let lastPeekState = false;

function checkNavigation() {
  const currentUrl = window.location.href;
  const hasPeek = !!document.querySelector(".notion-peek-renderer");

  const urlChanged = currentUrl !== lastUrl;
  const peekOpened = hasPeek && !lastPeekState;
  const peekClosed = !hasPeek && lastPeekState;

  if (urlChanged || peekOpened || peekClosed) {
    lastUrl = currentUrl;
    lastPeekState = hasPeek;
    waitForNotionContent(onPageReady);
  }
}

setInterval(checkNavigation, 1000);

// Initial load
waitForNotionContent(onPageReady);

// ── Notion API debug harness (accessible from devtools console) ─────
// Usage: open devtools on a Notion page, then:
//   window.__honoka.apiAnalyze()       — full page analysis via internal API
//   window.__honoka.snapshots()        — version history
//   window.__honoka.discussions()      — page comments/discussions
//   window.__honoka.compare()          — compare DOM vs API token counts

window.__honoka = {
  async apiAnalyze() {
    const pageId = getNotionPageId();
    if (!pageId) return console.warn("Not on a Notion page");
    console.log(`[Honoka API] Loading page ${pageId}…`);
    const result = await analyzePageViaAPI(pageId);
    console.log("[Honoka API] Page meta:", result.meta);
    console.log("[Honoka API] Block stats:", result.stats);
    console.log("[Honoka API] Sections:", result.sections.map((s) => ({
      title: s.title,
      level: s.level,
      blockCount: s.blocks.length,
      textLength: s.blocks.reduce((a, b) => a + (b.text?.length || 0), 0),
    })));
    if (Object.keys(result.schemas).length > 0) {
      console.log("[Honoka API] Databases:", result.schemas);
    }
    console.log("[Honoka API] Full result:", result);
    return result;
  },

  async snapshots() {
    const pageId = getNotionPageId();
    if (!pageId) return console.warn("Not on a Notion page");
    console.log(`[Honoka API] Loading version history for ${pageId}…`);
    const result = await getSnapshotsList(pageId);
    const list = result.snapshotVersionsList || [];
    console.log(`[Honoka API] ${list.length} snapshots:`, list);
    return result;
  },

  async discussions() {
    const pageId = getNotionPageId();
    if (!pageId) return console.warn("Not on a Notion page");
    console.log(`[Honoka API] Loading discussions for ${pageId}…`);
    const result = await getPageDiscussions(pageId);
    const unresolved = result.filter((d) => !d.resolved);
    console.log(`[Honoka API] ${result.length} discussions (${unresolved.length} unresolved):`, result);
    return result;
  },

  async compare() {
    const pageId = getNotionPageId();
    if (!pageId) return console.warn("Not on a Notion page");

    console.log("[Honoka Compare] Running DOM analysis…");
    const domSections = detectSections();
    const domTotal = domSections.reduce((a, s) => a + s.tokens, 0);

    console.log("[Honoka Compare] Running API analysis…");
    const apiResult = await analyzePageViaAPI(pageId);
    const apiText = apiResult.flatBlocks
      .filter((b) => b.type !== "page")
      .map((b) => b.text)
      .join("\n");
    const apiTokens = estimateTokens(apiText);

    console.log("[Honoka Compare] Results:");
    console.table({
      "DOM scraping": {
        sections: domSections.length,
        tokens: domTotal,
        method: "querySelectorAll + textContent",
      },
      "Internal API": {
        sections: apiResult.sections.length,
        tokens: apiTokens,
        method: "loadPageChunk → flattenBlocks",
      },
      "Difference": {
        sections: apiResult.sections.length - domSections.length,
        tokens: apiTokens - domTotal,
        method: `${Math.abs(((apiTokens - domTotal) / domTotal) * 100).toFixed(1)}% drift`,
      },
    });

    return { domSections, domTotal, apiResult, apiTokens };
  },
};
