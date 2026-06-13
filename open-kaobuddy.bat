@echo off
setlocal

cd /d "%~dp0"

where py >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo 没有找到 Python 3。请先安装 Python 3，然后再双击这个文件。
  echo 下载地址：https://www.python.org/downloads/
  pause
  exit /b 1
)

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo 没有找到 Node.js。请先安装 Node.js LTS，然后再双击这个文件。
  echo 下载地址：https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo 没有找到 npm。请重新安装 Node.js LTS，然后再双击这个文件。
  echo 下载地址：https://nodejs.org/
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
)

".venv\Scripts\python.exe" -m pip install -e ".[test]" >nul

if not exist "node_modules\vite\bin\vite.js" (
  npm install
)

if exist "node_modules\vite\bin\vite.js" (
  node node_modules\typescript\bin\tsc >nul
  node node_modules\vite\bin\vite.js build >nul
)

start "" "http://127.0.0.1:8000"
".venv\Scripts\python.exe" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000

endlocal
