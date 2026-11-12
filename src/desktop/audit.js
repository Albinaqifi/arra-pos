// Call inside the same transaction as the associated change. Context is
// constructed by trusted services, never copied wholesale from a request.
function recordAudit(db, actor, action, entityType, entityId, orderId, context) {
  db.prepare('INSERT INTO application_audit (actor_id, occurred_at, action, entity_type, entity_id, order_id, context) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(actor, Date.now(), action, entityType, String(entityId), orderId, JSON.stringify(context));
}
// Explicit projections exclude credentials and free-form order notes.
const configurationTables = {
  area: ['dining_areas', 'id, name, active'],
  table: ['dining_tables', 'id, area_id, capacity, active'],
  category: ['menu_categories', 'id, name, active, parent_id, sort_order'],
  product: ['menu_products', 'id, category_id, name, price, active, sort_order, destination'],
  group: ['modifier_groups', 'id, product_id, name, required, active'],
  option: ['modifier_options', 'id, group_id, name, adjustment, active'],
};
function auditConfiguration(db, actor, type, operation) {
  const [table, columns] = configurationTables[type];
  const snapshot = () => db.prepare('SELECT ' + columns + ' FROM ' + table).all();
  db.exec('BEGIN IMMEDIATE');
  try {
    const before = new Map(snapshot().map(row => [row.id, row]));
    const result = operation();
    if (result.ok) {
      for (const after of snapshot()) {
        const previous = before.get(after.id) || null;
        if (JSON.stringify(previous) !== JSON.stringify(after))
          recordAudit(db, actor, previous ? 'update' : 'create', type, after.id, null, { before: previous, after });
      }
    }
    db.exec('COMMIT');
    return result;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { recordAudit, auditConfiguration };
