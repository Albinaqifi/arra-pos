const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { routeOf } = require('./support/renderer-fixture');

function harness(overrides = {}) {
  const calls = [], entry = [{id:1,area:'Inside',occupied:true},{id:2,area:'Inside',occupied:false}];
  const api = {
    signIn: async () => ({ok:true,admin:false}), signOut: async () => ({ok:true}),
    getEntryTables: async () => ({ok:true,data:entry}), clearWaiter: async () => ({ok:true}),
    identifyStaff: async (pin, kind) => { calls.push([pin,kind]); return {ok:true,data:{id:5,name:kind === 'transfer' ? 'Manager' : 'Waiter',isTransfer:kind === 'transfer'}}; },
    getMenu: async () => ({ok:true,data:{categories:[],products:[]}}),
    getTables: async () => ({ok:true,data:entry.map(t=>({...t,orderId:null,openedAt:null,untouched:false}))}),
    openOrder: async id => ({ok:true,data:{id:10+id,openedAt:1,untouched:false}}),
    orderItems: async () => ({ok:true,data:{items:[]}}), ...overrides,
  };
  class Component { constructor(props) { this.props=props; } setState(update) { Object.assign(this.state, update); } forceUpdate() {} }
  const context = {React:{Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})}, ReactDOM:{createRoot:()=>({render(){}})},window:{arra:api},document:{getElementById(){}},crypto:{randomUUID:()=> 'token'},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.App=WaiterDemo;',context);
  const app=new context.App(); app.componentDidMount();
  return {app,api,calls,context};
}
async function login(app) { app.session.setUsername('restaurant'); app.session.setPassword('sample'); await app.session.login(); }
async function enter(app, id, pin='0123') { app.session.requestTable(id); app.session.setPin(pin); await app.session.submitPin(); }
const tick = () => new Promise(resolve=>setImmediate(resolve));

test('restaurant grid is redacted and each table selection requires a PIN', async () => {
  const {app,calls}=harness(); await login(app);
  assert.equal(routeOf(app),'tables'); assert.equal(app.session.state.waiter,null);
  const view=app.tableOrders.tableView({language:'en',entry:true,openTable:id=>app.session.requestTable(id)});
  assert.equal(view.sections[0].tables[0].total,''); assert.equal(view.sections[0].tables[0].waiter,'');
  assert.equal(view.sections[0].tables[0].aria,'Table 1, taken'); assert.equal(view.sections[0].tables[1].aria,'Table 2, free');
  const shqip=app.tableOrders.tableView({language:'sq',entry:true,openTable:id=>app.session.requestTable(id)});
  assert.equal(shqip.sections[0].tables[0].aria,'Tavolina 1, e zënë'); assert.equal(shqip.sections[0].tables[1].aria,'Tavolina 2, e lirë');
  view.sections[0].tables[1].open(); assert.equal(app.session.state.pinFor.tableId,2); assert.equal(app.session.state.waiter,null);
  app.session.setPin('0123'); await app.session.submitPin();
  assert.deepEqual(calls,[['0123','waiter']]); assert.equal(routeOf(app),'order'); assert.equal(app.tableOrders.state.tableId,2);
  await app.tableOrders.showTables(); assert.equal(routeOf(app),'tables'); assert.equal(app.session.state.waiter,null);
  app.session.requestTable(2); assert.equal(app.session.state.pin,''); assert.equal(app.session.state.pinFor.tableId,2);
});

test('Manager uses its own six-digit PIN and never opens a table', async () => {
  let opens=0;
  const {app,calls}=harness({openOrder:async()=>{opens++;return {ok:false};}}); await login(app);
  app.session.requestManager(); app.session.setPin('001234'); await app.session.submitPin();
  assert.deepEqual(calls,[['001234','transfer']]); assert.equal(app.session.state.screen,'transferCorrection'); assert.equal(opens,0);
  await app.session.switchWaiter(); assert.equal(routeOf(app),'tables'); assert.equal(app.session.state.waiter,null);
});

test('denied table and uncertain identity response clear staff before returning to grid', async () => {
  let clear=0, entries=0;
  const {app}=harness({openOrder:async()=>({ok:false,code:'table_unavailable'}),clearWaiter:async()=>{clear++;return {ok:true};},getEntryTables:async()=>{entries++;return {ok:true,data:[]};}});
  await login(app); await enter(app,1); assert.equal(clear,1); assert.equal(entries,2); assert.equal(app.session.state.waiter,null); assert.equal(routeOf(app),'tables');
  assert.match(app.session.state.waiterMessage,/denied/i);
  app.session.requestTable(1); assert.ok(app.session.state.pinFor);
});

test('failed identity clearing blocks entry and offers retry', async () => {
  let clear=0, selects=0;
  const {app}=harness({identifyStaff:async()=>{selects++;return {ok:false};},clearWaiter:async()=>({ok:++clear>1})});
  await login(app); await enter(app,1); assert.equal(app.session.state.recoveryRequired,true);
  app.session.requestManager(); app.session.requestTable(1); assert.equal(app.session.state.pinFor,null); assert.equal(selects,1);
  await app.session.switchWaiter(); assert.equal(app.session.state.recoveryRequired,false); app.session.requestTable(1); assert.ok(app.session.state.pinFor);
});

test('pending sign-out excludes PIN selection and failed sign-out stays recoverable', async () => {
  let resolveSignOut, selects=0;
  const {app}=harness({signOut:()=>new Promise(resolve=>{resolveSignOut=resolve;}),identifyStaff:async()=>{selects++;return {ok:false};}});
  await login(app); const pending=app.session.signOut(); await tick();
  app.session.requestTable(1); app.session.requestManager(); app.session.setPin('0123'); await app.session.submitPin();
  assert.equal(selects,0); assert.equal(app.session.state.pinFor,null);
  resolveSignOut({ok:false}); await pending; assert.equal(app.session.state.recoveryRequired,true); assert.equal(routeOf(app),'tables');
});

test('PIN dialog supports keyboard input, escape and English/Albanian labels', async () => {
  const {app,context}=harness(); await login(app);
  const walk = node => Array.isArray(node) ? node.flatMap(walk) : !node || typeof node !== 'object' ? [] : [node,...(node.children || []).flatMap(walk)];
  for (const [language, title, manager] of [['en','Table 1','Manager'],['sq','Tavolina 1','Menaxheri']]) {
    let restored=0; context.document.activeElement={focus(){restored++;}};
    app.settings._set({language}); app.session.requestTable(1);
    let nodes=walk(app.render()), dialog=nodes.find(node=>node.props?.role==='dialog');
    assert.ok(dialog); assert.ok(walk(dialog).some(node=>node.children?.includes(title)));
    const input=walk(dialog).find(node=>node.type==='input'); assert.equal(input.props.type,'password'); assert.equal(input.props.autoFocus,true);
    input.props.onChange({target:{value:'0012'}}); assert.equal(app.session.state.pin,'0012');
    app.session.setPin('01'); await app.session.submitPin(); dialog=walk(app.render()).find(node=>node.props?.role==='dialog');
    assert.ok(walk(dialog).some(node=>node.props?.role==='alert' && node.children.length));
    dialog.props.onKeyDown({key:'Escape',preventDefault(){}}); assert.equal(app.session.state.pinFor,null); assert.equal(app.session.state.pin,''); assert.equal(restored,1);
    nodes=walk(app.render()); assert.ok(nodes.some(node=>node.type==='button' && node.children.includes(manager)));
  }
});

test('demo opening an untouched table does not create an order', async () => {
  const {app}=harness();
  app.tableOrders.bridge = undefined; app.session.bridge = undefined;
  await login(app); await enter(app,2);
  assert.equal(routeOf(app),'order'); assert.equal(app.tableOrders.state.orders[2],undefined);
});

test('demo corrected order is retained separately when another waiter opens the free table', async () => {
  const {app}=harness(); app.tableOrders.bridge=undefined; app.session.bridge=undefined;
  const old={id:'old',openedBy:'Other',log:[{text:'Correction saved'}]}, item={id:'item',tableId:2,qty:1,cxQty:1,status:'sent',cx:[{reason:'mistake'}]};
  app.tableOrders._set({orders:{2:old},items:[item]});
  await login(app); await enter(app,2);
  assert.equal(routeOf(app),'order'); assert.equal(app.tableOrders.state.orders[2],undefined); assert.equal(app.tableOrders.state.items.length,0);
  assert.equal(app.tableOrders.retiredDemoOrders.length,1); assert.equal(app.tableOrders.retiredDemoOrders[0].order.log[0].text,'Correction saved');
  assert.equal(app.tableOrders.retiredDemoOrders[0].items[0].cx[0].reason,'mistake');
});
