const test = require('node:test');
const assert = require('node:assert/strict');
const { sale, total, closeReceipt, dailyReport } = require('../src/desktop/pf700-commands');
const { encodeRequest } = require('../src/desktop/pf700-frame');

test('builds manual fiscal sale and total payloads without I/O', () => {
  const item = sale({description:'2 x 120',taxGroup:'B',price:'2.40'});
  assert.equal(item.command,0x31);
  assert.deepEqual(item.data,Buffer.from('2 x 120\tB2.40'));
  assert.deepEqual(total({mode:'cash',tendered:'2.50'}).data,Buffer.from('\tP2.50'));
  assert.deepEqual(total({mode:'debit',tendered:'2.50'}).data,Buffer.from('\tD2.50'));
  assert.deepEqual(encodeRequest({sequence:0x20,...item}), Buffer.from('01312031322078203132300942322e3430053033313303','hex'));
});

test('rejects unsafe descriptions, tax groups and ambiguous or invalid amounts', () => {
  for(const description of ['', ' ', 'x'.repeat(26), 'Çaj', 'x\ny', 'x\ty']) assert.throws(()=>sale({description,taxGroup:'A',price:'1.00'}));
  for(const taxGroup of ['a','E','',null]) assert.throws(()=>sale({description:'Tea',taxGroup,price:'1.00'}));
  for(const price of [1, '', '0', '0.00', '-1', '+1', '01', '.1', '1.', '1.001', '1234567.89', '1e3', 'NaN']) assert.throws(()=>sale({description:'Tea',taxGroup:'A',price}));
  assert.throws(()=>total({mode:'card',tendered:'2.50'}));
  assert.throws(()=>total({mode:'cash',tendered:'0'}));
  assert.equal(total({mode:'cash',tendered:'12345.67'}).data.toString(), '\tP12345.67');
  assert.throws(()=>total({mode:'cash',tendered:'123456.78'}));
  assert.equal(sale({description:'Tea',taxGroup:'A',price:'123456.78'}).data.toString(), 'Tea\tA123456.78');
});

test('requires an explicit documented daily report mode and builds close receipt', () => {
  assert.deepEqual(closeReceipt(),{command:0x38,data:Buffer.alloc(0),allowedControls:[]});
  for(const option of ['0','1','2']) assert.deepEqual(dailyReport({option}),{command:0x45,data:Buffer.from(option),allowedControls:[]});
  for(const option of ['',0,'N','3',null]) assert.throws(()=>dailyReport({option}));
});
