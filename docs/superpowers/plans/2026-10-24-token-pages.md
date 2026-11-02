# Token Pages (E11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `/{net}/tokens`, `/{net}/token/{currency}.{issuer}` and `/{net}/token/{token}/holders`, their `token` link-preview image, the Tokens header item and every inbound token link, from D6's four routes, behind a new `TOKENS` switch, with the MPT tab drawn disabled for E14 to fill.

**Architecture:** Each page is a route under `/:net` whose loader checks the URL first (switch, path, query, marker) with no call, redirects to the one canonical URL, then makes D6's calls through the subrequest cache (cards raced against E2's 4.5 s deadline, all settled), one E9 names call, and hands the answers to a pure view builder in `app/server/token-view.ts`; the page components only draw data. `app/domain/token-params.ts` is the one place for token URLs, paths and links (`tokenLink`, which E13 consumes) and holds the MPT seam (`TOKEN_KINDS`, `mptAvailableOf`, `kindTabs`) that E14 fills. Fixtures for D6's answers are generated.

**Tech Stack:** React Router 8.4 (framework mode) on Cloudflare Workers, React 19, TypeScript, `bignumber.js`, `ripple-address-codec`, Vitest (`unit`, `components` with happy-dom, `worker` and `worker-off` in workerd), Playwright with axe.

**Spec:** `docs/superpowers/specs/2026-10-24-token-pages-design.md` (cited "spec §n"; the plan argues from the spec, executors read both). Its data side is D6, `DAPI/docs/superpowers/specs/2026-10-24-issued-tokens-design.md` ("D6 §n"), built by `DAPI/docs/superpowers/plans/2026-10-24-issued-tokens.md`, whose `docs/api-reference.md` "Tokens" section the types and fixtures follow.

**Branch:** `feat/explorer-pages-2` in `EXP = /Users/golobitch/github.com/GateHubNet/x-explorer-worktrees/explorer-pages-2`. `DAPI = /Users/golobitch/github.com/GateHubNet/data-api-worktrees/explorer-data-2` (branch `feat/explorer-data-2`) is read only. Nothing is pushed.

## Global Constraints

- **Before Task 1:** D6 is complete in DAPI (its Task 13 commit: `grep -c "/v2/tokens" $DAPI/docs/openapi.yaml` ≥ 4); E7–E10 are built on this branch: E7's `sandbox` block in `wrangler.jsonc` and `PublicNetwork.kind`/`name`; E8's `app/server/coverage.ts` (`Coverage`, `checkCoverage`, `coverageNote`), `app/ui/components/CoverageNote.tsx`, the `NFTS` switch and the NFTs header item; E9's `app/server/names-load.ts` (`collectAddresses`, `loadNames`, `NamesResult`, `NamesPart`), `app/ui/names.tsx` (`NamesProvider`), `AccountLink` reading names, `scripts/names-fixtures.ts`, and the "How we know" currencies of the account page. If one is missing, stop and report BLOCKED naming it. Other plans' pieces are named by file and symbol, never by task number.
- `pnpm verify` (api:check + typecheck + test + build + check:bundle) exits 0 before every commit; `pnpm fixtures:check` in every task that touches fixtures; `pnpm test:e2e` after every task that adds or changes a page.
- Commits: `feat(tokens): …`, `feat(data-api): …`, `test(fixtures): …`, `feat(og): …`, `docs: …` (the repo's style), a body saying why, and the last line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--amend`, never `git add -A` or `.` (name the files), never touch `.claude/`.
- **Edge classes (spec §6):** `/{net}/tokens` any view `minute`; `/{net}/token/{token}` `live`, behind a marker `MARKER_PAGE_CLASS`; `/{net}/token/{token}/holders` `minute` (behind a marker too); canonical redirects `redirectToCanonical` (`immutable` path only, `short` with the query); the LP-token redirect `slow`; 404s and the too-long search `short`; degraded answers and 5xx not stored; `/og/{net}/token/{token}.png` `slow`. Subrequests: `tokens`, `token`, `tokenHolders` `minute`; `tokenTransfers` `live`, with a marker `MARKER_PAGE_CLASS`; the pools call is the AMM list's key (`api.ammPools({ limit: 20, asset })`), the live AMM volume E5's (`api.ammVolume({ live: "day" })`). No new class or constant.
- **`TOKENS` off:** the three routes and the `token` image are a 404 of class `short` with no call; the header item is the "soon" label; every token link is what it was before E11 (codes stay text); search asks nothing of tokens. The switch is `"on"` at the top level and in `TOP_LEVEL_SWITCHES`, `"off"` in `sandbox` and `production`.
- **Browser files** (pages, UI components, the `meta-*.ts` builders) import nothing of `app/server` as values (but `./meta` for the tags' builders), nor `app/domain/asset.ts`, `app/domain/token-params.ts`, `app/domain/market-pair.ts` or any `ripple-*` package: every href and label is a string in the page data (the AMM pages' rule; `test/unit/token-bundle.test.ts` pins it). `token-params.ts` is Worker, scripts and tests only.
- Pages draw data and never fetch. Every figure is made from D6's exact strings with `bignumber.js`; no float reaches a text. All times UTC.
- **Names:** one E9 names call per page: `loadNames(api, collectAddresses(…the shown parts), ctx)`; every address is an `AccountLink` (E9's props, unchanged) inside `NamesProvider`. A failed names call shows addresses and is E9's rule (degraded).
- **Coverage:** E8's pieces only: `checkCoverage` in the shape checks; `coverageNote(coverage, words)` with words `"trust lines"` (list, token figures, holders) and `"transfers"` (transfers card); `CoverageNote` directly under its list or figure; nothing when `complete`.
- **Network words:** names from `network.name` (E7: "XRPL Testnet" in the sandbox); amounts in `network.native`; "DEX and AMM" where `network.hasAmm`, else "DEX"; toml file `xrp-ledger.toml` / `xahau.toml` by `network.software`.
- **The E14 seam:** `TOKEN_KINDS = ["issued", "mpt"]`; `mptAvailableOf(net, features)` returns `false`; `?kind=mpt` is dropped by the canonical redirect; `TokensPage` draws its body by kind from `data.issued` (E14 adds `data.mpt`); E14 changes `mptAvailableOf`, adds its branch to the loader and `tokensPage`, and widens `DataApi.tokens`' `kind`.
- **`tokenLink(net, asset, features)`** (`app/domain/token-params.ts`) is the one place that decides where a token's code leads (E13 calls it from its view builder).
- Accessibility: statuses are an icon and a word; 44 px targets (tabs, the form's button, "Show all", pagers, copy buttons); tables are `DataTable` with names; coins and meters `aria-hidden` with their facts beside them; the search field has a visible label and its error tied with `aria-describedby`; the disabled MPT tab says why. JS budget: the three pages are `lookup` (150,000 B gzip).
- Worker specs share one Cache API per file: failure tests first, distinct tokens, the order each task gives; a key an earlier test failed is held 5 s (E2's hold), so a later override of it moves the fake `Date` past `FAILURE_HOLD_SECONDS`.

## Review Focus

1. **A token URL written another way.** `usd.r…`, the 40-hex of `RLUSD` in lower case, the hex of `USD`, `NPUSD+r…`, `NPUSD|r…`, a space, the native code alone, `XRP.r…`, an X-address or bad-checksum issuer, an LP token's `03…` code: one 302 to the canonical path (`immutable`) or the pool (`slow`), or a 404 (`short`, the native one with its note), never a call first. Pinned by Task 3 `parseTokenPath`/`tokenHref` tables and Task 9 `token.spec.ts` "redirects and 404s make no call".
2. **A token the index does not know, against D6 failing.** `token not found` is a stored 404 with the coverage note from a `limit=1` list call (and without the note when that call fails); a 5xx, a 429, a timeout, a malformed 200, a 400 for a checked path and a `Cannot GET` are a 503 never stored. Pinned by Task 9 `token.spec.ts` "404 with the coverage note", "404 without the note when the coverage call fails", "Cannot GET is a 503 not stored".
3. **The switch off.** Every token route and image is a 404 with no call, the header says "soon", the account, pair and pool pages keep their codes as text, search shows today's help page. Pinned by `test/worker/tokens-off.spec.ts` (built up in Tasks 4, 6, 9, 10, 11, 12, 13).
4. **A card failing while the token is known.** Holders, transfers, pools, the AMM volume, the names call, the node's `account_info`: the page is a 200, degraded and not stored, each card with its `SectionError` (Retry) or its note; settings from the node when D6 has none; "The issuer's settings couldn't be read." when both lack them. Pinned by Task 7 `token-view.test.ts` failure cases and Task 9 `token.spec.ts` "each card failure is a 200 with its SectionError, not stored".
5. **Xahau and the testnets.** XAH units, "DEX trades" words, no AMM calls (#4, #5) and the board's AMM note, `xahau.toml`, the MPT tab's Xahau note, the clawback bit `0x1000` from `account_info`, and "XRPL Testnet" names in the sandbox. Pinned by Task 5 `kindTabs` cases, Task 7 Xahau cases, Task 9 "xahau makes no AMM call", Task 11 `account-view.test.ts` "Xahau's clawback flag".

---

### Task 1: D6's API description, types, client and shape checks

**Files:**
- Modify (generated by the sync): `api/openapi.yaml`, `app/server/openapi.d.ts`
- Modify: `app/server/api-types.ts`, `app/server/data-api.ts` (four `PATHS` entries, four methods)
- Create: `app/server/token-shape.ts`, `app/server/token-shape.test.ts`, `test/support/token-samples.ts`
- Test: `test/worker/data-api.spec.ts`

**Interfaces:**
- Consumes: E8's `Coverage`, `checkCoverage` (`app/server/coverage.ts`); E2's `get()` options (`finish`), the "Cannot GET" rule; `isDecimalText`, `isIsoTime`, `isWhole`, `isBoolean`, `isAccount`, `rowsOf`, `fields`, `optionalFields` (`aggregate-shape.ts`); `MARKER_PAGE_CLASS`.
- Produces, `api-types.ts` (from DAPI's `docs/api-reference.md` "Tokens", keys in its order, optional exactly where it says a key is absent):
  ```ts
  export interface IssuedTokenRow { rank: number; currency: string; code?: string; issuer: string; holders: number; trust_lines: number; supply: string;
    price?: string; price_change?: string; price_time?: string; native_volume?: string; trades?: number; domain?: string; listed: boolean; name?: string }
  export interface IssuedTokensTotals { tokens: number; tokens_with_10_holders: number; holders: number; native_volume?: string }
  export interface TokensResponse { result: "success"; coverage: Coverage; kind: "issued"; ledger_index?: number; close_time?: string;
    totals?: IssuedTokensTotals; total?: number; total_below?: number; count: number; marker?: string; tokens: IssuedTokenRow[] }
  export interface TokenToml { name?: string; desc?: string; icon?: string; symbol?: string; display_decimals?: number; asset_class?: string; asset_subclass?: string; attestation?: string }
  export interface IssuerSettings { transfer_fee: string; global_freeze: boolean; no_freeze: boolean; allow_trust_line_clawback: boolean; require_auth: boolean; default_ripple: boolean }
  export interface TokenMarket { counter_currency: string; counter_issuer?: string; count: number; volume: string; counter_volume: string;
    native_volume?: string; last: string; change?: string; last_time: string; amm_pool?: boolean }
  export interface TokenDetail { currency: string; code?: string; issuer: string; holders: number; trust_lines: number; supply: string; price?: string;
    price_change?: string; price_time?: string; native_volume?: string; trades?: number; domain?: string; toml_url?: string; listed: boolean;
    toml?: TokenToml; issuer_settings?: IssuerSettings; markets: TokenMarket[]; last_ledger: number }
  export interface TokenAnswer { result: "success"; coverage: Coverage; ledger_index: number; close_time: string; token: TokenDetail }
  export interface TokenHolder { rank: number; holder: string; balance: string; share: string; limit: string; frozen: boolean; authorized: boolean }
  export interface TokenHoldersResponse { result: "success"; coverage: Coverage; ledger_index: number; close_time: string; supply: string; count: number; marker?: string; holders: TokenHolder[] }
  export interface TokenTransfer { hash: string; ledger_index: number; executed_time: string; source: string; destination: string; amount: string; source_tag?: number; destination_tag?: number }
  export interface TokenTransfersResponse { result: "success"; coverage: Coverage; count: number; marker?: string; transfers: TokenTransfer[] }
  ```
- Produces, `DataApi`:
  ```ts
  tokens(q: { kind: "issued"; limit: number; minHolders?: number; q?: string; marker?: string }, opts?: FreshOptions): Promise<TokensResponse>;  // /v2/tokens?kind=…&limit=…[&marker][&min_holders][&q], minute
  token(asset: { currency: string; issuer: string }, opts?: FreshOptions): Promise<TokenAnswer>;            // /v2/tokens/{token}, minute; the whole answer (finish: checkToken)
  tokenHolders(asset: { currency: string; issuer: string }, q: { limit: number; marker?: string }, opts?: FreshOptions): Promise<TokenHoldersResponse>;  // minute
  tokenTransfers(asset: { currency: string; issuer: string }, q: { limit: number; marker?: string }, opts?: FreshOptions): Promise<TokenTransfersResponse>; // ?descending=true&limit=…[&marker]; live, with a marker MARKER_PAGE_CLASS
  ```
  The path segment is `` `${asset.currency}.${asset.issuer}` `` (the currency as the ledger holds it), through `segment("token", …)`; the template parameter is named as `api/openapi.yaml` names it.
- Produces, `token-shape.ts`: `checkTokens(body, path): TokensResponse`, `checkToken(body, path, asked): TokenAnswer` (the answer's `currency` and `issuer` are the asked ones), `checkTokenHolders(body, path): TokenHoldersResponse`, `checkTokenTransfers(body, path): TokenTransfersResponse`; each throws `UpstreamError("server", …, { status: 200 })`: lists arrays; amounts, prices and `supply` decimal text; counts, ranks, ledgers whole numbers; booleans; issuers, holders, sources and destinations classic addresses; times ISO; `share` `/^\d+\.\d{6}$/`; `display_decimals` a whole number 0–30; `coverage` through `checkCoverage`.
- Produces, `test/support/token-samples.ts`: `tokensSample`, `tokenSample`, `holdersSample`, `transfersSample`, each `(over?) => T`, small valid XRPL answers of D6 §5.

- [ ] **Step 1: Sync and write the failing tests.** Run `DATA_API_REPO=$DAPI pnpm api:sync`; `git diff --stat api/openapi.yaml app/server/openapi.d.ts` must show `/v2/tokens`, `/v2/tokens/{…}`, `/{…}/holders`, `/{…}/transfers` (stop and report BLOCKED otherwise). Then:
  ```ts
  // token-shape.test.ts
  it.each([["tokens", checkTokens, tokensSample()], ["token", …], ["holders", …], ["transfers", …]])("accepts a well-formed %s and returns it", …);
  it.each([["a supply that is a number", tokensSample({ tokens: [{ …, supply: 1 }] })], ["tokens that is an object", { …, tokens: {} }],
    ["an issuer that is an X-address", …], ["a rank that is text", …], ["a share with 4 decimals", …], ["a coverage without complete", …],
    ["display_decimals 31", …], ["another token than the one asked", …]])("refuses %s with a server error", …);
  // data-api.spec.ts
  it("asks D6's four paths with their queries and classes", …);   // tokens (minute, ?kind=issued&limit=20&min_holders=10), token (minute,
  //   /v2/tokens/524C555344000000000000000000000000000000.rMxCK…), holders (minute, ?limit=10), transfers (live, ?descending=true&limit=20;
  //   with a marker slow)
  it.each(FOUR)("%s: a malformed 200 is a server error and is not stored", …);
  it("keeps token not found as not_found and makes Cannot GET a server error", …);
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/token-shape` and `pnpm test --project worker test/worker/data-api` → FAIL: missing exports and methods.
- [ ] **Step 3: Implement** the types, the four `PATHS` entries, the methods (each with its check as `finish`) and the samples.
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` exits 0 (`api:check` passes on the synced file).
- [ ] **Step 5: Commit.** `git add api/openapi.yaml app/server/openapi.d.ts app/server/api-types.ts app/server/data-api.ts app/server/token-shape.ts app/server/token-shape.test.ts test/support/token-samples.ts test/worker/data-api.spec.ts` — `feat(data-api): D6's token routes, typed and checked` (body: the description synced from data-api feat/explorer-data-2 at <D6's commit>).

---

### Task 2: Generated token fixtures

**Files:**
- Create: `scripts/token-fixtures.ts`, `test/unit/token-fixtures.test.ts`, `test/support/token-cases.ts`
- Modify: `scripts/http-fixtures.ts` (`generate()` puts every entry of `tokenFixtures(net, …)` for both networks), `scripts/names-fixtures.ts` (E9's: its addresses gain `tokenFixtureAddresses(net)`), `test/support/upstream-core.ts` (`dataApiAbsent`: `/v2/tokens/{t}` and `/v2/tokens/{t}/holders` → 404 `token not found`), `test/unit/upstream-core.test.ts`, `test/fixtures/PROVENANCE.md` ("Token answers": D6's spec and commit followed; the recorded `account_info`), `README.md` ("Upstream fixtures" rows)
- Recorded: `test/fixtures/http/xrpl/node/account_info/rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS.json` (LIONS' issuer)
- Generated by `pnpm fixtures:sync`: `test/fixtures/http/{xrpl,xahau}/data-api/tokens…`, the pools files below, and the names file's new entries

**Interfaces:**
- Consumes: Task 1 types; `readLedgers(net)`, `dataApiLastValidated`, `encodeMarker`, `fixtureText` (`scripts/http-fixtures.ts`); `mulberry32`, `seedOf` (`scripts/synthetic.ts`); the AMM fixtures' pools (`ammFixtures()` output, in memory, inside `generate()`); `dataApiFile`, `canonicalQuery`.
- Produces:
  ```ts
  export function tokenFixtures(net: NetworkName, input: { ledgers: readonly RawLedger[]; last: LastValidated; pools: readonly AmmPool[] }):
    Array<{ path: string; query: string; value: unknown }>;
  export function tokenFixtureAddresses(net: NetworkName): string[];      // every issuer, holder and transfer party the token files show
  // test/support/token-cases.ts (worker specs, `import.meta.glob` as validators-cases.ts reads files)
  export type TokenCase = "rlusd" | "usd" | "lions" | "few-holders" | "lp" | "evr" | "xahau-unlisted";
  export async function tokenCase(net: NetworkId, which: TokenCase): Promise<{ currency: string; issuer: string; path: string }>;  // path = the canonical URL segment
  export async function tokensMarker(net: NetworkId): Promise<string>;        // the second list page's marker
  export async function transfersMarker(net: NetworkId): Promise<{ token: string; marker: string }>;
  export async function holdersMarker(net: NetworkId): Promise<{ token: string; marker: string }>;
  ```

**What the generator writes** (spec §12; D6's shapes, key orders and rules; seeded per network and route; file names are `dataApiFile`'s, whose `canonicalQuery` sorts parameters):
- **Lists:** about 60 seeded tokens with 10 or more holders and 40 below, around the featured ones; ranks, `total`, `total_below`, `totals` by D6's rules (§5.1). Files: `tokens@kind=issued&limit=20&min_holders=10.json` and its 2 marker pages (`…&marker=M…`), `…&min_holders=10&q=USD`, `…&min_holders=10&q=<an issuer>`, `tokens@kind=issued&limit=20.json` and its marker pages (all), `tokens@kind=issued&limit=1&min_holders=10.json` (the 404's coverage); Xahau the same with its own seeds. `coverage` `{ from_ledger_index: <the first recorded ledger of the network>, complete: false }`.
- **Featured tokens:** XRPL `RLUSD` by `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De` (a text code, listed, `allow_trust_line_clawback: true`, markets against XRP and others), `USD` by `rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B` (a transfer fee `"0.2"`, not listed), `LIONS` by `rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS` (no domain, no `issuer_settings`: the recorded `account_info` serves them), a token with 4 holders; Xahau `EVR` by `rEvernodee8dJLaFsujS6q1EiXvZYmHXr8` (listed, XAH price) and one unlisted seeded token. Each: `tokens/<CUR>.<issuer>.json`, `…/holders@limit=10.json`, `…/holders@limit=50.json` (and one marker page), `…/transfers@descending=true&limit=20.json` (and one marker page for RLUSD). Holders are the recordings' real addresses first, then seeded ones; transfers are derived from the recorded payments that delivered the token where the recordings have them, seeded otherwise.
- **Pools:** for each featured XRPL token without `amm/pools@asset=<CUR>+<issuer>&limit=20.json`, that file, derived from `input.pools`: the live pools holding the token, in the list's order. The XRP/RLUSD pool's LP token is the `lp` case (its account and `03…` currency from the pools).
- **Recording** `account_info` of `rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS`: one JSON-RPC POST of `{"method":"account_info","params":[{"account":"…","ledger_index":"validated"}]}` to `https://s1.ripple.com:51234/`, the whole answer written with `fixtureText` at `nodeFile`'s path, and a "Recorded node answers" row (node, time, `ledger_index`). Outbound network needed: if unreachable, stop and report BLOCKED; never hand-write it.

- [ ] **Step 1: Write the failing tests.** `token-fixtures.test.ts` (reads `generate()`'s map): `it.each(NETS)("%s: every file holds D6's keys in their order")`; `it("ranks run on across marker pages, and pages concatenate without a token twice")`; `it("total, total_below and totals agree with the rows")`; `it("every holder's share is its balance over supply, 6 decimals half up, and holders are ordered by balance")`; `it("every issuer, holder, source and destination is a valid classic address")`; `it("has every TokenCase on its network")`; `it("the same output whatever order the files are written in")`. `upstream-core.test.ts`: `it("answers an unknown token and its holders with token not found, its transfers with Cannot GET")`.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test test/unit/token-fixtures test/unit/upstream-core` → FAIL.
- [ ] **Step 3: Implement** the generator and the cases helper, record the `account_info`, wire `generate()` and E9's names addresses, run `pnpm fixtures:sync`, write PROVENANCE and the README rows.
- [ ] **Step 4: Run them to verify they pass.** Step 2's command → PASS; `pnpm fixtures:check` → up to date; `pnpm verify` exits 0.
- [ ] **Step 5: Commit.** `git add scripts/token-fixtures.ts scripts/http-fixtures.ts scripts/names-fixtures.ts test/support/token-cases.ts test/support/upstream-core.ts test/unit/token-fixtures.test.ts test/unit/upstream-core.test.ts test/fixtures/http test/fixtures/PROVENANCE.md README.md` — `test(fixtures): generated answers of D6's token routes`.

---

### Task 3: Token URLs, paths, links and kinds

**Files:**
- Create: `app/domain/token-params.ts`, `app/domain/token-params.test.ts`
- Modify: `app/ui/components/SegmentedLinks.tsx` (the type only: `SegmentLink` gains `disabled?: { tag?: string; note?: string }`; Task 5 draws it)

**Interfaces:**
- Consumes: `parseAssetText`, `assetText`, `Asset`, `NativeCode` (`asset.ts`); `parseTrail`, `MAX_TRAIL` (`paging.ts`); the query writing of `amm-params.ts`; `poolLink`; `Features`; `SegmentLink` (type only).
- Produces:
  ```ts
  export const TOKEN_KINDS = ["issued", "mpt"] as const;
  export type TokenKind = (typeof TOKEN_KINDS)[number];
  export const TOKEN_SEARCH_MAX = 64;
  export const LP_CURRENCY = /^03[0-9A-F]{38}$/;
  export interface TokensParams { kind: TokenKind; q?: string; all: boolean; marker?: string; back: string[] }
  /** The first of a repeat; `kind` "mpt" only with mptAvailable (else issued); `q` trimmed, empty dropped (kept at any length: the loader checks it);
   *  `all` only "1"; `back` only with `marker`; unknown parameters dropped. */
  export function parseTokensParams(search: URLSearchParams, o: { mptAvailable: boolean }): TokensParams;
  export function tokensQuery(p: TokensParams): string;                  // canonical order kind, q, all, marker, back; defaults left out; "" or "?…"
  export function tokensHref(net: string, p?: Partial<TokensParams>): string;
  export interface TokenPageParams { marker?: string; back: string[] }
  export function parseTokenPageParams(search: URLSearchParams): TokenPageParams;
  export function tokenPageQuery(p: TokenPageParams): string;
  export type TokenPath =
    | { kind: "token"; asset: { currency: string; issuer: string }; canonical: string }   // canonical: assetText(asset), the path segment
    | { kind: "lp"; issuer: string }
    | { kind: "native" }
    | { kind: "none" };
  export function parseTokenPath(network: { native: NativeCode }, decoded: string): TokenPath;
  export function tokenHref(net: string, asset: { currency: string; issuer: string }, p?: TokenPageParams): string;          // /{net}/token/{escaped assetText}
  export function tokenHoldersHref(net: string, asset: { currency: string; issuer: string }, p?: TokenPageParams): string;
  /** Where a token's code leads: an LP token's pool (`poolLink`); else the token page while `features.tokens`; else null (the code stays text). */
  export function tokenLink(net: string, asset: Asset, features: Features): string | null;
  /** E14's seam: false here; E14 makes it `features.mpt && net.hasMpt`. */
  export function mptAvailableOf(net: { id: string }, features: Features): boolean;
  /** "Issued tokens" (a link, current for issued) and "MPT": a link when available, else disabled: on Xahau with the note "MPT isn't enabled on Xahau.", elsewhere with the tag "soon". */
  export function kindTabs(net: { id: string }, kind: TokenKind, mptAvailable: boolean): SegmentLink[];
  ```

- [ ] **Step 1: Write the failing tests** (`token-params.test.ts`):
  ```ts
  const RLUSD = { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" };
  expect(parseTokenPath({ native: "XRP" }, "usd.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B")).toEqual({ kind: "token", asset: { currency: "USD", issuer: "rvYAf…" }, canonical: "USD.rvYAf…" });
  expect(parseTokenPath({ native: "XRP" }, "524c555344000000000000000000000000000000.rMxCK…")).toMatchObject({ kind: "token", asset: RLUSD, canonical: "RLUSD.rMxCK…" });
  expect(parseTokenPath({ native: "XRP" }, "0000000000000000000000005553440000000000+rvYAf…")).toMatchObject({ canonical: "USD.rvYAf…" });
  expect([parseTokenPath(XRPL, "XRP"), parseTokenPath(XRPL, "xrp"), parseTokenPath(XAHAU, "XAH")]).toEqual([{ kind: "native" }, { kind: "native" }, { kind: "native" }]);
  expect(parseTokenPath(XRPL, "03A1F7" + "0".repeat(34) + ".rhWTXC…")).toEqual({ kind: "lp", issuer: "rhWTXC…" });
  expect([parseTokenPath(XRPL, "USD.X7…"), parseTokenPath(XRPL, "USD.rBadChecksum…"), parseTokenPath(XRPL, "USD"), parseTokenPath(XRPL, "XRP.rvYAf…")].map((p) => p.kind)).toEqual(["none", "none", "none", "none"]);
  expect(tokenHref("xrpl", RLUSD)).toBe("/xrpl/token/RLUSD.rMxCK…");
  expect(tokenHref("xrpl", { currency: "015841550000000041F78E0A28CBF19200000000", issuer: "r…" })).toBe("/xrpl/token/015841550000000041F78E0A28CBF19200000000.r…");
  expect(tokenHoldersHref("xrpl", RLUSD, { marker: "M2", back: ["M1"] })).toBe("/xrpl/token/RLUSD.rMxCK…/holders?marker=M2&back=M1");
  expect(tokenLink("xrpl", RLUSD, { ...NO_FEATURES, tokens: true })).toBe("/xrpl/token/RLUSD.rMxCK…");
  expect([tokenLink("xrpl", RLUSD, NO_FEATURES), tokenLink("xrpl", { currency: "XRP" }, ON)]).toEqual([null, null]);
  expect(tokenLink("xrpl", { currency: "03A1F7…", issuer: "rhWTXC…" }, { ...ON, ammPages: true })).toBe("/xrpl/amm/rhWTXC…");
  ```
  Plus: `parseTokensParams` and `tokensQuery` round-trip the canonical forms; `?kind=issued&q=&all=0&back=M1&q=b&x=1` → `{ kind: "issued", all: false, back: [] }` with no `q` (the first of a repeat is read, `""`, and an empty value is dropped); `?kind=mpt` → issued without `mptAvailable`, mpt with it; a 65-character `q` is kept; `tokensHref("xrpl", { all: true, q: "USD" })` is `/xrpl/tokens?q=USD&all=1`; `kindTabs` on XRPL without MPT (MPT disabled, tag "soon"), on Xahau (note "MPT isn't enabled on Xahau."), with MPT available (a link to `?kind=mpt`, current on that kind); `mptAvailableOf` is false for both networks and every feature set.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/domain/token-params` → FAIL: module not found.
- [ ] **Step 3: Implement** `token-params.ts`.
- [ ] **Step 4: Run them to verify they pass.** Same command → PASS; `pnpm verify` exits 0.
- [ ] **Step 5: Commit.** `git add app/domain/token-params.ts app/domain/token-params.test.ts app/ui/components/SegmentedLinks.tsx` — `feat(tokens): token URLs, paths, links and the kind tabs`.

---

### Task 4: The `TOKENS` switch and the Tokens header item

**Files:**
- Modify: `app/ui/features.ts` (`TOKENS` appended to `FEATURE_VARS`, `tokens` in `FEATURE_NAME`), `app/server/env.ts` (`TOKENS: "on" | "off"`), `wrangler.jsonc` (every block: top level `"on"`, `sandbox` and `production` `"off"`; the head comment's list), `vitest.config.ts` (`TOP_LEVEL_SWITCHES.TOKENS: "on"`), `scripts/predeploy-guard.ts` and `scripts/predeploy-check.test.ts` (the misspelling case `TOKEN`), `app/ui/route-handle.ts` (`NavSection` gains `"tokens"`), `app/ui/components/Header.tsx` (`NAV`), `app/ui/components/components.test.tsx` (Header), `README.md` ("Switches": the `TOKENS` row and its condition; the header's items)
- Create: `test/worker/tokens-off.spec.ts`

**Interfaces:**
- Consumes: E2's switch mechanism; E8's NFTs item (last) and E7's environment names.
- Produces: `Features.tokens`; `NavSection` `"tokens"`; `NAV` gains `{ label: "Tokens", to: (net) => \`/${net.id}/tokens\`, section: "tokens", feature: "tokens" }` between Transactions and Network (E12 then turns Network into its menu).

- [ ] **Step 1: Write the failing tests.** `components.test.tsx`: `it("puts Tokens after Transactions and before Network, a link with TOKENS on")`; `it("draws Tokens as the soon label with TOKENS off")`; `it("marks Tokens aria-current=page on the list and true on a token page")` (route handles `navSection: "tokens"` at `/xrpl/tokens` and `/xrpl/token/X`). `predeploy-check.test.ts`: a build without `TOKENS`, with `TOKENS: "yes"`, or with `TOKEN` is refused. `tokens-off.spec.ts` (`worker-off`): `it("the header's Tokens item is the soon label")` on `/xrpl`.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/components/components scripts/predeploy-check` and `pnpm test --project worker-off test/worker/tokens-off` → FAIL.
- [ ] **Step 3: Implement** the switch, the section and the item; update the README.
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` exits 0. (The item leads to the not-found page until Task 6.)
- [ ] **Step 5: Commit.** `git add app/ui/features.ts app/server/env.ts wrangler.jsonc vitest.config.ts scripts/predeploy-guard.ts scripts/predeploy-check.test.ts app/ui/route-handle.ts app/ui/components/Header.tsx app/ui/components/components.test.tsx test/worker/tokens-off.spec.ts README.md` — `feat(tokens): the TOKENS switch and the Tokens header item`.

---

### Task 5: The list: view builder, page and tags

**Files:**
- Create: `app/server/token-view.ts` (the list part), `app/server/token-view.test.ts`, `app/server/meta-tokens.ts`, `app/ui/pages/TokensPage.tsx`, `app/ui/pages/IssuedTable.tsx`, `app/ui/pages/token-parts.tsx` (`ListedMark`), `app/ui/pages/TokensPage.test.tsx`, `test/unit/token-bundle.test.ts`
- Modify: `app/ui/components/SegmentedLinks.tsx` (**Growth**: draws a `disabled` segment, the field Task 3 typed), `app/ui/components/SegmentedLinks.test.tsx`, `app/server/meta.test.ts`, `app/ui/pages.css`

**Interfaces:**
- Consumes: Task 1 types; Task 3 `kindTabs`, `tokensHref`, `tokenHref`, `TOKEN_SEARCH_MAX`; E8's `coverageNote`; E9's `NamesPart`; `formatCurrency`, `decodesCurrency`, `compactNumber`, `formatPrice`, `formatAmount` (`format.ts`); `trailPaging`; `PublicNetwork`.
- Produces:
  ```ts
  export interface TokensInput { net: PublicNetwork; params: TokensParams; mptAvailable: boolean;
    answer: TokensResponse | null;          // null: the search was too long, no call
    names: NamesPart }
  export function tokensPage(input: TokensInput): TokensPageData;
  export interface TokensPageData {
    kind: "tokens"; network: NetworkInfo; tokenKind: TokenKind; tabs: SegmentLink[]; intro: string; source: string;
    tiles: Array<{ label: string; value: string; sub: string }>;
    search: { action: string; q: string; error: string | null; label: string; placeholder: string; hidden: Array<{ name: string; value: string }> };
    showAll: { href: string; label: string } | null;
    issued: { rows: IssuedRowView[]; empty: string | null; note: { text: string; more?: { text: string; href: string } }; footnote: string } | null;
    coverage: ReturnType<typeof coverageNote>;
    pager: { newerHref: string | null; olderHref: string | null; labels: { newer: "Previous"; older: "More tokens" } };
    names: NamesPart; meta: TokensMetaFacts;
  }
  export interface IssuedRowView { key: string; rank: string; code: string; codeTitle?: string; codeHidden?: string; name?: string; href: string;
    issuer: string; holders: string; supply: string; price: string; volume: string; listed: boolean }
  export function tokensMeta(facts: TokensMetaFacts, ctx: MetaContext): MetaDescriptor[];          // meta-tokens.ts
  export function TokensPage({ data }: { data: TokensPageData }): JSX.Element;                     // body by kind: IssuedTable for issued (E14 adds MptTable)
  export function IssuedTable({ rows, caption }: { rows: readonly IssuedRowView[]; caption: string }): JSX.Element;
  export function ListedMark({ listed }: { listed: boolean }): JSX.Element;
  ```

Rules (spec §2.1): intro "Tokens on {network}, ranked by holders. Names come from each issuer's toml."; source `/v2/tokens?kind=issued&min_holders=10` (without `min_holders` under `all`); tiles "Tokens with 10+ holders" (`totals.tokens_with_10_holders`, sub "{tokens − that} more have fewer than 10 holders"), "Holders" (sub "accounts holding at least one issued token"), "Volume, 24 h" (`compactNumber(native_volume)` + native code, sub "DEX and AMM trades of every pair" / "DEX trades of every pair"; "—" without it); the search form (GET, action `tokensHref(net)`, field `q` labelled "Code, name or issuer", button "Search", hidden `all=1` under `all`, error "Search for at most 64 characters"); "Show all ({total_below} hidden)" → `?all=1`, or "Hide tokens with fewer than 10 holders" under `all`; the note "Showing {first rank}–{last rank} of {total} tokens with 10 or more holders" (`all`: "… of {total} tokens"); with `q`: "{total} matches" (1: "1 match") and, when `total_below` > 0 and not `all`, " · {total_below} more among tokens with fewer than 10 holders" linking the same search with `all=1`; footnote "Holders: accounts with a positive balance. Supply: the sum of their balances. Price: the last trade against {native}."; empty "No issued tokens match “{q}”."; a row's code `formatCurrency(currency)`, a hex that decodes shown as its text with the hex in `codeTitle` and `codeHidden` ("currency code {hex}"), the toml `name` under it; price `formatPrice` or "—"; volume compact or "—"; pager by `trailPaging` with `tokensHref`. `TokensPage` wraps its body in `NamesProvider`, draws the `CoverageNote` directly under the table, the MPT tab through `SegmentedLinks` ("Kind of token"), the coin `PairCoins` with one code (`aria-hidden`).

- [ ] **Step 1: Write the failing tests.**
  - `token-view.test.ts` (`tokensPage`): tiles with and without `native_volume`, Xahau's words; the note without `q` (ranks 21–40 on page 2), with `q` and `total_below` (the "more" link keeps `q`, adds `all=1`), with `all`; "Show all (48,206 hidden)" and its opposite; a hex code row (text, title, hidden sentence) and a non-decodable hex (the hex itself); the too-long search (`answer: null`): the error, no rows, no pager; the empty search; the pager's hrefs; the tabs passed through; the coverage note present when incomplete, `null` when complete.
  - `TokensPage.test.tsx`: every state above drawn; the tabs with MPT "soon" (XRPL) and the Xahau note tied by `aria-describedby`; the form's error tied to the field; `ListedMark` icon and hidden words ("listed in the issuer's toml" / "not listed in the issuer's toml"); no fetch.
  - `SegmentedLinks.test.tsx`: a disabled segment is a `span` with `aria-disabled="true"`, its tag visible, its note described.
  - `meta.test.ts`: `tokensMeta` gives "Tokens · XRPL · explorer", spec §7.1's description, canonical and `og:*` with `twitter:card=summary` and no image on the default view; "Tokens matching “q”", "All tokens", "More tokens" with `noindex, follow` and none of canonical or `og:*`.
  - `token-bundle.test.ts` (the scanner of `amm-bundle.test.ts`): `ui/pages/TokensPage.tsx`, `IssuedTable.tsx`, `token-parts.tsx` import nothing of `app/server`, `domain/asset`, `domain/token-params`, `domain/market-pair` or `ripple-*` as values, nor through their closure; `server/meta-tokens.ts` imports of `app/server` only `./meta`.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/token-view app/ui/pages/TokensPage app/ui/components/SegmentedLinks app/server/meta test/unit/token-bundle` → FAIL.
- [ ] **Step 3: Implement** the builder, the tags, the components, the growth and the CSS.
- [ ] **Step 4: Run them to verify they pass.** Step 2's command → PASS; `pnpm verify` exits 0.
- [ ] **Step 5: Commit.** `git add app/server/token-view.ts app/server/token-view.test.ts app/server/meta-tokens.ts app/server/meta.test.ts app/ui/pages/TokensPage.tsx app/ui/pages/IssuedTable.tsx app/ui/pages/token-parts.tsx app/ui/pages/TokensPage.test.tsx app/ui/components/SegmentedLinks.tsx app/ui/components/SegmentedLinks.test.tsx app/ui/pages.css test/unit/token-bundle.test.ts` — `feat(tokens): the token list's view and page`.

---

### Task 6: The list: route and loader

**Files:**
- Create: `app/routes/net.tokens.tsx`, `test/worker/tokens.spec.ts`
- Modify: `app/routes.ts` (`route("tokens", "routes/net.tokens.tsx")`), `test/worker/tokens-off.spec.ts`, `test/worker/meta.spec.ts`, `scripts/bundle-budget.ts` and `scripts/check-bundle.test.ts` (`{ name: "tokens", route: "routes/net.tokens", budget: "lookup" }`)

**Interfaces:**
- Consumes: Tasks 1, 3, 5; E9's `collectAddresses`, `loadNames`; `requireNetwork`, `cached`, `forwardCacheClass`, `redirectToCanonical`, `queryOf`, `isMarker`, `upstreamOutage`, `clientsFor`, `metaContext`.
- Produces: route id `routes/net.tokens`; `handle = { navSection: "tokens" }`.

**Loader** (spec §1.3, §2.3, §2.4): `requireNetwork`; `!net.features.tokens` → `cached({ notFound: \`the token pages on ${net.name}\` }, "short", { status: 404 })`; `mptAvailable = mptAvailableOf(net, net.features)`; `params = parseTokensParams(search, { mptAvailable })`; a `marker` that fails `isMarker` → 404 `short`; `redirectToCanonical({ path, search }, { path: tokensHref(net.id), search: tokensQuery(params) })`; `params.q` longer than `TOKEN_SEARCH_MAX` → `cached(tokensPage({ …, answer: null }), "short")` with no call; else call #1 `api.tokens({ kind: "issued", limit: 20, minHolders: params.all ? undefined : 10, q, marker })`: a refused marker (`bad_request`) or an empty page behind a marker → 404 `short`; any other failure → `upstreamOutage(err, "the token list")`; then `loadNames(api, collectAddresses(rows' issuers), { context, request, features: net.features })`; `cached(tokensPage(…), "minute")`. `meta` → `tokensMeta`; the component `<TokensPage data={loaderData} />`.

- [ ] **Step 1: Write the failing tests.** `tokens.spec.ts`, **in this order**: `it("xahau: Cannot GET is a 503 that is not stored")`; `it("xrpl: a 5xx of the list is a 503 that is not stored")`; `it("a marker the API refuses, and a marker page with nothing, are 404 short")`; `it("makes exactly calls #1 and the names call, stored minute")` (`mock.requests`; the page and its `.data`); `it("?all=1 asks without min_holders, ?q=USD with q")`; `it.each([["?kind=issued", ""], ["?kind=mpt", ""], ["?back=M1", ""], ["?q=&x=1", ""], ["?all=1&q=USD", "?q=USD&all=1"]])("redirects %s to %j with no call")`; `it("a 65-character search answers its message, short, noindex, with no call")`; `it("xahau lists in XAH with DEX words")`. `tokens-off.spec.ts`: `/xrpl/tokens` and `/xahau/tokens?q=USD` are 404 `short` with no call. `meta.spec.ts`: the default view's canonical and `og:*`; `noindex, follow` on `?q=USD`, `?all=1` and a marker page.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test --project worker test/worker/tokens test/worker/meta` and `pnpm test --project worker-off test/worker/tokens-off` → FAIL: no such route.
- [ ] **Step 3: Implement** the route, its `routes.ts` entry and its `PAGES` entry.
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` exits 0 (the bundle table lists `tokens` under 150,000 B); `pnpm test:e2e` exits 0.
- [ ] **Step 5: Commit.** `git add app/routes.ts app/routes/net.tokens.tsx test/worker/tokens.spec.ts test/worker/tokens-off.spec.ts test/worker/meta.spec.ts scripts/bundle-budget.ts scripts/check-bundle.test.ts` — `feat(tokens): /{net}/tokens, issued tokens ranked by holders`.

---

### Task 7: The token page: view builder

**Files:**
- Modify: `app/server/token-view.ts` (the token part), `app/server/token-view.test.ts`, `app/server/account-view.ts` (**Growth**: `FLAGS` gains `{ mask: 0x00001000, id: "allowClawback", label: () => "Clawback allowed", only: "xahau" }`), `app/server/account-view.test.ts`

**Interfaces:**
- Consumes: Task 1 types; Task 3 `tokenHref`, `tokenHoldersHref`, `tokenPageQuery`; E8's `coverageNote`; E9's `NamesResult` (its `part` for the page, its `entries` for the toml card's sentence); `accountFlags(flags, net)` (`account-view.ts`); `AccountInfo` (`node-rpc.ts`); `AmmPool`, `AmmVolumeRow`, `Page`; `Loaded<T>` (`deadline.ts`); `naturalOrientation`, `marketHref`; `poolLink`; E5's live-volume join of `amm_account` (`amm-view.ts`'s helper for the list's 24 h column); `formatAmount`, `formatPrice`, `compactNumber`, `formatUtc`, `formatUtcDay`, `formatCurrency`.
- Produces:
  ```ts
  export interface TokenInput {
    net: PublicNetwork; asset: { currency: string; issuer: string }; answer: TokenAnswer;
    mode: "first" | "older"; params: TokenPageParams;
    holders: Loaded<TokenHoldersResponse> | null;                // null in the older mode
    transfers: Loaded<TokenTransfersResponse>;
    pools: Loaded<Page<"pools", AmmPool>> | null;                // null without AMM (hasAmm false) and in the older mode
    ammVolume: Loaded<Page<"rows", AmmVolumeRow>> | null;
    accountInfo: Loaded<AccountInfo> | null;                     // asked only when the answer has no issuer_settings
    names: NamesResult;
  }
  export function tokenPage(input: TokenInput): { page: TokenPageData; problems: Array<{ part: string; reason: unknown }> };
  export function priceView(t: TokenDetail, native: NativeCode): { value: string; sub: { kind: "change"; up: boolean; text: string } | { kind: "last"; text: string } | { kind: "none"; text: string } };
  export function settingsRows(source: { settings: IssuerSettings } | { flags: number; transferRate?: number; net: NetworkId } | null): { rows: SettingRowView[]; fromNode: boolean } | null;
  export function tomlCard(t: TokenDetail, net: PublicNetwork, issuerName: NameView | undefined): TomlCardView;
  export function marketRows(t: TokenDetail, net: PublicNetwork): MarketRowView[];
  export function poolRows(pools: Page<"pools", AmmPool>, live: Loaded<Page<"rows", AmmVolumeRow>>, asset: { currency: string; issuer: string }, net: PublicNetwork): { rows: PoolRowView[]; more: string | null; volumeFailed: boolean };
  export function holderRows(h: TokenHoldersResponse, code: string): { rows: HolderRowView[]; top10: string };
  export function transferRows(t: TokenTransfersResponse, issuer: string, net: PublicNetwork): TransferRowView[];
  ```
  (`TokenPageData` and the `*View` types are declared beside them, one field per element of spec §3.1's table.)

Rules (spec §3.1, §3.4): display code `formatCurrency(currency)` (a hex: the decoded text, the hex in `title`, a hidden sentence and a copy value); `<h1>` the toml `name`, else the code; figures exact through BigNumber ("Supply" `formatAmount(supply)` with sub "{CODE}, the sum of all holders' balances"; "Holders" sub "accounts with a positive balance"; "Trust lines" sub "{trust_lines − holders} of them with a zero balance"; "Price" "{price} {native}" with `priceView`'s sub: "▲ +0.12% in 24 h" / "▼ −0.40% in 24 h", "last trade Oct 3" (`price_time` older than 24 h before `close_time`), or "No trade against {native} in 30 days" with "—"; "Volume, 24 h" compact, sub "{trades} trades on the DEX and AMM" / "on the DEX"); the toml card's three states and rows (`code`, `issuer`, then the entry's fields in D6's order; an `https:` URL a link, `icon` a link and never an image, anything else text; "Currency code in hex" with the board's sentence for a hex code; "The toml also lists the issuer, which makes its name verified." when E9's view of the issuer is a verified name of that domain); settings: six rows (Transfer fee "None" / "0.2%", Global freeze On/Off, No freeze Set/Not set, Clawback Allowed/Not allowed, Require auth On/Off, Default ripple On/Off), from `issuer_settings`, else from `account_info.account_data` (`accountFlags` ids `globalFreeze`, `noFreeze`, `allowClawback`, `requireAuth`, `defaultRipple`; `TransferRate` by D6's formula) with "Read live from the network", else "The issuer's settings couldn't be read."; markets in D6's order, "{CODE} / {COUNTER}", the counter's issuer an address, the pair's href `marketHref` in `naturalOrientation` while `features.markets`, else none; pools: the first 5 (`naturalOrientation` pair, `poolLink`, value compact or "—", fee `300` → `0.300%`, the 24 h volume from the live components by `amm_account`: "0" for a native pool without one, "—" otherwise), "All pools with {CODE} →" (`/{net}/amm?asset={token}`) when more than 5 and `features.ammPages`, "Couldn't load the 24-hour volume" when the live volume failed; Xahau: the AMM note "Xahau has no AMM, so {CODE} trades only on the order book here."; holders: `share × 100` to 2 decimals ("11.73%"), the meter relative to the first share, "Frozen" tag, "The top 10 hold {sum}% of the supply.", "All {holders} holders →"; transfers: `formatUtc` time, "Issued" when `source` is the issuer, "Redeemed" when `destination` is, `trailPaging` with `tokenHref`; the older mode: only the header and transfers, a link back to the first page. Every failed `Loaded` part (holders, transfers, pools, AMM volume, account_info) is a problem and its card's error state.

- [ ] **Step 1: Write the failing tests** (`token-view.test.ts`, over `token-samples.ts`): `priceView`'s three forms and the "▼" sign; figures with huge exact supplies (`"18240211855000000000000.000001"`) and the zero-balance count; settings from D6, from `account_info` on XRPL (`0x80000000`) and on Xahau (`0x1000` is Clawback, `0x80000000` is not), and both missing; the toml card listed (with and without the verified-issuer sentence), with a domain but not listed, without a domain, its URL rows (`https:` link, `http:` text, `icon` link); markets' order and hrefs with `MARKETS` on and off; pools joined ("0", "—"), the 5 cap and the "All pools" link, the volume failure note; Xahau (no pools part, the AMM note, `xahau.toml`, "DEX" words); shares and the top-10 sum; transfers' tags; the older mode; each failed part listed in `problems`. `account-view.test.ts`: `it("Xahau's clawback flag 0x1000 is 'Clawback allowed', and 0x80000000 is not on Xahau")`.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/token-view app/server/account-view` → FAIL.
- [ ] **Step 3: Implement** the builder and its parts, and the flag.
- [ ] **Step 4: Run them to verify they pass.** Same command → PASS; `pnpm verify` exits 0.
- [ ] **Step 5: Commit.** `git add app/server/token-view.ts app/server/token-view.test.ts app/server/account-view.ts app/server/account-view.test.ts` — `feat(tokens): the token page's view builder`.

---

### Task 8: The token page: page component and tags

**Files:**
- Create: `app/ui/pages/TokenPage.tsx`, `app/ui/pages/TokenPage.test.tsx`, `app/server/meta-token.ts`
- Modify: `app/ui/pages/token-parts.tsx` (`SettingRow`), `app/server/meta.test.ts`, `app/ui/pages.css`, `test/unit/token-bundle.test.ts` (the new files)

**Interfaces:**
- Consumes: Task 7 `TokenPageData`; `Breadcrumbs`, `Card`, `StatGrid`/`StatTile`, `DataTable`, `DetailList`, `Pill`, `CopyTextButton`, `HashLink`, `AccountLink`, `CoverageNote`, `SectionError` + `useRetry`, `Pager`, `PairCoins`, the kit's `Meter` (`decorative`), `NamesProvider`.
- Produces: `TokenPage({ data }: { data: TokenPageData }): JSX.Element`; `SettingRow({ row }: { row: SettingRowView })` (icon, name, `Pill`, sentence); `tokenMeta(facts: TokenMetaFacts, ctx: MetaContext): MetaDescriptor[]` and `tokenFacts(…)`, which Task 13's card reuses (`meta-token.ts`).

Page (spec §3.1, top to bottom; one column on a phone, the paired cards `flex: 1 1 420px`): breadcrumb "{network} / Tokens / {CODE}"; header card (coin, `<h1>`, the code tag with the hex's `title`, hidden sentence and `CopyTextButton`, the "Issued token" tag, "Issued by" `AccountLink`, the "Issuer account" button and the toml-file button opening in a new tab with `rel="noopener nofollow"` and hidden "(opens a new tab)", source line); the coverage note under the figures; the figures `StatGrid` "Figures"; toml card; issuer settings card; markets card (footnote "Prices are the counter currency per {CODE}. DEX and AMM trades of the last 24 hours." / "DEX trades"; empty "{CODE} had no trades in the last 24 hours."); AMM pools card (XRPL) or the Xahau note; top holders card; recent transfers card (its own `CoverageNote` with `"transfers"`, `Pager` Newer/Older); each failed card its `SectionError` with Retry. Tags (spec §7.1): "{name} ({CODE}) · XRPL · explorer" (without a name "{CODE} by {issuer short}"), the description, canonical `tokenHref`, `og:*` with the image and `twitter:card=summary_large_image`; behind a marker "Older transfers of {CODE} · …", `noindex, follow`, no canonical, no `og:*`.

- [ ] **Step 1: Write the failing tests.** `TokenPage.test.tsx`: every card in its ok, empty and failed state; Retry on a failed card calls `useRetry`; Xahau's AMM note and words; the toml card's three states; the copy button holds the hex; the external toml link's `rel` and hidden text; the marker page has only the header and transfers with a link back; statuses are icon and text ("Frozen", "Issued", "Redeemed", the pills, the price arrow); no fetch. `meta.test.ts`: `tokenMeta` on the first page, without a name, and behind a marker. `token-bundle.test.ts`: `TokenPage.tsx` and `meta-token.ts` as in Task 5.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/pages/TokenPage app/server/meta test/unit/token-bundle` → FAIL.
- [ ] **Step 3: Implement** the page, `SettingRow`, the tags and the CSS.
- [ ] **Step 4: Run them to verify they pass.** Same command → PASS; `pnpm verify` exits 0.
- [ ] **Step 5: Commit.** `git add app/ui/pages/TokenPage.tsx app/ui/pages/TokenPage.test.tsx app/ui/pages/token-parts.tsx app/server/meta-token.ts app/server/meta.test.ts app/ui/pages.css test/unit/token-bundle.test.ts` — `feat(tokens): the token page`.

---

### Task 9: The token page: route and loader

**Files:**
- Create: `app/routes/net.token.$token.tsx`, `app/server/token-route.ts`, `test/worker/token.spec.ts`
- Modify: `app/routes.ts` (`route("token/:token", "routes/net.token.$token.tsx")`), `test/worker/tokens-off.spec.ts`, `test/worker/meta.spec.ts`, `scripts/bundle-budget.ts`, `scripts/check-bundle.test.ts` (`{ name: "token", route: "routes/net.token.$token", budget: "lookup" }`)

**Interfaces:**
- Consumes: Tasks 1, 3, 7, 8; E2's `byDeadline`, `CARD_DEADLINE_MS`, `outcome`, `partOf`, `TooLate`; `markDegraded`, `logProblem`; `notFound` (`loader-errors.ts`); `poolLink`; `node.accountInfo`; `MARKER_PAGE_CLASS`.
- Produces: route id `routes/net.token.$token`; `handle = { navSection: "tokens" }`; and, for the holders route (Task 10), `app/server/token-route.ts`:
  ```ts
  /** Steps 1 of the loader below for a token page (`page: "token"`) or its holders (`"holders"`): throws the 404s, returns the redirect, or the asset and its query. */
  export function checkTokenRoute(net: Network, request: { path: string; search: string }, segment: string, page: "token" | "holders"):
    Response | { asset: { currency: string; issuer: string }; params: TokenPageParams };
  /** Step 4 below: the `limit=1` coverage call, then the 404 thrown. */
  export function throwTokenNotFound(api: DataApi, net: Network, asset: { currency: string; issuer: string }): Promise<never>;
  ```

**Loader** (spec §1.3, §3.2, §3.3), with no call before the checks:
1. `requireNetwork`; switch off → 404 `short` "the token pages on {network}". The segment is decoded (a malformed escape is `none`) and read by `parseTokenPath`: `none` → `notFound({ notFound: \`token ${echoOf(segment)}\` })`; `native` → `notFound({ notFound: …, note: \`${native} is ${network.name}'s own currency, not an issued token.\` })`; `lp` → `redirect(poolLink(net.id, issuer, net.features), { headers: cacheClassHeaders("slow") })`; `token` → `redirectToCanonical({ path, search }, { path: tokenHref(net.id, asset), search: tokenPageQuery(parseTokenPageParams(search)) })`; a `marker` that fails `isMarker` → 404 `short`.
2. **First page:** #1 `api.token(asset)`, #2 `api.tokenHolders(asset, { limit: 10 })`, #3 `api.tokenTransfers(asset, { limit: 20 })`, and with `net.hasAmm` #4 `api.ammPools({ limit: 20, asset })` and #5 `api.ammVolume({ live: "day" })`, side by side, each `byDeadline(…, started + CARD_DEADLINE_MS)` and settled. #1 `not_found`: the 404 below; any other #1 failure → `upstreamOutage(err, \`token ${code}\`)`. Then #7 `node.accountInfo(asset.issuer)` only when #1 has no `issuer_settings`; then #6 `loadNames(api, collectAddresses(issuer, holders, transfers' parties, markets' counter issuers), …)`. `tokenPage(…)`; each problem `logProblem` and `markDegraded`; `cached(page, "live")`.
3. **Behind a marker:** #1, #3 with the marker, #6; a refused marker or an empty page → 404 `short`; `cached(page, MARKER_PAGE_CLASS)`.
4. **The 404 of `token not found`:** a `limit=1` list call `api.tokens({ kind: "issued", limit: 1, minHolders: 10 })` made only here; `notFound({ notFound: \`${code} issued by ${shortAddress(issuer)} on ${network.name}\`, suggestion: { href: accountHref(net.id, issuer, {}), label: "Open the issuer's account" }, note })` where `note` is, while that call's `coverage.complete` is false, the plain text of `coverageNote(coverage, "trust lines")` followed by " A token whose trust lines have not changed since is not listed yet." (Ruling 3), and absent when complete or when that call failed.

- [ ] **Step 1: Write the failing tests.** `token.spec.ts`, **in this order** (distinct tokens per failure): `it("Cannot GET of the token is a 503 not stored")`; `it("a 429 and a malformed 200 of the token are 503s not stored")`; `it("404 with the coverage note for a token the index lacks")`; `it("404 without the note when the coverage call fails")` (the `limit=1` key overridden to 503); `it("each card failure is a 200 with its SectionError, not stored")` (#2, #3, #4 each overridden; #5 gives the volume note; #7 the settings message; the names call E9's way); then `it("xrpl: makes exactly calls #1 to #6 for RLUSD, stored live")` (#4's key equals the AMM list's for that asset); `it("asks the node's account_info for LIONS, whose answer has no issuer_settings, and only then")`; `it("xahau: makes no AMM call")`; `it.each([["usd.rvYAf…", "/xrpl/token/USD.rvYAf…"], ["524c55…+rMxCK…", "/xrpl/token/RLUSD.rMxCK…"], ["0000…5553440000000000.rvYAf…", "/xrpl/token/USD.rvYAf…"], ["RLUSD.rMxCK…?x=1&back=M", "/xrpl/token/RLUSD.rMxCK…"]])("redirects %s to %s with no call")` (path only `immutable`, with the query `short`); `it("an LP token redirects to its pool, slow, with no call")`; `it("XRP alone is a 404 with its note, and USD alone a 404, with no call")`; `it("a marker page: #1, #3 with the marker and the names call, slow, noindex")`; `it("a refused marker and an empty marker page are 404 short")`. `tokens-off.spec.ts`: `/xrpl/token/RLUSD.rMxCK…` and `/xrpl/token/usd.rvYAf…` are 404 `short` with no call. `meta.spec.ts`: the token page's canonical and image; `noindex, follow` behind a marker.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test --project worker test/worker/token test/worker/meta`, `pnpm test --project worker-off test/worker/tokens-off` → FAIL.
- [ ] **Step 3: Implement** `token-route.ts`, the route and its entries.
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` exits 0; `pnpm test:e2e` exits 0.
- [ ] **Step 5: Commit.** `git add app/routes.ts 'app/routes/net.token.$token.tsx' test/worker/token.spec.ts test/worker/tokens-off.spec.ts test/worker/meta.spec.ts scripts/bundle-budget.ts scripts/check-bundle.test.ts` — `feat(tokens): /{net}/token/{token}, one issued token`.

---

### Task 10: The holders page

**Files:**
- Create: `app/routes/net.token.$token.holders.tsx`, `app/ui/pages/TokenHoldersPage.tsx`, `app/ui/pages/TokenHoldersPage.test.tsx`, `test/worker/token-holders.spec.ts`
- Modify: `app/routes.ts` (`route("token/:token/holders", …)`, after `token/:token`), `app/server/token-view.ts` (`tokenHoldersPage`), `app/server/token-view.test.ts`, `app/server/meta-token.ts` (`tokenHoldersMeta`), `app/server/meta.test.ts`, `test/worker/tokens-off.spec.ts`, `test/unit/token-bundle.test.ts`, `scripts/bundle-budget.ts`, `scripts/check-bundle.test.ts` (`{ name: "token-holders", route: "routes/net.token.$token.holders", budget: "lookup" }`)

**Interfaces:**
- Consumes: Tasks 1, 3, 7 (`holderRows`), 9 (`checkTokenRoute(…, "holders")`, `throwTokenNotFound`).
- Produces: `tokenHoldersPage(input: { net; asset; answer: TokenAnswer; holders: Loaded<TokenHoldersResponse>; params: TokenPageParams; names: NamesResult }): { page: TokenHoldersPageData; problems }`; `TokenHoldersPage({ data })`; `tokenHoldersMeta`.

Page (spec §4): breadcrumb "{network} / Tokens / {CODE} / Holders"; `<h1>` "Holders of {CODE}"; "{holders} accounts hold {supply} {CODE}" with a link back to the token; the holders answer's `CoverageNote` (`"trust lines"`); the top holders table with 50 rows and two more columns, Limit and Status ("Frozen"; "Authorized" when the issuer requires authorisation, from `issuer_settings.require_auth`); `Pager` "Previous" / "More holders" (trail). Calls: `token` (minute), `tokenHolders(asset, { limit: 50, marker })` (minute), names (the 50 holders and the issuer). `cached(page, "minute")` behind a marker too; `noindex, follow` behind a marker; the token call fails as Task 9's; the holders call fails the card (degraded).

- [ ] **Step 1: Write the failing tests.** `token-view.test.ts`: `tokenHoldersPage` rows, ranks continuing on page 2, the Authorized status only with `require_auth`, the failed card. `TokenHoldersPage.test.tsx`: the table's names, the pager labels, the failed card. `token-holders.spec.ts` (failures first): the holders call failing → 200 degraded not stored; the token 404 as Task 9's; the calls and class `minute` on the first page and behind a marker; redirects of other spellings to `/holders` with no call. `meta.test.ts`: "Holders of {CODE} · XRPL · explorer", canonical on the first page, `noindex, follow` behind a marker. `tokens-off.spec.ts`: the route is a 404 with no call.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/token-view app/ui/pages/TokenHoldersPage app/server/meta` and `pnpm test --project worker test/worker/token-holders` → FAIL.
- [ ] **Step 3: Implement** the builder, the page, the route and its entries.
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` exits 0; `pnpm test:e2e` exits 0.
- [ ] **Step 5: Commit.** `git add app/routes.ts 'app/routes/net.token.$token.holders.tsx' app/ui/pages/TokenHoldersPage.tsx app/ui/pages/TokenHoldersPage.test.tsx app/server/token-view.ts app/server/token-view.test.ts app/server/meta-token.ts app/server/meta.test.ts test/worker/token-holders.spec.ts test/worker/tokens-off.spec.ts test/unit/token-bundle.test.ts scripts/bundle-budget.ts scripts/check-bundle.test.ts` — `feat(tokens): all holders of a token`.

---

### Task 11: Links into the token pages

**Files:**
- Modify: `app/server/account-view.ts` (`tokensOf` and `Token`), `app/ui/pages/AccountPage.tsx` (`TokenRow`), `app/server/pair-view.ts` (`PairHead.issuers[]`), `app/ui/pages/MarketPairPage.tsx`, `app/server/amm-view.ts` (`AmmIssuerLine`), `app/ui/pages/AmmPoolPage.tsx`, E9's "How we know" currencies (the view builder E9 put them in, `app/server/account-name-view.ts`, and the component that draws them), and their tests (`account-view.test.ts`, `AccountPage.test.tsx`, `pair-view.test.ts`, `MarketPairPage.test.tsx`, `amm-view.test.ts`, `AmmPoolPage.test.tsx`, E9's view test), `test/worker/tokens-off.spec.ts`, `README.md` ("The account page": the Tokens card's links)

**Interfaces:**
- Consumes: Task 3 `tokenLink`.
- Produces (**Growth** of E3, E5, E9 and the account page's types):
  ```ts
  // account-view.ts
  export interface Token { currency: string; issuer: string; value: string; lp: boolean; /** the code's link: null for an LP token (its pool line stays) and while TOKENS is off */ href: string | null }
  export function tokensOf(balances: BalancesResponse, link: { net: NetworkId; account: string; features: Features }): { items: Token[]; truncated: boolean };
  //   href = tokenLink(net, { currency, issuer: value below 0 ? account : counterparty }, features) for a non-LP line
  // pair-view.ts: PairHead.issuers[] gains `tokenHref: string | null` (tokenLink of that side)
  // amm-view.ts: AmmIssuerLine gains `tokenHref: string | null`
  // E9's toml facts: each currency gains `href: string | null` (tokenLink when the entry has an issuer and parseTokenPath accepts its code)
  ```
  Each component draws the code as a `Link` when the href is set and as today's text otherwise.

- [ ] **Step 1: Write the failing tests.** `account-view.test.ts`: a line with a positive balance links `(code, counterparty)`, a negative one `(code, this account)`, a zero one `(code, counterparty)`; an LP line has `href: null`; `TOKENS` off gives `null` for all. `AccountPage.test.tsx`: the code is a link to the token page, the LP row keeps its pool link, off is text. `pair-view.test.ts` / `MarketPairPage.test.tsx` and `amm-view.test.ts` / `AmmPoolPage.test.tsx`: "{CUR} issued by …" has the code linked with `TOKENS` on and as text off. E9's view test: a currency with an issuer links, one without (or with a code `parseTokenPath` refuses) is text. `tokens-off.spec.ts`: the account page of the fixtures' hand-written account has no `/token/` link.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/account-view app/ui/pages/AccountPage app/server/pair-view app/ui/pages/MarketPairPage app/server/amm-view app/ui/pages/AmmPoolPage app/server/account-name-view` and `pnpm test --project worker-off test/worker/tokens-off` → FAIL.
- [ ] **Step 3: Implement** the hrefs in the builders and the links in the components.
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` exits 0; `pnpm test:e2e` exits 0.
- [ ] **Step 5: Commit.** `git add` the files above — `feat(tokens): token codes on the account, pair and pool pages lead to their token pages`.

---

### Task 12: Search for a token

**Files:**
- Modify: `app/routes/net.search.tsx`, `app/server/search-view.ts` (`helpPage(query, tokens?)`), `app/server/search-view.test.ts`, `app/ui/pages/SearchPage.tsx`, `app/ui/pages/SearchPage.test.tsx`, `test/worker/search.spec.ts`, `test/worker/tokens-off.spec.ts`, `README.md` ("Search": two rows)

**Interfaces:**
- Consumes: Task 3 `parseTokenPath`, `tokenHref`, `tokensHref`, `TOKEN_SEARCH_MAX`; `classify` (unchanged, with E8's, E10's and E14's additions in their order: this step runs only after `classify` gave `none` and those steps found nothing).
- Produces: `helpPage(query: string, tokens?: { href: string; label: string }): SearchPageData` (the help kind gains `tokens?`); `SearchPage` draws it as a link after the help text.

Rule (spec §5.3): with `classify` at `none` and `net.features.tokens`, the trimmed text read by `parseTokenPath`: `token` → 302 to `tokenHref(net.id, asset)` (`short`, no call: the page answers its own 404); `lp` → 302 to `poolLink` (`short`); otherwise a text of 1 to `TOKEN_SEARCH_MAX` characters gets `{ href: tokensHref(net.id, { q }), label: \`Look for “${q}” among tokens →\` }`.

- [ ] **Step 1: Write the failing tests.** `search-view.test.ts` / `SearchPage.test.tsx`: the help page with and without the tokens link. `search.spec.ts`: `?q=USD.rvYAf…` → 302 `/xrpl/token/USD.rvYAf…` with no call; `?q=usd+rvYAf…` → the same; `?q=rlusd+rMxCK…` → `/xrpl/token/rlusd.rMxCK…` (a text code is its bytes: `rlusd` is another code than `RLUSD`, and its page answers its own 404); `?q=03…+rhWTXC…` → the pool; `?q=RLUSD` → the help page with the link to `/xrpl/tokens?q=RLUSD`; a 65-character text → no link; a hash, an address, a ledger index → as before. `tokens-off.spec.ts`: `?q=USD.rvYAf…` is today's help page without a token link.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/search-view app/ui/pages/SearchPage`, `pnpm test --project worker test/worker/search`, `pnpm test --project worker-off test/worker/tokens-off` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` exits 0.
- [ ] **Step 5: Commit.** `git add app/routes/net.search.tsx app/server/search-view.ts app/server/search-view.test.ts app/ui/pages/SearchPage.tsx app/ui/pages/SearchPage.test.tsx test/worker/search.spec.ts test/worker/tokens-off.spec.ts README.md` — `feat(tokens): search a token by CUR.issuer`.

---

### Task 13: The link-preview image of a token

**Files:**
- Modify: `app/routes/og.$net.$kind.$id[.png].tsx` (kind `token`), `app/server/card-data.ts` (`tokenCard`), `app/server/meta.ts` (`ImageKind` gains `"token"`), `app/server/card-data.test.ts`, `test/worker/og.spec.ts`, `test/worker/tokens-off.spec.ts`

**Interfaces:**
- Consumes: Task 3 `parseTokenPath`, `tokenHref`; Task 8 `tokenFacts`; the route's `notFound`, `unavailable`, `permanent`, `image`.
- Produces: `tokenCard(facts: TokenMetaFacts, network: NetworkBrief): CardData` — kind "Issued token"; headline the toml name or the code; `parties: [issuer]`; note "{holders} holders · supply {compact supply} {CODE}"; footer "Listed in {domain}'s toml" or "Issued token on {network}".

Route (spec §7.2): the query-string redirect first; `TOKENS` off → `notFound()` before any call; `parseTokenPath` of the id: `none`, `native`, `lp` → `notFound()`; another spelling → `permanent(/og/{net}/token/{canonical}.png)`; `api.token(asset)` (#1's key); `not_found` → `notFound()`; any other failure → `unavailable(retryAfter)`; `image(tokenCard(…), request, "slow")`.

- [ ] **Step 1: Write the failing tests.** `card-data.test.ts`: the card of a listed token with a name, of an unlisted one without a name, on Xahau. `og.spec.ts` (failures first, new tokens): `Cannot GET` → 503 not stored; the RLUSD image is a PNG of 1200 × 630 stored `slow`; `usd.rvYAf…` → 302 `immutable` with no call; an LP id, `XRP` and a non-asset → 404 `short` with no call; `token not found` → 404 `short`. `tokens-off.spec.ts`: `/og/xrpl/token/RLUSD.rMxCK….png` is a 404 with no call.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/card-data`, `pnpm test --project worker test/worker/og`, `pnpm test --project worker-off test/worker/tokens-off` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` exits 0.
- [ ] **Step 5: Commit.** `git add 'app/routes/og.$net.$kind.$id[.png].tsx' app/server/card-data.ts app/server/card-data.test.ts app/server/meta.ts test/worker/og.spec.ts test/worker/tokens-off.spec.ts` — `feat(og): the link-preview image of a token`.

---

### Task 14: README, bundle figures, end to end, accessibility and rollout

**Files:**
- Create: `test/e2e/tokens.spec.ts`, `test/e2e/tokens-live.spec.ts`
- Modify: `test/e2e/a11y.spec.ts`, `test/e2e/client-meta.spec.ts`, `test/e2e/og.spec.ts`, `README.md` (section "Tokens" after "Validators and amendments": the three routes, their classes, calls and failures, the switch and its condition, the MPT seam; "SEO and link previews" (the tags, kind `token`); "The client bundle check" (the three pages' figures); the sandbox checklist and the production checks (E7's split); the rollout table of spec §13)

**Interfaces:**
- Consumes: everything above; E2's `E2E_FEATURES_OFF`, `contextFor`, the fixture server's `override`; `token-cases.ts`.
- Produces (for E13 and E14, unchanged since their tasks): `tokenLink`, `parseTokenPath`, `TOKEN_KINDS`, `parseTokensParams(search, { mptAvailable })`, `mptAvailableOf`, `kindTabs` (`app/domain/token-params.ts`); `tokensPage` and `TokensPageData` (`app/server/token-view.ts`, body by kind); `TokensPage` (`app/ui/pages/TokensPage.tsx`); `DataApi.tokens` (`kind: "issued"`, for E14 to widen).

- [ ] **Step 1: Write the failing tests.**
  - `tokens.spec.ts` (tokens read from the pages, never fixed): the header item leads to the list with `aria-current="page"`; 20 rows, "More tokens" and "Previous"; a search through the form, its "more among tokens with fewer than 10 holders" link, "Show all" and "Hide…"; a token link to its page; the toml card, the settings, a market link to the pair page, a pool link, "All N holders" and its pages; the transfers' Older and Newer; `usd.r…` and a hex URL land on the canonical URL; an LP token lands on its pool; a token the fixtures lack shows its 404 with the coverage note and the issuer link; `/xahau/tokens` and the EVR page (XAH, the AMM note, the MPT note); a search for `USD.rvYAf…`; with JavaScript off (`contextFor({ javaScriptEnabled: false })`), the form, the links and the pagers work. Skipped where `E2E_FEATURES_OFF` lists `TOKENS`, whose off case runs instead (the routes 404, the header "soon").
  - `tokens-live.spec.ts` (`live` project): the holders call overridden to 503 shows the card's error; Retry with the override removed brings it back.
  - `a11y.spec.ts`: `/xrpl/tokens` and the RLUSD page at 1280 and 375 px in the four theme settings; the searched list, `all=1`, a marker page, the holders page, the EVR page and the 404 in the two system themes; no serious or critical violation; no sideways scroll at 375 px.
  - `client-meta.spec.ts` and `og.spec.ts` (e2e): the three pages' tags after a client-side navigation; the token image URL answers a PNG.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test:e2e` → the new cases FAIL until the specs' selectors match (the pages exist).
- [ ] **Step 3: Write the specs, then measure and document.** `pnpm build && pnpm check:bundle`: the three pages' figures, recorded in "The client bundle check" (each under 150,000 B; over 145,000 B say so and apply E2's fallback). Write the README section, the checklist rows (sandbox: the list against `/v2/tokens` with pages concatenating and no token twice within a minute, a token's settings against `account_info`, the image; production: a token's supply against the node's `gateway_balances` for two issuers once D6's coverage is complete, never in the sandbox, and an LP redirect), and the rollout table.
- [ ] **Step 4: Run everything.** `pnpm verify`, `pnpm fixtures:check`, `pnpm test:e2e` exit 0.
- [ ] **Step 5: Commit.** `git add test/e2e/tokens.spec.ts test/e2e/tokens-live.spec.ts test/e2e/a11y.spec.ts test/e2e/client-meta.spec.ts test/e2e/og.spec.ts README.md` — `feat(tokens): the token pages end to end, the README and the bundle figures`.

**What the owner does to deploy** (spec §13): (1) E11 ships with `TOKENS` `"on"` at the top level and `"off"` in `sandbox` and `production`; (2) once D6 is deployed to the sandbox's data APIs with a live generation (`syncer_tokens_live` 1, `syncer_tokens_lag_ledgers` under 300), a commit turns `TOKENS` on for `sandbox` and the sandbox checklist is walked (the end-to-end suite is not run against the sandbox); (3) D6's paths are already in `PATHS` (Task 1 synced them); (4) with D6 in production, its generation live and its lag small, a commit turns `TOKENS` on for `production`: the pages, the header item and every token link appear at once (the switch is in the cache generation); rolling back is `"off"` and a deploy; (5) E14 later adds the MPT tab.

---

## Rulings

1. **D6's routes go straight into `PATHS`** (Task 1): the build order syncs D6's description in this plan's first task, so spec §9's `PENDING_PATHS` entries and §13's step 3 (`pnpm api:sync` later) are done at build time.
2. **`token(asset)` returns the whole answer**, checked by `checkToken`, not `unwrap: "token"`: spec §9 wants `coverage` and `ledger_index` kept, which an unwrap drops.
3. **The 404's coverage note is plain text** in `NotFoundData.note` (its contract: plain text, at most 300 characters), the ledger number without its link; `coverageNote`'s words are kept.
4. **Fixture file names** are `dataApiFile`'s, whose `canonicalQuery` sorts parameters (`tokens@kind=issued&limit=20&marker=M&min_holders=10.json`), not spec §12's listed order; the generator is `scripts/token-fixtures.ts`, called from `generate()` in `scripts/http-fixtures.ts`, which `make-http-fixtures.ts` runs.
5. **Xahau's `AllowTrustLineClawback` (0x1000)** joins the account page's flag table (Task 7): spec §3.4 maps `account_info` "with the account page's flag tables", and that table has only XRPL's 0x80000000 today.
6. **`kindTabs` tells Xahau by `net.id`** (`"xahau"` in both environments); E14 adds `hasMpt` and may switch to it.
7. **`token-params.ts` is Worker, scripts and tests only** (it imports `asset.ts`, hence `ripple-address-codec`); pages get hrefs in their data, so E13 calls `tokenLink` from its view builder, not a component.
8. **`SegmentedLinks` grows a disabled segment** (`disabled: { tag?, note? }`) for the MPT tab; no new component.
9. **`ListedMark` and `SettingRow`** live in one file, `app/ui/pages/token-parts.tsx` (spec §8's "folder of parts").
10. **The LP case of `tokenLink`** returns `poolLink` (spec §1.4); the account page's Tokens card keeps its own LP line (`href: null`), so nothing changes there while `TOKENS` is off.
