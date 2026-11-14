const test = require('node:test');
const assert = require('node:assert/strict');
const { checkArchitecture, fingerprint, verifyCoordinator, verifyGraph } = require('../scripts/check-renderer-architecture.cjs');

const coordinator = 'export function App() { return React.createElement(Workspace); }';
const contract = { phase: 'coordinator', coordinator: fingerprint(coordinator), allowedFeatureImports: { app: ['orders', 'session'], entry: ['app'], orders: ['shared'], session: ['shared'], admin: ['shared'], shared: [] } };
const input = (...paths) => ({ imports: paths.map(path => ({ path })) });

test('the real renderer satisfies the reviewed architecture contract', () => {
  assert.ok(checkArchitecture().inputs > 0);
});

test('coordinator guard rejects feature state and handlers, including additions within an existing function', () => {
  assert.deepEqual(verifyCoordinator(coordinator, contract), []);
  assert.deepEqual(verifyCoordinator('// Formatting alone is immaterial\n' + coordinator, contract), []);
  for (const changed of [
    'export function App() { const orders = []; return React.createElement(Workspace, { orders }); }',
    'export function App() { async function sendOrder() { await window.arra.orderItems(); } return React.createElement(Workspace, { sendOrder }); }',
    coordinator + '\nexport function featureHandler() {}',
  ]) assert.ok(verifyCoordinator(changed, contract).length, 'new feature logic must require a reviewed contract change');
});

test('dependency guard rejects backend imports, reverse imports, shared-feature dependencies and cycles', () => {
  const cases = [
    { graph: { 'src/renderer-entry.js': input('src/desktop/payments.js'), 'src/desktop/payments.js': input() }, message: /Privileged desktop/ },
    { graph: { 'src/orders/Order.js': input('src/App.js'), 'src/App.js': input() }, message: /Reverse coordinator/ },
    { graph: { 'src/shared/helper.js': input('src/orders/Order.js'), 'src/orders/Order.js': input() }, message: /Shared code imports/ },
    { graph: { 'src/orders/one.js': input('src/orders/two.js'), 'src/orders/two.js': input('src/orders/one.js') }, message: /dependency cycle/ },
  ];
  for (const { graph, message } of cases) assert.match(verifyGraph(graph, contract).join('\n'), message);
});

test('feature layers permit reviewed dependencies and reject reverse ownership and privileged external imports', () => {
  assert.deepEqual(verifyGraph({ 'src/App.js': input('src/orders/Orders.js'), 'src/orders/Orders.js': input('src/shared/format.js'), 'src/shared/format.js': input() }, contract), []);
  assert.match(verifyGraph({ 'src/orders/Orders.js': input('src/session/Session.js') }, contract).join('\n'), /Forbidden renderer dependency direction/);
  assert.match(verifyGraph({ 'src/unreviewed/Store.js': input() }, contract).join('\n'), /Unreviewed renderer layer/);
  assert.match(verifyGraph({ 'src/orders/Orders.js': { imports: [{ path: 'node:fs', external: true }] } }, contract).join('\n'), /Privileged runtime import/);
});

test('final architecture cannot restore migration mode or legacy exceptions', () => {
  assert.match(verifyGraph({}, { ...contract, phase: 'migration' }).join('\n'), /cannot return to migration/);
  assert.match(verifyGraph({}, { ...contract, legacySharedEdges: ['src/shared/helper.js -> src/admin/i18n.js'] }).join('\n'), /cannot retain/);
});
