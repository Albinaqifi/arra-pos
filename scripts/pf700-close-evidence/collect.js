'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline/promises');
const { readCandidate, classifyReply } = require('./evidence');
const { markerPath, appendRecord, openIncidentDatabase } = require('./evidence-files');

// This field collector is scoped to the operator's documented, still-held
// incident. There is no general command console or payment entry point.
const incident = { bill: 2, document: '0000030', total: 150 };

function captureFrame(sequence) {
  const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'capture.ps1'), '-Sequence', String(sequence)], {
    input: '', encoding: 'ascii', windowsHide: true, timeout: 20000, maxBuffer: 4096
  });
  if (child.status !== 0 || child.error || child.stderr) return null;
  const match = /^(PENDING|PROBE) ([0-9A-Fa-f]{2,202})\r?\n$/.exec(child.stdout);
  if (!match || match[2].length % 2 !== 0) return null;
  return { source: match[1], frame: Buffer.from(match[2], 'hex') };
}

function display(candidate, observation, source) {
  const timing = source === 'PENDING' ? 'Already in the receive queue.' : 'Received after the status inquiry.';
  if (observation.kind === 'cached-close') {
    const detail = observation.countersMatch ? 'Expected counter change.' : 'Unexpected counter change.';
    const heading = observation.ready && observation.countersMatch ? 'CLOSE REPLY SAVED. ' : 'INCONCLUSIVE CLOSE REPLY. ';
    return heading + detail + ' Fiscal count ' + candidate.openingFiscalReceiptCount + ' to ' +
      observation.fiscalReceiptCount + ', reversal count ' + candidate.openingReversalCount + ' to ' +
      observation.reversalCount + '. Closed and ready: ' + (observation.ready ? 'yes' : 'unconfirmed') +
      '. Device flags: ' + observation.statusHex + '. ' + timing;
  }
  if (observation.kind === 'unrecognized-close') {
    return 'INCONCLUSIVE CLOSE REPLY. Counter format: ' + (observation.shape || '(empty)') +
      '. Device flags: ' + observation.statusHex + '. ' + timing;
  }
  if (observation.kind === 'status') {
    if (source === 'PENDING') return 'INCONCLUSIVE. A status frame was already queued. Its age is unknown.';
    if (!observation.ready) return 'INCONCLUSIVE STATUS REPLY. Device flags: ' + observation.statusHex + '.';
    return 'STATUS REPLY SAVED. The receipt flag in the reply was ' + (observation.open ? 'open' : 'closed') +
      '. Device flags: ' + observation.statusHex + '.';
  }
  return 'INCONCLUSIVE. Keep this bill on hold.';
}

function collectOnce(candidate, directory, capture = captureFrame) {
  const filename = markerPath(directory, candidate.serial);
  let fd;
  try { fd = fs.openSync(filename, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') return 'STOP. A check was already reserved. Leave the saved evidence in place.';
    throw error;
  }
  try {
    appendRecord(fd, { version: 1, type: 'reserved', billId: candidate.billId, attemptId: candidate.attemptId,
      binding: candidate.binding, sequence: candidate.sequence, expectedDocument: candidate.expectedDocument,
      total: candidate.total, openingFiscalReceiptCount: candidate.openingFiscalReceiptCount,
      openingReversalCount: candidate.openingReversalCount, at: Date.now() });
    const response = capture(candidate.sequence);
    const observation = response ? classifyReply(candidate, response.frame) : { kind: 'inconclusive' };
    appendRecord(fd, { type: 'observation', at: Date.now(), source: response?.source ?? 'UNKNOWN', observation });
    return display(candidate, observation, response?.source);
  } finally { fs.closeSync(fd); }
}

async function run() {
  if (process.platform !== 'win32' || process.env.ARRA_CLOSE_EVIDENCE_LOCKED !== '1' ||
      !process.stdin.isTTY || !process.stdout.isTTY || process.argv.length !== 2) {
    throw Error('Use the Windows launcher.');
  }
  const directory = path.join(process.env.LOCALAPPDATA, 'Arra POS', 'PF700 commissioning');
  const db = openIncidentDatabase();
  try {
    const candidate = readCandidate(db, incident.bill, incident.document);
    if (!candidate || candidate.total !== incident.total) {
      console.log('STOP. The saved checkout does not match this incident. Printer untouched.');
      return;
    }
    if (fs.existsSync(markerPath(directory, candidate.serial))) {
      console.log('STOP. A check was already reserved. Printer untouched. Keep the saved evidence.');
      return;
    }
    console.log('READY. Bill 2, 150 den, zero local payments. Printer untouched.');
    const prompts = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const serial = await prompts.question('Type the serial from the connected printer label, or press Enter to exit: ');
      if (serial !== candidate.serial) return console.log('STOP. Printer untouched.');
      const document = await prompts.question('Type the seven-digit number from the bottom of this paper receipt: ');
      if (document !== candidate.expectedDocument) return console.log('STOP. Printer untouched.');
      console.log('Continue only if this printer stayed powered on and unused since the receipt printed.');
      console.log('One status request may replace its last reply. It cannot print or record a sale.');
      const consent = await prompts.question('Type CAPTURE to allow that one check, or press Enter to exit: ');
      if (consent !== 'CAPTURE') return console.log('Cancelled. Printer untouched.');
      console.log(collectOnce(candidate, directory));
      console.log('Keep bill 2 on hold. No payment was recorded by this checker.');
    } finally { prompts.close(); }
  } finally { db.close(); }
}

if (require.main === module) run().catch(() => {
  console.error('STOP. The check could not be completed. Keep the printer idle and any evidence file in place.');
  process.exitCode = 1;
});

module.exports = { collectOnce, markerPath };
