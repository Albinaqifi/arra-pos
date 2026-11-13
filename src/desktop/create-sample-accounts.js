// Creates a new isolated sample database, or fills missing sample identities in a marked one.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { openDatabase } = require('./database');
const { seedSampleIdentities, entryIdentities } = require('./sample-accounts');
const existing = process.argv[2];
if (process.argv.length > 3 || !process.stdin.isTTY || !process.stdout.isTTY || (existing && (!path.isAbsolute(existing) || !fs.existsSync(path.join(existing, 'SAMPLE-DATA-ONLY')) || !fs.existsSync(path.join(existing, 'arra.sqlite'))))) {
  console.error('Run interactively: node src/desktop/create-sample-accounts.js [absolute marked sample directory]');
  process.exit(1);
}
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true); process.stdin.resume();
const values = []; let value = '';
const prompts = [...entryIdentities.map(([name]) => `Choose a distinct sample password for ${name}: `), 'Choose a four-digit sample waiter PIN: ', 'Choose a six-digit sample transfer manager PIN: '];
function prompt() { process.stdout.write(prompts[values.length]); }
prompt();
process.stdin.on('keypress', (char, key) => {
  if (key.ctrl && key.name === 'c') { process.stdin.setRawMode(false); process.exit(1); }
  if (key.name === 'return' || key.name === 'enter') {
    process.stdout.write('\n'); values.push(value); value = '';
    if (values.length < prompts.length) return prompt();
    process.stdin.setRawMode(false); process.stdin.pause();
    let db, directory;
    try {
      directory = existing || fs.mkdtempSync(path.join(os.tmpdir(), 'arra-sample-'));
      db = openDatabase(directory); seedSampleIdentities(db, values.slice(0, 4), values[4], values[5]);
      if (!existing) fs.writeFileSync(path.join(directory, 'SAMPLE-DATA-ONLY'), 'Development sample data only. No real sales.\n', { flag: 'wx' });
      console.log(`Sample identities prepared at ${directory}. Existing accounts and credentials were left unchanged.`);
      console.log(`Launch with: npx electron . --sample-data-directory="${directory}"`);
    } catch (_) { console.error('Sample setup failed. Check the sample directory and credential requirements.'); process.exitCode = 1; }
    finally { values.fill(''); if (db) db.close(); }
  } else if (key.name === 'backspace') value = value.slice(0, -1);
  else if (char && !key.ctrl && !key.meta && value.length < 1024) value += char;
});
