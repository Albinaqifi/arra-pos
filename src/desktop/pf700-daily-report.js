// Accent PF550/PF700 v1.40. Preview and recovery use the read-only transport.
// Issuance checks the live device and records durable intent before its single 69/0.
const { randomInt } = require('node:crypto');
const { spawn } = require('node:child_process');
const { encodeRequest, decodeResponse } = require('./pf700-frame');
const { windowsPipe, probeIdentity, validSerial } = require('./pf700-windows-checkout');
const { integer, hundredths, paymentRegisters } = require('./pf700-payment-registers');

function requireMatch(condition) {
  if (!condition) throw Error('PF700 report evidence did not match');
}

class CheckFailure extends Error {
  constructor(code, values = {}) {
    super('PF700 daily report check failed');
    this.detail = {code, ...values};
  }
}

function fieldsOf(text, count, command) {
  const fields = text.split(',');
  if (fields.length !== count) throw new CheckFailure('fields', {command, expected: count, actual: fields.length});
  return fields;
}

function parseReply(command, parse) {
  try { return parse(); }
  catch (error) {
    if (error instanceof CheckFailure) throw error;
    throw new CheckFailure('format', {command});
  }
}

function compare(code, command, field, expected, actual, group) {
  if (expected !== actual) throw new CheckFailure(code, {command, field, expected, actual,
    ...(group === undefined ? {} : {group})});
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
    let reply;
    try {
      const frame = await pipe.exchange(encodeRequest({ ...identity, data: Buffer.from(value, 'ascii') }));
      reply = decodeResponse(frame, identity);
    } catch { throw new CheckFailure('read', {command}); }
    const {status, data} = reply;
    if ((status[0] & 0x37) || (status[1] & 0x3f) || (status[2] & 0x05) ||
        (status[4] & 0x35) || (status[5] & 0x01) || (status[5] & 0x1a) !== 0x1a) throw new CheckFailure('status', {command});
    if (status[2] & 0x08) throw new CheckFailure('receipt-open');
    if (command === 74 && !data.equals(status)) throw new CheckFailure('format', {command});
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

function checkBaseline(baseline) {
  requireMatch(baseline && Number.isInteger(baseline.previousClosure) &&
    baseline.previousClosure >= 0 && baseline.previousClosure < 9999 &&
    typeof baseline.previousDocumentNumber === 'string' && /^[0-9]{7}$/.test(baseline.previousDocumentNumber) &&
    Number(baseline.previousDocumentNumber) < 9999999);
  calendarDate(baseline.deviceDate);
}

function readMemoryRecord(text) {
  return parseReply(64, () => {
    const fields = fieldsOf(text, 6, 64);
    const date = fields[5];
    calendarDate(date);
    return { closure: integer(fields[0], 4), amounts: fields.slice(1, 5).map(registerAmount), date };
  });
}

async function checkRegisters(send, expected, closure) {
  const daily = await send(67);
  parseReply(67, () => {
    const fields = fieldsOf(daily, 4, 67);
    compare('amount', 67, 'total', expected.total * 100, registerAmount(fields[0]));
    compare('amount', 67, 'unpaid', 0, registerAmount(fields[1]));
    compare('count', 67, 'receipts', expected.receiptCount, integer(fields[2], 4));
    compare('count', 67, 'reversals', 0, integer(fields[3], 4));
  });
  const tenders = await send(110);
  fieldsOf(tenders, 6, 110);
  const paid = parseReply(110, () => paymentRegisters(tenders));
  const expectedAmounts = [expected.cash * 100, 0, expected.card * 100, 0];
  ['cash', 'credit', 'card', 'cheque'].forEach((name, i) => compare('amount', 110, name, expectedAmounts[i], paid.amounts[i]));
  compare('count', 110, 'closure', closure, paid.closure);
  compare('count', 110, 'nextReceipt', expected.receiptCount + 1, paid.nextReceipt);
}

function checkTaxTotals(amounts, expected) {
  requireMatch(amounts.length === 4 && amounts.every((value, index) => value === expected.taxTotals[index] * 100));
}

async function checkOpenPeriod(send, expected, closure, expectedDocument = null) {
  // The v1.40 heading calls these net sums while its fields describe
  // turnover by VAT group. Require the exact recorded gross values.
  // Any other representation needs on-site read-only verification.
  const taxes = await send(65);
  parseReply(65, () => {
    const values = fieldsOf(taxes, 5, 65).map(registerAmount);
    compare('amount', 65, 'total', expected.total * 100, values[0]);
    expected.taxTotals.forEach((amount, i) => compare('amount', 65, 'vat', amount * 100, values[i + 1], i));
  });
  await checkRegisters(send, expected, closure);
  const documentNumber = await send(113);
  if (!/^[0-9]{7}$/.test(documentNumber)) throw new CheckFailure('format', {command: 113});
  if (Number(documentNumber) === 9999999) throw new CheckFailure('limit');
  if (expectedDocument !== null) requireMatch(documentNumber === expectedDocument);
  return documentNumber;
}

async function verifyRecord(send, expected, baseline, record) {
  requireMatch(record.closure === baseline.previousClosure + 1 && record.date === baseline.deviceDate);
  checkTaxTotals(record.amounts, expected);
  await checkRegisters(send, { total: 0, cash: 0, card: 0, receiptCount: 0 }, record.closure);
  const documentNumber = await send(113);
  requireMatch(/^[0-9]{7}$/.test(documentNumber) && Number(documentNumber) === Number(baseline.previousDocumentNumber) + 1);
  return { status: 'accepted', reference: String(record.closure).padStart(4, '0'),
    evidence: { closure: record.closure, documentNumber } };
}

function createPf700DailyReportWithTransport({ mode, expectedSerial, openPipe, printerWait }) {
  if (!['device', 'simulation'].includes(mode) || !validSerial(expectedSerial) || typeof openPipe !== 'function') {
    throw Error('Invalid PF700 daily report configuration');
  }
  let busy = false;
  async function run(operation, expected, context, baseline) {
    const recovering = operation === 'reconcile';
    const fallback = recovering ? 'uncertain' : 'failed';
    if (busy) return recovering ? {status: fallback} : {status: fallback, detail: {code: 'busy'}};
    busy = true;
    let pipe, lock, sent = false;
    try {
      checkExpected(expected);
      if (recovering) checkBaseline(baseline);
      if (operation === 'issue') requireMatch(typeof context?.beforeIssue === 'function');
      if (printerWait) {
        // A receipt worker must never claim a sale while this operation owns COM3.
        // Let the operator check again when an existing operation finishes.
        lock = await printerWait.acquire(() => false);
        if (!lock) throw new CheckFailure('busy');
      }
      if (context?.mayRead && !context.mayRead()) return {status: recovering ? 'uncertain' : 'review'};
      const sequence = randomInt(0x20, 0x80);
      let identity;
      try {
        pipe = await openPipe(operation === 'issue' ? 'DailyReport' : 'ReadDailyReport');
        identity = await probeIdentity(pipe, sequence, expectedSerial, true);
      } catch { throw new CheckFailure('read', {command: 90}); }
      if (identity.reason === 'status') throw new CheckFailure('status', {command: 90});
      if (!identity.ok || !identity.onsiteFirmware) throw new CheckFailure('identity');
      if (identity.receiptOpen) throw new CheckFailure('receipt-open');
      const send = createReader(pipe, sequence === 0x7f ? 0x20 : sequence + 1);
      await send(74, 'X');
      const receipt = fieldsOf(await send(76, 'T'), 4, 76);
      if (receipt[0] === '1') throw new CheckFailure('receipt-open');
      parseReply(76, () => {
        requireMatch(receipt[0] === '0' && receipt.slice(2).every(value => /^[+-][0-9]{9}$/.test(value)));
        integer(receipt[1], 4);
      });
      if (recovering) {
        const record = readMemoryRecord(await send(64));
        if (record.closure !== baseline.previousClosure) return await verifyRecord(send, expected, baseline, record);
        const attemptDate = calendarDate(baseline.deviceDate);
        requireMatch(calendarDate(record.date) < attemptDate && calendarDate(clockDate(await send(62))) >= attemptDate);
        const documentNumber = await checkOpenPeriod(send, expected, record.closure, baseline.previousDocumentNumber);
        return { status: 'not-issued', evidence: { closure: record.closure, documentNumber, deviceDate: baseline.deviceDate } };
      }

      const clock = await send(62);
      const deviceDate = parseReply(62, () => clockDate(clock));
      const previous = readMemoryRecord(await send(64));
      // v1.40 permits a single Z on a calendar day. The fiscal period itself
      // is identified by the registered receipts, counters and tender registers.
      if (calendarDate(previous.date) >= calendarDate(deviceDate)) throw new CheckFailure('last-close-date');
      if (previous.closure >= 9999) throw new CheckFailure('limit');
      const previousDocumentNumber = await checkOpenPeriod(send, expected, previous.closure);
      baseline = { previousClosure: previous.closure, previousDocumentNumber, deviceDate };
      checkBaseline(baseline);
      if (operation === 'check') return {status: 'ready', ...baseline};
      if (previousDocumentNumber !== expected.lastDocumentNumber) {
        if (context.warningDocument !== previousDocumentNumber) return { status:'document-warning', saleDocument:expected.lastDocumentNumber, printerDocument:previousDocumentNumber, deviceDate };
      } else if (context.warningDocument !== undefined) return {status: 'review'};
      await context.beforeIssue({ ...baseline });
      sent = true;
      const reply = (await send(69, '0')).split(',');
      requireMatch(reply.length === 6 && integer(reply[0], 4) === previous.closure + 1 && registerAmount(reply[1]) === 0);
      checkTaxTotals(reply.slice(2).map(registerAmount), expected);
      return await verifyRecord(send, expected, baseline, readMemoryRecord(await send(64)));
    } catch (error) {
      if (!sent && !recovering && error instanceof CheckFailure) return {status: 'failed', detail: error.detail};
      return { status: sent ? 'uncertain' : fallback };
    } finally {
      try { if (pipe) await pipe.close(); } catch { /* The validated result precedes port cleanup. */ }
      if (lock) lock.close();
      busy = false;
    }
  }
  return Object.freeze({ mode, deviceId: expectedSerial,
    checkDailyReport: (expected, mayRead) => run('check', expected, {mayRead}),
    issueDailyReport: (expected, context) => run('issue', expected, context),
    reconcileDailyReport: (expected, baseline, mayRead) => run('reconcile', expected, {mayRead}, baseline) });
}

function createWindowsPf700DailyReport({ expectedSerial, printerWait }, startProcess = spawn) {
  return createPf700DailyReportWithTransport({ mode: 'device', expectedSerial, printerWait,
    openPipe: operation => windowsPipe(startProcess, operation) });
}

module.exports = { createPf700DailyReportWithTransport, createWindowsPf700DailyReport };
