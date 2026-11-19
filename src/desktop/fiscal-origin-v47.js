// Existing items retain unknown origin; classification is never inferred.
function migrateFiscalOrigin(db) {
  db.exec(`CREATE TABLE menu_product_fiscal_origin (
    product_id TEXT PRIMARY KEY REFERENCES menu_products(id) ON DELETE CASCADE,
    domestic INTEGER NOT NULL CHECK(domestic IN (0,1))
  ) STRICT;
  CREATE TABLE order_item_fiscal_origin (
    item_id INTEGER PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
    domestic INTEGER NOT NULL CHECK(domestic IN (0,1))
  ) STRICT;
  CREATE TRIGGER order_item_snapshot_fiscal_origin AFTER INSERT ON order_items BEGIN
    INSERT INTO order_item_fiscal_origin(item_id,domestic)
      SELECT NEW.id,domestic FROM menu_product_fiscal_origin WHERE product_id=NEW.product_id;
  END;
  CREATE TRIGGER order_item_origin_no_update BEFORE UPDATE ON order_item_fiscal_origin
    BEGIN SELECT RAISE(ABORT,'Order item origin is frozen'); END;
  CREATE TRIGGER order_item_origin_no_replace BEFORE INSERT ON order_item_fiscal_origin
    WHEN EXISTS(SELECT 1 FROM order_item_fiscal_origin WHERE item_id=NEW.item_id)
      OR EXISTS(SELECT 1 FROM order_items i JOIN bills b ON b.order_id=i.order_id
        JOIN fiscal_checkout_sales s ON s.bill_id=b.id WHERE i.id=NEW.item_id)
    BEGIN SELECT RAISE(ABORT,'Order item origin is frozen'); END;
  CREATE TRIGGER order_item_origin_no_delete BEFORE DELETE ON order_item_fiscal_origin
    WHEN EXISTS(SELECT 1 FROM order_items WHERE id=OLD.item_id)
    BEGIN SELECT RAISE(ABORT,'Order item origin is frozen'); END;`);
}
module.exports = { migrateFiscalOrigin };
