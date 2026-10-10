# Publishing Hadid on GitHub (free, download-ready)

GitHub builds the Windows app **and** the Android APK in its cloud, then puts both on a Release page. You don't need Go, Android Studio or the Android SDK on your PC for this. Public repositories get unlimited free build minutes.

## 1. Put the project on GitHub (once)

1. On github.com click **New repository**, name it `hadid`, **Public**, and leave "Add a README" unticked.
2. In the unzipped project folder, in a terminal:

```
git init
git add .
git commit -m "feat: hadid, evening-first gym log for windows and android"
git branch -M main
git remote add origin https://github.com/Fouad-dev101/hadid.git
git push -u origin main
```

(`docs/COMMITS.md` has a nicer way to split the first push into several commits if you want a tidy history.)

The **CI** workflow now runs on every push (Actions tab). It checks the Go code with the real SQLite driver and runs all the tests, including one that proves the phone backend gives the same answers as the Go backend.

## 2. Make a release

```
git tag v0.1.0
git push origin v0.1.0
```

Open the **Actions** tab and watch **Release** run (about 10 minutes the first time). When it finishes, the **Releases** page (right sidebar of the repo) has:

| File | For |
|---|---|
| `Hadid-windows-x64.zip` | Windows 10/11: extract, run `Install-Hadid.bat`. No Go needed. |
| `Hadid.apk` | Android: download, open, install. |

Stable links that always point to the newest release (put them in your README, CV, Instagram bio):

```
https://github.com/Fouad-dev101/hadid/releases/latest/download/Hadid-windows-x64.zip
https://github.com/Fouad-dev101/hadid/releases/latest/download/Hadid.apk
```

## 3. Add the Android signing key (do this before sharing the APK)

Without a key, GitHub still builds the APK but names it `Hadid-test.apk` and marks the release as a **pre-release**. That build is signed with a throwaway key, so a later version cannot be installed over it: your friends would have to uninstall first and **lose their data**. A permanent key fixes that.

1. Install a free JDK if you don't have Java: `winget install EclipseAdoptium.Temurin.21.JDK` (then reopen the terminal).
2. Run `mobile\make-keystore.bat` and choose a password. **Back up** `mobile\android\hadid-release.jks` and `keystore.properties` somewhere safe (Drive + USB stick). If you lose them you can never update the app for existing users.
3. Run `powershell -File mobile\tools\keystore-to-secrets.ps1`. It copies one value to your clipboard and prints another.
4. On GitHub: repo → **Settings → Secrets and variables → Actions → New repository secret**. Create `ANDROID_KEYSTORE_BASE64` (paste) and `ANDROID_KEYSTORE_PASSWORD`.
5. Make a new tag (`v0.1.1`). Now the release contains the signed `Hadid.apk`.

The key and password never go in the repo (`.gitignore` blocks them); GitHub keeps them as encrypted secrets.

## Releasing an update

```
git add . && git commit -m "fix: ..." && git push
git tag v0.1.1 && git push origin v0.1.1
```

The version number comes from the tag, and each build gets a higher Android `versionCode` automatically, so the new APK installs over the old one and keeps the data. Use CI-built APKs for everyone (including yourself) so the numbers and signature stay consistent; a locally built `build-apk.bat` APK has a different version number and key.

## What users will see

- **Windows** may show "Windows protected your PC" because the exe isn't signed with a paid certificate: *More info → Run anyway*. The zip's `README.txt` says so.
- **Android** asks to allow "install unknown apps" for the app they opened the file with, and Play Protect may show an "unknown developer" notice: *More details → Install anyway*.

## Not verified yet

I could not run these workflows from here. The Go and test steps mirror what I ran locally, but the first real run may need small fixes (an Android SDK package name, a version pin). If a job fails, open it in the Actions tab, copy the red error and send it over.
