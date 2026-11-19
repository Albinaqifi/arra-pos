const { auditConfiguration, recordAudit } = require('./audit');
const { randomUUID } = require('node:crypto');
const { hasPermissions } = require('./permissions');
const CHANNEL = 'arra:menu-config';
const plain = x => x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const keys = (x, expected) => Reflect.ownKeys(x).length === expected.length && expected.every(k => Object.hasOwn(x, k));
const id = x => typeof x === 'string' && x === x.trim() && x.length > 0 && x.length <= 100;
const name = x => id(x);
const number = x => Number.isSafeInteger(x) && x >= 0;
function validProduct(req) {
  const fields = ['action', 'id', 'categoryId', 'name', 'price', 'active', 'sortOrder'];
  if (Object.hasOwn(req, 'destination')) {
    if (!['kitchen', 'kitchen2', 'bar'].includes(req.destination)) return false;
    fields.push('destination');
  }
  if (Object.hasOwn(req, 'taxGroup')) {
    if (![null, 'А', 'В'].includes(req.taxGroup)) return false;
    fields.push('taxGroup');
  }
  if (Object.hasOwn(req, 'domesticProduct')) {
    if (![null, true, false].includes(req.domesticProduct)) return false;
    fields.push('domesticProduct');
  }
  return keys(req, fields) && (req.id === null || id(req.id)) && id(req.categoryId) &&
    name(req.name) && number(req.price) && typeof req.active === 'boolean' && number(req.sortOrder);
}
function registerMenuConfig(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, req) => {
    if (!isAllowedSender(event) || !plain(req) || typeof req.action !== 'string') return { ok: false, error: 'Invalid request' };
    if (!hasPermissions(db, session, 'menu.change')) return { ok: false, error: 'Access denied' };
    try {
      const actor = session.currentUserId();
      const combined = actor === session.authenticatedUserId() &&
        db.prepare("SELECT 1 FROM financial_scopes WHERE user_id=? AND scope='combined'").get(actor);
      if (req.action === 'classifyOrigin' && keys(req, ['action','itemId','domesticProduct']) &&
          Number.isSafeInteger(req.itemId) && req.itemId > 0 && typeof req.domesticProduct === 'boolean') {
        if (!combined) return {ok:false,error:'Access denied'};
        db.exec('BEGIN IMMEDIATE');
        try {
          const row = db.prepare(`SELECT i.id,i.order_id AS orderId,o.domestic FROM order_items i
            JOIN orders ord ON ord.id=i.order_id LEFT JOIN order_item_fiscal_origin o ON o.item_id=i.id
            WHERE i.id=? AND ord.status='open' AND ord.retired_empty=0
            AND NOT EXISTS(SELECT 1 FROM bills b JOIN fiscal_checkout_sales s ON s.bill_id=b.id WHERE b.order_id=ord.id)`).get(req.itemId);
          if (!row || (row.domestic !== null && row.domestic !== Number(req.domesticProduct))) {
            db.exec('ROLLBACK'); return {ok:false,error:'Item unavailable'};
          }
          if (row.domestic === null) {
            db.prepare('INSERT INTO order_item_fiscal_origin(item_id,domestic) VALUES(?,?)').run(row.id,Number(req.domesticProduct));
            recordAudit(db,actor,'classify_origin','order_item',row.id,row.orderId,{domesticProduct:req.domesticProduct});
          }
          db.exec('COMMIT'); return {ok:true};
        } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
      }
      const execute = () => {
      if (req.action === 'list' && keys(req, ['action'])) return { ok: true, data: {
        categories: db.prepare('SELECT id, name, active, parent_id AS parentId, sort_order AS sortOrder FROM menu_categories ORDER BY sort_order, rowid').all(),
        products: db.prepare(`SELECT p.id, p.category_id AS categoryId, p.name, p.price, p.active, p.sort_order AS sortOrder, p.destination, t.tax_group AS taxGroup, o.domestic AS domesticProduct
          FROM menu_products p LEFT JOIN menu_product_fiscal_tax t ON t.product_id=p.id LEFT JOIN menu_product_fiscal_origin o ON o.product_id=p.id ORDER BY p.sort_order, p.rowid`).all().map(p => ({...p, domesticProduct: p.domesticProduct === null ? null : !!p.domesticProduct})),
        unclassifiedOrigins: combined ? db.prepare(`SELECT i.id,i.order_id AS orderId,ord.table_id AS tableId,i.name,i.quantity
          FROM order_items i JOIN orders ord ON ord.id=i.order_id
          LEFT JOIN order_item_fiscal_origin o ON o.item_id=i.id
          WHERE ord.status='open' AND ord.retired_empty=0 AND o.item_id IS NULL
          AND NOT EXISTS(SELECT 1 FROM bills b JOIN fiscal_checkout_sales s ON s.bill_id=b.id WHERE b.order_id=ord.id)
          ORDER BY i.order_id,i.id`).all() : [],
        groups: db.prepare('SELECT id, product_id AS productId, name, required, active FROM modifier_groups ORDER BY rowid').all(),
        options: db.prepare('SELECT id, group_id AS groupId, name, adjustment, active FROM modifier_options ORDER BY rowid').all()
      } };
      if (req.action === 'category' && keys(req, ['action', 'id', 'name', 'active', 'parentId', 'sortOrder']) && (req.id === null || id(req.id)) && name(req.name) && typeof req.active === 'boolean' && (req.parentId === null || id(req.parentId)) && number(req.sortOrder)) {
        if (req.parentId !== null) {
          const parent = db.prepare('SELECT parent_id FROM menu_categories WHERE id = ?').get(req.parentId);
          if (!parent || parent.parent_id !== null || req.parentId === req.id || (req.id && db.prepare('SELECT 1 FROM menu_categories WHERE parent_id = ? LIMIT 1').get(req.id))) return { ok: false, error: 'Invalid parent category' };
        }
        if (req.id === null) db.prepare('INSERT INTO menu_categories (id, name, active, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), req.name, Number(req.active), req.parentId, req.sortOrder);
        else if (!db.prepare('UPDATE menu_categories SET name = ?, active = ?, parent_id = ?, sort_order = ? WHERE id = ?').run(req.name, Number(req.active), req.parentId, req.sortOrder, req.id).changes) return { ok: false, error: 'Category unavailable' };
        return { ok: true };
      }
      if (req.action === 'product' && validProduct(req)) {
        if (!db.prepare('SELECT 1 FROM menu_categories WHERE id = ?').get(req.categoryId)) return { ok: false, error: 'Category unavailable' };
        const productId = req.id ?? randomUUID();
        if (req.id === null) db.prepare('INSERT INTO menu_products (id, category_id, name, price, active, sort_order, destination) VALUES (?, ?, ?, ?, ?, ?, ?)').run(productId, req.categoryId, req.name, req.price, Number(req.active), req.sortOrder, req.destination || 'kitchen');
        else if (!db.prepare('UPDATE menu_products SET category_id = ?, name = ?, price = ?, active = ?, sort_order = ?, destination = COALESCE(?, destination) WHERE id = ?').run(req.categoryId, req.name, req.price, Number(req.active), req.sortOrder, req.destination || null, productId).changes) return { ok: false, error: 'Product unavailable' };
        if (req.taxGroup === null) db.prepare('DELETE FROM menu_product_fiscal_tax WHERE product_id=?').run(productId);
        else if (Object.hasOwn(req, 'taxGroup')) db.prepare(`INSERT INTO menu_product_fiscal_tax(product_id,tax_group) VALUES(?,?)
          ON CONFLICT(product_id) DO UPDATE SET tax_group=excluded.tax_group`).run(productId, req.taxGroup);
        if (req.domesticProduct === null) db.prepare('DELETE FROM menu_product_fiscal_origin WHERE product_id=?').run(productId);
        else if (Object.hasOwn(req, 'domesticProduct')) db.prepare(`INSERT INTO menu_product_fiscal_origin(product_id,domestic) VALUES(?,?)
          ON CONFLICT(product_id) DO UPDATE SET domestic=excluded.domestic`).run(productId, Number(req.domesticProduct));
        return { ok: true };
      }
      if (req.action === 'group' && keys(req, ['action','id','productId','name','required','active']) && (req.id === null || id(req.id)) && id(req.productId) && name(req.name) && typeof req.required === 'boolean' && typeof req.active === 'boolean') {
        if (!db.prepare('SELECT 1 FROM menu_products WHERE id = ?').get(req.productId)) return { ok: false, error: 'Product unavailable' };
        if (req.id === null) db.prepare('INSERT INTO modifier_groups VALUES (?, ?, ?, ?, ?)').run(randomUUID(), req.productId, req.name, Number(req.required), Number(req.active));
        else if (!db.prepare('UPDATE modifier_groups SET name = ?, required = ?, active = ? WHERE id = ? AND product_id = ?').run(req.name, Number(req.required), Number(req.active), req.id, req.productId).changes) return { ok: false, error: 'Group unavailable' };
        return { ok: true };
      }
      if (req.action === 'option' && keys(req, ['action','id','groupId','name','adjustment','active']) && (req.id === null || id(req.id)) && id(req.groupId) && name(req.name) && Number.isSafeInteger(req.adjustment) && typeof req.active === 'boolean') {
        if (!db.prepare('SELECT 1 FROM modifier_groups WHERE id = ?').get(req.groupId)) return { ok: false, error: 'Group unavailable' };
        if (req.id === null) db.prepare('INSERT INTO modifier_options VALUES (?, ?, ?, ?, ?)').run(randomUUID(), req.groupId, req.name, req.adjustment, Number(req.active));
        else if (!db.prepare('UPDATE modifier_options SET name = ?, adjustment = ?, active = ? WHERE id = ? AND group_id = ?').run(req.name, req.adjustment, Number(req.active), req.id, req.groupId).changes) return { ok: false, error: 'Option unavailable' };
        return { ok: true };
      }
      return { ok: false, error: 'Invalid request' };
      };
      return ['category', 'product', 'group', 'option'].includes(req.action) ? auditConfiguration(db, session.currentUserId(), req.action, execute) : execute();
    } catch (_) { return { ok: false, error: 'Could not save menu' }; }
  });
}
module.exports = { CHANNEL, registerMenuConfig };
