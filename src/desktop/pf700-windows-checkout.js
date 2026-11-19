const { spawn } = require('node:child_process');
const { randomInt } = require('node:crypto');
const path = require('node:path');
const { encodeRequest, decodeResponse } = require('./pf700-frame');
const { executePf700Checkout } = require('./pf700-checkout-protocol');

// Accent v1.40, command 90/0. The device serial is the fifth field, after
// the four switches and country digit. v1.36 ends with a separate 8-byte FM
// number; never search for the serial elsewhere in a reply.
function inspectIdentity(frame, sequence, expectedSerial) {
  const { data, status } = decodeResponse(frame, { command: 90, sequence });
  if ((status[0] & 0x37) || (status[1] & 0x3f) ||
      (status[2] & 0x0d) || (status[4] & 0x35) || (status[5] & 0x01) || (status[5] & 0x1a) !== 0x1a) {
    return { ok: false, reason: 'status' };
  }
  const fields = data.toString('latin1').split(',');
  const [header, checksum, switches, country, serial] = fields;
  // The printed diagnostic identified version 1.00MK, 23 October 2014.
  // Accept that exact expanded version/date as well as the fixed v1.40
  // header. Neither form changes the documented serial field or its bounds.
  const versionAndDate = /^(?:[A-Za-z0-9.]{4} [0-9]{6}|1\.00MK (?:231014|23-OCT-2014)) (?:[01][0-9]|2[0-3])[0-5][0-9]$/;
  if (fields.length !== 5 || !versionAndDate.test(header) || !/^[0-9A-Fa-f]{4}$/.test(checksum) ||
      !/^[01]{4}$/.test(switches) || !/^[0-9]$/.test(country) || !/^[A-Za-z0-9]{11}$/.test(serial)) {
    const widths = values => values.map(value => value.length).join('/');
    return { ok: false, reason: 'layout', layout: 'header widths ' + widths(header.split(' ')) +
      ', remaining field widths ' + widths(fields.slice(1)) };
  }
  return serial === expectedSerial ? { ok: true } : { ok: false, reason: 'serial' };
}

async function probeIdentity(pipe, sequence, expectedSerial) {
  const probe = encodeRequest({ sequence, command: 90, data: Buffer.from('0') });
  return inspectIdentity(await pipe.exchange(probe), sequence, expectedSerial);
}

// The child owns one exclusive SerialPort. Each private stdin line releases
// exactly one request. No subsequent request is written until its full reply
// has been independently checked by the protocol executor.
function windowsPipe(startProcess) {
  if (process.platform !== 'win32') throw Error('Windows required');
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = startProcess(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'pf700-checkout-exchange.ps1')], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], timeout: 180000
  });
  let stopped = false, pending = null;
  const closed = new Promise(resolve => child.once('close', resolve));
  function fail() {
    stopped = true;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(Error('PF700 exchange interrupted'));
      pending = null;
    }
  }
  child.once('error', fail);
  child.once('close', fail);
  child.stdin.on('error', fail);
  child.stdout.on('error', fail);
  child.stdout.on('end', fail);
  child.stdout.on('data', bytes => {
    if (!pending || pending.data.length + bytes.length > 204) { fail(); return; }
    pending.data += bytes.toString('latin1');
    if (!pending.data.includes('\n')) return;
    if (!/^(?:[0-9A-F]{2}){1,101}\r?\n$/.test(pending.data)) { fail(); return; }
    const { data, resolve, timer } = pending;
    pending = null;
    clearTimeout(timer);
    resolve(Buffer.from(data.trimEnd(), 'hex'));
  });
  return {
    exchange(request) {
      if (stopped || pending) throw Error('PF700 exchange unavailable');
      return new Promise((resolve, reject) => {
        pending = { data: '', resolve, reject, timer: setTimeout(fail, 25000) };
        child.stdin.write(request.toString('hex') + '\n', error => { if (error) fail(); });
      });
    },
    async close() {
      fail();
      child.stdin.end();
      const terminate = setTimeout(() => child.kill(), 1000);
      try { await closed; } finally { clearTimeout(terminate); }
    }
  };
}

const validSerial = serial => typeof serial === 'string' && /^[A-Za-z0-9]{11}$/.test(serial);

async function checkWindowsPf700Identity(expectedSerial, startProcess = spawn) {
  if (!validSerial(expectedSerial)) return { ok: false, reason: 'serial' };
  let pipe;
  try {
    pipe = windowsPipe(startProcess);
    return await probeIdentity(pipe, randomInt(0x20, 0x80), expectedSerial);
  } catch {
    return { ok: false, reason: 'transport' };
  } finally {
    if (pipe) await pipe.close();
  }
}

function createWindowsPf700Checkout(profile, startProcess = spawn) {
  const { expectedSerial, operatorNumber, operatorPassword, tillNumber, domesticProduct, mayProbe, beforeOpen } = profile;
  if (!validSerial(expectedSerial) ||
      !['string','number'].includes(typeof operatorNumber) || !/^[1-8]$/.test(String(operatorNumber)) ||
      typeof operatorPassword !== 'string' || !/^[0-9]{4,6}$/.test(operatorPassword) ||
      !['string','number'].includes(typeof tillNumber) || !/^[0-9]{1,5}$/.test(String(tillNumber)) || typeof domesticProduct !== 'boolean' ||
      (mayProbe !== undefined && typeof mayProbe !== 'function') ||
      (beforeOpen !== undefined && typeof beforeOpen !== 'function')) throw Error('Invalid PF700 checkout profile');
  let busy = false;
  return Object.freeze({
    mode: 'device', deviceId: expectedSerial, domesticProduct,
    async registerSale(snapshot, context) {
      if (busy || typeof context?.beforeOpen !== 'function' || snapshot.domesticProduct !== domesticProduct) return { status: 'failed' };
      busy = true;
      let pipe, opening = false;
      try {
        if (mayProbe && !mayProbe()) return { status: 'failed' };
        pipe = windowsPipe(startProcess);
        const sequence = randomInt(0x20, 0x80);
        const identity = await probeIdentity(pipe, sequence, expectedSerial);
        if (!identity.ok) return { status: 'failed' };
        return await executePf700Checkout(snapshot, {
          firstSequence: sequence === 0x7f ? 0x20 : sequence + 1,
          operatorNumber, operatorPassword, tillNumber, domesticProduct: snapshot.domesticProduct,
          async beforeOpen(baseline) {
            if (beforeOpen) await beforeOpen(baseline);
            await context.beforeOpen(baseline);
          }
        }, frame => {
          if (frame[3] === 48) opening = true;
          return pipe.exchange(frame);
        });
      } catch {
        return { status: opening ? 'uncertain' : 'failed' };
      } finally {
        try { if (pipe) await pipe.close(); } finally { busy = false; }
      }
    }
  });
}

module.exports = { createWindowsPf700Checkout, checkWindowsPf700Identity };
