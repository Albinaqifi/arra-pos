const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { enroll, isCommissionedDirectory, deviceTrial } = require('../src/desktop/pf700-commissioning');
const { selectPf700Checkout } = require('../src/desktop/pf700-checkout-mode');

const live = ['--pf700-supervised-checkout'];
const training = dir => ['--sample-data-directory=' + dir, '--pf700-offline-checkout'];
const serial = 'SYNTHETIC01';
const root = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-pf700-profile-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
};

test('the launcher requires the commissioned database even after backup or loss of its sidecars', t => {
  const dir = root(t), copy = root(t);
  const file = path.join(dir, 'arra.sqlite');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE sample(id INTEGER)');
  db.close();
  const privateSettings = () => assert.fail('unexpected credential read');
  assert.equal(selectPf700Checkout([], dir, privateSettings), null);
  assert.equal(selectPf700Checkout(training(dir), dir, privateSettings).mode, 'simulation');
  assert.throws(() => selectPf700Checkout(live, dir, privateSettings), /dedicated|requires/);
  assert.throws(() => selectPf700Checkout([...live, ...training(dir)], dir, privateSettings), /one PF700/);
  assert.throws(() => selectPf700Checkout(['--pf700-offline-checkout'], dir, privateSettings));
  const fresh = new DatabaseSync(file);
  try { enroll(fresh); } finally { fresh.close(); }
  fs.copyFileSync(file, path.join(copy, 'arra.sqlite'));
  assert.ok(isCommissionedDirectory(copy));
  fs.writeFileSync(path.join(copy, 'SAMPLE-DATA-ONLY'), '');
  assert.throws(() => selectPf700Checkout(training(copy), copy, privateSettings), /training/);
  assert.throws(() => selectPf700Checkout(live, copy, privateSettings), /dedicated|requires/);
});

test('two sessions and a restored database share one durable device trial', { skip: process.platform !== 'win32' }, t => {
  const dir = root(t), copy = root(t), local = root(t);
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = local;
  t.after(() => { if (previous === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = previous; });
  const db = new DatabaseSync(path.join(dir, 'arra.sqlite'));
  try { enroll(db); } finally { db.close(); }
  fs.copyFileSync(path.join(dir, 'arra.sqlite'), path.join(copy, 'arra.sqlite'));
  const construct = dataDirectory => selectPf700Checkout(live, dataDirectory,
    () => ({ expectedSerial: serial, dataDirectory, domesticProduct: false }),
    config => ({ mode: 'device', claim: config.beforeOpen }));
  const first = construct(dir), second = construct(copy);
  const receipt = { method: 'cash', account: 'A', lines: [{ quantity: 1 }] };
  assert.ok(first.canRegister(receipt));
  assert.equal(first.canRegister({ ...receipt, method: 'card' }), false);
  assert.equal(first.canRegister({ ...receipt, lines: [{ quantity: 2 }] }), false);
  first.claim();
  assert.equal(second.canRegister(receipt), false);
  assert.throws(() => second.claim(), { code: 'EEXIST' });
  assert.equal(construct(copy).canRegister(receipt), false);
  assert.equal(deviceTrial(serial).available(), false);
});

test('only the dedicated supervised card mode exposes the one terminal trial', { skip: process.platform !== 'win32' }, t => {
  const roaming = root(t), local = root(t), dir = path.join(roaming, 'Arra POS PF700 Commissioning');
  fs.mkdirSync(dir);
  const previous = process.env.LOCALAPPDATA, previousRoaming = process.env.APPDATA;
  process.env.LOCALAPPDATA = local;
  process.env.APPDATA = roaming;
  t.after(() => {
    if (previous === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = previous;
    if (previousRoaming === undefined) delete process.env.APPDATA; else process.env.APPDATA = previousRoaming;
  });
  const db = new DatabaseSync(path.join(dir, 'arra.sqlite'));
  try { enroll(db); } finally { db.close(); }
  const select = (mode, directory = dir) => selectPf700Checkout([mode], directory, () => ({
    expectedSerial:serial, dataDirectory:directory, domesticProduct:false
  }), config => ({mode:'device', deviceId:config.expectedSerial}));
  assert.throws(() => select('--pf700-supervised-card-trial'), /original commissioned/);
  deviceTrial(serial, local).claim();
  const copy = root(t);
  fs.copyFileSync(path.join(dir,'arra.sqlite'),path.join(copy,'arra.sqlite'));
  assert.throws(() => select('--pf700-supervised-card-trial', copy), /original commissioned/);
  const cash = select(live[0]), routine = select('--pf700-routine-checkout'), card = select('--pf700-supervised-card-trial');
  const receipt = {method:'card', account:'A', lines:[{quantity:1,domesticProduct:true}]};
  for (const ordinary of [cash, routine]) {
    assert.equal(ordinary.supervisedCardTrial, undefined);
    assert.equal(ordinary.canRegister(receipt), false);
  }
  assert.ok(card.canRegister(receipt));
  assert.equal(card.canRegister({...receipt, method:'cash'}), false);
  assert.equal(card.canRegister({...receipt, lines:[{quantity:1}]}), false);
  const token = require('node:crypto').randomBytes(16).toString('hex');
  assert.ok(card.cardTrialAvailable());
  card.claimCardTrial(token);
  assert.equal(card.cardTrialAvailable(), false);
  assert.equal(card.cardDispatchAvailable(token), false);
  card.recordCardOutcome(token, 'approved');
  const next = select('--pf700-supervised-card-trial');
  assert.ok(next.cardDispatchAvailable(token));
  next.claimCardDispatch(token);
  assert.equal(card.cardDispatchAvailable(token), false);
  assert.equal(routine.readCardTrial().dispatched, true);
});
