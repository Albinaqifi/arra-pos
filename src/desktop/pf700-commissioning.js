const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function enroll(db) {
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE pf700_commissioning_enrollment (
      id INTEGER PRIMARY KEY CHECK (id = 1)
    ) STRICT;
    INSERT INTO pf700_commissioning_enrollment VALUES (1);
    CREATE TRIGGER pf700_keep_enrollment BEFORE DELETE ON pf700_commissioning_enrollment
      BEGIN SELECT RAISE(ABORT, 'PF700 enrollment is permanent'); END;
    COMMIT;`);
}

function isCommissioned(db) {
  const table = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='pf700_commissioning_enrollment'").get();
  return Boolean(table && db.prepare('SELECT 1 FROM pf700_commissioning_enrollment WHERE id=1').get());
}

function isCommissionedDirectory(directory) {
  const db = new DatabaseSync(path.join(directory, 'arra.sqlite'), { readOnly: true });
  try { return isCommissioned(db); } finally { db.close(); }
}

// Backups restore the database alone. Keep the one attended trial consumed
// for this device and Windows account even if a pre-sale backup is restored.
function deviceTrial(serial, localData = process.env.LOCALAPPDATA) {
  if (typeof serial !== 'string' || !/^[A-Za-z0-9]{11}$/.test(serial) || !localData || !path.isAbsolute(localData)) {
    throw Error('Check the local PF700 settings.');
  }
  const directory = path.join(localData, 'Arra POS', 'PF700 commissioning');
  const name = createHash('sha256').update(serial).digest('hex') + '.used';
  const file = path.join(directory, name);
  return {
    available() {
      try { fs.statSync(file); return false; }
      catch (error) { if (error.code === 'ENOENT') return true; throw error; }
    },
    claim() {
      fs.mkdirSync(directory, { recursive: true });
      const descriptor = fs.openSync(file, 'wx');
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    }
  };
}

module.exports = { enroll, isCommissioned, isCommissionedDirectory, deviceTrial };
