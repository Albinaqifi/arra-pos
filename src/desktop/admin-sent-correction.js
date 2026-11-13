const { recordAudit } = require('./audit');
const plain = x => x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const fields = (x, names) => Reflect.ownKeys(x).length === names.length && names.every(n => Object.hasOwn(x,n));
const id = n => Number.isSafeInteger(n) && n > 0;
function registerAdminSentCorrection(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle('arra:admin-sent-correction', (event, req) => {
    if (!isAllowedSender(event) || !plain(req) || !((req.action === 'list' && fields(req,['action'])) ||
      (req.action === 'correct' && fields(req,['action','orderId','itemId','quantity','reason','requestId']) && id(req.orderId) && id(req.itemId) && id(req.quantity) && typeof req.reason === 'string' && req.reason.trim().length > 0 && req.reason.length <= 500 && typeof req.requestId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(req.requestId)))) return {ok:false};
    try {
      const actor = session.currentUserId();
      if (!actor || actor !== session.authenticatedUserId() || db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope !== 'combined' || !db.prepare("SELECT 1 FROM user_permissions WHERE user_id=? AND permission='orders.correct_sent'").get(actor)) return {ok:false};
      if (req.action === 'list') return {ok:true,data:{items:db.prepare(`SELECT o.id AS orderId, o.table_id AS tableId, i.id AS itemId, i.name, i.quantity,
        i.quantity - COALESCE((SELECT SUM(c.quantity) FROM sent_item_corrections c WHERE c.item_id=i.id),0) AS remaining
        FROM orders o JOIN order_items i ON i.order_id=o.id JOIN dining_tables t ON t.id=o.table_id LEFT JOIN dining_areas a ON a.id=t.area_id
        WHERE o.status='open' AND o.retired_empty=0 AND t.active=1 AND COALESCE(a.active,1)=1 AND i.status='sent' AND NOT EXISTS(SELECT 1 FROM bills b WHERE b.order_id=o.id)
        ORDER BY o.table_id,o.id,i.id`).all().filter(i=>i.remaining>0)}};
      db.exec('BEGIN IMMEDIATE');
      try {
        const prior=db.prepare('SELECT * FROM sent_item_corrections WHERE request_id=?').get(req.requestId);
        if (prior) {
          if (prior.order_id!==req.orderId || prior.item_id!==req.itemId || prior.quantity!==req.quantity || prior.reason!==req.reason.trim() || prior.actor_id!==actor) throw Error('Invalid retry');
        } else {
          const item=db.prepare(`SELECT i.quantity FROM order_items i JOIN orders o ON o.id=i.order_id JOIN dining_tables t ON t.id=o.table_id LEFT JOIN dining_areas a ON a.id=t.area_id WHERE i.id=? AND i.order_id=? AND i.status='sent' AND o.status='open' AND o.retired_empty=0 AND t.active=1 AND COALESCE(a.active,1)=1 AND NOT EXISTS(SELECT 1 FROM bills b WHERE b.order_id=o.id)`).get(req.itemId,req.orderId);
          const corrected=db.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM sent_item_corrections WHERE item_id=?').get(req.itemId).n;
          if (!item || req.quantity > item.quantity-corrected) throw Error('Invalid correction');
          const result=db.prepare('INSERT INTO sent_item_corrections(request_id,item_id,order_id,actor_id,quantity,reason,occurred_at) VALUES(?,?,?,?,?,?,?)').run(req.requestId,req.itemId,req.orderId,actor,req.quantity,req.reason.trim(),Date.now());
          recordAudit(db,actor,'correct_sent','order_item',req.itemId,req.orderId,{correctionId:result.lastInsertRowid,quantity:req.quantity,reason:req.reason.trim()});
        }
        db.exec('COMMIT'); return {ok:true};
      } catch (_) { db.exec('ROLLBACK'); return {ok:false}; }
    } catch (_) { return {ok:false}; }
  });
}
module.exports = { registerAdminSentCorrection };
