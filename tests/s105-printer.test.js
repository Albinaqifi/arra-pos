const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('../src/desktop/database');
const { registerBusinessDays } = require('../src/desktop/business-days');
const { createPf700PrinterControl } = require('../src/desktop/pf700-printer-control');
const { encodeRequest } = require('../src/desktop/pf700-frame');
const serial='SYNTHETIC01';
function reply(sequence,command,value) {
  const data=Buffer.from(value), status=Buffer.from('888080e1809a','hex');
  const body=Buffer.concat([Buffer.from([43+data.length,sequence,command]),data,Buffer.from([4]),status,Buffer.from([5])]);
  const sum=body.reduce((a,b)=>a+b,0);
  return Buffer.concat([Buffer.from([1]),body,Buffer.from([12,8,4,0].map(x=>48+(sum>>x&15))),Buffer.from([3])]);
}
test('authorized daily control sends only 69/2 with B payment present and writes nothing',async t=>{
  const db=new DatabaseSync(':memory:'); t.after(()=>db.close()); migrate(db);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES (1,'combined',x'00',x'00'),(2,'b',x'00',x'00'),(3,'no-grant',x'00',x'00');
  INSERT INTO financial_scopes VALUES (1,'combined'),(2,'B'),(3,'combined');
  INSERT INTO user_permissions VALUES (1,'business_days.close'),(2,'business_days.close');
  INSERT INTO dining_tables(id,area) VALUES(1,'sample');
  INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
  INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,30,'sample');
  INSERT INTO payments(id,bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,2,30,'cash','B');
`);
  const frames=[]; let closes=0, fiscalOpen=true;
  const adapter=createPf700PrinterControl({expectedSerial:serial,openPipe:async operation=>{
    assert.equal(operation,'PrinterControl'); return {exchange:async frame=>{
      frames.push(Buffer.from(frame)); const cmd=frame[3];
      if(cmd===90) return reply(frame[2],cmd,'1.00 231014 1230,ABCD,0011,1,'+serial);
      assert.equal(cmd,69); assert.equal(frame.subarray(4,-6).toString('hex'),'32');
      assert.equal(fiscalOpen,true); return reply(frame[2],cmd,'tax totals');
    },close:async()=>{closes++;}};
  }});
  let actor=1,auth=1,handler; const session={currentUserId:()=>actor,authenticatedUserId:()=>auth};
  registerBusinessDays({handle:(_,fn)=>handler=fn},e=>e.trusted,db,session,undefined,null,adapter);
  const req={action:'accountAPrinterDailyControl'};
  for(const [a,b] of [[2,2],[3,3],[1,2],[null,null]]) {actor=a;auth=b;assert.equal((await handler({trusted:true},req)).ok,false);}
  actor=auth=1;
  for(const bad of [{...req,command:69},{action:'accountAPrinterCashMovement'},{action:'accountAPrinterPeriodicReport'}]) assert.equal((await handler({trusted:true},bad)).ok,false);
  assert.equal((await handler({trusted:false},req)).ok,false); assert.equal(frames.length,0);
  db.exec('PRAGMA query_only=ON');
  const before=db.prepare('SELECT * FROM business_days').all(), changes=db.prepare('SELECT total_changes() AS n').get().n;
  assert.deepEqual(await handler({trusted:true},req),{ok:true});
  assert.deepEqual(frames.map(f=>f[3]),[90,69]);
  assert.deepEqual(frames[1],encodeRequest({sequence:frames[1][2],command:69,data:Buffer.from('2')}));
  assert.equal(frames[1][2],frames[0][2]===127?32:frames[0][2]+1);
  assert.deepEqual(db.prepare('SELECT * FROM business_days').all(),before);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n,changes);
  assert.equal(db.prepare('SELECT account FROM payments').get().account,'B');
  assert.equal(fiscalOpen,true); assert.equal(closes,1);
});
test('wrong identity and transport failure cannot trigger a print',async()=>{
  for (const identity of ['1.00 231014 1230,ABCD,0011,1,WRONG000001',null]) {
    const frames=[]; const adapter=createPf700PrinterControl({expectedSerial:serial,openPipe:async()=>({exchange:async frame=>{frames.push(frame); if (!identity) throw Error('offline'); return reply(frame[2],90,identity);},close:async()=>{}})});
    assert.equal(await adapter.printDailyControl(()=>true),'failed'); assert.deepEqual(frames.map(f=>f[3]),[90]);
  }
});

test('authorization is rechecked after the identity probe before the print',async t=>{
  const db=new DatabaseSync(':memory:'); t.after(()=>db.close()); migrate(db);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES (1,'combined',x'00',x'00');
    INSERT INTO financial_scopes VALUES(1,'combined'); INSERT INTO user_permissions VALUES(1,'business_days.close');`);
  let actor=1,auth=1,generation=0,trusted=true,handler,release;
  const frames=[];
  const adapter=createPf700PrinterControl({expectedSerial:serial,openPipe:async()=>({
    exchange:frame=>{ frames.push(frame[3]); return new Promise(resolve=>{release=()=>resolve(reply(frame[2],90,'1.00 231014 1230,ABCD,0011,1,'+serial));}); },close:async()=>{}
  })});
  registerBusinessDays({handle:(_,fn)=>handler=fn},()=>trusted,db,{currentUserId:()=>actor,authenticatedUserId:()=>auth,identityGeneration:()=>generation},undefined,null,adapter);
  for(const change of [()=>{actor=null;},()=>{generation++;},()=>{trusted=false;},()=>{db.exec("DELETE FROM user_permissions WHERE user_id=1");}]) {
    actor=auth=1; trusted=true; db.exec("INSERT OR IGNORE INTO user_permissions VALUES(1,'business_days.close')"); frames.length=0;
    const result=handler({}, {action:'accountAPrinterDailyControl'}); await new Promise(setImmediate);
    change(); release(); assert.deepEqual(await result,{ok:false}); assert.deepEqual(frames,[90]);
  }
});

test('lost, malformed and error replies do not retry the daily control',async()=>{
  for (const failure of ['lost','malformed','status']) {
    const frames=[]; let closed=0;
    const adapter=createPf700PrinterControl({expectedSerial:serial,openPipe:async()=>({
      exchange:async frame=>{
        frames.push(Buffer.from(frame));
        if(frame[3]===90) return reply(frame[2],90,'1.00 231014 1230,ABCD,0011,1,'+serial);
        if(failure==='lost') throw Error('Lost acknowledgement');
        if(failure==='malformed') return Buffer.from([0x15]);
        // Construct a valid frame with a printer error status and checksum.
        const data=Buffer.from('tax totals'),status=Buffer.from('898080e1809a','hex');
        const body=Buffer.concat([Buffer.from([43+data.length,frame[2],69]),data,Buffer.from([4]),status,Buffer.from([5])]);
        const sum=body.reduce((a,b)=>a+b,0);
        return Buffer.concat([Buffer.from([1]),body,Buffer.from([12,8,4,0].map(x=>48+(sum>>x&15))),Buffer.from([3])]);
      },close:async()=>{closed++;}
    })});
    assert.equal(await adapter.printDailyControl(()=>true),'failed',failure);
    assert.deepEqual(frames.map(frame=>frame[3]),[90,69],failure);
    assert.equal(closed,1,failure);
  }
});

test('simultaneous direct requests do not issue a second print',async()=>{
  const frames=[]; let release, ready;
  const started=new Promise(resolve=>{ready=resolve;});
  const adapter=createPf700PrinterControl({expectedSerial:serial,openPipe:async()=>({
    exchange:async frame=>{
      frames.push(frame[3]);
      if(frame[3]===90) return reply(frame[2],90,'1.00 231014 1230,ABCD,0011,1,'+serial);
      ready(); await new Promise(resolve=>{release=resolve;});
      return reply(frame[2],69,'tax totals');
    },close:async()=>{}
  })});
  const first=adapter.printDailyControl(()=>true);
  await started;
  assert.equal(await adapter.printDailyControl(()=>true),'failed');
  release(); assert.equal(await first,'accepted');
  assert.deepEqual(frames,[90,69]);
});
