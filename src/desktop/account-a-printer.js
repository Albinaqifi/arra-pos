const { hasPermissions } = require('./permissions');
const { cashMovementPayload } = require('./pf700-cash-movement');
async function handle(event, req, allowed, db, session, adapter) {
  if (!allowed(event) || !req || typeof req !== 'object' || Array.isArray(req) ||
      Object.getPrototypeOf(req) !== Object.prototype) return {ok:false};
  const keys = Reflect.ownKeys(req);
  const daily = req.action === 'accountAPrinterDailyControl' && keys.length === 1;
  const cash = req.action === 'accountAPrinterCashMovement' && keys.length === 3 &&
    keys.includes('direction') && keys.includes('amount');
  const payload = cash ? cashMovementPayload(req.direction, req.amount) : null;
  if (!daily && (!cash || !payload)) return {ok:false};
  try {
    const actor = session.currentUserId();
    const scope = db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope;
    const permission = scope === 'combined' ? 'business_days.close' : scope === 'A' ? 'employees.view' : null;
    if (!actor || actor !== session.authenticatedUserId() || !permission ||
        !hasPermissions(db, session, permission)) return {ok:false,denied:true};
    if (!adapter || typeof adapter[daily ? 'printDailyControl' : 'printCashMovement'] !== 'function') return {ok:false};
    const generation = session.identityGeneration?.();
    const authorized = () => allowed(event) && actor === session.currentUserId() && actor === session.authenticatedUserId() &&
      generation === session.identityGeneration?.() && db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope === scope &&
      hasPermissions(db, session, permission);
    return {ok: (await (daily ? adapter.printDailyControl(authorized) : adapter.printCashMovement(payload, authorized))) === 'accepted'};
  } catch (_) { return {ok:false}; }
}
module.exports = { handle };
