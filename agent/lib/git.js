// What changed in a folder, from git: a short count (files, lines added/removed) for
// "finished" notifications, and the full change list for "See changes" on the phone.

const { execFile } = require('child_process');

// Files, lines added/removed. null if it isn't a git folder.
function gitChanges(dirp, cb) {
  {
    if (!dirp) return cb(null);
    execFile('git', ['-C', dirp, 'diff', '--numstat', 'HEAD'], { timeout: 5000, maxBuffer: 1 << 20 }, (e, out) => {
      if (e) return cb(null);
      let files = 0, add = 0, del = 0;
      for (const l of String(out).split('\n')) { const m = l.match(/^(\d+|-)\t(\d+|-)\t/); if (m) { files++; add += +m[1] || 0; del += +m[2] || 0; } }
      execFile('git', ['-C', dirp, 'ls-files', '--others', '--exclude-standard'], { timeout: 5000, maxBuffer: 1 << 20 }, (e2, o2) => {
        const fresh = e2 ? 0 : String(o2).split('\n').filter(Boolean).length;
        cb({ files: files + fresh, add, del, fresh });
      });
    });
  }
}

// The full change list (git diff) of a folder. cb gets { error } or { diff, cut, fresh }.
function gitDiff(dirp, cb) {
  execFile('git', ['-C', dirp, 'diff', '--no-color', '--stat', '-p', 'HEAD'], { timeout: 8000, maxBuffer: 4 << 20 }, (e, out) => {
    if (e) return cb({ error: /not a git repository/i.test(String(e.message)) ? 'This folder is not a git project, so there is no change list.' : 'git could not show the changes.' });
    execFile('git', ['-C', dirp, 'ls-files', '--others', '--exclude-standard'], { timeout: 5000 }, (e2, o2) => {
      const fresh = e2 ? [] : String(o2).split('\n').filter(Boolean);
      let text = String(out); const cut = text.length > 200e3; if (cut) text = text.slice(0, 200e3);
      cb({ diff: text, cut, fresh: fresh.slice(0, 100) });
    });
  });
}

module.exports = { gitChanges, gitDiff };
