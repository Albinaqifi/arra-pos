const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runIdentityCheck } = require('../scripts/pf700-paper-test/check-identity-layout');

const desktopSource = path.resolve(__dirname, '../src/desktop');
const diagnosticSource = path.resolve(__dirname, '../scripts/pf700-paper-test');
const label = 'DemoLAB0001';
const fields = ['[FP-700CRX]', '1.00MK 23Oct14 1200', 'BEEF', '01001101', '7', label];
const normal = Buffer.from('888080e1809a', 'hex');
const helperName = 'pf700-checkout-exchange.ps1';
const live = ['--compare-identity'];
const windows = {skip: process.platform !== 'win32'};

// Build replies independently of the codec the diagnostic loads from the payload.
function bcc(bytes) {
  const sum = bytes.reduce((total, byte) => total + byte, 0);
  return [12, 8, 4, 0].map(shift => 0x30 + ((sum >> shift) & 15));
}

function reply(request, { data = fields.join(','), status = normal, sequence = request[2], command = 90 } = {}) {
  const payload = Buffer.from(data, 'latin1');
  const body = [0x2b + payload.length, sequence, command, ...payload, 4, ...status, 5];
  return Buffer.from([1, ...body, ...bcc(body), 3]);
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'Arra identity test '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const payloadDir = path.join(root, 'extracted 1.0.4', 'payload');
  const app = path.join(payloadDir, 'resources', 'app');
  const desktop = path.join(app, 'src', 'desktop');
  fs.mkdirSync(desktop, { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({version: '1.0.4'}));
  fs.copyFileSync(path.join(desktopSource, 'pf700-frame.js'), path.join(desktop, 'pf700-frame.js'));
  fs.copyFileSync(path.join(desktopSource, 'pf700-commissioning.js'), path.join(desktop, 'pf700-commissioning.js'));
  fs.writeFileSync(path.join(desktop, helperName), "throw 'Inert test helper'");
  return { root, payloadDir, desktop };
}

function probe(payloadDir, { args = live, entered = label, available = true, respond = request => reply(request) } = {}) {
  const sent = [];
  const result = runIdentityCheck(args, {
    payloadDir,
    readSerial: () => entered,
    deviceTrial: () => ({ available: () => available }),
    spawnSync(executable, argv, options) {
      const input = String(options.input);
      sent.push({executable, argv, input});
      const response = respond(Buffer.from(input.trimEnd(), 'hex'));
      return Buffer.isBuffer(response)
        ? {status: 0, stdout: response.toString('hex').toUpperCase() + '\r\n', stderr: ''}
        : response;
    }
  });
  assert.ok(!result.message.includes(label));
  return { ...result, sent };
}

function checkSingleRequest(sent) {
  assert.equal(sent.length, 1);
  const [{executable, argv, input}] = sent;
  assert.ok(![executable, ...argv, input].join(' ').includes(label));
  assert.match(input, /^[0-9a-f]{22}\n$/);
  const bytes = Buffer.from(input.trimEnd(), 'hex');
  assert.ok(bytes[2] >= 0x20 && bytes[2] <= 0x7f);
  const body = [0x25, bytes[2], 90, 0x30, 5];
  assert.deepEqual(bytes, Buffer.from([1, ...body, ...bcc(body), 3]));
}

test('the diagnostic requires the correct payload version, exact option, valid label and an available trial', t => {
  const { payloadDir } = fixture(t);
  const rehearsal = probe(payloadDir, {args: []});
  assert.equal(rehearsal.code, 0);
  assert.match(rehearsal.message, /offline/i);
  assert.deepEqual(rehearsal.sent, []);
  for (const options of [
    {args: ['--compare-id']}, {args: ['--COMPARE-IDENTITY']}, {args: [...live, 'extra']},
    {args: ['--start-sale']}, {entered: ''}, {entered: label + ' '},
    {entered: label + '\n' + label}, {entered: label + '\n\n'}, {entered: label.slice(1)}, {available: false},
  ]) {
    const result = probe(payloadDir, options);
    assert.notEqual(result.code, 0);
    assert.deepEqual(result.sent, []);
  }
  fs.writeFileSync(path.join(payloadDir, 'resources', 'app', 'package.json'), '{"version":"1.0.3"}');
  const wrongPayload = probe(payloadDir);
  assert.notEqual(wrongPayload.code, 0);
  assert.deepEqual(wrongPayload.sent, []);
});

test('one command 90/0 compares a matching label in field six', windows, t => {
  const { payloadDir } = fixture(t);
  const result = probe(payloadDir, {entered: label + '\r\n'});
  checkSingleRequest(result.sent);
  assert.equal(result.code, 0, result.message);
  assert.match(result.message, /Last field matches entered label: yes/i);
  assert.match(result.message, /Exact match positions: 6\b/i);
  assert.match(result.message, /Field widths: 11\/19\/4\/8\/1\/11/i);
  assert.match(result.message, /checkout identity remains unconfirmed/i);
});

test('comparison is byte exact, reports the field position and keeps reply values private', windows, t => {
  const { payloadDir } = fixture(t);
  for (const [first, last, positions] of [
    ['SecretAlias', label.toLowerCase(), 'none'],
    [label, 'Private0002', '1'],
  ]) {
    const data = [first, 'SamplePrivateHeader', ...fields.slice(2, 5), last].join(',');
    const result = probe(payloadDir, {respond: request => reply(request, {data})});
    checkSingleRequest(result.sent);
    assert.notEqual(result.code, 0);
    assert.match(result.message, /Last field matches entered label: no/i);
    assert.ok(result.message.toLowerCase().includes('exact match positions: ' + positions));
    for (const value of [first, last, 'SamplePrivateHeader', fields[2], fields[3]]) {
      assert.ok(!result.message.includes(value));
    }
  }
});

test('duplicate matches and unexpected layouts stay unconfirmed even when the final field matches', windows, t => {
  const { payloadDir } = fixture(t);
  const duplicated = probe(payloadDir, {respond: r => reply(r, {data: [label, ...fields.slice(1)].join(',')})});
  checkSingleRequest(duplicated.sent);
  assert.notEqual(duplicated.code, 0);
  assert.match(duplicated.message, /Exact match positions: 1, 6\b/i);
  assert.match(duplicated.message, /ambiguous/i);
  for (const data of [
    fields.slice(1).join(','), fields.join(',') + ',',
    [fields[0], fields[1], 'G000', ...fields.slice(3)].join(','),
    [fields[0], fields[1], fields[2], '00101201', ...fields.slice(4)].join(','),
    [fields[0], fields[1], fields[2], fields[3], 'x', label].join(','),
    ['Other model', ...fields.slice(1)].join(','), fields.join(',').replace('F', '\xff'),
  ]) {
    const result = probe(payloadDir, {respond: r => reply(r, {data})});
    checkSingleRequest(result.sent);
    assert.notEqual(result.code, 0);
    assert.match(result.message, /unsupported/i);
  }
});

test('missing, corrupt, stale and error-bearing responses cannot report a successful identity comparison', windows, t => {
  const { payloadDir } = fixture(t);
  const unsafe = Buffer.from(normal);
  unsafe[0] |= 2;
  const errorText = 'PrivateFixtureError';
  for (const respond of [
    () => Buffer.from([0x15]), () => Buffer.alloc(0),
    r => reply(r, {sequence: r[2] ^ 1}), r => reply(r, {command: 91}),
    r => { const frame = reply(r); frame[frame.length - 3] ^= 1; return frame; },
    r => reply(r, {status: unsafe}),
    () => ({ status: 1, stdout: '', stderr: errorText }),
    () => ({ status: null, stdout: '', error: Error(errorText) }),
    () => ({ status: 0, stdout: errorText, stderr: '' }),
    r => ({ status: 0, stdout: reply(r).toString('hex').toUpperCase() + '\r\n' + errorText, stderr: '' }),
  ]) {
    const result = probe(payloadDir, {respond});
    checkSingleRequest(result.sent);
    assert.notEqual(result.code, 0);
    assert.ok(!result.message.includes(errorText));
    assert.doesNotMatch(result.message, /Exact match positions:|Last field matches entered label:/i);
  }
});

test('the Windows launcher locates an extracted payload and compares privately through the packaged helper interface',
  windows, t => {
    const { root, payloadDir, desktop } = fixture(t);
    const helperLog = path.join(root, 'simulated requests');
    const local = path.join(root, 'private local app data');
    fs.mkdirSync(local);
    const cmd = path.join(process.env.SystemRoot, 'System32', 'cmd.exe');
    fs.copyFileSync(process.execPath, path.join(payloadDir, 'electron.exe'));
    // Stand-in for the serial-port helper. Read one request to EOF and respond in its sequence.
    // The original COM helper is never copied to this fixture.
    const template = reply(Buffer.from([1, 0x25, 0x20])).toString('hex');
    fs.writeFileSync(path.join(desktop, helperName), `
      $ErrorActionPreference = 'Stop'
      $line = [Console]::In.ReadToEnd().TrimEnd()
      if ($line -cnotmatch '^0125([0-9a-f]{2})5a3005[0-9a-f]{8}03$') { exit 2 }
      $sequence = [Convert]::ToByte($Matches[1], 16)
      [IO.File]::AppendAllText($env:TEST_HELPER_LOG, "90/0" + [Environment]::NewLine)
      $hex = '${template}'
      [byte[]]$frame = for ($i = 0; $i -lt $hex.Length; $i += 2) { [Convert]::ToByte($hex.Substring($i, 2), 16) }
      $frame[2] = $sequence
      $sum = ($frame[1..($frame.Length - 6)] | Measure-Object -Sum).Sum
      for ($i = 0; $i -lt 4; $i++) { $frame[$frame.Length - 5 + $i] = 48 + (($sum -shr (12 - 4 * $i)) -band 15) }
      [Console]::WriteLine([BitConverter]::ToString($frame).Replace('-', ''))
    `);
    const launch = (directory, input) => {
      for (const file of ['PF700-Compare-Identity.cmd', 'check-identity-layout.js', 'compare-identity.ps1']) {
        fs.copyFileSync(path.join(diagnosticSource, file), path.join(directory, file));
      }
      const execution = spawnSync(cmd, ['/d', '/c', 'PF700-Compare-Identity.cmd'], {
        cwd: directory, env: {...process.env, LOCALAPPDATA: local, TEST_HELPER_LOG: helperLog},
        input: input + '\r\n', encoding: 'utf8', timeout: 20000, windowsHide: true,
      });
      assert.ifError(execution.error);
      return {status: execution.status, text: execution.stdout + execution.stderr};
    };
    const subfolder = path.join(payloadDir, 'Arra identity comparison');
    fs.mkdirSync(subfolder);
    const cancelled = launch(subfolder, '');
    assert.equal(cancelled.status, 0);
    assert.equal(fs.existsSync(helperLog), false);
    for (const directory of [payloadDir, subfolder]) {
      const result = launch(directory, label);
      assert.equal(result.status, 0, result.text.replaceAll(label, '[test input]'));
      assert.match(result.text, /Last field matches entered label: yes/i);
      assert.ok(!result.text.includes(label), 'serial echoed in launcher output');
    }
    assert.deepEqual(fs.readFileSync(helperLog, 'utf8').trimEnd().split(/\r?\n/), ['90/0', '90/0']);
    assert.deepEqual(fs.readdirSync(local), []);
  });
