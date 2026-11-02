// Linux laptop power controls (systemd distros: Ubuntu, Fedora, Debian, Arch…):
//   /sys/class/power_supply           battery level and charger state
//   /proc/acpi/button/lid/*/state     is the lid closed? (not every laptop has it)
//   systemd-inhibit                   "don't sleep, and ignore the lid" while it runs (no root needed)
//   rtcwake -m no -t <time>           alarm clock that wakes a sleeping laptop (sudo rule from install.sh)
//   systemctl suspend                 go to sleep right now
// Desktops and servers (no battery) don't need any of this: they simply stay awake.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const run = require('./run');

const PS = '/sys/class/power_supply';
const read = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return ''; } };

function readSupplies(root = PS) {
  let names = []; try { names = fs.readdirSync(root); } catch {}
  return names.map((n) => ({ name: n, type: read(path.join(root, n, 'type')), online: read(path.join(root, n, 'online')),
    capacity: read(path.join(root, n, 'capacity')), status: read(path.join(root, n, 'status')), scope: read(path.join(root, n, 'scope')) }));
}
function parseSupplies(list) {
  const bats = list.filter((s) => s.type === 'Battery' && s.scope !== 'Device'); // skip mice, headphones
  const mains = list.filter((s) => s.type === 'Mains' || s.type === 'USB' || s.type === 'USB_C');
  if (!bats.length) return { percent: null, onCharger: true, state: 'no battery' };
  const pct = Math.round(bats.reduce((a, b) => a + (Number(b.capacity) || 0), 0) / bats.length);
  const plugged = mains.some((m) => m.online === '1') || bats.every((b) => /^(Charging|Full|Not charging)$/i.test(b.status));
  return { percent: pct, onCharger: plugged, state: bats.map((b) => b.status).join(', ') || 'unknown' };
}
const hasBattery = () => parseSupplies(readSupplies()).percent !== null;

function lidClosed() {
  let dirs = []; try { dirs = fs.readdirSync('/proc/acpi/button/lid'); } catch { return false; }
  return dirs.some((d) => /closed/i.test(read(`/proc/acpi/button/lid/${d}/state`)));
}

const RTCWAKE = ['/usr/sbin/rtcwake', '/sbin/rtcwake', '/usr/bin/rtcwake'].find((p) => fs.existsSync(p)) || 'rtcwake';
let holder = null;
const sys = {
  name: 'Linux',
  battery: async () => parseSupplies(readSupplies()),
  lidClosed: async () => lidClosed(),
  setNoSleep: async (on) => {
    if (on && !holder) {
      holder = spawn('systemd-inhibit', ['--what=sleep:idle:handle-lid-switch', '--who=Pocket Terminal', '--why=Your phone may need this computer', '--mode=block', 'sleep', 'infinity'], { stdio: 'ignore' });
      holder.on('error', () => { holder = null; });
      holder.on('exit', () => { holder = null; });
    } else if (!on && holder) { holder.kill(); holder = null; }
    return { ok: true, out: '', err: '' };
  },
  scheduleWake: async (date) => run('sudo', ['-n', RTCWAKE, '-m', 'no', '-t', String(Math.floor(date.getTime() / 1000))]),
  cancelWake: async () => run('sudo', ['-n', RTCWAKE, '-m', 'disable']),
  sleepNow: async () => run('systemctl', ['suspend']),
};
process.on('exit', () => { if (holder) holder.kill(); });

module.exports = { sys, parseSupplies, readSupplies, hasBattery, RTCWAKE };
