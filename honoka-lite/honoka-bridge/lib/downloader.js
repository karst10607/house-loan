const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { DOCS_DIR } = require("./settings");

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
    
    // Command: yt-dlp -o "pattern" "url"
    const proc = spawn("yt-dlp", [
      "--no-playlist",
      "--newline", // Crucial for parsing progress
      "--merge-output-format", "mp4",
      "--no-check-certificates",
      "-o", outputPattern,
      url
    ]);

    let stderr = "";
    proc.stdout.on("data", (data) => {
      const line = data.toString();
      // Look for: [download]  15.0% of 100MB at ...
      const match = line.match(/\[download\]\s+(\d+\.\d+%)/);
      if (match && onProgress) {
        onProgress(match[1]);
      }
    });

    proc.stderr.on("data", (data) => { stderr += data.toString(); });
    
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
        reject(new Error(`yt-dlp exited with code ${code}. ${stderr}`));
      }
    });
  });
}

module.exports = {
  downloadUniversalVideo
};
