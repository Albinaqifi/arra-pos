const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function setup(api) {
  class Component {
    constructor(props) { this.props = props; }
    setState(update) { Object.assign(this.state, update); }
  }
  const React = { Component, createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const context = { React, window: { arra: api } };
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  return context.ArraComponents;
}

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    for (const item of Array.isArray(child) ? child : [child]) {
      const result = find(item, predicate);
      if (result) return result;
    }
  }
  return null;
}

test('configuration screens retain loading, denied and back controls', async () => {
  for (const [component, method, title, loading, guidance] of [
    ['TableConfig', 'tableConfig', 'Areas and tables', 'Loading areas and tables…', ' Check your access or sign in and select your own name.'],
    ['MenuConfig', 'menuConfig', 'Menu management', 'Loading menu…', ' Check your access or sign in and select your own name.'],
    ['EmployeeConfig', 'employeeConfig', 'Employees and permissions', 'Loading employees…', ' Sign in with your own administrator account and select your own name.'],
  ]) {
    let back = 0;
    const components = setup({ [method]: async () => ({ ok: false, error: 'Denied.' }) });
    const page = new components[component]({ onBack: () => back++ });
    let tree = page.render();
    assert.equal(find(tree, n => n.type === 'h1').children[0], title);
    assert.equal(find(tree, n => n.props.role === 'status').children[0], loading);
    find(tree, n => n.type === 'button').props.onClick();
    assert.equal(back, 1);
    await page.load();
    tree = page.render();
    assert.deepEqual(Array.from(find(tree, n => n.props.role === 'alert').children), ['Denied.', guidance]);
    assert.equal(find(tree, n => n.type === 'input'), null);
  }
});

test('configuration editors keep accessible labels, values and change behavior', async () => {
  const components = setup({
    tableConfig: async () => ({ ok: true, data: { areas: [], tables: [] } }),
    menuConfig: async () => ({ ok: true, data: { categories: [], products: [], groups: [], options: [] } }),
  });
  const table = new components.TableConfig({});
  await table.load(); table.editTable(null);
  const menu = new components.MenuConfig({});
  await menu.load(); menu.edit('category', null);
  for (const [page, label, stateKey, type] of [
    [table, 'Table number', 'id', 'number'],
    [menu, 'Name', 'name', 'text'],
  ]) {
    const field = find(page.render(), n => n.type === 'label' && find(n, c => c.type === 'span' && c.children[0] === label));
    const input = find(field, n => n.type === 'input');
    assert.equal(input.props.type, type);
    assert.equal(input.props.value, '');
    input.props.onChange({ target: { value: '12' } });
    assert.equal(page.state.editor[stateKey], '12');
    assert.equal(find(find(page.render(), n => n.type === 'label' && find(n, c => c.type === 'span' && c.children[0] === label)), n => n.type === 'input').props.value, '12');
  }
});
