/**
 * table.js — Data table with search + sort
 */

import { store } from "./store.js";
import { bridgeUrl } from "./api.js";

let _sortKey = "savedAt";
let _sortDir = -1; // -1 = desc

export function initTable() {
  store.subscribe(render);

  const searchEl = document.getElementById("table-search");
  searchEl?.addEventListener("input", () => {
    store.filters.search = searchEl.value;
    store.applyFilters();
  });
}

function render(docs) {
  const wrap = document.getElementById("data-table-wrap");
  const countEl = document.getElementById("table-count");
  if (!wrap) return;

  const sorted = [...docs].sort((a, b) => {
    const av = a[_sortKey] ?? "";
    const bv = b[_sortKey] ?? "";
    return _sortDir * (av < bv ? -1 : av > bv ? 1 : 0);
  });

  countEl && (countEl.textContent = `${sorted.length} rows`);

  if (sorted.length === 0) {
    wrap.innerHTML = `<p class="table-empty">No documents match current filters.</p>`;
    return;
  }

  const cols = [
    { key: "savedAt",   label: "Date" },
    { key: "title",     label: "Title" },
    { key: "category",  label: "Category" },
    { key: "source",    label: "Source" },
    { key: "sizeBytes", label: "Size" },
    { key: "imageCount",label: "Images" },
  ];

  const headerHtml = cols.map(c => {
    const active = c.key === _sortKey ? ` sort-active` : "";
    const arrow = c.key === _sortKey ? (_sortDir === 1 ? " ↑" : " ↓") : "";
    return `<th class="sortable${active}" data-key="${c.key}">${c.label}${arrow}</th>`;
  }).join("");

  const rowsHtml = sorted.map(d => {
    const date = d.savedAt ? new Date(d.savedAt).toLocaleDateString() : "—";
    const size = d.sizeBytes ? `${(d.sizeBytes / 1024).toFixed(1)}kb` : "—";
    const previewUrl = `${bridgeUrl()}/preview?folder=${encodeURIComponent(d.folder)}`;
    return `<tr>
      <td class="cell-date">${date}</td>
      <td class="cell-title"><a href="${previewUrl}" target="_blank">${escHtml(d.title || d.folder)}</a></td>
      <td>${escHtml(d.category || "—")}</td>
      <td><span class="src-badge src-${d.source}">${d.source || "—"}</span></td>
      <td class="cell-num">${size}</td>
      <td class="cell-num">${d.imageCount ?? 0}</td>
    </tr>`;
  }).join("");

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr>${headerHtml}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;

  // Sort click handlers
  wrap.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const k = th.dataset.key;
      if (_sortKey === k) _sortDir *= -1;
      else { _sortKey = k; _sortDir = -1; }
      render(docs);
    });
  });
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
