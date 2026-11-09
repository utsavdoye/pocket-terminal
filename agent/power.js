// Power brain: decides when the computer stays awake and when it sleeps (macOS + Windows).
//
// The goal: lid closed but still reachable, using as little battery as possible.
//
//   On charger            → stay awake (lid closed is fine). Instant access. No battery used.
//   On battery, you're    → stay awake while your phone is connected, a queued job is
//   using it                running, or you typed something in the last few minutes.
//   On battery, idle      → really sleep. Set an alarm to wake up and check in (how often:
//                           lib/schedule.js), run queued jobs, sleep again.
//   Battery very low      → sleep and stop the alarms, so the battery never dies.
//
// The actual on/off switches live in platform/mac.js and platform/windows.js.

const DEFAULTS = {
  enabled: true,
  awakeOnCharger: true,   // on charger: always reachable, even with the lid closed
  batteryMode: 'saver',   // 'saver' = sleep when idle and check in; 'instant' = stay awake on battery too
  speed: 'smart',         // how often a sleeping Mac wakes to check for your phone: smart / fast / balanced / saver (lib/schedule.js)
  idleMinutes: 5,         // on battery: stay awake this long after your last keystroke
  minBattery: 20,         // below this %: never stay awake on battery
  stopAlarmsBelow: 10,    // below this %: stop waking up at all
};

const fs = require('fs');
const { planFor, nextWake, usualHours } = require('./lib/schedule');

class PowerBrain {
  // hooks: { log, onStatus(status), onWake() }
  // sys:   swap in fake commands for testing
  constructor(settings, hooks, sys = {}) {
    this.s = { ...DEFAULTS, ...(settings || {}) };
    this.hooks = hooks;
    this.sys = { ...require('./platform').sys(), now: () => Date.now(), ...sys };
    this.noSleep = null;        // what we last told pmset
    this.wantedByPhone = false; // a phone has the terminal open
    this.jobsRunning = 0;
    this.lastActivity = 0;
    this.wokeAt = this.sys.now();
    this.connected = false;
    this.alarm = null;          // Date of the wake alarm we set
    this.battery = { percent: null, onCharger: true, state: 'unknown' };
    this.lastTick = this.sys.now();
    this.sleeping = false;
    this.usageFile = hooks.usageFile || null; // which hours you use it, to wake more often then
    try { this.usage = this.usageFile ? JSON.parse(fs.readFileSync(this.usageFile, 'utf8')) : {}; } catch { this.usage = {}; }
  }

  // Remember the hour of day you used it (kept 14 days). Only when it changes, so it's cheap.
  noteUse() {
    const d = new Date(this.sys.now());
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hours = this.usage[day] || (this.usage[day] = []);
    if (hours.includes(d.getHours())) return;
    hours.push(d.getHours());
    for (const k of Object.keys(this.usage).sort().slice(0, -14)) delete this.usage[k];
    if (this.usageFile) fs.writeFile(this.usageFile, JSON.stringify(this.usage), { mode: 0o600 }, () => {});
  }

  // When it will wake up from now on (see lib/schedule.js). The phone gets this to count down.
  plan() {
    const b = this.battery, now = this.sys.now();
    return planFor({
      speed: this.s.speed, now,
      lastUse: Math.max(this.lastActivity, this.phoneLeft || 0, this.phoneSince || 0),
      lowBattery: b && b.percent !== null && !b.onCharger && b.percent < this.s.minBattery,
      usual: usualHours(this.usage, now),
      minEvery: this.sys.minWakeEvery || 20, // Windows says 60 (platform/windows.js)
    });
  }
  // Next wake-up, at least 5 s from now (pmset needs a moment; the Mac needs to fall asleep first).
  nextAlarm() { return new Date(nextWake(this.plan(), this.sys.now() + 5e3)); }

  update(settings) { this.s = { ...this.s, ...settings }; this.tick(); }
  activity() { this.lastActivity = this.sys.now(); this.noteUse(); }
  setPhoneWanting(v) {
    if (v && !this.wantedByPhone) { this.phoneSince = this.sys.now(); this.noteUse(); }
    if (!v && this.wantedByPhone) this.phoneLeft = this.sys.now();
    this.wantedByPhone = !!v; this.tick();
  }
  setJobs(n) { this.jobsRunning = n; this.tick(); }
  setBusy(n) { this.programsBusy = n; this.tick(); } // terminal programs still working (an AI agent, a build)
  setConnected(v) {
    this.connected = !!v;
    if (v) { this.firstContact = true; this.connectedAt = this.sys.now(); setTimeout(() => this.tick(), 5500); }
  }

  // How long between check-ins right now, in minutes (older phones show this).
  nextCheckInMinutes() { return this.plan()[0][2] / 60; }

  // Why the Mac must stay awake right now (empty list = it may sleep).
  reasons() {
    const s = this.s, b = this.battery, now = this.sys.now();
    if (!s.enabled) return ['power brain off'];
    if (b.onCharger) return s.awakeOnCharger ? ['on charger'] : [];
    const r = [];
    // After waking up: up to 60 s to get Wi-Fi and reach the board. Once connected,
    // 5 s is enough to receive any queued command. Nothing to do? Straight back to sleep.
    // With frequent check-ins (every 20 s) a check-in must be short, or it never really sleeps.
    const every = this.plan()[0][2] * 1000;
    const checking = this.firstContact ? now - (this.connectedAt || 0) < 3e3 : now - this.wokeAt < Math.max(20e3, Math.min(60e3, every));
    // Low battery: no staying awake for the phone or typing, but still do the short check-in,
    // otherwise waking up would be pointless (it would sleep before reading any command).
    if (b.percent !== null && b.percent < s.minBattery) return checking ? ['checking in'] : r;
    if (s.batteryMode === 'instant') r.push('instant mode');
    // A phone left open on a table shouldn't drain the battery forever:
    // it only counts for 15 minutes after it connected or you last typed.
    if (this.wantedByPhone && now - Math.max(this.phoneSince || 0, this.lastActivity) < 15 * 60e3) r.push('phone connected');
    if (this.jobsRunning > 0) r.push('job running');
    // …but not forever: a program that never stops printing (top, tail -f) stops counting 2 h after you last used it.
    if (this.programsBusy > 0 && now - Math.max(this.lastActivity, this.phoneLeft || 0, this.phoneSince || 0) < 2 * 3600e3) r.push('program running');
    if (now - this.lastActivity < s.idleMinutes * 60e3) r.push('recent typing');
    if (checking) r.push('checking in');
    return r;
  }

  status() {
    const r = this.reasons();
    return {
      percent: this.battery.percent, onCharger: this.battery.onCharger,
      mode: this.s.batteryMode, speed: this.s.speed, nextCheckInMinutes: this.nextCheckInMinutes(), plan: this.plan(),
      awake: r.length > 0, reasons: r,
      nextWake: this.alarm ? this.alarm.getTime() : null,
      settings: this.s,
    };
  }

  async tick() {
    if (this.busy || this.sleeping) return;
    this.busy = true;
    try {
      // A big gap between ticks means the Mac was asleep and just woke up.
      const now = this.sys.now();
      // Also after any sleep we started ourselves, however short: if the lid was opened again at
      // once (or sleep didn't happen), the agent must still reconnect, or it stays deaf to the phone.
      if (now - this.lastTick > 30e3 || this.wentToSleep) {
        // Woken by our own alarm with the lid still closed: a quiet check-in (nobody to tell).
        // Otherwise someone opened the lid or the phone is waiting: tell the phone it's up.
        const byAlarm = this.alarm && Math.abs(now - this.alarm.getTime()) < 20e3 && await this.sys.lidClosed();
        this.wentToSleep = false;
        this.wokeAt = now;
        // The connection may already be back (it can win the race against this tick).
        if (!(this.connected && now - (this.connectedAt || 0) < 10e3)) this.firstContact = false;
        this.hooks.log(byAlarm ? 'woke up to check in' : 'woke up'); this.hooks.onWake && this.hooks.onWake(byAlarm ? 'checkin' : 'user');
      }
      this.lastTick = now;

      this.battery = await this.sys.battery();
      const reasons = this.reasons();
      const stayAwake = reasons.length > 0;

      if (stayAwake !== this.noSleep) {
        await this.sys.setNoSleep(stayAwake);
        this.noSleep = stayAwake;
        this.hooks.log(stayAwake ? `staying awake (${reasons.join(', ')})` : 'allowed to sleep');
      }
      this.hooks.onStatus && this.hooks.onStatus(this.status());

      // macOS can fall asleep on its own (closing the lid on battery does it instantly), before
      // this brain gets a turn. So while sleep is allowed, always keep a wake-up alarm set ahead.
      await this.armAhead(stayAwake);

      // Idle on battery with the lid closed: set the alarm and go to sleep.
      if (!stayAwake && this.s.enabled && !this.battery.onCharger && await this.sys.lidClosed()) {
        await this.goToSleep();
      }
    } catch (e) {
      this.hooks.log('power error: ' + e.message);
    } finally {
      this.busy = false;
    }
  }

  async armAhead(stayAwake) {
    const b = this.battery, now = this.sys.now();
    const want = !stayAwake && this.s.enabled && !b.onCharger && (b.percent === null || b.percent >= this.s.stopAlarmsBelow);
    if (!want) {
      if (this.alarm && this.alarm.getTime() > now) { await this.sys.cancelWake(this.alarm); }
      this.alarm = null; return;
    }
    const at = this.nextAlarm();
    if (this.alarm && this.alarm.getTime() === at.getTime()) return; // already set (pmset is called only when it changes)
    if (this.alarm && this.alarm.getTime() > now) await this.sys.cancelWake(this.alarm);
    this.alarm = at;
    const r = await this.sys.scheduleWake(this.alarm);
    if (!r.ok) this.hooks.log('could not set wake alarm (sudo rule missing?): ' + String(r.err || '').trim());
  }

  async goToSleep() {
    const b = this.battery;
    if (this.alarm) { await this.sys.cancelWake(this.alarm); this.alarm = null; }
    if (b.percent === null || b.percent >= this.s.stopAlarmsBelow) {
      this.alarm = this.nextAlarm();
      const r = await this.sys.scheduleWake(this.alarm);
      if (!r.ok) this.hooks.log('could not set wake alarm (sudo rule missing?): ' + r.err.trim());
    } else {
      this.hooks.log(`battery ${b.percent}%: no more wake-ups until you charge`);
    }
    this.hooks.onStatus && this.hooks.onStatus(this.status());
    this.hooks.onSleep && await this.hooks.onSleep(this.status());
    this.hooks.log(`sleeping, next check-in ${this.alarm ? this.alarm.toLocaleTimeString() : 'none'}`);
    this.sleeping = true; this.wentToSleep = true;
    this.lastTick = this.sys.now();
    await this.sys.sleepNow();
    // sleepnow returns right away; the Mac falls asleep a moment later. Ticks resume on wake.
    setTimeout(() => { this.sleeping = false; }, 20e3);
  }

  start() {
    this.timer = setInterval(() => this.tick(), 3e3);
    // A cheap heartbeat (no commands run) to notice a wake-up within a second: a sleeping computer
    // freezes this program, so a beat that comes seconds late means it just woke up. Check in at
    // once instead of waiting for the next tick (with check-ins every 20 s, seconds matter).
    this.beat = Date.now();
    this.heart = setInterval(() => {
      const n = Date.now(), gap = n - this.beat; this.beat = n;
      if (gap > 4e3) { this.sleeping = false; this.tick(); }
    }, 1e3);
    this.tick();
  }

  // Put macOS back to normal when the agent stops.
  async stop() {
    clearInterval(this.timer); clearInterval(this.heart);
    if (this.noSleep) await this.sys.setNoSleep(false);
  }
}

const { parseBattery, pmsetDate } = require('./platform/mac');
module.exports = { PowerBrain, parseBattery, pmsetDate, DEFAULTS };
