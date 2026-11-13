// Where terminals run: in the terminal holder (holder.js, a separate program that survives a
// restart of the agent), or, if it can't be used, right here with node-pty as before.
//
//   const host = await startHost({ dir, log })
//   host.spawn(file, args, opts, meta)   a terminal, with the same calls as a node-pty one
//   host.restored                        terminals the holder kept from before this agent started
//   host.kind                            'holder' or 'direct'
//
// The holder is used on Mac and Linux. On Windows terminals run in the agent as before: a running
// holder would keep node-pty's files open, and Windows can't update files that are open.
// POCKET_HOLDER=0 turns it off; POCKET_HOLDER=1 forces it (tests).

const fs = require('fs');
const net = require('net');
const path = require('path');
const { EventEmitter } = require('events');
const { spawn: spawnProc } = require('child_process');
const { sockPath, tokenPath, PROTO } = require('./holder');

const use = () => (process.env.POCKET_HOLDER === '1' || (process.env.POCKET_HOLDER !== '0' && process.platform !== 'win32'));

// A terminal in the holder, looking like a node-pty one to core.js.
class RemotePty extends EventEmitter {
  constructor(link, id, info = {}) {
    super();
    this.link = link; this.id = id; this.pid = info.pid || 0; this._pty = info.pty || null;
    this.cols = info.cols || 80; this.rows = info.rows || 24; this._proc = info.proc || null; this.dead = false;
  }
  get process() { return this._proc; }
  onData(f) { this.on('data', f); return { dispose: () => this.off('data', f) }; }
  onExit(f) { this.on('exit', f); return { dispose: () => this.off('exit', f) }; }
  write(d) { if (!this.dead) this.link.send({ op: 'write', id: this.id, d }); }
  resize(cols, rows) { if (this.dead) return; this.cols = cols; this.rows = rows; this.link.send({ op: 'resize', id: this.id, cols, rows }); }
  kill() { if (!this.dead) this.link.send({ op: 'kill', id: this.id }); }
  setMeta(meta) { if (!this.dead) this.link.send({ op: 'meta', id: this.id, meta }); }
  _exit(code) { if (this.dead) return; this.dead = true; this.emit('exit', { exitCode: code }); }
}

function connect(dir, ms = 3000) {
  return new Promise((res) => {
    let token; try { token = fs.readFileSync(tokenPath(dir), 'utf8').trim(); } catch { return res(null); }
    const c = net.connect(sockPath(dir));
    const t = setTimeout(() => { c.destroy(); res(null); }, ms);
    let buf = '';
    const first = (d) => {
      buf += d; const i = buf.indexOf('\n'); if (i < 0) return;
      clearTimeout(t); c.off('data', first);
      let hello; try { hello = JSON.parse(buf.slice(0, i)); } catch { c.destroy(); return res(null); }
      const rest = buf.slice(i + 1);
      res(hello && hello.op === 'hello' ? { c, hello, rest } : (c.destroy(), null));
    };
    c.on('data', first);
    c.on('connect', () => c.write(JSON.stringify({ op: 'hello', token, v: PROTO }) + '\n'));
    c.on('error', () => { clearTimeout(t); res(null); });
  });
}

function launch(dir, log) {
  return new Promise((res) => {
    const out = fs.openSync(path.join(dir, 'holder.log'), 'a');
    let p; try {
      // Its own session (detached): stopping the agent's service doesn't stop it.
      p = spawnProc(process.execPath, [path.join(__dirname, 'holder.js'), dir], { detached: true, stdio: ['ignore', out, out, 'ipc'], env: process.env, cwd: dir });
    } catch (e) { log('could not start the terminal holder: ' + e.message); return res(false); } finally { try { fs.closeSync(out); } catch {} }
    const t = setTimeout(() => res(false), 5000);
    p.once('message', () => { clearTimeout(t); try { p.disconnect(); } catch {} p.unref(); res(true); });
    p.once('exit', () => { clearTimeout(t); res(false); });
  });
}

async function startHost({ dir, log }) {
  const direct = () => { const pty = require('node-pty'); return { kind: 'direct', restored: [], spawn: (f, a, o) => pty.spawn(f, a, o), stop() {} }; };
  if (!dir || !use()) return direct();
  let got = await connect(dir);
  if (got && got.hello.v !== PROTO) { // an older holder from before an update
    if (!got.hello.list.length) { got.c.write(JSON.stringify({ op: 'quit' }) + '\n'); got.c.destroy(); await new Promise((r) => setTimeout(r, 500)); got = null; }
    else { log('the terminal holder is from another version and still holds terminals: using it as is'); }
  }
  if (!got) { if (await launch(dir, log)) got = await connect(dir); }
  if (!got) { log('terminal holder unavailable: terminals run in the agent (they end if it restarts)'); return direct(); }

  const { c } = got; const terms = new Map();
  let alive = true;
  const link = { send: (m) => { if (alive) try { c.write(JSON.stringify(m) + '\n'); } catch {} } };
  let buf = got.rest;
  const onLine = (l) => {
    let m; try { m = JSON.parse(l); } catch { return; }
    const r = terms.get(m.id); if (!r) return;
    if (m.op === 'data') r.emit('data', m.d);
    else if (m.op === 'exit') { terms.delete(m.id); r._exit(m.code); }
    else if (m.op === 'spawned') { r.pid = m.pid; r._pty = m.pty; }
    else if (m.op === 'proc') r._proc = m.p;
  };
  c.setNoDelay && c.setNoDelay(true);
  c.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); onLine(l); } });
  c.on('close', () => { // the holder went away: its terminals are gone
    if (!alive) return; alive = false; log('lost the terminal holder');
    for (const r of terms.values()) r._exit(-1); terms.clear();
  });
  c.on('error', () => {});
  const restored = got.hello.list.map((x) => { const r = new RemotePty(link, x.id, x); terms.set(x.id, r); return { term: r, meta: x.meta || {}, buf: x.buf || '' }; });
  log(`terminal holder ready (pid ${got.hello.pid})${restored.length ? `: ${restored.length} terminal${restored.length === 1 ? '' : 's'} kept from before` : ''}`);
  let n = 0;
  const pty = require('node-pty');
  return {
    kind: 'holder', restored, pid: got.hello.pid,
    spawn(file, args, opts, meta = {}) {
      if (!alive) return pty.spawn(file, args, opts); // fall back for the rest of this run
      const id = `${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const r = new RemotePty(link, id, { cols: opts.cols, rows: opts.rows });
      terms.set(id, r);
      link.send({ op: 'spawn', id, file, args, opts: { name: opts.name, cols: opts.cols, rows: opts.rows, cwd: opts.cwd, env: opts.env }, meta });
      return r;
    },
    // The agent is stopping for good (not restarting): close the terminals and the holder.
    quit() { link.send({ op: 'quit' }); },
    stop() { alive = false; try { c.destroy(); } catch {} },
  };
}

module.exports = { startHost };
