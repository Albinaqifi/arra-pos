const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {openDatabase} = require('../src/desktop/database');
const {seedMenu} = require('../src/desktop/menu');
const {registerMenuConfig} = require('../src/desktop/menu-config');
const {registerOrderItems} = require('../src/desktop/order-items');
test('modifier configuration, direct validation and snapshots survive changes and restart', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-mod-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let db=openDatabase(dir), current=1, config, items; const trusted={};
 db.exec("INSERT INTO local_users (id,username,salt,password_hash) VALUES (1,'admin',x'00',x'00'),(2,'waiter',x'00',x'00'); INSERT INTO financial_scopes SELECT id, 'waiter' FROM local_users; INSERT INTO user_permissions VALUES (1,'menu.change'),(1,'orders.view'),(1,'orders.change'),(2,'orders.view'),(2,'orders.change'); INSERT INTO dining_areas (id,name) VALUES (1,'A'); INSERT INTO dining_tables (id,area,area_id) VALUES (1,'A',1); INSERT INTO orders(id,table_id,opened_at,status) VALUES (1,1,1,'open');"); seedMenu(db);
 const register=()=>{const ipc={handle(c,f){if(c==='arra:menu-config') config=f; else items=f;}}; const sess={currentUserId: () => current, authenticatedUserId: () => current}; registerMenuConfig(ipc,e=>e===trusted,db,sess); registerOrderItems(ipc,e=>e===trusted,db,sess);}; register();
 const group={action:'group',id:null,productId:'qebapa',name:'Size',required:true,active:true}; current=2; assert.equal(config(trusted,group).ok,false); current=1; assert.equal(config(trusted,group).ok,true);
 const g=config(trusted,{action:'list'}).data.groups[0]; const opt={action:'option',id:null,groupId:g.id,name:'Large',adjustment:30,active:true}; assert.equal(config(trusted,opt).ok,true); assert.equal(config(trusted,{...opt,name:'Small',adjustment:-20}).ok,true);
 const options=config(trusted,{action:'list'}).data.options; const add=optionIds=>items(trusted,{action:'add',orderId:1,productId:'qebapa',optionIds});
 assert.equal(add([]).ok,false); assert.equal(add(['missing']).ok,false); assert.equal(add([options[0].id,options[0].id]).ok,false); assert.equal(add(options.map(x=>x.id)).ok,false);
 const result=add([options[0].id]); assert.equal(result.ok,true); assert.equal(result.data.total,250); assert.deepEqual({...result.data.items[0].modifiers[0]}, {groupName:'Size',optionName:'Large',adjustment:30});
 assert.equal(config(trusted,{...opt,id:options[0].id,name:'Changed',adjustment:99,active:false}).ok,true); assert.equal(add([options[0].id]).ok,false);
 db.close(); db=openDatabase(dir); register(); const restored=items(trusted,{action:'list',orderId:1}).data; assert.equal(restored.total,250); assert.equal(restored.items[0].modifiers[0].optionName,'Large'); assert.equal(items(trusted,{action:'remove',orderId:1,itemId:restored.items[0].id}).ok,true); db.close();
});
