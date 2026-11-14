import { FeatureState } from '../shared/FeatureState.js';
import { catalogView } from './catalog-view.js';

const emptyCatalog = () => ({ G: {}, cats: [], catById: {}, products: [], byId: {} });

export function normalizeCatalog(data) {
  const categories = data.categories;
  const cats = categories.filter(category => !category.parentId).map(category => {
    const children = categories.filter(child => child.parentId === category.id);
    const direct = data.products.some(product => product.categoryId === category.id);
    const subs = [...(direct || !children.length ? [[category.id, category.name]] : []), ...children.map(child => [child.id, child.name])];
    return { id: category.id, label: category.name, color: '#1D4ED8', tint: '#EAF1FF', route: category.id === 'drinks' ? 'bar' : 'kitchen', subs };
  });
  const catById = Object.fromEntries(cats.map(category => [category.id, category]));
  const categoryById = Object.fromEntries(categories.map(category => [category.id, category]));
  const groups = data.groups || [], options = data.options || [];
  const G = Object.fromEntries(groups.map(group => [group.id, { label: group.name, req: !!group.required, opts: options.filter(option => option.groupId === group.id).map(option => [option.name, option.adjustment, option.id]) }]));
  const products = data.products.map(product => {
    const cat = categoryById[product.categoryId].parentId || product.categoryId;
    return { id: product.id, name: product.name, price: product.price, cat, sub: product.categoryId, groups: groups.filter(group => group.productId === product.id).map(group => group.id), route: catById[cat].route };
  });
  return { G, cats, catById, products, byId: Object.fromEntries(products.map(product => [product.id, product])) };
}

export class CatalogModel extends FeatureState {
  constructor({ bridge, demoCatalog }) {
    const catalog = bridge ? emptyCatalog() : demoCatalog;
    super({ ...catalog, menuLoad: bridge ? 'loading' : 'ready', cat: bridge ? '' : 'food', sub: bridge ? '' : 'grill', search: '' });
    this.bridge = bridge;
    this.generation = 0;
  }
  clearProtectedData() {
    this.generation++;
    if (this.bridge) this._set({ ...emptyCatalog(), menuLoad: 'loading', cat: '', sub: '', search: '' });
  }
  async load() {
    if (!this.bridge || this.disposed) return;
    const generation = ++this.generation;
    this._set({ menuLoad: 'loading' });
    try {
      const result = await this.bridge.getMenu();
      if (this.disposed || generation !== this.generation) return;
      if (!result.ok) throw Error('Unavailable');
      const catalog = normalizeCatalog(result.data);
      this._set({ ...catalog, menuLoad: 'ready', cat: catalog.cats[0]?.id || '', sub: catalog.cats[0]?.subs[0]?.[0] || '' });
    } catch (_) {
      if (!this.disposed && generation === this.generation) this._set({ ...emptyCatalog(), menuLoad: 'error' });
    }
  }
  chooseCategory(id) {
    const category = this.state.catById[id];
    if (category) this._set({ cat: id, sub: category.subs[0]?.[0] || '', search: '' });
  }
  chooseSubcategory(sub) { this._set({ sub, search: '' }); }
  setSearch(search) { this._set({ search }); }
  clearSearch() { this._set({ search: '' }); }
  view(options) {
    return catalogView(this.state, { ...options, chooseCategory: id => this.chooseCategory(id), chooseSubcategory: id => this.chooseSubcategory(id), setSearch: value => this.setSearch(value), clearSearch: () => this.clearSearch() });
  }
}
