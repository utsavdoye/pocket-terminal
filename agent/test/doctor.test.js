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

// npx pocket-terminal report: the same report, in a GitHub issue link (nothing sent by us)
{
  const { spawnSync: sp } = require('child_process');
  const rep = sp(process.execPath, [path.join(__dirname, '..', 'report.js')], { input: 'The phone shows a blank screen\ny\n', encoding: 'utf8', env: { ...process.env, POCKET_HOME: dir, POCKET_DOCTOR_NET: '0', POCKET_REPORT_OPEN: '0' } });
  const link = (rep.stdout.match(/https:\/\/github\.com\/\S+/g) || []).pop() || '';
  const body = decodeURIComponent(link);
  ok('report: a GitHub new-issue link with your words and the doctor report', /\/issues\/new\?/.test(link) && /title=The%20phone%20shows%20a%20blank%20screen/.test(link) && /2 phones paired/.test(body) && /pocket-terminal doctor/.test(body), rep.stdout.slice(-300));
  ok('report: still no keys, phone names or folders in it', !body.includes(SECRET) && !/Asha|Pixel|Work Mac/.test(body) && !body.includes(os.homedir() + '/private'));
  const no = sp(process.execPath, [path.join(__dirname, '..', 'report.js')], { input: '\nn\n', encoding: 'utf8', env: { ...process.env, POCKET_HOME: dir, POCKET_DOCTOR_NET: '0', POCKET_REPORT_OPEN: '0' } });
  ok('report: say no and nothing is opened or printed as a link', /Nothing was sent/.test(no.stdout) && !/issues\/new\?/.test(no.stdout));
  const { issueUrl } = require('../report.js');
  const long = issueUrl('x', '```\n' + Array.from({ length: 400 }, (_, i) => `line ${i} ${'y'.repeat(30)}`).join('\n') + '\n```');
  ok('report: a very long report is shortened to a link GitHub accepts', long.length <= 7500 && /shortened/.test(decodeURIComponent(long)));
}

// The anonymous weekly count (lib/stats.js): what it sends, and that "off" means nothing is sent
(async () => {
  const http = require('http');
  const got = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { got.push({ url: req.url, body: b }); res.writeHead(204); res.end(); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-stats-'));
  const env0 = { ...process.env };
  Object.assign(process.env, { POCKET_STATS_URL: `http://127.0.0.1:${srv.address().port}`, POCKET_STATS_FIRST_MS: '30' });
  const st = require('../lib/stats.js');
  let s = st.startStats({ dir: home, version: '7.7.2' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(400); s.stop();
  const b = got[0] ? JSON.parse(got[0].body) : {};
  ok('weekly count: one "I\'m here" with only a random id, the version and the kind of computer', got.length === 1 && got[0].url === '/v1/seen' && Object.keys(b).sort().join() === 'id,os,v' && /^[A-Za-z0-9_-]{22}$/.test(b.id) && b.v === '7.7.2' && b.os === process.platform, JSON.stringify(got));
  s = st.startStats({ dir: home, version: '7.7.2' }); await wait(400); s.stop();
  ok('weekly count: the same id every time (so a computer counts once a week)', got.length === 2 && JSON.parse(got[1].body).id === b.id);
  const cli = (...a) => sp2(process.execPath, [path.join(__dirname, '..', '..', 'cli.js'), 'stats', ...a], { encoding: 'utf8', env: { ...process.env, POCKET_HOME: home } });
  const { spawnSync: sp2 } = require('child_process');
  const offOut = cli('off');
  s = st.startStats({ dir: home, version: '7.7.2' }); await wait(400); s.stop();
  ok('weekly count: "npx pocket-terminal stats off" turns it off, and nothing is sent', /is off/.test(offOut.stdout) && got.length === 2 && st.isOff(home));
  ok('weekly count: and on again', /is on/.test(cli('on').stdout) && !st.isOff(home));
  delete process.env.POCKET_STATS_URL;
  process.env.POCKET_HOME = home; s = st.startStats({ dir: home, version: '7.7.2' }); await wait(400); s.stop();
  ok('weekly count: tests (their own POCKET_HOME) never count', got.length === 2);
  for (const k of Object.keys(process.env)) if (!(k in env0)) delete process.env[k]; Object.assign(process.env, env0);
  srv.close();
})();
