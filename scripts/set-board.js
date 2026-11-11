#!/usr/bin/env node
// Tell the app and the agent where Pocket Terminal's own message board lives.
//
//   node scripts/set-board.js https://pocket-terminal-board.YOURNAME.workers.dev
//   node scripts/set-board.js off        (back to ntfy.sh only)
//
// The address must be the same in the phone app and in the agent, so this writes both:
//   docs/app/js/core/env.js   and   agent/lib/board.js
// It first checks that the board answers. Then commit, push and release as usual.
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const arg = (process.argv[2] || '').replace(/\/+$/, '');
const die = (m) => { console.error(m); process.exit(1); };
if (!arg) die('Usage: node scripts/set-board.js https://your-board.workers.dev   (or: off)');
const url = arg === 'off' ? '' : arg;
if (url && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)) die('The board address must look like https://name.example.com (no path).');

(async () => {
  if (url && !process.argv.includes('--no-check')) {
    try {
      const r = await fetch(url + '/v1/health', { signal: AbortSignal.timeout(10e3) });
      const j = await r.json();
      if (!r.ok || j.healthy !== true) throw new Error('answered ' + r.status);
      const t = 'pt-setboardcheck' + Math.random().toString(36).slice(2, 12);
      const p = await fetch(`${url}/${t}`, { method: 'POST', body: 'hello' });
      const g = await (await fetch(`${url}/${t}/json?poll=1&since=all`)).text();
      if (!p.ok || !g.includes('"message":"hello"')) throw new Error('a test note did not come back');
    } catch (e) { die(`That board does not answer properly (${e.message}). Deploy it first:  cd board && npx wrangler deploy`); }
  }
  for (const [file, re] of [['docs/app/js/core/env.js', /export const OWN_BOARD = '[^']*';/], ['agent/lib/board.js', /const OWN_BOARD = '[^']*';/]]) {
    const f = path.join(R, file), s = fs.readFileSync(f, 'utf8');
    if (!re.test(s)) die(`Could not find OWN_BOARD in ${file}`);
    fs.writeFileSync(f, s.replace(re, (m) => m.replace(/'[^']*'/, `'${url}'`)));
  }
  console.log(url ? `Own board set: ${url}\nPhones and computers will use it first, with ntfy.sh as the backup.` : 'Own board turned off: ntfy.sh only.');
  console.log('Next:  git add -A && git commit -m "Use our own message board" && git push   then   node scripts/release.js patch');
})();
