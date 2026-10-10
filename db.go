package main

import (
	"database/sql"
	"fmt"
	"os"
	"time"
)

var db *sql.DB

// All weights are stored as integers in TENTHS of a kilo (w10): 27.5 kg -> 275.
// Bodyweight sets use w10 = 0. Never floats.
var schema = []string{
	`CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS exercises(
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		muscle TEXT NOT NULL DEFAULT 'other',
		muscles2 TEXT NOT NULL DEFAULT '',
		equipment TEXT NOT NULL DEFAULT 'barbell',
		rest_sec INTEGER NOT NULL DEFAULT 90,
		aliases TEXT NOT NULL DEFAULT '',
		notes TEXT NOT NULL DEFAULT '',
		archived INTEGER NOT NULL DEFAULT 0)`,
	`CREATE TABLE IF NOT EXISTS activities(
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		day TEXT NOT NULL,
		kind TEXT NOT NULL,
		subtype TEXT NOT NULL DEFAULT '',
		duration_min INTEGER NOT NULL DEFAULT 0,
		rpe INTEGER NOT NULL DEFAULT 0,
		dist_m INTEGER NOT NULL DEFAULT 0,
		felt INTEGER NOT NULL DEFAULT 0,
		explosive INTEGER NOT NULL DEFAULT 0,
		points INTEGER NOT NULL DEFAULT 0,
		notes TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT '')`,
	`CREATE INDEX IF NOT EXISTS idx_act_day ON activities(day)`,
	`CREATE TABLE IF NOT EXISTS sets(
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
		exercise_id INTEGER NOT NULL REFERENCES exercises(id),
		pos INTEGER NOT NULL,
		grp INTEGER NOT NULL DEFAULT 0,
		w10 INTEGER NOT NULL DEFAULT 0,
		reps INTEGER NOT NULL DEFAULT 0,
		rpe10 INTEGER NOT NULL DEFAULT 0,
		kind TEXT NOT NULL DEFAULT 'work',
		note TEXT NOT NULL DEFAULT '')`,
	`CREATE INDEX IF NOT EXISTS idx_sets_ex ON sets(exercise_id)`,
	`CREATE INDEX IF NOT EXISTS idx_sets_act ON sets(activity_id)`,
	`CREATE TABLE IF NOT EXISTS prs(
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
		activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
		day TEXT NOT NULL,
		kind TEXT NOT NULL,
		value INTEGER NOT NULL,
		w10 INTEGER NOT NULL DEFAULT 0,
		reps INTEGER NOT NULL DEFAULT 0,
		prev INTEGER NOT NULL DEFAULT 0)`,
	`CREATE TABLE IF NOT EXISTS templates(
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		pos INTEGER NOT NULL DEFAULT 0)`,
	`CREATE TABLE IF NOT EXISTS template_items(
		template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
		exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
		pos INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS schedule(
		dow INTEGER PRIMARY KEY,
		template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
		label TEXT NOT NULL DEFAULT '')`,
	// used by the check-ins screen (stage B); created now so the file format is stable
	`CREATE TABLE IF NOT EXISTS checkins(
		day TEXT PRIMARY KEY,
		creatine INTEGER NOT NULL DEFAULT 0,
		protein INTEGER NOT NULL DEFAULT 0,
		bw10 INTEGER NOT NULL DEFAULT 0,
		arm_mm INTEGER NOT NULL DEFAULT 0)`,
}

func openDB() error {
	name := "hadid.db"
	if demoMode {
		name = "hadid-demo.db"
		for _, f := range []string{name, name + "-wal", name + "-shm"} {
			_ = os.Remove(f)
		}
	}
	dsn := "file:" + name + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	d, err := sql.Open("sqlite", dsn)
	if err != nil {
		return err
	}
	// One connection: never run a second query while iterating rows, and always
	// use tx.* inside a transaction (db.* there would wait forever for the connection).
	d.SetMaxOpenConns(1)
	if err := d.Ping(); err != nil {
		return err
	}
	db = d
	for _, s := range schema {
		if _, err := db.Exec(s); err != nil {
			return fmt.Errorf("schema: %w", err)
		}
	}
	return seedIfEmpty()
}

type exSeed struct {
	name, muscle, muscles2, equip, aliases string
	rest                                   int
}

var exSeeds = []exSeed{
	{"Flat barbell bench press", "chest", "triceps,shoulders", "barbell", "bench,flat bench,bb bench,bench press", 150},
	{"Incline dumbbell press", "upper_chest", "shoulders,triceps", "dumbbell", "incline db,inc db,incline db press", 120},
	{"Incline smith press", "upper_chest", "shoulders,triceps", "smith", "incline smith,smith incline", 120},
	{"Dumbbell chest press", "chest", "triceps", "dumbbell", "db press,db bench,flat db,db chest press", 120},
	{"Barbell row", "back", "biceps,rear_delts", "barbell", "row,bb row,bent over row", 120},
	{"Pull-ups", "back", "biceps", "bodyweight", "pullups,pull ups,pullup,pull up", 120},
	{"Deadlift", "back", "hamstrings,glutes", "barbell", "dl,dead,deadlifts", 180},
	{"Smith squat", "quads", "glutes", "smith", "squat,smith sq,squats", 150},
	{"Seated dumbbell shoulder press", "shoulders", "triceps", "dumbbell", "db shoulder press,seated db press,shoulder press,sdsp,seated press", 120},
	{"Lateral raise (dumbbell)", "shoulders", "", "dumbbell", "lateral raise,lat raise,laterals,db lateral", 60},
	{"Lateral raise (cable)", "shoulders", "", "cable", "cable lateral,cable lat raise,cable laterals", 60},
	{"Face pulls", "rear_delts", "traps", "cable", "face pull,fp", 60},
	{"Hammer curls", "biceps", "forearms", "dumbbell", "hammer,hammers,hammer curl", 75},
	{"EZ-bar curls", "biceps", "forearms", "barbell", "ez curl,ez curls,ez bar curl,ez-bar curl", 75},
	{"Tricep pushdown", "triceps", "", "cable", "pushdown,pushdowns,tricep pushdowns", 75},
	{"Overhead EZ-bar extension", "triceps", "", "barbell", "oh ez ext,overhead ext,overhead extension,ez extension", 75},
}

var defaultSettings = map[string]string{
	"units":      "kg",
	"theme":      "dark",
	"sound":      "1",
	"rest_auto":  "1",
	"rest_beep":  "1",
	"bar_kg":     "20",
	"plates":     "25,20,15,10,5,2.5,1.25",
	"nudge_hour": "20",
	"week_goal":  "4",
	"reduce_fx":  "0",
}

func seedIfEmpty() error {
	for k, v := range defaultSettings {
		if _, err := db.Exec(`INSERT OR IGNORE INTO settings(k,v) VALUES(?,?)`, k, v); err != nil {
			return err
		}
	}
	var seeded string
	_ = db.QueryRow(`SELECT v FROM settings WHERE k='seeded'`).Scan(&seeded)
	if seeded == "1" {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	ids := map[string]int64{}
	for _, e := range exSeeds {
		res, err := tx.Exec(`INSERT INTO exercises(name,muscle,muscles2,equipment,rest_sec,aliases) VALUES(?,?,?,?,?,?)`,
			e.name, e.muscle, e.muscles2, e.equip, e.rest, e.aliases)
		if err != nil {
			return err
		}
		ids[e.name], _ = res.LastInsertId()
	}

	tpls := []struct {
		name  string
		items []string
	}{
		{"Chest & Back", []string{"Flat barbell bench press", "Incline dumbbell press", "Barbell row", "Pull-ups", "Face pulls"}},
		{"Legs", []string{"Smith squat", "Deadlift"}},
		{"Shoulders & Arms", []string{"Seated dumbbell shoulder press", "Lateral raise (dumbbell)", "Hammer curls", "EZ-bar curls", "Tricep pushdown", "Overhead EZ-bar extension"}},
		{"Push", []string{"Flat barbell bench press", "Incline smith press", "Seated dumbbell shoulder press", "Lateral raise (cable)", "Tricep pushdown"}},
		{"Pull", []string{"Barbell row", "Pull-ups", "Face pulls", "Hammer curls", "EZ-bar curls"}},
	}
	tid := map[string]int64{}
	for i, t := range tpls {
		res, err := tx.Exec(`INSERT INTO templates(name,pos) VALUES(?,?)`, t.name, i)
		if err != nil {
			return err
		}
		tid[t.name], _ = res.LastInsertId()
		for j, it := range t.items {
			if _, err := tx.Exec(`INSERT INTO template_items(template_id,exercise_id,pos) VALUES(?,?,?)`, tid[t.name], ids[it], j); err != nil {
				return err
			}
		}
	}
	// Mon..Sun (dow 0 = Monday): Chest & Back, Legs, Shoulders & Arms, Rest, Push, Pull, Rest
	sched := []string{"Chest & Back", "Legs", "Shoulders & Arms", "", "Push", "Pull", ""}
	for dow, name := range sched {
		if name == "" {
			if _, err := tx.Exec(`INSERT INTO schedule(dow,template_id,label) VALUES(?,NULL,'Rest')`, dow); err != nil {
				return err
			}
			continue
		}
		if _, err := tx.Exec(`INSERT INTO schedule(dow,template_id,label) VALUES(?,?,'')`, dow, tid[name]); err != nil {
			return err
		}
	}

	if !demoMode {
		// Starting numbers, so the app feels alive on first launch. Edit or delete freely.
		day := time.Now().AddDate(0, 0, -14).Format("2006-01-02")
		res, err := tx.Exec(`INSERT INTO activities(day,kind,subtype,duration_min,rpe,notes,created_at) VALUES(?,?,?,?,?,?,?)`,
			day, "lift", "Starting numbers", 60, 7, "Seeded starting numbers. Edit or delete me.", time.Now().Format(time.RFC3339))
		if err != nil {
			return err
		}
		aid, _ := res.LastInsertId()
		base := []struct {
			ex   string
			w10  int
			reps int
		}{
			{"Flat barbell bench press", 650, 8},
			{"Incline dumbbell press", 275, 8},
			{"Seated dumbbell shoulder press", 250, 8},
			{"Pull-ups", 0, 10},
			{"Deadlift", 1700, 1},
			{"Smith squat", 800, 6},
			{"Lateral raise (dumbbell)", 120, 15},
		}
		for i, b := range base {
			if _, err := tx.Exec(`INSERT INTO sets(activity_id,exercise_id,pos,w10,reps,kind) VALUES(?,?,?,?,?,'work')`, aid, ids[b.ex], i, b.w10, b.reps); err != nil {
				return err
			}
		}
	}
	if _, err := tx.Exec(`INSERT OR REPLACE INTO settings(k,v) VALUES('seeded','1')`); err != nil {
		return err
	}
	return tx.Commit()
}
