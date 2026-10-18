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
| `pnpm check:bundle` | Look at the client build in `build/client`: fail when a page loads more than 150 KB of JavaScript (gzip), when the build holds code that belongs to the Worker alone, or when `_headers` is missing. See "The client bundle check" |
| `pnpm deploy:staging`, `pnpm deploy:production` | `CLOUDFLARE_ENV=<env> react-router build`, then `scripts/predeploy-check.ts <env>` (refuses a placeholder or non-https upstream URL, a build for another environment, a Worker reachable on workers.dev), then `wrangler deploy`: the environment is chosen by the build. See "The pipeline and deploying" |
| `pnpm verify` | `api:check`, `typecheck`, `test`, `build`, `check:bundle` |

Run one project or one file with `pnpm test --project worker` or `pnpm test app/server`. Do not put `--` after
`pnpm test`: pnpm hands it to Vitest, which then treats everything after it as literal arguments and runs
everything. `--project unit` alone ends with a 10 s wait and a "close timed out" notice, because the React Router
plugin of the other project keeps a file watcher open; a path filter does not.

## Configuration

`app/server/env.ts` is the type of the Worker's bindings (`Env`) and the one place that knows how React Router 8
hands them to loaders: `workers/app.ts` creates the load context with `createLoadContext(env, ctx)`, and loaders
read it with `getEnv(context)`, `getExecutionContext(context)` and `getSubrequestCache(context)` (one subrequest cache
per request, over the data centre's Cache API, built with `BUILD_ID`).

| Name | Kind | Where it is set |
|---|---|---|
| `XRPL_DATA_API_URL`, `XAHAU_DATA_API_URL` | var | `wrangler.jsonc`, per environment (placeholders for now) |
| `XRPL_NODE_URL`, `XAHAU_NODE_URL` | var | `wrangler.jsonc`, per environment (`https://s1.ripple.com:51234/`, `https://xahau.network/`) |
| `VISITOR_LIMITER` | `ratelimits` binding, 60 per 10 s | `wrangler.jsonc`, per environment (own namespace each) |
| `DATA_API_KEY` | secret | `.dev.vars` locally; on the deployed Workers `x-explorer-staging` and `x-explorer-production` as a secret |
| `SENTRY_DSN` | secret, optional | the same |
| `BUILD_ID` | var | added to every build by `vite.config.ts` (`scripts/build-id.ts`): the short git commit, plus `-dirty` when the tree has uncommitted changes. `BUILD_ID=... pnpm build` overrides it. Without git it is `dev`, but a build for a Cloudflare environment (`CLOUDFLARE_ENV`, so every deploy) fails instead, because the edge cache key includes it |

The Cloudflare Vite plugin flattens one Cloudflare environment into the build, chosen at build time with
`CLOUDFLARE_ENV` (`pnpm deploy:staging` and `pnpm deploy:production` set it). `vars` and `ratelimits` are not
inherited, so each environment repeats them. The top level of `wrangler.jsonc` is local development and the tests.

## The data API and the node

`app/server/` is Worker-only code that loaders call; the browser never imports it.

| File | |
|---|---|
| `networks.ts` | `xrpl` and `xahau`: name, native currency, CTID network id, and the data API and node URLs from `Env`. The only place that knows a network's URLs. |
| `data-api.ts`, `api-types.ts` | `createDataApi(net, env, cache)`: typed `/v2` calls with the `X-API-Key` header, a 5 s limit and no redirects. The answers' types are written by hand from the data API's `docs/api-reference.md`, because `api/openapi.yaml` has parameters but no response schemas. The endpoint paths are checked against the generated `openapi.d.ts`, so a path that leaves the API fails `pnpm typecheck`. `transaction(hash)` and `transactionBinary(hash)` (`binary=true`: `tx` and `meta` as hex, or as the stored JSON for a type the API's codec cannot serialize) are the same path with and without that flag. What the pages read of a transaction, of its binary form and of a ledger's list of hashes is checked **inside the load the subrequest cache runs** (`tx-shape.ts`): a 200 with the wrong content is an `UpstreamError` of kind `server` and is never stored, where an answer that came back whole would have been kept for a year. |
| `node-rpc.ts` | `createNodeRpc(net, cache)`: JSON-RPC to rippled or xahaud (`tx`, `ledger`, `account_info`, `account_objects`, `server_state`), 3 s limit. Times the node counts from 2000-01-01 are returned as unix seconds. |
| `upstream.ts` | `UpstreamError` (`not_found`, `bad_request`, `rate_limited`, `server`, `timeout`, `network`; `status`, `retryAfter`) and the deadline both clients use. |
| `cache-class.ts` | The five cache classes with their TTLs and `Cache-Control` values (the table under "The Worker entry"), `MARKER_PAGE_CLASS` (the class of a list page reached with a marker: `slow`, see "The account page"), and the `SubrequestCache` interface both clients take. |
| `edge-cache.ts` | The page-level edge cache and visitor limit (`withEdgeCache`), the subrequest cache the clients take (`createSubrequestCache`), and what loaders and routes use to name a page's class (`cached`, `forwardCacheClass`, `cacheClassHeaders`) or to say it is degraded (`DegradedMark`, `markDegraded` in `env.ts`). |
| `logging.ts` | The request id and the one log line per request (`withRequestLog`), and Sentry, loaded only for a Worker that has a `SENTRY_DSN` (`withSentryWhenConfigured`). |
| `clients.ts` | `clientsFor(context, net)`: the data API client and the node client of a network, over the request's subrequest cache. What a loader calls. |
| `network-route.ts` | `requireNetwork(context, params)` (the `:net` segment as a `Network`, or a 404 of class `short`), `publicNetwork(net)` (what may go to the browser: no URLs), `readNetworkCookie(header)`. |
| `loader-errors.ts` | `upstreamFailure(err, what, offer?)`: what a loader throws for a failed upstream call: 404 `short` for `not_found`/`bad_request` (with `offer`, a link such as "Search on Xahau", in its data when the caller has one), 503 with `Retry-After` for the rest, anything else rethrown. `upstreamOutage(err, what)` is the same with `not_found` and `bad_request` made 503s too, for what the visitor did not ask for and for a refusal of an id that is well formed. |
| `capture.ts` | `handleLoaderError`, the `handleError` of `app/entry.server.tsx`: one log line per loader error and, with a `SENTRY_DSN`, Sentry. |
| `resolve.ts` | What a search input names: `resolveCtid(api, net, ctid)` (the hash at a CTID's place in its ledger, or the other network it belongs to, or `null`) and `findHash(api, node, hash)` (a transaction, a ledger, both or neither; the node is asked when the data API has neither). They return "nothing" for a thing that is not there and throw the `UpstreamError` of a failure, so a caller can tell a 404 from a 503. An answer that cannot be right is a failure too: a 200 for a hash without its `tx`, a ledger's list that is not a list, a hash in it that is not 64 hex digits (it goes into a redirect and a path). |
| `tx-shape.ts` | The shape checks of a transaction, its binary form and a ledger's list of hashes (`checkIndexTransaction`, `checkBinaryAnswer`, `checkLedgerHashes`; `checkNodeTransaction` for the node's), which the data API client runs inside its cached loads. |
| `account-view.ts` | What the account page shows: the header (`accountHeader`: activation, flags, sequence, balance with the reserve from `server_state`, tokens, owned objects), the rows of each tab (`transactionRows`, `paymentRows`, `tradeRows`, `offerRows`, `objectRows`), the Newer and Older links (`pagingOf`), and what the index and the node say between them about whether the account exists (`existenceOf`). See "The account page". |
| `qr.ts` | A QR code encoder (byte mode, error correction level M, versions 1 to 9) and `qrPath`, the picture as the `d` of an SVG path. Imported by the account route only, so it is never in the browser bundle (`test/unit/account-bundle.test.ts`). |
| `marker.ts` | `isMarker`: what a marker of the data API's lists may look like (base64url, at most 512 characters), checked before one is sent or put in a link. |
| `transaction-view.ts` | What the transaction page shows (`transactionPage`): worked out from a transaction of the data API (`txFromIndex`) or the node (`txFromNode`), the hashes of its ledger (`neighboursOf`) and the binary form (`binaryOf`). See "The transaction page". |

## The Worker entry

`workers/app.ts` wraps React Router's request handler, outside in: Sentry (only with a `SENTRY_DSN`), the request id and
log line, the edge cache with the visitor limit, React Router.

- **Request id and log.** Every response has `X-Request-Id` (the request's `CF-Ray` when it has one, else a random id), and
  every request writes one line, `{ id, method, path, status, cache, ms }`. The path only: a query string can hold what a
  visitor typed.
- **`X-Cache`** is on every response: `HIT`, `MISS`, `STALE`, or `BYPASS` for requests that skip the cache (anything but GET and HEAD, and
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
| `live-home` | **1 s** | **2 s** | `max-age=0, must-revalidate` | the home page, and its three calls of the data API: `lastValidated()`, `fees(...)` and the first page of `transactions(...)` (no marker) |
| `live` | 5 s | 30 s | `max-age=0, must-revalidate` | the newest ledger, an account's live state and first pages; balances and orders |
| `slow` | 1 h | 0 | `max-age=300` | an account's creation, account images, a list page reached with a marker (`MARKER_PAGE_CLASS`) |
| `short` | 30 s | 0 | `max-age=0` | search pages, a 404 for a well-formed id |

- **`live-home` is 1 s + 2 s, not the 3 s + 30 s of spec 4, at the owner's request.** A ledger closes every 3-4 s and an open home page follows the chain (see "Live updates"), so a reload must never show a copy much older than one ledger: a copy up to 1 s old is served as it is, one 1-3 s old is served at once while one render refreshes it, and an older one is not served (the visitor waits for a render). A render that fails is still replaced by the stored copy, of any age (`max(edge TTL + 30 s, 24 h)`, see above). The browser's `Cache-Control` is unchanged.
- **The three calls use the class `live-home`** (edge TTL 1 s) and not a TTL override: one place says what "as fresh as the home page" is. `lastValidated` is read by the ledger page (its Next at the newest ledger) and by the image route too, and a second is fine there. Account lists, balances, orders, the node's calls and a list reached with a marker keep their classes. `test/worker/data-api.spec.ts` pins each call's class and, through the Worker's own subrequest cache, the `max-age` it stores.

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
`_routes` included, plus `BUILD_ID`). Every route with such a loader needs the export, and so does the root route when its
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
- **Live updates** (the home page; see "Live updates" below): `use-live-refresh.ts` (`useLiveRefresh`, the 4 s revalidation), `components/DataTable.tsx` with `live` (rows enter and slide: `use-live-rows.ts`, `motion.ts`), `components/LiveValue.tsx` (a figure that ticks in), `on-screen.ts` (what a page that is on screen hands back when a revalidation fails) and `revalidation.ts` (`onlyWhenParamsChange`, the `shouldRevalidate` of the `/:net` layout).

## Home and ledger pages

`/{net}` (`routes/net._index.tsx`) and `/{net}/ledger/{index|hash}` (`routes/net.ledger.$id.tsx`) are children of the `/:net`
layout. Each loader asks the data API (and, for a ledger the index lacks, the node), hands the answers to a view builder in
`app/server/` and returns the result with `cached(...)`; the page component in `app/ui/pages/` only draws it. The browser never
gets a transaction's JSON, only what a row shows, so the parsing and summary code (`describe/`, `parse/`) stays in the Worker.

| | Loader | View builder | Page |
|---|---|---|---|
| Home | `last_validated`, `network/fees` (8) and `transactions` (8) side by side (class `live-home`, 1 s), then `ledgers/{latest}` for the supply | `homePage` (`home-view.ts`): tiles, ledger rows (counts and close times from the fees rows), transaction rows (`headlineAmount`), the hero's examples | `HomePage` |
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

- **The refresh.** `useLiveRefresh` (`app/ui/use-live-refresh.ts`, used by the home route only) calls React Router's `useRevalidator().revalidate()` every 4 s (`LIVE_REFRESH_MS`) while `document.visibilityState` is `visible`. A hidden tab stops the timer and costs nothing; when it is shown again the data is asked for at once and the beat goes on from there. A beat is skipped while a revalidation is running (`revalidator.state`, and a flag of the hook's own for the instant before React has drawn that, because React Router *restarts* a revalidation that is asked for again) or a navigation is in progress. The timer and the `visibilitychange` listener are removed when the page is left. The hook only has effects, so the server's HTML and the first render in the browser are what they were (no hydration mismatch). The browser never calls the data API: the request is the explorer's own `.data` URL for the page's route alone, `/{net}.data?_routes=routes%2Fnet._index`, which the edge cache answers like a page (class `live-home`: a copy up to 3 s old at once, an older one after a render). A tab that is open costs one request per 4 s, which the visitor limit (60 uncached renders per 10 s per address) counts only when it misses the cache.
- **When a revalidation fails** (a 503 page, which React Router gives a loader as an `ErrorResponse`, or a network error). React Router 8.4 drops the route's data when its loader throws and shows the nearest error boundary in its place (`processRouteLoaderData`: `ResetLoaderDataSymbol`, then `findNearestBoundary`), and it fetches the data of all the routes that revalidate in **one** request, so a failure would also take the `/:net` layout's boundary, and with it the whole page frame. Two things keep the page instead of an error screen: the `/:net` layout (`net.tsx`) says `shouldRevalidate = onlyWhenParamsChange` (`app/ui/revalidation.ts`; its data is the network and the origin, which nothing a revalidation could change), so the request is for the page's route alone; and the home route has a `clientLoader` that runs the server's loader through `createOnScreen().reload` (`app/ui/on-screen.ts`) and, when it fails, hands back what the mounted page already shows (the component tells `show` in an effect and withdraws it when it unmounts). So: **the page stays as it was, its times keep counting up (`RelativeTime`), and the next beat tries again**; an answer that is older than the ledger on screen (the entry replaces a failing render with the stored copy of any age) is ignored as well. A *navigation* to the home page has nothing on screen to keep, so it gets the error screen as before; so does a failure with a redirect (a thrown 3xx `Response` is React Router's to follow). `app/ui/revalidation.test.tsx` shows both the error screen without these two and the kept page with them; `test/e2e/live-home.spec.ts` does it in the browser (the Worker's `.data` answers 503 for two beats, then works again).
- **What animates** when data changes in the browser: the rows of **Latest ledgers** (keyed by ledger index) and **Latest transactions** (keyed by hash), the four tiles (latest ledger, transactions per ledger, fees burned, total supply) and the notes under three of them, the hero's status line (the ledger, how long ago it closed) and the "Try" examples. Not the ages (`RelativeTime` ticks on its own), the card links, or a figure that says the same as before: each is a `LiveValue` whose `token` is the text it shows, so the supply tile, which keeps to whole units, moves only when a whole unit has burned.
- **How.** CSS animations and transitions and a little script; no animation library. *Rows* (`DataTable live`, `use-live-rows.ts`): after the first render a key that was not in the list before is `entering` (`.is-entering`: a fade and a slide from -8px, 400 ms after a 120 ms delay, and an accent-tinted highlight that fades out over 1.2 s); the rows that were there and are somewhere else now slide with FLIP (positions measured from the top of the table at the end of each commit, in `useLayoutEffect`; a moved row is put back with an inline `translateY` and no transition, a frame later released with `transform 420ms`, and the transition is taken off at `transitionend`). The row that falls off the bottom is simply gone. *Figures* (`LiveValue`): the new value is in a new element (keyed by its token) that comes up from 0.4em below with a fade and the same highlight (`.is-changed`, 360 ms). Movement is 600 ms at most and runs once, so nothing flashes more than three times a second. There is **no `aria-live`** on any of it: a screen reader is not told every four seconds.
- **Not on the first render** (the server's, the hydration), and not on a navigation: a switch to the other network's home remounts the page (`key` on `HomePage`), so it is a first render too. An update that brings the same ledger again moves nothing.
- **`prefers-reduced-motion: reduce`.** `base.css` still turns every animation and transition off (`!important` on `*`); `components.css` gives a new row and a changed figure one exception, the highlight alone (`animation: live-flash 1200ms !important`; a class beats `*` between two `!important`s): a colour fading out, once, with nothing moving. The script moves nothing either (`prefersReducedMotion()` is read when an update arrives, never while rendering): no inline transform or transition. The value still updates at once.
- **The highlight** is the network's `--accent` at 7% as a translucent colour (`color-mix(in srgb, var(--accent) 7%, transparent)`, fading to `transparent`), so it fades out on whatever is behind it. 7% is the most that leaves every text colour of the page (`--fg`, `--muted`, `--faint` and the link, in light, dark and the system's dark, on both accents) at WCAG AA (4.5:1): the Xahau accent in light mode is 4.51:1 on a surface tinted 8%. `test/unit/live-motion-css.test.ts` reads the percentage and computes the contrast with the tokens, as `tokens.test.ts` does.
- **Limits.** A slide that is interrupted by the next update (updates are 4 s apart and a slide is 0.4 s) restarts from where the rows would have been, not from where they were drawn. Row heights are fixed (`min-height: 46px`, one line), so positions recorded at the end of a commit are not made stale by a resize. The home page's initial JavaScript stays under the budget (see "The client bundle check").

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
JavaScript); Analytics is a disabled tab that says "soon". Lists are newest first, 20 a page, with Newer and Older.

| Request | Answer | Class |
|---|---|---|
| an X-address | 302 to the classic address, with `?tag=N` for its tag | `immutable` |
| an address that is not an account | 404 without a call, noindex | `short` |
| an unknown `?tab=`, or a `marker` on Offers or Objects (they have no pages) | 302 to the URL without it | `short` |
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

Spec 9. Every page's `meta` export is a thin call into `app/server/meta.ts`, pure functions over the page data and the origin
of the request (unit-tested in `app/server/meta.test.ts`; `meta` is part of the route module, so the browser runs them on a
client-side navigation: that file imports nothing heavy, and `test/unit/og-bundle.test.ts` pins it).

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

`/og/{net}/{tx|ledger|account}/{id}.png` (`routes/og.$net.$kind.$id[.png].tsx`): 1200 × 630, `image/png`, `X-Robots-Tag: noindex`.

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

A HEAD of an image is answered from the stored copy, or draws it once and stores it (see "The Worker entry"). The data comes through the same clients as the page: `describe` (title, result, sentence, flow) and `headlineAmount` for a transaction
(`transactionFacts` in `app/server/card-data.ts`; the balance changes, objects touched and raw JSON the page also works out are not),
`ledgerPage` for a ledger, `activationOf` and the native balance of `/balances` for an account. `card-data.ts` makes plain data of it
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
  no other route loads, and `test/unit/og-bundle.test.ts` checks that nothing of the renderer is named outside `app/og/render.ts`, that
  `app/server/meta.ts` (which the browser runs) cannot reach it, and, when a build exists, that `build/client` holds none of it.
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
  holds the few `app/` and `test/support/` files that `scripts/` and the Node tests import: `upstream-core.ts`, `fixture-server.ts`,
  `app/server/api-types.ts` and `app/domain/parse/types.ts`; `fixture-server.ts` is the one file `tsconfig.cloudflare.json` leaves out.
  `test/e2e/stack.ts`, which starts the end-to-end stack, is in that config too; the Playwright config and specs are `tsconfig.e2e.json`'s, with
  the DOM types their `page.evaluate` callbacks need, and `tsconfig.cloudflare.json` leaves `test/e2e` out.)
  `scripts/check-bundle.test.ts` runs the bundle check (`scripts/bundle-budget.ts`) over a fake build (the budget to the byte, each forbidden name,
  a missing file) and the command (`scripts/check-bundle.ts`) through a link to it; `scripts/e2e-env.test.ts` the switches of the end-to-end suite
  (URLs, the fixture server's port, the browser, the env file read back with wrangler's own loader, which console errors a test lets through); `test/unit/e2e-stack.test.ts`
  runs `test/e2e/stack.ts` over a stand-in root and a `wrangler` that fails; `test/unit/headers-file.test.ts` `public/_headers`;
  `scripts/predeploy-check.test.ts` the pre-deploy guard over fake build configs (placeholders, non-https URLs, another environment, workers.dev, the redirect), the
  command through a link, and that the deploy scripts run it between the build and `wrangler deploy` and the environments of `wrangler.jsonc` are not on workers.dev.
  **The commands run every time they are run**, however they were reached (`scripts/api-sync.ts`, `scripts/make-http-fixtures.ts`, `scripts/check-bundle.ts`,
  `scripts/predeploy-check.ts`, `test/e2e/stack.ts`): none decides whether it is "the script" by comparing the URL of its module with `process.argv[1]`, which differ
  through a link and once made a gate print nothing and pass (`pnpm api:check` among them). What a command shares with its tests is in a file of its own
  (`api-sync-core.ts`, `compare` in `http-fixtures.ts`, `bundle-budget.ts`, `predeploy-guard.ts`), and each is tested as a command through a link.
- `components` project: `app/ui/**/*.test.{ts,tsx}` in happy-dom, with Testing Library. Components that link or submit are
  rendered inside a data router (`createMemoryRouter` + `RouterProvider`).
- The live home page (see "Live updates") is tested in the `components` project with fake timers and a real data router, and in `unit`:
  `use-live-refresh.test.tsx` (every 4 s while visible, none while hidden, once on becoming visible, no overlap with a running revalidation or a
  navigation, cleanup on unmount and when the route is left, nothing on the server), `components/LiveMotion.test.tsx` (`DataTable live`: no
  animation on the first render, `is-entering` on new keys, a FLIP transform and transition on the others over a mocked layout, reduced motion, off
  by default; `LiveValue`: only a changed token animates), `pages/HomePage.test.tsx` ("when its data changes": new rows, changed and unchanged
  figures, reduced motion, no live region), `on-screen.test.ts` and `revalidation.test.tsx` (React Router's own behaviour for a failed
  revalidation, with and without what keeps the page), and `test/unit/live-motion-css.test.ts` (durations, one run, the highlight's contrast in both
  themes on both accents, what reduced motion leaves). The Worker specs pin `live-home` at 1 s + 2 s (`cache-class.test.ts`, `home.spec.ts`,
  `edge-cache.spec.ts`: fresh, stale at 1 s, inline after 3 s) and the three calls' class and stored `max-age` (`data-api.spec.ts`).
- The projects do not read `vite.config.ts`, so `vitest.config.ts` gives each the `~/` alias (`app/`) itself;
  `app/domain/alias.test.ts` and `test/worker/alias.spec.ts` fail without it. The code of `app/` imports with relative
  paths.
- The end-to-end suite is not part of `pnpm test`: it needs a browser and a running Worker, and has its own command (`pnpm test:e2e`, see
  "End-to-end tests"). `test/e2e/*.spec.ts` are Playwright's, not Vitest's.
- `worker` project: `test/worker/**/*.spec.ts`, in workerd on the real Worker (`workers/app.ts`, the React Router
  plugin and `wrangler.jsonc`; the vars, secrets and `BUILD_ID` are pinned in `vitest.config.ts`, so a developer's
  `.dev.vars` does not reach the tests; the `VISITOR_LIMITER` binding comes from `wrangler.jsonc`). Call
  the Worker with `exports.default.fetch(...)` and read bindings with `env`, both from `cloudflare:workers`. (`SELF`
  and `cloudflare:test`'s `env` still exist but are deprecated.)
  `edge-cache.spec.ts` calls `withEdgeCache` and `createSubrequestCache` directly (fake `render`, fake `waitUntil`, a fake clock
  for `Date` only, the runtime's own Cache API; the HEAD rules are there, and in `og.spec.ts` and `ledger.spec.ts` on the real Worker); `route-headers.spec.ts` runs `cached` and `forwardCacheClass` through React
  Router's own request handler on a hand-made server build, for a document and for its `.data` URL; `entry.spec.ts` calls the
  Worker through `exports.default.fetch` (id, log line, the real `VISITOR_LIMITER`, Sentry); `layout.spec.ts` asks the Worker
  for `/`, the 404 pages, `/:net` (the home page now, so against the recorded upstream), the document shell and `robots.txt`. A 404 page is class `short`, so it is stored: a test
  that needs a cache miss asks for a path nobody else does. `upstream.spec.ts` tests the upstream mock (see "Upstream fixtures"). `home.spec.ts`, `ledger.spec.ts`, `search.spec.ts` and `transaction.spec.ts` ask for the pages
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
rippled's from API v1), plus the accounts, which are written by hand.

| Path below `<net>/` | Holds | By |
|---|---|---|
| `data-api/last_validated.json` | the newest recorded ledger (XRPL 107721455, Xahau 26596843) | generator |
| `data-api/ledgers/<index>.json`, `...@transactions=true.json` | every recorded ledger, plain and with its hashes in ledger order | generator |
| `data-api/ledgers/<index>@expand=true&transactions=true.json` | in full: XRPL 107720688 (two accounts created) and 107721455; Xahau 26540187, 26540188 (the only consecutive ledgers of the recordings, for previous and next), 26596843 | generator |
| `data-api/transactions/<HASH>.json` | one per type the recordings looked for (the manifests' `found` and `cases`: XRPL 29, Xahau 7), the 8 newest, and every transaction an account list names | generator |
| `data-api/transactions/<HASH>@binary=true.json` | the same transactions with `tx` and `meta` as the hex of their serialization (`?binary=true`); every blob re-hashes to its transaction hash (`scripts/http-fixtures.test.ts`). Made with `ripple-binary-codec` (a devDependency of the generator and its tests, never imported by `app/` or `workers/`); Xahau with its recorded `server_definitions.json` (`test/fixtures/definitions/xahau/`, see `test/fixtures/PROVENANCE.md`) | generator |
| `data-api/transactions@descending=true&limit=8.json`, `data-api/network/fees@descending=true&limit=8.json` | the home page's lists | generator |
| `node/tx/<HASH>.json`, `node/ledger/<index>[@...].json` | the same transactions and the expanded ledgers, as the node answers (Ripple-epoch times) | generator |
| `ledger-hashes.json` | ledger hash to index, so that a ledger is stored once and found by either | generator |
| `data-api/accounts/<address>.json` and `/balances`, `/orders`, `/transactions@...`, `/payments@...`, `/exchanges@...` | an account's creation, live state and lists (see below) | by hand |
| `node/account_info/<address>.json`, `node/account_objects/<address>.json`, `node/server_state.json` | the node's view of the active accounts and the reserves | by hand |

A file is named by its request: the path after `/v2/`, then `@` and the query with its parameters sorted (`transactions=true&expand=true`
is `expand=true&transactions=true`); a node file by method, subject (the transaction, ledger or account asked for) and the other
parameters, the default `ledger_index=validated` left out. Data API files hold the response body, node files the whole JSON-RPC
answer (`{ "result": ... }`). Keys are sorted and a transaction is one line, so a change shows as a one-line diff. Anything
without a file is answered as the real server answers a thing that does not exist: the API's `404 { "result": "error",
"message": ... }` (`ledger not found`, `transaction not found`, `Account not found`, `account not found`, `Cannot GET ...`) and the
node's `txnNotFound`, `lgrNotFound`, `actNotFound` at HTTP 200. A data API request without `X-API-Key` is a 401. The key is
never in a fixture.

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
| `E2E_FIXTURE_PORT` | `E2E_PORT` + 2 | The fixture server's port, which the tests that move the chain on (`live-home.spec.ts`) ask to change its answers. Not with a real stack or a deployed Worker, which have no such server: those tests are skipped |
| `E2E_DATA_API_URL`, `E2E_NODE_URL` | unset: the fixture server | A real stack, e.g. `data-api-new`'s docker-compose or staging. **Both or neither.** `{net}` in either stands for the network's id: `https://{net}.data.example.com` is `https://xrpl.data.example.com` and `https://xahau.data.example.com`, and a URL without it is used for both networks. They become `XRPL_DATA_API_URL`, `XAHAU_DATA_API_URL`, `XRPL_NODE_URL` and `XAHAU_NODE_URL`. With the fixture server they are `<url>/xrpl`, `<url>/xahau`, `<url>/xrpl-node` and `<url>/xahau-node` |
| `E2E_DATA_API_KEY` | `e2e-fixture-key` (the fixtures take any) | The `X-API-Key` of a real data API; required with `E2E_DATA_API_URL` |
| `E2E_BASE_URL` | unset | Test a Worker that is already running (a deployed staging) and start nothing. The visitor limit then counts all the tests as one address (the edge sets `CF-Connecting-IP`): use `E2E_WORKERS=1` |
| `E2E_SKIP_BUILD` | unset | `1`: use `build/` as it is (the pipeline has just made it with `pnpm verify`). A build for a Cloudflare environment (what `pnpm deploy:staging` leaves) is refused |
| `E2E_WORKERS` | `4` | Parallel workers |
| `E2E_VERBOSE` | unset | `1`: let the Worker's and wrangler's log lines through (one per request) |
| `E2E_CHROMIUM` | unset | The path of a Chromium to use |
| `E2E_ALLOW_OLDER_CHROMIUM` | unset | `1`: in a pipeline (`CI` set), take an older Chromium when the wanted one is not installed. See "The browser" |

**Against a real stack** the suite reads recorded mainnet ledgers and transactions (final, so the same there as in the fixtures), which the
stack must have. What the fixtures hold by hand is not an account's today (`test/e2e/fixtures.ts` `LIVE`): the tests that read the account
files (their pages of four and two rows, a balance, an address nobody funded) are skipped when `E2E_DATA_API_URL` or `E2E_BASE_URL` is set.
It has not been run against a real stack from this repository.

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
| `account.spec.ts` | The tabs (Transactions, Payments, Trades, Offers, Objects; Analytics is not a link); Older and Newer on Transactions (four rows, two rows, four rows; the marker page shows no live state) and on Payments, which keep the tab; the balance, the token and the reserve |
| `network.spec.ts` | The switch goes to the other network's home, changes `data-net` and the title, writes the `net` cookie, and `/` then redirects to it; `/` without a cookie is XRPL; an unknown network is a 404 |
| `theme.spec.ts` | See below |
| `client-meta.spec.ts` | The path `test/worker/meta.spec.ts` cannot see: the `<title>`, canonical link, `og:*` and `twitter:card` after a client-side navigation (ledger → next ledger → a transaction → Back, in one document), the loss of the canonical link and the gain of `noindex` on a page behind a marker and their return, the network switch, and that moving between the routes asks for no `/__manifest` |
| `og.spec.ts` | For a transaction, a ledger and an account: `/og/...png` answers 200, `image/png`, the class's `Cache-Control`, `X-Robots-Tag: noindex`, the PNG signature and an IHDR of 1200 × 630; the page's `og:image` is that URL and a browser loads it at a natural size of 1200 × 630; no image for a missing transaction or an invalid id |
| `assets.spec.ts` | The stylesheet, scripts and font of a page carry `Cache-Control: public, max-age=31536000, immutable` from `public/_headers` (the local runtime applies it); a page and the favicon do not |
| `guard.spec.ts` | The check at the end of every test (above): it fails a test whose client-side navigation got a 503, whose route module or stylesheet is missing, or whose page threw in a `contextFor` context; it lets a 404 page through and honours `allowConsoleErrors`; a `contextFor` context has the test's visitor address and takes options |
| `live-home.spec.ts` | The `live` project of `playwright.config.ts`, which runs alone after the others (what the tests do to the fixture server would show in every page the Worker renders meanwhile; `--no-deps` runs it without them), one test at a time. The fixture server says the newest XRPL ledger is the one before the recordings' newest, the home page is opened, and the fixture server goes back to the recordings: the new ledger appears without a reload (the document is the same; the browser asked only the explorer's own `.data` URL for the page's route), the new rows have `.is-entering` and the rows that were there were sent back to slide (a `MutationObserver` of the page records it), the figures that changed ticked in, and the stylesheet's animations are the ones it names (`getComputedStyle`); under `reducedMotion: "reduce"` nothing is transformed and the animation is the highlight alone; nothing animates when the page is first opened; and when the Worker answers 503 for two beats the page is the page it was (no error screen) and goes on with the new data when the Worker answers again |
| `a11y.spec.ts` | See below |

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
`critical`; the failure message names the rule and the elements. The matrix: the home, ledger (Xahau 26540187), transaction, account and 404 pages
× a 1280 px desktop and a 375 px phone × four settings: light and dark by `prefers-color-scheme`, and dark and light chosen with the toggle
(against the opposite system theme; the spec checks the page really has that `color-scheme`). Twelve more pages (the other tabs of an account, a page
behind a marker, a never-activated account, a missing transaction, the search help, the newest ledger, the Xahau home and account, a ledger of 66
transactions) run in
the two system themes. A separate test runs axe's `landmark-unique` (a best practice, so outside the WCAG tags) on the main pages, and another the rules
about ARIA attributes with "needs review" results counted as failures (axe reports a name on an element that cannot have one that way, so the gate
above does not see it).

## The client bundle check

`scripts/check-bundle.ts` (`pnpm check:bundle`, the last step of `pnpm verify`) runs the check of `scripts/bundle-budget.ts` (tested in
`scripts/check-bundle.test.ts`) on `build/client` after the build and exits 1 when it finds a problem. The command always runs the check, however it
was reached (a link to it included): a gate that cannot tell whether it is being run must fail, not pass. It fails when:

- a page loads more than **150 KB** (150,000 bytes) of JavaScript, gzipped. A page is the home, ledger, transaction or account route; what it loads
  first is read from the build's client manifest (`assets/manifest-*.js`, `window.__reactRouterManifest`): the entry, the root route, the `/:net`
  layout and the page's route, with every chunk those import statically (the manifest's `imports` hold the whole closure). Chunks fetched with
  `import()` (the search box's classifier) are not in it. Each file counts once, at its `gzip -9` size. Sizes are in kilobytes of 1000 bytes. Today: home 132.5 KB, ledger 134.0,
  transaction 136.1, account 136.5; 150,000 bytes passes and 150,001 fails;
- any file of `build/client` that is text holds `workers-og`, `satori`, `resvg`, `AffectedNodes`, `TransactionType`, `FinalFields`, `ripple-binary` or
  the QR encoder's tables (the numbers of `ECC_CODEWORDS_PER_BLOCK` in `app/server/qr.ts`, which a minified bundle keeps and its names it does not).
  These are what the Worker uses to read a transaction, draw an image and encode a QR code; the browser gets data. Fonts and images are not read;
- `build/client/_headers` is missing or lacks the rule that keeps `/assets/*` for a year;
- the manifest or a file it names is missing.

It prints a table (page, files, bytes, KB, `ok` or `OVER`) and the problems.

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
A build for an environment also needs a commit to name it (`BUILD_ID`, see "Configuration"): the edge cache key includes it. The deploy builds
again for its environment: the code is the commit `verify` and the end-to-end suite looked at, the vars and the rate-limit namespace are the environment's.
`wrangler deploy` needs `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID`) in the pipeline's secrets.

**The pre-deploy guard** (`scripts/predeploy-check.ts <staging|production>`, logic in `scripts/predeploy-guard.ts`, tests in
`scripts/predeploy-check.test.ts` over fake configs; nothing in them deploys) runs between the build and `wrangler deploy`, chained with `&&`, so
its exit code stops the deploy. It reads the config the plugin wrote (`build/server/wrangler.json`) and exits 1, printing every reason, when:

- an upstream var (`XRPL_DATA_API_URL`, `XAHAU_DATA_API_URL`, `XRPL_NODE_URL`, `XAHAU_NODE_URL`) is a placeholder (a host under `.invalid`, which is what
  `wrangler.jsonc` holds until the hosts are decided: a Worker deployed with them answers every page with a 503), is not an `https` URL, or is missing;
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
- [ ] **The edge cache can be filled through query strings.** Its key is the whole URL and the build ID, so every made-up query string (`?x=1`, `?x=2`, ...) on an
  existing page is a render, an upstream call and a stored copy of its own, kept as long as the page's class says (a year for an immutable ledger or transaction). Only an unknown `?tab=`, a `marker` where there are none, and an image's query are
  tidied into redirects. The visitor limit (renders per address) is the only brake. Watch the cache hit ratio and the data API's load on staging; if it matters, drop unknown
  parameters from the key, or redirect them away as the image route does.
- [ ] **Run the end-to-end suite against staging**: `E2E_BASE_URL=https://<staging host> E2E_WORKERS=1 pnpm test:e2e` (see "End-to-end tests"; the suite catches drift in
  the data API's response bodies that `app/server/api-types.ts` cannot see), and, once, `E2E_DATA_API_URL=... E2E_NODE_URL=... E2E_DATA_API_KEY=... pnpm test:e2e` against
  the staging stack.

**The API description.** `api/openapi.yaml` is a copy of `data-api-new/docs/openapi.yaml`. When the API changes, `pnpm api:sync` copies it from a local
checkout (`$DATA_API_REPO`, default `../data-api-new`) and regenerates `app/server/openapi.d.ts`; name the source commit it prints in the commit message.
The pipeline's `pnpm verify` runs `pnpm api:check`, which regenerates the types from the committed copy and fails if they differ.

**Fixtures** are copied or derived, never invented without saying so: `test/fixtures/PROVENANCE.md` records, for every copied file, the source repository,
path and commit, and what was recorded, from where and when; "Upstream fixtures" says which of `test/fixtures/http/` is generated (`pnpm fixtures:sync`)
and which was written by hand.
