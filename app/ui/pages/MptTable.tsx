import { Link } from "react-router";

import type { MptRowView } from "../../server/mpt-view";
import type { NetworkId } from "../../server/networks";
import { AccountLink } from "../components/AccountLink";
import { DataTable, type Column } from "../components/DataTable";
import { PairCoins } from "../components/PairCoins";
import { Pill } from "../components/Pill";

/**
 * The token: its coin (decoration, `aria-hidden`: the ticker is said beside it), the ticker with the name under it, one link to the issuance's page. An issuance with no ticker is the no-metadata
 * cell: "No metadata", and the start and end of its ID with the whole ID as the title. The ticker and the name are the issuer's own text: text here, and broken at the edge of the cell where they
 * have no space to break at (`.mpttab__code`, `.mpttab__name`). A row with no `href` (the switch is off) is the same as text.
 */
function TokenCell({ row }: { row: MptRowView }) {
  const body = (
    <>
      <PairCoins codes={[row.letter]} />
      <span className="tokens__names">
        {row.ticker === undefined ? (
          <>
            <span className="mpttab__code muted">No metadata</span>
            <span className="mpttab__id mono" title={`Issuance ID ${row.id}`}>
              {row.shortId}
            </span>
          </>
        ) : (
          <>
            <span className="mpttab__code">{row.ticker}</span>
            {row.name !== undefined && <span className="mpttab__name">{row.name}</span>}
          </>
        )}
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

/** The abilities the issuance has, as the board's pills in its order, each in a span with its title (the kit's `Pill` has none); a neutral pill with no icon says its word and nothing else. "none" where it has none. */
function FlagsCell({ flags }: { flags: MptRowView["flags"] }) {
  if (flags.length === 0) return <span className="faint">none</span>;
  return (
    <span className="mpttab__flags">
      {flags.map(({ label, title }) => (
        <span key={label} title={title}>
          <Pill icon={null}>{label}</Pill>
        </span>
      ))}
    </span>
  );
}

// The board's columns. `MIN_WIDTH` is the tracks at their least, the gaps (7 × 16 px) and the padding of a row (2 × 16 px), below which the table scrolls sideways inside its card.
const columns = (net: NetworkId): Column<MptRowView>[] => [
  { id: "rank", header: "#", width: "44px", align: "end", cell: (row) => <span className="mono num faint tokens__rank">{row.rank}</span> },
  { id: "token", header: "Token", width: "minmax(200px, 1.5fr)", cell: (row) => <TokenCell row={row} /> },
  { id: "issuer", header: "Issuer", width: "minmax(160px, 1.2fr)", cell: (row) => <AccountLink net={net} address={row.issuer} /> },
  { id: "holders", header: "Holders", width: "80px", align: "end", cell: (row) => <span className="mono num">{row.holders}</span> },
  { id: "outstanding", header: "Outstanding", width: "104px", align: "end", cell: (row) => <span className="mono num">{row.outstanding}</span> },
  {
    id: "max",
    header: "Max amount",
    width: "104px",
    align: "end",
    cell: (row) => (row.max === null ? <span className="faint">not set</span> : <span className="mono num">{row.max}</span>),
  },
  { id: "flags", header: "Flags", width: "minmax(190px, 1.5fr)", cell: (row) => <FlagsCell flags={row.flags} /> },
  { id: "transfers", header: "Transfers 24 h", width: "92px", align: "end", cell: (row) => <span className="mono num">{row.transfers}</span> },
];
const MIN_WIDTH = 44 + 200 + 160 + 80 + 104 + 104 + 190 + 92 + 7 * 16 + 2 * 16;

/**
 * The table of the MPT tab (E14 spec 4), named `caption` for screen readers. `net` makes the issuer links, `empty` is what a table with no rows says. The names of the issuers are the page's
 * (`NamesProvider`). It takes the rows the view builder wrote (`mptTokensTab`) and imports nothing of the Worker at run time.
 */
export function MptTable({ rows, caption, net, empty }: { rows: readonly MptRowView[]; caption: string; net: NetworkId; empty: string | null }) {
  return <DataTable label={caption} columns={columns(net)} rows={rows} rowKey={(row) => row.key} minWidth={MIN_WIDTH} empty={empty ?? undefined} className="tokens__table" />;
}
