const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {openDatabase}=require('../src/desktop/database');
const {registerBillHistory,CHANNEL,spreadsheet}=require('../src/desktop/bill-history');
test('bill history is scoped, paginated, date bounded and never mutates payments',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-history-')), db=openDatabase(dir);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  for(const [id,scope] of [[1,'A'],[2,'B'],[3,'combined'],[4,'waiter']]) {
    db.prepare('INSERT INTO local_users(id,username,salt,password_hash) VALUES(?,?,?,?)').run(id,'sample-'+id,Buffer.from([1]),Buffer.from([1]));
    db.prepare("INSERT INTO user_permissions VALUES (?, 'employees.view')").run(id); db.prepare('INSERT INTO financial_scopes VALUES (?,?)').run(id,scope);
  }
  db.exec("INSERT INTO dining_tables(id,area) VALUES(1,'sample');");
  const insertOrder=db.prepare("INSERT INTO orders(id,table_id,opened_at,status) VALUES(?,1,1,'open')"), insertBill=db.prepare("INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(?,?,1,1,100,'sample')"), insertPayment=db.prepare("INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(?,1,?,100,'cash',?)");
  for(let id=1;id<=55;id++){insertOrder.run(id);insertBill.run(id,id);insertPayment.run(id,1000+id,id%2?'A':'B');db.prepare("UPDATE orders SET status='completed' WHERE id=?").run(id);}
  insertOrder.run(56);insertBill.run(56,56);
  db.prepare("INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(2,1,2000,'sample')").run();
  let actor=3, authenticated=3, generation=0, handler, printed, saveResult={canceled:true}, onPrint=async job=>{printed=job;return 'accepted';}, onSave=async()=>saveResult;
  registerBillHistory({handle:(channel,fn)=>{assert.equal(channel,CHANNEL);handler=fn;}}, e=>e.allowed,db,{currentUserId:()=>actor,authenticatedUserId:()=>authenticated,identityGeneration:()=>generation},{print:job=>onPrint(job),saveDialog:()=>onSave()});
  const call=(action,extra={})=>handler({allowed:true},{action,from:1001,to:1056,...(action==='page'?{token:null}:{}),...(['print','export'].includes(action)?{language:'en'}:{}),...extra});
  const page=await call('page',{page:0}); assert.equal(page.data.records.length,50);assert.equal(page.data.hasMore,true);
  const next=await call('page',{page:1,token:page.data.token});assert.equal(next.data.records.length,5);assert.equal(next.data.hasMore,false);
  assert.equal((await call('count')).data.count,55); assert.equal((await call('page',{page:0,from:1002,to:1003})).data.records[0].account,'A');
  actor=authenticated=1;assert.equal((await call('page',{page:1,token:page.data.token})).ok,false);assert.equal((await call('count')).data.count,29);assert.equal((await call('print')).ok,true);assert.equal(printed.snapshot.total,'2900'); actor=authenticated=2;assert.equal((await call('count')).data.count,26);assert.equal((await call('print')).ok,true);assert.equal(printed.snapshot.total,'2600');
  actor=authenticated=3;assert.equal((await call('page',{page:1,token:page.data.token,from:0})).ok,false);assert.equal((await call('print')).accepted,true);assert.equal(printed.snapshot.rows.length,55);assert.equal(printed.snapshot.total,'5500');assert.equal((await call('print',{from:0,to:1})).ok,true);assert.equal(printed.snapshot.total,'0');assert.equal(printed.snapshot.rows.length,0);
  assert.equal((await call('export')).cancelled,true);
  const out=path.join(dir,'history.xls');saveResult={canceled:false,filePath:out};assert.equal((await call('export')).ok,true);const xml=fs.readFileSync(out,'utf8');assert.equal((xml.match(/<Row>/g)||[]).length,57);assert.match(xml,/PROVISIONAL NON-FISCAL/);
  assert.equal((await call('page',{page:-1})).ok,false);assert.equal((await call('count',{to:1001})).ok,false);assert.equal((await handler({allowed:false},{action:'count',from:1,to:2})).ok,false);
  actor=authenticated=4;assert.equal((await call('print')).ok,false);actor=1;authenticated=2;assert.equal((await call('export')).ok,false);
  actor=authenticated=3;
  db.exec("UPDATE orders SET status='completed' WHERE id=56; UPDATE business_days SET closed_at=2000,closed_by=1,issues='{}' WHERE closed_at IS NULL; INSERT INTO business_days(opened_at) VALUES(2000)");
  for(let id=57;id<=262;id++){insertOrder.run(id);insertBill.run(id,id);insertPayment.run(id,1000+id,id%2?'A':'B');db.prepare("UPDATE orders SET status='completed' WHERE id=?").run(id);}
  const days=await call('page',{page:0,from:0,to:5000});assert.equal(days.data.records[0].closedAt,null);assert.equal(days.data.records[0].firstDay,0);
  const batches=[],totals=[];onPrint=async job=>{batches.push(job.snapshot.rows);totals.push(job.snapshot.total);return 'accepted';};assert.equal((await call('print',{from:0,to:5000})).parts,2);assert.equal(batches.flat().length,261);assert.deepEqual(totals,['26100','26100']);assert.equal(new Set(batches.flat().map(r=>r.id)).size,261);
  let invocations=0;onPrint=async()=>{invocations++;actor=authenticated=2;return 'accepted';};assert.equal((await call('print',{from:0,to:5000})).partial,true);assert.equal(invocations,1);
  actor=authenticated=3;invocations=0;onPrint=async()=>{invocations++;generation++;return 'accepted';};assert.equal((await call('print',{from:0,to:5000})).partial,true);assert.equal(invocations,1);
  actor=authenticated=3;onSave=async()=>{actor=authenticated=2;return {canceled:false,filePath:path.join(dir,'denied.xml')};};assert.equal((await call('export')).ok,false);assert.equal(fs.existsSync(path.join(dir,'denied.xml')),false);
  actor=authenticated=1;onSave=async()=>({canceled:false,filePath:path.join(dir,'a.xml')});assert.equal((await call('export',{from:0,to:5000})).ok,true);assert.equal((fs.readFileSync(path.join(dir,'a.xml'),'utf8').match(/<Row>/g)||[]).length,2+132);
  actor=authenticated=2;onSave=async()=>({canceled:false,filePath:path.join(dir,'b.xml')});assert.equal((await call('export',{from:0,to:5000})).ok,true);assert.equal((fs.readFileSync(path.join(dir,'b.xml'),'utf8').match(/<Row>/g)||[]).length,2+129);
  actor=authenticated=3;onPrint=async()=>{throw Error('unknown');};assert.equal((await call('print')).uncertain,true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n,261);assert.equal(db.prepare('SELECT count(*) AS n FROM payment_account_corrections').get().n,1);assert.equal(fs.readdirSync(dir).filter(f=>f.startsWith('.bill-history-')).length,0);
});
test('spreadsheet treats values as text and escapes XML',()=>{assert.match(spreadsheet([{dayId:1,firstDay:1,openedAt:1,closedAt:null,paidAt:1,billId:'=1+1',tableId:'<x>',method:'cash',account:'A',amount:10}]),/ss:Type="String">=1\+1/);assert.match(spreadsheet([{dayId:1,firstDay:1,openedAt:1,closedAt:null,paidAt:1,billId:1,tableId:'<x>',method:'cash',account:'A',amount:10}]),/&lt;x&gt;/);});



test('Albanian output labels are translated',()=>{ const text=spreadsheet([{dayId:1,firstDay:1,openedAt:1,closedAt:null,paidAt:1,billId:1,tableId:2,method:'cash',account:'A',amount:10}],'sq'); assert.match(text,/HISTORIK I PERKOHSHEM/); assert.match(text,/Para ne dore/); assert.match(text,/Llogaria efektive/); });
test('real session reauthentication cancels an in-flight export',async t=>{
  const {bootstrap,createSession}=require('../src/desktop/session'), crypto=require('node:crypto');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-identity-')),db=openDatabase(dir); t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  const password=crypto.randomBytes(20).toString('hex'); bootstrap(db,'sample',password); const session=createSession(db); assert.equal(session.signIn({username:'sample',password}).ok,true);
  let handler, release; const waiting=new Promise(resolve=>{release=resolve;});
  registerBillHistory({handle:(_,fn)=>handler=fn},()=>true,db,session,{saveDialog:()=>waiting});
  const target=path.join(dir,'export.xml'), pending=handler({}, {action:'export',from:0,to:100,language:'en'});
  assert.equal(session.signIn({username:'sample',password}).ok,true); release({canceled:false,filePath:target});
  assert.equal((await pending).ok,false); assert.equal(fs.existsSync(target),false);
});
test('a pending report snapshot permits a concurrent local write', async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-concurrent-')),db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01'); INSERT INTO financial_scopes VALUES(1,'combined'); INSERT INTO user_permissions VALUES(1,'employees.view');");
  let handler; const identity={currentUserId:()=>1,authenticatedUserId:()=>1,identityGeneration:()=>1}; registerBillHistory({handle:(_,fn)=>handler=fn},()=>true,db,identity);
  const pending=handler({}, {action:'page',from:0,to:100,page:0,token:null}); await new Promise(resolve=>setImmediate(resolve));
  db.prepare("INSERT INTO dining_tables(id,area) VALUES(1,'sample')").run();
  assert.equal((await pending).ok,true); assert.equal(db.prepare('SELECT count(*) AS n FROM dining_tables').get().n,1);
});
test('screen identifies amounts as minor units in both languages',()=>{
  const vm=require('node:vm'), {moduleSource}=require('./support/renderer-bundle');
  class Component {constructor(props){this.props=props;} setState(next){Object.assign(this.state,next);}}
  const context={React:{Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})}};
  vm.runInNewContext(moduleSource(require.resolve('../src/admin/BillHistory.js'),'BillHistoryModule'),context);
  for(const [language,label] of [['en','Amount (minor units)'],['sq','Shuma (njesi me te vogla)']]) {
    const screen=new context.BillHistoryModule.BillHistory({language});screen.setState({range:{from:1,to:2},count:{count:1,printBatch:200},records:[{id:1,dayId:1,openedAt:1,closedAt:null,paidAt:1,billId:1,tableId:1,method:'cash',account:'A',amount:123}]});
    assert.match(JSON.stringify(screen.render()),new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
});
test('snapshot cancels when a correction and day close occur before disclosure',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-point-in-time-')),db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01'); INSERT INTO financial_scopes VALUES(1,'B'); INSERT INTO user_permissions VALUES(1,'employees.view'); INSERT INTO dining_tables(id,area) VALUES(1,'sample'); INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'); INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,100,'sample'); INSERT INTO payments(id,bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,10,100,'cash','B');");
  let handler,printed;const identity={currentUserId:()=>1,authenticatedUserId:()=>1,identityGeneration:()=>1};registerBillHistory({handle:(_,fn)=>handler=fn},()=>true,db,identity,{print:async job=>{printed=job;return 'accepted';}});
  const pending=handler({}, {action:'print',from:0,to:100,language:'en'});
  db.exec("INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(1,1,20,'sample'); UPDATE business_days SET closed_at=30,closed_by=1,issues='{}' WHERE closed_at IS NULL; INSERT INTO business_days(opened_at) VALUES(30);");
  assert.equal((await pending).ok,false);assert.equal(printed,undefined);
  assert.equal((await handler({}, {action:'count',from:0,to:100})).data.count,0);
});
test('a short range works when the database exceeds 128 MiB',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-large-db-')),db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01'); INSERT INTO financial_scopes VALUES(1,'combined'); INSERT INTO user_permissions VALUES(1,'employees.view'); CREATE TABLE sample_padding(data BLOB); INSERT INTO sample_padding VALUES(zeroblob(135266304));");
  assert.ok(fs.statSync(path.join(dir,'arra.sqlite')).size>128*1024*1024);
  let handler;registerBillHistory({handle:(_,fn)=>handler=fn},()=>true,db,{currentUserId:()=>1,authenticatedUserId:()=>1,identityGeneration:()=>1});
  const result=await handler({}, {action:'page',from:1,to:2,page:0,token:null});assert.equal(result.ok,true);assert.equal(result.data.count,0);
});

test('a correction invalidates an old page token and stops remaining print parts',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-cutoff-')),db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01'); INSERT INTO financial_scopes VALUES(1,'B'); INSERT INTO user_permissions VALUES(1,'employees.view'); INSERT INTO dining_tables(id,area) VALUES(1,'sample');");
 const order=db.prepare("INSERT INTO orders(id,table_id,opened_at,status) VALUES(?,1,1,'open')"),bill=db.prepare("INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(?,?,1,1,100,'sample')"),pay=db.prepare("INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(?,1,1,100,'cash','B')"),done=db.prepare("UPDATE orders SET status='completed' WHERE id=?");
 db.exec('BEGIN');for(let id=1;id<=201;id++){order.run(id);bill.run(id,id);pay.run(id);done.run(id);}db.exec('COMMIT');
 let handler,prints=0; const session={currentUserId:()=>1,authenticatedUserId:()=>1,identityGeneration:()=>1};
 registerBillHistory({handle:(_,fn)=>handler=fn},()=>true,db,session,{print:async()=>{prints++;db.prepare("INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(2,1,2,'sample')").run();return 'accepted';}});
 const page=await handler({}, {action:'page',from:0,to:10,page:0,token:null});assert.equal(page.ok,true);
 db.prepare("INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(1,1,2,'sample')").run();
 assert.equal((await handler({}, {action:'page',from:0,to:10,page:1,token:page.data.token})).ok,false);
 const printed=await handler({}, {action:'print',from:0,to:10,language:'en'});assert.equal(printed.ok,false);assert.equal(printed.partial,true);assert.equal(prints,1);
});
test('correction during delayed reader close prevents page disclosure',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-reader-close-')),db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01'); INSERT INTO financial_scopes VALUES(1,'B'); INSERT INTO user_permissions VALUES(1,'employees.view'); INSERT INTO dining_tables(id,area) VALUES(1,'sample'); INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'); INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,100,'sample'); INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,100,'cash','B');");
 let handler, signal, release;const closing=new Promise(resolve=>signal=resolve),gate=new Promise(resolve=>release=resolve);
 registerBillHistory({handle:(_,fn)=>handler=fn},()=>true,db,{currentUserId:()=>1,authenticatedUserId:()=>1,identityGeneration:()=>1},{createReader:()=>({query:async()=>({rows:[{id:1,account:'B'}],cursor:0}),close:async()=>{signal();await gate;}})});
 const pending=handler({}, {action:'page',from:0,to:10,page:0,token:null});await closing;
 db.prepare("INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(1,1,2,'sample')").run();release();assert.equal((await pending).ok,false);
});
test('print total remains exact above the safe integer range',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-total-')),db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01'); INSERT INTO financial_scopes VALUES(1,'combined'); INSERT INTO user_permissions VALUES(1,'employees.view'); INSERT INTO dining_tables(id,area) VALUES(1,'sample'); INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'); INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,9007199254740991,'sample'); INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,9007199254740991,'cash','A'); UPDATE orders SET status='completed' WHERE id=1; INSERT INTO orders(id,table_id,opened_at,status) VALUES(2,1,1,'open'); INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(2,2,1,1,10,'sample'); INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(2,1,1,10,'cash','A');");
 let handler,printed;registerBillHistory({handle:(_,fn)=>handler=fn},()=>true,db,{currentUserId:()=>1,authenticatedUserId:()=>1,identityGeneration:()=>1},{print:async job=>{printed=job;return 'accepted';}});
 assert.equal((await handler({}, {action:'print',from:0,to:10,language:'en'})).ok,true);assert.equal(printed.snapshot.total,'9007199254741001');
});
