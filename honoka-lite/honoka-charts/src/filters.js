/**
 * filters.js — Date range + source exclude filter bar
 */

import { store } from "./store.js";

export function initFilters() {
  const fromEl = document.getElementById("filter-from");
  const toEl = document.getElementById("filter-to");
  const applyBtn = document.getElementById("filter-apply");
  const resetBtn = document.getElementById("filter-reset");
  const countEl = document.getElementById("filter-count");
  const tagsEl = document.getElementById("source-exclude-tags");
  const inputEl = document.getElementById("source-exclude-input");
  const clearBtn = document.getElementById("source-exclude-clear");

  function apply() {
    store.filters.from = fromEl.value ? new Date(fromEl.value) : null;
    store.filters.to = toEl.value ? new Date(toEl.value) : null;
    store.applyFilters();
    const n = store.filtered.length;
    const total = store.docs.length;
    countEl.textContent = n < total ? `${n} / ${total}` : "";
  }

  applyBtn?.addEventListener("click", apply);
  resetBtn?.addEventListener("click", () => {
    fromEl.value = "";
    toEl.value = "";
    store.filters.from = null;
    store.filters.to = null;
    store.applyFilters();
    countEl.textContent = "";
  });

  // Source exclude tags
  function renderTags() {
    if (!tagsEl) return;
    tagsEl.innerHTML = "";
    store.filters.excludeSources.forEach(src => {
      const tag = document.createElement("span");
      tag.className = "source-tag";
      tag.textContent = src + " ×";
      tag.onclick = () => {
        store.filters.excludeSources.delete(src);
        renderTags();
        store.applyFilters();
      };
      tagsEl.appendChild(tag);
    });
  }

  inputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && inputEl.value.trim()) {
      store.filters.excludeSources.add(inputEl.value.trim());
      inputEl.value = "";
      renderTags();
      store.applyFilters();
    }
  });

  clearBtn?.addEventListener("click", () => {
    store.filters.excludeSources.clear();
    renderTags();
    store.applyFilters();
  });
}
