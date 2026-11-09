const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');

const MAGIC = Buffer.from('ARRABAK1');
function keyFor(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 12) throw new Error('Passphrase must have at least 12 characters');
  return crypto.scryptSync(passphrase, salt, 32);
}
function outside(directory, file) {
  const base = fs.realpathSync(directory);
  const parent = fs.realpathSync(path.dirname(path.resolve(file)));
  const relative = path.relative(base, parent);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Backup must be outside the live data directory');
  }
}
function writeNew(file, content) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    fs.rmSync(file, { force: true });
    throw error;
  }
  fs.closeSync(fd);
}
function validate(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok')) throw new Error('Database integrity check failed');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database foreign key check failed');
    for (const table of ['orders', 'local_users']) db.prepare(`SELECT count(*) FROM ${table}`).get();
  } finally { db.close(); }
}
async function createBackup(sourceDirectory, destination, passphrase) {
  const source = path.join(fs.realpathSync(sourceDirectory), 'arra.sqlite');
  if (!fs.statSync(source).isFile()) throw new Error('Live database not found');
  outside(sourceDirectory, destination);
  const salt = crypto.randomBytes(16), nonce = crypto.randomBytes(12);
  const key = keyFor(passphrase, salt);
  const temp = fs.mkdtempSync(path.join(sourceDirectory, '.backup-'));
  let db;
  try {
    db = new DatabaseSync(source, { readOnly: true });
    const snapshot = path.join(temp, 'snapshot.sqlite');
    await backup(db, snapshot);
    validate(snapshot);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([cipher.update(fs.readFileSync(snapshot)), cipher.final()]);
    const content = Buffer.concat([MAGIC, salt, nonce, cipher.getAuthTag(), encrypted]);
    writeNew(destination, content);
  } finally {
    key.fill(0);
    if (db) db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
function restoreBackup(backupFile, destinationDirectory, passphrase) {
  const directory = fs.realpathSync(destinationDirectory);
  if (fs.readdirSync(directory).length !== 0) throw new Error('Restore directory must be empty');
  const content = fs.readFileSync(backupFile);
  if (content.length < 52 || !content.subarray(0, 8).equals(MAGIC)) throw new Error('Invalid backup');
  const key = keyFor(passphrase, content.subarray(8, 24));
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, content.subarray(24, 36));
    decipher.setAuthTag(content.subarray(36, 52));
    plaintext = Buffer.concat([decipher.update(content.subarray(52)), decipher.final()]);
  } finally { key.fill(0); }
  const temp = path.join(directory, '.restore-' + crypto.randomBytes(16).toString('hex'));
  try {
    fs.writeFileSync(temp, plaintext, { flag: 'wx', mode: 0o600 });
    validate(temp);
    writeNew(path.join(directory, 'arra.sqlite'), plaintext);
  } finally {
    plaintext.fill(0);
    fs.rmSync(temp, { force: true });
  }
}
module.exports = { createBackup, restoreBackup };

