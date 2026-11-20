const { hasPermissions } = require('./permissions');
async function handle(event, req, allowed, db, session, adapter) {
  if (!allowed(event) || !req || typeof req !== 'object' || Array.isArray(req) ||
      Object.getPrototypeOf(req) !== Object.prototype || Reflect.ownKeys(req).length !== 1 ||
      req.action !== 'accountAPrinterDailyControl') return {ok:false};
  try {
    const actor = session.currentUserId();
    if (!actor || actor !== session.authenticatedUserId() ||
        db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope !== 'combined' ||
        !hasPermissions(db, session, 'business_days.close')) return {ok:false,denied:true};
    if (!adapter || typeof adapter.printDailyControl !== 'function') return {ok:false};
    const generation = session.identityGeneration?.();
    const authorized = () => allowed(event) && actor === session.currentUserId() && actor === session.authenticatedUserId() &&
      generation === session.identityGeneration?.() && db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope === 'combined' &&
      hasPermissions(db, session, 'business_days.close');
    return {ok: (await adapter.printDailyControl(authorized)) === 'accepted'};
  } catch (_) { return {ok:false}; }
}
module.exports = { handle };
