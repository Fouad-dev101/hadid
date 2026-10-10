# Hadid on Android

> **Easiest route:** let GitHub build the APK for you, no Android Studio needed. See [RELEASING.md](RELEASING.md). The rest of this page is for building it on your own PC.

The phone app is the same web UI as the desktop app, wrapped with [Capacitor](https://capacitorjs.com). There is no server: the Go backend was rewritten in JS (`mobile/src/store.js`) and runs inside the app on SQLite (sql.js), so it works fully offline and your data never leaves the phone. Everything used here is free.

## One-time setup (on your Windows PC)

1. **Node.js 22 or newer**: <https://nodejs.org>
2. **Android Studio**: <https://developer.android.com/studio>. Open it once and let it finish the setup wizard (it downloads the Android SDK). In *More Actions → SDK Manager*, make sure **Android 16 (API 36)** is installed.
3. **Your phone**: Settings → About phone → tap *Build number* 7 times → back to Settings → *Developer options* → turn on **USB debugging**.

## Build and install

Double-click **`mobile\build-apk.bat`**. The first run takes a few minutes (it downloads Gradle). When it finishes:

- Phone plugged in by USB: it offers to install and launch the app right away.
- Otherwise your app is at **`mobile\dist\Hadid.apk`**.

### Getting the APK onto a phone without USB

Send `Hadid.apk` to yourself (WhatsApp, Telegram "Saved Messages", Google Drive, email) or copy it over with a cable. On the phone open it from the Downloads / Files app. Android asks you to allow "install unknown apps" for that app (once). Tap **Install**.

### Finding it afterwards

It is a normal app named **Hadid**: open the app drawer and search "Hadid". Long-press the icon to add it to your home screen.

## Sharing it with friends (free)

1. Run **`mobile\make-keystore.bat` once**. It creates the key that signs your app. **Back up `mobile\android\hadid-release.jks` and `keystore.properties`** (Drive + a USB stick). Lose it and nobody can update over an existing install, they would have to uninstall and lose their data.
2. Run `build-apk.bat` again: now it makes a signed release build.
3. Upload `Hadid.apk` to a GitHub *Release* (free) or Drive and send the link.
4. Friends tap the file, allow "install unknown apps", install. Play Protect may show an "unknown developer" notice: *More details → Install anyway*.

Updating: bump `versionCode` (and `versionName`) in `mobile/android/app/build.gradle`, rebuild, and send the new APK. It installs over the old one and keeps the data, as long as it is signed with the same key.

## Your data

- Stored inside the app (SQLite file inside IndexedDB). Uninstalling erases it.
- **Settings → Back up now** opens the share sheet with a `.db` file: save it to Drive or send it to yourself. **Restore backup** loads it again, also on a new phone.
- **Export CSV** gives a spreadsheet of every session.

## What is tested and what is not

Tested here (automated): the backend port matches the Go server route by route (`node tests/parity.js`), every screen and the main flows run against the local store (`node tests/ui_flow.js`), and the Android glue is exercised against a stubbed Capacitor (`node tests/native_flow.js`).

**Not tested:** the actual Android build, the phone layout on a real screen, the share sheet and the rest-timer notification on a device. Expect a round of "this looks off on my phone" fixes. Please send screenshots.

## Notes

- The Android template includes the `INTERNET` permission. Hadid does not use the network, you can remove that line from `AndroidManifest.xml` if you want an app that visibly asks for nothing.
- Android's own cloud backup may restore the app's data when you set up a new phone. Do not rely on it, use the backup button.
- Play Store later: the same project works. You would need a Play Console account ($25), a privacy policy, and (for new personal accounts) a 14-day closed test with at least 12 testers.
