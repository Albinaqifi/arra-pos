// Scenario convenience only: production views receive separate feature props.
function orderProps(app) {
  const language = app.settings.state.language;
  return {
    catalog: app.catalog.view({ language, pendingItems: app.tableOrders.selectedPendingItems(), addProduct: id => app.pending.addProduct(id) }),
    order: app.tableOrders.orderView({ language, now: app.shell.view().now, onCorrect: id => app.correction.open(id) }),
    pending: app.pending.rowsView(), send: app.sendWorkflow.buttonView(), move: app.moveWorkflow.buttonView(), bill: app.billing.buttonView(),
  };
}
function viewOf(app) { return Object.assign({}, ...Object.values(orderProps(app))); }
module.exports = { orderProps, viewOf };
