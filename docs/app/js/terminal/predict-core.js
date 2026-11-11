// Typing ahead on a slow link ("local echo"), the thinking part. No page, no terminal: just
// what was typed and where the cursor is, so it can be tested on its own (test/predict.test.js).
//
// On weak mobile data every letter waits a round trip before it shows. So letters you type are
// drawn at once, dimmed, where the computer is about to put them; when the computer's own echo
// arrives they are checked against it and the dim copy goes away.
//
// It must never show something the computer would not:
//   - Nothing is drawn until the computer has echoed one typed letter ("trust"), and that trust
//     ends at Enter and whenever the computer prints anything that isn't your typing coming
//     back. A password prompt never echoes, so a password is never drawn.
//   - A letter that isn't echoed where expected, or not in time, clears everything and turns
//     typing ahead off until the next Enter.
//   - Only plain letters are predicted. Arrows, Tab, Ctrl keys and pastes with line breaks are
//     left to the computer, and predictions pause for a moment after them.
//
// snap (what the terminal shows now): { x, y, cols, alt, atBottom, char(x, y) }.

const PLAIN = /^[\x20-\x7e]{1,40}$/;

export class Predictor {
  constructor() { this.clear(); this.off = false; this.blindUntil = 0; }
  clear() { this.pend = ''; this.x0 = 0; this.y0 = 0; this.trust = false; this.since = 0; }
  // What to draw: null, or { x, y, text }.
  get view() { return this.trust && this.pend ? { x: this.x0, y: this.y0, text: this.pend } : null; }
  wait(rtt) { return Math.max(300, 2 * (rtt || 0)); }

  // The user typed d. rtt: the link's round trip in ms (null if unknown).
  typed(d, snap, now, rtt) {
    if (d === '\r' || d === '\n') { this.clear(); this.off = false; this.blindUntil = now + this.wait(rtt); return; }
    if (d === '\x7f' && this.pend) { this.pend = this.pend.slice(0, -1); this.blindUntil = now + this.wait(rtt); return; }
    if (!PLAIN.test(d)) { this.pend = ''; this.blindUntil = now + this.wait(rtt); return; } // a key we don't predict: its effect is the computer's to show
    if (this.off || snap.alt || !snap.atBottom) { this.pend = ''; return; }
    if (!this.pend) {
      if (now < this.blindUntil) { this.blindUntil = now + this.wait(rtt); return; } // echoes we aren't tracking are still on their way
      this.x0 = snap.x; this.y0 = snap.y; this.since = now;
    }
    if (this.x0 + this.pend.length + d.length >= snap.cols) { // would wrap to the next line: stop here
      if (!this.pend) this.blindUntil = now + this.wait(rtt);
      else this.fail(now, rtt);
      return;
    }
    this.pend += d;
  }

  // The computer sent something and the terminal has drawn it.
  output(snap, now, rtt) {
    if (!this.pend) { this.trust = false; return; } // something we didn't type for (a new prompt, a program's output): earn trust again
    if (snap.alt || snap.y !== this.y0 || snap.x < this.x0) return this.fail(now, rtt);
    const n = Math.min(snap.x - this.x0, this.pend.length);
    for (let i = 0; i < n; i++) if (snap.char(this.x0 + i, this.y0) !== this.pend[i]) return this.fail(now, rtt);
    if (n) { this.pend = this.pend.slice(n); this.x0 += n; this.trust = true; this.since = now; }
  }

  // Called now and then: a letter nobody echoed (a password prompt, a program that reads keys
  // without showing them) is given up on.
  tick(now, rtt) { if (this.pend && now - this.since > Math.max(1200, 4 * (rtt || 0))) this.fail(now, rtt); }

  fail(now, rtt) { this.clear(); this.off = true; this.blindUntil = now + this.wait(rtt); }
}
