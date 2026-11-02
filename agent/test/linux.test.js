// Linux power parsing, with real-looking /sys/class/power_supply contents: node test/linux.test.js
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { parseSupplies, readSupplies } = require('../platform/linux');

const laptop = (bat, ac) => [{ name: 'BAT0', type: 'Battery', capacity: String(bat.c), status: bat.s, online: '', scope: '' },
  { name: 'AC', type: 'Mains', online: ac ? '1' : '0', capacity: '', status: '', scope: '' }];
assert.deepStrictEqual(parseSupplies(laptop({ c: 64, s: 'Discharging' }, false)), { percent: 64, onCharger: false, state: 'Discharging' });
assert.strictEqual(parseSupplies(laptop({ c: 80, s: 'Charging' }, true)).onCharger, true);
assert.strictEqual(parseSupplies(laptop({ c: 100, s: 'Full' }, false)).onCharger, true); // full and plugged in, AC node missing
assert.strictEqual(parseSupplies(laptop({ c: 80, s: 'Not charging' }, true)).onCharger, true); // charge limit reached
// two batteries (ThinkPads): average
assert.strictEqual(parseSupplies([...laptop({ c: 40, s: 'Discharging' }, false), { name: 'BAT1', type: 'Battery', capacity: '60', status: 'Discharging', scope: '' }]).percent, 50);
// a wireless mouse battery is not the laptop's
assert.deepStrictEqual(parseSupplies([{ name: 'hidpp_battery_0', type: 'Battery', capacity: '30', status: 'Discharging', scope: 'Device' }]), { percent: null, onCharger: true, state: 'no battery' });
assert.strictEqual(parseSupplies([]).onCharger, true); // desktop / server
console.log('✓ battery parsing (laptop, charging, full, charge limit, two batteries, mouse battery, desktop)');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-ps-'));
fs.mkdirSync(path.join(root, 'BAT0')); fs.writeFileSync(path.join(root, 'BAT0', 'type'), 'Battery\n');
fs.writeFileSync(path.join(root, 'BAT0', 'capacity'), '71\n'); fs.writeFileSync(path.join(root, 'BAT0', 'status'), 'Discharging\n');
assert.strictEqual(parseSupplies(readSupplies(root)).percent, 71);
fs.rmSync(root, { recursive: true });
console.log('✓ reads the /sys files');
console.log('\nAll Linux tests passed.');
