// Seconds since the keyboard or mouse of this computer was last used (null if we can't tell).
// Used to decide whether a question should go to your phone (you're away) or stay on screen.
const { execFile } = require('child_process');

function idleSeconds() {
  return new Promise((resolve) => {
    const done = (v) => resolve(Number.isFinite(v) && v >= 0 ? v : null);
    if (process.env.POCKET_IDLE_SECONDS) return done(Number(process.env.POCKET_IDLE_SECONDS)); // tests
    if (process.platform === 'darwin') {
      return execFile('ioreg', ['-c', 'IOHIDSystem', '-d', '4'], { timeout: 3000, maxBuffer: 4 << 20 }, (e, out) => {
        const m = !e && String(out).match(/"HIDIdleTime"\s*=\s*(\d+)/);
        done(m ? Number(m[1]) / 1e9 : null);
      });
    }
    if (process.platform === 'win32') {
      const ps = 'Add-Type @"\nusing System;using System.Runtime.InteropServices;public static class I{[StructLayout(LayoutKind.Sequential)]public struct L{public uint s;public uint t;}[DllImport("user32.dll")]public static extern bool GetLastInputInfo(ref L l);public static uint Get(){L l=new L();l.s=8;GetLastInputInfo(ref l);return ((uint)Environment.TickCount-l.t)/1000;}}\n"@\n[I]::Get()';
      return execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 6000, windowsHide: true }, (e, out) => done(e ? null : Number(String(out).trim())));
    }
    execFile('xprintidle', [], { timeout: 2000 }, (e, out) => done(e ? null : Number(String(out).trim()) / 1000)); // Linux desktops, if installed
  });
}

module.exports = { idleSeconds };
