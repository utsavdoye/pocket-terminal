// Demo mode (#demo): starts the whole app with sample data, talking to the pretend computer in
// shell.js through a pretend link that can fall asleep and wake up again.

import { $, show } from '../../core/dom.js';
import { state, mac } from '../../core/state.js';
import { sendTerm } from '../../connection/link.js';
import { handleMsg } from '../../connection/messages.js';
import { setupTerminal } from '../../terminal/term.js';
import { flushPending } from '../../terminal/input.js';
import { setupUi } from '../../ui/setup.js';
import { paint, paintPing } from '../../ui/status.js';
import { jobs, saveJobs, replaceJobs } from '../commands.js';
import { paintAiInfo } from '../ai.js';
import { C, PROMPT } from './data.js';
import { demoShell } from './shell.js';

// ---------- demo mode ----------
// A pretend computer: a tiny line editor with a few canned commands, sample history and power data.
// "pmset sleepnow" puts it to sleep for 20 s so you can see the asleep state and the lamp filling up.
const demoDc = { readyState: 'open', send: (raw) => demoShell(JSON.parse(raw)), close() {} };
function demoWake() {
  state.dc = demoDc; state.linkState = 'direct'; mac.state = 'online'; mac.ts = Date.now();
  flushPending(); paint();
  for (const j of jobs.filter((x) => x.status === 'waiting')) { j.status = 'running'; sendTerm({ t: 'cmd', id: j.cid, cmd: j.cmd }); }
  saveJobs();
}
export function demoSleep() {
  state.dc = null; state.rtt = null; paintPing();
  state.linkState = 'waiting'; Object.assign(mac, { state: 'sleeping', ts: Date.now(), nextWake: Date.now() + 20e3, checkIn: 20 / 60 });
  paint();
  setTimeout(() => { state.linkState = 'connecting'; mac.state = null; paint(); }, 20e3);
  setTimeout(() => { demoWake(); handleMsg({ t: 'o', d: `${C.dim}[woke up by itself and reconnected]${C.x}\r\n` + PROMPT }); }, 21.4e3);
}
export function startDemo() {
  state.S = { name: 'MacBook Pro', notifyTopic: 'ptn-demo-1a2b3c', boards: [] };
  state.keys = null; mac.name = state.S.name;
  state.board = { up: new Set([1]), restart() {}, stop() {}, start() {}, publish: async () => {} };
  state.livePower = { t: 'power', percent: 78, onCharger: false, reasons: ['phone connected'],
    settings: { batteryMode: 'saver', speed: 'smart', minBattery: 20, awakeOnCharger: true } };
  const now = Date.now();
  replaceJobs([
    { cid: 'd1', cmd: 'git -C ~/pocket-terminal pull', created: now - 4 * 60e3, finished: now - 4 * 60e3 + 2000, status: 'done', code: 0, out: 'Already up to date.' },
    { cid: 'd2', cmd: 'npm test --prefix ~/pocket-terminal/agent', created: now - 52 * 60e3, finished: now - 51 * 60e3, status: 'done', code: 0, out: '> pocket-terminal-agent@6.2.0 test\n> node --test\n\n# tests 41\n# pass 41\n# fail 0' },
    { cid: 'd3', cmd: 'brew upgrde node', created: now - 3 * 3600e3, finished: now - 3 * 3600e3 + 900, status: 'done', code: 1, out: 'Error: Unknown command: upgrde\nDid you mean "upgrade"?' },
  ]);
  show('app'); $('notifyTopic').textContent = state.S.notifyTopic;
  setupTerminal(); setupUi(); paintAiInfo();
  // ("Demo" shows in the status line under the name, so the name keeps its room)
  state.linkState = 'connecting'; paint(); setInterval(paint, 1000);
  state.term.write(`${C.y}●${C.x} ${C.b}Pocket Terminal demo${C.x}\r\n${C.dim}A pretend computer, nothing real.${C.x}\r\n${C.dim}Type ${C.x}claude${C.dim} or ${C.x}help${C.dim}, or tap ⋯${C.x}\r\n\r\n`);
  setTimeout(() => { demoWake(); handleMsg({ t: 'o', d: PROMPT }); }, 1100);
}
