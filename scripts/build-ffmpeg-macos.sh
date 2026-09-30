#!/usr/bin/env bash
# Builds the LGPL FFmpeg/FFprobe sidecars for macOS (plan §2 "FFmpeg licensing"): universal
# (arm64 + x86_64) executables with VideoToolbox/AudioToolbox, libvpx (BSD, VP9/WebM) and libopus
# (BSD), and no GPL components. Everything is linked statically except system frameworks and zlib.
#
# Usage: scripts/build-ffmpeg-macos.sh [output-dir]   (default: apps/desktop/src-tauri/binaries)
# Needs: Xcode command line tools, nasm (x86_64 assembly), pkg-config. ~20 min on an M1.
set -euo pipefail

FFMPEG_VERSION=7.1.1
VPX_VERSION=1.15.0
OPUS_VERSION=1.5.2
MIN_MACOS=11.0

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$ROOT/apps/desktop/src-tauri/binaries}
WORK=$(mktemp -d)
JOBS=${SKRITCH_BUILD_JOBS:-$(sysctl -n hw.ncpu)}
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

fetch() { curl -fsSL --retry 3 "$1" | tar -xz -C "$WORK"; }
fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.gz"
fetch "https://github.com/webmproject/libvpx/archive/refs/tags/v$VPX_VERSION.tar.gz"
fetch "https://downloads.xiph.org/releases/opus/opus-$OPUS_VERSION.tar.gz"

for ARCH in arm64 x86_64; do
  echo "::group::build $ARCH"
  PREFIX=$WORK/prefix-$ARCH
  FLAGS="-arch $ARCH -mmacosx-version-min=$MIN_MACOS"
  if [ "$ARCH" = arm64 ]; then VPX_TARGET=arm64-darwin20-gcc; HOST=aarch64-apple-darwin; FF_ARCH=aarch64
  else VPX_TARGET=x86_64-darwin20-gcc; HOST=x86_64-apple-darwin; FF_ARCH=x86_64; fi

  mkdir -p "$WORK/vpx-$ARCH" && cd "$WORK/vpx-$ARCH"
  "$WORK/libvpx-$VPX_VERSION/configure" --target=$VPX_TARGET --prefix="$PREFIX" \
    --extra-cflags="$FLAGS" --disable-examples --disable-tools --disable-docs --disable-unit-tests \
    --enable-vp9-highbitdepth --enable-pic --enable-static --disable-shared
  make -j"$JOBS" && make install

  mkdir -p "$WORK/opus-$ARCH" && cd "$WORK/opus-$ARCH"
  "$WORK/opus-$OPUS_VERSION/configure" --host=$HOST --prefix="$PREFIX" CC="clang" CFLAGS="$FLAGS -O2" LDFLAGS="$FLAGS" \
    --enable-static --disable-shared --disable-doc --disable-extra-programs
  make -j"$JOBS" && make install

  mkdir -p "$WORK/ffmpeg-$ARCH" && cd "$WORK/ffmpeg-$ARCH"
  PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" "$WORK/ffmpeg-$FFMPEG_VERSION/configure" \
    --prefix="$PREFIX" --enable-cross-compile --target-os=darwin --arch=$FF_ARCH --cc="clang -arch $ARCH" \
    --extra-cflags="-mmacosx-version-min=$MIN_MACOS -I$PREFIX/include" \
    --extra-ldflags="-arch $ARCH -mmacosx-version-min=$MIN_MACOS -L$PREFIX/lib" \
    --pkg-config-flags=--static --enable-static --disable-shared \
    --disable-autodetect --enable-videotoolbox --enable-audiotoolbox --enable-zlib \
    --enable-libvpx --enable-libopus \
    --disable-doc --disable-debug --disable-ffplay --disable-network --disable-indevs --disable-outdevs
  make -j"$JOBS"
  mkdir -p "$WORK/bin-$ARCH" && cp ffmpeg ffprobe "$WORK/bin-$ARCH/"
  echo "::endgroup::"
done

for TOOL in ffmpeg ffprobe; do
  cp -f "$WORK/bin-arm64/$TOOL" "$OUT/$TOOL-aarch64-apple-darwin"
  cp -f "$WORK/bin-x86_64/$TOOL" "$OUT/$TOOL-x86_64-apple-darwin"
  lipo -create -output "$OUT/$TOOL-universal-apple-darwin" "$WORK/bin-arm64/$TOOL" "$WORK/bin-x86_64/$TOOL"
done

# Guard the licence: the shipped build must not contain GPL code.
if "$OUT/ffmpeg-universal-apple-darwin" -hide_banner -buildconf | grep -q -- --enable-gpl; then
  echo "error: GPL ffmpeg build" >&2
  exit 1
fi
"$OUT/ffmpeg-universal-apple-darwin" -hide_banner -L | sed -n 1,3p
"$OUT/ffmpeg-universal-apple-darwin" -hide_banner -encoders | grep -E "videotoolbox|libvpx|libopus"
lipo -info "$OUT/ffmpeg-universal-apple-darwin" "$OUT/ffprobe-universal-apple-darwin"
if otool -L "$OUT/ffmpeg-aarch64-apple-darwin" | tail -n +2 | grep -v -E "/System/Library/|/usr/lib/"; then
  echo "error: non-system dylib dependency" >&2
  exit 1
fi
