// AI agents running outside Pocket Terminal (e.g. Claude Code in VS Code), told to us by
// their hooks: their permission questions (Q-…) and whether they are working or done (C-…).
// core.js owns the two maps (asks, ext) and lists them with the terminal sessions.

const { gitChanges } = require('./git');

function outsideAgents({ asks, ext, events, log, tidy, busyChanged }) {
  // ---- AI agents running outside Pocket Terminal (e.g. Claude Code in VS Code), via their hooks ----
  // A permission question waits here until a phone answers, the computer answers it, or it's dropped.
  function ask({ agent, text, cwd }) {
    const key = 'local:Q-' + Math.random().toString(36).slice(2, 10);
    let done;
    const p = new Promise((res) => { done = res; });
    const a = { key, agent: String(agent || 'AI agent').slice(0, 40), text: String(text || '').slice(0, 300), cwd: tidy(cwd), at: Date.now(), done };
    asks.set(key, a);
    log(`${a.agent} asks for permission (sent to the phone)`); // what it asks is never logged
    events.emit('alert', { key, kind: 'input', program: a.agent, text: a.text, ask: true, cwd: a.cwd,
      choices: [{ a: 'yes', title: 'Allow', d: 'yes' }, { a: 'no', title: 'Deny', d: 'no' }] });
    const end = (v) => { if (!asks.has(key)) return; asks.delete(key); done(v); events.emit('alert', { key, kind: 'gone' }); };
    return { key, decision: p, cancel: () => end(null), settle: end };
  }
  // Working / finished, from the agent's own hooks. Keeps the computer awake while it works.
  function extEvent({ session, agent, cwd, kind, away = true }) {
    const id = String(session || 'x').replace(/[^\w-]/g, '').slice(0, 12) || 'x';
    const key = 'local:C-' + id, now = Date.now();
    let e = ext.get(key);
    if (!e) { e = { key, agent: String(agent || 'AI agent').slice(0, 40), cwd: null, since: now, last: now, busy: false, done: null, dir: null }; ext.set(key, e); }
    if (cwd) { e.dir = String(cwd); e.cwd = tidy(e.dir); }
    e.last = now;
    if (kind === 'stop') {
      if (e.busy) {
        e.busy = false;
        const seconds = Math.round((now - e.since) / 1000), d = { program: e.agent, at: now, seconds, changes: null }; e.done = d;
        gitChanges(e.dir, (ch) => { d.changes = ch; if (seconds >= 20 && away !== false) events.emit('alert', { key, kind: 'done', program: e.agent, seconds, changes: ch }); });
      }
    } else if (!e.busy) { e.busy = true; e.since = now; e.done = null; }
    for (const [k, x] of ext) if (now - x.last > 2 * 3600e3) ext.delete(k); // forget agents unheard of for 2 h
    busyChanged();
  }
  return { ask, extEvent };
}

module.exports = { outsideAgents };
