const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Construct a real historical schema using exactly the migrations through the
// requested version. Later migrations must not run while seeding the fixture.
function historicalDatabase(version) {
  const filename = require.resolve('../../src/desktop/database');
  const source = fs.readFileSync(filename, 'utf8');
  const firstLaterMigration = source.indexOf(`  { version: ${version + 1},`);
  const end = source.indexOf('\n];', firstLaterMigration);
  if (firstLaterMigration < 0 || end < 0) throw new Error('Historical migration boundary not found');
  const historical = source.slice(0, firstLaterMigration) + source.slice(end);
  const module = { exports: {} };
  const databaseRequire = createRequire(filename);
  vm.runInNewContext(`(function(require,module,exports){${historical}\n})`)(databaseRequire, module, module.exports);
  return module.exports;
}

// Older test fixtures assemble prior schemas by removing later migrations.
// Remove later fiscal objects before rebuilding their referenced tables.
const removeFiscalSchemaSql = `
  DROP TRIGGER IF EXISTS simulated_card_daily_guard;
  DROP TRIGGER IF EXISTS simulated_card_account_a_guard;
  DROP TRIGGER IF EXISTS simulated_card_day_guard;
  DROP TRIGGER IF EXISTS simulated_card_shift_guard;
  DROP TRIGGER IF EXISTS simulated_card_order_guard;
  DROP TRIGGER IF EXISTS simulated_card_payment_guard;
  DROP TRIGGER IF EXISTS simulated_card_sale_guard;
  DROP TRIGGER IF EXISTS simulated_card_intent_payment_guard;
  DROP VIEW IF EXISTS simulated_card_open_intents;
  DROP TABLE IF EXISTS simulated_card_intent_results;
  DROP TABLE IF EXISTS simulated_card_intents;
  DROP VIEW IF EXISTS simulated_card_open_approvals;
  DROP TABLE IF EXISTS simulated_card_attempts;
  DROP TABLE IF EXISTS simulated_card_approvals;
  DROP TRIGGER IF EXISTS order_item_snapshot_fiscal_origin;
  DROP TABLE IF EXISTS order_item_fiscal_origin;
  DROP TABLE IF EXISTS menu_product_fiscal_origin;
  DROP TRIGGER IF EXISTS fiscal_daily_checkout_guard;
  DROP VIEW IF EXISTS fiscal_daily_current;
  DROP TABLE IF EXISTS fiscal_daily_nonissuances;
  DROP TABLE IF EXISTS fiscal_daily_confirmations;
  DROP TABLE IF EXISTS fiscal_daily_reports;
  DROP TRIGGER IF EXISTS fiscal_checkout_day_guard;
  DROP TRIGGER IF EXISTS fiscal_checkout_shift_guard;
  DROP TRIGGER IF EXISTS fiscal_checkout_payment_guard;
  DROP VIEW IF EXISTS fiscal_checkout_open_device_sales;
  DROP VIEW IF EXISTS fiscal_checkout_verified_results;
  DROP TABLE IF EXISTS fiscal_checkout_baselines;
  DROP TABLE IF EXISTS fiscal_checkout_results;
  DROP TABLE IF EXISTS fiscal_checkout_attempts;
  DROP TABLE IF EXISTS fiscal_checkout_sales;
  DROP TRIGGER IF EXISTS order_item_snapshot_fiscal_tax;
  DROP TABLE IF EXISTS order_item_fiscal_tax;
  DROP TABLE IF EXISTS menu_product_fiscal_tax;
`;
module.exports = { historicalDatabase, removeFiscalSchemaSql };
