const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { DOCS_DIR } = require("./settings");

const INBOX_DIR = path.join(DOCS_DIR, "Inbox");
const REGISTRY_DIR = path.join(DOCS_DIR, ".honoka");
const REGISTRY_FILE = path.join(REGISTRY_DIR, "registry.json");

// Ensure base directories exist
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

function sanitizeFolderName(name) {
  return name
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\ufe0f]/gu, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 80) || "";
}

function dedup(name, baseDir) {
  let candidate = name;
  let i = 2;
  while (fs.existsSync(path.join(baseDir, candidate))) {
    candidate = `${name} (${i++})`;
  }
  return candidate;
}

function resolveFolder(pageId, title, url, baseDir = DOCS_DIR) {
  const reg = readRegistry();
  if (pageId && reg[pageId]) return reg[pageId].folder;

  const clean = sanitizeFolderName(title || "");
  if (clean) return dedup(clean, baseDir);

  if (url) {
    const urlMatch = url.match(/notion\.so\/(?:[^/]+\/)?([A-Za-z][\w-]+)-[a-f0-9]{32}/);
    if (urlMatch) {
      const fromUrl = urlMatch[1].replace(/-/g, " ");
      return dedup(sanitizeFolderName(fromUrl) || `page-${pageId?.substring(0, 12) || Date.now().toString(36)}`, baseDir);
    }
  }

  if (pageId) return `page-${pageId.substring(0, 12)}`;
  return `doc-${Date.now().toString(36)}`;
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

  fs.writeFileSync(path.join(docDir, "index.md"), md, "utf8");
  if (html) {
    fs.writeFileSync(path.join(docDir, "source.html"), html, "utf8");
  }

  return { ok: true, slug, folder: slug, path: docDir };
}

module.exports = {
  DOCS_DIR,
  INBOX_DIR,
  REGISTRY_DIR,
  REGISTRY_FILE,
  readRegistry,
  writeRegistry,
  slugify,
  sanitizeFolderName,
  dedup,
  resolveFolder,
  saveToDisk
};
