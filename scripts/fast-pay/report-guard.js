'use strict';

function installFastReportGuard(db) {
  db.exec(`BEGIN IMMEDIATE;
    CREATE VIEW IF NOT EXISTS fast_pay_v1_uncovered_devices AS
      SELECT s.device_id FROM fast_pay_v1_status s
      WHERE s.receipt_status != 'acknowledged' OR NOT EXISTS (
        SELECT 1 FROM fiscal_checkout_attempts a
        JOIN fiscal_checkout_verified_results r ON r.attempt_id=a.id
        WHERE a.bill_id=s.bill_id AND r.status='accepted'
          AND r.source='device-' || s.device_id AND r.reference=s.document_number);
    CREATE TRIGGER IF NOT EXISTS fast_pay_v1_z_guard BEFORE INSERT ON fiscal_daily_reports
      WHEN NEW.mode='device' AND EXISTS (
        SELECT 1 FROM fast_pay_v1_uncovered_devices WHERE device_id=NEW.device_id)
      BEGIN SELECT RAISE(ABORT,'Resolve outstanding PF700 receipts before fiscal close'); END;
    COMMIT;`);
}

function awaitingReceipt(db, adapter) {
  if (adapter?.mode !== 'device') return false;
  const installed = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='view' AND name='fast_pay_v1_uncovered_devices'").get();
  return !!installed && !!db.prepare('SELECT 1 FROM fast_pay_v1_uncovered_devices WHERE device_id=? LIMIT 1').get(adapter.deviceId);
}

module.exports = { installFastReportGuard, awaitingReceipt };
