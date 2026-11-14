export function demoCatalog() {
  const G = {
    side: { label: 'Side', req: true, opts: [['Fries', 0], ['Rice', 0], ['Grilled vegetables', 40], ['Mashed potatoes', 0], ['No side', 0]] },
    cook: { label: 'Cooking', req: true, opts: [['Rare', 0], ['Medium rare', 0], ['Medium', 0], ['Well done', 0]] },
    portion: { label: 'Portion', req: true, opts: [['5 pieces', 0], ['10 pieces', 120]] },
    milk: { label: 'Milk', req: false, opts: [['Regular milk', 0], ['Lactose-free', 0], ['Oat milk', 30]] }
  };
  const cats = [
    { id: 'food', label: 'Food', color: '#C2410C', tint: '#FFF1E6', route: 'kitchen', subs: [['grill', 'Grill'], ['salads', 'Salads'], ['pizza', 'Pizza & pasta'], ['starters', 'Starters']] },
    { id: 'drinks', label: 'Drinks', color: '#1D4ED8', tint: '#EAF1FF', route: 'bar', subs: [['coffee', 'Coffee & tea'], ['soft', 'Soft drinks'], ['beer', 'Beer'], ['wine', 'Wine']] },
    { id: 'desserts', label: 'Desserts', color: '#BE185D', tint: '#FDECF4', route: 'kitchen', subs: [['cakes', 'Cakes'], ['cold', 'Ice cream & fruit']] }
  ];
  const P = [
    ['qebapa', 'grill', 'Qebapa', 220, ['portion', 'side']],
    ['pljesk', 'grill', 'Pljeskavica', 280, ['side']],
    ['steak', 'grill', 'Beef steak', 890, ['cook', 'side']],
    ['chicken', 'grill', 'Chicken fillet', 360, ['side']],
    ['mixed', 'grill', 'Mixed grill for 2', 1150, ['side']],
    ['sujuk', 'grill', 'Sujuk', 260, ['side']],
    ['shopska', 'salads', 'Shopska salad', 180, []],
    ['greek', 'salads', 'Greek salad', 220, []],
    ['caesar', 'salads', 'Caesar salad', 320, []],
    ['season', 'salads', 'Seasonal salad', 160, []],
    ['marg', 'pizza', 'Pizza Margherita', 320, []],
    ['capri', 'pizza', 'Pizza Capricciosa', 390, []],
    ['arrapz', 'pizza', 'Pizza Arra', 450, []],
    ['carbo', 'pizza', 'Pasta Carbonara', 380, []],
    ['bolo', 'pizza', 'Pasta Bolognese', 360, []],
    ['fries', 'starters', 'Fries', 120, []],
    ['ajvar', 'starters', 'Ajvar & white cheese', 220, []],
    ['soup', 'starters', 'Soup of the day', 150, []],
    ['peppers', 'starters', 'Grilled peppers', 160, []],
    ['bread', 'starters', 'Bread basket', 60, []],
    ['espresso', 'coffee', 'Espresso', 70, []],
    ['macch', 'coffee', 'Macchiato', 80, ['milk']],
    ['capp', 'coffee', 'Cappuccino', 100, ['milk']],
    ['turk', 'coffee', 'Turkish coffee', 70, []],
    ['tea', 'coffee', 'Tea', 70, []],
    ['cola', 'soft', 'Coca-Cola', 100, []],
    ['fanta', 'soft', 'Fanta', 100, []],
    ['water', 'soft', 'Still water', 60, []],
    ['spark', 'soft', 'Sparkling water', 80, []],
    ['orange', 'soft', 'Fresh orange juice', 150, []],
    ['lemon', 'soft', 'Lemonade', 140, []],
    ['skopsko', 'beer', 'Skopsko', 120, []],
    ['heineken', 'beer', 'Heineken', 150, []],
    ['dab', 'beer', 'Zlaten Dab', 120, []],
    ['red', 'wine', 'House red (glass)', 150, []],
    ['white', 'wine', 'House white (glass)', 150, []],
    ['vranec', 'wine', 'Vranec (bottle)', 1200, []],
    ['baklava', 'cakes', 'Baklava', 150, []],
    ['trilece', 'cakes', 'Trileçe', 180, []],
    ['choc', 'cakes', 'Chocolate cake', 190, []],
    ['icecream', 'cold', 'Ice cream (3 scoops)', 160, []],
    ['fruit', 'cold', 'Fruit salad', 200, []]
  ];
  const subCat = {};
  cats.forEach(c => c.subs.forEach(sb => { subCat[sb[0]] = c; }));
  const products = P.map(([id, sub, name, price, groups]) => ({ id, sub, name, price, groups, cat: subCat[sub].id, route: subCat[sub].route }));
  const byId = {}; products.forEach(p => { byId[p.id] = p; });
  const catById = {}; cats.forEach(c => { catById[c.id] = c; });
  return { G, cats, catById, products, byId };
}
