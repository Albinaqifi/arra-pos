const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function make(api, timers = { setTimeout, clearTimeout }, confirm = () => true) {
  class Component {
    constructor(props) { this.props = props; }
    setState(patch) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); }
  }
  const React = { Component, Fragment: 'fragment', createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const context = { React, window: { arra: api, confirm, ...timers }, crypto: { randomUUID: () => 'recovery-token' }, ...timers };
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  return context.ArraComponents;
}
function expand(node) {
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function' && !node.type.prototype?.render) return expand(node.type(node.props));
  return { ...node, children: (node.children || []).flat().map(expand) };
}
function all(node) {
  return !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flat().flatMap(all)];
}
function visible(node) {
  if (!node || typeof node !== 'object') return [];
  const children = (node.children || []).flat();
  const shown = node.type === 'details' && !node.props.open ? children.filter(child => child && child.type === 'summary') : children;
  return [node, ...shown.flatMap(visible)];
}
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return node && typeof node === 'object' ? (node.children || []).flat().map(text).join(' ') : '';
}
const issues = { orders: [], printJobs: [] };
function fixture() {
  return { scope: 'combined', queue: 'sample', issues, days: [
    { id: 4, openedAt: 4000, closedAt: null },
    { id: 3, openedAt: 3000, closedAt: 4000, closedBy: 1, issues, reportId: 3, printAttempts: 1, printResult: 'failed', otherPrints: [{ scope: 'A', printAttempts: 2, printResult: 'failed' }, { scope: 'B', printAttempts: 1, printResult: 'accepted' }] },
    { id: 2, openedAt: 2000, closedAt: 3000, closedBy: 1, issues, reportId: 2, printAttempts: 0, printResult: null, otherPrints: [{ scope: 'B', printAttempts: 1, printResult: 'uncertain' }] },
  ] };
}
test('failed and uncertain reports and current-day close are immediately visible', async () => {
  const calls = [], data = fixture();
  const c = make({ businessDays: async request => { calls.push(request); return { ok: true, data }; }, financialVisibility: async () => ({ ok: true, data: { groups: [] } }) }, undefined, () => { throw Error('warning action must not open another confirmation'); });
  const screen = new c.BusinessDays({});
  await screen.load();
  const tree = expand(screen.render());
  const visibleNodes = visible(tree);
  const buttons = visibleNodes.filter(node => node.type === 'button');
  const recovery = visibleNodes.filter(node => node.props?.className === 'day-recovery-report');
  assert.equal(recovery.length, 3, 'show one warning per unresolved report');
  for (const warning of recovery) {
    assert.equal(warning.props.role, 'alert');
    assert.match(text(warning), /report for day #\d+ may not have printed/i);
    assert.match(text(warning), /print again after checking printer/i);
  }
  assert.ok(buttons.some(button => /Review and close day/i.test(text(button))), 'current day remains available');
  const more = all(tree).find(node => node.type === 'details' && /More options/i.test(text((node.children || [])[0])));
  assert.ok(more && !more.props.open, 'settings and history remain collapsed');
  const first = recovery.find(card => /day #3/i.test(text(card)) && /Combined report/i.test(text(card)));
  assert.ok(first);
  await all(first).find(button => button.type === 'button').props.onClick();
  const retry = calls.find(request => request.action === 'retry');
  assert.equal(retry.dayId, 3);
  assert.equal(retry.scope, undefined);
  assert.equal(retry.checked, true);
  screen.componentWillUnmount();
});

test('each additional unresolved report retries its own day and scope', async () => {
  const calls = [], data = fixture();
  const c = make({ businessDays: async request => { calls.push(request); return { ok: true, data }; }, financialVisibility: async () => ({ ok: true, data: { groups: [] } }) });
  const screen = new c.BusinessDays({});
  await screen.load();
  const tree = expand(screen.render());
  const day2 = visible(tree).find(node => node.props?.className?.split(' ').includes('day-recovery-report') && /day #2/i.test(text(node)));
  assert.ok(day2);
  const button = all(day2).find(node => node.type === 'button' && /Print again after checking printer/i.test(text(node)));
  assert.ok(button);
  await button.props.onClick();
  const retry = calls.find(request => request.action === 'retry');
  assert.equal(retry.dayId, 2);
  assert.equal(retry.scope, 'B');
  screen.componentWillUnmount();
});

test('background status checks update a report without showing a false paper confirmation, and stop on unmount', async () => {
  const scheduled = new Map(); let nextId = 0, listCalls = 0;
  const timers = {
    setTimeout: callback => { const id = ++nextId; scheduled.set(id, callback); return id; },
    clearTimeout: id => scheduled.delete(id),
  };
  const data = fixture();
  const c = make({ businessDays: async request => {
    if (request.action === 'list') listCalls++;
    return { ok: true, data };
  }, financialVisibility: async () => ({ ok: true, data: { groups: [] } }) }, timers);
  const screen = new c.BusinessDays({});
  screen.componentDidMount();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(listCalls, 1);
  data.days[1].printResult = 'accepted';
  data.days[1].otherPrints = [];
  data.days[2].otherPrints = [];
  const first = scheduled.entries().next().value;
  assert.ok(first, 'mount schedules a status check');
  scheduled.delete(first[0]);
  await first[1]();
  const rendered = text(expand(screen.render()));
  assert.match(rendered, /check the paper/i);
  assert.doesNotMatch(rendered, /successfully printed/i);
  assert.equal(listCalls, 2);
  assert.equal(scheduled.size, 1);
  screen.componentWillUnmount();
  assert.equal(scheduled.size, 0, 'unmount cancels the next status check');
});

function fakeTimers() {
  const scheduled = new Map(); let next = 0;
  return {
    scheduled,
    timers: {
      setTimeout: callback => { const id = ++next; scheduled.set(id, callback); return id; },
      clearTimeout: id => scheduled.delete(id),
    },
    fire() { const [id, fn] = scheduled.entries().next().value; scheduled.delete(id); return fn(); },
  };
}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
test('a delayed status check cannot replace a newer close review', async () => {
  const clock = fakeTimers(), initial = fixture(), reviewed = structuredClone(initial);
  reviewed.issues.orders = [{ id: 55, tableId: 8 }];
  let listCount = 0, finishPoll;
  const c = make({ businessDays: async () => {
    listCount++;
    if (listCount === 2) return new Promise(resolve => { finishPoll = resolve; });
    return { ok: true, data: listCount >= 3 ? reviewed : initial };
  }, financialVisibility: async () => ({ ok: true, data: { groups: [] } }) }, clock.timers);
  const screen = new c.BusinessDays({});
  screen.componentDidMount(); await nextTurn();
  const pending = clock.fire(); await nextTurn();
  await screen.review(4);
  finishPoll({ ok: true, data: initial }); await pending;
  assert.equal(screen.state.data.issues.orders[0].id, 55);
  assert.equal(screen.state.confirmId, 4);
  screen.componentWillUnmount();
});

test('a status check that sees a new open day reloads its turnover', async () => {
  const clock = fakeTimers(), initial = fixture(), newer = structuredClone(initial);
  newer.days[0].closedAt = 5000;
  newer.days.unshift({ id: 5, openedAt: 5000, closedAt: null });
  let lists = 0; const reported = [];
  const c = make({ businessDays: async () => ({ ok: true, data: ++lists === 1 ? initial : newer }),
    financialVisibility: async request => { reported.push(request.dayId); return { ok: true, data: { groups: [{ total: request.dayId === 5 ? 50 : 300 }] } }; }
  }, clock.timers);
  const screen = new c.BusinessDays({});
  screen.componentDidMount(); await nextTurn();
  await clock.fire();
  assert.deepEqual(reported, [4, 5]);
  assert.equal(screen.state.data.days[0].id, 5);
  assert.equal(screen.state.turnover.groups[0].total, 50);
  screen.componentWillUnmount();
});

test('restarting polling invalidates an in-flight status response and keeps only the new schedule', async () => {
  const clock = fakeTimers(), initial = fixture(), stale = structuredClone(initial);
  stale.days[1].printResult = 'accepted';
  let lists = 0, finishPoll;
  const c = make({ businessDays: async () => {
    if (++lists === 2) return new Promise(resolve => { finishPoll = resolve; });
    return { ok: true, data: initial };
  }, financialVisibility: async () => ({ ok: true, data: { groups: [] } }) }, clock.timers);
  const screen = new c.BusinessDays({});
  screen.componentDidMount(); await nextTurn();
  const pending = clock.fire(); await nextTurn();
  screen.pollReports();
  assert.equal(clock.scheduled.size, 1);
  finishPoll({ ok: true, data: stale }); await pending;
  assert.equal(screen.state.data.days[1].printResult, 'failed');
  assert.equal(clock.scheduled.size, 1);
  screen.componentWillUnmount();
  assert.equal(clock.scheduled.size, 0);
});

test('an active print has no retry until its outcome becomes uncertain', async () => {
  const data = fixture();
  data.days[1].printResult = 'pending';
  data.days[1].otherPrints = [];
  data.days[2].otherPrints = [];
  const c = make({ businessDays: async () => ({ ok: true, data }), financialVisibility: async () => ({ ok: true, data: { groups: [] } }) });
  const screen = new c.BusinessDays({});
  await screen.load();
  let tree = expand(screen.render());
  const sending = visible(tree).find(node => node.props?.className === 'day-report-pending');
  assert.match(text(sending), /Sending report for day #3/i);
  assert.equal(all(sending).filter(node => node.type === 'button').length, 0);
  data.days[1].printResult = 'uncertain';
  await screen.load();
  tree = expand(screen.render());
  assert.match(text(tree), /report for day #3 may not have printed/i);
  const buttons = visible(tree).filter(node => node.type === 'button');
  assert.ok(buttons.some(button => /Print again after checking printer/i.test(text(button))));
  screen.componentWillUnmount();
});

test('an in-flight report disables other retries for the same day without blocking another day', async () => {
  const data = fixture();
  data.days[1].printResult = 'pending';
  const c = make({ businessDays: async () => ({ ok: true, data }), financialVisibility: async () => ({ ok: true, data: { groups: [] } }) });
  const screen = new c.BusinessDays({});
  await screen.load();
  const tree = expand(screen.render());
  const reports = all(tree).filter(node => node.props?.className === 'day-recovery-report');
  const a = reports.find(node => /day #3/i.test(text(node)) && /Account A/.test(text(node)));
  const b = reports.find(node => /day #2/i.test(text(node)) && /Account B/.test(text(node)));
  assert.match(text(a), /Another report for this day is being sent/i);
  assert.equal(all(a).filter(node => node.type === 'button').length, 0);
  assert.equal(all(b).filter(node => node.type === 'button').length, 1);
  screen.componentWillUnmount();
});

test('an accepted retry of an older scoped report confirms its identity while another failure remains', async () => {
  const data = fixture(), calls = [];
  const c = make({ businessDays: async request => {
    calls.push(request);
    if (request.action === 'retry') data.days[2].otherPrints[0].printResult = 'accepted';
    return { ok: true, data };
  }, financialVisibility: async () => ({ ok: true, data: { groups: [] } }) });
  const screen = new c.BusinessDays({});
  await screen.load();
  const oldReport = all(expand(screen.render())).find(node => node.props?.className === 'day-recovery-report' && /day #2/i.test(text(node)));
  await all(oldReport).find(node => node.type === 'button').props.onClick();
  const tree = expand(screen.render());
  const notice = all(tree).find(node => node.props?.className === 'day-print-notice' && /Day #2/.test(text(node)));
  assert.ok(notice);
  assert.match(text(notice), /Account B report/);
  assert.match(text(notice), /Check the paper/);
  assert.match(text(tree), /day #3/i);
  assert.equal(calls.find(request => request.action === 'retry').scope, 'B');
  screen.componentWillUnmount();
});

test('a restricted owner is asked to wait while an anonymous report for the same day is sending', async () => {
  const data = fixture();
  data.scope = 'A';
  data.days[1].reportSending = true;
  data.days[1].otherPrints = [];
  data.days[2].otherPrints = [];
  const c = make({ businessDays: async () => ({ ok: true, data }), financialVisibility: async () => ({ ok: true, data: { groups: [] } }) });
  const screen = new c.BusinessDays({});
  await screen.load();
  const tree = expand(screen.render());
  const report = all(tree).find(node => node.props?.className === 'day-recovery-report');
  assert.match(text(report), /Another report for this day is being sent. Please wait/i);
  assert.equal(all(report).filter(node => node.type === 'button').length, 0);
  assert.doesNotMatch(text(report), /Account B|Combined report/i);
  screen.componentWillUnmount();
});

test('latest accepted report still asks for a paper check when an older report needs attention', async () => {
  const data = fixture();
  data.days[1].printResult = 'accepted';
  data.days[1].otherPrints = [];
  const c = make({ businessDays: async () => ({ ok: true, data }), financialVisibility: async () => ({ ok: true, data: { groups: [] } }) });
  const screen = new c.BusinessDays({});
  await screen.load();
  const tree = expand(screen.render());
  const notice = all(tree).find(node => node.props?.className === 'day-print-notice' && /Day #3/.test(text(node)));
  assert.ok(notice);
  assert.match(text(notice), /Check the paper/i);
  assert.ok(all(tree).some(node => node.props?.className === 'day-recovery-report' && /day #2/i.test(text(node))));
  screen.componentWillUnmount();
});
