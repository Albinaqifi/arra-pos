const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('../../src/desktop/session');

function exerciseLauncher({work, base, sourceLedger, binding, deviceId, capture, desktop}) {
  const root = fs.mkdtempSync(path.join(work,'kit & (QA) '));
  const files = path.join(root,'scripts/bill6-card-recovery');
  const packaged = process.env.ARRA_QA_RECOVERY_KIT;
  const source = packaged ? path.join(packaged,'scripts/bill6-card-recovery') : path.join(__dirname,'../../scripts/bill6-card-recovery');
  const library = packaged ? path.join(packaged,'src/desktop') : desktop;
  const scripts = ['operator.cjs','recover.cjs','original.cjs','publish.cjs','journal.cjs','earlier-journal.cjs','device.cjs','start.ps1'];
  fs.mkdirSync(files,{recursive:true});
  for (const name of scripts) fs.copyFileSync(path.join(source,name),path.join(files,name));
  fs.copyFileSync(path.join(source,'serial.ps1'),path.join(files,'sender.ps1'));
  fs.copyFileSync(path.join(__dirname,'card-recovery-memory-port.ps1'),path.join(files,'serial.ps1'));
  const target = path.join(root,'src/desktop');
  fs.mkdirSync(target,{recursive:true});
  for (const name of ['pf700-frame','pf700-payment-registers','pf700-checkout-protocol','session','permissions','untouched-order']) {
    fs.copyFileSync(path.join(library,name+'.js'),path.join(target,name+'.js'));
  }
  if (packaged) {
    fs.copyFileSync(path.join(source,'reply.ps1'),path.join(files,'reply.ps1'));
    fs.copyFileSync(path.join(source,'edition.json'),path.join(files,'edition.json'));
  } else {
    const exchange=fs.readFileSync(path.join(library,'pf700-checkout-exchange.ps1'),'utf8');
    fs.writeFileSync(path.join(files,'reply.ps1'),exchange.slice(exchange.indexOf('function Read-Pf700CheckoutReply'),exchange.indexOf('function Invoke-Pf700CheckoutPort')));
    fs.writeFileSync(path.join(files,'edition.json'),JSON.stringify({reviewOnly:false}));
  }
  fs.writeFileSync(path.join(files,'incident.json'),JSON.stringify(binding));
  fs.mkdirSync(path.join(root,'runtime'));
  const runtime = packaged ? path.join(packaged,'runtime/node.exe') : process.execPath;
  fs.copyFileSync(runtime,path.join(root,'runtime/node.exe'));
  // Reproduce a deep Windows profile for every SQLite handle, including its
  // adjacent rollback journal. All directories belong to this disposable test.
  let data=root;
  while(data.length<250) data=path.join(data,'nested sample profile');
  const roaming = path.join(data,'roaming'), local = path.join(data,'local');
  const profile = path.join(roaming,'Arra POS PF700 Commissioning');
  const ledger = path.join(local,'Arra POS','PF700 commissioning','fast-pay-v1');
  fs.mkdirSync(profile,{recursive:true});
  fs.cpSync(sourceLedger,ledger,{recursive:true});
  fs.writeFileSync(path.join(path.dirname(ledger),createHash('sha256').update(deviceId).digest('hex')+'.used'),'');
  const database = path.join(profile,'arra.sqlite');
  fs.copyFileSync(base,database);
  const password = randomBytes(20).toString('hex');
  const mutate=fn=>{ const db=new DatabaseSync(path.toNamespacedPath(database));try {return fn(db);} finally {db.close();} };
  mutate(db=>{
    const salt=randomBytes(16);
    const credential=hashPassword(password,salt);
    for (const [username,scope] of [['sample-operator','combined'],['sample-unauthorized','A'],
      ['sample-no-grant','combined'],['sample-inactive','combined']]) {
      const id=db.prepare('INSERT INTO local_users(username,salt,password_hash,active) VALUES(?,?,?,?)')
        .run(username,salt,credential,username==='sample-inactive'?0:1).lastInsertRowid;
      db.prepare('INSERT INTO financial_scopes VALUES(?,?)').run(id,scope);
      if(username!=='sample-no-grant') db.prepare("INSERT INTO user_permissions VALUES(?,'business_days.close')").run(id);
    }
  });
  const transcript=path.join(root,'transcript.json'), commands=path.join(root,'commands.txt');
  fs.writeFileSync(transcript,JSON.stringify(capture));
  const hostScript=path.join(root,'sample-host.ps1');
  fs.writeFileSync(hostScript,[
    'param([string]$Launcher,[string]$Mode)',
    'function Read-Host([string]$Prompt,[switch]$AsSecureString) {',
    '  if ($AsSecureString) { $secret=[Security.SecureString]::new(); foreach ($c in $env:ARRA_QA_PASSWORD.ToCharArray()) { $secret.AppendChar($c) }; return $secret }',
    '  if ($Prompt -like "*username*") { return $env:ARRA_QA_USER }',
    '  return $env:ARRA_QA_DECISION',
    '}',
    '& $Launcher $Mode','exit $LASTEXITCODE'
  ].join('\r\n'));
  const run=(mode,user,pass,decision='')=>{
    fs.writeFileSync(commands,'');
    const outcome=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',hostScript,path.join(files,'start.ps1'),mode],
      {windowsHide:true,timeout:30000,encoding:'utf8',env:{...process.env,APPDATA:roaming,LOCALAPPDATA:local,
        ARRA_QA_TRANSCRIPT:transcript,ARRA_QA_COMMANDS:commands,ARRA_QA_USER:user,ARRA_QA_PASSWORD:pass,ARRA_QA_DECISION:decision}});
    assert.ifError(outcome.error);
    return {out:outcome.stdout,status:outcome.status,writes:fs.readFileSync(commands,'utf8').split(/\s+/).filter(Boolean).map(Number)};
  };
  const reader=[90,90,113,76,103,97,67,110];
  for (const [user,pass] of [['sample-operator',randomBytes(20).toString('hex')],['sample-unauthorized',password],
    ['sample-no-grant',password],['sample-inactive',password]]) {
    const stopped=run('Review',user,pass);
    assert.match(stopped.out,/HOLD_COMBINED_SIGN_IN/);
    assert.equal(stopped.status,1);
    assert.deepEqual(stopped.writes,[]);
  }
  const reviewed=run('Review','sample-operator',password);
  assert.match(reviewed.out,/REVIEW PASSED/);
  assert.equal(reviewed.status,0);assert.deepEqual(reviewed.writes,reader);
  const cancelled=run('Finish','sample-operator',password);
  if (JSON.parse(fs.readFileSync(path.join(files,'edition.json'))).reviewOnly) {
    assert.match(cancelled.out,/HOLD_REVIEW_ONLY_EDITION/);
    assert.equal(cancelled.status,1);assert.deepEqual(cancelled.writes,[]);return;
  }
  assert.match(cancelled.out,/Cancelled before fiscal printing/);
  assert.deepEqual(cancelled.writes,reader);
  const proven=run('Finish','sample-operator',password,'FINISH '+binding.billId);
  assert.match(proven.out,/RESULT confirmed 0000032/);
  assert.equal(proven.status,0);
  assert.deepEqual(proven.writes,[...reader,...reader,49,49,76,103,53,76,56,76,113,67,110]);
  const repeated=run('Finish','sample-operator',password,'FINISH '+binding.billId);
  assert.match(repeated.out,/RESULT already-confirmed 0000032/);assert.deepEqual(repeated.writes,[]);
  mutate(db=>{
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payments WHERE method='card' AND account='A'").get().n,1);
    const actor=db.prepare("SELECT id FROM local_users WHERE username='sample-operator'").get().id;
    assert.equal(db.prepare('SELECT recovered_by FROM card_receipt_incident_proof').get().recovered_by,actor);
  });
}
module.exports={exerciseLauncher};
