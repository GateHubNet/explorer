import { Link } from "react-router";

import { cx } from "../cx";

export interface TabItem {
  id: string;
  label: string;
  /** Where the tab goes (`?tab=payments`). Tabs are links, so each is a URL of its own and works without JavaScript. */
  href?: string;
  /** A tab for a later release: shown, not a link. */
  soon?: boolean;
}

/** Tabs as navigation: the current one is `aria-current="page"`; one that is not there yet is a disabled label with a "soon" tag. */
export function Tabs({ label, items, current }: { label: string; items: readonly TabItem[]; current: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.soon || item.href === undefined ? (
              <span className="tabs__item is-soon" aria-disabled="true">
                <span>{item.label}</span>
                {item.soon && <span className="soon">soon</span>}
              </span>
            ) : (
              <Link
                to={item.href}
                className={cx("tabs__item", item.id === current && "is-current")}
                aria-current={item.id === current ? "page" : undefined}
              >
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
