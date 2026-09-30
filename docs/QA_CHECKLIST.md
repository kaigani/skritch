# Manual QA checklist

Tick per platform (W = Windows 11, M = macOS 14/15). Status on 2026-09-27: first pass on Windows 11 (single
1920×1080 display, debug build). macOS automated verification was added on 2026-09-28; unchecked items
below still require manual OS-level interaction.

## Capture
- [x] W — Ctrl+Shift+7 fullscreen snap opens a document at display size, Skritch window not in the shot
- [x] W — Ctrl+Shift+5 overlay covers the display, dimmed frozen shot, Esc cancels and restores the window
- [ ] W/M — region drag → W×H readout → image in window ≤ 200 ms
- [ ] W/M — ⇧ during the drag arms the 5 s timer; menus opened during the countdown are in the shot
- [ ] W/M — window snap highlights the window under the cursor
- [ ] Multi-monitor, mixed DPI (overlay per display, correct crop)
- [ ] M — Screen Recording permission explainer on first capture

## Image mode
- [x] Arrow/Text/Shapes/Pen/Highlighter/Stamp/Pixelate render with the white halo (browser and WebView2)
- [x] Swatch change re-colours the selected object
- [x] Add to Canvas → layer selected, Select tool active; drag past the edge grows the canvas; one undo restores it
- [x] Crop handle dragged outward grows with white fill; Canvas (numeric + anchor) and Scale sub-modes
- [x] Copy image → paste back (arboard both directions) → arrival dialog
- [ ] Drag Me into Explorer / Finder / Slack / Mail / browser / Word (6 targets per platform)
- [ ] Save / Save As / Export TIFF, PDF, BMP, GIF via the native dialog; re-open a Skritch PNG and it is editable
- [ ] 6000×4000 image pans and drags at 60 fps
- [ ] Dark/light system appearance

## Video mode
- [x] W — open 2 MP4s from argv (second instance) → video mode, filename order, thumbnails
- [x] W — stepping ±1/±10 is frame-exact (burned-in frame numbers match); I/O markers, delete, undo
- [x] W — Edit Frame as Image (ffmpeg frame from the original) → annotate → Back to Video
- [ ] Export dialog → render MP4/MOV/WebM with progress, cancel deletes the partial file
- [ ] HEVC/ProRes/MKV import builds a proxy with a progress bar
- [ ] 4K60 stepping latency ≤ 50 ms; 2-hour clip import time
- [ ] Drop onto the Windows Drop Zone / macOS menu-bar icon appends clips

## macOS specifics (M)
- [ ] First snap shows the Screen Recording prompt; after denial, the explainer's "Open System Settings" works
- [ ] Overlay covers the menu bar and Dock, and appears over a full-screen app
- [ ] ⌃⇧5–8 work while another app is frontmost; Skritch comes to the front with the capture
- [ ] Drop an image and a video onto the menu-bar icon; drop onto the Dock icon; Finder "Open With"
- [ ] Copy as File → paste in Finder
- [ ] Traffic lights sit inside the top bar; the window drags by the top bar
- [ ] Apple silicon and Intel (universal build); `h264_videotoolbox` export
- [ ] Stepping a B-frame H.264 clip shows the exact burned-in frame numbers

## Platform
- [x] W — tray icon present; closing the window keeps the app in the tray
- [ ] Installers (MSI/NSIS, notarized DMG) ≤ 40 MB without FFmpeg
- [ ] Undo depth 200

## macOS automated verification — 2026-09-28

- [x] Universal `.app` and `.dmg`; main executable, FFmpeg, and FFprobe contain arm64 and x86_64
- [x] DMG integrity verification and native app launch with a visible 1100×761 window on Intel macOS
- [x] Deep/strict code-signature verification; bundled tools depend only on macOS system libraries
- [x] Frontend production build, TypeScript, ESLint, Rust Clippy, and formatting checks
- [x] 33 Vitest unit tests and 41 native Rust tests
- [x] 13 Chromium and 13 WebKit e2e tests on macOS, including selected-format drag payloads
- [x] PNG/JPG drag payload filenames, MIME types, and encoded file signatures
- [x] Unsupported browser formats report that desktop is required instead of exporting PNG
- [x] Native TIFF/PDF/BMP/GIF/JPEG conversion and isolation of repeated temporary exports
- [x] Video frame identification on macOS after explicitly tagging the fixture's color transfer function
- [x] Browser visual review at 1100×760 and 640×480 (see `docs/review/mac-refined-*.png`)

Native Finder drop, screen capture permissions, and menu-bar/Dock drops remain manual checks.
The automation host does not grant Accessibility or Screen Recording access for those checks.

## Capture filenames — 2026-09-29

- [x] Rebuilt universal `.app` and DMG; deep/strict signature and DMG integrity checks pass
- [x] TypeScript and ESLint; 36 Vitest tests and 42 native Rust tests
- [x] 14 Chromium and 14 WebKit e2e tests, including capture naming, edit/cancel/blur, and save/drag names
- [x] Local capture timestamp stays fixed; window selection and region center resolve the source title
- [x] Rename after saving prompts for a new file rather than overwriting the previous name
- [x] WebKit visual review at 1100×760 and 640×480, including inline editing (`docs/review/mac-*-filename.png`)
- [ ] Native capture from another app supplies its window title; rename and drag into Finder

## App icon and pink — 2026-09-29

- [x] Supplied image preserved in `icons/source.png`; macOS/Windows icon formats regenerated
- [x] Primary pink sampled as `#FA1262`; UI accents, annotation default, guides, and drag preview updated
- [x] TypeScript, ESLint, 36 unit tests, and four Chromium/WebKit export and filename checks
- [x] WebKit visual review of welcome and capture states (`docs/review/mac-brand-*.png`)
- [x] Universal Mac build, bundled icon matches the new ICNS, signature and DMG integrity verified

## Split capture button — 2026-09-29

- [x] Main button runs the selected action; arrow opens the action picker without capturing
- [x] Checked menu selection updates the label and persists across reloads
- [x] Enter/Space activation, arrow-key navigation, Escape focus return, and click-to-close
- [x] Annotation shortcuts remain active after clicking the main button
- [x] TypeScript, ESLint, and all 30 Chromium/WebKit e2e tests pass
- [x] Visual review at 1100×760 and 640×480 (`docs/review/mac-split-capture-*.png`)
- [x] Universal Mac app and DMG rebuilt; app signature and DMG integrity verified

## Native menus and image-layer crop — 2026-09-29

- [x] Skitch-style native menu structure and command routing to the active document window
- [x] Layer crop preserves original assets, canvas and sibling layers; Undo/Redo and PNG metadata round-trip
- [x] Image selection, backdrop-to-canvas switching, crop clamping, and exported pixel checks
- [x] Menu dispatch for copy/paste, Undo/Redo, image rotation, annotation clearing, and preferences
- [x] 39 unit tests, 34 browser tests, 42 Rust tests, TypeScript and ESLint
- [x] Compact crop controls remain visible; visual review in `docs/review/mac-layer-crop*.png`
- [x] Universal Intel/Apple silicon app and DMG rebuilt; deep/strict signature and DMG integrity verified
- [x] Native Intel launch completes without errors and displays the 1100×761 document window
- [ ] Native Page Setup / Print, previous-area/menu capture, and switching among real document windows

## Canvas crop bounds — 2026-09-29

- [x] Canvas crop trims image geometry and source rectangles together, eliminating selection overhang
- [x] Prior image crops/resizes, negative canvas origins, hidden/locked images and fully excluded layers
- [x] Applying existing canvas bounds repairs older overhang; growing does not reveal trimmed regions
- [x] Undo/Redo restores canvas and layers together; editable document round-trip preserves crop
- [x] 43 unit tests, Chromium/WebKit crop regression, TypeScript and ESLint
- [x] Universal Intel/Apple silicon Mac build; app signature and DMG integrity verified

## Image menu stacking — 2026-09-29

- [x] Divider plus Move to Top, Move Forward, Move Backward and Move to Back in Image menu
- [x] Existing bracket shortcuts; menu availability follows selection and stacking boundaries
- [x] Chromium/WebKit menu regression checks, including all four actions, multiple selection, Undo/Redo
- [x] TypeScript and ESLint
- [x] Universal Mac app and DMG rebuilt; signature and disk-image integrity verified
- [ ] Native menu interaction after restarting the existing app session

## Capture ghost and export control spacing — 2026-09-29

- [x] macOS capture hides windows synchronously on the main thread with AppKit fade disabled
- [x] Capture waits until those window IDs stay absent from WindowServer for 120 ms; timeout/query errors abort and restore the editor
- [x] 45 native tests, including hide settling, timeout and query failure
- [x] Four Chromium/WebKit capture-button and export checks; TypeScript and ESLint
- [x] Export control has equal 4 px top/bottom inner spacing at 1100×760 and 640×480
- [x] WebKit visual review in `docs/review/mac-export-centered-*.png`
- [x] Universal Intel/Apple silicon app and DMG rebuilt; signature and disk-image integrity verified
- [ ] Real capture confirms no Skritch ghost on a Mac with Screen Recording access

## Screen Recording identity — 2026-09-29

- [x] Replaced the local ad-hoc signing configuration with the installed Developer ID identity
- [x] CI explicitly keeps its certificate-free smoke-test signing override
- [x] Permission guidance covers an already-enabled/stale entry and restarting the installed app
- [x] Repeated failures use a Settings toast instead of another blocking modal; successful capture resets guidance
- [x] Four Chromium/WebKit permission and capture-button checks; TypeScript and ESLint
- [x] Universal app and DMG signed by Developer ID Application: Kaigani Turner (3RYX74KM8T); both signatures and DMG integrity verified
- [x] App designated requirement uses bundle ID and Apple developer team, with no build-specific cdhash
- [ ] One-time permission migration from the old ad-hoc app, then capture after an update with the same Developer ID
