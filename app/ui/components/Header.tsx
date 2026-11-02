import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useMatches } from "react-router";

import { PRODUCT_NAME } from "../brand";
import { LATEST_LEDGERS_ID, LATEST_TRANSACTIONS_ID } from "../anchors";
import { cx } from "../cx";
import { networkKindOf } from "../environment";
import type { Feature } from "../features";
import type { NetworkBrief } from "../networks";
import { navPageOf, navSectionOf, type NavPage, type NavSection } from "../route-handle";
import { useDisclosureMenu } from "../use-disclosure-menu";
import { useEnvironment, useFeatures } from "../use-network";
import { ChevronDownIcon, CloseIcon, LogoMark, MenuIcon } from "./icons";
import { NetworkSwitch } from "./NetworkSwitch";
import { Pill } from "./Pill";
import { SearchBox } from "./SearchBox";
import { ThemeToggle } from "./ThemeToggle";

/**
 * `to`: where the item leads; without it the item is a label with a "soon" tag. `section`: the `navSection` (route-handle.ts) of the pages the item stands for, which the header marks
 * as current. `feature`: the switch (features.ts) the item needs; while it is off the item is the label too. An item with `items` is a menu: a disclosure of links, each with the
 * `navPage` (route-handle.ts) of the pages it stands for and its own switch.
 */
type NavMenuItem = { label: string; to: (net: NetworkBrief) => string; page: NavPage; feature?: Feature };
type NavItem =
  | { label: string; to?: (net: NetworkBrief) => string; section?: NavSection; feature?: Feature }
  | { label: string; section: NavSection; items: readonly NavMenuItem[] };

// Ledgers and Transactions lead to the home page's two lists, Tokens to the tokens page while `TOKENS` is on, Network is the menu of the network pages (Overview always, Validators and Amendments
// while `VALIDATORS` is on, Supply while `SUPPLY` is on; the others are labels with a "soon" tag), Markets to the markets page while `MARKETS` is on, and AMM to the AMM pools while `AMM_PAGES` is on
// (on both networks: Xahau's page says it has none), and NFTs to the NFTs page while `NFTS` is on (on both networks). Tokens, Markets, AMM and NFTs are a label with a "soon" tag while their
// switch is off.
const NAV: readonly NavItem[] = [
  { label: "Ledgers", to: (net) => `/${net.id}#${LATEST_LEDGERS_ID}` },
  { label: "Transactions", to: (net) => `/${net.id}#${LATEST_TRANSACTIONS_ID}` },
  { label: "Tokens", to: (net) => `/${net.id}/tokens`, section: "tokens", feature: "tokens" },
  {
    label: "Network",
    section: "network",
    items: [
      { label: "Overview", to: (net) => `/${net.id}/network`, page: "overview" },
      { label: "Validators", to: (net) => `/${net.id}/validators`, page: "validators", feature: "validators" },
      { label: "Amendments", to: (net) => `/${net.id}/amendments`, page: "amendments", feature: "validators" },
      { label: "Supply", to: (net) => `/${net.id}/supply`, page: "supply", feature: "supply" },
    ],
  },
  { label: "Markets", to: (net) => `/${net.id}/markets`, section: "markets", feature: "markets" },
  { label: "AMM", to: (net) => `/${net.id}/amm`, section: "amm", feature: "ammPages" },
  { label: "NFTs", to: (net) => `/${net.id}/nfts`, section: "nfts", feature: "nfts" },
];

/** An href without its query and its fragment. */
function pathOf(href: string): string {
  return href.split(/[?#]/, 1)[0]!;
}

/**
 * A menu of the navigation (supply spec 2.2): a `<details>` with the section's name as its summary and the links in a list, so that it opens and closes before any script and without
 * one; `useDisclosureMenu` adds Escape, a pointer outside, focus leaving, a navigation and one menu open at a time. The summary is the section's mark (`.is-current` and
 * `aria-current="true"` on every page of it). An item is `aria-current="page"` on the page that names it (`navPage`) at its own path, whatever the query, and `"true"` on a page under it. An
 * item whose switch is off is a label with a "soon" tag, as a header item is.
 */
function NavMenu({ item, net, section, pathname }: { item: Extract<NavItem, { items: readonly NavMenuItem[] }>; net: NetworkBrief; section: NavSection | undefined; pathname: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDisclosureMenu(ref);
  const features = useFeatures();
  const page = navPageOf(useMatches());
  const current = item.section === section;
  return (
    <details ref={ref} className="menu" data-menu={item.section}>
      <summary className={cx("nav-item", "menu__summary", current && "is-current")} aria-current={current ? "true" : undefined}>
        {item.label}
        <ChevronDownIcon className="menu__chevron" />
      </summary>
      <ul className="menu__panel">
        {item.items.map((entry) => {
          const href = !entry.feature || features[entry.feature] ? entry.to(net) : undefined;
          const here = href !== undefined && entry.page === page;
          return (
            <li key={entry.label}>
              {href !== undefined ? (
                <Link to={href} className="menu__item" aria-current={here ? (pathname === pathOf(href) ? "page" : "true") : undefined}>
                  {entry.label}
                </Link>
              ) : (
                <span className="menu__item is-soon" aria-disabled="true">
                  {`${entry.label} `}
                  <span className="soon">soon</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * The header of every page of a network: logo, network switch, navigation, search box, theme toggle. In the sandbox a "Testnet" badge follows the
 * logo, from the root's environment (`useEnvironment()`) so that the pages with no `/:net` data have it too; it has no tooltip, which is out of reach
 * by keyboard and touch. On a phone the navigation folds into a menu button and the logo's name goes, the mark, the badge and the switch stay; the fold closes when the location's pathname
 * or search changes, as a menu's panel does (`useDisclosureMenu`), so that it does not stay open over the new page. `search={false}` leaves the box out, for the home page, whose hero has its own.
 */
export function Header({ net, search = true }: { net: NetworkBrief; search?: boolean }) {
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const features = useFeatures();
  const { pathname, search: query } = useLocation();
  const section = navSectionOf(useMatches());
  const testnet = networkKindOf(useEnvironment()) === "testnet";
  // The first run is the page as the server drew it, closed: setting false again changes nothing.
  useEffect(() => setMenuOpen(false), [pathname, query]);

  return (
    <header className="hdr">
      <div className="container hdr__inner">
        <div className="hdr__brandgroup">
          <Link to={`/${net.id}`} className="hdr__brand" aria-label={`${PRODUCT_NAME} home`}>
            <LogoMark />
            <span className="hdr__name">{PRODUCT_NAME}</span>
          </Link>
          {testnet && (
            <Pill tone="testnet" icon={null}>
              Testnet
            </Pill>
          )}
        </div>
        <NetworkSwitch net={net.id} />
        <nav id={menuId} className={cx("hdr__nav", menuOpen && "is-open")} aria-label="Main">
          <ul>
            {NAV.map((item) => {
              if ("items" in item) {
                return (
                  <li key={item.label}>
                    <NavMenu item={item} net={net} section={section} pathname={pathname} />
                  </li>
                );
              }
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
