@echo off
rem yoga-auto: od zera do uruchomienia na Yodze.
rem   yoga.bat            - gra: instalacja, build aplikacji i pluginu, DLL do ETS2, bridge na pipe
rem   yoga.bat mock       - bez gry: bridge na mocku (scenariusz highway)
rem   yoga.bat replay     - bez gry: bridge odtwarza nagranie jazdy
rem   yoga.bat check      - testy (npm run check)
rem   yoga.bat plugin     - tylko build pluginu i kopia DLL do ETS2
rem   yoga.bat help       - wszystkie opcje
rem Szczegoly: scripts\yoga.ps1
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\yoga.ps1" %*
set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" (
  echo.
  echo yoga.bat zakonczyl sie bledem %ERR%.
  pause
)
exit /b %ERR%
