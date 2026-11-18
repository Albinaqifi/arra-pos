// Accent PF550 control codes v1.36, linked by Accent for PF550/PF700.
// Pure framing only: no transport or fiscal operations. PF700 firmware and
// hardware compatibility remain unverified.
const START = 0x01, SEPARATOR = 0x04, POSTAMBLE = 0x05, END = 0x03;

function byteInRange(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new TypeError(`Invalid ${name}`);
}

function checksum(bytes) {
  const sum = bytes.reduce((total, value) => total + value, 0);
  return Buffer.from([12, 8, 4, 0].map(shift => 0x30 + ((sum >> shift) & 0x0f)));
}

// Data is already encoded. Some commands explicitly use TAB/LF as separators;
// callers must opt in to each. Other control bytes use DLE plus an offset of
// 0x40, per the manual. Never silently alter command-specific payload bytes.
function validateData(data, allowedControls) {
  if (!Array.isArray(allowedControls) || allowedControls.some(value => value !== 0x09 && value !== 0x0a)) throw new TypeError('Invalid allowed controls');
  for (let index = 0; index < data.length; index++) {
    const value = data[index];
    if (value === 0x10) {
      if (++index >= data.length || data[index] < 0x40 || data[index] > 0x5f) throw new Error('Invalid escaped data');
    } else if (value < 0x20 && !allowedControls.includes(value)) {
      throw new Error('Invalid control in data');
    }
  }
}

function encodeRequest({ sequence, command, data = Buffer.alloc(0), allowedControls = [] }) {
  byteInRange(sequence, 0x20, 0xff, 'sequence');
  byteInRange(command, 0x20, 0x7f, 'command');
  if (!Buffer.isBuffer(data) || data.length > 91) throw new TypeError('Invalid data');
  validateData(data, allowedControls);
  const body = Buffer.concat([Buffer.from([0x24 + data.length, sequence, command]), data, Buffer.from([POSTAMBLE])]);
  return Buffer.concat([Buffer.from([START]), body, checksum(body), Buffer.from([END])]);
}

function decodeResponse(frame, { sequence, command, allowedControls = [] }) {
  byteInRange(sequence, 0x20, 0xff, 'sequence');
  byteInRange(command, 0x20, 0x7f, 'command');
  if (!Buffer.isBuffer(frame) || frame.length < 17 || frame.length > 101) throw new Error('Invalid frame size');
  if (frame[0] !== START || frame[frame.length - 1] !== END || frame[1] !== frame.length - 6 + 0x20) throw new Error('Invalid frame envelope');
  if (frame[2] !== sequence || frame[3] !== command) throw new Error('Unexpected response identity');
  const post = frame.length - 6;
  const separator = post - 7;
  if (frame[post] !== POSTAMBLE || frame[separator] !== SEPARATOR) throw new Error('Invalid frame delimiters');
  const status = frame.subarray(separator + 1, post);
  if (status.length !== 6 || status.some(value => value < 0x80)) throw new Error('Invalid status');
  const actual = frame.subarray(post + 1, post + 5);
  if (!actual.equals(checksum(frame.subarray(1, post + 1)))) throw new Error('Invalid checksum');
  validateData(frame.subarray(4, separator), allowedControls);
  return { sequence, command, data: Buffer.from(frame.subarray(4, separator)), status: Buffer.from(status) };
}

module.exports = { encodeRequest, decodeResponse };
