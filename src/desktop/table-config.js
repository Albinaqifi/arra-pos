const { hasPermissions } = require('./permissions');
const CHANNEL = 'arra:table-config';
const id = x => Number.isSafeInteger(x) && x > 0;
const name = x => typeof x === 'string' && x === x.trim() && x.length > 0 && x.length <= 100;
const plain = x => x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const keys = (x, expected) => Reflect.ownKeys(x).length === expected.length && expected.every(k => Object.hasOwn(x, k));
function registerTableConfig(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, req) => {
    if (!isAllowedSender(event) || !plain(req) || typeof req.action !== 'string') return { ok: false, error: 'Invalid request' };
    if (!hasPermissions(db, session, 'tables.change')) return { ok: false, error: 'Access denied' };
    try {
      if (req.action === 'list' && keys(req, ['action'])) return { ok: true, data: {
        areas: db.prepare('SELECT id, name, active FROM dining_areas ORDER BY id').all(),
        tables: db.prepare("SELECT t.id, t.area_id AS areaId, t.capacity, t.active, EXISTS(SELECT 1 FROM orders o WHERE o.table_id = t.id AND o.status = 'open') AS hasOrder FROM dining_tables t ORDER BY t.id").all()
      } };
      if (req.action === 'area' && keys(req, ['action', 'id', 'name', 'active']) && (req.id === null || id(req.id)) && name(req.name) && typeof req.active === 'boolean') {
        if (req.id === null) db.prepare('INSERT INTO dining_areas (name, active) VALUES (?, ?)').run(req.name, Number(req.active));
        else {
          if (!req.active && db.prepare("SELECT 1 FROM dining_tables t JOIN orders o ON o.table_id = t.id AND o.status = 'open' WHERE t.area_id = ? LIMIT 1").get(req.id)) return { ok: false, error: 'Area has an open order' };
          if (!db.prepare('UPDATE dining_areas SET name = ?, active = ? WHERE id = ?').run(req.name, Number(req.active), req.id).changes) return { ok: false, error: 'Area unavailable' };
        }
        return { ok: true };
      }
      if (req.action === 'table' && keys(req, ['action', 'id', 'areaId', 'capacity', 'active', 'create']) && id(req.id) && id(req.areaId) && id(req.capacity) && req.capacity <= 1000 && typeof req.active === 'boolean' && typeof req.create === 'boolean') {
        const area = db.prepare('SELECT name, active FROM dining_areas WHERE id = ?').get(req.areaId);
        if (!area || (req.active && !area.active)) return { ok: false, error: 'Area unavailable' };
        if (!req.active && db.prepare("SELECT 1 FROM orders WHERE table_id = ? AND status = 'open'").get(req.id)) return { ok: false, error: 'Table has an open order' };
        if (req.create) db.prepare('INSERT INTO dining_tables (id, area, area_id, capacity, active) VALUES (?, ?, ?, ?, ?)').run(req.id, area.name, req.areaId, req.capacity, Number(req.active));
        else if (!db.prepare('UPDATE dining_tables SET area = ?, area_id = ?, capacity = ?, active = ? WHERE id = ?').run(area.name, req.areaId, req.capacity, Number(req.active), req.id).changes) return { ok: false, error: 'Table unavailable' };
        return { ok: true };
      }
      return { ok: false, error: 'Invalid request' };
    } catch (_) { return { ok: false, error: 'Could not save configuration' }; }
  });
}
module.exports = { CHANNEL, registerTableConfig };
