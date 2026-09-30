# Decisions & deviations from the implementation plan

Dated entries; newest at the bottom of each day.

This is a historical implementation log. The current README supersedes older notes about single
windows, menus, local Mac builds, file associations and ad-hoc signing. Local releases now use
Developer ID signing; only certificate-free CI smoke-test artifacts use ad-hoc signing.

## 2026-09-27 — Rust/Tauri backend (M0–M5 native side)

1. **No `externalBin` in `tauri.conf.json` yet.** The ffmpeg/ffprobe sidecar binaries (plan §2) are not in the
   repo, and the Tauri bundler fails when an `externalBin` file is missing. Lookup order at runtime
   (`video::tool_path`): `<exe dir>/<name>-<target-triple>[.exe]`, then `<exe dir>/<name>[.exe]` (what the bundler
   installs), then `<name>` on `PATH`. Add `"externalBin": ["binaries/ffmpeg", "binaries/ffprobe"]` once CI downloads
   the LGPL builds into `src-tauri/binaries/`.
2. **ffmpeg is run with `std::process::Command`, not `tauri-plugin-shell`.** Same effect (args array, no shell),
   fewer permissions to manage, and the code is unit/e2e-testable without an app. Windows: `CREATE_NO_WINDOW`.
3. **Encoder choice probes by test-encoding**, not only by `ffmpeg -encoders`: GPL/"full" ffmpeg builds list
   `h264_nvenc`/`h264_amf`/`h264_qsv` even without the hardware. Each candidate (in plan order, then
   `libopenh264`, `libx264`, `mpeg4`; HEVC falls back to `libx265`) must encode 3 frames of a 256×256 test source.
   Runs once, in the background at startup. **libx264/libx265 fallbacks** are only present in GPL ffmpeg builds (the
   dev machine's ffmpeg 7.1 "full" build is GPL); the shipped LGPL sidecar will not list them, so the shipped app
   never uses them.
4. **Render filtergraph additions beyond plan §6.6**, all needed for robustness:
   - `setsar=1` after `pad` (concat refuses inputs whose SAR differs);
   - `aformat=sample_rates=48000:channel_layouts=stereo` on real audio (so it matches the `anullsrc` silence);
   - `[i:V]` instead of `[i:v]` (skips cover-art "video" streams);
   - trim points shifted 0.5 ms earlier (`TRIM_EPSILON`): frame-index pts are ffprobe's 6-decimal strings which can
     round *up* past the true pts, which would drop the first frame of a segment and keep one past its end;
   - width/height rounded down to even (yuv420p), audio omitted entirely when no input has audio.
5. **Frame index is normalised by the container `start_time`** (`pts_time − start_time`), matching ffmpeg's default
   input timeline (used by `-ss` and `trim`) and the `<video>` element's `currentTime`. Packets flagged `D`
   (discard, e.g. before an edit-list start) are dropped too.
6. **`video_frame_png` applies rotation explicitly**: `-noautorotate` plus a transpose for the `rotation` argument,
   so the output is deterministic given the argument. Pass the `rotation` from `ClipInfo`.
7. **Bitrates**: bits-per-pixel-per-frame 0.04 / 0.08 / 0.16 (low/medium/high) × codec factor (HEVC 0.6, VP9 0.7);
   1080p30 H.264 = 2.5 / 5 / 10 Mbit/s. Proxies use a fixed 8 Mbit/s.
8. **A same-codec stream-copy fast path is out of scope for v1** (plan §6.6) — future optimisation.
9. **Capture temp files** live in `<temp>/skritch-capture/` (not `<temp>/skritch/`, which `temp_write` purges after
   60 s) and are purged after 11 minutes, so "Recover Last Capture" (10 min) always finds its file.
10. **Instant hide for capture**: Windows 11 fades windows out on hide, which put a half-transparent Skritch into
    the shot. Main, Drop Zone and overlay windows get `DWMWA_TRANSITIONS_FORCEDISABLED`; the post-hide settle
    delay is 60 ms.
11. **Overlay shots are plain PNG files loaded through the asset protocol** (`convertFileSrc(shotPath)`) instead of
    the custom `shot://` protocol sketched in plan §4.5 — `$TEMP/**` is already in the asset scope.
12. **Closing the main window hides it** (the app keeps running in the tray); `RunEvent::ExitRequested` without an
    explicit exit code is prevented. Only tray → Quit exits.
13. **Crate type is `rlib` only** (the template's `staticlib`/`cdylib` exist for mobile targets, which Skritch does
    not have, and triple the link time).
14. **`macos-private-api`** is enabled (`app.macOSPrivateApi: true`) because transparent overlay windows need it on
    macOS. This rules out the Mac App Store, which the plan does not target (Developer ID distribution).
15. **No `bundle.fileAssociations` yet**: Tauri's NSIS installer would register Skritch as the *default* handler for
    .png/.jpg/.mp4, which is hostile. Argv paths are handled (`take_launch_paths`, single-instance forwarding); the
    "Open with" / "Send to" registration is an M6 NSIS custom step (plan §12).

## 2026-09-27 — Frontend (image mode, video mode, UI)

16. **Single window in v1.** The `captureArrival: 'newWindow'` preference currently behaves like Replace (after the
    usual "Save changes?" flow). Capabilities already allow `doc-*` windows for the multi-window follow-up.
17. **A Select tool (V) is added to the rail** above Arrow. The plan's rail starts at Arrow, but Add to Canvas (§5.1)
    activates "the Select tool", so it needs a visible home. Drawing tools still grab existing annotations when
    pressed on them, as Skitch does.
18. **Native title bar kept on Windows**, with the Skitch top bar (Snap ▾ / title / Share ▾) directly below it. No
    native menu bar: every command is reachable from Snap ▾, Share ▾, the tray, or a shortcut.
19. **Text size and stamp radius are screen-relative at creation** (the size steps are divided by the zoom when
    zoomed out), so a new annotation looks the same size regardless of capture DPI. Stroke widths stay in document
    pixels, per §1.2.
20. **Composite cache is layer-level, not dirty-rect.** The content canvas is re-rendered only when non-floating
    objects change. While dragging, moved objects are drawn on the interaction layer and the content layer is not
    redrawn (§4.3 "one blit per frame"). Dirty-rect/tiled caching can come later if profiling at 8K asks for it.
21. **Pixelate samples the layer composite beneath it at render time** (device-pixel readback from the target
    canvas), so it mosaics annotations below it as well as images, and is identical on screen and in export.
22. **Mocked IPC** (`src/ipc/mock.ts`) lets the full UI run in a normal browser (Vite dev server) for Playwright.
    Paths are virtual `mem://` blobs; captures produce a synthetic desktop image; video probing assumes 30 fps.
23. **Timeline drags use pointer events, not HTML5 drag-and-drop**, because `dragDropEnabled` (needed for OS file
    drops) disables HTML5 DnD inside WebView2.

## 2026-09-27 — macOS build

24. **Built by GitHub Actions (`.github/workflows/macos.yml`), not locally.** Development happens on Windows; a
    macOS bundle can only be linked, signed and packaged on macOS. Locally the Mac code is type-checked with
    `DOCS_RS=1 cargo check --target aarch64-apple-darwin` (the env var only skips objc2's Objective-C exception
    helper, which needs Apple's clang; nothing is linked).
25. **Universal binary** (`--target universal-apple-darwin`) built on an Apple-silicon runner; the x86_64 half,
    including FFmpeg, is cross-compiled. One DMG covers Apple silicon and Intel.
26. **LGPL FFmpeg sidecars are built from source** (`scripts/build-ffmpeg-macos.sh`: FFmpeg 7.1.1 + libvpx +
    libopus, VideoToolbox/AudioToolbox, static, no GPL) and cached in CI. The script fails if the build is GPL or
    links non-system dylibs. `scripts/dev-ffmpeg-sidecars.sh` stages Homebrew's ffmpeg for local dev builds only.
27. **Ad-hoc signed (`signingIdentity: "-"`), not notarized.** Distribution needs an Apple Developer ID certificate
    and notarization credentials (plan M6). Until then Gatekeeper blocks the first launch of a downloaded DMG:
    right-click → Open, or `xattr -dr com.apple.quarantine /Applications/Skritch.app`.
28. **Minimum macOS 13.3** (Safari 16.4 WebKit: OffscreenCanvas, `roundRect`, `requestVideoFrameCallback`). A
    DOM-canvas fallback (`src/util/canvas.ts`) exists, so older systems may work but are untested.
29. **Overlay title bar on macOS** (`tauri.macos.conf.json`): the traffic lights sit inside the Skitch top bar,
    like Skitch's unified toolbar. Windows keeps its native title bar (#18).
30. **Menu-bar drop target**: a transparent `NSView` over the status item button, registered for file URLs,
    returning nil from `hitTest:` so clicks still reach tray-icon's view. Finder "Open With" and Dock drops arrive
    as Apple Events (`RunEvent::Opened`) and are queued until the frontend is ready (`launch::offer`).
31. **File associations on macOS use rank `Alternate`** for images/videos (listed under "Open With", never the
    default) and `Owner` for `.skritch`/`.skritchv`.
32. **Capture overlays use `NSScreenSaverWindowLevel`** and join all Spaces, so they cover the menu bar, the Dock
    and full-screen apps (Tauri's always-on-top level sits below the menu bar).
33. **Frame-accuracy on WebKit is tested at the pixel level** (`tests/fixtures/frames.*`, grey level = frame
    index). Playwright's *Windows* WebKit ignores MP4 edit lists, so B-frame H.264 shows frame N−2 there
    (marked as an expected failure). macOS AVFoundation honours edit lists, and the macOS workflow runs the same
    test on Mac WebKit, where it must pass.
