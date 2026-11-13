// "Every agent on every computer" for the phone. The phone has a live link to one computer at a
// time; for the others it reads a short, encrypted summary each one leaves in the phone's
// mailbox: which agents run there, which need you and what they ask. Answers come back the same
// way (an encrypted "answer" note), so you can answer an agent on your desktop while your phone is
// linked to your laptop.
//
// Posted only when something changed, at most every 20 s (the board's daily limit), and once
// more when a phone disconnects, so the mailbox always holds where things stand.

const { choicesFor } = require('../lib/core');

const MIN_GAP = Number(process.env.POCKET_SUMMARY_GAP_MS) || 20e3;
const MAX_JSON = 2400; // sealed and encoded it must stay under the board's 3.8 KB per note

// Sets ctx.postSummary and ctx.onBoardAnswer. Needs ctx.post (mailbox.js).
function startSummary(ctx) {
  const { cfg, core, log, keys, viewer } = ctx;
  if (viewer) { ctx.postSummary = () => {}; ctx.onBoardAnswer = () => {}; return; }
  const deviceKey = cfg.deviceId || keys.topic.slice(3, 11);
  const keyFor = (sid) => { const v = String(sid || '').replace(/[^\w-]/g, '').slice(0, 40); return /^[LQC]-/.test(v) ? `local:${v}` : `${deviceKey}:${v}`; };

  function body() {
    const all = [...core.list(deviceKey + ':'), ...core.list('local:')];
    const st = (s) => (s.waiting ? 'blocked' : s.state || (s.busy ? 'working' : 'idle'));
    const rank = { blocked: 0, working: 1, idle: 2 };
    const list = all.filter((s) => s.waiting || s.program || s.ext || s.task || s.done)
      .sort((a, b) => rank[st(a)] - rank[st(b)] || (b.lastOut || 0) - (a.lastOut || 0)).slice(0, 12)
      .map((s) => ({ sid: s.sid, p: s.ext ? s.agent : s.program || (s.done && s.done.program) || null, st: st(s), q: s.waiting ? String(s.question || '').slice(0, 120) : undefined,
        menu: s.waiting && s.menu ? 1 : undefined, ask: s.ask ? 1 : undefined, cwd: s.cwd ? String(s.cwd).slice(-40) : undefined, at: s.waiting ? s.askedAt : s.lastOut || s.created, t: s.task ? String(s.task.title).slice(0, 40) : undefined }));
    let b = { list, n: all.length };
    while (JSON.stringify(b).length > MAX_JSON && b.list.length) b = { ...b, list: b.list.slice(0, -1) };
    return b;
  }
  let last = '', lastAt = 0, timer = null;
  function postSummary(now = false) {
    clearTimeout(timer);
    const wait = now ? 0 : Math.max(1500, MIN_GAP - (Date.now() - lastAt));
    timer = setTimeout(async () => {
      const b = body(); const k = JSON.stringify(b.list.map((x) => [x.sid, x.st, x.q, x.p, x.t]));
      if (k === last && Date.now() - lastAt < (now ? 60e3 : 6 * 3600e3)) return; // asked for: only if the one on the board is over a minute old
      if (await ctx.post('agents', b, { own: true })) { last = k; lastAt = Date.now(); }
    }, wait);
    timer.unref && timer.unref();
  }
  const onState = () => postSummary();
  core.events.on('state', onState);
  core.events.on('alert', onState);

  // An answer from the phone through the board (Agents → other computers).
  function onBoardAnswer(m) {
    const key = keyFor(m.sid);
    let ok = false;
    if (m.a === 'say' && typeof m.text === 'string') ok = core.reply(key, m.text);
    else if (m.a === 'yes' || m.a === 'no') {
      if (/^local:Q-/.test(key)) ok = core.answer(key, m.a);
      else { const q = core.question(key), c = q && choicesFor(q.text, q.menu).find((x) => x.a === m.a); ok = !!c && core.answer(key, c.d); }
    }
    log(ok ? `answered "${m.a}" from another computer's page on the phone` : 'an answer through the board came after the question was gone');
    ctx.x.activity && ctx.x.activity({ ev: 'answered', where: 'through the board' });
    postSummary(true);
  }

  ctx.postSummary = postSummary;
  ctx.onBoardAnswer = onBoardAnswer;
  ctx.stopSummary = () => { clearTimeout(timer); core.events.off('state', onState); core.events.off('alert', onState); };
}

module.exports = { startSummary };
