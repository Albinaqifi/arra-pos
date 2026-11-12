const { BrowserWindow } = require('electron');
function textForJob(job) {
  const s = job.snapshot;
  if (job.destination === 'turnover') {
    const rows = ['NON-FISCAL DAILY TURNOVER REPORT', 'System day #' + s.dayId, 'Opened: ' + new Date(s.openedAt).toLocaleString(), 'Closed: ' + new Date(s.closedAt).toLocaleString(), '--------------------------------'];
    for (const r of s.records) rows.push('Bill #' + r.billId + '  Table ' + r.tableId, new Date(r.paidAt).toLocaleString() + '  ' + r.account + ' ' + r.method + '  ' + r.amount + ' den');
    if (!s.records.length) rows.push('No paid bills');
    rows.push('--------------------------------', 'TOTAL: ' + s.total + ' den');
    return rows.join('\n') + '\n' + ' \n'.repeat(12) + '--- CUT HERE ---';
  }
  const rows = job.destination === 'bill' ? ['TEST BILL - NOT A FISCAL RECEIPT', 'Bill #' + s.id, 'Table ' + s.tableId] : ['TEST ' + job.destination.toUpperCase() + ' TICKET', 'Table ' + s.tableId, 'Round ' + s.round];
  rows.push('--------------------------------');
  for (const l of s.lines) {
    rows.push(l.quantity + ' x ' + l.name + (job.destination === 'bill' ? '  ' + (l.quantity * l.unitPrice) + ' den' : ''));
    for (const m of l.modifiers) rows.push('  ' + m.groupName + ': ' + m.optionName);
    if (l.note) rows.push('  Note: ' + l.note);
  }
  if (job.destination === 'bill') rows.push('--------------------------------', 'TOTAL: ' + s.total + ' den', 'NO PAYMENT OR CHARGE BY PRINTING');
  // The visible guide after the feed makes the driver render the blank area.
  // Actual feed distance still depends on the Windows driver and paper settings.
  return rows.join('\n') + '\n' + ' \n'.repeat(12) + '--- CUT HERE ---';
}
const escape = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function printTestJob(job) {
  const win = new BrowserWindow({show:false, webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  try {
    const printers = await win.webContents.getPrintersAsync();
    if (!printers.some(p => p.name === job.queue)) return 'failed';
    const html = '<!doctype html><meta charset="utf-8"><style>body{font:16px monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><pre>' + escape(textForJob(job)) + '</pre>';
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // A callback success is only Windows queue acceptance, never paper proof.
    return await new Promise((resolve,reject) => {
      const timeout = setTimeout(() => reject(Error('Output unknown')), 30000);
      try { win.webContents.print({silent:true,deviceName:job.queue,printBackground:false}, success => { clearTimeout(timeout); success ? resolve('accepted') : reject(Error('Output unknown')); }); }
      catch (error) { clearTimeout(timeout); reject(error); }
    });
  } finally { if (!win.isDestroyed()) win.destroy(); }
}
module.exports = {printTestJob,textForJob};
