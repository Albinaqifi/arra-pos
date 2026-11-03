// Fixture for service behavior tests; authorization is tested separately.
function authorizedDatabase(db) {
  db.prepare("INSERT OR IGNORE INTO local_users (id, username, salt, password_hash) VALUES (1, 'fixture', x'00', x'00')").run();
  const grant = db.prepare('INSERT OR IGNORE INTO user_permissions VALUES (1, ?)');
  for (const permission of ['tables.view', 'menu.view', 'orders.view', 'orders.change']) grant.run(permission);
  return db;
}
module.exports = { authorizedDatabase };
