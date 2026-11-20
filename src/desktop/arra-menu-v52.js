const { upgradeArraMenu } = require('./upgrade-arra-menu');

// Stable menu IDs distinguish the specified dishes even if their labels are edited.
const kitchenOneProducts = new Set([
  ...Array.from({length: 8}, (_, i) => 'arra-product-0-' + i), // Original salad dishes
  ...Array.from({length: 8}, (_, i) => 'arra-product-3-' + i), // Original pizzas
  'arra-product-1-0',  // Bruschetta Mix
  'arra-product-1-1',  // Focaccia me vaj ulliri
  'arra-product-1-2',  // Focaccia me susam dhe kaçkavall
  'arra-product-1-3',  // Djathë Dhensh
  'arra-product-1-11', // Vitello Tonnato
  'arra-product-1-12', // Dërrasë Mishrash & Djathërash
  'arra-product-7-1',  // Pizza për Fëmijë
]);

function arraDestination(rootId, categoryId, productId) {
  if (rootId === 'arra-drinks') return 'bar';
  if (categoryId === 'arra-category-0' || categoryId === 'arra-category-3') return 'kitchen'; // Sallata and Pizza
  return kitchenOneProducts.has(productId) ? 'kitchen' : 'kitchen2';
}

function migrateArraMenu(db) {
  const roots = db.prepare("SELECT COUNT(*) AS n FROM menu_categories WHERE parent_id IS NULL AND id IN ('arra-food', 'arra-drinks')").get();
  if (roots.n !== 2) return;

  upgradeArraMenu(db);
  // Menu configuration supports a root and its direct subcategories. Include
  // custom products and sections in that menu, even when currently inactive.
  const products = db.prepare(`SELECT p.id, p.destination, c.id AS categoryId, COALESCE(c.parent_id, c.id) AS rootId
    FROM menu_products p JOIN menu_categories c ON c.id = p.category_id
    WHERE COALESCE(c.parent_id, c.id) IN ('arra-food', 'arra-drinks')`).all();
  const update = db.prepare('UPDATE menu_products SET destination = ? WHERE id = ?');
  for (const product of products) {
    const destination = arraDestination(product.rootId, product.categoryId, product.id);
    if (destination !== product.destination) update.run(destination, product.id);
  }
}

module.exports = { arraDestination, migrateArraMenu };
