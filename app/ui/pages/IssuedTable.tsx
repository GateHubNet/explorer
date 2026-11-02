import { Link } from "react-router";

import type { IssuedRowView } from "../../server/token-view";
import type { NetworkId } from "../../server/networks";
import { AccountLink } from "../components/AccountLink";
import { DataTable, type Column } from "../components/DataTable";
import { PairCoins } from "../components/PairCoins";
import { ListedMark } from "./token-parts";

/**
 * The token: its coin (decoration, `aria-hidden`: the code is said beside it), the display code with the toml's name under it, one link to the token's page. A code that has a hex
 * longer than the table shows carries it in the code's title and in words only a screen reader reads, which become part of the link's name. A row with no `href` (a code the page's path
 * cannot name) is the same as text.
 */
function TokenCell({ row }: { row: IssuedRowView }) {
  const body = (
    <>
      <PairCoins codes={[row.code]} />
      <span className="tokens__names">
        <span className="tokens__code" title={row.codeTitle}>
          {row.code}
        </span>
        {row.codeHidden !== undefined && <span className="sr">{`, ${row.codeHidden}`}</span>}
        {row.name !== undefined && <span className="tokens__name">{row.name}</span>}
      </span>
    </>
  );
  return row.href === null ? (
    <span className="tokens__token">{body}</span>
  ) : (
    <Link to={row.href} className="tokens__token">
      {body}
    </Link>
  );
}

// The board's columns, the price's 24 px wider than the board's so that a price of 8 significant digits below 0.0001 (`0.00000034303654`) holds on one line. `MIN_WIDTH` is the tracks at their least, the gaps (7 × 16 px) and the padding of a row (2 × 16 px), below which the table scrolls sideways inside its card.
const columns = (net: NetworkId, native: string): Column<IssuedRowView>[] => [
  { id: "rank", header: "#", width: "48px", align: "end", cell: (row) => <span className="mono num faint tokens__rank">{row.rank}</span> },
  { id: "token", header: "Token", width: "minmax(220px, 1.6fr)", cell: (row) => <TokenCell row={row} /> },
  { id: "issuer", header: "Issuer", width: "minmax(180px, 1.3fr)", cell: (row) => <AccountLink net={net} address={row.issuer} /> },
  { id: "holders", header: "Holders", width: "92px", align: "end", cell: (row) => <span className="mono num">{row.holders}</span> },
  { id: "supply", header: "Supply", width: "110px", align: "end", cell: (row) => <span className="mono num">{row.supply}</span> },
  { id: "price", header: `Price (${native})`, width: "136px", align: "end", cell: (row) => <span className="mono num">{row.price}</span> },
  { id: "volume", header: `Volume 24 h (${native})`, width: "128px", align: "end", cell: (row) => <span className="mono num">{row.volume}</span> },
  { id: "listed", header: "Listed in the issuer's toml", width: "120px", cell: (row) => <ListedMark listed={row.listed} /> },
];
const MIN_WIDTH = 48 + 220 + 180 + 92 + 110 + 136 + 128 + 120 + 7 * 16 + 2 * 16;

/**
 * The table of the issued tokens (spec 2.1), named `caption` for screen readers. `net` makes the issuer links, `native` the currency of the price and volume columns, `empty` is what a
 * table with no rows says. The names of the issuers are the page's (`NamesProvider`).
 */
export function IssuedTable({
  rows,
  caption,
  net,
  native,
  empty,
}: {
  rows: readonly IssuedRowView[];
  caption: string;
  net: NetworkId;
  native: string;
  empty: string | null;
}) {
  return <DataTable label={caption} columns={columns(net, native)} rows={rows} rowKey={(row) => row.key} minWidth={MIN_WIDTH} empty={empty ?? undefined} className="tokens__table" />;
}
