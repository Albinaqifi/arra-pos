const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {authorizedDatabase}=require('./support/authorized-database');
const {runRecovery}=require('../scripts/bill6-card-recovery/recover.cjs');
const {simulatedResponse,onsiteReceiptItems}=require('../src/desktop/pf700-checkout-protocol');
const {awaitingReceipt,installFastReportGuard}=require('../src/desktop/fast-pay-report-guard');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'arra-inc-test-'));
const oldLocal=process.env.LOCALAPPDATA;
const desktop=process.env.ARRA_INCIDENT_TEST_DESKTOP || path.join(__dirname,'../src/desktop');
const load=name=>require(path.join(desktop,name));
const deviceId='SYNTHETIC01';
const base=path.join(work,'seed.sqlite');
let binding,receipt,sourceLedger,numbered;
before(async ()=>{
  process.env.LOCALAPPDATA=work;
  const db=authorizedDatabase(load('database').openDatabase(fs.mkdtempSync(path.join(work,'base-'))));
  let worker;
  try {
    load('pf700-commissioning').enroll(db);
    load('tables').seedTables(db);load('arra-menu').seedArraMenu(db);
    db.exec("INSERT OR IGNORE INTO menu_product_fiscal_origin VALUES('arra-product-11-0',1),('arra-product-12-0',0)");
    const handlers={}, ipc={handle:(k,v)=>{handlers[k]=v;}},session={authenticatedUserId:()=>1,currentUserId:()=>1,identityGeneration:()=>1};
    const adapter={mode:'device',deviceId,domesticProduct:false,requireOrigins:true,fastPayVersion:1,canRegister:()=>true,
      async registerSale(s,ctx) {
        ctx.beforeOpen({previousDocumentNumber:s.billId===1?'0000013':'0000014'});
        return s.billId===1?{status:'accepted',reference:'0000014',evidence:{documentNumber:'0000014',fiscalReceiptCount:2,reversalCount:1}}:
          {status:'uncertain'};
      }};
    worker=load('fast-pay-service').registerFastPayments(ipc,()=>true,db,session,null,adapter);
    load('bills').registerBills(ipc,()=>true,db,session,adapter);
    load('order-items').registerOrderItems(ipc,()=>true,db,session);
    const call=(k,r)=>{const result=handlers['arra:'+k]({},r);assert.ok(result.ok,JSON.stringify(result));return result.data;};
    for (const i of [1,2]) {
      db.prepare("INSERT INTO orders(id,table_id,opened_at,status) VALUES(?,?,?,'open')").run(i,i,i);
      db.prepare("INSERT INTO order_waiter_ownership VALUES(?,1,1,1,'open')").run(i);
      for (const productId of ['arra-product-11-0','arra-product-12-0']) call('order-items',{action:'add',orderId:i,productId});
      call('order-items',{action:'send',orderId:i,requestId:'synthetic-order-'+i});
      const b=call('bill',{action:'review',orderId:i});
      call('bill',{action:'generate',orderId:i,fingerprint:b.fingerprint});
      call('payment',{billId:i,account:'A',method:i===1?'cash':'card',fastPay:true});
      for (let j=0;j<400&&!db.prepare('SELECT status FROM fast_pay_v1_results WHERE payment_id=?').get(i);j++) await delay(10);
      assert.equal(db.prepare('SELECT status FROM fast_pay_v1_results WHERE payment_id=?').get(i)?.status,i===1?'acknowledged':'unconfirmed');
    }
    installFastReportGuard(db);
    receipt=JSON.parse(db.prepare('SELECT receipt FROM fast_pay_v1_jobs WHERE payment_id=2').get().receipt);
    binding={billId:2,previousBillId:1,headerNumber:'0003',previousDocument:'0000014',total:receipt.total,
      lines:receipt.lines.map(({name,quantity,unitPrice})=>({name,quantity,unitPrice})),itemHex:onsiteReceiptItems(receipt).map(b=>b.toString('hex'))};
    db.prepare('VACUUM INTO ?').run(base);
    sourceLedger=path.join(work,'Arra POS','PF700 commissioning','fast-pay-v1');
  } finally {worker?.stop();db.close();}
});
after(()=>{
  if (oldLocal===undefined) delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=oldLocal;
  if (path.dirname(work)===os.tmpdir() && path.basename(work).startsWith('arra-inc-test-')) fs.rmSync(work,{recursive:true,force:true});
});
function fixture(t,opts={}) {
  const sample=opts.numbered?numbered:{base,sourceLedger,binding,receipt};
  const target=sample.binding, savedReceipt=sample.receipt;
  const dir=fs.mkdtempSync(path.join(work,'case-')),ledgerDir=path.join(dir,'ledger'),dbFile=path.join(dir,'case.sqlite');
  fs.copyFileSync(sample.base,dbFile);fs.cpSync(sample.sourceLedger,ledgerDir,{recursive:true});
  fs.writeFileSync(path.join(dir,createHash('sha256').update(deviceId).digest('hex')+'.used'),'');
  const db=new DatabaseSync(dbFile);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY');t.after(()=>db.close());
  const commands=[], sums=[0,0,0,0],reg=[8,9,10,11];let open=true,items=0,tender=0,preflights=0;
  const fmt=v=>'+'+String(v*100).padStart(9,'0');
  const exchange=async frame=>{
    const command=frame[3], payload=frame.subarray(4,-6);
    commands.push(command);
    let answer;
    switch(command) {
      case 90:answer='QA-700DEMOX,1.00MK 23OCT14 1230,BEEF,01001101,7,'+(opts.otherDevice?'SYNTHETIC02':deviceId);break;
      case 76:answer=[open?1:0,String(items).padStart(4,'0'),fmt(sums.reduce((n,x)=>n+x)),fmt(tender)].join(',');break;
      case 97:answer='018.00,005.00,010.00,000.00';break;
      case 103:answer=[1,...sums.map(fmt)].join(',');break;
      case 113:answer=open?target.previousDocument:String(Number(target.previousDocument)+1).padStart(7,'0');break;
      case 67:{
        const daily=n=>'+'+String(n*100).padStart(11,'0');
        answer=[daily(310+(open?0:target.total)),daily(0),open?'0019':'0020','0007'].join(',');break;
      }
      case 110:
        if(opts.refuseOpenRegisters && open) throw Error('Synthetic printer refused an open-receipt register reading');
        if(open) preflights++;
        answer=[...reg.map(fmt),'0010',open?(opts.changed && preflights===2?'0201':'0200'):(opts.assignedOnOpen?'0200':'0201')].join(',');break;
      case 49:
        assert.equal(open,true);assert.equal(payload.toString('hex'),target.itemHex[items]);
        {const l=savedReceipt.lines[items];sums[l.taxGroup==='А'?0:2]+=l.quantity*l.unitPrice;}
        items++;answer='';break;
      case 53:assert.equal(payload.toString(),'\tD'+target.total);tender=target.total;reg[opts.wrongRegister?0:2]+=tender;answer='R+000000000';break;
      case 56:assert.equal(tender,target.total);open=false;answer=opts.numbered?'0025,0009':'0003,0001';break;
      default:assert.fail('Unexpected device command '+command);
    }
    if (opts.lose===command) throw Error('simulated lost reply');
    const result=simulatedResponse(frame[2],command,opts.answer ? opts.answer(command,answer,open) : answer,open);
    if(opts.capture) opts.capture.push({command,payload:payload.toString('hex'),reply:result.toString('hex')});
    return result;
  };
  const run=(changes={})=>runRecovery({db,ledgerDir,binding:target,actorId:1,reauthorize:()=>true,reviewOnly:false,confirm:()=>true,exchange,...changes});
  const status=()=>db.prepare('SELECT * FROM fast_pay_v1_status WHERE bill_id=?').get(target.billId).receipt_status;
  return {db,run,status,commands,ledgerDir,dbFile};
}
test('completes existing receipt and supplements only its original payment with proven fiscal close',async t=>{
  const f=fixture(t);
  assert.equal(awaitingReceipt(f.db,{deviceId,mode:'device'}),true);
  assert.deepEqual(await f.run(),{status:'confirmed',documentNumber:'0000015'});
  assert.equal(f.status(),'acknowledged');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payments').get().n,2);
  assert.equal(f.db.prepare('SELECT status FROM fast_pay_v1_results WHERE payment_id=2').get().status,'unconfirmed');
  assert.equal(awaitingReceipt(f.db,{deviceId,mode:'device'}),false);
  assert.deepEqual(f.commands.filter(c=>[48,49,53,56].includes(c)),[49,49,53,56]);
  assert.equal((await f.run({exchange:()=>assert.fail('Already complete')})).status,'already-confirmed');
  assert.throws(()=>f.db.exec('DELETE FROM card_receipt_incident_proof'),/immutable/);
});
test('review, cancelled confirmation and changed input stop before any sale write',async t=>{
  const f=fixture(t);
  assert.equal((await f.run({reviewOnly:true})).status,'reviewed');
  assert.equal((await f.run({confirm:()=>false})).status,'cancelled');
  await assert.rejects(f.run({binding:{...binding,itemHex:[...binding.itemHex].reverse()}}),/HOLD_BILL_LINES/);
  assert.deepEqual(f.commands.filter(c=>[48,49,53,56].includes(c)),[]);
  assert.equal(f.status(),'unconfirmed');
});
test('new register state or privilege loss at dispatch stops before the first fiscal write',async t=>{
  const f=fixture(t,{changed:true});
  await assert.rejects(f.run(),/HOLD_PREFLIGHT_CHANGED/);
  let count=0;
  await assert.rejects(f.run({reauthorize:()=>++count<3}),/HOLD_OPERATOR/);
  assert.deepEqual(f.commands.filter(c=>[48,49,53,56].includes(c)),[]);
});
for (const lost of [49,53,56]) test('lost '+lost+' reply holds across another invocation',async t=>{
  const f=fixture(t,{lose:lost});
  await assert.rejects(f.run(),/HOLD_CLAIMED/);
  const sent=f.commands.length;
  await assert.rejects(f.run(),/HOLD_CLAIMED_NO_COMPLETE_PROOF/);
  assert.equal(f.commands.length,sent);assert.equal(f.status(),'unconfirmed');
});
test('local publication failure recovers from complete checked external proof with zero device commands',async t=>{
  const f=fixture(t);
  f.db.exec("CREATE TRIGGER simulated_fault BEFORE INSERT ON fiscal_checkout_sales WHEN NEW.bill_id=2 BEGIN SELECT RAISE(ABORT,'Synthetic fault'); END");
  await assert.rejects(f.run(),/HOLD_CLAIMED/);assert.equal(f.status(),'unconfirmed');
  f.db.exec('DROP TRIGGER simulated_fault');
  assert.equal((await f.run({exchange:()=>assert.fail('No device replay')})).status,'confirmed');
  assert.equal(f.status(),'acknowledged');
});
test('missing enrollment or unmatched external Fast Pay claim prevents any device operation',async t=>{
  const f=fixture(t);
  const extra=path.join(f.ledgerDir,'f'.repeat(64)+'.order');
  fs.writeFileSync(extra,'');
  await assert.rejects(f.run(),/HOLD_RESTORED_OR_UNKNOWN_CLAIM/);
  fs.unlinkSync(extra);
  fs.unlinkSync(path.join(path.dirname(f.ledgerDir),createHash('sha256').update(deviceId).digest('hex')+'.used'));
  await assert.rejects(f.run(),/HOLD_ORIGINAL_CLAIM/);
  assert.deepEqual(f.commands,[]);
});
test('older unresolved native attempt is retained and keeps Z guarded after external proof publication',async t=>{
  const f=fixture(t);
  // A distinct previously reserved bill has no response. Use the original schema
  // with foreign keys, so all statements still pass the installed fiscal triggers.
  f.db.prepare("INSERT INTO orders(id,table_id,opened_at,status) VALUES(10,3,3,'open')").run();
  f.db.prepare("INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(10,10,1,3,10,'fixture')").run();
  f.db.prepare("INSERT INTO fiscal_checkout_sales VALUES(10,1,'device',?,'cash',?,4)").run(deviceId,JSON.stringify({...receipt,billId:10,method:'cash'}));
  f.db.prepare('INSERT INTO fiscal_checkout_attempts(bill_id,started_at) VALUES(10,5)').run();
  assert.equal((await f.run()).status,'confirmed');
  assert.equal(f.status(),'acknowledged');
  assert.equal(f.db.prepare('SELECT native_published FROM card_receipt_incident_proof').get().native_published,0);
  assert.equal(awaitingReceipt(f.db,{deviceId,mode:'device'}),true);
  assert.equal((await f.run({exchange:()=>assert.fail('already issued')})).status,'already-confirmed');
  const missing=f.db.prepare('SELECT id FROM fiscal_checkout_attempts WHERE bill_id=10').get();
  f.db.prepare(`INSERT INTO fiscal_checkout_results(attempt_id,status,source,reference,evidence,ended_at)
    VALUES(?,'failed',?,NULL,NULL,100)`).run(missing.id,'device-'+deviceId);
  assert.equal((await f.run({reviewOnly:true,exchange:()=>assert.fail('No hardware in review')})).status,'already-confirmed');
  assert.equal(awaitingReceipt(f.db,{deviceId,mode:'device'}),true);
  assert.equal((await f.run({exchange:()=>assert.fail('No hardware in promotion')})).status,'already-confirmed');
  assert.equal((await f.run({exchange:()=>assert.fail('No hardware after promotion')})).status,'already-confirmed');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM card_receipt_incident_promotion').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payments').get().n,2);
  assert.equal(awaitingReceipt(f.db,{deviceId,mode:'device'}),false);
});
test('already published receipt remains visible after closing the shared business day',async t=>{
  const f=fixture(t);
  await f.run();
  f.db.exec("UPDATE business_days SET closed_at=paid_at,closed_by=1,issues='[]' FROM payments WHERE business_days.closed_at IS NULL AND payments.id=2");
  assert.equal((await f.run({exchange:()=>assert.fail('already issued')})).status,'already-confirmed');
});
test('durable receipt proof, original claim and recorded exchanges reject replace and later append',async t=>{
  const f=fixture(t);
  await f.run();
  const name=fs.readdirSync(f.ledgerDir).find(x=>x.endsWith('.recovery.sqlite'));
  const side=new DatabaseSync(path.join(f.ledgerDir,name));
  try {
    for (const table of ['claim','proof','events']) {
      assert.throws(()=>side.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table} LIMIT 1`),/immutable|sealed/);
    }
    assert.throws(()=>side.exec("INSERT INTO events(stage,entry) VALUES('extra','{}')"),/sealed/);
  } finally {side.close();}
  assert.equal((await f.run({exchange:()=>assert.fail('already issued')})).status,'already-confirmed');
});

test('a nonempty receipt, wrong printer, or a different predecessor prevents every fiscal write',async t=>{
  for (const [command,changed,reason] of [
    [76,'1,0001,+000000000,+000000000','ITEMS_OR_TENDER'],
    [76,'1,0000,+000000000,+000000100','ITEMS_OR_TENDER'],
    [90,'QA-700DEMOX,1.00MK 23OCT14 1230,BEEF,01001101,7,SYNTHETIC02','DEVICE_IDENTITY'],
    [113,'0000013','PRIOR_DOCUMENT']
  ]) {
    const f=fixture(t,{answer:(cmd,answer)=>cmd===command?changed:answer});
    await assert.rejects(f.run(),new RegExp('HOLD_'+reason));
    assert.deepEqual(f.commands.filter(c=>[48,49,53,56].includes(c)),[]);
    assert.equal(f.status(),'unconfirmed');
  }
});

test('wrong closed document, receipt or reversal counter, or tender delta cannot confirm a paid card',async t=>{
  for (const [command,mutate,reason] of [
    [113,()=>'0000016','CLOSED_DOCUMENT'],
    [56,()=>'0004,0001','CLOSE_COUNTERS'],
    [56,()=>'0003,0002','CLOSE_COUNTERS'],
    [110,value=>value.replace(/^\+\d{9}/,'+000000900'),'DEBIT_REGISTERS'],
    [110,value=>value.replace(/,0010,0201$/,',0011,0201'),'DEBIT_REGISTERS'],
    [110,value=>value.replace(/0201$/,'0202'),'DEBIT_REGISTERS']
  ]) {
    const f=fixture(t,{answer:(cmd,answer,open)=>!open && cmd===command?mutate(answer):answer});
    await assert.rejects(f.run(),new RegExp('HOLD_'+reason));
    const issued=f.commands.length;
    await assert.rejects(f.run(),/HOLD_CLAIMED_NO_COMPLETE_PROOF/);
    assert.equal(f.commands.length,issued);
    assert.equal(f.status(),'unconfirmed');
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM payments WHERE method='card'").get().n,1);
  }
});

async function numberedSample() {
  if(!numbered) numbered=await require('./support/card-recovery-numbered.cjs').seedNumbered({work,load,deviceId});
  return numbered;
}
test('a settled numbered-journal cash sale binds an original paid card without inventing historical counters',async t=>{
  const sample=await numberedSample();
  const f=fixture(t,{numbered:true});
  const before=f.db.prepare('SELECT * FROM pf700_bill3_numbered_journal').get();
  assert.equal(JSON.parse(before.evidence).fiscalReceiptCount,undefined);
  await assert.rejects(f.run({binding:{...sample.binding,priorJournalHash:'0'.repeat(64)}}),/HOLD_JOURNAL_EVIDENCE/);
  assert.deepEqual(f.commands,[]);
  assert.deepEqual(await f.run(),{status:'confirmed',documentNumber:'0000032'});
  assert.equal(f.commands.filter(c=>c===67).length,3);
  assert.deepEqual(f.db.prepare('SELECT * FROM pf700_bill3_numbered_journal').get(),before);
  const proof=JSON.parse(f.db.prepare('SELECT close_evidence FROM card_receipt_incident_proof').get().close_evidence);
  assert.equal(proof.fiscalReceiptCount,25);assert.equal(proof.reversalCount,9);
});
test('numbered-journal attribution requires the original sealed schema and unique recovery audit',async t=>{
  await numberedSample();
  const f=fixture(t,{numbered:true});
  f.db.exec('BEGIN');
  f.db.exec('DROP TRIGGER pf700_bill3_journal_no_UPDATE');
  f.db.exec('COMMIT');
  await assert.rejects(f.run(),/HOLD_JOURNAL_SEAL_SCHEMA/);
  assert.deepEqual(f.commands,[]);
  const g=fixture(t,{numbered:true});
  load('audit').recordAudit(g.db,1,'recover','fiscal_checkout',3,3,{});
  await assert.rejects(g.run(),/HOLD_JOURNAL_LINKS/);
  assert.deepEqual(g.commands,[]);
});
test('unreadable daily registers block the first item and inconsistent after-close deltas prevent publication',async t=>{
  await numberedSample();
  const f=fixture(t,{numbered:true,answer:(cmd,reply)=>cmd===67?'bad':reply});
  await assert.rejects(f.run(),/HOLD_DAILY_OPEN_LAYOUT/);
  assert.deepEqual(f.commands.filter(c=>[48,49,53,56].includes(c)),[]);
  for (const [field,value,reason] of [[0,'+00000000001','AMOUNT'],[1,'+00000000001','AMOUNT'],
    [2,'0022','COUNT'],[3,'0009','COUNT']]) {
    const g=fixture(t,{numbered:true,answer:(cmd,reply,open)=>
      cmd===67 && !open ? reply.split(',').with(field,value).join(',') : reply});
    await assert.rejects(g.run(),new RegExp('HOLD_DAILY_'+reason+'_DELTA'));
    assert.equal(g.status(),'unconfirmed');
    await assert.rejects(g.run({exchange:()=>assert.fail('No repeat after close')}),/HOLD_CLAIMED_NO_COMPLETE_PROOF/);
  }
});
test('Windows recovery launcher authenticates the owner and uses the bounded serial transport on a memory port',
  {skip:process.platform!=='win32'},async t=>{
    const sample=await numberedSample();
    const capture=[], reference=fixture(t,{capture,numbered:true});
    assert.equal((await reference.run()).status,'confirmed');
    const {exerciseLauncher}=require('./support/card-recovery-launcher.cjs');
    exerciseLauncher({work,...sample,deviceId,capture,desktop});
  });
test('wrong physical identity or unavailable register inquiry holds the empty receipt before any write',async t=>{
  for (const options of [{otherDevice:true},{refuseOpenRegisters:true}]) {
    const f=fixture(t,options);
    await assert.rejects(f.run(),/HOLD_/);
    assert.deepEqual(f.commands.filter(c=>[48,49,53,56].includes(c)),[]);
    assert.equal(f.status(),'unconfirmed');
  }
});
test('fiscal debit proof requires the debit register to move and allows a number assigned on opening',async t=>{
  const same=fixture(t,{assignedOnOpen:true});
  assert.equal((await same.run()).status,'confirmed');
  const wrong=fixture(t,{wrongRegister:true});
  await assert.rejects(wrong.run(),/HOLD_DEBIT_REGISTERS/);
  assert.equal(wrong.status(),'unconfirmed');
  await assert.rejects(wrong.run({exchange:()=>assert.fail('No repeat of closed receipt')}),/HOLD_CLAIMED_NO_COMPLETE_PROOF/);
});
test('restoring a pre-recovery database after a lost tender reply does not send another receipt',async t=>{
  const f=fixture(t,{lose:53});
  const backup=path.join(path.dirname(f.dbFile),'earlier.sqlite');
  f.db.prepare('VACUUM INTO ?').run(backup);
  await assert.rejects(f.run(),/HOLD_CLAIMED/);
  const restored=new DatabaseSync(backup);
  try {
    await assert.rejects(f.run({db:restored,exchange:()=>assert.fail('Restored DB attempted an exchange')}),/HOLD_CLAIMED_NO_COMPLETE_PROOF/);
  } finally {restored.close();}
});
test('a second main connection cannot reserve another recovery while the first holds the bill',async t=>{
  const f=fixture(t);
  const second=new DatabaseSync(f.dbFile);
  try {
    const result=await f.run({confirm:async ()=>{
      await assert.rejects(f.run({db:second,exchange:()=>assert.fail('Second connection reached device')}),/HOLD_INCONCLUSIVE/);
      return true;
    }});
    assert.equal(result.status,'confirmed');
    assert.deepEqual(f.commands.filter(c=>[48,49,53,56].includes(c)),[49,49,53,56]);
  } finally {second.close();}
});
