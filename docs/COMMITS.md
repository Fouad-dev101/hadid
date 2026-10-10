# Suggested commits (Stage A)

Split the first push so the history reads like a build log:

1. `chore: scaffold hadid with go module, gitignore and install scripts`
   `go.mod`, `.gitignore`, `install.bat`, `run.bat`
2. `feat(core): sqlite schema, seed exercises and routine, settings`
   `db.go`
3. `feat(core): app window, port picker, heartbeat watchdog, daily backups`
   `main.go`, `ico.go`
4. `feat(api): activities, sets, exercises, templates, schedule, csv export`
   `api.go`
5. `feat(prs): epley e1rm and four pr kinds with rebuild`
   `prs.go`
6. `feat(parser): free-text lift parser with preview, aliases and overload suggestions`
   `web/js/parse.js`, `tests/parse_test.js`
7. `feat(ui): design system, plate dial home, log forms for lift run basketball other`
   `web/index.html`, `web/css`, `web/js/lib.js`, `web/js/app.js`, fonts
8. `feat(ui): history, pr wall, plate calculator, live mode, library, routine, settings`
   `web/js/views.js`
9. `feat(demo): 76 days of seeded history behind --demo`
   `demo.go`
10. `docs: readme with architecture, install and roadmap`
    `README.md`, `docs/`

# Suggested commits (phone build)

11. `feat(mobile): port the go backend to js on sql.js with parity tests against the go server`
    `mobile/src/store.js`, `mobile/tests/parity.js`
12. `feat(mobile): in-app database boot, backup and restore, csv export`
    `mobile/src/local-boot.js`, `web/js/lib.js`, `web/js/views.js`
13. `feat(mobile): capacitor android shell with share sheet, back button and rest notification`
    `mobile/android`, `mobile/src/native.js`, `mobile/capacitor.config.json`
14. `style(ui): phone layout with bottom tab bar`
    `web/css/app.css`
15. `chore(mobile): build-apk, make-keystore, icons, docs`
    `mobile/*.bat`, `mobile/tools`, `docs/ANDROID.md`
16. `ci: github actions for tests and tagged releases (windows zip + android apk)`
    `.github/workflows/*`, `release/`, `mobile/tools/ci-parity.sh`
17. `docs: releasing guide, license, third-party notices`
    `docs/RELEASING.md`, `LICENSE`, `THIRD_PARTY.md`
