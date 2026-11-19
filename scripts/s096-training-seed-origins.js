// Only the newly created, isolated S-096 sample profile may receive these
// fictional marks. They are not classifications of real restaurant products.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function seedFreshTrainingOrigins(directory, id, appData) {
  if (!/^[a-f0-9]{32}$/.test(id) || !path.isAbsolute(directory) || !appData || !path.isAbsolute(appData) ||
      path.resolve(directory).toLowerCase() !== path.join(path.resolve(appData), 'Arra POS S096 Simulated Training', id).toLowerCase()) {
    throw Error('Invalid training profile');
  }
  if (!fs.lstatSync(directory).isDirectory()) throw Error('Invalid training profile');
  for (const file of ['SAMPLE-DATA-ONLY', 'ARRA-SETUP-COMPLETE', 'arra.sqlite']) {
    if (!fs.lstatSync(path.join(directory, file)).isFile()) throw Error('Invalid training profile');
  }
  const ready = path.join(directory, 'S096-TRAINING-READY');
  if (fs.existsSync(ready)) throw Error('Training profile already initialized');
  const db = new DatabaseSync(path.join(directory, 'arra.sqlite'));
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='pf700_commissioning_enrollment'").get() ||
          ['orders', 'bills', 'payments', 'menu_product_fiscal_origin'].some(table => db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())) {
        throw Error('Training profile is not fresh');
      }
      const count = db.prepare('SELECT COUNT(*) AS count FROM menu_products').get().count;
      if (!Number.isSafeInteger(count) || count < 1) throw Error('Training menu missing');
      const inserted = db.prepare('INSERT INTO menu_product_fiscal_origin(product_id, domestic) SELECT id, 0 FROM menu_products').run().changes;
      if (Number(inserted) !== count) throw Error('Training setup incomplete');
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  } finally { db.close(); }
  fs.writeFileSync(ready, 'Fictional sample fiscal marks only. No real sales.\n', { flag: 'wx' });
}

if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw Error('Invalid request');
    seedFreshTrainingOrigins(process.argv[2], process.argv[3], process.env.APPDATA);
    console.log('Fictional sample fiscal marks prepared.');
  } catch {
    console.error('Training setup could not be completed. Preserve the sample profile and ask for help.');
    process.exitCode = 1;
  }
}

module.exports = { seedFreshTrainingOrigins };
