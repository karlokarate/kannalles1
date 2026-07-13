@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js 22.18 oder neuer wird benoetigt.
  pause
  exit /b 1
)
node scripts\verify-node-version.mjs || exit /b 1
if not exist dist\index.html (
  echo Erzeuge die Offline-Web-App ...
  call npm ci || exit /b 1
  call npm run build || exit /b 1
)
if "%PORT%"=="" set PORT=8787
if "%HOST%"=="" set HOST=127.0.0.1
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:%PORT%"
node scripts\serve-static.mjs dist
endlocal
