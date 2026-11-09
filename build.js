const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = __dirname;
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/admin/index.js')],
  bundle: true,
  format: 'iife',
  globalName: 'ArraComponents',
  outfile: path.join(output, 'admin-shell.js'),
  charset: 'utf8',
});
for (const [source, destination] of [
  ['index.html', 'index.html'],
  ['demo.html', 'demo.html'],
  ['src/App.js', 'App.js'],
  ['src/waiter/Tables.js', 'waiter-tables.js'],
  ['src/waiter/Order.js', 'waiter-order.js'],
  ['src/waiter/MoveTable.js', 'waiter-move-table.js'],
  ['src/waiter/Bill.js', 'waiter-bill.js'],
  ['src/waiter/DesktopBill.js', 'waiter-desktop-bill.js'],
  ['src/styles.css', 'styles.css'],
  ['src/desktop-status.js', 'desktop-status.js'],
  ['vendor/react.js', 'react.js'],
  ['vendor/react-dom.js', 'react-dom.js'],
]) fs.copyFileSync(path.join(root, source), path.join(output, destination));
