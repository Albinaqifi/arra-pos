'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline/promises');
const { savedCapture, resultPath } = require('../../src/desktop/pf700-bill2-capture');
const { appendRecord, openIncidentDatabase } = require('./evidence-files');
const { readCandidate } = require('./evidence');
const { openPipe } = require('../pf700-journal-check/journal-pipe');
const { readBill2Journal } = require('./match-journal');

const documentNumber = '0000030';

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
