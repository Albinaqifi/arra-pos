const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const en = require('../src/admin/en.json');
const sq = require('../src/admin/sq.json');

test('shared dictionaries have matching keys and placeholders', () => {
  assert.deepEqual(Object.keys(sq).sort(), Object.keys(en).sort());
  const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const key of Object.keys(en)) assert.deepEqual(placeholders(sq[key]), placeholders(en[key]), key);
});

test('unknown keys and missing values do not expose keys or placeholders', () => {
  const context = { React: { Component: class {}, createElement() {} } };
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  const t = context.ArraComponents.translate;
  assert.equal(t('sq', 'missing.key'), 'Mesazhi nuk është i disponueshëm.');
  assert.equal(t('en', 'missing.key'), 'Message unavailable.');
  assert.doesNotMatch(t('sq', 'language.saved'), /\{language\}/);
});

test('bill service errors use known messages and safe fallback', () => {
  const context = { React: { Component: class {} }, window: {} };
  vm.runInNewContext(require('./support/renderer-bundle')() + '\nthis.Bill = DesktopBill;', context);
  const bill = new context.Bill({});
  assert.equal(bill.serviceError('Access denied', 'Could not prepare bill'), 'Access denied');
  assert.equal(bill.serviceError('untrusted internal error', 'Could not prepare bill'), 'Could not prepare bill');
  assert.equal(bill.serviceError('Payment result unknown. Retry the same selection.', 'fallback'), 'Payment result unknown. Retry the same selection.');
});

test('configuration and finance text references exist and retain placeholders', () => {
  const config = require('../src/admin/config-sq.json');
  const financeSource = fs.readFileSync('src/admin/finance-i18n.js', 'utf8').replace(/export function financeText[\s\S]*/, 'this.dictionary = sq;');
  const financeContext = {}; vm.runInNewContext(financeSource, financeContext);
  const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const [dictionary, files] of [[config, ['EmployeeConfig','MenuConfig','TableConfig','FinancialDetails','SalesReports','AdminSentCorrections']], [financeContext.dictionary, ['BusinessDays','FinancialVisibility']]]) {
    for (const [key, value] of Object.entries(dictionary)) assert.deepEqual(placeholders(value), placeholders(key), key);
    for (const file of files) {
      const source = fs.readFileSync(`src/admin/${file}.js`, 'utf8');
      const calls = /(?<![\w.])(?:this\.)?t\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g;
      for (const match of source.matchAll(calls)) {
        const key = match[2].replace(/\\'/g, "'");
        if (file === 'SalesReports' && ['period','dayId','account','method'].includes(key)) continue; // URLSearchParams.get
        assert.ok(Object.hasOwn(dictionary, key), `${file}: ${key}`);
      }
    }
  }
});

test('startup shows bilingual recovery if a vendor runtime is missing', async () => {
  const status = { dataset: {}, setAttribute() {}, textContent: '' };
  const context = { document: { getElementById: () => status, body: { dataset: { mode: 'desktop' } } }, window: { addEventListener() {} } };
  vm.runInNewContext(require('./support/renderer-bundle').moduleSource(require.resolve('../src/desktop-status.js'), 'Startup'), context);
  await context.Startup.startRenderer(async () => { throw Error('Must not load without the runtime'); });
  assert.match(status.textContent, /Desktop application unavailable/);
  assert.match(status.textContent, /Aplikacioni nuk është i disponueshëm/);
});

test('literal waiter translation references exist in both dictionaries', () => {
  for (const file of ['src/App.js', 'src/waiter/DesktopBill.js']) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/waiterTranslate\([^,]+,\s*(["'])(waiter\.[^"']+)\1/g)) {
      assert.ok(Object.hasOwn(en, match[2]), `${file}: ${match[2]}`);
      assert.ok(Object.hasOwn(sq, match[2]), `${file}: ${match[2]}`);
    }
  }
});

test('print destinations translate without modifying their identifiers', () => {
  const context = { window: {}, React: { Component: class {} }, ArraComponents: {} };
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  vm.runInNewContext(require('./support/renderer-bundle')() + '\nthis.destination = printDestination;', context);
  assert.equal(context.destination('sq', 'kitchen'), 'Kuzhina');
  assert.equal(context.destination('sq', 'bill'), 'Fatura');
  assert.equal(context.destination('sq', 'unexpected'), 'Destinacion i panjohur');
});
