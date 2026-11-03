// The holders' and the transfers' tables the MPT page and its holders' and transfers' pages share (E14 spec 3.1 and 3.4). Browser code: it imports nothing of the Worker at run time
// (test/unit/mpt-bundle.test.ts). A file of its own, so that the pages that draw neither the meter nor an account in a cell (the token list) do not carry it.

import type { MptHead, MptHolderRow, MptTransferRow } from "../../server/mpt-view";
import { Meter } from "../charts/Meter";
import { AccountLink } from "../components/AccountLink";
import type { Column } from "../components/DataTable";
import { HashLink } from "../components/HashLink";
import { Pill } from "../components/Pill";
import { WhenText } from "../components/WhenCell";
import { cx } from "../cx";
import type { NetworkInfo } from "../networks";

/** What the "Locked" pill says when it is hovered: what a locked balance is. A word of the page's, not the issuer's. */
const LOCKED_TITLE = "The issuer has locked this balance, so it cannot move.";

/** The state of a holder's balance in words: "Locked" (a pill, with its title) or "Can move". Never a colour alone. */
function BalanceState({ locked }: { locked: boolean }) {
  return locked ? (
    <span title={LOCKED_TITLE}>
      <Pill tone="warn" icon={null}>
        Locked
      </Pill>
    </span>
  ) : (
    <span className="muted">Can move</span>
  );
}

/** The width below which the holders table scrolls inside its card: its tracks, their gaps and the card's padding. */
export const MPT_HOLDERS_WIDTH = 36 + 260 + 170 + 220 + 140 + 4 * 16 + 2 * 16;
/** The same without the rank, for a page behind a marker (the API gives none). */
export const MPT_HOLDERS_UNRANKED_WIDTH = 260 + 170 + 220 + 140 + 3 * 16 + 2 * 16;
/** The width of the transfers table. */
export const MPT_TRANSFERS_WIDTH = 120 + 100 + 190 + 190 + 150 + 150 + 5 * 16 + 2 * 16;

/**
 * The columns of the holders' table: a rank (left out when no row has one: a page behind a marker), the holder, the balance in the token's units with what of it is in escrow under it, the
 * share of the outstanding amount (its text first, the decorative meter after it: the share is read once) and the balance's state. The balance of a row is `amount` and `escrowed_amount` together.
 */
export function mptHolderColumns(net: NetworkInfo["id"], head: Pick<MptHead, "amountWord">, { ranked }: { ranked: boolean }): Column<MptHolderRow>[] {
  const columns: Column<MptHolderRow>[] = [
    {
      id: "holder",
      header: "Holder",
      width: "minmax(260px, 2fr)",
      cell: (row) => <AccountLink net={net} address={row.holder} />,
    },
    {
      id: "balance",
      header: `Balance (${head.amountWord})`,
      width: "minmax(170px, 1fr)",
      align: "end",
      cell: (row) => (
        <span className="mpt__balance">
          <span className="mono num">{row.balance}</span>
          {row.escrow !== null && <span className="faint mpt__escrow">{row.escrow}</span>}
        </span>
      ),
    },
    {
      id: "share",
      header: "Share of outstanding",
      width: "minmax(220px, 1.3fr)",
      cell: (row) => (
        <span className="token-page__share">
          <span className="num">{row.share}</span>
          <span className="token-page__meter">
            <Meter data={row.meter} small decorative />
          </span>
        </span>
      ),
    },
    { id: "state", header: "Balance state", width: "minmax(140px, 0.7fr)", cell: (row) => <BalanceState locked={row.locked} /> },
  ];
  if (!ranked) return columns;
  return [{ id: "rank", header: "#", width: "36px", align: "end", cell: (row) => <span className="mono num faint tokens__rank">{row.rank}</span> }, ...columns];
}

/** The columns of the transfers' table: when (UTC), the kind, from, to ("every holder" for a lock or an unlock of all of them), the amount (a lock's muted) and the transaction. */
export function mptTransferColumns(net: NetworkInfo["id"], head: Pick<MptHead, "amountWord">): Column<MptTransferRow>[] {
  const party = (address: string | null) => (address === null ? <span className="faint">—</span> : <AccountLink net={net} address={address} />);
  return [
    { id: "time", header: "Time (UTC)", width: "120px", cell: (row) => <WhenText time={row.time} /> },
    { id: "kind", header: "Kind", width: "100px", cell: (row) => <span>{row.kind}</span> },
    { id: "from", header: "From", width: "minmax(190px, 1.3fr)", cell: (row) => party(row.from) },
    { id: "to", header: "To", width: "minmax(190px, 1.3fr)", cell: (row) => (row.everyHolder ? <span className="muted">every holder</span> : party(row.to)) },
    { id: "amount", header: `Amount (${head.amountWord})`, width: "minmax(150px, 1fr)", align: "end", cell: (row) => <span className={cx("mono num", row.muted && "muted")}>{row.amount}</span> },
    { id: "tx", header: "Transaction", width: "150px", cell: (row) => <HashLink net={net} kind="tx" hash={row.hash} /> },
  ];
}
