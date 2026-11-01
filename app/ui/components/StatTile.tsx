import type { ReactNode } from "react";

import type { Delta } from "../charts/types";
import { cx } from "../cx";
import { TriangleDownIcon, TriangleUpIcon } from "./icons";

/**
 * A figure with a label and a note under it ("Latest validated ledger", "#107,695,660", "closed 3 s ago"). The home page's tiles are mono at 22
 * px. `figure` is the style of the network pages (spec 2.11): sans, proportional figures, 24 px, weight 600.
 *
 * `delta` is the change against a period, after the value and before the note: a triangle (up, down, or none for a change of 0) and the signed
 * text, in `--muted`, because more is neither good nor bad. The triangle is a picture, so the text says the sign. `trend` is a `Sparkline`, and
 * `source` is the tile's own line under everything else: the data API path it is made from, faint and mono, as a chart card has.
 *
 * `aside` is a short figure at the right of the label, faint and small ("≈ 99.99B" over an exact figure): the label and the aside are then one line of their own, `.stat__head`. A tile without one
 * is as it was, the label alone in the tile.
 *
 * `busy` is a tile before its data: `aria-busy`, and a figure that is empty, whatever `value` is, and keeps the height of one line.
 */
export function StatTile({
  label,
  aside,
  value,
  sub,
  figure,
  delta,
  trend,
  source,
  busy,
}: {
  label: string;
  aside?: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  figure?: boolean;
  delta?: Delta;
  trend?: ReactNode;
  source?: string;
  busy?: boolean;
}) {
  return (
    <div className={cx("stat", figure && "stat--figure")} aria-busy={busy || undefined}>
      {aside === undefined || aside === null || aside === false ? (
        <span className="stat__label">{label}</span>
      ) : (
        <span className="stat__head">
          <span className="stat__label">{label}</span>
          <span className="stat__aside">{aside}</span>
        </span>
      )}
      <span className="stat__value">{busy ? null : value}</span>
      {delta && (
        <span className="stat__delta">
          {delta.sign === 1 && <TriangleUpIcon />}
          {delta.sign === -1 && <TriangleDownIcon />}
          {delta.text}
        </span>
      )}
      {sub && <span className="stat__sub">{sub}</span>}
      {trend && <span className="stat__trend">{trend}</span>}
      {source && <span className="stat__source">{source}</span>}
    </div>
  );
}

/**
 * The row of tiles a page opens with. `narrow` is for tiles of a figure each: as many as fit at 150 px (a phone has two in a row). `wide` is for tiles that hold a formula and a definition
 * as well as the figure: as many as fit at 360 px, or one in a row where the section is narrower.
 */
export function StatGrid({ label, narrow, wide, children }: { label: string; narrow?: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <section className={cx("stat-grid", narrow && "stat-grid--narrow", wide && "stat-grid--wide")} aria-label={label}>
      {children}
    </section>
  );
}
