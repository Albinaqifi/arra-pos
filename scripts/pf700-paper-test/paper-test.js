// Standalone operator tool. Accent PF550/PF700 control codes v1.40, commands 74, 76 and 71.
const { spawn } = require('node:child_process');
const { randomInt } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { encodeRequest, decodeResponse } = require('../../src/desktop/pf700-frame');

function paperSteps(firstSequence) {
  if (!Number.isInteger(firstSequence) || firstSequence < 0x20 || firstSequence > 0x7f) {
    throw new Error('Invalid initial sequence.');
  }
  return [
    { name: 'status', command: 0x4a, data: Buffer.from('X') },
    { name: 'document', command: 0x4c },
    { name: 'print', command: 0x47 }
  ].map((step, index) => {
    const sequence = 0x20 + (firstSequence - 0x20 + index) % 0x60;
    return { ...step, sequence, request: encodeRequest({ ...step, sequence }) };
  });
}

function checkReady(status) {
  if (status[1] & 0x20) throw new Error('The printer cover is open.');
  if (status[2] & 0x05) throw new Error('The printer reports an empty paper roll.');
  if ((status[1] & 0x08) || (status[2] & 0x08)) throw new Error('The printer has an open receipt.');
  // Retain unused bits and normal installation flags. Low paper is a warning.
  if ((status[0] & 0x37) || (status[1] & 0x17) || (status[4] & 0x35) || (status[5] & 0x01)) {
    throw new Error('The printer reports a command, device or fiscal-memory error.');
  }
}

function checkDocument(data) {
  const fields = data.toString('latin1').split(',');
  // Accent specifies widths, but does not illustrate positive-sign padding.
  // Amounts and counts are validated in memory and never shown or recorded.
  const amount = value => value.length === 9 && /^ *[+-]?[0-9]+$/.test(value);
  if ((fields.length !== 3 && fields.length !== 4) || !/^[01]$/.test(fields[0]) ||
      fields[1].length !== 4 || !/^ *[0-9]+$/.test(fields[1]) ||
      !amount(fields[2]) || (fields.length === 4 && !amount(fields[3]))) {
    throw new Error('Invalid receipt-state reply.');
  }
  if (fields[0] === '1') throw new Error('The printer has an open document.');
}

// Only the transport can positively identify a failure before its print write.
class UnsentError extends Error {}

async function exchangeSteps(steps, exchange) {
  for (const step of steps) {
    try {
      const response = await exchange(step);
      if (response.length === 1 && response[0] === 0x15) throw new Error('The printer rejected the frame.');
      const { data, status } = decodeResponse(response, step);
      checkReady(status);
      if (step.name === 'status') {
        if (data.length !== 6 || data.some(byte => byte < 0x80)) throw new Error('Invalid status reply.');
        checkReady(data);
      } else if (step.name === 'document') {
        checkDocument(data);
      } else if (data.length !== 0) {
        throw new Error('Unexpected data in the diagnostic reply.');
      }
    } catch (error) {
      if (step.name === 'print' && !(error instanceof UnsentError)) {
        throw new Error(`Paper outcome is uncertain. Check the printer and paper before another attempt. ${error.message}`);
      }
      throw new Error(`No print command was sent. ${error.message}`);
    }
  }
}

function runSequence(firstSequence, exchange) {
  return exchangeSteps(paperSteps(firstSequence), exchange);
}

async function windowsPaperTest() {
  if (process.platform !== 'win32') throw new Error('A live paper test requires Windows.');
  // The first command synchronizes with the printer's last-sequence cache.
  // The document check and the print each use a different subsequent sequence.
  const steps = paperSteps(randomInt(0x20, 0x80));
  const helper = readFileSync(path.join(__dirname, 'paper-exchange.ps1'), 'utf8');
  const requests = steps.map(step => `${step.name} = [byte[]]@(${[...step.request].join(',')})`).join('\n');
  const script = `
$ErrorActionPreference = 'Stop'
${helper}
$requests = @{
${requests}
}
$port = [IO.Ports.SerialPort]::new('COM3', 9600, [IO.Ports.Parity]::None, 8, [IO.Ports.StopBits]::One)
$port.Handshake = [IO.Ports.Handshake]::None
$port.DtrEnable = $false
$port.RtsEnable = $false
$port.WriteTimeout = 500
$port.ReadTimeout = 1000
Invoke-Pf700PaperExchange $port $requests`;
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true, timeout: 70000, stdio: ['pipe', 'pipe', 'ignore']
  });
  // A child that exits before opening the port also closes the reply stream.
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  const closed = new Promise(resolve => child.once('close', resolve));
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const replies = lines[Symbol.asyncIterator]();
  try {
    await exchangeSteps(steps, async step => {
      child.stdin.write(step.name + '\n');
      const { value, done } = await replies.next();
      if (done) throw new Error('The Windows serial connection ended without a complete reply.');
      if (value === 'UNSENT pending-data') throw new UnsentError('COM3 already contains unexpected data.');
      if (value === 'UNSENT serial-error') throw new UnsentError('Check COM3, the printer and other programs using the port.');
      if (!/^(?:[0-9A-F]{2}){1,101}$/.test(value)) throw new Error('The Windows serial exchange did not complete.');
      return Buffer.from(value, 'hex');
    });
  } finally {
    child.stdin.end();
    await closed;
  }
  return 'PF700 acknowledged the diagnostic command on COM3. Check for one diagnostic slip on the printer.';
}

async function runDiagnostic(args, live = windowsPaperTest) {
  if (args.length === 0) {
    // Synthetic closed-document data with the owner's observed six status bytes.
    const replies = [
      '0131204a888080e1809a04888080e1809a0530373a3a03',
      '013b214c302c303030302c30303030303030303004888080e1809a053037323c03',
      '012b224704888080e1809a053034323003'
    ];
    await runSequence(0x20, () => Buffer.from(replies.shift(), 'hex'));
    return 'Offline PF700 paper-test rehearsal passed using simulated replies. No printer was contacted.';
  }
  if (args.length !== 1 || args[0] !== '--print-diagnostic-slip') {
    throw new Error('Use no arguments for rehearsal or --print-diagnostic-slip for one live diagnostic.');
  }
  return live();
}

if (require.main === module) {
  runDiagnostic(process.argv.slice(2)).then(console.log, error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { runDiagnostic, runSequence };
