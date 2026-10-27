import { nftsHref, nftWords } from "../../domain/nft-params";
import type { NftSalesPageData } from "../../server/nfts-view";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { CoverageNote } from "../components/CoverageNote";
import { NftSalesTable, salesNote } from "../components/NftSalesTable";
import { Pager } from "../components/Pager";
import { useNetwork } from "../use-network";

/**
 * The older sales (`/{net}/nfts/sales`, spec 2.3): the breadcrumb, the heading, and a page of the network's sales, newest first, in the table of the list's recent sales, with
 * the board's note of the network, the coverage and Newer and Older. Takes what the view builder made of the data API's answer (`nftSalesPage`) and never fetches; the loader
 * answers a failed call with a 503, so this page has no failed card.
 */
export function NftSalesPage({ data }: { data: NftSalesPageData }) {
  const network = useNetwork();
  const words = nftWords(network.id);
  return (
    <div className="nfts">
      <Breadcrumbs items={[{ label: network.name, href: `/${network.id}` }, { label: words.tokens, href: nftsHref(network.id) }, { label: "Sales" }]} />
      <div className="nfts__head">
        <h1 className="nfts__title">{data.heading}</h1>
      </div>
      <Card title="Sales" flush action={<span className="chart__source">/v2/nft_sales?descending=true</span>}>
        <NftSalesTable label="Sales" rows={data.rows} />
        <div className="card__foot nfts__foot">
          <div className="nfts__notes">
            <p>{salesNote(network.id)}</p>
            <CoverageNote net={network.id} note={data.note} />
          </div>
          <Pager newerHref={data.paging.newerHref} olderHref={data.paging.olderHref} />
        </div>
      </Card>
    </div>
  );
}
