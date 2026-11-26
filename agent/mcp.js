#!/usr/bin/env node
// Pocket Terminal as an MCP server: tools an AI agent can call ("npx pocket-terminal mcp").
//
//   ask_phone       ask the person a question on their phone and wait: yes, no, or their own words
//   notify_phone    send a short note to their phone
//   list_terminals  the terminals and agents on this computer: working, blocked or idle
//   read_terminal   the last lines on one terminal's screen
//   start_task      add a task for an agent (or a command) to the queue
//   start_race      give one task to 2-4 agents at once, each in its own copy of the project
//   task_status     the queue, races and hand-offs: status, files changed, tests, cost
//
// Add it to an agent, for example:
//   claude mcp add pocket-terminal -- npx -y pocket-terminal mcp
//   codex mcp add pocket-terminal -- npx -y pocket-terminal mcp
//
// It talks over stdin/stdout (JSON-RPC, one message per line) and passes each call to the running
// Pocket Terminal through its local door (lib/local.js: a socket only you can open). There is no
// tool to type into a terminal or to answer another agent's question, on purpose.

const os = require('os');
const path = require('path');
const { connect, lines } = require('./lib/local');

const DIR = process.env.POCKET_HOME || path.join(os.homedir(), '.pocket-terminal');
const VERSION = (() => { try { return require('fs').readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim(); } catch { try { return require('./package.json').version; } catch { return '0'; } } })();
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
let client = 'An AI agent';

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const TOOLS = [
  { name: 'ask_phone', op: 'ask', description: 'Ask the person a question on their phone and wait for the answer. Use it before something risky or when you need a decision and they are away from the computer. Their phone shows the question with Yes and No, and they can also answer in their own words (typed or spoken). Returns "yes", "no", their words, or no answer if they did not reply in time.',
    inputSchema: { type: 'object', properties: { question: str('The question, one or two short sentences. Best if it can be answered yes or no.'), wait_minutes: { type: 'number', description: 'How long to wait for the answer (1 to 60). Default 10.' } }, required: ['question'] },
    args: (a) => ({ question: a.question, minutes: a.wait_minutes, cwd: process.cwd() }),
    say: (r) => (r.answer === 'words' ? `The person answered in their own words: "${r.text}"` : r.answer ? `The person answered: ${r.answer}.` : `${r.note || 'No answer.'} Do not treat this as a yes.`) },
  { name: 'notify_phone', op: 'notify', description: 'Send a short note to the person\'s phone (for example: the work is finished, or what you found). It does not wait for a reply.',
    inputSchema: { type: 'object', properties: { title: str('A few words.'), message: str('One or two short lines.') }, required: ['title'] },
    args: (a) => ({ title: a.title, message: a.message }), say: () => 'Sent to the phone.' },
  { name: 'list_terminals', op: 'terminals', description: 'List the terminals and AI agents running on this computer through Pocket Terminal: which program, whether it is working, blocked on a question or idle, its folder and git branch.',
    inputSchema: { type: 'object', properties: {} }, args: () => ({}), say: (r) => JSON.stringify(r.terminals, null, 1) },
  { name: 'read_terminal', op: 'read', description: 'Read the last lines on one terminal\'s screen (its id comes from list_terminals). Read-only.',
    inputSchema: { type: 'object', properties: { id: str('The terminal\'s id from list_terminals.'), lines: { type: 'number', description: 'How many lines from the bottom (5 to 200). Default 40.' } }, required: ['id'] },
    args: (a) => ({ id: a.id, lines: a.lines }), say: (r) => r.text || '(the screen is empty)' },
  { name: 'start_task', op: 'task', description: 'Add a task to Pocket Terminal\'s queue: an AI agent with a task, or a shell command. Tasks run one at a time, each in its own terminal the person can open on their phone. See task_status for agent names.',
    inputSchema: { type: 'object', properties: { folder: str('The project folder, e.g. ~/projects/my-app.'), agent: str('Which agent: claude, codex, gemini, … (see task_status). Leave out when giving a command.'), task: str('What the agent should do.'), command: str('A shell command to run instead of an agent.'), own_copy: { type: 'boolean', description: 'Run it in its own copy of the project (a git worktree), so it cannot disturb the main folder.' } }, required: ['folder'] },
    args: (a) => a, say: (r) => `${r.note} Task id: ${r.id}.` },
  { name: 'start_race', op: 'race', description: 'Give the same task to 2 to 4 AI agents at once. Each works in its own copy of the git project. When they finish, the person compares them on the phone and keeps one.',
    inputSchema: { type: 'object', properties: { folder: str('The git project folder.'), task: str('What they should do.'), agents: { type: 'array', items: { type: 'string' }, description: '2 to 4 agent names, e.g. ["claude", "codex"].' }, test: str('A test command to run in each copy at the end, e.g. npm test (optional).') }, required: ['folder', 'task', 'agents'] },
    args: (a) => a, say: (r) => `${r.note} Race id: ${r.id}.` },
  { name: 'task_status', op: 'status', description: 'The task queue, races and hand-offs: status, files changed, test results, time and cost. Also lists the agent names this computer knows.',
    inputSchema: { type: 'object', properties: {} }, args: () => ({}), say: (r) => JSON.stringify(r, null, 1) },
];

// One call to the running Pocket Terminal. ask_phone can take up to an hour.
function call(op, args) {
  return new Promise(async (resolve) => {
    let c; try { c = await connect(DIR, { t: 'mcp', op, client, ...args }); } catch { return resolve({ error: 'Pocket Terminal is not running on this computer. Start it with: npx pocket-terminal' }); }
    let got = false;
    lines(c, (m) => { got = true; resolve(m); c.destroy(); });
    c.on('close', () => { if (!got) resolve({ error: 'Pocket Terminal closed the request (is it older than this tool? Update: npx pocket-terminal@latest).' }); });
    c.on('error', () => {});
  });
}

const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
async function handle(m) {
  const { id, method, params = {} } = m;
  const ok = (result) => { if (id !== undefined && id !== null) out({ jsonrpc: '2.0', id, result }); };
  const bad = (code, message) => { if (id !== undefined && id !== null) out({ jsonrpc: '2.0', id, error: { code, message } }); };
  switch (method) {
    case 'initialize':
      if (params.clientInfo && params.clientInfo.name) client = String(params.clientInfo.name).slice(0, 40);
      return ok({ protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0], capabilities: { tools: {} }, serverInfo: { name: 'pocket-terminal', version: VERSION },
        instructions: 'Pocket Terminal links this computer to the person\'s phone. Use ask_phone before risky steps when they may be away, and notify_phone when long work is done.' });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name); if (!tool) return bad(-32602, `Unknown tool: ${params.name}`);
      const a = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const r = await call(tool.op, tool.args(a));
      return ok(r.error ? { content: [{ type: 'text', text: r.error }], isError: true } : { content: [{ type: 'text', text: tool.say(r) }] });
    }
    case 'resources/list': return ok({ resources: [] });
    case 'prompts/list': return ok({ prompts: [] });
    default: if (id !== undefined && id !== null && !String(method || '').startsWith('notifications/')) bad(-32601, `Method not found: ${method}`);
  }
}

let buf = '', busy = 0, ended = false;
const maybeExit = () => { if (ended && !busy) process.exit(0); };
process.stdin.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue;
    let m; try { m = JSON.parse(l); } catch { out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    busy++; handle(m).catch(() => {}).then(() => { busy--; maybeExit(); });
  }
});
// The agent that started us went away: finish quick calls, drop a waiting question (it is cancelled).
process.stdin.on('end', () => { ended = true; maybeExit(); setTimeout(() => process.exit(0), 2000); });
