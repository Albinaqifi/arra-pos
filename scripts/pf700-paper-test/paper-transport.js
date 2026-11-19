const { spawn } = require('node:child_process');
const { randomInt } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { encodeRequest, decodeResponse } = require('../../src/desktop/pf700-frame');

function receiptQueries() {
  return [
    { name: 'status', command: 0x4a, data: Buffer.from('X') },
    { name: 'document', command: 0x4c }
  ];
}

function prepareSteps(firstSequence, operations) {
  if (!Number.isInteger(firstSequence) || firstSequence < 0x20 || firstSequence > 0x7f) {
    throw new Error('Invalid initial sequence.');
  }
  return operations.map((step, index) => {
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

async function checkedData(step, exchange) {
  const response = await exchange(step);
  if (response.length === 1 && response[0] === 0x15) throw new Error('The printer rejected the frame.');
  const { data, status } = decodeResponse(response, step);
  checkReady(status);
  if (step.name === 'status') {
    if (data.length !== 6 || data.some(byte => byte < 0x80)) throw new Error('Invalid status reply.');
    checkReady(data);
  }
  return data;
}

// Only the transport can positively identify a failure before its write.
class UnsentError extends Error {}

async function withWindowsPort(makeSteps, run) {
  if (process.platform !== 'win32') throw new Error('Using COM3 requires Windows.');
  // The initial status command synchronizes with the device's last-sequence cache.
  const steps = makeSteps(randomInt(0x20, 0x80));
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
    return await run(steps, async step => {
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
}

module.exports = { receiptQueries, prepareSteps, checkedData, withWindowsPort, UnsentError };
