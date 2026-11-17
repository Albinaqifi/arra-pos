const { hasPermissions } = require('./permissions');
const CHANNEL = 'arra:activity-report';
const MAX_ROWS = 5000;
const limitError = () => Object.assign(new Error('Report limit exceeded'), {tooLarge:true});
const positive = n => Number.isSafeInteger(n) && n > 0;
const plain = r => r && typeof r === 'object' && !Array.isArray(r) && Object.getPrototypeOf(r) === Object.prototype;
const keys = (r, names) => Reflect.ownKeys(r).length === names.length && names.every(k => Object.hasOwn(r,k));

// A correction follows an item across moves. Restricted owners may see a
// component only when every connected order has a bill and no payment
// falls outside their scope, matching the order-history boundary.
function permittedOrders(db, scope) {
  if (scope === 'combined') return () => true;
  const outgoing = db.prepare("SELECT order_id, context FROM application_audit WHERE action='move_items' AND entity_type='order' AND order_id=? LIMIT ?");
  const incoming = db.prepare("SELECT order_id, context FROM application_audit WHERE action='move_items' AND entity_type='order' AND json_extract(context,'$.destinationOrderId')=? LIMIT ?");
  let examined = 0;
  const check = db.prepare(`SELECT b.id, COALESCE(CASE WHEN c.id IS NOT NULL THEN 'A' END,p.account) AS account
    FROM bills b LEFT JOIN payments p ON p.bill_id=b.id LEFT JOIN payment_account_corrections c ON c.payment_id=p.id WHERE b.order_id=?`);
  const memo = new Map();
  return id => {
    if (memo.has(id)) return memo.get(id);
    const seen = new Set(), todo = [id]; let missingBill = false, forbidden = false;
    while (todo.length) {
      const n = todo.pop(); if (seen.has(n)) continue; seen.add(n);
      const row = check.get(n);
      if (!row) missingBill = true;
      else if (row.account && row.account !== scope) forbidden = true;
      for (const query of [outgoing,incoming]) {
        const links = query.all(n,MAX_ROWS-examined+1);
        examined += links.length;
        if (examined > MAX_ROWS) throw limitError();
        for (const link of links) {
          const destination = JSON.parse(link.context).destinationOrderId;
          if (!positive(link.order_id) || !positive(destination)) throw Error('Invalid move history');
          todo.push(link.order_id,destination);
        }
      }
    }
    const result = !forbidden && !missingBill;
    for (const n of seen) memo.set(n,result);
    return result;
  };
}
function registerActivityReport(ipcMain, allowed, db, session) {
  ipcMain.handle(CHANNEL, (event, req) => {
    if (!allowed(event) || !plain(req) || !((req.action === 'staff' && keys(req,['action'])) ||
      (['cancellations','performance'].includes(req.action) && keys(req,['action','from','to','staffId']) &&
       Number.isSafeInteger(req.from) && req.from >= 0 && Number.isSafeInteger(req.to) && req.to > req.from &&
       (req.action === 'cancellations' ? req.staffId === null : positive(req.staffId))))) return {ok:false};
    try {
      const actor = session.currentUserId();
      if (!actor || actor !== session.authenticatedUserId() || !hasPermissions(db,session,'employees.view')) return {ok:false};
      const scope = db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope;
      if (!['A','B','combined'].includes(scope)) return {ok:false};
      if (req.action === 'staff') { const staff=db.prepare(`SELECT u.id,u.username,u.active FROM local_users u JOIN financial_scopes s ON s.user_id=u.id WHERE s.scope='waiter' ORDER BY u.username,u.id LIMIT ?`).all(MAX_ROWS+1); if (staff.length>MAX_ROWS) throw limitError(); return {ok:true,data:staff}; }
      if (req.action === 'performance' && !db.prepare("SELECT 1 FROM local_users u JOIN financial_scopes s ON s.user_id=u.id WHERE u.id=? AND s.scope='waiter'").get(req.staffId)) return {ok:false};
      const permitted = permittedOrders(db,scope), cancellations = [];
      const source = db.prepare("SELECT actor_id,order_id,entity_id,context FROM application_audit WHERE action='correct_sent' AND entity_type='order_item' AND json_extract(context,'$.correctionId')=? LIMIT 2");
      const sql = `SELECT c.id,c.order_id AS orderId,o.table_id AS tableId,c.actor_id AS actorId,u.username AS actor,c.occurred_at AS occurredAt,c.reason,c.quantity,c.item_id AS itemId,i.name,i.unit_price AS unitPrice
        FROM sent_item_corrections c JOIN order_items i ON i.id=c.item_id JOIN orders o ON o.id=c.order_id JOIN local_users u ON u.id=c.actor_id
        WHERE c.occurred_at>=? AND c.occurred_at<? ${req.staffId ? 'AND c.actor_id=?' : ''} ORDER BY c.occurred_at,c.id LIMIT ?`;
      const args = [req.from,req.to]; if (req.staffId) args.push(req.staffId);
      const rows = db.prepare(sql).all(...args,MAX_ROWS+1);
      if (rows.length > MAX_ROWS) throw limitError();
      for (const row of rows) {
        const audits = source.all(row.id);
        if (audits.length > 1) throw Error('Ambiguous correction history');
        const audit = audits[0];
        const context = audit && JSON.parse(audit.context);
        row.source = audit && audit.actor_id===row.actorId && audit.order_id===row.orderId && audit.entity_id===String(row.itemId) && ['administrator','waiter'].includes(context.source) ? context.source : null;
        row.id = 'correction-' + row.id;
        if (!permitted(row.orderId)) continue;
        row.value = row.quantity * row.unitPrice;
        if (!Number.isSafeInteger(row.value) || row.value < 0) throw Error('Invalid value');
        cancellations.push(row); if (cancellations.length > MAX_ROWS) return {ok:false,tooLarge:true};
      }
      const wholeSql = `SELECT c.order_id AS orderId,o.table_id AS tableId,c.actor_id AS actorId,u.username AS actor,c.occurred_at AS occurredAt,c.reason,c.items
        FROM order_cancellations c JOIN orders o ON o.id=c.order_id JOIN local_users u ON u.id=c.actor_id
        WHERE c.occurred_at>=? AND c.occurred_at<? ${req.staffId ? 'AND c.actor_id=?' : ''} LIMIT ?`;
      const whole = db.prepare(wholeSql).all(...args,MAX_ROWS+1);
      if (whole.length > MAX_ROWS) throw limitError();
      for (const entry of whole) {
        if (!permitted(entry.orderId)) continue;
        const items = JSON.parse(entry.items);
        if (!Array.isArray(items)) throw Error('Invalid cancellation snapshot');
        if (items.length > MAX_ROWS || cancellations.length + Math.max(1,items.length) > MAX_ROWS) throw limitError();
        // The legacy snapshot does not define prices or whether quantities
        // exclude prior corrections, so it is not added to numeric totals.
        const entries = items.length ? items : [null];
        for (const [index,item] of entries.entries()) cancellations.push({id:'order-'+entry.orderId+'-'+index,orderId:entry.orderId,tableId:entry.tableId,actorId:entry.actorId,actor:entry.actor,occurredAt:entry.occurredAt,reason:entry.reason,source:'order',name:typeof item?.name === 'string' ? item.name : null,quantity:positive(item?.quantity) ? item.quantity : null,unitPrice:null,value:null});
      }
      cancellations.sort((a,b)=>a.occurredAt-b.occurredAt || String(a.id).localeCompare(String(b.id)));
      if (req.action === 'cancellations') return {ok:true,data:{cancellations}};
      const candidates = db.prepare(`SELECT p.amount,p.method,b.order_id AS orderId,COALESCE(CASE WHEN c.id IS NOT NULL THEN 'A' END,p.account) AS account FROM payments p JOIN bills b ON b.id=p.bill_id
        LEFT JOIN payment_account_corrections c ON c.payment_id=p.id WHERE p.actor_id=? AND p.paid_at>=? AND p.paid_at<? LIMIT ?`).all(req.staffId,req.from,req.to,MAX_ROWS+1);
      if (candidates.length > MAX_ROWS) return {ok:false,tooLarge:true};
      const payments = candidates.filter(p=>scope === 'combined' || p.account===scope);
      let total=0,cash=0,card=0,quantity=0,value=0; const orders = new Set();
      for (const p of payments) { total+=p.amount; if (p.method === 'cash') cash+=p.amount; else card+=p.amount; orders.add(p.orderId); }
      for (const c of cancellations) { if (c.source !== 'order') { quantity+=c.quantity; value+=c.value; } }
      if (![total,cash,card,quantity,value].every(Number.isSafeInteger)) throw Error('Invalid total');
      return {ok:true,data:{total,cash,card,orders:orders.size,payments:payments.length,quantity,value,wholeUnavailable:cancellations.some(c=>c.source==='order'),cancellations}};
    } catch (error) { return error?.tooLarge ? {ok:false,tooLarge:true} : {ok:false}; }
  });
}
module.exports = { CHANNEL, registerActivityReport };
