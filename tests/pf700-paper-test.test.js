const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { runSequence, runDiagnostic } = require('../scripts/pf700-paper-test/paper-test');

const baseline = Buffer.from('888080e1809a', 'hex');
const closed = Buffer.from('0,0000,000000000');
const exampleReplies = [
  '0131204a888080e1809a04888080e1809a0530373a3a03',
  '013b214c302c303030302c30303030303030303004888080e1809a053037323c03',
  '012b224704888080e1809a053034323003'
];

function reply(step, { data, status = baseline, sequence = step.sequence, command = step.command } = {}) {
  const payload = data ?? ({ status: baseline, document: closed, print: Buffer.alloc(0) })[step.name];
  const body = Buffer.from([0x2b + payload.length, sequence, command, ...payload, 0x04, ...status, 0x05]);
  const sum = body.reduce((total, byte) => total + byte, 0);
  const bcc = sum.toString(16).padStart(4, '0').split('').map(digit => 0x30 + parseInt(digit, 16));
  return Buffer.from([1, ...body, ...bcc, 3]);
}

test('paper-test CLI defaults to rehearsal and accepts just the exact explicit live option', async () => {
  let calls = 0;
  const live = () => { calls++; return 'stub'; };
  assert.match(await runDiagnostic([], live), /Offline.*simulated/);
  for (const args of [['--print'], ['--PRINT-DIAGNOSTIC-SLIP'], ['--print-diagnostic-slip', 'COM3'], ['0x47']]) {
    await assert.rejects(runDiagnostic(args, live), /Use no arguments/);
  }
  assert.equal(calls, 0);
  assert.equal(await runDiagnostic(['--print-diagnostic-slip'], live), 'stub');
  assert.equal(calls, 1);
});

test('status, fresh document query and a single empty diagnostic use the expected wire vectors', async () => {
  const requests = [];
  await runSequence(0x20, step => {
    requests.push(step.request.toString('hex'));
    return Buffer.from(exampleReplies[requests.length - 1], 'hex');
  });
  assert.deepEqual(requests, ['0125204a580530303e3c03', '0124214c053030393603', '01242247053030393203']);
  const sequences = [];
  await runSequence(0x7e, step => {
    sequences.push(step.sequence);
    return reply(step);
  });
  assert.deepEqual(sequences, [0x7e, 0x7f, 0x20]);
});

test('stale, malformed or missing preflight replies stop before the print command', async () => {
  for (const name of ['status', 'document']) {
    for (const invalid of [
      step => reply(step, { sequence: step.sequence + 1 }),
      step => reply(step, { command: 0x47 }),
      step => reply(step, { data: Buffer.alloc(0) }),
      step => { const damaged = reply(step); damaged[damaged.length - 4] ^= 1; return damaged; },
      () => Buffer.from([0x15]),
      () => { throw new Error('Timeout'); }
    ]) {
      const sent = [];
      await assert.rejects(runSequence(0x20, step => {
        sent.push(step.name);
        return step.name === name ? invalid(step) : reply(step);
      }), /No print command was sent/);
      assert.deepEqual(sent, name === 'status' ? ['status'] : ['status', 'document']);
    }
  }
});

test('only a valid closed receipt-state tuple permits the diagnostic', async () => {
  for (const data of ['1,0000,000000000', '2,0000,000000000', '0,000,000000000', '0,0000,12',
    '0,0000,_________', '0,xxxx,000000000', '0,0000,000000000,', '0,0000,000000000,000000000,extra']) {
    const sent = [];
    await assert.rejects(runSequence(0x20, step => {
      sent.push(step.name);
      return reply(step, step.name === 'document' ? { data: Buffer.from(data) } : {});
    }), /No print command was sent/);
    assert.deepEqual(sent, ['status', 'document']);
  }
  await runSequence(0x20, step => reply(step, step.name === 'document'
    ? { data: Buffer.from('0,   0,+00000000,-00000000') } : {}));
});

test('checks status data and frame trailers for device errors, open receipts and paper out', async () => {
  for (const [byte, mask] of [[0, 0x01], [0, 0x02], [0, 0x10], [0, 0x20],
    [1, 0x02], [1, 0x08], [1, 0x20], [2, 0x01], [2, 0x04], [2, 0x08], [4, 0x20], [5, 1]]) {
    const unsafe = Buffer.from(baseline);
    unsafe[byte] |= mask;
    for (const [phase, field] of [['status', 'data'], ['status', 'status'], ['document', 'status']]) {
      let last;
      await assert.rejects(runSequence(0x20, step => {
        last = step.name;
        return reply(step, step.name === phase ? { [field]: unsafe } : {});
      }), /No print command was sent/);
      assert.equal(last, phase);
    }
  }
  const lowPaper = Buffer.from(baseline);
  lowPaper[2] |= 0x12;
  await runSequence(0x20, step => reply(step, { status: lowPaper }));
});

test('timeout, NAK, invalid, error-bearing or stale print reply is uncertain and never retried', async () => {
  const paperOut = Buffer.from(baseline);
  paperOut[2] |= 1;
  for (const result of [
    () => { throw new Error('Timeout'); },
    () => Buffer.from([0x15]),
    step => reply(step, { sequence: step.sequence - 1 }),
    step => reply(step, { command: 0x4c }),
    step => reply(step, { status: paperOut }),
    step => reply(step, { data: Buffer.from('X') }),
    step => reply(step).subarray(0, 8),
    step => { const frame = reply(step); frame[12] ^= 1; return frame; }
  ]) {
    const sent = [];
    await assert.rejects(runSequence(0x20, step => {
      sent.push(step.name);
      return step.name === 'print' ? result(step) : reply(step);
    }), /uncertain.*Check the printer and paper/);
    assert.deepEqual(sent, ['status', 'document', 'print']);
  }
});

test('Windows paper exchange uses one handle, strips busy bytes and respects withdrawn permission', {
  skip: process.platform !== 'win32'
}, () => {
  const helper = readFileSync(path.join(__dirname, '../scripts/pf700-paper-test/paper-exchange.ps1'), 'utf8');
  // In-memory port, with no serial enumeration or IO.Ports.SerialPort instance.
  const script = `
$ErrorActionPreference = 'Stop'
${helper}
class FakePort {
    [int]$Opened
    [int]$Disposed
    [int]$BytesToRead
    [Collections.Generic.List[byte]]$Written = [Collections.Generic.List[byte]]::new()
    [Collections.Generic.Queue[byte]]$Reply = [Collections.Generic.Queue[byte]]::new()
    [void]Open() { $this.Opened++ }
    [void]Dispose() { $this.Disposed++ }
    [void]Write([byte[]]$value, [int]$offset, [int]$length) {
        $this.Written.Add($value[$offset])
        foreach ($b in @(22, 22, 1, 3)) { $this.Reply.Enqueue($b) }
    }
    [int]ReadByte() { return $this.Reply.Dequeue() }
}
$requests = @{status = @(74); document = @(76); print = @(71)}
function Check-Fake($markers, $wantWrites) {
    $port = [FakePort]::new()
    [Console]::SetIn([IO.StringReader]::new($markers))
    $capture = [IO.StringWriter]::new()
    [Console]::SetOut($capture)
    Invoke-Pf700PaperExchange $port $requests
    if ($port.Opened -ne 1 -or $port.Disposed -ne 1 -or ($port.Written -join ',') -cne $wantWrites) {
        throw 'Unexpected port lifecycle or command sequence.'
    }
    $actual = $capture.ToString().Trim().Split([Environment]::NewLine, [StringSplitOptions]::RemoveEmptyEntries)
    if ($actual.Count -ne $port.Written.Count -or @($actual | Where-Object { $_ -cne '0103' }).Count) {
        throw 'Unexpected mock reply.'
    }
}
Check-Fake ("status" + [Environment]::NewLine + "document" + [Environment]::NewLine + "print") '74,76,71'
Check-Fake ("status" + [Environment]::NewLine + "document") '74,76'
Check-Fake ("status" + [Environment]::NewLine + "print") '74'
exit 0`;
  execFileSync(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 12000, stdio: ['ignore', 'pipe', 'pipe'] });
});
