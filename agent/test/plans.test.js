// Work that starts by itself and the tools around it, on a real terminal:
//   the cost meter (reads pretend Claude Code / Codex / Gemini logs), schedules with their log,
//   the morning summary, recipes, GitHub issues (a pretend "gh"), and the MCP server
//   ("npx pocket-terminal mcp": ask the phone, send a note, look at terminals, start a task).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');

if (process.platform === 'win32') { console.log('- plans.test: skipped on Windows (uses bash)'); process.exit(0); }
process.env.POCKET_SHELL = '/bin/bash';
process.env.POCKET_WORK_QUIET_MS = '900';
process.env.POCKET_TASK_IDLE_MS = '1200';
process.env.POCKET_PLAN_TICK_MS = '3600000'; // the test moves the clock itself
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-plans-'));
process.env.POCKET_HOME = HOME;
Object.assign(process.env, { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' });

const { createCore } = require('../lib/core');
const { createTasks } = require('../lib/tasks');
const { createPlans, cleanWhat } = require('../lib/plans');
const { costOf, priceFor, usd } = require('../lib/cost');
const { startLocal } = require('../lib/local');

let fails = 0;
const ok = (name, v, extra = '') => { console.log((v ? '✓ ' : '✗ ') + name + (v ? '' : ' ' + extra)); if (!v) { fails++; process.exitCode = 1; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(100); } }
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const FAKE = path.join(__dirname, 'fixtures', 'fake-agent.js');
function repo(name) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `pt-${name}-`)));
  sh(d, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(d, 'README.md'), 'hi\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'first');
  return d;
}

(async () => {
  // ---------- the cost meter ----------
  ok('prices: the right model, and none for one we do not know', priceFor('claude-opus-5-5').out === 20 && priceFor('claude-sonnet-4-5-20250929').in === 3 && priceFor('claude-opus-4-20250514').in === 15
    && priceFor('gpt-6.1-sol').read === 0.1 && priceFor('gpt-5-2025-08-07').in === 1.25 && priceFor('gpt-5.9-new') === null && priceFor('claude-haiku-9') === null);
  ok('prices: a million of each', usd({ in: 1e6, out: 1e6, read: 1e6, write: 1e6 }, 'claude-opus-5-5') === 29.2);
  const UH = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-userhome-')), proj = '/work/my.app', t0 = Date.parse('2026-11-16T02:00:00Z'), ts = (s) => new Date(t0 + s * 1000).toISOString();
  const cdir = path.join(UH, '.claude', 'projects', '-work-my-app'); fs.mkdirSync(cdir, { recursive: true });
  const cl = (id, at, u, model = 'claude-sonnet-5-5') => JSON.stringify({ type: 'assistant', timestamp: ts(at), message: { id, model, usage: u } });
  fs.writeFileSync(path.join(cdir, 'a.jsonl'), [
    cl('m0', -600, { input_tokens: 999999, output_tokens: 999999 }),                      // before the task: not counted
    cl('m1', 10, { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 1000 }),  // the same answer, written twice while it streamed
    cl('m1', 11, { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 }),
    cl('m2', 20, { input_tokens: 10, output_tokens: 40 }),
    JSON.stringify({ type: 'user', timestamp: ts(21), message: { content: 'hi' } }), 'not json',
  ].join('\n'));
  const cc = costOf({ agent: 'claude', cwd: proj, startedAt: t0, endedAt: t0 + 60e3 }, { home: UH });
  ok('cost: Claude Code, only this task\'s answers, each once', cc && cc.in === 310 && cc.out === 90 && cc.cached === 1000 && cc.tokens === 1400 && cc.model === 'claude-sonnet-5-5', JSON.stringify(cc));
  ok('cost: and about what that costs', cc && cc.usd === Math.round(((110 * 2 + 90 * 10 + 1000 * 0.1 + 200 * 2.5) / 1e6) * 10000) / 10000, JSON.stringify(cc));
  const xdir = path.join(UH, '.codex', 'sessions', '2026', '11', '16'); fs.mkdirSync(xdir, { recursive: true });
  const tok = (at, i, c, o) => JSON.stringify({ timestamp: ts(at), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: i, cached_input_tokens: c, output_tokens: o } } } });
  fs.writeFileSync(path.join(xdir, 'rollout-1.jsonl'), [JSON.stringify({ timestamp: ts(1), type: 'session_meta', payload: { cwd: proj } }), JSON.stringify({ timestamp: ts(2), type: 'turn_context', payload: { model: 'gpt-6.1-sol' } }), tok(5, 1000, 400, 100), tok(30, 5000, 3000, 700)].join('\n'));
  fs.writeFileSync(path.join(xdir, 'rollout-2.jsonl'), [JSON.stringify({ timestamp: ts(1), type: 'session_meta', payload: { cwd: '/other' } }), tok(5, 9e6, 0, 9e6)].join('\n'));
  const cx = costOf({ agent: 'codex', cwd: proj, startedAt: t0, endedAt: t0 + 60e3 }, { home: UH });
  ok('cost: Codex, the session in this folder, its last total', cx && cx.in === 2000 && cx.cached === 3000 && cx.out === 700 && cx.usd === Math.round(((2000 * 2 + 3000 * 0.1 + 700 * 10) / 1e6) * 10000) / 10000, JSON.stringify(cx));
  const gdir = path.join(UH, '.gemini', 'tmp', crypto.createHash('sha256').update(proj).digest('hex'), 'chats'); fs.mkdirSync(gdir, { recursive: true });
  fs.writeFileSync(path.join(gdir, 'session-1.json'), JSON.stringify({ messages: [{ type: 'user', timestamp: ts(3) }, { type: 'gemini', timestamp: ts(9), model: 'gemini-9-new', tokens: { input: 500, output: 60, cached: 100, thoughts: 40 } }] }));
  const cg = costOf({ agent: 'gemini', cwd: proj, startedAt: t0, endedAt: t0 + 60e3 }, { home: UH });
  ok('cost: Gemini CLI tokens; no money for a model without a known price', cg && cg.tokens === 600 && cg.out === 100 && cg.usd === null, JSON.stringify(cg));
  ok('cost: an agent without a log we can read, or no log at all: nothing', costOf({ agent: 'aider', cwd: proj, startedAt: t0 }, { home: UH }) === null && costOf({ agent: 'claude', cwd: '/nowhere', startedAt: t0 }, { home: UH }) === null);
  fs.writeFileSync(path.join(UH, 'prices.json'), JSON.stringify({ 'gemini-9-new': { in: 1, out: 2, read: 0.5 } }));
  ok('cost: your own prices (prices.json)', costOf({ agent: 'gemini', cwd: proj, startedAt: t0, endedAt: t0 + 60e3 }, { home: UH, dir: UH }).usd === Math.round(((400 * 1 + 100 * 2 + 100 * 0.5) / 1e6) * 10000) / 10000);

  // ---------- what to run ----------
  ok('what: a schedule must be complete; a recipe may leave the task and folder open', !!cleanWhat({ kind: 'race', agents: ['a', 'b'] }, true).error && !!cleanWhat({ kind: 'race', agents: ['a', 'b'] }, false).what
    && !!cleanWhat({ kind: 'race', agents: ['a'] }, false).error && cleanWhat({ kind: 'chain', steps: [{ agent: 'x' }, { agent: 'bad name!' }] }, false).what.steps.length === 1 && !!cleanWhat({ kind: 'task' }, false).error);

  // ---------- schedules ----------
  const core = createCore({ log: () => {}, power: null, dir: HOME });
  const told = [];
  const tasks = createTasks({ core, log: () => {}, dir: HOME, shell: '/bin/bash', alert: (ev) => told.push(ev) });
  await tasks.onPhone({ t: 'task-cfg', id: 'c', agents: { fake: `node ${FAKE} {q}`, once: `node ${FAKE} --once {q}` } }, () => {}, (s) => s, () => {});
  let clock = new Date(2026, 10, 16, 1, 0, 0); // Monday 01:00
  const GH = path.join(HOME, 'gh.js'), ISSUES = path.join(HOME, 'issues.json'), GHLOG = path.join(HOME, 'gh.log');
  fs.writeFileSync(GH, `#!/usr/bin/env node\nconst fs=require('fs');fs.appendFileSync(${JSON.stringify(GHLOG)},process.argv.slice(2).join(' ')+'\\n');process.stdout.write(fs.readFileSync(${JSON.stringify(ISSUES)},'utf8'));\n`, { mode: 0o755 });
  const notes = [];
  const plans = createPlans({ tasks, log: () => {}, dir: HOME, tell: (title, body) => notes.push({ title, body }), now: () => new Date(clock), gh: GH });
  const say = async (m) => { const out = []; await plans.onPhone({ id: 'x', ...m }, (r) => out.push(r), () => {}); return out[0]; };
  const r1 = repo('sched');
  let v = await say({ t: 'sched-save', name: 'Nightly', at: '02:00', days: [], what: { kind: 'task', agent: 'once', prompt: 'night fix', cwd: r1 } });
  ok('schedule: saved', v.ok && v.schedules.length === 1 && v.schedules[0].label === 'once' && v.schedules[0].on, JSON.stringify(v));
  ok('schedule: an incomplete one is refused', !!(await say({ t: 'sched-save', at: '02:00', what: { kind: 'task', agent: 'once', cwd: r1 } })).error && !!(await say({ t: 'sched-save', at: '26:00', what: { kind: 'task', cmd: 'true', cwd: r1 } })).error);
  plans.tick();
  ok('schedule: nothing before its time', tasks.view().tasks.length === 0);
  clock = new Date(2026, 10, 16, 2, 0, 30); plans.tick(); plans.tick();
  ok('schedule: starts at its time, once', (await until(() => tasks.view().tasks.length === 1)) && tasks.view().tasks.length === 1);
  ok('schedule: the run finishes and is written to its log', !!(await until(() => (plans.view().schedules[0].log.find((l) => l.status === 'done') || null), 20000)), JSON.stringify(plans.view().schedules[0].log));
  const done = plans.view().schedules[0].log.find((l) => l.status === 'done');
  ok('schedule: the log says what happened (files changed)', /1 file changed/.test(done.text) && fs.existsSync(path.join(r1, 'night.txt')), JSON.stringify(done));
  ok('schedule: and to schedule.log on the computer', /Nightly {2}started/.test(fs.readFileSync(path.join(HOME, 'schedule.log'), 'utf8')) && /Nightly {2}done/.test(fs.readFileSync(path.join(HOME, 'schedule.log'), 'utf8')));
  clock = new Date(2026, 10, 16, 23, 0, 0); plans.tick();
  ok('schedule: not again the same day', tasks.view().tasks.length === 1);
  clock = new Date(2026, 10, 17, 9, 30, 0); plans.tick();
  ok('schedule: computer off at its time: logged as missed, not run late in the day', plans.view().schedules[0].log.slice(-1)[0].status === 'missed' && tasks.view().tasks.length === 1);
  clock = new Date(2026, 10, 18, 3, 0, 0); plans.tick();
  ok('schedule: asleep at its time, awake an hour later: runs then, and says so', (await until(() => tasks.view().tasks.length === 2)) && /late/.test(plans.view().schedules[0].log.slice(-1)[0].text));
  await until(() => plans.view().schedules[0].log.slice(-1)[0].status === 'done', 20000);
  v = await say({ t: 'sched-save', name: 'Weekends', at: '02:00', days: [0, 6], what: { kind: 'task', cmd: 'echo hi', cwd: r1 } });
  const echoes = () => tasks.view().tasks.filter((t) => t.title === 'echo hi').length, nightly = () => tasks.view().tasks.filter((t) => /night fix/.test(t.title)).length;
  clock = new Date(2026, 10, 19, 2, 1, 0); plans.tick(); // a Thursday: the nightly one runs, the weekend one doesn't
  ok('schedule: chosen weekdays only', (await until(() => nightly() === 3)) && echoes() === 0);
  clock = new Date(2026, 10, 21, 2, 1, 0); plans.tick(); // Saturday
  ok('schedule: and on a chosen day it runs', !!(await until(() => echoes() === 1)));
  v = await say({ t: 'sched-save', name: 'Bad folder', at: '02:05', what: { kind: 'task', cmd: 'true', cwd: '/no/such/folder' } });
  clock = new Date(2026, 10, 21, 2, 6, 0); plans.tick(); await sleep(300);
  ok('schedule: one that cannot start says why (log and phone)', plans.view().schedules.find((s) => s.name === 'Bad folder').log.slice(-1)[0].status === 'could not start' && notes.some((n) => /could not start/.test(n.title)));
  v = await say({ t: 'sched-run', pid: plans.view().schedules[1].id });
  ok('schedule: "run now"', v.ok && !!(await until(() => echoes() === 2)));
  v = await say({ t: 'sched-del', pid: plans.view().schedules[2].id });
  ok('schedule: removed', v.schedules.length === 2);

  // ---------- the morning summary ----------
  await until(() => !tasks.view().tasks.some((t) => ['waiting', 'running'].includes(t.status)), 20000);
  const text = plans.morningText(0);
  ok('morning: what was done, in one note', text && /^Your agents: \d+ done/.test(text.title) && /✓ once: night fix · 1 file/.test(text.body), JSON.stringify(text));
  // (tasks end at the real time, so this part runs on the real clock, in its own plans)
  const real = new Date(), mins = real.getHours() * 60 + real.getMinutes();
  if (mins > 1430) console.log('- morning at its time: skipped this close to midnight');
  else {
    const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    let clock2 = new Date(real.getTime() - 3 * 3600e3 > new Date(real).setHours(0, 0, 0, 0) ? real.getTime() - 3 * 3600e3 : new Date(real).setHours(0, 0, 0, 0));
    const notes2 = [];
    const p2 = createPlans({ tasks, log: () => {}, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'pt-morning-')), tell: (title, body) => notes2.push({ title, body }), now: () => new Date(clock2) });
    await p2.onPhone({ t: 'morning-set', id: 'm', on: true, at: hhmm(new Date(real.getTime() + 2 * 60e3)) }, () => {}, () => {});
    clock2 = new Date(real); p2.tick();
    ok('morning: not before its time', notes2.length === 0);
    clock2 = new Date(real.getTime() + 3 * 60e3); p2.tick(); p2.tick();
    ok('morning: one notification at its time', notes2.length === 1 && /^Your agents:/.test(notes2[0].title), JSON.stringify(notes2));
    clock2 = new Date(real.getTime() + 24 * 3600e3 + 3 * 60e3); p2.tick();
    ok('morning: a quiet day sends nothing', notes2.length === 1);
    const o = []; await p2.onPhone({ t: 'morning-now', id: 'n' }, (r) => o.push(r), () => {});
    ok('morning: "send it now"', o[0].ok && notes2.length === 2);
    p2.stop();
  }
  await say({ t: 'morning-set', on: true, at: '08:00' });

  // ---------- recipes ----------
  v = await say({ t: 'recipe-save', name: 'Write then review', what: { kind: 'chain', steps: [{ agent: 'fake' }, { agent: 'once' }], test: 'npm test', cwd: '/tmp/x', prompt: '' } });
  ok('recipe: saved without a folder (it is a way of working, not a place)', v.ok && v.recipes.length === 1 && v.recipes[0].what.cwd === undefined && v.recipes[0].what.test === 'npm test' && v.recipes[0].label === 'Hand-off: fake → once', JSON.stringify(v.recipes));
  v = await say({ t: 'recipe-save', name: 'Write then review', what: { kind: 'race', agents: ['fake', 'once'] } });
  ok('recipe: the same name replaces it', v.recipes.length === 1 && v.recipes[0].what.kind === 'race');
  ok('recipe: needs a name', !!(await say({ t: 'recipe-save', name: ' ', what: { kind: 'race', agents: ['fake', 'once'] } })).error);
  v = await say({ t: 'recipe-del', rid: v.recipes[0].id });
  ok('recipe: removed', v.recipes.length === 0);
  await sleep(600);
  const fresh = createPlans({ tasks, log: () => {}, dir: HOME, tell: () => {}, now: () => new Date(clock), gh: GH });
  ok('plans survive a restart (plans.json)', fresh.view().schedules.length === 2 && fresh.view().morning.on); fresh.stop();

  // ---------- GitHub issues ----------
  const r2 = repo('gh');
  fs.writeFileSync(ISSUES, JSON.stringify([{ number: 7, title: 'Grape colours', body: 'Make the grapes purple.\nSecond line.' }, { number: 9, title: 'Later one', body: '' }]));
  ok('github: a folder that is not a git project is refused', !!(await say({ t: 'gh-save', cwd: os.tmpdir(), agents: ['fake'] })).error);
  v = await say({ t: 'gh-save', cwd: r2, agents: ['fake', 'once'], label: 'pocket', test: 'test -f fix.txt' });
  ok('github: project saved', v.ok && v.github.length === 1 && v.github[0].label === 'pocket', JSON.stringify(v));
  const g = await until(() => tasks.view().groups.find((x) => x.from && x.from.issue === 7), 15000);
  ok('github: a labelled issue starts a race, oldest first', !!g && g.kind === 'race' && /^Fix GitHub issue #7: Grape colours/.test(g.prompt), JSON.stringify(tasks.view().groups));
  ok('github: only your own open issues with that label are asked for', /issue list --label pocket --state open --author @me/.test(fs.readFileSync(GHLOG, 'utf8')));
  await plans.checkGithub();
  ok('github: one issue at a time per project', tasks.view().groups.length === 1 && /Working on an issue/.test(plans.view().github[0].note), plans.view().github[0].note);
  const gid = g.id;
  ok('github: the race gets ready to compare', !!(await until(() => tasks.view().groups.find((x) => x.id === gid && x.status === 'compare'), 120000)));
  const lane = tasks.view().tasks.find((t) => t.group === gid && t.status === 'done');
  const picked = await tasks.pick(gid, lane.id);
  ok('github: keeping the winner writes "fixes #7" in the commit (GitHub closes the issue on push)', picked.ok && /\(fixes #7\)/.test(sh(r2, 'log', '-1', '--format=%s')), sh(r2, 'log', '-1', '--format=%s'));
  await plans.checkGithub();
  const g2 = await until(() => tasks.view().groups.find((x) => x.from && x.from.issue === 9), 10000);
  ok('github: then the next issue; a started one is never started twice', !!g2 && !tasks.view().groups.some((x) => x.from && x.from.issue === 7));
  await tasks.cancel(g2.id);
  fs.writeFileSync(GH, '#!/usr/bin/env node\nprocess.stderr.write("To get started with GitHub CLI, please run: gh auth login\\n");process.exit(4);\n', { mode: 0o755 });
  await plans.checkGithub();
  ok('github: not signed in says what to do', /gh auth login/.test(plans.view().github[0].note), plans.view().github[0].note);
  const noGh = createPlans({ tasks, log: () => {}, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'pt-nogh-')), tell: () => {}, gh: path.join(HOME, 'no-such-gh') });
  await noGh.saveGithub({ cwd: r2, agents: ['fake'] }); await noGh.checkGithub();
  ok('github: no gh tool says what to install', /cli\.github\.com/.test(noGh.view().github[0].note), noGh.view().github[0].note); noGh.stop();

  // ---------- the MCP server ----------
  core.tasks = tasks;
  const alerts = []; core.events.on('alert', (ev) => alerts.push(ev));
  const local = startLocal({ core, log: () => {}, dir: HOME });
  await sleep(300);
  const mcp = spawn(process.execPath, [path.join(__dirname, '..', 'mcp.js')], { env: { ...process.env, POCKET_HOME: HOME }, stdio: ['pipe', 'pipe', 'inherit'] });
  const got = new Map(); let mbuf = '';
  mcp.stdout.on('data', (d) => { mbuf += d; let i; while ((i = mbuf.indexOf('\n')) >= 0) { const m = JSON.parse(mbuf.slice(0, i)); mbuf = mbuf.slice(i + 1); got.set(m.id, m); } });
  let nid = 0;
  const rpc = async (method, params, ms = 8000) => { const id = ++nid; mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); return until(() => got.get(id), ms); };
  const tool = async (name, args, ms) => { const r = await rpc('tools/call', { name, arguments: args }, ms); return r && r.result; };
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Test Agent', version: '1' } });
  ok('mcp: says hello', init && init.result.protocolVersion === '2025-06-18' && init.result.serverInfo.name === 'pocket-terminal' && !!init.result.capabilities.tools, JSON.stringify(init));
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await rpc('tools/list', {});
  const names = list.result.tools.map((t) => t.name);
  ok('mcp: its tools', ['ask_phone', 'notify_phone', 'list_terminals', 'read_terminal', 'start_task', 'start_race', 'task_status'].every((n) => names.includes(n)) && list.result.tools.every((t) => t.inputSchema.type === 'object' && t.description), names.join());
  ok('mcp: no tool types into a terminal or answers another agent', !names.some((n) => /input|type|answer|write|send_keys/.test(n)));
  alerts.length = 0;
  let r = await tool('notify_phone', { title: 'Build done', message: 'All green' });
  ok('mcp: notify_phone reaches the phone', r && !r.isError && alerts.some((a) => a.kind === 'task' && a.title === 'Build done' && a.body === 'All green'), JSON.stringify(alerts));
  const asking = tool('ask_phone', { question: 'Delete the old logs?' }, 15000);
  const q = await until(() => core.list('local:').find((s) => s.ask && s.question === 'Delete the old logs?'));
  ok('mcp: ask_phone shows as a question on the phone, from that agent', !!q && q.program === 'Test Agent', JSON.stringify(core.list('local:')));
  core.answer('local:' + q.sid, 'no');
  r = await asking;
  ok('mcp: and the agent gets your answer', r && /answered: no/.test(r.content[0].text), JSON.stringify(r));
  const asking2 = tool('ask_phone', { question: 'Deploy now?', wait_minutes: 0.02 }, 90000);
  ok('mcp: no answer in time is not a yes', await until(async () => { const x = await Promise.race([asking2, sleep(200)]); return x && /No answer/.test(x.content[0].text) && /not treat this as a yes/.test(x.content[0].text); }, 80000));
  ok('mcp: the unanswered question is gone from the phone', !core.list('local:').some((s) => s.ask));
  const asking3 = tool('ask_phone', { question: 'Which colour for the button?' }, 15000);
  const q3 = await until(() => core.list('local:').find((s) => s.ask && /colour/.test(s.question)));
  ok('mcp: its question can be answered in your own words', !!q3 && q3.words === true && core.reply('local:' + q3.sid, 'Make it blue, not red'));
  r = await asking3;
  ok('mcp: and the agent gets those words', r && /own words: "Make it blue, not red"/.test(r.content[0].text), JSON.stringify(r));
  const perm = core.ask({ agent: 'Hook', text: 'Run rm?' });
  ok('a permission question (Claude Code\'s hook) still takes only allow or deny', core.reply(perm.key, 'sure') === false && core.answer(perm.key, 'no') === true && (await perm.decision) === 'no');
  r = await tool('start_task', { folder: r1, command: 'echo mcp-$((20+2)) > mcp.txt' });
  ok('mcp: start_task adds to the queue', r && !r.isError && /Task id/.test(r.content[0].text) && !!(await until(() => fs.existsSync(path.join(r1, 'mcp.txt')), 15000)), JSON.stringify(r));
  r = await tool('start_task', { folder: '/no/such/folder', command: 'true' });
  ok('mcp: a mistake comes back as an error the agent can read', r && r.isError && /No folder/.test(r.content[0].text));
  r = await tool('list_terminals', {});
  const terms = JSON.parse(r.content[0].text);
  ok('mcp: list_terminals', Array.isArray(terms) && terms.some((t) => /^local:L-t/.test(t.id)), r.content[0].text.slice(0, 300));
  const tid = terms.find((t) => /^local:L-t/.test(t.id) && core.isSession(t.id)).id;
  r = await tool('read_terminal', { id: tid, lines: 30 });
  ok('mcp: read_terminal gives plain text (no colour codes)', r && !r.isError && r.content[0].text.length > 0 && !/\x1b/.test(r.content[0].text), JSON.stringify(r).slice(0, 200));
  ok('mcp: read_terminal with a wrong id', (await tool('read_terminal', { id: 'local:nope' })).isError);
  r = await tool('task_status', {});
  const st = JSON.parse(r.content[0].text);
  ok('mcp: task_status', st.agents.includes('fake') && st.tasks.some((t) => /mcp/.test(t.title)), r.content[0].text.slice(0, 200));
  r = await tool('start_race', { folder: r1, task: 'x', agents: ['fake'] });
  ok('mcp: start_race needs two agents', r.isError && /at least 2/.test(r.content[0].text));
  ok('mcp: an unknown tool or method is an error, not a hang', !!(await rpc('tools/call', { name: 'nope' })).error && !!(await rpc('nope/nope', {})).error);
  mcp.stdin.end(); local.stop();
  const lost = spawn(process.execPath, [path.join(__dirname, '..', 'mcp.js')], { env: { ...process.env, POCKET_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'pt-none-')) }, stdio: ['pipe', 'pipe', 'inherit'] });
  let lo = ''; lost.stdout.on('data', (d) => { lo += d; });
  lost.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'notify_phone', arguments: { title: 'x' } } }) + '\n');
  ok('mcp: Pocket Terminal not running: says how to start it', !!(await until(() => /npx pocket-terminal/.test(lo), 5000)), lo); lost.kill();

  plans.stop(); tasks.stop(); core.stop();
  console.log(fails ? `${fails} failed` : 'plans: all passed');
  process.exit(fails ? 1 : 0);
})();
