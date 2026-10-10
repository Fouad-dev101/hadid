'use strict';
// Builds mobile/www: the same web UI as the desktop app plus the in-app database.
//   node tools/build-www.js
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..'), web = path.resolve(root, '..', 'web'), out = path.join(root, 'www');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(web, out, { recursive: true });
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });

const dist = path.join(root, 'node_modules', 'sql.js', 'dist');
fs.copyFileSync(path.join(dist, 'sql-wasm.js'), path.join(out, 'vendor', 'sql-wasm.js'));
// the wasm travels inside a script so no fetch / MIME-type problem can stop it loading in a WebView
fs.writeFileSync(path.join(out, 'vendor', 'sql-wasm-bin.js'), 'window.HADID_WASM_B64="' + fs.readFileSync(path.join(dist, 'sql-wasm.wasm')).toString('base64') + '";');
fs.copyFileSync(path.join(root, 'src', 'store.js'), path.join(out, 'js', 'store.js'));
fs.copyFileSync(path.join(root, 'src', 'local-boot.js'), path.join(out, 'js', 'local-boot.js'));
fs.copyFileSync(path.join(root, 'src', 'native.js'), path.join(out, 'js', 'native.js'));

let html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const inject = ['/vendor/sql-wasm.js', '/vendor/sql-wasm-bin.js', '/js/store.js', '/js/local-boot.js', '/js/native.js'].map(s => `<script src="${s}"></script>`).join('\n');
if (!html.includes('<script src="/js/app.js"></script>')) throw new Error('index.html changed: cannot find the app.js script tag');
html = html.replace('<script src="/js/app.js"></script>', inject + '\n<script src="/js/app.js"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('www built:', out, '(' + Math.round(fs.readdirSync(path.join(out, 'vendor')).reduce((n, f) => n + fs.statSync(path.join(out, 'vendor', f)).size, 0) / 1024) + ' KB vendor)');
