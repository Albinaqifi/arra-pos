import { waiterTranslate } from '../shared/waiter-ui.js';

export function catalogView(s, { language, pendingItems = [], addProduct, chooseCategory, chooseSubcategory, setSearch, clearSearch }) {
  const M = s, v = {};
  const t = (key, values) => waiterTranslate(language, 'waiter.' + key, values);
  v.t = t;
  const money = value => Math.round(value).toLocaleString('en-US') + ' den';
  const cat = M.catById[s.cat] || { subs: [] };
  const q = s.search.trim().toLowerCase();
  v.cats = M.cats.map(c => {
    const on = c.id === s.cat && !q;
    return {
      label: c.label, pressed: String(on),
      style: 'min-height:96px; width:100%; border-radius:18px; font-size:19px; font-weight:800; padding:8px; ' + (on ? 'background:' + c.color + '; color:#FFFFFF; border:2px solid ' + c.color + '; box-shadow:0 8px 18px rgba(15,23,42,0.15)' : 'background:' + c.tint + '; color:' + c.color + '; border:2px solid transparent'),
      pick: () => chooseCategory(c.id)
    };
  });
  v.search = s.search; v.hasSearch = q.length > 0;
  v.onSearch = e => setSearch(e.target.value);
  v.clearSearch = clearSearch;
  v.subs = cat.subs.map(([id, l]) => {
    const on = id === s.sub && !q;
    return {
      label: l, pressed: String(on),
      style: 'height:50px; padding:0 20px; border-radius:999px; font-size:17px; font-weight:800; white-space:nowrap; ' + (on ? 'background:#0F172A; color:#FFFFFF; border:2px solid #0F172A' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1'),
      pick: () => chooseSubcategory(id)
    };
  });
  const pendQ = {};
  pendingItems.forEach(i => { pendQ[i.pid] = (pendQ[i.pid] || 0) + i.qty; });
  const list = q ? M.products.filter(p => p.name.toLowerCase().includes(q)) : M.products.filter(p => p.sub === s.sub);
  v.searchInfo = t(list.length === 1 ? '{count} match in the whole menu' : '{count} matches in the whole menu', {count: list.length});
  v.products = list.map(p => {
    const c = M.catById[p.cat]; const b = pendQ[p.id] || 0;
    return {
      name: p.name, price: money(p.price), hasOpts: p.groups.length > 0, hasBadge: b > 0, badge: String(b),
      aria: t(p.groups.length ? 'Add {name}, {price}, has options' : 'Add {name}, {price}', {name:p.name, price:money(p.price)}),
      style: 'position:relative; min-height:116px; border-radius:18px; padding:14px; display:flex; flex-direction:column; justify-content:space-between; align-items:flex-start; gap:10px; text-align:left; background:' + c.tint + '; border:3px solid ' + (b > 0 ? c.color : '#94A3B8'),
      priceStyle: 'font-size:16px; font-weight:800; color:' + c.color,
      add: () => addProduct(p.id)
    };
  });
  v.noProducts = list.length === 0;
  v.menuMessage = s.menuLoad === 'loading' ? t("Loading menu…") : s.menuLoad === 'error' ?
    t("Menu unavailable. Restart the app and try again.") : t("No products available.");

  return v;
}
