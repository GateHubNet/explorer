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
 * `busy` is a tile before its data: `aria-busy`, and a figure that is empty, whatever `value` is, and keeps the height of one line.
 */
export function StatTile({
  label,
  value,
  sub,
  figure,
  delta,
  trend,
  source,
  busy,
}: {
  label: string;
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
      <span className="stat__label">{label}</span>
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

/** The row of tiles a page opens with. `narrow` is for tiles of a figure each: as many as fit at 150 px (a phone has two in a row). */
export function StatGrid({ label, narrow, children }: { label: string; narrow?: boolean; children: ReactNode }) {
  return (
    <section className={cx("stat-grid", narrow && "stat-grid--narrow")} aria-label={label}>
      {children}
    </section>
  );
}
