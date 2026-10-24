# Display Names (E9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wherever the explorer shows an account, show its display name with a mark of its kind (and the full address on hover), a warning mark on a labelled address and a banner on its page, and on the account page the name, the domain and its state, "How we know" and what the domain's toml says, from D4's `GET /v2/account_names` and `GET /v2/toml/{domain}`, behind the switch `NAMES`.

**Architecture:** Loaders collect the addresses their page shows (`collectAddresses`), make one cached names call per awaited part (`loadNames`: sorted chunks of 100, at most 400, 1.5 s, never failing the page) and put a `NamesPart` in their data; pages wrap what they draw in `NamesProvider`, and `AccountLink`, `BarList` and the issuer texts read names from there, so components never fetch. The account page's header is built by a pure view builder (`accountNameHeader`) from the names entry, the node's Domain and one toml call. Immutable pages that show names are kept an hour at the edge while `NAMES` is on.

**Tech Stack:** React Router 8.4 (framework mode) on Cloudflare Workers, React 19, TypeScript, `ripple-address-codec` (Worker only), Vitest (`unit`, `components` with happy-dom, `worker` and `worker-off` in workerd), Playwright with axe.

**Spec:** `docs/superpowers/specs/2026-10-24-display-names-design.md` (E9; cited as "spec §n" or "decision n"; the plan argues from the spec, executors read both). The data: D4, `DAPI/docs/superpowers/specs/2026-10-24-display-names-design.md` (§5.2 the batch, §6 the toml route) and D4's plan `DAPI/docs/superpowers/plans/2026-10-24-display-names.md`.

**Branch:** `feat/explorer-pages-2` in `EXP = /Users/golobitch/github.com/GateHubNet/x-explorer-worktrees/explorer-pages-2`. Before Task 1: E7 and E8 are built on this branch (E7: the `sandbox` environment; E8: the NFT pages, the switch `NFTS`, `CoverageNote`), and D4 is complete on `DAPI = /Users/golobitch/github.com/GateHubNet/data-api-worktrees/explorer-data-2` (`feat/explorer-data-2`), which is read, never changed. Commit on this branch; never push.

## Global Constraints

- Setup once, in Task 1: `pnpm install` in `EXP`. `pnpm verify` (api:check, typecheck, test, build, check:bundle) exits 0 before every commit; `pnpm fixtures:check` too after Task 4; `pnpm test:e2e` after every task that touches a page (Tasks 6–8, 10–13).
- Commits: the repo's style (`feat(ui): …`, `feat(api): …`, `test(fixtures): …`, `docs: …`), a body saying why, and the last line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Name the files in `git add`; never `git add -A`, never `--amend`, never touch `.claude/`. Delete nothing you did not create in the task.
- The switch `NAMES` (`FEATURE_NAME` `names`): top level `"on"` (and the tests' `TOP_LEVEL_SWITCHES`), `sandbox` `"off"`, `production` `"off"` (decision 13). Off: no names call and no toml call anywhere; every page, title and card is today's; immutable pages keep their year.
- Calls: `accountNames` class `minute`, its key the sorted addresses (`loadNames` sorts); polled pages (home, market pair, validator) pass `holdFailure: true`. `toml` class `slow`. `NAMES_DEADLINE_MS = 1_500` (a streamed section passes what is left of its own deadline), `NAMES_MAX_ADDRESSES = 400`, `NAMES_BATCH_LIMIT = 100`. `NAMED_PAGE_TTL_SECONDS = 3600`: a page of class `immutable` that shows names (a transaction, a closed ledger) is `cached(page, "immutable", net.features.names ? { ttl: NAMED_PAGE_TTL_SECONDS } : {})`; subrequests keep their own classes.
- A names call that fails or is late never fails a page: the page shows addresses, `markDegraded(context, "names could not be loaded")`, `logProblem(…)`, and the answers that did arrive are used.
- Only shown parts are named: a loader passes `collectAddresses` the parts of its page data it draws as account links or issuer texts, never raw transaction JSON, metadata, memos or the raw tabs.
- Browser files (pages, `app/ui/**`, `app/domain/**`) import nothing from `app/server` as values and never `ripple-address-codec`; `collectAddresses` and `loadNames` are Worker-only (`app/server/names-load.ts`). `NamesPart` and the view (`app/domain/names.ts`) are browser-safe.
- Words exactly as the spec writes them (titles, sentences, marks, banners): "Verified by {domain} · {address}", "Named by GateHub · {address}", "Domain not verified · {address}", " · Labelled {labels} by GateHub", "verified name", "named by GateHub", "not verified", "labelled {labels} by GateHub", "How we know", "Labelled {label} by GateHub", "Source: {source}", "Details", the help and 6.3 sentences. Labels joined with `joinAnd`.
- Meaning never colour alone: each mark is a shape and a word (visually hidden or visible); icons `aria-hidden`; 44 px targets are the links', not the marks'; forced colours keep the icons (`currentColor`).
- External links (`ExternalLink`): `target="_blank" rel="noopener noreferrer nofollow"` for a verified domain, a toml file and a label's `url`; a label `url` is linked only when it is `https:`; an unverified domain is text (decision 9).
- Names are fictional and domains `*.example` in fixtures and tests.
- JS budget (ruling R19): 150,000 B gzip per lookup page, 160,000 B for the dashboards (validators, validator, supply); `pnpm check:bundle`.
- Worker specs share one Cache API per file: failure tests first, distinct ids; a failure is held in memory 5 s per key (`FAILURE_HOLD_SECONDS`) for calls with `holdFailure`: a test that overrides a key an earlier test failed moves the fake `Date` past it, as `network-hold.spec.ts` does.

## Review Focus

1. **The names call fails or is slow.** The page shows addresses as today, is served and not stored, and logs once; a polled page keeps the names it shows through a failed beat. Tests: Task 3 `names-load.test.ts` `a late answer is a failure: no names, degraded, logged`; Task 6 `transaction.spec.ts` `a failed names call: the addresses, and the page is not stored`; Task 13 `names.spec.ts` `a reload after a failed names call is a MISS` and `the home page keeps its names through a failed beat`.
2. **`NAMES` off.** No names or toml call on any page of spec §1, today's HTML, a year for immutable pages. Test: Task 13 `names-off.spec.ts`.
3. **Labels without a name, and label links.** A labelled address without a name still gets the warning mark and the label words in its title; a label `url` that is not `https:` is not linked. Tests: Task 5 `AccountLink.test.tsx` `labels only: the short address, LabelMark and the words in the title`; Task 9 `account-name-view.test.ts` `links a label's url only when it is https`.
4. **The account's domain from two sources.** The node's Domain and the index's disagree (index behind, a dormant account), `toml not found`, an `https://` Domain, a deleted account, the toml call failing: pending, none, the entry's domain, the batch's state with the 6.3 last-row sentence. Tests: Task 9 `account-name-view.test.ts` (every row of spec 6.1 and 6.6).
5. **Many addresses.** A ledger with more than 400 accounts names the first 400 collected (four sorted calls of 100), a page with none makes no call, a repeated address is asked once. Tests: Task 3 `names-load.test.ts` `names the first 400 collected, in four sorted calls`; Task 6 `ledger.spec.ts` `a ledger of 450 accounts: four calls of 100, sorted`.

---

## Consumed from earlier work

| Piece | From | Where |
| --- | --- | --- |
| `GET /v2/account_names?addresses=` (≤100, request order, 400 `addresses is required` / `too many addresses - at most 100` / `invalid ripple address`), entry keys `address, display_name?{text, kind}, domain?, account_name?, account_network_name?, labels?{scam|spam|advisory: {description, source?, url?}}`; `GET /v2/toml/{domain}` (`toml not found`), `toml` keys `domain, toml_url, status, reason?, status_code?, checked, fetched?, modified?, expires?, accounts?, currencies?, principals?, validators?` | D4 | `DAPI/docs/api-reference.md` "Account names and tomls", `DAPI/docs/openapi.yaml` |
| `createDataApi`, `get()`, `PATHS`, `FreshOptions`, `UpstreamError`, `Loaded`, `loaded`, `markDegraded`, `logProblem`, `byDeadline`, `TooLate`, `cached`, `keepLoaded`, `createLiveOnScreen` | program 1 | `app/server/{data-api,account-view,env,logging,deadline,edge-cache}.ts`, `app/ui/live-page.ts` |
| `AccountLink` (`net`, `address`, `full?`, `variant?`), `BarList`, `BarListData`, `ExternalLink`, `DomainStatus`, `Notice`, `AlertIcon`, `icon()`, `CopyButton`, `QrButton`, `Identicon`, `Breadcrumbs` | program 1, E6 | `app/ui/components/`, `app/ui/charts/` |
| `unverifiedSentence`, `tomlFileOf`, `verificationNote` | E6 | `app/server/validator-facts.ts` |
| `joinAnd`; `shortAddress`, `formatCurrency`, `formatDate`, `formatDateTime`; `fnv1a32`; `decodeDomain` | program 1, E6 | `app/domain/{time-words,format,fnv}.ts`, `app/server/account-view.ts` |
| `FEATURE_VARS` (… `NFTS` last), `featuresOf`, `TOP_LEVEL_SWITCHES`, `allSwitches`, the `worker-off` project, `featuresOff(process.env)`; the environments `sandbox` and `production` | program 1, E7, E8 | `app/ui/features.ts`, `vitest.config.ts`, `wrangler.jsonc`, `scripts/e2e-env.ts` |
| The NFT pages: routes `net.nfts._index.tsx`, `net.nfts.sales.tsx`, `net.nfts.$issuer.$taxon.tsx`, `net.nft.$id.tsx`; builders `nftsListPage`, `nftSalesPage`, `nftCollectionPage`, `nftPage`; the account NFTs tab (`TabList` `{ tab: "nfts" }`); their worker specs `nfts-list.spec.ts`, `nft-collection.spec.ts`, `nft.spec.ts` | E8 | `app/routes/`, `app/server/nfts-view.ts`, `nft-collection-view.ts`, `nft-view.ts` |
| Fixtures: `generate()`/`compare()` of `scripts/http-fixtures.ts`, `createUpstream` and `dataApiAbsent` of `test/support/upstream-core.ts`, `mockUpstream`, `fixtures.override`, `unavailable()`; the hand-written accounts (XRPL active `rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh`, deleted `r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC`; Xahau active `rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto`, deleted `rMoPk1MiYJbmdNL8xr5s11r7jrxzBhJWLD`) | program 1 | `scripts/`, `test/support/`, `test/e2e/fixture-control.ts`, `test/e2e/fixtures.ts` |

---

### Task 1: The names and toml calls

**Files:**
- Modify: `api/openapi.yaml`, `app/server/openapi.d.ts` (both by `pnpm api:sync`), `app/server/data-api.ts`, `app/server/api-types.ts`, `test/worker/data-api.spec.ts`
- Create: `app/server/names-shape.ts`, `app/server/names-shape.test.ts`

**Interfaces:**
- Consumes: D4's two routes (table above).
- Produces (Tasks 2–4, 9, 10):
  ```ts
  // api-types.ts
  export type DisplayNameKind = "verified" | "account" | "domain";
  export interface LabelData { description: string; source?: string; url?: string }
  export interface AccountNameEntry {
    address: string;
    /** `kind` is a DisplayNameKind, or a kind of a newer API, which this build reads as no name. */
    display_name?: { text: string; kind: string };
    domain?: string; account_name?: string; account_network_name?: string; labels?: Record<string, LabelData>;
  }
  export interface AccountNamesResponse { result: "success"; count: number; account_names: AccountNameEntry[] }
  export interface TomlData {
    domain: string; toml_url: string; status: "ok" | "failed"; reason?: string; status_code?: number; checked: string; fetched?: string;
    modified?: string; expires?: string; accounts?: { address: string; desc?: string }[];
    currencies?: { code: string; issuer?: string; display_decimals?: number; symbol?: string; name?: string; desc?: string }[];
    principals?: string[]; validators?: { public_key: string; owner_country?: string; server_country?: string; unl?: string }[];
  }
  export interface TomlAnswer { result: "success"; toml: TomlData }
  // data-api.ts: PATHS gains accountNames: "/v2/account_names", toml: "/v2/toml/{domain}"; DataApi gains
  accountNames(addresses: readonly string[], opts?: FreshOptions): Promise<AccountNamesResponse>;   // ?addresses=a,b sent as given, class minute
  toml(domain: string): Promise<TomlAnswer>;                                                         // class slow; `toml not found` is not_found
  // names-shape.ts
  export function checkAccountNames(body: AccountNamesResponse, addresses: readonly string[]): AccountNamesResponse;
  export function checkToml(body: TomlAnswer, domain: string): TomlAnswer;
  ```

The checks (spec §2.1), each throwing `UpstreamError("server", …)` (never stored): `count` and `account_names.length` equal `addresses.length`; entry `i`'s `address` is `addresses[i]`; a `display_name` has a non-empty string `text` and a string `kind`; `labels` is an object whose values have a string `description` and optional string `source`, `url`; `domain`, `account_name`, `account_network_name` strings when present. `checkToml`: `toml.domain === domain`, `status` `ok` or `failed`, `checked` a string, each list an array of objects with a string `address` / `code` / `public_key`, `principals` strings. The paths go straight into `PATHS` (Ruling 1).

- [ ] **Step 1: Sync the API description.** `pnpm install`, then `DATA_API_REPO=/Users/golobitch/github.com/GateHubNet/data-api-worktrees/explorer-data-2 pnpm api:sync`; `git diff --stat api/openapi.yaml` shows `/v2/account_names` and `/v2/toml/{domain}`. Note the D4 commit it prints for the commit message.
- [ ] **Step 2: Write the failing tests.** `names-shape.test.ts`: D4 §5.2's example passes; a count of 3 for 4 addresses, an entry for another address at a place, `display_name: { text: "" , kind: "verified" }`, `labels: { scam: {} }` each throw kind `server`; `kind: "curated"` passes (read later as no name); `checkToml` refuses another domain and `status: "pending"`. `data-api.spec.ts` rows: `accountNames(["rA…", "rB…"])` asks `/v2/account_names?addresses=rA…%2CrB…`, class `minute`, `holdFailure` kept out of the key; a malformed answer is not stored (the next call asks again); `toml("northpeak.example")` asks `/v2/toml/northpeak.example`, class `slow`; `toml not found` is `not_found`, `Cannot GET /v2/toml/x.example` is `server`.
- [ ] **Step 3: Run them to verify they fail.** `pnpm test -- names-shape data-api`.
- [ ] **Step 4: Implement** the types, the two paths, the two calls (`get(PATHS.accountNames, {}, { addresses: addresses.join(",") }, "minute", { ...fresh(opts), finish: (body) => checkAccountNames(body, addresses) })`, and the toml call likewise with `checkToml`) and the checks; `pnpm test -- names-shape data-api` and `pnpm verify` pass.
- [ ] **Step 5: Commit.** `git add api/openapi.yaml app/server/openapi.d.ts app/server/data-api.ts app/server/api-types.ts app/server/names-shape.ts app/server/names-shape.test.ts test/worker/data-api.spec.ts` — `feat(api): the names batch and the toml calls, synced with data-api <D4 commit>` (body: D4's two routes, each answer checked inside its cached load so a malformed one is never stored), trailer.

---

### Task 2: The switch `NAMES` and the name view

**Files:**
- Modify: `app/ui/features.ts`, `app/server/env.ts` (`Env.NAMES`), `wrangler.jsonc` (every block), `vitest.config.ts` (`TOP_LEVEL_SWITCHES`), `scripts/predeploy-check.test.ts` (the misspelt `NAME`), `test/worker/features-off.spec.ts` and `app/server/env.test.ts` (their cache-generation strings), `app/ui/features.test.ts`, `README.md` ("Switches": the `NAMES` row, values and the condition of decision 13)
- Create: `app/domain/names.ts`, `app/domain/names.test.ts`

**Interfaces:**
- Consumes: Task 1 `AccountNameEntry` (`import type`); `joinAnd`, `shortAddress`.
- Produces (every later task):
  ```ts
  // features.ts: FEATURE_VARS gains "NAMES" (last), FEATURE_NAME.NAMES = "names"
  // app/domain/names.ts (pure, browser-safe)
  export type NameKind = "verified" | "account" | "domain";
  export interface NameView { name?: { text: string; kind: NameKind }; network?: string; domain?: string; labels: string[] }
  export type NameMap = Readonly<Record<string, NameView>>;
  export interface NamesPart { state: "ok" | "off" | "failed"; map: NameMap }
  export const NAMES_OFF: NamesPart;   // { state: "off", map: {} }, frozen
  export const NO_NAMES: NamesPart;    // { state: "ok", map: {} }, frozen: nothing to name
  export function nameViewOf(entry: AccountNameEntry): NameView | null;
  export function linkTextOf(view: NameView): string;
  export function nameTitleOf(view: NameView, address: string): string;
  export function plainNameOf(view: NameView | undefined): string | null;
  export function shownIssuer(address: string, names: NameMap): string;   // plainNameOf(names[address]) ?? shortAddress(address)
  export function labelWords(labels: readonly string[]): string;          // joinAnd(labels)
  export function mergeNames(next: NameMap, shown: NameMap): NameMap;      // shown's entries under next's
  export function mergeNamesPart(next: NamesPart, shown: NamesPart): NamesPart;  // next's state, mergeNames(next.map, shown.map); "off" stays as next
  ```

Rules (spec §3.3): `nameViewOf` — `name` from `display_name` when its kind is one of the three (an unknown kind: no `name`); `network` = `account_network_name`; `domain` = `domain`; `labels` = `Object.keys(labels)` in the API's order; `null` when there is no `name`, no `network` and no label. `linkTextOf`: `name.text`, then ` · ` and `network` when it is set and not equal to the text; `''` when there is no `name` (callers draw the address then). `nameTitleOf`: by kind `Verified by {domain} · {address}`, `Named by GateHub · {address}`, `Domain not verified · {address}`, no name → the address; then ` · Labelled {labelWords} by GateHub` when labelled. `plainNameOf`: `linkTextOf(view)` when `name.kind` is `verified` or `account` and `labels` is empty, else `null`.

- [ ] **Step 1: Write the failing tests.** `names.test.ts`:
  ```ts
  const verified = { address: A, display_name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example" };
  expect(nameTitleOf(nameViewOf(verified)!, A)).toBe(`Verified by northpeak.example · ${A}`);
  const named = { address: B, display_name: { text: "Harborline Exchange", kind: "account" }, account_name: "Harborline Exchange",
    account_network_name: "hot wallet", labels: { advisory: { description: "Withdrawals paused" } } };
  expect(linkTextOf(nameViewOf(named)!)).toBe("Harborline Exchange · hot wallet");
  expect(nameTitleOf(nameViewOf(named)!, B)).toBe(`Named by GateHub · ${B} · Labelled advisory by GateHub`);
  expect(linkTextOf(nameViewOf({ address: C, display_name: { text: "hot wallet", kind: "account" }, account_network_name: "hot wallet" })!)).toBe("hot wallet");
  expect(nameTitleOf(nameViewOf({ address: D, display_name: { text: "lowtide.example", kind: "domain" }, domain: "lowtide.example" })!, D))
    .toBe(`Domain not verified · ${D}`);
  expect(nameViewOf({ address: E })).toBeNull();
  expect(nameViewOf({ address: E, domain: "x.example" })).toBeNull();
  expect(nameViewOf({ address: E, display_name: { text: "X", kind: "curated" } })).toBeNull();      // an unknown kind is no name
  expect(nameViewOf({ address: E, labels: { scam: { description: "d" }, spam: { description: "d" } } })).toEqual({ labels: ["scam", "spam"] });
  expect([plainNameOf(nameViewOf(verified)!), plainNameOf(nameViewOf(named)!), plainNameOf(undefined)]).toEqual(["Northpeak Treasury", null, null]);
  expect(shownIssuer(E, {})).toBe(shortAddress(E));
  ```
  `mergeNames({ a: v1 }, { a: v0, b: v2 })` is `{ a: v1, b: v2 }`; `mergeNamesPart` of a failed next and an ok shown keeps next's state and both maps; of `NAMES_OFF` gives `NAMES_OFF`. `features.test.ts`: `featuresOf({ NAMES: "on" }).names` is true. `predeploy-check.test.ts`: `NAME: "on"` refused as a misspelt switch naming `NAMES`. The generation strings of `features-off.spec.ts` and `env.test.ts` gain `NAMES`.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test -- names features predeploy-check env features-off`.
- [ ] **Step 3: Implement** the switch (README "Adding a switch", steps 1–5) and `names.ts`.
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm verify` exits 0.
- [ ] **Step 5: Commit.** `git add app/ui/features.ts app/server/env.ts wrangler.jsonc vitest.config.ts scripts/predeploy-check.test.ts test/worker/features-off.spec.ts app/server/env.test.ts app/ui/features.test.ts README.md app/domain/names.ts app/domain/names.test.ts` — `feat(ui): the NAMES switch and the name view` (body: what a names entry shows, in one pure browser-safe module; off in the sandbox and production until D4's first sweep there), trailer.

---

### Task 3: `collectAddresses` and `loadNames`

**Files:**
- Create: `app/server/names-load.ts`, `app/server/names-load.test.ts`
- Modify: `app/server/cache-class.ts` (`NAMED_PAGE_TTL_SECONDS`), `app/server/cache-class.test.ts`

**Interfaces:**
- Consumes: Task 1 `DataApi.accountNames`; Task 2 `nameViewOf`, `NamesPart`, `NAMES_OFF`, `NO_NAMES`; `byDeadline`, `markDegraded`, `logProblem`, `Features`.
- Produces (Tasks 4, 6–8, 10, 12):
  ```ts
  export const NAMES_DEADLINE_MS = 1_500; export const NAMES_MAX_ADDRESSES = 400; export const NAMES_BATCH_LIMIT = 100;
  export type { NamesPart } from "../domain/names";
  export interface NamesResult { part: NamesPart; entries: ReadonlyMap<string, AccountNameEntry> }
  export interface NamesContext { context: unknown; request?: Request; features: Pick<Features, "names">; holdFailure?: boolean; deadlineMs?: number }
  /** Every classic address among the strings of `parts` (arrays and plain objects, depth first, keys in order), once each, in the order met. */
  export function collectAddresses(...parts: unknown[]): string[];
  /** Never rejects. */
  export function loadNames(api: Pick<DataApi, "accountNames">, addresses: readonly string[], ctx: NamesContext): Promise<NamesResult>;
  // cache-class.ts
  export const NAMED_PAGE_TTL_SECONDS = 3600;
  ```

Rules (spec §3.1, §3.2): a string is an address when it matches `/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/` and `isValidClassicAddress` accepts it; a string is never parsed (JSON text inside a string is not walked); an object met twice is walked once. `loadNames`: names off → `{ part: NAMES_OFF, entries: new Map() }`, no call; no address → `{ part: NO_NAMES, … }`, no call; else the first 400 addresses (collection order), sorted, chunks of 100, every chunk's `accountNames(chunk, { holdFailure })` side by side, each `byDeadline(…, start + (deadlineMs ?? NAMES_DEADLINE_MS))`; a chunk that fails or is late → `state: "failed"`, one `markDegraded(context, "names could not be loaded")` and one `logProblem("names could not be loaded", err, request)` per call of `loadNames`; the map holds `nameViewOf` of each entry that arrived and is not `null`; `entries` every entry that arrived, by address.

- [ ] **Step 1: Write the failing tests** (`names-load.test.ts`, a fake `accountNames`, a load context from `createLoadContext(env, ctx, mark)` as `analytics-load.test.ts` makes it): collect order and dedupe over `[{ a: A, b: [B, A] }, "x", C]` → `[A, B, C]`; a bad checksum, an X-address, `'{"a":"rA…"}'` are skipped; `it('names the first 400 collected, in four sorted calls')` (450 addresses: calls of 100, 100, 100, 100, each sorted, together the first 400 collected); 250 → three calls; off → no call, `NAMES_OFF`; none → no call, `NO_NAMES`; `it('a late answer is a failure: no names, degraded, logged')` (deadline 10 ms, a call that never settles: `state "failed"`, `mark.degraded` true, one log line); one of three chunks failing: `failed`, the other two chunks' names in the map, one log line; `holdFailure` passed through; an entry of an unknown kind is in `entries` and not in the map. `cache-class.test.ts`: `NAMED_PAGE_TTL_SECONDS` is 3600.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test -- names-load cache-class`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm verify`; `test/unit/account-bundle.test.ts` and the module-graph check still pass (nothing of `names-load.ts` reaches the browser).
- [ ] **Step 5: Commit.** `git add app/server/names-load.ts app/server/names-load.test.ts app/server/cache-class.ts app/server/cache-class.test.ts` — `feat(api): collectAddresses and loadNames` (body: one helper every loader uses: the addresses a page shows, named in sorted calls of 100 that can fail or be late without failing the page), trailer.

---

### Task 4: Fixtures of names and tomls

**Files:**
- Create: `scripts/names-fixtures.ts`, `test/unit/names-fixtures.test.ts`, the generated `test/fixtures/http/<net>/data-api/account_names.json` and `test/fixtures/http/<net>/data-api/toml/<domain>.json` (by `pnpm fixtures:sync`)
- Modify: `scripts/http-fixtures.ts` (`generate()` calls `namesFixtures` last, over the other files of the network, committed and generated; `isNamesGenerated` excluded from the other generators' predicates), `test/support/upstream-core.ts` (`/v2/account_names` composed; `dataApiAbsent` answers `toml not found` for `/v2/toml/{d}`), `test/unit/upstream-core.test.ts`, `test/unit/http-fixtures.test.ts` (a size budget for the names files: 64 KiB a network), `test/fixtures/http/xrpl/node/account_info/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh.json` and `test/fixtures/http/xahau/node/account_info/rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto.json` (each gains `"Domain"`: `6E6F7274687065616B2E6578616D706C65` = `northpeak.example`, `7469646577617465722E6578616D706C65` = `tidewater.example`; Ruling 6), `README.md` ("Upstream fixtures": rows for both files, "generator (synthetic)"), `test/fixtures/PROVENANCE.md` (a section "Synthetic names and tomls")

**Interfaces:**
- Consumes: Task 3 `collectAddresses`; Task 1 the entry and toml shapes; `fnv1a32`.
- Produces (Tasks 6–13; the e2e suite):
  ```ts
  export const NAMES_SEEDED_MAX = 500;
  export const NAMES_SOURCES: readonly RegExp[];        // below, in priority order
  export const FIXED_NAMES: Record<"xrpl" | "xahau", readonly FixedName[]>;
  export function namesFixtures(net: "xrpl" | "xahau", files: ReadonlyMap<string, string>): FixtureFile[];
  export function isNamesGenerated(path: string): boolean;   // <net>/data-api/account_names.json and <net>/data-api/toml/*.json
  ```

What is written (spec §10): `account_names.json` is `{ "<address>": <entry> }`, D4's key order, one entry per line, only addresses with something to show, sorted by address. Addresses: the fixed ones below, then up to `NAMES_SEEDED_MAX` collected (`collectAddresses(JSON.parse(text))`) from the files of `NAMES_SOURCES` in this order (paths below `<net>/data-api/`, files of one pattern by path): `accounts/r*.json`; `accounts/r*/balances.json`; `transactions@descending=true&limit=8.json`; `transactions/<hash>.json` (not `@binary`); `accounts/r*/{transactions,payments,exchanges}@descending=true&limit=20.json`; `active_accounts/**`; `amm/**`; `network/validators@*`; E8's `nft_sales@*`, `nft_collections/**`, `nfts/**`. A seeded address's state is `fnv1a32(\`${net}:${address}\`) % 40`: 0–7 verified, 8–12 named by GateHub (with an account network name when the hash's bit 8 is set), 13–16 domain not verified, else nothing; its name and `*.example` domain come from two fixed word lists by the hash. Tomls: each verified domain gets an `ok` file listing its account with its `desc`, except the first seeded verified address by sort, listed without `desc` (its name is its domain); every second seeded "domain not verified" address (by sort) gets an `ok` file that does not list it, the others none (`toml not found`).

The fixed cases (decision 11's fixtures; descriptions say they are test data):

| Network | Address | Shown as | State |
| --- | --- | --- | --- |
| xrpl | `rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh` | the active account | verified, `northpeak.example`, "Northpeak Treasury"; its `ok` toml lists it with that `desc`, principals `Mara Lindqvist`, `Tomas Okafor`, currencies `NPUSD` (this issuer, `display_decimals` 2, `name` "Northpeak Dollar") and `NPEUR` (this issuer), `modified` `2026-10-02T00:00:00Z` |
| xrpl | `r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC` | the deleted account | named by GateHub "Harborline Exchange", network name "hot wallet", label `advisory` ("Test label: withdrawals paused", source "GateHub", url `https://status.example/harborline`) |
| xrpl | `rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ` | the active account's parent | label `spam` only ("Test label") |
| xrpl | `rURtT5MMFzSUR54MAq9MKfzBoezTBZbKns` | the deleted account's parent | domain not verified `lowtide.example` (an `ok` toml that does not list it), label `scam` ("Test label") |
| xahau | `rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto` | the active account | verified, `tidewater.example`, "Tidewater Reserve"; toml as Northpeak's with `TWUSD`, `TWEUR`, the same principals and `modified` |
| xahau | `rMoPk1MiYJbmdNL8xr5s11r7jrxzBhJWLD` | the deleted account | domain not verified `saltmarsh.example` (a `failed` toml, `http_status` 404), label `scam` ("Test label") |
| xahau | `rEvernodee8dJLaFsujS6q1EiXvZYmHXr8` | the accounts' parent | named by GateHub "Hookfield Labs", no network name |

`upstream-core.ts` answers `GET /v2/account_names` as D4 does, before the file lookup and after the overrides: an override of the exact key, else an override keyed `GET /v2/account_names` without a query (it replaces every names call; `unavailable()` for a failure), else the composition: `addresses` (the first value) missing or empty → 400 `addresses is required`; split on `,`; more than 100 → 400 `too many addresses - at most 100`; any element not a valid classic address → 400 `invalid ripple address`; else `{ result: "success", count, account_names }` with each address's entry from `account_names.json` or `{ address }`, in order. The fixture server and `mockUpstream` share it.

- [ ] **Step 1: Write the failing tests.** `names-fixtures.test.ts`: every entry of both files passes `checkAccountNames` for its own address; each fixed case is there as the table says; every verified entry's domain has an `ok` toml listing its address; the file has one entry per line (lines = entries + 2); the counts per state are within ±50 % of the seeded shares. `upstream-core.test.ts`: the composition (order, a repeat answered twice, an unknown address `{ address }`, the three 400s); an override keyed `GET /v2/account_names` answers every names call, an exact key wins over it; `GET /v2/toml/nope.example` → 404 `toml not found`. `http-fixtures.test.ts`: the budget.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test -- names-fixtures upstream-core http-fixtures`.
- [ ] **Step 3: Implement the generator, the composer, the two `Domain`s, then `pnpm fixtures:sync`.**
- [ ] **Step 4: Run the checks.** `pnpm fixtures:check` and `pnpm verify` exit 0; `pnpm test:e2e` exits 0 (the account pages now say "· domain northpeak.example" while nothing reads names yet).
- [ ] **Step 5: Commit.** `git add scripts/names-fixtures.ts scripts/http-fixtures.ts test/unit/names-fixtures.test.ts test/unit/upstream-core.test.ts test/unit/http-fixtures.test.ts test/support/upstream-core.ts test/fixtures/http/xrpl/data-api/account_names.json test/fixtures/http/xahau/data-api/account_names.json test/fixtures/http/xrpl/data-api/toml test/fixtures/http/xahau/data-api/toml test/fixtures/http/xrpl/node/account_info/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh.json test/fixtures/http/xahau/node/account_info/rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto.json README.md test/fixtures/PROVENANCE.md` — `test(fixtures): synthetic names and tomls, and the names batch composed as D4 answers it`, trailer.

---

### Task 5: `NamesProvider`, the marks, `AccountLink` and `BarList`

**Files:**
- Create: `app/ui/names.tsx`, `app/ui/names.test.tsx`, `app/ui/components/NameMark.tsx`, `app/ui/components/NameMark.test.tsx`, `app/ui/components/AccountLink.test.tsx`
- Modify: `app/ui/components/AccountLink.tsx`, `app/ui/components/icons.tsx` (`SealCheckIcon`, `TagIcon`: the paths of `AccountNames.dc.html`'s `.aname` marks, stroke 2.2, size 14), `app/ui/charts/types.ts` (`mark`), `app/ui/charts/BarList.tsx`, `app/ui/charts/BarList.test.tsx`, `app/ui/components.css` (`.acct`, `.acct__name`, `.acct__address`, `.namemark`, `.namemark--verified` `--ok`, `.namemark--account` `--muted`, `.unv`, `.labelmark` `--bad`; the board's values), `test/unit/tokens.test.ts` (the marks' colours on both themes)

**Interfaces:**
- Consumes: Task 2 `NameMap`, `NameView`, `NameKind`, `linkTextOf`, `nameTitleOf`, `labelWords`.
- Produces (Tasks 6–8, 10, 11; E10, E11, E13, E14 use `AccountLink` and `NamesProvider` as they are here):
  ```ts
  // app/ui/names.tsx
  export function NamesProvider({ names, children }: { names: NameMap; children: ReactNode }): JSX.Element;  // adds to the outer provider's map
  export function useNameOf(address: string): NameView | undefined;                                         // undefined outside a provider
  // NameMark.tsx
  export function NameMark({ kind }: { kind: NameKind }): JSX.Element;
  export function LabelMark({ labels }: { labels: readonly string[] }): JSX.Element | null;   // null for no label
  // charts/types.ts: BarListData.items[] gains
  mark?: { kind?: NameKind; labels: string[] };
  ```

Spec §4: `AccountLink` props unchanged. No view → today's output exactly. A name → `<Link className={cx("acct", variant === "chip" && "ent")} title={nameTitleOf(view, address)}>` holding `<span className="acct__name">{linkTextOf(view)}</span>`, `<NameMark kind>`, `<LabelMark labels>` when labelled, and with `full` `<span className="acct__address mono">{address}</span>`; not mono. Labels only → today's short (or full) mono address with `<LabelMark>` and the title `nameTitleOf(view, address)`. `NameMark`: `verified` the seal-check icon in `--ok` with `<span className="sr">verified name</span>`; `account` the tag icon in `--muted` with "named by GateHub"; `domain` `<span className="unv">not verified</span>`. `LabelMark`: `AlertIcon` in `--bad` with `<span className="sr">labelled {labelWords} by GateHub</span>`. `BarList` draws `NameMark` (when `kind`) and `LabelMark` after the label, inside the label's link.

- [ ] **Step 1: Write the failing tests.** `AccountLink.test.tsx` (inside a `NamesProvider` of the Task 2 test views): verified → text "Northpeak Treasury", title `Verified by northpeak.example · r…`, accessible name "Northpeak Treasury verified name", no `mono` on the link; named with a network name and `advisory` → "Harborline Exchange · hot wallet named by GateHub labelled advisory by GateHub"; domain kind → "lowtide.example not verified"; `it('labels only: the short address, LabelMark and the words in the title')`; `full` → the whole address in `.acct__address`; `variant="chip"` keeps `ent`; outside a provider, today's markup (snapshot of today's output). `NameMark.test.tsx`: the three kinds' hidden or visible words, the icons `aria-hidden`; `LabelMark` of `["scam", "spam"]` reads "labelled scam and spam by GateHub", of `[]` nothing. `names.test.tsx`: a nested provider adds to the outer map, inner entries win. `BarList.test.tsx`: an item with `mark: { kind: "verified", labels: ["scam"] }` draws both marks in the label's link; without `mark`, unchanged. `tokens.test.ts`: `--ok`, `--muted`, `--bad` on `--surface` at 4.5:1 or more, both themes.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test -- AccountLink NameMark names BarList tokens`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm verify` exits 0.
- [ ] **Step 5: Commit.** `git add app/ui/names.tsx app/ui/names.test.tsx app/ui/components/NameMark.tsx app/ui/components/NameMark.test.tsx app/ui/components/AccountLink.tsx app/ui/components/AccountLink.test.tsx app/ui/components/icons.tsx app/ui/charts/types.ts app/ui/charts/BarList.tsx app/ui/charts/BarList.test.tsx app/ui/components.css test/unit/tokens.test.ts` — `feat(ui): AccountLink shows display names, with name and label marks`, trailer.

---

### Task 6: Names on the home, ledger and transaction pages

**Files:**
- Modify: `app/routes/net._index.tsx`, `app/routes/net.ledger.$id.tsx`, `app/routes/net.tx.$id.tsx` (loaders, the `NamesProvider` around the page, the home page's merge), `app/server/home-view.ts`, `app/server/ledger-view.ts`, `app/server/transaction-view.ts` (each page data gains `names: NamesPart`), `test/worker/home.spec.ts`, `test/worker/home-live.spec.ts`, `test/worker/ledger.spec.ts`, `test/worker/transaction.spec.ts`

**Interfaces:**
- Consumes: Task 3 `collectAddresses`, `loadNames`, `NAMED_PAGE_TTL_SECONDS`; Task 5 `NamesProvider`; Task 2 `mergeNamesPart`; `keepLoaded`.
- Produces: `HomePageData.names`, `LedgerPageData.names`, `TransactionPageData.names` (`NamesPart`).

What each loader names (spec §1, §5), after the calls it awaits:
- **Home** (`live-home`, polled): `collectAddresses(page.transactions)` (the rows' `account`; not `examples`, which keep short addresses), `holdFailure: true`. The route's `createLiveOnScreen` gains `merge: (next, shown) => { const kept = keepLoaded(next, shown, ["names"]); return { ...kept, names: mergeNamesPart(kept.names, shown.names) }; }`.
- **Ledger**: `collectAddresses(page.rows, page.accountsCreated)` (not `raw`); a closed ledger `cached(page, "immutable", net.features.names ? { ttl: NAMED_PAGE_TTL_SECONDS } : {})`; the open one stays `live`; from the node stays `short` with `FROM_NODE_TTL`.
- **Transaction**: `collectAddresses(page.sentence, page.flow, page.account, page.details, page.changes, page.objects)` (never `raw`, `memos`, `summary`); `immutable` with the TTL as above (the `short` of a page without its binary form stays); from the node named too, `short`, `FROM_NODE_TTL`. Titles, descriptions, cards and `plainText` keep short addresses (spec §7).

- [ ] **Step 1: Write the failing tests** (worker specs, the fixture upstream): home — one names call with the sorted addresses of the eight rows, `holdFailure`, the verified account's name and title in the table; ledger — one call of the rows' and created accounts, sorted; `it('a ledger of 450 accounts: four calls of 100, sorted')` (an override of the ledger with 450 distinct senders); a closed ledger's page stored with TTL 3600 (the edge cache's TTL header), the newest one `live`; transaction — one call of the shown parts only (an address only in the metadata of an untouched node is not asked); the sentence, the flow and the details' Account show the name, the details row keeping the whole address; stored with TTL 3600; `it('a failed names call: the addresses, and the page is not stored')` (`mockUpstream` with `"GET /v2/account_names": dataApiError(503, "unavailable")`: 200, short addresses, a second request is a `MISS`); a transaction from the node is named. Home live: a beat whose names call fails keeps the names part `ok` with the earlier map (`home-live.spec.ts`).
- [ ] **Step 2: Run them to verify they fail.** `pnpm test -- home ledger transaction`.
- [ ] **Step 3: Implement** the three loaders, the page data fields, the providers and the merge.
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm verify` and `pnpm test:e2e` exit 0.
- [ ] **Step 5: Commit.** `git add app/routes/net._index.tsx app/routes/net.ledger.\$id.tsx app/routes/net.tx.\$id.tsx app/server/home-view.ts app/server/ledger-view.ts app/server/transaction-view.ts test/worker/home.spec.ts test/worker/home-live.spec.ts test/worker/ledger.spec.ts test/worker/transaction.spec.ts` — `feat(ui): display names on the home, ledger and transaction pages` (body: one names call per page; a page that shows names is kept an hour, not a year, so a new label shows within about an hour), trailer.

---

### Task 7: Names on the markets and AMM pages

**Files:**
- Modify: `app/routes/net.markets.tsx`, `app/routes/net.markets.$base.$counter.tsx`, `app/routes/net.amm._index.tsx`, `app/routes/net.amm.$pool.tsx`, `app/server/markets-view.ts` (`issuersOf(base, counter, names = {})` through `shownIssuer`; `marketsPage` input `names`), `app/server/pair-view.ts` (`pairHead(…, names = {})` for `issued` and `issuedBy`; `tradersOf` items), `app/server/amm-view.ts` (`ammListPage`, `ammPoolPage` inputs `names`; `voteShares(votes, net, names = {})`; issuer texts and sublabels through `shownIssuer`), their `*.test.ts`, `test/worker/markets-page.spec.ts`, `test/worker/market-pair.spec.ts`, `test/worker/market-pair-live.spec.ts`, `test/worker/amm-list.spec.ts`, `test/worker/amm-pool.spec.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5 (`shownIssuer`, `linkTextOf`, `nameViewOf`'s views, `loadNames`, `NamesProvider`, `BarListData.items[].mark`).
- Produces: `MarketsPageData.names`, `LivePairData.names` (in the parts `keepLoaded` keeps), `AmmListPageData.names`, `AmmPoolPageData.names`.

Spec §1, §4.3: issuer texts (`issuersOf`, the pair's `issued`/`issuedBy`, the AMM list's and pool's `of {issuer}` texts and issuer sublabels) are `shownIssuer(address, names)`. A `BarList` item of an account with a name: `label: linkTextOf(view)`, `sublabel: shortAddress(address)`, `mark: { kind, labels }`; with labels only: the label unchanged and `mark: { labels }`; unnamed: unchanged. The data's `token` (`tokenOf({ items, format })`) then covers `mark`, so a beat that changes only a mark redraws the list. The vote items keep their "votes for …" sublabel, which becomes `${shortAddress(account)} · votes for …` when named (Ruling 7). Each loader collects the addresses its builder will show from the answers (the rows' issuers; the pair's takers and active accounts; the pool's account, creator, LP holders, voters, takers, providers), names them, then builds with `names.map`. The pair page passes `holdFailure: true`, adds `"names"` to `PAIR_PARTS`' merge and runs `mergeNamesPart` as Task 6's home page does. A page behind a marker names its rows the same way, awaited.

- [ ] **Step 1: Write the failing tests.** Unit: `markets-view.test.ts` `issuersOf` with a verified issuer reads "USD Northpeak Treasury", with a labelled one the short address; `pair-view.test.ts` a named trader's item `{ label: "Northpeak Treasury", sublabel: "rBbW6i…", mark: { kind: "verified", labels: [] } }`, a labelled-only one `{ label: <short>, mark: { labels: ["spam"] } }`; `amm-view.test.ts` the named vote's sublabel. Worker: each page makes one names call (the pair page with `holdFailure`), class `minute`, sorted; its failure leaves the page served with addresses and not stored; the pair page's live beat keeps names through a failed names call.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test -- markets pair amm`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm verify` and `pnpm test:e2e` exit 0.
- [ ] **Step 5: Commit.** `git add app/routes/net.markets.tsx app/routes/net.markets.\$base.\$counter.tsx app/routes/net.amm._index.tsx app/routes/net.amm.\$pool.tsx app/server/markets-view.ts app/server/markets-view.test.ts app/server/pair-view.ts app/server/pair-view.test.ts app/server/amm-view.ts app/server/amm-view.test.ts test/worker/markets-page.spec.ts test/worker/market-pair.spec.ts test/worker/market-pair-live.spec.ts test/worker/amm-list.spec.ts test/worker/amm-pool.spec.ts` — `feat(ui): display names on the markets and AMM pages`, trailer.

---

### Task 8: Names on the validator page and E8's NFT pages

**Files:**
- Modify: `app/routes/net.validators.$key.tsx` (the names call with `holdFailure`; `"names"` in `VALIDATOR_PARTS`' merge with `mergeNamesPart`), `app/server/validator-view.ts` (page data `names`), `app/ui/pages/ValidatorPage.tsx` (the accounts line: `AccountLink` in place of the `Link` with `shortAddress`), `app/ui/pages/ValidatorPage.test.tsx`, `test/worker/validator-page.spec.ts`; E8's `app/routes/net.nfts._index.tsx`, `net.nfts.sales.tsx`, `net.nfts.$issuer.$taxon.tsx`, `net.nft.$id.tsx`, their builders' page data (`names`), and E8's worker specs `nfts-list.spec.ts`, `nft-collection.spec.ts`, `nft.spec.ts`

**Interfaces:**
- Consumes: Tasks 3, 5, 2.
- Produces: `ValidatorLoaderData.names`; each E8 page data `names`.

What is named (spec §1, §5): the validator page `grid.accounts` (the accounts a verified domain's toml lists); the NFT list: the recent sales' sellers and buyers (the collections table's issuer labels link to collections, not accounts, and are not named); the sales page: its rows' sellers and buyers; a collection: the header's issuer and the tab's rows (sellers, buyers, owners, holders); an NFT: the owner, issuer, minter, the "to" account, the burner, the open offers' accounts and destinations, the history's accounts. One call per awaited part, after the calls the page awaits; a page behind a marker the same, awaited. Nothing else of E8 changes.

- [ ] **Step 1: Write the failing tests.** `ValidatorPage.test.tsx`: the accounts line is `AccountLink`s (in a provider: a named account shows its name). `validator-page.spec.ts`: one names call of `grid.accounts` with `holdFailure`; a failed one keeps the page live and unstored. E8 specs: one names call per page with the addresses above, sorted; a named seller shows its name; a failed call leaves addresses.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test -- validator nft`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm verify` and `pnpm test:e2e` exit 0.
- [ ] **Step 5: Commit.** `git add app/routes/net.validators.\$key.tsx app/server/validator-view.ts app/ui/pages/ValidatorPage.tsx app/ui/pages/ValidatorPage.test.tsx test/worker/validator-page.spec.ts` and E8's route files, builders and specs changed, by name — `feat(ui): display names on the validator and NFT pages`, trailer.

---

### Task 9: The toml sentences and the account name header builder

**Files:**
- Create: `app/server/toml-words.ts`, `app/server/toml-words.test.ts`, `app/server/account-name-view.ts`, `app/server/account-name-view.test.ts`
- Modify: `app/server/validator-facts.ts` (`unverifiedSentence` and `tomlFileOf` move to `toml-words.ts`; `validator-facts.ts` imports them and re-exports `tomlFileOf`; its words unchanged), `app/ui/brand.ts` (`NAME_REQUEST_URL`)

**Interfaces:**
- Consumes: Task 1 `AccountNameEntry`, `TomlAnswer`; Task 2 `NameKind`, `labelWords`; `Loaded`; `formatDate`, `formatDateTime`, `formatCurrency`, `joinAnd`.
- Produces (Tasks 10–12):
  ```ts
  // toml-words.ts
  export type TomlSubject = "this master key" | "this account";
  export function tomlFileOf(software: Network["software"]): "xrp-ledger.toml" | "xahau.toml";
  export function unverifiedSentence(dv: DomainVerification, domain: string, file: string, subject?: TomlSubject): string;  // E6's, subject default "this master key"
  export function tomlFailureWords(reason: string | undefined, statusCode: number | undefined): string;
  export function domainNotVerifiedSentence(domain: string, file: string, toml: Loaded<TomlAnswer>): string;
  // account-name-view.ts
  export type DomainState = "verified" | "not-verified" | "pending" | "none";
  export interface NameTitle { text: string; kind: NameKind; network?: string }
  export interface LabelBanner { label: string; title: string; description: string; source?: string; href?: string }
  export interface DomainLine { text: string; state: DomainState; href?: string; note?: string }
  export interface HowWeKnow { domain: string; tomlHref: string; tomlText: string; descGivesName: boolean; checked?: string }
  export interface TomlFacts { principals?: string; currencies?: { code: string; issuer?: string }[]; modified?: string }
  export interface NameHeader { title: NameTitle | null; labels: LabelBanner[]; labelMarks: string[]; domainLine: DomainLine | null;
    howWeKnow: HowWeKnow | null; facts: TomlFacts | null; help: "named" | null }
  export interface NameHeaderInput { address: string; entry?: AccountNameEntry; liveDomain: string | null; toml: Loaded<TomlAnswer> | null;
    network: Pick<Network, "software" | "id">; brief?: boolean }
  export function isProperlyFormedDomain(text: string): boolean;   // rippled's rule: 4–128 characters, /^((?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,63}$/
  export function accountNameHeader(input: NameHeaderInput): NameHeader;
  // brand.ts
  export const NAME_REQUEST_URL: string | null = null;   // decision 11: the owner gives the URL
  ```

`tomlFailureWords`: `dns_error` "the DNS lookup failed", `connect_error` "the connection failed", `tls_error` "TLS failed", `timeout` "it timed out", `http_status` "the server answered HTTP {code}" ("the server answered with an error" without a code), `too_large` "it is larger than 256 KiB", `toml_invalid` "it is not valid TOML", `redirect_rejected` and `blocked_address` "the server sent the request where the data API does not follow", `domain_invalid` "the domain is not a valid domain name", anything else "the data API could not read it" (Ruling 4). `domainNotVerifiedSentence` (spec 6.3): toml `ok` → "This account names {d} in its Domain field, but {d}'s {file} does not list the account. The explorer shows the domain, without vouching for it."; `failed` → "This account names {d} in its Domain field, but its {file} could not be read: {tomlFailureWords}. The explorer shows the domain, without vouching for it."; the call failed → "This account names {d} in its Domain field. The explorer shows the domain, without vouching for it."

`accountNameHeader` (spec 6.1–6.5): the shown domain D is `liveDomain` when not `null`, else `entry.domain`; compared lower-cased. Its state: `verified` when the entry's kind is `verified` and `entry.domain` is D; else `not-verified` when `entry.domain` is D and the toml has a row or its call failed; else `pending` when D is well formed (`isProperlyFormedDomain`) and the entry names another domain or none, or the toml is `missing`; else `none` (text only). `title`: the display name (`text`, `kind`, `network` when set and not the text), `null` without one (or an unknown kind). `domainLine`: `{ text: D, state }` with `href` `https://{D}` only for `verified`, `note` the 6.3 sentence for `not-verified` and "Not checked yet." for `pending`; `null` without D. `howWeKnow` (verified only): `tomlHref` `https://{D}/.well-known/{file}`, `tomlText` `{D}/.well-known/{file}`, `descGivesName` = the name is not D, `checked` `formatDateTime(toml.checked)` when the toml answered. `facts` (verified and the toml `ok`, else `null`; `null` when none present): `principals` joined, `currencies` `formatCurrency(code)` with `issuer`, `modified` `formatDate(modified)`. `labels`: one banner per label in the entry's order, title "Labelled {label} by GateHub", `href` the `url` only when `new URL(url).protocol === "https:"`. `help` `"named"` for kind `account`. `brief` (the page behind a marker, Ruling 8): only `title`, `labels`, `labelMarks`.

- [ ] **Step 1: Write the failing tests.** `toml-words.test.ts`: each reason's words; the three 6.3 sentences on XRPL and Xahau (`xahau.toml`); `unverifiedSentence` with `"this account"` says "does not list this account", the validator's default unchanged (`validator-facts.test.ts` passes as it is). `account-name-view.test.ts`, one test per row of 6.1 and 6.6: verified (title, `domainLine` with `href`, `howWeKnow` with `descGivesName` true, then with the name being the domain false, `checked` when the toml answered, absent when it failed, `facts` with both currencies, principals "Mara Lindqvist and Tomas Okafor" and "Oct 2, 2026"); named with no domain (`domainLine` null, `help` "named"); named with a domain the toml does not list (`not-verified`); domain not verified with an `ok` toml, a `failed` toml, a failed call (the three sentences); no name with a well-formed live domain the entry does not name (`pending`); `toml not found` (`pending`); `https://x.com` as the live domain (`none`, no href); a deleted account (no live domain: the entry's); the node's domain in upper case matching the entry's (verified); `it('links a label\'s url only when it is https')` (`http://…` and `javascript:` give no `href`); `brief` gives only title and labels.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test -- toml-words account-name-view validator-facts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm verify` exits 0.
- [ ] **Step 5: Commit.** `git add app/server/toml-words.ts app/server/toml-words.test.ts app/server/account-name-view.ts app/server/account-name-view.test.ts app/server/validator-facts.ts app/ui/brand.ts` — `feat(ui): the account name header and the toml sentences`, trailer.

---

### Task 10: The account page's names calls

**Files:**
- Modify: `app/routes/net.account.$address.tsx` (first page, page behind a marker, Analytics view), `app/server/account-view.ts` (`AccountHeader.name`, `HistoryHeader.name`, `AccountPageBase.names`, the `ok` variants of `TabList` gain `names: NamesPart` (`NO_NAMES` from the list builders), `listAddresses(list: TabList): string[]`), `app/server/analytics-load.ts` (each card with accounts names inside its promise), `app/server/analytics-view.ts` (`balancesCard(frame, answer, names = {})` sublabels and `pairsCard`'s `issued` through `shownIssuer`; the counterparties, balances and exchanges card data gain `names: NamesPart`), `app/server/account-view.test.ts`, `app/server/analytics-load.test.ts`, `app/server/analytics-view.test.ts`, `test/worker/account.spec.ts`, `test/worker/account-analytics.spec.ts`

**Interfaces:**
- Consumes: Tasks 3, 9 (`accountNameHeader`), Task 1 (`api.toml`), Task 2 (`NO_NAMES`, `shownIssuer`); `decodeDomain`, `within`, `LAST_LEDGER_DEADLINE_MS`, `LIST_DEADLINE_MS`.
- Produces (Tasks 11, 12): `AccountHeader.name: NameHeader | null`, `HistoryHeader.name: NameHeader | null` (`null` with `NAMES` off or a failed header call), `AccountPageData.names: NamesPart` (the header call's), `TabList` `names`, the analytics cards' `names`.

The calls (spec §5, §6.5):
- **First page**: the header's names call after the header's calls, awaited with the header: `collectAddresses(address, activation?.parent, tokens' issuers)`. The toml call starts as soon as `account_info` gives a domain that `isProperlyFormedDomain` accepts (lower-cased), beside the rest, inside `within(…, LAST_LEDGER_DEADLINE_MS, () => failed)`; a deleted account (no `account_info`) asks after the header call, for the entry's `domain`. With `NAMES` off neither call is made and `name` is `null`. `header.name = accountNameHeader({ address, entry: result.entries.get(address), liveDomain, toml, network })`; a failed header call → `name` `null` (today's header). The list's call runs inside the list's promise after its rows: `loadNames(api, listAddresses(list), { …, deadlineMs: LIST_DEADLINE_MS − elapsed })`. `listAddresses`: transactions the rows' `what` segments, payments and trades their `counterparty`, the other tabs none.
- **Behind a marker**: one awaited call of the address and the list's rows; `header.name` with `brief: true`; the page data `names` is that call's.
- **Analytics view**: the header's call of the address and the parent (no holdings); in `loadAnalytics`, the counterparties card (its rows' accounts), the balances card (its lines' issuers) and the exchanges card (its pairs' issuers) each call `loadNames` inside their promise with `deadlineMs: deadlineAt − Date.now()`, then build with the map.

- [ ] **Step 1: Write the failing tests.** `account.spec.ts`: the first page makes the header's names call (address, parent, issuers, sorted) and one toml call for `northpeak.example`, and the list's own call; the deleted XRPL account's page asks for its names and no toml (no domain); the deleted Xahau account's asks the toml of `saltmarsh.example` after the names call; a page behind a marker makes one names call and no toml call; with the header's names call failing the page is today's and not stored; with the toml call failing the verified name stays and the page is degraded; `toml not found` is not degraded. `account-analytics.spec.ts`: one names call per card with accounts, none for the others. Unit: `listAddresses` per tab; `analytics-load.test.ts` a card's names call within its deadline (a late one fails the names only, the card is drawn); `balancesCard` a verified issuer's sublabel is its name.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test -- account analytics`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm verify` and `pnpm test:e2e` exit 0.
- [ ] **Step 5: Commit.** `git add app/routes/net.account.\$address.tsx app/server/account-view.ts app/server/account-view.test.ts app/server/analytics-load.ts app/server/analytics-load.test.ts app/server/analytics-view.ts app/server/analytics-view.test.ts test/worker/account.spec.ts test/worker/account-analytics.spec.ts` — `feat(ui): the account page's names and toml calls` (body: two names calls, header and list, so the header never waits for the list; one toml call as soon as the node gives the domain), trailer.

---

### Task 11: The account page header

**Files:**
- Create: `app/ui/components/AccountNameBlock.tsx`
- Modify: `app/ui/pages/AccountPage.tsx` (the header block, the banners after the breadcrumb, the breadcrumb's last item, the providers: the page in `data.names.map`, the list's rows in `list.names.map`, each analytics card in its own), `app/ui/pages/AccountAnalytics.tsx` (the cards' providers), `app/routes/net.account.$address.tsx` (the page in `NamesProvider`), `app/ui/components.css` (`.account-head__name`, `.account-head__kind`, `.disc`, `.toml-facts`: the board's), `app/ui/pages/AccountPage.test.tsx`, `test/unit/account-css.test.ts` if it lists the classes

**Interfaces:**
- Consumes: Task 9 `NameHeader`, `NAME_REQUEST_URL`; Task 5 `NameMark`, `LabelMark`, `NamesProvider`; `ExternalLink`, `DomainStatus`, `Notice`, `CheckIcon`.
- Produces: `AccountNameBlock({ net, address, qr, name }: { net: NetworkId; address: string; qr: QrPicture; name: NameHeader | null })` (the identicon, "Account", the `<h1>`, the address with its buttons and the lines under it; `AccountCard` keeps the activation line and reads `name?.title` to drop its "· domain"), `LabelBanners({ labels }: { labels: readonly LabelBanner[] })`.

Spec 6.1–6.4: the header keeps the identicon and "Account". With a `title`: `<h1 className="account-head__name">` the link text (`text`, ` · network`), `NameMark`, `LabelMark`; under it the address (mono) with `CopyButton` and `QrButton`; then by kind — verified: "Verified name · domain " and the domain as `ExternalLink` `nofollow` (`domainLine.href`), then "How we know"; account: "Named by GateHub · no domain set", or "Named by GateHub · domain {d}" with `DomainStatus` of its state, then the help sentence "GateHub names accounts that have no verified name, such as an exchange's hot wallet. If this name is wrong, or an account you run should have one, ask GateHub to change it." with "ask GateHub to change it" an `ExternalLink` to `NAME_REQUEST_URL` when it is not `null`; domain: the `domainLine.note` sentence. No `title`: today's `<h1>` of the address (with `LabelMark` when labelled), and the activation line's "· domain {d}" with `DomainStatus` of `domainLine.state` (`pending` "not checked yet", `not-verified` with the note as its `title`; `none` text only). The activation line drops its "· domain" when a `title` is drawn. "How we know": `<details className="disc">` closed, `<summary>How we know</summary>`, a list of two passed checks with `CheckIcon` and `<span className="sr">Passed: </span>`: "The account's Domain field is **{d}**." and "{tomlText} lists this address under `[[ACCOUNTS]]`, and its `desc` gives the name." (the file name an `ExternalLink` `nofollow` to `tomlHref`; without `descGivesName`: "…under `[[ACCOUNTS]]`. It gives no `desc`, so the name is the domain."); "Checked {checked}" when set; the facts box "What else that toml says" (`<dl className="toml-facts">`: Principals, Currencies (mono codes, plain text), Last modified "{date} from `[METADATA]`"), each row only when present. Banners: one `Notice tone="warning"` per label above the header section, after the breadcrumb, title "Labelled {label} by GateHub", the description, "Source: {source}" when given, "Details" (`ExternalLink` `nofollow`) when `href`. The breadcrumb's last item is the link text (CSS ellipsis) when there is a title.

- [ ] **Step 1: Write the failing tests** (`AccountPage.test.tsx`, page data from Task 10's builders over the fixed fixture entries): verified (h1 "Northpeak Treasury" with "verified name", the address under it, the domain link with `rel="noopener noreferrer nofollow"`, "How we know" closed (`open` absent) and its two checks and "Checked …" when opened, the facts); named (h1 "Harborline Exchange · hot wallet", "Named by GateHub · no domain set", the help sentence without a link while `NAME_REQUEST_URL` is `null` and with one when a test sets it (module mock)); domain not verified (the domain as h1 with "not verified", the 6.3 sentence, no domain link); no name (today's h1, the activation line's `DomainStatus`); the banner per label with "Source: GateHub" and "Details"; the breadcrumb's last item is the link text; a deleted account keeps the banner.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test -- AccountPage`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm verify` and `pnpm test:e2e` exit 0.
- [ ] **Step 5: Commit.** `git add app/ui/components/AccountNameBlock.tsx app/ui/pages/AccountPage.tsx app/ui/pages/AccountPage.test.tsx app/ui/pages/AccountAnalytics.tsx app/routes/net.account.\$address.tsx app/ui/components.css` (and `test/unit/account-css.test.ts` if changed) — `feat(ui): the account page says the name, the domain and how we know`, trailer.

---

### Task 12: Server-built text: the account's title, description and link preview

**Files:**
- Modify: `app/server/meta-account.ts`, `app/server/meta.test.ts`, `app/server/card-data.ts` (`AccountCardFacts.name?: NameView`), `app/server/card-data.test.ts`, `app/routes/og.$net.$kind.$id[.png].tsx` (`accountImage` names the address), `test/worker/og.spec.ts`

**Interfaces:**
- Consumes: Task 10 page data (`names`, `header.name`); Task 2 `plainNameOf`, `labelWords`; Task 3 `loadNames`.
- Produces: nothing new for later tasks.

Spec §7 (decision 7), for the account page and its card only: `<title>` `Account {plain} ({short}) · {suffix}` when `plainNameOf(names.map[address])` gives one, else today's. Description: "GateHub has labelled this address {labelWords}. " before today's description when labelled, and " Verified by {domain}." or " Named by GateHub." after it when the view has a name of that kind (Ruling 9). Card: `headline` the plain name (text font, `mono: false`) with `parties: [address]`, else the address as today; `note` the parts that apply, joined " · ": "Warning: labelled {labelWords} by GateHub", "Verified by {domain}" or "Named by GateHub", today's "Activated …". The image route calls `loadNames(api, [address], { context, request, features })`; its class stays `slow`. Transaction and ledger titles and cards stay as they are.

- [ ] **Step 1: Write the failing tests.** `meta.test.ts`: the verified account's title `Account Northpeak Treasury (rBbW6i…fQvg) · XRPL · …` (the real short form) and description ending " Verified by northpeak.example."; the labelled named account's title today's and description starting "GateHub has labelled this address advisory."; `NAMES` off: today's. `card-data.test.ts`: headline and parties for a plain name; the note's three parts in order. `og.spec.ts`: the account image makes one names call of the address and stays `slow`; a failed names call draws today's card.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test -- meta card-data og`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm verify` exits 0.
- [ ] **Step 5: Commit.** `git add app/server/meta-account.ts app/server/meta.test.ts app/server/card-data.ts app/server/card-data.test.ts 'app/routes/og.$net.$kind.$id[.png].tsx' test/worker/og.spec.ts` — `feat(ui): the account's title, description and link preview use its name`, trailer.

---

### Task 13: The switch off, end-to-end and accessibility

**Files:**
- Create: `test/worker/names-off.spec.ts`, `test/e2e/names.spec.ts`
- Modify: `test/e2e/a11y.spec.ts`

**Interfaces:**
- Consumes: everything above; the fixed fixture cases of Task 4.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the tests.** `names-off.spec.ts` (`worker-off`): the home, ledger, transaction, account (each tab and the Analytics view), market pair, markets, AMM list and pool, validator, NFT pages and the account image make no `account_names` and no `toml` request, their HTML has no `acct__name`, and a closed ledger and a transaction are stored a year. `names.spec.ts` (skipped when `featuresOff(process.env).has("NAMES")`), on XRPL and Xahau: the active account (verified: h1, "verified name", the address under it, the hover title of an `AccountLink` to it elsewhere, "How we know" opens by keyboard and shows the checks and facts); XRPL's deleted account (named, the advisory banner with "Source: GateHub" and "Details"); Xahau's deleted account (domain not verified, the failed sentence, the scam banner); a transaction page's sentence, flow and details with names and titles; the home table; `it('a reload after a failed names call is a MISS')` (`fixtures.override({ "GET /v2/account_names": unavailable() })`: addresses, and the second load's cache status is `MISS`); `it('the home page keeps its names through a failed beat')`. `a11y.spec.ts` gains the verified account with "How we know" open, the labelled account, the domain-not-verified account and a transaction with names: no axe violation; the links' accessible names include the mark words; the disclosure is reachable and operable by keyboard.
- [ ] **Step 2: Run them.** `pnpm test -- names-off` and `pnpm test:e2e` exit 0; with `E2E_FEATURES_OFF=NAMES` (README "End-to-end tests"), `names.spec.ts` skips and the rest pass.
- [ ] **Step 3: Fix what they find** in the task that owns the code (an earlier task's file), with a test there.
- [ ] **Step 4: Run everything.** `pnpm verify`, `pnpm fixtures:check`, `pnpm test:e2e` exit 0.
- [ ] **Step 5: Commit.** `git add test/worker/names-off.spec.ts test/e2e/names.spec.ts test/e2e/a11y.spec.ts` (and any fix, by name) — `test: display names end to end, accessible, and switched off`, trailer.

---

### Task 14: README, bundle figures and the whole check

**Files:**
- Modify: `README.md` (spec §13: a section "Display names" (the helper, the provider, the marks, the 400 cap, the failures, `NAMED_PAGE_TTL_SECONDS`); "The data API and the node" (`accountNames`, `toml`, `names-load.ts`, `names-shape.ts`, `account-name-view.ts`, `toml-words.ts`); "The cache classes"; "The account page" (the header block, the banner, "How we know", the two calls, the domain line); "Home and ledger pages", "The transaction page", "Account analytics", "The markets pages", "AMM pools", "Validators and amendments", the NFT pages' section (where names show, the call); "SEO and link previews"; "End-to-end tests"; "The client bundle check" (the figures `pnpm check:bundle` prints)), `GLOSSARY.md` (check **Name mark** and **Label mark** are there as the spec words them; add what is missing)

**Interfaces:**
- Consumes: everything above.
- Produces: the docs E10, E11, E13 and E14 read for `AccountLink`, `collectAddresses`, `loadNames` and `NamesProvider`.

- [ ] **Step 1: Measure.** `pnpm build && pnpm check:bundle`: every page within its budget (150,000 B lookup, 160,000 B the validator page); note the account page's and a transaction page's figures.
- [ ] **Step 2: Write the README sections and the figures.**
- [ ] **Step 3: Run the whole check.** `pnpm verify`, `pnpm fixtures:check`, `pnpm test:e2e` exit 0.
- [ ] **Step 4: Review the switch values.** `wrangler.jsonc`: `NAMES` `"on"` at the top level, `"off"` in `sandbox` and `production`.
- [ ] **Step 5: Commit.** `git add README.md GLOSSARY.md` — `docs: display names in the README, and the bundle figures`, trailer. In the hand-back, the deploy summary: **To turn names on in an environment** (sandbox first, then production): that environment's data API serves D4 (`/v2/account_names`, `/v2/toml/{domain}`), D4's seed has run on both networks and `syncer_tomls_due` is near 0 there, and the explorer key's rate limit has room for one or two more calls a page (D4 §15 step 5); then set `NAMES` to `"on"` in that block of `wrangler.jsonc`, commit, and deploy (`pnpm deploy:sandbox` / `deploy:production`). Rolling back is `"off"` and a deploy. The owner still has to give `NAME_REQUEST_URL` (decision 11); until then the help sentence has no link.

---

## Rulings

1. **The paths go straight into `PATHS`.** Spec §2.1 puts them in `PENDING_PATHS` until `pnpm api:sync` brings them; Task 1 syncs from a D4 that is complete, so they are in `api/openapi.yaml` at once and `test/unit/pending-paths.test.ts` would fail on a pending entry.
2. **No names on the network page.** Spec §4.3 names "the network … views' sublabels" among the issuer texts, but §1 (the pages and their calls) has no network page and §12 says the network page "draws no account". The earlier, specific sections win: its sublabels stay short addresses and it makes no names call.
3. **The fixtures' addresses**: spec §10 lists the pages whose addresses get names; the generator takes them from those pages' fixture files in a fixed priority, capped at 500 seeded addresses a network (plus the fixed cases), so the file stays small and every page the tests open is covered. The fixed cases sit on the hand-written accounts and their parents, the only addresses whose pages and links the suites open.
4. **"{E6's reason words}"** in spec 6.3: E6 has whole sentences per reason, not words to put after "could not be read:", so `tomlFailureWords` gives the phrases, from E6's own wording.
5. **`NamesPart` is defined in `app/domain/names.ts`** (browser-safe: pages and the live merge read it) and re-exported by `names-load.ts`, where spec §3.2 introduces it.
6. **The active fixture accounts get a `Domain`** in their node `account_info`: the verified state compares the node's domain with the entry's (spec 6.1), and without one the page would be "domain not verified" or "pending" for the verified fixture.
7. **A named voter keeps its vote.** Spec §4.3 sets `sublabel: shortAddress(address)` for named `BarList` items, but an AMM vote's sublabel is its vote ("votes for 0.5%"); a named vote's sublabel is `{short address} · votes for …`, so neither the address nor the vote is lost.
8. **The page behind a marker** (stored an hour, its header `history`) shows the name, its marks and the label banners only (`brief`): it makes no toml call (spec §5: one call there), so it has no domain state to tell.
9. **The account description's order**: "GateHub has labelled this address …" goes first (a warning leads), today's description follows, and "Verified by {domain}." or "Named by GateHub." ends it.
10. **Task 1 syncs and types only; the fixtures are Task 4**: the brief puts fixture generation in the first task, but E9's fixtures need `collectAddresses` (Task 3) and are a reviewable unit of their own.
