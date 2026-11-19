'use strict';

const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { encodeRequest, decodeResponse } = require('../../src/desktop/pf700-frame');
const { probeIdentity, validSerial } = require('../../src/desktop/pf700-windows-checkout');

const DOCUMENT = '0000030';
const MAX_LINES = 300;
const decoder = new TextDecoder('windows-1251', { fatal: true });
const fiscalTitle = 'ФИСКАЛНА СМЕТКА';
const exactLines = new Map([
  [fiscalTitle, 'fiscal-title'], [DOCUMENT, 'document'], ['#0002', 'header-mark'],
  ['ПРОМЕТ ОД МАКЕДОНСКИ ПР. 150,00', 'domestic-total'],
  ['ВКУПНО ДДВ 13,64', 'vat-total'], ['ВКУПЕН ПРОМЕТ 150,00', 'total'], ['ВО ГОТОВО 150,00', 'cash']
]);
const labelledFields = [
  [/^1 *x *70,00$/, 'espresso-quantity'], [/^Espresso 70,00 *В$/, 'espresso-item'],
  [/^1 *x *80,00$/, 'macchiato-quantity'], [/^Macchiato 80,00 *В$/, 'macchiato-item'],
  [/^ВКУПНО ДДВ А *= *18,00 *% 0,00$/, 'vat-a'], [/^ВКУПНО ДДВ Б *= *5,00 *% 0,00$/, 'vat-b'],
  [/^ВКУПНО ДДВ В *= *10,00 *% 13,64$/, 'vat-v'], [/^ВКУПНО ДДВ Г *= *0,00 *% 0,00$/, 'vat-g'],
  [/^0000013 ДАТУМ:? (?:0[1-9]|[12][0-9]|3[01])([./-])(?:0[1-9]|1[0-2])\1(?:[0-9]{2}|[0-9]{4})(?: (?:ВРЕМЕ:? )?(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?)?$/, 'receipt-date']
];
const numberToken = /(?<![\p{L}\p{N}])0000030(?![\p{L}\p{N}])/gu;
const foldSpaces = text => text.replace(/ +/g, ' ').replace(/^ | $/g, '');

// Keep only codes for known whole fields. Unknown lines can contain taxpayer
// numbers, addresses or names; no text, masked copy, or per-line hash is saved.
function lineCode(line, serial) {
  if (!line || /^-{3,}$/.test(line)) return 'spacing';
  if (exactLines.has(line)) return exactLines.get(line);
  if (serial && line === serial) return 'device-serial';
  for (const [pattern, code] of labelledFields) if (pattern.test(line)) return code;
  if (/^(?:Espresso|Macchiato)\b/.test(line)) return 'unrecognized-item';
  if (/^[0-9.,]+ *[xXхХ×*]/.test(line)) return 'unrecognized-quantity';
  if (/ГОТОВО|КАРТИЧКА|КАРТИЦА|КРЕДИТ|ЧЕК|TENDER|CASH|CARD/iu.test(line)) return 'unrecognized-tender';
  if (/[0-9]+[,.][0-9]{2}(?![0-9])/.test(line)) return 'unrecognized-amount';
  return 'unrecognized';
}

// Merchant names, addresses and fiscal identifiers are neither retained nor
// accepted as arbitrary introductory text. The paper repeats its name and
// street, then prints the domestic tax number and its MK-prefixed VAT number.
function recognizeMerchantHeader(text, structure) {
  const positions = structure.map((code, i) => code === 'spacing' ? null : i).filter(i => i !== null);
  if (positions.length < 8 || structure[positions[0]] !== 'fiscal-title' || structure[positions[1]] !== 'header-mark') return;
  const [first, street, second, repeatedStreet, tax, vat] = positions.slice(2, 8).map(i => text[i].toUpperCase());
  const companyType = /Д\.?О\.?О\.?Е\.?Л\.?/gu;
  const business = second.replace(companyType, 'ДООЕЛ');
  const registered = first.replace(companyType, 'ДООЕЛ');
  if (!/^[\p{Script=Cyrillic}][\p{Script=Cyrillic} .'"„“”-]{0,54} ДООЕЛ$/u.test(business) ||
      !registered.startsWith(business + ' ') ||
      !/^[\p{Script=Cyrillic}]+(?:[ -][\p{Script=Cyrillic}]+){0,2}$/u.test(registered.slice(business.length + 1))) return;
  if (street !== repeatedStreet ||
      !/^[\p{Script=Cyrillic}][\p{Script=Cyrillic} .'"„“”-]{1,60}(?: |\.)[0-9]{1,4}[\p{Script=Cyrillic}]?$/u.test(street)) return;
  if (/ГОТОВ|КАРТИ|КРЕДИТ|ЧЕК|ВАУЧЕР|КУСУР|СТОРНО|ВКУП|ПРОМЕТ|ПЛАТЕ|ДДВ|СМЕТКА/.test(first + ' ' + street)) return;
  const taxId = /^ДАН\.? *БРОЈ *: *([0-9]{8,15})$/.exec(tax);
  const vatId = /^ДДВ БРОЈ *: *MK([0-9]{8,15})$/.exec(vat);
  if (!taxId || !vatId || taxId[1] !== vatId[1]) return;
  const codes = ['merchant-city','street','merchant','street','tax-id','vat-id'];
  for (let i = 0; i < codes.length; i++) structure[positions[i + 2]] = codes[i];
}

function summarizeBill2Journal(lines, end, serial) {
  const text = lines.map(foldSpaces);
  const structure = text.map(line => lineCode(line, serial));
  recognizeMerchantHeader(text, structure);
  const count = code => structure.filter(value => value === code).length;
  const counts = {
    espressoQuantity:count('espresso-quantity'), espressoItem:count('espresso-item'),
    macchiatoQuantity:count('macchiato-quantity'), macchiatoItem:count('macchiato-item'),
    total:count('total'), cash:count('cash'), fiscalTitle:count('fiscal-title'), documentLine:count('document'),
    documentMentions:lines.reduce((sum, line) => sum + [...line.matchAll(numberToken)].length, 0),
    unrecognized:structure.filter(code => code.startsWith('unrecognized')).length
  };
  // Blank lines and horizontal rules are just alignment. VAT text, when
  // present in the journal, must be a complete block in its paper position.
  const fields = structure.filter(code => code !== 'spacing');
  const vatGroups = 'vat-a vat-b vat-v vat-g';
  const layout = new RegExp('^(?:fiscal-title )?(?:header-mark )?(?:merchant-city street merchant street tax-id vat-id )?' +
    'espresso-quantity espresso-item macchiato-quantity macchiato-item ' +
    '(?:domestic-total )?(?:' + vatGroups + ' vat-total )?total (?:vat-total ' + vatGroups + ' )?' +
    'cash (?:receipt-date )?(?:device-serial ){0,2}fiscal-title document$');
  let reason = 'paper-fields-match';
  if (end !== 'separator') reason = 'missing-separator';
  else if (counts.documentLine !== 1 || counts.documentMentions !== 1 ||
      fields.at(-2) !== 'fiscal-title' || fields.at(-1) !== 'document') reason = 'footer-context';
  else if (counts.unrecognized) reason = 'unrecognized-fields';
  else if (!layout.test(fields.join(' '))) reason = 'paper-layout';
  return { outcome:reason === 'paper-fields-match' ? 'matched' : 'inconclusive', reason,
    lines:lines.length, end, counts, structure };
}

function readyAndClosed(status) {
  return !(status[0] & 0x37) && !(status[1] & 0x3f) && !(status[2] & 0x0d) &&
    !(status[4] & 0x35) && !(status[5] & 0x01) && (status[5] & 0x1a) === 0x1a;
}

async function readBill2Journal(exchange, candidate) {
  const lines = [];
  let end = 'incomplete', reason, frames = 0;
  let receiptState = 'unverified', lastDocumentMatched = false;
  const transcript = createHash('sha256');
  function result(stopReason) {
    const summary = summarizeBill2Journal(lines, end, candidate?.serial);
    if (stopReason) { summary.outcome = 'inconclusive'; summary.reason = stopReason; }
    return { ...summary, receiptState, lastDocumentMatched, responseHash:frames ? transcript.digest('hex') : null };
  }
  if (typeof exchange !== 'function' || candidate?.billId !== 2 || candidate.total !== 150 ||
      candidate.expectedDocument !== DOCUMENT || !validSerial(candidate.serial) ||
      !Number.isInteger(candidate.sequence) || candidate.sequence < 0x20 || candidate.sequence > 0x7f) {
    return result('candidate');
  }
  let sequence = candidate.sequence;
  function next() { sequence = sequence === 0x7f ? 0x20 : sequence + 1; return sequence; }
  async function receive(request) {
    const frame = await exchange(request);
    if (!Buffer.isBuffer(frame) || frame.length < 17 || frame.length > 101) throw Error();
    transcript.update(frame);
    frames++;
    return frame;
  }
  async function send(command, payload) {
    const seq = next();
    const frame = await receive(encodeRequest({ sequence:seq, command, data:Buffer.from(payload, 'ascii') }));
    const reply = decodeResponse(frame, { sequence:seq, command });
    if (!readyAndClosed(reply.status)) throw Error();
    return reply.data;
  }
  try {
    reason = 'identity';
    for (let i = 0; i < 2; i++) {
      const identity = await probeIdentity({ exchange:receive }, next(), candidate.serial);
      if (!identity.ok || !identity.onsiteFirmware) return result(reason);
    }
    reason = 'receipt-state';
    const state = (await send(76, 'T')).toString('latin1').split(',');
    if (state.length !== 4 || state[0] !== '0' || state[1].length !== 4 || !/^ *[0-9]+$/.test(state[1]) ||
        !state.slice(2).every(value => /^[+-][0-9]{9}$/.test(value))) return result(reason);
    const cleared = Number(state[1]) === 0 && Number(state[2]) === 0 && Number(state[3]) === 0;
    const retained = Number(state[1]) === 2 && Number(state[2]) === 15000 && Number(state[3]) === 15000;
    receiptState = cleared ? 'cleared' : retained ? 'retained' : 'mismatch';
    reason = 'last-document';
    if (!(await send(113, '')).equals(Buffer.from(DOCUMENT))) return result(reason);
    lastDocumentMatched = true;
    reason = 'journal-reply';
    for (;;) {
      const data = await send(119, lines.length ? 'N' : 'R,' + DOCUMENT);
      if (data.equals(Buffer.from('*,'))) { end = 'separator'; break; }
      if (data.equals(Buffer.from('F'))) { end = 'end-of-data'; break; }
      if (lines.length === MAX_LINES) return result('line-limit');
      if (data.length < 2 || data[0] !== 0x50 || data[1] !== 0x2c) return result(reason);
      const text = decoder.decode(data.subarray(2));
      if (/[\x00-\x1f\x7f-\x9f]/.test(text)) return result(reason);
      lines.push(text);
    }
    return result(cleared || retained ? null : 'receipt-state-values');
  } catch {
    // The transport may throw a device payload or system path. Retain only the
    // stage, prior validated line observations and bounded response fingerprint.
    return result(reason);
  }
}

module.exports = { readBill2Journal, summarizeBill2Journal, MAX_LINES };
