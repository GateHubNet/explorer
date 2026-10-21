import { Link } from "react-router";

import { ammListPath } from "../../domain/amm-params";
import type { NoAmmPageData } from "../../server/amm-view";
import { icon } from "../components/icons";

/** Two coins side by side, the board's mark of a pool (decorative: the heading says it). A `<g>`, not a fragment (status-icons.tsx says why). */
const PoolIcon = icon(
  <g>
    <circle cx="8" cy="12" r="5" />
    <circle cx="16" cy="12" r="5" />
  </g>,
  { strokeWidth: 1.6, size: 36 },
);

/**
 * `/xahau/amm` (spec 1.3 and 2.1): the AMM pools heading over the board's card in place of the list, since the AMM amendment is not part of
 * Xahau. "See Xahau markets →" is a link while the markets pages are on (`marketsHref`, E3's) and the header's "soon" style while they are off;
 * "Switch to XRPL pools" leads to the XRPL list. Takes the view builder's data (`noAmmPage`) and never fetches.
 */
export function NoAmmPage({ data }: { data: NoAmmPageData }) {
  return (
    <div className="amm">
      <div className="amm__head">
        <h1 className="amm__title">AMM pools</h1>
        <p className="amm__intro">Automated market maker pools.</p>
      </div>
      <section className="card amm__none" aria-labelledby="amm-none-title">
        <PoolIcon className="amm__none-icon" />
        <h2 id="amm-none-title" className="amm__none-title">
          Xahau has no AMM
        </h2>
        <p className="amm__none-text">The AMM amendment is not part of Xahau, so there are no pools to show. Trades on Xahau are order-book crossings.</p>
        <div className="amm__none-links">
          {data.marketsHref !== null ? (
            <Link to={data.marketsHref}>See Xahau markets →</Link>
          ) : (
            <span className="nav-item is-soon" aria-disabled="true">
              <span>See Xahau markets →</span>
              <span className="soon">soon</span>
            </span>
          )}
          <Link to={ammListPath("xrpl")}>Switch to XRPL pools</Link>
        </div>
      </section>
    </div>
  );
}
