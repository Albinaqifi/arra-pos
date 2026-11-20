const { randomInt } = require('node:crypto');
const { spawn } = require('node:child_process');
const { encodeRequest, decodeResponse } = require('./pf700-frame');
const { windowsPipe, probeIdentity, validSerial } = require('./pf700-windows-checkout');
function createPf700PrinterControl({ expectedSerial, openPipe }) {
  if (!validSerial(expectedSerial) || typeof openPipe !== 'function') throw Error('Invalid PF700 printer control configuration');
  let busy = false;
  async function print(command, data, authorized) {
    if (busy || typeof authorized !== 'function') return 'failed';
    busy = true;
    let pipe;
    try {
      pipe = await openPipe('PrinterControl');
      const sequence = randomInt(0x20, 0x80);
      const identity = await probeIdentity(pipe, sequence, expectedSerial);
      if (!identity.ok || !authorized()) return 'failed';
      const next = sequence === 0x7f ? 0x20 : sequence + 1;
      const response = await pipe.exchange(encodeRequest({sequence:next, command, data:Buffer.from(data, 'ascii')}));
      const { status, data: reply } = decodeResponse(response, {sequence:next, command});
      if ((status[0] & 0x37) || (status[1] & 0x3f) || (status[2] & 0x0d) ||
          (status[4] & 0x35) || (status[5] & 0x01) || (status[5] & 0x1a) !== 0x1a) return 'failed';
      if (command === 70 && !/^P,[+-]?\d+(?:\.\d+)?,[+-]?\d+(?:\.\d+)?,[+-]?\d+(?:\.\d+)?$/.test(reply.toString('latin1'))) return 'failed';
      return 'accepted';
    } catch (_) { return 'failed'; }
    finally { try { if (pipe) await pipe.close(); } catch (_) {} busy = false; }
  }
  return Object.freeze({
    printDailyControl: authorized => print(69, '2', authorized),
    printCashMovement(payload, authorized) {
      if (typeof payload !== 'string' || payload.length > 9 || !/^-?(?:0|[1-9]\d*)\.\d{2}$/.test(payload) || !/[1-9]/.test(payload)) return 'failed';
      return print(70, payload, authorized);
    }
  });
}
function createWindowsPf700PrinterControl({ expectedSerial }, startProcess = spawn) {
  return createPf700PrinterControl({expectedSerial, openPipe:operation => windowsPipe(startProcess, operation)});
}
module.exports = { createPf700PrinterControl, createWindowsPf700PrinterControl };
