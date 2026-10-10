# Hadid · حديد

An evening-first training log for Windows. Lift, run, play ball, then spend under a minute writing it down. One small binary, no cloud, no account, your data stays in a SQLite file on your own machine.

<p align="center"><img src="docs/screenshots/home.png" alt="Home: the Log today plate" width="760"></p>

> Screenshot slots live in `docs/screenshots/`. Run `run.bat --demo`, take the shots below, and drop them in.
> `home.png` · `log-lift.png` · `pr-celebration.png` · `pr-wall.png` · `plates.png` · `history.png`

## Download

| | |
|---|---|
| **Windows 10/11** | [Hadid-windows-x64.zip](https://github.com/Fouad-dev101/hadid/releases/latest/download/Hadid-windows-x64.zip): extract, run `Install-Hadid.bat` |
| **Android** | [Hadid.apk](https://github.com/Fouad-dev101/hadid/releases/latest/download/Hadid.apk): open it on your phone and allow "install unknown apps" |

Both are free, work offline and keep your data on your own device. All releases: [Releases page](https://github.com/Fouad-dev101/hadid/releases). Windows may warn "Windows protected your PC" and Android may show an "unknown developer" notice, because the app isn't signed with a paid certificate or on a store. Choose *More info, Run anyway* / *Install anyway*; the code is all here.

## Why

Most gym apps assume you are logging between sets. Hadid assumes you are on the couch at 9 pm and want to be done in a minute. Live logging exists, but it is the optional mode.

## What it does (Stage A)

- **Log today, fast.** Home is one big button. Pick Lifting, Run, Basketball or Other. Every activity gets duration + effort (RPE 1-10), and weekly load is `duration × RPE`.
- **Type your lifts like a note.** `bench 60x8, 65x8, 70x6` is parsed live into sets with a preview, exercise autocomplete, last-session "ghost" numbers, overload suggestions and *Copy last session*.
- **PR engine.** Heaviest weight, estimated 1RM (Epley), best reps at a weight, and session volume. A new PR gets a stamp, confetti and a sound. The first time you log an exercise is a baseline, not a PR.
- **Streaks that forgive.** Any activity or a planned or one-tap rest day keeps the streak alive. After 8 pm Hadid nudges you if nothing is logged.
- **Stacking warning.** Hard legs next to a hard game or a long run gets a gentle heads-up.
- **Runs and ball.** Distance, time and automatic pace; basketball with practice/game/pickup, minutes, explosive toggle and points.
- **Plate calculator.** Target weight to plates per side, drawn on a barbell. Bar, smith and dumbbell modes, kg or lb.
- **Live mode (optional).** Compact set logger with an automatic rest timer that follows you to every screen.
- **Your library and routine.** Editable exercises with nicknames, workouts, and a weekly schedule.
- **Safe by default.** Daily automatic backup (last 14 kept), manual backup, CSV export.
- Dark and light themes, `prefers-reduced-motion` respected, plus a *Reduce effects* switch.

Syntax cheat sheet for the sets box:

| Type | Means |
|---|---|
| `bench 60x8, 65x8` | two sets |
| `squat 100x5x3` | three sets of 100 × 5 |
| `w40x10` | warm-up set (ignored by PRs and volume) |
| `d30x8` | drop set |
| `60x10@8` | ten reps at RPE 8 |
| `& pushdown 50x15` | superset with the line above |
| `pullups bw x8` | bodyweight, eight reps |

## Build it yourself (Windows 10/11)

1. Install Go 1.22 or newer from <https://go.dev/dl/>.
2. Double-click **`install.bat`**. It builds the app, installs it to `%LOCALAPPDATA%\Programs\Hadid`, and adds Desktop and Start menu shortcuts.
3. Launch **Hadid**. It opens in its own Edge or Chrome app window.

Updating is the same: run `install.bat` again. Your data is never touched.

Try it with fake data first: `run.bat --demo` (uses a separate demo database).

## On your phone (Android)

Hadid also runs as a free Android app that works fully offline, with its own on-device database. See **[docs/ANDROID.md](docs/ANDROID.md)**: run `mobile\build-apk.bat` and send the APK to a phone.

## Architecture

```
main.go    flags, port picker, watchdog, app window, daily backup
db.go      schema, seed data, settings (weights are integer tenths of a kg)
api.go     JSON API on net/http (Go 1.22 pattern routing)
prs.go     PR engine, integer-only Epley
demo.go    76 days of fake history for --demo
ico.go     draws the icon, no image assets in the repo
web/       embedded UI, vanilla JS + CSS, no build step, no CDN
mobile/    Android build: Capacitor shell + the Go backend ported to JS (src/store.js)
  js/parse.js   lift text parser (unit-tested: node tests/parse_test.js)
  js/lib.js     helpers, charts, audio, confetti, rest timer
  js/app.js     router, home, log forms
  js/views.js   history, PRs, plates, live, library, routine, settings
```

- **Single binary.** `net/http`, `database/sql`, `modernc.org/sqlite` (pure Go, no CGO), UI via `go:embed`.
- **Window lifetime follows the page.** The page pings `/api/ping` every 15 s and sends `/api/bye` on close; a watchdog exits about 20 s after the last heartbeat. Hadid is not tied to the browser process, so it cleans up even if Edge is already running.
- **Port picker.** Tries 47820-47840 and checks `/api/whoami` so a second launch reuses the running instance.
- **Data** lives in `%APPDATA%\Hadid` (override with `HADID_DIR`): `hadid.db`, `backups/`, `hadid.log`.
- **No floats for weights.** Everything is stored in tenths of a kilo, so 62.5 kg never becomes 62.49999.

## Roadmap

**Stage B (next)**
- SVG body map with weekly sets per muscle, highlighting arms and upper chest, and leg load from runs and basketball
- Progress charts: estimated 1RM, volume, bodyweight with moving average, weekly run distance and pace
- Check-ins: creatine, protein, bodyweight, arm circumference
- Weekly review including runs, basketball and leg load
- Calendar heatmap, weekly goal rings, XP, levels and badges

**Phone**
- Android app (done, needs real-device testing), then phone-first polish for Stage B screens
- Play Store listing, iPhone via the same code (needs a Mac)

**Later**
- Import from CSV, per-exercise notes and photos, plate inventory per gym

## Develop

```
run.bat                 real data, console logging
run.bat --demo          demo database
node tests/parse_test.js
```

## License

MIT, do what you like.
