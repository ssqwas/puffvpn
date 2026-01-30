@echo off
:: Запуск PuffVPN от имени администратора
cd /d "%~dp0"
powershell -Command "Start-Process powershell -ArgumentList '-NoExit -Command cd ''%~dp0''; npm run dev' -Verb RunAs -Wait"
