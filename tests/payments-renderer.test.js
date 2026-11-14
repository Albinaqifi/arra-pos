const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
test('test payment selection confirms card A or cash account and closes only after success', async () => {
  const calls = []; let paid = 0;
  const api = { bill: async () => ({ ok: true, data: { id: 7, total: 100, lines: [] } }), payment: async r => { calls.push(r); return { ok: calls.length > 1, error: 'Retry' }; } };
  class Component { constructor(props) { this.props = props; } setState(u) { Object.assign(this.state, u); } }
  const React = { Component, Fragment: 'fragment', createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const context = { React, ReactDOM: { createRoot: () => ({ render() {} }) }, document: { getElementById() {} }, window: { arra: api }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(require('./support/renderer-bundle')() + '\n' + require('./support/renderer-bundle')() + '\nthis.Bill = DesktopBill;', context);
  const find = (n, text) => { if (!n || typeof n !== 'object') return null; if (n.type === 'button' && n.children.includes(text)) return n; for (const c of n.children || []) for (const x of Array.isArray(c) ? c : [c]) { const f = find(x, text); if (f) return f; } return null; };
  const b = new context.Bill({ orderId: 1, onPaid: () => paid++, onClose() {} }); await b.review();
  find(b.render(), 'Cash').props.onClick(); assert.equal(find(b.render(), 'Record full test payment and close table'), null);
  find(b.render(), 'Account B').props.onClick(); await find(b.render(), 'Record full test payment and close table').props.onClick();
  assert.equal(paid, 0); assert.equal(calls[0].account, 'B'); assert.equal(calls[0].method, 'cash');
  find(b.render(), 'Card (Account A)').props.onClick(); assert.equal(find(b.render(), 'Account B'), null);
  await find(b.render(), 'Record full test payment and close table').props.onClick();
  assert.equal(calls[1].method, 'card'); assert.equal(calls[1].account, 'A'); assert.equal(paid, 1);
});

test('unknown response locks the selection and retries it before allowing navigation', async () => {
  const calls = []; let paid = 0;
  const api = { bill: async () => ({ ok: true, data: { id: 8, total: 100, lines: [] } }), payment: async r => { calls.push(r); return calls.length === 1 ? { ok: false, uncertain: true, error: 'Unknown' } : { ok: true }; } };
  class Component { constructor(props) { this.props = props; } setState(u) { Object.assign(this.state, u); } }
  const React = { Component, Fragment: 'fragment', createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const context = { React, ReactDOM: { createRoot: () => ({ render() {} }) }, document: { getElementById() {} }, window: { arra: api }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(require('./support/renderer-bundle')() + '\n' + require('./support/renderer-bundle')() + '\nthis.Bill = DesktopBill;', context);
  const find = (n, text) => { if (!n || typeof n !== 'object') return null; if (n.type === 'button' && n.children.includes(text)) return n; for (const c of n.children || []) for (const x of Array.isArray(c) ? c : [c]) { const f = find(x, text); if (f) return f; } return null; };
  const b = new context.Bill({ orderId: 1, onPaid: () => paid++, onClose() {} }); await b.review();
  find(b.render(), 'Cash').props.onClick(); find(b.render(), 'Account B').props.onClick();
  await find(b.render(), 'Record full test payment and close table').props.onClick();
  assert.equal(find(b.render(), 'Close').props.disabled, true);
  assert.ok(JSON.stringify(b.render()).includes('Retry the same selection to recover the result; do not repeat the separate terminal payment.'));
  assert.equal(find(b.render(), 'Card (Account A)').props.disabled, true);
  assert.equal(find(b.render(), 'Account A').props.disabled, true);
  await find(b.render(), 'Record full test payment and close table').props.onClick();
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(calls[1])); assert.equal(paid, 1);
});

test('a later definite failure does not discard an earlier uncertain payment selection', async () => {
  const calls = []; let paid = 0;
  const responses = [{ ok: false, uncertain: true, error: 'Unknown' }, { ok: false, error: 'Unavailable' }, { ok: true }];
  const api = { bill: async () => ({ ok: true, data: { id: 9, total: 100, lines: [] } }), payment: async r => { calls.push(r); return responses.shift(); } };
  class Component { constructor(props) { this.props = props; } setState(u) { Object.assign(this.state, u); } }
  const React = { Component, Fragment: 'fragment', createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const context = { React, window: { arra: api } };
  vm.runInNewContext(require('./support/renderer-bundle')() + '\nthis.Bill = DesktopBill;', context);
  const find = (n, text) => { if (!n || typeof n !== 'object') return null; if (n.type === 'button' && n.children.includes(text)) return n; for (const c of n.children || []) for (const x of Array.isArray(c) ? c : [c]) { const f = find(x, text); if (f) return f; } return null; };
  const b = new context.Bill({ orderId: 1, onPaid: () => paid++, onClose() {} }); await b.review();
  find(b.render(), 'Card (Account A)').props.onClick();
  await b.pay(); await b.pay();
  assert.equal(paid, 0);
  assert.equal(find(b.render(), 'Close').props.disabled, true);
  assert.equal(find(b.render(), 'Cash').props.disabled, true);
  assert.ok(JSON.stringify(b.render()).includes('Retry the same selection to recover the result'));
  await b.pay();
  assert.equal(paid, 1);
  assert.ok(calls.every(r => JSON.stringify(r) === JSON.stringify(calls[0])));
  assert.equal(calls[0].method, 'card'); assert.equal(calls[0].account, 'A');
});

test('bill dialog retains keyboard focus when busy disables controls and during uncertain recovery', async () => {
  class Component { constructor(props) { this.props = props; } setState(u) { Object.assign(this.state, u); } }
  let handler, resolvePayment;
  const previous = { focus() { document.activeElement = this; } }, body = {}, record = { disabled: false }, retry = { disabled: false, focus() { document.activeElement = this; } };
  const document = { activeElement: previous, addEventListener(type, fn) { if (type === 'focusin') handler = fn; }, removeEventListener(type, fn) { if (handler === fn) handler = null; } };
  const dialog = { focus() { document.activeElement = this; }, contains(el) { return el === this || el === record || el === retry; }, querySelectorAll() { return [retry]; } };
  const context = { React: { Component }, document, window: { arra: { bill: async () => ({ ok: true, data: { id: 9, lines: [], total: 1 } }), payment: () => new Promise(resolve => { resolvePayment = resolve; }) } } };
  vm.runInNewContext(require('./support/renderer-bundle')() + '\nthis.Bill = DesktopBill;', context);
  const bill = new context.Bill({ orderId: 1 }); bill.dialog = dialog; bill.componentDidMount(); await new Promise(setImmediate);
  assert.equal(document.activeElement, dialog);
  bill.setState({ method: 'card', account: 'A' }); document.activeElement = record;
  const pending = bill.pay(); record.disabled = true; document.activeElement = body; bill.componentDidUpdate();
  assert.equal(document.activeElement, dialog);
  resolvePayment({ ok: false, uncertain: true, error: 'Payment result unknown. Retry the same selection.' }); await pending; bill.componentDidUpdate();
  assert.equal(bill.state.uncertain, true);
  let prevented = false; bill.onKeyDown({ key: 'Tab', shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(document.activeElement, retry);
  document.activeElement = previous; handler({ target: previous }); assert.equal(document.activeElement, dialog);
  bill.componentWillUnmount(); assert.equal(handler, null); assert.equal(document.activeElement, previous);
});
