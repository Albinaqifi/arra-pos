const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { createSampleAccounts } = require('../src/desktop/sample-accounts');
const { createSession } = require('../src/desktop/session');
const { registerFinancialVisibility } = require('../src/desktop/financial-visibility');
const { registerOperationalReports } = require('../src/desktop/operational-reports');
const { registerBusinessDays } = require('../src/desktop/business-days');
const { registerMenuConfig } = require('../src/desktop/menu-config');
const { registerEmployeeConfig } = require('../src/desktop/employee-config');
const { registerTestPrinting } = require('../src/desktop/test-printing');

test('owner policy holds across administration, reports, printing and restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-policy-'));
  let db = openDatabase(dir), session, handlers, output = [];
  t.after(() => { db.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  const passwords = ['sample 1','sample 2','sample 3','sample 4'];
  createSampleAccounts(db, passwords);
  db.exec(`INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample'),(3,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'),(3,3,1,'open');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,100,'a'),(2,2,1,1,200,'b'),(3,3,1,1,300,'c');`);
  function register() {
    session = createSession(db); handlers = {};
    const ipc = { handle:(name, fn) => { handlers[name] = fn; } };
    for (const fn of [registerFinancialVisibility,registerOperationalReports,registerMenuConfig,registerEmployeeConfig]) fn(ipc,()=>true,db,session);
    registerBusinessDays(ipc,()=>true,db,session, job => { output.push(job); return 'accepted'; });
    registerTestPrinting(ipc,()=>true,db,session, job => { output.push(job); return 'accepted'; },true);
  }
  function login(id) {
    session.signOut();
    assert.equal(session.signIn({username:['sample-waiter','sample-owner-a','sample-owner-b','sample-combined'][id-1],password:passwords[id-1]}).ok,true);
    assert.equal(session.selectWaiter({id,pin:''}).ok,true);
  }
  const call = (channel, req) => handlers['arra:'+channel]({}, req);
  const fin = req => call('financial-visibility', req);
  const day = () => db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id;
  register();
  for (const id of [2,3,4]) {
    login(id);
    assert.deepEqual(fin({action:'unpaid'}).data.map(b=>b.id),[3,2,1]);
    assert.equal(call('menu-config',{action:'category',id:null,name:'Sample '+id,active:true,parentId:null,sortOrder:id}).ok,true);
    assert.equal(call('employee-config',{action:'financialAccess',id,scope:'combined',close:true}).ok,false);
  }
  assert.equal(db.prepare("SELECT count(*) n FROM application_audit WHERE entity_type='category' AND action='create'").get().n,3);
  db.exec(`INSERT INTO payments(id,bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,10,100,'card','A'),(2,2,1,20,200,'cash','B'),(3,3,1,30,300,'cash','B');
    INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(2,4,40,'sample correction');`);
  const currentDay = day(), report = {action:'report',from:null,to:null,dayId:currentDay,account:null,method:null};
  for (const [id, expected, total] of [[2,[1,2],300],[3,[3],300],[4,[1,2,3],600]]) {
    login(id);
    assert.deepEqual(fin({action:'unpaid'}).data,[]);
    assert.deepEqual(fin({action:'search',account:null}).data.map(p=>p.id).sort(),expected);
    assert.equal(fin({action:'aggregate',account:null}).data.total,total);
    assert.deepEqual(fin(report).data.records.map(p=>p.id),expected);
    assert.equal(fin(report).data.corrections === null,id !== 4);
    assert.deepEqual(call('operational-reports',{from:0,to:100,account:null}).data.tables.map(x=>x.tableId),expected);
    if (id !== 4) {
      const other = id === 2 ? 'B' : 'A';
      assert.deepEqual(fin({...report,account:other}),{ok:false});
      assert.deepEqual(call('operational-reports',{from:0,to:100,account:other}),{ok:false});
      assert.deepEqual(fin({action:'detail',paymentId:id === 2 ? 3 : 2}),{ok:false});
    }
  }
  login(2);
  assert.equal(Object.hasOwn(fin({action:'detail',paymentId:2}).data.payment,'originalAccount'),false);
  assert.equal(call('test-printing',{action:'bill',billId:2,requestId:'bill'}).ok,true);
  assert.equal(call('business-days',{action:'close',dayId:currentDay}).ok,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(output.find(x=>x.destination==='turnover').snapshot.records.map(x=>x.paymentId),[1,2]);
  session.signOut(); db.close(); db = openDatabase(dir); register();
  login(3);
  assert.deepEqual(fin(report).data.records.map(p=>p.id),[3]);
  assert.equal(call('test-printing',{action:'list'}).data.jobs.length,0);
  assert.equal(call('test-printing',{action:'retry',jobId:1,requestId:'denied',checked:true}).ok,false);
  assert.equal(call('business-days',{action:'retry',dayId:currentDay,requestId:'denied',checked:true,scope:'A'}).ok,false);
  assert.equal(call('business-days',{action:'retry',dayId:currentDay,requestId:'b',checked:true}).ok,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(output.at(-1).snapshot.records.map(x=>x.paymentId),[3]);
  login(4);
  assert.equal(fin({action:'detail',paymentId:2}).data.payment.originalAccount,'B');
  assert.equal(fin({action:'detail',paymentId:2}).data.corrections.length,1);
  assert.equal(call('business-days',{action:'retry',dayId:currentDay,requestId:'full',checked:true}).ok,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(output.at(-1).snapshot.records.map(x=>x.paymentId),[1,2,3]);
  assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,3);
});

