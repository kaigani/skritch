#!/usr/bin/env bash
# Builds the LGPL FFmpeg/FFprobe sidecars for Windows x64 by cross-compiling with MinGW-w64 on Linux
# or WSL. Same pinned FFmpeg/libvpx/Opus sources as scripts/build-ffmpeg-macos.sh, plus zlib (PNG
# encoding; macOS uses the system copy). Media Foundation provides hardware/OS H.264 and HEVC
# encoders; libvpx provides VP9/WebM. No GPL components, no network support, fully static: the
# executables depend only on Windows system DLLs.
#
# Usage (WSL): scripts/build-ffmpeg-windows.sh [output-dir] [source-archive-dir]
# The optional second argument retains the corresponding sources and build script for distribution.
# Needs: mingw-w64 nasm pkg-config make curl (apt install mingw-w64 nasm pkg-config make).
set -euo pipefail

FFMPEG_VERSION=7.1.1 # keep in sync with build-ffmpeg-macos.sh
VPX_VERSION=1.15.0
OPUS_VERSION=1.5.2
ZLIB_VERSION=1.3.1
HOST=x86_64-w64-mingw32
TRIPLE=x86_64-pc-windows-msvc

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$ROOT/apps/desktop/src-tauri/binaries}
WORK=$(mktemp -d)
PREFIX=$WORK/prefix
JOBS=${SKRITCH_BUILD_JOBS:-$(nproc)}
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT" "$PREFIX"
OUT=$(cd "$OUT" && pwd)
SOURCE_OUT=${2:-}
if [[ -n $SOURCE_OUT ]]; then
  mkdir -p "$SOURCE_OUT"
  SOURCE_OUT=$(cd "$SOURCE_OUT" && pwd)
fi

fetch() {
  local archive="$WORK/${1##*/}"
  curl -fsSL --retry 3 "$1" -o "$archive"
  tar -xz -C "$WORK" -f "$archive"
}
fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.gz"
fetch "https://github.com/webmproject/libvpx/archive/refs/tags/v$VPX_VERSION.tar.gz"
fetch "https://downloads.xiph.org/releases/opus/opus-$OPUS_VERSION.tar.gz"
fetch "https://zlib.net/fossils/zlib-$ZLIB_VERSION.tar.gz"

if [[ -n $SOURCE_OUT ]]; then
  cp "$WORK"/*.tar.gz "$SOURCE_OUT/"
  cp "$ROOT/scripts/build-ffmpeg-windows.sh" "$SOURCE_OUT/"
fi
cp "$WORK/zlib-$ZLIB_VERSION/LICENSE" "$ROOT/apps/desktop/src-tauri/resources/licenses/zlib-LICENSE.txt"

echo "== zlib"
cd "$WORK/zlib-$ZLIB_VERSION"
make -f win32/Makefile.gcc PREFIX=$HOST- -j"$JOBS" libz.a
install -D -m644 libz.a "$PREFIX/lib/libz.a"
install -D -m644 zlib.h "$PREFIX/include/zlib.h"
install -D -m644 zconf.h "$PREFIX/include/zconf.h"

echo "== libvpx"
mkdir -p "$WORK/vpx" && cd "$WORK/vpx"
CROSS=$HOST- "$WORK/libvpx-$VPX_VERSION/configure" --target=x86_64-win64-gcc --prefix="$PREFIX" \
  --disable-examples --disable-tools --disable-docs --disable-unit-tests \
  --enable-vp9-highbitdepth --enable-static --disable-shared
make -j"$JOBS" && make install

echo "== opus"
mkdir -p "$WORK/opus" && cd "$WORK/opus"
# MinGW has no libssp: build without _FORTIFY_SOURCE / stack protector.
"$WORK/opus-$OPUS_VERSION/configure" --host=$HOST --prefix="$PREFIX" CFLAGS="-O2 -D_FORTIFY_SOURCE=0" \
  --enable-static --disable-shared --disable-doc --disable-extra-programs --disable-stack-protector
make -j"$JOBS" && make install

echo "== ffmpeg"
mkdir -p "$WORK/ffmpeg" && cd "$WORK/ffmpeg"
PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig" \
  "$WORK/ffmpeg-$FFMPEG_VERSION/configure" \
  --prefix="$PREFIX" --enable-cross-compile --cross-prefix=$HOST- --arch=x86_64 --target-os=mingw32 \
  --pkg-config=pkg-config --pkg-config-flags=--static \
  --extra-cflags="-I$PREFIX/include" --extra-ldflags="-L$PREFIX/lib -static -static-libgcc" \
  --enable-static --disable-shared \
  --disable-autodetect --enable-w32threads --enable-mediafoundation --enable-zlib \
  --enable-libvpx --enable-libopus \
  --disable-doc --disable-debug --disable-ffplay --disable-network --disable-indevs --enable-indev=lavfi --disable-outdevs
make -j"$JOBS"
$HOST-strip ffmpeg.exe ffprobe.exe

# Guard the licence and the dependency set: no GPL code, only Windows system DLLs.
if grep -q -- "--enable-gpl" config.h 2>/dev/null || grep -q "CONFIG_GPL 1" config_components.h config.h 2>/dev/null; then
  echo "error: GPL ffmpeg build" >&2
  exit 1
fi
grep -E '^#define (CONFIG_GPL|CONFIG_VERSION3|CONFIG_NONFREE) ' config.h
for EXE in ffmpeg ffprobe; do
  echo "$EXE.exe imports:"
  DLLS=$($HOST-objdump -p "$EXE.exe" | sed -n 's/^\s*DLL Name: //p' | sort -u)
  echo "$DLLS" | sed 's/^/  /'
  if echo "$DLLS" | grep -v -i -E '^(kernel32|user32|gdi32|advapi32|shell32|ole32|oleaut32|msvcrt|ws2_32|bcrypt|secur32|mfplat|mfuuid|mf|strmiids|psapi|shlwapi|api-ms-win-.*)\.dll$'; then
    echo "error: unexpected DLL dependency" >&2
    exit 1
  fi
done
cp ffmpeg.exe "$OUT/ffmpeg-$TRIPLE.exe"
cp ffprobe.exe "$OUT/ffprobe-$TRIPLE.exe"
ls -l "$OUT"/*-$TRIPLE.exe
