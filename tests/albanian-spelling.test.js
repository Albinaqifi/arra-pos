const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Albanian interface and report labels use e while interpolated names are preserved', () => {
  const sources = ['src/shared/sq.json', 'src/admin/config-sq.json', 'src/admin/activity-i18n.js', 'src/admin/finance-i18n.js', 'src/admin/history-reports-i18n.js', 'src/admin/shell-i18n.js', 'src/admin/transfer-i18n.js', 'src/desktop-status.js', 'src/desktop/main.js', 'src/desktop/bill-history.js', 'src/desktop/windows-test-printer.js'];
  for (const source of sources) assert.doesNotMatch(fs.readFileSync(source, 'utf8'), /[ëË]/, source);
  const context = { React: { Component: class {}, createElement() {} } };
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  assert.match(context.ArraComponents.translate('sq', 'waiter.Table {id}', { id: 'Bërna' }), /Bërna/);
});
