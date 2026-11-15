@echo off
cd /d "%~dp0"
node packages\gateway\bin\tunnel.mjs
pause
