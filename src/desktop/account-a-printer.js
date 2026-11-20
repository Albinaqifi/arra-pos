const { hasPermissions } = require('./permissions');
async function handle(event, req, allowed, db, session, adapter) {
  if (!allowed(event) || !req || typeof req !== 'object' || Array.isArray(req) ||
      Object.getPrototypeOf(req) !== Object.prototype || Reflect.ownKeys(req).length !== 1 ||
      req.action !== 'accountAPrinterDailyControl') return {ok:false};
  try {
    const actor = session.currentUserId();
    const scope = db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope;
    const permission = scope === 'combined' ? 'business_days.close' : scope === 'A' ? 'employees.view' : null;
    if (!actor || actor !== session.authenticatedUserId() || !permission ||
        !hasPermissions(db, session, permission)) return {ok:false,denied:true};
    if (!adapter || typeof adapter.printDailyControl !== 'function') return {ok:false};
    const generation = session.identityGeneration?.();
    const authorized = () => allowed(event) && actor === session.currentUserId() && actor === session.authenticatedUserId() &&
      generation === session.identityGeneration?.() && db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope === scope &&
      hasPermissions(db, session, permission);
    return {ok: (await adapter.printDailyControl(authorized)) === 'accepted'};
  } catch (_) { return {ok:false}; }
}
module.exports = { handle };
