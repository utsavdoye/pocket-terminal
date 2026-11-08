// The watcher's rules: is the screen asking something, which line asks it, which
// one-tap answers fit, and when smart auto-approve may answer "yes" by itself.
// Plain functions, no state. core.js uses them (and re-exports them).

// ---------- the watcher's rules ----------
const ANSI = /\x1b\[[0-9;?<>=]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const plain = (s) => s.replace(ANSI, '').replace(/\r(?!\n)/g, '\n');
// "Is the screen asking me something?" Checked on the last few lines, once output goes quiet.
const ASKS = [
  /do you want to\b/i,                                   // Claude Code, Codex: "Do you want to proceed?"
  /(?:❯|›|>)\s*1\.\s*(?:yes|allow|approve)/i,            // numbered choice menus
  /\b1\.\s*yes\b[\s\S]{0,240}\b2\.\s/i,
  /[(\[]\s*(?:y\/n|y\/N|Y\/n|yes\/no)\s*[)\]]\s*[:?]?\s*$/im, // [y/N]  (yes/no)
  /press (?:enter|return|any key)/i,
  /^\s*\?\s.+(?:›|\(Y\/n\)|\(y\/N\)|:)\s*.*$/m,           // npm / inquirer style "? Pick one ›"
  /\b(?:allow|approve|proceed|continue|overwrite|confirm)\b[^\n]{0,80}\?\s*$/im,
  /(?:password|passphrase)[^\n]{0,40}:\s*$/im,           // sudo, ssh, git
];
const asksForInput = (tail) => ASKS.some((r) => r.test(tail));
const lastLine = (tail) => tail.split('\n').map((l) => l.trim()).filter(Boolean).slice(-1)[0] || '';
// The line that asks (has a "?", [y/N], "password:"…), else the last line.
const question = (tail) => { const ls = tail.split('\n').map((l) => l.trim()).filter(Boolean); return [...ls].reverse().find((l) => /\?|\[y\/n\]|\(y\/n\)|password|passphrase|press (enter|return|any key)/i.test(l)) || ls.slice(-1)[0] || ''; };
const isMenu = (tail) => /(?:^|\n)\s*(?:❯|›|>)?\s*1\.\s+\S[\s\S]*\n\s*2\.\s+\S/.test(tail);

// ---------- smart auto-approve ----------
// Off by default. When on, a question is answered "yes" by itself only if the screen shows one of
// your allowed words AND none of the risky ones. Anything else still asks you.
const RISKY = /\b(rm|rmdir|del|delete|remove|drop|truncate|force|--force|-f\b|push|deploy|publish|release|sudo|chmod|chown|kill|reset|revert|overwrite|format|mkfs|dd|curl|wget|install|uninstall|payment|secret|token|password|passphrase|prod|production|migrat)/i;
const DEFAULT_AUTO = { enabled: false, allow: ['npm test', 'npm run test', 'pytest', 'go test', 'cargo test', 'git status', 'git diff', 'ls', 'cat ', 'Read(', 'Read file', 'Search(', 'Grep'] };
function autoDecision(cfg, tail, text, menu) {
  if (!cfg || !cfg.enabled || !Array.isArray(cfg.allow) || !cfg.allow.length) return null;
  if (/password|passphrase/i.test(text)) return null;
  const screen = tail.toLowerCase();
  if (RISKY.test(tail)) return null;
  const hit = cfg.allow.map((a) => String(a).trim()).filter(Boolean).find((a) => screen.includes(a.toLowerCase()));
  if (!hit) return null;
  const c = choicesFor(text, menu).find((x) => x.a === 'yes');
  return c ? { d: c.d, rule: hit } : null;
}

// The one-tap answers that fit a question. The phone only ever sends the choice's name;
// what gets typed is decided here, on the computer.
function choicesFor(text, menu) {
  const t = String(text || '');
  if (menu || /(?:❯|›)\s*1\./.test(t) || /do you want/i.test(t)) return [{ a: 'yes', title: '1 · Yes', d: '1' }, { a: 'no', title: 'No (Esc)', d: '\x1b' }];
  if (/y\/n|yes\/no/i.test(t)) return [{ a: 'yes', title: 'Yes', d: 'y\r' }, { a: 'no', title: 'No', d: 'n\r' }];
  if (/password|passphrase/i.test(t)) return []; // never from a notification
  if (/press (?:enter|return|any key)/i.test(t)) return [{ a: 'yes', title: 'Enter', d: '\r' }];
  return [];
}

module.exports = { plain, asksForInput, lastLine, question, isMenu, DEFAULT_AUTO, autoDecision, choicesFor };
