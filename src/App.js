// Capture the bridge once so a lost desktop connection cannot select demo behavior.
const desktopBridge = window.arra;
function waiterTranslate(language, key, values = {}) {
  if (typeof ArraComponents !== 'undefined' && ArraComponents.translate) {
    const result = ArraComponents.translate(language, key, values);
    if (result !== key) return result;
  }
  return key.replace(/^waiter\./, '').replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
function printDestination(language, destination) {
  const keys = { kitchen: 'Kitchen', bar: 'Bar', bill: 'Bill' };
  return Object.hasOwn(keys, destination) ? waiterTranslate(language, 'waiter.' + keys[destination]) : waiterTranslate(language, 'waiter.Unknown destination');
}
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

class TestPrintJobs extends React.Component {
  constructor(props) { super(props); this.state = { data:null, error:'', busy:false }; this.tokens = {}; }
  componentDidMount() { this.load(); }
  componentDidUpdate(prev) { if (prev.revision !== this.props.revision) this.load(); }
  async load() {
    if (!desktopBridge.testPrinting) return;
    try { const r = await desktopBridge.testPrinting({action:'list'}); if (r.disabled) this.setState({disabled:true}); else if (r.ok) this.setState({data:r.data,error:'',disabled:false}); else this.setState({error:waiterTranslate(this.props?.language, "waiter.Test print status unavailable. Displayed jobs may be stale; check the printer and refresh.")}); }
    catch (_) { this.setState({error:waiterTranslate(this.props?.language, "waiter.Test print status unavailable. Displayed jobs may be stale; check the printer and refresh.")}); }
  }
  async change(request) {
    if (this.state.busy) return;
    this.setState({busy:true,error:''});
    const r = await desktopBridge.testPrinting(request);
    if (r.ok) { if (request.action === 'retry') delete this.tokens[request.jobId]; this.setState({data:r.data,busy:false}); }
    else this.setState({busy:false,error:waiterTranslate(this.props?.language, "waiter.Unable to change test printing. Check permission and output before trying again.")});
  }
  render() {
    const h=React.createElement, d=this.state.data;
    if (this.state.disabled || (!d && !this.state.error)) return null;
    return h('section',{style:{padding:12,background:'#fff7ed'}},h('strong',null,waiterTranslate(this.props?.language, "waiter.TEST MODE: Windows printer queues")),
      h('p',null,waiterTranslate(this.props?.language, "waiter.Queue acceptance does not confirm paper. Inspect the printer and paper before retrying.")),
      this.state.error && h('p',{role:'alert'},this.state.error),
      (d?.queues || []).map(q=>h('div',{key:q.destination},h('label',null,waiterTranslate(this.props?.language, 'waiter.{destination} queue', {destination:printDestination(this.props?.language, q.destination)}) + ' ',h('input',{defaultValue:q.queue,id:'test-queue-'+q.destination,maxLength:255})),h('button',{disabled:this.state.busy,onClick:()=>this.change({action:'configure',destination:q.destination,queue:document.getElementById('test-queue-'+q.destination).value})},waiterTranslate(this.props?.language, "waiter.Save queue")))),
      h('p',null,waiterTranslate(this.props?.language, "waiter.Changing queues requires employee management permission.")),
      h('button',{disabled:this.state.busy,onClick:()=>this.load()},waiterTranslate(this.props?.language, "waiter.Refresh test jobs")),
      (d?.jobs || []).map(j=>h('div',{key:j.id},waiterTranslate(this.props?.language, j.ticketId ? 'waiter.{destination} job #{id} · Table {table} · Round {round} · {attempts} attempt(s) · {queue} · ' : 'waiter.{destination} job #{id} · Bill #{bill} · {attempts} attempt(s) · {queue} · ', {destination:printDestination(this.props?.language, j.destination),id:j.id,table:j.tableId,round:j.round,bill:j.billId,attempts:j.attempts,queue:j.queue})+(j.cancelled ? waiterTranslate(this.props?.language, 'waiter.A ticket contains a cancelled item: do not retry. Earlier output may still arrive; tell preparation staff in person.') : j.result==='accepted'?waiterTranslate(this.props?.language, "waiter.Accepted by Windows; check paper"):j.result==='failed'?waiterTranslate(this.props?.language, "waiter.Queue missing"):waiterTranslate(this.props?.language, "waiter.Output uncertain; check paper")),
        !j.cancelled && h('button',{disabled:this.state.busy,onClick:()=>{if (!window.confirm(waiterTranslate(this.props?.language, "waiter.Have you checked the printer and paper? Retrying may print a duplicate."))) return; const requestId=this.tokens[j.id] || (this.tokens[j.id]=crypto.randomUUID()); this.change({action:'retry',jobId:j.id,requestId,checked:true});}},waiterTranslate(this.props?.language, "waiter.Retry after checking")))));
  }
}
class PrintJobs extends React.Component {
  constructor(props) { super(props); this.state = { jobs: [], printers: [], error: '', busy: false }; this.tokens = props.tokens || {}; }
  componentDidMount() { this.load(); }
  componentDidUpdate(previous) { if (previous.revision !== this.props.revision) this.load(); }
  async load() {
    try { const r = await desktopBridge.printJobs({ action: 'list' }); if (r.ok) this.setState({ ...r.data, error: '' }); else this.setState({ error: waiterTranslate(this.props?.language, "waiter.Print jobs unavailable.") }); }
    catch (_) { this.setState({ error: waiterTranslate(this.props?.language, "waiter.Print jobs unavailable.") }); }
  }
  async change(request) {
    if (this.busy) return;
    this.busy = true; this.setState({ busy: true });
    try {
      const r = await desktopBridge.printJobs(request);
      if (r.ok) { if (request.action === 'retry') delete this.tokens[request.jobId]; this.setState({ ...r.data, error: '' }); }
      else this.setState({ error: waiterTranslate(this.props?.language, "waiter.Print jobs unavailable. Try again.") });
    } catch (_) { this.setState({ error: waiterTranslate(this.props?.language, "waiter.Print jobs unavailable. Try again.") }); }
    finally { this.busy = false; this.setState({ busy: false }); }
  }
  retry(jobId) {
    const requestId = this.tokens[jobId] || (this.tokens[jobId] = crypto.randomUUID());
    return this.change({ action: 'retry', jobId, requestId });
  }
  render() {
    const h = React.createElement;
    return h('section', { style: { padding: '10px 20px', background: '#fff7ed', maxHeight: 220, overflow: 'auto' } },
      h('strong', null, waiterTranslate(this.props?.language, "waiter.Simulated preparation print history")),
      this.state.error && h('p', { role: 'alert' }, this.state.error),
      h('div', null, this.state.printers.map(p => h('label', { key: p.destination, style: { marginRight: 16 } }, waiterTranslate(this.props?.language, 'waiter.{destination} simulated result', {destination:printDestination(this.props?.language, p.destination)}) + ' ',
        h('select', { value: p.result, disabled: this.state.busy, onChange: e => this.change({ action: 'simulate', destination: p.destination, result: e.target.value }) },
          h('option', { value: 'success' }, waiterTranslate(this.props?.language, "waiter.Success")), h('option', { value: 'failed' }, waiterTranslate(this.props?.language, "waiter.Failure")), h('option', { value: 'uncertain' }, waiterTranslate(this.props?.language, "waiter.Uncertain")))))),
      this.state.jobs.map(j => h('div', { key: j.id }, waiterTranslate(this.props?.language, 'waiter.{destination} · Table {table} · Round {round} · {attempts} attempt(s) · ', {destination:printDestination(this.props?.language, j.destination),table:j.tableId,round:j.round,attempts:j.attempts}),
        j.cancelled ? waiterTranslate(this.props?.language, 'waiter.A ticket contains a cancelled item: do not retry. Earlier output may still arrive; tell preparation staff in person.') : j.result === 'uncertain' ? waiterTranslate(this.props?.language, "waiter.Output uncertain; check before retrying.") : j.result === 'failed' ? waiterTranslate(this.props?.language, "waiter.Simulated failure.") : waiterTranslate(this.props?.language, "waiter.Simulated success."),
        j.hadUncertain && j.result !== 'uncertain' && waiterTranslate(this.props?.language, "waiter. An earlier attempt was uncertain; duplicate output is possible."),
        !j.cancelled && j.result !== 'success' && h('button', { disabled: this.state.busy, onClick: () => this.retry(j.id), style: { marginLeft: 10 } }, waiterTranslate(this.props?.language, "waiter.Retry simulated job")))), h(TestPrintJobs,{revision:this.props?.revision,language:this.props?.language}));
  }
}

class WaiterDemo extends React.Component {
  constructor(...a) {
    super(...a); this._dataGeneration = 0; this._printRetryTokens = {}; this.state = this.seed();
    if (desktopBridge) {
      this._menu = { ...this._menu, cats: [], catById: {}, products: [], byId: {} };
      this.state.menuLoad = 'loading';
    }
  }
  componentDidMount() {
    this._mounted = true;
    if (desktopBridge?.language) desktopBridge.language({ action: 'get' }).then(r => { if (this._mounted && r.ok && ['en', 'sq'].includes(r.language)) this.setState({ language: r.language }); });
    this._tick = setInterval(() => this.forceUpdate(), 20000);
  }
  async changeLanguage(language) {
    if (this.state.languageBusy || !desktopBridge?.language) return;
    this.setState({ languageBusy: true, languageFeedback: '' });
    const r = await desktopBridge.language({ action: 'set', language });
    if (r.ok && typeof CustomEvent === 'function' && window.dispatchEvent) window.dispatchEvent(new CustomEvent('arra-language-changed', { detail: r.language }));
    if (this._mounted) this.setState(r.ok ? { language: r.language, languageBusy: false, languageFeedback: 'saved' } : { languageBusy: false, languageFeedback: 'failed' });
  }
  clearDesktopData() {
    this._dataGeneration++;
    this._menu = { ...this._menu, cats: [], catById: {}, products: [], byId: {}, G: {} };
    this.setState({ sections: [], orders: {}, items: [], tableId: null, modal: null, menuLoad: 'loading', tableLoad: 'loading' });
  }
  loadDesktopData() {
    const generation = ++this._dataGeneration;
    if (desktopBridge) {
      this.setState({ menuLoad: 'loading', tableLoad: 'loading' });
      desktopBridge.getMenu().then(result => {
        if (!this._mounted || generation !== this._dataGeneration) return;
        if (!result.ok) { this._menu = { ...this._menu, cats: [], catById: {}, products: [], byId: {}, G: {} }; this.setState({ menuLoad: 'error' }); return; }
        const categories = result.data.categories;
        const cats = categories.filter(c => !c.parentId).map(c => {
          const children = categories.filter(child => child.parentId === c.id);
          const hasDirectProducts = result.data.products.some(p => p.categoryId === c.id);
          const subs = [...(hasDirectProducts || !children.length ? [[c.id, c.name]] : []), ...children.map(child => [child.id, child.name])];
          return { id: c.id, label: c.name, color: '#1D4ED8', tint: '#EAF1FF', route: c.id === 'drinks' ? 'bar' : 'kitchen', subs };
        });
        const catById = Object.fromEntries(cats.map(c => [c.id, c]));
        const categoryById = Object.fromEntries(categories.map(c => [c.id, c]));
        const groups = result.data.groups || [], options = result.data.options || [];
        const G = Object.fromEntries(groups.map(g => [g.id, { label: g.name, req: !!g.required, opts: options.filter(o => o.groupId === g.id).map(o => [o.name, o.adjustment, o.id]) }]));
        const products = result.data.products.map(p => ({ id: p.id, name: p.name, price: p.price,
          cat: categoryById[p.categoryId].parentId || p.categoryId, sub: p.categoryId, groups: groups.filter(g => g.productId === p.id).map(g => g.id), route: catById[categoryById[p.categoryId].parentId || p.categoryId].route }));
        this._menu = { ...this._menu, cats, catById, products, G,
          byId: Object.fromEntries(products.map(p => [p.id, p])) };
        this.setState({ menuLoad: 'ready', cat: cats[0]?.id || '', sub: cats[0]?.subs[0]?.[0] || '' });
      }).catch(() => { if (this._mounted && generation === this._dataGeneration) { this._menu = { ...this._menu, cats: [], catById: {}, products: [], byId: {}, G: {} }; this.setState({ menuLoad: 'error' }); } });
      desktopBridge.getTables().then(result => {
        if (!this._mounted || generation !== this._dataGeneration) return;
        if (!result.ok) { this.setState({ tableLoad: 'error', sections: [], orders: {}, items: [], tableId: null, modal: null }); return; }
        const sections = [];
        result.data.forEach(table => {
          let section = sections.find(s => s.label === table.area);
          if (!section) { section = { label: table.area, ids: [] }; sections.push(section); }
          section.ids.push(table.id);
        });
        const orders = {};
        result.data.forEach(table => {
          if (table.orderId !== null) orders[table.id] = { id: table.orderId, openedAt: table.openedAt, openedBy: '', rounds: 0, log: [], untouched: table.untouched === true };
        });
        this.setState({ sections, orders, tableLoad: 'ready' });
      }).catch(() => { if (this._mounted && generation === this._dataGeneration) this.setState({ tableLoad: 'error', sections: [], orders: {}, items: [], tableId: null, modal: null }); });
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
      screen: 'login', user: '', pass: '', waiter: null, pinFor: null, pin: '',
      tableId: null, cat: 'food', sub: 'grill', search: '', tab: 'order', modal: null, toast: null,
      printers: { kitchen: true, bar: true, A: true, B: true },
      orders: {}, items: [], jobs: [], history: [], seq: 100, billNo: 1045,
      sections: desktopBridge ? [] : this.menu().sections, tableLoad: desktopBridge ? 'loading' : 'ready'
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
    if (desktopBridge) { st.orders = {}; st.items = []; st.history = []; }
    return st;
  }

  // ---------- helpers ----------
  fmt(v) { return Math.round(v).toLocaleString('en-US') + ' den'; }
  who(n) { return n.waiter ? n.waiter.name : ''; }
  mut(fn, callback) { this.setState(s => { const n = JSON.parse(JSON.stringify(s)); fn(n); return n; }, callback); }
  toast(n, msg, kind) {
    n.toast = { msg, kind: kind || 'ok' };
    clearTimeout(this._tt);
    this._tt = setTimeout(() => this.setState({ toast: null }), 4200);
  }
  log(n, tid, text) { const o = n.orders[tid]; if (o) o.log.push({ t: Date.now(), who: this.who(n), text }); }
  freeIfEmpty(n, tid) { if (desktopBridge) return; const o = n.orders[tid]; if (o && o.rounds === 0 && !n.items.some(x => x.tableId === tid)) delete n.orders[tid]; }
  rlabel(k) { return k === 'bar' ? 'Bar' : 'Kitchen'; }

  // ---------- login / waiter ----------
  async login() {
    if (this._signingIn) return;
    const { user, pass } = this.state;
    if (!user.trim() || !pass) { this.mut(n => this.toast(n, waiterTranslate(this.state.language, "waiter.Enter the restaurant username and password."), 'err')); return; }
    if (!desktopBridge) { this.setState({ screen: 'waiters', pass: '' }); return; }
    this._signingIn = true;
    try {
      const result = await desktopBridge.signIn(user, pass);
      if (!this._mounted) return;
      if (result.ok && result.admin) { this._identityGeneration = (this._identityGeneration || 0) + 1; this.setState({ screen: 'admin', pass: '', waiter: { name: result.name }, adminAccess: true }); }
      else if (result.ok) { this._menu = { ...this._menu, waiters: [] }; this.setState({ screen: 'waiters', pass: '', waiterMessage: waiterTranslate(this.state.language, "waiter.Loading waiters…") }); await this.loadWaiters(); }
      else this.mut(n => { n.pass = ''; this.toast(n, waiterTranslate(this.state.language, "waiter.Sign in failed."), 'err'); });
    } catch (_) {
      if (this._mounted) this.mut(n => { n.pass = ''; this.toast(n, waiterTranslate(this.state.language, "waiter.Sign in failed."), 'err'); });
    } finally { this._signingIn = false; }
  }
  async signOut() {
    if (desktopBridge && (this._opening || this._itemBusy || this._handoffInProgress || this._selecting || this._switching || this.state.modal?.unresolved)) return;
    if (desktopBridge) {
      this._identityGeneration = (this._identityGeneration || 0) + 1;
      this.clearDesktopData();
      try { if (!(await desktopBridge.signOut()).ok) { this.mut(n => this.toast(n, waiterTranslate(this.state.language, "waiter.Sign out failed."), 'err')); return; } }
      catch (_) { this.mut(n => this.toast(n, waiterTranslate(this.state.language, "waiter.Sign out failed."), 'err')); return; }
    }
    this._dataGeneration++;
    this.mut(n => { n.screen = 'login'; n.waiter = null; n.adminAccess = false; n.user = ''; n.pass = ''; });
  }
  async loadWaiters() {
    try {
      const result = await desktopBridge.getWaiters();
      if (!result.ok) throw new Error();
      this._menu = { ...this._menu, waiters: result.data.map(w => ({ id: w.id, name: w.name, pin: w.hasPin, isTransfer: w.isTransfer, color: '#1D4ED8' })) };
      this.setState({ waiterMessage: result.data.length ? '' : waiterTranslate(this.state.language, "waiter.No active waiters available.") });
    } catch (_) { this._menu = { ...this._menu, waiters: [] }; this.setState({ waiterMessage: waiterTranslate(this.state.language, "waiter.Waiters unavailable. Sign out and try again.") }); }
  }
  async chooseWaiter(w, pin) {
    if (this._selecting || this._switching) return;
    this._selecting = true;
    this._identityGeneration = (this._identityGeneration || 0) + 1;
    try {
      const selection = desktopBridge ? await desktopBridge.selectWaiter(w.id, pin) : { ok: true, admin: false };
      if (!selection.ok) throw new Error();
      if (desktopBridge) this.clearDesktopData();
      this.setState({ waiter: w, adminAccess: selection.admin === true, pin: '', screen: w.isTransfer ? 'transferCorrection' : 'tables' });
      if (desktopBridge && !w.isTransfer) this.loadDesktopData();
    } catch (_) { this.mut(n => { n.pin = ''; this.toast(n, waiterTranslate(this.state.language, "waiter.Waiter selection failed."), 'err'); }); }
    finally { this._selecting = false; }
  }
  pickWaiter(w) {
    if (this._switching) return;
    const ww = { id: w.id, name: w.name, color: w.color, isTransfer: w.isTransfer };
    if (desktopBridge || w.pin) this.setState({ pinFor: ww, pin: '', screen: 'pin' });
    else this.chooseWaiter(ww, '');
  }
  pinPress(k) {
    if (this._switching) return;
    let pin = this.state.pin;
    if (k === 'Clear') pin = '';
    else if (k === 'Del') pin = pin.slice(0, -1);
    const length = this.state.pinFor?.isTransfer ? 6 : 4;
    if (k !== 'Clear' && k !== 'Del' && pin.length < length) pin += k;
    if (pin.length === length) { this.setState({ pin: '' }); this.chooseWaiter(this.state.pinFor, pin); }
    else this.setState({ pin });
  }
  async switchWaiter(notice = '', afterAction = false) {
    if ((this._handoffInProgress && !afterAction) || this._opening || this._itemBusy || this._selecting || this._switching || this.state.modal?.unresolved) return;
    this._switching = true;
    this._identityGeneration = (this._identityGeneration || 0) + 1;
    try {
      if (desktopBridge) {
        // Remove protected views and disable identity actions until the transition completes.
        this.setState({ screen: 'waiters', adminAccess: false, waiter: null, switching: true, waiterMessage: waiterTranslate(this.state.language, "waiter.Switching user…"), modal: null, tableId: null, handoffNotice: notice });
        try { if (!(await desktopBridge.clearWaiter()).ok) throw new Error(); }
        catch (_) {
          this.setState({ waiterMessage: waiterTranslate(this.state.language, "waiter.Could not switch user. Choose a name or sign out to retry.") });
          return;
        }
      }
      if (desktopBridge) this.clearDesktopData(); else this._dataGeneration++;
      this.mut(n => { n.waiter = null; n.screen = 'waiters'; n.modal = null; n.tableId = null; n.handoffNotice = notice; if (desktopBridge) { n.sections = []; n.orders = {}; n.items = []; } });
      if (desktopBridge) await this.loadWaiters();
    } finally {
      this._switching = false;
      this.setState({ switching: false });
    }
  }
  async refreshAdminAccess(generation) {
    if (this._switching || generation !== (this._identityGeneration || 0)) return false;
    const result = await desktopBridge.adminAccess();
    if (this._switching || generation !== (this._identityGeneration || 0)) return false;
    if (!result.ok || !result.signedIn || !result.selected || !result.admin) {
      this.clearDesktopData();
      this.setState({ adminAccess: false, waiter: result.ok && result.signedIn && result.selected ? this.state.waiter : null,
        screen: result.ok && result.signedIn && result.selected ? 'tables' : result.ok && !result.signedIn ? 'login' : 'waiters',
        waiterMessage: waiterTranslate(this.state.language, "waiter.Session or administration access changed. Sign in or select your name again.") });
      if (result.ok && result.signedIn && result.selected) this.loadDesktopData();
      return false;
    }
    return true;
  }
  goTables() {
    if (this._itemBusy || this._handoffInProgress || this.state.modal?.unresolved) return;
    this.mut(n => {
      if (n.screen === 'order') {
        const p = n.items.filter(i => i.tableId === n.tableId && i.status === 'pending').reduce((a, i) => a + i.qty, 0);
        if (p > 0) this.toast(n, waiterTranslate(this.state.language, 'waiter.' + (p === 1 ? 'Table {id} still has {count} item not sent to the kitchen or bar.' : 'Table {id} still has {count} items not sent to the kitchen or bar.'), {id:n.tableId, count:p}), 'warn');
      }
      n.screen = 'tables'; n.modal = null;
    });
  }
  async openTable(id) {
    if (desktopBridge) {
      if (this._opening || this._itemBusy || this._handoffInProgress) return;
      this._opening = true;
      try {
        const result = await desktopBridge.openOrder(id);
        if (!this._mounted) return;
        if (!result.ok) { this.mut(n => this.toast(n, waiterTranslate(this.state.language, "waiter.Could not open table. Try again."), 'err')); return; }
        this.mut(n => {
          const old = n.orders[id];
          n.orders[id] = { id: result.data.id, openedAt: result.data.openedAt, openedBy: '', rounds: old?.rounds || 0,
            log: old?.log || [], untouched: result.data.untouched === true, itemsLoaded: old?.id === result.data.id && !!old.itemsLoaded };
        });
        const items = await desktopBridge.orderItems('list', result.data.id);
        if (!this._mounted) return;
        if (!items.ok) { this.mut(n => this.toast(n, waiterTranslate(this.state.language, "waiter.Could not load order items. Try again."), 'err')); return; }
        this.mut(n => {
          n.orders[id].itemsLoaded = true;
          this.replaceDesktopItems(n, id, items.data.items);
          n.tableId = id; n.screen = 'order'; n.tab = 'order'; n.search = '';
        });
      } catch (_) { if (this._mounted) this.mut(n => this.toast(n, waiterTranslate(this.state.language, "waiter.Could not open table. Try again."), 'err')); }
      finally { this._opening = false; }
      return;
    }
    this.mut(n => { n.tableId = id; n.screen = 'order'; n.tab = 'order'; n.search = ''; });
  }
  togglePrinter(k) {
    const names = { kitchen: 'Kitchen', bar: 'Bar', A: 'Bill A', B: 'Bill B' };
    this.mut(n => {
      n.printers[k] = !n.printers[k];
      this.toast(n, 'Demo: ' + names[k] + ' printer is now ' + (n.printers[k] ? 'online.' : 'offline.'), n.printers[k] ? 'ok' : 'warn');
    });
  }

  // ---------- order entry ----------
  replaceDesktopItems(n, tableId, items) {
    n.items = n.items.filter(i => i.tableId !== tableId).concat(items.map(i => ({
      id: i.id, tableId, pid: i.productId, name: i.name, unit: i.unitPrice, qty: i.quantity,
      mods: (i.modifiers || []).map(m => m.groupName + ': ' + m.optionName + ' (' + (m.adjustment >= 0 ? '+' : '') + m.adjustment + ')').join(' · '), note: i.note, status: i.status || 'pending', round: i.round || 0, sentAt: i.sentAt, sentBy: i.sentBy, route: i.route, cxQty: i.correctedQuantity || 0, cx: (i.corrections || []).map(c => ({ qty: c.quantity, reason: c.reason, who: c.actor, t: c.occurredAt }))
    })));
  }
  async changeDesktopItems(action, value) {
    if (this._itemBusy || (this._handoffInProgress && action !== 'send')) { this.mut(n => this.toast(n, waiterTranslate(this.state.language, "waiter.Please wait for the order to save."), 'warn')); return; }
    const tableId = this.state.tableId, orderId = this.state.orders[tableId]?.id;
    if (!orderId) return;
    this._itemBusy = true;
    // A lost response may hide a committed add; remain conservative until refreshed.
    if (action === 'add') this.mut(n => { n.orders[tableId].untouched = false; });
    try {
      const result = await desktopBridge.orderItems(action, orderId, value);
      if (!this._mounted) return;
      if (!result.ok) { this.mut(n => this.toast(n, waiterTranslate(this.state.language, "waiter.Could not save order items. Try again."), 'err')); return false; }
      this.mut(n => { this.replaceDesktopItems(n, tableId, result.data.items); if (action === 'add') n.orders[tableId].untouched = false; });
      if ((action === 'remove' || action === 'decrement') && result.data.items.length === 0) await this.refreshDesktopAvailability(tableId, orderId);
      return result.data;
    } catch (_) { if (this._mounted) this.mut(n => this.toast(n, waiterTranslate(this.state.language, "waiter.Could not save order items. Try again."), 'err')); }
    finally { this._itemBusy = false; }
  }
  async refreshDesktopAvailability(tableId, orderId) {
    let tables;
    try { tables = await desktopBridge.getTables(); } catch (_) { tables = null; }
    if (!this._mounted) return;
    const table = tables?.ok && Array.isArray(tables.data) ? tables.data.find(t => t.id === tableId && t.orderId === orderId) : null;
    if (table) this.mut(n => { if (n.orders[tableId]?.id === orderId) n.orders[tableId].untouched = table.untouched === true; });
  }
  addProduct(pid) {
    if (this._handoffInProgress) return;
    if (desktopBridge && !this.menu().byId[pid]?.groups.length) return this.changeDesktopItems('add', pid);
    this.mut(n => {
      const p = this.menu().byId[pid];
      if (!p) return;
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
  async modAdd() {
    if (desktopBridge) {
      if (this._itemBusy || this.state.modal?.saving) return;
      const modal = this.state.modal, p = this.menu().byId[modal.pid], G = this.menu().G;
      const optionIds = p.groups.filter(g => modal.sel[g] != null).map(g => G[g].opts[modal.sel[g]][2]);
      this.mut(n => { if (n.modal?.type === 'mods' && n.modal.pid === modal.pid) n.modal.saving = true; });
      const saved = await this.changeDesktopItems('add', { productId: p.id, optionIds });
      if (this._mounted) this.mut(n => {
        if (n.modal?.type === 'mods' && n.modal.pid === modal.pid && n.modal.saving) {
          if (saved) n.modal = null;
          else n.modal.saving = false;
        }
      });
      return;
    }
    this.mut(n => {
      const M = this.menu(); const p = M.byId[n.modal.pid];
      let d = 0; const ls = [];
      p.groups.forEach(g => { const k = n.modal.sel[g]; if (k != null) { ls.push(M.G[g].opts[k][0]); d += M.G[g].opts[k][1]; } });
      this.addItem(n, p, ls.join(' · '), d);
      n.modal = null;
    });
  }
  incItem(id) { if (desktopBridge) return this.changeDesktopItems('increment', id); this.mut(n => { const i = n.items.find(x => x.id === id); if (i && i.status === 'pending') i.qty++; }); }
  decItem(id) {
    if (desktopBridge) return this.changeDesktopItems('decrement', id);
    this.mut(n => {
      const i = n.items.find(x => x.id === id); if (!i || i.status !== 'pending') return;
      if (i.qty > 1) i.qty--; else this.dropItem(n, i);
    });
  }
  removeItem(id) { if (desktopBridge) return this.changeDesktopItems('remove', id); this.mut(n => { const i = n.items.find(x => x.id === id); if (i && i.status === 'pending') this.dropItem(n, i); }); }
  dropItem(n, i) {
    n.items = n.items.filter(x => x.id !== i.id);
    this.log(n, i.tableId, 'Removed ' + i.name + ' (was not sent yet)');
    this.freeIfEmpty(n, i.tableId);
  }
  openNote(id) { if (this._handoffInProgress) return; this.mut(n => { const i = n.items.find(x => x.id === id && x.status === 'pending'); if (i) n.modal = { type: 'note', itemId: id, text: i.note }; }); }
  async saveNote() {
    if (desktopBridge) {
      if (this._itemBusy) return;
      const modal = this.state.modal, tableId = this.state.tableId, orderId = this.state.orders[tableId]?.id;
      if (!modal || modal.type !== 'note' || !orderId) return;
      this._itemBusy = true;
      this.mut(n => { n.modal.saving = true; n.modal.error = ''; });
      try {
        const result = await desktopBridge.orderItems('note', orderId, { itemId: modal.itemId, note: modal.text.trim() });
        if (!this._mounted) return;
        if (!result.ok) { this.mut(n => { if (n.modal?.type === 'note' && n.modal.itemId === modal.itemId) { n.modal.saving = false; n.modal.error = waiterTranslate(this.state.language, "waiter.Could not save note. Try again."); } }); return; }
        this.mut(n => { this.replaceDesktopItems(n, tableId, result.data.items); if (n.modal?.type === 'note' && n.modal.itemId === modal.itemId) n.modal = null; });
      } catch (_) { if (this._mounted) this.mut(n => { if (n.modal?.type === 'note' && n.modal.itemId === modal.itemId) { n.modal.saving = false; n.modal.error = waiterTranslate(this.state.language, "waiter.Could not save note. Try again."); } }); }
      finally { this._itemBusy = false; }
      return;
    }
    this.mut(n => {
      const i = n.items.find(x => x.id === n.modal.itemId);
      if (i) { i.note = n.modal.text.trim(); this.log(n, i.tableId, i.note ? 'Note added to ' + i.name : 'Removed note from ' + i.name); }
      n.modal = null;
    });
  }

  // ---------- send / print ----------
  send() {
    if (desktopBridge) {
      if (this._itemBusy || this._handoffInProgress) return;
      const tableId = this.state.tableId, orderId = this.state.orders[tableId]?.id;
      if (!orderId) return;
      this._handoffInProgress = true;
      this._sendRequests = this._sendRequests || {};
      const token = this._sendRequests[orderId] || (this._sendRequests[orderId] = crypto.randomUUID());
      return this.changeDesktopItems('send', token).then(async data => {
        if (!data) return;
        delete this._sendRequests[orderId];
        this.setState({ printRevision: (this.state.printRevision || 0) + 1 });
        const pending = data.items.some(i => i.status === 'pending');
        let printNotice = '';
        try {
          const jobs = await desktopBridge.printJobs({ action: 'list' });
          if (!jobs.ok) printNotice = waiterTranslate(this.state.language, "waiter.Print status unavailable. Select a waiter and check print jobs.");
          else if (jobs.data.jobs.some(job => job.result !== 'success' || job.hadUncertain)) printNotice = waiterTranslate(this.state.language, "waiter.A print job needs attention or had uncertain output. Select a waiter to review it and retry if needed.");
        } catch (_) { printNotice = waiterTranslate(this.state.language, "waiter.Print status unavailable. Select a waiter and check print jobs."); }
        if (!this._mounted) return;
        const physicalNotice = data.testPrintEnabled ? waiterTranslate(this.state.language, "waiter.Test print output is not confirmed. Check the printer and paper.") : waiterTranslate(this.state.language, "waiter.No physical ticket was printed.");
        const notice = [pending ? waiterTranslate(this.state.language, 'waiter.Table {id} has new items still pending. Select a waiter, reopen the table and send again.', {id:tableId}) : '', printNotice, physicalNotice].filter(Boolean).join(' ');
        await this.switchWaiter(notice, true);
      }).finally(() => { this._handoffInProgress = false; });
    }
    let notice = '';
    this.mut(n => {
      const tid = n.tableId;
      const pend = n.items.filter(i => i.tableId === tid && i.status === 'pending');
      if (!pend.length) return;
      const o = n.orders[tid]; o.rounds++;
      const r = o.rounds, t = Date.now(), who = this.who(n);
      pend.forEach(i => { i.status = 'sent'; i.round = r; i.sentAt = t; i.sentBy = who; });
      const parts = [], bad = [], displayParts = [];
      ['kitchen', 'bar'].forEach(k => {
        const L = pend.filter(i => i.route === k); if (!L.length) return;
        const c = L.reduce((a, i) => a + i.qty, 0); const ok = n.printers[k];
        n.jobs.push({ id: 'j' + (n.seq++), tableId: tid, round: r, printer: k, count: c, status: ok ? 'ok' : 'failed', attempts: 1 });
        parts.push(this.rlabel(k) + ' got ' + c + (c === 1 ? ' item' : ' items'));
        displayParts.push(waiterTranslate(this.state.language, c === 1 ? 'waiter.{destination} got {count} item' : 'waiter.{destination} got {count} items', {destination:waiterTranslate(this.state.language, 'waiter.' + this.rlabel(k)), count:c}));
        if (!ok) bad.push(this.rlabel(k));
      });
      this.log(n, tid, 'Sent round ' + r + ': ' + parts.join(', ') + (bad.length ? ' (' + bad.join(' and ') + ' ticket did not print)' : ''));
      if (bad.length) notice = waiterTranslate(this.state.language, 'waiter.Round {round} is saved, but the {destinations} ticket did not print. Select a waiter to retry using the red bar.', {round:r,destinations:bad.map(x => waiterTranslate(this.state.language, 'waiter.'+x)).join(this.state.language === 'sq' ? ' dhe ' : ' and ')});
      else notice = waiterTranslate(this.state.language, 'waiter.Round {round} sent. {details}.', {round:r,details:displayParts.join(', ')});
    }, () => { if (notice) this.switchWaiter(notice); });
  }
  retryJob(id) {
    this.mut(n => {
      const j = n.jobs.find(x => x.id === id); if (!j) return;
      const l = this.rlabel(j.printer); j.attempts++;
      if (n.printers[j.printer]) {
        j.status = 'ok';
        this.log(n, j.tableId, 'Reprinted ' + l + ' ticket for round ' + j.round + ' (same items, nothing added twice)');
        this.toast(n, waiterTranslate(this.state.language, 'waiter.{destination} ticket printed. Nothing was added to the order twice.', {destination:waiterTranslate(this.state.language, 'waiter.'+l)}));
      } else {
        this.log(n, j.tableId, 'Retry of ' + l + ' ticket failed');
        this.toast(n, waiterTranslate(this.state.language, 'waiter.{destination} printer is still not responding. Try the backup printer.', {destination:waiterTranslate(this.state.language, 'waiter.'+l)}), 'err');
      }
    });
  }
  backupJob(id) {
    this.mut(n => {
      const j = n.jobs.find(x => x.id === id); if (!j) return;
      j.status = 'ok'; j.attempts++;
      const l = this.rlabel(j.printer);
      this.log(n, j.tableId, 'Printed ' + l + ' ticket for round ' + j.round + ' on the backup printer');
      this.toast(n, waiterTranslate(this.state.language, 'waiter.{destination} ticket printed on the backup printer.', {destination:waiterTranslate(this.state.language, 'waiter.'+l)}));
    });
  }

  // ---------- cancel ----------
  openCancel(id) { if (this._handoffInProgress) return; this.mut(n => { n.modal = { type: 'cancel', itemId: id, qty: 1, reason: '', other: '' }; }); }
  async confirmCancel() {
    if (desktopBridge) {
      const m = this.state.modal;
      if (!m || !m.reason || (m.reason === 'Other' && !m.other.trim()) || this._itemBusy) return;
      const reason = m.reason === 'Other' ? m.other.trim() : m.reason;
      const requestId = m.requestId || crypto.randomUUID();
      const tableId = this.state.tableId, orderId = this.state.orders[tableId]?.id;
      if (!orderId) return;
      this._itemBusy = true;
      this.mut(n => { n.modal.requestId = requestId; n.modal.saving = true; n.modal.error = '';  });
      try {
        const result = await desktopBridge.orderItems('correct', orderId, { itemId: m.itemId, quantity: m.qty, reason, requestId });
        if (!this._mounted) return;
        if (result.ok) await this.refreshDesktopAvailability(tableId, orderId);
        if (!this._mounted) return;
        this.mut(n => {
          if (result.ok) { this.replaceDesktopItems(n, tableId, result.data.items); n.modal = null; this.toast(n, waiterTranslate(this.state.language, 'waiter.Correction saved. Tell preparation staff in person.')); }
          else if (result.rejected && !n.modal.unresolved) { n.modal.saving = false; n.modal.unresolved = false; n.modal.requestId = null; const messages = { access_denied:'waiter.Correction denied. Sign in as a waiter with order access.', already_billed:'waiter.This order has already been billed. The item cannot be cancelled here.', unavailable:'waiter.The order or item is unavailable, or the remaining quantity changed. Return to the order and check it.', invalid_input:'waiter.Correction details are invalid. Check the quantity and explanation.' }; n.modal.error = waiterTranslate(this.state.language, messages[result.code] || 'waiter.Correction rejected. Check authorization and quantity.'); }
          else { n.modal.saving = false; n.modal.unresolved = true; n.modal.error = waiterTranslate(this.state.language, "waiter.Correction status unknown. Retry before leaving."); }
        });
      } catch (_) { if (this._mounted) this.mut(n => { n.modal.saving = false; n.modal.unresolved = true; n.modal.error = waiterTranslate(this.state.language, "waiter.Correction status unknown. Retry before leaving."); }); }
      finally { this._itemBusy = false; }
      return;
    }
    this.mut(n => {
      const m = n.modal; const i = n.items.find(x => x.id === m.itemId); if (!i) return;
      if (!m.reason || (m.reason === 'Other' && !m.other.trim())) return;
      const q = Math.min(m.qty, i.qty - i.cxQty);
      const reason = m.reason === 'Other' ? m.other.trim() : m.reason;
      i.cxQty += q; i.cx.push({ qty: q, reason, who: this.who(n), t: Date.now() });
      if (i.cxQty >= i.qty) i.status = 'cancelled';
      this.log(n, i.tableId, 'Cancelled ' + q + '× ' + i.name + '. Reason: ' + reason + '.');
      this.toast(n, waiterTranslate(n.language, 'waiter.Correction saved. Tell preparation staff in person.'));
      n.modal = null;
    });
  }

  // ---------- move ----------
  async confirmMoveTable() {
    if (desktopBridge) {
      if (this._itemBusy || this._handoffInProgress || this.state.modal?.saving) return;
      const from = this.state.tableId, to = this.state.modal?.dest, orderId = this.state.orders[from]?.id;
      if (!orderId || !to || to === from || (this.state.orders[to] && !this.state.orders[to].untouched)) return;
      this._moveRequests = this._moveRequests || {};
      const key = [orderId, from, to].join(':');
      const token = this._moveRequests[key] || (this._moveRequests[key] = crypto.randomUUID());
      this._itemBusy = true;
      this.mut(n => { n.modal.saving = true; n.modal.error = ''; });
      try {
        let result, reconciledTable;
        try { result = await desktopBridge.moveOrder(orderId, from, to, token); } catch (_) { result = { ok: false }; }
        if (!this._mounted) return;
        if (!result.ok) {
          let tables;
          try { tables = await desktopBridge.getTables(); } catch (_) { tables = { ok: false }; }
          if (!this._mounted) return;
          if (!tables?.ok || !Array.isArray(tables.data)) {
            this.mut(n => { n.modal.saving = false; n.modal.unresolved = true; n.modal.error = waiterTranslate(this.state.language, "waiter.Move status is unknown. Retry to check it before leaving."); });
            return;
          }
          const current = tables.data.find(t => t.orderId === orderId);
          reconciledTable = current;
          if (current?.id !== to) {
            this.mut(n => {
              const previous = n.orders;
              n.orders = {};
              for (const table of tables.data) if (table.orderId !== null)
                n.orders[table.id] = Object.values(previous).find(o => o.id === table.orderId) || { id: table.orderId, openedAt: table.openedAt, openedBy: '', rounds: 0, log: [], untouched: table.untouched === true };
              if (current?.id === from) {
                n.modal.saving = false; n.modal.unresolved = false; n.modal.dest = null;
                n.modal.error = waiterTranslate(this.state.language, "waiter.Order was not moved. Check the destination and try again.");
              } else {
                n.screen = 'tables'; n.tableId = null; n.modal = null; n.items = [];
                this.toast(n, waiterTranslate(this.state.language, 'waiter.Order location changed. Select a table to continue.'), 'warn');
              }
            });
            return;
          }
        }
        delete this._moveRequests[key];
        this.mut(n => {
          n.orders[to] = n.orders[from]; n.orders[to].untouched = false; delete n.orders[from];
          n.items.forEach(i => { if (i.tableId === from) i.tableId = to; });
          n.tableId = to; n.modal = null;
          this.toast(n, waiterTranslate(this.state.language, 'waiter.Everything moved to Table {to}. Table {from} is free now.', {to, from}));
        });
        if (reconciledTable) this.mut(n => { if (n.orders[to]?.id === orderId) n.orders[to].untouched = reconciledTable.untouched === true; });
        else await this.refreshDesktopAvailability(to, orderId);
      } finally { this._itemBusy = false; }
      return;
    }
    this.mut(n => {
      const from = n.tableId, to = n.modal.dest;
      if (to == null || to === from || n.orders[to]) return;
      n.orders[to] = n.orders[from]; delete n.orders[from];
      n.items.forEach(i => { if (i.tableId === from) i.tableId = to; });
      n.jobs.forEach(j => { if (j.tableId === from) j.tableId = to; });
      n.tableId = to;
      this.log(n, to, 'Moved the whole order from Table ' + from + ' to Table ' + to);
      this.toast(n, waiterTranslate(this.state.language, 'waiter.Everything moved to Table {to}. Table {from} is free now.', {to, from}));
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
      if (b.printed > 1) this.toast(n, waiterTranslate(this.state.language, "waiter.Bill reprinted. Still one payment."));
    });
  }
  paid() {
    if (desktopBridge) { this.mut(n => this.toast(n, waiterTranslate(this.state.language, "waiter.Closing orders is not available yet."), 'warn')); return; }
    let completed = false;
    this.mut(n => {
      const b = n.modal; const tid = n.tableId;
      if (!b || !b.printed) return;
      if (b.method === 'Card' && b.account !== 'A') { this.toast(n, waiterTranslate(this.state.language, "waiter.Blocked: card payments can only go to Account A."), 'err'); return; }
      const its = n.items.filter(i => i.tableId === tid);
      const total = its.reduce((a, i) => a + (i.qty - i.cxQty) * i.unit, 0);
      const count = its.reduce((a, i) => a + (i.qty - i.cxQty), 0);
      n.history.unshift({ no: n.billNo++, table: 'Table ' + tid, closedAt: Date.now(), waiter: this.who(n), method: b.method, account: b.account, total, count });
      n.items = n.items.filter(i => i.tableId !== tid);
      delete n.orders[tid];
      n.jobs = n.jobs.filter(j => j.tableId !== tid);
      n.modal = null; n.screen = 'tables'; n.tableId = null; completed = true;
      this.toast(n, waiterTranslate(this.state.language, 'waiter.Table {id} is free. Payment saved once: {method}, Account {account}, {total}.', {id:tid,method:waiterTranslate(this.state.language, 'waiter.'+b.method),account:b.account,total:this.fmt(total)}));
    }, () => { if (completed) this.switchWaiter(); });
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
    const t = (key, values) => waiterTranslate(s.language, 'waiter.' + key, values);
    v.t = t;

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
    v.signOut = () => this.signOut();

    // pin
    const pf = s.pinFor || { name: '', color: '#475569' };
    v.pinName = pf.name; v.pinInitial = pf.name ? pf.name[0] : ''; v.pinAv = av(pf.color, 84);
    v.pinDots = Array.from({ length: pf.isTransfer ? 6 : 4 }, (_, k) => ({ style: k < s.pin.length ? 'width:22px; height:22px; border-radius:999px; background:#0F172A' : 'width:22px; height:22px; border-radius:999px; border:3px solid #94A3B8; box-sizing:border-box' }));
    v.keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', 'Del'].map(k => ({
      label: k === 'Del' ? t('Delete') : k === 'Clear' ? t('Clear') : k,
      aria: k === 'Del' ? t('Delete last digit') : (k === 'Clear' ? t('Clear PIN') : t('Digit {digit}', {digit: k})),
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
    v.goHistory = () => { if (!this._handoffInProgress) this.mut(n => { n.screen = 'history'; n.modal = null; }); };
    v.switchWaiter = () => this.switchWaiter();
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
      text: t(j.count === 1 ? '{destination} ticket for Table {table} (round {round}, {count} item) did not print. The order is saved.' : '{destination} ticket for Table {table} (round {round}, {count} items) did not print. The order is saved.', {destination:t(this.rlabel(j.printer)), table:j.tableId, round:j.round, count:j.count}),
      attempts: t('Tried {count}×', {count:j.attempts}),
      retry: () => this.retryJob(j.id), backup: () => this.backupJob(j.id)
    }));

    // tables
    const tTotal = tid => s.items.filter(i => i.tableId === tid).reduce((a, i) => a + bq(i) * i.unit, 0);
    let free = 0, taken = 0;
    v.tableMessage = s.tableLoad === 'loading' ? t("Loading tables…") :
      s.tableLoad === 'error' ? t("Tables unavailable. Restart the app and try again.") :
      s.sections.length === 0 ? t("No tables available. Set up sample tables to get started.") : '';
    v.sections = s.sections.map(sec => ({
      label: sec.label,
      tables: sec.ids.map(id => {
        const o = s.orders[id]; const tk = !!o && !o.untouched; if (tk) taken++; else free++;
        const figuresKnown = !desktopBridge || !tk || !!o.itemsLoaded;
        const its = s.items.filter(i => i.tableId === id);
        const unsent = its.filter(i => i.status === 'pending').reduce((a, i) => a + i.qty, 0);
        const cnt = its.reduce((a, i) => a + bq(i), 0);
        const issue = s.jobs.some(j => j.tableId === id && j.status === 'failed');
        const mins = tk ? Math.max(0, Math.round((now - o.openedAt) / 60000)) : 0;
        return {
          num: String(id), taken: tk, free: !tk, total: figuresKnown ? money(tTotal(id)) : '—', waiter: tk ? o.openedBy : '',
          count: figuresKnown ? t(cnt === 1 ? '{count} item' : '{count} items', {count: cnt}) : t("Open to view items"), mins: mins + ' min',
          hasUnsent: figuresKnown && unsent > 0, unsent: t('{count} not sent', {count: unsent}), hasIssue: issue,
          aria: tk ? (figuresKnown ? t('Table {id}, taken, {total}', {id, total:money(tTotal(id))}) : t('Table {id}, taken, open to view items', {id})) : t('Table {id}, free', {id}),
          style: 'min-height:156px; border-radius:22px; padding:16px; display:flex; flex-direction:column; justify-content:space-between; align-items:flex-start; gap:10px; text-align:left; ' + (tk ? 'background:#F97316; color:#1A0B00; border:2px solid #EA580C; box-shadow:0 10px 22px rgba(249,115,22,0.28)' : 'background:#FFFFFF; color:#0F172A; border:2px solid #E2E8F0; box-shadow:0 4px 12px rgba(15,23,42,0.04)'),
          open: () => this.openTable(id)
        };
      })
    }));
    v.freeCount = t('{count} free', {count: free}); v.takenCount = t('{count} taken', {count: taken});

    // order screen
    const tid = s.tableId; const o = tid ? s.orders[tid] : null;
    v.tableName = tid ? t('Table {id}', {id: tid}) : '';
    v.orderMeta = o ? t(o.openedBy ? 'Opened {time} by {name} · {minutes} min' : 'Opened {time} · {minutes} min', {time:hm(o.openedAt), name:o.openedBy, minutes:Math.max(0, Math.round((now - o.openedAt) / 60000))}) : t("Free. Add products to open it.");
    v.statusLabel = o ? t("Taken") : t("Free");
    v.statusStyle = 'height:36px; padding:0 14px; border-radius:999px; display:inline-flex; align-items:center; font-size:15px; font-weight:800; ' + (o ? 'background:#F97316; color:#1A0B00' : 'background:#DCFCE7; color:#14532D');
    const cat = M.catById[s.cat] || { subs: [] };
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
    v.searchInfo = t(list.length === 1 ? '{count} match in the whole menu' : '{count} matches in the whole menu', {count: list.length});
    v.products = list.map(p => {
      const c = M.catById[p.cat]; const b = pendQ[p.id] || 0;
      return {
        name: p.name, price: money(p.price), hasOpts: p.groups.length > 0, hasBadge: b > 0, badge: String(b),
        aria: t(p.groups.length ? 'Add {name}, {price}, has options' : 'Add {name}, {price}', {name:p.name, price:money(p.price)}),
        style: 'position:relative; min-height:116px; border-radius:18px; padding:14px; display:flex; flex-direction:column; justify-content:space-between; align-items:flex-start; gap:10px; text-align:left; background:' + c.tint + '; border:3px solid ' + (b > 0 ? c.color : '#94A3B8'),
        priceStyle: 'font-size:16px; font-weight:800; color:' + c.color,
        add: () => this.addProduct(p.id)
      };
    });
    v.noProducts = list.length === 0;
    v.menuMessage = s.menuLoad === 'loading' ? t("Loading menu…") : s.menuLoad === 'error' ?
      t("Menu unavailable. Restart the app and try again.") : t("No products available.");

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
    v.pendingCount = t(pc === 1 ? '{count} item' : '{count} items', {count: pc});
    v.pending = pend.map(i => ({
      name: i.name, mods: i.mods, hasMods: !!i.mods, note: i.note, hasNote: !!i.note, qty: String(i.qty), amount: money(i.qty * i.unit),
      inc: () => this.incItem(i.id), dec: () => this.decItem(i.id), remove: () => this.removeItem(i.id), editNote: () => this.openNote(i.id),
      noteLabel: i.note ? t("Edit note") : t("Note"), decAria: t('One less {name}', {name: i.name}), incAria: t('One more {name}', {name: i.name}), removeAria: t('Remove {name}', {name: i.name})
    }));
    const sent = its.filter(i => i.status !== 'pending');
    const byRound = {};
    sent.forEach(i => { (byRound[i.round] = byRound[i.round] || []).push(i); });
    v.rounds = Object.keys(byRound).map(Number).sort((a, b) => b - a).map(r => {
      const L = byRound[r]; const first = L.reduce((a, i) => (i.sentAt < a.sentAt ? i : a), L[0]);
      return {
        title: t('Round {round}', {round: r}), meta: t('Sent {time} by {name}', {time: hm(first.sentAt), name: first.sentBy}),
        items: L.map(i => {
          const qq = bq(i); const all = qq === 0; const c = i.cx[i.cx.length - 1];
          return {
            name: i.name, mods: i.mods, hasMods: !!i.mods, note: i.note, hasNote: !!i.note,
            hasMoved: !!i.movedFrom, moved: t('From Table {id}', {id:i.movedFrom}),
            qtyLabel: (all ? i.qty : qq) + '×',
            qtyStyle: 'min-width:40px; height:36px; border-radius:10px; display:inline-flex; align-items:center; justify-content:center; font-size:17px; font-weight:800; ' + (all ? 'background:#F1F5F9; color:#64748B; text-decoration:line-through' : 'background:#0F172A; color:#FFFFFF'),
            nameStyle: 'font-size:17px; font-weight:800; ' + (all ? 'text-decoration:line-through; color:#64748B' : 'color:#0F172A'),
            amount: all ? t('Cancelled') : money(qq * i.unit),
            amountStyle: 'font-size:17px; font-weight:800; white-space:nowrap; color:' + (all ? '#B91C1C' : '#0F172A'),
            routeLabel: i.route === 'bar' ? 'Bar' : t('Kitchen'),
            routeStyle: 'height:24px; padding:0 8px; border-radius:6px; display:inline-flex; align-items:center; font-size:12px; font-weight:800; ' + (i.route === 'bar' ? 'background:#DBEAFE; color:#1E40AF' : 'background:#FFEDD5; color:#9A3412'),
            hasCx: i.cxQty > 0,
            cxText: c ? t('{count} cancelled total · latest: {qty} · {reason} · {who} {time}', {count:i.cxQty, qty:c.qty, reason:['Customer changed mind', 'Entered by mistake', 'Kitchen can’t make it', 'Took too long', 'Other'].includes(c.reason) ? t(c.reason) : c.reason, who:c.who, time:hm(c.t)}) + (desktopBridge ? '' : t(' · waiting for owner review')) : '',
            canCancel: qq > 0, cancel: () => this.openCancel(i.id), cancelAria: t('Cancel {name}', {name: i.name})
          };
        })
      };
    });
    const total = its.reduce((a, i) => a + bq(i) * i.unit, 0);
    v.total = money(total);
    v.sendDisabled = pc === 0;
    v.sendLabel = pc ? t('Send order · {count}', {count: pc}) : t("Nothing new to send");
    v.sendStyle = 'flex:2; height:72px; border-radius:18px; border:none; display:flex; align-items:center; justify-content:center; gap:10px; font-size:21px; font-weight:800; ' + (pc ? 'background:#16A34A; color:#FFFFFF; box-shadow:0 10px 22px rgba(22,163,74,0.35)' : 'background:#E2E8F0; color:#475569');
    const billable = sent.filter(i => bq(i) > 0);
    v.billDisabled = !o || (!desktopBridge && billable.length === 0);
    v.billStyle = 'flex:1; height:72px; border-radius:18px; border:none; display:flex; align-items:center; justify-content:center; gap:10px; font-size:21px; font-weight:800; ' + (v.billDisabled ? 'background:#E2E8F0; color:#475569' : 'background:#2563EB; color:#FFFFFF; box-shadow:0 10px 22px rgba(37,99,235,0.3)');
    v.moveDisabled = !o;
    v.moveStyle = 'flex:1; height:48px; border-radius:12px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:800; ' + (o ? 'border:2px solid #C4B5FD; background:#F5F3FF; color:#5B21B6' : 'border:2px solid #E2E8F0; background:#F8FAFC; color:#64748B');
    v.send = () => this.send();
    v.openBill = () => { if (!this._handoffInProgress) this.mut(n => { n.modal = { type: desktopBridge ? 'desktopBill' : 'bill', step: 'confirm', method: null, account: null, printed: 0, backup: false }; }); };
    v.openMoveTable = () => { if (!this._handoffInProgress) this.mut(n => { n.modal = { type: 'moveTable', dest: null }; }); };
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
    v.hasModal = !!md && ty !== 'desktopBill';
    v.isMods = ty === 'mods'; v.isNote = ty === 'note'; v.isCancel = ty === 'cancel';
    v.isMoveTable = ty === 'moveTable'; v.isBill = ty === 'bill';
    v.closeModal = () => { if (!this.state.modal?.saving && !this.state.modal?.unresolved) this.setState({ modal: null }); };
    v.modalTitle = ''; v.modalSub = '';
    v.modalCardStyle = 'background:#FFFFFF; border-radius:26px; width:100%; max-width:' + (ty === 'bill' ? '880px' : '760px') + '; max-height:calc(100vh - 40px); overflow:auto; padding:26px; box-sizing:border-box; display:flex; flex-direction:column; gap:20px; box-shadow:0 30px 80px rgba(15,23,42,0.35)';
    v.modGroups = []; v.noteChips = []; v.cxReasons = []; v.mtTables = []; v.miItems = []; v.miTables = []; v.billLines = [];
    const bigBtn = (on, bg, fg) => 'height:72px; border-radius:18px; border:none; font-size:21px; font-weight:800; ' + (on ? 'background:' + bg + '; color:' + fg + '; box-shadow:0 10px 22px rgba(15,23,42,0.18)' : 'background:#E2E8F0; color:#475569');
    const chip = on => 'min-height:60px; border-radius:16px; padding:10px 14px; font-size:17px; font-weight:800; text-align:center; ' + (on ? 'background:#0F172A; color:#FFFFFF; border:2px solid #0F172A' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1');

    if (ty === 'mods') {
      const p = M.byId[md.pid]; let d = 0, ok = true;
      v.modalTitle = p.name; v.modalSub = t('Pick the options from the paper order. Base price {price}.', {price: money(p.price)});
      v.modGroups = p.groups.map(gid => {
        const g = M.G[gid]; const sel = md.sel[gid];
        if (g.req && sel == null) ok = false;
        if (sel != null) d += g.opts[sel][1];
        return {
          label: g.label, reqLabel: g.req ? t("Required") : t("Optional"),
          reqStyle: 'height:26px; padding:0 10px; border-radius:999px; display:inline-flex; align-items:center; font-size:13px; font-weight:800; ' + (g.req ? (sel == null ? 'background:#FEE2E2; color:#991B1B' : 'background:#DCFCE7; color:#14532D') : 'background:#F1F5F9; color:#475569'),
          options: g.opts.map(([l, dd], k) => {
            const on = sel === k;
            return {
              label: l, price: dd ? (dd > 0 ? '+' : '') + money(dd) : t("Included"), pressed: String(on), disabled: !!md.saving,
              style: 'min-height:84px; border-radius:16px; padding:12px; display:flex; flex-direction:column; align-items:flex-start; justify-content:space-between; gap:6px; text-align:left; ' + (on ? 'background:#2563EB; color:#FFFFFF; border:2px solid #2563EB' : 'background:#F8FAFC; color:#0F172A; border:2px solid #CBD5E1'),
              pick: () => { if (!this._itemBusy && !this.state.modal?.saving) this.mut(n => { if (n.modal.sel[gid] === k && !g.req) delete n.modal.sel[gid]; else n.modal.sel[gid] = k; }); }
            };
          })
        };
      });
      v.modAddDisabled = !ok || !!md.saving;
      v.modAddLabel = md.saving ? t("Saving…") : ok ? t('Add to order · {price}', {price: money(p.price + d)}) : t("Pick the required options first");
      v.modAddStyle = bigBtn(ok && !md.saving, '#16A34A', '#FFFFFF');
      v.modAdd = () => this.modAdd();
    }

    if (ty === 'note') {
      const it = s.items.find(i => i.id === md.itemId);
      v.modalTitle = t('Note for {name}', {name: it ? it.name : ''});
      v.modalSub = md.error || (desktopBridge ? t('Save a note for this item. Leave blank to remove it.') : t('This prints on the kitchen or bar ticket.'));
      v.noteText = md.text; v.noteSaving = !!md.saving;
      const parts = md.text.split(',').map(x => x.trim()).filter(Boolean);
      v.noteChips = ['No onions', 'Less salt', 'Extra spicy', 'Sauce on the side', 'No ice', 'Bring first', 'For sharing', 'Kids portion'].map(l => {
        const note = t(l);
        const variants = [waiterTranslate('en', 'waiter.' + l), waiterTranslate('sq', 'waiter.' + l)];
        const on = parts.some(part => variants.includes(part));
        return {
          label: note, pressed: String(on), style: chip(on),
          toggle: () => this.mut(n => { let ps = n.modal.text.split(',').map(x => x.trim()).filter(Boolean); ps = ps.some(x => variants.includes(x)) ? ps.filter(x => !variants.includes(x)) : ps.concat(note); n.modal.text = ps.join(', '); })
        };
      });
      v.onNoteText = e => { const val = e.target.value; this.setState(st => ({ modal: Object.assign({}, st.modal, { text: val }) })); };
      v.saveNote = () => this.saveNote();
    }

    if (ty === 'cancel') {
      const it = s.items.find(i => i.id === md.itemId);
      const mx = it ? bq(it) : 1; const l = it ? t(this.rlabel(it.route)) : '';
      v.modalTitle = t("Cancel a sent item");
      v.modalSub = t("It was already sent, so it stays on record, crossed out.");
      v.cxName = it ? it.name : ''; v.cxMods = it ? it.mods : ''; v.cxHasMods = !!(it && it.mods);
      v.cxMeta = it ? t('Round {round} · sent {time} to {destination}', {round:it.round,time:hm(it.sentAt),destination:l}) : '';
      v.cxMulti = mx > 1; v.cxQty = String(md.qty); v.cxMax = t('of {count}', {count: mx}); v.cxMaxNumber = mx;
      v.cxInc = () => this.mut(n => { if (!n.modal.requestId) n.modal.qty = Math.min(mx, n.modal.qty + 1); });
      v.cxDec = () => this.mut(n => { if (!n.modal.requestId) n.modal.qty = Math.max(1, n.modal.qty - 1); });
      v.cxReasons = ['Customer changed mind', 'Entered by mistake', 'Kitchen can’t make it', 'Took too long', 'Other'].map(r => ({
        label: t(r), pressed: String(md.reason === r), style: chip(md.reason === r),
        pick: () => this.mut(n => { if (!n.modal.requestId) n.modal.reason = r; })
      }));
      v.cxReasonLabel = md.reason === 'Other' ? md.other.trim() : t(md.reason);
      v.cxIsOther = md.reason === 'Other'; v.cxOther = md.other;
      v.onCxOther = e => { const val = e.target.value; this.setState(st => st.modal.requestId ? null : ({ modal: Object.assign({}, st.modal, { other: val }) })); };
      const ok = !!md.reason && (md.reason !== 'Other' || md.other.trim().length > 0);
      v.cxDisabled = !ok;
      v.cxStyle = 'flex:2; ' + bigBtn(ok, '#DC2626', '#FFFFFF').replace('height:72px', 'height:64px');
      v.cxInfo = t('Tell preparation staff in person; no cancellation notice is printed and earlier output may still arrive.');
      v.cxConfirm = () => this.confirmCancel();
    }

    if (ty === 'moveTable') {
      v.modalTitle = t("Move the whole table");
      v.modalSub = md.error || t('Everything on Table {id} moves to the table you pick. Table {id} becomes free. Only free tables can be picked, so no order gets overwritten.', {id: tid});
      v.mtTables = s.sections.flatMap(sec => sec.ids).filter(id => id !== tid).map(id => {
        const tk = !!s.orders[id] && !s.orders[id].untouched; const on = md.dest === id;
        return {
          num: String(id), sub: tk ? t("Taken") : t("Free"), disabled: tk,
          aria: t(tk ? 'Table {id}, taken, not available' : 'Table {id}, free', {id}),
          style: 'min-height:84px; border-radius:16px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; ' + (tk ? 'background:#F1F5F9; color:#64748B; border:2px dashed #CBD5E1' : (on ? 'background:#7C3AED; color:#FFFFFF; border:2px solid #7C3AED' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1')),
          pick: () => { if (!this.state.modal?.saving && !this.state.modal?.unresolved) this.mut(n => { n.modal.dest = id; n.modal.error = ''; }); }
        };
      });
      v.mtDisabled = md.dest == null || !!md.saving;
      v.mtLabel = md.dest != null ? t('Move everything to Table {id}', {id: md.dest}) : t("Pick a free table");
      v.mtStyle = bigBtn(md.dest != null, '#7C3AED', '#FFFFFF');
      v.mtConfirm = () => this.confirmMoveTable();
    }

    if (ty === 'bill') {
      const b = md; const st = b.step;
      v.bConfirm = st === 'confirm'; v.bMethod = st === 'method'; v.bAccount = st === 'account';
      v.bReview = st === 'review'; v.bFailed = st === 'failed'; v.bPrinted = st === 'printed';
      v.bReceipt = v.bReview || v.bFailed || v.bPrinted;
      v.billLines = billable.map(i => ({ qty: bq(i) + '×', name: i.name, mods: i.mods, hasMods: !!i.mods, amount: money(bq(i) * i.unit) }));
      v.billTotal = money(billable.reduce((a, i) => a + bq(i) * i.unit, 0));
      v.billTable = t('Table {id}', {id:tid});
      v.billBlocked = pc > 0;
      v.billBlockedText = t(pc === 1 ? '{count} new item is not sent yet. Send or remove it before printing the bill.' : '{count} new items are not sent yet. Send or remove them before printing the bill.', {count:pc});
      v.bYesStyle = 'flex:2; ' + bigBtn(pc === 0, '#2563EB', '#FFFFFF');
      const titles = {
        confirm: [t('Print the bill for Table {id}?', {id:tid}), t("Check the items with the customer. Cancelled items are not on the bill.")],
        method: [t("How is the customer paying?"), t('Table {id} · {total}', {id:tid,total:v.billTotal})],
        account: [t('Cash: which account?'), t('Table {id} · {total} · each account has its own bill printer', {id:tid,total:v.billTotal})],
        review: [t("Check and print"), t('Table {id} · {total}', {id:tid,total:v.billTotal})],
        failed: [t("The bill did not print"), t('Table {id} · nothing was charged', {id:tid})],
        printed: [t("Bill printed"), t('Table {id} · {total}', {id:tid,total:v.billTotal})]
      };
      v.modalTitle = titles[st][0]; v.modalSub = titles[st][1];
      v.isCard = b.method === 'Card';
      const acc = b.method === 'Card' ? 'A' : (b.account || '');
      v.billMethod = b.method ? t(b.method) : ''; v.billAccount = acc ? t('Account {account}', {account:acc}) : '';
      v.billAccStyle = acc === 'B' ? 'color:#6B21A8' : 'color:#1E40AF';
      v.billPrinter = acc ? t(b.backup ? 'Printer {account} (backup)' : 'Printer {account}', {account:acc}) : '';
      v.billMethodLine = t('{method} · Account {account}', {method:v.billMethod,account:acc});
      v.billNo = t('Bill #{number}', {number:s.billNo}); v.billWaiter = t('Waiter: {name}', {name:w.name});
      const dd = new Date(now);
      v.billDate = String(dd.getDate()).padStart(2, '0') + '.' + String(dd.getMonth() + 1).padStart(2, '0') + '.' + dd.getFullYear() + ' ' + hm(now);
      v.printedText = t(b.printed > 1 ? 'Printed on {printer} · printed {count} times, still one payment.' : 'Printed on {printer}.', {printer:v.billPrinter,count:b.printed});
      v.failText = t('Printer {account} is not responding. The bill did not print and no payment was recorded. The order is safe.', {account:acc});
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
    const toast = s.toast;
    v.hasToast = !!toast; v.toastText = toast ? toast.msg : '';
    const tc = toast && toast.kind === 'err' ? 'background:#DC2626; color:#FFFFFF' : (toast && toast.kind === 'warn' ? 'background:#FDE047; color:#1A1400' : 'background:#0F172A; color:#FFFFFF');
    v.toastStyle = 'position:fixed; left:50%; bottom:28px; transform:translateX(-50%); max-width:min(720px, calc(100vw - 32px)); padding:16px 24px; border-radius:16px; font-size:18px; font-weight:800; line-height:1.35; z-index:80; box-shadow:0 18px 40px rgba(15,23,42,0.3); ' + tc;

    return v;
  }
  render() {
    if (this.state.screen === 'transferCorrection') return React.createElement(ArraComponents.TransferCorrection, { language: this.state.language, onBack: () => this.switchWaiter() });
    const adminScreens = { operationalReports: ArraComponents.OperationalReports, financialVisibility: ArraComponents.FinancialVisibility, orderHistory: ArraComponents.OrderHistory, adminSentCorrections: ArraComponents.AdminSentCorrections, employeeConfig: ArraComponents.EmployeeConfig, menuConfig: ArraComponents.MenuConfig, tableConfig: ArraComponents.TableConfig };
    const AdminPage = adminScreens[this.state.screen];
    const adminIdentityGeneration = this._identityGeneration || 0;
    if ((this.state.screen === 'admin' || AdminPage) && this.state.adminAccess) return React.createElement(ArraComponents.AdminShell, {
      screen: this.state.screen, user: this.state.waiter?.name, language: this.state.language, directOwner: true,
      navigate: screen => { if (screen !== this.state.screen && ['tableConfig', 'menuConfig', 'employeeConfig', 'adminSentCorrections'].includes(this.state.screen) && this._configEditor && (this._configEditor.state.busy || !this._configEditor.leaveEditor())) return; this.setState({ screen }); },
      back: () => { if (['tableConfig', 'menuConfig', 'employeeConfig', 'adminSentCorrections'].includes(this.state.screen) && this._configEditor && (this._configEditor.state.busy || !this._configEditor.leaveEditor())) return; this.signOut(); },
      switchUser: () => { if (['tableConfig', 'menuConfig', 'employeeConfig', 'adminSentCorrections'].includes(this.state.screen) && this._configEditor && (this._configEditor.state.busy || !this._configEditor.leaveEditor())) return; this.signOut(); }
    }, AdminPage ? React.createElement(AdminPage, { ref: ['tableConfig', 'menuConfig', 'employeeConfig', 'adminSentCorrections'].includes(this.state.screen) ? instance => { this._configEditor = instance; } : undefined, language: this.state.language, onBack: () => this.setState({ screen: 'admin' }), onAccessChanged: () => this.refreshAdminAccess(adminIdentityGeneration) }) : (desktopBridge ? React.createElement(React.Fragment, null, React.createElement(ArraComponents.LanguageSetting, { language: this.state.language || 'en', busy: this.state.languageBusy, feedback: this.state.languageFeedback, onChange: language => this.changeLanguage(language) }), React.createElement(TestPrintJobs, { key: adminIdentityGeneration, language: this.state.language })) : null));
    const v = this.renderVals();
    const t = v.t;
    return React.createElement(React.Fragment, null, (desktopBridge && this.state.modal?.type === 'desktopBill' ? React.createElement(DesktopBill, { language: this.state.language, orderId: this.state.orders[this.state.tableId]?.id, onClose: () => this.setState({ modal: null }), onPaid: () => this.switchWaiter() }) : null), "\n", React.createElement("div", {"style": style("height: 100vh; min-height: 820px; display: flex; flex-direction: column; background: #F4F6FB; color: #0F172A; font-family: 'Figtree', system-ui, sans-serif; overflow: hidden")} , "\n\n", "\n", (v.isLogin ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"style": style("flex: 1; display: flex; flex-wrap: wrap; min-height: 0; overflow: auto")} , "\n  ", React.createElement("div", {"style": style("flex: 1 1 420px; background: #F97316; color: #1A0B00; padding: 56px; display: flex; flex-direction: column; justify-content: space-between; gap: 40px; box-sizing: border-box")} , "\n    ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 12px")} , "\n      ", React.createElement("div", {"style": style("width: 52px; height: 52px; border-radius: 16px; background: #1A0B00; color: #F97316; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 28px")} , "A"), "\n      ", React.createElement("div", {"style": style("font-weight: 800; font-size: 22px")} , "Arra POS"), "\n    "), "\n    ", React.createElement("div", {} , "\n      ", React.createElement("div", {"style": style("font-size: 104px; font-weight: 800; line-height: 0.9; letter-spacing: -0.04em")} , "Arra"), "\n      ", React.createElement("div", {"style": style("font-size: 26px; font-weight: 700; margin-top: 20px; max-width: 460px; line-height: 1.3")} , t("Paper order in. Kitchen and bar tickets out. Bill printed. Done.")), "\n    "), "\n    ", React.createElement("div", {"style": style("font-size: 16px; font-weight: 700")} , t("Tetovo · Main PC")), "\n  "), "\n  ", React.createElement("div", {"style": style("flex: 1 1 420px; display: flex; align-items: center; justify-content: center; padding: 48px 24px; box-sizing: border-box; background: #FFFFFF")} , "\n    ", React.createElement("div", {"style": style("width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 22px")} , "\n      ", React.createElement("h1", {"style": style("margin: 0; font-size: 34px; font-weight: 800")} , t("Restaurant sign in")), "\n      ", React.createElement("p", {"style": style("margin: 0; font-size: 18px; color: #475569; line-height: 1.45")} , t("Do this once at the start of the day. Waiters pick their own name on the next screen.")), "\n      ", React.createElement("label", {"style": style("display: flex; flex-direction: column; gap: 8px; font-size: 16px; font-weight: 700")} , t('Username'), React.createElement("input", {"type": "text", "value": v.user, "onChange": v.onUser, "autoComplete": "username", "style": style("height: 60px; border-radius: 14px; border: 2px solid #CBD5E1; padding: 0 18px; font-size: 20px; font-weight: 600; color: #0F172A; background: #FFFFFF")}), "\n      "), "\n      ", React.createElement("label", {"style": style("display: flex; flex-direction: column; gap: 8px; font-size: 16px; font-weight: 700")} , t('Password'), React.createElement("input", {"type": "password", "value": v.pass, "onChange": v.onPass, "autoComplete": "current-password", "style": style("height: 60px; border-radius: 14px; border: 2px solid #CBD5E1; padding: 0 18px; font-size: 20px; font-weight: 600; color: #0F172A; background: #FFFFFF")}), "\n      "), "\n      ", React.createElement("button", {"onClick": v.login, "style": style("height: 68px; border-radius: 16px; border: none; background: #2563EB; color: #FFFFFF; font-size: 22px; font-weight: 800; box-shadow: 0 10px 24px rgba(37, 99, 235, 0.3)")} , t("Sign in")), "\n    "), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.isWaiters ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"style": style("flex: 1; overflow: auto; padding: 32px 24px 48px; box-sizing: border-box")} , "\n  ", React.createElement("div", {"style": style("max-width: 1000px; margin: 0 auto; display: flex; flex-direction: column; gap: 32px")} , "\n    ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 12px")} , "\n      ", React.createElement("div", {"style": style("width: 44px; height: 44px; border-radius: 14px; background: #F97316; color: #1A0B00; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 24px")} , "A"), "\n      ", React.createElement("div", {"style": style("font-weight: 800; font-size: 20px; flex: 1")} , "Arra POS"), "\n      ", React.createElement("button", {"onClick": v.signOut, "disabled": this.state.switching, "style": style("height: 48px; padding: 0 18px; border-radius: 12px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #334155; font-size: 16px; font-weight: 700")} , t("Sign out restaurant")), "\n    "), "\n    ", React.createElement("div", {"style": style("text-align: center; display: flex; flex-direction: column; gap: 10px")} , "\n      ", React.createElement("h1", {"style": style("margin: 0; font-size: 44px; font-weight: 800; letter-spacing: -0.02em")} , t("Who is using the PC?")), (this.state.handoffNotice ? React.createElement("p", {"role": "status", "style": style("padding: 16px; border-radius: 12px; background: #FEF3C7; color: #78350F; font-size: 18px; font-weight: 700")}, this.state.handoffNotice) : null), "\n      ", React.createElement("p", {"style": style("margin: 0; font-size: 20px; color: #475569")} , desktopBridge ? (this.state.waiterMessage || t('Choose your name.')) : t('Demo waiter selection only.')), "\n    "), "\n    ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 18px")} , "\n      ", (v.waiters || []).map((w, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n        ", React.createElement("button", {"onClick": w.pick, "disabled": this.state.switching, "style": style("min-height: 190px; border-radius: 24px; border: 2px solid #E2E8F0; background: #FFFFFF; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 20px; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06)")} , "\n          ", React.createElement("div", {"style": style(w.avStyle)} , w.initial), "\n          ", React.createElement("div", {"style": style("font-size: 26px; font-weight: 800; color: #0F172A")} , w.name), "\n          ", (w.hasPin ? React.createElement(React.Fragment, null, "\n            ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: #475569")} , "\n              ", React.createElement("svg", {"width": "16", "height": "16", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("rect", {"x": "5", "y": "11", "width": "14", "height": "10", "rx": "2"}), React.createElement("path", {"d": "M8 11V7a4 4 0 0 1 8 0v4"})), "\n              PIN\n            "), "\n          ") : null), "\n          ", (w.noPin ? React.createElement(React.Fragment, null, "\n            ", React.createElement("div", {"style": style("font-size: 14px; font-weight: 700; color: #475569")} , t("No PIN")), "\n          ") : null), "\n        "), "\n      "))), "\n    "), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.isPin ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"style": style("flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; padding: 32px 24px; box-sizing: border-box")} , "\n  ", React.createElement("div", {"style": style("width: 100%; max-width: 420px; background: #FFFFFF; border-radius: 28px; padding: 32px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 22px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.1)")} , "\n    ", React.createElement("div", {"style": style(v.pinAv)} , v.pinInitial), "\n    ", React.createElement("div", {"style": style("text-align: center")} , "\n      ", React.createElement("div", {"style": style("font-size: 28px; font-weight: 800")} , t('Hi {name}', {name: v.pinName})), "\n      ", React.createElement("div", {"style": style("font-size: 17px; color: #475569; margin-top: 4px")} , t(this.state.pinFor?.isTransfer ? "Enter your 6-digit PIN" : "Enter your 4-digit PIN")), "\n    "), "\n    ", React.createElement("div", {"style": style("display: flex; gap: 18px"), "aria-hidden": "true"} , "\n      ", (v.pinDots || []).map((d, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, React.createElement("div", {"style": style(d.style)})))), "\n    "), "\n    ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; width: 100%")} , "\n      ", (v.keys || []).map((k, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n        ", React.createElement("button", {"onClick": k.press, "aria-label": k.aria, "style": style(k.style)} , k.label), "\n      "))), "\n    "), "\n    ", React.createElement("div", {"style": style("font-size: 14px; color: #475569; font-weight: 600")} , desktopBridge ? '' : t('Demo: any 4 digits work')), "\n    ", React.createElement("button", {"onClick": v.pinBack, "style": style("height: 48px; padding: 0 18px; border-radius: 12px; border: none; background: transparent; color: #1D4ED8; font-size: 17px; font-weight: 700")} , t("Not you? Pick another name")), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.isApp ? React.createElement(React.Fragment, null, "\n", React.createElement("header", {"style": style("min-height: 72px; flex: none; display: flex; align-items: center; gap: 14px; padding: 10px 20px; box-sizing: border-box; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-wrap: wrap")} , "\n  ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px")} , "\n    ", React.createElement("div", {"style": style("width: 42px; height: 42px; border-radius: 13px; background: #F97316; color: #1A0B00; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px")} , "A"), "\n    ", React.createElement("div", {"style": style("font-weight: 800; font-size: 20px")} , "Arra"), "\n  "), "\n  ", React.createElement("div", {"style": style("flex: 1")}), "\n  ", React.createElement("div", {"style": style("font-size: 20px; font-weight: 800; color: #334155; padding: 0 6px")} , v.clock), "\n  ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px; padding: 4px 4px 4px 4px; border-radius: 999px; background: #F1F5F9")} , "\n    ", React.createElement("div", {"style": style(v.waiterAv)} , v.waiterInitial), "\n    ", React.createElement("div", {"style": style("font-size: 17px; font-weight: 800; padding-right: 4px")} , v.waiterName), "\n    ", React.createElement("button", {"onClick": v.switchWaiter, "style": style("height: 44px; padding: 0 16px; border-radius: 999px; border: none; background: #0F172A; color: #FFFFFF; font-size: 15px; font-weight: 800")} , t("Switch waiter")), "\n  "), "\n"), "\n\n", (desktopBridge ? React.createElement(PrintJobs, { language: this.state.language, revision: this.state.printRevision || 0, tokens: this._printRetryTokens }) : null), (v.hasFailed ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"role": "alert", "style": style("flex: none; background: #DC2626; color: #FFFFFF; padding: 12px 20px; display: flex; flex-direction: column; gap: 10px")} , "\n  ", (v.failed || []).map((f, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n    ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 14px; flex-wrap: wrap")} , "\n      ", React.createElement("svg", {"width": "26", "height": "26", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.4", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M6 9V3h12v6"}), React.createElement("rect", {"x": "6", "y": "14", "width": "12", "height": "7"}), React.createElement("path", {"d": "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"})), "\n      ", React.createElement("div", {"style": style("flex: 1 1 320px; font-size: 18px; font-weight: 700; line-height: 1.3")} , f.text), "\n      ", React.createElement("span", {"style": style("font-size: 14px; font-weight: 700")} , f.attempts), "\n      ", React.createElement("button", {"onClick": f.retry, "style": style("height: 48px; padding: 0 20px; border-radius: 12px; border: none; background: #FFFFFF; color: #B91C1C; font-size: 17px; font-weight: 800")} , t("Retry")), "\n      ", React.createElement("button", {"onClick": f.backup, "style": style("height: 48px; padding: 0 20px; border-radius: 12px; border: 2px solid #FFFFFF; background: transparent; color: #FFFFFF; font-size: 17px; font-weight: 800")} , t("Print on backup printer")), "\n    "), "\n  "))), "\n"), "\n") : null), "\n\n", "\n", (v.isTables ? renderTables.call(this, v, style) : null), "\n\n", "\n", (v.isOrder ? renderOrder.call(this, v, style) : null), "\n\n", "\n", (v.isHistory ? React.createElement(React.Fragment, null, "\n", React.createElement("main", {"style": style("flex: 1; min-height: 0; overflow: auto; padding: 24px; box-sizing: border-box")} , "\n  ", React.createElement("div", {"style": style("max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px")} , "\n    ", React.createElement("div", {} , "\n      ", React.createElement("h1", {"style": style("margin: 0; font-size: 34px; font-weight: 800")} , t("Today's bills")), "\n      ", React.createElement("p", {"style": style("margin: 6px 0 0; font-size: 17px; color: #475569; max-width: 760px; line-height: 1.45")} , t("Every closed table, paid once. If a bill went to the wrong account, the owner moves it later from the admin side. That never creates a second payment.")), "\n    "), "\n    ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px")} , "\n      ", React.createElement("div", {"style": style("background: #FFFFFF; border-radius: 20px; padding: 20px; border: 1px solid #E2E8F0")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #475569")} , t("Bills closed")), "\n        ", React.createElement("div", {"style": style("font-size: 36px; font-weight: 800; margin-top: 6px")} , v.hCount), "\n      "), "\n      ", React.createElement("div", {"style": style("background: #EAF1FF; border-radius: 20px; padding: 20px")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #1E40AF")} , t("Cash · Account A")), "\n        ", React.createElement("div", {"style": style("font-size: 32px; font-weight: 800; margin-top: 6px")} , v.hCashA), "\n      "), "\n      ", React.createElement("div", {"style": style("background: #F3E8FF; border-radius: 20px; padding: 20px")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #6B21A8")} , t("Cash · Account B")), "\n        ", React.createElement("div", {"style": style("font-size: 32px; font-weight: 800; margin-top: 6px")} , v.hCashB), "\n      "), "\n      ", React.createElement("div", {"style": style("background: #DCFCE7; border-radius: 20px; padding: 20px")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #166534")} , t("Card · Account A")), "\n        ", React.createElement("div", {"style": style("font-size: 32px; font-weight: 800; margin-top: 6px")} , v.hCardA), "\n      "), "\n    "), "\n    ", React.createElement("div", {"style": style("background: #FFFFFF; border-radius: 20px; border: 1px solid #E2E8F0; overflow-x: auto")} , "\n      ", React.createElement("div", {"style": style("min-width: 820px")} , "\n        ", React.createElement("div", {"style": style("display: grid; grid-template-columns: 90px 110px 90px 120px 80px 110px 130px 1fr; gap: 12px; padding: 14px 20px; font-size: 13px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #E2E8F0")} , "\n          ", React.createElement("span", {} , t("Bill")), React.createElement("span", {} , t("Table")), React.createElement("span", {} , t("Closed")), React.createElement("span", {} , t("Waiter")), React.createElement("span", {} , t("Items")), React.createElement("span", {} , t("Payment")), React.createElement("span", {} , t("Account")), React.createElement("span", {"style": style("text-align: right")} , t("Total")), "\n        "), "\n        ", (v.hist || []).map((h, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("display: grid; grid-template-columns: 90px 110px 90px 120px 80px 110px 130px 1fr; gap: 12px; padding: 14px 20px; align-items: center; font-size: 17px; font-weight: 700; border-bottom: 1px solid #F1F5F9")} , "\n            ", React.createElement("span", {"style": style("color: #475569")} , h.no), "\n            ", React.createElement("span", {"style": style("font-weight: 800")} , h.table), "\n            ", React.createElement("span", {} , h.time), "\n            ", React.createElement("span", {} , h.waiter), "\n            ", React.createElement("span", {} , h.items), "\n            ", React.createElement("span", {} , h.method), "\n            ", React.createElement("span", {} , React.createElement("span", {"style": style(h.accStyle)} , h.account)), "\n            ", React.createElement("span", {"style": style("text-align: right; font-weight: 800")} , h.total), "\n          "), "\n        "))), "\n      "), "\n    "), "\n  "), "\n"), "\n") : null), "\n") : null), "\n\n", "\n", (v.hasModal ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"style": style("position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; z-index: 50")} , "\n  ", React.createElement("div", {"role": "dialog", "aria-modal": "true", "aria-label": v.modalTitle, "style": style(v.modalCardStyle)} , "\n\n    ", React.createElement("div", {"style": style("display: flex; align-items: flex-start; gap: 12px")} , "\n      ", React.createElement("div", {"style": style("flex: 1; min-width: 0")} , "\n        ", React.createElement("div", {"style": style("font-size: 28px; font-weight: 800; line-height: 1.15")} , v.modalTitle), "\n        ", React.createElement("div", {"style": style("font-size: 17px; font-weight: 600; color: #475569; margin-top: 4px; line-height: 1.4")} , v.modalSub), "\n      "), "\n      ", React.createElement("button", {"onClick": v.closeModal, "aria-label": t("Close"), "style": style("width: 52px; height: 52px; flex: none; border-radius: 14px; border: none; background: #F1F5F9; color: #0F172A; display: flex; align-items: center; justify-content: center")} , React.createElement("svg", {"width": "24", "height": "24", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.6", "strokeLinecap": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M18 6L6 18M6 6l12 12"}))), "\n    "), "\n\n    ", "\n    ", (v.isMods ? React.createElement(React.Fragment, null, "\n      ", (v.modGroups || []).map((g, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n        ", React.createElement("div", {"style": style("display: flex; flex-direction: column; gap: 10px")} , "\n          ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px")} , "\n            ", React.createElement("span", {"style": style("font-size: 19px; font-weight: 800")} , g.label), "\n            ", React.createElement("span", {"style": style(g.reqStyle)} , g.reqLabel), "\n          "), "\n          ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px")} , "\n            ", (g.options || []).map((o, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n              ", React.createElement("button", {"onClick": o.pick, "disabled": o.disabled, "aria-pressed": o.pressed, "style": style(o.style)} , "\n                ", React.createElement("span", {"style": style("font-size: 18px; font-weight: 800")} , o.label), "\n                ", React.createElement("span", {"style": style("font-size: 14px; font-weight: 700")} , o.price), "\n              "), "\n            "))), "\n          "), "\n        "), "\n      "))), "\n      ", React.createElement("button", {"onClick": v.modAdd, "disabled": v.modAddDisabled, "style": style(v.modAddStyle)} , v.modAddLabel), "\n    ") : null), "\n\n    ", "\n    ", (v.isNote ? React.createElement(React.Fragment, null, "\n      ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px")} , "\n        ", (v.noteChips || []).map((nc, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n          ", React.createElement("button", {"onClick": nc.toggle, "disabled": v.noteSaving, "aria-pressed": nc.pressed, "style": style(nc.style)} , nc.label), "\n        "))), "\n      "), "\n      ", React.createElement("label", {"style": style("display: flex; flex-direction: column; gap: 8px; font-size: 16px; font-weight: 800")} , t('Or type the note'), React.createElement("input", {"type": "text", "value": v.noteText, "onChange": v.onNoteText, "disabled": v.noteSaving, "placeholder": t("e.g. medium rare, no onions"), "style": style("height: 60px; border-radius: 14px; border: 2px solid #CBD5E1; padding: 0 18px; font-size: 19px; font-weight: 600; color: #0F172A")}), "\n      "), "\n      ", React.createElement("div", {"style": style("display: flex; gap: 10px")} , "\n        ", React.createElement("button", {"onClick": v.closeModal, "style": style("flex: 1; height: 64px; border-radius: 16px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; font-size: 19px; font-weight: 800")} , t("Back")), "\n        ", React.createElement("button", {"onClick": v.saveNote, "disabled": v.noteSaving, "style": style("flex: 2; height: 64px; border-radius: 16px; border: none; background: #2563EB; color: #FFFFFF; font-size: 20px; font-weight: 800")} , t("Save note")), "\n      "), "\n    ") : null), "\n\n    ", "\n    ", (v.isCancel ? React.createElement(ArraComponents.SentItemCorrection, { v, modal: this.state.modal }) : null), "\n\n", "\n    ", (v.isMoveTable ? renderMoveTable.call(this, v, style) : null), "\n\n    ", "\n    ", renderBill.call(this, v, style), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.hasToast ? React.createElement(React.Fragment, null, "\n  ", React.createElement("div", {"role": "status", "style": style(v.toastStyle)} , v.toastText), "\n") : null), "\n\n"), "\n");
  }
}
