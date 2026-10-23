# Network dashboard and chart kit: design (E2)

Date: 2026-10-19. Status: proposed. Sub-project E2 of the explorer program. Repository: `GateHubNet/x-explorer`, branch `feat/explorer-pages`.

## Context

The foundation (`2026-10-17-explorer-foundation-design.md`, built, with the rulings in `../decisions/2026-10-18-explorer-foundation.md`) serves the home, ledger, transaction, account and search pages from one Cloudflare Worker (React Router 8.4, framework mode). The home page follows the chain: it is stored at the edge for 1 s + 2 s (`live-home`), an open page asks the explorer's own `.data` URL again every 4 s, and new rows and figures animate in (README, "Live updates").

This spec adds the **network dashboard**, `/{net}/network`, and the **chart kit** every later page draws its charts with. The approved board is `2026-10-17-explorer-mock/Network.dc.html`; the boards `Markets`, `MarketPair`, `Amm`, `AmmPool`, `Validators`, `Validator`, `Amendments`, `Amendment` and `AccountAnalytics` set the chart types the kit must cover. Their sample data is made up.

The data comes from the data API (`data-api-new`, `docs/api-reference.md` on `main`). `/v2/network/amm_volume` exists only on its branch `feat/amm-data`, which is not merged. The page reads it only while the `AMM_DATA` switch is on (section 6.1).

**E2 is the first explorer sub-project built** (the order is D1, D2, E2, E3, E4, E6, E5). So it also defines the mechanisms the later pages share, in section 6: the switches and the cache generation, the header's section marking (`navSection`), the generic `keepLoaded`, the rule for a data API route that does not exist, the `Anchor`, the shared `windowOf` and the running bucket, the transaction-type groups (`typeGroups`), and the README's list of the pages that follow the chain. The chart kit's data shapes, `SmallMultiplesData` included, are section 2.3. E3 to E6 reference these definitions and do not redefine them.

## Decisions (from the owner)

| Topic | Decision |
|---|---|
| Program | The network, markets and AMM pages and new validators, amendments and account-analytics pages, as seven sub-projects: D1 (validators and amendments data) and D2 (account and market aggregates) in `data-api-new`, E2 to E6 in this repository. This spec is E2. E6 builds the validators pages, at `/{net}/validators`. |
| Mock | The boards are approved. Their sample data is placeholder. |
| Process | Auto-mode build after this spec and its plan are reviewed. |

## Owner decisions to confirm

Product choices of this spec, and its deviations from the approved Network board. Each line is this spec's choice; the owner confirms it or changes it before the build.

| Topic | This spec's choice | Why |
|---|---|---|
| Ledger chips | "84 txs · 3 s ago", the age of the close, not the board's "84 txs · 3.8 s" (the gap to the previous ledger) | Close times are rounded to the close-time resolution (10 s on mainnet), so per-ledger gaps would read 1 s, 9 s, 1 s. The Ledger interval tile carries the average. |
| Queue | "Queue 0", without the board's capacity ("of 2,140") | `fee_stats` stores no queue capacity. Dropped for now; no data sub-project adds it. |
| Xahau display currency | no "Amounts in" choice on Xahau | The Xahau markets config has no USD market. Dropped for now; no data sub-project adds one. |
| AMM volume | the line "AMM swaps, all pools", and a note that it is not a part of the DEX line (the board: "AMM swaps are part of DEX trades") | `amm_volume` counts every pool, `exchange_volume` only the tracked markets, so the AMM line can exceed the DEX line. |
| DEX volume | over the tracked markets, labelled "tracked markets" in the tile and the legend | `exchange_volume` counts the markets config only. An all-market aggregate is dropped for now. |
| Payment volume by currency | no "Other" row; the note names the tracked currencies | `payment_volume` components are the markets-config currencies and the native currency. A per-currency "Other" is dropped for now. |
| Validators card | "35 validators signed ledger #…", counting every validator the collectors heard; "All validators" leads to `/{net}/validators?scope=all` | The collectors hear validators on and off the UNL, so the count is of all of them, and the link opens the list with the same scope. The link target is the owner's instruction (the board's went to the ledger page). |
| Chart/Table toggle | a pair of radios (the board: `aria-pressed` buttons) | It works without JavaScript and is the semantics of an exclusive choice (section 2.5). |
| End labels | a later label that would collide is left out (the board nudges labels apart) | Nudged labels detach from their lines; the legend and the tooltip carry the value. |
| "1 year" | 52 weeks from Monday, up to and including the running week | The running-bucket rule (next line). |
| The running bucket | every chart includes today (or this week), marked "so far"; totals include it; a delta compares full buckets only ("+3.2%, 30 full days to Oct 16 vs the 30 before") | A visitor wants today while it happens (the program's rule, section 6.6). A partial bucket compared with a full one would read as a drop, so deltas leave it out. |
| Unknown query parameters | a 302 to the canonical URL (the foundation's pages ignore them) | A made-up query string would otherwise be a stored page and a set of upstream calls of its own. |
| Open Graph image | none for the dashboard | A picture is out of date within a ledger and costs a Satori render per ledger. The home page has none either. |
| Chart kit | hand-written components, no charting library | A library costs 20 to 100 KB of JavaScript or cannot be in the cached HTML (section 2.1). |
| Switches | one mechanism for every page and feature switch: a per-environment Worker variable, "on" or "off", folded into the edge-cache key (section 6.1). E2 adds `VALIDATORS` (in place of a code constant) and `AMM_DATA` (in place of probing the API for `amm_volume`). | Staging and production can differ from one commit, a typo is refused before a deploy, and a flip never serves a page stored under the other value. |

## Goals

- `/{net}/network` shows every element of the Network board from real data. The cached HTML holds the charts, and they read without JavaScript.
- An open page follows the chain like the home page, with the same refresh, controls and motion rules.
- The chart kit draws every chart type of the remaining boards on the server, with hover, keyboard access, a table view, dark mode and phone layouts, and costs the page less than the JavaScript headroom.
- The page works against the data API on `main`. It shows the AMM series where the `AMM_DATA` switch is on, which the owner turns on per environment once the data API there has the AMM data complete.
- The data API sees no new load pattern: period data is kept for minutes, and live data is shared with the home page.
- The mechanisms of section 6 are defined once, here, precisely enough for E3 to E6 to use them as they are.

## Non-goals

- The markets, market pair, AMM, account analytics, validators and amendments pages. Their charts are built in the kit (section 2), but not the pages.
- Changes to the data API. E2 needs none; what is missing is listed in section 3 with its owner.
- Custom date ranges, hourly buckets, a CSV of chart data, an Open Graph image of the dashboard, texture fills.
- UNL membership and validator names (D1).

---

## 1. The page

### 1.1 Files

| File | |
|---|---|
| `app/routes/net.network.tsx` | Route `network` under `:net` in `app/routes.ts` (route id `routes/net.network`). `loader`, `clientLoader`, `meta`, `headers = forwardCacheClass`, the component. |
| `app/domain/network-params.ts` | Pure, used by the loader and the links: `parseNetworkParams(search, net)` and `networkHref(net, { period, display })`, the period table, the display currencies of each network. |
| `app/server/network-view.ts` | The view builder: one function per call (below), `networkPage`. Pure; unit-tested. |
| `app/ui/pages/NetworkPage.tsx` | Draws the page from `NetworkPageData`. Never fetches. |
| `app/ui/live-page.ts` | `home-live.ts` generalised (section 1.9), and the generic `keepLoaded` (section 6.3). |
| `app/ui/use-live-controls.ts` | `use-home-live.ts` renamed (`useLiveControls`), body unchanged. |
| `app/ui/charts/`, `app/ui/charts.css` | The chart kit (section 2). |
| `app/ui/features.ts` | The switches: their names, `featuresOf`, `NO_FEATURES` (section 6.1). |
| `app/domain/window.ts` | `windowOf` and `utcDayOf`, shared by every page with a period (section 6.6). |
| `app/domain/type-groups.ts` | `typeGroups`, shared by every chart of transactions by type (section 6.7). |
| `app/server/anchor.ts` | `Anchor` and `anchorOf`, shared by every live page (section 6.5). |

Changes elsewhere:

- `data-api.ts` and `api-types.ts`: the new calls (section 1.4), and the "Cannot GET" rule (section 6.4).
- `cache-class.ts`: `PERIOD_CALL_TTL_SECONDS`, and the `live-home` comment (section 6.9).
- `edge-cache.ts`: the failure hold (section 1.7), and the cache generation in the edge key (section 6.1).
- `env.ts`: the switch variables in `Env`, and `cacheGeneration` (section 6.1).
- `networks.ts`: `hasAmm`, and `features` on `Network` (section 6.1).
- `use-network.ts`: `useFeatures()` (section 6.1).
- `route-handle.ts` and `Header.tsx`: `navSection`, and the Network link (section 6.2).
- `net._index.tsx`: the home page's calls opt in to the failure hold (section 1.7).
- `wrangler.jsonc`, `scripts/predeploy-guard.ts`, `vitest.config.ts`: the switches (section 6.1).
- `meta.ts` (`networkMeta`), `StatTile.tsx` (figure style and delta), `DataTable.tsx` (`compact` and `maxHeight`), `use-live-rows.ts` (moves on both axes).
- `scripts/bundle-budget.ts` (the page joins `PAGES`), the fixture generator, the README (section 6.9).

### 1.2 URL and search parameters

| Parameter | Values | Default | Notes |
|---|---|---|---|
| `period` | `7d`, `30d`, `90d`, `1y` | `30d` | `7d`, `30d` and `90d` are days; `1y` is 52 weeks starting on Monday (section 1.5). |
| `in` | `usd` on XRPL; none on Xahau | the native currency | XRPL `usd` is USD issued by GateHub, `rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq`, one of the API's tracked markets against XRP. The Xahau markets config has no USD market, so Xahau has no `in` (section 3). |

**One URL per view.** The loader reads only these two parameters. When the query string is not exactly the canonical form of what it names, the loader answers a 302 to the canonical URL (`cacheClassHeaders("short")`, as the account page tidies `?tab=`). The canonical form drops defaults (`?period=30d`), unknown values (`?period=2y`, `in=usd` on Xahau), repeats and unknown parameters, and orders the rest `period`, then `in`. The cost of a render is the reason this page drops unknown parameters and the other pages do not: a made-up query string would otherwise be a stored page and a set of upstream calls of its own (README staging checklist).

**Indexing.** `/{net}/network` is indexable, with a canonical URL. Every other view is `noindex, follow`, with no canonical link and no `og:*` tags, as an account page behind a marker is.

The selectors are links (`networkHref`), so they work without JavaScript. With JavaScript they are client-side navigations with `preventScrollReset`.

### 1.3 Layout and content

From the top, as on the board. On a phone the same order, in one column.

| Element | Content |
|---|---|
| Heading row | `<h1>` "{XRPL\|Xahau} network". The status: the live dot and "Live · updates every ledger", then `LiveStatus`, the held note and `LiveToggle`. These are the home hero's parts and classes, and the row is 44 px high from the start. |
| Latest ledgers (`section aria-label="Latest ledgers"`) | The newest 6 ledgers as chips, each a link to `/{net}/ledger/{index}`: "#107,695,660" (mono) over "84 txs · 3 s ago" (`RelativeTime` of the close time). Beside them, the open ledger: "Open ledger fee **10 drops**", "Queue **0** · 84 of 96 expected in the open ledger", "as of 17:01:12 UTC", and the source line. Chip text is `--fg` and `--muted` only. Light `--faint` on `--sunken` is 4.59:1 and falls to 4.47:1 under the live wash, and the Xahau link colour on `--sunken` is 4.40:1. On a phone (under 640 px) the newest 3 chips show, with the open ledger below them. |
| Filters (`role="group" aria-label="Filters"`) | "Period" with 7 days, 30 days, 90 days, 1 year. "Amounts in" with {native}, USD (XRPL only). Both are segmented controls of links, the current one marked `aria-current="true"`, 32 px to look at with a 44 px target (the `netswitch` pattern). Then the period note, `windowOf`'s words (section 6.6): "Totals and charts cover the 30 days from Sep 18 to Oct 17, 2026 (UTC), today so far". With `in=usd` it adds ", amounts in USD issued by GateHub at each day's DEX rate". For `1y` it reads "the 52 weeks from the week of Oct 20, 2025 to the week of Oct 12, 2026 (UTC, weeks from Monday), this week so far". |
| Totals (`section aria-label="Totals"`), six `StatTile`s | Transactions; Ledger interval ("3.91 s", sub "average time between ledgers"); Transactions per ledger; Accounts created; Payment volume; DEX volume. Each figure covers the window, the running bucket included. The first, third, fourth and fifth have a delta over full buckets only (section 1.6): "+3.2%, 30 full days to Oct 16 vs the 30 before" (or "52 full weeks to Oct 11 vs the 52 before"), a triangle icon and the signed text in `--muted`, because more is neither good nor bad. The DEX tile's sub follows the AMM state (section 1.6): "AMM swaps 1.2B, all pools" (`ok`); "tracked markets, AMM swaps included" (`failed`); "tracked markets" (`off`); "order book only, no AMM on Xahau" (`none`). The grid is `repeat(auto-fit, minmax(150px, 1fr))`, so a phone has two per row. |
| Transactions by type, per day \| week | Stacked columns, with a legend and the Chart/Table toggle (section 2). |
| Average fee per transaction, in drops | A single line with an area. The note reads "1 XRP = 1,000,000 drops. Spikes mean the open ledger was busy. The minimum to enter the queue now is 10 drops." The last sentence comes from `fee_stats` `minimum_fee` and is left out when that call failed. |
| Volume per day \| week, in {currency} | Lines, with a legend and end labels. The lines and the note follow the AMM state (section 1.6). `ok` (XRPL, `AMM_DATA` on): "Payments", "DEX trades, tracked markets, AMM swaps included" and "AMM swaps, all pools", with the note "DEX trades count the markets the data API tracks; AMM swaps count every pool, so the lines are not parts of one total." `failed`: the first two lines with the same wording, and "AMM swaps couldn't be loaded" with Retry (section 1.8). `off` (XRPL, `AMM_DATA` off): "Payments" and "DEX trades, tracked markets", with the note "DEX trades count the trades of the markets the data API tracks." `none` (Xahau): the same two lines, with the note "Xahau has no AMM; DEX trades are order-book trades of the markets the data API tracks." |
| Payment volume by currency, last 30 days \| last 52 weeks | A `BarList`: one row per currency and issuer, "1.24B XRP · 58%". |
| Validators | "**35** validators signed ledger #107,695,660" (the ledger number links to the ledger page). Under "First seen": 5 keys, short form in mono, each with "+40 ms" after the first validation of that ledger, by `first_datetime`. The note reads "Counts every validator the data API's collectors heard, on the UNL or not." The link "All validators" goes to `/{net}/validators?scope=all`, the list with the same scope as the count. It is a link only while the `VALIDATORS` switch is on (section 6.1); while it is off it is the header's "soon" style. The view builder puts the href (or `null`) in the card's data, from `net.features.validators`. |

Each chart card shows its source in the board's faint mono line (`/v2/stats/type?interval=day`): paths only, never a host or a key.

**Deviations from the board**

| Board | Here | Why |
|---|---|---|
| Chip "84 txs · 3.8 s", the time since the previous ledger | "84 txs · 3 s ago" | Close times are rounded to the close-time resolution (`close_time_resolution` "10" on mainnet), so per-ledger gaps would read 1 s, 9 s, 1 s. The average is the Ledger interval tile. |
| "Queue 0 of 2,140" | "Queue 0" | `fee_stats` stores no queue capacity. The API's own `pct_max_queue_size` assumes 20 × expected and ignores the node's 2,000 minimum. |
| "Amounts in XAH / USD" on Xahau | no currency choice on Xahau | No USD market in the Xahau markets config (section 3). |
| DEX tile "AMM swaps X of it"; note "AMM swaps are part of DEX trades" | "AMM swaps X, all pools"; the note says the lines are not parts of one total | `exchange_volume` counts the tracked markets only, while `amm_volume` counts every pool, so the AMM line can exceed the DEX line. |
| Payment volume "Other" row | none; the note names the tracked currencies | `payment_volume` components are the markets-config currencies plus the native currency. |
| "35 signed ledger #…" (reads as the UNL) | "35 validators signed ledger #…" | The collectors hear validators on and off the UNL; UNL membership is D1's. |
| "All validations of this ledger →", to the ledger page | "All validators", to `/{net}/validators?scope=all`, behind the `VALIDATORS` switch | The owner's instruction; the scope matches the count. |
| Chart/Table as `aria-pressed` buttons | a pair of radios | Works without JavaScript (section 2.5) and is the semantics of an exclusive choice. |
| End labels nudged apart when they collide | the later label is left out | Stacked labels detach from their lines (dataviz anti-pattern); the legend and the tooltip carry it. |
| "1 year" | 52 weeks from Monday, the running week included and marked "so far" | The running-bucket rule (section 6.6). |
| Deltas against the previous period | over full buckets only, and the sub names that window | The running bucket is partial (section 1.6). |

Every line of this table is also in "Owner decisions to confirm" at the top.

### 1.4 Data calls

All calls go to the data API. The node is not called: `fee_stats` is a snapshot of the node's `fee` command, taken by the syncer every 5 s, and it holds the open ledger fee, the queue and the open ledger size (section 3).

| # | Call | Query | Subrequest class, kept | Shared with | Feeds | On failure |
|---|---|---|---|---|---|---|
| 1 | `/v2/last_validated` | | `live`, kept 2 s (`HOME_CALL_TTL_SECONDS`) | home (same key) | the anchor: index day, order key, newest ledger | 503 (`upstreamOutage`) |
| 2 | `/v2/network/fees` | `descending=true&limit=8` | `live`, kept 2 s | home (same key) | the chips (the newest 6) | 503 (`upstreamOutage`) |
| 3 | `/v2/ledgers/{latest}` | only when #1's index is not `latest` | `immutable` | home (same key) | the hash for #4 | validators card failed |
| 4 | `/v2/ledgers/{hash}/validations` | `limit=1000` | `live` (5 s) | | validators card | card failed |
| 5 | `/v2/network/fee_stats` | `descending=true&limit=1&start={T}` | `live`, kept 2 s | | open ledger block, fee note | block failed |
| 6 | `/v2/stats/type` | `interval={u}&start={W₀}&end={T}&limit=1000` | `slow`, kept 300 s | | transactions by type | card failed |
| 7 | `/v2/stats/metric` | `interval={u}&start={P₀}&end={T}&limit=1000&metrics=accounts_created,ledger_count,transaction_count` | `slow`, kept 300 s | | tiles 1 to 4 | those tiles "—" |
| 8 | `/v2/network/fees` | `interval=day&start={W₀}&end={T}&limit=1000` | `slow`, kept 300 s | | fee chart | card failed |
| 9 | `/v2/network/payment_volume` | `interval={u}&start={P₀}&end={T}&limit=1000` [`&exchange_currency=USD&exchange_issuer=rhub8V…`] | `slow`, kept 300 s | | payment tile, Payments line, by currency | volume card and bars failed, tile "—" |
| 10 | `/v2/network/exchange_volume` | `interval={u}&start={W₀}&end={T}&limit=1000` [`&exchange_…`] | `slow`, kept 300 s | | DEX tile, DEX line | volume card failed, tile "—" |
| 11 | `/v2/network/amm_volume`, only when `AMM_DATA` is on and the network `hasAmm` (XRPL) | as #10 | `slow`, kept 300 s | | AMM line, DEX tile's sub | the line is missing, with a note in the card (section 1.8) |

`u` is `day` or `week` (section 1.5); #8 is always `day`. `T` is the index day; `W₀` is the first bucket of the window W, `P₀` the first bucket of P, the window the deltas compare against (section 1.5). `PERIOD_CALL_TTL_SECONDS = 300` goes in `cache-class.ts`, and with it the calls have cache entries of their own (`[kept 300 s]`). Their keys change once a day, when `T` does. The running bucket moves on within the day, and the newest closed day can still be finalised by the API's aggregator in the first hour or two after midnight UTC. 300 s bounds how late either shows.

**New client methods** (`data-api.ts`; types in `api-types.ts` from the reference): `feeStats`, `stats(family, q)`, `fees(q)` extended with `interval`, `start` and `end`, `paymentVolume`, `exchangeVolume`, `ammVolume` and `ledgerValidations(hash, q)`. Each answer's shape is checked inside the cached load: a list where a list belongs, dates as text, amounts as decimal strings. A malformed 200 is an `UpstreamError` of kind `server` and is not stored, as `tx-shape.ts` does.

**`amm_volume` and the switch.** The page asks for `amm_volume` only while `AMM_DATA` is on (section 6.1), never to find out whether the route exists. The owner turns `AMM_DATA` on in an environment once its data API has merged `feat/amm-data`, re-ingested its history with the AMM parser and back-filled. With the switch on, every failure of #11 is a failure: a "Cannot GET" 404 (an API without the route) is kind `server` by the rule of section 6.4, so it is held, logged and never stored, and the card says the AMM line couldn't be loaded. `/v2/network/amm_volume` is not in `api/openapi.yaml` yet, so it lives in `PENDING_PATHS`, outside the compile-time check. `test/unit/pending-paths.test.ts` fails once `pnpm api:sync` brings it in, and says to move it into `PATHS` (section 5).

### 1.5 The window

The window is the shared `windowOf(T, period)` (section 6.6), with the program's running-bucket rule. `T` is the UTC day of `last_validated`'s `close_time` (`utcDayOf(anchor.closeTime)`), not the wall clock. The window follows the index: an index that is behind shows the days it has, and the tests and the e2e suite get fixed query strings from the recorded `last_validated`.

| Period | Bucket | Window W (charts, totals) | Full F (deltas) | Previous P (deltas) |
|---|---|---|---|---|
| `7d`, `30d`, `90d` | UTC day | `T` and the N−1 days before it: `T−(N−1)` … `T`, the last one running | the N full days before `T`: `T−N` … `T−1` | the N days before F |
| `1y` | week, Monday 00:00 UTC (the API's) | the 52 weeks up to and including the week of `T`, the last one running | the 52 full weeks before the week of `T` | the 52 weeks before F |

The running bucket (today, or this week) is charted and marked "so far" (`forming`, section 2.3): its date reads "Oct 17, 2026, so far" in the tooltip, the slider and the table. The calls ask from `W₀` (or `P₀` for #7 and #9, which feed deltas) to `end={T}`; `end` is inclusive at its precision in the API, so a date is the whole day, and today's row holds what has happened so far. With the recorded XRPL `last_validated` (2026-10-17T17:01:12Z):

- `30d`: W is 2026-09-18 to 2026-10-17; F is 2026-09-17 to 2026-10-16; P is 2026-08-18 to 2026-09-16, so `P₀` = 2026-08-18.
- `1y`: W is the weeks of 2025-10-20 to 2026-10-12 (`end=2026-10-17`); F is the weeks of 2025-10-13 to 2026-10-05; P is the weeks of 2024-10-14 to 2025-10-06, so `P₀` = 2024-10-14.

Every series is aligned to W's bucket list by date. A row outside it is ignored (#7 and #9 rows before W feed only the deltas); a bucket without a row is `null`, or `pending` by the rule of section 1.6.

**Which routes have the running bucket.** `stats` (#6, #7) comes from an hourly rollup the aggregator keeps for the last two hours every minute, and `fees` (#8) is computed from the ledgers at query time: both have a row for today as it goes. The volumes (#9 to #11) count a day only once the ingest has passed it by an hour (the reference: "a day counts as final"). Their running day therefore has no row until the next day: it is `pending`, a gap with the card's note "Oct 17 is not computed yet." A running week of `1y` has a row with the days computed so far.

### 1.6 The loader

1. `requireNetwork`. Then the canonical-query redirect (section 1.2).
2. `lastValidated({ ttl: HOME_CALL_TTL_SECONDS, holdFailure: true })`. If it fails, `upstreamOutage(err, "the network")`. The anchor (`anchorOf`, section 6.5), `T` and the window come from it.
3. Side by side, all awaited with `Promise.allSettled`: #2, #5 to #10, #11 when `net.features.ammData && net.hasAmm`, and the validators chain. The chain waits for #2, takes `latest = latestLedgerIndex(last, rows)` (the home rule, one ledger on the page), and takes the hash from `last_validated` when its index is `latest`, else from #3. Then it calls #4. Every call of the page, #1 and #2 included, passes `holdFailure: true` (section 1.7). Every card-level call and the chain are raced against a deadline of 4.5 s from the start of the loader; past it the card is `failed` with the reason "took too long", as the account page's list.
4. #2 failing is `upstreamOutage`, after everything has settled, so nothing runs on behind an answered request.
5. `networkPage(...)` builds the data. Every failed card is logged (`logProblem`), and the request is marked degraded (`markDegraded(context, reasons)`). The AMM states `off` and `none` are answers, not failures.
6. `cached({ ...page, anchor, build: BUILD_ID }, "live-home")`.

**Nothing is streamed or deferred.** The page is one answer that an open tab fetches again every beat, and `OnScreen` keeps or replaces it whole. A streamed part would reach a revalidation as a promise. The slow calls (#6 to #11) are kept 300 s, so a render almost always finds them warm. The worst case of a miss is the 4.5 s deadline.

**View builder rules** (`network-view.ts`):

| Part | Rule |
|---|---|
| Strip | Rows newest first, `ledger_index ≤ latest`, the first 6: index, `tx_count`, `date` (unix seconds for `RelativeTime`). |
| Open ledger | Fees in drops: `BigNumber(String(x)).shiftedBy(6)`, rounded to a whole drop. Queue, open size and expected size as integers; `date` as `HH:MM:SS`. |
| Type groups | `typeGroups(net.id)` (section 6.7): fixed per network, so a colour follows its group whatever the period. A bucket's value per group is `groupCounts` of its row; a missing key in a present row is 0. The note is `typeGroupsNote(net.id)`. |
| Totals | Over W, the running bucket included. Transactions = Σ `transaction_count`. Ledger interval = Σ seconds of the present buckets of W / Σ `ledger_count` of those buckets, to 2 decimals, half up (from `ledger_count`, not the API's `ledger_interval`, which overstates a database's first bucket). A full bucket counts its length; the running bucket counts the seconds from its start to `anchor.closeTime`. The rollup can be a minute behind the index, which moves a 7-day figure by less than 0.01%. Transactions per ledger = Σ `transaction_count` / Σ `ledger_count`, 1 decimal. Accounts created = Σ. Payment volume and DEX volume = Σ `total` of W's buckets that have a row; while the newest buckets are pending, the tile's sub adds "to Oct 16; Oct 17 not computed yet", so the tile never claims a day it does not count. All with `bignumber.js`. |
| Deltas | Over full buckets only: `(ΣF − ΣP) / ΣP`, 1 decimal, with a sign, where F and P are section 1.5's. The running bucket is partial, and a partial bucket against a full one would read as a drop. Shown only when F and P both have every bucket and ΣP > 0; otherwise the tile has no delta. The sub names the window: "+3.2%, 30 full days to Oct 16 vs the 30 before". |
| Fees | A day's value is `avg` in drops (today's is the day so far). A week's (for `1y`) is Σ `total` / Σ `tx_count` of its days, in drops, rounded half up: 7 days, or the days up to `T` for the running week. A week with one of those days missing is `null`. |
| Volumes | `total` per bucket (exact strings). Payment by currency: the components of W summed per `currency + issuer`, sorted by converted amount, with shares to whole percents ("<1%" below 0.5). A 40-hex code is shown through `formatCurrency`, with the issuer short under it. |
| AMM | `ok` (#11 answered), `failed` (#11 failed, "Cannot GET" included), `off` (XRPL with `AMM_DATA` off: no call), or `none` (`hasAmm` false: no call). The DEX tile, legend and note wording follow it (section 1.3). With `AMM_DATA` on, the API counts swaps as exchanges (the owner turns it on only then), so "AMM swaps included" is true in `ok` and `failed`. With it off the explorer does not know, so the wording says neither. |
| Validators | Count = rows (with a `marker`, "1,000+"). The 5 earliest `first_datetime`, each "+N ms" after the earliest. Key short form `nHUFE9prPX…a3p`. The link: `/{net}/validators?scope=all` when `net.features.validators`, else `null`. |
| Pending | The newest buckets of W without a row, counted back from the running bucket, at most two (the running bucket, and the day before in the first hours after midnight UTC), are `pending` (section 2.3): a gap, "Not computed yet" in the tooltip, and the card's note "Oct 17 is not computed yet." or "Oct 16 and Oct 17 are not computed yet.". A missing bucket before them is `null` ("No data for Oct 3"). |
| Tokens | Every chart's data and every card carry a `token`: an FNV-1a hash of what is drawn (section 2.9). |

### 1.7 Caching

**Edge class: `live-home`, 1 s + 2 s, kept (justified).** The strip, the open ledger fee and the validators card change with every ledger, and an open tab asks every 4 s. With `live` (5 s + 30 s) a beat could be handed a copy 35 s old, ten ledgers behind, and the strip would jump in steps. With 1 s + 2 s the page is at most about 5 s behind, as the home page is (README). The cost is bounded:

- **Renders.** With single flight, at most about one render per second per Worker instance per view: 8 XRPL views and 4 Xahau views.
- **Data API calls.** A render reads #1, #2 and #5 from entries kept 2 s and shared with the home page, and the period calls from entries kept 300 s. #4 is a new key once per ledger.

The class keeps its name. Its comment in `cache-class.ts` and the README say it is the class of the pages that follow the chain, and list them: home and network. Each later page of the class adds itself to that list (section 6.9). `HOME_CALL_TTL_SECONDS` keeps its name too, because #1 and #2 must hit the home page's entries.

**The failure hold (new).** A degraded answer is never stored and never shared by single flight. So while one card's upstream fails, every beat of every open tab is a render that calls that upstream. With a thousand tabs that is about 250 calls a second, enough to spend the explorer key's rate limit and fail every page. `createSubrequestCache().json` therefore takes `{ holdFailure: true }`. When such a load throws an `UpstreamError` of kind `server`, `timeout`, `network` or `rate_limited`, the error is remembered in memory for `FAILURE_HOLD_SECONDS` (5 s), or for a `rate_limited` answer's `Retry-After` (at most 30 s). Within that time a call with `holdFailure` for the same key throws it again without calling the upstream.

The hold:

- is per Worker instance;
- keeps at most 256 keys (the oldest go first);
- never goes into the Cache API;
- never applies to `not_found` or `bad_request`.

**Who opts in: every polling page, for every upstream call it makes.** A page polls when an open tab asks for it again by itself. In E2 that is the home page (its three calls: `lastValidated`, `fees` and the first page of `transactions`; `net._index.tsx` gains the option) and the network page (#1 to #11). The later polling pages do the same: E3's pair page, E6's validators and amendments pages. A page that does not poll (ledger, transaction, account, search, E3's markets page, E5's AMM pages) need not opt in, because a visitor's reload of it is not a herd. One may still opt in for a reason its spec gives: E4's analytics calls do. The hold is per key, so the home and network pages, which share the keys of #1 and #2, share one held failure. A Retry pressed within the hold gets the held failure; the next beat after it gets a fresh answer.

### 1.8 Failures, card by card

| What failed | Page | Stored |
|---|---|---|
| #1 or #2 | 503 with `Retry-After`. The edge serves the stored copy if there is one. An open page keeps itself (section 1.9). | no |
| #3 or #4, or the chain's deadline | Validators card: `SectionError` "Couldn't load the validators" and Retry | no (degraded) |
| #5 | The open ledger block: "Couldn't load the open ledger", Retry. The fee note leaves out its last sentence. | no |
| #6, #8 | That chart card: `SectionError` in place of the plot and the toggle | no |
| #7, #9, #10 | Their tiles show "—" with "Couldn't load"; one `SectionError` under the tiles, "Couldn't load some totals"; #9 or #10 also fails the volume card, and #9 the by-currency card | no |
| #11 (`AMM_DATA` on), any failure, a "Cannot GET" 404 included | The volume card draws Payments and DEX, and says "AMM swaps couldn't be loaded" with Retry. The DEX tile's sub reads "tracked markets, AMM swaps included". | no (degraded) |
| `AMM_DATA` off (XRPL), or Xahau | No #11 call. The AMM line, legend entry, end label and table column are left out; the DEX wording is the `off` or `none` one (section 1.3) | yes (an answer) |

Retry is `useRevalidator().revalidate()`, the explorer's own `.data` URL, as on the account page. It works while the visitor has paused the updates.

### 1.9 Live updates

**No new polling scheme.** `useLiveRefresh` is used as it is: 4 s while visible, backoff 4 to 60 s, the 10 s give-up, pause, hold and visibility rules. What is generalised:

| Home today | Generalised | Network page |
|---|---|---|
| `createHomeOnScreen()` (`home-live.ts`) | `createLiveOnScreen<T extends { build: string }>({ order, merge? })` (`live-page.ts`). A different `build` reloads once per pair of builds (code moved as it is). An answer with `order(next) < order(shown)` is refused. An accepted answer is `merge(next, shown)` when the scope is on screen. | `order = d => d.anchor.lastValidated` (section 6.5), `merge = (next, shown) => keepLoaded(next, shown, NETWORK_PARTS)` (section 6.3) |
| `OnScreen` (`on-screen.ts`) | gains the optional `merge`, applied only to an accepted answer for the scope on screen | |
| `useHomeLive(store)` | `useLiveControls(store)`; one `sessionStorage` key for the tab, so a pause on one page holds on the other | the same |
| `useLiveRows` measures `top` | measures `left` and `top` and slides with `translate(dx, dy)`; the tables only ever move on y | the chips (x) |
| home scope `params.net` | scope is the caller's | `${net}${canonical search}`, so a refresh of another view never stands in for this one |

`net.network.tsx` wires it as the home route does: a module-level `onScreen`, a `clientLoader` that calls `onScreen.reload(scope, serverLoader)`, `useEffect(() => onScreen.show(scope, loaderData))`, and the page keyed by `scope` (a period or network change remounts it, which is a first render and is not animated). The `/:net` layout already says `onlyWhenParamsChange`, so a beat is one request: `/{net}/network.data?…&_routes=routes%2Fnet.network`.

**The merge: `keepLoaded` over the page's parts.** `NETWORK_PARTS` (in `net.network.tsx`) names the parts of `NetworkPageData` that a beat may keep, one per call or chain: `openLedger` (#5), `validators` (#3, #4), `types` (#6), `metrics` (#7), `fees` (#8), `payments` (#9), `exchanges` (#10) and `amm` (#11). The tiles and cards are drawn from them. A beat whose answer has a part `failed` where the page shows it loaded keeps the shown part (section 6.3). A transient failure does not flash an error every 4 s, and period data moves at most every 300 s anyway. The live cards name their ledger or their "as of" time, so a kept one says how old it is. A part that has never loaded shows its error.

**What moves on a beat** (CSS and the existing script; nothing new):

| Part | How |
|---|---|
| Chips | Keyed by ledger index. A new chip enters (`is-entering`: fade and slide from −8 px on x, wash and mark); the others slide with FLIP; the oldest leaves. |
| Open ledger figures, validator count, its ledger number, the 5 keys (one `LiveValue` keyed by the ledger hash), tiles | `LiveValue` with the shown text as its token |
| A chart whose `token` changed | Section 2.9: the plot's mark fades out; nothing moves |

`prefers-reduced-motion: reduce` keeps the colours alone, as on the home page. No `aria-live` region: `LiveStatus` is the one `role="status"`.

**Hold.** A mouse or pen over the strip, or keyboard focus on a chip, holds the page (the home rules, `holdsFocus`). The row then says "Paused while you look at the ledgers". The charts do not hold: their data moves at most every 300 s (the running bucket), a change redraws in place under the cursor, and a beat with the same token re-renders nothing (section 2.9).

### 1.10 SEO, links, navigation

| | |
|---|---|
| `<title>` | "XRPL network · explorer"; a non-default view "XRPL network · last 90 days · explorer" (with "· in USD") |
| Description | "Transactions by type, fees, payment and DEX volume, and the validators of {XRPL\|Xahau}, updated with every ledger." No numbers: the page is stored for a second. |
| Default view | canonical `/{net}/network` on the request's origin; `og:title`, `og:description`, `og:url`, `og:type=website`, `og:site_name`; `twitter:card=summary` |
| Other views | `noindex, follow`, no canonical, no `og:*` |
| Open Graph image | None. A dashboard picture is out of date within a ledger and costs a Satori render per ledger. The home page has none either. |
| Header | "Network" becomes a link to `/{net}/network`. The route's `handle = { navSection: "network" }` marks it (section 6.2): `.is-current`, and `aria-current="page"` on `/{net}/network`, which is the section's own page. Markets and AMM stay "soon" until their switches are on (E3's `MARKETS`, E5's `AMM_PAGES`). |
| Links out | chips and the validators card's ledger → `/{net}/ledger/{index}`; "All validators" → `/{net}/validators?scope=all` while `VALIDATORS` is on ("soon" while it is off) |

---

## 2. The chart kit

### 2.1 Decision: hand-written, no library

| Option | Initial JS, gzip | Server-rendered into cached HTML | Verdict |
|---|---|---|---|
| **Hand-written components and geometry** | about 7 KB for what the network page loads | yes | **chosen** |
| d3-scale + d3-shape (+ d3-array, -interpolate, -format, -time) | about 25 KB | yes, as path data | over the headroom |
| uPlot, Chart.js | 20 to 65 KB | no (canvas) | cannot be in the HTML |
| Recharts, visx | 100 KB and more; visx needs d3 | partly | over the headroom |

Today home loads 134,450 B of the 150,000 B budget, and the base every page shares is about 130 KB. The network page's target is **145,000 B or less**. If the build says more, `Cursor.tsx` and the tooltip are loaded with `import()` on the first `pointerenter` or `focusin` of a plot, as the search classifier is. That fallback is decided now. Nothing in the kit imports a charting package. `test/unit/charts-bundle.test.ts` allows `react`, the kit's own files, `app/domain/format.ts` (`bignumber.js` is in the bundle already) and `app/ui` helpers, and nothing from `app/server` at run time. The kit has no barrel file, so a page loads only the modules it imports.

### 2.2 Rendering

Charts render as part of the page, in the Worker and again in the browser for hydration, from the same props. The cached HTML has every mark, and CSS (`charts.css`) draws them with no script. The kit draws each mark in the medium that keeps its spec at any width:

- **SVG** for lines, areas and steps: one `<svg viewBox="0 0 1000 H" preserveAspectRatio="none">` stretched to the plot, `vector-effect: non-scaling-stroke`, so a line is 2 px at any width.
- **HTML boxes** for columns, stack segments, candles, bars, dots, labels, the crosshair and the tooltip, positioned in percent. A column must stay at most 24 px wide, with a 4 px top radius and a 2 px gap. A stretched viewBox cannot keep those, and SVG attributes cannot say `min(24px, 72%)`.

This is the board's own construction. Geometry is computed on render by pure functions (`geometry.ts`). Everything is deterministic, with no `Intl`, locale or clock, so hydration matches.

### 2.3 Data shapes

View builders hand the kit exact decimal strings. The kit parses them with `Number()` for geometry and nothing else. Every text a chart shows (tooltip, end label, table, `aria-valuetext`) is made from the strings.

```ts
// app/ui/charts/types.ts (type-only; view builders import these types)
type Slot = 1 | 2 | 3 | 4 | 5 | "other" | "up" | "down" | "neutral";
type ValueKind = "count" | "amount" | "drops" | "percent" | "seconds" | "price";
interface ValueFormat { kind: ValueKind; unit?: string }             // unit: "XRP", "USD", "drops"
interface TimeAxis {
  unit: "day" | "week" | "hour" | "flag";                            // "flag": one point per flag ledger, evenly spaced
  buckets: string[];                                                 // UTC: YYYY-MM-DD, or YYYY-MM-DDTHH:mm:ssZ; oldest first
}
interface Series { id: string; label: string; short?: string; slot: Slot; values: (string | null)[] }  // null: no value
interface TimeSeriesData {
  axis: TimeAxis;
  series: Series[];                                                  // in their fixed order; stacks bottom up
  format: ValueFormat;
  totals?: (string | null)[];                                        // stacks: exact totals per bucket
  domain?: { min?: string; max?: string };                           // lines only; the card's note must state a non-zero start
  references?: { value: string; label: string }[];
  annotations?: { bucket: number; symbol: string; label: string }[];
  forming?: boolean;                                                 // true: the newest bucket is the running one ("so far")
  pending?: number;                                                  // how many of the newest buckets are not computed yet (0 to 2)
  token: string;
}
interface SmallMultiplesData {
  axis: TimeAxis;                                                    // shared by every panel
  panels: {
    id: string;
    label: string;                                                   // the panel's heading: "XRP", "RLUSD"
    sublabel?: string;                                               // under it: the short issuer, "rMxCK…5De"
    values: (string | null)[];                                       // one per bucket of the axis
    format: ValueFormat;                                             // the panel's own unit
  }[];                                                               // in their fixed order, at most 6
  forming?: boolean;
  pending?: number;
  token: string;
}
interface BarListData { items: { id: string; label: string; sublabel?: string; value: string; share: string; count?: string }[]; format: ValueFormat; token: string }
interface ShareData { rows: { id: string; label: string; total: string; segments: { id: string; label: string; slot: Slot; value: string }[] }[]; token: string }
interface MeterData { value: string; max: string; threshold?: { value: string; label: string }; label: string }
interface CandleData { axis: TimeAxis; candles: ({ o: string; h: string; l: string; c: string; v: string; n: string } | null)[]; format: ValueFormat; volume: ValueFormat; token: string }
```

API numbers that are JSON numbers (counts, fees) are turned into strings in the view builder with `String(n)` (integers) or `BigNumber(String(n))`. Nothing computed in floating point reaches a label.

**`forming` and `pending`.** `forming: true` says the newest bucket of the axis is the running one (section 6.6). It is drawn as any bucket; its date reads "Oct 17, 2026, so far" (a week: "Week of Oct 12, 2026, so far") in the tooltip, the slider's `aria-valuetext` and the table. `pending: n` says the newest `n` buckets have no value because the route has not computed them yet: their values are `null`, the tooltip reads "Not computed yet", and the card notes "Oct 17 is not computed yet." A `null` before them is "No data". Both are `boolean` and `number` on every form that has them; E3's `CandleData.forming` is the same `boolean`.

**`SmallMultiplesData`** is the one shape of `SmallMultiples` (section 2.11). E4's balance history (one panel per currency, its issuer as the `sublabel`) and E5's reserves (one panel per asset) build it; neither adds fields to `Series` for panels. Every panel is drawn in slot 1. Each has its own y scale with 3 nice ticks, from 0, or from the panel's lowest value when that is below 0 (an account's negative balance on a line it owes). The card's notes must say that each panel has its own scale, in the page's words ("Each currency on its own scale"). The panel header's readout is the hovered bucket's value, else the newest non-null one, `compactNumber` with the panel's unit. The table view is the bucket column and one column per panel, headed by `label` and `sublabel`, cells exact.

**Growth by later specs** (each adds its own, as section 2.11 allows; E2 does not add them). Among them: `TimeSeriesData.extras` (per-bucket figures shown in the tooltip and the table, never drawn) and `TimeAxis.unit` `"month"` are E4's; `CandleData.forming`, `TimeAxis.unit` `"minute"` and `BarList` items' `href` are E3's.

### 2.4 Scales, ticks, numbers, time

| | Rule |
|---|---|
| Value scale | From 0 for columns, bars and areas, always. Lines may take `domain`. Nice ticks: a step of 1, 2, 2.5 or 5 × 10ⁿ giving 4 or 5 ticks, the top tick at or above the maximum. Counts have whole steps. All zero: 0 to 4 (counts) or 0 to 1. Diverging: symmetric about 0. |
| Tick labels | `tickLabel(n)`: 0, 500K, 1M, 2.5M, 1.2B (K, M, B, T; at most 3 significant digits; trailing zeros dropped). Under 10,000 in full with separators. Percent "99.5%". `--faint`, 11 px, `tabular-nums`. The gutter width is `calc(Nch + 8px)` from the longest label, so nothing is measured. |
| Value text | `compactNumber(value: string)`, new in `app/domain/format.ts`, with BigNumber: at or above 10,000, 3 significant digits and a suffix (12.9K, 4.2M); from 1, grouped with at most 2 decimals; under 1, 3 significant digits; half up. Tooltips and end labels use it, with the unit ("45.5M XRP", "113 drops"). Counts in tooltips are full ("1,284,331"). Table cells are full (`formatAmount`). |
| Time | All buckets UTC. `bucketLabel`: "Oct 16" (day); "Oct 12" for a week, "Week of Oct 12" in a table header; "Oct 16, 2026" in tooltips; hours "17:00". A `forming` bucket adds ", so far" in tooltips, the slider text and table cells ("Oct 17, 2026, so far"), never on the axis. Month names come from a fixed table. Table headers say "Day (UTC)" / "Week of (UTC)". |
| X labels | Every k-th bucket counting back from the newest: k = ⌈n/6⌉ on a wide plot, ⌈n/3⌉ on a narrow one. Both sets are rendered and a container query shows one. Lines label at points (i/(n−1)), columns at band centres ((i+½)/n). |

### 2.5 Anatomy and the table view

`ChartCard` is a `<section class="card chart" aria-labelledby>` with `container-type: inline-size`:

1. Head: the `<h2>` title and source line. On the right, the view toggle: a `<fieldset class="segs">` with a visually hidden `<legend>` ("{title}: view") and two native radios, Chart (checked) and Table, named `{chartId}-view`, drawn as segments (44 px targets, focus ring on the label through `:has(:focus-visible)`).
2. Legend (section 2.11) for two or more series. None for one: the title names it.
3. The chart view: the plot, then the x labels. A fixed height includes the x-axis band.
4. The table view: `ChartTable` over `DataTable compact` (34 px rows), `maxHeight` 300 px, newest first. One column per series (exact values), plus "Total" for stacks. A missing value is "—", with "no data" for screen readers.
5. Notes (`--faint`, 12 px).

**The toggle works without JavaScript.** Inside `@supports selector(:has(*))`, `.chart:has(input[value="table"]:checked)` hides the chart view and shows the table view. Without `:has()` both views show. The radios are uncontrolled (`defaultChecked`), so a beat's re-render leaves the visitor's choice alone. The hidden view is `display: none`, out of the accessibility tree.

**The plot for assistive technology.** The marks sit in a `<div role="img" aria-label>` whose label is a summary built by the kit, for example "Transactions by type per day, Sep 17 to Oct 16, 2026. Highest Oct 3, 2.31M; latest Oct 16, 2.10M. Choose Table for every value." The marks inside are `aria-hidden`. The cursor layer (section 2.6) is a sibling, never inside the `img`.

### 2.6 Hover and keyboard (progressive enhancement)

The server's HTML has no cursor layer. After hydration (`useSyncExternalStore`, as `LiveToggle`) `Cursor` adds, over each plot, a transparent layer with `role="slider"`, `tabindex="0"`:

- `aria-label` "{title}, {unit} by {unit}", `aria-valuemin` 0, `aria-valuemax` n−1, `aria-valuenow` the bucket;
- `aria-valuetext`, for example "Oct 16, 2026: 2,104,331 transactions; Payment 1,180,220; OfferCreate 520,004; …".

A screen reader hears each step without a live region. The table remains the full equivalent.

| Input | Effect |
|---|---|
| Pointer move | Nearest bucket from the x fraction. The hit area is the whole plot, larger than any mark. |
| Touch | A tap or drag selects; `touch-action: pan-y` keeps vertical scrolling; the tooltip stays until a tap elsewhere. |
| Focus | The newest bucket. Arrow Left and Right move one bucket; Home and End go to the ends. Blur and Escape hide. |

What it shows:

| Form | Hover state |
|---|---|
| Line, area, step | A 1 px `--border-strong` crosshair and an 8 px dot per series, with a 2 px `--surface` ring |
| Columns, candles | The hovered column at full strength, the others at 45% opacity |
| Every form | One tooltip at the bucket. It flips to the right of the cursor under 22% and to the left over 78%, else centres. It is `aria-hidden` (the slider carries the text). |

The tooltip reads: the date in `--faint`; one row per series, a 12 × 2 px line key in the series colour, the value strong, the name muted; the total for stacks. Every text goes in by React text nodes, never `innerHTML`.

The active mark is marked on the DOM by the cursor (`data-active` on the plot, `is-active` on the mark), so a pointer move re-renders the overlay only. `HoverGroup` (a context) shares the bucket between panels: small multiples, and candles over volume. Each panel draws its own crosshair and its header readout, and one tooltip shows only where it is asked for.

### 2.7 Responsiveness and phones

| | Rule |
|---|---|
| Width | The plot fills its card; marks in percent; lines in the stretched SVG. |
| Height | Plot 200 px, 160 px under a 480 px container (`@container`). |
| Column density | A column slot is at least 5 px (a bar of 3 px or more with its 2 px gap). Above that density the plot gets `min-width: n × 5 px` and scrolls sideways inside a focusable region (`role="region"`, "{title}, scrollable chart"), the y labels outside it. 90 days on a 375 px phone scrolls; 30 days and 52 weeks fit. |
| End labels | A right gutter (112 px) on wide plots; left out under 480 px (legend and tooltip carry them). |
| Tooltip | At most `min(260px, 90%)` wide. |
| Cards | The board's `flex: 1 1 420px` pairs fold to one column. |

### 2.8 Empty, partial, failed, left out

| State | Plot | Table | Tooltip |
|---|---|---|---|
| A bucket `null` | A gap: a line breaks (a new `M`), a column slot is empty | "—" | "No data for Oct 3" |
| `forming` (the newest bucket, running) | Drawn as any bucket | its date with ", so far" | its date with ", so far" |
| `pending` (the newest one or two buckets) | As `null`, and the card notes "Oct 17 is not computed yet." | "—" | "Not computed yet" |
| Zero | Drawn at 0 | "0" | "0" |
| Every bucket `null`, or no rows | Grid and axis at the empty domain, "No data for these 30 days" centred in `--muted` | "No data" | none |
| Card `failed` | `SectionError` with Retry, in place of the views and the toggle | | |
| A series left out (E2's AMM line when `off` or `none`) | Not drawn; no legend entry, end label or column | | |
| Refetch (a period or currency navigation) | The previous render at 55% opacity, no skeleton (`useNavigation` to this route) | | |

### 2.9 Live updates and motion

A chart component is `memo`'d on its data's `token`. A beat that brings the same data re-renders nothing and animates nothing. When the token changes after the first render (the running bucket moved on, at most every 300 s, or a day closed), the chart redraws in place. Its plot gets the figure mark of `LiveValue`: a 3 px `--accent` ring outside the plot, fading out over 1.2 s, once (`value-mark`). Marks do not tween. Under `prefers-reduced-motion: reduce` the ring is the one exception that stays, as for `LiveValue` (a colour that fades, nothing moving). Nothing animates on the server's render, on hydration, or on a navigation.

### 2.10 Colour

Series slots, "Other" and up/down are the tokens of foundation section 8 (`--series-1..5`, `--series-other`, `--up`, `--down`), assigned in fixed order by entity, never by rank. The dataviz validator, run for this spec against the explorer's surfaces:

| Mode, surface | Lightness / chroma | Worst adjacent CVD ΔE | Normal-vision floor | Contrast |
|---|---|---|---|---|
| light, `#FFFFFF` | pass | 9.1 (protan) | 19.6 | WARN: `#1baf7a` 2.82, `#eda100` 2.17, `#e87ba4` 2.69 |
| dark, `#202229` | pass | 8.4 (protan) | 19.3 | pass |

The light contrast WARN obligates relief: every chart has the table view, every multi-series chart a legend, and lines of 4 series or fewer have end labels. All-pairs forms (small multiples, scatter) take slot 1 only, or at most three slots.

New tokens in `tokens.css`, in all three blocks (`tokens.test.ts` keeps the dark copies equal and checks the pairs):

| Token | Light | Dark | Use / check |
|---|---|---|---|
| `--grid` | `#ECEEF2` | `#262830` | gridlines, 1 px solid |
| `--axis` | `#C3C6CF` | `#4E5059` | baseline, zero line, diverging centre |
| `--track` | `#d5e5fd` | `#183059` | meter track; fill `--series-1` on it 3.72:1 / 3.95:1 |
| `--up-wash` | `rgba(61,122,0,.12)` | `rgba(109,163,7,.18)` | depth (bids); `--muted` on it 6.83:1 / 5.37:1 |
| `--down-wash` | `rgba(224,36,94,.10)` | `rgba(232,51,106,.16)` | depth (asks); `--muted` on it 6.90:1 / 6.06:1 |

Text never wears a series colour: labels, values and legends use `--fg`, `--muted` and `--faint`. Status colours (`--ok`, `--bad`) are only for status, with an icon and text. Under `forced-colors: active`, marks and legend swatches take `forced-color-adjust: none`, so identity survives, and the table view stays.

### 2.11 Chart types and mark specs

The kit builds all of these in E2, each with component tests, so the later sub-projects only use them. Their props may grow; their files are not forked.

| Component | Form | Used by (board) | Marks |
|---|---|---|---|
| `ColumnChart layout="single"` | Columns, one series | Amm swap volume, AmmPool swap volume | Width `min(24px, 72%)` of the slot; 4 px radius at the top, square at the base; `--series-1`; 2 px gap at least; no legend; hover per column |
| `ColumnChart layout="stacked"` | Stacked columns | **Network** transactions by type; AccountAnalytics transactions sent by type | As above. Segments in series order bottom up, each its exact share of the column's height. A 2 px `--surface` gap drawn inside the top of each segment but the highest, so totals stay exact. The 4 px radius on the stack's top. No labels on segments. Legend with 10 × 10 px swatches (2 px radius). The tooltip lists every series and the total. `annotations` puts a symbol above a column in a text colour (`--bad` "×"), with a legend entry "× has a failed transaction". |
| `ColumnChart layout="diverging"` | Columns above and below 0 | AccountAnalytics money in and out | `--up` above (radius at the top), `--down` below (radius at the bottom), square at the zero line; the zero line in `--axis`; symmetric domain; legend "Received, drawn up / Sent, drawn down"; tooltip in, out, net |
| `LineChart` | 1 to 3 lines | **Network** volume; AccountAnalytics account value | 2 px, round joins and caps; 8 px end dot with a 2 px `--surface` ring; legend with 14 × 2 px line keys for 2 or more; end labels ("**45.5M** payments") for 4 or fewer, a later one left out when it would sit within 16 px of an earlier one at the 160 px height |
| `LineChart area` | A line with a wash | **Network** average fee; AmmPool pool value | One series only; fill the series colour at 10% opacity down to the baseline; domain from 0 |
| `LineChart` with `domain`, `curve="step"`, `references` | Truncated line, step line, threshold | Validator daily agreement (from 99%); Amendment yes votes per flag ledger (step-after, from 50%, threshold 80%) | A domain only on lines, stated in the note ("The axis starts at 99%"). A reference is 1.5 px dashed `--muted`, labelled in `--fg` on a `--surface` chip ("80% threshold"). Dashes are kept for references; gridlines are solid. |
| `SmallMultiples` | Grid of one-series lines, from `SmallMultiplesData` (section 2.3) | AccountAnalytics balance history per currency; AmmPool reserves | Panels `minmax(240px, 1fr)`; slot 1 in every panel; each its own y scale with 3 ticks, and the card says so; the panel's label and sublabel in its header; x labels at both ends; a shared cursor (`HoverGroup`) with each panel's readout in its header |
| `Sparkline` | Inline trend, no axes | Markets 7-day price; `StatTile` trend | 100 × 28 px SVG; 1.5 px `--faint` line; 8 px end dot in `--accent` with the ring; no hover; `role="img"`, "7-day price, from 2.38 to 2.44, +2.5%" |
| `Candles` + volume pane | Candlesticks over volume columns | MarketPair price | Wick 1 px, body `min(9px, 62%)` and at least 1 px, `--up` closed higher, `--down` closed lower; legend "Closed higher / Closed lower / Volume"; price axis on the right. The volume pane below has its own axis: a second pane, not a second axis. Volume columns in `--series-other`. A shared cursor and an O/H/L/C/V readout above, carried by the slider's `aria-valuetext`. |
| `InlineBar` | A bar behind or inside a table row | MarketPair order book depth; Markets AMM share | Depth: `--down-wash` (asks) or `--up-wash` (bids), from the row's end, as wide as the cumulative size over the largest, 3 px radius on its open end, behind text that keeps 4.5:1 |
| `InlineBar diverging` | Out left, in right, in a row | AccountAnalytics where balance changes come from | 14 px; `--down` to the left with radius on the left end, `--up` to the right; 1 px `--axis` centre; one scale for all rows; `aria-hidden` with the row's cells carrying the values |
| `BarList` | Labelled horizontal bars | **Network** payment volume by currency; MarketPair most active traders; AmmPool fee votes | 18 px thick (12 px in dense lists), at most 24; 4 px radius at the data end, square at the start; `--series-1`; the value at the tip in text tokens ("**1.24B XRP** · 58%"); an `<ol>` with the bar `aria-hidden`; the table view gives the exact amounts and counts |
| `ShareBar` | 100% stacked horizontal rows | Validators software versions (UNL, all) | 28 px rows; segments in slot order with 2 px gaps; 4 px radius at the row's ends; a label under a segment only if its share is at least 18% (at the 320 px minimum plot that is about 9 characters); legend; cursor over segments; % axis under the rows |
| `Meter` | One ratio, with an optional threshold | Amendment consensus, Amendments list, Markets AMM share | Track `--track`, fill `--series-1`, 12 px (6 px small) with full radius; a threshold tick 2 px `--fg` reaching 5 px past the track with its label under it; `role="img"`, "84% of the UNL votes yes; 80% needed" |
| `StatTile figure`, `delta` | A number | **Network**, Markets, Amm, Validators, Validator, AccountAnalytics tiles | Sans, proportional figures, 24 px, weight 600 (the board's; the home tiles keep their mono 22 px). `delta`: a triangle icon and the signed text in `--muted`, against a named period. Optional `trend` `Sparkline`. |

Every chart form has the hover layer of section 2.6. The exceptions are `Sparkline`, `InlineBar` and `Meter`, which sit in rows or tiles whose text carries their values, and `BarList`, which labels every bar.

### 2.12 Files

```
app/ui/charts/
  types.ts         data shapes (type-only)
  geometry.ts      scales, nice ticks, bands, stacks, diverging, line, area and step paths with gaps, end-label collisions, x-label picks
  labels.ts        tick text, value text, UTC bucket labels, the plot summary
  ChartCard.tsx    card, toggle, legend slot, views, notes, states
  Legend.tsx       ChartTable.tsx    Cursor.tsx (slider, crosshair, tooltip, HoverGroup)
  ColumnChart.tsx  LineChart.tsx     SmallMultiples.tsx    Sparkline.tsx    Candles.tsx
  BarList.tsx      ShareBar.tsx      Meter.tsx             InlineBar.tsx
app/ui/charts.css  imported by styles.css
```

---

## 3. Data API interface

| Element | Endpoint (fields) |
|---|---|
| Chips | `/v2/network/fees?descending=true&limit=8` (`ledger_index`, `tx_count`, `date`) |
| Open ledger | `/v2/network/fee_stats?descending=true&limit=1&start={T}` (`open_ledger_fee`, `minimum_fee`, `current_queue_size`, `current_ledger_size`, `expected_ledger_size`, `date`) |
| Validators card | `/v2/last_validated` (`ledger_hash`) or `/v2/ledgers/{index}`, then `/v2/ledgers/{hash}/validations?limit=1000` (`validation_public_key`, `first_datetime`) |
| Tiles 1 to 4 | `/v2/stats/metric` (`transaction_count`, `ledger_count`, `accounts_created`), W and P |
| Payment volume tile, Payments line, by currency | `/v2/network/payment_volume` historical (`total`, `components[].currency/issuer/amount/converted_amount/count`), W and P |
| DEX tile, DEX line | `/v2/network/exchange_volume` historical (`total`), W |
| AMM line, DEX tile's sub | `/v2/network/amm_volume` historical (`total`), W; XRPL, read only while `AMM_DATA` is on; `feat/amm-data` only |
| Transactions by type | `/v2/stats/type` (the type columns), W |
| Average fee | `/v2/network/fees?interval=day` (`avg`, `total`, `tx_count`), W |

**Open ledger fee and queue:** `fee_stats` has them (a snapshot of the node's `fee` command every 5 s). No node call. Their age is at most about 5 s of snapshot interval, plus 2 s kept, plus 3 s at the edge.

**Missing from the data API, and what E2 does**

| Missing | E2 | Where it would come from |
|---|---|---|
| UNL membership, to say "N of the UNL signed" | "N validators signed", every validator heard; "All validators" opens the list with `scope=all` | D1 serves it (`/v2/network/validators`); the network card keeps counting every validator heard |
| A USD (or other display) market on Xahau | no "Amounts in" choice on Xahau | dropped for now: no data sub-project adds one |
| Payment volume of every currency, not just the tracked ones | the tracked currencies, named in a note; no "Other" row | dropped for now: no data sub-project adds one |
| DEX volume of every market | DEX volume over the tracked markets, labelled "tracked markets" in the tile and legend | dropped for now: no data sub-project adds one (D2's markets table covers every pair for the markets page, not this daily series) |
| Queue capacity, reference fee (`max_queue_size`, `base_fee` of the `fee` command) | "Queue 0" without a capacity; `minimum_fee` in the fee note | dropped for now: no data sub-project adds them |
| `amm_volume` on `main` | the AMM series is shown only where `AMM_DATA` is on (section 1.4) | `feat/amm-data`, merged, re-ingested and back-filled; then the owner turns `AMM_DATA` on |

---

## 4. Testing

**Unit (Vitest, `unit` project)**

| File | Covers |
|---|---|
| `app/server/network-view.test.ts` | Alignment to `windowOf`'s buckets with missing and extra rows, the rows before W feeding only the deltas; `forming` on every chart; totals over W with the running bucket, interval (the running bucket's seconds up to `anchor.closeTime`) and transactions per ledger in exact arithmetic; the delta rule over F and P (left out when any bucket is missing or ΣP is 0; the running bucket never in it) and its words; weekly fees from days, the running week from its days so far; payment by currency (sum per currency and issuer, sort, shares, "<1%", hex codes); the four AMM states and the wording each gives; validators (earliest 5, "+N ms", "1,000+", the link with `VALIDATORS` on and `null` with it off); pending (none, the running day, the running day and the day before, a gap further back is `null`); tokens (stable for the same data, changed by any drawn value); no float in any string. |
| `app/domain/window.test.ts` | `windowOf` for every period: W, F and P and their API dates; Monday weeks; `T` on a Monday, on a Sunday and just after midnight; the note's words; `utcDayOf` at the day's edges |
| `app/domain/type-groups.test.ts` | Both networks' groups, slots and order; the prefixes (`AMMDeposit`, `URITokenMint`); Other; a missing key is 0; exact sums; the notes |
| `app/ui/features.test.ts`, `app/server/env.test.ts`, `networks.test.ts` | `featuresOf` ("on" only is on; anything else, a missing value included, is off); `cacheGeneration` (sorted names, every switch, a flip changes it, `BUILD_ID` first); `features` on `Network` and `PublicNetwork` |
| `scripts/predeploy-check.test.ts` | A build with a switch missing, a switch neither "on" nor "off", or an unknown var with the value "on" or "off" (a misspelt switch) is refused, with each reason |
| `app/server/anchor.test.ts` | `anchorOf`: the index as a number, the close time as unix seconds |
| `app/domain/network-params.test.ts` | The canonical form of every query string; `in` on Xahau; order; repeats; unknown parameters |
| `app/domain/format.test.ts` | `compactNumber` at every boundary (9,999.99, 10,000, 999,950, negative, zero, under 1, exponent input) |
| `test/unit/charts-css.test.ts` | Reads `charts.css`: column width at most 24 px and 4 px top radius, 2 px gaps, 2 px lines, 8 px dots with a 2 px ring, area opacity 0.1, solid 1 px gridlines, dashed reference only, 44 px toggle targets, `@supports selector(:has(*))` around the hiding rule, the reduced-motion exception for the plot's mark |
| `test/unit/tokens.test.ts` | The new tokens in all blocks, equal dark copies, the contrast pairs of section 2.10 |
| `test/unit/live-motion-css.test.ts` | Gains the chip selectors and `--sunken` among the wash's backgrounds (`--fg` and `--muted` at AA under the 2% wash on both accents) |
| `test/unit/charts-bundle.test.ts`, `network-bundle.test.ts` | The kit's import allowlist, no barrel; the route's browser files import nothing from `app/server` at run time |
| `test/unit/pending-paths.test.ts` | Each `PENDING_PATHS` entry is absent from `api/openapi.yaml` |
| `test/unit/network-fixtures.test.ts` | The synthetic fixtures obey the reference rules (below) |

**Components (`components` project, happy-dom)**

- `app/ui/charts/geometry.test.ts`: nice ticks and domains, band layout, stack layout with exact shares, diverging symmetry, paths with gaps for `null`, step and area paths, end-label collisions, x-label picks from the newest, bucket from x fraction, tooltip side.
- One test file per component, rendered with `renderToString` and then hydrated. They check:
  - the marks are in the server HTML and the cursor layer is not;
  - after hydration the slider appears, the arrow keys change `aria-valuetext`, and a pointer move shows a tooltip whose text is the exact values;
  - the radios swap the views;
  - a legend for two or more series and none for one;
  - every state of section 2.8;
  - memo by token: a re-render with the same token touches no mark, and a new token sets the plot's mark once;
  - reduced motion.
- The kit's components also check `forming` (", so far" in the tooltip, the slider and the table, nothing on the axis), `pending` (the gap, "Not computed yet", the note) and `SmallMultiples` from `SmallMultiplesData` (a panel's label, sublabel, unit, readout and own scale; a negative panel; the table's columns).
- `NetworkPage.test.tsx`: every card state, the tiles' `LiveValue` tokens, the strip's hold and its release on unmount, the four AMM wordings, the validators link as a link and as "soon" (from the card's data), the Xahau page without "Amounts in".
- `live-page.test.ts`: the moved home tests, `order` and `merge`, and `keepLoaded` (a failed part kept when shown loaded, a part never loaded shows its error, parts not named come from the beat, `next` itself when nothing is kept, `missing` and the AMM `off` state are answers). `routes-wiring.test.tsx` gains `net.network.tsx`: the `clientLoader`, the scope per view, and a failed refresh keeping the page.
- `Header` (`components.test.tsx`): with `navSection: "network"` on `/xrpl/network`, `aria-current="page"` and `.is-current`; on a page of the section that is not its index (a route that names the section), `aria-current="true"`; elsewhere none. Markets and AMM "soon" with their switches off and without the layout's data (`NO_FEATURES`).
- `use-network.test.tsx`: `useFeatures()` with the layout's data, and `NO_FEATURES` without it.

**Worker (`worker` project, recorded and generated fixtures)**

`test/worker/network-page.spec.ts`, through `pageClient`:

| Covers | Checks |
|---|---|
| Classes | The page and its `.data` URL stored as `live-home` |
| Redirects | The canonical redirects (302, `short`) |
| Upstream calls | Exactly the calls of section 1.4 for each view (`mock.requests`), with their query strings from the recorded `last_validated` (`end` the index day, `start` W's or P's first bucket). #1 and #2 under the home page's `[kept 2 s]` keys; #6 to #11 kept 300 s (the stored `max-age`). #3 only when the fees list is behind; no #11 and no `in` on Xahau. |
| Page-level failures | #1 and #2 failures are 503s, not stored |
| Card failures | Each card failure is a 200 with its `SectionError` in the HTML, `Cache-Control: no-store`, not stored |
| AMM failing | With `AMM_DATA` on, `amm_volume` overridden to `null` (the API's "Cannot GET" 404) gives a 200 with "AMM swaps couldn't be loaded", `no-store`, not stored, logged, and held (one call across two renders within 5 s) |
| No JavaScript needed | The HTML holds the columns, the SVG paths and both views |
| Meta | Canonical and `og:*` on the default view, `noindex, follow` and none of them on the others (also in `meta.spec.ts`) |
| Cache generation | `edge-cache.spec.ts`: the edge key holds `cacheGeneration`; a page stored under one value of a switch is a miss under the other; the subrequest cache's keys are unchanged |
| "Cannot GET" | `data-api.spec.ts`: a 404 with `Cannot GET …` is kind `server`, never stored, held; a 404 with any other message (`ledger not found`, `Account not found`) stays `not_found` |

`test/worker/network-off.spec.ts`, in the `worker-off` project (every switch "off", section 6.1): no #11 call on XRPL, the `off` wording, no AMM line; "All validators" in the "soon" style; the header's Markets and AMM "soon".

`test/worker/network-hold.spec.ts` (a file of its own, for a fresh isolate): two renders within 5 s with a failing #6 make one upstream call (`statusesOf`); after 5 s (fake `Date`) the next render calls again; a 429 with `Retry-After: 12` is held 12 s; the home page's calls are held too, and a failing `last_validated` held for the network page is held for the home page (one key).

**The fixture server's catch-all.** It answers a path without a file with the API's "Cannot GET" 404, which section 6.4 makes an outage. The plan first runs the existing worker and e2e suites with the rule in, and gives every path whose absence a test relies on as `not_found` the API's own not-found body in `dataApiAbsent` (as it does for ledgers, transactions and accounts today). The `null` override keeps meaning "the API's Cannot GET".

**Fixtures.** The new answers are generated, like the rest of `test/fixtures/http/`, by `pnpm fixtures:sync` (`scripts/network-fixtures.ts`, called from `make-http-fixtures.ts`), and checked by `pnpm fixtures:check` and `scripts/http-fixtures.test.ts`.

| Files (per network) | Source |
|---|---|
| `data-api/ledgers/<HASH>/validations@limit=1000.json` for the two newest recorded ledgers (the e2e moves the chain back by one) | synthetic |
| `data-api/network/fee_stats@descending=true&limit=1&start=2026-10-17.json` | synthetic |
| `data-api/stats/type@…`, `stats/metric@…`, `network/fees@…interval=day…`, `network/payment_volume@…`, `exchange_volume@…`, `amm_volume@…` (XRPL), for the four periods, and on XRPL for both display currencies. The `stats` and `fees` files have a row for the running day (the day so far); the volume files end with the day before it, as the API's do. | synthetic |

None of these can be derived from the recorded ledgers: aggregates over months, the syncer's snapshots and the validations stream. They are **synthetic**, from a seeded generator (mulberry32, seeded per network and endpoint) that follows the reference:

- `stats` leaves out zero counts and sorts names, and `transaction_count` is the sum of the type columns;
- about 22,150 ledgers a day on XRPL;
- volume components come from the markets configs, copied into the generator with their source path and commit; they are sorted by converted amount, with `rate = amount / converted_amount` to 8 significant digits, and USD rows are the native rows at a daily synthetic rate;
- validation keys are valid node public keys encoded with `ripple-address-codec` from seeded bytes;
- key orders are the reference's;
- one line per row, sorted keys, as the other files.

`test/fixtures/PROVENANCE.md` gains a section, "Synthetic aggregates", naming the generator, the seeds and the `data-api-new` commits whose `docs/api-reference.md` they follow (`main` for the shapes, `feat/amm-data` for `amm_volume`). The README's "Upstream fixtures" table marks them "generator (synthetic)" (the kinds are "recorder", "generator (derived)" and "generator (synthetic)", the same words in every spec). The default fixtures include `amm_volume` (the post-merge API), which the top level's `AMM_DATA: "on"` reads; the `worker-off` project does not ask for it. The e2e suite against a real stack (`E2E_DATA_API_URL`) is what catches drift from real answers.

**End to end (Playwright).** `test/e2e/network-page.spec.ts` (the existing `network.spec.ts` is the network switch):

- Navigation and toggle:
  - "Network" in the header leads to `/xrpl/network` in one document, with `aria-current`;
  - with JavaScript off (`contextFor`) the charts are visible and the Table radio swaps the view;
  - "1 year" changes the URL to `?period=1y`, draws weeks, adds `noindex` and drops the canonical link, and Back restores them;
  - "USD" sets `in=usd`, and Xahau has no "Amounts in".
- Hover and keyboard:
  - a pointer over the stacked chart shows the tooltip with the date and total;
  - Tab to the slider, then Arrow Left changes `aria-valuetext`.
- AMM with the default fixtures: the AMM line and its legend entry are there. The test skips itself when `E2E_FEATURES_OFF` lists `AMM_DATA` (section 6.1), and then checks the `off` wording instead.
- The running bucket: the tooltip of the newest column reads "Oct 17, 2026, so far"; the volume card notes "Oct 17 is not computed yet."

`test/e2e/network-live.spec.ts` holds every test that changes the fixture server's answers. It runs in the `live` project, alone, after the others, because those answers would show in every page rendered meanwhile.

- The chain moves on through the fixture server (`xrplHomeOneLedgerBehind()`, then back):
  - a new chip enters with `.is-entering`, the others slide, and only the route's `.data` URL is asked for;
  - reduced motion: no transform;
  - pause and resume;
  - the strip hold;
  - a 503 keeps the page and shows "Live updates paused, retrying…" after two.
- AMM failing: with `amm_volume` overridden away (the API's "Cannot GET" 404), the volume card says "AMM swaps couldn't be loaded" with Retry, and a page that showed the AMM line keeps it through the failing beats (`keepLoaded`).
- A failed card: `stats/type` overridden to 503 shows "Couldn't load transactions by type". Once the override is removed, the card comes back by itself within 10 s (the hold, then a beat).

**Accessibility.** `a11y.spec.ts`, axe with the WCAG 2.2 AA tags; the gate is no violation of impact serious or critical.

| Pages | Matrix |
|---|---|
| `/xrpl/network` | 1280 px and 375 px × the four theme settings (light and dark by system; dark and light chosen by the toggle against the other system theme) |
| `/xrpl/network?period=1y&in=usd`, `/xahau/network`, the default with every table view on, a page with a failed card, the default with the slider focused and its tooltip shown | the two system themes |

`landmark-unique` and the ARIA "needs review" test cover the page too.

**Bundle.** `PAGES` in `scripts/bundle-budget.ts` gains `{ name: "network", route: "routes/net.network" }`; `scripts/check-bundle.test.ts` follows. The gate stays 150,000 B. The plan checks the 145,000 B target of section 2.1 and applies its fallback if needed.

**Risk: the shared base grows with every route, and part of it is not measured.** Every page loads the entry, the root, the `/:net` layout and the route manifest (`assets/manifest-*.js`, `window.__reactRouterManifest`), which lists every route of the app. The bundle check counts the first three and the page's route with their static imports, but not the manifest. E2 adds one route and its imports to the layout's reach (`useFeatures`, the header's sections); E3 to E6 add nine more routes. The plan therefore:

1. measures, before and after E2, the gzip size of the manifest and of the base the check counts (the home page's figure is that base plus its route);
2. records both in the README's "The client bundle check", with the growth per route;
3. projects them for the nine later routes, and says whether the manifest must join the check (a change to `bundle-budget.ts` that the plan then makes, with its test) or whether the projection leaves room.

---

## 5. Rollout

| Step | What ships | Behaviour |
|---|---|---|
| 1. E2, while `feat/amm-data` is unmerged | Everything in this spec; `ammVolume` in `PENDING_PATHS`; the default fixtures with `amm_volume`. Switches: `AMM_DATA` "on" at the top level and "off" in staging and production; `VALIDATORS` "off" at every level (section 6.1). | Staging and production: no `amm_volume` call, no AMM series; the DEX tile reads "tracked markets" and the legend "DEX trades, tracked markets"; "All validators" is "soon". |
| 2. `data-api-new`: `feat/amm-data` merged into `main` and deployed to an environment, its history re-ingested with the AMM parser and back-filled | No explorer change | None yet |
| 3. The owner turns `AMM_DATA` on for that environment | `"on"` in its `vars` (a commit), deploy | The flip is a new cache generation, so within the edge's 3 s every view is rendered afresh: the AMM line and legend entry appear, and the DEX tile and legend take their `ok` wording (section 1.3). |
| 4. Then, in the explorer | `pnpm api:sync` (the commit names the source commit). `pending-paths.test.ts` fails, and `ammVolume` moves from `PENDING_PATHS` to `PATHS`. | None |
| 5. E6 | `VALIDATORS` "on" at the top level with E6's pages; in staging and production when D1 serves there (E6's rollout) | "All validators" becomes a link |

Before production, the staging checklist (README) gains:

- the network page's views against the staging stack, with the window anchored to its `last_validated`, and the running day "so far";
- the failure hold seen in `wrangler tail` (one failing call per 5 s per instance while a card fails), on the network and home pages;
- a switch flip: the first request after the deploy is a miss at the edge (the cache generation), and the AMM series appears once `AMM_DATA` is on;
- the bundle figure of the network page, and the manifest's size (section 4).

---

## 6. Shared mechanisms

E2 is built first among the explorer sub-projects, so it defines what E3 to E6 share. Each later spec references these and never redefines them; where a later spec adds to one (a switch name, a section, a list entry), this section says how.

### 6.1 Switches

**One mechanism for every page-level and feature-level switch**: a Worker variable, `"on"` or `"off"`, set per environment in `wrangler.jsonc`.

| Variable | In `Features` | Added by | Gates |
|---|---|---|---|
| `VALIDATORS` | `validators` | E2 | every link into E6's validators and amendments pages (the network page's "All validators", and the links E6 adds there), and E6's routes |
| `AMM_DATA` | `ammData` | E2 | every part derived from the AMM data in the index: E2's AMM volume series and its "AMM swaps included" wording; E3's AMM share, Via column, Trades filter, "swaps against AMM pools" wording and pool card share; E4's "includes swaps" wording. The AMM pages themselves are behind `AMM_PAGES`. |
| `MARKETS` | `markets` | E3 | E3's markets and pair pages, the header's Markets link, every link into them |
| `ACCOUNT_ANALYTICS` | `accountAnalytics` | E4 | the account page's Analytics tab |
| `AMM_PAGES` | `ammPages` | E5 | E5's AMM pages, the header's AMM link, the pool links |

**Where each is set.**

- Every environment block of `wrangler.jsonc` lists every switch (`vars` are not inherited).
- The top level (local development and every test suite) has a switch "on" from the moment the code it gates is built. `VALIDATORS` is therefore "off" at the top level too until E6 builds its pages: a link to a route that does not exist yet would only be a 404. E6 turns it on.
- `staging` and `production` have a switch "off" until the data API of that environment serves what the feature needs; then the owner sets it "on" by a commit and a deploy. Each spec's rollout names the condition, and D2 §16.4 names the gauges that gate `MARKETS` and `ACCOUNT_ANALYTICS`.
- A switch is never set in the Cloudflare dashboard: the Cloudflare Vite plugin writes the build's vars, so the next deploy would undo it.
- `Env` (`env.ts`) types each as `"on" | "off"`.

**`app/ui/features.ts`** is the one list of switches. Pure, with no React and no server import, so the Worker, the browser, the scripts and the tests all import it:

```ts
export const FEATURE_VARS = ["VALIDATORS", "AMM_DATA", "MARKETS", "ACCOUNT_ANALYTICS", "AMM_PAGES"] as const;
export type FeatureVar = (typeof FEATURE_VARS)[number];
export const FEATURE_NAME = {
  VALIDATORS: "validators", AMM_DATA: "ammData", MARKETS: "markets", ACCOUNT_ANALYTICS: "accountAnalytics", AMM_PAGES: "ammPages",
} as const satisfies Record<FeatureVar, string>;
export type Feature = (typeof FEATURE_NAME)[FeatureVar];
export type Features = Readonly<Record<Feature, boolean>>;
/** Every switch off: where the layout's data is missing. */
export const NO_FEATURES: Features;
/** `vars[name] === "on"` for each switch; anything else, a missing value included, is off. */
export function featuresOf(vars: Readonly<Partial<Record<FeatureVar, unknown>>>): Features;
```

The block is the list once E3 to E5 have added theirs. E2 writes it with its two names (`VALIDATORS`, `AMM_DATA`); the three later ones are added by their specs, each in its own build (E3 `MARKETS`, E4 `ACCOUNT_ANALYTICS`, E5 `AMM_PAGES`), with its `Env` field, its `wrangler.jsonc` entries and its tests. Nothing else lists switch names.

**How a loader and a component read them.**

- `networkOf(id, env)` adds `features: featuresOf(env)` to `Network`. `PublicNetwork` carries it to the browser through the `/:net` layout's data: the values only, never an upstream URL or key.
- Loaders read `net.features` from `requireNetwork`.
- A page's links and labels that depend on a switch come from its view builder, in its data, so the stored HTML and the data agree (the network page's validators link is `string | null`).
- Components that are not drawn from page data (the header, a sentence's link) call `useFeatures()` in `app/ui/use-network.ts`. It reads `network.features` from the `/:net` layout with `useRouteLoaderData`, returns `NO_FEATURES` where that data is missing (an unknown network's error page, a test without the layout), and never throws.

**What "off" does.**

- A page-level switch (`MARKETS`, `VALIDATORS`, `AMM_PAGES`): the routes it gates answer the not-found page, a 404 of class `short`, before any upstream call. Every link into them, the header's included, is the header's "soon" style, not a link.
- A feature-level switch (`AMM_DATA`, `ACCOUNT_ANALYTICS`): the parts it gates are left out, the calls that feed only them are not made, and the wording that depends on them takes its "off" form. Each spec lists its parts (E2: section 1.3; E4's tab: E4 section 1.2).

**`cacheGeneration(env)`** (`env.ts`) is `BUILD_ID`, a colon, and every switch as `NAME=value`, sorted by name and joined by commas. With all five switches: `3f2a9c1:ACCOUNT_ANALYTICS=on,AMM_DATA=off,AMM_PAGES=off,MARKETS=on,VALIDATORS=off`.

- The edge cache keys every page, image and `.data` URL with it: `edgeCacheKey(request.url, cacheGeneration(env))` in `edge-cache.ts`, where `BUILD_ID` is used today. A flip is a deploy with the same commit, and a new key for everything, so no copy stored under the other value is ever served.
- The subrequest cache keeps `BUILD_ID`: it holds upstream data, which no switch changes.
- The live pages' `build` field keeps `BUILD_ID`, because it says which code drew the page. A flip therefore does not reload an open tab: its route's data follows on the next beat (the `.data` key changed), and the layout's data (the header) on the next document load.

**Guard.** `scripts/predeploy-guard.ts` imports `FEATURE_VARS` and refuses a build, with every reason, when:

- a switch is missing from the build's vars;
- a switch's value is not exactly `"on"` or `"off"`;
- a var that is not a switch has the value `"on"` or `"off"` (a misspelt switch, such as `MARKET`).

**Tests.**

- `vitest.config.ts` pins the top-level vars for the `worker` project.
- A second worker project, `worker-off`, pins every switch "off". Its files are `test/worker/*-off.spec.ts`. E2 adds `network-off.spec.ts`; each later spec adds the off-case of its own switch there (E5 its `AMM_PAGES` case).
- A loader's unit test builds its load context with the switch values it needs.
- End to end: `E2E_FEATURES_OFF` (default empty) is a comma list of the switches the Worker under test has off. The plan sets it for runs against staging or production. A test that needs a switch on skips itself when the switch is listed, and runs its off-case instead where it has one.

**README.** "Configuration" gains "Switches": the table above, each switch's value per environment, and the condition for turning it on in staging and production. Each later spec adds its row.

### 6.2 The header's sections: `navSection`

- `NetworkRouteHandle` (`app/ui/route-handle.ts`) gains `navSection?: NavSection`. E2 defines `type NavSection = "network"`, and each spec that adds a section widens it: E3 `"markets"`, E5 `"amm"`. E6's four pages belong to `"network"`.
- A route says which section it is in with its `handle`: `export const handle = { navSection: "network" } satisfies NetworkRouteHandle;`. E2's network route is the first.
- `navSectionOf(matches)` (`route-handle.ts`) is the `navSection` of the deepest match that names one, or `undefined`.
- The header's items carry their section, their href and the switch they need: Network (`/{net}/network`, no switch), Markets (`/{net}/markets`, `markets`), AMM (`/{net}/amm`, `ammPages`). An item whose switch is off (`useFeatures()`) is the "soon" label. Ledgers and Transactions are unchanged.
- The item of the current section gets `.is-current`, and:
  - `aria-current="page"` when the location's path is the item's href: the section's own index route, whatever its query (`/xrpl/network?period=1y` is still that page);
  - `aria-current="true"` on any other page of the section (`/xrpl/validators`, `/xrpl/markets/XRP/USD.r…`): a link that names the section the page is in.
- The handle is the only way the header marks a section; nothing else (a path prefix, a prop) does it.

### 6.3 `keepLoaded`

The merge of every live page whose parts can fail on their own, in `app/ui/live-page.ts`:

```ts
/** A part of a page's data that a beat may keep: a value with a `state`. "failed" is a failure; every other state is an answer. */
export type LivePart = { readonly state: string };

/**
 * The page to show for a beat's answer `next`, when `shown` is on screen: each part named in `parts` that is "failed" in `next` and
 * not "failed" in `shown` is taken from `shown`. Everything else comes from `next`. Returns `next` itself when nothing is kept.
 */
export function keepLoaded<K extends string, T extends Record<K, LivePart>>(next: T, shown: T, parts: readonly K[]): T;
```

- A transient failure does not replace a loaded part with an error every beat. A part that has never loaded shows its error.
- `Loaded<T>` of `account-view.ts` (`ok`, `missing`, `failed`) is a `LivePart`; `missing` is an answer. A part with states of its own must name its failure `"failed"` (E2's AMM part: `ok`, `failed`, `off`, `none`).
- A kept part is as old as it was. Each page's spec says how a kept part shows its age (its ledger, or an "as of" time).
- The route passes it as the `merge` of `createLiveOnScreen`, with the page's part list: `merge: (next, shown) => keepLoaded(next, shown, NETWORK_PARTS)`. E3's pair page and E6's pages use it with their own lists; none writes a merge of its own.

### 6.4 A data API route that does not exist

In `app/server/data-api.ts` (`throwUnlessOk`), **a 404 whose body's `message` starts with `Cannot GET ` is an `UpstreamError` of kind `server`**, with the message "data API GET {path} answered 404: Cannot GET … (the data API has no such route)". That body is what the API's framework answers for a path it has no route for: an API deployed without the sub-project that adds the route.

- Every other 404 stays `not_found`, including each route's own not-found message (`ledger not found`, `Account not found`, `pool not found`, `Validator not found`, `amendment not found`).
- So a missing route is an outage: never a stored 404 page; held by the failure hold; a page-level call answers 503 through `upstreamOutage`; a card-level call fails its card, which is logged and marks the answer degraded.
- This is the one rule for it. No page or client method maps a 404 to "the route is absent" or adds its own variant.

### 6.5 The anchor

`app/server/anchor.ts`:

```ts
/** Where a live page stands on the chain: what it was built from. */
export interface Anchor {
  /** The ledger index of `/v2/last_validated`. */
  lastValidated: number;
  /** Its close time, unix seconds. */
  closeTime: number;
}
export function anchorOf(last: LastValidated): Anchor; // ledger_index as a number; close_time (ISO) as unix seconds
```

Every live page's data carries `anchor: Anchor`, and its `order` is `d => d.anchor.lastValidated`. A window's `T` is `utcDayOf(anchor.closeTime)` (section 6.6). The browser imports the type only.

### 6.6 Windows and the running bucket

**The rule, for every time-series chart of E2 to E6:** the running bucket is included and marked "so far".

| Period | Buckets |
|---|---|
| 7 days, 30 days, 90 days | per UTC day: `T` and the N−1 days before it |
| 1 year | per week from Monday 00:00 UTC: the 52 weeks up to and including the week of `T` |
| All (E4) | per calendar month, UTC: up to and including the month of `T` |

- `T` is the UTC day of `last_validated`'s close time, never the wall clock. The window follows the index.
- The running bucket is drawn as any bucket. The chart's data has `forming: true` (section 2.3), which gives "…, so far" in the tooltip, the slider and the table.
- A route that computes a bucket only once it has closed has no row for the running bucket: it is `pending` (section 2.3), a gap with the card's note "Oct 17 is not computed yet.", and the day before can be pending too in the first hour or two after midnight UTC.
- Totals over a window include the running bucket. A change against an earlier period (a delta) compares full buckets only, and its words name its window.
- Caching does not change for it: period calls stay `PERIOD_CALL_TTL_SECONDS` (300 s), so the running bucket is at most that, plus the edge's time, behind. The live pages refresh in any case.

**`app/domain/window.ts`** holds the day and week windows (moved out of `network-view.ts`; pure, no clock, no `Intl`):

```ts
export type WindowPeriod = "7d" | "30d" | "90d" | "1y";
export interface PeriodWindow {
  period: WindowPeriod;
  unit: "day" | "week";
  /** W: the bucket starts, `YYYY-MM-DD`, oldest first. The last one is the running bucket. */
  buckets: string[];
  /** The API's `start` and `end` for W: `buckets[0]` and `T` (`end` is inclusive at its precision). */
  start: string;
  end: string;
  /** F: the N full buckets before the running one; P: the N buckets before F. For deltas. */
  full: { start: string; end: string };
  previous: { start: string; end: string };
  /** The period note's words: "the 30 days from Sep 18 to Oct 17, 2026 (UTC), today so far". */
  note: string;
}
export function windowOf(T: string, period: WindowPeriod): PeriodWindow;
/** The UTC day (`YYYY-MM-DD`) of a time in unix seconds. */
export function utcDayOf(unixSeconds: number): string;
```

E2's network page uses all of it (section 1.5), and E5's pool charts use it as it is. E4's frames (`analyticsFrame`, its month frame for All included) follow the same rule.

### 6.7 Transaction-type groups

`app/domain/type-groups.ts` (pure), used by every chart of transactions by type: E2's network page and E4's "Transactions sent".

```ts
export interface TypeGroup {
  id: string;
  label: string;
  slot: 1 | 2 | 3 | 4 | 5 | "other";
  /** The transaction types it adds up: exact names, or every type that starts with `prefix`. */
  types?: readonly string[];
  prefix?: string;
}
/** In stack order, Other last. */
export function typeGroups(network: NetworkId): readonly TypeGroup[];
/** A row of type counts summed per group, exact, as strings; a group without a type in the row is "0". */
export function groupCounts(network: NetworkId, counts: Readonly<Record<string, number>>): Record<string, string>;
/** The card's note. */
export function typeGroupsNote(network: NetworkId): string;
```

| Network | Groups (slot) | Note |
|---|---|---|
| XRPL | Payment (1), OfferCreate (2), OfferCancel (3), TrustSet (4), AMM: every type starting `AMM` (5), Other | "AMM adds up its transaction types; Other is every other type." |
| Xahau | Payment (1), Invoke (2), ClaimReward (3), URIToken: every type starting `URIToken` (4), SetHook (5), Other | "URIToken adds up its transaction types; Other is every other type." |

The groups are the same on every page of a network, so a colour follows its group and never its rank.

### 6.8 The failure hold

Section 1.7 defines it. The rule for later pages: every page that polls opts in, for every upstream call it makes, the node's included; a page that does not poll need not.

### 6.9 The README

- **The `live-home` list.** "The cache classes" table's `live-home` row, and the class's comment in `cache-class.ts`, list the pages of that class. E2 writes "the home page, the network page, and their `.data` URLs". Each later page of the class appends itself in its own build (E3's pair page, E6's validator page). The list is cumulative: no spec rewrites it.
- **Sections.** Each explorer spec names the README section it adds for its pages. E2 adds "The network page" (after "The account page": its views, calls, caching, failure hold and live updates), "The chart kit" (its components, data shapes and rules) and "Switches" under "Configuration" (section 6.1).
- **Upstream fixtures.** The kinds in its table are "recorder", "generator (derived)" and "generator (synthetic)".
