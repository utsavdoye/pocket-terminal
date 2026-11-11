// Several computers on one phone (your laptop, a work machine, a server). Each has its own
// pairing key, locked with its own PIN, its own mailbox and its own command history.
//
// The computer in use is still kept as 'vault' (so everything else works as before), and its
// unlocked session as 'session:<topic>'. The list of all of them is 'computers'. Switching
// saves the current one's own data (sent commands, AI helper key) with it, brings the other's
// back, and reloads the app.

import { store, idbGet, idbSet, idbDel } from './store.js';

const OWN = ['jobs', 'ai']; // things that belong to one computer
const same = (a, b) => a && b && a.topic === b.topic;

export function computers() {
  let list = store.get('computers', null);
  const v = store.get('vault');
  if (!Array.isArray(list)) list = v ? [{ ...v }] : []; // phones paired before there were several
  if (v && !list.some((c) => same(c, v))) list.unshift({ ...v });
  return list;
}
const save = (list) => store.set('computers', list);
export const active = () => store.get('vault');

// The unlocked session for one computer (null if its PIN is needed).
export async function sessionFor(topic) {
  const s = (await idbGet('session:' + topic)) || (await idbGet('session'));
  return s && s.topic === topic && s.expires > Date.now() ? s : null;
}
export async function keepSession(s) { await idbDel('session'); if (s.expires > Date.now()) await idbSet('session:' + s.topic, s); }
export async function forgetSession(topic) { await idbDel('session:' + topic); await idbDel('session'); }

// Stash this computer's own data with it, before another one takes over the app.
function stash(list) {
  const v = active(); if (!v) return list;
  const data = {}; for (const k of OWN) { const x = store.get(k); if (x !== null) data[k] = x; }
  return list.map((c) => (same(c, v) ? { ...c, ...v, data } : c));
}
function bring(c) {
  for (const k of OWN) { if (c.data && c.data[k] !== undefined) store.set(k, c.data[k]); else store.del(k); }
  const { data, seen, ...vault } = c; store.set('vault', vault);
}

// A newly paired computer. Pairing the same computer again (same name) replaces its old entry.
export function addComputer(vault) {
  let list = stash(computers()).filter((c) => !same(c, vault) && c.name !== vault.name);
  for (const k of OWN) store.del(k);
  list.push({ ...vault }); save(list); store.set('vault', vault);
}

export function switchTo(topic) {
  const list = stash(computers()), c = list.find((x) => x.topic === topic);
  if (!c) return false;
  save(list); bring(c); return true;
}

// Forget one computer on this phone. Returns the one now in use (or null if none is left).
export async function removeComputer(topic) {
  const list = stash(computers()).filter((c) => c.topic !== topic);
  await forgetSession(topic); save(list); store.del('screen:' + topic); // its saved last screen goes too
  if (same(active(), { topic })) {
    if (list.length) bring(list[list.length - 1]);
    else { store.del('vault'); for (const k of OWN) store.del(k); }
  }
  return active();
}

// "Last seen" for the list (only the computer in use is live).
export function noteSeen(topic, ts) {
  const list = computers(); const c = list.find((x) => x.topic === topic);
  if (c && (!c.seen || ts - c.seen > 60e3)) { c.seen = ts; save(list); }
}
