// "Your computer runs an older Pocket Terminal": a small bar when the computer's version is
// older than this app (the app updates by itself; the computer only when you run npx).
// One tap copies the update command. Closing it hides it until the computer's version changes.

import { APP_VERSION } from '../core/env.js';

export const older = (a, b) => { // is version a older than b?
  const x = String(a || '0').split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
};
const CMD = 'npx pocket-terminal@latest';

export function setupUpdate(ctx) {
  const bar = ctx.$('updBar');
  ctx.on('hi', (m) => {
    if (m.viewer || ctx.demo) return;
    const v = m.v || 'an older version';
    if (!older(m.v, APP_VERSION) || ctx.store.get('updHide') === v) { bar.hidden = true; return; }
    ctx.$('updText').textContent = `${m.v ? 'Computer runs v' + m.v : 'Computer runs an older version'} · tap to copy the update`;
    bar.hidden = false;
    bar.onclick = async (e) => {
      if (e.target.closest('.x')) { ctx.store.set('updHide', v); bar.hidden = true; ctx.relayout(); return; }
      try { await navigator.clipboard.writeText(CMD); ctx.toast(`Copied. Run it on your computer: ${CMD}`); } catch { ctx.toast(`Run on your computer: ${CMD}`); }
    };
    ctx.relayout();
  });
}
