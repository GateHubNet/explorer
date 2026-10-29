import { Link } from "react-router";

import { shortAddress } from "../../domain/format";
import { linkTextOf, nameTitleOf } from "../../domain/names";
import type { NetworkId } from "../../server/networks";
import { cx } from "../cx";
import { useNameOf } from "../names";
import { LabelMark, NameMark } from "./NameMark";

/**
 * A link to an account's page on `net`. Shortened (`rJF2Xa…fQvg`) with the whole address on hover, unless `full`.
 * `chip` is the boxed form the transaction sentence uses.
 *
 * With a name in the page's names (`NamesProvider`) the link reads the name instead of the address, with the mark that says how the name is known and,
 * for a labelled account, the label's: "Northpeak Treasury" and a seal. Not mono, and cut by the stylesheet (never here) when it does not fit; the title
 * says how the name is known and the address. With `full` the whole address follows the name, inside the link. An account that has labels and no name is
 * its address as always, with the label's mark and the label words in the title. Any other account, and every account outside a provider, is as it
 * was before names.
 *
 * The marks follow the name after a space, as text: in the link's flex box the space is not drawn, and the link's name reads "Northpeak Treasury
 * verified name".
 */
export function AccountLink({
  net,
  address,
  full,
  variant = "plain",
}: {
  net: NetworkId;
  address: string;
  full?: boolean;
  variant?: "plain" | "chip";
}) {
  const view = useNameOf(address);
  const to = `/${net}/account/${address}`;
  const text = view ? linkTextOf(view) : "";

  if (view?.name && text !== "") {
    return (
      <Link to={to} className={cx("acct", variant === "chip" && "ent")} title={nameTitleOf(view, address)}>
        <span className="acct__name">{text}</span> <NameMark kind={view.name.kind} />
        {view.labels.length > 0 && (
          <>
            {" "}
            <LabelMark labels={view.labels} />
          </>
        )}
        {full && (
          <>
            {" "}
            <span className="acct__address mono">{address}</span>
          </>
        )}
      </Link>
    );
  }

  const label = full ? address : shortAddress(address);
  if (view && view.labels.length > 0) {
    return (
      <Link to={to} className={cx("mono", variant === "chip" && "ent")} title={nameTitleOf(view, address)}>
        {label} <LabelMark labels={view.labels} />
      </Link>
    );
  }
  return (
    <Link to={to} className={cx("mono", variant === "chip" && "ent")} title={label === address ? undefined : address}>
      {label}
    </Link>
  );
}
