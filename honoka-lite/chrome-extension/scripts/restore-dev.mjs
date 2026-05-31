/**
 * Restore local dev entries in manifest.json (key + <all_urls>).
 * Run: npm run restore-dev
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const manifestPath = join(ROOT, "manifest.json");

const KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxutrqrYWgom6Yu4yi9gDMPhAszeQlLgCmqaZWKAcxLZLwQP7E7/H5w03CkkfY40yko9wS9UhE8IQCKYSLetWHfNF0VNcwRV88E9+FuQhGlrQ0xgL3Gck5RGbSxpKL8KsuR0c+Par+wZXBSFYkT8WJxrOmr7T1JmgWky7nP0reeu5CRoKZEwAN4yHapfLKQ96M9/2uAOXoU3Eed/XCjNCNEFcuJKU9QmhgwkRp2fmHARmVQye9dZI6BxmsxHBKMW97Ste+HBb4mwOYQtpd2glXS4rgU3aaIyRJ5hR47H51rdrqkv/5Bs+JuDVCxWuKficfk6WAsGaqVaSh+gNPLvSYwIDAQAB";

let raw = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(raw);

let changed = false;

if (!manifest.key) {
  manifest.key = KEY;
  changed = true;
}

if (!manifest.host_permissions.includes("<all_urls>")) {
  manifest.host_permissions.push("<all_urls>");
  changed = true;
}

if (changed) {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log("✅ Restored dev entries: key + <all_urls>");
} else {
  console.log("ℹ️  Already has dev entries. No changes.");
}
