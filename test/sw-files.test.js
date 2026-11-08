// The phone app works offline only if its service worker caches every file it loads.
// Fails when a new module in docs/app/js isn't in sw.js FILES (or FILES names a missing file).
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', 'docs', 'app');
const files = eval(fs.readFileSync(path.join(APP, 'sw.js'), 'utf8').match(/const FILES = (\[[^\]]*\])/)[1]);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const js = walk(path.join(APP, 'js')).map((f) => path.relative(APP, f).split(path.sep).join('/'));
const missing = js.filter((f) => !files.includes(f));
const gone = files.filter((f) => f !== './' && !fs.existsSync(path.join(APP, f)));
if (missing.length || gone.length) {
  console.error('✗ sw.js FILES is out of date.' + (missing.length ? ' Add: ' + missing.join(', ') : '') + (gone.length ? ' Remove: ' + gone.join(', ') : ''));
  process.exit(1);
}
console.log(`✓ offline cache: all ${js.length} app modules are in sw.js`);
