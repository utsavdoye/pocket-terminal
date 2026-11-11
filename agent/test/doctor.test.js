// "npx pocket-terminal doctor": the report says what's wrong in plain words, exits 1 when
// something is broken, and never prints a pairing key, a phone's name or a folder name.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ok = (name, v) => { console.log((v ? '✓ ' : '✗ ') + name); if (!v) process.exitCode = 1; };
const run = (dir) => spawnSync(process.execPath, [path.join(__dirname, '..', 'doctor.js')], { env: { ...process.env, POCKET_HOME: dir, POCKET_DOCTOR_NET: '0' }, encoding: 'utf8' });

const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-doc-'));
let r = run(empty);
ok('doctor: not installed is said plainly, with the fix', /not installed/.test(r.stdout) && /npx pocket-terminal/.test(r.stdout) && r.status === 1);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-doc-'));
fs.mkdirSync(path.join(dir, 'app')); fs.writeFileSync(path.join(dir, 'app', 'VERSION'), '7.4.0\n');
const SECRET = 'S3cretS3cretS3cretS3cretS3cretS3cret';
fs.writeFileSync(path.join(dir, 'direct.json'), JSON.stringify({ name: 'Work Mac', devices: [{ id: 'a1', name: 'Asha’s iPhone', secret: SECRET }, { id: 'b2', name: 'Pixel', secret: SECRET + 'x' }] }));
fs.writeFileSync(path.join(dir, 'push-subs.json'), JSON.stringify({ a1: [{ endpoint: 'https://fcm.googleapis.com/fcm/send/' + SECRET }] }));
fs.writeFileSync(path.join(dir, 'agent.log'), `${new Date().toISOString()} agent running in direct mode\n${new Date().toISOString()} push failed for ${os.homedir()}/private/notes pt-abcdefghijklmnopqrstuvwxyz /Users/asha/work\n`);
r = run(dir);
ok('doctor: counts paired phones and notification addresses', /2 phones paired/.test(r.stdout) && /notifications are on \(1 phone address\)/.test(r.stdout));
ok('doctor: an agent that is not running is the thing to fix (exit 1)', /agent is not running/.test(r.stdout) && r.status === 1);
ok('doctor: recent problems from the log are in the report', /recent problems in the log/.test(r.stdout) && /push failed/.test(r.stdout));
ok('doctor: no keys, phone names or folders in the report', !r.stdout.includes(SECRET) && !/Asha|Pixel|Work Mac/.test(r.stdout) && !r.stdout.includes(os.homedir() + '/private') && !/abcdefghijklmnop/.test(r.stdout) && !/\/Users\/asha/.test(r.stdout));
