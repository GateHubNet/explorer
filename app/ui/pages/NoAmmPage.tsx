import { Link } from "react-router";

import { ammListPath } from "../../domain/amm-params";
import type { NoAmmPageData } from "../../server/amm-view";
import { icon } from "../components/icons";
import { findNetwork } from "../networks";
import { useNetwork } from "../use-network";

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
 * "Switch to XRPL pools" leads to the other network's list. The network is the layout's (`useNetwork()`), so the sandbox says "Xahau Testnet" and
 * "XRPL Testnet". Takes the view builder's data (`noAmmPage`) and never fetches.
 */
export function NoAmmPage({ data }: { data: NoAmmPageData }) {
  const network = useNetwork();
  const other = findNetwork(network.other, network.kind);
  return (
    <div className="amm">
      <div className="amm__head">
        <h1 className="amm__title">AMM pools</h1>
        <p className="amm__intro">Automated market maker pools.</p>
      </div>
      <section className="card amm__none" aria-labelledby="amm-none-title">
        <PoolIcon className="amm__none-icon" />
        <h2 id="amm-none-title" className="amm__none-title">
          {`${network.name} has no AMM`}
        </h2>
        <p className="amm__none-text">
          {`The AMM amendment is not part of ${network.name}, so there are no pools to show. Trades on ${network.name} are order-book crossings.`}
        </p>
        <div className="amm__none-links">
          {data.marketsHref !== null ? (
            <Link to={data.marketsHref}>{`See ${network.name} markets →`}</Link>
          ) : (
            <span className="nav-item is-soon" aria-disabled="true">
              <span>{`See ${network.name} markets →`}</span>
              <span className="soon">soon</span>
            </span>
          )}
          <Link to={ammListPath(other.id)}>{`Switch to ${other.name} pools`}</Link>
        </div>
      </section>
    </div>
  );
}
