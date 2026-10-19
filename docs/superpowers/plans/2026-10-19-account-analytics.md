# Account Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the account page's Analytics tab, `/{net}/account/{address}?tab=analytics`: four tiles and seven cards from D2's routes, for the periods 30 days, 90 days, 1 year and All, on XRPL and Xahau, behind the `ACCOUNT_ANALYTICS` switch.

**Architecture:** The account route gets an analytics branch. It awaits the header without the holdings calls, and `loadAnalytics` hands back the frame and six card promises. Each card is one D2 call (class `minute`, failure hold, shared in flight) and a pure view builder, raced against E2's `byDeadline` (`CARD_DEADLINE_MS`, 4.5 s). A late call finishes under `waitUntil`. `AccountAnalytics.tsx` is a lazy chunk that draws the page data with E2's chart kit, which this plan grows by `extras`, `month`, `value`, an empty text, a loading card and tile sources. Every href and every wording that depends on a switch comes in the page data.

**Tech Stack:** React Router 8.4 framework mode on Cloudflare Workers, React 19 (`lazy`, `Suspense`, `Await`), bignumber.js, E2's hand-written chart kit (`app/ui/charts/`), Vitest (`unit`, `components`, `worker`, `worker-off`), Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-19-account-analytics-design.md` (cited as "§n" below). Executors read the plan and the spec. The shared pieces are defined in `2026-10-19-network-dashboard-design.md` (E2 §2.3 kit shapes, §6 mechanisms) and `2026-10-19-markets-design.md` (E3 §4.6).

**Branch:** `feat/explorer-pages` in `/Users/golobitch/github.com/GateHubNet/x-explorer`. Before Task 1 the following must be true:
- the E2 plan and the E3 plan are built and committed on this branch;
- D2 is built on data-api-new's `feat/explorer-data` (worktree `/Users/golobitch/github.com/GateHubNet/data-api-new/.worktrees/explorer-data`), and its `docs/api-reference.md` documents the four `analytics/*` routes and `interval` on `stats/{family}`. Task 6 pins that commit.

## Global Constraints

- **Shared pieces are used as their owners built them, never redefined or copied.**
  - From the E2 plan:
    - the switch mechanism (`app/ui/features.ts`, `cacheGeneration(env)`, the guard, the `worker-off` project, `E2E_FEATURES_OFF`);
    - `net.features`, `hasAmm`, `anchorOf`, `windowOf`, `utcDayOf`, `typeGroups`, `groupCounts`, `typeGroupsNote`;
    - the kit: `TimeSeriesData`, `forming`, `SmallMultiplesData`, `compactNumber`; `bucketLabel`, `valueText` and `cellText` (`app/ui/charts/labels.ts`); `niceScale` (`app/ui/charts/geometry.ts`); `ChartCard`;
    - `tokenOf` (`app/domain/fnv.ts`), the FNV-1a token of what is drawn;
    - `SegmentedLinks` (`app/ui/components/SegmentedLinks.tsx`), for the period links;
    - `SubrequestOptions` (the options of `SubrequestCache.json`, with `holdFailure`), the "Cannot GET" rule, and `PENDING_PATHS` (`app/server/pending-paths.ts`);
    - `byDeadline`, `CARD_DEADLINE_MS` and `TooLate` (`app/server/deadline.ts`);
    - `mulberry32` and `seedOf` (`scripts/synthetic.ts`) and the synthetic-fixture conventions;
    - `SectionError`'s `message?: ReactNode`.
  - From the E3 plan: the class `minute`, `formatChange`, `naturalOrientation`, `QUOTE_RANK`, `marketHref`, `useRetry` (`app/ui/use-retry.ts`), the `MARKETS` switch, and its `isHandWritten` clause for `node/book_offers/`.
  - Refer to E2's and E3's pieces by name and file, never by the number of the task that built them.
- **Switch:** `ACCOUNT_ANALYTICS` is `"on"` at the top level of `wrangler.jsonc` (development and every test suite) and `"off"` in `staging` and `production`. Off: the tab is the "soon" label, and `?tab=analytics…` is a 302 to `/{net}/account/{address}`, class `short`. The switch is part of E2's `cacheGeneration`, and E4 adds no cache key of its own.
- **Periods** (§1.3): `30d` (the default), `90d`, `1y`, `all`, with `interval` `day`, `day`, `week`, `month`. `T` is `utcDayOf(anchorOf(last_validated).closeTime)`. The windows (§2.2):
  - `30d`: T−29 … T;
  - `90d`: T−89 … T;
  - `1y`: the Monday 51 weeks before the Monday of T's week, to T's week;
  - `all`: the month of `inception`, else the month of the oldest indexed transaction, else T's month; never after T's month.
  - With the recorded XRPL `last_validated` (2026-10-17T17:01:12Z), `S` is 2026-09-18, 2026-07-20, 2025-10-20 and 2025-07-01.
- **One URL per view:** the canonical query is `tab=analytics`, then `period` when it is not `30d`. Any other query string gets a 302 to the canonical URL (`cacheClassHeaders("short")`) before any upstream call.
- **Calls** (§2.3), the same `start` and `interval` on each, no `end`:
  - `stats/value` and `stats/transactions`: `interval={u}&limit=1000&start={S}`;
  - `analytics/balance_changes`: `interval={u}&start={S}`;
  - `analytics/counterparties`: `limit=6&start={S}`;
  - `analytics/balances`: `interval={u}&limit=4&start={S}`;
  - `analytics/exchanges`: `limit=6&start={S}`.
  - All six: class `minute` (kept 60 s), `holdFailure`, `shareInFlight`.
  - Timeouts: `DATA_API_TIMEOUT_MS` (5,000 ms) for each call, except `analytics/counterparties`, which takes `ANALYTICS_SLOW_TIMEOUT_MS` = 15,000 ms.
  - The analytics view never calls `/balances`, `account_objects` or `amm_volume`.
- **Deadlines:** E2's `CARD_DEADLINE_MS` (4,500 ms, the spec's `LIST_DEADLINE_MS`) from the loader's start bounds the frame and every card, through E2's `byDeadline`. `streamTimeout` stays 5,000 ms. `waitUntil` finishes a late call.
- **Caching:** the page and its `.data` URL are class `live`. A failed or late card or frame calls `logProblem` and `markDegraded(context, "analytics {card} …")`, so the page is served and never stored.
- **Values** come in the native currency only, with no `in=`. Every sum, difference and quotient is made with `bignumber.js` in a view builder and handed on as a string, and no float reaches a label. Values are shown with `formatValue` in tiles and table cells, and with `compactNumber` plus the unit in tooltips and the money summary. Amounts are shown with `formatAmount`.
- **SEO** (§4):
  - the analytics views are `noindex, follow`, with no canonical, `og:*` or `twitter:*`;
  - the Analytics tab link and every period link carry `rel="nofollow"`;
  - `robots.txt` gains `Disallow: /*/account/*tab=analytics`.
- **JavaScript** (§5):
  - the account route's first load is at most 150,000 B (target 138,500 B);
  - the analytics view's total (that first load plus the analytics chunk and its static imports, each file once) is at most 150,000 B;
  - `AccountAnalytics.tsx` imports nothing from `app/server` at run time and is loaded only through `import()`.
- **Components never fetch.** Retry is `useRetry()`.
- **Verification:** run `pnpm test <pattern>` while iterating, and `pnpm verify` before every commit, which must exit 0. Run `pnpm test:e2e` in the tasks that change a page the browser reaches (12, 14, 16). Worker specs share one Cache API per file, so failure tests go first and each uses an account no other test asks for.
- **Commits** are Conventional Commits, as in the repository (`feat(account): …`, `feat(charts): …`, `test(e2e): …`). Every message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A heavy account's counterparties take 6–10 s.**
   - Expected: the first view says "Still working on the counterparties. Retry in a few seconds.", the page is not stored, and a Retry a few seconds later shows the card without a second upstream call.
   - Pinned by Task 14's worker test "Background completion" and the flight spec.
2. **A data API without D2, or with a broken route.**
   - Expected: a "Cannot GET" 404, a 5xx or 429, or a malformed 200 costs only its own card ("Couldn't load the transactions sent." with Retry). It is never a 404 page, never a stored copy, and the other cards and the header still load.
   - Pinned by Task 7 (client kinds), Task 6 (shape checks) and Task 14 ("Failures", each call in turn, `no-store`, not stored).
3. **A pair D2 stores the other way round** (USD/XRP shown as XRP/USD).
   - Expected: Bought and Sold are amounts of the displayed base, read from `sold_counter` and `bought_counter`, not D2's base amounts under the wrong label.
   - Pinned by Task 10's `pairsCard` tests (kept and inverted orientation).
4. **Bucket alignment at the edges.**
   - Expected: 1 year with T on a Sunday, on a Monday, or just after midnight UTC, and All by month, give the right weeks and months. An API that ignores `interval` and answers days fails the card instead of drawing a wrong chart, and rows outside the frame are ignored.
   - Pinned by Task 2's `analyticsWindow` tests, Task 6's "a daily row under week" rejection, and Task 9's alignment test.
5. **Values shown with the wrong rounding or as floats.**
   - Expected: "16,787.15 XRP" for 16787.149, "<0.000001" for a value below a drop, and U+2212 for a minus.
   - Pinned by Task 2's `formatValue` boundary tests, and by Tasks 9 and 10's "no float in any string" test, which checks every value field against the decimal pattern.

---

### Task 1: The `ACCOUNT_ANALYTICS` switch

This task follows E2's recipe for adding a switch, in full.

**Files:**
- Modify: `app/ui/features.ts`. Append `"ACCOUNT_ANALYTICS"` last to `FEATURE_VARS`, and `ACCOUNT_ANALYTICS: "accountAnalytics"` last to `FEATURE_NAME`.
- Modify: `app/server/env.ts` (`Env.ACCOUNT_ANALYTICS: "on" | "off"`).
- Modify: `wrangler.jsonc`. The top-level `vars` get `"ACCOUNT_ANALYTICS": "on"`, and `env.staging.vars` and `env.production.vars` get `"off"`.
- Modify: E2's `TOP_LEVEL_SWITCHES` (the top-level values the `worker` project pins) gains `ACCOUNT_ANALYTICS: "on"`. That is the only pin: the `worker-off` project gets no pin of its own.
- Modify: the ten hand-built `Env`s of the tests (`grep -rln "XRPL_NODE_URL:" app test scripts` lists them). Each gains `ACCOUNT_ANALYTICS: "on"`.
- Modify: `README.md`. "Configuration › Switches" gains the row: the account page's Analytics tab; on in development and tests; off in staging and production until D2's gauges `syncer_rates_daily_missing_days` and `syncer_account_rollups_pending_accounts` are 0 there (§8).
- Test:
  - `app/ui/features.test.ts`, `app/server/env.test.ts`, `app/server/networks.test.ts`, `test/worker/edge-cache.spec.ts` and `test/worker/features-off.spec.ts`: their expected strings gain the switch, or they use E2's `allSwitches()` where E2 converted them;
  - `scripts/predeploy-check.test.ts`: its passing configs gain the switch.

**Interfaces:**
- Consumes, from the E2 plan: `FEATURE_VARS`, `FEATURE_NAME`, `Features`, `featuresOf`, `NO_FEATURES`, `allSwitches()`, `TOP_LEVEL_SWITCHES`, `cacheGeneration(env)`, `networkOf(id, env).features`, `scripts/predeploy-guard.ts`.
- Produces: `Features.accountAnalytics: boolean`, so `net.features.accountAnalytics` exists, and `Env.ACCOUNT_ANALYTICS: "on" | "off"`.

- [ ] **Step 1: Write the failing tests.**
  - `features.test.ts`:
    - `featuresOf({ ACCOUNT_ANALYTICS: "on" }).accountAnalytics === true`;
    - `"off"`, `"ON"` and a missing value give `false`;
    - `NO_FEATURES.accountAnalytics === false`;
    - `FEATURE_VARS` ends with `"ACCOUNT_ANALYTICS"`.
  - `env.test.ts`:
    - with every switch set, `cacheGeneration(env)` holds `ACCOUNT_ANALYTICS=on`, sorted first after the colon (`test-build:ACCOUNT_ANALYTICS=on,AMM_DATA=…`);
    - flipping it to `"off"` changes the string.
  - `networks.test.ts`, `edge-cache.spec.ts` and `features-off.spec.ts` expect the switch in their strings: `on` at the top level, and `off` in `worker-off`, where every switch is off.
  - `predeploy-check.test.ts`:
    - the passing configs carry `ACCOUNT_ANALYTICS`;
    - a build whose vars have `ACCOUNT_ANALYTICS: "yes"` is refused with a reason naming `ACCOUNT_ANALYTICS`;
    - a build without it is refused;
    - `wrangler.jsonc`'s `staging` and `production` blocks both say `"off"`, and the top level says `"on"`.
- [ ] **Step 2: Run them and see them fail.** `pnpm test app/ui/features app/server/env app/server/networks scripts/predeploy-check test/worker/edge-cache` fails on `accountAnalytics` being undefined and on the missing var.
- [ ] **Step 3: Implement.** Add the name in each place listed under Files. The guard needs no code change: it reads `FEATURE_VARS`.
- [ ] **Step 4: Run them and see them pass.** Run the same command, then `pnpm verify` (exit 0). `pnpm verify` runs `features-off.spec.ts` in the `worker-off` project.
- [ ] **Step 5: Commit.** `git add -u` (every file of this task is a tracked file). Message: `feat(account): the ACCOUNT_ANALYTICS switch, on locally and in tests, off in staging and production`.

### Task 2: Periods, URLs, windows, phrases and `formatValue`

**Files:**
- Create: `app/domain/analytics-params.ts`, `app/domain/analytics-params.test.ts`.
- Modify: `app/domain/format.ts` (`formatValue`) and `app/domain/format.test.ts`.

**Interfaces:**
- Consumes, from the E2 plan: `windowOf(T, period)` and `utcDayOf` (`app/domain/window.ts`).
- Produces (pure; the browser imports this file, so it imports only `window.ts`):

```ts
// app/domain/analytics-params.ts
export const ANALYTICS_PERIODS = ["30d", "90d", "1y", "all"] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];
export const DEFAULT_ANALYTICS_PERIOD: AnalyticsPeriod = "30d";
export type AnalyticsUnit = "day" | "week" | "month";               // the axis unit and the API's `interval`
export const ANALYTICS_PERIOD_LABELS: Record<AnalyticsPeriod, string>; // "30 days", "90 days", "1 year", "All"
/** The period of a canonical query, or the canonical query (without "?") to redirect to. */
export function parseAnalyticsQuery(search: string | URLSearchParams): { period: AnalyticsPeriod } | { canonical: string };
export function analyticsHref(net: string, address: string, period: AnalyticsPeriod): string;
export interface AnalyticsPhrases { title: string; empty: string; meta: string | null }
/** `firstMonth` is the frame's first month as "Jul 2025"; only `all` reads it. */
export function analyticsPhrases(period: AnalyticsPeriod, firstMonth: string): AnalyticsPhrases;
export interface AnalyticsWindow {
  period: AnalyticsPeriod;
  unit: AnalyticsUnit;
  buckets: string[];                       // YYYY-MM-DD bucket starts, oldest first; the last one is running
  start: string;                           // S = buckets[0]
  T: string;
  origin: "activation" | "oldest" | "none" | null;   // where All's first month came from; null for the other periods
}
export function analyticsWindow(period: AnalyticsPeriod, T: string, first?: { day: string; from: "activation" | "oldest" } | null): AnalyticsWindow;

// app/domain/format.ts
export function formatValue(value: string, opts?: { signed?: boolean }): string;
```

- [ ] **Step 1: Write the failing tests** (`analytics-params.test.ts`, `format.test.ts`).
  - `parseAnalyticsQuery`:
    - `"tab=analytics"` gives `{ period: "30d" }`, and `"tab=analytics&period=90d"` gives `{ period: "90d" }` (likewise `1y` and `all`);
    - each of these gives `{ canonical }`:

      | Query | `canonical` |
      |---|---|
      | `tab=analytics&period=30d` | `tab=analytics` |
      | `tab=analytics&period=2y` | `tab=analytics` |
      | `tab=analytics&period=90D` | `tab=analytics` |
      | `tab=analytics&period=90d&period=1y` | `tab=analytics&period=90d` (the first value is read) |
      | `period=90d&tab=analytics` | `tab=analytics&period=90d` |
      | `tab=analytics&tab=analytics` | `tab=analytics` |
      | `tab=analytics&marker=WzEw`, `&back=a.b`, `&tag=5`, `&in=usd`, `&x=1` | `tab=analytics` |
  - `analyticsHref("xrpl", A, "30d")` is `/xrpl/account/A?tab=analytics`, and `"1y"` gives `/xrpl/account/A?tab=analytics&period=1y`.
  - `analyticsPhrases`:
    - `30d`: `{ title: "last 30 days", empty: "these 30 days", meta: null }`;
    - `90d`: `{ "last 90 days", "these 90 days", "last 90 days" }`;
    - `1y`: `{ "last 52 weeks", "these 52 weeks", "last 52 weeks" }`;
    - `all` with `"Jul 2025"`: `{ "since Jul 2025", "its whole history", "all time" }`.
  - `analyticsWindow`:
    - `("30d", "2026-10-17")`: unit `day`, 30 buckets, `start` `"2026-09-18"`, last `"2026-10-17"`;
    - `("90d", "2026-10-17")`: start `"2026-07-20"`, 90 buckets;
    - `("1y", "2026-10-17")` (a Saturday): unit `week`, 52 buckets, start `"2025-10-20"`, last `"2026-10-12"`. T `"2026-10-18"` (a Sunday) and `"2026-10-12"` (a Monday) give the same buckets, and T `"2026-10-19"`, just after midnight on a Monday, starts `"2025-10-27"` and ends `"2026-10-19"`;
    - `("all", "2026-10-17", { day: "2025-07-15", from: "activation" })`: unit `month`, 16 buckets `"2025-07-01"` … `"2026-10-01"`, origin `activation`;
    - `{ day: "2026-09-03", from: "oldest" }`: `["2026-09-01", "2026-10-01"]`, origin `oldest`;
    - `null`: `["2026-10-01"]`, origin `none`;
    - `{ day: "2026-11-02", from: "activation" }`: `["2026-10-01"]`, never after T's month;
    - `{ day: "2013-01-02", … }`: 166 buckets.
  - `formatValue`:

    | Input | Result |
    |---|---|
    | `"1"` | `"1"` |
    | `"0.999999"` | `"0.999999"` |
    | `"0.1234565"` | `"0.123457"` |
    | `"0.000001"` | `"0.000001"` |
    | `"0.0000005"` | `"<0.000001"` |
    | `"-0.0000001"` | `"−<0.000001"` |
    | `"0"`, and `"0"` with `{ signed: true }` | `"0"` |
    | `"16787.149"` | `"16,787.15"` |
    | `"1234567.1"` | `"1,234,567.1"` |
    | `"-38100.456"` | `"−38,100.46"` |
    | `"7100.255"` with `{ signed: true }` | `"+7,100.26"` |
    | `"1.5e3"` | `"1,500"` |
- [ ] **Step 2: Run them and see them fail.** `pnpm test app/domain/analytics-params app/domain/format` fails because the module and the export are missing.
- [ ] **Step 3: Implement.**
  - `analyticsWindow`: take `30d`, `90d` and `1y` from E2's `windowOf(T, period)` (its `buckets` and `start`). Build `all`'s months in UTC from the first month to T's month.
  - `formatValue`:
    - a non-zero value whose absolute value is below 0.000001 is `"<0.000001"`, with the sign before it;
    - otherwise round half up (`BigNumber.ROUND_HALF_UP`) to 2 decimals when the absolute value is at least 1, else to 6;
    - drop trailing zeros, add "+" for a positive value with `signed`, and group and write the minus with `formatAmount`.
- [ ] **Step 4: Run them and see them pass.** Run the same command, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/domain/analytics-params.ts app/domain/analytics-params.test.ts app/domain/format.ts app/domain/format.test.ts`. Message: `feat(analytics): the periods, their canonical URLs, windows and phrases, and formatValue`.

### Task 3: Kit growth, part 1: `value`, `month` and `extras`

**Files:**
- Modify (E2's kit files; grow them, do not fork them): `app/ui/charts/types.ts`, `app/ui/charts/labels.ts`, `app/ui/charts/geometry.ts`, `app/ui/charts/Cursor.tsx`, `app/ui/charts/ChartTable.tsx`. If E2's bundle fallback created `CursorSlot` (the lazy wrapper of `Cursor`), the `Cursor` changes reach it too: it passes `extras` through, and its tests cover them.
- Test: the kit's test files E2 made, `app/ui/charts/geometry.test.ts`, `Cursor.test.tsx`, `ChartTable.test.tsx`, `ColumnChart.test.tsx` and `LineChart.test.tsx`, plus the labels tests wherever E2 put them.

**Interfaces:**
- Consumes, from the E2 plan: `ValueKind`, `ValueFormat`, `TimeAxis`, `TimeSeriesData` (with `forming`), `bucketLabel`, `valueText`, `cellText` (`labels.ts`), `compactNumber`, `Cursor` (and `CursorSlot` where it exists), `ChartTable`, `ColumnChart`, `LineChart`. From the E3 plan: `TimeAxis.unit` `"minute"`.
- Produces (E4 owns this block; the E6 and E5 plans use it exactly as written):

```ts
// app/ui/charts/types.ts (growth)
type ValueKind = /* E2's kinds */ | "value";   // an estimate in the native currency
interface TimeAxis { unit: /* E2's and E3's units */ | "month"; buckets: string[] }   // month buckets are "YYYY-MM-01"
/** A per-bucket figure that is shown in the tooltip, the slider and the table, and never drawn. */
export interface TimeSeriesExtra {
  id: string;
  label: string;
  values: (string | null)[];   // one per bucket of the axis; null is "no data"
  format?: ValueFormat;
  tooltip?: "value-label" | "value";   // the tooltip row's form; default "value-label"
}
interface TimeSeriesData { /* E2's fields */ extras?: TimeSeriesExtra[] }
```

  The contract of `extras`. It holds on every form that takes `TimeSeriesData`: `ColumnChart` single, stacked and diverging, and `LineChart` plain, area, step and with a domain, on every axis unit (`flag` and `month` included).
  - **Tooltip:** after the series rows and the total, one row per extra, with no key. Its form depends on `tooltip`:
    - `"value-label"` (the default): the value is strong and the label `--muted`. The label's first letter is lowered when it is a capital followed by a lower-case letter, so "Failed" reads "**1** failed" and "RLUSD fees" stays as it is;
    - `"value"`: the value text alone, with no label, for an extra whose value is already a sentence ("4 missed of 22,096 validated ledgers", E6).
  - **Slider:** `aria-valuetext` appends `; {label} {value}` after the series, whatever `tooltip` says, for example `"Oct 16, 2026: 12 total; …; Failed 1"`.
  - **`ChartTable`:** one column per extra, after the series and Total, headed by its label.
  - **Values:** with `format`, `valueText` in the tooltip and the slider and `cellText` in the table. Without `format`, the text as given. `null` is "—", read "no data".
  - **Never** part of the scales, the legend or the plot summary. The data's `token` must cover them, so a builder that changes an extra changes the token.
  - `"value"`: table cells use `formatValue`, and tooltips, ticks and the slider use `compactNumber` and the unit.
  - `"month"`: the label is "Oct 2026" on the axis, in tooltips and in table cells. A forming bucket reads "Oct 2026, so far" (never on the axis), and the table header is "Month (UTC)".

- [ ] **Step 1: Write the failing tests.**
  - Labels:
    - a month bucket `"2026-10-01"` reads `"Oct 2026"` in the axis, tooltip and table contexts, and `"Oct 2026, so far"` in the tooltip and table when forming;
    - the month table header is `"Month (UTC)"`;
    - kind `value` with unit `XRP`: the tooltip text of `"45200"` is `"45.2K XRP"`, and the table cell of `"16787.149"` is `"16,787.15"`.
  - Geometry: a month axis of 166 buckets picks every 28th x label (⌈166/6⌉), counting from the newest, on a wide plot. Positions are the same as for a day axis of the same length.
  - Each time-series form, rendered with `renderToString` and then hydrated, with `extras: [{ id: "failed", label: "Failed", values: ["0", "1"] }]`:
    - the pointer on bucket 1 shows a tooltip whose last row is strong `1`, muted `failed`, and no key element;
    - the slider's `aria-valuetext` ends `"; Failed 1"`;
    - the table has a column "Failed" after the series (and after "Total" on a stack), with cells `"1"`, `"0"`, newest first;
    - a `null` value is `"—"` in the tooltip and the table and `"Failed no data"` in the slider;
    - this runs for `ColumnChart` single, stacked and diverging, `LineChart`, and `LineChart curve="step"` over a `flag` axis.
  - Tooltip modes:
    - without `tooltip`, and with `tooltip: "value-label"`, the row is strong `1` and muted `failed`;
    - `{ id: "ledgers", label: "Ledgers", values: ["4 missed of 22,096 validated ledgers"], tooltip: "value" }` gives a row whose whole text is "4 missed of 22,096 validated ledgers", with no label element, while the slider still appends `"; Ledgers 4 missed of 22,096 validated ledgers"`.
  - Format: `{ id: "swaps", label: "Swaps", values: ["1284331"], format: { kind: "count" } }` reads `"1,284,331"` in the tooltip and the table. `{ kind: "amount", unit: "USD" }` on `"1234.5678"` reads the kit's compact text in the tooltip and `"1,234.5678"` in the table.
  - No side effects: the same data with and without extras has equal tick labels, legend entries and plot summary (`role="img"` label).
- [ ] **Step 2: Run them and see them fail.** `pnpm test app/ui/charts` fails on the unknown unit and kind and on the missing extras rows and column.
- [ ] **Step 3: Implement.** Add the type members and the label branches. `Cursor` (and `CursorSlot`, where it exists) renders the extras' rows in their `tooltip` form and their part of `aria-valuetext`, and `ChartTable` adds their columns. Where `geometry.ts` branches on `unit`, `month` takes the even spacing of `day`.
- [ ] **Step 4: Run them and see them pass.** Run the same command, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/ui/charts`. Message: `feat(charts): extras, the month axis and the value kind`.

### Task 4: Kit growth, part 2: empty text, the loading card, the summary slot, the tile's source and busy state

**Files:**
- Modify: `app/ui/charts/types.ts` (`TimeSeriesData.emptyText?: string`).
- Modify: `app/ui/charts/ChartCard.tsx`. E2's `state?: "ok" | "failed"` widens to `state?: "ok" | "failed" | "loading"`, still defaulting to `"ok"`, and the card gains `summary?: ReactNode`.
- Modify: `app/ui/charts.css` and `app/ui/components/StatTile.tsx`, which gains `source?: string` and `busy?: boolean`.
- Modify: `app/ui/components.css` (`.stat__source`, and the figure's height kept while busy).
- Test: `app/ui/charts/ChartCard.test.tsx`, the StatTile tests (E2's file, else `app/ui/components/components.test.tsx`), `test/unit/charts-css.test.ts`.

**Interfaces:**
- Consumes, from the E2 plan: `ChartCard` with its `state` `"ok" | "failed"`, the empty state of E2 §2.8, and `StatTile` with `figure` and `delta`.
- Produces:
  - `TimeSeriesData.emptyText`: where the kit draws its empty state, the text is `emptyText` when given, else E2's words;
  - `ChartCard`:
    - `state="loading"` shows the title and source and fills the plot's height with "Loading…" in `--muted`, `aria-hidden`. It has no toggle, and the card is `aria-busy="true"`. `"ok"` and `"failed"` behave as E2 built them;
    - `summary` is drawn between the legend and the plot. This is a growth step that §3.2 does not list; it is for §3.7's summary line;
  - `StatTile`: `source` is a faint mono line under the sub (`.stat__source`); `busy` gives the tile `aria-busy="true"` and an empty figure that keeps its height.

- [ ] **Step 1: Write the failing tests.**
  - `ChartCard`:
    - `state="loading"` with the title "Account value, in XRP" and the source `/v2/accounts/{a}/stats/value?interval=day` renders the `h2`, the source, an `aria-hidden` element with the text "Loading…" and no `fieldset`, with `aria-busy="true"` on the section;
    - E2's existing `"ok"` and `"failed"` tests still pass, and leaving `state` out still renders as `"ok"`;
    - a stacked `ColumnChart` whose values are all `null`, with `emptyText: "No transactions sent in these 30 days"`, shows that text, and without `emptyText` it shows E2's words;
    - `summary={<p>Received</p>}` comes after the legend and before the plot in document order.
  - `StatTile`: `source="/v2/accounts/{a}/analytics/counterparties"` renders `.stat__source` with that text; `busy` renders `aria-busy="true"` and an empty `.stat__value`.
  - `charts-css.test.ts`, or the components CSS test: the loading body keeps the plot height, and `.stat__value` has a `min-height` while busy.
- [ ] **Step 2: Run them and see them fail.** `pnpm test app/ui/charts/ChartCard app/ui/components test/unit/charts-css` fails.
- [ ] **Step 3: Implement** the props and the CSS described under Interfaces.
- [ ] **Step 4: Run them and see them pass.** Run the same command, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/ui/charts app/ui/charts.css app/ui/components test/unit`. Message: `feat(charts): the empty text, the loading card, the summary slot and the tile's source`.

### Task 5: In-flight sharing in the subrequest cache

**Files:**
- Modify: `app/server/cache-class.ts`. E2's `SubrequestOptions` (the options of `SubrequestCache.json`) gains `shareInFlight?: boolean`.
- Modify: `app/server/edge-cache.ts` (`createSubrequestCache`).
- Test: `test/worker/edge-cache.spec.ts`.

**Interfaces:**
- Consumes, from the E2 plan: `SubrequestOptions` with `holdFailure`, and the failure hold.
- Produces: `SubrequestOptions.shareInFlight?: boolean`. When it is set, a load of a key that another request in this Worker instance is already loading waits for that load. It gets the same value, as its own copy, or the same error, and starts no fetch. The flight is per instance and in memory, and it is removed when it settles.

- [ ] **Step 1: Write the failing tests** (`edge-cache.spec.ts`, each on a key of its own).
  - "two concurrent loads of one key with shareInFlight call load once and get equal values that are not the same object";
  - "a load that throws rejects both callers with the same UpstreamError, stores nothing, and the next call loads again";
  - "a settled flight is gone: a later call reads the stored entry without calling load";
  - "without shareInFlight two concurrent loads call load twice";
  - "a held failure (holdFailure) is thrown on a miss without joining a flight or loading";
  - "a stored answer is served during a hold, with shareInFlight set too": store the key, make a later load of it fail so the failure is held, and a call with `{ holdFailure: true, shareInFlight: true }` still returns the stored answer without calling load;
  - "keys that differ by their TTL override or build id do not share".
- [ ] **Step 2: Run them and see them fail.** `pnpm test test/worker/edge-cache` calls load twice in the shared cases.
- [ ] **Step 3: Implement.**
  - Keep a module-level `Map<string, Promise<string>>` keyed by the build id and the key, built on the pattern of the page `flights` in the same file.
  - The order is:
    1. the Cache API match: a stored answer is returned at once;
    2. E2's held-failure check;
    3. join the flight of this key if there is one, else start one.
  - The flight covers only the load and the write, and resolves to the JSON text. Each caller returns `JSON.parse` of it, which gives each its own copy, as page flights give copies. A flight is deleted on settle only if it is still the one in the map.
- [ ] **Step 4: Run them and see them pass.** Run the same command, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/server/cache-class.ts app/server/edge-cache.ts test/worker/edge-cache.spec.ts`. Message: `feat(cache): a subrequest load may be shared with the same load in flight`.

### Task 6: The analytics answer types and their checks

**Files:**
- Modify: `app/server/api-types.ts`.
- Create: `app/server/analytics-shape.ts`, `app/server/analytics-shape.test.ts`.
- Modify: `tsconfig.node.json`. `include` gains `app/domain/analytics-params.ts`, and `app/domain/window.ts` unless E2 already added it, because `api-types.ts` imports `AnalyticsUnit`.

**Interfaces:**
- Consumes: `AnalyticsUnit` (Task 2), `Page` (`api-types.ts`), `UpstreamError` (`upstream.ts`), `isValidClassicAddress` (`ripple-address-codec`).
- Produces. These shapes are D2 §5 and §6.1. **The pinned reference wins** wherever it differs; record each difference in the commit message.

```ts
// app/server/api-types.ts
export type ChangeType = "transaction_cost" | "payment_destination" | "payment_source" | "exchange" | "intermediary"
  | "escrow_create" | "escrow_finish" | "escrow_cancel" | "paychannel_fund" | "paychannel_payout";
export interface AccountValueRow { date: string; account_value: string; balance_change_count: number }
export interface AccountTxStatsRow { date: string; transaction_count: number; result: Record<string, number>; type: Record<string, number> }
// stats/{family} answers are Page<"rows", AccountValueRow> and Page<"rows", AccountTxStatsRow>
export interface AnalyticsBalanceLine { currency: string; counterparty?: string; balance: string }
export interface AnalyticsBalanceRow { date: string; currency: string; counterparty?: string; balance: string }
export interface AnalyticsBalances { result: "success"; start: string; end: string; interval: AnalyticsUnit; lines_total: number;
  lines: AnalyticsBalanceLine[]; count: number; rows: AnalyticsBalanceRow[] }
export interface BalanceChangeTotal { change_type?: string; count: number; in_value: string; out_value: string; net_value: string }
export interface BalanceChangeBucket { date: string; change_type?: string; count: number; in_value: string; out_value: string }
export interface AnalyticsBalanceChanges { result: "success"; start: string; end: string; interval: AnalyticsUnit;
  totals: BalanceChangeTotal[]; count: number; rows: BalanceChangeBucket[] }
export interface AnalyticsCounterparty { account: string; sent_value: string; received_value: string; total_value: string;
  payments_sent: number; payments_received: number; first: string; last: string }
export interface AnalyticsCounterparties { result: "success"; start: string; end: string; sort: "value" | "count"; total: number;
  count: number; counterparties: AnalyticsCounterparty[] }
export interface AnalyticsPair { base_currency: string; base_issuer?: string; counter_currency: string; counter_issuer?: string;
  count: number; base_volume: string; counter_volume: string; bought: string; sold: string; bought_counter: string;
  sold_counter: string; native_volume?: string }
export interface AnalyticsExchanges { result: "success"; start: string; end: string; total: number; count: number; pairs: AnalyticsPair[] }

// app/server/analytics-shape.ts: each returns the answer or throws UpstreamError("server", `${what} answered …`, { status: 200 })
export function checkAccountStats(body: unknown, family: "value" | "transactions", interval: AnalyticsUnit, what: string): Page<"rows", AccountValueRow> | Page<"rows", AccountTxStatsRow>;
export function checkAnalyticsBalances(body: unknown, interval: AnalyticsUnit, what: string): AnalyticsBalances;
export function checkBalanceChanges(body: unknown, interval: AnalyticsUnit, what: string): AnalyticsBalanceChanges;
export function checkCounterparties(body: unknown, what: string): AnalyticsCounterparties;
export function checkAnalyticsExchanges(body: unknown, what: string): AnalyticsExchanges;
```

- [ ] **Step 1: Pin the reference.**
  - With `D=/Users/golobitch/github.com/GateHubNet/data-api-new/.worktrees/explorer-data`, run `git -C $D log -1 --format=%H feat/explorer-data -- docs/api-reference.md`. That commit is REF: the last one that changed the reference.
  - `git -C $D show REF:docs/api-reference.md` must document `analytics/balances`, `balance_changes`, `counterparties`, `exchanges` and `interval` on `stats/{family}`. If it does not, stop and report that D2 is not built.
  - Never check that branch out. REF is recorded in this task's commit message, and in `test/fixtures/PROVENANCE.md` with Task 8's `ANALYTICS_REFERENCE_COMMIT`.
- [ ] **Step 2: Write the failing test** (`analytics-shape.test.ts`).
  - Accepted: D2 §5's examples, with full addresses (`rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq`, `rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh`), and an empty answer of each route (as D2 answers an unknown address).
  - Each of these throws kind `server`:
    - a `week` row dated `2026-10-14T00:00:00Z` (a Wednesday);
    - a `month` row dated `2026-10-02T00:00:00Z`;
    - a row dated `2026-10-12T05:00:00Z`;
    - `interval: "day"` echoed when `week` was asked;
    - an `analytics/balances` answer without `interval`;
    - `stats/value` with a `marker`;
    - `bought: 1500` (a number) and `in_value: "1e3"`;
    - `count: 1.5`;
    - `counterparties[0].account: "rBad"`, and an X-address;
    - `base_issuer` that is not a classic address;
    - a currency `"USDX"` (neither 3 characters nor 40 hex digits);
    - `rows: {}`.
- [ ] **Step 3: Run it and see it fail.** `pnpm test app/server/analytics-shape` fails because the module is missing.
- [ ] **Step 4: Implement** the types and the checks of §2.8:
  - lists are lists;
  - row dates match `^\d{4}-\d{2}-\d{2}T00:00:00Z$` and start an interval (a Monday for `week`, the 1st for `month`);
  - the echoed `interval` equals the one asked for, on `balances` and on `balance_changes` with an interval;
  - amounts and values match `^-?\d+(\.\d+)?$`, and counts are safe non-negative integers;
  - accounts, line counterparties and pair issuers pass `isValidClassicAddress`;
  - currencies are 3 characters (`^.{3}$`) or 40 hex digits;
  - `stats` has no `marker`.
- [ ] **Step 5: Run it and see it pass.** Run the same command, then `pnpm verify`.
- [ ] **Step 6: Commit.** `git add app/server/api-types.ts app/server/analytics-shape.ts app/server/analytics-shape.test.ts tsconfig.node.json`. Message: `feat(analytics): the answer types of D2's routes and the checks run before they are kept`. The body names REF and any differences from the D2 spec.

### Task 7: The data API client's analytics calls

**Files:**
- Modify: `app/server/upstream.ts` (`export const ANALYTICS_SLOW_TIMEOUT_MS = 15_000`).
- Modify: `app/server/pending-paths.ts`. E2's `PENDING_PATHS` gains four entries: `/v2/accounts/{address}/analytics/balances`, `…/balance_changes`, `…/counterparties` and `…/exchanges`.
- Modify: `app/server/data-api.ts`:
  - `PATHS.accountStats = "/v2/accounts/{address}/stats/{family}"`;
  - `get`'s options object and `fetchJson` gain `timeoutMs`;
  - the `DataApi` methods.
- Modify: `test/support/subrequest-cache.ts`. The recording cache's `CacheCall` gains `shareInFlight?: true` and records it.
- Test: `test/worker/data-api.spec.ts`. E2's `test/unit/pending-paths.test.ts` covers the new entries as they are.

**Interfaces:**
- Consumes:
  - Tasks 5 and 6;
  - from the E2 plan: `get()`'s options object (`finish` already runs on the whole body when there is no `unwrap`), `SubrequestOptions` with `holdFailure`, `PENDING_PATHS`, the "Cannot GET" rule, and the recording cache's `CacheCall`;
  - from the E3 plan: the class `minute`.
- Produces:
  - `get`'s options gain `timeoutMs` (default `DATA_API_TIMEOUT_MS`), which `fetchJson` passes to `withDeadline`. `get` passes `holdFailure` and `shareInFlight` to `cache.json` as `SubrequestOptions`;
  - `CacheCall.shareInFlight?: true`;
  - the five `DataApi` methods. Each uses class `"minute"`, `holdFailure: true`, `shareInFlight: true`, and its Task 6 check as `finish`:

```ts
accountStats(address: string, family: "value", q: { interval: AnalyticsUnit; limit: number; start: string }): Promise<Page<"rows", AccountValueRow>>;
accountStats(address: string, family: "transactions", q: { interval: AnalyticsUnit; limit: number; start: string }): Promise<Page<"rows", AccountTxStatsRow>>;
analyticsBalances(address: string, q: { interval: AnalyticsUnit; limit: number; start: string }): Promise<AnalyticsBalances>;
analyticsBalanceChanges(address: string, q: { interval: AnalyticsUnit; start: string }): Promise<AnalyticsBalanceChanges>;
analyticsCounterparties(address: string, q: { limit: number; start: string }): Promise<AnalyticsCounterparties>;   // timeoutMs ANALYTICS_SLOW_TIMEOUT_MS
analyticsExchanges(address: string, q: { limit: number; start: string }): Promise<AnalyticsExchanges>;
```

- [ ] **Step 1: Write the failing tests.**
  - URLs: each method requests its path with its query in the order shown (`interval`, `limit`, `start`). For example, `accountStats(A, "value", { interval: "day", limit: 1000, start: "2026-09-18" })` asks for `/v2/accounts/A/stats/value?interval=day&limit=1000&start=2026-09-18`.
  - The recording cache (`test/support/subrequest-cache.ts`) records `{ cls: "minute", holdFailure: true, shareInFlight: true }` for every method. In the "really stores" test, each answer is put with `public, max-age=60`.
  - Fake timers: `analyticsCounterparties` has not settled at 14,999 ms and is kind `timeout` at 15,000 ms. `analyticsBalanceChanges` is kind `timeout` at 5,000 ms.
  - A 404 `Cannot GET /v2/accounts/A/analytics/balances` is kind `server`, and a 200 with a daily row under `week` is kind `server`. Neither is stored.
- [ ] **Step 2: Run them and see them fail.** `pnpm test test/worker/data-api` fails on the missing methods.
- [ ] **Step 3: Implement** the methods, the `timeoutMs` option, the recording of `shareInFlight` and the constant.
- [ ] **Step 4: Run them and see them pass.** Run the same command, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/server/upstream.ts app/server/pending-paths.ts app/server/data-api.ts test/support/subrequest-cache.ts test/worker/data-api.spec.ts`. Message: `feat(analytics): the data API client's stats and analytics calls, kept a minute, the counterparties given 15 s`.

### Task 8: Synthetic analytics fixtures

**Files:**
- Create: `scripts/analytics-fixtures.ts`, `test/unit/analytics-fixtures.test.ts`.
- Create: the generated files under `test/fixtures/http/{xrpl,xahau}/data-api/accounts/<address>/stats/` and `…/analytics/`.
- Modify: `scripts/http-fixtures.ts`:
  - `generate()` adds what `analyticsFixtures` returns, for each network;
  - `isHandWritten` returns false for `accounts/<a>/stats/` and `accounts/<a>/analytics/`. It keeps every clause it has, including E3's `^(xrpl|xahau)/node/book_offers/`;
  - `accountListHashes` skips directories, because today it would `readFileSync` the new `stats`/`analytics` directories.
- Modify: `test/fixtures/PROVENANCE.md`. E2's "Synthetic aggregates" section gains the files, the generator, its seeds (`seedOf` of network, account and endpoint), and REF, the commit Task 6 pinned with `git -C $D log -1 --format=%H feat/explorer-data -- docs/api-reference.md`.
- Modify: README "Upstream fixtures" (the rows, marked "generator (synthetic)").
- Modify: `tsconfig.node.json`, adding `app/server/analytics-shape.ts` and `app/server/upstream.ts`, which the test imports.

**Interfaces:**
- Consumes: `analyticsWindow` (Task 2); the types, the checks and REF (Task 6); `dataApiFile`, `fixtureText` and `generate()`; from the E2 plan, `mulberry32` and `seedOf` (`scripts/synthetic.ts`) and the synthetic conventions of `scripts/network-fixtures.ts`; from the E3 plan, `isHandWritten`'s `node/book_offers/` clause.
- Produces:
  - `analyticsFixtures(net: NetworkName, T: string): Array<{ path: string; query: string; body: unknown }>`;
  - `export const ANALYTICS_REFERENCE_COMMIT = "<REF of Task 6>"`;
  - the files. Per network that is the active and the deleted account × 4 periods × 6 endpoints, plus the never-funded address's 4 × 6 empty answers: 72 files.
  - For the XRPL active account the names are `stats/value@interval=day&limit=1000&start=2026-09-18.json` … and `analytics/exchanges@limit=6&start=2025-07-01.json`. All's `start` is the inception month: XRPL active `2025-07-01`, XRPL deleted `2024-08-01`, Xahau active `2026-08-01`, Xahau deleted `2026-07-01`, never-funded T's month `2026-10-01`.

- [ ] **Step 1: Write the failing test** (`analytics-fixtures.test.ts`).
  - Each file passes its Task 6 check with its interval.
  - `balance_changes`: each total is the sum of that type's rows, and `net_value` is `in_value − out_value`.
  - `stats/value` has a row for every bucket from the first one that has a balance.
  - `stats/transactions`: the `result` counts add up to the `type` counts, which add up to `transaction_count`.
  - `lines` have the native line first. Counterparties are sorted by `total_value`, then by account, and `total` ≥ `count`. Pairs are sorted by `native_volume`.
  - Every amount and value is a plain decimal.
  - The four periods agree: a 30d file's daily values equal the matching days of the 90d file.
  - Anchors are read from the hand-written files, not hard-coded:
    - XRPL active: the native line's last balance is `account_info`'s balance in whole units (`10.001625`), and the LIONS line ends at `balances.json`'s `48329.908117603`. Xahau: `9351.039221` and EVR `28437367.3675102`;
    - each deleted account's native line is `"0"` from the bucket of its deletion on (2026-10-15: XRPL's recorded AccountDelete, and Xahau's newest recorded transaction), and non-zero before it;
    - the never-funded answers are empty (`rows: []`, `lines: []`, `totals: []`, `counterparties: []`, `pairs: []`, totals 0) for every period;
  - The XRPL active account has a failed transaction in at least one of the 30 daily buckets. Each network has at least one pair that natural orientation inverts: XRPL `USD.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq`/XRP, and Xahau a `USD.r…`/XAH pair.
  - `pnpm fixtures:check` (through `scripts/http-fixtures.test.ts`) reports nothing missing or stale.
- [ ] **Step 2: Run it and see it fail.** `pnpm test test/unit/analytics-fixtures scripts/http-fixtures` fails because the files are missing.
- [ ] **Step 3: Implement** the generator by the rules of §7.5, with `mulberry32(seedOf(network, account, endpoint))` from `scripts/synthetic.ts`.
  - Make one daily history per account and endpoint, then cut it to each window and bucket it by the interval with `bignumber.js`. That keeps the periods consistent.
  - Each bucket's `transaction_cost` count equals that bucket's `transaction_count`. Counterparty and pair accounts are made with `encodeAccountID` from seeded bytes.
  - The answers' `start` and `end` are the window widened to whole buckets, with `end` exclusive.
  - Write the files with `fixtureText`, then run `pnpm fixtures:sync` and commit what it writes.
- [ ] **Step 4: Run it and see it pass.** Run the same command, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add scripts/analytics-fixtures.ts scripts/http-fixtures.ts test/unit/analytics-fixtures.test.ts test/fixtures/http test/fixtures/PROVENANCE.md README.md tsconfig.node.json`. Message: `test(fixtures): synthetic analytics answers, anchored to the account fixtures`.

### Task 9: View builders: the frame, the account value and the transactions sent

**Files:**
- Create: `app/server/analytics-view.ts`, `app/server/analytics-view.test.ts`.

**Interfaces:**
- Consumes: Tasks 2, 3, 4 and 6; from the E2 plan, `bucketLabel` (`labels.ts`), `compactNumber`, `niceScale` (`geometry.ts`), `typeGroups`, `groupCounts`, `typeGroupsNote` and `tokenOf` (`app/domain/fnv.ts`); from the E3 plan, `formatChange`.
- Produces:

```ts
export type CardState<T> = ({ state: "ok" } & T) | { state: "failed" } | { state: "late" };
export interface AnalyticsTile {
  figure: string;                // "16,787.15 XRP"; "—" when empty or deleted
  sub: string | null;            // "3 failed, fee still paid", "Deleted accounts hold nothing"
  delta: { text: string; direction: "up" | "down" | "flat"; words: string } | null;   // "+4.2%", "over the last 30 days"; handed to E2's StatTile delta
  source: string;                // "/v2/accounts/{a}/stats/value?interval=day", with the view's interval
}
export interface AnalyticsFrame {
  period: AnalyticsPeriod;
  axis: TimeAxis;                // { unit: AnalyticsUnit, buckets }
  start: string;                 // S
  phrase: AnalyticsPhrases;
  note: string;                  // the whole period note (§2.2)
  deleted: boolean;
}
export interface ValueCard { tile: AnalyticsTile; chart: TimeSeriesData; notes: string[]; source: string }
export interface SentCard { tile: AnalyticsTile; chart: TimeSeriesData; notes: string[]; source: string }
export function analyticsFrame(window: AnalyticsWindow, opts: { deleted: boolean }): AnalyticsFrame;
export function valueCard(frame: AnalyticsFrame, page: Page<"rows", AccountValueRow>, native: Native): ValueCard;
export function sentCard(frame: AnalyticsFrame, page: Page<"rows", AccountTxStatsRow>, network: NetworkId): SentCard;
```

  `Native` comes from `app/domain/parse/types` and `NetworkId` from `app/server/networks`. Every builder aligns rows to `frame.axis.buckets` by date (`row.date.slice(0, 10)`) and ignores rows outside the frame. Every chart has `forming: true` and a `token`.

- [ ] **Step 1: Write the failing tests.**
  - Frame notes for T `2026-10-17`. Every note ends with the running sentence ("The last day is counted up to now.", or week, or month):

    | Window | `note` |
    |---|---|
    | 30d | "The 30 days from Sep 18 to Oct 17, 2026 (UTC), per day. The last day is counted up to now." |
    | 90d with T `2027-01-15` | "The 90 days from Oct 18, 2026 to Jan 15, 2027 (UTC), per day. …" |
    | 1y | "The 52 weeks from Oct 20, 2025 to the week of Oct 12, 2026 (UTC, weeks from Monday), per week. The last week is counted up to now." |
    | All, activation | "Since Jul 2025, the month it was activated, per month (UTC). The last month is counted up to now." |
    | All, oldest (2 buckets) | "Since Sep 2026, the month of its oldest transaction in the index, per month (UTC). The last month is counted up to now. It is younger than three months; 30 days and 90 days show it per day." |
    | All, none | "This month (UTC): the index has no transaction of this account yet. The last month is counted up to now. It is younger than three months; 30 days and 90 days show it per day." |
    | `deleted: true` | adds "This account was deleted; All covers its whole history." before the young sentence |

    `phrase.title` for All is "since Jul 2025".
  - Alignment: a row dated `2026-10-18T00:00:00Z` (the API's day after T) and one before S are ignored.
  - `valueCard`, 30d:
    - rows from `16110` on Sep 18 to `16787.15` on Oct 17: `tile.figure` "16,787.15 XRP", `delta` `{ text: "+4.2%", direction: "up", words: "over the last 30 days" }`, source `/v2/accounts/{a}/stats/value?interval=day`;
    - rows starting Oct 9: delta words "since Oct 9", plus the note "No value before Oct 9: the account had no balance until then.", with the leading buckets `null`;
    - values from 12,100 to 15,100: `domain.min` `"12000"` and the note "The axis starts at 12,000 XRP.". Values from 500 to 3,500 have no domain and no sentence, and neither do all-equal values;
    - extras `change`: `16000` → `16067.2` reads `"+0.42%"`, and the first bucket and a zero base are `null`;
    - no rows: tile "—" without a delta, and `chart.emptyText` "No balance in these 30 days";
    - `deleted`: figure "—" and sub "Deleted accounts hold nothing";
    - the first note is "XRP plus every token held, valued at the end of each day.".
  - `sentCard`:
    - XRPL row `{ transaction_count: 12, result: { tesSUCCESS: 11, tecPATH_DRY: 1 }, type: { Payment: 7, OfferCreate: 4, AMMDeposit: 1 } }` on Oct 16: series in `typeGroups("xrpl")` order with Payment `"7"`, OfferCreate `"4"`, OfferCancel `"0"`, TrustSet `"0"`, AMM `"1"`, Other `"0"`; `totals` `"12"`; extras `failed` `"1"`; an annotation `{ symbol: "×" }` at that bucket; other buckets `"0"`; tile "12" with sub "1 failed, fee still paid";
    - Xahau `{ Payment: 5, Invoke: 2, ClaimReward: 1, URITokenMint: 3, SetHook: 1, OfferCreate: 2 }`: Payment 5, Invoke 2, ClaimReward 1, URIToken 3, SetHook 1, Other 2;
    - no rows in the frame: every bucket `null`, `emptyText` "No transactions sent in these 30 days", tile "0" with sub "none failed";
    - the notes are "Transactions this account sent; a failed one still paid its fee." and `typeGroupsNote(network)`.
  - Tokens (`tokenOf` over what is drawn, extras included): building twice from the same data gives the same token, and changing one value or one extra changes it.
  - No float: every value field of every chart, extra and tile matches the decimal pattern or is fixed text.
- [ ] **Step 2: Run them and see them fail.** `pnpm test app/server/analytics-view` fails because the module is missing.
- [ ] **Step 3: Implement the builders.**
  - Month and day labels come from E2's `bucketLabel`. The start shows its year only when it differs from the end's.
  - The delta is (last ÷ base − 1) × 100, half up to 1 decimal, with "+" or U+2212. Its `words` are:
    - "over the " plus `phrase.title` for `30d`, `90d` and `1y`;
    - `phrase.title` itself for `all` ("since Jul 2025");
    - "since {bucketLabel of the base row}" whenever the base is not the first bucket.
  - The domain floor is ⌊min ÷ step⌋ × step in `bignumber.js`, where the step is the step `niceScale` gives for a span of (max − min) ÷ 3, converted back with `BigNumber(String(step))`.
- [ ] **Step 4: Run them and see them pass.** Run the same command, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/server/analytics-view.ts app/server/analytics-view.test.ts`. Message: `feat(analytics): the frame and its period note, the account value and the transactions sent`.

### Task 10: View builders: money in and out, where changes come from, counterparties, balances, DEX

**Files:**
- Modify: `app/server/analytics-view.ts`, `app/server/analytics-view.test.ts`.

**Interfaces:**
- Consumes: Task 9; from the E3 plan, `naturalOrientation(a, b, native)` (it returns `{ base, counter, inverted }`) and `marketHref(net, base, counter)`; from the E2 plan, `Network.hasAmm` and `features`.
- Produces:

```ts
export interface DexWording { hint: string; lead: string | null }
export interface SourceRow { id: "fees" | "dex" | "in" | "out" | "through" | "escrow" | "channels" | "other"; name: string; hint: string;
  in: string; out: string; net: string; changes: string; bar: { in: string; out: string } | null }   // bar: raw decimals; null with no change
export interface ChangesCard {
  tile: AnalyticsTile;                                          // tile 3, Fees paid
  money: { chart: TimeSeriesData; summary: { received: string; sent: string; net: string } | null; notes: string[]; source: string };
  sources: { title: string; rows: SourceRow[]; max: string; empty: string | null; note: string; source: string };
}
export interface CounterpartiesCard { tile: AnalyticsTile; rows: { account: string; sent: string; received: string; payments: string }[];
  note: string | null; empty: string | null; source: string }
export interface BalancesCard { chart: SmallMultiplesData | null; notes: string[]; empty: string | null; source: string }
export interface PairRow { id: string; label: string; issued: string[]; href: string | null; volume: string; trades: string; bought: string; sold: string }
export interface PairsCard { rows: PairRow[]; notes: string[]; empty: string | null; source: string }
export interface AnalyticsData {
  period: AnalyticsPeriod;
  frame: Promise<CardState<AnalyticsFrame>>;
  value: Promise<CardState<ValueCard>>; sent: Promise<CardState<SentCard>>; changes: Promise<CardState<ChangesCard>>;
  counterparties: Promise<CardState<CounterpartiesCard>>; balances: Promise<CardState<BalancesCard>>; pairs: Promise<CardState<PairsCard>>;
}
export function dexWording(network: Pick<Network, "hasAmm" | "features">): DexWording;
export function changesCard(frame: AnalyticsFrame, answer: AnalyticsBalanceChanges, native: Native, dex: DexWording): ChangesCard;
export function counterpartiesCard(frame: AnalyticsFrame, answer: AnalyticsCounterparties): CounterpartiesCard;
export function balancesCard(frame: AnalyticsFrame, answer: AnalyticsBalances): BalancesCard;
export function pairsCard(frame: AnalyticsFrame, answer: AnalyticsExchanges, ctx: { net: NetworkId; native: Native; markets: boolean; dex: DexWording }): PairsCard;
```

- [ ] **Step 1: Write the failing tests.**
  - `dexWording`:

    | Network | `hint` | `lead` |
    |---|---|---|
    | XRPL, `ammData` on | "order book and AMM" | "Includes swaps against AMM pools." |
    | XRPL, `ammData` off | "on the DEX" | `null` |
    | Xahau, with the switch either way | "order book" | "Order-book trades only; Xahau has no AMM." |
  - `changesCard`, the money part. Oct 16 has these rows: `payment_destination` in 45100; `exchange` in 100 and out 38100; `transaction_cost` out 0.000144; `intermediary` in 500 and out 500; and an unclassified row with in 0 and out 0.
    - Received is `"45200"` and Sent `"38100"`. The fee and pass-through rows are left out.
    - The Net extra is `"+7,100"`, and the summary is `{ received: "+45.2K", sent: "−38.1K", net: "+7,100" }`.
    - The other buckets are `"0"`. A frame with no counted row has every value `null`, `emptyText` "No money in or out in these 30 days" and summary `null`.
    - The note is "Payments, DEX trades, escrow, channels and other transactions that changed this account's balances, valued in XRP at each day's rate. Fees, and amounts that only passed through, are left out."
  - `changesCard`, the sources part. The totals are:
    - `transaction_cost` 63 / "0" / "0.000756" / "-0.000756";
    - `payment_destination` 14 / "9840" / "0" / "9840";
    - `escrow_create` 1 / "0" / "500" / "-500";
    - `escrow_finish` 1 / "500" / "0" / "500";
    - `paychannel_fund` 1 / "0" / "20" / "-20";
    - an unclassified total 2 / "120" / "300" / "-180";
    - `future_type` 1 / "1" / "0" / "1".

    They give these rows:

    | Row | In | Out | Net | Changes |
    |---|---|---|---|---|
    | Fees | 0 | 0.000756 | −0.000756 | 63 |
    | DEX trades | 0 | 0 | 0 | 0, `bar` null |
    | Payments in | 9,840 | 0 | +9,840 | 14 |
    | Payments out | 0s | | | `bar` null |
    | Passed through | 0s | | | `bar` null |
    | Escrow | 500 | 500 | 0 | 2 |
    | Payment channels | 0 | 20 | −20 | 1 |
    | Other | 121 | 300 | −179 | 3 |

    - The rows come in that order with the hints of §3.8. The DEX hint is `dex.hint`, and `max` is `"9840"`.
    - Without the two unknown totals, there is no Other row. Empty totals give `empty` "No balance changes in these 30 days.".
    - The title is "Where balance changes come from, last 30 days".
    - Tile 3 is "0.000756 XRP" with sub "756 drops, burned". Without a `transaction_cost` row it is "0 XRP" with sub "0 drops, burned".
  - `counterpartiesCard`:
    - `total: 14, count: 6` gives the note "The 6 largest of 14 counterparties, by value sent plus received.", and `total: 4, count: 4` gives "All 4 counterparties, largest first.";
    - `sent_value: "0"` is "—", and Payments is sent plus received ("9" + "3" is "12");
    - `total: 0` gives `empty` "No payments in these 30 days.";
    - tile 4 is "14" with sub "accounts it paid or was paid by".
  - `balancesCard`: lines XRP `12480.256114`, USD `rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq` `3120.5` and a 40-hex `03AB…` line at `-5`, with `lines_total: 7`, give:
    - three panels, labelled "XRP" (no sublabel), "USD" (sublabel `rhub8V…3wq`) and "LP token", each with format `{ kind: "amount", unit: label }`, and `null` before a line's first row;
    - the notes "Each currency on its own scale, from zero; hover or focus one to read all of them on the same day.", "The 3 largest of 7 balances: XRP first, then by value now." and "A balance below zero is what the account owes on that line.";
    - no lines gives `chart: null` with `empty` "No balances in these 30 days".
  - `pairsCard`, XRPL, `markets: true`:
    - D2 pair USD `rhub8V…`/XRP with `bought 1500`, `sold 2000`, `bought_counter 3610`, `sold_counter 4810` and `native_volume 8420` gives label "XRP/USD", issued `["USD rhub8V…3wq"]`, href `marketHref("xrpl", { currency: "XRP" }, { currency: "USD", issuer })`, Bought "4,810 XRP" (`sold_counter`) and Sold "3,610 XRP" (`bought_counter`), Volume "8,420";
    - pair LIONS (`4C494F4E53…`, `rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS`)/XRP keeps D2's order, with Bought "100 LIONS" and Sold "—" for `sold: "0"`;
    - `markets: false` gives `href: null`, and a missing `native_volume` gives Volume "—";
    - the notes are `[dex.lead?, "Bought and sold are of each pair's base as shown.", "The 6 largest of 9 pairs, by volume in XRP."]`, the last when `total > count`, and no pairs gives `empty` "No DEX trades in these 30 days.".
  - Tokens and no float, as in Task 9.
- [ ] **Step 2: Run them and see them fail.** `pnpm test app/server/analytics-view` fails on the missing exports.
- [ ] **Step 3: Implement** the builders. The orientation and the choice of field are made here, so the page draws strings only.
- [ ] **Step 4: Run them and see them pass.** Run the same command, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/server/analytics-view.ts app/server/analytics-view.test.ts`. Message: `feat(analytics): money in and out, where changes come from, counterparties, balances and DEX trading`.

### Task 11: `AccountAnalytics` and `AnalyticsFilters`

**Files:**
- Create: `app/ui/pages/AccountAnalytics.tsx` (a default export, for `React.lazy`) and `app/ui/pages/AccountAnalytics.test.tsx`.
- Create: `app/ui/pages/AnalyticsFilters.tsx` and `app/ui/pages/AnalyticsFilters.test.tsx`.
- Modify: `app/ui/pages.css` and `test/unit/pages-css.test.ts`.
- Modify, only if `SegmentedLinks` has no per-link `rel`: `app/ui/components/SegmentedLinks.tsx`, as a growth step. Its item type gains `rel?: string`, with a test in that component's E2 test file.

**Interfaces:**
- Consumes:
  - Tasks 2, 3, 4, 9 and 10;
  - from the E2 plan: `ChartCard`, `ColumnChart`, `LineChart`, `SmallMultiples`, `InlineBar` (diverging), `StatTile` (figure and delta), `SegmentedLinks` (`app/ui/components/SegmentedLinks.tsx`) for the period links, `SectionError` with its `message?: ReactNode`, `DataTable` and `Card`;
  - from the E3 plan: `useRetry()`.
- Produces:
  - `export default function AccountAnalytics(props: { network: NetworkInfo; analytics: AnalyticsData }): JSX.Element`;
  - `export function AnalyticsFilters(props: { network: NetworkInfo; address: string; analytics: Pick<AnalyticsData, "period" | "frame"> }): JSX.Element`.

- [ ] **Step 1: Write the failing tests.** Render with `renderToString`, then hydrate inside a static router, as `AccountPage.test.tsx` does, with the `AnalyticsData` promises already settled.
  - The order:
    1. a `section[aria-label="Summary"]` with the tiles "Account value now", "Transactions sent", "Fees paid" and "Counterparties", each with its `source`;
    2. the cards "Account value, in XRP" (chart id `analytics-value`) and "Transactions sent per day, by type" (`analytics-sent`);
    3. "Balance history, per currency" (`analytics-balances`);
    4. "Money in and out per day, in XRP" (`analytics-money`), with the summary line between the legend and the plot;
    5. "Where balance changes come from, last 30 days" (a `DataTable` with `minWidth` 900);
    6. "Top counterparties, by value" (480) and "DEX trading, per pair" (520).
  - The units follow the frame: "per week" for `1y`, and "per month" with month labels for `all`.
  - States, for each card:
    - pending: busy tiles, `ChartCard state="loading"`, and table frames of 8, 6 and 6 rows with an `aria-hidden` "Loading…";
    - `failed`: tiles "—" over "Couldn't load", and the card's `SectionError` "Couldn't load the account value." (the `what` of each card per §3.4–3.10) in place of the views and the toggle;
    - `late`: "—" over "Still working on it", and `SectionError` with `message` "Still working on the counterparties. Retry in a few seconds.".
  - The frame: `failed` gives exactly one `role="alert"` "Couldn't load the analytics." and no tiles. `late` gives `SectionError` with `message` "Still working on the analytics. Retry in a few seconds." and Retry.
  - A deleted account's tile 1 reads "—" over "Deleted accounts hold nothing".
  - Pairs: an `href` gives a link, and `null` gives plain text. All three DEX wordings come from the data.
  - "Oct 17, 2026, so far" appears in the value table's newest row.
  - Retry calls `revalidate` (mocked `useRevalidator`).
  - The server HTML holds the marks and the tables, and hydration logs no mismatch (a `console.error` spy).
  - Re-rendering with another `period` remounts the body: a Table radio that was checked is back on Chart.
  - `AnalyticsFilters`:
    - `role="group"` named "Analytics filters";
    - "Period", then `SegmentedLinks` with the links "30 days" (`/xrpl/account/A?tab=analytics`), "90 days", "1 year" and "All", each with `rel="nofollow"`, and the current one `aria-current="true"`;
    - the note "Values in XRP: tokens at each day's DEX rate, and 0 without one" ("XAH" on Xahau);
    - one `role="status"` element reading "Loading analytics…" until the frame settles, then the frame's note; it is empty for a failed frame.
  - `pages-css.test.ts`:
    - the tile grid's `grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr))`;
    - the two-up rows' cards `flex: 1 1 480px` and `flex: 1 1 460px`;
    - the period links keep `SegmentedLinks`' 44 px target, and no analytics rule overrides it.
- [ ] **Step 2: Run them and see them fail.** `pnpm test app/ui/pages/AccountAnalytics app/ui/pages/AnalyticsFilters app/ui/components test/unit/pages-css` fails because the modules are missing.
- [ ] **Step 3: Implement.**
  - The frame is one `Suspense`/`Await`. Each card, with its tile, is a `Suspense`/`Await` on its promise. The changes promise feeds tile 3, the money card and the sources card.
  - The period links are `SegmentedLinks`, client-side navigations with `preventScrollReset` as on E2's network filters. Nothing here fetches, and nothing from `app/server` is imported as a value.
- [ ] **Step 4: Run them and see them pass.** Run the same command, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/ui/pages/AccountAnalytics.tsx app/ui/pages/AccountAnalytics.test.tsx app/ui/pages/AnalyticsFilters.tsx app/ui/pages/AnalyticsFilters.test.tsx app/ui/pages.css test/unit/pages-css.test.ts`, plus `app/ui/components/SegmentedLinks.tsx` and its test if `rel` was added there. Message: `feat(analytics): the analytics view and its filter row`.

### Task 12: The account page shell: the tab, the switch, the redirects, the lazy body

**Files:**
- Modify: `app/domain/account-tabs.ts` (`ACCOUNT_TABS` gains `"analytics"`; `export type ListTab = Exclude<AccountTab, "analytics">`).
- Modify: `app/server/account-view.ts`:
  - `TAB_WHAT` gains `analytics: "the analytics"`, and `failedList(tab: ListTab)`;
  - `AccountPageData` becomes the union below, and every account page's data carries `analyticsTab`.
- Modify: `app/ui/components/Tabs.tsx` (`TabItem` gains `rel?` and `onIntent?`).
- Modify: `app/ui/pages/AccountPage.tsx`: the `TAB_LABELS` entry, the tab bar from `data.analyticsTab`, the analytics layout with no Holdings margin, and the lazy body.
- Modify: `app/routes/net.account.$address.tsx`: `readList(…, tab: ListTab, …)`, `analyticsTab: network.features.accountAnalytics` on every page, and the analytics redirects.
- Create: `test/worker/account-analytics.spec.ts` (the redirects), `test/worker/account-analytics-off.spec.ts` (`worker-off`), and `test/unit/analytics-bundle.test.ts`.
- Modify:
  - `app/server/account-view.test.ts`: in the line-60 list, `"analytics"` is now a tab;
  - `app/ui/pages/AccountPage.test.tsx` and `app/ui/components/components.test.tsx` (the Tabs tests);
  - `test/worker/account.spec.ts`: the tab bar test gets a sixth link, and `"analytics"` leaves the unknown-tab `it.each`;
  - `test/e2e/account.spec.ts`: "Analytics is not a link" becomes "Analytics is a link".

**Interfaces:**
- Consumes: Tasks 1, 2 and 11, and E3's `LiveStateNotice`.
- Produces:

```ts
// app/server/account-view.ts
interface AccountPageBase { kind: "account"; address: string; native: Native; tag: number | null; qr: QrPicture; analyticsTab: boolean }
export interface AccountListPageData extends AccountPageBase { tab: ListTab; mode: "live" | "history"; header: AccountHeader | HistoryHeader; list: TabList | Promise<TabList> }
export interface AccountAnalyticsPageData extends AccountPageBase { tab: "analytics"; mode: "live"; header: AccountHeader; analytics: AnalyticsData }
export type AccountPageData = AccountListPageData | AccountAnalyticsPageData;
// app/ui/components/Tabs.tsx
export interface TabItem { id: string; label: string; href?: string; soon?: boolean; rel?: string; onIntent?: () => void }   // onIntent on pointerenter and focus
```

  The route's analytics branch runs after the X-address and address checks:
  - with `!network.features.accountAnalytics`, it answers `tidied("/{net}/account/{address}")`;
  - with `{ canonical }` from `parseAnalyticsQuery`, it answers `tidied(`${base}?${canonical}`)`;
  - **until Task 14**, the canonical URL also answers `tidied(base)`.

- [ ] **Step 1: Write the failing tests.**
  - `components.test.tsx`: a `TabItem` with `rel: "nofollow"` and `onIntent` renders `rel="nofollow"`, and `pointerenter` and `focus` each call `onIntent` once.
  - `AccountPage.test.tsx`:
    - with `analyticsTab: true` the tab bar has six links, and Analytics is `/xrpl/account/A?tab=analytics` with `rel="nofollow"`. It is `aria-current="page"` on the analytics page, and a history-mode page links to `?tab=analytics` too;
    - with `false`, Analytics is the "soon" label;
    - the analytics page has no `aside[aria-label="Holdings"]`, shows `AnalyticsFilters` under the tabs, and renders the lazy body inside `Suspense` with an `aria-hidden` fallback.
  - `account-analytics.spec.ts`, which makes no upstream calls (`mock.requests` is `[]`) and stores the redirects as `short`:
    - `?tab=analytics&period=30d` redirects to `?tab=analytics`, and `?period=90d&tab=analytics` to `?tab=analytics&period=90d`;
    - `?tab=analytics&marker=WzEwNzYxMjU3MywyNV0`, `&back=a`, `&tag=5`, `&in=usd`, `&x=1`, `&period=2y` and `&period=90d&period=1y` each redirect to their canonical form.
  - `account-analytics-off.spec.ts` (`worker-off`):
    - the transactions tab's nav has a "soon" Analytics and no `?tab=analytics` link;
    - `?tab=analytics` and `?tab=analytics&period=90d` give a 302 to `/xrpl/account/A`, class `short`, with no upstream call.
  - `analytics-bundle.test.ts`, with the `valueImports` scanner of `test/unit/account-bundle.test.ts` (import it from a shared test helper if E2's plan made one, else move it to `test/unit/value-imports.ts` and import it in both):
    - `AccountAnalytics.tsx`, `AnalyticsFilters.tsx` and `analytics-params.ts` import nothing from `app/server` as a value;
    - `AccountPage.tsx` has no static import of `./AccountAnalytics`, only `import("./AccountAnalytics")`.
- [ ] **Step 2: Run them and see them fail.** `pnpm test app/ui test/unit/analytics-bundle test/worker/account test/worker/account-analytics` fails on the missing link, the redirects and the off case.
- [ ] **Step 3: Implement.**
  - Use `const AccountAnalytics = lazy(() => import("./AccountAnalytics"))`. The tab's `onIntent` is `() => void import("./AccountAnalytics")`.
  - Key the lazy body by `analytics.period`.
  - The analytics layout has the notices, the breadcrumbs, `AccountCard`, then the Activity card at full width (tabs and `AnalyticsFilters`), then the body.
- [ ] **Step 4: Run them and see them pass.** Run the same command, then `pnpm verify` and `pnpm test:e2e` (`account.spec.ts`).
- [ ] **Step 5: Commit.** `git add app/domain/account-tabs.ts app/server/account-view.ts app/server/account-view.test.ts app/ui app/routes/net.account.\$address.tsx test/worker test/unit test/e2e/account.spec.ts`. Message: `feat(account): the Analytics tab follows its switch, its URL is canonical, its view loads lazily`.

### Task 13: The bundle gate of the analytics view

**Files:**
- Modify: `scripts/bundle-budget.ts`, `scripts/check-bundle.test.ts`, and README "The client bundle check" (the figures and the second gate).

**Interfaces:**
- Consumes: Task 12's lazy chunk, and `checkBundle`, `PAGES`, `BUDGET_BYTES` and `formatReport` (`scripts/bundle-budget.ts`).
- Produces: `export const ANALYTICS_VIEW = { name: "account analytics", from: "routes/net.account.$address", chunk: /import\(\s*["']\.\/(AccountAnalytics-[\w-]+\.js)["']\s*\)/ }`. The report gets a row named `account analytics`, whose files are the account route's first load plus the chunk and its relative static imports, followed transitively, each file once.

- [ ] **Step 1: Write the failing tests** (`check-bundle.test.ts`, over a fake build made as the existing budget-to-the-byte tests make one).
  - The account route's first-load file holds `import("./AccountAnalytics-abc.js")`. The chunk imports `./kit-1.js` and a file the route already loads. The row counts the shared file once.
  - A total of 150,000 B passes, and 150,001 B fails with "the account analytics view loads 150.0 KB of JavaScript, gzipped: over the budget of 150.0 KB".
  - The import names a file that is missing: a problem naming `assets/AccountAnalytics-abc.js`. No such `import()` at all: the problem "the account route has no import() of AccountAnalytics".
- [ ] **Step 2: Run them and see them fail.** `pnpm test scripts/check-bundle` fails because there is no row.
- [ ] **Step 3: Implement.** Find the dynamic import by the regex in the first-load files. Follow `from"./x.js"` and `import"./x.js"` in each followed file.
- [ ] **Step 4: Measure, and apply the rungs that are needed.**
  - Run `pnpm build && pnpm check:bundle`. Gate 1 is the account route ≤ 150,000 B (target 138,500 B), and gate 2 is the analytics view ≤ 150,000 B.
  - If gate 2 fails:
    1. Apply E2's decided fallback without asking, unless E2 already applied it: `Cursor` and the tooltip load with `import()` through E2's `CursorSlot`. Measure again.
    2. If gate 2 still fails, **stop and report BLOCKED**, with gate 1's and gate 2's measured bytes, the five largest files of the analytics view, and whether step 1 was applied here or by E2.

    §5's second rung (moving the five list panels of `AccountPage.tsx` into a lazy chunk) is not done in this plan. It changes `AccountPage.tsx`'s tests and the module that `When` and `whenOf` live in, which E5 imports, so it needs a decision of its own.
  - Record the figures, and whether the fallback was applied, in the README.
- [ ] **Step 5: Run the tests and see them pass.** Run `pnpm verify`.
- [ ] **Step 6: Commit.** `git add scripts/bundle-budget.ts scripts/check-bundle.test.ts README.md`, plus E2's kit files if step 4 applied the fallback. Message: `feat(bundle): the analytics view's total JavaScript is gated at 150 KB`.

### Task 14: The analytics loader

**Files:**
- Create: `app/server/analytics-load.ts`, `app/server/analytics-load.test.ts`.
- Modify: `app/server/account-view.ts` (`accountHeader(input, { holdings })`; `HeaderInput.objects` and `balances` become optional) and `app/server/account-view.test.ts`.
- Modify: `app/routes/net.account.$address.tsx`. The analytics branch replaces Task 12's placeholder.
- Modify: `test/worker/account-analytics.spec.ts`.
- Create: `test/worker/account-analytics-flight.spec.ts`.

**Interfaces:**
- Consumes: Tasks 2, 7, 9, 10 and 12, plus `existenceOf`, `loaded`, `markDegraded`, `getExecutionContext` and `logProblem`; from the E2 plan, `anchorOf`, `utcDayOf`, and `byDeadline`, `CARD_DEADLINE_MS` and `TooLate` (`app/server/deadline.ts`).
- Produces:

```ts
// app/server/account-view.ts
export function accountHeader(input: HeaderInput, opts?: { holdings: boolean }): { header: AccountHeader; problems: string[] };
// holdings false: no objects or balances read; owned null, tokens "none", neither adds a problem, the balance is the node's only.
// holdings true (the default): as today; a missing objects or balances is a programming error (throw).

// app/server/analytics-load.ts (Worker-only)
export interface AnalyticsInput {
  context: unknown;                       // the load context
  request: Request;
  api: DataApi;
  network: Network;
  address: string;
  period: AnalyticsPeriod;
  deadlineAt: number;                     // the loader's start + CARD_DEADLINE_MS, ms since the epoch
  account: Promise<AccountData>;          // call A, the header's one promise
  probe: () => Promise<Page<"transactions", TxObject>>;   // call P, memoised: the existence probe's promise and key (limit=1)
  deleted: Promise<boolean>;              // settles once the header knows the account's existence
  signal: AbortSignal;                    // aborted when the page turns out a 404 or a 503
}
export function loadAnalytics(input: AnalyticsInput): AnalyticsData;   // no promise in it rejects
```

  Behaviour (§2.3, §2.5–2.8):
  - **The window.** Call 0 is `api.lastValidated()`, and T is `utcDayOf(anchorOf(last).closeTime)`. For `all`, the first day comes from A's `inception`. If A is `not_found`, it comes from P's first row's `date` (`slice(0, 10)`). If P has none, there is no first day.
  - **Calls 1–6** start as soon as the window is known, with `frame.start` and the unit as `interval`, and do not wait for the header. A card is its call, then its builder over the frame (window plus `deleted`), raced against `deadlineAt`.
  - **Failures.** A card that fails becomes `failed`. Its log line is `"the analytics {card} of an account could not be loaded"`, and its mark is `"analytics {card} could not be loaded"`.
  - **Late cards.** A card that is late becomes `late`. Its log and mark say "took too long", and its call goes to `ctx.waitUntil` (its rejection caught).
  - **The frame.** Call 0 failing, or P failing for `all`, makes the frame `failed` with one log and one mark ("analytics frame …"). The cards then resolve `failed` without their own logs. A late frame hands the whole chain (the window, then calls 1–6) to `waitUntil`, and the cards resolve `late`.
  - **Abort.** On `signal` abort, the timers are cleared, nothing is handed to `waitUntil`, nothing is logged or marked, and pending cards resolve `late`. The fetches are not aborted, because another request may share them.

  The route's analytics branch:
  - It starts A, `node.accountInfo`, `node.serverState()`, the last-ledger lookup and `loadAnalytics` together. P is `once(() => api.accountTransactions(address, { limit: 1 }))`, shared with the existence probe.
  - It awaits the header. Never activated: abort, then the 404 page. Outage: abort, then `upstreamOutage`.
  - Then it calls `accountHeader(…, { holdings: false })` and resolves `deleted`. The header's `problems` are logged and mark the page degraded, as `firstPage` does: a node that did not answer gives "Live state unavailable", the analytics as usual, and an answer that is not stored.
  - It returns `cached({ …common, tab: "analytics", mode: "live", header, analytics, analyticsTab: true }, "live")`.
  - The branch makes no `balances` or `account_objects` call. The list tabs keep `holdings: true`.

- [ ] **Step 1: Write the failing tests.**
  - `account-view.test.ts`: `accountHeader` with `{ holdings: false }` and no `objects` or `balances` gives `owned: null`, `tokens: { state: "none" }` and no problems. With the node down the balance is `null`, which the page shows as "The balance could not be read.".
  - `analytics-load.test.ts` (unit, fake timers, a fake `DataApi`, `createLoadContext(env, ctx, mark)` with a recording `waitUntil`):
    - a call settled in time gives `ok` and no `waitUntil`;
    - a call settling after `deadlineAt` gives `late`, with `waitUntil` given that call and the mark "analytics balances took too long";
    - a rejected call gives `failed` with "analytics value could not be loaded";
    - call 0 rejected gives the frame `failed`, no call 1–6 made, and exactly one mark;
    - a late frame: the chain is given to `waitUntil` and calls 1–6 run after call 0 answers;
    - abort before the deadline gives no `waitUntil`, no mark, and pending cards `late`;
    - `all` with A ok does not call P, and A `not_found` calls P once and starts from P's month.
  - `account-analytics.spec.ts`. The failures come first, each on `account(n)` with its own overrides, plus the A and node answers that make it active:
    - **Failures.** Each of the six calls answers 500 in turn: the HTML holds that card's `SectionError` and its tiles' "Couldn't load", `Cache-Control: no-store`, and the page is not stored (`isStored`). Then `analytics/balance_changes` answers 429, `null` (the API's "Cannot GET"), a malformed 200, and, for `?period=1y`, a daily row: each gives the same outcome.
    - **Call 0.** `/v2/last_validated` at 500 gives one "Couldn't load the analytics." and no card error. This test goes first in the file.
    - **Deadline.** `analytics/balances` never answers: within 5 s the HTML says "Still working on the balance history. Retry in a few seconds.", and the page is not stored. This runs in real time.
    - **Background completion.** `analytics/counterparties` answers after 6 s. The first render's card is late. A render about 3 s later shows the card, and `statusesOf(mock, "GET /v2/accounts/…/analytics/counterparties?limit=6&start=…")` has one entry.
    - **Node down.** With the node's `account_info` overridden to fail, the HTML has "Live state unavailable" and every card. It is `no-store` and not stored.
    - **Calls.** For XRPL active and Xahau active in each period, `mock.requests` are exactly §2.3's calls with the starts of the Global Constraints (All: XRPL `2025-07-01`, Xahau `2026-08-01`), plus the header's `account_info`, `server_state` and last-ledger lookup, and none of `/balances`, `account_objects` or `amm_volume`. The deleted XRPL account, with A overridden to a 404 "Account not found" and P to a row dated `2024-08-12T10:02:43+00:00`, asks P once and starts All at `2024-08-01`.
    - **AMM wording.** Call the route's `loader` with `createLoadContext({ ...env, AMM_DATA: "off" }, ctx)` and then with `"on"`, and read the settled `pairs` and `changes`. They hold the XRPL wordings of §3.10, Xahau's wording holds either way, and no `amm_volume` call is made.
    - **Classes.** The page and its `.data` URL are stored as `live`. The six calls are put with `public, max-age=60` (spy on `caches.default.put` for subrequest keys).
    - **Streaming.** The first chunk holds the header and not "Account value now"'s figure. A Googlebot user agent gets every card.
  - `account-analytics-flight.spec.ts`, a file of its own for a fresh isolate:
    - two concurrent renders of `?tab=analytics&period=90d`, with counterparties delayed 1 s, make one upstream call;
    - a failing `analytics/balance_changes` (500) is called once across two renders within 5 s, and again after 5 s (fake `Date`).
- [ ] **Step 2: Run them and see them fail.** `pnpm test app/server/analytics-load app/server/account-view test/worker/account-analytics` fails, because the view is still the placeholder 302.
- [ ] **Step 3: Implement** `loadAnalytics`, the header option and the route branch.
  - The deadline helper in `analytics-load.ts` is built on E2's `byDeadline` and `TooLate`: each card and the frame go through `byDeadline` against `deadlineAt`, and a `TooLate` becomes `onLate()`, which gives `late` and the `waitUntil` hand-off.
  - The helper adds only the `onLate` mapping and the abort: on `signal`, it clears its timer and resolves `late` with no hand-off. It does not re-implement the race.
- [ ] **Step 4: Run them and see them pass.** Run the same command, then `pnpm verify` and `pnpm test:e2e`.
- [ ] **Step 5: Commit.** `git add app/server/analytics-load.ts app/server/analytics-load.test.ts app/server/account-view.ts app/server/account-view.test.ts app/routes/net.account.\$address.tsx test/worker/account-analytics.spec.ts test/worker/account-analytics-flight.spec.ts`. Message: `feat(analytics): the loader streams six cards against the list's deadline and finishes late calls in the background`.

### Task 15: Meta tags and `robots.txt`

**Files:**
- Modify: `app/server/meta.ts`. `AccountFacts` gains `analytics?: { period: AnalyticsPeriod }`, and `accountMeta` gets the analytics branch.
- Modify: `app/routes/robots[.]txt.ts` (`ROBOTS`).
- Test: `app/server/meta.test.ts`, `test/worker/meta.spec.ts`, `test/worker/layout.spec.ts`.

**Interfaces:**
- Consumes: `analyticsPhrases` (Task 2) and `AccountAnalyticsPageData` (Task 12). The route's `meta` already passes the loader data.
- Produces: the analytics branch of `accountMeta`, and `ROBOTS` with `Disallow: /*/account/*tab=analytics` after the CSV line.

- [ ] **Step 1: Write the failing tests.**
  - `meta.test.ts`:
    - for `30d`, the title is "Analytics · Account rBbW6i…W5jh · XRPL · explorer";
    - for `90d`, `1y` and `all`, it is "Analytics, last 90 days · Account …", "Analytics, last 52 weeks · …" and "Analytics, all time · …";
    - the description is "Account value, transactions sent, balances, money in and out, counterparties and DEX trading of rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh on XRPL.";
    - the robots tag is `noindex, follow`, with no `canonical`, `og:*` or `twitter:*`.
  - `meta.spec.ts`: the same on the real Worker for the XRPL active account's `?tab=analytics` and `?tab=analytics&period=1y`.
  - `layout.spec.ts`: `robots.txt` holds the line `Disallow: /*/account/*tab=analytics`.
- [ ] **Step 2: Run them and see them fail.** `pnpm test app/server/meta test/worker/meta test/worker/layout` fails.
- [ ] **Step 3: Implement** the branch and the rule.
- [ ] **Step 4: Run them and see them pass.** Run the same command, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/server/meta.ts app/server/meta.test.ts app/routes/robots\[.\]txt.ts test/worker/meta.spec.ts test/worker/layout.spec.ts`. Message: `feat(analytics): the views are noindex, follow and robots.txt keeps crawlers off them`.

### Task 16: End to end, accessibility, and the README

**Files:**
- Create: `test/e2e/account-analytics.spec.ts` and `test/e2e/account-analytics-live.spec.ts`. The second runs in the `live` project, because E2's `LIVE_SPECS` includes `**/*-live.spec.ts`; `playwright.config.ts` is not edited.
- Modify: `test/e2e/a11y.spec.ts` and `test/e2e/client-meta.spec.ts`.
- Modify: `README.md`:
  - a section "Account analytics" under "The account page", covering the switch and how it is rolled back (`"off"` and a deploy), the URL and its redirects, the calls and their classes, streaming, deadlines and the background completion, the 15 s call, in-flight sharing and the hold, the failures, SEO, the bundle gates and the fixtures;
  - the account row of "End-to-end tests";
  - the staging checklist's five items (§8).

**Interfaces:**
- Consumes: everything above; from the E2 plan, `E2E_FEATURES_OFF`; `contextFor` and the fixture control (`PUT …/__fixture/overrides`).
- Produces: none.

- [ ] **Step 1: Write the tests.**
  - `account-analytics.spec.ts`:
    - the Analytics tab is a link with `rel="nofollow"` and opens the view in one document;
    - the four tiles and seven cards render from the fixtures;
    - "90 days", "1 year" (week labels) and "All" (month labels) change the URL, keep the scroll position, and Back restores the view;
    - with every `/assets/*.js` aborted (`contextFor`), the streamed cards are visible and the Table radio swaps a view;
    - a pointer over "Transactions sent per day, by type" shows a tooltip with the date, the total and "failed";
    - Tab to a slider, then Arrow Left, changes its `aria-valuetext`;
    - the deleted account's tile 1 is "—" and the period note has "This account was deleted; All covers its whole history.";
    - the never-funded address is the 404 page;
    - the tests skip themselves when `E2E_FEATURES_OFF` lists `ACCOUNT_ANALYTICS`, and the off case runs instead (tab "soon", URL redirected);
    - against a real stack, the tests that read synthetic files skip, and one structural test runs everywhere: each card shows data, an empty state or its error.
  - `account-analytics-live.spec.ts`: with `stats/transactions` overridden to 503, the card says "Couldn't load the transactions sent". After the override is removed, Retry brings the card back after the 5 s hold.
  - `client-meta.spec.ts`: after a client-side navigation to the tab, `noindex` is there and the canonical is gone, and both return on Back.
  - `a11y.spec.ts`:
    - the XRPL active account's default analytics view at 1280 px and 375 px × the four theme settings;
    - in the two system themes: `?period=1y`, `?period=all`, the Xahau active account, the deleted account, a view with a failed card, every table view on, and a focused slider with its tooltip;
    - `landmark-unique` and the "needs review" test cover the view.
- [ ] **Step 2: Run them.** `pnpm test:e2e` passes. Fix the cause of any failure in the task that owns the code, not in the test.
- [ ] **Step 3: Write the README sections** under Files. The staging checklist gains:
  - the four periods of a heavy account against the staging stack;
  - the late-counterparties path (the card says "Still working …", and a Retry seconds later shows it);
  - in-flight sharing and the failure hold, seen in `wrangler tail`;
  - `robots.txt`;
  - gate 2's figures.
- [ ] **Step 4: Verify.** `pnpm verify` and `pnpm test:e2e` both exit 0.
- [ ] **Step 5: Commit.** `git add test/e2e README.md`. Message: `test(e2e): the analytics view in the browser, without scripts, with a failing card, and under axe`.
