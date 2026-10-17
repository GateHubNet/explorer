import type { ReactNode } from "react";

/** A figure with a label and a note under it ("Latest validated ledger", "#107,695,660", "closed 3 s ago"). */
export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {sub && <span className="stat__sub">{sub}</span>}
    </div>
  );
}

/** The row of tiles the home page opens with. */
export function StatGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="stat-grid" aria-label={label}>
      {children}
    </section>
  );
}
