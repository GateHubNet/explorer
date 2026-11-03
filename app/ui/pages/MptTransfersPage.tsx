import type { MptTransfersPageData } from "../../server/mpt-view";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { CoverageNote } from "../components/CoverageNote";
import { DataTable } from "../components/DataTable";
import { Pager } from "../components/Pager";
import { SectionError } from "../components/SectionError";
import { useRetry } from "../use-retry";
import { mptTransferColumns, MPT_TRANSFERS_WIDTH } from "./mpt-columns";
import { MptListHead } from "./mpt-parts";

/**
 * The transfers of an issuance (`/{net}/mpt/{ID}/transfers`, spec 3.4): the breadcrumb, the head (a line that leads back to the issuance's page, the heading and what is held), and the transfers newest
 * first in a table of the MPT page's columns, 20 to a page, with the board's footnote, the coverage note and Newer and Older under it.
 *
 * Takes what the view builder made of the issuance and the page of transfers (`mptTransfersPage`) and never fetches: every label, href and figure is text in `data`. The list stands or fails on its
 * own, as a `SectionError` whose Retry asks the route for its data again (`useRetry`), or says the index has no rows for the issuance yet. Every address is an `AccountLink`, which reads the names
 * of the route's `NamesProvider`.
 */
export function MptTransfersPage({ data }: { data: MptTransfersPageData }) {
  const { retry, retrying } = useRetry();
  const { network, head, transfers } = data;
  return (
    <div className="tokens token-page mpt">
      <Breadcrumbs
        items={[{ label: network.name, href: `/${network.id}` }, { label: "Tokens", href: `/${network.id}/tokens?kind=mpt` }, { label: head.crumb, href: data.back.href }, { label: "Transfers" }]}
      />
      <MptListHead data={data} />
      <Card title="Transfers" action={<span className="chart__source">{data.source}</span>} flush>
        {transfers.state === "failed" ? (
          <div className="token-page__failed">
            <SectionError what="the transfers" onRetry={retry} retrying={retrying} />
          </div>
        ) : transfers.state === "missing" ? (
          <p className="mpt__missing faint">Not in the index yet.</p>
        ) : (
          <>
            <DataTable
              label="Transfers"
              columns={mptTransferColumns(network.id, head)}
              rows={transfers.rows}
              rowKey={(row, index) => `${row.hash}:${index}`}
              minWidth={MPT_TRANSFERS_WIDTH}
              empty={transfers.empty ?? undefined}
              className="tokens__table"
            />
            <div className="card__foot tokens__foot">
              <div className="tokens__notes">
                <p>{transfers.footnote}</p>
                <CoverageNote net={network.id} note={transfers.note} />
              </div>
              <Pager newerHref={transfers.pager.newerHref} olderHref={transfers.pager.olderHref} preventScrollReset />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
