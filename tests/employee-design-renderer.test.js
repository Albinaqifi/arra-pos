const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { TextEncoder } = require('node:util');
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of (node.children || []).flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
  return null;
}
function setup() {
  class Component { constructor(props) { this.props = props; } setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } }
  const calls = [];
  const data = { users: [{ id: 1, username: 'Sample', active: 1, hasPin: 0 }], grants: [], audit: [], credentialAudit: [], accountAudit: [], permissions: [] };
  const context = { React: { Component, createElement(type, props, ...children) { return { type, props: props || {}, children }; } }, TextEncoder, window: { confirm: () => true, arra: { employeeConfig: async request => { calls.push(request); return { ok: true, data }; } } } };
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  const page = new context.ArraComponents.EmployeeConfig({});
  Object.assign(page.state, data, { access: true, creating: true, selected: 1 });
  return { page, calls };
}
function formWith(tree, name) { return find(tree, n => n.type === 'form' && find(n, x => x.type === 'input' && x.props.name === name)); }
function submit(form, elements) { form.props.onSubmit({ preventDefault() {}, currentTarget: { elements, reset() { for (const value of Object.values(elements)) if ('value' in value) value.value = ''; } } }); }

test('employee creation validates names and UTF-8 passwords without retaining credentials', () => {
  const { page, calls } = setup();
  const elements = { username: { value: ' Sample ' }, password: { value: 'secret' }, pin: { value: '1234' } };
  submit(formWith(page.render(), 'username'), elements);
  assert.match(page.state.error, /leading or trailing spaces/);
  assert.equal(elements.username.value, ' Sample ');
  assert.equal(elements.password.value, ''); assert.equal(elements.pin.value, ''); assert.equal(calls.length, 0);
  elements.username.value = 'Sample'; elements.password.value = 'é'.repeat(513); elements.pin.value = '1234';
  submit(formWith(page.render(), 'username'), elements);
  assert.match(page.state.error, /1024 UTF-8 bytes/);
  assert.equal(elements.username.value, 'Sample'); assert.equal(elements.password.value, ''); assert.equal(elements.pin.value, ''); assert.equal(calls.length, 0);
});

test('credential reset rejects oversized passwords and clears secret fields', () => {
  const { page, calls } = setup();
  const elements = { password: { value: 'é'.repeat(513) }, pin: { value: '1234' }, removePin: { checked: false } };
  submit(formWith(page.render(), 'removePin'), elements);
  assert.match(page.state.error, /1024 UTF-8 bytes/);
  assert.equal(elements.password.value, ''); assert.equal(elements.pin.value, ''); assert.equal(calls.length, 0);
});
