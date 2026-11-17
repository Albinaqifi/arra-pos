const test = require('node:test');
const assert = require('node:assert/strict');
const { textForJob, rasterBands, renderRaster } = require('../src/desktop/windows-test-printer');

test('Windows GDI renders Unicode and wraps long text without printing', {skip:process.platform !== 'win32'}, async () => {
  const sample = await renderRaster('CANCELLATION\nËmbëlsirë me një emër shumë të gjatë për një rresht të vetëm\nÇaj');
  assert.deepEqual([...sample.subarray(0,6)], [29,118,48,0,48,0]);
  const height = sample.readUInt16LE(6);
  assert.ok(height > 3 * 32 + 16, 'long line wraps');
  assert.equal(sample.length, 8 + 48 * height);
  assert.ok(sample.subarray(8).some(byte => byte !== 0), 'raster contains ink');
  const ascii = await renderRaster('CANCELLATION\nEmbelsire me nje emer shume te gjate per nje rresht te vetem\nCaj');
  assert.notDeepEqual(sample, ascii, 'accented text produces different glyphs');
});

test('raster bands preserve every row and limit command height', () => {
  const width = 48, height = 49;
  const source = Buffer.alloc(8 + width * height);
  Buffer.from([29,118,48,0,48,0,49,0]).copy(source);
  for (let i = 8; i < source.length; i++) source[i] = (i * 13) & 255;
  const encoded = rasterBands(source);
  let offset = 0;
  const pixels = [], heights = [];
  while (offset < encoded.length) {
    assert.deepEqual([...encoded.subarray(offset, offset + 4)], [29,118,48,0]);
    assert.equal(encoded.readUInt16LE(offset + 4), width);
    const rows = encoded.readUInt16LE(offset + 6); heights.push(rows);
    pixels.push(encoded.subarray(offset + 8, offset + 8 + rows * width));
    offset += 8 + rows * width;
  }
  assert.deepEqual(heights, [24,24,1]);
  assert.deepEqual(Buffer.concat(pixels), source.subarray(8));
  assert.throws(() => rasterBands(source.subarray(0, -1)), /Invalid raster/);
});

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

test('compatible cancellation sends buzzer bytes and Unicode raster in one RAW job', async () => {
  const Module = require('node:module');
  const { EventEmitter } = require('node:events');
  const originalLoad = Module._load;
  const modulePath = require.resolve('../src/desktop/windows-test-printer');
  const existing = require.cache[modulePath];
  let payload, renderedText, executable, spawnFails = false, printed = 0;
  class Window {
    constructor() {
      this.webContents = {
        getPrintersAsync: async () => [{name:'sample queue'}],
        print: (_options, callback) => { printed++; callback(true); },
      };
    }
    async loadURL() {}
    isDestroyed() { return false; }
    destroy() {}
  }
  Module._load = function(request, parent, isMain) {
    if (request === 'electron') return {BrowserWindow:Window};
    if (request === 'node:child_process') return {spawn: (program, _args, options) => {
      executable = program;
      const child = new EventEmitter();
      child.stdin = new EventEmitter();
      if (options.stdio[1] === 'pipe') child.stdout = new EventEmitter();
      child.stdin.end = data => { process.nextTick(() => {
        if (spawnFails) return child.emit('error', Error('spawn failed'));
        if (child.stdout) { renderedText = JSON.parse(data).text; child.stdout.emit('data', Buffer.from(Buffer.from([29,118,48,0,1,0,1,0,255]).toString('base64'))); child.emit('close',0); }
        else { payload = JSON.parse(data); child.emit('exit',0); }
      }); };
      child.kill = () => {};
      return child;
    }};
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[modulePath];
  try {
    const {printTestJob} = require(modulePath);
    const job = {queue:'sample queue', destination:'kitchen', cancellation:true, beep:true, snapshot:{tableId:1, round:1, lines:[{quantity:1,name:'Ëmbëlsirë me një emër shumë të gjatë për ta mbështjellë në biletë',modifiers:[],note:'Çaj'}]}};
    assert.equal(await printTestJob(job), 'accepted');
    assert.ok(renderedText.includes(job.snapshot.lines[0].name));
    assert.ok(renderedText.includes('Çaj'));
    assert.equal(executable, require('node:path').win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
    assert.equal(payload.queue, 'sample queue');
    assert.deepEqual([...Buffer.from(payload.bytes,'base64')], [27,66,3,4,29,118,48,0,1,0,1,0,255,10,10,10]);
    assert.equal(printed, 0);
    assert.equal(await printTestJob({...job,beep:false}), 'accepted');
    assert.equal(await printTestJob({...job,cancellation:false,beep:true}), 'accepted');
    assert.equal(printed, 2);
    spawnFails = true;
    await assert.rejects(printTestJob(job), /Output unknown/);
    assert.equal(printed, 2, 'an uncertain RAW failure must not automatically print again');
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
    if (existing) require.cache[modulePath] = existing;
  }
});
test('bill history rows contain date, bill and MKD and only the final part has the full total', () => {
  const paidAt=new Date(2026,6,10,14,35).getTime();
  const record={dayId:2,firstDay:0,openedAt:1,closedAt:null,paidAt,billId:8,tableId:4,method:'cash',account:'A',amount:220};
  for(const [language,bill,total,part] of [['en','Bill','TOTAL','Part'],['sq','Fatura','TOTALI','Pjesa']]) {
    const snapshot={from:paidAt,to:paidAt+86400000,part:1,parts:2,language,rows:[record],total:'420'};
    const text=textForJob({destination:'bill-history',snapshot});
    const line=text.split('\n').find(x=>x.includes(bill+' #8'));
    assert.equal(line,new Date(paidAt).toLocaleDateString(language==='sq'?'sq-AL':'en-GB')+' | '+bill+' #8 | 220 MKD');
    assert.ok(!line.includes('14:35')); assert.ok(!line.includes('cash')); assert.ok(!line.includes('Table'));
    assert.ok(text.includes(part+' 1 / 2'));assert.ok(!text.includes(total+':'));
    const last=textForJob({destination:'bill-history',snapshot:{...snapshot,part:2,rows:[]}});
    assert.ok(last.includes(total+': 420 MKD'));
  }
});
