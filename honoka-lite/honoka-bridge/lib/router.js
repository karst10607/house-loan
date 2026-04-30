const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { DOCS_DIR, INBOX_DIR, readRegistry, writeRegistry, saveToDisk } = require("./storage");
const { getEffectiveSettings, writeSettings, EDITOR } = require("./settings");
const { getSystemCapabilities, getDashboardHtml } = require("./dashboard");
const { stopTelegramBot, initTelegramBot } = require("./telegram");

// Import sub-handlers
const { scanDirectory } = require("./handlers/analytics");
const { renderMarkdown } = require("./handlers/preview");
const { diffLines } = require("./handlers/diff");

// ── Utils ──
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

function resolveEditor(name) {
  const candidates = {
    cursor: ["/Applications/Cursor.app/Contents/Resources/app/bin/cursor", "/usr/local/bin/cursor"],
    code: ["/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code", "/usr/local/bin/code"],
  };
  const paths = candidates[name] || [];
  for (const p of paths) { try { if (fs.statSync(p).isFile()) return p; } catch { } }
  return name;
}

// ── Handlers ──

async function handleRoot(req, res, { BRIDGE_VERSION, PORT, startedAt }) {
  const uptime = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const caps = await getSystemCapabilities();
  let docCount = 0;
  try {
    docCount = fs.readdirSync(DOCS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .length;
  } catch {}
  const html = getDashboardHtml({ BRIDGE_VERSION, PORT, DOCS_DIR, docCount, uptime, caps });
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function handleStatus(req, res, { BRIDGE_VERSION, startedAt, PORT }) {
  const settings = getEffectiveSettings();
  json(res, 200, { ok: true, version: BRIDGE_VERSION, docsDir: DOCS_DIR, editor: EDITOR, port: PORT, pid: process.pid, startedAt, integrations: { telegram: !!settings.telegramBotToken } });
}

async function handleSave(req, res) {
  const body = await readBody(req);
  try { const result = await saveToDisk(body); json(res, 200, { ok: true, ...result }); }
  catch (err) { json(res, 400, { error: err.message }); }
}

async function handleOpen(req, res) {
  const body = await readBody(req);
  const { folder, file } = body;
  const baseDir = (folder && fs.existsSync(path.join(INBOX_DIR, folder))) ? INBOX_DIR : DOCS_DIR;
  const target = folder ? (file ? path.join(baseDir, folder, file) : path.join(baseDir, folder)) : baseDir;
  const editorBin = resolveEditor(body.editor || EDITOR);
  try { execFile(editorBin, [target], { detached: true, stdio: "ignore" }).unref(); json(res, 200, { ok: true, opened: target }); }
  catch (err) { json(res, 500, { error: err.message }); }
}

function handleList(req, res) {
  const reg = readRegistry();
  const docs = [];
  try {
    scanDirectory(DOCS_DIR, reg, docs, "docs", INBOX_DIR);
    scanDirectory(INBOX_DIR, reg, docs, "inbox", INBOX_DIR);
  } catch (err) { return json(res, 500, { error: err.message }); }
  docs.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  json(res, 200, { docs, docsDir: DOCS_DIR, count: docs.length });
}

async function handleSettingsPost(req, res) {
  const body = await readBody(req);
  const stored = getEffectiveSettings();
  const FIELDS = ["telegramBotToken", "telegramAllowedUser"];
  let changed = false;
  for (const f of FIELDS) { if (f in body) { stored[f] = body[f]; changed = true; } }
  if (changed) { writeSettings(stored); initTelegramBot(); }
  json(res, 200, { ok: true, changed });
}

function handlePreview(req, res, PORT) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const folder = url.searchParams.get("folder");
  if (!folder) return json(res, 400, { error: "folder required" });
  
  cors(res);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<html><body style="margin:0"><iframe src="/preview-content?folder=${encodeURIComponent(folder)}" style="width:100%;height:100vh;border:none"></iframe></body></html>`);
}

function handlePreviewContent(req, res, PORT) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const folder = url.searchParams.get("folder");
  const baseDir = (folder && fs.existsSync(path.join(INBOX_DIR, folder))) ? INBOX_DIR : DOCS_DIR;
  const indexPath = path.join(baseDir, folder, "index.md");
  if (!fs.existsSync(indexPath)) return json(res, 404, { error: "not found" });

  const raw = fs.readFileSync(indexPath, "utf8");
  const html = renderMarkdown(raw, folder, PORT);
  
  cors(res);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html><html><head><style>body{font-family:sans-serif;max-width:800px;margin:2em auto;padding:0 1em;line-height:1.6}img{max-width:100%}</style></head><body>${html}</body></html>`);
}

function handleRestart(req, res, { server }) {
  json(res, 200, { ok: true, message: "Restarting..." });
  setTimeout(() => { stopTelegramBot(); server.close(() => process.exit(0)); }, 300);
}

module.exports = {
  json, cors, handleRoot, handleStatus, handleSave, handleOpen, handleSettingsPost, handleRestart, handleList,
  handlePreview, handlePreviewContent
};
