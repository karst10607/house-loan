const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

async function getSystemCapabilities() {
  const check = (cmd) => new Promise(resolve => {
    exec(`${cmd} --version`, (err, stdout) => {
      if (err) resolve(null);
      else {
        const firstLine = stdout.split('\n')[0].trim();
        resolve(firstLine.length > 50 ? firstLine.substring(0, 50) + "..." : firstLine);
      }
    });
  });

  const ytdlp = await check("yt-dlp");
  const ffmpeg = await new Promise(resolve => {
    exec("ffmpeg -version", (err, stdout) => {
      if (err) resolve(null);
      else resolve(stdout.split('\n')[0].trim());
    });
  });

  return { ytdlp, ffmpeg };
}

function getDashboardHtml(data) {
  const { BRIDGE_VERSION, PORT, DOCS_DIR, docCount, uptime, caps } = data;
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Honoka Bridge Dashboard</title>
      <style>
        :root { --bg: #f9fafb; --card: #ffffff; --text: #111827; --primary: #3b82f6; --success: #166534; --danger: #991b1b; }
        body { font-family: system-ui, -apple-system, sans-serif; padding: 2rem; line-height: 1.5; max-width: 600px; margin: 0 auto; background: var(--bg); color: var(--text); }
        .card { background: var(--card); padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e5e7eb; margin-bottom: 1rem; }
        h1 { margin-top: 0; color: var(--text); font-size: 1.25rem; display: flex; align-items: center; justify-content: space-between; }
        .status-tag { background: #dcfce7; color: var(--success); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; }
        .detail { margin: 0.5rem 0; color: #4b5563; font-size: 0.9rem; }
        code { background: #f3f4f6; padding: 0.2rem 0.4rem; border-radius: 4px; font-family: monospace; }
        .cap-item { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #f3f4f6; }
        .cap-label { font-weight: 500; font-size: 0.875rem; }
        .cap-value { font-size: 0.75rem; color: #666; }
        .badge { padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: bold; font-size: 0.7rem; }
        .badge-ok { background: #dcfce7; color: var(--success); }
        .badge-missing { background: #fee2e2; color: var(--danger); }
        .actions { margin-top: 1.5rem; border-top: 1px solid #f3f4f6; padding-top: 1rem; }
        .btn-shutdown { 
          display: inline-block; padding: 0.5rem 1rem; background: #fee2e2; color: var(--danger); 
          text-decoration: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500;
          border: 1px solid #fecaca; cursor: pointer; transition: all 0.2s;
        }
        .btn-shutdown:hover { background: #fecaca; }
        .guide-link { font-size: 0.75rem; color: var(--primary); text-decoration: none; margin-left: 0.5rem; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Honoka Bridge <span class="status-tag">ACTIVE</span></h1>
        <div class="detail"><b>Version:</b> ${BRIDGE_VERSION}</div>
        <div class="detail"><b>Port:</b> ${PORT}</div>
        <div class="detail"><b>Docs:</b> <code>${DOCS_DIR.replace(os.homedir(), "~")}</code> (<b>${docCount}</b> items)</div>
        <div class="detail"><b>Uptime:</b> ${uptime}s</div>
      </div>

      <div class="card">
        <h2 style="font-size: 1rem; margin-top: 0">System Capabilities</h2>
        <div class="cap-item">
          <span class="cap-label">Video Engine (yt-dlp)</span>
          <span>
            <span class="badge ${caps.ytdlp ? 'badge-ok' : 'badge-missing'}">${caps.ytdlp ? 'Installed' : 'Missing'}</span>
            ${!caps.ytdlp ? '<a class="guide-link" href="https://github.com/yt-dlp/yt-dlp#installation" target="_blank">Install</a>' : ''}
          </span>
        </div>
        <div class="cap-item">
          <span class="cap-label">Media Processor (ffmpeg)</span>
          <span>
            <span class="badge ${caps.ffmpeg ? 'badge-ok' : 'badge-missing'}">${caps.ffmpeg ? 'Installed' : 'Missing'}</span>
            ${!caps.ffmpeg ? '<a class="guide-link" href="https://ffmpeg.org/download.html" target="_blank">Install</a>' : ''}
          </span>
        </div>
      </div>
      
      <div class="card" style="text-align: center">
        <div class="actions" style="border:none; padding:0">
          <a href="/shutdown" class="btn-shutdown" onclick="return confirm('Really shutdown the bridge?')">🛑 Shutdown Server</a>
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = {
  getSystemCapabilities,
  getDashboardHtml
};
