# Skritch IPC contract (Rust ↔ TypeScript)

Concrete version of plan §7. The TypeScript side lives in `apps/desktop/src/ipc/` (the only place `invoke()` is
called). The Rust side lives in `apps/desktop/src-tauri/src/`. Errors are `Result<T, AppError>` where `AppError`
serialises as `{ "code": string, "message": string }`.

Argument names: JS passes camelCase keys; Tauri maps them to snake_case Rust params automatically.

**Binary payloads** never go through JSON arrays:
- *Rust → JS bytes*: return `tauri::ipc::Response::new(Vec<u8>)` (arrives as `ArrayBuffer`).
- *JS → Rust bytes*: JS calls `invoke(cmd, uint8Array, { headers: { 'x-…': … } })`; Rust takes
  `request: tauri::ipc::Request<'_>` and reads `InvokeBody::Raw(bytes)` plus headers (header values are
  `encodeURIComponent`-encoded; Rust must percent-decode them).

## Commands

| Command | Input | Output | Notes |
|---|---|---|---|
| `capture_start` | `{ kind: 'crosshair'\|'timed'\|'fullscreen'\|'window'\|'previous' }` | `()` | Result delivered by event `capture://result` (hotkeys/tray use the same path). |
| `capture_overlay_info` | `{ display: u32 }` | `OverlayInfo` | Called by the overlay page for display N when it hears `capture://overlay-arm` (and once on load, in case it missed it). |
| `capture_overlay_pixels` | `{ display: u32 }` | raw bytes | `[width u32 LE][height u32 LE]` + RGBA8 rows of the frozen shot (no image encoding). |
| `capture_overlay_ready` | `{ display: u32, session: u64 }` | `()` | The overlay has drawn the shot; Rust then shows the (hidden, pre-positioned) window. |
| `capture_overlay_finish` | `{ display: u32, rect: Rect \| null, timed: bool }` | `()` | `rect` in **physical px of that display's shot**; `null` = cancel (closes all overlays, emits `capture://cancelled`). `timed` = true → close overlays, 5 s countdown (tray tooltip/title `Skritch — 5…1`, event `capture://countdown {remaining}`), then RE-capture that display and crop to rect. |
| `capture_last` | – | `CaptureResult \| null` | Last capture if < 10 min old and still on disk ("Recover Last Capture"; the tray item emits `menu://action {action:'recover'}`, the frontend then calls this). |
| `capture_permission_status` | – | `'granted'\|'denied'\|'unknown'` | macOS TCC; Windows returns `'granted'`. |
| `menu_set_enabled` | `{ enabled: Record<string, boolean> }` | `()` | Updates native items only for the active document window. |
| `print_document` | – | `()` | System print dialog for the current webview; print CSS isolates the flattened image. |
| `page_setup` | – | `()` | macOS native Page Setup; print options on other platforms. |
| `clipboard_read_text` | – | `string \| null` | Text and serialized editable object selections. |
| `clipboard_write_text` | `{ text }` | `()` | Native text clipboard. |
| `clipboard_read_image` | – | raw PNG bytes (empty = none) | arboard → encode PNG |
| `clipboard_write_image` | raw PNG bytes | `()` | decode → arboard |
| `clipboard_write_files` | `{ paths: string[] }` | `()` | CF_HDROP on Windows, NSPasteboard file URLs on mac; may return `unsupported` error. |
| `file_read` | `{ path }` | raw bytes | |
| `file_write` | raw bytes, header `x-path` | `()` | creates parent dirs |
| `temp_write` | raw bytes, header `x-name` | `string` (absolute path) | writes each export into a unique directory under `<temp>/skritch/`, preserving its filename; used for Drag Me + Copy as file; exports older than 24 hours are cleaned lazily |
| `image_convert` | raw PNG bytes, headers `x-format` (`jpg`\|`tiff`\|`bmp`\|`gif`\|`pdf`), `x-quality` (0–1, optional, default 0.9) | raw bytes | `image` crate. jpg/bmp/gif/pdf are composited over white; tiff keeps alpha. PDF = hand-written single page embedding a JPEG (DCTDecode), page size = px × 0.75 pt (96 dpi). Unknown format → `unsupported`. |
| `default_save_dir` | – | `string` | `~/Pictures/Skritch` / `%USERPROFILE%\Pictures\Skritch` (created) |
| `allow_asset_path` | `{ path }` | `()` | adds the file to the asset-protocol scope (for `<video src=convertFileSrc(path)>`) |
| `video_probe` | `{ path }` | `ClipInfo` | two ffprobe calls from plan §6.3; frame index cached in `$APPCACHE/frames/`. Also adds `path` to the asset scope. Error code `no_video` for files without a video stream. |
| `video_make_proxy` | `{ path, id }` | `{ proxyPath }` | progress events `video://proxy` `{ id, progress }` (0–1). Cached in `$APPCACHE/proxies/` (instant on re-import); added to the asset scope. Proxies are autorotated → their rotation is always 0. |
| `video_thumbnail` | `{ path, ptsTime, height }` | raw PNG | |
| `video_frame_png` | `{ path, ptsTime, rotation }` | raw PNG | `ffmpeg -noautorotate -ss <pts−1ms> -i <path> [-vf transpose…] -frames:v 1 -f image2pipe -c:v png -`. Pass the ORIGINAL path and the clip's `rotation`; the rotation is applied explicitly. |
| `video_encoders` | – | `{ h264?: string, hevc?: string, vp9?: string }` | first *working* encoder per platform list (plan §2 / §6.6; each candidate must succeed a tiny test encode), probed once at startup and cached. Absent key = no encoder → `video_render` for that format fails with `unsupported`. |
| `video_render` | `{ job: RenderJob }` | `string` jobId | events `video://render` `{ jobId, progress (0–1), frame, fps, etaSec (number \| null) }`, then exactly one of `video://render-done` `{ jobId, path }` or `video://render-error` `{ jobId, message }` (message `"cancelled"` after `video_cancel`; the partial file is deleted on error/cancel). Invalid jobs are rejected synchronously with code `invalid`. |
| `video_cancel` | `{ jobId }` | `()` | kills ffmpeg, deletes partial output; unknown/finished ids are ignored |
| `tray_set_dropzone_visible` | `{ visible }` | `()` | Windows Drop Zone window (`dropzone.html`, 120×120, always on top, frameless) |
| `show_main_window` | – | `()` | show + un-minimise + focus main |
| `drag_out` | `{ path, icon }` | `()` | starts a native file drag (Drag Me) from the calling window and hides that window while it runs; a drop returns it behind other windows, a cancel brings it back to the front. Resolves once the drag has started (macOS) / finished (Windows). |
| `take_launch_paths` | – | `string[]` | File paths the app was *first* launched with (file association / "Open with"); returns them once, then `[]`. Call once when the main window is ready. Later launches are forwarded as `files://dropped {source:'args'}`. |

## Types

```ts
type Rect = { x: number; y: number; w: number; h: number };
type OverlayInfo = {
  session: number;             // id of this capture (overlay pages are reused between captures)
  width: number; height: number;   // physical px
  scale: number;               // display scale factor
  windows: { x: number; y: number; w: number; h: number; title: string }[];  // window mode only (else []): topmost first, physical px relative to this display, clipped to it; excludes minimised + Skritch windows
  mode: 'crosshair' | 'timed' | 'window';
};
type CaptureResult = {
  pngPath: string;
  width: number;
  height: number;
  scale: number;
  windowTitle: string | null;
  capturedAt: number; // Unix milliseconds at capture time
};
type ClipInfo = {
  path: string; displayName: string; container: string;
  fps: number; width: number; height: number; durationSec: number;
  codec: string; hasAudio: boolean; rotation: 0 | 90 | 180 | 270;
  framesB64: string;           // Float64Array of pts_time, little-endian, base64
};
type RenderJob = {
  outPath: string;
  format: 'mp4-h264' | 'mp4-hevc' | 'mov' | 'webm';
  quality: 'low' | 'medium' | 'high';
  width: number; height: number; fps: number;
  audio: boolean;
  inputs: { path: string; hasAudio: boolean }[];
  segments: { input: number; start: number; end: number }[];   // seconds in the ORIGINAL file
};
```

## Events (Rust → JS)

| Event | Payload |
|---|---|
| `capture://result` | `CaptureResult` |
| `capture://cancelled` | `{}` |
| `capture://error` | `{ code, message }` |
| `capture://countdown` | `{ remaining }` |
| `files://dropped` | `{ paths: string[], source: 'window'\|'tray'\|'dropzone'\|'args' }` |
| `menu://action` | `{ action: string }` — IDs in `src-tauri/src/menu.rs`, dispatched by `src/actions/menu.ts`; targeted to the active document. Tray actions target main. |
| `menu://refresh` | `null` — focused document refreshes native menu availability. |
| `dropzone://visible` | `{ visible: boolean }` — Drop Zone shown/hidden (tray check item, command, or Alt+F4 on it); persist it as a pref if wanted |
| `video://proxy`, `video://render`, `video://render-done`, `video://render-error` | see above |

Window drops onto the main window are read directly in JS via `getCurrentWebview().onDragDropEvent`.

## Delivery notes (Rust side, 2026-09-27)

- **Event targets.** Native menu commands, capture results, and capture errors target the active document
  window. JavaScript uses window-scoped listeners so another document does not receive the command.
  Launch/file-association events and tray document actions still target `main`; progress/countdown events
  are broadcast. The Window menu includes native window management; document Close hides the window
  to preserve its state.
- **Capture lifecycle.** Every `capture_start` (command, hotkey Ctrl+Shift+5/6/7/8, tray) ends with exactly one of
  `capture://result`, `capture://cancelled`, `capture://error`. A second start while one is running fails with code
  `busy`. Skritch windows are hidden before grabbing; after a result or error the main window is shown and focused,
  after a cancel the previously visible windows are restored.
- **Overlay windows** are labelled `overlay-N`, url `overlay.html?display=N`, transparent, undecorated, always on top,
  exactly covering display N (all displays get one; overlay 0 is focused). They are created hidden shortly after app
  start and **reused**: per capture Rust positions them, emits `capture://overlay-arm` (payload: session id) to
  `overlay-N`, the page loads `capture_overlay_info` + `capture_overlay_pixels`, draws, calls `capture_overlay_ready`
  and Rust shows the window. When the capture ends the window is hidden and receives `capture://overlay-reset`
  (drop the shot, render nothing). A watchdog shows an armed overlay after 2.5 s even without `ready`.
  Set `SKRITCH_PERF=1` to log a capture-latency timeline to stderr. `rect` may be fractional / have negative w/h; Rust normalises, rounds and clamps it. A zero-area rect
  yields `capture://error` (code `invalid`) — send `null` for a plain click/Esc instead. Alt+F4 on an overlay = cancel.
  Only the first `capture_overlay_finish` counts; later calls get error `no_session`.
- **Capture result PNGs** are written to `$TEMP/skritch-capture/` and kept ≥ 10 min.
- **`ClipInfo`**: `width`/`height` are *display* dimensions (rotation applied, like `videoWidth/Height`). `rotation`
  is clockwise degrees. `frames` are pts minus the container start time (≈ 0 for the first frame), sorted, deduped,
  i.e. directly usable as `<video>.currentTime` and as `RenderJob.segments[].start/end`. `container` is the lower-cased
  file extension (fallback: first ffprobe format name). `fps` = `avg_frame_rate` (fallback `r_frame_rate`, then
  measured from the index).
- **`RenderJob`**: odd `width`/`height` are rounded down to even; audio is included only if `audio` is true *and* at
  least one input has audio (inputs without audio get silence). Graphs that would make the command line longer than
  30 000 chars go through `-filter_complex_script` automatically.
- **Main window close = hide** (app stays in the tray; tray Quit exits). If you use `onCloseRequested` for a
  "save changes?" prompt, call `getCurrentWindow().hide()` instead of letting it close/destroy the window.
- **Drop Zone**: label `dropzone`, `dropzone.html`, 120×120 logical px, transparent, undecorated, always on top,
  skip taskbar, drag-drop enabled, initially at the bottom-right of the primary work area. Use
  `data-tauri-drag-region` to let the user move it (`core:window:allow-start-dragging` is granted). The tray item is
  Windows-only; the command works everywhere.
- **Capabilities** (`capabilities/default.json`) apply to windows `main`, `doc-*` (for future "new window" documents),
  `overlay-*` and `dropzone`: `core:default` + common window setters, `core:webview:allow-create-webview-window`,
  `dialog:default`, `store:default`, `drag:default`. App commands above need no capability entries.
