const test=require('node:test');
const assert=require('node:assert/strict');
const {preflight,complete}=require('../scripts/bill6-card-recovery/device.cjs');

function setup(change={}) {
  // Header, document number, register number, command 67 field four and
  // command 56's reversal field are deliberately unrelated.
  const snapshot={earlierJournal:{kind:'numbered-journal'},earlierCounters:null,deviceId:'SYNTHETIC01',total:21,
    headerNumber:'0105',previousDocument:'0000123',items:[Buffer.from('one'),Buffer.from('two')],taxTotals:[0,0,21,0]};
  const counts=[],fmt=n=>'+'+String(n).padStart(9,'0');
  let items=0,tender=0;
  const send=async (command,data,open)=>{
    counts.push(command);
    switch(command) {
      case 90:return 'QA-700DEMOX,1.00MK 23OCT14 1230,BEEF,01001101,7,SYNTHETIC01';
      case 97:return '018.00,005.00,010.00,000.00';
      case 67:
        if (open && change.noOpen67) throw Error('inquiry unavailable');
        return open?(change.open67||'      +90700,          +0,   7,0012'):
          (change.closed67||'+000000092800,+000000000000,0008,0012');
      case 110:return open?'0,0,200,0,0132,0025':'0,0,2300,0,0132,0025';
      case 113:return open?'0000123':'0000124';
      case 103:return ['1',fmt(0),fmt(0),fmt(items===2?2100:0),fmt(0)].join(',');
      case 76:return [open?'1':'0',String(items).padStart(4,'0'),fmt(items===2?2100:0),fmt(tender)].join(',');
      case 49:items++;return '';
      case 53:assert.equal(data,'\tD21');tender=2100;return 'R+000000000';
      case 56:return change.closed56||'0009,0021';
      default:assert.fail('unexpected command');
    }
  };
  return {snapshot,send,counts};
}
test('numbered-journal recovery records the real close; daily observations remain independently attributed',async ()=>{
  const f=setup(),before=await preflight(f.send,f.snapshot);
  const proof=await complete(f.send,f.snapshot,before);
  assert.deepEqual(proof.before.daily,{totalMinor:90700,unpaidMinor:0,issued:7,field4:12});
  assert.deepEqual(proof.after.daily,{totalMinor:92800,unpaidMinor:0,issued:8,field4:12});
  assert.equal(proof.reversalCount,21);assert.equal(proof.fiscalReceiptCount,9);assert.equal(proof.debitAmountMinor,2100);
  assert.deepEqual(f.counts,[90,90,113,76,103,97,67,110,49,49,76,103,53,76,56,76,113,67,110]);
});
test('an unavailable or malformed open-state 67 or an unrepresentable sale stops before any write',async ()=>{
  for(const [change,stop] of [[{noOpen67:true},'DAILY_OPEN_REPLY'],[{open67:'0,0,0007,0012'},'DAILY_OPEN_LAYOUT'],
    [{open67:'      +90700,          +0,9999,0012'},'DAILY_CAPACITY']]) {
    const f=setup(change);
    await assert.rejects(preflight(f.send,f.snapshot),new RegExp('HOLD_'+stop));
    assert.deepEqual(f.counts,[90,90,113,76,103,97,67]);
  }
});
test('current-period sales, unpaid, count and close response each constrain the verified result',async ()=>{
  for(const [change,stop] of [
    [{closed67:'+000000090700,+000000000000,0008,0012'},'DAILY_AMOUNT_DELTA'],
    [{closed67:'+000000092800,+000000000001,0008,0012'},'DAILY_AMOUNT_DELTA'],
    [{closed67:'+000000092800,+000000000000,0010,0012'},'DAILY_COUNT_DELTA'],
    [{closed67:'+000000092800,+000000000000,0008,0001'},'DAILY_COUNT_DELTA'],
    [{closed56:'0000,0021'},'CLOSE_COUNTERS']
  ]) {
    const f=setup(change),before=await preflight(f.send,f.snapshot);
    await assert.rejects(complete(f.send,f.snapshot,before),new RegExp('HOLD_'+stop));
  }
});
