// ── Serialized storage queue ────────────────────────────────────────
// All mutations to honoka_global_index and honoka_page_* keys go through
// this queue to prevent race conditions when multiple Notion tabs write
// concurrently. See doc3/IDB_adoption_plan.md for rationale.

const isLite = chrome.runtime.getManifest().name.includes("Lite");
const BRIDGE_URL = isLite ? "http://127.0.0.1:44124" : "http://127.0.0.1:7749";

function _postToBridge(pageId, entry) {
  fetch(`${BRIDGE_URL}/history/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageId, ...entry }),
  }).catch(() => {});
}

function _pageKey(pageId) { return `honoka_page_${pageId}`; }

let _storageQueue = Promise.resolve();

function enqueue(fn) {
  _storageQueue = _storageQueue
    .then(fn)
    .catch((e) => console.warn("Honoka storage queue error:", e));
  return _storageQueue;
}

function handleUpsertPageEntry({ pageId, title, url, tokenSnapshot, properties, extras }) {
  return enqueue(() => new Promise((resolve) => {
    const pk = _pageKey(pageId);
    chrome.storage.local.get([pk, "honoka_global_index", "honoka_history_limit"], (data) => {
      const existing = data[pk] || {};
      const limit = data.honoka_history_limit || 200;
      const index = data.honoka_global_index || [];
      const isUpdate = !!existing.first_seen;
      const now = new Date().toISOString();

      const newUsable = title && title !== "Untitled";
      const oldUsable = existing.title && existing.title !== "Untitled";
      let bestTitle;
      if (newUsable && oldUsable) {
        bestTitle = title.length >= existing.title.length ? title : existing.title;
      } else if (newUsable) {
        bestTitle = title;
      } else if (oldUsable) {
        bestTitle = existing.title;
      } else {
        bestTitle = title || existing.title || "Untitled";
      }

      const entry = {
        title: bestTitle,
        url,
        first_seen: existing.first_seen || now,
        last_seen: now,
        visit_count: isUpdate ? (existing.visit_count || 0) + 1 : 1,
        token_snapshot: tokenSnapshot,
      };
      if (extras) Object.assign(entry, extras);
      if (existing.favorite) entry.favorite = true;
      if (properties && Object.keys(properties).length > 0) {
        entry.properties = properties;
      } else if (existing.properties) {
        entry.properties = existing.properties;
      }
      if (existing.meta) entry.meta = existing.meta;
      if (existing.api_properties) entry.api_properties = existing.api_properties;

      const newIndex = index.includes(pageId) ? index : [...index, pageId];
      const toStore = { [pk]: entry, honoka_global_index: newIndex };

      if (limit > 0 && newIndex.length > limit) {
        const allKeys = newIndex.map((id) => _pageKey(id));
        chrome.storage.local.get(allKeys, (allData) => {
          const sorted = newIndex.slice().sort((a, b) => {
            const ea = allData[_pageKey(a)] || {};
            const eb = allData[_pageKey(b)] || {};
            return (eb.last_seen || "").localeCompare(ea.last_seen || "");
          });
          const keep = sorted.slice(0, limit);
          const drop = sorted.slice(limit);
          toStore.honoka_global_index = keep;
          chrome.storage.local.remove(drop.map((id) => _pageKey(id)), () => {
            chrome.storage.local.set(toStore, () => {
              _postToBridge(pageId, entry);
              resolve({ ok: true });
            });
          });
        });
      } else {
        chrome.storage.local.set(toStore, () => {
          _postToBridge(pageId, entry);
          resolve({ ok: true });
        });
      }
    });
  }));
}

function handlePatchPageMeta({ pageId, meta, apiProperties }) {
  return enqueue(() => new Promise((resolve) => {
    const pk = _pageKey(pageId);
    chrome.storage.local.get([pk], (data) => {
      const entry = data[pk];
      if (!entry) { resolve({ ok: false }); return; }
      if (meta) entry.meta = meta;
      if (apiProperties && Object.keys(apiProperties).length > 0) {
        entry.api_properties = apiProperties;
      }
      chrome.storage.local.set({ [pk]: entry }, () => {
        _postToBridge(pageId, entry);
        resolve({ ok: true });
      });
    });
  }));
}

function handlePatchPageTitle({ pageId, title, properties }) {
  return enqueue(() => new Promise((resolve) => {
    const pk = _pageKey(pageId);
    chrome.storage.local.get([pk], (data) => {
      const entry = data[pk];
      if (!entry) { resolve({ ok: false }); return; }
      if (!entry.title || entry.title === "Untitled") {
        entry.title = title;
      }
      if (properties && Object.keys(properties).length > 0) {
        entry.properties = properties;
      }
      chrome.storage.local.set({ [pk]: entry }, () => {
        _postToBridge(pageId, entry);
        resolve({ ok: true });
      });
    });
  }));
}

function handleDeletePages({ pageIds }) {
  return enqueue(() => new Promise((resolve) => {
    const keysToRemove = pageIds.map(_pageKey);
    chrome.storage.local.get(["honoka_global_index"], (data) => {
      const index = (data.honoka_global_index || []).filter((id) => !pageIds.includes(id));
      chrome.storage.local.remove(keysToRemove, () => {
        chrome.storage.local.set({ honoka_global_index: index }, () => {
          resolve({ ok: true, deleted: pageIds.length });
        });
      });
    });
  }));
}

function handleClearAllHistory() {
  return enqueue(() => new Promise((resolve) => {
    chrome.storage.local.get(["honoka_global_index"], (data) => {
      const index = data.honoka_global_index || [];
      const keysToRemove = index.map(_pageKey);
      chrome.storage.local.remove(keysToRemove, () => {
        chrome.storage.local.set({ honoka_global_index: [] }, () => {
          resolve({ ok: true, deleted: index.length });
        });
      });
    });
  }));
}

function handleEnforceLimit({ limit }) {
  return enqueue(() => new Promise((resolve) => {
    chrome.storage.local.get(["honoka_global_index"], (data) => {
      const index = data.honoka_global_index || [];
      if (!limit || limit <= 0 || index.length <= limit) {
        resolve({ ok: true, dropped: 0 });
        return;
      }
      const pageKeys = index.map(_pageKey);
      chrome.storage.local.get(pageKeys, (allData) => {
        const sorted = index.slice().sort((a, b) => {
          const ea = allData[_pageKey(a)] || {};
          const eb = allData[_pageKey(b)] || {};
          return (eb.last_seen || "").localeCompare(ea.last_seen || "");
        });
        const keep = sorted.slice(0, limit);
        const drop = sorted.slice(limit);
        chrome.storage.local.remove(drop.map(_pageKey), () => {
          chrome.storage.local.set({ honoka_global_index: keep }, () => {
            resolve({ ok: true, dropped: drop.length });
          });
        });
      });
    });
  }));
}

// ── Message handler ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "updateBadge" && sender.tab?.id) {
    const text = msg.totalTokens >= 1000
      ? Math.round(msg.totalTokens / 1000) + "k"
      : String(msg.totalTokens);

    const color = msg.totalTokens > 50000
      ? "#d93025"
      : msg.totalTokens > 20000
        ? "#f4b400"
        : "#0f9d58";

    chrome.action.setBadgeText({ text, tabId: sender.tab.id });
    chrome.action.setBadgeBackgroundColor({ color, tabId: sender.tab.id });
  }

  if (msg.action === "getTitleFromHistory" && msg.url) {
    chrome.history.search({ text: "", maxResults: 500, startTime: 0 }, (results) => {
      if (chrome.runtime.lastError || !results) {
        sendResponse({ title: null });
        return;
      }
      let match = results.find((r) => r.url === msg.url);
      if (!match && msg.pageId) {
        match = results.find((r) => r.url && r.url.includes(msg.pageId));
      }
      const title = match?.title || null;
      if (title) {
        const cleaned = title.replace(/\s*[|–—]\s*Notion\s*$/, "").trim();
        sendResponse({ title: cleaned || title });
      } else {
        sendResponse({ title: null });
      }
    });
    return true;
  }

  if (msg.action === "upsertPageEntry") {
    handleUpsertPageEntry(msg).then((r) => sendResponse(r));
    return true;
  }

  if (msg.action === "patchPageMeta") {
    handlePatchPageMeta(msg).then((r) => sendResponse(r));
    return true;
  }

  if (msg.action === "patchPageTitle") {
    handlePatchPageTitle(msg).then((r) => sendResponse(r));
    return true;
  }

  if (msg.action === "refreshPageMeta") {
    const pageIds = msg.pageIds || [];
    refreshViaDirectFetch(pageIds)
      .then((result) => sendResponse(result))
      .catch(() => {
        refreshViaContentScript(pageIds)
          .then((result) => sendResponse(result))
          .catch(() => sendResponse({ ok: false, error: "No Notion tab open and direct API call failed" }));
      });
    return true;
  }

  if (msg.action === "deletePages") {
    handleDeletePages(msg).then((r) => sendResponse(r));
    return true;
  }

  if (msg.action === "clearAllHistory") {
    handleClearAllHistory().then((r) => sendResponse(r));
    return true;
  }

  if (msg.action === "enforceLimit") {
    handleEnforceLimit(msg).then((r) => sendResponse(r));
    return true;
  }
});

// ── Direct API fetch from service worker ────────────────────────────

function fmtUUID(raw) {
  const hex = raw.replace(/-/g, "");
  if (hex.length !== 32) return raw;
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function richText(arr) {
  if (!arr || !Array.isArray(arr)) return "";
  return arr.map((s) => (Array.isArray(s) ? s[0] : s) || "").join("");
}

function extractPropsFromSchema(page, schema, users) {
  if (!page?.properties || !schema) return null;
  const props = {};
  for (const [propId, propDef] of Object.entries(schema)) {
    if (propId === "title") continue;
    const raw = page.properties[propId];
    if (!raw) continue;
    const name = propDef.name;
    const type = propDef.type;
    let value;

    if (type === "person" || type === "people") {
      const names = [];
      if (Array.isArray(raw)) {
        for (const seg of raw) {
          if (!Array.isArray(seg?.[1])) continue;
          for (const anno of seg[1]) {
            if (anno[0] === "u" && anno[1] && users?.[anno[1]]?.value) {
              names.push(users[anno[1]].value.name);
            }
          }
        }
      }
      value = names.length > 0 ? names.join(", ") : richText(raw);
    } else if (type === "date") {
      const dateAnno = raw?.[0]?.[1]?.find?.((a) => a[0] === "d");
      if (dateAnno) {
        value = dateAnno[1].start_date || "";
        if (dateAnno[1].end_date) value += ` → ${dateAnno[1].end_date}`;
      } else {
        value = richText(raw);
      }
    } else if (type === "checkbox") {
      value = richText(raw) === "Yes" ? "Yes" : "No";
    } else if (type === "created_time") {
      value = page.created_time ? new Date(page.created_time).toISOString().slice(0, 10) : "";
    } else if (type === "created_by") {
      value = page.created_by_id && users?.[page.created_by_id]?.value
        ? users[page.created_by_id].value.name : "";
    } else if (type === "last_edited_time") {
      value = page.last_edited_time ? new Date(page.last_edited_time).toISOString().slice(0, 10) : "";
    } else if (type === "last_edited_by") {
      value = page.last_edited_by_id && users?.[page.last_edited_by_id]?.value
        ? users[page.last_edited_by_id].value.name : "";
    } else if (type === "relation") {
      const ids = [];
      if (Array.isArray(raw)) {
        for (const seg of raw) {
          if (Array.isArray(seg?.[1])) {
            for (const anno of seg[1]) {
              if (anno[0] === "p" && anno[1]) ids.push(anno[1].slice(0, 8));
            }
          }
        }
      }
      value = ids.length > 0 ? `${ids.length} linked` : "";
    } else {
      value = richText(raw);
    }

    if (value) props[name] = { value, type };
  }
  return Object.keys(props).length > 0 ? props : null;
}

async function refreshViaDirectFetch(pageIds) {
  const results = {};
  for (const pid of pageIds) {
    try {
      const resp = await fetch("https://www.notion.so/api/v3/loadPageChunk", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId: fmtUUID(pid),
          limit: 30,
          cursor: { stack: [] },
          chunkNumber: 0,
          verticalColumns: false,
        }),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const rm = data.recordMap || {};
      const blocks = rm.block || {};
      const users = rm.notion_user || {};
      const collections = rm.collection || {};
      const page = blocks[pid]?.value || blocks[fmtUUID(pid)]?.value;
      if (!page) continue;

      const meta = {
        created_time: page.created_time,
        last_edited_time: page.last_edited_time,
      };
      const apiTitle = richText(page.properties?.title);
      if (apiTitle) meta.api_title = apiTitle;
      const missingUserIds = [];
      if (page.created_by_id && users[page.created_by_id]?.value) {
        meta.created_by = users[page.created_by_id].value.name;
      } else if (page.created_by_id) {
        missingUserIds.push(page.created_by_id);
      }
      if (page.last_edited_by_id && users[page.last_edited_by_id]?.value) {
        meta.last_edited_by = users[page.last_edited_by_id].value.name;
      } else if (page.last_edited_by_id) {
        missingUserIds.push(page.last_edited_by_id);
      }
      if (missingUserIds.length > 0) {
        try {
          const uResp = await fetch("https://www.notion.so/api/v3/getRecordValues", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requests: [...new Set(missingUserIds)].map((id) => ({ table: "notion_user", id })) }),
          });
          if (uResp.ok) {
            const uData = await uResp.json();
            (uData.results || []).forEach((r) => {
              if (!r?.value) return;
              if (r.value.id === page.created_by_id && !meta.created_by) meta.created_by = r.value.name;
              if (r.value.id === page.last_edited_by_id && !meta.last_edited_by) meta.last_edited_by = r.value.name;
            });
          }
        } catch {}
      }

      let apiProps = null;
      if (page.parent_table === "collection" && page.parent_id) {
        const coll = collections[page.parent_id];
        if (coll?.value?.schema) {
          apiProps = extractPropsFromSchema(page, coll.value.schema, users);
        }
      }

      results[pid] = { meta, apiProps };
    } catch { /* skip this page */ }
  }

  if (Object.keys(results).length === 0 && pageIds.length > 0) {
    throw new Error("No results from direct fetch");
  }

  // Serialized via queue to prevent race with content script writes
  return enqueue(() => new Promise((resolve) => {
    const pageKeys = Object.keys(results).map((pid) => _pageKey(pid));
    chrome.storage.local.get(pageKeys, (stored) => {
      let updated = 0;
      const toStore = {};
      for (const [pid, { meta, apiProps }] of Object.entries(results)) {
        const key = _pageKey(pid);
        const entry = stored[key];
        if (entry) {
          entry.meta = meta;
          if (apiProps) entry.api_properties = apiProps;
          if (meta.api_title) {
            const cur = entry.title;
            if (!cur || cur === "Untitled" || meta.api_title.length > cur.length) {
              entry.title = meta.api_title;
            }
          }
          toStore[key] = entry;
          updated++;
        }
      }
      chrome.storage.local.set(toStore, () => {
        resolve({ ok: true, updated, total: pageIds.length });
      });
    });
  }));
}

// ── Fallback: forward to content script on a Notion tab ─────────────

async function refreshViaContentScript(pageIds) {
  const tabs = await chrome.tabs.query({ url: ["https://*.notion.so/*", "https://notion.so/*"] });
  if (tabs.length === 0) throw new Error("No Notion tabs open");

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: "fetchPageMeta", pageIds }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(resp || { ok: true });
      }
    });
  });
}
