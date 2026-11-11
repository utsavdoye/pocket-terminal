// Which message boards are used: the app and the agent must agree, and old pairings (only
// ntfy.sh listed) must pick up our own board without pairing again.
const fs = require('fs');
const path = require('path');
const b = require('../lib/board');
const ok = (name, v) => { console.log((v ? '✓ ' : '✗ ') + name); if (!v) process.exitCode = 1; };
const env = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'app', 'js', 'core', 'env.js'), 'utf8');
const appOwn = env.match(/export const OWN_BOARD = '([^']*)';/)[1];
ok('the phone app and the agent name the same own board', appOwn === b.OWN_BOARD);
ok('the own board is https with no path (or not set yet)', b.OWN_BOARD === '' || /^https:\/\/[a-z0-9.-]+$/i.test(b.OWN_BOARD));
ok('ntfy.sh is always the backup', b.DEFAULT_BOARDS[b.DEFAULT_BOARDS.length - 1] === 'https://ntfy.sh' && (b.OWN_BOARD ? b.DEFAULT_BOARDS[0] === b.OWN_BOARD : b.DEFAULT_BOARDS.length === 1));
ok('an old pairing (only ntfy.sh, or nothing saved) gets the default boards', b.boardsFor(['https://ntfy.sh']) === b.DEFAULT_BOARDS && b.boardsFor(undefined) === b.DEFAULT_BOARDS && b.boardsFor([]) === b.DEFAULT_BOARDS);
const mine = ['https://ntfy.sh', 'https://ntfy.example.com'];
ok('your own list of boards is left alone', b.boardsFor(mine) === mine && !b.sameAsDefault(mine) && b.sameAsDefault(['https://ntfy.sh']));
