// When a sleeping computer checks in: node test/schedule.test.js
const assert = require('assert');
const { planFor, nextWake, usualHours } = require('../lib/schedule');

const H = 3600e3;
const base = new Date(2026, 10, 8, 10, 0, 0).getTime(); // 10:00 local
const day = new Date(base); const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Grid: every 20 s lands on :00 :20 :40
let p = planFor({ speed: 'fast', now: base + 7e3 });
assert.strictEqual(nextWake(p, base + 7e3), base + 20e3);
assert.strictEqual(nextWake(p, base + 20e3), base + 20e3);
console.log('✓ wake-ups fall on the clock grid (so the phone can predict them)');

// Smart, just used: 20 s for 30 min, then 1 min until 2.5 h, then by the hour
p = planFor({ speed: 'smart', now: base, lastUse: base, usual: Array(24).fill(true) });
assert.deepStrictEqual(p.slice(0, 2).map((x) => x[2]), [20, 60]);
assert.strictEqual(nextWake(p, base + 29 * 60e3 + 50e3), base + 30 * 60e3); // last 20 s wake-up ends at the boundary
assert.strictEqual(nextWake(p, base + 30 * 60e3 + 1e3), base + 31 * 60e3); // then every minute
assert.strictEqual(p[p.length - 1][1], null);
console.log('✓ smart: every 20 s for 30 min after use, then every minute');

// Night hours (not usual): every 3 min
const usual = Array.from({ length: 24 }, (_, h) => h >= 8);
const night = new Date(2026, 10, 9, 2, 0, 5).getTime();
p = planFor({ speed: 'smart', now: night, lastUse: base, usual });
assert.strictEqual(p[0][2], 180);
assert.strictEqual(nextWake(p, night) % (180e3), 0);
const morning = new Date(2026, 10, 9, 8, 0, 0).getTime();
assert.strictEqual(nextWake(p, morning + 1e3) - morning, 60e3); // usual hours: every minute again
console.log('✓ smart: every 3 min at night, every minute in your usual hours');

// Low battery beats everything
p = planFor({ speed: 'fast', now: base, lastUse: base, lowBattery: true });
assert.deepStrictEqual(p, [[base, null, 300]]);
console.log('✓ low battery: every 5 min');

// Learning your hours: used at 23:00 on 2 different days → 23:00 is usual; 3:00 once → not
const usage = {};
for (let i = 1; i <= 4; i++) { const d = new Date(base - i * 24 * H); usage[iso(d)] = i <= 2 ? [23, 3].slice(0, i === 1 ? 2 : 1) : [10]; }
const u = usualHours(usage, base);
assert.strictEqual(u[23], true); assert.strictEqual(u[3], false); assert.strictEqual(u[10], true); assert.strictEqual(u[15], false);
assert.strictEqual(usualHours({}, base)[15], true); // too little data: 8:00 to midnight
console.log('✓ learns the hours you use it (2 days in 14), defaults to 8:00–midnight');
console.log('\nAll schedule tests passed.');
