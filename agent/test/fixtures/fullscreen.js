// A pretend full-screen program (like Claude Code's fullscreen mode): alternate screen + mouse,
// draws the whole screen once and on every resize, otherwise only what changed.
const out = (s) => process.stdout.write(s);
const full = () => { out('\x1b[H\x1b[2J'); for (let i = 1; i <= 5; i++) out(`\x1b[${i};1HLINE-${i} of the whole screen`); };
out('\x1b[?1049h\x1b[?1000h\x1b[?1006h'); full();
let n = 0; const t = setInterval(() => { out(`\x1b[6;1Hcounter ${n++}`); if (n > 400) clearInterval(t); }, 10); // lots of small changes
process.on('SIGWINCH', full);
process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', (d) => { if (String(d) === 'q') { out('\x1b[?1000l\x1b[?1006l\x1b[?1049l'); process.exit(0); } });
