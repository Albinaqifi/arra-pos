// Development-only, interactive first-account setup. The password never appears in arguments or output.
const readline = require('node:readline');
const { openDatabase } = require('./database');
const { bootstrap } = require('./session');
if (process.argv.length !== 3 || !process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Usage: node src/desktop/bootstrap-user.js <app-data-directory> (interactive terminal required)');
  process.exit(1);
}
console.log('Create the first Combined administrator for an empty development database.');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Development username: ', username => {
  rl.close();
  process.stdout.write('Development password: ');
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let password = '';
  process.stdin.on('keypress', (char, key) => {
    if (key.ctrl && key.name === 'c') { process.stdin.setRawMode(false); process.exit(1); }
    if (key.name === 'return' || key.name === 'enter') {
      process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n');
      let db;
      try {
        db = openDatabase(process.argv[2]);
        bootstrap(db, username, password);
        console.log('Development Combined administrator created. Sign in and create a separate waiter.');
      } catch (_) { console.error('Account setup failed. Check the input and ensure the database has no existing accounts or operational records.'); process.exitCode = 1; }
      finally { password = ''; if (db) db.close(); }
    } else if (key.name === 'backspace') password = password.slice(0, -1);
    else if (char && !key.ctrl && !key.meta && password.length < 1024) password += char;
  });
});
