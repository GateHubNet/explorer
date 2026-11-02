import { Link } from "react-router";

import { formatAmount, shortHash } from "../../domain/format";
import type { NetworkId } from "../../server/networks";

/**
 * A link to a transaction (`kind="tx"`) or a ledger (`kind="ledger"`) by hash: shortened with the whole hash on hover, unless `full`. `label` is a longer name for a screen
 * reader ("EscrowFinish transaction 67F91E…7C31": the board's `aria-label`) where a bare hash says nothing of what it leads to; it must hold the text the link shows (WCAG 2.5.3).
 */
export function HashLink({
  net,
  kind,
  hash,
  full,
  label,
}: {
  net: NetworkId;
  kind: "tx" | "ledger";
  hash: string;
  full?: boolean;
  label?: string;
}) {
  const shown = full ? hash : shortHash(hash);
  return (
    <Link to={`/${net}/${kind}/${hash}`} className="mono" title={shown === hash ? undefined : hash} aria-label={label}>
      {shown}
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
