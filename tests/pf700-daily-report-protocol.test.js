const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createPf700DailyReportWithTransport } = require('../src/desktop/pf700-daily-report');
const { encodeRequest } = require('../src/desktop/pf700-frame');

const serial = 'SYNTHETIC01';
const expected = { total: 200, cash: 70, card: 130, receiptCount: 2, lastDocumentNumber: '0000026', taxTotals: [130, 0, 70, 0] };
const baseline = { previousClosure: 8, previousDocumentNumber: '0000026', deviceDate: '191126' };
const accepted = { status: 'accepted', reference: '0009', evidence: { closure: 9, documentNumber: '0000027' } };
const preflight = [90, 74, 76, 62, 64, 65, 67, 110, 113];
const proof = [64, 67, 110, 113];
const amount = mkd => '+' + String(mkd * 100).padStart(11, '0');

function frame(sequence, command, text, status) {
  const value = command === 74 ? status : Buffer.from(text);
  const body = Buffer.concat([Buffer.from([43 + value.length, sequence, command]), value, Buffer.from([4]), status, Buffer.from([5])]);
  const sum = body.reduce((a, b) => a + b, 0);
  return Buffer.concat([Buffer.from([1]), body, Buffer.from([12, 8, 4, 0].map(shift => 48 + (sum >> shift & 15))), Buffer.from([3])]);
}

// State lives in this simulated device across sessions and adapter restarts.
// None of its responses depend on the caller's proposed report or saved baseline.
function device(mutate = () => {}) {
  let issued = false;
  const traffic = [], operations = [];
  function openPipe(operation) {
    operations.push(operation);
    return {
      exchange(req) {
        const cmd = req[3];
        const payload = ({ 90: '0', 74: 'X', 76: 'T', 62: '', 64: '', 65: '', 67: '', 110: '', 113: '', 69: '0' })[cmd];
        assert.deepEqual(req, encodeRequest({ sequence: req[2], command: cmd, data: Buffer.from(payload) }));
        traffic.push(cmd);
        const closure = issued ? '0009' : '0008';
        const amounts = [130, 0, 70, 0].map(amount);
        let value;
        switch (cmd) {
          case 90: value = 'QA-700DEMOX,1.00MK 23OCT14 1230,BEEF,01001101,7,' + serial; break;
          case 74: value = ''; break;
          case 76: value = '0,0001,+000007000,+000007000'; break;
          case 62: value = '19-11-26 21:45:00'; break;
          case 64: value = [closure, ...(issued ? amounts : Array(4).fill(amount(0))), issued ? '191126' : '181126'].join(','); break;
          case 65: value = issued ? Array(5).fill(amount(0)).join(',') : [amount(200), ...amounts].join(','); break;
          case 67: value = [amount(issued ? 0 : 200), amount(0), issued ? '0000' : '0002', '0000'].join(','); break;
          case 110: value = [...(issued ? [0, 0, 0, 0] : [70, 0, 130, 0]).map(amount), closure, issued ? '0001' : '0003'].join(','); break;
          case 113: value = issued ? '0000027' : '0000026'; break;
          case 69:
            assert.equal(operation, 'DailyReport');
            assert.equal(issued, false);
            issued = true;
            value = ['0009', amount(0), ...amounts].join(','); break;
          default: throw Error('Unexpected PF700 operation');
        }
        const reply = { cmd, value, issued, sequence: req[2], status: Buffer.from('888080e1809a', 'hex') };
        mutate(reply);
        return frame(reply.sequence, cmd, reply.value, reply.status);
      },
      close() {}
    };
  }
  const adapter = () => createPf700DailyReportWithTransport({ mode: 'simulation', expectedSerial: serial, openPipe });
  return { adapter, traffic, operations };
}

test('one registered Z with its exact closure, tax groups and reset registers', async () => {
  const printer = device(), reports = printer.adapter();
  assert.deepEqual(await reports.issueDailyReport(expected, { beforeIssue(actual) {
    assert.deepEqual(printer.traffic, preflight);
    assert.deepEqual(actual, baseline);
  } }), accepted);
  assert.deepEqual(printer.traffic, [...preflight, 69, ...proof]);
  const count = printer.traffic.length;
  assert.deepEqual(await printer.adapter().reconcileDailyReport(expected, baseline), accepted);
  assert.deepEqual(printer.traffic.slice(count), [90, 74, 76, ...proof]);
  assert.deepEqual(printer.operations, ['DailyReport', 'ReadDailyReport']);
  assert.equal((await reports.issueDailyReport(expected, { beforeIssue() { assert.fail(); } })).status, 'failed');
  assert.equal(printer.traffic.filter(c => c === 69).length, 1);
});

test('empty or malformed local evidence and absent journal never acquire the transport', async () => {
  const printer = device(), reports = printer.adapter();
  for (const changed of [{ receiptCount: 0 }, { lastDocumentNumber: null }, { lastDocumentNumber: 26 },
    { taxTotals: [0, 0, 201, 0] }, { cash: -1 }, { total: 20.5 }, { card: 200 }, { taxTotals: [NaN, 0, 70, 0] }]) {
    assert.deepEqual(await reports.issueDailyReport({ ...expected, ...changed }, { beforeIssue() {} }), { status: 'failed' });
  }
  assert.deepEqual(await reports.issueDailyReport(expected, {}), { status: 'failed' });
  for (const changed of [{ previousClosure: 9999 }, { deviceDate: '311126' }, { previousDocumentNumber: 'invalid' }]) {
    assert.deepEqual(await reports.reconcileDailyReport(expected, { ...baseline, ...changed }), { status: 'uncertain' });
  }
  assert.deepEqual(printer.operations, []);
});

test('wrong device, unsafe status, unbound period or wrong tender stops before durable intent', async () => {
  const cases = [
    [90, r => { r.value = r.value.replace(serial, 'SYNTHETIC02'); }],
    [90, r => { r.value = '1.00 231014 1230,ABCD,0011,1,' + serial; }],
    [74, r => { r.status[5] &= ~8; }],
    [74, r => { r.status[2] |= 1; }],
    [76, r => { r.value = '1' + r.value.slice(1); }],
    [76, r => { r.status[2] |= 8; }],
    [76, r => { r.status[1] |= 8; }],
    [62, r => { r.value = '31-02-26 11:22:33'; }],
    [64, r => { r.value = r.value.replace('181126', '191126'); }],
    [64, r => { r.value = r.value.replace('181126', '201126'); }],
    [65, r => { r.value = [200, 70, 0, 130, 0].map(amount).join(','); }],
    [65, r => { r.value = [199, 130, 0, 70, 0].map(amount).join(','); }],
    [65, r => { r.value = [174, 110, 0, 64, 0].map(amount).join(','); }],
    [67, r => { r.value = r.value.replace('0002,0000', '0001,0000'); }],
    [67, r => { r.value = r.value.replace('0002,0000', '0002,0001'); }],
    [67, r => { r.value = r.value.replace(amount(0), amount(1)); }],
    [67, r => { r.value = r.value.replace(amount(200), amount(199)); }],
    [110, r => { r.value = r.value.replace(amount(130), amount(131)); }],
    [110, r => { r.value = r.value.replace(amount(0), amount(1)); }],
    [110, r => { r.value = r.value.replace('0008,0003', '0007,0003'); }],
    [110, r => { r.value = r.value.replace('0008,0003', '0008,0002'); }],
    [113, r => { r.value = '9999999'; }],
    [113, r => { r.sequence ^= 1; }]
  ];
  for (const [command, change] of cases) {
    const printer = device(r => { if (r.cmd === command) change(r); });
    let journaled = false;
    const result = await printer.adapter().issueDailyReport(expected, { beforeIssue() { journaled = true; } });
    assert.equal(result.status, 'failed', 'command ' + command);
    assert.equal(journaled, false);
    assert.equal(printer.traffic.includes(69), false);
  }
});

test('failed intent or concurrent operator cannot send a report', async () => {
  const printer = device(), reports = printer.adapter();
  let release, reached;
  const journal = new Promise(resolve => { reached = resolve; });
  const first = reports.issueDailyReport(expected, { async beforeIssue() {
    reached();
    await new Promise(resolve => { release = resolve; });
    throw Error('Database unavailable');
  } });
  await journal;
  assert.equal((await reports.issueDailyReport(expected, { beforeIssue() {} })).status, 'failed');
  release();
  assert.equal((await first).status, 'failed');
  assert.deepEqual(printer.traffic, preflight);
});

test('lost acknowledgement is uncertain; read-only recovery requires the exact persisted closure', async () => {
  let alterRecord = false;
  const printer = device(r => {
    if (r.cmd === 69) throw Error('Lost acknowledgement');
    if (alterRecord && r.cmd === 64) r.value = r.value.replace(amount(70), amount(71));
  });
  assert.equal((await printer.adapter().issueDailyReport(expected, { beforeIssue() {} })).status, 'uncertain');
  alterRecord = true;
  assert.equal((await printer.adapter().reconcileDailyReport(expected, baseline)).status, 'uncertain');
  alterRecord = false;
  assert.deepEqual(await printer.adapter().reconcileDailyReport(expected, baseline), accepted);
  assert.equal(printer.traffic.filter(c => c === 69).length, 1);
  assert.deepEqual(printer.operations, ['DailyReport', 'ReadDailyReport', 'ReadDailyReport']);
});

test('read-only recovery proves nonissuance only with the same open fiscal period and original document', async () => {
  for (const clock of ['19-11-26 21:45:00', '20-11-26 09:00:00']) {
    const printer = device(r => { if (r.cmd === 62) r.value = clock; });
    assert.deepEqual(await printer.adapter().reconcileDailyReport(expected, baseline),
      { status: 'not-issued', evidence: { closure: 8, documentNumber: '0000026', deviceDate: '191126' } });
    assert.deepEqual(printer.operations, ['ReadDailyReport']);
    assert.deepEqual(printer.traffic, [90, 74, 76, 64, 62, 65, 67, 110, 113]);
  }
  for (const [command, mutate] of [
    [90, r => { r.value = r.value.replace(serial, 'SYNTHETIC02'); }],
    [74, r => { r.status[5] &= ~8; }],
    [76, r => { r.value = '1' + r.value.slice(1); }],
    [64, r => { r.value = r.value.replace('0008', '0007'); }],
    [64, r => { r.value = r.value.replace('181126', '191126'); }],
    [62, r => { r.value = '18-11-26 21:45:00'; }],
    [65, r => { r.value = [200, 70, 0, 130, 0].map(amount).join(','); }],
    [67, r => { r.value = r.value.replace('0002,0000', '0003,0000'); }],
    [67, r => { r.value = r.value.replace(amount(200), amount(201)); }],
    [110, r => { r.value = [130, 0, 70, 0].map(amount).concat(['0008', '0003']).join(','); }],
    [113, r => { r.value = '0000027'; }]
  ]) {
    const printer = device(r => { if (r.cmd === command) mutate(r); });
    assert.deepEqual(await printer.adapter().reconcileDailyReport(expected, baseline), { status: 'uncertain' });
    assert.deepEqual(printer.operations, ['ReadDailyReport']);
    assert.equal(printer.traffic.includes(69), false);
  }
});

test('ambiguous response, mismatched fiscal memory, uncleared balances or advanced document never acknowledge a report', async () => {
  for (const [command, mutate] of [
    [69, r => { r.value = '0009'; }], [69, r => { r.value = r.value.replace(amount(130), amount(13)); }],
    [64, r => { r.value = r.value.replace('0009', '0010'); }], [64, r => { r.value = r.value.replace('191126', '201126'); }],
    [67, r => { r.value = r.value.replace(amount(0), amount(1)); }], [110, r => { r.value = r.value.replace('0009', '0010'); }],
    [113, r => { r.value = '0000028'; }]
  ]) {
    const printer = device(r => { if (r.issued && r.cmd === command) mutate(r); });
    assert.equal((await printer.adapter().issueDailyReport(expected, { beforeIssue() {} })).status, 'uncertain');
    assert.equal(printer.traffic.filter(c => c === 69).length, 1);
  }
});

test('Windows report exchange restricts command and payload, permits a long busy reply, and disposes the synthetic port', {
  skip: process.platform !== 'win32'
}, () => {
  const helper = path.resolve(__dirname, '../src/desktop/pf700-checkout-exchange.ps1').replaceAll("'", "''");
  const packet = (command, value) => encodeRequest({ sequence: 32, command, data: Buffer.from(value),
    allowedControls: command === 53 ? [9] : [] }).toString('hex');
  const probe = packet(90, '0'), report = packet(69, '0'), read = packet(64, '');
  // This dot-sources the helper and passes a memory object. Its executable
  // entry point, which constructs a real SerialPort, is never called.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    ". '" + helper + "'",
    'class ReportPort {',
    '  [int]$BytesToRead = 0; [int]$Writes = 0; [bool]$Disposed = $false',
    '  [Collections.Generic.Queue[int]]$Bytes = [Collections.Generic.Queue[int]]::new()',
    '  [void]Open() {}',
    '  [void]Write([byte[]]$request,[int]$start,[int]$length) {',
    '    $this.Writes++',
    '    if ($request[3] -eq 69) { for ($i=0; $i -lt 80; $i++) { $this.Bytes.Enqueue(22) } }',
    '    foreach ($b in @(1,43,32,64,4,136,128,128,225,128,154,5,48,48,48,48,3)) { $this.Bytes.Enqueue($b) }',
    '  }',
    '  [int]ReadByte() { return $this.Bytes.Dequeue() }',
    '  [void]Dispose() { $this.Disposed = $true }',
    '}',
    'function Check-Frames($mode, $lines, $writes, $denied) {',
    '  $port = [ReportPort]::new(); $outbox = [IO.StringWriter]::new()',
    '  Invoke-Pf700CheckoutPort $port ([IO.StringReader]::new(($lines -join [Environment]::NewLine))) $outbox $mode',
    "  if (!$port.Disposed -or $port.Writes -ne $writes -or $outbox.ToString().Contains('FAIL') -ne $denied) { throw 'Invalid report stream' }",
    '}',
    ...[
      ['PrinterControl', [probe, packet(69, '2')], 2, false],
      ['PrinterControl', [probe, packet(69, '2'), packet(69, '2')], 2, true],
      ['PrinterControl', [probe, report], 1, true],
      ['PrinterControl', [probe, read], 1, true],
      ['PrinterControl', [packet(69, '2')], 0, true],
      ['DailyReport', [probe, read, packet(65, ''), report], 4, false],
      ['DailyReport', [probe, report, report], 2, true],
      ['DailyReport', [probe, packet(69, '2')], 1, true],
      ['DailyReport', [probe, packet(53, '')], 1, true],
      ['DailyReport', [probe, packet(48, '')], 1, true],
      ['ReadDailyReport', [probe, read], 2, false],
      ['ReadDailyReport', [probe, report], 1, true],
      ['Checkout', [probe, report], 1, true],
      ['Checkout', [probe, packet(110, '')], 1, true],
      ['Checkout', [probe, packet(53, '\t'), packet(53, '\tP140')], 3, false],
      ['Checkout', [probe, packet(53, '\tD140')], 1, true],
      ['CardTrial', [probe, packet(110, ''), packet(53, '\tD140')], 3, false],
      ['CardTrial', [probe, packet(53, '\t')], 1, true],
      ['CardTrial', [probe, packet(53, '\tP140')], 1, true],
      ['CardTrial', [probe, packet(110, '0')], 1, true],
      ['CardTrial', [probe, report], 1, true],
      ['DailyReport', [report], 0, true]
    ].map(([operation, lines, count, denied]) => 'Check-Frames ' + operation + " @('" +
      lines.join("','") + "') " + count + ' $' + denied)
  ].join('\n');
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});
test('any valid document difference warns without printing, including a lower number',async()=>{
  for(const document of ['0000024','0000028','0009999']) {
    const printer=device(r=>{if(r.cmd===113 && !r.issued) r.value=document;});
    const result=await printer.adapter().issueDailyReport(expected,{beforeIssue(){assert.fail('No issue before warning');}});
    assert.deepEqual(result,{status:'document-warning',saleDocument:'0000026',printerDocument:document,deviceDate:'191126'});
    assert.equal(printer.traffic.includes(69),false);
  }
});
test('a changed document number requires a fresh warning before issue',async()=>{
  const printer=device(r=>{if(r.cmd===113 && !r.issued) r.value='0000029';});
  const result=await printer.adapter().issueDailyReport(expected,{warningDocument:'0000028',beforeIssue(){assert.fail('stale warning');}});
  assert.deepEqual(result,{status:'document-warning',saleDocument:'0000026',printerDocument:'0000029',deviceDate:'191126'});
  assert.equal(printer.traffic.includes(69),false);
});
