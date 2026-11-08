// Pocket Terminal phone app. Static files only (GitHub Pages); no server of its own.
//
// Flow: pair (QR link → PIN) → unlock → read your private mailbox on the board →
//       post encrypted "hello" + "offer" → Mac answers → direct WebRTC link → live terminal.
// If the direct link can't open, commands go as encrypted notes through the board instead.
//
// This file only decides where to start (demo, a shared live view, pairing, the lock screen or
// straight into the app). The pieces live in:
//   core/        settings and storage, small DOM helpers, the shared state
//   connection/  the board (sealed notes), the direct link, incoming messages, start()
//   terminal/    the terminal, the key row, typing
//   ui/          the menu sheet and dock, the header and banner, wiring the controls
//   features/    pairing and the PIN, commands, Ask and the AI helper, power, settings,
//                agents, files, notifications, sharing, websites, voice, demo mode

import { $, show, toast } from './core/dom.js';
import { store } from './core/store.js';
import { active, sessionFor } from './core/computers.js';
import { DEMO, VIEW } from './core/env.js';
import { state, setSid } from './core/state.js';
import { start } from './connection/session.js';
import { showNone } from './features/unpaired.js';
import { joinFlow, joinFrom } from './features/pairing.js';
import { lockFlow } from './features/lock.js';
import { startViewer } from './features/viewer.js';
import { startDemo } from './features/demo/demo.js';

// ---------- boot: pair / lock / not paired ----------
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (DEMO) return startDemo();
  if (VIEW) return startViewer();
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('s')) { // opened from a notification: show that terminal (or, for an agent's question, the dashboard)
    if (/^[QC]-/.test(h.get('s'))) state.openAgentsSoon = true; else { setSid(h.get('s')); state.attachFresh = false; }
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (h.get('join') || h.get('pair')) {
    history.replaceState(null, '', location.pathname + location.search); // remove the code from the address bar
    if (!h.get('join')) { showNone(); toast('That is an old pairing code. Run  npx pocket-terminal pair  on your computer for a new one.'); return; }
    show('gate-pair'); joinFlow(joinFrom(h)); return;
  }
  const flash = store.get('flash'); if (flash) { store.del('flash'); setTimeout(() => toast(flash), 600); }
  const vault = active();
  if (!vault) return showNone();
  const s = await sessionFor(vault.topic);
  if (s) return start(s);
  $('lockTitle').textContent = `Unlock ${vault.name}`;
  show('gate-lock'); lockFlow(vault);
}

boot();
