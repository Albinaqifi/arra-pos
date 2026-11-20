const { randomInt } = require('node:crypto');
const { spawn } = require('node:child_process');
const { encodeRequest, decodeResponse } = require('./pf700-frame');
const { windowsPipe, probeIdentity, validSerial } = require('./pf700-windows-checkout');
function createPf700PrinterControl({ expectedSerial, openPipe }) {
  if (!validSerial(expectedSerial) || typeof openPipe !== 'function') throw Error('Invalid PF700 printer control configuration');
  let busy = false;
  return Object.freeze({ async printDailyControl(authorized) {
    if (busy || typeof authorized !== 'function') return 'failed';
    busy = true;
    let pipe;
    try {
      pipe = await openPipe('PrinterControl');
      const sequence = randomInt(0x20, 0x80);
      const identity = await probeIdentity(pipe, sequence, expectedSerial);
      if (!identity.ok || !authorized()) return 'failed';
      const next = sequence === 0x7f ? 0x20 : sequence + 1;
      const response = await pipe.exchange(encodeRequest({sequence:next, command:69, data:Buffer.from('2', 'ascii')}));
      const { status } = decodeResponse(response, {sequence:next, command:69});
      if ((status[0] & 0x37) || (status[1] & 0x3f) || (status[2] & 0x0d) ||
          (status[4] & 0x35) || (status[5] & 0x01) || (status[5] & 0x1a) !== 0x1a) return 'failed';
      return 'accepted';
    } catch (_) { return 'failed'; }
    finally { try { if (pipe) await pipe.close(); } catch (_) {} busy = false; }
  }});
}
function createWindowsPf700PrinterControl({ expectedSerial }, startProcess = spawn) {
  return createPf700PrinterControl({expectedSerial, openPipe:operation => windowsPipe(startProcess, operation)});
}
module.exports = { createPf700PrinterControl, createWindowsPf700PrinterControl };
