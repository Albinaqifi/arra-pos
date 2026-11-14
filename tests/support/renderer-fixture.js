// Test arrangements for the owners split out of the renderer. This initializer
// is deliberately outside production code; assertions and actions use owners.
const sessionFields = new Set(['user', 'pass', 'waiter', 'pinFor', 'pin', 'waiterMessage', 'switching', 'handoffNotice', 'adminAccess']);
const adminPages = new Set(['admin', 'operationalReports', 'financialVisibility', 'orderHistory', 'adminSentCorrections', 'employeeConfig', 'menuConfig', 'tableConfig']);
const tableOrderFields = new Set(['sections', 'tableLoad', 'orders', 'items', 'tableId', 'tab']);
const catalogFields = new Set(['cats', 'catById', 'products', 'byId', 'G', 'menuLoad', 'cat', 'sub', 'search']);

function arrange(app, values) {
  let pendingDialog;
  let hasPendingDialog = false;
  let moveDialog;
  let correctionDialog;
  let billingDialog;
  for (const [name, value] of Object.entries(values)) {
    if (name === 'screen') {
      if (adminPages.has(value)) { app.session.state.screen = 'admin'; app.administration.state.page = value; }
      else if (['tables', 'order', 'history'].includes(value)) { app.session.state.screen = 'waiter'; app.tableOrders.state.screen = value; }
      else app.session.state.screen = value;
    } else if (name === 'modal') {
      app.pending.state.dialog = null;
      app.moveWorkflow.state.dialog = null;
      app.correction.state.dialog = null;
      app.demoBilling.state.dialog = null;
      app.billing.state.desktop = null;
      if (value && ['mods', 'note'].includes(value.type)) { pendingDialog = value; hasPendingDialog = true; }
      else if (value?.type === 'cancel') correctionDialog = value;
      else if (value?.type === 'moveTable') moveDialog = value;
      else if (value) billingDialog = value;
    } else if (sessionFields.has(name)) app.session.state[name] = value;
    else if (name === 'orders' && !app.tableOrders.bridge) app.tableOrders.state.orders = Object.fromEntries(Object.entries(value).map(([tableId, order]) => [tableId, { ...order, id: order.id ?? 'test-order-' + tableId }]));
    else if (tableOrderFields.has(name)) app.tableOrders.state[name] = value;
    else if (catalogFields.has(name)) app.catalog.state[name] = value;
    else if (name === 'printers' || name === 'jobs') app.demoPrinting.state[name] = value;
    else if (name === 'history' || name === 'billNo') app.demoBilling.state[name] = value;
    else if (name === 'language') app.settings.state.language = value;
    else if (name === 'toast') app.shell.state.toast = value;
    else throw new Error('Unknown fixture field: ' + name);
  }
  if (hasPendingDialog) app.pending.state.dialog = { ...pendingDialog, target: app.tableOrders.captureTarget(), draftId: ++app.pending.draftSequence };
  if (moveDialog) app.moveWorkflow.state.dialog = { ...moveDialog, target: app.tableOrders.captureTarget(), draftId: ++app.moveWorkflow.draftSequence };
  if (correctionDialog) app.correction.state.dialog = { other: '', ...correctionDialog, target: app.tableOrders.captureTarget(), draftId: ++app.correction.draftSequence };
  if (billingDialog?.type === 'desktopBill') app.billing.state.desktop = { key: ++app.billing.sequence, target: app.tableOrders.captureTarget(), orderId: app.tableOrders.captureTarget().orderId, busy: false, uncertain: false };
  else if (billingDialog) app.demoBilling.state.dialog = { ...billingDialog, target: app.tableOrders.captureTarget() };
}

function routeOf(app) {
  if (app.session.state.screen === 'waiter') return app.tableOrders.state.screen;
  if (app.session.state.screen === 'admin') return app.administration.state.page;
  return app.session.state.screen;
}

module.exports = { arrange, routeOf };
