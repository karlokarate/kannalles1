@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js 22.18 oder neuer wird benoetigt.
  pause
  exit /b 1
)
node scripts\verify-node-version.mjs || (
  echo Node.js 22.18 oder neuer wird benoetigt. Node 24 LTS wird empfohlen.
  pause
  exit /b 1
)
if not exist dist\index.html (
  echo Source-Checkout erkannt: installiere Build-Werkzeuge und erzeuge die Web-App ...
  call npm ci || exit /b 1
  call npm run api:generate || exit /b 1
  call npm run build || exit /b 1
) else if not exist node_modules (
  call npm ci --omit=dev || exit /b 1
)
if "%PORT%"=="" set PORT=8787
if "%HOST%"=="" set HOST=127.0.0.1
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:%PORT%"
node server\index.mjs
endlocal
