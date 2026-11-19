const { spawn } = require('node:child_process');
const { randomInt, createHash } = require('node:crypto');
const path = require('node:path');
const { encodeRequest, decodeResponse } = require('./pf700-frame');
const { canEncodePf700Receipt, executePf700Checkout } = require('./pf700-checkout-protocol');

const validSerial = serial => typeof serial === 'string' && /^[A-Za-z0-9]{11}$/.test(serial);

function inspectIdentity(frame, sequence, expectedSerial, allowOpen = false) {
  const { data, status } = decodeResponse(frame, { command: 90, sequence });
  if ((status[0] & 0x37) || (status[1] & 0x3f) ||
      (status[2] & (allowOpen ? 0x05 : 0x0d)) || (status[4] & 0x35) || (status[5] & 0x01) || (status[5] & 0x1a) !== 0x1a) {
    return { ok: false, reason: 'status' };
  }
  const fields = data.toString('latin1').split(',');
  const [header, firmware] = fields;
  const [checksum, switches, country, serial] = fields.slice(-4);
  // The five-field v1.40 layout has four switch bits. The on-site unit
  // returned a separate identifier, its printed firmware/date and eight bits.
  const legacyFirmware = /^(?:[A-Za-z0-9.]{4} [0-9]{6}|1\.00MK (?:231014|23-OCT-2014)) (?:[01][0-9]|2[0-3])[0-5][0-9]$/;
  const onsiteFirmware = /^1\.00MK 23OCT14 (?:[01][0-9]|2[0-3])[0-5][0-9]$/;
  const legacy = fields.length === 5 && legacyFirmware.test(header) && /^[01]{4}$/.test(switches);
  const onsite = fields.length === 6 && /^[A-Z]{2}-[0-9]{3}[A-Z]{5}$/.test(header) &&
    onsiteFirmware.test(firmware) && /^[01]{8}$/.test(switches);
  if ((!legacy && !onsite) || !/^[0-9A-Fa-f]{4}$/.test(checksum) || !/^[0-9]$/.test(country) || !validSerial(serial)) {
    const widths = values => values.map(value => value.length).join('/');
    return { ok: false, reason: 'layout', layout: 'header widths ' + widths(header.split(' ')) +
      ', remaining field widths ' + widths(fields.slice(1)) };
  }
  return serial === expectedSerial ? { ok: true, onsiteFirmware: onsite } : { ok: false, reason: 'serial' };
}

async function probeIdentity(pipe, sequence, expectedSerial) {
  const probe = encodeRequest({ sequence, command: 90, data: Buffer.from('0') });
  return inspectIdentity(await pipe.exchange(probe), sequence, expectedSerial);
}

// The child owns one exclusive SerialPort. Each private stdin line releases
// exactly one request. No subsequent request is written until its full reply
// has been independently checked by the protocol executor.
function windowsPipe(startProcess, operation = 'Checkout') {
  if (process.platform !== 'win32') throw Error('Windows required');
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = startProcess(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'pf700-checkout-exchange.ps1'),
    ...(operation === 'Checkout' ? [] : ['-Operation', operation])], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], timeout: operation === 'Checkout' ? 180000 : 300000
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
    const isReady = pending.kind === 'open' && /^READY\r?\n$/.test(pending.data);
    if (!isReady && (pending.kind === 'open' || !/^(?:[0-9A-F]{2}){1,101}\r?\n$/.test(pending.data))) { fail(); return; }
    const { data, resolve, timer } = pending;
    pending = null;
    clearTimeout(timer);
    resolve(isReady ? true : Buffer.from(data.trimEnd(), 'hex'));
  });
  return {
    reserve() {
      if (operation !== 'ReadCheckout' || stopped || pending) throw Error('PF700 exchange unavailable');
      return new Promise((resolve,reject)=>{
        pending={kind:'open',data:'',resolve,reject,timer:setTimeout(fail,25000)};
        child.stdin.write('OPEN\n',error=>{if(error)fail();});
      });
    },
    exchange(request) {
      if (stopped || pending) throw Error('PF700 exchange unavailable');
      return new Promise((resolve, reject) => {
        const timeout = operation === 'DailyReport' && request[3] === 69 ? 125000 : 25000;
        pending = { data: '', resolve, reject, timer: setTimeout(fail, timeout) };
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

async function checkWindowsPf700Identity(expectedSerial, startProcess = spawn) {
  if (!validSerial(expectedSerial)) return { ok: false, reason: 'serial' };
  let pipe;
  try {
    pipe = windowsPipe(startProcess);
    const result = await probeIdentity(pipe, randomInt(0x20, 0x80), expectedSerial);
    return result.ok ? { ok: true } : result;
  } catch {
    return { ok: false, reason: 'transport' };
  } finally {
    if (pipe) await pipe.close();
  }
}

function createWindowsPf700Checkout(profile, startProcess = spawn) {
  const { expectedSerial, operatorNumber, operatorPassword, tillNumber, domesticProduct, mayProbe, beforeOpen,
    allowLegacyOrigin = false, supervisedCardTrial = false } = profile;
  if (!validSerial(expectedSerial) ||
      !['string','number'].includes(typeof operatorNumber) || !/^[1-8]$/.test(String(operatorNumber)) ||
      typeof operatorPassword !== 'string' || !/^[0-9]{4,6}$/.test(operatorPassword) ||
      !['string','number'].includes(typeof tillNumber) || !/^[0-9]{1,5}$/.test(String(tillNumber)) || typeof domesticProduct !== 'boolean' ||
      typeof allowLegacyOrigin !== 'boolean' || typeof supervisedCardTrial !== 'boolean' || (mayProbe !== undefined && typeof mayProbe !== 'function') ||
      (beforeOpen !== undefined && typeof beforeOpen !== 'function')) throw Error('Invalid PF700 checkout profile');
  let busy = false;
  return Object.freeze({
    mode: 'device', deviceId: expectedSerial, domesticProduct,
    async acquireCashObservation() {
      if (busy) return null;
      busy = true;
      let pipe;
      try {
        pipe=windowsPipe(startProcess,'ReadCheckout');
        await pipe.reserve();
        let closed=false;
        return {
          observe:()=>require('./pf700-checkout-observation').observeCheckout(pipe,expectedSerial,randomInt(0x20,0x80),inspectIdentity),
          async close() { if (closed) return; closed=true; try { await pipe.close(); } finally { busy=false; } }
        };
      } catch { try { if (pipe) await pipe.close(); } finally { busy=false; } return null; }
    },
    async registerSale(snapshot, context) {
      if (busy || snapshot?.method !== (supervisedCardTrial ? 'card' : 'cash') || typeof context?.beforeOpen !== 'function' || (snapshot?.domesticProduct !== domesticProduct && !(allowLegacyOrigin &&
          typeof snapshot?.domesticProduct === 'boolean' && snapshot.lines?.length === 1 &&
          snapshot.lines[0].quantity === 1 && !Object.hasOwn(snapshot.lines[0], 'domesticProduct'))) ||
          !canEncodePf700Receipt(snapshot)) return { status: 'failed' };
      busy = true;
      let pipe, opening = false;
      try {
        if (mayProbe && !mayProbe()) return { status: 'failed' };
        pipe = windowsPipe(startProcess, supervisedCardTrial ? 'CardTrial' : 'Checkout');
        const sequence = randomInt(0x20, 0x80);
        const probe = encodeRequest({sequence,command:90,data:Buffer.from('0')});
        const probeId = context.beforeCommand?.({command:90,sequence,requestHash:createHash('sha256').update(probe).digest('hex')});
        const probeReply = await pipe.exchange(probe);
        const identity = inspectIdentity(probeReply, sequence, expectedSerial);
        if (!identity.ok) return { status: 'failed' };
        if (context.afterCommand) await context.afterCommand({id:probeId,responseHash:createHash('sha256').update(probeReply).digest('hex'),summary:{identityMatched:true,onsiteFirmware:identity.onsiteFirmware}});
        return await executePf700Checkout(snapshot, {
          firstSequence: sequence === 0x7f ? 0x20 : sequence + 1,
          operatorNumber, operatorPassword, tillNumber, domesticProduct: snapshot.domesticProduct,
          onsiteFirmware: identity.onsiteFirmware, supervisedCardTrial,
          beforeCommand:context.beforeCommand, afterCommand:context.afterCommand,
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

module.exports = { createWindowsPf700Checkout, checkWindowsPf700Identity, windowsPipe, probeIdentity, validSerial };
