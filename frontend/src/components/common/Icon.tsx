import type { SVGProps } from 'react';

/**
 * In-house line-art icon set for controls and inline affordances. Each glyph is
 * drawn on a 24px grid with a shared 1.7px stroke, inherits `currentColor` and
 * defaults to 1em so it sits on the text baseline. Deliberately not a generic
 * AI-generated icon pack: only the glyphs this product actually uses live here.
 */

export type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function base({ size = '1em', strokeWidth = 1.7, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...rest,
  };
}

export const Bot = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="8" width="16" height="11" rx="3" />
    <path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5" />
  </svg>
);

export const Chat = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 12a7 7 0 0 1-7 7H9l-4 3v-4.4A7 7 0 0 1 9 5h4a7 7 0 0 1 7 7Z" />
  </svg>
);

export const Medal = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="14" r="6" />
    <path d="M12 11.5l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2L9 13.7l2-.3.9-1.9Z" />
    <path d="M8 4h8l-1.5 4.2M8 4l1.5 4.2" />
  </svg>
);

export const Paperclip = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 11.5 12.6 20a5 5 0 0 1-7-7l8.7-8.7a3.5 3.5 0 0 1 5 5l-8.7 8.7a2 2 0 0 1-2.8-2.8l7.6-7.6" />
  </svg>
);

export const Bookmark = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 4.5h12v16l-6-4-6 4v-16Z" />
  </svg>
);

export const Check = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12.5 9.5 17 19 7" />
  </svg>
);

export const Play = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M10 8.8 16 12l-6 3.2V8.8Z" />
  </svg>
);

export const Video = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="6" width="12" height="12" rx="2.5" />
    <path d="M15 10.5 21 7.5v9l-6-3" />
  </svg>
);

export const Note = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 3h10a2 2 0 0 1 2 2v14l-4-3-4 3-4-3V5a2 2 0 0 1 2-2Z" />
    <path d="M9 8h6M9 12h4" />
  </svg>
);

export const Flag = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 3v18M5 4h11l-1.5 3.5L16 11H5" />
  </svg>
);

export const Bell = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z" />
    <path d="M10 18a2 2 0 0 0 4 0" />
  </svg>
);

export const Sun = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </svg>
);

export const Moon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </svg>
);

export const ShieldCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l7 3v5.5c0 4.3-2.9 7.9-7 9.5-4.1-1.6-7-5.2-7-9.5V6l7-3Z" />
    <path d="M8.8 12 11 14.2 15.4 10" />
  </svg>
);

export const Download = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4v10M8 10.5l4 4 4-4M5 19h14" />
  </svg>
);

export const BarChart = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 20V10M12 20V4M19 20v-7" />
  </svg>
);

export const GraduationCap = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 9.5 12 5l9 4.5-9 4.5-9-4.5Z" />
    <path d="M7 12v4.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V12" />
  </svg>
);


export const X = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const Trash = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h16M10 4h4M6 7l1 13h10l1-13" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const Search = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-3.7-3.7" />
  </svg>
);

export const Clock = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const Target = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" />
  </svg>
);

export const FileText = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    <path d="M14 3v5h5M9.5 13h5M9.5 16.5h5" />
  </svg>
);

export const Slides = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M12 16v4M9 20h6" />
  </svg>
);

export const Table = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="M3 9.5h18M9 9.5v10M15 9.5v10" />
  </svg>
);

export const Archive = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="5" rx="1.5" />
    <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
    <path d="M10 13h4" />
  </svg>
);

export const Image = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m4.5 17 4.5-4 3.5 3 3-2.5 4 3.5" />
  </svg>
);

export const ClipboardCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 4h6v3H9z" />
    <path d="M15 5.5h2a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2h2" />
    <path d="m9.5 13 2 2 3.5-3.5" />
  </svg>
);

export const Star = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4l2.3 4.9 5.2.7-3.8 3.6.9 5.2-4.6-2.6-4.6 2.6.9-5.2L4.5 9.6l5.2-.7L12 4Z" />
  </svg>
);

export const StarFilled = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor">
    <path d="M12 4l2.3 4.9 5.2.7-3.8 3.6.9 5.2-4.6-2.6-4.6 2.6.9-5.2L4.5 9.6l5.2-.7L12 4Z" />
  </svg>
);

