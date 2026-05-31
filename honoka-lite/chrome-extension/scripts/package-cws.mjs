/**
 * Package Honoka Lite for Chrome Web Store submission.
 * Run: npm run prepublish
 *
 * Produces: honoka-lite-cws-v{version}.zip
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const version = manifest.version;
const outName = `honoka-lite-cws-v${version}.zip`;
const outPath = join(resolve(ROOT, ".."), outName);

// Strip dev-only entries from manifest (key + <all_urls>) for CWS
const manifestPath = join(ROOT, "manifest.json");
let raw = readFileSync(manifestPath, "utf8");
const m = JSON.parse(raw);
let manifestChanged = false;
if (m.key) { delete m.key; manifestChanged = true; }
const allUrlsIdx = m.host_permissions?.indexOf("<all_urls>");
if (allUrlsIdx !== -1) {
  m.host_permissions.splice(allUrlsIdx, 1);
  manifestChanged = true;
}
if (manifestChanged) {
  writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n", "utf8");
  console.log("🧹 Stripped dev-only entries from manifest.json");
}

const entries = [
  "manifest.json",
  "src/background.js",
  "dist/content.js",
  "dist/content.js.map",
  "src/content.css",
  "src/config.js",
  "src/notion-api.js",
  "src/history-idb.js",
  "src/features/clipper/selector.js",
  "popup/popup.html",
  "popup/popup.js",
  "popup/popup.css",
  "options/options.html",
  "options/options.js",
  "options/options.css",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

// Verify all files exist
for (const file of entries) {
  if (!existsSync(join(ROOT, file))) {
    console.error(`❌ Missing: ${file} — run "npm run build" first`);
    process.exit(1);
  }
}

console.log(`Packaging ${outName}...`);

const fileArgs = entries.map(f => `"${f}"`).join(" ");
const cmd = `cd "${ROOT}" && zip -9 "${outPath}" ${fileArgs}`;

execSync(cmd, { stdio: "inherit", shell: true });

const stat = existsSync(outPath) ? readFileSync(outPath).length : 0;
const kb = (stat / 1024).toFixed(1);
console.log(`\n✅ Done — ${outName} (${kb} KB, ${entries.length} files)`);
