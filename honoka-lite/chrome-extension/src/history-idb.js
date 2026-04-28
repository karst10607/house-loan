/**
 * IndexedDB layer for Honoka page history (service worker only).
 * Object store: pages, keyPath pageId, index last_seen.
 */
/* global indexedDB */

const DB_NAME = "honoka";
const DB_VERSION = 1;
const STORE = "pages";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "pageId" });
        os.createIndex("last_seen", "last_seen", { unique: false });
      }
    };
  });
}

function rowToEntry(row) {
  if (!row) return null;
  const { pageId, ...rest } = row;
  return rest;
}

/**
 * @returns {Promise<Record<string, object>>}
 */
async function honokaIdbGetAllMap() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const st = tx.objectStore(STORE);
    const req = st.getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const rows = req.result || [];
      const out = {};
      for (const row of rows) {
        if (row?.pageId) out[row.pageId] = rowToEntry(row);
      }
      resolve(out);
    };
  });
}

/**
 * @returns {Promise<object|null>}
 */
async function honokaIdbGet(pageId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const st = tx.objectStore(STORE);
    const req = st.get(pageId);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result ? rowToEntry(req.result) : null);
  });
}

/**
 * @param {string} pageId
 * @param {object} entry — value shape (no pageId inside)
 */
async function honokaIdbPut(pageId, entry) {
  const db = await openDb();
  const row = { ...entry, pageId };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    const r = st.put(row);
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function honokaIdbDeleteMany(pageIds) {
  if (!pageIds?.length) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    for (const id of pageIds) st.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function honokaIdbClear() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    const r = st.clear();
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Replace entire history (import / options bulk save).
 * @param {Record<string, object>} map — pageId -> entry (no pageId in values)
 */
async function honokaIdbReplaceAll(map) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));

    const clearReq = st.clear();
    clearReq.onerror = () => reject(clearReq.error);
    clearReq.onsuccess = () => {
      for (const [pageId, entry] of Object.entries(map || {})) {
        if (!pageId) continue;
        st.put({
          ...(entry && typeof entry === "object" ? entry : {}),
          pageId,
        });
      }
    };
  });
}

/**
 * Drop oldest by last_seen until count <= limit (limit > 0).
 */
async function honokaIdbEnforceLimit(limit) {
  if (!limit || limit <= 0) return;
  const db = await openDb();
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const st = tx.objectStore(STORE);
    const r = st.getAll();
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result || []);
  });
  if (rows.length <= limit) return;
  const sorted = rows.slice().sort((a, b) =>
    (b.last_seen || "").localeCompare(a.last_seen || "")
  );
  const victims = sorted.slice(limit).map((x) => x.pageId);
  await honokaIdbDeleteMany(victims);
}

// Export for importScripts in service worker
self.HonokaHistoryIdb = {
  openDb,
  honokaIdbGetAllMap,
  honokaIdbGet,
  honokaIdbPut,
  honokaIdbDeleteMany,
  honokaIdbClear,
  honokaIdbReplaceAll,
  honokaIdbEnforceLimit,
};
