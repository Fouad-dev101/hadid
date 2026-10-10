@echo off
setlocal
cd /d "%~dp0"
title Hadid - create signing key
if exist android\keystore.properties (
  echo  A signing key already exists in android\. Creating another would stop updates
  echo  from installing over the old app. Delete android\keystore.properties by hand if you really mean it.
  pause & exit /b 1
)
set "KT="
where keytool >nul 2>nul && set "KT=keytool"
if not defined KT if defined JAVA_HOME if exist "%JAVA_HOME%\bin\keytool.exe" set "KT=%JAVA_HOME%\bin\keytool.exe"
if not defined KT if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\keytool.exe" set "KT=%ProgramFiles%\Android\Android Studio\jbr\bin\keytool.exe"
if not defined KT (
  echo  keytool was not found. It comes with Java. Install the free JDK with this command, then reopen this window:
  echo      winget install EclipseAdoptium.Temurin.21.JDK
  pause & exit /b 1
)
echo.
echo  This makes the key that signs every Hadid update. Anyone who installs your APK
echo  can only update it with an APK signed by this SAME key.
echo  BACK UP android\hadid-release.jks and android\keystore.properties after this (Drive + USB stick).
echo.
set /p PW= Choose a password (6+ characters, no quotes or spaces, write it down): 
if "%PW%"=="" ( echo  Password cannot be empty. & pause & exit /b 1 )
"%KT%" -genkeypair -v -keystore android\hadid-release.jks -alias hadid -keyalg RSA -keysize 2048 -validity 10000 -storepass "%PW%" -keypass "%PW%" -dname "CN=Hadid, O=Hadid, C=MA"
if errorlevel 1 ( echo  keytool failed. & pause & exit /b 1 )
> android\keystore.properties echo storeFile=hadid-release.jks
>> android\keystore.properties echo storePassword=%PW%
>> android\keystore.properties echo keyAlias=hadid
>> android\keystore.properties echo keyPassword=%PW%
echo.
echo  Done. Key saved in android\hadid-release.jks
echo  Next: run  powershell -File tools\keystore-to-secrets.ps1  to get the two values GitHub needs.
pause
