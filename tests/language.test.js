const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { createSampleAccounts } = require('../src/desktop/sample-accounts');
const { createSession } = require('../src/desktop/session');
const { registerLanguage } = require('../src/desktop/language');
const entryFixture = require('./entry-fixture');

test('language is shared, authorized, validated and persisted across restart', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-language-'));
  let db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  const passwords = ['sample waiter', 'sample owner a', 'sample owner b', 'sample combined'];
  createSampleAccounts(db, passwords);
  const entry = entryFixture(db);
  db.prepare('INSERT INTO app_metadata(key,value) VALUES (?,?)').run('sample', 'retained');
  let session, handler; const event = {};
  const register = () => { session = createSession(db); registerLanguage({handle:(_, fn) => handler = fn}, e => e === event, db, session); };
  register();
  const call = req => handler(event, req);
  assert.deepEqual(call({ action:'get' }), { ok:true, language:'en' });
  assert.equal(call({ action:'set', language:'sq' }).ok, false);
  assert.equal(handler({}, { action:'get' }).ok, false);
  db.prepare("DELETE FROM user_permissions WHERE user_id=1 AND permission='employees.change'").run();
  assert.equal(session.signIn({username:'sample restaurant', password:entry.password}).ok, true);
  assert.equal(session.selectWaiter({id:1,pin:entry.pin}).ok, true);
  assert.equal(call({action:'set', language:'sq'}).ok, false);
  session.signOut();
  assert.equal(session.signIn({username:'sample-owner-a', password:passwords[1]}).ok, true);
  assert.equal(session.selectWaiter({id:2,pin:''}).ok, false);
  for (const req of [{action:'set',language:'fr'}, {action:'set',language:'sq',extra:true}, {action:'get',extra:true}]) assert.equal(call(req).ok,false);
  assert.deepEqual(call({action:'set', language:'sq'}), {ok:true,language:'sq'});
  session.signOut(); assert.equal(call({action:'get'}).language,'sq');
  db.close(); db=openDatabase(dir); register();
  assert.equal(call({action:'get'}).language,'sq');
  assert.equal(db.prepare('SELECT value FROM app_metadata WHERE key=?').get('sample').value,'retained');
  assert.equal(session.signIn({username:'sample-owner-a', password:passwords[1]}).ok,true);
  assert.equal(session.selectWaiter({id:2,pin:''}).ok,false);
  assert.equal(call({action:'set',language:'en'}).language,'en');
  db.prepare("DELETE FROM user_permissions WHERE user_id=2 AND permission='employees.change'").run();
  assert.equal(call({action:'set',language:'sq'}).ok,false);
  assert.equal(call({action:'get'}).language,'en');
  assert.equal(db.prepare("SELECT count(*) n FROM application_audit WHERE entity_type='app_language'").get().n,2);
});


 test('bundled dictionaries interpolate values and the language control reflects both selections', () => {
  const vm = require('node:vm');
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../dist/admin-shell.js'), 'utf8');
  const React = { Component: class {}, createElement: (type, props, ...children) => ({type, props: props || {}, children}) };
  const context = { React }; vm.runInNewContext(source, context);
  const { translate, LanguageSetting } = context.ArraComponents;
  assert.equal(translate('en', 'language.saved', {language:'English'}), 'Language saved: English.');
  assert.equal(translate('sq', 'language.saved', {language:'Shqip'}), 'Gjuha u ruajt: Shqip.');
  assert.equal(translate('unknown', 'language.title'), 'App language');
  const selected = []; const control = LanguageSetting({language:'sq', busy:false, feedback:'saved', onChange:x => selected.push(x)});
  const elements = []; const visit = x => { if (x && typeof x === 'object') { elements.push(x); (x.children || []).flat(Infinity).forEach(visit); } }; visit(control);
  const select = elements.find(x => x.type === 'select');
  assert.equal(select.props.value, 'sq'); select.props.onChange({target:{value:'en'}}); assert.deepEqual(selected,['en']);
  assert.ok(elements.some(x => x.props.role === 'status' && x.children.includes('Gjuha u ruajt: Shqip.')));
});

