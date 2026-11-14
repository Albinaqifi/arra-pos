export function normalizeItems(tableId, items) {
  return items.map(item => ({
    id: item.id, tableId, pid: item.productId, name: item.name, unit: item.unitPrice, qty: item.quantity,
    mods: (item.modifiers || []).map(modifier => modifier.groupName + ': ' + modifier.optionName + ' (' + (modifier.adjustment >= 0 ? '+' : '') + modifier.adjustment + ')').join(' · '),
    note: item.note, status: item.status || 'pending', round: item.round || 0, sentAt: item.sentAt, sentBy: item.sentBy, route: item.route,
    cxQty: item.correctedQuantity || 0, cx: (item.corrections || []).map(correction => ({ qty: correction.quantity, reason: correction.reason, who: correction.actor, t: correction.occurredAt })),
  }));
}

export function tableSnapshot(tables, previous = {}) {
  const sections = [], orders = {};
  for (const table of tables) {
    let section = sections.find(value => value.label === table.area);
    if (!section) { section = { label: table.area, ids: [] }; sections.push(section); }
    section.ids.push(table.id);
    if (table.orderId !== null) {
      const old = Object.values(previous).find(order => order.id === table.orderId);
      orders[table.id] = old ? { ...old, untouched: table.untouched === true } : { id: table.orderId, openedAt: table.openedAt, openedBy: '', rounds: 0, log: [], untouched: table.untouched === true };
    }
  }
  return { sections, orders };
}
