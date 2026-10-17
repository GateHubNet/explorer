import { Link } from "react-router";

import type { Segment } from "../../domain/describe";
import type { NetworkId } from "../../server/networks";
import { AccountLink } from "./AccountLink";
import { Amount } from "./Amount";

/**
 * The segments of `describe().sentence` (or a detail's value) as the page shows them: text as it is, an account as a chip
 * linking to its page, an amount through `Amount`, and a pool as a chip with its pair linking to the pool's account.
 * Put it in the element the sentence belongs in (`<p className="sentence">`, a table cell).
 */
export function Sentence({ net, segments }: { net: NetworkId; segments: readonly Segment[] }) {
  return (
    <>
      {segments.map((segment, index) => {
        switch (segment.t) {
          case "text":
            return segment.v;
          case "account":
            return <AccountLink key={index} net={net} address={segment.v} variant="chip" />;
          case "amount":
            return <Amount key={index} value={segment.value} currency={segment.currency} issuer={segment.issuer} />;
          case "pool":
            return (
              <Link key={index} to={`/${net}/account/${segment.v}`} className="ent" title={`AMM pool ${segment.v}`}>
                {segment.pair}
              </Link>
            );
        }
      })}
    </>
  );
}
