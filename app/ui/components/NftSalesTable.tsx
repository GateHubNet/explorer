import { Link } from "react-router";

import { nftWords, shortNftId } from "../../domain/nft-params";
import type { NftSaleRow } from "../../server/nfts-view";
import type { NetworkId } from "../../server/networks";
import { useNetwork } from "../use-network";
import { AccountLink } from "./AccountLink";
import { Amount } from "./Amount";
import { DataTable, type Column } from "./DataTable";
import { NftGlyph } from "./NftGlyph";
import { NftLink } from "./NftLink";
import { RelativeTime } from "./RelativeTime";
import { When } from "./WhenCell";

/** What a royalty that is not there is shown as: Xahau's always, and an XRPL sale that has no estimate. */
const DASH = "—";

/** The board's note under a table of sales, in each network's words: how a sale is told, and what the royalty is. */
const SALES_NOTES: Record<NetworkId, string> = {
  xrpl: "A brokered sale matches a sell and a buy offer; the broker keeps the difference. Royalty is the issuer’s transfer fee on the price, when the issuer is neither side.",
  xahau: "A sale is a URITokenBuy of a token offered for sale. URITokens carry no transfer fee, so there is no royalty.",
};

/** The note of the network: the words that stand under the recent sales and under the older ones. */
export function salesNote(net: NetworkId): string {
  return SALES_NOTES[net];
}

// The board's columns: the time 120 px so that the UTC date and the age hold on their lines, the NFT with its glyph and its short id under it, the collection, the price with its
// conversion under it, the two accounts, the mode, and the royalty. `MIN_WIDTH` is the tracks at their least, the gaps (6 × 16 px) and the padding of a row (2 × 16 px), below
// which the table scrolls sideways inside its card.
const MIN_WIDTH = 120 + 170 + 170 + 150 + 220 + 100 + 120 + 6 * 16 + 2 * 16;

function columns(net: NetworkId): Column<NftSaleRow>[] {
  const words = nftWords(net);
  return [
    {
      id: "time",
      header: "Time",
      width: "120px",
      // The UTC date and time link the transaction; the age is the browser's (the cached page cannot say it: it is printed empty).
      cell: (row) => (
        <span className="nfts__time">
          <When net={net} hash={row.txHash} time={row.time} />
          <RelativeTime at={row.time} className="faint nfts__age" />
        </span>
      ),
    },
    {
      id: "nft",
      header: words.token,
      width: "170px",
      // "#4,127" with the short id under it on XRPL; the short id alone on Xahau, whose URITokens have no serial.
      cell: (row) => (
        <span className="nfts__nft">
          <NftGlyph chars={row.nft.glyph} />
          <span className="nfts__ids">
            <NftLink net={net} id={row.nft.id} serial={row.nft.serial} />
            {row.nft.serial !== undefined && <span className="mono faint nfts__short">{shortNftId(row.nft.id)}</span>}
          </span>
        </span>
      ),
    },
    {
      id: "collection",
      header: "Collection",
      width: "minmax(170px, 1fr)",
      cell: (row) => (
        <Link to={row.collection.href} className="mono nfts__collection">
          {row.collection.label}
        </Link>
      ),
    },
    {
      id: "price",
      header: "Price",
      width: "150px",
      align: "end",
      cell: (row) => (
        <span className="nfts__price">
          <Amount value={row.price.value} currency={row.price.currency} issuer={row.price.issuer} className="mono num" />
          {row.converted !== undefined && <span className="faint nfts__converted">{row.converted}</span>}
        </span>
      ),
    },
    {
      id: "who",
      header: "Seller → buyer",
      width: "minmax(220px, 1.4fr)",
      // The arrow is a picture; the "to" is what a screen reader hears between the two accounts.
      cell: (row) => (
        <span className="nfts__who">
          <AccountLink net={net} address={row.seller} />
          <span aria-hidden="true" className="faint">
            →
          </span>
          <span className="sr">to</span>
          <AccountLink net={net} address={row.buyer} />
        </span>
      ),
    },
    {
      id: "mode",
      header: "Sale",
      width: "100px",
      cell: (row) => <span className="tag">{row.mode}</span>,
    },
    {
      id: "royalty",
      header: net === "xahau" ? "Royalty" : "Royalty, est.",
      width: "120px",
      align: "end",
      cell: (row) => <span className="mono num muted">{row.royalty ?? DASH}</span>,
    },
  ];
}

/**
 * A table of sales as the NFT list's recent sales and the older sales show them (spec 2.1; a collection's Sales tab draws the same rows): the time, the NFT, the collection, the
 * price, seller → buyer, the mode and the royalty. The rows are the view builder's (`saleRows`): every field is text ready to show, and every href is made. `label` names the
 * table for screen readers, as its card's title does. The network is the layout's.
 */
export function NftSalesTable({ label, rows, empty = "No sales in the index yet." }: { label: string; rows: readonly NftSaleRow[]; empty?: string }) {
  const net = useNetwork().id;
  return <DataTable label={label} columns={columns(net)} rows={rows} rowKey={(row) => row.key} minWidth={MIN_WIDTH} empty={empty} className="nfts__table" />;
}
