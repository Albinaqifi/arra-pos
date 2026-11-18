const { hasPermissions } = require('./permissions');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
function reader(file) {
  const worker=new Worker(path.join(__dirname,'bill-history-reader.js'),{workerData:{file}}); let requestId=0; const pending=new Map();
  worker.on('message',message=>{const entry=pending.get(message.id); if (!entry) return; pending.delete(message.id); message.ok ? entry.resolve(message.data) : entry.reject(Error('Query failed'));});
  const fail=()=>{for(const entry of pending.values()) entry.reject(Error('Reader unavailable')); pending.clear();};
  worker.on('error',fail); worker.on('exit',fail);
  return {query:(anchor,cursor)=>new Promise((resolve,reject)=>{const id=++requestId;pending.set(id,{resolve,reject});worker.postMessage({id,anchor,cursor});}),close:()=>worker.terminate()};
}
const CHANNEL = 'arra:bill-history';
const PAGE_SIZE = 50, PRINT_BATCH = 200, SHEET_ROWS = 60000;
const validRange = r => Number.isSafeInteger(r.from) && r.from >= 0 && Number.isSafeInteger(r.to) && r.to > r.from;
const xml = s => String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,' ').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const translations = {
  en:{title:'PROVISIONAL NON-FISCAL BILL HISTORY',day:'Day',open:'Open',legacy:'original boundaries may be unavailable',opened:'Opened',closed:'Closed',payment:'Payment time',bill:'Bill',table:'Table',method:'Method',account:'Effective account',amount:'Amount (minor units)',cash:'Cash',card:'Card',part:'Part',total:'TOTAL',empty:'No paid bills in this range'},
  sq:{title:'HISTORIK I PERKOHSHEM DHE JO FISKAL I FATURAVE',day:'Dita',open:'E hapur',legacy:'kufijte origjinale mund te mos jene te disponueshem',opened:'Hapur',closed:'Mbyllur',payment:'Koha e pageses',bill:'Fatura',table:'Tavolina',method:'Menyra',account:'Llogaria efektive',amount:'Shuma (njesi me te vogla)',cash:'Para ne dore',card:'Karte',part:'Pjesa',total:'TOTALI',empty:'Nuk ka fatura te paguara ne kete interval'}
};
const dayLabel = (r, language='en') => { const t=translations[language]; return t.day+' #'+r.dayId+(r.closedAt === null ? ' ('+t.open+')' : '')+(r.firstDay ? ' ('+t.legacy+')' : ''); };
const dateTime = (x, language) => new Date(x).toLocaleString(language === 'sq' ? 'sq-AL' : 'en-GB');
const xmlRow = cells => '<Row>' + cells.map(x => `<Cell><Data ss:Type="String">${xml(x)}</Data></Cell>`).join('') + '</Row>';
const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">';
const sheet = (number,language) => { const t=translations[language]; return `<Worksheet ss:Name="${language==='sq' ? 'Historiku' : 'Bill history'} ${number}"><Table>` + xmlRow([t.title]) + xmlRow([t.day,t.opened,t.closed,t.payment,t.bill,t.table,t.method,t.account,t.amount]); };
const recordRow = (r,language) => { const t=translations[language]; return xmlRow([dayLabel(r,language),dateTime(r.openedAt,language),r.closedAt === null ? t.open : dateTime(r.closedAt,language),dateTime(r.paidAt,language),r.billId,r.tableId,t[r.method],r.account,r.amount]); };
function spreadsheet(rows,language='en') { return xmlHeader + sheet(1,language) + rows.map(r=>recordRow(r,language)).join('') + '</Table></Worksheet></Workbook>'; }
function registerBillHistory(ipcMain, allowed, db, session, options = {}) {
  const scopeFor = () => {
    const actor = session.currentUserId();
    if (!actor || actor !== session.authenticatedUserId() || !hasPermissions(db, session, 'employees.view')) return null;
    const scope = db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope;
    return ['A','B','combined'].includes(scope) ? {actor,scope,generation:session.identityGeneration ? session.identityGeneration() : null} : null;
  };
  const snapshots=new Map();
  const same = (event, identity) => { const current=scopeFor(); return allowed(event) && current && current.actor===identity.actor && current.scope===identity.scope && current.generation===identity.generation; };
  ipcMain.handle(CHANNEL, async (event, req) => {
    if (!allowed(event) || !req || Object.getPrototypeOf(req) !== Object.prototype || !validRange(req) ||
      !((req.action === 'page' && Reflect.ownKeys(req).length === 5 && Number.isSafeInteger(req.page) && req.page >= 0 && req.page <= 1000000 && (req.token===null || (typeof req.token==='string' && /^[0-9a-f]{32}$/.test(req.token)))) ||
        (req.action === 'count' && Reflect.ownKeys(req).length === 3) ||
        (['print','export'].includes(req.action) && Reflect.ownKeys(req).length === 4 && ['en','sq'].includes(req.language)))) return {ok:false};
    let copy;
    try {
      const identity = scopeFor(); if (!identity) return {ok:false};
      let anchor, token=null;
      if (req.action==='page' && req.token!==null) {
        anchor=snapshots.get(req.token); token=req.token;
        if (!anchor || anchor.actor!==identity.actor || anchor.scope!==identity.scope || anchor.generation!==identity.generation || anchor.from!==req.from || anchor.to!==req.to) return {ok:false};
      } else {
        const marks=db.prepare(`SELECT COALESCE((SELECT max(id) FROM payments),0) AS payment,
          COALESCE((SELECT max(id) FROM payment_account_corrections),0) AS correction,
          (SELECT id FROM business_days WHERE closed_at IS NULL) AS openDay,
          (SELECT min(id) FROM business_days) AS firstDay`).get();
        anchor={...marks,...identity,from:req.from,to:req.to};
        if(req.action==='page') { token=crypto.randomBytes(16).toString('hex'); snapshots.set(token,anchor); if(snapshots.size>50) snapshots.delete(snapshots.keys().next().value); }
      }
      const current = () => same(event,identity) && db.prepare('SELECT COALESCE(max(id),0) AS id FROM payment_account_corrections').get().id===anchor.correction;
      let result;
      if (req.action === 'export') {
        if (!options.saveDialog) return {ok:false};
        result=await options.saveDialog();
        if (result.canceled) return {ok:true,cancelled:true};
        if (!current() || !result.filePath) return {ok:false};
      } else if (req.action === 'print' && !options.print) return {ok:false};
      const databasePath=db.prepare('PRAGMA database_list').all().find(x=>x.name==='main').file;
      copy=(options.createReader || reader)(databasePath);
      const start=anchor.payment;
      const next = cursor => copy.query(anchor,cursor);
      async function* rows() {
        let cursor=start;
        while (cursor>0) {
          if (!current()) throw Error('Identity changed');
          const bucket=await next(cursor);
          if (!current()) throw Error('Identity changed');
          for(const row of bucket.rows) yield row;
          cursor=bucket.cursor;
        }
      }
      if (req.action==='page' || req.action==='count') {
        let count=0; const records=[];
        for await(const row of rows()) {
          if(req.action==='page' && count>=req.page*PAGE_SIZE && records.length<PAGE_SIZE) records.push(row);
          count++; if(!Number.isSafeInteger(count)) throw Error('Count too large');
        }
        await copy.close(); copy=null;
        if (!current()) return {ok:false};
        return {ok:true,data:req.action==='count' ? {count,printBatch:PRINT_BATCH} : {records,hasMore:count>(req.page+1)*PAGE_SIZE,count,token,printBatch:PRINT_BATCH}};
      }
      if (req.action === 'export') {
        const tmp=path.join(path.dirname(result.filePath),'.arra-report-'+crypto.randomUUID()+'.tmp');
        let fd;
        try {
          fd=await fs.promises.open(tmp,'wx');
          await fd.writeFile(xmlHeader); let index=0, sheetNo=0, chunk='';
          for await (const r of rows()) {
            if(index % SHEET_ROWS===0) { if(sheetNo) chunk+='</Table></Worksheet>'; chunk+=sheet(++sheetNo,req.language); }
            chunk+=recordRow(r,req.language); index++;
            if(index % PRINT_BATCH===0) { await fd.writeFile(chunk); chunk=''; }
          }
          if(chunk) await fd.writeFile(chunk);
          if (!current()) return {ok:false};
          await fd.writeFile((sheetNo ? '' : sheet(1,req.language))+'</Table></Worksheet></Workbook>');
          await fd.close(); fd=undefined;
          if (!current()) return {ok:false};
          fs.renameSync(tmp,result.filePath);
        } finally { if(fd) await fd.close(); try { await fs.promises.unlink(tmp); } catch (_) {} }
        return {ok:true};
      }
      // Both passes use the same immutable payment/correction cutoffs.
      let count=0, total=0n; for await(const row of rows()) { if(!Number.isSafeInteger(row.amount) || row.amount<0) throw Error('Invalid amount'); total+=BigInt(row.amount); count++; if(!Number.isSafeInteger(count)) throw Error('Count too large'); }
      const parts=Math.max(1,Math.ceil(count/PRINT_BATCH));
      const queue=db.prepare('SELECT queue FROM day_print_settings WHERE id=1').get().queue;
      let part=0, batch=[];
      async function printPart() {
        if (!current()) return {ok:false,partial:part>0};
        part++;
        try {
          const printed=await options.print({destination:'bill-history',queue,snapshot:{rows:batch,from:req.from,to:req.to,part,parts,language:req.language,total:total.toString()}});
          if (printed !== 'accepted') return {ok:false,partial:part>1};
        } catch (_) { return {ok:false,uncertain:true,partial:part>1}; }
        batch=[]; return null;
      }
      try {
        for await(const row of rows()) { batch.push(row); if(batch.length===PRINT_BATCH) { const failure=await printPart(); if(failure) return failure; } }
        if(batch.length || !part) { const failure=await printPart(); if(failure) return failure; }
      } catch (_) { return {ok:false,partial:part>0}; }
      return {ok:true,accepted:true,parts};
    } catch (_) { return {ok:false}; }
    finally { if(copy) await copy.close(); }
  });
}
module.exports = { CHANNEL, PAGE_SIZE, PRINT_BATCH, SHEET_ROWS, registerBillHistory, spreadsheet, dayLabel, dateTime, translations };
