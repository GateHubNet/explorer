import { Link } from "react-router";

import { formatAmount } from "../../domain/format";
import { cx } from "../cx";

export interface MptAmountProps {
  /** The issuance ID, in capitals. */
  id: string;
  /** The integer units the ledger holds, as text. */
  units: string;
  /** The issuer, for the title: "MPT {ID} issued by {issuer}". */
  issuer?: string;
  /** The units scaled by the issuance's asset scale (`resolveMpt`), as text; left out while the issuance is not looked up, and above scale 19. */
  value?: string;
  /** The issuance's ticker (the issuer's own text, unchecked: React text only). */
  ticker?: string;
  /** Where the issuance's page is (`mptLink`); null while `MPT` is off, as no link at all. */
  href?: string | null;
  /** A change, as `Amount` has it: a gain gets a plus sign and the success colour (`amt amt--pos`), a loss keeps its minus. */
  signed?: boolean;
}

/**
 * An amount of a Multi-Purpose Token. With `value` (the lookup scaled it): the value through `formatAmount`, then the ticker or "units" ("1,240,000.00 HTF"). Without (the lookup did not
 * answer, answered bare, or found a scale above 19, or the page makes none: the home and the ledger page poll): the integer units as the issuance holds them, in groups of three and never
 * scaled, then the first 8 hex digits of the issuance ID ("2,500,000 units of MPT 0000012A…"). The title says "MPT {ID}", with the issuer when it is known. `href` makes the last word (the
 * ticker, "units", or the ID) a link to the issuance's page. The words are mono, as an amount is, and the link is underlined, because it stands in a sentence and its colour alone would not
 * tell it. `signed` is for a change (a row of a table), as `Amount`'s is.
 */
export function MptAmount({ id, units, issuer, value, ticker, href, signed }: MptAmountProps) {
  const title = issuer === undefined ? `MPT ${id}` : `MPT ${id} issued by ${issuer}`;
  const last = (words: string) => (href === undefined || href === null ? words : <Link to={href}>{words}</Link>);
  const shown = formatAmount(value ?? units);
  const gain = signed === true && !shown.startsWith("−") && /[1-9]/.test(shown);
  return (
    <span className={cx("mptamount mono", signed && "amt", gain && "amt--pos")} title={title}>
      {gain ? "+" : ""}
      {value === undefined ? (
        <>
          {shown} units of MPT {last(`${id.slice(0, 8)}…`)}
        </>
      ) : (
        <>
          {shown} {last(ticker ?? "units")}
        </>
      )}
    </span>
  );
}
