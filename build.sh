#!/usr/bin/env sh
set -eu

mkdir -p release-lpk

for file in package.yml lzc-build.yml lzc-manifest.yml Dockerfile lzc-icon.png; do
  if [ ! -f "$file" ]; then
    echo "Missing required Lazycat packaging file: $file" >&2
    exit 1
  fi
done

if [ ! -f lzc-content/lazycat-injects/lzc-file-chooser-inject.js ]; then
  echo "Missing Lazycat file chooser inject script" >&2
  exit 1
fi

echo "Lazycat packaging preflight passed."
