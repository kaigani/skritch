# Changelog

## 0.2.0 — 2026-10-05

Mac release (universal DMG). Windows downloads remain 0.1.0.

2026-10-06: the DMG was replaced with a notarized and stapled copy of the same app, so macOS no longer
reports "Apple could not verify Skritch.app". The app itself is unchanged.

- Faster Screen Snap: the selection overlay appears in about 0.3–0.5 s instead of about 3 s. Overlay
  windows are created ahead of time and reused, the frozen screen is sent as raw pixels instead of
  being encoded to PNG first, and window listing overlaps the screen grab.
- Top bar: SKRITCH on the left, the capture button centred. Image size moved to the footer next to
  the zoom; the footer also shows "Edited" and, in video mode, the clip summary.
- Drag Me hides the window as soon as the drag starts, so files can't be dropped back on Skritch. A
  drop returns the window behind other apps; a cancelled drag brings it to the front.
- The "Drag this tab…" hint only appears for a real click on the tab, not after a drag.
- "New capture ready": buttons are Cancel, Add to Canvas, Replace, with Replace the default (Enter).
  Replace no longer asks "Save changes?"; closing the window still does.
- Crop has two modes, Crop and Scale. The separate Canvas mode and its anchor grid are gone: crop
  handles and W × H fields already grow or trim the canvas.
- Scale shows the resulting W × H in pixels, a −/+ slider under the canvas and a live preview.
- Crop and Scale actions read ✕ Cancel / ✓ Apply.
- Mac video tools rebuilt with the Lavfi input device, so the startup encoder probe works and
  H.264/HEVC exports use VideoToolbox (the Windows 0.1.0 fix, now on Mac). VideoToolbox may fall
  back to Apple's software encoder for sizes the hardware rejects, e.g. small videos on Intel Macs.
- Optional advanced capture controls in Preferences: adjust a region/window after selection, move it,
  resize using corner handles or exact pixel dimensions, and lock its aspect ratio.
- Switch the pending selection to a five-second timer or the entire current display before confirming.
- Keyboard movement/resizing and Retina-correct dimensions; immediate capture remains the default.

## Windows 0.1.0 download — 2026-10-02

- Windows x64 setup EXE, MSI installer and portable ZIP, with bundled LGPL FFmpeg/FFprobe.
- Media Foundation H.264/HEVC encoding and libvpx/Opus WebM support, checked against the running PC.
- Bundled dependency notices, corresponding source archive and Windows SHA-256 checksums.
- Repeatable `pnpm build:windows` command and an optional CI packaging workflow.
- Fixed encoder probing in release sidecars by enabling the Lavfi input device; H.264 exports no
  longer fall back to MPEG-4 Part 2 when no H.264 encoder is available.
- Windows builds include the optional advanced capture controls described above.

Windows downloads are unsigned. The original Mac download remains the 2026-09-29 build.
Validation: 47 unit tests, 25 Chromium workflow tests and 45 native tests passed with bundled video
tools; MSI extraction, native app launch, image opening, H.264/VP9 encoding and checksums verified.

## 0.1.0 — 2026-09-29

First public Mac release. Universal binary for Apple silicon and Intel; macOS 13.3 or later.

- Region, window, full-display, timed and previous-area captures.
- Compact annotation rail with arrows, text, shapes, pen, highlights, stamps and pixelation.
- Multiple image layers, native Image menu stacking commands, and Undo/Redo.
- Independent image crops; canvas crops trim image-layer bounds and eliminate overhang.
- Native Drag Me exports in PNG, JPG, TIFF, PDF, BMP and GIF.
- Capture filenames based on the timestamp and source window, editable in the footer.
- Split capture button: main button runs the action, arrow chooses it.
- Editable image/video projects, quick video trim/reorder, frame stepping and frame annotation.
- Native menus, multiple document windows, Finder/Dock integration and system printing.
- macOS capture waits for windows to disappear, with hide animation disabled.
- Equal vertical padding around the format/Drag Me control.
- Stable Developer ID signing and clearer Screen Recording recovery guidance.
- Bundled LGPL FFmpeg/FFprobe tools, notices and corresponding source archive.

The app is Developer ID signed but not yet notarized. Migrating from an earlier ad-hoc development
build can require removing the old Screen Recording entry and granting access to the installed app.
Windows source is included; a packaged Windows release is not yet available.
