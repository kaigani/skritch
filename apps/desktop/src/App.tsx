import { useEffect } from 'react';
import { ipc, type CaptureResult, type DropSource, type MenuAction } from './ipc';
import { CanvasView } from './canvas/CanvasView';
import { onCaptureResult, openPaths } from './actions/files';
import { arriveImages } from './actions/image';
import { installShortcuts } from './actions/shortcuts';
import { handleMenuAction, pasteObjectsOrImage, syncMenuState, refreshMenuState } from './actions/menu';
import { useDoc, isDirty } from './state/document';
import { usePrefs } from './state/prefs';
import { askConfirm, errorText, ui, useUi } from './state/ui';
import { useVideo } from './state/video';
import { ToolRail } from './ui/ToolRail';
import { TopBar } from './ui/TopBar';
import { BottomBar } from './ui/BottomBar';
import { TextEditor } from './ui/TextEditor';
import { Busy, ContextMenu, DropHover, EmptyState, FirstRunTip, Toasts } from './ui/Overlays';
import { ArrivalDialog } from './ui/dialogs/ArrivalDialog';
import { ConfirmDialog } from './ui/dialogs/ConfirmDialog';
import { PreferencesDialog } from './ui/dialogs/PreferencesDialog';
import { VideoRail } from './video/VideoRail';
import { VideoStage } from './video/VideoStage';
import { Timeline } from './video/Timeline';
import { ExportVideoDialog } from './video/ExportVideoDialog';
import { seqLength } from './model/edl';

/** macOS Screen Recording permission explainer (plan §2.1). */
let screenRecordingExplained = false;
async function explainScreenRecordingPermission() {
  // Repeated capture attempts should not keep replacing the editor with the same modal.
  if (screenRecordingExplained || ui().confirm) {
    ui().toast('Screen Recording is unavailable. If already enabled, quit and reopen Skritch.', {
      kind: 'error',
      action: { label: 'Settings', run: () => void ipc.openScreenRecordingSettings() },
    });
    return;
  }
  screenRecordingExplained = true;
  const v = await askConfirm({
    title: 'Screen Recording unavailable',
    message:
      'macOS has not granted access to this running copy of Skritch. Enable Skritch in System Settings › Privacy & Security › Screen Recording. If it is already enabled, save your work, quit Skritch, and reopen it from Applications. If access is still blocked after an update, remove the old Skritch entry and add the installed app again.',
    buttons: [
      { label: 'Not Now', value: 'cancel', cancel: true },
      { label: 'Open System Settings', value: 'open', primary: true },
    ],
  });
  if (v === 'open') await ipc.openScreenRecordingSettings();
}

export function App() {
  const mode = useUi((s) => s.mode);

  useEffect(() => {
    const offs: Array<Promise<() => void> | (() => void)> = [
      installShortcuts(),
      useDoc.subscribe(syncMenuState),
      useUi.subscribe(syncMenuState),
      useVideo.subscribe(syncMenuState),
      ipc.on('menu://refresh', refreshMenuState),
      ipc.on<CaptureResult>('capture://result', (r) => {
        screenRecordingExplained = false;
        void onCaptureResult(r);
      }),
      ipc.on<{ code: string; message: string }>('capture://error', (e) => {
        if (e.code === 'permission') void explainScreenRecordingPermission();
        else ui().toast(`Capture failed: ${e.message}`, { kind: 'error' });
      }),
      ipc.on<{ remaining: number }>('capture://countdown', (e) =>
        useUi.setState({ timedCountdown: e.remaining > 0 ? e.remaining : null }),
      ),
      ipc.on<{ paths: string[]; source: DropSource }>(
        'files://dropped',
        (e) => void openPaths(e.paths, e.source),
      ),
      ipc.on<{ action: MenuAction }>('menu://action', (e) => {
        void handleMenuAction(e.action).catch((err) => ui().toast(errorText(err), { kind: 'error' }));
      }),
      ipc.onWindowDrop(
        (paths) => void openPaths(paths, 'window'),
        (over) => useUi.setState({ dropHover: over }),
      ),
    ];
    // HTML paste (works in both the webview and the browser build)
    const onPaste = (e: ClipboardEvent) => {
      if (ui().mode === 'video' || (e.target as HTMLElement).closest?.('input,textarea')) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      e.preventDefault();
      if (file)
        void file
          .arrayBuffer()
          .then((b) => arriveImages([{ bytes: new Uint8Array(b), name: 'Clipboard', source: 'clipboard' }]));
      else void pasteObjectsOrImage();
    };
    window.addEventListener('paste', onPaste);
    syncMenuState();
    window.addEventListener('focusin', syncMenuState);
    void usePrefs.getState().load();
    void ipc
      .takeLaunchPaths()
      .then((paths) => (paths.length ? openPaths(paths, 'args') : undefined))
      .catch((e) => ui().toast(errorText(e), { kind: 'error' }));
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('focusin', syncMenuState);
      offs.forEach((o) => void Promise.resolve(o).then((f) => f()));
    };
  }, []);

  useWindowTitle();

  return (
    <div className="app" data-mode={mode}>
      <TopBar />
      {mode === 'video' ? (
        <div className="body">
          <VideoRail />
          <div className="video-body">
            <VideoStage />
            <Timeline />
          </div>
        </div>
      ) : (
        <div className="body">
          <ToolRail />
          <div className="stage">
            <CanvasView />
            <TextEditor />
            {mode === 'empty' && <EmptyState />}
            <FirstRunTip />
          </div>
        </div>
      )}
      <BottomBar />
      <DropHover />
      <Busy />
      <Toasts />
      <ContextMenu />
      <ArrivalDialog />
      <ConfirmDialog />
      <PreferencesDialog />
      <ExportVideoDialog />
    </div>
  );
}

function useWindowTitle() {
  const mode = useUi((s) => s.mode);
  const title = useDoc((s) => s.doc?.meta.title);
  const dirty = useDoc(isDirty);
  const clips = useVideo((s) => s.project?.sequence.length ?? 0);
  const len = useVideo((s) => (s.project ? seqLength(s.project.sequence) : 0));
  useEffect(() => {
    const t =
      mode === 'video'
        ? `Untitled Video — ${clips} clip${clips === 1 ? '' : 's'}`
        : mode === 'image'
          ? `${title ?? 'Untitled'}${dirty ? ' — Edited' : ''}`
          : 'Skritch';
    void ipc.setTitle(t);
  }, [mode, title, dirty, clips, len]);
}
