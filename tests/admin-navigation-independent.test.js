const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('administration overview and sidebar navigate all six areas and identify the current page', () => {
  class Component { constructor(props) { this.props = props; } setState(update) { Object.assign(this.state, update); } }
  const React = { Component, Fragment: 'fragment', createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const context = { React, ReactDOM: { createRoot: () => ({ render() {} }) }, document: { getElementById() {} }, window: { arra: {} }, setInterval() {}, clearInterval() {}, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'), 'utf8') + '\nthis.Demo = WaiterDemo;', context);
  const findAll = (node, predicate) => {
    if (!node || typeof node !== 'object') return [];
    return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => (Array.isArray(child) ? child : [child]).flatMap(item => findAll(item, predicate)))];
  };
  const app = new context.Demo();
  const routes = [['Areas and tables', 'tableConfig'], ['Menu', 'menuConfig'], ['Employees', 'employeeConfig'], ['Order history', 'orderHistory'], ['Financial information', 'financialVisibility'], ['Operational reports', 'operationalReports']];
  for (const [label, screen] of routes) {
    app.setState({screen: 'admin'});
    let shell = app.render(), view = shell.type(shell.props);
    const buttons = findAll(view, n => n.type === 'button' && JSON.stringify(n.children).includes(label));
    assert.equal(buttons.length, 2, label);
    buttons[1].props.onClick();
    assert.equal(app.state.screen, screen);
    shell = app.render(); view = shell.type(shell.props);
    const current = findAll(view, n => n.type === 'button' && n.props['aria-current'] === 'page');
    assert.equal(current.length, 1);
    assert.equal(current[0].children[0], label);
    shell.children[0].props.onBack();
    assert.equal(app.state.screen, 'admin');
    shell = app.render(); view = shell.type(shell.props);
    findAll(view, n => n.type === 'button' && n.children.includes(label))[0].props.onClick();
    assert.equal(app.state.screen, screen);
  }
});
