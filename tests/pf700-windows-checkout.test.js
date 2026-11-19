const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { randomInt } = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createWindowsPf700Checkout, checkWindowsPf700Identity } = require('../src/desktop/pf700-windows-checkout');
const { encodeRequest } = require('../src/desktop/pf700-frame');

const windows = { skip: process.platform !== 'win32' };
const serial = 'SYNTHETIC01';
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

function mockPipe({ identity = '1.00 231014 1230,ABCD,0011,1,' + serial, breakAt, mutate } = {}) {
  const log = { calls: [], launches: 0, closes: 0 };
  return { log, start(_executable, args, options) {
    log.launches++; log.args = args; log.options = options;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    let open = false, closed = false, sold = false;
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
          case 76: reply = [Number(open), sold ? '0001' : '0000', sold ? '+000000070' : '+000000000', sold ? '+000000070' : '+000000000'].join(','); break;
          case 97: reply = '18,5,10,0'; break;
          case 113: reply = closed ? '0000002' : '0000001'; break;
          case 48: open = true; reply = '0000,0000'; break;
          case 49: log.domestic = data.includes(Buffer.from([9, 64, 0xc2])); break;
          case 51: reply = '70,0,0,70,0'; break;
          case 103: reply = '0,0,0,70,0'; break;
          case 53: sold = true; reply = 'R+000000000'; break;
          case 56: closed = true; open = false; reply = '0001,0000'; break;
          default: throw Error('Unexpected command');
        }
        const line = wrapped(frame[2], cmd, open, reply).toString('hex').toUpperCase() + '\r\n';
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
  assert.deepEqual(Object.keys(device).sort(), ['deviceId','domesticProduct','mode','registerSale']);
  assert.equal((await device.registerSale(snapshot)).status, 'failed');
  assert.equal((await device.registerSale({ ...snapshot, domesticProduct: false }, journal)).status, 'failed');
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
  const script = `
    $ErrorActionPreference='Stop'
    . '${helper}'
    class FakePort {
      [int]$BytesToRead=0; [int]$Opens=0; [int]$Writes=0; [bool]$Disposed=$false
      [Collections.Generic.Queue[int]]$Bytes=[Collections.Generic.Queue[int]]::new()
      [void]Open() { $this.Opens++ }
      [void]Write([byte[]]$bytes,[int]$start,[int]$length) { $this.Writes++ }
      [int]ReadByte() { return $this.Bytes.Dequeue() }
      [void]Dispose() { $this.Disposed=$true }
    }
    foreach ($case in @('valid','noise','oversized','busy','invalid-first','EOF')) {
      $port=[FakePort]::new()
      $inputText='${probe}' + [Environment]::NewLine
      if ($case -eq 'valid') { @(22,22,${[...frame].join(',')}) | ForEach-Object {$port.Bytes.Enqueue($_)} }
      if ($case -eq 'noise') {$port.BytesToRead=1}
      if ($case -eq 'oversized') {$port.Bytes.Enqueue(1);$port.Bytes.Enqueue(255)}
      if ($case -eq 'busy') {1..49 | ForEach-Object {$port.Bytes.Enqueue(22)}}
      if ($case -eq 'invalid-first') {$inputText=$inputText.Replace('205a','2038')}
      if ($case -eq 'EOF') {$inputText=''}
      $writer=[IO.StringWriter]::new()
      Invoke-Pf700CheckoutPort $port ([IO.StringReader]::new($inputText)) $writer
      $reply=$writer.ToString().Trim()
      if (!$port.Disposed) {throw 'Leaked port'}
      if ($case -eq 'valid' -and ($reply -cne '${frame.toString('hex').toUpperCase()}' -or $port.Writes -ne 1)) {throw 'Invalid reply'}
      if ($case -notin @('valid','EOF') -and $reply -cne 'FAIL') {throw 'Accepted bad reply'}
      if ($case -in @('invalid-first','EOF') -and $port.Opens -ne 0) {throw 'Unexpected port open'}
      if ($case -eq 'noise' -and $port.Writes -ne 0) {throw 'Unexpected write'}
      if ($port.Writes -gt 1) {throw 'Unexpected replay'}
    }`;
  const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(shell, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});
