import { Link } from "react-router";

import { formatAmount } from "../../domain/format";
import { nftLink } from "../../domain/nft-link";
import { shortNftId } from "../../domain/nft-params";
import type { NetworkId } from "../../server/networks";
import { useFeatures } from "../use-network";

/**
 * An NFT as a link to its page (`nftLink`: the page while NFTS is on, plain text while it is off). Its text is "#4,127" when the NFT's `serial` is known (XRPL), else the
 * id shortened (`00081388…B54B`, in mono, as Xahau's URITokens have no serial); the full id is the `title` either way.
 */
export function NftLink({ net, id, serial }: { net: NetworkId; id: string; serial?: number }) {
  const href = nftLink(net, id, useFeatures());
  const className = serial === undefined ? "mono" : "num";
  const text = serial === undefined ? shortNftId(id) : `#${formatAmount(String(serial))}`;
  return href === null ? (
    <span className={className} title={id}>
      {text}
    </span>
  ) : (
    <Link to={href} className={className} title={id}>
      {text}
    </Link>
  );
}
