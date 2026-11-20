'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {hold,wire,preflight,complete}=require('./device.cjs');
const {hash}=require('./original.cjs');

function journalPath(dir,s) {
  return path.join(dir,hash(['card-recovery',s.deviceId,s.previousDocument])+'.recovery.sqlite');
}
function reserve(file,s,actorId,observations) {
  // Existence, even an empty file left by a crash, permanently spends this attempt.
  const fd=fs.openSync(file,'wx');
  try { fs.fsyncSync(fd); } finally {fs.closeSync(fd);}
  const db=new DatabaseSync(path.toNamespacedPath(file));
  try {
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;
      CREATE TABLE claim(id INTEGER PRIMARY KEY CHECK(id=1),fingerprint TEXT NOT NULL,actor INTEGER NOT NULL,at INTEGER NOT NULL) STRICT;
      CREATE TABLE events(n INTEGER PRIMARY KEY,stage TEXT NOT NULL,entry TEXT NOT NULL) STRICT;
      CREATE TABLE proof(id INTEGER PRIMARY KEY CHECK(id=1),details TEXT NOT NULL,at INTEGER NOT NULL) STRICT;`);
    for (const name of ['claim','events','proof']) {
      for (const op of ['UPDATE','DELETE']) db.exec(`CREATE TRIGGER ${name}_no_${op} BEFORE ${op} ON ${name}
        BEGIN SELECT RAISE(ABORT,'Recovery history is immutable'); END`);
      const key=name==='events'?'n':'id';
      db.exec(`CREATE TRIGGER ${name}_no_replace BEFORE INSERT ON ${name} WHEN EXISTS(
        SELECT 1 FROM ${name} WHERE ${key}=NEW.${key})
        BEGIN SELECT RAISE(ABORT,'Recovery history is immutable'); END`);
    }
    db.exec(`CREATE TRIGGER events_seal BEFORE INSERT ON events WHEN EXISTS(SELECT 1 FROM proof)
      BEGIN SELECT RAISE(ABORT,'Recovery proof is sealed'); END`);
    db.prepare('INSERT INTO claim VALUES(1,?,?,?)').run(s.fingerprint,actorId,Date.now());
    const insert=db.prepare('INSERT INTO events(stage,entry) VALUES(?,?)');
    const record=(stage,entry)=>insert.run(stage,JSON.stringify(entry));
    for (const row of observations) record(row.stage,row.entry);
    db.exec('COMMIT');
    return {record,finish(p){db.prepare('INSERT INTO proof VALUES(1,?,?)').run(JSON.stringify(p),Date.now());},close(){db.close();}};
  } catch(error) {db.close();throw error;}
}
async function readProof(file,s) {
  hold(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(),'RECOVERY_JOURNAL');
  const db=new DatabaseSync(path.toNamespacedPath(file),{readOnly:true});
  try {
    const claim=db.prepare('SELECT * FROM claim WHERE id=1').get();
    const proof=db.prepare('SELECT * FROM proof WHERE id=1').get();
    hold(claim && claim.fingerprint===s.fingerprint && proof,'CLAIMED_NO_COMPLETE_PROOF');
    const rows=db.prepare('SELECT * FROM events ORDER BY n').all();
    hold(rows.length>0 && rows.length<=128 && rows.length%2===0,'EVIDENCE_SEQUENCE');
    let n=0;
    const entries=rows.map(row=>({...row,entry:JSON.parse(row.entry)}));
    const first=entries[0].entry.sequence;
    hold(Number.isInteger(first) && first>=0x20 && first<=0x7f,'EVIDENCE_SEQUENCE');
    const send=wire(async ()=>Buffer.from(entries[n].entry.frame,'hex'),async (stage,e)=>{
      const row=entries[n++];
      hold(row && row.n===n && stage===row.stage && row.entry.hash===e.hash &&
        row.entry.sequence===e.sequence && row.entry.command===e.command,'EVIDENCE_REPLAY');
    },first);
    const before=await preflight(send,s);
    const result=await complete(send,s,before);
    hold(n===entries.length && hash(result)===hash(JSON.parse(proof.details)) &&
      Number.isSafeInteger(claim.actor) && claim.actor>0 && Number.isSafeInteger(claim.at) &&
      claim.at>=s.finishedAt && Number.isSafeInteger(proof.at) && proof.at>=claim.at,'EVIDENCE_RESULT');
    return {result,finished:proof.at,started:claim.at,actor:claim.actor,traceHash:hash(entries)};
  } finally { db.close(); }
}
module.exports={journalPath,reserve,readProof};
