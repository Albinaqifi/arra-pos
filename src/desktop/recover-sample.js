// Sample-only recovery. Password entry is hidden and the original is never changed.
const readline = require('node:readline');
const { recoverSample } = require('./sample-recovery');
if (process.argv.length !== 3 || !process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run interactively: node src/desktop/recover-sample.js <absolute-path-to-sample-arra.sqlite>');
  process.exit(1);
}
console.log('Sample data only. This copies the database into a new temporary directory; the original is not modified.');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Existing sample username: ', username => {
  rl.close(); process.stdout.write('Existing sample password: ');
  readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume(); let password = '';
  process.stdin.on('keypress', async (char, key) => {
    if (key.ctrl && key.name === 'c') { process.stdin.setRawMode(false); process.exit(1); }
    if (key.name === 'return' || key.name === 'enter') {
      process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n');
      try {
        const directory = await recoverSample(process.argv[2], username, password);
        console.log(`Recovered sample database: ${directory}`);
        console.log(`Launch with: npx electron . --sample-data-directory="${directory}"`);
      } catch (_) { console.error('Sample recovery failed. Check the sample file and account, and ensure no scoped owner exists.'); process.exitCode = 1; }
      finally { password = ''; }
    } else if (key.name === 'backspace') password = password.slice(0, -1);
    else if (char && !key.ctrl && !key.meta && password.length < 1024) password += char;
  });
});
