#!/usr/bin/env bash
# Development only: stages the ffmpeg/ffprobe found on PATH (e.g. Homebrew) as Tauri sidecars so
# `pnpm tauri dev` / `tauri build` work on macOS without running build-ffmpeg-macos.sh first.
# Homebrew's ffmpeg is GPL and dynamically linked: never ship a bundle built this way.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$ROOT/apps/desktop/src-tauri/binaries
mkdir -p "$OUT"
TRIPLE=$(rustc -vV | sed -n 's/^host: //p')
for TOOL in ffmpeg ffprobe; do
  SRC=$(command -v "$TOOL") || { echo "error: $TOOL not on PATH (brew install ffmpeg)" >&2; exit 1; }
  for T in "$TRIPLE" universal-apple-darwin; do
    cp -f "$SRC" "$OUT/$TOOL-$T"
  done
done
ls -l "$OUT"
