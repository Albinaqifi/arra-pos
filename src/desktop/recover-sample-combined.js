// Sample-only isolated provisioning. Credentials are entered interactively.
const readline = require('node:readline');
const { recoverSampleCombined } = require('./sample-combined-recovery');
if (process.argv.length !== 3 || !process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run interactively: node src/desktop/recover-sample-combined.js <absolute-path-to-sample-arra.sqlite>');
  process.exit(1);
}
console.log('SAMPLE DATA ONLY. This provisions Combined on a new isolated copy, never on the original.');
const rl=readline.createInterface({input:process.stdin,output:process.stdout});
rl.question('Existing sample administrator username: ',username=>{
  rl.close(); process.stdout.write('Existing sample administrator password: ');
  readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume(); let password='';
  process.stdin.on('keypress',async(char,key)=>{
    if (key.ctrl && key.name==='c') { process.stdin.setRawMode(false); process.exit(1); }
    if (key.name==='return' || key.name==='enter') {
      process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n');
      try { const directory=await recoverSampleCombined(process.argv[2],username,password); console.log(`Combined sample copy: ${directory}`); console.log(`Launch with: npx electron . --sample-data-directory="${directory}"`); }
      catch (_) { console.error('Sample provisioning failed. Verify the administrator, sample data and absence of owner scopes.'); process.exitCode=1; }
      finally { password=''; }
    } else if (key.name==='backspace') password=password.slice(0,-1);
    else if (char && !key.ctrl && !key.meta && password.length<1024) password+=char;
  });
});
