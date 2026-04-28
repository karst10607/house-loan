import { Config } from "../src/config.js";
document.getElementById("analyze").addEventListener("click", runAnalysis);
document.getElementById("clear-history").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "clearAllHistory" }, loadHistory);
});
document.getElementById("open-library").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

function loadHistory() {
  chrome.storage.local.get({ honoka_global_index: [] }, (indexData) => {
    const index = indexData.honoka_global_index || [];
    if (index.length === 0) {
      document.getElementById("history-list").innerHTML = '<div class="history-empty">No pages visited yet.</div>';
      return;
    }
    const pageKeys = index.map((id) => `honoka_page_${id}`);
    chrome.storage.local.get(pageKeys, (pageData) => {
      const listEl = document.getElementById("history-list");
      const entries = index
        .map((id) => pageData[`honoka_page_${id}`] ? { id, ...pageData[`honoka_page_${id}`] } : null)
        .filter(Boolean)
        .sort((a, b) => (b.last_seen || "").localeCompare(a.last_seen || ""));

      if (entries.length === 0) {
        listEl.innerHTML = '<div class="history-empty">No pages visited yet.</div>';
        return;
      }

      listEl.innerHTML = entries.slice(0, 20).map((e) => {
        const ago = timeAgo(e.last_seen);
        const tok = e.token_snapshot >= 1000
          ? Math.round(e.token_snapshot / 1000) + "k tok"
          : (e.token_snapshot || "?") + " tok";
        const visits = e.visit_count || 1;
        return `<a class="history-item" href="${e.url}" target="_blank" title="${e.id}">
          <span class="history-title">${escapeHtml(e.title || "Untitled")}</span>
          <span class="history-meta">${tok} · ${visits}× · ${ago}</span>
        </a>`;
      }).join("");
    });
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

loadHistory();

function buildMediaLine(r) {
  const parts = [];
  if (r.totalImages > 0) parts.push(`${r.totalImages} img`);
  if (r.totalMermaid > 0) parts.push(`${r.totalMermaid} mermaid`);
  if (r.totalPlantUML > 0) parts.push(`${r.totalPlantUML} plantuml`);
  if (r.totalDrawio > 0) parts.push(`${r.totalDrawio} draw.io`);
  if (r.totalSvg > 0) parts.push(`${r.totalSvg} svg`);
  if (r.totalTableRows > 0) parts.push(`${r.totalTableRows} table rows`);
  if (parts.length === 0) return "";
  return `<div class="media-line">${parts.join(" · ")} <span class="media-overhead">(+${r.totalMediaTokens.toLocaleString()} tok)</span></div>`;
}

async function runAnalysis() {
  const budget = parseInt(document.getElementById("budget").value, 10) || 128000;
  const methodSelect = document.getElementById("method").value;
  const isAuto = methodSelect === "auto";
  const summaryEl = document.getElementById("summary");
  const listEl = document.getElementById("section-list");
  const methodEl = document.getElementById("method-info");

  summaryEl.className = "summary";
  summaryEl.textContent = "Analyzing...";
  listEl.innerHTML = "";
  methodEl.className = "method-info hidden";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes("notion")) {
      summaryEl.textContent = "Open a Notion page first.";
      return;
    }

    const msg = {
      action: "analyze",
      budgetTotal: budget,
    };
    if (isAuto) {
      msg.autoDetect = true;
    } else {
      msg.method = methodSelect;
    }

    const r = await chrome.tabs.sendMessage(tab.id, msg);

    if (r?.totalTokens !== undefined) {
      const remaining = Math.max(0, budget - r.totalTokens);
      const pct = r.budgetUsedPct;
      const ringColor = pct > 100 ? "#d93025" : pct > 85 ? "#f4b400" : "#0f9d58";
      const clampedPct = Math.min(pct, 100);
      const circumference = 2 * Math.PI * 20; // r=20
      const dashOffset = circumference * (1 - clampedPct / 100);

      summaryEl.innerHTML = `
        <div class="summary-ring-row">
          <div class="summary-ring-wrap">
            <svg class="summary-ring" viewBox="0 0 48 48">
              <circle cx="24" cy="24" r="20" fill="none" stroke="#e0e0e0" stroke-width="4"/>
              <circle cx="24" cy="24" r="20" fill="none" stroke="${ringColor}" stroke-width="4"
                stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"
                stroke-linecap="round" transform="rotate(-90 24 24)"
                style="transition: stroke-dashoffset 0.5s ease"/>
            </svg>
            <span class="summary-ring-label">${pct}%</span>
          </div>
          <div class="summary-details">
            <div class="summary-row">
              <span>Tokens</span>
              <strong>${r.totalTokens.toLocaleString()} / ${budget.toLocaleString()}</strong>
            </div>
            <div class="summary-row">
              <span>Remaining</span>
              <strong>${remaining.toLocaleString()}</strong>
            </div>
            <div class="summary-row">
              <span>Chars</span>
              <span>${r.totalChars.toLocaleString()}</span>
            </div>
            <div class="summary-row">
              <span>Sections</span>
              <span>${r.sectionCount}</span>
            </div>
          </div>
        </div>
        ${buildMediaLine(r)}
      `;

      if (r.sections?.length) {
        let cumulative = 0;
        listEl.innerHTML = r.sections
          .map((s) => {
            cumulative += s.tokens;
            const left = Math.max(0, budget - cumulative);
            let cls;
            if (cumulative > budget) cls = "over";
            else if (left < budget * 0.15) cls = "warn";
            else cls = "ok";
            const indent = (s.level || 1) - 1;
            return `<div class="sec ${cls}" style="padding-left:${4 + indent * 10}px">
              <span class="sec-title">${s.title}</span>
              <span class="sec-tok">${cumulative <= budget ? s.tokens.toLocaleString() : "CUT"}</span>
            </div>`;
          })
          .join("");
      }

      if (r.method) {
        const label = r.method.autoDetected ? " (auto-detected)" : " (manual)";
        methodEl.className = "method-info";
        methodEl.innerHTML = `<strong>${r.method.name}</strong>${label}<br>${r.method.description}`;
      }
    } else {
      summaryEl.textContent = "No sections detected. Scroll through the full page first, then retry.";
    }
  } catch (e) {
    summaryEl.textContent = "Error: Reload the Notion page and try again.";
  }
}

// ── Tab Logic ──
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active class from all
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    // Add active class to clicked
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// ── Clipper Logic (delegated to background service worker) ──

document.getElementById('start-clipper').addEventListener('click', async () => {
  const statusEl = document.getElementById('clipper-status');
  statusEl.textContent = "請在網頁上選取區塊，選取完成後點擊畫面下方的「確認並剪輯」。";
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const folderInput = document.getElementById('clipper-folder').value.trim();

    // Delegate everything to background.js (survives popup close)
    chrome.runtime.sendMessage({
      action: "startClipper",
      tabId: tab.id,
      tabUrl: tab.url,
      tabTitle: tab.title,
      folderName: folderInput || ""
    }, (response) => {
      if (response?.ok) {
        statusEl.textContent = "✅ 選取模式已啟動！你可以關閉此視窗，放心到網頁上選取區塊。選完後點「確認並剪輯」即會自動存檔。";
      } else {
        statusEl.textContent = `❌ 錯誤：${response?.error || '未知錯誤'}`;
      }
    });

  } catch (e) {
    statusEl.textContent = "發生錯誤：" + e.message;
  }
});

// Listen for result from background (if popup is still open)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "clipperResult") {
    const statusEl = document.getElementById('clipper-status');
    if (msg.success) {
      statusEl.innerHTML = `✅ 儲存成功！<br>目錄：~/honoka-docs/${msg.folder}<br>檔案：${msg.file}`;
    } else {
      statusEl.textContent = `❌ 儲存失敗：${msg.error}`;
    }
  }
});

