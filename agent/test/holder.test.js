// The terminal holder: terminals survive a restart of the agent (an update, a crash), with their
// screen, and keep running; a task that was running carries on and finishes; only the right token
// gets in; the holder leaves when told to.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

if (process.platform === 'win32') { console.log('- holder.test: skipped on Windows (no holder there)'); process.exit(0); }
process.env.POCKET_SHELL = '/bin/bash';
process.env.POCKET_HOLDER = '1';
process.env.POCKET_WORK_QUIET_MS = '900';
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-hold-'));
process.env.POCKET_HOME = DIR;
const { startHost } = require('../lib/ptyhost');
const { createCore } = require('../lib/core');
const { createTasks } = require('../lib/tasks');
const { sockPath } = require('../lib/holder');

let fails = 0;
const ok = (name, v, extra = '') => { console.log((v ? '✓ ' : '✗ ') + name + (v ? '' : ' ' + extra)); if (!v) { fails++; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(100); } }
const logs = []; const log = (...a) => logs.push(a.join(' '));

(async () => {
  let host = await startHost({ dir: DIR, log });
  ok('holder: started as its own program', host.kind === 'holder' && host.pid !== process.pid, logs.join(' | '));
  let core = createCore({ log, power: null, dir: DIR, host });
  core.startIn('dev1:abc', { cmd: 'for i in $(seq 1 400); do echo tick $i; sleep 0.1; done', cwd: DIR });
  await until(() => /tick 5/.test(core.session('dev1:abc').screen()));
  let tasks = createTasks({ core, log, dir: DIR, shell: '/bin/bash', alert: () => {} });
  const tk = await tasks.addTask({ cmd: 'sleep 3; echo made > made.txt', cwd: DIR });
  await until(() => tasks.view().tasks.find((t) => t.id === tk.id && t.status === 'running'));
  await until(() => /made\.txt/.test(core.session(`local:L-t${tk.id}`).screen())); // typed in

  // --- the agent restarts ---
  tasks.stop(); core.stop({ keep: true }); host.stop();
  await sleep(700);
  host = await startHost({ dir: DIR, log });
  ok('restart: the holder still holds both terminals', host.kind === 'holder' && host.restored.length === 2, JSON.stringify(host.restored.map((r) => r.meta)));
  core = createCore({ log, power: null, dir: DIR, host });
  ok('restart: they come back under their own names', core.restore(host.restored) === 2 && core.isSession('dev1:abc') && core.isSession(`local:L-t${tk.id}`));
  const io = core.session('dev1:abc');
  ok('restart: with the screen from before', /tick 5/.test(io.screen()));
  const before = (io.screen().match(/tick (\d+)/g) || []).length;
  await sleep(800);
  ok('restart: and the program kept running (new output)', (io.screen().match(/tick (\d+)/g) || []).length > before);
  io.input('\x03'); await sleep(300); io.input('echo typed-after-restart\r');
  ok('restart: typing works', !!(await until(() => /typed-after-restart\r?\n/.test(io.screen().split('echo typed-after-restart').slice(-1)[0] || ''))));
  tasks = createTasks({ core, log, dir: DIR, shell: '/bin/bash', alert: () => {} });
  ok('restart: the running task is still running', tasks.view().tasks.find((t) => t.id === tk.id).status === 'running');
  ok('restart: and it finishes', !!(await until(() => tasks.view().tasks.find((t) => t.id === tk.id && t.status === 'done'), 8000)) && fs.existsSync(path.join(DIR, 'made.txt')));

  // --- a stranger without the token gets nothing ---
  const stranger = await new Promise((res) => {
    const c = net.connect(sockPath(DIR)); let got = '';
    c.on('connect', () => c.write(JSON.stringify({ op: 'hello', token: 'wrong' }) + '\n'));
    c.on('data', (d) => { got += d; }); c.on('close', () => res(got)); c.on('error', () => res(got));
    setTimeout(() => { c.destroy(); res(got); }, 1500);
  });
  ok('holder: a wrong token is turned away', stranger === '');
  ok('holder: its socket and token are private', (fs.statSync(sockPath(DIR)).mode & 0o077) === 0 && (fs.statSync(path.join(DIR, 'holder.token')).mode & 0o077) === 0);

  // --- closing a terminal for real ---
  core.close('dev1:abc'); await sleep(400);
  tasks.stop(); core.stop({ keep: true }); host.stop(); await sleep(300);
  host = await startHost({ dir: DIR, log });
  ok('close: a closed terminal is gone from the holder too', !host.restored.some((r) => r.meta.key === 'dev1:abc'));
  const pid = host.pid;
  host.quit(); await sleep(800);
  let alive = true; try { process.kill(pid, 0); } catch { alive = false; }
  ok('quit: the holder leaves when told to', !alive);
  host.stop();
  console.log(fails ? `${fails} failed` : 'holder: all passed');
  process.exit(fails ? 1 : 0);
})();
