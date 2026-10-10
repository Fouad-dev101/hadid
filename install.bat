@echo off
setlocal
cd /d "%~dp0"
title Installing Hadid
echo.
echo  HADID  -  installing
echo  ----------------------------------------

where go >nul 2>nul
if errorlevel 1 (
  echo  Go is not installed. Get it from https://go.dev/dl/ and run this again.
  pause
  exit /b 1
)

echo  [1/5] Closing Hadid if it is running...
taskkill /f /im hadid.exe >nul 2>nul

echo  [2/5] Fetching the SQLite driver (first run needs internet)...
go mod tidy
if errorlevel 1 goto :fail

echo  [3/5] Building...
if not exist build mkdir build
go build -ldflags "-H windowsgui -s -w" -o "build\hadid.exe" .
if errorlevel 1 goto :fail
start "" /wait "build\hadid.exe" --make-ico "build\hadid.ico"

echo  [4/5] Installing to %LOCALAPPDATA%\Programs\Hadid ...
set "DEST=%LOCALAPPDATA%\Programs\Hadid"
if not exist "%DEST%" mkdir "%DEST%"
copy /y "build\hadid.exe" "%DEST%\hadid.exe" >nul
copy /y "build\hadid.ico" "%DEST%\hadid.ico" >nul
if errorlevel 1 goto :fail

echo  [5/5] Creating shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$sh=New-Object -ComObject WScript.Shell; foreach($d in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){ $l=$sh.CreateShortcut($d+'\Hadid.lnk'); $l.TargetPath='%DEST%\hadid.exe'; $l.WorkingDirectory='%DEST%'; $l.IconLocation='%DEST%\hadid.ico'; $l.Description='Hadid gym log'; $l.Save() }"

echo.
echo  Done. Hadid is on your Desktop and in the Start menu.
echo  Your data lives in %APPDATA%\Hadid and is untouched by reinstalls.
echo.
set /p RUN= Open it now? [Y/n]: 
if /i not "%RUN%"=="n" start "" "%DEST%\hadid.exe"
exit /b 0

:fail
echo.
echo  Something went wrong, see the message above.
pause
exit /b 1
