// Git, for the phone: a short count of what changed (for "finished" notifications), the full
// change list ("See changes"), the branch and how far it is ahead of / behind its remote,
// commit and push, and git worktrees (a separate copy of the project for each agent, so two
// agents on the same project don't get in each other's way).
//
// Every call runs git with a list of arguments (never through a shell), in one folder, with a
// time limit. Push never stops to ask for a password (GIT_TERMINAL_PROMPT=0): it fails instead.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', GCM_INTERACTIVE: 'never', LC_ALL: 'C' };
function git(dir, args, { timeout = 8000, max = 4 << 20 } = {}) {
  return new Promise((res) => execFile('git', ['-C', dir, ...args], { timeout, maxBuffer: max, env: ENV, windowsHide: true },
    (e, out, err) => res({ ok: !e, out: String(out || ''), err: String(err || (e && e.message) || '').trim() })));
}
const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => !/^hint:/.test(l)).slice(-1)[0] || '';

// Files, lines added/removed. null if it isn't a git folder.
function gitChanges(dirp, cb) {
  if (!dirp) return cb(null);
  git(dirp, ['diff', '--numstat', 'HEAD'], { timeout: 5000, max: 1 << 20 }).then((r) => {
    if (!r.ok) return cb(null);
    let files = 0, add = 0, del = 0;
    for (const l of r.out.split('\n')) { const m = l.match(/^(\d+|-)\t(\d+|-)\t/); if (m) { files++; add += +m[1] || 0; del += +m[2] || 0; } }
    git(dirp, ['ls-files', '--others', '--exclude-standard'], { timeout: 5000, max: 1 << 20 }).then((r2) => {
      const fresh = r2.ok ? r2.out.split('\n').filter(Boolean).length : 0;
      cb({ files: files + fresh, add, del, fresh });
    });
  });
}

// The full change list (git diff) of a folder. cb gets { error } or { diff, cut, fresh, files }.
function gitDiff(dirp, cb) {
  git(dirp, ['diff', '--no-color', '--stat', '-p', 'HEAD']).then((r) => {
    if (!r.ok) return cb({ error: /not a git repository/i.test(r.err) ? 'This folder is not a git project, so there is no change list.' : 'git could not show the changes.' });
    git(dirp, ['ls-files', '--others', '--exclude-standard'], { timeout: 5000 }).then((r2) => {
      const fresh = r2.ok ? r2.out.split('\n').filter(Boolean) : [];
      let text = r.out; const cut = text.length > 200e3; if (cut) text = text.slice(0, 200e3);
      cb({ diff: text, cut, fresh: fresh.slice(0, 100) });
    });
  });
}

// Branch, its remote, ahead/behind, and whether anything is uncommitted. null if not a git folder.
async function gitInfo(dirp) {
  if (!dirp) return null;
  const top = await git(dirp, ['rev-parse', '--show-toplevel'], { timeout: 4000 });
  if (!top.ok) return null;
  const st = await git(dirp, ['status', '--porcelain=v2', '--branch'], { timeout: 6000 });
  if (!st.ok) return null;
  const info = { root: top.out.trim(), branch: null, upstream: null, ahead: 0, behind: 0, dirty: 0 };
  for (const l of st.out.split('\n')) {
    if (l.startsWith('# branch.head ')) { const b = l.slice(14).trim(); info.branch = b === '(detached)' ? null : b; }
    else if (l.startsWith('# branch.upstream ')) info.upstream = l.slice(18).trim();
    else if (l.startsWith('# branch.ab ')) { const m = l.match(/\+(\d+) -(\d+)/); if (m) { info.ahead = +m[1]; info.behind = +m[2]; } }
    else if (l && !l.startsWith('#')) info.dirty++;
  }
  return info;
}

// Commit everything in the folder (new files too) with this message.
async function gitCommit(dirp, message) {
  const msg = String(message || '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim().slice(0, 500);
  if (!msg) return { error: 'Write a short message first.' };
  const add = await git(dirp, ['add', '-A']);
  if (!add.ok) return { error: firstLine(add.err) || 'git could not add the files.' };
  const c = await git(dirp, ['commit', '-m', msg], { timeout: 30e3 });
  if (!c.ok) {
    if (/nothing to commit|no changes added/i.test(c.out + c.err)) return { error: 'Nothing to commit: no changes.' };
    if (/user\.email|user\.name|tell me who you are/i.test(c.err)) return { error: 'git doesn\'t know your name yet. On the computer run:  git config --global user.name "Your Name"  and  git config --global user.email you@example.com' };
    return { error: firstLine(c.err || c.out) || 'git could not commit.' };
  }
  const h = await git(dirp, ['rev-parse', '--short', 'HEAD']);
  return { ok: true, commit: h.out.trim(), summary: firstLine(c.out) };
}

// Push the current branch. A branch without a remote branch yet gets one on "origin".
async function gitPush(dirp) {
  const info = await gitInfo(dirp);
  if (!info) return { error: 'This folder is not a git project.' };
  if (!info.branch) return { error: 'Not on a branch (detached HEAD), so there is nothing to push.' };
  const args = info.upstream ? ['push'] : ['push', '-u', 'origin', info.branch];
  const r = await git(dirp, args, { timeout: 90e3 });
  if (!r.ok) {
    const e = r.err;
    if (/could not read (Username|Password)|terminal prompts disabled|Authentication failed|Permission denied \(publickey\)/i.test(e)) return { error: 'Push needs a login. Push once from the computer (so git remembers your login), then it works from here.' };
    if (/rejected|non-fast-forward|fetch first/i.test(e)) return { error: 'The remote has newer commits. Pull first (git pull), then push.' };
    if (/does not appear to be a git repository|No configured push destination|'origin'/i.test(e)) return { error: 'This project has no remote to push to (no "origin").' };
    return { error: firstLine(e) || 'git could not push.' };
  }
  return { ok: true, branch: info.branch, summary: firstLine(r.err) || 'Pushed.' };
}

// ---------- worktrees: a separate copy of the project per agent ----------
// They live outside the project, in ~/.pocket-terminal/worktrees/<project>-<name>, on a new
// branch pt/<name> that starts from the project's current commit.
const WT_HOME = () => path.join(process.env.POCKET_HOME || path.join(os.homedir(), '.pocket-terminal'), 'worktrees');
const safeName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'agent';

async function worktreeAdd(repoDir, name) {
  const info = await gitInfo(repoDir);
  if (!info) return { error: 'That folder is not a git project. Worktrees need git.' };
  const head = await git(info.root, ['rev-parse', 'HEAD']);
  if (!head.ok) return { error: 'This project has no commits yet. Make a first commit, then try again.' };
  const n = safeName(name), branch = `pt/${n}`;
  const dir = path.join(WT_HOME(), `${safeName(path.basename(info.root))}-${n}`);
  fs.mkdirSync(WT_HOME(), { recursive: true });
  const r = await git(info.root, ['worktree', 'add', '-b', branch, dir, 'HEAD'], { timeout: 60e3 });
  if (!r.ok) return { error: firstLine(r.err) || 'git could not make a worktree.' };
  return { ok: true, dir, branch, root: info.root, base: info.branch, baseCommit: head.out.trim() };
}

// Commit what the agent left in its worktree (if anything), so it can be merged.
async function worktreeSave(dir, message) {
  const st = await git(dir, ['status', '--porcelain']);
  if (!st.ok) return { error: 'Its worktree is gone.' };
  if (!st.out.trim()) return { ok: true, nothing: true };
  return gitCommit(dir, message);
}

// Bring a worktree's branch into the project: a merge on the project's own branch.
async function worktreeMerge(root, branch, message) {
  const st = await git(root, ['status', '--porcelain', '--untracked-files=no']);
  if (st.ok && st.out.trim()) return { error: 'Your project has changes that are not committed. Commit or stash them first, then pick again.' };
  const r = await git(root, ['merge', '--no-ff', '-m', String(message || `Merge ${branch}`).slice(0, 200), branch], { timeout: 60e3 });
  if (!r.ok) {
    await git(root, ['merge', '--abort']);
    return { error: /conflict/i.test(r.out + r.err) ? 'Its changes clash with changes made since it started (a merge conflict). Nothing was changed.' : firstLine(r.err || r.out) || 'git could not merge.' };
  }
  return { ok: true };
}

// Remove a worktree and its branch. force: even with changes in it.
async function worktreeRemove(root, dir, branch) {
  const r = await git(root, ['worktree', 'remove', '--force', dir], { timeout: 30e3 });
  if (!r.ok) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} await git(root, ['worktree', 'prune']); }
  if (branch) await git(root, ['branch', '-D', branch]);
  return { ok: true };
}

module.exports = { gitChanges, gitDiff, gitInfo, gitCommit, gitPush, worktreeAdd, worktreeSave, worktreeMerge, worktreeRemove, safeName, git };
