// The few icons the chrome uses, as inline SVG in the mock's style (24 px grid, rounded strokes). Decorative: they are
// aria-hidden, the text next to them (or the button's label) is what is read.

import type { ReactNode } from "react";

type IconProps = { size?: number; className?: string };

function icon(children: ReactNode, defaults: { strokeWidth: number; size: number }) {
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

// The marks of the validators and amendments pages (statuses, spec 2.5). They sit in 12 px pills and quiet texts, so they are small and heavier
// than the chrome's; the drawings are the mock's. An icon of two shapes wraps them in a `<g>`, not a fragment: a fragment's `Fragment` is read when
// the module loads, which the bundler keeps for an icon that no page imports yet (a few bytes on every page), and a `<g>` costs nothing.
export const ShieldIcon = icon(<path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6z" />, { strokeWidth: 2.2, size: 12 });
export const ClockIcon = icon(
  <g>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </g>,
  { strokeWidth: 2.6, size: 12 },
);
export const BallotIcon = icon(
  <g>
    <rect x="4" y="11" width="16" height="9" rx="2" />
    <path d="M9 11V4h6v7M9 15h6" />
  </g>,
  { strokeWidth: 2.4, size: 12 },
);
export const MinusCircleIcon = icon(
  <g>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12h8" />
  </g>,
  { strokeWidth: 2.6, size: 12 },
);
export const QuestionIcon = icon(
  <g>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 16.8h.01" />
  </g>,
  { strokeWidth: 2.4, size: 12 },
);
/** An arrow up onto a bar: the newest release. */
export const LatestIcon = icon(<path d="M12 20V8M6.5 13.5 12 8l5.5 5.5M6 4h12" />, { strokeWidth: 2.4, size: 12 });
export const ExternalIcon = icon(<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />, { strokeWidth: 2, size: 12 });
export const CheckCircleIcon = icon(
  <g>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.7 2.7L16 9.8" />
  </g>,
  { strokeWidth: 2.2, size: 13 },
);
export const AlertCircleIcon = icon(
  <g>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5h.01" />
  </g>,
  { strokeWidth: 2.2, size: 13 },
);
/** A horizontal stroke: no, not on the list, no recent vote. */
export const DashIcon = icon(<path d="M6 12h12" />, { strokeWidth: 3, size: 12 });
export const EqualsIcon = icon(<path d="M6 9.5h12M6 14.5h12" />, { strokeWidth: 3, size: 11 });
export const ArrowUpIcon = icon(<path d="M12 19V5M6 11l6-6 6 6" />, { strokeWidth: 3, size: 11 });
export const ArrowDownIcon = icon(<path d="M12 5v14M6 13l6 6 6-6" />, { strokeWidth: 3, size: 11 });

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
