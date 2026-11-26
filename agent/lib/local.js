// The agent's local door: lets programs on this computer talk to the running agent.
//   run   "npx pocket-terminal run claude": the command runs in a Pocket Terminal session, shown
//         in your own terminal window AND on your phone. Walk away and carry on from the phone.
//   ask   an AI agent's permission question (Claude Code's hook): goes to the phone, waits for Allow/Deny.
//   event an AI agent started or finished working (its hooks): keeps the computer awake, "finished" alert.
//
// Only you can use it: a socket inside your private ~/.pocket-terminal folder (a named pipe on
// Windows), and every connection must show a random token kept in a file only you can read.

const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const WIN = process.platform === 'win32';
const sockPath = (dir) => (WIN
  ? `\\\\.\\pipe\\pocket-terminal-${crypto.createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 16)}`
  : path.join(dir, 'ctl.sock'));
const tokenPath = (dir) => path.join(dir, 'ctl.token');

function startLocal({ core, log, dir }) {
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(tokenPath(dir), token, { mode: 0o600 });
  const where = sockPath(dir);
  if (!WIN) { try { fs.unlinkSync(where); } catch {} }

  const server = net.createServer((c) => {
    let buf = '', authed = false, onLine = null;
    const send = (m) => { if (!c.destroyed) c.write(JSON.stringify(m) + '\n'); };
    const cleanup = [];
    c.on('close', () => cleanup.forEach((f) => { try { f(); } catch {} }));
    c.on('error', () => {});
    c.setTimeout(10e3, () => { if (!authed) c.destroy(); });
    c.on('data', (d) => {
      buf += d; if (buf.length > 1 << 20) return c.destroy();
      let i; while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { return c.destroy(); }
        if (!authed) {
          const a = Buffer.from(String(m.token || '')), b = Buffer.from(token);
          if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return c.destroy();
          authed = true; c.setTimeout(0);
          onLine = first(m);
        } else if (onLine) onLine(m);
      }
    });

    function first(m) {
      if (m.t === 'event') { core.extEvent(m); send({ ok: true }); c.end(); return null; }
      if (m.t === 'ask') {
        const q = core.ask(m);
        cleanup.push(() => q.cancel()); // the agent gave up waiting (or you answered on the computer)
        q.decision.then((v) => { send({ t: 'decision', v }); c.end(); });
        return null;
      }
      if (m.t === 'run') {
        const sid = 'L-' + crypto.randomBytes(5).toString('hex');
        const key = 'local:' + sid;
        const io = core.runIn(key, { cmd: String(m.cmd || '').slice(0, 4000), cwd: m.cwd, env: m.env }, m.cols | 0, m.rows | 0);
        let size = { cols: m.cols | 0, rows: m.rows | 0 };
        const client = (msg) => {
          if (msg.t === 'o') send({ t: 'o', d: msg.d });
          else if (msg.t === 'exit') { send({ t: 'exit', code: msg.code }); }
        };
        io.clients.add(client);
        cleanup.push(() => io.clients.delete(client)); // closing this window leaves it running for the phone
        log('a command started from this computer (also on your phone)');
        send({ t: 'started', sid });
        return (x) => {
          if (x.t === 'i' && typeof x.d === 'string') {
            // whoever types sets the size: back at the computer, the screen fits this window again
            const sz = io.size(); if (sz && size.cols && (sz.cols !== size.cols || sz.rows !== size.rows)) io.resize(size.cols, size.rows);
            io.input(x.d);
          } else if (x.t === 'r' && x.cols > 0 && x.rows > 0) { size = { cols: x.cols | 0, rows: x.rows | 0 }; io.resize(size.cols, size.rows); }
        };
      }
      if (m.t === 'mcp') { mcpCall(m).then((r) => { send(r); c.end(); }, () => { send({ error: 'Something went wrong in Pocket Terminal.' }); c.end(); }); return null; }
      c.destroy(); return null;
    }

    // An AI agent's tool call, from "npx pocket-terminal mcp" (agent/mcp.js). It can ask you and
    // tell you things on the phone, look at terminals, and start tasks. It can NOT type into
    // another terminal or answer another agent's question: an agent must never approve an agent.
    async function mcpCall(m) {
      const who = String(m.client || 'An AI agent').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 40) || 'An AI agent';
      const text = (v, n) => String(v == null ? '' : v).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim().slice(0, n);
      const all = () => [...new Set(core.keys().map((k) => k.slice(0, k.indexOf(':') + 1)).concat('local:'))].flatMap((p) => core.list(p).map((s) => ({ ...s, key: p + s.sid })));
      switch (m.op) {
        case 'ask': {
          const q = text(m.question, 300); if (!q) return { error: 'Write the question.' };
          const wait = Math.min(60, Math.max(1, Number(m.minutes) || 10)) * 60e3;
          const a = core.ask({ agent: who, text: q, cwd: m.cwd, words: true });
          cleanup.push(() => a.cancel());
          const v = await Promise.race([a.decision, new Promise((r) => { const t = setTimeout(() => r('late'), wait); t.unref && t.unref(); })]);
          if (v === 'late') { a.cancel(); return { answer: null, note: `No answer after ${Math.round(wait / 60e3)} minutes.` }; }
          if (v && typeof v === 'object' && v.text) return { answer: 'words', text: v.text };
          return { answer: v === 'yes' || v === 'no' ? v : null, ...(v === 'yes' || v === 'no' ? {} : { note: 'The question was dropped without an answer.' }) };
        }
        case 'notify': {
          const title = text(m.title, 80), body = text(m.message, 300); if (!title && !body) return { error: 'Write a title or a message.' };
          core.events.emit('alert', { key: 'local:L-mcp', kind: 'task', title: title || who, body });
          log('an AI agent sent a note to the phone'); // never what it says
          return { ok: true };
        }
        case 'terminals':
          return { terminals: all().filter((s) => !s.ask).map((s) => ({ id: s.key, program: s.ext ? s.agent : s.program || null, state: s.waiting ? 'blocked' : s.state || (s.busy ? 'working' : 'idle'), folder: s.cwd || null, question: s.waiting ? s.question : null, task: s.task ? s.task.title : null, branch: s.git ? s.git.branch : null })) };
        case 'read': {
          const key = String(m.id || ''); if (!core.isSession(key)) return { error: 'No terminal with that id. See list_terminals.' };
          const { plain } = require('./rules');
          const rows = plain(core.session(key).screen()).split('\n').map((l) => l.replace(/\s+$/, '')).filter((l, i, a) => l || (a[i - 1] || '')); // no runs of empty lines
          return { text: rows.slice(-Math.min(200, Math.max(5, Number(m.lines) || 40))).join('\n').slice(-12000) };
        }
        case 'task': { if (!core.tasks) return { error: 'Tasks are not available.' }; const r = await core.tasks.addTask({ agent: m.agent, prompt: m.task, cmd: m.command, cwd: m.folder, worktree: !!m.own_copy, from: { mcp: who } }); return r.error ? r : { ok: true, id: r.id, note: 'Added to the queue. See task_status.' }; }
        case 'race': { if (!core.tasks) return { error: 'Tasks are not available.' }; const r = await core.tasks.race({ prompt: m.task, cwd: m.folder, agents: m.agents, test: m.test, from: { mcp: who } }); return r.error ? r : { ok: true, id: r.id, note: 'Race started. The person picks the winner on the phone.' }; }
        case 'status': {
          if (!core.tasks) return { error: 'Tasks are not available.' };
          const v = core.tasks.view();
          return { agents: Object.keys(v.agents),
            tasks: v.tasks.filter((t) => !t.group).map((t) => ({ id: t.id, title: t.title, status: t.status, why: t.why || undefined, folder: t.where, seconds: t.seconds, changes: t.changes || undefined, cost: t.cost || undefined, last: t.last })),
            groups: v.groups.map((g) => ({ id: g.id, kind: g.kind === 'chain' ? 'hand-off' : g.kind, task: g.prompt, status: g.status, folder: g.where, lanes: g.lanes.map((id) => v.tasks.find((t) => t.id === id)).filter(Boolean).map((t) => ({ agent: t.title, status: t.status, changes: t.changes || undefined, tests: t.tests ? (t.tests.ok ? 'pass' : 'fail') : undefined, seconds: t.seconds, cost: t.cost || undefined })) })) };
        }
      }
      return { error: 'Unknown request.' };
    }
  });
  server.on('error', (e) => log('local door unavailable: ' + e.message));
  server.listen(where, () => { if (!WIN) { try { fs.chmodSync(where, 0o600); } catch {} } });
  return { stop: () => { server.close(); if (!WIN) { try { fs.unlinkSync(where); } catch {} } } };
}

// Client side, used by run.js and hook.js.
function connect(dir, first, { timeout = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    let token; try { token = fs.readFileSync(tokenPath(dir), 'utf8').trim(); } catch { return reject(new Error('not running')); }
    const c = net.connect(sockPath(dir));
    const t = setTimeout(() => { c.destroy(); reject(new Error('not running')); }, timeout);
    c.on('connect', () => { clearTimeout(t); c.write(JSON.stringify({ token, ...first }) + '\n'); resolve(c); });
    c.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}
function lines(c, fn) {
  let buf = '';
  c.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { fn(JSON.parse(l)); } catch {} } });
}

module.exports = { startLocal, connect, lines, sockPath };
