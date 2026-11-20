const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createWindowsPf700PrinterControl } = require('../src/desktop/pf700-printer-control');

// Run the real PowerShell helper and JavaScript pipe against a synthetic port.
// The port fails either immediately before Write or inside Write; no COM port
// or physical printer is opened.
test('Windows helper reports cash failure on the correct side of SerialPort.Write', {
  skip: process.platform !== 'win32', timeout: 30000
}, async () => {
  const helper = path.resolve(__dirname, '../src/desktop/pf700-checkout-exchange.ps1').replaceAll("'", "''");
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  for (const scenario of ['before', 'during']) {
    const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. '${helper}'
function Identity-Reply($sequence) {
  $data = [Text.Encoding]::ASCII.GetBytes('1.00 231014 1230,ABCD,0011,1,SYNTHETIC01')
  $body = [Collections.Generic.List[byte]]::new()
  $body.Add([byte](43 + $data.Length)); $body.Add([byte]$sequence); $body.Add(90)
  foreach ($b in $data) { $body.Add($b) }
  foreach ($b in @(4,136,128,128,225,128,154,5)) { $body.Add([byte]$b) }
  $sum = 0; foreach ($b in $body) { $sum += $b }
  $frame = [Collections.Generic.List[byte]]::new(); $frame.Add(1); $frame.AddRange($body)
  foreach ($shift in @(12,8,4,0)) { $frame.Add([byte](48 + (($sum -shr $shift) -band 15))) }
  $frame.Add(3); return ,$frame.ToArray()
}
$port = New-Object PSObject -Property @{checks=0; kind='${scenario}'; bytes=[Collections.Generic.Queue[byte]]::new()}
$port | Add-Member ScriptProperty BytesToRead { $this.checks += 1; if ($this.kind -eq 'before' -and $this.checks -ge 3) { 1 } else { 0 } }
$port | Add-Member ScriptMethod Open { }
$port | Add-Member ScriptMethod Write {
  param($request,$start,$length)
  [Console]::Error.WriteLine('W' + [int]$request[3])
  if ($request[3] -eq 70) { throw 'synthetic write failure' }
  foreach ($b in (Identity-Reply $request[2])) { $this.bytes.Enqueue($b) }
}
$port | Add-Member ScriptMethod ReadByte { return [int]$this.bytes.Dequeue() }
$port | Add-Member ScriptMethod Dispose { }
Invoke-Pf700CheckoutPort $port ([Console]::In) ([Console]::Out) 'PrinterControl'
`;
    let writes = '';
    const start = () => {
      const child = spawn(powershell, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
        {windowsHide:true,stdio:['pipe','pipe','pipe']});
      child.stderr.on('data', chunk => { writes += chunk.toString(); });
      return child;
    };
    const printer = createWindowsPf700PrinterControl({expectedSerial:'SYNTHETIC01'}, start);
    assert.equal(await printer.printCashMovement('2000.00', () => true), scenario === 'before' ? 'not_sent' : 'unknown');
    assert.deepEqual(writes.split(/\r?\n/).filter(line => /^W\d+$/.test(line)), scenario === 'before' ? ['W90'] : ['W90','W70']);
  }
});
