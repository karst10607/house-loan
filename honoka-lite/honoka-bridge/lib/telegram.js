const { getEffectiveSettings } = require("./settings");
const { saveToDisk } = require("./storage");
const { downloadUniversalVideo } = require("./downloader");

let _telegramBot = null;

function initTelegramBot() {
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

  let _lastPollingErr = 0;
  bot.on("polling_error", (err) => {
    const now = Date.now();
    if (now - _lastPollingErr > 30000) {
      console.error("  Telegram: polling error:", err.message);
      _lastPollingErr = now;
    }
  });

  bot.on("message", async (msg) => {
    try {
      const chatId = msg.chat.id;
      const fromId = String(msg.from?.id || "");
      const settings = getEffectiveSettings();
      const allowedUser = settings.telegramAllowedUser;

      if (!JSDOM || !Readability || !TurndownService) {
        const ok = await loadDeps();
        if (!ok) {
          await bot.sendMessage(chatId, "❌ System error: dependencies failed to load.");
          return;
        }
      }

      if (allowedUser && fromId !== allowedUser) {
        console.log(`  Telegram: ignored message from ${fromId} (not in allowedUser list)`);
        return;
      }

      const text = msg.text || msg.caption || "";
      const urls = text.match(URL_RE);

      if (!urls || urls.length === 0) {
        await bot.sendMessage(chatId, "📌 Send me a URL and I'll save it to your Honoka inbox!");
        return;
      }

      for (const rawUrl of urls) {
        const isVideoSite = /x\.com|twitter\.com|youtube\.com|youtu\.be|drive\.google\.com|vimeo\.com|bilibili\.com/i.test(rawUrl);
        
        if (isVideoSite) {
          const statusMsg = await bot.sendMessage(chatId, `🎬 Video site detected: ${rawUrl}\n🚀 Starting universal download...`);
          try {
            let lastUpdate = 0;
            const videoResult = await downloadUniversalVideo(rawUrl, async (progress) => {
              const now = Date.now();
              if (now - lastUpdate > 3000) {
                lastUpdate = now;
                await bot.editMessageText(`🎬 *Downloading Video* …\n\n🔗 ${rawUrl}\n📊 *Progress:* ${progress}\n⏳ Please wait, this may take a while.`, {
                  chat_id: chatId,
                  message_id: statusMsg.message_id,
                  parse_mode: "Markdown"
                }).catch(() => {});
              }
            });
            await bot.editMessageText(`✅ *Video Saved!*\n\n📁 \`${videoResult.filename}\`\nℹ️ Saved to \`Inbound_Videos\` folder.`, {
              chat_id: chatId,
              message_id: statusMsg.message_id,
              parse_mode: "Markdown"
            });
            continue; 
          } catch (vErr) {
            console.error("yt-dlp universal error:", vErr.message);
            const failMsg = rawUrl.includes("drive.google.com") 
              ? "Google Drive failed (Check permissions/auth)."
              : `Download failed: ${vErr.message.substring(0, 100)}`;
            
            await bot.editMessageText(`⚠️ ${failMsg}\nFalling back to normal text scraping...`, {
              chat_id: chatId,
              message_id: statusMsg.message_id
            });
          }
        }

        const statusMsg = await bot.sendMessage(chatId, `⏳ Fetching ${rawUrl} …`);
        try {
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

          const dom = new JSDOM(resp.data, { url: rawUrl });
          const reader = new Readability(dom.window.document);
          const article = reader.parse();

          if (!article || !article.content) {
            await bot.editMessageText(`⚠️ Could not extract article from ${rawUrl} (Readability failed).`, { chat_id: chatId, message_id: statusMsg.message_id });
            continue;
          }

          await bot.editMessageText(`📦 Article parsed: "${article.title}"\n💾 Saving to Honoka...`, { chat_id: chatId, message_id: statusMsg.message_id });

          const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
          const markdown = td.turndown(article.content || "");

          const result = await saveToDisk({
            title:    article.title || rawUrl,
            markdown,
            html:     resp.data,
            url:      rawUrl,
            source:   "telegram",
            category: "reference",
          });

          await bot.editMessageText(`✅ *Saved successfully!*\n\n📄 *${article.title || "Untitled"}*\n📁 \`${result.folder}\`\n\n[Open Dashboard](http://127.0.0.1:44124/)`, { 
            chat_id: chatId, 
            message_id: statusMsg.message_id,
            parse_mode: "Markdown" 
          });

        } catch (err) {
          console.error("Telegram fetch error:", err.message);
          await bot.editMessageText(`❌ *Failed to save*\nURL: ${rawUrl}\nReason: ${err.message}`, { 
            chat_id: chatId, 
            message_id: statusMsg.message_id,
          });
        }
      }
    } catch (err) {
      console.error("Telegram global error:", err);
    }
  });
}

module.exports = {
  initTelegramBot,
  stopTelegramBot: () => { if (_telegramBot) { try { _telegramBot.stopPolling(); } catch {} _telegramBot = null; } }
};
