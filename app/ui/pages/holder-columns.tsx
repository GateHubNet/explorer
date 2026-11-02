// The holders' table the token page and the holders' page share (E11 spec 3.1 and 4): a rank, the holder, the balance and the share of the supply as a meter beside its percent; the holders'
// page adds the holder's limit and a status column. Browser code: it imports nothing of the Worker (test/unit/token-bundle.test.ts). A file of its own, so that the token list, which draws
// neither the meter nor an account in a holder's cell, does not carry it.

import type { HolderRowView } from "../../server/token-view";
import { Meter } from "../charts/Meter";
import { AccountLink } from "../components/AccountLink";
import type { Column } from "../components/DataTable";
import { AlertCircleIcon, CheckCircleIcon } from "../components/status-icons";
import type { NetworkInfo } from "../networks";

/** Frozen: an icon and the word (a status is never a colour alone). */
const Frozen = () => (
  <span className="st st--quiet">
    <AlertCircleIcon />
    Frozen
  </span>
);

/** Authorized: the issuer approved the line (it requires approval of each). An icon and the word. */
const Authorized = () => (
  <span className="st st--ok">
    <CheckCircleIcon />
    Authorized
  </span>
);

/** The status of a line: what the issuer did to it, in words; a dash, and "none" for a screen reader, for a line it did nothing to. */
function Status({ row }: { row: HolderRowView }) {
  if (!row.frozen && !row.authorized) {
    return (
      <span className="faint">
        —<span className="sr">none</span>
      </span>
    );
  }
  return (
    <span className="token-page__statuses">
      {row.frozen && <Frozen />}
      {row.authorized && <Authorized />}
    </span>
  );
}

/** The width below which the top holders' table scrolls inside its card: its tracks, their gaps and the card's padding. */
export const HOLDERS_WIDTH = 36 + 260 + 170 + 220 + 3 * 16 + 2 * 16;
/** The same for the holders' page's table, with Limit and Status. */
export const ALL_HOLDERS_WIDTH = 36 + 260 + 170 + 220 + 140 + 150 + 5 * 16 + 2 * 16;

/**
 * The columns of a holders table. Without `all` (the token page's top holders) a frozen line is tagged beside its holder; with it (the holders' page) the holder's cell is the holder alone
 * and the line's limit and status are columns of their own.
 */
export function holderColumns(net: NetworkInfo["id"], code: string, { all }: { all: boolean }): Column<HolderRowView>[] {
  const columns: Column<HolderRowView>[] = [
    { id: "rank", header: "#", width: "36px", align: "end", cell: (row) => <span className="mono num faint tokens__rank">{row.rank}</span> },
    {
      id: "holder",
      header: "Holder",
      width: "minmax(260px, 2fr)",
      cell: (row) => (
        <span className="token-page__holder">
          <AccountLink net={net} address={row.holder} />
          {!all && row.frozen && <Frozen />}
        </span>
      ),
    },
    { id: "balance", header: `Balance (${code})`, width: "minmax(170px, 1fr)", align: "end", cell: (row) => <span className="mono num">{row.balance}</span> },
    {
      id: "share",
      header: "Share of supply",
      width: "minmax(220px, 1.3fr)",
      cell: (row) => (
        <span className="token-page__share">
          <span className="token-page__meter">
            <Meter data={row.meter} small decorative />
          </span>
          <span className="num">{row.share}</span>
        </span>
      ),
    },
  ];
  if (!all) return columns;
  return [
    ...columns,
    { id: "limit", header: "Limit", width: "minmax(140px, 1fr)", align: "end", cell: (row) => <span className="mono num">{row.limit}</span> },
    { id: "status", header: "Status", width: "minmax(150px, 0.8fr)", cell: (row) => <Status row={row} /> },
  ];
}
