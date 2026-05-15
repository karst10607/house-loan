const fs = require("fs");
const path = require("path");
const os = require("os");

const SETTINGS_FILE = path.join(
  process.env.HONOKA_DOCS_DIR
    ? path.resolve(process.env.HONOKA_DOCS_DIR)
    : path.join(os.homedir(), "honoka-docs"),
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
    // ── Anytype ──
    anytypeApiUrl:        process.env.ANYTYPE_API_URL          || stored.anytypeApiUrl        || "",
    anytypeApiKey:        process.env.ANYTYPE_API_KEY          || stored.anytypeApiKey        || "",
    anytypeSpaceId:       process.env.ANYTYPE_SPACE_ID        || stored.anytypeSpaceId       || "",
    anytypeCollections:   stored.anytypeCollections           || {},
  };
}

module.exports = { getEffectiveSettings, readSettings, writeSettings, SETTINGS_FILE };
