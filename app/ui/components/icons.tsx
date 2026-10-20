// The few icons the chrome uses, as inline SVG in the mock's style (24 px grid, rounded strokes). Decorative: they are
// aria-hidden, the text next to them (or the button's label) is what is read.

import type { ReactNode } from "react";

type IconProps = { size?: number; className?: string };

export function icon(children: ReactNode, defaults: { strokeWidth: number; size: number }) {
  return function Icon({ size = defaults.size, className }: IconProps) {
    return (
      <svg
        className={className}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={defaults.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {children}
      </svg>
    );
  };
}

export const CheckIcon = icon(<path d="M5 12.5l4.5 4.5L19 7.5" />, { strokeWidth: 3, size: 12 });
export const CrossIcon = icon(<path d="M6 6l12 12M18 6L6 18" />, { strokeWidth: 3, size: 12 });
export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
  { strokeWidth: 2, size: 18 },
);
export const CopyIcon = icon(
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </>,
  { strokeWidth: 2, size: 14 },
);
export const ArrowRightIcon = icon(<path d="M5 12h14M13 6l6 6-6 6" />, { strokeWidth: 2, size: 16 });
export const ChevronLeftIcon = icon(<path d="M15 6l-6 6 6 6" />, { strokeWidth: 2.2, size: 14 });
export const ChevronRightIcon = icon(<path d="M9 6l6 6-6 6" />, { strokeWidth: 2.2, size: 14 });
export const MenuIcon = icon(<path d="M4 7h16M4 12h16M4 17h16" />, { strokeWidth: 2, size: 20 });
export const CloseIcon = icon(<path d="M6 6l12 12M18 6L6 18" />, { strokeWidth: 2, size: 20 });
export const SunIcon = icon(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
  </>,
  { strokeWidth: 2, size: 20 },
);
export const MoonIcon = icon(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />, { strokeWidth: 2, size: 20 });
export const InfoIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </>,
  { strokeWidth: 2, size: 16 },
);
export const AlertIcon = icon(
  <>
    <path d="M12 3.5l9.5 16.5h-19z" />
    <path d="M12 10v4.5M12 17.5h.01" />
  </>,
  { strokeWidth: 2, size: 16 },
);
export const DownloadIcon = icon(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />, { strokeWidth: 2, size: 14 });

/** A filled shape on the board's 10 px grid, not a stroke: the triangles of a tile's delta (an up or a down). */
function triangle(path: string) {
  return function Triangle({ size = 10, className }: IconProps) {
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <path d={path} fill="currentColor" />
      </svg>
    );
  };
}

export const TriangleUpIcon = triangle("M5 1.5 9 8H1z");
export const TriangleDownIcon = triangle("M5 8.5 1 2h8z");

/** The mark of the header. The square takes the network's accent. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true" focusable="false">
      <rect className="logo__bg" width="28" height="28" rx="8" />
      <path d="M8 10h7M8 14h12M8 18h9" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
