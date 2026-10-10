@echo off
setlocal
cd /d "%~dp0"
title Installing Hadid
echo.
echo  HADID  -  installing
echo  ----------------------------------------

if not exist hadid.exe (
  echo  hadid.exe is not next to this file. Extract the WHOLE zip first, then run this again.
  pause
  exit /b 1
)

set "DEST=%LOCALAPPDATA%\Programs\Hadid"
taskkill /f /im hadid.exe >nul 2>nul
if not exist "%DEST%" mkdir "%DEST%"
copy /y hadid.exe "%DEST%\hadid.exe" >nul
if errorlevel 1 ( echo  Could not copy the app. Is Hadid still running? Close it and retry. & pause & exit /b 1 )

start "" /wait "%DEST%\hadid.exe" --make-ico "%DEST%\hadid.ico"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$sh=New-Object -ComObject WScript.Shell; foreach($d in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){ $l=$sh.CreateShortcut($d+'\Hadid.lnk'); $l.TargetPath='%DEST%\hadid.exe'; $l.WorkingDirectory='%DEST%'; $l.IconLocation='%DEST%\hadid.ico'; $l.Description='Hadid gym log'; $l.Save() }"

echo.
echo  Done. Hadid is on your Desktop and in the Start menu.
echo  Your data lives in %APPDATA%\Hadid and is kept when you update.
echo.
set /p RUN= Open it now? [Y/n]: 
if /i not "%RUN%"=="n" start "" "%DEST%\hadid.exe"
exit /b 0
