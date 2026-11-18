const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { randomBytes, randomInt } = require('node:crypto');

function modules(api) {
  class Component {
    constructor(props) { this.props = props; }
    setState(update, done) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); done?.(); }
    forceUpdate() {}
  }
  const context = { React: { Component, Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }) }, window: { arra: api }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(require('./support/renderer-bundle')(), context);
  return context.RendererModules;
}

function session(api, overrides = {}) {
  const calls = { clear: 0, dismiss: 0, load: 0, entry: 0, opens: [], notices: [] };
  const { SessionModel } = modules(api);
  const owner = new SessionModel({ bridge: api, canLeave: () => true, clearProtectedData: () => calls.clear++, dismissSelectedOrder: () => calls.dismiss++, loadProtectedData: () => calls.load++, loadEntryTables: () => calls.entry++, openSelectedTable: id => { calls.opens.push(id); return true; }, notify: message => calls.notices.push(message), getLanguage: () => 'en', getDemoStaff: () => [], ...overrides });
  return { owner, calls };
}

test('account owner preserves leading zero PINs and isolates waiter, transfer and direct owner entry', async () => {
  const staff = [{ id: 1, name: 'Sample waiter', hasPin: true }, { id: 2, name: 'Sample transfer', hasPin: true, isTransfer: true }];
  const pins = [String(randomInt(1000)).padStart(4, '0'), String(randomInt(100000)).padStart(6, '0')];
  const selections = [];
  let ownerEntry = false;
  const api = {
    signIn: async () => ownerEntry ? { ok: true, admin: true, name: 'Sample owner' } : { ok: true },
    identifyStaff: async (pin, kind) => { selections.push({ kind, pin }); const index = kind === 'transfer' ? 1 : 0; return pin === pins[index] ? { ok:true,data:staff[index] } : { ok:false }; },
    clearWaiter: async () => ({ ok: true }), signOut: async () => ({ ok: true }),
  };
  const { owner, calls } = session(api);
  owner.setUsername('sample restaurant'); owner.setPassword(randomBytes(18).toString('hex')); await owner.login();
  assert.equal(owner.state.screen, 'waiter'); assert.equal(owner.state.waiter, null); assert.equal(owner.state.pass, '');
  for (let index = 0; index < staff.length; index++) {
    if (index) owner.requestManager(); else owner.requestTable(7);
    assert.equal(owner.state.screen, 'waiter'); assert.equal(owner.accountView().pinDots.length, pins[index].length);
    await owner.submitPin(); assert.equal(owner.state.pin, ''); assert.ok(owner.state.pinFor);
    for (const digit of pins[index]) owner.pinPress(digit);
    await owner.submitPin();
    assert.equal(owner.state.screen, index ? 'transferCorrection' : 'waiter');
    assert.equal(selections.at(-1).pin, pins[index]); assert.equal(owner.state.adminAccess, false);
    await owner.switchWaiter();
  }
  assert.equal(calls.load, 1, 'transfer entry cannot load waiter data');
  await owner.signOut(); ownerEntry = true;
  const previousEntries = calls.entry;
  owner.setUsername('sample owner'); owner.setPassword(randomBytes(18).toString('hex')); await owner.login();
  assert.equal(owner.state.screen, 'admin'); assert.equal(owner.state.adminAccess, true); assert.equal(calls.entry, previousEntries);
});

test('switch hides protected records immediately and blocks entry after a failed clear', async () => {
  let release, success = false;
  const api = { identifyStaff: async () => ({ ok: true, data: {id:1,name:'Sample'} }), clearWaiter: () => new Promise(resolve => { release = resolve; }) };
  const { owner, calls } = session(api);
  owner.state.screen='waiter'; owner.requestTable(1); owner.setPin('1234'); await owner.submitPin();
  for (success of [false, true]) {
    const before = calls.clear, pending = owner.switchWaiter();
    const entries = calls.entry;
    assert.equal(owner.state.screen, 'waiter'); assert.equal(owner.state.waiter, null); assert.equal(owner.state.switching, true); assert.equal(calls.clear, before + 1);
    release({ ok: success }); await pending;
    assert.equal(calls.clear, before + 1); assert.equal(owner.state.switching, false); assert.equal(calls.entry, entries + Number(success));
    if (!success) { assert.match(owner.state.waiterMessage, /Could not clear/); owner.requestTable(1); assert.equal(owner.state.pinFor,null); }
  }
});

test('an old administration callback cannot revoke a newer staff identity', async () => {
  let release;
  let admin = true;
  const api = { signIn: async () => admin ? ({ ok: true, admin: true, name: 'Sample owner' }) : ({ok:true}), adminAccess: () => new Promise(resolve => { release = resolve; }), signOut: async () => ({ ok: true }), identifyStaff: async () => ({ ok: true, data:{id:1,name:'New staff'} }) };
  const { owner, calls } = session(api);
  owner.setUsername('sample owner'); owner.setPassword(randomBytes(18).toString('hex')); await owner.login();
  const checking = owner.refreshAdminAccess(owner.state.identityGeneration);
  await owner.signOut(); admin=false; owner.setUsername('restaurant'); owner.setPassword('sample'); await owner.login(); owner.requestTable(1); owner.setPin('1234'); await owner.submitPin();
  const before = calls.clear;
  release({ ok: true, signedIn: false, selected: false, admin: false });
  assert.equal(await checking, false); assert.equal(owner.state.screen, 'waiter'); assert.equal(owner.state.waiter.name, 'New staff'); assert.equal(calls.clear, before);
});

test('administration runs one discard guard per page return and guards sidebar and sign-out separately', async () => {
  let guards = 0, signOuts = 0, allow = false;
  const { WaiterDemo } = modules({ signOut: async () => { signOuts++; return { ok: true }; } });
  const app = new WaiterDemo();
  Object.assign(app.session.state, { screen: 'admin', adminAccess: true });
  app.administration.navigate('tableConfig');
  const node = app.render().children[0], page = new node.type(node.props);
  page.setState({ access: true }); page.leaveEditor = () => { guards++; return allow; }; node.props.ref(page);
  const back = page.render().children[0];
  back.props.onClick(); assert.equal(guards, 1); assert.equal(app.administration.state.page, 'tableConfig');
  allow = true; back.props.onClick(); assert.equal(guards, 2); assert.equal(app.administration.state.page, 'admin');
  app.administration.navigate('tableConfig'); app.administration.editor = page; allow = false;
  app.administration.navigate('menuConfig'); assert.equal(guards, 3); assert.equal(app.administration.state.page, 'tableConfig');
  await app.session.signOut(); assert.equal(guards, 4); assert.equal(signOuts, 0);
  page.state.busy = true; allow = true; await app.session.signOut(); assert.equal(guards, 4); assert.equal(signOuts, 0);
});

test('root disposal unsubscribes owners and ignores late account and language results', async () => {
  let releaseLogin;
  const languageResults = [];
  const { WaiterDemo } = modules({ signIn: () => new Promise(resolve => { releaseLogin = resolve; }), language: () => new Promise(resolve => languageResults.push(resolve)) });
  const app = new WaiterDemo(); app.componentDidMount();
  app.session.setUsername('sample owner'); app.session.setPassword(randomBytes(18).toString('hex'));
  const login = app.session.login(), language = app.settings.changeLanguage('sq');
  app.componentWillUnmount();
  assert.equal(app.session.listeners.size, 0); assert.equal(app.settings.listeners.size, 0); assert.equal(app.administration.listeners.size, 0);
  releaseLogin({ ok: true, admin: true, name: 'Late owner' }); languageResults.forEach(resolve => resolve({ ok: true, language: 'sq' }));
  await Promise.all([login, language]);
  assert.equal(app.session.state.screen, 'login'); assert.equal(app.session.state.adminAccess, false); assert.equal(app.settings.state.language, 'en');
});

test('a stale language load cannot overwrite a saved choice and a rejected save releases busy state', async () => {
  let releaseLoad, fail = false;
  const { LanguageSettings } = modules();
  const owner = new LanguageSettings({ bridge: { language: request => request.action === 'get' ? new Promise(resolve => { releaseLoad = resolve; }) : fail ? Promise.reject(new Error('Unavailable')) : Promise.resolve({ ok: true, language: request.language }) } });
  const loading = owner.load(); await owner.changeLanguage('sq'); releaseLoad({ ok: true, language: 'en' }); await loading;
  assert.equal(owner.state.language, 'sq'); fail = true; await owner.changeLanguage('en');
  assert.equal(owner.state.language, 'sq'); assert.equal(owner.state.busy, false); assert.equal(owner.state.feedback, 'failed');
});
