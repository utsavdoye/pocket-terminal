// One-time pairing: this phone sends its code to the computer, you check it matches and allow it
// there, then you choose a PIN that locks the pairing key on this phone.

import { derive, seal, open, randomId, lockSecret, newPairKey, pairCode, unwrapJoin } from '../crypto.js';
import { Board } from '../board.js';
import { $ } from '../core/dom.js';
import { store } from '../core/store.js';
import { computers, addComputer, keepSession } from '../core/computers.js';
import { DEFAULT_BOARDS, okBoards, deviceName, isIOS, standalone } from '../core/env.js';
import { start } from '../connection/session.js';
import { state } from '../core/state.js';
import { pinPad } from './lock.js';

let pendingPair = null;
export const joinFrom = (h) => ({ invite: h.get('join'), name: (h.get('name') || 'your computer').slice(0, 40), boards: okBoards(h.get('boards')) || DEFAULT_BOARDS });

// ---------- one-time pairing: the computer must approve this phone ----------
export async function joinFlow(j, here = false) {
  const list = computers(), again = list.find((c) => c.name === j.name);
  if (list.length && !j.replaceOk) {
    $('pairTitle').textContent = `Pair with ${j.name}?`; $('pairHint').textContent = '';
    $('pairPad').hidden = $('pairDots').hidden = true; $('iosNote').hidden = true; $('replaceNote').hidden = false;
    $('replaceText').textContent = again
      ? `This phone is already paired with ${j.name}. Pairing again replaces that pairing (your other computers stay). Only continue if you just ran npx pocket-terminal pair on that computer.`
      : `Add ${j.name} to this phone? Your other ${list.length === 1 ? 'computer stays' : 'computers stay'} too: switch between them by tapping the name at the top. Only continue if you just ran npx pocket-terminal pair on your own computer.`;
    $('replaceYes').textContent = again ? 'Pair again' : `Add ${j.name}`;
    $('replaceYes').onclick = () => { $('replaceNote').hidden = true; joinFlow({ ...j, replaceOk: true }, here); };
    $('replaceNo').onclick = () => location.replace(location.pathname);
    return;
  }
  // iPhone: a pairing made in Safari stays in Safari. Send people to the Home Screen app first.
  if (isIOS && !standalone && !here) {
    $('pairTitle').textContent = `Pair with ${j.name}`; $('pairHint').textContent = '';
    $('pairPad').hidden = $('pairDots').hidden = true; $('iosNote').hidden = false;
    $('iosAnyway').onclick = () => { $('iosNote').hidden = true; joinFlow(j, true); };
    return;
  }
  $('iosNote').hidden = true;
  $('pairTitle').textContent = `Pair with ${j.name}`;
  $('pairPad').hidden = $('pairDots').hidden = true; $('joinBox').hidden = false;
  const fail = (msg) => { $('joinBox').hidden = true; $('pairHint').textContent = ''; $('pairErr').textContent = msg; };
  let ik; try { ik = await derive(j.invite); } catch { return fail('This pairing link is broken. Make a new QR code on your computer.'); }
  const { kp, pub } = await newPairKey(), nonce = randomId(), code = await pairCode(pub);
  $('joinCode').textContent = code.slice(0, 3) + ' ' + code.slice(3);
  $('pairHint').textContent = 'Sending this phone\'s code to your computer…';
  let done = false, slow, timeout;
  const end = () => { done = true; b.stop(); clearTimeout(slow); clearTimeout(timeout); };
  const b = new Board(j.boards, ik.topic, async (text) => {
    const m = await open(ik, text);
    if (done || !m || m.from !== 'mac' || m.for !== nonce) return;
    if (m.type === 'denied') { end(); return fail((m.why || 'Your computer said no.') + ' Nothing was paired.'); }
    if (m.type !== 'welcome') return;
    let p; try { p = await unwrapJoin(kp, nonce, m.wrap); } catch { return; }
    end();
    pendingPair = { secret: p.secret, name: String(p.name || j.name).slice(0, 40), boards: okBoards(p.boards) || j.boards };
    $('joinBox').hidden = true; $('pairPad').hidden = $('pairDots').hidden = false;
    $('pairTitle').textContent = `Approved by ${pendingPair.name}`;
    $('pairHint').textContent = 'Now choose a PIN for this phone (6 or more digits).';
    pairFlow();
  });
  b.start('2m');
  try { await b.publish(await seal(ik, { id: randomId(), ts: Date.now(), from: 'phone', type: 'join', nonce, pub, device: deviceName() })); }
  catch (e) { end(); return fail(e.message); }
  $('pairHint').textContent = 'Check that your computer shows the same code, then type y there to allow this phone.';
  slow = setTimeout(() => { if (!done) $('pairErr').textContent = 'Still waiting. Each QR code works only once: if this one was already used or is older than 10 minutes, run  npx pocket-terminal pair  on your computer for a new one.'; }, 45e3);
  timeout = setTimeout(() => { if (!done) { end(); fail('No answer from your computer. Run  npx pocket-terminal pair  there for a new QR code.'); } }, 10 * 60e3);
}

function pairFlow() {
  let first = null;
  const p = pinPad('pair', {
    goLabel: 'Next',
    onDone: async (pin) => {
      if (!first) { first = pin; $('pairHint').textContent = 'Enter the same PIN again.'; $('pairErr').textContent = ''; p.setLabel('Pair'); return; }
      if (pin !== first) { first = null; p.shake(); p.setLabel('Next'); $('pairHint').textContent = 'Choose a PIN for this phone (6 or more digits).'; $('pairErr').textContent = "Those didn't match. Start again."; return; }
      let k; try { k = await derive(pendingPair.secret); } catch { $('pairErr').textContent = 'This pairing link is broken. Make a new QR code on your computer.'; return; }
      p.done();
      const locked = await lockSecret(pendingPair.secret, pin);
      addComputer({ ...locked, name: pendingPair.name, boards: pendingPair.boards, topic: k.topic });
      store.set('fails', 0);
      const s = { key: k.key, topic: k.topic, notifyTopic: k.notifyTopic, boards: pendingPair.boards, name: pendingPair.name, expires: Date.now() + 12 * 3600e3 };
      await keepSession(s);
      pendingPair = null;
      if (state.S) { location.replace(location.pathname); return; } // paired another computer from inside the app: open it fresh
      start(s);
    },
  });
}
