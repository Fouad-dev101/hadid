'use strict';
/*
 * Hadid local store: the Go backend (db.go, api.go, prs.go, demo.go) rewritten in JS
 * on top of sql.js (SQLite compiled to WebAssembly). The web UI calls
 * `HadidLocal.handle(method, path, body)` instead of fetch('/api' + path).
 * Same routes, same JSON shapes, same schema, so a .db file is the same format
 * as the desktop app's hadid.db.
 */
(function (root) {
  const APP_VERSION = '0.1.0';

  const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS exercises(
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, muscle TEXT NOT NULL DEFAULT 'other',
      muscles2 TEXT NOT NULL DEFAULT '', equipment TEXT NOT NULL DEFAULT 'barbell', rest_sec INTEGER NOT NULL DEFAULT 90,
      aliases TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS activities(
      id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, kind TEXT NOT NULL, subtype TEXT NOT NULL DEFAULT '',
      duration_min INTEGER NOT NULL DEFAULT 0, rpe INTEGER NOT NULL DEFAULT 0, dist_m INTEGER NOT NULL DEFAULT 0,
      felt INTEGER NOT NULL DEFAULT 0, explosive INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '')`,
    `CREATE INDEX IF NOT EXISTS idx_act_day ON activities(day)`,
    `CREATE TABLE IF NOT EXISTS sets(
      id INTEGER PRIMARY KEY AUTOINCREMENT, activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      exercise_id INTEGER NOT NULL REFERENCES exercises(id), pos INTEGER NOT NULL, grp INTEGER NOT NULL DEFAULT 0,
      w10 INTEGER NOT NULL DEFAULT 0, reps INTEGER NOT NULL DEFAULT 0, rpe10 INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'work', note TEXT NOT NULL DEFAULT '')`,
    `CREATE INDEX IF NOT EXISTS idx_sets_ex ON sets(exercise_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sets_act ON sets(activity_id)`,
    `CREATE TABLE IF NOT EXISTS prs(
      id INTEGER PRIMARY KEY AUTOINCREMENT, exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
      activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE, day TEXT NOT NULL, kind TEXT NOT NULL,
      value INTEGER NOT NULL, w10 INTEGER NOT NULL DEFAULT 0, reps INTEGER NOT NULL DEFAULT 0, prev INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS templates(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS template_items(
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE, pos INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS schedule(
      dow INTEGER PRIMARY KEY, template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL, label TEXT NOT NULL DEFAULT '')`,
    `CREATE TABLE IF NOT EXISTS checkins(
      day TEXT PRIMARY KEY, creatine INTEGER NOT NULL DEFAULT 0, protein INTEGER NOT NULL DEFAULT 0,
      bw10 INTEGER NOT NULL DEFAULT 0, arm_mm INTEGER NOT NULL DEFAULT 0)`,
  ];

  // [name, muscle, muscles2, equipment, aliases, rest_sec]
  const EX_SEEDS = [
    ['Flat barbell bench press', 'chest', 'triceps,shoulders', 'barbell', 'bench,flat bench,bb bench,bench press', 150],
    ['Incline dumbbell press', 'upper_chest', 'shoulders,triceps', 'dumbbell', 'incline db,inc db,incline db press', 120],
    ['Incline smith press', 'upper_chest', 'shoulders,triceps', 'smith', 'incline smith,smith incline', 120],
    ['Dumbbell chest press', 'chest', 'triceps', 'dumbbell', 'db press,db bench,flat db,db chest press', 120],
    ['Barbell row', 'back', 'biceps,rear_delts', 'barbell', 'row,bb row,bent over row', 120],
    ['Pull-ups', 'back', 'biceps', 'bodyweight', 'pullups,pull ups,pullup,pull up', 120],
    ['Deadlift', 'back', 'hamstrings,glutes', 'barbell', 'dl,dead,deadlifts', 180],
    ['Smith squat', 'quads', 'glutes', 'smith', 'squat,smith sq,squats', 150],
    ['Seated dumbbell shoulder press', 'shoulders', 'triceps', 'dumbbell', 'db shoulder press,seated db press,shoulder press,sdsp,seated press', 120],
    ['Lateral raise (dumbbell)', 'shoulders', '', 'dumbbell', 'lateral raise,lat raise,laterals,db lateral', 60],
    ['Lateral raise (cable)', 'shoulders', '', 'cable', 'cable lateral,cable lat raise,cable laterals', 60],
    ['Face pulls', 'rear_delts', 'traps', 'cable', 'face pull,fp', 60],
    ['Hammer curls', 'biceps', 'forearms', 'dumbbell', 'hammer,hammers,hammer curl', 75],
    ['EZ-bar curls', 'biceps', 'forearms', 'barbell', 'ez curl,ez curls,ez bar curl,ez-bar curl', 75],
    ['Tricep pushdown', 'triceps', '', 'cable', 'pushdown,pushdowns,tricep pushdowns', 75],
    ['Overhead EZ-bar extension', 'triceps', '', 'barbell', 'oh ez ext,overhead ext,overhead extension,ez extension', 75],
  ];
  const TEMPLATES = [
    ['Chest & Back', ['Flat barbell bench press', 'Incline dumbbell press', 'Barbell row', 'Pull-ups', 'Face pulls']],
    ['Legs', ['Smith squat', 'Deadlift']],
    ['Shoulders & Arms', ['Seated dumbbell shoulder press', 'Lateral raise (dumbbell)', 'Hammer curls', 'EZ-bar curls', 'Tricep pushdown', 'Overhead EZ-bar extension']],
    ['Push', ['Flat barbell bench press', 'Incline smith press', 'Seated dumbbell shoulder press', 'Lateral raise (cable)', 'Tricep pushdown']],
    ['Pull', ['Barbell row', 'Pull-ups', 'Face pulls', 'Hammer curls', 'EZ-bar curls']],
  ];
  const SCHED = ['Chest & Back', 'Legs', 'Shoulders & Arms', '', 'Push', 'Pull', '']; // Mon..Sun
  const DEFAULT_SETTINGS = { units: 'kg', theme: 'dark', sound: '1', rest_auto: '1', rest_beep: '1', bar_kg: '20', plates: '25,20,15,10,5,2.5,1.25', nudge_hour: '20', week_goal: '4', reduce_fx: '0' };

  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const pad = n => String(n).padStart(2, '0');
  const dayStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const int = v => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : 0; };
  const str = v => (v == null ? '' : String(v));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  const fail = (status, msg) => { throw new HttpError(status, msg); };

  /* ---------- PR engine (prs.go) ---------- */
  const e1rm = (w10, reps) => {
    if (w10 <= 0 || reps < 1 || reps > 12) return 0;
    if (reps === 1) return w10;
    return Math.floor((w10 * (30 + reps) + 15) / 30);
  };
  const volOf = s => (s.w10 > 0 ? s.w10 * s.reps : s.reps);

  function computePRs(cur, prior) {
    let pw = 0, pe = 0, pv = 0;
    const pbest = new Map(), pvol = new Map();
    for (const s of prior) {
      if (s.w10 > pw) pw = s.w10;
      const e = e1rm(s.w10, s.reps); if (e > pe) pe = e;
      if (s.reps > (pbest.get(s.w10) || 0)) pbest.set(s.w10, s.reps);
      pvol.set(s.act_id, (pvol.get(s.act_id) || 0) + volOf(s));
    }
    for (const v of pvol.values()) if (v > pv) pv = v;
    let cw = 0, cwReps = 0, ce = 0, ceReps = 0, ceW = 0, cv = 0;
    const cbest = new Map();
    for (const s of cur) {
      if (s.w10 > cw || (s.w10 === cw && s.reps > cwReps)) { cw = s.w10; cwReps = s.reps; }
      const e = e1rm(s.w10, s.reps); if (e > ce) { ce = e; ceReps = s.reps; ceW = s.w10; }
      if (s.reps > (cbest.get(s.w10) || 0)) cbest.set(s.w10, s.reps);
      cv += volOf(s);
    }
    const out = [];
    if (pw > 0 && cw > pw) out.push({ kind: 'weight', value: cw, w10: cw, reps: cwReps, prev: pw });
    if (pe > 0 && ce > pe) out.push({ kind: 'e1rm', value: ce, w10: ceW, reps: ceReps, prev: pe });
    for (const w of [...cbest.keys()].sort((a, b) => b - a)) {
      if (pbest.has(w) && cbest.get(w) > pbest.get(w)) { out.push({ kind: 'reps', value: cbest.get(w), w10: w, reps: cbest.get(w), prev: pbest.get(w) }); break; }
    }
    if (pv > 0 && cv > pv) out.push({ kind: 'volume', value: cv, w10: 0, reps: 0, prev: pv });
    return out;
  }

  /* ---------- seeded PRNG for the demo data ---------- */
  function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function createStore(opts) {
    const SQL = opts.SQL, load = opts.load || (async () => null), save = opts.save || (async () => {});
    const demo = !!opts.demo, nowFn = opts.now || (() => new Date());
    let db = null, saving = Promise.resolve();

    /* ----- tiny sql helpers ----- */
    const all = (sql, params) => {
      const st = db.prepare(sql); const rows = [];
      try { if (params && params.length) st.bind(params); while (st.step()) rows.push(st.getAsObject()); } finally { st.free(); }
      return rows;
    };
    const one = (sql, params) => all(sql, params)[0] || null;
    const run = (sql, params) => db.run(sql, params || []);
    const lastId = () => one('SELECT last_insert_rowid() AS id').id;
    const tx = fn => { run('BEGIN'); try { const r = fn(); run('COMMIT'); return r; } catch (e) { try { run('ROLLBACK'); } catch (_) { /* already rolled back */ } throw e; } };

    function openDB(bytes) {
      db = bytes ? new SQL.Database(bytes) : new SQL.Database();
      run('PRAGMA foreign_keys = ON');
      for (const s of SCHEMA) run(s);
    }

    /* ----- persistence: export the whole file after every write ----- */
    function persist() {
      const job = saving.then(async () => {
        const bytes = db.export();            // closes + reopens, which resets pragmas
        run('PRAGMA foreign_keys = ON');
        await save(bytes);
      });
      saving = job.catch(() => {});
      return job;
    }

    /* ----- seeding (db.go) ----- */
    function seedIfEmpty() {
      for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) run('INSERT OR IGNORE INTO settings(k,v) VALUES(?,?)', [k, v]);
      const seeded = one(`SELECT v FROM settings WHERE k='seeded'`);
      if (seeded && seeded.v === '1') return false;
      tx(() => {
        const ids = {};
        for (const e of EX_SEEDS) { run('INSERT INTO exercises(name,muscle,muscles2,equipment,rest_sec,aliases) VALUES(?,?,?,?,?,?)', [e[0], e[1], e[2], e[3], e[5], e[4]]); ids[e[0]] = lastId(); }
        const tid = {};
        TEMPLATES.forEach(([name, items], i) => {
          run('INSERT INTO templates(name,pos) VALUES(?,?)', [name, i]); tid[name] = lastId();
          items.forEach((it, j) => run('INSERT INTO template_items(template_id,exercise_id,pos) VALUES(?,?,?)', [tid[name], ids[it], j]));
        });
        SCHED.forEach((name, dow) => {
          if (!name) run(`INSERT INTO schedule(dow,template_id,label) VALUES(?,NULL,'Rest')`, [dow]);
          else run(`INSERT INTO schedule(dow,template_id,label) VALUES(?,?,'')`, [dow, tid[name]]);
        });
        run(`INSERT OR REPLACE INTO settings(k,v) VALUES('seeded','1')`);
      });
      return true;
    }

    function seedDemo() {
      const rng = mulberry32(7), R = n => Math.floor(rng() * n), b = x => (x ? 1 : 0);
      const ids = {}; for (const r of all('SELECT id, name FROM exercises')) ids[r.name] = r.id;
      const P = (name, base, step, reps, sets, warm, grp) => ({ name, base, step, reps, sets, warm, grp });
      const plans = {
        0: [P('Flat barbell bench press', 550, 25, 8, 3, true, 0), P('Incline dumbbell press', 225, 25, 8, 3, false, 0), P('Barbell row', 450, 50, 10, 3, false, 0), P('Pull-ups', 0, 0, 7, 3, false, 0), P('Face pulls', 40, 5, 15, 3, false, 0)],
        1: [P('Smith squat', 600, 50, 8, 3, true, 0), P('Deadlift', 1300, 100, 5, 3, true, 0)],
        2: [P('Seated dumbbell shoulder press', 200, 25, 8, 4, false, 0), P('Lateral raise (dumbbell)', 100, 10, 12, 3, false, 0), P('Hammer curls', 125, 25, 10, 3, false, 1), P('Tricep pushdown', 500, 50, 12, 3, false, 1), P('EZ-bar curls', 150, 25, 10, 3, false, 0), P('Overhead EZ-bar extension', 100, 25, 12, 3, false, 0)],
        4: [P('Flat barbell bench press', 550, 25, 8, 3, true, 0), P('Incline smith press', 300, 50, 8, 3, false, 0), P('Seated dumbbell shoulder press', 200, 25, 8, 3, false, 0), P('Lateral raise (cable)', 80, 10, 12, 3, false, 0), P('Tricep pushdown', 500, 50, 12, 3, false, 0)],
        5: [P('Barbell row', 450, 50, 10, 3, false, 0), P('Pull-ups', 0, 0, 7, 3, false, 0), P('Face pulls', 40, 5, 15, 3, false, 0), P('Hammer curls', 125, 25, 10, 3, false, 0), P('EZ-bar curls', 150, 25, 10, 3, false, 0)],
      };
      const names = { 0: 'Chest & Back', 1: 'Legs', 2: 'Shoulders & Arms', 4: 'Push', 5: 'Pull' };
      const span = 76, today = nowFn();
      for (let i = span; i >= 1; i--) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
        const day = dayStr(d), dow = (d.getDay() + 6) % 7, wk = Math.floor((span - i) / 7);
        let cre = 1; if (R(10) === 0) cre = 0;
        run('INSERT OR REPLACE INTO checkins(day,creatine,protein,bw10,arm_mm) VALUES(?,?,?,?,?)', [day, cre, 118 + R(50), 770 + wk * 3 + R(7) - 3, 0]);
        if (plans[dow] && R(12) !== 0) {
          const a = { day, kind: 'lift', subtype: names[dow], duration_min: 55 + R(25), rpe: 7 + R(3), sets: [] };
          for (const p of plans[dow]) {
            const w = p.base + Math.floor(wk / 3) * p.step; let reps = p.reps;
            if (p.name === 'Pull-ups') reps = p.reps + Math.floor(wk / 4);
            const ex = ids[p.name];
            if (p.warm) a.sets.push({ exercise_id: ex, w10: Math.floor(Math.floor(w * 6 / 10) / 25) * 25, reps: 10, kind: 'warm' });
            for (let s = 0; s < p.sets; s++) {
              const r = reps - R(3) * b(s > 0);
              const set = { exercise_id: ex, w10: w, reps: r, grp: p.grp };
              if (R(4) === 0) set.rpe10 = 80 + R(3) * 10;
              a.sets.push(set);
            }
            if (p.name === 'Incline dumbbell press' || (p.name === 'Tricep pushdown' && dow === 4)) a.sets.push({ exercise_id: ex, w10: Math.floor(Math.floor(w * 7 / 10) / 25) * 25, reps: 10 + R(4), kind: 'drop' });
          }
          saveActivity(a);
        } else if ((dow === 3 || dow === 6) && R(2) === 0) saveActivity({ day, kind: 'rest', subtype: 'Rest day' });
        if (dow >= 1 && dow <= 4 && R(4) !== 0) saveActivity({ day, kind: 'basketball', subtype: 'practice', duration_min: 80 + R(25), rpe: 6 + R(3), explosive: b(R(3) === 0) });
        if (dow === 5 && R(3) === 0) saveActivity({ day, kind: 'basketball', subtype: 'game', duration_min: 28 + R(14), rpe: 8 + R(2), explosive: 1, points: 6 + R(14), notes: `Game day, week ${wk + 1}` });
        if (dow === 6 && R(10) < 6) {
          const sub = ['easy', 'tempo', 'long'][wk % 3];
          let dist = 4500 + R(2000), pace = 6.4 - wk * 0.04;
          if (sub === 'tempo') pace -= 0.7;
          if (sub === 'long') { dist += 3500; pace += 0.2; }
          saveActivity({ day, kind: 'run', subtype: sub, duration_min: Math.trunc(dist / 1000 * pace), rpe: { easy: 5, tempo: 8, long: 7 }[sub], dist_m: dist, felt: 3 + R(3) });
        }
      }
      rebuildAllPRs();
    }

    /* ----- PR persistence ----- */
    function loadSetsForExercise(exId) {
      return all(`SELECT s.id, s.activity_id AS act_id, s.exercise_id, a.day, s.w10, s.reps FROM sets s JOIN activities a ON a.id = s.activity_id
        WHERE s.exercise_id = ? AND s.kind != 'warm' AND s.reps > 0 ORDER BY a.day, s.activity_id, s.pos`, [exId]);
    }
    function detectPRs(actId) {
      const a = one('SELECT day FROM activities WHERE id = ?', [actId]); if (!a) return;
      const exIds = all('SELECT DISTINCT exercise_id AS x FROM sets WHERE activity_id = ?', [actId]).map(r => r.x);
      run('DELETE FROM prs WHERE activity_id = ?', [actId]);
      for (const ex of exIds) {
        const cur = [], prior = [];
        for (const s of loadSetsForExercise(ex)) {
          if (s.act_id === actId) cur.push(s);
          else if (s.day < a.day || (s.day === a.day && s.act_id < actId)) prior.push(s);
        }
        if (!cur.length || !prior.length) continue;
        for (const p of computePRs(cur, prior)) run('INSERT INTO prs(exercise_id,activity_id,day,kind,value,w10,reps,prev) VALUES(?,?,?,?,?,?,?,?)', [ex, actId, a.day, p.kind, p.value, p.w10, p.reps, p.prev]);
      }
    }
    function rebuildAllPRs() {
      for (const r of all('SELECT DISTINCT a.id, a.day FROM activities a JOIN sets s ON s.activity_id = a.id ORDER BY a.day, a.id')) detectPRs(r.id);
    }

    /* ----- activities ----- */
    function loadActs(cond, args) {
      const acts = all(`SELECT a.* FROM activities a WHERE ${cond} ORDER BY a.day DESC, a.id DESC`, args);
      const sets = all(`SELECT s.*, e.name AS ex_name, e.equipment, e.muscle FROM sets s JOIN exercises e ON e.id = s.exercise_id
        WHERE s.activity_id IN (SELECT a.id FROM activities a WHERE ${cond}) ORDER BY s.activity_id, s.pos`, args);
      const by = new Map();
      for (const s of sets) { if (!by.has(s.activity_id)) by.set(s.activity_id, []); by.get(s.activity_id).push(s); }
      for (const a of acts) a.sets = by.get(a.id) || [];
      return acts;
    }
    function saveActivity(inp) {
      const a = {
        id: int(inp.id), day: str(inp.day), kind: str(inp.kind), subtype: str(inp.subtype), duration_min: int(inp.duration_min), rpe: int(inp.rpe),
        dist_m: int(inp.dist_m), felt: int(inp.felt), explosive: int(inp.explosive), points: int(inp.points), notes: str(inp.notes),
      };
      return tx(() => {
        let id = a.id;
        if (id === 0) {
          run(`INSERT INTO activities(day,kind,subtype,duration_min,rpe,dist_m,felt,explosive,points,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
            [a.day, a.kind, a.subtype, a.duration_min, a.rpe, a.dist_m, a.felt, a.explosive, a.points, a.notes, nowFn().toISOString()]);
          id = lastId();
        } else {
          run(`UPDATE activities SET day=?,kind=?,subtype=?,duration_min=?,rpe=?,dist_m=?,felt=?,explosive=?,points=?,notes=? WHERE id=?`,
            [a.day, a.kind, a.subtype, a.duration_min, a.rpe, a.dist_m, a.felt, a.explosive, a.points, a.notes, id]);
          run('DELETE FROM sets WHERE activity_id=?', [id]);
        }
        (inp.sets || []).forEach((s, i) => {
          const ex = int(s.exercise_id), reps = int(s.reps);
          if (!ex || reps <= 0) return;
          const kind = s.kind === 'warm' || s.kind === 'drop' ? s.kind : 'work';
          run('INSERT INTO sets(activity_id,exercise_id,pos,grp,w10,reps,rpe10,kind,note) VALUES(?,?,?,?,?,?,?,?,?)', [id, ex, i, int(s.grp), int(s.w10), reps, int(s.rpe10), kind, str(s.note)]);
        });
        return id;
      });
    }

    /* ----- routes (api.go) ----- */
    const routes = {};
    routes['GET /whoami'] = () => ({ app: 'hadid', version: APP_VERSION, demo, local: true });
    routes['POST /ping'] = routes['POST /bye'] = () => ({ ok: true });

    routes['GET /bootstrap'] = () => {
      const settings = {}; for (const s of all('SELECT k, v FROM settings')) settings[s.k] = s.v;
      const exercises = all('SELECT * FROM exercises ORDER BY archived, name COLLATE NOCASE');
      const templates = all('SELECT * FROM templates ORDER BY pos, id');
      const byT = new Map();
      for (const it of all('SELECT template_id, exercise_id FROM template_items ORDER BY template_id, pos')) { if (!byT.has(it.template_id)) byT.set(it.template_id, []); byT.get(it.template_id).push(it.exercise_id); }
      for (const t of templates) t.items = byT.get(t.id) || [];
      const n = nowFn();
      return { settings, exercises, templates, schedule: all('SELECT * FROM schedule ORDER BY dow'), today: dayStr(n), now: n.toISOString(), demo, version: APP_VERSION, local: true, dataDir: '' };
    };

    routes['GET /activities'] = (q) => {
      if (q.get('id')) { const id = Number(q.get('id')); if (!Number.isInteger(id)) fail(400, 'bad id'); return loadActs('a.id = ?', [id]); }
      const from = q.get('from') || '0000-01-01', to = q.get('to') || '9999-12-31';
      if (!DAY_RE.test(from) || !DAY_RE.test(to)) fail(400, 'bad date');
      return loadActs('a.day >= ? AND a.day <= ?', [from, to]);
    };
    routes['POST /activities'] = (q, body) => {
      const inp = body || {};
      if (!DAY_RE.test(str(inp.day))) fail(400, 'bad date');
      if (!['lift', 'run', 'basketball', 'other', 'rest'].includes(inp.kind)) fail(400, 'unknown activity kind');
      inp.duration_min = clamp(int(inp.duration_min), 0, 1440); inp.rpe = clamp(int(inp.rpe), 0, 10); inp.felt = clamp(int(inp.felt), 0, 5);
      if (int(inp.dist_m) < 0) inp.dist_m = 0;
      const id = saveActivity(inp);
      const later = one('SELECT COUNT(*) AS n FROM activities a JOIN sets s ON s.activity_id=a.id WHERE a.day > ? AND a.id != ?', [inp.day, id]).n;
      if (later > 0) rebuildAllPRs(); else detectPRs(id);
      const prs = all('SELECT p.*, e.name AS ex_name, e.equipment FROM prs p JOIN exercises e ON e.id=p.exercise_id WHERE p.activity_id=? ORDER BY p.id', [id]);
      return { id, prs };
    };
    routes['DELETE /activities/:id'] = (q, b, p) => {
      const id = Number(p.id); if (!Number.isInteger(id)) fail(400, 'bad id');
      run('DELETE FROM activities WHERE id=?', [id]); rebuildAllPRs(); return { ok: true };
    };
    routes['POST /rest'] = (q, body) => {
      const day = str(body && body.day); if (!DAY_RE.test(day)) fail(400, 'bad date');
      if (one(`SELECT COUNT(*) AS n FROM activities WHERE day=? AND kind='rest'`, [day]).n === 0)
        run(`INSERT INTO activities(day,kind,subtype,created_at) VALUES(?,'rest','Rest day',?)`, [day, nowFn().toISOString()]);
      return { ok: true };
    };
    routes['GET /ghosts'] = (q) => {
      let before = q.get('before'); if (!DAY_RE.test(before || '')) before = dayStr(nowFn());
      const rows = all(`SELECT s.exercise_id, a.id AS act_id, a.day, s.w10, s.reps, s.rpe10, s.kind FROM sets s JOIN activities a ON a.id = s.activity_id
        WHERE a.day < ? AND s.kind != 'warm' AND s.reps > 0 ORDER BY a.day DESC, a.id DESC, s.pos`, [before]);
      const out = {}, latest = new Map();
      for (const r of rows) {
        if (latest.has(r.exercise_id) && latest.get(r.exercise_id) !== r.act_id) continue;
        latest.set(r.exercise_id, r.act_id);
        const k = String(r.exercise_id);
        if (!out[k]) out[k] = { day: r.day, sets: [] };
        out[k].sets.push({ w10: r.w10, reps: r.reps, rpe10: r.rpe10, kind: r.kind });
      }
      return out;
    };
    routes['GET /lastlift'] = (q) => {
      let before = q.get('before'); if (!DAY_RE.test(before || '')) before = '9999-12-31';
      const r = one(`SELECT id FROM activities WHERE kind='lift' AND subtype=? AND day<? ORDER BY day DESC, id DESC LIMIT 1`, [q.get('subtype') || '', before]);
      if (!r) return null; const acts = loadActs('a.id = ?', [r.id]); return acts[0] || null;
    };
    routes['GET /days'] = () => all('SELECT id, day, kind, subtype, duration_min, rpe, dist_m, explosive FROM activities ORDER BY day, id');

    routes['POST /exercises'] = (q, body) => {
      const x = body || {}, name = str(x.name).trim(); if (!name) fail(400, 'name required');
      const muscle = str(x.muscle) || 'other', eq = str(x.equipment) || 'barbell', rest = clamp(int(x.rest_sec), 10, 900);
      let id = int(x.id);
      if (id === 0) { run('INSERT INTO exercises(name,muscle,muscles2,equipment,rest_sec,aliases,notes) VALUES(?,?,?,?,?,?,?)', [name, muscle, str(x.muscles2), eq, rest, str(x.aliases), str(x.notes)]); id = lastId(); }
      else run('UPDATE exercises SET name=?,muscle=?,muscles2=?,equipment=?,rest_sec=?,aliases=?,notes=?,archived=0 WHERE id=?', [name, muscle, str(x.muscles2), eq, rest, str(x.aliases), str(x.notes), id]);
      return { id };
    };
    routes['DELETE /exercises/:id'] = (q, b, p) => {
      const id = Number(p.id); if (!Number.isInteger(id)) fail(400, 'bad id');
      const used = one('SELECT COUNT(*) AS n FROM sets WHERE exercise_id=?', [id]).n;
      run('DELETE FROM template_items WHERE exercise_id=?', [id]);
      if (used > 0) { run('UPDATE exercises SET archived=1 WHERE id=?', [id]); return { archived: true, used }; }
      run('DELETE FROM exercises WHERE id=?', [id]); return { deleted: true };
    };
    routes['POST /templates'] = (q, body) => {
      const x = body || {}, name = str(x.name).trim(); if (!name) fail(400, 'name required');
      return tx(() => {
        let id = int(x.id);
        if (id === 0) { const pos = one('SELECT COALESCE(MAX(pos)+1,0) AS p FROM templates').p; run('INSERT INTO templates(name,pos) VALUES(?,?)', [name, pos]); id = lastId(); }
        else { run('UPDATE templates SET name=? WHERE id=?', [name, id]); run('DELETE FROM template_items WHERE template_id=?', [id]); }
        (x.items || []).forEach((ex, i) => run('INSERT INTO template_items(template_id,exercise_id,pos) VALUES(?,?,?)', [id, int(ex), i]));
        return { id };
      });
    };
    routes['DELETE /templates/:id'] = (q, b, p) => {
      const id = Number(p.id); if (!Number.isInteger(id)) fail(400, 'bad id');
      run('DELETE FROM templates WHERE id=?', [id]); return { ok: true };
    };
    routes['PUT /schedule'] = (q, body) => {
      for (const r of (body && body.rows) || []) {
        const dow = int(r.dow); if (dow < 0 || dow > 6) continue;
        run('INSERT OR REPLACE INTO schedule(dow,template_id,label) VALUES(?,?,?)', [dow, r.template_id == null ? null : int(r.template_id), str(r.label)]);
      }
      return { ok: true };
    };
    routes['PUT /settings'] = (q, body) => {
      for (const [k, v] of Object.entries(body || {})) if (k in DEFAULT_SETTINGS) run('INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)', [k, str(v)]);
      return { ok: true };
    };
    routes['GET /prs'] = () => {
      const events = all('SELECT p.*, e.name AS ex_name, e.equipment, e.muscle FROM prs p JOIN exercises e ON e.id=p.exercise_id ORDER BY p.day DESC, p.id DESC');
      const rows = all(`SELECT s.exercise_id, a.day, s.w10, s.reps, e.name AS ex_name, e.equipment, e.muscle FROM sets s JOIN activities a ON a.id=s.activity_id
        JOIN exercises e ON e.id=s.exercise_id WHERE s.kind != 'warm' AND s.reps > 0 AND e.archived = 0 ORDER BY a.day, a.id, s.pos`);
      const bests = new Map();
      for (const r of rows) {
        let b = bests.get(r.exercise_id);
        if (!b) { b = { name: r.ex_name, equipment: r.equipment, muscle: r.muscle, w: 0, wReps: 0, wDay: '', e: 0, eDay: '', r: 0, rDay: '' }; bests.set(r.exercise_id, b); }
        if (r.w10 > b.w || (r.w10 === b.w && r.reps > b.wReps)) { b.w = r.w10; b.wReps = r.reps; b.wDay = r.day; }
        const e = e1rm(r.w10, r.reps); if (e > b.e) { b.e = e; b.eDay = r.day; }
        if (r.w10 === 0 && r.reps > b.r) { b.r = r.reps; b.rDay = r.day; }
      }
      const wall = [...bests].map(([id, b]) => ({ exercise_id: id, name: b.name, equipment: b.equipment, muscle: b.muscle, w10: b.w, w_reps: b.wReps, w_day: b.wDay, e1rm: b.e, e_day: b.eDay, bw_reps: b.r, r_day: b.rDay }));
      return { events, wall };
    };
    routes['POST /prs/rebuild'] = () => { rebuildAllPRs(); return { ok: true }; };
    routes['POST /backup'] = async () => {
      const bytes = exportDB(), name = `hadid-backup-${dayStr(nowFn())}.db`;
      if (opts.saveFile) await opts.saveFile(name, bytes, 'application/octet-stream');
      return { ok: true, file: name, dir: '' };
    };

    const matchers = Object.keys(routes).map(k => {
      const [method, pattern] = k.split(' ');
      const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => { keys.push(n); return '([^/]+)'; }) + '$');
      return { method, re, keys, fn: routes[k] };
    });

    /* ----- public surface ----- */
    const ready = (async () => {
      const bytes = await load();
      openDB(bytes);
      const first = seedIfEmpty();
      if (first && demo) seedDemo();
      if (first || !bytes) await persist();
    })();

    async function handle(method, url, body) {
      await ready;
      const u = new URL(url, 'http://hadid.local'), path = u.pathname.replace(/^\/api/, '') || '/';
      for (const m of matchers) {
        if (m.method !== method) continue; const mt = m.re.exec(path); if (!mt) continue;
        const params = {}; m.keys.forEach((k, i) => { params[k] = decodeURIComponent(mt[i + 1]); });
        try {
          const out = await m.fn(u.searchParams, body, params);
          if (method !== 'GET' && path !== '/backup') await persist();
          return out === undefined ? null : JSON.parse(JSON.stringify(out));
        } catch (e) {
          if (!(e instanceof HttpError)) console.error('[hadid store]', e);
          throw e instanceof HttpError ? new Error(e.message) : new Error('Something went wrong saving that. ' + e.message);
        }
      }
      throw new Error('Not found: ' + method + ' ' + path);
    }

    function exportDB() { const bytes = db.export(); run('PRAGMA foreign_keys = ON'); return bytes; }

    async function importDB(bytes) {
      await ready;
      const head = new TextDecoder().decode(bytes.slice(0, 15));
      if (head !== 'SQLite format 3') fail(400, 'That file is not a Hadid backup.');
      let probe; try { probe = new SQL.Database(bytes); } catch (e) { fail(400, 'That file could not be opened.'); }
      const st = probe.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('activities','sets','exercises','settings','templates')`); st.step();
      const n = st.getAsObject().n; st.free(); probe.close();
      if (n < 5) fail(400, 'That file is not a Hadid backup.');
      const old = db; openDB(bytes); try { old.close(); } catch (_) { /* ignore */ }
      seedIfEmpty(); await persist();
      return { ok: true, activities: one('SELECT COUNT(*) AS n FROM activities').n };
    }

    function exportCSV() {
      const rows = all(`SELECT a.day, a.kind, a.subtype, a.duration_min, a.rpe, a.dist_m, a.explosive, a.points, a.notes,
        COALESCE(e.name,'') AS ex, COALESCE(s.pos,0) AS pos, COALESCE(s.w10,0) AS w10, COALESCE(s.reps,0) AS reps, COALESCE(s.rpe10,0) AS rpe10, COALESCE(s.kind,'') AS skind
        FROM activities a LEFT JOIN sets s ON s.activity_id=a.id LEFT JOIN exercises e ON e.id=s.exercise_id ORDER BY a.day, a.id, s.pos`);
      const cell = v => { v = String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const kg1 = n => `${Math.floor(n / 10)}.${n % 10}`;
      const out = [['day', 'activity', 'subtype', 'duration_min', 'effort_rpe', 'distance_km', 'explosive', 'points', 'notes', 'exercise', 'set_no', 'weight_kg', 'reps', 'set_rpe', 'set_kind']];
      for (const x of rows) {
        const distS = x.dist_m > 0 ? `${Math.floor(x.dist_m / 1000)}.${pad(Math.floor((x.dist_m % 1000) / 10))}` : '';
        let setNo = '', w = '', r10 = '';
        if (x.ex !== '') { setNo = x.pos + 1; w = kg1(x.w10); if (x.rpe10 > 0) r10 = kg1(x.rpe10); }
        out.push([x.day, x.kind, x.subtype, x.duration_min, x.rpe, distS, x.explosive, x.points, x.notes, x.ex, setNo, w, x.reps, r10, x.skind]);
      }
      return '\ufeff' + out.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
    }

    return { ready, handle, exportDB, importDB, exportCSV, persist, _all: all, _e1rm: e1rm };
  }

  const api = { createStore, e1rm, computePRs, APP_VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HadidStoreLib = api;
})(typeof window !== 'undefined' ? window : globalThis);
