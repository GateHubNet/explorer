import type { ReactNode } from "react";
import { Link } from "react-router";

import { cx } from "../cx";

export interface Crumb {
  label: ReactNode;
  /** Absent on the last crumb, the current page. */
  href?: string;
  mono?: boolean;
}

/** `XRPL / Ledger 107,695,660 / 67F91E…7C31`. The last item is the current page. */
export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="crumbs">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={index}>
              {item.href && !last ? (
                <Link to={item.href} className={cx(item.mono && "mono")}>
                  {item.label}
                </Link>
              ) : (
                <span className={cx(item.mono && "mono")} aria-current={last ? "page" : undefined}>
                  {item.label}
                </span>
              )}
              {!last && <span aria-hidden="true">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
