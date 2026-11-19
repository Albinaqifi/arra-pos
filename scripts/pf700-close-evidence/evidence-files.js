const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');

function markerPath(directory, serial) {
  const device = createHash('sha256').update(serial).digest('hex');
  return path.join(directory, device + '.bill2-close-capture.jsonl');
}

function appendRecord(fd, record) {
  fs.writeFileSync(fd, JSON.stringify(record) + '\n', 'utf8');
  fs.fsyncSync(fd);
}

function openIncidentDatabase() {
  if (process.env.ARRA_CLOSE_EVIDENCE_LOCKED !== '1') throw Error('Use the Windows launcher.');
  const uri = pathToFileURL(path.join(process.env.APPDATA, 'Arra POS PF700 Commissioning', 'arra.sqlite'));
  // start.ps1 has excluded writers and checked for SQLite sidecars.
  uri.search = 'mode=ro&immutable=1';
  const db = new DatabaseSync(uri.href, { readOnly:true, allowExtension:false });
  try {
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA temp_store=MEMORY');
    return db;
  } catch (error) { db.close(); throw error; }
}

module.exports = { markerPath, appendRecord, openIncidentDatabase };
