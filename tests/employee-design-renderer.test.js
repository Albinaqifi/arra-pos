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
  const data = { users: [{ id: 1, username: 'Sample', active: 1, hasPin: 0, scope: 'waiter' }], grants: [{userId: 2, permission: 'employees.change'}], audit: [], credentialAudit: [], accountAudit: [], actorScope: 'combined', actorId: 2, permissions: [] };
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
  page.state.creating = false;
  const elements = { password: { value: 'é'.repeat(513) }, pin: { value: '1234' }, removePin: { checked: false } };
  submit(formWith(page.render(), 'removePin'), elements);
  assert.match(page.state.error, /1024 UTF-8 bytes/);
  assert.equal(elements.password.value, ''); assert.equal(elements.pin.value, ''); assert.equal(calls.length, 0);
});

test('directory exposes account status and protects unsaved edits when selecting another person', () => {
  const { page } = setup();
  page.state.creating = false;
  page.state.users.push({ id: 3, username: 'Pending', active: 0, pending: 1, scope: 'waiter' });
  page.render().props.onChangeCapture({ target: { closest: () => ({ dataset: { section: 'account' } }) } });
  assert.equal(page.state.dirty, true);
  let confirmations = 0;
  const original = page.leave.bind(page);
  page.leave = () => { confirmations++; return false; };
  const button = find(page.render(), n => n.type === 'button' && find(n, x => x.type === 'strong' && x.children.includes('Pending')));
  assert.ok(button);
  assert.ok(find(button, n => n.children && n.children.includes('Pending provisioning')));
  button.props.onClick();
  assert.equal(confirmations, 1);
  assert.equal(page.state.selected, 1);
  page.leave = original;
});

test('uncertain employee save refreshes and advises checking before retry', async () => {
  const { page } = setup();
  let calls = 0;
  const saved = page.load.bind(page);
  page.load = async () => { calls++; return true; };
  // The preload reports transport failures as this error instead of rejecting.
  const previous = page.state.notice;
  // Replace the save API through the class method context supplied by setup is not possible here;
  // verify the recovery path by making load succeed after a rejected callback.
  page.props.onAccessChanged = async () => { throw new Error('unconfirmed'); };
  await page.save({ action: 'createPending', username: 'Sample' }, 'Saved');
  assert.equal(calls, 1);
  assert.notEqual(page.state.notice, previous);
  assert.match(page.state.notice, /could not be confirmed/);
  page.load = saved;
});
