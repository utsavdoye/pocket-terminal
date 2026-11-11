// Phone notifications: "your terminal needs you", "finished", "awake". Sent as web push
// when the phone turned that on, otherwise through the ntfy app. Also the Yes/No answer
// buttons on a notification and reading the answers they send back.

const os = require('os');
const crypto = require('crypto');
const webpush = require('../lib/webpush');
const { choicesFor } = require('../lib/core');

// Sets ctx.notify and ctx.onAnswer. Needs ctx.board (mailbox.js).
function startNotify(ctx) {
  const { cfg, core, log, x, viewer, keys, peers, board } = ctx;

  // --- "your terminal needs you": a phone notification, unless you're looking at that session ---
  const lastAlert = new Map();
  // Answer buttons on a notification. Each question gets a one-time id and its own key, sent inside
  // the encrypted notification. The phone's service worker answers by posting an encrypted note to
  // the mailbox, so it works with the app closed and the phone locked (Android).
  const asks = new Map(); // id -> { key, k, choices, exp }
  const ASK_TTL = 30 * 60e3;
  function answerButtons(ev) {
    const choices = Array.isArray(ev.choices) ? ev.choices : choicesFor(ev.text, ev.menu);
    if (!choices.length || !ev.key) return null;
    for (const [id, a] of asks) if (a.exp < Date.now() || a.key === ev.key) asks.delete(id); // one live question per terminal
    const id = crypto.randomBytes(9).toString('base64url'), k = crypto.randomBytes(32);
    asks.set(id, { key: ev.key, k, choices, exp: Date.now() + ASK_TTL });
    return { id, k: k.toString('base64url'), b: (cfg.boards || ['https://ntfy.sh'])[0], tp: keys.topic, acts: choices.map((c) => ({ action: c.a, title: c.title })) };
  }
  function onAnswer(text) {
    const [, id, blob] = text.split('.');
    const a = id && asks.get(id); if (!a || !blob) return;
    let msg; try {
      const raw = Buffer.from(blob, 'base64url'), iv = raw.subarray(0, 12), ct = raw.subarray(12, -16), tag = raw.subarray(-16);
      const d = crypto.createDecipheriv('aes-256-gcm', a.k, iv); d.setAuthTag(tag);
      msg = JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString());
    } catch { return; } // not ours, or tampered with
    asks.delete(id); // works once
    if (a.exp < Date.now() || !(Math.abs(Date.now() - Number(msg.ts)) < ASK_TTL)) return log('ignored an expired answer from a notification');
    const c = a.choices.find((x) => x.a === msg.a); if (!c) return;
    log(core.answer(a.key, c.d) ? `answered "${c.a}" from a notification` : 'answer from a notification came after the question was gone: ignored');
  }
  async function notify(ev, force = false) {
    if (viewer || ev.kind === 'auto' || ev.kind === 'gone') return 'none'; // auto-approved: shown in the app, no buzz
    // Watching = showing that terminal AND heard from in the last 12 s (a closed app's link can linger ~30 s).
    const watching = [...peers.values()].some((p) => p.key === ev.key && Date.now() - p.seen < 12e3);
    if (watching && !force) return 'none';
    if (!force && Date.now() - (lastAlert.get(ev.key + ev.kind) || 0) < 20e3) return 'none';
    lastAlert.set(ev.key + ev.kind, Date.now());
    const prog = ev.program ? ev.program[0].toUpperCase() + ev.program.slice(1) : 'Your terminal';
    const sid = ev.key ? ev.key.split(':').slice(1).join(':') : '';
    const where = ev.cwd ? ` · ${ev.cwd}` : '';
    const msg = ev.kind === 'input' && ev.ask ? { title: `${prog} asks for permission`, body: (ev.text || 'It is waiting for your answer.') + where }
      : ev.kind === 'input' ? { title: `${prog} needs you`, body: ev.text || 'It is waiting for your answer.' }
      : ev.kind === 'done' ? { title: `${prog} finished`, body: `after ${ev.seconds >= 120 ? Math.round(ev.seconds / 60) + ' min' : ev.seconds + ' s'}${ev.changes && ev.changes.files ? ` · ${ev.changes.files} file${ev.changes.files === 1 ? '' : 's'} changed (+${ev.changes.add} −${ev.changes.del})` : ''}.${Array.isArray(ev.last) && ev.last.length ? '\n' + ev.last.join('\n') : ' Tap to see the result.'}` }
      : ev.kind === 'quiet' ? { title: 'Your terminal went quiet', body: ev.text || 'It may be done, or waiting for you.' }
      : ev.kind === 'ready' ? { title: `${cfg.name || os.hostname()} is awake ✓`, body: 'Ready when you are. Tap to connect (it stays awake for 3 minutes).' }
      : { title: 'Notifications work ✅', body: `${cfg.name || os.hostname()} can reach this phone.` };
    const subs = x.subs ? x.subs() : [];
    const ans = ev.kind === 'input' && subs.length ? answerButtons(ev) : null;
    let how = 'none';
    for (const sub of subs) {
      const r = await webpush.send(x.pushKeys, sub, { ...msg, sid: sid || null, kind: ev.kind, tag: ev.kind === 'ready' ? 'pt-ready' : `pt-${sid}`, ...(ans ? { ans } : {}) }, { topic: ev.kind === 'ready' ? 'ptready' : `pt${sid}` });
      if (r === 'gone') x.removeSub(sub.endpoint); if (r === 'ok') how = 'push';
    }
    if (how === 'none' && cfg.notify !== false) { // no phone notifications set up: the ntfy app, without any details
      await board.publish(ev.kind === 'input' ? 'Your terminal needs you 👋' : ev.kind === 'test' ? 'Notifications work ✅' : ev.kind === 'ready' ? 'Your computer is awake ✓ Open Pocket Terminal to connect.' : 'A program finished ✅', keys.notifyTopic, { Title: 'Pocket Terminal' }).then(() => { how = 'ntfy'; }).catch(() => {});
    }
    if (how !== 'none') log(`notified the phone (${ev.kind}, ${how})`);
    return how;
  }

  Object.assign(ctx, { notify, onAnswer });
}

module.exports = { startNotify };
