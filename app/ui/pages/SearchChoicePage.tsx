import { Link } from "react-router";

import { formatAmount, formatUtc } from "../../domain/format";
import { capitalized, joinNouns } from "../../domain/hash-nouns";
import type { SearchPageData } from "../../server/search-view";
import { ArrowRightIcon } from "../components/icons";
import { TypeTag } from "../components/TypeTag";
import type { NetworkBrief } from "../networks";

type Choice = Extract<SearchPageData, { kind: "choice" }>;

/** What the hash is, in the order of the rows: "transaction", "ledger", the network's word for its token ("NFT", "URIToken") and the object's ("escrow", "check", "payment channel", "delegation"). */
function nounsOf({ tx, ledger, nft, object }: Choice): string[] {
  return [tx && "transaction", ledger && "ledger", nft?.token, object?.noun].filter((noun): noun is string => typeof noun === "string");
}

/** "an" before the nouns that start with a vowel sound ("an NFT", "an escrow"), "a" before any other ("a URIToken", "a check"). */
const articleOf = (noun: string): string => (noun === "NFT" || noun === "escrow" ? "an" : "a");

/** "Transaction or ledger", "Transaction, ledger or NFT": what the choice is between, as the title of the page and (with a question mark) its heading. */
export function choiceTitle(data: Choice): string {
  return capitalized(joinNouns(nounsOf(data)));
}

/** "both a transaction and an NFT", "a transaction, a ledger and an NFT": what the hash is, as a phrase. */
function whatItIs(data: Choice): string {
  const things = nounsOf(data).map((noun) => `${articleOf(noun)} ${noun}`);
  const last = things.pop()!;
  if (things.length === 0) return last;
  return things.length === 1 ? `both ${things[0]} and ${last}` : `${things.join(", ")} and ${last}`;
}

/**
 * A hash that is two or more of a transaction, a ledger, an NFT (a URIToken on Xahau) and an escrow, a check, a payment channel or a delegation (spec 6, NFT spec 7, ledger object pages
 * spec 8): the places it leads to, with enough of each to choose. The links are the rows of the search hints (`hits`), so the choice looks like the box that led here; a burned NFT and a
 * removed object say "burned" and "removed" in a tag, in words. The object's row leads where the server says (`object.href`: a delegation goes to its delegator's account).
 */
export function SearchChoicePage({ net, data }: { net: NetworkBrief; data: Choice }) {
  const { hash, tx, ledger, nft, object } = data;
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
        {object && (
          <li>
            <Link to={object.href} className="hit">
              <TypeTag type={capitalized(object.noun)} />
              <span className="hit__detail">{object.detail}</span>
              {object.removed && <span className="tag">removed</span>}
              <ArrowRightIcon className="hit__go" />
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
