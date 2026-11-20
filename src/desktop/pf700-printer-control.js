const { randomInt } = require('node:crypto');
const { spawn } = require('node:child_process');
const { encodeRequest, decodeResponse } = require('./pf700-frame');
const { windowsPipe, probeIdentity, validSerial } = require('./pf700-windows-checkout');
function createPf700PrinterControl({ expectedSerial, openPipe, printerWait }) {
  if (!validSerial(expectedSerial) || typeof openPipe !== 'function') throw Error('Invalid PF700 printer control configuration');
  let busy = false;
  async function print(command, data, authorized) {
    const cash = command === 70;
    if (busy || typeof authorized !== 'function') return cash ? 'not_sent' : 'failed';
    busy = true;
    let pipe, lock, attempted = false;
    try {
      if (cash && printerWait) {
        lock = await printerWait.acquire(authorized);
        if (!lock || !authorized()) return 'not_sent';
      }
      pipe = await openPipe('PrinterControl');
      const sequence = randomInt(0x20, 0x80);
      const identity = await probeIdentity(pipe, sequence, expectedSerial);
      if (!identity.ok || !authorized()) return cash ? 'not_sent' : 'failed';
      const next = sequence === 0x7f ? 0x20 : sequence + 1;
      const request = encodeRequest({sequence:next, command, data:Buffer.from(data, 'ascii')});
      attempted = true;
      const response = await pipe.exchange(request);
      const { status, data: reply } = decodeResponse(response, {sequence:next, command});
      const match = cash && /^([PF]),[+-]?\d+(?:\.\d+)?,[+-]?\d+(?:\.\d+)?,[+-]?\d+(?:\.\d+)?$/.exec(reply.toString('latin1'));
      // An open fiscal receipt is compatible with an explicit refusal, but
      // cannot establish that a reported successful movement was accepted.
      const status2Mask = match && match[1] === 'F' ? 0x05 : 0x0d;
      if ((status[0] & 0x37) || (status[1] & 0x3f) || (status[2] & status2Mask) ||
          (status[4] & 0x35) || (status[5] & 0x01) || (status[5] & 0x1a) !== 0x1a) return cash ? 'unknown' : 'failed';
      if (cash) {
        return !match ? 'unknown' : match[1] === 'P' ? 'accepted' : 'declined';
      }
      return 'accepted';
    } catch (error) { return cash ? (!attempted || error?.code === 'PF700_CASH_NOT_SENT' ? 'not_sent' : 'unknown') : 'failed'; }
    finally {
      try { if (pipe) await pipe.close(); } catch (_) {}
      lock?.close();
      busy = false;
    }
  }
  return Object.freeze({
    printDailyControl: authorized => print(69, '2', authorized),
    printCashMovement(payload, authorized) {
      if (typeof payload !== 'string' || payload.length > 9 || !/^-?(?:0|[1-9]\d*)\.\d{2}$/.test(payload) || !/[1-9]/.test(payload)) return 'not_sent';
      return print(70, payload, authorized);
    }
  });
}
function createWindowsPf700PrinterControl({ expectedSerial, printerWait }, startProcess = spawn) {
  return createPf700PrinterControl({expectedSerial, printerWait, openPipe:operation => windowsPipe(startProcess, operation)});
}
module.exports = { createPf700PrinterControl, createWindowsPf700PrinterControl };
