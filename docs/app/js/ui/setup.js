// setupUi(): wires up every control once the app opens: the menu and dock, the key row, Ask,
// commands, saved commands, power and settings. Then it hands the tools (agents, files,
// notifications…) what they need through `ctx`.

import { randomId } from '../crypto.js';
import { $, esc, ago, toast } from '../core/dom.js';
import { store } from '../core/store.js';
import { DEMO, isIOS, standalone } from '../core/env.js';
import { state, setSid } from '../core/state.js';
import { sendTerm, drain } from '../connection/link.js';
import { on, listen, unlisten, getPushKey } from '../connection/messages.js';
import { input, onInput } from '../terminal/input.js';
import { setupKeyRow } from '../terminal/keyrow.js';
import { openSheet, closeSheet, pageOpen, onPage, setupSheet } from './sheet.js';
import { setupAsk, doAsk } from '../features/ask.js';
import { setupAiSettings } from '../features/ai.js';
import { setupCommands, renderJobs } from '../features/commands.js';
import { setupSnippets, renderSnips } from '../features/snippets.js';
import { setupPower } from '../features/power.js';
import { setupSettings } from '../features/settings.js';
import { setupTools } from '../features/tools.js';
import { setupComputers } from '../features/computers.js';
import { applyComfort, setupComfort } from '../features/comfort.js';
import { setupDebug } from '../features/debug.js';
import { setupTour } from '../features/tour.js';

let tools = null;
export function setupUi() {
  applyComfort();
  setupSheet();
  setupKeyRow();
  setupAsk(); setupAiSettings();
  setupCommands();
  setupSnippets();
  setupPower();
  setupSettings();
  if (!state.S.viewer) setupComputers();
  setupComfort(() => requestAnimationFrame(() => state.fit.fit())); setupDebug(); setupTour();
  if (state.S.viewer) {
    const tag = document.createElement('span'); tag.className = 'tick watch'; tag.textContent = 'View only'; $('ping').before(tag);
  }
  let switchReq = null;
  tools = setupTools({
    $, esc, ago, toast, store, isIOS, standalone,
    live: () => !!(state.dc && state.dc.readyState === 'open'), send: sendTerm, on,
    listen, unlisten, newId: randomId,
    sid: () => state.SID, setSid, size: () => ({ cols: state.term.cols, rows: state.term.rows }),
    input, focus: () => state.term.focus(), relayout: () => requestAnimationFrame(() => state.fit.fit()),
    openSheet, closeSheet, pageOpen,
    onPage, onInput,
    pushKey: getPushKey, drain, ask: () => doAsk(), demo: DEMO, viewer: !!state.S.viewer,
    onSwitchRequest: (fn) => { switchReq = fn; },
    openSession: (sid) => {
      if (/^[QC]-/.test(String(sid))) return openSheet('sessions'); // an agent's question or status: the dashboard
      if (state.dc && state.dc.readyState === 'open' && switchReq) switchReq(sid); else { setSid(sid); state.attachFresh = false; }
    },
  });
  renderJobs(); renderSnips();
}
