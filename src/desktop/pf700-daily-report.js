// Accent PF550/PF700 v1.40. One exclusive session spans evidence collection,
// durable intent and the single 69/0. Recovery has only read operations.
const { randomInt } = require('node:crypto');
const { spawn } = require('node:child_process');
const { encodeRequest, decodeResponse } = require('./pf700-frame');
const { windowsPipe, probeIdentity, validSerial } = require('./pf700-windows-checkout');

function requireMatch(condition) {
  if (!condition) throw Error('PF700 report evidence did not match');
}

function integer(field, width) {
  requireMatch(typeof field === 'string' && field.length === width && /^ *[0-9]+$/.test(field));
  return Number(field);
}

// The identified 1.00MK implementation uses implied hundredths in its
// numeric replies. Accept only that representation on this protocol path.
function hundredths(field) {
  requireMatch(typeof field === 'string' && /^ *[+-]?[0-9]+$/.test(field) && field.length <= 13);
  return Number(field);
}

function registerAmount(field) {
  // 64, 65, 67 and 69 specify 12 bytes; the on-site receipt fields also place
  // an explicit sign before a full-width value.
  requireMatch(typeof field === 'string' && (field.length === 12 || /^[+-][0-9]{12}$/.test(field)));
  return hundredths(field);
}

function calendarDate(stamp) {
  requireMatch(typeof stamp === 'string' && /^[0-9]{6}$/.test(stamp));
  const day = Number(stamp.slice(0, 2)), month = Number(stamp.slice(2, 4)), year = 2000 + Number(stamp.slice(4));
  const date = new Date(Date.UTC(year, month - 1, day));
  requireMatch(date.getUTCDate() === day && date.getUTCMonth() === month - 1);
  return date.getTime();
}

function clockDate(text) {
  const match = /^([0-9]{2})-([0-9]{2})-([0-9]{2}) (?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.exec(text);
  requireMatch(match);
  const stamp = match.slice(1).join('');
  calendarDate(stamp);
  return stamp;
}

function createReader(pipe, firstSequence) {
  let sequence = firstSequence;
  return async function send(command, value = '') {
    const identity = { sequence, command };
    sequence = sequence === 0x7f ? 0x20 : sequence + 1;
    const frame = await pipe.exchange(encodeRequest({ ...identity, data: Buffer.from(value, 'ascii') }));
    const { status, data } = decodeResponse(frame, identity);
    requireMatch(!(status[0] & 0x37) && !(status[1] & 0x3f) && !(status[2] & 0x0d) &&
      !(status[4] & 0x35) && !(status[5] & 0x01) && (status[5] & 0x1a) === 0x1a);
    if (command === 74) requireMatch(data.equals(status));
    return data.toString('latin1');
  };
}

function checkExpected(expected) {
  const { total, cash, card, receiptCount, lastDocumentNumber, taxTotals } = expected;
  requireMatch(Number.isInteger(receiptCount) && receiptCount > 0 && receiptCount < 9999 &&
    typeof lastDocumentNumber === 'string' && /^[0-9]{7}$/.test(lastDocumentNumber) &&
    Number(lastDocumentNumber) >= receiptCount && Number(lastDocumentNumber) < 9999999 &&
    Array.isArray(taxTotals) && taxTotals.length === 4);
  requireMatch([total, cash, card, ...taxTotals].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 999999999) &&
    total > 0 && cash + card === total && taxTotals.reduce((a, b) => a + b, 0) === total);
}

function checkBaseline(baseline, expected) {
  requireMatch(baseline && Number.isInteger(baseline.previousClosure) &&
    baseline.previousClosure >= 0 && baseline.previousClosure < 9999 &&
    baseline.previousDocumentNumber === expected.lastDocumentNumber);
  calendarDate(baseline.deviceDate);
}

function readMemoryRecord(text) {
  const fields = text.split(',');
  requireMatch(fields.length === 6);
  const date = fields[5];
  calendarDate(date);
  return { closure: integer(fields[0], 4), amounts: fields.slice(1, 5).map(registerAmount), date };
}

function checkRegisters(dailyTotals, paymentTotals, expected, closure) {
  const totals = dailyTotals.split(','), paid = paymentTotals.split(',');
  requireMatch(totals.length === 4 && paid.length === 6 &&
    registerAmount(totals[0]) === expected.total * 100 && registerAmount(totals[1]) === 0 &&
    integer(totals[2], 4) === expected.receiptCount && integer(totals[3], 4) === 0);
  // Arra's card receipt uses D (debit). Credit and cheque are separate PF700 registers.
  requireMatch(paid.slice(0, 4).map(hundredths).every((value, index) =>
    value === [expected.cash * 100, 0, expected.card * 100, 0][index]) &&
    integer(paid[4], 4) === closure && integer(paid[5], 4) === expected.receiptCount + 1);
}

function checkTaxTotals(amounts, expected) {
  requireMatch(amounts.length === 4 && amounts.every((value, index) => value === expected.taxTotals[index] * 100));
}

async function checkOpenPeriod(send, expected, closure) {
  // The v1.40 heading calls these net sums while its fields describe
  // turnover by VAT group. Require the exact recorded gross values.
  // Any other representation needs on-site read-only verification.
  const taxRegisters = (await send(65)).split(',');
  requireMatch(taxRegisters.length === 5 && registerAmount(taxRegisters[0]) === expected.total * 100);
  checkTaxTotals(taxRegisters.slice(1).map(registerAmount), expected);
  checkRegisters(await send(67), await send(110), expected, closure);
  const documentNumber = await send(113);
  requireMatch(documentNumber === expected.lastDocumentNumber);
  return documentNumber;
}

async function verifyRecord(send, expected, baseline, record) {
  requireMatch(record.closure === baseline.previousClosure + 1 && record.date === baseline.deviceDate);
  checkTaxTotals(record.amounts, expected);
  checkRegisters(await send(67), await send(110), { total: 0, cash: 0, card: 0, receiptCount: 0 }, record.closure);
  const documentNumber = await send(113);
  requireMatch(/^[0-9]{7}$/.test(documentNumber) && Number(documentNumber) === Number(baseline.previousDocumentNumber) + 1);
  return { status: 'accepted', reference: String(record.closure).padStart(4, '0'),
    evidence: { closure: record.closure, documentNumber } };
}

function createPf700DailyReportWithTransport({ mode, expectedSerial, openPipe }) {
  if (!['device', 'simulation'].includes(mode) || !validSerial(expectedSerial) || typeof openPipe !== 'function') {
    throw Error('Invalid PF700 daily report configuration');
  }
  let busy = false;
  async function run(expected, context, baseline, recovering) {
    const fallback = recovering ? 'uncertain' : 'failed';
    if (busy) return { status: fallback };
    busy = true;
    let pipe, sent = false;
    try {
      checkExpected(expected);
      if (recovering) checkBaseline(baseline, expected);
      else requireMatch(typeof context?.beforeIssue === 'function');
      pipe = await openPipe(recovering ? 'ReadDailyReport' : 'DailyReport');
      const sequence = randomInt(0x20, 0x80);
      const identity = await probeIdentity(pipe, sequence, expectedSerial);
      requireMatch(identity.ok && identity.onsiteFirmware);
      const send = createReader(pipe, sequence === 0x7f ? 0x20 : sequence + 1);
      await send(74, 'X');
      const receipt = (await send(76, 'T')).split(',');
      requireMatch(receipt.length === 4 && receipt[0] === '0' &&
        receipt.slice(2).every(value => /^[+-][0-9]{9}$/.test(value)));
      integer(receipt[1], 4);
      if (recovering) {
        const record = readMemoryRecord(await send(64));
        if (record.closure !== baseline.previousClosure) return await verifyRecord(send, expected, baseline, record);
        const attemptDate = calendarDate(baseline.deviceDate);
        requireMatch(calendarDate(record.date) < attemptDate && calendarDate(clockDate(await send(62))) >= attemptDate);
        const documentNumber = await checkOpenPeriod(send, expected, record.closure);
        return { status: 'not-issued', evidence: { closure: record.closure, documentNumber, deviceDate: baseline.deviceDate } };
      }

      const deviceDate = clockDate(await send(62));
      const previous = readMemoryRecord(await send(64));
      // v1.40 permits a single Z on a calendar day. The fiscal period itself
      // is identified by the registered receipts, counters and tender registers.
      requireMatch(calendarDate(previous.date) < calendarDate(deviceDate));
      const previousDocumentNumber = await checkOpenPeriod(send, expected, previous.closure);
      baseline = { previousClosure: previous.closure, previousDocumentNumber, deviceDate };
      checkBaseline(baseline, expected);
      await context.beforeIssue({ ...baseline });
      sent = true;
      const reply = (await send(69, '0')).split(',');
      requireMatch(reply.length === 6 && integer(reply[0], 4) === previous.closure + 1 && registerAmount(reply[1]) === 0);
      checkTaxTotals(reply.slice(2).map(registerAmount), expected);
      return await verifyRecord(send, expected, baseline, readMemoryRecord(await send(64)));
    } catch {
      return { status: sent ? 'uncertain' : fallback };
    } finally {
      try { if (pipe) await pipe.close(); } catch { /* The validated result precedes port cleanup. */ }
      busy = false;
    }
  }
  return Object.freeze({ mode, deviceId: expectedSerial,
    issueDailyReport: (expected, context) => run(expected, context, null, false),
    reconcileDailyReport: (expected, baseline) => run(expected, null, baseline, true) });
}

function createWindowsPf700DailyReport({ expectedSerial }, startProcess = spawn) {
  return createPf700DailyReportWithTransport({ mode: 'device', expectedSerial,
    openPipe: operation => windowsPipe(startProcess, operation) });
}

module.exports = { createPf700DailyReportWithTransport, createWindowsPf700DailyReport };
