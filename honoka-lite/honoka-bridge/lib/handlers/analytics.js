const fs = require("fs");
const path = require("path");

function scanDirectory(baseDir, reg, results, label, INBOX_DIR) {
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

    // Advanced Stats for Analytics
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
    });
  }
}

module.exports = { scanDirectory };
