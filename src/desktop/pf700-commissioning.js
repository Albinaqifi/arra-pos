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
    wasClaimed() {
      try {
        const fileInfo = fs.lstatSync(file);
        return fileInfo.isFile() && fileInfo.size === 0;
      } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    },
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

// The single supervised card trial is shared by commissioned profiles on this
// Windows account. A database restore cannot reissue its terminal invitation
// or reclaim its fiscal dispatch. The files contain no serial or bill data.
function cardTrialLedger(localData = process.env.LOCALAPPDATA) {
  if (!localData || !path.isAbsolute(localData)) throw Error('Card trial storage unavailable');
  const directory = path.join(localData, 'Arra POS', 'PF700 commissioning');
  const claimFile = path.join(directory, 'supervised-card.claim');
  const outcomeFile = path.join(directory, 'supervised-card.outcome');
  const dispatchFile = path.join(directory, 'supervised-card.dispatch');
  function readMarker(file) {
    try {
      const info = fs.lstatSync(file);
      const isOutcome = file === outcomeFile;
      if (!info.isFile() || info.size !== (isOutcome ? 106 : 97)) throw Error('Card trial record needs reconciliation');
      const value = fs.readFileSync(file, 'utf8');
      const format = isOutcome ? /^[a-f0-9]{32}:[a-f0-9]{64}:(approved|declined)$/ : /^[a-f0-9]{32}:[a-f0-9]{64}$/;
      if (!format.test(value)) throw Error('Card trial record needs reconciliation');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  function key(serial, token) {
    if (typeof serial !== 'string' || !/^[A-Za-z0-9]{11}$/.test(serial) || typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) {
      throw Error('Invalid card trial settings');
    }
    return token + ':' + createHash('sha256').update(serial).digest('hex');
  }
  function writeOnce(file, value) {
    fs.mkdirSync(directory, { recursive: true });
    const fd = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, value);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  }
  return {
    read() {
      const claim = readMarker(claimFile), outcome = readMarker(outcomeFile), dispatch = readMarker(dispatchFile);
      if ((outcome && !outcome.startsWith(claim + ':')) ||
          (dispatch && (dispatch !== claim || outcome !== claim + ':approved'))) throw Error('Card trial record needs reconciliation');
      if (!claim) return null;
      const [token, deviceHash] = claim.split(':');
      return { token, deviceHash, outcome: outcome && outcome.slice(-8), dispatched: Boolean(dispatch) };
    },
    claim(serial, token) {
      if (readMarker(outcomeFile) || readMarker(dispatchFile)) throw Error('Card trial already used');
      writeOnce(claimFile, key(serial, token));
    },
    outcome(serial, token, status) {
      const value = key(serial, token);
      if (!['approved','declined'].includes(status) || readMarker(claimFile) !== value || readMarker(dispatchFile)) {
        throw Error('Card trial outcome does not match an outstanding claim');
      }
      writeOnce(outcomeFile, value + ':' + status);
    },
    dispatch(serial, token) {
      const value = key(serial, token);
      if (readMarker(claimFile) !== value || readMarker(outcomeFile) !== value + ':approved') throw Error('Card trial approval differs');
      writeOnce(dispatchFile, value);
    }
  };
}

module.exports = { enroll, isCommissioned, isCommissionedDirectory, deviceTrial, cardTrialLedger };
