import type { MptPageData } from "../../server/mpt-view";
import { Pill } from "./Pill";

/**
 * The Flags card's body (E14 spec 3.1, decision 3): the intro, then one row for each of the six abilities the issuer's issuance has now, in the board's order — its label, "Yes" or "No" in text (a
 * pill with a check for yes; a plain pill for no, so that the answer is never a colour alone) and the line that says what it means for this token. The words are the view builder's
 * (`mptPage`'s `flags`): the ticker is already in them. `locked` is no row, it is a notice above the figures.
 */
export function MptFlags({ flags }: { flags: MptPageData["flags"] }) {
  return (
    <div className="mptflags">
      <p className="mptflags__intro">{flags.intro}</p>
      <ul className="mptflags__list">
        {flags.rows.map((row) => (
          <li key={row.label} className="mptflags__row">
            <span className="mptflags__label">{row.label}</span>
            <Pill tone={row.yes ? "ok" : "neutral"} icon={row.yes ? undefined : null}>
              {row.yes ? "Yes" : "No"}
            </Pill>
            <span className="mptflags__line">{row.line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
