// Run: node tests/parse_test.js
const assert = require('assert');
const P = require('../web/js/parse.js');

const E = (id, name, aliases, equipment) => ({ id, name, aliases, equipment, archived: 0 });
const ex = [
  E(1, 'Flat barbell bench press', 'bench,flat bench,bb bench,bench press', 'barbell'),
  E(2, 'Incline dumbbell press', 'incline db,inc db,incline db press', 'dumbbell'),
  E(3, 'Incline smith press', 'incline smith,smith incline', 'smith'),
  E(4, 'Dumbbell chest press', 'db press,db bench,flat db,db chest press', 'dumbbell'),
  E(6, 'Pull-ups', 'pullups,pull ups,pullup,pull up', 'bodyweight'),
  E(8, 'Smith squat', 'squat,smith sq,squats', 'smith'),
  E(10, 'Lateral raise (dumbbell)', 'lateral raise,lat raise,laterals,db lateral', 'dumbbell'),
  E(11, 'Lateral raise (cable)', 'cable lateral,cable lat raise,cable laterals', 'cable'),
  E(13, 'Hammer curls', 'hammer,hammers,hammer curl', 'dumbbell'),
  E(14, 'EZ-bar curls', 'ez curl,ez curls,ez bar curl,ez-bar curl', 'barbell'),
  E(15, 'Tricep pushdown', 'pushdown,pushdowns,tricep pushdowns', 'cable'),
];
const p = (t, o) => P.parse(t, ex, o);
const w = s => s.map(x => x.w10 + 'x' + x.reps + (x.kind !== 'work' ? ':' + x.kind : ''));

let r = p('bench 60x8, 65x8, 70x6');
assert.strictEqual(r[0].ex.id, 1); assert.deepStrictEqual(w(r[0].sets), ['600x8', '650x8', '700x6']);
r = p('incline db 25x8 27.5x7');
assert.strictEqual(r[0].ex.id, 2); assert.deepStrictEqual(w(r[0].sets), ['250x8', '275x7']);
r = p('incline smith 40x8');  assert.strictEqual(r[0].ex.id, 3);
r = p('bench 60 x 8, 65 x 8'); assert.deepStrictEqual(w(r[0].sets), ['600x8', '650x8']);
r = p('pullups bwx10 bwx9 x8'); assert.deepStrictEqual(w(r[0].sets), ['0x10', '0x9', '0x8']); assert.strictEqual(r[0].ex.id, 6);
r = p('squat w40x10 60x8x3'); assert.deepStrictEqual(w(r[0].sets), ['400x10:warm', '600x8', '600x8', '600x8']);
r = p('lateral raise 12x15'); assert.strictEqual(r[0].ex.id, 10);
r = p('cable lateral 10x12'); assert.strictEqual(r[0].ex.id, 11);
r = p('hammer 17.5x10@8 d10x12'); assert.strictEqual(r[0].sets[0].rpe10, 80); assert.strictEqual(r[0].sets[1].kind, 'drop'); assert.strictEqual(r[0].sets[0].w10, 175);
r = p('hammer 12.5kg x 10'); assert.strictEqual(r[0].sets[0].w10, 125);
r = p('ez curl 15x10'); assert.strictEqual(r[0].ex.id, 14);
r = p('hammer 15x10\n& pushdown 50x15'); assert.strictEqual(r[0].grp, 1); assert.strictEqual(r[1].grp, 1); assert.strictEqual(r[1].ex.id, 15);
r = p('zottman curl 10x10'); assert.strictEqual(r[0].status, 'new'); assert.strictEqual(r[0].nameText, 'zottman curl');
r = p('bench'); assert.strictEqual(r[0].status, 'empty');
r = p('bench 135x5', { unit: 'lb' }); assert.strictEqual(r[0].sets[0].w10, 612);  // 135 lb = 61.2 kg
r = p('bench 60x8; squat 80x5'); assert.strictEqual(r.length, 2);
assert.deepStrictEqual(P.rank('inc', ex, 5).map(e => e.id).sort(), [2, 3]);
assert.strictEqual(P.setsToText('Bench', [{ w10: 600, reps: 8, kind: 'work' }, { w10: 600, reps: 8, kind: 'work' }, { w10: 650, reps: 6, kind: 'work' }]), 'Bench 60x8x2, 65x6');
assert.strictEqual(P.setsToText('Pull-ups', [{ w10: 0, reps: 10, kind: 'work' }]), 'Pull-ups bwx10');
let o = P.overload([{ w10: 250, reps: 8, kind: 'work' }], 'dumbbell');
assert.deepStrictEqual(o.a, { w10: 275, reps: 6 }); assert.deepStrictEqual(o.b, { w10: 250, reps: 9 });
o = P.overload([{ w10: 0, reps: 10, kind: 'work' }], 'bodyweight'); assert.strictEqual(o.a, null); assert.strictEqual(o.b.reps, 11);
// round trip
const t = P.setsToText('Flat barbell bench press', [{ w10: 650, reps: 8, kind: 'work' }, { w10: 275, reps: 5, kind: 'drop' }]);
r = p(t); assert.strictEqual(r[0].ex.id, 1); assert.strictEqual(r[0].sets.length, 2); assert.strictEqual(r[0].sets[1].kind, 'drop');
console.log('parse tests OK');
