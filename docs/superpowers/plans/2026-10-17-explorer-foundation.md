# Explorer foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public, server-rendered XRPL and Xahau explorer on Cloudflare Workers with search, ledger, transaction and account pages, edge caching, link previews and the mock's design.

**Architecture:** React Router 8 in framework mode, deployed as one Worker. Loaders call the GateHub Data API (with a secret key) and the network's node over JSON-RPC through `app/server/*`; pure logic (search, CTID, parsing, summaries, formatting) lives in `app/domain`; `app/ui` renders props only. The Worker entry wraps React Router's handler with an edge cache (Cache API, classes and TTLs from the spec) and a visitor rate limit on cache misses.

**Tech Stack:** pnpm, TypeScript, React 19, React Router 8 (`@react-router/dev`, `@cloudflare/vite-plugin`), Wrangler 4, Vitest with `@cloudflare/vitest-pool-workers`, Testing Library, Playwright with `@axe-core/playwright`, `ripple-lib-transactionparser` 0.8.2, `ripple-address-codec` 5, `bignumber.js`, `openapi-typescript` 7, `workers-og` (Satori + resvg-wasm), `@sentry/cloudflare`, the `geist` font package.

**Spec:** `docs/superpowers/specs/2026-10-17-explorer-foundation-design.md` (the mock boards are in `docs/superpowers/specs/2026-10-17-explorer-mock/`).

**Branch:** `feat/foundation` in this repository, cut from `main`; its first commit holds this plan and the spec's planning-time corrections.

## Global Constraints

- **Two deliberate deviations from the spec**, decided while planning:
  - React Router **8** (8.4 is current; the spec said v7, written before v8 became the current major). Anything version-specific about reading the Worker's `env`/`ctx` in loaders lives only in `app/server/env.ts`.
  - `data-api-new/docs/openapi.yaml` lists paths and parameters but **no response schemas**, so response types are hand-written in `app/server/api-types.ts` from `data-api-new/docs/api-reference.md`. The generated `openapi` types are used to check at compile time that every path the client calls exists.
- Networks: `xrpl` (name `XRPL`, native `XRP`, CTID network id `0`) and `xahau` (`Xahau`, `XAH`, `21337`). Any other first path segment is a 404.
- Timeouts: data API 5 s, node 3 s. Header `X-API-Key: <DATA_API_KEY>` on every data API request.
- Cache classes, edge TTL / browser `Cache-Control`: `immutable` 31536000 s / HTML `max-age=60`, images `max-age=31536000, immutable`; `live-home` 3 s and `live` 5 s, both stale-while-revalidate 30 s / `max-age=0, must-revalidate`; `slow` 3600 s / `max-age=300`; `short` 30 s / `max-age=0`. Error responses (5xx, 429, timeouts) are never stored. The cache key is the URL plus the build ID.
- Visitor limit: 60 requests per 10 s per client IP, only on edge-cache misses; over it → 429 page with `Retry-After`.
- Lists: newest first, 20 per page, Newer/Older by marker, no totals.
- Amounts: the API's exact decimal strings, thousands-separated, never floats; computed amounts with `bignumber.js`.
- Tokens, type and shapes: spec section 8, verbatim. Geist and Geist Mono are self-hosted (from the `geist` package), never loaded from Google Fonts.
- Product name: the constant `PRODUCT_NAME = 'explorer'` in `app/ui/brand.ts`; the footer credit is "by GateHub".
- Accessibility: WCAG 2.2 AA; statuses are icon + text; real `<a>`/`<button>`/`<label>`; 44 px touch targets.
- JavaScript budget: under 150 KB gzipped on home, ledger, transaction and account pages (checked in Task 15).
- Never delete or rewrite files this plan does not name. Never touch `~/github.com/GateHubNet/data-api-new` except to read it (and to run its `record-fixtures` script with `--out` pointing into this repository).

## Review Focus

- **Pasted search text with noise**: surrounding spaces, lower-case hex, a `0x` prefix on a 64-hex hash, an address with a trailing newline. Expected: trimmed, `0x` dropped, hex upper-cased, then classified normally. Pinned in Task 3.
- **Issued-currency values in exponent form**: rippled metadata can carry values like `1e-15` or `-1.5e+21`, and `bignumber.js` prints them so past its exponent limits. Expected: plain decimal text, never `e`. Pinned in Task 2.
- **40-hex currency codes**: an ASCII code padded with zero bytes (`534F4C4F` + zeros), an LP token (`03…`), and a code with non-printable bytes. Expected: `SOLO`, `LP token`, first 8 hex digits + `…`. Pinned in Task 2.
- **A hash or address from the other network**: not found on this network. Expected: the 404 page offers the same search on the other network. Pinned in Task 12.
- **A very large ledger** (thousands of transactions): the page renders the first 100 rows server-side and "Show all N" reveals the rest from the loaded data, without a second request. Pinned in Task 11.

---

### Task 1: Scaffold and the Workers runtime

**Files:**
- Create: from the official Cloudflare template for React Router (`pnpm create react-router@latest` with the `cloudflare` template of `remix-run/react-router-templates`): `package.json`, `react-router.config.ts`, `vite.config.ts`, `wrangler.jsonc`, `workers/app.ts`, `app/root.tsx`, `app/routes.ts`, `tsconfig*.json`
- Create: `app/server/env.ts`, `vitest.config.ts` (projects `unit` in Node and `worker` in `@cloudflare/vitest-pool-workers`), `test/worker/runtime.spec.ts`, `.gitignore`, `README.md`

**Interfaces:**
- Produces: `interface Env { XRPL_DATA_API_URL: string; XAHAU_DATA_API_URL: string; XRPL_NODE_URL: string; XAHAU_NODE_URL: string; DATA_API_KEY: string; SENTRY_DSN?: string; BUILD_ID: string; VISITOR_LIMITER: RateLimit }`; `getEnv(context: unknown): Env`; `getExecutionContext(context: unknown): ExecutionContext`. Package scripts: `dev`, `build`, `typecheck`, `test` (`vitest run`), `test:e2e`, `api:sync`, `deploy:staging`, `deploy:production`, `verify` (typecheck + test + build).

- [ ] **Step 1:** Work on `feat/foundation` (it exists: it holds this plan). Scaffold the template into the repository root without overwriting `docs/`; make sure `react-router`, `@react-router/dev` and `@react-router/cloudflare` resolve to 8.x. Add runtime deps `ripple-lib-transactionparser@0.8.2`, `ripple-address-codec@^5`, `bignumber.js`, `geist`, `workers-og`, `@sentry/cloudflare`; dev deps `vitest`, `@cloudflare/vitest-pool-workers`, `@testing-library/react`, `happy-dom`, `@playwright/test`, `@axe-core/playwright`, `openapi-typescript`, `tsx`. Use whatever versions the template and peer ranges settle on; record the React Router version in `README.md`.
- [ ] **Step 2:** `wrangler.jsonc`: `compatibility_flags: ["nodejs_compat"]`, `vars` per environment `staging` and `production` with the four URL variables (production/staging data API `https://xrpl.data.<domain>` and `https://xahau.data.<domain>` as placeholders; nodes `https://s1.ripple.com:51234/` and `https://xahau.network/`), the `ratelimits` binding `VISITOR_LIMITER` (`limit: 60`, `period: 10`), `observability.enabled: true`, `BUILD_ID` injected at build time from the git commit (a `define` or `--var` in the build/deploy scripts). `.dev.vars.example` lists `DATA_API_KEY=` and `SENTRY_DSN=`.
- [ ] **Step 3: Write the failing runtime test** `test/worker/runtime.spec.ts` in the `worker` project: `parseBalanceChanges` of the metadata of the AMMDeposit transaction `83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B` from `data-api-new/packages/shared/test/fixtures/xrpl/recorded/107671558.json.gz` (inline the needed `meta` as a JSON fixture under `test/fixtures/runtime/`) returns a non-empty object; `isValidClassicAddress('rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg')` is a boolean; `new BigNumber('1e-15').toFixed()` is `'0.000000000000001'`; and `SELF.fetch('https://example.com/')` answers 200 with HTML.
- [ ] **Step 4:** Run `pnpm test -- --project worker`; expect FAIL until `env.ts` and the root page exist, then make it PASS. If `ripple-lib-transactionparser` cannot load in the Workers runtime, write down why in `README.md` and replace it in Task 4 (spec 1.1).
- [ ] **Step 5:** `pnpm verify` passes. Commit `chore: scaffold React Router 8 on Cloudflare Workers`.

### Task 2: Formatting and result codes

**Files:**
- Create: `app/domain/format.ts`, `app/domain/results.ts`
- Test: `app/domain/format.test.ts`, `app/domain/results.test.ts`

**Interfaces:**
- Produces: `formatAmount(value: string): string`; `formatCurrency(code: string): string`; `dropsToNative(drops: string): string`; `formatUtc(at: string | number): string` (`'2026-10-17 15:42:51 UTC'`; a number is Ripple-epoch seconds when below 946684800, else unix seconds); `relativeTime(atMs: number, nowMs: number): string`; `shortHash(h: string): string`; `shortAddress(a: string): string`; `resultText(code: string): { ok: boolean; text: string }`.

- [ ] **Step 1: Write the failing tests:** `formatAmount('12480.256114')` → `'12,480.256114'`; `'-1250'` → `'−1,250'` (U+2212); `'1e-15'` → `'0.000000000000001'`; `'-1.5e+21'` → `'−1,500,000,000,000,000,000,000'`; `'0'` → `'0'`. `formatCurrency('USD')` → `'USD'`; `'534F4C4F00000000000000000000000000000000'` → `'SOLO'`; `'03A1F7D29C2E0000000000000000000000000000'` → `'LP token'`; `'01FFFE0000000000000000000000000000000000'` → `'01FFFE00…'`. `dropsToNative('12')` → `'0.000012'`. `relativeTime` → `'3 s ago'`, `'4 min ago'`, `'2 h ago'`, `'5 d ago'`. `shortHash` of a 64-hex → first 6 + `…` + last 4; `shortAddress('rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg')` → `'rJF2Xa…FQvg'`. `resultText('tesSUCCESS')` → `{ ok: true, text: 'The transaction was applied and is final.' }`; `resultText('tecPATH_DRY')` → `{ ok: false, text: 'No path had enough liquidity to deliver the amount.' }`; an unknown `tecFOO` → `{ ok: false, text: 'Failed, but the fee was charged (tec code tecFOO).' }`; unknown `tefBAR`/`telX`/`temX`/`terX` → their class sentence ("was not applied").
- [ ] **Step 2:** Run `pnpm test -- app/domain`; expect FAIL.
- [ ] **Step 3: Implement.** `results.ts` holds plain-language text for at least: `tesSUCCESS`, `tecPATH_DRY`, `tecPATH_PARTIAL`, `tecUNFUNDED_OFFER`, `tecUNFUNDED_PAYMENT`, `tecNO_DST`, `tecNO_DST_INSUF_XRP`, `tecNO_LINE`, `tecINSUF_RESERVE_LINE`, `tecINSUF_RESERVE_OFFER`, `tecKILLED`, `tecNO_PERMISSION`, `tecDST_TAG_NEEDED`, `tecEXPIRED`, `tecHAS_OBLIGATIONS`, `tecOVERSIZE`, `tecAMM_BALANCE`, `tecAMM_FAILED`, and one sentence per class prefix for anything else.
- [ ] **Step 4:** Tests PASS. Commit `feat(domain): amount, currency, time and result-code formatting`.

### Task 3: CTID and search classification

**Files:**
- Create: `app/domain/ctid.ts`, `app/domain/search.ts`
- Test: `app/domain/ctid.test.ts`, `app/domain/search.test.ts`

**Interfaces:**
- Produces: `encodeCtid(ledgerIndex: number, txIndex: number, networkId: number): string`; `decodeCtid(s: string): { ledgerIndex: number; txIndex: number; networkId: number } | null`; `type SearchKind = { kind: 'ledger-index'; index: number } | { kind: 'hash'; hash: string } | { kind: 'ctid'; ctid: string; ledgerIndex: number; txIndex: number; networkId: number } | { kind: 'account'; address: string; tag?: number } | { kind: 'none' }`; `classify(input: string): SearchKind`.

- [ ] **Step 1: Write the failing tests.** CTID vectors: `encodeCtid(107695660, 12, 0)` → `'C66B4E2C000C0000'`; `encodeCtid(17482913, 12, 21337)` → `'C10AC4A1000C5359'`; `encodeCtid(0,0,0)` → `'C000000000000000'`; `encodeCtid(268435455, 65535, 65535)` → `'CFFFFFFFFFFFFFFF'`; decode inverts all four; `decodeCtid` accepts lower case and returns `null` for 15 or 17 digits, a first digit other than `C`, or non-hex. `classify`: `'107695660'` → ledger-index; `'0'` and `'4294967296'` → none; a 64-hex in lower case → `{kind:'hash', hash: <upper>}`; `' 0x' + 64 hex + '\n'` → hash; `'c66b4e2c000c0000'` → ctid with decoded fields; a valid classic address → account; an address with one character changed → none; an X-address for `rJF2Xa…` with tag 104882 → `{ kind: 'account', address: 'rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg', tag: 104882 }`; `'hello'` → none.
- [ ] **Step 2:** FAIL. **Step 3:** implement with `ripple-address-codec` (`isValidClassicAddress`, `isValidXAddress`, `xAddressToClassicAddress`). **Step 4:** PASS. **Step 5:** commit `feat(domain): CTIDs and search classification`.

### Task 4: Fixtures and transaction parsing

**Files:**
- Create: `test/fixtures/ledgers/{xrpl,xrpl-amm,xahau}/` (copied `.json.gz` ledgers and `manifest.json` from `data-api-new/packages/shared/test/fixtures/{xrpl/recorded,xrpl/amm,xahau/recorded}`), `test/fixtures/PROVENANCE.md`, `test/support/ledgers.ts`
- Create: `app/domain/parse/balance-changes.ts`, `app/domain/parse/amm-hops.ts`, `app/domain/parse/objects.ts`, `app/domain/parse/index.ts`
- Test: `app/domain/parse/parse.test.ts` (with `__snapshots__`)

**Interfaces:**
- Produces: `loadTx(set: 'xrpl' | 'xrpl-amm' | 'xahau', hash: string): { tx: TxJson; meta: TxMeta; ledgerIndex: number; closeTime: number }` and `allTxs(set): Array<…same…>` (test-only); types `TxJson = Record<string, unknown> & { TransactionType: string; Account: string; Fee: string; hash?: string }`, `TxMeta = { TransactionIndex: number; TransactionResult: string; AffectedNodes: AffectedNode[]; delivered_amount?: Amount }` in `app/domain/parse/types.ts`; `type Asset = { currency: string; issuer?: string }`; `type BalanceChange = Asset & { account: string; value: string; after?: string }`; `balanceChanges(tx: TxJson, meta: TxMeta, native: 'XRP' | 'XAH'): BalanceChange[]` (from `parseBalanceChanges` and `parseFinalBalances`; the library's `XRP` is relabelled `native`, so Xahau shows `XAH`); `type AmmHop = { pool: string; in: Asset & { value: string }; out: Asset & { value: string } }`; `ammHops(meta: TxMeta, native: 'XRP' | 'XAH'): AmmHop[]`; `type TouchedObject = { change: 'created' | 'modified' | 'deleted'; type: string; index: string; account?: string }`; `objectsTouched(meta: TxMeta): TouchedObject[]`; `accountsCreated(meta: TxMeta): string[]`.

- [ ] **Step 1:** Copy the fixtures. `PROVENANCE.md` lists, per directory, the source repository (`GateHubNet/data-api-new`), path, the commit (`git -C ../data-api-new rev-parse HEAD`) and the recording endpoint from each manifest.
- [ ] **Step 2: Write the failing tests:** a snapshot of `{balanceChanges, ammHops, objectsTouched, accountsCreated}` for every transaction in all three sets (one snapshot per hash); for the AMMDeposit `83F332E0…0A4B`: `ammHops` is empty (a deposit is not a swap) and `objectsTouched` contains a modified `AMM` node; for every `xrpl-amm` case whose manifest `type` is a swap through a pool, `ammHops` has one hop whose `pool` is the `Account` of an `AccountRoot` with `AMMID`, `in.value` and `out.value` positive; for a Payment, the sender's native `value` equals `−(delivered native + fee)` when the payment is native-to-native (pins that the fee is included); `accountsCreated` of a transaction that creates an account equals the `Destination`.
- [ ] **Step 3:** FAIL. **Step 4: Implement.** `amm-hops.ts` follows spec 1.1: pools are `AccountRoot` nodes with `AMMID` in Final or New fields; the native delta from `Balance` (drops → native), an issued delta from the `RippleState` between the pool and the issuer (from the pool's side: negate when the pool is the `HighLimit` issuer), skipping currencies starting with `03`; a pool with exactly one positive and one negative delta is a hop. **Step 5:** PASS; review the snapshots by eye for a Payment, an OfferCreate and an AMM swap, then commit `feat(domain): balance changes, AMM pool hops, objects touched, accounts created`.

### Task 5: Summaries, part 1 (framework and account/payment types)

**Files:**
- Create: `app/domain/describe/types.ts`, `app/domain/describe/index.ts`, `app/domain/describe/payment.ts`, `app/domain/describe/offers.ts`, `app/domain/describe/account.ts`
- Test: `app/domain/describe/describe.test.ts`

**Interfaces:**
- Consumes: Task 2 (`formatAmount`, `formatCurrency`, `resultText`), Task 4 (`parse/*`, `loadTx`).
- Produces: `type Segment = { t: 'text'; v: string } | { t: 'account'; v: string } | { t: 'amount'; value: string; currency: string; issuer?: string } | { t: 'pool'; v: string; pair: string }`; `type FlowStep = { role: 'sender' | 'pool' | 'offer' | 'destination'; account: string; label: string; amount?: { value: string; currency: string; issuer?: string } }`; `type Detail = { label: string; value: Segment[] }`; `type Description = { title: string; ok: boolean; sentence: Segment[]; flow?: FlowStep[]; details: Detail[] }`; `describe(tx: TxJson, meta: TxMeta, ctx: { native: 'XRP' | 'XAH' }): Description`.

- [ ] **Step 1: Write the failing tests.** Exact sentences, joined to text by a test helper (`account` → the address, `amount` → `'<value> <currency>'`):
  - native Payment: `'{A} sent {X} XRP to {B}.'`; cross-currency: `'{A} paid {delivered} to {B}, spending {sent}.'` plus `' through the {pair} AMM pool'` before the full stop when `ammHops` has a hop; partial payment (flag `tfPartialPayment`): `'{A} paid {delivered} of up to {Amount} to {B}.'`.
  - OfferCreate with `tfSell`: `'{A} offered to sell {TakerGets} for {TakerPays}.'`; without it: `'{A} offered to buy {TakerPays} for {TakerGets}.'`; OfferCancel: `'{A} cancelled offer {OfferSequence}.'`.
  - TrustSet: `'{A} set a trust line to {issuer} for {currency}, limit {value}.'`; AccountSet: `'{A} updated account settings.'` with details for each changed field (`Domain` decoded from hex, `SetFlag`/`ClearFlag` names); AccountDelete: `'{A} deleted the account and sent the rest to {B}.'`; SetRegularKey: `'{A} set its regular key to {K}.'` (or removed it); SignerListSet: `'{A} set a signer list of {n} signers, quorum {q}.'`; TicketCreate: `'{A} created {n} tickets.'`.
  - A failed transaction of any type: `'{A} tried to …'` (the same predicate, the verb in infinitive) and `ok: false`.
  - An unknown type `FooBar`: `'{A} submitted a FooBar.'` with one `Detail` per top-level field except the common ones (`Account`, `Fee`, `Sequence`, `SigningPubKey`, `TxnSignature`, `Flags`, `LastLedgerSequence`, `hash`).
  - `describe` of every fixture transaction does not throw and its sentence has no `undefined` (a loop over `allTxs` of all three sets).
- [ ] **Step 2:** FAIL. **Step 3:** implement, one module per family, registered in `index.ts`. **Step 4:** PASS. **Step 5:** commit `feat(domain): transaction summaries for payments, offers and account types`.

### Task 6: Summaries, part 2 (the remaining v1 types)

**Files:**
- Create: `app/domain/describe/escrow.ts`, `paychan.ts`, `checks.ts`, `nft.ts`, `amm.ts`, `xahau.ts`
- Create: `test/fixtures/ledgers/{xrpl-extra,xahau-extra}/` (recorded) and their lines in `PROVENANCE.md`
- Test: extends `app/domain/describe/describe.test.ts`

**Interfaces:**
- Consumes: Task 5.

- [ ] **Step 1: Fixtures for uncovered types.** Compare the types of spec 7.3 with the `found` maps of the copied manifests. For each missing type, record one with `data-api-new`'s script, sequentially (its default), with `--out` in this repository: `pnpm --dir ../data-api-new --filter @gatehub/data-api-shared exec ts-node scripts/record-fixtures.ts --network <net> --endpoint <wss://s2.ripple.com | wss://xahau.network> --out "$PWD/test/fixtures/ledgers/<net>-extra" --want <TypeA,TypeB> --scan 3000`. A type still not found after the scan is written down in `PROVENANCE.md` and tested with a hand-written transaction in the test file.
- [ ] **Step 2: Write the failing tests**, exact sentences: EscrowCreate `'{A} locked {X} for {B}, release after {FinishAfter}.'` (or `'until a condition is met'`); EscrowFinish `'{A} released escrow {OfferSequence} of {Owner}.'`; EscrowCancel `'{A} cancelled escrow {OfferSequence} of {Owner}.'`; PaymentChannelCreate/Fund/Claim `'{A} opened a payment channel to {B} with {X}.'` / `'{A} added {X} to channel {short}.'` / `'{A} claimed {X} from channel {short}.'`; CheckCreate/Cash/Cancel `'{A} wrote a check to {B} for up to {SendMax}.'` / `'{A} cashed a check for {X}.'` / `'{A} cancelled a check.'`; NFTokenMint `'{A} minted an NFT, taxon {t}.'` (+ transfer fee when set); NFTokenBurn, CreateOffer, CancelOffer, AcceptOffer with one sentence each; AMMCreate `'{A} created the {pair} AMM pool with {X} and {Y}.'`; AMMDeposit `'{A} added {amounts} to the {pair} pool.'`; AMMWithdraw `'{A} withdrew {amounts} from the {pair} pool.'`; AMMVote `'{A} voted for a {fee}% trading fee in the {pair} pool.'`; AMMBid `'{A} bid {X} LP tokens for the {pair} auction slot.'`; AMMDelete `'{A} deleted the {pair} pool.'`; Xahau ClaimReward `'{A} claimed balance rewards.'`, SetHook `'{A} set {n} hooks.'`, Invoke `'{A} invoked {Destination or own hooks}.'`, URITokenMint `'{A} minted a URIToken.'`, URITokenBurn/Buy/CreateSellOffer/CancelSellOffer one sentence each, Remit `'{A} remitted {amounts} to {B}.'`, Import `'{A} imported a transaction from another network.'`.
- [ ] **Step 3:** FAIL. **Step 4:** implement. **Step 5:** PASS; commit `feat(domain): summaries for escrows, channels, checks, NFTs, AMM and Xahau types`.

### Task 7: Networks, the data API client and the node client

**Files:**
- Create: `app/server/networks.ts`, `app/server/cache-class.ts`, `app/server/api-types.ts`, `app/server/data-api.ts`, `app/server/node-rpc.ts`, `api/openapi.yaml` (copy), `app/server/openapi.d.ts` (generated), `scripts/api-sync.ts`
- Test: `test/worker/data-api.spec.ts`, `test/worker/node-rpc.spec.ts`, `test/unit/api-sync.test.ts`

**Interfaces:**
- Consumes: `Env`, `getEnv` (Task 1).
- Produces:
  - `cache-class.ts`: `type CacheClass = 'immutable' | 'live-home' | 'live' | 'slow' | 'short'`; `const CACHE_CLASSES: Record<CacheClass, { edgeTtl: number; swr: number; browser: { html: string; image: string } }>` with the Global Constraints values; `interface SubrequestCache { json<T>(key: string, cls: CacheClass, load: () => Promise<T>, ttlOverride?: number): Promise<T> }` (implemented in Task 8; tests here pass a pass-through `{ json: (_k, _c, load) => load() }`).
  - `type NetworkId = 'xrpl' | 'xahau'`; `interface Network { id: NetworkId; name: 'XRPL' | 'Xahau'; native: 'XRP' | 'XAH'; ctidNetworkId: 0 | 21337; dataApiUrl: string; nodeUrl: string; other: NetworkId }`; `isNetworkId(s: string): s is NetworkId`; `networkOf(id: NetworkId, env: Env): Network`.
  - `api-types.ts`: `Ledger`, `TxObject` (`{hash, ledger_index, date, ledger_hash?, tx, meta}`), `Page<K extends string, T>` (`{ result: 'success'; count: number; marker?: string } & Record<K, T[]>`), `AccountData`, `Balance`, `BalancesResponse`, `Order`, `OrdersResponse`, `Payment`, `AccountExchange`, `FeeRow`, `LastValidated`, with fields and key names as in `data-api-new/docs/api-reference.md` (sections Ledgers, Transactions, Payments, Exchanges, Accounts, Network).
  - `class UpstreamError extends Error { kind: 'not_found' | 'bad_request' | 'rate_limited' | 'server' | 'timeout' | 'network'; status?: number; retryAfter?: number }`.
  - `createDataApi(net: Network, env: Env, cache: SubrequestCache): DataApi` with `lastValidated()`, `ledger(id: string, opts?: { expand?: boolean; transactions?: boolean })`, `transaction(hash: string)`, `transactions(q: ListQuery)`, `account(a)`, `balances(a)`, `orders(a)`, `accountTransactions(a, q)`, `accountPayments(a, q)`, `accountExchanges(a, q)`, `fees(q: { descending: boolean; limit: number })`; `ListQuery = { descending?: boolean; limit?: number; marker?: string }`.
  - `createNodeRpc(net: Network, cache: SubrequestCache): NodeRpc` with `tx(hash)`, `ledger(id, opts)`, `accountInfo(a)`, `accountObjects(a, opts?: { limit?: number; marker?: string })`, `serverState()`; errors `actNotFound`, `txnNotFound`, `lgrNotFound` → `UpstreamError('not_found')`.
- [ ] **Step 1: Write the failing tests** (Workers pool; `globalThis.fetch` stubbed with `vi.spyOn`): every data API request carries `X-API-Key` and goes to `<dataApiUrl>/v2/...`; 404 → `UpstreamError('not_found')`; 429 with `Retry-After: 4` → `rate_limited`, `retryAfter: 4`; a hung fetch → `timeout` after 5 s (fake timers); node calls POST `{ method, params: [ … ] }` and time out at 3 s; `actNotFound` → `not_found`; `networkOf('xahau', env).ctidNetworkId === 21337`. `api-sync.test.ts`: the script copies `$DATA_API_REPO/docs/openapi.yaml` into `api/openapi.yaml` (temp dirs) and regenerates `app/server/openapi.d.ts`.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** `data-api.ts` keeps its endpoint paths in one object typed `satisfies Record<string, keyof paths>` (`paths` from `openapi.d.ts`), so a path that disappears from the API fails `pnpm typecheck`. Add the script `api:check` (regenerate `openapi.d.ts` from the committed `api/openapi.yaml` into a temp file and fail if it differs from the committed one) and put it in `verify`. Cache classes per call: ledger/transaction/marker pages `immutable`, `lastValidated` and first pages `live`, `account` `slow`, `serverState` `slow` with a 300 s TTL override. **Step 4:** PASS, `pnpm typecheck` PASS. **Step 5:** commit `feat(server): networks, data API and node clients`.

### Task 8: The Worker entry — edge cache, visitor limit, logging

**Files:**
- Create: `app/server/edge-cache.ts`, `app/server/logging.ts`
- Modify: `workers/app.ts`
- Test: `test/worker/edge-cache.spec.ts`, `test/worker/entry.spec.ts`

**Interfaces:**
- Consumes: `CacheClass`, `CACHE_CLASSES`, `SubrequestCache` (Task 7).
- Produces: `cached<T>(payload: T, cls: CacheClass, opts?: { ttl?: number; status?: number; headers?: HeadersInit })` (wraps React Router's `data()` and sets the internal headers `X-Cache-Class` and, with `ttl`, `X-Cache-Ttl`); `forwardCacheClass` (a route `headers` function that copies both from the loader headers); `createSubrequestCache(ctx: ExecutionContext, buildId: string): SubrequestCache`; `withEdgeCache(request: Request, env: Env, ctx: ExecutionContext, render: () => Promise<Response>): Promise<Response>`.
- [ ] **Step 1: Write the failing tests** (`SELF.fetch` and direct calls with a fake `render`):
  - A `render` answering with `X-Cache-Class: immutable` is stored; the second request is served from the cache with `X-Cache: HIT`, the browser `Cache-Control` of the class, and neither internal header. `X-Cache-Ttl: 60` with class `short` keeps the copy fresh for 60 s instead of 30.
  - `live`: after 5 s (fake clock in the stored metadata) the stale copy is served with `X-Cache: STALE` and `render` runs once in `ctx.waitUntil`; after 35 s `render` runs inline.
  - A `render` that answers 503 or throws, with a stored copy of any age up to 24 h → the stored copy with `X-Cache: STALE`; without one → the 503 page with `Retry-After: 30`.
  - 4xx/5xx/429 answers are never stored, except a 404 marked `short`.
  - The key includes `BUILD_ID`: a different build ID misses.
  - Non-GET requests and `/` (the redirect) bypass the cache.
  - The visitor limiter is consulted only on a miss; when it refuses, the answer is the 429 page with `Retry-After: 10` and `render` does not run.
  - Every response has `X-Request-Id`; one structured log line per request (`{ id, method, path, status, cache, ms }`).
- [ ] **Step 2:** FAIL. **Step 3: Implement.** The Cache API ignores `stale-while-revalidate`, so the stored copy carries its class and store time in internal headers and the entry decides freshness itself; stored entries live `max(edge TTL + 30 s, 24 h)` so stale-if-error works. Sentry is initialised only when `SENTRY_DSN` is set. **Step 4:** PASS. **Step 5:** commit `feat(worker): edge cache, visitor limit and request logging`.

### Task 9: UI system, layout and the network routes

**Files:**
- Create: `app/ui/tokens.css`, `app/ui/fonts.css` (Geist and Geist Mono from the `geist` package), `app/ui/brand.ts`, `app/ui/theme-script.ts`, `app/ui/components/*.tsx` (`Header`, `NetworkSwitch`, `SearchBox`, `Footer`, `Card`, `StatTile`, `Pill`, `TypeTag`, `Amount`, `AccountLink`, `HashLink`, `CopyButton`, `DataTable`, `Tabs`, `Pager`, `Breadcrumbs`, `Notice`, `SectionError`)
- Create: `app/routes/index.tsx` (`/`), `app/routes/net.tsx` (layout of `/:net`), `app/routes/not-found.tsx` (`*`), `app/routes/robots[.]txt.ts`
- Modify: `app/root.tsx`, `app/routes.ts`
- Test: `app/ui/components/components.test.tsx`, `test/worker/layout.spec.ts`

**Interfaces:**
- Consumes: `networkOf`, `isNetworkId` (Task 7), `cached` (Task 8), `classify` (Task 3).
- Produces: the `/:net` layout provides `useNetwork(): Network` to child routes (via its loader data); components take only props. `SearchBox` posts to `/{net}/search` (`method="get"`, `name="q"`) and shows `classify` hints as you type.
- [ ] **Step 1: Write the failing tests:** `/` → 302 to `/xrpl`, and to `/xahau` with the cookie `net=xahau`, `Cache-Control: no-store`; `/doge` → 404 page (`noindex`); `/xahau` sets `net=xahau`; the HTML has `<html data-theme>` set only by the inline theme script (the script is in `<head>` before the stylesheet); the Header on `/xahau/...` has the Xahau accent (`--accent: #B45309`) and the switch links to `/xrpl`; `SearchBox` typing `107695660` shows the hint "Ledger #107,695,660"; pressing `/` focuses the search box, but not while another input has focus; `robots.txt` disallows `/*/search`. Component tests render `Pill` with an icon and text, and `Amount` with `formatAmount`.
- [ ] **Step 2:** FAIL. **Step 3: Implement** to the mock boards (`Main`, `Ledger`, `Transaction`, `Account` for the header, footer, tables and pills) and spec section 8 tokens. Navigation items Network, Markets and AMM render as non-link labels with a "soon" tag. **Step 4:** PASS. **Step 5:** commit `feat(ui): design system, layout, network routes and theme`.

### Task 10: Upstream fixtures for loaders and end-to-end tests

**Files:**
- Create: `scripts/make-http-fixtures.ts`, `test/fixtures/http/{xrpl,xahau}/…` (generated JSON plus hand-written account files), `test/support/upstream.ts`
- Test: `test/worker/upstream.spec.ts`

**Interfaces:**
- Consumes: `loadTx`/`allTxs` (Task 4), `api-types.ts` (Task 7).
- Produces: `mockUpstream(net: NetworkId, overrides?: Record<string, unknown | ((req: Request) => Response)>): void` — stubs `fetch` for the data API (by method, path and query) and the node (by JSON-RPC `method` and first param), serving `test/fixtures/http/<net>/` and answering 404 / `actNotFound` / `txnNotFound` for anything absent; also exported as a small Node HTTP server, `startFixtureServer(port: number)`, for Task 15.
- [ ] **Step 1:** `make-http-fixtures.ts` turns the copied ledgers into data API answers in the shapes of `api-types.ts`: `/v2/ledgers/{index}` (plain, `?transactions=true`, `?expand=true`) and `/v2/ledgers/{hash}`, `/v2/transactions/{hash}`, `/v2/transactions?descending=true&limit=8`, `/v2/last_validated`, `/v2/network/fees?descending=true&limit=8`; and node answers `tx`, `ledger`. Hand-write, from the API reference examples and real fixture addresses, the account files for two accounts per network (one active with tokens, offers and an escrow; one deleted) and one never-funded address: `/v2/accounts/{a}`, `/balances`, `/orders`, `/transactions`, `/payments`, `/exchanges` (two pages each, linked by `marker`), `account_info`, `account_objects`, `server_state`.
- [ ] **Step 2: Write the failing test:** `mockUpstream('xrpl')` makes `createDataApi(...).transaction(<a fixture hash>)` resolve, an unknown hash reject with `not_found`, and `createNodeRpc(...).accountInfo(<never funded>)` reject with `not_found`.
- [ ] **Step 3:** FAIL → implement → PASS. **Step 4:** commit `test: upstream fixtures and mock`.

### Task 11: Home and ledger pages

**Files:**
- Create: `app/routes/net._index.tsx`, `app/routes/net.ledger.$id.tsx`, `app/ui/pages/HomePage.tsx`, `app/ui/pages/LedgerPage.tsx`
- Test: `test/worker/home.spec.ts`, `test/worker/ledger.spec.ts`

**Interfaces:**
- Consumes: Tasks 7–10; `accountsCreated` (Task 4); `describe` (Task 5).
- [ ] **Step 1: Write the failing tests** (`mockUpstream`): home shows the latest ledger index, four tiles, 8 latest ledgers with their transaction counts from `/v2/network/fees`, 8 latest transactions with summaries, `X-Cache-Class: live-home` (seen as the stored class); ledger by index and by hash render the header fields, counts by type and result, accounts created, previous/next links (next absent at `last_validated`), class `immutable` (`live` when it is the newest); a lower-case hash redirects to the upper-case URL; a ledger with 1500 transactions (a synthetic fixture via `overrides`) renders 100 rows and a "Show all 1,500" control that reveals the rest without a request; the type filter buttons filter the rows client-side; a ledger the data API answers 404 for but the node has validated (override) renders with the note "Not in the index yet, shown from the network" and a 60 s TTL; neither → 404.
- [ ] **Step 2:** FAIL. **Step 3:** implement to the `Main` and `Ledger` boards. **Step 4:** PASS. **Step 5:** commit `feat: home and ledger pages`.

### Task 12: Search, CTIDs and not-found

**Files:**
- Create: `app/routes/net.search.tsx`, `app/server/resolve.ts`, `app/ui/pages/SearchChoicePage.tsx`, `app/ui/pages/NotFoundPage.tsx`
- Test: `test/worker/search.spec.ts`, `test/worker/resolve.spec.ts`

**Interfaces:**
- Consumes: `classify`, `decodeCtid` (Task 3); data API (Task 7).
- Produces: `resolveCtid(api: DataApi, net: Network, ctid: string): Promise<{ hash: string } | { otherNetwork: NetworkId } | null>` in `app/server/resolve.ts`, used by Task 13.
- [ ] **Step 1: Write the failing tests:** `/xrpl/search?q=107695660` → 302 `/xrpl/ledger/107695660`; a fixture tx hash → 302 `/xrpl/tx/<hash>`; a fixture ledger hash → 302 `/xrpl/ledger/<hash>`; a hash that both endpoints answer (override) → 200 choice page with both links; an address → 302 `/xrpl/account/<a>`; an X-address → 302 with `?tag=`; `q=hello` → 200 help text; an unknown hash → 404 page whose "Search on Xahau" link is `/xahau/search?q=<hash>`; a Xahau CTID on `/xrpl` → page offering `/xahau/tx/<ctid>`; every search page is `noindex, follow` and class `short`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit `feat: search, CTID resolution and not-found pages`.

### Task 13: Transaction page

**Files:**
- Create: `app/routes/net.tx.$id.tsx`, `app/ui/pages/TransactionPage.tsx`, `app/ui/components/Flow.tsx`, `app/ui/components/RawTabs.tsx`
- Test: `test/worker/transaction.spec.ts`

**Interfaces:**
- Consumes: `describe` (Tasks 5–6), `parse/*` (Task 4), `resolveCtid` (Task 12), data API and node (Task 7), `cached` (Task 8).
- [ ] **Step 1: Write the failing tests:** a fixture Payment renders the title, the result pill with `tesSUCCESS` and its text, the summary sentence, details (hash, CTID computed by `encodeCtid`, ledger link, date, fee), balance changes with "Balance after", objects touched, previous/next links by position from `?transactions=true`, raw tabs; class `immutable`; an AMM swap fixture renders a pool step in the flow; a lower-case hash → 302 to the upper-case URL; `/xrpl/tx/<ctid>` → 302 to the hash URL; an id that is neither → 404; data API 404 but node `tx` validated (override) → page with the note "Not in the index yet, shown from the network" and a 60 s TTL (stored class `short` with TTL override 60); data API 503 with no cached copy → 503 page.
- [ ] **Step 2:** FAIL. **Step 3:** implement to the `Transaction` board. **Step 4:** PASS. **Step 5:** commit `feat: transaction page`.

### Task 14: Account page

**Files:**
- Create: `app/routes/net.account.$address.tsx`, `app/routes/net.account.$address.payments[.csv].ts`, `app/ui/pages/AccountPage.tsx`, `app/ui/components/Identicon.tsx`, `app/ui/components/QrButton.tsx`
- Test: `test/worker/account.spec.ts`

**Interfaces:**
- Consumes: Tasks 7–10; `formatAmount`, `dropsToNative` (Task 2).
- [ ] **Step 1: Write the failing tests:** the active fixture account renders address, activation (parent, date, initial balance), flags, sequence, domain decoded from hex, balance, available and reserve computed from `server_state` (`reserve_base` + owner count × `reserve_inc`), tokens with LP tokens as "LP token", owned-object counts; `?tab=transactions|payments|trades|offers|objects` each render their list, the tab list streams after the header (the HTML contains the header before the list's resolved markup); Older uses the marker and that page is class `immutable` and `noindex, follow`; Payments has a CSV link to the explorer's own `/xrpl/account/<a>/payments.csv` resource route that proxies the API's `format=csv` with the key; the deleted account renders history with the "Deleted" banner; the never-funded address → 404 "This address has never been activated"; the node failing (override → 500) renders history and "Live state unavailable"; the tab list's request failing (override → 503) renders the header and, in place of the list, "Couldn't load transactions" with a Retry button that refetches it in the browser; `account_objects` with a `marker` shows "Showing the first 400 objects"; `?tag=104882` shows the destination-tag note; class `live`.
- [ ] **Step 2:** FAIL. **Step 3:** implement to the `Account` board; the Analytics tab is a disabled tab with "soon". **Step 4:** PASS. **Step 5:** commit `feat: account page`.

### Task 15: SEO, link previews, end-to-end and the pipeline

**Files:**
- Create: `app/server/meta.ts`, `app/routes/og.$net.$kind.$id[.png].tsx`, `app/og/card.tsx`, `test/e2e/*.spec.ts`, `playwright.config.ts`, `scripts/check-bundle.ts`
- Modify: every page route's `meta` export; `README.md`; `package.json` scripts
- Test: `test/worker/meta.spec.ts`, `test/worker/og.spec.ts`, `test/e2e/*`

**Interfaces:**
- Consumes: everything above; `startFixtureServer` (Task 10).
- [ ] **Step 1: Write the failing tests:** transaction, ledger and account pages have `<title>`, meta description (e.g. a Payment: `'Payment of 1,250.00 USD from rJF2Xa…FQvg to rNYbL8…Kq5 · XRPL ledger 107,695,660'` built from the fixture's values), canonical URL, `og:*` and `twitter:card` tags, `og:image` = `/og/<net>/<kind>/<id>.png`; the image route answers `image/png` 1200 × 630 (check the PNG header bytes), class `immutable` for tx/ledger and `slow` for account.
- [ ] **Step 2:** FAIL → implement (`workers-og` with the bundled Geist fonts, layout of the `LinkPreview` board) → PASS.
- [ ] **Step 3: End-to-end suite** (`playwright.config.ts` starts `startFixtureServer` and `wrangler dev` with the URLs pointed at it; `E2E_DATA_API_URL`/`E2E_NODE_URL` switch to a real stack): search to a transaction; ledger previous/next; account tabs and Older; network switch; theme toggle with no flash (the `data-theme` attribute is present in the first paint snapshot); an OG image loads; `@axe-core/playwright` reports no serious or critical violations on home, ledger, transaction, account and 404, light and dark.
- [ ] **Step 4:** `scripts/check-bundle.ts` fails when the gzipped JavaScript a page loads exceeds 150 KB (read from the build's client manifest); add it to `verify`.
- [ ] **Step 5:** `README.md`: run, test, deploy, the pipeline the spec section 13 requires (`pnpm verify`, `pnpm test:e2e`, `wrangler deploy --env <env>`), `pnpm api:sync`, the fixtures' provenance. Run `pnpm verify` and `pnpm test:e2e`; expect PASS. Commit `feat: SEO, link previews, end-to-end suite and pipeline`.
