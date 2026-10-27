import { Link } from "react-router";

import { formatAmount, formatUtc } from "../../domain/format";
import type { SearchPageData } from "../../server/search-view";
import { ArrowRightIcon } from "../components/icons";
import { TypeTag } from "../components/TypeTag";
import type { NetworkBrief } from "../networks";

type Choice = Extract<SearchPageData, { kind: "choice" }>;

/** What the hash is, in the order of the rows: "transaction", "ledger" and the network's word for its token ("NFT", "URIToken"). */
function nounsOf({ tx, ledger, nft }: Choice): string[] {
  return [tx && "transaction", ledger && "ledger", nft?.token].filter((noun): noun is string => typeof noun === "string");
}

/** "Transaction or ledger", "Transaction, ledger or NFT": what the choice is between, as the title of the page and (with a question mark) its heading. */
export function choiceTitle(data: Choice): string {
  const nouns = nounsOf(data);
  const last = nouns.pop()!;
  const list = nouns.length === 0 ? last : `${nouns.join(", ")} or ${last}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}`;
}

/** "both a transaction and an NFT", "a transaction, a ledger and an NFT": what the hash is, as a phrase. */
function whatItIs(data: Choice): string {
  const things = nounsOf(data).map((noun) => `${noun === "NFT" ? "an" : "a"} ${noun}`);
  const last = things.pop()!;
  if (things.length === 0) return last;
  return things.length === 1 ? `both ${things[0]} and ${last}` : `${things.join(", ")} and ${last}`;
}

/**
 * A hash that is two or three of a transaction, a ledger and an NFT (a URIToken on Xahau; spec 6, NFT spec 7): the places it leads to, with enough of each to choose. The
 * links are the rows of the search hints (`hits`), so the choice looks like the box that led here; a burned NFT says "burned" in a tag, in words.
 */
export function SearchChoicePage({ net, data }: { net: NetworkBrief; data: Choice }) {
  const { hash, tx, ledger, nft } = data;
  return (
    <div className="choice">
      <h1>{choiceTitle(data)}?</h1>
      <p>
        This hash is {whatItIs(data)} on {net.name}. Which one do you want?
      </p>
      <p className="mono choice__hash">{hash}</p>
      <ul className="hits" aria-label="Matches">
        {tx && (
          <li>
            <Link to={`/${net.id}/tx/${hash}`} className="hit">
              <TypeTag type="Transaction" />
              <span className="hit__detail">
                {tx.type} in ledger #{formatAmount(String(tx.ledgerIndex))}
              </span>
              <ArrowRightIcon className="hit__go" />
            </Link>
          </li>
        )}
        {ledger && (
          <li>
            <Link to={`/${net.id}/ledger/${hash}`} className="hit">
              <TypeTag type="Ledger" />
              <span className="hit__detail">
                #{formatAmount(String(ledger.index))}, closed {formatUtc(ledger.closeTime)}
              </span>
              <ArrowRightIcon className="hit__go" />
            </Link>
          </li>
        )}
        {nft && (
          <li>
            <Link to={`/${net.id}/nft/${hash}`} className="hit">
              <TypeTag type={nft.token} />
              <span className="hit__detail">{nft.detail}</span>
              {nft.burned && <span className="tag">burned</span>}
              <ArrowRightIcon className="hit__go" />
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
