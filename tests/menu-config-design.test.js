const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
function setup(api) {
  class Component { constructor(props) { this.props = props; } setState(update) { Object.assign(this.state, update); } }
  const React = { Component, createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const context = { React, window: { arra: { menuConfig: api } } };
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  return new context.ArraComponents.MenuConfig({ onBack() {} });
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of (node.children || []).flat(Infinity)) { const found = find(child, predicate); if (found) return found; }
  return null;
}
const sample = { categories: [{ id: 'c', name: 'Food', parentId: null, sortOrder: 0, active: 1 }, { id: 'sub', name: 'Grill', parentId: 'c', sortOrder: 1, active: 1 }], products: [{ id: 'p', categoryId: 'sub', name: 'Dish', price: 100, sortOrder: 1, destination: 'bar', active: 1 }], groups: [{ id: 'g', productId: 'p', name: 'Size', required: 1, active: 1 }], options: [{ id: 'o', groupId: 'g', name: 'Large', adjustment: 20, active: 1 }] };
test('menu hierarchy provides contextual editors, validation and save feedback', async () => {
  const calls = []; let fail = false;
  const page = setup(async request => { calls.push(request); return request.action === 'list' ? { ok: true, data: sample } : fail ? { ok: false, error: 'Rejected' } : { ok: true }; });
  await page.load();
  let tree = page.render();
  for (const label of ['Edit category Grill', 'Edit product Dish', 'Edit group Size for Dish', 'Edit option Large in Size', 'Add subcategory to Food']) assert.ok(find(tree, n => n.props['aria-label'] === label), label);
  find(tree, n => n.props['aria-label'] === 'Add subcategory to Food').props.onClick();
  assert.equal(page.state.editor.parentId, 'c');
  await page.save(); assert.equal(calls.length, 1); assert.match(page.state.error, /name/i);
  page.state.editor.name = 'Sides'; await page.save();
  assert.equal(calls[1].action, 'category'); assert.equal(calls[1].parentId, 'c'); assert.match(page.state.notice, /saved/);
  page.edit('product', sample.products[0]); page.state.editor.price = ''; await page.save(); assert.match(page.state.error, /price/i);
  page.state.editor.price = '150'; fail = true; await page.save(); assert.equal(page.state.error, 'Rejected'); assert.ok(page.state.editor);
  fail = false; await page.save(); assert.equal(calls.at(-2).destination, 'bar'); assert.equal(calls.at(-2).price, 150);
  page.edit('group', sample.groups[0]); await page.save(); assert.equal(calls.at(-2).required, true);
  page.edit('option', sample.options[0]); page.state.editor.adjustment = '-10'; await page.save(); assert.equal(calls.at(-2).adjustment, -10);
});
test('save disables editor controls and rejects duplicate submission while pending', async () => {
  let resolve, writes = 0;
  const page = setup(request => request.action === 'list' ? Promise.resolve({ ok: true, data: sample }) : (writes++, new Promise(r => { resolve = r; })));
  await page.load(); page.edit('product', sample.products[0]);
  const pending = page.save(); await page.save(); assert.equal(writes, 1);
  const tree = page.render(); assert.equal(find(tree, n => n.type === 'input').props.disabled, true);
  resolve({ ok: true }); await pending; assert.equal(page.state.busy, false);
});
test('lost create response refreshes committed data and closes the editor before another create', async () => {
  let writes = 0;
  const categories = sample.categories.map(c => ({ ...c }));
  const page = setup(async request => {
    if (request.action === 'list') return { ok: true, data: { ...sample, categories: categories.map(c => ({ ...c })) } };
    writes++;
    categories.push({ id: 'committed', name: request.name, parentId: request.parentId, sortOrder: request.sortOrder, active: 1 });
    return { ok: false, error: 'Configuration unavailable' };
  });
  await page.load(); page.edit('category', null); page.state.editor.name = 'Sides';
  await page.save();
  assert.equal(writes, 1); assert.equal(page.state.editor, null);
  assert.ok(page.state.categories.some(c => c.name === 'Sides'));
  assert.match(page.state.notice, /may have succeeded.*check the refreshed menu/i);
  await page.save(); assert.equal(writes, 1);
});
test('an uncertain save with a failed refresh hides editing and explains recovery', async () => {
  let lists = 0;
  const page = setup(async request => request.action === 'list' ? (++lists === 1 ? { ok: true, data: sample } : { ok: false, error: 'Unavailable' }) : { ok: false, error: 'Configuration unavailable' });
  await page.load(); page.edit('category', null); page.state.editor.name = 'Sides'; await page.save();
  assert.equal(page.state.access, false); assert.equal(page.state.editor, null);
  assert.match(page.state.error, /could not be confirmed.*reopen the menu/i);
  assert.equal(find(page.render(), n => n.type === 'input'), null);
});
test('confirmed create with failed refresh reports success and closes the editor', async () => {
  let lists = 0, writes = 0;
  const page = setup(async request => request.action === 'list' ? (++lists === 1 ? { ok: true, data: sample } : { ok: false, error: 'Unavailable' }) : (writes++, { ok: true }));
  await page.load(); page.edit('category', null); page.state.editor.name = 'Sides'; await page.save();
  assert.equal(writes, 1); assert.equal(page.state.access, false); assert.equal(page.state.editor, null);
  assert.match(page.state.error, /change was saved.*reopen the menu/i);
  await page.save(); assert.equal(writes, 1);
});
