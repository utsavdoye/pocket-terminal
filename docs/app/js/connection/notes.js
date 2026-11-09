// The message board: sealed notes between this phone and the computer. post() leaves one for
// the computer; onNoteText() reads what the computer left in this phone's mailbox (its status,
// answers to our offers, results of commands sent while it was asleep).

import { seal, open, randomId } from '../crypto.js';
import { MAX_NOTE } from '../board.js';
import { state, mac } from '../core/state.js';
import { connect } from './link.js';
import { paint } from '../ui/status.js';
import { gotResult } from '../features/commands.js';
import { setOs } from '../features/ai.js';
import { revoked } from '../features/unpaired.js';

export async function post(type, extra = {}) {
  const text = await seal(state.keys, { id: randomId(), ts: Date.now(), from: 'phone', type, ...extra });
  if (text.length > MAX_NOTE) throw new Error('Too long to send');
  await state.board.publish(text);
}

const seen = new Set();
export async function onNoteText(text) {
  const m = await open(state.keys, text);
  if (!m || m.from !== 'mac' || typeof m.id !== 'string' || seen.has(m.id)) return;
  seen.add(m.id);
  if (localStorage.getItem('pt_debug')) console.log('note', m.type, m.state || '', new Date(m.ts).toISOString());
  if (m.type === 'revoked') return revoked();
  if (m.type === 'status') {
    if (m.ts < mac.ts) return;
    Object.assign(mac, { state: m.state, ts: m.ts, nextWake: m.nextWake, plan: m.plan, checkIn: m.checkIn, power: m.power, name: m.name || mac.name });
    if (m.os) setOs(m.os);
    // The Mac just woke up and saw our hello: open the direct link now.
    // (If an offer is still waiting, the Mac answers that one; don't start another.)
    // Only an answer to our own knock counts: an old "online" from the mailbox's backlog (the
    // computer has slept since) must not replace this visit's knock.
    if (m.state === 'online' && state.knockAt && m.ts > state.knockAt - 2e3 && Date.now() - m.ts < 3 * 60e3 && (!state.dc || state.dc.readyState !== 'open') && Date.now() - state.offerAt > 80e3) connect({ hello: false });
  } else if (m.type === 'answer') {
    if (localStorage.getItem('pt_debug')) console.log('answer', m.oid, 'mine', state.pc && state.pc.oid, state.pc && state.pc.signalingState);
  }
  if (m.type === 'answer' && state.pc && m.oid === state.pc.oid && state.pc.signalingState === 'have-local-offer') {
    clearTimeout(state.answerTimer);
    try { await state.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); } catch { return; }
    clearTimeout(state.openTimer);
    state.openTimer = setTimeout(() => { if (!state.dc || state.dc.readyState !== 'open') { state.linkState = 'backup'; paint(); } }, 20e3);
  } else if (m.type === 'result') {
    gotResult(m.cid, m.code, m.out);
  }
  paint();
}
