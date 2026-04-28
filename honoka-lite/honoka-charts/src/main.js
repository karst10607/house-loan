/**
 * Honoka Charts — Main Entry
 * 
 * Architecture:
 *  - api.js       : fetch data from Honoka Bridge
 *  - store.js     : shared reactive state (data, filters)
 *  - charts/      : one file per chart, each exports { init, update }
 *  - table.js     : data table + search
 *  - filters.js   : date/source filter bar logic
 */

import { loadDocs } from "./api.js";
import { store } from "./store.js";
import { initFilters } from "./filters.js";
import { initTable } from "./table.js";
import { initTimeline } from "./charts/timeline.js";
import { initTokens } from "./charts/tokens.js";
import { initAuthors } from "./charts/authors.js";
import { initLifecycle } from "./charts/lifecycle.js";
import { initStacked } from "./charts/stacked.js";

// ── Bootstrap ──────────────────────────────────────────────────────────────

async function boot() {
  try {
    const raw = await loadDocs();
    store.setDocs(raw);
  } catch (err) {
    console.error("Failed to load docs from bridge:", err);
    document.getElementById("entry-count").textContent = "⚠ Bridge offline";
    return;
  }

  // Init UI components
  initFilters();
  initTimeline("chart-timeline");
  initTokens("chart-tokens");
  initAuthors("chart-authors");
  initLifecycle("chart-lifecycle");
  initStacked("chart-stacked");
  initTable();

  // Header stats
  updateHeader();

  // Auto-refresh every 30s
  setInterval(async () => {
    try {
      const raw = await loadDocs();
      store.setDocs(raw);
      updateHeader();
    } catch { /* silent */ }
  }, 30_000);

  // Reload button
  document.getElementById("reload-btn")?.addEventListener("click", async () => {
    const raw = await loadDocs();
    store.setDocs(raw);
    updateHeader();
  });
}

function updateHeader() {
  const docs = store.filtered;
  document.getElementById("entry-count").textContent = `${docs.length} docs`;
  if (docs.length) {
    const dates = docs.map(d => d.savedAt).filter(Boolean).sort();
    const fmt = d => new Date(d).toLocaleDateString();
    document.getElementById("date-range").textContent =
      `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`;
  }
}

boot();
