// The encrypted mailbox on the message board: what this computer remembers about it
// (direct-state.json), posting notes to it, and reading the notes a phone leaves there
// (hello, offer, cmd, settings, and answers from notification buttons).

const fs = require('fs');
const path = require('path');
const { seal, open, msgId } = require('../lib/crypto');
const { Board, boardsFor } = require('../lib/board');

const FRESH = { hello: 10 * 60e3, offer: 90e3, settings: 24 * 3600e3, answer: 10 * 60e3 };

// Sets ctx.board, ctx.post, ctx.saveState, ctx.readySoon and ctx.onNote.
function startMailbox(ctx) {
  const { cfg, power, log, dir, viewer, keys, peers } = ctx;
  const STATE = path.join(dir, cfg.stateFile || 'direct-state.json');
  let state = {}; try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
  const seen = new Set(state.seen || []);
  const board = new Board(boardsFor(cfg.boards), keys.topic, { log, since: state.since || {} });
  const maxCmdAge = (cfg.maxCommandAgeMinutes || 60) * 60e3;
  let phoneWaitingTimer = null, readyTimer = null, lastReady = 0;
  const READY_AFTER = Number(process.env.POCKET_READY_AFTER_MS) || 15e3; // tests make it shorter

  let saveT;
  const saveState = () => { clearTimeout(saveT); saveT = setTimeout(() => {
    fs.writeFile(STATE, JSON.stringify({ since: board.since, seen: [...seen].slice(-500) }), { mode: 0o600 }, () => {});
  }, 500); };

  async function post(type, extra = {}, { own = false } = {}) {
    const note = { id: msgId(), ts: Date.now(), from: 'mac', type, ...extra };
    try { await board.publish(seal(keys, note), undefined, {}, { own }); return true; } catch (e) { if (!own) log(`could not post ${type}: ${e.message}`); return false; }
  }

  // The phone opened the app while this computer slept, and has moved on since (nothing connected
  // a little after it woke): tell it the computer is up now, so one tap connects. Once per 5 min.
  function readySoon() {
    if (viewer) return;
    clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      if (peers.size || Date.now() - lastReady < 5 * 60e3) return;
      lastReady = Date.now();
      power && power.setPhoneWanting(true);
      clearTimeout(phoneWaitingTimer); // give the tap time to arrive
      phoneWaitingTimer = setTimeout(() => power && power.setPhoneWanting(peers.size > 0), 3 * 60e3);
      ctx.notify({ kind: 'ready' }).catch(() => {});
    }, READY_AFTER);
  }

  // --- reading the mailbox ---
  function onNote(text) {
    if (typeof text === 'string' && text.startsWith('pta1.')) { if (!viewer) ctx.onAnswer(text); return; }
    const m = open(keys, text);
    if (!m || m.from !== 'phone' || typeof m.id !== 'string' || seen.has(m.id)) return;
    seen.add(m.id); saveState();
    if (process.env.POCKET_DEBUG_NOTES) log(`note ${m.type} ${Math.round((Date.now() - Number(m.ts)) / 1000)}s old`);
    const age = Date.now() - Number(m.ts);
    if (!(age > -2 * 60e3)) return; // clocks wildly off: ignore
    // Left while this computer slept (or a while ago): the phone may have given up waiting, so tell
    // it when we're up. Judged by when we woke, not a fixed age: a knock 4.9 s before waking counts.
    const whileAsleep = age > 5e3 || (ctx.wokeAt && Number(m.ts) < ctx.wokeAt);
    if (viewer && m.type !== 'hello' && m.type !== 'offer' && m.type !== 'pipe') return; // a viewer can only connect and watch
    if (m.type === 'hello' && age < FRESH.hello) {
      if (viewer) { ctx.postStatus('online', { force: true }); return; }
      // Phone opened the app: stay awake ~2 min so it can connect.
      power && power.setPhoneWanting(true);
      clearTimeout(phoneWaitingTimer);
      phoneWaitingTimer = setTimeout(() => power && power.setPhoneWanting(peers.size > 0), 2 * 60e3);
      log('phone said hello: staying awake for it' + (ctx.since ? ctx.since() : ''));
      // Not forced: the free board allows only a few hundred notes a day per connection. The phone
      // learns it's up from the answer to its offer anyway; this only posts if it was asleep.
      ctx.postStatus('online');
      if (whileAsleep) readySoon();
    } else if (m.type === 'offer' && age < FRESH.offer && typeof m.sdp === 'string') {
      if (process.env.POCKET_NO_DIRECT) return log('ignoring offer (POCKET_NO_DIRECT test switch)');
      Promise.resolve(ctx.answerOffer(m)).catch((e) => log('could not answer an offer: ' + e.message));
      if (whileAsleep) readySoon(); // it was posted while this computer slept
    } else if (m.type === 'pipe' && age < FRESH.offer && typeof m.pipe === 'string') {
      ctx.joinPipe(m.pipe); // the direct link was blocked: the phone waits on the board's pipe
    } else if (m.type === 'cmd' && age < maxCmdAge) {
      ctx.core.runJob(String(m.cid), m.cmd, (r) => ctx.deliver(r));
    } else if (m.type === 'settings' && age < FRESH.settings) {
      ctx.applySettings(m.power);
    } else if (m.type === 'answer' && age < FRESH.answer && typeof m.sid === 'string') {
      ctx.onBoardAnswer && ctx.onBoardAnswer(m); // answered from the phone's page of another computer
    } else if (m.type === 'agents?' && age < FRESH.answer) {
      ctx.postSummary && ctx.postSummary(true); // the phone wants a fresh list
    }
  }

  Object.assign(ctx, { board, post, saveState, readySoon, onNote });
}

module.exports = { startMailbox, FRESH };
