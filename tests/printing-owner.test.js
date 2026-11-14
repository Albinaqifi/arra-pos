const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const rendererBundle = require('./support/renderer-bundle');

function harness(bridge) {
  class Component {
    constructor(props) { this.props = props; this.updates = 0; }
    setState(update) { this.updates++; Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); }
  }
  let next = 0;
  const context = {
    React: { Component, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    window: { arra: bridge, confirm: () => true },
    document: { getElementById: () => ({ value: 'Sample queue' }) },
    crypto: { randomUUID: () => 'print-request-' + ++next },
  };
  vm.runInNewContext(rendererBundle(), context);
  const { PrintingSession, PrintJobs, TestPrintJobs } = context.RendererModules;
  const printing = new PrintingSession({ bridge });
  return { printing, PrintJobs, TestPrintJobs, context };
}
const data = { jobs: [], printers: [], queues: [] };
const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...tree.children.flatMap(nodes)];
const label = tree => typeof tree === 'string' ? tree : tree && typeof tree === 'object' ? (tree.children || []).map(label).join('') : '';

test('lost simulated and Windows retry replies keep identity after panel replacement', async () => {
  for (const channel of ['printJobs', 'testPrinting']) {
    const requests = [];
    const bridge = { [channel]: async request => {
      if (request.action === 'list') return { ok: true, data };
      requests.push({ ...request });
      if (requests.length === 1) throw Error('Reply lost');
      return { ok: true, data };
    } };
    const { printing, PrintJobs, TestPrintJobs } = harness(bridge);
    const Panel = channel === 'printJobs' ? PrintJobs : TestPrintJobs;
    const first = new Panel({ printing, language: 'en' });
    await first.retry(12);
    assert.match(first.state.error, /unavailable|Unable to change/);
    assert.equal(first.state.busy, false);
    first.componentWillUnmount();
    const replacement = new Panel({ printing, language: 'sq' });
    await replacement.retry(12);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].requestId, requests[1].requestId);
    assert.equal(replacement.state.error, '');
    await replacement.retry(12);
    assert.notEqual(requests[2].requestId, requests[1].requestId, 'confirmed attempt permits a new intentional retry');
    if (channel === 'testPrinting') assert.equal(requests.every(request => request.checked === true), true);
  }
});

test('a replacement panel cannot duplicate an in-flight attempt and recovers when it settles', async () => {
  for (const channel of ['printJobs', 'testPrinting']) {
    const requests = [];
    let release, first = true;
    const bridge = { [channel]: request => {
      if (request.action === 'list') return Promise.resolve({ ok: true, data });
      requests.push({ ...request });
      if (first) { first = false; return new Promise(resolve => { release = resolve; }); }
      return Promise.resolve({ ok: true, data });
    } };
    const { printing, PrintJobs, TestPrintJobs } = harness(bridge);
    const Panel = channel === 'printJobs' ? PrintJobs : TestPrintJobs;
    const old = new Panel({ printing }); old.componentDidMount();
    const pending = old.retry(7);
    old.componentWillUnmount();
    const replacement = new Panel({ printing }); replacement.componentDidMount();
    assert.equal(replacement.state.busy, true);
    await replacement.retry(7);
    const blocked = await (channel === 'printJobs' ? printing.retry(7) : printing.retryTestJob(7, true));
    assert.equal(blocked.busy, true);
    assert.equal(requests.length, 1);
    release({ ok: false }); await pending; await tick();
    assert.equal(replacement.state.busy, false);
    await replacement.retry(7);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].requestId, requests[1].requestId);
    replacement.componentWillUnmount();
  }
});

test('the two printing services have distinct retry registries for the same numeric job ID', async () => {
  const requests = [];
  const bridge = {
    printJobs: async request => { requests.push(['simulated', { ...request }]); return { ok: false }; },
    testPrinting: async request => { requests.push(['test', { ...request }]); return { ok: false }; },
  };
  const { printing } = harness(bridge);
  await printing.retry(4); await printing.retryTestJob(4, true);
  await printing.retry(4); await printing.retryTestJob(4, true);
  assert.equal(requests[0][1].requestId, requests[2][1].requestId);
  assert.equal(requests[1][1].requestId, requests[3][1].requestId);
  assert.notEqual(requests[0][1].requestId, requests[1][1].requestId);
});

test('printing loads ignore superseded responses and disposed panels unsubscribe', async () => {
  for (const channel of ['printJobs', 'testPrinting']) {
    const releases = [];
    const { printing, PrintJobs, TestPrintJobs } = harness({ [channel]: () => new Promise(resolve => releases.push(resolve)) });
    const Panel = channel === 'printJobs' ? PrintJobs : TestPrintJobs;
    const panel = new Panel({ printing });
    panel.componentDidMount();
    const current = panel.load();
    releases[1]({ ok: true, data: { ...data, jobs: [{ id: 2 }] } }); await current;
    releases[0]({ ok: true, data: { ...data, jobs: [{ id: 1 }] } }); await tick();
    assert.equal((channel === 'printJobs' ? panel.state : panel.state.data).jobs[0].id, 2);
    const pending = panel.load();
    panel.componentWillUnmount();
    const updates = panel.updates;
    printing.jobsChanged();
    assert.equal(releases.length, 3, 'unmounted panel does not load after a revision');
    releases[2]({ ok: true, data }); await pending;
    assert.equal(panel.updates, updates, 'late response does not update an unmounted panel');
  }
});

test('queue configuration failure releases busy and preserves the existing recovery warning', async () => {
  const requests = [];
  let fail = true;
  const { printing, TestPrintJobs } = harness({ testPrinting: async request => {
    requests.push({ ...request });
    if (request.action === 'configure' && fail) throw Error('Connection lost');
    return { ok: true, data: { ...data, queues: [{ destination: 'kitchen', queue: 'Sample queue' }] } };
  } });
  const panel = new TestPrintJobs({ printing });
  await panel.load();
  const save = () => nodes(panel.render()).find(node => node.type === 'button' && label(node) === 'Save queue').props.onClick();
  await save();
  assert.equal(panel.state.busy, false);
  assert.equal(printing.testBusy, false);
  assert.match(panel.state.error, /Check permission and output/);
  fail = false; await save();
  assert.equal(panel.state.error, '');
  assert.equal(requests.filter(request => request.action === 'configure').length, 2);
});

test('test retry requires a paper check and cancelled tickets expose no retry action', async () => {
  const requests = [];
  const { printing, PrintJobs, TestPrintJobs, context } = harness({ testPrinting: async request => {
    requests.push({ ...request }); return { ok: true, data };
  } });
  const panel = new TestPrintJobs({ printing });
  context.window.confirm = () => false;
  await panel.retry(3); await printing.retryTestJob(3, false);
  assert.equal(requests.length, 0);
  context.window.confirm = () => true;
  await panel.retry(3);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].checked, true);
  panel.state.data = { queues: [], jobs: [{ id: 3, cancelled: true, result: 'uncertain' }] };
  const simulated = new PrintJobs({ printing });
  simulated.state.jobs = [{ id: 3, cancelled: true, result: 'failed' }];
  for (const view of [panel.render(), simulated.render()]) {
    assert.match(JSON.stringify(view), /cancelled item: do not retry/);
    assert.equal(nodes(view).some(node => node.type === 'button' && /Retry/.test(label(node))), false);
  }
});

test('printing owns refresh revisions and sends only status reads when building handoff warnings', async () => {
  const requests = [];
  let outcome = { ok: true, data: { ...data, jobs: [{ result: 'success', hadUncertain: true }] } };
  const { printing, PrintJobs, TestPrintJobs } = harness({
    printJobs: async request => { requests.push({ ...request }); return outcome; },
    testPrinting: async request => { requests.push({ ...request }); return { ok: true, data }; },
  });
  const panels = [new PrintJobs({ printing }), new TestPrintJobs({ printing })];
  for (const panel of panels) panel.componentDidMount();
  await tick(); const before = requests.length;
  printing.jobsChanged(); await tick();
  assert.equal(requests.length, before + 2);
  assert.equal(printing.revision, 1);
  assert.match(await printing.handoffNotice('en'), /uncertain output/);
  outcome = { ok: false };
  assert.match(await printing.handoffNotice('en'), /status unavailable/);
  outcome = { ok: true, data: {} };
  assert.match(await printing.handoffNotice('en'), /status unavailable/);
  outcome = { ok: true, data };
  assert.equal(await printing.handoffNotice('en'), '');
  assert.equal(requests.every(request => request.action === 'list'), true);
  for (const panel of panels) panel.componentWillUnmount();
  printing.dispose();
});
