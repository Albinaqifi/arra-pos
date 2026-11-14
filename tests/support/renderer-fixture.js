// Test arrangements for the owners split out of the renderer. This initializer
// is deliberately outside production code; assertions and actions use owners.
const sessionFields = new Set(['user', 'pass', 'waiter', 'pinFor', 'pin', 'waiterMessage', 'switching', 'handoffNotice', 'adminAccess']);
const adminPages = new Set(['admin', 'operationalReports', 'financialVisibility', 'orderHistory', 'adminSentCorrections', 'employeeConfig', 'menuConfig', 'tableConfig']);

function arrange(app, values) {
  for (const [name, value] of Object.entries(values)) {
    if (name === 'screen') {
      if (adminPages.has(value)) { app.session.state.screen = 'admin'; app.administration.state.page = value; }
      else if (['tables', 'order', 'history'].includes(value)) { app.session.state.screen = 'waiter'; app.state.screen = value; }
      else app.session.state.screen = value;
    } else if (sessionFields.has(name)) app.session.state[name] = value;
    else if (name === 'language') app.settings.state.language = value;
    else app.state[name] = value;
  }
  return app.state;
}

function routeOf(app) {
  if (app.session.state.screen === 'waiter') return app.state.screen;
  if (app.session.state.screen === 'admin') return app.administration.state.page;
  return app.session.state.screen;
}

module.exports = { arrange, routeOf };
