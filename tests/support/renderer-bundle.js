const path = require('node:path');
const esbuild = require('esbuild');

function moduleSource(entryPoint, globalName) {
  return esbuild.buildSync({ entryPoints: [entryPoint], bundle: true, format: 'iife', globalName, write: false, charset: 'utf8' }).outputFiles[0].text;
}

let source;
module.exports = function rendererBundle() {
  if (!source) {
    const bundled = esbuild.buildSync({
      stdin: {
        contents: `export * from './src/App.js';
export * from './src/admin/index.js';
export * from './src/shared/waiter-ui.js';
export * from './src/shared/desktop-bridge.js';
export * from './src/session/SessionModel.js';
export * from './src/session/AccountEntry.js';
export * from './src/settings/LanguageSettings.js';
export * from './src/admin/AdminWorkspace.js';
export * from './src/catalog/CatalogModel.js';
export * from './src/orders/TableOrderModel.js';
export * from './src/printing/PrintingSession.js';
export * from './src/printing/PrintJobs.js';
export * from './src/printing/TestPrintJobs.js';
export * from './src/waiter/DesktopBill.js';
export * from './src/waiter/Tables.js';
export * from './src/waiter/Order.js';
export * from './src/waiter/MoveTable.js';
export * from './src/waiter/Bill.js';`,
        resolveDir: path.resolve(__dirname, '../..'),
      },
      bundle: true, format: 'iife', globalName: 'RendererModules', write: false, charset: 'utf8',
    }).outputFiles[0].text;
    // Legacy test aliases refer to actual module exports. Evaluate the shared
    // graph once in each VM, even when older fixtures request several helpers.
    source = `if (typeof RendererModules === 'undefined') {\n${bundled}\n}\n` +
      ['WaiterDemo', 'PrintJobs', 'TestPrintJobs', 'DesktopBill', 'renderTables', 'renderOrder', 'renderMoveTable', 'renderBill', 'waiterTranslate', 'printDestination', 'style', 'SentItemCorrection'].map(name => `var ${name} = RendererModules.${name};`).join('\n') +
      '\nvar ArraComponents = RendererModules;\n';
  }
  return source;
};
module.exports.moduleSource = moduleSource;
