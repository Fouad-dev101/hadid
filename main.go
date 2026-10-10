// Hadid (حديد) — a gym & training log. One Go binary, SQLite inside, UI embedded.
package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed web
var webFS embed.FS

const (
	appVersion  = "0.1.0"
	portFirst   = 47820
	portLast    = 47840
	pingTimeout = 20 * time.Second
	keepBackups = 14
)

var (
	dataDir  string
	demoMode bool
	lastPing atomic.Int64 // unix nanos of the last page heartbeat
	quit     = make(chan string, 1)
)

func main() {
	demo := flag.Bool("demo", false, "use a separate demo database filled with realistic fake data")
	noWindow := flag.Bool("nowindow", false, "do not open a window (development)")
	console := flag.Bool("console", false, "also log to stderr")
	icoPath := flag.String("make-ico", "", "write hadid.ico to this path and exit")
	flag.Parse()

	if *icoPath != "" {
		if err := writeICO(*icoPath); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	demoMode = *demo || os.Getenv("HADID_DEMO") == "1"

	if err := setupDataDir(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	setupLog(*console)

	// Content types: the Windows registry can lie about these, so pin them.
	mime.AddExtensionType(".js", "text/javascript; charset=utf-8")
	mime.AddExtensionType(".css", "text/css; charset=utf-8")
	mime.AddExtensionType(".svg", "image/svg+xml")
	mime.AddExtensionType(".woff2", "font/woff2")

	ln, reused, port := pickListener()
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	if reused {
		log.Printf("Hadid already running on port %d, opening a window to it", port)
		if !*noWindow {
			openWindow(url)
		}
		return
	}
	if ln == nil {
		log.Fatalf("no free port in %d-%d", portFirst, portLast)
	}

	if err := openDB(); err != nil {
		log.Fatalf("database: %v", err)
	}
	if demoMode {
		if err := seedDemo(); err != nil {
			log.Fatalf("demo data: %v", err)
		}
	}

	mux := http.NewServeMux()
	registerAPI(mux)
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("embed: %v", err)
	}
	mux.Handle("/", noCache(http.FileServer(http.FS(sub))))

	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("serve: %v", err)
			quit <- "server error"
		}
	}()
	log.Printf("Hadid %s listening on %s (data: %s, demo: %v)", appVersion, url, dataDir, demoMode)

	// Heartbeat: the page pings every 15s. Give the first window 25s of extra grace.
	lastPing.Store(time.Now().Add(25 * time.Second).UnixNano())
	if !*noWindow {
		go watchdog()
		openWindow(url)
	}
	if !demoMode {
		go backupLoop()
	}

	reason := <-quit
	log.Printf("shutting down: %s", reason)
	_ = srv.Close()
	if db != nil {
		_ = db.Close()
	}
}

func setupDataDir() error {
	dir := os.Getenv("HADID_DIR")
	if dir == "" {
		base := os.Getenv("APPDATA")
		if base == "" {
			b, err := os.UserConfigDir()
			if err != nil {
				return err
			}
			base = b
		}
		dir = filepath.Join(base, "Hadid")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	dataDir = abs
	return os.Chdir(dataDir)
}

func setupLog(console bool) {
	f, err := os.OpenFile("hadid.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	// keep the log from growing forever
	if st, err := f.Stat(); err == nil && st.Size() > 2<<20 {
		f.Close()
		_ = os.Rename("hadid.log", "hadid.old.log")
		f, err = os.OpenFile("hadid.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
		if err != nil {
			return
		}
	}
	var w io.Writer = f
	if console {
		w = io.MultiWriter(f, os.Stderr)
	}
	log.SetOutput(w)
	log.SetFlags(log.LstdFlags | log.Lshortfile)
}

// pickListener tries a port range. If a port is busy we ask it who it is: if it is
// really Hadid (same demo flag) we reuse it instead of starting a second copy.
func pickListener() (net.Listener, bool, int) {
	for p := portFirst; p <= portLast; p++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			return ln, false, p
		}
		if isHadid(p) {
			return nil, true, p
		}
	}
	return nil, false, 0
}

func isHadid(port int) bool {
	c := &http.Client{Timeout: 700 * time.Millisecond}
	resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/api/whoami", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var who struct {
		App  string `json:"app"`
		Demo bool   `json:"demo"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&who); err != nil {
		return false
	}
	return who.App == "hadid" && who.Demo == demoMode
}

func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".woff2") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-store")
		}
		h.ServeHTTP(w, r)
	})
}

// watchdog exits the program when the page stops pinging (window closed).
// It deliberately does NOT watch the browser process: Edge/Chrome may hand the
// window to an already-running instance and exit immediately.
func watchdog() {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for range t.C {
		last := time.Unix(0, lastPing.Load())
		if time.Since(last) > pingTimeout {
			select {
			case quit <- "window closed":
			default:
			}
			return
		}
	}
}

func openWindow(url string) {
	if runtime.GOOS != "windows" {
		_ = exec.Command("xdg-open", url).Start()
		return
	}
	pf, pf86, local := os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA")
	cands := []string{
		filepath.Join(pf86, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(pf86, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(local, `Google\Chrome\Application\chrome.exe`),
	}
	profile := "profile"
	if demoMode {
		profile = "profile-demo"
	}
	prof := filepath.Join(dataDir, profile)
	for _, c := range cands {
		if _, err := os.Stat(c); err != nil {
			continue
		}
		cmd := exec.Command(c, "--app="+url, "--user-data-dir="+prof,
			"--window-size=1240,860", "--no-first-run", "--no-default-browser-check")
		if err := cmd.Start(); err == nil {
			go func() { _ = cmd.Wait() }()
			return
		}
	}
	_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

// ---- backups -------------------------------------------------------------

func backupLoop() {
	dailyBackup()
	t := time.NewTicker(30 * time.Minute)
	defer t.Stop()
	for range t.C {
		dailyBackup()
	}
}

func dailyBackup() {
	name := filepath.Join("backups", "hadid-"+time.Now().Format("2006-01-02")+".db")
	if _, err := os.Stat(name); err == nil {
		return
	}
	if err := vacuumInto(name); err != nil {
		log.Printf("daily backup failed: %v", err)
		return
	}
	log.Printf("daily backup written: %s", name)
	pruneBackups()
}

func vacuumInto(name string) error {
	if err := os.MkdirAll(filepath.Dir(name), 0o755); err != nil {
		return err
	}
	_, err := db.Exec("VACUUM INTO '" + strings.ReplaceAll(name, "'", "''") + "'")
	return err
}

func pruneBackups() {
	files, err := filepath.Glob(filepath.Join("backups", "hadid-????-??-??.db"))
	if err != nil {
		return
	}
	sort.Strings(files)
	for len(files) > keepBackups {
		_ = os.Remove(files[0])
		files = files[1:]
	}
}

func manualBackup() (string, error) {
	name := filepath.Join("backups", "hadid-manual-"+time.Now().Format("2006-01-02_150405")+".db")
	return name, vacuumInto(name)
}
