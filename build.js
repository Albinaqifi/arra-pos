const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = __dirname;
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/renderer-entry.js')],
  bundle: true,
  format: 'iife',
  outfile: path.join(output, 'renderer-entry.js'),
  charset: 'utf8',
});
for (const [source, destination] of [
  ['index.html', 'index.html'],
  ['demo.html', 'demo.html'],
  ['src/styles.css', 'styles.css'],
  ['vendor/react.js', 'react.js'],
  ['vendor/react-dom.js', 'react-dom.js'],
]) fs.copyFileSync(path.join(root, source), path.join(output, destination));
// Remove only the obsolete outputs from the former script-order build.
for (const name of ['admin-shell.js', 'App.js', 'waiter-tables.js', 'waiter-order.js', 'waiter-move-table.js', 'waiter-bill.js', 'waiter-desktop-bill.js', 'desktop-status.js']) {
  fs.rmSync(path.join(output, name), { force: true });
}
