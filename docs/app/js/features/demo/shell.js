// Demo mode's pretend computer: answers every message the app sends (sessions, files, websites,
// sharing…) and runs a tiny line editor with a few canned commands and a pretend AI agent.

import { state } from '../../core/state.js';
import { handleMsg } from '../../connection/messages.js';
import { C, PROMPT, DEMO_OUT, DEMO_DIFF, DEMO_SESSIONS, DEMO_AUTO } from './data.js';
import { demoSleep } from './demo.js';

const demoRun = (cmd) => {
  const c = cmd.trim().replace(/\s+/g, ' ');
  if (c === 'date') return { code: 0, out: new Date().toString() };
  if (c.startsWith('echo ')) return { code: 0, out: c.slice(5).replace(/^["']|["']$/g, '') };
  if (DEMO_OUT[c] != null) return { code: 0, out: DEMO_OUT[c] };
  return { code: 127, out: `zsh: command not found: ${c.split(' ')[0]}\r\n${C.dim}(This is the demo. Type ${C.x}help${C.dim} to see what it knows.)${C.x}` };
};
const plain = (t) => t.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
let demoLine = '', demoHist = [], demoHi = 0;
let demoSess = DEMO_SESSIONS, demoAuto = DEMO_AUTO;
export function demoShell(m) {
  const out = (d) => setTimeout(() => handleMsg({ t: 'o', d }), 0);
  if (m.t === 'ping') return setTimeout(() => handleMsg({ t: 'pong' }), 18 + Math.random() * 20);
  if (m.t === 'cmd') return setTimeout(() => { const r = demoRun(m.cmd); handleMsg({ t: 'result', id: m.id, code: r.code, out: plain(r.out) }); }, 900);
  if (m.t === 'settings') { state.livePower.settings = { ...state.livePower.settings, ...m.power }; return setTimeout(() => handleMsg({ t: 'power', ...state.livePower }), 200); }
  const reply = (r, ms = 120) => setTimeout(() => handleMsg(r), ms);
  const now = Date.now();
  if (m.t === 'sessions' || m.t === 'close-session') {
    if (m.t === 'close-session') demoSess = demoSess.filter((x) => x.sid !== m.sid);
    return reply({ t: 'sessions', current: state.SID, list: demoSess.map((x) => ({ ...x, sid: x.sid === 'main' ? state.SID : x.sid })) });
  }
  if (m.t === 'switch') { state.term.reset(); state.term.write(PROMPT); return reply({ t: 'switched', sid: m.sid }); }
  if (m.t === 'reply') {
    const x = demoSess.find((y) => y.sid === m.sid);
    if (x && x.waiting) { x.waiting = false; x.question = null; x.lastOut = Date.now(); x.line = `✻ ${m.text.slice(0, 60)}`; }
    return reply({ t: 'answered', sid: m.sid, ok: !!x });
  }
  if (m.t === 'auto-get' || m.t === 'auto-set') { if (m.cfg) demoAuto = { enabled: !!m.cfg.enabled, allow: m.cfg.allow }; return reply({ t: 'auto', ...demoAuto }); }
  if (m.t === 'diff') return reply({ t: 'diff', id: m.id, folder: '~/Projects/web', cut: false, fresh: ['src/Cart.test.tsx'], diff: DEMO_DIFF });
  if (m.t === 'answer') {
    const x = demoSess.find((y) => y.sid === m.sid);
    if (x && x.ask) { demoSess = demoSess.filter((y) => y !== x); return reply({ t: 'answered', sid: m.sid, ok: true }); }
    if (x && x.waiting) { x.waiting = false; x.question = null; x.lastOut = Date.now(); x.line = '✓ Edited src/auth.ts · running tests…'; }
    return reply({ t: 'answered', sid: m.sid, ok: !!x });
  }
  if (m.t === 'shares') return reply({ t: 'shares', list: [] });
  if (m.t === 'share') return reply({ t: 'share', id: 'demo', link: 'https://pocket-terminal.utsavdoye.com/app/#watch=only-a-demo', expires: now + m.minutes * 60e3 });
  if (m.t === 'push-test' || m.t === 'push-sub') return reply({ t: 'push-tested', how: 'none' });
  if (m.t === 'ports') return reply({ t: 'ports', id: m.id, list: [{ port: 3000, name: 'node' }, { port: 5173, name: 'vite' }, { port: 8000, name: 'python3' }] });
  if (m.t === 'ls') {
    const home = '/Users/utsav', p = m.path === '~' ? home : m.path;
    const tree = { [home]: [{ n: 'Claude_Work', d: true }, { n: 'Desktop', d: true }, { n: 'Downloads', d: true }, { n: 'notes.md', d: false, s: 1840 }],
      [home + '/Claude_Work']: [{ n: 'Projects', d: true }, { n: 'resume.pdf', d: false, s: 184320 }],
      [home + '/Claude_Work/Projects']: [{ n: 'pocket-terminal', d: true }, { n: 'tiny-calc', d: true }] };
    return reply({ t: 'ls', id: m.id, path: p, parent: p === '/' ? null : p.replace(/\/[^/]+$/, '') || '/', home, sep: '/', entries: tree[p] || [{ n: 'README.md', d: false, s: 2210 }, { n: 'src', d: true }] });
  }
  if (m.t === 'get') {
    const text = `# Hello from the demo\n\nThis file came from the pretend computer: ${m.path}\n`;
    reply({ t: 'get-h', id: m.id, name: m.path.split('/').pop(), size: text.length });
    return reply({ t: 'get-c', id: m.id, n: 0, d: btoa(unescape(encodeURIComponent(text))), end: true }, 500);
  }
  if (m.t === 'put') return reply({ t: 'put-ok', id: m.id, path: '/Users/utsav/' + m.name });
  if (m.t === 'put-end') return reply({ t: 'put-done', id: m.id, path: '/Users/utsav/uploaded-file' }, 300);
  if (m.t === 'http') {
    const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:17px -apple-system,system-ui,sans-serif;margin:0;background:linear-gradient(160deg,#fff7e6,#fff);min-height:100vh;display:grid;place-items:center;text-align:center"><div><div style="font-size:54px">🚀</div><h1 style="margin:8px 0">My app</h1><p style="color:#666">Running on localhost:${m.port}<br>(in the demo, this page is pretend)</p></div>`;
    reply({ t: 'http-h', id: m.id, status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    return reply({ t: 'http-c', id: m.id, n: 0, d: btoa(unescape(encodeURIComponent(html))), end: true }, 200);
  }
  if (m.t !== 'i') return;
  let d = m.d;
  while (d.length) {
    const esc = d.match(/^\x1b\[[A-D]/);
    if (esc) {
      d = d.slice(3);
      if (esc[0] === '\x1b[A' || esc[0] === '\x1b[B') {
        if (!demoHist.length) continue;
        demoHi = Math.max(0, Math.min(demoHist.length, demoHi + (esc[0] === '\x1b[A' ? -1 : 1)));
        demoLine = demoHist[demoHi] || ''; out('\r\x1b[K' + PROMPT + demoLine);
      }
      continue;
    }
    if (d[0] === '\x1b') { d = d.replace(/^\x1b(\[[0-9;]*[~A-Za-z])?/, ''); continue; }
    const ch = d[0]; d = d.slice(1);
    if (demoWaiting) {
      demoWaiting = false;
      const ans = ch === '1' || ch === '\r' || ch === 'y' ? `${C.g}✓${C.x} Edited src/app.js (1 line)` : ch === '2' ? `${C.g}✓${C.x} Edited src/app.js. Won't ask again this session.` : `${C.y}✗${C.x} Skipped. Tell Claude what to do instead.`;
      out(`\r\n${ans}\r\n${C.dim}Done in 6s.${C.x}\r\n` + PROMPT); d = d.replace(/^\r/, ''); continue;
    }
    if (ch === '\r') {
      const c = demoLine.trim(); demoLine = '';
      if (c) { demoHist.push(c); demoHi = demoHist.length; }
      if (c === 'clear') { out('\x1b[2J\x1b[H' + PROMPT); continue; }
      if (c === 'pmset sleepnow') { out('\r\n'); demoSleep(); continue; }
      if (c === 'claude' || c.startsWith('claude ')) { out('\r\n'); demoAgent(); continue; }
      out('\r\n' + (c ? demoRun(c).out + '\r\n' : '') + PROMPT);
    } else if (ch === '\x7f' || ch === '\b') { if (demoLine) { demoLine = demoLine.slice(0, -1); out('\b \b'); } }
    else if (ch === '\x03') { demoLine = ''; out('^C\r\n' + PROMPT); }
    else if (ch === '\x0c') { out('\x1b[2J\x1b[H' + PROMPT + demoLine); }
    else if (ch === '\t') {
      const hit = Object.keys(DEMO_OUT).concat(['date', 'clear', 'echo ']).find((k) => demoLine && k.startsWith(demoLine) && k !== demoLine);
      if (hit) { out(hit.slice(demoLine.length)); demoLine = hit; }
    } else if (ch >= ' ') { demoLine += ch; out(ch); }
  }
}
function demoAgent() {
  const lines = [`${C.c}✻${C.x} Reading app.js…`, `${C.c}✻${C.x} Planning the change…`, '',
    `${C.b}Edit file${C.x}  src/app.js`, `${C.dim}  - const total = a - b${C.x}`, `${C.g}  + const total = a + b${C.x}`, '',
    'Do you want to make this edit to app.js?', `${C.c}❯${C.x} 1. Yes`, `  2. Yes, and don't ask again this session`, '  3. No, and tell Claude what to do differently (esc)'];
  lines.forEach((l, i) => setTimeout(() => handleMsg({ t: 'o', d: l + '\r\n' }), 350 * (i + 1)));
  setTimeout(() => { demoWaiting = true; handleMsg({ t: 'alert', kind: 'input', program: 'claude', sid: state.SID, text: 'Do you want to make this edit to app.js? ❯ 1. Yes' }); }, 350 * (lines.length + 1));
}
let demoWaiting = false;
