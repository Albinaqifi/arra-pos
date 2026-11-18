const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openFiscalSimulation } = require('../src/desktop/fiscal-simulation');

const sale = () => ({ paymentRef: 'sample-1', method: 'card', account: 'A', lines: [{ name: 'Sample item', unitMinor: 125, quantity: 2, taxGroup: 'sample' }] });
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-fiscal-sim-'));
  return directory;
}

test('simulation validates snapshots and prevents conflicting payment references', t => {
  const directory = fixture(), journal = openFiscalSimulation(directory);
  t.after(() => { journal.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const id = journal.prepareReceipt(sale());
  assert.equal(journal.prepareReceipt(sale()), id);
  assert.deepEqual(journal.get(id).payload, { ...sale(), totalMinor: 250 });
  assert.throws(() => journal.prepareReceipt({ ...sale(), method: 'cash' }), /conflict/);
  assert.throws(() => journal.prepareReceipt({ ...sale(), account: 'B' }), /Invalid/);
  assert.throws(() => journal.prepareReceipt({ ...sale(), lines: [{ ...sale().lines[0], taxGroup: '' }] }), /Invalid/);
  assert.throws(() => journal.prepareReceipt({ ...sale(), lines: [{ ...sale().lines[0], unitMinor: Number.MAX_SAFE_INTEGER }] }), /Invalid/);
  assert.throws(() => journal.prepareReceipt({ ...sale(), extra: 'unexpected' }), /Invalid/);
  assert.throws(() => journal.prepareReport(''), /Invalid/);
});

test('reserved attempts stay uncertain after restart and cannot be repeated, even after failure', t => {
  const directory = fixture(); let first = openFiscalSimulation(directory);
  const id = first.prepareReceipt(sale()); first.reserve(id);
  assert.equal(first.get(id).state, 'uncertain'); first.close();
  first = openFiscalSimulation(directory); const second = openFiscalSimulation(directory);
  t.after(() => { first.close(); second.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.equal(first.get(id).state, 'uncertain');
  assert.throws(() => first.reserve(id), /already reserved/);
  assert.throws(() => second.reserve(id), /already reserved/);
  first.finishSimulated(id, 'simulated_failure');
  assert.equal(second.get(id).state, 'simulated_failure');
  assert.throws(() => second.reserve(id), /already reserved/);
  assert.throws(() => second.finishSimulated(id, 'simulated_accept'));
  const report = first.prepareReport('sample-device-period'); first.reserve(report);
  assert.equal(second.get(report).state, 'uncertain');
  assert.throws(() => second.reserve(report), /already reserved/);
});

test('simulation history is append-only and never reports fiscal success', t => {
  const directory = fixture(), journal = openFiscalSimulation(directory);
  const id = journal.prepareReceipt(sale()); journal.reserve(id); journal.finishSimulated(id, 'simulated_accept');
  assert.equal(journal.get(id).state, 'simulated_accept'); journal.close();
  const db = new DatabaseSync(path.join(directory, 'fiscal-simulation.sqlite'));
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  for (const sql of ["UPDATE operations SET payload='{}'", 'DELETE FROM attempts', 'DELETE FROM outcomes', "INSERT OR REPLACE INTO outcomes VALUES(1,'simulated_failure',1)"]) assert.throws(() => db.exec(sql));
});
