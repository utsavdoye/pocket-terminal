// The watcher's rules: is the screen asking something, which line asks it, which
// one-tap answers fit, and when smart auto-approve may answer "yes" by itself.
// Plain functions, no state. core.js uses them (and re-exports them).

// ---------- the watcher's rules ----------
const ANSI = /\x1b\[[0-9;?<>=]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
// Full-screen programs (Claude Code, Codex) move the cursor instead of printing new lines: each move
// starts a new line here, so the question on screen isn't glued to old text above it.
const MOVE = /\x1b\[\d*(?:;\d*)?[Hf]|\x1b\[\d*[ABEFd]/g;
const plain = (s) => s.replace(MOVE, '\n').replace(ANSI, '').replace(/\r(?!\n)/g, '\n');
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
// The last few lines a program printed, for its "finished" notification (which can show on a
// locked phone): without the shell prompt that follows it, and without anything that looks
// like a password, key or token.
const PROMPT = /^\S*[$%#>❯➜»]\s*$|^[\w.-]+@[\w.-]+.*[$%#>]\s*$|^(?:PS )?[A-Z]:\\.*>\s*$|^[➜❯]\s/;
const SECRET = /(?:pass(?:word|phrase)?|secret|token|api[_-]?key|bearer|private[_ -]?key)\b[^\n]{0,20}[:=]|-----BEGIN|\b(?:sk|pk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{12,}/i;
function lastLines(tail, n = 3) {
  const ls = String(tail || '').split('\n').map((l) => l.trim()).filter(Boolean);
  while (ls.length && PROMPT.test(ls[ls.length - 1])) ls.pop();
  return ls.slice(-n).filter((l) => !SECRET.test(l)).map((l) => (l.length > 90 ? l.slice(0, 89) + '…' : l));
}
// The line that asks (has a "?", [y/N], "password:"…), else the last line.
const question = (tail) => { const ls = tail.split('\n').map((l) => l.trim()).filter(Boolean); return [...ls].reverse().find((l) => /\?|\[y\/n\]|\(y\/n\)|password|passphrase|press (enter|return|any key)/i.test(l)) || ls.slice(-1)[0] || ''; };
const isMenu = (tail) => /(?:^|\n)\s*(?:❯|›|>)?\s*1\.\s+\S[\s\S]*\n\s*2\.\s+\S/.test(tail);

// ---------- smart auto-approve ----------
// Off by default. When on, a question is answered "yes" by itself only if the screen shows one of
// your "always yes" words AND none of your "always ask" words. Anything else still asks you.
// Both lists are yours to edit (Settings → AI agents). A few things always ask, whatever the
// lists say: passwords, sudo, and deleting folders (rm -rf).
const ALWAYS_ASK = /password|passphrase|\bsudo\b|\brm\s+-[a-z]*[rf][a-z]*\b/i;
const DEFAULT_ASK = ['rm', 'rmdir', 'del', 'delete', 'remove', 'drop', 'truncate', 'force', 'push', 'deploy', 'publish', 'release', 'chmod', 'chown', 'kill', 'reset', 'revert', 'overwrite', 'format', 'mkfs', 'dd', 'curl', 'wget', 'install', 'uninstall', 'payment', 'secret', 'token', 'prod', 'production', 'migrat'];
const DEFAULT_AUTO = { enabled: false, allow: ['npm test', 'npm run test', 'pytest', 'go test', 'cargo test', 'git status', 'git diff', 'ls', 'cat ', 'Read(', 'Read file', 'Search(', 'Grep'], ask: DEFAULT_ASK };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A word from the "always ask" list: a word matches where a word starts ("rm" catches "rm" and
// "rmdir", not "format"); anything with spaces or symbols ("git push") matches anywhere.
function askHit(cfg, tail) {
  if (ALWAYS_ASK.test(tail)) return 'always';
  const list = Array.isArray(cfg.ask) ? cfg.ask : DEFAULT_ASK;
  for (const w of list) { const t = String(w).trim(); if (!t) continue; const re = new RegExp((/^\w/.test(t) ? '\\b' : '') + esc(t), 'i'); if (re.test(tail)) return t; }
  return null;
}
// Just the agent's question box at the bottom of the screen: from its last tool heading
// ("Bash command", "Bash(…)", "Edit file", …), or else the last 12 lines. Old text above it
// (earlier work, which may say "pushed" or "removed") must not decide the answer.
const HEAD = /^[\s│|>]*(?:Bash command|Bash\(|Edit file|Create file|Write\(|Edit\(|Update\(|Fetch\(|Read\(|Shell|Run command|Allow command|Tool use)/i;
function askBox(tail) {
  const lines = String(tail || '').split('\n').filter((l) => l.trim()).slice(-30);
  let i = -1; for (let k = lines.length - 1; k >= 0; k--) if (HEAD.test(lines[k])) { i = k; break; }
  return (i >= 0 ? lines.slice(i) : lines.slice(-12)).join('\n');
}
function autoDecision(cfg, tail, text, menu) {
  if (!cfg || !cfg.enabled || !Array.isArray(cfg.allow) || !cfg.allow.length) return null;
  if (/password|passphrase/i.test(text)) return null;
  if (askHit(cfg, tail)) return null;
  const screen = tail.toLowerCase();
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

module.exports = { askBox, plain, asksForInput, lastLine, lastLines, question, isMenu, DEFAULT_AUTO, DEFAULT_ASK, autoDecision, askHit, choicesFor };
