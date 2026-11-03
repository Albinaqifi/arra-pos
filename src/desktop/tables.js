const CHANNEL = 'arra:tables';

function registerTables(ipcMain, isAllowedSender, db) {
  ipcMain.handle(CHANNEL, (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' ||
        Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype ||
        Reflect.ownKeys(request).length !== 0) return { ok: false, error: 'Invalid request' };
    try {
      return { ok: true, data: db.prepare("SELECT t.id, t.area, o.id AS orderId, o.opened_at AS openedAt FROM dining_tables t LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open' ORDER BY t.id").all() };
    } catch (_) {
      return { ok: false, error: 'Tables unavailable' };
    }
  });
}

function seedTables(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const insert = db.prepare('INSERT INTO dining_tables (id, area) VALUES (?, ?) ON CONFLICT(id) DO NOTHING');
    for (let id = 1; id <= 16; id++) insert.run(id, id <= 10 ? 'Inside' : 'Terrace');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { CHANNEL, registerTables, seedTables };
