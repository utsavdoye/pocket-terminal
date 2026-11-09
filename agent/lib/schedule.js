// When a sleeping computer wakes up to check for your phone ("check-ins").
//
// Speeds (Power settings on the phone):
//   smart     every 20 s for 30 min after you last used it, then every 1 min for 2 h, then every
//             1 min in the hours you usually use it and every 3 min otherwise (nights)
//   fast      every 20 s
//   balanced  every 1 min
//   saver     every 3 min
// Battery under the floor (20%): every 5 min, whatever the speed.
//
// Wake-ups fall on a fixed grid of the clock (every 20 s = :00, :20, :40), so the phone can work
// out exactly when the next one is from a short plan, without the computer posting each wake-up:
// the plan is a list of [start, end, every seconds] pieces (end null = from then on).

const SPEEDS = { fast: 20, balanced: 60, saver: 180 };
const LOW_BATTERY = 300;
const HOUR = 3600e3;

// Which hours of the day (0-23, this computer's clock) you usually use it. Learned from the last
// 14 days: an hour counts once you used it in that hour on 2 different days. Until there are 3 days
// to go on: 8 in the morning to midnight.
function usualHours(usage, now) {
  const days = Object.keys(usage || {}).filter((d) => now - Date.parse(d + 'T12:00:00') < 15 * 24 * HOUR);
  if (days.length < 3) return Array.from({ length: 24 }, (_, h) => h >= 8);
  const count = Array(24).fill(0);
  for (const d of days) for (const h of usage[d] || []) if (h >= 0 && h < 24) count[h]++;
  return count.map((c) => c >= 2);
}

// The plan from now on (about a day of pieces, then the last one carries on).
// minEvery: the shortest gap this computer can do (Windows sets wake alarms through Task
// Scheduler, which is too heavy to run every 20 s, so there it's 60 s).
function planFor({ speed = 'smart', now, lastUse = 0, lowBattery = false, usual, minEvery = 20 }) {
  if (lowBattery) return [[now, null, LOW_BATTERY]];
  if (SPEEDS[speed]) return [[now, null, Math.max(minEvery, SPEEDS[speed])]];
  const out = [];
  const add = (start, end, every) => {
    if (end !== null && end <= start) return;
    const p = out[out.length - 1];
    if (p && p[2] === every && p[1] === start) p[1] = end; else out.push([start, end, every]);
  };
  const fastEnd = lastUse + 30 * 60e3, minuteEnd = lastUse + 150 * 60e3;
  if (now < fastEnd) add(now, fastEnd, Math.max(minEvery, 20));
  if (now < minuteEnd) add(Math.max(now, fastEnd), minuteEnd, 60);
  let t = Math.max(now, minuteEnd);
  const u = usual || usualHours({}, now);
  for (let i = 0; i < 26; i++) {
    const h = new Date(t); const next = new Date(h.getFullYear(), h.getMonth(), h.getDate(), h.getHours() + 1).getTime();
    add(t, next, u[h.getHours()] ? 60 : 180);
    t = next;
  }
  out[out.length - 1][1] = null; // and so on
  return out;
}

// The first wake-up on the plan's grid at or after time t.
function nextWake(plan, t) {
  for (const [start, end, every] of plan) {
    if (end !== null && end <= t) continue;
    const e = every * 1000, from = Math.max(start, t);
    const c = Math.ceil(from / e) * e;
    if (end === null || c < end) return c;
  }
  return null;
}

module.exports = { SPEEDS, planFor, nextWake, usualHours };
