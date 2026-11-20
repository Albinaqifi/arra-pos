// One-time setup of a fresh empty restaurant. Credentials arrive through stdin.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { openDatabase } = require('./database');
const { hashPassword, waiterPinCredential, validPassword } = require('./session');
const { seedTables } = require('./tables');
const { seedArraMenu } = require('./arra-menu');
let db, values;
try {
 const directory = process.argv[2];
 const commissioning = process.argv.length === 4 && process.argv[3] === '--new-pf700-commissioning-profile';
 if ((!commissioning && process.argv.length !== 3) || !directory || !path.isAbsolute(directory) || process.stdin.isTTY) throw Error('Invalid invocation');
 const input = fs.readFileSync(0, 'utf8');
 if (Buffer.byteLength(input) > 8192) throw Error('Invalid input');
 values = JSON.parse(input);
 if (!Array.isArray(values) || values.length !== 12 || !values.slice(0,4).every(validPassword) || !/^\d{4}$/.test(values[4]) || !/^\d{6}$/.test(values[5]) ||
     values.slice(6).some(name => typeof name !== 'string' || name !== name.trim() || name.length === 0 || name.length > 128) || new Set(values.slice(6)).size !== 6) throw Error('Invalid input');
 fs.mkdirSync(directory);
 if (!commissioning) fs.writeFileSync(path.join(directory,'SAMPLE-DATA-ONLY'), 'Sample data only. No real sales.\n', {flag:'wx'});
 db = openDatabase(directory);
 db.exec('BEGIN IMMEDIATE');
 try {
  const insert = db.prepare('INSERT INTO local_users(username,salt,password_hash,pin_salt,pin_hash) VALUES(?,?,?,?,?)');
  const scope = db.prepare('INSERT INTO financial_scopes VALUES(?,?)');
  const grant = db.prepare('INSERT INTO user_permissions VALUES(?,?)');
  const add = (name,password,pin) => { const salt = randomBytes(16), pinSalt = pin == null ? null : randomBytes(16); return insert.run(name,salt,hashPassword(password,salt),pinSalt,pinSalt ? hashPassword(pin,pinSalt) : null).lastInsertRowid; };
  ['waiter','A','B','combined'].forEach((role,i) => {
   const name = values[i+6];
   const id = add(name,values[i],null); scope.run(id,role);
   if (i === 0) db.prepare('INSERT INTO restaurant_accounts VALUES(?)').run(id);
   else for (const permission of role === 'combined' ? ['tables.change','menu.change','employees.view','employees.change','orders.correct_sent','business_days.close'] : ['tables.change','menu.change','employees.view','employees.change']) grant.run(id,permission);
  });
  const waiter = add(values[10],randomBytes(32).toString('hex'),values[4]); scope.run(waiter,'waiter');
  db.prepare('UPDATE local_users SET pin_salt=?,pin_hash=? WHERE id=?').run(...waiterPinCredential(values[4]),waiter);
  db.prepare('INSERT INTO verified_waiter_pins(user_id) VALUES (?)').run(waiter);
  for (const permission of ['tables.view','menu.view','orders.view','orders.change','orders.correct_sent']) grant.run(waiter,permission);
  const manager = add(values[11],randomBytes(32).toString('hex'),values[5]); db.prepare('INSERT INTO transfer_managers VALUES(?)').run(manager);
  db.exec('COMMIT');
 } catch (error) { db.exec('ROLLBACK'); throw error; }
 seedTables(db); seedArraMenu(db);
 if (commissioning) require('./pf700-commissioning').enroll(db);
 fs.writeFileSync(path.join(directory,'ARRA-SETUP-COMPLETE'), 'Arra setup complete.\n', {flag:'wx'});
 console.log('Arra setup complete. The menu is ready and all tables are available.');
} catch (_) {
 console.error('Setup failed. Existing data was not overwritten. If a new incomplete directory was created, move it aside before retrying.'); process.exitCode = 1;
} finally { if (Array.isArray(values)) values.fill(''); if (db) db.close(); }
