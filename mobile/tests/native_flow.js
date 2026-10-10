// Checks the Android glue (native.js) with a stubbed Capacitor: share-sheet saving, back button, rest notification.
//   node tools/build-www.js && node tests/native_flow.js
require('fake-indexeddb/auto');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const www = path.resolve(__dirname, '..', 'www'), PORT = 5056, base = `http://localhost:${PORT}`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { const p = q.url.split('?')[0]; const f = path.join(www, p === '/' ? 'index.html' : p); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(PORT);
const sleep = ms => new Promise(r => setTimeout(r, ms)), errs = [];

(async () => {
  const calls = [], L = {};
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push(String(e.detail && e.detail.stack || e.message).split('\n')[0]));
  const dom = await JSDOM.fromURL(base + '/', { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc, beforeParse(w) {
    w.indexedDB = indexedDB; w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder; w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
    w.HTMLCanvasElement.prototype.getContext = () => null; w.scrollTo = () => {};
    w.Capacitor = { Plugins: {
      Filesystem: { writeFile: async o => { calls.push(['writeFile', o]); return { uri: 'file:///cache/' + o.path }; } },
      Share: { share: async o => { calls.push(['share', o]); } },
      App: { addListener: (ev, cb) => { L[ev] = cb; }, exitApp: () => calls.push(['exitApp']) },
      LocalNotifications: { requestPermissions: async () => calls.push(['perm']), createChannel: async o => calls.push(['channel', o]), schedule: async o => calls.push(['schedule', o]), cancel: async o => calls.push(['cancel', o]) },
    } };
  } });
  const w = dom.window, d = w.document, $ = s => d.querySelector(s);
  await sleep(1800);
  assert(d.documentElement.classList.contains('native'), 'native mode detected');

  // backup goes through the share sheet as a real SQLite file
  w.location.hash = '/settings'; await sleep(450);
  $('[data-act=backup]').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await sleep(500);
  const wf = calls.find(c => c[0] === 'writeFile'), sh = calls.find(c => c[0] === 'share');
  assert(wf && /^hadid-backup-.*\.db$/.test(wf[1].path) && wf[1].directory === 'CACHE', 'writes backup to cache');
  assert(Buffer.from(wf[1].data, 'base64').slice(0, 15).toString() === 'SQLite format 3', 'backup is a real SQLite file');
  assert(sh && sh[1].files[0] === 'file:///cache/' + wf[1].path, 'share sheet opened with the file'); console.log('backup share: ok');

  // back button: modal -> closes it, other screen -> home, home -> exit
  w.location.hash = '/plates'; await sleep(400);
  L.backButton({ canGoBack: true }); await sleep(400); assert.strictEqual(w.location.hash, '#/home', 'back from a screen goes home');
  w.eval('modal(H`<p>hi</p>`)'); await sleep(100); assert($('#modal').classList.contains('open'));
  L.backButton({}); await sleep(100); assert(!$('#modal').classList.contains('open'), 'back closes the open sheet');
  L.backButton({}); assert(calls.some(c => c[0] === 'exitApp'), 'back on home exits'); console.log('back button: ok');

  // rest timer: nothing while foreground, schedule on background, cancel on return
  w.restStart(90, 'Bench'); await sleep(200);
  assert(calls.some(c => c[0] === 'perm') && calls.some(c => c[0] === 'channel'), 'asked for notification permission on first rest');
  const n0 = calls.filter(c => c[0] === 'schedule').length; assert.strictEqual(n0, 0, 'no notification while the app is open');
  await L.appStateChange({ isActive: false });
  const sch = calls.filter(c => c[0] === 'schedule'); assert.strictEqual(sch.length, 1, 'scheduled when backgrounded');
  const at = new Date(sch[0][1].notifications[0].schedule.at).getTime(); assert(Math.abs(at - (Date.now() + 90000)) < 4000, 'fires when the rest ends');
  await L.appStateChange({ isActive: true }); assert(calls.filter(c => c[0] === 'cancel').length >= 1, 'cancelled on return');
  w.restStop(); console.log('rest notification: ok');

  console.log('ERRORS:', errs.length); errs.forEach(e => console.log(' -', e));
  console.log(errs.length ? 'NATIVE FAIL' : 'NATIVE OK'); srv.close(); process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error('NATIVE FAIL:', e.message); process.exit(1); });
