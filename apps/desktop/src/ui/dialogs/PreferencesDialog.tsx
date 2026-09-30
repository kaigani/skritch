import { useEffect, useState } from 'react';
import { ipc } from '../../ipc';
import { IMAGE_FORMATS } from '../../export/formats';
import { usePrefs, type CaptureArrival, type NewAreaFill } from '../../state/prefs';
import { useUi } from '../../state/ui';
import { kb } from '../keys';

export function PreferencesDialog() {
  const open = useUi((s) => s.prefsOpen);
  const p = usePrefs();
  const [dropZone, setDropZone] = useState(false);
  const close = () => useUi.setState({ prefsOpen: false });

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open]);

  if (!open) return null;
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="prefs-title">
      <div className="sheet wide">
        <h2 id="prefs-title">Preferences</h2>
        <div className="form">
          <label htmlFor="pref-arrival">When a new capture arrives</label>
          <select
            id="pref-arrival"
            value={p.captureArrival}
            onChange={(e) => p.update({ captureArrival: e.target.value as CaptureArrival })}
          >
            <option value="ask">Ask every time</option>
            <option value="add">Add to Canvas</option>
            <option value="replace">Replace</option>
            <option value="newWindow">Open a new document</option>
          </select>

          <label htmlFor="pref-fill">New canvas area</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              id="pref-fill"
              value={p.newAreaFill}
              onChange={(e) => p.update({ newAreaFill: e.target.value as NewAreaFill })}
            >
              <option value="white">White</option>
              <option value="transparent">Transparent</option>
              <option value="custom">Custom colour</option>
            </select>
            {p.newAreaFill === 'custom' && (
              <input
                type="color"
                value={p.newAreaColor}
                onChange={(e) => p.update({ newAreaColor: e.target.value })}
              />
            )}
          </div>

          <label htmlFor="pref-format">Default format</label>
          <select
            id="pref-format"
            value={p.defaultFormat}
            onChange={(e) => p.update({ defaultFormat: e.target.value as never })}
          >
            {IMAGE_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>

          <label htmlFor="pref-dir">Default save folder</label>
          <input
            id="pref-dir"
            type="text"
            value={p.defaultSaveDir}
            onChange={(e) => p.update({ defaultSaveDir: e.target.value })}
          />

          <label>Video preview</label>
          <label style={{ textAlign: 'left' }}>
            <input
              type="checkbox"
              checked={p.videoAudio}
              onChange={(e) => p.update({ videoAudio: e.target.checked })}
            />{' '}
            Play audio
          </label>

          {ipc.platform === 'windows' && (
            <>
              <label>Drop Zone</label>
              <label style={{ textAlign: 'left' }}>
                <input
                  type="checkbox"
                  checked={dropZone}
                  onChange={(e) => {
                    setDropZone(e.target.checked);
                    void ipc.setDropZoneVisible(e.target.checked);
                  }}
                />{' '}
                Show the always-on-top Drop Zone
              </label>
            </>
          )}

          <label>Global shortcuts</label>
          <div style={{ color: '#555', lineHeight: 1.6 }}>
            Screen Snap {kb('5', { ctrl: true, shift: true })} · Timed {kb('6', { ctrl: true, shift: true })}
            <br />
            Fullscreen {kb('7', { ctrl: true, shift: true })} · Window {kb('8', { ctrl: true, shift: true })}
          </div>
        </div>
        <div className="buttons">
          <button className="pill primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
