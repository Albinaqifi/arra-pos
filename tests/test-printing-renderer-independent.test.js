const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('test print list failure stays visible and refresh recovers', async () => {
  class Component { constructor(props) { this.props = props; } setState(update) { Object.assign(this.state, update); } }
  let fail = true;
  const context = { React: { Component, createElement: (type, props, ...children) => ({type, props, children}) }, window: { arra: { testPrinting: async () => fail ? {ok:false} : {ok:true, data:{queues:[],jobs:[]}} } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'), 'utf8') + '\nthis.TestPrintJobs=TestPrintJobs;', context);
  const jobs = new context.TestPrintJobs({});
  await jobs.load();
  assert.match(jobs.state.error, /status unavailable/i);
  assert.equal(jobs.render().type, 'section');
  fail = false;
  await jobs.load();
  assert.equal(jobs.state.error, '');
  assert.equal(jobs.state.data.jobs.length, 0);
});
