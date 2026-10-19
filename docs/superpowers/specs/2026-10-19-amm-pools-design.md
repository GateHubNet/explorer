# AMM pools: design (E5)

Date: 2026-10-19. Status: proposed. Sub-project E5 of the explorer program. Repository: `GateHubNet/x-explorer`, branch `feat/explorer-pages`.

## Context

The foundation (`2026-10-17-explorer-foundation-design.md`, built, with the rulings in `../decisions/2026-10-18-explorer-foundation.md`) serves the home, ledger, transaction, account and search pages from one Cloudflare Worker (React Router 8.4, framework mode).

**Build order and shared pieces.** The program is built in the order D1, D2, E2, E3, E4, E6, E5, so E5 comes last. It uses these pieces as their owners define them, and redefines none:

- E2 (`2026-10-19-network-dashboard-design.md`): the **chart kit** (`app/ui/charts/`) with its data shapes, `TimeSeriesData.forming` and `SmallMultiplesData` included (E2 §2.3); the feature switches (§6.1: one per-environment Worker variable each, `app/ui/features.ts`, `net.features`, `useFeatures()`, `cacheGeneration(env)`, the pre-deploy guard), among them `AMM_DATA`; the `navSection` route handle (§6.2); the generic `keepLoaded(next, shown, parts)` of `live-page.ts` (§6.3); the route-missing rule of `data-api.ts` (§6.4); the `Anchor` (§6.5); `windowOf` in `app/domain/window.ts` and the running-bucket rule (§6.6); `hasAmm` in `networks.ts`; `PENDING_PATHS`; `PERIOD_CALL_TTL_SECONDS`; `compactNumber`.
- E3 (`2026-10-19-markets-design.md`): the asset form and `app/domain/asset.ts` with its canonical case rule; `app/domain/paging.ts` (`trailPaging`); the node's `amm_info` reader and `AmmInfo` type, in both forms (`ammInfo(pool)` and `ammInfoByPair`); the `amm_info` fixture derivation, both `SUBJECT_PARAMS` forms, and the swap and trade rows derived from the `xrpl-amm` recordings; the cache class `minute`; `naturalOrientation`, `QUOTE_RANK`, `marketHref` and `marketsHref`; `pairCandles` (with `end`); the `BarList` `href` prop; `LiveStateNotice` and `useRetry`; its `MARKETS` switch.
- E4 (`2026-10-19-account-analytics-design.md`): `TimeSeriesData.extras`.
- E6 (`2026-10-19-validators-amendments-pages-design.md`): the `Countdown` component.

This spec adds the **AMM pools list**, `/{net}/amm`, and **one pool**, `/{net}/amm/{pool}`. The approved boards are `2026-10-17-explorer-mock/Amm.dc.html` and `AmmPool.dc.html`. Their sample data is made up.

**The data.** The AMM endpoints of the data API exist only on its branch `feat/amm-data` (`docs/api-reference.md`, section "AMM", and `docs/superpowers/specs/2026-10-17-amm-data-design.md`, read at commit `c3e2302`), which is not merged into `main`. Facts from there that shape this design:

- A pool is addressed by its **pool account**. The pair form `/v2/amm/pools/{base}/{counter}` takes the two assets in either order.
- `/v2/amm/pools` and `/v2/amm/pools/{pool}` are read from a table the aggregator rebuilds about every minute. A brand-new pool is 404 there until the next tick. The history, swaps, liquidity and governance routes find a pool as soon as its ledger is committed.
- A pool's state holds only what the metadata carried. On a database that has not been re-ingested from the AMM enablement ledger, most pools have no `lp_supply`, `trading_fee` or `lp_currency`. The branch's mainnet check found 18 of 463 pools with them after 987 ledgers (its verification report, F2). The node's `amm_info` has all of them for every live pool.
- `/history?interval=day` has one row per UTC day **with activity**. A quiet day has no row. Fee estimates are left out when a swap's fee was unknown.

**What the explorer does with pools today.**
- `app/domain/parse/amm-hops.ts` finds the pool hops of a payment, using the data API parser's rules.
- `app/domain/describe/amm.ts` writes the sentences of the six AMM transaction types. Those sentences and the payment flow show a pool as its pair (segment `pool`), which links to `/{net}/account/{pool}` (`Sentence.tsx`, `Flow.tsx`).
- The account page shows a pool account's `lsfAMM` flag as "AMM pool account", and an LP token on the Tokens card as "AMM pool r…", linking the account page.
- The transaction page tags a pool's balance changes "AMM pool".

## Decisions (from the owner)

| Topic | Decision |
|---|---|
| Program | The network, markets and AMM pages, plus new validators, amendments and account-analytics pages, as seven sub-projects. D1 (validators and amendments data) and D2 (account and market aggregates) are in `data-api-new`; E2 to E6 are in this repository. This spec is E5. |
| Mock | The boards are approved. Their sample data is placeholder. |
| Process | Auto-mode build after this spec and its plan are reviewed. |

## Owner decisions to confirm

The product choices of this spec and its departures from the approved boards. Each is built as written unless the owner says otherwise.

| Choice | Why |
|---|---|
| The list's tiles are "Swap volume, 24 h", "Pools with swaps, 24 h" and "Busiest pool, 24 h", not the board's pool counts, value locked and fees earned (section 2.1). | The API serves none of the board's three; the three shown come from one call that exists. |
| The board's figures without data are dropped, not stood in for: the pool, deleted-pool and over-value counts, the total value locked, the rankings by volume or fee, the list's 24 h fees and the pool's "Fees earned, 24 h" (sections 2.1, 3.1, 7). | Dropped for now. The 24 h fee estimates come with D2b, the rest has no planned source. |
| One exact asset in the filter (`XRP`, `RLUSD.rMxCK…`), sent to the API, not free text over a currency or an issuer filtered in the browser (section 2.1). | The API filters by one exact asset, and filtering one page of 20 in the browser would hide the pages behind it. |
| No sorting control and no "Fees 24 h, est." column: the API's value order (section 2.1). | The API orders by value only and serves no per-pool rolling fee. |
| Created on the list is the creation ledger, not a date; the pool page shows the date from the create event (section 2.1). | The pool object has `created_ledger`, not its time. |
| The pool's fees are shown for the last complete day, by asset ("12.5 XRP + 30.1 RLUSD"), not as "Fees earned, 24 h" in XRP (section 3.1). | There is no rolling per-pool estimate; the day's estimate is by asset and is not converted. |
| Swap volume comes from the pair's AMM-only candles, not from the pool's day rows (section 3.5). | The day rows hold only what went into the pool, by side. |
| No "Fee, est." column on the Swaps tab (section 3.1). | A swap row carries no fee. |
| Five charts: Pool price, Trading fee and Reserves below the board's Pool value and Swap volume (section 3.5). | The brief asks for the history of reserves, value, price, volume and fee, and one call serves them. |
| The tabs are links (`?tab=`), each indexable with its own canonical, as the account page's tabs (sections 3.1, 5.1). | One URL per tab, working without JavaScript. |
| The auction slot's 20 cells are the kit's `Meter`, and "expires in 9 h" is the UTC time in the HTML with E6's `Countdown` in the browser (section 3.1). | The house form of one ratio; a stored page holds no ages. |
| The pool page opens on 90 days (section 1.2). | The board's default. |
| No live refresh on either page (section 3.7). | Neither board has a live row, and the state card names the ledger it was read at. |
| Pairs in E3's natural orientation everywhere ("XRP / RLUSD", "USDC / RLUSD", "VOX / XRP"), not native first (section 3.4). | One orientation on every page of the program. |
| Production turns the pages on only after its data API has merged `feat/amm-data`, re-ingested from the AMM enablement ledger and back-filled (section 10). | Before the re-ingest most pools lack their fee, LP supply and creation; before the back-fill most days are missing. |
| Xahau: `/xahau/amm` is the board's "Xahau has no AMM" page, and `/xahau/amm/{address}` a 404 that offers the XRPL pool (section 1.3). | Xahau has no AMM, so a pool address there can only be an XRPL pool. |
| The charts say "A day without rows may not be computed yet." until D2b serves the range of computed days (section 3.5). | A quiet day cannot be told from an uncomputed one before that. |

## Goals

- `/{net}/amm` and `/{net}/amm/{pool}` show every element of the Amm and AmmPool boards that real data can fill, server-rendered, readable without JavaScript, charts included.
- One URL per pool: the pool account. The pair form and every non-canonical query string redirect to it.
- The pages ship switched off, whether or not `feat/amm-data` is merged and deployed by then. Production does not change until the switch is set.
- Every link to a pool (sentences, flows, LP tokens, a pool's own account page, E3's pool card, the header) leads to the pool page once the pages are on.
- The data API sees no new load pattern. Aggregates are kept for the minute or the five minutes they take to change, and lists are read 20 rows at a time by their markers.

## Non-goals

- Live refresh of either page (section 3.7).
- An account's LP positions and AMM history on the account page. `/v2/accounts/{address}/amm_positions` and `/amm_liquidity` exist; they belong to a later account-page change.
- The markets pages. E5 links to E3's market pages while E3's `MARKETS` switch is on (section 5.4).
- Dropped for now, with no stand-in: the number of pools, of deleted pools and of pools over a value; the total value locked; rankings of pools by volume or fee; a pool's creation time in the pool object (the list shows `created_ledger`, the pool page the create event); a per-swap fee estimate; filtering by a currency alone or by an issuer. Conversions the explorer would compute itself.
- Token names and logos (foundation non-goal), CSV downloads of the AMM lists, an Open Graph image of the list.
- Changes to the data API. What is missing is listed in section 7, with where it would come from.

---

## 1. Routes

### 1.1 Files

| File | |
|---|---|
| `app/routes/net.amm._index.tsx` | `route("amm", …)` under `:net` (id `routes/net.amm._index`): the list. `loader`, `meta`, `headers = forwardCacheClass`, the component. |
| `app/routes/net.amm.$pool.tsx` | `route("amm/:pool", …)` (id `routes/net.amm.$pool`): one pool. |
| `app/routes/net.amm.$base.$counter.tsx` | `route("amm/:base/:counter", …)`: the pair form. Its loader redirects or throws a 404. Its component is never drawn, but the route needs one so that the 404 is the layout's HTML page. |
| `app/domain/amm-params.ts` | Pure, used by loaders and links: `parseAmmListParams`, `parseAmmPoolParams`, `ammListHref`, `ammPoolHref`, `poolLink` (the inbound links), `AMM_TABS`, `AMM_PERIODS`. |
| `app/server/amm-view.ts` | The view builders: `ammListPage`, `ammPoolPage`, `ammHistoryPage`, `nextBidPrice`, `daySeries`. Pure; unit-tested. |
| `app/ui/pages/AmmListPage.tsx`, `AmmPoolPage.tsx`, `NoAmmPage.tsx` | Draw the pages from their data. They never fetch and import nothing from `app/domain/describe`, `app/domain/parse` or, at run time, `app/server`. |

E5 uses E3's `app/domain/asset.ts` and `app/domain/paging.ts`, E3's `amm_info` reader in `node-rpc.ts`, and E2's switch mechanism as they are.

Changes elsewhere:
- `data-api.ts` and `api-types.ts`: the AMM calls (section 2.2, 3.2).
- `app/ui/features.ts`, `env.ts` and `wrangler.jsonc`: `AMM_PAGES` joins E2's list of switches (`FEATURE_VARS`, `ammPages` in `Features`), with its `Env` field, its entries in every environment block and its tests (section 1.4). `route-handle.ts`: `NavSection` gains `"amm"`. Its off-case joins E2's `worker-off` project (section 8).
- `meta.ts`: `ammListMeta`, `ammPoolMeta`, `ImageKind` `amm`.
- `card-data.ts` (`poolCard`) and the og route.
- `Header.tsx`, `Sentence.tsx`, `Flow.tsx`, `AccountPage.tsx`, and E3's pair page pool card (section 5.3).
- `Pager.tsx`: optional `labels` (section 6).
- `loader-errors.ts` and `RouteErrorScreen.tsx`: the 404's `note`.
- `scripts/bundle-budget.ts`, the fixture generator, `test/support/upstream-core.ts` and `test/fixtures/PROVENANCE.md`.
- The README: a new section "AMM pools" (the routes, the switch, the classes, the fixtures), the "Upstream fixtures" rows (section 9) and the staging checklist (section 10).

### 1.2 URLs and parameters

| Path | Parameters (in canonical order) | Default |
|---|---|---|
| `/{net}/amm` | `asset`: one asset (below). `deleted`: `1` adds the deleted pools. `marker`, `back`: the page trail. | none |
| `/{net}/amm/{pool}` | `period`: `30d`, `90d`, `1y`. `tab`: `swaps`, `liquidity`, `governance`. `marker`, `back`: the tab's page trail. | `period=90d` (the board's), `tab=swaps` |
| `/{net}/amm/{base}/{counter}` | none | |

**Assets in a URL** are E3's one asset form (`app/domain/asset.ts`, E3 §1.2), the same in a market and a pool URL: the native code alone (`XRP`), an issued currency as `CUR.issuer` (`RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De` names the RLUSD pools). E5 reads it with E3's `parseAssetText`, which also reads the other separators (a space, which a raw `+` becomes in a query string, included), writes it with `assetText`, and sends the API `apiAssetText`. `URLSearchParams` writes the API's `+` as `%2B` in a query, and `segment()` encodes it in a path. E3's canonical case rule applies to `?asset=` and to `/{net}/amm/{base}/{counter}`: a standard three-character code is upper case, so `?asset=usd.r…` is redirected to `?asset=USD.r…`.

**One URL per view.** Each loader reads only its parameters. When the query string is not exactly the canonical form of what it names, the loader answers a 302 to the canonical URL (`cacheClassHeaders("short")`). These are E2's rules, for the same reason: a made-up query string would otherwise be a stored page and a set of upstream calls of its own. The canonical form:
- drops defaults (`?period=90d`, `?tab=swaps`, an empty `asset`), unknown values, repeats and unknown parameters;
- drops `back` without a `marker`;
- drops `period` beside a `marker` (a page of older rows has no charts, section 3.3);
- rewrites `asset` into its canonical URL form (`assetText`, with E3's case rule);
- orders the rest as in the table above.

An unknown `tab` is dropped like any unknown value. A list page reached with a marker keeps its `asset` and `deleted`.

The selectors (period, tabs, Newer/Older, the list's pager) are links built by `ammPoolHref` / `ammListHref`, so they work without JavaScript. With JavaScript they are client-side navigations with `preventScrollReset`. The list's filter is a GET form to `/{net}/amm`. It has the asset field, the "Include deleted pools" checkbox and a "Show pools" submit button (44 px), so it also works without JavaScript.

### 1.3 Validation, not found, deleted

Everything a URL carries is checked before any upstream call:
- a pool is a classic address with a valid checksum (`isValidClassicAddress`);
- an asset passes E3's `parseAssetText`, and the native currency has no issuer;
- a pair has two different assets;
- a marker passes `isMarker`, and a trail `parseTrail`.

| Request | Answer | Class |
|---|---|---|
| any AMM route while the AMM pages are off (section 1.4) | 404, "We couldn't find the AMM pages on {network}", no call | `short` |
| `/{net}/amm/{x}` where `x` is not a classic address (an X-address included: a pool takes no tag) | 404, no call | `short` |
| `/xahau/amm` | 200: the board's "Xahau has no AMM" page (`NoAmmPage`), no call, `noindex, follow` | `slow` |
| `/xahau/amm/{valid address}` | 404 "We couldn't find AMM pool r… on Xahau", note "Xahau has no AMM, so this pool exists only on the XRP Ledger.", suggestion "Open it on XRPL" (`/xrpl/amm/{pool}`), no call | `short` |
| a pool the index serves, `deleted: false` | the pool page | `live` (first page) |
| a pool the index serves, `deleted: true` | the pool page with a "Deleted" banner and history only (section 3.3) | `slow` |
| the index answers `pool not found`, and the node's `amm_info` has the pool | the pool page shown from the network: "Not in the index yet, shown from the network" (section 3.3) | `short`, TTL 60 s |
| the index answers `pool not found`, and so does the node | 404 "We couldn't find AMM pool r… on XRPL", suggestion "Open it as an account" (`/{net}/account/{pool}`) | `short` |
| the index answers `pool not found`, and the node fails | 503: a missing pool cannot be told from an outage, as on the account page | not stored |
| the index fails (5xx, 429, timeout, a malformed 200, a 400 for an address the loader checked, or the "Cannot GET" 404 of an API without the AMM routes) | 503 through `upstreamOutage` | not stored |
| a marker the API refuses (400), or a page with nothing behind its marker | 404 | `short` |
| `/{net}/amm?asset=…` with an asset that does not parse | 200: the list page with the message "Write an asset as XRP, or as a currency and its issuer: RLUSD.rMxCK…" under the field (what was typed, cut to 200 characters), and no pools call; `noindex, follow` | `short` |
| `/{net}/amm/{base}/{counter}` with both assets valid | `/v2/amm/pools/{base}/{counter}`. That route serves the live pool of the pair, and otherwise the one deleted last. Found: 302 to `/{net}/amm/{pool}`, class `slow` for a live pool and `short` for a deleted one (a new pool of the pair may come). Not found: 404 "We couldn't find an AMM pool for XRP/RLUSD on XRPL". Failure: 503. | as said |
| `/{net}/amm/{base}/{counter}` with an asset that does not parse, or the same asset twice | 404, no call | `short` |

**Which 404 is "pool not found".** E2's route-missing rule in `data-api.ts` applies as it is. A 404 whose body is the server's `Cannot GET …` (an API without the AMM routes, such as the data API's `main`) is kind `server`: an outage, never stored. A route's own not-found message stays `not_found`; on the pool routes that message is `pool not found`, the pool's absence. So a switch that is on in front of an API without AMM gives 503s and log lines, never stored 404s. `/v2/amm/pools` (the list) has no not-found of its own.

**The node's not-found answers** are E3's `amm_info` reader's mapping: `actNotFound` (an account that is not a pool) and `actMalformed` (an address that holds no account, a deleted pool's) are `not_found`, because the Worker has checked the address. The plan's first AMM task checks both answers against the configured node for the `amm_account` form.

The 404 data gains an optional `note`, a sentence shown under the heading. `RouteErrorScreen` passes it to `NotFoundPage` as its `message`. A `note` that is not plain text is left out, as a `suggestion` that is not a path of this site is.

### 1.4 The AMM pages switch, before and after the merge

The pages need `feat/amm-data` merged into the data API's `main`, deployed, and its data re-ingested and back-filled. They ship before that, switched off.

| | |
|---|---|
| The switch | `AMM_PAGES` is one of E2's feature switches, with E2's mechanism as it is: `"on"` or `"off"` per environment in `wrangler.jsonc`; the top level (development, tests) `"on"`, staging and production `"off"` when E5 ships. E2's pre-deploy guard knows the name and refuses any other value, because a typo would switch the pages off silently. |
| Why a variable and not a constant | Staging can go on while production stays off, from one commit (section 10). The `worker` project runs the pages with `"on"`, and E2's `worker-off` project with every switch `"off"`. |
| Why a stored page cannot show the other state | Pages hold the switch's effect: the header's AMM item, and pool links in sentences of `immutable` transaction pages. The switch is part of E2's `cacheGeneration(env)`, so a change of it never meets a page stored under the other value. E5 adds no cache key of its own. |
| How pages read it | As E2 §6.1 says: loaders read `net.features.ammPages` from `requireNetwork`; the links of a page drawn from its data come from its view builder; components not drawn from page data (the header, `Sentence`, `Flow`, the account page's LP tokens) call `useFeatures()`. A route shows the pools when `ammPages` is on and the network `hasAmm`, and Xahau's explanation when it is on and the network has no AMM. |
| `AMM_DATA` | E2's other AMM switch says whether the data API of the environment has complete AMM data, and it gates the AMM parts of the other pages. The pages here are all AMM data, so the owner turns `AMM_PAGES` on in an environment only where `AMM_DATA` is on (section 10). |

| | `AMM_PAGES` off | `AMM_PAGES` on |
|---|---|---|
| Header | "AMM" with the "soon" tag, as today | a link to `/{net}/amm`, on both networks (Xahau's page explains); `.is-current` on the AMM pages, through E2's `navSection` handle: `aria-current="page"` on `/{net}/amm` and `aria-current="true"` on a pool page |
| `/{net}/amm…`, `/og/{net}/amm/…` | 404, class `short`, no call | the pages |
| Pool links in sentences and flows, LP tokens on the account page, E3's pool card | the account page, as today | the pool page |
| A pool account's own account page | as today | adds "This account is an AMM pool. See the pool →" |
| E2's network page | unchanged: its AMM series follow `AMM_DATA`, not this switch | the same |

The three routes export `handle = { navSection: "amm" }`, and E5 widens E2's `NavSection` with `"amm"` (E2 §6.2).

`poolLink(net, pool, features)` (`amm-params.ts`) is the one place that decides where a pool link goes: the pool page when `features.ammPages` is true, else the account page. `features` is E2's `Features`: `net.features` in a view builder, `useFeatures()` in a component. Where the `/:net` layout's data is missing (an unknown network's error page, a test without the layout) `useFeatures()` gives E2's `NO_FEATURES`, so the link goes to the account page, and it never throws. E5 adds no field of its own to `Network` and no hook of its own.

**API paths before the merge.** The AMM paths are not in `api/openapi.yaml` yet, so they go into E2's `PENDING_PATHS`, outside the compile-time check:
- `/v2/amm/pools`, `/v2/amm/pools/{pool}`, `/v2/amm/pools/{base}/{counter}`;
- `/v2/amm/pools/{pool}/history`, `/swaps`, `/liquidity`, `/governance`.

These are the OpenAPI document's own spellings on `feat/amm-data`. `/v2/exchanges/{base}/{counter}` is already in `PATHS`; its `amm` parameter is new, and parameters are not checked. `test/unit/pending-paths.test.ts` fails once `pnpm api:sync` brings these paths in, and says to move them into `PATHS`.

---

## 2. The pools list, `/{net}/amm`

### 2.1 Layout and content

From the top, as on the board. On a phone, the same order in one column.

| Element | Content |
|---|---|
| Heading | `<h1>` "AMM pools", and the board's intro: "Automated market maker pools on the XRP Ledger. Swaps against them also count as DEX trades." That holds because swaps are exchanges in this API. |
| Filters (`role="group" aria-label="Filters"`) | The GET form. A field labelled "Pools with this asset" (placeholder "XRP or RLUSD.rMxCK…"), with the error message of section 1.3 under it when it does not parse. "Include deleted pools" (a checkbox with its label, 44 px tall). "Show pools". |
| Totals (`section aria-label="Totals"`), three `StatTile figure`s | "Swap volume, 24 h": the live set's `total`, compact, with the native unit; sub "{count} swaps". "Pools with swaps, 24 h": the number of components; sub "that could be priced in XRP". "Busiest pool, 24 h": the pair of the first component, in E3's natural orientation, as a link to its pool page; sub "{compact converted_amount} XRP of swaps". A note under the tiles: "As of {end_time, HH:MM} UTC." |
| AMM swap volume per day, in {native}, last 30 days | E2's `ColumnChart layout="single"` over E2's 30-day window (`windowOf(T, "30d")`): today and the 29 days before, today marked "so far" (`forming`). One extra per day (E4's `extras`): "Swaps", the row's `count`, format count. Source line `/v2/network/amm_volume?interval=day`. |
| On Xahau, in place of everything below the heading (`NoAmmPage`) | The board's card: an icon, "Xahau has no AMM", "The AMM amendment is not part of Xahau, so there are no pools to show. Trades on Xahau are order-book crossings.", "See Xahau markets →" (section 5.4) and "Switch to XRPL pools" (a link to `/xrpl/amm`). The intro reads "Automated market maker pools." |
| Pools (`section aria-labelledby`), a `DataTable` | Head: "Pools", source line "/v2/amm/pools · ordered by value". Columns: Pool, Value ({native}), Reserves, Fee, Volume 24 h, Auction slot, Created. Pager below: "Previous" / "More pools". An empty page: "No pools have {asset}." Footnote: "Value is twice the {native} reserve, or twice a reserve at its daily {native} rate. Volume 24 h is the swap volume of the last 24 hours in {native}, as of {time} UTC." |

**A row of the table.**

| Column | Content |
|---|---|
| Pool | The coins (`aria-hidden`). The pair, as a link to `/{net}/amm/{pool}`. Under it, in faint mono, the account short and each issued asset's issuer: `rhWTXC…tcS3 · RLUSD rMxCKb…m5De`. A deleted pool has a "Deleted" tag (icon and text). |
| Value | `value_native`, compact. "—" when the API left it out (no rate, or a deleted pool). |
| Reserves | The two reserves, compact, each with its currency, in display order (section 3.4). "—" for a reserve the index does not know. |
| Fee | `trading_fee` as a percent with three decimals (`300` → `0.300%`). "—" when unknown. |
| Volume 24 h | The live set's component of this pool: `converted_amount`, compact. A pool with no component reads "0" when it holds the native currency (such a pool always converts) and "—" otherwise (it may have had swaps that could not be priced). |
| Auction slot | The holder, short, as a link to its account. "Open" when there is no holder or its `expiration` is not after the live set's `end_time`. The data's own "now" is used, not the clock, so the stored page does not depend on when it was rendered. |
| Created | The creation ledger as a link, `#86,800,123`. "—" when the index did not ingest the creation. |

The list shows compact figures (`compactNumber`, made with BigNumber from the exact strings). The pool page shows exact ones.

**Deviations from the board**

| Board | Here | Why |
|---|---|---|
| Tiles "Pools 14,906 · 312 deleted · 1,212 worth over 10K", "Value locked", "Fees earned, 24 h" | "Swap volume, 24 h", "Pools with swaps, 24 h", "Busiest pool, 24 h" | The API serves no count of pools, no total value and no network fee estimate. The counts and the value are dropped for now; the fee estimate comes with D2b (section 7). The three tiles come from one call that exists. |
| Free-text "Pools containing a currency or issuer", filtered in the browser | One asset, sent to the API as `asset` | The API filters by one exact asset. A currency alone, or an issuer alone, is not a filter it has, and filtering one page of 20 in the browser would hide the pages behind it. |
| Sortable Value, Fee and Volume columns | No sort; the API's order (value) | The API orders by value only. Sorting one page of 20 would misrepresent the list, the reason the account page has no type filter. |
| "Fees 24 h, est." column, and the footnote's fee sentence | Left out | There is no per-pool rolling fee estimate before D2b (section 7). |
| Created "22 Mar 2024" | The creation ledger | The pool object has `created_ledger`, not its time. The pool page shows the date from the create event. |
| "More pools →" | `Pager` with the labels "Previous" and "More pools" | Markers run one way. The trail is the account lists' (section 1.2). |
| The checkbox filters at once | A form with a "Show pools" button | It works without JavaScript. |

### 2.2 Data calls

| # | Call | Query | Subrequest class, kept | Shared with | Feeds | On failure |
|---|---|---|---|---|---|---|
| 1 | `/v2/last_validated` | | `live`, kept 2 s (`HOME_CALL_TTL_SECONDS`) | home, network | `T`, the window | chart card failed |
| 2 | `/v2/amm/pools` | `limit=20`, then `asset`, `include_deleted=true`, `marker` when given | `minute` (kept 60 s) | | the table | Pools card failed |
| 3 | `/v2/network/amm_volume` | `live=day` | `minute` (kept 60 s) | the pool page | tiles, Volume 24 h, "Open" | tiles "—" with one `SectionError` under them; the Volume 24 h column "—" and its card notes "Couldn't load the 24-hour volume" |
| 4 | `/v2/network/amm_volume` | E2's 30-day query, through E2's `ammVolume` with E2's arguments | `slow`, kept 300 s (`PERIOD_CALL_TTL_SECONDS`) | the network page's 30-day view (the same key) | the chart | chart card failed |

The class `minute` is E3's (kept 60 s), and 60 s is also the cadence of the aggregator that rebuilds the pools and the live volume sets. E5 adds no constant for it.

**New client methods** (`data-api.ts`; types in `api-types.ts`, from the reference at the pinned commit):
- `ammPools(q)`: `Page<"pools", AmmPool>`.
- E2's `ammVolume` gains the live form, `ammVolume({ live: "day" })`, class `minute`. Its answer is a `VolumeRow` with `AmmVolumeComponent`s: `{ amm_account, base, counter, count, amount, rate, converted_amount }`.

Each answer's shape is checked inside the cached load, as E2 does: lists where lists belong, amounts as decimal strings, `trading_fee` an integer from 0 to 1000, `deleted` a boolean, addresses valid. A malformed 200 is an `UpstreamError` of kind `server` and is not stored. An API without the route answers "Cannot GET", which E2's route-missing rule makes kind `server`: the card fails, and the line "the data API serves no AMM volume" is logged.

### 2.3 The loader

1. `requireNetwork`. Switch off: 404. Xahau: `NoAmmPage` data, class `slow`, no call. Then the canonical-query redirect.
2. An asset that does not parse: the page with the field's error, without call #2 (section 1.3). The other calls run.
3. #1 to #4 side by side, all awaited with `Promise.allSettled`. #4 waits for #1. Every call, the chain included, is raced against E2's 4.5 s card deadline from the start of the loader. Past it the card is `failed`, with the reason "took too long".
4. #2 answering 400 for a marker is a 404 (section 1.3).
5. `ammListPage(...)` builds the data. Every failed card is logged (`logProblem`) and marks the request degraded (`markDegraded`).
6. `cached(page, "live")`, for the first page and for a page reached with a marker alike. Nothing is deferred.

**Why `live`, and `live` behind a marker.** A render reads only entries kept 60 s and 300 s, so a cache miss costs the data API nothing within the minute. 5 s + 30 s at the edge bounds how stale the 24 h figures look on a reload. The pools are ordered by value, which the aggregator changes every minute. A marker (the value and account of the last pool) is a cursor into a ranking that moves, not a page of history, so it is not `MARKER_PAGE_CLASS`. A pool can move between pages from one minute to the next; the footnote's "as of" time says when the ranking was read.

### 2.4 View builder rules (`ammListPage`)

| Part | Rule |
|---|---|
| Pair | The display pair of section 3.4: E3's natural orientation. |
| Join | Components of #3 by `amm_account`, into a `Map`. A component whose pair is turned round (the native currency is the API's `counter` in `amm_volume`) is matched by account only. |
| Tiles | `total` and `count` of the live row; `components.length`; `components[0]` (the API sorts by `converted_amount`, largest first). With no component, the third tile reads "—", sub "no swaps in the last 24 hours". |
| Chart | Drawn as E2's network page draws its AMM series over the same window and call: E2's buckets from `windowOf`, its alignment, and its rule for the running day ("so far") and for a bucket the API has not computed. The extra "Swaps" is `String(count)`. |
| Fee | `BigNumber(fee).shiftedBy(-3).toFixed(3) + "%"`. |
| Paging | `trailPaging` with `ammListHref`. |
| Tokens | Every chart and card carries E2's `token`. |

### 2.5 Failures

| What failed | Page | Stored |
|---|---|---|
| #1 or #4 | the chart card: `SectionError` "Couldn't load the swap volume" and Retry | no (degraded) |
| #2 | the Pools card: `SectionError` "Couldn't load the pools" | no |
| #3 | as in the table of section 2.2 | no |
| #2 answers 400 for a marker | 404 | `short` |

Retry is E3's `useRetry()` (`app/ui/use-retry.ts`: `useRevalidator().revalidate()`, the explorer's own `.data` URL), as on the account page.

---

## 3. The pool page, `/{net}/amm/{pool}`

### 3.1 Layout and content

From the top, as on the board. On a phone, the same order in one column, with each card pair folding (`flex: 1 1 420px`).

| Element | Content |
|---|---|
| Breadcrumb (`Breadcrumbs`) | "XRPL / AMM pools / XRP/RLUSD"; the last item is `aria-current="page"`. |
| Pool card (`section aria-label="Pool"`) | The coins (`aria-hidden`). `<h1>` "XRP / RLUSD pool", the pair in E3's natural orientation. "Market →" to the pair's market page (section 5.4). "Pool account {full address}", a link to `/{net}/account/{pool}`, with `CopyTextButton` (44 px). "{CUR} issued by {issuer}", once per issued asset, the issuer a link to its account. "Created {date} by {account}": the date (house format, `formatUtc`'s date) links to the creating transaction and the account to its page; the line is left out when the index has no creation event. "LP token `03A1F7…9C2E`", with a copy button for the full code. |
| Notices | Deleted, from the network, live state unavailable, gone from the network, an asset frozen (section 3.3, 3.6): `Notice` with icon and text. |
| Pool state (`section aria-label="Pool state"`) | One card holding seven stats in the board's grid (`repeat(auto-fit, minmax(170px, 1fr))`). See below. Caption: "Live from the network at ledger #N" (the ledger links), or "From the index, ledger #N" when the node failed. |
| Filters | "Period": 30 days, 90 days, 1 year, as E2's segmented control of links (`aria-current="true"`, 44 px targets). Source line `/v2/amm/pools/{short}/history?interval=day`. Then the period note: "Charts cover " and the `note` of E2's `windowOf`, with its exact dates and its running bucket ("Charts cover the 90 days from Jul 20 to Oct 17, 2026 (UTC), today so far"). |
| Charts, in pairs | Pool value · Swap volume (the board's pair). Pool price · Trading fee. Reserves, full width (section 3.5). |
| Auction slot (`section aria-labelledby`) | Head "Auction slot"; on the right "until Oct 18, 2026 09:00 UTC", followed by E6's `Countdown` on the expiration, with an empty server text and `past` "expired" ("in 9 h" in the browser). Holder (link), "Their trading fee" (`discounted_fee`, three decimals), "Price paid" ("1,240.0 LP tokens"), "Authorized accounts" (links, or "none"). The kit's `Meter` (value the interval, max 20, label "Interval 13 of 20 of the 24-hour slot"), and the text "Interval 13 of 20 of the 24-hour slot. A new bid now costs at least 1,302.0 LP tokens." An open slot reads "The slot is open." plus the cost sentence. |
| Fee votes (`section aria-labelledby`) | Head "Fee votes"; on the right "weighted by LP tokens held". A `BarList`: one item per vote slot, label the account (a link), sublabel "votes for 0.250%", the bar its weight, at the tip "21% of LP tokens". Under it: "Weighted result **0.300%**, the pool's trading fee." |
| Pool activity (`section aria-label="Pool activity"`) | `Tabs` (links, `aria-label="Pool activity"`): Swaps, Liquidity, Votes and bids. The tab's source line, the board's `tabSrc`: `/v2/amm/pools/{pool}/swaps`, `/liquidity`, `/governance`. The table, then the footer: "Newest first. Signs are from the pool's side: + went in, − came out." On Swaps, also: "Amounts are the pool's own changes; on the asset it pays out they include the issuer's transfer fee." `Pager` (Newer / Older). |

**The seven stats**

| Stat | Value | Sub |
|---|---|---|
| Value | Native pool: 2 × the native reserve from `amm_info`, compact. Otherwise: the index's `value_native`, compact. | "twice the {native} reserve" / "twice a reserve at its daily {native} rate" / "—" with "neither asset has a {native} rate" |
| Reserves | The two reserves, exact (`formatAmount`), each with its currency, in display order | |
| Pool price | `second / first` of the reserves, 8 significant digits (section 3.4) | "{second} per {first}, from the reserves" |
| Trading fee | `trading_fee`, three decimals | "set by N votes" (the vote slots) |
| LP tokens | `lp_token.value`, exact | "in circulation" |
| Swap volume, 24 h | This pool's component of the live set: `converted_amount`, compact, with the native unit | "{count} swaps, as of HH:MM UTC". With no component: "0" for a native pool, "—" otherwise. |
| Fees earned, {T − 1 day, as "Oct 16"} | The last complete day, whatever the period (call #10): `fees_counter_est` and `fees_base_est`, exact, in display order, as "12.5 XRP + 30.1 RLUSD". "0" with no row that day. "—" when an estimate is left out. | "estimate, paid to liquidity providers"; with "—": "a swap's fee is unknown" |

**The tables of the tabs**

| Tab | Columns |
|---|---|
| Swaps | Time (UTC), a link to the transaction. Direction, "XRP → RLUSD" (what went in → what came out). Into the pool, "+512.40 XRP". Out of the pool, "−1,250.00 RLUSD". Price, "{second} per {first}". Taker, a link. |
| Liquidity | Time (UTC), a link. Event: a tag, "Create", "Deposit", "Withdraw", "Clawback" or "Delete". Mode (mono, as served; empty when the event has none). {first currency}. {second currency}. LP tokens. Provider: a link; a clawback adds "by {initiator}". Amounts are signed: a plus in the success colour, a minus, or a plain "0". |
| Votes and bids | Time (UTC), a link. Kind: a tag, "Vote" or "Bid". Account, a link. What happened: "Voted for 0.400%"; "Won the auction slot for 1,240.0 LP tokens; fee 0.030% for the holder and 2 authorized accounts", the parts left out when the row lacks them. Fee after: a vote's `trading_fee_after`, "—" for a bid. |

The times are the account tabs' format. Row keys: `tx_hash:node_index` (swaps), `ledger_index:tx_index` (liquidity, governance).

**Deviations from the board**

| Board | Here | Why |
|---|---|---|
| "Fees earned, 24 h · 42.0K XRP" | "Swap volume, 24 h" from the live set, and "Fees earned, {last day}" by asset | No rolling per-pool fee estimate before D2b. The day's estimate is by asset and is not converted (section 7). |
| Swap volume "in XRP" | From the pair's AMM-only daily candles (section 3.5) | The day rows hold only what went into the pool, by side. Both legs in XRP need the candles. |
| Swaps' "Fee, est." column | Left out | A swap row carries no fee, and the fee in force at each swap (or the slot's discount) is not served. Dropped for now. |
| Two charts | Five: Pool price, Trading fee and Reserves added below the board's two | The E5 brief asks for the history of reserves, value, price, volume and fee. They come from the call the value chart already makes. |
| Tabs as `role="tablist"` buttons | Tabs as links, `?tab=` | One URL per tab, and they work without JavaScript, as the account page. |
| The slot's 20 cells | The kit's `Meter` | It is the house form of one ratio; the text says the interval. |
| "expires in 9 h 12 m" in the page | The UTC time in the HTML, E6's `Countdown` in the browser | A stored page holds no ages. |
| "Fee after" on a bid row | "—" | A bid row carries no fee. |
| "Market →" | The same, to E3's market page in the natural orientation, while E3's `MARKETS` is on; the "soon" style while it is off | Section 5.4. |
| 30 px copy button | 44 px | The house target size (WCAG 2.2 AA). |

### 3.2 Data calls

| # | Call | Query | Subrequest class, kept | Shared with | Feeds | On failure |
|---|---|---|---|---|---|---|
| 1 | `/v2/amm/pools/{pool}` | | `minute` (kept 60 s) | og route (same key) | the mode, pair, header, Value (non-native), the index fallback | section 1.3 |
| 2 | node `amm_info`, E3's `ammInfo(pool)` | `amm_account={pool}`, validated | `live` (5 s) | | the state, slot and votes | section 3.6 |
| 3 | `/v2/last_validated` | | `live`, kept 2 s | home, network | `T`, the window | the five chart cards failed |
| 4 | `/v2/amm/pools/{pool}/history` | `interval=day&start={W₀}&end={W₁}&limit=1000` | `slow`, kept 300 s | | value, price, fee, reserves, the fee extras | section 3.6 |
| 5 | `/v2/amm/pools/{pool}/history` | `interval=day&end={W₀ − 1 day}&descending=true&limit=1` | `slow`, kept 300 s | | the carry-in of #4 | as #4 |
| 6 | `/v2/exchanges/{base}/{counter}`, E3's `pairCandles` | `amm=only&interval={1day\|7day}&start={W₀}&end={W₁}&limit=400`, the pair in the pool's stored order | `slow`, kept 300 s | | the swap volume chart | volume card failed |
| 7 | `/v2/amm/pools/{pool}/{swaps\|liquidity\|governance}` (the tab) | `descending=true&limit=20`, and `marker` behind a marker | `live` (5 s); `MARKER_PAGE_CLASS` with a marker (`listClass`) | | the tab | activity card failed |
| 8 | `/v2/amm/pools/{pool}/liquidity` | `event=create&limit=1` | `slow` (1 h) | og route (same key) | the Created line | the line is left out and logged; the page is not degraded |
| 9 | `/v2/network/amm_volume` | `live=day` | `minute` (kept 60 s) | the list page | Swap volume, 24 h | that stat "—", "Couldn't load" |
| 10 | `/v2/amm/pools/{pool}/history` | `interval=day&start={T − 1 day}&end={T − 1 day}&limit=1` | `slow`, kept 300 s | every period of the pool (one key) | Fees earned, last day | that stat "—", "Couldn't load" |

`W₀`, `W₁` and the API dates are E2's `windowOf(T, period)` for `30d`, `90d` and `1y`, which includes the running bucket: `30d` and `90d` end with `T`, today, and `1y` is the 52 weeks from Monday up to and including `T`'s week, for which #6 uses `interval=7day`, whose buckets start on Monday. #6 asks in the pool's stored order, so the API inverts nothing; the builder maps the sides to the display pair. Its newest candle is the running day or week, still forming. The limits fit: at most 364 day rows (limit 1000) and 90 candles (limit 400).

**New client methods:**
- `ammPool(pool)`, `ammPoolByPair(base, counter)`: the `pool` key, unwrapped.
- `ammPoolDays(pool, q)`: `Page<"days", AmmPoolDay>`.
- `ammSwaps(pool, q)`: `Page<"exchanges", AmmSwap>`. `AmmSwap` is the raw row of `/v2/exchanges` with `amm_account`.
- `ammLiquidity(pool, q & { event? })`: `Page<"liquidity", AmmLiquidityEvent>`.
- `ammGovernance(pool, q)`: `Page<"governance", AmmVote | AmmBid>`.

The candles are E3's `pairCandles(b, c, { interval, start, end, limit, amm: "only" }, { cls: "slow", ttl: PERIOD_CALL_TTL_SECONDS })`, and the node's state is E3's `ammInfo(pool)`, the `amm_account` form of E3's `amm_info` reader, with E3's `AmmInfo` type. E5 reads more of its fields than the pair page does: `account`, `amount`, `amount2`, `asset_frozen`, `asset2_frozen`, `lp_token`, `trading_fee`, `vote_slots` (`account`, `trading_fee`, `vote_weight`), `auction_slot` (`account`, `auth_accounts`, `discounted_fee`, `expiration`, `price`, `time_interval`) and the ledger it was read at, with the slot's `expiration` in unix seconds and a missing `vote_slots` as `[]`, as E3's reader gives them.

The shape checks are those of section 2.2. `ammPool` also checks that `amm_account` is the pool asked for. The reader's own checks are E3's.

### 3.3 The loader and its modes

1. `requireNetwork`. Switch off: 404. The pool address checked; Xahau: the 404 with its offer (section 1.3). Then the canonical-query redirect.
2. **A page reached with a marker** (`ammHistoryPage`): #1 and #7, awaited whole.
   - Shown: the breadcrumb, the pool card without the Created and LP-token lines, the activity card on that page, and a link "Back to the pool" to the first page. Nothing else: no state, slot, votes or charts, which would be as old as the stored page (the account page's ruling 4).
   - Class `MARKER_PAGE_CLASS`, `noindex, follow`.
   - A marker the API refuses, or an empty page: 404. #1 `pool not found`: 404. Any other failure: 503 (`upstreamOutage`).
3. **A first page.**
   - #1, #2, #3, #7, #8 and #9 start together.
   - #4, #5 and #10 start when #3 answers.
   - #6 starts when #3 answers and the pair is known: from #1, or from #2 when #1 is `pool not found`.
   - Everything is awaited with `Promise.allSettled`. Every card-level call and chain is raced against the 4.5 s card deadline from the start of the loader.
   - #2 runs beside #1 rather than after it, so the page waits for the slower of the two, not their sum. Its answer is not used for a deleted pool.
4. **The mode, from #1 and #2:**

| #1 | #2 | Mode | Shown | Class |
|---|---|---|---|---|
| live pool | the pool | indexed | everything | `live` |
| live pool | failed | indexed, node down | the state card from the index's pool (reserves, `lp_supply`, `trading_fee` where known) with the notice "Live state unavailable; shown from the index" and Retry (E3's `LiveStateNotice`, with this text and no `role`). The slot card from the index's `auction_slot`, without its interval, cost or authorized accounts. Fee votes: `SectionError` "Couldn't load the fee votes". | degraded: served, not stored |
| live pool | `not_found` | indexed, gone from the network | the notice "The network no longer has this pool; the index may not have seen its deletion yet." The state card from the index; no slot or votes cards. | `live` (an answer, not degraded) |
| deleted pool | not used | deleted | the "Deleted" banner: "This pool was deleted. The last ledger that touched it is #N" (`last_ledger`, a link). Charts and activity; no state, slot or votes cards. | `slow` |
| `pool not found` | the pool | from the network | the notice "Not in the index yet, shown from the network. Its history appears once the index has it." Pair, header and state from #2. A `pool not found` from #4, #5, #7 or #10 is read as an empty answer: the index has no committed state of the pool yet. The charts then show their "No data" state. | `short`, TTL 60 s |
| `pool not found` | `not_found` | none | 404 (section 1.3) | `short` |
| `pool not found` | failed | none | 503 | not stored |
| failed | any | none | 503 | not stored |

5. `ammPoolPage(...)` builds the data. Failed cards are logged and mark the request degraded, as in section 2.3.
6. `cached(page, cls)`. Nothing is deferred. The cards have their deadline, and the slow calls are kept 300 s, so a render almost always finds them warm. The first page is one awaited answer, for people and bots alike.

### 3.4 View builder rules (`ammPoolPage`)

| Part | Rule |
|---|---|
| Stored pair | E3's `canonicalPair(a, b)` (`asset.ts`) gives the order the API stores a pair in. The lists' `base_*` and `counter_*` follow it. E5 needs it only where the API gives no pair (the pool from the network), to ask #6 in the stored order. |
| Display pair | E3's `naturalOrientation(a, b, native)`, as every page of the program shows a pair: `first` is its base and `second` its counter. The heading, the price ("{second} per {first}"), the columns, the reserves, the list rows and the tiles follow it. An XRP/RLUSD pool reads "XRP / RLUSD" with prices in RLUSD per XRP, as on the board; a pool of an unranked token against XRP reads "VOX / XRP". |
| Exact division | Prices are divided with a BigNumber clone with `DECIMAL_PLACES: 200`, as the API inverts rates, then `.precision(8)`, written in plain decimal without trailing zeros. Pool price: `reserve(second) / reserve(first)`. Swap price: `amount(second) / amount(first)` of the row, the effective price including the fee. A zero divisor gives "—". |
| `amm_info` amounts | As E3's `AmmInfo` gives them: the reader has already turned the native amount from drops into whole units at the node boundary, so the builder converts nothing. An issued amount is its `value`. Assets are matched to `first` and `second` by currency and issuer. |
| Swap direction | The reference: "if base flowed out of the pool, `buyer` is the taker and `seller` is the pool". So `seller === amm_account` means base out and counter in; otherwise base in and counter out. In and out are mapped to the display pair. |
| Liquidity | The amounts are signed from the pool's side as served. They are mapped from base and counter to the display columns, with `+` added to a positive amount. |
| Percent of a fee | `trading_fee`, `fee_voted`, `trading_fee_after` and `discounted_fee` are in units of 1/100000: `BigNumber(x).shiftedBy(-3).toFixed(3) + "%"`. |
| Vote shares | `vote_weight / 1000` percent of LP tokens, as whole percents, "<1%" below 0.5 (E2's share rule). Sorted by weight, then account. |
| Auction interval | `time_interval` 0 to 19 is "Interval {n + 1} of 20". 20, a missing slot, or a slot without `account` is "open". |
| Next bid cost (`nextBidPrice`) | rippled's `AMMBid.cpp`. `min = lpTokens × tradingFee / 100000 / 25`. Open slot: `min`. Interval 0: `price × 1.05 + min`. Interval n: `price × 1.05 × (1 − ((n + 1) / 20)^60) + min`. Computed with BigNumber and shown rounded **up** to 6 significant digits, so "at least" stays true. A cost of 0 leaves the sentence out. A unit test checks the formula against the recorded `AMMBid` (ledger 106084525): the price the bid paid is at least the cost worked out from the slot before it (the `AMM` node's `PreviousFields`). |
| Frozen | `asset_frozen` / `asset2_frozen`: the notice "{CUR} in this pool is frozen by its issuer". |
| Exactness | Every number in the page data is a string made from the API's or the node's text, or with BigNumber. JSON numbers become strings with `String(n)`. No float reaches a label. |

### 3.5 Charts

Every chart is a kit component (E2 section 2) inside a `ChartCard`, with its source line, the Chart/Table radios and E2's states. Buckets are `windowOf`'s: days, or Monday weeks for `1y`, the running day or week included and marked "so far" (E2's `forming: true`), as on every time-series chart of the program (E2 §6.6).

The cards that read the pool's day rows (value, price, fee, reserves, and the volume card for its fee extras) also note "A day without rows may not be computed yet." until the data API names the days it has computed (D2b, section 7). The candles are computed from the trades on read, so the volume itself needs no such note.

| Card | Kit form | Series | Notes |
|---|---|---|---|
| Pool value, in {native} | `LineChart area` | `value_native` per bucket | "A day without activity keeps the value of the day before." A pool with no value anywhere shows "No value in {native}: neither asset of this pool has a {native} rate." |
| Swap volume per day \| week, in {native} | `ColumnChart layout="single"` | The candle's volume on the native side (`counter_volume` or `base_volume`, whichever is the native currency). For a pool without the native currency, the side of `first`, titled "in {first currency}". | E4's `extras`: "Swaps" (the candle's `count`, format count), and "Fees, est., {first}" and "Fees, est., {second}" from the day rows (format amount, with the currency). Note: "Swaps with a {native} leg of 0.0005 or less are left out, as in every DEX aggregate of the data API." |
| Pool price, {second} per {first} | `LineChart` with `domain` from the lowest to the highest value, nice-rounded | `reserve(second) / reserve(first)` at the end of each bucket | "The axis starts at {domain min} {second}." (E2's wording for a line with a domain) |
| Trading fee | `LineChart curve="step"`, from 0, format `percent` | `trading_fee` at the end of each bucket | "Each vote moves the fee; the Votes and bids tab lists them." |
| Reserves | `SmallMultiples`, fed with E2's `SmallMultiplesData` (E2 §2.3) as it is: two panels, one per asset, each with its `label` (the currency), its issuer as `sublabel` and its own `format` | the reserve of `first`, the reserve of `second`, as each panel's `values` | "Each asset on its own scale." |

**The day series (`daySeries`).** The pool's days are a sparse list: a day with no row had no swap, deposit, withdrawal, vote or bid. The window's buckets are filled like this:

1. **Existence.** The pool exists from its first known day: the carry-in row (#5) when there is one, which means it existed before the window; otherwise its first row in the window. A deleted pool exists until its last row. Before and after, every series is `null`, a gap.
2. **States** (value, price, fee, reserves). A day with a row takes the row's field; a field the row leaves out is `null`. A day with no row inside the pool's life takes the previous day's value, or the carry-in's for the first days. A week (`1y`) takes the value of its last day by that rule.
3. **Flows** (swap volume, swaps). A bucket with a candle takes it. A bucket with no candle, or with a candle whose `count` is 0, is `"0"` inside the pool's life. That reading holds whether or not the API serves candles for buckets without trades.
4. **Fee extras.** A day with a row takes `fees_*_est`, or `null` ("—", unknown) when the row has swaps and leaves the estimate out. A day without a row inside the pool's life is `"0"`. A week is the sum of its days, or `null` when any of them is.
5. **A pair's earlier pool.** A pair can have had an earlier pool, deleted before this one was created. Its swaps are in the pair's candles, but they fall before this pool's existence, so rule 1 masks them.
6. **The running day or week** is the last bucket and is marked "so far". Its row, when the aggregator has written one, holds the day so far; its candle is still forming. A missing row, on any day, is read as a quiet day, and the cards' note says it may not be computed yet. That reading is close to right only once the aggregator has back-filled the pool's days, which is why production waits for the back-fill (section 10), and exact once D2b names the computed days.

### 3.6 Failures, card by card

| What failed | Page | Stored |
|---|---|---|
| #1, or #1 `pool not found` with #2 failing | 503 with `Retry-After`; the edge serves a stored copy if it has one | no |
| #2 | the "indexed, node down" mode of section 3.3, with Retry | no (degraded) |
| #3 | the five chart cards: `SectionError` "Couldn't load the charts", with one Retry for all | no |
| #4 or #5 | value, price, fee and reserves: `SectionError` each. The volume chart is drawn without its fee extras and notes "The fee estimates couldn't be loaded". | no |
| #10 | the Fees earned stat: "—", "Couldn't load" | no |
| #6 | the volume card: `SectionError` "Couldn't load the swap volume" | no |
| #7 | the activity card: the tabs stay links, the table becomes `SectionError` "Couldn't load the swaps" (or "the liquidity events", "the votes and bids") | no |
| #8 | the Created line is left out, logged (`logProblem`) | yes: the page is whole without it, as the account's "Last active" time |
| #9 | the Swap volume, 24 h stat: "—", "Couldn't load" | no |

Retry is E3's `useRetry()`, as on the list.

### 3.7 Live refresh: no

Neither page follows the chain. Reasons:
- Neither board has the network board's live status or pause control.
- The closest page, the account page, does not follow the chain either.
- The state card names the ledger it was read at, so a visitor knows its age. A reload gets a copy at most 5 s fresh plus 30 s stale.
- A 4 s beat on pool pages would need E2's `live-home` class and a pause control on up to some 15,000 pages, each render making a node call.
- The list's figures change once a minute, when the aggregator rebuilds them.

A later change can add live refresh with E2's pieces as they are:
- `createLiveOnScreen({ order: d => d.anchor.lastValidated, merge: (next, shown) => keepLoaded(next, shown, [the card names]) })`, with E2's `Anchor` in the page data;
- `useLiveControls`;
- the scope `` `${net}${pool}${canonical search}` ``;
- `DataTable live` keyed by the row keys of section 3.1.

The pages need no other change for it. E2 §6.8: every page that polls opts in to the failure hold for every upstream call, the home page included; these pages do not poll, so they do not opt in. A later change that adds live refresh opts in with it.

---

## 4. Caching

| Answer | Edge class | Why |
|---|---|---|
| `/{net}/amm`, first page or behind a marker, filtered or not | `live` | Section 2.3: renders read entries kept 60 s and 300 s. |
| `/{net}/amm` with an asset that does not parse | `short` | A typo is a page nobody will ask for again. |
| `/xahau/amm` | `slow` | No call; it changes only with the code. |
| `/{net}/amm/{pool}`, first page | `live` | The live state and the newest rows change with the ledger, as on the account page's first page. |
| the same, a deleted pool | `slow` | Nothing more happens to it. An hour bounds how long a page whose index is still catching up stays behind. |
| the same, from the network | `short`, 60 s | As the transaction and ledger pages shown from the node: the indexed version takes over. |
| `/{net}/amm/{pool}` behind a marker | `MARKER_PAGE_CLASS` (`slow`) | Older event rows are history, and history below the frontier can still be backfilled (the account page's ruling 1). |
| the pair redirect | `slow` to a live pool, `short` to a deleted one | Section 1.3. |
| canonical-query redirects, 404s | `short` | E2's and the foundation's rules. |
| degraded answers, 5xx | not stored | Foundation section 4 and the degraded mark. |

No new edge class and no new constant: the calls kept 60 s take E3's class `minute`, which matches the rebuild cadence of `amm_pools` and of the live volume sets. The keys of the calls shared with other pages are those pages' keys:
- `last_validated` kept 2 s: home, network;
- the 30-day `amm_volume`: network;
- `/v2/amm/pools/{pool}` and the create event: the og route.

---

## 5. SEO, link previews, links, navigation

### 5.1 Tags (`meta.ts`)

| Page | Tags |
|---|---|
| `/{net}/amm` | title "AMM pools · XRPL · explorer". Description "Automated market maker pools on the XRP Ledger: the value, reserves, trading fee and swap volume of every pool." It has no numbers: the page is stored for seconds. Canonical `/{net}/amm` on the request's origin; `og:title`, `og:description`, `og:url`, `og:type=website`, `og:site_name`; `twitter:card=summary`. No image. |
| `/{net}/amm` filtered, behind a marker, or with an asset error | title "AMM pools with RLUSD · XRPL · explorer" / "More AMM pools · XRPL · explorer"; `noindex, follow`; no canonical, no `og:*` (E2's rule for non-default views) |
| `/xahau/amm` | title "AMM pools · Xahau · explorer"; `noindex, follow` |
| `/{net}/amm/{pool}`, default period, any tab | title "XRP/RLUSD AMM pool · XRPL · explorer", with "· liquidity" or "· votes and bids" for those tabs, and "(deleted)" after "pool" for a deleted one. Description "XRP/RLUSD AMM pool on XRPL, account rhWTXC…tcS3: trading fee 0.300%, created 2024-03-22. Reserves, price, swaps, liquidity and votes."; a fact the page lacks is left out. Canonical `/{net}/amm/{pool}`, plus `?tab=` unless it is the first tab (as the account page). `og:*` with the image below, `twitter:card=summary_large_image`. |
| a non-default period | title "… · last 30 days" / "· last year"; `noindex, follow`; no canonical, no `og:*` |
| behind a marker | title "Older swaps of the XRP/RLUSD AMM pool · XRPL · explorer"; `noindex, follow`; no canonical, no `og:*` |
| from the network | as the default page, `noindex`: the page is a stand-in for 60 s |
| the 404s | `noindex`, as every 404 |

### 5.2 The Open Graph image: kind `amm`

`/og/{net}/amm/{pool}.png` joins the image route. `ImageKind` gains `amm`.

| Case | Answer |
|---|---|
| a query string | 302 to the bare path (existing rule) |
| switch off, `!hasAmm`, or `pool` not a classic address | 404, class `short`, no call |
| #1 answers a pool | the card. `kind` "AMM pool". `headline` the pair, "XRP / RLUSD" (text font). `parties` the pool account. `note` "Value 3.61M XRP · trading fee 0.300%" with the known parts, or "Deleted pool". `footer` "Created 22 Mar 2024" from #8, or "AMM pool on XRPL" without it. Class `slow` (1 h, `max-age=300`), like an account's image, because its value changes. If #8 failed: drawn without it, `short`. |
| #1 `pool not found` | 404, `short`. A pool younger than the aggregator's minute has no image for that minute. The node is not asked, so an image never costs a node call. |
| #1 fails | 503, not stored (existing rule) |

`poolCard` in `card-data.ts` builds it from the same facts as `ammPoolMeta`, so a link's text and its picture agree. `og.spec.ts` and `card.test.ts` cover it as the other kinds.

### 5.3 Links into and out of the pages

| From | To | Condition |
|---|---|---|
| Header "AMM" | `/{net}/amm`, current through `navSection: "amm"` (section 1.4) | the switch (section 1.4) |
| A `pool` segment of a sentence (`Sentence.tsx`) | `poolLink(net, pool, useFeatures())`: the pool page when on, else the account page | |
| A pool step of the flow (`Flow.tsx`) | its label ("XRP/RLUSD AMM pool") becomes a link to the pool page; the account link stays | on |
| An LP token on the account page's Tokens card | "AMM pool {issuer}" links to the pool page (the LP token's issuer is the pool) | on |
| The pool card of E3's pair page | `poolLink(net, pool, net.features)` in E3's view builder: "Pool page →" to the pool page when on, "Pool account →" to the account page when off. E3 builds the card with the account link; E5's plan moves it onto `poolLink` with the other inbound links. | |
| A pool account's account page (flag `amm`) | a line under the address: "This account is an AMM pool. See the pool →" | on, and the node answered (the flag comes from `account_info`) |
| Pool page: pool account, issuers, holders, voters, takers, providers | `/{net}/account/{address}` | |
| Pool page: times of rows, the Created date | `/{net}/tx/{hash}` | |
| Pool page: the state caption's ledger, Deleted's last ledger | `/{net}/ledger/{index}` | |
| List: a pair, the busiest pool; the list's rows | `/{net}/amm/{pool}` | |
| List: creation ledger, slot holder | ledger page, account page | |

The transaction page's "AMM pool" tag on balance changes stays text: the account beside it is the link. The LP token has no page of its own (the explorer has no token pages), so the pool page shows its code with a copy button.

### 5.4 The market link

The pool card's "Market →" and Xahau's "See Xahau markets →" lead to E3's pages, which exist when E5 is built. The hrefs are E3's, because the URL of a market is E3's to decide: `marketHref(net, first, second)` for the pool's pair in the natural orientation, so that the link needs no redirect, and `marketsHref(net)` for Xahau's markets. Both follow E3's `MARKETS` switch, `net.features.markets` in the view builders, which give the href or `null`: links while it is on, and the header's "soon" style, not links, while it is off.

### 5.5 Accessibility

- Statuses are icon and text: "Deleted", "Open", the notices, the frozen note. The tags of the tabs' Event and Kind columns are labels, not statuses.
- Targets are 44 px: the period links, tabs, pager, copy buttons, the form's button and checkbox label.
- Tables are `DataTable` (a focusable scroll region with its own name). The coins are `aria-hidden`.
- The Meter and the BarList follow the kit's rules: a text equivalent beside them, and bars that are `aria-hidden` in an `<ol>`.
- E6's `Countdown` renders "in 9 h" in the browser, and "expired" (its `past`) once the time has passed. Its server text is empty here, since the UTC time is beside it.
- The form has visible labels. Its error is tied to the field with `aria-describedby`, and the field gets `aria-invalid` when the asset does not parse.

---

## 6. Chart kit and component use

E5 grows the kit by nothing. It uses, as their owners define them:

- E4's `TimeSeriesData.extras` (the swap volume chart's "Swaps" and fee estimates);
- E2's `TimeSeriesData.forming` (the running bucket) and `SmallMultiplesData` (the reserves);
- E3's `BarList` item `href` (the fee votes' accounts);
- E6's `Countdown` (the auction slot).

One component prop is new:

| Addition | Exactly |
|---|---|
| `Pager`'s optional `labels: { newer: string; older: string }` | Default "Newer" / "Older"; the list passes "Previous" / "More pools". The `nav` keeps `aria-label="Pagination"`. |

Its component test checks the labels and the default.

---

## 7. Data interface

**Elements and their sources.** Fields are those of the reference at `feat/amm-data` `c3e2302`. Node fields are rippled's v1 `amm_info`.

| Element | Source (fields) |
|---|---|
| List: pools table | `/v2/amm/pools` (`amm_account`, `base_currency`, `base_issuer`, `counter_currency`, `counter_issuer`, `reserve_base`, `reserve_counter`, `trading_fee`, `auction_slot.holder`, `auction_slot.expiration`, `value_native`, `created_ledger`, `deleted`; `marker`) |
| List: tiles, Volume 24 h, "Open" | `/v2/network/amm_volume?live=day` (`total`, `count`, `end_time`, `components[].amm_account`, `.base`, `.counter`, `.count`, `.converted_amount`) |
| List: chart | `/v2/network/amm_volume?interval=day` (`start_time`, `total`, `count`) |
| Pool: header | `/v2/amm/pools/{pool}` (pair, `lp_currency`, `deleted`, `last_ledger`), else `amm_info` (`amount`/`amount2` assets, `lp_token.currency`); Created: `/liquidity?event=create&limit=1` (`executed_time`, `tx_hash`, `account`) |
| Pool: state | `amm_info` (`amount`, `amount2`, `lp_token.value`, `trading_fee`, `vote_slots` length, `asset_frozen`, `asset2_frozen`, `ledger_index`); Value of a non-native pool: `value_native` of `/v2/amm/pools/{pool}`; index fallback: `reserve_base`, `reserve_counter`, `lp_supply`, `trading_fee`, `last_ledger` |
| Pool: Swap volume, 24 h | `amm_volume?live=day` (this pool's component: `converted_amount`, `count`; `end_time`) |
| Pool: Fees earned, last day | `/history?interval=day&start=…&end=…` of the day `T − 1` (`fees_base_est`, `fees_counter_est`) |
| Pool: value, price, fee, reserves charts | `/history?interval=day` (`date`, `value_native`, `reserve_base`, `reserve_counter`, `trading_fee`), and the carry-in row |
| Pool: swap volume chart | `/v2/exchanges/{base}/{counter}?amm=only&interval=1day\|7day` (`start`, `base_volume`, `counter_volume`, `count`); fee extras from `/history` |
| Pool: auction slot | `amm_info.auction_slot` (`account`, `auth_accounts[].account`, `discounted_fee`, `expiration`, `price.value`, `time_interval`), `lp_token.value`, `trading_fee`; index fallback `auction_slot` of the pool |
| Pool: fee votes | `amm_info.vote_slots[]` (`account`, `trading_fee`, `vote_weight`), `amm_info.trading_fee` |
| Pool: Swaps | `/swaps?descending=true&limit=20` (`executed_time`, `tx_hash`, `node_index`, `base_amount`, `counter_amount`, `seller`, `taker`, pair keys; `marker`) |
| Pool: Liquidity | `/liquidity?descending=true&limit=20` (`executed_time`, `tx_hash`, `ledger_index`, `tx_index`, `event`, `mode`, `base_amount`, `counter_amount`, `lp_tokens`, `account`, `initiator`) |
| Pool: Votes and bids | `/governance?descending=true&limit=20` (`type`, `executed_time`, `tx_hash`, `account`, `fee_voted`, `trading_fee_after`, `price_paid`, `auction_slot.discounted_fee`, `auction_slot.auth_accounts`) |
| Pair route | `/v2/amm/pools/{base}/{counter}` (`amm_account`, `deleted`) |
| og card | `/v2/amm/pools/{pool}` (pair, `value_native`, `trading_fee`, `deleted`), create event |

**Why the node.** The live state (LP supply, trading fee, vote slots with weights, the slot's interval) is in the node's `amm_info`. The index carries it only when a transaction's metadata did (section Context). The AMM data design keeps live `amm_info` out of the data API, and the foundation already has the Worker read live state from the node. So the state card, the slot and the votes are the node's, and the index is their fallback.

**Missing, what E5 does meanwhile, and where it would come from**

| Missing | E5 meanwhile | Where it would come from |
|---|---|---|
| Fees earned in the last 24 h, network-wide and per pool | left out of the list; the pool shows its last complete day's estimate by asset | D2b, after the AMM merge: `fees_est`, converted like `converted_amount`, on each `amm_volume` component and row. The aggregator already resolves the fee in force per swap for `amm_daily`. |
| Telling a quiet day from a day the aggregator has not computed | a missing day is drawn as quiet, and the day-row charts say "A day without rows may not be computed yet."; production waits for the back-fill (section 10) | D2b, after the AMM merge: the `days` answer names the range of days computed |
| Live pool state | the node's `amm_info` | the node; no API change |
| Pool, token and issuer names | currency codes and addresses | out of scope (foundation non-goal) |

The board's other figures without data (the pool counts, the value locked, rankings by volume or fee, a pool's creation time, a swap's fee estimate, a filter by currency alone or by issuer) are dropped for now and have no planned source (Non-goals).

---

## 8. Testing

**Unit (Vitest, `unit` project)**

| File | Covers |
|---|---|
| `app/server/amm-view.test.ts` | The list: the join with the live set; "0" and "—" for a missing component; "Open" by `end_time`; tiles with no components; compact figures from strings. The pool: the display pair in E3's natural orientation for a ranked counter (XRP/RLUSD), the native counter of an unranked token (VOX/XRP), an issued-only pool (USDC/RLUSD), and each mapped from the stored order either way; pool price, swap price and value in exact arithmetic (a price below 1e-20, a price above 1e12, a zero reserve); fee percents; vote shares, "<1%" and sort; auction intervals 0, 13, 19, 20 and no slot; `nextBidPrice` for each branch and the recorded `AMMBid` check (section 3.4); swap direction from `seller`; liquidity signs and the clawback's initiator; governance sentences with parts missing. Every mode of section 3.3. `daySeries`: carry-in, creation inside the window, deletion inside it, quiet days, missing fields, weeks, the running day and week (`forming`), fee extras `null` and `"0"`, an earlier pool of the pair masked. Tokens stable and changed by any drawn value or extra. No float in any string. |
| `app/domain/amm-params.test.ts` | The canonical form of every list and pool query string (defaults, unknown values and parameters, repeats, order, `back` without `marker`, `period` with `marker`, `asset` with a lower-case standard code upper-cased). The hrefs. `poolLink` with `ammPages` true, false, and `NO_FEATURES`. |
| `app/server/meta.test.ts`, `card-data.test.ts` | The tags of section 5.1 and `poolCard` |
| `scripts/predeploy-check.test.ts` | E2's guard tests gain the name: a build with `AMM_PAGES` missing or misspelled is refused |
| `test/unit/pending-paths.test.ts` | The AMM paths are in `PENDING_PATHS` and absent from `api/openapi.yaml` |
| `test/unit/amm-bundle.test.ts` | The three routes' browser files import nothing from `app/server` at run time, nor `app/domain/describe` or `app/domain/parse` |
| `test/unit/amm-fixtures.test.ts` | The fixtures obey the reference (section 9), and what the generator finds in the `xrpl-amm` recordings matches what the data API's own e2e suite says they hold |

**Components (`components` project, happy-dom)**

- `AmmListPage.test.tsx`: every card state, the asset error, the empty filter, the "Deleted" tag, "Open", "0" and "—", the pager's labels, the Xahau page and its markets link with `MARKETS` on and "soon" with it off.
- `AmmPoolPage.test.tsx`: every mode of section 3.3 and every failure of section 3.6; the Market link with `MARKETS` on and "soon" with it off; the slot's `Countdown` (empty server text); tabs and period as links with `aria-current`; the Pager; the notices; the history page; the deleted banner.
- `Header.test.tsx` (or the existing `components.test.tsx`): AMM as "soon", as a link, and as current through `navSection: "amm"` (`aria-current="page"` on the list, `"true"` on a pool page).
- `Sentence`, `Flow` and E3's pool card: a pool link to the pool page when on, the account page when off or without the layout (`NO_FEATURES`).
- `AccountPage.test.tsx`: the LP token link and the pool-account line, on and off.
- `Pager`'s labels (section 6).

**Worker (`worker` project, through `pageClient`)**

| File | Checks |
|---|---|
| `test/worker/amm-list.spec.ts` | Classes: `live`; `live` behind a marker, `noindex`; Xahau `slow` with no call; asset error `short` with no pools call. The canonical redirects (302, `short`), a lower-case `?asset=usd.r…` among them. Exactly the calls of section 2.2 (`mock.requests`): the `minute` and 300 s keys, the 30-day `amm_volume` key equal to the network page's. Each card failure is a 200 with its `SectionError`, `no-store`, not stored. A refused marker is a 404. `amm_volume` overridden to the API's "Cannot GET" 404 fails the cards and logs. |
| `test/worker/amm-pool.spec.ts` | Validation without a call (bad address, X-address, Xahau with its offer). The canonical redirects. Exactly the calls of section 3.2, in each period (`1day` and `7day` candles, the carry-in's `end`). Every mode and class of section 3.3: `live`, `slow` deleted, `short` 60 s from the network, `MARKER_PAGE_CLASS` behind a marker, 404 with the account suggestion. A "Cannot GET" 404 on #1 is a 503 that is not stored. Every failure of section 3.6. The pair route: redirect classes, not found, invalid without a call. |
| `test/worker/amm-off.spec.ts` | In E2's `worker-off` project (every switch off, E2 §6.1): E5's `AMM_PAGES` case. Every AMM route and `/og/xrpl/amm/…` is a 404 without a call. The header says "soon". A transaction page's pool link goes to the account page. |
| `test/worker/data-api.spec.ts` | The new methods' classes, `ttl` keys and stored `max-age`. `pool not found` as `not_found` and "Cannot GET" as `server` (E2's rule) on the AMM paths. Malformed 200s not stored. |
| `test/worker/meta.spec.ts`, `og.spec.ts` | The tags of every AMM view; the `amm` image (validation without a call, classes, deleted, not found, a failed create event) |

The tests of `cacheGeneration` are E2's and those of the `amm_info` reader E3's; E5 adds none of either.

**End to end (Playwright)**

- `test/e2e/amm.spec.ts`:
  - "AMM" in the header leads to `/xrpl/amm` in one document, with `aria-current`.
  - The list: 20 rows, "More pools" (`noindex`, no canonical), then "Previous".
  - The asset form: `XRP`, `RLUSD.rMxCK…`, and an asset that does not parse.
  - "Include deleted pools" with the deleted pool's filter shows the "Deleted" tag.
  - A pool link leads to the featured pool. The state card holds the fixture's figures.
  - Tabs change `?tab=`. Older and Newer on Swaps. "1 year" sets `?period=1y`, draws weeks and adds `noindex`, and Back restores it.
  - The pair URL redirects to the pool.
  - The deleted pool shows its banner and no state card.
  - `/xahau/amm` and `/xahau/amm/{pool}` with its "Open it on XRPL".
  - A transaction with a recorded pool hop links to the pool page.
  - With JavaScript off (`contextFor`): the tabs, the period, the form and the Table radio work.
  - A pointer over the volume chart shows the tooltip with "Swaps", and Arrow Left on its slider changes `aria-valuetext`.
- `test/e2e/amm-live.spec.ts`, in the `live` project, because it changes the fixture server's answers: `history` overridden to 503 shows the charts' `SectionError`. Removing the override and pressing Retry brings them back.
- `og.spec.ts` gains the pool image. `client-meta.spec.ts` gains the pool page's tags after a client-side navigation, and their loss on a marker page.
- Where E2's `E2E_FEATURES_OFF` lists `AMM_PAGES`, `amm.spec.ts` skips the tests that need the pages and runs its off-case instead: the "soon" header and the 404s. Against a real stack (`E2E_DATA_API_URL` or `E2E_BASE_URL`), the tests that assert figures from the fixtures are skipped, as the account fixtures' are (`test/e2e/fixtures.ts`). The rest run.

**Accessibility.** `a11y.spec.ts`, axe with the WCAG 2.2 AA tags; the gate is no violation of impact serious or critical.

| Pages | Matrix |
|---|---|
| `/xrpl/amm`, `/xrpl/amm/{featured pool}` | 1280 px and 375 px × the four theme settings (light and dark by system; dark and light chosen by the toggle against the other system theme) |
| the list filtered, with deleted pools, behind a marker, with an asset error; the pool's Liquidity and Votes and bids tabs, `?period=1y`, behind a marker, every table view on, the slider focused with its tooltip; the deleted pool; `/xahau/amm`; the Xahau pool 404 | the two system themes |
| a pool page with a failed card (`amm-live.spec.ts`) | the two system themes |

`landmark-unique` and the ARIA "needs review" test cover the AMM pages too.

**Bundle.** `PAGES` in `scripts/bundle-budget.ts` gains `{ name: "amm", route: "routes/net.amm._index" }` and `{ name: "amm pool", route: "routes/net.amm.$pool" }`. `scripts/check-bundle.test.ts` follows. The gate stays 150,000 B. The pool page loads `ColumnChart`, `LineChart`, `SmallMultiples`, `BarList`, `Meter` and the cursor. Its target is E2's: 145,000 B or less. If the build says more, E2's decided fallback applies: `Cursor.tsx` and the tooltip are loaded with `import()` on the first `pointerenter` or `focusin` of a plot. The plan measures both pages and records the figures in the README.

---

## 9. Fixtures

The data API's `main` has no AMM routes, so the fixtures cannot be recorded from it. Recording them from the branch's own e2e suite was weighed and not chosen:
- Its seeds are 16 ledgers months apart, plus hand-made rows. Days and candles would be almost empty, and no list would fill a page.
- It needs Docker, ClickHouse and a checkout of a branch another session is finishing.
- The README's rule is that the generator shapes the API's answers from the reference and the recordings, which E2 follows for its aggregates.

So the AMM answers are **generated**, by `scripts/amm-fixtures.ts`, called from `make-http-fixtures.ts` and checked by `pnpm fixtures:check` and `scripts/http-fixtures.test.ts`. The provenance is documented.

| Files (XRPL) | Source | Kind in the README's table |
|---|---|---|
| `data-api/amm/pools/<POOL>.json` for every pool in the recorded XRPL ledgers. The list pages: `amm/pools@limit=20…`, each marker page, `@asset=XRP…`, `@asset=<RLUSD>+<issuer>…`, `@asset=<SNK>+<issuer>&include_deleted=true…`. The pair form of the featured pools. | **Derived** from the recordings with the reference's rules: the newest value of each field over the pool's nodes; `value_native` = 2 × the native reserve, as `amm-objects.ts` writes it at the pinned commit; no value for an issued-only pool (no rate in the recordings); `created_*` only for a creation in the recordings; `deleted` for the pool a withdrawal emptied. | generator (derived) |
| `data-api/amm/pools/<POOL>/swaps@descending=true&limit=20.json`, its marker page, `/liquidity…`, `/governance…`, `/liquidity@event=create&limit=1` | **Derived**. The swaps are E3's swap rows derived from the `xrpl-amm` recordings (`scripts/derived-trades.ts`: the pool's own changes, with `amm_account`), filtered to the pool. The liquidity and governance events are E5's own derivation, from the transactions and their `AMM` nodes. Real rows, split into two pages with a marker, as the account fixtures are, because the recordings hold fewer than 20 of a pool. | generator (derived) |
| `node/amm_info/<POOL>.json` for the featured live pools | **Derived** by E3's `amm_info` derivation (`scripts/amm-info-fixtures.ts`: the state the pool's newest recorded transaction left, served at the newest recorded ledger), under the `amm_account` subject. E5 adds its featured live pools to E3's `AMM_INFO_POOLS`; XRP/RLUSD's file is the same answer as E3's pair-form file. The deleted pool and ordinary accounts have no file and get `actNotFound`. | generator (derived) |
| `data-api/amm/pools/<POOL>/history@interval=day&…` for the three periods, the carry-in and the last day (#10); `data-api/exchanges/<BASE>/<COUNTER>@amm=only&interval=…` for the three periods; `data-api/network/amm_volume@live=day.json` | **Synthetic**, from E2's seeded generator (mulberry32, seeded per pool and endpoint). Days with no row (quiet days) are included. The DVR/XRP pool's days start on its recorded creation day, inside the 30-day window. The SNK/XRP pool's days end on its recorded deletion, inside the 1-year window. The running day and week have rows of the day so far. Fee estimates are input × fee, with one day without an estimate. The last day's closing state equals the derived state. The live set's components are the derived pools, sorted by `converted_amount`. | generator (synthetic) |
| `data-api/network/amm_volume@interval=day&…` (30 days) | E2's file, shared | generator (synthetic) |

**Featured pools**, all real accounts of the recordings, named in E3's natural orientation:

| Pool | Account | Role |
|---|---|---|
| XRP/RLUSD | `rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3` | swaps, deposits, withdrawals |
| USDC/RLUSD | `rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb` | issued only |
| VOX/XRP | `rhEypxvxNXMdMTd3GXpb6gTN1jvb4h3nef` | a vote |
| XRP/USD (Bitstamp) | `rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am` | a bid |
| DVR/XRP | `rUAEvY1XNvnkurE9RunV7u3yjh3jQsQPsG` | a creation |
| SNK/XRP | `rGLnUKdptCVobJKEkrwxtdyGZ98Evdmqdz` | deleted |

Xahau has no AMM fixture. Its AMM URLs never reach the fixture server.

**Rules the generator follows**, which `test/unit/amm-fixtures.test.ts` checks:
- the reference's key orders;
- amounts as strings;
- `trading_fee` and counts as numbers;
- `value_native` as a plain decimal of 8 significant digits;
- the API's stored pair order (E3's `canonicalPair`);
- liquidity signs from the pool's side;
- the 404 bodies (`pool not found`);
- one line per row, sorted keys, as the other files.

The test also checks that, over the 16 `xrpl-amm` ledgers alone, the generator finds what `apps/api/test/amm-pools.e2e-spec.ts` and `amm-events.e2e-spec.ts` say those ledgers hold at the pinned commit: 102 pools, one deleted, 148 states, 138 swaps, 8 liquidity events, one vote, one bid. That ties the derivation to the data API's own oracle without running its stack.

**Support.** E3 adds what the node fixtures need: both `amm_info` subjects in `SUBJECT_PARAMS` (`amm_account`, and the asset pair), and `actNotFound` as the node's missing-file answer for `amm_info`. The fixture server and `mockUpstream` already name a data API path segment by its decoded text, so a pair segment's `%2B` is read as `+`; `isSafePart` still refuses `%` and the other pieces in the decoded name. E5 adds no support change.

**Provenance.** `test/fixtures/PROVENANCE.md` gains a section, "AMM answers". It names the generator, the seeds, the recordings it reads (`ledgers/xrpl-amm/`, `ledgers/xrpl/`, `ledgers/xrpl-extra/`), and the `data-api-new` commit of `feat/amm-data` whose `docs/api-reference.md` and `amm-objects.ts` it follows. That is `c3e2302` when this spec was written; the plan pins the commit it reads, through `git show` and never a checkout. The README's "Upstream fixtures" table gains the rows above. The e2e suite against a real stack (section 10) is what catches drift from real answers.

---

## 10. Rollout

| Step | What ships | Behaviour |
|---|---|---|
| 1. E5, the last explorer sub-project (after E2, E3, E4 and E6) | Everything in this spec. `AMM_PAGES` is `"on"` at the top level (development, tests) and `"off"` in staging and production. While `feat/amm-data` is unmerged, the AMM paths are in `PENDING_PATHS` and the fixtures follow the branch's reference. | Staging and production are unchanged: the header says "soon", the AMM routes are 404, pool links go to account pages. The suites run the pages against the fixtures. |
| 2. `data-api-new`: `feat/amm-data` merged and deployed to its staging, the staging database re-ingested from the AMM enablement ledger (86795265, `range-ingest --reprocess`), and `amm_daily` back-filled | E2's `AMM_DATA` `"on"` for staging (E2's rule) | the AMM parts of the other pages appear on staging |
| 3. Explorer staging on | `AMM_PAGES: "on"` for staging (a commit), deploy | The staging checklist (below) is run, with the e2e suite against staging (`E2E_BASE_URL`, and `AMM_PAGES` no longer in `E2E_FEATURES_OFF`). |
| 4. `pnpm api:sync` from the merged `main` | `pending-paths.test.ts` fails. The AMM paths, and E2's `amm_volume`, move from `PENDING_PATHS` to `PATHS`. The commit names the source commit. | None |
| 5. `data-api-new` production deployed, re-ingested and back-filled, by the same operator checks | E2's `AMM_DATA` `"on"` for production | |
| 6. Explorer production on | `AMM_PAGES: "on"` for production (a commit), deploy | The pages, the header link and the pool links appear at once: the switch is in E2's cache generation, so no stored page shows the old state. |
| 7. D2b, after the AMM merge | the 24 h fee estimates and the range of computed days (section 7), in `data-api-new` | E5's follow-up: the list's fee figures and the end of the "may not be computed yet" note |

`AMM_PAGES` goes on in an environment only once `AMM_DATA` is on there. The market links (section 5.4) follow E3's `MARKETS` wherever it is set.

**Why production waits for the re-ingest and the back-fill.** Before the re-ingest, most pools lack their fee, LP supply and creation in the index, so the list's Fee and Created columns would be "—" for most pools (the branch's F2). Before the back-fill, most day rows are missing, and the day-row charts would show quiet days that were not: their note says a day may not be computed, but it cannot say which. The pool page's state card does not depend on either, because it is the node's.

**The staging checklist** (README) gains:
- the pool page's state against the node's `amm_info` for three pools: a native pool, an issued-only pool, and a pool with a slot holder;
- a pool's 90-day chart against its day rows and candles;
- the list's pages concatenating to the API's unpaged list, with no pool shown twice within a minute;
- a deleted pool's page;
- the pair redirect;
- `/og/xrpl/amm/{pool}.png`;
- the switch seen in the cache generation: `X-Cache: MISS` on the first request after the deploy;
- the bundle figures of both pages;
- `actNotFound` and `actMalformed` from the configured node (section 1.3).
