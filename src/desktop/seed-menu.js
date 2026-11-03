const { openDatabase } = require('./database');
const { seedMenu } = require('./menu');

if (process.argv.length !== 3) {
  console.error('Usage: node src/desktop/seed-menu.js <app-data-directory>');
  process.exitCode = 1;
} else {
  const db = openDatabase(process.argv[2]);
  try {
    seedMenu(db);
    console.log('Sample menu is ready.');
  } finally {
    db.close();
  }
}
