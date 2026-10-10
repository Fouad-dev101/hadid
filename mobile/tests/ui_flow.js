// End-to-end UI test of the phone build (no Go server): serves mobile/www, drives it in jsdom with a fake IndexedDB.
//   node tools/build-www.js && node tests/ui_flow.js
require('fake-indexeddb/auto');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const www = path.resolve(__dirname, '..', 'www'), PORT = 5055, base = `http://localhost:${PORT}`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { const f = path.join(www, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(PORT);

const errs = [], sleep = ms => new Promise(r => setTimeout(r, ms));
async function launch(query) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errs.push('jsdomError: ' + (e.detail && e.detail.stack || e.message).split('\n').slice(0, 3).join(' | ')));
  vc.on('error', m => errs.push('console.error: ' + m));
  const dom = await JSDOM.fromURL(base + '/' + (query || ''), { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.indexedDB = indexedDB; w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;
      w.fetch = (u, o) => fetch(new URL(u, base), o); w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null; w.scrollTo = () => {};
      w.__saved = []; w.HadidSaveFile = async (name, data) => { w.__saved.push({ name, size: data.length }); };
    } });
  const w = dom.window, d = w.document, $ = s => d.querySelector(s);
  const t = { w, d, $, sleep,
    click: s => { const e = typeof s === 'string' ? $(s) : s; assert(e, 'missing ' + s); e.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); },
    input: (s, v) => { const e = $(s); assert(e, 'missing ' + s); e.value = v; e.dispatchEvent(new w.Event('input', { bubbles: true })); },
    go: async h => { w.location.hash = h; await sleep(450); },
    text: () => $('#view').textContent.replace(/\s+/g, ' ').trim(),
    api: (m, p, b) => w.HadidLocal.handle(m, p, b) };
  await sleep(1800);
  return t;
}

(async () => {
  // 1) every screen renders, using the demo data set
  let t = await launch('?demo=1');
  assert(t.$('#demo-badge') && !t.$('#demo-badge').hidden, 'demo badge visible');
  for (const r of ['/home', '/log', '/log/lift', '/log/run', '/log/basketball', '/log/other', '/history', '/prs', '/plates', '/live', '/live/1', '/library', '/routine', '/settings']) {
    await t.go(r); const x = t.text(); assert(!/Something went wrong/.test(x) && x.length > 40, 'render ' + r + ': ' + x.slice(0, 120)); console.log('ok   ', r);
  }
  const days = (await t.api('GET', '/days')).length; assert(days > 90, 'demo has history: ' + days); console.log('demo days:', days);
  t.w.close();

  // 2) fresh real install: first launch, log things, PR celebration
  t = await launch();
  assert((await t.api('GET', '/days')).length === 0, 'fresh install has no history (no personal seed)');
  await t.go('/log/lift');
  t.input('#lift-text', 'bench 60x8, 62.5x8'); t.click('.rpe button[data-v="7"]'); await sleep(100); t.click('#save'); await sleep(700);
  assert(!t.$('.pr-pop'), 'first ever log is a baseline, not a PR');
  await t.go('/log/lift');
  t.input('#lift-text', 'bench 70x8, 72.5x6'); t.click('.rpe button[data-v="8"]'); await sleep(100); t.click('#save'); await sleep(700);
  assert(t.$('.pr-pop'), 'heavier bench triggers the PR popup'); console.log('PR popup:', t.$('.pr-pop').textContent.replace(/\s+/g, ' ').slice(0, 90));
  t.click('[data-act=modal-close]'); await sleep(300);
  await t.go('/log/run'); t.input('[data-bind=km]', '5'); t.input('[data-bind=time]', '27:30'); t.click('#save'); await sleep(700);
  const before = (await t.api('GET', '/days')).length; assert.strictEqual(before, 3);
  await t.go('/settings'); t.click('[data-act=set][data-k=theme][data-v=light]'); await sleep(300);
  assert(t.text().includes('Everything stays on this phone'), 'phone wording in settings'); assert(!t.text().includes('Shortcuts'), 'no keyboard shortcuts card on phone');
  t.click('[data-act=backup]'); await sleep(300); assert(t.w.__saved.length === 1 && /^hadid-backup-.*\.db$/.test(t.w.__saved[0].name), 'backup hands a .db file to the saver');
  t.click('[data-act=export-csv]'); await sleep(300); assert(t.w.__saved[1].name.endsWith('.csv'), 'csv export');
  const snapshot = await t.w.HadidLocal.exportDB();
  t.w.close();

  // 3) "close and reopen the app": data and settings survive
  t = await launch();
  assert.strictEqual((await t.api('GET', '/days')).length, 3, 'data persisted across restart');
  assert.strictEqual((await t.api('GET', '/bootstrap')).settings.theme, 'light', 'settings persisted'); console.log('persisted across restart: ok');

  // 4) restore: log one more, then roll back to the snapshot
  await t.go('/log/other'); t.click('.rpe button[data-v="5"]'); t.click('#save'); await sleep(600);
  assert.strictEqual((await t.api('GET', '/days')).length, 4);
  const r = await t.w.HadidLocal.importDB(new Uint8Array(snapshot)); assert.strictEqual(r.activities, 3);
  assert.strictEqual((await t.api('GET', '/days')).length, 3, 'restore replaced the data');
  await assert.rejects(() => t.w.HadidLocal.importDB(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])), /not a Hadid backup/);
  console.log('backup + restore: ok');
  t.w.close();

  console.log('\nERRORS:', errs.length); errs.slice(0, 8).forEach(e => console.log(' -', e));
  console.log(errs.length ? 'UI FLOW FAIL' : 'UI FLOW OK'); srv.close(); process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error('UI FLOW FAIL:', e.message); errs.slice(0, 5).forEach(x => console.error(' -', x)); process.exit(1); });
