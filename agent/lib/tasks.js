// Work you hand to your AI agents from the phone, run on this computer:
//
//   Task queue   "When this finishes, run the next one." One at a time, in order. Leave three
//                before bed, find them done in the morning.
//   Race         One task, several agents at once. Each works in its own copy of the project
//                (a git worktree on its own branch), so they don't get in each other's way. When
//                they're done: files changed, tests passed or not, how long each took. You pick
//                the winner; its work is merged into your project and the other copies go.
//   Hand-offs    A chain: one agent writes the code, the next reviews it, then tests run. Each
//                step starts when the one before is done. One notification at the end.
//
// Every task runs in a normal terminal (an L-… session, so every paired phone sees it in Agents
// and can open it, answer it, or type into it). The command is typed into a login shell in the
// task's folder, as if you typed it, followed by a marker that prints its exit code:
//     claude 'add a dark mode toggle'; echo "[pt:done:t1a2b3:$?]"
// A one-shot program (aider --message, opencode run, a test command) is done when the marker
// shows. An interactive agent (Claude Code, Codex…) stays open after it answers: it's done once it
// has worked and then sat idle (not asking anything) for a little while.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const G = require('./git');
const { plain } = require('./rules');

const IDLE_DONE = Number(process.env.POCKET_TASK_IDLE_MS) || 20e3;
const TEST_TIMEOUT = 10 * 60e3;
const KEEP = 40; // finished tasks remembered
const WIN = process.platform === 'win32';

// How to start each agent with a task. {q} is the task, quoted for the shell. Editable from the
// phone (Tasks → Agents), saved in tasks.json.
const DEFAULT_AGENTS = {
  claude: 'claude {q}',
  codex: 'codex {q}',
  gemini: 'gemini -i {q}',
  opencode: 'opencode run {q}',
  aider: 'aider --message {q}',
  cursor: 'cursor-agent {q}',
  qwen: 'qwen -i {q}',
};
const NAMES = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', opencode: 'OpenCode', aider: 'Aider', cursor: 'Cursor', qwen: 'Qwen Code' };
const nice = (a) => NAMES[a] || a;

function quote(text, shell) {
  const t = String(text).replace(/[\r\n]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '');
  if (/powershell|pwsh/i.test(shell)) return `'${t.replace(/'/g, "''")}'`;
  return `'${t.replace(/'/g, `'\\''`)}'`;
}
// The marker that tells us a command ended, and with which exit code.
function marker(id, shell) {
  if (/powershell|pwsh/i.test(shell)) return `; echo "[pt:done:${id}:$LASTEXITCODE]"`;
  if (/cmd(\.exe)?$/i.test(shell)) return ` & echo [pt:done:${id}:%ERRORLEVEL%]`;
  if (/fish$/.test(shell)) return `; echo "[pt:done:${id}:$status]"`;
  return `; echo "[pt:done:${id}:$?]"`;
}
const expand = (d) => { const s = String(d || '').trim(); if (!s || s === '~') return os.homedir(); return s.startsWith('~/') || s.startsWith('~\\') ? path.join(os.homedir(), s.slice(2)) : s; };
const tidy = (d) => { const h = os.homedir(); return d && d.startsWith(h) ? '~' + d.slice(h.length) : d; };
const newId = () => Math.random().toString(36).slice(2, 8);
const clean = (s, n) => String(s == null ? '' : s).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim().slice(0, n);

function createTasks({ core, log, dir, shell, alert }) {
  const FILE = dir ? path.join(dir, 'tasks.json') : null;
  let data = { agents: { ...DEFAULT_AGENTS }, tasks: [], groups: [] };
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); data = { agents: { ...DEFAULT_AGENTS, ...(d.agents || {}) }, tasks: d.tasks || [], groups: d.groups || [] }; } catch {}
  // A restart of this program: tasks that were running lost their terminal (unless it survived).
  // A restart of this program: tasks whose terminal the holder kept carry on; the others lost it.
  const kept = [];
  for (const t of data.tasks) {
    if (t.status !== 'running' && t.status !== 'blocked') continue;
    if (core.isSession(t.key)) kept.push(t); else { t.status = 'failed'; t.why = 'The computer\'s agent restarted while it ran.'; t.endedAt = Date.now(); }
  }
  let saveT; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { if (FILE) try { fs.writeFileSync(FILE, JSON.stringify(data, null, 1), { mode: 0o600 }); } catch {} }, 300); };
  const task = (id) => data.tasks.find((t) => t.id === id);
  const group = (id) => data.groups.find((g) => g.id === id);
  const live = new Map(); // task id -> { off: unsubscribe output, sawWork, idleSince }
  const tell = (title, body) => { try { alert({ key: 'local:L-tasks', kind: 'task', title, body }); } catch {} };

  function trimOld() {
    const done = (t) => ['done', 'failed', 'cancelled'].includes(t.status);
    const old = data.tasks.filter(done); if (old.length <= KEEP) return;
    const drop = new Set(old.sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0)).slice(0, old.length - KEEP).map((t) => t.id));
    data.tasks = data.tasks.filter((t) => !drop.has(t.id));
    data.groups = data.groups.filter((g) => data.tasks.some((t) => t.group === g.id));
  }

  function commandFor(t) {
    if (t.cmd) return t.cmd;
    const tpl = data.agents[t.agent] || `${t.agent} {q}`;
    return tpl.includes('{q}') ? tpl.replace('{q}', quote(t.prompt, shell)) : `${tpl} ${quote(t.prompt, shell)}`;
  }

  // Start one task in its own terminal.
  function launch(t) {
    if (!fs.existsSync(t.cwd)) { finish(t, 'failed', 'Its folder is gone.'); return; }
    t.key = `local:L-t${t.id}`; t.sid = `L-t${t.id}`;
    const io = core.startIn(t.key, { cmd: commandFor(t) + marker(t.id, shell), cwd: t.cwd, task: { id: t.id, kind: t.kind, title: t.title, group: t.group || null } });
    if (!io) { finish(t, 'failed', 'Could not open a terminal for it.'); return; }
    t.status = 'running'; t.startedAt = Date.now();
    follow(t, false);
    log(`task ${t.id} started (${t.kind}${t.agent ? ', ' + t.agent : ''})`);
    save();
  }
  // Watch a running task's terminal for its "done" marker. again: picked up after a restart.
  function follow(t, again) {
    const re = new RegExp(`\\[pt:done:${t.id}:(-?\\d+)\\]`);
    let buf = '';
    const off = core.onOutput(t.key, (pd) => {
      buf = (buf + pd).slice(-200); const m = re.exec(buf);
      if (m && (t.status === 'running' || t.status === 'blocked')) { buf = ''; t.exit = Number(m[1]); finish(t, t.exit === 0 ? 'done' : 'failed', t.exit === 0 ? null : `It ended with exit code ${t.exit}.`); }
    });
    live.set(t.id, { off, sawWork: again, idleSince: 0 }); // after a restart: assume it already worked
    if (again) { // it may have ended while this program was restarting: its marker is on the screen already
      const m = re.exec(plain(core.session(t.key).screen()).slice(-4000));
      if (m) { t.exit = Number(m[1]); setTimeout(() => finish(t, t.exit === 0 ? 'done' : 'failed', t.exit === 0 ? null : `It ended with exit code ${t.exit}.`), 0); }
    }
  }

  // Watch the running ones: asking you? working? done (idle after it worked)?
  function tick() {
    for (const t of data.tasks) {
      if (t.status !== 'running' && t.status !== 'blocked') continue;
      const i = core.info(t.key), L = live.get(t.id);
      if (!i || !i.running) { finish(t, 'failed', 'Its terminal was closed.'); continue; }
      if (!L) continue;
      if (i.state === 'blocked') { if (t.status !== 'blocked') { t.status = 'blocked'; save(); } L.idleSince = 0; continue; }
      if (t.status === 'blocked') { t.status = 'running'; save(); }
      if (i.state === 'working') { L.sawWork = true; L.idleSince = 0; continue; }
      if (!t.cmd && L.sawWork && i.program) { // an interactive agent: done once it worked and then sat idle
        if (!L.idleSince) L.idleSince = Date.now();
        else if (Date.now() - L.idleSince >= IDLE_DONE) finish(t, 'done', null);
      }
    }
  }
  const timer = setInterval(tick, 1000); timer.unref && timer.unref();

  async function changesOf(t) {
    const d = t.wt ? t.wt.dir : t.cwd;
    const base = t.wt ? t.wt.baseCommit : 'HEAD';
    const r = await G.git(d, ['diff', '--numstat', base], { timeout: 8000 });
    if (!r.ok) return null;
    let files = 0, add = 0, del = 0;
    for (const l of r.out.split('\n')) { const m = l.match(/^(\d+|-)\t(\d+|-)\t/); if (m) { files++; add += +m[1] || 0; del += +m[2] || 0; } }
    const u = await G.git(d, ['ls-files', '--others', '--exclude-standard'], { timeout: 5000 });
    return { files: files + (u.ok ? u.out.split('\n').filter(Boolean).length : 0), add, del };
  }

  async function finish(t, status, why) {
    if (['done', 'failed', 'cancelled'].includes(t.status)) return;
    const L = live.get(t.id); if (L) { L.off(); live.delete(t.id); }
    t.status = status; t.why = why || null; t.endedAt = Date.now();
    t.seconds = t.startedAt ? Math.round((t.endedAt - t.startedAt) / 1000) : 0;
    const i = core.info(t.key); t.last = i ? i.last.filter((l) => !/\[pt:done:/.test(l)).slice(-3) : [];
    log(`task ${t.id} ${status}`);
    try { t.changes = await changesOf(t); } catch {}
    save();
    const g = t.group && group(t.group);
    if (t.kind === 'queue') nextInQueue(t);
    else if (g && g.kind === 'race') raceStep(g);
    else if (g && g.kind === 'chain') chainStep(g, t);
  }

  // ---------- the queue ----------
  function nextInQueue(after) {
    const q = data.tasks.filter((t) => t.kind === 'queue');
    if (q.some((t) => t.status === 'running' || t.status === 'blocked')) return;
    const next = q.find((t) => t.status === 'waiting');
    if (next) { launch(next); return; }
    if (after) { // the last one just finished: one notification for the lot
      const batch = q.filter((t) => t.endedAt && t.endedAt >= (after.batchAt || 0));
      const bad = batch.filter((t) => t.status === 'failed').length;
      tell(bad ? `Task queue done · ${bad} failed` : 'Task queue done ✓', batch.slice(-4).map((t) => `${t.status === 'done' ? '✓' : '✗'} ${t.title}`).join('\n'));
    }
  }

  async function addTask({ agent, prompt, cmd, cwd, worktree }) {
    const dirp = expand(cwd);
    try { if (!fs.statSync(dirp).isDirectory()) throw 0; } catch { return { error: `No folder ${cwd || ''} on this computer.` }; }
    prompt = clean(prompt, 2000); cmd = clean(cmd, 2000);
    if (!cmd && !(agent && prompt)) return { error: 'Pick an agent and write the task, or type a command.' };
    if (agent && !/^[\w-]{1,30}$/.test(agent)) return { error: 'Unknown agent.' };
    const t = { id: newId(), kind: 'queue', agent: cmd ? null : agent, prompt: cmd ? null : prompt, cmd: cmd || null, cwd: dirp, where: tidy(dirp), title: cmd ? cmd.slice(0, 60) : `${nice(agent)}: ${prompt.slice(0, 50)}`, status: 'waiting', addedAt: Date.now() };
    const busy = data.tasks.some((x) => x.kind === 'queue' && ['waiting', 'running', 'blocked'].includes(x.status));
    t.batchAt = busy ? (data.tasks.filter((x) => x.kind === 'queue' && x.batchAt).slice(-1)[0] || {}).batchAt || Date.now() : Date.now();
    if (worktree) {
      const w = await G.worktreeAdd(dirp, `${agent || 'cmd'}-${t.id}`);
      if (w.error) return w;
      t.wt = { dir: w.dir, branch: w.branch, root: w.root, base: w.base, baseCommit: w.baseCommit }; t.cwd = w.dir; t.where = tidy(w.dir);
    }
    data.tasks.push(t); trimOld(); save();
    nextInQueue(null);
    return { ok: true, id: t.id };
  }

  // ---------- race ----------
  async function race({ prompt, cwd, agents, test }) {
    prompt = clean(prompt, 2000); test = clean(test, 300);
    agents = [...new Set((Array.isArray(agents) ? agents : []).filter((a) => /^[\w-]{1,30}$/.test(a)))].slice(0, 4);
    if (!prompt) return { error: 'Write the task first.' };
    if (agents.length < 2) return { error: 'Pick at least 2 agents to race.' };
    const dirp = expand(cwd);
    const info = await G.gitInfo(dirp);
    if (!info) return { error: 'A race needs a git project (each agent gets its own copy of it). That folder isn\'t one.' };
    const g = { id: newId(), kind: 'race', prompt, cwd: info.root, where: tidy(info.root), test: test || null, status: 'running', startedAt: Date.now(), lanes: [] };
    for (const a of agents) {
      const id = newId();
      const w = await G.worktreeAdd(info.root, `${a}-${g.id}`);
      if (w.error) { await cleanup(g); return { error: w.error }; }
      const t = { id, kind: 'race', group: g.id, agent: a, prompt, cwd: w.dir, where: tidy(w.dir), title: nice(a), status: 'waiting', addedAt: Date.now(), wt: { dir: w.dir, branch: w.branch, root: w.root, base: w.base, baseCommit: w.baseCommit } };
      data.tasks.push(t); g.lanes.push(id);
    }
    data.groups.push(g); save();
    for (const id of g.lanes) launch(task(id));
    log(`race ${g.id} started with ${agents.join(', ')}`);
    return { ok: true, id: g.id };
  }

  async function raceStep(g) {
    if (g.status !== 'running') return;
    const lanes = g.lanes.map(task).filter(Boolean);
    if (lanes.some((t) => t.status === 'running' || t.status === 'blocked' || t.status === 'waiting')) { save(); return; }
    await runTests(g);
  }
  async function runTests(g) {
    const lanes = g.lanes.map(task).filter(Boolean);
    g.status = 'testing'; save();
    for (const t of lanes) {
      t.changes = await changesOf(t).catch(() => t.changes);
      if (g.test && t.status !== 'cancelled') t.tests = await testIn(t.wt.dir, g.test); else t.tests = null;
      save();
    }
    g.status = 'compare'; g.readyAt = Date.now(); save();
    const best = lanes.filter((t) => t.status === 'done' && (!t.tests || t.tests.ok));
    tell('Race ready to compare', lanes.map((t) => `${t.title}: ${t.status === 'done' ? `${t.changes ? t.changes.files : 0} files` : t.status}${t.tests ? (t.tests.ok ? ' · tests pass' : ' · tests fail') : ''} · ${dur(t.seconds)}`).join('\n') + (best.length ? '' : '\nNone passed.'));
  }
  function testIn(dirp, cmd) {
    return new Promise((res) => {
      const args = WIN ? (/cmd(\.exe)?$/i.test(shell) ? ['/d', '/s', '/c', cmd] : ['-NoProfile', '-Command', cmd]) : ['-lc', cmd];
      let out = ''; const t0 = Date.now();
      let p; try { p = spawn(shell, args, { cwd: dirp, env: { ...process.env, CI: '1' }, windowsHide: true }); } catch (e) { return res({ ok: false, code: -1, last: [String(e.message)], seconds: 0 }); }
      const add = (d) => { out = (out + d).slice(-8000); };
      p.stdout.on('data', add); p.stderr.on('data', add);
      const timer = setTimeout(() => { add('\n[stopped after 10 minutes]'); try { p.kill('SIGKILL'); } catch {} }, TEST_TIMEOUT);
      p.on('close', (code) => { clearTimeout(timer); res({ ok: code === 0, code, last: out.split('\n').map((l) => l.trim()).filter(Boolean).slice(-3).map((l) => l.slice(0, 100)), seconds: Math.round((Date.now() - t0) / 1000) }); });
      p.on('error', (e) => { clearTimeout(timer); res({ ok: false, code: -1, last: [String(e.message)], seconds: 0 }); });
    });
  }

  // Keep one copy's work: commit it in its worktree, merge its branch into the project.
  async function keep(t, message) {
    if (!t.wt) return { error: 'It didn\'t run in its own copy.' };
    const s = await G.worktreeSave(t.wt.dir, message);
    if (s.error) return s;
    const m = await G.worktreeMerge(t.wt.root, t.wt.branch, `Pocket Terminal: ${message}`);
    if (m.error) return m;
    return { ok: true };
  }
  async function dropCopy(t) {
    if (t.key && core.isSession(t.key)) core.close(t.key);
    if (t.wt && !t.wt.removed) { await G.worktreeRemove(t.wt.root, t.wt.dir, t.wt.branch); t.wt.removed = true; }
  }
  async function cleanup(g) { for (const id of g.lanes || []) { const t = task(id); if (t) { if (!['done', 'failed'].includes(t.status)) { t.status = 'cancelled'; t.endedAt = Date.now(); } await dropCopy(t); } } }

  async function pick(gid, laneId) {
    const g = group(gid); if (!g || g.kind !== 'race') return { error: 'That race is gone.' };
    if (g.status === 'picked') return { error: 'A winner was already picked.' };
    const t = task(laneId); if (!t || t.group !== g.id) return { error: 'Not one of its agents.' };
    if (t.status === 'running' || t.status === 'blocked') return { error: 'It is still working. Wait for it, or stop it first.' };
    const r = await keep(t, `${g.prompt.slice(0, 60)} (${t.title})`);
    if (r.error) return r;
    g.status = 'picked'; g.winner = t.id; g.endedAt = Date.now();
    await cleanup(g); save();
    log(`race ${g.id}: kept ${t.agent}`);
    return { ok: true };
  }

  // ---------- hand-off chains ----------
  const REVIEW = (task, prev) => `Another AI agent (${prev}) just worked on this task in this folder: "${task}". Review its changes (see git diff and new files), fix any bugs or missing parts you find, and keep the changes small.`;
  async function chain({ prompt, cwd, steps, test }) {
    prompt = clean(prompt, 2000); test = clean(test, 300);
    const dirp = expand(cwd);
    try { if (!fs.statSync(dirp).isDirectory()) throw 0; } catch { return { error: `No folder ${cwd || ''} on this computer.` }; }
    steps = (Array.isArray(steps) ? steps : []).map((s) => ({ agent: /^[\w-]{1,30}$/.test(s && s.agent) ? s.agent : null, ask: clean(s && s.ask, 1000) || null })).filter((s) => s.agent).slice(0, 4);
    if (!prompt) return { error: 'Write the task first.' };
    if (!steps.length) return { error: 'Add at least one agent.' };
    if (test) steps.push({ cmd: test });
    const g = { id: newId(), kind: 'chain', prompt, cwd: dirp, where: tidy(dirp), status: 'running', startedAt: Date.now(), steps, at: 0, lanes: [] };
    data.groups.push(g);
    startStep(g, null); save();
    return { ok: true, id: g.id };
  }
  function startStep(g, prev) {
    const s = g.steps[g.at];
    const t = { id: newId(), kind: 'chain', group: g.id, step: g.at, cwd: g.cwd, where: g.where, status: 'waiting', addedAt: Date.now() };
    if (s.cmd) Object.assign(t, { cmd: s.cmd, title: `Tests: ${s.cmd.slice(0, 40)}` });
    else Object.assign(t, { agent: s.agent, title: `${g.at + 1}. ${nice(s.agent)}`, prompt: s.ask ? `${s.ask}\n\nThe task: ${g.prompt}` : g.at === 0 ? g.prompt : REVIEW(g.prompt, prev ? nice(prev.agent) : 'the previous agent') });
    data.tasks.push(t); g.lanes.push(t.id);
    launch(t);
  }
  function chainStep(g, t) {
    if (g.status !== 'running') return;
    if (t.status !== 'done') {
      g.status = 'failed'; g.endedAt = Date.now(); save();
      tell(`Hand-off stopped at ${t.title}`, t.why || 'A step did not finish.');
      return;
    }
    if (g.at + 1 < g.steps.length) { g.at++; startStep(g, t); save(); return; }
    g.status = 'done'; g.endedAt = Date.now(); save();
    const lanes = g.lanes.map(task).filter(Boolean);
    tell('Hand-off done ✓', `${g.prompt.slice(0, 80)}\n${lanes.map((x) => `✓ ${x.title}`).join('\n')}${t.changes ? `\n${t.changes.files} files changed (+${t.changes.add} −${t.changes.del})` : ''}`);
  }

  // ---------- stop ----------
  async function cancel(id) {
    const g = group(id);
    if (g) {
      if (['picked', 'done', 'failed', 'cancelled'].includes(g.status)) return { error: 'It already ended.' };
      g.status = 'cancelled'; g.endedAt = Date.now();
      for (const lid of g.lanes) { const t = task(lid); if (t && !['done', 'failed', 'cancelled'].includes(t.status)) { const L = live.get(t.id); if (L) { L.off(); live.delete(t.id); } t.status = 'cancelled'; t.endedAt = Date.now(); if (t.key) core.close(t.key); } }
      if (g.kind === 'race') await cleanup(g);
      save(); return { ok: true };
    }
    const t = task(id); if (!t) return { error: 'That task is gone.' };
    if (['done', 'failed', 'cancelled'].includes(t.status)) return { error: 'It already ended.' };
    const L = live.get(t.id); if (L) { L.off(); live.delete(t.id); }
    t.status = 'cancelled'; t.endedAt = Date.now(); if (t.key) core.close(t.key);
    save(); if (t.kind === 'queue') nextInQueue(null);
    return { ok: true };
  }
  // A queue task that ran in its own copy: bring its work in, or throw it away.
  async function wt(id, how) {
    const t = task(id); if (!t || !t.wt || t.wt.removed) return { error: 'Nothing to bring in.' };
    if (t.status === 'running' || t.status === 'blocked' || t.status === 'waiting') return { error: 'It is still working.' };
    if (how === 'merge') { const r = await keep(t, (t.prompt || t.cmd || 'task').slice(0, 60)); if (r.error) return r; t.merged = true; }
    await dropCopy(t); save(); return { ok: true };
  }
  function clear() {
    const ended = (x) => ['done', 'failed', 'cancelled'].includes(x.status) && (!x.wt || x.wt.removed);
    const groupsLive = new Set(data.groups.filter((g) => ['running', 'testing', 'compare'].includes(g.status)).map((g) => g.id));
    data.tasks = data.tasks.filter((t) => !ended(t) || (t.group && groupsLive.has(t.group)));
    data.groups = data.groups.filter((g) => groupsLive.has(g.id));
    save(); return { ok: true };
  }

  const view = () => ({
    agents: data.agents, names: NAMES,
    tasks: data.tasks.map((t) => ({ id: t.id, kind: t.kind, group: t.group || null, agent: t.agent, title: t.title, where: t.where, status: t.status, why: t.why, sid: t.sid || null,
      addedAt: t.addedAt, startedAt: t.startedAt || null, endedAt: t.endedAt || null, seconds: t.seconds || (t.startedAt && !t.endedAt ? Math.round((Date.now() - t.startedAt) / 1000) : 0),
      changes: t.changes || null, tests: t.tests || null, last: t.last || [], wt: t.wt ? { branch: t.wt.branch, removed: !!t.wt.removed } : null, merged: !!t.merged, step: t.step })),
    groups: data.groups.map((g) => ({ id: g.id, kind: g.kind, prompt: g.prompt, where: g.where, status: g.status, test: g.test || null, lanes: g.lanes, winner: g.winner || null, at: g.at, steps: g.steps ? g.steps.length : null, startedAt: g.startedAt })),
  });

  async function onPhone(m, send, keyFor, act) {
    const reply = (r) => { const { id: made, ...rest } = r || {}; send({ t: 'tasks', ...rest, ...view(), ...(made ? { made } : {}), id: m.id }); }; // id: the phone's request
    try {
      switch (m.t) {
        case 'tasks': return reply();
        case 'task-add': act({ ev: 'task' }); return reply(await addTask(m));
        case 'race': act({ ev: 'race', agents: (m.agents || []).length }); return reply(await race(m));
        case 'race-pick': act({ ev: 'race-pick' }); return reply(await pick(String(m.gid), String(m.lane)));
        case 'race-test': { const g = group(String(m.gid)); if (!g || g.status !== 'compare') return reply({ error: 'Nothing to test.' }); reply({ ok: true }); return runTests(g); }
        case 'chain': act({ ev: 'chain', steps: (m.steps || []).length }); return reply(await chain(m));
        case 'task-cancel': return reply(await cancel(String(m.tid)));
        case 'task-clear': return reply(clear());
        case 'wt-merge': return reply(await wt(String(m.tid), 'merge'));
        case 'wt-discard': return reply(await wt(String(m.tid), 'discard'));
        case 'task-cfg': {
          const a = m.agents && typeof m.agents === 'object' ? m.agents : {};
          const next = {};
          for (const [k, v] of Object.entries(a).slice(0, 20)) if (/^[\w-]{1,30}$/.test(k) && typeof v === 'string' && v.trim()) next[k] = clean(v, 200);
          data.agents = Object.keys(next).length ? next : { ...DEFAULT_AGENTS }; save();
          return reply({ ok: true });
        }
      }
    } catch (e) { log('tasks: ' + e.message); reply({ error: 'Something went wrong on the computer.' }); }
  }

  for (const t of kept) follow(t, true);
  // At start: the queue carries on where it was.
  setTimeout(() => nextInQueue(null), 2000);
  return { onPhone, view, stop: () => clearInterval(timer), addTask, race, chain, pick, cancel, wt, tick, _data: () => data };
}

const dur = (s) => (!s ? '–' : s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

module.exports = { createTasks, DEFAULT_AGENTS, quote, marker };
