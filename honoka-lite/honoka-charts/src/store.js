/**
 * store.js — Shared reactive state
 * 
 * All charts subscribe to store changes via store.subscribe().
 * When filters change, store.applyFilters() re-computes store.filtered
 * and notifies all subscribers.
 */

const _subscribers = new Set();

export const store = {
  /** Raw docs from /list */
  docs: [],

  /** Filtered docs (what charts render) */
  filtered: [],

  /** Active filters */
  filters: {
    from: null,    // Date | null
    to: null,      // Date | null
    excludeSources: new Set(),  // Set of source strings to hide
    search: "",
  },

  /** Replace all docs and re-apply filters */
  setDocs(docs) {
    this.docs = docs;
    this.applyFilters();
  },

  /** Re-compute filtered and notify subscribers */
  applyFilters() {
    let result = [...this.docs];

    if (this.filters.from) {
      result = result.filter(d => d.savedAt && new Date(d.savedAt) >= this.filters.from);
    }
    if (this.filters.to) {
      const to = new Date(this.filters.to);
      to.setDate(to.getDate() + 1); // inclusive
      result = result.filter(d => d.savedAt && new Date(d.savedAt) < to);
    }
    if (this.filters.excludeSources.size > 0) {
      result = result.filter(d => {
        const src = (d.source || "") + " " + (d.notionUrl || "");
        return ![...this.filters.excludeSources].some(ex => src.includes(ex));
      });
    }
    if (this.filters.search) {
      const q = this.filters.search.toLowerCase();
      result = result.filter(d =>
        (d.title || "").toLowerCase().includes(q) ||
        (d.folder || "").toLowerCase().includes(q) ||
        (d.notionUrl || "").toLowerCase().includes(q)
      );
    }

    this.filtered = result;
    _subscribers.forEach(fn => fn(this.filtered));
  },

  /** Register a callback that fires whenever filtered changes */
  subscribe(fn) {
    _subscribers.add(fn);
    // Immediately call with current state
    fn(this.filtered);
    return () => _subscribers.delete(fn);
  },
};
