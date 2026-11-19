'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { MAX_LINES, summarizeBill2Journal, readBill2Journal } = require('../scripts/pf700-close-evidence/match-journal');

const candidate = { billId:2, total:150, sequence:0x7f, serial:'SYNTHETIC01', expectedDocument:'0000030' };
const serialReply = 'QA-700DEMOX,1.00MK 23OCT14 1230,BEEF,01001101,7,' + candidate.serial;
const title = 'ФИСКАЛНА СМЕТКА';
const items = ['1 x 70,00', 'Espresso 70,00 В', '1 x 80,00', 'Macchiato 80,00 В'];
const total = 'ВКУПЕН ПРОМЕТ 150,00', cash = 'ВО ГОТОВО 150,00';
const keyLines = [...items, total, cash, title, candidate.expectedDocument];
const vat = ['ВКУПНО ДДВ А=18,00% 0,00', 'ВКУПНО ДДВ Б=5,00% 0,00',
  'ВКУПНО ДДВ В=10,00% 13,64', 'ВКУПНО ДДВ Г=0,00% 0,00'];
const vatTotal = 'ВКУПНО ДДВ 13,64';
const withTax = [title, '#0002', ...items, 'ПРОМЕТ ОД МАКЕДОНСКИ ПР. 150,00', ...vat, vatTotal,
  total, vatTotal, ...vat, cash, '0000013 ДАТУМ 01.01.26 ВРЕМЕ 10:15', title, candidate.expectedDocument];

// Wire fixtures include the Macedonian Ј and verbatim Cyrillic group В.
const decoder = new TextDecoder('windows-1251');
const cpBytes = new Map(Array.from({ length:256 }, (_, byte) => [decoder.decode(Buffer.from([byte])),byte]));
function cp1251(text) {
  return Buffer.from([...text].map(c => {
    assert.ok(cpBytes.has(c));
    return cpBytes.get(c);
  }));
}
function wrap(seq, cmd, data, flags = '888082e1809a') {
  const body = Buffer.concat([Buffer.from([43 + data.length, seq, cmd]), data, Buffer.from([4]),
    Buffer.from(flags, 'hex'), Buffer.from([5])]);
  const sum = body.reduce((a,b) => a + b, 0);
  return Buffer.concat([Buffer.from([1]), body,
    Buffer.from([12,8,4,0].map(shift => 48 + ((sum >> shift) & 15))), Buffer.from([3])]);
}
function device(options = {}) {
  const calls = [], replies = [];
  const journal = (options.lines || keyLines).map(line => 'P,' + line).concat(options.end ?? '*,');
  function exchange(request) {
    const seq = request[2], cmd = request[3], data = request.subarray(4, -6).toString('ascii');
    const index = calls.length;
    calls.push([seq, cmd, data]);
    let value;
    if (cmd === 90) value = options.identities?.[index] ?? serialReply;
    else if (cmd === 76) value = options.state ?? '0,0002,+000015000,+000015000';
    else if (cmd === 113) value = options.document ?? candidate.expectedDocument;
    else if (cmd === 119) value = journal.shift() ?? 'F';
    else assert.fail('Unexpected command');
    const response = wrap(seq, cmd, Buffer.isBuffer(value) ? value : cp1251(value), options.flags?.[index]);
    if (options.damageAt === index) response[response.length - 2] ^= 1;
    replies.push(response);
    return response;
  }
  return { calls, replies, exchange };
}

test('reads exactly the selected last closed document with two fresh identity probes and hashes the bounded replies', async () => {
  const d = device({ lines:withTax });
  const summary = await readBill2Journal(d.exchange, candidate);
  assert.equal(summary.outcome, 'matched');
  assert.equal(summary.reason, 'paper-fields-match');
  assert.equal(summary.end, 'separator');
  assert.equal(summary.receiptState, 'retained');
  assert.equal(summary.lastDocumentMatched, true);
  assert.equal(summary.lines, withTax.length);
  assert.deepEqual(summary.counts, { espressoQuantity:1, espressoItem:1, macchiatoQuantity:1, macchiatoItem:1,
    total:1, cash:1, fiscalTitle:2, documentLine:1, documentMentions:1, unrecognized:0 });
  assert.equal(summary.responseHash, createHash('sha256').update(Buffer.concat(d.replies)).digest('hex'));
  assert.deepEqual(d.calls.slice(0, 5), [[32,90,'0'],[33,90,'0'],[34,76,'T'],[35,113,''],[36,119,'R,0000030']]);
  assert.equal(d.calls.length, 5 + withTax.length);
  assert.ok(d.calls.slice(5).every(([seq,cmd,data], i) => seq === 37 + i && cmd === 119 && data === 'N'));
});

test('accepts a cleared closed state and space alignment with optional printed tax blocks', async () => {
  const lines = keyLines.map(line => '   ' + line.replaceAll(' ', '   ') + ' ');
  lines.splice(4, 0, '-------------------', '');
  const d = device({ state:'0,   0,+000000000,+000000000', lines });
  const result = await readBill2Journal(d.exchange, { ...candidate, sequence:0x23 });
  assert.equal(result.outcome, 'matched');
  assert.equal(result.receiptState, 'cleared');
  assert.deepEqual(d.calls[0], [0x24,90,'0']);
});

test('recognizes the bounded private header and repeated enrolled serials only in their paper positions', async () => {
  const merchant = ['ПРИМЕР Д.О.О.Е.Л. ПРИМЕР', 'Ул. Пример бр.12', 'ПРИМЕР ДООЕЛ', 'УЛ. ПРИМЕР БР.12',
    'ДАН.БРОЈ: 9999999999999', 'ДДВ БРОЈ: MK9999999999999'];
  const lines = withTax.toSpliced(2, 0, ...merchant).toSpliced(-2, 0, candidate.serial, candidate.serial);
  const result = await readBill2Journal(device({ lines }).exchange, candidate);
  assert.equal(result.outcome, 'matched');
  assert.equal(result.counts.unrecognized, 0);
  assert.deepEqual(result.structure.slice(2, 8), ['merchant-city','street','merchant','street','tax-id','vat-id']);
  assert.deepEqual(result.structure.slice(-5), ['receipt-date','device-serial','device-serial','fiscal-title','document']);
  assert.doesNotMatch(JSON.stringify(result), /9999999999999|ПРИМЕР|Пример|БРОЈ|SYNTHETIC01/);
  for (const wrong of [
    lines.with(2,'ДРУГО ДООЕЛ ПРИМЕР'), lines.with(5,'УЛ. ДРУГО БР.12'), lines.with(6,'ДАН.БРОЈ: 12'),
    lines.with(7,'ДДВ БРОЈ: MK9999999999998'), lines.with(-3,'DIFFERENT01'),
    lines.toSpliced(-2, 0, candidate.serial), lines.toSpliced(2, 0, 'ДРУГ ПРОИЗВОД'),
    lines.toSpliced(3, 0, 'КАРТИЧКА 0,00'), lines.toSpliced(-2, 0, '1 x 0,00'),
    lines.with(3, 'ВО ГОТОВО 150').with(5, 'ВО ГОТОВО 150'), lines.with(3, 'ПИВО 1,00').with(5, 'ПИВО 1,00'),
    lines.with(2, 'КАРТИЧКА ДООЕЛ ПРИМЕР').with(4, 'КАРТИЧКА ДООЕЛ')
  ]) assert.equal(summarizeBill2Journal(wrong, 'separator', candidate.serial).outcome, 'inconclusive');
});

test('wrong or extra quantities, items, amounts, tenders and VAT details never match', () => {
  for (const [index, wrong] of [[0,'2 x 70,00'],[0,'1 x 7,00'],[1,'Espresso 70,00 B'],[1,'Espresso 170,00 В'],
    [1,'espresso 70,00 В'],[1,'Espresso 70,00 А'],[2,'1 x 80.00'],[3,'Black Macchiato 80,00 В'],
    [4,'ВКУПЕН ПРОМЕТ -150,00'],[4,'ВКУПЕН ПРОМЕТ 1150,00'],[5,'КАРТИЧКА 150,00'],[5,'ВО ГОТОВО 1500,00']]) {
    assert.equal(summarizeBill2Journal(keyLines.with(index, wrong), 'separator').outcome, 'inconclusive');
  }
  for (const extra of [items[0],items[1],'1 x 0,00','Sample 0,00 В','CASH 0,00','КАРТИЧКА 10,00',
    total,cash,'unknown text','ВКУПНО ДДВ 3,64',vat[0]]) {
    assert.equal(summarizeBill2Journal(keyLines.toSpliced(4, 0, extra), 'separator').outcome, 'inconclusive');
  }
  for (const index of [0,1,2,3,4,5]) {
    assert.equal(summarizeBill2Journal(keyLines.toSpliced(index,1), 'separator').outcome, 'inconclusive');
  }
  assert.equal(summarizeBill2Journal(keyLines.with(0,items[2]).with(2,items[0]), 'separator').outcome,'inconclusive');
  assert.equal(summarizeBill2Journal(withTax.with(withTax.indexOf(vat[2]), 'ВКУПНО ДДВ В=10,00% 0,00'), 'separator').outcome,'inconclusive');
});

test('number must be unique and standalone below the fiscal footer, independently of a header title', () => {
  for (const lines of [
    [title,...keyLines.toSpliced(-2,1)], keyLines.toSpliced(-2,1), keyLines.toSpliced(-1,1),
    keyLines.with(-1,'Doc: 0000030'), keyLines.with(-1,'00000300'), keyLines.with(-1,'0000031'),
    keyLines.with(-2,'0000030').with(-1,title), [...keyLines,'unidentified'], ['Other field #0000030',...keyLines],
    ['0000030',...keyLines], [...keyLines,candidate.expectedDocument], [...keyLines.slice(0,-1),'receipt','0000030']
  ]) assert.equal(summarizeBill2Journal(lines, 'separator').outcome, 'inconclusive');
  assert.equal(summarizeBill2Journal([title,...keyLines], 'separator').outcome, 'matched');
});

test('protects unknown receipt content, merchant data, device identifiers and transport errors', async () => {
  const privateText = 'Sample private field 12345678';
  const d = device({ lines:[privateText, '0000030 / 0000030', ...keyLines] });
  const summary = await readBill2Journal(d.exchange, candidate);
  assert.equal(summary.counts.documentMentions, 3);
  assert.equal(summary.counts.unrecognized, 2);
  assert.equal(summary.structure[0], 'unrecognized');
  assert.equal(summary.outcome, 'inconclusive');
  const failure = await readBill2Journal(() => { throw Error(privateText); }, candidate);
  assert.equal(failure.outcome, 'inconclusive');
  assert.equal(failure.receiptState, 'unverified');
  assert.equal(failure.lastDocumentMatched, false);
  assert.equal(failure.responseHash, null);
  assert.doesNotMatch(JSON.stringify([failure, summary]), /12345678|0000030|ГОТОВО|Macchiato 80|SYNTHETIC01|Sample private/);
});

test('invalid candidates never reach the transport', async () => {
  for (const patch of [{billId:1},{total:151},{expectedDocument:'0000031'},{sequence:31},{sequence:128},
    {sequence:32.5},{serial:'bad'}]) {
    const d = device();
    assert.equal((await readBill2Journal(d.exchange, { ...candidate, ...patch })).reason,'candidate');
    assert.deepEqual(d.calls, []);
  }
});

test('wrong serial, stale identity, firmware, status or document stop before command 119', async () => {
  for (const [options, count, reason] of [
    [{identities:[serialReply.replace(candidate.serial,'DIFFERENT01')]},1,'identity'],
    [{identities:[serialReply, serialReply.replace(candidate.serial,'DIFFERENT01')]},2,'identity'],
    [{identities:[serialReply, '1.00MK 231014 1230,BEEF,0101,7,' + candidate.serial]},2,'identity'],
    [{flags:{0:'88808ae1809a'}},1,'identity'], [{flags:{2:'88808ae1809a'}},3,'receipt-state'],
    [{state:'1,0002,+000015000,+000015000'},3,'receipt-state'],
    [{state:'0,0002,15000,+000015000'},3,'receipt-state'],
    [{document:'0000031'},4,'last-document'], [{document:Buffer.from('b0303030303330','hex')},4,'last-document']
  ]) {
    const d = device(options);
    assert.equal((await readBill2Journal(d.exchange, candidate)).reason,reason);
    assert.equal(d.calls.length, count);
    assert.ok(d.calls.every(([,cmd]) => cmd !== 119));
  }
});

test('different retained aggregates allow collecting evidence while keeping the result inconclusive', async () => {
  const d = device({ state:'0,0001,+000007000,+000007000' });
  const result = await readBill2Journal(d.exchange, candidate);
  assert.equal(result.reason, 'receipt-state-values');
  assert.equal(result.receiptState, 'mismatch');
  assert.equal(result.lastDocumentMatched, true);
  assert.equal(result.outcome, 'inconclusive');
  assert.equal(result.counts.cash, 1);
  assert.equal(result.end,'separator');
});

test('requires a framed separator, checks each status and checksum, and stops at the first failure', async () => {
  for (const [options, reason, count] of [
    [{end:'F'},'missing-separator',5 + keyLines.length],
    [{end:'*,more'},'journal-reply',5 + keyLines.length],
    [{end:Buffer.from([80,44,16,64])},'journal-reply',5 + keyLines.length],
    [{damageAt:5},'journal-reply',6], [{flags:{6:'88808ae1809a'}},'journal-reply',7]
  ]) {
    const d = device(options);
    const result = await readBill2Journal(d.exchange, candidate);
    assert.equal(result.reason, reason);
    assert.equal(result.outcome, 'inconclusive');
    assert.equal(d.calls.length, count);
  }
  const d = device({ lines:Array(MAX_LINES + 1).fill('other') });
  const result = await readBill2Journal(d.exchange, candidate);
  assert.equal(result.reason, 'line-limit');
  assert.equal(result.lines, MAX_LINES);
  assert.equal(d.calls.length, MAX_LINES + 5);
  assert.ok(d.calls.slice(5).every(([,cmd,payload]) => cmd === 119 && payload === 'N'));
});
