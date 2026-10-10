'use strict';
/* Hadid shared helpers. No framework: tagged-template HTML (auto-escaped) + delegated events. */

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = v => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(val).join('') : esc(v));
const H = (strs, ...vals) => new Safe(strs.reduce((o, s, i) => o + s + (i < vals.length ? val(vals[i]) : ''), ''));
const raw = s => new Safe(s);
const show = (el, safe) => { el.innerHTML = safe.s; return el; };

const S = { boot: null, days: [], ghosts: {}, ghostsFor: '', acts: [], draft: null };
const P = window.HadidParse;

/* ---------- api ---------- */
async function api(path, method, body) {
  // Phone build: no server, the backend runs in-app (mobile/src/store.js)
  if (window.HadidLocal) return window.HadidLocal.handle(method || 'GET', path, body);
  const res = await fetch('/api' + path, {
    method: method || 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) throw new Error((data && data.error) || res.statusText);
  return data;
}

/* Save a file for the user. The phone build overrides this with the native share sheet. */
window.HadidSaveFile = window.HadidSaveFile || (async (name, data, mime) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: mime || 'application/octet-stream' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});

/* ---------- settings ---------- */
const setting = k => (S.boot && S.boot.settings[k]) || '';
const saveSettings = async obj => { Object.assign(S.boot.settings, obj); await api('/settings', 'PUT', obj); applyTheme(); };
function applyTheme() {
  document.documentElement.dataset.theme = setting('theme') === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.fx = reduced() ? 'off' : 'on';
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || setting('reduce_fx') === '1';

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return ymd(d); };
const dowOf = s => (parseDay(s).getDay() + 6) % 7; // Monday = 0
const weekStart = s => addDays(s, -dowOf(s));
const todayStr = () => ymd(new Date());
const fmtDay = (s, o) => parseDay(s).toLocaleDateString('en-GB', o || { weekday: 'short', day: 'numeric', month: 'short' });
const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function relDay(s) {
  const t = todayStr();
  if (s === t) return 'Today';
  if (s === addDays(t, -1)) return 'Yesterday';
  return fmtDay(s);
}

/* ---------- weights (stored as tenths of a kilo; shown in the chosen unit) ---------- */
const unit = () => (setting('units') === 'lb' ? 'lb' : 'kg');
const trim = n => String(n).replace(/\.0+$/, '');
const fmtW = w10 => (unit() === 'lb' ? trim((Math.round(w10 * 2.20462) / 10).toFixed(1)) : P.fmtNum(w10));
const fmtWu = w10 => (w10 ? `${fmtW(w10)} ${unit()}` : 'BW');
const fmtKg = w10 => P.fmtNum(w10);
const fmtPace = (distM, min) => {
  if (!distM || !min) return '–';
  const spk = (min * 60) / (distM / 1000);
  return `${Math.floor(spk / 60)}:${pad(Math.round(spk % 60) === 60 ? 59 : Math.round(spk % 60))}`;
};
const loadOf = a => (a.duration_min || 0) * (a.rpe || 0);
const KIND = { lift: 'Lifting', run: 'Run', basketball: 'Basketball', other: 'Other', rest: 'Rest day' };
const MUSCLES = ['chest', 'upper_chest', 'back', 'traps', 'shoulders', 'rear_delts', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'core', 'other'];
const muscleName = m => ({ upper_chest: 'Upper chest', rear_delts: 'Rear delts' }[m] || (m.charAt(0).toUpperCase() + m.slice(1)));
const EQUIP = ['barbell', 'dumbbell', 'cable', 'smith', 'machine', 'bodyweight'];
const LEG_MUSCLES = ['quads', 'hamstrings', 'glutes', 'calves'];

/* ---------- animation helpers ---------- */
function countUp(el, to, opt) {
  opt = opt || {};
  const dec = opt.dec || 0, suffix = opt.suffix || '';
  const fmt = v => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suffix;
  if (reduced() || to === 0) { el.textContent = fmt(to); return; }
  const dur = opt.dur || 900, t0 = performance.now();
  const step = t => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(to * e);
    if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(to);
  };
  requestAnimationFrame(step);
}
const runCounters = root => $$('[data-count]', root).forEach(el =>
  countUp(el, parseFloat(el.dataset.count), { dec: +el.dataset.dec || 0, suffix: el.dataset.suffix || '' }));

/* ---------- sound (WebAudio, no files) ---------- */
let AC = null;
const soundOn = () => setting('sound') !== '0';
function tone(f, at, dur, type, vol) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'square'; o.frequency.value = f;
    const t = AC.currentTime + (at || 0);
    g.gain.setValueAtTime(vol || 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch (e) { /* audio is optional */ }
}
const sfx = {
  clank() { if (!soundOn()) return; tone(140, 0, 0.18, 'triangle', 0.12); tone(1180, 0, 0.06, 'square', 0.03); tone(880, 0.05, 0.1, 'triangle', 0.03); },
  pr() { if (!soundOn()) return; [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.09, 0.28, 'triangle', 0.08)); tone(130, 0, 0.5, 'sawtooth', 0.05); },
  tick() { if (soundOn() && setting('rest_beep') !== '0') tone(660, 0, 0.07, 'square', 0.03); },
  done() { if (soundOn() && setting('rest_beep') !== '0') { tone(880, 0, 0.14, 'square', 0.05); tone(1320, 0.16, 0.22, 'square', 0.05); } },
};
const haptic = p => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* none */ } };

/* ---------- confetti / burst ---------- */
let fxParts = [], fxRaf = 0;
function burst(x, y, n) {
  if (reduced()) return;
  const cv = $('#fx'); if (!cv) return;
  cv.width = innerWidth; cv.height = innerHeight;
  const cols = ['#ff4d1a', '#ff7a45', '#e3b341', '#ecebe4', '#ffd27a'];
  for (let i = 0; i < (n || 120); i++) {
    const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 11;
    fxParts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 5, g: 0.28, r: Math.random() * 6 + 3, rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.4, life: 1, c: cols[i % cols.length], ring: i % 7 === 0 });
  }
  if (!fxRaf) fxRaf = requestAnimationFrame(fxLoop);
}
function fxLoop() {
  const cv = $('#fx'), c = cv.getContext('2d');
  if (!c) { fxParts.length = 0; fxRaf = 0; return; } // no canvas support: skip the confetti, never break the save flow
  c.clearRect(0, 0, cv.width, cv.height);
  fxParts = fxParts.filter(p => p.life > 0);
  for (const p of fxParts) {
    p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.985; p.rot += p.vr; p.life -= 0.011;
    c.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
    c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
    if (p.ring) { c.strokeStyle = p.c; c.lineWidth = 2.5; c.beginPath(); c.arc(0, 0, p.r, 0, 6.3); c.stroke(); }
    else { c.fillStyle = p.c; c.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); }
    c.restore();
  }
  if (fxParts.length) fxRaf = requestAnimationFrame(fxLoop); else { fxRaf = 0; c.clearRect(0, 0, cv.width, cv.height); }
}

/* ---------- toast / modal / confirm ---------- */
function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3100);
}
function modal(safe, onMount) {
  const root = $('#modal');
  root.innerHTML = `<div class="scrim" data-act="modal-close"></div><div class="sheet" role="dialog">${safe.s}</div>`;
  root.classList.add('open');
  if (onMount) onMount($('.sheet', root));
  const f = $('[autofocus]', root); if (f) f.focus();
}
const closeModal = () => { const r = $('#modal'); r.classList.remove('open', 'pr'); r.innerHTML = ''; };
function confirmDialog(msg, okLabel) {
  return new Promise(res => {
    modal(H`<h3>${msg}</h3><div class="row end gap"><button class="btn ghost" data-act="modal-no">Cancel</button><button class="btn danger" data-act="modal-yes" autofocus>${okLabel || 'Delete'}</button></div>`);
    const root = $('#modal');
    const h = e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'modal-yes') { root.removeEventListener('click', h); closeModal(); res(true); }
      if (a.dataset.act === 'modal-no' || a.dataset.act === 'modal-close') { root.removeEventListener('click', h); closeModal(); res(false); }
    };
    root.addEventListener('click', h);
  });
}

/* ---------- SVG: plate dial (the Hadid mark), small rings ---------- */
function plateDial(o) {
  const C = 2 * Math.PI * 132, frac = Math.max(0, Math.min(1, o.frac || 0));
  return H`<svg class="dial" viewBox="0 0 400 400" role="img" aria-label="${o.label || 'Log today'}">
    <defs>
      <path id="pt" d="M35,200 a165,165 0 0,1 330,0"/><path id="pb" d="M22,200 a178,178 0 0,0 356,0"/>
    </defs>
    <circle class="d-rim" cx="200" cy="200" r="197"/>
    <circle class="d-knurl" cx="200" cy="200" r="186"/>
    <text class="d-ring-text"><textPath href="#pt" startOffset="50%" text-anchor="middle">${o.top || 'HADID · IRON'}</textPath></text>
    <text class="d-ring-text"><textPath href="#pb" startOffset="50%" text-anchor="middle">${o.bottom || 'LOG EVERY NIGHT'}</textPath></text>
    <circle class="d-track" cx="200" cy="200" r="132"/>
    <circle class="d-arc" cx="200" cy="200" r="132" style="--c:${C};--f:${C * (1 - frac)}" transform="rotate(-90 200 200)"/>
    <circle class="d-hub" cx="200" cy="200" r="112"/>
    <text class="d-kufi" x="200" y="248" text-anchor="middle">حديد</text>
    <text class="d-sub" x="200" y="138" text-anchor="middle">${o.sub || ''}</text>
    <text class="d-big" x="200" y="205" text-anchor="middle">${o.l1 || 'LOG'}</text>
    <text class="d-big" x="200" y="262" text-anchor="middle">${o.l2 || 'TODAY'}</text>
    <text class="d-sub" x="200" y="296" text-anchor="middle">${o.foot || ''}</text>
  </svg>`;
}
function ring(o) {
  const r = (o.size || 96) / 2 - 8, C = 2 * Math.PI * r, f = Math.max(0, Math.min(1, o.frac || 0)), sz = o.size || 96;
  return H`<svg class="ring ${o.cls || ''}" width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}">
    <circle class="r-track" cx="${sz / 2}" cy="${sz / 2}" r="${r}"/>
    <circle class="r-arc" cx="${sz / 2}" cy="${sz / 2}" r="${r}" transform="rotate(-90 ${sz / 2} ${sz / 2})" style="--c:${C};--f:${C * (1 - f)}"/>
  </svg>`;
}

/* ---------- SVG charts (they draw themselves; CSS handles the motion) ---------- */
function lineChart(pts, o) {
  o = o || {};
  const w = o.w || 640, h = o.h || 220, m = { l: 38, r: 12, t: 14, b: 26 };
  const ys = pts.map(p => p.y);
  if (!pts.length) return H`<div class="empty small">No data yet</div>`;
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad_ = (hi - lo) * 0.12; lo -= pad_; hi += pad_;
  const X = i => m.l + (pts.length === 1 ? (w - m.l - m.r) / 2 : (i * (w - m.l - m.r)) / (pts.length - 1));
  const Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (h - m.t - m.b);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = `${d}L${X(pts.length - 1).toFixed(1)},${h - m.b}L${X(0).toFixed(1)},${h - m.b}Z`;
  const fmt = o.yFmt || (v => Math.round(v));
  let grid = '';
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3, y = Y(v);
    grid += `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${y}" y2="${y}"/><text class="axis" x="${m.l - 6}" y="${y + 3}" text-anchor="end">${esc(fmt(v))}</text>`;
  }
  const every = Math.max(1, Math.ceil(pts.length / 6));
  const xl = pts.map((p, i) => (i % every === 0 || i === pts.length - 1) ? `<text class="axis" x="${X(i)}" y="${h - 8}" text-anchor="middle">${esc(p.x)}</text>` : '').join('');
  const dots = pts.map((p, i) => p.mark
    ? `<path class="pr-mark" d="M${X(i)},${Y(p.y) - 7}l6,7l-6,7l-6,-7z" style="--i:${i}"><title>${esc(p.tip || 'PR')}</title></path>`
    : `<circle class="dot" cx="${X(i)}" cy="${Y(p.y)}" r="3" style="--i:${i}"><title>${esc(p.tip || fmt(p.y))}</title></circle>`).join('');
  return raw(`<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${grid}${xl}<path class="area" d="${area}"/><path class="line draw" pathLength="1" d="${d}"/>${dots}</svg>`);
}

// stacked bar chart: groups = [{label, parts:[{cls, v, tip}]}]
function barChart(groups, o) {
  o = o || {};
  const w = o.w || 640, h = o.h || 200, m = { l: 40, r: 8, t: 10, b: 24 };
  const tot = groups.map(g => g.parts.reduce((s, p) => s + p.v, 0));
  const hi = Math.max(1, ...tot) * 1.1, bw = (w - m.l - m.r) / groups.length;
  const fmt = o.yFmt || (v => Math.round(v));
  let out = '';
  for (let i = 0; i <= 3; i++) {
    const v = (hi * i) / 3, y = m.t + (1 - v / hi) * (h - m.t - m.b);
    out += `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${y}" y2="${y}"/><text class="axis" x="${m.l - 6}" y="${y + 3}" text-anchor="end">${esc(fmt(v))}</text>`;
  }
  groups.forEach((g, i) => {
    let yb = h - m.b;
    g.parts.forEach(p => {
      const bh = (p.v / hi) * (h - m.t - m.b);
      if (bh <= 0) return;
      yb -= bh;
      out += `<rect class="bar ${p.cls}" x="${m.l + i * bw + bw * 0.18}" y="${yb}" width="${bw * 0.64}" height="${bh}" style="--i:${i}"><title>${esc(p.tip || '')}</title></rect>`;
    });
    out += `<text class="axis" x="${m.l + i * bw + bw / 2}" y="${h - 8}" text-anchor="middle">${esc(g.label)}</text>`;
  });
  return raw(`<svg class="chart" viewBox="0 0 ${w} ${h}">${out}</svg>`);
}

/* ---------- plates ---------- */
const PLATE = { 25: ['#d6322a', 168, 22], 20: ['#2a5bd7', 160, 20], 15: ['#e3b341', 140, 18], 10: ['#2f9e57', 112, 16], 5: ['#e6e5de', 88, 12],
  2.5: ['#25282a', 68, 10], 1.25: ['#a3a9a3', 54, 8], 0.5: ['#6d726d', 44, 6] };
const plateInfo = kg => PLATE[kg] || ['#888', 80, 10];

// greedy plates per side. Works in hundredths of a kilo so 1.25 stays an integer.
function platesFor(target10, bar10, avail) {
  let per = Math.round(((target10 - bar10) * 10) / 2);
  const out = [];
  if (per < 0) return { plates: out, short100: per };
  for (const p of avail.slice().sort((a, b) => b - a)) {
    const c = Math.round(p * 100);
    while (per >= c) { out.push(p); per -= c; }
  }
  return { plates: out, short100: per };
}
const totalFor = (plates, bar10) => bar10 + Math.round(plates.reduce((s, p) => s + p * 100, 0) * 2 / 10);

function barbellSVG(plates) {
  const W = 760, H_ = 210, cy = H_ / 2, inL = 246, inR = 514;
  let right = '', left = '', xr = inR + 8, xl = inL - 8;
  plates.forEach((kg, i) => {
    const [col, ph, pw] = plateInfo(kg), txt = ['#e6e5de', '#e3b341', '#a3a9a3'].includes(col) ? '#111' : '#fff';
    const g = (x, side) => `<g class="plate" style="--i:${i};--s:${side}"><rect x="${x}" y="${cy - ph / 2}" width="${pw}" height="${ph}" rx="3" fill="${col}" stroke="rgba(0,0,0,.45)"/>
      <text x="${x + pw / 2}" y="${cy}" transform="rotate(-90 ${x + pw / 2} ${cy})" text-anchor="middle" dominant-baseline="middle" fill="${txt}" class="plate-t">${kg}</text></g>`;
    right += g(xr, 1); xr += pw + 3;
    left += g(xl - pw, -1); xl -= pw + 3;
  });
  return raw(`<svg class="barbell" viewBox="0 0 ${W} ${H_}">
    <rect x="20" y="${cy - 4}" width="${W - 40}" height="8" rx="3" class="bar-shaft"/>
    <rect x="20" y="${cy - 8}" width="${inL - 20}" height="16" rx="3" class="bar-sleeve"/><rect x="${inR}" y="${cy - 8}" width="${W - 20 - inR}" height="16" rx="3" class="bar-sleeve"/>
    <rect x="${inL - 6}" y="${cy - 24}" width="8" height="48" rx="2" class="bar-collar"/><rect x="${inR - 2}" y="${cy - 24}" width="8" height="48" rx="2" class="bar-collar"/>
    ${left}${right}</svg>`);
}

/* ---------- rest timer (floating dock, works on every screen) ---------- */
const RT = { end: 0, total: 0, timer: 0, label: '' };
const restEvent = () => window.dispatchEvent(new CustomEvent('hadid:rest', { detail: { end: RT.end, label: RT.label } }));
const restDoneEvent = () => window.dispatchEvent(new CustomEvent('hadid:rest-stop'));
function restStart(sec, label) {
  RT.total = sec; RT.end = Date.now() + sec * 1000; RT.label = label || 'Rest';
  clearInterval(RT.timer);
  $('#rest').classList.add('on');
  $('#rest').classList.remove('done', 'pulse');
  RT.timer = setInterval(restTick, 250);
  restTick(); restEvent();
}
function restAdd(sec) { if (!RT.end) return; RT.end += sec * 1000; RT.total = Math.max(RT.total, (RT.end - Date.now()) / 1000); restTick(); restEvent(); }
function restStop() { clearInterval(RT.timer); RT.end = 0; $('#rest').classList.remove('on', 'done', 'pulse'); restDoneEvent(); }
let lastWhole = -1;
function restTick() {
  const left = Math.max(0, RT.end - Date.now()), whole = Math.ceil(left / 1000), el = $('#rest');
  const C = 2 * Math.PI * 30;
  $('#rest .rt-arc').style.strokeDasharray = C;
  $('#rest .rt-arc').style.strokeDashoffset = C * (1 - left / (RT.total * 1000 || 1));
  $('#rest .rt-time').textContent = `${Math.floor(whole / 60)}:${pad(whole % 60)}`;
  $('#rest .rt-label').textContent = RT.label;
  if (whole !== lastWhole) {
    lastWhole = whole;
    if (whole > 0 && whole <= 3) { el.classList.add('pulse'); sfx.tick(); haptic(25); el.classList.remove('beat'); void el.offsetWidth; el.classList.add('beat'); }
  }
  if (left <= 0) {
    clearInterval(RT.timer); RT.end = 0; el.classList.remove('pulse'); el.classList.add('done'); restDoneEvent();
    $('#rest .rt-time').textContent = 'GO';
    sfx.done(); haptic([60, 40, 60]);
    setTimeout(() => { if (!RT.end) el.classList.remove('on', 'done'); }, 2500);
  }
}

/* ---------- misc ---------- */
const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
const unique = a => Array.from(new Set(a));
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function prLabel(p) {
  const nm = p.ex_name;
  const v = x => fmtWu(x);
  if (p.kind === 'weight') return { t: 'Heaviest weight', v: `${v(p.value)} × ${p.reps}`, was: `was ${v(p.prev)}`, nm };
  if (p.kind === 'e1rm') return { t: 'Estimated 1RM', v: v(p.value), was: `was ${v(p.prev)}`, nm };
  if (p.kind === 'reps') return { t: `Best reps at ${v(p.w10)}`, v: `${p.value} reps`, was: `was ${p.prev}`, nm };
  const bw = p.equipment === 'bodyweight' && !p.w10 && p.value < 5000;
  return { t: 'Session volume', v: bw ? `${p.value} reps` : `${Math.round(unit() === 'lb' ? p.value * 0.22046 : p.value / 10).toLocaleString('en-US')} ${unit()}`,
    was: bw ? `was ${p.prev}` : `was ${Math.round(unit() === 'lb' ? p.prev * 0.22046 : p.prev / 10).toLocaleString('en-US')}`, nm };
}
