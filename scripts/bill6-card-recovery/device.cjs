'use strict';

const { randomInt, createHash } = require('node:crypto');
const { encodeRequest, decodeResponse } = require('../../src/desktop/pf700-frame');
const { paymentRegisters } = require('../../src/desktop/pf700-payment-registers');

function hold(ok, reason) {
  if (!ok) throw Error('HOLD_' + reason);
}
const digest = data => createHash('sha256').update(data).digest('hex');
const money = mkd => '+' + String(mkd * 100).padStart(9,'0');
function counters(text) {
  const parts = text.split(',');
  hold(parts.length === 2 && parts.every(field => field.length === 4 && /^ *[0-9]+$/.test(field)), 'CLOSE_COUNTER_FORMAT');
  return { fiscalReceiptCount:Number(parts[0]), reversalCount:Number(parts[1]) };
}
function wire(exchange, audit, initialSequence = randomInt(0x20,0x80)) {
  let sequence = initialSequence;
  return async function send(command, value, open) {
    const identity = {command,sequence};
    sequence = sequence === 0x7f ? 0x20 : sequence + 1;
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value,'ascii');
    const request = encodeRequest({...identity,data,allowedControls: command === 49 ? [9,10] : command === 53 ? [9] : []});
    await audit('request', {...identity, hash:digest(request)});
    const response = await exchange(request);
    const reply = decodeResponse(response,identity);
    const s = reply.status;
    hold(!(s[0]&0x37) && !(s[1]&0x3f) && !(s[2]&0x05) && !(s[4]&0x35) && !(s[5]&0x01) &&
      (s[5]&0x1a) === 0x1a && Boolean(s[2]&8) === open,'PRINTER_STATE');
    await audit('reply',{...identity,hash:digest(response),frame:response.toString('hex')});
    return reply.data.toString('latin1');
  };
}
function checkState(text, open, count, amount, tender) {
  const f = text.split(',');
  hold(f.length === 4 && f[0] === (open ? '1':'0') && f[1].length === 4 && /^ *\d+$/.test(f[1]) &&
    Number(f[1]) === count && f[2] === money(amount) && f[3] === money(tender),'ITEMS_OR_TENDER');
}
function checkTaxes(text, totals, empty) {
  const f = text.split(',');
  hold(f.length === 5 && (f[0] === '1' || (empty && f[0] === '0')) &&
    totals.every((n,i) => money(n) === f[i+1]),'TAX_TOTALS');
}
async function periodReading(send,open) {
  let reply;
  try {reply=await send(67,'',open);} catch {throw Error(open?'HOLD_DAILY_OPEN_REPLY':'HOLD_DAILY_CLOSED_REPLY');}
  const fields=reply.split(',');
  // The enrolled unit has previously supplied this layout while closed. A
  // different open-receipt response cannot be used as a before-sale sample.
  const amount=f=>(f.length===12 && /^ *[+-]?[0-9]+$/.test(f)) || /^[+-][0-9]{12}$/.test(f);
  const count=f=>f.length===4 && /^ *[0-9]+$/.test(f);
  hold(fields.length===4 && fields.slice(0,2).every(amount) && fields.slice(2).every(count),
    open?'DAILY_OPEN_LAYOUT':'DAILY_CLOSED_LAYOUT');
  const [totalMinor,unpaidMinor,issued,field4]=fields.map(Number);
  return {totalMinor,unpaidMinor,issued,field4};
}
async function registerReading(send,open) {
  try {return paymentRegisters(await send(110,'',open));}
  catch {throw Error(open?'HOLD_OPEN_TENDER_REGISTERS':'HOLD_CLOSED_TENDER_REGISTERS');}
}
async function preflight(send, snapshot) {
  for (let index=0;index<2;index++) {
    const f = (await send(90,'0',true)).split(',');
    hold(f.length === 6 && /^[A-Z]{2}-[0-9]{3}[A-Z]{5}$/.test(f[0]) &&
      /^1\.00MK 23OCT14 (?:[01]\d|2[0-3])[0-5]\d$/.test(f[1]) && /^[0-9A-Fa-f]{4}$/.test(f[2]) &&
      /^[01]{8}$/.test(f[3]) && /^\d$/.test(f[4]) && f[5] === snapshot.deviceId,'DEVICE_IDENTITY');
  }
  hold(await send(113,'',true) === snapshot.previousDocument,'PRIOR_DOCUMENT');
  checkState(await send(76,'T',true),true,0,0,0);
  checkTaxes(await send(103,'',true),[0,0,0,0],true);
  const rates = (await send(97,'',true)).split(',').map(field => field.trim());
  hold(rates.length === 4 && rates.every(rate => /^(?:[0-9]{1,2}|0*[0-9]{1,2}\.[0-9]{1,2})$/.test(rate) && Number(rate)<=99) &&
    Number(rates[0]) === 18 && Number(rates[2]) === 10,'TAX_RATES');
  const daily=snapshot.earlierJournal?await periodReading(send,true):null;
  if (daily) hold(daily.issued<9999 && daily.field4<9999 && daily.totalMinor + snapshot.total*100 <= 999999999999,'DAILY_CAPACITY');
  const before = await registerReading(send,true);
  if (daily) before.daily=daily;
  hold(before.amounts.every(Number.isSafeInteger) && before.nextReceipt > 0 && before.nextReceipt < 9999,'PRE_TENDER_REGISTERS');
  return before;
}
async function complete(send, s, before) {
  for (const bytes of s.items) hold(await send(49,bytes,true) === '','ITEM_REPLY');
  checkState(await send(76,'T',true), true,s.items.length,s.total,0);
  checkTaxes(await send(103,'',true),s.taxTotals,false);
  const paid = await send(53,'\tD'+s.total,true);
  hold(paid.length <= 14 && /^[RD] *\+?0{1,10}(?:\.0{1,2})?$/.test(paid),'DEBIT_REPLY');
  checkState(await send(76,'T',true),true,s.items.length,s.total,s.total);
  const finalCounters = counters(await send(56,'',false));
  if (s.earlierJournal) {
    // The historical cash receipt was identified by its numbered journal.
    // Its missing close reply cannot supply either comparative count.
    hold(finalCounters.fiscalReceiptCount>0,'CLOSE_COUNTERS');
  } else {
    hold(finalCounters.fiscalReceiptCount === s.earlierCounters.fiscalReceiptCount + 1 &&
      finalCounters.reversalCount === s.earlierCounters.reversalCount,'CLOSE_COUNTERS');
  }
  checkState(await send(76,'T',false),false,s.items.length,s.total,s.total);
  const documentNumber = await send(113,'',false);
  hold(documentNumber === String(Number(s.previousDocument)+1).padStart(7,'0'),'CLOSED_DOCUMENT');
  const daily=s.earlierJournal?await periodReading(send,false):null;
  if (daily) {
    const first=before.daily;
    hold(daily.totalMinor===first.totalMinor+s.total*100 && daily.unpaidMinor===first.unpaidMinor,'DAILY_AMOUNT_DELTA');
    // Only one receipt was completed. Some device counters can be allocated
    // when it opens. Field 4 has conflicting names in v1.40; retain it by
    // position and never use it to populate command 56's reversal field.
    hold(daily.issued>0 && [first.issued,first.issued+1].includes(daily.issued) &&
      [first.field4,first.field4+1].includes(daily.field4),'DAILY_COUNT_DELTA');
  }
  const after = await registerReading(send,false);
  if (daily) after.daily=daily;
  // Both readings are observations in this recovery, the first with the receipt already open.
  // The firmware may assign the register number on open or on close. Do not infer
  // either number from the lost opening response. Individual tender deltas, the
  // actual close counters, closed receipt state and new document were checked separately.
  hold(after.closure === before.closure && [before.nextReceipt,before.nextReceipt+1].includes(after.nextReceipt) &&
    after.amounts.every((n,i) => Number.isSafeInteger(n) && n === before.amounts[i]+(i === 2 ? s.total*100 : 0)),'DEBIT_REGISTERS');
  return {documentNumber,...finalCounters,debitAmountMinor:after.amounts[2]-before.amounts[2],before,after};
}
module.exports = {hold,digest,wire,preflight,complete};
