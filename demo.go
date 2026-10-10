package main

import (
	"fmt"
	"math/rand"
	"time"
)

type demoEx struct {
	name             string
	base, step, reps int // base/step in tenths of kg; step applies every 3 weeks
	sets             int
	warm             bool
	grp              int
}

// seedDemo fills the (separate, freshly created) demo database with ten weeks of
// believable training: the split, basketball Tue-Fri evenings, a Sunday run,
// daily check-ins, supersets, drop sets and some PRs along the way.
func seedDemo() error {
	rng := rand.New(rand.NewSource(7))
	rows, err := q(`SELECT id, name FROM exercises`)
	if err != nil {
		return err
	}
	ids := map[string]int64{}
	for _, r := range rows {
		ids[r["name"].(string)] = toInt64(r["id"])
	}

	plans := map[int][]demoEx{
		0: {{"Flat barbell bench press", 550, 25, 8, 3, true, 0}, {"Incline dumbbell press", 225, 25, 8, 3, false, 0},
			{"Barbell row", 450, 50, 10, 3, false, 0}, {"Pull-ups", 0, 0, 7, 3, false, 0}, {"Face pulls", 40, 5, 15, 3, false, 0}},
		1: {{"Smith squat", 600, 50, 8, 3, true, 0}, {"Deadlift", 1300, 100, 5, 3, true, 0}},
		2: {{"Seated dumbbell shoulder press", 200, 25, 8, 4, false, 0}, {"Lateral raise (dumbbell)", 100, 10, 12, 3, false, 0},
			{"Hammer curls", 125, 25, 10, 3, false, 1}, {"Tricep pushdown", 500, 50, 12, 3, false, 1},
			{"EZ-bar curls", 150, 25, 10, 3, false, 0}, {"Overhead EZ-bar extension", 100, 25, 12, 3, false, 0}},
		4: {{"Flat barbell bench press", 550, 25, 8, 3, true, 0}, {"Incline smith press", 300, 50, 8, 3, false, 0},
			{"Seated dumbbell shoulder press", 200, 25, 8, 3, false, 0}, {"Lateral raise (cable)", 80, 10, 12, 3, false, 0},
			{"Tricep pushdown", 500, 50, 12, 3, false, 0}},
		5: {{"Barbell row", 450, 50, 10, 3, false, 0}, {"Pull-ups", 0, 0, 7, 3, false, 0}, {"Face pulls", 40, 5, 15, 3, false, 0},
			{"Hammer curls", 125, 25, 10, 3, false, 0}, {"EZ-bar curls", 150, 25, 10, 3, false, 0}},
	}
	names := map[int]string{0: "Chest & Back", 1: "Legs", 2: "Shoulders & Arms", 4: "Push", 5: "Pull"}

	const span = 76
	today := time.Now()
	for i := span; i >= 1; i-- {
		d := today.AddDate(0, 0, -i)
		day := d.Format("2006-01-02")
		dow := (int(d.Weekday()) + 6) % 7
		wk := (span - i) / 7

		// daily check-in
		cre := 1
		if rng.Intn(10) == 0 {
			cre = 0
		}
		if _, err := db.Exec(`INSERT OR REPLACE INTO checkins(day,creatine,protein,bw10,arm_mm) VALUES(?,?,?,?,?)`,
			day, cre, 118+rng.Intn(50), 770+wk*3+rng.Intn(7)-3, 0); err != nil {
			return err
		}

		if plan, ok := plans[dow]; ok && rng.Intn(12) != 0 {
			in := &ActIn{Day: day, Kind: "lift", Subtype: names[dow], DurationMin: 55 + rng.Intn(25), RPE: 7 + rng.Intn(3)}
			for _, p := range plan {
				w := p.base + (wk/3)*p.step
				reps := p.reps
				if p.name == "Pull-ups" {
					reps = p.reps + wk/4
				}
				ex := ids[p.name]
				if p.warm {
					in.Sets = append(in.Sets, SetIn{ExerciseID: ex, W10: (w * 6 / 10) / 25 * 25, Reps: 10, Kind: "warm"})
				}
				for s := 0; s < p.sets; s++ {
					r := reps - rng.Intn(3)*boolInt(s > 0)
					set := SetIn{ExerciseID: ex, W10: w, Reps: r, Grp: p.grp}
					if rng.Intn(4) == 0 {
						set.RPE10 = 80 + rng.Intn(3)*10
					}
					in.Sets = append(in.Sets, set)
				}
				if p.name == "Incline dumbbell press" || p.name == "Tricep pushdown" && dow == 4 {
					in.Sets = append(in.Sets, SetIn{ExerciseID: ex, W10: w * 7 / 10 / 25 * 25, Reps: 10 + rng.Intn(4), Kind: "drop"})
				}
			}
			if _, err := saveActivity(in); err != nil {
				return err
			}
		} else if dow == 3 || dow == 6 {
			// planned rest days: sometimes explicitly logged
			if rng.Intn(2) == 0 {
				if _, err := saveActivity(&ActIn{Day: day, Kind: "rest", Subtype: "Rest day"}); err != nil {
					return err
				}
			}
		}

		// basketball: practice Tue-Fri evenings, a game on Saturdays now and then
		if dow >= 1 && dow <= 4 && rng.Intn(4) != 0 {
			a := &ActIn{Day: day, Kind: "basketball", Subtype: "practice", DurationMin: 80 + rng.Intn(25), RPE: 6 + rng.Intn(3),
				Explosive: boolInt(rng.Intn(3) == 0), Notes: ""}
			if _, err := saveActivity(a); err != nil {
				return err
			}
		}
		if dow == 5 && rng.Intn(3) == 0 {
			a := &ActIn{Day: day, Kind: "basketball", Subtype: "game", DurationMin: 28 + rng.Intn(14), RPE: 8 + rng.Intn(2),
				Explosive: 1, Points: 6 + rng.Intn(14), Notes: fmt.Sprintf("Game day, week %d", wk+1)}
			if _, err := saveActivity(a); err != nil {
				return err
			}
		}
		// Sunday run
		if dow == 6 && rng.Intn(10) < 6 {
			kinds := []string{"easy", "tempo", "long"}
			sub := kinds[wk%3]
			dist := 4500 + rng.Intn(2000)
			pace := 6.4 - float64(wk)*0.04 // minutes per km, getting a little faster
			if sub == "tempo" {
				pace -= 0.7
			}
			if sub == "long" {
				dist += 3500
				pace += 0.2
			}
			dur := int(float64(dist) / 1000 * pace)
			a := &ActIn{Day: day, Kind: "run", Subtype: sub, DurationMin: dur, RPE: map[string]int{"easy": 5, "tempo": 8, "long": 7}[sub],
				DistM: dist, Felt: 3 + rng.Intn(3)}
			if _, err := saveActivity(a); err != nil {
				return err
			}
		}
	}
	return rebuildAllPRs()
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
