#!/usr/bin/env node
// npx pocket-terminal report
//
// Something went wrong? This runs the doctor, asks what happened in one line, shows you the
// whole report, and (only if you say yes) opens a new GitHub issue with it filled in. Nothing is
// sent by this command: your browser opens GitHub's own "new issue" page, and you press Submit.
// The report has no pairing keys, phone names, folder names or anything you typed in a terminal
// (doctor.js takes them out).
//
//   POCKET_REPORT_OPEN=0   print the link instead of opening the browser (tests)

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync, spawn } = require('child_process');

const REPO = 'https://github.com/utsavdoye/pocket-terminal';
const MAX_URL = 7500; // GitHub refuses links much longer than this
const VERSION = require('./package.json').version;

// One line of answer; lines typed (or piped in) early are kept for the next question.
async function ask(lines, q) { process.stdout.write(q); const r = await lines.next(); return r.done ? '' : String(r.value || '').trim(); }

// The link to GitHub's new-issue page with title and text filled in, kept short enough to open.
function issueUrl(title, body) {
  const make = (b) => `${REPO}/issues/new?labels=bug&title=${encodeURIComponent(title)}&body=${encodeURIComponent(b)}`;
  let url = make(body);
  if (url.length <= MAX_URL) return url;
  // Too long: drop lines from the end of the report until it fits, and say so.
  const lines = body.split('\n'); const note = '\n…(shortened: run "npx pocket-terminal doctor" for the whole report)\n```';
  while (lines.length > 4 && make(lines.join('\n') + note).length > MAX_URL) lines.pop();
  return make(lines.join('\n') + note);
}

function bodyFor(what, report) {
  return [
    '**What happened**', what || '(not filled in)', '',
    '**What I expected**', '', '',
    '**Computer**', `${os.type()} ${os.release()} (${process.platform} ${process.arch}), Node ${process.version}, pocket-terminal ${VERSION}`, '',
    '**Phone** (iPhone / Android, browser):', '', '',
    '**Doctor report**', report.trim(), '',
  ].join('\n');
}

function openUrl(url) {
  if (process.env.POCKET_REPORT_OPEN === '0') return false;
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]] : ['xdg-open', [url]];
  try { const p = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }); p.on('error', () => {}); p.unref(); return true; } catch { return false; }
}

if (require.main === module) (async () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pt-report-')), 'report.txt');
  console.log('Checking this computer (npx pocket-terminal doctor)…\n');
  spawnSync(process.execPath, [path.join(__dirname, 'doctor.js')], { stdio: 'inherit', env: { ...process.env, POCKET_DOCTOR_OUT: tmp, POCKET_DOCTOR_QUIET: '1' } });
  let report = ''; try { report = fs.readFileSync(tmp, 'utf8'); } catch {}
  try { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); } catch {}
  if (!report) report = '```\n(the doctor could not run)\n```';

  const rl = readline.createInterface({ input: process.stdin, terminal: false }); const lines = rl[Symbol.asyncIterator]();
  const what = (await ask(lines, '\nWhat went wrong, in one line? (Enter to skip)\n> ')).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 300);
  const title = what ? what.slice(0, 80) : 'Something went wrong';
  const body = bodyFor(what, report);
  console.log('\nThis is what will be in the issue (nothing is sent yet):\n');
  console.log(body.split('\n').map((l) => '  ' + l).join('\n'));
  const yes = /^y(es)?$/i.test(await ask(lines, '\nOpen GitHub to file it? You can still edit it there before you press Submit. (y/N) '));
  rl.close();
  if (!yes) { console.log('Nothing was sent.'); return; }
  const url = issueUrl(title, body);
  if (openUrl(url)) console.log('\nOpened GitHub in your browser. Check it, then press Submit.');
  else console.log(`\nOpen this link to file it:\n\n${url}\n`);
})();

module.exports = { issueUrl, bodyFor };
