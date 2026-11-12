// Sample-only business-day upgrade. Password entry is hidden and the original is never changed.
const readline = require('node:readline');
const { upgradeSampleBusinessDays } = require('./sample-day-upgrade');
if (process.argv.length !== 3 || !process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run interactively: node src/desktop/upgrade-sample-business-days.js <absolute-path-to-sample-arra.sqlite>');
  process.exit(1);
}
console.log('Version 22 through 30 sample data only. This copies the database, grants business-day closing only to the authenticated combined sample account, and leaves the original unchanged.');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Combined sample username: ', username => {
  rl.close(); process.stdout.write('Combined sample password: ');
  readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume(); let password = '';
  process.stdin.on('keypress', async (char, key) => {
    if (key.ctrl && key.name === 'c') { process.stdin.setRawMode(false); process.exit(1); }
    if (key.name === 'return' || key.name === 'enter') {
      process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n');
      try {
        const directory = await upgradeSampleBusinessDays(process.argv[2], username, password);
        console.log(`Upgraded sample database: ${directory}`);
        console.log(`Launch with: npx electron . --sample-data-directory="${directory}"`);
      } catch (_) { console.error('Sample upgrade failed. Check the sample marker, version, file, and combined account.'); process.exitCode = 1; }
      finally { password = ''; }
    } else if (key.name === 'backspace') password = password.slice(0, -1);
    else if (char && !key.ctrl && !key.meta && password.length < 1024) password += char;
  });
});
