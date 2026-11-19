const fs = require('node:fs');
const path = require('node:path');
const { isCommissioned } = require('./pf700-commissioning');
const { isS096TrainingDirectory } = require('./s096-training-directory');

// Frozen identities and names from the owner's Arra menu. The second number in
// each ID is the original product index, even after the alcohol sections merged.
const drinks = new Map([
  ['10-0', 'Ujë pa Gaz 0.75 l', 0],
  ['10-1', 'Ujë pa Gaz 0.25 l', 0],
  ['10-2', 'Ujë me Gaz 0.25 l', 0],
  ['10-3', 'Coca-Cola Classic', 1],
  ['10-4', 'Coca-Cola Zero', 1],
  ['10-5', 'Schweppes Bitter Lemon', 1],
  ['10-6', 'Schweppes Zero', 1],
  ['10-7', 'Schweppes Tonic', 1],
  ['10-8', 'Schweppes Grapefruit', 1],
  ['10-9', 'Fanta Orange', 1],
  ['10-10', 'Fanta Shokata', 1],
  ['10-11', 'Sprite', 0],
  ['10-12', 'Ice Tea', 0],
  ['10-13', 'Lëng Mollë', 0],
  ['10-14', 'Lëng Portokall', 0],
  ['10-15', 'Lëng Pjeshkë', 0],
  ['10-16', 'Lëng Fruta Mali', 0],
  ['10-20', 'Red Bull', 0],
  ['11-0', 'Espresso', 1],
  ['11-1', 'Macchiato', 1],
  ['11-2', 'Macchiato e Madhe', 1],
  ['11-3', 'Cappuccino', 1],
  ['11-4', 'Nescafé', 1],
  ['11-5', 'Çaj me Mjaltë', 1],
  ['12-0', 'Heineken', 0],
  ['12-1', 'Peja', 0],
  ['13-0', 'Muskat Temjanika e bardhë 0.20 l', 1],
  ['13-1', 'Muskat Temjanika e bardhë 0.70 l', 1],
  ['13-2', 'Alexandria Cuvée e bardhë 0.20 l', 1],
  ['13-3', 'Alexandria Cuvée e bardhë 0.70 l', 1],
  ['13-4', 'Cabernet Sauvignon e kuqe 0.20 l', 0],
  ['13-5', 'Cabernet Sauvignon e kuqe 0.70 l', 0],
  ['13-6', 'Alexandria Cuvée Rosé 0.20 l', 1],
  ['13-7', 'Alexandria Cuvée Rosé 0.70 l', 1],
  ['14-0', 'Raki Rrushi Bovin', 1],
  ['14-1', 'Raki Ftoi Akov', 1],
  ['15-0', 'Chivas Regal', 0],
  ['15-1', "Jack Daniel's", 0],
  ['15-2', 'Hennessy', 0],
  ['15-3', 'Jägermeister', 0],
].map(([index, name, domestic]) => ['arra-product-' + index, { name, domestic }]));

function menuName(name) {
  return name.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function confirmedOrigin(product) {
  if (product.rootId === 'arra-food') {
    if (product.destination === 'kitchen' || product.destination === 'kitchen2') return 1;
    return undefined;
  }
  // Version 52 could adopt an already configured generic fresh juice under a
  // local ID. The old fruit-specific products describe different items.
  const name = menuName(product.name);
  if (name === 'leng i shtrydhur') return 1;

  const drink = drinks.get(product.id);
  if (drink && name === menuName(drink.name)) return drink.domestic;
  return undefined;
}

function applyArraOrigins(db) {
  const roots = db.prepare(`SELECT count(*) AS n FROM menu_categories
    WHERE parent_id IS NULL AND id IN ('arra-food','arra-drinks')`).get();
  if (roots.n !== 2) return;

  const products = db.prepare(`SELECT p.id, p.name, p.destination, root.id AS rootId
    FROM menu_products p JOIN menu_categories c ON c.id=p.category_id
    JOIN menu_categories root ON root.id=COALESCE(c.parent_id,c.id)
    WHERE root.parent_id IS NULL AND root.id IN ('arra-food','arra-drinks')`).all();
  const save = db.prepare(`INSERT INTO menu_product_fiscal_origin(product_id,domestic) VALUES(?,?)
    ON CONFLICT(product_id) DO UPDATE SET domestic=excluded.domestic WHERE domestic<>excluded.domestic`);
  for (const product of products) {
    const domestic = confirmedOrigin(product);
    if (domestic !== undefined) save.run(product.id, domestic);
  }
}

function migrateArraOrigins(db) {
  const { file } = db.prepare("SELECT file FROM pragma_database_list WHERE name='main'").get();
  const directory = path.dirname(file);
  if (isS096TrainingDirectory(directory) && fs.existsSync(path.join(directory, 'SAMPLE-DATA-ONLY')) &&
      fs.existsSync(path.join(directory, 'S096-TRAINING-READY')) && !isCommissioned(db)) return;
  applyArraOrigins(db);
}

module.exports = { applyArraOrigins, migrateArraOrigins };
