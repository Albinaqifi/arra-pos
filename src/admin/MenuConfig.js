import { configText, configError } from './config-i18n.js';
import { accessNotice } from './shared.js';

export class MenuConfig extends React.Component {
  constructor(props) {
    super(props);
    this.state = { categories: [], products: [], groups: [], options: [], access: null, error: '', notice: '', editor: null, busy: false };
  }
  t(text) { return configText(this.props.language, text); }
  componentDidMount() { this.load(); }
  async load() {
    try {
      const r = await window.arra.menuConfig({ action: 'list' });
      if (r.ok) { this.setState({ ...r.data, access: true }); return true; }
      this.setState({ error: configError(this.props.language, r.error, 'Menu unavailable.'), access: false });
    } catch (_) { this.setState({ error: this.t('Could not load the menu.'), access: false }); }
    return false;
  }
  edit(kind, item, parentId) {
    const defaults = {
      category: { name: '', parentId: parentId || null, sortOrder: String(this.state.categories.length), active: true },
      product: { name: '', categoryId: parentId || '', price: '0', sortOrder: String(this.state.products.length), destination: 'kitchen', active: true },
      group: { name: '', productId: parentId || '', required: false, active: true },
      option: { name: '', groupId: parentId || '', adjustment: '0', active: true }
    };
    this.setState({ editor: { kind, id: item ? item.id : null, ...defaults[kind], ...(item || {}), active: item ? !!item.active : true, ...(kind === 'group' && item ? { required: !!item.required } : {}) }, error: '', notice: '' });
  }
  async reconcile() {
    const loaded = await this.load();
    const message = this.t('The save could not be confirmed and may have succeeded. Check the refreshed menu before making the change again.');
    this.setState(loaded ? { busy: false, editor: null, notice: message, error: '' } : { busy: false, editor: null, error: this.t('The save could not be confirmed and the menu could not be refreshed. Reopen the menu and check it before making the change again.') });
  }
  async save() {
    if (this.state.busy || !this.state.editor) return;
    const e = this.state.editor, name = e.name.trim();
    if (!name || name.length > 100) { this.setState({ error: this.t('Enter a name of 1 to 100 characters.') }); return; }
    const whole = value => String(value).trim() !== '' && Number.isSafeInteger(Number(value));
    if ((e.kind === 'category' || e.kind === 'product') && (!whole(e.sortOrder) || Number(e.sortOrder) < 0)) { this.setState({ error: this.t('Display order must be a non-negative whole number.') }); return; }
    if (e.kind === 'product' && (!e.categoryId || !whole(e.price) || Number(e.price) < 0)) { this.setState({ error: this.t('Choose a category and enter a non-negative whole price.') }); return; }
    if (e.kind === 'option' && !whole(e.adjustment)) { this.setState({ error: this.t('Price adjustment must be a whole number.') }); return; }
    const request = { action: e.kind, id: e.id, name, active: e.active };
    if (e.kind === 'category') Object.assign(request, { parentId: e.parentId || null, sortOrder: Number(e.sortOrder) });
    if (e.kind === 'product') Object.assign(request, { categoryId: e.categoryId, price: Number(e.price), sortOrder: Number(e.sortOrder), destination: e.destination });
    if (e.kind === 'group') Object.assign(request, { productId: e.productId, required: e.required });
    if (e.kind === 'option') Object.assign(request, { groupId: e.groupId, adjustment: Number(e.adjustment) });
    this.setState({ busy: true, error: '', notice: '' });
    try {
      const r = await window.arra.menuConfig(request);
      if (!r.ok) {
        if (!r.error || r.error === 'Configuration unavailable') { await this.reconcile(); return; }
        this.setState({ error: configError(this.props.language, r.error, 'Could not save configuration.'), busy: false }); return;
      }
      const loaded = await this.load();
      this.setState({ busy: false, editor: null, ...(loaded ? { notice: this.t(e.kind[0].toUpperCase() + e.kind.slice(1) + ' saved.') } : { error: this.t('The change was saved, but the menu could not be refreshed. Reopen the menu to see it.') }) });
    } catch (_) { await this.reconcile(); }
  }
  render() {
    const h = React.createElement, s = this.state;
    if (s.access !== true) return accessNotice({ title: this.t('Menu management'), loading: s.access === null && this.t('Loading menu…'), error: s.error, guidance: this.t(' Check your access or sign in and select your own name.'), onBack: this.props.onBack, language: this.props.language });
    const e = s.editor;
    const update = patch => this.setState({ editor: { ...this.state.editor, ...patch }, error: '' });
    const field = (label, key, props = {}) => h('label', { className: 'floor-field' }, h('span', null, label), h('input', { ...props, disabled: s.busy, value: e[key], onChange: event => update({ [key]: event.target.value }) }));
    const select = (label, key, choices, empty) => h('label', { className: 'floor-field' }, h('span', null, label), h('select', { disabled: s.busy, value: e[key] || '', onChange: event => update({ [key]: event.target.value || null }) }, empty && h('option', { value: '' }, empty), ...choices.map(x => h('option', { key: x.id, value: x.id }, x.name + (x.active === false || x.active === 0 ? this.t(' (inactive)') : '')))));
    const toggle = (label, key) => h('label', { className: 'floor-toggle' }, h('input', { type: 'checkbox', disabled: s.busy, checked: !!e[key], onChange: event => update({ [key]: event.target.checked }) }), ' ' + label);
    const badge = active => h('span', { className: active ? 'floor-badge' : 'floor-badge floor-badge-muted' }, active ? this.t('Active') : this.t('Inactive'));
    const button = (label, action, aria) => h('button', { type: 'button', disabled: s.busy, onClick: action, ...(aria ? { 'aria-label': aria } : {}) }, label);
    const products = category => s.products.filter(p => p.categoryId === category.id).map(p => h('li', { key: p.id, className: 'menu-product' },
      h('div', { className: 'menu-row' }, h('div', null, h('strong', null, p.name), h('span', { className: 'floor-table-detail' }, this.t('Price ') + p.price + ' · ' + (p.destination === 'bar' ? this.t('Bar') : this.t('Kitchen')) + this.t(' · Order ') + p.sortOrder)), badge(p.active), button(this.t('Edit'), () => this.edit('product', p), this.t('Edit product ') + p.name)),
      h('div', { className: 'menu-modifiers' }, h('div', { className: 'menu-row' }, h('strong', null, this.t('Choices')), button(this.t('+ Add group'), () => this.edit('group', null, p.id), this.t('Add modifier group to ') + p.name)),
        !s.groups.some(g => g.productId === p.id) && h('p', { className: 'floor-empty' }, this.t('No modifier groups.')),
        ...s.groups.filter(g => g.productId === p.id).map(g => h('div', { key: g.id, className: 'menu-group' }, h('div', { className: 'menu-row' }, h('div', null, h('strong', null, g.name), h('span', { className: 'floor-table-detail' }, g.required ? this.t('Required · Choose one') : this.t('Optional · Choose up to one'))), badge(g.active), button(this.t('Edit'), () => this.edit('group', g), this.t('Edit group ') + g.name + this.t(' for ') + p.name)),
          h('ul', { className: 'menu-options' }, ...s.options.filter(o => o.groupId === g.id).map(o => h('li', { key: o.id, className: 'menu-row' }, h('span', null, o.name + ' · ' + (o.adjustment >= 0 ? '+' : '') + o.adjustment), badge(o.active), button(this.t('Edit'), () => this.edit('option', o), this.t('Edit option ') + o.name + this.t(' in ') + g.name)))),
          !s.options.some(o => o.groupId === g.id) && h('p', { className: 'floor-empty' }, this.t('No options yet.')), button(this.t('+ Add option'), () => this.edit('option', null, g.id), this.t('Add option to ') + g.name))))));
    const category = (c, child = false) => h('article', { key: c.id, className: 'floor-area' + (child ? ' menu-subcategory' : '') },
      h('div', { className: 'floor-area-head' }, h('div', null, h('h3', null, c.name), h('p', null, (child ? this.t('Subcategory') : this.t('Category')) + this.t(' · Order ') + c.sortOrder)), badge(c.active), button(this.t('Edit'), () => this.edit('category', c), this.t('Edit category ') + c.name), !child && button(this.t('+ Subcategory'), () => this.edit('category', null, c.id), this.t('Add subcategory to ') + c.name), button(this.t('+ Product'), () => this.edit('product', null, c.id), this.t('Add product to ') + c.name)),
      h('ul', { className: 'menu-products' }, ...products(c)), !s.products.some(p => p.categoryId === c.id) && h('p', { className: 'menu-empty' }, this.t('No products in this category.')),
      !child && s.categories.filter(x => x.parentId === c.id).map(x => category(x, true)));
    return h('main', { className: 'floor-page' }, button(this.t('← Back to administration'), this.props.onBack),
      h('p', { className: 'admin-eyebrow floor-eyebrow' }, this.t('ADMINISTRATION / MENU')), h('h1', null, this.t('Menu management')), h('p', { className: 'admin-intro' }, this.t('Organize categories, products and the choices offered to guests.')),
      h('p', { className: 'admin-access-note' }, this.t('Changes here affect the whole restaurant and are recorded under your account.')),
      h('div', { className: 'floor-note' }, h('strong', null, this.t('Menu visibility and choices')), h('p', null, this.t('Inactive categories hide their products and subcategories. Display order uses lower numbers first. Each modifier group permits at most one choice; a required group needs one active option. Existing order snapshots stay unchanged.'))),
      s.notice && h('p', { role: 'status', className: 'floor-success' }, s.notice), s.error && h('p', { role: 'alert' }, s.error),
      e && h('section', { className: 'floor-editor', 'aria-label': this.t(e.kind) + this.t(' details') }, h('div', { className: 'floor-section-head' }, h('div', null, h('p', { className: 'floor-kicker' }, this.t('MENU DETAILS')), h('h2', null, (e.id ? this.t('Edit ') : this.t('New ')) + this.t(e.kind))), button(this.t('Cancel'), () => this.setState({ editor: null, error: '' }))),
        h('form', { noValidate: true, onSubmit: event => { event.preventDefault(); this.save(); } }, h('div', { className: 'floor-fields' },
          field(this.t('Name'), 'name', { type: 'text', maxLength: 100, autoFocus: true }),
          e.kind === 'category' && select(this.t('Parent category'), 'parentId', s.categories.filter(c => c.id !== e.id && !c.parentId && (!e.id || !s.categories.some(x => x.parentId === e.id))), this.t('None (top-level category)')),
          e.kind === 'product' && select(this.t('Category'), 'categoryId', s.categories, this.t('Choose a category')),
          e.kind === 'product' && select(this.t('Preparation destination'), 'destination', [{ id: 'kitchen', name: this.t('Kitchen') }, { id: 'bar', name: this.t('Bar') }]),
          e.kind === 'product' && field(this.t('Price'), 'price', { type: 'number', min: 0, step: 1 }),
          (e.kind === 'category' || e.kind === 'product') && field(this.t('Display order'), 'sortOrder', { type: 'number', min: 0, step: 1 }),
          e.kind === 'option' && field(this.t('Price adjustment'), 'adjustment', { type: 'number', step: 1 })),
          e.kind === 'group' && h('p', { className: 'floor-help' }, this.t('Product: ') + (s.products.find(p => p.id === e.productId)?.name || this.t('Unavailable'))),
          e.kind === 'option' && h('p', { className: 'floor-help' }, this.t('Group: ') + (s.groups.find(g => g.id === e.groupId)?.name || this.t('Unavailable')) + this.t('. Use a negative value for a reduction.')),
          e.kind === 'group' && toggle(this.t('Required choice'), 'required'), toggle(this.t('Active'), 'active'),
          h('div', { className: 'floor-actions' }, h('button', { type: 'submit', className: 'floor-primary', disabled: s.busy }, s.busy ? this.t('Saving…') : this.t('Save ') + this.t(e.kind))))),
      h('section', { className: 'floor-list', 'aria-labelledby': 'menu-heading' }, h('div', { className: 'floor-section-head' }, h('div', null, h('p', { className: 'floor-kicker' }, this.t('YOUR MENU')), h('h2', { id: 'menu-heading' }, this.t('Categories and products'))), button(this.t('+ Add category'), () => this.edit('category', null))),
        !s.categories.length && h('p', { className: 'floor-empty' }, this.t('No categories yet. Add a category to start your menu.')), ...s.categories.filter(c => !c.parentId).map(c => category(c))));
  }
}
