// Creates a new isolated sample database; it never opens an existing database.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { openDatabase } = require('./database');
const { seedSampleIdentities, entryIdentities } = require('./sample-accounts');
const { seedTables } = require('./tables');
const { seedMenu } = require('./menu');
const { seedScenarios } = require('./seed-sample-scenarios');

function createSampleScenarios(passwords, waiterPin, transferPin) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-sample-'));
  let db;
  try {
    db = openDatabase(directory);
    seedSampleIdentities(db, passwords, waiterPin, transferPin);
    seedTables(db);
    seedMenu(db);
    seedScenarios(db);
    fs.writeFileSync(path.join(directory, 'SAMPLE-DATA-ONLY'), 'Development sample data only. No real sales.\n', { flag: 'wx' });
    return directory;
  } finally {
    if (db) db.close();
  }
}

if (require.main === module) {
  if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Run interactively: node src/desktop/create-sample-scenarios.js');
    process.exit(1);
  }
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true); process.stdin.resume();
  const values = []; let value = '';
  const prompts = [...entryIdentities.map(([name]) => `Choose a distinct sample password for ${name}: `), 'Choose a four-digit sample waiter PIN: ', 'Choose a six-digit sample transfer manager PIN: '];
  const prompt = () => process.stdout.write(prompts[values.length]);
  prompt();
  process.stdin.on('keypress', (char, key) => {
    if (key.ctrl && key.name === 'c') { process.stdin.setRawMode(false); process.exit(1); }
    if (key.name === 'return' || key.name === 'enter') {
      process.stdout.write('\n');
      values.push(value); value = '';
      if (values.length < prompts.length) return prompt();
      process.stdin.setRawMode(false); process.stdin.pause();
      try {
        const directory = createSampleScenarios(values.slice(0, 4), values[4], values[5]);
        console.log(`Fresh sample database created at ${directory}`);
        console.log('Seeded four paid bills: cash A, cash B, card A, and cash B transferred to A; plus unpaid and open order examples.');
        console.log(`Launch with: npx electron . --sample-data-directory="${directory}"`);
      } catch (_) { console.error('Sample setup failed. Check credential requirements and run again to create a fresh database.'); process.exitCode = 1; }
      finally { values.fill(''); value = ''; }
    } else if (key.name === 'backspace') value = value.slice(0, -1);
    else if (char && !key.ctrl && !key.meta && value.length < 1024) value += char;
  });
}
module.exports = { createSampleScenarios };
