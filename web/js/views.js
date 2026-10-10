'use strict';
/* Hadid secondary views: history, PR wall, plate calculator, live mode, library, routine, settings. */

/* ================= History ================= */
const HF = { kind: 'all' };
const actTitle = a => a.kind === 'rest' ? 'Rest day' : (a.subtype ? (a.kind === 'run' ? `${a.subtype} run` : a.subtype) : KIND[a.kind]);
function actMeta(a) {
  if (a.kind === 'rest') return 'Recovery';
  const bits = [];
  if (a.kind === 'run') bits.push(`${(a.dist_m / 1000).toFixed(2).replace(/\.?0+$/, '')} km`, fmtPace(a.dist_m, a.duration_min) + ' /km');
  if (a.kind === 'lift') {
    const exs = unique(a.sets.map(s => s.ex_name)), work = a.sets.filter(s => s.kind !== 'warm').length;
    bits.push(`${exs.length} exercises`, `${work} sets`);
  }
  if (a.kind === 'basketball' && a.points) bits.push(`${a.points} pts`);
  if (a.kind === 'basketball' && a.explosive) bits.push('explosive');
  bits.push(`${a.duration_min} min`, `RPE ${a.rpe}`);
  return bits.join(' · ');
}
V.history = {
  async render() {
    const acts = await api('/activities');
    const shown = acts.filter(a => HF.kind === 'all' || a.kind === HF.kind);
    const weeks = {};
    for (const a of shown) (weeks[weekStart(a.day)] = weeks[weekStart(a.day)] || []).push(a);
    const keys = Object.keys(weeks).sort().reverse();
    return H`
    <header class="top"><div><div class="eyebrow">Everything you logged</div><h1>History</h1></div>
      <div class="chips">${['all', 'lift', 'run', 'basketball', 'other', 'rest'].map(k => H`<button class="chip ${HF.kind === k ? 'on' : ''} ${k === 'all' ? '' : 'k-' + k}" data-act="hist-filter" data-k="${k}">${k === 'all' ? 'All' : KIND[k]}</button>`)}</div></header>
    ${keys.length ? keys.map(w => {
      const list = weeks[w], real = list.filter(a => a.kind !== 'rest');
      return H`<section class="week rise"><div class="week-head"><b>${fmtDay(w, { day: 'numeric', month: 'short' })} – ${fmtDay(addDays(w, 6), { day: 'numeric', month: 'short' })}</b><span>${real.length} sessions · load ${sum(real, loadOf).toLocaleString('en-US')}</span></div>
        <ul class="hist">${list.map(a => H`<li><button data-act="go" data-to="/log/edit/${a.id}"><span class="hd">${fmtDay(a.day)}</span><i class="dot k-${a.kind}"></i><span class="ht"><b>${actTitle(a)}</b><em>${actMeta(a)}</em></span>${a.kind === 'rest' ? '' : H`<span class="hl">${loadOf(a).toLocaleString('en-US')}</span>`}</button></li>`)}</ul></section>`;
    }) : H`<div class="empty">Nothing here yet. Log your first session and it shows up here.</div>`}`;
  },
};
A['hist-filter'] = el => { HF.kind = el.dataset.k; render(); };

/* ================= PR wall ================= */
const PF = { q: '' };
V.prs = {
  async render() {
    const d = await api('/prs');
    const q = PF.q.trim().toLowerCase();
    const wall = d.wall.filter(w => !q || w.name.toLowerCase().includes(q) || muscleName(w.muscle).toLowerCase().includes(q));
    wall.sort((a, b) => b.e1rm - a.e1rm || b.w10 - a.w10);
    const recent = d.events.slice(0, 40);
    return H`
    <header class="top"><div><div class="eyebrow">Personal records</div><h1>PR wall</h1></div>
      <input class="search" type="search" id="pr-q" placeholder="Search exercise or muscle" value="${PF.q}"></header>
    <div class="wall">${wall.length ? wall.map((w, i) => H`<article class="prcard rise" style="--i:${Math.min(i, 12)}">
      <div class="pc-top"><span class="pc-m">${muscleName(w.muscle)}</span><span class="pc-e">${w.equipment}</span></div>
      <h3>${w.name}</h3>
      ${w.w10 ? H`<div class="pc-big"><b data-count="${unit() === 'lb' ? Math.round(w.w10 * 0.220462) : w.w10 / 10}" data-dec="${(w.w10 % 10 && unit() === 'kg') ? 1 : 0}">0</b><span>${unit()} × ${w.w_reps}</span></div>
        <div class="pc-row"><span>Est. 1RM</span><b>${w.e1rm ? fmtWu(w.e1rm) : '–'}</b></div>
        <div class="pc-day">${relDay(w.w_day)}</div>`
        : H`<div class="pc-big"><b data-count="${w.bw_reps}">0</b><span>reps · bodyweight</span></div><div class="pc-day">${w.r_day ? relDay(w.r_day) : ''}</div>`}
    </article>`) : H`<div class="empty">No lifts logged yet.</div>`}</div>
    <section class="card wide rise"><h2>Timeline</h2>
      ${recent.length ? H`<ul class="tline">${recent.map(p => { const l = prLabel(p); return H`<li><time>${fmtDay(p.day, { day: 'numeric', month: 'short' })}</time><i></i><div><b>${l.nm}</b><span>${l.t}</span></div><strong>${l.v}</strong><em>${l.was}</em></li>`; })}</ul>` : H`<p class="muted">PRs appear here the moment you beat a previous best. The first time you log an exercise sets the baseline.</p>`}
    </section>`;
  },
  mount(root) {
    const i = $('#pr-q', root);
    i.addEventListener('input', debounce(async () => { PF.q = i.value; const pos = i.selectionStart; await render(); const n = $('#pr-q'); n.focus(); n.setSelectionRange(pos, pos); }, 250));
  },
};

/* ================= Plate calculator ================= */
const PL = { target: '', bar: null, mode: 'barbell' };
const PL_BAR = { barbell: [20, 15], smith: [15, 7], dumbbell: [2.5, 5] };
function plateOut() {
  const avail = (setting('plates') || '25,20,15,10,5,2.5,1.25').split(',').map(Number).filter(Boolean);
  const bar = PL.bar != null ? PL.bar : (+setting('bar_kg') || PL_BAR[PL.mode][0]);
  const bar10 = Math.round(bar * 10), v = parseFloat(PL.target);
  if (!v) return H`<div class="empty small">Type the weight you want on the bar.</div>${raw(barbellSVG([]).s)}`;
  const kg = unit() === 'lb' ? v / 2.20462 : v, t10 = Math.round(kg * 10);
  if (t10 < bar10) return H`<div class="warn">That's lighter than the bar (${bar} kg).</div>${raw(barbellSVG([]).s)}`;
  const r = platesFor(t10, bar10, avail), got10 = totalFor(r.plates, bar10);
  const counts = {}; r.plates.forEach(p => counts[p] = (counts[p] || 0) + 1);
  const small = Math.min(...avail), up10 = got10 + Math.round(small * 20);
  const perHand = PL.mode === 'dumbbell';
  return H`
    <div class="pl-res">
      <div class="pl-total"><span>Loaded</span><b>${fmtW(got10)}</b><em>${unit()}</em>${got10 !== t10 ? H`<i class="off">${t10 > got10 ? 'short by ' : 'over by '}${fmtW(Math.abs(t10 - got10))}</i>` : H`<i class="ok">exact</i>`}</div>
      <div class="pl-side"><span>Per side${perHand ? ' (each dumbbell)' : ''}</span>
        <div class="pl-list">${r.plates.length ? Object.keys(counts).sort((a, b) => b - a).map(k => H`<span class="pchip" style="--c:${plateInfo(+k)[0]}"><b>${counts[k]}×</b>${k}</span>`) : H`<em class="muted">just the bar</em>`}</div></div>
      ${got10 !== t10 ? H`<p class="muted small">Closest with your plates: <b>${fmtWu(got10)}</b> or <b>${fmtWu(up10)}</b>.</p>` : ''}
    </div>${raw(barbellSVG(r.plates).s)}`;
}
V.plates = {
  async render() {
    PL.bar = PL.bar != null ? PL.bar : (+setting('bar_kg') || 20);
    return H`
    <header class="top"><div><div class="eyebrow">Gym maths, done</div><h1>Plate calculator</h1></div>
      <div class="chips">${['barbell', 'smith', 'dumbbell'].map(m => H`<button class="chip ${PL.mode === m ? 'on' : ''}" data-act="pl-mode" data-m="${m}">${m}</button>`)}</div></header>
    <section class="card wide rise"><div class="pl-in">
      <div class="field"><label>Target weight</label><div class="stepper big"><button class="icon" data-act="pl-step" data-d="-2.5">−</button><input id="pl-target" type="number" step="0.5" min="0" inputmode="decimal" value="${PL.target}" placeholder="0" autofocus><span>${unit()}</span><button class="icon" data-act="pl-step" data-d="2.5">+</button></div></div>
      <div class="field"><label>Bar</label><div class="chips">${PL_BAR[PL.mode].map(b => H`<button class="chip ${PL.bar === b ? 'on' : ''}" data-act="pl-bar" data-b="${b}">${b} kg</button>`)}<input id="pl-bar" type="number" step="0.5" min="0" value="${PL.bar}" class="mini"></div></div>
    </div><div id="pl-out">${plateOut()}</div></section>`;
  },
  mount() { const i = $('#pl-target'); if (i) { i.focus(); i.select(); } },
};
document.addEventListener('input', e => {
  if (e.target.id === 'pl-target') { PL.target = e.target.value; $('#pl-out').innerHTML = plateOut().s; }
  if (e.target.id === 'pl-bar') { PL.bar = parseFloat(e.target.value) || 0; $('#pl-out').innerHTML = plateOut().s; }
});
A['pl-mode'] = el => { PL.mode = el.dataset.m; PL.bar = PL_BAR[PL.mode][0]; render(); };
A['pl-bar'] = el => { PL.bar = +el.dataset.b; render(); };
A['pl-step'] = el => { const v = Math.max(0, (parseFloat(PL.target) || 0) + +el.dataset.d); PL.target = String(v); $('#pl-target').value = PL.target; $('#pl-out').innerHTML = plateOut().s; };

/* ================= Live mode (optional, in the gym) ================= */
const L = { active: false, tplId: 0, name: '', start: 0, ex: [] };
function liveSeed(exId) {
  const e = exById(exId), mine = (L.ex.find(x => x.id === exId) || { sets: [] }).sets, g = S.ghosts[exId];
  if (mine.length) { const s = mine[mine.length - 1]; return { w10: s.w10, reps: s.reps }; }
  if (g) { const o = P.overload(g.sets, e.equipment); return o.a || o.b; }
  return { w10: 0, reps: 8 };
}
V.live = {
  async render(tplId) {
    await loadDays(); await ensureGhosts(addDays(todayStr(), 1));
    if (tplId !== undefined && (!L.active || +tplId !== L.tplId)) {
      const tpl = +tplId ? tplById(+tplId) : null;
      L.active = true; L.tplId = tpl ? tpl.id : 0; L.name = tpl ? tpl.name : 'Free'; L.start = Date.now();
      L.ex = tpl ? tpl.items.map(id => ({ id, sets: [] })).filter(x => exById(x.id)) : [];
    }
    if (!L.active) {
      const tpl = planFor(todayStr());
      return H`<header class="top"><div><div class="eyebrow">Optional · in the gym</div><h1>Live mode</h1></div></header>
        <p class="muted lead">Log sets as you go with an automatic rest timer. If you'd rather write it all up tonight, use Log today instead.</p>
        <div class="picker">${S.boot.templates.map((t, i) => H`<button class="tile rise k-lift ${tpl && tpl.id === t.id ? 'planned' : ''}" style="--i:${i}" data-act="go" data-to="/live/${t.id}"><b>${t.name}</b><span>${t.items.length} exercises${tpl && tpl.id === t.id ? ' · planned today' : ''}</span></button>`)}
          <button class="tile rise" data-act="go" data-to="/live/0"><b>Free session</b><span>Add exercises as you go</span></button></div>`;
    }
    return liveBody();
  },
  mount() { if (L.active) liveTick(); },
};
function liveBody() {
  const done = sum(L.ex, x => x.sets.filter(s => s.kind !== 'warm').length);
  return H`<header class="top"><div><div class="eyebrow">Live · <span id="live-clock">0:00</span></div><h1>${L.name}</h1></div>
    <div class="row gap"><button class="btn ghost" data-act="live-cancel">Discard</button><button class="btn big" data-act="live-finish" ${done ? '' : 'disabled'}>Finish <kbd>${done} sets</kbd></button></div></header>
  <div class="live">${L.ex.map(x => {
    const e = exById(x.id), seed = liveSeed(x.id), g = S.ghosts[x.id];
    return H`<section class="card lx rise"><div class="row between"><h2>${e.name}</h2><span class="eq">${e.equipment} · rest ${e.rest_sec}s</span></div>
      ${g ? H`<div class="ghost">Last · ${relDay(g.day)} · ${g.sets.map(s => `${s.w10 ? fmtW(s.w10) : 'BW'}×${s.reps}`).join('  ')}</div>` : ''}
      <div class="sets">${x.sets.map((s, i) => H`<button class="set ${s.kind}" data-act="live-undo" data-id="${x.id}" data-i="${i}" title="Remove set">${s.w10 ? fmtW(s.w10) : 'BW'}<i>×</i>${s.reps}</button>`)}</div>
      <div class="live-in" data-ex="${x.id}"><input type="number" step="0.5" inputmode="decimal" class="lw" value="${seed.w10 ? fmtW(seed.w10) : ''}" placeholder="${unit()}"><i>×</i><input type="number" inputmode="numeric" class="lr" value="${seed.reps}" placeholder="reps">
        <button class="btn" data-act="live-set" data-id="${x.id}">Log set</button></div></section>`;
  })}
  <section class="card lx"><div class="row gap wrap"><select id="live-add"><option value="">+ Add exercise…</option>${activeEx().filter(e => !L.ex.find(x => x.id === e.id)).map(e => H`<option value="${e.id}">${e.name}</option>`)}</select>
    <button class="btn ghost" data-act="rest-timer" data-s="60">Rest 1:00</button><button class="btn ghost" data-act="rest-timer" data-s="90">1:30</button><button class="btn ghost" data-act="rest-timer" data-s="120">2:00</button></div></section></div>`;
}
let liveClock = 0;
function liveTick() {
  clearInterval(liveClock);
  const f = () => { const el = $('#live-clock'); if (!el) return clearInterval(liveClock); const s = Math.floor((Date.now() - L.start) / 1000); el.textContent = `${Math.floor(s / 60)}:${pad(s % 60)}`; };
  f(); liveClock = setInterval(f, 1000);
}
function liveRedraw(focusId) {
  show($('#view'), liveBody()); liveTick();
  if (focusId) { const i = $(`.live-in[data-ex="${focusId}"] .lw`); if (i) { i.focus(); i.select(); } }
}
document.addEventListener('change', e => {
  if (e.target.id === 'live-add' && e.target.value) { L.ex.push({ id: +e.target.value, sets: [] }); liveRedraw(+e.target.value); }
});
A['live-set'] = el => {
  const id = +el.dataset.id, row = $(`.live-in[data-ex="${id}"]`), e = exById(id);
  const w = parseFloat($('.lw', row).value) || 0, reps = parseInt($('.lr', row).value, 10) || 0;
  if (!reps) return toast('Add the reps', 'bad');
  const w10 = P.toW10(String(w), unit());
  L.ex.find(x => x.id === id).sets.push({ w10, reps, kind: 'work' });
  sfx.clank(); haptic(20);
  if (setting('rest_auto') !== '0') restStart(e.rest_sec || 90, e.name);
  liveRedraw(id);
  const btn = $(`.live-in[data-ex="${id}"] .btn`); if (btn) btn.classList.add('stamp');
};
A['live-undo'] = el => { const x = L.ex.find(x => x.id === +el.dataset.id); x.sets.splice(+el.dataset.i, 1); liveRedraw(); };
A['rest-timer'] = el => restStart(+el.dataset.s, 'Rest');
A['rest-add'] = () => restAdd(15);
A['rest-stop'] = () => restStop();
A['live-cancel'] = async () => {
  if (L.ex.some(x => x.sets.length) && !(await confirmDialog('Discard this live session?', 'Discard'))) return;
  L.active = false; restStop(); clearInterval(liveClock); go('/home');
};
A['live-finish'] = () => {
  const mins = Math.max(5, Math.round((Date.now() - L.start) / 60000));
  let rpe = 7;
  modal(H`<h3>Finish session</h3><div class="field"><label>Duration</label><div class="stepper"><input id="lf-dur" type="number" value="${mins}" min="1"><span>min</span></div></div>
    <div class="field"><label>Effort</label><div class="rpe" id="lf-rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => H`<button class="${n === 7 ? 'on' : ''}" style="--h:${n}" data-act="lf-rpe" data-v="${n}">${n}</button>`)}</div></div>
    <div class="row end gap"><button class="btn ghost" data-act="modal-close">Back</button><button class="btn big" data-act="lf-save" autofocus>Save session</button></div>`);
  A['lf-rpe'] = b => { rpe = +b.dataset.v; $$('#lf-rpe button').forEach(x => x.classList.toggle('on', x === b)); };
  A['lf-save'] = async b => {
    b.disabled = true;
    const body = { id: 0, day: todayStr(), kind: 'lift', subtype: L.name, duration_min: parseInt($('#lf-dur').value, 10) || mins, rpe, notes: '', felt: 0, explosive: 0, points: 0, dist_m: 0, sets: [] };
    for (const x of L.ex) for (const s of x.sets) body.sets.push({ exercise_id: x.id, grp: 0, w10: s.w10, reps: s.reps, rpe10: 0, kind: s.kind });
    try {
      const res = await api('/activities', 'POST', body);
      closeModal(); L.active = false; restStop(); clearInterval(liveClock); S.ghostsFor = '';
      sfx.clank(); if (res.prs && res.prs.length) celebrate(res.prs); else toast('Session saved. Nice work.');
      go('/home');
    } catch (err) { b.disabled = false; toast(err.message, 'bad'); }
  };
};

/* ================= Exercise library ================= */
const LF = { q: '', showArchived: false };
V.library = {
  async render() {
    const q = LF.q.trim().toLowerCase();
    const list = S.boot.exercises.filter(e => (LF.showArchived || !e.archived) && (!q || e.name.toLowerCase().includes(q) || (e.aliases || '').toLowerCase().includes(q) || e.muscle.includes(q.replace(/ /g, '_'))));
    const groups = {};
    for (const e of list) (groups[e.muscle] = groups[e.muscle] || []).push(e);
    const order = MUSCLES.filter(m => groups[m]);
    return H`
    <header class="top"><div><div class="eyebrow">${activeEx().length} exercises</div><h1>Library</h1></div>
      <div class="row gap"><input class="search" type="search" id="lib-q" placeholder="Search" value="${LF.q}"><button class="btn" data-act="ex-edit" data-id="0">+ New</button></div></header>
    ${order.map(m => H`<section class="card rise"><h2>${muscleName(m)}</h2><ul class="lib">${groups[m].map(e => H`<li class="${e.archived ? 'arch' : ''}"><button data-act="ex-edit" data-id="${e.id}"><b>${e.name}</b><em>${e.equipment}</em><span>${e.rest_sec}s rest</span>${e.archived ? H`<i class="tag">archived</i>` : ''}</button></li>`)}</ul></section>`)}
    ${list.length ? '' : H`<div class="empty">No exercise matches.</div>`}
    <label class="switch mt"><input type="checkbox" id="lib-arch" ${LF.showArchived ? 'checked' : ''}><i></i><span>Show archived</span></label>`;
  },
  mount() {
    const i = $('#lib-q');
    i.addEventListener('input', debounce(async () => { LF.q = i.value; const p = i.selectionStart; await render(); const n = $('#lib-q'); n.focus(); n.setSelectionRange(p, p); }, 200));
    $('#lib-arch').addEventListener('change', e => { LF.showArchived = e.target.checked; render(); });
  },
};
A['ex-edit'] = el => {
  const id = +el.dataset.id, e = id ? exById(id) : { id: 0, name: '', muscle: 'chest', muscles2: '', equipment: 'barbell', rest_sec: 90, aliases: '', notes: '' };
  const sel = (arr, cur, fmt) => arr.map(x => H`<option value="${x}" ${x === cur ? 'selected' : ''}>${fmt ? fmt(x) : x}</option>`);
  modal(H`<h3>${id ? 'Edit exercise' : 'New exercise'}</h3>
    <div class="field"><label>Name</label><input id="ex-name" value="${e.name}" autofocus></div>
    <div class="grid2"><div class="field"><label>Main muscle</label><select id="ex-muscle">${sel(MUSCLES, e.muscle, muscleName)}</select></div>
      <div class="field"><label>Also works</label><select id="ex-m2"><option value="">none</option>${sel(MUSCLES, e.muscles2, muscleName)}</select></div></div>
    <div class="grid2"><div class="field"><label>Equipment</label><select id="ex-eq">${sel(EQUIP, e.equipment)}</select></div>
      <div class="field"><label>Rest (seconds)</label><input id="ex-rest" type="number" min="10" max="900" value="${e.rest_sec}"></div></div>
    <div class="field"><label>Nicknames <em>comma separated, used when you type</em></label><input id="ex-alias" value="${e.aliases || ''}" placeholder="bp, flat bench"></div>
    <div class="field"><label>Notes</label><input id="ex-notes" value="${e.notes || ''}"></div>
    <div class="row between gap">${id ? H`<button class="btn danger ghost" data-act="ex-del" data-id="${id}">${e.archived ? 'Delete' : 'Remove'}</button>` : '<span></span>'}
      <div class="row gap"><button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn" data-act="ex-save" data-id="${id}">Save</button></div></div>`);
};
A['ex-save'] = async el => {
  const name = $('#ex-name').value.trim(); if (!name) return toast('Give it a name', 'bad');
  try {
    await api('/exercises', 'POST', { id: +el.dataset.id, name, muscle: $('#ex-muscle').value, muscles2: $('#ex-m2').value, equipment: $('#ex-eq').value, rest_sec: parseInt($('#ex-rest').value, 10) || 90, aliases: $('#ex-alias').value, notes: $('#ex-notes').value });
    closeModal(); await loadBoot(); toast('Saved'); render();
  } catch (e) { toast(e.message, 'bad'); }
};
A['ex-del'] = async el => {
  if (!(await confirmDialog('Remove this exercise? If you have logged it before it is archived so your history stays intact.', 'Remove'))) return;
  const r = await api('/exercises/' + el.dataset.id, 'DELETE');
  await loadBoot(); toast(r.archived ? 'Archived (it has history)' : 'Deleted'); render();
};

/* ================= Routine ================= */
V.routine = {
  async render() {
    const rows = DOW.map((n, i) => ({ n, i, r: S.boot.schedule.find(x => x.dow === i) || { dow: i, template_id: null } }));
    return H`
    <header class="top"><div><div class="eyebrow">Your week</div><h1>Routine</h1></div></header>
    <div class="home-grid">
      <section class="card rise"><h2>Weekly schedule</h2><ul class="sched">${rows.map(({ n, i, r }) => H`<li class="${i === dowOf(todayStr()) ? 'today' : ''}"><span>${n}</span>
        <select data-act-change="sched" data-dow="${i}"><option value="">Rest</option>${S.boot.templates.map(t => H`<option value="${t.id}" ${r.template_id === t.id ? 'selected' : ''}>${t.name}</option>`)}</select></li>`)}</ul>
        <p class="muted small">Rest days count toward your streak. Playing basketball or running on a rest day is fine, just log it.</p></section>
      <section class="card rise" style="--i:1"><div class="row between"><h2>Workouts</h2><button class="btn ghost sm" data-act="tpl-edit" data-id="0">+ New</button></div>
        <ul class="tpls">${S.boot.templates.map(t => H`<li><button data-act="tpl-edit" data-id="${t.id}"><b>${t.name}</b><span>${t.items.map(id => exById(id)).filter(Boolean).map(e => e.name).join(' · ') || 'empty'}</span></button></li>`)}</ul></section>
    </div>`;
  },
};
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset && el.dataset.actChange === 'sched') {
    const dow = +el.dataset.dow, tid = el.value ? +el.value : null;
    await api('/schedule', 'PUT', { rows: [{ dow, template_id: tid, label: '' }] });
    const r = S.boot.schedule.find(x => x.dow === dow); if (r) r.template_id = tid; else S.boot.schedule.push({ dow, template_id: tid, label: '' });
    toast('Schedule updated');
  }
});
let TE = null;
function tplEditor() {
  const ex = TE.items.map(id => exById(id)).filter(Boolean);
  modal(H`<h3>${TE.id ? 'Edit workout' : 'New workout'}</h3>
    <div class="field"><label>Name</label><input id="tp-name" value="${TE.name}" autofocus></div>
    <ul class="tp-items">${ex.map((e, i) => H`<li><span>${e.name}</span><button class="icon" data-act="tp-mv" data-i="${i}" data-d="-1">↑</button><button class="icon" data-act="tp-mv" data-i="${i}" data-d="1">↓</button><button class="icon" data-act="tp-rm" data-i="${i}">×</button></li>`)}</ul>
    <select id="tp-add"><option value="">+ Add exercise…</option>${activeEx().filter(e => !TE.items.includes(e.id)).map(e => H`<option value="${e.id}">${e.name}</option>`)}</select>
    <div class="row between gap">${TE.id ? H`<button class="btn danger ghost" data-act="tp-del">Delete</button>` : '<span></span>'}<div class="row gap"><button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn" data-act="tp-save">Save</button></div></div>`);
  $('#tp-add').addEventListener('change', e => { if (e.target.value) { TE.name = $('#tp-name').value; TE.items.push(+e.target.value); tplEditor(); } });
}
A['tpl-edit'] = el => { const id = +el.dataset.id, t = id ? tplById(id) : { id: 0, name: '', items: [] }; TE = { id, name: t.name, items: t.items.slice() }; tplEditor(); };
A['tp-mv'] = el => { TE.name = $('#tp-name').value; const i = +el.dataset.i, j = i + +el.dataset.d; if (j < 0 || j >= TE.items.length) return; [TE.items[i], TE.items[j]] = [TE.items[j], TE.items[i]]; tplEditor(); };
A['tp-rm'] = el => { TE.name = $('#tp-name').value; TE.items.splice(+el.dataset.i, 1); tplEditor(); };
A['tp-save'] = async () => {
  const name = $('#tp-name').value.trim(); if (!name) return toast('Give it a name', 'bad');
  try { await api('/templates', 'POST', { id: TE.id, name, items: TE.items }); closeModal(); await loadBoot(); toast('Workout saved'); render(); } catch (e) { toast(e.message, 'bad'); }
};
A['tp-del'] = async () => {
  if (!(await confirmDialog('Delete this workout? Logged sessions are kept.'))) return;
  await api('/templates/' + TE.id, 'DELETE'); await loadBoot(); toast('Deleted'); render();
};

/* ================= Settings ================= */
const seg = (k, opts, cur) => H`<div class="chips">${opts.map(([v, l]) => H`<button class="chip ${String(cur) === v ? 'on' : ''}" data-act="set" data-k="${k}" data-v="${v}">${l}</button>`)}</div>`;
V.settings = {
  async render() {
    const b = S.boot;
    return H`
    <header class="top"><div><div class="eyebrow">Hadid ${b.version || ''}</div><h1>Settings</h1></div></header>
    <div class="home-grid">
      <section class="card rise"><h2>Look & feel</h2>
        <div class="srow"><span>Theme</span>${seg('theme', [['dark', 'Dark'], ['light', 'Light']], setting('theme') || 'dark')}</div>
        <div class="srow"><span>Units</span>${seg('units', [['kg', 'kg'], ['lb', 'lb']], unit())}</div>
        <div class="srow"><span>Sound</span>${seg('sound', [['1', 'On'], ['0', 'Off']], setting('sound') || '1')}</div>
        <div class="srow"><span>Reduce effects</span>${seg('reduce_fx', [['0', 'Off'], ['1', 'On']], setting('reduce_fx') || '0')}</div></section>
      <section class="card rise" style="--i:1"><h2>Training</h2>
        <div class="srow"><span>Weekly goal</span>${seg('week_goal', [['3', '3'], ['4', '4'], ['5', '5'], ['6', '6']], setting('week_goal') || '4')}<em>days</em></div>
        <div class="srow"><span>Evening nudge</span>${seg('nudge_hour', [['19', '7 pm'], ['20', '8 pm'], ['21', '9 pm'], ['22', '10 pm']], setting('nudge_hour') || '20')}</div>
        <div class="srow"><span>Auto rest timer</span>${seg('rest_auto', [['1', 'On'], ['0', 'Off']], setting('rest_auto') || '1')}</div>
        <div class="srow"><span>Rest beeps</span>${seg('rest_beep', [['1', 'On'], ['0', 'Off']], setting('rest_beep') || '1')}</div>
        <div class="srow"><span>Default bar</span>${seg('bar_kg', [['20', '20 kg'], ['15', '15 kg']], setting('bar_kg') || '20')}</div></section>
      <section class="card rise" style="--i:2"><h2>Your data</h2>
        ${b.local ? H`<p class="muted small">Everything stays on this phone, inside the app, and nothing is uploaded. <b>Uninstalling the app erases it</b>, so back up now and then and keep the file somewhere safe (Drive, or WhatsApp it to yourself).</p>
          <div class="row gap wrap"><button class="btn" data-act="backup">Back up now</button><button class="btn ghost" data-act="restore">Restore backup</button><button class="btn ghost" data-act="export-csv">Export CSV</button><button class="btn ghost" data-act="prs-rebuild">Rebuild PRs</button></div>
          <input type="file" id="restore-file" hidden>`
        : H`<p class="muted small">Everything stays on this computer, in <code>${b.dataDir}</code>. A backup is made automatically once a day and the last 14 are kept.</p>
          <div class="row gap wrap"><button class="btn" data-act="backup">Back up now</button><a class="btn ghost" href="/api/export.csv" download>Export CSV</a><button class="btn ghost" data-act="prs-rebuild">Rebuild PRs</button></div>`}</section>
      ${b.local ? '' : H`<section class="card rise" style="--i:3"><h2>Shortcuts</h2>
        <dl class="keys"><dt>L</dt><dd>Log today</dd><dt>H</dt><dd>Home</dd><dt>M</dt><dd>Live mode</dd><dt>P</dt><dd>PR wall</dd><dt>T</dt><dd>Plate calculator</dd><dt>Y</dt><dd>History</dd><dt>Ctrl ↵</dt><dd>Save the log</dd></dl></section>`}
    </div>`;
  },
};
A.set = async el => { await saveSettings({ [el.dataset.k]: el.dataset.v }); render(); };
A.backup = async () => { try { const r = await api('/backup', 'POST'); toast(S.boot.local ? 'Backup ready: ' + r.file : 'Backed up: ' + r.file); } catch (e) { toast(e.message, 'bad'); } };
A['export-csv'] = async () => {
  try { await window.HadidSaveFile(`hadid-export-${todayStr()}.csv`, await window.HadidLocal.exportCSV(), 'text/csv'); toast('CSV ready'); } catch (e) { toast(e.message, 'bad'); }
};
A.restore = () => $('#restore-file').click();
document.addEventListener('change', async e => {
  if (e.target.id !== 'restore-file' || !e.target.files[0]) return;
  const f = e.target.files[0]; e.target.value = '';
  if (!(await confirmDialog('Replace everything in the app with this backup? Your current data will be overwritten.', 'Restore'))) return;
  try {
    const r = await window.HadidLocal.importDB(new Uint8Array(await f.arrayBuffer()));
    await loadBoot(); S.ghostsFor = ''; toast(`Restored ${r.activities} sessions`); go('/home');
  } catch (err) { toast(err.message, 'bad'); }
});
A['prs-rebuild'] = async () => { try { await api('/prs/rebuild', 'POST'); toast('PRs rebuilt from your history'); } catch (e) { toast(e.message, 'bad'); } };
