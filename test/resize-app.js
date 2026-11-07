// Test helper: a tiny full-screen app. Draws a line as wide as the terminal, and redraws itself
// (clear + draw) whenever the terminal is resized, like Claude Code, vim or htop do.
const draw = (tag) => process.stdout.write(`\x1b[2J\x1b[H${tag}-${process.stdout.columns} ${'='.repeat(Math.max(0, process.stdout.columns - 12))}\r\n`);
draw('START');
process.stdout.on('resize', () => draw('REDRAWN'));
process.stdin.setRawMode && process.stdin.setRawMode(true); process.stdin.resume();
process.stdin.on('data', (d) => { if (String(d).includes('q')) process.exit(0); });
