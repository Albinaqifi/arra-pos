const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { randomInt } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createWindowsPf700Checkout, checkWindowsPf700Identity } = require('../src/desktop/pf700-windows-checkout');
const { encodeRequest } = require('../src/desktop/pf700-frame');
const { openDatabase } = require('../src/desktop/database');
const { authorizedDatabase } = require('./support/authorized-database');
const { seedTables } = require('../src/desktop/tables');
const { seedArraMenu } = require('../src/desktop/arra-menu');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerBills } = require('../src/desktop/bills');
const { registerPayments } = require('../src/desktop/payments');
const { enroll } = require('../src/desktop/pf700-commissioning');
const { selectPf700Checkout } = require('../src/desktop/pf700-checkout-mode');

const windows = { skip: process.platform !== 'win32' };
const serial = 'SYNTHETIC01';
const sixFields = ['QA-700DEMOX', '1.00MK 23OCT14 1230', 'BEEF', '01001101', '7', serial];
const profile = () => ({ expectedSerial: serial, operatorNumber: 2, tillNumber: 1,
  operatorPassword: String(randomInt(100000, 1000000)), domesticProduct: true });
const snapshot = { account: 'A', currency: 'MKD', billId: 1, total: 70, method: 'cash', domesticProduct: true,
  lines: [{ name: 'Coffee', quantity: 1, unitPrice: 70, taxGroup: 'В', taxRate: 10 }] };
const journal = { beforeOpen(baseline) { assert.deepEqual(baseline, { previousDocumentNumber: '0000001' }); } };

function wrapped(sequence, command, open, data) {
  const status = Buffer.from(open ? '888088e1809a' : '888080e1809a', 'hex');
  const value = command === 74 ? status : Buffer.from(data);
  const body = Buffer.concat([Buffer.from([43 + value.length, sequence, command]), value, Buffer.from([4]), status, Buffer.from([5])]);
  const sum = body.reduce((a, b) => a + b, 0);
  return Buffer.concat([Buffer.from([1]), body, Buffer.from([12, 8, 4, 0].map(shift => 48 + (sum >> shift & 15))), Buffer.from([3])]);
}

function mockPipe({ identity = '1.00 231014 1230,ABCD,0011,1,' + serial, identityOpen = false, breakAt, mutate } = {}) {
  const log = { calls: [], launches: 0, closes: 0 };
  return { log, start(_executable, args, options) {
    log.launches++; log.args = args; log.options = options;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    let open = false, closed = false, sold = false, registered = false;
    const onsite = identity.split(',').length === 6;
    child.stdin = new Writable({
      write(bytes, _encoding, callback) {
        const frame = Buffer.from(bytes.toString().trim(), 'hex'), cmd = frame[3];
        const data = frame.subarray(4, -6);
        log.calls.push(cmd);
        if (cmd === breakAt) { child.stdout.end(); callback(); return; }
        let reply = '';
        switch (cmd) {
          case 90: assert.equal(data.toString(), '0'); reply = identity; break;
          case 74: break;
          case 76: {
            const amount = onsite ? '+000007000' : '+000000070';
            reply = [Number(open), registered ? '0001' : '0000', registered ? amount : '+000000000',
              sold ? amount : '+000000000'].join(',');
            break;
          }
          case 97: reply = '18,5,10,0'; break;
          case 113: reply = closed ? '0000002' : '0000001'; break;
          case 48: open = true; reply = '0000,0000'; break;
          case 49:
            registered = true;
            log.item = data;
            log.domestic = data.includes(Buffer.from([9, 64, 0xc2]));
            break;
          case 51: reply = '70,0,0,70,0'; break;
          case 103: reply = onsite ? '1,+000000000,+000000000,+000007000,+000000000' : '0,0,0,70,0'; break;
          case 53:
            assert.equal(data.toString(), onsite ? '\t' : '\tP70');
            assert.equal(sold, false);
            sold = true; reply = 'R+000000000'; break;
          case 56: closed = true; open = false; reply = '0001,0000'; break;
          default: throw Error('Unexpected command');
        }
        const line = wrapped(frame[2], cmd, cmd === 90 ? identityOpen : open, reply).toString('hex').toUpperCase() + '\r\n';
        const response = mutate ? mutate(line) : line;
        child.stdout.write(response.slice(0, 7));
        child.stdout.write(response.slice(7));
        callback();
      },
      final(callback) {
        log.closes++; child.stdout.end(); setImmediate(() => child.emit('close', 0)); callback();
      }
    });
    child.kill = () => { throw Error('Unexpected child termination'); };
    return child;
  } };
}

test('Windows adapter pins the serial and runs the full checkout over one private pipe', windows, async () => {
  const mock = mockPipe(), config = profile();
  config.beforeOpen = () => assert.deepEqual(mock.log.calls, [90,74,76,97,113]);
  const device = createWindowsPf700Checkout(config, mock.start);
  assert.equal(device.deviceId, serial);
  assert.deepEqual(Object.keys(device).sort(), ['acquireCashObservation','deviceId','domesticProduct','mode','registerSale']);
  assert.equal((await device.registerSale(snapshot)).status, 'failed');
  assert.equal((await device.registerSale({ ...snapshot, domesticProduct: false }, journal)).status, 'failed');
  const oversized = { ...snapshot, total: 10_000_000, lines: [{ ...snapshot.lines[0], unitPrice: 10_000_000 }] };
  assert.equal((await device.registerSale(oversized, journal)).status, 'failed');
  const consumed = createWindowsPf700Checkout({ ...config, mayProbe: () => false }, mock.start);
  assert.equal((await consumed.registerSale(snapshot, journal)).status, 'failed');
  assert.equal(mock.log.launches, 0);
  const result = await device.registerSale(snapshot, journal);
  assert.equal(result.status, 'accepted');
  assert.equal(result.reference, '0000002');
  assert.equal(mock.log.launches, 1); assert.equal(mock.log.closes, 1);
  assert.deepEqual(mock.log.calls, [90,74,76,97,113,48,49,51,103,53,76,56,76,113]);
  assert.equal(mock.log.domestic, true);
  assert.equal(mock.log.options.windowsHide, true);
  assert.deepEqual(mock.log.options.stdio, ['pipe','pipe','ignore']);
  assert.ok(!JSON.stringify(mock.log.args).includes(config.operatorPassword));
});

test('routine adapter uses the saved mark on a legacy single-item receipt', windows, async () => {
  for (const originalMark of [false, true]) {
    const mock = mockPipe();
    const device = createWindowsPf700Checkout({ ...profile(), domesticProduct: !originalMark, allowLegacyOrigin: true }, mock.start);
    assert.equal((await device.registerSale({...snapshot, domesticProduct:originalMark}, journal)).status, 'accepted');
    assert.equal(mock.log.domestic, originalMark);
  }
});

test('wrong serial, malformed diagnostics and bad pipe frames fail before any fiscal command', windows, async () => {
  for (const bad of [
    { identity: '1.00 231014 1230,ABCD,0011,1,SYNTHETIC02' },
    { identity: 'unknown,' + serial },
    { mutate: line => line + line },
    { mutate: () => '00'.repeat(102) + '\n' },
    { mutate: () => '15\n' }, { breakAt: 90 }
  ]) {
    const { start, log } = mockPipe(bad);
    assert.equal((await createWindowsPf700Checkout(profile(), start).registerSale(snapshot, journal)).status, 'failed');
    assert.deepEqual(log.calls, [90]); assert.equal(log.closes, 1);
  }
});

test('standalone read-only 90/0 reports mismatches without echoing any device fields', windows, async () => {
  const oldLayout = '1.00 23OCT14 1200,FFFF,0011,1,SAMPLE01,SAMPLE02';
  for (const [identity, result] of [
    ['1.00 231014 1200,FFFF,0011,1,' + serial, { ok: true }],
    ['1.00MK 23-OCT-2014 1200,FFFF,0011,1,' + serial, { ok: true }],
    ['1.00MK 231014 1200,FFFF,0011,1,' + serial, { ok: true }],
    ['1.00 231014 1200,FFFF,0011,1,SYNTHETIC02', { ok: false, reason: 'serial' }],
    [oldLayout, { ok: false, reason: 'layout', layout: 'header widths 4/7/4, remaining field widths 4/4/1/8/8' }],
    ['1.00MK 23-OCT-2014 1200,FFFF,4011,1,' + serial, { ok: false, reason: 'layout', layout: 'header widths 6/11/4, remaining field widths 4/4/1/11' }]
  ]) {
    const mock = mockPipe({ identity });
    assert.deepEqual(await checkWindowsPf700Identity(serial, mock.start), result);
    assert.deepEqual(mock.log.calls, [90]); assert.equal(mock.log.closes, 1);
  }
  const unreachable = mockPipe({ breakAt: 90 });
  assert.deepEqual(await checkWindowsPf700Identity(serial, unreachable.start), { ok: false, reason: 'transport' });
});

test('confirmed six-field identity works in both the read-only check and the guarded checkout', windows, async () => {
  for (const firmware of ['1.00MK 23OCT14 0000', '1.00MK 23OCT14 2359']) {
    const identity = sixFields.with(1, firmware).join(',');
    const probe = mockPipe({ identity });
    assert.deepEqual(await checkWindowsPf700Identity(serial, probe.start), { ok: true });
    assert.deepEqual(probe.log.calls, [90]);
    assert.equal(probe.log.closes, 1);

    const mock = mockPipe({ identity });
    let journaled = false;
    const config = { ...profile(), beforeOpen() { assert.deepEqual(mock.log.calls, [90,74,76,97,113]); } };
    const result = await createWindowsPf700Checkout(config, mock.start).registerSale(snapshot, {
      beforeOpen(baseline) { journal.beforeOpen(baseline); journaled = true; }
    });
    assert.equal(journaled, true);
    assert.equal(result.status, 'accepted');
    assert.deepEqual(mock.log.calls, [90,74,76,97,113,48,49,76,103,53,76,56,76,113]);
    assert.equal(mock.log.closes, 1);
  }
});

test('wrong serial, other six-field layouts and a non-idle status stop both entry points at 90/0', windows, async () => {
  const cases = [
    [sixFields.with(5, serial.toLowerCase()), 'serial'],
    [sixFields.with(0, serial).with(5, 'SYNTHETIC02'), 'layout'],
    [sixFields.with(0, serial), 'layout'],
    [sixFields.with(0, 'QA-70XDEMOX'), 'layout'],
    [sixFields.with(0, 'QA-700demox'), 'layout'],
    [sixFields.with(1, '1.01MK 23OCT14 1230'), 'layout'],
    [sixFields.with(1, '1.00mk 23OCT14 1230'), 'layout'],
    [sixFields.with(1, '1.00MK 23oct14 1230'), 'layout'],
    [sixFields.with(1, '1.00MK 23Oct14 1230'), 'layout'],
    [sixFields.with(1, '1.00MK 23NOV14 1230'), 'layout'],
    [sixFields.with(1, '1.00MK 31FEB14 1230'), 'layout'],
    [sixFields.with(1, '1.00MK 23OCT14 2400'), 'layout'],
    [sixFields.with(1, '1.00MK 23OCT14 1260'), 'layout'],
    [sixFields.with(2, 'EFGX'), 'layout'],
    [sixFields.with(3, '00010012'), 'layout'],
    [sixFields.with(4, 'A'), 'layout'],
    [sixFields.with(5, 'SYNTHETIC0-'), 'layout'],
    [[...sixFields, ''], 'layout'],
    [sixFields, 'status']
  ];
  for (const [fields, reason] of cases) {
    const identity = fields.join(',');
    const options = { identity, identityOpen: reason === 'status' };
    const probe = mockPipe(options);
    const checked = await checkWindowsPf700Identity(serial, probe.start);
    assert.equal(checked.ok, false);
    assert.equal(checked.reason, reason);
    assert.deepEqual(probe.log.calls, [90]);
    assert.equal(probe.log.closes, 1);
    const mock = mockPipe(options);
    assert.equal((await createWindowsPf700Checkout(profile(), mock.start).registerSale(snapshot, journal)).status, 'failed');
    assert.deepEqual(mock.log.calls, [90]);
    assert.equal(mock.log.closes, 1);
  }
});

test('a rejected release stops before open and a lost open, tender or close reply is uncertain', windows, async () => {
  let mock = mockPipe();
  const refused = { ...profile(), beforeOpen() { throw Error('Commissioning approval unavailable'); } };
  assert.equal((await createWindowsPf700Checkout(refused, mock.start).registerSale(snapshot, journal)).status, 'failed');
  assert.ok(!mock.log.calls.includes(48));
  mock = mockPipe();
  const unavailable = { beforeOpen() { throw Error('Journal unavailable'); } };
  assert.equal((await createWindowsPf700Checkout(profile(), mock.start).registerSale(snapshot, unavailable)).status, 'failed');
  assert.ok(!mock.log.calls.includes(48));
  for (const breakAt of [48,53,56]) {
    mock = mockPipe({ breakAt });
    const result = await createWindowsPf700Checkout(profile(), mock.start).registerSale(snapshot, journal);
    assert.equal(result.status, 'uncertain');
    assert.equal(mock.log.calls.at(-1), breakAt);
    assert.equal(mock.log.calls.filter(code => code === breakAt).length, 1);
    assert.equal(mock.log.closes, 1);
  }
});

test('a second payment cannot acquire the same adapter while the first has its serial handle', windows, async () => {
  const mock = mockPipe(), config = profile();
  let release, atPreflight;
  const reached = new Promise(resolve => { atPreflight = resolve; });
  config.beforeOpen = () => { atPreflight(); return new Promise(resolve => { release = resolve; }); };
  const device = createWindowsPf700Checkout(config, mock.start);
  const first = device.registerSale(snapshot, journal);
  await reached;
  assert.equal((await device.registerSale(snapshot, journal)).status, 'failed');
  assert.equal(mock.log.launches, 1);
  release();
  assert.equal((await first).status, 'accepted');
  assert.equal(mock.log.closes, 1);
});

test('PowerShell helper reads framed replies and disposes a synthetic port on success and failure', windows, () => {
  const helper = path.resolve(__dirname, '../src/desktop/pf700-checkout-exchange.ps1').replaceAll("'", "''");
  const probe = encodeRequest({ sequence: 32, command: 90, data: Buffer.from('0') }).toString('hex');
  const frame = wrapped(32, 90, false, '1.00 231014 1200,FFFF,0000,1,' + serial);
  const close = encodeRequest({ sequence: 33, command: 56 }).toString('hex');
  const closeFrame = wrapped(33, 56, false, '0003,0001');
  const script = `
    $ErrorActionPreference='Stop'
    . '${helper}'
    class FakePort {
      [int]$BytesToRead=0; [int]$Opens=0; [int]$Writes=0; [bool]$Disposed=$false
      [Collections.Generic.Queue[int]]$Bytes=[Collections.Generic.Queue[int]]::new()
      [byte[]]$CloseReply=@()
      [bool]$AlwaysBusy=$false
      [int]$FinalByteDelay=0
      [void]Open() { $this.Opens++ }
      [void]Write([byte[]]$bytes,[int]$start,[int]$length) {
        $this.Writes++
        if ($bytes[3] -eq 56) {
          for ($i=0; $i -lt 49; $i++) { $this.Bytes.Enqueue(0x16) }
          foreach ($b in $this.CloseReply) { $this.Bytes.Enqueue($b) }
        }
      }
      [int]ReadByte() {
        if ($this.AlwaysBusy) { return 0x16 }
        if ($this.Bytes.Count -eq 0) { return -1 }
        if ($this.Bytes.Count -eq 1 -and $this.FinalByteDelay) { [Threading.Thread]::Sleep($this.FinalByteDelay) }
        return $this.Bytes.Dequeue()
      }
      [void]Dispose() { $this.Disposed=$true }
    }
    foreach ($case in @('valid','noise','oversized','busy-EOF','invalid-first','EOF','slow-close','lost-close')) {
      $port=[FakePort]::new()
      $inputText='${probe}' + [Environment]::NewLine
      if ($case -in @('valid','slow-close','lost-close')) { @(22,22,${[...frame].join(',')}) | ForEach-Object {$port.Bytes.Enqueue($_)} }
      if ($case -in @('slow-close','lost-close')) { $inputText += '${close}' + [Environment]::NewLine }
      if ($case -eq 'slow-close') { $port.CloseReply=@(${[...closeFrame].join(',')}) }
      if ($case -eq 'noise') {$port.BytesToRead=1}
      if ($case -eq 'oversized') {$port.Bytes.Enqueue(1);$port.Bytes.Enqueue(255)}
      if ($case -eq 'busy-EOF') {1..49 | ForEach-Object {$port.Bytes.Enqueue(22)}}
      if ($case -eq 'invalid-first') {$inputText=$inputText.Replace('205a','2038')}
      if ($case -eq 'EOF') {$inputText=''}
      $writer=[IO.StringWriter]::new()
      Invoke-Pf700CheckoutPort $port ([IO.StringReader]::new($inputText)) $writer
      $reply=$writer.ToString().Trim()
      if (!$port.Disposed) {throw 'Leaked port'}
      if ($case -in @('slow-close','lost-close')) {
        $expected = if ($case -eq 'slow-close') { '${closeFrame.toString('hex').toUpperCase()}' } else { 'FAIL' }
        if ($reply -cne ('${frame.toString('hex').toUpperCase()}' + [Environment]::NewLine + $expected) -or $port.Writes -ne 2) {
          throw "$case did not return the expected result with exactly one close write"
        }
        continue
      }
      if ($case -eq 'valid' -and ($reply -cne '${frame.toString('hex').toUpperCase()}' -or $port.Writes -ne 1)) {throw 'Invalid reply'}
      if ($case -notin @('valid','EOF') -and $reply -cne 'FAIL') {throw 'Accepted bad reply'}
      if ($case -in @('invalid-first','EOF') -and $port.Opens -ne 0) {throw 'Unexpected port open'}
      if ($case -eq 'noise' -and $port.Writes -ne 0) {throw 'Unexpected write'}
      if ($port.Writes -gt 1) {throw 'Unexpected replay'}
    }
    foreach ($case in @('endless-busy','late-final-byte')) {
      $port=[FakePort]::new()
      if ($case -eq 'endless-busy') { $port.AlwaysBusy=$true } else {
        @(${[...closeFrame].join(',')}) | ForEach-Object {$port.Bytes.Enqueue($_)}
        $port.FinalByteDelay=250
      }
      try { $null=Read-Pf700CheckoutReply $port 100; throw 'Accepted overdue reply' }
      catch { if ($_.Exception.Message -cne 'Reply deadline exceeded') { throw } }
    }
    exit 0`;
  const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(shell, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});

function commissionedCheckout(t, port) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-pf700-payment-'));
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = path.join(directory, 'local');
  let db = authorizedDatabase(openDatabase(directory));
  t.after(() => {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  enroll(db);
  seedTables(db);
  seedArraMenu(db);
  db.exec(`INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open');
    INSERT INTO order_waiter_ownership SELECT id,1,1,1,'open' FROM orders;`);
  const event = {}, allowed = sender => sender === event;
  const session = { currentUserId: () => 1, authenticatedUserId: () => 1 };
  const handlers = {}, ipc = { handle: (channel, fn) => { handlers[channel] = fn; } };
  function register() {
    const adapter = selectPf700Checkout(['--pf700-supervised-checkout'], directory,
      () => ({ ...profile(), dataDirectory: directory }), settings => createWindowsPf700Checkout(settings, port.start));
    registerOrderItems(ipc, allowed, db, session);
    registerBills(ipc, allowed, db, session, adapter);
    registerPayments(ipc, allowed, db, session, null, adapter);
  }
  register();
  return {
    get db() { return db; },
    espresso(orderId) {
      const items = req => handlers['arra:order-items'](event, { ...req, orderId });
      const bill = req => handlers['arra:bill'](event, { ...req, orderId });
      assert.equal(items({ action: 'add', productId: 'arra-product-11-0' }).ok, true);
      assert.equal(items({ action: 'send', requestId: 'send-' + orderId }).ok, true);
      const { fingerprint } = bill({ action: 'review' }).data;
      const generated = bill({ action: 'generate', fingerprint });
      assert.equal(generated.data.total, 70);
      return generated.data.id;
    },
    pay: billId => {
      const request = { billId, method: 'cash', account: 'A' };
      if (db.prepare('SELECT 1 FROM payments WHERE bill_id=?').get(billId) ||
          db.prepare(`SELECT 1 FROM fiscal_checkout_attempts a JOIN fiscal_checkout_verified_results r ON r.attempt_id=a.id
            WHERE a.bill_id=? AND r.status='accepted'`).get(billId)) return handlers['arra:payment'](event,request);
      const prepared = handlers['arra:payment'](event, {...request,preparePhysicalCash:true});
      return prepared.ok ? handlers['arra:payment'](event,{...request,physicalIntentId:prepared.data.intentId}) : prepared;
    },
    restart() { db.close(); db = openDatabase(directory); register(); }
  };
}

const espressoCommands = [90,74,76,97,113,48,49,76,103,53,76,56,76,113];

test('supervised waiter checkout records one 70 MKD espresso and its six-field receipt across restart', windows, async t => {
  const port = mockPipe({ identity: sixFields.join(',') });
  const pos = commissionedCheckout(t, port);
  const billId = pos.espresso(1), secondBill = pos.espresso(2);
  const paid = await pos.pay(billId);
  assert.equal(paid.ok, true);
  assert.equal(paid.data.fiscal.status, 'accepted');
  assert.deepEqual(paid.data.fiscal.evidence, { documentNumber: '0000002', fiscalReceiptCount: 1, reversalCount: 0 });
  const [line] = paid.data.fiscal.receipt.lines;
  assert.deepEqual([line.name, line.unitPrice, line.quantity, line.taxGroup, line.taxRate], ['Espresso',70,1,'В',10]);
  assert.deepEqual(port.log.item, Buffer.concat([Buffer.from('Espresso'), Buffer.from([9,64,0xc2]), Buffer.from('70*1')]));
  assert.deepEqual(await pos.pay(billId), paid);
  pos.restart();
  assert.deepEqual(await pos.pay(billId), paid);
  assert.equal((await pos.pay(secondBill)).fiscalStatus, 'scope');
  const payments = pos.db.prepare('SELECT bill_id, amount, account, method FROM payments').all();
  assert.deepEqual(payments.map(row => ({ ...row })), [{ bill_id: billId, amount: 70, account: 'A', method: 'cash' }]);
  assert.equal(pos.db.prepare('SELECT status FROM orders WHERE id=1').get().status, 'completed');
  assert.equal(pos.db.prepare('SELECT count(*) AS n FROM fiscal_checkout_attempts').get().n, 1);
  assert.equal(port.log.launches, 1);
  assert.deepEqual(port.log.calls, espressoCommands);
});

test('interrupted six-field waiter checkout preserves an unpaid bill and never resends on restart', windows, async t => {
  function wrongVat(line) {
    const frame = Buffer.from(line.trim(), 'hex');
    if (frame[3] !== 103) return line;
    return wrapped(frame[2], 103, true, '1,+000000000,+000000000,+000000070,+000000000').toString('hex').toUpperCase() + '\r\n';
  }
  for (const [name, change, last] of [
    ['unverified VAT amount', { mutate: wrongVat }, 103],
    ['lost tender reply', { breakAt: 53 }, 53],
    ['lost close reply', { breakAt: 56 }, 56]
  ]) await t.test(name, async t => {
    const port = mockPipe({ identity: sixFields.join(','), ...change });
    const pos = commissionedCheckout(t, port);
    const billId = pos.espresso(1);
    assert.equal((await pos.pay(billId)).fiscalStatus, 'uncertain');
    pos.restart();
    assert.equal((await pos.pay(billId)).fiscalStatus, 'uncertain');
    assert.equal(pos.db.prepare('SELECT count(*) AS n FROM payments').get().n, 0);
    assert.equal(pos.db.prepare('SELECT status FROM orders WHERE id=1').get().status, 'open');
    assert.equal(pos.db.prepare('SELECT count(*) AS n FROM fiscal_checkout_attempts').get().n, 1);
    assert.equal(pos.db.prepare('SELECT previous_document FROM fiscal_checkout_baselines').get().previous_document, '0000001');
    assert.equal(port.log.launches, 1);
    assert.deepEqual(port.log.calls, espressoCommands.slice(0, espressoCommands.indexOf(last) + 1));
  });
});
