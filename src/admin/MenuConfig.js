import { configText, configError } from './config-i18n.js';
import { accessNotice } from './shared.js';

export class MenuConfig extends React.Component {
  constructor(props) {
    super(props);
    this.state = { categories: [], products: [], groups: [], options: [], access: null, error: '', notice: '', editor: null, busy: false, query: '', expandedCategories: {}, expandedProducts: {}, selectedId: null };
  }
  t(text) { return configText(this.props.language, text); }
  componentDidMount() { this.load(); }
  async load() {
    try {
      const r = await window.arra.menuConfig({ action: 'list' });
      if (r.ok) { this.setState({ ...r.data, access: true }); return r.data; }
      this.setState({ error: configError(this.props.language, r.error, 'Menu unavailable.'), access: false });
    } catch (_) { this.setState({ error: this.t('Could not load the menu.'), access: false }); }
    return false;
  }
  leaveEditor() {
    return !this.state.editor || JSON.stringify(this.state.editor) === this.state.original || window.confirm(this.t('Discard unsaved changes?'));
  }
  changeContext(action) {
    if (this.state.busy) return;
    if (!this.leaveEditor()) return;
    this.setState({ editor: null, error: '' }, action);
  }
  edit(kind, item, parentId) {
    if (!this.leaveEditor()) return;
    const defaults = {
      category: { name: '', parentId: parentId || null, sortOrder: String(this.state.categories.length), active: true },
      product: { name: '', categoryId: parentId || '', price: '0', sortOrder: String(this.state.products.length), destination: 'kitchen', active: true },
      group: { name: '', productId: parentId || '', required: false, active: true },
      option: { name: '', groupId: parentId || '', adjustment: '0', active: true }
    };
    const editor = { kind, isSubcategory: kind === 'category' && !!(item ? item.parentId : parentId), id: item ? item.id : null, ...defaults[kind], ...(item || {}), active: item ? !!item.active : true, ...(kind === 'group' && item ? { required: !!item.required } : {}) };
    this.setState({ editor, original: JSON.stringify(editor), error: '', errorField: null, notice: '' });
  }
  reveal(editor, data, before, certain) {
    if (!data) return;
    const collection = { category: 'categories', product: 'products', group: 'groups', option: 'options' }[editor.kind];
    let item = editor.id && data[collection].find(x => x.id === editor.id);
    if (!item && certain && !editor.id) {
      const old = new Set(before[collection].map(x => x.id));
      const added = data[collection].filter(x => !old.has(x.id));
      if (added.length === 1) item = added[0];
    }
    const group = editor.kind === 'option' ? data.groups.find(g => g.id === editor.groupId) : editor.kind === 'group' ? item || editor : null;
    const product = editor.kind === 'product' ? item : group && data.products.find(p => p.id === group.productId);
    const categoryId = editor.kind === 'category' ? (item?.id || editor.parentId) : product?.categoryId || (editor.kind === 'product' ? editor.categoryId : null);
    const category = data.categories.find(c => c.id === categoryId);
    const expandedCategories = { ...this.state.expandedCategories };
    if (categoryId) expandedCategories[categoryId] = true;
    if (category?.parentId) expandedCategories[category.parentId] = true;
    this.setState({ query: '', expandedCategories, expandedProducts: { ...this.state.expandedProducts, ...(product ? { [product.id]: true } : {}) }, selectedId: item?.id || null });
  }
  async reconcile(editor, before) {
    const loaded = await this.load();
    if (loaded) this.reveal(editor, loaded, before, false);
    const message = this.t('The save could not be confirmed and may have succeeded. Check the refreshed menu before making the change again.');
    this.setState(loaded ? { busy: false, editor: null, notice: message, error: '' } : { busy: false, editor: null, error: this.t('The save could not be confirmed and the menu could not be refreshed. Reopen the menu and check it before making the change again.') });
  }
  async save() {
    if (this.state.busy || !this.state.editor) return;
    const e = this.state.editor, name = e.name.trim();
    const before = { categories: this.state.categories, products: this.state.products, groups: this.state.groups, options: this.state.options };
    if (!name || name.length > 100) { this.setState({ errorField: 'name', error: this.t('Enter a name of 1 to 100 characters.') }); return; }
    const whole = value => String(value).trim() !== '' && Number.isSafeInteger(Number(value));
    if ((e.kind === 'category' || e.kind === 'product') && (!whole(e.sortOrder) || Number(e.sortOrder) < 0)) { this.setState({ errorField: 'sortOrder', error: this.t('Display order must be a non-negative whole number.') }); return; }
    if (e.kind === 'category' && e.isSubcategory && !e.parentId) { this.setState({ errorField: 'parentId', error: this.t('Choose a parent category.') }); return; }
    if (e.kind === 'product' && (!e.categoryId || !whole(e.price) || Number(e.price) < 0)) { this.setState({ errorField: !e.categoryId ? 'categoryId' : 'price', error: this.t('Choose a category and enter a non-negative whole price.') }); return; }
    if (e.kind === 'option' && !whole(e.adjustment)) { this.setState({ errorField: 'adjustment', error: this.t('Price adjustment must be a whole number.') }); return; }
    const request = { action: e.kind, id: e.id, name, active: e.active };
    if (e.kind === 'category') Object.assign(request, { parentId: e.parentId || null, sortOrder: Number(e.sortOrder) });
    if (e.kind === 'product') Object.assign(request, { categoryId: e.categoryId, price: Number(e.price), sortOrder: Number(e.sortOrder), destination: e.destination });
    if (e.kind === 'group') Object.assign(request, { productId: e.productId, required: e.required });
    if (e.kind === 'option') Object.assign(request, { groupId: e.groupId, adjustment: Number(e.adjustment) });
    this.setState({ busy: true, error: '', notice: '' });
    try {
      const r = await window.arra.menuConfig(request);
      if (!r.ok) {
        if (!r.error || r.error === 'Configuration unavailable') { await this.reconcile(e, before); return; }
        this.setState({ error: configError(this.props.language, r.error, 'Could not save configuration.'), busy: false }); return;
      }
      const loaded = await this.load();
      if (loaded) this.reveal(e, loaded, before, true);
      this.setState({ busy: false, editor: null, ...(loaded ? { notice: this.t(e.kind[0].toUpperCase() + e.kind.slice(1) + ' saved.') } : { error: this.t('The change was saved, but the menu could not be refreshed. Reopen the menu to see it.') }) });
    } catch (_) { await this.reconcile(e, before); }
  }
  render() {
    const h = React.createElement, s = this.state;
    if (s.access !== true) return accessNotice({ title: this.t('Menu management'), loading: s.access === null && this.t('Loading menu…'), error: s.error, guidance: this.t(' Check your access or sign in and select your own name.'), onBack: this.props.onBack, language: this.props.language });
    const e = s.editor;
    const update = patch => this.setState({ editor: { ...this.state.editor, ...patch }, error: '', errorField: null });
    const field = (label, key, props = {}) => h('label', { className: 'floor-field' }, h('span', null, label), h('input', { ...props, disabled: s.busy, 'aria-invalid': s.errorField === key || undefined, 'aria-describedby': s.errorField === key ? 'menu-editor-error' : undefined, value: e[key], onChange: event => update({ [key]: event.target.value }) }));
    const select = (label, key, choices, empty) => h('label', { className: 'floor-field' }, h('span', null, label), h('select', { disabled: s.busy, 'aria-invalid': s.errorField === key || undefined, 'aria-describedby': s.errorField === key ? 'menu-editor-error' : undefined, value: e[key] || '', onChange: event => update({ [key]: event.target.value || null }) }, empty && h('option', { value: '' }, empty), ...choices.map(x => h('option', { key: x.id, value: x.id }, x.name + (x.active === false || x.active === 0 ? this.t(' (inactive)') : '')))));
    const toggle = (label, key) => h('label', { className: 'floor-toggle' }, h('input', { type: 'checkbox', disabled: s.busy, checked: !!e[key], onChange: event => update({ [key]: event.target.checked }) }), ' ' + label);
    const badge = active => h('span', { className: active ? 'floor-badge' : 'floor-badge floor-badge-muted' }, active ? this.t('Active') : this.t('Inactive'));
    const button = (label, action, aria) => h('button', { type: 'button', disabled: s.busy, onClick: action, ...(aria ? { 'aria-label': aria } : {}) }, label);
    const products = category => s.products.filter(p => p.categoryId === category.id && p.name.toLocaleLowerCase().includes(s.query.trim().toLocaleLowerCase())).map(p => h('li', { key: p.id, className: 'menu-product' + (s.selectedId === p.id ? ' menu-selected' : '') }, h('details', { open: !!s.expandedProducts[p.id], onToggle: event => { const open = event.currentTarget.open; if (!!this.state.expandedProducts[p.id] !== open) this.setState({ expandedProducts: { ...this.state.expandedProducts, [p.id]: open } }); } }, h('summary', { className: 'menu-product-summary' }, h('strong', null, p.name), h('span', null, this.t('Price ') + p.price + ' · ' + (p.destination === 'bar' ? this.t('Bar') : this.t('Kitchen'))), badge(p.active), (!category.active || (category.parentId && !s.categories.find(c => c.id === category.parentId)?.active)) && h('span', { className: 'floor-badge floor-badge-muted' }, this.t('Hidden by category'))),
      h('div', { className: 'menu-row' }, h('div', null, h('strong', null, p.name), h('span', { className: 'floor-table-detail' }, this.t('Price ') + p.price + ' · ' + (p.destination === 'bar' ? this.t('Bar') : this.t('Kitchen')) + this.t(' · Order ') + p.sortOrder)), badge(p.active), button(this.t('Edit'), () => this.edit('product', p), this.t('Edit product ') + p.name)),
      h('div', { className: 'menu-modifiers' }, h('div', { className: 'menu-row' }, h('strong', null, this.t('Choices')), button(this.t('+ Add group'), () => this.edit('group', null, p.id), this.t('Add modifier group to ') + p.name)),
        !s.groups.some(g => g.productId === p.id) && h('p', { className: 'floor-empty' }, this.t('No modifier groups.')),
        ...s.groups.filter(g => g.productId === p.id).map(g => h('div', { key: g.id, className: 'menu-group' + (s.selectedId === g.id ? ' menu-selected' : '') }, h('div', { className: 'menu-row' }, h('div', null, h('strong', null, g.name), h('span', { className: 'floor-table-detail' }, g.required ? this.t('Required · Choose one') : this.t('Optional · Choose up to one'))), badge(g.active), button(this.t('Edit'), () => this.edit('group', g), this.t('Edit group ') + g.name + this.t(' for ') + p.name)),
          h('ul', { className: 'menu-options' }, ...s.options.filter(o => o.groupId === g.id).map(o => h('li', { key: o.id, className: 'menu-row' + (s.selectedId === o.id ? ' menu-selected' : '') }, h('span', null, o.name + ' · ' + (o.adjustment >= 0 ? '+' : '') + o.adjustment), badge(o.active), button(this.t('Edit'), () => this.edit('option', o), this.t('Edit option ') + o.name + this.t(' in ') + g.name)))),
          !s.options.some(o => o.groupId === g.id) && h('p', { className: 'floor-empty' }, this.t('No options yet.')), button(this.t('+ Add option'), () => this.edit('option', null, g.id), this.t('Add option to ') + g.name)))))));
    const category = (c, child = false) => h('article', { key: c.id, className: 'floor-area' + (child ? ' menu-subcategory' : '') + (s.selectedId === c.id ? ' menu-selected' : '') },
      h('details', { open: !!s.query || !!s.expandedCategories[c.id], onToggle: event => { const open = event.currentTarget.open; if (!s.query && !!this.state.expandedCategories[c.id] !== open) this.setState({ expandedCategories: { ...this.state.expandedCategories, [c.id]: open } }); } }, h('summary', { className: 'menu-category-summary' }, h('strong', null, c.name), badge(c.active), c.parentId && !s.categories.find(x => x.id === c.parentId)?.active && h('span', { className: 'floor-badge floor-badge-muted' }, this.t('Hidden by parent')), h('span', null, this.t('Products') + ': ' + s.products.filter(p => p.categoryId === c.id).length)), h('div', { className: 'floor-area-head' }, h('div', null, h('h3', null, c.name), h('p', null, (child ? this.t('Subcategory') : this.t('Category')) + this.t(' · Order ') + c.sortOrder)), badge(c.active), button(this.t('Edit'), () => this.edit('category', c), this.t('Edit category ') + c.name), !child && button(this.t('+ Subcategory'), () => this.edit('category', null, c.id), this.t('Add subcategory to ') + c.name), button(this.t('+ Product'), () => this.edit('product', null, c.id), this.t('Add product to ') + c.name)),
      h('ul', { className: 'menu-products' }, ...products(c)), !s.products.some(p => p.categoryId === c.id) && h('p', { className: 'menu-empty' }, this.t('No products in this category.')),
      !child && s.categories.filter(x => x.parentId === c.id && (!s.query || s.products.some(p => p.categoryId === x.id && p.name.toLocaleLowerCase().includes(s.query.trim().toLocaleLowerCase())))).map(x => category(x, true))));
    return h('main', { className: 'floor-page' }, button(this.t('← Back to administration'), () => this.changeContext(this.props.onBack)),
      h('div', { className: 'floor-hero' }, h('div', null, h('p', { className: 'floor-kicker' }, this.t('ADMINISTRATION / MENU')), h('h1', null, this.t('Menu management')), h('p', null, this.t('Organize categories, products and the choices offered to guests.'))), button(this.t('+ Add category'), () => this.edit('category', null))),
      h('p', { className: 'admin-access-note' }, this.t('Changes here affect the whole restaurant and are recorded under your account.')),
      h('div', { className: 'floor-note' }, h('strong', null, this.t('Menu visibility and choices')), h('p', null, this.t('Inactive categories hide their products and subcategories. Display order uses lower numbers first. Each modifier group permits at most one choice; a required group needs one active option. Existing order snapshots stay unchanged.'))),
      s.notice && h('p', { role: 'status', className: 'floor-success' }, s.notice), s.error && !e && h('p', { role: 'alert' }, s.error),
      e && h('section', { className: 'floor-editor', 'aria-label': this.t(e.isSubcategory ? 'subcategory' : e.kind) + this.t(' details') }, h('div', { className: 'floor-section-head' }, h('div', null, h('p', { className: 'floor-kicker' }, this.t('MENU DETAILS')), h('h2', null, (e.id ? this.t('Edit ') : this.t('New ')) + this.t(e.isSubcategory ? 'subcategory' : e.kind))), button(this.t('Cancel'), () => this.changeContext(() => {}))),
        h('form', { noValidate: true, onSubmit: event => { event.preventDefault(); this.save(); } }, s.error && h('p', { id: 'menu-editor-error', role: 'alert' }, s.error), h('div', { className: 'floor-fields' },
          field(this.t('Name'), 'name', { type: 'text', maxLength: 100, autoFocus: true }),
          e.kind === 'category' && e.id && h('label', { className: 'floor-field' }, h('span', null, this.t('Category level')), h('select', { disabled: s.busy, value: e.isSubcategory ? 'sub' : 'top', onChange: event => update({ isSubcategory: event.target.value === 'sub', parentId: null }) }, h('option', { value: 'top' }, this.t('Top-level category')), h('option', { value: 'sub', disabled: s.categories.some(c => c.parentId === e.id) }, this.t('Subcategory'))), h('span', { className: 'floor-help' }, this.t('Choose a level to move this category. A category with subcategories must remain top-level.'))),
          e.kind === 'category' && e.isSubcategory && select(this.t('Parent category'), 'parentId', s.categories.filter(c => c.id !== e.id && !c.parentId), this.t('Choose a category')),
          e.kind === 'product' && select(this.t('Category'), 'categoryId', s.categories, this.t('Choose a category')),
          e.kind === 'product' && select(this.t('Preparation destination'), 'destination', [{ id: 'kitchen', name: this.t('Kitchen') }, { id: 'bar', name: this.t('Bar') }]),
          e.kind === 'product' && field(this.t('Price'), 'price', { type: 'number', min: 0, step: 1 }),
          (e.kind === 'category' || e.kind === 'product') && field(this.t('Display order'), 'sortOrder', { type: 'number', min: 0, step: 1 }),
          e.kind === 'option' && field(this.t('Price adjustment'), 'adjustment', { type: 'number', step: 1 })),
          e.kind === 'group' && h('p', { className: 'floor-help' }, this.t('Product: ') + (s.products.find(p => p.id === e.productId)?.name || this.t('Unavailable'))),
          e.kind === 'option' && h('p', { className: 'floor-help' }, this.t('Group: ') + (s.groups.find(g => g.id === e.groupId)?.name || this.t('Unavailable')) + this.t('. Use a negative value for a reduction.')),
          h('p', { className: 'floor-help' }, e.kind === 'category' ? this.t('Inactive categories hide their products and subcategories. Lower display order appears first.') : e.kind === 'product' ? this.t('Price is the base price. Inactive products cannot be ordered. Lower display order appears first.') : e.kind === 'group' ? this.t('A required group needs one active option. Inactive groups are hidden from ordering.') : this.t('The adjustment is added to the product price. Inactive options are hidden from ordering.')),
          e.kind === 'group' && toggle(this.t('Required choice'), 'required'), toggle(this.t('Active'), 'active'),
          h('div', { className: 'floor-actions' }, h('button', { type: 'submit', className: 'floor-primary', disabled: s.busy }, s.busy ? this.t('Saving…') : this.t('Save ') + this.t(e.isSubcategory ? 'subcategory' : e.kind))))),
      h('section', { className: 'floor-list', 'aria-labelledby': 'menu-heading' }, h('div', { className: 'floor-section-head' }, h('div', null, h('p', { className: 'floor-kicker' }, this.t('YOUR MENU')), h('h2', { id: 'menu-heading' }, this.t('Categories and products'))), button(this.t('+ Add category'), () => this.edit('category', null))),
        h('label', { className: 'floor-field menu-search' }, h('span', null, this.t('Find products by name')), h('input', { type: 'search', value: s.query, disabled: s.busy, onChange: event => this.setState({ query: event.target.value }) })),
        !s.categories.length && h('p', { className: 'floor-empty' }, this.t('No categories yet. Add a category to start your menu.')), s.query && !s.products.some(p => p.name.toLocaleLowerCase().includes(s.query.trim().toLocaleLowerCase())) && h('p', { className: 'floor-empty' }, this.t('No products match your search.')), ...s.categories.filter(c => !c.parentId && (!s.query || s.products.some(p => (p.categoryId === c.id || s.categories.some(x => x.parentId === c.id && x.id === p.categoryId)) && p.name.toLocaleLowerCase().includes(s.query.trim().toLocaleLowerCase())))).map(c => category(c))));
  }
}
