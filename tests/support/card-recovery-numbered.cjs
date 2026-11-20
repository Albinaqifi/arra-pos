// A fresh database with the two historical numbered-journal schema extensions.
// All payments, hashes, shifts, claims and timestamps are generated for this run.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const { createHash }=require('node:crypto');
const { setTimeout:delay }=require('node:timers/promises');
const { authorizedDatabase }=require('./authorized-database');
const digest=text=>createHash('sha256').update(text).digest('hex');

function settleHistoricalCash(db,load,id,deviceId,total) {
  const previous=String(27+id).padStart(7,'0'),document=String(28+id).padStart(7,'0');
  const now=Date.now();
  const receipt=JSON.stringify(load('fiscal-checkout').buildReceipt(db,id,'cash',total,{mode:'device',domesticProduct:true,requireOrigins:true}));
  const priorJournalHash=digest('synthetic prior journal '+id);
  const witness=JSON.stringify({kind:'numbered-journal',documentNumber:document,journalHash:priorJournalHash,
    binding:digest('synthetic receipt '+id),captureHash:digest('synthetic capture '+id),responseHash:digest('synthetic reply '+id)});
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO pf700_cash_intents VALUES(?,?,1,?,?,?)').run(id,id,deviceId,receipt,now);
    db.prepare("INSERT INTO fiscal_checkout_sales VALUES(?,1,'device',?,'cash',?,?)").run(id,deviceId,receipt,now);
    db.prepare('INSERT INTO fiscal_checkout_attempts VALUES(?,?,?)').run(id,id,now);
    db.prepare('INSERT INTO fiscal_checkout_baselines VALUES(?,?,?)').run(id,deviceId,previous);
    db.prepare('INSERT INTO pf700_cash_dispatches VALUES(?,?,?)').run(id,id,now);
    const name='pf700_bill'+id+'_numbered_journal';
    const extra=id===3?',\n    day_id INTEGER NOT NULL REFERENCES business_days(id),\n    shift_id INTEGER REFERENCES restaurant_shifts(id)':'';
    db.exec(`CREATE TABLE ${name} (
    attempt_id INTEGER PRIMARY KEY${id===3?' CHECK(attempt_id=3)':''} REFERENCES fiscal_checkout_attempts(id),
    evidence TEXT NOT NULL CHECK(json_valid(evidence))${extra}
  ) STRICT`);
    if(id===3) {
      const day=load('shifts').currentDay(db).id;
      const shift=load('shifts').currentShift(db,day);
      db.prepare('INSERT INTO pf700_bill3_numbered_journal VALUES(?,?,?,?)').run(id,witness,day,shift?.id??null);
    } else db.prepare('INSERT INTO pf700_bill2_numbered_journal VALUES(?,?)').run(id,witness);
    for(const operation of ['INSERT','UPDATE','DELETE']) db.exec(`CREATE TRIGGER pf700_bill${id}_journal_no_${operation} BEFORE ${operation} ON ${name}
      BEGIN SELECT RAISE(ABORT,'Numbered journal witness is immutable'); END`);
    const view=db.prepare("SELECT sql FROM sqlite_schema WHERE name='fiscal_checkout_verified_results'").get().sql;
    db.exec('DROP VIEW fiscal_checkout_verified_results');
    db.exec(view+`
    UNION ALL
    SELECT r.* FROM fiscal_checkout_results r
      JOIN ${name} j ON j.attempt_id=r.attempt_id AND j.evidence=r.evidence
      JOIN fiscal_checkout_attempts a ON a.id=r.attempt_id
      JOIN fiscal_checkout_sales s ON s.bill_id=a.bill_id
      JOIN fiscal_checkout_baselines b ON b.attempt_id=a.id AND b.device_id=s.device_id
      JOIN pf700_cash_dispatches d ON d.attempt_id=a.id
      JOIN pf700_cash_intents i ON i.id=d.intent_id AND i.bill_id=s.bill_id AND i.actor_id=s.actor_id
        AND i.device_id=s.device_id AND i.receipt=s.receipt
      WHERE ${id===3?'a.id=3 AND ':''}a.bill_id=${id} AND s.mode='device' AND s.method='cash' AND r.source='device-' || s.device_id
        AND r.status='accepted' AND r.reference='${document}' AND b.previous_document='${previous}'`);
    db.prepare("INSERT INTO fiscal_checkout_results VALUES(?,'accepted',?,?,?,?)").run(id,'device-'+deviceId,document,witness,now);
    assert.equal(db.prepare('SELECT evidence FROM fiscal_checkout_verified_results WHERE attempt_id=?').get(id).evidence,witness);
    load('audit').recordAudit(db,1,'recover','fiscal_checkout',id,id,{});
    load('payments').recordPayment(db,{billId:id,method:'cash',account:'A'},{total,orderId:id},1,null,{mode:'device'});
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
  return priorJournalHash;
}

async function seedNumbered({work,load,deviceId}) {
  const parent=fs.mkdtempSync(path.join(work,'numbered-')),base=path.join(parent,'seed.sqlite');
  const savedLocal=process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA=parent;
  const db=authorizedDatabase(load('database').openDatabase(path.join(parent,'data')));
  const handlers={},ipc={handle:(key,fn)=>{handlers[key]=fn;}};
  const session={authenticatedUserId:()=>1,currentUserId:()=>1,identityGeneration:()=>1};
  const call=(name,body)=>{const r=handlers['arra:'+name]({},body);assert.equal(r.ok,true,r.error);return r.data;};
  let worker;
  try {
    load('pf700-commissioning').enroll(db);
    load('tables').seedTables(db);load('arra-menu').seedArraMenu(db);
    db.exec("INSERT OR IGNORE INTO menu_product_fiscal_origin VALUES('arra-product-11-0',1),('arra-product-11-1',1),('arra-product-12-0',0)");
    const adapter={mode:'device',deviceId,requireOrigins:true,domesticProduct:false,fastPayVersion:1,canRegister:()=>true,
      registerSale(s,ctx){ctx.beforeOpen({previousDocumentNumber:'0000031'});return {status:'uncertain'};}};
    worker=load('fast-pay-service').registerFastPayments(ipc,()=>true,db,session,null,adapter);
    load('bills').registerBills(ipc,()=>true,db,session,adapter);
    load('order-items').registerOrderItems(ipc,()=>true,db,session);
    let priorJournalHash;
    // Consume bill IDs via real bill generation. IDs 1, 4, and 5 need no payment.
    for (let id=1;id<=6;id++) {
      db.prepare("INSERT INTO orders(id,table_id,opened_at,status) VALUES(?,?,?,'open')").run(id,id,id);
      db.prepare("INSERT INTO order_waiter_ownership VALUES(?,1,1,1,'open')").run(id);
      const products=id===2?['arra-product-11-0','arra-product-11-1']:id===6?['arra-product-11-0','arra-product-12-0']:['arra-product-11-0'];
      for(const productId of products) call('order-items',{action:'add',orderId:id,productId});
      call('order-items',{action:'send',orderId:id,requestId:'synthetic-numbered-'+id});
      const bill=call('bill',{action:'review',orderId:id});
      call('bill',{action:'generate',orderId:id,fingerprint:bill.fingerprint});
      if(id===2 || id===3) priorJournalHash=settleHistoricalCash(db,load,id,deviceId,bill.total);
    }
    call('payment',{billId:6,method:'card',account:'A',fastPay:true});
    for(let i=0;i<400 && !db.prepare("SELECT 1 FROM fast_pay_v1_results WHERE status='unconfirmed'").get();i++) await delay(10);
    assert.equal(db.prepare("SELECT count(*) n FROM fast_pay_v1_results WHERE status='unconfirmed'").get().n,1);
    const receipt=JSON.parse(db.prepare('SELECT receipt FROM fast_pay_v1_jobs').get().receipt);
    const binding={billId:6,previousBillId:3,headerNumber:'0057',previousDocument:'0000031',priorJournalHash,total:receipt.total,
      lines:receipt.lines.map(({name,quantity,unitPrice})=>({name,quantity,unitPrice})),
      itemHex:load('pf700-checkout-protocol').onsiteReceiptItems(receipt).map(b=>b.toString('hex'))};
    load('fast-pay-report-guard').installFastReportGuard(db);
    db.prepare('VACUUM INTO ?').run(base);
    return {base,binding,receipt,sourceLedger:path.join(parent,'Arra POS','PF700 commissioning','fast-pay-v1')};
  } finally {worker?.stop();db.close();process.env.LOCALAPPDATA=savedLocal;}
}
module.exports={seedNumbered};
