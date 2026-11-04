// Interactive sample-only setup. The PIN is never echoed or passed on the command line.
const fs = require('node:fs'), path = require('node:path'), readline = require('node:readline');
const { openDatabase } = require('./database');
const { createSampleTransferManager } = require('./sample-transfer-manager');
if (process.argv.length !== 3 || !process.stdin.isTTY || !process.stdout.isTTY || !path.isAbsolute(process.argv[2]) || !fs.existsSync(path.join(process.argv[2], 'SAMPLE-DATA-ONLY')) || !fs.existsSync(path.join(process.argv[2], 'arra.sqlite'))) {
  console.error('Run interactively: node src/desktop/create-sample-transfer-manager.js <absolute sample directory>'); process.exit(1);
}
process.stdout.write('Choose a four-digit sample transfer manager PIN: ');
readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume(); let pin = '';
process.stdin.on('keypress', (char, key) => {
  if (key.ctrl && key.name === 'c') { process.stdin.setRawMode(false); process.exit(1); }
  if (key.name === 'return' || key.name === 'enter') {
    process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); let db;
    try { db = openDatabase(process.argv[2]); createSampleTransferManager(db, pin); console.log('Sample transfer manager created.'); }
    catch (_) { console.error('Sample setup failed. Check the PIN and whether a transfer manager already exists.'); process.exitCode = 1; }
    finally { pin = ''; if (db) db.close(); }
  } else if (key.name === 'backspace') pin = pin.slice(0,-1);
  else if (char && /^\d$/.test(char) && pin.length < 4) pin += char;
});
