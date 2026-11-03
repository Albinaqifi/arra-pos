const { hasPermissions } = require('./permissions');
const CHANNEL = 'arra:tables';

function registerTables(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' ||
        Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype ||
        Reflect.ownKeys(request).length !== 0) return { ok: false, error: 'Invalid request' };
    if (!hasPermissions(db, session, 'tables.view')) return { ok: false, error: 'Access denied' };
    try {
      return { ok: true, data: db.prepare("SELECT t.id, COALESCE(a.name, t.area) AS area, o.id AS orderId, o.opened_at AS openedAt FROM dining_tables t LEFT JOIN dining_areas a ON a.id = t.area_id LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open' WHERE t.active = 1 AND COALESCE(a.active, 1) = 1 ORDER BY t.id").all() };
    } catch (_) {
      return { ok: false, error: 'Tables unavailable' };
    }
  });
}

function seedTables(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const area = db.prepare('INSERT INTO dining_areas (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
    area.run('Inside'); area.run('Terrace');
    const insert = db.prepare('INSERT INTO dining_tables (id, area, area_id) VALUES (?, ?, (SELECT id FROM dining_areas WHERE name = ?)) ON CONFLICT(id) DO NOTHING');
    for (let id = 1; id <= 16; id++) { const name = id <= 10 ? 'Inside' : 'Terrace'; insert.run(id, name, name); }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { CHANNEL, registerTables, seedTables };
