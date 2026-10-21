# explorer

A public, server-rendered block explorer for the XRP Ledger and Xahau, on Cloudflare Workers. Loaders call the
GateHub Data API and the network's own node; nothing in the browser talks to either.

The design is in [`docs/superpowers/specs/2026-10-17-explorer-foundation-design.md`](docs/superpowers/specs/2026-10-17-explorer-foundation-design.md),
the implementation plan next to it in `docs/superpowers/plans/`.

## Stack

| | Version when scaffolded |
|---|---|
| React Router (framework mode, server-rendered) | **8.4.0** (`react-router`, `@react-router/dev`) |
| React | 19.3.1 |
| Vite / `@cloudflare/vite-plugin` / Wrangler | 8.3.4 / 1.64.0 / 4.151.1 |
| Vitest / `@cloudflare/vitest-plugin` | 5.0.5 / 1.4.4 |
| Node / pnpm | 24 / 10.6.3 |

The project came from `pnpm create cloudflare@latest --framework=react-router`, which is the Cloudflare route for
React Router 8: the upstream `create-react-router` default template plus Cloudflare's overlay. (The `cloudflare`
template of `remix-run/react-router-templates` the plan names no longer exists on that repository's main branch;
its `v7` branch is React Router 7.) Tailwind, the Dockerfile and the Google Fonts links of the template were
removed: the design system is hand-written CSS and the fonts are self-hosted.

`@react-router/cloudflare` is not installed. React Router 8 on the Cloudflare Vite plugin does not need it.

## Getting started

```sh
pnpm install
cp .dev.vars.example .dev.vars      # DATA_API_KEY and SENTRY_DSN; never commit .dev.vars
pnpm dev                            # http://localhost:5173
```

The data API hosts in `wrangler.jsonc` are placeholders that never resolve (`*.example.invalid`) until the hosts
are decided. To develop against a running data API, put its address in `.dev.vars` (`XRPL_DATA_API_URL=...`);
values there replace the `vars` of `wrangler.jsonc` locally.

A data API on `main` has no `amm_volume` route yet, and the top level of `wrangler.jsonc` has `AMM_DATA` `"on"` (see "Switches"). Against such an API every render of the
network page has its AMM part failed: the volume card says "AMM swaps couldn’t be loaded.", and the page is degraded and never stored. For that API put `AMM_DATA=off` in `.dev.vars`
as well; the card then draws Payments and DEX trades only, with nothing failed.

## Scripts

| Script | |
|---|---|
| `pnpm dev` | Dev server, with the Worker running in workerd |
| `pnpm build` | Production build into `build/` |
| `pnpm typecheck` | `wrangler types` (runtime types into the git-ignored `worker-configuration.d.ts`), `react-router typegen`, `tsc -b` |
| `pnpm test` | `vitest run`: the `unit` project (Node), the `components` project (happy-dom: the components of `app/ui`) and the `worker` project (Workers runtime) |
| `pnpm test:e2e` | The end-to-end suite (Playwright, Chromium): builds, starts the fixture server and the built Worker under `wrangler dev`, runs `test/e2e/`, stops them and removes their state. See "End-to-end tests" |
| `pnpm api:sync` | Copy the data API's OpenAPI document (`$DATA_API_REPO/docs/openapi.yaml`, default `../data-api-new`) to `api/openapi.yaml` and regenerate `app/server/openapi.d.ts`; name the source commit it prints in the commit message |
| `pnpm api:check` | Regenerate the types from the committed `api/openapi.yaml` and fail if `app/server/openapi.d.ts` differs (needs no `data-api-new`) |
| `pnpm fixtures:sync` | Write the generated upstream fixtures of `test/fixtures/http/` from the recorded ledgers (see "Upstream fixtures"); names files that no longer belong, never deletes |
| `pnpm fixtures:check` | Change nothing; fail when those files are not what the generator writes (`scripts/http-fixtures.test.ts` does the same inside `pnpm test`) |
| `pnpm check:bundle` | Look at the client build in `build/client`: fail when a page, or the account page's analytics view, loads more JavaScript (gzip) than its budget (150 KB for the lookup pages, 160 KB for the dashboards and the view), when the build holds code that belongs to the Worker alone, or when `_headers` is missing. See "The client bundle check" |
| `pnpm deploy:staging`, `pnpm deploy:production` | `CLOUDFLARE_ENV=<env> react-router build`, then `scripts/predeploy-check.ts <env>` (refuses a placeholder or non-https upstream URL, a build for another environment, a Worker reachable on workers.dev), then `wrangler deploy`: the environment is chosen by the build. See "The pipeline and deploying" |
| `pnpm verify` | `api:check`, `typecheck`, `test`, `build`, `check:bundle` |

Run one project or one file with `pnpm test --project worker` or `pnpm test app/server`. Do not put `--` after
`pnpm test`: pnpm hands it to Vitest, which then treats everything after it as literal arguments and runs
everything.

## Configuration

`app/server/env.ts` is the type of the Worker's bindings (`Env`) and the one place that knows how React Router 8
hands them to loaders: `workers/app.ts` creates the load context with `createLoadContext(env, ctx)`, and loaders
read it with `getEnv(context)`, `getExecutionContext(context)` and `getSubrequestCache(context)` (one subrequest cache
per request, over the data centre's Cache API, built with `BUILD_ID`).

| Name | Kind | Where it is set |
|---|---|---|
| `XRPL_DATA_API_URL`, `XAHAU_DATA_API_URL` | var | `wrangler.jsonc`, per environment (placeholders for now) |
| `XRPL_NODE_URL`, `XAHAU_NODE_URL` | var | `wrangler.jsonc`, per environment (`https://s1.ripple.com:51234/`, `https://xahau.network/`) |
| `VALIDATORS`, `AMM_DATA`, `MARKETS`, `ACCOUNT_ANALYTICS`, `AMM_PAGES` | var, `"on"` or `"off"` (the switches) | `wrangler.jsonc`, every block: see "Switches" below |
| `VISITOR_LIMITER` | `ratelimits` binding, 60 per 10 s | `wrangler.jsonc`, per environment (own namespace each) |
| `DATA_API_KEY` | secret | `.dev.vars` locally; on the deployed Workers `x-explorer-staging` and `x-explorer-production` as a secret |
| `SENTRY_DSN` | secret, optional | the same |
| `BUILD_ID` | var | added to every build by `vite.config.ts` (`scripts/build-id.ts`): the short git commit, plus `-dirty` when the tree has uncommitted changes. `BUILD_ID=... pnpm build` overrides it. Without git it is `dev`, but a build for a Cloudflare environment (`CLOUDFLARE_ENV`, so every deploy) fails instead, because the edge cache key includes it (as the first part of the cache generation, see "Switches") |

The Cloudflare Vite plugin flattens one Cloudflare environment into the build, chosen at build time with
`CLOUDFLARE_ENV` (`pnpm deploy:staging` and `pnpm deploy:production` set it). `vars` and `ratelimits` are not
inherited, so each environment repeats them. The top level of `wrangler.jsonc` is local development and the tests.

### Switches

A switch turns a page, or a part of one, on or off for one environment, from one commit. It is a Worker variable, `"on"` or `"off"`, set per environment in
`wrangler.jsonc`. `app/ui/features.ts` is the one list of them (`FEATURE_VARS`), and nothing else lists their names. It is pure, with no React and no server import,
so the Worker, the browser, the scripts and the tests all import it. `featuresOf(vars)` turns the variables into `Features` (`validators`, `ammData`, `markets`, `accountAnalytics`, `ammPages`): `"on"` is
`true`, and anything else, a missing value too, is `false`. `NO_FEATURES` (frozen) is every switch off.

| Variable | In `Features` | Gates |
|---|---|---|
| `VALIDATORS` | `validators` | every link into the validators and amendments pages (the network page's "All validators" and its five first-seen keys), those pages' routes and their two kinds of image (`/og/{net}/validator/…`, `/og/{net}/amendment/…`) |
| `AMM_DATA` | `ammData` | every part derived from the AMM data in the index: the network page's AMM volume series and its "AMM swaps included" wording; on the markets pages (XRPL only), the Trades filter of each page, the Via column, the AMM share tile and column, the pool card's share and the intro's words about swaps |
| `MARKETS` | `markets` | the markets pages (E3), the header's Markets link and every link into them |
| `ACCOUNT_ANALYTICS` | `accountAnalytics` | the account page's Analytics tab (E4): the tab itself, its "soon" label while off, and the `?tab=analytics` URLs |
| `AMM_PAGES` | `ammPages` | the AMM pool pages (E5): the routes under `/{net}/amm` and the `/og/{net}/amm/…` images (a 404 of class `short`, without a call, while off), the header's AMM link ("soon" while off) and every link to a pool, which goes to the account page while off |

Every block of `wrangler.jsonc` lists every switch (`vars` are not inherited). The values:

| Variable | Top level (local development and the tests) | `staging` | `production` |
|---|---|---|---|
| `VALIDATORS` | `"on"` | `"off"` | `"off"` |
| `AMM_DATA` | `"on"` | `"off"` | `"off"` |
| `MARKETS` | `"on"` | `"off"` | `"off"` |
| `ACCOUNT_ANALYTICS` | `"on"` | `"off"` | `"off"` |
| `AMM_PAGES` | `"on"` | `"off"` | `"off"` |

The conditions for turning a switch on in `staging` or `production` (by a commit and a deploy):

- `AMM_DATA`: the environment's data API has merged `feat/amm-data`, has re-ingested and back-filled, and D2b is deployed (`syncer_markets_live_amm_share_known` is 1).
  (Locally the top level has it `"on"`: against a data API that has not merged it, set `AMM_DATA=off` in `.dev.vars`, see "Getting started".)
- `VALIDATORS` (`validators`, E6): the validators and amendments pages. "on" at the top level, "off" in staging and production until D1 (the data API's validators and
  amendments routes) has served that environment on both networks for at least two hours, so that the votes and tallies are back-filled (D1's estimate). Rolling back is
  `"off"` and a deploy. See "Validators and amendments".
- `MARKETS` (`markets`, E3; it gates the markets pages, the header's Markets link and every link into them): the environment's data API serves
  `/v2/network/markets`, with D2 §16.4's gauges at their marks (`syncer_pair_hourly_missing_hours` is 0, `syncer_markets_live_age_seconds{period="day"}` is under 120).
  Until then it is `"off"` there; the top level has it `"on"`.
- `ACCOUNT_ANALYTICS` (`accountAnalytics`, E4): the account page's Analytics tab. "on" at the top level (development and the tests), "off" in staging and production until D2's
  gauges `syncer_rates_daily_missing_days` and `syncer_account_rollups_pending_accounts` are 0 there (E4 §8).
- `AMM_PAGES` (`ammPages`, E5): the AMM pool pages. "on" at the top level (development and the tests), "off" in staging and production. It goes "on" in an environment
  once `AMM_DATA` is "on" there, `feat/amm-data` is merged into the data API's `main` and deployed to it, and the data is re-ingested from ledger 86795265 and
  back-filled. The pre-deploy guard refuses a build that has `AMM_PAGES` "on" and `AMM_DATA` anything but "on". Rolling back is `"off"` and a deploy.

**A switch is never set in the Cloudflare dashboard.** The Cloudflare Vite plugin writes the build's vars, so the next deploy would undo it.

How a switch reaches the code:

- `Env` (`app/server/env.ts`) types each as `"on" | "off"`. `networkOf(id, env)` adds `features: featuresOf(env)` to the `Network`, and `PublicNetwork` carries it to the
  browser in the `/:net` layout's data (the values only, never an upstream URL or key). Loaders read `net.features` from `requireNetwork`.
- A page's links and labels that depend on a switch come from its view builder, in its data, so that the stored HTML and the data agree.
- A component that is not drawn from page data (the header, a link inside a sentence) calls `useFeatures()` (`app/ui/use-network.ts`). It reads `network.features` of the
  `/:net` layout, gives every switch off where that data is missing (an unknown network's error page, a test without the layout, no router at all), and never throws.
- A page-level switch that is off: the routes it gates answer the not-found page, a 404 of class `short`, before any upstream call, and every link into them is the
  header's "soon" style, not a link. A feature-level switch that is off: the parts it gates are left out, the calls that feed only them are not made, and the wording
  that depends on them takes its "off" form.

**The cache generation.** `cacheGeneration(env)` (`app/server/env.ts`) is `BUILD_ID`, a colon, and every switch as `NAME=value`, sorted by name and joined by commas:
`3f2a9c1:ACCOUNT_ANALYTICS=on,AMM_DATA=on,AMM_PAGES=off,MARKETS=on,VALIDATORS=off`. The edge cache keys every page, image and `.data` URL with it (`edgeCacheKey(url, cacheGeneration(env))`, the `__build` parameter of
the key). A flip is a deploy of the same commit with another value, and it is a new key for everything, so a copy stored under the other value is never served. The
subrequest cache keeps `BUILD_ID` alone, because it holds upstream data, which no switch changes. The live pages' `build` field keeps `BUILD_ID` too, because it says
which code drew the page: a flip does not reload an open tab. Its route's data follows on the next beat (the `.data` key changed), and the layout's data (the header)
on the next document load. `env.ts` and `edge-cache.ts` import each other for this. It is safe because neither uses the other's exports until a request is served; keep it so.

**The pre-deploy guard** refuses a build where a switch is missing, where its value is not exactly `"on"` or `"off"`, or where a var that is not a switch has the value
`"on"` or `"off"` (a misspelt switch, such as `MARKET`). See "The pipeline and deploying".

**Tests.** `vitest.config.ts` pins the top-level switches for the `worker` project (`TOP_LEVEL_SWITCHES`). The `worker-off` project pins every switch `"off"`, and runs
the files named `test/worker/*-off.spec.ts`, which the `worker` project leaves out: the off-case of a page or a feature goes in such a file (`pnpm test --project worker-off`).
A loader's unit test builds its context with the switch values it needs. The tests build their expectations from `FEATURE_VARS` and `allSwitches(value)`
(`test/support/switches.ts`), so a new switch does not change them. The end-to-end suite runs against a Worker whose switches it does not set: `E2E_FEATURES_OFF` tells it which are off (a comma list of `FEATURE_VARS`
names, read by `featuresOff(process.env)` in `scripts/e2e-env.ts`; "End-to-end tests"), and a spec that needs a switch on skips itself when it is listed.

**Adding a switch.**

1. Append its name LAST to `FEATURE_VARS` and its key LAST to `FEATURE_NAME` in `app/ui/features.ts` (`Object.keys(FEATURE_NAME)` must equal `FEATURE_VARS`).
2. Add the field to `Env` (`NAME: "on" | "off"`).
3. Add an entry to every block of `wrangler.jsonc` (top level, `staging`, `production`).
4. Add it to `TOP_LEVEL_SWITCHES` in `vitest.config.ts` (its `satisfies` fails until you do). The `worker-off` project follows from `FEATURE_VARS`.
5. Add its row to the tables above.
6. Write its own tests: a guard case that refuses the misspelt name, its case in a `*-off.spec.ts`, and, in the end-to-end specs of the page it gates, the skip and the off-case (`featuresOff(process.env).has("NAME")`).

The hand-built `Env`s of the tests, the passing configs of `scripts/predeploy-check.test.ts`, and the expectations of `features.test.ts`, `env.test.ts`, `networks.test.ts`,
`edge-cache.spec.ts` and `features-off.spec.ts` are built on `allSwitches` and `FEATURE_VARS`, so they need no edit, except the cache generations that two of them spell out
as text: `features-off.spec.ts` has the whole of it (`test-build:AMM_DATA=off,MARKETS=off,VALIDATORS=off`), which every new switch changes, and `env.test.ts` has
`AMM_DATA=on,MARKETS=on,VALIDATORS=off` and its `MARKETS=off` form, which a switch whose name sorts between those changes. Add the new switch to those strings.

## The data API and the node

`app/server/` is Worker-only code that loaders call; the browser never imports it.

| File | |
|---|---|
| `networks.ts` | `xrpl` and `xahau`: name, native currency, CTID network id, and the data API and node URLs from `Env`. The only place that knows a network's URLs. |
| `data-api.ts`, `api-types.ts` | `createDataApi(net, env, cache)`: typed `/v2` calls with the `X-API-Key` header, a 5 s limit and no redirects. The answers' types are written by hand from the data API's `docs/api-reference.md`, because `api/openapi.yaml` has parameters but no response schemas. The endpoint paths are checked against the generated `openapi.d.ts`, so a path that leaves the API fails `pnpm typecheck`. `transaction(hash)` and `transactionBinary(hash)` (`binary=true`: `tx` and `meta` as hex, or as the stored JSON for a type the API's codec cannot serialize) are the same path with and without that flag. What the pages read of a transaction, of its binary form and of a ledger's list of hashes is checked **inside the load the subrequest cache runs** (`tx-shape.ts`): a 200 with the wrong content is an `UpstreamError` of kind `server` and is never stored, where an answer that came back whole would have been kept for a year. The network page's calls are `feeStats`, `stats(family, q)` (`type` or `metric`), `fees` with an `interval` (a second form of the call that lists ledgers: `{ interval: "day", start, end, limit }`, class `slow`, rows by day), `paymentVolume`, `exchangeVolume`, `ammVolume` and `ledgerValidations(hash, q)`, each with the options `{ ttl, holdFailure }`; the ones over a period are `slow` and the page keeps them `PERIOD_CALL_TTL_SECONDS`, the snapshot and the validations are `live`. A query is sent in the order its type lists its fields, and a volume's `exchangeCurrency` and `exchangeIssuer` are sent as `exchange_currency` and `exchange_issuer`. Each answer's shape is checked inside the cached load like a transaction's (`aggregate-shape.ts`). `get()` takes one options object after the class, `{ unwrap, finish, ttl, holdFailure }`. The markets pages' calls are `pairExchanges(base, counter, q)`, `pairCandles(base, counter, q)`, `pairReduce`, `activeAccounts` and `networkMarkets({ period, limit, amm? })`. A pair's assets are `apiAssetText` (`CUR+issuer`, the `+` sent as `%2B`), and `amm` (`exclude` or `only`, never `include`) is the last parameter of a query. Trades are `live`: a first page asked for with a `ttl` has an entry of its own (`[kept N s]`), a page after a marker is `MARKER_PAGE_CLASS` and ignores the `ttl`. Candles are `live` unless the page passes `cls` (`minute`, or `slow` with a `ttl`). `pairReduce` is `live` and gives back its one row: an answer with none or two is kind `server`. `activeAccounts` is `minute` and keeps the first `ACTIVE_ACCOUNTS_KEPT` (10) of the accounts before it is cached. `networkMarkets` is `minute` (60 s, no TTL constant of its own), its route is in `PENDING_PATHS`, and an answer to an `amm` filter that does not carry that `amm` (a data API that ignored the parameter) is kind `server`: the rows would be the unfiltered ones. The shape of `network/markets` is that of `docs/api-reference.md` at data-api-new `feat/explorer-data` `7d495ab` (`test/fixtures/PROVENANCE.md`). |
| `node-rpc.ts` | `createNodeRpc(net, cache)`: JSON-RPC to rippled or xahaud (`tx`, `ledger`, `account_info`, `account_objects`, `server_state`, and the markets pages' `bookOffers(gets, pays)`, `ammInfo(pool)` and `ammInfoByPair(asset, asset2)`), 3 s limit. Times the node counts from 2000-01-01 are returned as unix seconds, and native amounts (drops) as whole units (`NodeAmount`). The last three take `{ ttl, holdFailure }`: a `ttl` is kept under a cache key of its own (`[kept N s]`), `holdFailure` is the cache's failure hold (`SubrequestOptions`). `bookOffers` asks for the newest validated ledger and `BOOK_OFFERS_LIMIT` (60) offers, trims each offer before it is cached, and accepts a result without `validated` (Clio's `book_offers` has none) but not a `validated: false`; both forms of `amm_info` need `validated: true` and check the pool is the one asked for, and `actNotFound` and `actMalformed` are `not_found` for them and nothing else is (`actMalformed` is `bad_request` for an account call, and `lgrNotFound` is `server` for a pool, so that a node with no ledger yet is never stored as "no pool"); a book is never `not_found`, holds only offers of the two assets asked for, none of nothing, at most 60; a pool has at most 8 vote slots and 4 authorised accounts and an `lp_token` issued by the pool. An issued amount's value is written as a plain decimal, whatever form the node used, and must be in the range rippled writes (zero, or 1e-81 to 9999999999999999e80). |
| `upstream.ts` | `UpstreamError` (`not_found`, `bad_request`, `rate_limited`, `server`, `timeout`, `network`; `status`, `retryAfter`) and the deadline both clients use. |
| `cache-class.ts` | The six cache classes with their TTLs and `Cache-Control` values (the table under "The Worker entry"), `MARKER_PAGE_CLASS` (the class of a list page reached with a marker: `slow`, see "The account page"), `HOME_CALL_TTL_SECONDS` (2 s) and `PERIOD_CALL_TTL_SECONDS` (300 s) for how long a polled page keeps its calls, the `SubrequestCache` interface both clients take, with its options (`SubrequestOptions`: `holdFailure`) and the failure hold's constants (`FAILURE_HOLD_SECONDS`, `FAILURE_HOLD_MAX_SECONDS`, `FAILURE_HOLD_KEYS`). |
| `edge-cache.ts` | The page-level edge cache and visitor limit (`withEdgeCache`), the subrequest cache the clients take (`createSubrequestCache`, with the failure hold: "The cache classes"), and what loaders and routes use to name a page's class (`cached`, `forwardCacheClass`, `cacheClassHeaders`) or to say it is degraded (`DegradedMark`, `markDegraded` in `env.ts`). |
| `logging.ts` | The request id and the one log line per request (`withRequestLog`), and Sentry, loaded only for a Worker that has a `SENTRY_DSN` (`withSentryWhenConfigured`). |
| `clients.ts` | `clientsFor(context, net)`: the data API client and the node client of a network, over the request's subrequest cache. What a loader calls. |
| `network-route.ts` | `requireNetwork(context, params)` (the `:net` segment as a `Network`, or a 404 of class `short`), `publicNetwork(net)` (what may go to the browser: no URLs), `readNetworkCookie(header)`. |
| `loader-errors.ts` | `upstreamFailure(err, what, offer?)`: what a loader throws for a failed upstream call: 404 `short` for `not_found`/`bad_request` (with `offer`, a link such as "Search on Xahau", in its data when the caller has one), 503 with `Retry-After` for the rest, anything else rethrown. `upstreamOutage(err, what)` is the same with `not_found` and `bad_request` made 503s too, for what the visitor did not ask for and for a refusal of an id that is well formed. |
| `capture.ts` | `handleLoaderError`, the `handleError` of `app/entry.server.tsx`: one log line per loader error and, with a `SENTRY_DSN`, Sentry. |
| `resolve.ts` | What a search input names: `resolveCtid(api, net, ctid)` (the hash at a CTID's place in its ledger, or the other network it belongs to, or `null`) and `findHash(api, node, hash)` (a transaction, a ledger, both or neither; the node is asked when the data API has neither). They return "nothing" for a thing that is not there and throw the `UpstreamError` of a failure, so a caller can tell a 404 from a 503. An answer that cannot be right is a failure too: a 200 for a hash without its `tx`, a ledger's list that is not a list, a hash in it that is not 64 hex digits (it goes into a redirect and a path). |
| `tx-shape.ts` | The shape checks of a transaction, its binary form and a ledger's list of hashes (`checkIndexTransaction`, `checkBinaryAnswer`, `checkLedgerHashes`; `checkNodeTransaction` for the node's), which the data API client runs inside its cached loads. |
| `aggregate-shape.ts` | The shape checks of the network page's answers (`checkStatsPage`, `checkFeeBucketPage`, `checkFeeStatsPage`, `checkVolumePage(kind, body)` for payments, trades and AMM swaps, `checkValidations`) and of the markets pages' (`checkMarkets(body, amm?)`, `checkPairExchanges`, `checkCandles`, `checkReduce`, `checkActiveAccounts`), and the tests they share (`isDecimalText`, `isNumberText`, `isIsoTime`): a list where a list belongs, dates as ISO text, amounts as decimal strings, counts as numbers. `isNumberText` also takes the exponent form BigNumber gives a price below 1e-6 or from 1e8 (`1.2000000e-7`; at most 3 digits of exponent), which the markets and pair answers and a volume component's `amount`, `rate` and `converted_amount` can hold (a row's `total` and `exchange_rate` stay plain decimals); the network view reads them through BigNumber and writes them with `toFixed()`. The data API client runs them inside its cached loads, like `tx-shape.ts`. |
| `pending-paths.ts` | `PENDING_PATHS`: the routes the client calls that `api/openapi.yaml` does not have yet (`ammVolume`, on the data API's `feat/amm-data` branch, and `networkMarkets`, on its `feat/explorer-data` branch), outside the compile-time check of `PATHS`. `test/unit/pending-paths.test.ts` fails once `pnpm api:sync` brings one in, and says to move it to `PATHS`. A sub-project that needs a route the API has not synced adds it here. It has no imports, so scripts and the Node tests can read it. |
| `account-view.ts` | What the account page shows: the header (`accountHeader`: activation, flags, sequence, balance with the reserve from `server_state`, tokens, owned objects), the rows of each tab (`transactionRows`, `paymentRows`, `tradeRows`, `offerRows`, `objectRows`), the Newer and Older links (`pagingOf`), and what the index and the node say between them about whether the account exists (`existenceOf`). See "The account page". |
| `qr.ts` | A QR code encoder (byte mode, error correction level M, versions 1 to 9) and `qrPath`, the picture as the `d` of an SVG path. Imported by the account route only, so it is never in the browser bundle (`test/unit/account-bundle.test.ts`). |
| `marker.ts` | `isMarker`: what a marker of the data API's lists may look like (base64url, at most 512 characters), checked before one is sent or put in a link. |
| `transaction-view.ts` | What the transaction page shows (`transactionPage`): worked out from a transaction of the data API (`txFromIndex`) or the node (`txFromNode`), the hashes of its ledger (`neighboursOf`) and the binary form (`binaryOf`). See "The transaction page". |

**A route the data API does not have is an outage, not a missing thing.** A 404 whose body's `message` starts with `Cannot GET ` is what the API's framework answers for a path it has no route for (an API deployed without the sub-project that adds the route). `throwUnlessOk` in `data-api.ts` makes it an `UpstreamError` of kind **`server`** (status 404), with the message `data API GET {path} answered 404: Cannot GET … (the data API has no such route)`. So it is never a stored 404 page; a page-level call answers 503 through `upstreamOutage`, a card-level call fails its card, and a call that asks for the failure hold ("The cache classes") has it held. **Every other 404 stays `not_found`**, each route's own message included (`ledger not found`, `Account not found`, `transaction not found`, `pool not found`, and so on): only a message that *starts* with `Cannot GET ` means a missing route, and no other code, page or client method maps a 404 to "the route is absent" or has a variant of its own. `test/worker/data-api.spec.ts` ("errors") pins both sides.

## The Worker entry

`workers/app.ts` wraps React Router's request handler, outside in: Sentry (only with a `SENTRY_DSN`), the request id and
log line, the edge cache with the visitor limit, React Router.

- **Request id and log.** Every response has `X-Request-Id` (the request's `CF-Ray` when it has one, else a random id), and
  every request writes one line, `{ id, method, path, status, cache, ms }`. The path only: a query string can hold what a
  visitor typed.
- **`X-Cache`** is on every response: `HIT`, `MISS`, `MISS-SHARED` (a miss answered by another request's render, see "Single flight"), `STALE`, or `BYPASS` for requests that skip the cache (anything but GET and HEAD, and
  the root `/` and its `/_.data`, a redirect that depends on a cookie).
- **HEAD** is the GET of the same URL without the body (unfurlers and uptime monitors send them). It is answered from the stored copy of the
  page, with the same status and headers; on a miss the page is rendered **as a GET** (`render` is handed that GET, not the HEAD), stored as a GET
  would be, and answered without the body. So a HEAD costs at most one render, never two, the next GET or HEAD is a hit, and a HEAD of an
  `/og/...png` draws the image once. A HEAD that misses is limited like a GET that misses. (The root `/` is the one HEAD that is not
  cached: its redirect depends on a cookie and costs nothing.)
- **Visitor limit.** On a miss only (a hit, and a stale copy being refreshed, cost nothing upstream), the Worker asks
  `VISITOR_LIMITER`, keyed by `CF-Connecting-IP`; over the limit the answer is a small 429 page with `Retry-After: 10` and
  nothing is rendered. Requests that are neither GET nor HEAD are always misses and are limited too. A limiter that
  throws lets the visitor through. The 429 page (and the 503 one) names its wait in a `<meta name="retry-after">` as well as in the header:
  a client-side navigation gets the page as the text of an `ErrorResponse`, without headers, and `RouteErrorScreen` reads the wait from it.
- **A failing render** (it throws, or answers 5xx) is replaced by the stored copy, whatever its age (stored copies live
  `max(edge TTL + 30 s, 24 h)`), with `X-Cache: STALE`; without one, a throw or a 503 becomes a small 503 page with
  `Retry-After: 30`. Both pages are `noindex` and self-contained until the design system has its own.
- **Errors are never stored**: 4xx, 5xx and 429, except a 404 of class `short`; nor an answer that sets a cookie.
- **Degraded answers are never stored.** A page that renders with a part missing (the node is down, a streamed list could not be
  loaded) is a 200 that must not be kept. `withEdgeCache` hands `render` a `DegradedMark`, one per render, which `workers/app.ts`
  puts in the load context; a loader calls `markDegraded(context, reason)`. The mark may be set while the body streams (a section
  that fails settles before the stream ends), so the copy is made only when the body is complete (`store` reads it to its end, then
  looks at the mark); a mark set before the answer also takes the browser's caching away (`Cache-Control: no-store`). A degraded
  refresh of a stale copy leaves the copy as it was, and the next good render is stored as usual. The log gets one line
  (`degraded answer not stored`, with the reason). **The store buffers the whole body in memory** (`arrayBuffer()`) before it decides,
  for every page and CSV it stores: the visitor's copy streams meanwhile, but for a very large page (a ledger with thousands of
  transactions) the Worker holds all of it until the stream ends.

### The cache classes

`app/server/cache-class.ts`. One table for the page in front of the visitor (the edge cache) and the answers under it (the subrequest cache, which the data API and node clients keep their answers in, for the class's fresh time and no longer).

| Class | Fresh at the edge | Then, stale while one render refreshes it | Browser `Cache-Control` (page) | Used for |
|---|---|---|---|---|
| `immutable` | 1 year | 0 | `max-age=60` (an image: `max-age=31536000, immutable`) | validated ledgers and transactions, their images |
| `live-home` | **1 s** | **2 s** | `max-age=0, must-revalidate` | the home page, the network page, the market pair page, a validator's page (not its pages of older validations, `slow` for 300 s), and their `.data` URLs (the route's own request of an open page) |
| `live` | 5 s | 30 s | `max-age=0, must-revalidate` | the newest ledger, an account's live state and first pages; balances and orders |
| `minute` | 60 s | 30 s | `max-age=0, must-revalidate` | what the data API changes every minute: the markets table (`networkMarkets`), a pair's active accounts and its long-interval candles; and the markets page and its `.data` URL |
| `slow` | 1 h | 0 | `max-age=300` | an account's creation, account images, a list page reached with a marker (`MARKER_PAGE_CLASS`), the network page's calls over a period (kept 300 s, below) |
| `short` | 30 s | 0 | `max-age=0` | search pages, a 404 for a well-formed id |

- **`minute` is the one "kept 60 s" of the program.** The data API rewrites the markets table's `day` set every minute and its `7day` and `30day` sets every five minutes, and says `Cache-Control: private, max-age=60`: `live` (5 s) would render a page twelve times for every change of a set, `slow` (an hour) would hide twelve. A subrequest of this class is kept 60 s, its edge TTL, as every class's subrequests are, and nothing keeps a call 60 s by a TTL constant of its own: a call that should be kept so names the class. Today that is `networkMarkets` and `activeAccounts`, and the long-interval candles of the pair page (`pairCandles` with `cls: "minute"`). `test/worker/data-api.spec.ts` pins the stored `max-age=60`.

- **`live-home` is 1 s + 2 s, not the 3 s + 30 s of spec 4, at the owner's request.** A ledger closes every 3-4 s and an open home page follows the chain (see "Live updates"), so a reload must never show a copy much older than one ledger: a copy up to 1 s old is served as it is, one 1-3 s old is served at once while one render refreshes it, and an older one is not served (the visitor waits for a render). A render that fails is still replaced by the stored copy, of any age (`max(edge TTL + 30 s, 24 h)`, see above). The browser's `Cache-Control` is unchanged.
- **The home page's three calls are kept `HOME_CALL_TTL_SECONDS` = 2 s, not by a class of their own.** `lastValidated`, `fees` and the first page of `transactions` (no marker, either direction) keep the class `live` (5 s) for every other caller, and the home loader asks for `{ ttl: HOME_CALL_TTL_SECONDS }` on them: a little longer than the page's 1 s at the edge, so that a refresh at the edge finds them warm, and shorter than a ledger. An answer asked for with a `ttl` has **a cache entry of its own** (its key says `[kept 2 s]`): an answer kept 5 s for the ledger page or the image route must not be what the home page reads, which could then be 5 s old before the page adds its own. The ledger page and the og route keep `lastValidated` at 5 s; account lists, balances, orders, node calls and a list reached with a marker (it ignores `ttl`, and keeps `MARKER_PAGE_CLASS` or `live`) keep what they had. `test/worker/data-api.spec.ts` pins each call's class, the override and the stored `max-age`, and `test/worker/home-live.spec.ts` that the home page's render stored its three calls for 2 s. **The page's worst-case age** is the edge's 1 s fresh and 2 s stale plus the 2 s its calls were kept: about 5 s, a ledger and a little. (The home loader also passes `holdFailure: true` on these three and on the ledger it reads, the next bullet.)

- **The network page's calls over a period are kept `PERIOD_CALL_TTL_SECONDS` = 300 s.** `stats`, `fees` by day and the three volumes are class `slow` (an hour), and the network loader asks for `{ ttl: PERIOD_CALL_TTL_SECONDS }` on them: their keys change once a day, when the index day does, but the running bucket moves on within the day, and the API's aggregator can still finalise the newest closed day in the first hour or two after midnight UTC, so 5 minutes bound how late either shows. As with the home page's TTL they have cache entries of their own (the key says `[kept 300 s]`), and `test/worker/data-api.spec.ts` pins each call's class, the override and the stored `max-age=300`. `feeStats` (kept 2 s) and `ledgerValidations` (`live`, 5 s) keep the short times.

- **The failure hold: a polled call's failure is remembered for 5 s.** A degraded answer is never stored and never shared by single flight, so while one upstream fails every beat of every open tab of a polling page is a render that calls it (a thousand tabs: about 250 calls a second, enough to spend the explorer key's rate limit and fail every page). `SubrequestCache.json` takes `{ holdFailure: true }` as its fifth argument (`SubrequestOptions` in `cache-class.ts`), and the data API client passes it from the `holdFailure` option of `lastValidated`, `transactions`, `fees`, `feeStats`, `stats`, `paymentVolume`, `exchangeVolume`, `ammVolume`, `ledgerValidations` and `ledger` (`FreshOptions`; the node client has no such option yet). Rules:
  - **What is held**: an `UpstreamError` of kind `server`, `timeout`, `network` or `rate_limited`, thrown by `load` of a call that asked. It is remembered for `FAILURE_HOLD_SECONDS` = 5 s, or, for a `rate_limited` answer that has a `Retry-After`, for that long, at most `FAILURE_HOLD_MAX_SECONDS` = 30 s and at least the 5 s every other kind gets (a `Retry-After` of 0 or 1 is held 5 s). Within that time a call for the same key that also asks throws **the same error object** without calling the upstream. `not_found`, `bad_request` and anything that is not an `UpstreamError` are never held: they are an answer, or a bug.
  - **The order** is: the Cache API; then, for a call that asks, a failure that is held; then `load`. A stored answer is therefore the answer even while a hold lasts (a call that did not ask loaded it), and a call with a TTL of zero (not kept) is held too.
  - **When the hold is over, one call probes.** The first call that finds the hold lapsed runs `load` (the probe). The hold stays in place for another hold's length while the probe runs, so every other call in that time still throws the held error and does not call. Without this, an upstream that is slow to fail is not protected: a call that times out takes the whole 5 s of the data API's deadline, the cards give up at 4.5 s, and every render that starts in those 5 s calls the upstream again (about half of all renders). What the probe finds sets the hold. An answer ends it. A failure of a held kind sets it again, for a full hold from that moment, with the new error. Anything else (`not_found`, `bad_request`, an error that is not an `UpstreamError`) ends it. A probe that is still out when its window ends (a `load` that never settles) lets the next call probe, so a key is never closed for good. A slow failure is therefore asked once in a cycle of a hold plus the time a call takes (about 10 s for a timeout), per Worker instance. Only the entry in memory is shared between requests: no response, stream or promise passes from one request to another, which a Worker may not do.
  - **The key** is the subrequest key the client gave, so the `[kept 2 s]` entry of the home page's `last_validated` has a hold of its own, and pages that read the same entry share its hold. `holdFailure` is never part of a key: a call that asks and one that does not read the same entries, and one that does not ask neither reads nor makes a hold.
  - **Where**: in memory, per Worker instance (a module-level `Map` in `edge-cache.ts`), at most `FAILURE_HOLD_KEYS` = 256 keys, the oldest going first (a key that fails again becomes the newest); never in the Cache API.
  - **Who asks: every page that polls, for every upstream call it makes** (an open tab asks again by itself). Today that is the home page (all four of its calls) and the network page (all eleven). A page that does not poll (a ledger, a transaction, an account) need not: a visitor's reload is not a herd. A Retry pressed within the hold (or while the probe of an expired hold is out) gets the held failure; the first call after the hold goes to the upstream.
  - **Tests**: `test/worker/edge-cache.spec.ts` ("the failure hold"), `test/worker/data-api.spec.ts` (what each call passes, that the option is no part of a key, and, with an API that never answers, one call in a hold cycle) and, on the real Worker, `test/worker/network-hold.spec.ts` (a file of its own: it needs an isolate nobody has held a failure in). A spec that meets held failures fakes `Date` only (`vi.useFakeTimers({ toFake: ["Date"] })`: the hold reads nothing else, and the Cache API and the streams need the real timers) and moves it past the hold, as `home.spec.ts` and `network-hold.spec.ts` do after each test.

### Single flight

A page that is not in the cache is rendered by the request that finds it so; the others for the same page at the same moment, in the same Worker instance, **wait for that render and are given a copy of what it stored** (`flights` in `edge-cache.ts`; the key is the cache key, so the `.data` URL of a page is a page of its own, and a HEAD, which is answered from the GET's render, joins it). It applies to every class: the herd it spares the data API is the home page's (every open page asks again every 4 s), but a ledger that has just closed and an account that is in the news are the same. Rules:

- **What is shared** is plain data (a buffer and pairs of strings, the status and the headers a visitor gets) read from the body `store()` buffers, once it is complete and not degraded, and each waiter is given its own copy: workerd does not let one request read another's streams, and bytes cross freely. The answer has the browser's `Cache-Control` of its class, none of the internal headers, and **`X-Cache: MISS-SHARED`** (a miss that another request's render answered; the request log's `cache` says so too). A streamed page (the account page) is shared when its stream has ended, which is when `store()` has all of it.
- **What is not**: a degraded answer, an error or a 5xx, a page nobody named a class for, a cookie, a render that threw or answered 503, a 404 that is not class `short`. The waiters are told as soon as that is known (the headers are enough: they do not wait for the body of an answer that is not to be shared), and each renders **for itself**, as before, with its stale copy and its 503 page as before.
- **The visitor limit** is asked of every request, before it waits, exactly as it was: a refused one gets its 429 and does not wait. Requests that skip the cache (`/`, `/_.data`, anything but GET and HEAD) never join.
- **A render that never ends** is not waited for for ever: a waiter gives up after `SINGLE_FLIGHT_WAIT_MS` (15 s), renders for itself, and takes the stuck flight off the list so that the next request does not wait for it either.
- Per Worker instance and in memory: another instance, or a restart, starts its own render. `test/worker/edge-cache.spec.ts` ("many requests for one page at once") and, on the real Worker with concurrent `exports.default.fetch`, `test/worker/home-live.spec.ts`.

### Naming a page's class

A loader answers with `cached(payload, class, { ttl?, status?, headers? })`, which wraps `data()` and adds two internal
headers, and the route exports `headers = forwardCacheClass`:

```ts
export const headers = forwardCacheClass;
export async function loader({ params, context }: Route.LoaderArgs) {
  // ...
  if (!found) throw cached("Not found", "short", { status: 404 });
  return cached(page, "immutable");
}
```

React Router builds the headers of the document and those of the `.data` URL a client-side navigation fetches from the same
route `headers` functions, so both carry the class. They are stored under their own URLs (the key is the URL, `.data` and
`_routes` included, plus the cache generation: `BUILD_ID` and the switches, see "Switches"). Every route with such a loader needs the export, and so does the root route when its
error boundary shows a thrown 404. A route without it is not "uncached": React Router gives it its parent's headers, so the
class its loader named is dropped and the page takes the parent's class (or none, when no parent names one). The deepest route
that names a class decides. `test/unit/route-headers.test.ts` fails when a file under `app/routes` (or `app/root.tsx`) imports
`cached`, `upstreamFailure` or `requireNetwork` and has no `headers` export.
For a `redirect()` or a resource route (an image), put `cacheClassHeaders(class, ttl?)` on the `Response`.

The entry stores the answer, hands the browser the class's `Cache-Control` (the image one for `image/*`), and strips the
internal headers (`X-Cache-Class`, `X-Cache-Ttl`, and the `X-Edge-*` ones on stored copies). Freshness is decided by the
entry, not the Cache API, which ignores `stale-while-revalidate`: after the edge TTL a copy is served `STALE` for the class's
`swr` while one render refreshes it (one at a time per Worker instance).

The Cache API does not work on `*.workers.dev`, so `X-Cache` is always `MISS` there; use a custom domain.

## The UI and the routes

`app/ui/` is the design system of the mock, as CSS and React components that take props and never fetch; type-only imports from
`app/server/` and `app/domain/` are fine, runtime ones from `app/server/` are not (`app/domain` is pure and may be bundled for
the browser).

- **Styles.** `app/ui/styles.css` is the one stylesheet (`root.tsx` links it; the build inlines its imports into a single
  file): `fonts.css` (Geist and Geist Mono, variable, self-hosted from the `geist` package, preloaded by `fonts.ts`),
  `tokens.css` (spec 8 verbatim as custom properties), `base.css` and `components.css`. A component's class is its name
  (`.card`), its parts `.card__head`, its states `.is-current` / `.pill--ok`. Nothing in them knows a theme or a network.
- **Network accent.** `Shell` wraps a page in `<div data-net="xrpl|xahau">`; `tokens.css` gives that wrapper the network's
  `--accent`. The tokens are declared on `:root` *and* on every `[data-net]` element, because `--link: var(--accent)` is
  resolved where it is declared.
- **Theme.** Light by default, dark when the system is dark, unless the visitor chose: `ThemeToggle` stores `light` or `dark`
  in `localStorage` and `THEME_SCRIPT` (inline in `<head>`, before the stylesheet) puts it on `<html data-theme>` before first
  paint. The server never renders `data-theme`, so the stored HTML is the same for everyone. The dark tokens are written twice
  (media query and `[data-theme="dark"]`); `test/unit/tokens.test.ts` keeps them equal and checks the contrast pairs.
- **Network cookie.** The browser writes `net=<id>` (`Path=/; Max-Age=31536000; SameSite=Lax`): an inline script in the
  `/:net` layout and an effect for client-side switches. Never a `Set-Cookie` header: the edge cache will not store an answer
  that sets one. Only `/` reads it (a 302 to `/{net}`, `Cache-Control: no-store`, XRPL without a valid cookie).
- **Routes** (`app/routes.ts`): `/` (`routes/index.tsx`, the redirect), `/robots.txt`, `/:net` (`routes/net.tsx`, the layout:
  header, footer, search, the network's accent; its loader answers a 404 for an unknown network and gives its children
  `useNetwork()`) with the home page (`routes/net._index.tsx`), the ledger page (`routes/net.ledger.$id.tsx`), the transaction page
  (`routes/net.tx.$id.tsx`), the account page (`routes/net.account.$address.tsx`) and its payments CSV
  (`routes/net.account.$address.payments[.csv].ts`, a resource route) and search (`routes/net.search.tsx`) under it, `/og/:net/:kind/:id.png`
  (`routes/og.$net.$kind.$id[.png].tsx`, a resource route outside the layout: the link-preview images, see "SEO and link previews"), and `*`
  (`routes/not-found.tsx`). The layout's loader also gives its children the origin of the request (`NetworkLayoutData`), which the pages' `meta` reads.
  A page is a child of `routes/net.tsx` in `routes.ts`. Its loader gets the
  network with `requireNetwork(context, params)` and the clients with `clientsFor(context, net)`, names its cache class with
  `cached(...)`, turns upstream failures into responses with `upstreamFailure(err, what)`, and its module exports
  `headers = forwardCacheClass` (see above; `test/unit/route-headers.test.ts` enforces it). A page with its own big search box
  (the home page) exports `handle = { heroSearch: true }` so the header leaves its box out. The header's Ledgers and
  Transactions links go to the ids `latest-ledgers` and `latest-transactions` (`app/ui/anchors.ts`) on the home page.
- **Errors.** `net.tsx` and `root.tsx` export an `ErrorBoundary` that shows `RouteErrorScreen` inside the page frame: a 404
  thrown by `cached`/`upstreamFailure`/`requireNetwork` becomes `NotFoundPage` ("We couldn't find {what} on {network}",
  with the search box and a way home), a 503 a try-again page, a 429 "Too many requests" with "Try again in a moment" (or in N seconds,
  when the entry's 429 page names them), anything else a plain apology. `NotFoundPage` takes a
  `suggestion={{ href, label }}` for the "on the other network" link; a thrown 404 carries it as `{ notFound, suggestion }` (the ledger
  page's, for a hash), and a `suggestion` that is not a path of this site is left out.
- **Route discovery.** `react-router.config.ts` sets `routeDiscovery: { mode: "initial" }`: the manifest of all nine routes is in the first
  page, and the browser never asks `/__manifest?paths=...`, which the default (lazy) mode does as links come into view or are hovered. Each such
  request was a Worker invocation that could not be stored and counted against the visitor limit. The initial JavaScript per page did not
  change (`pnpm check:bundle`); `test/e2e/client-meta.spec.ts` checks that moving between the routes asks for no manifest.
- **Search box.** `SearchBox` is a GET form to `/{net}/search` (`name="q"`). Hints appear as you type (`classify` from
  `app/domain/search.ts`, mapped by `app/ui/search-hints.ts`); that code and the address codec it pulls in are a separate
  chunk, fetched on first focus. `/` focuses the box except while another field has focus.
- **Amounts.** Always render through `Amount` (`formatAmount` and `formatCurrency`: exponent notation is written out, a
  40-hex currency becomes text or "LP token"). `Sentence` renders the segments of `describe()`.
- **Live updates** (the home page and the network page; see "Live updates" below): `use-live-refresh.ts` (`useLiveRefresh`, the 4 s revalidation), `live-page.ts` (`createLiveOnScreen`, the `OnScreen` of a live page, and `keepLoaded`, its merge), `use-live-controls.ts` (`useLiveControls`, the pause and the `LiveControls` a page is given), `use-hold.ts` (`useHolds`, `holdsFocus`: a part with links holds the page), `components/DataTable.tsx` with `live` (rows enter and slide: `use-live-rows.ts`, `motion.ts`), `components/LiveValue.tsx` (a figure that ticks in), `on-screen.ts` (what a page that is on screen hands back when a revalidation fails, and the `merge` of an answer it takes) and `revalidation.ts` (`onlyWhenParamsChange`, the `shouldRevalidate` of the `/:net` layout).

## The chart kit

`app/ui/charts/` draws every chart of the explorer by hand: React components, pure geometry and one stylesheet (`app/ui/charts.css`). Nothing
comes from a charting library. The ones that were weighed cost 20 KB gzipped and more, or draw to a canvas, which cannot be printed into the
cached HTML. The Worker prints each chart with every mark in place, and the browser takes it over. (Section 2 of
`docs/superpowers/specs/2026-10-19-network-dashboard-design.md` has the reasons and the sizes.)

A page composes a card and its parts. The view builder in `app/server/` makes the data. The kit never fetches, and a number it shows (a total, a share, a
delta) is the view builder's: the kit measures numbers and does not compute them.

```tsx
<ChartCard id="tx-by-type" title="Transactions by type, per day" source="/v2/stats/type?interval=day" what="transactions by type"
  legend={<Legend items={legendOf(data, "swatch")} />} table={<ChartTable title="Transactions by type" data={data} />} notes={[…]}>
  <ColumnChart layout="stacked" title="Transactions by type per day" data={data} />
</ChartCard>
```

| Component | Draws |
|---|---|
| `ChartCard` | The card: title, source line (a path, never a host), the Chart/Table toggle, the legend, the `summary` (a line of figures, the view builder's, between the legend and the plot, which stays when Table is chosen), both views and the notes. `state="failed"` puts a `SectionError` with Retry in place of the views and the toggle ("Couldn't load {what}.", or `message` in other words: a call still running); `state="loading"` is a streamed card before its data: the title and source, "Loading…" (`aria-hidden`) as high as the plot, no toggle, and `aria-busy` |
| `Legend` | 10 × 10 px swatches for columns and areas, 14 × 2 px keys for lines, a symbol with its words for an annotation; none for one series. Its items come from `legendOf(data, "swatch" or "line")` (`Legend.tsx`, for a `TimeSeriesData`), `shareLegend(data)` (`ShareBar.tsx`) and `candleLegend(data)` (`Candles.tsx`) |
| `ChartTable` | The table view of any form below: a compact `DataTable`, 300 px high at most, newest first, exact values, "—" (heard as "no data") for a gap |
| `ColumnChart` | `layout="single"`, `"stacked"` (the series bottom up, each segment its exact share) or `"diverging"` (in up, out down, from a zero line); `annotations` put a symbol over a column |
| `LineChart` | 1 to 3 lines, with `area`, `curve="step"` (a vertex only where the value changes: 2,600 buckets with 5 changes are 12 commands), a `domain` and `references` (dashed thresholds), and end labels. `pageStep` gives its slider Page Up and Page Down; `extreme="lowest"` makes the plot summary name the lowest bucket |
| `SmallMultiples` | A grid of one-series lines (6 at most), each on a scale of its own, one cursor for all |
| `Candles` | Candlesticks over a volume pane that share one cursor and one readout. `mark={false}` redraws a changed token with no ring, `empty` is the price pane's words when no candle is drawn |
| `ShareBar` | 100% stacked horizontal rows, a label under a segment of 18% or more. `unit` (`{ one, other }`) puts the word after a row's total: "35 validators", "1 validator" |
| `BarList` | An `<ol>` of labelled bars with the value and share at each tip: "**1.24B XRP** · 58%". An item's `href` makes its label a link (`components/RouteLink.tsx`: the kit may not import `react-router`; the bar is not a target; the link is an inline block, its hit area 27.6 px high around its 15.6 px line (24 px in a dense list, whose rows are 23.4 px apart and 24 px where a row has a link, so that neighbours do not overlap), and on touch screens and phones the row is 44 px and the area 45.6 px); `tip="count"` ends the tip with the count instead ("**6.1M XRP** · 312 trades"), the bars measured against the first item |
| `Meter` | One ratio on a track, 12 px (6 px `small`), with a threshold tick and its label. `decorative` hides it from assistive technology (`aria-hidden`, no image role) for a cell that says the value in text |
| `InlineBar` | A depth wash behind a table row (bids, asks), or an out/in bar in a cell. The depth form needs the row to be `position: relative`, the bar to be the row's first child and the cells after it to be elements: the stylesheet puts those above the wash, so the text keeps its contrast on it, and a bare text node in the row would sit under it |
| `Sparkline` | A trend of 100 × 28 px with no axes, for a row or a `StatTile` |

`StatTile` and `StatGrid` (`components/StatTile.tsx`) are the home page's tiles, which stay mono at 22 px. `figure` gives a tile the network
pages' style (sans, proportional figures, 24 px, weight 600), `StatGrid narrow` a grid of tiles of 150 px (two in a row on a phone), `delta`
(`{ text, sign }`) a triangle for 1 or -1 (none for 0) and the signed text in `--muted`, after the value and before the note, and `trend` a
`Sparkline` after the note. The sign picks the triangle and the text is the view builder's. `source` is the data API path the tile is made from, a faint mono
line under everything else, and `busy` a tile before its data: `aria-busy` and an empty figure that keeps the height of one line, whatever `value` is.

### Data shapes

View builders import the shapes from `types.ts` (type-only) and hand the kit **exact decimal strings** (spec 2.3). A JSON number becomes a string in
the view builder, with `String(n)` for an integer or `BigNumber(String(n))`: nothing computed in floating point reaches a label.

| Component | Takes | The fields that matter |
|---|---|---|
| `ColumnChart`, `LineChart` | `TimeSeriesData` | `axis` (`unit`: `day`, `week`, `month` (`YYYY-MM-01`, "Oct 2026"), `hour`, `minute` (15-minute buckets) or `flag`; `buckets`: UTC, oldest first), `series` (`id`, `label`, `short` for an end label, `slot`, `values`: strings, `null` for none), `format` (`kind`: `count`, `amount`, `drops`, `percent`, `seconds`, `price` or `value`, an estimate in the native currency; `unit`), `token`. Optional: `totals` (a stack's exact totals), `domain` and `references` (lines), `annotations` (columns), `forming`, `pending`, `extras`, `emptyText` (what the plot, and its summary for a screen reader, says when no bucket has a value, instead of "No data for these 30 days"; the `token` must cover it) |
| `SmallMultiples` | `SmallMultiplesData` | `axis` (shared), `panels` (6 at most: `id`, `label`, `sublabel`, `values`, a `format` of its own), `forming`, `pending`, `token` |
| `Candles` | `CandleData` | `axis`, `candles` (one for each bucket: `o`, `h`, `l`, `c`, `v`, `n`, or `null`), `format` (of the prices), `volume` (the format of the volume), `forming` (the newest bucket is the running one), `token` |
| `ShareBar` | `ShareData` | `rows` (`id`, `label`, `total`, `segments`: `id`, `label`, `slot`, `value`), `token` |
| `BarList` | `BarListData` | `items` (`id`, `label`, `sublabel`, `value`, `share`: the whole text, "58%" or "<1%", not needed with `tip="count"`, `count`: the table's, and the tip's with `tip="count"`, `href`: a path), `format`, `token` |
| `Meter` | `MeterData` | `value`, `max`, `threshold` (`value`, `label`), and `label`, which is the `aria-label` of the image: the view builder writes it, since the numbers are its |
| `ChartTable` | any of the five above | the data of the chart it is the table of |
| `StatTile` | `Delta` for `delta` | `text` (signed, the builder's) and `sign` (1, -1 or 0) |
| `InlineBar`, `Sparkline` | strings | `value`, `max` and `tone`, or `diverging`, `out`, `in` and `max`; `values` and `label` |

`token` is a string the view builder makes from what the chart shows (see "Live updates: memo by token"). `forming` says the newest bucket is the
running one, and `pending` how many of the newest buckets are not computed yet (0 to 2).

`extras` (`TimeSeriesExtra`: `id`, `label`, `values` (one per bucket, `null` for none), `format`, `tooltip`) are the one field for per-bucket figures
that are shown and never drawn, on every form that takes `TimeSeriesData`. The tooltip lists them after the series and the total, with no key:
the value strong and the label muted ("**1** failed", the label's capital lowered when a lower-case letter follows it), or with
`tooltip: "value"` the value alone, for one that is a sentence already. The slider appends `; Failed 1` for each, `ChartTable` adds a column
for each, and no scale, legend or plot summary reads them. A value goes through `format` when there is one (`valueText` in the tooltip and the
slider, `cellText` in the table) and is shown as given when there is not; `null` is "—", read "no data". The `token` must cover them.

### Data and words

- **Strings.** The kit parses a value (an exact decimal string, see "Data shapes") with `Number()` for geometry and for nothing else; every text
  a chart shows is made from the string (`labels.ts`, with the formatters of `app/domain/format.ts`). A `null` is "no value"; a string that is not
  a number is read as `null`.
- **Where the chart draws.** SVG for the lines, areas and steps (one `viewBox="0 0 1000 H"` stretched to the plot, `vector-effect:
  non-scaling-stroke`, so a line is 2 px at any width). HTML boxes in percent for columns, segments, candles, bars, dots, labels, the crosshair and
  the tooltip, because a stretched viewBox cannot keep a column at most 24 px wide or a dot round. There is no `Intl`, locale or clock (month
  names are a fixed table), so the Worker's HTML and the first render in the browser are the same: the kit's tests render with `renderToString`
  and hydrate (`test/support/hydrate.tsx`), and a mismatch fails them.
- **Scales.** Columns, bars and areas start at 0, always. Ticks are a step of 1, 2, 2.5 or 5 × 10ⁿ that gives 4 or 5 (`niceScale`), the top
  tick at or above the largest value. A count has whole steps: where none is in range (maxima 9 and 10) the scale takes the smallest whole step
  that is at least a quarter of the maximum (0, 5, 10), and a count of 2 is 0 to 4. A diverging chart is symmetric about 0. Nothing to draw is 0
  to 4 for a count, else 0 to 1. A line may take a `domain`, `min` and `max`; **a domain must cover its data**: a value below `domain.min` is drawn
  outside the plot, not cut, and one above `domain.max` raises the top of the scale. The
  card's note must say that the axis does not start at 0. Candles use `fitScale`, which does not start at 0 and, for a price, takes steps down to the 8 significant digits `formatPrice` writes (a stable pair at 1.0000 ± 0.0005 is an axis of 0.9995 to 1.0005; near 1e8 the steps are 10 at the least, so adjacent labels stay distinct).
- **Words.** A tick is `tickLabel` (`500K`, `1.2B`; in full under 10,000). **Tooltips and the slider's `aria-valuetext` use `valueText(v,
  format, "full")`**: a count in full (`1,284,331`), an amount or drops compact with its unit (`45.5M XRP`, `113 drops`), a percent and
  seconds exact. **A price is `formatPrice` everywhere** (ticks, readouts, tooltips, end labels, tables): 8 significant digits, half up, trailing
  zeros dropped, grouped, never compact and never an exponent (`0.4099 USD`, `12,345.679 USD`), and a price in exponent text (`1e-10`, which the data
  API writes) is read. An end label is the compact figure and the series' `short` name, with no unit: "**45.5M** payments" (the card's title names the
  currency). The table has the exact string. A `BarList` tip is compact with the unit, then the share text the builder wrote ("58%", "<1%").
- **Time.** Every bucket is UTC. An axis writes "Oct 16" (a week: its Monday, "Oct 12"), "17:00" for an hour, "17:15" for a quarter hour (`minute`) and the day for a flag ledger (each day once: the flag ledgers of a day after its first carry no label). A tooltip or a table
  cell writes "Oct 16, 2026", "Oct 17, 2026, 17:00" for an hour or a quarter hour and "Oct 16, 2026, 09:34 UTC" for a flag ledger. A week is "Week of Oct 12, 2026" in a tooltip only; its table cell is
  "Oct 12, 2026" under the heading "Week of (UTC)" (a quarter hour's heading is "Time (UTC)"). The `Candles` readout, which stands alone above the
  chart, names the zone: "Oct 17, 2026, 17:00 UTC", "Week of Oct 12, 2026", and " · so far" after the running bucket. `forming: true` marks the newest bucket as the running one and adds ", so far" to the tooltip, the slider text and the table, never
  to the axis. `pending: n` says the newest `n` buckets have no value yet: their values are `null`, and the tooltip says "Not computed yet".
  The card's note must say which day is not computed. x labels are every k-th bucket counting back from the newest: k = ⌈n/6⌉ on a wide plot,
  ⌈n/3⌉ under 480 px of card. Both sets are in the HTML and a container query shows one, since the Worker cannot know the width.
- **Colour.** A mark's slot (`1` to `5`, `other`, `up`, `down`, `neutral`) reaches CSS as `data-slot`, which `charts.css` turns into `--mark`; the
  slots are the tokens `--series-1` to `--series-5`, `--series-other`, `--up` and `--down`, and `neutral` is drawn in `--series-other`. Slots go
  by entity in a fixed order, never by rank. **Text never wears a series colour**: labels and values are `--fg`, `--muted` and `--faint`. Three
  slots miss 3:1 on white, so every chart has the table, a chart of several series has a legend, and lines of 4 or fewer have end labels. Under
  `forced-colors: active` the marks and swatches keep their colours (`forced-color-adjust: none`).

### What a visitor can do

- **The toggle works without JavaScript.** The Chart/Table switch is a `<fieldset>` of two native radios named `{id}-view`, Chart checked in
  the HTML. Where `:has()` works, `.chart:has(input[value="table"]:checked)` hides the chart view and shows the table view. Where it does not,
  both views show and the toggle is not drawn, since a switch that changed nothing would be a dead control. The radios are uncontrolled
  (`defaultChecked`), so a beat of the live page leaves the visitor's choice alone. The hidden view is `display: none`.
- **A chart is one image to a screen reader.** The marks are in a `role="img"` whose label is the kit's own summary ("Transactions by type per
  day, Sep 17 to Oct 16, 2026. Highest Oct 3, 2.31M; latest Oct 16, 2.1M. Choose Table for every value."). The marks inside are `aria-hidden`.
  It reads the totals when there are some, else the first series. A chart of several lines with no totals (the volume card) names that first line,
  because the figures are its alone ("Highest Payments Oct 3, 45.5M XRP; latest Payments Oct 17, so far, 12.1M XRP"); the other lines are in the
  table. A running bucket (`forming`, the newest of the axis) that the summary names says "so far" after its date, as the tooltip does.
  `Sparkline` and `Meter` are one image named by the label the builder wrote. `BarList` is a list: its bars are `aria-hidden` and its text is read.
- **Hover and keyboard come with the script.** After hydration (`useHydrated`, a `useSyncExternalStore` in `app/ui/use-hydrated.ts`) a `Cursor` adds a transparent
  `role="slider"` over the plot with `aria-valuetext` for the bucket, so a screen reader hears each step with no live region. A pointer selects
  the nearest bucket; focus the newest; Left and Right, Home and End move (Page Up and Page Down too, `pageStep` buckets towards the newest and the oldest, when a chart of many buckets gives one; the slider names them in `aria-keyshortcuts`); Escape and blur hide. The tooltip is `aria-hidden`, at most
  `min(260px, 90%)` wide, to the right of the cursor under 22% of the plot, to the left over 78%, else centred. The active mark is marked in the DOM
  (`data-active`, `is-active`), so a pointer move renders the overlay and not the marks. `HoverGroup` gives small multiples and candles one bucket.
  The Worker's HTML has none of this. `Sparkline`, `InlineBar` and `Meter` have no hover: the row or tile around them says the values.
- **The tooltip is drawn outside the scrolling region.** A column plot with more buckets than its width holds at 5 px each (a slot is 5 px at
  the least) scrolls sideways inside a focusable region ("{title}, scrollable chart"), which would clip a tooltip drawn inside it, so `Plot` draws it
  beside the region. On touch, `.plot__cursor` has `touch-action: pan-y`, so the page scrolls; in a region that scrolls it has `pan-x pan-y`, so a
  sideways swipe scrolls the plot and a tap still selects. A tap keeps the tooltip until a touch lands elsewhere.
- **Sizes.** The plot is 200 px high, 160 px under 480 px of card (the card is the container, not the window). The line chart's end labels have
  a gutter of 112 px, which is left out under 480 px: the legend and the tooltip carry them. A later end label is dropped when it would sit within
  16 px of one that is drawn.
- **States.** A `null` is a gap (a line breaks, a column slot is empty, a table cell is "—", the tooltip says "No data for Oct 3"). A 0 is drawn
  at 0. With no value at all the plot has its empty scale and says "No data for these 30 days". A series that is left out is not in `series`: no
  legend entry, end label or column. The CSS dims a card to 55% under `.is-refetching`, with no skeleton: the page puts that class on an element
  above the cards while it fetches another period or currency.
  A reference's label is drawn and is in neither the summary, the slider nor the table, so the card's note must say the threshold.

### Live updates: memo by token

Each chart is `memo`'d on its data's `token`, a string the view builder makes from what the chart shows, and on the props that change what it
draws (`title`, `layout`, `area`, `curve`, `dense`). A beat of the live page that brings the same token renders nothing and moves nothing, though
the page's data object is new. A new token redraws the chart in place and, when it changes after the first render, gives its box the ring of a
changed figure: 3 px of `--accent` outside it, fading out over 1.2 s, once (`value-mark`, the animation of `LiveValue`; it stays under
`prefers-reduced-motion: reduce`, as a colour that fades). There is no ring on the server's render, on hydration or on a navigation, so a page
that shows another view must remount (`key`) or the ring runs on the way in. Marks do not tween. `Sparkline`, `Meter` and `InlineBar` are not
memo'd: they have no token and cost almost nothing.

### The kit's boundaries

- **The bundle rule.** `test/unit/charts-bundle.test.ts` reads every file of `app/ui/charts/` and allows as value imports only `react`, the kit's
  own files (`./…`), `app/domain/format` (`bignumber.js` is in the bundle already), `app/ui/cx`, `app/ui/use-hydrated` and `app/ui/components/*`; nothing from
  `app/server`, no charting package in `package.json`, and **no barrel file**: a page imports the modules it draws, so it loads only those. Type
  imports are erased and are free. A re-export is a barrel too: the markets page once took `useHydrated` from `Plot.tsx` and so loaded `Plot`,
  `Cursor` and `labels` (3.3 KB of its figure) for one line. So the hook is a module of its own, `app/ui/use-hydrated.ts`, which imports only
  React: the kit's `Cursor` and `ShareBar` and a page that draws no plot (`MarketsPage`) all import it from there, and
  `test/unit/markets-bundle.test.ts` holds the markets page to that (it imports neither `charts/Plot` nor `charts/Cursor`). The spec's estimate for what the network page loads of the kit is about 7 KB gzipped, and the page's target
  is 145,000 bytes (the budget is 150,000). The page measured 146,616 bytes, over the target, so the fallback the spec decided on was tried and taken out again: `Cursor` and the tooltip
  loaded with `import()` on the first `pointerenter` or `focusin` of a plot (a `CursorSlot` layer in their place until then). It did not make any page lighter, and every page was heavier for
  it ("The client bundle check" has the figures), so a plot draws `Cursor` directly and the cursor is in the page's first JavaScript. What the page needs to lose is elsewhere in its route chunk.
- **The kit's contexts stay inside it.** `Cursor.tsx`'s two React contexts, `TipSlotContext` (the slot a plot draws its cursor's tooltip in) and
  `HoverContext` (the bucket a `HoverGroup` shares), are provided and read by the kit's own components (`Plot`, `Cursor`, `SmallMultiples`,
  `Candles`): no module outside the kit imports a module of it that creates a context, and no module of the kit keeps state of its own at module
  level. The analytics view has a copy of the kit of its own ("The client bundle check"), and these two rules are what make two copies in one
  browser safe: the build fails when the first is broken (`scripts/analytics-kit-copy.ts`), and `scripts/analytics-kit-copy.test.ts` holds the
  sources to both.
- **The kit's classes are its own.** They live in `charts.css`, which `styles.css` imports after `components.css` and before `pages.css`. A class
  of the kit's is never defined in `pages.css`, which loads later and would override it: the pages' `.cols` once made every column of a chart 0 px
  high on a real page, where the tests, which have no stylesheet, saw nothing wrong. The kit's row of columns is `.plot__cols`, and
  `test/unit/charts-css.test.ts` fails when `pages.css` shares a class with it.
- **What the tests cannot see is pinned in the CSS.** The same file reads `charts.css` and `components.css` rule by rule (sizes, radii, the tokens a
  mark wears, the toggle's `:has()` and its fallback, the 44 px targets, the touch rules, forced colours, the rings), and `tokens.test.ts` checks
  the contrast of `--muted` on each depth wash and of the meter's fill on its track. A new form adds its rules to both.
- **Tests.** Each component has a `*.test.tsx` beside it that renders it as the Worker prints it, hydrates it, and checks the marks, the words,
  the states and the memo. `geometry.test.ts` and `labels.test.ts` are the pure functions.

## Home and ledger pages

`/{net}` (`routes/net._index.tsx`) and `/{net}/ledger/{index|hash}` (`routes/net.ledger.$id.tsx`) are children of the `/:net`
layout. Each loader asks the data API (and, for a ledger the index lacks, the node), hands the answers to a view builder in
`app/server/` and returns the result with `cached(...)`; the page component in `app/ui/pages/` only draws it. The browser never
gets a transaction's JSON, only what a row shows, so the parsing and summary code (`describe/`, `parse/`) stays in the Worker.

| | Loader | View builder | Page |
|---|---|---|---|
| Home | `last_validated`, `network/fees` (8) and `transactions` (8) side by side (kept 2 s: `HOME_CALL_TTL_SECONDS`), then `ledgers/{latest}` for the supply, where `latest` is `last_validated`'s ledger or, if the fees list is not up to it, the newest ledger the list has (`latestLedgerIndex`) | `homePage` (`home-view.ts`): tiles, ledger rows (counts and close times from the fees rows), transaction rows (`headlineAmount`), the hero's examples | `HomePage` |
| Ledger | `ledgers/{id}?expand=true` and `last_validated` side by side; the node's `ledger` when the index says not found | `ledgerPage` (`ledger-view.ts`): header, counts by type and result, fees (exact, as drops), accounts created, one row per transaction (`rowSentence` of `describe`), the raw header | `LedgerPage` |

- **Cache classes.** Home: `live-home` (1 s fresh, 2 s stale; the table under "The Worker entry"). Ledger: `immutable` unless its index is the newest validated one (then `live`); a ledger
  shown from the node is `short` with a 60 s TTL and the note "Not in the index yet, shown from the network"; a ledger neither
  has, and an id that is neither an index nor a hash, is a 404 of class `short` (for a hash it offers "Search on {other network}",
  `/{other}/search?q={HASH}`, as the transaction page does; an index is a number on both networks and gets no offer). A lower-case or mixed-case hash, and an index with
  leading zeros, are 302 redirects (class `immutable`) to the one URL an object has. Failures of the data API are 503s through
  `upstreamFailure`, so the edge serves a stale copy or its busy page; the node is asked only for "not found", never for an
  outage. A 400 of the data API for an index or a hash the loader has checked is the API's fault, not a missing ledger: a 503 through
  `upstreamOutage`, as on the transaction page (and not stored). A call a page cannot do without but the visitor did not ask for (the newest ledger, the home page's lists) goes through
  `upstreamOutage`, which makes even its "not found" a 503. Both loaders wait for all their side-by-side calls before they throw, so
  nothing is left running behind an answered request.
- **No deferred data.** An `immutable` page is stored for a year, so everything is loaded in the loader.
- **Ledger list.** Every transaction is in the loader data; the page shows the first 100 (`FIRST_ROWS`) and "Show all N" shows the
  rest without a request. The type filter works on the whole list: a button for each of the seven commonest types, "Other" for the
  rest. A ledger of 1,500 transactions is about 740 KB of HTML.
- **Ages.** The stored HTML carries close times (`17:01:12`, `at 17:01:12 UTC`), never an age: `RelativeTime` fills in "3 s ago" in
  the browser (one shared timer, none while the tab is hidden), because a page is stored for seconds or for a year.
- **Tables** (`DataTable`) scroll inside their card below their `minWidth`, which must be at least the sum of the tracks, the gaps
  and the padding of a row, or the rows' borders and hover end early. What scrolls is a region (`role="region"`, named "{table}, scrollable
  table", `tabindex="0"`) so that a keyboard can scroll a table whose rows hold nothing to focus (axe: `scrollable-region-focusable`);
  its focus ring is drawn inside it, as the card around it clips an outside one. The name is not the table's: the card around a table
  is a region named by its title, often the same words, and two landmarks of one name cannot be told apart (axe: `landmark-unique`).
- **Previous and next ledger** are links named by the number they show, then what they are (`107,720,687, previous ledger`), because an
  accessible name has to contain the visible text (WCAG 2.5.3, axe: `label-content-name-mismatch`): somebody who says "click
  107,720,687" must reach it. The one that leads nowhere is a `span` with `role="link"` and `aria-disabled`, because a
  name cannot be given to an element with no role (axe: `aria-prohibited-attr`), and says why: the next of the newest ledger is "not validated yet"; the
  previous of ledger 1 is "this is the first ledger".

### Live updates

The home page follows the chain: a ledger closes every 3-4 s, and while the page is open a new ledger and its data appear in it, with an animation. (Added at the owner's request; spec 3 has a page that is as old as its stored copy.)

The network page (`/{net}/network`) is the second live page and shares everything below; every live page after it will. Nothing here is the home page's alone except what it draws. What a page brings is small:

| | Home | Network page |
|---|---|---|
| `createLiveOnScreen<T extends { build: string }>({ order, merge? })` (`app/ui/live-page.ts`) | `order: (d) => d.latest.index` | `order: (d) => d.anchor.lastValidated`, `merge: (next, shown) => keepLoaded(next, shown, NETWORK_PARTS)` |
| The scope given to `onScreen.reload` and `onScreen.show` | `params.net` | the network and the canonical search, so that a refresh of another view never stands in for this one |

`order` says how far along the chain the data is: an answer with a lower `order` than the page on screen is older and is not drawn. `merge` is what a page shows for an answer that *is* taken, when the page of its scope is on screen (`OnScreen.reload` applies it after the refusal, never for a refused answer, for a navigation or for a failed load). `keepLoaded(next, shown, parts)` is the merge of a page made of parts that fail on their own: a part named in `parts` that is `"failed"` in the answer and not in the page on screen is taken from the page on screen, so that a transient failure does not put an error in place of a card every beat; a part that has never loaded shows its error, and the result is the answer itself when nothing is kept. The pause is one key for the tab (`explorer:live-paused`), so a pause on one live page holds on the other.

- **The refresh.** `useLiveRefresh` (`app/ui/use-live-refresh.ts`, used by each live route through `useLiveControls`) calls React Router's `useRevalidator().revalidate()` every 4 s (`LIVE_REFRESH_MS`; `useLiveRefresh({ everyMs })` and `useLiveControls(store, { everyMs })` take another beat: `VALIDATORS_REFRESH_MS`, 10 s, and `AMENDMENTS_REFRESH_MS`, 60 s) while `document.visibilityState` is `visible`. A hidden tab stops the timer and costs nothing; when it is shown again the data is asked for at once and the beat goes on from there. A beat is skipped while a revalidation is running (`revalidator.state`, and a flag of the hook's own for the instant before React has drawn that, because React Router *restarts* a revalidation that is asked for again) or a navigation is in progress. The timer and the `visibilitychange` listener are removed when the page is left. The hook only has effects, so the server's HTML and the first render in the browser are what they were (no hydration mismatch). The browser never calls the data API: the request is the explorer's own `.data` URL for the page's route alone, `/{net}.data?_routes=routes%2Fnet._index`, which the edge cache answers like a page (class `live-home`: a copy up to 1 s old as it is, one up to 3 s old at once while one render refreshes it, an older one after a render; and one render at a time for any number of visitors, see "Single flight"). A tab that is open costs one request per 4 s, which the visitor limit (60 uncached renders per 10 s per address) counts only when it misses the cache. **How old the page can be** when it is drawn: the copy at the edge is at most 1 s fresh plus 2 s stale, and what it was rendered from (the home page's three calls, kept 2 s) was at most 2 s old when it was: about 5 s in the worst case, a ledger and a little, and usually much less.
- **One ledger on the page.** `last_validated` and the fees list are read from different places and can disagree for a moment (the list is computed from the ledger table, which may not have the ledger `last_validated` names yet): the tiles used to say "—" for that ledger for a beat. The loader takes as the latest the newest ledger the fees list has when `last_validated` is ahead of it (`latestLedgerIndex`, `home-view.ts`), and asks for that ledger's header, so the page is at most a ledger behind and the tiles and the hero always say the same ledger.
- **When a refresh does not work** (a 503 page, which React Router gives a loader as an `ErrorResponse`, a network error, an answer that never comes, an answer the page will not draw). React Router 8.4 drops the route's data when its loader throws and shows the nearest error boundary in its place (`processRouteLoaderData`: `ResetLoaderDataSymbol`, then `findNearestBoundary`). It asks the Worker for a route that has a `clientLoader` (the home route, and the network route) **in a request of its own**, `?_routes=routes/net._index` (the network page's is `/{net}/network.data?…&_routes=routes%2Fnet.network`), made when the `clientLoader` calls `serverLoader()`; the routes that have none (the `/:net` layout) are batched into another request, in parallel (`singleFetchLoaderNavigationStrategy` in `dom/ssr/single-fetch.js`: `if (shouldAllowOptOut(m) && hasClientLoader)` at line 131, `routesParams.size === 0` at 165). So a refresh that fails would, left alone, also fail the layout and put *its* boundary, the whole page frame, in place of the page. Two things keep the page: the `/:net` layout (`net.tsx`) says `shouldRevalidate = onlyWhenParamsChange` (`app/ui/revalidation.ts`; its data is the network and the origin, which nothing a revalidation could change), so no request is made for it and a refresh is one request, for the page's route; and the route's `clientLoader` (the home route's, and the network route's) runs the server's loader through the page's `OnScreen` (`app/ui/on-screen.ts`, made by `createLiveOnScreen` in `app/ui/live-page.ts`), which hands back what the mounted page already shows when the loader fails (the component tells `show` in an effect and withdraws it when it unmounts). A navigation to the *other* network's home does change the layout's parameter, and makes the two requests in parallel; it has nothing of that page on screen to keep, so it gets the error screen as before, as does a navigation to the home page from another page. A thrown 3xx `Response` (a redirect) and an abort are React Router's and pass through. **The page stays as it was and its times keep counting up (`RelativeTime`).** What the polling then does:
  - **Backoff:** each refresh in a row that did not work (failed, took more than 10 s, or was not drawn) doubles the wait, 4, 8, 16, 32 s and then 60 at the most (`refreshInterval(failures, everyMs)`: from the page's beat, up to `max(60 s, 4 × beat)`, so a 10 s page stops at 60 s and a 60 s page at 240 s); the first one that works starts it again at the beat. `OnScreen.failures()` is the count, `useLiveControls` reads it with `useSyncExternalStore`, and the hook restarts its timer when it changes.
  - **Timeout:** a refresh that has not settled after 10 s (`REFRESH_TIMEOUT_MS`) is given up on, as a failure, and a late answer is ignored: a fetch that hangs cannot stop the beat. (React Router gives a `clientLoader` no way to abort the server fetch itself; the page races it.)
  - **Signal:** after two failures in a row the hero says, in visible text, "Live updates paused, retrying…", and when they work again "Live updates reconnected" for 4 s (`LiveStatus`). It is a `role="status"` element that is always in the page, and changes its text only on these transitions, so a screen reader hears it once for each and not every beat. The green dot of the line goes quiet while the updates are stopped.
  - **Refused answers:** an answer with a lower `order` than the page on screen (the edge replaces a failing render with the stored copy of any age) is not drawn; it counts as a failure. An equal `order` is drawn: a beat inside one ledger is an answer.
  - **A deploy:** the loader data carries the Worker's `BUILD_ID` (`HomeLoaderData.build`, a short git commit, not a secret; every live page's data has a `build`). An answer of another build than the page's own is not drawn (code of the old build must not draw data of a new shape): the document is reloaded, **once for each pair of builds** in a tab (`explorer:build-reloads` in `sessionStorage`, noted when it reloads; where it cannot be written the page does not reload, because a loop is worse than an old page), and the refresh counts as a failure until it does. **Not while the visitor is typing:** a reload throws the text away, so the page waits while any field for text (the hero's search box, any other `input`, `textarea` or editable element; not a button, a checkbox...) has focus or holds text, and reloads when none has focus and all are empty (`focusout`, `input`, `change`), or when the tab is hidden. It is one wait for each pair of builds however many answers of the new build come meanwhile.
  - `app/ui/revalidation.test.tsx` shows both the error screen without these and the kept page with them; `app/ui/routes-wiring.test.tsx` runs the real `net.tsx`, `net._index.tsx` and `net.network.tsx` through a data router for all of the above (deleting `shouldRevalidate` or `clientLoader` fails it); `test/e2e/live-home.spec.ts` and `test/e2e/network-live.spec.ts` do it in the browser (the Worker's `.data` answers 503, the page stays, the hero says so, then it works again).
- **Pausing, and not moving a row under a click** (WCAG 2.2.2: content that moves by itself for more than five seconds can be paused). A button next to the hero's status (`LiveToggle`, a real `<button>`, 44 px) stops the polling and starts it again, asking at once when it is resumed. **Its label says what it will do, "Pause live updates" / "Resume live updates", and it is not also `aria-pressed`** (a name that changes with the state plus a pressed state would be read "Resume live updates, pressed"); a paused one is `.live-toggle.is-paused`. What the visitor has just done is said by the `role="status"` line, "Live updates paused" / "Live updates resumed", for 4 s: they asked for it, so once for each press is right (a pause read back from the tab's storage is silent). The choice is kept for the tab in `sessionStorage` (`explorer:live-paused`; read after the first render, with try/catch). The button is not in the server's HTML (without the script there is nothing to pause); its row has the height of the button (44 px) from the start, so adding it moves nothing. While the visitor has paused it nothing is retried, and the line does not say "retrying". The page is also **held** while a mouse or pen is over either table or **keyboard focus** is in one, so that rows do not move under a click (a finger does not hold; `useHolds` in `app/ui/use-hold.ts` keeps one hold for each part and each way, and the network page uses it for its strip of chips): the beat goes on and is skipped, and letting go costs at most the wait for the next one. Focus holds (`holdsFocus`) only if the focused element is a link or a button in the table, or matches `:focus-visible` (the table's scroll region has `tabindex="0"` so that a keyboard can scroll it; a *click* on a spot of the table that is not a link also focuses it, which is not keyboard focus and must not hold the page after the pointer has left). What focus does is decided each time it moves, so a click on the region lets go of the hold a link had. While the page is held the hero's row says, in visible text and not in the status line (a pointer moving over the tables is not announced), "Paused while you look at the table", and the dot goes quiet. A hold does not outlive its page: `useHolds` releases it when the page unmounts (the page is remounted for the other network's home; the hook that polls is not). The "All in ledger #N →" link of a card head is not animated. **On the network page** the hold is on the strip of ledger chips (a mouse or pen over it, or keyboard focus on a chip), and the row says "Paused while you look at the ledgers". The charts do not hold: their data moves at most every 300 s, and a change redraws in place under the cursor.
- **What animates** when data changes in the browser: the rows of **Latest ledgers** (keyed by ledger index) and **Latest transactions** (keyed by hash), the four tiles (latest ledger, transactions per ledger, fees burned, total supply) and the notes under three of them, the hero's status line (the ledger, how long ago it closed) and the "Try" examples. Not the ages (`RelativeTime` ticks on its own), the card links, or a figure that says the same as before: each is a `LiveValue` whose `token` is the text it shows, so the supply tile, which keeps to whole units, moves only when a whole unit has burned. **On the network page** the chips of the strip (keyed by ledger index: a new chip enters at the front and the others slide along x), the open ledger's fee, queue and size, the tiles' figures and notes, the validators' count, ledger and five keys, and a chart whose data changed (its box gets the ring of a changed figure, once; nothing in it moves).
- **How.** CSS animations and transitions and a little script; no animation library. *Rows* (`DataTable live`, `use-live-rows.ts`): after the first render a key that was not in the list before is `entering` (`.is-entering`: a fade and a slide from -8px, 400 ms after a 120 ms delay, an accent wash that fades out over 1.2 s and a mark that does too, see "The highlight"); **the class stays on the row for `ENTER_MS` (1.3 s) from the commit that brought it, through any renders in between (the next beat renders the page again), and the script takes it off the row itself** (a timer, cleared with the table); the rows that were there and are somewhere else now slide with FLIP (positions measured from the top left of the table at the end of each commit, in `useLayoutEffect`; a row counts as moved when it is 1 px or more away on either axis, and is put back with an inline `translate(dx, dy)` and no transition, a frame later released with `transform 420ms`, and the transition is taken off at `transitionend`; the rows of a table only ever move on y, the chips of the network page move on x). The row that falls off the bottom is simply gone. *Figures* (`LiveValue`): the new value is in a new element (keyed by its token) that comes up from 0.4em below with a fade and the same highlight (`.is-changed`, 360 ms); the element, and so its animation, stays through renders with the same token. Movement is 600 ms at most and runs once, so nothing flashes more than three times a second. There is **no `aria-live`** on any of it: a screen reader is not told every four seconds.
- **Not on the first render** (the server's, the hydration), and not on a navigation: a switch to the other network's home remounts the page (`key` on `HomePage`), so it is a first render too. An update that brings the same ledger again moves nothing.
- **`prefers-reduced-motion: reduce`.** `base.css` still turns every animation and transition off (`!important` on `*`); `components.css` gives a new row and a changed figure one exception, the colours alone (`animation: live-flash 1200ms ease-out, row-mark 1200ms ease-out !important`, or `value-mark` for a figure; a class beats `*` between two `!important`s): a wash and a mark fading out, once, with nothing moving. The script moves nothing either (`prefersReducedMotion()` is read when an update arrives, never while rendering): no inline transform or transition. The value still updates at once.
- **The highlight** is the network's `--accent` in two ways. A *wash* behind the element: `color-mix(in srgb, var(--accent) 2%, transparent)` fading to `transparent` (`live-flash`), a translucent colour, so it fades out on whatever is behind it. **2% is the most that leaves every text colour that can be inside it at WCAG AA** (4.5:1): `--fg`, `--muted`, `--faint` and the link, on the page's own `--bg` (the hero's line, its examples' labels) and on `--surface` (the cards, the tiles, the chips), in light, dark and the system's dark, on both accents. The Xahau accent in light mode is the limit, on `--bg`: 4.53:1 at 2%, 4.47:1 at 3%, and 4.35:1 at the 5% an earlier version guessed (the hero has no card behind it). 2% is hardly to be seen, so a *mark* that is behind no text does the finding: a 3 px bar of the accent in the row's padding (`row-mark`, an inset shadow narrower than the 16 px padding) and a 3 px ring of it outside a figure's box (`value-mark`), both fading out in 1.2 s. `test/unit/live-motion-css.test.ts` reads the percentage, computes the contrast with the tokens, as `tokens.test.ts` does, checks that a whole percent more would fail, and checks that the marks cannot reach a letter.
- **Limits.** A slide that is interrupted by the next update (updates are 4 s apart and a slide is 0.4 s) restarts from where the rows would have been, not from where they were drawn. Row heights are fixed (`min-height: 46px`, one line), so positions recorded at the end of a commit are not made stale by a resize. A changed figure keeps its `is-changed` class until the next change (its element does not change, so the animation does not run again); a switch of `prefers-reduced-motion` while the page is open would run it once more. The home page's initial JavaScript stays under the budget (see "The client bundle check").

## The transaction page

`/{net}/tx/{hash|ctid}` (`routes/net.tx.$id.tsx`) is a child of the `/:net` layout like the ledger page: the loader asks the clients, `app/server/transaction-view.ts` (`transactionPage`) works the page out, `cached(...)` names the class, and `app/ui/pages/TransactionPage.tsx` draws it
(with `Flow` for the money's way and `RawTabs` for the raw data). The page data holds the sentence (segments), the flow, the
details, the balance changes, the objects touched and the neighbours; the transaction's own JSON reaches the browser only as the
text of the raw tabs (`raw.tx`, `raw.meta`), so `describe/` and `parse/` stay in the Worker (`test/unit/transaction-bundle.test.ts`
fails if the page's files import them as values).

| Request | Answer | Class |
|---|---|---|
| a hash in upper case, found by the data API | the page; the transaction, `?binary=true` and `/v2/ledgers/{index}?transactions=true` (for the neighbours) are asked for | `immutable` |
| the same, and the binary call failed, or answered something that is not hex (the client throws, nothing is stored; the reason is logged) | the page, its Binary tab saying "The binary form could not be loaded just now. Try again in a minute." | `short` (30 s), never `immutable` |
| the same, and the binary answer is JSON (the API's codec cannot serialize this type, so it serves what it stored: a lasting answer) | the page, its Binary tab saying "The index has no binary form for this type of transaction." | `immutable` |
| the same, and the ledger's list failed, was "not found", or does not hold the transaction at its place | 503 (`upstreamOutage`): a missing neighbour would be stored for a year | not stored |
| the data API says "not found" | the node's `tx`; a transaction in a validated ledger is shown with "Not in the index yet, shown from the network", **without** previous/next and Binary (they say they appear once it is indexed) | `short`, TTL 60 s |
| neither has it, or the node's answer is not validated | 404 with the search box and "Search on {other network}" (`/{other}/search?q={HASH}`) | `short` (30 s), `noindex` |
| any other failure of the data API (5xx, 429, timeout, a 200 without a usable transaction), and a 400 (the hash is well formed, so the refusal is the API's fault) | 503, the node is not asked | not stored |
| a hash in another case | 302 to the upper-case URL, nobody asked | `immutable` |
| a CTID of this network | 302 to `/{net}/tx/{HASH}` (`resolveCtid`); a CTID that names nothing, or of a network id that is neither XRPL's nor Xahau's, is a 404 | `immutable` redirect, `short` 404 |
| a CTID of the other network | 200: the page the search shows ("That CTID is on Xahau", with the link), nobody asked; `noindex, follow` | `short` |
| anything else (also `0x` + hash) | 404, nobody asked | `short` |

- **Position.** "transaction 12 of 66" uses the number the ledger page's `#` column shows (`TransactionIndex`, counted from 0), and
  Previous / Next are `#11` and `#13`. They link to `/{net}/tx/{HASH}` of the neighbours in the ledger's list, which has only
  hashes, so a link shows a position and no type. At either end of the ledger the link is shown disabled ("first in ledger").
- **Binary.** The API's hex is the serialization itself (it re-hashes to the transaction hash), so the Worker never encodes: the
  Binary tab shows the hex of the transaction (the blob the hash is taken over) and of its metadata. A tab without hex says why, and
  what it says is true: "try again in a minute" for a page stored 30 s, "no binary form" for a type the index cannot serialize,
  "appears once the transaction is indexed" for a transaction shown from the node.
- **Checked before it is kept.** `transaction`, `transactionBinary` and `ledger(id, { transactions: true })` check their answers
  in the client (`tx-shape.ts`), so the page code reads what is whole and the node's transaction is the one answer it checks itself
  (`txFromNode`). `neighboursOf` only asks that the ledger's list holds this transaction at its place. An expanded ledger
  (`expand=true`, the ledger page's) still takes a list that is missing for an empty one.
- **Raw tabs without JavaScript.** All three panels are in the page, one under the other, each under an h3 and all under a visible
  h2 "Raw data"; once the script has run they become a tablist (real buttons, arrow keys, Home and End, but not with Alt, Ctrl or
  Cmd, which stay the browser's) with one panel and a Copy button, and the h2 stays for screen readers (`sr`), as on the board. A
  panel that is only a note takes the focus itself. The server's markup and the first client render are the same, so nothing
  mismatches. A block of raw text (`.code`) is focusable and draws its ring inside, as the card around it would clip an outset one.
- **Layout.** The page's order is the phone's (TransactionMobile): details, balance changes, the margin (result, ledger and
  neighbours, objects), the raw data last. At 900 px and wider `.txgrid` (pages.css) is a grid whose areas put the raw card in the
  left column under the balance changes and the margin on the right, as the desktop board does; the columns are `minmax(0, 1fr)`
  so the balance table, which has a minimum width, scrolls inside its card and never widens the page.
- **Currencies.** An issued currency shows the other side of its trust line under its code (`with rMxCKb…m5De`): the issuer in a
  holder's row, the holder in the issuer's own, so it is not called "issuer".
- **The sender's native change** in Balance changes is the whole change of its balance, fee included (the page says so; the fee has
  a row of its own). A change shows a plus sign in the success colour or a minus sign; the roles (sender, destination, AMM pool)
  are tags beside the account.
- **No age** is in the stored page (`RelativeTime` fills it in in the browser), and nothing is streamed.

## The account page

`/{net}/account/{address}` (`routes/net.account.$address.tsx`, a child of the `/:net` layout): the loader asks the clients,
`app/server/account-view.ts` works out what the page shows, and `app/ui/pages/AccountPage.tsx` draws it (with `Identicon`, `QrButton`
and the tabs of `Tabs`). The tabs are `?tab=transactions|payments|trades|offers|objects` (each a link, so each works without
JavaScript); Analytics (`?tab=analytics`) is a `rel="nofollow"` link while `ACCOUNT_ANALYTICS` is on and the disabled "soon" tab while it
is off. Lists are newest first, 20 a page, with Newer and Older.

| Request | Answer | Class |
|---|---|---|
| an X-address | 302 to the classic address, with `?tag=N` for its tag | `immutable` |
| an address that is not an account | 404 without a call, noindex | `short` |
| an unknown `?tab=`, or a `marker` on Offers or Objects (they have no pages) | 302 to the URL without it | `short` |
| `?tab=analytics…` with `ACCOUNT_ANALYTICS` off | 302 to `/{net}/account/{address}`, without a call | `short` |
| `?tab=analytics…` with it on, in any query but the view's canonical one (`tab=analytics`, then `period` when it is not `30d`; compared as it came, so an escaped spelling is redirected too; the `_routes` that React Router's client adds to a client-side navigation's `.data` request is not part of it, or the canonical URL would redirect to itself) | 302 to the canonical URL, without a call | `short` |
| `?tab=analytics…`'s canonical URL | the analytics view: the header without the holdings awaited, the frame and six cards **streamed** after it (see "Account analytics" below) | `live`; with a part that failed or came late, served and not stored |
| the first page of a tab | the page; header read from the data API (creation, balances) and the node (`account_info`, `account_objects` with `limit: 400`, `server_state`), the list **streamed** after it | `live` |
| a page reached with a `marker` | the page, awaited whole: the list and nothing else (no live state, no activation, and the creation record is not asked for); `noindex, follow` | `slow` (`MARKER_PAGE_CLASS`, see below) |
| a marker the API refuses (400), that is not base64url, or that has nothing behind it (an empty list) | 404 | `short` |
| the index has no creation, the node no account **and** `?limit=1` of the account's transactions is empty | 404 "This address has never been activated" with a link to the other network; noindex | `short` |
| the index knows it and the node says it is gone, or neither knows it but the index has a transaction of it | the history with a "Deleted" banner, no balance, tokens or owned objects (the activation says it is not in the index when there is no creation record) | `live` |
| the node did not answer (any of its three calls) | the history, "Live state unavailable" with a Retry, the balance the index read; what only the node tells is left out | served, not stored |
| the streamed list failed (or took more than 4.5 s) | the header and, in place of the list, "Couldn't load transactions" with a Retry | served, not stored |
| balances failed | the page with "Couldn't load tokens" and a Retry | served, not stored |
| the index failed on the account, or has nothing and the node did not answer, or the one-row history could not be asked | 503 (it cannot be told from an address that does not exist) | not stored |

- **Streaming.** On the first page the loader awaits the header and returns the list as a promise (`Suspense` and `Await` in the
  page), so the HTML holds the header before the list. The promise never rejects: a failure is a list of state `failed`, which the
  page shows as the section error. It is settled before the framework stops streaming (`streamTimeout`, 5 s), by a 4.5 s deadline of
  the loader's own, so a slow upstream cannot leave the browser with a rejected promise. Bots get the whole document
  (`entry.server.tsx` waits for `allReady` for them). A page behind a marker awaits its list: it is stored (for an hour) and must be whole.
- **Retry** fetches the route's own data again in the browser (`useRevalidator`: the explorer's `.data` URL, never the data API). A
  degraded answer was not stored, so the retry reaches a fresh render, which is stored if it is good.
- **Marker pages are `slow` (1 hour), not `immutable`: a deliberate deviation from spec 2, which the owner is to confirm.** The spec has
  them stored for a year because "markers are stable under new data", and at the head of the index they are. But data-api-new writes
  history *below* the frontier: its range backfill runs beside the live syncer, `--reprocess` rewrites rows after a parser change, and
  gap repair fills holes. An account whose history crosses the frontier would get its oldest marker page stored without an Older link,
  and a repaired or reprocessed payment or trade would stay stale for a year (the page, and the subrequest under it, which has the same
  class, until a deploy changes `BUILD_ID`). The choice is one constant, `MARKER_PAGE_CLASS` in `app/server/cache-class.ts`, used by the
  list calls of `data-api.ts` (`listClass`) and by the account route; when backfill is finished and nothing rewrites history any more,
  set it to `"immutable"` and change the tests that pin it (`data-api.spec.ts` "after a marker", `account.spec.ts` "paging") and this
  paragraph. The pages stay `noindex, follow`.
- **No live state, no activation behind a marker.** Such a page is stored for a long time (an hour, a year if `MARKER_PAGE_CLASS` is
  `immutable`), and a balance in it would be as old as the page; the activation is slow-class data (an hour) that must not sit in a page
  stored for a year, and the index has no creation record for an
  account created before its first ledger (it is filled by range, genesis accounts have none), which the first page shows as active
  all the same. So the page shows the address and the list, and a link to the first page for the rest. It 404s only when the API
  refuses the marker or there is nothing behind it.
- **Newer and Older.** The API's markers run towards older rows only. Older is the `next` marker of the answer; a page remembers
  how to go back in its own URL, `?marker=M3&back=M2.M1` (the markers of the pages before it, nearest first, at most ten); the
  second page's Newer is the first page, which has no marker. A URL with a trail that is not one is read as having none.
- **Exists, deleted, never funded.** `existenceOf(created, info, history)` (the index's creation, the node's `account_info`, and, only when
  neither has the account, whether the index has a transaction of the address: `accountTransactions(a, {limit: 1})`): both have it,
  active; the index only, deleted; the node only (the index is behind), active without an activation line; neither, and a history,
  deleted with the activation unknown; neither and no history, never activated. Not being able to tell (the node down, the history
  call failing) is a 503, never a page that says it.
- **Last active.** The time is the close time of the ledger of `PreviousTxnLgrSeq`. The lookup starts as soon as `account_info` has
  answered and has its own deadline of 1.5 s, so the header takes as long as its slowest call and never more than that deadline
  longer; without a time the flag shows the ledger (`ledger #107,720,688`), and the page is not degraded. A ledger the index does not have
  yet (`not_found`: the index is behind the node, the ordinary case of an account that has just been active) is not logged; any other
  failure of the lookup is.
- **Reserve.** `reserve_base + owner_count × reserve_inc` from `server_state`'s `validated_ledger` (drops, cached 5 minutes), and
  the available balance is what the balance leaves, never below 0, in `bignumber.js`. Nothing is hard-coded, so a vote of the
  validators shows up. The page prints "Reserve 1.2 XRP = 1 base + 1 object × 0.2".
- **QR code and identicon.** The QR code is drawn in the Worker (`qr.ts`) and reaches the page as an SVG path inside a closed
  `<details>` (the summary is the button), black on white in either theme with the quiet zone scanners want. A page opened with a
  valid `?tag=N` has the X-address (the address with that tag) in it and says so in the code's label and caption, so that a wallet that
  scans it fills in the tag too; without a tag it is the classic address. The identicon is a 5 x 5 pattern drawn from the address
  (`app/domain/identicon.ts`), in the network's accent.
- **Flags** are named for each network (the same bit is the AMM flag on the XRP Ledger); a bit nobody here knows says nothing. The
  flag that asks senders not to pay in the native currency (`lsfDisallowXRP`) is "Asks not to receive XRP" (XAH): it is advisory.
  Owned-object counts are singular for one (`1 escrow`). The
  domain is the hex of an ASCII text, shown as text and never as a link. The destination tag of `?tag=` is shown in a note when it is
  a decimal 32-bit number written the one way, and is never echoed otherwise.
- **The tabs.** Transactions has the date, type, what happened (from the account's side: its own transactions leave their sender
  out), the change of its balance (the native one first, and how many others) and the result. Payments are signed from the account's
  side with the destination tag, and link to the CSV. Trades say buy or sell, the pair, the amount, the rate and the counterparty.
  Offers are read live from the node through the index and show the rate worked out from the total and the quantity (8 significant
  digits); the API gives one page of at most 200 (no total, no marker), so a page that is full says "Showing the first N open offers"
  and not "All N" (`OrdersResponse.limit`, as for the tokens). Objects lists what the account owns besides trust lines and offers (escrows, checks, payment channels, NFT pages, tickets,
  signer lists, deposit preauthorizations) with their fields; with a `marker` from the node it says "Showing the first 400 objects".
- **No ages** are in the stored page (`RelativeTime`), as on the other pages.
- **The mock's counts** on the tabs and its type filter are not here: the API has no totals (spec non-goals), and a filter over 20 rows
  would hide a page that has its own markers.

### The payments CSV

`/{net}/account/{address}/payments.csv[?marker=...]` (`routes/net.account.$address.payments[.csv].ts`) is a resource route: one page of
the data API's own CSV (`/v2/accounts/{address}/payments?format=csv&descending=true&limit=1000`, the most the API serves), streamed.
The address and the marker are checked before any call (a 404, noindex, class `short`). What goes out is the body, `Content-Type:
text/csv`, `Content-Disposition: attachment` with the explorer's own name `<address>-payments.csv`, `X-Robots-Tag: noindex`,
`X-Content-Type-Options: nosniff` and, when the API says there is a next page, a `Link: </net/account/a/payments.csv?marker=...>;
rel="next"`: the API's own `Link` names its own URL and is never passed on. The key goes to the API in `X-API-Key` and nowhere else.
Class `short` (the edge keeps 30 s of it); a failure of the API, or a 200 that is not CSV, is a 503 and is never stored. Each crawl would
cost an upstream CSV of up to 1000 rows, so crawlers are kept off it twice: the Payments tab's link is `rel="nofollow"`, and `robots.txt`
disallows `/*/account/*/payments.csv` (as it does `/*/search`).

### Account analytics

`/{net}/account/{address}?tab=analytics[&period=90d|1y|all]` (E4, `docs/superpowers/specs/2026-10-19-account-analytics-design.md`): the account's value, the
transactions it sent, its balances, its money in and out, where its balance changes come from, its counterparties and its DEX trading, from D2's
`stats/{family}?interval=` and `analytics/*` routes of the data API. The pieces: `app/domain/analytics-params.ts` (the periods, `parseAnalyticsQuery`,
`analyticsHref`, the period phrases), `app/server/analytics-load.ts` (the calls, the deadline, the background completion and the marks),
`app/server/analytics-view.ts` (the frame and one pure builder per card: every sum, difference and quotient in `bignumber.js`, handed on as strings),
`app/server/analytics-shape.ts` (the checks of D2's answers), `app/ui/pages/AnalyticsFilters.tsx` (the filter row, drawn with the account page) and
`app/ui/pages/AccountAnalytics.tsx` (the four tiles and seven cards, a lazy chunk). From the top: the header of the other tabs, the tabs with the filter row
under them (the period links, "Values in XRP: tokens at each day's DEX rate, and 0 without one", the period note), the four tiles, then the account value
and the transactions sent side by side, the balance history, the money in and out, where balance changes come from, and the counterparties and the DEX
trading side by side. There is no Holdings margin.

**The switch.** `ACCOUNT_ANALYTICS` ("Switches"): `"on"` at the top level (development and every test suite), `"off"` in `staging` and `production` until D2
is live there. Every account page's data carries `analyticsTab`, read from it, so the stored HTML, the server's tab bar and the browser's agree. On, the tab is
a `rel="nofollow"` link to the default view from every page of the account (a page behind a marker too: the view is live mode); off, it is the "soon" tab,
and every `?tab=analytics…` URL is a 302 to `/{net}/account/{address}` (class `short`, without a call). The switch is in the cache generation, so the first
request after a flip renders afresh and no stored page keeps the other tab bar. **Rolling back** is `ACCOUNT_ANALYTICS` `"off"` in the environment's block of
`wrangler.jsonc` and a deploy, and nothing else. The tab stays off by configuration until D2 is live rather than detecting 404s, which would cost a probe call on
every account page; a 404 of an analytics route while the tab is on is a card that failed.

**The URL.** One URL per view: the canonical query is `tab=analytics`, then `period` when it is not `30d`, compared as it came. Anything else (`period=30d`, an
unknown period, a repeat, the other order, `marker`, `back`, `tag`, `in`, an unknown parameter, an escaped spelling) is a 302 to it, class `short`, before any
call (the table above). The period links ("30 days", "90 days", "1 year", "All", `SegmentedLinks`) are those URLs, each `rel="nofollow"`, and work without
JavaScript; with it a click is a client-side navigation that keeps the scroll position. The view is keyed by its period, so another period mounts afresh, with
its placeholders and its charts on Chart, and never shows one period's numbers under another's words. Values are in the native currency only: there is no `in=`.

| Period | Bucket | Window (`T` is the UTC day of `last_validated`'s close time) | `S` with the fixtures (`T` Oct 17, 2026) |
|---|---|---|---|
| `30d` (the default) | day | T−29 … T | 2026-09-18 |
| `90d` | day | T−89 … T | 2026-07-20 |
| `1y` | week from Monday | the Monday 51 weeks before the Monday of T's week, to T's week | 2025-10-20 |
| `all` | month | from the month of the account's `inception`, else of its oldest transaction in the index, else T's month; never after T's month | 2025-07-01 (the XRPL active account) |

The last bucket is the running one ("…, so far" in the tooltip, the slider and the table). The period note says the exact dates ("The 30 days from Sep 18
to Oct 17, 2026 (UTC), per day. The last day is counted up to now."), with a sentence more for a deleted account ("This account was deleted; All covers its whole
history.") and for an All of fewer than three months.

**The calls.** The header is the other tabs' without the holdings (`accountHeader(…, { holdings: false })`: no `balances` and no `account_objects` call, and no
Tokens or Owned objects card); its node calls are as on the other tabs. Beside it:

| # | Call | Kept (class) | Timeout | Feeds |
|---|---|---|---|---|
| 0 | `/v2/last_validated` | 5 s (`live`), the ledger page's and the image route's key | 5 s | `T`: the window |
| A | `/v2/accounts/{a}` | 1 h (`slow`), the header's own promise | 5 s | the header; All's `S` |
| P | `/v2/accounts/{a}/transactions?limit=1` | 5 s (`live`), the existence probe's own promise and key | 5 s | All's `S`, only when A has no creation record |
| 1 | `…/stats/value?interval={u}&limit=1000&start={S}` | 60 s (`minute`) | 5 s | tile 1 and the account value |
| 2 | `…/stats/transactions?interval={u}&limit=1000&start={S}` | 60 s | 5 s | tile 2 and the transactions sent |
| 3 | `…/analytics/balance_changes?interval={u}&start={S}` | 60 s | 5 s | tile 3, the money in and out, and where balance changes come from |
| 4 | `…/analytics/counterparties?limit=6&start={S}` | 60 s | **15 s** (`ANALYTICS_SLOW_TIMEOUT_MS`) | tile 4 and the top counterparties |
| 5 | `…/analytics/balances?interval={u}&limit=4&start={S}` | 60 s | 5 s | the balance history |
| 6 | `…/analytics/exchanges?limit=6&start={S}` | 60 s | 5 s | the DEX trading |

Calls 1 to 6 start as soon as the window is known (call 0, and for All A, then P when it is needed), beside the header and not after it, with the same
`start` and `interval` and no `end`, and each asks for `holdFailure` and `shareInFlight`. The four `analytics/*` paths are in `PENDING_PATHS` until D2's
`openapi.yaml` is synced. The view never calls `/balances`, `account_objects` or `amm_volume`. The DEX wording needs no call: it follows `AMM_DATA` (on XRPL the
hint "order book and AMM" and "Includes swaps against AMM pools." while it is on, "on the DEX" and no AMM sentence while it is off; on Xahau "order book" and
"Order-book trades only; Xahau has no AMM."), and a pair, in E3's natural orientation, links to E3's pair page while `MARKETS` is on. `minute` is the API's own
freshness for these answers: the running bucket moves with each transaction of the account, and a heavy account's reads take seconds, so the data API sees about
one set of calls 1 to 6 per account and period per minute per data centre. The page and its `.data` URL are `live`, as every account first page (its header is
live state): a stored view is at most 35 s old in its header and about 95 s in its analytics.

**Streaming and the deadline.** The loader awaits the header (and the existence check) and returns the frame and the six cards as promises that never reject
(`AnalyticsData`). The HTML holds the header first; then the cards' frames with their placeholders, as soon as the window is known (until then the period note's
slot, the view's one `role="status"`, says "Loading analytics…"); then each card in place of its placeholder as its call settles. Bots get the whole document.
Each card is its call and its builder raced against one deadline, the loader's start + 4.5 s (E2's `CARD_DEADLINE_MS` and `byDeadline`), so it has settled
before `streamTimeout` (5 s) ends the stream. A card that misses it is `late`: its tile reads "—" over "Still working on it", the card "Still working on {what}.
Retry in a few seconds.", and its call is handed to `ctx.waitUntil`, so it finishes in the background within its own timeout and the subrequest cache keeps
its answer for 60 s. A late frame hands on its whole chain: once call 0 answers, calls 1 to 6 start in the background and warm the cache. A page that turns out a
404 or a 503 abandons the analytics: their deadlines are cleared, and nothing is logged, marked or handed to `waitUntil`.

**The 15 s call.** D2 gives `analytics/counterparties` 15 s, for the heaviest accounts at 1 year and All. The page cannot wait that long: `streamTimeout` settles
every deferred promise at 5 s, and raising it would hold every streamed page (the account lists too) and every bot that long, keep the edge from storing a page
until its stream ends, and send single-flight waiters (who give up at 15 s) onto the slow call. So the card waits for the deadline like the others, and a late call
goes on under `waitUntil`: it ends at most 25 s after the request (calls 0 and A, 5 s side by side; P, 5 s more; then 15 s), inside the 30 s the runtime gives
`waitUntil` after the response. The card says "Still working on the counterparties. Retry in a few seconds." (tile 4 "—" over "Still working on it"), and a
Retry a few seconds later finds the answer in the subrequest cache, or joins the call that is still running.

**In-flight sharing and the hold.** A degraded answer is never stored and never shared by the page's single flight, so without more every visitor's render of a
popular heavy account would start its own 10 s call. With `shareInFlight` (`createSubrequestCache().json`, `loadsInFlight` in `edge-cache.ts`), while one
request's load of a key runs, a load of the same key by another request in the same Worker instance waits for it and is given the same answer or the same error,
without a fetch of its own; a waiter still races its own page's deadline. A flight is in memory and per instance, by build ID and key; it holds the answer's JSON
text (plain data, which a Worker may hand from one request to another, as the page flights do), is removed when it settles, and is not joined once it is 30 s old
(`SHARED_LOAD_MAX_AGE_MS`). With `holdFailure` (E2's, "The cache classes") a `server`, `timeout`, `network` or `rate_limited` failure is held for 5 s (a 429 for
its `Retry-After`, at most 30 s), so a failing route is called once per 5 s per instance and not once per render: a Retry within the hold is given the held
failure, and the first after it calls again. A call looks at the Cache API, then at a held failure, then at the flight of its key, and only then calls.

**Failures.** Each part stands on its own. A failed or late one is logged (`logProblem`) and marks the request degraded (`markDegraded(context, "analytics {card} …")`):
the page is served with `Cache-Control: no-store` and is not stored, and a Retry reaches a fresh render.

| Case | What the view shows |
|---|---|
| call 0 failed, or, for All, P | one `SectionError` in place of the tiles and cards, "Couldn’t load the analytics." with a Retry; the period note is left out |
| the frame is late | in the same place, "Still working on the analytics. Retry in a few seconds."; the calls go on in the background |
| a call failed: a 5xx, a 429, a timeout, a network error, a 400, a 404, a malformed 200 | its tiles "—" over "Couldn’t load"; its cards, in place of the views and the toggle, "Couldn’t load {what}." (the account value, the transactions sent, the balance changes, the counterparties, the balance history, the DEX trading) with a Retry |
| a call is late | its tiles "—" over "Still working on it"; its cards "Still working on {what}. Retry in a few seconds." with a Retry |
| the node did not answer | the header says "Live state unavailable" (and, without `balances`, "The balance could not be read."), and the analytics are as usual |
| never activated, or the index failing on the account | the 404 or the 503 of the other tabs, before any card is drawn |

An analytics route that answers "Cannot GET …" (an API without D2) is an outage by E2's route-missing rule, held and never stored, so it fails its card; D2 answers
an unknown address with empty answers, so a `not_found` from these routes fails its card too. `analytics-shape.ts` checks each answer inside its cached load: lists
are lists; dates are on a start of the interval asked for (a Monday, the first of a month), so an API that ignores `interval` and answers days fails; the echoed
`interval` is the one asked for; amounts and values are numbers as text (`isNumberText`: a decimal, or the exponent form bignumber.js's `toString()` writes below
1e-6 and from 1e21) and counts whole numbers; an account is a classic address; a currency is 3 characters or
40 hex digits; `stats/{family}` has no `marker`. So a wrong 200 is kind `server` and is not kept. Retry is `useRetry()` (`app/ui/use-retry.ts`), the route's own
`.data` URL again: the calls that loaded are warm for 60 s, and only the failed or late one is asked again.

**SEO.** The views are `noindex, follow`, with no canonical link and no `og:*` or `twitter:*` tags (`accountMeta` in `app/server/meta-account.ts`). The title is
"Analytics · Account rBbW6i…W5jh · XRPL · explorer", with ", last 90 days", ", last 52 weeks" or ", all time" after "Analytics" for the other periods
(`ANALYTICS_META`); the description names the cards and has no figures. Crawlers are kept off the views twice, as off the payments CSV: the tab's link and every
period link are `rel="nofollow"`, and `robots.txt` has `Disallow: /*/account/*tab=analytics`, which matches either order of the query. The reason is cost: a bot
waits for the whole document, so a crawl of a view is six aggregate reads of an account nobody else is looking at. An address's search result is its account page,
which stays indexable.

**JavaScript.** `AnalyticsFilters.tsx`, the tab's link and its `onIntent` load with the account page, on every tab. `onIntent` is one `import()` of the view's
chunk on the tab's `pointerenter` and `focus`, not React Router's `prefetch="intent"`, which would also fetch the view's data (a render and six calls per hover).
`AccountAnalytics.tsx` and the kit load with `React.lazy`, as a chunk of their own. On the server the lazy module resolves during the render, so the stored HTML
has every tile, mark and table, and the Chart/Table radios work by CSS before any script runs; in the browser, hydration leaves the server's HTML in place until
the chunk is there, and a client-side navigation to the tab shows a waiting frame (`aria-hidden`) until the chunk and the data arrive. The two gates of
`pnpm check:bundle` (spec 5): the account route's first load is at most 150,000 bytes, a lookup page's budget (138,035 at the end of E4; the spec's target is 138,500),
and the view's total, that first load with the chunk and its static imports, each file once, at most 160,000, a dashboard's (ruling R19; it was 150,000 until then:
the row `account analytics` was 149,933 at the end of E4, 67 bytes under). The view has its own
copy of the kit to fit: "The client bundle check" has the figures, the copy and its cost (about 8.5 KB more for a visitor who saw the network page first).
`test/unit/analytics-bundle.test.ts` pins that the view imports nothing from `app/server` at run time and that `AccountPage.tsx` imports it only through `import()`.

**Fixtures.** The answers are synthetic (`scripts/analytics-fixtures.ts`, seeded per network, account and endpoint): the six calls of the four periods for the
active, the deleted and the never-funded account of each network, anchored to the hand-written header files so that the view and the header agree ("Upstream
fixtures", "The accounts' analytics"). Only a run against a real stack checks them against real answers.

**Tests.** `app/domain/analytics-params.test.ts` (the canonical form of every query, the phrases), `app/server/analytics-view.test.ts` (the frame of each period
and every builder, in exact arithmetic), `analytics-shape.test.ts`, `analytics-load.test.ts` (the order of the calls, the deadline, the background completion, the
abandoned page), `test/unit/analytics-fixtures.test.ts` and `analytics-bundle.test.ts`; `AccountAnalytics.test.tsx` and `AnalyticsFilters.test.tsx` (each state of
each part, the server HTML and its hydration); in the Worker, `test/worker/account-analytics.spec.ts` (failures first, the redirects, the exact calls of each view,
the classes, the stream, the deadline and the background completion), `account-analytics-flight.spec.ts` (the in-flight sharing and the hold, in an isolate of
its own) and, with every switch off, `account-analytics-off.spec.ts`; in the browser, `account-analytics.spec.ts`, `account-analytics-live.spec.ts`,
`analytics-kit-copy.spec.ts`, `client-meta.spec.ts` and `a11y.spec.ts` ("End-to-end tests").

## The network page

`/{net}/network` is the dashboard of a network, made from the data API alone (the node is not called). The route is `app/routes/net.network.tsx`, the page
`app/ui/pages/NetworkPage.tsx`, the view builder `app/server/network-view.ts` (pure: it makes `NetworkPageData` from the answers) and the charts are the kit
("The chart kit"). The header's Network item leads to it (`handle = { navSection: "network" }`: `.is-current`, and `aria-current="page"` here, `"true"` on a
later page of the section). From the top: the heading with its live row, the six newest ledgers as chips beside the open ledger, the filters, six tiles, then the cards:
transactions by type, the average fee, volume (payments, DEX and AMM), payments by currency, and the validators.

**Views.** The URL names the view, with two parameters.

| Parameter | Values | Default | |
|---|---|---|---|
| `period` | `7d`, `30d`, `90d`, `1y` | `30d` | days, except `1y`, which is 52 weeks from Monday |
| `in` | `usd` | the native currency | XRPL only: USD issued by GateHub (`rhub8V…`), one of the API's tracked markets. Xahau has no USD market and no "Amounts in" |

A query string that is not the canonical form of its view (`period`, then `in`; defaults, unknown values, repeats and other parameters dropped) is a 302 to it,
class `short`, before any call: a made-up query string would otherwise be a stored page and a set of upstream calls. The default view has a canonical link and
`og:*`; every other view is `noindex, follow` with neither. The selectors are links (`SegmentedLinks`), so they work without JavaScript, and a click is a client-side
navigation that keeps the scroll position. `networkHref` and `parseNetworkParams` (`app/domain/network-params.ts`) make and read them.

**The window.** `T` is the UTC day of `last_validated`'s close time (`utcDayOf`), not the clock: the window follows the index. `windowOf(T, period)`
(`app/domain/window.ts`) gives the buckets of the charts and totals (W: `T` and the days before it, or the 52 weeks up to the week of `T`), the full buckets
before `T` that the deltas use (F) and the same number before them (P). The newest bucket is the running one: it is drawn, and its tooltip, slider text and table say
"so far". The volumes count a day only once it has closed an hour, so their running day is *pending*: a gap, "Not computed yet" in the tooltip, and the card's note "Oct 17 is not
computed yet." A delta compares full buckets only and is left out when one is missing: "+3.2%, 30 full days to Oct 16 vs the 30 before".

**Calls.** All of them go to the data API; the loader asks for them side by side and waits for all. Every call asks for the failure hold.

| # | Call | Kept | Feeds | If it fails |
|---|---|---|---|---|
| 1 | `last_validated` | 2 s, the home page's entry | the anchor: `T`, the order of the data | 503 |
| 2 | `network/fees?descending=true&limit=8` | 2 s, the home page's entry | the chips | 503, once everything else has settled |
| 3 | `ledgers/{latest}` | immutable | the hash for #4, only when #1 is ahead of #2's newest | the validators card |
| 4 | `ledgers/{hash}/validations?limit=1000` | 5 s | the validators card | the validators card |
| 5 | `network/fee_stats?descending=true&limit=1&start={T}` | 2 s | the open ledger, the fee note | the open ledger block |
| 6 | `stats/type` | 300 s | transactions by type | that card |
| 7 | `stats/metric` (from the start of P) | 300 s | tiles 1 to 4 | those tiles show "—" |
| 8 | `network/fees?interval=day` | 300 s | the fee chart | that card |
| 9 | `network/payment_volume` (from the start of P) | 300 s | the payment tile, the Payments line, payments by currency | those cards, the tile |
| 10 | `network/exchange_volume` | 300 s | the DEX tile and line | the volume card, the tile |
| 11 | `network/amm_volume`, only with `AMM_DATA` on and on a network with pools | 300 s | the AMM line, the DEX tile's note | the line is left out, and the card says so |

Calls 6 to 11 are class `slow` asked for with `{ ttl: PERIOD_CALL_TTL_SECONDS }` (300 s): their keys change once a day, and 5 minutes bound how late the running bucket
or a day the aggregator finalises late shows. With USD the volumes ask in USD (`exchange_currency`, `exchange_issuer`). The browser never calls the data API.

**Caching.** The page and its `.data` URL are class `live-home` (1 s fresh, 2 s stale: "The cache classes"), so an open tab is at most about 5 s behind. A request that
fails is the stored copy of the page when there is one. A malformed `last_validated` (a ledger or close time that is not a number, from which no window can be made) is a 503 too.

**Failures, card by card.** A page-level failure (#1, #2) is a 503 with `Retry-After`, never stored. Every other call fails its card or tile alone, and the card says so in its
place, with its title, its source line and a Retry (`SectionError`, "Couldn’t load transactions by type"); the rest of the page stands. Such a page is a 200 and is *degraded*:
`Cache-Control: no-store`, not stored (`markDegraded`), and each failure is logged (`logProblem`). A card or the chain of #2, #3 and #4 that has not answered 4.5 s after the loader
began (`CARD_DEADLINE_MS`) has failed with "took too long", so one slow call cannot hold the page. The page data is served to browsers, so a failed part's `reason` is only "took too long" or the fixed "could not be loaded" (the page does not show it); the error itself, with the upstream's path and the API's own words, goes to the log and nowhere else. A failure is also *held*: the call is remembered as failed for 5 s (a 429 for its `Retry-After`),
so that the beats of every open tab do not each ask a failing upstream again ("The cache classes", "The failure hold"). Retry is `revalidate()` on the explorer's own `.data` URL; it
works while the visitor has paused the updates, and a Retry within the hold gets the held failure. The AMM line has four states, which the wording of the DEX tile, the legend and the
volume card's note follow:

| State | When | The card says |
|---|---|---|
| `ok` | `AMM_DATA` on, #11 answered | "DEX trades, tracked markets, AMM swaps included", "AMM swaps, all pools", and that the lines are not parts of one total |
| `failed` | `AMM_DATA` on, #11 failed (a "Cannot GET" 404 too) | the same two lines, "AMM swaps couldn’t be loaded." and Retry |
| `off` | `AMM_DATA` off | "Payments" and "DEX trades, tracked markets": the explorer does not know whether the DEX line holds swaps, and says neither |
| `none` | Xahau | the same, and that Xahau has no AMM |

**Live updates and `keepLoaded`.** The page follows the chain like the home page ("Live updates"): `useLiveControls`, the 4 s beat, the backoff, the pause. What it brings of its
own is in the route: `createLiveOnScreen` with `order: (d) => d.anchor.lastValidated` and `merge: keepLoaded(next, shown, NETWORK_PARTS)`. `NETWORK_PARTS` is the page's parts, one for each call or
chain: `openLedger`, `validators`, `types`, `metrics`, `fees`, `payments`, `exchanges` and `amm`. A beat whose answer has a part `failed` that the page shows loaded keeps the part it shows, so a
failing beat, or a day that has turned and has no answers yet, does not put an error in place of a card every 4 s; the window's words come from the anchor and move on. A part that has never loaded
shows its error. The scope of the page on screen is the network and the canonical search of its view, so a refresh of another view never stands in for it, and the page is keyed by it (`<NetworkPage key={scope}>`):
another period, currency or network is a navigation and a first render, which is not animated, and a chart that changes after it is mounted gets the ring of a changed figure.

**Switches.** `AMM_DATA` gates #11 and the AMM wording. `VALIDATORS` gates the card's "All validators" link (`/{net}/validators?scope=all`): while it is off, the link is the header's "soon" style.
It gates the five "First seen" keys too: each is a link to `/{net}/validators/{key}` while it is on, and text while it is off (`first[].href`, a path or `null`).
The view builder puts the links in the card's data, so the stored HTML and the data agree. Both are in "Switches".

**Tests.** `app/server/network-view.test.ts` (the view builder, in exact arithmetic), `app/domain/window.test.ts`, `network-params.test.ts` and `type-groups.test.ts`;
`NetworkPage.test.tsx` and `routes-wiring.test.tsx` (the cards, the chips, the hold, the scope per view, `keepLoaded`); in the Worker, `test/worker/network-page.spec.ts` (failures first, then the class,
the redirects, the page without JavaScript), `network-calls.spec.ts` (the exact calls of each view), `network-hold.spec.ts` and, with every switch off, `network-off.spec.ts`; in the browser,
`network-page.spec.ts`, `network-live.spec.ts` and `a11y.spec.ts` ("End-to-end tests"). The synthetic aggregates the Worker and the browser read are in "Upstream fixtures".

## The markets pages

Two pages of E3, behind the switch `MARKETS` ("Switches"): `/{net}/markets`, the trade statistics of every pair of the network's DEX over a period, and
`/{net}/markets/{base}/{counter}`, one market, which follows the chain. The routes are `app/routes/net.markets.tsx` and `app/routes/net.markets.$base.$counter.tsx`,
the pages `app/ui/pages/MarketsPage.tsx`, `MarketPairPage.tsx` and `MarketPairSide.tsx` (the book, the pool and the traders), the view builders
`app/server/markets-view.ts` (`marketsPage`) and `app/server/pair-view.ts` (`pairPage`, `olderPage` and one function a part: `bookOf`, `tradesOf`, `candlesOf`,
`statsOf`, `poolOf`, `tradersOf`, `existenceOf`), and the tags `app/server/meta-markets.ts` and `meta-pair.ts`. The view builders are pure and compute with
`bignumber.js` (80 decimal places); the pages never fetch and never format: every price, label and href is text in their data, and `app/server`,
`domain/asset.ts`, `domain/market-pair.ts` and `ripple-*` stay out of their browser files (`test/unit/markets-bundle.test.ts`). Prices are `formatPrice` (8
significant digits, half up, grouped, never in exponent form); a minus is U+2212. The header's Markets item leads to the markets page (`handle = { navSection: "markets" }`:
`aria-current="page"` there, `"true"` on a pair page).

**The markets page.** The heading and its intro, the filters (Period, Quote, Trades, and a text field), the period's window, four tiles (DEX volume, trades,
pairs shown, the AMM share of the volume), and the Pairs table: the pair (a link to its page, the issuers under it), the last price, the change, the low and the
high, the volume in the native currency, the trades, the AMM share and a sparkline of 7 days. The HTML holds the first 100 rows (`FIRST_ROWS`) of the call's
1,000 at most; what only a script can do is drawn after hydration (`useHydrated`, `app/ui/use-hydrated.ts`), since no control may do nothing without
JavaScript: "Show all N", which shows the rest of the rows the page already has; the text filter, which matches a substring of each row's search text (its codes,
raw and shown, and its issuers in full) and leaves the tiles alone; and the sort buttons (last price, change, volume, trades: largest first, a second press
reverses), which order the rows by the ranks the view builder wrote, so the browser compares no decimal (equal values share a rank, and keep the API's
order in both directions). The Trades filter is offered once the window's AMM data is complete (`totals.amm_share`), and always on a view it filters, so
that a bookmarked `?trades=amm` is named and can be left. The count line under the table, the page's one
`role="status"`, says what is shown: "Showing 2 of 40 pairs, by volume, largest first". The page does not refresh itself (no `clientLoader`, no pause control):
a table of hundreds of rows that moves while it is sorted and filtered is worse than one that says how old it is.

| Parameter | Values | Default | The call |
|---|---|---|---|
| `period` | `24h`, `7d`, `30d` | `24h` | `period=day`, `7day`, `30day` |
| `quote` | XRPL `xrp`, `usd`, `eur`, `btc`; Xahau `xah`, `usd` | all | none: the view builder keeps the rows with that code on a side, turned to have it as the counter |
| `trades` | `book`, `amm` | all | `amm=exclude`, `only`; XRPL only, while `AMM_DATA` is on |

**The pair page.** The breadcrumb and the live row; the summary (the pair, "Show RLUSD/XRP" to the other way round, the issuers, each a link to its
account, the last price and the change of 24 h, and the six figures of the 24 hours); the Trades filter; the price card (candles over their volume, the
interval, the legend, Chart and Table); then the 20 newest trades (`DataTable live`, with Newer and Older) beside the order book, the pair's AMM pool and the
five most active traders of the 24 hours (they wrap under it on a phone). The order book is ten levels a side, the asks above the bids with the best nearest
the middle row (the last price and the spread, "—" when a side is empty or the book is crossed), its price from the offers' full amounts and its size from
their funded ones, one depth scale for both sides; it is an ARIA table over rows of a CSS grid (`role="table"`, `row`, `cell`), each row
`position: relative` with its depth bar first, because WebKit draws a bar of a `<tr>` against the page. A trade's side and a level's side are words.
The traders card leaves out the pair's pool, the other side of every swap, when the node has named it (#8), and says so.

| Parameter | Values | Default | The calls |
|---|---|---|---|
| `interval` | `15m`, `1h`, `4h`, `1d`, `1w` | `1h` | the candles' `interval=15minute`, `1hour`, `4hour`, `1day`, `7day`: 60 buckets ending with the one that holds the newest ledger, which is "so far" |
| `trades` | `book`, `amm` | all | `amm=exclude`, `only` on the trades, the candles and the 24 h figures; XRPL only, while `AMM_DATA` is on |
| `marker`, `back` | the account page's paging (`trailPaging`, `app/domain/paging.ts`) | the first page | `marker`: a page of older trades |

**One URL per view.** A query string that is not exactly the canonical form of its view (defaults, unknown values, repeats and other parameters dropped,
in the order of the tables; `interval` dropped behind a marker, `back` without `marker`, and `trades` where the network has no pools or `AMM_DATA` is off) is a
302 to it, class `short`, before any call (`parseMarketsParams`, `parsePairParams`, `app/domain/market-params.ts`). The selectors are links (`SegmentedLinks`,
hrefs from `marketsHref` and `marketHref`), so they work without JavaScript; with it a click is a client-side navigation that keeps the scroll position.
Indexable are the markets page's default view and a pair's default view in its natural orientation with at least one trade, with a canonical link and `og:*` (and no image:
a card with a price would be wrong within a ledger); every other view, the other way round, a page behind a marker and a pair with offers and no trade is
`noindex, follow` with neither.

**The asset in a URL** (`app/domain/asset.ts`, the one asset form, which E5's pool routes and `?asset=` use as it is). The native currency is its code
(`XRP`, `XAH`); an issued one is `CUR.issuer`: a standard code in upper case (the data API upper-cases codes, so `usd` and `USD` are one market), a text
code as its text (`RLUSD.rMxCKb…`, the currency `524C5553…`; its letters are the currency's bytes, so `rlusd` is another currency), any other 40-hex code
(an LP token's) in upper-case hex. The API is sent `apiAssetText` (`CUR+issuer`, a text code as its hex), the node the currency as the ledger holds it.
`parsePairPath` (`app/server/pair-route.ts`) reads the raw path and answers:

| Path | Answer |
|---|---|
| `+`, `%2B`, a space or `\|` as the separator; a standard code in lower case; the 40 hex of a text or standard code; lower-case hex; an escape a character does not need | 302 to the canonical path, with the canonical query: `immutable` when only the path changed, `short` with the query |
| more than one separator, a code that is none of the forms (or holds `\|`), all-zero hex, the native code with an issuer, another code without one, an issuer that is not a classic address with a good checksum, the same asset on both sides, a `marker` that is none | 404 `short`, "We couldn’t find a market for "…" on XRPL", before any call |
| the other way round (`RLUSD.r…/XRP`) | 200: both orientations are pages; the API inverts a pair asked for in reverse |

**The natural orientation** (`naturalOrientation`, `app/domain/market-pair.ts`). Every display of a pair uses it, the markets table and the pair's heading
and natural URL included; `canonicalPair` (the API's stored order) is for talking to the API only. The counter, the currency the price is in, is the side
that ranks better in `QUOTE_RANK` by its display code: USD, EUR, GBP, JPY, CNY, AUD, CAD, CHF, KRW, then RLUSD, USDC, USDT, then BTC, ETH, then the
native currency; a ranked side beats an unranked one. A tie (one code from two issuers, two unranked codes) makes the side whose code, then issuer, sorts
first the base. So XRP/USD, XRP/RLUSD, EUR/USD, LIONS/XRP and EVR/XAH. A row the other way round from the API's is inverted exactly: `1/last`, `1/open`, the
high from `1/low`, the low from `1/high`, the change from the API's own strings, the volumes swapped, the sparkline's closes inverted with their gaps.

**The markets page's call.** One, and the page is made of it:

| # | Call | Kept | If it fails |
|---|---|---|---|
| 1 | `/v2/network/markets?period={p}&limit=1000[&amm=exclude\|only]` (`networkMarkets`, still in `PENDING_PATHS`) | 60 s, class `minute` | 503 (`upstreamOutage`), not stored; an API without the route ("Cannot GET") is one too |

The page and its `.data` URL are class `minute` (60 s fresh, 30 s stale: the data API rewrites the 24-hour set every minute and the others every five), so
the 24 hours are at most about 3.5 minutes old in the worst case (the set's minute, 60 s kept, 60 s + 30 s at the edge), usually within about two, and the
window's words say how old. The page does not poll, so the call does not ask for the failure hold. A malformed 200 is kind `server` and not stored. The
AMM fields are the exception (D2: absent = not known): a share that is not decimal text from 0 to 1, or a pool that is not a boolean, is dropped from the
answer and reads "—", and an unfiltered answer's `amm` is not read, so a change of their format never takes the table down; a filtered answer must still
echo its filter. `min_trades` is not sent: the API's 10 is what the footnote says.

**The pair page's calls** (`T` is the close time of `last_validated`, `T₁` the start of its minute less 24 hours; `{b}/{c}` the pair as the URL has it;
`[&amm=]` the Trades filter). They are made side by side and all are awaited (`Promise.allSettled`); every one asks for the failure hold, the node's
included; each card's call or chain fails as "took too long" when it has not answered 4.5 s after the loader began (`byDeadline`, `CARD_DEADLINE_MS`),
and the node's own limit is 3 s. Nothing is streamed.

| # | Call | Kept | Feeds | If it fails |
|---|---|---|---|---|
| 1 | `last_validated` | 2 s, the home page's entry | `T` | 503 |
| 2 | `exchanges/{b}/{c}?descending=true&limit=20[&amm=]` | 2 s | the trades, the last price, Older | 503 |
| 3 | `exchanges/{b}/{c}?reduce=true&start={T₁}[&amm=]` | 5 s (`live`) | the six figures, the change | the figures "—" and their `SectionError` |
| 4 | `exchanges/{b}/{c}?interval=…&start={S}&limit=61[&amm=]` | 5 s for 15 m and 1 h; 60 s (`minute`) for 4 h, 1 d and 1 w | the candles | the price card's error |
| 5 | `active_accounts/{b}/{c}` | 60 s (`minute`), the top 10 kept | the traders | the card's error |
| 6, 7 | node `book_offers`, each side (`taker_gets` and `taker_pays` swapped), `limit: 60`, `ledger_index: "validated"` | 2 s | the book; the other way round's too | "Live state unavailable" for the whole book, never half of it |
| 8 | node `amm_info` by the pair (`ammInfoByPair`, `asset` and `asset2` in the natural orientation), XRPL | 5 s | the pool card, the pool account the traders leave out | `not_found`: no card; else "Live state unavailable" |
| 9 | `exchanges/{b}/{c}?reduce=true&start={T₁}&amm=only` (`exclude` under the `amm` filter), XRPL with `AMM_DATA` on | 5 s | the pool's share of the pair's volume | "—", "Couldn’t load" |
| 10 | `exchanges/{b}/{c}?descending=true&limit=1` | 5 s | whether the market exists, only when a filtered #2 and the book are empty | 503 |

**Whether the market exists.** No trade and an empty book is a 404 `short` ("We couldn’t find a market for XRP/USD (USD issued by rhub8V…F3wq) on XRPL"); no
trade and a book that could not be read is a 503, not stored: the page cannot tell an empty market from a node that failed. Never a 200 that says the market
is not there. A card that failed is told in its place and logged (`logProblem`), and the page is then degraded: a 200 with `Cache-Control: no-store`, not
stored (`markDegraded`). The page and its `.data` URL are class `live-home` (1 s and 2 s, as the home and network pages); a page behind a marker is one call
(#2 with the marker), awaited whole, class `MARKER_PAGE_CLASS` (`slow`), with the trades alone and a note that links to the market's page, no live row and
no node call; a marker the API refuses, or nothing behind it, is a 404.

**The node calls** (`app/server/node-rpc.ts`). `bookOffers(gets, pays)` asks `book_offers` for the best 60 offers (`BOOK_OFFERS_LIMIT`) of the validated ledger,
the native side `{ currency: "XRP" }` (`"XAH"` on Xahau) and drops converted to whole units at the boundary, `validated` true or absent (Clio's
`book_offers` has none), never `false`; `ammInfoByPair(asset, asset2)`
and `ammInfo(pool)` (E5's) are one reader of `amm_info`: drops to whole units, `vote_slots` and `auth_accounts` defaulted to `[]`, the pool's assets checked
against the pair asked for, `actNotFound` and `actMalformed` read as `not_found`. Both orientations of a pair share the node's answers: the asks of one are the
bids of the other, and the pool is asked for in the natural orientation.

**The switches.** `MARKETS` off: both routes, every view, answer the not-found page "We couldn’t find the markets pages on XRPL" (404 `short`) before any call,
and the header's Markets item is the "soon" label. `AMM_DATA` gates the AMM parts on XRPL: the Trades filter of each page, the Via column, the AMM share tile and column, the
pool card's share (#9) and the intro's words about swaps. Off, they are left out (a `trades` parameter is dropped by the canonical redirect, and #9 is not
made); on, a period whose answer has no `amm_share` yet shows "—". On Xahau there is no pool (`hasAmm`), whatever the switch says, and the API's
`"0.0000"` there is not read. Nothing asks the API whether it has AMM data.

**The live pair page.** It follows the chain as the network page does ("Live updates"): `useLiveControls`, the beat of 4 s, the backoff, the pause, the build
reload. In the route: `createLiveOnScreen` with `order: (d) => d.anchor.lastValidated` and `merge: keepLoaded(next, shown, PAIR_PARTS)`, the `clientLoader`
that hands the page what it shows when a refresh fails, and the page keyed by its scope (`{net}/markets/{base}/{counter}` and the canonical query), so another
interval, filter or orientation is a navigation and a first render, which is not animated. A beat is one request:
`/{net}/markets/{base}/{counter}.data?…&_routes=routes%2Fnet.markets.%24base.%24counter`. `PAIR_PARTS` is `stats` (#3), `candles` (#4), `traders` (#5),
`book` (#6 and #7, one part), `pool` (#8) and `share` (#9): a beat whose answer has one of them failed where the page shows it loaded keeps what it shows (the
book and the pool with the ledger they were read at, so a kept one says its age); a part that never loaded shows its error. The trades and the price are #2's,
without which there is no answer, and the page then keeps itself, saying "Live updates paused, retrying…" after two failures. On a beat a new trade enters
(`is-entering`) and the others slide, the price, the change, the figures, the spread and the ledger numbers tick in (`LiveValue`), and the candles redraw in
place with no ring (`mark={false}`: the forming candle changes with every trade); with `prefers-reduced-motion: reduce` only the colours change. **The hold:**
a pointer over, or keyboard focus in, the trades table or the traders list (the parts with links) holds the page, and the live row says "Paused while you
look at the trades" (or "…at the traders"). **The failure hold:** every call asks for it, so a failing node or API call is remembered for 5 s and not asked
again by every beat of every open tab. A Retry within the hold gets the held failure. The node notices have no `role`: `LiveStatus` is the page's one
`role="status"`, and nothing is announced on a beat.

**Tests.** The unit tests of `asset.ts`, `market-pair.ts`, `market-params.ts`, `paging.ts`, `pair-route.ts`, `markets-view.ts`, `pair-view.ts`, the tags' builders and
`formatPrice`; `MarketsPage.test.tsx`, `MarketPairPage.test.tsx` and `routes-wiring.test.tsx`; in the Worker, `test/worker/markets-page.spec.ts`,
`market-pair.spec.ts`, `market-pair-live.spec.ts` and, with every switch off, `markets-off.spec.ts`; in the browser, `markets.spec.ts`, `market-pair.spec.ts`,
`market-pair-live.spec.ts` and `a11y.spec.ts` ("End-to-end tests"). The fixtures (XRP/RLUSD and LIONS/XRP derived from the recorded ledgers, the recorded books,
the derived pool, Xahau's EVR/XAH and the markets sets seeded around them) are in "Upstream fixtures".

## Validators and amendments

Four pages under `/:net` and two kinds of link-preview image (E6, `docs/superpowers/specs/2026-10-19-validators-amendments-pages-design.md`), made from the data
API's validators and amendments routes (D1) alone: the node is not called.

| Path | Route | Edge class | Indexable |
|---|---|---|---|
| `/{net}/validators` | `routes/net.validators.tsx` | `live` (5 s + 30 s) | the default view only |
| `/{net}/validators/{key}` | `routes/net.validators.$key.tsx` | `live-home` (1 s + 2 s); a page of older validations (`?marker=`) `slow` with a TTL of 300 s | yes; a page of older validations is `noindex, follow` |
| `/{net}/amendments` | `routes/net.amendments.tsx` | `minute` (60 s + 30 s, E3's class) | the default view only |
| `/{net}/amendments/{name}` | `routes/net.amendments.$name.tsx` | `minute` | yes |
| `/og/{net}/validator/{key}.png`, `/og/{net}/amendment/{name}.png` | the image route ("The image route") | `slow` | no |

The four are in the header's Network section (`handle = { navSection: "network" }`: the Network link is `aria-current="true"` on them, `"page"` on the network page
itself), with the breadcrumbs `XRPL / Network / Validators / …` and `XRPL / Network / Amendments / …`. They link to each other ("Amendments →", "Validators →", "All
amendments →", "All validators →"), and the network page links to them: "All validators" to `/{net}/validators?scope=all` (the card counts every validator the collectors
heard) and each of its five "First seen" keys to `/{net}/validators/{key}` (the validations name master keys; a signing key would be redirected to its master). Nothing
else links to them.

**The switch.** `VALIDATORS` ("Switches") gates the four routes, the two kinds of image and every link into them. It is `"on"` at the top level (development and the
tests) and `"off"` in `staging` and `production` until D1 has served that environment on both networks for at least two hours (the votes and tallies are back-filled
by then). Turning it on is a deploy with `"on"` in that environment's `vars`; the cache generation changes, so nothing stored under `"off"` is served. **Rolling back is
`"off"` and a deploy.** While it is off, the four pages and both images are the not-found page, a 404 of class `short`, before the key or the name is read and
before any call (an image's query string is a 302 to the bare path first, as for every image; a page's query is not read), and the network page's "All validators" is the header's "soon" style and its five keys are text (`test/worker/validators-off.spec.ts`, and
`validators.spec.ts` with `VALIDATORS` in `E2E_FEATURES_OFF`).

**The fallback, inside the switch.** In front of a data API without D1, every D1 route answers `404 Cannot GET …`, which the client's route-missing rule makes an
error of kind `server`: an outage, held by the failure hold and **never stored**. A switch turned on too early therefore serves 503 "try again" pages, never a stored
404: the list when S, L and A all fail, a validator when D fails, the amendments list when A fails, an amendment when AD fails, an image when D or AD fails. The pages
come right within seconds of D1's deploy, with no change here. D1's own `Validator not found` and `amendment not found` stay `not_found`: the not-found page (class
`short`, 30 s), with the offer of the other network. While D1 fills (hours for votes, 30 days for agreement) the pages draw what it has: "No vote recorded",
"Unknown", "incomplete", "not checked yet".

**The calls**, each through `clientsFor(context, net)` and the subrequest cache, side by side, all awaited with `Promise.allSettled` before anything is thrown, and on
the pages that poll with `holdFailure: true` (the hold: one failing call per 5 s per key per Worker instance). The six paths are in `PENDING_PATHS` until `pnpm api:sync`
brings D1 in; the types are written from D1's `docs/api-reference.md` at data-api-new `7d495ab`, and every answer's shape is checked inside the cached load. A word a newer
D1 may add (an amendment's status, a domain check's status, the status of a validator's vote, a history event) passes as any text that is not empty, and the pages show it
as their default ("Unknown", "not verified") or leave it out, never a 503 (`validators-new-words.spec.ts`).

| Call | Kept | Pages |
|---|---|---|
| `lastValidated` (the pages' `anchor`) | 2 s (`HOME_CALL_TTL_SECONDS`, the home page's key, so it costs nothing new) | the four (not a page of older validations) |
| S `validatorsSummary()` | 10 s (`VALIDATORS_CALL_TTL_SECONDS`; D1 rebuilds its directory at most every 10 s) | the list, a validator, an amendment |
| L `validators({ scope: "all", limit: 1000 })` | 10 s | the list: always this one query, so one cached call per network serves every view; the scope and filters are applied in the Worker |
| D `validator(key)` | 10 s | a validator (and a page of its older validations), its image |
| VV `validatorValidations(key, { limit: 20 })` | 2 s (`VALIDATIONS_CALL_TTL_SECONDS`); with a marker `slow`, 300 s (`VALIDATIONS_MARKER_TTL_SECONDS`) | a validator |
| A `amendments()` | `minute` (60 s, no constant) | the list ("Votes yes for"), a validator, the amendments list |
| AD `amendment(ref)` | `minute`; it carries A's envelope, so the amendment page needs no A | an amendment, its image |

A card's call (VV, S and A on a validator's page; S, L and A on the list; S on an amendment) is raced against `CARD_DEADLINE_MS` (4.5 s from the loader's start; past
it the card fails with "took too long"); the calls that are the page (`lastValidated`, D, AD, and A on the amendments list) are not. A failed card is told in its place,
logged, and the request degraded: a 200 that is never stored. The worst age of what a page shows (what D1 holds, what the Worker keeps, the edge's fresh and stale
time): the list 55 s, a validator 5 s for its validations and 23 s for the rest, the amendment pages 160 s.

**The beats.** A validator's page asks for its `.data` every `LIVE_REFRESH_MS` (4 s), as the home and network pages do; the list every `VALIDATORS_REFRESH_MS` (10 s);
the amendment pages every `AMENDMENTS_REFRESH_MS` (60 s). After a failure the beat backs off to at most `max(LIVE_REFRESH_MAX_MS, 4 × the beat)`. A page of older
validations does not refresh. Under each `<h1>` is the live row ("Live · updates every ledger", "every 10 s", "every minute") with its pause button; a mouse over a live
table, or keyboard focus on a link or button in it, holds the page ("Paused while you look at the table"). A beat whose answer has a card failed that the page shows loaded
keeps the card (`keepLoaded`: `recent`, `summary` and `amendments` on a validator's page, `summary`, `list` and `amendments` on the list, `summary` on an amendment).
Rows enter and slide (`DataTable live`, keyed by master key, ledger and hash, or amendment ID), figures tick in (`LiveValue`). No age and no countdown is in the stored
HTML: the server prints the absolute time and `RelativeTime` and `Countdown` tick in the browser.

**One URL per view.** Each loader reads its own parameters only. A query that is not exactly the canonical form of the view it names is a 302 to it
(`cacheClassHeaders("short")`); the canonical form drops defaults, empty values, unknown values, repeats (the first is read) and unknown parameters, and orders the rest:

| Page | Parameters, in order | Notes |
|---|---|---|
| the list | `scope` (`unl`, the default, or `all`), `publisher` (an id of S, as S writes it), `amendment` (one in `majority`, `voting` or `unknown`, as A names it), `q` (trimmed, at most 100 characters) | `scope` and `q` are checked before any call; `publisher` and `amendment` once S and A answered, in the same 302. When S or A failed, its parameter is applied as given (the page is degraded, so not stored, and the next render checks again) |
| a validator | `marker` (else the page does not exist: a 404 of class `short`), `back` (dropped without a marker) | as the account page |
| the amendments list | `status`: `majority`, `voting`, `enabled`, `obsolete` or `unknown` (the chips say "Activating", "Voting", "Activated", "Obsolete", "Unknown") | |
| an amendment | none | any query string is a 302 to the bare path |

The key of a validator's URL is its master key in base58. 66 hex digits are a 302 to it, class `immutable` and no call (a pure conversion); a signing key is a 302 to
its master's URL, class `slow` (D says which it is, and the mapping is D1's data); anything else (`summary`, a classic address, a truncated key) is a 404 of class
`short` with no call. An amendment's URL names it as D1 does (`AMM`, `fixNFTokenNegOffer`), or by its upper-case ID when it has no name; another spelling (a case variant,
the ID of a named one, an ID in lower case) is a 302 to it, class `slow`. Only the default views are indexable (a canonical link on the request's origin, `og:*`); every
other view is `noindex, follow`, with no canonical link and no `og:*`. Their tags' builders are `meta-validators.ts`, `meta-validator.ts`, `meta-amendments.ts` and
`meta-amendment.ts` ("SEO and link previews").

**Files.** The routes above; `app/domain/validator-key.ts`, `amendment-ref.ts`, `validators-params.ts` and `amendments-params.ts` (the parsers and the links, pure); the
view builders `app/server/validators-view.ts`, `validator-view.ts`, `amendments-view.ts`, `amendment-view.ts` and what they share, `validator-facts.ts` (pure,
unit-tested); the pages `app/ui/pages/ValidatorsPage.tsx`, `ValidatorPage.tsx`, `AmendmentsPage.tsx` and `AmendmentPage.tsx`, which draw data and never fetch;
`app/ui/components/Countdown.tsx`, `StatusMarks.tsx` (every status an icon and a word, never colour alone) and `status-icons.tsx`.

**Tests.** The view builders' and parsers' unit tests, the pages' component tests, in the Worker `validators-page.spec.ts`, `validators-page-failures.spec.ts`,
`validator-page.spec.ts`, `amendments-page.spec.ts`, `amendment-page.spec.ts` (with the 30-day fixture's document under 150,000 bytes gzipped), `validators-off.spec.ts`, `validators-new-words.spec.ts`,
`og.spec.ts` and `meta.spec.ts`, and in the browser `validators.spec.ts`, `amendments.spec.ts`, `validators-live.spec.ts` and `a11y.spec.ts` ("End-to-end tests"). The
answers they read are generated ("Upstream fixtures", "The validators and amendments pages' files").

## Search

`/{net}/search?q=...` (`routes/net.search.tsx`) is what the search box submits, so it works before JavaScript loads. Its loader says what
the input is with `classify` (`app/domain/search.ts`, the rules of spec 6) and either redirects or answers with a page. Every answer
is class `short` (30 s), redirects included (`cacheClassHeaders("short")`), and the pages are `noindex, follow`. The page data comes
from `app/server/search-view.ts` and `app/ui/pages/SearchPage.tsx` draws it.

| Input | Answer |
|---|---|
| `107695660`, `107,695,660`, `107 695 660` (an index grouped by thousands is what the explorer shows, so it is what visitors copy) | 302 to `/{net}/ledger/{n}`, without asking anyone |
| an address, an X-address | 302 to `/{net}/account/{address}`, with `?tag=` for an X-address that carries one |
| 64 hex digits (with or without `0x`, in either case) | the data API is asked for `/v2/transactions/{h}` and `/v2/ledgers/{h}`, and when it has neither, the node for `tx` and `ledger` (spec 10: history before the backfill, the seconds before ingest). One found: 302 to `/{net}/tx/{HASH}` or `/{net}/ledger/{HASH}`. Both: a 200 page with both links (`SearchChoicePage`). Neither: a 404 that offers "Search on {other network}" (`/{other}/search?q={HASH}`) |
| a CTID | `resolveCtid`: of this network, 302 to `/{net}/tx/{hash}`, or a 404 when the ledger or the index in it is not there; of the other network, a 200 page that offers `/{other}/tx/{ctid}`; a network id that is neither XRPL's (0) nor Xahau's (21337) is a 404 that says so, never taken for one of the two |
| anything else, nothing | a 200 page with the help text (what can be searched for), the box holding what was typed |

An upstream failure that leaves the question open is a 503 through `upstreamFailure` (the node is not asked in place of a data API
that failed), never a "not found" that would be stored. Something found wins over the failure of the other question (a hash is a
transaction or a ledger, practically never both). The pages repeat what was typed cut to 200 characters. A client-side search (the
`.data` URL) redirects the same way, but React Router's answer for a redirect there (a 202) is not stored by the edge, so those
cost a render each.

`NotFoundPage` is the frame of the help, the 404s and the other-network offer: its `title`, `message`, `children` (the help list),
`query` and `suggestion` carry what differs.

## SEO and link previews

Spec 9. Every page's `meta` export is a thin call into its builder, pure functions over the page data and the origin
of the request (unit-tested in `app/server/meta.test.ts`; `meta` is part of the route module, so the browser runs them on a
client-side navigation: those files import nothing heavy, and `test/unit/og-bundle.test.ts` pins it). `app/server/meta.ts` has what every
page's tags are made with (`metaContext`, the absolute URLs, `sharing`); each page's builder is in a module of its own, `meta-<page>.ts`
(`meta-home.ts`, `meta-network.ts`, `meta-markets.ts`, `meta-transaction.ts`, `meta-ledger.ts`, `meta-account.ts`), which that page's route
alone imports. A module every route imports is in a chunk every page loads, so one module of all the builders put each page's builder in
every page's JavaScript (1.1 to 1.6 KB of each figure, growing with each page). A new page's builder goes in a new `meta-<page>.ts`
(`test/unit/meta-bundle.test.ts` holds `meta.ts` to the list of names it may export, in whatever form they are exported, and to no import or
re-export of a `meta-<page>.ts`; it fails a builder module that another page imports, and one that value-imports anything of `app/server` but
`./meta`).

| Page | Tags |
|---|---|
| Home `/{net}` | title, a description that does not change (no ledger number in it), canonical, `og:*`, `twitter:card=summary`; **no image** (the card is of a transaction, a ledger or an account) |
| Transaction | title, description, canonical `/{net}/tx/{HASH}`, `og:title/description/url/type/site_name`, `og:image` + width 1200, height 630, alt, `twitter:card=summary_large_image` + title, description, image, alt |
| Ledger | the same; the canonical URL and the image name the ledger by its index, whichever of index and hash the page was reached by |
| Account (first page of a list) | the same; the canonical URL keeps `?tab=` unless it is the first tab, and drops `tag`, `marker` and `back`; the image is the account's whatever the tab |
| Account with a `marker` | `noindex, follow`, **no canonical** (Google advises against `noindex` with a canonical to another URL), no `og:*` |
| Search, 404s, never activated, CTID offer | unchanged: `noindex, follow` (search) or `noindex`, no canonical, no `og:*` |

- **Description of a transaction**: `Payment of 1,250.00 USD from rJF2Xa…FQvg to rNYbL8…UKq5 · XRPL ledger 107,695,660` for a transaction that
  moved an amount from one account to another (what the destination got, from the flow of `describe`); for any other (it failed, an
  offer, a swap, which is a payment to oneself) the sentence of the page without its full stop, then `· XRPL ledger N`. No ages, nothing of
  the visitor.
- **Origin.** Canonical, `og:url` and `og:image` are absolute on the origin of the request. `meta` has no request, so the `/:net` layout's
  loader returns `origin: new URL(request.url).origin` and each `meta` finds it with `metaContext(params.net, matches)`. No variable names the
  site: the edge cache's key holds the host, so each stored page names its own.

### The image route

`/og/{net}/{tx|ledger|account|validator|amendment}/{id}.png` (`routes/og.$net.$kind.$id[.png].tsx`): 1200 × 630, `image/png`, `X-Robots-Tag: noindex`. The five kinds
are a transaction, a ledger, an account, a validator (`{id}` its master key) and an amendment (`{id}` its name as D1 writes it, or the upper-case ID of one with no name).

| Case | Answer |
|---|---|
| a URL with a query string (`…/x.png?a=1`): the edge cache's key holds the query, so each would be a copy drawn and kept of its own | 302 to the bare path, class `immutable`, before anything else: no call, nothing drawn |
| net, kind or id not valid (a transaction: 64 hex digits; a ledger: 1 to 10 digits or 64 hex; an account: a classic address with a valid checksum; a CTID, an X-address, `latest`, a missing `.png`) | 404, class `short`, **no upstream call** |
| a transaction hash or ledger hash in lower case, a ledger index with leading zeros | 302 to the one URL, class `immutable`, no upstream call |
| a transaction the data API has; a ledger it has that is not the newest | `immutable` (`max-age=31536000, immutable` for the browser) |
| the newest ledger | `short` (30 s): its page is `live`, and its "newest" status changes within seconds (the next ledger closes), which an image kept for a year would keep |
| an account (data API: creation and balances) | `slow` (1 h, `max-age=300`) |
| an account whose balances could not be read | drawn without them, `short`: asked again soon |
| from the node (the API says "not found"; for an account, no creation record) | `short` with a TTL of 60 s, like the page |
| "not found" at both | 404, class `short` |
| an upstream failure that leaves the question open (5xx, 429, timeout, a 400 for an id the route has checked; `last_validated` for a ledger), or a card the renderer cannot draw | 503, never stored; the entry serves the stored copy, however old, if there is one, and otherwise answers with its own 503 page (`Retry-After: 30`, whatever wait the route or the upstream named). A render failure is logged (`a link-preview image could not be drawn`) |
| a validator or an amendment while `VALIDATORS` is off | 404, class `short`, before the id is read and before any call |
| a validator's key in hex (66 digits); a signing key; an amendment named otherwise than D1 names it (a case variant, the ID of a named one, an ID in lower case) | 302 to the master key's or the canonical image: `immutable` for the hex (a pure conversion, no call), `slow` for the others (the mapping is D1's data) |
| a validator (D) or an amendment (AD) the data API has | `slow` (1 h): the UNL, the version, the domain's check and an amendment's standing change rarely. D1's `Validator not found` and `amendment not found` are a 404 of class `short`; a `Cannot GET` (an API without D1) is a 503, not stored |

A HEAD of an image is answered from the stored copy, or draws it once and stores it (see "The Worker entry"). The data comes through the same clients as the page: `describe` (title, result, sentence, flow) and `headlineAmount` for a transaction
(`transactionFacts` in `app/server/card-data.ts`; the balance changes, objects touched and raw JSON the page also works out are not),
`ledgerPage` for a ledger, `activationOf` and the native balance of `/balances` for an account, D (`validatorCard`) for a validator and AD (`amendmentCard`) for an
amendment. `card-data.ts` makes plain data of it
(`CardData`, `app/og/types.ts`), `app/og/card.tsx` lays it out (the `LinkPreview` board: the accent bar, logo and pill of the network, the kind
and result, the big line, the accounts, the footer) and `app/og/render.ts` draws it with `workers-og` (Satori and resvg-wasm).

- **Fonts.** Geist (400, 500, 600) and Geist Mono (400, 500), bundled, never fetched. Satori reads TTF, not the WOFF2 of the pages, and the
  Cloudflare Vite plugin turns an imported `.bin` file into an `ArrayBuffer` (and has no rule for `.ttf`), so `app/og/fonts/` holds the
  `geist` package's TTF files under that extension, with its licence; `test/unit/og-fonts.test.ts` keeps them byte for byte the package's.
  Refresh them with `cp node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf app/og/fonts/Geist-Regular.bin` (and so on) when `geist` is
  updated. The board's weight 650 is drawn as 600. `FONTS` (`app/og/fonts.ts`) is one array that `render.ts` hands to the renderer as it
  is: Satori keeps its parse of the fonts (660 KB of TrueType) under that array's identity, so a copy per image would be parsed again per
  image (`test/worker/og-render.spec.ts`).
- **WebAssembly.** `workers-og` imports its two `.wasm` files itself (`import x from "./resvg.wasm"`), which the Cloudflare Vite plugin
  and the Vitest plugin both turn into compiled modules: no configuration was needed.
- **Size and loading.** `workers-og` and the fonts are imported with `import()` on the first image drawn, so they are separate chunks that
  no other route loads, and `test/unit/og-bundle.test.ts` checks that nothing of the renderer is named outside `app/og/render.ts` and that
  `app/server/meta.ts` (which the browser runs) cannot reach it; `pnpm check:bundle` checks that `build/client` holds none of it.
  Worker upload (`wrangler deploy --dry-run`, 14 modules): 5105 KiB / **1556 KiB gzip** (was 2486 / 548 KiB): the renderer chunk 503 KiB, the
  resvg and yoga wasm 1428 KiB, the fonts 663 KiB. The limit is 10 MB gzip. (The initial JavaScript of the pages is not repeated here: `pnpm check:bundle`
  prints it, and "The client bundle check" has the budget and the figures of the day.)
- **Logs.** `workers-og` writes `init RESVG` to the console on every image, and, after the first, a logged `Already initialized` error
  with its stack (it initialises resvg on each call and catches the second). That is its own code; an image is drawn once per URL and
  kept by the edge.
- **Looking at one.** `pnpm build`, start the fixture server (`startFixtureServer`, see "Upstream fixtures") and `wrangler dev` with the
  four URLs and `DATA_API_KEY` as `--var`s pointing at it, then open `/og/xrpl/tx/AACAFCFEBB5C970049A576CBFE6EF544A47EE3ADBA99122FA43234D18D5FFD40.png`.

## Tests

- `unit` project: `app/**/*.test.ts` (not under `app/ui`), `scripts/**/*.test.ts` and `test/unit/**/*.test.ts`, in Node.
  (`test/unit` is typechecked with `scripts/` by `tsconfig.node.json`, which has the Node types; `tsconfig.cloudflare.json`
  leaves it out. A test that reads files, such as the route scan and the token check, goes there. The same Node config also
  holds the few `app/` and `test/support/` files that `scripts/` and the Node tests import: `upstream-core.ts`, `fixture-server.ts`, `switches.ts`,
  `app/server/api-types.ts`, `app/server/aggregate-shape.ts` (with `tx-shape.ts` and `upstream.ts`, which it imports: the checks the data API client runs on the
  network page's answers, which `test/unit/network-fixtures.test.ts` runs on the fixtures), `app/ui/features.ts` and `app/domain/parse/types.ts`; `fixture-server.ts` is the one file `tsconfig.cloudflare.json` leaves out.
  `test/e2e/stack.ts`, which starts the end-to-end stack, is in that config too; the Playwright config and specs are `tsconfig.e2e.json`'s, with
  the DOM types their `page.evaluate` callbacks need (and `app/ui/features.ts`, which `scripts/e2e-env.ts` imports), and `tsconfig.cloudflare.json` leaves `test/e2e` out. `vitest.config.ts` imports `app/ui/features.ts` with its extension (`allowImportingTsExtensions` in `tsconfig.node.json`),
  because Vite's native config loader, which is to become the default, warns about a config import without one; `vite.config.ts` still prints that notice for `./scripts/build-id`.)
  `scripts/check-bundle.test.ts` runs the bundle check (`scripts/bundle-budget.ts`) over a fake build (each budget to the byte, each forbidden name,
  a `.wasm`, `.ttf` or `.bin` file in `assets/`, a missing file; the analytics view's chunk found by its `import()` in each spelling, its imports
  followed, its total to the byte, its missing files) and the command (`scripts/check-bundle.ts`, which also reads the `shell` chunk in the
  manifest) through a link to it; `scripts/shell-chunks.test.ts` the client build's `shell` chunk (the closure and the modules every page of the
  budget loads, over a made-up module graph, the plugin's wiring, its check of a made-up bundle and of a made-up route manifest); `scripts/analytics-kit-copy.test.ts`
  the analytics view's own copy of the kit (what the kit is, what an import resolves to, the check of a made-up module graph and bundle in each
  way it fails, the plugin's hooks, and the same check on the module graph of the app's sources); `scripts/module-graph.test.ts` what the two
  plugins share (`scripts/module-graph.ts`: a module's id read as a path, and the walk of its static imports). No test reads `build/`: what the build
  holds is `pnpm check:bundle`'s;
  `scripts/e2e-env.test.ts` the switches of the end-to-end suite
  (URLs, the fixture server's port, the browser, the env file read back with wrangler's own loader, which console errors a test lets through, `E2E_FEATURES_OFF`); `test/unit/e2e-stack.test.ts`
  runs `test/e2e/stack.ts` over a stand-in root and a `wrangler` that fails; `test/unit/headers-file.test.ts` `public/_headers`;
  `scripts/predeploy-check.test.ts` the pre-deploy guard over fake build configs (placeholders, non-https URLs, the switches, another environment, workers.dev, the redirect), the
  command through a link, and that the deploy scripts run it between the build and `wrangler deploy` and the environments of `wrangler.jsonc` are not on workers.dev.
  **The commands run every time they are run**, however they were reached (`scripts/api-sync.ts`, `scripts/make-http-fixtures.ts`, `scripts/check-bundle.ts`,
  `scripts/predeploy-check.ts`, `test/e2e/stack.ts`): none decides whether it is "the script" by comparing the URL of its module with `process.argv[1]`, which differ
  through a link and once made a gate print nothing and pass (`pnpm api:check` among them). What a command shares with its tests is in a file of its own
  (`api-sync-core.ts`, `compare` in `http-fixtures.ts`, `bundle-budget.ts`, `predeploy-guard.ts`), and each is tested as a command through a link.
- `components` project: `app/ui/**/*.test.{ts,tsx}` in happy-dom, with Testing Library. Components that link or submit are
  rendered inside a data router (`createMemoryRouter` + `RouterProvider`).
- The live pages, the home page and the network page (see "Live updates"), are tested in the `components` project with fake timers and a real data router, and in `unit`:
  `use-live-refresh.test.tsx` (every 4 s while visible, none while hidden, once on becoming visible, no overlap with a running revalidation or a
  navigation, the backoff 4 to 60 s, paused and held, a rejection of the router's own, cleanup, nothing on the server), `components/LiveMotion.test.tsx`
  (`DataTable live`: no animation on the first render, `is-entering` on new keys and kept through renders for `ENTER_MS`, a FLIP transform and
  transition on the others over a mocked layout, reduced motion, off by default; `LiveValue`: only a changed token animates),
  `pages/HomePage.test.tsx` (new rows, changed and unchanged figures, reduced motion, no live region, and the controls: the pause button, the status
  line's transitions and its notices, the hold on a table by pointer, by a link, by keyboard focus and not by a click's, its release when the page goes, the
  line that says the page waits), `on-screen.test.ts` (what is kept, the failure count, the 10 s limit, refused answers, redirects and
  aborts, the merge of an answer that is taken and only of that), `live-page.test.ts` (a deploy: the reload once for a pair of builds, no reload where nothing can remember it, none while a field has focus or holds text, one when the tab is hidden; an answer with a lower `order` refused and an equal one taken; the merge; `keepLoaded`), `use-hold.test.tsx` (`useHolds`: a hold for each name and way, released when the page unmounts; `holdsFocus`),
  `revalidation.test.tsx` (React Router's own behaviour for a failed revalidation, with and without what keeps the page),
  **`routes-wiring.test.tsx` (the real `net.tsx`, `net._index.tsx` and `net.network.tsx` through a data router: `shouldRevalidate`, the `clientLoader`, the scope per view, the hook, the
  controls, `keepLoaded`; deleting either export fails it)**, and `test/unit/live-motion-css.test.ts` (durations, one run, the wash's contrast on `--bg` and
  `--surface` in both themes on both accents and that a whole percent more would fail, that the marks reach no text, what reduced motion leaves, the
  button's 44 px). The Worker specs pin `live-home` at 1 s + 2 s (`cache-class.test.ts`, `home.spec.ts`, `edge-cache.spec.ts`: fresh, stale at 1 s,
  inline after 3 s), the three calls' class and their `ttl` (`data-api.spec.ts`), single flight (`edge-cache.spec.ts`, "many requests for one page at
  once"), and, on the real Worker (`home-live.spec.ts`, a file of its own: it needs a cache nobody has used), a herd of concurrent requests rendered
  once, what that render stored for how long, the `.data` URL stored as `live-home` for 1 s with the build in it, and a `last_validated` that is ahead of
  the fees.
- The projects do not read `vite.config.ts`, so `vitest.config.ts` gives each the `~/` alias (`app/`) itself;
  `app/domain/alias.test.ts` and `test/worker/alias.spec.ts` fail without it. The code of `app/` imports with relative
  paths.
- The end-to-end suite is not part of `pnpm test`: it needs a browser and a running Worker, and has its own command (`pnpm test:e2e`, see
  "End-to-end tests"). `test/e2e/*.spec.ts` are Playwright's, not Vitest's.
- `worker` project: `test/worker/**/*.spec.ts`, in workerd on the real Worker (`workers/app.ts`, the React Router
  plugin and `wrangler.jsonc`; the vars, secrets, `BUILD_ID` and switches are pinned in `vitest.config.ts`, so a developer's
  `.dev.vars` does not reach the tests; the `VISITOR_LIMITER` binding comes from `wrangler.jsonc`). Call
  the Worker with `exports.default.fetch(...)` and read bindings with `env`, both from `cloudflare:workers`. (`SELF`
  and `cloudflare:test`'s `env` still exist but are deprecated.)
  The `worker-off` project is the same Worker with every switch `"off"`, for the files `test/worker/*-off.spec.ts` (which `worker` leaves out; see "Switches").
  The two share one Vite server, the root config's of `vitest.config.ts`, and so one Workers plugin and one React Router plugin, and each is `provide`d its own
  `workerBindings`, which the Workers plugin reads for its Miniflare (`unit` and `components` have servers of their own: `extends: false`). It is one server on
  purpose: the React Router plugin removes and rewrites `.react-router/types` each time a server starts, and two of them starting together raced on that
  directory (`ENOTEMPTY`, `EINVAL`, so that `pnpm test` sometimes failed to start). Another Worker project is another child with its own `provide`d bindings, never a
  server of its own with the plugin. The root sets `server.deps.inline` itself, because the children read the root's options and `@sentry/cloudflare` cannot load
  in workerd without it.
  `edge-cache.spec.ts` calls `withEdgeCache` and `createSubrequestCache` directly (fake `render`, fake `waitUntil`, a fake clock
  for `Date` only, the runtime's own Cache API; the HEAD rules are there, and in `og.spec.ts` and `ledger.spec.ts` on the real Worker); `route-headers.spec.ts` runs `cached` and `forwardCacheClass` through React
  Router's own request handler on a hand-made server build, for a document and for its `.data` URL; `entry.spec.ts` calls the
  Worker through `exports.default.fetch` (id, log line, the real `VISITOR_LIMITER`, Sentry); `layout.spec.ts` asks the Worker
  for `/`, the 404 pages, `/:net` (the home page now, so against the recorded upstream), the document shell and `robots.txt`. A 404 page is class `short`, so it is stored: a test
  that needs a cache miss asks for a path nobody else does. `upstream.spec.ts` tests the upstream mock (see "Upstream fixtures"). `network-hold.spec.ts` is the failure hold on the real Worker ("The cache classes"): a file of its own, with `Date` faked and moved 31 s on after each test. `home.spec.ts`, `ledger.spec.ts`, `search.spec.ts` and `transaction.spec.ts` ask for the pages
  through `pageClient` (`test/support/pages.ts`: the page, the HTML as text, anchors, table rows, the class and TTL the entry stored a
  page under); `resolve.spec.ts` calls `resolveCtid` and `findHash` with a data API client and a node client of its own. `account.spec.ts` covers the account page (failures first, one made-up account per override, from `account(n)`), `account-csv.spec.ts` its CSV; `app/server/account-view.test.ts` and `qr.test.ts` the view builder and the QR encoder (checked against `qrencode` 4.1.1's output and by Apple's Vision decoder when it was written), `test/unit/account-bundle.test.ts` and `account-css.test.ts` what the page may import and what its stylesheet must keep. `transaction.spec.ts` covers the transaction page and its redirects, 404s, node fallback and 503s (failures first, one transaction per override); `app/server/transaction-view.test.ts` the view builder over recorded transactions; `test/unit/transaction-bundle.test.ts` and `transaction-css.test.ts` what the page may import and what its stylesheet must keep. The
  `meta.spec.ts` checks the tags of every page against values worked out from the recorded transactions, ledgers and accounts (title, description,
  canonical, Open Graph, Twitter, `noindex`, the origin of the request); `og.spec.ts` the image route (validation without a call, the redirects, the
  classes and TTLs stored, the node fallback, the 503s that are not stored, a query string, a card that cannot be drawn) and `og-render.spec.ts` the
  renderer's seam with `workers-og` (the one array of fonts, a failing draw), with `test/support/png.ts`, a small PNG decoder, to read the size and
  the colour of the pixels drawn; `app/server/meta.test.ts`, `card-data.test.ts` and `app/og/card.test.ts` the tag builders, the words of the card
  and its layout (every element Satori would reject is checked for), and `test/unit/og-fonts.test.ts` and `og-bundle.test.ts` the bundled fonts and
  where the renderer may be imported. The
  hashes of a recorded ledger come from `test/support/ledger-hashes.ts`, read from the fixture files and not through a client. What a spec file's Worker puts in the Cache API stays there for the rest of the file, edge pages and subrequests
  alike (and an error is never stored): a test that overrides an upstream answer asks for a URL, a ledger or a network no other test
  of the file asks for, and a test that needs a failing `last_validated` goes first.
- Recorded mainnet ledgers (XRPL, XRPL AMM cases, Xahau), copied from `data-api-new` and kept as `.json.gz`, are in
  `test/fixtures/ledgers/`; `test/fixtures/PROVENANCE.md` says where each directory came from. Tests read them with
  `loadTx(set, hash)` and `allTxs(set)` from `test/support/ledgers.ts` (Node `fs`, test-only; `tsconfig.cloudflare.json`
  has no `node` types on purpose, so `test/support/node-modules.d.ts` declares the two modules that file uses).
- Recorded transaction metadata for the runtime check is in `test/fixtures/runtime/`: the AMMDeposit
  `83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B` of ledger 107671558, from
  `data-api-new/packages/shared/test/fixtures/xrpl/recorded/107671558.json.gz`.

`@cloudflare/vitest-plugin` is the renamed `@cloudflare/vitest-pool-workers` (that package is deprecated and its
last release, 0.23.0, only accepts Vitest 4). The API and configuration are the same.

## Upstream fixtures

Loader tests and the end-to-end suite never reach the network: they run against recorded answers of the data API and of the
nodes, `test/fixtures/http/<net>/` for `xrpl` and `xahau`. The answers are the recorded mainnet ledgers (`test/fixtures/ledgers/`)
shaped as the servers shape them (`scripts/http-fixtures.ts`: the data API's from its reference and `app/server/api-types.ts`,
rippled's from API v1), plus the network page's aggregates, fee snapshots and validations, which the recordings cannot give and a seeded
generator makes up (`scripts/network-fixtures.ts`), plus the accounts, which are written by hand, plus the accounts' Analytics tab answers, which a seeded generator makes up
around them (`scripts/analytics-fixtures.ts`), plus the order books of the markets pages, which are recorded from the
public nodes (`scripts/record-node-fixtures.ts`), plus the markets pages' data API answers and the pools' `amm_info` answers (`scripts/market-fixtures.ts`,
`scripts/amm-info-fixtures.ts`): XRPL's pairs worked out from the recorded trades (`scripts/derived-trades.ts`), Xahau's pair and the markets tables seeded around them.

| Path below `<net>/` | Holds | By |
|---|---|---|
| `data-api/last_validated.json` | the newest recorded ledger (XRPL 107721455, Xahau 26596843) | generator (derived) |
| `data-api/ledgers/<index>.json`, `...@transactions=true.json` | every recorded ledger, plain and with its hashes in ledger order | generator (derived) |
| `data-api/ledgers/<index>@expand=true&transactions=true.json` | in full: XRPL 107720688 (two accounts created) and 107721455; Xahau 26540187, 26540188 (the only consecutive ledgers of the recordings, for previous and next), 26596843 | generator (derived) |
| `data-api/transactions/<HASH>.json` | one per type the recordings looked for (the manifests' `found` and `cases`: XRPL 29, Xahau 7), the 8 newest, and every transaction an account list names | generator (derived) |
| `data-api/transactions/<HASH>@binary=true.json` | the same transactions with `tx` and `meta` as the hex of their serialization (`?binary=true`); every blob re-hashes to its transaction hash (`scripts/http-fixtures.test.ts`). Made with `ripple-binary-codec` (a devDependency of the generator and its tests, never imported by `app/` or `workers/`); Xahau with its recorded `server_definitions.json` (`test/fixtures/definitions/xahau/`, see `test/fixtures/PROVENANCE.md`) | generator (derived) |
| `data-api/transactions@descending=true&limit=8.json`, `data-api/network/fees@descending=true&limit=8.json` | the home page's lists | generator (derived) |
| `node/tx/<HASH>.json`, `node/ledger/<index>[@...].json` | the same transactions and the expanded ledgers, as the node answers (Ripple-epoch times) | generator (derived) |
| `ledger-hashes.json` | ledger hash to index, so that a ledger is stored once and found by either | generator (derived) |
| `data-api/accounts/<address>.json` and `/balances`, `/orders`, `/transactions@...`, `/payments@...`, `/exchanges@...` | an account's creation, live state and lists (see below) | by hand |
| `data-api/accounts/<address>/stats/value@...`, `.../stats/transactions@...` (`interval=<u>&limit=1000&start=<S>`) | the Analytics tab's account value and transactions sent, for the four periods (days; weeks for `1y`; months for All, from the month of the `inception`), of the active, the deleted and the never-funded account (empty) of each network | generator (synthetic) |
| `data-api/accounts/<address>/analytics/balance_changes@...`, `/balances@...`, `/counterparties@...`, `/exchanges@...` | the Analytics tab's other four calls for the same views: one history per account, anchored to the files above (the active account's balances end at its `account_info` and `balances.json`; the deleted one's is 0 from its deletion on 2026-10-15) | generator (synthetic) |
| `data-api/ledgers/<HASH>/validations@limit=1000.json` | the validations of the two newest recorded ledgers (the end-to-end suite moves the chain back by one): 35 validators on XRPL, 25 on Xahau, node public keys encoded from seeded bytes, the first seen 0 to 400 ms after the close | generator (synthetic) |
| `data-api/network/fee_stats@descending=true&limit=1&start=2026-10-17.json` | one fee snapshot, 2 s before the close of the newest ledger (XRPL: open ledger fee 10 drops, queue 0, 84 of 96 expected) | generator (synthetic) |
| `data-api/stats/type@...`, `data-api/stats/metric@...` | transactions by type, and `accounts_created`, `ledger_count` and `transaction_count`, for the page's four periods (days; weeks for `1y`). A zero count is left out; `transaction_count` is the sum of the type columns; the running day is the day so far | generator (synthetic) |
| `data-api/network/fees@end=2026-10-17&interval=day&...` | the daily fees of each window, the running day included | generator (synthetic) |
| `data-api/network/payment_volume@...`, `exchange_volume@...`, and on XRPL `amm_volume@...` | the volumes of the four periods, and on XRPL in USD too (`exchange_currency=USD&exchange_issuer=rhub8...`); the day files end on 2026-10-16 and a running week has the days so far | generator (synthetic) |
| `node/account_info/<address>.json`, `node/account_objects/<address>.json`, `node/server_state.json` | the node's view of the active accounts and the reserves | by hand |
| `data-api/exchanges/<base>/<counter>@...`, `data-api/active_accounts/<base>/<counter>.json` on XRPL: both orientations of XRP/RLUSD (`exchanges/XRP/524C…+rMx…`, `exchanges/524C…+rMx…/XRP`) and of LIONS/XRP (`exchanges/4C494F4E53…+rGHtf1…/XRP` and its inverse) | the pair page's data API calls of spec 3.3 for the default view: the trades, 20 to a page newest first, with the marker pages (`descending=true&limit=20[&marker=…]`); the candles of the five intervals (`interval=<api>&limit=61&start=<S>`, S from `candleWindow`); the 24-hour row (`reduce=true&start=2026-10-16T17:01:00Z`) and #9's `amm=only` one; the active accounts of the day before T. For XRP/RLUSD in the natural orientation also the lists, candles and 24-hour rows of `amm=exclude` and `amm=only`, and the one-row probe (`descending=true&limit=1`). Made of the trades `scripts/derived-trades.ts` works out from the recorded ledgers (XRP/RLUSD: 37, 4 of them swaps against the pool; LIONS/XRP: 3), inverted for the other orientation | generator (derived) |
| `data-api/exchanges/EVR+rEvernodee8dJLaFsujS6q1EiXvZYmHXr8/XAH@...`, `data-api/active_accounts/EVR+r…/XAH.json` on Xahau | the same calls for EVR/XAH, without `amm`: 167 seeded trades from the first week of the weekly candles to T, one of them dust (an XAH leg of 0.0004: listed, in no aggregate) | generator (synthetic) |
| `data-api/network/markets@[amm=exclude\|only&]limit=1000&period=<day\|7day\|30day>.json` | the markets table (9 files on XRPL, 3 on Xahau): seeded pairs (about 40, 80 and 150 listed on XRPL, among them `usd`, EUR/USD, USD/USD of two issuers and a pair without a native volume), and the derived pairs on XRPL (XRP/RLUSD is listed in the 7-day and 30-day sets of all trades and of the order book's) and EVR/XAH on Xahau, by the reference's rules at the pinned D2 commit; the AMM fields on XRPL, `"0.0000"` and `false` on Xahau | generator (synthetic) |
| `node/amm_info/rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3.json`, `node/amm_info/XRP_524C…+rMx….json` | the XRP/RLUSD pool's `amm_info`, by its account and by its pair: the state its newest recorded transaction left, at the newest recorded ledger (`scripts/amm-info-fixtures.ts`) | generator (derived) |
| `node/book_offers/<gets>_<pays>@limit=60.json` | the order books of the markets pages, the whole answer the node gave to `book_offers` with `ledger_index: "validated"` and `limit: 60` (the best 60 offers): both orientations of XRP and RLUSD and of XRP and LIONS on XRPL, of EVR and XAH on Xahau, each read at one validated ledger (`test/fixtures/PROVENANCE.md`, "Recorded node answers": the nodes, the time, each file's `ledger_index`). Kept as the node served them: the XRPL node (Clio) leaves `validated` out and adds `warnings`, as it does live | recorder |
| `data-api/network/validators/summary.json`, `data-api/network/validators@limit=1000&scope=all.json` | D1's validators summary and list: 35 trusted and 25 other validators on XRPL, 31 and 10 on Xahau, the validators of the ledger validations above first (every key the network page shows has a page), then seeded ones; domains `*.example`; every case the validators pages draw (verified with and without accounts, each `unverified` reason, `pending`, no domain; on two lists, one, none; never seen; negative UNL; no vote record, higher and lower fee votes; old, candidate, missing and unrecognised versions, Xahau builds) | generator (synthetic) |
| `data-api/network/validators/<KEY>.json`, `.../<KEY>/validations@limit=20.json` | each validator's answer and its 20 newest validations (none for the member never seen); one signing key's file holds its master's answer, and one validator has a second page of validations (`...@limit=20&marker=<M>.json`: a gap, a fork and a partial validation) | generator (synthetic) |
| `data-api/network/amendments.json`, `data-api/network/amendments/<NAME>.json` and `<ID>.json` | D1's amendments and each one's answer by name and, a byte copy, by ID (real names, IDs SHA-512Half of them): XRPL `MPTokensV1` (majority, 30 days of rounds, got/lost/got), three voting, an unknown ID, `DID` and `AMM` enabled by the ledger, `fix1201` by the metadata, one obsolete; Xahau `Remit` (majority without its transaction, G5), `URIToken`, `Import`, `Hooks`, `XahauGenesis` (retired) | generator (synthetic) |

The "By" column says how a file came to be. **generator (derived)**: worked out from the recordings by `scripts/http-fixtures.ts` (and, for the markets pages' XRPL pairs and
the pools, by `scripts/derived-trades.ts`, `scripts/market-fixtures.ts` (with the rules of `scripts/market-aggregates.ts`) and `scripts/amm-info-fixtures.ts`, which it calls). **generator (synthetic)**: made up by the
seeded generators `scripts/network-fixtures.ts`, `scripts/market-fixtures.ts`, `scripts/analytics-fixtures.ts` and `scripts/validators-fixtures.ts`. **by hand**: written by hand and left alone by `pnpm fixtures:sync`. **recorder**: an answer recorded from a public node by
`scripts/record-node-fixtures.ts` (`pnpm exec tsx scripts/record-node-fixtures.ts`, which needs network access and only reads), never edited by hand, and left alone by
`pnpm fixtures:sync` too (`isHandWritten`). The recorded ledgers under `test/fixtures/ledgers/` are of the same kind, but they are not files of this table.
A re-recording changes the files and the table of `test/fixtures/PROVENANCE.md` together, and `test/unit/market-fixtures.test.ts` fails when they part ways.

A file is named by its request: the path after `/v2/`, then `@` and the query with its parameters sorted (`transactions=true&expand=true`
is `expand=true&transactions=true`); a node file by method, subject (the transaction, ledger or account asked for; for `book_offers`
`<taker_gets>_<taker_pays>`, for `amm_info` the pool account, or `<asset>_<asset2>` when it is asked by pair, each asset the native
code or `CUR+issuer` with the currency as the ledger holds it) and the other parameters, the default `ledger_index=validated` left out
(`node/book_offers/XRP_524C…+rMx…@limit=60.json`). Data API files hold the response body, node files the whole JSON-RPC
answer (`{ "result": ... }`). Keys are sorted and a transaction is one line, so a change shows as a one-line diff; in the synthetic files a row is one line too (a stats
row, a day's fees, a volume row with its components, a validation: `fixtureText`'s `rowLists`, `SYNTHETIC_ROW_LISTS`), `test/unit/network-fixtures.test.ts` counts the lines. Anything
without a file is answered as the real server answers a thing that does not exist: the API's `404 { "result": "error",
"message": ... }` (`ledger not found`, `transaction not found`, `Account not found`, `account not found`, and D1's `Validator not found` for a validator or
its validations and `amendment not found`) and the
node's `txnNotFound`, `lgrNotFound`, `actNotFound` at HTTP 200 (`actNotFound` for an `amm_info` too; a `book_offers` has no such code, and gets an
empty validated book at the newest ledger recorded in the network's `data-api/last_validated.json`). A path that has no file and no such not-found answer is the API's `Cannot GET ...`
404 (`dataApiAbsent` in `upstream-core.ts`: the catch-all, and what a `null` override means), which the client makes an **outage** (kind `server`, "The data API and the
node"). So a test that relies on a path being `not_found` needs the not-found body of that path's API in `dataApiAbsent`, as ledgers, transactions and accounts have; it never
weakens the rule. A data API request without `X-API-Key` is a 401. The key is
never in a fixture.

**The synthetic aggregates.** Aggregates over months, the syncer's fee snapshots and the validations stream cannot be worked out from a few recorded
ledgers, so `scripts/network-fixtures.ts` makes them up: `networkFixtures(net, last, newest)` gives each answer as a path, a query and a body, and `generate()` writes
them as it writes the rest. The numbers are drawn from `mulberry32(seedOf(net, endpoint))` (`scripts/synthetic.ts`, which the generators of the later pages reuse),
one stream for each network and endpoint, from the first day any window needs to the running one, so a day is the same in every file that has it, a week is the sum of
its days, and a second run writes the same bytes. The shapes follow the data API's reference (`test/fixtures/PROVENANCE.md`, "Synthetic aggregates", names the commits);
the volume components are the network's markets config, copied into the generator with its source. Nothing in them is real: only a run of the end-to-end suite against a
real stack (`E2E_DATA_API_URL`) checks them against real answers.

A file is found by the request the page's loader makes, whatever the order of its parameters, and the files are named by those requests (`dataApiFile`): for each of the
four periods, `T` the index day, `W₀` the first bucket of the window, `P₀` the first bucket of the window the deltas compare against (spec 1.5), and `u` `day` (`week` for `1y`):
`stats/type` from `W₀`; `stats/metric` (with `metrics=accounts_created,ledger_count,transaction_count`) and `payment_volume` from `P₀`; `exchange_volume` and `amm_volume`
from `W₀`; `fees` from `W₀` with `interval=day`, always; all with `end=T` and `limit=1000`. XRPL's volumes are there twice, in the native currency and in USD
(`exchange_currency=USD&exchange_issuer=rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq`); Xahau has no USD and no `amm_volume`. `test/unit/network-fixtures.test.ts` works the requests out from
`windowOf` and the spec's table of calls, asks the fixture server for each, and fails for a file that is written and never asked for, or asked for and not written.
The default fixtures include `amm_volume` (the post-merge API), which the top level's `AMM_DATA: "on"` reads; the `worker-off` project does not ask for it. The synthetic files
(`isSynthetic`) are about 2.3 MiB and have a size budget of their own (`test/unit/http-fixtures.test.ts`).

**The accounts' analytics.** The Analytics tab of the account page asks D2's `stats/{family}?interval=` and `analytics/*` routes for months of an account's aggregates, so
`scripts/analytics-fixtures.ts` makes them up (`analyticsFixtures(net, T)`, joined into `generate()`): for the active, the deleted and the never-funded account of each network, the
six calls of each of the four periods at T (`analyticsWindow`), 144 files. Each account has one history, drawn from `mulberry32(seedOf(net, account, endpoint))` day by day from its
`inception` to T and made backwards from what the hand-written files say it holds (the active account's native line ends at its `account_info` balance and its LIONS or EVR line
at its `balances.json` value; the deleted account's native balance is 0 from its deletion on 2026-10-15; its parent opens it with the creation's `initial_balance` at its
`inception`), so the six answers and the four periods agree with each other and with the header. The shapes follow D2's reference at the commit `test/fixtures/PROVENANCE.md` ("Synthetic aggregates") names; the never-funded address has D2's empty answers.
`test/unit/analytics-fixtures.test.ts` works the requests out from the spec's table of calls and checks the files against the reference's rules and the anchors. They are about
0.31 MiB (`isAnalyticsGenerated`) and count against the synthetic files' budget.

**The markets pages' files.** `scripts/market-fixtures.ts` (`marketFixtures()`, joined into `generate()` with `ammInfoFixtures()`) makes them all by the data API's rules (`scripts/market-aggregates.ts`)
(test/fixtures/PROVENANCE.md, "Synthetic aggregates" and "Derived trades and pool states", names the commits): the candles, 24-hour rows, active accounts and markets rows are
made of trades, the XRPL pairs' derived from the recordings, the rest drawn from `seedOf(net, "network/markets")` and `seedOf("xahau", "exchanges/EVR+r…/XAH")`, so every count,
sum, price and close agrees with the trades it is of. A row of them is one line (a trade, a candle, an account, a market), T is the close time of the newest recorded ledger,
and `test/unit/market-generated.test.ts` works out the pair page's and the markets page's requests from `candleWindow` and `dayWindowStart`, asks the fixture server for each,
runs the client's checks, and checks every figure against its trades; `test/worker/market-fixtures.spec.ts` reads them with the clients' own requests in the Workers runtime.
They are about 0.86 MiB (`isMarketGenerated`) and have a size budget of their own too.

**The validators and amendments pages' files.** `scripts/validators-fixtures.ts` (`validatorsFixtures(net, last, ledgerValidations)`, called by `generate()` for each network after
`networkFixtures`, with the ledger validations that call made, in memory) makes D1's six answers up by the rules of the data API's reference at the commit `test/fixtures/PROVENANCE.md`
names ("Synthetic validators and amendments"), from `seedOf(net, route)` streams: the summary is counted from the list, the list is in D1's order, the amendments obey F7 and D1's
order, and every amendment answer carries the list's envelope (G3). `test/unit/validators-fixtures.test.ts` works those rules out again, checks the key orders and runs the client's
checks. The worker specs find a validator or an amendment of each case with `test/support/validators-cases.ts` (`validatorCase`, `amendmentCase`, `fixtureValidatorKeys`,
`validationsMarker`), by the rules of `test/support/validators-case-rules.ts` over the files (the ones the fixtures test checks the generator with), never a fixed key. They are about 2.7 MiB (`isValidatorsGenerated`, 239 files) and have a size budget of their own.

**The accounts.** The addresses and their transactions are real; what is not in the recordings is not invented beyond what a
page needs.

| | XRPL | Xahau |
|---|---|---|
| Active | `rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh`: 10.001625 XRP and one trust line (LIONS, issuer `rGHtf1...`), no open offers; 6 transactions (pages of 4 and 2), 2 payments (1 and 1), 3 trades (2 and 1) | `rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto`: 9,351.039221 XAH and an EVR line; its 8 newest transactions, all payments (pages of 5 and 3), no trades |
| Deleted | `r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC`: its history is the recorded AccountDelete; the node says `actNotFound`, balances and orders are 404 | `rMoPk1MiYJbmdNL8xr5s11r7jrxzBhJWLD`: its two recorded payments; Xahau has no recorded AccountDelete, so this one is declared gone |
| Never funded | `rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC`, valid and in no recording: no account, balances or orders (404), empty lists | the same address |

Rows of the lists are the recorded transactions exactly as `/v2/transactions/{hash}` serves them; `payments` and `exchanges`
rows are worked out from the same transactions' metadata. An active account's `account_info` is the state its newest
listed transaction left (balance, sequence, flags, `PreviousTxnID`) on the newest ledger. The creation of each account
(`parent`, `initial_balance`, `inception`, `ledger_index`, `tx_hash`) is invented, because it happened before the recordings
begin; its `tx_hash` is a made-up hash that nothing serves. What the recordings do not contain, no account has: an open offer,
an escrow, an LP token, a domain, an `account_objects` page with a `marker`. Tests that need those override the answer. The
Xahau active account's `OwnerCount` is 2 and `account_objects` lists the one object (the EVR line) the recordings show.
`test/unit/http-fixtures.test.ts` checks the hand-written files against the recordings and against each other. The account page asks the
node for `account_objects` with `limit: 400`, and a fixture is found by all the parameters of a request but its subject, so each
active account's objects are in the file twice (`<ACCOUNT>.json` and `<ACCOUNT>@limit=400.json`, byte copies,
`test/unit/account-fixtures.test.ts`), and the never-funded address has an empty `transactions@limit=1.json` (the one-row probe of its
history). The payments CSV has no fixture: a test gives it as an override.

**In a Worker test:**

```ts
const mock = mockUpstream("xrpl", {
  "GET /v2/transactions/<HASH>": dataApiError(503, "unavailable"),   // a failing data API
  "GET /v2/ledgers/107721455?expand=true&transactions=true": null,   // no such ledger: the node's fixture may take over
  "node account_info rXXX": nodeError("actNotFound"),                // a body is a node's `result`
  "xahau GET /v2/last_validated": (req) => new Response("...", { status: 500 }),
});
expect(mock.requests.map((r) => r.key)).toEqual([...]);             // net, kind, key, status, source, headers, body
expect(mock.unusedOverrides()).toEqual([]);                          // a typo in a key
mock.restore();
```

`mockUpstream(net, overrides?)` (`test/support/upstream.ts`) replaces `fetch` for both networks' data API and node at the URLs of
the test `env`, so a test may call either network; `net` is the network the unprefixed override keys belong to. Anything else
that is fetched throws. An override key is `GET <path>?<query>` for the data API (query order free) or `node <method> <subject>` /
`node <method> <all params sorted>` for a node (the more specific wins), optionally prefixed with `xrpl` or `xahau`. Its value is a
function `(req: Request) => Response`, a `Response` (its status, headers and body are captured when the mock is made, and every
request gets a new `Response` built from them), `null` (as if there were no fixture), or a JSON body (a data API's, or a node's
`result`). An unknown key throws. `dataApiError(status, message)` and `nodeError(code)` make the servers' errors. A `Response`
value works for a spec that asks the Worker for a page (`exports.default.fetch`) as well as for one that calls a client: the body is
read once, where the test made it. (It used to be cloned for every request, and workerd refuses to read a body in another request
than the one that made it, `Cannot perform I/O on behalf of a different request`, so a Worker saw a connection failure whatever
status the test had given.) A test that overrides to make something fail should still show that the Worker was given the failure it
meant: `statusesOf(mock, "GET /v2/...")` lists the statuses the mock answered a key with, and `0` is an answer that was never made.

**In the end-to-end suite:** `startFixtureServer(port)` (`test/support/fixture-server.ts`, Node only, `port` 0 for any) serves the
same fixtures at `<url>/xrpl` and `<url>/xahau` (data API) and `<url>/xrpl-node` and `<url>/xahau-node` (JSON-RPC), so the two
networks differ in URL, and in the Worker's cache keys, even on one origin. It returns `{ url, requests, override(), close() }`. A request
reaches a file only through names made of safe pieces (no `.`/`..`, `/`, `\`, `%`, `?`, `#` in a path segment, a node's subject
or its other parameters: `isSafePart` in `upstream-core.ts`), and the reader (`fileReader`) takes no path that resolves, or links,
outside `test/fixtures/http/`; either lock alone stops a request from reading another file.

A test that needs the chain to move on (the home page follows it, see "Live updates") changes what the upstreams answer for a while, as
`mockUpstream` does: `override({ "GET /v2/last_validated": {...} })` in-process, or from another process (the suite's tests are not the
stack's) `PUT <url>/__fixture/overrides` with that JSON object, `DELETE` to go back to the recorded answers. The control path wants
`Content-Type: application/json` and `X-Fixture-Control: 1`, which a web page open in the browser under test cannot send to another origin
without a preflight that the server never answers; keys that are none (`not an override key`) are a 400 and change nothing. The tests find
it at a port they know, `fixturePort()` (`scripts/e2e-env.ts`): `E2E_FIXTURE_PORT`, else the Worker's port plus two (`test/e2e/fixture-control.ts`,
`xrplHomeOneLedgerBehind()`: the XRPL home as it was one recorded ledger earlier, made from the recordings).

## End-to-end tests

`pnpm test:e2e` runs `test/e2e/*.spec.ts` with Playwright in Chromium, against **the built Worker**: `react-router build` (the Cloudflare
Vite plugin's output in `build/`), run by `wrangler dev`, so it is what `wrangler deploy` would upload, with its static assets, `_headers`,
rate-limit binding and Cache API. The data API and the nodes are the fixture server (`test/support/fixture-server.ts`, see "Upstream
fixtures") unless a real stack is named. Nothing in the browser or the Worker reaches the network but `127.0.0.1`.

`playwright.config.ts` has Playwright start `test/e2e/stack.ts` as its `webServer` and stop it at the end. The stack:

1. builds (`pnpm build`, without `CLOUDFLARE_ENV`; about 1.5 s), unless `E2E_SKIP_BUILD=1`: a stale build would test the code of an hour ago;
2. starts the fixture server on its own port (`E2E_FIXTURE_PORT`, default the Worker's port plus two, so that the tests can reach its control path);
3. makes a temporary directory (`x-explorer-e2e-*` under the system's temp directory, new for every run) with a file `worker.env` (mode 600:
   the four upstream URLs and `DATA_API_KEY`, each in quotes with `$` escaped, because wrangler rewrites `$NAME` in a value) and `state/`;
4. starts `wrangler dev --config build/server/wrangler.json --persist-to <dir>/state --env-file <dir>/worker.env` on `E2E_PORT` (inspector on the
   next port) and waits for `/robots.txt`;
5. on Playwright's SIGTERM: stops wrangler, closes the fixture server and removes the directory. The directory holds the key, so it is also
   removed when the process exits for any other reason, and when wrangler cannot be started or ends by itself the stack says so and exits 1.

The URLs and the key reach the Worker through that file, **never through the repository**: no `.dev.vars` is written, and a developer's own
(which `pnpm build` copies into `build/server/.dev.vars`, and `wrangler dev` would then read over the variables of the run) is not read,
because `--env-file` turns that lookup off. The state directory holds the Worker's Cache API, so every run starts without a stored page: an
immutable page from an earlier run cannot hide what the code does now. The suite uses its own ports (8832, 8833 and 8834 unless `E2E_PORT` says
otherwise; never 5173) and never reuses a server that is already running.

| Variable | Default | |
|---|---|---|
| `E2E_PORT` | `8832` | The Worker's port; the inspector takes the next one, the fixture server the one after (`E2E_FIXTURE_PORT`) |
| `E2E_FIXTURE_PORT` | `E2E_PORT` + 2 | The fixture server's port, which the tests that move the chain on or take an answer away (`live-home.spec.ts`, `network-live.spec.ts`, `market-pair-live.spec.ts`, `account-analytics-live.spec.ts`, and the group of `a11y.spec.ts` with a card that failed) ask to change its answers. Not with a real stack or a deployed Worker, which have no such server: those tests are skipped |
| `E2E_DATA_API_URL`, `E2E_NODE_URL` | unset: the fixture server | A real stack, e.g. `data-api-new`'s docker-compose or staging. **Both or neither.** `{net}` in either stands for the network's id: `https://{net}.data.example.com` is `https://xrpl.data.example.com` and `https://xahau.data.example.com`, and a URL without it is used for both networks. They become `XRPL_DATA_API_URL`, `XAHAU_DATA_API_URL`, `XRPL_NODE_URL` and `XAHAU_NODE_URL`. With the fixture server they are `<url>/xrpl`, `<url>/xahau`, `<url>/xrpl-node` and `<url>/xahau-node` |
| `E2E_DATA_API_KEY` | `e2e-fixture-key` (the fixtures take any) | The `X-API-Key` of a real data API; required with `E2E_DATA_API_URL` |
| `E2E_BASE_URL` | unset | Test a Worker that is already running (a deployed staging) and start nothing. The visitor limit then counts all the tests as one address (the edge sets `CF-Connecting-IP`): use `E2E_WORKERS=1` |
| `E2E_SKIP_BUILD` | unset | `1`: use `build/` as it is (the pipeline has just made it with `pnpm verify`). A build for a Cloudflare environment (what `pnpm deploy:staging` leaves) is refused |
| `E2E_WORKERS` | `4` | Parallel workers |
| `E2E_VERBOSE` | unset | `1`: let the Worker's and wrangler's log lines through (one per request) |
| `E2E_FEATURES_OFF` | unset | A comma list of the switches the Worker under test has off (`ACCOUNT_ANALYTICS`, `AMM_DATA`, `AMM_PAGES`, `MARKETS`, `VALIDATORS`: the names of `FEATURE_VARS`; spaces and empty names are ignored), for a run against staging or production before a switch is on there. The suite does not set a switch, the Worker's own `vars` do: this only tells the tests. A test that needs a switch on skips itself when it is listed, and runs its off-case where it has one (`network-page.spec.ts` checks the `off` wording of the AMM line; `account.spec.ts` and `account-analytics.spec.ts` the "soon" tab and the redirects of `ACCOUNT_ANALYTICS`, and `a11y.spec.ts` leaves the analytics views out). A name that is not a switch is an error (`featuresOff` in `scripts/e2e-env.ts`), because a misspelt one would turn nothing off |
| `E2E_CHROMIUM` | unset | The path of a Chromium to use |
| `E2E_ALLOW_OLDER_CHROMIUM` | unset | `1`: in a pipeline (`CI` set), take an older Chromium when the wanted one is not installed. See "The browser" |

**Against a real stack** the suite reads recorded mainnet ledgers and transactions (final, so the same there as in the fixtures), which the
stack must have. What the fixtures hold by hand is not an account's today (`test/e2e/fixtures.ts` `LIVE`): the tests that read the account
files (their pages of four and two rows, a balance, an address nobody funded) are skipped when `E2E_DATA_API_URL` or `E2E_BASE_URL` is set, and so
are the tests of the analytics view that read the synthetic files (its figures, its columns, its days); two tests of the view run everywhere and assert
no figure (`account-analytics.spec.ts`): the tab opens the view with its filter row, and each tile and card shows its data, its empty state or its error.
So does the test of the kit's two copies in one document (`analytics-kit-copy.spec.ts`), which reads no figure either. It has not been run against a
real stack from this repository.

**The browser.** `pnpm exec playwright install chromium` fetches the revision this Playwright wants, and it is what a pipeline needs. In this order
(`chromiumToUse` in `scripts/e2e-env.ts`): `E2E_CHROMIUM`, if set; the headless shell of the wanted revision, if installed; the full Chromium of the wanted
revision, if installed; otherwise, if only an older headless shell is in Playwright's browsers directory (a machine whose browsers an earlier
Playwright installed), then on a developer's machine the newest one, with a **warning on stderr** that names both revisions and the install command; in a
pipeline (`CI` set to something but `0` or `false`) it is an **error** naming `pnpm exec playwright install chromium`, unless `E2E_ALLOW_OLDER_CHROMIUM=1`
(the older one is then used, with the same warning). With no browser installed, Playwright says what to run.

**Determinism.** No retries (a test that passes on the second try is a test that fails), no assertion on a time or a duration (the pages
show ages, `13 h ago`; they are never asserted), only Playwright's waiting assertions and `waitForURL`. Each test has a visitor address of its
own: the Worker allows 60 uncached renders in 10 s per address, and without one every request would be the same visitor
(`CF-Connecting-IP`, `test/e2e/support.ts`). Each test also fails on anything the browser's console logged as an error and on an uncaught
exception (a hydration mismatch, a script that throws, a missing file of the build, a page that answers 5xx), unless it says
`test.use({ allowConsoleErrors: true })`. The one answer let through is a 404 for a page that is not there (as a document or as the `.data` request of a
client-side navigation; not a file of `/assets/` or `/__manifest`): the browser logs it, and the tests that ask for one assert the page.
A test that needs a context of its own (a stored theme, scripts off, storage that throws) asks `contextFor(options)` of `test/e2e/support.ts`, which gives
it the test's visitor address and the same check on every page, and closes it; `guard.spec.ts` shows the check failing a test (with `test.fail()`)
for a 5xx, a missing manifest or asset, and an exception in such a context.

| Spec | Flows |
|---|---|
| `search.spec.ts` | A pasted hash with its noise (`0x`, lower case, spaces) shows its hint and leads to the transaction; a hint leads to an account and `/` focuses the header's box; a grouped ledger index (`107,720,688`); the box as a plain form with JavaScript off; a hash of the other network, the 404 and the "Search on Xahau" offer; an address never activated |
| `ledger.spec.ts` | Xahau 26540187 → next (26540188) → previous, in the page (no new document), by the links named `26,540,188, next ledger`; the type filter |
| `account.spec.ts` | The tabs (Transactions, Payments, Trades, Offers, Objects; Analytics is a `rel="nofollow"` link, the "soon" label when `E2E_FEATURES_OFF` lists `ACCOUNT_ANALYTICS`); Older and Newer on Transactions (four rows, two rows, four rows; the marker page shows no live state) and on Payments, which keep the tab; the balance, the token and the reserve |
| `account-analytics.spec.ts` | The account's analytics view ("Account analytics"), reading the fixtures and changing none: the Analytics tab is a `rel="nofollow"` link that opens the view in one document, with the four period links (each `rel="nofollow"`, "30 days" current) and no Tokens or Owned objects card; each tile and card shows its data, its empty state or its error (the one test that also runs against a real stack); the four tiles of the fixtures ("17.54 XRP", "−12.4% over the last 30 days", 17 sent and "2 failed, fee still paid", the fees, 2 counterparties) and the seven cards (a line, 30 stacked columns with the "×" legend, three balance panels, 30 diverging columns with their summary line, the seven named causes, two counterparties with links, three pairs); "90 days", "1 year" and "All" change the URL, draw 90 columns, 52 weeks and 16 months (the table's first column "Day (UTC)", "Week of (UTC)", "Month (UTC)"; the axis's last label "Oct 17", "Oct 12", "Oct 2026"), keep the scroll position, and Back restores each view and its period note; with every `/assets/*.js` aborted the streamed tiles and cards are there and checking Table shows a card's 31 rows; a pointer over the transactions sent shows a tooltip with the date, "total" and "failed", and "Oct 17, 2026, so far" on the newest column; Tab to its slider, then Arrow Left, changes its `aria-valuetext` (which reads the failed count); the deleted account's tile 1 is "—" with "Deleted accounts hold nothing" and its period note says "This account was deleted; All covers its whole history."; the never-funded address is the 404 page. With `ACCOUNT_ANALYTICS` in `E2E_FEATURES_OFF` the rest skips and the off case runs: the tab is "soon" and the view's URLs are redirected to the account page |
| `network.spec.ts` | The switch goes to the other network's home, changes `data-net` and the title, writes the `net` cookie, and `/` then redirects to it; `/` without a cookie is XRPL; an unknown network is a 404 |
| `network-page.spec.ts` | The network page, reading the fixtures and changing none: "Network" in the header leads to `/xrpl/network` in one document and is the current item (`aria-current="page"`); with JavaScript off the 30 columns are drawn and checking Table hides the chart and shows 31 rows; "1 year" changes the URL to `?period=1y`, draws 52 columns, adds `noindex`, drops the canonical link and Back restores them; "USD" sets `in=usd`, and `/xahau/network` has no "Amounts in"; a pointer over the stacked chart shows a tooltip with the date and "total", and Tab to its slider then Arrow Left changes `aria-valuenow` and the text it says; the AMM line and its legend entry are there (or, with `AMM_DATA` in `E2E_FEATURES_OFF`, the `off` wording); the newest column's tooltip reads "Oct 17, 2026, so far" and the volume card notes "Oct 17 is not computed yet." (skipped against a real stack, which has another day) |
| `analytics-kit-copy.spec.ts` | The analytics view after the network page, in one document (the header's search to the account, its Analytics tab, then Back twice): each copy of the chart kit draws with its own contexts, the tooltip of a plot in that plot's slot (beside its scroll region, not in it) and the panels of the balance history on one bucket, and the network page's chart after it the same (skipped when `E2E_FEATURES_OFF` lists `ACCOUNT_ANALYTICS`) |
| `theme.spec.ts` | See below |
| `client-meta.spec.ts` | The path `test/worker/meta.spec.ts` cannot see: the `<title>`, canonical link, `og:*` and `twitter:card` after a client-side navigation (ledger → next ledger → a transaction → Back, in one document), the loss of the canonical link and the gain of `noindex` on a page behind a marker and their return, the same on the Analytics tab (no canonical, `og:*` or `twitter:card`; the title of the view and of its year) and their return on the way back,
the network switch, and that moving between the routes asks for no `/__manifest` |
| `og.spec.ts` | For a transaction, a ledger and an account: `/og/...png` answers 200, `image/png`, the class's `Cache-Control`, `X-Robots-Tag: noindex`, the PNG signature and an IHDR of 1200 × 630; the page's `og:image` is that URL and a browser loads it at a natural size of 1200 × 630; no image for a missing transaction or an invalid id |
| `assets.spec.ts` | The stylesheet, scripts and font of a page carry `Cache-Control: public, max-age=31536000, immutable` from `public/_headers` (the local runtime applies it); a page and the favicon do not |
| `guard.spec.ts` | The check at the end of every test (above): it fails a test whose client-side navigation got a 503, whose route module or stylesheet is missing, or whose page threw in a `contextFor` context; it lets a 404 page through and honours `allowConsoleErrors`; a `contextFor` context has the test's visitor address and takes options |
| `live-home.spec.ts` | The `live` project of `playwright.config.ts`, which runs alone after the others (what the tests do to the fixture server would show in every page the Worker renders meanwhile; `--no-deps` runs it without them), one test at a time, each `test.slow()`. The fixture server says the newest XRPL ledger is the one before the recordings' newest, the home page is opened, and the fixture server goes back to the recordings: the new ledger appears without a reload (the document is the same; the browser asked only the explorer's own `.data` URL for the page's route), the new rows have `.is-entering` and the rows that were there were sent back to slide (a `MutationObserver` of the page records it, and the `animation-name` of each row and figure *as it was added*, so that the next beat is no race), the figures that changed ticked in; under `reducedMotion: "reduce"` nothing is transformed and the animation is the wash and the mark alone; nothing animates when the page is first opened; the pause button pauses and resumes (its label switches, it is not `aria-pressed`, the status line says what was done), is 44 px, and the choice survives a reload of the tab; the hero says the page waits while the mouse is over a table, and a real click on a spot of a table (which focuses its scroll region) does not leave the page held once the mouse has left; and when the Worker answers 503 the page is the page it was (no error screen), the hero says "Live updates paused, retrying…" after two refusals (the second 8 s after the first), and "Live updates reconnected" when the Worker answers again |
| `network-live.spec.ts` | In the `live` project too (`*-live.spec.ts`, below). A card that cannot be loaded: `stats/type` of `?period=90d&in=usd` answers 503 (`unavailable()`), the card says "Couldn’t load transactions by type" in its place with a Retry, and after `fixtures.reset()` it is back by itself within 10 s (the hold, then a beat); `amm_volume` of `?period=7d&in=usd` has no route (`null`), the volume card says "AMM swaps couldn’t be loaded." with a Retry and the line comes back when the route does. The chain moves on (`xrplHomeOneLedgerBehind()`, then `fixtures.reset()`) under `?period=90d`: the new chip has `.is-entering`, the chips that were there get a transform, the validators card follows, the document is the same and the only request is `/xrpl/network.data?…&_routes=routes%2Fnet.network`; with `reducedMotion: "reduce"` there is no transform and the chip does not slide; nothing animates when the page is opened; the pause button pauses (the status line says so, the choice survives a reload) and resuming asks at once; a mouse over the strip says "Paused while you look at the ledgers" in the row and not in the status line; with the browser's `.data` requests answered 503 the page stays and says "Live updates paused, retrying…" after two refusals, and "reconnected" when they work; and with `xrplNextDay()` in (the newest ledger closed after midnight, so every call over a period has no answer) the window's words move on to Oct 18, and the AMM line and every card the page had stay (`keepLoaded`), for two beats, with nothing said |
| `markets.spec.ts` | The markets page, reading the fixtures and changing none: "Markets" in the header leads to `/xrpl/markets` in one document and is the current item (`aria-current="page"`; with `MARKETS` in `E2E_FEATURES_OFF` the test checks the "soon" label and skips itself, and the rest of the file is skipped); "7 days" changes the URL to `?period=7d`, adds `noindex`, drops the canonical link and `og:*`, and Back restores them; on `?period=30d` (the fixtures' XRP/RLUSD has fewer than 10 trades in the 24 hours, so it is in the 7-day and 30-day sets only), "XRP" in Quote turns the XRP/RLUSD row round (RLUSD / XRP, its link to `/xrpl/markets/RLUSD.rMxCKb…/XRP`) and every row is quoted in XRP; the text filter narrows the rows ("solo": "Showing 2 of 40 pairs, by volume, largest first"; an issuer's full address in capitals; nothing, and the empty text) and the tiles stay; a press on Trades sets `aria-sort` and orders the rows by it, a second reverses, Volume again is the API's order; "Show all 159" shows the rest without a request and "Show first 100" takes them away; with JavaScript off the 100 rows and their sparklines are there and no field, button or Show all is; and the XRP/RLUSD row leads to the pair's page in the same document (the header's Markets `aria-current="true"` there) |
| `market-pair.spec.ts` | The market pair page on `/xrpl/markets/XRP/RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De`, reading the fixtures and changing none: "4 h" is `?interval=4h` (the readout's newest bucket 16:00, the slider's words change, `noindex`, the title's "4 h candles", one document); "Show RLUSD/XRP" goes to the inverted pair, which is `noindex` with no canonical link or `og:*` and links back; on `?trades=book`, Older and Newer keep `trades` and the page behind the marker has no live row, no price card and no book (skipped with `AMM_DATA` in `E2E_FEATURES_OFF`); a trade's time leads to its transaction (an OfferCreate the fixtures hold); the issuer leads to its account page (the fixtures do not hold that account: its page is the 503 there, the one console error the test lets through); the pointer on a candle shows it in the readout and a tooltip, and the readout goes back when it leaves; Tab to the slider then Arrow Left changes `aria-valuetext`; with JavaScript off the candles, the volume, the Table view (61 rows), the book (20 levels) and the trades (20) are there and no slider or pause button; the Via column and the Trades filter are there (with `AMM_DATA` off: checked absent, then skipped); the traders card does not list the pool `rhWTXC…tcS3`; and every depth bar of the book lies inside its own row, at 1280 and 375 px (Chromium; the ARIA table over `div` rows is for WebKit, which no Playwright WebKit here has checked) |
| `market-pair-live.spec.ts` | In the `live` project too. With `xrplPairOneTradeBehind()` in, the page opened and `fixtures.reset()`: the new trade enters with `.is-entering` (`row-enter, live-flash, row-mark`), the rows that were there slide, the price and the book's last price tick in, the document is the same and the only request is `…/XRP/RLUSD.r….data?…&_routes=routes%2Fnet.markets.%24base.%24counter`; with `reducedMotion: "reduce"` nothing slides and only the colours change; paused, nothing is asked for 6 s and resuming takes the trade at once; the pointer on the trades holds the page ("Paused while you look at the trades") and nothing is asked until it leaves; with the `.data` requests answered 503 the page stays and says "Live updates paused, retrying…" after two, and "reconnected" when they work; both `book_offers` failing (`nodeNotSynced()`): on a fresh load "Live state unavailable" in place of the whole book, the rest of the page there, no alert and one `role="status"`, and axe's gate in both system themes; a book once shown is kept, with its ledger, through beats whose book failed (`keepLoaded`); and `GET /v2/network/markets?limit=1000&period=day` taken away (`null`): a view of the 24 hours that has no stored copy answers 503 (each asked once, 20 s apart, the last 62 s after the override, when the Worker's kept answer has surely gone), the default view is its stored copy or the 503, and the pair page is unaffected |
| `account-analytics-live.spec.ts` | In the `live` project too. A card of the analytics view whose call fails: `stats/transactions` of the Xahau account's year (a view no other spec opens; the Worker keeps an analytics call 60 s) answers 503, the card says "Couldn’t load the transactions sent." in its place with a Retry (its title and source stay; its tile is "—" over "Couldn’t load"), and the other cards are drawn; after `fixtures.reset()`, Retry brings the card's 52 columns back (it is pressed until it does: a Retry within the 5 s hold is given the held failure), and the view has no error left |
| `a11y.spec.ts` | See below |
| `validators.spec.ts` | The validators list and a validator's page ("Validators and amendments"), every validator read from the pages (`test/e2e/validators-pages.ts`: `listedValidator`, and `withHistory`, the one validator whose older validations the fixtures hold, or against a real stack the list's first), so it runs against a real stack too: from the network page "All validators" lands on `/xrpl/validators?scope=all` and a first-seen key on its validator's page, in one document; the default list (the UNL, as many rows as the scope link counts, the live row, a canonical link, no `noindex`, the filters' search landmark); "All" is `?scope=all` with `noindex` and no canonical link, and Back restores the head; a search through the form with JavaScript goes straight to `?q=…` (no 3xx, and the page's `.data` asks for `q` alone) and without it the Worker's 302 tidies the empty fields the form sent; "Votes yes for" (`?amendment=`) and "Listed by" (`?publisher=…&amendment=…`, in the canonical order) on XRPL, then Clear filters back to the scope; no "Listed by" on Xahau; a row leads to its validator; the versions card's Table radio with JavaScript off; on a validator's page the copy buttons (the clipboard holds the master key, then the signing key, and the status says "Copied"), the agreement slider's arrow keys change `aria-valuetext`, Older (`?marker=`, no live row, `noindex`) and Newer, and the key in hex (from `decodeNodePublic`) lands on the base58 URL. With `VALIDATORS` in `E2E_FEATURES_OFF` these skip themselves and the off-case runs: the four pages are 404s, "All validators" is "soon" and the five keys are text |
| `amendments.spec.ts` | The amendments list and an amendment's page, the amendment read from the list (an amendment with a majority: what needs one skips itself on a real stack that has none, and fails under the fixtures, which hold every case: `needs` in `test/e2e/validators-pages.ts`, as for every case the specs and the accessibility block read from the pages): the status chips (a chip is `?status=…`, `noindex`, its rows its count; All is the default view and its canonical link); the line of an amendment activating soon leads to its page; on the yes-votes chart the arrows move a flag ledger and Page Down and Page Up the rounds of a day (`pageStep`; the slider's dates a day apart) and the Table radio shows the changes-only table; the other validators' disclosure; the ID in lower case lands on the name's URL; a ledger link and an EnableAmendment link of the history land on `/{net}/ledger/{n}` and `/{net}/tx/{hash}` (under the fixtures those are made up, so the explorer's not-found page of the kind answers: the link is what is checked); the countdowns are the absolute time with JavaScript off (nothing says "in …") and tick with it on (a browser clock installed half an hour and half a minute before the moment: "in 31 min", a minute later "in 30 min", then past it) |
| `validators-live.spec.ts` | The `live` project (`*-live.spec.ts`). Each test opens its page once a render of it is of the recordings' newest ledger (its `anchor` in the HTML): `network-live.spec.ts`, just before, moves the chain a day on, the Worker keeps `last_validated` 2 s, and a page whose anchor is ahead refuses every beat after it (an older ledger). With `/v2/network/amendments` answering 503 before the list loads, "Votes yes for" is missing (the rest of the page is there, nothing is an alert) and comes by itself within the hold and a beat once the answer is back; an open list whose beat then fails keeps its select (`keepLoaded`): the Worker keeps the amendments 60 s and the list is served stale for 35 s, so this test waits for a beat answered `no-store` (degraded), up to about 100 s, and the test before it is the first of the project to ask for the amendments. A validator's page whose newest validation the fixture server held back gets it without a reload: the row enters with `.is-entering`, the rows that were there slide, the document is the same and the only request is the route's `.data`; with `reducedMotion: "reduce"` nothing slides; the pause button (the choice survives a reload, resuming asks at once); a mouse over the validations holds the page and says so in the row; with the browser's `.data` answered 503 the page stays and says "Live updates paused, retrying…" after two refusals, then "reconnected". Last, the accessibility gate on a validator's page whose validations failed (a card with its error and Retry), at both widths in the two system themes: `a11y.spec.ts`'s page with a failed card, here because it fails a call of the fixture server |

**Changing what the fixture server answers.** `test/e2e/fixture-control.ts` puts answers into the fixture server from the tests' process (`fixtures.override`, a JSON object of override keys, each `GET /v2/…` with the query sorted by name; one `PUT` replaces the overrides before it; `fixtures.reset` goes back to the recordings). JSON cannot carry a failing `Response`, so an error is written `unavailable()` (`{ $error: { status: 503, message: "unavailable" } }`) and the control path turns it into the data API's own error answer (`test/support/fixture-server.ts`); `null` is the API's "Cannot GET" 404. `xrplHomeOneLedgerBehind()` says the chain is one ledger behind the recordings (the home page's and the network page's tests move it on), `xrplNextDay()` says the newest ledger closed after midnight UTC, so that no call over a period has a fixture, `xrplPairOneTradeBehind()` says the newest trade of XRP/RLUSD is the one before the recordings' newest (the first page of its trades without its newest row), and `nodeNotSynced()` is a node's `noNetwork` answer, for a node key (`node book_offers <gets>_<pays>`). A change shows in every page the Worker renders meanwhile, so the specs that make one are the `live` project's (`LIVE_SPECS` in `playwright.config.ts`: `live-home.spec.ts` and every `*-live.spec.ts`, so a later plan's needs no edit there), which runs alone after the `chromium` project and with **one worker**, across its files as well as in each (`fullyParallel: false` only keeps the tests of a file together; two files would otherwise put their overrides over each other's). The Worker keeps a period's answers for 300 s, so a test that takes one away has to be the first of the run to ask for it: `network-live.spec.ts` uses views no other spec opens (`?period=90d&in=usd`, `?period=7d&in=usd`, every 90-day view), in the order that keeps it so. The Worker keeps an analytics call 60 s, so `account-analytics-live.spec.ts` fails a call of the Xahau account's year, which no other spec opens. The edge also serves a page's stored copy, of any age, in place of a render that fails, so `market-pair-live.spec.ts` shows the markets page's 503 on views of the 24 hours no other spec opens (`?quote=btc`, `eur`, `usd`, `xrp`), each asked once. The one spec of the `chromium` project that fails calls, `a11y.spec.ts`, fails `stats/type` of the network page's `?period=7d` and `stats/transactions` of the Xahau account's `?tab=analytics&period=90d`, which nothing else asks for, in one override (a `PUT` replaces the one before it) for a group of eight tests that run in one worker, and takes the override away after them.

**Theme, with no flash.** The page is stored once for everybody, so the server cannot name a theme: `THEME_SCRIPT`, a plain inline script in
`<head>` before the stylesheet, puts the stored choice on `<html data-theme>`. The spec checks that three ways. (1) The stored HTML, parsed as a
browser parses it (a `DOMParser`): `<html>` has no `data-theme`; the head has one script that sets `dataset.theme`, with no attributes at all (no `src`,
`async`, `defer`, `type="module"`), no script or style ahead of it, and ahead of the first `<link rel="stylesheet">`; and its text puts the attribute at
once, with no `DOMContentLoaded`, `load`, timer or promise. (2) The first frame: a context with `localStorage.theme` set (Playwright's `storageState`)
loads the page with every `/assets/*.js` aborted, so that React cannot set anything and only the HTML can; `data-theme` is then the stored choice, and the body
paints with the background the system's dark gives (the same page with `prefers-color-scheme: dark` and nothing stored); a stored `light` beats a dark
system the same way. (3) When it happened: a `MutationObserver` on the whole document, installed before the page's scripts (`addInitScript`), notes
`performance.now()` when `data-theme` first appears and when the stylesheet's `<link>` first enters the document (and what `<html>` had at that tick).
The spec asserts that `<html>` already had the choice when the `<link>` came in, and that the time the attribute was set (the microtask after the
script, the observer being told) is not after `first-paint`'s `startTime`. That is a measure of the order in which the attribute and the stylesheet reached the
document and of the attribute coming before the first paint; the pixels of the first frame are not captured, the background comparison of (2) being what says
what they are. (4) With scripts: the toggle sets `data-theme` and `localStorage`, `aria-pressed` follows, the choice survives a client-side navigation and a
reload, the system theme is followed until a choice is made, and it works where `localStorage` throws. Removing the script fails (1), (2) and (3); moving it
after the stylesheet fails (1) and (3).

**Accessibility.** `@axe-core/playwright` with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` (the rules of WCAG 2.2 AA, including
`color-contrast`, `target-size` and `label-content-name-mismatch`, which the spec checks ran). The gate is no violation of impact `serious` or
`critical`; the failure message names the rule and the elements. The matrix: the home, ledger (Xahau 26540187), transaction, account, 404, network (`/xrpl/network`), markets (`/xrpl/markets`) and market pair (`/xrpl/markets/XRP/RLUSD.rMxCKb…`) pages and the XRPL active account's analytics view (`?tab=analytics`)
× a 1280 px desktop and a 375 px phone × four settings: light and dark by `prefers-color-scheme`, and dark and light chosen with the toggle
(against the opposite system theme; the spec checks the page really has that `color-scheme`). Twenty-two more pages (the other tabs of an account, a page
behind a marker, a never-activated account, a missing transaction, the search help, the newest ledger, the Xahau home and account, a ledger of 66
transactions, the network page in a year in USD, on Xahau, with every Table radio checked and with a slider focused and its tooltip shown, and the analytics
view's year and All, the Xahau account's view, the deleted account's, every Table radio of the view checked and a slider of it focused with its tooltip) run in
the two system themes, and so do seven of the markets pages (`/xahau/markets`, `/xrpl/markets?period=30d&quote=usd`, the markets page with the text filter in use, the pair the other way round, a page of its
older trades reached by Older from `?trades=book`, the pair page's 404 and the pair with the candles' slider focused); the network page and the analytics view with a card that failed (`stats/type` of the 7 days, `stats/transactions` of the Xahau account's 90 days, failed
through the fixture server) run in the two system themes at both widths, and the pair page with its node failing (`book_offers`) in the two system themes in `market-pair-live.spec.ts`, which may change the fixture server's answers. The markets pages are left out while `E2E_FEATURES_OFF` lists `MARKETS`. An analytics view is whole when nothing in it is `aria-busy` and, with the fixtures, the script has given its
plots their sliders (the view is a lazy chunk and hydrates after the page); with `ACCOUNT_ANALYTICS` in `E2E_FEATURES_OFF` the views are left out. The first contrast check of the header's current item (`.is-current`: `--fg` on `--sunken`) is the network page's. A separate test runs axe's `landmark-unique` (a best practice, so outside the WCAG tags) on the main pages, the analytics view among them, and another the rules
about ARIA attributes with "needs review" results counted as failures, the analytics view among its pages (axe reports a name on an element that cannot have one that way, so the gate
above does not see it).

The validators and amendments pages have their own block (the spec's "Accessibility"): the list, a verified UNL validator, the amendments list and the amendment
with a majority in the whole matrix, and twelve more views in the two system themes at both widths (Xahau's list and amendments, a search with no match, a validator with
no domain, a page of older validations, an enabled amendment and one of no known name, every Table radio checked on the list, a validator and the amendment, the yes votes'
slider focused with its tooltip, the other validators' votes open), each validator and amendment read from the pages; at 375 px each of them is also checked not to scroll
sideways (the tables and the 30-day charts scroll inside their cards), and `landmark-unique` runs on the four, the filter form's search landmark beside the header's. Links
inside a sentence there are underlined (the toml link of a validator's note, "Clear filters" after "No validators match these filters."): in dark mode the link colour is
too close to the text's for axe's `link-in-text-block`. Their page with a card that failed is in `validators-live.spec.ts`.

## The client bundle check

`scripts/check-bundle.ts` (`pnpm check:bundle`, the last step of `pnpm verify`) runs the check of `scripts/bundle-budget.ts` (tested in
`scripts/check-bundle.test.ts`) on `build/client` after the build and exits 1 when it finds a problem. The command always runs the check, however it
was reached (a link to it included): a gate that cannot tell whether it is being run must fail, not pass. It fails when:

- a page loads more JavaScript, gzipped, than its budget (`BUDGETS` in `scripts/bundle-budget.ts`, ruling R19): **150 KB** (150,000 bytes) for the lookup pages,
  the home, ledger, transaction, account and markets routes, and **160 KB** (160,000 bytes) for the dashboards, the network, market pair, validators, validator, amendments and amendment
  routes (`PAGES`, which names each page's budget); what it loads
  first is read from the build's client manifest (`assets/manifest-*.js`, `window.__reactRouterManifest`): the entry, the root route, the `/:net`
  layout and the page's route, with every chunk those import statically (the manifest's `imports` hold the whole closure), **and the manifest itself**, which every page loads
  and which lists every route of the app, so it grows with each. Chunks fetched with `import()` (the search box's classifier) are not in it. Each file counts once, at its
  `gzip -9` size. Sizes are in kilobytes of 1000 bytes. A budget's own figure passes and one byte more fails: 150,000 and 150,001 for a lookup page, 160,000 and
  160,001 for a dashboard;
- the account page's **analytics view** loads more than **160 KB** in all, a dashboard's budget (spec 5, the second gate; the row `account analytics`): the account route's
  first load as above, the chunk of the view that one of its files loads with `import()` (``import(`./AccountAnalytics-….js`)``, as the build
  writes it; `ANALYTICS_VIEW` in `scripts/bundle-budget.ts`), and every file that chunk imports statically (`from"./x.js"`, `import"./x.js"`),
  followed from file to file, each file once. So a visitor who opens the tab never loads more than the view's budget before the view works. An account
  route without that `import()`, or with two, fails, and so does a file it reaches that is missing; and so does a view that loads any file beyond
  the account page's but its own chunk (`kitCopyProblems` in `scripts/analytics-kit-copy.ts`: that is a chunk it shares with another route; see
  "The analytics view's own copy of the kit" below);
- any file of `build/client` that is text holds `workers-og`, `satori`, `resvg`, `yoga-wasm`, `Geist-Regular.bin`, `AffectedNodes`, `TransactionType`,
  `FinalFields`, `ripple-binary` or the QR encoder's tables (the numbers of `ECC_CODEWORDS_PER_BLOCK` in `app/server/qr.ts`, which a minified bundle keeps
  and its names it does not). These are what the Worker uses to read a transaction, draw an image and encode a QR code; the browser gets data. Fonts
  and images are not read;
- `build/client/assets` holds a `.wasm`, `.ttf` or `.bin` file: WebAssembly, or a font that is not the pages' own WOFF2 (the image renderer's);
- `build/client/_headers` is missing or lacks the rule that keeps `/assets/*` for a year;
- the root route does not import one `shell-*.js` chunk, or imports a `vendor-*.js` one, or the entry does not import that shell chunk
  (`shellManifestProblems` in `scripts/shell-chunks.ts`: see "One shell file" below);
- the manifest or a file it names is missing.

It prints a table (page, files, bytes, KB, `ok` or `OVER`, and the row's budget), the manifest's size and the problems.

**The figures of E2** (gzip -9 bytes, each file once). *Before* is `c05ca58`, the commit E2 started from; *after* is the end of E2. The check counts the manifest since the commit that added the
network page's end-to-end tests; the middle column is the figure without it, as the spec's target of 145,000 bytes and the earlier measurements are.

| | Before | After, without the manifest | After, as the check counts it (with the manifest) |
|---|---|---|---|
| home | 134,450 | 136,627 | 137,651 |
| ledger | 134,134 | 135,790 | 136,814 |
| transaction | 136,253 | 137,933 | 138,957 |
| account | 136,647 | 138,604 | 139,628 |
| network | | 146,616 | 147,640 |
| manifest `assets/manifest-*.js` | 959 | 1,052 | |
| shared base (the files every page loads, the manifest not counted) | 129,879 (12 files, the four pages) | 131,532 (13 files, the four) and 130,761 (12 files, the five) | |

The manifest is measured with `gzip -9 -c build/client/assets/manifest-*.js | wc -c`, which stores the file's name (959 and 1,052 bytes); the check's own `gzipSync` stores none and says 935 before and
1,024 after. The shared base is the summed size of the files that every page loads (the intersection of the `files` of `checkBundle("build/client").pages`, less the manifest).

- **Growth.** The four older pages grew by 1.7 to 2.2 KB: E2's shared code, in the chunks every page loads (the shell with the header's sections, `format.ts` and its new formatters,
  `RelativeTime`, the layout with the switches). The manifest grew **89 bytes for the one route** (935 to 1,024, 12 routes to 13). The network page is 15.9 KB above the base the five pages share.
- **The target, and the fallback that was tried.** The spec wants the network page at 145,000 bytes or less. It measured 146,616, so the fallback the spec decided on was applied: `Cursor` and
  the tooltip loaded with `import()` on the first `pointerenter` or `focusin` of a plot, a `CursorSlot` layer in their place until then, with the files that keep what the page needs out of the lazy chunk.
  It was measured twice and taken out.

  | | Network page, without the manifest | Every other page |
  |---|---|---|
  | no fallback (Task 17, and now) | 146,616 | home 136,627 |
  | the fallback, first version (`50956e4`) | 146,466 (-150) | +327 to +337 |
  | the fallback with every plot of a group taking the cursor, and the keys pressed while it loads replayed (`7e8ffc4`) | 146,700 (+84) | +327 to +337 |

  The cursor and its tooltip are 1.8 KB gzipped, and a chunk of their own costs as much as it takes out: the slot that stands in for them (eager, with the focus, pointer and keys it replays and the
  loaded cursor every plot shares), a 0.55 KB shared chunk for what the plot and the cursor both import, and, in every page, a runtime chunk the build makes for any chunk loaded on its own (512
  bytes, of which 359 left the React chunk: +153) with the `import` statements that reach it (+174 in 13 of the home page's 18 files) and its name in the manifest's `imports` of every route (+48). Correct
  behaviour for a group of plots needed the slot to be the module's (a plot that was not entered must still show the group's bucket), and for the keyboard it needed the keys replayed: the two
  things that made the network page heavier than with no fallback at all. So the premise of the fallback, that it lightens a page that is over its target, did not hold, and it went.
  **The target is missed by 1,616 bytes** (146,616 against 145,000), and what the page needs to lose is elsewhere in its route chunk; the budget is not the target:
  **150,000 holds with the manifest counted**, with 2,360 bytes to spare on the network page.
- **The projection for E3 to E6** (nine more routes), from these figures. The manifest grows about 90 bytes for each route (the network route's 89): 100 is taken, +900, to about 1,920 bytes. The base every page shares
  takes no route's own code (a route is a chunk of its own), only what its layout and entry reach; assume at most 100 bytes for each route (a formatter, a header item: the items and the switches are there
  already): +900. If the network page stays the heaviest, it ends at 147,640 + 900 + 900 = **149,440 bytes, 560 under the budget**. A later page that has more of its own than the network page (15.9 KB over the
  base: a pair page with candles, a book and trades) would be over 150,000. So the manifest is **part of every page's figure from now on** (`scripts/bundle-budget.ts`, with its test): left out, 1 to 2 KB of what
  every visitor loads would be in nobody's figure. What to do when a page fails the check: load less on first load, load what only an interaction needs with `import()` (the cursor is not that: see above), or
  give the kit's modules a shared chunk once two pages draw them (measured since, and worse: see below).

**The shell and vendor chunks, and the builders of the tags** (from `3d49860`, where the markets route had made every page 650 to 830 bytes heavier and the
network page 1,505, to 149,533). A page's figure is the manifest, its code, and for each file the `import`/`export` lines that join it to the others and a gzip
context of its own. Rolldown makes one chunk for each set of pages that load a module, so each page that shares another part of the components or the kit
cuts the chunks finer for the pages already there: the markets route took the network page from 17 files to 20 (the kit's plot modules left its route
chunk for one it shares with the markets page, which imported `useHydrated` from `Plot.tsx`; `StatTile`, `Card` and `RelativeTime` left the chunks they
shared), and its figure grew 94 bytes of manifest, 252 of code (the markets page's builder in `meta.ts`, which every page loads, and the kit's exports
that the markets page uses) and 1,159 of file boundaries (273 of `import`/`export` lines, 886 of lost gzip context). Three changes:

- `scripts/shell-chunks.ts` (`vite.config.ts`, tested in `scripts/shell-chunks.test.ts`): what every page loads, the static closure of the client entry
  and the root route, in two files, `vendor` (the packages, the `node_modules` ids, and the bundler's virtual `\0` ids: React, React DOM, the router,
  `bignumber.js`) and `shell` (the rest, the repository's own: the root, the header and footer, the error screen, the search box, `format.ts`, …),
  where it came in nine. No page loads more code for it. The client entry's own module
  (the `hydrateRoot` call, 209 bytes) stays the entry's chunk, which no file imports, so hydration starts when React Router's bootstrap imports the
  entry, after the route modules, as before (were it in a chunk the routes import, it would run while they are imported). The plugin checks the bundle
  it has made, in every client build, a deploy's too: the vendor modules in one chunk named `vendor` and the shell's in one named `shell` (known by
  what they hold: a page's own `shell.tsx` may make another chunk of that name), and an entry chunk that holds the entry module alone, which no
  other chunk holds or imports, or the build fails; `pnpm check:bundle` reads the same two chunks in the route manifest (the root route imports both,
  the entry `vendor`). `vendor` changes with a dependency, or when the app uses more or less of one: it kept its name over the markets commit, where React's and the format chunk's did too and a one-file shell did not. (Since ruling R18, at the merge of E4, the two are one file, with the modules every page of the budget loads: see "One shell file" at the end of this section.) The
  build adds a runtime chunk (512 bytes) when chunks are grouped, as it did for the cursor's fallback; the figures count it. The dev server is untouched;
- the tags' builders, one module for each page (see "SEO and link previews"): 1.1 to 1.6 KB off each figure;
- the markets page's `useHydrated` from outside the kit (see "The kit's boundaries"): 3.3 KB off the markets page. It was measured with a copy of
  the line in the page; the hook is now the module `app/ui/use-hydrated.ts` that the kit imports too, which costs 7 bytes on the markets page, 22
  on the network page and 1 on the others against that copy (measured on `e310a4e` with the change, both ways).

| | `3d49860` | after | change | of it, the two chunks | of it, the builders | of it, `useHydrated` |
|---|---|---|---|---|---|---|
| home | 138,549 | 134,153 | -4,396 | -2,818 | -1,580 | 0 |
| ledger | 137,545 | 133,262 | -4,283 | -2,798 | -1,487 | 0 |
| transaction | 139,684 | 135,511 | -4,173 | -2,822 | -1,353 | 0 |
| account | 140,373 | 136,332 | -4,041 | -2,808 | -1,235 | 0 |
| network | 149,533 | 145,363 | -4,170 | -2,776 | -1,114 | -280 |
| markets | 140,502 | 132,995 | -7,507 | -2,773 | -1,370 | -3,364 |
| manifest | 1,120 | 1,028 | | | | |

The parts are measured one after the other in that order, with a harness that makes the same changes on `3d49860`; they add up to the change within
2 bytes. On `e310a4e` (the markets page's fixes and the pair page's component, which has no route yet), with the change, the check says: home
134,172, ledger 133,272, transaction 135,529, account 136,387, network 145,419, markets 133,001 (manifest 1,027). **The coming routes**, simulated: throwaway routes that import what each coming page's plan says it consumes (the pair page's candles, bar
list, inline bar, sparkline and live row; the analytics view's line, column, small multiples and table; the validators', amendments' and AMM pages'
meters, share bars, line and column charts, tabs, pagers and notices), each with a builder module of its own and 8 to 15 KB of its own code, added in
the order of the work (pair, analytics, validators, validator, amendments, amendment, AMM list, AMM pool):

| routes added | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| network, `3d49860` | 149,533 | **150,626** | 151,565 | 152,622 | 153,269 | 153,701 | 153,848 | 153,941 | 154,101 |
| network, after | 145,363 | 146,607 | 147,631 | 148,633 | 149,108 | 149,151 | 149,226 | 149,564 | 149,655 |
| heaviest other page, after | 136,332 | 145,254 (pair) | 146,314 | 146,839 | 147,020 | 147,063 | 147,138 | 147,458 | 147,549 (pair) |
| manifest, after | 1,028 | 1,154 | 1,299 | 1,405 | 1,515 | 1,558 | 1,633 | 1,693 | 1,784 |

The network page still grows about 940 bytes for each of the first four routes and 140 for each after: the manifest's 95, and the kit's modules,
which each chart page draws a different set of, cut into finer shared chunks (in its route chunk at 0 routes, six shared files at 4 and seven at 8,
which with `LiveRow`'s are the 8 files it gains). Its code grows 200 bytes in all (the kit's exports that the other pages use). The other pages grow
150 to 320 bytes a route. The simulated pages are models (their own code is generated), so a figure of theirs says where a page would stand, not
where the real page will. Measured and not taken (every page's figure at `3d49860` unless said):

- `output.experimentalMinChunkSize` (Rollup's): Rolldown rejects the key, and `codeSplitting.minSize` with no group changes nothing;
- the kit as one chunk: a group takes in what its modules import, so `DataTable`, `SectionError` and `format.ts` went into it and every page loaded
  it (home 147,120); without its imports (which needs `preserveEntrySignatures: "allow-extension"`), a page that draws only a meter or a sparkline
  loads all of it (markets 149,271, with the one-file shell);
- Rolldown's `entriesAware` groups with a merge threshold (500 to 64,000 bytes): heavier than the shell alone at 8 routes, for every threshold;
- the shared components and hooks as one chunk: every page 151 to 162 KB;
- `vendor` and `shell` as one file: 570 to 650 bytes less on every page, and that 123 KB file changes with every deploy that changes what a page
  imports of the shell (it did on the markets commit), where `vendor` changes with a dependency, or when the app uses more or less of one. A lever to keep;
- the modules every gated page loads (`DataTable`, `meta.ts`, …) in the shell: 410 to 450 bytes less on the gated pages, about 1.8 KB (that chunk)
  more on the search and not-found pages, and the rule would have to know the gate's pages;
- `routeDiscovery: { mode: "lazy" }`: the figures do not move. The build still writes `assets/manifest-*.js` and the check counts it; the browser would
  not load it first (the matched routes come in the HTML), but would ask `/__manifest` for the rest, the Worker invocations the setting avoids.

**The figures of E3**, as `pnpm check:bundle` prints them at the end of E3 (its end-to-end tests and README; gzip -9 bytes, each file once, the manifest
counted): the markets page (`routes/net.markets`) and the market pair page (`routes/net.markets.$base.$counter`) joined `PAGES`, and the gate is the one bar (ruling
R15: no `CursorSlot`; the spec's targets, markets 140,000 and pair 146,000, are not a gate, and the pair page is 780 bytes over its own).

| page | files | bytes |
|---|---|---|
| home | 16 | 134,507 |
| ledger | 17 | 133,832 |
| transaction | 18 | 136,085 |
| account | 17 | 137,267 |
| network | 16 | 146,852 |
| markets | 12 | 133,303 |
| market pair | 17 | 146,780 |
| manifest `assets/manifest-*.js` (in each) | | 1,152 |

The network page is 3,148 bytes under the gate and the pair page 3,220; E4, E5 and E6 add routes to the manifest (about 100 bytes each) and pages of their own.

**The analytics view's own copy of the kit** (E4: `scripts/analytics-kit-copy.ts`, registered in `vite.config.ts`, tested in
`scripts/analytics-kit-copy.test.ts` and `test/e2e/analytics-kit-copy.spec.ts`). The account page loads the analytics view
(`app/ui/pages/AccountAnalytics.tsx`) with `import()`, and the view draws with the kit, as the network page does. Left to Rolldown, the kit's
modules that both reach left the network route's chunk for files the two share: `LineChart-*.js` (the plot, the cursor, the line and column
charts, the table, the labels and words: 7,896 bytes gzipped), `use-hydrated-*.js` (1,680) and `StatTile-*.js` (401). Each such file costs its
gzip context and its `import`/`export` lines, on the network page (797 bytes, measured at `4d8f6ea` against a build without the analytics chunk)
and in the analytics view's total, which was 151,371 bytes (at `4d8f6ea`: the table's *Before* below; 151,275 with the frame's sources), over the
budget. So the view has a copy of the kit: what it imports of `app/ui/charts/*` (all but `types.ts`), `app/ui/use-hydrated.ts` and
`app/ui/components/StatTile.tsx`, and what those import of it in turn, resolves to the same file with the query `?analytics-kit`, another
module, which only the view's chunk reaches. **The build has two copies of the kit**: the one every other page loads, as before E4, and the
view's, inside `AccountAnalytics-*.js` (11,893 bytes, 3,322 without the copy).
The view's first load is the account page's files and that one chunk, and the network route has its kit in its own chunk again.

- **What a visitor pays for it.** The network page and the view do not share the kit any more, so a visitor who sees both downloads it twice:
  **8,517 bytes (about 8.5 KB) more on a first analytics view after the network page**, 9,211 more on the network page after an analytics view,
  and 2,081 more on the markets page after one (`use-hydrated` and `StatTile`). The usual way in, the account page and then its Analytics tab,
  downloads 1,406 bytes less: one file instead of four. (Each figure is the gzipped size of what the second page loads first and the first did
  not, with the copy and without it.)
- **Why two copies are safe.** A browser that has run both pages holds two instances of the kit's modules, and nothing joins them: no module of
  the kit keeps state of its own (no top-level `let` or `var`), and its React contexts (`Cursor.tsx`'s `TipSlotContext` and `HoverContext`) are
  provided and read by its own components alone (see "The kit's boundaries"), so every provider and consumer in the view is the copy's, and every
  one on the network page is the other copy's. `test/e2e/analytics-kit-copy.spec.ts` runs the two in one document (the network page, the view
  by a client-side navigation, then Back): the tooltip of each copy's plot is drawn in that plot's slot, and the panels of the balance history
  share one bucket.
- **The checks.** The plugin checks what it has made in every client build, a deploy's too, and fails the build otherwise, so that a renamed
  file cannot quietly bring the shared files back. On the module graph: the view is in the build, and so are `use-hydrated.ts` and
  `StatTile.tsx`; every module of the kit that the view loads is its copy, the chart kit's directory among them; nothing but the view and the
  copies imports a copy; the page that imports the view (`AccountPage.tsx`) loads none of the kit; a module of the kit creates a React context
  (finding none would be code the build could not read, and the next rule would pass whatever imports what); and no module outside the kit
  imports one of its modules that creates a React context. On the bundle: the view's chunk holds the copies and no other chunk does, it holds no module of the
  kit as it is, and no chunk it imports, directly or through another, holds one. `scripts/analytics-kit-copy.test.ts` runs the same check on
  the app's own sources (made into the module graph the build reads) and on made-up graphs and bundles, one for each way it fails.
- **The sources of the cards.** The seven routes the view's parts are made from are in the frame (`frame.sources`, made by
  `app/server/analytics-view.ts`, whose card builders read them too), where the view had a table of its own of the same paths (93 bytes of its
  total).

**The figures of E4** (`pnpm check:bundle`, gzip -9 bytes, each file once, the manifest included). *Before* is `007c6e2`, the view and its loader
without the copy (its client files are byte for byte those of `4d8f6ea`, where the view's total was measured with the same rule before the check
counted it); *after* is the copy of the kit and the frame's sources (`74a694b`; the commit of the gate changes no file of the build).

| | Before | After | Change |
|---|---:|---:|---:|
| home | 134,391 | 134,374 | −17 |
| ledger | 133,456 | 133,439 | −17 |
| transaction | 135,709 | 135,692 | −17 |
| account (gate 1; the spec's target is 138,500) | 137,978 | 137,906 | −72 |
| network | 146,993 | 146,210 | −783 |
| markets | 133,397 | 133,380 | −17 |
| account analytics (gate 2) | 151,371 (20 files) | **149,799** (17 files) | −1,572 |
| manifest `assets/manifest-*.js` | 1,074 | 1,057 | −17 |

The −17 of every page is the manifest: the network and account routes no longer import the kit's shared files, so their `imports` are shorter.
The network page is 14 bytes from where it is without any analytics chunk (146,196 at `4d8f6ea`), and 15 at the end of E4 (146,211, below). The view's
total is 201 bytes under the budget; a route adds about 21 bytes to it through the manifest (measured with an empty route). Of the spec's two rungs for a view over the
budget, the first (E2's cursor fallback) does not exist (it was measured and taken out at E2, see above), and the second (the account page's
list panels in a lazy chunk) was not taken; the copy of the kit was, with the frame's sources (R18). The view's total with the frame's sources
and without the copy is 151,275 (the table's *Before*, 151,371, has neither the sources nor the copy).

**At the end of E4** (`93bd856`, the fixes of the final review; the commit of this README after it changes no file of the build): home 134,392, ledger 133,457,
transaction 135,709, **account 138,035**, network 146,211, markets 133,400 and **account analytics 149,933**, 67 bytes under the budget. The account route grew
109 bytes with the views' tags (`c9f9e8b`: `ANALYTICS_META` in `app/domain/analytics-params.ts`, which `meta-account.ts` imports alone), and the view's total with
it, to 138,015 and 149,908. The final fixes added 18 to 21 bytes to every page but the network page, and 25 to the view's total: `Card`'s `busy` (the
table cards are `aria-busy` while their part has not come), which every page loads but the network page, whose 2 bytes are the manifest's (it names
`Card`'s file, whose hash changed).

**After the merge of E4** into `feat/explorer-pages` (E3's pair route and E4's view in one build; gzip -9 bytes, each file once, the manifest
included): home 134,709, ledger 133,997, transaction 136,250, account 138,828 (19 files), network 147,731, markets 133,698, market pair 147,445, and
**account analytics 150,734** (20 files), 734 bytes over the budget (manifest 1,188), as E4's final review projected (about 150.7 KB once E3's pair
route is in). The view takes the lever ruling R18 approved for that case.

**One shell file** (ruling R18: R17's two levers, which E4 measured as "E5a + E5b", for a page or the view over the budget at a merge).
`scripts/shell-chunks.ts` now puts what every page loads in one file, `shell`, where it was two (`vendor`, the packages, and `shell`, the app's
modules), and adds to it what the routes of all seven pages of the budget reach statically beyond that, the route modules excepted (`GATED_ROUTES`,
the routes of `PAGES`; after the merge of E4 that is `DataTable.tsx`, `use-live-rows.ts`, `motion.ts`, `app/server/meta.ts` and `app/og/types.ts`,
which were a chunk of their own that every page loaded). Each lever alone left the view over the budget, measured on the merge the same way: the one
file at 150,111, the pages' modules at 150,327. Both:

| | After the merge | One shell file, with the pages' modules | Change |
|---|---:|---:|---:|
| home | 134,709 (16 files) | 133,693 (14) | −1,016 |
| ledger | 133,997 (17) | 132,979 (15) | −1,018 |
| transaction | 136,250 (18) | 135,227 (16) | −1,023 |
| account | 138,828 (19) | 137,788 (17) | −1,040 |
| network | 147,731 (18) | 146,744 (16) | −987 |
| markets | 133,698 (13) | 132,758 (11) | −940 |
| market pair | 147,445 (18) | 146,445 (16) | −1,000 |
| account analytics (gate 2) | 150,734 (20) | **149,680** (18) | −1,054 |
| manifest `assets/manifest-*.js` (in each) | 1,188 | 1,154 | −34 |

The view is 320 bytes under the budget, and the network page 3,256. No page of the budget loads a module it did not load before. What it costs:

- **Cache reuse.** The shell is one file of 124,223 bytes (gzipped), where `vendor` was 116,430, the app's shell 6,760 and `DataTable`'s chunk
  1,862. A deploy that changes a module of the app's shell or one of the pages' modules changes the whole file, the packages with it; `vendor`
  changed only with a dependency, or when the app used more or less of one.
- **The pages outside the budget** load the pages' modules too: the search page 127,171 → 128,133 (+962) and the not-found page 125,504 →
  126,490 (+986).
- **The rule knows the pages of the budget.** A page added to `PAGES` is in it at once; a page of `PAGES` whose route the build does not have
  fails the build.

The checks of the plugin are the same rules over one file: `shellModules` throws when the client entry, the root route or the route of a page of
the budget is not in the module graph (a route's module, `?__react-router-build-client-route`, not its split chunks); `checkShellBundle` throws
unless every module of the shell is in one chunk, named `shell` (so a `vendor` chunk of the packages, or a chunk of the pages' modules, fails the
build), and the entry's chunk holds the entry module alone, which no chunk holds too or imports; `shellManifestProblems` (`pnpm check:bundle`)
fails a build whose root route does not import one `shell-*.js`, or imports a `vendor-*.js`, or whose entry does not import the shell. The
analytics view's copy of the kit passes its own checks as before: its chunk imports the shell, which holds no module of the kit.

**Two budgets** (ruling R19, the owner's, 2026-10-21: "Keep 150 KB for home, ledger, transaction and account; raise the limit to 160 KB for the network,
market pair, account analytics, validators, amendments and AMM pages"). `BUDGETS` in `scripts/bundle-budget.ts` has the two, and each page of `PAGES` names
its own: `lookup`, 150,000 bytes, for the home, ledger, transaction and account pages and the markets list (which the owner did not name: it keeps the
default); `dashboard`, 160,000 bytes, for the network, market pair, validators, validator, amendments and amendment pages and the analytics view
(`ANALYTICS_VIEW`). What is counted, and how, is as
above; the measures of R17 and R18 (one shell file with the pages' modules, the analytics view's copy of the kit) stay. At `7c77254`, the commit that made the two: home 133,693, ledger
132,979, transaction 135,227, account 137,788 and markets 132,758 against 150,000; network 146,744, market pair 146,445 and account analytics 149,680 against
160,000.

**The figures of E6** (the validators, validator, amendments and amendment pages; `pnpm build && pnpm check:bundle`, gzip -9 bytes as the check counts them, the
manifest included). *Before* is `b327802`, the commit E6 started from (rebuilt and measured again for this table: the same figures to the byte); *after* is the end of
E6. Besides its four routes E6 carries E4's chart-kit commits `89ef591` and `c15dba2`, cherry-picked (`extras`, the month axis and the value kind: about +400 bytes on the
network page), and the bundle fixes of `17c75eb` (`sharePercent` and `wholePercent` in `app/domain/percent.ts`, `queryOf` in `app/domain/query-of.ts`: modules the shell
does not load, 77 to 293 bytes off each page). For E6 the one bar is the budget, **150,000 bytes per page with the manifest counted**: E2's target of 145,000 and its
`CursorSlot` fallback do not apply (the fallback was measured heavier, above), and a page over the budget stops the work.

| | Before (`b327802`) | After | Change |
|---|---|---|---|
| home | 134,172 | 135,043 | +871 |
| ledger | 133,272 | 134,604 | +1,332 |
| transaction | 135,529 | 136,858 | +1,329 |
| account | 136,387 | 138,100 | +1,713 |
| network | 145,419 | **149,144** | +3,725 (856 under the budget) |
| markets | 133,001 | 134,086 | +1,085 |
| validators | | 148,656 | (1,344 under) |
| validator | | 148,545 | (1,455 under) |
| amendments | | 139,123 | |
| amendment | | 147,014 | |
| manifest, the check's `gzipSync` (no file name) | 1,027 | 1,488 | +461, 14 routes to 18 |
| manifest, `gzip -9 -c build/client/assets/manifest-*.js \| wc -c` | 1,053 | 1,516 | +463 |
| shared base (the 7 files every page loads, the manifest not counted) | 126,376 | 126,501 | +125 |
| the home figure less its route chunk and the manifest | 130,899 | 131,296 | +397 |

- **The manifest** grew 461 bytes for the four routes, about 115 a route, above E2's projection of 90 to 95: each lists the chunks it imports, and the four list 14 to
  21 (the network route 18, the ledger route 14). A route costs every page about 0.1 KB.
- **The shared base** (the entry, the runtime, `vendor`, the root, `shell`, the `/:net` layout and `DataTable`) grew 125 bytes: the shell chunk +123, `vendor` +4, the
  entry and the layout −1 each. Every helper only E6's pages use is out of it (`time-words.ts`, `percent.ts`, `query-of.ts`, `status-icons.tsx`, not `format.ts` or the header's `icons.tsx`;
  `test/unit/validators-bundle.test.ts` keeps the four pages' browser files off `app/server` and the address codec, and `charts-bundle.test.ts` the kit's imports to its
  allow-list).
- **The network page** grew 3,725 bytes over E6: the manifest's 461, E4's kit commits (about 400), the flag axis' labels (83), its five first-seen links (25, the last
  commit), and the rest the re-splitting of the kit's and the components' chunks each new route causes (Rolldown makes one chunk for each set of pages that load a module;
  "The shell and vendor chunks" above), close to the projection of 149,108 for four routes. It is the heaviest page, 856 bytes under the budget.
- **The other older pages** grew 871 to 1,713 bytes, of which 461 is the manifest and the rest the same re-splitting; none of them loads a module of E6's pages.
- **The four new pages** stand between 139,123 (the amendments list, with no chart) and 148,656 (the validators list: the share bar, the meter's geometry, the table, the
  filter form and its builder of hrefs).

**After the merge of E6** into `feat/explorer-pages` (E6's four routes beside E3's and E4's pages, on the one-file shell; gzip -9 bytes, each file once, the
manifest included), against R19's budgets:

| | Before (`7c77254`) | After | Change | Budget | Under it by |
|---|---:|---:|---:|---:|---:|
| home | 133,693 (14 files) | 134,448 (15) | +755 | 150,000 | 15,552 |
| ledger | 132,979 (15) | 133,972 (18) | +993 | 150,000 | 16,028 |
| transaction | 135,227 (16) | 136,215 (19) | +988 | 150,000 | 13,785 |
| account | 137,788 (17) | 139,082 (22) | +1,294 | 150,000 | 10,918 |
| markets | 132,758 (11) | 133,564 (13) | +806 | 150,000 | 16,436 |
| network | 146,744 (16) | 149,700 (24) | +2,956 | 160,000 | 10,300 |
| market pair | 146,445 (16) | 148,638 (25) | +2,193 | 160,000 | 11,362 |
| validators | | 148,246 (24) | | 160,000 | 11,754 |
| validator | | 148,324 (24) | | 160,000 | 11,676 |
| amendments | | 138,568 (17) | | 160,000 | 21,432 |
| amendment | | 146,928 (21) | | 160,000 | 13,072 |
| account analytics (gate 2) | 149,680 (18) | **151,255** (23) | +1,575 | 160,000 | 8,745 |
| manifest `assets/manifest-*.js` (in each) | 1,154 | 1,590 | +436 | | |

Every page grew by the manifest's 436 bytes (four routes) and the shell's 41 (E6's changes to modules every page loads); the rest is the re-splitting of
the modules E6's pages share with the others. The kit and the live hooks that the network and pair pages share with the validators pages left their
route chunks for files of their own (network: 9 shared files to 17, +3,017 bytes; its route chunk −538), and the components the account page shares
with them (`Amount`, `Pager`, `CopyButton`, `Notice`, `use-retry`, …) did the same (account: 10 shared files to 15, +730, and 87 bytes of `import`
lines in its route chunk). The analytics view grew with the account page, and its own chunk 281 bytes with E6's code in the kit it copies (the flag
axis, the lowest extreme, the page steps). Under the one budget of 150,000 the view was over by 1,255, and the merge waited for R19. Measured on a trial
of this merge and not taken: a copy of the kit for E6's four pages, as R18's for the view (network 147,929, pair 147,532, the four pages
0.3 to 1.1 KB lighter, the view 151,201: the view's growth is the components'), and the account page's list panels in a chunk of their own, with
`DataTable` kept in the shell (account 136,579, the view 148,752, the lists' view 139,788, every other page as here).

## The parsing libraries in the Workers runtime

`test/worker/runtime.spec.ts` runs `ripple-lib-transactionparser` 0.8.2, `ripple-address-codec` 5 and
`bignumber.js` in workerd. All three load and give the right answers, so `app/domain/parse/` can use
`ripple-lib-transactionparser` (spec 1.1). The same calls, bundled by `react-router build` and run with
`vite preview`, returned the same balance changes as Node did for that AMMDeposit.

One thing the test setup needs: `ripple-address-codec` is CommonJS and `require()`s `@scure/base`, an ES module,
which Vitest's module runner in workerd cannot do (`Cannot read properties of undefined (reading 'base58xrp')`).
`vitest.config.ts` therefore lists it under `deps.optimizer.ssr`, so Vite pre-bundles it for the `worker` project,
as the production build bundles it. Any new CommonJS dependency that fails to load in a `worker` test the same way
goes in that list. `ripple-lib-transactionparser` cannot go in it: it `require`s Node's `assert`, which the
optimizer does not resolve, and it loads without it.

## The pipeline and deploying

There is no CI configuration in this repository: which system runs the pipeline is still to be decided (spec 13). The pipeline is these
steps, in this order, and a system that runs them is a pipeline. The explorer depends on no private package, so it needs no npm token.

```sh
pnpm install --frozen-lockfile     # the lockfile as it is; fails if package.json disagrees (the postinstall hook runs wrangler types)
pnpm verify                        # api:check, typecheck (wrangler types, react-router typegen, tsc -b), test (unit, components, loaders in workerd),
                                   # build, check:bundle
E2E_SKIP_BUILD=1 pnpm test:e2e     # the end-to-end suite on the build verify has just made (needs a Chromium: pnpm exec playwright install chromium)
pnpm deploy:staging                # CLOUDFLARE_ENV=staging react-router build && tsx scripts/predeploy-check.ts staging && wrangler deploy
# ...the rollout below...
pnpm deploy:production             # CLOUDFLARE_ENV=production react-router build && tsx scripts/predeploy-check.ts production && wrangler deploy
```

**`wrangler deploy --env <env>` and the Cloudflare Vite plugin.** The environment is chosen when the Worker is *built*, not when it is deployed:
the plugin writes `build/server/wrangler.json` for the environment `CLOUDFLARE_ENV` names (its name, vars and rate-limit namespace flattened to the top level;
`staging` is the Worker `x-explorer-staging`, `production` is `x-explorer-production`) and a redirect in `.wrangler/deploy/config.json` that `wrangler deploy`
follows. So the deploy scripts build with `CLOUDFLARE_ENV` and run a plain `wrangler deploy`, which is what spec 13's `wrangler deploy --env <env>`
comes to here. Checked with `wrangler deploy --dry-run`: after a `CLOUDFLARE_ENV=staging` build, `--env staging` is accepted and `--env production` is an
error ("does not match the target environment"); after a build with no `CLOUDFLARE_ENV`, `--env staging` is accepted without a warning and **selects nothing**: the generated file is
named `x-explorer` and holds the vars of local development, and it has no environment for the flag to pick. So never build without `CLOUDFLARE_ENV` and deploy; use the scripts.
A build for an environment also needs a commit to name it (`BUILD_ID`, see "Configuration"): the edge cache key includes it, with the switches ("Switches"). The deploy builds
again for its environment: the code is the commit `verify` and the end-to-end suite looked at, the vars and the rate-limit namespace are the environment's.
`wrangler deploy` needs `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID`) in the pipeline's secrets.

**The pre-deploy guard** (`scripts/predeploy-check.ts <staging|production>`, logic in `scripts/predeploy-guard.ts`, tests in
`scripts/predeploy-check.test.ts` over fake configs; nothing in them deploys) runs between the build and `wrangler deploy`, chained with `&&`, so
its exit code stops the deploy. It reads the config the plugin wrote (`build/server/wrangler.json`) and exits 1, printing every reason, when:

- an upstream var (`XRPL_DATA_API_URL`, `XAHAU_DATA_API_URL`, `XRPL_NODE_URL`, `XAHAU_NODE_URL`) is a placeholder (a host under `.invalid`, which is what
  `wrangler.jsonc` holds until the hosts are decided: a Worker deployed with them answers every page with a 503), is not an `https` URL, or is missing;
- a switch (`VALIDATORS`, `AMM_DATA`, `MARKETS`, `ACCOUNT_ANALYTICS`, `AMM_PAGES`; the list is `FEATURE_VARS` in `app/ui/features.ts`) is missing from the build's vars, or its value is not exactly `"on"` or `"off"`, or a var
  that is not a switch has the value `"on"` or `"off"` (a misspelt switch, such as `MARKET`: see "Switches");
- `AMM_PAGES` is `"on"` while `AMM_DATA` is not (`AMM_PAGES is on but AMM_DATA is off: the AMM pages need the AMM data`): the pool pages are all AMM data;
- the build is not for the environment asked for, or for none (a build without `CLOUDFLARE_ENV` is the top level, local development);
- `workers_dev` or `preview_urls` is not `false` in the build, so that the Worker would be reachable on `*.workers.dev`;
- `.wrangler/deploy/config.json`, the redirect `wrangler deploy` follows, is missing or does not lead to that very file (it would then deploy
  `wrangler.jsonc`'s top level instead).

It fails closed: a build that is missing, unreadable or not an object is a refusal. It always runs when it is run, however it was reached (a link
included). It **cannot check secrets**, which are not in the build: set `DATA_API_KEY` with `wrangler secret put` (below) before the environment takes
traffic, or the data API refuses every call and every page is a 503.

**Hosts and routes.** `staging` and `production` are not served from `*.workers.dev` (`"workers_dev": false` and `"preview_urls": false` in each): the
Cache API does nothing there, so every request would render and call the data API (only the per-address limiter would protect the key's quota), and
the Worker would be a second copy of the site that names itself in its canonical links. The environments have **no routes yet**, because the hosts are
not named. When they are, before the first deploy of an environment, put its real hosts in its `vars` and add to it

```jsonc
"routes": [{ "pattern": "<host>", "custom_domain": true }]
```

(`custom_domain` makes Cloudflare create the DNS record and certificate for the host). Until then a deploy is refused by the guard, because the hosts
are placeholders, which is the intent.

**Secrets**, once per Worker and again when one changes (they are not in the repository, `wrangler.jsonc` or the build; the guard cannot see them):

```sh
pnpm exec wrangler secret put DATA_API_KEY --env staging      # the key listed in the data API's GH_RATE_LIMIT_KEYS
pnpm exec wrangler secret put SENTRY_DSN --env staging        # optional: Sentry stays off without it
pnpm exec wrangler secret put DATA_API_KEY --env production
pnpm exec wrangler secret put SENTRY_DSN --env production     # optional
```

The data API hosts in `wrangler.jsonc` are placeholders (`*.example.invalid`) until the hosts are decided; the deployed Workers need the real ones
in the `vars` of each environment before the first deploy (the guard refuses a deploy with a placeholder).

**The plan.** The Workers **Paid** plan is required. The Free plan allows 10 ms of CPU per request: drawing a link-preview image (Satori and
resvg-wasm, `/og/...png`) and rendering a ledger with thousands of transactions (a page of 740 KB and more, parsed and described in the Worker)
need far more, and a request over the limit is cut off. Both are normal traffic here (every unfurled link asks for an image).

**Rollout** (spec 13):

1. `data-api-new` ships `GH_RATE_LIMIT_KEYS` and the explorer's key is issued.
2. Deploy to staging on its custom domain (the Cache API does not work on `*.workers.dev`), and run the end-to-end suite against the real staging API and
   node: either `E2E_DATA_API_URL=... E2E_NODE_URL=... E2E_DATA_API_KEY=... pnpm test:e2e` (the same Worker under `wrangler dev`, pointed at the staging
   stack) or `E2E_BASE_URL=https://staging.example.com E2E_WORKERS=1 pnpm test:e2e` (the deployed Worker itself). The suite catches drift in the
   response bodies the hand-written types in `app/server/api-types.ts` cannot see.
3. Production.

**Staging checklist.** Things that cannot be settled without a deployed Worker on a custom domain, carried from the reviews; go through them on
staging before production:

- [ ] **Hosts and routes** are in place (see "Hosts and routes" above), with the real data API hosts in the `vars`; `pnpm deploy:staging` passes the guard.
- [ ] **Secrets are set**: `wrangler secret put DATA_API_KEY --env staging` (and `SENTRY_DSN`, optional). The guard cannot see them. Without the key the
  data API refuses every call and every page is a 503.
- [ ] **The Cache API accepts the key host of the subrequest cache.** `createSubrequestCache` keys its entries on `https://subrequest-cache.invalid/<build>/<hash>`
  (`subrequestKey` in `app/server/edge-cache.ts`), a host that is not the zone's own, and the page tests run on the runtime's local Cache API, which accepts it.
  If the deployed one does not, a `put` fails, the failure is logged (`subrequest cache write failed`) and **the subrequest cache silently does nothing**: every
  page then calls the data API and the node for everything. Check with `wrangler tail --env staging --format json`: ask for two pages that share a call (a ledger,
  and the next one) and look for those lines, and in the data API's own log for the same ledger fetched twice within its TTL. If it fails, change the host of the key to
  the zone's (a path on the Worker's own host) and keep the rest.
- [ ] **IPv6 visitors.** `VISITOR_LIMITER` is keyed by `CF-Connecting-IP`, and one IPv6 visitor holds a whole /64 (or larger) of addresses, so the limit of 60 renders per
  10 s is easy to step around by rotating addresses within it. Follow-up: key an IPv6 address by its /64 prefix. Look at the limiter's rejections in the logs (`429`) with real
  traffic before deciding.
- [ ] **The edge cache can be filled through query strings.** Its key is the whole URL and the cache generation (the build ID and the switches), so every made-up query string (`?x=1`, `?x=2`, ...) on an
  existing page is a render, an upstream call and a stored copy of its own, kept as long as the page's class says (a year for an immutable ledger or transaction). Only an unknown `?tab=`, a `marker` where there are none, and an image's query are
  tidied into redirects. The visitor limit (renders per address) is the only brake. Watch the cache hit ratio and the data API's load on staging; if it matters, drop unknown
  parameters from the key, or redirect them away as the image route does.
- [ ] **Run the end-to-end suite against staging**: `E2E_BASE_URL=https://<staging host> E2E_WORKERS=1 pnpm test:e2e`, with `E2E_FEATURES_OFF` naming the switches that are off there (see "End-to-end tests"; the suite catches drift in
  the data API's response bodies that `app/server/api-types.ts` cannot see), and, once, `E2E_DATA_API_URL=... E2E_NODE_URL=... E2E_DATA_API_KEY=... pnpm test:e2e` against
  the staging stack.

- [ ] **The network page's views, against the staging stack.** Open `/xrpl/network` and `/xahau/network`, and each period (`?period=7d`, `90d`, `1y`) and `?in=usd` on XRPL: the
  window's words ("Totals and charts cover the 30 days from … to …, today so far") must be anchored to the staging stack's own `last_validated` and name the running day, and the volume
  card must say that day is not computed yet. The fixtures stand at Oct 17, 2026; staging does not. Every card has data or its own error, and the e2e suite's `network-page.spec.ts` passes with `E2E_FEATURES_OFF=ACCOUNT_ANALYTICS,AMM_DATA,MARKETS,VALIDATORS` while those switches are off there (a switch leaves the list once it is on: `ACCOUNT_ANALYTICS` with E4 §8 step 3, below).
- [ ] **The failure hold, in `wrangler tail`.** With one card failing (the data API refusing one route, or its key revoked for it), `wrangler tail --env staging --format json` should show one
  failing call per 5 s per Worker instance for the network page and for the home page, and not one per beat of every open tab (`holdFailure`, "The cache classes"); and the card comes back by itself within the hold and a beat
  when the route answers again.
- [ ] **The failure hold under a slow upstream, not a failing one.** Make one route slow instead of refusing it (for example by delaying it in a proxy in front of the staging data API, past its
  5 s limit, so that the call times out), open the network page in a few tabs, and watch `wrangler tail`: the calls to that route should be one for each hold cycle per Worker instance (about one every 10 s: the
  5 s the call takes, then the 5 s hold), and not one for every beat of every tab in the seconds the call is out (the probe, "The cache classes"). The card of that route says it could not be loaded after
  4.5 s and the rest of the page is there; the card comes back within a cycle of the route answering again.
- [ ] **The validations of the newest ledger, against the staging stack.** The validators card counts the validations of the newest ledger the page shows, and asks for them as soon as that ledger is the
  newest. Open `/xrpl/network` and `/xahau/network` right after a ledger closes and read the count: it should be about the size of the network's validator list (the fixtures say 35 and 25) when it is first
  asked for, and not a handful that grows over the next beats. If the data API has only some of a ledger's validations in the first seconds, the card shows a low count (kept 5 s, class `live`) until a later
  beat; write down for how long, and whether that needs a follow-up.
- [ ] **A switch flip is a miss at the edge.** Deploy the same commit with `AMM_DATA` `"on"` in the environment's `vars` (README, "Switches"): the first request for each view after the deploy is a miss (`X-Cache: MISS`: the cache
  generation is in the edge key), and the AMM series and legend entry appear on `/xrpl/network` within the edge's 3 s, with the DEX tile's wording in its `ok` form.
- [ ] **The bundle figure and the manifest.** `pnpm build && pnpm check:bundle` on the commit being deployed: every page is under its budget with the manifest counted (150,000 bytes for the lookup pages, 160,000 for the dashboards: ruling R19), and the manifest's
  size (`gzip -9 -c build/client/assets/manifest-*.js | wc -c`, 1,052 bytes at E2) and the network page's figure (147,640 with it, 146,616 without) are written down beside "The client bundle check", so that the growth of each later sub-project shows.
- [ ] **The markets pages' node calls, against the deployed nodes.** With `wrangler tail --env staging --format json`, open a pair page on each network (`/xrpl/markets/XRP/RLUSD.rMxCKb…`,
  `/xahau/markets/EVR.rEvernodee8dJLaFsujS6q1EiXvZYmHXr8/XAH`): `book_offers` accepts `limit: 60` and answers with the funded fields (`taker_gets_funded`,
  `taker_pays_funded`) on a partly funded offer, xahaud takes `{ "currency": "XAH" }` for its native side, and `amm_info` by `asset` and `asset2` answers for an XRPL pair that has a pool
  (and `actNotFound` for one that has none: no pool card, and nothing logged).
- [ ] **The node's call rate with pair pages open.** With a pair page open in a few tabs, `wrangler tail` shows about two `book_offers` per 2 s per watched pair per Worker
  instance (the two sides, kept 2 s), not two per beat of every tab; and with the node failing (a node URL that refuses, for a while), one failing call per side per 5 s per instance (the failure hold),
  the book saying "Live state unavailable" on a fresh load and an open page keeping the book it showed.
- [ ] **The markets page's age.** On `/xrpl/markets` (the 24 hours) the period's window is at most about 3.5 minutes old in the worst case (the set's minute, 60 s kept,
  60 s + 30 s at the edge), usually within about two, and on `?period=7d` and `30d` within about seven.
- [ ] **The HTML weight of `/xrpl/markets?period=30d`**, the biggest set (up to 1,000 rows in the page's data, 100 in its table): write down the size of the document and of its
  `.data` URL, gzipped and not, beside the ledger page's of a large ledger.
- [ ] **The AMM parts after `AMM_DATA` is turned on** (rollout step 7 of the markets spec): the Trades filter on both pages, the Via column, the AMM share tile and column (or "—" for
  a period whose answer has no `amm_share` yet), the pool card's share, and the intro's words about swaps, at once after the deploy; and the traders card of a pair with a pool does not
  list the pool account (`rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3` for XRP/RLUSD) and says so.
- [ ] **The bundle figures of the markets pages.** `pnpm check:bundle` on the commit being deployed: write the markets and market-pair figures down beside "The client bundle check",
  and check every page against its budget with the manifest (150,000 bytes for the lookup pages, 160,000 for the dashboards: ruling R19, which replaced R15's one bar; the spec's
  targets of 140,000 and 146,000 are not budgets).
- [ ] **The validators and amendments pages, against the staging stack** ("Validators and amendments"), once `VALIDATORS` is `"on"` for staging (D1 has served staging on
  both networks for two hours): `/xrpl/validators` and `/xahau/validators` in their views, a validator of each network (its validations follow the chain; Older and Newer),
  `/xrpl/amendments` and `/xahau/amendments`, an amendment of each (one with a majority where there is one), and the images of a validator and of an amendment
  (`/og/xrpl/validator/{key}.png`, `/og/xrpl/amendment/{name}.png`, 1200 × 630, class `slow`). Every card has data or its own error, and `validators.spec.ts`,
  `amendments.spec.ts` and the block of `a11y.spec.ts` pass against the staging stack (`E2E_DATA_API_URL=…`); before the switch is on, they pass with `VALIDATORS` in
  `E2E_FEATURES_OFF` (the off-case: the four pages are 404s, "All validators" is "soon").
- [ ] **The validators pages' failure hold, in `wrangler tail`.** With one of their cards failing (S, A or a validator's VV refused), `wrangler tail --env staging --format json`
  shows one failing call per 5 s per Worker instance for as long as the card fails, not one per beat of every open tab, and the card comes back by itself within the hold
  and a beat.
- [ ] **One L request per 10 s per instance, whatever the filters.** Open the validators list in several views at once (`?scope=all`, `?q=…`, `?publisher=…`, `?amendment=…`)
  in a few tabs: `wrangler tail` and the data API's log show `/v2/network/validators?limit=1000&scope=all` at most once per 10 s per Worker instance.
- [ ] **A page answered 503, not stored, against an API without D1.** A staging Worker with `VALIDATORS` `"on"` in front of a data API that has no D1 routes (before D1's
  deploy, or a stack without it): the validators list, a validator, the amendments list, an amendment and both images answer 503 (a `Cannot GET` is an outage), a second
  request is not an `X-Cache: HIT`, and the pages come right with no deploy of the explorer once D1 answers.
- [ ] **The size of a real majority amendment's page, against the staging stack.** Take an amendment with a majority (else the one with the most rounds) and measure its stored
  document gzipped (`curl -s --compressed -o page.html https://<staging host>/xrpl/amendments/{name}`, then `gzip -9 -c page.html | wc -c`) and the rows of its yes votes table
  ("changes only", the chart's Table view). The fixtures hold the yes votes between a few changes, as votes behave, and `amendment-page.spec.ts` pins their document under
  150,000 bytes; rounds whose count moves at every flag ledger make a row each (the 30-day fixture with a change every round was about 161 KB gzipped), and the table would then
  need a cap. Write both figures down.
- [ ] **The four bundle figures.** `pnpm build && pnpm check:bundle` on the commit being deployed: the validators, validator, amendments and amendment pages under their
  budget, a dashboard's 160,000 bytes (ruling R19), with the manifest counted (148,717, 148,504, 139,185 and 147,135 at E6; 148,246, 148,324, 138,568 and 146,928 after its
  merge), and the network page (149,154 at E6, 149,700 after its merge), written down beside "The client bundle check".

The account's analytics view (E4, "Account analytics") is checked on staging once D2 is live there and `ACCOUNT_ANALYTICS` is `"on"` in the `staging` block (a deploy:
E4 §8 step 3), and before it is turned on in production:

- [ ] **The four periods of a heavy account, against the staging stack.** Open the Analytics tab of a heavy account (an exchange's hot wallet) and of an ordinary one, on XRPL and
  Xahau, at `?tab=analytics`, `&period=90d`, `&period=1y` and `&period=all`. The period note must be anchored to the staging stack's own `last_validated` and name the running
  bucket; every tile and card has its data, its empty state or its own error, and no card but the counterparties' (below) says "Still working …"; tile 1 and the native
  panel of the balance history end at the header's balance. Write down how long each call takes (`wrangler tail --env staging --format json`) for the heavy account at
  1 year and All. Run `account-analytics.spec.ts` against staging without `ACCOUNT_ANALYTICS` in `E2E_FEATURES_OFF`: its structural test runs there.
- [ ] **The late-counterparties path.** On an account whose `analytics/counterparties` takes more than 4.5 s (D2 §13: 2 to 10 s for the heaviest, at 1 year and All; a cold
  60 s cache), the card says "Still working on the counterparties. Retry in a few seconds." and tile 4 "—" over "Still working on it", and the page is served with `no-store`.
  A Retry a few seconds later shows the card: the call went on under `waitUntil` (it ends within its 15 s) and its answer was kept 60 s, or the Retry joined the call still
  running. In `wrangler tail`, the Retry's render makes no counterparties call of its own: it finds the stored answer, or joins the running call on the same instance.
- [ ] **In-flight sharing and the failure hold, in `wrangler tail`.** Open one heavy account's slow view in a few tabs at once, on a cold cache: `wrangler tail` shows one call of each
  analytics key per Worker instance for the renders that overlap, not one per render (`shareInFlight`). Then with one analytics route failing (refused for the key, or a proxy in
  front of the staging data API answering 503 for it), one call of it per 5 s per instance however often the tabs Retry (`holdFailure`; a Retry within the hold is given the held
  failure), and the card back with the first Retry after the route answers again and the hold is over.
- [ ] **`robots.txt`.** `https://<staging host>/robots.txt` (the Worker's route, on the custom domain) has `Disallow: /*/account/*tab=analytics` beside the search and CSV rules, and a
  robots.txt tester (Google Search Console's report) reads `…/account/r…?tab=analytics&period=1y` and the other order of the query as disallowed, and `…/account/r…` as allowed.
- [ ] **Gate 2's figures.** `pnpm build && pnpm check:bundle` on the commit being deployed: the `account` row at or under 150,000 bytes (138,035 at the end of E4; the spec's
  target is 138,500) and the `account analytics` row (the view's total, gate 2) at or under 160,000, a dashboard's budget (ruling R19; 149,933 at the end of E4), both written down
  beside "The client bundle check" (its E4 table), so that the growth of each later sub-project shows. A route adds about 21 bytes to the view through the manifest.

**The API description.** `api/openapi.yaml` is a copy of `data-api-new/docs/openapi.yaml`. When the API changes, `pnpm api:sync` copies it from a local
checkout (`$DATA_API_REPO`, default `../data-api-new`) and regenerates `app/server/openapi.d.ts`; name the source commit it prints in the commit message.
The pipeline's `pnpm verify` runs `pnpm api:check`, which regenerates the types from the committed copy and fails if they differ.

**Fixtures** are copied, derived or synthetic, never invented without saying so: `test/fixtures/PROVENANCE.md` records, for every copied file, the source repository,
path and commit, and what was recorded, from where and when, and, for the synthetic aggregates, the generator, the seeds and the reference they follow; "Upstream
fixtures" says which of `test/fixtures/http/` is generated (`pnpm fixtures:sync`), derived or synthetic, and which was written by hand.
