const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { CHANNEL, applicationInfo, registerApplicationInfo } = require('../src/desktop/application-info');

test('the local service accepts only its empty request', () => {
  assert.deepEqual(applicationInfo({}), { ok: true, data: { name: 'Arra POS', mode: 'development' } });
  for (const request of [undefined, null, [], 'info', { extra: true }, Object.create(null)]) {
    assert.deepEqual(applicationInfo(request), { ok: false, error: 'Invalid request' });
  }
});

test('preload and IPC round trip restrict the exposed API and reject untrusted requests', async () => {
  let handler;
  const trusted = {};
  registerApplicationInfo({ handle(channel, fn) { assert.equal(channel, CHANNEL); handler = fn; } }, event => event === trusted);
  let api;
  const ipcRenderer = { invoke(channel, request) {
    assert.equal(channel, CHANNEL);
    // IPC structured-clones arguments into the main process realm.
    return Promise.resolve(handler(trusted, JSON.parse(JSON.stringify(request))));
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/desktop/preload.js'), 'utf8'), {
    require(name) { assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'arra'); api = value; } }, ipcRenderer }; },
  });
  assert.deepEqual(Object.keys(api), ['language', 'testPrinting', 'operationalReports', 'transferCorrection', 'adminSentCorrection', 'businessDays', 'financialVisibility', 'payment', 'bill', 'orderHistory', 'printJobs', 'employeeConfig', 'menuConfig', 'tableConfig', 'getWaiters', 'adminAccess', 'selectWaiter', 'clearWaiter', 'signIn', 'signOut', 'orderItems', 'getApplicationInfo', 'getMenu', 'moveOrder', 'openOrder', 'getTables']);
  assert.deepEqual(JSON.parse(JSON.stringify(await api.getApplicationInfo())), { ok: true, data: { name: 'Arra POS', mode: 'development' } });
  assert.deepEqual(handler({}, {}), { ok: false, error: 'Invalid request' });
  assert.deepEqual(handler(trusted, { unexpected: true }), { ok: false, error: 'Invalid request' });
  ipcRenderer.invoke = () => Promise.reject(new Error('internal detail'));
  assert.deepEqual(JSON.parse(JSON.stringify(await api.getApplicationInfo())), { ok: false, error: 'Application information unavailable' });
  ipcRenderer.invoke = () => Promise.resolve({ ok: true, data: { name: 'bad', mode: 'development' } });
  assert.equal((await api.getApplicationInfo()).ok, false);
});

test('preload forwards only known correction rejection codes and keeps failures uncertain', async () => {
  let api, response;
  const ipcRenderer={invoke: async () => {if (response instanceof Error) throw response; return response;}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/desktop/preload.js'),'utf8'), {require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>api=value},ipcRenderer})});
  const request={itemId:1,quantity:1,reason:'Sample',requestId:'sample'};
  for (const code of ['invalid_input','access_denied','already_billed','unavailable']) {
    response={ok:false,rejected:true,code}; assert.deepEqual(JSON.parse(JSON.stringify(await api.orderItems('correct',1,request))),{ok:false,rejected:true,code});
  }
  response={ok:false,rejected:true,code:'sensitive database detail'}; assert.deepEqual(JSON.parse(JSON.stringify(await api.orderItems('correct',1,request))),{ok:false,rejected:true});
  response={ok:false,rejected:false,code:'access_denied'}; assert.deepEqual(JSON.parse(JSON.stringify(await api.orderItems('correct',1,request))),{ok:false,rejected:false});
  response=new Error('private detail'); const uncertain=await api.orderItems('correct',1,request); assert.equal(uncertain.rejected,undefined); assert.equal(JSON.stringify(uncertain).includes('private detail'),false);
  assert.equal((await api.orderItems('correct',1,{...request,quantity:'bad'})).code,'invalid_input');
});
