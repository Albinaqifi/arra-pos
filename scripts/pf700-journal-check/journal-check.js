// Operator-assisted, read-only PF550/PF700 v1.40 ECT exploration. Never used
// by checkout. A successful read is not proof that a sale can be recovered.
const { openPipe } = require('./journal-pipe');
const { randomInt } = require('node:crypto');
const readline = require('node:readline');
const { TextDecoder } = require('node:util');
const { encodeRequest, decodeResponse } = require('../../src/desktop/pf700-frame');
const { probeIdentity } = require('../../src/desktop/pf700-windows-checkout');

const MAX_LINES = 300;
const decoder = new TextDecoder('windows-1251', { fatal: true });
function closedStatus(status) {
  if ((status[0] & 0x37) || (status[1] & 0x3f) || (status[2] & 0x0d) ||
      (status[4] & 0x35) || (status[5] & 0x01) || (status[5] & 0x1a) !== 0x1a) {
    throw Error('Printer status is not ready or a receipt is open. Stop and ask for help.');
  }
}

const foldSpaces = text => text.replace(/ +/g, ' ').replace(/^ | $/g, '');

function hasPrintedAmount(line, amount) {
  // Accept a paper line with one unsigned amount. If it has other digits,
  // different grouping, or a sign, leave the layout unverified.
  const position = line.indexOf(amount);
  if (position < 0) return false;
  const before = line.slice(0, position), after = line.slice(position + amount.length);
  return !/[0-9]/.test(before + after) &&
    !/[+\-−.,] *$/u.test(before) && !/^ *[+\-−.,]/u.test(after);
}

function paperReferences(serial, document, paper) {
  if (typeof serial !== 'string' || !/^[A-Za-z0-9]{11}$/.test(serial) ||
      typeof document !== 'string' || !/^[0-9]{7}$/.test(document)) {
    throw Error('Invalid printer serial or document number. No command was sent.');
  }
  const fields = ['item', 'total', 'cash', 'amount'];
  if (!paper || fields.some(key => typeof paper[key] !== 'string' ||
      paper[key].length > 100 || /[\x00-\x1f\x7f-\x9f]/.test(paper[key]))) {
    throw Error('Invalid paper comparison text. No command was sent.');
  }
  const [item, total, cash, amount] = fields.map(key => foldSpaces(paper[key]));
  if (!/\p{L}/u.test(item) || !/\p{L}/u.test(total) || !/\p{Script=Cyrillic}/u.test(cash) ||
      new Set([item, total, cash]).size !== 3 || !/^[0-9]+(?:[., ][0-9]+)*$/.test(amount) ||
      !hasPrintedAmount(total, amount) || !hasPrintedAmount(cash, amount)) {
    throw Error('This paper layout needs a different comparison. Check stopped before connecting.');
  }
  return { item, total, cash };
}

async function readJournal(exchange, serial, document, paper, firstSequence = 0x20) {
  const expected = paperReferences(serial, document, paper);
  if (!Number.isInteger(firstSequence) || firstSequence < 0x20 || firstSequence > 0x7f) throw Error('Invalid sequence.');
  let sequence = firstSequence;
  async function send(command, payload) {
    const current = sequence;
    sequence = sequence === 0x7f ? 0x20 : sequence + 1;
    const frame = encodeRequest({ sequence: current, command, data: Buffer.from(payload, 'ascii') });
    const response = await exchange(frame);
    const reply = decodeResponse(response, { sequence: current, command });
    closedStatus(reply.status);
    return { ...reply, frame: response, sequence: current };
  }
  // The first reply may be cached from an earlier command with the same
  // sequence. A second distinct sequence obtains a fresh identity response.
  for (let i = 0; i < 2; i++) {
    const reply = await send(90, '0');
    const identity = await probeIdentity({ exchange: async () => reply.frame }, reply.sequence, serial);
    if (!identity.ok || !identity.onsiteFirmware) throw Error('Printer identity, installed firmware or status did not match. Stop.');
  }
  const state = (await send(76, 'T')).data.toString('latin1').split(',');
  const amount = value => /^[+-][0-9]{9}$/.test(value) || (value?.length === 9 && /^ *[+-]?[0-9]+$/.test(value));
  if (state.length !== 4 || state[0] !== '0' || !/^ *[0-9]{1,4}$/.test(state[1]) || state[1].length !== 4 ||
      !amount(state[2]) || !amount(state[3])) throw Error('Receipt state is open or unrecognized. Stop.');
  const last = (await send(113, '')).data;
  if (!last.equals(Buffer.from(document, 'ascii'))) throw Error('The chosen document is not the last printed document. Stop.');

  let lines = 0, end = '';
  const matches = { item: 0, total: 0, cash: 0, documentNumber: 0 };
  // A separate number can occur on an unrelated line. This count is only a
  // text observation and has no bearing on checkout or recovery.
  const documentToken = new RegExp('(?:^|[ #:])' + document + '(?=$| )');
  for (let index = 0; index < MAX_LINES + 1; index++) {
    const reply = (await send(119, index === 0 ? 'R,' + document : 'N')).data;
    if (reply.equals(Buffer.from('F'))) { end = 'end-of-data'; break; }
    if (reply.equals(Buffer.from('*,'))) { end = 'document separator'; break; }
    if (index === MAX_LINES || reply.length < 2 || reply[0] !== 0x50 || reply[1] !== 0x2c) {
      throw Error('Journal reply is malformed or exceeds the line limit. Stop.');
    }
    const content = foldSpaces(decoder.decode(reply.subarray(2)));
    for (const key of Object.keys(expected)) if (content === expected[key]) matches[key]++;
    if (documentToken.test(content)) matches.documentNumber++;
    lines++;
  }
  if (!end) throw Error('Journal read did not finish within the limit. Stop.');
  return { lines, end, matches };
}

async function main() {
  if (process.argv.length !== 2) throw Error('Do not pass command-line arguments.');
  const prompt = readline.createInterface({ input:process.stdin, output:process.stdout });
  const ask = q => new Promise(resolve => prompt.question(q, resolve));
  try {
    console.log('PF700 v5 closed cash receipt check. Read-only commands on COM3.');
    console.log('Every inquiry can replace the printer’s cached last response. Do not continue if ANY sale or report is unresolved, even outside Arra.');
    console.log('Close Arra and all other printer programs. Use the paper from the reconciled cash sale only if it is still the last printed document.');
    console.log('Keep the printer idle throughout. Your entries are visible on this screen. Never enter a customer name or other personal information.');
    if (await ask('Type CLEAR ONLY if all transactions and reports are resolved and no other program is using the printer: ') !== 'CLEAR') { console.log('Cancelled before connecting.'); return; }
    const serial = (await ask('Enter the 11-character serial from the intended printer label (kept local): ')).trim();
    const document = (await ask('Enter the 7-digit number of the last printed, closed document: ')).trim();
    console.log('Copy each whole paper line, including spelling, case and punctuation. One space can stand for several. Stop if the lines are missing or contain personal details.');
    const paper = {
      item: await ask('Whole line containing the item name: '),
      total: await ask('Whole total line, including its label and amount: '),
      cash: await ask('Whole cash line, including its exact Cyrillic label and amount: '),
      amount: await ask('Amount exactly as printed on both the total and cash lines: ')
    };
    paperReferences(serial, document, paper);
    if (await ask('Type READ to connect and replace the cached printer response, or press Enter to cancel: ') !== 'READ') { console.log('Cancelled before connecting.'); return; }
    prompt.close();
    const pipe = openPipe();
    try {
      const result = await readJournal(pipe.exchange, serial, document, paper, randomInt(0x20, 0x80));
      const { item, total, cash, documentNumber } = result.matches;
      console.log('Share only this summary:');
      console.log('Lines=' + result.lines + ' | End=' + result.end +
        ' | Item line=' + item + ' | Total line=' + total + ' | Cash line=' + cash +
        ' | Document number token=' + documentNumber);
      console.log('Counts describe matching journal lines. A number can occur for a different reason. This check cannot authorize a payment or recovery.');
    } finally { await pipe.close(); }
  } finally { prompt.close(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); console.error('The check stopped. Ask for help.'); process.exitCode = 1; });
module.exports = { readJournal, MAX_LINES };
