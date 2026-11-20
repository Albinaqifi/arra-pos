// Run on Windows with the extracted RC2 or Fast Pay kit root as argument.
// The real serial adapter is exercised with an in-memory child process.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomInt } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { createStatefulPf700 } = require('./support/pf700-stateful-device');

const desktop = path.resolve(process.argv[2], 'program/resources/app/src/desktop');
const installed = path.join(desktop, 'fast-pay-device.js');
const { createFastPrinter } = fs.existsSync(installed) ? require(installed) : require('../scripts/fast-pay/device');
const { createWindowsPf700Checkout } = require(path.join(desktop, 'pf700-windows-checkout'));

function fixture(method, { enrolled = true, expectedSerial, ...deviceOptions } = {}) {
  const fake = createStatefulPf700({ ...deviceOptions, method });
  const operations = [], commands = [], acknowledgements = [], baselines = [];
  const printer = createFastPrinter({
    expectedSerial: expectedSerial || fake.serial, operatorNumber: 2, tillNumber: 1, domesticProduct: false,
    operatorPassword: String(randomInt(100000, 1000000))
  }, profile => createWindowsPf700Checkout(profile, (_exe, args, _opts) => {
    const index = args.indexOf('-Operation');
    operations.push(index === -1 ? 'Checkout' : args[index + 1]);
    return fake.start();
  }), enrolled);
  const receipt = { billId: 1, account: 'A', method, currency: 'MKD', total: 75, domesticProduct: false, lines: [
    { name: 'Sample tea', unitPrice: 20, quantity: 2, taxGroup: 'В', taxRate: 10, domesticProduct: false },
    { name: 'Sample item', unitPrice: 35, quantity: 1, taxGroup: 'А', taxRate: 18, domesticProduct: true }
  ] };
  const journal = {
    beforeOpen(baseline) { baselines.push(baseline); },
    beforeCommand({ command }) { return commands.push(command); },
    afterCommand({ id }) { acknowledgements.push(id); }
  };
  return { fake, operations, commands, acknowledgements, baselines, printer, receipt, journal };
}

for (const method of ['cash', 'card']) {
  test(method + ' validates the native tender, close, document and matching command acknowledgements', async () => {
    const f = fixture(method);
    const result = await f.printer.registerSale(f.receipt, f.journal);
    assert.deepEqual(f.operations, [method === 'card' ? 'CardTrial' : 'Checkout']);
    assert.deepEqual(result, { status: 'accepted', reference: '0000002', evidence: {
      documentNumber: '0000002', fiscalReceiptCount: 1, reversalCount: 0,
      ...(method === 'card' ? { debitAmountMinor: 7500 } : {})
    } });
    assert.deepEqual(f.baselines, [{ previousDocumentNumber: '0000001' }]);
    const register = method === 'card' ? [110] : [];
    assert.deepEqual(f.commands, [90,74,76,97,113,...register,48,49,49,76,103,53,76,56,76,113,...register]);
    assert.deepEqual(f.acknowledgements, f.commands.map((_, i) => i + 1));
    assert.equal(f.fake.state.tenders, 1);
    assert.equal(f.fake.state.closes, 1);
  });

  test(method + ' loses the close reply and sends no further command', async () => {
    const f = fixture(method);
    f.fake.fault(56, 'after');
    const result = await f.printer.registerSale(f.receipt, f.journal);
    assert.deepEqual(result, { status: 'uncertain' });
    assert.equal(f.operations.length, 1);
    assert.equal(f.commands.at(-1), 56);
    assert.equal(f.acknowledgements.length, f.commands.length - 1);
    assert.equal(f.fake.state.tenders, 1);
    assert.equal(f.fake.state.closes, 1);
  });
}

test('legacy identity layout, wrong serial and an already-open receipt stop on the identity probe', async () => {
  for (const [config, open] of [[{ legacy: true }, false], [{ expectedSerial: 'SYNTHETIC02' }, false], [{}, true]]) {
    const f = fixture('cash', config);
    f.fake.state.open = open;
    assert.deepEqual(await f.printer.registerSale(f.receipt, f.journal), { status: 'failed' });
    assert.deepEqual(f.commands, [90]);
    assert.deepEqual(f.baselines, []);
  }
});

test('a different tender register moving after the debit leaves the printed document unconfirmed', async () => {
  const f = fixture('card', { debitRegister: 0 });
  assert.deepEqual(await f.printer.registerSale(f.receipt, f.journal), { status: 'uncertain' });
  assert.equal(f.commands.at(-1), 110);
  assert.equal(f.fake.state.closes, 1);
  assert.equal(f.acknowledgements.length, f.commands.length - 1);
});

test('receipt scope, card enrollment and a durable baseline callback are checked before launch', async () => {
  const f = fixture('cash', { enrolled: false });
  for (const request of [
    { ...f.receipt, method: 'card' }, { ...f.receipt, account: 'B' }, { ...f.receipt, method: 'other' },
    { ...f.receipt, lines: [{}] }, { ...f.receipt, lines: [] }
  ]) {
    assert.equal(f.printer.canRegister(request), false);
    assert.deepEqual(await f.printer.registerSale(request, f.journal), { status: 'failed' });
  }
  assert.equal(f.printer.canRegister(f.receipt), true);
  assert.deepEqual(await f.printer.registerSale(f.receipt, {}), { status: 'failed' });
  assert.deepEqual(f.operations, []);
});

test('a pending cash exchange admits neither a concurrent card sale nor a recovery observation', async () => {
  const f = fixture('cash');
  let release, reachedBaseline;
  const baseline = new Promise(resolve => { reachedBaseline = resolve; });
  const proceed = new Promise(resolve => { release = resolve; });
  const sale = f.printer.registerSale(f.receipt, {
    ...f.journal, async beforeOpen(value) { f.journal.beforeOpen(value); reachedBaseline(); await proceed; }
  });
  await baseline;
  try {
    assert.deepEqual(await f.printer.registerSale({ ...f.receipt, method: 'card' }, f.journal), { status: 'failed' });
    assert.equal(await f.printer.acquireCashObservation(), null);
    assert.deepEqual(f.operations, ['Checkout']);
  } finally { release(); }
  assert.equal((await sale).status, 'accepted');
});

test('the packaged selector uses the enrolled database, privately supplied profile and original device claim', t => {
  const { enroll, deviceTrial } = require(path.join(desktop, 'pf700-commissioning'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-fast-mode-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const code = path.join(work, 'desktop');
  fs.cpSync(desktop, code, { recursive: true });
  if (!fs.existsSync(installed)) {
    fs.copyFileSync(require.resolve('../scripts/fast-pay/device'), path.join(code, 'fast-pay-device.js'));
  }
  const roaming = path.join(work, 'roaming'), local = path.join(work, 'local');
  const original = path.join(roaming, 'Arra POS PF700 Commissioning');
  const copy = path.join(work, 'database copy');
  for (const folder of [original, copy]) {
    fs.mkdirSync(folder, { recursive: true });
    const db = new DatabaseSync(path.join(folder, 'arra.sqlite'));
    try { enroll(db); } finally { db.close(); }
  }
  const sample = fixture('cash');
  const settings = { expectedSerial: sample.fake.serial, operatorNumber: 2, tillNumber: 1, domesticProduct: false,
    operatorPassword: String(randomInt(100000, 1000000)) };
  const check = (directory, profileDirectory = directory, flags = ['--arra-fast-pay','--pf700-routine-checkout']) => {
    const child = spawnSync(process.execPath, ['-e', `
      const { selectFastPayCheckout } = require('./fast-pay-device');
      const [directory, ...args] = process.argv.slice(1);
      const printer = selectFastPayCheckout(args, directory);
      const snapshot = ${JSON.stringify(sample.receipt)};
      process.stdout.write(JSON.stringify([printer.mode, printer.fastPayVersion, printer.requireOrigins,
        typeof printer.dailyReport.issueDailyReport, typeof printer.readCardTrial,
        printer.canRegister(snapshot), printer.canRegister({...snapshot,method:'card'})]));
    `, directory, ...flags], { cwd: code, env: { ...process.env, APPDATA: roaming, LOCALAPPDATA: local },
      windowsHide: true, timeout: 10000, input: JSON.stringify({ ...settings, dataDirectory: profileDirectory }), encoding: 'utf8' });
    if (child.error) throw child.error;
    return child.status === 0 ? JSON.parse(child.stdout) : 'refused';
  };
  const expected = ['device', 1, true, 'function', 'function', true];
  assert.equal(check(original), 'refused');
  deviceTrial(settings.expectedSerial, local).claim();
  assert.deepEqual(check(original), [...expected, true]);
  assert.equal(check(copy), 'refused');
  assert.equal(check(original, copy), 'refused');
  assert.equal(check(original, original, ['--pf700-routine-checkout']), 'refused');
  assert.equal(check(original, original, ['--arra-fast-pay','--pf700-supervised-card-trial']), 'refused');
  fs.writeFileSync(path.join(original, 'SAMPLE-DATA-ONLY'), '');
  assert.equal(check(original), 'refused');
});
