const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function setup(api, confirm = () => false, document = {}) {
  class Component { constructor(props) { this.props = props; } setState(patch) { Object.assign(this.state, patch); } }
  const React = { Component, Fragment: 'fragment', createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const ctx = { React, document, window: { confirm, arra: { tableConfig: api } } };
  vm.runInNewContext(require('./support/admin-bundle')() + '\nthis.Config = ArraComponents.TableConfig;', ctx);
  return new ctx.Config({ onBack() {} });
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return text(node.children);
}

test('floor editor validates, retains rejected changes, and refreshes after save', async () => {
  const requests = [];
  let fail = false;
  const areas = [{ id: 1, name: 'Patio', active: 1 }];
  const tables = [{ id: 23, areaId: 1, capacity: 4, active: 1, hasOrder: 1 }];
  const screen = setup(async request => {
    requests.push(request);
    if (request.action === 'list') return { ok: true, data: { areas, tables } };
    return fail ? { ok: false, error: 'Table has an open order' } : { ok: true };
  });
  await screen.load();
  assert.match(text(screen.render()), /Patio/);
  assert.match(text(screen.render()), /Table 23.*Capacity 4.*Open order/);
  screen.editArea(null);
  await screen.save();
  assert.match(screen.state.error, /area name/);
  assert.equal(requests.length, 1);
  screen.setState({ editor: { ...screen.state.editor, name: ' Garden ' } });
  await screen.save();
  assert.equal(requests[1].action, 'area');
  assert.equal(requests[1].name, 'Garden');
  assert.equal(requests[2].action, 'list');
  assert.equal(screen.state.notice, 'Area saved.');
  screen.editTable(tables[0]);
  screen.setState({ editor: { ...screen.state.editor, capacity: '0' } });
  await screen.save();
  assert.match(screen.state.error, /Capacity/);
  assert.equal(requests.length, 3);
  screen.setState({ editor: { ...screen.state.editor, capacity: '6', active: false } });
  fail = true;
  await screen.save();
  assert.equal(screen.state.error, 'Table has an open order');
  assert.equal(screen.state.editor.capacity, '6');
  assert.equal(screen.state.editor.active, false);
  assert.equal(requests[3].id, 23);
  assert.equal(requests[3].create, false);
  assert.equal(screen.state.tables[0].hasOrder, 1);
  fail = false;
  await screen.save();
  assert.equal(requests[5].action, 'list');
  assert.equal(screen.state.notice, 'Table saved.');
});

test('denied access does not render configuration or editing controls', async () => {
  const screen = setup(async () => ({ ok: false, error: 'Access denied' }));
  await screen.load();
  const rendered = text(screen.render());
  assert.match(rendered, /Access denied/);
  assert.doesNotMatch(rendered, /Add area|Add table|Save table/);
});

test('saving locks every editor field until the request completes', async () => {
  let finish;
  const screen = setup(request => request.action === 'list'
    ? Promise.resolve({ ok: true, data: { areas: [{ id: 1, name: 'Patio', active: 1 }], tables: [] } })
    : new Promise(resolve => { finish = resolve; }));
  await screen.load();
  screen.editTable(null);
  screen.setState({ editor: { ...screen.state.editor, id: '4', areaId: '1' } });
  const pending = screen.save();
  const controls = [];
  const visit = node => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'input' || node.type === 'select') controls.push(node);
    visit(node.children);
  };
  visit(screen.render());
  assert.equal(controls.length, 5); // Editor fields and the floor search are locked.
  assert.ok(controls.every(control => control.props.disabled));
  finish({ ok: true });
  await pending;
  assert.equal(screen.state.busy, false);
});

test('duplicate table number gets a clear message even when the list is stale', async () => {
  const screen = setup(async request => request.action === 'list'
    ? { ok: true, data: { areas: [{ id: 1, name: 'Patio', active: 1 }], tables: [] } }
    : { ok: false, error: 'Table number already exists. Choose a different number.' });
  await screen.load();
  screen.editTable(null);
  screen.setState({ editor: { ...screen.state.editor, id: '23', areaId: '1' } });
  await screen.save();
  assert.match(text(screen.render()), /Table number already exists/);
  assert.equal(screen.state.editor.id, '23');
});

test('contextual table editing protects changes and retains the destination', async () => {
  let confirmDiscard = false;
  const requests = [];
  const areas = [{ id: 1, name: 'Patio', active: 1 }, { id: 2, name: 'Garden', active: 1 }];
  const tables = [{ id: 23, areaId: 1, capacity: 4, active: 1 }];
  const screen = setup(async request => { requests.push(request); return request.action === 'list' ? { ok: true, data: { areas, tables } } : { ok: true }; }, () => confirmDiscard);
  await screen.load();
  screen.editTable(null, 1);
  assert.equal(screen.state.editor.areaId, '1');
  screen.setState({ editor: { ...screen.state.editor, id: '24' } });
  screen.editArea(areas[1]);
  assert.equal(screen.state.editor.id, '24');
  screen.closeEditor();
  assert.equal(screen.state.editor.id, '24');
  confirmDiscard = true;
  screen.editTable(tables[0]);
  screen.setState({ editor: { ...screen.state.editor, areaId: '2' } });
  await screen.save();
  assert.equal(requests.at(-2).areaId, 2);
  assert.equal(screen.state.selectedArea, 2);
  assert.equal(screen.state.selectedTable, 23);
});

test('floor search finds tables and retains inactive areas for editing', async () => {
  const screen = setup(async () => ({ ok: true, data: { areas: [{ id: 1, name: 'Patio', active: 0 }, { id: 2, name: 'Garden', active: 1 }], tables: [{ id: 23, areaId: 1, capacity: 4, active: 0 }] } }));
  await screen.load();
  screen.setState({ query: '23' });
  const result = text(screen.render());
  assert.match(result, /Patio.*Table 23/);
  assert.doesNotMatch(result, /Garden/);
  assert.match(result, /Inactive/);
  screen.setState({ query: 'missing' });
  assert.match(text(screen.render()), /No matching areas or tables/);
});

test('selection scrolls to the table before the containing area', () => {
  const queries = [];
  let scrolled = false;
  const screen = setup(async () => ({}), () => false, { querySelector(selector) { queries.push(selector); return selector === '.floor-tables li.floor-selected' ? { scrollIntoView() { scrolled = true; } } : null; } });
  screen.showSelection();
  assert.equal(scrolled, true);
  assert.deepEqual(queries, ['.floor-tables li.floor-selected']);
});

test('uncertain area creation requires a refreshed list before retry and preserves input', async () => {
  let creates = 0, lists = 0, failList = false;
  const screen = setup(async request => {
    if (request.action === 'area') { creates++; throw new Error('connection lost'); }
    lists++;
    if (failList) throw new Error('unavailable');
    return { ok: true, data: { areas: lists > 1 ? [{ id: 1, name: 'Patio', active: 1 }] : [], tables: [] } };
  });
  await screen.load();
  screen.editArea(null);
  screen.setState({ editor: { ...screen.state.editor, name: 'Patio' } });
  await screen.save();
  assert.equal(screen.state.uncertainArea, true);
  await screen.save();
  assert.equal(creates, 1);
  failList = true;
  await screen.refreshUncertainArea();
  assert.equal(screen.state.access, true);
  assert.equal(screen.state.editor.name, 'Patio');
  assert.equal(screen.state.uncertainArea, true);
  failList = false;
  await screen.refreshUncertainArea();
  assert.equal(screen.state.uncertainArea, false);
  assert.equal(screen.state.editor.name, 'Patio');
  assert.equal(screen.state.areas[0].name, 'Patio');
  assert.match(screen.state.error, /Check the refreshed list/);
});
