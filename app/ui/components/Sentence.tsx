import type { ReactElement } from "react";
import { Link } from "react-router";

import type { Segment } from "../../domain/describe";
import { objectHref } from "../../domain/object-href";
import { permissionTitle } from "../../domain/permission-chip";
import { poolLink } from "../../domain/pool-link";
import type { NetworkId } from "../../server/networks";
import { useFeatures } from "../use-network";
import { AccountLink } from "./AccountLink";
import { Amount } from "./Amount";
import { MptAmount } from "./MptAmount";
import { NftLink } from "./NftLink";
import { PermissionChip } from "./PermissionChip";

/**
 * The segments of `describe().sentence` (or a detail's value) as the page shows them: text as it is, an account as a chip
 * linking to its page, an amount through `Amount`, a pool as a chip with its pair linking to the pool (`poolLink`: its page
 * while `AMM_PAGES` is on, its account's otherwise), an NFT through `NftLink` (its page while `NFTS` is on, its short id in
 * mono otherwise), a permission of a delegation through `PermissionChip`, and an escrow, a check or a payment channel as its
 * words linking to its page (`objectHref`: while `LEDGER_OBJECTS` is on; its ID, when it is named by one, as the title), the
 * words as text otherwise, and an MPT as `MptAmount` (units of the issuance and its ID, raw: the scale and the link come with the lookup) or, without units, a reference to
 * the issuance as text ("MPT 0000012A…"). Put it in the element the sentence belongs in (`<p className="sentence">`, a table cell).
 * `compact` is for a table's cell: accounts and pools are plain links, without the chip's box, so that more of the sentence
 * fits on its one line.
 */
export function Sentence({ net, segments, compact }: { net: NetworkId; segments: readonly Segment[]; compact?: boolean }) {
  const features = useFeatures();
  return (
    <>
      {segments.map((segment, index): ReactElement | string => {
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
          case "nft":
            return <NftLink key={index} net={net} id={segment.v} serial={segment.serial} />;
          case "permission":
            return <PermissionChip key={index} chip={{ name: segment.name, kind: segment.kind, words: segment.words, title: permissionTitle(segment.kind, segment.words) }} />;
          case "object": {
            const href = objectHref(net, segment.kind, segment.ref, features);
            return href === null ? (
              segment.v
            ) : (
              <Link key={index} to={href} className="objectlink" title={"id" in segment.ref ? segment.ref.id : undefined}>
                {segment.v}
              </Link>
            );
          }
          case "mpt":
            return segment.units === undefined ? `MPT ${segment.id.slice(0, 8)}…` : <MptAmount key={index} id={segment.id} units={segment.units} />;
        }
      })}
    </>
  );
}
