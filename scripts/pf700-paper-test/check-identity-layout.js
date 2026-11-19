// Run with the existing 1.0.4 Electron runtime, from its extracted payload.
const fs = require('node:fs');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const { spawnSync: spawnProcess } = require('node:child_process');

const failed = message => ({ code: 1, message });

function readPrivateSerial() {
  if (process.stdin.isTTY) return '';
  // Eleven ASCII characters, with room for CRLF and one excess byte.
  const bytes = Buffer.alloc(14);
  try {
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(0, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    return bytes.toString('utf8', 0, length);
  } finally {
    bytes.fill(0);
  }
}

function fieldShape(field) {
  return field.replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/[0-9]/g, '#')
    .replace(/ /g, '_').replace(/[^Aa#_.:/-]/g, '?');
}

function compareFields(data, expectedSerial) {
  if (data.some(byte => byte < 0x20 || byte > 0x7e)) {
    return failed('Unsupported identity layout. The reply contains non-printable or non-ASCII bytes.');
  }
  const fields = data.toString('latin1').split(',');
  const [first, second = '', checksum, switches, country, serial] = fields;
  const widths = fields.map(field => field.length).join('/');
  const positions = fields.flatMap((field, index) => field === expectedSerial ? [index + 1] : []);
  const lastMatches = fields.at(-1) === expectedSerial;
  const observedShape = widths === '11/19/4/8/1/11' && !first.includes(' ') &&
    /^[0-9A-Fa-f]{4}$/.test(checksum) && /^[01]{8}$/.test(switches) &&
    /^[0-9]$/.test(country) && /^[A-Za-z0-9]{11}$/.test(serial);
  const headers = [first, second];
  const has = pattern => headers.some(field => pattern.test(field));
  const markers = [];
  if (has(/(?:^|[^A-Za-z0-9])FP-700CRX(?=$|[^A-Za-z0-9])/)) markers.push('FP-700CRX');
  if (has(/(?:^|[^A-Za-z0-9.])1\.00MK(?=$|[^A-Za-z0-9])/)) markers.push('1.00MK');
  if (has(/(?:^|[^A-Za-z0-9])(?:231014|23OCT14|23-OCT-2014)(?=$|[^A-Za-z0-9])/i)) {
    markers.push('23 October 2014');
  }
  const message = [
    `Field widths: ${widths}`,
    `Field 1 shape: ${fieldShape(first) || '(empty)'}`,
    `Field 2 shape: ${fieldShape(second) || '(empty or absent)'}`,
    'Shape key: A uppercase, a lowercase, # digit, _ space, ? other punctuation.',
    `Known markers in fields 1 and 2: ${markers.join(', ') || 'none'}`,
    observedShape ? 'Six-field diagnostic layout matches the observed format.' : 'Unsupported identity layout.',
    `Last field matches entered label: ${lastMatches ? 'yes' : 'no'}`,
    `Exact match positions: ${positions.join(', ') || 'none'}`,
    ...(positions.length > 1 ? ['Ambiguous comparison. Several fields match the entered label.'] : []),
    'Diagnostic comparison only. Fiscal checkout identity remains unconfirmed.'
  ].join('\n');
  return { code: observedShape && lastMatches && positions.length === 1 ? 0 : 1, message };
}

function runIdentityCheck(args, { payloadDir = process.cwd(), readSerial = readPrivateSerial,
  deviceTrial, spawnSync = spawnProcess } = {}) {
  if (args.length && (args.length !== 1 || args[0] !== '--compare-identity')) {
    return failed('Use no arguments for offline mode or --compare-identity for the attended comparison.');
  }
  const app = path.join(payloadDir, 'resources', 'app');
  const desktop = path.join(app, 'src', 'desktop');
  try {
    if (JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).version !== '1.0.4') {
      return failed('This diagnostic requires the extracted Arra 1.0.4 payload.');
    }
  } catch {
    return failed('This diagnostic requires the extracted Arra 1.0.4 payload.');
  }
  if (!args.length) return { code: 0, message: 'Offline mode. No device request was sent.' };
  let serial;
  try {
    serial = readSerial().replace(/\r?\n$/, '');
    if (!/^[A-Za-z0-9]{11}$/.test(serial)) return failed('Check the 11-character printer label.');
  } catch {
    return failed('Could not read the private printer label.');
  }
  try {
    const trial = deviceTrial || require(path.join(desktop, 'pf700-commissioning')).deviceTrial;
    if (!trial(serial).available()) {
      return failed('A supervised trial was already attempted. Review the saved bill before using diagnostics.');
    }
  } catch {
    return failed('Could not verify supervised trial availability. No request was sent.');
  }
  if (process.platform !== 'win32' || !/^[A-Za-z]:\\/.test(process.env.SystemRoot || '')) {
    return failed('This comparison requires Windows PowerShell.');
  }
  try {
    const { encodeRequest, decodeResponse } = require(path.join(desktop, 'pf700-frame'));
    const identity = { command: 90, sequence: randomInt(0x20, 0x80) };
    const request = encodeRequest({ ...identity, data: Buffer.from('0') });
    const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(desktop, 'pf700-checkout-exchange.ps1')], {
      input: request.toString('hex') + '\n', encoding: 'utf8', stdio: 'pipe', windowsHide: true,
      timeout: 25000, maxBuffer: 4096
    });
    if (result.error || result.status !== 0 || result.stderr ||
        !/^(?:[A-Fa-f0-9]{2}){1,101}\r?\n$/.test(result.stdout)) {
      return failed('No complete identity reply was received from COM3.');
    }
    const frame = Buffer.from(result.stdout.trimEnd(), 'hex');
    if (frame.length === 1 && frame[0] === 0x15) return failed('The printer rejected the identity command.');
    const { data, status } = decodeResponse(frame, identity);
    // Same idle-device status conditions as the 1.0.4 identity gate.
    if ((status[0] & 0x37) || (status[1] & 0x3f) || (status[2] & 0x0d) ||
        (status[4] & 0x35) || (status[5] & 0x01) || (status[5] & 0x1a) !== 0x1a) {
      return failed('Printer status prevents identity comparison. Review the device status.');
    }
    return compareFields(data, serial);
  } catch {
    return failed('Could not verify the identity reply from COM3.');
  }
}

if (require.main === module) {
  const { code, message } = runIdentityCheck(process.argv.slice(2));
  console.log(message);
  process.exitCode = code;
}

module.exports = { runIdentityCheck };
