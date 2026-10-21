import { Link } from "react-router";

import type { Segment } from "../../domain/describe";
import { poolLink } from "../../domain/pool-link";
import type { NetworkId } from "../../server/networks";
import { useFeatures } from "../use-network";
import { AccountLink } from "./AccountLink";
import { Amount } from "./Amount";

/**
 * The segments of `describe().sentence` (or a detail's value) as the page shows them: text as it is, an account as a chip
 * linking to its page, an amount through `Amount`, and a pool as a chip with its pair linking to the pool (`poolLink`: its page
 * while `AMM_PAGES` is on, its account's otherwise). Put it in the element the sentence belongs in (`<p className="sentence">`, a
 * table cell). `compact` is for a table's cell: accounts and pools are plain links, without the chip's box, so that more of the
 * sentence fits on its one line.
 */
export function Sentence({ net, segments, compact }: { net: NetworkId; segments: readonly Segment[]; compact?: boolean }) {
  const features = useFeatures();
  return (
    <>
      {segments.map((segment, index) => {
        switch (segment.t) {
          case "text":
            return segment.v;
          case "account":
            return <AccountLink key={index} net={net} address={segment.v} variant={compact ? "plain" : "chip"} />;
          case "amount":
            return <Amount key={index} value={segment.value} currency={segment.currency} issuer={segment.issuer} />;
          case "pool":
            return (
              <Link key={index} to={poolLink(net, segment.v, features)} className={compact ? "mono" : "ent"} title={`AMM pool ${segment.v}`}>
                {segment.pair}
              </Link>
            );
        }
      })}
    </>
  );
}
