// Available orders have no remaining items or bill; their operational history is retained.
const untouchedOrder = alias => `NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = ${alias}.id
    AND (i.status <> 'sent' OR i.quantity <> COALESCE((SELECT SUM(c.quantity) FROM sent_item_corrections c WHERE c.item_id = i.id), 0)))
  AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.order_id = ${alias}.id)
  AND EXISTS (SELECT 1 FROM application_audit h WHERE h.order_id = ${alias}.id AND h.action = 'open' AND h.entity_type = 'order')
  AND NOT EXISTS (SELECT 1 FROM application_audit h WHERE h.order_id = ${alias}.id AND NOT ((h.action IN ('open', 'move') AND h.entity_type = 'order') OR (h.action IN ('add', 'remove', 'quantity_changed', 'note_changed', 'correct_sent') AND h.entity_type = 'order_item') OR (h.action = 'send' AND h.entity_type = 'preparation_round') OR (h.action = 'print_retry' AND h.entity_type = 'print_attempt')))`;
module.exports = { untouchedOrder };
