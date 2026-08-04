@echo off
setlocal
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

where cargo >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo 没有找到 Rust。请先安装 rustup：https://rustup.rs
  pause
  exit /b 1
)

where dx >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  cargo install dioxus-cli --version 0.7.10 --locked
  if %ERRORLEVEL% NEQ 0 exit /b 1
)

cd rust-app
dx bundle --desktop --release --features bundle --package-types nsis
if %ERRORLEVEL% NEQ 0 (
  echo 安装包构建失败，请查看上方错误。
  pause
  exit /b 1
)
if exist desktop-dist\server.exe del /q desktop-dist\server.exe

echo.
echo Windows 安装包已生成，请查看 desktop-dist\
pause
endlocal
