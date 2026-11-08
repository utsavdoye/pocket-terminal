#!/usr/bin/env node
// One command to release:   node scripts/release.js 7.4.0     (or: patch / minor / major)
//
//   1. checks everything is committed and the tests pass
//   2. puts the new version everywhere it appears (npm packages, phone app, offline cache, website footers)
//   3. turns "## Next release" at the top of CHANGELOG.md into "## 7.4.0 (today)"
//   4. commits "Release v7.4.0" and tags it v7.4.0
//   5. asks, then pushes and creates the GitHub release with those notes (needs the gh tool);
//      the release starts .github/workflows/publish.yml, which publishes to npm.
//
// Day to day you just push; write each change under "## Next release" in CHANGELOG.md as you go.

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sh = (c, o = {}) => execSync(c, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o }).trim();
const die = (m) => { console.error('✗ ' + m); process.exit(1); };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const write = (f, s) => fs.writeFileSync(path.join(ROOT, f), s);

const old = require('../package.json').version;
const arg = process.argv[2] || '';
const [a, b, c] = old.split('.').map(Number);
const next = { patch: `${a}.${b}.${c + 1}`, minor: `${a}.${b + 1}.0`, major: `${a + 1}.0.0` }[arg] || arg;
if (!/^\d+\.\d+\.\d+$/.test(next)) die('Say which version:  node scripts/release.js 7.4.0   (or patch / minor / major)');

// 1. clean and green
if (sh('git status --porcelain')) die('Commit or stash your changes first (git status shows some).');
const branch = sh('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') die(`You're on "${branch}". Switch to main first.`);
if (sh('git tag -l v' + next)) die(`v${next} already exists.`);
const log = read('CHANGELOG.md');
const top = log.match(/^## (.+)$/m);
if (!top) die('CHANGELOG.md has no "## …" section.');
const isNext = /^next release$/i.test(top[1].trim());
const isSame = top[1].startsWith(next + ' ');
if (!isNext && !isSame) die(`The top of CHANGELOG.md is "## ${top[1]}". Put this release's changes under "## Next release".`);
const notes = log.slice(top.index + top[0].length).split(/^## /m)[0].trim();
if (!notes) die('"## Next release" in CHANGELOG.md is empty: write what changed first.');
console.log('Running the unit tests…');
const t = spawnSync('npm', ['test'], { cwd: path.join(ROOT, 'agent'), stdio: 'inherit', shell: process.platform === 'win32' });
if (t.status) die('Unit tests failed, nothing changed.');

// 2. the new version everywhere
const today = new Date().toISOString().slice(0, 10);
const esc = old.replace(/\./g, '\\.');
const edits = [
  ['package.json', [[/("version":\s*")[^"]+/, `$1${next}`]]],
  ['agent/package.json', [[/("version":\s*")[^"]+/, `$1${next}`]]],
  ['agent/package-lock.json', [[/("version":\s*")[^"]+/, `$1${next}`], [/("packages":\s*\{\s*"":\s*\{[^}]*?"version":\s*")[^"]+/, `$1${next}`]]],
  ['docs/app/sw.js', [[/(const VERSION = 'pt-v)[^']+/, `$1${next}`]]],
  ['docs/index.html', [[/("softwareVersion":")[^"]+/, `$1${next}`]]],
  ['CHANGELOG.md', [[/^## .+$/m, `## ${next} (${today})`]]],
];
// the phone app's own version (wherever that module lives) and the website footers
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk('docs/app/js')) if (/APP_VERSION = '/.test(read(f))) edits.push([f, [[/(APP_VERSION = ')[^']+/, `$1${next}`]]]);
for (const f of fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.html'))) edits.push(['docs/' + f, [[new RegExp(`v${esc}( · open source)`, 'g'), `v${next}$1`]]]);
for (const [f, rs] of edits) {
  let s = read(f); const was = s;
  for (const [re, to] of rs) s = s.replace(re, to);
  if (s !== was) { write(f, s); console.log(`  ${f}`); }
}

// 4. commit and tag
sh('git add -A');
sh(`git commit -m "Release v${next}"`);
sh(`git tag -a v${next} -m "v${next}"`);
const notesFile = path.join(ROOT, '.git', `release-notes-v${next}.md`);
fs.writeFileSync(notesFile, notes + '\n');
console.log(`\n✓ v${next} is committed and tagged (was ${old}).\n`);

// 5. push and release
const hasGh = spawnSync('gh', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
const finish = () => {
  console.log('To publish it yourself:');
  console.log(`  git push && git push origin v${next}`);
  console.log(`  then on GitHub: Releases → Draft a new release → tag v${next}, paste the notes from`);
  console.log(`  ${notesFile}`);
  console.log('Publishing the release sends it to npm automatically.');
  console.log(`(Changed your mind? Undo before pushing:  git tag -d v${next} && git reset --hard HEAD~1)`);
};
if (!hasGh || !process.stdin.isTTY) return finish();
process.stdout.write(`Push now and publish v${next} to GitHub and npm? (y/N) `);
process.stdin.once('data', (d) => {
  process.stdin.pause();
  if (!/^y/i.test(String(d).trim())) return finish();
  const ok = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;
  if (!ok('git', ['push']) || !ok('git', ['push', 'origin', 'v' + next])) die('Push failed. Fix it, then run the push commands above.');
  if (!ok('gh', ['release', 'create', 'v' + next, '--title', 'v' + next, '--notes-file', notesFile])) die('gh could not create the release. Make it on GitHub with the notes in ' + notesFile);
  console.log(`\n✓ Released v${next}. npm gets it in a minute or two: https://www.npmjs.com/package/pocket-terminal`);
});
