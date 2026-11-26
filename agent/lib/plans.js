// Work that starts by itself, on top of lib/tasks.js:
//
//   Schedules        "Every night at 2:00, run the tests and fix what fails." A task, a race or a
//                    hand-off, at a time of day, every day or on chosen weekdays. Each run is
//                    written to the schedule's own log (shown on the phone) and to
//                    ~/.pocket-terminal/schedule.log.
//   Morning summary  One notification at a time you choose: what your agents did since the last
//                    one (done, failed, files changed, cost) and what waits for you.
//   Recipes          A saved way of working ("Codex writes, Claude reviews, tests run") as one
//                    button. The phone fills its form from it; a recipe can be shared as a link.
//   GitHub issues    Put a label (default "pocket") on an issue in your project: a race (or one
//                    agent) starts on it. Uses GitHub's own "gh" tool on this computer, with your
//                    login there. Only issues YOU wrote are picked up: an issue's text becomes an
//                    agent's task, and anyone can write an issue on a public project.
//
// The computer must be on. Asleep with the lid closed is fine: it wakes for its check-ins, and a
// run that was due less than 6 hours ago starts then. Older than that: logged as missed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const G = require('./git');

const LATE = 6 * 3600e3;      // a run that was due up to this long ago still starts
const GH_EVERY = Number(process.env.POCKET_GH_MS) || 5 * 60e3;
const LOG_KEEP = 20;
const clean = (s, n) => String(s == null ? '' : s).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim().slice(0, n);
const newId = () => Math.random().toString(36).slice(2, 8);
const okAgent = (a) => typeof a === 'string' && /^[\w-]{1,30}$/.test(a);
const okTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = (d, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const dur = (s) => (!s ? '' : s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
const money = (c) => (c && c.usd != null ? ` · about $${c.usd < 0.01 ? c.usd.toFixed(4) : c.usd.toFixed(2)}` : c && c.tokens ? ` · ${c.tokens >= 1e6 ? (c.tokens / 1e6).toFixed(1) + 'M' : Math.round(c.tokens / 1000) + 'k'} tokens` : '');

// What to start: one task (an agent or a command), a race, or a hand-off. needWork: must be
// complete enough to start by itself (a schedule); a recipe may leave the task and folder open.
function cleanWhat(w, needWork) {
  if (!w || typeof w !== 'object') return { error: 'Nothing to run.' };
  const kind = ['task', 'race', 'chain'].includes(w.kind) ? w.kind : 'task';
  const out = { kind, cwd: clean(w.cwd, 300), prompt: clean(w.prompt, 2000), test: clean(w.test, 300) };
  if (kind === 'task') {
    out.cmd = clean(w.cmd, 2000); out.agent = okAgent(w.agent) ? w.agent : null; out.worktree = !!w.worktree;
    if (out.cmd) { out.agent = null; out.prompt = ''; }
    if (!out.cmd && !out.agent) return { error: 'Pick an agent, or type a command.' };
    if (needWork && !out.cmd && !out.prompt) return { error: 'Write the task.' };
    delete out.test;
  } else if (kind === 'race') {
    out.agents = [...new Set((Array.isArray(w.agents) ? w.agents : []).filter(okAgent))].slice(0, 4);
    if (out.agents.length < 2) return { error: 'Pick at least 2 agents to race.' };
    if (needWork && !out.prompt) return { error: 'Write the task.' };
  } else {
    out.steps = (Array.isArray(w.steps) ? w.steps : []).filter((s) => s && okAgent(s.agent)).slice(0, 4).map((s) => ({ agent: s.agent, ...(clean(s.ask, 1000) ? { ask: clean(s.ask, 1000) } : {}) }));
    if (!out.steps.length) return { error: 'Add at least one agent.' };
    if (needWork && !out.prompt) return { error: 'Write the task.' };
  }
  if (needWork && !out.cwd) return { error: 'Which folder? (the project)' };
  return { what: out };
}
const label = (w, nice) => (w.kind === 'race' ? `Race: ${w.agents.map(nice).join(' vs ')}` : w.kind === 'chain' ? `Hand-off: ${w.steps.map((s) => nice(s.agent)).join(' → ')}` : w.cmd ? `Command: ${w.cmd.slice(0, 40)}` : nice(w.agent));

function createPlans({ tasks, log, dir, tell, now = () => new Date(), gh = process.env.POCKET_GH || 'gh' }) {
  const FILE = dir ? path.join(dir, 'plans.json') : null;
  const LOGFILE = dir ? path.join(dir, 'schedule.log') : null;
  let data = { schedules: [], recipes: [], github: [], morning: { on: false, at: '08:00', lastDay: '', lastAt: 0 }, seen: {} };
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); data = { ...data, ...d, morning: { ...data.morning, ...(d.morning || {}) } }; } catch {}
  let saveT; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { if (FILE) try { fs.writeFileSync(FILE, JSON.stringify(data, null, 1), { mode: 0o600 }); } catch {} }, 300); };
  const nice = (a) => (tasks.names && tasks.names[a]) || a;

  function start(what, from) {
    if (what.kind === 'race') return tasks.race({ ...what, from });
    if (what.kind === 'chain') return tasks.chain({ ...what, from });
    return tasks.addTask({ ...what, from });
  }

  // ---------- schedules ----------
  function note(s, status, text) {
    const line = { at: now().getTime(), status, text: clean(text, 300) };
    s.log = [...(s.log || []), line].slice(-LOG_KEEP); save();
    if (LOGFILE) { try { fs.appendFileSync(LOGFILE, `${new Date(line.at).toISOString()}  ${s.name}  ${status}${line.text ? '  ' + line.text.replace(/\n/g, ' | ') : ''}\n`, { mode: 0o600 }); } catch {} }
  }
  async function runSchedule(s, why) {
    let r; try { r = await start(s.what, { sched: s.id }); } catch (e) { r = { error: e.message }; }
    if (r && r.error) { note(s, 'could not start', r.error); tell(`Schedule "${s.name}" could not start`, r.error); }
    else { note(s, 'started', why || ''); log(`schedule ${s.id} started`); }
    return r;
  }
  // What a finished run looks like in the log: one or two plain lines.
  function summary(ev) {
    const lane = (t) => `${t.title}: ${t.status}${t.why ? ` (${t.why})` : ''}${t.changes && t.changes.files ? `, ${t.changes.files} file${t.changes.files === 1 ? '' : 's'} changed (+${t.changes.add} −${t.changes.del})` : ''}${t.tests ? (t.tests.ok ? ', tests pass' : ', tests fail') : ''}${t.seconds ? `, ${dur(t.seconds)}` : ''}${money(t.cost)}`;
    if (ev.kind === 'queue') { const t = ev.task; return { status: t.status, text: `${lane(t)}${t.last && t.last.length ? `\n${t.last.slice(-1)[0]}` : ''}` }; }
    const lanes = ev.lanes || [];
    if (ev.kind === 'race') return { status: 'ready to compare', text: lanes.map(lane).join('\n') };
    return { status: ev.group.status === 'done' ? 'done' : 'stopped', text: lanes.map(lane).join('\n') };
  }
  tasks.onEnd((ev) => {
    const id = ev.from && ev.from.sched; if (!id) return;
    const s = data.schedules.find((x) => x.id === id); if (!s) return;
    const r = summary(ev); note(s, r.status, r.text);
  });

  function saveSchedule(m) {
    const c = cleanWhat(m.what, true); if (c.error) return c;
    if (!okTime(m.at)) return { error: 'Pick a time.' };
    const days = [...new Set((Array.isArray(m.days) ? m.days : []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
    const name = clean(m.name, 60) || clean(c.what.prompt || c.what.cmd, 40) || 'Schedule';
    let s = m.pid && data.schedules.find((x) => x.id === String(m.pid));
    if (!s) { if (data.schedules.length >= 20) return { error: 'Up to 20 schedules. Remove one first.' }; s = { id: newId(), log: [] }; data.schedules.push(s); }
    Object.assign(s, { name, at: m.at, days, what: c.what, on: m.on !== false });
    // Its time today already passed: the first run is the next one, not "missed".
    const n = now(); s.last = n >= at(n, s.at) ? day(n) : '';
    save(); return { ok: true, sid: s.id };
  }

  // ---------- the morning summary ----------
  function morningText(since) {
    const d = tasks._data(); const done = [], bad = [], wait = [];
    const one = (t) => `${t.title}${t.changes && t.changes.files ? ` · ${t.changes.files} file${t.changes.files === 1 ? '' : 's'}` : ''}${money(t.cost)}`;
    for (const t of d.tasks) {
      if (t.status === 'blocked') wait.push(`${t.title} asks you something`);
      if (!t.endedAt || t.endedAt < since || t.group) continue;
      if (t.status === 'done') done.push(one(t)); else if (t.status === 'failed') bad.push(`${t.title}${t.why ? ` (${t.why})` : ''}`);
    }
    for (const g of d.groups) {
      const lanes = g.lanes.map((id) => d.tasks.find((t) => t.id === id)).filter(Boolean);
      const what = `${g.kind === 'race' ? 'Race' : 'Hand-off'}: ${g.prompt.slice(0, 40)}`;
      if (g.status === 'compare') { wait.push(`${what} · pick the winner`); continue; }
      if (!g.endedAt || g.endedAt < since) continue;
      const cost = lanes.reduce((a, t) => (t.cost && t.cost.usd != null ? a + t.cost.usd : a), 0);
      if (g.status === 'done') done.push(`${what}${cost ? ` · about $${cost.toFixed(2)}` : ''}`); else if (g.status === 'failed') bad.push(`${what} stopped`);
    }
    if (!done.length && !bad.length && !wait.length) return null;
    const parts = [done.length ? `${done.length} done` : '', bad.length ? `${bad.length} failed` : '', wait.length ? `${wait.length} wait${wait.length === 1 ? 's' : ''} for you` : ''].filter(Boolean);
    const body = [...wait.map((x) => `→ ${x}`), ...bad.map((x) => `✗ ${x}`), ...done.map((x) => `✓ ${x}`)];
    return { title: `Your agents: ${parts.join(', ')}`, body: body.slice(0, 6).join('\n') + (body.length > 6 ? `\n+ ${body.length - 6} more` : '') };
  }
  function morning(force) {
    const n = now(), m = data.morning;
    const t = morningText(force ? n.getTime() - 24 * 3600e3 : Math.max(m.lastAt || 0, n.getTime() - 24 * 3600e3));
    if (!force) { m.lastDay = day(n); m.lastAt = n.getTime(); save(); }
    if (t) tell(t.title, t.body); else if (force) tell('Nothing to report', 'No task finished in the last day and nothing waits for you.');
    return t;
  }

  // ---------- GitHub issues ----------
  const run = (args, cwd) => new Promise((res) => {
    execFile(gh, args, { cwd, timeout: 25e3, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }, windowsHide: true }, (e, out, err) => {
      if (e && e.code === 'ENOENT') return res({ error: 'GitHub\'s "gh" tool is not on this computer. Install it (cli.github.com), then run: gh auth login' });
      if (e) return res({ error: /auth|logged|login/i.test(String(err)) ? 'gh is not signed in. On the computer run: gh auth login' : (String(err).split('\n').find((l) => l.trim()) || 'gh could not read the issues.').slice(0, 160) });
      res({ out: String(out) });
    });
  });
  async function checkOne(w) {
    w.checkedAt = now().getTime();
    const busy = () => { const d = tasks._data(); return d.groups.some((g) => g.from && g.from.gh === w.id && ['running', 'testing', 'compare'].includes(g.status)) || d.tasks.some((t) => t.from && t.from.gh === w.id && !t.group && (['waiting', 'running', 'blocked'].includes(t.status) || (t.wt && !t.wt.removed))); };
    if (busy()) { w.note = 'Working on an issue. The next one starts after you keep or drop this one.'; return; }
    const r = await run(['issue', 'list', '--label', w.label, '--state', 'open', '--author', '@me', '--json', 'number,title,body', '--limit', '10'], w.cwd);
    if (r.error) { w.note = r.error; return; }
    let list; try { list = JSON.parse(r.out); } catch { w.note = 'gh gave an answer that could not be read.'; return; }
    const next = list.sort((a, b) => a.number - b.number).find((i) => !data.seen[`${w.id}#${i.number}`]);
    if (!next) { w.note = list.length ? 'Every labelled issue was already started.' : `No open issue of yours has the label "${w.label}".`; return; }
    const prompt = clean(`Fix GitHub issue #${next.number}: ${next.title}\n\n${String(next.body || '').slice(0, 1500)}`, 2000);
    const from = { gh: w.id, issue: next.number };
    const s = w.agents.length >= 2 ? await tasks.race({ prompt, cwd: w.cwd, agents: w.agents, test: w.test, from }) : await tasks.addTask({ agent: w.agents[0], prompt, cwd: w.cwd, worktree: true, from });
    if (s.error) { w.note = s.error; return; }
    data.seen[`${w.id}#${next.number}`] = now().getTime();
    w.note = `Started on #${next.number}: ${clean(next.title, 60)}`;
    log(`github: started on issue #${next.number}`);
    tell(`Started on issue #${next.number}`, `${clean(next.title, 80)}\n${w.agents.map(nice).join(' vs ')} · ${w.where}`);
  }
  let ghBusy = false;
  async function checkGithub(only) {
    if (ghBusy) return; ghBusy = true;
    try { for (const w of data.github) if (w.on && (!only || w.id === only)) { try { await checkOne(w); } catch (e) { w.note = 'Something went wrong while checking.'; log('github: ' + e.message); } } } finally { ghBusy = false; save(); }
  }
  async function saveGithub(m) {
    const cwd = clean(m.cwd, 300); if (!cwd) return { error: 'Which folder? (the project)' };
    const full = cwd === '~' ? os.homedir() : cwd.startsWith('~/') ? path.join(os.homedir(), cwd.slice(2)) : cwd;
    const info = await G.gitInfo(full); if (!info) return { error: 'That folder is not a git project.' };
    const agents = [...new Set((Array.isArray(m.agents) ? m.agents : []).filter(okAgent))].slice(0, 4);
    if (!agents.length) return { error: 'Pick at least one agent.' };
    const lbl = clean(m.label, 40).replace(/[^\w .:-]/g, '') || 'pocket';
    let w = m.gid && data.github.find((x) => x.id === String(m.gid));
    if (!w) { if (data.github.length >= 10) return { error: 'Up to 10 projects.' }; w = { id: newId() }; data.github.push(w); }
    const home = os.homedir();
    Object.assign(w, { cwd: info.root, where: info.root.startsWith(home) ? '~' + info.root.slice(home.length) : info.root, label: lbl, agents, test: clean(m.test, 300) || null, on: m.on !== false, note: w.note || '' });
    save(); return { ok: true, gid: w.id };
  }

  // ---------- the clock ----------
  let lastGh = 0;
  function tick() {
    const n = now(), today = day(n);
    for (const s of data.schedules) {
      if (!s.on || s.last === today) continue;
      if (s.days && s.days.length && !s.days.includes(n.getDay())) continue;
      const due = at(n, s.at); if (n < due) continue;
      s.last = today; save();
      if (n - due > LATE) note(s, 'missed', 'The computer was off or asleep at that time.');
      else runSchedule(s, n - due > 5 * 60e3 ? `late: the computer was asleep at ${s.at}` : '');
    }
    const m = data.morning;
    if (m.on && okTime(m.at) && m.lastDay !== today && n >= at(n, m.at)) { if (n - at(n, m.at) > LATE) { m.lastDay = today; save(); } else morning(false); }
    if (data.github.some((w) => w.on) && Date.now() - lastGh >= GH_EVERY) { lastGh = Date.now(); checkGithub(); }
  }
  const timer = setInterval(tick, Number(process.env.POCKET_PLAN_TICK_MS) || 30e3); timer.unref && timer.unref();

  const view = () => ({
    schedules: data.schedules.map((s) => ({ id: s.id, name: s.name, at: s.at, days: s.days || [], on: !!s.on, what: s.what, label: label(s.what, nice), log: (s.log || []).slice(-8) })),
    recipes: data.recipes.map((r) => ({ id: r.id, name: r.name, what: r.what, label: label(r.what, nice) })),
    github: data.github.map((w) => ({ id: w.id, where: w.where, label: w.label, agents: w.agents, test: w.test, on: !!w.on, note: w.note || '', checkedAt: w.checkedAt || null })),
    morning: { on: !!data.morning.on, at: data.morning.at },
  });

  async function onPhone(m, send, act) {
    const reply = (r) => send({ t: 'plans', ...(r || {}), ...view(), id: m.id });
    try {
      switch (m.t) {
        case 'plans': return reply();
        case 'sched-save': act({ ev: 'schedule' }); return reply(saveSchedule(m));
        case 'sched-del': data.schedules = data.schedules.filter((s) => s.id !== String(m.pid)); save(); return reply({ ok: true });
        case 'sched-run': { const s = data.schedules.find((x) => x.id === String(m.pid)); if (!s) return reply({ error: 'That schedule is gone.' }); const r = await runSchedule(s, 'started by hand'); return reply(r && r.error ? r : { ok: true }); }
        case 'recipe-save': {
          const c = cleanWhat(m.what, false); if (c.error) return reply(c);
          const name = clean(m.name, 60); if (!name) return reply({ error: 'Give it a name.' });
          delete c.what.cwd; // a recipe is a way of working, not a place: the folder is chosen when you use it
          data.recipes = data.recipes.filter((r) => r.name !== name);
          if (data.recipes.length >= 30) return reply({ error: 'Up to 30 recipes. Remove one first.' });
          data.recipes.push({ id: newId(), name, what: c.what }); save(); return reply({ ok: true });
        }
        case 'recipe-del': data.recipes = data.recipes.filter((r) => r.id !== String(m.rid)); save(); return reply({ ok: true });
        case 'gh-save': act({ ev: 'github' }); { const r = await saveGithub(m); if (r.ok) checkGithub(r.gid).then(() => send({ t: 'plans', ...view() })); return reply(r); }
        case 'gh-del': data.github = data.github.filter((w) => w.id !== String(m.gid)); save(); return reply({ ok: true });
        case 'gh-check': await checkGithub(m.gid ? String(m.gid) : null); return reply({ ok: true });
        case 'morning-set': data.morning.on = !!m.on; if (okTime(m.at)) data.morning.at = m.at; { const n = now(); data.morning.lastDay = n >= at(n, data.morning.at) ? day(n) : ''; data.morning.lastAt = n.getTime(); } save(); return reply({ ok: true });
        case 'morning-now': return reply({ ok: true, sent: !!morning(true) });
      }
    } catch (e) { log('plans: ' + e.message); reply({ error: 'Something went wrong on the computer.' }); }
  }

  return { onPhone, view, tick, stop: () => clearInterval(timer), saveSchedule, morningText, checkGithub, saveGithub, _data: () => data };
}

module.exports = { createPlans, cleanWhat };
