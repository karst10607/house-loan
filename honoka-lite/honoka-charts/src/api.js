/**
 * api.js — Honoka Bridge data fetching
 * Detects whether we're running via bridge (relative) or vite dev (proxy).
 */

export function bridgeUrl() {
  // When served by bridge at /charts/, location.port === "44124" → use relative ""
  // When running vite dev at port 7750 → vite proxies /list and /history to 44124
  return "";
}

/** Fetch all docs from /list (merged docs + inbox). */
export async function loadDocs() {
  const res = await fetch(`${bridgeUrl()}/list`);
  if (!res.ok) throw new Error(`/list returned ${res.status}`);
  const data = await res.json();
  return data.docs || [];
}

/** Fetch raw history JSONL (for visit timeline). */
export async function loadHistory() {
  const res = await fetch(`${bridgeUrl()}/history/dump`);
  if (!res.ok) throw new Error(`/history/dump returned ${res.status}`);
  return res.json();
}
