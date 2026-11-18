const crypto = require('node:crypto');
const { hasPermissions } = require('./permissions');
const flights = new WeakSet();
const fields = (req, names) => Reflect.ownKeys(req).length === names.length && names.every(name => Object.hasOwn(req,name));
function report(db, dayId) {
  const day=db.prepare('SELECT id,opened_at AS openedAt,closed_at AS closedAt FROM business_days WHERE id=?').get(dayId);
  if (!day) throw Error('Day unavailable');
  const records=db.prepare(`SELECT p.bill_id AS billId,p.amount,p.method FROM payments p JOIN payment_business_days pd ON pd.payment_id=p.id
    LEFT JOIN payment_account_corrections c ON c.payment_id=p.id WHERE pd.business_day_id=? AND (p.method='card' OR p.account='A' OR c.id IS NOT NULL) ORDER BY p.paid_at,p.id`).all(dayId);
  let cash=0,card=0;
  for(const r of records) {
    if(!Number.isSafeInteger(r.amount) || r.amount<0 || !['cash','card'].includes(r.method)) throw Error('Invalid amount');
    if(r.method==='cash') cash+=r.amount; else card+=r.amount;
    if(!Number.isSafeInteger(cash) || !Number.isSafeInteger(card) || !Number.isSafeInteger(cash+card)) throw Error('Invalid total');
  }
  return {...day,records,cash,card,total:cash+card};
}
const digest = data => crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
async function handle(event,req,allowed,db,session,adapter) {
  if(!allowed(event) || !req || Object.getPrototypeOf(req)!==Object.prototype) return {ok:false};
  const valid=(req.action==='accountABillsList' && fields(req,['action'])) ||
    (req.action==='accountABillsPreview' && fields(req,['action','dayId']) && Number.isSafeInteger(req.dayId) && req.dayId>0) ||
    (req.action==='accountABillsConfigure' && fields(req,['action','queue']) && typeof req.queue==='string' && req.queue===req.queue.trim() && req.queue.length>0 && req.queue.length<=255 && !/[\x00-\x1f\x7f]/.test(req.queue)) ||
    (req.action==='accountABillsPrint' && fields(req,['action','dayId','digest','language','checked']) && Number.isSafeInteger(req.dayId) && req.dayId>0 && typeof req.digest==='string' && /^[0-9a-f]{64}$/.test(req.digest) && ['en','sq'].includes(req.language) && req.checked===true);
  if(!valid) return {ok:false};
  try {
    const actor=session.currentUserId(), scope=db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope;
    if(!actor || actor!==session.authenticatedUserId() || !['A','combined'].includes(scope) || !hasPermissions(db,session,'employees.view')) return {ok:false,denied:true};
    if(req.action==='accountABillsConfigure') {
      if(scope!=='combined' || !hasPermissions(db,session,'business_days.close')) return {ok:false,denied:true};
      db.prepare('UPDATE account_a_bill_print_settings SET queue=? WHERE id=1').run(req.queue); return {ok:true};
    }
    if(req.action==='accountABillsList') return {ok:true,data:{days:db.prepare('SELECT id,opened_at AS openedAt,closed_at AS closedAt FROM business_days ORDER BY id DESC').all(),queue:db.prepare('SELECT queue FROM account_a_bill_print_settings WHERE id=1').get().queue,canConfigure:scope==='combined' && hasPermissions(db,session,'business_days.close')}};
    const data=report(db,req.dayId), hash=digest(data);
    if(req.action==='accountABillsPreview') return {ok:true,data:{...data,digest:hash}};
    if(hash!==req.digest) return {ok:false,stale:true};
    if(flights.has(db)) return {ok:false,busy:true};
    const queue=db.prepare('SELECT queue FROM account_a_bill_print_settings WHERE id=1').get().queue;
    flights.add(db);
    try {
      const result=await adapter({destination:'account-a-bills',queue,snapshot:{...data,language:req.language}});
      return result==='accepted' ? {ok:true,accepted:true} : {ok:false,failed:true};
    } catch (_) { return {ok:false,uncertain:true}; }
    finally { flights.delete(db); }
  } catch (_) { return {ok:false}; }
}
module.exports={handle,report};
