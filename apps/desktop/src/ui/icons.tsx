import type { ReactNode } from 'react';
import appIcon from '../assets/app-icon.png';

const Svg = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
);

export const Icon = {
  select: () => (
    <Svg>
      <path d="M5 3l10 6.2-4.4 1 2.6 5-1.9.9-2.6-5L5 14z" fill="currentColor" stroke="none" />
    </Svg>
  ),
  arrow: () => (
    <Svg>
      <path d="M3.5 16.5L12.6 7.4" strokeWidth={2.6} />
      <path d="M9.2 4.2h7v7z" fill="currentColor" stroke="none" />
    </Svg>
  ),
  text: () => (
    <Svg>
      <path d="M4 5.2V3.8h12v1.4M10 3.8v12.6M7.4 16.4h5.2" strokeWidth={2.2} />
    </Svg>
  ),
  rect: () => (
    <Svg>
      <rect x="3.5" y="5" width="13" height="10" rx="0.5" strokeWidth={2} />
    </Svg>
  ),
  roundRect: () => (
    <Svg>
      <rect x="3.5" y="5" width="13" height="10" rx="3" strokeWidth={2} />
    </Svg>
  ),
  ellipse: () => (
    <Svg>
      <ellipse cx="10" cy="10" rx="7" ry="5.2" strokeWidth={2} />
    </Svg>
  ),
  line: () => (
    <Svg>
      <path d="M4 16L16 4" strokeWidth={2.2} />
    </Svg>
  ),
  pen: () => (
    <Svg>
      <path d="M3.5 16.5c2-5 4.5-1.5 6.5-5s3-6.5 6.5-7" strokeWidth={2} />
    </Svg>
  ),
  highlight: () => (
    <Svg>
      <path d="M11.8 3.5l4.7 4.7-6.8 6.8H5v-4.7z" strokeWidth={1.6} />
      <path d="M3 17h14" strokeWidth={3} stroke="#ffcc00" />
    </Svg>
  ),
  stamp: () => (
    <Svg>
      <circle cx="10" cy="10" r="7" fill="currentColor" stroke="none" />
      <path d="M6.8 10.2l2.2 2.3 4.2-4.8" stroke="#3b3b3d" strokeWidth={2} />
    </Svg>
  ),
  pixelate: () => (
    <Svg>
      <g fill="currentColor" stroke="none">
        <rect x="3" y="3" width="4.2" height="4.2" />
        <rect x="12.8" y="3" width="4.2" height="4.2" opacity=".55" />
        <rect x="7.9" y="7.9" width="4.2" height="4.2" />
        <rect x="3" y="12.8" width="4.2" height="4.2" opacity=".55" />
        <rect x="12.8" y="12.8" width="4.2" height="4.2" />
        <rect x="7.9" y="3" width="4.2" height="4.2" opacity=".3" />
        <rect x="3" y="7.9" width="4.2" height="4.2" opacity=".3" />
      </g>
    </Svg>
  ),
  crop: () => (
    <Svg>
      <path d="M5.5 2.5v12h12M2.5 5.5h12v12" strokeWidth={2} />
    </Svg>
  ),
  fit: () => (
    <Svg size={16}>
      <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
    </Svg>
  ),
  play: () => (
    <Svg>
      <path d="M6 4l10 6-10 6z" fill="currentColor" stroke="none" />
    </Svg>
  ),
  pause: () => (
    <Svg>
      <g fill="currentColor" stroke="none">
        <rect x="5" y="4" width="3.6" height="12" rx="1" />
        <rect x="11.4" y="4" width="3.6" height="12" rx="1" />
      </g>
    </Svg>
  ),
  stepBack: () => (
    <Svg>
      <path d="M14.5 4.5L8 10l6.5 5.5z" fill="currentColor" stroke="none" />
      <path d="M5.5 4.5v11" strokeWidth={2} />
    </Svg>
  ),
  stepFwd: () => (
    <Svg>
      <path d="M5.5 4.5L12 10l-6.5 5.5z" fill="currentColor" stroke="none" />
      <path d="M14.5 4.5v11" strokeWidth={2} />
    </Svg>
  ),
  toStart: () => (
    <Svg>
      <path d="M16 5l-6 5 6 5zM10 5l-6 5 6 5z" fill="currentColor" stroke="none" />
    </Svg>
  ),
  toEnd: () => (
    <Svg>
      <path d="M4 5l6 5-6 5zM10 5l6 5-6 5z" fill="currentColor" stroke="none" />
    </Svg>
  ),
  markIn: () => (
    <Svg>
      <path d="M8 3.5H5.5v13H8" strokeWidth={2.2} />
      <path d="M11.5 10h5M14 7.5l2.5 2.5-2.5 2.5" />
    </Svg>
  ),
  markOut: () => (
    <Svg>
      <path d="M12 3.5h2.5v13H12" strokeWidth={2.2} />
      <path d="M3.5 10h5M6 7.5L8.5 10 6 12.5" />
    </Svg>
  ),
  deleteRange: () => (
    <Svg>
      <path d="M4 5.5h12M8 5.5V4h4v1.5M5.5 5.5l.8 11h7.4l.8-11" />
    </Svg>
  ),
  trimRange: () => (
    <Svg>
      <path d="M4 3.5v13M16 3.5v13" strokeWidth={2.2} />
      <rect x="7" y="7" width="6" height="6" fill="currentColor" stroke="none" />
    </Svg>
  ),
  cut: () => (
    <Svg>
      <circle cx="6" cy="14.5" r="2.3" />
      <circle cx="14" cy="14.5" r="2.3" />
      <path d="M7.6 12.8L15 3.5M12.4 12.8L5 3.5" />
    </Svg>
  ),
  copy: () => (
    <Svg>
      <rect x="7" y="7" width="9.5" height="9.5" rx="1.5" />
      <path d="M13 4.5V4.2a.7.7 0 00-.7-.7H4.2a.7.7 0 00-.7.7v8.1c0 .4.3.7.7.7h.3" />
    </Svg>
  ),
  paste: () => (
    <Svg>
      <rect x="4.5" y="4" width="11" height="13" rx="1.5" />
      <path d="M7.5 4V2.8h5V4M7.5 9h5M7.5 12h5" />
    </Svg>
  ),
  split: () => (
    <Svg>
      <path d="M10 2.5v15" strokeDasharray="2 2" />
      <path d="M3 6.5h4.5v7H3M17 6.5h-4.5v7H17" />
    </Svg>
  ),
  frameToImage: () => (
    <Svg>
      <rect x="3" y="4" width="14" height="11" rx="1.5" />
      <path d="M5.5 12.5l3-3.5 2.5 2.5 1.5-1.5 2 2.5" />
      <path d="M13.5 17.5l3.5-3.5" stroke="var(--pink)" strokeWidth={2.2} />
    </Svg>
  ),
  exportFrame: () => (
    <Svg>
      <path d="M10 3v9M6.5 8.5L10 12l3.5-3.5M4 14v2.5h12V14" strokeWidth={1.9} />
    </Svg>
  ),
  back: () => (
    <Svg size={16}>
      <path d="M12 4l-6 6 6 6" strokeWidth={2} />
    </Svg>
  ),
  camera: () => (
    <Svg size={16}>
      <path d="M2.5 6.5h3l1.5-2h6l1.5 2h3v10h-15z" />
      <circle cx="10" cy="11" r="3" />
    </Svg>
  ),
  share: () => (
    <Svg size={16}>
      <path d="M10 12.5V3M6.5 6.5L10 3l3.5 3.5M5 9.5H3.5v8h13v-8H15" />
    </Svg>
  ),
  bin: () => (
    <Svg size={16}>
      <rect x="3" y="4" width="14" height="4" rx="1" />
      <path d="M4.5 8v8h11V8M8 11h4" />
    </Svg>
  ),
  logo: ({ size = 48 }: { size?: number } = {}) => (
    <img src={appIcon} width={size} height={size} alt="" draggable={false} />
  ),
};

export const StampGlyphIcon = ({ glyph }: { glyph: string }) => (
  <svg width={22} height={22} viewBox="0 0 22 22" aria-hidden>
    <circle cx="11" cy="11" r="10" fill="var(--pink)" />
    {glyph === 'check' && (
      <path
        d="M6.5 11.2l3 3.1 6-6.6"
        stroke="#fff"
        strokeWidth={2.4}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )}
    {glyph === 'x' && (
      <path d="M7.5 7.5l7 7M14.5 7.5l-7 7" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
    )}
    {glyph === 'heart' && (
      <path
        d="M11 16.3c-4.6-3-5.6-5.2-4.8-7 .8-1.7 3.3-1.9 4.8.1 1.5-2 4-1.8 4.8-.1.8 1.8-.2 4-4.8 7z"
        fill="#fff"
      />
    )}
    {(glyph === 'question' || glyph === 'exclaim') && (
      <text
        x="11"
        y="15.6"
        textAnchor="middle"
        fontSize="13"
        fontWeight="800"
        fill="#fff"
        fontFamily="Nunito, sans-serif"
      >
        {glyph === 'question' ? '?' : '!'}
      </text>
    )}
  </svg>
);
