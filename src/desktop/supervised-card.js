const { createHash, randomBytes } = require('node:crypto');
const { isCommissioned, cardTrialLedger } = require('./pf700-commissioning');
const { ownsOrder } = require('./order-ownership');
const { buildReceipt, failure } = require('./fiscal-checkout');
const { canEncodePf700Receipt } = require('./pf700-checkout-protocol');

function supervised(adapter) {
  return adapter?.mode === 'device' && adapter.supervisedCardTrial === true && adapter.requireOrigins === true &&
    ['cardTrialAvailable','claimCardTrial','cardDispatchAvailable','claimCardDispatch','recordCardOutcome','readCardTrial','canRegister']
      .every(key => typeof adapter[key] === 'function');
}

function trial(db) {
  return db.prepare(`SELECT i.*, r.status AS outcome, EXISTS(SELECT 1 FROM fiscal_checkout_attempts a WHERE a.bill_id=i.bill_id) AS dispatched
    FROM pf700_card_intents i LEFT JOIN pf700_card_outcomes r ON r.intent_id=i.id`).get();
}

// A database-only backup can predate the terminal charge or PF700 sale.
// Compare the separately retained phases even when the original adapter is
// unavailable. An incomplete commit across the two stores stays on hold.
function ledgerMatches(db, adapter) {
  const local = trial(db);
  if (!isCommissioned(db)) return !local;
  try {
    const marker = supervised(adapter) ? adapter.readCardTrial() : cardTrialLedger().read();
    if (!marker || !local) return !marker && !local;
    return marker.token === local.token && marker.deviceHash === createHash('sha256').update(local.device_id).digest('hex') &&
      marker.outcome === local.outcome && marker.dispatched === !!local.dispatched;
  } catch { return false; }
}

function blocksClose(db) {
  // Unenrolled historical databases have no physical trial. Period close also
  // runs while importing their pre-trial fiscal history.
  if (!isCommissioned(db)) return false;
  return !ledgerMatches(db) || !!db.prepare('SELECT 1 FROM pf700_card_open_intents').get();
}

function matchesBill(db, intent, total) {
  const receipt = JSON.parse(intent.receipt);
  return intent.receipt === JSON.stringify(buildReceipt(db,intent.bill_id,'card',total,
    {mode:'device',requireOrigins:true,domesticProduct:receipt.domesticProduct}));
}

function attachPreview(db, bill, adapter) {
  if (!ledgerMatches(db,adapter)) { bill.physicalCardHold = true; return; }
  const commissioned = isCommissioned(db);
  const controls = commissioned && supervised(adapter);
  if (commissioned && !controls) bill.physicalCardUnavailable = true;
  if (controls) {
    bill.physicalCardControls = true;
    try { bill.physicalCardAvailable = !trial(db) && adapter.cardTrialAvailable() === true; }
    catch { bill.physicalCardAvailable = false; }
  }
  if (!bill.id) return;
  const intent = db.prepare('SELECT * FROM pf700_card_open_intents WHERE bill_id=?').get(bill.id);
  if (intent) {
    if (!matchesBill(db,intent,bill.total) || (bill.fiscal &&
        (bill.fiscal.deviceId !== intent.device_id || JSON.stringify(bill.fiscal.receipt) !== intent.receipt))) {
      bill.physicalCardHold = true;
      return;
    }
    const profileMatches = !!controls && adapter.deviceId === intent.device_id &&
      adapter.domesticProduct === JSON.parse(intent.receipt).domesticProduct;
    let canDispatch = false;
    if (profileMatches && intent.outcome === 'approved') {
      try { canDispatch = adapter.cardDispatchAvailable(intent.token) === true; } catch { /* keep on hold */ }
    }
    bill.physicalCardIntent = {id:intent.id,status:intent.outcome || 'prepared',profileMatches,canDispatch};
  }
}

// This capability lives only in the session that received the first terminal
// instruction. After a restart the operator can check and record an observed
// approval, but cannot release an unknown result as a decline.
function terminalAction(db,session,request,actor,adapter,capability) {
  const bill = db.prepare(`SELECT b.order_id AS orderId,b.total,o.status,o.retired_empty AS retired FROM bills b
    JOIN orders o ON o.id=b.order_id WHERE b.id=?`).get(request.billId);
  if (!bill || !ownsOrder(db,session,bill.orderId)) return {ok:false,error:'Access denied'};
  if (!supervised(adapter) || !isCommissioned(db)) return failure('profile');
  if (bill.retired || bill.status !== 'open' || db.prepare('SELECT 1 FROM payments WHERE bill_id=?').get(request.billId)) return failure('selection');
  const intent = trial(db);
  if (request.preparePhysicalCard) {
    if (intent) return failure(intent.bill_id === request.billId && !intent.outcome ? 'terminalUnknown' : 'scope');
    if (!adapter.cardTrialAvailable()) return failure('scope');
    const receipt = buildReceipt(db,request.billId,'card',bill.total,adapter);
    if (receipt.ok === false) return receipt;
    if (!canEncodePf700Receipt(receipt)) return failure('unavailable');
    if (adapter.canRegister(receipt,null) !== true) return failure('scope');
    const token = randomBytes(16).toString('hex');
    // SQLite validates all competing holds before consuming the external trial.
    // The calling transaction commits before returning a terminal instruction.
    db.prepare('INSERT INTO pf700_card_intents(id,bill_id,actor_id,device_id,token,receipt,created_at) VALUES(1,?,?,?,?,?,?)')
      .run(request.billId,actor,adapter.deviceId,token,JSON.stringify(receipt),Date.now());
    adapter.claimCardTrial(token);
    capability.declineToken = randomBytes(32).toString('hex');
    capability.generation = session.identityGeneration?.();
    capability.actor = actor;
    return {ok:true,data:{intentId:1,declineToken:capability.declineToken}};
  }
  if (!intent || intent.bill_id !== request.billId || intent.id !== request.physicalCardIntentId ||
      intent.device_id !== adapter.deviceId) return failure('selection');
  if (!matchesBill(db,intent,bill.total)) return failure('cardTrialHold');
  const status = request.confirmPhysicalCard ? 'approved' : 'declined';
  if (intent.outcome) return intent.outcome === status ? {ok:true} : failure('selection');
  if (status === 'declined' && (capability.actor !== actor || capability.generation !== session.identityGeneration?.() ||
      request.declineToken !== capability.declineToken)) return failure('terminalUnknown');
  db.prepare('INSERT INTO pf700_card_outcomes(intent_id,status,actor_id,recorded_at) VALUES(?,?,?,?)')
    .run(intent.id,status,actor,Date.now());
  adapter.recordCardOutcome(intent.token,status);
  delete capability.declineToken;
  return {ok:true};
}

module.exports = { supervised, ledgerMatches, blocksClose, matchesBill, attachPreview, terminalAction };
