import { useId, useState } from "react";
import { Link } from "react-router";

import { PRODUCT_NAME } from "../brand";
import { LATEST_LEDGERS_ID, LATEST_TRANSACTIONS_ID } from "../anchors";
import { cx } from "../cx";
import type { NetworkBrief } from "../networks";
import { CloseIcon, LogoMark, MenuIcon } from "./icons";
import { NetworkSwitch } from "./NetworkSwitch";
import { SearchBox } from "./SearchBox";
import { ThemeToggle } from "./ThemeToggle";

type NavItem = { label: string; to?: (net: NetworkBrief) => string };

// Ledgers and Transactions lead to the home page's two lists. Network, Markets and AMM are the later sub-projects: labels with a "soon" tag.
const NAV: readonly NavItem[] = [
  { label: "Ledgers", to: (net) => `/${net.id}#${LATEST_LEDGERS_ID}` },
  { label: "Transactions", to: (net) => `/${net.id}#${LATEST_TRANSACTIONS_ID}` },
  { label: "Network" },
  { label: "Markets" },
  { label: "AMM" },
];

/**
 * The header of every page of a network: logo, network switch, navigation, search box, theme toggle. On a phone the
 * navigation folds into a menu button. `search={false}` leaves the box out, for the home page, whose hero has its own.
 */
export function Header({ net, search = true }: { net: NetworkBrief; search?: boolean }) {
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);

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
            {NAV.map((item) => (
              <li key={item.label}>
                {item.to ? (
                  <Link to={item.to(net)} className="nav-item">
                    {item.label}
                  </Link>
                ) : (
                  <span className="nav-item is-soon" aria-disabled="true">
                    <span>{item.label}</span>
                    <span className="soon">soon</span>
                  </span>
                )}
              </li>
            ))}
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
