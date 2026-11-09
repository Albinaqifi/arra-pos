const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
test('configuration pages show loading and denied states without exposing editing controls', async () => {
  class Component { constructor(props) { this.props = props; } setState(update) { Object.assign(this.state, update); } }
  const React = { Component, Fragment: 'fragment', createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const deny = async () => ({ ok: false, error: 'Access denied.' });
  const ctx = { React, ReactDOM: { createRoot() { return { render() {} }; } }, document: { getElementById() {} }, window: { arra: { employeeConfig: deny, tableConfig: deny, menuConfig: deny } }, setInterval() {}, clearInterval() {}, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'), 'utf8') + '\nthis.pages = [EmployeeConfig, TableConfig, MenuConfig];', ctx);
  for (const Page of ctx.pages) {
    const page = new Page({onBack(){}});
    assert.match(JSON.stringify(page.render()), /Loading/);
    await page.load();
    const output = JSON.stringify(page.render());
    assert.match(output, /Access denied/);
    assert.doesNotMatch(output, /Create employee|Add area|Add category|No credential resets recorded/);
  }
});
