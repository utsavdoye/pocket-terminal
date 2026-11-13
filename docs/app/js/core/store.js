// What this phone remembers: small settings in localStorage (all keys start with pt_), and the
// unlocked session in IndexedDB. Demo and view-only mode never write the real ones.

import { DEMO, VIEW } from './env.js';

const DEMO_KEEP = new Set(['theme', 'palette', 'font']);
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem('pt_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { if ((DEMO || VIEW) && !DEMO_KEEP.has(k)) return; try { localStorage.setItem('pt_' + k, JSON.stringify(v)); } catch {} },
  del(k) { if (DEMO || VIEW) return; try { localStorage.removeItem('pt_' + k); } catch {} },
};
// Phone notifications are on (so the computer can say "I'm awake" while you're elsewhere).
export const pushReady = () => { try { return !!store.get('push') && 'Notification' in window && Notification.permission === 'granted'; } catch { return false; } };

// ---------- unlocked-session cache (IndexedDB keeps the key non-extractable) ----------
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('pocket-terminal', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
export async function idbGet(k) { try { const db = await idb(); return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); } catch { return null; } }
export async function idbSet(k, v) { try { const db = await idb(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch {} }
export async function idbDel(k) { try { const db = await idb(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; t.onerror = res; }); } catch {} }
