'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const digest = value => createHash('sha256').update(value).digest('hex');

function markerPath(directory, serial) {
  const device = createHash('sha256').update(serial).digest('hex');
  return path.join(directory, device + '.bill2-close-capture.jsonl');
}

function readEvidenceFile(filename) {
  if (!fs.lstatSync(filename).isFile()) throw Error('Original evidence file required');
  const fd = fs.openSync(filename,'r');
  let content;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 8192 || stat.size === 0) throw Error('Unexpected evidence file');
    content = Buffer.alloc(stat.size);
    if (fs.readSync(fd,content,0,content.length,0) !== content.length) throw Error('Incomplete evidence file');
    return content;
  } finally { fs.closeSync(fd); }
}

// Tie this read to the post-inquiry, ready and closed status the operator
// reported. A queued or partial capture is a different investigation.
function savedCapture(directory, candidate) {
  const filename = markerPath(directory, candidate.serial);
  const content = readEvidenceFile(filename);
  const lines = content.toString('utf8').split('\n');
  if (lines.length !== 3 || lines[2] !== '') throw Error('Incomplete capture');
  const header = JSON.parse(lines[0]), result = JSON.parse(lines[1]);
  const record = {version:1,type:'reserved',billId:candidate.billId,attemptId:candidate.attemptId,
    binding:candidate.binding,sequence:candidate.sequence,expectedDocument:candidate.expectedDocument,
    total:candidate.total,openingFiscalReceiptCount:candidate.openingFiscalReceiptCount,
    openingReversalCount:candidate.openingReversalCount,at:header.at};
  if (!isDeepStrictEqual(header,record) || !Number.isSafeInteger(header.at) || header.at <= 0 ||
      !Number.isSafeInteger(result.at) || result.at < header.at || result.type !== 'observation' ||
      result.source !== 'PROBE') throw Error('Capture differs from this incident');
  // Status command 74/X echoes its six status bytes as data. Reconstruct
  // that one public status frame to verify the hash the first collector saved.
  const flags = Buffer.from('888082e1809a','hex');
  const body = Buffer.concat([Buffer.from([0x2b + flags.length, candidate.sequence, 74]), flags,
    Buffer.from([4]), flags, Buffer.from([5])]);
  const sum = body.reduce((n, v) => n + v, 0);
  const checksum = Buffer.from([12,8,4,0].map(n => 0x30 + ((sum >> n) & 15)));
  const responseHash = digest(Buffer.concat([Buffer.from([1]), body, checksum, Buffer.from([3])]));
  const expected = {kind:'status',ready:true,open:false,statusHex:flags.toString('hex'),responseHash};
  if (!isDeepStrictEqual(result.observation,expected)) throw Error('Prior status could not be verified');
  return digest(content);
}

function resultPath(directory, candidate) {
  return markerPath(directory, candidate.serial).replace(/\.bill2-close-capture\.jsonl$/, '.bill2-journal.jsonl');
}

module.exports = { markerPath, readEvidenceFile, savedCapture, resultPath };
