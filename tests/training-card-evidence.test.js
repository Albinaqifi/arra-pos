const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createTrainingPf700 } = require('../src/desktop/training-pf700');
const attempt = 'a'.repeat(64), otherAttempt = 'b'.repeat(64);

const receipt = { billId: 23, account: 'A', currency: 'MKD', method: 'card', total: 290,
  lines: [{name:'Coffee',taxGroup:'В',taxRate:10,unitPrice:70,quantity:2},
    {name:'Beer',taxGroup:'А',taxRate:18,unitPrice:150,quantity:1}] };

test('training printer stores exact card evidence atomically and only matches the original receipt after restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'arra-card-evidence-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const file = path.join(dir,'simulated-pf700.sqlite');
  let printer = createTrainingPf700(dir);
  assert.equal(printer.matchRecordedSale(receipt,attempt),false);
  assert.equal(fs.existsSync(file),false);
  await assert.rejects(printer.registerSale(receipt),/Missing simulated checkout attempt/);
  assert.equal((await printer.registerSale(receipt,{simulationAttempt:attempt})).status,'accepted');
  printer = createTrainingPf700(dir);
  assert.equal(printer.matchRecordedSale(receipt,attempt),true);
  assert.equal(printer.matchRecordedSale(receipt,otherAttempt),false);
  assert.equal(printer.matchRecordedSale({...receipt,lines:[{...receipt.lines[0],name:'Tea'},receipt.lines[1]]},attempt),false);
  assert.equal(printer.matchRecordedSale({...receipt,method:'cash'},attempt),false);
  assert.equal(printer.matchRecordedSale({...receipt,billId:24},attempt),false);
  const db = new DatabaseSync(file);
  try {
    assert.throws(() => db.exec("UPDATE card_sale_evidence SET snapshot='{}'"));
    assert.throws(() => db.exec('DELETE FROM card_sale_evidence'));
    assert.throws(() => db.prepare('INSERT OR REPLACE INTO card_sale_evidence VALUES(?,?,?)').run(23,attempt,'{}'));
    assert.equal(db.prepare('SELECT count(*) AS n FROM documents WHERE bill=23').get().n,1);
  } finally { db.close(); }
});

test('legacy aggregate-only documents do not become exact evidence through retries', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'arra-card-evidence-old-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const file = path.join(dir,'simulated-pf700.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE documents (doc INTEGER PRIMARY KEY,bill INTEGER UNIQUE,z INTEGER UNIQUE,stamp TEXT,
    cash INTEGER NOT NULL,card INTEGER NOT NULL,taxA INTEGER NOT NULL,taxV INTEGER NOT NULL) STRICT;
    INSERT INTO documents VALUES(1,NULL,1,'010120',0,0,0,0),(2,23,NULL,NULL,0,290,150,140);`);
  db.close();
  const printer = createTrainingPf700(dir);
  assert.equal(printer.matchRecordedSale(receipt,attempt),false);
  await assert.rejects(printer.registerSale(receipt,{simulationAttempt:attempt}),/Unverified simulated receipt/);
  assert.equal(printer.matchRecordedSale(receipt,attempt),false);
  const check = new DatabaseSync(file,{readOnly:true});
  try {
    assert.equal(check.prepare('SELECT count(*) AS n FROM documents WHERE bill=23').get().n,1);
    assert.equal(check.prepare('SELECT count(*) AS n FROM card_sale_evidence').get().n,0);
  } finally { check.close(); }
});
