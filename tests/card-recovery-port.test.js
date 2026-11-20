'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

test('the Windows recovery sender will only write its ordered incident frames', {skip:process.platform!=='win32'},()=>{
  const root=path.resolve(__dirname,'..');
  const result=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'support/card-recovery-port.ps1'),
      path.join(root,'scripts/bill6-card-recovery/serial.ps1')],{encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(result.status,0,result.stderr || result.error?.message);
  assert.match(result.stdout,/passed on a memory port/);
});
