const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { DOCS_DIR } = require("../saver");

/**
 * Downloads video from various sites using yt-dlp (Universal)
 */
async function downloadUniversalVideo(url, onProgress) {
  const videoDir = path.join(DOCS_DIR, "Inbound_Videos");
  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputPattern = path.join(videoDir, `Video-${timestamp}-%(title)s.%(ext)s`);

    console.log(`[Honoka] Starting universal yt-dlp for: ${url}`);

    // Resolve yt-dlp binary path per platform
    const YTDLP_PATH = process.platform === "win32"
      ? "yt-dlp.exe"
      : process.platform === "darwin"
        ? "/opt/homebrew/bin/yt-dlp"
        : "/home/koto/miniconda3/bin/yt-dlp";

    const proc = spawn(YTDLP_PATH, [
      "--no-playlist",
      "--newline",
      "--merge-output-format", "mp4",
      "--cookies-from-browser", "chrome",
      "--no-check-certificates",
      "-o", outputPattern,
      url
    ]);

    let stderr = "";
    proc.stdout.on("data", (data) => {
      const line = data.toString();
      const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?%)/);
      if (match && onProgress) {
        onProgress(match[1]);
      }
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      console.log(`[yt-dlp-stderr] ${data.toString().trim()}`);
    });

    proc.on("error", (err) => {
      console.error("[proc-error]", err);
      reject(new Error(`Failed to start yt-dlp: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const files = fs.readdirSync(videoDir);
        const matching = files.find(f => f.startsWith(`Video-${timestamp}`));

        if (matching) {
          const sidecarPath = path.join(videoDir, matching + ".md");
          fs.writeFileSync(sidecarPath, `# Video Download\n\n- **Source:** ${url}\n- **Date:** ${new Date().toLocaleString()}\n- **File:** ${matching}\n`);
        }

        resolve({ success: true, filename: matching || "Video saved" });
      } else {
        reject(new Error(`yt-dlp exited with code ${code}. Error: ${stderr.substring(0, 200)}`));
      }
    });

    // Increased timeout to 10 minutes for larger videos
    setTimeout(() => {
      proc.kill();
      reject(new Error("yt-dlp timed out after 10 minutes"));
    }, 600000);
  });
}

module.exports = { downloadUniversalVideo };
