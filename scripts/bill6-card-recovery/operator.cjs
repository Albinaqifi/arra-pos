'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {DatabaseSync} = require('node:sqlite');
const {createInterface} = require('node:readline');
const {createSession} = require('../../src/desktop/session');
const {hasPermissions} = require('../../src/desktop/permissions');
const {runRecovery} = require('./recover.cjs');

// The recovery has no general serial bridge. Its child admits only one
// fixed sequence, with the two item payloads from the private incident kit.
function serialTransport(mode) {
  let child, output, dead = false;
  return {
    async exchange(frame) {
      if (dead) throw Error('HOLD_CONNECTION');
      if (!child) {
        child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'serial.ps1'),'-Mode',mode],
          {windowsHide:true,stdio:['pipe','pipe','ignore']});
        child.on('error', () => { dead = true; child.stdout.destroy(); });
        child.stdin.on('error', () => { dead = true; child.stdout.destroy(); });
        output = createInterface({input:child.stdout,crlfDelay:Infinity})[Symbol.asyncIterator]();
      }
      let timer;
      try {
        child.stdin.write(frame.toString('hex')+'\n');
        const row = await Promise.race([output.next(),new Promise((_,reject) => {
          timer = setTimeout(() => reject(Error('HOLD_CONNECTION_TIMEOUT')),25000);
        })]);
        if (row.done || !/^(?:[0-9A-F]{2}){1,101}$/.test(row.value)) throw Error('HOLD_CONNECTION_REPLY');
        return Buffer.from(row.value,'hex');
      } catch(error) { dead = true; throw error; }
      finally { clearTimeout(timer); }
    },
    async close() {
      if (!child) return;
      if (child.exitCode !== null || child.signalCode) return;
      const ended = new Promise(resolve => child.once('close',resolve));
      child.stdin.end();
      const timer = setTimeout(() => child.kill(),1500);
      try { await ended; } finally { clearTimeout(timer); }
    }
  };
}

function local(file) {
  if (!/^[A-Za-z]:\\/.test(file) || fs.realpathSync.native(file).toLowerCase() !== file.toLowerCase()) throw Error('HOLD_ORIGINAL_FILES');
  return file;
}
function permitted(db, session) {
  const actor = session.currentUserId();
  return actor !== null && actor === session.authenticatedUserId() &&
    db.prepare("SELECT scope FROM financial_scopes WHERE user_id=?").get(actor)?.scope === 'combined' &&
    hasPermissions(db,session,'business_days.close');
}
async function main() {
  const mode = process.argv[2];
  if (process.platform !== 'win32' || !['Review','Finish'].includes(mode) || process.argv.length !== 3 ||
      process.stdin.isTTY || process.stdout.isTTY) throw Error('HOLD_USE_LAUNCHER');
  const binding = require('./incident.json');
  if (mode === 'Finish' && require('./edition.json').reviewOnly !== false) throw Error('HOLD_REVIEW_ONLY_EDITION');
  if (binding.itemHex?.length !== 2 || !binding.itemHex.every(hex => /^(?:[0-9a-f]{2}){6,91}$/.test(hex))) throw Error('HOLD_BINDING');
  const directory = local(path.join(process.env.APPDATA,'Arra POS PF700 Commissioning'));
  const database = local(path.join(directory,'arra.sqlite'));
  const ledgerDir = local(path.join(process.env.LOCALAPPDATA,'Arra POS','PF700 commissioning','fast-pay-v1'));
  if (fs.existsSync(path.join(directory,'SAMPLE-DATA-ONLY'))) throw Error('HOLD_ORIGINAL_FILES');
  const reader = createInterface({input:process.stdin,crlfDelay:Infinity});
  const answers = reader[Symbol.asyncIterator]();
  async function ask(prompt) {
    console.log(prompt);
    const row = await answers.next();
    if (row.done || row.value.length > 2048) throw Error('HOLD_INPUT');
    return row.value;
  }
  let db, lock, device;
  try {
    const lockFile = local(path.join(ledgerDir,'worker.sqlite'));
    lock = new DatabaseSync(path.toNamespacedPath(lockFile),{allowExtension:false});
    lock.exec('BEGIN IMMEDIATE');
    const reviewOnly = mode === 'Review';
    db = new DatabaseSync(path.toNamespacedPath(database),{allowExtension:false,readOnly:reviewOnly});
    db.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY');
    if (reviewOnly) db.exec('PRAGMA query_only=ON');
    else db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT');
    const session = createSession(db);
    const username = Buffer.from(await ask('USERNAME'),'base64').toString('utf8');
    const auth = session.signIn({username,password:Buffer.from(await ask('PASSWORD'),'base64').toString('utf8')});
    if (!auth?.ok || !permitted(db,session)) throw Error('HOLD_COMBINED_SIGN_IN');
    device = serialTransport(mode);
    const result = await runRecovery({db,ledgerDir,binding,reviewOnly,actorId:session.currentUserId(),
      exchange:device.exchange,reauthorize:() => permitted(db,session),
      confirm:async () => !reviewOnly && await ask('CONFIRM') === 'CONFIRMED'});
    if (!['reviewed','cancelled','confirmed','already-confirmed','awaiting-local-publication'].includes(result.status)) throw Error('HOLD_RESULT');
    const number = result.documentNumber;
    console.log('RESULT '+result.status+(/^\d{7}$/.test(number) ? ' '+number : ''));
  } finally {
    try { if (device) await device.close(); }
    finally { try { db?.close(); } finally { lock?.close(); reader.close(); } }
  }
}
if (require.main === module) main().catch(error => {
  const code = /^HOLD_[A-Z0-9_]{1,65}$/.test(error.message) ? error.message : 'HOLD_INCONCLUSIVE';
  console.log('STOP '+code); process.exitCode=1;
});
module.exports = {serialTransport,permitted};
