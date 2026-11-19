const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { moduleSource } = require('./support/renderer-bundle');
const source = moduleSource(path.resolve('src/admin/AccountAClosing.js'), 'Feature');
const nextTurn = () => new Promise(setImmediate);

const day = { id: 7, openedAt: 1, closedAt: 2, status: 'pending', count: 2, total: 150, cash: 70, card: 80 };
function fixture(days, handle, language = 'en') {
  class Component {
    constructor(props) { this.props = props; }
    setState(update) { Object.assign(this.state, update); }
  }
  const requests = [];
  const context = {
    React: { Component, Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    crypto: { randomUUID: () => 'internal-print-retry' },
    window: { confirm: () => true, arra: { async businessDays(req) {
      requests.push({ ...req });
      if (req.action === 'accountAList') return { ok: true, data: { days, queue: 'Sample' } };
      return handle(req);
    } } }
  };
  vm.runInNewContext(source, context);
  const screen = new context.Feature.AccountAClosing({ language });
  screen.componentDidMount();
  // Ignore opt-in settings panels; expand the stateless report controls.
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (node == null || typeof node === 'boolean') return [];
    if (typeof node !== 'object') return [node];
    if (typeof node.type === 'function') return node.type.prototype?.render ? [] : nodes(node.type(node.props));
    return [node, ...node.children.flatMap(nodes)];
  }
  const rendered = () => nodes(screen.render());
  const text = () => rendered().filter(value => typeof value !== 'object').join(' ');
  const button = label => rendered().find(node => node.type === 'button' && node.children[0] === label);
  return { screen, requests, text, button };
}

test('physical Z requires a separate confirmation for the selected mode and day, then shows the acknowledged number once', async () => {
  const days = [{ ...day, fiscal: { mode: 'device', status: 'ready' } }];
  let finish;
  const { screen, requests, text, button } = fixture(days, () => new Promise(resolve => { finish = resolve; }));
  await nextTurn();
  assert.match(text(), /Payments 2 Total 150 Cash 70 Card 80 Account A payments recorded in Arra · MKD/);
  assert.equal(button('Issue official Z report'), undefined);
  button('Review official Z report').props.onClick();
  const cancelled = button('Issue official Z report');
  assert.match(text(), /business day #7.*closes the fiscal day.*cannot be undone/);
  assert.equal(button('Cancel').props.autoFocus, true);
  button('Cancel').props.onClick();
  await cancelled.props.onClick();
  assert.deepEqual(requests, [{ action: 'accountAList' }]);
  button('Review official Z report').props.onClick();
  const submit = button('Issue official Z report');
  const first = submit.props.onClick();
  await submit.props.onClick();
  assert.equal(button('Issue official Z report'), undefined);
  assert.match(text(), /Requesting the official Z report/);
  days[0] = { ...day, status: 'complete', accountClosedAt: 3, closedBy: 4,
    fiscal: { mode: 'device', status: 'complete', reportNumber: '0042' } };
  finish({ ok: true });
  await first;
  assert.match(text(), /PF700 acknowledged official Z report #0042/);
  assert.doesNotMatch(text(), /Retry report after checking printer|Review official Z report|SIM-Z/);
  await submit.props.onClick();
  assert.deepEqual(requests, [
    { action: 'accountAList' }, { action: 'accountAFiscalClose', dayId: 7, mode: 'device', confirmed: true }, { action: 'accountAList' }
  ]);
  screen.componentWillUnmount();
});

test('uncertain outcomes offer only an explicit read-only check, including after reopening', async () => {
  const days = [{ ...day, fiscal: { mode: 'device', status: 'ready' } }];
  const first = fixture(days, () => {
    days[0].fiscal = { mode: 'device', status: 'uncertain', canReconcile: true };
    throw Error('Lost reply');
  });
  await nextTurn();
  first.button('Review official Z report').props.onClick();
  await first.button('Issue official Z report').props.onClick();
  assert.match(first.text(), /may have issued the report/);
  assert.doesNotMatch(first.text(), /Review official Z report|Retry report after checking printer/);
  assert.deepEqual(first.requests.map(r => r.action), ['accountAList', 'accountAFiscalClose', 'accountAList']);
  first.screen.componentWillUnmount();
  const next = fixture(days, () => {
    days[0] = { ...day, status: 'complete', accountClosedAt: 3, closedBy: 4,
      fiscal: { mode: 'device', status: 'complete', reportNumber: '0042' } };
    return { ok: true };
  });
  await nextTurn();
  const check = next.button('Check PF700 report status (read only)');
  assert.ok(check);
  assert.deepEqual(next.requests, [{ action: 'accountAList' }]);
  await check.props.onClick();
  assert.deepEqual(next.requests[1], { action: 'accountAFiscalReconcile', dayId: 7, mode: 'device' });
  assert.match(next.text(), /acknowledged official Z report #0042/);
  assert.equal(next.button('Check PF700 report status (read only)'), undefined);
  next.screen.componentWillUnmount();
});

test('Albanian simulation is identified throughout and cannot authorize a different mode on refresh', async () => {
  const days = [{ ...day, fiscal: { mode: 'simulation', status: 'ready' } }];
  const { screen, requests, text, button } = fixture(days, () => {
    days[0] = { ...day, status: 'complete', accountClosedAt: 3, closedBy: 4,
      fiscal: { mode: 'simulation', status: 'complete', reportNumber: '0001' } };
    return { ok: true };
  }, 'sq');
  await nextTurn();
  button('Shqyrto raportin Z te simuluar').props.onClick();
  assert.match(text(), /Printeri fizik nuk perdoret/);
  const stale = button('Simulo raportin Z');
  days[0].fiscal = { mode: 'device', status: 'ready' };
  await screen.load();
  await stale.props.onClick();
  assert.deepEqual(requests.map(r => r.action), ['accountAList', 'accountAList']);
  days[0].fiscal = { mode: 'simulation', status: 'ready' };
  await screen.load();
  button('Shqyrto raportin Z te simuluar').props.onClick();
  await button('Simulo raportin Z').props.onClick();
  assert.deepEqual(requests.at(-2), { action: 'accountAFiscalClose', dayId: 7, mode: 'simulation', confirmed: true });
  assert.match(text(), /Raporti i simuluar SIM-Z-0001 u regjistrua/);
  assert.doesNotMatch(text(), /PF700 konfirmoi/);
  screen.componentWillUnmount();
});

test('blocked, pending and unavailable reconciliation keep close controls hidden and preserve legacy internal reprints', async () => {
  const days = [
    { ...day, fiscal: { mode: 'device', status: 'blocked', reason: 'coverage' } },
    { ...day, id: 8, fiscal: { mode: 'simulation', status: 'pending' } },
    { ...day, id: 9, fiscal: { mode: 'device', status: 'uncertain', canReconcile: false } },
    { ...day, id: 10, status: 'complete', accountClosedAt: 3, closedBy: 4, printAttempts: 1, printResult: 'failed' }
  ];
  const { screen, requests, text, button } = fixture(days, () => assert.fail('Unexpected fiscal action'));
  await nextTurn();
  assert.match(text(), /corrections.*registered PF700 receipts/);
  assert.match(text(), /request is in progress/);
  assert.equal(button('Review official Z report'), undefined);
  assert.equal(button('Check PF700 report status (read only)'), undefined);
  assert.ok(button('Retry report after checking printer'));
  assert.deepEqual(requests, [{ action: 'accountAList' }]);
  screen.componentWillUnmount();
});

test('an internally closed fiscal day retains its historical queue retry independently of fiscal recovery', async () => {
  const days = [{ ...day, status: 'complete', accountClosedAt: 3, closedBy: 4, printAttempts: 1, printResult: 'uncertain',
    fiscal: { mode: 'device', status: 'uncertain', canReconcile: true } }];
  const { screen, requests, text, button } = fixture(days, () => ({ ok: true }));
  await nextTurn();
  assert.match(text(), /Internal Account A close complete/);
  assert.match(text(), /Non-fiscal Account A report.*Print result is uncertain/);
  assert.ok(button('Check PF700 report status (read only)'));
  await button('Retry non-fiscal report after checking printer').props.onClick();
  assert.deepEqual(requests, [{ action: 'accountAList' },
    { action: 'accountARetry', dayId: 7, requestId: 'internal-print-retry', checked: true }, { action: 'accountAList' }]);
  assert.ok(button('Check PF700 report status (read only)'));
  screen.componentWillUnmount();
});

test('read-only proof of no issuance requires a new confirmation bound to the latest cleared attempt', async () => {
  const days = [{ ...day, fiscal: { mode: 'device', status: 'uncertain', canReconcile: true } }];
  const { screen, requests, text, button } = fixture(days, req => {
    if (req.action === 'accountAFiscalReconcile') {
      days[0] = { ...day, fiscal: { mode: 'device', status: 'ready', retryAfter: 12 } };
      return { ok: true, outcome: 'not-issued' };
    }
    days[0] = { ...day, status: 'complete', fiscal: { mode: 'device', status: 'complete', reportNumber: '0043' } };
    return { ok: true };
  });
  await nextTurn();
  await button('Check PF700 report status (read only)').props.onClick();
  assert.match(text(), /status check confirmed that no report was issued/);
  assert.equal(button('Issue official Z report'), undefined);
  button('Review official Z report').props.onClick();
  const stale = button('Issue official Z report');
  days[0] = { ...day, fiscal: { mode: 'device', status: 'ready', retryAfter: 13 } };
  await stale.props.onClick();
  assert.equal(button('Issue official Z report'), undefined);
  button('Review official Z report').props.onClick();
  await stale.props.onClick();
  assert.deepEqual(requests.map(r => r.action), ['accountAList', 'accountAFiscalReconcile', 'accountAList']);
  await button('Issue official Z report').props.onClick();
  assert.deepEqual(requests.at(-2), { action: 'accountAFiscalClose', dayId: 7, mode: 'device', confirmed: true, retryAfter: 13 });
  screen.componentWillUnmount();
});
