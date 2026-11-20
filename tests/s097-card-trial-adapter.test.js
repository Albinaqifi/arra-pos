const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomInt } = require('node:crypto');
const { cardTrialLedger, deviceTrial } = require('../src/desktop/pf700-commissioning');
const { createWindowsPf700Checkout } = require('../src/desktop/pf700-windows-checkout');
const { createStatefulPf700 } = require('./support/pf700-stateful-device');

const serial = 'SYNTHETIC01';
function markerFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-card-claim-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, claim: cardTrialLedger(root), token: randomBytes(16).toString('hex') };
}

test('the attended terminal invitation, outcome and dispatch each survive a database-only restore', t => {
  const { root, claim, token } = markerFixture(t);
  const restored = cardTrialLedger(root);
  assert.equal(claim.read(), null);
  claim.claim(serial, token);
  assert.equal(restored.read().outcome, null);
  assert.throws(() => restored.claim(serial, token));
  assert.throws(() => restored.dispatch(serial, token));
  assert.throws(() => restored.outcome('SYNTHETIC02', token, 'approved'));
  assert.throws(() => restored.outcome(serial, randomBytes(16).toString('hex'), 'approved'));
  claim.outcome(serial, token, 'approved');
  assert.throws(() => restored.outcome(serial, token, 'declined'));
  restored.dispatch(serial, token);
  assert.throws(() => claim.dispatch(serial, token));
  assert.deepEqual(restored.read(), {...claim.read(), token, outcome:'approved', dispatched:true});
  assert.ok(deviceTrial(serial, root).available());
});

test('declined and truncated card claims never grant a fiscal dispatch', t => {
  const { root, claim, token } = markerFixture(t);
  claim.claim(serial, token);
  claim.outcome(serial, token, 'declined');
  assert.equal(claim.read().outcome, 'declined');
  assert.throws(() => claim.dispatch(serial, token));
  fs.writeFileSync(path.join(root, 'Arra POS', 'PF700 commissioning', 'supervised-card.claim'), '');
  assert.throws(() => claim.read());
  assert.throws(() => claim.claim(serial, token));
});

const sale = {billId:5, currency:'MKD', account:'A', method:'card', total:140, domesticProduct:false,
  lines:[{name:'Espresso', quantity:2, unitPrice:70, taxGroup:'В', taxRate:10, domesticProduct:true}]};
async function register(device, trial) {
  const adapter = createWindowsPf700Checkout({expectedSerial:serial, operatorNumber:1, tillNumber:1,
    operatorPassword:String(randomInt(100000,1000000)), domesticProduct:false, supervisedCardTrial:trial}, device.start);
  return adapter.registerSale(sale, {beforeOpen() {}});
}
test('supervised device accepts one card receipt only when the debit register advances by the bill amount', {
  skip: process.platform !== 'win32'
}, async () => {
  const blocked = createStatefulPf700();
  assert.equal((await register(blocked, false)).status, 'failed');
  assert.deepEqual(blocked.transcript, []);
  for (const debitRegister of [2, 0, 1, 3]) {
    const device = createStatefulPf700({debitRegister});
    const result = await register(device, true);
    assert.equal(result.status, debitRegister === 2 ? 'accepted' : 'uncertain');
    if (debitRegister === 2) {
      assert.equal(result.reference, '0000002');
      assert.equal(result.evidence.debitAmountMinor, sale.total * 100);
    }
    assert.deepEqual(device.transcript.filter(x => [110,48,53,56].includes(x.command)).map(x => x.command),
      [110,48,53,56,110]);
    assert.equal(device.state.tenders, 1);
    assert.equal(device.state.closes, 1);
  }
});

test('a missing first or final tender register reply blocks local confirmation', {skip:process.platform !== 'win32'}, async () => {
  for (const occurrence of [1,2]) {
    const device = createStatefulPf700();
    device.fault(110, 'after', occurrence);
    assert.equal((await register(device,true)).status, occurrence === 1 ? 'failed' : 'uncertain');
    assert.equal(device.state.tenders, occurrence - 1);
    assert.equal(device.state.closes, occurrence - 1);
  }
});

test('inconsistent tender-register and fiscal receipt counters stop before items or tender', {skip:process.platform !== 'win32'}, async () => {
  const device = createStatefulPf700({receiptCountOffset:14});
  assert.equal((await register(device,true)).status, 'uncertain');
  assert.equal(device.state.open, true);
  assert.equal(device.state.items, 0);
  assert.equal(device.state.tenders, 0);
  assert.equal(device.state.closes, 0);
});
