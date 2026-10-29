// A link to another site, a file of its own: the account page's header draws it (a verified domain, the toml file, a label's link), and StatusMarks.tsx, where it began, would
// bring the validators' marks with it (the countdown, the pills) into the account page's bundle.

import type { ReactNode } from "react";

import { ExternalIcon } from "./status-icons";

/**
 * A link to another site: it opens a new tab, without handing the page over (`noopener noreferrer`), and says so with the icon and, to a
 * screen reader, "(opens in a new tab)". `nofollow` is for what anyone can point at (a validator's TOML file).
 */
export function ExternalLink({ href, nofollow, children }: { href: string; nofollow?: boolean; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel={nofollow ? "noopener noreferrer nofollow" : "noopener noreferrer"}>
      {children}
      <ExternalIcon className="extlink__icon" />
      <span className="sr"> (opens in a new tab)</span>
    </a>
  );
}
