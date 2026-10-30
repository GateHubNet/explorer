import { Link } from "react-router";

import { formatAmount } from "../../domain/format";

/**
 * An amount of a Multi-Purpose Token, as little as an escrow of one needs (ledger object pages, decision 14): the integer value as the issuance holds it, in groups of three
 * and never scaled, then the first 8 hex digits of the issuance ID, the whole ID on hover. `href` makes the ID a link; it is left out until the MPT page exists. The words
 * are mono, as an amount is, and the link is underlined, because it stands in a sentence ("2,500,000 units of MPT 0000012A…") and its colour alone would not tell it.
 *
 * E14 extends this: the scale, the ticker, and the link from its `mptLink`.
 */
export function MptAmount({ id, units, href }: { id: string; units: string; href?: string }) {
  const short = `${id.slice(0, 8)}…`;
  return (
    <span className="mptamount mono" title={id}>
      {formatAmount(units)} units of MPT {href === undefined ? short : <Link to={href}>{short}</Link>}
    </span>
  );
}
