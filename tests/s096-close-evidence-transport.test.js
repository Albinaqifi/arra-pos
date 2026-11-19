'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { encodeRequest } = require('../src/desktop/pf700-frame');
const { simulatedResponse } = require('../src/desktop/pf700-checkout-protocol');

const helper = path.resolve(__dirname, '../scripts/pf700-close-evidence/capture.ps1');
const shell = process.platform === 'win32'
  ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'pwsh';
const noShell = process.platform !== 'win32' && spawnSync(shell, ['-Version']).error?.code === 'ENOENT';
const flags = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];
const options = { encoding:'utf8', windowsHide:true, timeout:25000 };
const hex = buffer => buffer.toString('hex').toUpperCase();

test('private capture entry rejects invalid sequence and extra input before port construction', {skip:noShell}, () => {
  for (const args of [[], ['-Sequence','31'], ['-Sequence','128'], ['-Sequence','0x38'], ['-Sequence','32','extra']]) {
    const run = spawnSync(shell, [...flags, helper, ...args], options);
    assert.equal(run.status, 1, run.stderr);
    assert.equal(run.stdout.trim(), 'ERROR');
    assert.equal(run.stderr, '');
  }
});

test('one exclusive session reads pending input or sends exactly the saved-sequence status inquiry', {skip:noShell}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-close-capture-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const cases = [
    {name:'cached close', sequence:32, command:56, value:'0002,0000'},
    {name:'status', sequence:127, command:74, value:''},
    {name:'busy then cached close', sequence:69, command:56, value:'0002,0000', busy:2},
    {name:'passive', sequence:40, command:56, value:'0004,0000', passive:true},
    {name:'partial passive', passive:true, bytes:[1, 0x2b, 0x20]},
    {name:'unrecognized passive', passive:true, bytes:[0x15]},
    {name:'partial passive with repeated timeouts', passive:true, readTimeout:true, bytes:[1,0x2b]},
    {name:'second passive frame', passive:true, bytes:[...simulatedResponse(42, 56, '0002,0000', false), 1]},
    {name:'bad size', bytes:[1, 255]},
    {name:'too many busy', bytes:Array(49).fill(22)},
    {name:'bad terminator', bytes:[...simulatedResponse(42, 56, '0002,0000', false).subarray(0,-1), 0]},
    {name:'second response', bytes:[...simulatedResponse(42, 56, '0002,0000', false), 1]},
    {name:'port in use', openFails:true, bytes:[]},
    {name:'unreadable receive queue', queueFails:true, bytes:[]},
    {name:'write interrupted', writeFails:true, bytes:[]},
    {name:'sequence outside allowed range', sequence:200, bytes:[]},
  ];
  const fixture = cases.map(c => ({...c, sequence:c.sequence ?? 42,
    bytes:c.bytes ?? [...Array(c.busy ?? 0).fill(22), ...simulatedResponse(c.sequence,c.command,c.value,false)]}));
  fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(fixture));
  const harness = path.join(dir, 'fake-port.ps1');
  fs.writeFileSync(harness, `
param([string]$Helper)
$ErrorActionPreference = 'Stop'
. $Helper
class FakePort {
  [Collections.Generic.Queue[int]]$Queue = [Collections.Generic.Queue[int]]::new()
  [byte[]]$Reply
  [int]$Opens
  [int]$Writes
  [int]$Closes
  [bool]$OpenFails
  [bool]$WriteFails
  [bool]$QueueFails
  [bool]$ReadTimeout
  [string]$Sent = ''
  [void]Open() {
    $this.Opens++
    if ($this.OpenFails) { throw 'Synthetic port in use' }
  }
  [void]QueueBytes([byte[]]$bytes) {
    foreach ($b in $bytes) { $this.Queue.Enqueue($b) }
  }
  [int]get_BytesToRead() {
    if ($this.QueueFails) { throw 'Synthetic queue read failed' }
    return $this.Queue.Count
  }
  [void]Write([byte[]]$buffer, [int]$offset, [int]$length) {
    $this.Writes++
    $this.Sent = [BitConverter]::ToString($buffer, $offset, $length).Replace('-','')
    if ($this.WriteFails) { throw 'Synthetic write error' }
    $this.QueueBytes($this.Reply)
  }
  [int]ReadByte() {
    if ($this.Queue.Count -eq 0 -and $this.ReadTimeout) {
      [Threading.Thread]::Sleep(100)
      throw [TimeoutException]::new('Synthetic timeout')
    }
    if ($this.Queue.Count -eq 0) { return -1 }
    return $this.Queue.Dequeue()
  }
  [void]Dispose() { $this.Closes++ }
}
$cases = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'cases.json') -Raw | ConvertFrom-Json
foreach ($case in $cases) {
  $port = [FakePort]::new()
  $port.Reply = [byte[]]$case.bytes
  $port.OpenFails = [bool]$case.openFails
  $port.QueueFails = [bool]$case.queueFails
  $port.ReadTimeout = [bool]$case.readTimeout
  $port.WriteFails = [bool]$case.writeFails
  if ($case.passive) { $port.QueueBytes($port.Reply) }
  try { $result = Invoke-CloseEvidenceCapture $port $case.sequence }
  catch { $result = 'ERROR' }
  [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{
    result=$result; opens=$port.Opens; writes=$port.Writes; sent=$port.Sent; closes=$port.Closes
  }))
}
`);
  const run = spawnSync(shell, [...flags, harness, helper], options);
  assert.equal(run.status, 0, run.stderr || run.error?.message);
  assert.equal(run.stderr, '');
  const results = run.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(results.length, cases.length);
  for (const [i,c] of cases.entries()) {
    const sequence = fixture[i].sequence;
    const sends = !c.passive && !c.openFails && !c.queueFails && sequence <= 127;
    const frame = c.command && simulatedResponse(sequence,c.command,c.value,false);
    assert.deepEqual(results[i], {
      opens:sequence <= 127 ? 1 : 0, closes:1, writes:Number(sends),
      sent:sends ? hex(encodeRequest({sequence,command:74,data:Buffer.from('X')})) : '',
      result:frame ? (c.passive ? 'PENDING ' : 'PROBE ') + hex(frame) : 'ERROR',
    }, c.name);
  }
});
