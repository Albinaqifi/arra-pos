'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createInterface } = require('node:readline/promises');
const { isDeepStrictEqual } = require('node:util');
const { markerPath, appendRecord, openIncidentDatabase } = require('./evidence-files');
const { readCandidate } = require('./evidence');
const { openPipe } = require('../pf700-journal-check/journal-pipe');
const { readBill2Journal } = require('./match-journal');

const documentNumber = '0000030';
const digest = value => createHash('sha256').update(value).digest('hex');

// Tie this read to the post-inquiry, ready and closed status the operator
// reported. A queued or partial capture is a different investigation.
function savedCapture(directory, candidate) {
  const filename = markerPath(directory, candidate.serial);
  if (!fs.lstatSync(filename).isFile()) throw Error('Original evidence file required');
  const fd = fs.openSync(filename,'r');
  let content;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 8192 || stat.size === 0) throw Error('Unexpected evidence file');
    content = Buffer.alloc(stat.size);
    if (fs.readSync(fd,content,0,content.length,0) !== content.length) throw Error('Incomplete evidence file');
  } finally { fs.closeSync(fd); }
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

async function collectJournal(candidate, directory, firstHash, connect = openPipe) {
  if (candidate.expectedDocument !== documentNumber || savedCapture(directory,candidate) !== firstHash) {
    throw Error('Original evidence changed');
  }
  const fd = fs.openSync(resultPath(directory, candidate), 'wx', 0o600);
  try {
    appendRecord(fd, {version:1,type:'journal-reserved',billId:candidate.billId,attemptId:candidate.attemptId,
      document:documentNumber,binding:candidate.binding,priorCaptureHash:firstHash,at:Date.now()});
    const pipe = connect();
    let result;
    try { result = await readBill2Journal(pipe.exchange,candidate); }
    finally { await pipe.close(); }
    appendRecord(fd, {type:'journal-observation',at:Date.now(),result});
    return result;
  } finally { fs.closeSync(fd); }
}

function show(result) {
  console.log(result.outcome === 'matched' ? 'JOURNAL MATCH for document 0000030.' : 'INCONCLUSIVE - ' + result.reason + '.');
  console.log('Last document matched:', result.lastDocumentMatched, '| Receipt state:',result.receiptState);
  const c = result.counts;
  console.log('Lines:',result.lines,'| End:',result.end,'| Espresso:',c.espressoItem,'| Macchiato:',c.macchiatoItem,
    '| Total:',c.total,'| Cash:',c.cash,'| Footer number lines:',c.documentLine);
  if (result.outcome === 'inconclusive' && result.structure.length) {
    console.log('Field order:',result.structure.filter(code => code !== 'spacing').join(' '));
  }
  console.log('Bill 2 remains on hold. This reader printed nothing and recorded no payment.');
}

async function main() {
  if (process.platform !== 'win32' || process.env.ARRA_CLOSE_EVIDENCE_LOCKED !== '1' ||
      !process.stdin.isTTY || !process.stdout.isTTY || process.argv.length !== 2) throw Error('Use the Windows launcher');
  const directory = path.join(process.env.LOCALAPPDATA, 'Arra POS', 'PF700 commissioning');
  const db = openIncidentDatabase();
  try {
    const candidate = readCandidate(db,2,documentNumber,{matchJournalPaper:true});
    if (!candidate) return console.log('STOP. Could not match the original bill. Printer untouched.');
    let firstHash;
    try { firstHash = savedCapture(directory,candidate); }
    catch { return console.log('STOP. The saved closed-status check does not match bill 2. Printer untouched.'); }
    if (fs.existsSync(resultPath(directory,candidate))) return console.log('STOP. A journal read was already reserved. Printer untouched.');
    console.log('READY. Bill 2, 150 den, zero local payments. Previous closed-status check matched. Printer untouched.');
    console.log('Keep the same PF700 connected and idle. Continue only if it has had no other sale, printout or report.');
    console.log('This reads the stored receipt and replaces the last printer response. It cannot print or record a sale.');
    // Use the Windows console's normal line input. Raw TTY mode can leave
    // the subsequent asynchronous serial helper waiting for another key.
    const prompt = createInterface({input:process.stdin,output:process.stdout,terminal:false});
    let choice;
    try { choice = await prompt.question('Type READ to check document 0000030, or press Enter to exit: '); }
    finally { prompt.close(); }
    if (choice !== 'READ') return console.log('Cancelled. Printer untouched.');
    console.log('Reading the PF700 journal. Wait for the result.');
    show(await collectJournal(candidate,directory,firstHash));
  } finally { db.close(); }
}

if (require.main === module) main().catch(() => {
  console.error('STOP. The journal read could not finish. Keep bill 2 on hold and all saved files in place.');
  process.exitCode = 1;
});

module.exports = { savedCapture, collectJournal, resultPath };
