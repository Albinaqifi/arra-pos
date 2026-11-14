// Test arrangements for the owners split out of the renderer. This initializer
// is deliberately outside production code; assertions and actions use owners.
const sessionFields = new Set(['user', 'pass', 'waiter', 'pinFor', 'pin', 'waiterMessage', 'switching', 'handoffNotice', 'adminAccess']);
const adminPages = new Set(['admin', 'operationalReports', 'financialVisibility', 'orderHistory', 'adminSentCorrections', 'employeeConfig', 'menuConfig', 'tableConfig']);
const tableOrderFields = new Set(['sections', 'tableLoad', 'orders', 'items', 'tableId', 'tab']);
const catalogFields = new Set(['cats', 'catById', 'products', 'byId', 'G', 'menuLoad', 'cat', 'sub', 'search']);

function arrange(app, values) {
  let pendingDialog;
  let hasPendingDialog = false;
  for (const [name, value] of Object.entries(values)) {
    if (name === 'screen') {
      if (adminPages.has(value)) { app.session.state.screen = 'admin'; app.administration.state.page = value; }
      else if (['tables', 'order', 'history'].includes(value)) { app.session.state.screen = 'waiter'; app.tableOrders.state.screen = value; }
      else app.session.state.screen = value;
    } else if (name === 'modal') {
      if (value && ['mods', 'note'].includes(value.type)) { pendingDialog = value; hasPendingDialog = true; app.state.modal = null; }
      else { app.state.modal = value; app.pending.state.dialog = null; }
    } else if (sessionFields.has(name)) app.session.state[name] = value;
    else if (tableOrderFields.has(name)) app.tableOrders.state[name] = value;
    else if (catalogFields.has(name)) app.catalog.state[name] = value;
    else if (name === 'language') app.settings.state.language = value;
    else app.state[name] = value;
  }
  if (hasPendingDialog) app.pending.state.dialog = { ...pendingDialog, target: app.tableOrders.captureTarget(), draftId: ++app.pending.draftSequence };
  return app.state;
}

function routeOf(app) {
  if (app.session.state.screen === 'waiter') return app.tableOrders.state.screen;
  if (app.session.state.screen === 'admin') return app.administration.state.page;
  return app.session.state.screen;
}

module.exports = { arrange, routeOf };
