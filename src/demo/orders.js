export function demoOrders(catalog, nextId, now = Date.now()) {
  const m = 60000, M = catalog;
  const range = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const st = { sections: [{ label: 'Inside', ids: range(1, 10) }, { label: 'Terrace', ids: range(11, 16) }], orders: {}, items: [] };
  const add = (tid, pid, qty, mods, delta, note, round, ago, who) => {
    const p = M.byId[pid];
    st.items.push({ id: nextId('i'), tableId: tid, pid, name: p.name, unit: p.price + delta, qty, mods: mods || '', note: note || '', route: p.route, status: 'sent', round, sentAt: now - ago * m, sentBy: who, cxQty: 0, cx: [] });
  };
  const open = (tid, who, ago, rounds) => { st.orders[tid] = { id: 'demo-order-' + tid, openedAt: now - ago * m, openedBy: who, rounds, log: [{ t: now - ago * m, who, text: 'Opened table' }] }; };
  const lg = (tid, ago, who, text) => st.orders[tid].log.push({ t: now - ago * m, who, text });

  open(3, 'Besnik', 38, 2);
  add(3, 'qebapa', 2, '10 pieces · Fries', 120, '', 1, 35, 'Besnik');
  add(3, 'shopska', 1, '', 0, '', 1, 35, 'Besnik');
  add(3, 'skopsko', 2, '', 0, '', 1, 35, 'Besnik');
  add(3, 'cola', 1, '', 0, '', 1, 35, 'Besnik');
  lg(3, 35, 'Besnik', 'Sent round 1: Kitchen got 3 items, Bar got 3 items');
  add(3, 'ajvar', 1, '', 0, '', 2, 12, 'Besnik');
  lg(3, 12, 'Besnik', 'Sent round 2: Kitchen got 1 item');

  open(7, 'Arta', 22, 1);
  add(7, 'steak', 1, 'Medium rare · Grilled vegetables', 40, 'Sauce on the side', 1, 20, 'Arta');
  add(7, 'caesar', 1, '', 0, '', 1, 20, 'Arta');
  add(7, 'red', 2, '', 0, '', 1, 20, 'Arta');
  lg(7, 20, 'Arta', 'Sent round 1: Kitchen got 2 items, Bar got 2 items');

  open(9, 'Marko', 55, 1);
  add(9, 'arrapz', 1, '', 0, '', 1, 52, 'Marko');
  add(9, 'marg', 1, '', 0, '', 1, 52, 'Marko');
  add(9, 'lemon', 2, '', 0, '', 1, 52, 'Marko');
  add(9, 'spark', 1, '', 0, '', 1, 52, 'Marko');
  lg(9, 52, 'Marko', 'Sent round 1: Kitchen got 2 items, Bar got 3 items');

  open(12, 'Dita', 6, 1);
  add(12, 'turk', 2, '', 0, '', 1, 5, 'Dita');
  add(12, 'macch', 1, 'Oat milk', 30, '', 1, 5, 'Dita');
  lg(12, 5, 'Dita', 'Sent round 1: Bar got 3 items');

  return st;
}
