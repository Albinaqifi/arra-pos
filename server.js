const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, 'dist');
const portArg = process.argv.slice(2);
if (portArg.length !== 0 && (portArg.length !== 2 || portArg[0] !== '--port' || !/^\d+$/.test(portArg[1]) || Number(portArg[1]) < 1 || Number(portArg[1]) > 65535)) {
  console.error('Usage: node server.js --port <1-65535>');
  process.exit(1);
}
const port = portArg.length ? Number(portArg[1]) : 3000;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + (pathname === '/' ? '/demo.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Try node server.js --port 3001 (or another available port).`);
  } else {
    console.error(`Could not start demo server: ${err.message}`);
  }
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Arra POS demo: http://localhost:${port}`));
