const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {migrate}=require('../src/desktop/database');
const {registerBusinessDays}=require('../src/desktop/business-days');
const {createPf700PrinterControl}=require('../src/desktop/pf700-printer-control');
const {encodeRequest}=require('../src/desktop/pf700-frame');
const serial='SYNTHETIC01';
function reply(sequence,command,value) {
  const data=Buffer.from(value),status=Buffer.from('888080e1809a','hex');
  const body=Buffer.concat([Buffer.from([43+data.length,sequence,command]),data,Buffer.from([4]),status,Buffer.from([5])]);
  const sum=body.reduce((a,b)=>a+b,0);
  return Buffer.concat([Buffer.from([1]),body,Buffer.from([12,8,4,0].map(x=>48+(sum>>x&15))),Buffer.from([3])]);
}
test('periodic selections send one exact report and invalid or denied requests send none',async t=>{
  const db=new DatabaseSync(':memory:'); t.after(()=>db.close()); migrate(db);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'a',x'00',x'00'),(2,'b',x'00',x'00');
    INSERT INTO financial_scopes VALUES(1,'A'),(2,'B'); INSERT INTO user_permissions VALUES(1,'employees.view'),(2,'employees.view');`);
  let actor=1,handler, fiscalOpen=true; const frames=[];
  const adapter=createPf700PrinterControl({expectedSerial:serial,openPipe:async()=>({exchange:async frame=>{
    frames.push(Buffer.from(frame));
    if(frame[3]===90)return reply(frame[2],90,'1.00 231014 1230,ABCD,0011,1,'+serial);
    assert.equal(fiscalOpen,true); return reply(frame[2],frame[3],'');
  },close:async()=>{}})});
  registerBusinessDays({handle:(_,fn)=>handler=fn},event=>event.trusted,db,{currentUserId:()=>actor,authenticatedUserId:()=>actor},undefined,null,adapter);
  const req=(range,format,start,end)=>({action:'accountAPrinterPeriodicReport',range,format,start,end});
  for(const bad of [req('date','short','1999-12-31','2000-01-01'),req('date','short','2099-12-31','2100-01-01'),req('date','short','2023-02-29','2023-03-01'),req('date','short','2024-04-31','2024-05-01'),req('date','short','2024-03-01','2024-02-29'),req('record','short','0','2'),req('record','short','1','10000'),req('record','short','2','1'),req('record','bad','1','2'),req('bad','short','1','2'),{...req('record','short','1','2'),command:73}]) assert.equal((await handler({trusted:true},bad)).ok,false);
  actor=2; assert.equal((await handler({trusted:true},req('record','short','1','2'))).ok,false);
  actor=1; assert.equal((await handler({trusted:false},req('record','short','1','2'))).ok,false); assert.deepEqual(frames,[]);
  db.exec('PRAGMA query_only=ON'); const changes=db.prepare('SELECT total_changes() n').get().n;
  for(const [range,format,start,end,command,data] of [
    ['date','short','2014-11-29','2014-11-30',79,'291114,301114'],['date','detailed','2014-11-29','2014-11-30',94,'291114,301114'],
    ['record','short','1','2',95,'0001,0002'],['record','detailed','1','2',73,'0001,0002'],
    ['date','short','2000-01-01','2000-01-01',79,'010100,010100'],['date','short','2099-12-31','2099-12-31',79,'311299,311299'],['date','short','2024-02-29','2024-02-29',79,'290224,290224'],['record','short','9999','9999',95,'9999,9999']]) {
    const prior=frames.length; assert.deepEqual(await handler({trusted:true},req(range,format,start,end)),{ok:true});
    assert.equal(frames.length,prior+2); assert.equal(frames[prior][3],90);
    assert.deepEqual(frames[prior+1],encodeRequest({sequence:frames[prior+1][2],command,data:Buffer.from(data)}));
  }
  assert.equal(db.prepare('SELECT total_changes() n').get().n,changes); assert.equal(fiscalOpen,true);
});
test('periodic reply must be empty and is never retried',async()=>{
  for(const result of ['bad','lost']) {
    const commands=[]; const adapter=createPf700PrinterControl({expectedSerial:serial,openPipe:async()=>({exchange:async frame=>{
      commands.push(frame[3]); if(frame[3]===90)return reply(frame[2],90,'1.00 231014 1230,ABCD,0011,1,'+serial);
      if(result==='lost')throw Error('lost'); return reply(frame[2],frame[3],'unexpected');
    },close:async()=>{}})});
    assert.equal(await adapter.printPeriodicReport({command:73,data:'0001,0002'},()=>true),'failed'); assert.deepEqual(commands,[90,73]);
  }
});
