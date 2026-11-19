'use strict';

// node scripts/build-bill2-recovery.cjs <owner journal SHA-256 file> <new ZIP>
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

function build(pinFile, outputFile) {
  if (process.platform !== 'win32' || !pinFile || !outputFile || !/\.zip$/i.test(outputFile)) {
    throw Error('Provide a journal SHA-256 file and a new output ZIP on Windows.');
  }
  const root = path.resolve(__dirname, '..');
  const output = path.resolve(outputFile);
  if (fs.existsSync(output)) throw Error('Choose a new ZIP filename.');
  const pin = fs.readFileSync(pinFile, 'utf8').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(pin)) throw Error('A SHA-256 digest is required.');
  const runtime = path.join(root, 'node_modules', 'electron', 'dist');
  if (fs.readFileSync(path.join(runtime, 'version'), 'utf8').trim() !== require('../package.json').devDependencies.electron) {
    throw Error('Use the pinned Electron runtime.');
  }
  require('../build');
  const parent = fs.realpathSync(path.dirname(output));
  const work = fs.mkdtempSync(path.join(parent, '.bill2-build-'));
  try {
    const kit = path.join(work, 'kit');
    const program = path.join(kit, 'program');
    const app = path.join(program, 'resources', 'app');
    fs.cpSync(runtime, program, {recursive:true, filter: file => file !== path.join(runtime, 'resources')});
    fs.mkdirSync(app, {recursive:true});
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({
      name:'arra-bill-2-recovery', productName:'Arra POS Bill 2 Recovery', version:'1.0.0', main:'main.cjs'
    }));
    esbuild.buildSync({
      entryPoints:[path.join(__dirname, 'bill2-recovery', 'main.js')], outfile:path.join(app, 'main.cjs'),
      platform:'node', bundle:true, external:['electron'], define:{APPROVED_JOURNAL_SHA256:JSON.stringify(pin)}
    });
    fs.copyFileSync(path.join(root, 'src', 'desktop', 'preload.js'), path.join(app, 'preload.js'));
    fs.mkdirSync(path.join(app, 'dist'));
    for (const file of ['index.html', 'react-dom.js', 'react.js', 'renderer-entry.js', 'styles.css']) {
      fs.copyFileSync(path.join(root, 'dist', file), path.join(app, 'dist', file));
    }
    fs.copyFileSync(path.join(__dirname, 'bill2-recovery', 'Open-Bill-2.cmd'), path.join(kit, 'Open-Bill-2.cmd'));
    const archive = path.join(work, 'release.zip');
    const tar = path.join(process.env.SystemRoot, 'System32', 'tar.exe');
    execFileSync(tar, ['-a', '-c', '-f', archive, '-C', kit, 'Open-Bill-2.cmd', 'program'], {stdio:'inherit'});
    fs.copyFileSync(archive, output, fs.constants.COPYFILE_EXCL);
  } finally {
    const actual = fs.realpathSync(work);
    if (path.dirname(actual) === parent && path.basename(actual).startsWith('.bill2-build-')) {
      fs.rmSync(actual, {recursive:true});
    }
  }
  console.log('Created', output);
}

if (require.main === module) {
  if (process.argv.length !== 4) throw Error('Expected a journal SHA-256 file and a new output ZIP filename.');
  build(process.argv[2], process.argv[3]);
}
