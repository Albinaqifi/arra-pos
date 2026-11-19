const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { moduleSource } = require('./support/renderer-bundle');

const source = moduleSource(path.resolve('src/admin/AccountAClosing.js'), 'Screen');
const profile = { model: 'Synergy PF700', port: 'COM3', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 };
const profileReply = { ok: true, data: { profile, hardwareVerified: false } };
const simulationReply = { ok: true, data: { mode: 'offline', result: 'simulated-response', hardwareVerified: false } };

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== 'object') return [];
  return [node, ...node.children.flatMap(descendants)];
}

function fixture(handle, language = 'en', replaceBridgeAfterLoad = false) {
  class Component {
    constructor(props) { this.props = props; }
    setState(update) { Object.assign(this.state, update); }
  }
  const context = {
    React: { Component, Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    window: { arra: { businessDays: handle } }
  };
  vm.runInNewContext(source, context);
  const screen = new context.Screen.AccountAClosing({ language });
  screen.active = true;
  if (replaceBridgeAfterLoad) context.window.arra = { businessDays: () => assert.fail('Used a replacement bridge') };
  return screen;
}

function mountPanel(screen) {
  const panelNode = descendants(screen.render()).find(node => typeof node.type === 'function');
  assert.ok(panelNode, 'allowed Account A screen should include the PF700 panel');
  const panel = new panelNode.type(panelNode.props);
  panel.componentDidMount();
  return panel;
}

const openPanel = panel => panel.render().props.onToggle({ currentTarget: { open: true } });
const button = panel => descendants(panel.render()).find(node => node.type === 'button');
const flush = () => new Promise(setImmediate);

test('profile and simulation use the desktop bridge captured at startup', async () => {
  const requests = [];
  const screen = fixture(async ({ action }) => {
    requests.push(action);
    return action === 'accountAPf700Profile' ? profileReply : simulationReply;
  }, 'en', true);
  screen.setState({ data: { days: [], queue: 'Sample' }, loading: false });
  const panel = mountPanel(screen);
  openPanel(panel);
  await flush();
  await button(panel).props.onClick();
  assert.deepEqual(requests, ['accountAPf700Profile', 'accountAPf700Simulate']);
  assert.equal(panel.state.status, 'passed');
  panel.componentWillUnmount();
});

test('an explicit simulation from the Account A screen reports only simulated status, in the chosen language', async () => {
  const requests = [];
  let finish;
  const screen = fixture(async request => {
    requests.push({ ...request });
    if (request.action === 'accountAList') return { ok: true, data: { days: [], queue: 'Sample' } };
    if (request.action === 'accountAPf700Profile') return profileReply;
    assert.equal(request.action, 'accountAPf700Simulate');
    return new Promise(resolve => { finish = resolve; });
  }, 'sq');
  await screen.load();
  const panel = mountPanel(screen);
  assert.deepEqual(requests, [{ action: 'accountAList' }]);
  openPanel(panel);
  await flush();
  assert.match(JSON.stringify(panel.render()), /COM3 · 9600 baud · 8 bite te dhenash · pa paritet · 1 bit ndalimi/);
  assert.match(JSON.stringify(panel.render()), /Lidhja fizike ende nuk eshte verifikuar/);
  const run = button(panel);
  assert.equal(run.children[0], 'Nis simulimin lokal');
  const first = run.props.onClick();
  run.props.onClick();
  assert.equal(button(panel).props.disabled, true);
  assert.deepEqual(requests, ['accountAList', 'accountAPf700Profile', 'accountAPf700Simulate'].map(action => ({ action })));
  finish(simulationReply);
  await first;
  assert.ok(descendants(panel.render()).some(node => node.props.role === 'status' &&
    node.children[0].includes('pergjigjen e simuluar')));
  panel.componentWillUnmount();
});

test('profile failures can be retried, revocation removes controls, and unmount discards late replies', async () => {
  let answer;
  const screen = fixture(async request => {
    if (request.action === 'accountAList') return { ok: true, data: { days: [], queue: 'Sample' } };
    if (answer instanceof Error) throw answer;
    return answer;
  });
  await screen.load();
  const panel = mountPanel(screen);
  answer = new Error('Unavailable');
  openPanel(panel);
  await flush();
  assert.match(JSON.stringify(panel.render()), /Could not load/);
  answer = profileReply;
  await button(panel).props.onClick();
  answer = { ok: false, denied: true };
  await button(panel).props.onClick();
  assert.match(JSON.stringify(panel.render()), /access.*denied/i);
  assert.equal(button(panel), undefined);
  assert.equal(panel.state.profile, null);
  panel.componentWillUnmount();

  const next = mountPanel(screen);
  let finish;
  answer = new Promise(resolve => { finish = resolve; });
  openPanel(next);
  next.componentWillUnmount();
  next.setState = () => assert.fail('Unmounted screen published a response');
  finish(profileReply);
  await flush();
  assert.equal(next.state.profile, null);
});
