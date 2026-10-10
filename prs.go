package main

import "sort"

// srow is one logged (non-warm-up) set with the info the PR engine needs.
type srow struct {
	ID, ActID, ExID int64
	Day             string
	W10, Reps       int
}

type prHit struct {
	Kind                   string // weight | e1rm | reps | volume
	Value, W10, Reps, Prev int
}

// e1rm uses Epley: w * (1 + reps/30), integer maths, only for 1..12 reps.
func e1rm(w10, reps int) int {
	if w10 <= 0 || reps < 1 || reps > 12 {
		return 0
	}
	if reps == 1 {
		return w10
	}
	return (w10*(30+reps) + 15) / 30
}

// volOf is kg*reps (in tenths) — or plain reps for unweighted bodyweight sets.
func volOf(s srow) int {
	if s.W10 > 0 {
		return s.W10 * s.Reps
	}
	return s.Reps
}

func loadSetsForExercise(exID int64) ([]srow, error) {
	rows, err := db.Query(`SELECT s.id, s.activity_id, s.exercise_id, a.day, s.w10, s.reps
		FROM sets s JOIN activities a ON a.id = s.activity_id
		WHERE s.exercise_id = ? AND s.kind != 'warm' AND s.reps > 0
		ORDER BY a.day, s.activity_id, s.pos`, exID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []srow
	for rows.Next() {
		var s srow
		if err := rows.Scan(&s.ID, &s.ActID, &s.ExID, &s.Day, &s.W10, &s.Reps); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// computePRs compares this session's sets of one exercise with everything before it.
// The very first time an exercise is logged there is nothing to beat, so no PR.
func computePRs(cur, prior []srow) []prHit {
	pw, pe := 0, 0
	pbest := map[int]int{}
	pvol := map[int64]int{}
	for _, s := range prior {
		if s.W10 > pw {
			pw = s.W10
		}
		if e := e1rm(s.W10, s.Reps); e > pe {
			pe = e
		}
		if s.Reps > pbest[s.W10] {
			pbest[s.W10] = s.Reps
		}
		pvol[s.ActID] += volOf(s)
	}
	pv := 0
	for _, v := range pvol {
		if v > pv {
			pv = v
		}
	}

	cw, cwReps := 0, 0
	ce, ceReps, ceW := 0, 0, 0
	cv := 0
	cbest := map[int]int{}
	for _, s := range cur {
		if s.W10 > cw || (s.W10 == cw && s.Reps > cwReps) {
			cw, cwReps = s.W10, s.Reps
		}
		if e := e1rm(s.W10, s.Reps); e > ce {
			ce, ceReps, ceW = e, s.Reps, s.W10
		}
		if s.Reps > cbest[s.W10] {
			cbest[s.W10] = s.Reps
		}
		cv += volOf(s)
	}

	var out []prHit
	if pw > 0 && cw > pw {
		out = append(out, prHit{"weight", cw, cw, cwReps, pw})
	}
	if pe > 0 && ce > pe {
		out = append(out, prHit{"e1rm", ce, ceW, ceReps, pe})
	}
	// best reps at a weight we've lifted before — report only the heaviest such weight
	ws := make([]int, 0, len(cbest))
	for w := range cbest {
		ws = append(ws, w)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(ws)))
	for _, w := range ws {
		if prevReps, ok := pbest[w]; ok && cbest[w] > prevReps {
			out = append(out, prHit{"reps", cbest[w], w, cbest[w], prevReps})
			break
		}
	}
	if pv > 0 && cv > pv {
		out = append(out, prHit{"volume", cv, 0, 0, pv})
	}
	return out
}

// detectPRs recomputes the PR events of one activity against everything before it.
func detectPRs(actID int64) error {
	var day string
	if err := db.QueryRow(`SELECT day FROM activities WHERE id = ?`, actID).Scan(&day); err != nil {
		return err
	}
	rows, err := db.Query(`SELECT DISTINCT exercise_id FROM sets WHERE activity_id = ?`, actID)
	if err != nil {
		return err
	}
	var exIDs []int64
	for rows.Next() {
		var x int64
		if err := rows.Scan(&x); err != nil {
			rows.Close()
			return err
		}
		exIDs = append(exIDs, x)
	}
	rows.Close()

	if _, err := db.Exec(`DELETE FROM prs WHERE activity_id = ?`, actID); err != nil {
		return err
	}
	for _, ex := range exIDs {
		all, err := loadSetsForExercise(ex)
		if err != nil {
			return err
		}
		var cur, prior []srow
		for _, s := range all {
			switch {
			case s.ActID == actID:
				cur = append(cur, s)
			case s.Day < day || (s.Day == day && s.ActID < actID):
				prior = append(prior, s)
			}
		}
		if len(cur) == 0 || len(prior) == 0 {
			continue
		}
		for _, p := range computePRs(cur, prior) {
			if _, err := db.Exec(`INSERT INTO prs(exercise_id,activity_id,day,kind,value,w10,reps,prev) VALUES(?,?,?,?,?,?,?,?)`,
				ex, actID, day, p.Kind, p.Value, p.W10, p.Reps, p.Prev); err != nil {
				return err
			}
		}
	}
	return nil
}

// rebuildAllPRs replays history in order. Used after deleting/editing past sessions.
func rebuildAllPRs() error {
	rows, err := db.Query(`SELECT DISTINCT a.id, a.day FROM activities a JOIN sets s ON s.activity_id = a.id ORDER BY a.day, a.id`)
	if err != nil {
		return err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		var day string
		if err := rows.Scan(&id, &day); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		if err := detectPRs(id); err != nil {
			return err
		}
	}
	return nil
}
