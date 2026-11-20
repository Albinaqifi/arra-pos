const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('../src/desktop/database');
const { registerBusinessDays } = require('../src/desktop/business-days');

test('financial landing and direct print agree for Account A, B and Combined identities', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  migrate(db);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES
    (1,'sample-a',x'00',x'00'),(2,'sample-b',x'00',x'00'),(3,'sample-combined',x'00',x'00');
    INSERT INTO financial_scopes VALUES (1,'A'),(2,'B'),(3,'combined');
    INSERT INTO user_permissions VALUES (1,'employees.view'),(2,'employees.view'),(3,'business_days.close');`);
  let actor = 1, handler, prints = 0;
  registerBusinessDays({handle: (_, fn) => { handler = fn; }}, () => true, db,
    {currentUserId: () => actor, authenticatedUserId: () => actor}, undefined, null,
    {printDailyControl: async authorized => { if (!authorized()) return 'failed'; prints++; return 'accepted'; }});
  class Component { constructor(props) { this.props = props; } setState(value) { Object.assign(this.state, value); } }
  const context = {
    React: {Component, Fragment:'fragment', createElement:(type, props, ...children) => ({type, props:props || {}, children})},
    // Electron IPC structured-clones requests into the main-process realm.
    window: {arra: {businessDays: request => handler({}, JSON.parse(JSON.stringify(request)))}}
  };
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  async function entryVisible() {
    const screen = new context.ArraComponents.FinancialVisibility({language:'en'});
    screen.mounted = true;
    await screen.probeAccountA();
    await screen.probeAccountABills();
    const visible = JSON.stringify(screen.render()).includes('Account A fiscal printer');
    screen.componentWillUnmount();
    return visible;
  }
  for (const [id, expected] of [[1,true],[2,false],[3,true]]) {
    actor = id;
    assert.equal(await entryVisible(), expected, `entry for identity ${id}`);
    assert.equal((await handler({}, {action:'accountAPrinterDailyControl'})).ok, expected, `request for identity ${id}`);
  }
  assert.equal(prints, 2);
  actor = 1;
  db.exec("DELETE FROM user_permissions WHERE user_id=1 AND permission='employees.view'");
  assert.equal(await entryVisible(), false);
  assert.equal((await handler({}, {action:'accountAPrinterDailyControl'})).ok, false);
  assert.equal(prints, 2);
});
