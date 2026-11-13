// Working with agents from the phone, on a real terminal: git (branch, commit, push, worktrees),
// what each terminal is doing (working / blocked / idle), "tell me when it says …", the "always
// ask" rules, and tasks: the queue, a race between two agents, a hand-off chain.
// Uses a pretend agent (fixtures/fake-agent.js) instead of a real one.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform === 'win32') { console.log('- work.test: skipped on Windows (uses bash)'); process.exit(0); }
process.env.POCKET_SHELL = '/bin/bash';
process.env.POCKET_WORK_QUIET_MS = '900';
process.env.POCKET_TASK_IDLE_MS = '1200';
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-work-'));
process.env.POCKET_HOME = HOME;
Object.assign(process.env, { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' });

const { createCore } = require('../lib/core');
const G = require('../lib/git');
const rules = require('../lib/rules');
const { createTasks, quote, marker } = require('../lib/tasks');

let fails = 0;
const ok = (name, v, extra = '') => { console.log((v ? '✓ ' : '✗ ') + name + (v ? '' : ' ' + extra)); if (!v) { fails++; process.exitCode = 1; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(100); } }
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const FAKE = path.join(__dirname, 'fixtures', 'fake-agent.js');

function repo(name) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `pt-${name}-`));
  sh(d, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(d, 'README.md'), 'hi\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'first');
  return d;
}

(async () => {
  // ---------- rules ----------
  const cfg = { enabled: true, allow: ['npm test', 'git status'], ask: rules.DEFAULT_ASK };
  ok('auto-yes: an allowed step is answered', !!rules.autoDecision(cfg, 'Bash(npm test)\nDo you want to proceed?', 'Do you want to proceed?', true));
  ok('auto-yes: a step with an "always ask" word still asks', !rules.autoDecision(cfg, 'Bash(git push && npm test)\nDo you want to proceed?', 'Do you want to proceed?', true));
  ok('auto-yes: your own "always ask" word works', !rules.autoDecision({ ...cfg, ask: ['vercel'] }, 'Bash(npm test; vercel)\nDo you want to proceed?', 'Do you want to proceed?', true));
  ok('auto-yes: sudo and rm -rf ask, even if you emptied the list', !rules.autoDecision({ ...cfg, ask: [] }, 'sudo npm test\nDo you want to proceed?', 'Do you want to proceed?', true) && !rules.autoDecision({ ...cfg, ask: [] }, 'rm -rf build && npm test\nDo you want to proceed?', 'Do you want to proceed?', true));
  ok('auto-yes: a word matches at a word start only ("rm" is not in "format")', rules.askHit({ ask: ['rm'] }, 'npm run format') === null && rules.askHit({ ask: ['rm'] }, 'rmdir x') === 'rm');
  ok('quote: a task with quotes is one shell word', quote("it's \"fine\"", '/bin/bash') === `'it'\\''s "fine"'` && quote("it's", 'powershell.exe') === "'it''s'");
  ok('marker: PowerShell gets its own exit code variable', /\$LASTEXITCODE/.test(marker('x', 'pwsh')) && /\$\?/.test(marker('x', '/bin/zsh')));

  // ---------- git ----------
  const r = repo('git');
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-bare-')); sh(bare, 'init', '-q', '--bare');
  sh(r, 'remote', 'add', 'origin', bare);
  let info = await G.gitInfo(r);
  ok('git: branch, no remote branch yet, clean', info && info.branch === 'main' && !info.upstream && info.dirty === 0, JSON.stringify(info));
  fs.writeFileSync(path.join(r, 'a.js'), 'x\n');
  ok('git: an empty message is refused', !!(await G.gitCommit(r, '  ')).error);
  const c = await G.gitCommit(r, 'Add a');
  ok('git: commit from the phone', c.ok && /^[0-9a-f]{7,}$/.test(c.commit), JSON.stringify(c));
  ok('git: nothing to commit says so', /Nothing to commit/.test((await G.gitCommit(r, 'again')).error || ''));
  info = await G.gitInfo(r);
  const p = await G.gitPush(r);
  ok('git: first push makes the remote branch', p.ok && sh(bare, 'rev-parse', 'main') === sh(r, 'rev-parse', 'HEAD'), JSON.stringify(p));
  fs.writeFileSync(path.join(r, 'b.js'), 'y\n'); await G.gitCommit(r, 'Add b');
  info = await G.gitInfo(r);
  ok('git: ahead 1 after a new commit', info.upstream === 'origin/main' && info.ahead === 1 && info.behind === 0, JSON.stringify(info));
  ok('git: push without a remote says so plainly', /no remote/i.test((await G.gitPush(repo('noremote'))).error || ''));
  const w = await G.worktreeAdd(r, 'Claude!');
  ok('git: worktree on its own branch, outside the project', w.ok && w.branch === 'pt/claude' && fs.existsSync(path.join(w.dir, 'a.js')) && !w.dir.startsWith(r), JSON.stringify(w));
  fs.writeFileSync(path.join(w.dir, 'c.js'), 'z\n');
  await G.worktreeSave(w.dir, 'c from claude');
  const m = await G.worktreeMerge(r, w.branch, 'merge it');
  ok('git: its work merges into the project', m.ok && fs.existsSync(path.join(r, 'c.js')), JSON.stringify(m));
  await G.worktreeRemove(r, w.dir, w.branch);
  ok('git: worktree and branch removed', !fs.existsSync(w.dir) && !sh(r, 'branch', '--list', 'pt/claude'));
  ok('git: not a git folder', (await G.gitInfo(os.tmpdir())) === null);

  // ---------- core: states and watches ----------
  const alerts = [];
  const core = createCore({ log: () => {}, power: null, dir: HOME });
  core.events.on('alert', (ev) => alerts.push(ev));
  const states = []; core.events.on('state', (ev) => states.push(ev));
  const work = repo('core');
  const io = core.startIn('local:L-x1', { cmd: `${FAKE} hello`, cwd: work });
  ok('startIn: a terminal in that folder', !!io);
  const wid = core.addWatch('local:L-x1', 'ALL DONE');
  ok('watch: added', wid.ok);
  ok('watch: bad pattern refused', !!core.addWatch('local:L-x1', '/(/').error);
  ok('state: the agent shows as working', !!(await until(() => states.find((s) => s.key === 'local:L-x1' && s.to === 'working'))));
  ok('watch: fires when it says it', !!(await until(() => alerts.find((a) => a.kind === 'match' && a.pattern === 'ALL DONE'))));
  ok('watch: fires once', (await sleep(500), alerts.filter((a) => a.kind === 'match').length === 1));
  ok('state: then idle', !!(await until(() => states.find((s) => s.key === 'local:L-x1' && s.from === 'working' && s.to === 'idle'))));
  ok('list: state and branch for the dashboard', !!(await until(() => { const l = core.list('local:').find((x) => x.sid === 'L-x1'); return l && l.state === 'idle' && l.git && l.git.branch === 'main'; })));
  ok('the agent ran in that folder', fs.existsSync(path.join(work, 'hello.txt')));
  core.close('local:L-x1');

  // a full-screen program: a phone joining later gets the whole screen and its modes, not half a screen
  core.startIn('local:L-fs', { cmd: `node ${path.join(__dirname, 'fixtures', 'fullscreen.js')}`, cwd: work, cols: 80, rows: 24 });
  const fs1 = core.session('local:L-fs');
  await until(() => /counter 39\d/.test(fs1.screen()), 15000);
  const lost = !/LINE-3/.test(fs1.screen().slice(-3000)); // the first full drawing is far back in the history
  const shot = await new Promise((r) => fs1.fit(80, 24, r));
  ok('full screen: rejoining redraws the whole screen with its modes', /\x1b\[\?1049h/.test(shot) && /\x1b\[\?1000h/.test(shot) && /\x1b\[\?1006h/.test(shot) && /LINE-1/.test(shot) && /LINE-5/.test(shot), JSON.stringify(shot.slice(0, 200)) + ' lost=' + lost);
  ok('full screen: the size is back as it was', fs1.size().rows === 24 && fs1.size().cols === 80);
  fs1.input('q'); await sleep(300);
  const plainShot = await new Promise((r) => fs1.fit(80, 24, r));
  ok('a plain shell keeps its history as is (no redraw)', plainShot === fs1.screen());
  core.close('local:L-fs');

  // ---------- tasks ----------
  const told = [];
  const tasks = createTasks({ core, log: () => {}, dir: HOME, shell: '/bin/bash', alert: (ev) => told.push(ev) });
  const send = (out) => (msg) => out.push(msg);
  let out = [];
  await tasks.onPhone({ t: 'task-cfg', id: 'c', agents: { fake: `${FAKE} {q}`, once: `${FAKE} --once {q}` } }, send(out), (s) => s, () => {});
  ok('tasks: agents can be set from the phone', out[0] && out[0].agents.fake && !out[0].agents.claude);

  // queue: two commands, one after the other
  const q = repo('queue');
  out = [];
  await tasks.onPhone({ t: 'task-add', id: 'a', cmd: 'sleep 1; echo first > one.txt', cwd: q }, send(out), (s) => s, () => {});
  await tasks.onPhone({ t: 'task-add', id: 'b', cmd: 'test -f one.txt && echo second > two.txt; false', cwd: q }, send(out), (s) => s, () => {});
  const v = tasks.view();
  ok('queue: the second waits for the first', v.tasks.filter((t) => t.kind === 'queue').map((t) => t.status).join() === 'running,waiting', v.tasks.map((t) => t.status).join());
  await until(() => tasks.view().tasks.filter((t) => t.kind === 'queue').every((t) => ['done', 'failed'].includes(t.status)), 20000);
  const qs = tasks.view().tasks.filter((t) => t.kind === 'queue');
  ok('queue: both ran, in order, with their exit codes', qs[0].status === 'done' && qs[1].status === 'failed' && fs.existsSync(path.join(q, 'two.txt')), JSON.stringify(qs.map((t) => [t.status, t.why])));
  await until(() => told.some((e) => /queue/i.test(e.title)));
  ok('queue: one notification at the end', told.filter((e) => /queue/i.test(e.title)).length === 1 && /1 failed/.test(told.find((e) => /queue/i.test(e.title)).title));
  ok('queue: a folder that isn\'t there is refused', !!(await tasks.addTask({ cmd: 'ls', cwd: '/nope/nope' })).error);

  // race: two agents, each in its own copy; tests decide
  const rr = repo('race');
  out = [];
  await tasks.onPhone({ t: 'race', id: 'r', prompt: 'apple pie', cwd: rr, agents: ['fake', 'once'], test: 'test -f apple.txt && test "$(basename $PWD)" != x' }, send(out), (s) => s, () => {});
  const res = out[0]; res.id = res.made; // the reply's id is the phone's request; the new race is 'made'
  ok('race: started', res && res.ok, JSON.stringify(res && res.error));
  const g = await until(() => tasks.view().groups.find((x) => x.id === res.id && x.status === 'compare'), 30000);
  ok('race: ready to compare once both are done', !!g, JSON.stringify(tasks.view().groups));
  const lanes = tasks.view().tasks.filter((t) => t.group === res.id);
  ok('race: each lane changed 1 file, in its own copy, not in the project', lanes.every((t) => t.changes && t.changes.files === 1) && !fs.existsSync(path.join(rr, 'apple.txt')), JSON.stringify(lanes.map((t) => t.changes)));
  ok('race: tests ran in each copy', lanes.every((t) => t.tests && t.tests.ok), JSON.stringify(lanes.map((t) => t.tests)));
  ok('race: one notification to compare', told.some((e) => /Race ready/.test(e.title)));
  out = [];
  const win = lanes.find((t) => t.agent === 'once');
  await tasks.onPhone({ t: 'race-pick', id: 'p', gid: res.id, lane: win.id }, send(out), (s) => s, () => {});
  ok('race: the winner\'s work is merged into the project', out[0].ok && fs.existsSync(path.join(rr, 'apple.txt')) && /Pocket Terminal/.test(sh(rr, 'log', '-1', '--format=%s')), JSON.stringify(out[0].error));
  ok('race: the other copies and branches are gone', !sh(rr, 'branch', '--list', 'pt/*') && sh(rr, 'worktree', 'list').split('\n').length === 1);
  ok('race: needs 2 agents and a git project', !!(await tasks.race({ prompt: 'x', cwd: rr, agents: ['fake'] })).error && !!(await tasks.race({ prompt: 'x', cwd: os.tmpdir(), agents: ['fake', 'once'] })).error);

  // hand-off: fake writes, once reviews, tests run
  const hh = repo('chain');
  const ch = await tasks.chain({ prompt: 'banana bread', cwd: hh, steps: [{ agent: 'fake' }, { agent: 'once' }], test: 'test -f banana.txt && test -f another.txt' });
  ok('chain: started', ch.ok, ch.error);
  const done = await until(() => { const x = tasks.view().groups.find((y) => y.id === ch.id); return x && ['done', 'failed'].includes(x.status) && x; }, 40000);
  const steps = tasks.view().tasks.filter((t) => t.group === ch.id);
  ok('chain: 3 steps ran one after the other and it finished', done && done.status === 'done' && steps.length === 3 && steps.every((t) => t.status === 'done'), JSON.stringify(steps.map((t) => [t.title, t.status, t.why])));
  ok('chain: the reviewer was told about the first agent', steps[1] && /another/i.test(fs.readFileSync(path.join(hh, 'another.txt'), 'utf8')));
  ok('chain: one notification at the end', told.filter((e) => /Hand-off done/.test(e.title)).length === 1);

  // cancel
  const q2 = repo('cancel');
  const t3 = await tasks.addTask({ cmd: 'sleep 30', cwd: q2 });
  await until(() => tasks.view().tasks.find((t) => t.id === t3.id && t.status === 'running'));
  const cc = await tasks.cancel(t3.id);
  ok('cancel: a running task stops and its terminal closes', cc.ok && tasks.view().tasks.find((t) => t.id === t3.id).status === 'cancelled' && !core.isSession(`local:L-t${t3.id}`));
  // own copy for a queue task, then throw it away
  const t4 = await tasks.addTask({ agent: 'once', prompt: 'cherry', cwd: q2, worktree: true });
  ok('queue in its own copy: started', t4.ok, t4.error);
  await until(() => tasks.view().tasks.find((t) => t.id === t4.id && t.status === 'done'), 20000);
  ok('queue in its own copy: the project is untouched', !fs.existsSync(path.join(q2, 'cherry.txt')));
  const dz = await tasks.wt(t4.id, 'merge');
  ok('queue in its own copy: bring it in', dz.ok && fs.existsSync(path.join(q2, 'cherry.txt')), JSON.stringify(dz));

  // a restart: tasks that ran are marked, not left "running" forever
  fs.writeFileSync(path.join(HOME, 'tasks.json'), JSON.stringify({ tasks: [{ id: 'zz', kind: 'queue', status: 'running', key: 'local:L-tzz', title: 'x' }], groups: [] }));
  const again = createTasks({ core, log: () => {}, dir: HOME, shell: '/bin/bash', alert: () => {} });
  ok('restart: a task that lost its terminal shows as failed', again.view().tasks[0].status === 'failed');
  again.stop();

  tasks.stop(); core.stop();
  console.log(fails ? `${fails} failed` : 'work: all passed');
  process.exit(fails ? 1 : 0);
})();
