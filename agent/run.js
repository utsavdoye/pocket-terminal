#!/usr/bin/env node
// "npx pocket-terminal run <command>": runs the command in a Pocket Terminal session.
// It shows right here, in this window, as usual, and on your phone too. Close this window or
// walk away: it keeps running, and your phone carries on (questions and all).

const os = require('os');
const path = require('path');
const { connect, lines } = require('./lib/local');

const DIR = process.env.POCKET_HOME || path.join(os.homedir(), '.pocket-terminal');
const cmd = process.argv.slice(2).join(' ').trim() || (process.platform === 'win32' ? 'powershell.exe -NoLogo' : (process.env.SHELL || '/bin/bash') + ' -l');

(async () => {
  let c;
  try {
    c = await connect(DIR, { t: 'run', cmd, cwd: process.cwd(), env: process.env, cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 });
  } catch {
    console.error('Pocket Terminal is not running on this computer. Start it with:  npx pocket-terminal');
    process.exit(1);
  }
  const dim = (s) => (process.stderr.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
  process.stderr.write(dim(`⧉ Also live on your phone (⋯ → Agents & terminals). Close this window anytime: it keeps running.\n`));
  const tty = process.stdin.isTTY;
  if (tty) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (d) => c.write(JSON.stringify({ t: 'i', d: d.toString('utf8') }) + '\n'));
  const size = () => c.write(JSON.stringify({ t: 'r', cols: process.stdout.columns, rows: process.stdout.rows }) + '\n');
  process.stdout.on('resize', size);
  let code = 0;
  lines(c, (m) => {
    if (m.t === 'o') process.stdout.write(m.d);
    else if (m.t === 'exit') { code = m.code | 0; c.end(); }
  });
  const done = () => { if (tty) try { process.stdin.setRawMode(false); } catch {} process.exit(code); };
  c.on('close', done); c.on('error', done);
})();
