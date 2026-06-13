#!/bin/zsh
set -e

cd "$(dirname "$0")"

PYTHON_BIN="${PYTHON_BIN:-$(command -v python3 || true)}"
if [ -z "$PYTHON_BIN" ]; then
  echo "没有找到 Python 3。请先安装 Python 3，然后再双击这个文件。"
  echo "下载地址：https://www.python.org/downloads/"
  read "?按回车退出..."
  exit 1
fi

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
NPM_BIN="${NPM_BIN:-$(command -v npm || true)}"
if [ -z "$NODE_BIN" ] || [ -z "$NPM_BIN" ]; then
  echo "没有找到 Node.js / npm。请先安装 Node.js LTS，然后再双击这个文件。"
  echo "下载地址：https://nodejs.org/"
  read "?按回车退出..."
  exit 1
fi

if [ ! -x ".venv/bin/python" ] || ! .venv/bin/python -c "import sys" >/dev/null 2>&1; then
  rm -rf .venv
  "$PYTHON_BIN" -m venv .venv
fi

.venv/bin/python -m pip install -e ".[test]" >/dev/null

if [ ! -f "node_modules/vite/bin/vite.js" ]; then
  "$NPM_BIN" install >/dev/null
fi

if [ -f "node_modules/vite/bin/vite.js" ]; then
  "$NODE_BIN" node_modules/typescript/bin/tsc >/dev/null
  "$NODE_BIN" node_modules/vite/bin/vite.js build >/dev/null
fi

open "http://127.0.0.1:8000"
.venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
