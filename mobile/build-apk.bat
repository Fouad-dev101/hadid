@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Hadid - build Android APK
echo.
echo  HADID  -  building the Android app
echo  ----------------------------------------

where node >nul 2>nul
if errorlevel 1 ( echo  Node.js 22 or newer is needed: https://nodejs.org & goto :fail )

rem --- find Java (Android Studio ships one) and the Android SDK
if not defined JAVA_HOME if exist "%ProgramFiles%\Android\Android Studio\jbr" set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
if not defined ANDROID_HOME if exist "%LOCALAPPDATA%\Android\Sdk" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not defined JAVA_HOME ( echo  Could not find Java. Install Android Studio first: https://developer.android.com/studio & goto :fail )
if not defined ANDROID_HOME ( echo  Could not find the Android SDK. Open Android Studio once and finish its setup. & goto :fail )
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"
set "SDKDIR=%ANDROID_HOME:\=/%"
> android\local.properties echo sdk.dir=%SDKDIR%

echo  [1/4] Installing packages...
if not exist node_modules ( call npm install || goto :fail )

echo  [2/4] Building the web app...
call node tools\build-www.js || goto :fail

echo  [3/4] Syncing into the Android project...
call npx cap sync android || goto :fail

echo  [4/4] Compiling (the first run downloads Gradle, give it a few minutes)...
pushd android
if exist keystore.properties (
  call gradlew.bat assembleRelease || ( popd & goto :fail )
  set "APK=app\build\outputs\apk\release\app-release.apk"
  set "KIND=release (signed with your key)"
) else (
  echo.
  echo  No keystore.properties yet, so this is a DEBUG build: fine for your own phone.
  echo  Run make-keystore.bat once before sharing the app with friends.
  echo.
  call gradlew.bat assembleDebug || ( popd & goto :fail )
  set "APK=app\build\outputs\apk\debug\app-debug.apk"
  set "KIND=debug"
)
popd

if not exist dist mkdir dist
copy /y "android\%APK%" "dist\Hadid.apk" >nul
if errorlevel 1 goto :fail
echo.
echo  Done. %KIND%
echo  Your app: %CD%\dist\Hadid.apk
echo.

rem --- install straight onto a phone if one is plugged in with USB debugging on
set "PHONE="
for /f "skip=1 tokens=1,2" %%a in ('adb devices 2^>nul') do if "%%b"=="device" set "PHONE=%%a"
if defined PHONE (
  set /p GO= A phone is connected. Install Hadid on it now? [Y/n]: 
  if /i not "!GO!"=="n" ( adb -s !PHONE! install -r "dist\Hadid.apk" && adb -s !PHONE! shell monkey -p app.hadid.log -c android.intent.category.LAUNCHER 1 >nul 2>nul )
) else (
  echo  No phone detected. Copy dist\Hadid.apk to your phone and open it there.
)
echo.
pause
exit /b 0

:fail
echo.
echo  Something went wrong, see the message above.
pause
exit /b 1
