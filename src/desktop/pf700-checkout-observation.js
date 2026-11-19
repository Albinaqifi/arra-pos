// Read-only observation for the enrolled 1.00MK device. These aggregate
// fields cannot prove that a receipt belongs to a bill or identify tender.
const { encodeRequest, decodeResponse } = require('./pf700-frame');

async function observeCheckout(pipe, expectedSerial, firstSequence, inspectIdentity) {
  let sequence=firstSequence;
  const next=()=>{const value=sequence;sequence=sequence===0x7f?0x20:sequence+1;return value;};
  const checked = (condition) => { if (!condition) throw Error('Unexpected PF700 observation'); };
  const safeStatus = status => checked(!(status[0]&0x37) && !(status[1]&0x3f) && !(status[2]&0x05) &&
    !(status[4]&0x35) && !(status[5]&0x01) && (status[5]&0x1a)===0x1a);
  let open;
  for (let i=0;i<2;i++) {
    const seq=next(), request=encodeRequest({sequence:seq,command:90,data:Buffer.from('0')});
    const identity=inspectIdentity(await pipe.exchange(request),seq,expectedSerial,true);
    checked(identity.ok && identity.onsiteFirmware);
  }
  async function send(command,data='') {
    const seq=next(), frame=await pipe.exchange(encodeRequest({sequence:seq,command,data:Buffer.from(data,'ascii')}));
    const reply=decodeResponse(frame,{sequence:seq,command}); safeStatus(reply.status);
    const current=Boolean(reply.status[2]&0x08);
    if (open !== undefined) checked(current===open);
    return {data:reply.data.toString('latin1'),open:current};
  }
  const receipt=await send(76,'T'); open=receipt.open;
  const fields=receipt.data.split(',');
  const money=value=>{checked(/^\+[0-9]{9}$/.test(value));return Number(value.slice(1));};
  checked(fields.length===4 && fields[0]===(open?'1':'0') && fields[1].length===4 && /^ *[0-9]+$/.test(fields[1]));
  const items=Number(fields[1]), amountMinor=money(fields[2]), tenderMinor=money(fields[3]);
  let taxTotalsMinor;
  if (open) {
    const tax=(await send(103)).data.split(',');
    checked(tax.length===5 && ['0','1'].includes(tax[0]));
    taxTotalsMinor=tax.slice(1).map(money);
  }
  const lastDocumentNumber=(await send(113)).data;
  checked(/^[0-9]{7}$/.test(lastDocumentNumber));
  return {open,items,amountMinor,tenderMinor,lastDocumentNumber,...(taxTotalsMinor?{taxTotalsMinor}:{})};
}
module.exports = { observeCheckout };
