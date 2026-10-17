import { Link } from "react-router";

import { shortAddress } from "../../domain/format";
import type { NetworkId } from "../../server/networks";
import { cx } from "../cx";

/**
 * A link to an account's page on `net`. Shortened (`rJF2Xa…fQvg`) with the whole address on hover, unless `full`.
 * `chip` is the boxed form the transaction sentence uses.
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
  const label = full ? address : shortAddress(address);
  return (
    <Link
      to={`/${net}/account/${address}`}
      className={cx("mono", variant === "chip" && "ent")}
      title={label === address ? undefined : address}
    >
      {label}
    </Link>
  );
}
