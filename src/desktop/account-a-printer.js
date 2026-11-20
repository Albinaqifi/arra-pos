const { hasPermissions } = require('./permissions');
const { cashMovementPayload } = require('./pf700-cash-movement');
async function handle(event, req, allowed, db, session, adapter) {
  const cashAction = req && typeof req === 'object' && req.action === 'accountAPrinterCashMovement';
  const notSent = () => cashAction ? {ok:false,outcome:'not_sent'} : {ok:false};
  if (!allowed(event) || !req || typeof req !== 'object' || Array.isArray(req) ||
      Object.getPrototypeOf(req) !== Object.prototype) return notSent();
  const keys = Reflect.ownKeys(req);
  const daily = req.action === 'accountAPrinterDailyControl' && keys.length === 1;
  const cash = req.action === 'accountAPrinterCashMovement' && keys.length === 3 &&
    keys.includes('direction') && keys.includes('amount');
  const payload = cash ? cashMovementPayload(req.direction, req.amount) : null;
  if (!daily && (!cash || !payload)) return notSent();
  let invoked = false;
  try {
    const actor = session.currentUserId();
    const scope = db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope;
    const permission = scope === 'combined' ? 'business_days.close' : scope === 'A' ? 'employees.view' : null;
    if (!actor || actor !== session.authenticatedUserId() || !permission ||
        !hasPermissions(db, session, permission)) return {...notSent(),denied:true};
    if (!adapter || typeof adapter[daily ? 'printDailyControl' : 'printCashMovement'] !== 'function') return notSent();
    const generation = session.identityGeneration?.();
    const authorized = () => allowed(event) && actor === session.currentUserId() && actor === session.authenticatedUserId() &&
      generation === session.identityGeneration?.() && db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope === scope &&
      hasPermissions(db, session, permission);
    invoked = true;
    const result = await (daily ? adapter.printDailyControl(authorized) : adapter.printCashMovement(payload, authorized));
    if (daily) return {ok:result === 'accepted'};
    const outcome = ['accepted','declined','unknown','not_sent'].includes(result) ? result : 'unknown';
    return {ok:outcome === 'accepted',outcome};
  } catch (_) { return cashAction && invoked ? {ok:false,outcome:'unknown'} : notSent(); }
}
module.exports = { handle };
