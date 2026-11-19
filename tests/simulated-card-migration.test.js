const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { historicalDatabase } = require('./support/historical-database');

test('approval survives upgrade and restart and holds payment and closing until a simulated fiscal receipt is accepted', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-card-migration-'));
  let db = historicalDatabase(47).openDatabase(dir);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01');
    INSERT INTO dining_tables(id,area) VALUES(1,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,70,'sample');`);
  db.close();
  db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir,{recursive:true,force:true}); });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,51);
  assert.throws(() => db.prepare('INSERT INTO simulated_card_approvals VALUES(1,1,69,1)').run());
  db.exec("INSERT INTO simulated_card_intents VALUES(1,1,1,70,1); INSERT INTO simulated_card_intent_results VALUES(1,'approved',1)");
  db.prepare('INSERT INTO simulated_card_approvals VALUES(1,1,70,1)').run();
  for (const sql of [
    'UPDATE simulated_card_approvals SET amount=71',
    'DELETE FROM simulated_card_approvals',
    'INSERT OR REPLACE INTO simulated_card_approvals VALUES(1,1,70,2)',
    "INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,2,70,'cash','B')",
    "INSERT INTO fiscal_checkout_sales VALUES(1,1,'simulation',NULL,'cash','{}',2)",
    "INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,2,70,'card','A')",
    "UPDATE orders SET status='completed' WHERE id=1",
    "UPDATE business_days SET closed_at=2,closed_by=1,issues='' WHERE closed_at IS NULL",
    "INSERT INTO shift_closes(shift_id,closed_at,actor_id,snapshot) VALUES(1,2,1,'{}')",
    "INSERT INTO account_a_closes(day_id,actor_id,closed_at,snapshot) VALUES(1,1,2,'{}')",
    "INSERT INTO fiscal_daily_reports(day_id,actor_id,mode,device_id,expected,previous_closure,previous_document,device_date,started_at) VALUES(1,1,'simulation','','{}',1,'0000001','010120',2)"
  ]) assert.throws(() => db.exec(sql), sql);
  db.close(); db = openDatabase(dir);
  assert.equal(db.prepare('SELECT amount FROM simulated_card_approvals WHERE bill_id=1').get().amount,70);
  db.exec(`INSERT INTO fiscal_checkout_sales VALUES(1,1,'simulation',NULL,'card','{}',2);
    INSERT INTO fiscal_checkout_attempts VALUES(1,1,2);
    INSERT INTO fiscal_checkout_results VALUES(1,'accepted','simulation','SIM-1',NULL,2);
    INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,2,70,'card','A');
    UPDATE orders SET status='completed' WHERE id=1;`);
  assert.equal(db.prepare('SELECT count(*) n FROM simulated_card_open_approvals').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,1);
});

test('unresolved simulated terminal intents survive restart, block payment and closing, and record immutable outcomes', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-card-intent-'));
  let db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir,{recursive:true,force:true}); });
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01');
    INSERT INTO dining_tables(id,area) VALUES(1,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,70,'sample');`);
  assert.throws(() => db.exec('INSERT INTO simulated_card_intents VALUES(1,1,1,69,1)'));
  db.exec('INSERT INTO simulated_card_intents VALUES(1,1,1,70,1)');
  for (const sql of [
    'INSERT INTO simulated_card_intents VALUES(2,1,1,70,2)',
    'INSERT OR REPLACE INTO simulated_card_intents VALUES(1,1,1,70,2)',
    'UPDATE simulated_card_intents SET amount=60',
    'DELETE FROM simulated_card_intents',
    "INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,2,70,'cash','B')",
    "INSERT INTO fiscal_checkout_sales VALUES(1,1,'simulation',NULL,'cash','{}',2)",
    "UPDATE orders SET status='completed' WHERE id=1",
    "UPDATE business_days SET closed_at=2,closed_by=1,issues='' WHERE closed_at IS NULL",
    "INSERT INTO shift_closes(shift_id,closed_at,actor_id,snapshot) VALUES(1,2,1,'{}')",
    "INSERT INTO account_a_closes(day_id,actor_id,closed_at,snapshot) VALUES(1,1,2,'{}')",
    "INSERT INTO fiscal_daily_reports(day_id,actor_id,mode,device_id,expected,previous_closure,previous_document,device_date,started_at) VALUES(1,1,'simulation','','{}',1,'0000001','010120',2)"
  ]) assert.throws(() => db.exec(sql),sql);
  db.close(); db = openDatabase(dir);
  assert.equal(db.prepare('SELECT count(*) n FROM simulated_card_open_intents').get().n,1);
  db.exec("INSERT INTO simulated_card_intent_results VALUES(1,'declined',2)");
  assert.equal(db.prepare('SELECT count(*) n FROM simulated_card_open_intents').get().n,0);
  assert.throws(() => db.exec("INSERT OR REPLACE INTO simulated_card_intent_results VALUES(1,'approved',3)"));
  assert.throws(() => db.exec('UPDATE simulated_card_intent_results SET status=\'approved\''));
  assert.throws(() => db.exec('DELETE FROM simulated_card_intent_results'));
  db.exec("INSERT INTO simulated_card_intents VALUES(2,1,1,70,3); INSERT INTO simulated_card_intent_results VALUES(2,'approved',4)");
  assert.equal(db.prepare('SELECT count(*) n FROM simulated_card_open_intents').get().n,1);
  assert.throws(() => db.exec("INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,2,70,'cash','B')"));
  db.exec('INSERT INTO simulated_card_approvals VALUES(1,1,70,4)');
  assert.equal(db.prepare('SELECT count(*) n FROM simulated_card_open_intents').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM simulated_card_open_approvals').get().n,1);
  assert.throws(() => db.exec('INSERT INTO simulated_card_intents VALUES(3,1,1,70,5)'));
});
