'use strict';

const { createHash } = require('node:crypto');
const { readCandidate } = require('../../src/desktop/pf700-bill2-candidate');
const { decodeResponse } = require('../../src/desktop/pf700-frame');
const digest = value => createHash('sha256').update(value).digest('hex');

// Only the original close or the wrapping status query can supply usable
// evidence. Never disclose arbitrary payloads or interpret either as payment.
function classifyReply(candidate, buffer) {
  const unknown = {kind:'inconclusive'};
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 17 || buffer.length > 101 ||
        ![56,74].includes(buffer[3])) return unknown;
    const { command, data, status } = decodeResponse(buffer, { sequence:candidate.sequence, command:buffer[3] });
    const open = Boolean(status[2] & 0x08);
    const healthy = !(status[0] & 0x37) && !(status[1] & 0x3f) && !(status[2] & 0x05) &&
      !(status[4] & 0x35) && !(status[5] & 0x01) && (status[5] & 0x1a) === 0x1a;
    const frame = {statusHex:status.toString('hex'), responseHash:digest(buffer)};
    if (command === 74) {
      return data.equals(status) ? {kind:'status', ready:healthy, open, ...frame} : unknown;
    }
    const fields = data.toString('latin1').split(',');
    if (fields.length !== 2 || !fields.every(n => n.length === 4 && /^ *[0-9]+$/.test(n))) {
      const shape = data.subarray(0,32).toString('latin1').replace(/[0-9]/g, '#')
        .replace(/[^# ,.+\/-]/g, '?').replace(/ /g, '_');
      return {kind:'unrecognized-close', ready:healthy && !open, open, payloadLength:data.length, shape, ...frame};
    }
    const [fiscalReceiptCount, reversalCount] = fields.map(Number);
    return {
      kind:'cached-close', ready:healthy && !open, open, fiscalReceiptCount, reversalCount,
      countersMatch:fiscalReceiptCount === candidate.openingFiscalReceiptCount + 1 && reversalCount === candidate.openingReversalCount,
      ...frame
    };
  } catch {
    return unknown;
  }
}

module.exports = { readCandidate, classifyReply };
