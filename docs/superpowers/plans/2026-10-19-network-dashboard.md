# Network Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `/{net}/network` from real data, drawn with a hand-written chart kit, and build the shared mechanisms (switches, cache generation, `navSection`, `keepLoaded`, the "Cannot GET" rule, `Anchor`, `windowOf`, `typeGroups`, the failure hold, the generalised live refresh) that E3 to E6 reuse as they are.

**Architecture:** The loader makes up to eleven data API calls: two shared with the home page, period calls kept 300 s, and every call behind the failure hold. A pure view builder (`network-view.ts`) turns each call into an independent part of the page data, and `NetworkPage` draws the parts with the chart kit (`app/ui/charts/`). The kit renders SVG and HTML boxes on the server, toggles Chart/Table with CSS only, and adds a hover and keyboard layer after hydration. The page follows the chain with the home page's refresh, generalised into `live-page.ts`, with `keepLoaded` as the merge.

**Tech Stack:** React Router 8.4 (framework mode) on Cloudflare Workers, React 19, TypeScript, `bignumber.js`, Vitest 5 (projects `unit`, `components`, `worker`, and the new `worker-off`), Playwright with axe. The charts are hand-written; no charting library.

**Spec:** `docs/superpowers/specs/2026-10-19-network-dashboard-design.md` (the plan argues from the spec; executors read both). The approved board is `docs/superpowers/specs/2026-10-17-explorer-mock/Network.dc.html`; the other boards set the chart forms of §2.11.

**Branch:** `feat/explorer-pages` of `/Users/golobitch/github.com/GateHubNet/x-explorer`: main (the foundation and the live home page) plus the specs. Nothing else needs to be merged or built first. E2 uses only the data API on `main` (D1 and D2 are not needed), and reads `amm_volume` (from `feat/amm-data`) only through fixtures. The response shapes come from `git -C /Users/golobitch/github.com/GateHubNet/data-api-new show main:docs/api-reference.md` (commit `ff659c9`) and `… show feat/amm-data:docs/api-reference.md` (commit `c3e2302`, for `amm_volume`). Read them that way and never check either out.

**Task numbers (renumbered after the cross-plan review):** Tasks 1 to 7 are unchanged. Old Task 8 is split into Task 8 (the card, the legend, the table view) and Task 9 (the plot frame and the cursor). Old 9 → 10, old 10 → 11, old 11 → 12, old 12 → 13, old 13 → 14, old 14 → 15, old 15 → 16, old 16 → 17, old 17 → 18.

## Global Constraints

- **Page:** `/{net}/network`, route id `routes/net.network`. The document and its `.data` URL are class `live-home` (1 s fresh + 2 s stale). Nothing is streamed or deferred. The node is never called.
- **Subrequests:**
  - #1 `last_validated`, #2 `network/fees?descending=true&limit=8` and #5 `network/fee_stats` are kept `HOME_CALL_TTL_SECONDS` (2 s). #1 and #2 use the home page's very keys.
  - #3 `ledgers/{latest}` is `immutable`; #4 `ledgers/{hash}/validations` is `live` (5 s).
  - #6 to #11 are class `slow`, kept `PERIOD_CALL_TTL_SECONDS = 300`.
  - Every call of the home and network pages passes `holdFailure: true`.
- **Failure hold:**
  - It holds kinds `server`, `timeout`, `network` and `rate_limited`, never `not_found` or `bad_request`.
  - `FAILURE_HOLD_SECONDS = 5`. A 429 is held for its `Retry-After`, at most 30 s.
  - It is per Worker instance, in memory, at most 256 keys (the oldest go first), and never in the Cache API.
- **The route-missing rule:** a 404 whose body's `message` starts with `Cannot GET ` is kind `server`, with the message `data API GET {path} answered 404: Cannot GET … (the data API has no such route)`. Every other 404 stays `not_found`. No other code maps a 404 to "route absent".
- **Card deadline:** 4.5 s from the start of the loader. Past it a card is `failed` with the reason "took too long".
- **Switches:**
  - Values are Worker vars, exactly `"on"` or `"off"`. E2's two are `VALIDATORS` (`validators`) and `AMM_DATA` (`ammData`).
  - Top level: `VALIDATORS: "off"`, `AMM_DATA: "on"`. Staging and production: both `"off"`.
  - `cacheGeneration(env)` is `BUILD_ID:` followed by every switch as `NAME=value`, sorted by name and joined by commas (`test-build:AMM_DATA=on,VALIDATORS=off`). The edge key uses it. The subrequest cache and the pages' `build` keep `BUILD_ID`.
  - Switch names are listed only in `app/ui/features.ts`, `Env`, `wrangler.jsonc` and the pinned test bindings.
- **Running bucket:**
  - `T` is the UTC day of `last_validated.close_time`, never the wall clock.
  - Every time-series chart includes the running bucket, marked "so far" (`forming: true`).
  - Totals include the running bucket. Deltas compare full buckets only, and their words name the window.
- **Exact numbers:**
  - The view builder turns API JSON numbers into strings (`String(n)`, `BigNumber(String(n))`) and does all arithmetic in `bignumber.js`.
  - The kit parses strings with `Number()` for geometry only. Every text a chart shows is made from the strings (`compactNumber`, `formatAmount`).
  - No `Intl`, locale or clock in the kit or the view builder, so hydration matches.
- **Kit:**
  - Hand-written. No charting package and no barrel file.
  - A kit file imports only `react`, the kit's own files, `app/domain/format.ts`, `app/ui/cx.ts` and `app/ui/components/*`, and nothing from `app/server` at run time.
  - Every mark is in the server's HTML. The cursor layer exists only after hydration.
  - Props may grow; files are never forked.
- **Copy and accessibility:**
  - Text never wears a series colour (only `--fg`, `--muted`, `--faint`).
  - Status colours appear only with an icon and text.
  - `LiveStatus` is the page's one `role="status"`. No other `aria-live`.
  - Ages only through `RelativeTime`.
  - WCAG 2.2 AA, with 44 px targets.
- **Live updates:**
  - `useLiveRefresh` is unchanged: a 4 s beat, backoff from 4 to 60 s, a 10 s give-up, and the pause, hold and visibility rules.
  - Under `prefers-reduced-motion: reduce`, only the colours change.
  - Nothing animates on the server's render, on hydration, or on a navigation.
- **SEO:**
  - The default view `/{net}/network` is indexable: a canonical URL, `og:*` and `twitter:card=summary`.
  - Every other view is `noindex, follow`, with no canonical and no `og:*`.
  - No Open Graph image.
- **Source lines:** paths only, never a host or a key.
- **JavaScript budget:** the 150,000 B gzip gate per page stays. The network page's target is 145,000 B or less. The decided fallback is to load `Cursor` and its tooltip with `import()` on the first `pointerenter` or `focusin` of a plot.
- **Fixtures:** new upstream answers are synthetic (seeded mulberry32), written by `pnpm fixtures:sync`, with provenance. They are never edited by hand.
- **Tests:**
  - Iterate with `pnpm test <pattern>`. `pnpm verify` exits 0 before each commit. Run `pnpm test:e2e` when a task touches pages.
  - Worker specs share one Cache API per file: failure tests go first, and each test uses ids and views of its own.
  - A spec that meets held failures fakes `Date` only (`vi.useFakeTimers({ toFake: ["Date"] })`) and moves it past the hold.
- **Deletions:** never delete a file. The only exception is the three `git mv` renames of Task 6. Touch `data-api-new` only through `git show`.
- **Commits:** Conventional Commits (`feat(scope): …`, `refactor(…)`, `test(…)`, `docs: …`). Every message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A beat that comes back with a card failed while the page shows that card loaded** (an `amm_volume` "Cannot GET", a 503 on `stats/type`). Expected: the shown card stays, no error flashes every 4 s, the failing upstream is called at most once per 5 s per instance, and the degraded answer is never stored. Pinned by `keepLoaded` in `app/ui/live-page.test.ts` (Task 6), the hold cases of `test/worker/edge-cache.spec.ts` (Task 3) and `test/worker/network-hold.spec.ts` (Tasks 3 and 17).
2. **Around midnight UTC, and on Mondays.** The running day (and the day before it, in the first hours) has no volume row, and on a Monday the running week has none. Expected: a gap with "… is not computed yet", tiles that say "to Oct 16; Oct 17 not computed yet", and no delta that compares a partial bucket. Pinned by `pendingCount`, `pendingNote` and the Monday and Sunday cases of `windowOf` in `app/domain/window.test.ts` (Task 5), and by the pending and delta cases of `app/server/network-view.test.ts` (Task 14).
3. **An open page's own beats** carry `_routes=routes%2Fnet.network`. Expected: the canonical-query check never answers them with a 302, and any other query that is not canonical gets one 302 to the canonical URL. Pinned by `queryOf` and `parseNetworkParams` in `app/domain/network-params.test.ts` (Task 14) and by the `.data` case of `test/worker/network-page.spec.ts` (Task 17).
4. **A switch flipped by a deploy.** Expected: no page stored under the other value is ever served (the edge key changes), and a misspelt or missing switch is refused before the deploy. Pinned by the cache-generation case of `test/worker/edge-cache.spec.ts` and by `scripts/predeploy-check.test.ts` (Task 1).
5. **Reading the charts without JavaScript, and hydrating them without a mismatch.** Expected: the cached HTML has every mark and both views, the Table radio swaps them by CSS, and the first client render equals the server's. Pinned by the `serverThenHydrated` case every kit component test has: marks in the server HTML, no `role="slider"`, no hydration error (Tasks 8 to 13). Also pinned by the JavaScript-off test of `test/e2e/network-page.spec.ts` (Task 18).

---

### Task 1: Switches and the cache generation

**Files:**
- Create: `app/ui/features.ts`, `app/ui/features.test.ts`, `app/ui/use-network.test.tsx`, `test/worker/features-off.spec.ts`, `test/support/switches.ts`
- Modify:
  - `app/server/env.ts`: the switches in `Env`; `cacheGeneration`.
  - `app/server/networks.ts`: `hasAmm`, `features`.
  - `app/ui/use-network.ts`: `useFeatures`.
  - `app/server/edge-cache.ts`: `edgeCacheKey(url, generation)`; `withEdgeCache` keys with `cacheGeneration(env)`.
  - `scripts/predeploy-guard.ts`: the switch checks.
  - `wrangler.jsonc`: the vars in all three blocks.
  - `vitest.config.ts`: the pinned switches; the `worker-off` project.
  - `tsconfig.node.json`: `include` gains `app/ui/features.ts`, which the guard imports.
  - `README.md`: "Configuration" gains "Switches"; "The client bundle check" gains the baseline before E2.
- Modify the ten hand-built `Env` literals, which `tsc` checks because `tsconfig.cloudflare.json` includes `test/**`. Each gains `...allSwitches("off")`, with `AMM_DATA: "on"` after it where the test needs the top level's values:
  - `app/server/{env,clients,capture,networks,network-route}.test.ts`;
  - `test/worker/{edge-cache,upstream,data-api,node-rpc,route-headers}.spec.ts` (`baseEnv` in `edge-cache` and `route-headers`).
  - `test/worker/entry.spec.ts` spreads the runtime's `env` and needs nothing.
- Modify (`edgeCacheKey(url, env.BUILD_ID)` becomes `edgeCacheKey(url, cacheGeneration(env))`): `test/support/pages.ts:43`, `test/worker/edge-cache.spec.ts`, `test/worker/og.spec.ts:55`
- Test: the files above, plus `scripts/predeploy-check.test.ts`

**Interfaces:**
- Produces `app/ui/features.ts`: spec §6.1's block, verbatim, with E2's two names only: `FEATURE_VARS = ["VALIDATORS", "AMM_DATA"] as const`; `FeatureVar`; `FEATURE_NAME = { VALIDATORS: "validators", AMM_DATA: "ammData" } as const satisfies Record<FeatureVar, string>`; `Feature`; `Features = Readonly<Record<Feature, boolean>>`; `NO_FEATURES: Features` (frozen); `featuresOf(vars: Readonly<Partial<Record<FeatureVar, unknown>>>): Features`. The file is pure: no React, no server import.
- Produces `app/server/env.ts`: `Env` gains `VALIDATORS: "on" | "off"; AMM_DATA: "on" | "off";`, and `export function cacheGeneration(env: Env): string`.
- Produces `app/server/networks.ts`: `Network` gains `hasAmm: boolean` (`xrpl` true, `xahau` false, set in `NETWORKS`) and `features: Features` (`networkOf` sets `featuresOf(env)`). `PublicNetwork` (an `Omit` of the URLs) carries both to the browser.
- Produces `app/ui/use-network.ts`: `export function useFeatures(): Features`. It reads `network.features` of the `/:net` layout's data, returns `NO_FEATURES` without it, and never throws.
- Produces `app/server/edge-cache.ts`: `export function edgeCacheKey(url: string, generation: string): string`. Only the parameter is renamed; the format is the same.
- Produces `vitest.config.ts`: the `worker` project (which excludes `test/worker/**/*-off.spec.ts`) and the `worker-off` project (only `test/worker/**/*-off.spec.ts`, every `FEATURE_VARS` entry `"off"`, derived from `FEATURE_VARS`).
- Produces `test/support/switches.ts`: `export function allSwitches(value: "on" | "off"): Record<FeatureVar, "on" | "off">`, built from `FEATURE_VARS`. It imports only `app/ui/features.ts`, so the Node config follows it from `scripts/predeploy-check.test.ts` too.
- **How a later plan adds a switch** (E3 `MARKETS`, E4 `ACCOUNT_ANALYTICS`, E5 `AMM_PAGES`). The complete recipe:
  1. Append the name LAST to `FEATURE_VARS`, and its key LAST to `FEATURE_NAME`; `Object.keys(FEATURE_NAME)` must equal `FEATURE_VARS`.
  2. Add the field to `Env` (`NAME: "on" | "off"`).
  3. Add an entry to every block of `wrangler.jsonc` (top level, `staging`, `production`).
  4. Add it to `TOP_LEVEL_SWITCHES` in `vitest.config.ts` (its `satisfies Record<FeatureVar, …>` fails until you do). The `worker-off` project derives itself.
  5. The ten hand-built `Env`s get it by `...allSwitches("off")`.
  6. The passing staging and production configs in `scripts/predeploy-check.test.ts` get it as `"off"` by `...allSwitches("off")`.
  7. The expectations of `features.test.ts`, `env.test.ts`, `networks.test.ts`, `edge-cache.spec.ts` (`__build=`) and `features-off.spec.ts` are built from `FEATURE_VARS` and `allSwitches` (Step 1), so they follow.
  8. Add the switch's row to README "Switches".
  9. Write the switch's own tests: a guard case that refuses the misspelt name, and its `-off.spec.ts` case.
  - Because Task 1 builds them on `allSwitches` and `FEATURE_VARS`, steps 5 to 7 need **no edit** in these files: the ten `Env` files, `scripts/predeploy-check.test.ts`, `app/ui/features.test.ts`, `app/server/env.test.ts`, `app/server/networks.test.ts`, `test/worker/edge-cache.spec.ts` and `test/worker/features-off.spec.ts`.
  - A later switch edits only `app/ui/features.ts`, `app/server/env.ts`, `wrangler.jsonc`, `vitest.config.ts`, the README row and its own tests.

- [ ] **Step 0: Record the bundle baseline, before any change.**
  1. Run `pnpm build && pnpm check:bundle`.
  2. Note the four page figures, the `gzip -9` size of `build/client/assets/manifest-*.js` (`gzip -9 -c build/client/assets/manifest-*.js | wc -c`), and the shared base. The shared base is the summed `gzip -9` size of the files that every page of `checkBundle("build/client").pages` loads (their intersection), computed with a one-off `pnpm exec tsx -e "…"` that imports `checkBundle` from `scripts/bundle-budget.ts`.
  3. Write the figures into README "The client bundle check" as a line "Before the network page (E2, at `<short commit>`): …". Task 18 adds the "after" line.
- [ ] **Step 1: Write the failing tests.**
  Every expectation below is built from `FEATURE_VARS`, `FEATURE_NAME` and `allSwitches`, never from a literal list of names, so that a later switch needs no edit here.
  - `app/ui/features.test.ts`:
    - `featuresOf(allSwitches("on"))` has every value of `FEATURE_NAME` set to `true`.
    - `featuresOf(allSwitches("off"))` and `featuresOf({})` equal `NO_FEATURES`, which has every value `false`.
    - Each name set to `"ON"`, `"yes"` or `true` reads as off.
    - `Object.isFrozen(NO_FEATURES)`.
    - `Object.keys(FEATURE_NAME)` equals `FEATURE_VARS`.
  - `app/server/env.test.ts`:
    - With `env = { …, BUILD_ID: "test-build", ...allSwitches("off"), AMM_DATA: "on" }`, `cacheGeneration(env)` equals `"test-build:" + [...FEATURE_VARS].sort().map((n) => \`${n}=${env[n]}\`).join(",")`, matches `/^test-build:[A-Z_]+=(on|off)(,[A-Z_]+=(on|off))*$/`, and contains `AMM_DATA=on` and `VALIDATORS=off`. With E2's two switches that is `test-build:AMM_DATA=on,VALIDATORS=off`.
    - Flipping `AMM_DATA` changes it.
    - Each `FEATURE_VARS` name appears in it exactly once.
  - `app/server/networks.test.ts`: the `toEqual`s gain `hasAmm: true, features: { ...featuresOf(allSwitches("off")), ammData: true }` for `xrpl` (env with `AMM_DATA: "on"`), and `hasAmm: false` for `xahau`. `networkOf("xrpl", { ...env, VALIDATORS: "on" }).features.validators` is `true`.
  - `app/ui/use-network.test.tsx`: under a data router whose layout route has id `routes/net` and loader data `{ network: { …, features: { validators: true, ammData: false } } }`, a component's `useFeatures()` returns those. Without the layout it returns `NO_FEATURES` and does not throw.
  - `scripts/predeploy-check.test.ts`:
    - The passing staging and production configs gain `...allSwitches("off")`.
    - Each of these is refused, with a problem that names the var and says `"on" or "off"`: `AMM_DATA` missing; `VALIDATORS: "yes"`; `MARKET: "on"` (a var that is no switch).
    - All three in one config give three problems.
  - `test/worker/edge-cache.spec.ts`:
    - Replace "includes the build ID in the key" with "includes the cache generation in the key". A page stored with `harness({ AMM_DATA: "on" })` is a `MISS` for `harness({ AMM_DATA: "off" })`, and a `HIT` for the same values.
    - `edgeCacheKey(url, cacheGeneration(h.env))` contains `` `__build=${encodeURIComponent(cacheGeneration(h.env))}` ``. With E2's switches that is `__build=test-build%3AAMM_DATA%3Don%2CVALIDATORS%3Doff`.
    - A value stored by `createSubrequestCache(ctx, "test-build").json(key, "live", load)` is read back by a cache made for the other switch value, with no second `load`: subrequest keys keep `BUILD_ID`.
  - `test/worker/features-off.spec.ts` (`worker-off` project): for each name of `FEATURE_VARS`, `env[name]` is `allSwitches("off")[name]`. `cacheGeneration(env)` is `"test-build:" + [...FEATURE_VARS].sort().map((n) => \`${n}=off\`).join(",")`, which for E2 is `test-build:AMM_DATA=off,VALIDATORS=off`.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/features app/server/env app/server/networks app/ui/use-network scripts/predeploy test/worker/edge-cache test/worker/features-off`. Expected: missing modules and exports, and an unknown project `worker-off`.
- [ ] **Step 3: Implement.**
  - `featuresOf`: `vars[name] === "on"` for each name.
  - `cacheGeneration`: `${env.BUILD_ID}:` followed by the sorted `FEATURE_VARS` as `NAME=${env[NAME]}`, joined by `,`.
  - `edge-cache.ts` imports `cacheGeneration` from `./env`. `env.ts` already imports from `edge-cache.ts`. The cycle is safe because neither module uses the other's exports at load time. Keep it that way.
  - `deployProblems` gains, in this order:
    - every `FEATURE_VARS` name missing from `vars`;
    - every one whose value is not exactly `"on"` or `"off"`;
    - every other var whose value is `"on"` or `"off"` ("not a switch; the switches are VALIDATORS, AMM_DATA: a misspelt one?").
  - `vitest.config.ts`:
    - `const TOP_LEVEL_SWITCHES = { VALIDATORS: "off", AMM_DATA: "on" } satisfies Record<FeatureVar, "on" | "off">;` merged into `testBindings`.
    - A second project `worker-off`: the same `cloudflareTest`, `reactRouter()` and `resolve`, `name: "worker-off"`, bindings `{ ...testBindings, ...Object.fromEntries(FEATURE_VARS.map((name) => [name, "off"])) }`, `include: ["test/worker/**/*-off.spec.ts"]`, and the same `css` and `deps` as `worker`.
  - README "Switches":
    - the §6.1 table;
    - the values per environment: at the top level, `VALIDATORS` off until E6 and `AMM_DATA` on; in staging and production, both off;
    - the conditions for turning them on in staging and production. `AMM_DATA`: the environment's data API has merged `feat/amm-data`, re-ingested and back-filled, and D2b is deployed (`syncer_markets_live_amm_share_known` = 1). `VALIDATORS`: E6.
    - A switch is never set in the Cloudflare dashboard.
- [ ] **Step 4: Run the tests to verify they pass.** Run the command of Step 2, then `pnpm test --project worker-off`, then `pnpm verify`. Expected: all pass, and `pnpm verify` exits 0.
- [ ] **Step 5: Commit.** `git add -A app/ui/features.ts app/ui/features.test.ts app/ui/use-network.ts app/ui/use-network.test.tsx app/server scripts/predeploy-guard.ts scripts/predeploy-check.test.ts wrangler.jsonc vitest.config.ts tsconfig.node.json test/support/pages.ts test/support/switches.ts test/worker README.md`, with the message `feat(switches): VALIDATORS and AMM_DATA as per-environment Worker variables, folded into the edge cache key`.

### Task 2: `navSection` and the header's Network link

**Files:**
- Modify: `app/ui/route-handle.ts`, `app/ui/components/Header.tsx`
- Test: `app/ui/components/components.test.tsx` ("Header and Shell")

**Interfaces:**
- Consumes (Task 1): `useFeatures(): Features`, `type Feature`.
- Produces in `app/ui/route-handle.ts`:
  - `export type NavSection = "network";`
  - `interface NetworkRouteHandle { heroSearch?: boolean; navSection?: NavSection }`
  - `export function navSectionOf(matches: readonly UIMatch[]): NavSection | undefined`: the `navSection` of the deepest match that names one.
- Produces in `Header.tsx`, the items `{ label: string; to?: (net: NetworkBrief) => string; section?: NavSection; feature?: Feature }`:
  - Ledgers and Transactions as today.
  - Network: `{ to: (net) => \`/${net.id}/network\`, section: "network" }`.
  - Markets and AMM have no `to` yet, so they are always the "soon" label.
  - An item with a `feature` whose value in `useFeatures()` is false is "soon" too.
- How E3 and E5 grow this. Later header items keep this shape, `{ label, to?, section?, feature? }`: a link is an item with a `to`.
  - E3 gives Markets `to: (net) => \`/${net.id}/markets\``, `section: "markets"`, `feature: "markets"`, and widens `NavSection` to `"network" | "markets"`. E3's Task 4 replaces this task's "Markets is soon with `features` all true" case.
  - E5 does the same for AMM (`to: /{net}/amm`, `section: "amm"`, `feature: "ammPages"`). E5's Task 15 replaces the AMM case.

- [ ] **Step 1: Write the failing tests** in "Header and Shell". Render `<Header net={XRPL} />` in a memory data router whose matched route carries `handle`.
  - At `/xrpl/network`, under a route with `handle: { navSection: "network" }`: the link "Network" has `href="/xrpl/network"`, `aria-current="page"` and the class `is-current`. At `/xrpl/network?period=1y` it is still `"page"`.
  - At `/xrpl/validators`, with the same handle on that route: `aria-current="true"` and `is-current`.
  - At `/xrpl/ledger/1` with no handle: Network is a plain link, with neither.
  - When a parent route says `network` and the deepest route says nothing, the section is `network`. `navSectionOf([])` is `undefined`.
  - Markets and AMM are `.nav-item.is-soon` with the text "soon", both without the layout's data and with `features` all true. These are two separate cases, one per item, so that E3 and E5 can each replace their own.
  - Ledgers and Transactions keep their hrefs.
- [ ] **Step 2: Run it to verify it fails.** `pnpm test app/ui/components/components`. Expected: Network is a "soon" span; there is no `navSectionOf` export.
- [ ] **Step 3: Implement `navSectionOf` and the items.** The header reads `useMatches()`, `useLocation()` and `useFeatures()`. It gives `aria-current="page"` when `location.pathname` equals the item's href without its query, and `"true"` on any other page of the section.
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm test app/ui`, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/ui/route-handle.ts app/ui/components/Header.tsx app/ui/components/components.test.tsx`, with the message `feat(header): Network links to the network page; a route's navSection marks the current section`.

### Task 3: The route-missing rule and the failure hold

**Files:**
- Create: `test/worker/network-hold.spec.ts` (a file of its own: it needs a fresh isolate). This task writes the home page's cases; Task 17 adds the network page's.
- Modify:
  - `app/server/cache-class.ts`: `SubrequestOptions`, the hold constants, the fifth parameter of `json`.
  - `app/server/edge-cache.ts`: the hold, in `createSubrequestCache`.
  - `app/server/data-api.ts`: `throwUnlessOk`, `FreshOptions.holdFailure`, and `holdFailure` in `ledger`'s options.
  - `app/routes/net._index.tsx`: all four calls opt in.
  - `test/support/subrequest-cache.ts`: `CacheCall` gains `holdFailure?: true`, which `recordingCache` records.
  - `test/support/upstream-core.ts`: `dataApiAbsent`, only if Step 4 shows it is needed.
  - `README.md`: "The cache classes" gains the hold; "The data API and the node" gains the rule; "Upstream fixtures" says the catch-all is now an outage.
- Test: `test/worker/data-api.spec.ts`, `test/worker/edge-cache.spec.ts`, `app/server/cache-class.test.ts`, `test/worker/network-hold.spec.ts`

**Interfaces:**
- Produces in `app/server/cache-class.ts`:
  - `export interface SubrequestOptions { holdFailure?: boolean }`
  - `SubrequestCache.json<T>(key: string, cls: CacheClass, load: () => Promise<T>, ttlOverride?: number, opts?: SubrequestOptions): Promise<T>`
  - `export const FAILURE_HOLD_SECONDS = 5; export const FAILURE_HOLD_MAX_SECONDS = 30; export const FAILURE_HOLD_KEYS = 256;`
- Produces in `app/server/data-api.ts`:
  - `export interface FreshOptions { ttl?: number; holdFailure?: boolean }`
  - Every `ledger` overload's options gain `holdFailure?: boolean`.
  - `lastValidated`, `transactions`, `fees` and `ledger` pass `{ holdFailure }` to `cache.json`. `holdFailure` is never part of a key.
- How later plans grow this: E3 passes `holdFailure` from `node-rpc.ts`'s `call` as the same fifth argument; E4 adds `shareInFlight?: boolean` to `SubrequestOptions`.

- [ ] **Step 1: Write the failing tests.**
  - `test/worker/data-api.spec.ts`, "errors":
    - A 404 `{ result: "error", message: "Cannot GET /v2/network/amm_volume?interval=day" }` is `UpstreamError` kind `server`, status 404, with the message `data API GET /v2/network/amm_volume?interval=day answered 404: Cannot GET /v2/network/amm_volume?interval=day (the data API has no such route)`.
    - 404s with `ledger not found`, `Account not found` and `validation not found` stay `not_found`.
    - Through `createSubrequestCache`, two `lastValidated()` calls answered "Cannot GET" make two requests (nothing stored). With `{ holdFailure: true }` they make one, and both throw.
  - `test/worker/data-api.spec.ts`, "cache": with `recordingCache()`, `lastValidated({ ttl: 2, holdFailure: true })`, `fees(q, { holdFailure: true })`, `transactions(q, { holdFailure: true })` and `ledger("1", { holdFailure: true })` record `holdFailure: true`. The same calls without the option record none.
  - `test/worker/edge-cache.spec.ts`, describe "the failure hold" (fake `Date`; a fresh key per case; `load` is a `vi.fn` that throws):
    - A `new UpstreamError("server")` loaded with `{ holdFailure: true }`: a second call at +4,999 ms throws the same error object, and `load` ran once. At +5,001 ms `load` runs again.
    - `new UpstreamError("rate_limited", "x", { retryAfter: 12 })` is still held at +11,999 ms and loads at +12,001 ms. `retryAfter: 90` is held 30 s.
    - `not_found` and `bad_request` are never held. A `TypeError` is never held.
    - A failing call without the option holds nothing for a later call with it.
    - After 257 failing keys the first key loads again and the 257th is still held.
    - After a held failure of key K, a call of K without the option loads and stores an answer. A later call of K with the option returns that stored answer while the hold lasts.
  - `app/server/cache-class.test.ts`: the three constants are 5, 30 and 256.
  - `test/worker/network-hold.spec.ts` (fake `Date`, moved 31 s on after each test, so no test meets an earlier one's hold; `mockUpstream`): with `"GET /v2/last_validated": dataApiError(503, "unavailable")`, two `/xrpl` renders 1 s apart both answer 503, and `statusesOf(mock, "GET /v2/last_validated")` is `[503]`. At +6 s a third render calls it again (`[503, 503]`).
- [ ] **Step 2: Run them to verify they fail.** `pnpm test test/worker/data-api test/worker/edge-cache test/worker/network-hold app/server/cache-class`. Expected: "Cannot GET" is `not_found`; nothing is held.
- [ ] **Step 3: Implement.**
  - `throwUnlessOk` makes the rule's error when `status === 404` and the reason starts with `Cannot GET `.
  - `createSubrequestCache`:
    - The module-level `Map<string, { error: UpstreamError; until: number }>`, keyed by the subrequest key the client gives (so `[kept N s]` keys are their own).
    - The order is: read the Cache API; then, with `holdFailure`, throw a held error whose `until > Date.now()`; then `load()`. This order applies on the `ttl ≤ 0` path too.
    - A held kind thrown by `load` with `holdFailure` is remembered: delete the key, then set it at the end, then evict from the front past 256.
  - The home loader calls `lastValidated`, `fees` and `transactions` with `{ ttl: HOME_CALL_TTL_SECONDS, holdFailure: true }`, and `ledger(…, { holdFailure: true })`.
- [ ] **Step 4: Run the suites with the rule in.** Run `pnpm test --project worker` and `pnpm test:e2e`. A test may fail because a path with no fixture is now an outage where it relied on a `not_found`. For each such failure, give that path its API's own not-found body in `dataApiAbsent` (`test/support/upstream-core.ts`), as ledgers, transactions and accounts have now. Never weaken the rule. The `null` override keeps meaning the API's "Cannot GET".
- [ ] **Step 5: Run the tests to verify they pass.** Run the command of Step 2, then `pnpm verify` and `pnpm test:e2e`.
- [ ] **Step 6: Commit.** `git add app/server app/routes/net._index.tsx test/support test/worker README.md`, with the message `feat(data-api): a route the API lacks is an outage, and the failures of polled calls are held 5 s`.

### Task 4: The data API calls of the dashboard

**Files:**
- Create: `app/server/pending-paths.ts`, `app/server/aggregate-shape.ts`, `app/server/aggregate-shape.test.ts`, `test/unit/pending-paths.test.ts`
- Modify:
  - `app/server/api-types.ts`
  - `app/server/data-api.ts`
  - `app/server/cache-class.ts`: `PERIOD_CALL_TTL_SECONDS`, and the `live-home` comment, which lists "the home page, the network page, and their `.data` URLs".
  - `tsconfig.node.json`: `include` gains `app/server/pending-paths.ts`.
  - `README.md`: the `live-home` row of "The cache classes" names the network page; the client's new methods.
- Test: `test/worker/data-api.spec.ts`, `app/server/aggregate-shape.test.ts`, `test/unit/pending-paths.test.ts`, `app/server/cache-class.test.ts`

**Interfaces:**
- Consumes (Task 3): `FreshOptions`, `SubrequestOptions`.
- Produces `app/server/pending-paths.ts`, which has no imports: `export const PENDING_PATHS = { ammVolume: "/v2/network/amm_volume" } as const;`. `get()` accepts a template from `PATHS` or `PENDING_PATHS`. E3, E4, E5 and E6 add their entries here.
- Produces `PATHS` entries (each is in `openapi.d.ts`): `feeStats: "/v2/network/fee_stats"`, `stats: "/v2/stats/{family}"`, `paymentVolume: "/v2/network/payment_volume"`, `exchangeVolume: "/v2/network/exchange_volume"`, `ledgerValidations: "/v2/ledgers/{ledger_hash}/validations"`.
- Produces `export const PERIOD_CALL_TTL_SECONDS = 300;` in `cache-class.ts`.
- Produces these `api-types.ts` types, from the references above:

```ts
export interface FeeBucketRow { avg: number; max: number; min: number; total: number; tx_count: number; date: string }   // interval=day|hour: date is the bucket start
export interface FeeStatsRow {
  current_ledger_size: number; current_queue_size: number; date: string; expected_ledger_size: number;
  median_fee: number; minimum_fee: number; open_ledger_fee: number; pct_max_queue_size: number;
}
/** A flat row of `/v2/stats/{family}`: the bucket start, and a JSON number per name (zero counts left out). */
export type StatsRow = { date: string } & Record<string, number | string>;
export interface AssetRef { currency: string; issuer?: string }
export interface PaymentVolumeComponent { currency: string; issuer?: string; amount: string; count: number; rate: string; converted_amount: string }
export interface ExchangeVolumeComponent { count: number; rate: string; amount: string; base: AssetRef; counter: AssetRef; converted_amount: string }
export interface AmmVolumeComponent { amm_account: string; base: AssetRef; counter: AssetRef; count: number; amount: string; rate: string; converted_amount: string }
export interface VolumeRow<C> { components: C[]; count: number; exchange: AssetRef; total: string; exchange_rate: string; start_time: string; end_time: string }
export interface Validation {
  count: number; first_datetime: string; flags: string; last_datetime: string; ledger_hash: string; ledger_index: string;
  signing_time: string; validation_public_key: string;
  amendments?: string; base_fee?: string; ephemeral_public_key?: string; full?: string; load_fee?: string;
  reporter_public_key?: string; reserve_base?: string; reserve_inc?: string; signature?: string;
}
export interface LedgerValidations { result: "success"; ledger_hash: string; count: number; marker?: string; validations: Validation[] }
```

- Produces these `DataApi` methods. A query is sent in the order its type lists its fields. `exchangeCurrency` and `exchangeIssuer` are sent as `exchange_currency` and `exchange_issuer`.

| Method | Class | Returns |
|---|---|---|
| `fees(q: { descending: boolean; limit: number }, opts?)` | `live`, as today | `Page<"rows", FeeRow>` |
| `fees(q: { interval: "day"; start: string; end: string; limit: number }, opts?)` | `slow` | `Page<"rows", FeeBucketRow>` |
| `feeStats(q: { descending: boolean; limit: number; start: string }, opts?)` | `live` | `Page<"rows", FeeStatsRow>` |
| `stats(family: "type" \| "metric", q: StatsQuery, opts?)` | `slow` | `Page<"stats", StatsRow>` |
| `paymentVolume(q: VolumeQuery, opts?)` | `slow` | `Page<"rows", VolumeRow<PaymentVolumeComponent>>` |
| `exchangeVolume(q: VolumeQuery, opts?)` | `slow` | `Page<"rows", VolumeRow<ExchangeVolumeComponent>>` |
| `ammVolume(q: VolumeQuery, opts?)` (path in `PENDING_PATHS`) | `slow` | `Page<"rows", VolumeRow<AmmVolumeComponent>>` |
| `ledgerValidations(hash: string, q: { limit: number }, opts?)` | `live` | `LedgerValidations` |

  - `opts` is `FreshOptions` throughout.
  - `StatsQuery = { interval: "day" | "week"; start: string; end: string; limit: number; metrics?: readonly string[] }`. `metrics` is sent joined by `,`.
  - `VolumeQuery = { interval: "day" | "week"; start: string; end: string; limit: number; exchangeCurrency?: string; exchangeIssuer?: string }`.
  - E5 adds `ammVolume`'s live form.
- Produces in `app/server/aggregate-shape.ts` (pure; each check throws `UpstreamError("server", …, { status: 200 })`):
  - `isDecimalText(v: unknown): v is string`, which accepts `/^-?\d+(\.\d+)?$/`.
  - `isIsoTime(v: unknown): v is string`, which accepts `YYYY-MM-DDTHH:mm:ss(.SSS)?Z`.
  - `checkStatsPage`, `checkFeeBucketPage`, `checkFeeStatsPage`, `checkVolumePage(kind: "payment" | "exchange" | "amm")`, `checkValidations`. Each takes the whole body (`unknown`) and returns it typed.
- Restructures `get()`: its trailing positional parameters become one options object, `{ unwrap?: string; finish?: (value) => T; ttl?: number; holdFailure?: boolean }`. `finish` runs on the whole body when there is no `unwrap`, inside the cached load.

- [ ] **Step 1: Write the failing tests.**
  - `test/worker/data-api.spec.ts`, "requests": each new method fetches exactly the path and query below (assert `new URL(url).pathname + search`).
    - `stats("type", { interval: "day", start: "2026-09-18", end: "2026-10-17", limit: 1000 })` fetches `/v2/stats/type?interval=day&start=2026-09-18&end=2026-10-17&limit=1000`.
    - The same with `"metric"` and `metrics: ["accounts_created", "ledger_count", "transaction_count"]` ends `&metrics=accounts_created%2Cledger_count%2Ctransaction_count`.
    - `fees({ interval: "day", start: "2026-09-18", end: "2026-10-17", limit: 1000 })` fetches `/v2/network/fees?interval=day&start=2026-09-18&end=2026-10-17&limit=1000`. `fees({ descending: true, limit: 8 })` still fetches `/v2/network/fees?descending=true&limit=8`.
    - `feeStats({ descending: true, limit: 1, start: "2026-10-17" })` fetches `/v2/network/fee_stats?descending=true&limit=1&start=2026-10-17`.
    - `paymentVolume({ interval: "week", start: "2024-10-14", end: "2026-10-17", limit: 1000, exchangeCurrency: "USD", exchangeIssuer: "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq" })` fetches `/v2/network/payment_volume?interval=week&start=2024-10-14&end=2026-10-17&limit=1000&exchange_currency=USD&exchange_issuer=rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq`. The same holds for `exchangeVolume` and `ammVolume` on their paths.
    - `ledgerValidations("68A33146F46A7B154CACA4034837D9A7AFEC0C46F7D963D6FD61F5CF87DAD092", { limit: 1000 })` fetches `/v2/ledgers/68A3…D092/validations?limit=1000`.
  - "cache": with `recordingCache()`, the classes are `slow` (stats, interval fees, the three volumes) and `live` (feeStats, ledgerValidations). With `{ ttl: PERIOD_CALL_TTL_SECONDS }`, `ttlOverride` is 300 and the key ends `[kept 300 s]`. Through the real cache the stored `Cache-Control` is `public, max-age=300`.
  - "an answer that is not what the reference promises": each is `server` and not stored (a second call fetches again):
    - `stats` is not a list;
    - a stats row with `"Payment": "12"`;
    - a stats row whose `date` is not ISO;
    - a volume row whose `total` is `12.5` (a number);
    - a payment component whose `converted_amount` is `"1e3"`;
    - fee_stats `open_ledger_fee: "0.00001"`;
    - a validation without `validation_public_key`;
    - `validations` is not a list.
  - `app/server/aggregate-shape.test.ts`: each checker accepts the reference's own example (copied from the api-reference sections "Network", "Validations" and "Stats") and rejects each defect above.
  - `test/unit/pending-paths.test.ts`: for each `[name, path]` of `PENDING_PATHS`, `api/openapi.yaml` does not contain `  "${path}":`. On failure the message reads `move "${name}" from PENDING_PATHS to PATHS in app/server/data-api.ts`. A second case runs the same check on a YAML string that has the path, and sees it fail.
  - `app/server/cache-class.test.ts`: `PERIOD_CALL_TTL_SECONDS` is 300.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test test/worker/data-api app/server/aggregate-shape test/unit/pending-paths app/server/cache-class`.
- [ ] **Step 3: Implement** the types, the checks, the methods, the overloads of `fees`, and `get`'s options object. The existing calls keep their keys and classes.
- [ ] **Step 4: Run the tests to verify they pass.** Run the command of Step 2, then `pnpm verify`. `pnpm api:check` and `pnpm typecheck` pass with `amm_volume` outside `PATHS`.
- [ ] **Step 5: Commit.** `git add app/server tsconfig.node.json test/unit/pending-paths.test.ts test/worker/data-api.spec.ts README.md`, with the message `feat(data-api): stats, fee snapshots, daily fees, volumes and validations, checked before they are kept`.

### Task 5: Shared domain modules: windows, anchor, type groups, tokens

**Files:**
- Create: `app/domain/window.ts`, `app/domain/window.test.ts`, `app/domain/type-groups.ts`, `app/domain/type-groups.test.ts`, `app/domain/fnv.ts`, `app/domain/fnv.test.ts`, `app/server/anchor.ts`, `app/server/anchor.test.ts`
- Modify: `app/domain/format.ts` (`formatUtcDay`), `app/domain/format.test.ts`, `tsconfig.node.json` (`include` gains `app/domain/window.ts`, `app/domain/fnv.ts` and `app/domain/format.ts`, which the fixture generator imports)
- Test: the four new test files and `app/domain/format.test.ts`

**Interfaces:**
- Produces `app/domain/format.ts`: `export function formatUtcDay(day: string, withYear = false): string`. It turns `"2026-10-17"` into `"Oct 17"`, or `"Oct 17, 2026"` with the year, from a fixed table of month names. No `Intl`.
- Produces `app/domain/window.ts`: spec §6.6's block, verbatim (`WindowPeriod`, `PeriodWindow`, `windowOf`, `utcDayOf`). The `full` and `previous` ranges are inclusive day bounds: `start` is their first bucket, and `end` is the last day they cover (a Sunday for weeks). Additions:
  - `export function bucketStarts(start: string, end: string, unit: "day" | "week"): string[]`: the bucket starts from `start` up to and including the bucket that holds `end`.
  - `export function pendingCount(buckets: readonly string[], present: ReadonlySet<string>): number`: the newest buckets without a row, counted back from the last, at most 2.
  - `export function pendingNote(buckets: readonly string[], pending: number, unit: "day" | "week"): string | null`: "Oct 17 is not computed yet.", "Oct 16 and Oct 17 are not computed yet.", "The week of Oct 19 is not computed yet.", or `null` for 0.
- Produces `app/domain/fnv.ts`:
  - `export function fnv1a32(text: string): number`
  - `export function tokenOf(value: unknown): string`: `fnv1a32(JSON.stringify(value))` as 8 lower-case hex digits.
  - These are the FNV-1a of spec §2.9. E3 and E6 use them, and the fixture generators seed with them.
- Produces `app/domain/type-groups.ts`: spec §6.7's block, verbatim (`TypeGroup`, `typeGroups`, `groupCounts`, `typeGroupsNote`). Group ids are the labels (`"Payment"`, `"OfferCreate"`, `"OfferCancel"`, `"TrustSet"`, `"AMM"`, `"Invoke"`, `"ClaimReward"`, `"URIToken"`, `"SetHook"`), except Other, whose id is `"other"` and label `"Other"`. Sums are exact (`bignumber.js`).
- Produces `app/server/anchor.ts`: spec §6.5's block, verbatim (`Anchor`, `anchorOf`). It is type-imported by the browser.

- [ ] **Step 1: Write the failing tests.**
  - `windowOf("2026-10-17", "30d")`:
    - 30 buckets, from `"2026-09-18"` to `"2026-10-17"`;
    - `start` `"2026-09-18"`, `end` `"2026-10-17"`, `unit` `"day"`;
    - `full` `{ start: "2026-09-17", end: "2026-10-16" }`, `previous` `{ start: "2026-08-18", end: "2026-09-16" }`;
    - `note` `"the 30 days from Sep 18 to Oct 17, 2026 (UTC), today so far"`.
  - `"7d"`: buckets from `"2026-10-11"`, `full` `{ "2026-10-10", "2026-10-16" }`, `previous` `{ "2026-10-03", "2026-10-09" }`.
  - `"90d"`: buckets from `"2026-07-20"`, `full.start` `"2026-07-19"`, `previous` `{ "2026-04-20", "2026-07-18" }`.
  - `"1y"`:
    - `unit` `"week"`, 52 buckets, from `"2025-10-20"` to `"2026-10-12"`;
    - `start` `"2025-10-20"`, `end` `"2026-10-17"`;
    - `full` `{ "2025-10-13", "2026-10-11" }`, `previous` `{ "2024-10-14", "2025-10-12" }`;
    - `note` `"the 52 weeks from the week of Oct 20, 2025 to the week of Oct 12, 2026 (UTC, weeks from Monday), this week so far"`.
  - `T` on a Monday (`"2026-10-12"`, `1y`): the last bucket is `"2026-10-12"` and `full.end` `"2026-10-11"`. On a Sunday (`"2026-10-18"`): the last bucket is `"2026-10-12"`.
  - `T` across a year (`windowOf("2027-01-05", "30d").note`): `"the 30 days from Dec 7, 2026 to Jan 5, 2027 (UTC), today so far"`.
  - `utcDayOf(1792281599)` is `"2026-10-17"` and `utcDayOf(1792281600)` is `"2026-10-18"`.
  - `bucketStarts("2025-10-13", "2026-10-11", "week")` has 52 entries, from `"2025-10-13"` to `"2026-10-05"`.
  - For `["2026-10-15", "2026-10-16", "2026-10-17"]`, `pendingCount` is 2 with only the 15th present, 1 with the 16th, and 0 with all three. With 4 buckets and none present it is 2.
  - `pendingNote` gives the three sentences above, and `null` for 0.
  - `formatUtcDay("2026-10-17")` is `"Oct 17"`; `formatUtcDay("2026-01-05", true)` is `"Jan 5, 2026"`.
  - `fnv1a32("")` is `2166136261` and `fnv1a32("a")` is `3826002220`. `tokenOf({ a: 1 })` matches `/^[0-9a-f]{8}$/`, equals `tokenOf({ a: 1 })`, and differs from `tokenOf({ a: 2 })`.
  - `typeGroups("xrpl").map((g) => [g.id, g.slot])` is `[["Payment",1],["OfferCreate",2],["OfferCancel",3],["TrustSet",4],["AMM",5],["other","other"]]`. Xahau gives `[["Payment",1],["Invoke",2],["ClaimReward",3],["URIToken",4],["SetHook",5],["other","other"]]`.
  - `groupCounts("xrpl", { Payment: 10, OfferCreate: 5, AMMDeposit: 2, AMMWithdraw: 1, AccountSet: 3, NFTokenMint: 4 })` is `{ Payment: "10", OfferCreate: "5", OfferCancel: "0", TrustSet: "0", AMM: "3", other: "7" }`.
  - `groupCounts("xahau", { URITokenMint: 2, URITokenBuy: 1, Invoke: 5, Payment: 1, AccountSet: 1 })` has `URIToken: "3"`, `other: "1"`, `SetHook: "0"`.
  - `groupCounts("xrpl", { AMMDeposit: 9007199254740991, AMMWithdraw: 2 }).AMM` is `"9007199254740993"`.
  - `typeGroupsNote` gives the two notes of §6.7, verbatim.
  - `anchorOf` of the recorded XRPL `last_validated` (`test/fixtures/http/xrpl/data-api/last_validated.json`) is `{ lastValidated: 107721455, closeTime: 1792256472 }`.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/domain app/server/anchor`.
- [ ] **Step 3: Implement.** Day arithmetic goes through `Date.UTC` and `toISOString().slice(0, 10)`, so there is no local time. A week bucket is the Monday on or before the day.
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm test app/domain app/server/anchor`, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/domain app/server/anchor.ts app/server/anchor.test.ts tsconfig.node.json`, with the message `feat(domain): period windows with the running bucket, the anchor, transaction-type groups and FNV-1a tokens`.

### Task 6: The live page, generalised

**Files:**
- Rename: `git mv app/ui/home-live.ts app/ui/live-page.ts`, `git mv app/ui/home-live.test.ts app/ui/live-page.test.ts`, `git mv app/ui/use-home-live.ts app/ui/use-live-controls.ts`
- Create: `app/ui/use-hold.ts`
- Modify:
  - `app/ui/live-page.ts`
  - `app/ui/on-screen.ts`: `merge`.
  - `app/ui/use-live-controls.ts`: the rename only.
  - `app/ui/use-live-rows.ts`: both axes.
  - `app/routes/net._index.tsx`
  - `app/ui/pages/HomePage.tsx`: `useHolds`, and the `LiveControls` import.
  - `app/ui/routes-wiring.test.tsx`: imports.
  - `app/ui/components/LiveMotion.test.tsx`: transform strings.
  - `README.md` "Live updates": the new names, and that the network page shares them.
- Test: `app/ui/live-page.test.ts`, `app/ui/on-screen.test.ts`, `app/ui/components/LiveMotion.test.tsx`, `app/ui/pages/HomePage.test.tsx`, `app/ui/routes-wiring.test.tsx`

**Interfaces:**
- Produces in `app/ui/live-page.ts` (the code of `home-live.ts`, moved as it is):

```ts
export interface LivePageDeps { reload?: () => void; storage?: () => Storage | undefined }   // was HomeLiveDeps
export interface LiveOnScreenOptions<T> { order: (data: T) => number; merge?: (next: T, shown: T) => T; deps?: LivePageDeps }
export function createLiveOnScreen<T extends { build: string }>(options: LiveOnScreenOptions<T>): OnScreen<T>;
export type LivePart = { readonly state: string };
export function keepLoaded<K extends string, T extends Record<K, LivePart>>(next: T, shown: T, parts: readonly K[]): T;
```

  - `refuse` is: another `build` means reload once per pair of builds and refuse; otherwise refuse when `order(next) < order(shown)`.
- Produces in `app/ui/on-screen.ts`: `OnScreenOptions<T>` gains `merge?: (next: T, shown: T) => T`. `reload` applies it only to an answer that is accepted while a page of the same scope is on screen.
- Produces in `app/ui/use-live-controls.ts`: `export interface LiveControls` (unchanged) and `export function useLiveControls(store: Pick<OnScreen<unknown>, "failures" | "subscribe">): LiveControls` (was `useHomeLive`; the body is unchanged, with one `sessionStorage` key for the tab).
- Produces in `app/ui/use-hold.ts`:
  - `export function holdsFocus(target: EventTarget): boolean` (moved from `HomePage.tsx`).
  - `export interface HoldHandlers { onPointerEnter(e: PointerEvent): void; onPointerLeave(): void; onFocus(e: FocusEvent<HTMLElement>): void; onBlur(e: FocusEvent<HTMLElement>): void }`
  - `export function useHolds(onHold?: (held: boolean) => void): (name: string) => HoldHandlers`. It keeps one hold per name and way (pointer, focus), calls `onHold(true)` while any is held, and calls `onHold(false)` on unmount.
- Produces in `app/ui/use-live-rows.ts`: the signature is unchanged. It measures `left` and `top` from the container's box. A moved child is put back with `translate(${dx}px, ${dy}px)`, and a child counts as moved when either difference is 1 px or more.
- The home route uses `createLiveOnScreen<HomeLoaderData>({ order: (d) => d.latest.index })` and `useLiveControls`. Its data is unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `live-page.test.ts`: every moved home test runs against `createLiveOnScreen<HomeLoaderData>({ order: (d) => d.latest.index, deps })`, unchanged. New cases:
    - an answer with a lower `order` is refused and `failures()` becomes 1; an equal `order` is accepted;
    - `merge` is called with `(next, shown)` for an accepted answer of the scope on screen, and its result is what `reload` returns;
    - `merge` is not called for a refused answer, for a scope not on screen (a navigation), or for a failed load.
  - `keepLoaded`, with `type D = { a: LivePart; b: LivePart; x: LivePart }`:
    - next `a` `{ state: "failed" }` and shown `a` `{ state: "ok", v: 1 }`: the result's `a` is shown's (`toBe`) and `b` is next's;
    - failed in both: next's `a`;
    - not named in `parts` (`x`): next's;
    - nothing kept: the result is `next` itself (`toBe`);
    - next `{ state: "off" }` or `{ state: "missing" }` replaces a shown `ok` (both are answers);
    - shown `{ state: "missing" }` and next `failed`: the shown `missing` is kept.
  - `on-screen.test.ts`: `merge` runs only on accepted answers with the scope on screen.
  - `LiveMotion.test.tsx`: every `translateY(${n}px)` expectation (lines 92, 117, 137 and 138) becomes `translate(0px, ${n}px)`. A new case: a child whose mocked `left` moved by −120 px gets `translate(-120px, 0px)`.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/live-page app/ui/on-screen app/ui/components/LiveMotion`.
- [ ] **Step 3: Implement** the renames and the code above. `HomePage` uses `useHolds(live?.onHold)` in place of its own hold code, and keeps its behaviour.
- [ ] **Step 4: Run the tests to verify they pass.** Run `pnpm test app/ui`; `HomePage.test.tsx` and `routes-wiring.test.tsx` pass unchanged apart from imports. Then `pnpm verify` and `pnpm test:e2e` (`live-home.spec.ts`).
- [ ] **Step 5: Commit.** `git add -A app/ui app/routes/net._index.tsx README.md`, with the message `refactor(live): createLiveOnScreen, keepLoaded, useLiveControls and useHolds for every live page`.

### Task 7: Chart kit: data shapes, geometry, labels, tokens

**Files:**
- Create: `app/ui/charts/types.ts`, `app/ui/charts/geometry.ts`, `app/ui/charts/geometry.test.ts`, `app/ui/charts/labels.ts`, `app/ui/charts/labels.test.ts`
- Modify:
  - `app/domain/format.ts`: `compactNumber`.
  - `app/domain/format.test.ts`
  - `app/ui/tokens.css`: `--grid`, `--axis`, `--track`, `--up-wash`, `--down-wash`, in all three blocks.
  - `test/unit/tokens.test.ts`
- Test: those files

**Interfaces:**
- Produces `app/ui/charts/types.ts`: spec §2.3's block, verbatim, with every declaration exported (`Slot`, `ValueKind`, `ValueFormat`, `TimeAxis`, `Series`, `TimeSeriesData`, `SmallMultiplesData`, `BarListData`, `ShareData`, `MeterData`, `CandleData`). It adds `export interface Delta { text: string; sign: 1 | -1 | 0 }` (`StatTile`'s delta). The file is type-only. Later plans grow these types as spec §2.3 says (`extras`, `"month"`, `"minute"`, `forming` on `CandleData`, `href` on `BarList` items).
- Produces in `app/domain/format.ts`: `export function compactNumber(value: string): string`, with `bignumber.js`, rounding half up:
  - at or above 10,000: 3 significant digits and K/M/B/T, rolling to the next suffix at 1000;
  - from 1: grouped, at most 2 decimals;
  - under 1: 3 significant digits;
  - trailing zeros dropped, and U+2212 for a negative.
- Produces in `app/domain/format.ts`: `export function sharePercent(part: string, whole: string): string`. It gives whole percents, half up, with `bignumber.js`, and `"<1%"` below 0.5 (`"58%"`, `"<1%"`). The view builder's shares and `ShareBar`'s labels use it; the kit may not import `bignumber.js` itself.
- Produces in `app/ui/charts/geometry.ts`:

```ts
export type Placement = "points" | "bands";
export interface ValueScale { min: number; max: number; step: number; ticks: readonly number[] }
export function niceScale(values: readonly (number | null)[], opts?: { integer?: boolean; from?: number; to?: number; ticks?: 3 | 5; symmetric?: boolean }): ValueScale;
export function fractionOf(value: number, scale: ValueScale): number;        // 0 at scale.min, 1 at scale.max
export function xOf(i: number, n: number, placement: Placement): number;     // points i/(n−1) (0.5 for n = 1); bands (i + ½)/n
export function bucketAt(fraction: number, n: number, placement: Placement): number;   // nearest bucket, clamped to 0..n−1
export function stackOf(values: readonly (number | null)[]): { from: number; to: number }[];   // one bucket, bottom up, value units
export function linePath(fractions: readonly (number | null)[], opts: { height: number; placement: Placement; curve?: "linear" | "step" }): string;
export function areaPath(fractions: readonly (number | null)[], opts: { height: number; placement: Placement; curve?: "linear" | "step" }): string;
export function keptEndLabels(ys: readonly (number | null)[], minGap?: number): boolean[];   // px from the top at 160 px; default 16
export function xLabelPicks(n: number, width: "wide" | "narrow"): number[];  // every k-th from the newest, ascending; k = ⌈n/6⌉ | ⌈n/3⌉
export function tooltipSide(fraction: number): "right" | "left" | "center"; // < 0.22 right, > 0.78 left
export const MIN_SLOT_PX = 5;
export const PLOT_HEIGHT = { wide: 200, narrow: 160 } as const;
export const END_LABEL_GUTTER_PX = 112;
```

  - The paths are drawn in a `1000 × height` box. `y = height × (1 − f)`. Numbers have at most 2 decimals, with trailing zeros trimmed. Commands are joined with no spaces (`M0,200L333.33,100`). A `null` breaks the line: the next point starts with `M`. A step is step-after. An area is closed to the baseline, one sub-path per run without `null`.
  - Steps of `niceScale`: `{1, 2, 2.5, 5} × 10ⁿ`. With 5 ticks (the default), take the smallest step in `[max/4, max/2)`. With 3 ticks, take one in `[max/2, max)`. `integer` skips steps that are not whole, and falls back to step 1 with a top of at least 4. All zero gives 0 to 4 with `integer`, else 0 to 1. `from`/`to` set the domain of a line. `symmetric` mirrors the positive side. Ticks are `k × step`, cleaned with `toPrecision(12)`.
- Produces in `app/ui/charts/labels.ts`:

```ts
export function tickLabel(value: number, kind: ValueKind): string;
export function valueText(value: string, format: ValueFormat, style: "compact" | "full"): string;
export function cellText(value: string | null, format: ValueFormat): string;
export function bucketLabel(bucket: string, unit: TimeAxis["unit"], where: "axis" | "tooltip" | "table", forming?: boolean): string;
export function tableHeading(unit: TimeAxis["unit"]): string;
export function gapText(axis: TimeAxis, i: number, pending: number): string;  // "Not computed yet" | "No data for Oct 3"
export function emptyText(axis: TimeAxis): string;                            // "No data for these 30 days" | "… 52 weeks"
export function plotSummary(title: string, data: TimeSeriesData): string;
```

  - `valueText`:
    - count: compact is `compactNumber`; full is `formatAmount`, with no noun;
    - amount, drops and price: `compactNumber` + `" " + unit` (`unit` for drops is `"drops"`);
    - percent: `formatAmount(v) + "%"`;
    - seconds: `formatAmount(v) + " s"`.
  - `cellText` is `formatAmount` (plus `%` or ` s`), and `"—"` for `null`.
  - `bucketLabel`:
    - day: `"Oct 16"` on the axis, `"Oct 16, 2026"` in the tooltip and the table;
    - week: `"Oct 12"` on the axis, `"Week of Oct 12, 2026"` in the tooltip, `"Oct 12, 2026"` in the table;
    - hour: `"17:00"` on the axis, `"Oct 17, 2026, 17:00"` elsewhere;
    - flag: `"Oct 16"` on the axis, `"Oct 16, 2026, 17:01"` elsewhere (E6 fixes these);
    - `forming` adds `", so far"` in the tooltip and the table, never on the axis.
  - `tableHeading`: `"Day (UTC)"`, `"Week of (UTC)"`, `"Hour (UTC)"`, `"Flag ledger (UTC)"`.
  - `plotSummary` is `"{title}, {first} to {last}. Highest {bucket}, {value}; latest {bucket}, {value}. Choose Table for every value."` It reads the totals when present, else the first series. It uses compact values, gives the year on the last date only (on both when the years differ), and picks the earliest of equal highs. With every bucket `null` it is `"{title}: {emptyText}."`.

- [ ] **Step 1: Write the failing tests.**
  - `compactNumber`:
    - `"9999.99"` gives `"9,999.99"`; `"10000"` gives `"10K"`; `"12900"` gives `"12.9K"`; `"999950"` gives `"1M"`; `"4200000"` gives `"4.2M"`; `"1240000000"` gives `"1.24B"`;
    - `"-12900"` gives `"−12.9K"`; `"0"` gives `"0"`; `"0.000123456"` gives `"0.000123"`; `"1234.567"` gives `"1,234.57"`; `"999.995"` gives `"1,000"`;
    - the exponent inputs `"1e-7"` give `"0.0000001"` and `"2.5e6"` gives `"2.5M"`.
  - `sharePercent`: `("900", "1300.4")` gives `"69%"`; `("400", "1300.4")` gives `"31%"`; `("0.4", "1300.4")` gives `"<1%"`; `("1", "200")` gives `"1%"` (0.5, half up).
  - `niceScale` ticks:
    - `([2310000], { integer: true })` gives `[0, 1000000, 2000000, 3000000]`;
    - `([100])` gives `[0, 25, 50, 75, 100]`;
    - `([7], { integer: true })` gives `[0, 2, 4, 6, 8]`;
    - `([2], { integer: true })` and `([0, 0], { integer: true })` give `[0, 1, 2, 3, 4]`;
    - `([null, 0])` gives `[0, 0.25, 0.5, 0.75, 1]`;
    - `([99.31, 99.98], { from: 99 })` gives `[99, 99.25, 99.5, 99.75, 100]`;
    - `([40, 120], { ticks: 3 })` gives `[0, 100, 200]`;
    - `([-300, 500], { symmetric: true })` has `min === -max`, contains 0, and has `max ≥ 500`;
    - `([-50, 120], { ticks: 3 })` has `ticks[0] ≤ -50`, contains 0, its last tick ≥ 120, and 3 or 4 ticks.
  - Paths:
    - `linePath([0, 0.5, null, 1], { height: 200, placement: "points" })` is `"M0,200L333.33,100M1000,0"`;
    - `linePath([1, 0], { height: 100, placement: "points", curve: "step" })` is `"M0,0L1000,0L1000,100"`;
    - `areaPath([0.5, 0.5], { height: 100, placement: "points" })` is `"M0,50L1000,50L1000,100L0,100Z"`;
    - in bands, `xOf(0, 4, "bands") * 1000` is 125.
  - Picks and buckets:
    - `keptEndLabels([50, 60, 100])` is `[true, false, true]`;
    - `xLabelPicks(30, "wide")` is `[4, 9, 14, 19, 24, 29]`; `(30, "narrow")` is `[9, 19, 29]`; `(52, "wide")` is `[6, 15, 24, 33, 42, 51]`; `(7, "wide")` is `[0, 2, 4, 6]`;
    - `bucketAt(0.5, 30, "bands")` is 15; `bucketAt(1, 30, "points")` is 29; `bucketAt(0.99, 30, "bands")` is 29;
    - `tooltipSide` at 0.21, 0.22, 0.78 and 0.79 is `right`, `center`, `center`, `left`;
    - `stackOf([3, null, 2])` is `[{from:0,to:3},{from:3,to:3},{from:3,to:5}]`.
  - Labels:
    - `tickLabel` of 2500000, 500000, 1000000, 1200000000, 7500 and 0 (count) is `"2.5M"`, `"500K"`, `"1M"`, `"1.2B"`, `"7,500"`, `"0"`; `tickLabel(99.5, "percent")` is `"99.5%"`;
    - `valueText("1284331", { kind: "count" }, "full")` is `"1,284,331"`; `("45500000", { kind: "amount", unit: "XRP" }, "compact")` is `"45.5M XRP"`; `("113", { kind: "drops", unit: "drops" }, "compact")` is `"113 drops"`;
    - `bucketLabel("2026-10-17", "day", "tooltip", true)` is `"Oct 17, 2026, so far"`; `(…, "axis", true)` is `"Oct 17"`; `("2026-10-12", "week", "tooltip", true)` is `"Week of Oct 12, 2026, so far"`;
    - for a 30-day axis, `gapText(axis, 29, 1)` is `"Not computed yet"` and `gapText(axis, 15, 1)` is `"No data for Oct 3"` (buckets from Sep 18);
    - `emptyText` of 30 days is `"No data for these 30 days"`;
    - `plotSummary("Transactions by type per day", …)` over a 30-day stack whose highest total is Oct 3 (`"2310000"`) and latest Oct 16 (`"2104331"`) is `"Transactions by type per day, Sep 17 to Oct 16, 2026. Highest Oct 3, 2.31M; latest Oct 16, 2.1M. Choose Table for every value."`.
  - `test/unit/tokens.test.ts`:
    - the five tokens with spec §2.10's values, in all three blocks, with equal dark copies;
    - `--series-1` on `--track` is at least 3:1 (3.34 light, 3.28 dark, to 2 decimals);
    - `--muted` on `--up-wash` over `--surface` is 6.10 and 6.33; on `--down-wash`, 6.17 and 6.46. Composite the rgba over `--surface` with the file's own contrast helper, extended for alpha.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/charts app/domain/format test/unit/tokens`.
- [ ] **Step 3: Implement** the functions above. No `Intl`, no `Date.now()`.
- [ ] **Step 4: Run the tests to verify they pass.** Run the command of Step 2, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/ui/charts app/domain/format.ts app/domain/format.test.ts app/ui/tokens.css test/unit/tokens.test.ts`, with the message `feat(charts): data shapes, scales and paths, labels, and the chart tokens`.

### Task 8: Chart kit: the card, the legend and the table view

**Files:**
- Create:
  - `app/ui/charts/ChartCard.tsx`, `app/ui/charts/Legend.tsx`, `app/ui/charts/ChartTable.tsx`, `app/ui/charts.css`
  - `app/ui/charts/ChartCard.test.tsx`, `app/ui/charts/Legend.test.tsx`, `app/ui/charts/ChartTable.test.tsx`
  - `test/support/hydrate.tsx`, `test/unit/charts-css.test.ts`, `test/unit/charts-bundle.test.ts`
- Modify:
  - `app/ui/styles.css`: `@import "./charts.css";` after `components.css`.
  - `app/ui/components/DataTable.tsx`: `compact`, `maxHeight`.
  - `app/ui/components/SectionError.tsx`: `message`.
  - `app/ui/components.css`: `.table--compact`, 34 px rows; the sticky header row inside a `maxHeight` region.
- Test: the three component tests and the two unit tests above.

**Interfaces:**
- Consumes (Task 7): `types.ts` and `labels.ts`.
- Produces `test/support/hydrate.tsx`: `export async function serverThenHydrated(ui: ReactElement): Promise<{ html: string; container: HTMLDivElement; errors: string[] }>`. It runs `renderToString`, puts the HTML in a container, runs `hydrateRoot` inside `act`, and collects `console.error` and `onRecoverableError` into `errors`. Every kit test uses it.
- Produces `ChartCard.tsx`: `export function ChartCard(props: { id: string; title: string; source: string; what: string; state?: "ok" | "failed"; onRetry?: () => void; retrying?: boolean; legend?: ReactNode; table?: ReactNode; notes?: readonly ReactNode[]; className?: string; children?: ReactNode }): JSX.Element`. It renders, in order:
  1. `<section class="card chart" aria-labelledby="{id}-title">`, with `container-type: inline-size`;
  2. the head: the `<h2>` and `.chart__source`;
  3. the toggle `<fieldset class="segs chart__toggle">`, with a visually hidden `<legend>` "{title}: view" and two uncontrolled radios named `{id}-view` with the values `chart` (`defaultChecked`) and `table`, as labels;
  4. `legend`;
  5. `.chart__view` (the children) and `.chart__table` (`table`);
  6. `.chart__notes` (one `<p>` per note).
  - With `state="failed"` it renders `SectionError what={what}` in place of the toggle and both views. E4 adds `"loading"`; E6 adds nothing (its own table already goes in `table`).
- Produces `Legend.tsx`:
  - `export interface LegendItem { id: string; label: string; key: "swatch" | "line" | "symbol"; slot?: Slot; symbol?: string }`
  - `export function Legend(props: { items: readonly LegendItem[] }): JSX.Element | null`: `null` with fewer than two swatch or line items and no symbol item. Swatches are 10 × 10 px with a 2 px radius; line keys are 14 × 2 px.
  - `export function legendOf(data: TimeSeriesData, key: "swatch" | "line"): LegendItem[]`: the series, then one entry per distinct annotation (`symbol`, `label`).
- Produces `ChartTable.tsx`: `export function ChartTable(props: { title: string; data: TimeSeriesData | SmallMultiplesData | BarListData | ShareData | CandleData; totalLabel?: string }): JSX.Element`. It is a `DataTable compact maxHeight={300}` labelled `title`.
  - Time forms are newest first: the bucket (`tableHeading`, `bucketLabel(…, "table", forming && i === n − 1)`), one column per series (`cellText`), then `totalLabel` (default `"Total"`) when `totals` is given.
  - `SmallMultiplesData`: the bucket, then one column per panel, headed by `label` and `sublabel`.
  - `BarListData`: label (and sublabel), value, share, count.
  - `ShareData`: the row label, its total, then one column per segment id.
  - `CandleData`: the bucket, Open, High, Low, Close, Volume, Trades.
  - A `null` is "—" with a visually hidden "no data".
- Produces `DataTable` props `compact?: boolean` (34 px rows) and `maxHeight?: number` (px; the region scrolls on y).
- Produces `SectionError` prop `message?: ReactNode`, which replaces "Couldn't load {what}.".
- Produces in `charts.css` the card's selectors: `.chart`, `.chart__head`, `.chart__source`, `.chart__toggle`, `.chart__view`, `.chart__table`, `.chart__notes`, `.legend`, `.legend__swatch`, `.legend__line`, `.is-refetching`.
- Produces `test/unit/charts-css.test.ts`, which every later kit task extends with the rules of its own marks.

- [ ] **Step 1: Write the failing tests.**
  - `ChartCard.test.tsx` (`serverThenHydrated`):
    - the HTML has `<section class="card chart"` with `aria-labelledby` pointing at the `h2`;
    - two radios named `types-view`, the Chart one `checked`, and the legend text "Transactions by type: view";
    - both `.chart__view` and `.chart__table` are in the HTML;
    - each note is a `<p>` in `.chart__notes`;
    - `errors` is `[]`;
    - with `state="failed"`: the text "Couldn't load transactions by type.", a Retry button calling `onRetry`, no radio and no `.chart__view`;
    - re-rendered with new children while Table is checked, Table stays checked (the radios are uncontrolled).
  - `Legend.test.tsx`:
    - one series renders nothing (`null`);
    - two series render two `.legend__swatch` (or `.legend__line` with `key: "line"`), in series order;
    - `legendOf` of a series with two annotations of the same symbol and label gives one symbol entry after the series;
    - one series with an annotation renders both.
  - `ChartTable.test.tsx`:
    - a 3-day stacked series renders newest first, with the headers `["Day (UTC)", "Payment", "OfferCreate", "Total"]`;
    - the first row's date is "Oct 17, 2026, so far" when `forming`;
    - a `null` cell is "—" with the visually hidden "no data";
    - a week axis is headed "Week of (UTC)";
    - small multiples are headed `"XRP"` and `"RLUSD rMxCKb…m5De"`;
    - `totalLabel="Net"` heads the totals column "Net";
    - the region is `maxHeight` 300 px, and its rows have `table--compact`.
  - `test/unit/charts-css.test.ts` reads `charts.css`, its comments stripped:
    - the toggle's labels have `min-height: 44px` through their target;
    - inside `@supports selector(:has(*))`: `.chart .chart__table { display: none }`, `.chart:has(input[value="table"]:checked) .chart__view { display: none }`, and `.chart:has(input[value="table"]:checked) .chart__table { display: block }`; outside it, no rule hides either view;
    - `.is-refetching .chart` has `opacity: 0.55`;
    - under `forced-colors: active`, `.legend__swatch` and `.legend__line` have `forced-color-adjust: none`.
  - `test/unit/charts-bundle.test.ts` (as `account-bundle.test.ts` scans value imports):
    - every file in `app/ui/charts/` but the `*.test.tsx` files imports as values only `react`, `./*`, `../../domain/format`, `../cx` and `../components/*`;
    - no file imports `../../server/` as a value;
    - there is no `app/ui/charts/index.ts` or `index.tsx`;
    - `package.json` has no dependency matching `/chart|d3|recharts|visx|uplot/`.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/charts test/unit/charts-css test/unit/charts-bundle`.
- [ ] **Step 3: Implement** the components and the card's part of `charts.css`, from spec §2.5 and §2.10.
- [ ] **Step 4: Run the tests to verify they pass.** Run the command of Step 2, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/ui/charts app/ui/charts.css app/ui/styles.css app/ui/components test/support/hydrate.tsx test/unit/charts-css.test.ts test/unit/charts-bundle.test.ts`, with the message `feat(charts): the chart card with a CSS Chart/Table toggle, the legend and the table view`.

### Task 9: Chart kit: the plot frame and the cursor

**Files:**
- Create: `app/ui/charts/Plot.tsx`, `app/ui/charts/Cursor.tsx`, `app/ui/charts/Plot.test.tsx`, `app/ui/charts/Cursor.test.tsx`
- Modify:
  - `app/ui/charts.css`: `.plot`, `.plot__marks`, `.plot__grid`, `.plot__y`, `.plot__x`, `.plot__scroll`, `.plot__cursor`, `.plot__tip`, `.plot__crosshair`, `.plot__dot`, `.plot__end`, `.plot.is-changed`.
  - `test/unit/charts-css.test.ts`
- Test: the two new test files and `test/unit/charts-css.test.ts`

**Interfaces:**
- Consumes: Task 7 (`geometry.ts`, `labels.ts`, `types.ts`) and Task 8 (`serverThenHydrated`).
- Produces `Plot.tsx` (a kit file added beside §2.12's list; it is the chart view's frame, which every plotted form shares):

```ts
export interface PlotProps {
  title: string;               // the scroll region's name: "{title}, scrollable chart"
  summary: string;             // aria-label of the role="img" box holding the marks (the marks are aria-hidden)
  token: string;               // the ring (`.plot.is-changed`, value-mark) after a change following the first render
  scale: ValueScale; kind: ValueKind;     // gridlines (1 px --grid, the 0 line --axis) and y labels (tickLabel) in a gutter outside the scroll region
  axis: TimeAxis; placement: Placement;   // x labels: both pick sets rendered, `.plot__x--wide` / `--narrow`, one shown by a container query
  slots?: boolean;             // columns: min-width n × MIN_SLOT_PX; the plot scrolls sideways in role="region" tabindex="0"
  empty?: string | null;       // centred in --muted when every bucket is null
  endLabels?: ReactNode;       // the END_LABEL_GUTTER_PX right gutter; left out under 480 px
  yAxis?: "left" | "right";    // candles: "right"
  height?: "chart" | "pane" | "panel";   // chart 200/160 px; pane and panel are the volume pane's and a small multiple's
  cursor?: Omit<CursorProps, "plot">;
  children: ReactNode;         // the marks; each bucket's marks carry data-bucket={i}
}
export function Plot(props: PlotProps): JSX.Element;
export function usePlotMark(token: string): boolean;   // false until the token changes after mount, then true (LiveValue's rule)
export function useHydrated(): boolean;                // useSyncExternalStore: false on the server and during hydration
```

- Produces `Cursor.tsx`:

```ts
export interface CursorProps {
  plot: RefObject<HTMLElement | null>;  // gets data-active={i}; its [data-bucket="{i}"] marks get .is-active
  count: number; placement: Placement;
  label: string;                         // "{title}, day by day"
  valueText: (i: number) => string;      // aria-valuetext
  tooltip?: (i: number) => ReactNode;    // React text nodes only; the tooltip is aria-hidden
  crosshair?: boolean;                   // 1 px --border-strong
  dots?: (i: number) => readonly { y: number; slot: Slot }[];   // 8 px dots with a 2 px --surface ring; y is a fraction from the bottom
  onChange?: (i: number | null) => void; // readouts (panel headers, the candle readout); E6 adds pageStep
}
export function Cursor(props: CursorProps): JSX.Element | null;   // null until hydrated
export function HoverGroup(props: { children: ReactNode }): JSX.Element;
export function useHoverGroup(): { active: number | null; set(i: number | null): void } | null;
```

  - The layer is `role="slider"`, `tabindex="0"`, `aria-valuemin="0"`, `aria-valuemax="{count−1}"`, `aria-valuenow`, `touch-action: pan-y`.
  - Focus selects the newest bucket. Arrow Left and Right move one bucket; Home and End go to the ends. Blur and Escape hide.
  - A pointer selects the nearest bucket (`bucketAt` of the x fraction). A touch tap or drag selects, and the tooltip stays until a `pointerdown` outside.
  - The tooltip side comes from `tooltipSide`, and it is at most `min(260px, 90%)` wide.
  - Inside a `HoverGroup`, the cursors share the active bucket; each draws its own crosshair and dots, and only the one with the pointer or focus shows its tooltip.

- [ ] **Step 1: Write the failing tests.**
  - `Plot.test.tsx` (`serverThenHydrated`, a 30-day axis, the scale `niceScale([18], { integer: true })`, three stub marks with `data-bucket`):
    - the marks sit in `<div role="img" aria-label="{summary}">`, and are `aria-hidden`;
    - there is one `.plot__grid` per tick, the 0 line with `is-base`, and the y labels are `tickLabel`'s (`"0"`, `"5"`, `"10"`, `"15"`, `"20"`);
    - both `.plot__x--wide` (6 labels) and `.plot__x--narrow` (3 labels) are in the HTML, and no x label says "so far";
    - with `slots`, the plot's inline style has `min-width: 150px` inside `role="region"`, `tabindex="0"` and `aria-label="{title}, scrollable chart"`;
    - `empty="No data for these 30 days"` shows that text;
    - `yAxis="right"` puts `.plot__y` after the scroll region;
    - no `role="slider"` in the server HTML, and `errors` is `[]`;
    - after a re-render with the same token there is no `.plot.is-changed`; a new token gives `.plot.is-changed` once.
  - `Cursor.test.tsx`, rendered inside a stub plot whose `getBoundingClientRect` is mocked (width 1000):
    - not in the server HTML (`role="slider"` absent);
    - after hydration: `role="slider"`, `tabindex="0"`, `aria-valuemax="29"`;
    - focus gives `aria-valuenow="29"` and `valueText(29)`; ArrowLeft gives 28; Home gives 0; End gives 29;
    - Escape hides the tooltip;
    - a `pointermove` at x 500 shows a tooltip with `tooltip(15)`'s text, `aria-hidden="true"` and the side class `center`, and x 100 gives the side `right`;
    - the plot gets `data-active="15"`, and its `[data-bucket="15"]` child `.is-active`;
    - two cursors in one `HoverGroup` share the active bucket, and only the one under the pointer shows a tooltip;
    - a touch `pointerdown` selects, and the tooltip stays after `pointerup` until a `pointerdown` on `document.body`.
  - `test/unit/charts-css.test.ts` gains:
    - `.plot__grid` has `border-top: 1px solid var(--grid)`, and the base line `var(--axis)`;
    - `.plot__dot` is 8 px with `box-shadow: 0 0 0 2px var(--surface)`;
    - `.plot__crosshair` is 1 px of `var(--border-strong)`;
    - `.plot__tip` has `max-width: min(260px, 90%)`;
    - the plot is 200 px high, and 160 px under a 480 px container (`@container`);
    - under `@media (prefers-reduced-motion: reduce)`, `.plot.is-changed` keeps `animation: value-mark 1200ms ease-out !important`.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/charts/Plot app/ui/charts/Cursor test/unit/charts-css`.
- [ ] **Step 3: Implement** `Plot`, `Cursor` and their CSS, from spec §2.2, §2.6, §2.7 and §2.9.
- [ ] **Step 4: Run the tests to verify they pass.** Run the command of Step 2, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/ui/charts app/ui/charts.css test/unit/charts-css.test.ts`, with the message `feat(charts): the plot frame and the hover and keyboard cursor`.

### Task 10: ColumnChart: single, stacked, diverging

**Files:**
- Create: `app/ui/charts/ColumnChart.tsx`, `app/ui/charts/ColumnChart.test.tsx`
- Modify: `app/ui/charts.css` (`.col`, `.col__bar`, `.col__seg`, `.col__note`), `test/unit/charts-css.test.ts`
- Test: `app/ui/charts/ColumnChart.test.tsx`, `test/unit/charts-css.test.ts`

**Interfaces:**
- Consumes: `Plot`, `usePlotMark`, `Cursor` (Task 9); `niceScale`, `stackOf`, `bucketAt`, `xOf` (Task 7); `valueText`, `bucketLabel`, `gapText`, `emptyText`, `plotSummary` (Task 7).
- Produces: `export const ColumnChart: MemoExoticComponent<(props: { layout: "single" | "stacked" | "diverging"; title: string; data: TimeSeriesData }) => JSX.Element>`, memoised on `layout`, `title` and `data.token`.
  - single: `series[0]` in `--series-1`.
  - stacked: the series bottom up, in their slots. Every segment but the highest has a 2 px `--surface` inset at its top. `totals` gives the tooltip's total line ("{n} total").
  - diverging: `series[0]` is drawn up in `--up`, `series[1]` down in `--down`, on a symmetric scale with the zero line in `--axis`. When `totals` is given it is the net, shown as "Net" (the kit does no arithmetic; E4's `extras` carry it otherwise).
  - `annotations` put `symbol` above the column in `--bad`.
  - The slider's text is "{date}: {total} {unit}; {series} {value}; …", with full values.

- [ ] **Step 1: Write the failing tests** (`serverThenHydrated`; a 30-day axis from Sep 18 to Oct 17, `forming`, `format { kind: "count", unit: "transactions" }`):
  - The server HTML has 30 `.col` with `data-bucket` 0 to 29, each bar's `height` in percent of the scale, and no `role="slider"`. `errors` is `[]`.
  - Stacked, with `["10","5"]` in bucket 29 and another bucket totalling 18 (so the top tick is 20): bucket 29's stack is 75% of the plot, and its segments are 66.667% and 33.333% of the stack (3 decimals). The segment order in the DOM is bottom up.
  - `annotations: [{ bucket: 3, symbol: "×", label: "has a failed transaction" }]` puts "×" in bucket 3's `.col__note`.
  - Diverging: bucket 0 `["4","3"]` has an up bar and a down bar. The scale is symmetric. The tooltip after hydration lists "Received", "Sent" and, from `totals`, "Net 1".
  - After hydration the slider's `aria-label` is "Transactions by type, per day, day by day", and its `aria-valuetext` at bucket 29 is "Oct 17, 2026, so far: 15 transactions; Payment 10; OfferCreate 5". A pointer over a column sets `data-active` on the plot.
  - States:
    - a `null` bucket has no bar, and the tooltip says "No data for Oct 3";
    - with `pending: 1`, bucket 29's tooltip says "Not computed yet";
    - a zero is a bar of height 0, and the table cell says "0";
    - every bucket `null` gives the text "No data for these 30 days" and gridlines from 0 to 4;
    - the axis labels never contain "so far".
  - At 90 buckets the plot's inline style has `min-width: 450px`, inside `role="region"` with `aria-label="Transactions by type, per day, scrollable chart"`.
  - Memo: a re-render with the same token keeps the same DOM node of the first `.col` (`toBe`), and has no `.plot.is-changed`. A new token gives `.plot.is-changed` once.
  - `test/unit/charts-css.test.ts` gains:
    - the column bar is `width: min(24px, 72%, calc(100% - 2px))`;
    - the stack's top has `border-radius: 4px 4px 0 0`, and a diverging down bar `0 0 4px 4px`;
    - every segment but the last has `box-shadow: inset 0 2px 0 var(--surface)`;
    - `.plot[data-active] .col:not(.is-active)` has `opacity: 0.45`.
- [ ] **Step 2: Run it to verify it fails.** `pnpm test app/ui/charts/ColumnChart test/unit/charts-css`.
- [ ] **Step 3: Implement** with HTML boxes positioned in percent, as spec §2.2 and §2.11 say. The stacked total of a bucket is `stackOf(…)`'s last `to`.
- [ ] **Step 4: Run the tests to verify they pass.** Run the command of Step 2, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/ui/charts app/ui/charts.css test/unit/charts-css.test.ts`, with the message `feat(charts): column charts, single, stacked and diverging`.

### Task 11: LineChart and SmallMultiples

**Files:**
- Create: `app/ui/charts/LineChart.tsx`, `app/ui/charts/LineChart.test.tsx`, `app/ui/charts/SmallMultiples.tsx`, `app/ui/charts/SmallMultiples.test.tsx`
- Modify: `app/ui/charts.css` (`.line`, `.area`, `.ref`, `.ref__label`, `.plot__end`, `.multiples`, `.panel`, `.panel__head`), `test/unit/charts-css.test.ts`
- Test: the two test files and `test/unit/charts-css.test.ts`

**Interfaces:**
- Consumes: the Task 7, Task 8 and Task 9 interfaces, including `HoverGroup`, `keptEndLabels`, `linePath` and `areaPath`.
- Produces: `export const LineChart: MemoExoticComponent<(props: { title: string; data: TimeSeriesData; area?: boolean; curve?: "linear" | "step" }) => JSX.Element>`, memoised on `title`, `area`, `curve` and `data.token`.
  - It draws 1 to 3 lines in one SVG, `viewBox="0 0 1000 {h}" preserveAspectRatio="none"`. An 8 px end dot sits on each series' last non-null value.
  - End labels ("**45.5M** payments": the compact value strong, then `short ?? label`) appear for 4 series or fewer, through `keptEndLabels`.
  - `area` is for one series only, with a domain from 0.
  - `data.domain` sets `from`/`to`. `references` are dashed 1.5 px `--muted` lines, with the label in `--fg` on a `--surface` chip.
  - The cursor has a crosshair and dots.
- Produces: `export const SmallMultiples: MemoExoticComponent<(props: { title: string; data: SmallMultiplesData }) => JSX.Element>`.
  - A grid of `minmax(240px, 1fr)` panels, at most 6. Every panel is drawn in slot 1, with its own 3-tick scale (from 0, or from the lowest value when that is below 0).
  - The header shows `label`, `sublabel`, and the readout: the hovered bucket's value, else the newest non-null one, as `valueText(…, panel.format, "compact")`.
  - The x labels are at both ends only. One `HoverGroup` spans the panels.

- [ ] **Step 1: Write the failing tests.**
  - LineChart:
    - with 3 series over 30 days, the server HTML has 3 `<path class="line"` whose `d` equals `linePath` of their fractions. A `null` gives a second `M`.
    - It has 3 `.plot__dot` and 3 `.plot__end` labels, the first "**45.5M** payments". With two series 10 px apart at the 160 px height, only the first label is kept.
    - With `area`, the path has the class `area`, `areaPath`'s `d`, and the domain from 0.
    - With `curve="step"`, `domain: { min: "50" }` and `references: [{ value: "80", label: "80% threshold" }]`: the step `d`, the lowest tick 50, a `.ref` at `fractionOf(80, scale) × 100`% from the bottom, and the label "80% threshold".
    - After hydration: a crosshair and 3 dots at the hovered bucket; the tooltip has one row per series (a 12 × 2 px key, the value strong, the name muted); the slider text reads "Oct 16, 2026: Payments 45.5M XRP; DEX trades, tracked markets 12.1M XRP".
    - It passes every state of spec §2.8 (as in Task 10) and the memo cases.
  - SmallMultiples:
    - two panels ("XRP", and "RLUSD" with the sublabel "rMxCKb…m5De") each have their own ticks;
    - a panel with a value of −50 has a tick at or below −50;
    - the readout is the newest value, then the hovered one after a pointer move on the other panel (the shared bucket);
    - only the panel under the pointer has a tooltip;
    - the table view has the columns Day (UTC), XRP, RLUSD;
    - a `forming` bucket's table row says ", so far".
  - `test/unit/charts-css.test.ts` gains:
    - `.line` has `stroke-width: 2`, `vector-effect: non-scaling-stroke`, `stroke-linejoin: round` and `stroke-linecap: round`;
    - `.area` has `fill-opacity: 0.1`;
    - `dashed` appears in the `.ref` rule (1.5 px, `var(--muted)`) and in no other rule of the file;
    - `.multiples` is `repeat(auto-fill, minmax(240px, 1fr))`.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/charts/LineChart app/ui/charts/SmallMultiples test/unit/charts-css`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests to verify they pass.** Run the command of Step 2, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/ui/charts app/ui/charts.css test/unit/charts-css.test.ts`, with the message `feat(charts): lines with area, step, domain and references; small multiples`.

### Task 12: Candles and ShareBar

**Files:**
- Create: `app/ui/charts/Candles.tsx`, `app/ui/charts/Candles.test.tsx`, `app/ui/charts/ShareBar.tsx`, `app/ui/charts/ShareBar.test.tsx`
- Modify: `app/ui/charts.css` (`.candle`, `.candle__wick`, `.candle__body`, `.share`, `.share__row`, `.share__seg`, `.share__axis`)
- Test: the two test files

**Interfaces:**
- Consumes: the Task 7, Task 8 and Task 9 interfaces.
- Produces: `export const Candles: MemoExoticComponent<(props: { title: string; data: CandleData }) => JSX.Element>`.
  - Wicks are 1 px. Bodies are `min(9px, 62%)`, at least 1 px: `--up` when `c > o`, `--down` when `c < o`, `--up` when they are equal.
  - The price axis is on the right. Under it is a volume pane with its own axis and `--series-other` columns.
  - The legend items are "Closed higher", "Closed lower" and "Volume (…)", for the page to pass to `Legend`.
  - A readout above the price pane shows the time, then O H L C, "Volume {compact}", "{n} trades": the hovered candle, else the latest. The slider's `aria-valuetext` carries the same text.
  - One `HoverGroup` spans the two panes.
  - E3 adds `forming` and `mark?: boolean`.
- Produces: `export function candleLegend(data: CandleData): LegendItem[]`.
- Produces: `export const ShareBar: MemoExoticComponent<(props: { title: string; data: ShareData }) => JSX.Element>`.
  - Each row is 28 px high, with a label column. Segments are in their order with 2 px gaps and a 4 px radius at the row's ends.
  - A segment shows its label (`sharePercent(value, total)`) under itself only when its share is at least 18%. The comparison may use `Number()`, as geometry does.
  - A % axis sits under the rows.
  - The cursor steps through the segments in reading order (row, then segment); its text is "{row}: {segment}, {value} of {total} ({share})".
- Produces: `export function shareLegend(data: ShareData): LegendItem[]`.

- [ ] **Step 1: Write the failing tests.**
  - Candles, over 5 candles where one is `null`: 4 `.candle` in the server HTML; an up candle's body class gives `--up`; the `null` slot is empty; 5 volume columns; the y labels on the right; the readout shows the latest candle; `errors` is `[]`. After hydration ArrowLeft moves the readout and the slider text to the candle before. `candleLegend` gives the three labels. It passes the memo and empty-state cases.
  - ShareBar, with rows UNL (35: 12, 10, 8, 5) and All (120: …): the segment widths are their shares; a label shows under a segment of 34% and not under one of 14%; the slider text is "UNL: 3.4.1, 12 of 35 (34%)"; the table view has one column per segment id.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/charts/Candles app/ui/charts/ShareBar`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests to verify they pass.** Run the command of Step 2, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/ui/charts app/ui/charts.css`, with the message `feat(charts): candles over a volume pane, and 100% share bars`.

### Task 13: Sparkline, BarList, Meter, InlineBar, StatTile figure, and the kit's README

**Files:**
- Create: `app/ui/charts/Sparkline.tsx`, `app/ui/charts/BarList.tsx`, `app/ui/charts/Meter.tsx`, `app/ui/charts/InlineBar.tsx`, and a test file for each (`*.test.tsx`)
- Modify:
  - `app/ui/components/StatTile.tsx`: `figure`, `delta`, `trend`; `StatGrid narrow`.
  - `app/ui/components/icons.tsx`: `TriangleUpIcon`, `TriangleDownIcon`.
  - `app/ui/components.css`: `.stat--figure`, `.stat__delta`, `.stat-grid--narrow`.
  - `app/ui/charts.css`
  - `README.md`: a new section "The chart kit", placed after "The UI and the routes" and before "Home and ledger pages", so the page sections stay together. It covers the components, the data shapes, the rules of §2.2 to §2.10, the toggle without JavaScript, memo by token, and the bundle rule.
- Test: the four new test files and `app/ui/components/components.test.tsx` (`StatTile`)

**Interfaces:**
- Produces: `export function Sparkline(props: { values: readonly (string | null)[]; label: string }): JSX.Element`. It is a 100 × 28 px `role="img"` SVG labelled `label`, with a 1.5 px `--faint` line and an 8 px `--accent` end dot with a ring. It has no hover.
- Produces: `export const BarList: MemoExoticComponent<(props: { data: BarListData; dense?: boolean }) => JSX.Element>`. It is an `<ol>`. Each bar is `aria-hidden`, 18 px thick (12 px when `dense`), with a 4 px radius at the data end, in `--series-1`, its width the value over the largest. The tip reads "**1.24B XRP** · 58%", where `share` is the whole share text ("58%", "<1%"). E3 adds `href` and `tip`.
- Produces: `export function Meter(props: { data: MeterData; small?: boolean }): JSX.Element`. The track is `--track` and the fill `--series-1`, 12 px (6 px when `small`), with full radius. The threshold is a 2 px `--fg` tick that reaches 5 px past the track, with its label under it. It is `role="img"` with `aria-label={data.label}`. E3 adds `decorative`.
- Produces: `export function InlineBar(props: { value: string; max: string; tone: "up" | "down" } | { diverging: true; out: string; in: string; max: string }): JSX.Element`. It is always `aria-hidden`.
  - The depth form uses `--up-wash` or `--down-wash` and grows from the row's end, as wide as `value/max`, with a 3 px radius on its open end. It sits behind the row's text: the row must be `position: relative`.
  - The diverging form is 14 px: `--down` to the left of a 1 px `--axis` centre and `--up` to the right, on one scale for every row (`max`).
- Produces: `StatTile(props: { label: string; value: ReactNode; sub?: ReactNode; figure?: boolean; delta?: Delta; trend?: ReactNode })`.
  - `figure` sets the sans, proportional, 24 px, 600 style. The home page's mono 22 px stays the default.
  - `delta` renders in `.stat__delta`, in `--muted`: `TriangleUpIcon` for `sign` 1, `TriangleDownIcon` for −1, no icon for 0, then `text`. It comes after the value and before `sub`.
  - E4 adds `source` and `busy`.
- Produces: `StatGrid(props: { label: string; narrow?: boolean; children: ReactNode })`. `narrow` makes the grid `repeat(auto-fit, minmax(150px, 1fr))`.

- [ ] **Step 1: Write the failing tests.**
  - Sparkline: one `<svg role="img" aria-label="7-day price, from 2.38 to 2.44, +2.5%">`, a path with no `NaN`, and the end dot; a gap for a `null`; no slider after hydration.
  - BarList: 3 `<li>` in the order given; the first bar is 100% wide and the second 50%; the tip text is "1.24B XRP · 58%"; the bars are `aria-hidden`; the same token keeps the nodes.
  - Meter: `role="img"` with `aria-label="84% of the UNL votes yes; 80% needed"`; the fill is 84% wide; the threshold tick sits at 80% with the label "80% needed"; `small` gets the 6 px class.
  - InlineBar: the depth form is 40% wide with `--down-wash` and `aria-hidden`; the diverging form with out "2", in "1" and max "4" is 25% to the left and 12.5% to the right.
  - `StatTile` (`components.test.tsx`): `figure` adds `stat--figure`; `delta={{ text: "+3.2%, 30 full days to Oct 16 vs the 30 before", sign: 1 }}` renders the up triangle (`aria-hidden`) and the text, after the value and before the sub; sign 0 renders no icon; the home page's tiles are unchanged (no `stat--figure`); `StatGrid narrow` has `stat-grid--narrow`.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/charts app/ui/components`.
- [ ] **Step 3: Implement**, and write the README section.
- [ ] **Step 4: Run the tests to verify they pass.** Run the command of Step 2, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/ui README.md`, with the message `feat(charts): sparkline, bar list, meter, inline bars and figure tiles with a delta`.

### Task 14: The network page's parameters and view builder

**Files:**
- Create: `app/domain/network-params.ts`, `app/domain/network-params.test.ts`, `app/server/network-view.ts`, `app/server/network-view.test.ts`, `app/server/deadline.ts`, `app/server/deadline.test.ts`
- Test: those three test files

**Interfaces:**
- Consumes:
  - Task 4: the API types.
  - Task 5: `windowOf`, `bucketStarts`, `pendingCount`, `pendingNote`, `utcDayOf`, `formatUtcDay`, `typeGroups`, `groupCounts`, `typeGroupsNote`, `tokenOf`, `Anchor`.
  - Task 7: the kit types, `compactNumber` and `sharePercent`.
  - Task 1: `Network`, with `features` and `hasAmm`.
- Produces in `app/domain/network-params.ts` (pure; the browser imports it):

```ts
export type Display = "native" | "usd";
export interface NetworkParams { period: WindowPeriod; display: Display }
export const DEFAULT_NETWORK_PARAMS: NetworkParams;                       // { period: "30d", display: "native" }
export const PERIODS: readonly { id: WindowPeriod; label: string }[];    // 7 days, 30 days, 90 days, 1 year
export const USD_ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
export function displaysOf(net: NetworkId): readonly Display[];          // xrpl ["native", "usd"], xahau ["native"]
export function queryOf(url: string): string;                            // the raw query, no "?", without React Router's `_routes=` pairs
export function parseNetworkParams(query: string, net: NetworkId): { params: NetworkParams; canonical: string };
export function networkHref(net: NetworkId, params: Partial<NetworkParams>): string;   // "/xrpl/network", "/xrpl/network?period=1y&in=usd"
export function networkScope(net: NetworkId, params: NetworkParams): string;           // "xrpl", "xrpl?period=1y&in=usd"
```

  - `canonical` reads the first value of `period` and of `in`, drops unknown values and defaults, drops repeats and unknown parameters, and orders `period` then `in`. `in` is only `usd`, on XRPL only.
  - The loader compares `queryOf(request.url)` with `canonical`. React Router hands loaders the raw `request.url`, `.data` and `_routes` included; `url` in the loader arguments has them taken out and re-encoded.
- Produces in `app/server/network-view.ts`:

```ts
export type Part<T> = ({ state: "ok" } & T) | { state: "failed"; reason: string };
export interface SeriesView { buckets: string[]; unit: "day" | "week"; values: (string | null)[]; pending: number; forming: boolean; token: string }
export interface Figure { value: string; delta: Delta | null; sub: string | null }
export interface StripChip { index: number; txCount: number; closeTime: number }
export interface OpenLedgerView { fee: string; minimum: string; queue: string; openSize: string; expected: string; asOf: string }
export interface ValidatorsView { ledger: { index: number; hash: string }; count: string; first: { key: string; short: string; delay: string }[]; href: string | null }
export interface MetricsView { transactions: Figure; interval: Figure; perLedger: Figure; accountsCreated: Figure }
export interface PaymentsView { series: SeriesView; figure: Figure; byCurrency: BarListData; currencies: string }
export interface ExchangesView { series: SeriesView; total: string; pendingWords: string | null }
export type AmmPart = ({ state: "ok" } & { series: SeriesView; total: string }) | { state: "failed"; reason: string } | { state: "off" } | { state: "none" };
export interface NetworkPageData {
  anchor: Anchor; view: NetworkParams; displays: readonly Display[]; currency: string;   // "XRP" | "XAH" | "USD"
  window: { unit: "day" | "week"; note: string };
  strip: StripChip[];
  openLedger: Part<OpenLedgerView>; validators: Part<ValidatorsView>;
  types: Part<{ chart: TimeSeriesData; note: string }>; metrics: Part<MetricsView>; fees: Part<{ chart: TimeSeriesData }>;
  payments: Part<PaymentsView>; exchanges: Part<ExchangesView>; amm: AmmPart;
}
export interface NetworkLoaderData extends NetworkPageData { build: string }
export interface NetworkInput {
  net: Pick<Network, "id" | "native" | "hasAmm" | "features">; view: NetworkParams; last: LastValidated; feesList: readonly FeeRow[];
  feeStats: PromiseSettledResult<Page<"rows", FeeStatsRow>>; types: PromiseSettledResult<Page<"stats", StatsRow>>;
  metrics: PromiseSettledResult<Page<"stats", StatsRow>>; feeDays: PromiseSettledResult<Page<"rows", FeeBucketRow>>;
  payments: PromiseSettledResult<Page<"rows", VolumeRow<PaymentVolumeComponent>>>;
  exchanges: PromiseSettledResult<Page<"rows", VolumeRow<ExchangeVolumeComponent>>>;
  amm: PromiseSettledResult<Page<"rows", VolumeRow<AmmVolumeComponent>>> | "off" | "none";
  validators: PromiseSettledResult<{ ledger: { index: number; hash: string }; answer: LedgerValidations }>;
}
export function networkPage(input: NetworkInput): { page: NetworkPageData; failures: { part: string; error: unknown }[] };
```

  - The per-call builders are exported for the tests: `stripOf`, `openLedgerOf`, `typesOf`, `metricsOf`, `feesOf`, `paymentsOf`, `exchangesOf`, `ammOf`, `validatorsOf`. `networkPage` calls each. A rejection whose reason is a `TooLate` gives the reason "took too long"; any other gives the error's message.
  - Every rule comes from spec §1.6's table. Rows align to the window's buckets by the date's first 10 characters (`date`, `start_time`); a row outside them is ignored, except that #7 and #9 rows of F and P feed the deltas. Shares are `sharePercent` (Task 7).
  - How E6 grows this: it adds key links to `ValidatorsView.first`.
- Produces `app/server/deadline.ts`, which the loader (Task 17) and the later live pages use:
  - `export const CARD_DEADLINE_MS = 4_500;`
  - `export class TooLate extends Error {}`, whose message is "took too long";
  - `export function byDeadline<T>(work: Promise<T>, at: number): Promise<T>`: it rejects with `TooLate` at the absolute time `at` (milliseconds, as `Date.now()`), and clears its timer.

- [ ] **Step 1: Write the failing tests.**
  - `deadline.test.ts`: `byDeadline(new Promise(() => {}), Date.now() + 50)` rejects with a `TooLate` whose message is "took too long". A promise that resolves first wins, and its timer is cleared (`vi.getTimerCount()` is 0 with fake timers).
  - `network-params.test.ts`, with `[query, net]` giving `canonical`:
    - `["", "xrpl"]` gives `""`; `["period=30d", "xrpl"]` gives `""`;
    - `["period=1y&in=usd", "xrpl"]` gives `"period=1y&in=usd"`, and `["in=usd&period=1y", "xrpl"]` the same;
    - `["period=2y", "xrpl"]` gives `""`; `["in=usd", "xahau"]` gives `""`;
    - `["period=7d&period=90d", "xrpl"]` gives `"period=7d"`; `["x=1", "xrpl"]` gives `""`;
    - `["period=1Y", "xrpl"]` gives `""`; `["in=USD", "xrpl"]` gives `""`;
    - `["period=90d&x=1&in=usd", "xrpl"]` gives `"period=90d&in=usd"`; `["period=%37d", "xrpl"]` gives `"period=7d"`.
    - `queryOf`:
      - `"https://e.test/xrpl/network.data?period=1y&_routes=routes%2Fnet.network"` gives `"period=1y"`;
      - `"…/network.data?_routes=routes%2Fnet.network"` gives `""`;
      - `"…/network?period=1y&"` gives `"period=1y&"` (so it is not canonical).
    - `networkHref`: `("xrpl", {})` gives `"/xrpl/network"`; `("xrpl", { period: "1y", display: "usd" })` gives `"/xrpl/network?period=1y&in=usd"`; `("xahau", { display: "usd" })` gives `"/xahau/network"`.
    - `networkScope("xrpl", { period: "1y", display: "usd" })` gives `"xrpl?period=1y&in=usd"`.
  - `network-view.test.ts` (inputs built in the test; `T` = 2026-10-17, close time `17:01:12`):
    - Strip: recorded-style rows of indexes 107721456 (above `latest`), 107721455 (107 txs, `17:01:12Z`) and seven older; latest 107721455. The result is 6 chips, the first `{ index: 107721455, txCount: 107, closeTime: 1792256472 }`.
    - Open ledger: `{ open_ledger_fee: 0.0000125, minimum_fee: 0.00001, current_queue_size: 0, current_ledger_size: 84, expected_ledger_size: 96, date: "2026-10-17T17:01:10Z" }` gives `{ fee: "13", minimum: "10", queue: "0", openSize: "84", expected: "96", asOf: "17:01:10" }`.
    - Alignment: a `7d` types answer missing Oct 13 and carrying a row of Oct 1. The series has 7 values, Oct 13 `null`, no trace of Oct 1, `forming: true` and `pending: 0`. With Oct 17 missing too, `pending` is 1; with Oct 16 and 17 missing, 2; with Oct 15 to 17 missing, 2, and Oct 15 is `null`.
    - Totals over a `7d` metrics answer: each full day of W has `{ transaction_count: 86400, ledger_count: 21600, accounts_created: 10 }`, and the running day `{ 61272, 15318, 5 }`.
      - `transactions.value` is `compactNumber("579672")`, which is `"580K"`;
      - `interval.value` is `"4.00 s"`, with the sub "average time between ledgers";
      - `perLedger.value` is `"4.0"`;
      - `accountsCreated.value` is `"65"`.
    - Deltas: F with Σ transactions 1,032,000 and P with 1,000,000 gives `{ text: "+3.2%, 7 full days to Oct 16 vs the 7 before", sign: 1 }`. Swapped, `"−3.1%, …"` (rounded half up, U+2212). With a day of P missing, `null`; with ΣP = 0, `null`. Nothing of the running day ever counts. `1y` gives `"…, 52 full weeks to Oct 11 vs the 52 before"`.
    - Fees: a day's `avg` of 0.000113 gives `"113"`. For `1y`, a week whose 7 days have Σ total 0.7 and Σ tx_count 6,000 gives `"117"` (116.67, half up). The running week counts its days up to `T`. A week with a day missing is `null`.
    - Volumes: the payments rows end on Oct 16, so `pending` is 1, `figure.sub` is `"to Oct 16; Oct 17 not computed yet"`, and the totals sum W's rows with `bignumber.js`.
    - Payments by currency: two days with the components XRP 600 + 300, USD.rhub8V 300 + 100 and EUR.rhub8V 0.4. The items are XRP (69%), USD (31%, the sublabel `"rhub8V…F3wq"`, which is `shortAddress`) and EUR (`"<1%"`), sorted by value. A 40-hex `524C55…` is labelled `"RLUSD"`. `currencies` is `"Payments in the currencies the data API tracks: XRP, USD, EUR."`.
    - AMM: a fulfilled answer gives `ok` with its total; a rejection (`server`, "Cannot GET …") gives `failed` with the error's message; `"off"` gives `{ state: "off" }`; `"none"` gives `{ state: "none" }`. The wording each state gives is tested in Task 16 (`network-volume.test.ts`).
    - Validators: 7 validations, `first_datetime` from `.100Z` to `.400Z`, unsorted. The count is `"7"`. `first` has 5 entries, sorted, with the delays `"+0 ms"`, `"+40 ms"`, …, and `short` `"nHUFE9prPX…a3p"` (the first 10 characters, "…", the last 3). An answer with a `marker` gives `"1,000+"`. `href` is `"/xrpl/validators?scope=all"` with `features.validators` and `null` without.
    - Failures: a rejected #6 gives `types: { state: "failed", reason }` and an entry in `failures`. A rejected #7 fails `metrics`. A call rejected with `new TooLate()` gives the reason `"took too long"`.
    - Tokens: two `networkPage` calls on equal input give equal tokens on every chart. Changing one value of one bucket changes only that chart's token.
    - No floats: every value in `Series.values`, `totals` and `BarListData` items matches `/^\d+(\.\d+)?$/`. No string anywhere in the page matches `/e[+-]\d|\d\.\d{12,}/`.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/domain/network-params app/server/network-view app/server/deadline`.
- [ ] **Step 3: Implement.**
  - Tile texts:
    - transactions and accounts: `compactNumber`;
    - interval: `toFixed(2, ROUND_HALF_UP) + " s"`;
    - per ledger: 1 decimal;
    - payments: `compactNumber + " " + currency`.
  - The chart titles are the page's (Task 16). The type groups' series are `{ id, label, slot }`, with `format { kind: "count", unit: "transactions" }`; `totals` is the per-bucket Σ.
  - The fee chart is one series `{ id: "fee", label: "Average fee", slot: 1 }`, with `format { kind: "drops", unit: "drops" }`.
  - `window.note` is `"Totals and charts cover " + windowOf(…).note`. With `usd`, add `", amounts in USD issued by GateHub at each day's DEX rate"`.
- [ ] **Step 4: Run the tests to verify they pass.** Run the command of Step 2, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/domain/network-params.ts app/domain/network-params.test.ts app/server/network-view.ts app/server/network-view.test.ts app/server/deadline.ts app/server/deadline.test.ts`, with the message `feat(network): canonical views, the card deadline and the view builder of the network page`.

### Task 15: Synthetic fixtures for the network page

**Files:**
- Create: `scripts/synthetic.ts`, `scripts/network-fixtures.ts`, `test/unit/network-fixtures.test.ts`, and the generated files under `test/fixtures/http/{xrpl,xahau}/data-api/` (written by `pnpm fixtures:sync`)
- Modify:
  - `scripts/http-fixtures.ts`: `generate()` adds `networkFixtures(...)` for each network.
  - `test/fixtures/PROVENANCE.md`: a new section "Synthetic aggregates".
  - `README.md` "Upstream fixtures": the new rows, marked "generator (synthetic)"; the generated rows marked "generator (derived)"; the hand-written rows keep "by hand".
- Test: `test/unit/network-fixtures.test.ts`, `scripts/http-fixtures.test.ts` (unchanged; it covers the new files)

**Interfaces:**
- Consumes (Task 5): `windowOf`, `fnv1a32`. Consumes the API types (Task 4) and `encodeNodePublic` from `ripple-address-codec`.
- Produces `scripts/synthetic.ts`, which E3 to E6 generators reuse: `export function mulberry32(seed: number): () => number` and `export function seedOf(...parts: string[]): number` (`fnv1a32(parts.join(" "))`).
- Produces `scripts/network-fixtures.ts`: `export function networkFixtures(net: NetworkName, last: LastValidated, newest: readonly { index: number; hash: string }[]): Array<{ path: string; query: string; value: unknown }>`. `generate()` puts each through its `api(net, path, query, value)`. `newest` is the two newest rows of the recorded fees list and their hashes.

Files written per network (`T` = 2026-10-17 on both; the queries are the loader's, built from `windowOf(T, period)` for `7d`, `30d`, `90d` and `1y`; `u` is `day`, or `week` for `1y`):

| Path below `<net>/data-api/` | Content |
|---|---|
| `ledgers/<HASH>/validations@limit=1000.json`, for the two newest | 35 validations on XRPL, 25 on Xahau. `validation_public_key`s are `encodeNodePublic` of seeded 33-byte keys. `first_datetime` is the close time plus 0 to 400 ms. Keys sorted, in the reference's key order. |
| `network/fee_stats@descending=true&limit=1&start=2026-10-17.json` | one snapshot 2 s before the close; on XRPL `open_ledger_fee` 0.00001, `minimum_fee` 0.00001, queue 0, open 84, expected 96 |
| `stats/type@end=…&interval={u}&limit=1000&start={W₀}.json` | per bucket of W, zero counts left out, names sorted |
| `stats/metric@end=…&interval={u}&limit=1000&metrics=accounts_created,ledger_count,transaction_count&start={P₀}.json` | from P₀; `transaction_count` is the Σ of that bucket's type columns; about 22,150 ledgers a day on XRPL and 21,600 on Xahau; the running day pro rata to 17:01:12 or 17:47:11 |
| `network/fees@end=…&interval=day&limit=1000&start={W₀}.json` | days of W, the running day included |
| `network/payment_volume@end=…&interval={u}&limit=1000&start={P₀}.json`, and on XRPL with `&exchange_currency=USD&exchange_issuer=rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq` | components: the native currency plus the markets config's payment currencies; sorted by `converted_amount`; `rate` = amount / converted_amount to 8 significant digits; day files end on Oct 16; the running week has the days so far; USD rows are the native rows at a seeded daily rate |
| `network/exchange_volume@…start={W₀}…` (and USD on XRPL) | the markets config's trade markets |
| `network/amm_volume@…start={W₀}…`, XRPL only (and USD) | 3 seeded pools; the native pools have `counter` XRP |

  - The file names are `dataApiFile`'s, with the parameters sorted. The table shows them loosely.
  - The markets configs are copied into the generator with their source: `data-api-new` `packages/shared/config/markets/{xrpl,xahau}.json` at `ff659c9`.
  - The seeds are `seedOf(net, endpoint)`.
  - The lines are those of `fixtureText`.

- [ ] **Step 1: Write the failing test** `test/unit/network-fixtures.test.ts`, which reads the written files:
  - every file above exists for both networks, and there is no `amm_volume` file on Xahau;
  - the type rows hold no 0 and their keys are sorted;
  - for each bucket, `transaction_count` equals the Σ of the type columns of the same bucket;
  - XRPL full days have `ledger_count` between 21,000 and 23,000;
  - the components are sorted by `converted_amount`, descending;
  - every `rate` is `amount / converted_amount` to 8 significant digits;
  - the day volume files' last `start_time` is `2026-10-16T00:00:00Z`; the `stats` and `fees` files have a row for 2026-10-17;
  - each validation key decodes with `decodeNodePublic`;
  - a second run of `networkFixtures` gives identical output (deterministic).
- [ ] **Step 2: Run it to verify it fails.** `pnpm test test/unit/network-fixtures`.
- [ ] **Step 3: Implement**, run `pnpm fixtures:sync`, and write the provenance. The provenance section names the generator, the seeds, `main` `ff659c9` (the shapes) and `feat/amm-data` `c3e2302` (`amm_volume`), and says that only an end-to-end run against a real stack (`E2E_DATA_API_URL`) checks them against real answers.
- [ ] **Step 4: Run the tests to verify they pass.** Run `pnpm test test/unit/network-fixtures scripts/http-fixtures` and `pnpm fixtures:check`, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add scripts test/unit/network-fixtures.test.ts test/fixtures README.md`, with the message `test(fixtures): seeded synthetic aggregates, fee snapshots and validations for the network page`.

### Task 16: The network page component

**Files:**
- Create:
  - `app/ui/components/LiveRow.tsx`, `app/ui/components/LiveRow.test.tsx`
  - `app/ui/components/SegmentedLinks.tsx`, `app/ui/components/SegmentedLinks.test.tsx`
  - `app/ui/pages/NetworkPage.tsx`, `app/ui/pages/NetworkPage.test.tsx`, `app/ui/pages/network-volume.ts`, `app/ui/pages/network-volume.test.ts`
  - `app/ui/use-refetching.ts`
- Modify:
  - `app/ui/pages.css`: `.network` layout; the open-ledger block; the `flex: 1 1 420px` card pairs; the validators card.
  - `app/ui/components.css`:
    - `.seglinks` and `.seglinks__label` (the visible label beside a `netswitch` group);
    - `.chips`, `.chip`, and `.chip.is-entering` with a new `chip-enter` keyframe (fade, and `translateX(-8px)`), plus `live-flash` and `row-mark`; under 640 px, the 4th chip on is hidden.
  - `test/unit/live-motion-css.test.ts`: the chip selectors, and `--sunken` among the wash's backgrounds, with `--fg` and `--muted` at AA under the 2% wash on both accents.
- Test: the four new test files and `test/unit/live-motion-css.test.ts`

**Interfaces:**
- Consumes:
  - Task 14: `NetworkPageData`, `Part`, `AmmPart`, `SeriesView`, `networkHref`, `PERIODS`, `displaysOf`.
  - Task 6: `LiveControls`, `useHolds`, `useLiveRows`.
  - Tasks 8 to 13: the kit.
  - Task 5: `pendingNote`, `tokenOf`. Task 7: `compactNumber`.
  - The existing `LiveValue`, `LiveStatus`, `LiveToggle`, `RelativeTime` and `SectionError`.
- Produces `app/ui/components/LiveRow.tsx`, the live row of every page that follows the chain (E3's pair page, E6's four pages):

```ts
export type LiveRowControls = Pick<LiveControls, "paused" | "held" | "notice" | "failures" | "onTogglePause">;
export function LiveRow(props: {
  label: string;            // the line beside the dot: "Live · updates every ledger"
  live?: LiveRowControls;   // absent (a page drawn without its route, as in tests): the dot and the label only
  heldNote?: string;        // shown while live.held; default "Paused while you look at the table"
}): JSX.Element;
```

  - It renders the home hero's parts and classes. A `div.hero__status-row`, 44 px high from the start, holds:
    - `p.hero__status`, with the dot (`span.hero__dot`, `aria-hidden`, `is-paused` while `paused`, `held` or `failures ≥ PAUSED_AFTER_FAILURES`), the label, and `LiveStatus` (`failures`, `paused`, `notice`);
    - `span.hero__held` with `heldNote`, while `held`;
    - `LiveToggle` (`paused`, `onToggle={onTogglePause}`), which appears only after hydration.
  - It holds no `<h1>` and no breadcrumb: the page puts its own heading beside it.
  - The home page keeps its own hero line; it is not moved onto `LiveRow`.
- Produces `app/ui/components/SegmentedLinks.tsx`, the segmented control of links of every filter row (E3, E4, E6, E5):

```ts
export interface SegmentLink { label: string; href: string; current: boolean }
export function SegmentedLinks(props: { label: string; links: readonly SegmentLink[] }): JSX.Element;
```

  - It renders `div.seglinks` containing:
    - `span.seglinks__label` with `label`, visible;
    - a `div.netswitch` with `role="group"` and `aria-labelledby` pointing at that span;
    - one React Router `Link` per entry: `to={href}`, `preventScrollReset`, `className="netswitch__item"`, `aria-current="true"` when `current` and no `aria-current` otherwise.
  - The segments are 32 px to look at, with a 44 px target, from the existing `netswitch` CSS.
- Produces `app/ui/pages/network-volume.ts` (pure):
  - `export interface AmmWording { dexLabel: string; dexShort: string; dexSub: string; note: string; source: string; ammLine: boolean; ammProblem: boolean }`
  - `export function ammWording(amm: AmmPart): AmmWording`, with the wordings of spec §1.3. The `failed` state keeps the `ok` note (the spec gives none of its own). `dexSub` for `ok` is `` `AMM swaps ${compactNumber(total)}, all pools` ``.
  - `export function volumeChart(payments: NetworkPageData["payments"], exchanges: NetworkPageData["exchanges"], amm: AmmPart, currency: string): TimeSeriesData | null`. It is `null` when payments or exchanges failed.
    - The axis is the payments series' axis. The other series align to it by date (a kept part from before midnight may have another axis).
    - The series are Payments (slot 1, short "payments"), the DEX line (slot 2, short "DEX trades"), and AMM swaps, all pools (slot 3, short "AMM swaps") when `ammLine`.
    - `pending` is the largest of the included parts'. `token` is `tokenOf` of the parts' tokens and the labels.
- Produces `app/ui/use-refetching.ts`: `export function useRefetching(): boolean`. It is true while a navigation to the same pathname (another view) is loading. The page puts `.is-refetching` on its body, which dims the charts to 0.55.
- Produces `app/ui/pages/NetworkPage.tsx`: `export const NETWORK_TITLES = { xrpl: "XRPL network", xahau: "Xahau network" } as const` and `export function NetworkPage(props: { network: NetworkInfo; data: NetworkPageData; live?: LiveControls }): JSX.Element`. It draws spec §1.3, in order:
  1. The heading row: the `<h1>`, then `<LiveRow label="Live · updates every ledger" live={live} heldNote="Paused while you look at the ledgers" />`.
  2. `section aria-label="Latest ledgers"`:
     - `<ol class="chips">`, keyed by index (`useLiveRows`, `live`). Each chip is a link to `/{net}/ledger/{index}`: "#107,695,660" (mono) over "84 txs · {RelativeTime} ago", in `--fg` and `--muted` only. The strip holds the page through `useHolds(live?.onHold)("strip")`.
     - The open-ledger block: "Open ledger fee **10 drops**", "Queue **0** · 84 of 96 expected in the open ledger", "as of 17:01:10 UTC", and `/v2/network/fee_stats`. When it failed, `SectionError what="the open ledger"`.
  3. `role="group" aria-label="Filters"`:
     - `<SegmentedLinks label="Period" links={PERIODS.map(...)} />`, each `{ label, href: networkHref(net, { ...view, period }), current }`;
     - `<SegmentedLinks label="Amounts in" … />` with `{native}` and USD, only when `displays.length > 1`;
     - then the period note.
  4. `StatGrid narrow label="Totals"`, with six `StatTile figure`s:
     - Transactions, Ledger interval, Transactions per ledger and Accounts created come from `metrics`;
     - Payment volume is `payments.figure`;
     - DEX volume is `` `${compactNumber(exchanges.total)} ${currency}` ``, its sub `[wording.dexSub, exchanges.pendingWords]`, joined by "; " when both are present.
     - A tile of a failed part shows "—" with the sub "Couldn't load".
     - When any of `metrics`, `payments` or `exchanges` failed, there is one `SectionError what="some totals"` under the tiles.
  5. `ChartCard` "Transactions by type, per day|week" (`id` `network-types`, source `/v2/stats/type?interval={u}`): a stacked `ColumnChart`, `legendOf(…, "swatch")`, and the note.
  6. `ChartCard` "Average fee per transaction, in drops" (`network-fees`, `/v2/network/fees?interval=day`): `LineChart area`. Its note is "1 {native} = 1,000,000 drops. Spikes mean the open ledger was busy." plus " The minimum to enter the queue now is {minimum} drops." while `openLedger` is ok.
  7. `ChartCard` "Volume per day|week, in {currency}" (`network-volume`, source `wording.source`): `LineChart` of `volumeChart`, `legendOf(…, "line")`, the notes `[wording.note, pendingNote(…)]`. With `ammProblem`, a `SectionError message="AMM swaps couldn't be loaded."`.
  8. `ChartCard` "Payment volume by currency, last 7 days|30 days|90 days|52 weeks" (`network-currencies`, `/v2/network/payment_volume · components`): `BarList`, with the `currencies` note.
  9. The card "Validators" (`/v2/ledgers/{hash}/validations`):
     - "**35** validators signed ledger #…" (the number links to the ledger page);
     - "First seen": 5 keys, mono, each with its delay, in one `LiveValue` keyed by the ledger hash;
     - the note "Counts every validator the data API's collectors heard, on the UNL or not.";
     - "All validators" as a link to `href`, or, when it is `null`, `<span class="nav-item is-soon" aria-disabled="true">All validators <span class="soon">soon</span></span>`.
  - Every figure that changes is a `LiveValue` whose token is its text. Retry is `useRevalidator().revalidate()`.

- [ ] **Step 1: Write the failing tests.**
  - `LiveRow.test.tsx` (`serverThenHydrated`, inside a data router):
    - the server HTML has `div.hero__status-row` with the label;
    - without `live` there is no `role="status"` and no button;
    - with `live`, exactly one `role="status"`;
    - after hydration the toggle "Pause live updates" calls `onTogglePause`;
    - `held: true` shows the `heldNote` given, or "Paused while you look at the table" without one;
    - the dot has `is-paused` for `paused`, for `held`, and for `failures: 2`, and not for `failures: 1`.
  - `SegmentedLinks.test.tsx`, in a data router:
    - the visible label "Period" names the group (`getByRole("group", { name: "Period" })`);
    - the links have their hrefs in order;
    - only the `current` one has `aria-current="true"`;
    - each is `.netswitch__item`;
    - clicking one navigates without scrolling the window back to the top (`window.scrollTo` not called).
  - `network-volume.test.ts`:
    - `ammWording` for `ok` with total `"1200000000"` is `{ dexLabel: "DEX trades, tracked markets, AMM swaps included", dexSub: "AMM swaps 1.2B, all pools", note: "DEX trades count the markets the data API tracks; AMM swaps count every pool, so the lines are not parts of one total.", ammLine: true, ammProblem: false }`;
    - `failed`: the same labels, `dexSub: "tracked markets, AMM swaps included"`, `ammLine: false`, `ammProblem: true`;
    - `off`: `dexLabel: "DEX trades, tracked markets"`, `dexSub: "tracked markets"`, `note: "DEX trades count the trades of the markets the data API tracks."`, and a source without `amm_volume`;
    - `none`: `dexSub: "order book only, no AMM on Xahau"`, `note: "Xahau has no AMM; DEX trades are order-book trades of the markets the data API tracks."`;
    - `volumeChart` with an exchanges part whose axis starts a day earlier aligns it by date, and it is `null` when `payments` failed. Its pending is 1 when the payments are pending 1.
  - `NetworkPage.test.tsx`, rendered in a data router with a full fixture `NetworkPageData`:
    - every card state of spec §1.8, one case each, with its exact text;
    - the tiles' `LiveValue`: a re-render with a changed transactions figure animates only that tile;
    - the strip's hold: a mouse `pointerenter` calls `onHold(true)`, and unmounting calls `onHold(false)`;
    - the four AMM wordings, in the DEX tile and the volume legend;
    - "All validators" as a link (`href` set) and as "soon" (`null`);
    - the Xahau page has no "Amounts in";
    - there is no `aria-live` and exactly one `role="status"`;
    - the period links (through `SegmentedLinks`) carry `aria-current="true"` on the current one, and their hrefs are `networkHref(...)`;
    - the heading row is a `LiveRow` with "Paused while you look at the ledgers" while held.
  - `test/unit/live-motion-css.test.ts`:
    - `.chip.is-entering` runs `chip-enter` (from `translateX(-8px)`), `live-flash` and `row-mark`, each once, 600 ms of movement at most;
    - under reduced motion only `live-flash` and `row-mark`;
    - `--sunken` is checked with `--fg` and `--muted` under the wash.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/components/LiveRow app/ui/components/SegmentedLinks app/ui/pages/Network app/ui/pages/network-volume test/unit/live-motion-css`.
- [ ] **Step 3: Implement**, with the board `Network.dc.html` for the layout. Under 640 px the strip shows 3 chips with the open ledger below them, and the page is one column.
- [ ] **Step 4: Run the tests to verify they pass.** Run the command of Step 2, then `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/ui test/unit/live-motion-css.test.ts`, with the message `feat(network): the network page, drawn from its parts, with the shared live row and segmented links`.

### Task 17: The route, its loader and the Worker specs

**Files:**
- Create:
  - `app/routes/net.network.tsx`
  - `test/worker/network-page.spec.ts`, `test/worker/network-calls.spec.ts` (a file of its own: the exact calls need a cache nobody has used)
  - `test/worker/network-off.spec.ts` (`worker-off` project), `test/unit/network-bundle.test.ts`
- Modify:
  - `app/routes.ts`: `route("network", "routes/net.network.tsx")` under `:net`.
  - `app/server/meta.ts`: `networkMeta`.
  - `app/server/meta.test.ts`, `test/worker/meta.spec.ts`
  - `test/worker/network-hold.spec.ts`: the network page's cases.
  - `app/ui/routes-wiring.test.tsx`
  - `scripts/bundle-budget.ts`: `PAGES` gains `{ name: "network", route: "routes/net.network" }`.
  - `scripts/check-bundle.test.ts`
- Test: the files above

**Interfaces:**
- Consumes everything above. The calls are made with these options, where `live = { ttl: HOME_CALL_TTL_SECONDS, holdFailure: true }`, `period = { ttl: PERIOD_CALL_TTL_SECONDS, holdFailure: true }` and `w = windowOf(utcDayOf(anchor.closeTime), view.period)`:

| # | Call |
|---|---|
| 1 | `lastValidated(live)` |
| 2 | `fees({ descending: true, limit: 8 }, live)` |
| 3 | `ledger(String(latest), { holdFailure: true })`, only when `latest ≠ Number(last.ledger_index)` |
| 4 | `ledgerValidations(hash, { limit: 1000 }, { holdFailure: true })` |
| 5 | `feeStats({ descending: true, limit: 1, start: w.end }, live)` |
| 6 | `stats("type", { interval: w.unit, start: w.start, end: w.end, limit: 1000 }, period)` |
| 7 | `stats("metric", { …, start: w.previous.start, metrics: ["accounts_created", "ledger_count", "transaction_count"] }, period)` |
| 8 | `fees({ interval: "day", start: w.start, end: w.end, limit: 1000 }, period)` |
| 9 | `paymentVolume({ interval: w.unit, start: w.previous.start, end: w.end, limit: 1000, ...usd }, period)` |
| 10 | `exchangeVolume({ interval: w.unit, start: w.start, end: w.end, limit: 1000, ...usd }, period)` |
| 11 | `ammVolume(same as #10, period)`, only when `net.features.ammData && net.hasAmm` |

  - `usd` is `{ exchangeCurrency: "USD", exchangeIssuer: USD_ISSUER }` when `view.display === "usd"`.
  - From Task 14: `CARD_DEADLINE_MS`, `byDeadline`, `networkPage`, `queryOf`, `parseNetworkParams`, `networkHref`, `networkScope`.
- Produces in `app/routes/net.network.tsx`:
  - `headers = forwardCacheClass`; `handle = { navSection: "network" } satisfies NetworkRouteHandle`;
  - `loader`, `clientLoader`, `meta` and the component;
  - the module-level constant `NETWORK_PARTS = ["openLedger", "validators", "types", "metrics", "fees", "payments", "exchanges", "amm"] as const` (not exported);
  - `onScreen = createLiveOnScreen<NetworkLoaderData>({ order: (d) => d.anchor.lastValidated, merge: (next, shown) => keepLoaded(next, shown, NETWORK_PARTS) })`.
- Produces in `app/server/meta.ts`: `export function networkMeta(view: NetworkParams, ctx: MetaContext): MetaDescriptor[]`.
  - The title is `"XRPL network · explorer"`. A view other than the default adds `" · last 7 days"`, `"last 90 days"` or `"last 52 weeks"`, and `" · in USD"`, before `" · explorer"`.
  - The description is spec §1.10's, verbatim.
  - The default view gets `sharing()` with the URL `/{net}/network`. Any other view gets the title, the description and `robots: "noindex, follow"` only.

- [ ] **Step 1: Write the failing tests.**
  - `meta.test.ts`, for `networkMeta`:
    - default: title, description, canonical `https://e.test/xrpl/network`, `og:*`, `twitter:card=summary`, no `og:image`;
    - `{ period: "90d", display: "usd" }`: the title `"XRPL network · last 90 days · in USD · explorer"`, `noindex, follow`, no canonical and no `og:*`.
  - `test/worker/network-page.spec.ts` (fake `Date` moved 31 s on after every test, past any hold; failures first, in this order). Each overridden key is one no earlier test has stored: `stats/type`, `stats/metric` and the daily `fees` are shared by a period's native and USD views, `last_validated`, `fees?descending=true&limit=8` and `fee_stats` by every view of a network.
    - #1 failing on `/xahau/network` gives a 503 with `Retry-After`, not stored.
    - #2 failing on `/xahau/network` gives a 503.
    - #4 503 on `/xahau/network?period=7d` gives a 200 with "Couldn't load the validators", `Cache-Control: no-store`, not stored.
    - #5 503 on `/xrpl/network` gives "Couldn't load the open ledger", and the fee note without "The minimum to enter the queue".
    - #6 on `/xrpl/network?period=7d` gives "Couldn't load transactions by type".
    - #7 on `/xrpl/network?period=90d` gives four "—" and "Couldn't load some totals".
    - #8 on `/xrpl/network?period=1y` gives "Couldn't load the average fee".
    - #9 on `/xrpl/network?period=7d&in=usd` gives the payment tile "—", and the volume and by-currency cards failed.
    - #10 on `/xrpl/network?in=usd` gives the DEX tile "—" and the volume card failed.
    - #11 overridden to `null` on `/xrpl/network?period=90d&in=usd` gives "AMM swaps couldn't be loaded.", the DEX sub "tracked markets, AMM swaps included", `no-store`, not stored, and a logged problem. A second render within 5 s makes no new `amm_volume` request (`statusesOf` is `[404]`).
    - #6 never answering on `/xahau/network?period=1y`: the card failed after about 4.5 s, and the page is still a 200.
    - All of these are degraded and never stored.
    - The class: `/xahau/network` and `/xahau/network.data?_routes=routes%2Fnet.network` are stored `live-home` (1 s), and the `.data` answer is a 200, not a redirect.
    - Redirects, each a 302 with `max-age=0` and nothing called upstream:
      - `?period=30d` to `/xrpl/network`;
      - `?in=usd&period=1y` to `/xrpl/network?period=1y&in=usd`;
      - `/xahau/network?in=usd` to `/xahau/network`;
      - `?x=1` to `/xrpl/network`.
    - No JavaScript needed: the HTML holds 30 `.col`, `<path class="line"`, `<path class="area"`, `.chart__table` rows, the radios, and "Oct 17, 2026, so far".
    - Meta on the default and the 90-day view, as above. The same two cases go into `test/worker/meta.spec.ts`.
  - `test/worker/network-calls.spec.ts`:
    - The first render of `/xrpl/network` makes exactly the `mock.requests` keys of #1, #2, #4, #5 and #6 to #11, with the query strings from the recorded `last_validated` (`end=2026-10-17`, `start=2026-09-18` or `2026-08-18`). There is no #3.
    - The XRPL views are then rendered in the order `7d`, `90d`, `1y`, and the four USD views. Among each render's requests, the period keys (#6 to #11) are exactly those it shares with no earlier view: #6 to #11 for a native view; #9 to #11, with `exchange_currency=USD&exchange_issuer=rhub8V…`, for a USD view. #1, #2, #4 and #5 are kept for seconds, so later renders do not assert them.
    - On Xahau there is no #11 and no `exchange_currency`.
    - With `"xahau GET /v2/network/fees?descending=true&limit=8"` overridden to its rows without the first, the calls include `GET /v2/ledgers/{second newest index}`, then the validations of that ledger's hash.
    - A home render right after the network page's makes no `last_validated` or `fees?descending=true&limit=8` request (the shared `[kept 2 s]` entries).
  - `test/worker/network-off.spec.ts` (`worker-off`), for `/xrpl/network`:
    - no `amm_volume` request;
    - the legend has "DEX trades, tracked markets" and no "AMM swaps";
    - the DEX sub is "tracked markets";
    - "All validators" is `.is-soon`;
    - the header's Markets and AMM are "soon".
  - `test/worker/network-hold.spec.ts`:
    - a failing #6 (503) on two renders 1 s apart gives `statusesOf` `[503]`, and at +5.001 s `[503, 503]`;
    - a 429 with `Retry-After: 12` is held 12 s;
    - after a `/xahau` render with a failing `last_validated`, a `/xahau/network` render within 5 s makes no `last_validated` request and is a 503 (one key for both pages).
  - `routes-wiring.test.tsx`, with the real `net.tsx` and `net.network.tsx`:
    - the `clientLoader` reloads through the scope `xrpl?period=1y` on that view;
    - a refresh answered 503 keeps the page;
    - an answer whose `amm` is `failed` while the page shows it `ok` keeps the AMM line;
    - an answer with a lower `anchor.lastValidated` is refused.
  - `test/unit/network-bundle.test.ts`: `ui/pages/NetworkPage.tsx`, `ui/pages/network-volume.ts`, `domain/network-params.ts`, `domain/window.ts`, `domain/fnv.ts`, `ui/live-page.ts`, `ui/use-hold.ts` and `ui/use-refetching.ts` import nothing of `server`, `describe` or `parse` as values.
  - `scripts/check-bundle.test.ts`: `PAGES` includes the network page.
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/meta test/worker/network test/worker/meta app/ui/routes-wiring test/unit/network-bundle scripts/check-bundle`, plus `pnpm test --project worker-off`.
- [ ] **Step 3: Implement the loader**, as spec §1.6 says:
  1. `requireNetwork`.
  2. Compare `queryOf(request.url)` with `canonical`. When they differ, return `redirect(networkHref(...), { status: 302, headers: cacheClassHeaders("short") })` before any call.
  3. #1, else `upstreamOutage(err, "the network")`.
  4. `anchorOf`, then `w`. Set `deadline = start + CARD_DEADLINE_MS`.
  5. `Promise.allSettled` of #2, #5 to #11 (#11 only when its condition holds; else `"off"` or `"none"`), and the chain (#2, then `latestLedgerIndex`, then #3 or `last.ledger_hash`, then #4). Each card call and the chain go through `byDeadline`.
  6. A failed #2 is `upstreamOutage`, thrown only after everything has settled.
  7. `networkPage`.
  8. `logProblem` for each failure, then `markDegraded(context, "network: " + parts.join(", "))`.
  9. `cached({ ...page, build: BUILD_ID } satisfies NetworkLoaderData, "live-home")`.

  The component wires the page as the home route does:
  - `clientLoader` calls `onScreen.reload(networkScope(params.net, parseNetworkParams(queryOf(request.url), params.net).params), serverLoader)`;
  - `useEffect(() => onScreen.show(scope, loaderData))`;
  - `useLiveControls(onScreen)`;
  - `<NetworkPage key={scope} …>`.
- [ ] **Step 4: Run the tests to verify they pass.** Run the command of Step 2, then `pnpm verify`. `pnpm check:bundle` lists `network`. Write down its figure: if it is over 145,000 B, apply the fallback in Task 18.
- [ ] **Step 5: Commit.** `git add app scripts test`, with the message `feat(network): /{net}/network, live, cached a second, every call held when it fails`.

### Task 18: End to end, accessibility, the bundle and the README

**Files:**
- Create: `test/e2e/network-page.spec.ts`, `test/e2e/network-live.spec.ts`
- Modify:
  - `playwright.config.ts`: `const LIVE_SPECS = ["**/live-home.spec.ts", "**/*-live.spec.ts"]` replaces `LIVE_SPEC`. It is the `testMatch` of the `live` project and the `testIgnore` of `chromium`. A later plan's `*-live.spec.ts` then needs no Playwright edit.
  - `test/e2e/a11y.spec.ts`
  - `scripts/e2e-env.ts`: `featuresOff`.
  - `scripts/e2e-env.test.ts`
  - `test/e2e/fixture-control.ts`: `xrplNextDay()`.
  - `README.md`: the sections listed in Step 3.
  - Only if the projection says so: `scripts/bundle-budget.ts` and `scripts/check-bundle.test.ts` (the manifest joins the check).
  - Only if the network page is over 145,000 B: `app/ui/charts/CursorSlot.tsx` (new), with the kit's chart components importing it in place of `Cursor`.
- Test: the e2e specs and `scripts/e2e-env.test.ts`

**Interfaces:**
- Consumes `FEATURE_VARS`, `FeatureVar` (Task 1).
- Produces in `scripts/e2e-env.ts`: `export function featuresOff(env: Record<string, string | undefined>): ReadonlySet<FeatureVar>`. It reads `E2E_FEATURES_OFF` as a comma list, trims each name and ignores empty ones. It throws for a name that is not in `FEATURE_VARS`. E3 to E6 tests skip themselves with it.
- Produces in `test/e2e/fixture-control.ts`: `export function xrplNextDay(): Record<string, unknown>`. It overrides `last_validated` with index 107721456, closed `2026-10-18T00:00:05Z`. Every period key is then new and has no fixture.
- Produces, only on the fallback, `app/ui/charts/CursorSlot.tsx`: `export function CursorSlot(props: CursorProps): JSX.Element | null`, with exactly `Cursor`'s props.
  - It renders the same transparent `role="slider"` layer, with `Cursor`'s attributes.
  - On the first `pointerenter` or `focusin`, it loads `import("./Cursor")` and renders `<Cursor {...props} />` in its place, forwarding every prop unchanged, including props later plans add (`pageStep`).
  - The event that triggered the load is replayed, so the first focus already shows the newest bucket.

- [ ] **Step 1: Write the tests.**
  - `scripts/e2e-env.test.ts`: `featuresOff({})` is empty; `{ E2E_FEATURES_OFF: " AMM_DATA, ,VALIDATORS" }` gives both; `"MARKET"` throws.
  - `test/e2e/network-page.spec.ts`:
    - "Network" in the header leads to `/xrpl/network` in one document, with `aria-current="page"`.
    - With JavaScript off (`contextFor({ javaScriptEnabled: false })`), the columns are visible, and checking Table hides `.chart__view` and shows the rows.
    - "1 year" changes the URL to `?period=1y`, draws 52 columns, adds `noindex`, and removes the canonical link. Back restores them.
    - "USD" sets `in=usd`. `/xahau/network` has no "Amounts in".
    - A pointer over the stacked chart shows a tooltip with the date and "total". Tabbing to its slider and pressing Arrow Left changes `aria-valuetext`.
    - The AMM line and its legend entry are there, unless `featuresOff(process.env).has("AMM_DATA")`, in which case the test checks the `off` wording.
    - The newest column's tooltip reads "Oct 17, 2026, so far", and the volume card notes "Oct 17 is not computed yet."
  - `test/e2e/network-live.spec.ts` (the `live` project; each test `test.slow()`). The views it uses, `?period=7d&in=usd` and `?period=90d&in=usd`, and every 90-day view, are opened by no other spec, because their period answers would otherwise be kept 300 s before these tests change them.
    - The chain moves on with `xrplHomeOneLedgerBehind()`, then `fixtures.reset()`. A new chip enters with `.is-entering`, the others get a transform, and only `/xrpl/network.data?…&_routes=routes%2Fnet.network` is requested. With `reducedMotion: "reduce"` there is no transform. Pause and resume work. A mouse over the strip shows "Paused while you look at the ledgers".
    - With the browser's `.data` requests answered 503 by `page.route` (as `live-home.spec.ts` does), the page stays and says "Live updates paused, retrying…" after two.
    - With `"GET /v2/network/amm_volume?…"` (the `7d` USD key) overridden to `null`, `/xrpl/network?period=7d&in=usd` says "AMM swaps couldn't be loaded." with Retry.
    - With `xrplNextDay()` overridden after the default page has loaded, the next beats fail every part, and the AMM line and every card stay (`keepLoaded`).
    - With `stats/type` of `?period=90d&in=usd` overridden to a 503, the card says "Couldn't load transactions by type". After `fixtures.reset()` it comes back by itself within 10 s.
  - `test/e2e/a11y.spec.ts` (the existing gate):
    - `/xrpl/network` at 1280 px and 375 px, under the four theme settings;
    - in the two system themes: `/xrpl/network?period=1y&in=usd`, `/xahau/network`, the default page with every Table radio checked, a page with a failed card (a fixture override), and the default page with a slider focused and its tooltip shown;
    - `landmark-unique` and the ARIA "needs review" test include `/xrpl/network`.
- [ ] **Step 2: Run them.** `pnpm test scripts/e2e-env` and `pnpm test:e2e`. Fix the page until it passes; the tests do not change.
- [ ] **Step 3: Measure the bundle and write the README.**
  - Run `pnpm build && pnpm check:bundle`. If the network page is over 145,000 B, add `CursorSlot` as specified above and measure again.
  - Measure the manifest and the shared base as in Task 1 Step 0, and record "after" beside "before" in "The client bundle check", with the growth per route.
  - Project both for the nine routes E3 to E6 add. If the projected heaviest page plus the manifest would pass 150,000 B, make the manifest part of every page's figure in `checkBundle` (with a test in `scripts/check-bundle.test.ts`); otherwise write the projection and the room it leaves.
  - README:
    - a new section "The network page", placed after "The account page" (and its "The payments CSV") and before "Search". It covers the views, calls, classes, the failure hold, the live updates and `keepLoaded`.
    - The final order of E2's sections is therefore: "The UI and the routes", "The chart kit" (Task 13), "Home and ledger pages", …, "The account page", "The network page", "Search". E3's "The markets pages" goes after "The network page".
    - "The cache classes" lists the `live-home` pages;
    - the "End-to-end tests" table gains the two specs, and `E2E_FEATURES_OFF`;
    - the staging checklist gains the four items of spec §5: the views against the staging stack with the running day; the hold in `wrangler tail`; a switch flip being an edge miss; and the bundle and manifest figures.
- [ ] **Step 4: Verify.** `pnpm verify` and `pnpm test:e2e` both exit 0.
- [ ] **Step 5: Commit.** `git add -A test/e2e playwright.config.ts scripts README.md app/ui/charts`, with the message `test(network): end to end, accessibility and the bundle; the README's network page`.
