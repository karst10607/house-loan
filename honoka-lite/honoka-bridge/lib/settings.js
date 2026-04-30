const fs = require("fs");
const path = require("path");
const os = require("os");

const DOCS_DIR = process.env.HONOKA_DOCS_DIR
  ? path.resolve(process.env.HONOKA_DOCS_DIR)
  : path.join(os.homedir(), "honoka-docs");

const SETTINGS_FILE = path.join(DOCS_DIR, ".honoka", "settings.json");

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); }
  catch { return {}; }
}

function writeSettings(s) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

function getEffectiveSettings() {
  const stored = readSettings();
  return {
    ...stored,
    telegramBotToken:     process.env.TELEGRAM_BOT_TOKEN     || stored.telegramBotToken     || "",
    telegramAllowedUser:  process.env.TELEGRAM_ALLOWED_USER   || stored.telegramAllowedUser  || "",
    slackBotToken:        process.env.SLACK_BOT_TOKEN         || stored.slackBotToken        || "",
    slackAllowedChannel:  process.env.SLACK_ALLOWED_CHANNEL   || stored.slackAllowedChannel  || "",
  };
}

module.exports = {
  DOCS_DIR,
  SETTINGS_FILE,
  readSettings,
  writeSettings,
  getEffectiveSettings
};
