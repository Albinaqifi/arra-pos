// Creates an isolated sample database in a new temporary directory, never an existing database.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { openDatabase } = require('./database');
const { createSampleAccounts, identities } = require('./sample-accounts');
if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run interactively: node src/desktop/create-sample-accounts.js');
  process.exit(1);
}
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true); process.stdin.resume();
const passwords = []; let password = '';
function prompt() { process.stdout.write(`Choose a distinct sample password for ${identities[passwords.length][0]}: `); }
prompt();
process.stdin.on('keypress', (char, key) => {
  if (key.ctrl && key.name === 'c') { process.stdin.setRawMode(false); process.exit(1); }
  if (key.name === 'return' || key.name === 'enter') {
    process.stdout.write('\n'); passwords.push(password); password = '';
    if (passwords.length < identities.length) return prompt();
    process.stdin.setRawMode(false); process.stdin.pause();
    let db;
    try {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-sample-'));
      db = openDatabase(directory); createSampleAccounts(db, passwords);
      fs.writeFileSync(path.join(directory, 'SAMPLE-DATA-ONLY'), 'Development sample data only. No real sales.\n', { flag: 'wx' });
      console.log(`Sample database created at ${directory}`);
      console.log(`Launch with: npx electron . --sample-data-directory="${directory}"`);
    } catch (_) { console.error('Sample setup failed; use four distinct nonempty passwords.'); process.exitCode = 1; }
    finally { passwords.fill(''); if (db) db.close(); }
  } else if (key.name === 'backspace') password = password.slice(0, -1);
  else if (char && !key.ctrl && !key.meta && password.length < 1024) password += char;
});
