import { Link } from "react-router";

import { formatAmount } from "../../domain/format";
import { formatDateTime } from "../../domain/time-words";
import type { NetworkId } from "../../server/networks";
import type { RichText, SupplyPageData, SupplyTile } from "../../server/supply-view";
import { ChartCard } from "../charts/ChartCard";
import { ChartTable } from "../charts/ChartTable";
import { ColumnChart } from "../charts/ColumnChart";
import { percent } from "../charts/geometry";
import { Legend, legendOf } from "../charts/Legend";
import { ShareBar, shareLegend } from "../charts/ShareBar";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { CoverageNote } from "../components/CoverageNote";
import { Notice } from "../components/Notice";
import { StatGrid, StatTile } from "../components/StatTile";
import { useRetry } from "../use-retry";

const DASH = "—";

/** Words with some of them bold (`RichText`): a string is plain text and `{ b }` is drawn in `<b>`. */
function Rich({ text }: { text: RichText }) {
  return text.map((part, index) => (typeof part === "string" ? part : <b key={index}>{part.b}</b>));
}

/**
 * A tile of the figures (spec 5.3): the label with the compact figure at its right, the exact figure with its fraction muted and the currency after it, and under it the formula, the definition,
 * the line that says why a figure is missing or how many escrows there are, and the coverage note of its part. A figure that is not known is a dash.
 */
function Tile({ tile, net }: { tile: SupplyTile; net: NetworkId }) {
  const known = tile.whole !== null && tile.fraction !== null;
  return (
    <StatTile
      figure
      label={tile.label}
      aside={tile.aside}
      value={
        known ? (
          <span className="supply__figure">
            {tile.whole}
            <span className="supply__fraction">{tile.fraction}</span> <span className="supply__currency">{tile.currency}</span>
          </span>
        ) : (
          DASH
        )
      }
      sub={
        <span className="supply__notes">
          {tile.formula !== null && <span className="stat__formula">{tile.formula}</span>}
          <span>{tile.definition}</span>
          {tile.sub !== null && <span>{tile.sub}</span>}
          <CoverageNote net={net} note={tile.coverage} />
        </span>
      }
    />
  );
}

/**
 * The supply page (`/{net}/supply`, spec 5): the heading and the snapshot it is a picture of, the bar of where the currency is with the figures under it, and the cards of days, burned and on
 * Xahau minted. Takes what the view builder made of the data API's answers (`supplyPage`) and never fetches: every figure, label and sentence is text in `data`. A card that could not be
 * loaded is told in its place with a Retry, and the rest of the page stands.
 */
export function SupplyPage({ data }: { data: SupplyPageData }) {
  const { network, snapshot, bar, burnedCard, mintedCard } = data;
  const { retry, retrying } = useRetry();
  const { id: net, native } = network;
  const burnedWhat = `${native} burned per day`;
  const mintedWhat = `${native} minted per day`;

  return (
    <div className="supply">
      <Breadcrumbs
        items={[
          { label: network.name, href: `/${net}` },
          { label: "Network", href: `/${net}/network` },
          { label: "Supply" },
        ]}
      />
      <div className="supply__head">
        <div className="supply__titles">
          <h1 className="supply__title">Supply</h1>
          <p className="supply__intro">{data.intro}</p>
        </div>
        <div className="supply__snapshot">
          <span>
            Snapshot at ledger{" "}
            <Link to={snapshot.ledgerHref} className="mono num">
              {`#${formatAmount(String(snapshot.ledgerIndex))}`}
            </Link>
            {` · ${formatDateTime(snapshot.closeTime)} · updated hourly`}
          </span>
          <span className="chart__source">/v2/network/supply</span>
        </div>
      </div>
      {snapshot.stale !== null && (
        <Notice tone="warning">{`This snapshot is ${snapshot.stale.hours} hours older than the newest ledger: the data API has not computed a newer one.`}</Notice>
      )}

      <section className="card chart supply__bar" aria-labelledby="supply-bar-title">
        <div className="chart__head">
          <div className="chart__titles">
            <h2 id="supply-bar-title" className="chart__title">
              {bar.title}
            </h2>
            <span className="chart__source">/v2/network/supply</span>
          </div>
          <Legend items={shareLegend(bar.data)} />
        </div>
        <p className="supply__text">{bar.text}</p>
        <div className="supply__scale">
          {bar.burned !== null && (
            <p className="supply__burned">
              <Rich text={bar.burned} />
            </p>
          )}
          <ShareBar compact title={bar.title} data={bar.data} />
          {bar.part !== null && (
            <div className="supply__part" style={{ marginLeft: percent(bar.part.start, 3) }}>
              <span className="supply__bracket" aria-hidden="true" />
              <p className="supply__part-text">
                <Rich text={bar.part.text} />
              </p>
            </div>
          )}
        </div>
        <CoverageNote net={net} note={bar.coverage} />
      </section>

      <StatGrid wide label="Supply figures">
        {data.tiles.map((tile) => (
          <Tile key={tile.id} tile={tile} net={net} />
        ))}
      </StatGrid>

      <ChartCard
        id="burned"
        title={burnedWhat}
        source="/v2/network/fees?interval=day"
        what={burnedWhat}
        state={burnedCard.state}
        onRetry={retry}
        retrying={retrying}
        summary={burnedCard.state === "ok" && <Rich text={burnedCard.summary} />}
        table={burnedCard.state === "ok" && <ChartTable title="Burned per day" data={burnedCard.data} />}
      >
        {burnedCard.state === "ok" && <ColumnChart layout="single" title={burnedWhat} data={burnedCard.data} />}
      </ChartCard>

      {mintedCard !== null && (
        <div className="supply__stack">
          <ChartCard
            id="minted"
            title={`${native} minted per day, by source`}
            source="/v2/network/supply/minted?interval=day"
            what={mintedWhat}
            state={mintedCard.state}
            onRetry={retry}
            retrying={retrying}
            legend={mintedCard.state === "ok" && <Legend items={legendOf(mintedCard.data, "swatch")} />}
            summary={mintedCard.state === "ok" && <Rich text={mintedCard.summary} />}
            table={mintedCard.state === "ok" && <ChartTable title="Minted per day" data={mintedCard.data} totalLabel={`Total, ${native}`} />}
            notes={mintedCard.state === "ok" ? [mintedCard.since, ...mintedCard.notes] : undefined}
          >
            {mintedCard.state === "ok" && <ColumnChart layout="stacked" title={`${native} minted per day, by source`} data={mintedCard.data} />}
          </ChartCard>
          {mintedCard.state === "ok" && <CoverageNote net={net} note={mintedCard.coverage} />}
        </div>
      )}
    </div>
  );
}
