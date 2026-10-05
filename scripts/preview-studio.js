// Local UI fixture: real Studio sources and companion CSS, simulated model only.
// Run: node scripts/preview-studio.js 8766
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'weld-companion.user.js'), 'utf8');
let css;
const start = source.indexOf('  GM_addStyle([');
const end = source.indexOf("].join('\\n'));", start) + "].join('\\n'));".length;
vm.runInNewContext(source.slice(start, end), { GM_addStyle: value => { css = value; } });
const el = source.slice(source.indexOf('  function el('), source.indexOf('  function $('));
const routes = {
  '/': ['text/html', fs.readFileSync(path.join(root, 'tests/fixtures/studio.html'), 'utf8')],
  '/style.css': ['text/css', css],
  '/el.js': ['text/javascript', el],
  '/core.js': ['text/javascript', fs.readFileSync(path.join(root, 'src/studio-core.js'), 'utf8')],
  '/dad.js': ['text/javascript', fs.readFileSync(path.join(root, 'src/studio-dad.js'), 'utf8')],
  '/ui.js': ['text/javascript', fs.readFileSync(path.join(root, 'src/studio-ui.js'), 'utf8')]
};
const server = http.createServer((req, res) => {
  const route = routes[req.url];
  if (!route || req.method !== 'GET') { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': route[0] + '; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(route[1]);
});
server.listen(Number(process.argv[2] || 8766), '127.0.0.1', () => console.log('Studio fixture: http://127.0.0.1:' + server.address().port));
