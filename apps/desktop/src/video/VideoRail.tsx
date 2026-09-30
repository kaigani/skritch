import { editFrameAsImage, exportFramePng } from '../actions/video';
import { edl, useVideo, video } from '../state/video';
import { Icon } from '../ui/icons';
import { kb } from '../ui/keys';

/** Video rail (§6.5): same 44 px rail as image mode so the app "feels" the same. */
export function VideoRail() {
  const playing = useVideo((s) => s.playing);
  const markers = useVideo((s) => s.project?.markers);
  const hasClipboard = useVideo((s) => !!s.project?.clipboard?.length);
  const hasClips = useVideo((s) => !!s.project?.sequence.length);
  const range = markers?.in !== undefined && markers?.out !== undefined && markers.out > markers.in;

  const items: Array<{
    label: string;
    key: string;
    icon: () => JSX.Element;
    run: () => void;
    disabled?: boolean;
    divider?: boolean;
  }> = [
    {
      label: playing ? 'Pause' : 'Play',
      key: 'Space',
      icon: playing ? Icon.pause : Icon.play,
      run: () => useVideo.setState({ playing: !playing }),
      disabled: !hasClips,
    },
    {
      label: 'Step back',
      key: '←',
      icon: Icon.stepBack,
      run: () => video().setPlayhead(video().playhead - 1),
      disabled: !hasClips,
    },
    {
      label: 'Step forward',
      key: '→',
      icon: Icon.stepFwd,
      run: () => video().setPlayhead(video().playhead + 1),
      disabled: !hasClips,
      divider: true,
    },
    { label: 'Set In', key: 'I', icon: Icon.markIn, run: edl.setIn, disabled: !hasClips },
    { label: 'Set Out', key: 'O', icon: Icon.markOut, run: edl.setOut, disabled: !hasClips, divider: true },
    { label: 'Delete In→Out', key: 'Del', icon: Icon.deleteRange, run: edl.deleteRange, disabled: !range },
    {
      label: 'Trim to In→Out',
      key: kb('T', { shift: true }),
      icon: Icon.trimRange,
      run: edl.trimToRange,
      disabled: !range,
    },
    { label: 'Cut', key: kb('X'), icon: Icon.cut, run: edl.cut, disabled: !range },
    { label: 'Copy', key: kb('C'), icon: Icon.copy, run: edl.copy, disabled: !range },
    { label: 'Paste', key: kb('V'), icon: Icon.paste, run: edl.paste, disabled: !hasClipboard },
    {
      label: 'Split at playhead',
      key: kb('K'),
      icon: Icon.split,
      run: edl.split,
      disabled: !hasClips,
      divider: true,
    },
    {
      label: 'Edit Frame as Image',
      key: kb('Enter'),
      icon: Icon.frameToImage,
      run: () => void editFrameAsImage(),
      disabled: !hasClips,
    },
    {
      label: 'Export Frame PNG',
      key: kb('E', { shift: true }),
      icon: Icon.exportFrame,
      run: () => void exportFramePng(),
      disabled: !hasClips,
    },
  ];

  return (
    <nav className="rail" aria-label="Video tools">
      {items.map((it) => (
        <div key={it.label} style={{ display: 'contents' }}>
          <button
            className="tool"
            title={`${it.label} (${it.key})`}
            aria-label={it.label}
            disabled={it.disabled}
            onClick={it.run}
          >
            <it.icon />
          </button>
          {it.divider && <div className="divider" />}
        </div>
      ))}
    </nav>
  );
}
