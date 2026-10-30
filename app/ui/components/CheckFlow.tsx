import type { NetworkId } from "../../server/networks";
import { AccountLink } from "./AccountLink";
import { ArrowRightIcon } from "./icons";

/** The words the check page writes into the three nodes (spec 4.3); this draws them. */
export interface CheckFlowData {
  /** The account that wrote the check, and what it pays: "Pays when the check is cashed", "−{delivered}", "Paid nothing". */
  source: { account: string; line: string };
  /** The check itself: "Check · expires {day}" (or "cashed", "cancelled", "expired"), "up to {SendMax}", and the issuer of a token's SendMax. */
  check: { title: string; line: string; issuer?: string };
  /** The account that can cash it, its destination tag if it has one, and what it can do: "Can cash up to …", "+{delivered}", "Received nothing", "Can no longer cash it". */
  destination: { account: string; tag?: number; line: string };
}

/** The arrow between two nodes: the flow's own, which points down when the nodes wrap on a narrow screen. A screen reader skips it. */
function Arrow() {
  return (
    <div className="flow__arrow" aria-hidden="true">
      <ArrowRightIcon size={22} />
    </div>
  );
}

/**
 * Where a check's money would go, in three boxes joined by two arrows: the source, the check, the destination, on the styles of the transaction page's flow (`Flow`). The check's box
 * is set apart as a pool's is. Every account is an `AccountLink`, the issuer too: it is named and marked as the page's names say, and the page collects its address for them. The
 * issuer is in the words "issued by", so its link is underlined (`.checkflow__issuer`); the two ends stand alone in their boxes, which is `.flow__node > a`'s 44 px target.
 */
export function CheckFlow({ net, flow }: { net: NetworkId; flow: CheckFlowData }) {
  const { source, check, destination } = flow;
  return (
    <div className="flow checkflow" role="group" aria-label="Flow of the check">
      <div className="flow__node">
        <span className="flow__label">Source</span>
        <AccountLink net={net} address={source.account} />
        <span className="flow__sub">{source.line}</span>
      </div>
      <Arrow />
      <div className="flow__node flow__node--via">
        <span className="flow__label">{check.title}</span>
        <span className="flow__amount">{check.line}</span>
        {check.issuer !== undefined && (
          <span className="flow__sub checkflow__issuer">
            issued by <AccountLink net={net} address={check.issuer} />
          </span>
        )}
      </div>
      <Arrow />
      <div className="flow__node">
        <span className="flow__label">{destination.tag === undefined ? "Destination" : `Destination · tag ${destination.tag}`}</span>
        <AccountLink net={net} address={destination.account} />
        <span className="flow__sub">{destination.line}</span>
      </div>
    </div>
  );
}
