const path = require("path");
const os = require("os");

async function ensurePlaywright() {
  try {
    const { chromium } = require("playwright");
    // Just try to get the path, if it fails, it usually means not installed
    chromium.executablePath();
    return true;
  } catch (err) {
    console.log("[Playwright] Chromium not found. Attempting automatic installation...");
    try {
      const { execSync } = require("child_process");
      // Use npx to install only chromium to save space and time
      execSync("npx playwright install chromium", { stdio: "inherit" });
      return true;
    } catch (installErr) {
      console.error("[Playwright] Auto-install failed:", installErr.message);
      return false;
    }
  }
}

async function performCapture(url, targetDir) {
  await ensurePlaywright();
  console.log(`[Capture] Starting full-page capture for: ${url}`);
  let browser;
  try {
    const { chromium } = require("playwright");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

    // --- Data Extraction inside the Browser ---
    const extractedData = await page.evaluate(() => {
      const data = {};
      try {
        // Try to get 591 dataLayer
        if (window.dataLayer) {
          const item = window.dataLayer.find(x => x && x.price_name);
          if (item) {
            data.price = item.price_name;
            data.ping = item.area_name;
            data.floor = item.floor_name;
            data.layout = item.layout_name;
            data.community = item.community_name;
          }
        }
        // Try INITIAL_STATE
        if (window.__INITIAL_STATE__ && !data.price) {
          const state = window.__INITIAL_STATE__;
          data.price = state.price_name || state.price;
          data.ping = state.area_name || state.area;
          data.floor = state.floor_name || state.floor;
          data.layout = state.layout_name || state.layout;
        }
        // Fallback: DOM query for Price if still empty
        if (!data.price) {
          const priceEl = document.querySelector(".house-price .price, .house-info-price, .price");
          if (priceEl) data.price = priceEl.innerText.trim();
        }
      } catch (e) {}
      return data;
    });

    console.log(`[Capture] Data extracted via Playwright:`, extractedData);

    // Scroll to bottom to trigger lazy loading
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    await page.waitForTimeout(2000);

    const pngPath = path.join(targetDir || os.tmpdir(), "fullpage.png");
    const pdfPath = path.join(targetDir || os.tmpdir(), "fullpage.pdf");

    await page.screenshot({ path: pngPath, fullPage: true });
    await page.pdf({ path: pdfPath, format: "A4", printBackground: true });

    await browser.close();
    return { success: true, data: extractedData, png: pngPath, pdf: pdfPath };
  } catch (err) {
    if (browser) await browser.close();
    console.error(`[Capture] Failed: ${err.message}`);
    throw err;
  }
}

module.exports = { performCapture, ensurePlaywright };
