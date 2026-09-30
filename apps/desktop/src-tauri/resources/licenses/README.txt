Skritch v0.1.0 — bundled software notices

Skritch source code: https://github.com/kaigani/skritch
Skritch is Copyright (c) 2026 Kaigani Turner, distributed under the MIT license.

This release uses FFmpeg / FFprobe 7.1.1 under LGPL-2.1-or-later, libvpx 1.15.0
under its BSD license, and Opus 1.5.2 under its BSD license. These are built as
separate executable sidecars, without GPL components or network support.

Corresponding unmodified source archives, their license texts, and the build
script are distributed with this release:
https://github.com/kaigani/skritch/releases/download/v0.1.0/Skritch_0.1.0_third-party-sources.tar.gz

The sidecar executables can be replaced or rebuilt from source. Replacing signed
bundle contents invalidates the app signature; development builds can use tools
on PATH instead. Skritch's MIT license does not restrict reverse engineering or
modifying these components. Third-party components retain their own licenses.

The source bundle includes FFmpeg's complete license description, libvpx's patent
notice, Opus's copyright notice, and scripts/build-ffmpeg-macos.sh.
DEPENDENCIES.txt contains notices collected from the Rust and JavaScript packages.
