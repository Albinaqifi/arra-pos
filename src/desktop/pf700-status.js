const { encodeRequest, decodeResponse } = require('./pf700-frame');

const PF700_PROFILE = Object.freeze({
  model: 'Synergy PF700',
  port: 'COM3',
  baudRate: 9600,
  dataBits: 8,
  parity: 'none',
  stopBits: 1
});

// Accent PF550/PF700 control codes v1.36, command 74, option X:
// request the immediate status. The manual specifies six bytes in DATA in
// addition to the six status bytes present in every wrapped response.
const STATUS = 0x4a;
const SYN = 0x16;
const NAK = 0x15;
const MAX_BUSY_BYTES = 48;

function readImmediateStatus(sequence, exchange) {
  const identity = { sequence, command: STATUS };
  const request = encodeRequest({ ...identity, data: Buffer.from('X') });
  const reply = exchange(request);
  if (!Buffer.isBuffer(reply)) throw new Error('Invalid PF700 response.');
  let start = 0;
  while (reply[start] === SYN && start < MAX_BUSY_BYTES) start++;
  if (start === reply.length || reply[start] === SYN) throw new Error('No complete PF700 status response.');
  if (reply[start] === NAK) throw new Error('The device rejected the status request.');
  const { data, status } = decodeResponse(reply.subarray(start), identity);
  if ((status[0] & 0x03) !== 0 || (status[1] & 0x02) !== 0) {
    throw new Error('The device rejected the status command, its parameters or its use in the current fiscal mode.');
  }
  if (data.length !== 6 || data.some(byte => byte < 0x80)) throw new Error('Invalid PF700 status data.');
  return { statusBytes: data.toString('hex'), frameStatusBytes: status.toString('hex') };
}

function rehearseStatus() {
  // Independently specified wire vectors. This path cannot open a transport.
  const request = Buffer.from('0125204a580530303e3c03', 'hex');
  const response = Buffer.from('160131204a808080808080048080808080800530363a3403', 'hex');
  readImmediateStatus(0x20, encoded => {
    if (!encoded.equals(request)) throw new Error('Unexpected simulated status request.');
    return response;
  });
  return { mode: 'offline', result: 'simulated-response' };
}

module.exports = { PF700_PROFILE, readImmediateStatus, rehearseStatus };
