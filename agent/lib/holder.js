#!/usr/bin/env node
// The terminal holder: a small separate program that owns the terminals, so they survive when
// the agent restarts (an update, a crash). The agent talks to it over a private socket in
// ~/.pocket-terminal; when the agent comes back it picks every terminal up again, with its
// screen. Your AI agent keeps working through an update of Pocket Terminal.
//
//   node holder.js <pocket home>
//
// It only runs terminals and passes bytes; it knows nothing about phones, keys or the network.
// Only you can use it: the socket sits in your private folder, and the first message on every
// connection must carry the random token kept in holder.token (readable by you only).
// It leaves by itself once no terminal is left and the agent has been gone for a minute.
//
// Wire: one JSON per line.
//   agent → holder  hello{token,v} spawn{id,file,args,opts,meta} write{id,d} resize{id,cols,rows} kill{id} quit
//   holder → agent  hello{v,pid,list[{id,pid,pty,cols,rows,meta,buf}]} spawned{id,pid,pty} data{id,d} exit{id,code} proc{id,p}

const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const PROTO = 1;
const BUF = 256 * 1024;
const WIN = process.platform === 'win32';
const sockPath = (dir) => (WIN ? `\\\\.\\pipe\\pocket-terminal-holder-${crypto.createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 16)}` : path.join(dir, 'holder.sock'));
const tokenPath = (dir) => path.join(dir, 'holder.token');
const pidPath = (dir) => path.join(dir, 'holder.pid');

function main(dir) {
  let pty; try { pty = require('node-pty'); } catch { pty = require(path.join(__dirname, '..', 'node_modules', 'node-pty')); }
  const log = (...a) => { try { fs.appendFileSync(path.join(dir, 'holder.log'), `${new Date().toISOString()} ${a.join(' ')}\n`); } catch {} };
  const token = crypto.randomBytes(24).toString('hex');
  const terms = new Map(); // id -> { t, buf, meta, pid, pty, cols, rows, proc }
  let client = null, lastClient = Date.now();
  const send = (m) => { if (client && !client.destroyed) try { client.write(JSON.stringify(m) + '\n'); } catch {} };

  function spawn(m) {
    if (terms.has(m.id)) return;
    let t;
    try { t = pty.spawn(m.file, m.args || [], m.opts || {}); } catch (e) { send({ op: 'exit', id: m.id, code: -1, error: String(e.message) }); return; }
    const x = { t, buf: '', meta: m.meta || {}, pid: t.pid, pty: t._pty || null, cols: (m.opts && m.opts.cols) || 80, rows: (m.opts && m.opts.rows) || 24, proc: null };
    terms.set(m.id, x);
    t.onData((d) => { x.buf += d; if (x.buf.length > BUF) x.buf = x.buf.slice(-BUF); send({ op: 'data', id: m.id, d }); });
    t.onExit(({ exitCode } = {}) => { terms.delete(m.id); send({ op: 'exit', id: m.id, code: exitCode || 0 }); });
    send({ op: 'spawned', id: m.id, pid: t.pid, pty: x.pty });
  }
  function onMsg(c, m) {
    if (!c.ok) {
      const a = Buffer.from(String(m.token || '')), b = Buffer.from(token);
      if (m.op !== 'hello' || a.length !== b.length || !crypto.timingSafeEqual(a, b)) { c.destroy(); return; }
      c.ok = true;
      if (client && client !== c) { try { client.destroy(); } catch {} } // the agent restarted: the new one takes over
      client = c;
      c.write(JSON.stringify({ op: 'hello', v: PROTO, pid: process.pid, list: [...terms].map(([id, x]) => ({ id, pid: x.pid, pty: x.pty, cols: x.cols, rows: x.rows, meta: x.meta, buf: x.buf, proc: x.proc })) }) + '\n');
      return;
    }
    const x = m.id && terms.get(m.id);
    switch (m.op) {
      case 'spawn': spawn(m); break;
      case 'write': if (x && typeof m.d === 'string') x.t.write(m.d); break;
      case 'resize': if (x && m.cols > 0 && m.rows > 0) { try { x.t.resize(m.cols, m.rows); x.cols = m.cols; x.rows = m.rows; } catch {} } break;
      case 'kill': if (x) { try { x.t.kill(); } catch {} } break;
      case 'meta': if (x && m.meta && typeof m.meta === 'object') x.meta = { ...x.meta, ...m.meta }; break;
      case 'quit': for (const y of terms.values()) { try { y.t.kill(); } catch {} } setTimeout(() => process.exit(0), 300); break;
    }
  }

  // The foreground program of each terminal, for the agent's "what is running" (it can't ask node-pty itself).
  setInterval(() => {
    for (const [id, x] of terms) { let p = null; try { p = x.t.process; } catch {} if (p !== x.proc) { x.proc = p; send({ op: 'proc', id, p }); } }
    if (!terms.size && (!client || client.destroyed) && Date.now() - lastClient > 60e3) { log('nothing left to hold: leaving'); process.exit(0); }
  }, 1000).unref();

  const sp = sockPath(dir);
  if (!WIN) { try { fs.unlinkSync(sp); } catch {} }
  const server = net.createServer((c) => {
    let buf = '';
    c.setNoDelay && c.setNoDelay(true);
    c.on('data', (d) => {
      buf += d; if (!c.ok && buf.length > 4096) return c.destroy();
      let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(l); } catch { continue; } onMsg(c, m); if (c.destroyed) return; }
    });
    c.on('close', () => { if (client === c) { client = null; lastClient = Date.now(); log('agent went away; holding ' + terms.size + ' terminals'); } });
    c.on('error', () => {});
  });
  server.listen(sp, () => {
    if (!WIN) try { fs.chmodSync(sp, 0o600); } catch {}
    fs.writeFileSync(tokenPath(dir), token, { mode: 0o600 });
    fs.writeFileSync(pidPath(dir), String(process.pid), { mode: 0o600 });
    log(`holding terminals (pid ${process.pid})`);
    if (process.send) process.send('ready');
  });
  server.on('error', (e) => { log('could not listen: ' + e.message); process.exit(1); });
  const bye = () => { for (const y of terms.values()) { try { y.t.kill(); } catch {} } process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', () => {}); // an agent's Ctrl+C must not take the terminals with it
  process.on('SIGHUP', () => {});
  process.on('uncaughtException', (e) => log('error: ' + (e && e.stack || e)));
}

module.exports = { sockPath, tokenPath, pidPath, PROTO };
if (require.main === module) main(path.resolve(process.argv[2] || path.join(require('os').homedir(), '.pocket-terminal')));
