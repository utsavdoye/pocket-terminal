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
      c.destroy(); return null;
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
