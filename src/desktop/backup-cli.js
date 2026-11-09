const readline = require('node:readline');
const { createBackup, restoreBackup } = require('./backup');

function promptSecret(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('An interactive terminal is required');
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = () => {};
    let answered = false;
    rl.on('close', () => { if (!answered) reject(new Error('Passphrase entry cancelled')); });
    rl.on('SIGINT', () => rl.close());
    process.stdout.write(prompt);
    rl.question('', value => {
      answered = true;
      rl.close();
      process.stdout.write('\n');
      resolve(value);
    });
  });
}
async function main() {
  const [operation, source, destination, ...extra] = process.argv.slice(2);
  if (!['backup', 'restore'].includes(operation) || !source || !destination || extra.length) throw new Error('Usage: node src/desktop/backup-cli.js backup <live-data-directory> <new-backup-file> | restore <backup-file> <empty-directory>');
  const passphrase = await promptSecret('Backup passphrase: ');
  if (operation === 'backup') {
    if (passphrase !== await promptSecret('Repeat passphrase: ')) throw new Error('Passphrases do not match');
    await createBackup(source, destination, passphrase);
  } else restoreBackup(source, destination, passphrase);
  console.log(operation === 'backup' ? 'Backup created and checked.' : 'Restore created and checked. Verify sample orders and users before use.');
}
main().catch(() => { console.error('Backup or restore failed. Check the paths, passphrase and available space; existing files were not intentionally replaced.'); process.exitCode = 1; });
