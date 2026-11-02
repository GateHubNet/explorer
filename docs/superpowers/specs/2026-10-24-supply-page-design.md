# Supply page and the Network menu (E12): design

Status: proposed (2026-10-24), program 2, sub-project E12. Repository `x-explorer`, branch `feat/explorer-pages-2`.

- Boards: `2026-10-24-explorer-mock/Supply.dc.html` (XRPL) and `SupplyXahau.dc.html` (the same board, `network="xahau"`), and the
  header's Network menu as every board draws it (`<details class="menu">`). Not built from these boards: the Distribution tab and board,
  the "Escrow releases by month" card and the "All N escrows" link (owner, 2026-10-24: deferred).
- Data: D7, `data-api/docs/superpowers/specs/2026-10-24-supply-design.md` (`GET /v2/network/supply`, `GET /v2/network/supply/minted`),
  and the existing `GET /v2/network/fees?interval=day`.
- Builds on: E2 `2026-10-19-network-dashboard-design.md` (the chart kit, `windowOf`, the switches, `navSection`, the card deadline,
  `SectionError`), E6 `2026-10-19-validators-amendments-pages-design.md` (the Validators and Amendments pages the menu links), E8
  `2026-10-24-nft-pages-design.md` (`checkCoverage`, `coverageNote`, `CoverageNote`; the NFTs header item), E11
  `2026-10-24-token-pages-design.md` (the Tokens header item), E7 `2026-10-24-sandbox-environment-design.md` (the sandbox, its network
  names and the Testnet badge). Overview: `2026-10-24-explorer-program-2-overview.md`.

## Owner decisions to confirm

| # | Decision (and deviation from the board) | Recommendation |
| --- | --- | --- |
| 1 | The page is "Supply" at `/{net}/supply`, its menu item "Supply", with no Supply / Distribution tabs: Distribution is deferred. | As the brief |
| 2 | No "Escrow releases by month" card and no "All N escrows →" link (both deferred); the Escrowed tile says "in 12,879 escrows" instead. | As the brief |
| 3 | The burned chart's source line is `/v2/network/fees?interval=day` (the data that already exists), not the board's `/v2/network/supply/burned`. | Keep |
| 4 | "Last 90 days" is today so far and the 89 days before it, today marked "so far", as on every page of the explorer (program 1, decision 4), not the board's 90 full days to yesterday. The average and the highest day use the 89 full days. | Keep |
| 5 | The circulating segment is series colour 1, not the network accent: the kit's segments take series slots, and the accent is not one. Burned 2, escrowed 3, as the board. | Keep |
| 6 | On Xahau the escrowed segment (about 3%) has no label under it (the kit labels a segment of 18% or more); the legend, the tooltip and the tile name it. | Keep |
| 7 | The bar has no Table view: every segment's exact figure is a tile right under it. | Keep |
| 8 | Xahau's "Minted, last 90 days" tile sums the minted days; the minted card adds one line from the snapshot: "Since ledger #N: M XAH minted: R as rewards, I by Import, G by GenesisMint." | Keep |
| 9 | The Network menu is a **disclosure** (`<details>` / `<summary>`, links inside), not an ARIA `menu`: site navigation, works before JavaScript, Tab moves through it. Items: Overview, Validators, Amendments, Supply; Nodes is not listed (not built). An item whose switch is off reads "soon". | Keep |
| 10 | Validators and Amendments get header entries for the first time (today only the network page links them). | Keep |
| 11 | `SUPPLY` goes on in an environment once its data API serves a snapshot on both networks **and** escrowed is complete there (D5's history from 28,685,313); reserves may still be incomplete, with their note. An incomplete escrowed figure would make the headline circulating supply billions too high. In the sandbox, whose coverage is never complete (D-env §12), it goes on with the snapshot alone and the notes (E7 §9, decision 15; consistency pass). | Keep; or turn on with the notes alone |
| 12 | A snapshot more than 3 hours older than the newest ledger shows a warning under the snapshot line. | Keep |
| 13 | The page is not live: it is class `slow` for 300 s, its calls kept 300 s; the snapshot itself changes hourly. | Keep |
| 14 | The page is a dashboard under ruling R19: budget 160,000 bytes, as the network page (the brief's flat 150 KB was wrong). | Accept |

## Goal

`/{net}/supply` shows how much of the native currency exists, how much is burned, escrowed and circulating, how much of the circulating
supply sits in AMM pools and in account reserves, and on Xahau how much was minted and by what: one snapshot at one ledger, exact to the
drop, each history-derived figure with a coverage note while the index lacks its history. The header's "Network" link becomes the Network
menu of the boards.

## Scope and non-goals

In scope: the route, its loader, view builder and page; the burned-per-day and minted-per-day cards; the Network menu; the switch
`SUPPLY`; the kit props the page needs; fixtures, tests and the README.

Not in scope: Distribution (rich list, brackets), supply over time, escrow forecasts, the network-wide escrows list, a link-preview
image of its own, live refresh, the Nodes item, the other header items (Tokens is E11's, NFTs E8's).

## 1. Route and URL

| Path | Route file | Handle |
| --- | --- | --- |
| `/{net}/supply` | `app/routes/net.supply.tsx` | `{ navSection: "network", navPage: "supply" }` |

`routes.ts` gains `route("supply", "routes/net.supply.tsx")` under `:net` (after `amendments/:name`). The route exports `headers =
forwardCacheClass`, `meta`, `handle`, the loader and the page.

| Request | Answer |
| --- | --- |
| `/{net}/supply` while `SUPPLY` is on | the page, class `slow` with a TTL of 300 s |
| any query string | 302 to `/{net}/supply`, class `short` (`cacheClassHeaders("short")`), before any call |
| `/{net}/supply` while `SUPPLY` is off | the not-found page, "We couldn't find the supply page on XRPL", 404 class `short`, no call |
| `/{unknown}/supply` | the layout's 404, as today |

Breadcrumbs: `XRPL / Network / Supply` (the network's name, the overview, the page; `Breadcrumbs`). The `<h1>` is "Supply".

## 2. The Network menu

### 2.1 What changes in the header

`app/ui/components/Header.tsx`. The `NAV` item `{ label: "Network", … }` becomes a menu in its place (the boards' order: Ledgers,
Transactions, Tokens, Network, Markets, AMM, NFTs, with E11's and E8's items as they built them; this is the third and last step of
the header, E8 §1.1, and E13 and E14 add no item):

```ts
type NavMenuItem = { label: string; to: (net: NetworkBrief) => string; page: NavPage; feature?: Feature };
type NavItem =
  | { label: string; to?: (net: NetworkBrief) => string; section?: NavSection; feature?: Feature }
  | { label: string; section: NavSection; items: readonly NavMenuItem[] };

{ label: "Network", section: "network", items: [
  { label: "Overview",   to: (net) => `/${net.id}/network`,    page: "overview" },
  { label: "Validators", to: (net) => `/${net.id}/validators`, page: "validators", feature: "validators" },
  { label: "Amendments", to: (net) => `/${net.id}/amendments`, page: "amendments", feature: "validators" },
  { label: "Supply",     to: (net) => `/${net.id}/supply`,     page: "supply",     feature: "supply" },
] }
```

`app/ui/route-handle.ts` gains `NavPage = "overview" | "validators" | "amendments" | "supply"`, the handle field `navPage` and
`navPageOf(matches)` (the deepest match that names one, as `navSectionOf`). The existing routes of the section add theirs:
`net.network.tsx` `"overview"`, `net.validators.tsx` and `net.validators.$key.tsx` `"validators"`, `net.amendments.tsx` and
`net.amendments.$name.tsx` `"amendments"`.

### 2.2 Markup

```html
<li>
  <details class="menu" data-menu="network">
    <summary class="nav-item menu__summary is-current" aria-current="true">Network<ChevronDownIcon/></summary>
    <ul class="menu__panel">
      <li><a class="menu__item" href="/xrpl/network">Overview</a></li>
      <li><a class="menu__item" href="/xrpl/validators">Validators</a></li>
      <li><a class="menu__item" href="/xrpl/amendments">Amendments</a></li>
      <li><a class="menu__item" href="/xrpl/supply" aria-current="page">Supply</a></li>
    </ul>
  </details>
</li>
```

- The links are React Router `Link`s. An item whose switch is off is `<span class="menu__item is-soon" aria-disabled="true">Supply <span
  class="soon">soon</span></span>`, as a header item is today. Overview is never off.
- `<summary>` is the disclosure's button: browsers announce it with its expanded or collapsed state, and Enter and Space open and close
  it with no script, so the menu works before hydration and without JavaScript. No `role="menu"` and no arrow-key roving: Tab and
  Shift+Tab move through the items, as through any links.
- `ChevronDownIcon` (`icons.tsx`, new if it is not there: 12 px, `aria-hidden`) turns 180° while open (`.menu[open]`), with no transition
  under `prefers-reduced-motion`.

### 2.3 Current-page marking

- The summary has `.is-current` and `aria-current="true"` on every page of the section (`navSection === "network"`), where the Network link
  had `"page"` on the network page and `"true"` elsewhere.
- An item has `aria-current="page"` on its own page (the path of its `to`, the query ignored: `/xrpl/validators?scope=all` too) and
  `"true"` on a page under it (`navPage` matches: `/xrpl/validators/{key}`, `/xrpl/amendments/{name}`). The current item has the
  `--sunken` background of the board.

### 2.4 Behaviour after hydration

`useDisclosureMenu(ref)` (`app/ui/use-disclosure-menu.ts`, a hook of its own so the shell imports nothing else), on the `<details>`:

- **Escape**, while it is open and focus is in it (the summary or an item): close, focus the summary.
- **A pointer down outside** while open: close; focus stays where it was.
- **Focus leaving** (a `focusout` whose `relatedTarget` is outside the element; not a window blur, whose `relatedTarget` is `null`): close.
- **A navigation** (the location's pathname or search changes, `useLocation()`): close, so the panel does not stay open over the new page.
- Hover opens nothing (the boards have no hover). Only one menu exists; should another come, opening one closes the others
  (`data-menu`).

### 2.5 Layout

- Wide screens: the panel sits under the summary (`position: absolute; top: calc(100% + 6px); min-width: 230px`), the board's surface,
  border, radius and shadow; items 36 px high, **44 px under `(pointer: coarse)`**; z-index above the page, below the search hints.
- Phones (the header's folded nav, `.hdr__nav.is-open`): the panel is in the flow (`position: static`), indented 12 px under the summary,
  items full width and 44 px high.
- `forced-colors: active`: the panel keeps a border (`CanvasText`); the current item is marked by `aria-current` and a 2 px left rule,
  not by the background alone.
- Styles in `components.css` (`.menu`, `.menu__summary`, `.menu__panel`, `.menu__item`), pinned by the existing CSS tests.

## 3. Calls, cache classes and the loader

### 3.1 The data API client

`app/server/data-api.ts` gains two calls; their paths go in `PENDING_PATHS` (`app/server/pending-paths.ts`) until `pnpm api:sync`
brings D7's routes into `openapi.d.ts`, then move to `PATHS`:

| Call | Path | Class | Shape check (inside the cached load) |
| --- | --- | --- | --- |
| `networkSupply(opts?)` | `/v2/network/supply` | `slow`; the page asks `{ ttl: PERIOD_CALL_TTL_SECONDS }` (300 s) | `checkSupply(body)` |
| `networkMinted(q, opts?)`, `q = { interval: "day"; start; end; limit }` | `/v2/network/supply/minted` | `slow`; `{ ttl: PERIOD_CALL_TTL_SECONDS }` | `checkMintedPage(body)` |

The answer types `NetworkSupply`, `SupplyPart`, `MintedPart`, `MintedRow` go in `app/server/api-types.ts`, written from D7 section 5;
the checks in `app/server/supply-shape.ts`: `ledger_index` a positive whole number, `close_time` and `computed_at` ISO times
(`isIsoTime`), `currency` the network's native code, every amount decimal text (`isDecimalText`), counts whole numbers, `total`,
`burned`, `escrowed`, `circulating` present, `minted`, `amm`, `reserves` optional, and each part's `coverage`, when present, through E8's
`checkCoverage(part)`; a minted page's rows with `date` ISO and four amounts, and its `coverage` through `checkCoverage(body)`. A
failure is an `UpstreamError` of kind `server`, never stored.

### 3.2 The calls of the page

| # | Call | Kept | Feeds | If it fails |
| --- | --- | --- | --- | --- |
| S | `networkSupply()` | 300 s | everything but the two charts | 503 (`upstreamOutage(err, "the supply")`: a 404 `supply not computed yet` and a "Cannot GET" 404 are outages too), never stored |
| A | `lastValidated()` | 2 s, the home page's key (`HOME_CALL_TTL_SECONDS`), so it costs nothing new | `T` (`utcDayOf` its close time), the stale check | the two chart cards fail; no stale check |
| F | `fees({ interval: "day", start, end, limit: SERIES_LIMIT })`, `start`/`end` = `windowOf(T, "90d")` | 300 s: the network page's `90d` call, the same key, shared | the burned card | that card |
| M | `networkMinted({ interval: "day", start, end, limit: SERIES_LIMIT })`, the same window, only when S has `minted` | 300 s | the minted card and the Minted tile | that card, the tile shows "—" |

S and A start together; F waits for A; M for A and S. The cards race `CARD_DEADLINE_MS` (4.5 s from the loader's start) with
`byDeadline`; S does not. Everything settles (`Promise.allSettled`) before anything is thrown. The page polls nothing, so no call asks
for the failure hold. A card that failed is told in its place (`ChartCard state="failed"`, "Couldn't load XRP burned per day", Retry),
logged (`logProblem`), and the answer is degraded (`markDegraded`: a 200 never stored, `Cache-Control: no-store`). The page names no
address, so it makes no names call.

### 3.3 Classes

The page and its `.data` URL are `cached(page, "slow", { ttl: PERIOD_CALL_TTL_SECONDS })`: 300 s fresh at the edge, as E6's older
validations. The worst age of what it shows: the snapshot up to an hour (D7's cycle) plus 300 s plus 300 s; the daily series 300 s plus
300 s. The 302 and the 404 are `short`.

## 4. The view builder

`supplyPage(net, supply, cards)` in `app/server/supply-view.ts` (pure, unit-tested, exact arithmetic with BigNumber, no clock):
`cards = { anchor?: Settled<LastValidated>, fees?: Settled<FeeBucketPage>, minted?: Settled<MintedPage> }`. It returns
`SupplyPageData`:

| Field | Holds |
| --- | --- |
| `snapshot` | `ledgerIndex`, `ledgerHref` (`/{net}/ledger/{n}`), `closeTime` (ISO; the page prints it with `formatUtc`), `stale` (`{ hours }` when the anchor's close time is more than `SUPPLY_STALE_SECONDS` = 10,800 after the snapshot's, else `null`) |
| `intro` | the sentence under the heading, per network (5.1) |
| `bar` | `title`, `text`, `data` (`ShareData`, 5.2), `burned` (the XRPL callout text, else `null`), `part` (`{ start, text }`: the bracket under circulating), `coverage` (E8's `coverageNote(escrowed.coverage, "escrows")`) |
| `tiles` | in board order (5.3): `{ id, label, whole, fraction, aside, formula?, definition, sub?, coverage? }`, or `value: null` with `sub` for a figure that is missing |
| `burnedCard` | `{ state: "ok", data: TimeSeriesData, summary }` or `{ state: "failed", reason }` |
| `mintedCard` | absent without `supply.minted`; else as `burnedCard`, plus `since` (the snapshot's sentence) and `coverage` |

Amounts reach the page as strings: an exact tile figure with six decimals (`toFormat(6)` of BigNumber, split at the point so the page can
mute the fraction: "99,985,312,374" + ".716318"), a compact figure with `compactNumber` ("≈ 99.99B"), shares with the new `finePercent`
(9.3). A fee row's `total` (a JSON number) becomes `new BigNumber(String(n))`, so no floating-point value reaches a label (README, "Data
shapes").

## 5. The page

`app/ui/pages/SupplyPage.tsx` draws `SupplyPageData` and never fetches; page styles in `pages.css` (`.supply__…`).

### 5.1 Heading and snapshot line

- `<h1>` "Supply"; the intro: XRPL "How much XRP exists, how much is burned and escrowed, and how much circulates." Xahau "How much XAH
  exists, how much is minted, burned and escrowed, and how much circulates." (the network's currency from `NetworkBrief`).
- At the right of the heading row (under it on a phone): "Snapshot at ledger **#107,720,688** · Oct 17, 2026, 16:08 UTC · updated hourly",
  the ledger a link, and the faint source line `/v2/network/supply`.
- With `stale`: a `Notice tone="warning"` under it: "This snapshot is 5 hours older than the newest ledger: the data API has not
  computed a newer one."

### 5.2 The bar (`ShareBar`, compact)

A card `aria-labelledby` its title, "Where the 100 billion XRP are" (XRPL) or "Where the XAH are" (Xahau), the source line, the legend
(`shareLegend`), and the text: XRPL "100,000,000,000 XRP were created in the first ledger and no more can be made. Every transaction burns
a little as its fee, so the total supply only shrinks." Xahau "Xahau has no 100 billion cap: its supply grows by minting, through rewards,
Import and GenesisMint, and shrinks a little as fees are burned. The bar is the total supply."

| | XRPL | Xahau |
| --- | --- | --- |
| row total | `100000000000` | `total` |
| segments, in order | Burned (slot 2), Escrowed (slot 3), Circulating supply (slot 1) | Escrowed (slot 3), Circulating supply (slot 1) |
| caption under a segment of 18% or more | "35.21B XRP · 35.2%" | "595.00M XAH · 97.0%" |
| tooltip share | "35.21% of the 100 billion XRP" | "3.00% of the total supply" |

- XRPL burned is a sliver (0.015%): the bar draws it at least 3 px wide, and a line above the bar says it: "**Burned 14.69M XRP** ·
  0.015% of the 100 billion, a sliver at this scale" (a 2 px rule in slot 2 at its left, as the board).
- Under the circulating segment, from its start to the end, a bracket and "Part of circulating: **46.22M XRP** in AMM pools (0.071% of
  circulating) · **9.81M XRP** held as account reserves (0.015% of circulating)"; Xahau "Part of circulating: **268.97K XAH** held as
  account reserves (0.045% of circulating) · no AMM on Xahau". A part the answer lacks is left out of the sentence.
- The bar is one image with the kit's summary and, after hydration, the kit's slider cursor (arrows, Home, End; the tooltip shows the
  segment, its exact amount with the currency and its share): the kit's protocol, not the board's buttons per segment.
- With escrowed's coverage incomplete, `CoverageNote` under the bar: "Covers ledger #99,413,505 onwards: earlier escrows are not in the
  index yet."

### 5.3 The tiles

`StatGrid` of `StatTile figure` (the board's two or three a row, `minmax(min(360px, 100%), 1fr)`), each: the label, the `aside`
"≈ 99.99B" at its right (9.2), the exact figure with the fraction muted and the currency, the formula line (mono, `= …`) when there is
one, the one-line definition, a `sub` line, and a `CoverageNote` when its part's `coverage.complete` is false.

| Tile | Figure | Formula / sub | Definition | Coverage words |
| --- | --- | --- | --- | --- |
| Total supply | `total` | XRPL `= 100,000,000,000 − burned` | XRPL "All the XRP that exists: 100 billion XRP less what has been burned." Xahau "All the XAH that exists. No 100 billion cap: Xahau's supply grows by minting." | — |
| Minted, last 90 days (Xahau) | Σ of M's rows | — | "New XAH from rewards, Import and GenesisMint." | "mints" |
| Burned | `burned.amount` | — | "XRP destroyed as transaction fees, since the first ledger." | "fees" (Xahau only) |
| Escrowed | `escrowed.amount` | sub "in 12,879 escrows" | "XRP held in escrows." | "escrows" |
| Circulating supply | `circulating.amount` | `= total supply − escrowed` | "The total supply less what is escrowed." | "escrows" |
| In AMM pools (XRPL) | `amm.amount` | — | "XRP held by 14,594 AMM pools. Part of the circulating supply." | "pool changes" |
| Account reserves | `reserves.amount` | `= 6,410,280 × 1 + 16,998,620 × 0.2` | "XRP accounts must keep: 1 XRP each, and 0.2 XRP for every object they own. Part of the circulating supply." | "account changes" |

Order: XRPL Total supply, Burned, Escrowed, Circulating supply, In AMM pools, Account reserves; Xahau Total supply, Minted, Burned,
Escrowed, Circulating supply, Account reserves (the boards'). The base and increment in the definition and formula are the answer's
(`reserves.base`, `reserves.increment`), never constants. Without `reserves` the tile's figure is "—" and its sub "Not known at this
ledger."; without `amm` (Xahau) there is no AMM tile; with M failed the Minted tile is "—" and "Couldn't load the minted days."

### 5.4 Burned per day

`ChartCard id="burned"`, title "XRP burned per day", source `/v2/network/fees?interval=day`, `ColumnChart layout="single"` (slot 1), its
`ChartTable` ("Burned per day", Day and "Burned, XRP"), the Chart/Table toggle, and the summary line: "Last 90 days: **2,376.42 XRP**
burned as fees, 26.4 XRP a day on average. Highest: 61.20 XRP on Oct 3." (the total over the 90 days with today so far; the average over
the 89 full days; the highest of the full days). `TimeSeriesData`: `axis.unit = "day"`, the 90 buckets of the window, `forming: true`
(the newest is today), a day without a row `null` (a gap), `format: { kind: "amount", unit: "XRP" }`, a `token` of the window and the
values.

### 5.5 Minted per day (Xahau)

`ChartCard id="minted"`, title "XAH minted per day, by source", source `/v2/network/supply/minted?interval=day`, `ColumnChart
layout="stacked"` with three series (Rewards slot 1, Import slot 3, GenesisMint slot 5, the board's) and `totals`, the legend
(`legendOf(data, "swatch")`), the `ChartTable` (Day, Rewards, Import, GenesisMint, "Total, XAH"), the summary "Last 90 days: **2.71M XAH**
minted (Rewards 2.21M, Import 455.2K, GenesisMint 40K), 29.9K a day on average", and two notes: the snapshot's sentence ("Since ledger
#2: 49,425,551.616207 XAH minted: 41,203,318.512207 as rewards, 8,102,233.104 by Import, 120,000 by GenesisMint.", the ledger being
`minted.coverage.from_ledger_index`) and the board's "Rewards are paid to accounts that claim them. Import mints XAH for XRP burned on XRPL.
GenesisMint is minted by governance." The days before the first row (outside the minted coverage) are `null`, and the card's
`CoverageNote` says why ("…: earlier mints are not in the index yet.").

### 5.6 States

| State | What the visitor sees |
| --- | --- |
| Switch off | the not-found page (1); the menu's Supply item reads "soon" |
| S fails, or answers 404 `supply not computed yet`, or a route-missing 404, or a malformed body | the try-again page, 503 with `Retry-After`, never stored |
| A, F or M fails | its card's `SectionError` with Retry; the rest of the page stands; degraded |
| A part missing from S (`reserves`, `amm`, `minted`) | its tile left out or "—" (5.3), its words left out of the bar's sentence |
| A part's coverage incomplete | E8's `CoverageNote` under its tile (and the bar, the minted card) |
| Snapshot stale | the warning of 5.1 |
| Loading | none: the Worker renders the page whole; a client navigation keeps the previous page until the data arrives, as every page |
| Node fallback | none: the page calls no node (these figures have no node equivalent); D7 is its only source |

## 6. Both networks and the sandbox

The page is the same on XRPL and Xahau; the differences come from the answer (`minted` present, `amm` absent on Xahau) and from
`NetworkBrief` (the name, the currency). In the sandbox the names are E7's ("XRPL Testnet", "Xahau Testnet") and the Testnet badge is
in the header; XRPL Testnet's genesis also created 100 billion XRP, so the XRPL texts hold. Each environment's switch follows its own
data API (8).

## 7. The switch `SUPPLY`

Appended last to `FEATURE_VARS` (`SUPPLY`) and `FEATURE_NAME` (`supply`) after the switches built before it, with `Env.SUPPLY`, an entry in
every block of `wrangler.jsonc` (top level `"on"`, `sandbox` and `production` `"off"`), `TOP_LEVEL_SWITCHES` in `vitest.config.ts`, and its
README rows. It gates the route (a 404 of class `short`, no call), the menu's Supply item ("soon" while off) and nothing else. The cache
generation strings of `features-off.spec.ts` and, if its name sorts between theirs, `env.test.ts` gain it (README, "Adding a switch").
Turning it on in an environment: decision 11.

## 8. Kit and component additions

The kit's files are not forked; their props grow (E2 §2.11).

### 8.1 `ShareBar`

- `compact` (boolean): one row with no name column and no % axis, 40 px high (the supply bar).
- A drawn segment is at least 3 px wide when `compact` (`.share--compact .share__seg { min-width: 3px }`), so a sliver shows.
- `ShareData` gains, per segment, `caption?: string` (the label under the segment, instead of the share alone: the view builder's
  "35.21B XRP · 35.2%") and `share?: string` (the tooltip's share text: "35.21% of the 100 billion XRP"), and per data `unit?: string`
  (printed after the exact amount in the tooltip and the slider's text). Without them the bar is as today.
- Tests: `ShareBar.test.tsx` gains the compact form, the minimum width, the caption and share texts, and the unit in the slider text.

### 8.2 `StatTile`

`aside?: ReactNode`: a short figure at the right of the label (`.stat__aside`, `--faint`, 12 px, proportional figures). The formula and
the definition go in `sub` as two lines (`.stat__formula` mono, then the text).

### 8.3 `finePercent`

`finePercent(part, whole)` in `app/domain/percent.ts` (not `format.ts`, which is in the shell): two decimals, half up, exact (`35.21%`);
under 1%, two significant digits (`0.015%`, `0.071%`); 0 is `0%`; a whole of 0 or bad text is a dash. Unit-tested beside `sharePercent`.

### 8.4 Coverage

E8's `checkCoverage` (shape), `coverageNote(coverage, words)` (the text) and `CoverageNote` (the line), as they are. E12 adds no coverage
code.

## 9. SEO and link previews

`app/server/meta-supply.ts` (a builder of its own, as every page's): the title "Supply · XRPL" in the form of `meta-network.ts`; the
description from the snapshot ("XRP supply at ledger #107,720,688: 99.99B total, 14.69M burned, 35.21B escrowed, 64.77B circulating.";
Xahau adds minted); a canonical link on the request's origin; `og:*` with the site's default image. No `/og/{net}/supply` image. The page
is indexable (it has one view).

## 10. Search

No change: "supply" is not a search term, and the page names no address, hash or ledger the search does not already know.

## 11. Fixtures

`scripts/supply-fixtures.ts` (seeded generator, synthetic, run by `pnpm fixtures`; `pnpm fixtures:check` compares), with D7's
reference at the commit the plan pins (`test/fixtures/PROVENANCE.md`):

| Path below `<net>/data-api/` | Holds |
| --- | --- |
| `network/supply.json` | XRPL: the snapshot at the recorded ledger 107,720,688 (about 50 minutes before `last_validated` 107,721,455, so not stale), every part, D7's example figures, reserves `complete: false`. Xahau: at 26,596,843, `minted`, no `amm`, every part complete |
| `network/supply/minted@end=2026-10-17&interval=day&limit=1000&start=2026-07-20.json` (Xahau) | the 90 days of the window, seeded: rewards every day, imports most days, one GenesisMint day, today so far |
| `network/fees@end=2026-10-17&interval=day&limit=1000&start=2026-07-20.json` | exists (the network page's 90 days), reused |

Variants for the tests are made inside the tests from these files (E2's way): a 404 `supply not computed yet`, a route-missing 404,
`reserves` absent, escrowed incomplete, a stale snapshot (`close_time` 5 hours before the anchor), a malformed amount. The end-to-end
suite reaches them through `test/e2e/fixture-control.ts`.

## 12. Testing

**Unit and component** (vitest):
- `app/server/supply-view.test.ts`: both networks from the fixtures, figure by figure in exact arithmetic (circulating = total −
  escrowed, the bar's parts sum to the row total, the reserves formula from base and increment); the captions and shares; the tile order;
  missing parts; every coverage note; the stale threshold (3 h exactly is not stale); the 90-day window with a gap, `forming`, the
  average and highest over full days; the minted series before the coverage start; the failed cards.
- `supply-shape.test.ts`, `percent.test.ts` (`finePercent`), `route-handle.test.ts` (`navPageOf`).
- `SupplyPage.test.tsx` (rendered as the Worker prints it and hydrated: tiles, bar, notes, the failed card), `ShareBar.test.tsx`,
  `components.test.tsx` (`StatTile aside`), `Header.test.tsx` (the menu: items, "soon" per switch, current marking on each of the six
  pages, Escape, outside pointer, focus out, navigation closes it), `routes-wiring.test.tsx` (the route, its handle, `headers`).

**Worker** (`test/worker/`):
- `supply-page.spec.ts`: class `slow` and TTL 300; the exact calls and keys (F's key equals the network page's 90-day key; M only when
  S has `minted`; no names call, no node call); the 302; S failing in each way gives 503 never stored; a failed card gives a degraded
  200, not stored; the page without JavaScript (the menu opens with the summary).
- `supply-off.spec.ts` (every switch off: 404 `short`, no call, the item "soon"); `features-off.spec.ts` and the guard's misspelt-name case.

**End-to-end** (Playwright + axe, `test/e2e/`):
- `supply.spec.ts`, both networks: the figures, the bar's cursor by keyboard (Tab to it, arrows, the tooltip text), the toggles of both
  cards, the coverage note (variant), the stale warning (variant), a failed card's Retry; skipped when `SUPPLY` is in `E2E_FEATURES_OFF`,
  with its off-case.
- `header-menu.spec.ts`: Tab to "Network", Enter opens, Tab through the items, Escape closes and focus returns to the summary; a click
  outside closes; clicking Supply navigates and the panel is closed on the new page; `aria-current` on `/xrpl/supply`, on
  `/xrpl/validators/{key}` (`"true"`) and on the summary; the phone layout (375 px: the folded nav, the panel in the flow, 44 px items).
- `a11y.spec.ts`: `/xrpl/supply`, `/xahau/supply`, and a page with the menu open, no axe violations; the contrast of the panel's text in
  both themes (the existing token tests cover the colours).

## 13. Bundle budget

`scripts/bundle-budget.ts` `PAGES` gains `supply` as a dashboard, 160,000 bytes (ruling R19, decision 14). Estimate: the shared base the five pages had (about
131 KB with the manifest), the kit modules the page draws (`ShareBar`, `ColumnChart`, `Plot`, `Cursor`, `ChartCard`, `ChartTable`,
`Legend` and their helpers, about 7 KB, as the network page's), the page and `percent.ts` (about 2 KB): about 141 KB. The menu adds about
0.4 KB to the shell, so to every page (its hook and markup); the projection of E2 left 560 bytes on the network page, so the plan measures
the network page first (`pnpm build && pnpm check:bundle`) and records every page's figure in the README. If the network page goes over its
own budget, the hook moves into `Header.tsx` (no module boundary) before anything else.

## 14. README sections to update

"Switches" (the `SUPPLY` rows: what it gates, the values, the condition of decision 11); "The data API and the node" (`networkSupply`,
`networkMinted`, the pending paths); "The cache classes" (the supply page: `slow` 300 s, its calls); "The UI and the routes" (the route
list, the Network menu, `navPage`); a new section "The supply page" (calls, failures, states, coverage, the stale rule); "The chart kit"
(`ShareBar compact`, `caption`, `share`, `unit`; `StatTile aside`); "SEO and link previews" (`meta-supply.ts`); "Upstream fixtures"
(the files of 11); "End-to-end tests" (the two specs, the a11y pages); "The client bundle check" (the row and the figures); "Tests".

## Dependencies

- **D7** serves `/v2/network/supply` and `/v2/network/supply/minted` (with D3's `coverage` per part); the page is switched on per
  environment only once it does (decision 11). Burned per day reads the existing `/v2/network/fees?interval=day`.
- **E8**: `checkCoverage`, `coverageNote`, `CoverageNote`; the NFTs header item, which the menu change keeps.
- **E11**: the Tokens header item, in place before Network.
- **E6**: the Validators and Amendments pages and their routes' handles (gain `navPage`), behind `VALIDATORS`.
- **E7**: the sandbox block of `wrangler.jsonc` (formerly `staging`) and the testnet names.
- **E2**: the kit, `windowOf`, `SERIES_LIMIT`, `CARD_DEADLINE_MS`, `PERIOD_CALL_TTL_SECONDS`, `navSection`, the switch mechanism.
