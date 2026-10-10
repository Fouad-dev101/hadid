// Hadid lift parser — pure functions, no DOM. Tested with `node tests/parse_test.js`.
//
//   bench 60x8, 65x8, 70x6        three sets
//   incline db 25x8 27.5x7        spaces work too
//   pullups bwx10 bwx9            bodyweight (or just x10)
//   squat w40x10 60x8x3           w = warm-up, x3 = three identical sets
//   curls 15x10@8 d10x12          @8 = RPE, d = drop set
//   & pushdown 50x15              "&" / "ss" = superset with the line above
(function (root) {
  'use strict';

  const ABBR = { db: 'dumbbell', dbs: 'dumbbell', bb: 'barbell', sm: 'smith', oh: 'overhead', ohp: 'overhead press',
    dl: 'deadlift', inc: 'incline', incl: 'incline', ext: 'extension', tri: 'tricep', bi: 'bicep' };

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[()\-_/,.]/g, ' ').split(/\s+/).filter(Boolean)
      .flatMap(t => (ABBR[t] ? ABBR[t].split(' ') : [t]))
      .map(t => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
  }

  // Score how well `query` matches an exercise (0 = no match).
  function score(query, ex) {
    const q = norm(query);
    if (!q.length) return 0;
    const cands = [ex.name].concat(String(ex.aliases || '').split(',').map(s => s.trim()).filter(Boolean));
    let best = 0;
    for (let i = 0; i < cands.length; i++) {
      const c = norm(cands[i]);
      if (!c.length) continue;
      if (c.join(' ') === q.join(' ')) { best = Math.max(best, i === 0 ? 1000 : 990); continue; }
      const allIn = q.every(qt => c.some(ct => ct.startsWith(qt)));
      if (allIn) best = Math.max(best, 500 + q.length * 20 - c.length * 3 + (i === 0 ? 5 : 0));
    }
    return best;
  }

  function rank(query, exercises, limit) {
    return exercises.filter(e => !e.archived)
      .map(e => ({ ex: e, s: score(query, e) })).filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || a.ex.name.length - b.ex.name.length)
      .slice(0, limit || 5).map(x => x.ex);
  }

  const SET_RE = /(?<![A-Za-z])(w(?:arm)?|d(?:rop)?)?\s*(bw|\+?\d+(?:\.\d+)?)?\s*(?:kg|lbs?)?\s*[x×*]\s*(\d+)(?:[x×*](\d+))?(?:\s*@\s*(\d+(?:\.\d+)?))?/gi;
  const START_RE = /(?<![A-Za-z])(?:w(?:arm)?|d(?:rop)?)?\s*(?:bw|\+?\d+(?:\.\d+)?)?\s*(?:kg|lbs?)?\s*[x×*]\s*\d+/i;

  function toW10(numStr, unit) {
    if (!numStr || String(numStr).toLowerCase() === 'bw') return 0;
    const n = parseFloat(String(numStr).replace('+', ''));
    if (!isFinite(n)) return 0;
    return unit === 'lb' ? Math.round(n * 4.5359237) : Math.round(n * 10);
  }

  // parse(text, exercises, {unit}) -> [{raw, nameText, ex, sets, sup, grp, status}]
  function parse(text, exercises, opts) {
    const unit = (opts && opts.unit) || 'kg';
    const out = [];
    const lines = String(text || '').split(/\n|;/);
    let grpCounter = 0;
    for (let raw of lines) {
      raw = raw.trim();
      if (!raw) continue;
      let sup = false;
      const m = raw.match(/^(?:&|ss\b:?|\+\s)\s*/i);
      if (m) { sup = true; raw = raw.slice(m[0].length); }
      const st = raw.search(START_RE);
      const nameText = (st < 0 ? raw : raw.slice(0, st)).replace(/[:\-–,]+\s*$/, '').trim();
      const setsText = st < 0 ? '' : raw.slice(st);
      const sets = [];
      let g;
      SET_RE.lastIndex = 0;
      while ((g = SET_RE.exec(setsText)) !== null) {
        const tag = (g[1] || '').toLowerCase();
        const kind = tag.startsWith('w') ? 'warm' : tag.startsWith('d') ? 'drop' : 'work';
        const count = g[4] ? Math.min(parseInt(g[4], 10), 20) : 1;
        const reps = parseInt(g[3], 10);
        if (!(reps > 0 && reps <= 200)) continue;
        const s = { w10: toW10(g[2], unit), reps, kind, rpe10: g[5] ? Math.round(parseFloat(g[5]) * 10) : 0 };
        for (let i = 0; i < count; i++) sets.push(Object.assign({}, s));
      }
      let ex = null;
      if (nameText) { const r = rank(nameText, exercises, 1); ex = r[0] || null; }
      const line = { raw, nameText, ex, sets, sup, grp: 0,
        status: !nameText ? 'noname' : !ex ? 'new' : !sets.length ? 'empty' : 'ok' };
      if (sup && out.length) {
        const prev = out[out.length - 1];
        if (!prev.grp) prev.grp = ++grpCounter;
        line.grp = prev.grp;
      }
      out.push(line);
    }
    return out;
  }

  const fmtNum = w10 => { const v = w10 / 10; return Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, ''); };

  // setsToText: structured sets -> the text you'd have typed (for "copy last session").
  function setsToText(name, sets, wf) {
    const f = wf || fmtNum, parts = [];
    for (let i = 0; i < sets.length; i++) {
      const s = sets[i];
      let n = 1;
      while (i + n < sets.length && sets[i + n].w10 === s.w10 && sets[i + n].reps === s.reps && sets[i + n].kind === s.kind) n++;
      const pre = s.kind === 'warm' ? 'w' : s.kind === 'drop' ? 'd' : '';
      parts.push(pre + (s.w10 ? f(s.w10) : 'bw') + 'x' + s.reps + (n > 1 ? 'x' + n : ''));
      i += n - 1;
    }
    return name + ' ' + parts.join(', ');
  }

  // overload: progressive-overload suggestion from last session's sets of one exercise.
  function overload(lastSets, equipment) {
    const work = (lastSets || []).filter(s => s.kind !== 'warm' && s.reps > 0);
    if (!work.length) return null;
    let top = work[0];
    for (const s of work) if (s.w10 > top.w10 || (s.w10 === top.w10 && s.reps > top.reps)) top = s;
    if (!top.w10) return { top, a: null, b: { w10: 0, reps: top.reps + 1 } };
    const step = (equipment === 'barbell' || equipment === 'smith') && top.w10 >= 1000 ? 50 : 25;
    const dropReps = top.reps >= 8 ? 2 : 1;
    return { top, a: { w10: top.w10 + step, reps: Math.max(top.reps - dropReps, 1) }, b: { w10: top.w10, reps: top.reps + 1 } };
  }

  const api = { parse, rank, score, norm, setsToText, overload, fmtNum, toW10 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HadidParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
