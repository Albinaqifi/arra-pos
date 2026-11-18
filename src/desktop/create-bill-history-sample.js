// Creates only a new, isolated development database. Never opens an existing one.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDatabase } = require('./database');
const { seedSampleIdentities } = require('./sample-accounts');
const { seedTables } = require('./tables');
const { seedMenu } = require('./menu');

function createBillHistorySample(passwords, now = new Date()) {
  if (!Array.isArray(passwords) || passwords.length !== 3 || new Set(passwords).size !== 3) throw Error('Choose three distinct sample passwords');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-bill-history-sample-'));
  let db;
  try {
    db = openDatabase(directory);
    seedSampleIdentities(db, [crypto.randomBytes(24).toString('hex'), ...passwords], String(crypto.randomInt(10000)).padStart(4, '0'), String(crypto.randomInt(1000000)).padStart(6, '0'));
    seedTables(db); seedMenu(db);
    const waiter = db.prepare("SELECT id FROM local_users WHERE username='sample-waiter'").get().id;
    const owner = db.prepare("SELECT id FROM local_users WHERE username='sample-combined'").get().id;
    const products = db.prepare('SELECT id,name,price FROM menu_products ORDER BY id').all();
    const order = db.prepare("INSERT INTO orders(table_id,opened_at,status) VALUES(?,?,'open')");
    const item = db.prepare("INSERT INTO order_items(order_id,product_id,name,unit_price,quantity,status) VALUES(?,?,?,?,?,'sent')");
    const bill = db.prepare('INSERT INTO bills(order_id,actor_id,generated_at,total,fingerprint) VALUES(?,?,?,?,?)');
    const line = db.prepare('INSERT INTO bill_lines(bill_id,item_id,name,unit_price,quantity,modifiers) VALUES(?,?,?,?,?,?)');
    const payment = db.prepare('INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(?,?,?,?,?,?)');
    const complete = db.prepare("UPDATE orders SET status='completed' WHERE id=?");
    const close = db.prepare("UPDATE business_days SET closed_at=?,closed_by=?,issues=? WHERE closed_at IS NULL");
    const open = db.prepare('INSERT INTO business_days(opened_at) VALUES(?)');
    // Each period runs from 03:00 local time to 03:00 the next day, including DST.
    const currentStart = new Date(now); currentStart.setHours(3, 0, 0, 0);
    if (currentStart > now) currentStart.setDate(currentStart.getDate() - 1);
    const first = new Date(currentStart); first.setDate(first.getDate() - 364);
    let total = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE business_days SET opened_at=? WHERE closed_at IS NULL').run(first.getTime());
      for (let day = 0; day < 365; day++) {
        const start = new Date(first); start.setDate(start.getDate() + day);
        const end = new Date(start); end.setDate(end.getDate() + 1);
        const limit = Math.min(end.getTime(), now.getTime());
        const count = 30 + crypto.randomInt(21);
        // Chronological insertion also makes bill IDs and displayed dates easy to follow.
        const times = Array.from({length: count}, () => start.getTime() + crypto.randomInt(Math.max(1, limit - start.getTime()))).sort((a, b) => a - b);
        for (const paidAt of times) {
          const product = products[crypto.randomInt(products.length)], quantity = 1 + crypto.randomInt(4), amount = product.price * quantity;
          const orderId = order.run(1 + crypto.randomInt(16), paidAt - 60000).lastInsertRowid;
          const itemId = item.run(orderId, product.id, product.name, product.price, quantity).lastInsertRowid;
          const billId = bill.run(orderId, waiter, paidAt - 1000, amount, `sample-${total}`).lastInsertRowid;
          line.run(billId, itemId, product.name, product.price, quantity, '[]');
          const method = crypto.randomInt(4) === 0 ? 'card' : 'cash';
          const account = method === 'card' || crypto.randomInt(2) === 0 ? 'A' : 'B';
          payment.run(billId, waiter, paidAt, amount, method, account);
          complete.run(orderId); total++;
        }
        if (day < 364) { close.run(end.getTime(), owner, JSON.stringify({orders:[],printJobs:[]})); open.run(end.getTime()); }
      }
      // Synthetic historical inserts bypass service hooks; do not present partial shift coverage.
      db.exec('INSERT INTO shift_coverage_unavailable(day_id) SELECT id FROM business_days WHERE closed_at IS NULL');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    fs.writeFileSync(path.join(directory, 'SAMPLE-DATA-ONLY'), 'Isolated sample data only. No real sales.\n', {flag:'wx'});
    return { directory, total };
  } finally { if (db) db.close(); }
}

if (require.main === module) {
  let values;
  try {
    if (process.argv.length !== 2 || process.stdin.isTTY) throw Error('Use the PowerShell launcher');
    values = JSON.parse(fs.readFileSync(0, 'utf8'));
    console.log(JSON.stringify(createBillHistorySample(values)));
  } catch (error) { console.error('Sample setup failed: ' + error.message); process.exitCode = 1; }
  finally { if (Array.isArray(values)) values.fill(''); }
}
module.exports = { createBillHistorySample };
