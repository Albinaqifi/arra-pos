'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { readCandidate } = require('./pf700-bill2-candidate');
const { readEvidenceFile, savedCapture, resultPath } = require('./pf700-bill2-capture');
const { originalVerifiedView, readSettledNumberedJournal } = require('./pf700-numbered-journal-result');
const { isCommissioned } = require('./pf700-commissioning');

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const unknown = 'unrecognized';
const fields = [
  ...Array(8).fill(unknown), 'espresso-quantity', 'espresso-item', 'macchiato-quantity', 'macchiato-item',
  unknown, 'domestic-total', 'vat-a', 'vat-b', 'vat-v', 'vat-g', 'vat-total', unknown,
  'total', 'vat-total', 'vat-a', 'vat-b', 'vat-v', 'vat-g', 'cash', 'receipt-date',
  unknown, unknown, unknown, 'document'
];
const counts = { espressoQuantity:1, espressoItem:1, macchiatoQuantity:1, macchiatoItem:1,
  total:1, cash:1, fiscalTitle:0, documentLine:1, documentMentions:1, unrecognized:13 };

// This sale predates the separate supervised card trial. A database restore
// can remove its intent without rolling back the Windows account's markers.
function beforeCardTrial(db, directory) {
  if (!isCommissioned(db) || !fs.lstatSync(directory).isDirectory()) return false;
  for (const name of ['supervised-card.claim','supervised-card.outcome','supervised-card.dispatch']) {
    try { fs.lstatSync(path.join(directory,name)); return false; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const rows = db.prepare(`SELECT sql FROM main.sqlite_schema WHERE name IN
    ('pf700_card_intents','pf700_card_outcomes','pf700_card_open_intents') ORDER BY name`).all();
  if (version === 50) return rows.length === 0;
  // The two retained tables and open-intent view shipped in kit 1.0.10.
  if (version !== 53 || createHash('sha256').update(rows.map(r => r.sql.replaceAll('\r\n','\n')).join('\n')).digest('hex')
      !== 'adc070ad6e7c2443f321c0155ea51fc62c291b954b5374c83f284ae41f3072ba') return false;
  return !db.prepare('SELECT 1 FROM pf700_card_intents UNION ALL SELECT 1 FROM pf700_card_outcomes LIMIT 1').get();
}

// The application package pins the complete journal file selected by the owner
// after comparing the original paper and the numbered journal. A local summary
// cannot authorize itself. No file path, hash or observation comes from IPC.
function createBill2JournalRecovery(directory, journalHash) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || !hash(journalHash)) {
    throw Error('Missing approved bill 2 journal');
  }
  return function readBill2JournalRecovery(db, billId) {
    if (billId !== 2) return null;
    try {
      if (!beforeCardTrial(db, directory)) return null;
      const settled = readSettledNumberedJournal(db, billId, journalHash);
      if (settled) return settled;
      const candidate = readCandidate(db, billId, '0000030', {matchJournalPaper:true});
      if (!candidate || !originalVerifiedView(db)) return null;
      const content = readEvidenceFile(resultPath(directory, candidate));
      if (createHash('sha256').update(content).digest('hex') !== journalHash) return null;
      const captureHash = savedCapture(directory, candidate);
      const lines = content.toString('utf8').split('\n');
      if (lines.length !== 3 || lines[2] !== '') return null;
      const reservation = JSON.parse(lines[0]), observation = JSON.parse(lines[1]);
      const {result, at} = observation;
      if (!Number.isSafeInteger(reservation.at) || reservation.at <= 0 ||
          !Number.isSafeInteger(at) || at < reservation.at ||
          !isDeepStrictEqual(reservation, {version:1,type:'journal-reserved',billId,
            attemptId:candidate.attemptId,document:candidate.expectedDocument,binding:candidate.binding,
            priorCaptureHash:captureHash,at:reservation.at}) ||
          !isDeepStrictEqual(observation, {type:'journal-observation',at,result}) ||
          result.outcome !== 'inconclusive' || result.reason !== 'footer-context' ||
          result.receiptState !== 'retained' || result.lastDocumentMatched !== true ||
          result.end !== 'separator' || result.lines !== 34 || result.structure.length !== result.lines ||
          result.structure.at(-1) !== 'document' ||
          !isDeepStrictEqual(result.counts, counts) ||
          !isDeepStrictEqual(result.structure.filter(code => code !== 'spacing'), fields) ||
          !hash(result.responseHash)) return null;
      const evidence = {kind:'numbered-journal',documentNumber:candidate.expectedDocument,
        binding:candidate.binding,captureHash,journalHash,responseHash:result.responseHash};
      return {candidate, reference:candidate.expectedDocument, evidence};
    } catch {
      // Missing, stale or unreadable local evidence leaves the bill on hold.
      return null;
    }
  };
}

module.exports = { createBill2JournalRecovery };
