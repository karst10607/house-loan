const path = require("path");
const fs = require("fs");

const { getEffectiveSettings } = require("../settings");
const { saveToDisk, INBOX_DIR } = require("../saver");
const { performCapture } = require("../capture");
const { downloadUniversalVideo } = require("./video");
const { saveToAnytype } = require("./anytype");

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
      interval: 2000, // Slightly longer interval
      autoStart: true,
      params: { timeout: 30 },
    },
    request: {
      agentOptions: {
        family: 4
      }
    }
  });
  _telegramBot = bot;
  console.log("  Telegram: bot started ✓");

  const URL_RE = /https?:\/\/[^\s<>"]+/gi;

  // Throttle polling error logs and force restart bot on fatal disconnects
  let _lastPollingErr = 0;
  let _errCount = 0;
  bot.on("polling_error", (err) => {
    const now = Date.now();
    const isAggregateError = err.name === 'AggregateError' || (err.message && err.message.includes('AggregateError'));

    if (now - _lastPollingErr > 15000) {
      console.error(`  Telegram: polling error${isAggregateError ? ' (AggregateError)' : ''}:`, err.message);
      _lastPollingErr = now;
      _errCount = 1;
    } else {
      _errCount++;
    }

    // If we hit too many errors quickly, restart polling after a delay
    if (_errCount > 5) {
      console.warn("  Telegram: too many polling errors, cooling down for 10s...");
      bot.stopPolling().then(() => {
        setTimeout(() => {
          bot.startPolling().catch(e => console.error("  Telegram: restart failed:", e.message));
        }, 10000);
      }).catch(() => {});
      _errCount = 0;
    }
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
          await bot.sendMessage(chatId, "System error: dependencies failed to load.");
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
        await bot.sendMessage(chatId, "Send me a URL and I'll save it to your Honoka inbox!");
        return;
      }

      for (const rawUrl of urls) {
        // Detect video sites (X, YouTube, Google Drive, Bilibili, etc.)
        const isVideoSite = /x\.com|twitter\.com|youtube\.com|youtu\.be|drive\.google\.com|vimeo\.com|bilibili\.com/i.test(rawUrl);

        if (isVideoSite) {
          const statusMsg = await bot.sendMessage(chatId, `Video site detected: ${rawUrl}\nStarting universal download...`);
          try {
            let lastUpdate = 0;
            const videoResult = await downloadUniversalVideo(rawUrl, async (progress) => {
              // Console log for debugging
              console.log(`[Telegram-Bot] Download progress for ${rawUrl}: ${progress}`);

              const now = Date.now();
              if (now - lastUpdate > 3000) {
                lastUpdate = now;
                await bot.editMessageText(`Downloading Video ...\n\n${rawUrl}\nProgress: ${progress}\nPlease wait, this may take a while.`, {
                  chat_id: chatId,
                  message_id: statusMsg.message_id
                }).catch((e) => {
                  console.error("[Telegram-Bot] Progress update failed:", e.message);
                });
              }
            });
            await bot.editMessageText(`Video Saved!\n\n${videoResult.filename}\nSaved to Inbound_Videos folder.`, {
              chat_id: chatId,
              message_id: statusMsg.message_id
            });
            continue;
          } catch (vErr) {
            console.error("yt-dlp universal error:", vErr.message);
            const failMsg = rawUrl.includes("drive.google.com")
              ? "Google Drive failed (Check permissions/auth)."
              : `Download failed: ${vErr.message.substring(0, 100)}`;

            await bot.editMessageText(`${failMsg}\nFalling back to normal text scraping...`, {
              chat_id: chatId,
              message_id: statusMsg.message_id
            });
          }
        }

        const statusMsg = await bot.sendMessage(chatId, `Fetching ${rawUrl} ...`);
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
            await bot.editMessageText(`${rawUrl}\nNot an HTML page (${contentType}). Skipped.`, { chat_id: chatId, message_id: statusMsg.message_id });
            continue;
          }

          // Parse with Readability
          const dom = new JSDOM(resp.data, { url: rawUrl });
          const reader = new Readability(dom.window.document);
          const article = reader.parse();

          if (!article || !article.content) {
            await bot.editMessageText(`Could not extract article from ${rawUrl} (Readability failed).`, { chat_id: chatId, message_id: statusMsg.message_id });
            continue;
          }

          await bot.editMessageText(`Article parsed: "${article.title}"\nSaving to Honoka...`, { chat_id: chatId, message_id: statusMsg.message_id });

          // Convert to Markdown
          const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
          const markdown = td.turndown(article.content || "");

          // Save via shared pipeline
          const result = await saveToDisk({
            title:    article.title || rawUrl,
            markdown,
            html:     resp.data,
            url:      rawUrl,
            source:   "telegram",
            category: "real-estate",
            properties: {} // Pre-create properties area
          });

          // Step 2: Automated Capture (PNG/PDF)
          await bot.editMessageText(`Generating Screenshot & PDF...\n(This may take 15-20 seconds)`, { chat_id: chatId, message_id: statusMsg.message_id });

          let captureStatus = "";
          let finalSiteData = {};
          try {
            // BUG FIX: Telegram uses INBOX_DIR, not DOCS_DIR
            const targetDir = path.join(INBOX_DIR, result.folder);
            const captureResult = await performCapture(rawUrl, targetDir);
            captureStatus = "\nFull-page Capture: OK";
            finalSiteData = captureResult.data || {};

            // BUG FIX: Update the Markdown file with ALL real data from Playwright
            if (finalSiteData && Object.keys(finalSiteData).length > 0) {
              // Dynamic filename from saveToDisk (future-proof)
              const mdPath = path.join(targetDir, result.filename);
              if (fs.existsSync(mdPath)) {
                let content = fs.readFileSync(mdPath, "utf8");

                // Construct new properties block
                let propLines = "properties:\n";
                let hasData = false;
                for (const [k, v] of Object.entries(finalSiteData)) {
                  if (v !== undefined && v !== null && v !== "" && v !== "undefined") {
                    propLines += `  ${k}: "${String(v).replace(/"/g, '\\"')}"\n`;
                    hasData = true;
                  }
                }

                if (hasData) {
                  console.log(`[Telegram] Injecting these properties into ${result.filename}:\n${propLines}`);
                  if (content.includes("properties:")) {
                    // Replace everything from properties: to the next --- or end of frontmatter
                    content = content.replace(/properties:[\s\S]*?(\n---|$)/, propLines + "---");
                  } else {
                    // Fallback: insert before the second ---
                    const parts = content.split("---");
                    if (parts.length >= 3) {
                      parts[1] = parts[1] + propLines;
                      content = parts.join("---");
                    }
                  }
                  fs.writeFileSync(mdPath, content);
                  console.log(`[Telegram] ${result.filename} successfully updated.`);
                }
              }
            }
          } catch (capErr) {
            console.error("[Telegram] Capture failed:", capErr.message);
            captureStatus = "\nFull-page Capture: Failed (" + capErr.message.substring(0, 50) + ")";
          }

          // Check if we extracted property info
          let propInfo = "";
          const displayPrice = finalSiteData.price || "";
          const displayPing = finalSiteData.ping || "";
          const displayFloor = finalSiteData.floor || "";
          const displayLayout = finalSiteData.layout || "";
          const displayCommunity = finalSiteData.community || "";

          if (displayPrice) propInfo = `\nPrice: ${displayPrice}`;
          if (displayPing) propInfo += `\nSize: ${displayPing} ping`;
          if (displayFloor) propInfo += `\nFloor: ${displayFloor}F`;
          if (displayLayout) propInfo += `\nLayout: ${displayLayout}`;
          if (displayCommunity) propInfo += `\nCommunity: ${displayCommunity}`;

          // Step 3: Sync to Anytype (best-effort, failure does not affect local save)
          let anytypeStatus = "";
          try {
            const anytypeResult = await saveToAnytype({
              title: article.title || rawUrl,
              markdown,
              url: rawUrl,
              category: "real-estate",
              properties: finalSiteData,
            });
            if (anytypeResult.ok) {
              anytypeStatus = "\nAnytype: Synced";
            } else if (anytypeResult.error !== "Anytype not configured") {
              anytypeStatus = "\nAnytype: Failed (" + anytypeResult.error.substring(0, 50) + ")";
            }
          } catch (atErr) {
            console.error("[Telegram] Anytype sync error:", atErr.message);
            anytypeStatus = "\nAnytype: Error";
          }

          await bot.editMessageText(`Saved successfully!${propInfo}${captureStatus}${anytypeStatus}\n\n${article.title || "Untitled"}\nFolder: ${result.folder}\n\nOpen in Browser: http://127.0.0.1:44124/charts/`, {
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
          await bot.editMessageText(`Failed to save\nURL: ${rawUrl}\nReason: ${errMsg}`, {
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
}

module.exports = { initTelegramBot, getTelegramBot: () => _telegramBot };
