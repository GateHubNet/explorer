import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { CoverageNote } from "../components/CoverageNote";
import { DataTable } from "../components/DataTable";
import { Pager } from "../components/Pager";
import { SectionError } from "../components/SectionError";
import { useRetry } from "../use-retry";
import { MptListHead } from "./mpt-parts";
import { mptHolderColumns, MPT_HOLDERS_UNRANKED_WIDTH, MPT_HOLDERS_WIDTH } from "./mpt-columns";
import type { MptHoldersPageData } from "../../server/mpt-view";

/**
 * All the holders of an issuance (`/{net}/mpt/{ID}/holders`, spec 3.4): the breadcrumb, the head (a line that leads back to the issuance's page, the heading and what is held), and the holders in a table of
 * the MPT page's columns, 50 to a page, with the coverage note and Newer and Older under it. A page behind a marker has no rank column: the API gives none.
 *
 * Takes what the view builder made of the issuance and the page of holders (`mptHoldersPage`) and never fetches: every label, href and figure is text in `data`. The list stands or fails on its own,
 * as a `SectionError` whose Retry asks the route for its data again (`useRetry`), or says the index has no rows for the issuance yet. Every address is an `AccountLink`, which reads the names of the
 * route's `NamesProvider`.
 */
export function MptHoldersPage({ data }: { data: MptHoldersPageData }) {
  const { retry, retrying } = useRetry();
  const { network, head, holders } = data;
  return (
    <div className="tokens token-page mpt">
      <Breadcrumbs
        items={[{ label: network.name, href: `/${network.id}` }, { label: "Tokens", href: `/${network.id}/tokens?kind=mpt` }, { label: head.crumb, href: data.back.href }, { label: "Holders" }]}
      />
      <MptListHead data={data} />
      <Card title="Holders" action={<span className="chart__source">{data.source}</span>} flush>
        {holders.state === "failed" ? (
          <div className="token-page__failed">
            <SectionError what="the holders" onRetry={retry} retrying={retrying} />
          </div>
        ) : holders.state === "missing" ? (
          <p className="mpt__missing faint">Not in the index yet.</p>
        ) : (
          <>
            <DataTable
              label="Holders"
              columns={mptHolderColumns(network.id, head, { ranked: holders.ranked })}
              rows={holders.rows}
              rowKey={(row) => row.holder}
              minWidth={holders.ranked ? MPT_HOLDERS_WIDTH : MPT_HOLDERS_UNRANKED_WIDTH}
              empty={holders.empty ?? undefined}
              className="tokens__table"
            />
            <div className="card__foot tokens__foot">
              <div className="tokens__notes">
                <CoverageNote net={network.id} note={holders.coverage} />
                {holders.notes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
              <Pager newerHref={holders.pager.newerHref} olderHref={holders.pager.olderHref} preventScrollReset />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
