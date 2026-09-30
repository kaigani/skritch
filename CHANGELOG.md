# Changelog

## Unreleased

- Optional advanced capture controls in Preferences: adjust a region/window after selection, move it,
  resize using corner handles or exact pixel dimensions, and lock its aspect ratio.
- Switch the pending selection to a five-second timer or the entire current display before confirming.
- Keyboard movement/resizing and Retina-correct dimensions; immediate capture remains the default.

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
