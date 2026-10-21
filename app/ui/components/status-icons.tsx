// The icons of the status marks of the validators and amendments pages (StatusMarks.tsx, spec 2.5) and of the AMM pages' statuses ("Deleted", "Open"),
// in the style of icons.tsx (24 px grid, rounded strokes, aria-hidden; its `icon` helper draws them). They live apart from icons.tsx because the
// header imports that, and so every page loads it: a page that draws these marks pays for the icons it uses, and the others pay nothing.
//
// They sit in 12 px pills and quiet texts, so they are small and heavier than the chrome's; the drawings are the mock's (the AMM pair's are E5's).
// An icon of two shapes wraps them in a `<g>`, not a fragment: a fragment's `Fragment` is read when the module loads, which the bundler keeps for
// an icon that nothing imports (a few bytes on every page that loads the module), and a `<g>` costs nothing.

import { icon } from "./icons";

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
// The AMM pages' two are marked pure: the bundler cannot tell that `icon()` has no side effect, and would otherwise keep both in every page that loads
// this module for its other marks (about 60 B on the validators and amendments pages); unused, they are dropped.
/** A pool that was deleted (the AMM pages' "Deleted" tag): a bin. */
export const DeletedIcon = /* @__PURE__ */ icon(
  <g>
    <path d="M4 7h16M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
  </g>,
  { strokeWidth: 2.4, size: 12 },
);
/** An auction slot nobody holds (the AMM pages' "Open"): an open lock. */
export const OpenIcon = /* @__PURE__ */ icon(
  <g>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 7.7-1.5" />
  </g>,
  { strokeWidth: 2.4, size: 12 },
);
