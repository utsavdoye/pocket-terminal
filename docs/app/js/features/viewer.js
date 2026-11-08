// View-only mode (#watch=…): someone shared a live view of their terminal with you. The terminal
// is scaled to fit their size, and nothing you type is sent.

import { derive } from '../crypto.js';
import { $ } from '../core/dom.js';
import { DEFAULT_BOARDS, okBoards } from '../core/env.js';
import { state } from '../core/state.js';
import { start } from '../connection/session.js';
import { showNone } from './unpaired.js';

// ---------- view-only: someone shared a live view with you ----------
let vcols = 80, vrows = 24;
export function viewerSize(c, r) {
  const term = state.term;
  if (c) { vcols = c; vrows = r; }
  const w = $('term').clientWidth - 18; if (w <= 0) return;
  term.options.fontSize = Math.max(5, Math.min(15, Math.floor((w / vcols) / 0.602 * 10) / 10));
  if (term.cols !== vcols || term.rows !== vrows) term.resize(vcols, vrows);
}
export async function startViewer() {
  const h = new URLSearchParams(location.hash.slice(1));
  document.body.classList.add('viewer');
  let k; try { k = await derive(h.get('watch')); } catch { showNone(); $('noneErr').textContent = 'That live view link is broken.'; return; }
  start({ key: k.key, topic: k.topic, notifyTopic: k.notifyTopic, boards: okBoards(h.get('boards')) || DEFAULT_BOARDS, name: (h.get('name') || 'a computer').slice(0, 40), viewer: true });
}
