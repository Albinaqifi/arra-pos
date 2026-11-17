// The Windows setup console supplies credentials over a private stdin pipe.
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('./database');
const { seedSampleIdentities } = require('./sample-accounts');
const { validPassword } = require('./session');
const { seedTables } = require('./tables');
const { seedMenu } = require('./menu');

const directory = process.argv[2];
let db, values;
try {
  if (process.argv.length !== 3 || !directory || !path.isAbsolute(directory) || process.stdin.isTTY) throw new Error('Invalid setup invocation');
  const input = fs.readFileSync(0, 'utf8');
  if (Buffer.byteLength(input, 'utf8') > 8192) throw new Error('Invalid setup input');
  values = JSON.parse(input);
  if (!Array.isArray(values) || values.length !== 6 || !values.slice(0, 4).every(validPassword) ||
      new Set(values.slice(0, 4)).size !== 4 || typeof values[4] !== 'string' || !/^\d{4}$/.test(values[4]) ||
      typeof values[5] !== 'string' || !/^\d{6}$/.test(values[5])) throw new Error('Invalid setup input');
  // Exclusive creation prevents setup from modifying any previous sample data.
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'SAMPLE-DATA-ONLY'), 'Sample data only. No real sales.\n', { flag: 'wx' });
  db = openDatabase(directory);
  seedSampleIdentities(db, values.slice(0, 4), values[4], values[5]);
  seedTables(db); seedMenu(db);
  console.log('Sample setup complete. Open Arra POS Sample from the Start menu.');
} catch (_) {
  console.error('Sample setup failed. Check the input. Existing data was not overwritten. If a new incomplete directory was created, move it aside before trying again.');
  process.exitCode = 1;
} finally {
  if (values && Array.isArray(values)) values.fill('');
  if (db) db.close();
}
