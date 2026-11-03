import { useId, type ReactNode } from "react";
import { Form, Link } from "react-router";

import type { TokensPageData } from "../../server/token-view";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Card } from "../components/Card";
import { CoverageNote } from "../components/CoverageNote";
import { AlertIcon, SearchIcon } from "../components/icons";
import { Pager } from "../components/Pager";
import { SegmentedLinks } from "../components/SegmentedLinks";
import { StatGrid, StatTile } from "../components/StatTile";
import { cx } from "../cx";
import { IssuedTable } from "./IssuedTable";
import { MptTable } from "./MptTable";

/**
 * The GET form of the search (spec 2.1): it works without JavaScript, and is a client-side navigation with it. The field is named `q` and has a visible label. The canonical query is `kind`,
 * then `q`, then `all`, and a submit writes the fields in the order of the form: `kind=mpt` is a hidden field before the field (the MPT tab, E14 spec 4) and `all=1` one after it (the issued
 * list, which keeps the tokens with fewer holders when they are shown), so that a search is never a redirect to the URL that holds the same query. The message of a search that was too long is
 * tied to the field and is an alert, a new one for each search, so that a screen reader reads it when Search brings it.
 */
function SearchForm({ search }: { search: TokensPageData["search"] }) {
  const fieldId = useId();
  const errorId = useId();
  return (
    // A new view is a new form: its field starts from the search the page shows, not from what was typed before the navigation.
    <Form key={`${search.q}\u0000${search.before.length}\u0000${search.hidden.length}`} method="get" action={search.action} className="tokens__form">
      {search.before.map(({ name, value }) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label htmlFor={fieldId} className="tokens__label">
        {search.label}
      </label>
      <div className={cx("tokens__field", search.error !== null && "is-invalid")}>
        <SearchIcon size={15} className="tokens__icon" />
        <input
          id={fieldId}
          type="search"
          name="q"
          className="tokens__input"
          defaultValue={search.q}
          placeholder={search.placeholder}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={search.error !== null ? "true" : undefined}
          aria-describedby={search.error !== null ? errorId : undefined}
        />
      </div>
      {search.hidden.map(({ name, value }) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className="btn tokens__submit">
        Search
      </button>
      {search.error !== null && (
        <p key={search.q} id={errorId} role="alert" className="tokens__error">
          <AlertIcon size={14} />
          {search.error}
        </p>
      )}
    </Form>
  );
}

/** What is under a table of the list: the coverage note, the note and the definitions in the notes' column, and the pager. */
function ListFoot({ data, footnote, children }: { data: TokensPageData; footnote: string; children?: ReactNode }) {
  return (
    <div className="card__foot tokens__foot">
      <div className="tokens__notes">
        <CoverageNote net={data.network.id} note={data.coverage} />
        {children}
        <p>{footnote}</p>
      </div>
      <Pager newerHref={data.pager.newerHref} olderHref={data.pager.olderHref} labels={data.pager.labels} preventScrollReset />
    </div>
  );
}

/** The Issued tokens card: the search and Show all, then the table with what is under it (the coverage, the note, the definitions) and the pager. A search too long to ask has the form alone. */
function IssuedCard({ data }: { data: TokensPageData }) {
  const { issued, network } = data;
  return (
    <Card title="Issued tokens" flush>
      <div className="tokens__filter">
        <SearchForm search={data.search} />
        {data.showAll !== null && (
          <Link className="btn tokens__all" to={data.showAll.href} preventScrollReset>
            {data.showAll.label}
          </Link>
        )}
      </div>
      {issued !== null && (
        <>
          <IssuedTable rows={issued.rows} caption="Issued tokens" net={network.id} native={network.native} empty={issued.empty} />
          <ListFoot data={data} footnote={issued.footnote}>
            {issued.note !== null && (
              <p>
                {issued.note.text}
                {issued.note.more !== undefined && (
                  <>
                    {" · "}
                    <Link to={issued.note.more.href} className="tokens__more">
                      {issued.note.more.text}
                    </Link>
                  </>
                )}
              </p>
            )}
          </ListFoot>
        </>
      )}
    </Card>
  );
}

/** The MPTs card (E14 spec 4): the search, then the table with what is under it (the coverage, the note, the flags' legend) and the pager. A search too long to ask has the form alone. */
function MptCard({ data }: { data: TokensPageData }) {
  const { mpt, network } = data;
  return (
    <Card title="MPTs" flush>
      <div className="tokens__filter">
        <SearchForm search={data.search} />
      </div>
      {mpt !== null && (
        <>
          <MptTable rows={mpt.rows} caption="MPTs" net={network.id} empty={mpt.empty} />
          <ListFoot data={data} footnote={mpt.footnote}>
            {mpt.note !== null && <p>{mpt.note.text}</p>}
          </ListFoot>
        </>
      )}
    </Card>
  );
}

/**
 * The token list (`/{net}/tokens`, spec 2.1), in the board's order: the breadcrumb, the heading and its intro, the kind tabs with the source line, the three tiles of the totals and the card of
 * the issued tokens or the MPTs. Takes what the view builder made of the data API's answer (`tokensPage`) and never fetches: every label, href and figure is text in `data`. The tabs, the tiles and
 * the search are shared by the kinds; the body is drawn by kind. The route puts the page in a `NamesProvider`, which the issuers' links read.
 */
export function TokensPage({ data }: { data: TokensPageData }) {
  const { network } = data;
  return (
    <div className="tokens">
      <Breadcrumbs items={[{ label: network.name, href: `/${network.id}` }, { label: "Tokens" }]} />
      <div className="tokens__head">
        <h1 className="tokens__title">Tokens</h1>
        <p className="tokens__intro">{data.intro}</p>
      </div>
      <div className="tokens__kinds">
        <SegmentedLinks label="Kind of token" links={data.tabs} />
        <span className="chart__source">{data.source}</span>
      </div>
      <StatGrid label="Totals">
        {data.tiles.map((tile) => (
          <StatTile key={tile.label} figure label={tile.label} value={tile.value} sub={tile.sub === "" ? undefined : tile.sub} />
        ))}
      </StatGrid>
      {data.tokenKind === "issued" ? <IssuedCard data={data} /> : <MptCard data={data} />}
    </div>
  );
}
