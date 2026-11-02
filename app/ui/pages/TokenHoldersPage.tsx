import { Link } from "react-router";

import type { TokenHoldersPageData } from "../../server/token-view";
import { AccountLink } from "../components/AccountLink";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { CoverageNote } from "../components/CoverageNote";
import { DataTable } from "../components/DataTable";
import { Pager } from "../components/Pager";
import { SectionError } from "../components/SectionError";
import { useRetry } from "../use-retry";
import { ALL_HOLDERS_WIDTH, holderColumns } from "./holder-columns";

/**
 * All the holders of a token (`/{net}/token/{token}/holders`, spec 4): the breadcrumb, the heading, the line of how many accounts hold how much and the issuer, a way back to the token, and
 * the holders in a table of the top holders' columns and two more, Limit and Status, 50 to a page with the coverage note and the pager under it ("Previous" / "More holders").
 *
 * Takes what the view builder made of the token's and the holders' answers (`tokenHoldersPage`) and never fetches: every label, href and figure is text in `data`. The list stands or fails on
 * its own, as a `SectionError` whose Retry asks the route for its data again (`useRetry`). Every address is an `AccountLink`, which reads the names of the route's `NamesProvider`.
 */
export function TokenHoldersPage({ data }: { data: TokenHoldersPageData }) {
  const { retry, retrying } = useRetry();
  const { network, head, holders } = data;
  return (
    <div className="tokens token-page">
      <Breadcrumbs
        items={[{ label: network.name, href: `/${network.id}` }, { label: "Tokens", href: `/${network.id}/tokens` }, { label: head.code, href: head.token.href }, { label: "Holders" }]}
      />
      <div className="tokens__head">
        <h1 className="tokens__title">{head.title}</h1>
        <p className="tokens__intro">{head.summary}</p>
        <p className="token-page__issuer">
          <span>Issued by</span> <AccountLink net={network.id} address={head.issuer} full />
        </p>
      </div>
      <p className="token-page__back">
        <Link className="btn" to={head.token.href}>
          {head.token.label}
        </Link>
      </p>
      <Card title="Holders" action={<span className="chart__source">{holders.source}</span>} flush>
        {holders.state === "failed" ? (
          <div className="token-page__failed">
            <SectionError what={holders.what} onRetry={retry} retrying={retrying} />
          </div>
        ) : (
          <>
            <DataTable
              label="Holders"
              columns={holderColumns(network.id, head.code, { all: true })}
              rows={holders.rows}
              rowKey={(row) => row.key}
              minWidth={ALL_HOLDERS_WIDTH}
              empty={holders.empty ?? undefined}
              className="tokens__table"
            />
            <div className="card__foot tokens__foot">
              <div className="tokens__notes">
                <p>{holders.footnote}</p>
                <CoverageNote net={network.id} note={holders.coverage} />
              </div>
              <Pager newerHref={holders.pager.newerHref} olderHref={holders.pager.olderHref} labels={holders.pager.labels} preventScrollReset />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
