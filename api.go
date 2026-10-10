package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type M = map[string]any

var dayRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, M{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(v)
}

func toInt64(v any) int64 {
	switch x := v.(type) {
	case int64:
		return x
	case int:
		return int64(x)
	case float64:
		return int64(x)
	}
	return 0
}

// q runs a query and returns every row as a map. It reads everything before
// returning, so callers can safely run more queries afterwards.
func q(query string, args ...any) ([]M, error) {
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []M{}
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		m := M{}
		for i, c := range cols {
			if b, ok := vals[i].([]byte); ok {
				m[c] = string(b)
			} else {
				m[c] = vals[i]
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func registerAPI(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/whoami", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, M{"app": "hadid", "version": appVersion, "demo": demoMode})
	})
	mux.HandleFunc("POST /api/ping", func(w http.ResponseWriter, r *http.Request) {
		lastPing.Store(time.Now().UnixNano())
		writeJSON(w, 200, M{"ok": true})
	})
	mux.HandleFunc("POST /api/bye", func(w http.ResponseWriter, r *http.Request) {
		// Page is going away (or just reloading). Pull the deadline in a little;
		// a reload pings again right away and cancels this.
		lastPing.Store(time.Now().Add(-5 * time.Second).UnixNano())
		writeJSON(w, 200, M{"ok": true})
	})

	mux.HandleFunc("GET /api/bootstrap", handleBootstrap)
	mux.HandleFunc("GET /api/activities", handleActivities)
	mux.HandleFunc("POST /api/activities", handleSaveActivity)
	mux.HandleFunc("DELETE /api/activities/{id}", handleDeleteActivity)
	mux.HandleFunc("POST /api/rest", handleRest)
	mux.HandleFunc("GET /api/ghosts", handleGhosts)
	mux.HandleFunc("GET /api/lastlift", handleLastLift)
	mux.HandleFunc("GET /api/days", handleDays)
	mux.HandleFunc("POST /api/exercises", handleSaveExercise)
	mux.HandleFunc("DELETE /api/exercises/{id}", handleDeleteExercise)
	mux.HandleFunc("POST /api/templates", handleSaveTemplate)
	mux.HandleFunc("DELETE /api/templates/{id}", handleDeleteTemplate)
	mux.HandleFunc("PUT /api/schedule", handleSchedule)
	mux.HandleFunc("PUT /api/settings", handleSettings)
	mux.HandleFunc("GET /api/prs", handlePRs)
	mux.HandleFunc("POST /api/prs/rebuild", func(w http.ResponseWriter, r *http.Request) {
		if err := rebuildAllPRs(); err != nil {
			fail(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, M{"ok": true})
	})
	mux.HandleFunc("GET /api/export.csv", handleCSV)
	mux.HandleFunc("POST /api/backup", func(w http.ResponseWriter, r *http.Request) {
		if demoMode {
			fail(w, 400, "backups are disabled in demo mode")
			return
		}
		name, err := manualBackup()
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, M{"ok": true, "file": name, "dir": dataDir})
	})
}

func handleBootstrap(w http.ResponseWriter, r *http.Request) {
	settings := M{}
	srows, err := q(`SELECT k, v FROM settings`)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	for _, s := range srows {
		settings[s["k"].(string)] = s["v"]
	}
	exs, err := q(`SELECT * FROM exercises ORDER BY archived, name COLLATE NOCASE`)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	tpls, err := q(`SELECT * FROM templates ORDER BY pos, id`)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	items, err := q(`SELECT template_id, exercise_id FROM template_items ORDER BY template_id, pos`)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	byT := map[int64][]int64{}
	for _, it := range items {
		t := toInt64(it["template_id"])
		byT[t] = append(byT[t], toInt64(it["exercise_id"]))
	}
	for _, t := range tpls {
		ids := byT[toInt64(t["id"])]
		if ids == nil {
			ids = []int64{}
		}
		t["items"] = ids
	}
	sched, err := q(`SELECT * FROM schedule ORDER BY dow`)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, M{
		"settings":  settings,
		"exercises": exs,
		"templates": tpls,
		"schedule":  sched,
		"today":     time.Now().Format("2006-01-02"),
		"now":       time.Now().Format(time.RFC3339),
		"demo":      demoMode,
		"version":   appVersion,
		"dataDir":   dataDir,
	})
}

// loadActs returns activities (newest first) matching cond, each with its sets.
// cond refers to the activities table as "a".
func loadActs(cond string, args ...any) ([]M, error) {
	acts, err := q(`SELECT a.* FROM activities a WHERE `+cond+` ORDER BY a.day DESC, a.id DESC`, args...)
	if err != nil {
		return nil, err
	}
	sets, err := q(`SELECT s.*, e.name AS ex_name, e.equipment, e.muscle FROM sets s
		JOIN exercises e ON e.id = s.exercise_id
		WHERE s.activity_id IN (SELECT a.id FROM activities a WHERE `+cond+`)
		ORDER BY s.activity_id, s.pos`, args...)
	if err != nil {
		return nil, err
	}
	by := map[int64][]M{}
	for _, s := range sets {
		id := toInt64(s["activity_id"])
		by[id] = append(by[id], s)
	}
	for _, a := range acts {
		s := by[toInt64(a["id"])]
		if s == nil {
			s = []M{}
		}
		a["sets"] = s
	}
	return acts, nil
}

func handleActivities(w http.ResponseWriter, r *http.Request) {
	if idStr := r.URL.Query().Get("id"); idStr != "" {
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			fail(w, 400, "bad id")
			return
		}
		acts, err := loadActs(`a.id = ?`, id)
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, acts)
		return
	}
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if from == "" {
		from = "0000-01-01"
	}
	if to == "" {
		to = "9999-12-31"
	}
	if !dayRe.MatchString(from) || !dayRe.MatchString(to) {
		fail(w, 400, "bad date")
		return
	}
	acts, err := loadActs(`a.day >= ? AND a.day <= ?`, from, to)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, acts)
}

type SetIn struct {
	ExerciseID int64  `json:"exercise_id"`
	Grp        int    `json:"grp"`
	W10        int    `json:"w10"`
	Reps       int    `json:"reps"`
	RPE10      int    `json:"rpe10"`
	Kind       string `json:"kind"`
	Note       string `json:"note"`
}

type ActIn struct {
	ID          int64   `json:"id"`
	Day         string  `json:"day"`
	Kind        string  `json:"kind"`
	Subtype     string  `json:"subtype"`
	DurationMin int     `json:"duration_min"`
	RPE         int     `json:"rpe"`
	DistM       int     `json:"dist_m"`
	Felt        int     `json:"felt"`
	Explosive   int     `json:"explosive"`
	Points      int     `json:"points"`
	Notes       string  `json:"notes"`
	Sets        []SetIn `json:"sets"`
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func saveActivity(in *ActIn) (int64, error) {
	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	id := in.ID
	if id == 0 {
		res, err := tx.Exec(`INSERT INTO activities(day,kind,subtype,duration_min,rpe,dist_m,felt,explosive,points,notes,created_at)
			VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
			in.Day, in.Kind, in.Subtype, in.DurationMin, in.RPE, in.DistM, in.Felt, in.Explosive, in.Points, in.Notes,
			time.Now().Format(time.RFC3339))
		if err != nil {
			return 0, err
		}
		id, _ = res.LastInsertId()
	} else {
		if _, err := tx.Exec(`UPDATE activities SET day=?,kind=?,subtype=?,duration_min=?,rpe=?,dist_m=?,felt=?,explosive=?,points=?,notes=? WHERE id=?`,
			in.Day, in.Kind, in.Subtype, in.DurationMin, in.RPE, in.DistM, in.Felt, in.Explosive, in.Points, in.Notes, id); err != nil {
			return 0, err
		}
		if _, err := tx.Exec(`DELETE FROM sets WHERE activity_id=?`, id); err != nil {
			return 0, err
		}
	}
	for i, s := range in.Sets {
		if s.ExerciseID == 0 || s.Reps <= 0 {
			continue
		}
		kind := s.Kind
		if kind != "warm" && kind != "drop" {
			kind = "work"
		}
		if _, err := tx.Exec(`INSERT INTO sets(activity_id,exercise_id,pos,grp,w10,reps,rpe10,kind,note) VALUES(?,?,?,?,?,?,?,?,?)`,
			id, s.ExerciseID, i, s.Grp, s.W10, s.Reps, s.RPE10, kind, s.Note); err != nil {
			return 0, err
		}
	}
	return id, tx.Commit()
}

func handleSaveActivity(w http.ResponseWriter, r *http.Request) {
	var in ActIn
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, "bad json")
		return
	}
	if !dayRe.MatchString(in.Day) {
		fail(w, 400, "bad date")
		return
	}
	switch in.Kind {
	case "lift", "run", "basketball", "other", "rest":
	default:
		fail(w, 400, "unknown activity kind")
		return
	}
	in.DurationMin = clamp(in.DurationMin, 0, 1440)
	in.RPE = clamp(in.RPE, 0, 10)
	in.Felt = clamp(in.Felt, 0, 5)
	if in.DistM < 0 {
		in.DistM = 0
	}
	id, err := saveActivity(&in)
	if err != nil {
		log.Printf("save activity: %v", err)
		fail(w, 500, err.Error())
		return
	}
	var later int
	_ = db.QueryRow(`SELECT COUNT(*) FROM activities a JOIN sets s ON s.activity_id=a.id WHERE a.day > ? AND a.id != ?`, in.Day, id).Scan(&later)
	if later > 0 {
		err = rebuildAllPRs()
	} else {
		err = detectPRs(id)
	}
	if err != nil {
		log.Printf("pr detect: %v", err)
	}
	prs, _ := q(`SELECT p.*, e.name AS ex_name, e.equipment FROM prs p JOIN exercises e ON e.id=p.exercise_id WHERE p.activity_id=? ORDER BY p.id`, id)
	if prs == nil {
		prs = []M{}
	}
	writeJSON(w, 200, M{"id": id, "prs": prs})
}

func handleDeleteActivity(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, 400, "bad id")
		return
	}
	if _, err := db.Exec(`DELETE FROM activities WHERE id=?`, id); err != nil {
		fail(w, 500, err.Error())
		return
	}
	if err := rebuildAllPRs(); err != nil {
		log.Printf("rebuild prs: %v", err)
	}
	writeJSON(w, 200, M{"ok": true})
}

func handleRest(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Day string `json:"day"`
	}
	if err := readJSON(r, &in); err != nil || !dayRe.MatchString(in.Day) {
		fail(w, 400, "bad date")
		return
	}
	var n int
	_ = db.QueryRow(`SELECT COUNT(*) FROM activities WHERE day=? AND kind='rest'`, in.Day).Scan(&n)
	if n == 0 {
		if _, err := db.Exec(`INSERT INTO activities(day,kind,subtype,created_at) VALUES(?,'rest','Rest day',?)`, in.Day, time.Now().Format(time.RFC3339)); err != nil {
			fail(w, 500, err.Error())
			return
		}
	}
	writeJSON(w, 200, M{"ok": true})
}

// handleGhosts: for every exercise, the sets of its most recent session before `before`.
func handleGhosts(w http.ResponseWriter, r *http.Request) {
	before := r.URL.Query().Get("before")
	if !dayRe.MatchString(before) {
		before = time.Now().Format("2006-01-02")
	}
	rows, err := q(`SELECT s.exercise_id, a.id AS act_id, a.day, s.w10, s.reps, s.rpe10, s.kind
		FROM sets s JOIN activities a ON a.id = s.activity_id
		WHERE a.day < ? AND s.kind != 'warm' AND s.reps > 0
		ORDER BY a.day DESC, a.id DESC, s.pos`, before)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	out := map[string]M{}
	latest := map[int64]int64{}
	for _, row := range rows {
		ex, act := toInt64(row["exercise_id"]), toInt64(row["act_id"])
		key := strconv.FormatInt(ex, 10)
		if prev, ok := latest[ex]; ok && prev != act {
			continue
		}
		latest[ex] = act
		g, ok := out[key]
		if !ok {
			g = M{"day": row["day"], "sets": []M{}}
			out[key] = g
		}
		g["sets"] = append(g["sets"].([]M), M{"w10": row["w10"], "reps": row["reps"], "rpe10": row["rpe10"], "kind": row["kind"]})
	}
	writeJSON(w, 200, out)
}

// handleLastLift: the most recent lifting session with the same workout name.
func handleLastLift(w http.ResponseWriter, r *http.Request) {
	sub := r.URL.Query().Get("subtype")
	before := r.URL.Query().Get("before")
	if !dayRe.MatchString(before) {
		before = "9999-12-31"
	}
	rows, err := q(`SELECT id FROM activities WHERE kind='lift' AND subtype=? AND day<? ORDER BY day DESC, id DESC LIMIT 1`, sub, before)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	if len(rows) == 0 {
		writeJSON(w, 200, nil)
		return
	}
	acts, err := loadActs(`a.id = ?`, rows[0]["id"])
	if err != nil || len(acts) == 0 {
		writeJSON(w, 200, nil)
		return
	}
	writeJSON(w, 200, acts[0])
}

func handleDays(w http.ResponseWriter, r *http.Request) {
	rows, err := q(`SELECT id, day, kind, subtype, duration_min, rpe, dist_m, explosive FROM activities ORDER BY day, id`)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, rows)
}

func handleSaveExercise(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID        int64  `json:"id"`
		Name      string `json:"name"`
		Muscle    string `json:"muscle"`
		Muscles2  string `json:"muscles2"`
		Equipment string `json:"equipment"`
		RestSec   int    `json:"rest_sec"`
		Aliases   string `json:"aliases"`
		Notes     string `json:"notes"`
	}
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, "bad json")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		fail(w, 400, "name required")
		return
	}
	if in.Muscle == "" {
		in.Muscle = "other"
	}
	if in.Equipment == "" {
		in.Equipment = "barbell"
	}
	in.RestSec = clamp(in.RestSec, 10, 900)
	id := in.ID
	if id == 0 {
		res, err := db.Exec(`INSERT INTO exercises(name,muscle,muscles2,equipment,rest_sec,aliases,notes) VALUES(?,?,?,?,?,?,?)`,
			in.Name, in.Muscle, in.Muscles2, in.Equipment, in.RestSec, in.Aliases, in.Notes)
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		id, _ = res.LastInsertId()
	} else if _, err := db.Exec(`UPDATE exercises SET name=?,muscle=?,muscles2=?,equipment=?,rest_sec=?,aliases=?,notes=?,archived=0 WHERE id=?`,
		in.Name, in.Muscle, in.Muscles2, in.Equipment, in.RestSec, in.Aliases, in.Notes, id); err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, M{"id": id})
}

func handleDeleteExercise(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, 400, "bad id")
		return
	}
	var used int
	_ = db.QueryRow(`SELECT COUNT(*) FROM sets WHERE exercise_id=?`, id).Scan(&used)
	if _, err := db.Exec(`DELETE FROM template_items WHERE exercise_id=?`, id); err != nil {
		fail(w, 500, err.Error())
		return
	}
	if used > 0 {
		// history keeps pointing at it, so hide it instead of breaking old sessions
		if _, err := db.Exec(`UPDATE exercises SET archived=1 WHERE id=?`, id); err != nil {
			fail(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, M{"archived": true, "used": used})
		return
	}
	if _, err := db.Exec(`DELETE FROM exercises WHERE id=?`, id); err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, M{"deleted": true})
}

func handleSaveTemplate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID    int64   `json:"id"`
		Name  string  `json:"name"`
		Items []int64 `json:"items"`
	}
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, "bad json")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		fail(w, 400, "name required")
		return
	}
	tx, err := db.Begin()
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	defer tx.Rollback()
	id := in.ID
	if id == 0 {
		var pos int
		_ = tx.QueryRow(`SELECT COALESCE(MAX(pos)+1,0) FROM templates`).Scan(&pos)
		res, err := tx.Exec(`INSERT INTO templates(name,pos) VALUES(?,?)`, in.Name, pos)
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		id, _ = res.LastInsertId()
	} else {
		if _, err := tx.Exec(`UPDATE templates SET name=? WHERE id=?`, in.Name, id); err != nil {
			fail(w, 500, err.Error())
			return
		}
		if _, err := tx.Exec(`DELETE FROM template_items WHERE template_id=?`, id); err != nil {
			fail(w, 500, err.Error())
			return
		}
	}
	for i, ex := range in.Items {
		if _, err := tx.Exec(`INSERT INTO template_items(template_id,exercise_id,pos) VALUES(?,?,?)`, id, ex, i); err != nil {
			fail(w, 500, err.Error())
			return
		}
	}
	if err := tx.Commit(); err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, M{"id": id})
}

func handleDeleteTemplate(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, 400, "bad id")
		return
	}
	if _, err := db.Exec(`DELETE FROM templates WHERE id=?`, id); err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, M{"ok": true})
}

func handleSchedule(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Rows []struct {
			Dow        int    `json:"dow"`
			TemplateID *int64 `json:"template_id"`
			Label      string `json:"label"`
		} `json:"rows"`
	}
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, "bad json")
		return
	}
	for _, row := range in.Rows {
		if row.Dow < 0 || row.Dow > 6 {
			continue
		}
		if _, err := db.Exec(`INSERT OR REPLACE INTO schedule(dow,template_id,label) VALUES(?,?,?)`, row.Dow, row.TemplateID, row.Label); err != nil {
			fail(w, 500, err.Error())
			return
		}
	}
	writeJSON(w, 200, M{"ok": true})
}

func handleSettings(w http.ResponseWriter, r *http.Request) {
	var in map[string]string
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, "bad json")
		return
	}
	for k, v := range in {
		if _, ok := defaultSettings[k]; !ok {
			continue // only known keys
		}
		if _, err := db.Exec(`INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)`, k, v); err != nil {
			fail(w, 500, err.Error())
			return
		}
	}
	writeJSON(w, 200, M{"ok": true})
}

// handlePRs: PR events (timeline) plus each exercise's current bests (wall).
func handlePRs(w http.ResponseWriter, r *http.Request) {
	events, err := q(`SELECT p.*, e.name AS ex_name, e.equipment, e.muscle FROM prs p JOIN exercises e ON e.id=p.exercise_id ORDER BY p.day DESC, p.id DESC`)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	rows, err := q(`SELECT s.exercise_id, a.day, s.w10, s.reps, e.name AS ex_name, e.equipment, e.muscle
		FROM sets s JOIN activities a ON a.id=s.activity_id JOIN exercises e ON e.id=s.exercise_id
		WHERE s.kind != 'warm' AND s.reps > 0 AND e.archived = 0 ORDER BY a.day, a.id, s.pos`)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	type best struct {
		name, equip, muscle string
		wDay, eDay, rDay    string
		w, wReps, e, r      int
	}
	bests := map[int64]*best{}
	order := []int64{}
	for _, row := range rows {
		ex := toInt64(row["exercise_id"])
		b, ok := bests[ex]
		if !ok {
			b = &best{name: row["ex_name"].(string), equip: row["equipment"].(string), muscle: row["muscle"].(string)}
			bests[ex] = b
			order = append(order, ex)
		}
		w10, reps, day := int(toInt64(row["w10"])), int(toInt64(row["reps"])), row["day"].(string)
		if w10 > b.w || (w10 == b.w && reps > b.wReps) {
			b.w, b.wReps, b.wDay = w10, reps, day
		}
		if e := e1rm(w10, reps); e > b.e {
			b.e, b.eDay = e, day
		}
		if w10 == 0 && reps > b.r {
			b.r, b.rDay = reps, day
		}
	}
	wall := []M{}
	for _, ex := range order {
		b := bests[ex]
		wall = append(wall, M{"exercise_id": ex, "name": b.name, "equipment": b.equip, "muscle": b.muscle,
			"w10": b.w, "w_reps": b.wReps, "w_day": b.wDay, "e1rm": b.e, "e_day": b.eDay, "bw_reps": b.r, "r_day": b.rDay})
	}
	writeJSON(w, 200, M{"events": events, "wall": wall})
}

func kg1(w10 int64) string { return fmt.Sprintf("%d.%d", w10/10, w10%10) }

func handleCSV(w http.ResponseWriter, r *http.Request) {
	rows, err := q(`SELECT a.day, a.kind, a.subtype, a.duration_min, a.rpe, a.dist_m, a.explosive, a.points, a.notes,
		COALESCE(e.name,'') AS ex, COALESCE(s.pos,0) AS pos, COALESCE(s.w10,0) AS w10, COALESCE(s.reps,0) AS reps,
		COALESCE(s.rpe10,0) AS rpe10, COALESCE(s.kind,'') AS skind
		FROM activities a LEFT JOIN sets s ON s.activity_id=a.id LEFT JOIN exercises e ON e.id=s.exercise_id
		ORDER BY a.day, a.id, s.pos`)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="hadid-export-`+time.Now().Format("2006-01-02")+`.csv"`)
	_, _ = w.Write([]byte("\xef\xbb\xbf")) // BOM so Excel reads UTF-8
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"day", "activity", "subtype", "duration_min", "effort_rpe", "distance_km", "explosive", "points", "notes", "exercise", "set_no", "weight_kg", "reps", "set_rpe", "set_kind"})
	for _, x := range rows {
		dist := toInt64(x["dist_m"])
		distS := ""
		if dist > 0 {
			distS = fmt.Sprintf("%d.%02d", dist/1000, (dist%1000)/10)
		}
		setNo, w10, rpe10 := "", "", ""
		if x["ex"].(string) != "" {
			setNo = strconv.FormatInt(toInt64(x["pos"])+1, 10)
			w10 = kg1(toInt64(x["w10"]))
			if toInt64(x["rpe10"]) > 0 {
				rpe10 = kg1(toInt64(x["rpe10"]))
			}
		}
		_ = cw.Write([]string{
			x["day"].(string), x["kind"].(string), x["subtype"].(string),
			strconv.FormatInt(toInt64(x["duration_min"]), 10), strconv.FormatInt(toInt64(x["rpe"]), 10), distS,
			strconv.FormatInt(toInt64(x["explosive"]), 10), strconv.FormatInt(toInt64(x["points"]), 10), x["notes"].(string),
			x["ex"].(string), setNo, w10, strconv.FormatInt(toInt64(x["reps"]), 10), rpe10, x["skind"].(string),
		})
	}
	cw.Flush()
}
