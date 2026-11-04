const { hasPermissions } = require('./permissions');
const { recordAudit } = require('./audit');
const CHANNEL = 'arra:business-days';
function issues(db) {
  return {
    orders: db.prepare("SELECT id, table_id AS tableId FROM orders WHERE status='open' ORDER BY id").all(),
    printJobs: db.prepare(`SELECT j.id, COALESCE(a.result, 'unattempted') AS result FROM print_jobs j
      LEFT JOIN print_attempts a ON a.id=(SELECT id FROM print_attempts WHERE job_id=j.id ORDER BY id DESC LIMIT 1)
      WHERE a.result IS NULL OR a.result != 'success' ORDER BY j.id`).all()
  };
}
function registerBusinessDays(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, req) => {
    if (!isAllowedSender(event) || !req || typeof req !== 'object' || Array.isArray(req) || Object.getPrototypeOf(req) !== Object.prototype ||
      !((req.action === 'list' && Reflect.ownKeys(req).length === 1) ||
        (req.action === 'close' && Reflect.ownKeys(req).length === 2 && Number.isSafeInteger(req.dayId) && req.dayId > 0))) return { ok: false };
    try {
      const actor = session.currentUserId();
      if (!actor || actor !== session.authenticatedUserId() || !hasPermissions(db, session, 'business_days.close') ||
          db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope !== 'combined') return { ok: false };
      if (req.action === 'list') return { ok: true, data: {
        days: db.prepare('SELECT id, opened_at AS openedAt, closed_at AS closedAt, closed_by AS closedBy, issues FROM business_days ORDER BY id DESC').all().map(x => ({ ...x, issues: x.issues === null ? null : JSON.parse(x.issues) })),
        issues: issues(db)
      } };
      db.exec('BEGIN IMMEDIATE');
      try {
        const day = db.prepare('SELECT id FROM business_days WHERE id=? AND closed_at IS NULL').get(req.dayId);
        if (!day) { db.exec('ROLLBACK'); return { ok: false }; }
        const outstanding = issues(db), now = Date.now();
        db.prepare('UPDATE business_days SET closed_at=?, closed_by=?, issues=? WHERE id=?').run(now, actor, JSON.stringify(outstanding), day.id);
        db.prepare('INSERT INTO business_days(opened_at) VALUES (?)').run(now);
        recordAudit(db, actor, 'close', 'business_day', day.id, null, {});
        db.exec('COMMIT');
        return { ok: true, data: { dayId: day.id, closedAt: now, issues: outstanding } };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (_) { return { ok: false }; }
  });
}
module.exports = { CHANNEL, registerBusinessDays };
