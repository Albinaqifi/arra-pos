const test = require('node:test');
const assert = require('node:assert/strict');
const { textForJob } = require('../src/desktop/windows-test-printer');

test('sample kitchen, bar and bill output includes blank feed after the content', () => {
  for (const destination of ['kitchen', 'bar', 'bill']) {
    const output = textForJob({ destination, snapshot: {
      id: 1, tableId: 3, round: 1, total: 100,
      lines: [{ quantity: 1, name: 'Sample item', unitPrice: 100, modifiers: [] }],
    } });
    assert.ok(output.includes('Sample item'));
    assert.ok(output.endsWith('\n' + ' \n'.repeat(12) + '--- CUT HERE ---'));
  }
});
