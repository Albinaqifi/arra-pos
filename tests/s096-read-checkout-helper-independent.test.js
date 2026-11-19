const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { encodeRequest } = require('../src/desktop/pf700-frame');

test('ReadCheckout acquires without wire writes and rejects commands outside its read-only phase', {skip:process.platform !== 'win32'}, () => {
  const helper = path.resolve(__dirname, '../src/desktop/pf700-checkout-exchange.ps1').replaceAll("'", "''");
  const frame = (command, data = '') => encodeRequest({sequence:32,command,data:Buffer.from(data)}).toString('hex');
  const script = `
    $ErrorActionPreference='Stop'
    . '${helper}'
    class FakePort {
      [int]$BytesToRead=0; [int]$Opens=0; [int]$Writes=0; [bool]$Disposed=$false; [bool]$Busy=$false
      [void]Open() { if ($this.Busy) {throw 'busy'}; $this.Opens++ }
      [void]Write([byte[]]$bytes,[int]$start,[int]$length) { $this.Writes++ }
      [int]ReadByte() { return 21 }
      [void]Dispose() { $this.Disposed=$true }
    }
    $nl=[Environment]::NewLine
    $probe='${frame(90,'0')}'
    $cases=@(
      @{name='reserve only'; input='OPEN'; opens=1; writes=0; output='READY'},
      @{name='missing reserve'; input=$probe; opens=0; writes=0; output='FAIL'},
      @{name='busy'; input='OPEN'; opens=0; writes=0; output='FAIL'; busy=$true},
      @{name='first query must identify'; input=('OPEN'+$nl+'${frame(76,'T')}'); opens=1; writes=0; output=('READY'+$nl+'FAIL')},
      @{name='identity then read state'; input=('OPEN'+$nl+$probe+$nl+'${frame(76,'T')}'); opens=1; writes=2; output=('READY'+$nl+'15'+$nl+'15')},
      @{name='reject open receipt'; input=('OPEN'+$nl+$probe+$nl+'${frame(48,'1,1234,1')}'); opens=1; writes=1; output=('READY'+$nl+'15'+$nl+'FAIL')},
      @{name='reject item'; input=('OPEN'+$nl+$probe+$nl+'${frame(49,'item')}'); opens=1; writes=1; output=('READY'+$nl+'15'+$nl+'FAIL')},
      @{name='reject tender'; input=('OPEN'+$nl+$probe+$nl+'${frame(53)}'); opens=1; writes=1; output=('READY'+$nl+'15'+$nl+'FAIL')},
      @{name='reject close'; input=('OPEN'+$nl+$probe+$nl+'${frame(56)}'); opens=1; writes=1; output=('READY'+$nl+'15'+$nl+'FAIL')},
      @{name='reject wrong payload'; input=('OPEN'+$nl+$probe+$nl+'${frame(76,'X')}'); opens=1; writes=1; output=('READY'+$nl+'15'+$nl+'FAIL')}
    )
    foreach ($case in $cases) {
      $port=[FakePort]::new(); if ($case.busy) {$port.Busy=$true}
      $output=[IO.StringWriter]::new()
      Invoke-Pf700CheckoutPort $port ([IO.StringReader]::new($case.input+$nl)) $output 'ReadCheckout'
      if (!$port.Disposed -or $port.Opens -ne $case.opens -or $port.Writes -ne $case.writes -or $output.ToString().Trim() -cne $case.output) {
        throw ($case.name + ': opens=' + $port.Opens + ', writes=' + $port.Writes + ', output=' + $output.ToString().Trim())
      }
    }`;
  const shell = path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    {encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stderr);
});
