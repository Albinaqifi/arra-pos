const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = __dirname;
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/AdminShell.jsx')],
  bundle: true,
  format: 'iife',
  globalName: 'ArraComponents',
  outfile: path.join(output, 'admin-shell.js'),
  charset: 'utf8',
});
for (const [source, destination] of [
  ['index.html', 'index.html'],
  ['src/App.js', 'App.js'],
  ['src/styles.css', 'styles.css'],
  ['src/desktop-status.js', 'desktop-status.js'],
  ['vendor/react.js', 'react.js'],
  ['vendor/react-dom.js', 'react-dom.js'],
]) fs.copyFileSync(path.join(root, source), path.join(output, destination));
