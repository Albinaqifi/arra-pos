const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PF700_PROFILE, rehearseStatus, readImmediateStatus } = require('../src/desktop/pf700-status');
const { runDiagnostic } = require('../src/desktop/pf700-status-cli');

const reply = Buffer.from('0131204a808080808080048080808080800530363a3403', 'hex');

test('offline rehearsal and invalid CLI arguments cannot invoke a live query', () => {
  function forbidden() { assert.fail('Touched the live path'); }
  assert.deepEqual(PF700_PROFILE, { model: 'Synergy PF700', port: 'COM3', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 });
  assert.deepEqual(rehearseStatus(), { mode: 'offline', result: 'simulated-response' });
  assert.match(runDiagnostic([], forbidden), /Offline.*simulated/);
  for (const args of [['COM3'], ['--read-device-status', '--report'], ['--read-device-status=1']]) {
    assert.throws(() => runDiagnostic(args, forbidden), /intentional live status/);
  }
});

test('one immediate status exchange tolerates busy indicators and preserves the two status fields', () => {
  let calls = 0;
  const result = readImmediateStatus(0x20, request => {
    calls++;
    assert.equal(request.toString('hex'), '0125204a580530303e3c03');
    // Different values for status data and frame status.
    const state = Buffer.from('0131204a908080808080048080808080800530363b3403', 'hex');
    return Buffer.concat([Buffer.from([0x16,0x16]), state]);
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { statusBytes: '908080808080', frameStatusBytes: '808080808080' });
});

test('rejects timeout, NAK, truncation, wrong identity, checksum and command rejection without retransmission', () => {
  const damaged = Buffer.from(reply);
  damaged[8] ^= 1;
  for (const response of [
    Buffer.alloc(0), Buffer.alloc(49,0x16), Buffer.from([0x16,0x15]), reply.subarray(0,10),
    damaged, Buffer.from('0131214a808080808080048080808080800530363a3503','hex'),
    Buffer.from('012b204a04808080808080053033393e03','hex'), // no command-specific status data
    Buffer.from('0131204a808080808080048180808080800530363a3503','hex'), // status syntax error
    Buffer.concat([reply, reply])
  ]) {
    let calls = 0;
    assert.throws(() => readImmediateStatus(0x20, () => { calls++; return response; }));
    assert.equal(calls, 1);
  }
  let timeoutCalls = 0;
  assert.throws(() => readImmediateStatus(0x20, () => { timeoutCalls++; throw Error('Timeout'); }), /Timeout/);
  assert.equal(timeoutCalls, 1);
});

test('status unavailable in the current fiscal mode is a rejection; a cover-open status remains diagnostic', () => {
  // Byte 1 bit 1 rejects this command even with reply data and a valid checksum.
  const modeRejected = Buffer.from('0131204a808080808080048082808080800530363a3603','hex');
  assert.throws(() => readImmediateStatus(0x20, () => modeRejected), /current fiscal mode/);
  const coverOpen = Buffer.from('0131204a8080808080800480a0808080800530363c3403','hex');
  assert.equal(readImmediateStatus(0x20, () => coverOpen).frameStatusBytes,'80a080808080');
});

test('Windows byte reader collects fragmented binary data and bounds partial/busy replies using memory only', {
  skip: process.platform !== 'win32'
}, () => {
  const reader = readFileSync(path.join(__dirname, '../src/desktop/pf700-read-status.ps1'), 'utf8');
  // No SerialPort instance, device enumeration or OS device access.
  const testScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
${reader}
function Assert-Reply([byte[]] $bytes) {
  $stream = [IO.MemoryStream]::new($bytes)
  [byte[]]$result = Read-Pf700StatusReply $stream
  if ([Convert]::ToBase64String($bytes) -ne [Convert]::ToBase64String($result)) { throw 'Incorrect bytes' }
}
Assert-Reply ([byte[]]@(22, 21))
Assert-Reply ([Convert]::FromBase64String('${Buffer.concat([Buffer.from([22]), reply]).toString('base64')}'))
try { Read-Pf700StatusReply ([IO.MemoryStream]::new([byte[]]@(22, 1))); throw 'Accepted truncation' }
catch [IO.EndOfStreamException] { }
try { Read-Pf700StatusReply ([IO.MemoryStream]::new([byte[]](@(22)*150))); throw 'Accepted unbounded busy' }
catch [TimeoutException] { }
exit 0`;
  execFileSync(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(testScript,'utf16le').toString('base64')],
    { windowsHide: true, timeout: 10000, stdio: ['ignore','pipe','pipe'] });
});
