// Run against the unpacked restaurant trial. Exercise the real Combined/A/B
// preview handler and the persistent Z guard with two synthetic business days.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const desktop = path.resolve(process.argv[2], 'program/resources/app/src/desktop');
const { installFastReportGuard, awaitingReceipt } = require(path.join(desktop, 'fast-pay-report-guard'));
const { handle } = require(path.join(desktop, 'account-a-bills'));

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE business_days(id,opened_at,closed_at);
    CREATE TABLE payments(id,bill_id,method,amount,account,paid_at);
    CREATE TABLE payment_business_days(payment_id,business_day_id);
    CREATE TABLE payment_account_corrections(id,payment_id);
    CREATE TABLE transfer_managers(user_id);
    CREATE TABLE user_permissions(user_id,permission);
    CREATE TABLE financial_scopes(user_id,scope);
    CREATE TABLE fixture_jobs(payment_id,bill_id,device_id,document_number,receipt_status);
    CREATE VIEW fast_pay_v1_status AS SELECT * FROM fixture_jobs;
    CREATE TABLE fiscal_checkout_attempts(id,bill_id);
    CREATE TABLE fiscal_checkout_verified_results(attempt_id,status,source,reference);
    CREATE TABLE fiscal_daily_reports(day_id,mode,device_id);
    INSERT INTO business_days VALUES(1,100,200),(2,200,NULL);
    INSERT INTO payments VALUES(10,5,'cash',70,'A',150),(11,6,'card',150,'A',300);
    INSERT INTO payment_business_days VALUES(10,1),(11,2);
    INSERT INTO fixture_jobs VALUES(10,5,'device',NULL,'unconfirmed'),(11,6,'device','0000032','acknowledged');
    INSERT INTO fiscal_checkout_attempts VALUES(1,6);
    INSERT INTO fiscal_checkout_verified_results VALUES(1,'accepted','device-device','0000032');
    INSERT INTO user_permissions VALUES(1,'employees.view'),(2,'employees.view'),(3,'employees.view');
    INSERT INTO financial_scopes VALUES(1,'combined'),(2,'A'),(3,'B');
  `);
  return db;
}

test('pending receipts from another day prevent a new same-device Z reservation until verified', t => {
  const db = fixture(t);
  installFastReportGuard(db);
  installFastReportGuard(db);
  const device = {mode:'device',deviceId:'device'};
  const reserve = () => db.exec("INSERT INTO fiscal_daily_reports VALUES(2,'device','device')");
  for (const state of ['queued','unconfirmed','acknowledged']) {
    db.prepare("UPDATE fixture_jobs SET receipt_status=?,document_number='0000031' WHERE bill_id=5").run(state);
    assert.equal(awaitingReceipt(db,device),true);
    assert.throws(reserve,/outstanding PF700 receipts/);
  }
  assert.equal(awaitingReceipt(db,{...device,deviceId:'separate'}),false);
  db.exec("INSERT INTO fiscal_checkout_attempts VALUES(2,5)");
  db.exec("INSERT INTO fiscal_checkout_verified_results VALUES(2,'accepted','device-device','0000031')");
  assert.equal(awaitingReceipt(db,device),false);
  reserve();
});

test('Combined can inspect receipt status for the selected day without printing or changing report totals', async t => {
  const db = fixture(t);
  const request = (actor, dayId) => handle({}, {action:'accountABillsPreview',dayId}, () => true, db,
    {currentUserId:() => actor,authenticatedUserId:() => actor}, () => assert.fail('Preview attempted to print'));
  const prior = await request(1,1);
  const current = await request(1,2);
  assert.equal(prior.data.records[0].receiptStatus,'unconfirmed');
  assert.equal(current.data.card,150);
  assert.equal(current.data.cash,0);
  assert.equal(current.data.records.length,1);
  assert.equal(current.data.records[0].documentNumber,'0000032');
  const accountA = await request(2,2);
  assert.equal(accountA.data.digest,current.data.digest);
  assert.equal(accountA.data.records[0].receiptStatus,undefined);
  assert.equal((await request(3,2)).denied,true);
});
