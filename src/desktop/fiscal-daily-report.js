const { recordAudit } = require('./audit');
const { isCommissioned } = require('./pf700-commissioning');

const working = new WeakMap();
function flights(db) {
  if (!working.has(db)) working.set(db, new Set());
  return working.get(db);
}

function saved(db, dayId) {
  return db.prepare(`SELECT d.id AS attemptId,d.day_id AS dayId,d.actor_id AS actor,d.mode,d.device_id AS deviceId,d.expected,
    d.previous_closure AS previousClosure,d.previous_document AS previousDocumentNumber,d.device_date AS deviceDate,
    c.report_number AS reportNumber FROM fiscal_daily_current d
    LEFT JOIN fiscal_daily_confirmations c USING(day_id) WHERE d.day_id=?`).get(dayId);
}

function deviceSales(db, dayId) {
  return !!db.prepare(`SELECT 1 FROM fiscal_checkout_sales s JOIN payments p ON p.bill_id=s.bill_id
    JOIN payment_business_days pd ON pd.payment_id=p.id WHERE s.mode='device' AND pd.business_day_id=? LIMIT 1`).get(dayId);
}

function requiresDevice(db, dayId) {
  return isCommissioned(db) || deviceSales(db,dayId);
}

function lastUnissuedAttempt(db, dayId) {
  return db.prepare(`SELECT n.attempt_id AS id FROM fiscal_daily_nonissuances n
    JOIN fiscal_daily_reports d ON d.id=n.attempt_id WHERE d.day_id=?
    ORDER BY n.attempt_id DESC LIMIT 1`).get(dayId)?.id;
}

function matches(adapter, record) {
  return adapter?.mode === record.mode && (adapter.deviceId ?? '') === record.deviceId;
}

function validAdapter(adapter) {
  return typeof adapter?.issueDailyReport === 'function' && typeof adapter.reconcileDailyReport === 'function' &&
    ((adapter.mode === 'simulation' && !adapter.deviceId && typeof adapter.simulatedDocumentNumber === 'function') ||
     (adapter.mode === 'device' && typeof adapter.deviceId === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(adapter.deviceId)));
}

// Match each individual effective-A payment to its immutable registered sale.
// Matching aggregate totals alone cannot distinguish equal days or a transfer.
function coverage(db, dayId, report, adapter) {
  if (require('./fast-pay-report-guard').awaitingReceipt(db,adapter)) return {reason:'unresolved'};
  if (require('./supervised-card').blocksClose(db)) return {reason:'unresolved'};
  if (!report) return {reason:'coverage'};
  if (!report.count) return {reason:'empty'};
  if (db.prepare(`SELECT 1 FROM fiscal_checkout_attempts a LEFT JOIN fiscal_checkout_verified_results r ON r.attempt_id=a.id
    LEFT JOIN payments p ON p.bill_id=a.bill_id WHERE r.status IS NULL OR (r.status='accepted' AND p.id IS NULL)
    LIMIT 1`).get() || db.prepare(`SELECT 1 FROM fiscal_daily_current d LEFT JOIN fiscal_daily_confirmations c USING(day_id)
      WHERE c.day_id IS NULL LIMIT 1`).get()) return {reason:'unresolved'};

  const source = adapter.mode === 'device' ? 'device-' + adapter.deviceId : 'simulation';
  const otherDays = db.prepare(`SELECT p.bill_id AS billId FROM fiscal_checkout_verified_results r JOIN fiscal_checkout_attempts a ON a.id=r.attempt_id
    JOIN payments p ON p.bill_id=a.bill_id JOIN payment_business_days pd ON pd.payment_id=p.id
    LEFT JOIN fiscal_daily_confirmations c ON c.day_id=pd.business_day_id
    WHERE r.source=? AND r.status='accepted' AND pd.business_day_id<>? AND c.day_id IS NULL`).iterate(source,dayId);
  for (const row of otherDays) {
    // v45 rehearsals used a fresh printer for each receipt. They have no
    // document in the persistent training printer's current registers.
    try {
      if (adapter.mode === 'device' || adapter.simulatedDocumentNumber(row.billId) !== null) return {reason:'period'};
    } catch { return {reason:'unavailable'}; }
  }

  const rows = db.prepare(`SELECT p.id,p.bill_id AS billId,p.method,p.amount,s.receipt,r.reference,r.evidence,
    EXISTS(SELECT 1 FROM pf700_card_intents i WHERE i.bill_id=p.bill_id AND r.source='device-' || i.device_id AND s.method='card') AS supervisedCard
    FROM fiscal_checkout_verified_results r JOIN fiscal_checkout_attempts a ON a.id=r.attempt_id
    JOIN fiscal_checkout_sales s ON s.bill_id=a.bill_id JOIN payments p ON p.bill_id=s.bill_id
    JOIN payment_business_days pd ON pd.payment_id=p.id
    WHERE r.source=? AND r.status='accepted' AND pd.business_day_id=? AND p.account='A' AND p.method=s.method
    ORDER BY a.id`).all(source,dayId);
  if (rows.length !== report.count || rows.length >= 9999 || report.total <= 0 || report.total > 999999999) return {reason:'coverage'};
  const payments = new Map(report.records.map(r => [r.paymentId,r]));
  const taxTotals = [0,0,0,0];
  let lastDocumentNumber;
  for (const [index, row] of rows.entries()) {
    const payment = payments.get(row.id), receipt = JSON.parse(row.receipt);
    if (!payment || payment.billId !== row.billId || payment.method !== row.method || payment.amount !== row.amount ||
      receipt.billId !== row.billId || receipt.method !== row.method || receipt.account !== 'A' ||
      receipt.currency !== 'MKD' || receipt.total !== row.amount || !Array.isArray(receipt.lines) || !receipt.lines.length) return {reason:'coverage'};
    let sum = 0;
    for (const line of receipt.lines) {
      const group = line.taxGroup === 'А' && line.taxRate === 18 ? 0 : line.taxGroup === 'В' && line.taxRate === 10 ? 2 : -1;
      if (group < 0 || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 ||
          !Number.isSafeInteger(line.unitPrice) || line.unitPrice <= 0) return {reason:'coverage'};
      const amount = line.quantity * line.unitPrice;
      sum += amount; taxTotals[group] += amount;
      if (!Number.isSafeInteger(sum) || !Number.isSafeInteger(taxTotals[group])) return {reason:'coverage'};
    }
    if (sum !== row.amount) return {reason:'coverage'};
    let documentNumber;
    if (adapter.mode === 'device') {
      const proof = JSON.parse(row.evidence);
      if (row.supervisedCard && proof.debitAmountMinor !== row.amount * 100) return {reason:'coverage'};
      if (proof.fiscalReceiptCount !== index + 1 || proof.reversalCount !== 0) return {reason:'period'};
      documentNumber = row.reference;
    } else {
      try { documentNumber = adapter.simulatedDocumentNumber(row.billId); }
      catch { return {reason:'unavailable'}; }
    }
    if (typeof documentNumber !== 'string' || !/^[0-9]{7}$/.test(documentNumber) || documentNumber === '0000000') return {reason:'coverage'};
    if (lastDocumentNumber && documentNumber <= lastDocumentNumber) return {reason:'period'};
    lastDocumentNumber = documentNumber;
  }
  if (Number(lastDocumentNumber) < rows.length || lastDocumentNumber === '9999999') return {reason:'coverage'};
  return {expected:{receiptCount:report.count,cash:report.cash,card:report.card,total:report.total,taxTotals,lastDocumentNumber}};
}

function describe(db, dayId, report, alreadyClosed, adapter) {
  const record = saved(db,dayId);
  if (record?.reportNumber) return {mode:record.mode,status:'complete',reportNumber:record.reportNumber};
  if (require('./supervised-card').blocksClose(db)) return {mode:'device',status:'blocked',reason:'unresolved'};
  if (record) return {mode:record.mode,status:flights(db).has(dayId) ? 'pending' : 'uncertain',
    canReconcile:!flights(db).has(dayId) && !!adapter && matches(adapter,record)};
  if (alreadyClosed && !deviceSales(db,dayId)) {
    // A completed internal summary stays historical unless independent
    // printer records show this day also has a fiscal period to resolve.
    if (adapter?.mode !== 'simulation') return null;
    const bills = db.prepare(`SELECT s.bill_id AS billId FROM fiscal_checkout_sales s JOIN payments p ON p.bill_id=s.bill_id
      JOIN payment_business_days pd ON pd.payment_id=p.id WHERE s.mode='simulation' AND pd.business_day_id=?`).all(dayId);
    try { if (!bills.some(row=>adapter.simulatedDocumentNumber(row.billId) !== null)) return null; }
    catch { return {mode:'simulation',status:'blocked',reason:'unavailable'}; }
  }
  if (requiresDevice(db,dayId) && adapter?.mode !== 'device') return {mode:'device',status:'blocked',reason:'unavailable'};
  if (!adapter) return null;
  if (flights(db).has(dayId)) return {mode:adapter.mode,status:'pending'};
  const {reason} = coverage(db,dayId,report,adapter);
  if (reason) return {mode:adapter.mode,status:'blocked',reason};
  const retryAfter = lastUnissuedAttempt(db,dayId);
  return {mode:adapter.mode,status:'ready',...(retryAfter ? {retryAfter} : {})};
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
}

function confirm(db, record, report, result, actor) {
  if (result?.status !== 'accepted') return false;
  const closure = record.previousClosure + 1;
  if (result.evidence?.closure !== closure || result.reference !== String(closure).padStart(4,'0') ||
      result.evidence.documentNumber !== String(Number(record.previousDocumentNumber)+1).padStart(7,'0')) return false;
  transaction(db, () => {
    const current = saved(db,record.dayId);
    if (current?.attemptId !== record.attemptId) throw Error('Stale fiscal confirmation');
    if (current.reportNumber) return;
    const now = Date.now();
    let closeId = db.prepare('SELECT id FROM account_a_closes WHERE day_id=?').get(record.dayId)?.id;
    if (!closeId) {
      const snapshot = JSON.stringify({...report,accountClosedAt:now,closedBy:record.actor});
      closeId = db.prepare('INSERT INTO account_a_closes(day_id,actor_id,closed_at,snapshot) VALUES(?,?,?,?)')
        .run(record.dayId,record.actor,now,snapshot).lastInsertRowid;
      recordAudit(db,record.actor,'close','account_a_day',record.dayId,null,{mode:record.mode,reportNumber:result.reference});
    }
    db.prepare('INSERT INTO fiscal_daily_confirmations(day_id,close_id,actor_id,report_number,document_number,confirmed_at) VALUES(?,?,?,?,?,?)')
      .run(record.dayId,closeId,actor,result.reference,result.evidence.documentNumber,now);
    recordAudit(db,actor,'confirm','fiscal_daily_report',record.dayId,null,{mode:record.mode,reportNumber:result.reference});
  });
  return true;
}

function currentDate() {
  const date = new Date();
  return [date.getDate(),date.getMonth()+1,date.getFullYear()%100].map(n=>String(n).padStart(2,'0')).join('');
}

async function handle(db, req, actor, authorized, adapter, report, originalCloseId) {
  const {dayId,mode} = req;
  if (!adapter || mode !== adapter.mode || !authorized()) return {ok:false};
  if (require('./supervised-card').blocksClose(db)) return {ok:false,error:'unresolved'};
  let record = saved(db,dayId);
  if (record && !matches(adapter,record)) return {ok:false,error:'unavailable'};
  if (record?.reportNumber) return {ok:true};
  if (flights(db).has(dayId)) return {ok:false,error:'pending'};
  const reconcile = req.action === 'accountAFiscalReconcile';
  if (reconcile !== !!record) return {ok:false,error:record ? 'uncertain' : 'unavailable'};
  if (!report || (mode !== 'device' && requiresDevice(db,dayId))) return {ok:false,error:'coverage'};
  flights(db).add(dayId);
  let reserved = false;
  let acceptingBaseline = true;
  try {
    let result;
    if (reconcile) {
      const {previousClosure,previousDocumentNumber,deviceDate} = record;
      result = await adapter.reconcileDailyReport(JSON.parse(record.expected),{previousClosure,previousDocumentNumber,deviceDate});
      if (result?.status === 'not-issued') {
        const proof = result.evidence;
        if (proof?.closure !== previousClosure || proof.documentNumber !== previousDocumentNumber ||
            proof.deviceDate !== deviceDate) return {ok:false,error:'uncertain'};
        // A delayed check from another connection may only resolve its own attempt.
        db.prepare('INSERT INTO fiscal_daily_nonissuances(attempt_id,actor_id,verified_at) VALUES(?,?,?)')
          .run(record.attemptId,actor,Date.now());
        return authorized() ? {ok:true,outcome:'not-issued'} : {ok:false,denied:true};
      }
    } else {
      if (req.retryAfter !== lastUnissuedAttempt(db,dayId)) return {ok:false,error:'review'};
      const {expected,reason} = coverage(db,dayId,report,adapter);
      if (!expected) return {ok:false,error:reason};
      const frozen = JSON.stringify(expected);
      // Preflight reads are repeatable. Only the winner of this transaction
      // may issue a Z. A process crash before the callback can send no Z.
      result = await adapter.issueDailyReport(expected,{beforeIssue(baseline) {
        if (!acceptingBaseline || reserved || !authorized() || !baseline ||
            baseline.deviceDate !== currentDate() || baseline.previousDocumentNumber !== expected.lastDocumentNumber ||
            !Number.isInteger(baseline.previousClosure) || baseline.previousClosure < 0 || baseline.previousClosure >= 9999) throw Error('Invalid report baseline');
        transaction(db, () => {
          if (req.retryAfter !== lastUnissuedAttempt(db,dayId) ||
              (db.prepare('SELECT id FROM account_a_closes WHERE day_id=?').get(dayId)?.id ?? null) !== originalCloseId ||
              JSON.stringify(coverage(db,dayId,report,adapter).expected) !== frozen) throw Error('Report period changed');
          db.prepare(`INSERT INTO fiscal_daily_reports(day_id,actor_id,mode,device_id,expected,previous_closure,previous_document,device_date,started_at)
            VALUES(?,?,?,?,?,?,?,?,?)`).run(dayId,actor,mode,adapter.deviceId ?? '',frozen,baseline.previousClosure,
              baseline.previousDocumentNumber,baseline.deviceDate,Date.now());
          record = saved(db,dayId);
        });
        reserved = true;
      }});
      if (!reserved) return authorized() ? {ok:false,error:'preflight'} : {ok:false,denied:true};
    }
    const ok = confirm(db,record,report,result,actor);
    return authorized() ? (ok ? {ok:true} : {ok:false,error:'uncertain'}) : {ok:false,denied:true};
  } catch {
    return authorized() ? {ok:false,error:(reconcile || reserved) ? 'uncertain' : 'preflight'} : {ok:false,denied:true};
  } finally { acceptingBaseline = false; flights(db).delete(dayId); }
}

module.exports = { validAdapter, describe, handle, saved, requiresDevice };
