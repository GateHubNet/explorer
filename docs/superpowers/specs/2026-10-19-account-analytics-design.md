# Account analytics: design (E4)

Date: 2026-10-19. Status: proposed. Sub-project E4 of the explorer program. Repository: `GateHubNet/x-explorer`, branch `feat/explorer-pages`.

## Context

The foundation (`2026-10-17-explorer-foundation-design.md`, built; rulings in `../decisions/2026-10-18-explorer-foundation.md`) serves the account page at `/{net}/account/{address}` with the tabs Transactions, Payments, Trades, Offers and Objects. Analytics is a disabled tab that says "soon". The page's loader awaits the header (the data API's creation record and balances, the node's `account_info`, `account_objects` and `server_state`) and streams the active tab's list after it. A list that fails or takes more than 4.5 s is a section that says "Couldn't load …" with a Retry, and the answer is marked degraded and is not stored (README, "The account page").

E2 (`2026-10-19-network-dashboard-design.md`) adds the network dashboard and the **chart kit** (`app/ui/charts/`): server-rendered SVG and HTML charts with hover, keyboard access and a table view, the `period` URL parameter with one canonical URL per view, and the rule that a non-default view is `noindex, follow` with no canonical and no `og:*`. This spec uses the kit and those rules. It redesigns neither.

D2 in `data-api-new` (`docs/superpowers/specs/2026-10-19-account-market-aggregates-design.md`, on the worktree `.worktrees/explorer-data`, not merged) adds what the tab reads:

- the routes `/v2/accounts/{a}/analytics/balances`, `balance_changes`, `counterparties` and `exchanges`;
- `interval` (`day`, `week`, `month`) on `/v2/accounts/{a}/stats/{family}` and `reports`;
- the precomputed rates and heavy-account rollups that make every period answer in comparable time.

Its section 9 lists the six calls of the tab per period and the board text the explorer adjusts. The current reference (`data-api-new` `main`, `docs/api-reference.md`) has `stats/{family}` without `interval` and none of the `analytics/*` routes.

The approved board is `2026-10-17-explorer-mock/AccountAnalytics.dc.html`. Its sample data is placeholder.

**Build order and shared pieces.** The program is built in the order D1, D2, E2, E3, E4, E6, E5. E4 uses these pieces as their owners define them, and redefines none:

- E2's: the feature switches (E2 §6.1: one per-environment Worker variable each, `app/ui/features.ts`, `net.features`, `cacheGeneration(env)`, the pre-deploy guard), among them `AMM_DATA`; `typeGroups`, `groupCounts` and `typeGroupsNote` (§6.7); the kit's data shapes, `TimeSeriesData.forming` and `SmallMultiplesData` included (§2.3); `windowOf` and the running-bucket rule (§6.6); the failure hold; the route-missing rule of `data-api.ts` (§6.4).
- E3's: the cache class `minute`; `formatChange`; `naturalOrientation`, `QUOTE_RANK` and `marketHref` (`app/domain/market-pair.ts`); `useRetry()` in `app/ui/use-retry.ts`, which E3 moves out of `AccountPage.tsx` and which `AccountPage.tsx` and `AccountAnalytics.tsx` both import; its `MARKETS` switch.

E4 defines `TimeSeriesData.extras` for the kit (section 3.2), which E5 and E6 use.

## Decisions (from the owner)

| Topic | Decision |
|---|---|
| Scope | The Analytics tab of the account page is built in this round, as E4. |
| Data | `data-api-new` is extended (D2) so that every period works: 30 days, 90 days, 1 year and All. |
| Mock | The `AccountAnalytics` board is approved. Its sample data is placeholder. |
| Process | Auto-mode build after this spec and its plan are reviewed. |

## Owner decisions to confirm

The product choices of this spec and its departures from the approved board. Each is built as written unless the owner says otherwise.

| Choice | Why |
|---|---|
| The tab is off in staging and production (`ACCOUNT_ANALYTICS` `"off"`, the "soon" tab of today) until D2 is live there (sections 1.2, 8). | The routes do not exist before D2, and a switch costs no probe call on every account page. |
| Values in the native currency only; no `in=usd` (section 1.3). | D2 values in the native currency only. |
| D2 §9's board-text changes: captions that name the serving route, the "Where balance changes come from" Other row, the money footnote's "… escrow, channels and other transactions" (section 1.6). | They follow from the data. For the owner to confirm in D2, E3 and E4 alike. |
| The money footnote also says "Fees, and amounts that only passed through, are left out." (section 3.7). | Received and sent leave out the fee and pass-through rows. This clause is E4's, beyond D2 §9's text. |
| Period labels "30 days · 90 days · 1 year · All", not "30 D · 90 D · 1 Y · All". | E2's filter words; the accessible name is the visible text. |
| "Tokens at each day's DEX rate, and 0 without one", not "each week's / month's" rate. | D2 values each change at its day's rate and a level at its last day's rate; LP and unrated tokens count as 0. |
| "The axis starts at 12,000 XRP." (no sentence when it starts at 0), not "The axis does not start at zero."; the balance panels from zero (sections 3.4, 3.6). | E2's wording for a line with a domain; four panels are not magnified four different ways. |
| The period note gives exact dates: "The 30 days from Sep 18 to Oct 17, 2026 (UTC), per day. The last day is counted up to now." (section 2.2). | As E2's period note, and it says that the last bucket is still running. |
| Tooltip rows "12 total" and "1 failed", not "12 sent · 1 failed" (section 3.2). | The kit's rows: the total, then each of `extras`. |
| Pairs in E3's natural orientation ("XRP/USD"); Bought and Sold always of the displayed base, read from D2's `bought`/`sold` or, for a pair D2 stores the other way round, from `sold_counter`/`bought_counter` (section 3.10). | One orientation on every page; D2 serves both sides of each side, so every cell is an exact amount of the displayed base. |
| "Includes swaps against AMM pools." only while `AMM_DATA` is on; otherwise, on XRPL, the neutral hint "on the DEX" and no AMM sentence (section 3.10). | Between the AMM merge and the switch, the index holds some swaps and not others. |
| The value tile with two decimals, "16,787.15 XRP", not "16,787 XRP" (section 3.1). | `formatValue`, one rule for every value. |
| A deleted account: tile 1 reads "—" ("Deleted accounts hold nothing"), and the period note adds one sentence (section 1.4). | The board has no deleted-account state. |
| No Holdings margin: no Tokens or Owned objects card on this view (section 1.5). | None on the board; Balance history shows the main holdings, and the cards need the width. |
| The analytics views are `noindex, follow`, every link to them `rel="nofollow"`, and `robots.txt` disallows them (section 4). | Cost: a crawl is six uncached aggregate reads per account. This departs from "the default view of each page is indexable". |
| All starts at the month of the oldest indexed transaction when there is no creation record, not at 2013-01-01 (section 2.2). | The axis does not open on years of empty months. |
| A late counterparties call reads "Still working on the counterparties. Retry in a few seconds." and finishes in the background (section 2.6). | Its 15 s timeout cannot be awaited inside a 5 s stream. |
| Transactions sent on Xahau uses E2's groups (Payment, Invoke, ClaimReward, URIToken, SetHook, Other), not the board's (Payment, OfferCreate, ClaimReward, URIToken, Other) (section 3.1). | One `typeGroups` module: a group has one colour and slot on every page. |

## Goals

- `/{net}/account/{address}?tab=analytics` shows every tile, chart and table of the board from D2's answers, for the four periods, on both networks.
- The header arrives first, as on the other tabs. The analytics stream in after it, card by card. A slow or failing call costs its own card, never the page or the header.
- The data API sees about one set of analytics calls per account and period per minute per Cloudflare data centre, and no crawler traffic.
- The account page loads no more JavaScript first than it does today plus about 1 KB. The analytics view's total JavaScript stays within the foundation's 150,000 B.
- The tab ships switched off and is turned on by configuration once D2 is live, with no code change.

## Non-goals

- Values in another currency than the native one. D2 values in the native currency only (section 6).
- Custom date ranges, hourly buckets, a CSV of the analytics, an Open Graph image of the analytics.
- Live updates. The view does not poll; it is as fresh as its stored copy and its calls (section 2.4).
- Search indexing of the analytics views (section 4).
- Changes to the data API. D2 is specified and built in `data-api-new`.
- Token names and logos, the value of LP positions (D2 counts LP tokens and unrated tokens as 0).

---

## 1. The tab

### 1.1 Files

| File | |
|---|---|
| `app/domain/analytics-params.ts` | Pure; used by the loader and the links. The periods, `parseAnalyticsQuery(search)` (the period, or the canonical query to redirect to), `analyticsHref(net, address, period)`, the period phrases of section 3.1. |
| `app/server/analytics-view.ts` | The view builders, pure and unit-tested: `analyticsFrame` (the window), one builder per call (section 3), the tokens. |
| `app/server/analytics-load.ts` | Worker-only. `loadAnalytics(...)`: the calls, their deadline, the background completion and the degraded marks (section 2). The route calls it. |
| `app/server/analytics-shape.ts` | The checks of D2's answers, run inside the cached loads, as `tx-shape.ts` does. |
| `app/ui/pages/AccountAnalytics.tsx` | The tiles and the seven cards. Loaded with `React.lazy` (section 5). Never fetches. |
| `app/ui/pages/AnalyticsFilters.tsx` | The filter row under the tabs. Static (section 5). |
| `scripts/analytics-fixtures.ts` | The synthetic analytics fixtures (section 7.5), called from `make-http-fixtures.ts`. |

Changes elsewhere:

- `app/domain/account-tabs.ts`: `analytics` joins `ACCOUNT_TABS`; it is not in `PAGED_TABS`.
- `app/server/account-view.ts`:
  - `accountHeader(input, { holdings })` (section 2.1);
  - `AccountPageData` becomes a union on `tab` (section 1.5) and gains `analyticsTab` (section 1.2);
  - `TAB_WHAT` gains `analytics: "the analytics"`.
- The route `net.account.$address.tsx`: the analytics branch, the canonical redirect, the switch.
- `AccountPage.tsx`: the view's layout and the lazy body; the tab bar reads the switch (section 1.2).
- `Tabs.tsx`: `TabItem` gains `rel` and `onIntent`.
- `SectionError.tsx`: gains `message`.
- `data-api.ts` and `api-types.ts`: six calls; `timeoutMs` and the cache options on `get`.
- `edge-cache.ts`: `shareInFlight` (section 2.7).
- `upstream.ts`: `ANALYTICS_SLOW_TIMEOUT_MS`.
- `app/ui/features.ts`, `env.ts` and `wrangler.jsonc`: `ACCOUNT_ANALYTICS` joins E2's list of switches (`FEATURE_VARS`, `accountAnalytics` in `Features`), with its `Env` field, its entries in every environment block and its tests (section 1.2).
- `meta.ts`: the analytics branch of `accountMeta`.
- `robots[.]txt.ts`.
- `format.ts`: `formatValue`.
- The kit's growth (section 3.2).
- `scripts/bundle-budget.ts`.
- The fixture generator.
- The README: a new section "Account analytics" under "The account page", the "Upstream fixtures" rows (section 7.5) and the staging checklist (section 8).

The class `minute`, `formatChange`, `marketHref`, `naturalOrientation` and `useRetry` are E3's, and the switch mechanism, `typeGroups`, `forming` and `SmallMultiplesData` are E2's. They exist when E4 is built.

### 1.2 Turning it on

`ACCOUNT_ANALYTICS` is one of E2's feature switches, `"on"` or `"off"` per environment in `wrangler.jsonc`, with E2's mechanism as it is:

- The top level (local development and every test suite) is `"on"`.
- `staging` and `production` are `"off"` until D2 is live there (section 8).
- E2's pre-deploy guard knows the name and refuses a build whose value is neither `"on"` nor `"off"`, so a typo cannot hide or show the tab by accident.
- The loader reads `net.features.accountAnalytics` (E2's `requireNetwork`). As E2's rule for a switch's links says, the tab bar's state comes from the page data: every account page's data carries `analyticsTab: boolean`, set from it, so the stored HTML, the server's tab bar and the browser's agree.
- Its value is part of E2's `cacheGeneration(env)`, so a page stored under one value is never served under the other. E4 adds no cache key of its own.

| `ACCOUNT_ANALYTICS` | Tab bar | `?tab=analytics…` |
|---|---|---|
| `"on"` | Analytics is a link, `rel="nofollow"` | the analytics view |
| `"off"` | Analytics is the disabled "soon" tab, as today | 302 to `/{net}/account/{address}`, class `short`, as an unknown tab is today |

A variable rather than a constant, because the end-to-end suite runs the built Worker and must see the tab while production does not. A change of the variable is a deploy. Because the switch is in the cache generation, the first request after that deploy renders afresh, and no stored page keeps the old tab bar.

### 1.3 URL and parameters

| Parameter | Values | Default |
|---|---|---|
| `tab` | `analytics` | |
| `period` | `30d`, `90d`, `1y`, `all` | `30d` |

| Period | Bucket | Window (T is the index day, section 2.2) |
|---|---|---|
| `30d` | UTC day | T−29 … T: 30 days, today included |
| `90d` | UTC day | T−89 … T |
| `1y` | week from Monday 00:00 UTC | the Monday 51 weeks before the Monday of T's week, to T's week: 52 weeks, this week included |
| `all` | calendar month, UTC | the month of the account's activation to the month of T (section 2.2) |

These are D2 section 9's windows, the board's, and those of every time-series chart of the program, E2's included: the last bucket is the one still running, and every chart marks it "so far" (section 3.2, `forming`). The first tile is the account's value *now*, and an account's own day is wanted while it happens.

**No currency parameter.** Values are in the network's native currency, because D2 values in it only. E2's `in=usd` is not a parameter of this view.

**One URL per view.** The canonical query of the analytics view is `tab=analytics`, then `period` when it is not the default. When the query string is anything else, the loader answers a 302 to the canonical URL, before any call (`cacheClassHeaders("short")`). That covers `period=30d`, an unknown period, repeats, the other order, `marker`, `back`, `tag`, `in` and unknown parameters. This is E2's rule, for E2's reason: the cost of a render. A `marker` on the Analytics tab was already tidied away, as on Offers and Objects. `tag` is dropped because the tab links never carry it: it arrives from an X-address on the first tab only.

The period selector is links (`analyticsHref`), so it works before the script runs. With the script loaded, a selection is a client-side navigation with `preventScrollReset`.

### 1.4 Which accounts and pages

| Account or page | Analytics |
|---|---|
| active | the view |
| the node did not answer (`unverified`) | the view; the header says "Live state unavailable", as today; the answer is not stored |
| deleted | The view. Its first tile reads "—" ("Deleted accounts hold nothing"), and the period note adds "This account was deleted; All covers its whole history." D2's answers hold its history up to the deletion and zeros after it. |
| active, not in the index yet (the node has it; the index has no creation record and no transaction of it) | The view. All is T's month alone, and every card is empty. |
| never activated | the 404 "This address has never been activated", as today, before any card is drawn |
| a page with a `marker` | none: `?tab=analytics&marker=…` is the 302 of section 1.3 |
| history mode (another tab behind a marker) | none; its tab bar's Analytics link leads to the analytics view, which is live mode |

### 1.5 Layout and page data

From the top, as on the board. A phone has the same order in one column.

| Element | Content |
|---|---|
| Notices | The destination-tag note, "Deleted" and "Live state unavailable" with Retry, as on the other tabs |
| Breadcrumbs, `AccountCard` | as on the other tabs (section 2.1) |
| Activity card | The tabs (Analytics current). Under them the filter row, `role="group" aria-label="Analytics filters"`. "Period", then E2's segmented links "30 days", "90 days", "1 year", "All", the current one `aria-current="true"`, 32 px to look at and 44 px to hit. Then the values note, "Values in XRP: tokens at each day's DEX rate, and 0 without one" (XAH on Xahau). Then the period note (section 2.2), which streams. |
| Summary (`section aria-label="Summary"`) | four tiles, `repeat(auto-fit, minmax(min(220px, 100%), 1fr))` |
| Account value · Transactions sent | two cards, `flex: 1 1 480px` |
| Balance history | full width |
| Money in and out | full width |
| Where balance changes come from | full width; its table is 900 px at least and scrolls inside its card below that |
| Top counterparties · DEX trading | two cards, `flex: 1 1 460px` |

The board has no Holdings margin on this view, and neither does the page: no Tokens card and no Owned objects card. The Balance history card shows the main holdings, and the cards need the width.

`AccountPageData` becomes a union on `tab`. The five list tabs keep `list`. `tab: "analytics"` has `mode: "live"` and `analytics: AnalyticsData` instead:

```ts
type AnalyticsPeriod = "30d" | "90d" | "1y" | "all";
type CardState<T> = ({ state: "ok" } & T) | { state: "failed" } | { state: "late" };
interface AnalyticsData {
  period: AnalyticsPeriod;                       // from the URL
  frame: Promise<AnalyticsFrame>;                // the window and the period note; settles first
  value: Promise<CardState<ValueCard>>;          // tile 1, Account value
  sent: Promise<CardState<SentCard>>;            // tile 2, Transactions sent
  changes: Promise<CardState<ChangesCard>>;      // tile 3, Money in and out, Where balance changes come from
  counterparties: Promise<CardState<CounterpartiesCard>>;  // tile 4, Top counterparties
  balances: Promise<CardState<BalancesCard>>;    // Balance history
  pairs: Promise<CardState<PairsCard>>;          // DEX trading
}
```

Each promise never rejects, as the list's does. The page draws the frame first. A failed or late frame is one `SectionError` for the whole view (section 2.8), and then the card promises are not read.

### 1.6 Deviations from the board

"To confirm" rows are in "Owner decisions to confirm" at the top.

| Board | Here | Why | Status |
|---|---|---|---|
| Source captions name `stats/transactions` (fees), `reports` (counterparties, money), `balance_changes` (balance history), `/exchanges` (DEX) | each caption names the route that serves the element (section 6) | D2 section 9 | to confirm (D2 §9) |
| "Where balance changes come from" has no Other row | an Other row, shown when the period has unclassified changes | D2 section 9 | to confirm (D2 §9) |
| Money footnote "Payments, DEX trades, escrow and channels that changed …" | "… escrow, channels and other transactions …; fees, and amounts that only passed through, are left out." | D2 section 9; received and sent also leave the fee rows out (section 3.7) | to confirm (D2 §9); the fee clause is this spec's |
| Tab counts | none | foundation non-goal (no totals) | foundation |
| "30 D · 90 D · 1 Y · All" | "30 days · 90 days · 1 year · All" | E2's filter words; the accessible name is the visible text | to confirm |
| "tokens converted at each week's / month's DEX rate" | "each day's", and "0 without one" | D2 values each change at its day's rate and a level at its last day's rate; unrated tokens are 0 | to confirm |
| "The axis does not start at zero." | "The axis starts at 12,000 XRP.", or no sentence when it starts at 0 | E2's wording for a line with a domain; an account whose value starts at 0 has an axis from 0 | to confirm |
| Balance panels fitted to their data | from zero | E2's rule for a line without a domain; four panels are not magnified four different ways | to confirm |
| "Showing the last 30 days, per day" | "The 30 days from Sep 18 to Oct 17, 2026 (UTC), per day. The last day is counted up to now." | exact dates, as E2's period note | to confirm |
| Tooltip "12 sent · 1 failed" | "12 total", "1 failed" | the kit's tooltip rows (section 3.2, `extras`) | to confirm |
| Chart/Table as `aria-pressed` buttons | the kit's radios | E2 section 2.5 | E2 |
| Pair "XRP/USD", bought and sold as plain amounts | the same pair, in E3's natural orientation; Bought and Sold of the displayed base, from D2's base or counter sums (section 3.10) | one orientation on every page | to confirm |
| "Includes swaps against AMM pools" on XRPL, always | only while `AMM_DATA` is on (section 3.10) | not true before the AMM data is complete | to confirm |
| Tile "16,787 XRP" | "16,787.15 XRP" | `formatValue` (section 3.1) | to confirm |
| no deleted-account state | tile 1 "—", one sentence in the period note | section 1.4 | to confirm |
| Holdings margin | none | none on the board either | board; to confirm |
| Xahau's legend Payment, OfferCreate, ClaimReward, URIToken, Other | E2's `typeGroups`: Payment, Invoke, ClaimReward, URIToken, SetHook, Other (section 3.1) | one module: a group has one colour on every page | to confirm |

---

## 2. Loading

### 2.1 The header

The analytics view reuses the header of the other tabs:

- the notices (tag, Deleted, Live state unavailable);
- the breadcrumbs;
- `AccountCard`: identicon, address, copy, QR; activation and domain; flags, sequence, last active; the balance with available and reserve.

It does not show the Tokens and Owned objects cards. So the loader does not ask `/v2/accounts/{a}/balances` or `account_objects`.

`accountHeader(input, { holdings: false })` takes no `objects` and no `balances`: `owned` is `null`, `tokens` is `none`, and neither adds a problem. The reserve comes from `account_info`'s `OwnerCount` and `server_state` as before. Without `balances`, an account whose node did not answer shows "The balance could not be read." instead of the index's native balance. The "Live state unavailable" notice already says why.

`existenceOf` and its one-row history probe are unchanged.

### 2.2 The window

`T` is the UTC day of `last_validated`'s `close_time`, as in E2: the window follows the index, and the tests get fixed query strings from the recorded `last_validated`. `S` is the window's first day:

| Period | `S` | `interval` |
|---|---|---|
| `30d` | T − 29 days | `day` |
| `90d` | T − 89 days | `day` |
| `1y` | the Monday of T's week − 51 weeks | `week` |
| `all` | The first of the month of the account's `inception` (`/v2/accounts/{a}`, the header's call). Without a creation record, the first of the month of the account's oldest transaction in the index: `/v2/accounts/{a}/transactions?limit=1`, which is oldest first and is the existence probe's own call and key. Without either, the first of T's month. Never after T's month. | `month` |

For `30d`, `90d` and `1y`, `analyticsFrame` takes the buckets from E2's `windowOf` (`app/domain/window.ts`, E2 §6.6), which follows the same rule for every chart; All adds the months by the same rule. `T` is E2's `utcDayOf(anchor.closeTime)`.

`end` is left out, as D2 section 9 says: the API's now. `stats/{family}` treats `end` as an exclusive instant and the analytics routes as a whole day, and both forms include the running bucket. The same `S` and `interval` go to every call.

The view builder aligns every answer to the frame's buckets (`YYYY-MM-DD`, oldest first) by date. A row outside them is ignored: an index that is behind can make the API's now a day after `T`.

`All` uses the latest creation: an account deleted and funded again shows its current life.

**The period note** (the frame's `note`):

| Period | Note |
|---|---|
| `30d`, `90d` | "The 30 days from Sep 18 to Oct 17, 2026 (UTC), per day." |
| `1y` | "The 52 weeks from Oct 20, 2025 to the week of Oct 12, 2026 (UTC, weeks from Monday), per week." |
| `all` | "Since Jul 2025, the month it was activated, per month (UTC)." With the oldest transaction instead: "…, the month of its oldest transaction in the index, …". With neither: "This month (UTC): the index has no transaction of this account yet." |

Then the note adds:

- always: "The last day | week | month is counted up to now.";
- for a deleted account: section 1.4's sentence;
- for `all` with fewer than 3 buckets: "It is younger than three months; 30 days and 90 days show it per day."

With the recorded XRPL fixtures (`last_validated` 2026-10-17T17:01:12Z), `S` is 2026-09-18 (30d), 2026-07-20 (90d) and 2025-10-20 (1y). For All it is 2025-07-01, from the active account's invented inception, 2025-07-15.

### 2.3 The calls

| # | Call | Query | Subrequest class, kept | Timeout | Shared with | Feeds |
|---|---|---|---|---|---|---|
| 0 | `/v2/last_validated` | | `live` (5 s) | 5 s | the ledger page, the image route (same key) | T: the frame |
| A | `/v2/accounts/{a}` | | `slow` (1 h) | 5 s | the header (one promise) | the header; All's `S` |
| P | `/v2/accounts/{a}/transactions` | `limit=1` | `live` (5 s) | 5 s | the existence probe (one promise, same key) | All's `S` when A has no creation record |
| 1 | `/v2/accounts/{a}/stats/value` | `interval={u}&limit=1000&start={S}` | `minute` (60 s) | 5 s | | tile 1, Account value |
| 2 | `/v2/accounts/{a}/stats/transactions` | `interval={u}&limit=1000&start={S}` | `minute` (60 s) | 5 s | | tile 2, Transactions sent |
| 3 | `/v2/accounts/{a}/analytics/balance_changes` | `interval={u}&start={S}` | `minute` (60 s) | 5 s | | tile 3, Money in and out, Where balance changes come from |
| 4 | `/v2/accounts/{a}/analytics/counterparties` | `limit=6&start={S}` | `minute` (60 s) | **15 s** | | tile 4, Top counterparties |
| 5 | `/v2/accounts/{a}/analytics/balances` | `interval={u}&limit=4&start={S}` | `minute` (60 s) | 5 s | | Balance history |
| 6 | `/v2/accounts/{a}/analytics/exchanges` | `limit=6&start={S}` | `minute` (60 s) | 5 s | | DEX trading |

The wording of the DEX hint and note needs no call: it follows E2's `AMM_DATA` switch (section 3.10).

The header's other calls are as today: the node's `account_info` and `server_state`, and the data API's ledger of the account's last transaction (for its close time, with its own 1.5 s deadline).

`limit=1000` on 1 and 2 keeps every period on one page. The most buckets a window has is All since 2013, about 170 months. An answer with a `marker` is rejected as malformed (section 2.8). `limit=6` on 4 and 6 is the board's six rows. `limit=4` on 5 is D2's four panels.

**Order.** Calls 0, A and the header's node calls start together. Calls 1 to 6 start as soon as the frame is known: call 0's answer, and for `all` also A's (and P's when it is needed). They do not wait for the header. A page that turns out to be a 404 or a 503 abandons them: an abort signal stops their deadlines, and nothing is handed to `waitUntil`.

**New client methods** (`data-api.ts`, with types in `api-types.ts`, hand-written from the built `docs/api-reference.md` of `feat/explorer-data` at the commit the plan pins, which documents D2 sections 5 and 6.1 as built; section 7.5):

- `accountStats(address, family, q)`;
- `analyticsBalances`, `analyticsBalanceChanges`, `analyticsCounterparties`, `analyticsExchanges`.

`get` gains:

- `timeoutMs`, `DATA_API_TIMEOUT_MS` unless given;
- the cache options `holdFailure` (E2's) and `shareInFlight` (section 2.7).

The four `analytics/*` paths are not in `api/openapi.yaml` yet, so they join E2's `PENDING_PATHS`. `stats/{family}` is there already.

### 2.4 Caching

**The page is `live`** (5 s fresh, 30 s stale while one render refreshes it). That is the class of every account first page, and the header is live state: the balance, the flags and the last activity. A stored analytics view is at most 35 s old in its header and, with its calls, about 95 s old in its analytics.

**The analytics calls take the class `minute`**: kept 60 s in the subrequest cache. It is the class D2 section 9 asks for, which E3 adds to `cache-class.ts` for the markets page and its subrequests (E3 section 2.5). The reasons:

- The running bucket and the "now" figures move with every transaction of the account. Kept for minutes, they would contradict the header beside them, which is seconds old.
- 60 s is the API's own freshness for these answers (`Cache-Control: private, max-age=60`).
- They are the API's heaviest account reads: 20–100 ms for a typical account, up to 1 s for an issuer's balances, 2–10 s for the counterparties of the heaviest accounts at 1 Y and All (D2 section 13). `live` (5 s) would ask for them twelve times as often.
- Not `slow` (an hour): the "now" figures would be an hour old.
- The page itself does not take `minute`. Its header is live state, and every account first page is `live`.

Upstream cost per data centre: about one set of calls 1 to 6 per account and period per 60 s. Concurrent misses in one Worker instance share one call (section 2.7); misses in different instances can each make one. The render that refreshes a stored page finds the calls warm.

### 2.5 Streaming and deadlines

The view streams as the lists do. The loader awaits the header (and the existence check), and returns the frame and the six cards as promises inside the page data. The HTML holds the header first. Then come the card frames with their placeholders, as soon as the window is known (call 0, kept 5 s, is the fastest call of the page). Then each card replaces its placeholder when its call settles. Bots get the whole document (`allReady`, as today).

| Limit | Value | Where | What it bounds |
|---|---|---|---|
| `streamTimeout` | 5,000 ms | `entry.server.tsx` | Deferred data must settle within 5 s of the render; the render's own abort is at 6,000 ms. **Unchanged.** |
| `LIST_DEADLINE_MS` | 4,500 ms | the account route | The list's deadline today, from the loader's start. Now also the frame's and every analytics card's. |
| `DATA_API_TIMEOUT_MS` | 5,000 ms | `upstream.ts` | every data API call, analytics included, except call 4 |
| `ANALYTICS_SLOW_TIMEOUT_MS` (new) | 15,000 ms | `upstream.ts` | call 4, `analytics/counterparties` (D2 sections 9 and 13) |
| `SINGLE_FLIGHT_WAIT_MS` | 15,000 ms | `edge-cache.ts` | page waiters; unchanged |
| `waitUntil` | 30 s after the response | the Workers runtime | the background completion below |

Each card's promise is its call, its view builder and a race against one deadline: the loader's start + 4,500 ms (`within`, as the list). A card that has not settled by the deadline resolves as `late`. If its call is still running, the loader hands it to `ctx.waitUntil`. The call finishes in the background, within its own timeout, and the subrequest cache stores its answer for 60 s. A frame that is late does the same with its chain: once call 0 answers, calls 1 to 6 start in the background and warm the cache.

### 2.6 The 15 s call

D2 asks for a 15 s subrequest timeout on `analytics/counterparties`. It cannot be awaited inside the page:

- `streamTimeout` (5 s) settles every deferred promise first.
- Raising `streamTimeout` above 15 s was rejected:
  - every streamed answer of the site (the account lists too) could hold its connection that long;
  - the edge cannot store or share a page until its stream ends;
  - single-flight waiters give up at 15 s and render for themselves, a herd onto exactly the slow call;
  - bots wait for `allReady`, so crawlers and link unfurlers would wait 15 s.
- Raising the 4.5 s deadline for this card alone was rejected: the stream still ends at 5 s.

**Decision.**

- The client's timeout for call 4 is 15,000 ms.
- The page waits for it until the deadline, like every card.
- A late counterparties call goes on under `waitUntil`. It ends at most 25 s after the request started, inside the 30 s the runtime gives `waitUntil` after the response (which ends by about 5 s):
  - call 0 and A take at most 5 s, side by side;
  - P takes at most 5 s more, for All without a creation record;
  - then call 4 takes at most 15 s.
- Its answer is kept 60 s.
- The card and tile 4 say "Still working on the counterparties. Retry in a few seconds." A Retry a few seconds later finds the answer in the cache, or joins the call that is still running (section 2.7).
- Every other call keeps 5 s: D2 expects them under 1 s for every account.

### 2.7 In-flight sharing and the failure hold

A degraded answer is never stored and never shared by the page's single flight. So while a popular heavy account's counterparties take 10 s, every visitor's render would start its own 10 s query.

`createSubrequestCache().json` therefore gains `{ shareInFlight: true }`. While one request's load of a key runs, a load of the same key by another request in the same Worker instance waits for it, and is given the same value or the same error. It does not start a second fetch. A waiter still races its own page's deadline.

The flight:

- is removed when it settles;
- is per Worker instance and in memory;
- is built on the mechanism of the page flights (`flights` in `edge-cache.ts`), which hands plain data across requests in workerd.

Calls 1 to 6 opt in. The view does not poll, so E2 §6.8 does not ask it for the failure hold; calls 1 to 6 opt in to E2's `holdFailure` anyway, for the cost of a failing heavy read: a `server`, `timeout`, `network` or `rate_limited` failure is held for 5 s (or a 429's `Retry-After`, at most 30 s), so a failing route is called once per 5 s per instance, not once per render. A Retry within the hold gets the held failure. The next Retry after it calls again.

### 2.8 Failures and degraded answers

| Case | Answer | Stored |
|---|---|---|
| `ACCOUNT_ANALYTICS` is `"off"` | 302 to the account page (section 1.2) | `short` |
| a query string that is not canonical | 302 to the canonical URL (section 1.3) | `short` |
| never activated | the 404 of today | `short` |
| the index fails on the account, or the account cannot be told from one that does not exist | the 503 of today (`upstreamOutage`) | no |
| the node did not answer | the header says "Live state unavailable"; the analytics as usual | no (degraded, as today) |
| call 0 failed, or, for `all`, P failed | One `SectionError` in place of the tiles and cards: "Couldn't load the analytics." with Retry. The period note is left out. | no (degraded) |
| the frame is late | the same place: "Still working on the analytics. Retry in a few seconds." (`SectionError` with `message`); the calls go on in the background | no (degraded) |
| a call failed: 5xx, 429, a timeout, a network error, a 400, a 404, or a malformed 200 | Its tiles show "—" over "Couldn't load". Its cards show `SectionError`, "Couldn't load the account value." (the card's `what`, section 3), with Retry, in place of the views and the toggle. | no (degraded) |
| a call is late | its tiles "—" over "Still working on it"; its cards "Still working on {what}. Retry in a few seconds." with Retry | no (degraded) |
| everything settled | the view | `live` |

**A 404 of an analytics route.** E2's route-missing rule (`data-api.ts`) applies as it is: a 404 whose body is the server's "Cannot GET …" is kind `server`, an outage, held by the failure hold and never stored. So an API without D2 fails the cards. D2 answers an unknown address with empty answers, so these routes have no not-found of their own, and a `not_found` from one of them fails its card too. Every failed or late card is logged (`logProblem`) and marks the request degraded (`markDegraded(context, "analytics {card} …")`).

**What is checked** (`analytics-shape.ts`, inside each cached load, so a wrong 200 is an `UpstreamError` of kind `server` and is not kept):

- lists are lists;
- dates are `YYYY-MM-DDT00:00:00Z` on a start of the interval asked for: a Monday for `week`, the first of a month for `month`. An API without D2 ignores `interval` and would answer days.
- the answer's `interval` is the one asked for, where the route echoes it;
- amounts and values are decimal strings, and counts are whole numbers;
- an account is a valid classic address, because it goes into a link;
- a currency is 3 characters or 40 hex digits;
- `stats/{family}` has no `marker`.

**Retry** is E3's `useRetry()` (`app/ui/use-retry.ts`: `useRevalidator().revalidate()`, the explorer's own `.data` URL), as on the account page. A degraded answer was not stored, so it reaches a fresh render. The calls that loaded are warm for 60 s, and only the failed or late one is asked again.

---

## 3. The elements

### 3.1 Numbers, dates and words

View builders take D2's exact decimal strings. Every sum, difference, quotient and drop count is computed with `bignumber.js` in the view builder and handed on as a string. The kit parses strings with `Number()` for geometry and nothing else (E2 section 2.3). No floating-point result reaches a label.

| What | Shown |
|---|---|
| Amounts: balances, bought, sold, the fee tile | `formatAmount`, every digit the API gave, with `formatCurrency` |
| Values (estimates in the native currency): account value, in, out, net, sent, received, native volume | In tiles and table cells, `formatValue(value, { signed? })`, new in `format.ts`: half up to 2 decimals at or above 1, to 6 decimals below 1, trailing zeros dropped, grouped, U+2212 for a minus, "+" with `signed`, "0" for zero, "<0.000001" for a non-zero value below a drop. In tooltips, ticks and the money summary, E2's `compactNumber` and the unit ("45.2K XRP"). |
| Drops | `out_value` shifted by 6 places, a whole number, grouped |
| Counts | `String(n)`, grouped |
| Percent | Exact quotients, half up. Tile 1 to 1 decimal ("+4.2%", E2's delta). The account value table's change to 2 ("+0.42%"): E3's `formatChange` (`format.ts`) and "%". "—" where the base is 0 or missing. |
| Dates | E2's `bucketLabel`, plus months: "Oct 2026" (section 3.2) |

Value and amount strings are never rounded in the data, only by `formatValue` at display. Amounts are never rounded at all.

**Period phrases** (`analytics-params.ts`):

| Period | In card titles and tile 1 | In empty states | In `<title>` (section 4) |
|---|---|---|---|
| `30d` | "last 30 days" | "these 30 days" | none (the default) |
| `90d` | "last 90 days" | "these 90 days" | "last 90 days" |
| `1y` | "last 52 weeks" | "these 52 weeks" | "last 52 weeks" |
| `all` | "since Jul 2025" (the frame's first month) | "its whole history" | "all time" |

`meta` reads only the loader's awaited data, not the streamed frame, so the `<title>` of All cannot name its first month.

**Type groups** of Transactions sent are E2's `typeGroups(network)`, imported from E2's module and never copied, so that a group has the same slot and colour on every page and in every period. On Xahau they replace the board's legend (Owner decisions to confirm).

### 3.2 Kit growth

E2 says the kit's props may grow and its files are not forked. This view needs the following. None changes a mark spec, and each comes with its component tests. The running bucket's mark is E2's `TimeSeriesData.forming: boolean` (E2 §2.3), used as it is: "Oct 17, 2026, so far" in the tooltip, the slider and the table. E4 never sets E2's `pending: number`: D2's routes serve the running bucket as it stands, so no bucket of the frame is uncomputed.

| Growth | Where | For |
|---|---|---|
| `ValueKind` `"value"` | `types.ts`, `labels.ts`, `ChartTable` | An estimate in the native currency: table cells by `formatValue`, tooltips by `compactNumber`. |
| `TimeAxis.unit` `"month"` | `types.ts`, `labels.ts`, `geometry.ts` | All. Buckets are `YYYY-MM-01`; the label is "Oct 2026" on the axis, in tooltips and in tables; the table header reads "Month (UTC)". |
| `TimeSeriesData.extras?: { id: string; label: string; values: (string \| null)[]; format?: ValueFormat }[]` | `types.ts`, `labels.ts`, `Cursor`, `ChartTable` | **The kit's one field for per-bucket figures that are never drawn.** E4 defines it; E5 and E6 use it as it is. It is valid on every form that takes `TimeSeriesData` (`ColumnChart` in each layout, `LineChart` in each curve and axis unit, `flag` included). The tooltip lists the extras after the series (and the total), in the series rows' form without a key: the value strong, the label in `--muted` ("**1** failed"). The slider's `aria-valuetext` reads them after the series, as it reads a series ("Oct 16, 2026: 12 total; …; Failed 1"). `ChartTable` gives each a column after the series and the total. A value goes through `format` when the extra has one (the kit's value text in the tooltip and the slider, the full text in the table); without `format` it is shown as given. `null` is "—", read "no data". Extras take no part in scales, the legend or the plot summary, and the data's `token` covers them. E4 uses three, all text made by the view builder: failed, net and change. |
| `TimeSeriesData.emptyText?` | `ChartCard` | the words of the empty state ("No transactions sent in these 30 days") |
| `ChartCard` `state="loading"` | `ChartCard` | A streamed card before its data. The title and source show; the plot's height is filled with "Loading…" in `--muted`, `aria-hidden`; the toggle is left out; the card is `aria-busy="true"`. |
| `StatTile` `source?`, `busy?` | `StatTile` | The board's faint mono source line under a tile. A tile before its data keeps its figure's height, empty and `aria-busy`. |

### 3.3 Tiles

Four `StatTile`s, each with the `figure` style (E2) and a `source`:

| Tile | Call | Figure | Sub |
|---|---|---|---|
| Account value now | 1 | the last bucket's `account_value`, by `formatValue`, with the native code | E2's delta: (last ÷ base − 1) × 100, then "over the last 30 days" or "since Jul 2025". `base` is the first bucket's row, or the first row when the account had no balance yet in the first bucket ("+12.0% since Oct 9"). No delta when `base` is 0. A deleted account shows the figure "—" and "Deleted accounts hold nothing". |
| Transactions sent | 2 | Σ of the type counts over the frame's buckets | "3 failed, fee still paid", where failed is Σ of the `result` counts other than `tesSUCCESS`; "none failed" for 0 |
| Fees paid | 3 | the `totals` row `transaction_cost`: `out_value`, by `formatAmount`, with the native code; "0" without a row | "15,408 drops, burned" |
| Counterparties | 4 | `total` | "accounts it paid or was paid by" |

Sources:

- tile 1: `/v2/accounts/{a}/stats/value?interval=day`;
- tile 2: `…/stats/transactions?interval=day`;
- tile 3: `…/analytics/balance_changes?interval=day`;
- tile 4: `…/analytics/counterparties`.

The interval in each is the view's. A tile of a failed or late call reads "—" (section 2.8).

### 3.4 Account value, in XRP

`LineChart`, one series, with a `domain`. Chart id `analytics-value`. The card's `what` is "the account value".

| Data | Mapping |
|---|---|
| axis | the frame's buckets and unit; `forming: true` |
| series | `{ id: "value", label: "Account value", slot: 1 }`. Each bucket is its row's `account_value`; a bucket without a row is `null`. D2 serves a row for every bucket from the first one in which the account had a balance, so `null`s are leading only. |
| format | `{ kind: "value", unit: native }` |
| domain | `min` = a nice floor of the lowest value: the step is E2's nice step of (max − min) ÷ 3, and the floor is ⌊min ÷ step⌋ × step, in `bignumber.js`. It is set only when that floor is above 0 and the values are not all equal; otherwise the axis starts at 0 and there is no `domain`. |
| extras | `change`, "Change": the change from the bucket before, in percent, as text (section 3.1) |

Notes:

- "XRP plus every token held, valued at the end of each day | week | month."
- "The axis starts at 12,000 XRP.", only with a domain.
- "No value before Oct 9: the account had no balance until then.", only with leading `null`s.

Empty: no rows gives "No balance in these 30 days".

Table: "Day (UTC)" (or "Week of (UTC)", "Month (UTC)") · "Account value, XRP" · "Change", newest first (the kit's).

### 3.5 Transactions sent per day | week | month, by type

`ColumnChart layout="stacked"`. Chart id `analytics-sent`. The card's `what` is "the transactions sent".

| Data | Mapping |
|---|---|
| series | the type groups of section 3.1; a bucket's values are E2's `groupCounts(network, row.type)`, so a group without a type in the row is 0 |
| buckets without a row | 0 when the answer has any row; when it has none, every bucket is `null` and the card shows `emptyText` "No transactions sent in these 30 days" |
| totals | Σ of the groups per bucket |
| annotations | E2's "×" above each bucket with a failed transaction (failed > 0), and the legend entry "× has a failed transaction" |
| extras | `failed`, "Failed": Σ of the bucket's `result` counts other than `tesSUCCESS`, as grouped text |
| format | `{ kind: "count" }`; `forming: true` |

Notes:

- "Transactions this account sent; a failed one still paid its fee."
- The groups' note, E2's `typeGroupsNote(network)`, as on the network page.

Table: the bucket, one column per group, Total, Failed.

### 3.6 Balance history, per currency

`SmallMultiples`, fed with E2's `SmallMultiplesData` (E2 §2.3) as it is. Chart id `analytics-balances`. The card's `what` is "the balance history".

| Data | Mapping |
|---|---|
| axis | the frame's buckets and unit; `forming: true` |
| panels | `lines` in their order, at most 4: the native line first, then by value, as D2 ranks them |
| a panel | `id` currency and counterparty; `label` `formatCurrency(currency)` ("LP token" for a 40-hex code starting `03`); `sublabel` the short counterparty (`rhub8V…wq`), none for the native line; `values`: each bucket the line's row `balance` (D2 carries the balance into buckets without a change), `null` before the line's first row; `format` `{ kind: "amount", unit: label }`, so table cells are exact. Drawn in slot 1, as every panel. |
| readout | the kit's panel header: the hovered bucket's balance, else the newest one's, which is `lines[].balance` ("now") |

Notes:

- "Each currency on its own scale, from zero; hover or focus one to read all of them on the same day."
- "The 4 largest of 7 balances: XRP first, then by value now.", when `lines_total` is above the number shown.
- "A balance below zero is what the account owes on that line.", when a shown line is negative.

Empty: no lines gives "No balances in these 30 days".

Table: the bucket, then one column per panel, headed by the currency and the short issuer.

### 3.7 Money in and out per day | week | month, in XRP

`ColumnChart layout="diverging"`. Chart id `analytics-money`. The card's `what` is "the balance changes".

| Data | Mapping |
|---|---|
| series | "Received" (slot `up`) and "Sent" (slot `down`). Per bucket, Σ `in_value` and Σ `out_value` of call 3's interval rows of every change type except `transaction_cost` and `intermediary`; unclassified rows count. |
| buckets without a row | 0 when any bucket has a counted row; otherwise all `null` and `emptyText` "No money in or out in these 30 days" |
| extras | `net`, "Net": received − sent, as text by `formatValue` with `signed` |
| format | `{ kind: "value", unit: native }`; `forming: true` |
| summary line | between the legend and the plot: "Received **+45.2K** · sent **−38.1K** · net **+7.1K** XRP": the sums over the buckets, by `compactNumber` |

Legend: the kit's "Received, drawn up / Sent, drawn down".

Note: "Payments, DEX trades, escrow, channels and other transactions that changed this account's balances, valued in XRP at each day's rate. Fees, and amounts that only passed through, are left out."

Table: the bucket · Received · Sent · Net.

### 3.8 Where balance changes come from, last 30 days

A `Card` with a `DataTable` (46 px rows, `minWidth` 900 px) and an `InlineBar diverging` cell. The data is call 3's `totals`. The card's `what` is "the balance changes".

| Row | Hint (`--faint`) | From `totals` |
|---|---|---|
| Fees | transaction cost, burned | `transaction_cost` |
| DEX trades | section 3.10's hint | `exchange` |
| Payments in | received | `payment_destination` |
| Payments out | sent | `payment_source` |
| Passed through | as an intermediary | `intermediary` |
| Escrow | locked, finished or cancelled | `escrow_create` + `escrow_finish` + `escrow_cancel` |
| Payment channels | funded or claimed | `paychannel_fund` + `paychannel_payout` |
| Other | changes of other transaction types | The row without `change_type`, and any change type not named above. Shown only when its count is above 0. |

| Column | Content |
|---|---|
| Change type | the row's name over its hint |
| Out · In | `InlineBar diverging`: out to the left, in to the right, one scale for all rows (the largest in or out of any row), `aria-hidden` |
| In, XRP / Out, XRP | Σ `in_value` / Σ `out_value`, by `formatValue` |
| Net, XRP | Σ `net_value`, `formatValue` with `signed`, in a text colour: net is not a status |
| Changes | Σ `count` |

The seven named rows always show, with 0s and no bar when they have no change, so that two periods read the same way.

The title is "Where balance changes come from, " and the period phrase. The legend is "Out, to the left / In, to the right", the `down` and `up` swatches.

Note: "Every balance change of the period, grouped by what caused it. Passed through: payments that rippled through this account's trust lines on their way to someone else."

Empty: no `totals` gives "No balance changes in these 30 days." in place of the table.

Source: `…/analytics/balance_changes`.

### 3.9 Top counterparties, by value

A `Card` with a `DataTable` (`minWidth` 480 px). The data is call 4. The card's `what` is "the counterparties".

| Column | Content |
|---|---|
| Counterparty | `AccountLink` of `account` |
| Sent, XRP | `sent_value`, by `formatValue`; "—" for 0 |
| Received, XRP | `received_value`, the same |
| Payments | `payments_sent + payments_received` |

Note:

- "The 6 largest of 14 counterparties, by value sent plus received.", when `total` is above `count`;
- "All 4 counterparties, largest first.", otherwise.

Empty: `total` 0 gives "No payments in these 30 days."

### 3.10 DEX trading, per pair

A `Card` with a `DataTable` (`minWidth` 520 px). The data is call 6. The card's `what` is "the DEX trading".

| Column | Content |
|---|---|
| Pair | The two sides in E3's natural orientation (`naturalOrientation`, `QUOTE_RANK`, `app/domain/market-pair.ts`), as every page of the program shows a pair: "XRP/USD" (D2 stores it as USD/XRP). Each code by `formatCurrency`, over the issuers of its issued sides ("USD rhub8V…wq"). While E3's `MARKETS` switch is on, a link to E3's pair page, `marketHref(net, base, counter)` in that orientation, so that the link needs no redirect. Plain text while it is off. |
| Volume, XRP | `native_volume`, by `formatValue`; "—" when the API left it out |
| Trades | `count` |
| Bought | What the account bought of the displayed base, by `formatAmount` with the displayed base's code; "—" for 0. When the natural orientation is D2's stored order: `bought`. When it inverts D2's order, the displayed base is D2's counter, which the account received in exactly the trades where it sold D2's base: `sold_counter`. |
| Sold | What the account sold of the displayed base: `sold`; inverted, `bought_counter` (the counter it paid when it bought D2's base). |

The orientation, and which of D2's fields each cell reads, are worked out in the view builder, so the page draws strings only.

**What the index records about AMM swaps** decides the DEX wording here and the DEX trades hint of section 3.8. It follows E2's `AMM_DATA` switch, the program's one signal for AMM-derived parts. The owner turns it on in an environment once its data API has merged the AMM data, re-ingested history with the AMM-aware parser and back-filled. No call is made for it. While it is off, the index may hold some swaps and not others, so on XRPL the wording claims neither.

| | Hint | First sentence of the note |
|---|---|---|
| XRPL, `AMM_DATA` on | "order book and AMM" | "Includes swaps against AMM pools." |
| XRPL, `AMM_DATA` off | "on the DEX" | none |
| Xahau, whatever the switch | "order book" | "Order-book trades only; Xahau has no AMM." |

The note goes on:

- always: "Bought and sold are of each pair's base as shown.";
- "The 6 largest of 9 pairs, by volume in XRP.", when `total` is above `count`.

Empty: no pairs gives "No DEX trades in these 30 days."

### 3.11 Loading, empty, partial and short histories

| State | Tiles | Charts | Tables |
|---|---|---|---|
| Before a card's data | `busy`, figure empty | `ChartCard state="loading"` | the card's frame, as tall as its row limit (8, 6 or 6 rows), "Loading…" `aria-hidden` |
| Empty (section 3.4 to 3.10) | the figure for nothing ("0", "0 XRP"); tile 1 "—" without a delta | the kit's empty state with `emptyText` | the empty sentence in place of the table |
| The running bucket | the figures include it | `forming: true` | "…, so far" on its row |
| A short history inside the period | the figures are what there is | leading `null`s, and the account value's note | |
| All with one or two buckets | | one or two points or columns; the period note's sentence | |
| Failed or late | section 2.8 | `SectionError` in place of the views | `SectionError` in place of the table |

One `role="status"` element tells assistive technology that the view is loading: the period note's slot reads "Loading analytics…" until the frame streams in. The placeholders are not live regions. `SectionError` is `role="alert"`, as everywhere.

A period change is a navigation to another view. The body is keyed by `period`, so it remounts with its placeholders and never shows one period's numbers under another's labels. This differs from E2's dimmed previous render (section 2.8 there), because this view streams. The chart/table choices go back to Chart.

---

## 4. SEO and links

The analytics views are **`noindex, follow`**, with no canonical link and no `og:*` or `twitter:*` tags. That is the house rule for a view that is not indexed: a marker page, E2's non-default views. Crawlers are also kept off them, twice, as off the payments CSV:

- every Analytics tab link and every period link is `rel="nofollow"`;
- `robots.txt` gains `Disallow: /*/account/*tab=analytics`, which matches either query order.

The reason is cost, not content. Bots wait for the whole document, so a crawl of an analytics view is six aggregate reads of an account nobody else is looking at. They are cache misses by nature, and up to 10 s each for a heavy account's counterparties. Across millions of addresses that is the API's heaviest load for no reader. An address's search result is its account page, which stays indexable.

A URL that only external links point to may still be listed without its content. With no internal link to follow, that is rare and harmless.

| | |
|---|---|
| `<title>` | "Analytics · Account rBbW6i…W5jh · XRPL · explorer"; another period: "Analytics, last 90 days · Account …" ("last 52 weeks", "all time") |
| Description | "Account value, transactions sent, balances, money in and out, counterparties and DEX trading of {address} on {network}." No figures. |
| robots | `noindex, follow` |
| Links out | counterparties → `/{net}/account/{a}`; pairs → E3's pair page while `MARKETS` is on (section 3.10) |

---

## 5. JavaScript budget

The account page loads 136.6 KB first today, against the 150,000 B gate (`pnpm check:bundle`: the entry, the root, the layout and the route, with their static imports). The analytics view needs the kit and its own components. Its first paint does not: the server's HTML has every tile, mark and table, and the Chart/Table radios work by CSS (E2 section 2.5).

| Code | How it loads | Counted in |
|---|---|---|
| `AnalyticsFilters.tsx`, the tab's link and `onIntent`, the `lazy()` wrapper | statically, with `AccountPage.tsx` | the account route's first load, every tab (about +1 KB) |
| `AccountAnalytics.tsx` and the kit modules it imports (`ChartCard`, `Legend`, `ChartTable`, `Cursor`, `ColumnChart`, `LineChart`, `SmallMultiples`, `InlineBar`, `geometry`, `labels`; `StatTile` with E2's figure) | `React.lazy(() => import("./AccountAnalytics"))` inside a `Suspense` boundary | the analytics view's total (below) |

**How it loads.** On the server the lazy module resolves during the render, so the stored HTML holds the analytics. In the browser, hydration meets the lazy boundary, fetches the chunk and leaves the server's HTML in place until the chunk has loaded. React does not redraw or empty a dehydrated boundary, so nothing moves. A client-side navigation to the tab shows the outer fallback (an `aria-hidden` frame) until the chunk and the data arrive.

The Analytics tab warms the chunk on `pointerenter` and `focus` (`onIntent`: one `import()`). This is not React Router's `prefetch="intent"`, which would also fetch the view's data: a render and six calls per hover.

**Gates** (`scripts/bundle-budget.ts`):

1. The account route's first load stays at or under **150,000 B**, unchanged. The target is 138,500 B or less.
2. **New:** the analytics view's total stays at or under **150,000 B**: the account route's first load plus the analytics chunk and its static imports, each file counted once at its `gzip -9` size. A visitor who opens the tab never downloads more than the foundation's 150 KB (spec 14) before the page is interactive.
   - The check finds the chunk from the files themselves. A dynamic `import("./AccountAnalytics-….js")` in the account route's first-load files is the chunk; its relative `import`s are followed transitively.
   - A missing chunk, or a dynamic import that cannot be found, fails the check.
   - It prints a row `account analytics` beside the other pages.

**Estimate.** Account 136.6 KB, plus about 1 KB of static additions, plus the kit (E2 estimates about 7 KB for the network page's set, which is about this view's), plus about 3.5 KB of view code: about 148 KB.

**If gate 2 fails, in order:**

1. E2's decided fallback. `Cursor.tsx` and the tooltip load with `import()` on the first `pointerenter` or `focusin` of a plot, for every page of the kit (about −1.5 to −2 KB). They are then not in the view's total.
2. The five list panels of `AccountPage.tsx` (`TabPanel` and its tables) move into a lazy chunk of their own, loaded the same way. Their server HTML is complete, and their links work before hydration. The analytics view then no longer loads them (about −4 KB). Gate 2 then measures each list tab with its chunk too.

The plan measures gate 2 as soon as the kit is in place and applies the rungs it needs, without asking.

`test/unit/analytics-bundle.test.ts` pins:

- `AccountAnalytics.tsx` and what it imports import nothing from `app/server` at run time (types only);
- `AccountPage.tsx` imports it only through `import()`.

E2's `charts-bundle.test.ts` allowlist covers the kit.

---

## 6. Data API interface

| Element | Call (fields) |
|---|---|
| Tile 1, Account value | `stats/value?interval=` (`rows[].date`, `account_value`) |
| Tile 2, Transactions sent | `stats/transactions?interval=` (`rows[].date`, `type`, `result`) |
| Tile 3, Money in and out | `analytics/balance_changes?interval=` (`rows[].date`, `change_type`, `in_value`, `out_value`) |
| Tile 3, Where balance changes come from | the same answer's `totals[]` (`change_type`, `count`, `in_value`, `out_value`, `net_value`) |
| Tile 4, Top counterparties | `analytics/counterparties?limit=6` (`total`, `counterparties[].account`, `sent_value`, `received_value`, `payments_sent`, `payments_received`) |
| Balance history | `analytics/balances?interval=&limit=4` (`lines_total`, `lines[]`, `rows[]`) |
| DEX trading | `analytics/exchanges?limit=6` (`total`, `pairs[]`: pair, `count`, `native_volume`, `bought`, `sold`, `bought_counter`, `sold_counter`) |
| The window | `last_validated` (`close_time`); for All, `accounts/{a}` (`inception`) or `accounts/{a}/transactions?limit=1` (`date`) |
| DEX wording | no call: E2's `AMM_DATA` switch (section 3.10) |

This is D2 section 9's interface, with four choices of this spec:

- `limit=1000` on the stats families;
- `limit=6` on `analytics/exchanges` (D2's default is 20);
- All's start without a creation record from the oldest transaction, rather than `2013-01-01`, so that the axis does not open on years of empty months (Xahau began in 2023);
- the pairs in E3's natural orientation, with Bought and Sold as section 3.10 reads them from D2's `bought`/`sold` or `sold_counter`/`bought_counter`.

**Missing from the data API, and what E4 does meanwhile**

| Missing | E4 meanwhile | Where it would come from |
|---|---|---|
| Values in another currency (USD) | native currency only, no `in` | D2: `exchange_currency` on the analytics routes and `stats/value` |
| Whether an account's trades hold every AMM swap of the period | the wording follows `AMM_DATA` (section 3.10) | D2b: AMM completeness on the analytics routes |
| D2 itself, on any deployment | the tab is off (section 8) | D2's rollout |

---

## 7. Testing

### 7.1 Unit (Vitest, `unit` project)

| File | Covers |
|---|---|
| `app/server/analytics-view.test.ts` | `analyticsFrame` for each period: 30d and 90d from T; 1y with T on a Monday, a Sunday and just after midnight; All from the inception month, from the oldest transaction, and with neither; buckets and the note's dates and sentences. Alignment: rows outside the frame ignored. The `null`-or-0 rule per card. Each builder of sections 3.3 to 3.10: the delta and its base, the deleted tile, the domain floor and its sentence, leading `null`s, the sums per group of E2's `typeGroups` (a missing key is 0) on both networks, failed counts, the money exclusions and net, the `totals` mapping (escrow and channel sums, Other with unknown types), drops, the counterparty and pair notes, the panel order and labels (LP token, issuer, negative), the pairs' natural orientation with both cell forms (D2's order kept, and inverted with "for …"), the AMM wordings for `AMM_DATA` on and off and for Xahau. Tokens: stable for the same data, changed by any drawn value. No float in any string: every value field matches the decimal pattern. |
| `app/domain/analytics-params.test.ts` | The canonical form of every query string: the default dropped, unknown values, repeats, order, `marker`, `back`, `tag`, `in`, unknown parameters; `analyticsHref`; the phrases |
| `app/domain/format.test.ts` | `formatValue` at every boundary: 1, 0.999999, 0.0000005, 0, negatives, `signed`, exponent input, grouping |
| `app/server/analytics-shape.test.ts` | Each check of section 2.8, accepting D2's examples and rejecting each fault: a daily row under `week`, a `marker`, a number for an amount, a bad address |
| `test/unit/analytics-bundle.test.ts` | section 5 |
| `test/unit/route-headers.test.ts` | unchanged; the route keeps `headers = forwardCacheClass` |
| `scripts/check-bundle.test.ts` | Gate 2 over a fake build: a dynamic import found and followed, a shared file counted once, 150,000 B passes and 150,001 fails, a missing chunk fails |
| `scripts/predeploy-check.test.ts` | E2's guard tests gain the name: `ACCOUNT_ANALYTICS` that is neither `"on"` nor `"off"` is refused |
| `test/unit/analytics-fixtures.test.ts` | The synthetic fixtures follow the pinned reference's rules and agree with the hand-written header fixtures (section 7.5) |
| `test/unit/pages-css.test.ts` | the view's layout rules: two-up flex bases, the tile grid, the 900 px table, 44 px period targets |

### 7.2 Components (`components` project, happy-dom)

Rendered with `renderToString`, then hydrated, as E2's chart tests are, with the promises of `AnalyticsData` already settled.

- `app/ui/pages/AccountAnalytics.test.tsx`:
  - every tile and card in each state of section 3.11 and section 2.8;
  - one error for a failed frame, and the late frame's words;
  - the deleted account;
  - each AMM wording on XRPL (`AMM_DATA` on and off) and on Xahau;
  - a pair as a link with `MARKETS` on and as text with it off;
  - `forming` labels;
  - Retry calls `revalidate`;
  - the server HTML holds the marks and the tables, and hydration does not mismatch;
  - the remount on a period change.
- `AnalyticsFilters.test.tsx`: the links, `aria-current`, `rel="nofollow"`, the status slot and the period note.
- `pages/AccountPage.test.tsx` (or `components.test.tsx`, where the page is tested today):
  - the Analytics tab is a link with `rel="nofollow"` when `analyticsTab` is true, and "soon" when it is false;
  - the analytics view has no Holdings margin.
- The kit's own files gain the tests of their growth (section 3.2): `month` labels (with E2's `forming` on a month), `extras` with and without `format` (and a `null` one) in the tooltip, the slider text and the table of each time-series form, `emptyText`, the `loading` card, the tile's `source` and `busy`.

### 7.3 Worker (`worker` project)

`test/worker/account-analytics.spec.ts`, through `pageClient`. Failures come first, each on an account nobody else asks for, as `account.spec.ts` does.

| Covers | Checks |
|---|---|
| Switch | With `"on"` (the `worker` project's top-level vars), the view. The off-case is `test/worker/account-analytics-off.spec.ts` in E2's `worker-off` project (every switch off, E2 §6.1): the tab is "soon", and `?tab=analytics` is the 302 of section 1.2. |
| AMM wording | `AMM_DATA` `"on"` and `"off"` in the load context: the two XRPL wordings of section 3.10; Xahau's either way. No `amm_volume` call in any case. |
| Redirects | the canonical 302s (`short`); `marker` on the tab |
| Calls | Exactly the calls of section 2.3 for each period and network (`mock.requests`), with the query strings from the recorded `last_validated`. No `balances`, no `account_objects` and no `amm_volume`. All from the inception; for a deleted account without a creation record (an override), from P, with P's key the existence probe's. |
| Classes | the page and its `.data` URL stored as `live`; calls 1 to 6 stored with `max-age=60` (class `minute`) |
| Streaming | the first chunk of the HTML holds the header and not the tiles' figures (as the list's test); a bot's user agent gets everything |
| Failures | Each call failing in turn (500, 429, the route's "Cannot GET" 404, a malformed 200, a daily row under `week`): that card's `SectionError` in the HTML, `Cache-Control: no-store`, not stored. Call 0 failing: one error. |
| Deadline | A call that never answers: the card says "Still working on …" within 5 s, and the page is not stored. Real time, as the list's 4.5 s test. |
| Background completion | Call 4 answers after about 6 s. The first render's card is late. A render about 3 s later makes no new counterparties call (`statusesOf`) and shows the card. |
| Meta | `noindex, follow`, no canonical, no `og:*`, the title per period (also in `meta.spec.ts`) |
| robots | `robots.txt` holds the analytics rule (`layout.spec.ts`) |

`test/worker/account-analytics-flight.spec.ts`, a file of its own for a fresh isolate:

- two concurrent renders of one view whose call 4 is delayed by 1 s make one upstream call;
- a failing call 3 is called once across two renders within 5 s, and again after 5 s (fake `Date`).

### 7.4 End to end and accessibility (Playwright)

`test/e2e/account-analytics.spec.ts`, against the built Worker and the fixture server:

- Navigation:
  - the Analytics tab is a link (`rel="nofollow"`) and opens the view in one document;
  - the tiles and the seven cards render from the fixtures;
  - "90 days", "1 year" (weeks) and "All" (months) change the URL, keep the scroll position, and Back restores the view.
- Without the bundle: with every `/assets/*.js` aborted (`contextFor`, as `theme.spec.ts` does), the streamed cards are visible, because React's inline stream scripts run, and the Table radio swaps a view.
- Hover and keyboard:
  - a pointer over the stacked chart shows the tooltip with the date, the total and the failed count;
  - Tab to a slider, then Arrow Left changes its `aria-valuetext`.
- Deleted account: tile 1 "—" and the period note's sentence.
- Never funded: the 404 page.
- `test/e2e/account.spec.ts`: "Analytics is not a link" becomes "Analytics is a link".
- `client-meta.spec.ts`: `noindex` and no canonical after a client-side navigation to the tab, and their return on the way back.

In the `live` project, which runs alone because it changes the fixture server's answers: a card failure (call 2 overridden to 503) shows "Couldn't load the transactions sent", and after the override is removed, Retry brings the card back (after the 5 s hold).

Where E2's `E2E_FEATURES_OFF` lists `ACCOUNT_ANALYTICS` (a run against staging or production before step 4 of section 8), these tests skip themselves and the off-case runs instead: the tab is "soon" and the URL redirects. Against a real stack (`E2E_DATA_API_URL` or `E2E_BASE_URL`), the tests that read the synthetic files are skipped, as the `LIVE` account tests are. One structural test runs everywhere: each card renders data, an empty state or its error, and nothing asserts a figure.

**Accessibility** (`a11y.spec.ts`, axe with the WCAG 2.2 AA tags; the gate is no violation of impact serious or critical):

| Pages | Matrix |
|---|---|
| the XRPL active account's analytics, default view | 1280 px and 375 px × the four theme settings |
| `?period=1y`, `?period=all`, the Xahau active account, the deleted account, a view with a failed card, every table view on, a slider focused with its tooltip | the two system themes |

`landmark-unique` and the ARIA "needs review" test cover the view too.

### 7.5 Fixtures

The analytics answers cannot be derived from the recorded ledgers: they are months of aggregates valued at rates. So they are **synthetic**, from a seeded generator (`scripts/analytics-fixtures.ts`, mulberry32, seeded per network, account and endpoint), as E2's aggregates are. `pnpm fixtures:sync` writes them, and `pnpm fixtures:check` and `scripts/http-fixtures.test.ts` check them.

| Files (per network) | For |
|---|---|
| `data-api/accounts/<a>/stats/value@interval=…&limit=1000&start=….json`, `stats/transactions@…`, `analytics/balance_changes@interval=…&start=….json`, `analytics/counterparties@limit=6&start=….json`, `analytics/balances@interval=…&limit=4&start=….json`, `analytics/exchanges@limit=6&start=….json` | the active and the deleted account, for each of the four periods' `start` and `interval` (section 2.2) |
| the same names, empty (`rows: []`, `lines: []`, `totals: []`, `counterparties: []`, `pairs: []`, totals 0) | the never-funded address, as D2 answers an unknown address |

P's file for the never-funded address (`transactions@limit=1.json`) exists already.

**The shapes follow the built reference, not the spec text.** D2 is built before E4, so the generator follows the `docs/api-reference.md` of `data-api-new`'s `feat/explorer-data` at a commit the plan pins (read with `git show`, never a checkout). Its rules, which are D2 sections 5 and 6.1 as built:

- key orders, and keys left out instead of `null`;
- dates on bucket starts, and the window widened to whole buckets;
- `stats/value` has a row for every bucket from the first one with a balance;
- `stats/transactions` has rows for active buckets only, with the result counts adding up to the type counts;
- `totals` are the sums of the rows, and `net_value = in_value − out_value`;
- the change types in D2's order;
- lines ranked native first;
- counterparties sorted by `total_value`, then the account, with `total` at least `count`;
- pairs sorted by `native_volume`;
- every amount and value an exact decimal string made with `bignumber.js`;
- one line per row and sorted keys, as the other files.

**Anchored to the header fixtures**, so that the view and the header agree:

- the active account's native line ends at its `account_info` balance, and its LIONS (XRPL) or EVR (Xahau) line at its balances fixture;
- the deleted account's history ends in its deletion's bucket with a native balance of 0, and zeros after.

`test/unit/analytics-fixtures.test.ts` checks both.

`test/fixtures/PROVENANCE.md`'s "Synthetic aggregates" section (E2's) gains the analytics files, the generator and its seeds. It names the pinned `feat/explorer-data` commit whose `docs/api-reference.md` the shapes follow. The README's "Upstream fixtures" table marks them "generator (synthetic)".

---

## 8. Rollout

| Step | What ships | Behaviour |
|---|---|---|
| 1. E2, then E3 | E2: the kit (`forming` and `SmallMultiplesData` included), the feature switches (`app/ui/features.ts`, `cacheGeneration`, `AMM_DATA`), `typeGroups`, `windowOf` in `app/domain/window.ts`, `holdFailure`, the route-missing rule, `compactNumber`, `PENDING_PATHS`. E3: `minute`, `formatChange`, `naturalOrientation`, `marketHref`, `MARKETS`. | as they say |
| 2. E4, before D2 is deployed anywhere | everything in this spec; `ACCOUNT_ANALYTICS` `"on"` at the top level, `"off"` in staging and production; the four `analytics/*` paths in `PENDING_PATHS` | Production as today: "soon", and `?tab=analytics` is a 302 to the account page. The suites run the view against the fixtures. |
| 3. D2 on the staging stack | D2's rollout there: syncer first, then the API (D2 section 16) | Staging `ACCOUNT_ANALYTICS` `"on"` (a deploy). The end-to-end suite runs against staging (`E2E_BASE_URL`), and the staging checklist below is worked through. |
| 4. D2 in production | When D2's gauges `syncer_rates_daily_missing_days` and `syncer_account_rollups_pending_accounts` are 0 on the production deployment (D2 section 16, step 4) | Production `ACCOUNT_ANALYTICS` `"on"` (a deploy). The switch is in E2's cache generation, so no stored page keeps "soon". |
| 5. D2's `docs/openapi.yaml` on `main` | `pnpm api:sync` (the commit names the source commit) | `pending-paths.test.ts` fails, and the four paths move to `PATHS`. No behaviour change. |
| 6. The AMM data, per environment | The owner turns E2's `AMM_DATA` on where the data API has merged `feat/amm-data`, re-ingested and back-filled (E2's rule) | The DEX hint and note take their AMM wording (section 3.10). No E4 change. |

The pairs of the DEX card are links wherever E3's `MARKETS` is on, from the first E4 deploy: E3 is built before E4.

**Before D2 is live, the tab stays off by configuration rather than detecting 404s.** Detection would cost a probe call on every account page, because every tab bar shows the tab. It would also show the tab on a deployment whose D2 back-fills are not done, where long windows are slow (D2 section 12). A 404 from an analytics route while the tab is on is a card failure (section 2.8).

**Rolling back** is `ACCOUNT_ANALYTICS` `"off"` and a deploy.

The staging checklist (README) gains:

- the four periods of a heavy account, such as an exchange's hot wallet, against the staging stack;
- the late-counterparties path: the card says "Still working …", and a Retry seconds later shows it;
- in-flight sharing and the failure hold, seen in `wrangler tail`;
- `robots.txt`;
- the bundle figures of gate 2.
