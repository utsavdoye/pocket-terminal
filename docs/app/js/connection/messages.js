// Messages that arrive over the direct link, sorted to where they belong. Replies to a request
// (files, websites…) go to whoever asked; everything else to whoever cares.

import { state } from '../core/state.js';
import { paint, paintPing } from '../ui/status.js';
import { viewerSize } from '../features/viewer.js';
import { setOs } from '../features/ai.js';
import { revoked } from '../features/unpaired.js';
import { gotResult } from '../features/commands.js';

const listeners = new Map(), handlers = {};
export const on = (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); };
export const listen = (id, fn) => listeners.set(id, fn);
export const unlisten = (id) => listeners.delete(id);
let pushKey = null;
export const getPushKey = () => pushKey;
const parts = new Map(); // a big message sent in pieces: id -> [pieces]
export function handleMsg(m) {
    if (m.t === 'part') {
      const p = parts.get(m.id) || []; p[m.i] = m.d; parts.set(m.id, p);
      if (parts.size > 20) parts.delete(parts.keys().next().value);
      if (p.filter((x) => x !== undefined).length === m.n) { parts.delete(m.id); try { handleMsg(JSON.parse(p.join(''))); } catch {} }
      return;
    }
    if (m.id && listeners.has(m.id)) { listeners.get(m.id)(m); return; }
    if (m.t === 'o') state.term.write(m.d);
    else if (m.t === 'size') { if (state.S.viewer) viewerSize(m.cols, m.rows); }
    else if (m.t === 'share-ended') { state.term.write('\r\n\x1b[33m[The live view ended. Ask for a new link to keep watching.]\x1b[0m\r\n'); state.ended = true; try { state.dc && state.dc.close(); state.pc && state.pc.close(); } catch {} state.board.stop(); state.linkState = 'ended'; paint(); }
    else if (m.t === 'reset') { state.term.reset(); if (m.d) state.term.write(m.d); }
    else if (m.t === 'power') { state.livePower = m; paint(); }
    else if (m.t === 'pong') { state.lastPong = Date.now(); if (state.pingSent) { state.rtt = Math.round(performance.now() - state.pingSent); state.pingSent = 0; paintPing(); } }
    else if (m.t === 'hi') { if (m.os) setOs(m.os); pushKey = m.push || null; }
    else if (m.t === 'revoked') revoked();
    else if (m.t === 'result') gotResult(m.id, m.code, m.out);
    (handlers[m.t] || []).forEach((fn) => { try { fn(m); } catch (e) { console.error(e); } });
}
