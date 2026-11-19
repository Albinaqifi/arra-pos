// Frozen product IDs from the owner's approved dine-in menu. The counts are
// the original number of products in each numbered seed section.
const packagedSections = [
  [0, 8, 'В'], [1, 13, 'В'], [2, 8, 'В'], [3, 8, 'В'],
  [4, 8, 'В'], [5, 4, 'В'], [6, 2, 'В'], [7, 2, 'В'],
  [8, 3, 'В'], [9, 6, 'В'], [10, 21, 'В'], [11, 6, 'В'],
  [12, 2, 'А'], [13, 8, 'А'], [14, 2, 'А'], [15, 4, 'А'],
];
const seedTaxGroups = new Map(['qebapa', 'shopska', 'espresso', 'cola', 'baklava'].map(id => [id, 'В']));
for (const [section, count, group] of packagedSections) {
  for (let product = 0; product < count; product++) {
    seedTaxGroups.set(`arra-product-${section}-${product}`, group);
  }
}

function migrateFiscalTax(db) {
  db.exec(`CREATE TABLE menu_product_fiscal_tax (
    product_id TEXT PRIMARY KEY REFERENCES menu_products(id) ON DELETE CASCADE,
    tax_group TEXT NOT NULL CHECK(tax_group IN ('А','В'))
  ) STRICT;
  CREATE TABLE order_item_fiscal_tax (
    item_id INTEGER PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
    tax_group TEXT NOT NULL CHECK(tax_group IN ('А','В'))
  ) STRICT;
  CREATE TRIGGER order_item_snapshot_fiscal_tax AFTER INSERT ON order_items BEGIN
    INSERT INTO order_item_fiscal_tax(item_id,tax_group)
      SELECT NEW.id,tax_group FROM menu_product_fiscal_tax WHERE product_id=NEW.product_id;
  END;
  CREATE TRIGGER order_item_tax_no_update BEFORE UPDATE ON order_item_fiscal_tax
    BEGIN SELECT RAISE(ABORT,'Order item tax is frozen'); END;
  CREATE TRIGGER order_item_tax_no_replace BEFORE INSERT ON order_item_fiscal_tax
    WHEN EXISTS(SELECT 1 FROM order_item_fiscal_tax WHERE item_id=NEW.item_id)
      OR EXISTS(SELECT 1 FROM order_items i JOIN bills b ON b.order_id=i.order_id WHERE i.id=NEW.item_id)
    BEGIN SELECT RAISE(ABORT,'Order item tax is frozen'); END;
  CREATE TRIGGER order_item_tax_no_delete BEFORE DELETE ON order_item_fiscal_tax
    WHEN EXISTS(SELECT 1 FROM order_items WHERE id=OLD.item_id)
    BEGIN SELECT RAISE(ABORT,'Order item tax is frozen'); END;`);

  // Existing items and bills have no evidence of their tax group at entry.
  // For future orders only, initialize original, unedited seed identities.
  const populate = db.prepare(`INSERT INTO menu_product_fiscal_tax(product_id,tax_group)
    SELECT p.id,? FROM menu_products p WHERE p.id=? AND NOT EXISTS (
      SELECT 1 FROM application_audit a WHERE a.entity_type='product' AND a.entity_id=p.id
    )`);
  for (const [id, group] of seedTaxGroups) populate.run(group, id);
}

function seedFiscalTax(db, productId) {
  db.prepare('INSERT INTO menu_product_fiscal_tax(product_id,tax_group) VALUES(?,?)')
    .run(productId, seedTaxGroups.get(productId));
}

module.exports = { migrateFiscalTax, seedFiscalTax };
