// Convert the design's CSS declarations to React's style object.
function style(text) {
  const result = {};
  for (const declaration of (text || '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (name) result[name] = declaration.slice(colon + 1).trim();
  }
  return result;
}

class WaiterDemo extends React.Component {
  constructor(...a) { super(...a); this.state = this.seed(); }
  componentDidMount() {
    this._mounted = true;
    this._tick = setInterval(() => this.forceUpdate(), 20000);
    if (window.arra) {
      window.arra.getTables().then(result => {
        if (!this._mounted) return;
        if (!result.ok) { this.setState({ tableLoad: 'error' }); return; }
        const sections = [];
        result.data.forEach(table => {
          let section = sections.find(s => s.label === table.area);
          if (!section) { section = { label: table.area, ids: [] }; sections.push(section); }
          section.ids.push(table.id);
        });
        this.setState({ sections, tableLoad: 'ready' });
      }).catch(() => { if (this._mounted) this.setState({ tableLoad: 'error' }); });
    }
  }
  componentWillUnmount() { this._mounted = false; clearInterval(this._tick); clearTimeout(this._tt); }

  menu() {
    if (this._menu) return this._menu;
    const G = {
      side: { label: 'Side', req: true, opts: [['Fries', 0], ['Rice', 0], ['Grilled vegetables', 40], ['Mashed potatoes', 0], ['No side', 0]] },
      cook: { label: 'Cooking', req: true, opts: [['Rare', 0], ['Medium rare', 0], ['Medium', 0], ['Well done', 0]] },
      portion: { label: 'Portion', req: true, opts: [['5 pieces', 0], ['10 pieces', 120]] },
      milk: { label: 'Milk', req: false, opts: [['Regular milk', 0], ['Lactose-free', 0], ['Oat milk', 30]] }
    };
    const cats = [
      { id: 'food', label: 'Food', color: '#C2410C', tint: '#FFF1E6', route: 'kitchen', subs: [['grill', 'Grill'], ['salads', 'Salads'], ['pizza', 'Pizza & pasta'], ['starters', 'Starters']] },
      { id: 'drinks', label: 'Drinks', color: '#1D4ED8', tint: '#EAF1FF', route: 'bar', subs: [['coffee', 'Coffee & tea'], ['soft', 'Soft drinks'], ['beer', 'Beer'], ['wine', 'Wine']] },
      { id: 'desserts', label: 'Desserts', color: '#BE185D', tint: '#FDECF4', route: 'kitchen', subs: [['cakes', 'Cakes'], ['cold', 'Ice cream & fruit']] }
    ];
    const P = [
      ['qebapa', 'grill', 'Qebapa', 220, ['portion', 'side']],
      ['pljesk', 'grill', 'Pljeskavica', 280, ['side']],
      ['steak', 'grill', 'Beef steak', 890, ['cook', 'side']],
      ['chicken', 'grill', 'Chicken fillet', 360, ['side']],
      ['mixed', 'grill', 'Mixed grill for 2', 1150, ['side']],
      ['sujuk', 'grill', 'Sujuk', 260, ['side']],
      ['shopska', 'salads', 'Shopska salad', 180, []],
      ['greek', 'salads', 'Greek salad', 220, []],
      ['caesar', 'salads', 'Caesar salad', 320, []],
      ['season', 'salads', 'Seasonal salad', 160, []],
      ['marg', 'pizza', 'Pizza Margherita', 320, []],
      ['capri', 'pizza', 'Pizza Capricciosa', 390, []],
      ['arrapz', 'pizza', 'Pizza Arra', 450, []],
      ['carbo', 'pizza', 'Pasta Carbonara', 380, []],
      ['bolo', 'pizza', 'Pasta Bolognese', 360, []],
      ['fries', 'starters', 'Fries', 120, []],
      ['ajvar', 'starters', 'Ajvar & white cheese', 220, []],
      ['soup', 'starters', 'Soup of the day', 150, []],
      ['peppers', 'starters', 'Grilled peppers', 160, []],
      ['bread', 'starters', 'Bread basket', 60, []],
      ['espresso', 'coffee', 'Espresso', 70, []],
      ['macch', 'coffee', 'Macchiato', 80, ['milk']],
      ['capp', 'coffee', 'Cappuccino', 100, ['milk']],
      ['turk', 'coffee', 'Turkish coffee', 70, []],
      ['tea', 'coffee', 'Tea', 70, []],
      ['cola', 'soft', 'Coca-Cola', 100, []],
      ['fanta', 'soft', 'Fanta', 100, []],
      ['water', 'soft', 'Still water', 60, []],
      ['spark', 'soft', 'Sparkling water', 80, []],
      ['orange', 'soft', 'Fresh orange juice', 150, []],
      ['lemon', 'soft', 'Lemonade', 140, []],
      ['skopsko', 'beer', 'Skopsko', 120, []],
      ['heineken', 'beer', 'Heineken', 150, []],
      ['dab', 'beer', 'Zlaten Dab', 120, []],
      ['red', 'wine', 'House red (glass)', 150, []],
      ['white', 'wine', 'House white (glass)', 150, []],
      ['vranec', 'wine', 'Vranec (bottle)', 1200, []],
      ['baklava', 'cakes', 'Baklava', 150, []],
      ['trilece', 'cakes', 'Trileçe', 180, []],
      ['choc', 'cakes', 'Chocolate cake', 190, []],
      ['icecream', 'cold', 'Ice cream (3 scoops)', 160, []],
      ['fruit', 'cold', 'Fruit salad', 200, []]
    ];
    const subCat = {};
    cats.forEach(c => c.subs.forEach(sb => { subCat[sb[0]] = c; }));
    const products = P.map(([id, sub, name, price, groups]) => ({ id, sub, name, price, groups, cat: subCat[sub].id, route: subCat[sub].route }));
    const byId = {}; products.forEach(p => { byId[p.id] = p; });
    const catById = {}; cats.forEach(c => { catById[c.id] = c; });
    const waiters = [
      { id: 'arta', name: 'Arta', pin: true, color: '#C2410C' },
      { id: 'besnik', name: 'Besnik', pin: true, color: '#1D4ED8' },
      { id: 'dita', name: 'Dita', pin: false, color: '#BE185D' },
      { id: 'marko', name: 'Marko', pin: true, color: '#15803D' },
      { id: 'elena', name: 'Elena', pin: false, color: '#6D28D9' },
      { id: 'liridon', name: 'Liridon', pin: true, color: '#0E7490' }
    ];
    const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };
    const sections = [{ label: 'Inside', ids: range(1, 10) }, { label: 'Terrace', ids: range(11, 16) }];
    const allIds = range(1, 16);
    this._menu = { G, cats, catById, products, byId, waiters, sections, allIds };
    return this._menu;
  }

  seed() {
    const now = Date.now(), m = 60000;
    const st = {
      screen: 'login', user: 'arra', pass: 'arra2026', waiter: null, pinFor: null, pin: '',
      tableId: null, cat: 'food', sub: 'grill', search: '', tab: 'order', modal: null, toast: null,
      printers: { kitchen: true, bar: true, A: true, B: true },
      orders: {}, items: [], jobs: [], history: [], seq: 100, billNo: 1045,
      sections: window.arra ? [] : this.menu().sections, tableLoad: window.arra ? 'loading' : 'ready'
    };
    const M = this.menu();
    const add = (tid, pid, qty, mods, delta, note, round, ago, who) => {
      const p = M.byId[pid];
      st.items.push({ id: 'i' + (st.seq++), tableId: tid, pid, name: p.name, unit: p.price + delta, qty, mods: mods || '', note: note || '', route: p.route, status: 'sent', round, sentAt: now - ago * m, sentBy: who, cxQty: 0, cx: [] });
    };
    const open = (tid, who, ago, rounds) => { st.orders[tid] = { openedAt: now - ago * m, openedBy: who, rounds, log: [{ t: now - ago * m, who, text: 'Opened table' }] }; };
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

    st.history = [
      { no: 1044, table: 'Table 1', closedAt: now - 45 * m, waiter: 'Marko', method: 'Card', account: 'A', total: 2310, count: 9 },
      { no: 1043, table: 'Table 14', closedAt: now - 80 * m, waiter: 'Dita', method: 'Cash', account: 'B', total: 620, count: 4 },
      { no: 1042, table: 'Table 6', closedAt: now - 110 * m, waiter: 'Arta', method: 'Cash', account: 'A', total: 940, count: 5 },
      { no: 1041, table: 'Table 2', closedAt: now - 150 * m, waiter: 'Besnik', method: 'Card', account: 'A', total: 1860, count: 7 }
    ];
    return st;
  }

  // ---------- helpers ----------
  fmt(v) { return Math.round(v).toLocaleString('en-US') + ' den'; }
  who(n) { return n.waiter ? n.waiter.name : ''; }
  mut(fn) { this.setState(s => { const n = JSON.parse(JSON.stringify(s)); fn(n); return n; }); }
  toast(n, msg, kind) {
    n.toast = { msg, kind: kind || 'ok' };
    clearTimeout(this._tt);
    this._tt = setTimeout(() => this.setState({ toast: null }), 4200);
  }
  log(n, tid, text) { const o = n.orders[tid]; if (o) o.log.push({ t: Date.now(), who: this.who(n), text }); }
  freeIfEmpty(n, tid) { const o = n.orders[tid]; if (o && o.rounds === 0 && !n.items.some(x => x.tableId === tid)) delete n.orders[tid]; }
  rlabel(k) { return k === 'bar' ? 'Bar' : 'Kitchen'; }

  // ---------- login / waiter ----------
  login() {
    this.mut(n => {
      if (!n.user.trim() || !n.pass) { this.toast(n, 'Enter the restaurant username and password.', 'err'); return; }
      n.screen = 'waiters';
    });
  }
  pickWaiter(w) {
    this.mut(n => {
      const ww = { id: w.id, name: w.name, color: w.color };
      if (w.pin) { n.pinFor = ww; n.pin = ''; n.screen = 'pin'; }
      else { n.waiter = ww; n.screen = 'tables'; this.toast(n, 'Hi ' + w.name + '. Everything you do is now saved under your name.'); }
    });
  }
  pinPress(k) {
    this.mut(n => {
      if (k === 'Clear') n.pin = '';
      else if (k === 'Del') n.pin = n.pin.slice(0, -1);
      else if (n.pin.length < 4) n.pin += k;
      if (n.pin.length === 4) {
        n.waiter = n.pinFor; n.pin = ''; n.screen = 'tables';
        this.toast(n, 'Hi ' + n.waiter.name + '. Everything you do is now saved under your name.');
      }
    });
  }
  goTables() {
    this.mut(n => {
      if (n.screen === 'order') {
        const p = n.items.filter(i => i.tableId === n.tableId && i.status === 'pending').reduce((a, i) => a + i.qty, 0);
        if (p > 0) this.toast(n, 'Table ' + n.tableId + ' still has ' + p + (p === 1 ? ' item' : ' items') + ' not sent to the kitchen or bar.', 'warn');
      }
      n.screen = 'tables'; n.modal = null;
    });
  }
  openTable(id) { this.mut(n => { n.tableId = id; n.screen = 'order'; n.tab = 'order'; n.search = ''; }); }
  togglePrinter(k) {
    const names = { kitchen: 'Kitchen', bar: 'Bar', A: 'Bill A', B: 'Bill B' };
    this.mut(n => {
      n.printers[k] = !n.printers[k];
      this.toast(n, 'Demo: ' + names[k] + ' printer is now ' + (n.printers[k] ? 'online.' : 'offline.'), n.printers[k] ? 'ok' : 'warn');
    });
  }

  // ---------- order entry ----------
  addProduct(pid) {
    this.mut(n => {
      const p = this.menu().byId[pid];
      if (p.groups.length) n.modal = { type: 'mods', pid, sel: {} };
      else this.addItem(n, p, '', 0);
    });
  }
  addItem(n, p, mods, delta) {
    const tid = n.tableId;
    if (!n.orders[tid]) { n.orders[tid] = { openedAt: Date.now(), openedBy: this.who(n), rounds: 0, log: [] }; this.log(n, tid, 'Opened table'); }
    const same = n.items.find(i => i.tableId === tid && i.status === 'pending' && i.pid === p.id && i.mods === mods && !i.note);
    if (same) same.qty++;
    else n.items.push({ id: 'i' + (n.seq++), tableId: tid, pid: p.id, name: p.name, unit: p.price + delta, qty: 1, mods, note: '', route: p.route, status: 'pending', round: 0, cxQty: 0, cx: [] });
    this.log(n, tid, 'Added ' + p.name + (mods ? ' (' + mods + ')' : ''));
  }
  modAdd() {
    this.mut(n => {
      const M = this.menu(); const p = M.byId[n.modal.pid];
      let d = 0; const ls = [];
      p.groups.forEach(g => { const k = n.modal.sel[g]; if (k != null) { ls.push(M.G[g].opts[k][0]); d += M.G[g].opts[k][1]; } });
      this.addItem(n, p, ls.join(' · '), d);
      n.modal = null;
    });
  }
  incItem(id) { this.mut(n => { const i = n.items.find(x => x.id === id); if (i && i.status === 'pending') i.qty++; }); }
  decItem(id) {
    this.mut(n => {
      const i = n.items.find(x => x.id === id); if (!i || i.status !== 'pending') return;
      if (i.qty > 1) i.qty--; else this.dropItem(n, i);
    });
  }
  removeItem(id) { this.mut(n => { const i = n.items.find(x => x.id === id); if (i && i.status === 'pending') this.dropItem(n, i); }); }
  dropItem(n, i) {
    n.items = n.items.filter(x => x.id !== i.id);
    this.log(n, i.tableId, 'Removed ' + i.name + ' (was not sent yet)');
    this.freeIfEmpty(n, i.tableId);
  }
  openNote(id) { this.mut(n => { const i = n.items.find(x => x.id === id); n.modal = { type: 'note', itemId: id, text: i ? i.note : '' }; }); }
  saveNote() {
    this.mut(n => {
      const i = n.items.find(x => x.id === n.modal.itemId);
      if (i) { i.note = n.modal.text.trim(); this.log(n, i.tableId, i.note ? 'Note on ' + i.name + ': ' + i.note : 'Removed note from ' + i.name); }
      n.modal = null;
    });
  }

  // ---------- send / print ----------
  send() {
    this.mut(n => {
      const tid = n.tableId;
      const pend = n.items.filter(i => i.tableId === tid && i.status === 'pending');
      if (!pend.length) return;
      const o = n.orders[tid]; o.rounds++;
      const r = o.rounds, t = Date.now(), who = this.who(n);
      pend.forEach(i => { i.status = 'sent'; i.round = r; i.sentAt = t; i.sentBy = who; });
      const parts = [], bad = [];
      ['kitchen', 'bar'].forEach(k => {
        const L = pend.filter(i => i.route === k); if (!L.length) return;
        const c = L.reduce((a, i) => a + i.qty, 0); const ok = n.printers[k];
        n.jobs.push({ id: 'j' + (n.seq++), tableId: tid, round: r, printer: k, count: c, status: ok ? 'ok' : 'failed', attempts: 1 });
        parts.push(this.rlabel(k) + ' got ' + c + (c === 1 ? ' item' : ' items'));
        if (!ok) bad.push(this.rlabel(k));
      });
      this.log(n, tid, 'Sent round ' + r + ': ' + parts.join(', ') + (bad.length ? ' (' + bad.join(' and ') + ' ticket did not print)' : ''));
      if (bad.length) this.toast(n, 'Round ' + r + ' is saved, but the ' + bad.join(' and ') + ' ticket did not print. Use the red bar at the top.', 'err');
      else this.toast(n, 'Round ' + r + ' sent. ' + parts.join(', ') + '.');
    });
  }
  retryJob(id) {
    this.mut(n => {
      const j = n.jobs.find(x => x.id === id); if (!j) return;
      const l = this.rlabel(j.printer); j.attempts++;
      if (n.printers[j.printer]) {
        j.status = 'ok';
        this.log(n, j.tableId, 'Reprinted ' + l + ' ticket for round ' + j.round + ' (same items, nothing added twice)');
        this.toast(n, l + ' ticket printed. Nothing was added to the order twice.');
      } else {
        this.log(n, j.tableId, 'Retry of ' + l + ' ticket failed');
        this.toast(n, l + ' printer is still not responding. Try the backup printer.', 'err');
      }
    });
  }
  backupJob(id) {
    this.mut(n => {
      const j = n.jobs.find(x => x.id === id); if (!j) return;
      j.status = 'ok'; j.attempts++;
      const l = this.rlabel(j.printer);
      this.log(n, j.tableId, 'Printed ' + l + ' ticket for round ' + j.round + ' on the backup printer');
      this.toast(n, l + ' ticket printed on the backup printer.');
    });
  }

  // ---------- cancel ----------
  openCancel(id) { this.mut(n => { n.modal = { type: 'cancel', itemId: id, qty: 1, reason: '', other: '' }; }); }
  confirmCancel() {
    this.mut(n => {
      const m = n.modal; const i = n.items.find(x => x.id === m.itemId); if (!i) return;
      if (!m.reason || (m.reason === 'Other' && !m.other.trim())) return;
      const q = Math.min(m.qty, i.qty - i.cxQty);
      const reason = m.reason === 'Other' ? m.other.trim() : m.reason;
      i.cxQty += q; i.cx.push({ qty: q, reason, who: this.who(n), t: Date.now() });
      if (i.cxQty >= i.qty) i.status = 'cancelled';
      const l = this.rlabel(i.route);
      this.log(n, i.tableId, 'Cancelled ' + q + '× ' + i.name + '. Reason: ' + reason + '. Waiting for owner review');
      if (n.printers[i.route]) this.toast(n, 'Cancelled. A cancel notice printed at the ' + l + '.');
      else this.toast(n, 'Cancelled and saved. The ' + l + ' printer is offline, so tell them in person.', 'warn');
      n.modal = null;
    });
  }

  // ---------- move ----------
  confirmMoveTable() {
    this.mut(n => {
      const from = n.tableId, to = n.modal.dest;
      if (to == null || to === from || n.orders[to]) return;
      n.orders[to] = n.orders[from]; delete n.orders[from];
      n.items.forEach(i => { if (i.tableId === from) i.tableId = to; });
      n.jobs.forEach(j => { if (j.tableId === from) j.tableId = to; });
      n.tableId = to;
      this.log(n, to, 'Moved the whole order from Table ' + from + ' to Table ' + to);
      this.toast(n, 'Everything moved to Table ' + to + '. Table ' + from + ' is free now.');
      n.modal = null;
    });
  }
  confirmMoveItems() {
    this.mut(n => {
      const from = n.tableId, to = n.modal.dest;
      const ids = Object.keys(n.modal.sel).filter(k => n.modal.sel[k]);
      if (to == null || to === from || !ids.length) return;
      if (!n.orders[to]) { n.orders[to] = { openedAt: Date.now(), openedBy: this.who(n), rounds: 0, log: [] }; this.log(n, to, 'Opened table'); }
      const moved = n.items.filter(i => ids.includes(i.id) && i.tableId === from);
      let maxR = 0, cnt = 0;
      moved.forEach(i => { i.tableId = to; if (i.status !== 'pending') i.movedFrom = from; maxR = Math.max(maxR, i.round); cnt += i.qty - i.cxQty; });
      n.orders[to].rounds = Math.max(n.orders[to].rounds, maxR);
      const names = moved.map(i => (i.qty - i.cxQty) + '× ' + i.name).join(', ');
      this.log(n, from, 'Moved to Table ' + to + ': ' + names);
      this.log(n, to, 'Received from Table ' + from + ': ' + names);
      const left = n.items.filter(i => i.tableId === from && (i.qty - i.cxQty) > 0);
      if (!left.length) {
        n.items = n.items.filter(i => i.tableId !== from);
        delete n.orders[from];
        n.tableId = to;
        this.toast(n, 'Moved ' + cnt + (cnt === 1 ? ' item' : ' items') + ' to Table ' + to + '. Table ' + from + ' is free now.');
      } else {
        this.toast(n, 'Moved ' + cnt + (cnt === 1 ? ' item' : ' items') + ' to Table ' + to + '.');
      }
      n.modal = null;
    });
  }

  // ---------- bill ----------
  bSet(fn) { this.mut(n => { if (n.modal && n.modal.type === 'bill') fn(n.modal, n); }); }
  printBill(useBackup) {
    this.mut(n => {
      const b = n.modal; if (!b || b.type !== 'bill') return;
      if (b.method === 'Card') b.account = 'A';
      const where = 'Printer ' + b.account + (useBackup ? ' (backup)' : '');
      if (!useBackup && !n.printers[b.account]) {
        b.step = 'failed';
        this.log(n, n.tableId, 'Bill did not print on Printer ' + b.account + '. No payment recorded');
        return;
      }
      b.printed++; b.backup = !!useBackup; b.step = 'printed';
      this.log(n, n.tableId, b.printed > 1 ? 'Reprinted the bill on ' + where + ' (no new payment)' : 'Printed bill on ' + where + ': ' + b.method + ', Account ' + b.account);
      if (b.printed > 1) this.toast(n, 'Bill reprinted. Still one payment.');
    });
  }
  paid() {
    this.mut(n => {
      const b = n.modal; const tid = n.tableId;
      if (!b || !b.printed) return;
      if (b.method === 'Card' && b.account !== 'A') { this.toast(n, 'Blocked: card payments can only go to Account A.', 'err'); return; }
      const its = n.items.filter(i => i.tableId === tid);
      const total = its.reduce((a, i) => a + (i.qty - i.cxQty) * i.unit, 0);
      const count = its.reduce((a, i) => a + (i.qty - i.cxQty), 0);
      n.history.unshift({ no: n.billNo++, table: 'Table ' + tid, closedAt: Date.now(), waiter: this.who(n), method: b.method, account: b.account, total, count });
      n.items = n.items.filter(i => i.tableId !== tid);
      delete n.orders[tid];
      n.jobs = n.jobs.filter(j => j.tableId !== tid);
      n.modal = null; n.screen = 'tables'; n.tableId = null;
      this.toast(n, 'Table ' + tid + ' is free. Payment saved once: ' + b.method + ', Account ' + b.account + ', ' + this.fmt(total) + '.');
    });
  }

  // ---------- render ----------
  renderVals() {
    const s = this.state, M = this.menu(), now = Date.now();
    const money = x => this.fmt(x);
    const hm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const bq = i => i.qty - i.cxQty;
    const av = (c, z) => 'width:' + z + 'px; height:' + z + 'px; border-radius:999px; background:' + c + '; color:#FFFFFF; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:' + Math.round(z * 0.42) + 'px; flex:none';
    const scr = s.screen;
    const v = {};

    v.isLogin = scr === 'login'; v.isWaiters = scr === 'waiters'; v.isPin = scr === 'pin';
    v.isApp = scr === 'tables' || scr === 'order' || scr === 'history';
    v.isTables = scr === 'tables'; v.isOrder = scr === 'order'; v.isHistory = scr === 'history';

    // login
    v.user = s.user; v.pass = s.pass;
    v.onUser = e => this.setState({ user: e.target.value });
    v.onPass = e => this.setState({ pass: e.target.value });
    v.login = () => this.login();

    // waiters
    v.waiters = M.waiters.map(w => ({ name: w.name, initial: w.name[0], avStyle: av(w.color, 76), hasPin: w.pin, noPin: !w.pin, pick: () => this.pickWaiter(w) }));
    v.signOut = () => this.mut(n => { n.screen = 'login'; n.waiter = null; });

    // pin
    const pf = s.pinFor || { name: '', color: '#475569' };
    v.pinName = pf.name; v.pinInitial = pf.name ? pf.name[0] : ''; v.pinAv = av(pf.color, 84);
    v.pinDots = [0, 1, 2, 3].map(k => ({ style: k < s.pin.length ? 'width:22px; height:22px; border-radius:999px; background:#0F172A' : 'width:22px; height:22px; border-radius:999px; border:3px solid #94A3B8; box-sizing:border-box' }));
    v.keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', 'Del'].map(k => ({
      label: k === 'Del' ? 'Delete' : k,
      aria: k === 'Del' ? 'Delete last digit' : (k === 'Clear' ? 'Clear PIN' : 'Digit ' + k),
      press: () => this.pinPress(k),
      style: 'height:76px; border-radius:18px; border:2px solid #E2E8F0; background:' + (k.length > 1 ? '#F1F5F9' : '#FFFFFF') + '; color:#0F172A; font-size:' + (k.length > 1 ? '18px' : '32px') + '; font-weight:800'
    }));
    v.pinBack = () => this.mut(n => { n.screen = 'waiters'; n.pin = ''; });

    // top bar
    const w = s.waiter || { name: '', color: '#475569' };
    v.waiterName = w.name; v.waiterInitial = w.name ? w.name[0] : ''; v.waiterAv = av(w.color, 44);
    v.clock = hm(now);
    const tab = on => 'height:48px; padding:0 18px; border-radius:12px; border:none; font-size:17px; font-weight:800; background:' + (on ? '#0F172A' : 'transparent') + '; color:' + (on ? '#FFFFFF' : '#334155');
    v.tabTablesStyle = tab(scr !== 'history'); v.tabHistoryStyle = tab(scr === 'history');
    v.goTables = () => this.goTables();
    v.goHistory = () => this.mut(n => { n.screen = 'history'; n.modal = null; });
    v.switchWaiter = () => this.mut(n => { n.waiter = null; n.screen = 'waiters'; n.modal = null; n.tableId = null; });
    v.printers = [['kitchen', 'Kitchen'], ['bar', 'Bar'], ['A', 'Bill A'], ['B', 'Bill B']].map(([k, l]) => {
      const on = s.printers[k];
      return {
        label: l, state: on ? '' : ' offline',
        aria: l + ' printer ' + (on ? 'online' : 'offline') + '. Demo: click to switch',
        style: 'height:44px; padding:0 14px; border-radius:999px; font-size:15px; font-weight:800; display:inline-flex; align-items:center; gap:8px; border:2px solid ' + (on ? '#BBF7D0' : '#DC2626') + '; background:' + (on ? '#F0FDF4' : '#FEF2F2') + '; color:' + (on ? '#14532D' : '#991B1B'),
        dot: 'width:11px; height:11px; border-radius:999px; background:' + (on ? '#16A34A' : '#DC2626'),
        toggle: () => this.togglePrinter(k)
      };
    });

    // failed print jobs
    const failed = s.jobs.filter(j => j.status === 'failed');
    v.hasFailed = failed.length > 0;
    v.failed = failed.map(j => ({
      text: this.rlabel(j.printer) + ' ticket for Table ' + j.tableId + ' (round ' + j.round + ', ' + j.count + (j.count === 1 ? ' item' : ' items') + ') did not print. The order is saved.',
      attempts: 'Tried ' + j.attempts + '×',
      retry: () => this.retryJob(j.id), backup: () => this.backupJob(j.id)
    }));

    // tables
    const tTotal = tid => s.items.filter(i => i.tableId === tid).reduce((a, i) => a + bq(i) * i.unit, 0);
    let free = 0, taken = 0;
    v.tableMessage = s.tableLoad === 'loading' ? 'Loading tables…' :
      s.tableLoad === 'error' ? 'Tables unavailable. Restart the app and try again.' :
      s.sections.length === 0 ? 'No tables available. Set up sample tables to get started.' : '';
    v.sections = s.sections.map(sec => ({
      label: sec.label,
      tables: sec.ids.map(id => {
        const o = s.orders[id]; const tk = !!o; if (tk) taken++; else free++;
        const its = s.items.filter(i => i.tableId === id);
        const unsent = its.filter(i => i.status === 'pending').reduce((a, i) => a + i.qty, 0);
        const cnt = its.reduce((a, i) => a + bq(i), 0);
        const issue = s.jobs.some(j => j.tableId === id && j.status === 'failed');
        const mins = tk ? Math.max(0, Math.round((now - o.openedAt) / 60000)) : 0;
        return {
          num: String(id), taken: tk, free: !tk, total: money(tTotal(id)), waiter: tk ? o.openedBy : '',
          count: cnt + (cnt === 1 ? ' item' : ' items'), mins: mins + ' min',
          hasUnsent: unsent > 0, unsent: unsent + ' not sent', hasIssue: issue,
          aria: tk ? 'Table ' + id + ', taken, ' + money(tTotal(id)) : 'Table ' + id + ', free',
          style: 'min-height:156px; border-radius:22px; padding:16px; display:flex; flex-direction:column; justify-content:space-between; align-items:flex-start; gap:10px; text-align:left; ' + (tk ? 'background:#F97316; color:#1A0B00; border:2px solid #EA580C; box-shadow:0 10px 22px rgba(249,115,22,0.28)' : 'background:#FFFFFF; color:#0F172A; border:2px solid #E2E8F0; box-shadow:0 4px 12px rgba(15,23,42,0.04)'),
          open: () => this.openTable(id)
        };
      })
    }));
    v.freeCount = free + ' free'; v.takenCount = taken + ' taken';

    // order screen
    const tid = s.tableId; const o = tid ? s.orders[tid] : null;
    v.tableName = tid ? 'Table ' + tid : '';
    v.orderMeta = o ? 'Opened ' + hm(o.openedAt) + ' by ' + o.openedBy + ' · ' + Math.max(0, Math.round((now - o.openedAt) / 60000)) + ' min' : 'Free. Add products to open it.';
    v.statusLabel = o ? 'Taken' : 'Free';
    v.statusStyle = 'height:36px; padding:0 14px; border-radius:999px; display:inline-flex; align-items:center; font-size:15px; font-weight:800; ' + (o ? 'background:#F97316; color:#1A0B00' : 'background:#DCFCE7; color:#14532D');
    const cat = M.catById[s.cat];
    const q = s.search.trim().toLowerCase();
    v.cats = M.cats.map(c => {
      const on = c.id === s.cat && !q;
      return {
        label: c.label, pressed: String(on),
        style: 'min-height:96px; width:100%; border-radius:18px; font-size:19px; font-weight:800; padding:8px; ' + (on ? 'background:' + c.color + '; color:#FFFFFF; border:2px solid ' + c.color + '; box-shadow:0 8px 18px rgba(15,23,42,0.15)' : 'background:' + c.tint + '; color:' + c.color + '; border:2px solid transparent'),
        pick: () => this.mut(n => { n.cat = c.id; n.sub = c.subs[0][0]; n.search = ''; })
      };
    });
    v.search = s.search; v.hasSearch = q.length > 0;
    v.onSearch = e => this.setState({ search: e.target.value });
    v.clearSearch = () => this.setState({ search: '' });
    v.subs = cat.subs.map(([id, l]) => {
      const on = id === s.sub && !q;
      return {
        label: l, pressed: String(on),
        style: 'height:50px; padding:0 20px; border-radius:999px; font-size:17px; font-weight:800; white-space:nowrap; ' + (on ? 'background:#0F172A; color:#FFFFFF; border:2px solid #0F172A' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1'),
        pick: () => this.mut(n => { n.sub = id; n.search = ''; })
      };
    });
    const pendQ = {};
    s.items.forEach(i => { if (i.tableId === tid && i.status === 'pending') pendQ[i.pid] = (pendQ[i.pid] || 0) + i.qty; });
    const list = q ? M.products.filter(p => p.name.toLowerCase().includes(q)) : M.products.filter(p => p.sub === s.sub);
    v.searchInfo = list.length + (list.length === 1 ? ' match' : ' matches') + ' in the whole menu';
    v.products = list.map(p => {
      const c = M.catById[p.cat]; const b = pendQ[p.id] || 0;
      return {
        name: p.name, price: money(p.price), hasOpts: p.groups.length > 0, hasBadge: b > 0, badge: String(b),
        aria: 'Add ' + p.name + ', ' + money(p.price) + (p.groups.length ? ', has options' : ''),
        style: 'position:relative; min-height:116px; border-radius:18px; padding:14px; display:flex; flex-direction:column; justify-content:space-between; align-items:flex-start; gap:10px; text-align:left; background:' + c.tint + '; border:2px solid ' + (b > 0 ? c.color : 'transparent'),
        priceStyle: 'font-size:16px; font-weight:800; color:' + c.color,
        add: () => this.addProduct(p.id)
      };
    });
    v.noProducts = list.length === 0;

    const its = tid ? s.items.filter(i => i.tableId === tid) : [];
    const pend = its.filter(i => i.status === 'pending');
    const pc = pend.reduce((a, i) => a + i.qty, 0);
    const tb = on => 'flex:1; height:48px; border:none; border-bottom:4px solid ' + (on ? '#F97316' : 'transparent') + '; background:transparent; font-size:16px; font-weight:800; color:' + (on ? '#0F172A' : '#475569');
    v.tabOrder = s.tab === 'order'; v.tabAct = s.tab === 'activity';
    v.tabOrderSel = String(v.tabOrder); v.tabActSel = String(v.tabAct);
    v.tabOrderStyle = tb(v.tabOrder); v.tabActStyle = tb(v.tabAct);
    v.setTabOrder = () => this.setState({ tab: 'order' });
    v.setTabAct = () => this.setState({ tab: 'activity' });
    v.isEmpty = its.length === 0;
    v.hasPending = pend.length > 0;
    v.pendingCount = pc + (pc === 1 ? ' item' : ' items');
    v.pending = pend.map(i => ({
      name: i.name, mods: i.mods, hasMods: !!i.mods, note: i.note, hasNote: !!i.note, qty: String(i.qty), amount: money(i.qty * i.unit),
      inc: () => this.incItem(i.id), dec: () => this.decItem(i.id), remove: () => this.removeItem(i.id), editNote: () => this.openNote(i.id),
      noteLabel: i.note ? 'Edit note' : 'Note', decAria: 'One less ' + i.name, incAria: 'One more ' + i.name, removeAria: 'Remove ' + i.name
    }));
    const sent = its.filter(i => i.status !== 'pending');
    const byRound = {};
    sent.forEach(i => { (byRound[i.round] = byRound[i.round] || []).push(i); });
    v.rounds = Object.keys(byRound).map(Number).sort((a, b) => b - a).map(r => {
      const L = byRound[r]; const first = L.reduce((a, i) => (i.sentAt < a.sentAt ? i : a), L[0]);
      return {
        title: 'Round ' + r, meta: 'Sent ' + hm(first.sentAt) + ' by ' + first.sentBy,
        items: L.map(i => {
          const qq = bq(i); const all = qq === 0; const c = i.cx[i.cx.length - 1];
          return {
            name: i.name, mods: i.mods, hasMods: !!i.mods, note: i.note, hasNote: !!i.note,
            hasMoved: !!i.movedFrom, moved: 'From Table ' + i.movedFrom,
            qtyLabel: (all ? i.qty : qq) + '×',
            qtyStyle: 'min-width:40px; height:36px; border-radius:10px; display:inline-flex; align-items:center; justify-content:center; font-size:17px; font-weight:800; ' + (all ? 'background:#F1F5F9; color:#64748B; text-decoration:line-through' : 'background:#0F172A; color:#FFFFFF'),
            nameStyle: 'font-size:17px; font-weight:800; ' + (all ? 'text-decoration:line-through; color:#64748B' : 'color:#0F172A'),
            amount: all ? 'Cancelled' : money(qq * i.unit),
            amountStyle: 'font-size:17px; font-weight:800; white-space:nowrap; color:' + (all ? '#B91C1C' : '#0F172A'),
            routeLabel: i.route === 'bar' ? 'Bar' : 'Kitchen',
            routeStyle: 'height:24px; padding:0 8px; border-radius:6px; display:inline-flex; align-items:center; font-size:12px; font-weight:800; ' + (i.route === 'bar' ? 'background:#DBEAFE; color:#1E40AF' : 'background:#FFEDD5; color:#9A3412'),
            hasCx: i.cxQty > 0,
            cxText: c ? i.cxQty + ' cancelled · ' + c.reason + ' · ' + c.who + ' ' + hm(c.t) + ' · waiting for owner review' : '',
            canCancel: qq > 0, cancel: () => this.openCancel(i.id), cancelAria: 'Cancel ' + i.name
          };
        })
      };
    });
    const total = its.reduce((a, i) => a + bq(i) * i.unit, 0);
    v.total = money(total);
    v.sendDisabled = pc === 0;
    v.sendLabel = pc ? 'Send order · ' + pc : 'Nothing new to send';
    v.sendStyle = 'flex:2; height:72px; border-radius:18px; border:none; display:flex; align-items:center; justify-content:center; gap:10px; font-size:21px; font-weight:800; ' + (pc ? 'background:#16A34A; color:#FFFFFF; box-shadow:0 10px 22px rgba(22,163,74,0.35)' : 'background:#E2E8F0; color:#475569');
    const billable = sent.filter(i => bq(i) > 0);
    v.billDisabled = !o || billable.length === 0;
    v.billStyle = 'flex:1; height:72px; border-radius:18px; border:none; display:flex; align-items:center; justify-content:center; gap:10px; font-size:21px; font-weight:800; ' + (v.billDisabled ? 'background:#E2E8F0; color:#475569' : 'background:#2563EB; color:#FFFFFF; box-shadow:0 10px 22px rgba(37,99,235,0.3)');
    v.moveDisabled = !o;
    v.moveStyle = 'flex:1; height:48px; border-radius:12px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:800; ' + (o ? 'border:2px solid #C4B5FD; background:#F5F3FF; color:#5B21B6' : 'border:2px solid #E2E8F0; background:#F8FAFC; color:#64748B');
    v.send = () => this.send();
    v.openBill = () => this.mut(n => { n.modal = { type: 'bill', step: 'confirm', method: null, account: null, printed: 0, backup: false }; });
    v.openMoveTable = () => this.mut(n => { n.modal = { type: 'moveTable', dest: null }; });
    v.openMoveItems = () => this.mut(n => { n.modal = { type: 'moveItems', sel: {}, dest: null }; });
    v.activity = o ? o.log.slice().reverse().map(e => ({ time: hm(e.t), who: e.who, text: e.text })) : [];
    v.noActivity = v.activity.length === 0;

    // history
    const H = s.history;
    v.hist = H.map(h => ({
      no: '#' + h.no, table: h.table, time: hm(h.closedAt), waiter: h.waiter, items: String(h.count), method: h.method, account: 'Account ' + h.account, total: money(h.total),
      accStyle: 'height:30px; padding:0 12px; border-radius:999px; display:inline-flex; align-items:center; font-size:14px; font-weight:800; ' + (h.account === 'A' ? 'background:#DBEAFE; color:#1E40AF' : 'background:#F3E8FF; color:#6B21A8')
    }));
    const sum = f => money(H.filter(f).reduce((a, h) => a + h.total, 0));
    v.hCount = String(H.length);
    v.hCashA = sum(h => h.method === 'Cash' && h.account === 'A');
    v.hCashB = sum(h => h.method === 'Cash' && h.account === 'B');
    v.hCardA = sum(h => h.method === 'Card');

    // modals: defaults
    const md = s.modal; const ty = md ? md.type : '';
    v.hasModal = !!md;
    v.isMods = ty === 'mods'; v.isNote = ty === 'note'; v.isCancel = ty === 'cancel';
    v.isMoveTable = ty === 'moveTable'; v.isMoveItems = ty === 'moveItems'; v.isBill = ty === 'bill';
    v.closeModal = () => this.setState({ modal: null });
    v.modalTitle = ''; v.modalSub = '';
    v.modalCardStyle = 'background:#FFFFFF; border-radius:26px; width:100%; max-width:' + (ty === 'bill' || ty === 'moveItems' ? '880px' : '760px') + '; max-height:calc(100vh - 40px); overflow:auto; padding:26px; box-sizing:border-box; display:flex; flex-direction:column; gap:20px; box-shadow:0 30px 80px rgba(15,23,42,0.35)';
    v.modGroups = []; v.noteChips = []; v.cxReasons = []; v.mtTables = []; v.miItems = []; v.miTables = []; v.billLines = [];
    const bigBtn = (on, bg, fg) => 'height:72px; border-radius:18px; border:none; font-size:21px; font-weight:800; ' + (on ? 'background:' + bg + '; color:' + fg + '; box-shadow:0 10px 22px rgba(15,23,42,0.18)' : 'background:#E2E8F0; color:#475569');
    const chip = on => 'min-height:60px; border-radius:16px; padding:10px 14px; font-size:17px; font-weight:800; text-align:center; ' + (on ? 'background:#0F172A; color:#FFFFFF; border:2px solid #0F172A' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1');

    if (ty === 'mods') {
      const p = M.byId[md.pid]; let d = 0, ok = true;
      v.modalTitle = p.name; v.modalSub = 'Pick the options from the paper order. Base price ' + money(p.price) + '.';
      v.modGroups = p.groups.map(gid => {
        const g = M.G[gid]; const sel = md.sel[gid];
        if (g.req && sel == null) ok = false;
        if (sel != null) d += g.opts[sel][1];
        return {
          label: g.label, reqLabel: g.req ? 'Required' : 'Optional',
          reqStyle: 'height:26px; padding:0 10px; border-radius:999px; display:inline-flex; align-items:center; font-size:13px; font-weight:800; ' + (g.req ? (sel == null ? 'background:#FEE2E2; color:#991B1B' : 'background:#DCFCE7; color:#14532D') : 'background:#F1F5F9; color:#475569'),
          options: g.opts.map(([l, dd], k) => {
            const on = sel === k;
            return {
              label: l, price: dd ? '+' + money(dd) : 'Included', pressed: String(on),
              style: 'min-height:84px; border-radius:16px; padding:12px; display:flex; flex-direction:column; align-items:flex-start; justify-content:space-between; gap:6px; text-align:left; ' + (on ? 'background:#2563EB; color:#FFFFFF; border:2px solid #2563EB' : 'background:#F8FAFC; color:#0F172A; border:2px solid #CBD5E1'),
              pick: () => this.mut(n => { if (n.modal.sel[gid] === k && !g.req) delete n.modal.sel[gid]; else n.modal.sel[gid] = k; })
            };
          })
        };
      });
      v.modAddDisabled = !ok;
      v.modAddLabel = ok ? 'Add to order · ' + money(p.price + d) : 'Pick the required options first';
      v.modAddStyle = bigBtn(ok, '#16A34A', '#FFFFFF');
      v.modAdd = () => this.modAdd();
    }

    if (ty === 'note') {
      const it = s.items.find(i => i.id === md.itemId);
      v.modalTitle = 'Note for ' + (it ? it.name : '');
      v.modalSub = 'This prints on the kitchen or bar ticket.';
      v.noteText = md.text;
      const parts = md.text.split(',').map(x => x.trim()).filter(Boolean);
      v.noteChips = ['No onions', 'Less salt', 'Extra spicy', 'Sauce on the side', 'No ice', 'Bring first', 'For sharing', 'Kids portion'].map(l => {
        const on = parts.includes(l);
        return {
          label: l, pressed: String(on), style: chip(on),
          toggle: () => this.mut(n => { let ps = n.modal.text.split(',').map(x => x.trim()).filter(Boolean); ps = ps.includes(l) ? ps.filter(x => x !== l) : ps.concat(l); n.modal.text = ps.join(', '); })
        };
      });
      v.onNoteText = e => { const val = e.target.value; this.setState(st => ({ modal: Object.assign({}, st.modal, { text: val }) })); };
      v.saveNote = () => this.saveNote();
    }

    if (ty === 'cancel') {
      const it = s.items.find(i => i.id === md.itemId);
      const mx = it ? bq(it) : 1; const l = it ? this.rlabel(it.route) : '';
      v.modalTitle = 'Cancel a sent item';
      v.modalSub = 'It was already sent, so it stays on record, crossed out.';
      v.cxName = it ? it.name : ''; v.cxMods = it ? it.mods : ''; v.cxHasMods = !!(it && it.mods);
      v.cxMeta = it ? 'Round ' + it.round + ' · sent ' + hm(it.sentAt) + ' to ' + l : '';
      v.cxMulti = mx > 1; v.cxQty = String(md.qty); v.cxMax = 'of ' + mx;
      v.cxInc = () => this.mut(n => { n.modal.qty = Math.min(mx, n.modal.qty + 1); });
      v.cxDec = () => this.mut(n => { n.modal.qty = Math.max(1, n.modal.qty - 1); });
      v.cxReasons = ['Customer changed mind', 'Entered by mistake', 'Kitchen can’t make it', 'Took too long', 'Other'].map(r => ({
        label: r, pressed: String(md.reason === r), style: chip(md.reason === r),
        pick: () => this.mut(n => { n.modal.reason = r; })
      }));
      v.cxIsOther = md.reason === 'Other'; v.cxOther = md.other;
      v.onCxOther = e => { const val = e.target.value; this.setState(st => ({ modal: Object.assign({}, st.modal, { other: val }) })); };
      const ok = !!md.reason && (md.reason !== 'Other' || md.other.trim().length > 0);
      v.cxDisabled = !ok;
      v.cxStyle = 'flex:2; ' + bigBtn(ok, '#DC2626', '#FFFFFF').replace('height:72px', 'height:64px');
      v.cxInfo = 'The ' + l + ' already has this ticket. A cancel notice prints there, but if they already started, tell them in person too. This is saved under your name and goes to the owner for review.';
      v.cxConfirm = () => this.confirmCancel();
    }

    if (ty === 'moveTable') {
      v.modalTitle = 'Move the whole table';
      v.modalSub = 'Everything on Table ' + tid + ' moves to the table you pick. Table ' + tid + ' becomes free. Only free tables can be picked, so no order gets overwritten.';
      v.mtTables = s.sections.flatMap(sec => sec.ids).filter(id => id !== tid).map(id => {
        const tk = !!s.orders[id]; const on = md.dest === id;
        return {
          num: String(id), sub: tk ? 'Taken' : 'Free', disabled: tk,
          aria: 'Table ' + id + (tk ? ', taken, not available' : ', free'),
          style: 'min-height:84px; border-radius:16px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; ' + (tk ? 'background:#F1F5F9; color:#64748B; border:2px dashed #CBD5E1' : (on ? 'background:#7C3AED; color:#FFFFFF; border:2px solid #7C3AED' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1')),
          pick: () => this.mut(n => { n.modal.dest = id; })
        };
      });
      v.mtDisabled = md.dest == null;
      v.mtLabel = md.dest != null ? 'Move everything to Table ' + md.dest : 'Pick a free table';
      v.mtStyle = bigBtn(md.dest != null, '#7C3AED', '#FFFFFF');
      v.mtConfirm = () => this.confirmMoveTable();
    }

    if (ty === 'moveItems') {
      v.modalTitle = 'Move items to another table';
      v.modalSub = 'The items leave Table ' + tid + ' and go to the new table. They are moved, never copied.';
      const elig = its.filter(i => bq(i) > 0);
      let k = 0, units = 0;
      v.miItems = elig.map(i => {
        const on = !!md.sel[i.id]; if (on) { k++; units += bq(i); }
        return {
          label: bq(i) + '× ' + i.name, sub: (i.status === 'pending' ? 'Not sent yet' : 'Round ' + i.round + ' · ' + this.rlabel(i.route)) + (i.mods ? ' · ' + i.mods : ''),
          checked: on, pressed: String(on),
          style: 'min-height:60px; border-radius:14px; padding:10px 14px; display:flex; align-items:center; gap:12px; ' + (on ? 'background:#F5F3FF; border:2px solid #7C3AED; color:#0F172A' : 'background:#FFFFFF; border:2px solid #E2E8F0; color:#0F172A'),
          boxStyle: 'width:28px; height:28px; border-radius:8px; flex:none; display:flex; align-items:center; justify-content:center; box-sizing:border-box; ' + (on ? 'background:#7C3AED; border:2px solid #7C3AED' : 'background:#FFFFFF; border:2px solid #94A3B8'),
          toggle: () => this.mut(n => { n.modal.sel[i.id] = !n.modal.sel[i.id]; })
        };
      });
      v.miTables = s.sections.flatMap(sec => sec.ids).filter(id => id !== tid).map(id => {
        const tk = !!s.orders[id]; const on = md.dest === id;
        return {
          num: String(id), sub: tk ? 'Taken · adds on' : 'Free',
          aria: 'Table ' + id + (tk ? ', taken, items will be added to its order' : ', free'),
          style: 'min-height:76px; border-radius:14px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; ' + (on ? 'background:#7C3AED; color:#FFFFFF; border:2px solid #7C3AED' : (tk ? 'background:#FFEDD5; color:#7C2D12; border:2px solid #FDBA74' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1')),
          pick: () => this.mut(n => { n.modal.dest = id; })
        };
      });
      const ok = k > 0 && md.dest != null;
      v.miDisabled = !ok;
      v.miLabel = ok ? 'Move ' + units + (units === 1 ? ' item' : ' items') + ' to Table ' + md.dest : (k === 0 ? 'Tick at least one item' : 'Pick a table');
      v.miStyle = bigBtn(ok, '#7C3AED', '#FFFFFF');
      v.miConfirm = () => this.confirmMoveItems();
    }

    if (ty === 'bill') {
      const b = md; const st = b.step;
      v.bConfirm = st === 'confirm'; v.bMethod = st === 'method'; v.bAccount = st === 'account';
      v.bReview = st === 'review'; v.bFailed = st === 'failed'; v.bPrinted = st === 'printed';
      v.bReceipt = v.bReview || v.bFailed || v.bPrinted;
      v.billLines = billable.map(i => ({ qty: bq(i) + '×', name: i.name, mods: i.mods, hasMods: !!i.mods, amount: money(bq(i) * i.unit) }));
      v.billTotal = money(billable.reduce((a, i) => a + bq(i) * i.unit, 0));
      v.billTable = 'Table ' + tid;
      v.billBlocked = pc > 0;
      v.billBlockedText = pc + ' new ' + (pc === 1 ? 'item is' : 'items are') + ' not sent yet. Send or remove ' + (pc === 1 ? 'it' : 'them') + ' before printing the bill.';
      v.bYesStyle = 'flex:2; ' + bigBtn(pc === 0, '#2563EB', '#FFFFFF');
      const titles = {
        confirm: ['Print the bill for Table ' + tid + '?', 'Check the items with the customer. Cancelled items are not on the bill.'],
        method: ['How is the customer paying?', 'Table ' + tid + ' · ' + v.billTotal],
        account: ['Cash: which account?', 'Table ' + tid + ' · ' + v.billTotal + ' · each account has its own bill printer'],
        review: ['Check and print', 'Table ' + tid + ' · ' + v.billTotal],
        failed: ['The bill did not print', 'Table ' + tid + ' · nothing was charged'],
        printed: ['Bill printed', 'Table ' + tid + ' · ' + v.billTotal]
      };
      v.modalTitle = titles[st][0]; v.modalSub = titles[st][1];
      v.isCard = b.method === 'Card';
      const acc = b.method === 'Card' ? 'A' : (b.account || '');
      v.billMethod = b.method || ''; v.billAccount = acc ? 'Account ' + acc : '';
      v.billAccStyle = acc === 'B' ? 'color:#6B21A8' : 'color:#1E40AF';
      v.billPrinter = acc ? 'Printer ' + acc + (b.backup ? ' (backup)' : '') : '';
      v.billMethodLine = (b.method || '') + ' · Account ' + acc;
      v.billNo = 'Bill #' + s.billNo; v.billWaiter = 'Waiter: ' + w.name;
      const dd = new Date(now);
      v.billDate = String(dd.getDate()).padStart(2, '0') + '.' + String(dd.getMonth() + 1).padStart(2, '0') + '.' + dd.getFullYear() + ' ' + hm(now);
      v.printedText = 'Printed on Printer ' + acc + (b.backup ? ' (backup)' : '') + (b.printed > 1 ? ' · printed ' + b.printed + ' times, still one payment' : '') + '.';
      v.failText = 'Printer ' + acc + ' is not responding. The bill did not print and no payment was recorded. The order is safe.';
      v.bYes = () => this.bSet(m => { if (!pc) m.step = 'method'; });
      v.bCash = () => this.bSet(m => { m.method = 'Cash'; m.account = null; m.step = 'account'; });
      v.bCard = () => this.bSet(m => { m.method = 'Card'; m.account = 'A'; m.step = 'review'; });
      v.bAccA = () => this.bSet(m => { m.account = 'A'; m.step = 'review'; });
      v.bAccB = () => this.bSet(m => { if (m.method === 'Cash') { m.account = 'B'; m.step = 'review'; } });
      v.bBack = () => this.bSet(m => {
        if (m.step === 'method') m.step = 'confirm';
        else if (m.step === 'account') m.step = 'method';
        else if (m.step === 'review') m.step = m.method === 'Card' ? 'method' : 'account';
      });
      v.bPrint = () => this.printBill(false);
      v.bRetry = () => this.printBill(false);
      v.bBackup = () => this.printBill(true);
      v.bReprint = () => this.printBill(false);
      v.bPaid = () => this.paid();
    }

    // toast
    const t = s.toast;
    v.hasToast = !!t; v.toastText = t ? t.msg : '';
    const tc = t && t.kind === 'err' ? 'background:#DC2626; color:#FFFFFF' : (t && t.kind === 'warn' ? 'background:#FDE047; color:#1A1400' : 'background:#0F172A; color:#FFFFFF');
    v.toastStyle = 'position:fixed; left:50%; bottom:28px; transform:translateX(-50%); max-width:min(720px, calc(100vw - 32px)); padding:16px 24px; border-radius:16px; font-size:18px; font-weight:800; line-height:1.35; z-index:80; box-shadow:0 18px 40px rgba(15,23,42,0.3); ' + tc;

    return v;
  }
  render() {
    const v = this.renderVals();
    return React.createElement(React.Fragment, null, "\n", React.createElement("div", {"style": style("height: 100vh; min-height: 820px; display: flex; flex-direction: column; background: #F4F6FB; color: #0F172A; font-family: 'Figtree', system-ui, sans-serif; overflow: hidden")} , "\n\n", "\n", (v.isLogin ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"style": style("flex: 1; display: flex; flex-wrap: wrap; min-height: 0; overflow: auto")} , "\n  ", React.createElement("div", {"style": style("flex: 1 1 420px; background: #F97316; color: #1A0B00; padding: 56px; display: flex; flex-direction: column; justify-content: space-between; gap: 40px; box-sizing: border-box")} , "\n    ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 12px")} , "\n      ", React.createElement("div", {"style": style("width: 52px; height: 52px; border-radius: 16px; background: #1A0B00; color: #F97316; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 28px")} , "A"), "\n      ", React.createElement("div", {"style": style("font-weight: 800; font-size: 22px")} , "Arra POS"), "\n    "), "\n    ", React.createElement("div", {} , "\n      ", React.createElement("div", {"style": style("font-size: 104px; font-weight: 800; line-height: 0.9; letter-spacing: -0.04em")} , "Arra"), "\n      ", React.createElement("div", {"style": style("font-size: 26px; font-weight: 700; margin-top: 20px; max-width: 460px; line-height: 1.3")} , "Paper order in. Kitchen and bar tickets out. Bill printed. Done."), "\n    "), "\n    ", React.createElement("div", {"style": style("font-size: 16px; font-weight: 700")} , "Tetovo · Main PC"), "\n  "), "\n  ", React.createElement("div", {"style": style("flex: 1 1 420px; display: flex; align-items: center; justify-content: center; padding: 48px 24px; box-sizing: border-box; background: #FFFFFF")} , "\n    ", React.createElement("div", {"style": style("width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 22px")} , "\n      ", React.createElement("h1", {"style": style("margin: 0; font-size: 34px; font-weight: 800")} , "Restaurant sign in"), "\n      ", React.createElement("p", {"style": style("margin: 0; font-size: 18px; color: #475569; line-height: 1.45")} , "Do this once at the start of the day. Waiters pick their own name on the next screen."), "\n      ", React.createElement("label", {"style": style("display: flex; flex-direction: column; gap: 8px; font-size: 16px; font-weight: 700")} , "Username\n        ", React.createElement("input", {"type": "text", "value": v.user, "onChange": v.onUser, "autoComplete": "username", "style": style("height: 60px; border-radius: 14px; border: 2px solid #CBD5E1; padding: 0 18px; font-size: 20px; font-weight: 600; color: #0F172A; background: #FFFFFF")}), "\n      "), "\n      ", React.createElement("label", {"style": style("display: flex; flex-direction: column; gap: 8px; font-size: 16px; font-weight: 700")} , "Password\n        ", React.createElement("input", {"type": "password", "value": v.pass, "onChange": v.onPass, "autoComplete": "current-password", "style": style("height: 60px; border-radius: 14px; border: 2px solid #CBD5E1; padding: 0 18px; font-size: 20px; font-weight: 600; color: #0F172A; background: #FFFFFF")}), "\n      "), "\n      ", React.createElement("button", {"onClick": v.login, "style": style("height: 68px; border-radius: 16px; border: none; background: #2563EB; color: #FFFFFF; font-size: 22px; font-weight: 800; box-shadow: 0 10px 24px rgba(37, 99, 235, 0.3)")} , "Sign in"), "\n    "), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.isWaiters ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"style": style("flex: 1; overflow: auto; padding: 32px 24px 48px; box-sizing: border-box")} , "\n  ", React.createElement("div", {"style": style("max-width: 1000px; margin: 0 auto; display: flex; flex-direction: column; gap: 32px")} , "\n    ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 12px")} , "\n      ", React.createElement("div", {"style": style("width: 44px; height: 44px; border-radius: 14px; background: #F97316; color: #1A0B00; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 24px")} , "A"), "\n      ", React.createElement("div", {"style": style("font-weight: 800; font-size: 20px; flex: 1")} , "Arra POS"), "\n      ", React.createElement("button", {"onClick": v.signOut, "style": style("height: 48px; padding: 0 18px; border-radius: 12px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #334155; font-size: 16px; font-weight: 700")} , "Sign out restaurant"), "\n    "), "\n    ", React.createElement("div", {"style": style("text-align: center; display: flex; flex-direction: column; gap: 10px")} , "\n      ", React.createElement("h1", {"style": style("margin: 0; font-size: 44px; font-weight: 800; letter-spacing: -0.02em")} , "Who is using the PC?"), "\n      ", React.createElement("p", {"style": style("margin: 0; font-size: 20px; color: #475569")} , "Tap your name. Everything you do is saved under it."), "\n    "), "\n    ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 18px")} , "\n      ", (v.waiters || []).map((w, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n        ", React.createElement("button", {"onClick": w.pick, "style": style("min-height: 190px; border-radius: 24px; border: 2px solid #E2E8F0; background: #FFFFFF; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 20px; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06)")} , "\n          ", React.createElement("div", {"style": style(w.avStyle)} , w.initial), "\n          ", React.createElement("div", {"style": style("font-size: 26px; font-weight: 800; color: #0F172A")} , w.name), "\n          ", (w.hasPin ? React.createElement(React.Fragment, null, "\n            ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: #475569")} , "\n              ", React.createElement("svg", {"width": "16", "height": "16", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("rect", {"x": "5", "y": "11", "width": "14", "height": "10", "rx": "2"}), React.createElement("path", {"d": "M8 11V7a4 4 0 0 1 8 0v4"})), "\n              PIN\n            "), "\n          ") : null), "\n          ", (w.noPin ? React.createElement(React.Fragment, null, "\n            ", React.createElement("div", {"style": style("font-size: 14px; font-weight: 700; color: #475569")} , "No PIN"), "\n          ") : null), "\n        "), "\n      "))), "\n    "), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.isPin ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"style": style("flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; padding: 32px 24px; box-sizing: border-box")} , "\n  ", React.createElement("div", {"style": style("width: 100%; max-width: 420px; background: #FFFFFF; border-radius: 28px; padding: 32px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 22px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.1)")} , "\n    ", React.createElement("div", {"style": style(v.pinAv)} , v.pinInitial), "\n    ", React.createElement("div", {"style": style("text-align: center")} , "\n      ", React.createElement("div", {"style": style("font-size: 28px; font-weight: 800")} , "Hi " + v.pinName), "\n      ", React.createElement("div", {"style": style("font-size: 17px; color: #475569; margin-top: 4px")} , "Enter your 4-digit PIN"), "\n    "), "\n    ", React.createElement("div", {"style": style("display: flex; gap: 18px"), "aria-hidden": "true"} , "\n      ", (v.pinDots || []).map((d, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, React.createElement("div", {"style": style(d.style)})))), "\n    "), "\n    ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; width: 100%")} , "\n      ", (v.keys || []).map((k, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n        ", React.createElement("button", {"onClick": k.press, "aria-label": k.aria, "style": style(k.style)} , k.label), "\n      "))), "\n    "), "\n    ", React.createElement("div", {"style": style("font-size: 14px; color: #475569; font-weight: 600")} , "Demo: any 4 digits work"), "\n    ", React.createElement("button", {"onClick": v.pinBack, "style": style("height: 48px; padding: 0 18px; border-radius: 12px; border: none; background: transparent; color: #1D4ED8; font-size: 17px; font-weight: 700")} , "Not you? Pick another name"), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.isApp ? React.createElement(React.Fragment, null, "\n", React.createElement("header", {"style": style("min-height: 72px; flex: none; display: flex; align-items: center; gap: 14px; padding: 10px 20px; box-sizing: border-box; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-wrap: wrap")} , "\n  ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px")} , "\n    ", React.createElement("div", {"style": style("width: 42px; height: 42px; border-radius: 13px; background: #F97316; color: #1A0B00; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px")} , "A"), "\n    ", React.createElement("div", {"style": style("font-weight: 800; font-size: 20px")} , "Arra"), "\n  "), "\n  ", React.createElement("div", {"style": style("flex: 1")}), "\n  ", React.createElement("div", {"style": style("font-size: 20px; font-weight: 800; color: #334155; padding: 0 6px")} , v.clock), "\n  ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px; padding: 4px 4px 4px 4px; border-radius: 999px; background: #F1F5F9")} , "\n    ", React.createElement("div", {"style": style(v.waiterAv)} , v.waiterInitial), "\n    ", React.createElement("div", {"style": style("font-size: 17px; font-weight: 800; padding-right: 4px")} , v.waiterName), "\n    ", React.createElement("button", {"onClick": v.switchWaiter, "style": style("height: 44px; padding: 0 16px; border-radius: 999px; border: none; background: #0F172A; color: #FFFFFF; font-size: 15px; font-weight: 800")} , "Switch waiter"), "\n  "), "\n"), "\n\n", (v.hasFailed ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"role": "alert", "style": style("flex: none; background: #DC2626; color: #FFFFFF; padding: 12px 20px; display: flex; flex-direction: column; gap: 10px")} , "\n  ", (v.failed || []).map((f, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n    ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 14px; flex-wrap: wrap")} , "\n      ", React.createElement("svg", {"width": "26", "height": "26", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.4", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M6 9V3h12v6"}), React.createElement("rect", {"x": "6", "y": "14", "width": "12", "height": "7"}), React.createElement("path", {"d": "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"})), "\n      ", React.createElement("div", {"style": style("flex: 1 1 320px; font-size: 18px; font-weight: 700; line-height: 1.3")} , f.text), "\n      ", React.createElement("span", {"style": style("font-size: 14px; font-weight: 700")} , f.attempts), "\n      ", React.createElement("button", {"onClick": f.retry, "style": style("height: 48px; padding: 0 20px; border-radius: 12px; border: none; background: #FFFFFF; color: #B91C1C; font-size: 17px; font-weight: 800")} , "Retry"), "\n      ", React.createElement("button", {"onClick": f.backup, "style": style("height: 48px; padding: 0 20px; border-radius: 12px; border: 2px solid #FFFFFF; background: transparent; color: #FFFFFF; font-size: 17px; font-weight: 800")} , "Print on backup printer"), "\n    "), "\n  "))), "\n"), "\n") : null), "\n\n", "\n", (v.isTables ? React.createElement(React.Fragment, null, "\n", React.createElement("main", {"style": style("flex: 1; min-height: 0; overflow: auto; padding: 24px; box-sizing: border-box")} , "\n  ", React.createElement("div", {"style": style("max-width: 1360px; margin: 0 auto; display: flex; flex-direction: column; gap: 26px")} , "\n    ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 14px; flex-wrap: wrap")} , "\n      ", React.createElement("h1", {"style": style("margin: 0; font-size: 34px; font-weight: 800; flex: 1")} , "Tables"), "\n      ", React.createElement("span", {"style": style("height: 40px; padding: 0 16px; border-radius: 999px; background: #FFFFFF; border: 2px solid #E2E8F0; display: inline-flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 800")} , React.createElement("span", {"style": style("width: 14px; height: 14px; border-radius: 999px; background: #FFFFFF; border: 3px solid #16A34A; box-sizing: border-box")}), v.freeCount), "\n      ", React.createElement("span", {"style": style("height: 40px; padding: 0 16px; border-radius: 999px; background: #FFEDD5; border: 2px solid #F97316; display: inline-flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 800; color: #7C2D12")} , React.createElement("span", {"style": style("width: 14px; height: 14px; border-radius: 999px; background: #F97316")}), v.takenCount), "\n    "), "\n    ", (v.tableMessage ? React.createElement("p", {"role": "status"}, v.tableMessage) : null), "\n    ", (v.sections || []).map((sec, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n      ", React.createElement("section", {"style": style("display: flex; flex-direction: column; gap: 12px")} , "\n        ", React.createElement("h2", {"style": style("margin: 0; font-size: 16px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.08em")} , sec.label), "\n        ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(172px, 1fr)); gap: 14px")} , "\n          ", (sec.tables || []).map((t, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n            ", React.createElement("button", {"onClick": t.open, "aria-label": t.aria, "style": style(t.style)} , "\n              ", React.createElement("div", {"style": style("display: flex; justify-content: space-between; align-items: flex-start; width: 100%; gap: 8px")} , "\n                ", React.createElement("span", {"style": style("font-size: 44px; font-weight: 800; line-height: 1; letter-spacing: -0.02em")} , t.num), "\n                ", (t.taken ? React.createElement(React.Fragment, null, "\n                  ", React.createElement("span", {"style": style("height: 30px; padding: 0 10px; border-radius: 999px; background: rgba(26, 11, 0, 0.12); display: inline-flex; align-items: center; font-size: 14px; font-weight: 800")} , t.mins), "\n                ") : null), "\n              "), "\n              ", (t.taken ? React.createElement(React.Fragment, null, "\n                ", React.createElement("div", {"style": style("width: 100%")} , "\n                  ", React.createElement("div", {"style": style("font-size: 22px; font-weight: 800")} , t.total), "\n                  ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 700; margin-top: 2px")} , t.waiter + " · " + t.count), "\n                "), "\n              ") : null), "\n              ", (t.free ? React.createElement(React.Fragment, null, "\n                ", React.createElement("div", {"style": style("font-size: 20px; font-weight: 800; color: #15803D")} , "Free"), "\n              ") : null), "\n              ", React.createElement("div", {"style": style("display: flex; gap: 6px; flex-wrap: wrap")} , "\n                ", (t.hasUnsent ? React.createElement(React.Fragment, null, "\n                  ", React.createElement("span", {"style": style("height: 28px; padding: 0 10px; border-radius: 999px; background: #FFFFFF; color: #B91C1C; display: inline-flex; align-items: center; font-size: 13px; font-weight: 800; border: 2px solid #B91C1C")} , t.unsent), "\n                ") : null), "\n                ", (t.hasIssue ? React.createElement(React.Fragment, null, "\n                  ", React.createElement("span", {"style": style("height: 28px; padding: 0 10px; border-radius: 999px; background: #DC2626; color: #FFFFFF; display: inline-flex; align-items: center; font-size: 13px; font-weight: 800")} , "Ticket not printed"), "\n                ") : null), "\n              "), "\n            "), "\n          "))), "\n        "), "\n      "), "\n    "))), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.isOrder ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"style": style("flex: 1; min-height: 0; display: flex; flex-wrap: wrap; overflow: auto")} , "\n\n  ", React.createElement("section", {"aria-label": "Menu", "style": style("flex: 999 1 560px; min-width: 0; display: flex; height: 100%; min-height: 520px")} , "\n    ", React.createElement("nav", {"aria-label": "Categories", "style": style("width: 128px; flex: none; background: #FFFFFF; border-right: 1px solid #E2E8F0; padding: 14px 12px; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; overflow: auto")} , "\n      ", (v.cats || []).map((c, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n        ", React.createElement("button", {"onClick": c.pick, "aria-pressed": c.pressed, "style": style(c.style)} , c.label), "\n      "))), "\n    "), "\n    ", React.createElement("div", {"style": style("flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0")} , "\n      ", React.createElement("div", {"style": style("padding: 14px 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; border-bottom: 1px solid #E2E8F0; background: #FFFFFF")} , "\n        ", React.createElement("div", {"style": style("display: flex; gap: 8px; flex-wrap: wrap; flex: 1 1 360px")} , "\n          ", (v.subs || []).map((sb, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n            ", React.createElement("button", {"onClick": sb.pick, "aria-pressed": sb.pressed, "style": style(sb.style)} , sb.label), "\n          "))), "\n        "), "\n        ", React.createElement("div", {"style": style("position: relative; flex: 0 1 280px; min-width: 200px")} , "\n          ", React.createElement("svg", {"width": "20", "height": "20", "viewbox": "0 0 24 24", "fill": "none", "stroke": "#475569", "strokeWidth": "2.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true", "style": style("position: absolute; left: 14px; top: 14px")} , React.createElement("circle", {"cx": "11", "cy": "11", "r": "7"}), React.createElement("path", {"d": "M21 21l-4.3-4.3"})), "\n          ", React.createElement("input", {"type": "text", "value": v.search, "onChange": v.onSearch, "placeholder": "Search menu", "aria-label": "Search the whole menu", "style": style("width: 100%; box-sizing: border-box; height: 48px; border-radius: 999px; border: 2px solid #CBD5E1; padding: 0 44px 0 44px; font-size: 17px; font-weight: 600; color: #0F172A; background: #F8FAFC")}), "\n          ", (v.hasSearch ? React.createElement(React.Fragment, null, "\n            ", React.createElement("button", {"onClick": v.clearSearch, "aria-label": "Clear search", "style": style("position: absolute; right: 4px; top: 4px; width: 40px; height: 40px; border-radius: 999px; border: none; background: #E2E8F0; color: #0F172A; display: flex; align-items: center; justify-content: center")} , React.createElement("svg", {"width": "18", "height": "18", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.6", "strokeLinecap": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M18 6L6 18M6 6l12 12"}))), "\n          ") : null), "\n        "), "\n      "), "\n      ", React.createElement("div", {"style": style("flex: 1; min-height: 0; overflow: auto; padding: 16px; box-sizing: border-box")} , "\n        ", (v.hasSearch ? React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 700; color: #475569; margin-bottom: 12px")} , v.searchInfo), "\n        ") : null), "\n        ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(178px, 1fr)); gap: 12px; align-content: start")} , "\n          ", (v.products || []).map((p, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n            ", React.createElement("button", {"onClick": p.add, "aria-label": p.aria, "style": style(p.style)} , "\n              ", (p.hasBadge ? React.createElement(React.Fragment, null, "\n                ", React.createElement("span", {"style": style("position: absolute; top: -8px; right: -8px; min-width: 32px; height: 32px; padding: 0 8px; box-sizing: border-box; border-radius: 999px; background: #0F172A; color: #FFFFFF; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 800; border: 3px solid #FFFFFF")} , p.badge), "\n              ") : null), "\n              ", React.createElement("span", {"style": style("font-size: 18px; font-weight: 800; line-height: 1.2; color: #0F172A")} , p.name), "\n              ", React.createElement("span", {"style": style("display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 6px")} , "\n                ", React.createElement("span", {"style": style(p.priceStyle)} , p.price), "\n                ", (p.hasOpts ? React.createElement(React.Fragment, null, "\n                  ", React.createElement("span", {"style": style("height: 26px; padding: 0 9px; border-radius: 999px; background: #FFFFFF; color: #0F172A; display: inline-flex; align-items: center; font-size: 12px; font-weight: 800")} , "Options"), "\n                ") : null), "\n              "), "\n            "), "\n          "))), "\n        "), "\n        ", (v.noProducts ? React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("padding: 48px 16px; text-align: center; font-size: 18px; font-weight: 700; color: #475569")} , "Nothing on the menu matches that."), "\n        ") : null), "\n      "), "\n    "), "\n  "), "\n\n  ", React.createElement("aside", {"aria-label": "Current order", "style": style("flex: 1 1 410px; min-width: 0; max-width: 100%; background: #FFFFFF; border-left: 1px solid #E2E8F0; display: flex; flex-direction: column; height: 100%; min-height: 520px")} , "\n    ", React.createElement("div", {"style": style("padding: 14px 16px 0; display: flex; flex-direction: column; gap: 12px; border-bottom: 1px solid #E2E8F0")} , "\n      ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 12px")} , "\n        ", React.createElement("button", {"onClick": v.goTables, "aria-label": "Back to tables", "style": style("width: 52px; height: 52px; flex: none; border-radius: 14px; border: 2px solid #E2E8F0; background: #FFFFFF; color: #0F172A; display: flex; align-items: center; justify-content: center")} , React.createElement("svg", {"width": "24", "height": "24", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.6", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M15 18l-6-6 6-6"}))), "\n        ", React.createElement("div", {"style": style("flex: 1; min-width: 0")} , "\n          ", React.createElement("div", {"style": style("font-size: 30px; font-weight: 800; line-height: 1.1")} , v.tableName), "\n          ", React.createElement("div", {"style": style("font-size: 14px; color: #475569; font-weight: 700; margin-top: 2px")} , v.orderMeta), "\n        "), "\n        ", React.createElement("span", {"style": style(v.statusStyle)} , v.statusLabel), "\n      "), "\n      ", React.createElement("div", {"style": style("display: flex; gap: 8px")} , "\n        ", React.createElement("button", {"onClick": v.openMoveItems, "disabled": v.moveDisabled, "style": style(v.moveStyle)} , "\n          ", React.createElement("svg", {"width": "18", "height": "18", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M5 12h14"}), React.createElement("path", {"d": "M13 6l6 6-6 6"})), "\n          Move items\n        "), "\n        ", React.createElement("button", {"onClick": v.openMoveTable, "disabled": v.moveDisabled, "style": style(v.moveStyle)} , "\n          ", React.createElement("svg", {"width": "18", "height": "18", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("rect", {"x": "3", "y": "7", "width": "7", "height": "10", "rx": "1.5"}), React.createElement("path", {"d": "M14 12h7"}), React.createElement("path", {"d": "M18 8l3 4-3 4"})), "\n          Move whole table\n        "), "\n      "), "\n      ", React.createElement("div", {"role": "tablist", "style": style("display: flex; gap: 4px")} , "\n        ", React.createElement("button", {"role": "tab", "aria-selected": v.tabOrderSel, "onClick": v.setTabOrder, "style": style(v.tabOrderStyle)} , "Order"), "\n        ", React.createElement("button", {"role": "tab", "aria-selected": v.tabActSel, "onClick": v.setTabAct, "style": style(v.tabActStyle)} , "Activity log"), "\n      "), "\n    "), "\n\n    ", React.createElement("div", {"style": style("flex: 1; min-height: 0; overflow: auto; background: #F8FAFC")} , "\n      ", (v.tabOrder ? React.createElement(React.Fragment, null, "\n        ", (v.isEmpty ? React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("padding: 56px 28px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px")} , "\n            ", React.createElement("div", {"style": style("width: 72px; height: 72px; border-radius: 999px; background: #FFEDD5; color: #C2410C; display: flex; align-items: center; justify-content: center")} , React.createElement("svg", {"width": "34", "height": "34", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.2", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M6 2h12v20l-3-2-3 2-3-2-3 2z"}), React.createElement("path", {"d": "M9 7h6M9 11h6M9 15h4"}))), "\n            ", React.createElement("div", {"style": style("font-size: 22px; font-weight: 800")} , "No items yet"), "\n            ", React.createElement("div", {"style": style("font-size: 17px; color: #475569; line-height: 1.4")} , "Copy the paper order: tap the products on the left. Nothing goes to the kitchen until you press Send."), "\n          "), "\n        ") : null), "\n\n        ", (v.hasPending ? React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("margin: 12px; border: 2px solid #16A34A; border-radius: 18px; overflow: hidden; background: #FFFFFF")} , "\n            ", React.createElement("div", {"style": style("background: #DCFCE7; color: #14532D; padding: 10px 14px; font-weight: 800; font-size: 15px; display: flex; justify-content: space-between; letter-spacing: 0.03em")} , "\n              ", React.createElement("span", {} , "NEW · NOT SENT YET"), React.createElement("span", {} , v.pendingCount), "\n            "), "\n            ", (v.pending || []).map((it, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n              ", React.createElement("div", {"style": style("padding: 12px 14px; border-top: 1px solid #E2E8F0; display: flex; flex-direction: column; gap: 10px")} , "\n                ", React.createElement("div", {"style": style("display: flex; gap: 10px; align-items: flex-start")} , "\n                  ", React.createElement("div", {"style": style("flex: 1; min-width: 0")} , "\n                    ", React.createElement("div", {"style": style("font-size: 18px; font-weight: 800")} , it.name), "\n                    ", (it.hasMods ? React.createElement(React.Fragment, null, React.createElement("div", {"style": style("font-size: 15px; color: #475569; font-weight: 700; margin-top: 2px")} , it.mods)) : null), "\n                    ", (it.hasNote ? React.createElement(React.Fragment, null, React.createElement("div", {"style": style("display: inline-flex; margin-top: 6px; padding: 4px 10px; border-radius: 8px; background: #FEF3C7; color: #78350F; font-size: 14px; font-weight: 800")} , "Note: " + it.note)) : null), "\n                  "), "\n                  ", React.createElement("div", {"style": style("font-size: 18px; font-weight: 800; white-space: nowrap")} , it.amount), "\n                "), "\n                ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 8px")} , "\n                  ", React.createElement("button", {"onClick": it.dec, "aria-label": it.decAria, "style": style("width: 48px; height: 48px; border-radius: 12px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; display: flex; align-items: center; justify-content: center")} , React.createElement("svg", {"width": "20", "height": "20", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "3", "strokeLinecap": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M5 12h14"}))), "\n                  ", React.createElement("span", {"style": style("min-width: 34px; text-align: center; font-size: 22px; font-weight: 800")} , it.qty), "\n                  ", React.createElement("button", {"onClick": it.inc, "aria-label": it.incAria, "style": style("width: 48px; height: 48px; border-radius: 12px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; display: flex; align-items: center; justify-content: center")} , React.createElement("svg", {"width": "20", "height": "20", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "3", "strokeLinecap": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M12 5v14M5 12h14"}))), "\n                  ", React.createElement("div", {"style": style("flex: 1")}), "\n                  ", React.createElement("button", {"onClick": it.editNote, "style": style("height: 48px; padding: 0 14px; border-radius: 12px; border: 2px solid #FCD34D; background: #FFFBEB; color: #78350F; font-size: 15px; font-weight: 800; display: flex; align-items: center; gap: 6px")} , React.createElement("svg", {"width": "18", "height": "18", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M12 20h9"}), React.createElement("path", {"d": "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"})), it.noteLabel), "\n                  ", React.createElement("button", {"onClick": it.remove, "aria-label": it.removeAria, "style": style("width: 48px; height: 48px; border-radius: 12px; border: 2px solid #FECACA; background: #FEF2F2; color: #B91C1C; display: flex; align-items: center; justify-content: center")} , React.createElement("svg", {"width": "20", "height": "20", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M3 6h18"}), React.createElement("path", {"d": "M8 6V4h8v2"}), React.createElement("path", {"d": "M19 6l-1 14H6L5 6"}))), "\n                "), "\n              "), "\n            "))), "\n          "), "\n        ") : null), "\n\n        ", (v.rounds || []).map((r, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("margin: 12px; border: 1px solid #E2E8F0; border-radius: 18px; overflow: hidden; background: #FFFFFF")} , "\n            ", React.createElement("div", {"style": style("background: #F1F5F9; padding: 10px 14px; display: flex; justify-content: space-between; gap: 8px; font-size: 14px; font-weight: 800; color: #334155")} , "\n              ", React.createElement("span", {} , r.title), React.createElement("span", {} , r.meta), "\n            "), "\n            ", (r.items || []).map((it, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n              ", React.createElement("div", {"style": style("padding: 12px 14px; border-top: 1px solid #EEF2F7; display: flex; gap: 12px; align-items: flex-start")} , "\n                ", React.createElement("span", {"style": style(it.qtyStyle)} , it.qtyLabel), "\n                ", React.createElement("div", {"style": style("flex: 1; min-width: 0")} , "\n                  ", React.createElement("div", {"style": style(it.nameStyle)} , it.name), "\n                  ", (it.hasMods ? React.createElement(React.Fragment, null, React.createElement("div", {"style": style("font-size: 14px; color: #475569; font-weight: 700; margin-top: 2px")} , it.mods)) : null), "\n                  ", (it.hasNote ? React.createElement(React.Fragment, null, React.createElement("div", {"style": style("display: inline-flex; margin-top: 6px; padding: 3px 9px; border-radius: 8px; background: #FEF3C7; color: #78350F; font-size: 13px; font-weight: 800")} , "Note: " + it.note)) : null), "\n                  ", React.createElement("div", {"style": style("display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap")} , "\n                    ", React.createElement("span", {"style": style(it.routeStyle)} , it.routeLabel), "\n                    ", (it.hasMoved ? React.createElement(React.Fragment, null, React.createElement("span", {"style": style("height: 24px; padding: 0 8px; border-radius: 6px; background: #EDE9FE; color: #5B21B6; display: inline-flex; align-items: center; font-size: 12px; font-weight: 800")} , it.moved)) : null), "\n                  "), "\n                  ", (it.hasCx ? React.createElement(React.Fragment, null, React.createElement("div", {"style": style("margin-top: 6px; font-size: 13px; font-weight: 800; color: #B91C1C")} , it.cxText)) : null), "\n                "), "\n                ", React.createElement("div", {"style": style("display: flex; flex-direction: column; align-items: flex-end; gap: 8px")} , "\n                  ", React.createElement("div", {"style": style(it.amountStyle)} , it.amount), "\n                  ", (it.canCancel ? React.createElement(React.Fragment, null, "\n                    ", React.createElement("button", {"onClick": it.cancel, "aria-label": it.cancelAria, "style": style("height: 44px; padding: 0 14px; border-radius: 12px; border: 2px solid #FECACA; background: #FFFFFF; color: #B91C1C; font-size: 14px; font-weight: 800")} , "Cancel"), "\n                  ") : null), "\n                "), "\n              "), "\n            "))), "\n          "), "\n        "))), "\n      ") : null), "\n\n      ", (v.tabAct ? React.createElement(React.Fragment, null, "\n        ", React.createElement("div", {"style": style("padding: 14px 16px; display: flex; flex-direction: column; gap: 4px")} , "\n          ", React.createElement("div", {"style": style("font-size: 14px; color: #475569; font-weight: 700; padding-bottom: 8px")} , "Every action on this table, with who did it. Waiters can't edit this list."), "\n          ", (v.activity || []).map((a, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n            ", React.createElement("div", {"style": style("display: flex; gap: 12px; padding: 10px 12px; background: #FFFFFF; border-radius: 12px; border: 1px solid #E2E8F0")} , "\n              ", React.createElement("span", {"style": style("font-size: 15px; font-weight: 800; color: #334155; width: 48px; flex: none")} , a.time), "\n              ", React.createElement("span", {"style": style("font-size: 15px; font-weight: 800; color: #1D4ED8; width: 68px; flex: none")} , a.who), "\n              ", React.createElement("span", {"style": style("font-size: 15px; font-weight: 600; color: #0F172A; line-height: 1.35")} , a.text), "\n            "), "\n          "))), "\n          ", (v.noActivity ? React.createElement(React.Fragment, null, "\n            ", React.createElement("div", {"style": style("padding: 32px 8px; text-align: center; font-size: 16px; color: #475569; font-weight: 700")} , "Nothing has happened on this table yet."), "\n          ") : null), "\n        "), "\n      ") : null), "\n    "), "\n\n    ", React.createElement("div", {"style": style("border-top: 1px solid #E2E8F0; padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; background: #FFFFFF")} , "\n      ", React.createElement("div", {"style": style("display: flex; justify-content: space-between; align-items: baseline")} , "\n        ", React.createElement("span", {"style": style("font-size: 17px; font-weight: 800; color: #475569")} , "Table total"), "\n        ", React.createElement("span", {"style": style("font-size: 32px; font-weight: 800; letter-spacing: -0.01em")} , v.total), "\n      "), "\n      ", React.createElement("div", {"style": style("display: flex; gap: 10px")} , "\n        ", React.createElement("button", {"onClick": v.openBill, "disabled": v.billDisabled, "style": style(v.billStyle)} , "\n          ", React.createElement("svg", {"width": "22", "height": "22", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.4", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M6 2h12v20l-3-2-3 2-3-2-3 2z"}), React.createElement("path", {"d": "M9 7h6M9 11h6M9 15h4"})), "\n          Bill\n        "), "\n        ", React.createElement("button", {"onClick": v.send, "disabled": v.sendDisabled, "style": style(v.sendStyle)} , "\n          ", React.createElement("svg", {"width": "22", "height": "22", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.4", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M22 2L11 13"}), React.createElement("path", {"d": "M22 2l-7 20-4-9-9-4 20-7z"})), "\n          " + v.sendLabel + "\n        "), "\n      "), "\n    "), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.isHistory ? React.createElement(React.Fragment, null, "\n", React.createElement("main", {"style": style("flex: 1; min-height: 0; overflow: auto; padding: 24px; box-sizing: border-box")} , "\n  ", React.createElement("div", {"style": style("max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px")} , "\n    ", React.createElement("div", {} , "\n      ", React.createElement("h1", {"style": style("margin: 0; font-size: 34px; font-weight: 800")} , "Today's bills"), "\n      ", React.createElement("p", {"style": style("margin: 6px 0 0; font-size: 17px; color: #475569; max-width: 760px; line-height: 1.45")} , "Every closed table, paid once. If a bill went to the wrong account, the owner moves it later from the admin side. That never creates a second payment."), "\n    "), "\n    ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px")} , "\n      ", React.createElement("div", {"style": style("background: #FFFFFF; border-radius: 20px; padding: 20px; border: 1px solid #E2E8F0")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #475569")} , "Bills closed"), "\n        ", React.createElement("div", {"style": style("font-size: 36px; font-weight: 800; margin-top: 6px")} , v.hCount), "\n      "), "\n      ", React.createElement("div", {"style": style("background: #EAF1FF; border-radius: 20px; padding: 20px")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #1E40AF")} , "Cash · Account A"), "\n        ", React.createElement("div", {"style": style("font-size: 32px; font-weight: 800; margin-top: 6px")} , v.hCashA), "\n      "), "\n      ", React.createElement("div", {"style": style("background: #F3E8FF; border-radius: 20px; padding: 20px")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #6B21A8")} , "Cash · Account B"), "\n        ", React.createElement("div", {"style": style("font-size: 32px; font-weight: 800; margin-top: 6px")} , v.hCashB), "\n      "), "\n      ", React.createElement("div", {"style": style("background: #DCFCE7; border-radius: 20px; padding: 20px")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #166534")} , "Card · Account A"), "\n        ", React.createElement("div", {"style": style("font-size: 32px; font-weight: 800; margin-top: 6px")} , v.hCardA), "\n      "), "\n    "), "\n    ", React.createElement("div", {"style": style("background: #FFFFFF; border-radius: 20px; border: 1px solid #E2E8F0; overflow-x: auto")} , "\n      ", React.createElement("div", {"style": style("min-width: 820px")} , "\n        ", React.createElement("div", {"style": style("display: grid; grid-template-columns: 90px 110px 90px 120px 80px 110px 130px 1fr; gap: 12px; padding: 14px 20px; font-size: 13px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #E2E8F0")} , "\n          ", React.createElement("span", {} , "Bill"), React.createElement("span", {} , "Table"), React.createElement("span", {} , "Closed"), React.createElement("span", {} , "Waiter"), React.createElement("span", {} , "Items"), React.createElement("span", {} , "Payment"), React.createElement("span", {} , "Account"), React.createElement("span", {"style": style("text-align: right")} , "Total"), "\n        "), "\n        ", (v.hist || []).map((h, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("display: grid; grid-template-columns: 90px 110px 90px 120px 80px 110px 130px 1fr; gap: 12px; padding: 14px 20px; align-items: center; font-size: 17px; font-weight: 700; border-bottom: 1px solid #F1F5F9")} , "\n            ", React.createElement("span", {"style": style("color: #475569")} , h.no), "\n            ", React.createElement("span", {"style": style("font-weight: 800")} , h.table), "\n            ", React.createElement("span", {} , h.time), "\n            ", React.createElement("span", {} , h.waiter), "\n            ", React.createElement("span", {} , h.items), "\n            ", React.createElement("span", {} , h.method), "\n            ", React.createElement("span", {} , React.createElement("span", {"style": style(h.accStyle)} , h.account)), "\n            ", React.createElement("span", {"style": style("text-align: right; font-weight: 800")} , h.total), "\n          "), "\n        "))), "\n      "), "\n    "), "\n  "), "\n"), "\n") : null), "\n") : null), "\n\n", "\n", (v.hasModal ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"style": style("position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; z-index: 50")} , "\n  ", React.createElement("div", {"role": "dialog", "aria-modal": "true", "aria-label": v.modalTitle, "style": style(v.modalCardStyle)} , "\n\n    ", React.createElement("div", {"style": style("display: flex; align-items: flex-start; gap: 12px")} , "\n      ", React.createElement("div", {"style": style("flex: 1; min-width: 0")} , "\n        ", React.createElement("div", {"style": style("font-size: 28px; font-weight: 800; line-height: 1.15")} , v.modalTitle), "\n        ", React.createElement("div", {"style": style("font-size: 17px; font-weight: 600; color: #475569; margin-top: 4px; line-height: 1.4")} , v.modalSub), "\n      "), "\n      ", React.createElement("button", {"onClick": v.closeModal, "aria-label": "Close", "style": style("width: 52px; height: 52px; flex: none; border-radius: 14px; border: none; background: #F1F5F9; color: #0F172A; display: flex; align-items: center; justify-content: center")} , React.createElement("svg", {"width": "24", "height": "24", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.6", "strokeLinecap": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M18 6L6 18M6 6l12 12"}))), "\n    "), "\n\n    ", "\n    ", (v.isMods ? React.createElement(React.Fragment, null, "\n      ", (v.modGroups || []).map((g, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n        ", React.createElement("div", {"style": style("display: flex; flex-direction: column; gap: 10px")} , "\n          ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px")} , "\n            ", React.createElement("span", {"style": style("font-size: 19px; font-weight: 800")} , g.label), "\n            ", React.createElement("span", {"style": style(g.reqStyle)} , g.reqLabel), "\n          "), "\n          ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px")} , "\n            ", (g.options || []).map((o, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n              ", React.createElement("button", {"onClick": o.pick, "aria-pressed": o.pressed, "style": style(o.style)} , "\n                ", React.createElement("span", {"style": style("font-size: 18px; font-weight: 800")} , o.label), "\n                ", React.createElement("span", {"style": style("font-size: 14px; font-weight: 700")} , o.price), "\n              "), "\n            "))), "\n          "), "\n        "), "\n      "))), "\n      ", React.createElement("button", {"onClick": v.modAdd, "disabled": v.modAddDisabled, "style": style(v.modAddStyle)} , v.modAddLabel), "\n    ") : null), "\n\n    ", "\n    ", (v.isNote ? React.createElement(React.Fragment, null, "\n      ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px")} , "\n        ", (v.noteChips || []).map((nc, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n          ", React.createElement("button", {"onClick": nc.toggle, "aria-pressed": nc.pressed, "style": style(nc.style)} , nc.label), "\n        "))), "\n      "), "\n      ", React.createElement("label", {"style": style("display: flex; flex-direction: column; gap: 8px; font-size: 16px; font-weight: 800")} , "Or type the note\n        ", React.createElement("input", {"type": "text", "value": v.noteText, "onChange": v.onNoteText, "placeholder": "e.g. medium rare, no onions", "style": style("height: 60px; border-radius: 14px; border: 2px solid #CBD5E1; padding: 0 18px; font-size: 19px; font-weight: 600; color: #0F172A")}), "\n      "), "\n      ", React.createElement("div", {"style": style("display: flex; gap: 10px")} , "\n        ", React.createElement("button", {"onClick": v.closeModal, "style": style("flex: 1; height: 64px; border-radius: 16px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; font-size: 19px; font-weight: 800")} , "Back"), "\n        ", React.createElement("button", {"onClick": v.saveNote, "style": style("flex: 2; height: 64px; border-radius: 16px; border: none; background: #2563EB; color: #FFFFFF; font-size: 20px; font-weight: 800")} , "Save note"), "\n      "), "\n    ") : null), "\n\n    ", "\n    ", (v.isCancel ? React.createElement(React.Fragment, null, "\n      ", React.createElement("div", {"style": style("padding: 16px; border-radius: 16px; background: #F8FAFC; border: 1px solid #E2E8F0; display: flex; align-items: center; gap: 14px; flex-wrap: wrap")} , "\n        ", React.createElement("div", {"style": style("flex: 1; min-width: 200px")} , "\n          ", React.createElement("div", {"style": style("font-size: 20px; font-weight: 800")} , v.cxName), "\n          ", (v.cxHasMods ? React.createElement(React.Fragment, null, React.createElement("div", {"style": style("font-size: 15px; font-weight: 700; color: #475569")} , v.cxMods)) : null), "\n          ", React.createElement("div", {"style": style("font-size: 14px; font-weight: 700; color: #475569; margin-top: 4px")} , v.cxMeta), "\n        "), "\n        ", (v.cxMulti ? React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 8px")} , "\n            ", React.createElement("span", {"style": style("font-size: 15px; font-weight: 800; color: #475569")} , "How many?"), "\n            ", React.createElement("button", {"onClick": v.cxDec, "aria-label": "Cancel fewer", "style": style("width: 48px; height: 48px; border-radius: 12px; border: 2px solid #CBD5E1; background: #FFFFFF; font-size: 24px; font-weight: 800; color: #0F172A")} , "−"), "\n            ", React.createElement("span", {"style": style("font-size: 22px; font-weight: 800; min-width: 64px; text-align: center")} , v.cxQty + " " + v.cxMax), "\n            ", React.createElement("button", {"onClick": v.cxInc, "aria-label": "Cancel more", "style": style("width: 48px; height: 48px; border-radius: 12px; border: 2px solid #CBD5E1; background: #FFFFFF; font-size: 24px; font-weight: 800; color: #0F172A")} , "+"), "\n          "), "\n        ") : null), "\n      "), "\n      ", React.createElement("div", {"style": style("font-size: 19px; font-weight: 800")} , "Why? ", React.createElement("span", {"style": style("font-size: 15px; color: #B91C1C")} , "Required")), "\n      ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px")} , "\n        ", (v.cxReasons || []).map((rs, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n          ", React.createElement("button", {"onClick": rs.pick, "aria-pressed": rs.pressed, "style": style(rs.style)} , rs.label), "\n        "))), "\n      "), "\n      ", (v.cxIsOther ? React.createElement(React.Fragment, null, "\n        ", React.createElement("label", {"style": style("display: flex; flex-direction: column; gap: 8px; font-size: 16px; font-weight: 800")} , "Write the reason\n          ", React.createElement("input", {"type": "text", "value": v.cxOther, "onChange": v.onCxOther, "style": style("height: 56px; border-radius: 14px; border: 2px solid #CBD5E1; padding: 0 16px; font-size: 18px; font-weight: 600; color: #0F172A")}), "\n        "), "\n      ") : null), "\n      ", React.createElement("div", {"style": style("padding: 14px 16px; border-radius: 14px; background: #FFF7ED; color: #7C2D12; font-size: 16px; font-weight: 700; line-height: 1.45")} , v.cxInfo), "\n      ", React.createElement("div", {"style": style("display: flex; gap: 10px")} , "\n        ", React.createElement("button", {"onClick": v.closeModal, "style": style("flex: 1; height: 64px; border-radius: 16px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; font-size: 19px; font-weight: 800")} , "Keep item"), "\n        ", React.createElement("button", {"onClick": v.cxConfirm, "disabled": v.cxDisabled, "style": style(v.cxStyle)} , "Cancel item"), "\n      "), "\n    ") : null), "\n\n    ", "\n    ", (v.isMoveTable ? React.createElement(React.Fragment, null, "\n      ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px")} , "\n        ", (v.mtTables || []).map((mt, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n          ", React.createElement("button", {"onClick": mt.pick, "disabled": mt.disabled, "aria-label": mt.aria, "style": style(mt.style)} , "\n            ", React.createElement("span", {"style": style("font-size: 30px; font-weight: 800; line-height: 1")} , mt.num), "\n            ", React.createElement("span", {"style": style("font-size: 13px; font-weight: 800")} , mt.sub), "\n          "), "\n        "))), "\n      "), "\n      ", React.createElement("button", {"onClick": v.mtConfirm, "disabled": v.mtDisabled, "style": style(v.mtStyle)} , v.mtLabel), "\n    ") : null), "\n\n    ", "\n    ", (v.isMoveItems ? React.createElement(React.Fragment, null, "\n      ", React.createElement("div", {"style": style("display: flex; gap: 20px; flex-wrap: wrap")} , "\n        ", React.createElement("div", {"style": style("flex: 1 1 300px; display: flex; flex-direction: column; gap: 8px")} , "\n          ", React.createElement("div", {"style": style("font-size: 17px; font-weight: 800")} , "1. Tick the items to move"), "\n          ", (v.miItems || []).map((mi, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n            ", React.createElement("button", {"onClick": mi.toggle, "aria-pressed": mi.pressed, "style": style(mi.style)} , "\n              ", React.createElement("span", {"style": style(mi.boxStyle)} , (mi.checked ? React.createElement(React.Fragment, null, React.createElement("svg", {"width": "18", "height": "18", "viewbox": "0 0 24 24", "fill": "none", "stroke": "#FFFFFF", "strokeWidth": "3.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M20 6L9 17l-5-5"}))) : null)), "\n              ", React.createElement("span", {"style": style("flex: 1; text-align: left")} , "\n                ", React.createElement("span", {"style": style("display: block; font-size: 17px; font-weight: 800")} , mi.label), "\n                ", React.createElement("span", {"style": style("display: block; font-size: 13px; font-weight: 700; color: #475569")} , mi.sub), "\n              "), "\n            "), "\n          "))), "\n        "), "\n        ", React.createElement("div", {"style": style("flex: 1 1 300px; display: flex; flex-direction: column; gap: 8px")} , "\n          ", React.createElement("div", {"style": style("font-size: 17px; font-weight: 800")} , "2. Pick the table"), "\n          ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px")} , "\n            ", (v.miTables || []).map((mt, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n              ", React.createElement("button", {"onClick": mt.pick, "aria-label": mt.aria, "style": style(mt.style)} , "\n                ", React.createElement("span", {"style": style("font-size: 26px; font-weight: 800; line-height: 1")} , mt.num), "\n                ", React.createElement("span", {"style": style("font-size: 12px; font-weight: 800")} , mt.sub), "\n              "), "\n            "))), "\n          "), "\n        "), "\n      "), "\n      ", React.createElement("button", {"onClick": v.miConfirm, "disabled": v.miDisabled, "style": style(v.miStyle)} , v.miLabel), "\n    ") : null), "\n\n    ", "\n    ", (v.isBill ? React.createElement(React.Fragment, null, "\n      ", (v.bConfirm ? React.createElement(React.Fragment, null, "\n        ", React.createElement("div", {"style": style("border: 1px solid #E2E8F0; border-radius: 16px; overflow: hidden")} , "\n          ", (v.billLines || []).map((bl, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n            ", React.createElement("div", {"style": style("display: flex; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #F1F5F9; align-items: baseline")} , "\n              ", React.createElement("span", {"style": style("font-size: 18px; font-weight: 800; width: 40px")} , bl.qty), "\n              ", React.createElement("span", {"style": style("flex: 1")} , "\n                ", React.createElement("span", {"style": style("display: block; font-size: 18px; font-weight: 700")} , bl.name), "\n                ", (bl.hasMods ? React.createElement(React.Fragment, null, React.createElement("span", {"style": style("display: block; font-size: 14px; font-weight: 700; color: #475569")} , bl.mods)) : null), "\n              "), "\n              ", React.createElement("span", {"style": style("font-size: 18px; font-weight: 800")} , bl.amount), "\n            "), "\n          "))), "\n          ", React.createElement("div", {"style": style("display: flex; justify-content: space-between; padding: 16px; background: #F8FAFC")} , "\n            ", React.createElement("span", {"style": style("font-size: 20px; font-weight: 800")} , "Total"), "\n            ", React.createElement("span", {"style": style("font-size: 30px; font-weight: 800")} , v.billTotal), "\n          "), "\n        "), "\n        ", (v.billBlocked ? React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"role": "alert", "style": style("padding: 14px 16px; border-radius: 14px; background: #FEF2F2; color: #991B1B; font-size: 17px; font-weight: 800; line-height: 1.4")} , v.billBlockedText), "\n        ") : null), "\n        ", React.createElement("div", {"style": style("display: flex; gap: 10px")} , "\n          ", React.createElement("button", {"onClick": v.closeModal, "style": style("flex: 1; height: 72px; border-radius: 16px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; font-size: 20px; font-weight: 800")} , "No, go back"), "\n          ", React.createElement("button", {"onClick": v.bYes, "disabled": v.billBlocked, "style": style(v.bYesStyle)} , "Yes, continue"), "\n        "), "\n      ") : null), "\n\n      ", (v.bMethod ? React.createElement(React.Fragment, null, "\n        ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px")} , "\n          ", React.createElement("button", {"onClick": v.bCash, "style": style("min-height: 170px; border-radius: 22px; border: none; background: #16A34A; color: #FFFFFF; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; box-shadow: 0 10px 24px rgba(22, 163, 74, 0.3)")} , "\n            ", React.createElement("svg", {"width": "48", "height": "48", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("rect", {"x": "2", "y": "6", "width": "20", "height": "12", "rx": "2"}), React.createElement("circle", {"cx": "12", "cy": "12", "r": "3"}), React.createElement("path", {"d": "M6 12h.01M18 12h.01"})), "\n            ", React.createElement("span", {"style": style("font-size: 32px; font-weight: 800")} , "Cash"), "\n          "), "\n          ", React.createElement("button", {"onClick": v.bCard, "style": style("min-height: 170px; border-radius: 22px; border: none; background: #2563EB; color: #FFFFFF; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; box-shadow: 0 10px 24px rgba(37, 99, 235, 0.3)")} , "\n            ", React.createElement("svg", {"width": "48", "height": "48", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("rect", {"x": "2", "y": "5", "width": "20", "height": "14", "rx": "2"}), React.createElement("path", {"d": "M2 10h20"}), React.createElement("path", {"d": "M6 15h4"})), "\n            ", React.createElement("span", {"style": style("font-size: 32px; font-weight: 800")} , "Card"), "\n          "), "\n        "), "\n        ", React.createElement("button", {"onClick": v.bBack, "style": style("height: 56px; border-radius: 14px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; font-size: 18px; font-weight: 800")} , "Back"), "\n      ") : null), "\n\n      ", (v.bAccount ? React.createElement(React.Fragment, null, "\n        ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px")} , "\n          ", React.createElement("button", {"onClick": v.bAccA, "style": style("min-height: 170px; border-radius: 22px; border: 3px solid #2563EB; background: #EAF1FF; color: #1E3A8A; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px")} , "\n            ", React.createElement("span", {"style": style("font-size: 34px; font-weight: 800")} , "Account A"), "\n            ", React.createElement("span", {"style": style("font-size: 17px; font-weight: 700")} , "Prints on Printer A"), "\n          "), "\n          ", React.createElement("button", {"onClick": v.bAccB, "style": style("min-height: 170px; border-radius: 22px; border: 3px solid #7E22CE; background: #F3E8FF; color: #581C87; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px")} , "\n            ", React.createElement("span", {"style": style("font-size: 34px; font-weight: 800")} , "Account B"), "\n            ", React.createElement("span", {"style": style("font-size: 17px; font-weight: 700")} , "Prints on Printer B"), "\n          "), "\n        "), "\n        ", React.createElement("button", {"onClick": v.bBack, "style": style("height: 56px; border-radius: 14px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; font-size: 18px; font-weight: 800")} , "Back"), "\n      ") : null), "\n\n      ", (v.bReceipt ? React.createElement(React.Fragment, null, "\n        ", React.createElement("div", {"style": style("display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start")} , "\n          ", React.createElement("div", {"style": style("flex: 1 1 280px; background: #FFFFFF; border: 2px dashed #CBD5E1; border-radius: 12px; padding: 18px; font-family: 'Courier New', ui-monospace, monospace; color: #0F172A; display: flex; flex-direction: column; gap: 6px")} , "\n            ", React.createElement("div", {"style": style("text-align: center; font-size: 22px; font-weight: 800; letter-spacing: 0.2em")} , "ARRA"), "\n            ", React.createElement("div", {"style": style("text-align: center; font-size: 13px")} , v.billNo + " · " + v.billTable), "\n            ", React.createElement("div", {"style": style("text-align: center; font-size: 13px")} , v.billDate + " · " + v.billWaiter), "\n            ", React.createElement("div", {"style": style("border-top: 1px dashed #94A3B8; margin: 6px 0")}), "\n            ", (v.billLines || []).map((bl, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n              ", React.createElement("div", {"style": style("display: flex; gap: 8px; font-size: 14px")} , "\n                ", React.createElement("span", {"style": style("width: 30px")} , bl.qty), React.createElement("span", {"style": style("flex: 1")} , bl.name), React.createElement("span", {} , bl.amount), "\n              "), "\n            "))), "\n            ", React.createElement("div", {"style": style("border-top: 1px dashed #94A3B8; margin: 6px 0")}), "\n            ", React.createElement("div", {"style": style("display: flex; justify-content: space-between; font-size: 18px; font-weight: 800")} , React.createElement("span", {} , "TOTAL"), React.createElement("span", {} , v.billTotal)), "\n            ", React.createElement("div", {"style": style("font-size: 13px; margin-top: 4px")} , v.billMethodLine), "\n          "), "\n          ", React.createElement("div", {"style": style("flex: 1 1 260px; display: flex; flex-direction: column; gap: 10px")} , "\n            ", React.createElement("div", {"style": style("display: flex; justify-content: space-between; padding: 14px 16px; border-radius: 14px; background: #F8FAFC; font-size: 17px; font-weight: 800")} , React.createElement("span", {"style": style("color: #475569")} , "Payment"), React.createElement("span", {} , v.billMethod)), "\n            ", React.createElement("div", {"style": style("display: flex; justify-content: space-between; padding: 14px 16px; border-radius: 14px; background: #F8FAFC; font-size: 17px; font-weight: 800")} , React.createElement("span", {"style": style("color: #475569")} , "Account"), React.createElement("span", {"style": style(v.billAccStyle)} , v.billAccount)), "\n            ", React.createElement("div", {"style": style("display: flex; justify-content: space-between; padding: 14px 16px; border-radius: 14px; background: #F8FAFC; font-size: 17px; font-weight: 800")} , React.createElement("span", {"style": style("color: #475569")} , "Printer"), React.createElement("span", {} , v.billPrinter)), "\n            ", (v.isCard ? React.createElement(React.Fragment, null, "\n              ", React.createElement("div", {"style": style("display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-radius: 14px; background: #EAF1FF; color: #1E3A8A; font-size: 15px; font-weight: 800; line-height: 1.35")} , "\n                ", React.createElement("svg", {"width": "22", "height": "22", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true", "style": style("flex: none")} , React.createElement("rect", {"x": "5", "y": "11", "width": "14", "height": "10", "rx": "2"}), React.createElement("path", {"d": "M8 11V7a4 4 0 0 1 8 0v4"})), "\n                Card is always Account A and Printer A. This can't be changed.\n              "), "\n            ") : null), "\n\n            ", (v.bReview ? React.createElement(React.Fragment, null, "\n              ", React.createElement("button", {"onClick": v.bPrint, "style": style("height: 76px; border-radius: 18px; border: none; background: #2563EB; color: #FFFFFF; font-size: 24px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 12px; box-shadow: 0 10px 24px rgba(37, 99, 235, 0.3)")} , "\n                ", React.createElement("svg", {"width": "26", "height": "26", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.4", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M6 9V3h12v6"}), React.createElement("rect", {"x": "6", "y": "14", "width": "12", "height": "7"}), React.createElement("path", {"d": "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"})), "\n                Print bill\n              "), "\n              ", React.createElement("button", {"onClick": v.bBack, "style": style("height: 56px; border-radius: 14px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; font-size: 18px; font-weight: 800")} , "Back"), "\n            ") : null), "\n\n            ", (v.bFailed ? React.createElement(React.Fragment, null, "\n              ", React.createElement("div", {"role": "alert", "style": style("padding: 14px 16px; border-radius: 14px; background: #DC2626; color: #FFFFFF; font-size: 17px; font-weight: 800; line-height: 1.4")} , v.failText), "\n              ", React.createElement("button", {"onClick": v.bRetry, "style": style("height: 64px; border-radius: 16px; border: none; background: #2563EB; color: #FFFFFF; font-size: 20px; font-weight: 800")} , "Retry printing"), "\n              ", React.createElement("button", {"onClick": v.bBackup, "style": style("height: 56px; border-radius: 14px; border: 2px solid #2563EB; background: #FFFFFF; color: #1D4ED8; font-size: 18px; font-weight: 800")} , "Print on backup printer"), "\n            ") : null), "\n\n            ", (v.bPrinted ? React.createElement(React.Fragment, null, "\n              ", React.createElement("div", {"style": style("padding: 14px 16px; border-radius: 14px; background: #DCFCE7; color: #14532D; font-size: 17px; font-weight: 800; line-height: 1.4; display: flex; gap: 10px; align-items: flex-start")} , "\n                ", React.createElement("svg", {"width": "22", "height": "22", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "3", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true", "style": style("flex: none; margin-top: 1px")} , React.createElement("path", {"d": "M20 6L9 17l-5-5"})), "\n                ", React.createElement("span", {} , v.printedText), "\n              "), "\n              ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 700; color: #475569; line-height: 1.4")} , "Printing is not the payment. When the customer has paid, press the green button."), "\n              ", React.createElement("button", {"onClick": v.bPaid, "style": style("height: 80px; border-radius: 18px; border: none; background: #16A34A; color: #FFFFFF; font-size: 24px; font-weight: 800; box-shadow: 0 10px 24px rgba(22, 163, 74, 0.32)")} , "Paid · close table"), "\n              ", React.createElement("button", {"onClick": v.bReprint, "style": style("height: 52px; border-radius: 14px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; font-size: 17px; font-weight: 800")} , "Reprint bill"), "\n            ") : null), "\n          "), "\n        "), "\n      ") : null), "\n    ") : null), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.hasToast ? React.createElement(React.Fragment, null, "\n  ", React.createElement("div", {"role": "status", "style": style(v.toastStyle)} , v.toastText), "\n") : null), "\n\n"), "\n");
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(WaiterDemo));
