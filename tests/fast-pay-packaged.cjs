// Windows package acceptance rehearsal. All database, device, config and identity state is synthetic.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const cp = require('node:child_process');
const { createStatefulPf700 } = require('./support/pf700-stateful-device');
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
const kit = path.resolve(process.env.QA_PAY_KIT || process.argv[2]);
const desktop = path.join(kit,'program','resources','app','src','desktop');
const mod = name => require(path.join(desktop,name));
const location = () => path.join(process.env.APPDATA,'Arra POS PF700 Commissioning');
const dbfile = () => path.join(location(),'arra.sqlite');
const plain = rows => rows.map(row=>({...row}));
function fixtures(keys) {
  fs.mkdirSync(location(),{recursive:true});
  const db = mod('database').openDatabase(location());
  try {
    mod('sample-accounts').seedSampleIdentities(db,keys.passwords,keys.pin,keys.transfer);
    mod('pf700-commissioning').enroll(db);
    mod('pf700-commissioning').deviceTrial(createStatefulPf700().serial).claim();
    mod('tables').seedTables(db);
    mod('arra-menu').seedArraMenu(db,{applyOrigins:false});
    db.exec("INSERT INTO menu_product_fiscal_origin VALUES ('arra-product-11-0',1),('arra-product-12-0',0)");
    const user = name=>db.prepare('SELECT id FROM local_users WHERE username=?').get(name).id;
    const id=user('sample-waiter');
    const identity={currentUserId:()=>id, authenticatedUserId:()=>id, identityGeneration:()=>1};
    const handlers={}, ipc={handle:(channel,fn)=>{handlers[channel]=fn;}};
    mod('orders').registerOrders(ipc,()=>true,db,identity);
    mod('order-items').registerOrderItems(ipc,()=>true,db,identity);
    const call=(channel,req)=>{const r=handlers['arra:'+channel]({},req);assert.equal(r.ok,true,channel+' '+r.error);return r.data;};
    for(let i=1;i<=5;i++) {
      const order=call('open-order',{tableId:i});
      assert.equal(order.id,i);
      for(const productId of ['arra-product-11-0','arra-product-12-0']) call('order-items',{action:'add',orderId:i,productId});
      call('order-items',{action:'send',orderId:i,requestId:'sample-test-order-'+i});
    }
    const wallet=mod('wallet');
    assert.equal(wallet.handle({action:'walletStart',amount:100,requestId:crypto.randomUUID(),revision:wallet.status(db).revision},db,'combined',user('sample-combined')).ok,true);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,53);
  }finally{db.close();}
}
function observe(fn) {
  const db = new DatabaseSync(dbfile());
  try{return fn(db);}finally{db.close();}
}
async function parent() {
  const root=fs.mkdtempSync(path.resolve(__dirname,'../build/fast-pay-qa-'));
  process.env.APPDATA=path.join(root,'roaming');
  process.env.LOCALAPPDATA=path.join(root,'local');
  const keys={passwords:Array.from({length:4},()=>crypto.randomBytes(20).toString('hex')),
    pin:String(crypto.randomInt(1000,10000)),transfer:String(crypto.randomInt(100000,1000000))};
  fixtures(keys);
  const runtime=path.resolve(__dirname,'../node_modules/electron/dist/electron.exe');
  const hash=name=>crypto.hash('sha256',fs.readFileSync(name));
  assert.equal(hash(runtime),hash(path.join(kit,'program/electron.exe')));
  const lockPath=path.join(process.env.LOCALAPPDATA,'Arra POS','PF700 commissioning','fast-pay-v1','worker.sqlite');
  fs.mkdirSync(path.dirname(lockPath),{recursive:true});
  const snapshot=name=>observe(db=>db.prepare('VACUUM INTO ?').run(path.join(root,name+'.sqlite')));
  const restore=name=>{
    // Every caller has joined all child processes and closed all database handles.
    const db=new DatabaseSync(dbfile());db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close();
    assert.equal(path.dirname(path.dirname(location())),root);
    fs.copyFileSync(path.join(root,name+'.sqlite'),dbfile());
  };
  const run=async phase=>{
    const profile={expectedSerial:createStatefulPf700().serial,operatorNumber:2,tillNumber:1,
      operatorPassword:String(crypto.randomInt(100000,1000000)),domesticProduct:false,dataDirectory:location()};
    const env={...process.env,QA_PAY_KIT:kit,QA_PAY_PHASE:phase,QA_PAY_ROOT:root,QA_PAY_AUTH:JSON.stringify(keys)};
    delete env.ELECTRON_RUN_AS_NODE;
    const cache=path.join(root,phase+'-cache');fs.mkdirSync(cache);
    const child=cp.spawn(runtime,[__filename,'--user-data-dir='+cache,'--disable-background-networking'],{env,stdio:['pipe','ignore','pipe'],windowsHide:true});
    let stderr='';
    child.stderr.on('data',b=>{stderr=(stderr+b).slice(-800);});
    const timeout=setTimeout(()=>child.kill(),60000);
    const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>{
      clearTimeout(timeout);
      const filename=path.join(root,phase+'.json');
      const out=fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename)):null;
      if(code!==0 || !out?.pass)return reject(Error(phase+' '+(out?.message || stderr || 'no outcome')));
      console.log('PASS '+phase+' '+out.message);
      resolve(out);
    });});
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify(profile));
    return done;
  };
  const lock=new DatabaseSync(lockPath);
  lock.exec('BEGIN IMMEDIATE');
  try {
    snapshot('before-orders-paid');
    await run('pay');
    const check=(db)=>{
      assert.deepEqual(plain(db.prepare('SELECT bill_id,amount,method,account FROM payments ORDER BY id').all()),[
        {bill_id:1,amount:250,method:'cash',account:'A'},{bill_id:2,amount:250,method:'card',account:'A'},
        {bill_id:3,amount:250,method:'cash',account:'B'}]);
      assert.equal(db.prepare('SELECT count(*) n FROM fast_pay_v1_claims').get().n,0);
      assert.equal(mod('wallet').status(db).expected,600);
    };
    observe(check);
    snapshot('queued');
  }finally{lock.close();}
  await run('recover');
  await run('restart');
  const raceLock=new DatabaseSync(lockPath);
  raceLock.exec('BEGIN IMMEDIATE');
  try {
    observe(db=>db.exec("CREATE TRIGGER sample_rollback BEFORE INSERT ON fast_pay_v1_jobs BEGIN SELECT RAISE(ABORT,'injected transaction failure'); END"));
    await run('rollback');
    observe(db=>db.exec('DROP TRIGGER sample_rollback'));
    const contenders=['race-cash','race-card'];
    const ready=async names=>{
      for(let i=0;i<200;i++){
        if(names.every(phase=>fs.existsSync(path.join(root,phase+'.ready'))))return;
        await delay(50);
      }
      throw Error('Independent processes failed to reach race barrier');
    };
    const cashSession=run('race-cash');
    await Promise.race([cashSession,ready(['race-cash'])]);
    const cardSession=run('race-card');
    await Promise.race([cardSession,ready(contenders)]);
    fs.writeFileSync(path.join(root,'race.go'),'');
    const [cash,card]=await Promise.all([cashSession,cardSession]);
    assert.deepEqual([cash.ok,card.ok].sort(),[false,true]);
    observe(db=>{
      assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,5);
      const winner=db.prepare('SELECT method,account FROM payments WHERE bill_id=5').get();
      assert.deepEqual({...winner},{method:cash.ok?'cash':'card',account:'A'});
      assert.equal(db.prepare("SELECT count(*) n FROM fast_pay_v1_status WHERE bill_id=5 AND receipt_status='queued'").get().n,1);
    });
    console.log('PASS two separate Windows Electron processes raced opposite tenders and committed one payment/one queued receipt');
  }finally{raceLock.close();}
  restore('queued');
  await run('restore-queued');
  restore('before-orders-paid');
  await run('restore-before-pay');
  console.log('PASS queued and pre-payment SQLite snapshots restored against original disposable sidecars');
}
async function desktopPhase() {
  const phase=process.env.QA_PAY_PHASE,root=process.env.QA_PAY_ROOT,keys=JSON.parse(process.env.QA_PAY_AUTH);
  delete process.env.QA_PAY_AUTH;
  assert.equal(path.dirname(path.dirname(location())),root);
  const {app,BrowserWindow,session,dialog}=require('electron');
  const fail=error=>{fs.writeFileSync(path.join(root,phase+'.json'),JSON.stringify({pass:false,message:error.stack||error.message}));app.exit(1);};
  const pass=(message,ok)=>{fs.writeFileSync(path.join(root,phase+'.json'),JSON.stringify({pass:true,message,ok}));app.quit();};
  const timer=setTimeout(()=>fail(Error('Timed out')),48000);timer.unref();
  app.setPath('userData',location());
  app.setPath('sessionData',path.join(root,phase+'-cache'));
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-background-networking');
  process.argv.push('--arra-fast-pay','--pf700-routine-checkout');
  const ops=[],calls=[];
  const deny=name=>()=>{calls.push(name);throw Error('Unexpected IO: '+name);};
  for(const key of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=deny(key);
  cp.spawn=(exe,args)=>{
    assert.equal(path.basename(exe).toLowerCase(),'powershell.exe');
    assert.equal(path.basename(args[args.indexOf('-File')+1]),'pf700-checkout-exchange.ps1');
    const method=args.includes('-Operation')?'card':'cash';
    if(method==='card')assert.equal(args[args.indexOf('-Operation')+1],'CardTrial');
    const fake=createStatefulPf700({method});
    fake.state.document=1+ops.reduce((s,row)=>s+row.fake.state.closes,0);
    if(phase!=='recover')throw Error('Synthetic printer was accessed during '+phase+' after '+(ops.push({method,fake})));
    if(ops.length===0)fake.fault(56,'after');
    ops.push({method,fake});
    return fake.start();
  };
  for(const proto of ['node:http','node:https']){require(proto).get=deny('network');require(proto).request=deny('network');}
  require('node:net').Socket.prototype.connect=deny('network');
  require('node:dgram').Socket.prototype.send=deny('network');
  global.fetch=deny('network');
  dialog.showErrorBox=title=>fail(Error('Startup '+title));
  const main=path.join(desktop,'main.js');
  const electron=require('electron'),Module=require('node:module'),load=Module._load;
  Module._load=function(id,parent,...rest) {
    if(id==='electron' && parent?.filename===main)return new Proxy(electron,{get(target,key){
      if(key==='BrowserWindow')return class extends BrowserWindow{constructor(opts){super({...opts,show:false,webPreferences:{...opts.webPreferences,offscreen:true,backgroundThrottling:false}});}};
      return target[key];
    }});
    return load.call(this,id,parent,...rest);
  };
  async function exercise(web) {
    web.debugger.attach('1.3');
    await web.debugger.sendCommand('Network.enable');
    await web.debugger.sendCommand('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    const js=s=>web.executeJavaScript(s,true);
    const waiter=async(expr,label)=>{
      for(let i=0;i<100;i++){if(await js(expr))return;await delay(40);}
      const labels=await js("Array.from(document.querySelectorAll('button')).filter(b=>b.checkVisibility()).map(b=>b.getAttribute('aria-label')||b.textContent).slice(0,22)");
      const error=await js("document.querySelector('.bill-error')?.textContent");
      throw Error(label+' missing. '+labels.join(' / ')+' '+(error||''));
    };
    const btn=label=>"[...document.querySelectorAll('button')].find(b=>b.checkVisibility()&&!b.disabled&&(b.textContent.trim()==="+JSON.stringify(label)+"||b.getAttribute('aria-label')==="+JSON.stringify(label)+"))";
    const click=async expr=>{await waiter('!!('+expr+')',expr);await js('('+expr+').click()');};
    const input=async(selector,value)=>{
      const expr='document.querySelector('+JSON.stringify(selector)+')';
      await waiter('!!'+expr,selector);
      await js("(()=>{const e="+expr+";Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSON.stringify(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
    };
    const call=(name,...args)=>js('window.arra.'+name+'('+args.map(arg=>JSON.stringify(arg)).join(',')+')');
    const pay=async(id,tender)=>{
      await click("document.querySelector('button[aria-label^=\"Table "+id+", taken\"]')");
      if(await js("!!document.querySelector('input[inputmode=numeric]')"))await input('input[inputmode=numeric]',keys.pin);
      await click(btn('Bill'));
      await click(btn(tender));
      await click(btn('Pay'));
      await waiter("!document.querySelector('.bill-dialog')",'bill dismissed');
      await waiter("!!document.querySelector('button[aria-label=\"Table "+id+", free\"]')",'free table '+id);
    };
    const statuses=()=>observe(db=>db.prepare('SELECT receipt_status s FROM fast_pay_v1_status ORDER BY payment_id').all().map(r=>r.s));
    const waitFor=async(fn,tag)=>{for(let i=0;i<120;i++){if(fn())return;await delay(50);}throw Error('Missing '+tag+' '+JSON.stringify(statuses()));};
    assert.equal(await js('navigator.onLine'),false);
    await input('input[autocomplete=username]','sample-restaurant');
    await input('input[autocomplete=current-password]',keys.passwords[0]);
    await click(btn('Sign in'));
    const waiterIPC=async()=>{assert.equal((await call('signIn','sample-restaurant',keys.passwords[0])).ok,true);assert.equal((await call('identifyStaff',keys.pin,'waiter')).ok,true);};
    const record=(id,method)=>call('payment',{billId:id,method,account:'A',fastPay:true});
    const generate=async orderId=>{
      const preview=await call('bill',{action:'review',orderId});
      assert.equal(preview.ok,true);
      const saved=await call('bill',{action:'generate',orderId,fingerprint:preview.data.fingerprint});
      assert.equal(saved.ok,true);
      return saved.data.id;
    };
    let raceWon;
    if(phase==='pay') {
      await pay(1,'Cash A');await pay(2,'Card A');await pay(3,'Select Cash B');
      await waiterIPC();
      const [same,conflict]=await Promise.all([record(1,'cash'),record(1,'card')]);
      assert.equal(same.ok,true);assert.equal(conflict.ok,false);
      assert.equal((await call('payment',{billId:2,method:'card',account:'B'})).ok,false);
      assert.deepEqual(statuses(),['queued','queued']);
    } else if(phase==='recover') {
      await waitFor(()=>statuses().join()==='unconfirmed,acknowledged','startup receipt dispatch');
      await pay(4,'Cash A');
      await waitFor(()=>statuses().join()==='unconfirmed,acknowledged,acknowledged','third receipt');
      assert.deepEqual(ops.map(row=>[row.method,row.fake.state.tenders,row.fake.state.closes]),[['cash',1,1],['card',1,1],['cash',1,1]]);
      assert.equal(ops[0].fake.transcript.at(-1).effect,'executed-reply-lost');
      assert.equal((await call('signIn','sample-combined',keys.passwords[3])).ok,true);
      const report=await call('businessDays',{action:'accountABillsPreview',dayId:1});
      assert.equal(report.ok,true);assert.deepEqual([report.data.cash,report.data.card,report.data.total],[500,250,750]);
      assert.deepEqual(report.data.records.map(r=>r.receiptStatus),statuses());
      const wallet=await call('businessDays',{action:'walletStatus'});
      assert.equal(wallet.data.expected,850);
      observe(db=>{
        for(const table of ['payments','payment_shifts','payment_business_days'])assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,4);
        const r=JSON.parse(db.prepare('SELECT receipt FROM fast_pay_v1_jobs ORDER BY payment_id').get().receipt);
        assert.deepEqual(r.lines.map(l=>[l.quantity,l.unitPrice,l.taxRate,l.domesticProduct]),[[1,70,10,true],[1,180,18,false]]);
      });
    } else if(phase==='restart' || phase==='restore-queued') {
      const expected=phase==='restart'?['unconfirmed','acknowledged','acknowledged']:['unconfirmed','unconfirmed'];
      await waitFor(()=>statuses().join()===expected.join(),'restart');
      await waiterIPC();
      assert.equal((await record(1,'cash')).ok,true);assert.equal((await record(2,'card')).ok,true);
      assert.equal((await record(1,'card')).ok,false);
      await delay(150);
    } else if(phase==='rollback') {
      await waiterIPC();
      const billId=await generate(5);
      assert.equal((await record(billId,'card')).ok,false);
      assert.equal((await call('signIn','sample-combined',keys.passwords[3])).ok,true);
      assert.equal((await record(billId,'cash')).error,'Access denied');
      assert.equal((await call('signIn','sample-owner-b',keys.passwords[2])).ok,true);
      assert.equal((await call('businessDays',{action:'accountABillsPreview',dayId:1})).ok,false);
      assert.equal((await call('signIn','sample-owner-a',keys.passwords[1])).ok,true);
      const a=await call('businessDays',{action:'accountABillsPreview',dayId:1});
      assert.equal(a.ok,true);
      assert.equal(a.data.records.some(r=>'receiptStatus' in r),false);
      observe(db=>{
        assert.equal(db.prepare('SELECT status FROM orders WHERE id=5').get().status,'open');
        for(const t of ['payments','payment_business_days','payment_shifts'])
          assert.equal(db.prepare('SELECT count(*) n FROM '+t).get().n,4);
        assert.equal(db.prepare('SELECT count(*) n FROM fast_pay_v1_jobs').get().n,3);
        assert.equal(db.prepare('SELECT count(*) n FROM bills WHERE order_id=5').get().n,1);
      });
    } else if(phase.startsWith('race-')) {
      await waiterIPC();
      const billId=observe(db=>db.prepare('SELECT id FROM bills WHERE order_id=5').get().id);
      const method=phase.slice(5);
      fs.writeFileSync(path.join(root,phase+'.ready'),'');
      await waitFor(()=>fs.existsSync(path.join(root,'race.go')),'race release');
      let response=await record(billId,method);
      if(response.error==='Could not record payment. Retry the same selection.')response=await record(billId,method);
      raceWon=response.ok;
      if(!raceWon)assert.equal(response.error,'Bill already paid with a different selection');
      const repeated=await record(billId,method);
      assert.equal(repeated.ok,raceWon);
      if(raceWon)assert.equal(repeated.data.id,response.data.id);
    } else if(phase==='restore-before-pay') {
      await waiterIPC();
      const id=await generate(1);
      for(const request of [{billId:id,method:'cash',account:'A',fastPay:true},{billId:id,method:'card',account:'A',fastPay:true},{billId:id,method:'cash',account:'B'}]){
        const blocked=await call('payment',request);
        assert.equal(blocked.ok,false);
        assert.equal(blocked.fiscalStatus,'blocked');
      }
      observe(db=>assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,0));
      await delay(250);
    } else throw Error('Unknown test phase');
    if(phase!=='recover')assert.equal(ops.length,0,'unexpected synthetic device operation');
    assert.deepEqual(calls,[]);
    pass({pay:'Pay closed three bills and freed their tables before any device operation; Cash B, retry and conflicting tender checked',
      recover:'startup delivered both queued receipts; lost cash close reply held, next card + cash each acknowledged. Account A 500 cash / 250 card, wallet 850 from opening 100',
      restart:'paid bills replayed safely, original three receipt outcomes preserved',
      rollback:'injected queue failure rolled back payment and preserved unpaid bill; Combined payment and B preview denied; A preview retained existing scope',
      'race-cash':'independent cash session and same-selection retry returned a consistent result',
      'race-card':'independent card session and same-selection retry returned a consistent result',
      'restore-queued':'restored queued jobs became unconfirmed without touching the printer',
      'restore-before-pay':'restored unpaid order; Cash A, Card A and Cash B all blocked with zero payments and zero printer calls'}[phase],raceWon);
  }
  await app.whenReady();
  await session.defaultSession.enableNetworkEmulation({offline:true});
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_,cb)=>{calls.push('renderer network');cb({cancel:true});});
  app.once('browser-window-created',(_,w)=>w.webContents.once('did-finish-load',()=>exercise(w.webContents).catch(fail)));
  require(main);
}
(process.versions.electron?desktopPhase():parent()).catch(error=>{console.error(error.message);process.exitCode=1;});
