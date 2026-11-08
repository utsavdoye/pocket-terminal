// Everything typed into the terminal goes through input(): straight to the computer when the
// link is up, otherwise held for a moment and sent once it's back. Tools can watch what's typed.

import { toast } from '../core/dom.js';
import { state } from '../core/state.js';
import { sendTerm, connect } from '../connection/link.js';

// Typing or pasting while the link is coming back is kept and sent once it's back (if within 60 s).
let pending = [], pendingToast = 0;
export function flushPending() {
  const now = Date.now(); const keep = pending.filter((p) => now - p.at < 60e3).map((p) => p.d).join('');
  pending = []; if (keep) sendTerm({ t: 'i', d: keep });
}

const inputHooks = [];
export const onInput = (fn) => inputHooks.push(fn);
export function input(d) {
  if (state.S.viewer) return;
  inputHooks.forEach((fn) => fn(d));
  if (state.dc && state.dc.readyState === 'open') return sendTerm({ t: 'i', d });
  if (pending.reduce((n, p) => n + p.d.length, 0) + d.length > 16e3) return toast("Not connected. Too much to hold; try again when it's back.");
  pending.push({ d, at: Date.now() });
  if (Date.now() - pendingToast > 4000) { pendingToast = Date.now(); toast('Reconnecting… what you typed is sent as soon as it’s back.'); }
  if (state.linkState !== 'connecting') { state.lastAttempt = 0; connect(); }
}
