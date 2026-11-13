const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openDatabase} = require('../src/desktop/database');
const {createSampleAccounts} = require('../src/desktop/sample-accounts');
const {createSession,hashPassword} = require('../src/desktop/session');
const {registerEmployeeConfig} = require('../src/desktop/employee-config');
const {registerTableConfig} = require('../src/desktop/table-config');
const {registerMenuConfig} = require('../src/desktop/menu-config');
const {hasPermissions} = require('../src/desktop/permissions');
const {randomBytes,randomInt} = require('node:crypto');
function entryFixture(db, waiter=1) {
  const password=randomBytes(24).toString('hex'), pin=String(randomInt(10000)).padStart(4,'0');
  const salt=randomBytes(16), pinSalt=randomBytes(16);
  const id=db.prepare('INSERT INTO local_users(username,salt,password_hash) VALUES(?,?,?)').run('sample restaurant',salt,hashPassword(password,salt)).lastInsertRowid;
  db.prepare("INSERT INTO financial_scopes VALUES(?,'waiter')").run(id);
  db.prepare('INSERT INTO restaurant_accounts VALUES(?)').run(id);
  if(waiter) db.prepare('UPDATE local_users SET pin_salt=?,pin_hash=? WHERE id=?').run(pinSalt,hashPassword(pin,pinSalt),waiter);
  return {password,pin};
}

test('shared configuration and protected account boundaries survive restart', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-shared-admin-')); let db=openDatabase(dir);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  const passwords=['sample waiter','sample owner a','sample owner b','sample combined'];
  createSampleAccounts(db,passwords);
  const entry=entryFixture(db);
  let session=createSession(db), handlers={}; const event={};
  function register(){ handlers={}; const ipc={handle:(name,fn)=>handlers[name]=fn}; for(const f of [registerEmployeeConfig,registerTableConfig,registerMenuConfig]) f(ipc,e=>e===event,db,session); }
  register();
  const invoke=(channel,req)=>handlers[channel](event,req), employee=req=>invoke('arra:employee-config',req);
  function login(id){ session.signOut(); assert.equal(session.signIn({username:id===1?'sample restaurant':['sample-waiter','sample-owner-a','sample-owner-b','sample-combined'][id-1],password:id===1?entry.password:passwords[id-1]}).ok,true); if(id===1) assert.equal(session.selectWaiter({id,pin:entry.pin}).ok,true); }
  for(const id of [2,3,4]){
    login(id);
    assert.equal(invoke('arra:menu-config',{action:'category',id:null,name:'Category '+id,active:true,parentId:null,sortOrder:id}).ok,true);
    assert.equal(invoke('arra:table-config',{action:'area',id:null,name:'Area '+id,active:true}).ok,true);
    assert.equal(hasPermissions(db,session,'orders.view'),false);
    assert.equal(hasPermissions(db,session,'tables.view'),false);
    if (id === 4) assert.equal(employee({action:'create',username:'staff '+id,password:'sample staff',pin:entry.pin}).ok,true);
    else {
      assert.equal(employee({action:'create',username:'staff '+id,password:'sample staff',pin:''}).ok,false);
      assert.equal(employee({action:'createPending',username:'staff '+id}).ok,true);
    }
    const staff=db.prepare('SELECT id,active FROM local_users WHERE username=?').get('staff '+id);
    assert.equal(staff.active, id === 4 ? 1 : 0);
    assert.equal(employee({action:'permissions',id:staff.id,permissions:['orders.view','orders.change']}).ok,id === 4);
    if (id !== 4) {
      assert.equal(employee({action:'credential',id:staff.id,password:'sample staff',pin:''}).ok,false);
      assert.equal(employee({action:'account',id:staff.id,username:'staff '+id,active:true}).ok,false);
      assert.equal(session.selectWaiter({id:staff.id,pin:''}).ok,false);
      assert.equal(session.signIn({username:'staff '+id,password:'sample staff'}).ok,false);
      login(id);
      assert.equal(session.selectWaiter({id:1,pin:entry.pin}).ok,false);
      assert.equal(hasPermissions(db,session,'orders.view'),false);
      login(id);
    }
    const staffId=staff.id;
    if(id!==4){
      for(const target of [id, id===2?3:2,4]) {
        assert.equal(employee({action:'credential',id:target,password:'replacement',pin:null}).ok,false);
        assert.equal(employee({action:'account',id:target,username:'changed',active:true}).ok,false);
        assert.equal(employee({action:'permissions',id:target,permissions:['employees.view','employees.change']}).ok,false);
        assert.equal(employee({action:'financialAccess',id:target,scope:'combined',close:true}).ok,false);
      }
      assert.equal(employee({action:'financialAccess',id:staffId,scope:'combined',close:true}).ok,false);
    }
  }
  login(1);
  assert.equal(employee({action:'create',username:'legacy-created',password:'sample staff',pin:''}).ok,false);
  assert.equal(employee({action:'credential',id:1,password:'sample staff',pin:''}).ok,false);
  assert.equal(employee({action:'permissions',id:1,permissions:['orders.view']}).ok,false);
  login(4);
  assert.equal(employee({action:'financialAccess',id:4,scope:'combined',close:true}).ok,false);
  assert.equal(employee({action:'financialAccess',id:2,scope:'B',close:true}).ok,false);
  assert.equal(employee({action:'financialAccess',id:2,scope:'B',close:false}).ok,true);
  assert.equal(db.prepare('SELECT scope FROM financial_scopes WHERE user_id=2').get().scope,'B');
  assert.equal(employee({action:'credential',id:2,password:'replacement',pin:null}).ok,true);
  assert.equal(employee({action:'permissions',id:2,permissions:['employees.view','employees.change','menu.change','tables.change']}).ok,true);
  const audit=db.prepare("SELECT actor_id,context FROM application_audit WHERE action='financial_access'").get();
  assert.equal(audit.actor_id,4); assert.deepEqual(JSON.parse(audit.context),{before:{scope:'A',close:false},after:{scope:'B',close:false}});
  for(const actor of [2,3,4]) assert.equal(db.prepare("SELECT count(*) n FROM application_audit WHERE actor_id=? AND action='create' AND entity_type IN ('area','category')").get(actor).n,2);
  session.signOut(); db.close(); db=openDatabase(dir); session=createSession(db); register();
  assert.equal(db.prepare('SELECT scope FROM financial_scopes WHERE user_id=2').get().scope,'B');
  assert.equal(session.signIn({username:'sample-owner-a',password:'replacement'}).ok,true);
  assert.equal(invoke('arra:table-config',{action:'list'}).ok,true);
  db.prepare("DELETE FROM user_permissions WHERE user_id=2 AND permission='tables.change'").run();
  assert.equal(invoke('arra:table-config',{action:'list'}).ok,false);
  assert.equal(session.selectWaiter({id:3,pin:''}).ok,false); assert.equal(invoke('arra:menu-config',{action:'list'}).ok,true);
});

test('upgrade grants shared administration only to existing owners', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-shared-upgrade-')); let db=openDatabase(dir);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  createSampleAccounts(db,['sample 1','sample 2','sample 3','sample 4']);
  db.exec("DROP TABLE IF EXISTS restaurant_accounts; DELETE FROM user_permissions WHERE user_id IN (2,3,4) AND permission IN ('tables.change','menu.change','employees.view','employees.change'); DROP TABLE IF EXISTS pending_staff; ALTER TABLE day_print_attempts DROP COLUMN scope; PRAGMA user_version=27");
  db.close(); db=openDatabase(dir);
  for(const id of [2,3,4]) for(const permission of ['tables.change','menu.change','employees.view','employees.change']) assert.ok(db.prepare('SELECT 1 FROM user_permissions WHERE user_id=? AND permission=?').get(id,permission));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,31);
  assert.equal(db.prepare("SELECT count(*) n FROM user_permissions WHERE user_id IN (2,3) AND permission='business_days.close'").get().n,0);
});

test('fresh bootstrap provisions Combined and can establish a waiter without changing populated databases', t=>{
  const {bootstrap}=require('../src/desktop/session');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-combined-bootstrap-')); let db=openDatabase(dir);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  bootstrap(db,'initial combined','sample bootstrap password');
  assert.equal(db.prepare('SELECT scope FROM financial_scopes WHERE user_id=1').get().scope,'combined');
  const session=createSession(db), handlers={}, event={};
  registerEmployeeConfig({handle:(name,fn)=>handlers[name]=fn},e=>e===event,db,session);
  assert.equal(session.signIn({username:'initial combined',password:'sample bootstrap password'}).ok,true);
  const call=req=>handlers['arra:employee-config'](event,req);
  const entry=entryFixture(db,null);
  assert.equal(call({action:'create',username:'new waiter',password:'sample waiter password',pin:entry.pin}).ok,true);
  const id=db.prepare("SELECT id FROM local_users WHERE username='new waiter'").get().id;
  assert.equal(call({action:'permissions',id,permissions:['tables.view','orders.view','orders.change']}).ok,true);
  assert.equal(call({action:'account',id:1,username:'initial combined',active:false}).ok,false);
  session.signOut(); assert.equal(session.signIn({username:'new waiter',password:'sample waiter password'}).ok,false);
  assert.equal(session.signIn({username:'sample restaurant',password:entry.password}).ok,true);
  assert.equal(session.selectWaiter({id,pin:entry.pin}).ok,true); assert.equal(hasPermissions(db,session,'tables.view','orders.view','orders.change'),true);
  assert.throws(()=>bootstrap(db,'another','sample password'));
  assert.equal(db.prepare("SELECT count(*) n FROM financial_scopes WHERE scope='combined'").get().n,1);
});

test('bootstrap refuses existing operational history even with no users', t=>{
  const {bootstrap}=require('../src/desktop/session');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-nonempty-bootstrap-')); const db=openDatabase(dir);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  db.exec("INSERT INTO dining_tables(id,area) VALUES(1,'sample'); INSERT INTO orders(table_id,opened_at,status) VALUES(1,1,'open')");
  assert.throws(()=>bootstrap(db,'new combined','sample password'));
  assert.equal(db.prepare('SELECT count(*) n FROM local_users').get().n,0);
});

test('pending staff remains inactive and unselectable until Combined provisions a password, including after restart',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-pending-')); let db=openDatabase(dir);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  const passwords=['sample waiter','sample owner a','sample owner b','sample combined']; createSampleAccounts(db,passwords); const entry=entryFixture(db);
  let session=createSession(db),handler; const event={};
  function attach(){registerEmployeeConfig({handle:(_,fn)=>handler=fn},e=>e===event,db,session);}
  const login=(name,pw)=>{session.signOut();assert.equal(session.signIn({username:name,password:pw}).ok,true)};
  attach();login('sample-owner-a',passwords[1],2);
  assert.equal(handler(event,{action:'createPending',username:'pending sample'}).ok,true);
  const id=db.prepare("SELECT id FROM local_users WHERE username='pending sample'").get().id;
  assert.equal(handler(event,{action:'account',id,username:'pending sample',active:true}).ok,false);
  db.close();db=openDatabase(dir);session=createSession(db);attach();login('sample-combined',passwords[3],4);
  assert.equal(handler(event,{action:'permissions',id,permissions:['orders.view']}).ok,true);
  assert.equal(handler(event,{action:'account',id,username:'pending sample',active:true}).ok,false);
  assert.equal(handler(event,{action:'credential',id,password:null,pin:entry.pin}).ok,true);
  assert.equal(handler(event,{action:'account',id,username:'pending sample',active:true}).ok,false);
  assert.equal(handler(event,{action:'credential',id,password:'sample provisioned password',pin:null}).ok,true);
  assert.equal(handler(event,{action:'account',id,username:'pending sample',active:true}).ok,true);
  session.signOut();assert.equal(session.signIn({username:'pending sample',password:'sample provisioned password'}).ok,false);
  assert.equal(session.signIn({username:'sample restaurant',password:entry.password}).ok,true);
  assert.equal(session.selectWaiter({id,pin:entry.pin}).ok,true);assert.equal(hasPermissions(db,session,'orders.view'),true);
});

test('sample legacy Combined recovery authenticates and copies without changing source or existing history',async t=>{
  const {bootstrap}=require('../src/desktop/session'); const {recoverSampleCombined}=require('../src/desktop/sample-combined-recovery');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-legacy-source-')); let db=openDatabase(dir), copies=[];
  t.after(()=>{if(db)db.close();for(const copy of copies)fs.rmSync(copy,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});});
  bootstrap(db,'legacy sample','sample legacy password');
  db.exec("DROP TABLE IF EXISTS restaurant_accounts; UPDATE financial_scopes SET scope='waiter' WHERE user_id=1; INSERT INTO dining_tables(id,area) VALUES(1,'sample'); INSERT INTO orders(table_id,opened_at,status) VALUES(1,123,'open'); DROP TABLE IF EXISTS pending_staff; ALTER TABLE day_print_attempts DROP COLUMN scope; PRAGMA user_version=27");
  db.close();db=null; const file=path.join(dir,'arra.sqlite');
  await assert.rejects(recoverSampleCombined(file,'legacy sample','sample legacy password'));
  fs.writeFileSync(path.join(dir,'SAMPLE-DATA-ONLY'),'sample');
  await assert.rejects(recoverSampleCombined(file,'legacy sample','wrong password'));
  const copy=await recoverSampleCombined(file,'legacy sample','sample legacy password');copies.push(copy);
  let upgraded=openDatabase(copy);assert.equal(upgraded.prepare('SELECT scope FROM financial_scopes WHERE user_id=1').get().scope,'combined');
  assert.equal(upgraded.prepare('SELECT opened_at FROM orders').get().opened_at,123);
  assert.equal(upgraded.prepare("SELECT actor_id FROM application_audit WHERE action='sample_combined_setup'").get().actor_id,1);
  upgraded.close();upgraded=openDatabase(copy);assert.equal(upgraded.prepare('SELECT scope FROM financial_scopes WHERE user_id=1').get().scope,'combined');
  upgraded.close();db=openDatabase(dir);assert.equal(db.prepare('SELECT scope FROM financial_scopes WHERE user_id=1').get().scope,'waiter');
  db.prepare("UPDATE financial_scopes SET scope='A' WHERE user_id=1").run();db.close();db=null;
  await assert.rejects(recoverSampleCombined(file,'legacy sample','sample legacy password'));
  db=openDatabase(dir); db.exec("UPDATE financial_scopes SET scope='waiter' WHERE user_id=1; DELETE FROM user_permissions WHERE user_id=1 AND permission='employees.change'"); db.close();db=null;
  await assert.rejects(recoverSampleCombined(file,'legacy sample','sample legacy password'));
  db=openDatabase(dir); db.exec("INSERT INTO user_permissions VALUES (1,'employees.change'); INSERT INTO local_users(username,salt,password_hash) VALUES ('unscoped',x'01',x'01')"); db.close();db=null;
  await assert.rejects(recoverSampleCombined(file,'legacy sample','sample legacy password'));
});

test('failed marked-sample recovery removes its temporary copy',async t=>{
  const {bootstrap}=require('../src/desktop/session'); const {recoverSampleCombined}=require('../src/desktop/sample-combined-recovery');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-recovery-cleanup-'));const db=openDatabase(dir);
  bootstrap(db,'legacy sample','sample legacy password');db.exec("UPDATE financial_scopes SET scope='waiter' WHERE user_id=1");db.close();
  fs.writeFileSync(path.join(dir,'SAMPLE-DATA-ONLY'),'sample');
  const oldMkdtemp=fs.mkdtempSync, oldWrite=fs.writeFileSync;let created;
  t.after(()=>{fs.mkdtempSync=oldMkdtemp;fs.writeFileSync=oldWrite;fs.rmSync(dir,{recursive:true,force:true});});
  fs.mkdtempSync=function(prefix,...args){const result=oldMkdtemp.call(this,prefix,...args);if(prefix.includes('arra-sample-combined-'))created=result;return result};
  fs.writeFileSync=function(file,...args){if(created && file===path.join(created,'SAMPLE-DATA-ONLY'))throw Error('injected marker failure');return oldWrite.call(this,file,...args)};
  await assert.rejects(recoverSampleCombined(path.join(dir,'arra.sqlite'),'legacy sample','sample legacy password'));
  assert.ok(created);assert.equal(fs.existsSync(created),false);
});
