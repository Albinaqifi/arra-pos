// Frozen S-077 seed identities and labels used by migration 52. The caller
// checks for the Arra roots and owns the migration transaction.
function upgradeGrill(db) {
  const grillItem = db.prepare(`SELECT 1 FROM menu_products p JOIN menu_categories c ON c.id=p.category_id
    WHERE p.id=? AND p.name=? AND p.active=1 AND c.id='arra-category-4' AND c.parent_id='arra-food' AND c.active=1`);
  const existingDoneness = db.prepare(`SELECT 1 FROM modifier_groups
    WHERE product_id=? AND (id=? OR name='Doneness' COLLATE NOCASE)`);
  // Both menu services display groups in rowid order. Prepend the new group
  // without replacing any existing row or changing its ID or relative order.
  const prepend = db.prepare(`INSERT INTO modifier_groups(rowid,id,product_id,name,required,active)
    SELECT min(0,COALESCE(min(rowid),0))-1,?,?,'Doneness',1,1 FROM modifier_groups`);
  const addChoice = db.prepare('INSERT INTO modifier_options(id,group_id,name,adjustment,active) VALUES(?,?,?,0,1)');
  for (const [index, name] of [[1,'Ribeye Black Angus'],[2,'Tomahawk Viçi'],[3,'Biftek Viçi']]) {
    const id = `arra-product-4-${index}`;
    const groupId = id + '-doneness';
    if (!grillItem.get(id, name) || existingDoneness.get(id, groupId)) continue;
    prepend.run(groupId, id);
    ['Rare','Medium rare','Medium','Medium well','Well done'].forEach((choice, i) =>
      addChoice.run(groupId + '-option-' + i, groupId, choice));
  }

  const salmon = 'arra-product-4-6';
  if (!grillItem.get(salmon, 'Fileto Salmoni')) return;
  const options = db.prepare('SELECT id,name,active,adjustment FROM modifier_options WHERE group_id=? ORDER BY id');
  const retire = db.prepare('UPDATE modifier_groups SET active=0 WHERE id=? AND product_id=? AND name=? AND required=1');
  for (const [i, groupName, choices] of [
    [0, 'Shoqëruesit', ['Zarzavate','Patate të pjekura','Patatina të ëmbla','Bagetë me hudhër','Pa shoqërues']],
    [1, 'Sosërat', ['Pepe verde','Sos me kërpudha','Krem gorgonzola','Sos chimichurri','Pa sos']]
  ]) {
    const groupId = salmon + '-group-' + i;
    const rows = options.all(groupId);
    if (rows.length === choices.length && rows.every((row, j) => row.id === groupId + '-option-' + j &&
        row.name === choices[j] && row.active === 1 && row.adjustment === 0)) {
      retire.run(groupId, salmon, groupName);
    }
  }
}

function upgradeJuices(db) {
  const genericName = 'Leng I shtrydhur';
  const categoryId = 'arra-category-10';
  const existing = db.prepare(`SELECT id,active FROM menu_products WHERE category_id=? AND name=? COLLATE NOCASE
    ORDER BY active DESC,rowid LIMIT 1`).get(categoryId, genericName);
  // An explicitly retired generic is no substitute for the fruit still being sold.
  if (existing?.active === 0) return;
  const find = db.prepare(`SELECT p.id,p.price,p.sort_order,t.tax_group,o.domestic,
      EXISTS(SELECT 1 FROM modifier_groups WHERE product_id=p.id) AS hasModifiers
    FROM menu_products p JOIN menu_categories c ON p.category_id=c.id
    LEFT JOIN menu_product_fiscal_tax t ON t.product_id=p.id LEFT JOIN menu_product_fiscal_origin o ON o.product_id=p.id
    WHERE p.id=? AND p.name=? AND p.active=1 AND c.id=? AND c.active=1 AND c.parent_id='arra-drinks'`);
  const orangeId = 'arra-product-10-17';
  const juices = [[orangeId,'Lëng Natyral Portokall'],['arra-product-10-18','Lëng Natyral Mollë'],
    ['arra-product-10-19','Lëng Natyral Limon']].map(([id,name]) => find.get(id,name,categoryId)).filter(Boolean);
  if (!juices.length) return;
  const standard = juices.filter(row => row.price === 180 && row.tax_group === 'В' && !row.hasModifiers);
  const canonical = existing ?? standard.find(row => row.id === orangeId && row.domestic === null);
  if (!canonical) {
    // A generic juice can use different fruit. Keep the old fruit's fiscal
    // origin attached to its original identity and leave the new origin unset.
    const id = 'arra-fresh-juice';
    db.prepare(`INSERT INTO menu_products(id,category_id,name,price,active,sort_order,destination)
      VALUES(?,?,?,180,1,?,'bar')`).run(id, categoryId, genericName, juices[0].sort_order);
    db.prepare("INSERT INTO menu_product_fiscal_tax(product_id,tax_group) VALUES(?,'В')").run(id);
  } else if (!existing) {
    db.prepare('UPDATE menu_products SET name=? WHERE id=?').run(genericName, canonical.id);
  }
  const retire = db.prepare('UPDATE menu_products SET active=0 WHERE id=?');
  for (const row of standard) if (row.id !== canonical?.id) retire.run(row.id);
}

function groupAlcohol(db) {
  const sections = [[12,'Birrë',2],[13,'Verë',8],[14,'Raki',2],[15,'Pije të Forta',4]];
  const category = db.prepare("SELECT name,sort_order FROM menu_categories WHERE id=? AND active=1 AND parent_id='arra-drinks'");
  const target = db.prepare("SELECT id,active FROM menu_categories WHERE parent_id='arra-drinks' AND name='Alcoholic Drinks' ORDER BY rowid LIMIT 1").get();
  if (target && !target.active) return;
  let targetId = target?.id;
  const product = db.prepare('SELECT sort_order FROM menu_products WHERE id=? AND category_id=?');
  const move = db.prepare('UPDATE menu_products SET category_id=?,sort_order=? WHERE id=?');
  const retireEmpty = db.prepare(`UPDATE menu_categories SET active=0 WHERE id=? AND NOT EXISTS
    (SELECT 1 FROM menu_products WHERE category_id=menu_categories.id)`);
  let offset = 0;
  for (const [index, name, count] of sections) {
    const categoryId = 'arra-category-' + index;
    const source = category.get(categoryId);
    if (source?.name === name) {
      let moved = false;
      for (let i = 0; i < count; i++) {
        const id = `arra-product-${index}-${i}`;
        const row = product.get(id, categoryId);
        if (!row) continue;
        if (!targetId) {
          targetId = 'arra-category-alcohol';
          db.prepare(`INSERT INTO menu_categories(id,name,active,parent_id,sort_order)
            VALUES(?,'Alcoholic Drinks',1,'arra-drinks',?)`).run(targetId, source.sort_order);
        }
        move.run(targetId, row.sort_order === i ? offset + i : row.sort_order, id);
        moved = true;
      }
      if (moved) retireEmpty.run(categoryId);
    }
    offset += count;
  }
}

function upgradeArraMenu(db) {
  upgradeGrill(db);
  upgradeJuices(db);
  groupAlcohol(db);
}

module.exports = { upgradeArraMenu };
