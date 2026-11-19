'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

function openPipe() {
  if (process.platform !== 'win32') throw Error('The live check requires Windows.');
  const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(executable, ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
    '-File',path.join(__dirname, 'journal-exchange.ps1')], { windowsHide:true, stdio:['pipe','pipe','ignore'], timeout:180000 });
  child.on('error', () => {}); child.stdin.on('error', () => {});
  const done = new Promise(resolve => child.once('close', resolve));
  const iterator = readline.createInterface({ input:child.stdout, crlfDelay:Infinity })[Symbol.asyncIterator]();
  return {
    async exchange(frame) {
      child.stdin.write(frame.toString('hex') + '\n');
      const line = await iterator.next();
      if (line.done || !/^(?:[0-9A-F]{2}){17,101}$/.test(line.value)) throw Error('The printer exchange failed or was incomplete. Stop.');
      return Buffer.from(line.value, 'hex');
    },
    async close() { child.stdin.end(); await done; }
  };
}

module.exports = { openPipe };
