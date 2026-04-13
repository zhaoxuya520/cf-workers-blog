@echo off
setlocal
cd /d %~dp0\..
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 tools\writer_app.py
  exit /b %errorlevel%
)
where python >nul 2>nul
if %errorlevel%==0 (
  python tools\writer_app.py
  exit /b %errorlevel%
)
echo Python 3 not found. Please install Python 3 and try again.
exit /b 1

