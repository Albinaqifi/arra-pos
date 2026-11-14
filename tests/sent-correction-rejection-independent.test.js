const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const {openDatabase} = require('../src/desktop/database');
const {authorizedDatabase} = require('./support/authorized-database');
const {seedTables} = require('../src/desktop/tables');
const {seedMenu} = require('../src/desktop/menu');
const {registerOrderItems} = require('../src/desktop/order-items');

test('preload and service preserve typed rejections and replay after billing', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-rejection-')); const db=authorizedDatabase(openDatabase(dir));
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});}); seedTables(db);seedMenu(db);
  db.exec("INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'); INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,status) VALUES(1,1,'qebapa','Sample',10,2,'sent'),(2,2,'shopska','Sample 2',20,1,'sent'); INSERT INTO bills(order_id,actor_id,generated_at,total,fingerprint) VALUES(2,1,1,20,'sample')");
  let handler, api, actor=1, loseResponse=false;
  registerOrderItems({handle:(_,f)=>handler=f},()=>true,db,{currentUserId:()=>actor,authenticatedUserId:()=>actor});
  const ipcRenderer={invoke:async (_channel,request)=>{const result=handler({},JSON.parse(JSON.stringify(request))); if(loseResponse){loseResponse=false;throw Error('lost response');}return result;}};
  vm.runInNewContext(fs.readFileSync('src/desktop/preload.js','utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_,value)=>api=value},ipcRenderer})});
  const req={itemId:1,quantity:1,reason:'Mistake',requestId:'same'};
  assert.equal((await api.orderItems('correct',2,{...req,itemId:2})).code,'already_billed');
  assert.equal((await api.orderItems('correct',1,{...req,quantity:3})).code,'unavailable');
  assert.equal((await api.orderItems('correct',1,{...req,reason:' '})).code,'invalid_input');
  actor=null; assert.equal((await api.orderItems('correct',1,req)).code,'access_denied'); actor=1;
  loseResponse=true; assert.equal((await api.orderItems('correct',1,req)).ok,false);
  assert.equal(db.prepare('SELECT count(*) n FROM sent_item_corrections').get().n,1);
  db.exec("INSERT INTO bills(order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,2,10,'after')");
  assert.equal((await api.orderItems('correct',1,req)).ok,true);
  assert.equal(db.prepare('SELECT count(*) n FROM sent_item_corrections').get().n,1);
  assert.equal((await api.orderItems('correct',1,{...req,requestId:'new'})).code,'already_billed');
});
