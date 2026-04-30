const fs = require("fs");
const path = require("path");

function renderMarkdown(md, folder, PORT) {
  const lines = md.split("\n");
  const out = [];
  let inCode = false;
  let codeLang = "";
  let codeLines = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (inCode) {
        out.push(`<pre><code class="lang-${escHtml(codeLang)}">${escHtml(codeLines.join("\n"))}</code></pre>`);
        inCode = false; codeLines = []; codeLang = "";
      } else {
        if (inList) { out.push("</ul>"); inList = false; }
        inCode = true; codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    if (line.trim() === "") { if (inList) { out.push("</ul>"); inList = false; } continue; }
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h${hMatch[1].length}>${inlineFormat(hMatch[2], folder, PORT)}</h${hMatch[1].length}>`);
      continue;
    }
    const liMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (liMatch) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inlineFormat(liMatch[2], folder, PORT)}</li>`);
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    out.push(`<p>${inlineFormat(line, folder, PORT)}</p>`);
  }
  return out.join("\n");
}

function inlineFormat(text, folder, PORT) {
  let s = escHtml(text);
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
    const resolved = (src.startsWith("./") || src.startsWith("images/"))
      ? `http://127.0.0.1:${PORT}/files/${folder}/${src.replace(/^\.\//, "")}`
      : src;
    return `<img src="${resolved}" alt="${alt}">`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

module.exports = { renderMarkdown };
