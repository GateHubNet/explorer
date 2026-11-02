# Supply Page and Network Menu (E12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `/{net}/supply` (one snapshot of the native currency: total, burned, escrowed, circulating, AMM, reserves, and on Xahau minted, with burned and minted per day) behind the `SUPPLY` switch, and turn the header's "Network" link into the boards' Network disclosure menu (Overview, Validators, Amendments, Supply).

**Architecture:** The route's loader asks D7's snapshot, the newest ledger, the network page's 90-day fees call and, on a network that mints, D7's minted days, side by side; a pure view builder (`app/server/supply-view.ts`) turns them into exact strings; the page draws them with E2's kit, grown by a compact `ShareBar`, a `StatTile` aside and `finePercent`. The menu is a `<details>` disclosure in `Header.tsx` that works before hydration, with a small hook for Escape, outside pointers, focus leaving and navigation; routes name their menu item through a new `navPage` handle field.

**Tech Stack:** React Router 8.4 (framework mode) on Cloudflare Workers, React 19, TypeScript, `bignumber.js`, Vitest (`unit`, `components` with happy-dom, `worker`, `worker-off`), Playwright with axe.

**Spec:** `docs/superpowers/specs/2026-10-24-supply-page-design.md` (cited "spec §n", "decision n"; the plan argues from the spec, executors read both). Data: `DAPI/docs/superpowers/specs/2026-10-24-supply-design.md` (D7) and D7's built `docs/api-reference.md`.

**Branch:** `feat/explorer-pages-2` in `EXP = /Users/golobitch/github.com/GateHubNet/x-explorer-worktrees/explorer-pages-2`. E7–E11 are built on it before Task 1, and D7 is complete on `DAPI = /Users/golobitch/github.com/GateHubNet/data-api-worktrees/explorer-data-2` (`feat/explorer-data-2`), which this plan only reads. Commit here, never push.

## Global Constraints

- Commands (from `EXP`; check the names in `package.json`): `pnpm test` (all vitest projects; narrow with paths, `--project worker`, `--project worker-off`), `pnpm typecheck`, `pnpm verify` (`api:check` + `typecheck` + `test` + `build` + `check:bundle`), `pnpm fixtures:sync` / `pnpm fixtures:check`, `pnpm test:e2e` (Playwright, builds the Worker). `pnpm verify` exits 0 before every commit; `pnpm test:e2e` after Tasks 6–9.
- Commits: `feat(…)`, `test(…)`, `docs: …` as the repo writes them, a body that says why, last line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Name every file in `git add`, never `-A`, never `--amend`, never touch `.claude/`.
- Edge classes: the page and its `.data` `cached(page, "slow", { ttl: PERIOD_CALL_TTL_SECONDS })` (300 s); the query-string 302 and the switch-off 404 `short`. Subrequests: S `networkSupply`, F `fees` (interval day), M `networkMinted`, each class `slow` asked with `{ ttl: PERIOD_CALL_TTL_SECONDS }`; A `lastValidated({ ttl: HOME_CALL_TTL_SECONDS })`. No call asks `holdFailure` (the page polls nothing). A, F and M race `CARD_DEADLINE_MS` from the loader's start with `byDeadline`; S does not. Everything settles (`Promise.allSettled`) before anything is thrown. No names call, no node call.
- Exactness: every figure is made from D7's strings with `bignumber.js`; a fee row's `total` (a JSON number) becomes `new BigNumber(String(n))`; no float reaches a label (`Number()` only for geometry).
- Figures (Rulings 2–4): tile figures `BigNumber.toFormat(6)` split at the point; tile asides, bar captions, bar sentences and the meta description `compactFigure` (two decimals with K/M/B/T); bar captions' percent `captionPercent` (one decimal); tooltip and sentence shares `finePercent`; chart summaries `compactNumber` (E2's); the snapshot time `formatDateTime` (`app/domain/time-words.ts`).
- `SUPPLY_STALE_SECONDS = 10_800`: stale when the anchor's close time is **more** than that after the snapshot's.
- Pages draw data and never fetch; the view builder is pure (no clock, no `Intl`). Browser files (pages, UI components, the domain files they import, `meta-supply.ts`) import nothing from `app/server` as values (type imports are fine).
- The kit is never forked: props grow in their own files (E2 §2.11). An E2–E11 piece is used by its name and file; a missing export is added in its own file, marked **Growth** in the task.
- `SUPPLY`: appended last to `FEATURE_VARS` / `FEATURE_NAME` (`supply`), `Env.SUPPLY`, every block of `wrangler.jsonc` (top level `"on"`, `sandbox` `"off"`, `production` `"off"`), `TOP_LEVEL_SWITCHES`. It gates the route (404 `short`, no call) and the menu's Supply item ("soon") and nothing else.
- The header after this plan: Ledgers, Transactions, Tokens, Network ▾ (Overview, Validators, Amendments, Supply), Markets, AMM, NFTs. E12 owns only the Network step (E8 §1.1).
- Budget: `supply` is a dashboard, 160,000 bytes gzip with the manifest (ruling R19, decision 14); the network page stays under its own 160,000 after the menu joins the shell.
- Worker specs share one Cache API per file: failure tests first, distinct keys, in the order the task lists.
- End-to-end tests that need the page skip themselves when `E2E_FEATURES_OFF` lists `SUPPLY`, and run the off case instead.
- Copy, exact (spec §5): intro XRPL "How much XRP exists, how much is burned and escrowed, and how much circulates." / Xahau "How much XAH exists, how much is minted, burned and escrowed, and how much circulates."; bar titles "Where the 100 billion XRP are" / "Where the XAH are"; the bar texts, tile definitions and card notes of spec §5.2–§5.5 with the network's currency in place of XRP/XAH; the stale warning "This snapshot is {N} hours older than the newest ledger: the data API has not computed a newer one."; the 404 "the supply page".

## Consumed from earlier plans

| Piece | From | Where |
|---|---|---|
| `Coverage`, `checkCoverage(body)`, `coverageNote(coverage, words)`, `CoverageNote` | E8 | `app/server/coverage.ts`, `app/ui/components/CoverageNote.tsx` |
| NFTs header item and `NavSection` `"nfts"` | E8 | `Header.tsx`, `route-handle.ts` |
| Tokens header item and `NavSection` `"tokens"` | E11 | same |
| `sandbox` block of `wrangler.jsonc`; the testnet names in `Network.name` | E7 | `wrangler.jsonc`, `app/server/networks.ts` |
| Switches `NFTS`, `NAMES`, `LEDGER_OBJECTS`, `DELEGATION`, `TOKENS` | E8–E11 | `app/ui/features.ts` |
| `ShareBar`, `shareLegend`, `ShareData`, `ColumnChart`, `ChartCard`, `ChartTable`, `Legend`, `legendOf`, `TimeSeriesData`, `StatTile`, `StatGrid` | E2 | `app/ui/charts/`, `app/ui/components/` |
| `windowOf`, `utcDayOf`, `anchorOrThrow`, `tokened`, `byDay`, `Part<T>`, `SERIES_LIMIT`, `CARD_DEADLINE_MS`, `byDeadline`, `TooLate`, `PERIOD_CALL_TTL_SECONDS`, `HOME_CALL_TTL_SECONDS`, `cached`, `cacheClassHeaders`, `forwardCacheClass`, `upstreamOutage`, `markDegraded`, `logProblem`, `clientsFor`, `requireNetwork`, `queryOf`, `metaContext`, `sharing`, `absolute`, `isIsoTime`, `isDecimalText` | E2 | `app/domain/window.ts`, `app/server/*` |
| `useRetry` | E3 | `app/ui/use-retry.ts` |
| `formatDateTime`, `sharePercent`, `formatAmount`, `compactNumber`, `formatUtcDay` | E2/E6 | `app/domain/time-words.ts`, `percent.ts`, `format.ts` |

The first step of the task that first uses one opens its file and checks the name and signature; if the built one differs, use the built one and adjust that task's references.

## Review Focus

1. **The snapshot call failing the ways D7 can fail**: 404 `supply not computed yet` (before the first cycle), `Cannot GET` (an API without D7), a malformed amount. Each is a 503 that is never stored; a failing card is a degraded 200 that is never stored. Tests: Task 1 `refuses a coverage that is no coverage` and `a malformed 200 is a server error and is not stored`; Task 7 the three S failures and `F failing gives a degraded 200, not stored`.
2. **A part missing from the answer**: `reserves` (no reserve values), `amm` (Xahau), `minted` (XRPL). The tile reads "—" with its sub or is left out, the bar's sentence leaves it out, and M is not called without `minted`. Tests: Task 5 `a missing part`, `Xahau has no AMM tile and says "no AMM on Xahau"`; Task 7 `asks M only where S has minted`.
3. **Coverage incomplete, and the sandbox's testnets**: escrowed incomplete (notes under the bar, Escrowed and Circulating), reserves incomplete on XRPL, every part incomplete on a testnet (every note, the page whole), minted coverage starting inside the window (earlier days `null`, the card's note). Tests: Task 5 `every coverage note`, `a testnet answer shows every note`; Task 4 `minted days before the coverage start are null`.
4. **Stale and anchor edges**: exactly 3 h is not stale, 3 h + 1 s says "3 hours"; a failed anchor fails both cards and drops the stale check while the page stands. Tests: Task 5 `the stale threshold`, `a failed anchor`; Task 7 `A failing fails both cards`.
5. **The menu without JavaScript and by keyboard**: the summary opens it in the Worker's HTML; Escape returns focus to the summary; focus leaving or a navigation closes it; an item whose switch is off is a "soon" label, not a link. Tests: Task 8 `use-disclosure-menu.test.tsx` cases, `the page without JavaScript has the menu`, `header-menu.spec.ts`.

---

### Task 1: D7's API description, the two calls, their types and shape checks

**Files:**
- Modify (by `pnpm api:sync`): `api/openapi.yaml`, `app/server/openapi.d.ts`
- Modify: `app/server/api-types.ts`, `app/server/data-api.ts` (`PATHS` and two methods)
- Create: `app/server/supply-shape.ts`, `app/server/supply-shape.test.ts`, `test/support/d7-samples.ts`
- Test: `test/worker/data-api.spec.ts`

**Interfaces:**
- Consumes: E8 `Coverage`, `checkCoverage`; E2 `isIsoTime`, `isDecimalText`, `get()`, `FreshOptions`, `UpstreamError`.
- Produces (written from D7's `docs/api-reference.md` at `PIN`, keys in its order, optional where it leaves a key out):
  ```ts
  // api-types.ts
  export interface SupplyPart { amount: string; coverage?: Coverage }
  export interface EscrowedPart extends SupplyPart { escrows: number }
  export interface AmmPart extends SupplyPart { pools: number }
  export interface ReservesPart extends SupplyPart { accounts: number; owner_count: number; base: string; increment: string }
  export interface MintedPart extends SupplyPart { rewards: string; import: string; genesis_mint: string }
  export interface NetworkSupply { result: "success"; ledger_index: number; close_time: string; computed_at: string; currency: "XRP" | "XAH";
    total: string; burned: SupplyPart; minted?: MintedPart; escrowed: EscrowedPart; circulating: SupplyPart; amm?: AmmPart; reserves?: ReservesPart }
  export interface MintedRow { date: string; amount: string; rewards: string; import: string; genesis_mint: string }
  export interface MintedPage { result: "success"; coverage: Coverage; marker?: string; count: number; rows: MintedRow[] }
  // data-api.ts
  export type MintedQuery = { interval: "day"; start: string; end: string; limit: number };   // sent in this order
  networkSupply(opts?: FreshOptions): Promise<NetworkSupply>;               // PATHS.networkSupply "/v2/network/supply", class slow
  networkMinted(q: MintedQuery, opts?: FreshOptions): Promise<MintedPage>;  // PATHS.networkMinted "/v2/network/supply/minted", class slow
  // supply-shape.ts (each is get()'s finish, inside the cached load; throws UpstreamError("server", …, { status: 200 }))
  export function checkSupply(body: unknown, path: string, native: "XRP" | "XAH"): NetworkSupply;
  export function checkMintedPage(body: unknown, path: string): MintedPage;
  // test/support/d7-samples.ts: D7 §5.1's examples, shallow overrides
  export function supplySample(net: "xrpl" | "xahau", over?: Partial<NetworkSupply>): NetworkSupply;
  export function mintedPageSample(over?: Partial<MintedPage>): MintedPage;
  ```
  Shape rules (spec §3.1): `ledger_index` a positive whole number; `close_time`, `computed_at` `isIsoTime`; `currency === native`; every amount `isDecimalText` and not negative; counts whole numbers ≥ 0; `total`, `burned`, `escrowed`, `circulating` present, `minted`, `amm`, `reserves` optional; each part's `coverage`, when the part has the key, through `checkCoverage(part)` (D7 leaves it out of `burned` where the network does not mint, so a missing one is no error); a minted page's `rows` an array of `date` `isIsoTime` and four amounts, its `coverage` through `checkCoverage(body)`.

- [ ] **Step 1: Sync and pin, then write the failing tests.** `DATA_API_REPO=/Users/golobitch/github.com/GateHubNet/data-api-worktrees/explorer-data-2 pnpm api:sync`; `grep -n '/v2/network/supply' api/openapi.yaml` shows both paths (else stop: D7 is not built). `PIN=$(git -C /Users/golobitch/github.com/GateHubNet/data-api-worktrees/explorer-data-2 log -1 --format=%H -- docs/api-reference.md)`. Because Task 1 syncs first, the two paths go straight into `PATHS`, never `PENDING_PATHS` (Ruling 1).
  ```ts
  // supply-shape.test.ts
  it.each([["XRPL", "xrpl", "XRP"], ["Xahau", "xahau", "XAH"]])("accepts %s's answer and returns it", …);  // toBe(body)
  it.each([["an amount that is a number", …], ["a negative amount", …], ["a currency of the other network", …], ["no escrowed", …],
           ["a close_time that is not a time", …], ["escrows that is text", …]])("refuses %s with a server error", …);
  it("refuses a coverage that is no coverage", …);                 // escrowed.coverage = { complete: "yes" }
  it("accepts a minted page and refuses a row without genesis_mint, or a page without coverage", …);
  // data-api.spec.ts (recordingCache and mockUpstream, as the file does)
  it("asks D7's two paths with their queries, class and TTL", …);
  //   "GET …/v2/network/supply [kept 300 s]" slow; "GET …/v2/network/supply/minted?interval=day&start=2026-07-20&end=2026-10-17&limit=1000 [kept 300 s]" slow
  it.each(["networkSupply", "networkMinted"])("%s: a malformed 200 is a server error and is not stored", …);
  it("reads 404 supply not computed yet as not_found and Cannot GET as a server error", …);
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/supply-shape` and `pnpm test --project worker test/worker/data-api` → FAIL (missing exports and methods).
- [ ] **Step 3: Implement** the types, the checks, the samples and the two methods through `get(template, {}, query, "slow", { finish, ttl })`.
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit.** `git add api/openapi.yaml app/server/openapi.d.ts app/server/api-types.ts app/server/data-api.ts app/server/supply-shape.ts app/server/supply-shape.test.ts test/support/d7-samples.ts test/worker/data-api.spec.ts` and `git commit -m "feat(data-api): D7's supply and minted calls, typed and checked" -m "Synced from data-api feat/explorer-data-2; types follow its docs/api-reference.md at <PIN>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 2: Synthetic D7 fixtures

**Files:**
- Create: `scripts/supply-fixtures.ts`, `test/unit/supply-fixtures.test.ts`
- Modify: `scripts/http-fixtures.ts` (`generate()` calls `supplyFixtures` after `validatorsFixtures`; `isSupplyGenerated`), `test/unit/http-fixtures.test.ts` (the generated files' size budget counts these), `test/fixtures/PROVENANCE.md` (section "Synthetic supply", naming `PIN`), `README.md` ("Upstream fixtures" rows)
- Generated by `pnpm fixtures:sync`: `test/fixtures/http/{xrpl,xahau}/data-api/network/supply.json`, `test/fixtures/http/xahau/data-api/network/supply/minted@end=2026-10-17&interval=day&limit=1000&start=2026-07-20.json`

**Interfaces:**
- Consumes: Task 1 types and `PIN` (`git log -1 --grep "explorer-data-2"` message); E2 `mulberry32`, `seedOf` (`scripts/synthetic.ts`), `readLedgers`, `dataApiLastValidated`, `dataApiFile`, `fixtureText`.
- Produces:
  ```ts
  export function supplyFixtures(net: NetworkName, last: LastValidated, snapshot: { ledger_index: number; close_time: string }): Array<{ path: string; query: string; value: unknown }>;
  export function isSupplyGenerated(path: string): boolean;   // /^(xrpl|xahau)\/data-api\/network\/supply(\.json$|\/)/
  ```
  `generate()` passes XRPL's recorded ledger 107,720,688 (`dataApiLastValidated` of that raw ledger from `readLedgers("xrpl")`; throw if absent) and, for Xahau, `last` itself (26,596,843).

What it writes (spec §11): XRPL `/v2/network/supply`: that ledger and close time, `computed_at` + 107 s, every figure of D7 §5.1's XRPL example (total `99985312374.716318`, burned `14687625.283682`, escrowed `35212847105.402318` in 12,879 escrows, circulating `64772465269.314`, AMM `46218377.402915` in 14,594 pools, reserves `9810004` = 6,410,280 × 1 + 16,998,620 × 0.2), coverage `{ from_ledger_index: 28685313, complete: true }` for escrowed and circulating, `{ 86795265, true }` for AMM, reserves `{ 107480321, false }`. Xahau: ledger 26,596,843 at `last.close_time`, `computed_at` + 29 s, D7 §5.1's Xahau figures (minted `49425551.616207` = rewards `41203318.512207` + import `8102233.104` + genesis_mint `120000`, no `amm`), every coverage `{ 2, true }`. Xahau minted page: the 90 days `2026-07-20`…`2026-10-17` (`windowOf("2026-10-17", "90d")`), coverage `{ 2, true }`, seeded `seedOf("xahau", "supply/minted")`: rewards every day (25,000–35,000 XAH, 6 decimals), imports on about four days in five (500–8,000), `genesis_mint` `"40000"` on 2026-09-14 only, today about a third of a day; `amount` the exact sum; `count` 90, no marker.

- [ ] **Step 1: Write the failing tests** (`supply-fixtures.test.ts`, on `generate()`'s map, not the disk):
  ```ts
  it("XRPL's snapshot is ledger 107,720,688, about 50 minutes before last_validated", …);   // 2,700–3,300 s
  it.each(["xrpl", "xahau"])("%s: circulating is total less escrowed, and the reserves add up, exactly", …); // BigNumber
  it("Xahau's minted is the sum of its sources, and it has no amm", …);
  it("the minted page has the window's 90 days, one GenesisMint day, and each amount the sum of its sources", …);
  it("isSupplyGenerated names every generated supply file and nothing else", …);
  it("gives the same output twice", …);
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test test/unit/supply-fixtures` → FAIL.
- [ ] **Step 3: Implement**, run `pnpm fixtures:sync`, write the PROVENANCE section and README rows.
- [ ] **Step 4: Run them to verify they pass.** Step 2's command and `pnpm test test/unit/http-fixtures` → PASS; `pnpm fixtures:check` → up to date; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit.** `git add scripts/supply-fixtures.ts scripts/http-fixtures.ts test/unit/supply-fixtures.test.ts test/unit/http-fixtures.test.ts test/fixtures/http test/fixtures/PROVENANCE.md README.md` — `test(fixtures): synthetic answers of D7's supply routes`, body naming `PIN`.

---

### Task 3: Kit growth: `finePercent`, a compact `ShareBar`, the `StatTile` aside

**Files:**
- Modify: `app/domain/percent.ts`, `app/domain/percent.test.ts`, `app/ui/charts/types.ts`, `app/ui/charts/ShareBar.tsx`, `app/ui/charts/ShareBar.test.tsx`, `app/ui/charts.css`, `app/ui/components/StatTile.tsx`, `app/ui/components/components.test.tsx`, `app/ui/components.css`, `test/unit/charts-css.test.ts`

**Interfaces:**
- Produces (**Growth** of E2's kit; without the new props everything renders as today):
  ```ts
  export function finePercent(part: string, whole: string): string;   // percent.ts
  // types.ts: ShareData's segment gains caption?: string; share?: string; ShareData gains unit?: string
  // ShareBarProps gains compact?: boolean
  // StatTile gains aside?: ReactNode (".stat__aside", right of the label, --faint, 12 px, proportional figures)
  // StatGrid gains wide?: boolean (".stat-grid--wide": repeat(auto-fill, minmax(min(360px, 100%), 1fr)))
  ```

Rules (spec §8): `finePercent`: `whole` not above 0 or either not decimal → `—`; `part` 0 → `0%`; a share under 1% (exactly) → `toPrecision(2)` half up (`0.015%`, `0.071%`, `1.0%` for 0.9996%); else two decimals half up (`35.21%`, `3.00%`). `compact`: class `share--compact`; one 40 px row with no name column and no % axis; `.share--compact .share__seg { min-width: 3px }`; a labelled segment (≥ 18%) shows its `caption` instead of "label share"; the tooltip's amount row reads `{formatAmount(value)} {unit}` and then `share` instead of "of {total} ({percent})"; the slider's text is `{label}, {formatAmount(value)} {unit} ({share})` (no row label in compact); the summary (`role="img"`) is `{title}: {label} {formatAmount(value)} {unit} ({share}); …` for every drawn segment, and offers no Table.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // percent.test.ts
  expect([finePercent("35212847105.402318", "100000000000"), finePercent("14687625.283682", "100000000000"),
          finePercent("46218377.402915", "64772465269.314"), finePercent("18406227.318004", "613401782.117306"),
          finePercent("9996", "1000000"), finePercent("0", "5"), finePercent("1", "0"), finePercent("x", "1")])
    .toEqual(["35.21%", "0.015%", "0.071%", "3.00%", "1.0%", "0%", "—", "—"]);
  // ShareBar.test.tsx
  it("compact draws one row with no name column and no axis", …);
  it("a caption replaces a labelled segment's label and share", …);       // "35.21B XRP · 35.2%"
  it("compact's tooltip and slider say the amount with its unit and the share text", …);
       // aria-valuetext "Escrowed, 35,212,847,105.402318 XRP (35.21% of the 100 billion XRP)"
  it("compact's summary names every segment and offers no table", …);
  // components.test.tsx
  it("StatTile shows its aside right of the label", …); it("StatGrid wide has the wide class", …);
  // charts-css.test.ts: the 3 px minimum of a compact segment, the 40 px row; components CSS: .stat__aside, .stat-grid--wide
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/domain/percent app/ui/charts/ShareBar app/ui/components/components test/unit/charts-css` → FAIL.
- [ ] **Step 3: Implement** the function, the props and the CSS.
- [ ] **Step 4: Run them to verify they pass.** Step 2's command → PASS (the existing ShareBar tests unchanged); `pnpm verify` → exit 0.
- [ ] **Step 5: Commit.** `git add app/domain/percent.ts app/domain/percent.test.ts app/ui/charts/types.ts app/ui/charts/ShareBar.tsx app/ui/charts/ShareBar.test.tsx app/ui/charts.css app/ui/components/StatTile.tsx app/ui/components/components.test.tsx app/ui/components.css test/unit/charts-css.test.ts` — `feat(charts): a compact share bar, the stat tile's aside and finePercent`.

---

### Task 4: The view builder: burned and minted per day

**Files:**
- Create: `app/server/supply-view.ts`, `app/server/supply-view.test.ts`
- Modify: `app/server/network-view.ts` (**Growth**: `export` on `reasonOf`)

**Interfaces:**
- Consumes: Tasks 1, 2; E2 `windowOf`, `utcDayOf`, `anchorOrThrow`, `tokened`, `byDay`, `Part`, `reasonOf`; E8 `coverageNote`; `compactNumber`, `formatAmount`, `formatUtcDay`.
- Produces (Task 5):
  ```ts
  export type RichText = readonly (string | { b: string })[];              // { b } is drawn bold
  export type Note = NonNullable<ReturnType<typeof coverageNote>>;
  export interface Failure { part: string; error: unknown }
  export interface SupplyChart { data: TimeSeriesData; summary: RichText; total: string }   // total: the window's exact sum
  export type BurnedCard = Part<SupplyChart>;
  export type MintedCard = Part<SupplyChart & { since: string; notes: readonly string[]; coverage: Note | null }>;
  export function burnedCardOf(net: Network, anchor: PromiseSettledResult<LastValidated>, fees: PromiseSettledResult<Page<"rows", FeeBucketRow>>, failures: Failure[]): BurnedCard;
  export function mintedCardOf(net: Network, minted: MintedPart, anchor: PromiseSettledResult<LastValidated>, page: PromiseSettledResult<MintedPage>, failures: Failure[]): MintedCard;
  ```

Rules (spec §5.4, §5.5, decision 4): a rejected `anchor` or call → `{ state: "failed", reason: reasonOf(error) }` and a `Failure` (`part` `"burned"` / `"minted"`). The window is `windowOf(utcDayOf(anchorOrThrow(a).closeTime), "90d")`, `forming: true`; a bucket without a row is `null`. Burned: one series `{ id: "burned", label: "Burned", slot: 1 }`, values `new BigNumber(String(row.total)).toFixed()`, format `{ kind: "amount", unit: native }`. Minted: series Rewards (slot 1), Import (slot 3), GenesisMint (slot 5), `totals` = `amount`. Full days = the 89 buckets before today. `total` = Σ of every bucket with a row; average = Σ of full days with a row ÷ their count, 6 decimals half up; highest = the largest full day (the earliest on a tie). Summaries:
- burned `["Last 90 days: ", { b: "{compactNumber(total)} {native}" }, " burned as fees, {compactNumber(avg)} {native} a day on average. Highest: {compactNumber(max)} {native} on {formatUtcDay(day)}."]`; without a full day with a row, `" burned as fees."`;
- minted `["Last 90 days: ", { b: "{compactNumber(total)} {native}" }, " minted (Rewards {r}, Import {i}, GenesisMint {g}), {avg} a day on average."]` (each `compactNumber`);
- `since`: "Since ledger #{formatAmount(from)}: {formatAmount(amount)} {native} minted: {rewards} as rewards, {import} by Import, {genesis_mint} by GenesisMint." with `from` = `minted.coverage?.from_ledger_index` and every figure `formatAmount`; without `from`, "In the index: …" with the same rest;
- `notes`: ["Rewards are paid to accounts that claim them. Import mints {native} for XRP burned on XRPL. GenesisMint is minted by governance."];
- `coverage`: `coverageNote(page.coverage, "mints")`.

- [ ] **Step 1: Write the failing tests** (`supply-view.test.ts`, from the Task 2 fixtures read with `readFileSync` and E2's XRPL/Xahau fee fixtures):
  ```ts
  it("burned: the 90 buckets, today forming, a day without a row null", …);
  it("burned: the summary sums today, averages and tops the full days only", …);   // exact strings from the fixture
  it("burned: a fee total that is a JSON number becomes exact text", …);           // 2.000001 → "2.000001", never "2.0000010000000003"
  it("minted: three series in slots 1, 3 and 5 with exact totals", …);
  it("minted days before the coverage start are null, and the card says why", …);  // page.coverage { from_ledger_index: <mid-window>, complete: false }
  it("minted: the since sentence names the coverage's first ledger, else 'In the index'", …);
  it.each(["anchor", "fees"])("a rejected %s fails the burned card and reports it", …);   // TooLate → "took too long"
  it("a rejected minted page fails the minted card", …);
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/supply-view` → FAIL.
- [ ] **Step 3: Implement** the two builders.
- [ ] **Step 4: Run them to verify they pass.** Same command → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit.** `git add app/server/supply-view.ts app/server/supply-view.test.ts app/server/network-view.ts` — `feat(supply): the burned and minted per day cards`.

---

### Task 5: The view builder: snapshot, bar, tiles and the page data

**Files:**
- Modify: `app/server/supply-view.ts`, `app/server/supply-view.test.ts`

**Interfaces:**
- Consumes: Task 4; Task 3 `finePercent`; E8 `coverageNote`; `tokenOf`.
- Produces (Tasks 6, 7):
  ```ts
  export const SUPPLY_STALE_SECONDS = 10_800;
  export function compactFigure(value: string): string;        // from 1,000: two decimals and K/M/B/T, half up, zeros kept ("99.99B", "595.00M", "268.97K", "2.32K"); below: two decimals
  export function captionPercent(part: string, whole: string): string;  // one decimal, half up ("35.2%", "97.0%")
  export type TileId = "total" | "minted" | "burned" | "escrowed" | "circulating" | "amm" | "reserves";
  export interface SupplyTile { id: TileId; label: string; whole: string | null; fraction: string | null; currency: string;
    aside: string | null; formula: string | null; definition: string; sub: string | null; coverage: Note | null }
  export interface SupplyPageData {
    network: { id: NetworkId; name: string; native: "XRP" | "XAH" };
    snapshot: { ledgerIndex: number; ledgerHref: string; closeTime: string /* ISO */; stale: { hours: number } | null };
    intro: string;
    bar: { title: string; text: string; data: ShareData; burned: RichText | null; part: { start: number; text: RichText } | null; coverage: Note | null };
    tiles: SupplyTile[];
    burnedCard: BurnedCard;
    mintedCard: MintedCard | null;          // null without supply.minted
    description: string;                    // the meta description
  }
  export interface SupplyCards { anchor: PromiseSettledResult<LastValidated>; fees: PromiseSettledResult<Page<"rows", FeeBucketRow>>; minted?: PromiseSettledResult<MintedPage> }
  export function supplyPage(net: Network, supply: NetworkSupply, cards: SupplyCards): { page: SupplyPageData; failures: Failure[] };
  ```

Rules (spec §4, §5.1–§5.3, decisions 5–8; `cap` = `net.id === "xrpl"`, which holds for XRPL Testnet too):
- **Snapshot**: `ledgerHref` `/{id}/ledger/{n}`; `stale` = `{ hours: floor(diff / 3600) }` when the fulfilled anchor's close time minus the snapshot's is more than `SUPPLY_STALE_SECONDS`, else `null` (and `null` without an anchor).
- **Bar**: one row `{ id: "supply", label: "Supply" }`, total `"100000000000"` (cap) or `total`; segments, in order, cap: Burned (slot 2), Escrowed (slot 3), Circulating supply (slot 1); else Escrowed (3), Circulating supply (1). Each segment's `caption` `"{compactFigure(v)} {native} · {captionPercent(v, rowTotal)}"`, `share` `"{finePercent(v, rowTotal)} of the 100 billion XRP"` (cap) or `"… of the total supply"`; `unit` = native; `tokened`. `burned` (cap only): `[{ b: "Burned {compactFigure(burned)} XRP" }, " · {finePercent(burned, 1e11)} of the 100 billion, a sliver at this scale"]`. `part.start` = the circulating segment's start as a fraction of the row (`Number` for geometry); `part.text`: `"Part of circulating: "`, then, joined by `" · "`, `[{ b: "{compactFigure(amm)} {native}" }, " in AMM pools ({finePercent(amm, circulating)} of circulating)"]` when `amm`, `[{ b: "{compactFigure(reserves)} {native}" }, " held as account reserves ({finePercent} of circulating)"]` when `reserves`, `"no AMM on {name}"` when `!net.hasAmm`; `null` with no piece. `coverage` = `coverageNote(escrowed.coverage, "escrows")` when present.
- **Tiles** (order: cap Total, Burned, Escrowed, Circulating, In AMM pools, Account reserves; else Total, Minted, Burned, Escrowed, Circulating, Account reserves): `whole`/`fraction` = `new BigNumber(v).toFormat(6)` split at the point; `aside` `"≈ {compactFigure(v)}"`; the formulas `"= 100,000,000,000 − burned"` (cap total), `"= total supply − escrowed"`, `"= {accounts} × {base} + {owner_count} × {increment}"` (grouped counts, `formatAmount` of base and increment, never constants); subs `"in {n} escrow(s)"`; definitions and coverage words of spec §5.3 (burned's note only when `burned.coverage` is present). Without `reserves`: `whole` `null`, sub `"Not known at this ledger."`; without `amm`: no AMM tile; the Minted tile's figure is the minted card's `total`, and with that card failed `whole` `null`, sub `"Couldn't load the minted days."`.
- **Description**: cap `"XRP supply at ledger #{n}: {total} total, {burned} burned, {escrowed} escrowed, {circulating} circulating."`; else `"XAH supply at ledger #{n}: {total} total, {minted} minted, {burned} burned, {escrowed} escrowed, {circulating} circulating."` (each `compactFigure`, ledger grouped).

- [ ] **Step 1: Write the failing tests** (both networks from the Task 2 fixtures; variants made in the test):
  ```ts
  it("formats compact figures and caption percents", …);  // compactFigure: "99985312374.716318" → "99.99B", "594995554.799302" → "595.00M", "268973.2" → "268.97K", "2318.640227" → "2.32K"
  it.each(["xrpl", "xahau"])("%s: the bar's parts add up to its row total exactly", …);
  it("XRPL: segments, captions, shares, the burned sliver line and the bracket's words", …);   // "Burned 14.69M XRP", "0.015% of the 100 billion, a sliver at this scale"
  it("Xahau has no AMM tile and says \"no AMM on Xahau\"", …);
  it("tiles in board order with exact figures and the reserves formula from the answer", …);  // "= 6,410,280 × 1 + 16,998,620 × 0.2"
  it("a missing part", …);                        // reserves absent → "—" and "Not known at this ledger.", left out of the bracket
  it("every coverage note", …);                   // escrowed incomplete → bar, Escrowed, Circulating notes; reserves incomplete → its tile
  it("a testnet answer shows every note and the page is whole", …);   // every coverage complete false, net.name "XRPL Testnet"
  it("the stale threshold", …);                   // 10,800 s → null; 10,801 s → { hours: 3 }; 18,000 s → { hours: 5 }
  it("a failed anchor fails both cards and drops the stale check", …);
  it("the minted tile follows its card", …);      // card ok → its total; failed → "Couldn't load the minted days."
  it("describes the snapshot for the meta tags", …);
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/supply-view` → FAIL.
- [ ] **Step 3: Implement** the helpers and `supplyPage`.
- [ ] **Step 4: Run them to verify they pass.** Same command → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit.** `git add app/server/supply-view.ts app/server/supply-view.test.ts` — `feat(supply): the snapshot, the bar and the tiles of the supply page`.

---

### Task 6: The page component

**Files:**
- Create: `app/ui/pages/SupplyPage.tsx`, `app/ui/pages/SupplyPage.test.tsx`
- Modify: `app/ui/pages.css` (`.supply__…`), `test/unit/pages-css.test.ts`

**Interfaces:**
- Consumes: Task 5 `SupplyPageData` (type import), Task 3 kit props; E2 `ShareBar`, `shareLegend`, `Legend`, `legendOf`, `ColumnChart`, `ChartCard`, `ChartTable`, `StatGrid`, `StatTile`, `Breadcrumbs`, `Notice`; E8 `CoverageNote`; E3 `useRetry`; `formatDateTime`, `formatAmount`.
- Produces: `SupplyPage({ data }: { data: SupplyPageData })`.

Layout (spec §5): `Breadcrumbs` `[name → /{id}, Network → /{id}/network, Supply]`; `<h1>Supply</h1>` and the intro; at the heading row's right (under it on a phone) "Snapshot at ledger **#{n}** · {formatDateTime(closeTime)} · updated hourly" with the ledger a `Link`, and the faint mono source `/v2/network/supply`; with `stale`, `Notice tone="warning"`. The bar card (`section.card` `aria-labelledby` its `<h2>`): title, source, `Legend items={shareLegend(data)}`, the text, the burned line (a 2 px rule in slot 2 at its left), `ShareBar compact`, the bracket at `left: {start × 100}%` to the end, `CoverageNote`. `StatGrid wide label="Supply figures"` of `StatTile figure`: `aside`, value `{whole}<span class="supply__fraction">{fraction}</span> {currency}` (or "—"), `sub` = the formula (`.stat__formula`), the definition, the sub line and the `CoverageNote`. `ChartCard id="burned"` (`what` "{native} burned per day", `ColumnChart layout="single"`, `ChartTable title="Burned per day"`, the summary with `{ b }` in `<b>`); `ChartCard id="minted"` when `mintedCard` (`ColumnChart layout="stacked"`, `Legend items={legendOf(data, "swatch")}`, `ChartTable title="Minted per day" totalLabel="Total, {native}"`, notes: `since`, the note, the `CoverageNote`). A failed card: `state="failed"`, `onRetry`/`retrying` from `useRetry()`.

- [ ] **Step 1: Write the failing tests** (`SupplyPage.test.tsx`: rendered as the Worker prints it and hydrated, data from `supplyPage` over the fixtures):
  ```ts
  it("draws the heading, the snapshot line with its ledger link and the source", …);  // "Oct 17, 2026, 16:08 UTC"-style text from formatDateTime
  it("draws the compact bar, its legend, the burned line and the bracket", …);
  it("draws the tiles with muted fractions, asides, formulas and coverage notes", …);
  it("draws both cards with their tables and the minted notes", …);
  it("draws a failed card with Retry and keeps the rest", …);
  it("shows the stale warning only when stale", …);
  it("hydrates without a mismatch", …);
  ```
  `pages-css.test.ts`: the snapshot line stacks under the heading at 375 px; the fraction is `--muted`.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/pages/SupplyPage test/unit/pages-css` → FAIL.
- [ ] **Step 3: Implement** the page and its styles.
- [ ] **Step 4: Run them to verify they pass.** Same command → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit.** `git add app/ui/pages/SupplyPage.tsx app/ui/pages/SupplyPage.test.tsx app/ui/pages.css test/unit/pages-css.test.ts` — `feat(supply): the supply page component`.

---

### Task 7: The route, its loader, the `SUPPLY` switch and the tags

**Files:**
- Create: `app/routes/net.supply.tsx`, `app/server/meta-supply.ts`, `test/worker/supply-page.spec.ts`, `test/worker/supply-off.spec.ts`, `test/unit/supply-bundle.test.ts`
- Modify: `app/routes.ts` (`route("supply", "routes/net.supply.tsx")` after `amendments/:name`), `app/ui/features.ts`, `app/server/env.ts`, `wrangler.jsonc` (each block and its header comment), `vitest.config.ts` (`TOP_LEVEL_SWITCHES`), `test/worker/features-off.spec.ts`, `app/server/env.test.ts`, `scripts/predeploy-check.test.ts`, `app/server/meta.test.ts`, `test/worker/meta.spec.ts`, `app/ui/routes-wiring.test.tsx`, `scripts/bundle-budget.ts` (`{ name: "supply", route: "routes/net.supply", budget: "dashboard" }`), `scripts/check-bundle.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 5, 6.
- Produces: route id `routes/net.supply` (`headers = forwardCacheClass`, `handle = { navSection: "network" }`, `meta`, `loader`, default component); `Feature` `"supply"`; `supplyMeta(data: SupplyPageData, ctx: MetaContext): MetaDescriptor[]`.

Loader (spec §1, §3): `requireNetwork`; `!net.features.supply` → `throw cached({ notFound: "the supply page" }, "short", { status: 404 })`; a non-empty query → 302 to `/{id}/supply` with `cacheClassHeaders("short")`; then, from `started`: S `api.networkSupply(period)`; A `byDeadline(api.lastValidated({ ttl: HOME_CALL_TTL_SECONDS }), deadline)`; F `byDeadline(A → fees({ interval: "day", start: w.start, end: w.end, limit: SERIES_LIMIT }, period), deadline)` with `w = windowOf(utcDayOf(anchorOrThrow(a).closeTime), "90d")`; M `byDeadline(A and S → S.minted ? networkMinted({ interval: "day", start, end, limit: SERIES_LIMIT }, period) : undefined, deadline)`; all `Promise.allSettled`; S rejected → `upstreamOutage(err, "the supply")`; `supplyPage(net, s, { anchor, fees, ...(s.minted && { minted }) })`; each failure `logProblem("the supply page's {part} could not be loaded", …)`, any → `markDegraded(context, "supply: …")`; `cached(page, "slow", { ttl: PERIOD_CALL_TTL_SECONDS })`. Meta (Ruling 10): title `Supply · {name} · {PRODUCT_NAME}`, description `data.description`, `sharing` with the canonical `/{id}/supply` on the request's origin, the site's default image, no `/og` image.

- [ ] **Step 1: Write the failing tests.**
  - `supply-page.spec.ts`, **in this order**:
    ```ts
    it("S answering 404 supply not computed yet is a 503 with Retry-After, not stored", …);
    it("S answering Cannot GET is a 503, not stored", …);
    it("S answering a malformed amount is a 503, not stored", …);
    it("F failing gives a degraded 200, not stored, with the burned card failed", …);
    it("A failing fails both cards, drops the stale check, and the page is a degraded 200", …);
    it("sends any query string to /xrpl/supply, short, with no call", …);
    it("is slow with a TTL of 300, the page and its .data", …);
    it("asks exactly S, A and F on XRPL, F under the network page's 90-day key", …);  // "GET …/v2/network/fees?interval=day&start=2026-07-20&end=2026-10-17&limit=1000 [kept 300 s]"
    it("asks M only where S has minted", …);                                       // Xahau yes, XRPL never
    it("makes no names call and no node call", …);
    ```
  - `supply-off.spec.ts` (`worker-off`): `/xrpl/supply` and `/xahau/supply` are 404 `short` with no call. `features-off.spec.ts` and `env.test.ts`: the generation strings gain `SUPPLY=…` at its sorted place (after `NFTS`, before `TOKENS`). `predeploy-check.test.ts`: `SUPLY: "on"` is refused, naming `SUPPLY` among the switches. `meta`: the title, description and canonical; no `og:image` of its own. `routes-wiring`: the route's `headers`, `handle` and `meta`. `check-bundle.test.ts`: `supply` is a dashboard page. `supply-bundle.test.ts` (the form of `validators-bundle.test.ts`): `ui/pages/SupplyPage.tsx`, `server/meta-supply.ts`, `domain/percent.ts`, `domain/time-words.ts` import nothing of `app/server` as a value.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test --project worker test/worker/supply-page test/worker/meta`, `pnpm test --project worker-off test/worker/supply-off test/worker/features-off`, `pnpm test app/server/env app/server/meta app/ui/routes-wiring scripts/predeploy-check scripts/check-bundle test/unit/supply-bundle` → FAIL.
- [ ] **Step 3: Implement** the switch everywhere it goes, the route, the loader, the meta builder and the `PAGES` row.
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` → exit 0 with `supply` under 160,000 B in the bundle table; `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit.** `git add app/routes.ts app/routes/net.supply.tsx app/server/meta-supply.ts app/ui/features.ts app/server/env.ts app/server/env.test.ts wrangler.jsonc vitest.config.ts test/worker/supply-page.spec.ts test/worker/supply-off.spec.ts test/worker/features-off.spec.ts test/worker/meta.spec.ts app/server/meta.test.ts app/ui/routes-wiring.test.tsx scripts/predeploy-check.test.ts scripts/bundle-budget.ts scripts/check-bundle.test.ts test/unit/supply-bundle.test.ts` — `feat(supply): /{net}/supply behind the SUPPLY switch`.

---

### Task 8: The Network menu and `navPage`

**Files:**
- Create: `app/ui/use-disclosure-menu.ts`, `app/ui/use-disclosure-menu.test.tsx`, `app/ui/route-handle.test.ts`, `app/ui/components/Header.test.tsx`, `test/e2e/header-menu.spec.ts`
- Modify: `app/ui/route-handle.ts`, `app/ui/components/Header.tsx`, `app/ui/components/icons.tsx` (`ChevronDownIcon`, 12 px, `aria-hidden`, if absent), `app/ui/components.css` (`.menu`, `.menu__summary`, `.menu__panel`, `.menu__item`), `app/ui/components/components.test.tsx` (its Network-link cases become the menu's), the handles of `app/routes/net.network.tsx` (`"overview"`), `net.validators.tsx` and `net.validators.$key.tsx` (`"validators"`), `net.amendments.tsx` and `net.amendments.$name.tsx` (`"amendments"`), `net.supply.tsx` (`"supply"`), `test/worker/supply-page.spec.ts`, `test/worker/supply-off.spec.ts`, `test/unit/supply-bundle.test.ts`, `test/unit/pages-css.test.ts` (a describe "the Network menu (components.css)")

**Interfaces:**
- Consumes: Task 7's switch; E8's and E11's header items.
- Produces:
  ```ts
  // route-handle.ts
  export type NavPage = "overview" | "validators" | "amendments" | "supply";
  // NetworkRouteHandle gains navPage?: NavPage
  export function navPageOf(matches: readonly UIMatch[]): NavPage | undefined;   // the deepest match that names one
  // Header.tsx
  type NavMenuItem = { label: string; to: (net: NetworkBrief) => string; page: NavPage; feature?: Feature };
  type NavItem = { label: string; to?: (net: NetworkBrief) => string; section?: NavSection; feature?: Feature }
               | { label: string; section: NavSection; items: readonly NavMenuItem[] };
  // use-disclosure-menu.ts
  export function useDisclosureMenu(ref: RefObject<HTMLDetailsElement | null>): void;
  ```

Rules (spec §2): the `NAV` item Network becomes `{ label: "Network", section: "network", items: [Overview /{id}/network, Validators /{id}/validators (feature validators), Amendments /{id}/amendments (feature validators), Supply /{id}/supply (feature supply)] }`, in its place. Markup of spec §2.2: `<details class="menu" data-menu="network">`, `<summary class="nav-item menu__summary">Network<ChevronDownIcon/></summary>`, `<ul class="menu__panel">` of `Link`s `.menu__item`; an item whose switch is off is `<span class="menu__item is-soon" aria-disabled="true">Supply <span class="soon">soon</span></span>`. Marking: the summary `.is-current` and `aria-current="true"` on every page of section `network`; an item `aria-current="page"` when the path (query ignored) is its `to`, `"true"` when `navPageOf` names it on another path, with the `--sunken` background (and a 2 px left rule under `forced-colors: active`). The hook: Escape while open and focus inside → close, focus the summary; a pointer down outside → close, focus stays; `focusout` whose `relatedTarget` is outside (not `null`) → close; a change of `useLocation()`'s pathname or search → close; when it opens, every other open `details[data-menu]` closes; hover opens nothing. Layout of spec §2.5: absolute panel `top: calc(100% + 6px); min-width: 230px`, items 36 px, 44 px under `(pointer: coarse)`, z-index above the page and below the search hints; in the folded nav (`.hdr__nav.is-open`) the panel is `position: static`, indented 12 px, items full width and 44 px; the chevron turns 180° on `.menu[open]`, no transition under `prefers-reduced-motion`.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // route-handle.test.ts
  it("names the deepest navPage, or none", …);
  // Header.test.tsx
  it("lists Ledgers, Transactions, Tokens, Network, Markets, AMM, NFTs, Network a disclosure of four items", …);
  it.each([["VALIDATORS", ["Validators", "Amendments"]], ["SUPPLY", ["Supply"]]])("with %s off, %s read soon and are no links", …); // Overview never
  it.each([["/xrpl/network", "Overview", "page"], ["/xrpl/validators?scope=all", "Validators", "page"], ["/xrpl/validators/nHK…", "Validators", "true"],
           ["/xrpl/amendments", "Amendments", "page"], ["/xrpl/amendments/AMM", "Amendments", "true"], ["/xrpl/supply", "Supply", "page"]])(
    "on %s, %s is aria-current=%s and the summary is current", …);
  it("on a page of another section nothing in the menu is current", …);
  // use-disclosure-menu.test.tsx
  it("Escape closes the open menu and focuses its summary", …);
  it("a pointer down outside closes it and leaves focus where it was", …);
  it("focus leaving closes it; a window blur does not", …);
  it("a navigation closes it", …);
  it("opening one menu closes the others", …);
  it("hovering opens nothing", …);
  ```
  `components.test.tsx`: the existing cases that looked for the Network link look for the summary. Worker: `supply-page.spec.ts` gains `it("the page without JavaScript has the menu: its summary and four links", …)`; `supply-off.spec.ts` gains `it("the menu's Supply item reads soon", …)`. CSS: the 36 / 44 px items, the static panel in the folded nav, the forced-colors border and rule, no transition under reduced motion. `supply-bundle.test.ts` adds `ui/use-disclosure-menu.ts` and `ui/components/Header.tsx`. `header-menu.spec.ts` (spec §12): Tab to Network, Enter opens, Tab through the items, Escape closes and focus is on the summary; a click outside closes; clicking Supply navigates and the panel is closed on the new page; `aria-current` on `/xrpl/supply`, on a validator page (`"true"`) and on the summary; at 375 px the folded nav shows the panel in the flow with 44 px items.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/route-handle app/ui/use-disclosure-menu app/ui/components/Header app/ui/components/components test/unit/pages-css`, `pnpm test --project worker test/worker/supply-page`, `pnpm test --project worker-off test/worker/supply-off` → FAIL.
- [ ] **Step 3: Implement** the type, the helper, the hook, the header, the icon, the CSS and the six handles.
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS. Then `pnpm build && pnpm check:bundle`: read the **network** page's figure first; over 160,000 B, move the hook into `Header.tsx` (no module boundary) before anything else and measure again. `pnpm verify` → exit 0; `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit.** `git add app/ui/route-handle.ts app/ui/route-handle.test.ts app/ui/use-disclosure-menu.ts app/ui/use-disclosure-menu.test.tsx app/ui/components/Header.tsx app/ui/components/Header.test.tsx app/ui/components/icons.tsx app/ui/components.css app/ui/components/components.test.tsx app/routes/net.network.tsx 'app/routes/net.validators.tsx' 'app/routes/net.validators.$key.tsx' 'app/routes/net.amendments.tsx' 'app/routes/net.amendments.$name.tsx' app/routes/net.supply.tsx test/worker/supply-page.spec.ts test/worker/supply-off.spec.ts test/unit/supply-bundle.test.ts test/unit/pages-css.test.ts test/e2e/header-menu.spec.ts` — `feat(header): the Network menu (Overview, Validators, Amendments, Supply)`.

---

### Task 9: End to end, accessibility, the README and the full verification

**Files:**
- Create: `test/e2e/supply.spec.ts`
- Modify: `test/e2e/fixture-control.ts` (`supplyVariant(kind)`), `test/e2e/a11y.spec.ts`, `README.md`

**Interfaces:**
- Consumes: everything above; E2's `E2E_FEATURES_OFF`, `contextFor`, the fixture server's `override`.
- Produces: `supplyVariant(kind: "not-computed" | "route-missing" | "no-reserves" | "escrowed-incomplete" | "stale" | "minted-failing"): Record<string, unknown>` (overrides for `fixtures.override`, made from the Task 2 files). Nothing else for later plans.

- [ ] **Step 1: Write the failing tests.**
  - `supply.spec.ts`, both networks: the figures of the fixtures on the page; the bar's cursor by keyboard (Tab to it, arrows, the tooltip's text); the Chart/Table toggle of both cards; the coverage note (`escrowed-incomplete`); the stale warning (`stale`); a failed minted card's Retry (`minted-failing`, then reset, Retry, the card loads); `not-computed` and `route-missing` give the try-again page; skipped when `E2E_FEATURES_OFF` lists `SUPPLY`, which runs the off case (404, the menu item "soon").
  - `a11y.spec.ts`: `/xrpl/supply`, `/xahau/supply`, and a page with the Network menu open, no axe violations, in both themes; no page scrolls sideways at 375 px.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test:e2e -- supply a11y` → the new cases FAIL.
- [ ] **Step 3: Implement** the variants, then the README (spec §14): "Switches" (the `SUPPLY` rows: what it gates, the values, decision 11's condition: on once the environment's data API serves a snapshot on both networks and escrowed is complete there; in the sandbox once it serves the snapshot, with the notes); "The data API and the node" (`networkSupply`, `networkMinted`); "The cache classes" (`slow` 300 s, the four calls); "The UI and the routes" (the route, the Network menu, `navPage`); a new section "The supply page" (calls, failures, states, coverage, the stale rule); "The chart kit" (`ShareBar compact`, `caption`, `share`, `unit`; `StatTile aside`; `StatGrid wide`; `finePercent`); "SEO and link previews" (`meta-supply.ts`); "Upstream fixtures"; "End-to-end tests" (the two specs, the a11y pages); "The client bundle check" (`pnpm build && pnpm check:bundle`: every page's figure, the network page's before and after the menu); the sandbox checklist (the page on both testnets with its notes; the menu).
- [ ] **Step 4: Run the whole suite.** `pnpm verify` → exit 0 (every page under its budget); `pnpm fixtures:check` → up to date; `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit.** `git add test/e2e/supply.spec.ts test/e2e/fixture-control.ts test/e2e/a11y.spec.ts README.md` — `test(supply): the supply page and the Network menu end to end; the README`.
- [ ] **Step 6: Report the deploy steps for the owner** (in the task report): deploy order D7 migration → syncer → api, then this build; `SUPPLY` stays `"off"` in `sandbox` and `production` until decision 11 holds there (production: a snapshot on both networks and escrowed `complete: true`, i.e. the history from 28,685,313; sandbox: a snapshot on both testnets), then a commit flipping it and a deploy (the switch is in the cache generation, so no stored page survives the flip); the Network menu ships with this build whatever `SUPPLY` says (its Supply item reads "soon" while off); rolling back is `"off"` and a deploy.

---

## Rulings

1. **The two paths go straight into `PATHS`** (spec §3.1 put them in `PENDING_PATHS` until a sync): Task 1 syncs D7 before any client code, so `openapi.d.ts` already has them, and `pending-paths.test.ts` would fail on a pending path the description has.
2. **The snapshot's time prints with `formatDateTime`** ("Oct 17, 2026, 16:08 UTC", the spec's own example in §5.1), not `formatUtc`, whose text is "2026-10-17 16:08:00 UTC".
3. **Compact figures of the supply use `compactFigure`** (two decimals with a suffix: "99.99B", "595.00M", "35.21B", the spec's examples), a helper of `supply-view.ts`; E2's `compactNumber` (three significant digits) would print the total as "100B". The chart summaries keep `compactNumber` throughout, so the spec's "61.20 XRP" reads "61.2 XRP" and "455.2K" reads "455K".
4. **Caption percents have one decimal** ("35.2%", "97.0%", as the spec's captions), tooltip and sentence shares `finePercent` (two decimals; two significant digits under 1%).
5. **`cards` are `PromiseSettledResult<…>`** (the spec's `Settled<…>` is not a type of the codebase) and the cards are E2's `Part<…>`; failures are reported as `networkPage` reports them (`reasonOf`, exported as a growth).
6. **The view builder takes the server `Network`** (it has `native` and `hasAmm`), not `NetworkBrief` (id and name only).
7. **Header tests**: the spec's `Header.test.tsx` and `route-handle.test.ts` are new files; the header's existing cases live in `components.test.tsx` ("Header and Shell") and are updated there.
8. **`StatGrid wide`** is new: the spec's `minmax(min(360px, 100%), 1fr)` is not the existing grid's.
9. **The fixture generator runs under `pnpm fixtures:sync`** (the spec said `pnpm fixtures`), and the e2e variants are built from the generated files in `fixture-control.ts`.
10. **Tags**: title `Supply · {network} · {PRODUCT_NAME}` (the spec's "Supply · XRPL" in `meta-network.ts`'s form); the description is made by the view builder, so the meta module the browser loads stays small.
11. **The minted summary ends with a period**, like the burned one; the spec's example had none.
12. **A part's `coverage` is checked only when present** (consistency pass): E8's `checkCoverage(body)` refuses a body without `coverage`, and D7's `burned` has none on a network that does not mint (D7 Task 9), so the shape check calls it for the parts that carry the key.
