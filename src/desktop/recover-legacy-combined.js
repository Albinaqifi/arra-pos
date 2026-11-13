// Interactive only: secrets are never passed as command-line arguments or echoed.
const readline = require('node:readline');
const { recoverLegacyCombined } = require('./legacy-combined-recovery');
if (process.argv.length !== 4 || !process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run interactively: node src/desktop/recover-legacy-combined.js <absolute-path-to-arra.sqlite> <new-absolute-copy-directory>');
  process.exit(1);
}
console.log('Close the app first. This creates a new Combined account with access to both financial accounts in a new database copy; the original is unchanged.');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Existing waiter administrator username: ', username => {
  rl.question('New Combined username: ', newUsername => {
    rl.close();
    readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
    const values = []; let value = '';
    const prompts = ['Existing administrator password: ', 'New Combined password: ', 'Confirm new Combined password: '];
    process.stdout.write(prompts[0]);
    process.stdin.on('keypress', async (char, key) => {
      if (key.ctrl && key.name === 'c') { process.stdin.setRawMode(false); process.exit(1); }
      if (key.name === 'return' || key.name === 'enter') {
        values.push(value); value = ''; process.stdout.write('\n');
        if (values.length < prompts.length) { process.stdout.write(prompts[values.length]); return; }
        process.stdin.setRawMode(false); process.stdin.pause();
        try {
          if (values[1] !== values[2]) throw Error('Passwords differ');
          const directory = await recoverLegacyCombined(process.argv[2], process.argv[3], username, values[0], newUsername, values[1]);
          console.log(`Recovered copy created at ${directory}. Keep the original and verify the copy before replacing any data.`);
        } catch (_) { console.error('Recovery failed. Check the credentials, version, account scopes and destination. The original was not modified.'); process.exitCode = 1; }
        finally { values.fill(''); }
      } else if (key.name === 'backspace') value = value.slice(0, -1);
      else if (char && !key.ctrl && !key.meta && value.length < 1024) value += char;
    });
  });
});
