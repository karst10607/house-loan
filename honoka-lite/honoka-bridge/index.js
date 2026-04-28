#!/usr/bin/env node

const cluster = require('cluster');

if (cluster.isPrimary || cluster.isMaster) {
  console.log(`[Honoka Manager] Starting Bridge on port ${process.env.HONOKA_PORT || "44124"}...`);
  cluster.fork();

  cluster.on('exit', (worker, code, signal) => {
    console.log(`[Honoka Manager] Bridge worker died (code: ${code}). Restarting in 1.5s...`);
    setTimeout(() => cluster.fork(), 1500);
  });
  
  // Forward SIGINT to exit cleanly
  process.on('SIGINT', () => {
    console.log(`[Honoka Manager] Shutting down...`);
    process.exit(0);
  });
  return;
}

// Worker code starts here
require('dns').setDefaultResultOrder('ipv4first');

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile, exec } = require("child_process");
const https = require("https");

const PORT = parseInt(process.env.HONOKA_PORT || "44124", 10);
const DOCS_DIR = process.env.HONOKA_DOCS_DIR
  ? path.resolve(process.env.HONOKA_DOCS_DIR)
  : path.join(require("os").homedir(), "honoka-docs");
const INBOX_DIR = path.join(require("os").homedir(), "honoka-inbox");
const EDITOR = process.env.HONOKA_EDITOR || "cursor";

// ── Settings store (bot tokens, etc.) persisted to ~/.honoka-docs/.honoka/settings.json ──
// This lets the Honoka UI manage credentials without touching environment variables.

const SETTINGS_FILE = path.join(
  process.env.HONOKA_DOCS_DIR
    ? path.resolve(process.env.HONOKA_DOCS_DIR)
    : path.join(require("os").homedir(), "honoka-docs"),
  ".honoka",
  "settings.json"
);

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); }
  catch { return {}; }
}

function writeSettings(s) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

// Merge env-var overrides on top of stored settings at startup.
// This keeps backward-compat for people who DO set env vars.
function getEffectiveSettings() {
  const stored = readSettings();
  return {
    ...stored,
    telegramBotToken:     process.env.TELEGRAM_BOT_TOKEN     || stored.telegramBotToken     || "",
    telegramAllowedUser:  process.env.TELEGRAM_ALLOWED_USER   || stored.telegramAllowedUser  || "",
    slackBotToken:        process.env.SLACK_BOT_TOKEN         || stored.slackBotToken        || "",
    slackAllowedChannel:  process.env.SLACK_ALLOWED_CHANNEL   || stored.slackAllowedChannel  || "",
  };
}

// Resolve editor binary — Launch Agents have a minimal PATH that
// typically doesn't include app-bundled CLIs like Cursor or VS Code.
function resolveEditor(name) {
  const candidates = {
    cursor: [
      "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
      "/usr/local/bin/cursor",
      path.join(require("os").homedir(), "Applications/Cursor.app/Contents/Resources/app/bin/cursor"),
    ],
    code: [
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      "/usr/local/bin/code",
      path.join(require("os").homedir(), "Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"),
    ],
  };
  const paths = candidates[name] || [];
  for (const p of paths) {
    try { if (fs.statSync(p).isFile()) return p; } catch { }
  }
  return name;
}

const EDITOR_PATH = resolveEditor(EDITOR);
const REGISTRY_DIR = path.join(DOCS_DIR, ".honoka");
const REGISTRY_FILE = path.join(REGISTRY_DIR, "registry.json");
const HISTORY_FILE = path.join(REGISTRY_DIR, "history.v1.jsonl");

fs.mkdirSync(DOCS_DIR, { recursive: true });
fs.mkdirSync(INBOX_DIR, { recursive: true });
fs.mkdirSync(REGISTRY_DIR, { recursive: true });

function readRegistry() {
  try { return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8")); }
  catch { return {}; }
}

function writeRegistry(reg) {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2));
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 80) || "untitled";
}

// Resolve folder name for a Notion page save.
// Reuses existing folder if pageId is already in registry.
function resolveFolder(pageId, title, url, baseDir = DOCS_DIR) {
  const reg = readRegistry();
  // If this page was saved before, reuse its folder
  if (pageId && reg[pageId]) return reg[pageId].folder;

  // Try the title first (preserve case, just sanitize for filesystem)
  const clean = sanitizeFolderName(title || "");
  if (clean) return dedup(clean, baseDir);

  // Try extracting a readable name from the Notion URL slug
  if (url) {
    const urlMatch = url.match(/notion\.so\/(?:[^/]+\/)?([A-Za-z][\w-]+)-[a-f0-9]{32}/);
    if (urlMatch) {
      const fromUrl = urlMatch[1].replace(/-/g, " ");
      return dedup(sanitizeFolderName(fromUrl) || `page-${pageId?.substring(0, 12) || Date.now().toString(36)}`, baseDir);
    }
  }

  // Fallback to page ID
  if (pageId) return `page-${pageId.substring(0, 12)}`;
  return `doc-${Date.now().toString(36)}`;
}

// Filesystem-safe folder name that preserves case and unicode letters
function sanitizeFolderName(name) {
  return name
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\ufe0f]/gu, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 80) || "";
}

// If folder already exists on disk, append a suffix
function dedup(name, baseDir) {
  let candidate = name;
  let i = 2;
  while (fs.existsSync(path.join(baseDir, candidate))) {
    candidate = `${name} (${i++})`;
  }
  return candidate;
}

function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = url.startsWith("https") ? https.get : http.get;
    get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadImage(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        fs.unlinkSync(dest);
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", (err) => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}


function execPromise(cmd, opts) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, data) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ── Shared save-to-disk pipeline (used by HTTP /save AND Telegram bot) ──

async function saveToDisk(data) {
  const { pageId, title, markdown, html, images, properties, url, source: srcOverride, category: catOverride } = data;

  if (!title && !pageId) throw new Error("title or pageId required");

  const source = srcOverride || (pageId ? "notion" : "clip");
  const baseDir = (source === "clip" || source === "telegram") ? INBOX_DIR : DOCS_DIR;

  const slug = resolveFolder(pageId, title, url, baseDir);
  const docDir = path.join(baseDir, slug);
  const imgDir = path.join(docDir, "images");
  fs.mkdirSync(imgDir, { recursive: true });

  let md = markdown || "";

  if (html && !md) {
    try {
      const TurndownService = require("turndown");
      const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
      md = td.turndown(html);
    } catch (e) {
      console.error("Turndown failed:", e);
      md = html;
    }
  }

  // Save images
  if (images && images.length > 0) {
    for (const img of images) {
      const filename = img.filename || `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`;
      const dest = path.join(imgDir, filename);
      let saved = false;

      if (img.dataUrl && img.dataUrl.startsWith("data:")) {
        try {
          const base64Data = img.dataUrl.split(",")[1];
          if (base64Data) { fs.writeFileSync(dest, Buffer.from(base64Data, "base64")); saved = true; }
        } catch (err) { console.error(`Failed to write base64 for ${filename}: ${err.message}`); }
      }

      if (!saved && img.url && (img.url.startsWith("http://") || img.url.startsWith("https://"))) {
        try { await downloadImage(img.url, dest); saved = true; }
        catch (err) { console.error(`Failed to download ${img.url}: ${err.message}`); }
      }

      if (saved) {
        const originalRef = img.originalSrc || img.url;
        if (originalRef) md = md.split(originalRef).join(`./images/${filename}`);
      }
    }
  }

  // Resolve best title for frontmatter
  let bestTitle = sanitizeFolderName(title || "") || null;
  if (!bestTitle && url) {
    const m = url.match(/notion\.so\/(?:[^/]+\/)?([A-Za-z][\w-]+)-[a-f0-9]{32}/);
    if (m) bestTitle = m[1].replace(/-/g, " ");
  }
  if (!bestTitle) bestTitle = title || "Untitled";

  const category = catOverride || "reference";
  if (!md.startsWith("---")) {
    const fm = [
      "---",
      `title: "${bestTitle.replace(/"/g, '\\"')}"`,
      `source: ${source}`,
      `category: ${category}`,
      pageId ? `page_id: "${pageId}"` : null,
      url ? `url: "${url}"` : null,
      `saved_at: "${new Date().toISOString()}"`,
      properties ? `properties:` : null,
    ].filter(Boolean);
    if (properties) {
      for (const [k, v] of Object.entries(properties)) {
        fm.push(`  ${k}: "${String(v).replace(/"/g, '\\"')}"`);
      }
    }
    fm.push("---", "", md);
    md = fm.join("\n");
  }

  const reg = readRegistry();
  reg[pageId || slug] = {
    folder: slug,
    title: bestTitle,
    category,
    notionUrl: url || null,
    savedAt: new Date().toISOString(),
    lastSynced: new Date().toISOString(),
  };
  writeRegistry(reg);

  // Save content
  fs.writeFileSync(path.join(docDir, "index.md"), md, "utf8");
  if (html) {
    fs.writeFileSync(path.join(docDir, "source.html"), html, "utf8");
  }

  return { ok: true, slug, folder: slug, path: docDir };
}

// ── Handlers ──

async function handleSave(req, res) {
  const body = await readBody(req);
  try {
    const result = await saveToDisk(body);
    json(res, 200, { ok: true, ...result });
  } catch (err) {
    json(res, 400, { error: err.message });
  }
}

async function handleNew(req, res) {
  const body = await readBody(req);
  const { title, template, openInEditor } = body;

  if (!title) return json(res, 400, { error: "title required" });

  const slug = slugify(title);
  const docDir = path.join(DOCS_DIR, slug);
  fs.mkdirSync(path.join(docDir, "images"), { recursive: true });

  const now = new Date().toISOString();
  let md = [
    "---",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `category: mine`,
    `created: "${now}"`,
    `status: draft`,
    "---",
    "",
    `# ${title}`,
    "",
  ];

  if (template === "design-doc") {
    md.push(
      "## Background", "", "",
      "## Problem Statement", "", "",
      "## Proposed Solution", "", "",
      "## Alternatives Considered", "", "",
      "## Implementation Plan", "", "",
      "## Open Questions", "", "",
    );
  } else {
    md.push("");
  }

  const filePath = path.join(docDir, "index.md");
  fs.writeFileSync(filePath, md.join("\n"), "utf8");

  // Update registry
  const reg = readRegistry();
  reg[slug] = {
    folder: slug,
    title,
    notionUrl: null,
    savedAt: now,
    lastSynced: now,
  };
  writeRegistry(reg);

  // Open in editor
  const editorBin = resolveEditor(openInEditor || EDITOR);
  try {
    execFile(editorBin, [filePath], { detached: true, stdio: "ignore" }).unref();
  } catch (err) {
    console.error(`Could not open ${editorBin}: ${err.message}`);
  }

  json(res, 200, { ok: true, folder: slug, path: filePath });
}

async function handleOpen(req, res) {
  const body = await readBody(req);
  const { folder, file } = body;

  const baseDir = (folder && fs.existsSync(path.join(INBOX_DIR, folder))) ? INBOX_DIR : DOCS_DIR;
  const target = folder
    ? (file ? path.join(baseDir, folder, file) : path.join(baseDir, folder))
    : baseDir;

  const editorBin = resolveEditor(body.editor || EDITOR);
  try {
    execFile(editorBin, [target], { detached: true, stdio: "ignore" }).unref();
    json(res, 200, { ok: true, opened: target, editor: editorBin });
  } catch (err) {
    json(res, 500, { error: `Could not open ${editorBin}: ${err.message}` });
  }
}

async function handleDelete(req, res) {
  const body = await readBody(req);
  const { folder } = body;
  if (!folder) return json(res, 400, { error: "folder required" });

  // Prevent path traversal
  if (folder.includes("..") || folder.includes("/")) {
    return json(res, 400, { error: "invalid folder name" });
  }

  const baseDir = (folder && fs.existsSync(path.join(INBOX_DIR, folder))) ? INBOX_DIR : DOCS_DIR;
  const docDir = path.join(baseDir, folder);
  if (!fs.existsSync(docDir)) return json(res, 404, { error: "folder not found" });

  // Remove folder and contents
  fs.rmSync(docDir, { recursive: true, force: true });

  // Remove from registry
  const reg = readRegistry();
  for (const [key, val] of Object.entries(reg)) {
    if (val.folder === folder) delete reg[key];
  }
  writeRegistry(reg);

  json(res, 200, { ok: true, deleted: folder });
}

async function handleSetCategory(req, res) {
  const body = await readBody(req);
  const { folder, category } = body;
  if (!folder || !category) return json(res, 400, { error: "folder and category required" });
  if (folder.includes("..") || folder.includes("/")) return json(res, 400, { error: "invalid folder" });
  if (category !== "mine" && category !== "reference") return json(res, 400, { error: "category must be 'mine' or 'reference'" });

  const indexPath = path.join(DOCS_DIR, folder, "index.md");
  if (!fs.existsSync(indexPath)) return json(res, 404, { error: "not found" });

  let content = fs.readFileSync(indexPath, "utf8");
  if (content.match(/^category:\s*.+$/m)) {
    content = content.replace(/^category:\s*.+$/m, `category: ${category}`);
  } else if (content.startsWith("---")) {
    content = content.replace(/^---\n/, `---\ncategory: ${category}\n`);
  }
  fs.writeFileSync(indexPath, content, "utf8");

  const reg = readRegistry();
  for (const val of Object.values(reg)) {
    if (val.folder === folder) val.category = category;
  }
  writeRegistry(reg);

  json(res, 200, { ok: true, folder, category });
}

function handleBackup(req, res) {
  const reg = readRegistry();
  const docs = [];
  try {
    const entries = fs.readdirSync(DOCS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const indexPath = path.join(DOCS_DIR, entry.name, "index.md");
      if (!fs.existsSync(indexPath)) continue;
      const content = fs.readFileSync(indexPath, "utf8");
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      docs.push({ folder: entry.name, frontmatter: fmMatch ? fmMatch[1] : null });
    }
  } catch { }
  json(res, 200, {
    ok: true,
    docs_dir: DOCS_DIR,
    registry: reg,
    docs,
    exported_at: new Date().toISOString(),
  });
}

async function handleRestoreRegistry(req, res) {
  const body = await parseBody(req);
  if (!body.registry || typeof body.registry !== "object") {
    return json(res, 400, { error: "registry object required" });
  }
  const current = readRegistry();
  const merged = { ...current, ...body.registry };
  writeRegistry(merged);
  json(res, 200, { ok: true, count: Object.keys(merged).length });
}

function handleTemplatesGet(req, res) {
  const reg = readRegistry();
  const templates = [];
  for (const [key, val] of Object.entries(reg)) {
    if (!val.isTemplate) continue;
    templates.push({
      folder: val.folder,
      title: val.title || val.folder,
      label: val.templateLabel || val.title || val.folder,
      config: val.templateConfig || {},
    });
  }
  json(res, 200, { templates });
}

async function handleTemplatesPost(req, res) {
  const body = await readBody(req);
  const { folder, label, config } = body;
  if (!folder) return json(res, 400, { error: "folder required" });

  const reg = readRegistry();
  const entry = Object.values(reg).find(v => v.folder === folder);
  if (!entry) return json(res, 404, { error: "folder not in registry" });

  entry.isTemplate = true;
  if (label) entry.templateLabel = label;
  if (config && typeof config === "object") entry.templateConfig = config;
  writeRegistry(reg);
  json(res, 200, { ok: true, folder });
}

async function handleTemplatesDelete(req, res) {
  const body = await readBody(req);
  const { folder } = body;
  if (!folder) return json(res, 400, { error: "folder required" });

  const reg = readRegistry();
  const entry = Object.values(reg).find(v => v.folder === folder);
  if (!entry) return json(res, 404, { error: "folder not in registry" });

  delete entry.isTemplate;
  delete entry.templateLabel;
  delete entry.templateConfig;
  writeRegistry(reg);
  json(res, 200, { ok: true, folder });
}

function scanDirectory(baseDir, reg, results) {
  if (!fs.existsSync(baseDir)) return;
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const indexPath = path.join(baseDir, entry.name, "index.md");
    if (!fs.existsSync(indexPath)) continue;

    const stat = fs.statSync(indexPath);
    const content = fs.readFileSync(indexPath, "utf8");
    const titleMatch = content.match(/^title:\s*"?(.+?)"?\s*$/m);
    const regEntry = Object.values(reg).find((r) => r.folder === entry.name);

    const imgDir = path.join(baseDir, entry.name, "images");
    let imageCount = 0;
    try { imageCount = fs.readdirSync(imgDir).length; } catch { }
    const rawMermaid = (content.match(/```mermaid/g) || []).length;
    const renderedMermaid = new Set((content.match(/#mermaid-[a-f0-9-]+/g) || [])).size;
    const mermaidCount = rawMermaid + renderedMermaid;

    const rawPlantUML = (content.match(/```plantuml|@startuml|@startmindmap|@startgantt|@startsalt|@startwbs/g) || []).length;
    const drawioXml = (content.match(/mxGraphModel/g) || []).length;
    const drawioImg = (content.match(/!\[.*?(drawio|diagrams\.net).*?\]/gi) || []).length;
    const drawioCount = drawioXml || drawioImg;

    const categoryMatch = content.match(/^category:\s*(.+?)\s*$/m);
    const category = categoryMatch ? categoryMatch[1] : regEntry?.category || "reference";
    const sourceMatch = content.match(/^source:\s*(.+?)\s*$/m);

    results.push({
      folder: entry.name,
      baseDir: baseDir === INBOX_DIR ? "inbox" : "docs",
      title: titleMatch ? titleMatch[1] : regEntry?.title || entry.name,
      category,
      source: sourceMatch ? sourceMatch[1] : (regEntry?.notionUrl ? "notion" : "clip"),
      pageId: Object.keys(reg).find((k) => reg[k].folder === entry.name) || null,
      notionUrl: regEntry?.notionUrl || null,
      savedAt: regEntry?.savedAt || stat.birthtime.toISOString(),
      lastModified: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      imageCount,
      mermaidCount,
      plantumlCount: rawPlantUML,
      drawioCount,
      isTemplate: !!regEntry?.isTemplate,
      templateLabel: regEntry?.templateLabel || null,
    });
  }
}

function handleList(req, res) {
  const reg = readRegistry();
  const docs = [];

  try {
    scanDirectory(DOCS_DIR, reg, docs);
    scanDirectory(INBOX_DIR, reg, docs);
  } catch (err) {
    return json(res, 500, { error: err.message });
  }

  docs.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  json(res, 200, { docs, docsDir: DOCS_DIR, inboxDir: INBOX_DIR, count: docs.length });
}

function handlePreview(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const folder = url.searchParams.get("folder");
  if (!folder || folder.includes("..") || folder.includes("/")) {
    return json(res, 400, { error: "invalid folder" });
  }

  const baseDir = (folder && fs.existsSync(path.join(INBOX_DIR, folder))) ? INBOX_DIR : DOCS_DIR;
  const indexPath = path.join(baseDir, folder, "index.md");
  const htmlPath = path.join(baseDir, folder, "source.html");
  if (!fs.existsSync(indexPath)) return json(res, 404, { error: "not found" });

  const raw = fs.readFileSync(indexPath, "utf8");
  let isTelegram = false;
  if (raw.startsWith("---")) {
    const end = raw.indexOf("---", 3);
    if (end !== -1) {
      const fm = raw.substring(0, end);
      if (fm.includes("source: telegram")) isTelegram = true;
    }
  }

  const hasHtml = fs.existsSync(htmlPath);
  const defaultFormat = (isTelegram && hasHtml) ? "html" : "md";

  cors(res);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Honoka Preview</title>
  <style>
    body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f0f2f5; }
    iframe { width: 100%; height: 100%; border: none; }
    .toggle-bar {
      position: absolute; top: 16px; right: 24px;
      background: rgba(255, 255, 255, 0.7);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(0,0,0,0.1);
      border-radius: 8px; padding: 4px;
      display: flex; gap: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      z-index: 9999;
    }
    .toggle-btn {
      background: transparent; border: none; padding: 6px 12px; border-radius: 6px;
      font-size: 13px; font-weight: 500; color: #555; cursor: pointer; transition: all 0.2s;
    }
    .toggle-btn:hover { background: rgba(0,0,0,0.05); color: #000; }
    .toggle-btn.active { background: #fff; color: #0969da; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .toggle-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="toggle-bar">
    <button id="btn-html" class="toggle-btn ${defaultFormat === 'html' ? 'active' : ''}" ${!hasHtml ? 'disabled title="Original HTML not available"' : ''}>🌐 Original Web</button>
    <button id="btn-md" class="toggle-btn ${defaultFormat === 'md' ? 'active' : ''}">📝 Markdown</button>
  </div>
  <iframe id="preview-frame" sandbox="allow-same-origin allow-scripts allow-popups" src="/preview-content?folder=${encodeURIComponent(folder)}&format=${defaultFormat}"></iframe>

  <script>
    const frame = document.getElementById('preview-frame');
    const btnHtml = document.getElementById('btn-html');
    const btnMd = document.getElementById('btn-md');
    
    btnHtml.addEventListener('click', () => {
      if (btnHtml.disabled) return;
      btnHtml.classList.add('active');
      btnMd.classList.remove('active');
      frame.src = '/preview-content?folder=${encodeURIComponent(folder)}&format=html';
    });
    
    btnMd.addEventListener('click', () => {
      btnMd.classList.add('active');
      btnHtml.classList.remove('active');
      frame.src = '/preview-content?folder=${encodeURIComponent(folder)}&format=md';
    });
  </script>
</body>
</html>
  `);
}

function handlePreviewContent(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const folder = url.searchParams.get("folder");
  const format = url.searchParams.get("format") || "md";
  if (!folder || folder.includes("..") || folder.includes("/")) {
    return json(res, 400, { error: "invalid folder" });
  }

  const baseDir = (folder && fs.existsSync(path.join(INBOX_DIR, folder))) ? INBOX_DIR : DOCS_DIR;
  
  if (format === "html") {
    const htmlPath = path.join(baseDir, folder, "source.html");
    if (!fs.existsSync(htmlPath)) return json(res, 404, { error: "html not found" });
    cors(res);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(htmlPath, "utf8"));
    return;
  }

  const indexPath = path.join(baseDir, folder, "index.md");
  if (!fs.existsSync(indexPath)) return json(res, 404, { error: "not found" });

  const raw = fs.readFileSync(indexPath, "utf8");

  // Strip frontmatter
  let md = raw;
  if (md.startsWith("---")) {
    const end = md.indexOf("---", 3);
    if (end !== -1) md = md.substring(end + 3).trim();
  }

  // Minimal markdown → HTML
  const html = renderMarkdown(md, folder);

  cors(res);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function renderMarkdown(md, folder) {
  const lines = md.split("\n");
  const out = [];
  let inCode = false;
  let codeLang = "";
  let codeLines = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code blocks
    if (line.startsWith("```")) {
      if (inCode) {
        out.push(`<pre><code class="lang-${escHtml(codeLang)}">${escHtml(codeLines.join("\n"))}</code></pre>`);
        inCode = false;
        codeLines = [];
        codeLang = "";
      } else {
        if (inList) { out.push("</ul>"); inList = false; }
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    // Empty line
    if (line.trim() === "") {
      if (inList) { out.push("</ul>"); inList = false; }
      continue;
    }

    // Headings
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      if (inList) { out.push("</ul>"); inList = false; }
      const level = hMatch[1].length;
      out.push(`<h${level}>${inlineFormat(hMatch[2], folder)}</h${level}>`);
      continue;
    }

    // HR
    if (/^[-*_]{3,}\s*$/.test(line)) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push("<hr>");
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<blockquote>${inlineFormat(line.slice(2), folder)}</blockquote>`);
      continue;
    }

    // Unordered list
    const liMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (liMatch) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inlineFormat(liMatch[2], folder)}</li>`);
      continue;
    }

    // Paragraph
    if (inList) { out.push("</ul>"); inList = false; }
    out.push(`<p>${inlineFormat(line, folder)}</p>`);
  }

  if (inCode) {
    out.push(`<pre><code class="lang-${escHtml(codeLang)}">${escHtml(codeLines.join("\n"))}</code></pre>`);
  }
  if (inList) out.push("</ul>");

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:780px;margin:0 auto;padding:24px 32px;color:#24292f;line-height:1.6;background:#fff}
h1,h2,h3,h4,h5,h6{margin:1.2em 0 0.4em;padding-bottom:0.3em;border-bottom:1px solid #d1d9e0}
h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.25em;border-bottom:none}
h4,h5,h6{border-bottom:none}
p{margin:0.5em 0}
img{max-width:100%;border-radius:6px;border:1px solid #d1d9e0;margin:8px 0}
a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}
code{background:#eff1f3;padding:2px 6px;border-radius:4px;font-size:0.9em;font-family:"SF Mono",Menlo,monospace}
pre{background:#f6f8fa;border:1px solid #d1d9e0;border-radius:6px;padding:16px;overflow-x:auto;margin:1em 0}
pre code{background:none;padding:0;font-size:0.85em}
blockquote{border-left:4px solid #d1d9e0;padding:4px 16px;margin:0.5em 0;color:#656d76}
ul{padding-left:2em;margin:0.5em 0}
li{margin:0.25em 0}
hr{border:none;border-top:1px solid #d1d9e0;margin:1.5em 0}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid #d1d9e0;padding:6px 13px;text-align:left}
th{background:#f6f8fa;font-weight:600}
</style></head><body>${out.join("\n")}</body></html>`;
}

function inlineFormat(text, folder) {
  // Extract images first, replace with indexed placeholders
  const imgTags = [];
  let s = text;
  // ![alt](<path with spaces>)
  s = s.replace(/!\[([^\]]*)\]\(<([^>]+)>\)/g, (_, alt, src) => {
    imgTags.push(buildImgTag(alt, src, folder));
    return `%%IMG${imgTags.length - 1}%%`;
  });
  // ![alt](path)
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    imgTags.push(buildImgTag(alt, src, folder));
    return `%%IMG${imgTags.length - 1}%%`;
  });

  // Escape HTML on the remaining text
  s = escHtml(s);

  // Restore image tags
  s = s.replace(/%%IMG(\d+)%%/g, (_, idx) => imgTags[parseInt(idx)]);

  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Inline code
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

function buildImgTag(alt, src, folder) {
  const resolvedSrc = src.startsWith("./") || src.startsWith("images/")
    ? `http://127.0.0.1:${PORT}/files/${folder}/${src.replace(/^\.\//, "")}`
    : src;
  return `<img src="${encodeURI(resolvedSrc)}" alt="${escHtml(alt)}">`;
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Diff engine (Myers algorithm, line-level) ──────────────────────

function diffLines(oldLines, newLines) {
  const N = oldLines.length;
  const M = newLines.length;
  const MAX = N + M;
  const V = new Array(2 * MAX + 1);
  V[MAX + 1] = 0;
  const trace = [];

  for (let d = 0; d <= MAX; d++) {
    const snap = V.slice();
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && V[MAX + k - 1] < V[MAX + k + 1])) {
        x = V[MAX + k + 1];
      } else {
        x = V[MAX + k - 1] + 1;
      }
      let y = x - k;
      while (x < N && y < M && oldLines[x] === newLines[y]) { x++; y++; }
      V[MAX + k] = x;
      if (x >= N && y >= M) {
        trace.push(snap);
        return buildEdits(trace, oldLines, newLines, MAX);
      }
    }
    trace.push(V.slice());
  }
  return buildEdits(trace, oldLines, newLines, MAX);
}

function buildEdits(trace, oldLines, newLines, MAX) {
  const edits = [];
  let x = oldLines.length;
  let y = newLines.length;

  for (let d = trace.length - 1; d >= 0; d--) {
    const V = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && V[MAX + k - 1] < V[MAX + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = V[MAX + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--; y--;
      edits.unshift({ type: "equal", oldIdx: x, newIdx: y });
    }
    if (d > 0) {
      if (x === prevX) {
        edits.unshift({ type: "insert", newIdx: prevY });
        y = prevY;
      } else {
        edits.unshift({ type: "delete", oldIdx: prevX });
        x = prevX;
      }
    }
  }
  return edits;
}

function handleDiff(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const folder = url.searchParams.get("folder");
  const folder2 = url.searchParams.get("folder2");

  function validateFolder(f) {
    return f && !f.includes("..") && !f.includes("/");
  }

  if (!validateFolder(folder)) return json(res, 400, { error: "invalid folder" });

  // Cross-document comparison: folder (left) vs folder2 (right)
  const crossCompare = folder2 && validateFolder(folder2);

  let leftPath, rightPath;
  if (crossCompare) {
    leftPath = path.join(DOCS_DIR, folder, "index.md");
    rightPath = path.join(DOCS_DIR, folder2, "index.md");
    if (!fs.existsSync(leftPath)) return json(res, 404, { error: `${folder}/index.md not found` });
    if (!fs.existsSync(rightPath)) return json(res, 404, { error: `${folder2}/index.md not found` });
  } else {
    rightPath = path.join(DOCS_DIR, folder, "index.md");
    leftPath = path.join(DOCS_DIR, folder, "index.prev.md");
    if (!fs.existsSync(rightPath)) return json(res, 404, { error: "index.md not found" });
    if (!fs.existsSync(leftPath)) return json(res, 404, { error: "No previous version. Save the page again after making changes." });
  }

  const leftRaw = fs.readFileSync(leftPath, "utf8");
  const rightRaw = fs.readFileSync(rightPath, "utf8");

  const oldLines = stripFM(leftRaw).split("\n");
  const newLines = stripFM(rightRaw).split("\n");
  const edits = diffLines(oldLines, newLines);

  const leftDate = leftRaw.match(/saved_at:\s*"([^"]+)"/)?.[1] || fs.statSync(leftPath).mtime.toISOString();
  const rightDate = rightRaw.match(/saved_at:\s*"([^"]+)"/)?.[1] || fs.statSync(rightPath).mtime.toISOString();
  const leftTitle = leftRaw.match(/title:\s*"([^"]+)"/)?.[1] || folder;
  const rightTitle = rightRaw.match(/title:\s*"([^"]+)"/)?.[1] || (crossCompare ? folder2 : folder);

  const pageTitle = crossCompare
    ? `${leftTitle}  vs  ${rightTitle}`
    : leftTitle;
  const subtitle = crossCompare
    ? "Comparing two documents"
    : "Comparing previous save → current save";

  const leftRows = [];
  const rightRows = [];
  let stats = { added: 0, removed: 0, unchanged: 0 };

  function headingLevel(rawLine) {
    const m = rawLine.match(/^(#{1,6})\s/);
    return m ? m[1].length : 0;
  }

  for (const edit of edits) {
    if (edit.type === "equal") {
      const raw = oldLines[edit.oldIdx];
      const h = headingLevel(raw);
      const hAttr = h ? ` data-h="${h}"` : "";
      const line = escHtml(raw);
      leftRows.push(`<tr class="ctx"${hAttr}><td class="ln">${edit.oldIdx + 1}</td><td class="code">${line || "&nbsp;"}</td></tr>`);
      rightRows.push(`<tr class="ctx"${hAttr}><td class="ln">${edit.newIdx + 1}</td><td class="code">${line || "&nbsp;"}</td></tr>`);
      stats.unchanged++;
    } else if (edit.type === "delete") {
      const raw = oldLines[edit.oldIdx];
      const h = headingLevel(raw);
      const hAttr = h ? ` data-h="${h}"` : "";
      const line = escHtml(raw);
      leftRows.push(`<tr class="del"${hAttr}><td class="ln">${edit.oldIdx + 1}</td><td class="code">${line || "&nbsp;"}</td></tr>`);
      rightRows.push(`<tr class="empty"${hAttr}><td class="ln"></td><td class="code">&nbsp;</td></tr>`);
      stats.removed++;
    } else if (edit.type === "insert") {
      const raw = newLines[edit.newIdx];
      const h = headingLevel(raw);
      const hAttr = h ? ` data-h="${h}"` : "";
      const line = escHtml(raw);
      leftRows.push(`<tr class="empty"${hAttr}><td class="ln"></td><td class="code">&nbsp;</td></tr>`);
      rightRows.push(`<tr class="add"${hAttr}><td class="ln">${edit.newIdx + 1}</td><td class="code">${line || "&nbsp;"}</td></tr>`);
      stats.added++;
    }
  }

  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return iso; }
  };

  const leftLabel = crossCompare
    ? `${escHtml(leftTitle)} — ${fmtDate(leftDate)}`
    : `Previous — ${fmtDate(leftDate)}`;
  const rightLabel = crossCompare
    ? `${escHtml(rightTitle)} — ${fmtDate(rightDate)}`
    : `Current — ${fmtDate(rightDate)}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Diff — ${escHtml(pageTitle)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#1a1a2e;color:#e0e0e0}
.header{background:#16213e;padding:16px 24px;border-bottom:1px solid #0f3460}
.header-top{display:flex;align-items:center;justify-content:space-between}
.header h1{font-size:16px;font-weight:600;color:#e0e0e0}
.header .meta{font-size:12px;color:#8892b0;margin-top:4px}
.stats-row{display:flex;gap:16px;margin-top:8px;font-size:12px;align-items:center;flex-wrap:wrap}
.stats-row .added{color:#4ade80}.stats-row .removed{color:#f87171}.stats-row .unchanged{color:#8892b0}
.stats-row .sep{color:#4a5568;margin:0 4px}
.section-ctrl{display:flex;align-items:center;gap:8px}
.section-ctrl label{font-size:12px;color:#8892b0}
.section-ctrl select{background:#0f3460;color:#e0e0e0;border:1px solid #1a365d;border-radius:4px;padding:3px 8px;font-size:12px;cursor:pointer}
.section-ctrl select:hover{border-color:#4a90d9}
.section-stats{font-size:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.section-stats .s-found{color:#4ade80}.section-stats .s-fuzzy{color:#60a5fa}.section-stats .s-miss{color:#f87171}
.section-stats .pct{font-size:11px;padding:1px 6px;border-radius:3px;margin-left:2px;font-weight:600}
.section-stats .pct-high{background:rgba(74,222,128,0.2);color:#86efac}
.section-stats .pct-mid{background:rgba(251,191,36,0.2);color:#fbbf24}
.section-stats .pct-low{background:rgba(248,113,113,0.2);color:#fca5a5}
.section-stats .sep{color:#4a5568;margin:0 2px}
.section-detail{margin-top:6px;font-size:11px;max-height:0;overflow:hidden;transition:max-height 0.3s ease}
.section-detail.open{max-height:400px;overflow-y:auto}
.section-detail ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:4px 16px}
.section-detail li{padding:1px 0}
.section-detail .h-miss{color:#fca5a5}.section-detail .h-fuzzy{color:#93c5fd}.section-detail .h-exact{color:#86efac}.section-detail .h-match-info{color:#6b7280;font-size:10px;margin-left:6px}
.struct-row{display:flex;gap:14px;margin-top:6px;font-size:12px;align-items:center;flex-wrap:wrap}
.struct-item{display:flex;align-items:center;gap:4px}
.struct-label{color:#8892b0;font-weight:500}
.struct-arrow{color:#4a5568}
.struct-match{color:#4ade80}.struct-grow{color:#60a5fa}.struct-shrink{color:#fbbf24}.struct-gone{color:#f87171}
.struct-score{font-size:11px;padding:2px 8px;border-radius:3px;font-weight:600;margin-left:4px}
.struct-score-high{background:rgba(74,222,128,0.2);color:#86efac}
.struct-score-mid{background:rgba(251,191,36,0.2);color:#fbbf24}
.struct-score-low{background:rgba(248,113,113,0.2);color:#fca5a5}
.section-toggle{background:none;border:1px solid #1a365d;color:#8892b0;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer}
.section-toggle:hover{border-color:#4a90d9;color:#e0e0e0}
.diff-wrap{display:flex;height:calc(100vh - 140px);overflow:hidden}
.diff-pane{flex:1;overflow:auto;border-right:1px solid #0f3460}
.diff-pane:last-child{border-right:none}
.pane-header{position:sticky;top:0;background:#16213e;padding:6px 12px;font-size:11px;color:#8892b0;border-bottom:1px solid #0f3460;z-index:1}
table{width:100%;border-collapse:collapse;font-family:"SF Mono",Menlo,Consolas,monospace;font-size:12px;line-height:1.5}
tr.ctx td.code{color:#c9d1d9}
tr.del{background:rgba(248,113,113,0.12)}
tr.del td.code{color:#fca5a5}
tr.add{background:rgba(74,222,128,0.12)}
tr.add td.code{color:#86efac}
tr.empty{background:rgba(255,255,255,0.02)}
tr.empty td.code{color:transparent}
td.ln{width:40px;padding:0 8px;text-align:right;color:#4a5568;font-size:11px;user-select:none;border-right:1px solid #0f3460}
td.code{padding:0 12px;white-space:pre-wrap;word-break:break-word}
tr[data-h] td.code{font-weight:600}
.sections-only-wrap{display:none;height:calc(100vh - 140px);overflow:auto;padding:16px 24px}
.sections-only-wrap.active{display:block}
.diff-wrap.hidden-by-sections{display:none}
.so-table{width:100%;border-collapse:collapse;font-family:"SF Mono",Menlo,Consolas,monospace;font-size:13px;line-height:1.8}
.so-table th{text-align:left;font-size:11px;color:#8892b0;padding:4px 12px;border-bottom:1px solid #0f3460;font-weight:500}
.so-table td{padding:6px 12px;border-bottom:1px solid rgba(15,52,96,0.4);vertical-align:top}
.so-table .so-num{width:30px;color:#4a5568;text-align:right;font-size:11px}
.so-table .so-left{width:45%}
.so-table .so-arrow{width:40px;text-align:center;color:#4a5568;font-size:11px}
.so-table .so-right{width:45%}
.so-row-exact .so-left,.so-row-exact .so-right{color:#86efac}
.so-row-fuzzy .so-left{color:#93c5fd}.so-row-fuzzy .so-right{color:#93c5fd}
.so-row-missing .so-left{color:#fca5a5}.so-row-missing .so-right{color:#4a5568;font-style:italic}
.so-row-extra .so-right{color:#8892b0;font-style:italic}
.so-method{font-size:10px;color:#6b7280;margin-left:6px}
.so-summary{margin-top:16px;font-size:13px;display:flex;gap:20px;flex-wrap:wrap}
.so-summary .so-s-exact{color:#86efac}.so-summary .so-s-fuzzy{color:#93c5fd}.so-summary .so-s-miss{color:#fca5a5}
.so-summary .so-pct{font-size:12px;padding:2px 8px;border-radius:4px;font-weight:700;margin-left:4px}
.so-pct-high{background:rgba(74,222,128,0.2);color:#86efac}
.so-pct-mid{background:rgba(251,191,36,0.2);color:#fbbf24}
.so-pct-low{background:rgba(248,113,113,0.2);color:#fca5a5}
</style></head>
<body>
<div class="header">
  <div class="header-top">
    <div>
      <h1>${escHtml(pageTitle)}</h1>
      <div class="meta">${subtitle}</div>
    </div>
    <div class="section-ctrl">
      <label for="h-level">Section depth:</label>
      <select id="h-level">
        <option value="1">H1 only</option>
        <option value="2" selected>H1 – H2</option>
        <option value="3">H1 – H3</option>
        <option value="4">H1 – H4</option>
      </select>
      <div class="section-stats" id="section-stats"></div>
      <button class="section-toggle" id="section-toggle" title="Show/hide section names">Details</button>
      <button class="section-toggle" id="sections-only-btn" title="Toggle sections-only view">Sections only</button>
    </div>
  </div>
  <div class="stats-row">
    <span class="added">+${stats.added} lines added</span>
    <span class="removed">&minus;${stats.removed} lines removed</span>
    <span class="unchanged">${stats.unchanged} unchanged</span>
  </div>
  <div class="struct-row" id="struct-row"></div>
  <div class="section-detail" id="section-detail"></div>
</div>
<div class="diff-wrap">
  <div class="diff-pane" id="left-pane">
    <div class="pane-header">${leftLabel}</div>
    <table id="left-table">${leftRows.join("\n")}</table>
  </div>
  <div class="diff-pane" id="right-pane">
    <div class="pane-header">${rightLabel}</div>
    <table id="right-table">${rightRows.join("\n")}</table>
  </div>
</div>
<div class="sections-only-wrap" id="sections-only-wrap"></div>
<script>
// Sync scroll
const panes = document.querySelectorAll('.diff-pane');
let syncing = false;
panes.forEach((pane, i) => {
  pane.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    panes[1 - i].scrollTop = pane.scrollTop;
    syncing = false;
  });
});

// Section analysis — template-centric set-difference with fuzzy matching
const leftTable = document.getElementById('left-table');
const rightTable = document.getElementById('right-table');
const hSelect = document.getElementById('h-level');
const statsEl = document.getElementById('section-stats');
const structEl = document.getElementById('struct-row');
const detailEl = document.getElementById('section-detail');
const toggleBtn = document.getElementById('section-toggle');

function rawTextOf(tr) {
  const code = tr.querySelector('td.code');
  return code ? code.textContent.trim() : '';
}

function headingTextOf(tr) {
  return rawTextOf(tr).replace(/^#+\\s*/, '');
}

// Normalize: strip markdown formatting, lowercase, collapse whitespace
function norm(text) {
  let s = text;
  s = s.replace(/^\\*+|\\*+$/g, '');
  s = s.replace(/^_+|_+$/g, '');
  s = s.replace(/\\s+/g, ' ').trim();
  return s.toLowerCase();
}

// Extract Latin-script words (for bilingual headings like "背景 / Background")
function latinWords(text) {
  const matches = text.match(/[a-z][a-z0-9]*/gi);
  return matches ? matches.map(w => w.toLowerCase()) : [];
}

// Word-level Jaccard similarity
function wordJaccard(a, b) {
  const setA = new Set(a.split(/\\s+/).filter(w => w.length > 1));
  const setB = new Set(b.split(/\\s+/).filter(w => w.length > 1));
  if (setA.size === 0 && setB.size === 0) return 0;
  let inter = 0;
  setA.forEach(w => { if (setB.has(w)) inter++; });
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? inter / union : 0;
}

// Fuzzy match: returns { match: bool, method: 'exact'|'contains'|'latin'|'words', matchedTo: string }
function fuzzyMatch(templateNorm, docNorms) {
  // 1. Exact match after normalization
  for (const d of docNorms) {
    if (d.norm === templateNorm) return { match: true, method: 'exact', matchedTo: d.orig };
  }
  // 2. Containment (one contains the other)
  for (const d of docNorms) {
    if (d.norm.includes(templateNorm) || templateNorm.includes(d.norm)) {
      if (Math.min(d.norm.length, templateNorm.length) > 2) {
        return { match: true, method: 'contains', matchedTo: d.orig };
      }
    }
  }
  // 3. Latin-word extraction (for bilingual: "Background" matches "背景 / Background")
  const tLatin = latinWords(templateNorm);
  if (tLatin.length > 0) {
    for (const d of docNorms) {
      const dLatin = latinWords(d.norm);
      if (dLatin.length > 0) {
        const tSet = new Set(tLatin);
        const overlap = dLatin.filter(w => tSet.has(w)).length;
        if (overlap > 0 && overlap >= Math.min(tLatin.length, dLatin.length) * 0.5) {
          return { match: true, method: 'latin', matchedTo: d.orig };
        }
      }
    }
  }
  // 4. Word-level Jaccard similarity (threshold 0.4)
  for (const d of docNorms) {
    const j = wordJaccard(templateNorm, d.norm);
    if (j >= 0.4) return { match: true, method: 'words', matchedTo: d.orig };
  }
  return { match: false };
}

function collectHeadings(table, maxH) {
  const headings = [];
  table.querySelectorAll('tr[data-h]').forEach(tr => {
    if (tr.classList.contains('empty')) return;
    const h = parseInt(tr.dataset.h);
    if (h <= maxH) headings.push({ level: h, orig: headingTextOf(tr), norm: norm(headingTextOf(tr)) });
  });
  return headings;
}

function analyze(maxH) {
  const templateH = collectHeadings(leftTable, maxH);
  const docH = collectHeadings(rightTable, maxH);

  const exact = []; const fuzzy = []; const missing = [];
  const docUsed = new Set();

  templateH.forEach(t => {
    const exactIdx = docH.findIndex((d, di) => !docUsed.has(di) && d.norm === t.norm);
    if (exactIdx >= 0) {
      docUsed.add(exactIdx);
      exact.push({ level: t.level, name: t.orig });
      return;
    }
    const available = docH.filter((_, di) => !docUsed.has(di));
    const fm = fuzzyMatch(t.norm, available);
    if (fm.match) {
      const matchIdx = docH.findIndex((d, di) => !docUsed.has(di) && d.orig === fm.matchedTo);
      if (matchIdx >= 0) docUsed.add(matchIdx);
      fuzzy.push({ level: t.level, name: t.orig, matchedTo: fm.matchedTo, method: fm.method });
    } else {
      missing.push({ level: t.level, name: t.orig });
    }
  });

  const total = templateH.length;
  const foundCount = exact.length + fuzzy.length;
  const missingCount = missing.length;
  const coveragePct = total > 0 ? Math.round(foundCount / total * 100) : 100;
  const deletionPct = total > 0 ? Math.round(missingCount / total * 100) : 0;

  const pctCls = coveragePct >= 80 ? 'pct-high' : coveragePct >= 50 ? 'pct-mid' : 'pct-low';

  statsEl.innerHTML =
    '<span class="s-found">' + exact.length + ' exact</span>' +
    (fuzzy.length ? '<span class="s-fuzzy">' + fuzzy.length + ' fuzzy</span>' : '') +
    '<span class="s-miss">' + missingCount + '/' + total + ' missing</span>' +
    '<span class="sep">|</span>' +
    '<span>Template coverage: <span class="pct ' + pctCls + '">' + coveragePct + '%</span></span>' +
    (deletionPct > 0 ? '<span>Deletion: <span class="pct pct-low">' + deletionPct + '%</span></span>' : '');

  // Structure row — per-level breakdown
  let structHtml = '<span class="struct-label">By level:</span>';
  for (let h = 1; h <= maxH; h++) {
    const tCount = templateH.filter(x => x.level === h).length;
    const dCount = docH.filter(x => x.level === h).length;
    if (tCount === 0 && dCount === 0) continue;
    const diff = dCount - tCount;
    let cls;
    if (tCount === dCount) cls = 'struct-match';
    else if (diff > 0) cls = 'struct-grow';
    else if (dCount === 0 && tCount > 0) cls = 'struct-gone';
    else cls = 'struct-shrink';
    const arrow = diff === 0 ? '✓' : (diff > 0 ? '+' + diff : '' + diff);
    structHtml += '<span class="struct-item"><span class="struct-label">H' + h + ':</span> ' + tCount + ' <span class="struct-arrow">→</span> ' + dCount + ' <span class="' + cls + '">(' + arrow + ')</span></span>';
  }
  const scoreCls = coveragePct >= 80 ? 'struct-score-high' : coveragePct >= 50 ? 'struct-score-mid' : 'struct-score-low';
  structHtml += '<span class="struct-score ' + scoreCls + '">' + coveragePct + '% coverage</span>';
  structEl.innerHTML = structHtml;

  // Detail panel
  let detail = '';
  if (missing.length) {
    detail += '<div><strong style="color:#f87171">Missing from doc (' + missingCount + '):</strong><ul>';
    missing.forEach(s => detail += '<li class="h-miss">H' + s.level + ' ' + s.name + '</li>');
    detail += '</ul></div>';
  }
  if (fuzzy.length) {
    detail += '<div><strong style="color:#93c5fd">Fuzzy matched (' + fuzzy.length + '):</strong><ul>';
    fuzzy.forEach(s => {
      const tag = { contains: 'substring', latin: 'latin words', words: 'word overlap', exact: 'exact' }[s.method] || s.method;
      detail += '<li class="h-fuzzy">H' + s.level + ' ' + s.name + '<span class="h-match-info"> ≈ ' + s.matchedTo + ' (' + tag + ')</span></li>';
    });
    detail += '</ul></div>';
  }
  if (exact.length) {
    detail += '<div><strong style="color:#4ade80">Exact match (' + exact.length + '):</strong><ul>';
    exact.forEach(s => detail += '<li class="h-exact">H' + s.level + ' ' + s.name + '</li>');
    detail += '</ul></div>';
  }
  if (total === 0) {
    detail = '<div style="color:#6b7280;padding:4px 0">No headings found in the template at this depth level.</div>';
  }
  detailEl.innerHTML = detail;
}

hSelect.addEventListener('change', () => {
  analyze(parseInt(hSelect.value));
  if (sectionsOnlyActive) renderSectionsOnly(parseInt(hSelect.value));
});
toggleBtn.addEventListener('click', () => {
  detailEl.classList.toggle('open');
  toggleBtn.textContent = detailEl.classList.contains('open') ? 'Hide' : 'Details';
});

// Sections-only mode
const diffWrap = document.querySelector('.diff-wrap');
const soWrap = document.getElementById('sections-only-wrap');
const soBtn = document.getElementById('sections-only-btn');
let sectionsOnlyActive = false;

function renderSectionsOnly(maxH) {
  const templateH = collectHeadings(leftTable, maxH);
  const docH = collectHeadings(rightTable, maxH);
  const docUsed = new Set();

  const rows = [];
  let exactCount = 0, fuzzyCount = 0, missingCount = 0;

  templateH.forEach((t, i) => {
    const exactIdx = docH.findIndex((d, di) => !docUsed.has(di) && d.norm === t.norm);
    if (exactIdx >= 0) {
      docUsed.add(exactIdx);
      rows.push({ type: 'exact', left: t, right: docH[exactIdx], method: '' });
      exactCount++;
      return;
    }
    const fm = fuzzyMatch(t.norm, docH.filter((_, di) => !docUsed.has(di)));
    if (fm.match) {
      const matchIdx = docH.findIndex((d, di) => !docUsed.has(di) && d.orig === fm.matchedTo);
      if (matchIdx >= 0) docUsed.add(matchIdx);
      const tag = { contains: 'substring', latin: 'latin words', words: 'word overlap' }[fm.method] || fm.method;
      rows.push({ type: 'fuzzy', left: t, right: { level: t.level, orig: fm.matchedTo }, method: tag });
      fuzzyCount++;
    } else {
      rows.push({ type: 'missing', left: t, right: null, method: '' });
      missingCount++;
    }
  });

  const total = templateH.length;
  const found = exactCount + fuzzyCount;
  const coveragePct = total > 0 ? Math.round(found / total * 100) : 100;
  const deletionPct = total > 0 ? Math.round(missingCount / total * 100) : 0;
  const pctCls = coveragePct >= 80 ? 'so-pct-high' : coveragePct >= 50 ? 'so-pct-mid' : 'so-pct-low';
  const delCls = deletionPct <= 20 ? 'so-pct-high' : deletionPct <= 50 ? 'so-pct-mid' : 'so-pct-low';

  let html = '<table class="so-table"><thead><tr>';
  html += '<th class="so-num">#</th><th class="so-left">Template heading</th>';
  html += '<th class="so-arrow"></th><th class="so-right">Target doc heading</th>';
  html += '</tr></thead><tbody>';

  rows.forEach((r, i) => {
    const cls = 'so-row-' + r.type;
    const lText = 'H' + r.left.level + ' ' + r.left.orig;
    let rText = '', arrow = '', methodTag = '';
    if (r.type === 'exact') {
      rText = 'H' + r.right.level + ' ' + r.right.orig;
      arrow = '=';
    } else if (r.type === 'fuzzy') {
      rText = 'H' + r.right.level + ' ' + r.right.orig;
      arrow = '≈';
      methodTag = '<span class="so-method">(' + r.method + ')</span>';
    } else {
      rText = '— missing —';
      arrow = '✗';
    }
    html += '<tr class="' + cls + '">';
    html += '<td class="so-num">' + (i + 1) + '</td>';
    html += '<td class="so-left">' + lText + '</td>';
    html += '<td class="so-arrow">' + arrow + '</td>';
    html += '<td class="so-right">' + rText + methodTag + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table>';
  html += '<div class="so-summary">';
  html += '<span class="so-s-exact">✓ ' + exactCount + ' exact</span>';
  if (fuzzyCount) html += '<span class="so-s-fuzzy">≈ ' + fuzzyCount + ' fuzzy</span>';
  html += '<span class="so-s-miss">✗ ' + missingCount + ' missing</span>';
  html += '<span>Coverage: <span class="so-pct ' + pctCls + '">' + coveragePct + '%</span></span>';
  if (deletionPct > 0) html += '<span>Deletion: <span class="so-pct ' + delCls + '">' + deletionPct + '%</span></span>';
  html += '<span style="color:#6b7280">(' + total + ' template sections at H1–H' + maxH + ')</span>';
  html += '</div>';

  soWrap.innerHTML = html;
}

soBtn.addEventListener('click', () => {
  sectionsOnlyActive = !sectionsOnlyActive;
  if (sectionsOnlyActive) {
    diffWrap.classList.add('hidden-by-sections');
    soWrap.classList.add('active');
    soBtn.textContent = 'Full diff';
    renderSectionsOnly(parseInt(hSelect.value));
  } else {
    diffWrap.classList.remove('hidden-by-sections');
    soWrap.classList.remove('active');
    soBtn.textContent = 'Sections only';
  }
});

analyze(parseInt(hSelect.value));
</script>
</body></html>`;

  cors(res);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function stripFM(text) {
  if (text.startsWith("---")) {
    const end = text.indexOf("---", 3);
    if (end !== -1) return text.substring(end + 3).trim();
  }
  return text;
}

function norm(text) {
  let s = text;
  s = s.replace(/^\*+|\*+$/g, '');
  s = s.replace(/^_+|_+$/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s.toLowerCase();
}

function latinWords(text) {
  const matches = text.match(/[a-z][a-z0-9]*/gi);
  return matches ? matches.map(w => w.toLowerCase()) : [];
}

function wordJaccard(a, b) {
  const setA = new Set(a.split(/\s+/).filter(w => w.length > 1));
  const setB = new Set(b.split(/\s+/).filter(w => w.length > 1));
  if (setA.size === 0 && setB.size === 0) return 0;
  let inter = 0;
  setA.forEach(w => { if (setB.has(w)) inter++; });
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? inter / union : 0;
}

function fuzzyMatch(templateNorm, docNorms) {
  for (const d of docNorms) {
    if (d.norm === templateNorm) return { match: true, method: 'exact', matchedTo: d.orig };
  }
  for (const d of docNorms) {
    if (d.norm.includes(templateNorm) || templateNorm.includes(d.norm)) {
      if (Math.min(d.norm.length, templateNorm.length) > 2) {
        return { match: true, method: 'contains', matchedTo: d.orig };
      }
    }
  }
  const tLatin = latinWords(templateNorm);
  if (tLatin.length > 0) {
    for (const d of docNorms) {
      const dLatin = latinWords(d.norm);
      if (dLatin.length > 0) {
        const tSet = new Set(tLatin);
        const overlap = dLatin.filter(w => tSet.has(w)).length;
        if (overlap > 0 && overlap >= Math.min(tLatin.length, dLatin.length) * 0.5) {
          return { match: true, method: 'latin', matchedTo: d.orig };
        }
      }
    }
  }
  for (const d of docNorms) {
    const j = wordJaccard(templateNorm, d.norm);
    if (j >= 0.4) return { match: true, method: 'words', matchedTo: d.orig };
  }
  return { match: false };
}

function extractHeadingsFromMarkdown(md, maxH) {
  const lines = stripFM(md).split("\n");
  const headings = [];
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      const level = hMatch[1].length;
      if (level <= maxH) {
        const orig = hMatch[2].trim();
        headings.push({ level, orig, norm: norm(orig) });
      }
    }
  }
  return headings;
}

async function handleBatchCompare(req, res) {
  const body = await readBody(req);
  const { templateFolder, targetFolders, maxH = 4 } = body;

  if (!templateFolder || !Array.isArray(targetFolders)) {
    return json(res, 400, { error: "templateFolder and targetFolders array required" });
  }

  const templatePath = path.join(DOCS_DIR, templateFolder, "index.md");
  if (!fs.existsSync(templatePath)) {
    return json(res, 404, { error: `Template not found: ${templateFolder}` });
  }

  const templateRaw = fs.readFileSync(templatePath, "utf8");
  const templateH = extractHeadingsFromMarkdown(templateRaw, maxH);

  const results = {};

  for (const folder of targetFolders) {
    if (folder.includes("..") || folder.includes("/")) continue;
    const targetPath = path.join(DOCS_DIR, folder, "index.md");
    if (!fs.existsSync(targetPath)) {
      results[folder] = { error: "not found" };
      continue;
    }

    const targetRaw = fs.readFileSync(targetPath, "utf8");
    const targetH = extractHeadingsFromMarkdown(targetRaw, maxH);

    let exactCount = 0;
    let fuzzyCount = 0;
    let missingCount = 0;
    const missing = [];
    const docUsed = new Set();

    for (const t of templateH) {
      const exactIdx = targetH.findIndex((d, di) => !docUsed.has(di) && d.norm === t.norm);
      if (exactIdx >= 0) {
        docUsed.add(exactIdx);
        exactCount++;
        continue;
      }
      const fm = fuzzyMatch(t.norm, targetH.filter((_, di) => !docUsed.has(di)));
      if (fm.match) {
        const matchIdx = targetH.findIndex((d, di) => !docUsed.has(di) && d.orig === fm.matchedTo);
        if (matchIdx >= 0) docUsed.add(matchIdx);
        fuzzyCount++;
      } else {
        missingCount++;
        missing.push({ level: t.level, name: t.orig });
      }
    }

    const total = templateH.length;
    const found = exactCount + fuzzyCount;
    const coveragePct = total > 0 ? Math.round((found / total) * 100) : 100;
    const deletionPct = total > 0 ? Math.round((missingCount / total) * 100) : 0;

    results[folder] = {
      total_headings: total,
      exact_match: exactCount,
      fuzzy_match: fuzzyCount,
      missing_count: missingCount,
      coverage_rate: coveragePct,
      deletion_rate: deletionPct,
      missing_headings: missing
    };
  }

  json(res, 200, { ok: true, template: templateFolder, results });
}

const BRIDGE_VERSION = "1.3.1";
const startedAt = new Date().toISOString();

function handleStatus(req, res) {
  const settings = getEffectiveSettings();
  json(res, 200, {
    ok: true,
    version: BRIDGE_VERSION,
    docsDir: DOCS_DIR,
    editor: EDITOR,
    port: PORT,
    pid: process.pid,
    startedAt,
    nodeVersion: process.version,
    integrations: {
      telegram: !!settings.telegramBotToken,
      slack:    !!settings.slackBotToken,
    },
  });
}

function handleDashboard(req, res) {
  const uptime = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const docCount = (() => {
    try {
      return fs.readdirSync(DOCS_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .length;
    } catch { return 0; }
  })();

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Honoka Bridge Dashboard</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; padding: 2rem; line-height: 1.5; max-width: 600px; margin: 0 auto; background: #f9fafb; }
        .card { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e5e7eb; }
        h1 { margin-top: 0; color: #111827; font-size: 1.25rem; display: flex; align-items: center; justify-content: space-between; }
        .status-tag { background: #dcfce7; color: #166534; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; }
        .detail { margin: 0.5rem 0; color: #4b5563; font-size: 0.9rem; }
        code { background: #f3f4f6; padding: 0.2rem 0.4rem; border-radius: 4px; font-family: monospace; }
        .actions { margin-top: 1.5rem; border-top: 1px solid #f3f4f6; padding-top: 1rem; }
        .btn-shutdown { 
          display: inline-block; padding: 0.5rem 1rem; background: #fee2e2; color: #991b1b; 
          text-decoration: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500;
          border: 1px solid #fecaca; cursor: pointer; transition: all 0.2s;
        }
        .btn-shutdown:hover { background: #fecaca; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Honoka Bridge <span class="status-tag">ACTIVE</span></h1>
        <div class="detail"><b>Version:</b> ${BRIDGE_VERSION}</div>
        <div class="detail"><b>Node:</b> ${process.version}</div>
        <div class="detail"><b>Port:</b> ${PORT}</div>
        <div class="detail"><b>Docs:</b> <code>${DOCS_DIR}</code> (<b>${docCount}</b> dirs)</div>
        <div class="detail"><b>Uptime:</b> ${uptime}s</div>
        
        <div class="actions">
          <a href="/shutdown" class="btn-shutdown" onclick="return confirm('Shut down Honoka Bridge? You will need to restart it manually or reboot.')">🛑 Shut Down Server</a>
        </div>
      </div>
    </body>
    </html>
  `;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function handleShutdown(req, res) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<h1>Honoka Bridge is shutting down...</h1><p>You can close this tab now.</p>");
  console.log("\n[Honoka] Shutdown requested via web interface.");
  setTimeout(() => process.exit(0), 1000);
}

// ── Settings API (GET returns masked values, POST updates persisted settings) ──

function handleSettingsGet(req, res) {
  const s = getEffectiveSettings();
  json(res, 200, {
    telegramBotToken:    s.telegramBotToken || "",
    telegramAllowedUser: s.telegramAllowedUser || "",
    slackBotToken:       s.slackBotToken || "",
    slackAllowedChannel: s.slackAllowedChannel || "",
    _telegramSet:        !!s.telegramBotToken,
    _slackSet:           !!s.slackBotToken,
  });
}

async function handleSettingsPost(req, res) {
  const body = await readBody(req);
  const stored = readSettings();

  // Only update fields explicitly sent; ignore empty strings for token fields
  // (so clearing UI doesn't accidentally nuke a previously-saved token).
  const FIELDS = ["telegramBotToken", "telegramAllowedUser", "slackBotToken", "slackAllowedChannel"];
  let changed = false;
  for (const field of FIELDS) {
    if (field in body) {
      const val = String(body[field]).trim();
      // A value starting with '****' means the UI echoed back our masked value — skip.
      if (val) {
        stored[field] = val;
        changed = true;
      } else if (val === "") {
        // Explicit empty string means "clear this field"
        stored[field] = "";
        changed = true;
      }
    }
  }

  if (changed) {
    writeSettings(stored);
    // Re-initialise Telegram bot if token changed
    initTelegramBot();
  }

  json(res, 200, { ok: true, changed });
}

function handleRestart(req, res) {
  json(res, 200, { ok: true, message: "Restarting bridge..." });
  console.log("  ↻ Restart requested via /restart endpoint");
  setTimeout(() => {
    // Stop Telegram bot FIRST (its polling keeps connections alive)
    if (_telegramBot) {
      try { _telegramBot.stopPolling(); } catch { }
      _telegramBot = null;
    }

    // Force-exit failsafe: if server.close() hangs, exit anyway after 2s
    const forceTimer = setTimeout(() => {
      console.log("  ↻ Force-exiting (server.close timed out)");
      process.exit(0);
    }, 2000);
    forceTimer.unref();

    server.close(() => {
      clearTimeout(forceTimer);
      process.exit(0);
    });
  }, 300);
}


// ── History ingest (fire-and-forget from extension) ──

async function handleHistoryIngest(req, res) {
  const body = await readBody(req);
  const { pageId, ...entry } = body;
  if (!pageId) return json(res, 400, { error: "pageId required" });

  const line = JSON.stringify({
    pageId,
    ...entry,
    _ingested_at: new Date().toISOString(),
  });
  fs.appendFile(HISTORY_FILE, line + "\n", (err) => {
    if (err) {
      console.error("History ingest write error:", err.message);
      return json(res, 500, { error: err.message });
    }
    json(res, 200, { ok: true });
  });
}

function handleBatchReport(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const templateFolder = url.searchParams.get("template");
  const targetsParam = url.searchParams.get("targets");

  if (!templateFolder || templateFolder.includes("..") || templateFolder.includes("/")) {
    return json(res, 400, { error: "invalid template folder" });
  }
  const targetFolders = (targetsParam || "").split(",").map(s => s.trim()).filter(s => s && !s.includes("..") && !s.includes("/"));
  if (targetFolders.length === 0) {
    return json(res, 400, { error: "no target folders provided" });
  }

  const templatePath = path.join(DOCS_DIR, templateFolder, "index.md");
  if (!fs.existsSync(templatePath)) return json(res, 404, { error: "template not found" });

  const templateRaw = fs.readFileSync(templatePath, "utf8");
  const templateTitle = templateRaw.match(/title:\s*"([^"]+)"/)?.[1] || templateFolder;
  // Collect all headings up to H4; client-side filters by chosen depth
  const templateH = extractHeadingsFromMarkdown(templateRaw, 4);

  const targets = [];
  for (const folder of targetFolders) {
    const targetPath = path.join(DOCS_DIR, folder, "index.md");
    if (!fs.existsSync(targetPath)) {
      targets.push({ folder, error: "not found" });
      continue;
    }
    const targetRaw = fs.readFileSync(targetPath, "utf8");
    const targetTitle = targetRaw.match(/title:\s*"([^"]+)"/)?.[1] || folder;
    const targetH = extractHeadingsFromMarkdown(targetRaw, 4);
    targets.push({ folder, title: targetTitle, headings: targetH });
  }

  // Embed raw data; all matching done client-side for interactive depth switching
  const pageData = JSON.stringify({ templateTitle, templateH, targets });

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Batch Report — ${escHtml(templateTitle)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#1a1a2e;color:#e0e0e0;padding:0 0 60px}
a{color:#60a5fa;text-decoration:none}a:hover{text-decoration:underline}
.page-header{background:#16213e;padding:16px 32px;border-bottom:1px solid #0f3460;position:sticky;top:0;z-index:10}
.page-header h1{font-size:18px;font-weight:600;color:#e0e0e0}
.header-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.meta{font-size:12px;color:#8892b0;margin-top:4px}
.controls{display:flex;align-items:center;gap:12px;margin-top:8px;flex-wrap:wrap}
.ctrl-label{font-size:12px;color:#8892b0}
.ctrl-select{background:#0f3460;color:#e0e0e0;border:1px solid #1a365d;border-radius:4px;padding:3px 8px;font-size:12px;cursor:pointer}
.ctrl-btn{background:none;border:1px solid #1a365d;color:#8892b0;border-radius:4px;padding:3px 10px;font-size:11px;cursor:pointer}
.ctrl-btn:hover,.ctrl-btn.active{border-color:#4a90d9;color:#e0e0e0}
.summary-card{margin:20px 32px 0;background:#16213e;border:1px solid #0f3460;border-radius:8px;padding:18px 22px}
.summary-card h2{font-size:12px;font-weight:600;color:#8892b0;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em}
.summary-table{width:100%;border-collapse:collapse;font-size:13px}
.summary-table th{text-align:left;color:#8892b0;font-weight:500;font-size:11px;padding:4px 10px;border-bottom:1px solid #0f3460}
.summary-table td{padding:7px 10px;border-bottom:1px solid rgba(15,52,96,0.4)}
.summary-table tr:last-child td{border-bottom:none}
.num{text-align:center}
.pct{font-size:11px;padding:2px 7px;border-radius:3px;font-weight:700}
.pct-high{background:rgba(74,222,128,.2);color:#86efac}
.pct-mid{background:rgba(251,191,36,.2);color:#fbbf24}
.pct-low{background:rgba(248,113,113,.2);color:#fca5a5}
.pill{font-size:10px;padding:1px 6px;border-radius:10px;display:inline-block;margin:1px}
.pill-exact{background:rgba(74,222,128,.15);color:#86efac}
.pill-fuzzy{background:rgba(96,165,250,.15);color:#93c5fd}
.pill-miss{background:rgba(248,113,113,.15);color:#fca5a5}
.doc-section{margin:20px 32px 0;background:#16213e;border:1px solid #0f3460;border-radius:8px;padding:18px 22px}
.doc-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px}
.doc-header h2{font-size:14px;font-weight:600;color:#e0e0e0}
.doc-stats{font-size:12px;color:#8892b0;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.section-table{width:100%;border-collapse:collapse;font-family:"SF Mono",Menlo,Consolas,monospace;font-size:12px;line-height:1.6}
.section-table th{text-align:left;font-size:10px;color:#8892b0;padding:4px 10px;border-bottom:1px solid #0f3460;font-weight:500}
.section-table td{padding:5px 10px;border-bottom:1px solid rgba(15,52,96,.3);vertical-align:top}
.section-table .num{width:32px;text-align:right;color:#4a5568;font-size:11px}
.col-left{width:42%}.col-arrow{width:36px;text-align:center}.col-right{width:42%}
.row-exact .col-left,.row-exact .col-right{color:#86efac}
.row-fuzzy .col-left,.row-fuzzy .col-right{color:#93c5fd}
.row-missing .col-left{color:#fca5a5}.row-missing .col-right{color:#4a5568;font-style:italic}
.arrow{font-size:13px;font-weight:700}
.arrow-exact{color:#86efac}.arrow-fuzzy{color:#93c5fd}.arrow-miss{color:#f87171}
.method-tag{font-size:10px;color:#6b7280;margin-left:6px}
.dim{color:#8892b0}
.error-row{color:#fca5a5;font-style:italic}
@media(max-width:640px){.doc-section,.summary-card{margin:14px 12px 0}.page-header{padding:12px 16px}}
</style></head>
<body>
<div class="page-header">
  <div class="header-row">
    <div>
      <h1>Batch Template Report</h1>
      <div class="meta" id="meta-line"></div>
    </div>
  </div>
  <div class="controls">
    <span class="ctrl-label">Section depth:</span>
    <select class="ctrl-select" id="h-level">
      <option value="1">H1 only</option>
      <option value="2">H1 – H2</option>
      <option value="3">H1 – H3</option>
      <option value="4" selected>H1 – H4</option>
    </select>
    <span class="ctrl-label" style="margin-left:8px">Show:</span>
    <button class="ctrl-btn active" id="btn-all">All</button>
    <button class="ctrl-btn" id="btn-missing">Missing only</button>
    <button class="ctrl-btn" id="btn-fuzzy">Fuzzy + Missing</button>
  </div>
</div>

<div class="summary-card">
  <h2>Summary</h2>
  <table class="summary-table">
    <thead><tr>
      <th>Document</th>
      <th class="num">Template headings</th>
      <th class="num">Coverage</th>
      <th class="num">Deletion</th>
      <th class="num">Breakdown</th>
    </tr></thead>
    <tbody id="summary-body"></tbody>
  </table>
</div>
<div id="details"></div>

<script>
const DATA = ${pageData};

function norm(text) {
  return text.replace(/^\\*+|\\*+$/g,'').replace(/^_+|_+$/g,'').replace(/\\s+/g,' ').trim().toLowerCase();
}
function latinWords(text) {
  const m = text.match(/[a-z][a-z0-9]*/gi);
  return m ? m.map(w=>w.toLowerCase()) : [];
}
function wordJaccard(a,b) {
  const sa=new Set(a.split(/\\s+/).filter(w=>w.length>1));
  const sb=new Set(b.split(/\\s+/).filter(w=>w.length>1));
  if(sa.size===0&&sb.size===0) return 0;
  let inter=0; sa.forEach(w=>{if(sb.has(w))inter++;});
  return inter/new Set([...sa,...sb]).size;
}
function fuzzyMatch(tNorm, docNorms) {
  for(const d of docNorms) if(d.norm===tNorm) return {match:true,method:'exact',matchedTo:d.orig};
  for(const d of docNorms) {
    if((d.norm.includes(tNorm)||tNorm.includes(d.norm))&&Math.min(d.norm.length,tNorm.length)>2)
      return {match:true,method:'contains',matchedTo:d.orig};
  }
  const tL=latinWords(tNorm);
  if(tL.length>0) {
    for(const d of docNorms){
      const dL=latinWords(d.norm);
      if(dL.length>0){
        const tS=new Set(tL);
        const overlap=dL.filter(w=>tS.has(w)).length;
        if(overlap>0&&overlap>=Math.min(tL.length,dL.length)*0.5)
          return {match:true,method:'latin',matchedTo:d.orig};
      }
    }
  }
  for(const d of docNorms) if(wordJaccard(tNorm,d.norm)>=0.4) return {match:true,method:'words',matchedTo:d.orig};
  return {match:false};
}

function analyzeDoc(templateH, targetH) {
  const rows=[], docUsed=new Set();
  let exactCount=0, fuzzyCount=0, missingCount=0;
  templateH.forEach(t => {
    const ei=targetH.findIndex((d,di)=>!docUsed.has(di)&&d.norm===t.norm);
    if(ei>=0){docUsed.add(ei);rows.push({type:'exact',left:t,right:targetH[ei],method:''});exactCount++;return;}
    const fm=fuzzyMatch(t.norm,targetH.filter((_,di)=>!docUsed.has(di)));
    if(fm.match){
      const mi=targetH.findIndex((d,di)=>!docUsed.has(di)&&d.orig===fm.matchedTo);
      if(mi>=0)docUsed.add(mi);
      const tag={contains:'substring',latin:'latin words',words:'word overlap'}[fm.method]||fm.method;
      rows.push({type:'fuzzy',left:t,right:{level:t.level,orig:fm.matchedTo},method:tag});
      fuzzyCount++;
    } else {
      rows.push({type:'missing',left:t,right:null,method:''});
      missingCount++;
    }
  });
  const total=templateH.length;
  const coveragePct=total>0?Math.round((exactCount+fuzzyCount)/total*100):100;
  const deletionPct=total>0?Math.round(missingCount/total*100):0;
  return {rows,exactCount,fuzzyCount,missingCount,total,coveragePct,deletionPct};
}

function pctBadge(pct,invert){
  const cls=invert
    ?(pct<=20?'pct-high':pct<=50?'pct-mid':'pct-low')
    :(pct>=80?'pct-high':pct>=50?'pct-mid':'pct-low');
  return \`<span class="pct \${cls}">\${pct}%</span>\`;
}

let filterMode = 'all'; // 'all' | 'missing' | 'fuzzy'

function render() {
  const maxH = parseInt(document.getElementById('h-level').value);
  const templateH = DATA.templateH.filter(h=>h.level<=maxH);

  document.getElementById('meta-line').innerHTML =
    \`Template: <strong>\${DATA.templateTitle}</strong> &nbsp;·&nbsp; \${DATA.targets.filter(t=>!t.error).length} docs &nbsp;·&nbsp; H1–H\${maxH} headings &nbsp;·&nbsp; \${new Date().toLocaleString()}\`;

  // Summary
  let summaryHtml = '';
  const analyses = [];
  for(const t of DATA.targets){
    if(t.error){
      analyses.push(null);
      summaryHtml+=\`<tr><td>\${t.folder}</td><td colspan="4" class="error-row">\${t.error}</td></tr>\`;
      continue;
    }
    const targetH=t.headings.filter(h=>h.level<=maxH);
    const a=analyzeDoc(templateH,targetH);
    analyses.push(a);
    summaryHtml+=\`<tr>
      <td><a href="#doc-\${t.folder}">\${t.title||t.folder}</a></td>
      <td class="num">\${a.total}</td>
      <td class="num">\${pctBadge(a.coveragePct,false)}</td>
      <td class="num">\${pctBadge(a.deletionPct,true)}</td>
      <td class="num">
        <span class="pill pill-exact">\${a.exactCount} exact</span>
        \${a.fuzzyCount?'<span class="pill pill-fuzzy">'+a.fuzzyCount+' fuzzy</span>':''}
        <span class="pill pill-miss">\${a.missingCount} missing</span>
      </td>
    </tr>\`;
  }
  document.getElementById('summary-body').innerHTML=summaryHtml;

  // Detail sections
  let detailHtml='';
  DATA.targets.forEach((t,i)=>{
    if(t.error) return;
    const a=analyses[i];
    let rows=a.rows;
    if(filterMode==='missing') rows=rows.filter(r=>r.type==='missing');
    else if(filterMode==='fuzzy') rows=rows.filter(r=>r.type==='fuzzy'||r.type==='missing');

    let tableRows='';
    rows.forEach((row,ri)=>{
      const lText=\`H\${row.left.level} \${row.left.orig}\`;
      let rText='',arrow='',methodTag='';
      if(row.type==='exact'){
        rText=\`H\${row.right.level} \${row.right.orig}\`;
        arrow='<span class="arrow arrow-exact">=</span>';
      } else if(row.type==='fuzzy'){
        rText=\`H\${row.right.level} \${row.right.orig}\`;
        arrow='<span class="arrow arrow-fuzzy">≈</span>';
        methodTag=\`<span class="method-tag">(\${row.method})</span>\`;
      } else {
        rText='— missing —';
        arrow='<span class="arrow arrow-miss">✗</span>';
      }
      tableRows+=\`<tr class="row-\${row.type}">
        <td class="num">\${ri+1}</td>
        <td class="col-left">\${lText}</td>
        <td class="col-arrow">\${arrow}</td>
        <td class="col-right">\${rText}\${methodTag}</td>
      </tr>\`;
    });

    if(!tableRows) tableRows='<tr><td colspan="4" style="color:#4a5568;padding:12px 10px;font-style:italic">No headings match this filter.</td></tr>';

    detailHtml+=\`
    <div class="doc-section" id="doc-\${t.folder}">
      <div class="doc-header">
        <h2>\${t.title||t.folder}</h2>
        <div class="doc-stats">
          \${pctBadge(a.coveragePct,false)} coverage
          \${pctBadge(a.deletionPct,true)} deletion
          <span class="dim">\${a.total} template sections at H1–H\${maxH}</span>
        </div>
      </div>
      <table class="section-table">
        <thead><tr>
          <th class="num">#</th>
          <th class="col-left">Template heading</th>
          <th class="col-arrow"></th>
          <th class="col-right">This doc heading</th>
        </tr></thead>
        <tbody>\${tableRows}</tbody>
      </table>
    </div>\`;
  });
  document.getElementById('details').innerHTML=detailHtml;
}

document.getElementById('h-level').addEventListener('change', render);

['btn-all','btn-missing','btn-fuzzy'].forEach(id=>{
  document.getElementById(id).addEventListener('click',()=>{
    filterMode={
      'btn-all':'all','btn-missing':'missing','btn-fuzzy':'fuzzy'
    }[id];
    document.querySelectorAll('.ctrl-btn').forEach(b=>b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    render();
  });
});

render();
</script>
</body></html>`;

  cors(res);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

const CHARTS_DIR = path.join(__dirname, "..", "honoka-charts", "dist");

function serveChartsFile(relPath, res) {
  const filePath = path.join(CHARTS_DIR, relPath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
    ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
    ".ico": "image/x-icon", ".woff2": "font/woff2",
  };
  cors(res);
  res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function handleHistoryDump(req, res) {
  if (!fs.existsSync(HISTORY_FILE)) return json(res, 200, []);
  const lines = fs.readFileSync(HISTORY_FILE, "utf8").trim().split("\n").filter(Boolean);
  const deduped = new Map();
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.pageId) deduped.set(entry.pageId, entry);
    } catch { }
  }
  json(res, 200, [...deduped.values()]);
}

// ── Settings UI Page ──
// ── Settings UI Page ──
function serveSettingsPage(res) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Honoka Settings</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #1a1a2e; color: #e0e0e0; max-width: 600px; margin: 40px auto; padding: 20px; line-height: 1.6; }
    h1 { border-bottom: 1px solid #0f3460; padding-bottom: 10px; margin-bottom: 30px; }
    .group { background: #16213e; padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #0f3460; }
    h2 { font-size: 1.2em; margin-top: 0; color: #4db8ff; }
    label { display: block; margin-bottom: 5px; font-weight: 500; font-size: 0.9em; }
    .input-wrap { position: relative; margin-bottom: 15px; }
    input[type="text"], input[type="password"] { width: 100%; padding: 8px; background: #111; border: 1px solid #333; color: #fff; border-radius: 4px; box-sizing: border-box; }
    .toggle-pwd { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #888; cursor: pointer; font-size: 1.2em; padding: 0 5px; }
    .toggle-pwd:hover { color: #fff; }
    button.submit-btn { background: #0f3460; color: #fff; border: none; padding: 12px 20px; cursor: pointer; border-radius: 4px; font-weight: bold; width: 100%; margin-top: 10px; }
    button.submit-btn:hover { background: #e94560; }
    p.desc { font-size: 0.85em; color: #888; margin-bottom: 15px; margin-top: 5px; }
    .status { margin-top: 20px; text-align: center; color: #4db8ff; min-height: 24px; }
  </style>
</head>
<body>
  <h1>Honoka Settings</h1>
  <form id="settingsForm">
    <div class="group">
      <h2>Telegram Bot Integration</h2>
      <p class="desc">Forward links to your bot on Telegram to save them directly to Honoka.</p>
      
      <label>Telegram Bot Token</label>
      <div class="input-wrap">
        <input type="password" id="telegramBotToken" placeholder="e.g. 123456789:ABCdefGHIjklMNO...">
        <button type="button" class="toggle-pwd" onclick="togglePwd('telegramBotToken')">👁️</button>
      </div>
      <p class="desc">Get this from @BotFather. Leave blank to disable.</p>
      
      <label>Allowed User ID (Optional, Recommended)</label>
      <div class="input-wrap">
        <input type="text" id="telegramAllowedUser" placeholder="Your Telegram User ID">
      </div>
      <p class="desc">Only process messages from this user ID to prevent spam.</p>
    </div>

    <div class="group">
      <h2>Slack Bot Integration (Future)</h2>
      <label>Slack Bot Token</label>
      <div class="input-wrap">
        <input type="password" id="slackBotToken" placeholder="xoxb-...">
        <button type="button" class="toggle-pwd" onclick="togglePwd('slackBotToken')">👁️</button>
      </div>
      
      <label>Allowed Channel ID</label>
      <div class="input-wrap">
        <input type="text" id="slackAllowedChannel" placeholder="C0123456789">
      </div>
    </div>

    <button type="submit" class="submit-btn">Save Settings</button>
    <div class="status" id="statusMsg"></div>
  </form>

  <script>
    function togglePwd(id) {
      const input = document.getElementById(id);
      const btn = input.nextElementSibling;
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '👓';
      } else {
        input.type = 'password';
        btn.textContent = '👁️';
      }
    }

    async function loadSettings() {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (data._telegramSet) {
          const el = document.getElementById('telegramBotToken');
          el.value = data.telegramBotToken;
        }
        document.getElementById('telegramAllowedUser').value = data.telegramAllowedUser || '';
        if (data._slackSet) {
          const el = document.getElementById('slackBotToken');
          el.value = data.slackBotToken;
        }
        document.getElementById('slackAllowedChannel').value = data.slackAllowedChannel || '';
      } catch (err) {
        console.error('Failed to load settings', err);
      }
    }

    document.getElementById('settingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusMsg = document.getElementById('statusMsg');
      statusMsg.textContent = 'Saving...';
      
      const payload = {
        telegramBotToken: document.getElementById('telegramBotToken').value,
        telegramAllowedUser: document.getElementById('telegramAllowedUser').value,
        slackBotToken: document.getElementById('slackBotToken').value,
        slackAllowedChannel: document.getElementById('slackAllowedChannel').value
      };

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await res.json();
        
        if (result.ok) {
          statusMsg.textContent = 'Settings saved successfully! Bridge updated.';
          statusMsg.style.color = '#4db8ff';
          setTimeout(loadSettings, 500); // Reload to show masked tokens
        } else {
          statusMsg.textContent = 'Failed to save: ' + (result.error || 'Unknown error');
          statusMsg.style.color = '#e94560';
        }
      } catch (err) {
        statusMsg.textContent = 'Network error saving settings.';
        statusMsg.style.color = '#e94560';
      }
      
      setTimeout(() => { if(statusMsg.textContent.includes('successfully')) statusMsg.textContent = ''; }, 3000);
    });

    loadSettings();
  </script>
</body>
</html>`;
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
}


// ── Telegram Bot ──

let _telegramBot = null;

function initTelegramBot() {
  // Teardown existing bot if any
  if (_telegramBot) {
    try { _telegramBot.stopPolling(); } catch { }
    _telegramBot = null;
  }

  const settings = getEffectiveSettings();
  const token = settings.telegramBotToken;
  if (!token) {
    console.log("  Telegram: no token set — bot disabled (configure via /api/settings)");
    return;
  }

  let TelegramBot;
  try { TelegramBot = require("node-telegram-bot-api"); }
  catch { console.error("  Telegram: node-telegram-bot-api not installed — run npm install"); return; }

  let axios, JSDOM, Readability, TurndownService;
  // Use a helper to load dependencies (handles potential ESM/CJS issues in Node 18)
  const loadDeps = async () => {
    try {
      axios = require("axios");
      const jsdom = await import("jsdom");
      JSDOM = jsdom.JSDOM;
      const readability = require("@mozilla/readability");
      Readability = readability.Readability;
      const turndown = require("turndown");
      TurndownService = turndown;
      return true;
    } catch (e) {
      console.error("  Telegram: dependency load failed —", e.message);
      return false;
    }
  };

  const bot = new TelegramBot(token, {
    polling: {
      interval: 1000,
      autoStart: true,
      params: { timeout: 30 },
    },
  });
  _telegramBot = bot;
  console.log("  Telegram: bot started ✓");

  const URL_RE = /https?:\/\/[^\s<>"]+/gi;

  // Throttle polling error logs and force restart bot on fatal disconnects
  let _lastPollingErr = 0;
  let _errCount = 0;
  bot.on("polling_error", (err) => {
    const now = Date.now();
    if (now - _lastPollingErr > 30000) {
      console.error("  Telegram: polling error:", err.message);
      _lastPollingErr = now;
      _errCount = 1;
    } else {
      _errCount++;
    }
    // We no longer call bot.stopPolling() here because the cluster manager 
    // handles hard restarts. By not stopping, the bot library will automatically 
    // reconnect when the network becomes available again!
  });

  bot.on("message", async (msg) => {
    try {
      const chatId = msg.chat.id;
      const fromId = String(msg.from?.id || "");
      const settings = getEffectiveSettings();
      const allowedUser = settings.telegramAllowedUser;

      // Ensure dependencies are loaded (handles ESM/CJS compatibility in Node 18)
      if (!JSDOM || !Readability || !TurndownService) {
        const ok = await loadDeps();
        if (!ok) {
          await bot.sendMessage(chatId, "❌ System error: dependencies failed to load.");
          return;
        }
      }

      // Security: ignore messages from non-authorised users if a restriction is set.
      if (allowedUser && fromId !== allowedUser) {
        console.log(`  Telegram: ignored message from ${fromId} (not in allowedUser list)`);
        return;
      }

      const text = msg.text || msg.caption || "";
      const urls = text.match(URL_RE);

      if (!urls || urls.length === 0) {
        // Echo help if no URL found
        await bot.sendMessage(chatId, "📌 Send me a URL and I'll save it to your Honoka inbox!");
        return;
      }

      for (const rawUrl of urls) {
        const statusMsg = await bot.sendMessage(chatId, `⏳ Fetching ${rawUrl} …`);
        try {
          // Fetch the page
          const resp = await axios.get(rawUrl, {
            timeout: 20000,
            headers: { 
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
            },
            maxContentLength: 10 * 1024 * 1024,
          });

          const contentType = resp.headers["content-type"] || "";
          if (!contentType.includes("html")) {
            await bot.editMessageText(`⚠️ ${rawUrl}\nNot an HTML page (${contentType}). Skipped.`, { chat_id: chatId, message_id: statusMsg.message_id });
            continue;
          }

          // Parse with Readability
          const dom = new JSDOM(resp.data, { url: rawUrl });
          const reader = new Readability(dom.window.document);
          const article = reader.parse();

          if (!article || !article.content) {
            await bot.editMessageText(`⚠️ Could not extract article from ${rawUrl} (Readability failed).`, { chat_id: chatId, message_id: statusMsg.message_id });
            continue;
          }

          await bot.editMessageText(`📦 Article parsed: "${article.title}"\n💾 Saving to Honoka...`, { chat_id: chatId, message_id: statusMsg.message_id });

          // Convert to Markdown
          const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
          const markdown = td.turndown(article.content || "");

          // Save via shared pipeline
          const result = await saveToDisk({
            title:    article.title || rawUrl,
            markdown,
            html:     resp.data, // <--- Pass raw HTML here!
            url:      rawUrl,
            source:   "telegram",
            category: "reference",
          });

          await bot.editMessageText(`✅ *Saved successfully!*\n\n📄 *${article.title || "Untitled"}*\n📁 \`${result.folder}\`\n\n[Open in Browser](http://127.0.0.1:44124/charts/)`, { 
            chat_id: chatId, 
            message_id: statusMsg.message_id,
            parse_mode: "Markdown" 
          });

        } catch (err) {
          console.error("Telegram fetch error:", err.message);
          let errMsg = err.message;
          if (err.response?.status === 401 || err.response?.status === 403) {
            errMsg = `Access Denied (HTTP ${err.response.status}). This page might be private or have a paywall.`;
          } else if (err.code === 'ECONNABORTED') {
            errMsg = `Timeout: The website took too long to respond.`;
          }
          await bot.editMessageText(`❌ *Failed to save*\nURL: ${rawUrl}\nReason: ${errMsg}`, { 
            chat_id: chatId, 
            message_id: statusMsg.message_id,
            parse_mode: "Markdown" 
          });
        }
      }
    } catch (criticalErr) {
      console.error("  Telegram: Critical error in message handler:", criticalErr.message);
    }
  });

  bot.on("polling_error", (err) => {
    console.error("Telegram polling error:", err.message);
  });
}

// Start bot on launch (will no-op if no token is configured)
initTelegramBot();

// ── Server ──

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = url.pathname;

  try {
    if (route === "/" && req.method === "GET") return handleDashboard(req, res);
    if (route === "/status" && req.method === "GET") return handleStatus(req, res);
    if (route === "/shutdown" && req.method === "GET") return handleShutdown(req, res);
    if (route === "/list" && req.method === "GET") return handleList(req, res);
    if (route === "/save" && req.method === "POST") return await handleSave(req, res);
    if (route === "/new" && req.method === "POST") return await handleNew(req, res);
    if (route === "/open" && req.method === "POST") return await handleOpen(req, res);
    if (route === "/delete" && req.method === "POST") return await handleDelete(req, res);
    if (route === "/set-category" && req.method === "POST") return await handleSetCategory(req, res);
    if (route === "/backup" && req.method === "GET") return handleBackup(req, res);
    if (route === "/restore-registry" && req.method === "POST") return await handleRestoreRegistry(req, res);
    if (route === "/api/templates" && req.method === "GET") return handleTemplatesGet(req, res);
    if (route === "/api/templates" && req.method === "POST") return await handleTemplatesPost(req, res);
    if (route === "/api/templates" && req.method === "DELETE") return await handleTemplatesDelete(req, res);
    if (route === "/preview" && req.method === "GET") return handlePreview(req, res);
    if (route === "/preview-content" && req.method === "GET") return handlePreviewContent(req, res);
    if (route === "/diff" && req.method === "GET") return handleDiff(req, res);
    if (route === "/batch-report" && req.method === "GET") return handleBatchReport(req, res);
    if (route === "/api/batch-compare" && req.method === "POST") return await handleBatchCompare(req, res);
    if (route === "/restart" && req.method === "POST") return handleRestart(req, res);
    if (route === "/api/settings" && req.method === "GET") return handleSettingsGet(req, res);
    if (route === "/api/settings" && req.method === "POST") return await handleSettingsPost(req, res);
    if (route === "/settings" && req.method === "GET") return serveSettingsPage(res);
    if (route === "/history/ingest" && req.method === "POST") return await handleHistoryIngest(req, res);
    if (route === "/history/dump" && req.method === "GET") return handleHistoryDump(req, res);
    // Serve honoka-charts dashboard
    if (route === "/charts" || route === "/charts/") {
      return serveChartsFile("index.html", res);
    }
    if (route.startsWith("/charts/")) {
      const relPath = route.slice(8);
      if (relPath.includes("..")) return json(res, 400, { error: "invalid path" });
      return serveChartsFile(relPath, res);
    }
    // Serve local doc files (images, etc.)
    if (route.startsWith("/files/")) {
      const relPath = decodeURIComponent(route.slice(7));
      if (relPath.includes("..")) return json(res, 400, { error: "invalid path" });
      const filePath = path.join(DOCS_DIR, relPath);
      if (!fs.existsSync(filePath)) { res.writeHead(404); res.end("Not found"); return; }
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
      cors(res);
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: err.message });
  }
});

// ── Windows Startup Installer ──
if (process.platform === "win32" && process.argv.includes("--install")) {
  try {
    const startupDir = path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
    const vbsPath = path.join(startupDir, "honoka-bridge.vbs");
    const exePath = process.execPath;
    
    const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run """${exePath}""", 0, False`;
    fs.writeFileSync(vbsPath, vbsContent);
    
    console.log("\n✅ Honoka Bridge has been added to your Windows Startup!");
    console.log(`📍 Shortcut created: ${vbsPath}`);
    console.log("🚀 It will now run silently in the background whenever you log in.\n");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Failed to add to startup:", err.message);
    process.exit(1);
  }
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Honoka Bridge v${BRIDGE_VERSION} (pid ${process.pid})`);
  console.log(`  Listening on http://127.0.0.1:${PORT}`);
  console.log(`  Docs directory: ${DOCS_DIR}`);
  console.log(`  Editor: ${EDITOR} → ${EDITOR_PATH}\n`);
});
