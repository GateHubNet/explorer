import { Link } from "react-router";

import { formatAmount, shortHash } from "../../domain/format";
import type { NetworkId } from "../../server/networks";

/** A link to a transaction (`kind="tx"`) or a ledger (`kind="ledger"`) by hash: shortened with the whole hash on hover, unless `full`. */
export function HashLink({
  net,
  kind,
  hash,
  full,
}: {
  net: NetworkId;
  kind: "tx" | "ledger";
  hash: string;
  full?: boolean;
}) {
  const label = full ? hash : shortHash(hash);
  return (
    <Link to={`/${net}/${kind}/${hash}`} className="mono" title={label === hash ? undefined : hash}>
      {label}
    </Link>
  );
}

/** A link to a ledger by index: `#107,695,660`. */
export function LedgerLink({ net, index }: { net: NetworkId; index: number | string }) {
  return (
    <Link to={`/${net}/ledger/${index}`} className="mono num">
      #{formatAmount(String(index))}
    </Link>
  );
}
