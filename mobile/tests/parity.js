// Runs the same scenario against the Go server and the JS store and compares the answers.
// Usage: start a NON-demo Go instance (HADID_DIR=/tmp/hd2 ./hadid --nowindow), then
//   node tests/parity.js http://127.0.0.1:PORT
const assert = require('assert');
const initSqlJs = require('sql.js');
const { createStore } = require('../src/store.js');
const base = process.argv[2] || 'http://127.0.0.1:47821';

const goApi = async (method, path, body) => {
  const r = await fetch(base + '/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null); if (!r.ok) throw new Error(j && j.error || r.statusText); return j;
};
const strip = x => JSON.parse(JSON.stringify(x, (k, v) => (k === 'created_at' || k === 'now' || k === 'today' || k === 'dataDir' || k === 'local' || k === 'version' ? undefined : v)));
const D = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

(async () => {
  const SQL = await initSqlJs();
  const js = createStore({ SQL });
  await js.ready;
  const both = async (method, path, body) => { const [a, b] = await Promise.all([goApi(method, path, body), js.handle(method, path, body)]); return [a, b]; };

  // clear the desktop app's personal "Starting numbers" seed so both sides start equal
  for (const a of await goApi('GET', '/activities')) await goApi('DELETE', '/activities/' + a.id);

  // the Go side used ids 1 (activity) and 1-7 (sets) for the seed we just deleted; burn the same ids here
  { const d = await js.handle('POST', '/activities', { id: 0, day: D(0), kind: 'lift', subtype: 'x', sets: [1, 2, 3, 4, 5, 6, 7].map(n => ({ exercise_id: 1, w10: 100, reps: n })) });
    await js.handle('DELETE', '/activities/' + d.id); }
  const ex = (await goApi('GET', '/bootstrap')).exercises; const id = n => ex.find(e => e.name === n).id;
  const bench = id('Flat barbell bench press'), row = id('Barbell row'), pu = id('Pull-ups');
  const L = (day, sets, extra) => ({ id: 0, day, kind: 'lift', subtype: 'Chest & Back', duration_min: 60, rpe: 8, sets, ...extra });
  const S = (e, w10, reps, kind, grp) => ({ exercise_id: e, w10, reps, kind: kind || 'work', grp: grp || 0 });

  const script = [
    L(D(30), [S(bench, 600, 8), S(bench, 600, 8), S(row, 500, 10), S(pu, 0, 8)]),
    L(D(23), [S(bench, 600, 9), S(bench, 650, 6), S(row, 500, 10), S(pu, 0, 9)]),
    L(D(16), [S(bench, 400, 10, 'warm'), S(bench, 650, 8), S(bench, 700, 3), S(row, 550, 8, 'drop'), S(pu, 0, 9, 'work', 1)]),
    { id: 0, day: D(15), kind: 'run', subtype: 'tempo', duration_min: 27, rpe: 8, dist_m: 5000, felt: 4 },
    { id: 0, day: D(14), kind: 'basketball', subtype: 'game', duration_min: 35, rpe: 9, explosive: 1, points: 14 },
    L(D(9), [S(bench, 700, 5), S(bench, 700, 5), S(row, 600, 8)]),
    L(D(20), [S(bench, 800, 2)]),               // back-dated session triggers a rebuild
  ];
  for (const s of script) { const [a, b] = await both('POST', '/activities', s); assert.deepStrictEqual(strip(b), strip(a), 'POST /activities ' + s.day); }
  const first = await goApi('GET', '/activities'); const target = first.find(a => a.day === D(9));
  const edit = L(D(9), [S(bench, 725, 5), S(row, 600, 8)], { id: target.id });
  { const [a, b] = await both('POST', '/activities', edit); assert.deepStrictEqual(strip(b), strip(a), 'edit'); }
  await both('POST', '/rest', { day: D(8) }); await both('POST', '/rest', { day: D(8) });
  await both('PUT', '/settings', { units: 'lb', bogus: 'x' });
  await both('POST', '/exercises', { id: 0, name: 'Zottman curl', muscle: 'biceps', rest_sec: 5, aliases: 'zot' });
  await both('POST', '/templates', { id: 0, name: 'Arms', items: [id('Hammer curls'), id('EZ-bar curls')] });
  await both('PUT', '/schedule', { rows: [{ dow: 3, template_id: null, label: 'Rest' }] });

  const checks = ['/bootstrap', '/activities', '/activities?from=' + D(16) + '&to=' + D(9), '/days', '/prs', '/ghosts?before=' + D(0), '/ghosts?before=' + D(12), '/lastlift?subtype=Chest%20%26%20Back&before=' + D(0), '/lastlift?subtype=Nope'];
  for (const c of checks) { const [a, b] = await both('GET', c); assert.deepStrictEqual(strip(b), strip(a), 'GET ' + c); console.log('same  GET', c.slice(0, 60)); }

  // delete a session in the middle: PR history must be rebuilt identically
  const mid = (await goApi('GET', '/activities')).find(a => a.day === D(23));
  await both('DELETE', '/activities/' + mid.id);
  for (const c of ['/prs', '/ghosts?before=' + D(0)]) { const [a, b] = await both('GET', c); assert.deepStrictEqual(strip(b), strip(a), 'after delete ' + c); console.log('same  GET', c.slice(0, 40), '(after delete)'); }

  // delete used exercise archives it, unused one is removed
  { const [a, b] = await both('DELETE', '/exercises/' + bench); assert.deepStrictEqual(a, b); console.log('same  archive used exercise', JSON.stringify(a)); }
  { const z = (await goApi('GET', '/bootstrap')).exercises.find(e => e.name === 'Zottman curl'); const [a, b] = await both('DELETE', '/exercises/' + z.id); assert.deepStrictEqual(a, b); console.log('same  delete unused exercise', JSON.stringify(a)); }

  // CSV
  const goCsv = await (await fetch(base + '/api/export.csv')).text();
  const norm = t => t.replace(/^\ufeff/, '').replace(/\r\n/g, '\n'); // fetch().text() drops the BOM, so compare without it
  assert.ok(js.exportCSV().startsWith('\ufeff'), 'csv keeps the BOM for Excel');
  assert.strictEqual(norm(js.exportCSV()), norm(goCsv), 'csv');
  console.log('same  CSV (' + goCsv.split('\n').length + ' lines)');

  // errors
  for (const bad of [{ day: 'x', kind: 'lift' }, { day: D(1), kind: 'dance' }]) {
    const [ge, je] = await Promise.all([goApi('POST', '/activities', bad).catch(e => e.message), js.handle('POST', '/activities', bad).catch(e => e.message)]);
    assert.strictEqual(je, ge); console.log('same  error:', ge);
  }
  console.log('\nPARITY OK');
})().catch(e => { console.error('\nPARITY FAIL:', e.message); if (e.actual !== undefined) { console.error('js :', JSON.stringify(e.actual).slice(0, 700)); console.error('go :', JSON.stringify(e.expected).slice(0, 700)); } process.exit(1); });
