#!/bin/zsh
set -e

cd "$(dirname "$0")"

if ! command -v cargo >/dev/null 2>&1; then
  echo "没有找到 Rust。请先安装 rustup：https://rustup.rs"
  read "?按回车退出..."
  exit 1
fi

if ! command -v dx >/dev/null 2>&1; then
  echo "第一次启动需要安装 Dioxus CLI，请稍等。"
  cargo install dioxus-cli --version 0.7.10 --locked
fi

rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
open "http://127.0.0.1:8000"
cd rust-app
dx serve --web --port 8000
