import { useId, useState } from "react";
import { Link, useLocation, useMatches } from "react-router";

import { PRODUCT_NAME } from "../brand";
import { LATEST_LEDGERS_ID, LATEST_TRANSACTIONS_ID } from "../anchors";
import { cx } from "../cx";
import type { Feature } from "../features";
import type { NetworkBrief } from "../networks";
import { navSectionOf, type NavSection } from "../route-handle";
import { useFeatures } from "../use-network";
import { CloseIcon, LogoMark, MenuIcon } from "./icons";
import { NetworkSwitch } from "./NetworkSwitch";
import { SearchBox } from "./SearchBox";
import { ThemeToggle } from "./ThemeToggle";

/**
 * `to`: where the item leads; without it the item is a label with a "soon" tag. `section`: the `navSection` (route-handle.ts) of the
 * pages the item stands for, which the header marks as current. `feature`: the switch (features.ts) the item needs; while it is off the
 * item is the label too.
 */
type NavItem = { label: string; to?: (net: NetworkBrief) => string; section?: NavSection; feature?: Feature };

// Ledgers and Transactions lead to the home page's two lists, Network to the network page, Markets to the markets page while `MARKETS` is on (a label with
// a "soon" tag while it is off). AMM is a later sub-project's: a label with a "soon" tag.
const NAV: readonly NavItem[] = [
  { label: "Ledgers", to: (net) => `/${net.id}#${LATEST_LEDGERS_ID}` },
  { label: "Transactions", to: (net) => `/${net.id}#${LATEST_TRANSACTIONS_ID}` },
  { label: "Network", to: (net) => `/${net.id}/network`, section: "network" },
  { label: "Markets", to: (net) => `/${net.id}/markets`, section: "markets", feature: "markets" },
  { label: "AMM" },
];

/** An href without its query and its fragment. */
function pathOf(href: string): string {
  return href.split(/[?#]/, 1)[0]!;
}

/**
 * The header of every page of a network: logo, network switch, navigation, search box, theme toggle. On a phone the
 * navigation folds into a menu button. `search={false}` leaves the box out, for the home page, whose hero has its own.
 */
export function Header({ net, search = true }: { net: NetworkBrief; search?: boolean }) {
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const features = useFeatures();
  const { pathname } = useLocation();
  const section = navSectionOf(useMatches());

  return (
    <header className="hdr">
      <div className="container hdr__inner">
        <Link to={`/${net.id}`} className="hdr__brand" aria-label={`${PRODUCT_NAME} home`}>
          <LogoMark />
          <span className="hdr__name">{PRODUCT_NAME}</span>
        </Link>
        <NetworkSwitch net={net.id} />
        <nav id={menuId} className={cx("hdr__nav", menuOpen && "is-open")} aria-label="Main">
          <ul>
            {NAV.map((item) => {
              const href = item.to && (!item.feature || features[item.feature]) ? item.to(net) : undefined;
              // The current section's item: "page" on the section's own page (whatever its query), "true" on any other page of the section.
              const current = href !== undefined && item.section !== undefined && item.section === section;
              return (
                <li key={item.label}>
                  {href !== undefined ? (
                    <Link
                      to={href}
                      className={cx("nav-item", current && "is-current")}
                      aria-current={current ? (pathname === pathOf(href) ? "page" : "true") : undefined}
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <span className="nav-item is-soon" aria-disabled="true">
                      <span>{item.label}</span>
                      <span className="soon">soon</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
        {search && <SearchBox net={net} variant="header" />}
        <div className="hdr__tools">
          <ThemeToggle />
          <button
            type="button"
            className="icon-btn hdr__menu"
            aria-label="Menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>
    </header>
  );
}
