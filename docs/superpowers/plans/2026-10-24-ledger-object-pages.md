# Ledger Object Pages and Delegation (E10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `/{net}/escrows/{id}` (and the `/{net}/escrows/{owner}/{sequence}` redirect), `/{net}/checks/{id}` and `/{net}/payment-channels/{id}` from D5's index with the node as fallback, the account page's Delegation tab, the "Sent by" row and `DelegateSet` sentences of the transaction page, and links into the pages from transactions, the Objects tab and search, behind the `LEDGER_OBJECTS` and `DELEGATION` switches.

**Architecture:** One loader (`app/server/object-load.ts`) serves the three object routes: pure URL checks first, then D5's object call beside `server_state`, the node's `ledger_entry` only on the index's `not found`, one E9 names call, a pure view builder per type over a shared common part (`ledger-object-view.ts`), and `cached(page, class)`. Pages draw data through a shared frame and five new components; times are absolute in the data and become ages and countdowns in the browser. Delegation reaches the account page as one more list tab and the transaction page through `describe()`, whose new segments (`object`, `permission`) every renderer handles.

**Tech Stack:** React Router 8.4 (framework mode) on Cloudflare Workers, React 19, TypeScript, `bignumber.js`, `ripple-address-codec`, Web Crypto, Vitest (`unit`, `components` with happy-dom, `worker`, `worker-off`, E7's `worker-sandbox`), Playwright with axe.

**Spec:** `docs/superpowers/specs/2026-10-24-ledger-object-pages-design.md` (cited as "§n"); its data is D5, `data-api/docs/superpowers/specs/2026-10-24-ledger-objects-delegation-design.md` (cited as "D5 §n"). Boards: `docs/superpowers/specs/2026-10-24-explorer-mock/{Escrow,Check,PayChannel,Delegation,Account,Transaction}.dc.html`. Executors read the spec with this plan; where it says "the board's" words, copy them from the board.

**Branch:** `feat/explorer-pages-2` in `EXP = /Users/golobitch/github.com/GateHubNet/x-explorer-worktrees/explorer-pages-2`. Before Task 1 the E7, E8 and E9 plans are built on this branch, and D5 is built on `feat/explorer-data-2` in `DAPI = /Users/golobitch/github.com/GateHubNet/data-api-worktrees/explorer-data-2` (read it only with `git -C "$DAPI" show`, never change it). Commit here; never push.

**The pinned D5 reference.** Task 1 records `PIN`, the newest DAPI commit that touched `docs/api-reference.md`; the types and fixtures follow it, and Task 1's commit message and `test/fixtures/PROVENANCE.md` name it. Where the reference and D5's spec examples differ, the reference wins.
```sh
DAPI=/Users/golobitch/github.com/GateHubNet/data-api-worktrees/explorer-data-2
PIN=$(git -C "$DAPI" log -1 --format=%H feat/explorer-data-2 -- docs/api-reference.md)
git -C "$DAPI" show "$PIN:docs/api-reference.md"
```

## Consumed from the earlier plans

| Piece | From | Where |
|---|---|---|
| `ENVIRONMENT`; `Network.kind`; `NETWORKS` as a table by kind (`hasAmm` beside it); `PublicNetwork` carrying the facts; the `sandbox` and `production` blocks of `wrangler.jsonc`; the `worker-sandbox` project | E7 | `app/server/networks.ts`, `network-route.ts`, `wrangler.jsonc`, `vitest.config.ts` |
| `Coverage` (type), `checkCoverage(body)`, `coverageNote(coverage, words)` → `CoverageNoteText \| null`, `CoverageNote({ net, note })` | E8 | `app/server/api-types.ts`, `app/server/coverage.ts`, `app/ui/components/CoverageNote.tsx` |
| The search sequence: `findHash(api, node, hash, opts: HashQuestions)` with `HashQuestions { net: NetworkId; nfts: boolean }`, `HashMatches.nft`, the choice page's rows, the hints' `nfts` words; `ACCOUNT_TABS` with `nfts`; `objectRows`' NFT rows; `Segment` `nft`; `NFTS`; the node's NFT readers | E8 | `app/server/resolve.ts`, `app/ui/pages/SearchChoicePage.tsx`, `app/ui/search-hints.ts`, `app/domain/account-tabs.ts`, `app/server/account-view.ts`, `app/domain/describe/types.ts` |
| `collectAddresses(...parts)`, `loadNames(api, addresses, { context, request, features, holdFailure?, deadlineMs? })` → `{ part: NamesPart; entries }`, `NamesProvider`, `useNameOf`, `plainNameOf`, `AccountLink` (`net`, `address`, `full?`, `variant?`), `NAMES` | E9 | `app/server/names-load.ts`, `app/ui/names.tsx`, `app/domain/names.ts`, `app/ui/components/AccountLink.tsx` |
| `cached`, `forwardCacheClass`, `cacheClassHeaders`, `MARKER_PAGE_CLASS`, `notFound`, `upstreamOutage`, `requireNetwork`, `clientsFor`, `markDegraded`, `logProblem`, `isMarker`, `parseTrail`, `trailPaging`, `isNumberText`, `isDecimalText`, `isIsoTime`, `RIPPLE_EPOCH_OFFSET`, `formatUtc`, `shortHash`, `shortAddress`, `suffixOf`, `sharing`, `Countdown`, `RelativeTime`, `ShareBar`, `Notice`, `Pill`, `Sentence`, `DetailList`, `HashLink`, `LedgerLink`, `TypeTag`, `SectionError`, `mulberry32`, `seedOf` | earlier programs | `app/server/*`, `app/domain/*`, `app/ui/*`, `scripts/synthetic.ts` |

## Global Constraints

- Commands from the worktree root: `pnpm install` (once), `pnpm test` (narrow with a path, or `pnpm test --project worker <path>` / `--project worker-off` / `--project components`), `pnpm typecheck`, `pnpm verify` (`api:check`, `typecheck`, `test`, `build`, `check:bundle`), `pnpm fixtures:check`, `pnpm test:e2e` (Playwright; it builds the Worker). `pnpm verify` exits 0 before every commit; `pnpm test:e2e` too after a task that touches a page.
- Commits: Conventional Commits in this repository's style (`feat(ui): …`, `feat(data-api): …`, `test(fixtures): …`, `docs: …`), a body that says why, and the last line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Name the files in `git add` (never `-A`), never `--amend`, never touch `.claude/`.
- Switches: `LEDGER_OBJECTS` (`ledgerObjects`) and `DELEGATION` (`delegation`), appended last to `FEATURE_VARS` and `FEATURE_NAME`, `"on"` at the top level and in the tests, `"off"` in `sandbox` and `production`. `LEDGER_OBJECTS` gates the three routes and the redirect (404 `short`, no call, while off), every link of §7 but the Delegate ones, and the object question of search. `DELEGATION` gates the Delegation tab ("soon" while off) and every link into it. **Not gated** (decision 5): the "Sent by" row, the "sent it on behalf of" sentence, the `DelegateSet` sentences and the "· sent by" tail of a list row.
- Edge classes (§9): an object in the ledger (index or node) `live`; a removed object `slow`; a page of older events `MARKER_PAGE_CLASS`; the owner/sequence and upper-case redirects `immutable`; not found, switch off, a bad ID `short`; the Delegation tab `live`. A 503 and a degraded page are never stored.
- IDs: exactly 64 hex digits (`0x…` is a 404); any lower-case letter is a 302 (`immutable`) to the upper-case URL with the query kept, before any call.
- Page data holds strings and unix seconds, never ages: times are written with `formatUtc` and drawn beside `RelativeTime` (past) or `Countdown` (future), so the stored page is the same at any age. No `Intl`, no locale, no clock in a render.
- Every address is drawn by E9's `AccountLink`; each loader passes the parts it shows to `collectAddresses` and makes one `loadNames` call after its awaited calls; a names call that fails or is late leaves addresses and a degraded page.
- `coverage` is checked with E8's `checkCoverage` and written with E8's `coverageNote` and `CoverageNote`; an index answer's `status` is used as it is; a node-read object's status comes from `app/domain/object-status.ts` at the request time.
- Amounts: native and MPT values are checked with `isDecimalText`, issued-token values with `isNumberText` (the ledger writes large and tiny token values in exponent form, and D5 serves them as on the ledger); an MPT amount is drawn by `MptAmount` (raw units, no scale: E14 adds it).
- Browser files (pages, components, the `app/domain` files they import, `meta-*.ts`) import nothing from `app/server` as values; `describe/`, `parse/`, `keylet.ts` and `ripple-address-codec` stay in the Worker; `app/domain/permissions.ts` holds names and words only. Each page is a lookup page: 150,000 B gzip with the route manifest (`pnpm check:bundle`).
- Status is an icon and a word, never colour alone; 44 px touch targets; no horizontal scroll at 375 px; axe clean in both themes.
- Worker specs share one Cache API per file: failure tests first, distinct IDs per test, in the order each task gives.
- Copy is §4–§8's, exactly; "the board's" words are copied from the board named.

## Review Focus

1. **The index has no row of the object.** The node's entry of the same type is shown (`origin: "node"`, no history, the node note), another tracked type is a 302 to its page, `entryNotFound` or an untracked type is the 404 offering "Search on {other}"; an index failure other than `not found` is a 503 with the node not asked; the node failing after the index's 404 is a 503. Tests: Task 9 `ledger-objects.spec.ts` "falls back to the node…", "redirects to the check page…", "offers the other network…", "answers 503 without asking the node…", "answers 503 when the node fails…"; Task 10 the same for a check.
2. **A side call failing.** `server_state` failing drops only the Owner reserve row, a names call failing leaves addresses; both pages are served, marked degraded and never stored. Tests: Task 9 "serves the page without Owner reserve…", "serves addresses when the names call fails…".
3. **Switches off.** `LEDGER_OBJECTS` off: every object route a 404 with no call, every object link plain text, search asks no object question; `DELEGATION` off: the "soon" tab, `?tab=delegation` a 302 without a call, the Sent by row still shown without its link. Tests: Task 9/10 `ledger-objects-off.spec.ts`; Task 11 `delegation-off.spec.ts`; Task 12 `TransactionPage.test.tsx` "shows Sent by without the link while DELEGATION is off"; Task 13 `Sentence` "draws an object as text while LEDGER_OBJECTS is off"; Task 14 `search.spec.ts` off case.
4. **Xahau and odd amounts.** No Delegation tab on Xahau (`?tab=delegation` a 302) and never a Sent by row; issued-token escrows and channels show their issuer and a hex currency code, an exponent-form token value is accepted and formatted, an MPT escrow shows raw units through `MptAmount`. Tests: Task 1 `object-shape.test.ts` "accepts an exponent-form token value…"; Task 7 `escrow-view.test.ts` "shows an MPT escrow raw and a token escrow with its issuer"; Task 8 the Xahau token channel; Task 11 "Xahau: no tab…".
5. **Time.** Statuses flip at D5's boundary seconds for a node-read object, and a stored page holds no age or countdown text. Tests: Task 4 `object-status.test.ts` boundary table and "agrees with every derived answer"; Task 9 "holds no age or countdown in the stored HTML".

---

### Task 1: D5's API description, types, shape checks and calls

**Files:**
- Modify (by `DATA_API_REPO=$DAPI pnpm api:sync`): `api/openapi.yaml`, `app/server/openapi.d.ts`
- Modify: `app/server/api-types.ts`, `app/server/data-api.ts` (eight methods, their `PATHS`), `app/server/node-rpc.ts` (`ledgerEntry`)
- Create: `app/server/object-shape.ts`, `app/server/object-shape.test.ts`, `test/support/object-samples.ts`
- Test: `test/worker/data-api.spec.ts`, `test/worker/node-rpc.spec.ts`

**Interfaces:**
- Consumes: E8's `Coverage` and `checkCoverage`; the client's `get(template, params, query, cls, { unwrap?, finish })` and `listQuery`; `isDecimalText`, `isNumberText`, `isIsoTime`, `isValidClassicAddress`.
- Produces, `api-types.ts` (hand-written from `$PIN:docs/api-reference.md`, keys in its order, optional exactly where it says a key is absent):
  ```ts
  export type ObjectAmount = { currency: string; issuer?: string; value: string; mpt_issuance_id?: string };
  export type ObjectRef = { ledger_index: number; time: string; tx_hash: string; tx_type?: string };   // tx_type on `removed`
  export type EscrowStatus = "pending" | "can_be_finished" | "can_be_cancelled" | "finished" | "cancelled" | "removed";
  export type CheckStatus = "open" | "expired" | "cashed" | "cancelled" | "removed";
  export type ChannelStatus = "open" | "closing" | "closed" | "removed";
  export interface EscrowObject { escrow_id: string; account: string; sequence?: number; destination: string; amount: ObjectAmount; finish_after?: string;
    cancel_after?: string; condition?: string; fulfillment?: string; destination_tag?: number; source_tag?: number; transfer_rate?: number;
    status: EscrowStatus; created?: ObjectRef; removed?: ObjectRef }
  export interface CheckObject { check_id: string; account: string; sequence?: number; destination: string; send_max: ObjectAmount; expiration?: string;
    invoice_id?: string; destination_tag?: number; source_tag?: number; delivered?: ObjectAmount; status: CheckStatus; created?: ObjectRef; removed?: ObjectRef }
  export interface PaymentChannelObject { channel_id: string; account: string; sequence?: number; destination: string; amount: ObjectAmount; balance: ObjectAmount;
    remaining: ObjectAmount; settle_delay: number; public_key: string; expiration?: string; cancel_after?: string; destination_tag?: number; source_tag?: number;
    status: ChannelStatus; opened_with?: ObjectAmount; funds: number; claims: number; created?: ObjectRef; removed?: ObjectRef }
  export interface ObjectEvent { event: string; ledger_index: number; time: string; tx_hash: string; tx_type: string; account: string; delegate?: string; result: string;
    amount?: ObjectAmount; fulfillment?: string; send_max?: ObjectAmount; expiration?: string; delivered?: ObjectAmount; balance?: ObjectAmount;
    amount_change?: ObjectAmount; balance_change?: ObjectAmount; settle_delay?: number }
  interface AsOfAnswer { result: "success"; coverage: Coverage; ledger_index: number; close_time: string }
  export interface EscrowAnswer extends AsOfAnswer { escrow: EscrowObject; history: ObjectEvent[]; history_marker?: string }
  export interface CheckAnswer extends AsOfAnswer { check: CheckObject; history: ObjectEvent[]; history_marker?: string }
  export interface PaymentChannelAnswer extends AsOfAnswer { payment_channel: PaymentChannelObject; history: ObjectEvent[]; history_marker?: string }
  export interface ObjectHistoryPage extends AsOfAnswer { count: number; marker?: string; history: ObjectEvent[] }
  export interface DelegationPermission { permission: string; kind: "transaction" | "granular" | "unknown"; transaction_type?: string }
  export interface Delegation { delegation_id: string; account: string; authorize: string; permissions: DelegationPermission[]; updated: ObjectRef; created?: ObjectRef }
  export interface DelegationsPage extends AsOfAnswer { count: number; marker?: string; delegations: Delegation[] }
  export interface LedgerObjectRef { object_id: string; object_type: "Escrow" | "Check" | "PayChannel" | "Delegate"; account: string; deleted: boolean; ledger_index: number }
  export type ObjectApiKind = "escrow" | "check" | "payment_channel";
  export type ObjectAnswer = EscrowAnswer | CheckAnswer | PaymentChannelAnswer;
  ```
- Produces, `DataApi` (`PATHS` with the path parameter names of `$PIN:docs/openapi.yaml`; history queries in the order `descending`, `limit`, `marker`; delegations `direction`, `limit`):
  ```ts
  escrow(id: string): Promise<EscrowAnswer>;                                                         // /v2/escrows/{id}, live
  escrowHistory(id: string, q: { descending: true; limit: number; marker?: string }): Promise<ObjectHistoryPage>; // MARKER_PAGE_CLASS
  check(id: string): Promise<CheckAnswer>;  checkHistory(id, q): Promise<ObjectHistoryPage>;         // /v2/checks/{id}[/history]
  paymentChannel(id: string): Promise<PaymentChannelAnswer>;  paymentChannelHistory(id, q): Promise<ObjectHistoryPage>; // /v2/payment_channels/{id}[/history]
  accountDelegations(address: string, q: { direction: "given" | "held"; limit: number }): Promise<DelegationsPage>; // live
  ledgerObject(id: string): Promise<LedgerObjectRef>;                                                // /v2/ledger_objects/{id}, live, unwrap "ledger_object"
  ```
- Produces, `NodeRpc`: `ledgerEntry(index: string): Promise<{ node: LedgerObject; index: string; ledger_index: number }>` (`ledger_entry { index, ledger_index: "validated" }`, class `live`; `entryNotFound` is `not_found`; `validated` must be `true`; the answer's `index` must equal the one asked).
- Produces, `object-shape.ts` (each `(…, body: unknown, path: string)` returning the body typed, run as `get()`'s `finish` inside the cached load; a failure throws `UpstreamError("server", …, { status: 200 })`, never stored):
  ```ts
  export const OBJECT_STATUSES: Readonly<Record<ObjectApiKind, readonly string[]>>;   // D5 §5.2
  export const OBJECT_EVENTS: Readonly<Record<ObjectApiKind, readonly string[]>>;     // D5 §2.2 for Escrow, Check, PayChannel (with "update")
  export function checkObjectAnswer(kind: "escrow", body: unknown, path: string): EscrowAnswer;   // and the overloads for "check", "payment_channel"
  export function checkObjectHistory(kind: ObjectApiKind, body: unknown, path: string): ObjectHistoryPage;
  export function checkDelegations(body: unknown, path: string): DelegationsPage;
  export function checkLedgerObject(body: unknown, path: string): LedgerObjectRef;
  ```
  Rules: IDs, hashes and the object's own ID are `/^[0-9A-F]{64}$/` (the ID equals the one asked); accounts are classic addresses with a valid checksum; amounts as Global Constraints say (an issued token is one with `issuer` and no `mpt_issuance_id`; an MPT's `currency` and `mpt_issuance_id` are the same 48 upper-case hex digits); times pass `isIsoTime`; `ledger_index`, counts and tags are whole numbers; statuses and events are in the lists; `coverage` passes `checkCoverage`; `permissions[].kind` is one of the three; `object_type` one of the four.
- Produces, `test/support/object-samples.ts`: `escrowAnswerSample`, `checkAnswerSample`, `paymentChannelAnswerSample`, `historySample`, `delegationsSample`, `ledgerObjectSample`, each `(over?) => T`, a small valid XRPL answer with a shallow override.

- [ ] **Step 1: Sync, pin and write the failing tests.** Run `DATA_API_REPO=$DAPI pnpm api:sync` and the pin commands; `git -C "$DAPI" show "$PIN:docs/api-reference.md" | grep -n 'v2/escrows\|v2/checks\|v2/payment_channels\|ledger_objects\|/delegations'` must show D5's routes (stop otherwise: D5 is not built). Then:
  ```ts
  // object-shape.test.ts
  it.each([["escrow", escrowAnswerSample()], ["check", checkAnswerSample()], ["payment_channel", paymentChannelAnswerSample()]])("accepts a well-formed %s answer", …);
  it("accepts an exponent-form token value and an MPT amount", …);   // { currency: "USD", issuer, value: "1000000000000000e-4" }; mptAmount sample
  it.each([["an account that is an X-address", …], ["an ID in lower case", …], ["a native value in exponent form", …], ["an unknown status", …],
    ["an unknown event", …], ["coverage without complete", …], ["an MPT whose currency differs from mpt_issuance_id", …]])("refuses %s with a server error", …);
  it("checks delegations' permission kinds and the lookup's object_type", …);
  // data-api.spec.ts (recordingCache and mockUpstream as the file does today)
  it("asks D5's eight paths with their queries and classes", …);
  //   GET …/v2/escrows/<ID> (live), …/v2/escrows/<ID>/history?descending=true&limit=50&marker=M (slow), the same for checks and payment_channels,
  //   …/v2/accounts/<A>/delegations?direction=given&limit=200 (live), …/v2/ledger_objects/<ID> (live)
  it("keeps escrow not found, check not found, payment channel not found and ledger object not found as not_found", …);
  it.each(EIGHT_METHODS)("%s: a malformed 200 is a server error and is not stored", …);
  // node-rpc.spec.ts
  it("ledgerEntry: a validated entry; entryNotFound is not_found; validated false and another index are server errors", …);
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/object-shape` and `pnpm test --project worker test/worker/data-api test/worker/node-rpc` → FAIL: missing module and methods.
- [ ] **Step 3: Implement** the types, the shape checks, the samples, the eight methods (in `PATHS`: the sync brought them into `openapi.d.ts`) and `ledgerEntry`.
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit.** `git add api/openapi.yaml app/server/openapi.d.ts app/server/api-types.ts app/server/data-api.ts app/server/node-rpc.ts app/server/object-shape.ts app/server/object-shape.test.ts test/support/object-samples.ts test/worker/data-api.spec.ts test/worker/node-rpc.spec.ts` — `feat(data-api): D5's escrow, check, channel, delegation and lookup calls, typed and checked` (body: "Types follow docs/api-reference.md of data-api feat/explorer-data-2 at <PIN>.").

---

### Task 2: Object fixtures

**Files:**
- Create: `test/fixtures/ledgers/xrpl-objects/`, `test/fixtures/ledgers/xahau-objects/` (byte copies of `$DAPI/packages/shared/test/fixtures/{xrpl,xahau}/objects/`'s ledgers and `manifest.json`), `scripts/object-derive.ts`, `scripts/object-fixtures.ts`, `test/support/object-cases.ts`, `test/unit/object-fixtures.test.ts`
- Modify: `scripts/http-fixtures.ts` (`generate()` calls `objectFixtures(net)`; `isObjectGenerated`; `isSynthetic` and the other predicates leave its files out), `test/support/upstream-core.ts` (`dataApiAbsent`: `/v2/escrows/{id}[/history]` → 404 `escrow not found`, checks → `check not found`, payment channels → `payment channel not found`, `/v2/ledger_objects/{id}` → `ledger object not found`; a missing `node/ledger_entry/<ID>.json` → `entryNotFound`), `test/unit/upstream-core.test.ts`, `test/fixtures/http/xrpl/node/account_objects/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh@limit=400.json` (by hand), `test/fixtures/PROVENANCE.md` (sections for the two copied sets and "Ledger object answers"), `README.md` ("Upstream fixtures": the new files)
- Create by hand: `test/fixtures/http/xrpl/data-api/accounts/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh/delegations@direction=given&limit=200.json`, `…@direction=held&limit=200.json`; the same two for `r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC` (both empty) and for `rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC` (`complete: false`)
- Generated by `pnpm fixtures:sync`: `test/fixtures/http/{xrpl,xahau}/data-api/{escrows,checks,payment_channels,ledger_objects}/…`, `…/data-api/transactions/<HASH>.json` of the object sets' transactions, `…/node/ledger_entry/<ID>.json`

**Interfaces:**
- Consumes: Task 1 types and shape checks, `PIN`; `readLedgers`-style reading and `dataApiTx` of `scripts/http-fixtures.ts`; `mulberry32`, `seedOf`; `test/e2e/fixtures.ts`'s `XRPL_ACCOUNT`.
- Produces:
  ```ts
  // scripts/object-derive.ts: D5 §2.2 and §5 ported (pinned to PIN in PROVENANCE.md)
  export interface DerivedObjectRow { object_type: "Escrow" | "Check" | "PayChannel" | "Delegate"; object_id: string; ledger_index: number; tx_index: number;
    tx_hash: string; close_time: number; tx_type: string; result: string; sender: string; delegate: string; action: "created" | "modified" | "deleted";
    event: string; owner: string; counterparty: string; fields: Record<string, unknown>; previous: Record<string, unknown>; event_fields: Record<string, unknown> }
  export function derivedObjectRows(ledgers: readonly RawLedger[]): DerivedObjectRow[];
  export function derivedAnswer(kind: ObjectApiKind, rows: readonly DerivedObjectRow[], id: string, asOf: { ledger_index: number; close_time: number },
                                native: "XRP" | "XAH", coverage: Coverage): ObjectAnswer;
  export function derivedHistory(kind: ObjectApiKind, rows: readonly DerivedObjectRow[], id: string, asOf, native, coverage,
                                 q: { limit: number; marker?: string }): ObjectHistoryPage;   // newest first; markers D5's base64url [ledger_index, tx_index]
  // scripts/object-fixtures.ts
  export function objectFixtures(net: NetworkName): Array<{ path: string; query: string; value: unknown }>;
  export const OBJECT_ROW_LISTS: readonly string[];                       // ["history", "delegations"]: one line per row
  // scripts/http-fixtures.ts
  export function isObjectGenerated(path: string): boolean;               // the paths objectFixtures writes; the other predicates leave them out
  // test/support/object-cases.ts (worker specs; Vite import.meta.glob over the generated files, as ledger-hashes.ts reads files)
  export type ObjectCase = "escrow-pending" | "escrow-finishable" | "escrow-cancellable" | "escrow-finished" | "escrow-cancelled" | "escrow-token" | "escrow-mpt"
    | "escrow-incomplete" | "escrow-node-only" | "check-open" | "check-expired" | "check-cashed" | "check-cancelled" | "channel-open" | "channel-closing"
    | "channel-closed" | "channel-long" | "check-node-only" | "xahau-escrow" | "xahau-token-channel";
  export async function objectCase(net: NetworkId, which: ObjectCase): Promise<{ id: string; owner: string; sequence?: number; markers?: string[] }>;
  ```
  Cases are found from the files' data (a predicate per case), never from a table of IDs.

What the generator writes (§13), status at the as-of ledger = the newest ledger of the network's objects set, `coverage` `{ from_ledger_index: <the set's oldest ledger>, complete: true }` unless the case says otherwise:
- **Derived**, for every object of the recordings: `data-api/{escrows|checks|payment_channels}/<ID>.json` (first page: newest 50 events), `data-api/ledger_objects/<ID>.json`, `data-api/transactions/<HASH>.json` for every transaction of the two sets (their `DelegateSet` and delegated ones included); `node/ledger_entry/<ID>.json` (`{ result: { index, ledger_index, node: { ...fields, LedgerEntryType, index }, validated: true } }`, the node's Ripple-epoch times) for each object still open at the as-of ledger. One open recorded escrow and one open check get a node file and **no** index file (`escrow-node-only`, `check-node-only`).
- **Synthetic** (seeded `seedOf(net, "objects", name)`, IDs of their own, `XRPL_ACCOUNT` as an owner or destination where the Objects tab needs it): an escrow `can_be_cancelled` (owner `XRPL_ACCOUNT`), one `cancelled`; a check `expired` (destination `XRPL_ACCOUNT`); a channel `closing` (owner `XRPL_ACCOUNT`); `channel-long` with 120 events: its answer embeds 50 and `history_marker` M1, `history@descending=true&limit=50&marker=M1.json` holds the next 50 and `marker` M2, `…&marker=M2.json` the last 20; `escrow-incomplete`, an answer with `complete: false` and no `created`; an MPT escrow when D5's recordings have none.
- **By hand**: `XRPL_ACCOUNT`'s `account_objects` gains the node entries of the four synthetic objects above and a `Delegate` (`Account` `XRPL_ACCOUNT`, three permissions); its delegations files hold three given and two held (the board's), the empty and incomplete accounts as listed.

- [ ] **Step 1: Copy the recordings, then write the failing tests.** Copy the two sets byte for byte and record in PROVENANCE.md the source paths, `PIN` and `git -C "$DAPI" log -1 --format=%H -- packages/shared/test/fixtures/xrpl/objects`. They are **not** added to `SETS`: their ledgers are newer than the fixtures' head, which would move every page built on it (Ruling 7).
  ```ts
  // object-fixtures.test.ts (Node; reads generate()'s map)
  it.each(["xrpl", "xahau"])("%s: every object answer, history page and lookup passes its shape check", …);
  it.each(["xrpl", "xahau"])("%s: every escrow's ID is the LedgerIndex of the node its EscrowCreate created", …);
  it("derives finished, cancelled, cashed, closed and open statuses where the recordings show them", …);
  it("chains channel-long's three pages to 120 events, newest first, by their markers", …);
  it("writes every object, event and body in the reference's key order", …);   // a table of key lines copied from $PIN:docs/api-reference.md
  it("gives every object of XRPL_ACCOUNT's account_objects an index or a node file", …);
  it("writes the same output for the same input", …);
  // upstream-core.test.ts
  it("answers an unknown object with D5's not-found messages and an unknown ledger entry with entryNotFound", …);
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test test/unit/object-fixtures test/unit/upstream-core` → FAIL.
- [ ] **Step 3: Implement** `object-derive.ts`, `object-fixtures.ts`, `object-cases.ts`, the `generate()` wiring and the absent answers; write the hand files; run `pnpm fixtures:sync`; write PROVENANCE.md and the README rows.
- [ ] **Step 4: Run them to verify they pass.** Step 2's command → PASS; `pnpm fixtures:check` → up to date; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit.** `git add test/fixtures/ledgers/xrpl-objects test/fixtures/ledgers/xahau-objects scripts/object-derive.ts scripts/object-fixtures.ts scripts/http-fixtures.ts test/support/object-cases.ts test/support/upstream-core.ts test/unit/object-fixtures.test.ts test/unit/upstream-core.test.ts test/fixtures/http test/fixtures/PROVENANCE.md README.md` — `test(fixtures): escrow, check, channel and delegation answers from D5's recordings` (body: "Derived by D5's rules at <PIN>.").

---

### Task 3: The two switches and `hasDelegation`

**Files:**
- Modify: `app/ui/features.ts`, `app/ui/features.test.ts`, `app/server/env.ts` (`Env`), `wrangler.jsonc` (every block), `vitest.config.ts` (`TOP_LEVEL_SWITCHES`), `app/server/networks.ts` (`Network.hasDelegation`, and `NetworkEntry`'s `Pick` gains it, in `NETWORKS[kind][id]`), `app/server/networks.test.ts`, `app/server/network-route.ts` (`PublicNetwork`), `test/support/under-network.tsx` and every other hand-built `Network` or `PublicNetwork` of the tests (the field, as E7 added its own), `app/server/env.test.ts`, `scripts/predeploy-check.test.ts`, `README.md` ("Switches": two rows, their conditions, the cache-generation examples)

**Interfaces:**
- Produces: `FEATURE_VARS` ends `…, "LEDGER_OBJECTS", "DELEGATION"`; `FEATURE_NAME.LEDGER_OBJECTS = "ledgerObjects"`, `FEATURE_NAME.DELEGATION = "delegation"`; `Env.LEDGER_OBJECTS`, `Env.DELEGATION: "on" | "off"`; `Network.hasDelegation: boolean` and on `PublicNetwork` (mainnet and testnet `xrpl` true, `xahau` false), beside `hasAmm`.

README conditions (§10): `LEDGER_OBJECTS` goes on in an environment when its data API serves D5 on both networks; `DELEGATION` also when D5's re-ingest from 107,524,865 is done there (the delegations answer `complete: true`), except the sandbox, where it goes on once the routes answer (its coverage is never complete); the two are independent; rolling back is `"off"` and a deploy.

- [ ] **Step 1: Write the failing tests.** `features.test.ts`: the two names last, `featuresOf` reads them. `networks.test.ts`: `hasDelegation` of the four (kind, network) cells. `env.test.ts`: `cacheGeneration` holds `DELEGATION=on` and `LEDGER_OBJECTS=on` in sorted place. `predeploy-check.test.ts`: a `sandbox` block without `LEDGER_OBJECTS` is refused, naming it.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/features app/server/networks app/server/env scripts/predeploy-check` → FAIL.
- [ ] **Step 3: Implement** the names, `Env`, every `wrangler.jsonc` block (top level `"on"`, `sandbox` and `production` `"off"`), `TOP_LEVEL_SWITCHES`, the fact and the README rows.
- [ ] **Step 4: Run them to verify they pass.** Step 2's command → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit.** `git add app/ui/features.ts app/ui/features.test.ts app/server/env.ts app/server/env.test.ts wrangler.jsonc vitest.config.ts app/server/networks.ts app/server/networks.test.ts app/server/network-route.ts scripts/predeploy-check.test.ts README.md` and each test file whose hand-built `Network` or `PublicNetwork` gained the field, by name, as `git status --short` lists them — `feat(ui): the LEDGER_OBJECTS and DELEGATION switches, and which networks delegate`.

---

### Task 4: Status rules, object links, permissions and the escrow keylet

**Files:**
- Create: `app/domain/object-status.ts`, `app/domain/object-link.ts`, `app/domain/permissions.ts`, `app/server/keylet.ts`, and a `*.test.ts` beside each

**Interfaces:**
- Consumes: Task 1 status types and `DelegationPermission`; Task 3 `Features`; Task 2's fixtures (agreement test); `decodeAccountID` (`ripple-address-codec`, Worker only).
- Produces:
  ```ts
  // object-status.ts (pure, browser-safe; D5 §5.2; times in unix seconds; removedBy is the deleting event)
  export function escrowStatus(o: { finishAfter?: number; cancelAfter?: number; removedBy?: string }, t: number): EscrowStatus;
  export function checkStatus(o: { expiration?: number; removedBy?: string }, t: number): CheckStatus;
  export function channelStatus(o: { expiration?: number; cancelAfter?: number; removedBy?: string }, t: number): ChannelStatus;
  // object-link.ts
  export type ObjectKind = "escrow" | "check" | "payment-channel";
  export const OBJECT_KINDS: ReadonlyArray<{ type: "Escrow" | "Check" | "PayChannel"; kind: ObjectKind; segment: "escrows" | "checks" | "payment-channels";
                                             api: ObjectApiKind; words: "escrow" | "check" | "payment channel" }>;
  export function kindOfType(type: string): ObjectKind | undefined;
  export type ObjectRefParts = { id: string } | { owner: string; sequence: number };
  /** /{net}/{segment}/{ID} or /{net}/escrows/{owner}/{sequence}; null while LEDGER_OBJECTS is off. */
  export function objectHref(net: NetworkId, kind: ObjectKind, ref: ObjectRefParts, features: Features): string | null;
  /** /{net}/account/{delegator}?tab=delegation; null while DELEGATION is off. */
  export function delegationHref(net: NetworkId, delegator: string, features: Features): string | null;
  // permissions.ts (names and words only)
  export interface GranularPermission { name: string; value: number; transactionType: string; words: string }
  export const GRANULAR_PERMISSIONS: readonly GranularPermission[];
  export interface PermissionChipView { name: string; kind: "transaction" | "granular" | "unknown"; words: string; title: string }
  export function permissionChip(value: string | number | DelegationPermission): PermissionChipView;
  // keylet.ts (Worker only)
  export async function escrowKeylet(owner: string, sequence: number): Promise<string>;  // SHA-512Half(0x0075 ‖ AccountID ‖ UInt32 BE), upper hex, Web Crypto
  ```

`GRANULAR_PERMISSIONS` (values as D5's table): the board's words for `TrustlineAuthorize` "Only authorizing trust lines, within TrustSet", `TrustlineFreeze` "Only freezing trust lines, within TrustSet", `TrustlineUnfreeze` "Only unfreezing trust lines, within TrustSet", `AccountDomainSet` "Only setting the domain, within AccountSet", `AccountTransferRateSet` "Only setting the transfer rate, within AccountSet", `PaymentMint` "Only payments that issue new tokens, within Payment", `PaymentBurn` "Only payments that return tokens to their issuer, within Payment", `MPTokenIssuanceLock` "Only locking MPT balances, within MPTokenIssuanceSet", `MPTokenIssuanceUnlock` "Only unlocking MPT balances, within MPTokenIssuanceSet", and in the same pattern `AccountEmailHashSet` "Only setting the email hash, within AccountSet", `AccountMessageKeySet` "Only setting the message key, within AccountSet", `AccountTickSizeSet` "Only setting the tick size, within AccountSet" (Ruling 8). `permissionChip`: a granular name or value → its words, title `Narrower right. {words}`; another name → words `Any {name} transaction`, title `Transaction type. {words}`; another number n → name `Permission {n}`, kind `unknown`, words and title `A permission this explorer does not know (value {n})`. An API `DelegationPermission` is read by its `permission` and `kind`.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // object-status.test.ts: the same boundary table as D5's object-status.spec.ts
  expect([999, 1000, 1001, 2000, 2001].map((t) => escrowStatus({ finishAfter: 1000, cancelAfter: 2000 }, t)))
    .toEqual(["pending", "pending", "can_be_finished", "can_be_finished", "can_be_cancelled"]);
  expect([2999, 3000].map((t) => checkStatus({ expiration: 3000 }, t))).toEqual(["open", "expired"]);
  expect([channelStatus({ expiration: 9_999_999 }, 1), channelStatus({ cancelAfter: 2000 }, 1999), channelStatus({ cancelAfter: 2000 }, 2000)]).toEqual(["closing", "open", "closing"]);
  it("agrees with every derived answer of the recordings", …);   // each node file's entry at the as-of close time vs the index answer's status
  // object-link.test.ts
  expect(objectHref("xrpl", "payment-channel", { id: ID }, ON)).toBe(`/xrpl/payment-channels/${ID}`);
  expect(objectHref("xrpl", "escrow", { owner: A, sequence: 57978925 }, ON)).toBe(`/xrpl/escrows/${A}/57978925`);
  expect([objectHref("xrpl", "check", { id: ID }, OFF), delegationHref("xrpl", A, OFF)]).toEqual([null, null]);
  // permissions.test.ts: twelve values 65537–65548; each word; "Any Payment transaction"; permissionChip(70001).name === "Permission 70001"
  // keylet.test.ts: escrowKeylet equals the created Escrow node of every EscrowCreate in test/fixtures/ledgers/*-objects
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/domain/object-status app/domain/object-link app/domain/permissions app/server/keylet` → FAIL.
- [ ] **Step 3: Implement the four modules.**
- [ ] **Step 4: Run them to verify they pass.** Step 2's command → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit.** `git add app/domain/object-status.ts app/domain/object-status.test.ts app/domain/object-link.ts app/domain/object-link.test.ts app/domain/permissions.ts app/domain/permissions.test.ts app/server/keylet.ts app/server/keylet.test.ts` — `feat(ui): object statuses, object links, permission words and the escrow keylet`.

---

### Task 5: Pill `warn`, states strip, timeline, check flow, permission chip, MPT amount

**Files:**
- Create: `app/ui/components/StatesStrip.tsx`, `Timeline.tsx`, `CheckFlow.tsx`, `PermissionChip.tsx`, `MptAmount.tsx`, and `StatesStrip.test.tsx`, `Timeline.test.tsx`, `CheckFlow.test.tsx`, `PermissionChip.test.tsx`, `MptAmount.test.tsx`
- Modify: `app/ui/components/Pill.tsx` (tone `warn`), `app/ui/components/components.test.tsx` (the `warn` pill), `app/ui/components.css` (`.pill--warn`, `.states`, `.timeline`, `.checkflow`, `.permchip`, `.mptamount`, the board's dot styles), `app/ui/tokens.css` (`--amb`, `--amb-bg`, light and both dark blocks, unless E9 added them), `test/unit/tokens.test.ts`

**Interfaces:**
- Consumes: Task 4 `PermissionChipView`; `Segment`, `Sentence`, `AccountLink`, `HashLink`, `LedgerLink`, `TypeTag`, `RelativeTime`, `Countdown`, `formatUtc`, `formatAmount`, `Flow`'s styles.
- Produces:
  ```ts
  export type PillTone = "ok" | "bad" | "neutral" | "info" | "off" | "warn";
  export interface StateItem { id: string; label: string; meaning: string; current: boolean }
  export function StatesStrip(p: { states: readonly StateItem[]; what: string }): JSX.Element;    // <ol>; current: aria-current="true" and "· this {what}"
  export interface TimelineItem { kind: "tx" | "mark" | "next"; type: string; title: string; at?: number; whenText?: string; what: Segment[];
                                  by?: string; delegate?: string; hash?: string; ledger?: number }
  export function Timeline(p: { net: NetworkId; items: readonly TimelineItem[]; footnote: string; newer?: string; older?: string }): JSX.Element;
  export interface CheckFlowData { source: { account: string; line: string }; check: { title: string; line: string; issuer?: string };
                                   destination: { account: string; tag?: number; line: string } }
  export function CheckFlow(p: { net: NetworkId; flow: CheckFlowData }): JSX.Element;            // three nodes, two arrows, .flow styles
  export function PermissionChip(p: { chip: PermissionChipView }): JSX.Element;                  // name; title; words in an sr-only span
  export function MptAmount(p: { id: string; units: string; href?: string }): JSX.Element;       // E14 extends it
  ```
  `Timeline` draws an `<ol>`: a `tx` item has a filled dot, its `TypeTag`, title, `<time>` with `formatUtc(at)` and `RelativeTime`, `what` through `Sentence`, "by {account}" and "sent by {delegate}" through `AccountLink`, `HashLink` and `LedgerLink`; a `mark` an outlined dot and `whenText`; a `next` a dashed dot, its `whenText` and, with a future `at`, `Countdown`. `MptAmount` draws `{formatAmount(units)} units of MPT {id.slice(0, 8)}…` in mono with the full ID in `title`, a `Link` when `href` is given.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // MptAmount.test.tsx (§14)
  it("draws raw grouped units and the first 8 hex digits, the full ID in title", …);   // "2,500,000 units of MPT 0000012A…"
  it("links the ID when href is given and not otherwise", …);
  // StatesStrip.test.tsx
  it("marks the current state with aria-current and · this escrow, and none for a removed object", …);
  // Timeline.test.tsx
  it("draws tx, mark and next items with their dot classes, by and sent by, and the footnote", …);
  it("renders no age on the server and hydrates without a mismatch", …);              // serverThenHydrated
  it("draws Newer and Older links when given", …);
  // CheckFlow.test.tsx, PermissionChip.test.tsx: the three nodes' lines; the chip's title and sr-only words
  // components.test.tsx: Pill tone warn has class pill--warn
  // tokens.test.ts: --amb on --amb-bg and on the page background ≥ 4.5:1 in light and both dark blocks
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test --project components app/ui/components` and `pnpm test test/unit/tokens` → FAIL.
- [ ] **Step 3: Implement** the components, the tone and the styles.
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit.** `git add app/ui/components app/ui/components.css app/ui/tokens.css test/unit/tokens.test.ts` — `feat(ui): states strip, timeline, check flow, permission chip, MPT amount and the warn pill`.

---

### Task 6: `WindowBar`

**Files:**
- Create: `app/ui/charts/WindowBar.tsx`, `app/ui/charts/WindowBar.test.tsx`
- Modify: `app/ui/charts/types.ts` (`WindowBarData`), `app/ui/charts.css`

**Interfaces:**
- Consumes: the kit's `geometry.ts`, its tooltip and its slot colours.
- Produces:
  ```ts
  export interface WindowBarSegment { id: "pending" | "finishable" | "cancellable"; label: string; slot: Slot;
                                      from: string | null; to: string | null;   // unix seconds as text; null: open
                                      range: string; length: string }            // the tooltip's words, written by the builder
  export interface WindowBarData { segments: WindowBarSegment[]; bounds: { id: "created" | "finish_after" | "cancel_after"; label: string; at: string }[];
                                   mark: { label: string; at: string }; token: string }
  export function WindowBar(p: { data: WindowBarData }): JSX.Element;
  ```
  The builder's numbers place everything: the bar spans the first bound (or the earliest `from`) to the latest of the bounds and the mark, an open end running to the bar's end. Each segment is a `<button>` with `aria-label` `{label}: {range}` and the kit's tooltip (`range`, `length`); bounds are ticks with their labels; the mark is a line with its label, repeated in an sr-only line. No table view (the Details list has the times).

- [ ] **Step 1: Write the failing tests.** `WindowBar.test.tsx`: three segments in order with widths proportional to their spans; an open-ended last segment reaches the end; a missing segment is not drawn; each segment is focusable with its label and shows its tooltip on focus; the sr-only line repeats the mark; the same data draws the same markup (token).
- [ ] **Step 2: Run them to verify they fail.** `pnpm test --project components app/ui/charts/WindowBar` → FAIL.
- [ ] **Step 3: Implement the component and its styles.**
- [ ] **Step 4: Run them to verify they pass.** Step 2's command → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit.** `git add app/ui/charts/WindowBar.tsx app/ui/charts/WindowBar.test.tsx app/ui/charts/types.ts app/ui/charts.css` — `feat(ui): the escrow window bar of the chart kit`.

---

### Task 7: The common view and the escrow view builder

**Files:**
- Create: `app/server/ledger-object-view.ts`, `app/server/ledger-object-view.test.ts`, `app/server/escrow-view.ts`, `app/server/escrow-view.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, 5, 6; E8 `coverageNote`; E9 `NamesPart`; `ServerState`; `trailPaging`, `Paging`; `RIPPLE_EPOCH_OFFSET`; `dropsToNative`; `shortHash`.
- Produces:
  ```ts
  // ledger-object-view.ts
  export type ObjectSource =
    | { origin: "index"; answer: ObjectAnswer; history?: ObjectHistoryPage }
    | { origin: "node"; entry: LedgerObject; ledgerIndex: number; now: number };
  /** The node's entry as D5's object (drops to whole units, Ripple-epoch to ISO), its status from object-status at `now`; no created, removed, opened_with, funds or claims. */
  export function fromNodeEntry(kind: ObjectKind, entry: LedgerObject, native: Native, now: number): EscrowObject | CheckObject | PaymentChannelObject;
  export type DisplayAmount = { value: string; currency: string; issuer?: string } | { mpt: { id: string; units: string } };
  export function displayAmount(a: ObjectAmount): DisplayAmount;
  export type TitleLine = { kind: "created"; at: number } | { kind: "before"; ledger: number } | { kind: "changed"; ledger: number; tx: string | null };
  export interface RemovedBanner { ledger: number; txType: string; hash: string; sentence: Segment[] }
  export interface ReserveView { amount: string; currency: string; hint: string }
  export interface ObjectPageCommon { net: NetworkId; kind: ObjectKind; id: string; origin: "index" | "node"; removed: boolean;
    pill: { tone: PillTone; text: string }; titleLine: TitleLine; banner: RemovedBanner | null; states: StateItem[]; timeline: TimelineItem[];
    paging: Paging | null; asOf: string; coverage: CoverageNoteText | null /* E8's, drawn by CoverageNote */; reserve: ReserveView | null; names: NamesPart }
  export function timelineOf(events: readonly ObjectEvent[], after: readonly TimelineItem[], net: NetworkId, native: Native): TimelineItem[]; // events oldest first, then `after`
  export function removedBannerOf(kind: ObjectKind, removed: ObjectRef, sentence: Segment[]): RemovedBanner;
  export function asOfNoteOf(source: ObjectSource, kind: ObjectKind): string;
  export function reserveOf(state: ServerState | null, native: Native, kind: ObjectKind, removed: boolean): ReserveView | null;
  export function commonOf(source: ObjectSource, o: { net: Network; kind: ObjectKind; serverState: ServerState | null; names: NamesPart; marker?: string;
    back: readonly string[] }, typeParts: { pill: { tone: PillTone; text: string }; states: StateItem[]; marks: TimelineItem[];
    bannerSentence: Segment[] | null }): ObjectPageCommon;
  // escrow-view.ts
  export interface EscrowMeta { id: string; amount: string; owner: string; destination: string; status: string; marker: boolean }
  export interface EscrowPageData extends ObjectPageCommon { kind: "escrow"; summary: Segment[]; statusLines: Segment[][]; windowBar: WindowBarData;
    amount: DisplayAmount; details: DetailRow[]; meta: EscrowMeta }   // the Amount row draws `amount` (MptAmount for the mpt form); E14 widens the mpt form
  export function escrowPage(source: ObjectSource, o: { net: Network; serverState: ServerState | null; names: NamesPart; marker?: string; back: readonly string[] }): EscrowPageData;
  ```

Rules (§4.1, §4.2; words exactly as the spec and the Escrow board):
- Title line: index with `created` → `created` at its time; index without → `before` `coverage.from_ledger_index`; node → `changed` at `PreviousTxnLgrSeq` with `PreviousTxnID`. Removed banner: "Removed from the ledger in ledger #N by {tx_type} {hash}", the type's sentence, then "This page shows it from history: its last state before it was removed." As-of: index "As of ledger #N, {time}."; node "Read live from the network at ledger #N."; removed "From history: the escrow's last state, before ledger #N removed it." Coverage: `coverageNote(coverage, "events of this escrow")` (index), and for a node object E8's text for none. Owner reserve: `server_state`'s `reserve_inc` with the in-ledger hint or the removed one; `null` when `server_state` failed.
- Pill per status (§4.2 table), states strip in the board's order with its meanings, the current one marked (`removed` marks none). Summary "{owner} locked {amount} for {destination} on {day}." ("on {day}" left out without `created`). Status lines and marks per §4.2.
- `windowBarOf`: Pending (creation → FinishAfter), Can be finished (FinishAfter → CancelAfter or open), Can be cancelled (CancelAfter → open); bounds Created, FinishAfter, CancelAfter; mark "Now · {as-of time}" or "Finished · …" / "Cancelled · …" at the removal; a segment the escrow lacks is left out; without a known creation the bar starts at the earlier of FinishAfter and the as-of time, with no Created bound.
- Details: Escrow ID, Owner, Destination, Amount (`amount`: an MPT through `MptAmount`), Can be finished after, Can be cancelled after, Condition ("None: time-based only" without), Fulfillment, Destination tag, Source tag, Transfer rate (percent), Owner reserve; hints the board's. Paging: the history page's `marker` towards older events, `trailPaging` for Newer.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // escrow-view.test.ts (fixtures through object-cases' answers, and node entries)
  it.each(["pending", "can_be_finished", "can_be_cancelled", "finished", "cancelled", "removed"])("%s from the index: pill, states, status lines, marks", …);
  it.each(["pending", "can_be_finished", "can_be_cancelled"])("%s from the node: status at the request time, no history, Last changed in ledger #N", …);
  it("leaves out Pending without FinishAfter and Can be cancelled without CancelAfter, and starts at the earlier of FinishAfter and now without a creation", …);
  it("says Created before ledger #N and shows the coverage note when created is absent", …);
  it("shows an MPT escrow raw and a token escrow with its issuer", …);
  it("drops Owner reserve when server_state failed and says Released for a removed escrow", …);
  it("holds unix seconds and strings only: no ages", …);
  // ledger-object-view.test.ts: fromNodeEntry of each kind (drops, epoch, status at now); asOfNoteOf's three texts; reserveOf
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/ledger-object-view app/server/escrow-view` → FAIL.
- [ ] **Step 3: Implement both modules.**
- [ ] **Step 4: Run them to verify they pass.** Step 2's command → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit.** `git add app/server/ledger-object-view.ts app/server/ledger-object-view.test.ts app/server/escrow-view.ts app/server/escrow-view.test.ts` — `feat(ui): the escrow page's view, from the index or the node`.

---

### Task 8: The check and payment channel view builders

**Files:**
- Create: `app/server/check-view.ts`, `app/server/check-view.test.ts`, `app/server/payment-channel-view.ts`, `app/server/payment-channel-view.test.ts`

**Interfaces:**
- Consumes: Task 7's common part; Task 5 `CheckFlowData`; the kit's `ShareData`.
- Produces:
  ```ts
  export interface CheckPageData extends ObjectPageCommon { kind: "check"; summary: Segment[]; statusLines: Segment[][]; expiredBanner: Segment[] | null;
    flow: CheckFlowData; details: DetailRow[]; meta: CheckMeta }
  export function checkPage(source: ObjectSource, o: /* as escrowPage */): CheckPageData;
  export interface PaymentChannelPageData extends ObjectPageCommon { kind: "payment-channel"; summary: Segment[]; statusLines: Segment[][];
    deposit: ShareData; claimsNote: Segment[]; details: DetailRow[]; meta: PaymentChannelMeta }
  export function paymentChannelPage(source: ObjectSource, o): PaymentChannelPageData;
  // CheckMeta and PaymentChannelMeta have EscrowMeta's fields
  ```
  Rules: §4.3 (pills, the "Expired, but still in the ledger" banner, summary, the three-node flow's lines, details, marks) and §4.4 (pills, summary, status lines including "any transaction on the channel now closes it" past the earlier of Expiration and CancelAfter, the deposit bar: one row, Paid out and Left (or Returned to the source once closed) with "{n}% of the deposit" under each, the claims paragraph, details with the hints from `opened_with`, `funds` and `claims`, the event titles Opened, Funded, Claim redeemed, Close requested, Renewed, Closed, Removed with their sentences). A node-read channel has no `opened_with`, `funds` or `claims`: those hints are left out.

- [ ] **Step 1: Write the failing tests.** `check-view.test.ts`: open, expired (banner, warn pill), cashed (delivered, "−{delivered}" / "+{delivered}"), cancelled, removed, from the index and from the node; a token `SendMax` with its issuer. `payment-channel-view.test.ts`: open, closing (expiration set; CancelAfter passed: "any transaction…"), closed (Returned to the source), removed; the deposit shares; "1,000 XRP when it was opened, 2 fundings added later"; "in {claims} claims redeemed on the ledger"; each event title and sentence; Xahau's token channel (`xahau-token-channel`) with its issuer; the node form without the history hints.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/check-view app/server/payment-channel-view` → FAIL.
- [ ] **Step 3: Implement both builders.**
- [ ] **Step 4: Run them to verify they pass.** Step 2's command → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit.** `git add app/server/check-view.ts app/server/check-view.test.ts app/server/payment-channel-view.ts app/server/payment-channel-view.test.ts` — `feat(ui): the check and payment channel pages' views`.

---

### Task 9: The escrow routes, the shared loader, the frame and the page

**Files:**
- Create: `app/server/object-load.ts`, `app/routes/net.escrows.$id.tsx`, `app/routes/net.escrows.$owner.$sequence.tsx`, `app/server/meta-escrow.ts`, `app/ui/pages/LedgerObjectFrame.tsx`, `app/ui/pages/EscrowPage.tsx`, `app/ui/pages/EscrowPage.test.tsx`, `test/worker/ledger-objects.spec.ts`, `test/worker/ledger-objects-off.spec.ts`
- Modify: `app/routes.ts` (`escrows/:id`, `escrows/:owner/:sequence` under `:net`), `test/worker/meta.spec.ts`, `app/ui/routes-wiring.test.tsx`, `scripts/bundle-budget.ts` and `scripts/check-bundle.test.ts` (`{ name: "escrow", route: "routes/net.escrows.$id", budget: "lookup" }`)

**Interfaces:**
- Consumes: Tasks 1–7; E9 `collectAddresses`, `loadNames`, `NamesProvider`; E8 `CoverageNote`; `requireNetwork`, `clientsFor`, `notFound`, `upstreamOutage`, `cached`, `cacheClassHeaders`, `isMarker`, `parseTrail`, `markDegraded`, `logProblem`, `sharing`, `suffixOf`.
- Produces (Task 10 uses it for checks and channels):
  ```ts
  export const OBJECT_HISTORY_PAGE = 50;
  export async function loadObjectPage(kind: ObjectKind, a: { request: Request; params: { net?: string; id?: string }; context: unknown }):
    Promise<Response | ReturnType<typeof cached>>;
  export function escrowMeta(facts: EscrowMeta, ctx: MetaContext): MetaDescriptor[];
  export function LedgerObjectFrame(p: { data: ObjectPageCommon; title: string; breadcrumb: Crumb[]; children: ReactNode /* Details */; extra?: ReactNode }): JSX.Element;
  ```

`loadObjectPage` (§1.2, §3): `requireNetwork`; `LEDGER_OBJECTS` off → `notFound({ notFound: "the {words} pages" })`; an ID that is not 64 hex digits → `notFound({ notFound: "{words} {echoOf(id)}" })`; lower case → 302 `immutable` to the upper-case URL (query kept); `marker` that `isMarker` refuses → 404 ("that page of the {words}"). Then side by side: the object call, the history call when there is a marker (`{ descending: true, limit: OBJECT_HISTORY_PAGE, marker }`), and `serverState()`. The object call's `not_found` → `ledgerEntry(id)`: the same type → the node page; `Escrow`, `Check` or `PayChannel` of another kind → 302 `short` to its page; anything else or `not_found` → `notFound({ notFound: "{words} {shortHash(id)}", suggestion: { href: "/{other}/search?q={ID}", label: "Search on {other name}" } })` with `noindex`. Any other failure of the object call → `upstreamOutage` (the node not asked); the node failing → `upstreamOutage`. With a marker: the history call's `bad_request` → 404, a page with no events → 404. Then `collectAddresses` (the object's account and destination, an amount's issuer, every event's account and delegate) and `loadNames`. `server_state` failing → the page without Owner reserve, `markDegraded`. Class: `MARKER_PAGE_CLASS` with a marker; else `slow` when `removed`; else `live`. The route modules: `headers = forwardCacheClass`, `meta` from `escrowMeta`, the component `<NamesProvider names={data.names.map}><EscrowPage …/></NamesProvider>`.

`/{net}/escrows/{owner}/{sequence}`: the switch on, `isValidClassicAddress(owner)` and `sequence` matching `/^(0|[1-9]\d{0,9})$/` and ≤ 4294967295 → 302 `immutable` to `/{net}/escrows/{await escrowKeylet(owner, sequence)}`, no upstream call; anything else 404 `short`.

`escrowMeta` (§11): title `Escrow {shortHash(id)} · {suffixOf(network)}` (Ruling 5), description `Escrow of {amount} from {owner} to {destination} · {status words} · {network name}` (display names from E9's map where `plainNameOf` gives one, else short addresses, written by the builder into `EscrowMeta`), canonical `/{net}/escrows/{ID}`, `og:*` and `twitter:card=summary` through `sharing` without an image; a marker page `noindex, follow` with no canonical and no `og:*`.

`EscrowPage` (the board): breadcrumb "{Net} / Accounts / {owner} / Escrow", the title row (type, pill, title line with `RelativeTime`), the removed banner, the states strip, two columns: Details (summary sentence, status lines with `Countdown` for future times, `WindowBar`, `DetailList`, the as-of note) and History (`Timeline`, its footnote "Oldest first. Filled dots are transactions; dashed ones are what can still happen.", Newer/Older, `CoverageNote`).

- [ ] **Step 1: Write the failing tests.**
  - `ledger-objects.spec.ts`, **in this order** (one Cache API per file):
    ```ts
    it("answers 503 without asking the node when the index fails", …);            // index 503; node ledger_entry never requested; not stored
    it("answers 503 when the node fails after the index's not found", …);
    it("serves the page without Owner reserve when server_state fails, not stored", …);
    it("serves addresses when the names call fails, not stored", …);
    it("serves a pending escrow from the index as live, with every part of the board", …);
    it("serves a finished escrow as slow with the removed banner", …);
    it("serves a page of older events behind a marker as MARKER_PAGE_CLASS, noindex, with Newer and Older", …);  // channel-long is Task 10's
    it("404s a marker the API refuses and one past the last event", …);
    it("falls back to the node for an escrow the index lacks: no history, Read live from the network", …);  // escrow-node-only
    it("redirects to the check page when the node holds a Check at that ID", …);
    it("offers the other network when neither has it", …);                        // 404 short, noindex, "Search on Xahau" → /xahau/search?q=<ID>
    it.each([["0x" + ID], [ID.slice(1)], ["zz…"]])("404s %s without a call", …);
    it("redirects a lower-case ID to the upper-case URL as immutable, with no call", …);
    it("redirects /escrows/{owner}/{sequence} to the escrow's ID as immutable, with no call", …);
    it.each([["an X-address"], ["sequence 01"], ["sequence 4294967296"]])("404s the owner/sequence form with %s", …);
    it("holds no age or countdown in the stored HTML", …);
    it("serves a Xahau XAH escrow", …);
    ```
  - `ledger-objects-off.spec.ts` (`worker-off`): `/xrpl/escrows/<ID>` and `/xrpl/escrows/<owner>/<seq>` are 404 `short` with no request.
  - `meta.spec.ts`: an escrow's title, description, canonical, `og:*`, `twitter:card=summary`, no `og:image`; a marker page `noindex, follow`.
  - `EscrowPage.test.tsx`: drawn as the Worker prints it and hydrated: the pill's icon and word, `aria-current` in the strip, the window bar's buttons, the timeline, the reserve row absent when `null`.
  - `routes-wiring.test.tsx`: the two routes exist under `:net`.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test --project worker test/worker/ledger-objects test/worker/meta`, `pnpm test --project worker-off test/worker/ledger-objects-off`, `pnpm test --project components app/ui/pages/EscrowPage app/ui/routes-wiring` → FAIL.
- [ ] **Step 3: Implement** the loader, the two routes, the meta builder, the frame, the page and the `PAGES` entry.
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` → exit 0 (`escrow` under 150,000 B); `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit.** `git add app/server/object-load.ts app/routes.ts app/routes/net.escrows.\$id.tsx app/routes/net.escrows.\$owner.\$sequence.tsx app/server/meta-escrow.ts app/ui/pages/LedgerObjectFrame.tsx app/ui/pages/EscrowPage.tsx app/ui/pages/EscrowPage.test.tsx test/worker/ledger-objects.spec.ts test/worker/ledger-objects-off.spec.ts test/worker/meta.spec.ts app/ui/routes-wiring.test.tsx scripts/bundle-budget.ts scripts/check-bundle.test.ts` — `feat(ui): the escrow page, from the index or the node, and the owner/sequence redirect`.

---

### Task 10: The check and payment channel routes and pages

**Files:**
- Create: `app/routes/net.checks.$id.tsx`, `app/routes/net.payment-channels.$id.tsx`, `app/server/meta-check.ts`, `app/server/meta-payment-channel.ts`, `app/ui/pages/CheckPage.tsx`, `app/ui/pages/PaymentChannelPage.tsx`, `CheckPage.test.tsx`, `PaymentChannelPage.test.tsx`
- Modify: `app/routes.ts`, `test/worker/ledger-objects.spec.ts`, `test/worker/ledger-objects-off.spec.ts`, `test/worker/meta.spec.ts`, `scripts/bundle-budget.ts`, `scripts/check-bundle.test.ts` (`check`: `routes/net.checks.$id`; `payment-channel`: `routes/net.payment-channels.$id`)

**Interfaces:**
- Consumes: Task 9's `loadObjectPage`, `LedgerObjectFrame`; Task 8's builders; Task 5 `CheckFlow`; the kit's `ShareBar`.
- Produces: `checkMeta(facts, ctx)`, `paymentChannelMeta(facts, ctx)` (titles "Check {short} · …", "Payment channel {short} · …"; descriptions "Check for up to {SendMax} from {source} to {destination} · {status} · {net}", "Payment channel of {amount} from {source} to {destination} · {status} · {net}"; canonical `/{net}/checks/{ID}`, `/{net}/payment-channels/{ID}`).

- [ ] **Step 1: Write the failing tests.** `ledger-objects.spec.ts` (appended after Task 9's, distinct IDs, failure cases first): a check's 503 without the node; an open, an expired (banner) and a cashed check and their classes; `check-node-only` from the node; `/xrpl/checks/<escrow ID>` → 302 to the escrow page; an open and a closing channel; `channel-long`: the first page (50 events, Older), `?marker=M1&back=` (Newer and Older), `?marker=M2&back=M1` (the last 20, Newer only); Xahau's token channel. `ledger-objects-off.spec.ts`: both routes 404 without a call. `meta.spec.ts`: both builders. `CheckPage.test.tsx`, `PaymentChannelPage.test.tsx`: the flow's three nodes, the deposit bar's rows, the claims paragraph, hydration without mismatch.
- [ ] **Step 2: Run them to verify they fail.** As Task 9's Step 2 with the new files → FAIL.
- [ ] **Step 3: Implement** the routes, the meta builders, the pages and the `PAGES` entries.
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` → exit 0 (both pages under 150,000 B); `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit.** `git add app/routes.ts app/routes/net.checks.\$id.tsx app/routes/net.payment-channels.\$id.tsx app/server/meta-check.ts app/server/meta-payment-channel.ts app/ui/pages/CheckPage.tsx app/ui/pages/CheckPage.test.tsx app/ui/pages/PaymentChannelPage.tsx app/ui/pages/PaymentChannelPage.test.tsx test/worker/ledger-objects.spec.ts test/worker/ledger-objects-off.spec.ts test/worker/meta.spec.ts scripts/bundle-budget.ts scripts/check-bundle.test.ts` — `feat(ui): the check and payment channel pages`.

---

### Task 11: The account page's Delegation tab

**Files:**
- Create: `app/server/delegation-view.ts`, `app/server/delegation-view.test.ts`, `test/worker/delegation.spec.ts`, `test/worker/delegation-off.spec.ts`
- Modify: `app/domain/account-tabs.ts` (`ACCOUNT_TABS` gains `"delegation"` before `"analytics"`), `app/server/account-view.ts` (`TabList` gains the delegation variant; `TAB_WHAT.delegation = "delegations"`), `app/routes/net.account.$address.tsx` (`readList`'s case, the tab rules), `app/ui/pages/AccountPage.tsx`, `app/ui/pages/AccountPage.test.tsx` (`meta-account.ts` already names a tab in the canonical URL through `accountHref`)

**Interfaces:**
- Consumes: Task 1 `accountDelegations`; Task 4 `permissionChip`; Task 5 `PermissionChip`; E8 `coverageNote`, `CoverageNote`; E9 `collectAddresses`, `loadNames`; the account route's `LIST_DEADLINE_MS` and `within`.
- Produces:
  ```ts
  export interface DelegationRow { key: string; account: string;   // given: the delegate (authorize); held: on behalf of (account)
    permissions: PermissionChipView[]; count: string /* "3 of 10" */; tx: string; ledger: number; time: number }
  export interface DelegationList { rows: DelegationRow[]; more: boolean; coverage: CoverageNoteText | null }   // E8's coverageNote(coverage, "delegations")
  export function delegationLists(given: DelegationsPage, held: DelegationsPage): { given: DelegationList; held: DelegationList };
  // TabList gains | { state: "ok"; tab: "delegation"; given: DelegationList; held: DelegationList; names: NamesPart }
  // E9's listAddresses(list) gives this variant's rows' accounts
  ```
  Tab rules (§6.1): `hasDelegation` false → no tab, `?tab=delegation` a 302 (`short`) to the account URL with no call; `DELEGATION` off → the disabled "soon" tab, the query a 302 with no call; a `marker` on the tab → a 302 to the URL without it. The list: `accountDelegations(a, { direction: "given", limit: 200 })` and `"held"` side by side inside the list's promise and its `LIST_DEADLINE_MS`; a failure of either → "Couldn't load delegations" with Retry, served, not stored; then the names call for their accounts within what is left of the deadline. Class `live`.
  Content (the board's): the intro "A delegation lets another account, the delegate, send some kinds of transaction on this account's behalf. Each permission is a transaction type or one narrower right, and a delegation grants up to 10." with the chip legend; "Permissions given" (Delegate, Permissions, Granted in: `updated.tx_hash` linked, Date (UTC)) and its note "Each delegation given is a Delegate object {name} owns, so these {n} count toward its reserve. A new DelegateSet for the same delegate replaces its whole list."; "Permissions held" (On behalf of, Permissions, Granted in, Date); empty: "No account may send transactions on {name}'s behalf." / "{name} may not send transactions on any other account's behalf."; `more` → "Showing the first 200"; a `coverage` not complete → `CoverageNote` with `coverageNote(coverage, "delegations")` under each list. `{name}` is the account's display name (E9) or its short address.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // delegation-view.test.ts
  it("rows: chips, 3 of 10, the granting transaction and its time", …);
  it("shows an unknown permission as Permission 70001", …);
  it("says more when the API gave a marker, and carries the coverage note when not complete", …);
  // delegation.spec.ts (failure first)
  it("says Couldn't load delegations when the held call fails, not stored", …);
  it("xrpl: asks both directions with limit 200 and stores the page as live, its canonical URL naming ?tab=delegation", …);
  it("draws three given and two held as the board does", …);
  it("draws both empty sentences for an account with none", …);
  it("draws the coverage note for an account whose answer is not complete", …);
  it("redirects a marker on the tab to the URL without it", …);
  it("Xahau: no tab, and ?tab=delegation is a 302 without a call", …);
  // delegation-off.spec.ts (worker-off): the soon tab; ?tab=delegation is a 302 without a call
  // AccountPage.test.tsx: the tab between NFTs and Analytics; the intro and legend; the empty sentences with the display name
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/delegation-view`, `pnpm test --project worker test/worker/delegation`, `pnpm test --project worker-off test/worker/delegation-off`, `pnpm test --project components app/ui/pages/AccountPage` → FAIL.
- [ ] **Step 3: Implement** the builder, the tab, its rules and its content.
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` → exit 0; `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit.** `git add app/domain/account-tabs.ts app/server/delegation-view.ts app/server/delegation-view.test.ts app/server/account-view.ts app/routes/net.account.\$address.tsx app/ui/pages/AccountPage.tsx app/ui/pages/AccountPage.test.tsx test/worker/delegation.spec.ts test/worker/delegation-off.spec.ts` — `feat(ui): the account page's Delegation tab`.

---

### Task 12: Transaction descriptions: the delegate, `DelegateSet`, and the fee payer

**Files:**
- Create: `app/domain/describe/delegation.ts`
- Modify: `app/domain/describe/types.ts` (`Segment` gains `permission`; `Summary.note?`; `Description.delegate?`, `sentBy?`, `note?`), `describe/index.ts` (merge `delegationHandlers`; `delegate`, `sentBy`, `note`), `describe/helpers.ts` (`COMMON_FIELDS` gains `"Delegate"`), `describe/row.ts` (`rowSentence(description, viewer?)`), `describe/describe.test.ts`, `describe/row.test.ts`, `app/server/transaction-view.ts` (+ test: `TransactionPageData.delegate`, `sentBy`, `note`; `plainText` handles `permission`), `app/server/account-view.ts` (+ test: `changeOf` tests the fee against `tx.Delegate ?? tx.Account`; `sentenceFor` passes the viewer), `app/ui/components/Sentence.tsx` (`permission` → `PermissionChip`), `app/ui/pages/TransactionPage.tsx`, `app/ui/pages/TransactionPage.test.tsx`, `test/worker/transaction.spec.ts`

**Interfaces:**
- Consumes: Task 4 `permissionChip`, `delegationHref`; Task 5 `PermissionChip`; `listOf`, `closingDetails`, `account`, `seq`.
- Produces:
  ```ts
  // Segment gains
  | { t: "permission"; name: string; kind: "transaction" | "granular" | "unknown"; words: string }
  // Description gains: delegate?: string; sentBy?: Segment[]; note?: Segment[]      Summary gains: note?: Segment[]
  export function rowSentence(description: Pick<Description, "ok" | "sentence" | "delegate">, viewer?: string): Segment[];
  // TransactionPageData gains: delegate: string | null; sentBy: Segment[] | null; note: Segment[] | null
  ```
  Rules (§6.2): a transaction with `Delegate`: `delegate` = it, `sentBy` = `{delegate} sent it on behalf of {account}.` (two account segments), shown after the sentence in the same paragraph; no type lists `Delegate` as a generic detail. The page adds after "Account" a **"Sent by"** row: the delegate in full, "The delegate signed this transaction and paid its fee, using a permission {account} gave it.", and "View the delegation" (`delegationHref(net, account, features)`; left out while `null`). The Fee row reads "· paid by the delegate, burned". `DelegateSet` (title "Delegation"; its permissions are `tx.Permissions[].Permission.PermissionValue` through `permissionChip`, each a `permission` segment): with permissions "{account} let {authorize} send {chips, joined by listOf} on its behalf", note "This replaces any permissions {account} had given {authorize} before; it does not add to them."; with an empty list "{account} removed every permission it had given {authorize}"; failed "tried to let …" / "tried to remove …" and the result's text; details Delegate, Permissions (chips and "n of 10"), then `closingDetails`. A list row of a delegated transaction ends " · sent by {delegate}", or " · sent by this account as its delegate" when `viewer` is the delegate. None of this is gated (decision 5).

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // describe.test.ts (recorded delegated_payment, delegated_tec and the DelegateSet cases of the objects sets)
  it("adds sentBy and delegate to a delegated Payment and keeps Delegate out of its details", …);
  it("describes a delegated tec with sentBy and the result's text", …);
  it("DelegateSet with permissions: let … send {chips} on its behalf, and the replace note", …);
  it("DelegateSet with an empty list: removed every permission it had given", …);
  it("a failed DelegateSet: tried to let …", …);
  // row.test.ts
  it("ends a delegated row with · sent by {delegate}, and on the delegate's page with · sent by this account as its delegate", …);
  // account-view.test.ts
  it("does not take a delegated transaction's fee for the sender's change", …);
  // TransactionPage.test.tsx
  it("draws the Sent by row with View the delegation, and the Fee words", …);
  it("shows Sent by without the link while DELEGATION is off", …);
  // transaction.spec.ts: /xrpl/tx/<delegated payment> holds "sent it on behalf of" and "Sent by"; a Xahau transaction has no Sent by row
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/domain/describe app/server/transaction-view app/server/account-view`, `pnpm test --project components app/ui/pages/TransactionPage`, `pnpm test --project worker test/worker/transaction` → FAIL.
- [ ] **Step 3: Implement**; every `switch` over `Segment.t` handles `permission` (the compiler's exhaustiveness check finds them).
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` → exit 0 (`transaction-bundle.test.ts` unchanged: describe stays in the Worker); `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit.** `git add app/domain/describe app/server/transaction-view.ts app/server/transaction-view.test.ts app/server/account-view.ts app/server/account-view.test.ts app/ui/components/Sentence.tsx app/ui/pages/TransactionPage.tsx app/ui/pages/TransactionPage.test.tsx test/worker/transaction.spec.ts` — `feat(ui): delegated transactions say who sent them, and DelegateSet is described`.

---

### Task 13: Links into the object pages

**Files:**
- Modify: `app/domain/describe/types.ts` (`Segment` gains `object`), `describe/escrow.ts`, `describe/checks.ts`, `describe/paychan.ts`, `describe/describe.test.ts`, `app/ui/components/Sentence.tsx` (+ test in `components.test.tsx`), `app/server/transaction-view.ts` (`plainText`; objects touched with links), `app/ui/pages/TransactionPage.tsx`, `app/server/account-view.ts` (`objectRows`, `objectsList`), `app/server/account-view.test.ts`, `app/routes/net.account.$address.tsx` (the `objectsList` call), `app/ui/pages/AccountPage.tsx` (the Objects tab's buttons and fields), `test/worker/account.spec.ts`, `test/worker/transaction.spec.ts`, `test/worker/ledger-objects-off.spec.ts`

**Interfaces:**
- Consumes: Task 4 `objectHref`, `delegationHref`, `kindOfType`, `OBJECT_KINDS`; Task 12's segment handling.
- Produces:
  ```ts
  // Segment gains
  | { t: "object"; kind: ObjectKind; ref: ObjectRefParts; v: string }
  export interface ObjectRowsContext { net: NetworkId; native: Native; address: string; features: Features }
  export function objectRows(objects: readonly LedgerObject[], ctx: ObjectRowsContext): { rows: ObjectRow[]; trustLines: number; offers: number };
  export function objectsList(objects: AccountObjects | null, ctx: ObjectRowsContext): TabList;
  // ObjectRow gains: open: { href: string; label: string } | null    (and E8's fields stay)
  // TransactionPageData.objects[] gains: href: string | null
  ```
  `objectRows` takes a context in place of its positional parameters (E8's included: fold them into `ObjectRowsContext`; Ruling 6). Rules (§7): an `Escrow`, `Check` or `PayChannel` row → `open` "Open escrow →", "Open check →", "Open payment channel →" (`objectHref` by `index`; `null` while off); an incoming object (`Destination` is the account) gains the field "From" (its `Account`), always; a `Delegate` row has the fields Delegate (`Authorize`), On behalf of (`Account`), Permissions ("n of 10") and `open` "View delegation →" (`delegationHref` of its `Account`). On the transaction page an objects-touched entry links its page; a `Delegate` its delegator's Delegation tab. The describe handlers: `EscrowCreate`, `CheckCreate`, `PaymentChannelCreate` gain the detail "Escrow" / "Check" / "Channel" holding an object segment of the created node's ID (`v` = `shortHash(id)`); `EscrowFinish` and `EscrowCancel` keep "escrow {OfferSequence} of {Owner}" with "escrow {OfferSequence}" as an object segment by the deleted node's `LedgerIndex`, else Xahau's `EscrowID`, else `{ owner: Owner, sequence: OfferSequence }` (a failed one); `CheckCash` and `CheckCancel` write "a check" and the "Check ID" detail by `CheckID`; `PaymentChannelFund` and `PaymentChannelClaim` write "channel {shortHash(Channel)}" and the "Channel" detail by `Channel`. `Sentence` draws an object segment as a `Link` to `objectHref(…, useFeatures())`, and its `v` as plain text while that is `null`.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // describe.test.ts
  it.each(NINE_TYPES)("%s: the object segment and detail, by the id form of its metadata", …);   // created node, deleted node, EscrowID, owner/sequence
  // components.test.tsx
  it("draws an object as a link, and as text while LEDGER_OBJECTS is off", …);
  // account-view.test.ts
  it("adds Open escrow, Open check and Open payment channel by index, From for an incoming object, and the Delegate row's fields and link", …);
  it("leaves the open links out while their switches are off", …);
  // account.spec.ts: XRPL_ACCOUNT's Objects tab holds the four links; transaction.spec.ts: an EscrowFinish's sentence links its escrow
  // ledger-objects-off.spec.ts: the Objects tab and the transaction page hold no object link
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/domain/describe app/server/account-view`, `pnpm test --project components app/ui/components/components`, `pnpm test --project worker test/worker/account test/worker/transaction`, `pnpm test --project worker-off test/worker/ledger-objects-off` → FAIL.
- [ ] **Step 3: Implement**; every `switch` over `Segment.t` handles `object`.
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` → exit 0; `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit.** `git add app/domain/describe app/ui/components/Sentence.tsx app/ui/components/components.test.tsx app/server/transaction-view.ts app/ui/pages/TransactionPage.tsx app/server/account-view.ts app/server/account-view.test.ts app/routes/net.account.\$address.tsx app/ui/pages/AccountPage.tsx test/worker/account.spec.ts test/worker/transaction.spec.ts test/worker/ledger-objects-off.spec.ts` — `feat(ui): transactions and the Objects tab link escrows, checks, channels and delegations`.

---

### Task 14: Search finds ledger objects

**Files:**
- Modify: `app/server/resolve.ts` (+ `test/worker/resolve.spec.ts`), `app/routes/net.search.tsx`, `app/ui/pages/SearchChoicePage.tsx`, `app/ui/search-hints.ts`, `app/ui/search-hints.test.ts`, `app/ui/pages/SearchPage.tsx` (help text), `test/worker/search.spec.ts`

**Interfaces:**
- Consumes: Task 1 `ledgerObject`, `ledgerEntry`; Task 4 `objectHref`, `delegationHref`, `kindOfType`; E8's sequence.
- Produces:
  ```ts
  // HashMatches gains
  object?: { type: "Escrow" | "Check" | "PayChannel" | "Delegate"; account: string; deleted: boolean };
  // E8's HashQuestions gains ledgerObjects; the signature stays E8's
  export interface HashQuestions { net: NetworkId; nfts: boolean; ledgerObjects: boolean }
  export function findHash(api: DataApi, node: NodeRpc, hash: string, opts: HashQuestions): Promise<HashMatches>;
  ```
  The search route passes `{ net: net.id, nfts: net.features.nfts, ledgerObjects: net.features.ledgerObjects }`.
  E8's sequence extended at its two points (§8), nothing else changed: while `ledgerObjects`, the index asks `ledgerObject(id)` beside the transaction, the ledger and the NFT; only when the index has none of them, the node asks `ledgerEntry(id)` beside its others (an entry of an untracked type counts as nothing; a node object is `deleted: false`). One found: an object → 302 to its page (`objectHref`); a `Delegate` → `delegationHref` of its account, else `/{net}/account/{account}`. Two or more: E8's choice page with a row per object ("Escrow of {short account}", "Check of …", "Payment channel of …", "Delegation of …", with "removed" when `deleted`). The 64-hex hint and help text read "Transaction, ledger, NFT, escrow, check or payment channel", each part only while its switch is on. E8's failure rules stay.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // resolve.spec.ts
  it("finds an escrow in the index beside a transaction miss", …);
  it("asks the node's ledger_entry only when the index has nothing", …);
  it("does not ask for objects while LEDGER_OBJECTS is off", …);
  it("keeps something found over a failed object question, and throws a failure that leaves the question open", …);
  // search.spec.ts: an escrow ID → 302 to /xrpl/escrows/<ID>; a Delegate ID → its delegator's ?tab=delegation (and the account page with DELEGATION off);
  //   an ID that is a transaction and an object → the choice page with both rows
  // search-hints.test.ts: the words with each switch on and off
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test --project worker test/worker/resolve test/worker/search`, `pnpm test --project components app/ui/search-hints` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass.** Step 2's commands → PASS; `pnpm verify` → exit 0; `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit.** `git add app/server/resolve.ts test/worker/resolve.spec.ts app/routes/net.search.tsx app/ui/pages/SearchChoicePage.tsx app/ui/search-hints.ts app/ui/search-hints.test.ts app/ui/pages/SearchPage.tsx test/worker/search.spec.ts` — `feat(ui): search finds escrows, checks, payment channels and delegations by their ID`.

---

### Task 15: README, bundle figures, end to end and the rollout

**Files:**
- Create: `test/e2e/ledger-objects.spec.ts`, `test/e2e/delegation.spec.ts`, `test/unit/objects-bundle.test.ts`
- Modify: `test/e2e/a11y.spec.ts`, `README.md`

**Interfaces:**
- Consumes: everything above; `E2E_FEATURES_OFF`, `featuresOff`, `contextFor`, the fixture server's `override`.
- Produces: nothing for later plans except `MptAmount` (Task 5) and the object segment and links, which E14 extends.

- [ ] **Step 1: Write the failing tests.**
  - `objects-bundle.test.ts` (as E8's `nft-bundle.test.ts`): the three pages import nothing at run time from `app/server`, `app/domain/describe`, `app/domain/parse`, `keylet.ts` or `ripple-*`; `build/client` holds no `AffectedNodes`, `TransactionType` or `FinalFields`.
  - `ledger-objects.spec.ts` (§14, IDs read from the fixture cases, never fixed): each page in each recorded or synthetic state; the removed banner; the node fallback; the not-found page and its other-network link; the owner/sequence redirect; Older and Newer through `channel-long`; the links from a transaction's sentence, its objects touched and the Objects tab; the window bar's segments by keyboard; phone width with no horizontal scroll; without JavaScript the page is whole (times absolute).
  - `delegation.spec.ts`: the tab on XRPL with both lists; no tab on Xahau; a delegated payment's Sent by row and sentence; a `DelegateSet` with permissions and an empty one.
  - `a11y.spec.ts`: the three pages and the Delegation tab in both themes at 1280 and 375 px. Specs skip themselves when `E2E_FEATURES_OFF` lists their switch, and their off case runs instead.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test test/unit/objects-bundle`, `pnpm test:e2e` → the new cases FAIL until the specs' expectations hold.
- [ ] **Step 3: Write the README** (§15): "Switches" (already in Task 3), "The data API and the node" (the eight calls and `ledgerEntry`; the `app/server` table: `ledger-object-view.ts`, the three page views, `delegation-view.ts`, `object-shape.ts`, `object-load.ts`, `keylet.ts`), "The UI and the routes" (the four routes; the manifest's route count), "The transaction page" (Sent by, objects touched, `DelegateSet`), "The account page" (the Objects tab's links and From, the Delegation tab), a new "Ledger object pages" section (§1.2's table, the views, the caching of §9), "Search", "SEO and link previews" (three `meta-*.ts`, no image), "Upstream fixtures", "End-to-end tests", and "The client bundle check" (measure with `pnpm build && pnpm check:bundle`; record the three pages' figures and the account page's, with the growth of the manifest by four routes). Add the release checklist lines: the three pages on both networks against the sandbox stack, a node fallback, a 503 never stored against an API without D5.
- [ ] **Step 4: Run the whole suite.** `pnpm verify` → exit 0 (every page under 150,000 B); `pnpm fixtures:check` → up to date; `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit.** `git add test/e2e/ledger-objects.spec.ts test/e2e/delegation.spec.ts test/e2e/a11y.spec.ts test/unit/objects-bundle.test.ts README.md` — `docs: ledger object pages and delegation in the README, end to end and bundle figures`.

**What the owner does to deploy** (put in the hand-back): D5 is deployed in an environment first (migration 013, syncer, API; D5's plan, "What the owner does to deploy"). Then, per environment, by a commit to that block of `wrangler.jsonc` and a deploy: `LEDGER_OBJECTS` `"on"` once that environment's data API serves D5's routes on both networks; `DELEGATION` `"on"` once D5's re-ingest from 107,524,865 is done there (in the sandbox once the routes answer: its coverage is never complete, and the coverage notes say so). The two are independent; rolling back is `"off"` and a deploy. Coverage notes show under escrows, checks and channels until the full-history load; nothing changes when it ends.

---

## Rulings

1. **D5's paths go straight into `PATHS`** (§2.1 says `PENDING_PATHS` until a sync): Task 1 syncs D5's `openapi.yaml` before it adds a call, so the compiler checks them from the start.
2. **Issued-token values are checked with `isNumberText`**, not `isDecimalText` (§2.1): the ledger writes large and tiny token values in exponent form and D5 serves them as on the ledger; `formatAmount` already formats them. Native and MPT values stay `isDecimalText`.
3. **`fromNodeEntry(kind, entry, native, now)` returns D5's object exactly** (ISO times, the status at `now`) where §4 says "Ripple-epoch to unix": one view builder then serves both origins.
4. **`objectHref(net, kind, ref, features)` names the kind** (§4 writes `objectHref(net, ref, features)`): a reference by owner and sequence carries no type.
5. **Titles end with `suffixOf(network)`** ("Escrow 5B9C0E…D21F · XRPL · explorer"), the codebase's rule for a page of one object, where §11 writes "· XRPL".
6. **`objectRows(objects, ctx)` takes a context** `{ net, native, address, features }` (§7 writes `objectRows(objects, native, address)`), because the rows' links need the network and the switches and E8 added a parameter of its own.
7. **The object recordings are not added to `SETS`**: their ledgers are newer than the fixtures' head, which would change every page built on the head; `object-fixtures.ts` reads the two sets itself and writes the object answers and their transactions.
8. **Three granular permissions have words of this plan** (`AccountEmailHashSet`, `AccountMessageKeySet`, `AccountTickSizeSet`), in the board's pattern, which lists only nine.
9. **`findHash` keeps E8's options object** (consistency pass): E8 defines `findHash(api, node, hash, opts: HashQuestions)` with `HashQuestions { net, nfts }` (the node's question differs by network); this plan adds `ledgerObjects` to that interface and keeps `net`, rather than a new `{ nfts, ledgerObjects }` shape.
10. **Coverage notes are E8's `CoverageNoteText`** (consistency pass): `ObjectPageCommon.coverage` and `DelegationList.coverage` hold `coverageNote(…)`'s value (`CoverageNoteText | null`, a type import in browser files), which `CoverageNote` draws with its ledger link, not a string.
