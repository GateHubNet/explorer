import { Link } from "react-router";

import { mptLink } from "../../domain/mpt-link";
import type { NetworkId } from "../../server/networks";
import { useFeatures } from "../use-network";

/**
 * A reference to an MPT issuance in words (a sentence that names the token, a balance change's currency): its ticker, else "MPT 0000012A…" (the first 8 digits), the whole ID in the title, and
 * a link to the issuance's page while `MPT` is on (`mptLink`); text while it is off or the page is not there. The ticker is the issuer's own text and unchecked: it is React text and nothing
 * more, never in an attribute. The link is underlined, because it stands in running words and its colour alone would not tell it.
 */
export function MptLink({ net, id, ticker }: { net: NetworkId; id: string; ticker?: string }) {
  const href = mptLink(net, id, useFeatures());
  const words = ticker ?? `MPT ${id.slice(0, 8)}…`;
  if (href === null) return <>{words}</>;
  return (
    <Link to={href} className="mptlink" title={`MPT ${id}`}>
      {words}
    </Link>
  );
}
