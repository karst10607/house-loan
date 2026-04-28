// ══════════════════════════════════════════════════════════════════════
// Honoka Options — Doc Library with sidebar, folders, drag-and-drop
// ══════════════════════════════════════════════════════════════════════

const $ = (sel) => document.querySelector(sel);
const statusEl = $("#status");
const deleteBtn = $("#delete-selected");
const selectInfo = $("#select-info");
const limitSelect = $("#history-limit");
const viewTitle = $("#view-title");

function showSyncDot(on) {
  const dot = viewTitle.querySelector(".live-dot");
  if (dot) dot.classList.toggle("active", on);
}

let selectedIds = new Set();
let localSelected = new Set();
let currentView = "all"; // "all" | "favorites" | "recent" | "local" | "folder:<id>"
let allHistory = {};
let allFolders = []; // [ { id, name, pageIds:[], collapsed? } ]
let localDocs = []; // from bridge /list
let allNotes = {}; // { pageId_or_"local:folder" → note string }
let allFlags = {}; // { key → "green" | "red" }
let bridgeOk = false;
let currentTemplateFolder = null; // folder name of the active baseline template
let registeredTemplates = []; // [{ folder, title, label, config }] from Bridge

// Column visibility and sort state
const BUILTIN_COLUMNS = [
  { id: "title", label: "Title", fixed: true },
  { id: "tokens", label: "Tokens" },
  { id: "visits", label: "Visits" },
  { id: "edited_by", label: "Last edited by" },
  { id: "edited_time", label: "Edited" },
  { id: "created_by", label: "Created by" },
  { id: "created_time", label: "Created" },
  { id: "last_seen", label: "Last seen" },
  { id: "page_id", label: "Page UUID" },
  { id: "mermaid", label: "Mermaid" },
];

const LOCAL_COLUMNS = [
  { id: "title", label: "Title", fixed: true },
  { id: "category", label: "Category" },
  { id: "page_id", label: "Page UUID" },
  { id: "images", label: "Images" },
  { id: "mermaid", label: "Mermaid" },
  { id: "plantuml", label: "PlantUML" },
  { id: "drawio", label: "Draw.io" },
  { id: "size", label: "Size" },
  { id: "modified", label: "Last modified" },
  { id: "source", label: "Source" },
];

let visibleColumns = new Set(["title", "tokens", "visits", "edited_by", "edited_time", "last_seen"]);
let hiddenColumns = new Set();
let visibleLocalColumns = new Set(["title", "category", "images", "mermaid", "size", "modified", "source"]);
let sortColumn = "last_seen";
let sortDirection = "desc";
let searchQuery = "";

let _localChooserClickHandler = null;

const isLite = chrome.runtime.getManifest().name.includes("Lite");
const BRIDGE_URL = isLite ? "http://127.0.0.1:44124" : "http://127.0.0.1:7749";

// ══════════════════════════════════════════════════════════════════════
// ── Storage helpers (split-key layout) ──
// ══════════════════════════════════════════════════════════════════════

function _pageKey(id) { return `honoka_page_${id}`; }

function loadAll(cb) {
  chrome.storage.local.get({
    honoka_global_index: null,
    honoka_history: null,
    honoka_history_limit: 200,
    honoka_my_name: "",
    honoka_notion_user: null,
    honoka_folders: [],
    honoka_playlists: [],
    honoka_visible_columns: null,
    honoka_hidden_columns: null,
    honoka_visible_local_columns: null,
    honoka_sort_column: "last_seen",
    honoka_sort_direction: "desc",
    honoka_notes: {},
    honoka_flags: {},
    honoka_active_template: null,
  }, (data) => {
    currentTemplateFolder = data.honoka_active_template || null;
    allFolders = data.honoka_folders;
    allNotes = data.honoka_notes || {};
    allFlags = data.honoka_flags || {};
    limitSelect.value = String(data.honoka_history_limit);
    const myNameInput = $("#my-name");
    if (myNameInput) myNameInput.value = data.honoka_my_name || "";
    const badge = $("#notion-user-badge");
    if (badge && data.honoka_notion_user?.name) {
      badge.textContent = `Notion: ${data.honoka_notion_user.name}`;
      badge.title = `Auto-detected — ID: ${data.honoka_notion_user.id}`;
      badge.style.display = "";
    }
    if (data.honoka_visible_columns) {
      visibleColumns = new Set(data.honoka_visible_columns);
      visibleColumns.add("title");
    }
    if (data.honoka_hidden_columns) {
      hiddenColumns = new Set(data.honoka_hidden_columns);
    }
    if (data.honoka_visible_local_columns) {
      visibleLocalColumns = new Set(data.honoka_visible_local_columns);
      visibleLocalColumns.add("title");
    }
    sortColumn = data.honoka_sort_column || "last_seen";
    sortDirection = data.honoka_sort_direction || "desc";

    if (data.honoka_playlists.length > 0 && allFolders.length === 0) {
      allFolders = data.honoka_playlists.map((pl) => ({
        id: genId(),
        name: pl.name,
        pageIds: pl.pageIds || [],
      }));
      chrome.storage.local.set({ honoka_folders: allFolders, honoka_playlists: [] });
    }

    if (data.honoka_global_index) {
      _loadSplitKeys(data.honoka_global_index, cb);
    } else if (data.honoka_history && Object.keys(data.honoka_history).length > 0) {
      allHistory = data.honoka_history;
      _migrateFromLegacy(data.honoka_history, cb);
    } else {
      allHistory = {};
      if (cb) cb();
    }
  });
}

function _loadSplitKeys(index, cb) {
  const keys = index.map(_pageKey);
  chrome.storage.local.get(keys, (pageData) => {
    allHistory = {};
    for (const id of index) {
      const entry = pageData[_pageKey(id)];
      if (entry) allHistory[id] = entry;
    }
    if (cb) cb();
  });
}

function _migrateFromLegacy(legacy, cb) {
  console.log(`Honoka: migrating ${Object.keys(legacy).length} entries from legacy honoka_history → split keys`);
  const toStore = { honoka_global_index: Object.keys(legacy) };
  for (const [id, entry] of Object.entries(legacy)) {
    toStore[_pageKey(id)] = entry;
  }
  chrome.storage.local.set(toStore, () => {
    const verifyKeys = Object.keys(legacy).map(_pageKey);
    chrome.storage.local.get(verifyKeys, (check) => {
      const writtenCount = Object.keys(check).filter((k) => check[k]).length;
      if (writtenCount === Object.keys(legacy).length) {
        console.log(`Honoka: migration verified (${writtenCount} entries). Removing legacy key.`);
        chrome.storage.local.remove("honoka_history");
      } else {
        console.warn(`Honoka: migration mismatch (${writtenCount}/${Object.keys(legacy).length}). Keeping legacy key as fallback.`);
      }
      if (cb) cb();
    });
  });
}

function saveFolders(cb) {
  chrome.storage.local.set({ honoka_folders: allFolders }, cb);
}

function _saveSingleEntry(id, cb) {
  chrome.storage.local.set({ [_pageKey(id)]: allHistory[id] }, cb);
}

function saveNotes(cb) {
  chrome.storage.local.set({ honoka_notes: allNotes }, cb);
}

function saveFlags(cb) {
  chrome.storage.local.set({ honoka_flags: allFlags }, cb);
}

function noteKeyForDoc(doc) {
  return doc.pageId || `local:${doc.folder}`;
}

function buildFlagNoteHtml(key) {
  const flag = allFlags[key] || "";
  const note = allNotes[key] || "";
  const greenCls = flag === "green" ? " active" : "";
  const redCls = flag === "red" ? " active" : "";
  const dots = `<span class="doc-flags"><span class="doc-flag doc-flag-green${greenCls}" data-flag-key="${escapeHtml(key)}" data-flag="green" title="Mark green (positive)">●</span><span class="doc-flag doc-flag-red${redCls}" data-flag-key="${escapeHtml(key)}" data-flag="red" title="Mark red (negative)">●</span></span>`;
  const noteHtml = note
    ? `<div class="doc-note"><span class="doc-note-text">${escapeHtml(note)}</span><button class="edit-note-btn" data-note-key="${escapeHtml(key)}" title="Edit note">✎</button></div>`
    : `<button class="add-note-btn" data-note-key="${escapeHtml(key)}" title="Add note">+ note</button>`;
  return `<div class="doc-meta-line">${dots}${noteHtml}</div>`;
}

function wireDocFlags(container) {
  container.querySelectorAll(".doc-flag").forEach((dot) => {
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = dot.dataset.flagKey;
      const color = dot.dataset.flag;
      if (allFlags[key] === color) {
        delete allFlags[key];
      } else {
        allFlags[key] = color;
      }
      saveFlags(() => renderAll());
    });
  });
}

// ══════════════════════════════════════════════════════════════════════
// ── Live updates via storage change listener ──
// ══════════════════════════════════════════════════════════════════════

let _onChangedRenderTimer = null;
let _onChangedOnlyPages = true;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let needRender = false;
  for (const key of Object.keys(changes)) {
    if (key.startsWith("honoka_page_")) {
      const pageId = key.slice(12);
      if (changes[key].newValue) {
        allHistory[pageId] = changes[key].newValue;
      } else {
        delete allHistory[pageId];
      }
      needRender = true;
    }
  }
  if (changes.honoka_folders) {
    allFolders = changes.honoka_folders.newValue || [];
    needRender = true;
    _onChangedOnlyPages = false;
  }
  if (changes.honoka_notes) {
    allNotes = changes.honoka_notes.newValue || {};
    needRender = true;
    _onChangedOnlyPages = false;
  }
  if (changes.honoka_flags) {
    allFlags = changes.honoka_flags.newValue || {};
    needRender = true;
    _onChangedOnlyPages = false;
  }
  if (!needRender) return;
  // Debounce: batch rapid-fire storage changes and avoid double-render
  // when save callbacks already call renderAll() directly.
  clearTimeout(_onChangedRenderTimer);
  _onChangedRenderTimer = setTimeout(() => {
    const onlyPages = _onChangedOnlyPages;
    _onChangedOnlyPages = true;
    if (onlyPages && currentView.startsWith("local")) {
      renderSidebar();
    } else {
      renderAll();
    }
  }, 150);
});

// ══════════════════════════════════════════════════════════════════════
// ── Settings ──
// ══════════════════════════════════════════════════════════════════════

limitSelect.addEventListener("change", () => {
  const limit = parseInt(limitSelect.value, 10);
  chrome.storage.local.set({ honoka_history_limit: limit }, () => {
    if (limit > 0) enforceLimit(limit);
    showStatus("Saved.");
  });
});

$("#my-name").addEventListener("change", () => {
  const name = $("#my-name").value.trim();
  chrome.storage.local.set({ honoka_my_name: name }, () => {
    showStatus(name ? `Name set to "${name}" — your Notion pages will auto-tag as Mine.` : "Name cleared.");
  });
});

function enforceLimit(limit) {
  if (!limit || limit <= 0) return;
  if (Object.keys(allHistory).length <= limit) return;
  chrome.runtime.sendMessage({ action: "enforceLimit", limit });
}

// ══════════════════════════════════════════════════════════════════════
// ── Sidebar navigation ──
// ══════════════════════════════════════════════════════════════════════

document.querySelectorAll(".sidebar-item-fixed").forEach((item) => {
  item.addEventListener("click", () => {
    currentView = item.dataset.view;
    renderAll();
  });
});

// ── New folder ──

$("#new-folder-btn").addEventListener("click", () => {
  showModal("New folder", "", (name) => {
    if (!name) return;
    allFolders.push({ id: genId(), name, pageIds: [] });
    saveFolders(() => renderAll());
  });
});

// ══════════════════════════════════════════════════════════════════════
// ── Render everything ──
// ══════════════════════════════════════════════════════════════════════

function renderAll() {
  renderSidebar();
  renderMainTable();
}

// ══════════════════════════════════════════════════════════════════════
// ── Sidebar: folder tree ──
// ══════════════════════════════════════════════════════════════════════

function renderSidebar() {
  // Update badges
  const allCount = Object.keys(allHistory).length;
  const favCount = Object.values(allHistory).filter((h) => h.favorite).length;
  $("#badge-all").textContent = allCount || "";
  $("#badge-favs").textContent = favCount || "";

  // Highlight active fixed item
  document.querySelectorAll(".sidebar-item-fixed").forEach((item) => {
    item.classList.toggle("active", currentView === item.dataset.view);
  });

  // Render folder tree
  const treeEl = $("#folder-tree");
  treeEl.innerHTML = "";

  allFolders.forEach((folder, fi) => {
    const div = document.createElement("div");
    div.className = "ft-folder";
    div.dataset.folderId = folder.id;

    const isActive = currentView === `folder:${folder.id}`;
    const collapsed = folder.collapsed;

    // Folder row
    const row = document.createElement("div");
    row.className = "ft-folder-row" + (isActive ? " active" : "");
    row.innerHTML = `
      <span class="ft-caret ${collapsed ? "" : "open"}">▶</span>
      <span class="ft-folder-name">${escapeHtml(folder.name)}</span>
      <span class="ft-count">${folder.pageIds.length}</span>
      <span class="ft-folder-actions">
        <button class="ft-move-up" title="Move up" ${fi === 0 ? "disabled" : ""}>↑</button>
        <button class="ft-move-down" title="Move down" ${fi === allFolders.length - 1 ? "disabled" : ""}>↓</button>
        <button class="ft-rename" title="Rename">✎</button>
        <button class="ft-delete-folder" title="Delete folder">×</button>
      </span>
    `;

    // Click folder name to select view
    row.addEventListener("click", (e) => {
      if (e.target.closest(".ft-folder-actions")) return;
      if (e.target.closest(".ft-caret")) {
        folder.collapsed = !folder.collapsed;
        saveFolders(() => renderSidebar());
        return;
      }
      currentView = `folder:${folder.id}`;
      renderAll();
    });

    // Drag-over: accept page drops
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      const pageId = e.dataTransfer.getData("text/page-id");
      if (pageId) addToFolder(folder.id, pageId);
    });

    // Rename
    row.querySelector(".ft-rename").addEventListener("click", (e) => {
      e.stopPropagation();
      showModal("Rename folder", folder.name, (name) => {
        if (!name) return;
        folder.name = name;
        saveFolders(() => renderAll());
      });
    });

    // Delete folder
    row.querySelector(".ft-delete-folder").addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm(`Delete folder "${folder.name}"? Pages will NOT be deleted from history.`)) return;
      allFolders.splice(fi, 1);
      if (currentView === `folder:${folder.id}`) currentView = "all";
      saveFolders(() => renderAll());
    });

    // Move folder up/down
    row.querySelector(".ft-move-up").addEventListener("click", (e) => {
      e.stopPropagation();
      if (fi === 0) return;
      [allFolders[fi - 1], allFolders[fi]] = [allFolders[fi], allFolders[fi - 1]];
      saveFolders(() => renderSidebar());
    });
    row.querySelector(".ft-move-down").addEventListener("click", (e) => {
      e.stopPropagation();
      if (fi >= allFolders.length - 1) return;
      [allFolders[fi], allFolders[fi + 1]] = [allFolders[fi + 1], allFolders[fi]];
      saveFolders(() => renderSidebar());
    });

    div.appendChild(row);

    // Children (pages inside folder)
    const childrenEl = document.createElement("div");
    childrenEl.className = "ft-children" + (collapsed ? " collapsed" : "");

    folder.pageIds.forEach((pid, pi) => {
      const page = allHistory[pid];
      const title = page ? (page.title || "Untitled") : `[removed]`;
      const pageEl = document.createElement("div");
      pageEl.className = "ft-page";
      pageEl.draggable = true;
      pageEl.dataset.pageId = pid;
      pageEl.dataset.folderIdx = fi;
      pageEl.dataset.pageIdx = pi;
      pageEl.innerHTML = `
        <span class="ft-page-icon">${page?.favorite ? "★" : "📝"}</span>
        <span class="ft-page-title">${escapeHtml(title)}</span>
        <button class="ft-page-remove" title="Remove from folder">×</button>
      `;

      // Drag start
      pageEl.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/page-id", pid);
        e.dataTransfer.setData("text/source-folder", folder.id);
        pageEl.classList.add("dragging");
      });
      pageEl.addEventListener("dragend", () => pageEl.classList.remove("dragging"));

      // Drop on page = reorder within folder
      pageEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      pageEl.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const draggedId = e.dataTransfer.getData("text/page-id");
        const srcFolder = e.dataTransfer.getData("text/source-folder");
        if (draggedId && srcFolder === folder.id) {
          reorderInFolder(folder, draggedId, pi);
        } else if (draggedId) {
          // Move from another folder or from history
          removeFromAllFolders(draggedId);
          folder.pageIds.splice(pi, 0, draggedId);
          saveFolders(() => renderAll());
        }
      });

      // Remove from folder
      pageEl.querySelector(".ft-page-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        folder.pageIds.splice(pi, 1);
        saveFolders(() => renderAll());
      });

      // Click to open page
      pageEl.addEventListener("click", (e) => {
        if (e.target.closest(".ft-page-remove")) return;
        if (page?.url) window.open(page.url, "_blank");
      });

      childrenEl.appendChild(pageEl);
    });

    div.appendChild(childrenEl);
    treeEl.appendChild(div);
  });
}

// ══════════════════════════════════════════════════════════════════════
// ── Main table ──
// ══════════════════════════════════════════════════════════════════════

function getAllPropertyColumns(entries) {
  const propMap = new Map();
  entries.forEach((e) => {
    const ap = e.api_properties;
    if (ap) {
      for (const [name, info] of Object.entries(ap)) {
        if (!propMap.has(name)) propMap.set(name, info.type || "text");
      }
    }
    // Also include DOM-scraped properties as fallback
    if (e.properties) {
      for (const k of Object.keys(e.properties)) {
        if (!propMap.has(k)) propMap.set(k, "text");
      }
    }
  });
  return [...propMap.entries()].map(([name, type]) => ({ id: `prop:${name}`, label: name, type, isProp: true }));
}

function getCellValue(entry, colId) {
  const meta = entry.meta || {};
  switch (colId) {
    case "title": return entry.title || "Untitled";
    case "tokens": return entry.token_snapshot ?? null;
    case "visits": return entry.visit_count || 1;
    case "edited_by": return meta.last_edited_by || "";
    case "edited_time": return meta.last_edited_time || 0;
    case "created_by": return meta.created_by || "";
    case "created_time": return meta.created_time || 0;
    case "last_seen": return entry.last_seen || "";
    case "page_id": return entry.id || "";
    case "mermaid": return entry.totalMermaid ?? 0;
    default:
      if (colId.startsWith("prop:")) {
        const propName = colId.slice(5);
        const ap = entry.api_properties?.[propName];
        if (ap) return ap.value || "";
        return entry.properties?.[propName] || "";
      }
      return "";
  }
}

function formatCellDisplay(entry, colId) {
  const meta = entry.meta || {};
  switch (colId) {
    case "tokens": return entry.token_snapshot != null ? entry.token_snapshot.toLocaleString() : "—";
    case "visits": return String(entry.visit_count || 1);
    case "edited_by": return meta.last_edited_by || "";
    case "edited_time": return meta.last_edited_time ? timeAgo(new Date(meta.last_edited_time).toISOString()) : "";
    case "created_by": return meta.created_by || "";
    case "created_time": return meta.created_time ? timeAgo(new Date(meta.created_time).toISOString()) : "";
    case "last_seen": return entry.last_seen ? timeAgo(entry.last_seen) : "—";
    case "page_id": return entry.id || "—";
    case "mermaid": return entry.totalMermaid ? String(entry.totalMermaid) : "0";
    default:
      if (colId.startsWith("prop:")) {
        const propName = colId.slice(5);
        const ap = entry.api_properties?.[propName];
        if (ap) return ap.value || "";
        return entry.properties?.[propName] || "";
      }
      return "";
  }
}

function sortEntries(entries) {
  return entries.sort((a, b) => {
    // Favorites always first
    if (a.favorite && !b.favorite) return -1;
    if (!a.favorite && b.favorite) return 1;

    const va = getCellValue(a, sortColumn);
    const vb = getCellValue(b, sortColumn);
    let cmp = 0;
    if (typeof va === "number" && typeof vb === "number") {
      cmp = va - vb;
    } else {
      cmp = String(va).localeCompare(String(vb));
    }
    return sortDirection === "desc" ? -cmp : cmp;
  });
}

function renderMainTable() {
  let entries = Object.entries(allHistory).map(([id, v]) => ({ id, ...v }));
  let title = "All pages";

  if (currentView === "local" || currentView === "local:mine" || currentView === "local:reference") {
    return renderLocalDocs();
  }
  localSelected.clear();

  // Prune stale selectedIds (entries that no longer exist)
  for (const id of selectedIds) {
    if (!allHistory[id]) selectedIds.delete(id);
  }
  updateDeleteBtn();
  if (currentView === "favorites") {
    entries = entries.filter((e) => e.favorite);
    title = "Favorites";
  } else if (currentView === "recent") {
    entries = entries.sort((a, b) => (b.last_seen || "").localeCompare(a.last_seen || "")).slice(0, 30);
    title = "Recent (last 30)";
  } else if (currentView.startsWith("folder:")) {
    const folderId = currentView.split(":")[1];
    const folder = allFolders.find((f) => f.id === folderId);
    if (folder) {
      entries = folder.pageIds.map((id) => allHistory[id] ? { id, ...allHistory[id] } : null).filter(Boolean);
      title = folder.name;
    }
  }

  // Apply search filter
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    entries = entries.filter((e) => {
      if ((e.title || "").toLowerCase().includes(q)) return true;
      if ((e.url || "").toLowerCase().includes(q)) return true;
      const meta = e.meta || {};
      if ((meta.last_edited_by || "").toLowerCase().includes(q)) return true;
      if ((meta.created_by || "").toLowerCase().includes(q)) return true;
      // Search DOM-scraped properties
      if (e.properties) {
        for (const v of Object.values(e.properties)) {
          if (String(v).toLowerCase().includes(q)) return true;
        }
      }
      // Search API-extracted properties
      if (e.api_properties) {
        for (const info of Object.values(e.api_properties)) {
          if (String(info.value || "").toLowerCase().includes(q)) return true;
        }
      }
      // Search notes
      if (allNotes[e.id] && allNotes[e.id].toLowerCase().includes(q)) return true;
      return false;
    });
  }

  // Sort entries
  entries = sortEntries(entries);

  viewTitle.innerHTML = `${escapeHtml(title)} <span class="live-dot" title="Syncing…"></span>`;

  const totalCount = Object.keys(allHistory).length;
  const statsText = searchQuery
    ? `${entries.length} matches · ${totalCount} total`
    : `${totalCount} total · ${entries.length} shown`;
  $("#select-info").textContent = selectedIds.size > 0 ? `${selectedIds.size} selected` : statsText;

  const tableEl = $("#history-table");
  if (entries.length === 0) {
    tableEl.innerHTML = '<div class="empty-state">No pages here yet.</div>';
    return;
  }

  // Build all available columns (built-in + property columns)
  const propColumns = getAllPropertyColumns(entries);
  const allColumns = [...BUILTIN_COLUMNS, ...propColumns];

  // Auto-add new property columns to visibility (skip user-hidden ones)
  propColumns.forEach((pc) => {
    if (!visibleColumns.has(pc.id) && !hiddenColumns.has(pc.id) && visibleColumns.size < 12) {
      visibleColumns.add(pc.id);
    }
  });

  // Filter to visible columns only
  const shownCols = allColumns.filter((c) => visibleColumns.has(c.id));

  // Build folder dropdown for adding
  let folderOpts = '<option value="">+ Folder</option>';
  allFolders.forEach((f) => {
    folderOpts += `<option value="${f.id}">${escapeHtml(f.name)}</option>`;
  });

  // Column headers with sort arrows
  let headerCells = `<th class="check-col"><input type="checkbox" id="select-all" title="Select all"></th>
    <th class="fav-col">★</th><th></th>`;
  shownCols.forEach((col) => {
    const isSorted = sortColumn === col.id;
    const arrow = isSorted ? (sortDirection === "asc" ? " ▲" : " ▼") : "";
    const cls = isSorted ? "sort-active" : "sortable";
    headerCells += `<th class="${cls}" data-sort="${col.id}">${escapeHtml(col.label)}${arrow}</th>`;
  });
  headerCells += `<th>Folder</th>`;

  let html = `<table><thead><tr>${headerCells}</tr></thead><tbody>`;

  // Build a set of page IDs that have local copies
  const localPageIds = new Set(localDocs.map((d) => d.pageId).filter(Boolean));
  const localFolderByPageId = {};
  localDocs.forEach((d) => { if (d.pageId) localFolderByPageId[d.pageId] = d.folder; });

  entries.forEach((e) => {
    const favClass = e.favorite ? "fav-active" : "";
    const hasLocal = localPageIds.has(e.id);
    const localFolder = localFolderByPageId[e.id] || "";
    const localIcons = hasLocal
      ? `<button class="local-indicator" data-folder="${escapeHtml(localFolder)}" title="Open in Cursor">💾</button><button class="local-preview-inline" data-folder="${escapeHtml(localFolder)}" title="Preview">👁</button><button class="local-diff-inline" data-folder="${escapeHtml(localFolder)}" title="Diff previous vs current">⇄</button>`
      : "";

    let cells = `<td class="check-col"><input type="checkbox" class="row-check" data-id="${e.id}"></td>
      <td class="fav-col"><button class="fav-btn ${favClass}" data-id="${e.id}">★</button></td>
      <td><span class="drag-handle" title="Drag to sidebar folder">⠿</span></td>`;

    shownCols.forEach((col) => {
      if (col.id === "title") {
        const t = e.title || "Untitled";
        const link = e.url ? `<a href="${e.url}" target="_blank" title="${escapeHtml(t)}">${escapeHtml(t)}</a>` : `<span title="${escapeHtml(t)}">${escapeHtml(t)}</span>`;
        const metaLine = buildFlagNoteHtml(e.id);
        cells += `<td class="title-cell copyable" title="${escapeHtml(t)}" data-copy="${escapeHtml(t)}">${link} ${localIcons}<button class="edit-title-btn" data-id="${e.id}" title="Edit title">✎</button>${metaLine}<span class="copy-btn">📋</span></td>`;
      } else if (col.id === "tokens" || col.id === "visits" || col.id === "mermaid") {
        cells += `<td class="num">${formatCellDisplay(e, col.id)}</td>`;
      } else if (col.id === "edited_time" || col.id === "created_time") {
        const ts = col.id === "edited_time" ? e.meta?.last_edited_time : e.meta?.created_time;
        const tooltip = ts ? new Date(ts).toLocaleString() : "";
        const full = ts ? new Date(ts).toLocaleString() : "";
        cells += `<td class="meta-cell copyable" title="${escapeHtml(tooltip)}" data-copy="${escapeHtml(full)}">${formatCellDisplay(e, col.id)}<span class="copy-btn">📋</span></td>`;
      } else if (col.isProp) {
        const val = formatCellDisplay(e, col.id);
        cells += `<td class="prop-cell copyable" title="${escapeHtml(val)}" data-copy="${escapeHtml(val)}">${escapeHtml(val)}<span class="copy-btn">📋</span></td>`;
      } else {
        const val = formatCellDisplay(e, col.id);
        cells += `<td class="meta-cell copyable" title="${escapeHtml(val)}" data-copy="${escapeHtml(val)}">${escapeHtml(val)}<span class="copy-btn">📋</span></td>`;
      }
    });

    cells += `<td><select class="folder-drop-select" data-id="${e.id}">${folderOpts}</select></td>`;
    html += `<tr data-id="${e.id}" draggable="true">${cells}</tr>`;
  });
  html += `</tbody></table>`;
  tableEl.innerHTML = html;

  // Restore checkbox state from selectedIds
  tableEl.querySelectorAll(".row-check").forEach((cb) => {
    if (selectedIds.has(cb.dataset.id)) cb.checked = true;
  });

  // ── Wire copy buttons ──
  tableEl.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const val = btn.closest("[data-copy]")?.dataset.copy;
      if (!val) return;
      navigator.clipboard.writeText(val).then(() => {
        btn.textContent = "✓";
        setTimeout(() => { btn.textContent = "📋"; }, 1000);
      });
    });
  });

  // ── Wire events ──

  const selectAll = $("#select-all");
  const rowChecks = tableEl.querySelectorAll(".row-check");

  selectAll.addEventListener("change", () => {
    rowChecks.forEach((cb) => {
      cb.checked = selectAll.checked;
      if (selectAll.checked) selectedIds.add(cb.dataset.id);
      else selectedIds.delete(cb.dataset.id);
    });
    updateDeleteBtn();
  });

  rowChecks.forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) selectedIds.add(cb.dataset.id);
      else selectedIds.delete(cb.dataset.id);
      selectAll.checked = selectedIds.size === rowChecks.length;
      selectAll.indeterminate = selectedIds.size > 0 && selectedIds.size < rowChecks.length;
      updateDeleteBtn();
    });
  });

  // Restore select-all indeterminate/checked state after re-render
  if (selectedIds.size > 0) {
    selectAll.checked = selectedIds.size === rowChecks.length;
    selectAll.indeterminate = selectedIds.size > 0 && selectedIds.size < rowChecks.length;
    updateDeleteBtn();
  }

  // Favorites
  tableEl.querySelectorAll(".fav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      if (allHistory[id]) {
        allHistory[id].favorite = !allHistory[id].favorite;
        _saveSingleEntry(id, () => renderAll());
      }
    });
  });

  // Folder add dropdown
  tableEl.querySelectorAll(".folder-drop-select").forEach((sel) => {
    sel.addEventListener("change", () => {
      if (!sel.value) return;
      addToFolder(sel.value, sel.dataset.id);
      sel.value = "";
    });
  });

  // Local indicator → open in Cursor
  tableEl.querySelectorAll(".local-indicator").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openInEditor(btn.dataset.folder, "index.md");
    });
  });

  // Preview inline → open rendered markdown in new tab
  tableEl.querySelectorAll(".local-preview-inline").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.open(`${BRIDGE_URL}/preview?folder=${encodeURIComponent(btn.dataset.folder)}`, "_blank");
    });
  });

  // Diff inline → open side-by-side diff in new tab
  tableEl.querySelectorAll(".local-diff-inline").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.open(`${BRIDGE_URL}/diff?folder=${encodeURIComponent(btn.dataset.folder)}`, "_blank");
    });
  });

  // Title editing
  tableEl.querySelectorAll(".edit-title-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const entry = allHistory[id];
      if (!entry) return;
      showModal("Edit title", entry.title || "", (newTitle) => {
        if (newTitle == null) return;
        allHistory[id].title = newTitle;
        _saveSingleEntry(id, () => renderAll());
        showStatus("Title updated.");
      });
    });
  });

  // Flag dots (history table)
  wireDocFlags(tableEl);

  // Note editing (history table)
  tableEl.querySelectorAll(".edit-note-btn, .add-note-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.noteKey;
      const current = allNotes[key] || "";
      const label = current ? "Edit note" : "Add note";
      showModal(label, current, (val) => {
        if (val == null) return;
        if (val) {
          allNotes[key] = val;
        } else {
          delete allNotes[key];
        }
        saveNotes(() => renderAll());
        showStatus(val ? "Note saved." : "Note removed.");
      }, 200);
    });
  });

  // Sortable column headers
  tableEl.querySelectorAll("th[data-sort]").forEach((th) => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (sortColumn === col) {
        sortDirection = sortDirection === "desc" ? "asc" : "desc";
      } else {
        sortColumn = col;
        sortDirection = "desc";
      }
      chrome.storage.local.set({ honoka_sort_column: sortColumn, honoka_sort_direction: sortDirection });
      renderMainTable();
    });
  });

  // Row drag for sidebar drop
  tableEl.querySelectorAll("tr[draggable]").forEach((tr) => {
    tr.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/page-id", tr.dataset.id);
      e.dataTransfer.setData("text/source-folder", "");
      tr.classList.add("dragging");
    });
    tr.addEventListener("dragend", () => tr.classList.remove("dragging"));
  });
}

function renderLocalDocs() {
  const viewLabels = { "local": "Local docs", "local:mine": "My docs", "local:reference": "References" };
  viewTitle.innerHTML = `${viewLabels[currentView] || "Local docs"} <span class="live-dot" title="Syncing…"></span>`;
  const tableEl = $("#history-table");

  if (!bridgeOk) {
    tableEl.innerHTML = '<div class="empty-state">Bridge not running.<br>Start with: <code>node honoka-bridge/index.js</code></div>';
    return;
  }

  let filteredDocs = localDocs;
  if (currentView === "local:mine") {
    filteredDocs = localDocs.filter((d) => d.category === "mine");
  } else if (currentView === "local:reference") {
    filteredDocs = localDocs.filter((d) => !d.category || d.category === "reference");
  }

  if (filteredDocs.length === 0) {
    tableEl.innerHTML = '<div class="empty-state">No local docs yet. Save a Notion page or create a new doc.</div>';
    return;
  }

  const validFolders = new Set(filteredDocs.map((d) => d.folder));
  for (const f of localSelected) {
    if (!validFolders.has(f)) localSelected.delete(f);
  }
  const shownCols = LOCAL_COLUMNS.filter((c) => visibleLocalColumns.has(c.id));

  let tplOptions = '<option value="">— No template —</option>';
  registeredTemplates.forEach(t => {
    const sel = t.folder === currentTemplateFolder ? " selected" : "";
    tplOptions += `<option value="${escapeHtml(t.folder)}"${sel}>${escapeHtml(t.label || t.title)}</option>`;
  });

  let html = `<div class="local-toolbar">
    <button id="local-compare-btn" class="btn btn-sm btn-secondary hidden">Compare selected</button>
    <button id="local-register-tpl-btn" class="btn btn-sm btn-secondary hidden" title="Register this doc as a reusable comparison template">Register as Template</button>
    <button id="local-diff-template-btn" class="btn btn-sm btn-secondary hidden" title="Open full Myers diff + Heading analysis vs Template">Compare with Template</button>
    <button id="local-batch-compare-btn" class="btn btn-sm btn-secondary hidden" title="Run Template Analysis on all selected docs">Run Template Analysis</button>
    <span id="local-select-info" class="select-info"></span>
    <label class="tpl-dropdown-wrap" style="margin-left:auto; display:flex; align-items:center; gap:4px; font-size:12px;">
      <span>Baseline:</span>
      <select id="local-tpl-select" class="tpl-select" title="Select a registered template as the active baseline">${tplOptions}</select>
      <button id="local-tpl-remove-btn" class="btn-tpl-remove" title="Unregister the selected template" style="display:${currentTemplateFolder ? "inline-block" : "none"}">×</button>
    </label>
    <div class="column-chooser-wrap">
      <button id="local-col-chooser-btn" class="btn btn-sm btn-secondary" title="Choose visible columns">Columns ▾</button>
      <div id="local-col-chooser" class="column-chooser hidden"></div>
    </div>
  </div>`;

  let headerCells = `<th class="check-col"><input type="checkbox" id="local-select-all"></th>`;
  shownCols.forEach((col) => {
    headerCells += `<th>${escapeHtml(col.label)}</th>`;
  });
  headerCells += `<th></th>`;

  html += `<table><thead><tr>${headerCells}</tr></thead><tbody>`;

  filteredDocs.forEach((doc) => {
    const sizeKb = doc.sizeBytes ? Math.round(doc.sizeBytes / 1024) + " KB" : "—";
    const modified = doc.lastModified ? timeAgo(doc.lastModified) : "—";
    const source = doc.notionUrl
      ? `<a href="${doc.notionUrl}" target="_blank" title="Open in Notion">Notion</a>`
      : "Local";

    let cells = `<td class="check-col"><input type="checkbox" class="local-row-check" data-folder="${escapeHtml(doc.folder)}"></td>`;
    shownCols.forEach((col) => {
      switch (col.id) {
        case "title": {
          const nk = noteKeyForDoc(doc);
          const metaLine = buildFlagNoteHtml(nk);
          const tplBadge = doc.isTemplate ? '<span class="tpl-badge" title="Registered template">TPL</span>' : "";
          cells += `<td class="title-cell copyable" title="${escapeHtml(doc.title || doc.folder)}" data-copy="${escapeHtml(doc.title || doc.folder)}">${tplBadge}${escapeHtml(doc.title || doc.folder)}${metaLine}<span class="copy-btn">📋</span></td>`;
          break;
        }
        case "category": {
          const cat = doc.category || "reference";
          const catLabel = cat === "mine" ? "✏️ Mine" : "📎 Ref";
          cells += `<td><select class="cat-select" data-folder="${escapeHtml(doc.folder)}"><option value="mine" ${cat === "mine" ? "selected" : ""}>✏️ Mine</option><option value="reference" ${cat !== "mine" ? "selected" : ""}>📎 Reference</option></select></td>`;
          break;
        }
        case "page_id":
          cells += `<td class="meta-cell copyable" title="${escapeHtml(doc.pageId || "—")}" data-copy="${escapeHtml(doc.pageId || "")}">${escapeHtml(doc.pageId || "—")}<span class="copy-btn">📋</span></td>`;
          break;
        case "images":
          cells += `<td class="num">${doc.imageCount || 0}</td>`;
          break;
        case "mermaid":
          cells += `<td class="num">${doc.mermaidCount || 0}</td>`;
          break;
        case "plantuml":
          cells += `<td class="num">${doc.plantumlCount || 0}</td>`;
          break;
        case "drawio":
          cells += `<td class="num">${doc.drawioCount || 0}</td>`;
          break;
        case "size":
          cells += `<td class="num">${sizeKb}</td>`;
          break;
        case "modified":
          cells += `<td>${modified}</td>`;
          break;
        case "source":
          cells += `<td>${source}</td>`;
          break;
      }
    });
    cells += `<td class="local-actions">
        <button class="btn btn-sm btn-secondary local-preview-btn" data-folder="${escapeHtml(doc.folder)}">Preview</button>
        <button class="btn btn-sm btn-secondary local-diff-btn" data-folder="${escapeHtml(doc.folder)}">Diff</button>
        <button class="btn btn-sm btn-secondary local-open-btn" data-folder="${escapeHtml(doc.folder)}">Cursor</button>
        <button class="btn btn-sm btn-danger local-delete-btn" data-folder="${escapeHtml(doc.folder)}" data-title="${escapeHtml(doc.title || doc.folder)}">×</button>
      </td>`;
    html += `<tr>${cells}</tr>`;
  });
  html += `</tbody></table>`;
  tableEl.innerHTML = html;

  // Restore checkbox state from localSelected
  tableEl.querySelectorAll(".local-row-check").forEach((cb) => {
    if (localSelected.has(cb.dataset.folder)) cb.checked = true;
  });

  // Wire copy buttons
  tableEl.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const val = btn.closest("[data-copy]")?.dataset.copy;
      if (!val) return;
      navigator.clipboard.writeText(val).then(() => {
        btn.textContent = "✓";
        setTimeout(() => { btn.textContent = "📋"; }, 1000);
      });
    });
  });

  // Wire local column chooser
  const localChooserBtn = tableEl.querySelector("#local-col-chooser-btn");
  const localChooser = tableEl.querySelector("#local-col-chooser");
  localChooserBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!localChooser.classList.contains("hidden")) {
      localChooser.classList.add("hidden");
      return;
    }
    localChooser.innerHTML = LOCAL_COLUMNS.map((col) => {
      const checked = visibleLocalColumns.has(col.id) ? "checked" : "";
      const disabled = col.fixed ? "disabled" : "";
      return `<label class="col-option">
        <input type="checkbox" data-col="${col.id}" ${checked} ${disabled}>
        ${escapeHtml(col.label)}
      </label>`;
    }).join("");
    localChooser.classList.remove("hidden");
    localChooser.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => {
        if (cb.checked) visibleLocalColumns.add(cb.dataset.col);
        else visibleLocalColumns.delete(cb.dataset.col);
        chrome.storage.local.set({ honoka_visible_local_columns: [...visibleLocalColumns] });
        renderLocalDocs();
      });
    });
  });
  if (_localChooserClickHandler) {
    document.removeEventListener("click", _localChooserClickHandler);
  }
  _localChooserClickHandler = (e) => {
    if (!localChooser.classList.contains("hidden") && !e.target.closest(".column-chooser-wrap")) {
      localChooser.classList.add("hidden");
    }
  };
  document.addEventListener("click", _localChooserClickHandler);

  // Local docs selection for compare
  const localChecks = tableEl.querySelectorAll(".local-row-check");
  const localSelectAll = tableEl.querySelector("#local-select-all");
  const localCompareBtn = tableEl.querySelector("#local-compare-btn");
  const localSelectInfo = tableEl.querySelector("#local-select-info");
  const localRegTplBtn = tableEl.querySelector("#local-register-tpl-btn");
  const localBatchBtn = tableEl.querySelector("#local-batch-compare-btn");
  const localDiffTplBtn = tableEl.querySelector("#local-diff-template-btn");
  const localTplSelect = tableEl.querySelector("#local-tpl-select");
  const localTplRemoveBtn = tableEl.querySelector("#local-tpl-remove-btn");

  function updateLocalCompare() {
    const count = localSelected.size;
    localSelectInfo.textContent = count > 0 ? `${count} selected` : "";
    localCompareBtn.classList.toggle("hidden", count !== 2);

    // Register / Unregister as Template
    if (count === 1) {
      localRegTplBtn.classList.remove("hidden");
      const selectedFolder = [...localSelected][0];
      const isReg = registeredTemplates.some(t => t.folder === selectedFolder);
      localRegTplBtn.textContent = isReg ? "Unregister Template" : "Register as Template";
      localRegTplBtn.title = isReg ? "Remove this doc from the template registry" : "Register this doc as a reusable comparison template";
    } else {
      localRegTplBtn.classList.add("hidden");
    }

    // "Compare with Template" — 1 doc selected (not the baseline itself) and baseline is set
    if (count === 1 && currentTemplateFolder) {
      const selectedFolder = [...localSelected][0];
      localDiffTplBtn.classList.toggle("hidden", selectedFolder === currentTemplateFolder);
    } else {
      localDiffTplBtn.classList.add("hidden");
    }

    // Run Template Analysis — 2+ docs selected and baseline is set
    localBatchBtn.classList.toggle("hidden", !(count >= 2 && currentTemplateFolder));
  }

  localSelectAll.addEventListener("change", () => {
    localChecks.forEach((cb) => {
      cb.checked = localSelectAll.checked;
      if (localSelectAll.checked) localSelected.add(cb.dataset.folder);
      else localSelected.delete(cb.dataset.folder);
    });
    updateLocalCompare();
  });

  localChecks.forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) localSelected.add(cb.dataset.folder);
      else localSelected.delete(cb.dataset.folder);
      localSelectAll.checked = localSelected.size === localChecks.length;
      localSelectAll.indeterminate = localSelected.size > 0 && localSelected.size < localChecks.length;
      updateLocalCompare();
    });
  });

  // Restore select-all indeterminate/checked state & toolbar after re-render
  if (localSelected.size > 0) {
    localSelectAll.checked = localSelected.size === localChecks.length;
    localSelectAll.indeterminate = localSelected.size > 0 && localSelected.size < localChecks.length;
    updateLocalCompare();
  }

  localCompareBtn.addEventListener("click", () => {
    if (localSelected.size !== 2) return;
    const folders = [...localSelected];
    window.open(`${BRIDGE_URL}/diff?folder=${encodeURIComponent(folders[0])}&folder2=${encodeURIComponent(folders[1])}`, "_blank");
  });

  localDiffTplBtn.addEventListener("click", () => {
    if (localSelected.size !== 1 || !currentTemplateFolder) return;
    const targetFolder = [...localSelected][0];
    if (targetFolder === currentTemplateFolder) return;
    window.open(`${BRIDGE_URL}/diff?folder=${encodeURIComponent(currentTemplateFolder)}&folder2=${encodeURIComponent(targetFolder)}`, "_blank");
  });

  localRegTplBtn.addEventListener("click", async () => {
    if (localSelected.size !== 1) return;
    const folder = [...localSelected][0];
    const isReg = registeredTemplates.some(t => t.folder === folder);

    try {
      if (isReg) {
        await fetch(`${BRIDGE_URL}/api/templates`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder }),
        });
        if (currentTemplateFolder === folder) {
          currentTemplateFolder = null;
          persistActiveTemplate();
        }
        showStatus(`Template unregistered: "${folder}".`);
      } else {
        const doc = localDocs.find(d => d.folder === folder);
        await fetch(`${BRIDGE_URL}/api/templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder, label: doc?.title || folder }),
        });
        showStatus(`Template registered: "${doc?.title || folder}". Select it from the Baseline dropdown to use.`);
      }
      await fetchTemplates();
      await fetchLocalDocs();
      renderLocalDocs();
    } catch (err) {
      showStatus("Failed to update template: " + err.message);
    }
  });

  localTplSelect.addEventListener("change", () => {
    currentTemplateFolder = localTplSelect.value || null;
    persistActiveTemplate();
    localTplRemoveBtn.style.display = currentTemplateFolder ? "inline-block" : "none";
    updateLocalCompare();
  });

  localTplRemoveBtn.addEventListener("click", async () => {
    if (!currentTemplateFolder) return;
    const folder = currentTemplateFolder;
    const label = registeredTemplates.find(t => t.folder === folder)?.label || folder;
    if (!confirm(`Unregister "${label}" from templates?`)) return;
    try {
      await fetch(`${BRIDGE_URL}/api/templates`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder }),
      });
      currentTemplateFolder = null;
      persistActiveTemplate();
      showStatus(`Template unregistered: "${label}".`);
      await fetchTemplates();
      await fetchLocalDocs();
      renderLocalDocs();
    } catch (err) {
      showStatus("Failed to unregister template: " + err.message);
    }
  });

  localBatchBtn.addEventListener("click", async () => {
    if (!currentTemplateFolder) { showStatus("No baseline template selected."); return; }

    const targetFolders = [...localSelected].filter(f => f !== currentTemplateFolder);
    if (targetFolders.length === 0) { showStatus("Select at least one target doc (different from the template)."); return; }

    await runBatchCompare(currentTemplateFolder, targetFolders);
  });

  tableEl.querySelectorAll(".cat-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try {
        await fetch(`${BRIDGE_URL}/set-category`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: sel.dataset.folder, category: sel.value }),
        });
        await fetchLocalDocs();
        renderAll();
      } catch (err) {
        showStatus("Failed to update category: " + err.message);
      }
    });
  });

  tableEl.querySelectorAll(".local-open-btn").forEach((btn) => {
    btn.addEventListener("click", () => openInEditor(btn.dataset.folder, "index.md"));
  });

  tableEl.querySelectorAll(".local-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteLocalDoc(btn.dataset.folder, btn.dataset.title));
  });

  tableEl.querySelectorAll(".local-preview-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.open(`${BRIDGE_URL}/preview?folder=${encodeURIComponent(btn.dataset.folder)}`, "_blank");
    });
  });

  tableEl.querySelectorAll(".local-diff-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.open(`${BRIDGE_URL}/diff?folder=${encodeURIComponent(btn.dataset.folder)}`, "_blank");
    });
  });

  // Flag dots (local docs)
  wireDocFlags(tableEl);

  // Note editing (local docs)
  tableEl.querySelectorAll(".edit-note-btn, .add-note-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.noteKey;
      const current = allNotes[key] || "";
      const label = current ? "Edit note" : "Add note";
      showModal(label, current, (val) => {
        if (val == null) return;
        if (val) {
          allNotes[key] = val;
        } else {
          delete allNotes[key];
        }
        saveNotes(() => renderAll());
        showStatus(val ? "Note saved." : "Note removed.");
      }, 200);
    });
  });
}

function updateDeleteBtn() {
  deleteBtn.disabled = selectedIds.size === 0;
  const count = selectedIds.size;
  if (count > 0) {
    $("#select-info").textContent = `${count} selected`;
  }

  const localPageIds = new Set(localDocs.map((d) => d.pageId).filter(Boolean));
  const selected = [...selectedIds];

  // Show Compare button when exactly 2 items with local copies are selected
  const compareBtn = $("#compare-selected");
  if (count === 2 && selected.every((id) => localPageIds.has(id))) {
    compareBtn.classList.remove("hidden");
  } else {
    compareBtn.classList.add("hidden");
  }

  // Show "Set as Template" when exactly 1 doc with local copy is selected
  const setTplBtn = $("#set-template-btn");
  if (count === 1 && localPageIds.has(selected[0])) {
    const doc = localDocs.find(d => d.pageId === selected[0]);
    const isReg = doc && registeredTemplates.some(t => t.folder === doc.folder);
    setTplBtn.classList.remove("hidden");
    setTplBtn.textContent = isReg ? "Unregister Template" : "Register as Template";
    setTplBtn.title = isReg ? "Remove this doc from the template registry" : "Register this doc as a reusable comparison template";
  } else {
    setTplBtn.classList.add("hidden");
  }

  // Show "Run Template Analysis" when 2+ docs with local copies selected AND a baseline is set
  const batchBtn = $("#batch-compare-btn");
  if (count >= 2 && currentTemplateFolder && selected.every((id) => localPageIds.has(id))) {
    batchBtn.classList.remove("hidden");
  } else {
    batchBtn.classList.add("hidden");
  }
}

// ══════════════════════════════════════════════════════════════════════
// ── Folder operations ──
// ══════════════════════════════════════════════════════════════════════

function addToFolder(folderId, pageId) {
  const folder = allFolders.find((f) => f.id === folderId);
  if (!folder) return;
  if (folder.pageIds.includes(pageId)) {
    showStatus("Already in folder.");
    return;
  }
  folder.pageIds.push(pageId);
  saveFolders(() => {
    showStatus(`Added to "${folder.name}".`);
    renderAll();
  });
}

function removeFromAllFolders(pageId) {
  allFolders.forEach((f) => {
    const idx = f.pageIds.indexOf(pageId);
    if (idx !== -1) f.pageIds.splice(idx, 1);
  });
}

function reorderInFolder(folder, draggedId, targetIdx) {
  const fromIdx = folder.pageIds.indexOf(draggedId);
  if (fromIdx === -1 || fromIdx === targetIdx) return;
  folder.pageIds.splice(fromIdx, 1);
  folder.pageIds.splice(targetIdx, 0, draggedId);
  saveFolders(() => renderAll());
}

// ══════════════════════════════════════════════════════════════════════
// ── Exports ──
// ══════════════════════════════════════════════════════════════════════

$("#export-md").addEventListener("click", () => {
  const entries = getViewEntries();
  if (entries.length === 0) { showStatus("Nothing to export."); return; }
  let md = `# Honoka — ${getViewName()}\n\nExported: ${new Date().toISOString()}\n\n`;
  md += `| # | Fav | Title | Tokens | Visits | Last seen | Properties | Page ID |\n`;
  md += `|---|---|---|---|---|---|---|---|\n`;
  entries.forEach((e, i) => {
    const t = e.title || "Untitled";
    const link = e.url ? `[${escapeMarkdown(t)}](${e.url})` : escapeMarkdown(t);
    const tok = e.token_snapshot != null ? e.token_snapshot.toLocaleString() : "—";
    const props = formatPropsMarkdown(e.properties);
    md += `| ${i + 1} | ${e.favorite ? "★" : ""} | ${link} | ${tok} | ${e.visit_count || 1} | ${(e.last_seen || "").substring(0, 10) || "—"} | ${props} | \`${e.id.substring(0, 8)}…\` |\n`;
  });
  md += `\n---\nTotal: ${entries.length} pages\n`;
  downloadFile("honoka-history.md", md, "text/markdown");
  showStatus(`Exported ${entries.length} pages.`);
});

$("#export-csv").addEventListener("click", () => {
  const entries = getViewEntries();
  if (entries.length === 0) { showStatus("Nothing to export."); return; }
  const allPropKeys = collectPropertyKeys(entries);
  const headers = ["#", "Favorite", "Title", "URL", "Tokens", "Visits", "First seen", "Last seen", "Page ID"];
  allPropKeys.forEach((k) => headers.push(k));
  const rows = [headers.map(csvEscape).join(",")];
  entries.forEach((e, i) => {
    const row = [i + 1, e.favorite ? "Yes" : "", e.title || "Untitled",
      e.url || "", e.token_snapshot ?? "", e.visit_count || 1,
      (e.first_seen || "").substring(0, 19), (e.last_seen || "").substring(0, 19), e.id];
    allPropKeys.forEach((k) => row.push(e.properties ? (e.properties[k] || "") : ""));
    rows.push(row.map(csvEscape).join(","));
  });
  downloadFile("honoka-history.csv", rows.join("\n"), "text/csv");
  showStatus(`Exported ${entries.length} pages as CSV.`);
});

$("#export-json").addEventListener("click", () => {
  const entries = getViewEntries();
  if (entries.length === 0) { showStatus("Nothing to export."); return; }
  const obj = {};
  entries.forEach((e) => { const { id, ...rest } = e; obj[id] = rest; });
  downloadFile("honoka-history.json", JSON.stringify(obj, null, 2), "application/json");
  showStatus(`Exported as JSON.`);
});

function getViewEntries() {
  let entries = sortedEntries(allHistory);
  if (currentView === "favorites") return entries.filter((e) => e.favorite);
  if (currentView === "recent") return entries.sort((a, b) => (b.last_seen || "").localeCompare(a.last_seen || "")).slice(0, 30);
  if (currentView.startsWith("folder:")) {
    const folder = allFolders.find((f) => f.id === currentView.split(":")[1]);
    if (folder) return folder.pageIds.map((id) => allHistory[id] ? { id, ...allHistory[id] } : null).filter(Boolean);
  }
  return entries;
}

function getViewName() {
  if (currentView === "favorites") return "Favorites";
  if (currentView === "recent") return "Recent";
  if (currentView.startsWith("folder:")) {
    const folder = allFolders.find((f) => f.id === currentView.split(":")[1]);
    return folder ? folder.name : "Folder";
  }
  return "All pages";
}

// ── Delete / Clear ──

deleteBtn.addEventListener("click", () => {
  if (selectedIds.size === 0) return;
  const count = selectedIds.size;
  if (!confirm(`Delete ${count} ${count === 1 ? "entry" : "entries"} from history?`)) return;
  const pageIds = [...selectedIds];
  pageIds.forEach((id) => delete allHistory[id]);
  selectedIds.clear();
  chrome.runtime.sendMessage({ action: "deletePages", pageIds }, () => {
    showStatus(`Deleted ${count} entries.`);
    renderAll();
  });
});

$("#compare-selected").addEventListener("click", () => {
  if (selectedIds.size !== 2) return;
  const selected = [...selectedIds];
  const folderByPageId = {};
  localDocs.forEach((d) => { if (d.pageId) folderByPageId[d.pageId] = d.folder; });
  const f1 = folderByPageId[selected[0]];
  const f2 = folderByPageId[selected[1]];
  if (!f1 || !f2) { showStatus("Both docs must have local copies."); return; }
  window.open(`${BRIDGE_URL}/diff?folder=${encodeURIComponent(f1)}&folder2=${encodeURIComponent(f2)}`, "_blank");
});

// ── Register / Unregister as Template ──
$("#set-template-btn").addEventListener("click", async () => {
  if (selectedIds.size !== 1) return;
  const [id] = [...selectedIds];
  const doc = localDocs.find(d => d.pageId === id);
  if (!doc) { showStatus("This doc has no local copy."); return; }

  const isReg = registeredTemplates.some(t => t.folder === doc.folder);
  try {
    if (isReg) {
      await fetch(`${BRIDGE_URL}/api/templates`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: doc.folder }),
      });
      if (currentTemplateFolder === doc.folder) {
        currentTemplateFolder = null;
        persistActiveTemplate();
      }
      showStatus(`Template unregistered: "${doc.title || doc.folder}".`);
    } else {
      await fetch(`${BRIDGE_URL}/api/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: doc.folder, label: doc.title || doc.folder }),
      });
      showStatus(`Template registered: "${doc.title || doc.folder}". Switch to Local docs and select it from the Baseline dropdown.`);
    }
    await fetchTemplates();
    await fetchLocalDocs();
    updateDeleteBtn();
  } catch (err) {
    showStatus("Failed to update template: " + err.message);
  }
});

// ── Batch Compare against Template ──
$("#batch-compare-btn").addEventListener("click", () => {
  if (!currentTemplateFolder) { showStatus("No baseline template selected. Choose one from the Local docs Baseline dropdown first."); return; }

  const folderByPageId = {};
  localDocs.forEach((d) => { if (d.pageId) folderByPageId[d.pageId] = d.folder; });

  const targetFolders = [...selectedIds]
    .map((id) => folderByPageId[id])
    .filter(f => f && f !== currentTemplateFolder);

  if (targetFolders.length === 0) { showStatus("Select at least one target doc (different from the template)."); return; }

  runBatchCompare(currentTemplateFolder, targetFolders);
});

function runBatchCompare(templateFolder, targetFolders) {
  const targets = targetFolders.join(",");
  const url = `${BRIDGE_URL}/batch-report?template=${encodeURIComponent(templateFolder)}&targets=${encodeURIComponent(targets)}&maxH=4`;
  window.open(url, "_blank");
}

$("#clear-history").addEventListener("click", () => {
  if (!confirm("Clear ALL history? This cannot be undone.")) return;
  allHistory = {};
  selectedIds.clear();
  chrome.runtime.sendMessage({ action: "clearAllHistory" }, () => {
    showStatus("History cleared.");
    renderAll();
  });
});

// ══════════════════════════════════════════════════════════════════════
// ── Export / Import ──
// ══════════════════════════════════════════════════════════════════════

const BACKUP_SETTINGS_KEYS = [
  "honoka_folders",
  "honoka_history_limit",
  "honoka_my_name",
  "honoka_notion_user",
  "honoka_visible_columns",
  "honoka_hidden_columns",
  "honoka_visible_local_columns",
  "honoka_sort_column",
  "honoka_sort_direction",
  "honoka_notes",
  "honoka_flags",
];

$("#export-backup").addEventListener("click", async () => {
  const all = await new Promise((r) => chrome.storage.local.get(null, r));
  const backup = {};
  backup.honoka_history = { ...allHistory };
  for (const key of BACKUP_SETTINGS_KEYS) {
    if (key in all) backup[key] = all[key];
  }

  // Also fetch Bridge registry + doc list
  let bridge = null;
  try {
    const resp = await fetch(`${BRIDGE_URL}/backup`);
    if (resp.ok) bridge = await resp.json();
  } catch {}
  if (bridge) {
    backup._bridge = {
      docs_dir: bridge.docs_dir,
      registry: bridge.registry,
      docs: bridge.docs,
    };
  }

  backup._honoka_backup = {
    version: chrome.runtime.getManifest().version,
    exported_at: new Date().toISOString(),
    history_count: Object.keys(backup.honoka_history || {}).length,
    folder_count: (backup.honoka_folders || []).length,
    bridge_docs: bridge?.docs?.length || 0,
    bridge_registry_entries: bridge ? Object.keys(bridge.registry).length : 0,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href = url;
  a.download = `honoka-backup-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
  const meta = backup._honoka_backup;
  showStatus(`Exported ${meta.history_count} history, ${meta.folder_count} folders, ${meta.bridge_docs} local docs, ${meta.bridge_registry_entries} registry entries.`);
});

$("#import-backup").addEventListener("click", () => {
  $("#import-file").click();
});

$("#import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data._honoka_backup) {
        showStatus("Not a valid Honoka backup file.");
        return;
      }
      const meta = data._honoka_backup;
      const hCount = Object.keys(data.honoka_history || {}).length;
      const fCount = (data.honoka_folders || []).length;
      const bReg = data._bridge?.registry ? Object.keys(data._bridge.registry).length : 0;
      if (!confirm(
        `Import backup from ${meta.exported_at}?\n\n` +
        `• ${hCount} history entries\n` +
        `• ${fCount} folders\n` +
        `• My name: ${data.honoka_my_name || "(not set)"}\n` +
        `• Notion user: ${data.honoka_notion_user?.name || "(not detected)"}\n` +
        (bReg ? `• ${bReg} Bridge registry entries (will merge)\n` : "") +
        `\nThis will REPLACE all extension data.` +
        (bReg ? ` Bridge registry will be MERGED (existing entries kept).` : "")
      )) return;
      // Clear existing split-key entries before import
      const oldKeys = Object.keys(allHistory).map(_pageKey);

      const toStore = { honoka_global_index: Object.keys(data.honoka_history || {}) };
      for (const [id, entry] of Object.entries(data.honoka_history || {})) {
        toStore[_pageKey(id)] = entry;
      }
      for (const key of BACKUP_SETTINGS_KEYS) {
        if (key in data) toStore[key] = data[key];
      }
      // Restore Bridge registry if present
      if (data._bridge?.registry) {
        try {
          await fetch(`${BRIDGE_URL}/restore-registry`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ registry: data._bridge.registry }),
          });
        } catch {}
      }
      chrome.storage.local.remove(oldKeys, () => {
        chrome.storage.local.set(toStore, () => {
          allHistory = data.honoka_history || {};
          allFolders = toStore.honoka_folders || [];
          showStatus(`Imported ${hCount} history, ${fCount} folders` + (bReg ? `, ${bReg} registry entries` : "") + ".");
          renderAll();
          location.reload();
        });
      });
    } catch (err) {
      showStatus("Failed to parse backup: " + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

// ══════════════════════════════════════════════════════════════════════
// ── Modal ──
// ══════════════════════════════════════════════════════════════════════

let modalCallback = null;

function showModal(title, defaultValue, cb, maxLen) {
  const modal = $("#rename-modal");
  $("#modal-title").textContent = title;
  const input = $("#modal-input");
  input.maxLength = maxLen || 80;
  input.value = defaultValue;
  modal.classList.remove("hidden");
  input.focus();
  input.select();
  modalCallback = cb;
}

$("#modal-ok").addEventListener("click", () => {
  const val = $("#modal-input").value.trim();
  $("#rename-modal").classList.add("hidden");
  if (modalCallback) modalCallback(val);
  modalCallback = null;
});

$("#modal-cancel").addEventListener("click", () => {
  $("#rename-modal").classList.add("hidden");
  modalCallback = null;
});

$("#modal-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#modal-ok").click();
  if (e.key === "Escape") $("#modal-cancel").click();
});

// ══════════════════════════════════════════════════════════════════════
// ── Helpers ──
// ══════════════════════════════════════════════════════════════════════

function sortedEntries(history) {
  return sortEntries(
    Object.entries(history).map(([id, v]) => ({ id, ...v }))
  );
}

function collectPropertyKeys(entries) {
  const keySet = new Set();
  entries.forEach((e) => {
    if (e.properties) Object.keys(e.properties).forEach((k) => keySet.add(k));
  });
  return [...keySet];
}

function formatPropsMarkdown(props) {
  if (!props || Object.keys(props).length === 0) return "—";
  return Object.entries(props).map(([k, v]) => `${k}: ${escapeMarkdown(v)}`).join(", ");
}

function csvEscape(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function escapeMarkdown(s) {
  return s.replace(/\|/g, "\\|").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function showStatus(msg) {
  statusEl.textContent = msg;
  statusEl.className = "status";
  setTimeout(() => { statusEl.className = "status hidden"; }, 3000);
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

function genId() {
  return "f_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

// ══════════════════════════════════════════════════════════════════════
// ── Bridge integration ──
// ══════════════════════════════════════════════════════════════════════

let bridgeInfo = null;

async function checkBridge() {
  const dot = $("#bridge-status");
  try {
    const r = await fetch(`${BRIDGE_URL}/status`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      bridgeInfo = await r.json();
      bridgeOk = true;
      const extVersion = chrome.runtime.getManifest().version;
      const bridgeVersion = bridgeInfo.version || "unknown";
      const mismatch = bridgeVersion !== "unknown" && bridgeVersion !== extVersion;
      const bridgeBehind = mismatch && bridgeVersion < extVersion;
      dot.classList.add("bridge-ok");
      if (mismatch) {
        dot.style.background = "var(--fav-color)";
        dot.title = bridgeBehind
          ? `Bridge outdated (v${bridgeVersion}) — extension is v${extVersion}. Click to restart.`
          : `Extension outdated (v${extVersion}) — bridge is v${bridgeVersion}. Rebuild & reload extension.`;
      } else {
        dot.style.background = "";
        dot.title = "Bridge connected (click for details)";
      }
    } else {
      bridgeInfo = null;
      bridgeOk = false;
      dot.classList.remove("bridge-ok");
      dot.title = "Bridge not running";
    }
  } catch {
    bridgeInfo = null;
    bridgeOk = false;
    dot.classList.remove("bridge-ok");
    dot.title = "Bridge not running — start with: node honoka-bridge/index.js";
  }
}

async function fetchLocalDocs() {
  if (!bridgeOk) { localDocs = []; return; }
  try {
    const r = await fetch(`${BRIDGE_URL}/list`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const data = await r.json();
      localDocs = data.docs || [];
      const badge = $("#badge-local");
      if (badge) badge.textContent = localDocs.length || "";
      const badgeMine = $("#badge-mine");
      if (badgeMine) badgeMine.textContent = localDocs.filter((d) => d.category === "mine").length || "";
      const badgeRef = $("#badge-ref");
      if (badgeRef) badgeRef.textContent = localDocs.filter((d) => !d.category || d.category === "reference").length || "";
    }
  } catch { localDocs = []; }
}

async function fetchTemplates() {
  if (!bridgeOk) { registeredTemplates = []; return; }
  try {
    const r = await fetch(`${BRIDGE_URL}/api/templates`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const data = await r.json();
      registeredTemplates = data.templates || [];
    }
  } catch { registeredTemplates = []; }
}

function persistActiveTemplate() {
  chrome.storage.local.set({ honoka_active_template: currentTemplateFolder });
}

async function openInEditor(folder, file) {
  if (!bridgeOk) { showStatus("Bridge not running."); return; }
  try {
    await fetch(`${BRIDGE_URL}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, file }),
    });
    showStatus("Opened in editor.");
  } catch (err) {
    showStatus("Failed to open: " + err.message);
  }
}

async function deleteLocalDoc(folder, title) {
  if (!bridgeOk) { showStatus("Bridge not running."); return; }
  if (!confirm(`Delete local doc "${title}"? This removes the folder and all images from disk.`)) return;
  try {
    const r = await fetch(`${BRIDGE_URL}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder }),
    });
    const data = await r.json();
    if (data.ok) {
      showStatus(`Deleted "${title}".`);
      await fetchLocalDocs();
      renderAll();
    } else {
      showStatus(data.error || "Failed to delete.");
    }
  } catch (err) {
    showStatus("Bridge error: " + err.message);
  }
}

// ── Bridge setup modal ──

function showSetupModal() {
  const modal = $("#bridge-setup-modal");
  const cmd = "cd <repo-root> && node honoka-bridge/index.js";
  $("#setup-cmd").textContent = cmd;
  modal.classList.remove("hidden");
}

$("#bridge-status").addEventListener("click", (e) => {
  e.stopPropagation();
  const pop = $("#bridge-popover");
  if (!pop.classList.contains("hidden")) {
    pop.classList.add("hidden");
    return;
  }

  if (!bridgeOk) {
    showSetupModal();
    return;
  }

  const info = bridgeInfo || {};
  const uptime = info.startedAt ? timeAgo(info.startedAt) : "—";
  const extVersion = chrome.runtime.getManifest().version;
  const bridgeVersion = info.version || "unknown";
  const mismatch = bridgeVersion !== "unknown" && bridgeVersion !== extVersion;
  const bridgeBehind = mismatch && bridgeVersion < extVersion;

  let bannerHtml = "";
  if (mismatch) {
    bannerHtml = bridgeBehind
      ? `<div style="background:var(--danger-bg);color:var(--danger);padding:6px 8px;border-radius:4px;margin-bottom:8px;font-size:11px">⚠ Bridge v${escapeHtml(bridgeVersion)} is behind extension v${escapeHtml(extVersion)}. Restart to update.</div>`
      : `<div style="background:var(--danger-bg);color:var(--danger);padding:6px 8px;border-radius:4px;margin-bottom:8px;font-size:11px">⚠ Extension v${escapeHtml(extVersion)} is behind bridge v${escapeHtml(bridgeVersion)}. Run <code>npm run ext:build</code> and reload the extension.</div>`;
  }

  pop.innerHTML = `
    ${bannerHtml}
    <div class="bp-title"><span class="bp-dot" style="background:${mismatch ? "var(--fav-color)" : "var(--green)"}"></span> Bridge ${mismatch ? (bridgeBehind ? "outdated" : "ahead") : "connected"}</div>
    <div class="bp-row"><span>Version</span><span>v${escapeHtml(bridgeVersion)}</span></div>
    <div class="bp-row"><span>PID</span><span>${info.pid || "—"}</span></div>
    <div class="bp-row"><span>Started</span><span>${escapeHtml(uptime)}</span></div>
    <div class="bp-row"><span>Docs</span><span>${info.docCount || 0} in ${escapeHtml(info.docsDir || "?")}</span></div>
    <div class="bp-row"><span>Editor</span><span>${escapeHtml(info.editor || "?")}</span></div>
    <div class="bp-row"><span>Node</span><span>${escapeHtml(info.nodeVersion || "?")}</span></div>
    <div class="bp-actions">
      <button class="btn btn-sm ${bridgeBehind ? "" : "btn-secondary"}" id="bp-restart" ${bridgeBehind ? 'style="background:var(--danger);color:#fff"' : ""}>↻ Restart${bridgeBehind ? " (update)" : ""}</button>
      <button class="btn btn-sm btn-secondary" id="bp-close">Close</button>
    </div>`;
  pop.classList.remove("hidden");
  const dotRect = $("#bridge-status").getBoundingClientRect();
  pop.style.top = (dotRect.bottom + 8) + "px";
  pop.style.left = dotRect.left + "px";

  pop.querySelector("#bp-close").addEventListener("click", () => pop.classList.add("hidden"));
  pop.querySelector("#bp-restart").addEventListener("click", async () => {
    const btn = pop.querySelector("#bp-restart");
    btn.textContent = "Restarting…";
    btn.disabled = true;
    let restartOk = false;
    try {
      const r = await fetch(`${BRIDGE_URL}/restart`, { method: "POST", signal: AbortSignal.timeout(3000) });
      if (r.ok) restartOk = true;
    } catch {}
    if (!restartOk) {
      pop.classList.add("hidden");
      showStatus("Restart failed — bridge too old. Restart manually: kill the process and run node honoka-bridge/index.js");
      btn.textContent = "↻ Restart";
      btn.disabled = false;
      return;
    }
    const oldPid = bridgeInfo?.pid;
    await new Promise((r) => setTimeout(r, 1500));
    await checkBridge();
    await fetchLocalDocs();
    renderSidebar();
    pop.classList.add("hidden");
    if (bridgeOk && bridgeInfo?.pid !== oldPid) {
      showStatus(`Bridge restarted (pid ${oldPid} → ${bridgeInfo.pid}).`);
    } else if (bridgeOk) {
      showStatus("Bridge responded but may not have restarted. Try again or restart manually.");
    } else {
      showStatus("Bridge is restarting — check again in a moment.");
    }
  });
});

document.addEventListener("click", (e) => {
  const pop = $("#bridge-popover");
  if (!pop.classList.contains("hidden") && !e.target.closest(".bridge-dot-wrap")) {
    pop.classList.add("hidden");
  }
});

$("#copy-cmd").addEventListener("click", () => {
  const cmd = $("#setup-cmd").textContent;
  navigator.clipboard.writeText(cmd).then(() => {
    $("#copy-cmd").textContent = "Copied!";
    setTimeout(() => { $("#copy-cmd").textContent = "Copy command"; }, 2000);
  });
});

$("#recheck-bridge").addEventListener("click", async () => {
  $("#recheck-bridge").textContent = "Checking...";
  await checkBridge();
  await fetchLocalDocs();
  renderSidebar();
  if (bridgeOk) {
    $("#bridge-setup-modal").classList.add("hidden");
    showStatus("Bridge connected!");
  } else {
    $("#recheck-bridge").textContent = "Not connected — try again";
    setTimeout(() => { $("#recheck-bridge").textContent = "Check connection now"; }, 3000);
  }
});

$("#close-setup").addEventListener("click", () => {
  $("#bridge-setup-modal").classList.add("hidden");
});

// ── New doc ──

$("#new-doc-btn").addEventListener("click", () => {
  if (!bridgeOk) {
    showSetupModal();
    return;
  }
  showModal("New document", "", async (title) => {
    if (!title) return;
    try {
      const r = await fetch(`${BRIDGE_URL}/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, template: "design-doc", openInEditor: "cursor" }),
      });
      const data = await r.json();
      if (data.ok) {
        showStatus(`Created "${title}" — opened in Cursor.`);
        await fetchLocalDocs();
        currentView = "local";
        renderAll();
      } else {
        showStatus(data.error || "Failed to create doc.");
      }
    } catch (err) {
      showStatus("Bridge error: " + err.message);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// ── Theme ──
// ══════════════════════════════════════════════════════════════════════

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelectorAll(".theme-swatch").forEach((s) => {
    s.classList.toggle("active", s.dataset.theme === theme);
  });
}

document.querySelectorAll(".theme-swatch").forEach((swatch) => {
  swatch.addEventListener("click", () => {
    const theme = swatch.dataset.theme;
    applyTheme(theme);
    chrome.storage.local.set({ honoka_theme: theme });
  });
});

chrome.storage.local.get({ honoka_theme: "light" }, (data) => {
  applyTheme(data.honoka_theme);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.honoka_theme) {
    applyTheme(changes.honoka_theme.newValue);
  }
});

// ── Search ──

let searchTimer = null;
$("#search-box").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery = $("#search-box").value.trim();
    renderMainTable();
  }, 200);
});

$("#search-box").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $("#search-box").value = "";
    searchQuery = "";
    renderMainTable();
  }
});

// ── Column chooser ──

$("#column-chooser-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const chooser = $("#column-chooser");
  if (!chooser.classList.contains("hidden")) {
    chooser.classList.add("hidden");
    return;
  }

  // Build column list from all available columns
  const entries = Object.entries(allHistory).map(([id, v]) => ({ id, ...v }));
  const propColumns = getAllPropertyColumns(entries);
  const allCols = [...BUILTIN_COLUMNS, ...propColumns];

  chooser.innerHTML = allCols.map((col) => {
    const checked = visibleColumns.has(col.id) ? "checked" : "";
    const disabled = col.fixed ? "disabled" : "";
    const typeLabel = col.type ? ` <span class="col-type">${col.type}</span>` : "";
    return `<label class="col-option">
      <input type="checkbox" data-col="${col.id}" ${checked} ${disabled}>
      ${escapeHtml(col.label)}${typeLabel}
    </label>`;
  }).join("");

  chooser.classList.remove("hidden");

  chooser.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) {
        visibleColumns.add(cb.dataset.col);
        hiddenColumns.delete(cb.dataset.col);
      } else {
        visibleColumns.delete(cb.dataset.col);
        hiddenColumns.add(cb.dataset.col);
      }
      chrome.storage.local.set({
        honoka_visible_columns: [...visibleColumns],
        honoka_hidden_columns: [...hiddenColumns],
      });
      renderMainTable();
    });
  });
});

document.addEventListener("click", (e) => {
  const chooser = $("#column-chooser");
  if (!chooser.classList.contains("hidden") && !e.target.closest(".column-chooser-wrap")) {
    chooser.classList.add("hidden");
  }
});

// ── Refresh metadata ──

$("#refresh-meta").addEventListener("click", async () => {
  const btn = $("#refresh-meta");
  const pageIds = Object.keys(allHistory);
  if (pageIds.length === 0) {
    showStatus("No pages to refresh.");
    return;
  }

  btn.textContent = "⟳ Refreshing…";
  btn.disabled = true;
  showSyncDot(true);

  const batchSize = 5;
  let totalUpdated = 0;
  for (let i = 0; i < pageIds.length; i += batchSize) {
    const batch = pageIds.slice(i, i + batchSize);
    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "refreshPageMeta", pageIds: batch }, resolve);
      });
      if (resp?.updated) totalUpdated += resp.updated;
    } catch { /* continue with next batch */ }
    btn.textContent = `⟳ ${Math.min(i + batchSize, pageIds.length)}/${pageIds.length}`;
  }

  showSyncDot(false);
  btn.textContent = "⟳ Refresh";
  btn.disabled = false;
  showStatus(`Refreshed metadata for ${totalUpdated} pages.`);
  loadAll(() => renderAll());
});

// ── Analytics ──

$("#open-analytics").addEventListener("click", () => {
  if (!bridgeOk) {
    showStatus("Bridge not running — start it first to view analytics.");
    return;
  }
  window.open(`${BRIDGE_URL}/charts`, "_blank");
});

// ── CSV Viewer ──

$("#open-csv-viewer").addEventListener("click", () => {
  const url = chrome.runtime.getURL("viewer/csv-viewer.html");
  chrome.tabs.create({ url });
});

// ── Sync all history to Bridge ──

$("#sync-to-bridge").addEventListener("click", async () => {
  const btn = $("#sync-to-bridge");
  const ids = Object.keys(allHistory);
  if (ids.length === 0) { showStatus("No history to sync."); return; }
  if (!bridgeOk) { showStatus("Bridge not running."); return; }

  btn.textContent = "Syncing…";
  btn.disabled = true;
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < ids.length; i++) {
    const pageId = ids[i];
    try {
      const resp = await fetch(`${BRIDGE_URL}/history/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, ...allHistory[pageId] }),
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) ok++; else fail++;
    } catch { fail++; }
    if (i % 10 === 0) btn.textContent = `Syncing ${i + 1}/${ids.length}…`;
  }
  btn.textContent = "Sync to Bridge";
  btn.disabled = false;
  showStatus(`Synced ${ok} entries to Bridge` + (fail ? ` (${fail} failed)` : "") + ".");
});

// ── Init ──

loadAll(async () => {
  showSyncDot(true);
  await checkBridge();
  await fetchLocalDocs();
  await fetchTemplates();
  await fetchRepoTargets();
  showSyncDot(false);
  renderAll();
  setInterval(async () => {
    showSyncDot(true);
    await checkBridge();
    await fetchLocalDocs();
    await fetchTemplates();
    showSyncDot(false);
    renderSidebar();
  }, 15000);
});
