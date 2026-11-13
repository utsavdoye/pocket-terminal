// The computer's clipboard, for copy and paste between the phone and the computer.
//   Mac: pbcopy / pbpaste.  Windows: PowerShell Set-Clipboard / Get-Clipboard.
//   Linux: wl-copy / wl-paste (Wayland), else xclip or xsel (X11).
// Text only, up to 100 KB.

const { spawn, execFile } = require('child_process');

const MAX = 100 * 1024;
const has = (bin) => new Promise((r) => execFile(process.platform === 'win32' ? 'where' : 'which', [bin], { timeout: 2000 }, (e) => r(!e)));

async function tools() {
  if (process.platform === 'darwin') return { get: ['pbpaste', []], set: ['pbcopy', []] };
  if (process.platform === 'win32') return {
    get: ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw']],
    set: ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$t=[Console]::In.ReadToEnd(); Set-Clipboard -Value $t']],
  };
  if (process.env.WAYLAND_DISPLAY && await has('wl-copy')) return { get: ['wl-paste', ['--no-newline']], set: ['wl-copy', []] };
  if (await has('xclip')) return { get: ['xclip', ['-selection', 'clipboard', '-o']], set: ['xclip', ['-selection', 'clipboard', '-i']] };
  if (await has('xsel')) return { get: ['xsel', ['--clipboard', '--output']], set: ['xsel', ['--clipboard', '--input']] };
  return null;
}
const NONE = 'This computer has no clipboard tool. On Linux install wl-clipboard (Wayland) or xclip.';

async function getClip() {
  const t = await tools(); if (!t) return { error: NONE };
  return new Promise((res) => execFile(t.get[0], t.get[1], { timeout: 5000, maxBuffer: 4 << 20, windowsHide: true }, (e, out) => {
    if (e && !out) return res({ error: 'Could not read the clipboard.' });
    let text = String(out || ''); const cut = text.length > MAX; if (cut) text = text.slice(0, MAX);
    res({ text, cut });
  }));
}

async function setClip(text) {
  text = String(text == null ? '' : text); if (text.length > MAX) return { error: 'Too long (100 KB at most).' };
  const t = await tools(); if (!t) return { error: NONE };
  return new Promise((res) => {
    let done = false; const end = (r) => { if (!done) { done = true; res(r); } };
    let p; try { p = spawn(t.set[0], t.set[1], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true }); } catch { return end({ error: 'Could not set the clipboard.' }); }
    const timer = setTimeout(() => { try { p.kill(); } catch {} end({ error: 'Could not set the clipboard.' }); }, 5000);
    p.on('error', () => { clearTimeout(timer); end({ error: 'Could not set the clipboard.' }); });
    // xclip / wl-copy stay running to serve the clipboard: done once they've read the text.
    p.stdin.on('finish', () => setTimeout(() => { clearTimeout(timer); end({ ok: true }); }, 150));
    p.on('exit', (code) => { clearTimeout(timer); end(code ? { error: 'Could not set the clipboard.' } : { ok: true }); });
    p.stdin.end(text);
    if (process.platform === 'linux') p.unref();
  });
}

module.exports = { getClip, setClip };
