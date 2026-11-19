const { seedFiscalTax } = require('./fiscal-tax-v44');
const { arraDestination } = require('./arra-menu-v52');

// The VAT catalog uses the original product IDs even when drinks share a menu category.
function drinksFromSection(section, products) {
 return products.map(([name, price], index) => [name, price, `arra-product-${section}-${index}`]);
}

// Menu transcribed from the supplied Arra menus; prices are whole denars.
const sections = [
 ['Sallata', [['Sallatë Arra',490],['Sallatë Caesar',390],['Sallatë Caprese',330],['Sallatë e Gjelbër',320],['Sallatë Greke',280],['Sallatë Panxhar',240],['Taratur',200],['Domate me Qepë',170]]],
 ['Antipasta', [['Bruschetta Mix',210],['Focaccia me vaj ulliri',120],['Focaccia me susam dhe kaçkavall',150],['Djathë Dhensh',350],['Djathë i Bardhë në Furrë',310],['Kaçkavall i Fërguar',290],['Perime Mesdhetare në Skarë',490],['Kërpudha',250],['Patëllxhan në Furrë',270],['Kungullesha Çips',230],['Spec i Mbushur',180],['Vitello Tonnato',550],['Dërrasë Mishrash & Djathërash',1600]]],
 ['Pasta', [['Biftek dhe Kërpudha',550],['Al Salmone',490],['Quattro Formaggi',440],['Tomato e Mozzarella',410],['Alfredo Chicken',380],['Carbonara',340],['Zarzavate',340],['Aglio, Olio e Peperoncino',270]]],
 ['Pizza', [['Margherita',230],['Funghi',250],['Prosciutto e Funghi',280],['Diavola',280],['Tonno',320],['Quattro Formaggi',390],['Rukola',370],['Vegetariane',330]]],
 ['Në Zgarë & Klasike', [['Mish në Furrë',2500],['Ribeye Black Angus',3300],['Tomahawk Viçi',1850],['Biftek Viçi',1650],['Fileto Viçi',950],['Porcion Mishrash Mikse',1250],['Fileto Salmoni',1150],['Cordon Bleu',650]]],
 ['Nga Kuzhina Shqiptare', [['Tavë Bifteku',900],['Muskul Viçi me Jufka Shtëpie',750],['Kofshë Pule me Jufka Shtëpie',550],['Qofte Shtëpie në Kajmak',650]]],
 ['Supa', [['Supë Viçi',190],['Supë Domatesh',170]]], ['Për Fëmijë', [['Gishtërinjë Pule',220],['Pizza për Fëmijë',180]]],
 ['Ëmbëlsira', [['Veri / Jug',250],['Bakllavë me Akullore',190],['Mollë në Avull',130]]],
 ['Shtesa', [['Spec Djegës',50],['Ullinj',50],['Sos me Piper të Gjelbër',100],['Sos me Kërpudha',100],['Sos Chimichurri',100],['Krem Gorgonzola',200]]],
 ['Pije Freskuese', [['Ujë pa Gaz 0.75 l',150],['Ujë pa Gaz 0.25 l',60],['Ujë me Gaz 0.25 l',60],['Coca-Cola Classic',100],['Coca-Cola Zero',100],['Schweppes Bitter Lemon',100],['Schweppes Zero',100],['Schweppes Tonic',100],['Schweppes Grapefruit',100],['Fanta Orange',100],['Fanta Shokata',100],['Sprite',100],['Ice Tea',120],['Lëng Mollë',120],['Lëng Portokall',120],['Lëng Pjeshkë',120],['Lëng Fruta Mali',120],['Leng I shtrydhur',180],['Red Bull',200,'arra-product-10-20']]],
 ['Kafe & Çaj', [['Espresso',70],['Macchiato',80],['Macchiato e Madhe',90],['Cappuccino',100],['Nescafé',100],['Çaj me Mjaltë',80]]],
 ['Alcoholic Drinks', [
   ...drinksFromSection(12, [['Heineken',180],['Peja',180]]),
   ...drinksFromSection(13, [['Muskat Temjanika e bardhë 0.20 l',420],['Muskat Temjanika e bardhë 0.70 l',1850],['Alexandria Cuvée e bardhë 0.20 l',360],['Alexandria Cuvée e bardhë 0.70 l',1400],['Cabernet Sauvignon e kuqe 0.20 l',420],['Cabernet Sauvignon e kuqe 0.70 l',1850],['Alexandria Cuvée Rosé 0.20 l',360],['Alexandria Cuvée Rosé 0.70 l',1400]]),
   ...drinksFromSection(14, [['Raki Rrushi Bovin',110],['Raki Ftoi Akov',200]]),
   ...drinksFromSection(15, [['Chivas Regal',320],["Jack Daniel's",300],['Hennessy',330],['Jägermeister',200]])
 ]]
];

const steaks = new Set(['Ribeye Black Angus', 'Tomahawk Viçi', 'Biftek Viçi']);
const doneness = ['doneness', 'Doneness', ['Rare', 'Medium rare', 'Medium', 'Medium well', 'Well done']];
const grillGroups = [
 ['group-0', 'Shoqëruesit', ['Zarzavate', 'Patate të pjekura', 'Patatina të ëmbla', 'Bagetë me hudhër', 'Pa shoqërues']],
 ['group-1', 'Sosërat', ['Pepe verde', 'Sos me kërpudha', 'Krem gorgonzola', 'Sos chimichurri', 'Pa sos']]
];

function seedArraMenu(db) {
 db.exec('BEGIN IMMEDIATE');
 try {
  const category = db.prepare('INSERT INTO menu_categories(id,name,active,parent_id,sort_order) VALUES(?,?,1,?,?)');
  const product = db.prepare('INSERT INTO menu_products(id,category_id,name,price,active,sort_order,destination) VALUES(?,?,?,?,1,?,?)');
  const group = db.prepare('INSERT INTO modifier_groups(id,product_id,name,required,active) VALUES(?,?,?,1,1)');
  const option = db.prepare('INSERT INTO modifier_options(id,group_id,name,adjustment,active) VALUES(?,?,?,0,1)');
  category.run('arra-food','Food',null,0);
  category.run('arra-drinks','Drinks',null,1);
  sections.forEach(([name,items], i) => {
   const categoryId = `arra-category-${i}`;
   const rootId = i >= 10 ? 'arra-drinks' : 'arra-food';
   category.run(categoryId,name,rootId,i >= 10 ? i - 10 : i);
   items.forEach(([label,price,originalId], j) => {
    const id = originalId ?? `arra-product-${i}-${j}`;
    product.run(id,categoryId,label,price,j,arraDestination(rootId,categoryId,id));
    seedFiscalTax(db, id);
    if (i === 2) {
      const groupId = `${id}-pasta`; group.run(groupId,id,'Lloji i pastës');
      ['Shpageti','Taljatele'].forEach((choice,k) => option.run(`${groupId}-${k}`,groupId,choice));
    }
    if (name === 'Në Zgarë & Klasike' && label !== 'Fileto Salmoni') {
      const groups = steaks.has(label) ? [doneness, ...grillGroups] : grillGroups;
      for (const [suffix, title, choices] of groups) {
        const groupId = `${id}-${suffix}`;
        group.run(groupId,id,title);
        choices.forEach((choice,k) => option.run(`${groupId}-option-${k}`,groupId,choice));
      }
    }
   });
  });
  db.exec('COMMIT');
 } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { sections, seedArraMenu };
