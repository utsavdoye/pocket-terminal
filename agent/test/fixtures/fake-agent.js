#!/usr/bin/env node
// A pretend AI agent for tests. "fake-agent.js [--once] <task>": works for ~1.5 s (prints a
// spinner, like a real agent), writes <name>.txt in the folder (name: the task's first word),
// then waits at its own prompt (or exits with --once, like aider --message).
const fs = require('fs');
const args = process.argv.slice(2); const once = args[0] === '--once'; if (once) args.shift();
const task = args.join(' ');
let n = 0;
const t = setInterval(() => {
  process.stdout.write(`\r⠋ thinking ${n++}`);
  if (n > 6) {
    clearInterval(t);
    const name = (task.match(/[a-z]+/i) || ['out'])[0].toLowerCase();
    fs.writeFileSync(`${name}.txt`, `${task}\n`);
    process.stdout.write(`\nwrote ${name}.txt\nALL DONE\n`);
    if (once) process.exit(0);
    process.stdout.write('> ');
    process.stdin.resume();
  }
}, 250);
