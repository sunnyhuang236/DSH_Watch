@echo off
cd /d "%~dp0"
echo Starting DSH Watch Gateway on http://127.0.0.1:8787 ...
node packages\gateway\bin\gateway.mjs
pause
