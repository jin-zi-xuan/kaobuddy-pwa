@echo off
setlocal
cd /d "%~dp0"

where cargo >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo 没有找到 Rust。请先安装 rustup，然后再双击这个文件。
  echo 下载地址：https://rustup.rs
  pause
  exit /b 1
)

where dx >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo 第一次启动需要安装 Dioxus CLI，请稍等。
  cargo install dioxus-cli --version 0.7.10 --locked
  if %ERRORLEVEL% NEQ 0 (
    echo Dioxus CLI 安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

rustup target add wasm32-unknown-unknown >nul 2>nul
start "" "http://127.0.0.1:8000"
cd rust-app
dx serve --web --port 8000

endlocal
