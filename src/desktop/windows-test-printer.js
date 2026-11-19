const { BrowserWindow } = require('electron');
function textForJob(job) {
  const s = job.snapshot;
  if (job.destination === 'account-a-close') {
    const labels = {
      en:{title:'NON-FISCAL ACCOUNT A CLOSE',day:'System day',opened:'Opened',dayClosed:'Shared day closed',close:'Account close',actor:'Actor',bill:'Bill',table:'Table',cash:'Cash',card:'Card',empty:'No paid bills for account A',payments:'PAYMENTS',total:'TOTAL',units:'minor units'},
      sq:{title:'MBYLLJA JO FISKALE E LLOGARISE A',day:'Dita e sistemit',opened:'Hapur',dayClosed:'Dita e perbashket u mbyll',close:'Mbyllja e llogarise',actor:'Vepruesi',bill:'Fatura',table:'Tavolina',cash:'Para ne dore',card:'Karte',empty:'Nuk ka fatura te paguara per llogarine A',payments:'PAGESAT',total:'TOTALI',units:'njesi me te vogla monetare'}
    };
    const t=labels[s.language]; if (!t) throw Error('Invalid report language');
    const date=value=>new Date(value).toLocaleString(s.language==='sq'?'sq-AL':'en-GB');
    const rows = [t.title, t.day+' #'+s.dayId, t.opened+': '+date(s.openedAt), t.dayClosed+': '+date(s.closedAt), t.close+': '+date(s.accountClosedAt), t.actor+' #'+s.closedBy, t.units, '--------------------------------'];
    for (const r of s.records) rows.push(t.bill+' #'+r.billId+'  '+t.table+' '+r.tableId, date(r.paidAt)+'  '+t[r.method]+'  '+r.amount);
    if (!s.records.length) rows.push(t.empty);
    rows.push('--------------------------------', t.payments+': '+s.count, t.cash+': '+s.cash, t.card+': '+s.card, t.total+': '+s.total);
    return rows.join('\n') + '\n' + ' \n'.repeat(12) + '--- CUT HERE ---';
  }
  if (job.destination === 'account-a-bills') {
    const labels={en:{title:'NON-FISCAL ACCOUNT A PAID BILLS',day:'Business day',bill:'Bill',empty:'No paid Account A bills',total:'TOTAL',cash:'Cash',card:'Card',units:'minor units'},sq:{title:'FATURAT E PAGUARA JO FISKALE TE LLOGARISE A',day:'Dita e punes',bill:'Fatura',empty:'Nuk ka fatura te paguara per llogarine A',total:'TOTALI',cash:'Para ne dore',card:'Karte',units:'njesi me te vogla monetare'}};
    const t=labels[s.language]; if(!t) throw Error('Invalid language');
    const rows=[t.title,t.day+' #'+s.id,t.units,'--------------------------------'];
    for(const r of s.records) rows.push(t.bill+' #'+r.billId+'  '+r.amount);
    if(!s.records.length) rows.push(t.empty);
    rows.push('--------------------------------',t.total+': '+s.total,t.cash+': '+s.cash,t.card+': '+s.card);
    return rows.join('\n')+'\n'+' \n'.repeat(12)+'--- CUT HERE ---';
  }
  if (job.destination === 'bill-history') {
    const {dayLabel,translations} = require('./bill-history');
    const language=s.language, t=translations[language]; if (!t) throw Error('Invalid language');
    const date=value=>new Date(value).toLocaleDateString(language === 'sq' ? 'sq-AL' : 'en-GB');
    const rows = [t.title, date(s.from) + ' - ' + date(s.to - 1), t.part + ' ' + s.part + ' / ' + s.parts];
    let day = null;
    for (const r of s.rows) {
      if (r.dayId !== day) { day = r.dayId; rows.push('--------------------------------', dayLabel(r,language)); }
      rows.push(date(r.paidAt) + ' | '+t.bill+' #' + r.billId + ' | ' + r.amount + ' MKD');
    }
    if (!s.rows.length) rows.push(t.empty);
    if (s.part===s.parts) rows.push('--------------------------------', t.total + ': ' + s.total + ' MKD');
    return rows.join('\n') + '\n' + ' \n'.repeat(12) + '--- CUT HERE ---';
  }
  if (job.destination === 'shift-report') {
    if (!['A','B','combined'].includes(job.scope)) throw Error('Invalid report scope');
    const rows=['NON-FISCAL SHIFT REPORT',job.scope==='combined'?'ACCOUNTS A AND B':'ACCOUNT '+job.scope,'Business day #'+s.dayId,'Shift #'+s.id,'Opened: '+new Date(s.openedAt).toLocaleString(),'Closed: '+new Date(s.closedAt).toLocaleString(),'Amounts as recorded at close','--------------------------------','Paid bills: '+s.count,'Cash: '+s.cash+' MKD','Card: '+s.card+' MKD','TOTAL: '+s.total+' MKD'];
    return rows.join('\n')+'\n'+' \n'.repeat(12)+'--- CUT HERE ---';
  }
  if (job.destination === 'turnover') {
    if (!['A','B','combined'].includes(job.scope)) throw Error('Invalid report scope');
    const rows = ['NON-FISCAL DAILY TURNOVER REPORT', job.scope === 'combined' ? 'FULL REPORT - ACCOUNTS A AND B' : 'ACCOUNT ' + job.scope + ' REPORT ONLY', 'System day #' + s.dayId, 'Opened: ' + new Date(s.openedAt).toLocaleString(), 'Closed: ' + new Date(s.closedAt).toLocaleString(), '--------------------------------'];
    for (const r of s.records) rows.push('Bill #' + r.billId + '  Table ' + r.tableId, new Date(r.paidAt).toLocaleString() + '  ' + r.account + ' ' + r.method + '  ' + r.amount + ' den');
    if (!s.records.length) rows.push(job.scope === 'combined' ? 'No paid bills for accounts A and B' : 'No paid bills for account ' + job.scope);
    rows.push('--------------------------------', 'TOTAL: ' + s.total + ' den');
    return rows.join('\n') + '\n' + ' \n'.repeat(12) + '--- CUT HERE ---';
  }
  let rows;
  if (job.destination === 'bill') {
    rows = ['TEST BILL - NOT A FISCAL RECEIPT', 'Bill #' + s.id, 'Table ' + s.tableId];
  } else {
    const station = {kitchen:'KITCHEN 1', kitchen2:'KITCHEN 2', bar:'BAR'}[job.destination];
    if (!station) throw Error('Invalid preparation destination');
    const prefix = s.preparationMode === 'routine' ? '' : 'TEST ';
    rows = [prefix + station + (job.cancellation ? ' CANCELLATION' : ' TICKET'), 'Table ' + s.tableId, 'Round ' + s.round];
    if (job.cancellation) rows.unshift('*** CANCELLATION ***');
  }
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
// Render Unicode locally with the same Windows drawing API used by the
// physically checked printer diagnostic. Input and output stay on pipes.
const rasterScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Drawing
$text = ([Console]::In.ReadToEnd() | ConvertFrom-Json).text
$probe = [System.Drawing.Bitmap]::new(384, 1)
$graphics = [System.Drawing.Graphics]::FromImage($probe)
$font = [System.Drawing.Font]::new('Consolas', 24, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
try {
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($paragraph in $text.Split([char]10)) {
    $line = ''
    $elements = [Globalization.StringInfo]::GetTextElementEnumerator($paragraph)
    while ($elements.MoveNext()) {
      $element = $elements.GetTextElement(); $next = $line + $element
      if ($line.Length -gt 0 -and $graphics.MeasureString($next, $font).Width -gt 368) { $lines.Add($line); $line = $element } else { $line = $next }
    }
    $lines.Add($line)
  }
  $height = $lines.Count * 32 + 16
  if ($height -gt 65535) { throw 'Ticket too long' }
  $graphics.Dispose(); $probe.Dispose()
  $bitmap = [System.Drawing.Bitmap]::new(384, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::White)
    for ($i = 0; $i -lt $lines.Count; $i++) { $graphics.DrawString($lines[$i], $font, [System.Drawing.Brushes]::Black, 8, 8 + $i * 32) }
    $data = [byte[]]::new(8 + 48 * $height)
    $data[0]=29; $data[1]=118; $data[2]=48; $data[3]=0; $data[4]=48; $data[5]=0; $data[6]=$height -band 255; $data[7]=($height -shr 8)
    for ($y = 0; $y -lt $height; $y++) {
      for ($x = 0; $x -lt 384; $x++) {
        $color=$bitmap.GetPixel($x,$y)
        if (($color.R + $color.G + $color.B) -lt 384) {
          $index=8+$y*48+[int][Math]::Floor($x/8)
          $data[$index]=$data[$index] -bor (128 -shr ($x % 8))
        }
      }
    }
    [Console]::Out.Write([Convert]::ToBase64String($data))
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
} finally { $graphics.Dispose(); $probe.Dispose(); $font.Dispose() }
`;
function systemPowerShell() {
  return require('node:path').win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
function renderRaster(text) {
  const { spawn } = require('node:child_process');
  return new Promise((resolve,reject)=>{
    const child=spawn(systemPowerShell(),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(rasterScript,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    const chunks=[];
    const timer=setTimeout(()=>{child.kill(); reject(Error('Output unknown'));},30000);
    child.stdout.on('data',chunk=>chunks.push(chunk));
    child.on('error',()=>{clearTimeout(timer);reject(Error('Output unknown'));});
    child.on('close',code=>{clearTimeout(timer);code === 0 ? resolve(Buffer.from(Buffer.concat(chunks).toString('ascii'),'base64')) : reject(Error('Output unknown'));});
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify({text}));
  });
}
// Some ESC/POS printers accept small raster commands but not a full ticket in
// one command. Split on row boundaries so every command has bounded height.
function rasterBands(raster, bandHeight = 24) {
  if (!Buffer.isBuffer(raster) || raster.length < 8 || !raster.subarray(0, 4).equals(Buffer.from([29,118,48,0]))) throw Error('Invalid raster');
  const width = raster.readUInt16LE(4), height = raster.readUInt16LE(6);
  if (!width || !height || raster.length !== 8 + width * height || !Number.isInteger(bandHeight) || bandHeight < 1 || bandHeight > 65535) throw Error('Invalid raster');
  const bands = [];
  for (let row = 0; row < height; row += bandHeight) {
    const rows = Math.min(bandHeight, height - row), header = Buffer.from([29,118,48,0,0,0,0,0]);
    header.writeUInt16LE(width, 4); header.writeUInt16LE(rows, 6);
    bands.push(header, raster.subarray(8 + row * width, 8 + (row + rows) * width));
  }
  return Buffer.concat(bands);
}
// A single RAW spooler document carries both the alert and cancellation text.
// The queue is passed through stdin, never interpolated into PowerShell source.
const rawScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ArraRaw {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class Doc { public string name; public string output; public string datatype; }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr h, int level, [In] Doc doc);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] data, int count, out int written);
  [DllImport("winspool.drv")] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv")] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv")] public static extern bool ClosePrinter(IntPtr h);
}
"@
$x = [Console]::In.ReadToEnd() | ConvertFrom-Json
$data = [Convert]::FromBase64String($x.bytes)
$h = [IntPtr]::Zero
if (-not [ArraRaw]::OpenPrinter($x.queue, [ref]$h, [IntPtr]::Zero)) { exit 2 }
try {
  $doc = New-Object ArraRaw+Doc; $doc.name = 'Arra cancellation'; $doc.datatype = 'RAW'
  if ([ArraRaw]::StartDocPrinter($h, 1, $doc) -eq 0) { exit 3 }
  $pageDone = $false; $docDone = $false
  try {
    if (-not [ArraRaw]::StartPagePrinter($h)) { exit 4 }
    try { $written = 0; if (-not [ArraRaw]::WritePrinter($h,$data,$data.Length,[ref]$written) -or $written -ne $data.Length) { exit 5 } }
    finally { $pageDone = [ArraRaw]::EndPagePrinter($h) }
  } finally { $docDone = [ArraRaw]::EndDocPrinter($h) }
  if (-not $pageDone -or -not $docDone) { exit 6 }
} finally { [void][ArraRaw]::ClosePrinter($h) }
`;
function printRawCancellation(job, raster) {
  const { spawn } = require('node:child_process');
  const bytes = Buffer.concat([Buffer.from([0x1b,0x42,0x03,0x04]),raster,Buffer.from('\n\n\n')]);
  return new Promise((resolve,reject)=>{
    const child=spawn(systemPowerShell(),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(rawScript,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','ignore','ignore']});
    const timer=setTimeout(()=>{child.kill(); reject(Error('Output unknown'));},30000);
    child.on('error',()=>{clearTimeout(timer);reject(Error('Output unknown'));});
    child.on('exit',code=>{clearTimeout(timer);code === 0 ? resolve('accepted') : reject(Error('Output unknown'));});
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify({queue:job.queue,bytes:bytes.toString('base64')}));
  });
}
async function printTestJob(job) {
  const win = new BrowserWindow({show:false, webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  try {
    const printers = await win.webContents.getPrintersAsync();
    if (!printers.some(p => p.name === job.queue)) return 'failed';
    if (job.cancellation && job.beep) {
      // Render Unicode with local Windows fonts, then send bounded raster bands
      // and the buzzer together in one RAW spooler job.
      const ticketText=textForJob(job).replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ');
      const raster=await renderRaster(ticketText);
      return await printRawCancellation(job,rasterBands(raster));
    }
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
module.exports = {printTestJob,textForJob,rasterBands,renderRaster};
