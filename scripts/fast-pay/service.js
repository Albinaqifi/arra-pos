// Installed beside the original RC2 desktop modules in the opt-in portable kit.
const path = require('node:path');
const fs = require('node:fs');
const {createHash,randomUUID} = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { registerPayments, recordPayment } = require('./payments');
const { hasPermissions } = require('./permissions');
const { ownsOrder } = require('./order-ownership');
const { isCommissioned } = require('./pf700-commissioning');
const { buildReceipt, validFiscalAdapter, acceptedOutcome, failure } = require('./fiscal-checkout');
const { canEncodePf700Receipt } = require('./pf700-checkout-protocol');
const { ledgerMatches } = require('./supervised-card');

function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function createQueue(db) {
  transaction(db, () => {
    if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='fast_pay_v1_legacy_bills'").get()) {
      // A restored RC2 database might precede the actual printer attempt.
      // Preserve existing generated bills for their original checkout even
      // when the restored copy lacks the corresponding fiscal journal.
      db.exec(`CREATE TABLE fast_pay_v1_legacy_bills(bill_id INTEGER PRIMARY KEY REFERENCES bills(id)) STRICT;
        INSERT INTO fast_pay_v1_legacy_bills SELECT b.id FROM bills b
          WHERE NOT EXISTS(SELECT 1 FROM payments p WHERE p.bill_id=b.id);
        CREATE TRIGGER fast_pay_v1_legacy_no_insert BEFORE INSERT ON fast_pay_v1_legacy_bills
          BEGIN SELECT RAISE(ABORT,'Original bills are retained'); END;
        CREATE TRIGGER fast_pay_v1_legacy_no_update BEFORE UPDATE ON fast_pay_v1_legacy_bills
          BEGIN SELECT RAISE(ABORT,'Original bills are retained'); END;
        CREATE TRIGGER fast_pay_v1_legacy_no_delete BEFORE DELETE ON fast_pay_v1_legacy_bills
          BEGIN SELECT RAISE(ABORT,'Original bills are retained'); END;`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS fast_pay_v1_jobs (
        payment_id INTEGER PRIMARY KEY REFERENCES payments(id),
        job_token TEXT NOT NULL UNIQUE,
        order_key TEXT NOT NULL UNIQUE,
        device_id TEXT NOT NULL,
        receipt TEXT NOT NULL CHECK(json_valid(receipt))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS fast_pay_v1_claims (
        payment_id INTEGER PRIMARY KEY REFERENCES fast_pay_v1_jobs(payment_id),
        claimed_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS fast_pay_v1_baselines (
        payment_id INTEGER PRIMARY KEY REFERENCES fast_pay_v1_claims(payment_id),
        previous_document TEXT NOT NULL CHECK(length(previous_document)=7 AND
          previous_document NOT GLOB '*[^0-9]*' AND previous_document<'9999999')
      ) STRICT;
      CREATE TABLE IF NOT EXISTS fast_pay_v1_results (
        payment_id INTEGER PRIMARY KEY REFERENCES fast_pay_v1_claims(payment_id),
        status TEXT NOT NULL CHECK(status IN ('acknowledged','unconfirmed')),
        document_number TEXT, evidence TEXT CHECK(evidence IS NULL OR json_valid(evidence)),
        finished_at INTEGER NOT NULL,
        CHECK((status='acknowledged' AND document_number IS NOT NULL AND evidence IS NOT NULL)
          OR (status='unconfirmed' AND document_number IS NULL AND evidence IS NULL))
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS fast_pay_v1_verified_ack BEFORE INSERT ON fast_pay_v1_results
        WHEN NEW.status='acknowledged' AND NOT EXISTS (
          SELECT 1 FROM fast_pay_v1_baselines b JOIN payments p ON p.id=b.payment_id
          WHERE b.payment_id=NEW.payment_id AND
            NEW.document_number=printf('%07d',CAST(b.previous_document AS INTEGER)+1) AND
            json_extract(NEW.evidence,'$.documentNumber')=NEW.document_number AND
            json_extract(NEW.evidence,'$.fiscalReceiptCount') BETWEEN 1 AND 9999 AND
            NOT EXISTS(SELECT 1 FROM fast_pay_v1_results earlier
              JOIN fast_pay_v1_jobs e ON e.payment_id=earlier.payment_id
              JOIN fast_pay_v1_jobs j ON j.payment_id=NEW.payment_id
              WHERE e.device_id=j.device_id AND earlier.document_number=NEW.document_number) AND
            NOT EXISTS(SELECT 1 FROM fiscal_checkout_verified_results native
              JOIN fast_pay_v1_jobs j ON j.payment_id=NEW.payment_id
              WHERE native.source='device-'||j.device_id AND native.reference=NEW.document_number) AND
            (p.method='cash' OR json_extract(NEW.evidence,'$.debitAmountMinor')=p.amount*100))
        BEGIN SELECT RAISE(ABORT,'Invalid fast payment receipt proof'); END;
      CREATE VIEW IF NOT EXISTS fast_pay_v1_status AS
        SELECT j.payment_id,p.bill_id,p.method,j.device_id,r.document_number,
          CASE WHEN r.status IS NOT NULL THEN r.status
            WHEN c.payment_id IS NOT NULL THEN 'unconfirmed' ELSE 'queued' END AS receipt_status
        FROM fast_pay_v1_jobs j JOIN payments p ON p.id=j.payment_id
        LEFT JOIN fast_pay_v1_claims c ON c.payment_id=j.payment_id
        LEFT JOIN fast_pay_v1_results r ON r.payment_id=c.payment_id;
    `);
    for (const table of ['fast_pay_v1_jobs','fast_pay_v1_claims','fast_pay_v1_baselines','fast_pay_v1_results']) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table}
        BEGIN SELECT RAISE(ABORT,'Fast payment history is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table}
        BEGIN SELECT RAISE(ABORT,'Fast payment history is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS ${table}_no_replace BEFORE INSERT ON ${table}
        WHEN EXISTS(SELECT 1 FROM ${table} WHERE payment_id=NEW.payment_id)
        BEGIN SELECT RAISE(ABORT,'Fast payment history is immutable'); END;`);
    }
  });
}

function response(id, request, receiptStatus) {
  return {ok:true,data:{id,billId:request.billId,method:request.method,account:'A',receiptStatus}};
}

function ledgerDirectory() {
  if (!process.env.LOCALAPPDATA || !path.isAbsolute(process.env.LOCALAPPDATA)) throw Error('Receipt ledger unavailable');
  return path.join(process.env.LOCALAPPDATA,'Arra POS','PF700 commissioning','fast-pay-v1');
}

function attemptedOrder(key) {
  try { fs.lstatSync(path.join(ledgerDirectory(),key+'.order')); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function stableOrderKey(adapter,bill) {
  return createHash('sha256').update(JSON.stringify([adapter.deviceId,bill.orderId,bill.openedAt])).digest('hex');
}

function savePayment(db, session, request, adapter) {
  const bill = db.prepare(`SELECT b.order_id AS orderId,b.total,o.status,o.opened_at AS openedAt,o.retired_empty AS retired
    FROM bills b JOIN orders o ON o.id=b.order_id WHERE b.id=?`).get(request.billId);
  if (!bill || !ownsOrder(db,session,bill.orderId)) return {ok:false,error:'Access denied'};
  const existing = db.prepare('SELECT id,method,account FROM payments WHERE bill_id=?').get(request.billId);
  if (existing) {
    if (existing.method !== request.method || existing.account !== 'A') {
      return {ok:false,error:'Bill already paid with a different selection'};
    }
    const job = db.prepare('SELECT receipt_status FROM fast_pay_v1_status WHERE payment_id=?').get(existing.id);
    return response(existing.id,request,job?.receipt_status ?? 'previously-paid');
  }
  if (bill.status !== 'open' || bill.retired) return {ok:false,error:'Bill unavailable'};
  if (!ledgerMatches(db,adapter)) return failure('cardTrialHold');
  // Old intent, approval and receipt journals keep their original recovery path.
  const prior = db.prepare(`SELECT 1 FROM fast_pay_v1_legacy_bills WHERE bill_id=?1
    UNION ALL SELECT 1 FROM fiscal_checkout_sales WHERE bill_id=?1
    UNION ALL SELECT 1 FROM pf700_cash_open_intents WHERE bill_id=?1
    UNION ALL SELECT 1 FROM pf700_card_open_intents WHERE bill_id=?1
    UNION ALL SELECT 1 FROM simulated_card_open_intents WHERE bill_id=?1
    UNION ALL SELECT 1 FROM simulated_card_approvals WHERE bill_id=?1
    UNION ALL SELECT 1 FROM simulated_cash_open_intents WHERE bill_id=?1 LIMIT 1`).get({'1':request.billId});
  if (prior) return {ok:false,fiscalStatus:'blocked',error:'This bill has an earlier checkout. Use its original checkout to resolve it.'};
  const key = stableOrderKey(adapter,bill);
  if (attemptedOrder(key)) return {ok:false,fiscalStatus:'blocked',error:'This order has a prior receipt attempt. Check the original payment record.'};
  const receipt = buildReceipt(db,request.billId,request.method,bill.total,adapter);
  if (receipt.ok === false) return receipt;
  if (!canEncodePf700Receipt(receipt)) return failure('unavailable');
  if (!adapter.canRegister(receipt)) return failure('scope');
  const {response:paid} = recordPayment(db,request,bill,session.currentUserId(),null,null);
  db.prepare('INSERT INTO fast_pay_v1_jobs(payment_id,job_token,order_key,device_id,receipt) VALUES(?,?,?,?,?)')
    .run(paid.data.id,randomUUID(),key,adapter.deviceId,JSON.stringify(receipt));
  return response(paid.data.id,request,'queued');
}

// The original journal's global unresolved-sale guard can legitimately keep a
// different trial receipt out of RC2 reporting. Retain its complete proof and
// copy it only when the original constraints accept it, with no device I/O.
function publishProofs(db) {
  const receipts = db.prepare(`SELECT p.bill_id,p.actor_id,p.method,p.paid_at,j.device_id,j.receipt,c.claimed_at,
    b.previous_document,r.document_number,r.evidence,r.finished_at
    FROM fast_pay_v1_results r JOIN fast_pay_v1_claims c USING(payment_id)
    JOIN fast_pay_v1_baselines b USING(payment_id) JOIN fast_pay_v1_jobs j USING(payment_id)
    JOIN payments p ON p.id=j.payment_id
    WHERE r.status='acknowledged' AND NOT EXISTS(SELECT 1 FROM fiscal_checkout_sales s WHERE s.bill_id=p.bill_id)
    ORDER BY c.claimed_at,c.payment_id`).all();
  for (const row of receipts) {
    try {
      transaction(db, () => {
        db.prepare(`INSERT INTO fiscal_checkout_sales(bill_id,actor_id,mode,device_id,method,receipt,created_at)
          VALUES(?,?,'device',?,?,?,?)`).run(row.bill_id,row.actor_id,row.device_id,row.method,row.receipt,row.paid_at);
        const attempt = db.prepare('INSERT INTO fiscal_checkout_attempts(bill_id,started_at) VALUES(?,?)')
          .run(row.bill_id,row.claimed_at).lastInsertRowid;
        db.prepare('INSERT INTO fiscal_checkout_baselines(attempt_id,device_id,previous_document) VALUES(?,?,?)')
          .run(attempt,row.device_id,row.previous_document);
        db.prepare(`INSERT INTO fiscal_checkout_results(attempt_id,status,source,reference,evidence,ended_at)
          VALUES(?,'accepted',?,?,?,?)`).run(attempt,'device-'+row.device_id,row.document_number,row.evidence,row.finished_at);
      });
    } catch { break; }
  }
}

function receiptWorker(db, adapter) {
  let timer = null, working = false, stopped = false;
  function wake(delay = 0) {
    if (timer || working || stopped) return;
    timer = setTimeout(() => { timer = null; void drain(); },delay);
  }
  function claim() {
    return transaction(db, () => {
      const row = db.prepare(`SELECT j.payment_id,j.job_token,j.order_key,j.receipt FROM fast_pay_v1_jobs j
        WHERE j.device_id=? AND NOT EXISTS
          (SELECT 1 FROM fast_pay_v1_claims c WHERE c.payment_id=j.payment_id) ORDER BY j.payment_id LIMIT 1`).get(adapter.deviceId);
      if (!row) return null;
      // No receipt may cross an unfinished Z report. Recheck outstanding
      // work even if the operator never presses Pay again.
      if (db.prepare(`SELECT 1 FROM fiscal_daily_current d LEFT JOIN fiscal_daily_confirmations c USING(day_id)
        WHERE c.day_id IS NULL LIMIT 1`).get()) return {waitingForReport:true};
      db.prepare('INSERT INTO fast_pay_v1_claims(payment_id,claimed_at) VALUES(?,?)').run(row.payment_id,Date.now());
      return {id:row.payment_id,token:row.job_token,orderKey:row.order_key,receipt:JSON.parse(row.receipt)};
    });
  }
  async function dispatch(job) {
    let accepted;
    try {
      const result = await adapter.registerSale(job.receipt,{
        beforeOpen({previousDocumentNumber}) {
          if (stopped || typeof previousDocumentNumber !== 'string' || !/^\d{7}$/.test(previousDocumentNumber)) {
            throw Error('Invalid receipt baseline');
          }
          db.prepare('INSERT INTO fast_pay_v1_baselines(payment_id,previous_document) VALUES(?,?)')
            .run(job.id,previousDocumentNumber);
        }
      });
      accepted = acceptedOutcome({mode:'device',supervisedCardTrial:job.receipt.method === 'card'},job.receipt,result);
    } catch { /* The committed claim is sufficient to prohibit another attempt. */ }
    if (stopped) return;
    if (accepted) {
      try {
        db.prepare(`INSERT INTO fast_pay_v1_results(payment_id,status,document_number,evidence,finished_at)
          VALUES(?,'acknowledged',?,?,?)`).run(job.id,accepted.reference,accepted.evidence,Date.now());
        return;
      } catch (error) {
        // A well-shaped reply can still conflict with the saved baseline or
        // duplicate a known document. Neither proves a new issued receipt.
        if (error.errcode !== 1811) throw error; // SQLITE_CONSTRAINT_TRIGGER
      }
    }
    db.prepare("INSERT INTO fast_pay_v1_results VALUES(?,'unconfirmed',NULL,NULL,?)").run(job.id,Date.now());
  }
  async function drain() {
    if (working || stopped) return;
    working = true;
    let lock, retry = false;
    try {
      // SQLite releases this separate lock on process death. Financial writes
      // stay available while an exclusive serial operation is in progress.
      const folder = ledgerDirectory();
      fs.mkdirSync(folder,{recursive:true});
      lock = new DatabaseSync(path.join(folder,'worker.sqlite'));
      lock.exec('BEGIN IMMEDIATE');
      publishProofs(db);
      while (!stopped) {
        const job = claim();
        if (!job) break;
        if (job.waitingForReport) { retry = true; break; }
        // Database-only restoration can turn an old claim back into a queued
        // job. This second claim survives a restored or copied POS database.
        try {
          if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(job.token) ||
              !/^[0-9a-f]{64}$/.test(job.orderKey)) throw Error('Invalid receipt identity');
          for (const name of [job.orderKey+'.order',job.token+'.used']) {
            const marker = fs.openSync(path.join(folder,name),'wx');
            try { fs.fsyncSync(marker); } finally { fs.closeSync(marker); }
          }
        } catch {
          db.prepare("INSERT INTO fast_pay_v1_results VALUES(?,'unconfirmed',NULL,NULL,?)").run(job.id,Date.now());
          continue;
        }
        await dispatch(job);
        if (!stopped) publishProofs(db);
      }
    } catch (error) {
      retry = error.errcode === 5 || error.errcode === 6;
    } finally {
      lock?.close();
      working = false;
      if (retry) wake(500);
    }
  }
  return {wake,stop() { stopped = true; clearTimeout(timer); }};
}

function registerFastPayments(ipcMain, isAllowedSender, db, session, printing = null, adapter = null) {
  if (adapter?.fastPayVersion !== 1) return registerPayments(ipcMain,isAllowedSender,db,session,printing,adapter);
  if (!validFiscalAdapter(adapter) || adapter.mode !== 'device' || typeof adapter.canRegister !== 'function' ||
      adapter.requireOrigins !== true || !isCommissioned(db)) {
    throw Error('Invalid fast payment trial profile');
  }
  createQueue(db);
  const worker = receiptWorker(db,adapter);
  registerPayments({handle(channel,normalPayment) {
    ipcMain.handle(channel,(event,request) => {
      if (!isAllowedSender(event) || !request || Object.getPrototypeOf(request) !== Object.prototype) return {ok:false,error:'Invalid request'};
      if (request.account === 'B') {
        // A restored pre-Pay database must also preserve a prior cash/card A
        // attempt against reclassification as Cash B.
        if (request.method === 'cash' && Number.isSafeInteger(request.billId) && request.billId>0 &&
            Reflect.ownKeys(request).length === 3 && hasPermissions(db,session,'orders.view','orders.change')) {
          try {
            const bill = db.prepare(`SELECT b.order_id AS orderId,o.opened_at AS openedAt,
              EXISTS(SELECT 1 FROM fast_pay_v1_legacy_bills l WHERE l.bill_id=b.id) AS legacy FROM bills b
              JOIN orders o ON o.id=b.order_id WHERE b.id=? AND NOT EXISTS
              (SELECT 1 FROM payments p WHERE p.bill_id=b.id)`).get(request.billId);
            if (bill && ownsOrder(db,session,bill.orderId) && (bill.legacy || attemptedOrder(stableOrderKey(adapter,bill)))) {
              return {ok:false,fiscalStatus:'blocked',error:'This order has a prior receipt attempt. Check the original payment record.'};
            }
          } catch { return {ok:false,error:'Could not verify payment history.'}; }
        }
        return normalPayment(event,request);
      }
      if (request.fastPay !== true || Reflect.ownKeys(request).length !== 4 ||
          !['billId','account','method','fastPay'].every(key => Object.hasOwn(request,key)) ||
          !Number.isSafeInteger(request.billId) || request.billId < 1 ||
          request.account !== 'A' || !['cash','card'].includes(request.method)) return {ok:false,error:'Invalid request'};
      try {
        const result = transaction(db, () => hasPermissions(db,session,'orders.view','orders.change')
          ? savePayment(db,session,request,adapter) : {ok:false,error:'Access denied'});
        if (result.ok) worker.wake();
        return result;
      } catch { return {ok:false,error:'Could not record payment. Retry the same selection.'}; }
    });
  }},isAllowedSender,db,session,printing,adapter);
  worker.wake();
  return worker;
}

module.exports = {registerFastPayments};
