// Typing ahead on a slow link (docs/app/js/terminal/predict-core.js): letters show at once only
// when it's safe, are confirmed by the computer's echo, and are never shown for a password.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app', 'js', 'terminal', 'predict-core.js'), 'utf8').replace(/^export /gm, '');
const { Predictor } = new Function(src + '\nreturn { Predictor };')();
const ok = (name, v) => { console.log((v ? '✓ ' : '✗ ') + name); if (!v) process.exitCode = 1; };

// A pretend terminal line: what the computer has drawn, and where its cursor is.
function screen(cols = 40) {
  const s = { line: '$ ', x: 2, y: 5, cols, alt: false, atBottom: true };
  s.snap = () => ({ x: s.x, y: s.y, cols: s.cols, alt: s.alt, atBottom: s.atBottom, char: (x) => s.line[x] || ' ' });
  s.echo = (t) => { s.line = s.line.slice(0, s.x) + t + s.line.slice(s.x + t.length); s.x += t.length; };
  return s;
}
const RTT = 200;
let now = 1000;

{ // a normal shell line
  const p = new Predictor(), s = screen();
  p.typed('g', s.snap(), now, RTT);
  ok('the first letter of a line is not shown ahead (nothing echoed yet)', p.view === null);
  p.typed('i', s.snap(), now += 30, RTT);
  s.echo('g'); p.output(s.snap(), now += 170, RTT);
  ok('once the computer echoes one letter, the rest show at once', p.view && p.view.text === 'i' && p.view.x === 3 && p.view.y === 5);
  p.typed('t', s.snap(), now += 20, RTT);
  ok('more typing joins it', p.view.text === 'it');
  s.echo('i'); p.output(s.snap(), now += 100, RTT);
  ok('each echoed letter leaves the dim copy', p.view.text === 't' && p.view.x === 4);
  p.typed('\x7f', s.snap(), now += 10, RTT);
  ok('backspace takes back a letter that is still on its way', p.view === null && p.pend === '');
}
{ // a password prompt never echoes
  const p = new Predictor(), s = screen(); s.line = 'Password: '; s.x = 10;
  for (const ch of 'hunter2') { p.typed(ch, s.snap(), now += 40, RTT); p.tick(now, RTT); }
  ok('a password is never shown (no echo, no trust)', p.view === null);
  p.tick(now += 1500, RTT);
  ok('and typing ahead stays off until Enter', p.off === true && p.pend === '');
  p.typed('\r', s.snap(), now += 10, RTT);
  ok('Enter starts over', p.off === false);
}
{ // a prompt that appears without Enter (a program asks for a password after one key)
  const p = new Predictor(), s = screen();
  p.typed('y', s.snap(), now += 1000, RTT); s.echo('y'); p.output(s.snap(), now += 200, RTT);
  s.line = 'Password: '; s.x = 10; p.output(s.snap(), now += 300, RTT); // the program printed its prompt
  p.typed('h', s.snap(), now += 500, RTT);
  ok('trust ends when the computer prints something new: the next letter is not shown', p.view === null);
}
{ // the computer shows something else than predicted
  const p = new Predictor(), s = screen();
  p.typed('a', s.snap(), now += 1000, RTT); s.echo('a'); p.output(s.snap(), now += 200, RTT);
  p.typed('b', s.snap(), now += 400, RTT);
  ok('trusted line: next letter shows ahead', p.view && p.view.text === 'b');
  s.echo('X'); p.output(s.snap(), now += 200, RTT);
  ok('a different echo clears it and turns it off for this line', p.view === null && p.off === true);
}
{ // keys that are not plain letters, full-screen programs, the end of the line
  const p = new Predictor(), s = screen();
  p.typed('a', s.snap(), now += 1000, RTT); s.echo('a'); p.output(s.snap(), now += 200, RTT);
  p.typed('\x1b[D', s.snap(), now += 400, RTT); // left arrow
  p.typed('b', s.snap(), now += 50, RTT);
  ok('right after an arrow key nothing is predicted (its effect is still on its way)', p.view === null && p.pend === '');
  p.typed('c', s.snap(), now += 1000, RTT);
  ok('a moment later it predicts again', p.view && p.view.text === 'c');
  s.alt = true; p.output(s.snap(), now += 100, RTT);
  ok('a full-screen program (vim, less) clears it', p.view === null);
  const q = new Predictor(), n = screen(6); n.line = '$ abc'; n.x = 5;
  q.typed('d', n.snap(), now += 1000, RTT);
  ok('nothing is predicted across the end of the line', q.pend === '');
  const w = new Predictor(), v = screen(); v.atBottom = false;
  w.typed('a', v.snap(), now += 1000, RTT);
  ok('nor while scrolled back', w.pend === '');
}
{ // output from a running program moves the cursor to another line
  const p = new Predictor(), s = screen();
  p.typed('a', s.snap(), now += 1000, RTT); s.echo('a'); p.output(s.snap(), now += 200, RTT);
  p.typed('b', s.snap(), now += 400, RTT);
  s.y = 6; s.x = 0; p.output(s.snap(), now += 50, RTT);
  ok('the cursor moving to another line clears it', p.view === null);
}
