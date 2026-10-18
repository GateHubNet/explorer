import { Link } from "react-router";

import { formatAmount, formatUtc } from "../../domain/format";
import type { SearchPageData } from "../../server/search-view";
import { ArrowRightIcon } from "../components/icons";
import { TypeTag } from "../components/TypeTag";
import type { NetworkBrief } from "../networks";

type Choice = Extract<SearchPageData, { kind: "choice" }>;

/**
 * A hash that is a transaction and also a ledger (spec 6): the two places it leads to, with enough of each to choose. The
 * links are the rows of the search hints (`hits`), so the choice looks like the box that led here.
 */
export function SearchChoicePage({ net, data }: { net: NetworkBrief; data: Choice }) {
  const { hash, tx, ledger } = data;
  return (
    <div className="choice">
      <h1>Transaction or ledger?</h1>
      <p>
        This hash is both a transaction and a ledger on {net.name}. Which one do you want?
      </p>
      <p className="mono choice__hash">{hash}</p>
      <ul className="hits" aria-label="Matches">
        <li>
          <Link to={`/${net.id}/tx/${hash}`} className="hit">
            <TypeTag type="Transaction" />
            <span className="hit__detail">
              {tx.type} in ledger #{formatAmount(String(tx.ledgerIndex))}
            </span>
            <ArrowRightIcon className="hit__go" />
          </Link>
        </li>
        <li>
          <Link to={`/${net.id}/ledger/${hash}`} className="hit">
            <TypeTag type="Ledger" />
            <span className="hit__detail">
              #{formatAmount(String(ledger.index))}, closed {formatUtc(ledger.closeTime)}
            </span>
            <ArrowRightIcon className="hit__go" />
          </Link>
        </li>
      </ul>
    </div>
  );
}
