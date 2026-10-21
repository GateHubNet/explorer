import { Link } from "react-router";

import { cx } from "../cx";

export interface TabItem {
  id: string;
  label: string;
  /** Where the tab goes (`?tab=payments`). Tabs are links, so each is a URL of its own and works without JavaScript. */
  href?: string;
  /** A tab for a later release: shown, not a link. */
  soon?: boolean;
  /** The link's `rel` (`nofollow` for a view crawlers are kept off). */
  rel?: string;
  /**
   * Called when the pointer enters the tab or the tab takes the focus: a visitor who may open it next. The account's Analytics tab loads its
   * view's chunk then, and nothing else (not React Router's `prefetch="intent"`, which would also fetch the view's data).
   */
  onIntent?: () => void;
}

/**
 * Tabs as navigation: the current one is `aria-current="page"`; one that is not there yet is a disabled label with a "soon" tag.
 * `preventScrollReset` makes a click on any tab a client-side navigation that keeps the window where it is, for tabs that are not at the top
 * of their page (the pool page's activity); left out, a tab is a link as it was, and the navigation goes to the top.
 */
export function Tabs({
  label,
  items,
  current,
  preventScrollReset = false,
}: {
  label: string;
  items: readonly TabItem[];
  current: string;
  preventScrollReset?: boolean;
}) {
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
                rel={item.rel}
                preventScrollReset={preventScrollReset}
                className={cx("tabs__item", item.id === current && "is-current")}
                aria-current={item.id === current ? "page" : undefined}
                onPointerEnter={item.onIntent}
                onFocus={item.onIntent}
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
