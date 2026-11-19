// Accent PF550/PF700 v1.40. This module never acquires a port. The caller owns
// exclusive device access, durable intent and commissioning of the device profile.
const { randomInt } = require('node:crypto');
const { encodeRequest, decodeResponse } = require('./pf700-frame');

const MAX_AMOUNT = 99999999;
// The on-site receipt-state field holds nine digits in hundredths of MKD.
const MAX_ONSITE_TOTAL = 9_999_999;
const GROUPS = new Map([['А', { byte: 0xc0, index: 0, rate: 18 }], ['В', { byte: 0xc2, index: 2, rate: 10 }]]);
const ascii = value => Buffer.from(value, 'ascii');

function requireMatch(condition) {
  if (!condition) throw Error('Unexpected PF700 checkout data');
}

function saleData(line, domesticProduct) {
  const group = GROUPS.get(line.taxGroup);
  requireMatch(group && line.taxRate === group.rate && Number.isSafeInteger(line.quantity) &&
    line.quantity > 0 && Number.isSafeInteger(line.unitPrice) && line.unitPrice > 0 &&
    line.unitPrice * line.quantity <= MAX_AMOUNT);
  // The installed text code page for Albanian is unverified. The rehearsal
  // uses the full Latin name without diacritics, split over up to two lines.
  requireMatch(typeof line.name === 'string' && line.name.length <= 120);
  const name = line.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  requireMatch(name.trim() && name.length <= 50 && !/[^\x20-\x7e]/.test(name));
  const label = name.length <= 25 ? name : name.slice(0, 25) + '\n' + name.slice(25);
  const prefix = domesticProduct ? Buffer.from([9, 0x40, group.byte]) : Buffer.from([9, group.byte]);
  return Buffer.concat([ascii(label), prefix, ascii(line.unitPrice + '*' + line.quantity)]);
}

function prepare(snapshot, domesticProduct, maxTotal) {
  requireMatch(snapshot.account === 'A' && snapshot.currency === 'MKD' &&
    Number.isSafeInteger(snapshot.billId) && snapshot.billId > 0 &&
    ['cash', 'card'].includes(snapshot.method) && Number.isSafeInteger(snapshot.total) &&
    snapshot.total > 0 && snapshot.total <= maxTotal && Array.isArray(snapshot.lines) &&
    snapshot.lines.length > 0 && snapshot.lines.length <= 512 && typeof domesticProduct === 'boolean' &&
    (!domesticProduct || snapshot.lines.length === 1));
  const sums = [0, 0, 0, 0];
  const items = snapshot.lines.map(line => {
    const data = saleData(line, domesticProduct);
    sums[GROUPS.get(line.taxGroup).index] += line.unitPrice * line.quantity;
    return data;
  });
  requireMatch(sums.reduce((a, b) => a + b, 0) === snapshot.total);
  return { items, sums, total: snapshot.total, method: snapshot.method };
}

function canEncodePf700Receipt(snapshot) {
  try {
    // Checkout reserves the payment selection before the device is identified.
    prepare(snapshot, false, MAX_ONSITE_TOTAL);
    return true;
  } catch {
    return false;
  }
}

function ready(status, open) {
  requireMatch(!(status[0] & 0x37) && !(status[1] & 0x3f) && !(status[2] & 0x05) &&
    !(status[4] & 0x35) && !(status[5] & 0x01) && (status[5] & 0x1a) === 0x1a &&
    Boolean(status[2] & 0x08) === open);
}

function counters(data) {
  const pair = data.toString('latin1').split(',');
  requireMatch(pair.length === 2 && pair.every(n => n.length === 4 && /^ *[0-9]+$/.test(n)));
  return pair.map(Number);
}

function documentNumber(data) {
  const text = data.toString('latin1');
  requireMatch(/^[0-9]{7}$/.test(text));
  return text;
}

// On the identified 1.00MK unit, 76/T and 103 report signed nine-digit
// hundredths. Sale prices and explicit tenders are still entered in MKD.
function onsiteAmount(mkd) {
  return '+' + String(100 * mkd).padStart(9, '0');
}

function checkState(data, open, onsiteFirmware, items, amount, tendered = amount) {
  const fields = data.toString('latin1').split(',');
  requireMatch(fields.length === 4 && fields[0] === (open ? '1' : '0') &&
    fields[1].length === 4 && /^ *[0-9]+$/.test(fields[1]));
  // Older v1.40 fields can occupy nine bytes including sign/padding.
  requireMatch(fields.slice(2).every(n => /^[+-][0-9]{9}$/.test(n) ||
    (!onsiteFirmware && n.length === 9 && /^ *[+-]?[0-9]+$/.test(n))));
  if (items !== undefined) {
    requireMatch(Number(fields[1]) === items);
    if (onsiteFirmware) {
      requireMatch(fields[2] === onsiteAmount(amount) && fields[3] === onsiteAmount(tendered));
    } else {
      requireMatch(Number(fields[2]) === amount && Number(fields[3]) === tendered);
    }
  }
}

function checkRates(data) {
  const rates = data.toString('latin1').split(',').map(value => value.replace(/^ +| +$/g, ''));
  requireMatch(rates.length === 4 && rates.every(n => /^(?:[0-9]{1,2}|0*[0-9]{1,2}\.[0-9]{1,2})$/.test(n) &&
    Number(n) <= 99) && Number(rates[0]) === 18 && Number(rates[2]) === 10);
}

function checkAmounts(fields, expected) {
  requireMatch(fields.length === expected.length && fields.every((n, index) => n.length <= 10 &&
    /^ *\+?[0-9]+(?:\.0{1,2})?$/.test(n) && Number(n) === expected[index]));
}

// exchange takes one complete request and supplies its single bounded reply.
// A failure from the first open write onward always requires reconciliation.
async function executePf700Checkout(snapshot, operator, exchange) {
  let openAttempted = false;
  try {
    const { domesticProduct = false, onsiteFirmware = false } = operator;
    requireMatch(typeof onsiteFirmware === 'boolean');
    const { items, sums, total, method } = prepare(snapshot, domesticProduct, onsiteFirmware ? MAX_ONSITE_TOTAL : MAX_AMOUNT);
    const { firstSequence, operatorNumber, operatorPassword, tillNumber } = operator;
    requireMatch(Number.isInteger(firstSequence) && firstSequence >= 0x20 && firstSequence <= 0x7f &&
      ['string', 'number'].includes(typeof operatorNumber) && /^[1-8]$/.test(String(operatorNumber)) &&
      typeof operatorPassword === 'string' && /^[0-9]{4,6}$/.test(operatorPassword) &&
      ['string', 'number'].includes(typeof tillNumber) && /^[0-9]{1,5}$/.test(String(tillNumber)));
    let sequence = firstSequence;
    async function send(command, data, open, allowedControls = []) {
      const identity = { sequence, command };
      sequence = sequence === 0x7f ? 0x20 : sequence + 1;
      const request = encodeRequest({ ...identity, data, allowedControls });
      const frame = await exchange(request);
      requireMatch(Buffer.isBuffer(frame) && frame.length <= 149);
      let start = 0;
      while (frame[start] === 0x16 && start < 48) start++;
      const reply = decodeResponse(frame.subarray(start), identity);
      ready(reply.status, open);
      if (command === 74) requireMatch(reply.data.equals(reply.status));
      return reply.data;
    }

    await send(74, ascii('X'), false);
    checkState(await send(76, ascii('T'), false), false, onsiteFirmware);
    checkRates(await send(97, undefined, false));
    const priorDocument = documentNumber(await send(113, undefined, false));
    requireMatch(Number(priorDocument) < 9999999);

    if (operator.beforeOpen) await operator.beforeOpen({ previousDocumentNumber: priorDocument });
    openAttempted = true;
    const before = counters(await send(48, ascii([operatorNumber, operatorPassword, tillNumber].join(',')), true));
    requireMatch(before[0] < 9999);
    for (const item of items) {
      requireMatch((await send(49, item, true, [9, 10])).length === 0);
    }
    if (onsiteFirmware) {
      // These two inquiries were verified together before the on-site cash
      // tender. Require the exact receipt, an unpaid balance and each VAT sum.
      checkState(await send(76, ascii('T'), true), true, true, items.length, total, 0);
      const current = (await send(103, undefined, true)).toString('latin1');
      requireMatch(current === ['1', ...sums.map(onsiteAmount)].join(','));
    } else {
      const totals = (await send(51, ascii('00'), true)).toString('latin1').split(',');
      checkAmounts(totals, [total, ...sums]);
      const current = (await send(103, undefined, true)).toString('latin1').split(',');
      requireMatch(['0', '1'].includes(current[0]));
      checkAmounts(current.slice(1), sums);
    }
    // A lone TAB tenders the full balance in cash on the on-site unit.
    // D remains the explicit debit register in the card rehearsal.
    const tender = onsiteFirmware && method === 'cash' ? ascii('\t') : ascii('\t' + (method === 'card' ? 'D' : 'P') + total);
    const paid = (await send(53, tender, true, [9])).toString('latin1');
    requireMatch(onsiteFirmware ? paid.length <= 14 && /^[RD] *\+?0{1,10}(?:\.0{1,2})?$/.test(paid) : /^R\+0{1,9}$/.test(paid));
    checkState(await send(76, ascii('T'), true), true, onsiteFirmware, items.length, total);
    const after = counters(await send(56, undefined, false));
    requireMatch(after[0] === before[0] + 1 && after[1] === before[1]);
    checkState(await send(76, ascii('T'), false), false, onsiteFirmware, items.length, total);
    const reference = documentNumber(await send(113, undefined, false));
    requireMatch(Number(reference) === Number(priorDocument) + 1);
    return { status: 'accepted', reference, evidence: {
      documentNumber: reference, fiscalReceiptCount: after[0], reversalCount: after[1]
    } };
  } catch {
    return { status: openAttempted ? 'uncertain' : 'failed' };
  }
}

function simulatedResponse(sequence, command, value, open) {
  const status = Buffer.from(open ? '888088e1809a' : '888080e1809a', 'hex');
  const data = command === 74 ? status : ascii(value);
  const body = Buffer.concat([Buffer.from([0x2b + data.length, sequence, command]), data,
    Buffer.from([4]), status, Buffer.from([5])]);
  const sum = body.reduce((a, b) => a + b, 0);
  const checksum = Buffer.from([12, 8, 4, 0].map(shift => 0x30 + ((sum >> shift) & 15)));
  return Buffer.concat([Buffer.from([1]), body, checksum, Buffer.from([3])]);
}

// A fresh memory-only device derives its response from the actual wire fields.
// Its counters and operator data are synthetic and never become POS references.
function simulatedDevice() {
  let open = false, count = 0, paid = 0, closed = false;
  const sums = [0, 0, 0, 0];
  return request => {
    const command = request[3];
    const text = request.subarray(4, -6).toString('latin1');
    const total = sums.reduce((a, b) => a + b, 0);
    let reply = '';
    switch (command) {
      case 74: requireMatch(text === 'X'); break;
      case 76:
        requireMatch(text === 'T');
        reply = [Number(open), String(count).padStart(4, '0'), onsiteAmount(total), onsiteAmount(paid)].join(',');
        break;
      case 97: requireMatch(!text); reply = '18.00,5.00,10.00,0.00'; break;
      case 113: requireMatch(!text); reply = closed ? '0000001' : '0000000'; break;
      case 48:
        requireMatch(!open && !closed && /^[1-8],[0-9]{4,6},[0-9]{1,5}$/.test(text));
        open = true; reply = '0000,0000'; break;
      case 49: {
        const fields = /^[\x20-\x7e]{1,25}(?:\n[\x20-\x7e]{1,25})?\t@?([\xc0\xc2])([0-9]{1,8})\*([0-9]{1,8})$/.exec(text);
        requireMatch(open && !paid && fields);
        sums[fields[1].charCodeAt(0) - 0xc0] += Number(fields[2]) * Number(fields[3]);
        count++;
        break;
      }
      case 103: requireMatch(open && !text); reply = [1, ...sums.map(onsiteAmount)].join(','); break;
      case 53:
        requireMatch(open && !paid && (text === '\t' || text === '\tD' + total));
        paid = total; reply = 'R+000000000'; break;
      case 56:
        requireMatch(open && !text && paid === total && paid > 0);
        open = false; closed = true; reply = '0001,0000'; break;
      default: throw Error('Unsupported simulated command');
    }
    return simulatedResponse(request[2], command, reply, open);
  };
}

async function registerSimulatedPf700Sale(snapshot) {
  const billId = snapshot?.billId;
  const operator = { firstSequence: 0x20, operatorNumber: 1, tillNumber: 1, domesticProduct: false, onsiteFirmware: true,
    operatorPassword: String(randomInt(100000, 1000000)) };
  const result = await executePf700Checkout(snapshot, operator, simulatedDevice());
  return result.status === 'accepted' ? { status: 'accepted', reference: 'SIM-' + billId } : result;
}

module.exports = { executePf700Checkout, registerSimulatedPf700Sale, canEncodePf700Receipt, simulatedResponse };
