const cancellationPrinting = require('./test-printing');
const { recordAudit } = require('./audit');
const { hasPermissions } = require('./permissions');
const { ownsOrder } = require('./order-ownership');
const { markService } = require('./shifts');
const { hashPassword } = require('./session');
const { timingSafeEqual, randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const CHANNEL = 'arra:order-items';
const validId = n => Number.isSafeInteger(n) && n > 0;
const cancellationOpen = (sentAt, now) => Number.isSafeInteger(sentAt) && sentAt > 0 && Number.isSafeInteger(now) && sentAt <= now && now - sentAt < 120000;

function registerOrderItems(ipcMain, isAllowedSender, db, session, testPrinting = null) {
  const preparationMode = testPrinting?.preparationMode;
  const key = 'sent-correction-owner-pin-attempts';
  const readAttempts = () => { try { return JSON.parse(db.prepare('SELECT value FROM app_metadata WHERE key=?').get(key)?.value || '{}'); } catch (_) { return { until: Number.MAX_SAFE_INTEGER }; } };
  const writeAttempts = value => db.prepare('INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  const approvals = new Map();
  const generation = () => session.identityGeneration?.() ?? null;
  function approve(pin) {
    const state = readAttempts(), now = Date.now();
    if (Number.isSafeInteger(state.until) && now < state.until) throw Error('Owner approval failed');
    const rows = db.prepare("SELECT u.id, u.pin_salt, u.pin_hash FROM local_users u JOIN financial_scopes f ON f.user_id=u.id WHERE u.active=1 AND f.scope='combined' AND u.pin_salt IS NOT NULL AND u.pin_hash IS NOT NULL AND EXISTS (SELECT 1 FROM user_permissions p WHERE p.user_id=u.id AND p.permission='orders.correct_sent') AND NOT EXISTS (SELECT 1 FROM pending_staff p WHERE p.user_id=u.id)").all();
    const matches = [];
    for (const row of rows.length ? rows : [{ pin_salt: Buffer.alloc(16), pin_hash: Buffer.alloc(32) }]) {
      const candidate = hashPassword(pin, row.pin_salt), expected = Buffer.from(row.pin_hash);
      if (row.id && expected.length === candidate.length && timingSafeEqual(candidate, expected)) matches.push(row);
    }
    if (matches.length !== 1) throw Error('Owner approval failed');
    writeAttempts({ failures: 0, until: 0 });
    return matches[0];
  }
  ipcMain.handle('arra:authorize-cancellation', (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype || Reflect.ownKeys(request).length !== 3 || !validId(request.orderId) || !validId(request.itemId) || typeof request.pin !== 'string' || !/^\d{6}$/.test(request.pin) || !hasPermissions(db, session, 'orders.view', 'orders.change')) return { ok: false };
    const actor = session.currentUserId(), identity = generation(), now = Date.now();
    try {
      db.exec('BEGIN IMMEDIATE');
      if (!ownsOrder(db, session, request.orderId)) { db.exec('ROLLBACK'); return { ok:false }; }
      const item = db.prepare("SELECT i.id FROM order_items i JOIN orders o ON o.id=i.order_id JOIN dining_tables t ON t.id=o.table_id LEFT JOIN dining_areas a ON a.id=t.area_id WHERE i.id=? AND i.order_id=? AND i.status='sent' AND o.status='open' AND o.retired_empty=0 AND t.active=1 AND COALESCE(a.active,1)=1 AND NOT EXISTS(SELECT 1 FROM bills b WHERE b.order_id=o.id) AND i.quantity > COALESCE((SELECT SUM(c.quantity) FROM sent_item_corrections c WHERE c.item_id=i.id),0)").get(request.itemId, request.orderId);
      if (!item) { db.exec('ROLLBACK'); return { ok:false }; }
      let owner;
      try { owner = approve(request.pin); }
      catch (_) {
        const state = readAttempts();
        if (!(Number.isSafeInteger(state.until) && now < state.until)) {
          const failures = (Number.isSafeInteger(state.failures) && state.failures >= 0 ? state.failures : 0) + 1;
          writeAttempts({ failures: failures >= 5 ? 0 : failures, until: failures >= 5 ? now + 60000 : 0 });
        }
        db.exec('COMMIT'); return { ok:false };
      }
      db.exec('COMMIT');
      for (const [id, value] of approvals) if (now >= value.expires || now < value.issued || performance.now() >= value.monotonicExpiry || value.actor === actor) approvals.delete(id);
      if (approvals.size >= 100) return { ok:false };
      const token = randomBytes(32).toString('hex');
      approvals.set(token, { actor, identity, orderId:request.orderId, itemId:request.itemId, owner:owner.id, pinHash:Buffer.from(owner.pin_hash), issued:now, expires:now+120000, monotonicExpiry:performance.now()+120000, payload:null });
      return { ok:true, token };
    } catch (_) { try { db.exec('ROLLBACK'); } catch (_) {} return { ok:false }; }
  });
  ipcMain.handle('arra:revoke-cancellation-approval', (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype || Reflect.ownKeys(request).length !== 1 || typeof request.token !== 'string' || !/^[a-f0-9]{64}$/.test(request.token)) return { ok:false };
    const approval = approvals.get(request.token);
    if (approval && approval.actor === session.currentUserId() && approval.identity === generation()) approvals.delete(request.token);
    return { ok:true };
  });
  ipcMain.handle(CHANNEL, (event, request) => {
    const keys = { correct: Object.hasOwn(request || {}, 'approvalToken') ? ['action', 'orderId', 'itemId', 'quantity', 'reason', 'requestId', 'approvalToken'] : ['action', 'orderId', 'itemId', 'quantity', 'reason', 'requestId'], list: ['action', 'orderId'], send: ['action', 'orderId', 'requestId'], add: Object.hasOwn(request || {}, 'optionIds') ? ['action', 'orderId', 'productId', 'optionIds'] : ['action', 'orderId', 'productId'],
      note: ['action', 'orderId', 'itemId', 'note'], increment: ['action', 'orderId', 'itemId'], decrement: ['action', 'orderId', 'itemId'], remove: ['action', 'orderId', 'itemId'] };
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) ||
        Object.getPrototypeOf(request) !== Object.prototype || !Object.hasOwn(keys, request.action) ||
        Reflect.ownKeys(request).length !== keys[request.action].length ||
        !keys[request.action].every(k => Object.hasOwn(request, k)) || !validId(request.orderId) ||
        (['send', 'correct'].includes(request.action) && (typeof request.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(request.requestId))) ||
        (request.action === 'add' && (typeof request.productId !== 'string' || !request.productId.trim() || (request.optionIds !== undefined && (!Array.isArray(request.optionIds) || request.optionIds.some(x => typeof x !== 'string' || !x.trim()) || new Set(request.optionIds).size !== request.optionIds.length)))) ||
        (['increment', 'decrement', 'remove', 'note'].includes(request.action) && !validId(request.itemId)) ||
        (request.action === 'note' && typeof request.note !== 'string') ||
        (request.action === 'correct' && (!validId(request.itemId) || !validId(request.quantity) || typeof request.reason !== 'string' || !request.reason.trim() || request.reason.length > 500 || (Object.hasOwn(request, 'approvalToken') && (typeof request.approvalToken !== 'string' || !/^[a-f0-9]{64}$/.test(request.approvalToken))))))
      return { ok: false, rejected: true, error: 'Invalid request', ...(request?.action === 'correct' ? {code:'invalid_input'} : {}) };
    if (!hasPermissions(db, session, ...(request.action === 'list' ? ['orders.view'] : ['orders.view', 'orders.change']))) return { ok: false, rejected: true, error: 'Access denied', ...(request.action === 'correct' ? {code:'access_denied'} : {}) };
    try {
      const testAttempts = [];
      let cancellationOutput, correctionSentAt, approvingOwner, usedApproval;
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!ownsOrder(db, session, request.orderId)) { db.exec('ROLLBACK'); return { ok:false, rejected:true, error:'Order unavailable', ...(request.action === 'correct' ? {code:'unavailable'} : {}) }; }
        const priorCorrection = request.action === 'correct' ? db.prepare('SELECT * FROM sent_item_corrections WHERE request_id = ?').get(request.requestId) : null;
        const priorSend = request.action === 'send' ? db.prepare('SELECT order_id FROM preparation_rounds WHERE request_id = ?').get(request.requestId) : null;
        if (priorCorrection && (priorCorrection.order_id !== request.orderId || priorCorrection.item_id !== request.itemId || priorCorrection.quantity !== request.quantity || priorCorrection.reason !== request.reason.trim() || priorCorrection.actor_id !== session.currentUserId())) throw Error('Invalid retry');
        if (priorSend && priorSend.order_id !== request.orderId) throw Error('Invalid request');
        if (request.action === 'correct' && !priorCorrection && db.prepare('SELECT 1 FROM bills WHERE order_id=?').get(request.orderId)) throw Error('Order billed');
        if (!priorCorrection && !priorSend && !db.prepare(`SELECT o.id FROM orders o JOIN dining_tables t ON t.id = o.table_id LEFT JOIN dining_areas a ON a.id = t.area_id
          WHERE o.id = ? AND o.status = 'open' AND o.retired_empty = 0 AND t.active = 1 AND COALESCE(a.active, 1) = 1`).get(request.orderId)) throw Error('Invalid order');
        if (request.action === 'correct') {
          let correctionId = priorCorrection?.id;
          if (!priorCorrection) {
            const item = db.prepare("SELECT quantity FROM order_items WHERE id = ? AND order_id = ? AND status = 'sent'").get(request.itemId, request.orderId);
            const corrected = db.prepare('SELECT COALESCE(SUM(quantity), 0) AS quantity FROM sent_item_corrections WHERE item_id = ?').get(request.itemId).quantity;
            if (!item || request.quantity > item.quantity - corrected) throw Error('Invalid correction');
            const now = Date.now(), reason = request.reason.trim();
            const round = db.prepare('SELECT r.sent_at AS sentAt FROM preparation_ticket_items ti JOIN preparation_tickets t ON t.id=ti.ticket_id JOIN preparation_rounds r ON r.id=t.round_id WHERE ti.item_id=?').get(request.itemId);
            if (!round || !cancellationOpen(round.sentAt, now)) {
              const approval = approvals.get(request.approvalToken), owner = approval && db.prepare("SELECT u.pin_hash FROM local_users u JOIN financial_scopes f ON f.user_id=u.id WHERE u.id=? AND u.active=1 AND f.scope='combined' AND EXISTS(SELECT 1 FROM user_permissions p WHERE p.user_id=u.id AND p.permission='orders.correct_sent') AND NOT EXISTS(SELECT 1 FROM pending_staff p WHERE p.user_id=u.id)").get(approval.owner);
              const signature = JSON.stringify([request.orderId, request.itemId, request.quantity, request.reason.trim(), request.requestId]);
              if (!approval || approval.actor !== session.currentUserId() || approval.identity !== generation() || approval.orderId !== request.orderId || approval.itemId !== request.itemId || now < approval.issued || now >= approval.expires || performance.now() >= approval.monotonicExpiry || !owner?.pin_hash || !Buffer.from(owner.pin_hash).equals(approval.pinHash) || (approval.payload && approval.payload !== signature)) throw Error('Cancellation window expired');
              approval.payload = signature; approvingOwner = approval.owner; usedApproval = request.approvalToken;
            } else {
              if (request.approvalToken) throw Error('Invalid retry');
              correctionSentAt = round.sentAt;
            }
            correctionId = db.prepare('INSERT INTO sent_item_corrections (request_id, item_id, order_id, actor_id, quantity, reason, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(request.requestId, request.itemId, request.orderId, session.currentUserId(), request.quantity, reason, now).lastInsertRowid;
            markService(db, now);
            cancellationPrinting.createCancellationJob(db, correctionId, request.itemId, request.quantity);
            recordAudit(db, session.currentUserId(), 'correct_sent', 'order_item', request.itemId, request.orderId, { correctionId, quantity: request.quantity, reason, source: 'waiter', ...(approvingOwner ? { approvingOwnerId: approvingOwner } : {}) });
          }
          cancellationOutput = cancellationPrinting.initialCancellationOutput(db,correctionId,session.currentUserId(),testPrinting,priorCorrection);
        } else if (request.action === 'send') {
          if (!priorSend) {
            const pending = db.prepare("SELECT i.id, i.quantity, p.destination FROM order_items i JOIN menu_products p ON p.id = i.product_id WHERE i.order_id = ? AND i.status = 'pending' ORDER BY i.id").all(request.orderId);
            if (!pending.length) throw Error('Nothing pending');
            if (pending.length) {
              const number = db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS number FROM preparation_rounds WHERE order_id = ?').get(request.orderId).number;
              const sentAt = Date.now();
              const roundId = db.prepare('INSERT INTO preparation_rounds (order_id, request_id, number, actor_id, sent_at, table_id) VALUES (?, ?, ?, ?, ?, (SELECT table_id FROM orders WHERE id = ?))').run(request.orderId, request.requestId, number, session.currentUserId(), sentAt, request.orderId).lastInsertRowid;
              markService(db, sentAt);
              for (const destination of ['kitchen', 'kitchen2', 'bar']) {
                const selected = pending.filter(i => i.destination === destination);
                if (!selected.length) continue;
                const ticketId = db.prepare("INSERT INTO preparation_tickets (round_id, destination, adapter) VALUES (?, ?, 'simulated')").run(roundId, destination).lastInsertRowid;
                for (const item of selected) db.prepare('INSERT INTO preparation_ticket_items (ticket_id, item_id, quantity) VALUES (?, ?, ?)').run(ticketId, item.id, item.quantity);
                if (testPrinting) {
                  const job = testPrinting.createPreparationJob(db, ticketId, preparationMode);
                  testAttempts.push(testPrinting.reserveAttempt(db, job, 'prep-' + ticketId, session.currentUserId()));
                }
                // PF700 modes use the durable per-queue job above as their
                // sole output. The earlier sample simulator has its own jobs.
                if (!preparationMode) {
                  const jobId = db.prepare('INSERT INTO print_jobs (ticket_id, created_at) VALUES (?, ?)').run(ticketId, Date.now()).lastInsertRowid;
                  const result = db.prepare('SELECT result FROM simulated_printers WHERE destination = ?').get(destination).result;
                  db.prepare('INSERT INTO print_attempts (job_id, request_id, actor_id, occurred_at, result) VALUES (?, ?, ?, ?, ?)').run(jobId, 'initial-' + jobId, session.currentUserId(), Date.now(), result);
                }
              }
              db.prepare("UPDATE order_items SET status = 'sent' WHERE order_id = ? AND status = 'pending'").run(request.orderId);
              recordAudit(db, session.currentUserId(), 'send', 'preparation_round', roundId, request.orderId, { number, itemIds: pending.map(i => i.id), adapter: preparationMode === 'routine' ? 'windows' : 'simulated' });
            }
          }
        } else if (request.action === 'add') {
          const product = db.prepare(`SELECT p.id, p.name, p.price FROM menu_products p
            JOIN menu_categories c ON c.id = p.category_id LEFT JOIN menu_categories parent ON parent.id = c.parent_id WHERE p.id = ? AND p.active = 1 AND c.active = 1 AND (c.parent_id IS NULL OR parent.active = 1)`).get(request.productId);
          if (!product) throw Error('Invalid product');
          const groups = db.prepare('SELECT id, name, required FROM modifier_groups WHERE product_id = ? AND active = 1').all(product.id);
          const selected = [];
          for (const optionId of (request.optionIds || [])) {
            const option = db.prepare('SELECT o.id, o.group_id AS groupId, o.name, o.adjustment FROM modifier_options o JOIN modifier_groups g ON g.id = o.group_id WHERE o.id = ? AND o.active = 1 AND g.active = 1 AND g.product_id = ?').get(optionId, product.id);
            if (!option || selected.some(x => x.groupId === option.groupId)) throw Error('Invalid selection');
            selected.push(option);
          }
          if (groups.some(g => g.required && !selected.some(o => o.groupId === g.id))) throw Error('Required selection missing');
          let price = product.price;
          for (const option of selected) { price += option.adjustment; if (!Number.isSafeInteger(price)) throw Error('Invalid price'); }
          if (price < 0) throw Error('Invalid price');
          // Removed pending rows must not have their identity reused in history.
          const lastId = db.prepare("SELECT MAX(id) AS id FROM (SELECT id FROM order_items UNION ALL SELECT CAST(entity_id AS INTEGER) AS id FROM application_audit WHERE entity_type = 'order_item')").get().id || 0;
          if (!Number.isSafeInteger(lastId + 1)) throw Error('Item IDs exhausted');
          const result = db.prepare("INSERT INTO order_items (id, order_id, product_id, name, unit_price, quantity, status) VALUES (?, ?, ?, ?, ?, 1, 'pending')")
            .run(lastId + 1, request.orderId, product.id, product.name, price);
          markService(db, Date.now());
          for (const option of selected) db.prepare('INSERT INTO order_item_modifiers VALUES (?, ?, ?, ?)').run(result.lastInsertRowid, groups.find(g => g.id === option.groupId).name, option.name, option.adjustment);
          recordAudit(db, session.currentUserId(), 'add', 'order_item', result.lastInsertRowid, request.orderId, { productId: product.id, name: product.name, unitPrice: price, quantity: 1, modifiers: selected.map(o => ({ group: groups.find(g => g.id === o.groupId).name, option: o.name, adjustment: o.adjustment })) });
        } else if (request.action !== 'list') {
          const item = db.prepare("SELECT id, product_id AS productId, name, unit_price AS unitPrice, quantity, note FROM order_items WHERE id = ? AND order_id = ? AND status = 'pending'").get(request.itemId, request.orderId);
          if (!item) throw Error('Invalid item');
          const removed = request.action === 'remove' || (request.action === 'decrement' && item.quantity === 1);
          // Read snapshots before deletion cascades to modifier rows.
          const modifiers = removed ? db.prepare('SELECT group_name AS groupName, option_name AS optionName, adjustment FROM order_item_modifiers WHERE item_id = ? ORDER BY rowid').all(item.id) : null;
          if (request.action === 'note') db.prepare('UPDATE order_items SET note = ? WHERE id = ?').run(request.note, item.id);
          else if (request.action === 'remove' || (request.action === 'decrement' && item.quantity === 1))
            db.prepare('DELETE FROM order_items WHERE id = ?').run(item.id);
          else db.prepare('UPDATE order_items SET quantity = ? WHERE id = ?').run(item.quantity + (request.action === 'increment' ? 1 : -1), item.id);
          if (request.action !== 'note' || item.note !== request.note) {
            markService(db, Date.now());
            const context = request.action === 'note' ? {} : { productId: item.productId, name: item.name, unitPrice: item.unitPrice, beforeQuantity: item.quantity, afterQuantity: removed ? 0 : item.quantity + (request.action === 'increment' ? 1 : -1) };
            if (removed) context.modifiers = modifiers;
            recordAudit(db, session.currentUserId(), request.action === 'note' ? 'note_changed' : removed ? 'remove' : 'quantity_changed', 'order_item', item.id, request.orderId, context);
          }
        }
        const items = db.prepare('SELECT i.id, i.product_id AS productId, i.name, i.unit_price AS unitPrice, i.quantity, i.note, i.status, r.number AS round, r.sent_at AS sentAt, u.username AS sentBy, t.destination AS route FROM order_items i LEFT JOIN preparation_ticket_items ti ON ti.item_id = i.id LEFT JOIN preparation_tickets t ON t.id = ti.ticket_id LEFT JOIN preparation_rounds r ON r.id = t.round_id LEFT JOIN local_users u ON u.id = r.actor_id WHERE i.order_id = ? ORDER BY i.id').all(request.orderId);
        for (const item of items) {
          item.modifiers = db.prepare('SELECT group_name AS groupName, option_name AS optionName, adjustment FROM order_item_modifiers WHERE item_id = ? ORDER BY rowid').all(item.id);
          item.corrections = db.prepare('SELECT c.quantity, c.reason, c.occurred_at AS occurredAt, u.username AS actor FROM sent_item_corrections c JOIN local_users u ON u.id=c.actor_id WHERE c.item_id=? ORDER BY c.id').all(item.id);
          item.correctedQuantity = item.corrections.reduce((n, c) => n + c.quantity, 0);
        }
        let total = 0;
        for (const item of items) {
          const line = item.unitPrice * (item.quantity - item.correctedQuantity);
          if (!Number.isSafeInteger(line) || !Number.isSafeInteger(total + line)) throw Error('Total too large');
          total += line;
        }
        if (correctionSentAt !== undefined && !cancellationOpen(correctionSentAt, Date.now())) throw Error('Cancellation window expired');
        if (usedApproval) {
          const approval = approvals.get(usedApproval), now = Date.now();
          if (!approval || now < approval.issued || now >= approval.expires || performance.now() >= approval.monotonicExpiry || approval.identity !== generation() || approval.actor !== session.currentUserId()) throw Error('Cancellation window expired');
        }
        db.exec('COMMIT');
        if (usedApproval) approvals.delete(usedApproval);
        if (testPrinting) { for (const attempt of testAttempts) testPrinting.dispatch(db, testPrinting.adapter, attempt); cancellationPrinting.dispatchCancellation(db, testPrinting.adapter, cancellationOutput?.attempt); }
        return { ok: true, data: { items, total, testPrintEnabled: Boolean(testPrinting), preparationMode, noticeDeferred:cancellationOutput?.deferred } };
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) { return { ok: false, uncertain: request.action === 'correct' }; }
        if (request.action === 'correct') {
          const codes = { 'Invalid order':'unavailable', 'Invalid correction':'unavailable', 'Invalid retry':'invalid_input', 'Order billed':'already_billed', 'Cancellation window expired':'window_expired' };
          const code = codes[error.message];
          return code ? { ok: false, rejected: true, code } : { ok: false, rejected: false };
        }
        throw error;
      }
    } catch (_) { return { ok: false, error: 'Could not update order items' }; }
  });
}
module.exports = { CHANNEL, registerOrderItems };
