const test = require('node:test');
const assert = require('node:assert/strict');
const { checkArchitecture, fingerprint, verifyCoordinator, verifyGraph } = require('../scripts/check-renderer-architecture.cjs');

const coordinator = 'export function App() { return React.createElement(Workspace); }';
const contract = { phase: 'coordinator', coordinator: fingerprint(coordinator), legacySharedEdges: [] };
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

test('migration exceptions are specific and prohibited in the final composition contract', () => {
  const edge = 'src/shared/helper.js -> src/admin/i18n.js';
  const migration = { ...contract, phase: 'migration', legacySharedEdges: [edge] };
  assert.deepEqual(verifyGraph({ 'src/shared/helper.js': input('src/admin/i18n.js') }, migration), []);
  assert.match(verifyGraph({ 'src/shared/helper.js': input('src/admin/EmployeeConfig.js') }, migration).join('\n'), /Shared code imports/);
  assert.match(verifyGraph({}, { ...migration, phase: 'coordinator' }).join('\n'), /cannot retain/);
});
