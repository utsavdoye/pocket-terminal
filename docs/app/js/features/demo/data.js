// Demo mode's sample data: the pretend computer's prompt and canned command output, its agents
// and terminals, a sample diff, and its auto-approve settings.

export const C = { dim: '\x1b[90m', b: '\x1b[1m', g: '\x1b[32m', y: '\x1b[33m', bl: '\x1b[34m', c: '\x1b[36m', r: '\x1b[31m', x: '\x1b[0m' };
export const PROMPT = `${C.g}utsav@MacBook-Pro${C.x} ${C.bl}~${C.x} %% `.replace('%%', '%');
export const DEMO_OUT = {
  help: `Try ${C.b}claude${C.x} (a pretend AI agent asks for permission), ${C.b}ls${C.x}, ${C.b}git status${C.x}, ${C.b}df -h${C.x}, ${C.b}uptime${C.x}, ${C.b}pmset -g batt${C.x}, ${C.b}whoami${C.x}, ${C.b}date${C.x}, ${C.b}clear${C.x}\r\nOr ${C.b}pmset sleepnow${C.x} to watch it fall asleep and wake up again.`,
  ls: `${C.bl}${C.b}Claude_Work${C.x}  ${C.bl}${C.b}Desktop${C.x}  ${C.bl}${C.b}Documents${C.x}  ${C.bl}${C.b}Downloads${C.x}  ${C.bl}${C.b}pocket-terminal${C.x}  notes.md`,
  pwd: '/Users/utsav', whoami: 'utsav',
  uptime: '14:02  up 3 days,  4:11, 2 users, load averages: 1.42 1.37 1.29',
  'git status': `On branch ${C.g}main${C.x}\r\nYour branch is up to date with 'origin/main'.\r\n\r\nChanges not staged for commit:\r\n\t${C.r}modified:   docs/css/app.css${C.x}\r\n\t${C.r}modified:   docs/js/app.js${C.x}`,
  'df -h': `Filesystem      Size   Used  Avail Capacity  Mounted on\r\n/dev/disk3s1s1 460Gi   11Gi  281Gi     4%    /\r\n/dev/disk3s5   460Gi  162Gi  281Gi    37%    /System/Volumes/Data`,
  'pmset -g batt': `Now drawing from 'Battery Power'\r\n -InternalBattery-0 (id=4653155)\t${'78%'}; discharging; 9:41 remaining present: true`,
  'git pull': 'Already up to date.',
};
const T0 = Date.now();
export const DEMO_AUTO = { enabled: false, allow: ['npm test', 'pytest', 'git status', 'Read('] };
export const DEMO_DIFF = `diff --git a/src/Cart.tsx b/src/Cart.tsx
@@ -12,7 +12,9 @@ export function Cart({ items }) {
-  const total = items.reduce((a, i) => a - i.price, 0);
+  const total = items.reduce((a, i) => a + i.price * i.qty, 0);
+  if (!items.length) return <Empty />;
   return <Summary total={total} />;
diff --git a/src/api.ts b/src/api.ts
@@ -3,4 +3,4 @@
-const BASE = 'http://localhost:3000';
+const BASE = import.meta.env.VITE_API ?? 'http://localhost:3000';`;
export const DEMO_SESSIONS = [
  { sid: 'Q-demo', program: 'Claude Code', ask: true, busy: false, running: true, waiting: true, question: 'Run: npm run deploy:staging', askedAt: T0 - 40e3, created: T0 - 40e3, lastOut: T0 - 40e3, viewers: 0, cwd: '~/Projects/site (VS Code)', line: '' },
  { sid: 'agent1', program: 'claude', busy: true, running: true, waiting: true, menu: true, question: 'Do you want to make this edit to auth.ts?', askedAt: T0 - 3 * 60e3, since: T0 - 14 * 60e3, lastOut: T0 - 3 * 60e3, created: T0 - 15 * 60e3, viewers: 0, cwd: '~/Projects/shop-app', line: '❯ 1. Yes', state: 'blocked', git: { branch: 'feat/login', ahead: 2, behind: 0, dirty: 3, upstream: true } },
  { sid: 'agent2', program: 'codex', busy: true, running: true, waiting: false, since: T0 - 22 * 60e3, lastOut: T0 - 4e3, created: T0 - 23 * 60e3, viewers: 0, cwd: '~/Projects/api', line: '● Running tests (38/60)…', state: 'working', git: { branch: 'main', ahead: 0, behind: 1, dirty: 5, upstream: true }, watches: [{ id: 'w1', text: 'tests passed' }] },
  { sid: 'build1', program: null, busy: false, running: true, waiting: false, done: { program: 'npm', at: T0 - 4 * 60e3, seconds: 312, changes: { files: 4, add: 120, del: 8 } }, lastOut: T0 - 4 * 60e3, created: T0 - 10 * 60e3, viewers: 0, cwd: '~/Projects/web', line: 'webpack compiled successfully in 812 ms', state: 'idle', git: { branch: 'main', ahead: 1, behind: 0, dirty: 4, upstream: true } },
  { sid: 'main', program: null, busy: false, running: true, waiting: false, lastOut: T0, created: T0 - 30 * 60e3, viewers: 1, cwd: '~', line: 'utsav@MacBook-Pro ~ %' },
];

// Tasks: a race waiting for you to pick the winner, and a queue that's half done.
const AG = { claude: 'claude {q}', codex: 'codex {q}', gemini: 'gemini -i {q}', opencode: 'opencode --prompt {q}', aider: 'aider --message {q}' };
const NM = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', opencode: 'OpenCode', aider: 'Aider' };
export const DEMO_TASKS = { agents: AG, names: NM,
  groups: [{ id: 'g1', kind: 'race', prompt: 'add a dark mode toggle to the settings page', where: '~/Projects/shop-app', status: 'compare', test: 'npm test', lanes: ['r1', 'r2', 'r3'], startedAt: T0 - 20 * 60e3 }],
  tasks: [
    { id: 'r1', kind: 'race', group: 'g1', agent: 'claude', title: 'Claude Code', where: '~/.pocket-terminal/worktrees/shop-app-claude', status: 'done', sid: 'L-tr1', seconds: 412, cost: { tokens: 412000, usd: 0.84, model: 'claude-sonnet-5-5' }, changes: { files: 4, add: 96, del: 12 }, tests: { ok: true, last: ['Tests: 60 passed'] }, wt: { branch: 'pt/claude-g1' } },
    { id: 'r2', kind: 'race', group: 'g1', agent: 'codex', title: 'Codex', where: '~/.pocket-terminal/worktrees/shop-app-codex', status: 'done', sid: 'L-tr2', seconds: 538, cost: { tokens: 655000, usd: 1.12, model: 'gpt-6.1-sol' }, changes: { files: 6, add: 141, del: 30 }, tests: { ok: false, last: ['Tests: 2 failed, 58 passed'] }, wt: { branch: 'pt/codex-g1' } },
    { id: 'r3', kind: 'race', group: 'g1', agent: 'gemini', title: 'Gemini CLI', where: '~/.pocket-terminal/worktrees/shop-app-gemini', status: 'done', sid: 'L-tr3', seconds: 301, cost: { tokens: 280000, usd: null, model: null }, changes: { files: 3, add: 70, del: 9 }, tests: { ok: true, last: ['Tests: 60 passed'] }, wt: { branch: 'pt/gemini-g1' } },
    { id: 'q1', kind: 'queue', agent: 'claude', title: 'Claude Code: write tests for the cart', where: '~/Projects/shop-app', status: 'done', sid: 'L-tq1', seconds: 640, last: ['✓ Added 12 tests'] },
    { id: 'q2', kind: 'queue', agent: 'codex', title: 'Codex: update the README', where: '~/Projects/shop-app', status: 'running', sid: 'L-tq2', seconds: 95 },
    { id: 'q3', kind: 'queue', cmd: 'npm run build', title: 'npm run build', where: '~/Projects/shop-app', status: 'waiting' },
  ] };

// Work that starts by itself: a nightly schedule with its log, two recipes, one project's issues.
export const DEMO_PLANS = {
  schedules: [{ id: 's1', name: 'Nightly tests', at: '02:00', days: [], on: true, label: 'Claude Code', what: { kind: 'task', agent: 'claude', prompt: 'run the tests and fix what fails', cwd: '~/Projects/shop-app' },
    log: [{ at: T0 - 30 * 3600e3, status: 'started', text: '' }, { at: T0 - 30 * 3600e3 + 9 * 60e3, status: 'done', text: 'Claude Code: run the tests and fix what fails: done, 2 files changed (+14 −3), 9 min · about $0.31' },
      { at: T0 - 6 * 3600e3, status: 'started', text: '' }, { at: T0 - 6 * 3600e3 + 4 * 60e3, status: 'done', text: 'Claude Code: run the tests and fix what fails: done, 4 min · about $0.09\nAll 48 tests pass.' }] }],
  recipes: [{ id: 'c1', name: 'Write, review, test', label: 'Hand-off: Codex → Claude Code', what: { kind: 'chain', steps: [{ agent: 'codex' }, { agent: 'claude' }], test: 'npm test', prompt: '' } },
    { id: 'c2', name: 'Three-way race', label: 'Race: Claude Code vs Codex vs Gemini CLI', what: { kind: 'race', agents: ['claude', 'codex', 'gemini'], test: 'npm test', prompt: '' } }],
  github: [{ id: 'h1', where: '~/Projects/shop-app', label: 'pocket', agents: ['claude', 'codex'], test: 'npm test', on: true, note: 'No open issue of yours has the label "pocket".', checkedAt: T0 }],
  morning: { on: true, at: '08:00' },
};
