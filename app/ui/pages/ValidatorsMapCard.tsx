import { type CSSProperties, type KeyboardEvent, type PointerEvent, useEffect, useId, useState } from "react";
import { Link } from "react-router";

import type { CircleView, CountryRowView } from "../../server/validator-map-view";
import type { ValidatorsPageData } from "../../server/validators-view";
import { Meter } from "../charts/Meter";
import { type Column, DataTable } from "../components/DataTable";
import { SectionError } from "../components/SectionError";
import { cx } from "../cx";
import dotsUrl from "../map/world-dots.svg?url";
import type { HoldHandlers } from "../use-hold";

/**
 * The tooltip's CSS transform beside a circle (the board's rule, plan ruling R10): horizontally 14 px in from the circle's left edge when the circle is in the first 14 % of the
 * map, 14 px short of its right edge in the last 14 %, else centred; vertically below the circle (by half its size and 8 px) in the upper part of the map, above it elsewhere.
 * `left` and `top` are the circle's percentages as the view builder wrote them (`"52.89%"`).
 */
export function tipTransform(circle: Pick<CircleView, "left" | "top" | "size">): string {
  const left = Number.parseFloat(circle.left);
  const top = Number.parseFloat(circle.top);
  const gap = circle.size / 2 + 8;
  const x = left < 14 ? "-14px" : left > 86 ? "calc(-100% + 14px)" : "-50%";
  const y = top < 42 ? `${gap}px` : `calc(-100% - ${gap}px)`;
  return `translate(${x}, ${y})`;
}

const COLUMNS: Column<CountryRowView>[] = [
  {
    id: "country",
    header: "Country",
    width: "minmax(80px, 1.5fr)",
    cell: (row) =>
      row.href === null ? (
        <span className="vmapcard__country">{row.name}</span>
      ) : (
        <Link to={row.href} preventScrollReset aria-current={row.current ? "true" : undefined} className="vmapcard__country">
          {row.name}
        </Link>
      ),
  },
  { id: "validators", header: "Validators", width: "74px", align: "end", cell: (row) => row.validators },
  { id: "unl", header: "On UNL", width: "58px", align: "end", cell: (row) => row.unl },
  {
    id: "share",
    header: "Share",
    width: "minmax(84px, 1fr)",
    // The meter says nothing the text beside it does not: it is a graphic here, hidden from a screen reader, which hears the share once.
    cell: (row) => (
      <div className="vmapcard__share">
        <div className="vmapcard__bar">
          <Meter small decorative data={{ ...row.meter, label: row.share }} />
        </div>
        <span className="num">{row.share}</span>
      </div>
    ),
  },
];

/** A finger is not a pointer that stays over a circle: only a mouse or a pen shows its tooltip (a tap follows the link). */
function pointerIsMouse(event: PointerEvent): boolean {
  return event.pointerType !== "touch";
}

/**
 * The countries card of the validators list (E13 spec 4.1 and 4.3): the dot-grid map with one circle for each country that has a validator, the countries table, the chip of the
 * validators whose location is unknown and the attribution. It draws `data.map` and never fetches; it is `null` while the switch is off. The dots are the static asset
 * `world-dots.svg`, drawn with `<use>` so that no byte of them is in the page's JavaScript or HTML.
 *
 * It holds the code that is highlighted (from a circle or a table row), so that the two follow each other, and the code whose tooltip is shown (a circle that has the pointer or
 * focus). Every circle and every table name is a link, so the card works without JavaScript; with it, one circle is a Tab stop and the arrow keys move focus along `order`.
 * The card spreads `holds` so that the pointer over it, or focus in it, holds the page's updates as the live tables do.
 */
export function ValidatorsMapCard({ map, holds, onRetry, retrying }: { map: ValidatorsPageData["map"]; holds: HoldHandlers; onRetry: () => void; retrying: boolean }) {
  const attributionId = useId();
  /** The code of the row the pointer is over. */
  const [overRow, setOverRow] = useState<string | null>(null);
  const [overCircle, setOverCircle] = useState<string | null>(null);
  const [focusedCircle, setFocusedCircle] = useState<string | null>(null);
  /** The code whose tooltip Escape has hidden, until the pointer or focus leaves it. */
  const [dismissed, setDismissed] = useState<string | null>(null);

  const shown = overCircle ?? focusedCircle;
  const tipCode = shown !== null && shown !== dismissed ? shown : null;
  // Escape hides the tooltip wherever the key is pressed: a pointer can hold a tooltip open with no focus in the card.
  useEffect(() => {
    if (tipCode === null) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(tipCode);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tipCode]);

  if (map.state === "off") return null;

  const head = (
    <div className="vmapcard__head">
      <div className="chart__titles">
        <h2 id="validators-map-title" className="chart__title">
          Where validators are
        </h2>
        <span className="chart__source">/v2/network/validators</span>
      </div>
      {map.state === "ok" && map.chosen !== null && (
        <p className="vmapcard__chosen">
          The list below shows <strong>{map.chosen.name}</strong>
          <Link to={map.chosen.clear} preventScrollReset>
            Clear country
          </Link>
        </p>
      )}
    </div>
  );

  if (map.state === "failed") {
    return (
      <section className="card vmapcard" aria-labelledby="validators-map-title" {...holds}>
        {head}
        <div className="vmapcard__failed">
          <SectionError what="where validators are" onRetry={onRetry} retrying={retrying} />
        </div>
      </section>
    );
  }

  const highlighted = overRow ?? overCircle ?? focusedCircle;
  const tip = map.circles.find((circle) => circle.code === tipCode);
  // The one Tab stop: the chosen circle, else the largest (the first).
  const stop = map.circles.find((circle) => circle.current)?.code ?? map.circles[0]?.code;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const code = (event.target as HTMLElement).closest<HTMLElement>("[data-code]")?.dataset.code;
    if (code === undefined) return;
    const at = map.order.indexOf(code);
    const last = map.order.length - 1;
    const to =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? Math.min(at + 1, last)
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? Math.max(at - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (to === null || at < 0) return;
    event.preventDefault();
    event.currentTarget.querySelector<HTMLElement>(`a[data-code="${map.order[to]!}"]`)?.focus();
  };

  return (
    <section className="card vmapcard" aria-labelledby="validators-map-title" {...holds}>
      {head}
      <div className="vmapcard__body">
        <div className="vmapcard__map">
          <div role="group" aria-label="Map of validators by country" aria-describedby={attributionId} className="vmap" onKeyDown={onKeyDown}>
            <svg className="vmap__dots" viewBox="0 0 1000 378" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <use href={`${dotsUrl}#dots`} />
            </svg>
            {map.circles.map((circle) => (
              <Link
                key={circle.code}
                to={circle.href}
                preventScrollReset
                aria-label={circle.label}
                aria-current={circle.current ? "true" : undefined}
                tabIndex={circle.code === stop ? 0 : -1}
                data-code={circle.code}
                className={cx("vmap__circle", circle.current && "is-current", circle.dim && "is-dim", highlighted === circle.code && "is-highlighted")}
                style={{ left: circle.left, top: circle.top, "--d": `${circle.size}px` } as CSSProperties}
                onPointerEnter={(event) => {
                  if (!pointerIsMouse(event)) return;
                  setOverCircle(circle.code);
                  setDismissed(null);
                }}
                onPointerLeave={() => {
                  setOverCircle(null);
                  setDismissed(null);
                }}
                onFocus={() => {
                  setFocusedCircle(circle.code);
                  setDismissed(null);
                }}
                onBlur={() => {
                  setFocusedCircle(null);
                  setDismissed(null);
                }}
              />
            ))}
            {tip !== undefined && (
              <div className="vmap__tip" aria-hidden="true" style={{ left: tip.left, top: tip.top, transform: tipTransform(tip) }}>
                <strong>{tip.tip.name}</strong>
                <span>{tip.tip.counts}</span>
                <span>{tip.tip.share}</span>
                <span className="vmap__hint">{tip.tip.hint}</span>
              </div>
            )}
          </div>
        </div>
        <div className="vmapcard__table">
          <DataTable
            label="Validators by country"
            columns={COLUMNS}
            rows={map.rows}
            rowKey={(row) => row.code}
            // The tracks at their least (80 + 74 + 58 + 84), the gaps and the padding of a compact row (12 px each): on a phone the table scrolls inside its box, as the others do.
            minWidth={356}
            compact
            maxHeight={282}
            live
            empty="No validator's toml gives a server country yet."
            rowProps={(row) => ({
              className: cx(row.current && "is-current", highlighted === row.code && "is-highlighted"),
              onPointerEnter: () => setOverRow(row.code),
              onPointerLeave: () => setOverRow(null),
            })}
          />
        </div>
      </div>
      <div className="card__foot vmapcard__foot">
        <div className="legend">
          <span className="legend__item">
            <span className="vmapcard__swatch" aria-hidden="true" />
            Validators, located by their toml
          </span>
          <span className="legend__item">Circle area shows the count</span>
        </div>
        {map.unknown.href === null ? (
          <span className="fchip">
            Unknown location: <b>{map.unknown.count}</b> {map.unknown.noun}
          </span>
        ) : (
          <Link to={map.unknown.href} preventScrollReset className="fchip">
            Unknown location: <b>{map.unknown.count}</b> {map.unknown.noun}
          </Link>
        )}
        {map.limited !== null && <p className="vmapcard__limited">{map.limited}</p>}
      </div>
      <p id={attributionId} className="vmapcard__attribution">
        Validator locations come from <code>server_country</code> in each validator's verified {map.file}. A validator without a verified toml, or whose toml gives no valid{" "}
        <code>server_country</code>, has an unknown location.
        {map.unplaced !== null && <> {map.unplaced}</>}
      </p>
    </section>
  );
}
