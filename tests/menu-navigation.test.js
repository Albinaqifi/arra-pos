const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
function setup(confirm) {
  class Component { constructor(props) { this.props = props; } setState(update, callback) { Object.assign(this.state, update); if (callback) callback(); } }
  const React = { Component, createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const context = { React, window: { confirm, arra: { menuConfig: async () => ({ ok: true, data: { categories: [{ id:'c', name:'Food', active:0 }, { id:'s', name:'Grill', parentId:'c', active:1 }], products: [{ id:'p', categoryId:'s', name:'Dish', price:10, destination:'bar', active:1 }, { id:'q', categoryId:'c', name:'Soup', price:20, destination:'kitchen', active:1 }], groups:[], options:[] } }) } } };
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  return new context.ArraComponents.MenuConfig({ onBack() {} });
}
function all(node) { return !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flat(Infinity).flatMap(all)]; }
test('search narrows products and opens their categories while showing hidden status', async () => {
  const page = setup(() => false); await page.load();
  let tree = all(page.render()); assert.ok(tree.some(n => n.props.className === 'menu-category-summary')); assert.ok(tree.some(n => n.children.includes('Hidden by parent')));
  page.setState({ query: 'dish' }); tree = all(page.render());
  assert.ok(tree.some(n => n.props['aria-label'] === 'Edit product Dish'));
  assert.ok(!tree.some(n => n.props['aria-label'] === 'Edit product Soup'));
  assert.ok(tree.filter(n => n.type === 'details' && n.props.open).length >= 2);
  assert.ok(tree.some(n => n.children.includes('Hidden by category')));
});
test('declining to discard preserves the editor and entered values', async () => {
  const page = setup(() => false); await page.load(); page.edit('product', null, 'c'); page.state.editor.name = 'Unfinished';
  page.edit('category', null); assert.equal(page.state.editor.name, 'Unfinished');
  page.changeContext(() => { throw new Error('navigation must not run'); }); assert.equal(page.state.editor.name, 'Unfinished');
});
test('reveals moved and renamed product after save and preserves its new context', async () => {
  const page = setup(() => true); await page.load();
  const moved = { ...page.state.products[0], categoryId: 'c', name: 'Renamed' };
  const data = { categories: page.state.categories, products: [moved, page.state.products[1]], groups: [], options: [] };
  page.state.query = 'Dish'; page.edit('product', page.state.products[0]);
  page.state.editor.categoryId = 'c'; page.state.editor.name = 'Renamed';
  page.reveal(page.state.editor, data, page.state, true);
  assert.equal(page.state.query, ''); assert.equal(page.state.selectedId, 'p');
  assert.equal(page.state.expandedCategories.c, true); assert.equal(page.state.expandedProducts.p, true);
});
test('uncertain create reveals its parent without guessing a newly created identity', async () => {
  const page = setup(() => true); await page.load();
  const before = { categories: page.state.categories, products: page.state.products, groups: [], options: [] };
  page.edit('product', null, 's');
  const data = { ...before, products: [...before.products, { id: 'new', categoryId: 's', name: 'New' }] };
  page.reveal(page.state.editor, data, before, false);
  assert.equal(page.state.selectedId, null); assert.equal(page.state.expandedCategories.s, true); assert.equal(page.state.expandedCategories.c, true);
});
test('successful save reveals moved, renamed product through the actual save flow', async () => {
  class Component { constructor(props) { this.props = props; } setState(update, callback) { Object.assign(this.state, update); if (callback) callback(); } }
  const React = { Component, createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const data = { categories: [{ id: 'a', name: 'Food', active: 1 }, { id: 'b', name: 'Drinks', active: 1 }], products: [{ id: 'p', categoryId: 'a', name: 'Old', price: 10, sortOrder: 0, destination: 'bar', active: 1 }], groups: [], options: [] };
  const context = { React, window: { confirm: () => true, arra: { menuConfig: async request => { if (request.action === 'list') return { ok: true, data: structuredClone(data) }; Object.assign(data.products[0], request); return { ok: true }; } } } };
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  const page = new context.ArraComponents.MenuConfig({}); await page.load(); page.state.query = 'Old'; page.edit('product', page.state.products[0]);
  page.state.editor.name = 'New'; page.state.editor.categoryId = 'b'; await page.save();
  assert.equal(page.state.query, ''); assert.equal(page.state.selectedId, 'p'); assert.equal(page.state.expandedCategories.b, true); assert.equal(page.state.expandedProducts.p, true); assert.equal(page.state.editor, null);
});
test('category and subcategory forms distinguish creation and editing in English and Albanian', async () => {
  for (const language of ['en', 'sq']) {
    const page = setup(() => true); page.props.language = language; await page.load();
    const has = (tree, text) => tree.some(n => n.children.includes(text));
    const heading = (tree, prefix, kind) => tree.some(n => n.type === 'h2' && n.children.join('') === prefix + kind);
    page.edit('category', null); let tree = all(page.render());
    assert.ok(heading(tree, page.t('New '), page.t('category')));
    assert.ok(!has(tree, page.t('Parent category')));
    page.edit('category', page.state.categories[0]); tree = all(page.render());
    assert.ok(heading(tree, page.t('Edit '), page.t('category')));
    assert.ok(!has(tree, page.t('Parent category')));
    page.edit('category', null, 'c'); tree = all(page.render());
    assert.ok(heading(tree, page.t('New '), page.t('subcategory')));
    assert.ok(has(tree, page.t('Parent category')));
    const select = tree.find(n => n.type === 'select');
    assert.equal(select.props.value, 'c');
    assert.ok(!all(select).some(n => n.type === 'option' && n.props.value === 's'));
    page.state.editor.name = 'Sample'; page.state.editor.parentId = null; await page.save();
    assert.equal(page.state.error, page.t('Choose a parent category.'));
    page.edit('category', page.state.categories[1]); tree = all(page.render());
    assert.ok(heading(tree, page.t('Edit '), page.t('subcategory')));
    assert.ok(has(tree, page.t('Parent category')));
    if (language === 'sq') {
      assert.equal(page.t('subcategory'), 'nënkategori');
      assert.equal(page.state.editor.parentId, 'c');
    }
  }
});
test('category and subcategory editors name their purpose and preserve the parent', async () => {
  const page = setup(() => true); await page.load();
  page.edit('category', null); let tree = all(page.render());
  assert.ok(tree.some(n => n.type === 'h2' && n.children.join('') === 'New category'));
  assert.ok(!tree.some(n => n.type === 'label' && n.children.some(c => c && c.children?.includes('Parent category'))));
  page.changeContext(() => {}); page.edit('category', null, 'c'); tree = all(page.render());
  assert.ok(tree.some(n => n.type === 'h2' && n.children.join('') === 'New subcategory'));
  assert.ok(tree.some(n => n.type === 'label' && n.children.some(c => c && c.children?.includes('Parent category'))));
  assert.equal(page.state.editor.parentId, 'c'); page.state.editor.name = 'Sides'; page.state.editor.parentId = null; await page.save();
  assert.match(page.state.error, /parent category/i); assert.ok(page.state.editor);
  page.changeContext(() => {}); page.edit('category', page.state.categories[1]);
  assert.equal(page.state.editor.parentId, 'c'); assert.equal(page.state.editor.isSubcategory, true);
  page.props.language = 'sq'; tree = all(page.render());
  assert.ok(tree.some(n => n.type === 'h2' && n.children.join('').includes('nënkategori')));
  assert.ok(tree.some(n => n.type === 'label' && n.children.some(c => c && c.children?.includes('Kategoria prind'))));
});
test('editing explicitly promotes a subcategory and moves a leaf category under a parent', async () => {
  class Component { constructor(props) { this.props = props; } setState(update, callback) { Object.assign(this.state, update); if (callback) callback(); } }
  const React = { Component, createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const data = { categories: [{id:'food',name:'Food',active:1,parentId:null,sortOrder:0}, {id:'grill',name:'Grill',active:1,parentId:'food',sortOrder:0}, {id:'drinks',name:'Drinks',active:1,parentId:null,sortOrder:1}], products:[],groups:[],options:[] };
  const writes = [];
  const context = {React,window:{confirm:()=>true,arra:{menuConfig:async request=>{if(request.action==='list') return {ok:true,data:structuredClone(data)}; writes.push(request); Object.assign(data.categories.find(c=>c.id===request.id),request); return {ok:true};}}}};
  vm.runInNewContext(require('./support/admin-bundle')(),context); const page = new context.ArraComponents.MenuConfig({}); await page.load();
  const level = () => all(page.render()).find(n=>n.type==='label' && n.children.some(c=>c?.children?.includes('Category level'))).children.find(c=>c?.type==='select');
  page.edit('category',page.state.categories.find(c=>c.id==='grill')); level().props.onChange({target:{value:'top'}}); await page.save();
  assert.equal(writes[0].parentId,null);
  page.edit('category',page.state.categories.find(c=>c.id==='drinks')); level().props.onChange({target:{value:'sub'}});
  assert.equal(page.state.editor.parentId,null); await page.save(); assert.match(page.state.error,/parent category/i);
  page.state.editor.parentId='food'; await page.save(); assert.equal(writes[1].parentId,'food');
  page.edit('category',page.state.categories.find(c=>c.id==='food')); assert.equal(level().children.flat(Infinity).find(n=>n?.props?.value==='sub').props.disabled,true);
});
