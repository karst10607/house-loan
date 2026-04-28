/**
 * Notion Internal API client — runs inside the content script on notion.so.
 *
 * Uses the browser's session cookies (token_v2) for auth via credentials:"include".
 * These endpoints are undocumented and may change without notice.
 */

const NOTION_API = "https://www.notion.so/api/v3";

function formatUUID(raw) {
  const hex = raw.replace(/-/g, "");
  if (hex.length !== 32) return raw;
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function notionPost(endpoint, body) {
  const resp = await fetch(`${NOTION_API}/${endpoint}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Notion API ${endpoint}: ${resp.status}`);
  return resp.json();
}

// ── loadPageChunk ───────────────────────────────────────────────────
// Returns the full block tree for a page. Each block has:
//   .type  (text, header, sub_header, code, image, callout, toggle, etc.)
//   .properties.title  — rich-text array [[text, [[formatting]]]]
//   .content  — array of child block IDs
//   .created_time, .last_edited_time
//   .created_by_id, .last_edited_by_id

export async function loadPageChunk(pageId, { limit = 100, chunkNumber = 0 } = {}) {
  return notionPost("loadPageChunk", {
    pageId: formatUUID(pageId),
    limit,
    cursor: { stack: [] },
    chunkNumber,
    verticalColumns: false,
  });
}

// Load ALL chunks for a page (auto-paginate)
export async function loadFullPage(pageId) {
  const allBlocks = {};
  let collections = {};
  let collectionViews = {};
  let chunk = 0;

  while (true) {
    const data = await loadPageChunk(pageId, { limit: 100, chunkNumber: chunk });
    const rm = data.recordMap || {};
    Object.assign(allBlocks, rm.block || {});
    Object.assign(collections, rm.collection || {});
    Object.assign(collectionViews, rm.collection_view || {});

    const cursor = data.cursor?.stack;
    if (!cursor || cursor.length === 0) break;
    chunk++;
    if (chunk > 20) break; // safety limit
  }

  return { blocks: allBlocks, collections, collectionViews };
}

// ── Structured block extraction ─────────────────────────────────────

const BLOCK_TYPES = {
  page: "page",
  text: "text",
  header: "h1",
  sub_header: "h2",
  sub_sub_header: "h3",
  bulleted_list: "bullet",
  numbered_list: "number",
  to_do: "todo",
  toggle: "toggle",
  code: "code",
  quote: "quote",
  callout: "callout",
  divider: "divider",
  image: "image",
  video: "video",
  embed: "embed",
  bookmark: "bookmark",
  equation: "equation",
  table: "table",
  table_row: "table_row",
  column_list: "column_list",
  column: "column",
  collection_view: "database_view",
  collection_view_page: "database_page",
  synced_block: "synced_block",
  alias: "alias",
};

function extractRichText(titleArray) {
  if (!titleArray || !Array.isArray(titleArray)) return "";
  return titleArray.map((segment) => {
    if (typeof segment === "string") return segment;
    if (Array.isArray(segment)) return segment[0] || "";
    return "";
  }).join("");
}

export function flattenBlocks(blockMap, rootId) {
  const result = [];
  const visited = new Set();

  function walk(blockId, depth = 0) {
    if (visited.has(blockId)) return;
    visited.add(blockId);

    const record = blockMap[blockId];
    if (!record?.value) return;
    const block = record.value;

    const type = BLOCK_TYPES[block.type] || block.type;
    const text = extractRichText(block.properties?.title);

    const entry = {
      id: blockId,
      type,
      rawType: block.type,
      text,
      depth,
      hasChildren: !!(block.content?.length),
      createdTime: block.created_time,
      lastEditedTime: block.last_edited_time,
    };

    if (block.type === "code") {
      entry.language = extractRichText(block.properties?.language);
    }
    if (block.type === "image" || block.type === "video") {
      entry.source = extractRichText(block.properties?.source);
      entry.caption = extractRichText(block.properties?.caption);
    }
    if (block.type === "to_do") {
      entry.checked = block.properties?.checked?.[0]?.[0] === "Yes";
    }
    if (block.type === "callout") {
      entry.icon = block.format?.page_icon;
    }
    if (block.type === "bookmark") {
      entry.link = extractRichText(block.properties?.link);
      entry.description = extractRichText(block.properties?.description);
    }

    result.push(entry);

    if (block.content) {
      for (const childId of block.content) {
        walk(childId, depth + 1);
      }
    }
  }

  walk(rootId);
  return result;
}

// ── Section detection from structured blocks ────────────────────────
// Much more reliable than DOM scraping — heading types are explicit.

export function structuredSections(flatBlocks) {
  const sections = [];
  let current = { title: "Intro", level: 0, blocks: [] };

  for (const block of flatBlocks) {
    if (block.type === "page") continue;

    if (block.type === "h1" || block.type === "h2" || block.type === "h3") {
      if (current.blocks.length > 0 || sections.length === 0) {
        sections.push(current);
      }
      const level = block.type === "h1" ? 1 : block.type === "h2" ? 2 : 3;
      current = { title: block.text || `Heading ${level}`, level, blocks: [block] };
    } else {
      current.blocks.push(block);
    }
  }
  if (current.blocks.length > 0) sections.push(current);
  return sections;
}

// ── Page metadata ───────────────────────────────────────────────────

export function extractPageMeta(blockMap, pageId, recordMap) {
  const page = blockMap[pageId]?.value;
  if (!page) return null;

  const meta = {
    title: extractRichText(page.properties?.title),
    icon: page.format?.page_icon,
    cover: page.format?.page_cover,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
    createdBy: page.created_by_id,
    lastEditedBy: page.last_edited_by_id,
  };

  if (recordMap?.notion_user) {
    const users = recordMap.notion_user;
    if (meta.createdBy && users[meta.createdBy]?.value) {
      meta.createdByName = users[meta.createdBy].value.name;
    }
    if (meta.lastEditedBy && users[meta.lastEditedBy]?.value) {
      meta.lastEditedByName = users[meta.lastEditedBy].value.name;
    }
  }

  return meta;
}

// ── Database property extraction ────────────────────────────────────
// Extracts all properties from a database page using the collection schema
// to map internal property IDs to human-readable names and typed values.

export function extractPageProperties(pageBlock, schema, users) {
  if (!pageBlock?.properties || !schema) return {};

  const props = {};
  for (const [propId, propDef] of Object.entries(schema)) {
    if (propId === "title") continue; // title is handled separately
    const raw = pageBlock.properties[propId];
    if (!raw) continue;

    const name = propDef.name;
    const type = propDef.type;
    let value;

    switch (type) {
      case "text":
      case "title":
      case "url":
      case "email":
      case "phone_number":
        value = extractRichText(raw);
        break;

      case "number":
        value = extractRichText(raw);
        break;

      case "select":
        value = extractRichText(raw);
        break;

      case "multi_select": {
        value = extractRichText(raw);
        break;
      }

      case "date": {
        const dateStr = extractRichText(raw);
        // Notion date format annotations: [["‣",[["d",{start_date,end_date,...}]]]]
        const dateAnnotation = raw?.[0]?.[1]?.find?.((a) => a[0] === "d");
        if (dateAnnotation) {
          const d = dateAnnotation[1];
          value = d.start_date || dateStr;
          if (d.end_date) value += ` → ${d.end_date}`;
        } else {
          value = dateStr;
        }
        break;
      }

      case "person":
      case "people": {
        // Person props: [["‣",[["u","user-uuid"]]],["‣",[["u","user-uuid2"]]]]
        const names = [];
        if (Array.isArray(raw)) {
          for (const seg of raw) {
            if (!Array.isArray(seg) || !seg[1]) continue;
            for (const anno of seg[1]) {
              if (anno[0] === "u" && anno[1] && users?.[anno[1]]?.value) {
                names.push(users[anno[1]].value.name);
              }
            }
          }
        }
        value = names.length > 0 ? names.join(", ") : extractRichText(raw);
        break;
      }

      case "checkbox": {
        const v = extractRichText(raw);
        value = v === "Yes" ? "Yes" : "No";
        break;
      }

      case "relation": {
        // Relations store page IDs; we can't resolve titles without extra API calls
        const ids = [];
        if (Array.isArray(raw)) {
          for (const seg of raw) {
            if (Array.isArray(seg?.[1])) {
              for (const anno of seg[1]) {
                if (anno[0] === "p" && anno[1]) ids.push(anno[1].slice(0, 8));
              }
            }
          }
        }
        value = ids.length > 0 ? `${ids.length} linked` : "";
        break;
      }

      case "created_time":
        value = pageBlock.created_time
          ? new Date(pageBlock.created_time).toISOString().slice(0, 10)
          : "";
        break;

      case "created_by":
        value = pageBlock.created_by_id && users?.[pageBlock.created_by_id]?.value
          ? users[pageBlock.created_by_id].value.name
          : "";
        break;

      case "last_edited_time":
        value = pageBlock.last_edited_time
          ? new Date(pageBlock.last_edited_time).toISOString().slice(0, 10)
          : "";
        break;

      case "last_edited_by":
        value = pageBlock.last_edited_by_id && users?.[pageBlock.last_edited_by_id]?.value
          ? users[pageBlock.last_edited_by_id].value.name
          : "";
        break;

      case "rollup":
      case "formula":
        value = extractRichText(raw);
        break;

      default:
        value = extractRichText(raw);
    }

    if (value) {
      props[name] = { value, type };
    }
  }

  return props;
}

// ── queryCollection ─────────────────────────────────────────────────
// Query a Notion database (table, board, gallery, etc.)
// collectionId and viewId can be found in loadPageChunk results.

export async function queryCollection(collectionId, viewId, spaceId, { limit = 100, filter, sort, searchQuery } = {}) {
  const loader = {
    type: "reducer",
    reducers: {
      collection_group_results: { type: "results", limit },
    },
    searchQuery: searchQuery || "",
    userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  if (filter) loader.filter = filter;
  if (sort) loader.sort = sort;

  return notionPost("queryCollection", {
    collection: { id: formatUUID(collectionId), spaceId },
    collectionView: { id: formatUUID(viewId), spaceId },
    loader,
  });
}

export function extractCollectionSchema(collections) {
  const schemas = {};
  for (const [id, record] of Object.entries(collections)) {
    if (!record?.value?.schema) continue;
    const schema = record.value.schema;
    schemas[id] = {
      name: record.value.name?.[0]?.[0] || "Untitled database",
      properties: Object.entries(schema).map(([propId, prop]) => ({
        id: propId,
        name: prop.name,
        type: prop.type,
        options: prop.options,
      })),
    };
  }
  return schemas;
}

// ── getSnapshotsList ────────────────────────────────────────────────
// Returns page version history (list of snapshots with timestamps).

export async function getSnapshotsList(pageId, size = 20) {
  return notionPost("getSnapshotsList", {
    blockId: formatUUID(pageId),
    size,
  });
}

// ── getActivityLog ──────────────────────────────────────────────────
// Returns recent activity (edits, comments, etc.) for a page.

export async function getActivityLog(pageId, spaceId, limit = 20) {
  return notionPost("getActivityLog", {
    navigableBlockId: formatUUID(pageId),
    spaceId,
    limit,
  });
}

// ── getRecordValues ─────────────────────────────────────────────────
// Fetch specific records by table and ID (discussions, comments, etc.)

export async function getRecordValues(requests) {
  return notionPost("getRecordValues", { requests });
}

// ── getCurrentUser ──────────────────────────────────────────────────
// Returns { id, name, email } of the currently logged-in Notion user.

export async function getCurrentUser() {
  const data = await notionPost("getSpaces", {});
  const userRoot = Object.values(data)?.[0]?.notion_user;
  if (!userRoot) return null;
  const first = Object.values(userRoot)[0]?.value;
  if (!first) return null;
  return { id: first.id, name: first.name, email: first.email };
}

// ── Convenience: get comments/discussions for a page ────────────────

export async function getPageDiscussions(pageId) {
  const data = await loadPageChunk(pageId, { limit: 50 });
  const blocks = data.recordMap?.block || {};
  const discussions = data.recordMap?.discussion || {};
  const comments = data.recordMap?.comment || {};

  const result = [];
  for (const [id, record] of Object.entries(discussions)) {
    if (!record?.value) continue;
    const disc = record.value;
    const threadComments = (disc.comments || []).map((cid) => {
      const c = comments[cid]?.value;
      if (!c) return null;
      return {
        id: cid,
        text: extractRichText(c.text),
        createdBy: c.created_by_id,
        createdTime: c.created_time,
      };
    }).filter(Boolean);

    result.push({
      id,
      resolved: disc.resolved || false,
      context: disc.context,
      comments: threadComments,
    });
  }
  return result;
}

// ── Full page analysis via API (replaces DOM scraping) ──────────────

export async function analyzePageViaAPI(pageId) {
  const data = await loadPageChunk(pageId, { limit: 100 });
  const blockMap = data.recordMap?.block || {};
  const collections = data.recordMap?.collection || {};

  const flatBlocks = flattenBlocks(blockMap, pageId);
  const sections = structuredSections(flatBlocks);
  const meta = extractPageMeta(blockMap, pageId, data.recordMap);
  const schemas = extractCollectionSchema(collections);

  const stats = {
    totalBlocks: flatBlocks.length,
    byType: {},
    codeBlocks: flatBlocks.filter((b) => b.type === "code"),
    images: flatBlocks.filter((b) => b.type === "image"),
    databases: Object.keys(schemas),
  };
  for (const b of flatBlocks) {
    stats.byType[b.type] = (stats.byType[b.type] || 0) + 1;
  }

  return { meta, flatBlocks, sections, schemas, stats };
}
