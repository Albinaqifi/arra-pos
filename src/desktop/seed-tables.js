const { openDatabase } = require('./database');
const { seedTables } = require('./tables');

if (process.argv.length !== 3) {
  console.error('Usage: node src/desktop/seed-tables.js <app-data-directory>');
  process.exitCode = 1;
} else {
  const db = openDatabase(process.argv[2]);
  try {
    seedTables(db);
    console.log('Sample tables are ready.');
  } finally {
    db.close();
  }
}
