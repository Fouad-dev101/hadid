'use strict';
/* Hadid app shell: router, home, logging. More views live in views.js. */

const V = {};   // views: V.name = { render(...args) -> Safe, mount(root, ...args) }
const A = {};   // click actions: <button data-act="name">

const exById = id => S.boot.exercises.find(e => e.id === id);
const activeEx = () => S.boot.exercises.filter(e => !e.archived);
const tplById = id => S.boot.templates.find(t => t.id === id);
const go = path => { if (location.hash === '#' + path) render(); else location.hash = path; };

/* ---------- data ---------- */
async function loadBoot() { S.boot = await api('/bootstrap'); applyTheme(); }
async function loadDays() { S.days = await api('/days'); }
async function ensureGhosts(before) {
  if (S.ghostsFor === before) return;
  S.ghosts = await api('/ghosts?before=' + before);
  S.ghostsFor = before;
}
const daysIndex = () => { const m = {}; for (const a of S.days) (m[a.day] = m[a.day] || []).push(a); return m; };
const planRow = day => S.boot.schedule.find(r => r.dow === dowOf(day));
const planFor = day => { const r = planRow(day); return r && r.template_id ? tplById(r.template_id) || null : null; };
const isPlannedRest = day => { const r = planRow(day); return !!r && !r.template_id; };

function streak() {
  const idx = daysIndex(), first = S.days.length ? S.days[0].day : null;
  if (!first) return 0;
  const kept = d => d >= first && (idx[d] || isPlannedRest(d));
  let d = todayStr(), n = 0;
  if (!kept(d)) d = addDays(d, -1);   // today isn't over yet: it can't break the streak
  while (kept(d) && n < 4000) { n++; d = addDays(d, -1); }
  return n;
}
function weekStats(ws) {
  const acts = S.days.filter(a => a.day >= ws && a.day <= addDays(ws, 6) && a.kind !== 'rest');
  return { acts, load: sum(acts, loadOf), min: sum(acts, a => a.duration_min || 0), days: unique(acts.map(a => a.day)).length,
    by: k => acts.filter(a => a.kind === k) };
}

/* ---------- stacking warning: hard legs next to a hard game / long run ---------- */
const isLegs = a => a.kind === 'lift' && /leg/i.test(a.subtype) && a.rpe >= 7;
const isHardOther = a => (a.kind === 'basketball' && (a.subtype === 'game' || a.rpe >= 8 || a.explosive) && a.duration_min >= 40)
  || (a.kind === 'run' && (a.dist_m >= 12000 || a.rpe >= 8 || (a.subtype === 'long' && a.dist_m >= 9000)));
function stackWarning(cand) {
  const near = S.days.filter(a => a.id !== cand.id && (a.day === cand.day || a.day === addDays(cand.day, -1)));
  if (cand.kind === 'lift' && cand.legs) {
    const h = near.find(isHardOther);
    if (h) return `Hard legs ${h.day === cand.day ? 'on top of' : 'right after'} a ${h.kind === 'run' ? (h.subtype || '') + ' run' : (h.subtype || 'basketball session')} (RPE ${h.rpe}, ${h.duration_min} min). Keep it lighter or swap in an upper day.`;
  }
  if ((cand.kind === 'basketball' || cand.kind === 'run') && isHardOther({ ...cand, duration_min: cand.duration, dist_m: cand.dist_m })) {
    const l = near.find(isLegs);
    if (l) return `Heavy legs ${l.day === cand.day ? 'earlier today' : 'yesterday'} and a hard session now. Watch the load, and give the legs a day after.`;
  }
  return '';
}

/* ---------- router ---------- */
async function render() {
  const [name, ...args] = (location.hash.slice(2) || 'home').split('/');
  const v = V[name] || V.home, nav = V[name] ? name : 'home';
  const main = $('#view');
  const draw = async () => {
    let out;
    try { out = await v.render(...args); } catch (e) { out = H`<div class="empty">Something went wrong: ${e.message}</div>`; console.error(e); }
    show(main, out);
    main.scrollTop = 0;
    if (v.mount) v.mount(main, ...args);
    runCounters(main);
    $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === nav));
  };
  if (document.startViewTransition && !reduced()) await document.startViewTransition(draw).updateCallbackDone.catch(() => {});
  else await draw();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const f = A[el.dataset.act];
  if (f) { e.preventDefault(); f(el, e); }
});
A['modal-close'] = closeModal;

/* ---------- Home: Log today ---------- */
V.home = {
  async render() {
    await loadDays();
    S.logDay = null;
    const t = todayStr(), idx = daysIndex(), todays = idx[t] || [];
    const ws = weekStart(t), wk = weekStats(ws), goal = +setting('week_goal') || 5, sk = streak();
    const plan = planFor(t), rest = isPlannedRest(t);
    await ensureGhosts(addDays(t, 1));
    const evening = new Date().getHours() >= (+setting('nudge_hour') || 20);
    const weeks = Array.from({ length: 8 }, (_, i) => addDays(ws, -7 * (7 - i)));
    const groups = weeks.map(w => {
      const s = weekStats(w);
      return { label: fmtDay(w, { day: 'numeric', month: 'short' }), parts: ['lift', 'basketball', 'run', 'other'].map(k => ({ cls: 'k-' + k, v: sum(s.by(k), loadOf), tip: `${KIND[k]}: ${sum(s.by(k), loadOf)} AU` })) };
    });
    const lastWk = weekStats(addDays(ws, -7));
    const planList = plan ? plan.items.map(id => exById(id)).filter(Boolean) : [];
    return H`
    <header class="top">
      <div><div class="eyebrow">${fmtDay(t, { weekday: 'long' })}</div><h1>${fmtDay(t, { day: 'numeric', month: 'long' })}</h1></div>
      <div class="stats">
        <div class="stat"><b data-count="${sk}">0</b><span>day streak</span></div>
        <div class="stat"><b><i data-count="${wk.days}">0</i><small>/${goal}</small></b><span>days trained</span></div>
        <div class="stat"><b data-count="${wk.load}">0</b><span>load this week</span></div>
      </div>
    </header>
    ${(!todays.length && evening) ? H`<div class="nudge rise"><div><b>Log today?</b><span>Nothing logged yet. Takes under a minute.</span></div>
      <div class="row gap"><button class="btn ghost" data-act="rest-day">Rest day</button><button class="btn" data-act="go" data-to="/log">Log today</button></div></div>` : ''}
    <div class="home-grid">
      <section class="hero rise">
        <button class="dial-btn" data-act="go" data-to="/log" aria-label="Log today">${plateDial({ frac: wk.days / goal, sub: fmtDay(t, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase(), foot: sk ? `${sk} DAY STREAK` : 'START A STREAK', top: 'HADID · IRON · حديد', bottom: `${wk.days} OF ${goal} DAYS THIS WEEK` })}</button>
        <div class="quick">
          ${['lift', 'run', 'basketball', 'other'].map(k => H`<button class="chip big k-${k}" data-act="go" data-to="/log/${k}"><i></i>${KIND[k]}</button>`)}
        </div>
      </section>
      <div class="col">
        <section class="card rise" style="--i:1">
          <h2>Today's plan</h2>
          ${plan ? H`<div class="plan-name">${plan.name}</div>
            <ul class="plan-list">${planList.map(e => { const g = S.ghosts[e.id]; const top = g ? P.overload(g.sets, e.equipment) : null;
              return H`<li><span>${e.name}</span><em>${top ? `${fmtW(top.top.w10)}×${top.top.reps}` : ''}</em></li>`; })}</ul>
            <div class="row gap"><button class="btn" data-act="go" data-to="/log/lift/${plan.id}">Log it</button><button class="btn ghost" data-act="go" data-to="/live/${plan.id}">Live mode</button></div>`
          : rest ? H`<div class="plan-name">Rest day</div><p class="muted">Recovery is training. Log it and the streak keeps going.</p>
            <button class="btn ghost" data-act="rest-day">Log rest day</button>`
          : H`<p class="muted">Nothing planned. Set your split in Routine.</p>`}
        </section>
        <section class="card rise" style="--i:2">
          <h2>Logged today</h2>
          ${todays.length ? H`<ul class="today-list">${todays.map(a => H`<li><button data-act="go" data-to="/log/edit/${a.id}"><i class="dot k-${a.kind}"></i><span>${a.kind === 'rest' ? 'Rest day' : (a.subtype || KIND[a.kind])}</span><em>${a.kind === 'rest' ? '' : `${a.duration_min} min · RPE ${a.rpe}`}</em></button></li>`)}</ul>`
            : H`<p class="muted">Nothing yet. Pick an activity or hit the plate.</p>`}
        </section>
      </div>
    </div>
    <section class="card wide rise" style="--i:3">
      <div class="row between"><h2>Training load</h2><div class="legend"><span class="k-lift">Lifting</span><span class="k-basketball">Basketball</span><span class="k-run">Run</span><span class="k-other">Other</span></div></div>
      <p class="muted small">Duration × effort, every activity together. This week <b>${wk.load.toLocaleString('en-US')}</b> · last week <b>${lastWk.load.toLocaleString('en-US')}</b></p>
      ${barChart(groups, { h: 190 })}
    </section>`;
  },
};
A.go = el => go(el.dataset.to);
A['rest-day'] = async () => {
  await api('/rest', 'POST', { day: todayStr() });
  sfx.clank(); toast('Rest day logged. Streak kept.');
  render();
};

/* ---------- Log: picker + forms ---------- */
const KIND_DEFAULT = {
  lift: { duration: 60, rpe: 7, subtype: '' },
  run: { duration: 30, rpe: 6, subtype: 'easy' },
  basketball: { duration: 90, rpe: 7, subtype: 'practice' },
  other: { duration: 30, rpe: 3, subtype: 'Walk' },
};
function newDraft(kind, tplId) {
  const day = S.logDay || todayStr(), d = KIND_DEFAULT[kind];
  const dr = { id: 0, day, kind, subtype: d.subtype, text: '', duration: d.duration, rpe: d.rpe, notes: '', km: '', time: '', felt: 3, explosive: 0, points: '', newMuscle: {} };
  if (kind === 'lift') {
    const tpl = tplId ? tplById(+tplId) : planFor(day);
    if (tpl) { dr.subtype = tpl.name; dr.text = tpl.items.map(id => exById(id)).filter(Boolean).map(e => e.name + ' ').join('\n'); }
    try {
      const saved = JSON.parse(localStorage.getItem('hadid.draft') || 'null');
      if (saved && saved.day === day && saved.kind === 'lift' && saved.text && !tplId) { Object.assign(dr, saved); setTimeout(() => toast('Draft restored'), 300); }
    } catch (e) { /* ignore */ }
  }
  return dr;
}
function draftFromActivity(a) {
  const dr = { id: a.id, day: a.day, kind: a.kind, subtype: a.subtype, text: '', duration: a.duration_min, rpe: a.rpe, notes: a.notes,
    km: a.dist_m ? String(a.dist_m / 1000) : '', time: a.kind === 'run' ? String(a.duration_min) : '', felt: a.felt || 3, explosive: a.explosive, points: a.points || '', newMuscle: {} };
  if (a.kind === 'lift') {
    const lines = []; let cur = null;
    for (const s of a.sets) {
      if (!cur || cur.id !== s.exercise_id || cur.grp !== s.grp) { cur = { id: s.exercise_id, name: s.ex_name, grp: s.grp, sets: [] }; lines.push(cur); }
      cur.sets.push(s);
    }
    dr.text = lines.map((l, i) => (l.grp && i && lines[i - 1].grp === l.grp ? '& ' : '') + P.setsToText(l.name, l.sets, fmtW)).join('\n');
  }
  return dr;
}

V.log = {
  async render(a, b) {
    await loadDays();
    if (a === 'edit') {
      const acts = await api(`/activities?id=${+b}`);
      const act = acts[0];
      if (!act) return H`<div class="empty">That entry no longer exists.</div>`;
      if (act.kind === 'rest') {
        S.draft = null;
        return H`<header class="top"><div><div class="eyebrow">${relDay(act.day)}</div><h1>Rest day</h1></div></header>
          <section class="card"><p class="muted">Logged as a rest day. It keeps your streak going.</p>
          <div class="row gap mt"><button class="btn ghost" data-act="go" data-to="/home">Back</button><button class="btn danger" data-act="del-act" data-id="${act.id}">Remove rest day</button></div></section>`;
      }
      S.draft = draftFromActivity(act);
    } else if (KIND[a] && a !== 'rest') S.draft = newDraft(a, b);
    else S.draft = null;
    if (!S.draft) return logPicker();
    await ensureGhosts(S.draft.day);
    return logForm();
  },
  mount(root) { if (S.draft) mountLog(root); else runCounters(root); },
};

function logPicker() {
  const day = S.logDay || todayStr(), logged = daysIndex()[day] || [];
  return H`
  <header class="top"><div><div class="eyebrow">Evening log</div><h1>What did you do?</h1></div>${dayPicker(day)}</header>
  <div class="picker">
    ${['lift', 'run', 'basketball', 'other'].map((k, i) => H`<button class="tile rise k-${k}" style="--i:${i}" data-act="go" data-to="/log/${k}">
      <i class="tile-ic">${raw(ICONS[k])}</i><b>${KIND[k]}</b><span>${{ lift: 'Type your sets, we parse them', run: 'Distance, time, pace', basketball: 'Practice, game or pickup', other: 'Walk, swim, stretching…' }[k]}</span></button>`)}
    <button class="tile rest rise" style="--i:4" data-act="rest-for-day"><i class="tile-ic">${raw(ICONS.rest)}</i><b>Rest day</b><span>Keeps the streak. One tap.</span></button>
  </div>
  ${logged.length ? H`<section class="card"><h2>Already logged ${relDay(day).toLowerCase()}</h2><ul class="today-list">${logged.map(a => H`<li><button data-act="go" data-to="/log/edit/${a.id}"><i class="dot k-${a.kind}"></i><span>${a.kind === 'rest' ? 'Rest day' : (a.subtype || KIND[a.kind])}</span><em>${a.kind === 'rest' ? '' : `${a.duration_min} min · RPE ${a.rpe}`}</em></button></li>`)}</ul></section>` : ''}`;
}
const ICONS = {
  lift: '<svg viewBox="0 0 48 48"><rect x="2" y="21" width="44" height="6" rx="2"/><rect x="8" y="9" width="6" height="30" rx="2"/><rect x="34" y="9" width="6" height="30" rx="2"/><rect x="15" y="14" width="4" height="20" rx="1"/><rect x="29" y="14" width="4" height="20" rx="1"/></svg>',
  run: '<svg viewBox="0 0 48 48"><circle cx="30" cy="9" r="4"/><path d="M26 16l-8 6 3 5 6-3 3 7-6 9h5l6-9-3-9 5 2 3-5-8-4z"/></svg>',
  basketball: '<svg viewBox="0 0 48 48" fill="none" stroke-width="3"><circle cx="24" cy="24" r="18"/><path d="M6 24h36M24 6v36M11 11c8 6 8 20 0 26M37 11c-8 6-8 20 0 26"/></svg>',
  other: '<svg viewBox="0 0 48 48"><path d="M6 36c6-4 10-4 14 0s8 4 12 0 8-4 10 0v6H6z"/><circle cx="31" cy="14" r="5"/><path d="M12 30l10-8 8 4"/></svg>',
  rest: '<svg viewBox="0 0 48 48"><path d="M32 6a18 18 0 1 0 10 28A15 15 0 0 1 32 6z"/></svg>',
};
A['rest-for-day'] = async () => {
  const day = S.logDay || todayStr();
  await api('/rest', 'POST', { day }); sfx.clank(); toast(`Rest day logged for ${relDay(day).toLowerCase()}`);
  go('/home');
};

function dayPicker(day) {
  return H`<div class="daypick"><button class="icon" data-act="day-shift" data-n="-1" aria-label="Previous day">‹</button>
    <input type="date" value="${day}" data-bind="day" max="${addDays(todayStr(), 1)}"><button class="icon" data-act="day-shift" data-n="1" aria-label="Next day">›</button>
    <button class="btn ghost sm" data-act="day-set" data-d="today">Today</button><button class="btn ghost sm" data-act="day-set" data-d="yesterday">Yesterday</button></div>`;
}
A['day-shift'] = el => setLogDay(addDays((S.draft ? S.draft.day : (S.logDay || todayStr())), +el.dataset.n));
A['day-set'] = el => setLogDay(el.dataset.d === 'today' ? todayStr() : addDays(todayStr(), -1));
async function setLogDay(day) {
  S.logDay = day;
  if (S.draft) { S.draft.day = day; await ensureGhosts(day); const inp = $('#log input[type=date]'); if (inp) inp.value = day; refreshLift(); refreshWarn(); }
  else render();
}

const RPE_WORD = ['', 'Very light', 'Light', 'Easy', 'Moderate', 'Steady', 'Hard-ish', 'Hard', 'Very hard', 'Near max', 'Max'];
function effortBlock(d, withDuration) {
  return H`<div class="effort">
    ${withDuration ? H`<div class="field"><label>Duration</label><div class="stepper">
      <button class="icon" data-act="dur" data-d="-5">−</button><input type="number" min="0" max="600" value="${d.duration}" data-bind="duration" inputmode="numeric"><span>min</span><button class="icon" data-act="dur" data-d="5">+</button></div></div>` : ''}
    <div class="field grow"><label>Effort <em id="rpe-word">${RPE_WORD[d.rpe] || ''}</em></label>
      <div class="rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => H`<button class="${n === d.rpe ? 'on' : ''}" style="--h:${n}" data-act="rpe" data-v="${n}">${n}</button>`)}</div></div>
    <div class="load" id="load"></div></div>`;
}

function logForm() {
  const d = S.draft, edit = d.id > 0;
  const body = {
    lift: () => H`
      <div class="field"><label>Workout</label><div class="chips" id="tpls">
        ${S.boot.templates.map(t => H`<button class="chip ${t.name === d.subtype ? 'on' : ''}" data-act="tpl" data-id="${t.id}">${t.name}${planFor(d.day) && planFor(d.day).id === t.id ? H`<i class="planned">planned</i>` : ''}</button>`)}
        <button class="chip ${d.subtype === 'Free' ? 'on' : ''}" data-act="tpl" data-id="0">Free</button></div></div>
      <div class="field"><label>Sets <em>type freely, e.g. bench 60x8, 65x8, 70x6</em></label>
        <div class="typebox"><textarea id="lift-text" rows="9" spellcheck="false" autocomplete="off" placeholder="bench 60x8, 65x8, 70x6&#10;incline db 25x8 27.5x7&#10;& pushdown 50x15   (& = superset)">${d.text}</textarea><div id="ac" class="ac"></div></div>
        <div class="row gap wrap"><button class="btn ghost sm" data-act="copy-last">Copy last “${d.subtype || 'session'}”</button><button class="btn ghost sm" data-act="fill-tpl">Fill from template</button>
          <span class="hint">Tab accepts a suggestion · w40x10 warm-up · d30x8 drop set · x10@8 RPE</span></div></div>
      ${effortBlock(d, true)}`,
    run: () => H`
      <div class="grid2"><div class="field"><label>Distance</label><div class="stepper"><input type="number" step="0.01" min="0" value="${d.km}" data-bind="km" placeholder="5.0"><span>km</span></div></div>
        <div class="field"><label>Time <em>mm:ss or minutes</em></label><div class="stepper"><input type="text" value="${d.time}" data-bind="time" placeholder="28:30" inputmode="numeric"></div></div></div>
      <div class="pace" id="pace"></div>
      <div class="field"><label>Type</label><div class="chips">${['easy', 'tempo', 'intervals', 'long'].map(x => H`<button class="chip ${d.subtype === x ? 'on' : ''}" data-act="sub" data-v="${x}">${x}</button>`)}</div></div>
      <div class="field"><label>How it felt</label><div class="chips">${['Rough', 'Heavy', 'Ok', 'Good', 'Flying'].map((x, i) => H`<button class="chip ${d.felt === i + 1 ? 'on' : ''}" data-act="felt" data-v="${i + 1}">${x}</button>`)}</div></div>
      ${effortBlock(d, false)}`,
    basketball: () => H`
      <div class="field"><label>Session</label><div class="chips">${['practice', 'game', 'pickup'].map(x => H`<button class="chip ${d.subtype === x ? 'on' : ''}" data-act="sub" data-v="${x}">${x}</button>`)}</div></div>
      <div class="grid2"><div class="field"><label>Minutes played</label><div class="stepper"><button class="icon" data-act="dur" data-d="-5">−</button><input type="number" min="0" value="${d.duration}" data-bind="duration"><span>min</span><button class="icon" data-act="dur" data-d="5">+</button></div></div>
        <div class="field"><label>Points <em>optional</em></label><div class="stepper"><input type="number" min="0" value="${d.points}" data-bind="points" placeholder="–"></div></div></div>
      <label class="switch"><input type="checkbox" data-bind="explosive" ${d.explosive ? 'checked' : ''}><i></i><span>Explosive session <em>jumps, sprints, contact</em></span></label>
      ${effortBlock(d, false)}`,
    other: () => H`
      <div class="field"><label>What</label><div class="chips">${['Walk', 'Swim', 'Stretching', 'Cycling', 'Mobility'].map(x => H`<button class="chip ${d.subtype === x ? 'on' : ''}" data-act="sub" data-v="${x}">${x}</button>`)}</div>
        <input type="text" value="${d.subtype}" data-bind="subtype" placeholder="or type anything" class="mt"></div>
      <div class="field"><label>Duration</label><div class="stepper"><button class="icon" data-act="dur" data-d="-5">−</button><input type="number" min="0" value="${d.duration}" data-bind="duration"><span>min</span><button class="icon" data-act="dur" data-d="5">+</button></div></div>
      ${effortBlock(d, false)}`,
  }[d.kind]();
  return H`<div id="log" class="log ${d.kind}">
    <header class="top"><div><div class="eyebrow">${edit ? 'Editing' : 'Evening log'}</div><h1>${KIND[d.kind]}</h1></div>${dayPicker(d.day)}</header>
    ${edit ? '' : H`<nav class="kinds">${['lift', 'run', 'basketball', 'other'].map(k => H`<button class="${k === d.kind ? 'on' : ''} k-${k}" data-act="go" data-to="/log/${k}"><i></i>${KIND[k]}</button>`)}</nav>`}
    <div class="log-grid">
      <div class="log-main">${body}
        <div class="warn" id="warn" hidden></div>
        <div class="field"><label>Notes <em>optional</em></label><input type="text" value="${d.notes}" data-bind="notes" placeholder="How did it go?"></div>
      </div>
      ${d.kind === 'lift' ? H`<aside class="preview" id="preview"></aside>` : ''}
    </div>
    <div class="savebar"><div class="grow muted small" id="savehint"></div>
      ${edit ? H`<button class="btn danger ghost" data-act="del-act" data-id="${d.id}">Delete</button>` : ''}
      <button class="btn big" id="save" data-act="save">${edit ? 'Save changes' : 'Save'} <kbd>Ctrl ↵</kbd></button></div>
  </div>`;
}

/* ---- log form behaviour ---- */
function parseTime(str) {  // "28:30" -> 28.5 min, "1:05:00" -> 65, "30" -> 30
  const s = String(str || '').trim(); if (!s) return 0;
  const p = s.split(':').map(Number); if (p.some(x => !isFinite(x))) return 0;
  if (p.length === 1) return p[0];
  if (p.length === 2) return p[0] + p[1] / 60;
  return p[0] * 60 + p[1] + p[2] / 60;
}
const saveDraftLocal = debounce(() => {
  try {
    if (S.draft && S.draft.kind === 'lift' && !S.draft.id && S.draft.text.trim()) localStorage.setItem('hadid.draft', JSON.stringify(S.draft));
  } catch (e) { /* storage may be off */ }
}, 400);

function mountLog(root) {
  const d = S.draft;
  const ta = $('#lift-text', root);
  if (ta) { ta.addEventListener('keydown', acKey); ta.addEventListener('keyup', e => { if (!['ArrowUp', 'ArrowDown', 'Tab', 'Escape'].includes(e.key)) updateAC(); }); ta.addEventListener('click', updateAC); ta.addEventListener('blur', () => setTimeout(hideAC, 150)); }
  refreshLift(); refreshWarn(); refreshLoad(); refreshPace();
  if (ta && !d.id) ta.focus();
  else if (!ta) { const f = $('.log-main input[type=number], .log-main input[type=text]', root); if (f && !d.id) f.focus(); }
}

document.addEventListener('input', e => {
  const el = e.target;
  if (!el.dataset || !el.dataset.bind || !S.draft || !$('#log')) return;
  const k = el.dataset.bind;
  if (k === 'day') { if (el.value) setLogDay(el.value); return; }
  S.draft[k] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
  if (['duration', 'rpe'].includes(k)) S.draft[k] = parseInt(el.value, 10) || 0;
  if (k === 'duration') refreshLoad();
  if (k === 'km' || k === 'time') { refreshPace(); refreshLoad(); }
  refreshWarn(); saveDraftLocal();
});
document.addEventListener('change', e => { const el = e.target; if (el.dataset && el.dataset.bind === 'day' && !$('#log') && el.value) setLogDay(el.value); });

A.dur = el => { const d = S.draft; d.duration = Math.max(0, (parseInt(d.duration, 10) || 0) + +el.dataset.d); const i = $('[data-bind=duration]'); if (i) i.value = d.duration; refreshLoad(); refreshWarn(); };
A.rpe = el => { S.draft.rpe = +el.dataset.v; $$('.rpe button').forEach(b => b.classList.toggle('on', b === el)); refreshLoad(); refreshWarn(); sfx.tick(); };
A.sub = el => { S.draft.subtype = el.dataset.v; $$('.chips .chip', el.parentElement).forEach(c => c.classList.toggle('on', c === el)); const t = $('[data-bind=subtype]'); if (t) t.value = el.dataset.v; refreshWarn(); };
A.felt = el => { S.draft.felt = +el.dataset.v; $$('.chips .chip', el.parentElement).forEach(c => c.classList.toggle('on', c === el)); };
A.tpl = el => {
  const d = S.draft, id = +el.dataset.id, tpl = id ? tplById(id) : null;
  d.subtype = tpl ? tpl.name : 'Free';
  if (tpl && !d.text.trim()) d.text = tpl.items.map(i => exById(i)).filter(Boolean).map(e => e.name + ' ').join('\n');
  $('#lift-text').value = d.text;
  $$('#tpls .chip').forEach(c => c.classList.toggle('on', c === el));
  const b = $('[data-act=copy-last]'); if (b) b.textContent = `Copy last “${d.subtype}”`;
  refreshLift(); refreshWarn(); saveDraftLocal();
};
A['fill-tpl'] = async el => {
  const d = S.draft, tpl = S.boot.templates.find(t => t.name === d.subtype) || planFor(d.day);
  if (!tpl) return toast('Pick a workout first');
  if (d.text.trim() && !(await confirmDialog('Replace what you typed with the template?', 'Replace'))) return;
  d.text = tpl.items.map(i => exById(i)).filter(Boolean).map(e => e.name + ' ').join('\n');
  $('#lift-text').value = d.text; refreshLift();
};
A['copy-last'] = async () => {
  const d = S.draft;
  const last = await api(`/lastlift?subtype=${encodeURIComponent(d.subtype || 'Free')}&before=${d.day}`);
  if (!last) return toast(`No earlier “${d.subtype || 'Free'}” session to copy`);
  if (d.text.trim() && d.text.replace(/\s/g, '') !== '' && /\d/.test(d.text) && !(await confirmDialog('Replace the sets you typed with last session’s?', 'Replace'))) return;
  const draft = draftFromActivity(last);
  d.text = draft.text; if (!d.id) { d.duration = draft.duration || d.duration; d.rpe = draft.rpe || d.rpe; }
  $('#lift-text').value = d.text;
  const di = $('[data-bind=duration]'); if (di) di.value = d.duration;
  $$('.rpe button').forEach(b => b.classList.toggle('on', +b.dataset.v === d.rpe));
  refreshLift(); refreshLoad(); toast(`Copied ${relDay(last.day).toLowerCase()}'s session. Change what differed.`);
};

function refreshLoad() {
  const el = $('#load'); if (!el) return;
  const d = S.draft, mins = d.kind === 'run' ? parseTime(d.time) : (parseInt(d.duration, 10) || 0);
  const l = Math.round(mins * (d.rpe || 0));
  el.innerHTML = `<span>Load</span><b>${l.toLocaleString('en-US')}</b><em>AU</em>`;
  const w = $('#rpe-word'); if (w) w.textContent = RPE_WORD[d.rpe] || '';
}
function refreshPace() {
  const el = $('#pace'); if (!el) return;
  const km = parseFloat(S.draft.km) || 0, mins = parseTime(S.draft.time);
  el.innerHTML = km && mins ? `<span>Pace</span><b>${fmtPace(km * 1000, mins)}</b><em>/km</em><span class="sp">Speed</span><b>${(km / (mins / 60)).toFixed(1)}</b><em>km/h</em>` : '<span class="muted">Pace is calculated automatically</span>';
}
function refreshWarn() {
  const el = $('#warn'); if (!el || !S.draft) return;
  const d = S.draft;
  const cand = { id: d.id, day: d.day, kind: d.kind, subtype: d.subtype, rpe: d.rpe, duration: parseInt(d.duration, 10) || 0, duration_min: d.kind === 'run' ? parseTime(d.time) : (parseInt(d.duration, 10) || 0),
    explosive: d.explosive, dist_m: Math.round((parseFloat(d.km) || 0) * 1000) };
  if (d.kind === 'lift') {
    const lines = P.parse(d.text, activeEx(), { unit: unit() });
    cand.legs = /leg/i.test(d.subtype) || lines.some(l => l.ex && LEG_MUSCLES.includes(l.ex.muscle) && l.sets.length);
  }
  const msg = stackWarning(cand);
  el.hidden = !msg; el.textContent = msg ? '⚠ ' + msg : '';
}

/* ---- live preview of the typed sets ---- */
const volOfSets = sets => sum(sets.filter(s => s.kind !== 'warm'), s => (s.w10 || 0) * s.reps);
function refreshLift() {
  const box = $('#preview'); if (!box) return;
  const d = S.draft, lines = P.parse(d.text, activeEx(), { unit: unit() });
  S.parsed = lines;
  if (!lines.length) { box.innerHTML = '<div class="pv-empty"><b>Live preview</b><p>Your sets show up here as you type, with last session’s numbers beside them.</p></div>'; return; }
  const allSets = lines.flatMap(l => l.sets), work = allSets.filter(s => s.kind !== 'warm');
  box.innerHTML = lines.map((l, i) => {
    const ex = l.ex, g = ex && S.ghosts[ex.id], ov = g && ex ? P.overload(g.sets, ex.equipment) : null;
    const chips = l.sets.map(s => `<span class="set ${s.kind}">${s.kind === 'warm' ? 'w ' : s.kind === 'drop' ? 'd ' : ''}${s.w10 ? fmtW(s.w10) : 'BW'}<i>×</i>${s.reps}${s.rpe10 ? `<sub>@${s.rpe10 / 10}</sub>` : ''}</span>`).join('');
    let delta = '';
    if (ov && l.sets.length) {
      const top = l.sets.filter(s => s.kind !== 'warm').reduce((a, s) => (!a || s.w10 > a.w10 || (s.w10 === a.w10 && s.reps > a.reps) ? s : a), null);
      if (top) { const dw = top.w10 - ov.top.w10; delta = dw > 0 ? `<b class="up">+${fmtW(dw)} ${unit()}</b>` : dw < 0 ? `<b class="down">${fmtW(dw)} ${unit()}</b>` : top.reps > ov.top.reps ? `<b class="up">+${top.reps - ov.top.reps} rep${top.reps - ov.top.reps > 1 ? 's' : ''}</b>` : ''; }
    }
    const status = l.status === 'new' ? `<div class="pv-new">New exercise “${esc(l.nameText)}”. It'll be added to your library.
        <select data-act-change="newmuscle" data-name="${esc(l.nameText)}">${MUSCLES.map(m => `<option value="${m}" ${(d.newMuscle[l.nameText] || 'other') === m ? 'selected' : ''}>${muscleName(m)}</option>`).join('')}</select></div>`
      : l.status === 'noname' ? '<div class="pv-new">Add an exercise name before the sets.</div>' : '';
    return `<div class="pv-line ${l.status}" style="--i:${i}">
      <div class="pv-head">${l.grp ? '<span class="ss">SS</span>' : ''}<b>${ex ? esc(ex.name) : esc(l.nameText || '…')}</b>${ex ? `<em class="eq">${ex.equipment}</em>` : ''}${delta}</div>
      <div class="sets">${chips || '<span class="muted small">no sets yet</span>'}</div>
      ${g ? `<div class="ghost">Last · ${esc(relDay(g.day))} · ${g.sets.map(s => `${s.w10 ? fmtW(s.w10) : 'BW'}×${s.reps}`).join('  ')}</div>` : (ex ? '<div class="ghost">First time logging this</div>' : '')}
      ${ov ? `<div class="sug">Try ${ov.a ? `<button data-act="sug" data-i="${i}" data-w="${ov.a.w10}" data-r="${ov.a.reps}">${fmtW(ov.a.w10)}×${ov.a.reps}</button> or ` : ''}<button data-act="sug" data-i="${i}" data-w="${ov.b.w10}" data-r="${ov.b.reps}">${ov.b.w10 ? fmtW(ov.b.w10) : 'BW'}×${ov.b.reps}</button></div>` : ''}
      ${status}</div>`;
  }).join('') + `<div class="pv-total"><span><b>${work.length}</b> sets</span><span><b>${Math.round((unit() === 'lb' ? volOfSets(allSets) * 0.22046 : volOfSets(allSets) / 10)).toLocaleString('en-US')}</b> ${unit()} volume</span></div>`;
  const h = $('#savehint'); if (h) h.textContent = work.length ? `${work.length} sets across ${lines.filter(l => l.sets.length).length} exercises` : '';
}
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset && el.dataset.actChange === 'newmuscle' && S.draft) { S.draft.newMuscle[el.dataset.name] = el.value; }
});
A.sug = el => {   // add a suggested set to that exercise's line
  const i = +el.dataset.i, line = S.parsed[i]; if (!line) return;
  const w = +el.dataset.w, r = el.dataset.r, tok = (w ? fmtW(w) : 'bw') + 'x' + r;
  const lines = S.draft.text.split('\n');
  const idx = lines.findIndex(t => t.trim() && t.replace(/^(\s*(&|ss:?|\+)\s*)/i, '').trim().toLowerCase().startsWith(line.nameText.toLowerCase()));
  if (idx >= 0) lines[idx] = lines[idx].replace(/[\s,]+$/, '') + ', ' + tok;
  S.draft.text = lines.join('\n'); $('#lift-text').value = S.draft.text; sfx.tick(); refreshLift(); saveDraftLocal();
};

/* ---- exercise autocomplete in the textarea ---- */
let acItems = [], acIdx = 0, acRange = null;
function updateAC() {
  const ta = $('#lift-text'); if (!ta) return;
  const pos = ta.selectionStart, txt = ta.value;
  const ls = Math.max(txt.lastIndexOf('\n', pos - 1), txt.lastIndexOf(';', pos - 1)) + 1;
  const seg = txt.slice(ls, pos), m = seg.match(/^\s*(?:&|ss:?|\+)?\s*/i), pre = m ? m[0].length : 0, frag = seg.slice(pre);
  if (!frag.trim() || /[\d]/.test(frag) || ta.selectionEnd !== pos) return hideAC();
  acItems = P.rank(frag.trim(), activeEx(), 5);
  if (!acItems.length || (acItems.length === 1 && acItems[0].name.toLowerCase() === frag.trim().toLowerCase())) return hideAC();
  acIdx = 0; acRange = [ls + pre, pos];
  drawAC();
}
function drawAC() {
  const box = $('#ac'); if (!box) return;
  box.innerHTML = acItems.map((e, i) => `<button class="${i === acIdx ? 'on' : ''}" data-act="ac-pick" data-i="${i}" tabindex="-1">${esc(e.name)}<em>${e.equipment}</em></button>`).join('') + '<div class="ac-hint">Tab to accept</div>';
  box.classList.add('open');
}
function hideAC() { const b = $('#ac'); if (b) b.classList.remove('open'); acItems = []; }
function acPick(i) {
  const ta = $('#lift-text'), e = acItems[i]; if (!e || !acRange) return;
  ta.value = ta.value.slice(0, acRange[0]) + e.name + ' ' + ta.value.slice(acRange[1]);
  const p = acRange[0] + e.name.length + 1; ta.setSelectionRange(p, p);
  S.draft.text = ta.value; hideAC(); refreshLift(); saveDraftLocal(); ta.focus();
}
A['ac-pick'] = el => acPick(+el.dataset.i);
function acKey(e) {
  const open = $('#ac') && $('#ac').classList.contains('open');
  if (open && e.key === 'ArrowDown') { e.preventDefault(); acIdx = (acIdx + 1) % acItems.length; drawAC(); }
  else if (open && e.key === 'ArrowUp') { e.preventDefault(); acIdx = (acIdx + acItems.length - 1) % acItems.length; drawAC(); }
  else if (open && e.key === 'Tab') { e.preventDefault(); acPick(acIdx); }
  else if (open && e.key === 'Escape') { e.stopPropagation(); hideAC(); }
  else if (e.key === 'Tab' && !e.shiftKey) { /* normal tab */ }
}
document.addEventListener('input', e => {
  if (e.target.id === 'lift-text' && S.draft) { S.draft.text = e.target.value; refreshLift(); refreshWarn(); saveDraftLocal(); updateAC(); }
});

/* ---- save ---- */
const guessEquip = n => /dumbbell|\bdb\b/i.test(n) ? 'dumbbell' : /cable|pushdown|pulldown/i.test(n) ? 'cable' : /smith/i.test(n) ? 'smith' : /pull.?up|dip|push.?up|chin/i.test(n) ? 'bodyweight' : /machine|press ?down|leg press/i.test(n) ? 'machine' : 'barbell';
const titleCase = s => s.trim().replace(/\s+/g, ' ').replace(/^./, c => c.toUpperCase());

A.save = async el => {
  const d = S.draft; if (!d || el.disabled) return;
  const body = { id: d.id, day: d.day, kind: d.kind, subtype: d.subtype, duration_min: parseInt(d.duration, 10) || 0, rpe: parseInt(d.rpe, 10) || 0, notes: d.notes || '', felt: 0, explosive: 0, points: 0, dist_m: 0, sets: [] };
  if (d.kind === 'run') {
    body.dist_m = Math.round((parseFloat(d.km) || 0) * 1000); body.duration_min = Math.round(parseTime(d.time)); body.felt = d.felt;
    if (!body.dist_m || !body.duration_min) return toast('Add a distance and a time', 'bad');
  }
  if (d.kind === 'basketball') { body.explosive = d.explosive ? 1 : 0; body.points = parseInt(d.points, 10) || 0; }
  if (!body.duration_min && d.kind !== 'lift') return toast('Add a duration', 'bad');
  if (!body.rpe) return toast('Pick an effort 1 to 10', 'bad');
  if (d.kind === 'other' && !body.subtype.trim()) body.subtype = 'Other';
  el.disabled = true;
  try {
    if (d.kind === 'lift') {
      const lines = P.parse(d.text, activeEx(), { unit: unit() }).filter(l => l.sets.length && l.nameText);
      if (!lines.length) { el.disabled = false; return toast('Type at least one set, e.g. bench 60x8', 'bad'); }
      let created = false;
      for (const l of lines) if (!l.ex) {
        const r = await api('/exercises', 'POST', { name: titleCase(l.nameText), muscle: d.newMuscle[l.nameText] || 'other', equipment: guessEquip(l.nameText), rest_sec: 90 });
        l.ex = { id: r.id }; created = true;
      }
      for (const l of lines) for (const s of l.sets) body.sets.push({ exercise_id: l.ex.id, grp: l.grp, w10: s.w10, reps: s.reps, rpe10: s.rpe10, kind: s.kind });
      if (!body.subtype) body.subtype = 'Free';
      if (created) await loadBoot();
    }
    const res = await api('/activities', 'POST', body);
    try { localStorage.removeItem('hadid.draft'); } catch (e) { /* ignore */ }
    S.logDay = null; S.ghostsFor = '';
    el.classList.add('stamp'); sfx.clank(); haptic(30);
    if (res.prs && res.prs.length) { await new Promise(r => setTimeout(r, 250)); celebrate(res.prs); }
    else toast(d.id ? 'Changes saved' : 'Logged. Nice work.');
    await loadDays();
    setTimeout(() => go('/home'), res.prs && res.prs.length ? 50 : 350);
  } catch (e) { el.disabled = false; toast(e.message, 'bad'); }
};
A['del-act'] = async el => {
  if (!(await confirmDialog('Delete this entry? This cannot be undone.'))) return;
  await api('/activities/' + el.dataset.id, 'DELETE'); await loadDays(); S.ghostsFor = ''; toast('Deleted'); go('/home');
};

/* ---------- PR celebration ---------- */
function celebrate(prs) {
  const seen = new Set(), items = prs.map(prLabel).filter(x => { const k = x.nm + x.t; if (seen.has(k)) return false; seen.add(k); return true; });
  modal(H`<div class="pr-pop"><div class="pr-stamp">NEW PR${prs.length > 1 ? 'S' : ''}</div>
    <ul>${items.map((x, i) => H`<li style="--i:${i}"><b>${x.nm}</b><span>${x.t}</span><strong>${x.v}</strong><em>${x.was}</em></li>`)}</ul>
    <button class="btn big" data-act="modal-close" autofocus>Let's go</button></div>`);
  $('#modal').classList.add('pr');
  sfx.pr(); haptic([40, 30, 40, 30, 120]);
  const cx = innerWidth / 2, cy = innerHeight / 2.4;
  burst(cx, cy, 160); setTimeout(() => burst(cx - 220, cy + 40, 70), 180); setTimeout(() => burst(cx + 220, cy + 40, 70), 320);
}

/* ---------- global keys + boot ---------- */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#modal').classList.contains('open')) { closeModal(); $('#modal').classList.remove('pr'); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && $('#save')) { e.preventDefault(); A.save($('#save')); return; }
  const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const map = { l: '/log', h: '/home', p: '/prs', t: '/plates', y: '/history', m: '/live' };
  if (map[e.key.toLowerCase()]) { e.preventDefault(); go(map[e.key.toLowerCase()]); }
});

function heartbeat() {
  if (window.HadidLocal) return; // phone build has no server to keep alive
  const ping = () => fetch('/api/ping', { method: 'POST' }).catch(() => {});
  ping(); setInterval(ping, 15000);
  addEventListener('pagehide', () => { navigator.sendBeacon('/api/bye'); });
}

async function boot() {
  try { await loadBoot(); } catch (e) { document.body.innerHTML = '<p style="padding:40px;font:16px sans-serif">Hadid could not reach its backend. Close this window and start Hadid again.</p>'; return; }
  heartbeat();
  if (S.boot.demo) $('#demo-badge').hidden = false;
  addEventListener('hashchange', render);
  await render();
  document.body.classList.add('ready');
}
