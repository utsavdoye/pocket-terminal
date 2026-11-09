// When a sleeping computer next wakes up to check for this phone, from the plan it posted before
// sleeping: [start, end, every seconds] pieces (end null = from then on), wake-ups on the clock's
// grid (every 20 s = :00, :20, :40). Same rule as agent/lib/schedule.js on the computer.
export function nextWake(plan, t) {
  if (!Array.isArray(plan)) return null;
  for (const [start, end, every] of plan) {
    if (end !== null && end <= t) continue;
    const e = every * 1000, c = Math.ceil(Math.max(start, t) / e) * e;
    if (end === null || c < end) return c;
  }
  return null;
}
