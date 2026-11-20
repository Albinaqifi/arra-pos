'use strict';
const fs=require('node:fs');
const {original,hash,checkOpenWindow}=require('./original.cjs');
const {hold,wire,preflight,complete}=require('./device.cjs');
const {journalPath,reserve,readProof}=require('./journal.cjs');
const {already,publish,promoteIfAvailable,assertReadyToPublish}=require('./publish.cjs');

async function runRecovery({db,ledgerDir,binding,actorId,exchange,confirm,reauthorize,reviewOnly}) {
  hold(db && !db.isTransaction && Number.isSafeInteger(actorId) && actorId>0 && typeof exchange==='function' &&
    typeof reauthorize==='function' && typeof reviewOnly==='boolean' &&
    (reviewOnly || typeof confirm==='function'),'RECOVERY_PROFILE');
  const authorize=async ()=>hold(await reauthorize()===true,'OPERATOR');
  let marker,spent=false;
  try {
    db.exec(reviewOnly?'BEGIN':'BEGIN IMMEDIATE');
    await authorize();
    const s=original(db,ledgerDir,binding,false), file=journalPath(ledgerDir,s);
    const details={billId:s.billId,total:s.total,lines:s.lines,previousDocument:s.previousDocument,earlierCounters:s.earlierCounters};
    // Exclusive worker lock is held by the launcher throughout. A durable external claim
    // prevents resending even when the POS database has been rolled back or restored.
    if (fs.existsSync(file)) {
      spent=true;
      const packet=await readProof(file,s);
      const published=already(db,s,packet);
      if (!published) {
        checkOpenWindow(db,s);
        if (!reviewOnly) { await authorize();publish(db,s,packet,actorId); }
      } else if (!reviewOnly) {
        await authorize();
        promoteIfAvailable(db,s,packet,actorId);
      }
      db.exec(reviewOnly?'ROLLBACK':'COMMIT');
      return {status:published?'already-confirmed':reviewOnly?'awaiting-local-publication':'confirmed',documentNumber:packet.result.documentNumber};
    }
    hold(original(db,ledgerDir,binding).fingerprint===s.fingerprint,'BILL_CHANGED');
    assertReadyToPublish(db,s);
    let trace=[],deviceSend=wire(exchange,async (stage,entry)=>{
      if (marker) marker.record(stage,entry);
      else trace.push({stage,entry});
    });
    const before=await preflight(deviceSend,s);
    if (reviewOnly || !(await confirm(details))) {
      db.exec('ROLLBACK');
      return {status:reviewOnly?'reviewed':'cancelled'};
    }
    await authorize();
    hold(original(db,ledgerDir,binding).fingerprint===s.fingerprint,'BILL_CHANGED');
    assertReadyToPublish(db,s);
    trace=[];
    const fresh=await preflight(deviceSend,s);
    hold(hash(fresh)===hash(before),'PREFLIGHT_CHANGED');
    await authorize();
    marker=reserve(file,s,actorId,trace);
    spent=true;
    const proof=await complete(deviceSend,s,fresh);
    marker.finish(proof);marker.close();marker=null;
    const packet=await readProof(file,s);
    await authorize();
    publish(db,s,packet,actorId);
    db.exec('COMMIT');
    return {status:'confirmed',documentNumber:packet.result.documentNumber};
  } catch(error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    if (/^HOLD_[A-Z_]+$/.test(error.message)) throw error;
    throw Error(spent?'HOLD_CLAIMED_CHECK_ORIGINAL':'HOLD_INCONCLUSIVE');
  } finally { marker?.close(); }
}
module.exports={runRecovery};
