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
| `pnpm test` | `vitest run`: the `unit` project (Node) and the `worker` project (Workers runtime) |
| `pnpm test:e2e` | Playwright (set up in a later task) |
| `pnpm api:sync` | Copy the data API's OpenAPI document (`$DATA_API_REPO/docs/openapi.yaml`, default `../data-api-new`) to `api/openapi.yaml` and regenerate `app/server/openapi.d.ts`; name the source commit it prints in the commit message |
| `pnpm api:check` | Regenerate the types from the committed `api/openapi.yaml` and fail if `app/server/openapi.d.ts` differs (needs no `data-api-new`) |
| `pnpm deploy:staging`, `pnpm deploy:production` | Build for that Cloudflare environment, then `wrangler deploy` |
| `pnpm verify` | `api:check`, `typecheck`, `test`, `build` |

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
| `data-api.ts`, `api-types.ts` | `createDataApi(net, env, cache)`: typed `/v2` calls with the `X-API-Key` header, a 5 s limit and no redirects. The answers' types are written by hand from the data API's `docs/api-reference.md`, because `api/openapi.yaml` has parameters but no response schemas. The endpoint paths are checked against the generated `openapi.d.ts`, so a path that leaves the API fails `pnpm typecheck`. |
| `node-rpc.ts` | `createNodeRpc(net, cache)`: JSON-RPC to rippled or xahaud (`tx`, `ledger`, `account_info`, `account_objects`, `server_state`), 3 s limit. Times the node counts from 2000-01-01 are returned as unix seconds. |
| `upstream.ts` | `UpstreamError` (`not_found`, `bad_request`, `rate_limited`, `server`, `timeout`, `network`; `status`, `retryAfter`) and the deadline both clients use. |
| `cache-class.ts` | The five cache classes with their TTLs and `Cache-Control` values, and the `SubrequestCache` interface both clients take. |
| `edge-cache.ts` | The page-level edge cache and visitor limit (`withEdgeCache`), the subrequest cache the clients take (`createSubrequestCache`), and what loaders and routes use to name a page's class (`cached`, `forwardCacheClass`, `cacheClassHeaders`). |
| `logging.ts` | The request id and the one log line per request (`withRequestLog`), and Sentry, loaded only for a Worker that has a `SENTRY_DSN` (`withSentryWhenConfigured`). |
| `clients.ts` | `clientsFor(context, net)`: the data API client and the node client of a network, over the request's subrequest cache. What a loader calls. |
| `network-route.ts` | `requireNetwork(context, params)` (the `:net` segment as a `Network`, or a 404 of class `short`), `publicNetwork(net)` (what may go to the browser: no URLs), `readNetworkCookie(header)`. |
| `loader-errors.ts` | `upstreamFailure(err, what)`: what a loader throws for a failed upstream call: 404 `short` for `not_found`/`bad_request`, 503 with `Retry-After` for the rest, anything else rethrown. |
| `capture.ts` | `handleLoaderError`, the `handleError` of `app/entry.server.tsx`: one log line per loader error and, with a `SENTRY_DSN`, Sentry. |

## The Worker entry

`workers/app.ts` wraps React Router's request handler, outside in: Sentry (only with a `SENTRY_DSN`), the request id and
log line, the edge cache with the visitor limit, React Router.

- **Request id and log.** Every response has `X-Request-Id` (the request's `CF-Ray` when it has one, else a random id), and
  every request writes one line, `{ id, method, path, status, cache, ms }`. The path only: a query string can hold what a
  visitor typed.
- **`X-Cache`** is on every response: `HIT`, `MISS`, `STALE`, or `BYPASS` for requests that skip the cache (anything but GET, and
  the root `/` and its `/_.data`, a redirect that depends on a cookie).
- **Visitor limit.** On a miss only (a hit, and a stale copy being refreshed, cost nothing upstream), the Worker asks
  `VISITOR_LIMITER`, keyed by `CF-Connecting-IP`; over the limit the answer is a small 429 page with `Retry-After: 10` and
  nothing is rendered. Non-GET requests are always misses and are limited too (a HEAD renders the whole page). A limiter that
  throws lets the visitor through.
- **A failing render** (it throws, or answers 5xx) is replaced by the stored copy, whatever its age (stored copies live
  `max(edge TTL + 30 s, 24 h)`), with `X-Cache: STALE`; without one, a throw or a 503 becomes a small 503 page with
  `Retry-After: 30`. Both pages are `noindex` and self-contained until the design system has its own.
- **Errors are never stored**: 4xx, 5xx and 429, except a 404 of class `short`; nor an answer that sets a cookie.

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
  `useNetwork()`), and `*` (`routes/not-found.tsx`). A page is a child of `routes/net.tsx` in `routes.ts`. Its loader gets the
  network with `requireNetwork(context, params)` and the clients with `clientsFor(context, net)`, names its cache class with
  `cached(...)`, turns upstream failures into responses with `upstreamFailure(err, what)`, and its module exports
  `headers = forwardCacheClass` (see above; `test/unit/route-headers.test.ts` enforces it). A page with its own big search box
  (the home page) exports `handle = { heroSearch: true }` so the header leaves its box out. The header's Ledgers and
  Transactions links go to the ids `latest-ledgers` and `latest-transactions` (`app/ui/anchors.ts`) on the home page.
- **Errors.** `net.tsx` and `root.tsx` export an `ErrorBoundary` that shows `RouteErrorScreen` inside the page frame: a 404
  thrown by `cached`/`upstreamFailure`/`requireNetwork` becomes `NotFoundPage` ("We couldn't find {what} on {network}",
  with the search box and a way home), a 503 a try-again page, anything else a plain apology. `NotFoundPage` takes a
  `suggestion={{ href, label }}` for the "on the other network" link.
- **Search box.** `SearchBox` is a GET form to `/{net}/search` (`name="q"`). Hints appear as you type (`classify` from
  `app/domain/search.ts`, mapped by `app/ui/search-hints.ts`); that code and the address codec it pulls in are a separate
  chunk, fetched on first focus. `/` focuses the box except while another field has focus.
- **Amounts.** Always render through `Amount` (`formatAmount` and `formatCurrency`: exponent notation is written out, a
  40-hex currency becomes text or "LP token"). `Sentence` renders the segments of `describe()`.

## Tests

- `unit` project: `app/**/*.test.ts` (not under `app/ui`), `scripts/**/*.test.ts` and `test/unit/**/*.test.ts`, in Node.
  (`test/unit` is typechecked with `scripts/` by `tsconfig.node.json`, which has the Node types; `tsconfig.cloudflare.json`
  leaves it out. A test that reads files, such as the route scan and the token check, goes there.)
- `components` project: `app/ui/**/*.test.{ts,tsx}` in happy-dom, with Testing Library. Components that link or submit are
  rendered inside a data router (`createMemoryRouter` + `RouterProvider`).
- The projects do not read `vite.config.ts`, so `vitest.config.ts` gives each the `~/` alias (`app/`) itself;
  `app/domain/alias.test.ts` and `test/worker/alias.spec.ts` fail without it. The code of `app/` imports with relative
  paths.
- `worker` project: `test/worker/**/*.spec.ts`, in workerd on the real Worker (`workers/app.ts`, the React Router
  plugin and `wrangler.jsonc`; the vars, secrets and `BUILD_ID` are pinned in `vitest.config.ts`, so a developer's
  `.dev.vars` does not reach the tests; the `VISITOR_LIMITER` binding comes from `wrangler.jsonc`). Call
  the Worker with `exports.default.fetch(...)` and read bindings with `env`, both from `cloudflare:workers`. (`SELF`
  and `cloudflare:test`'s `env` still exist but are deprecated.)
  `edge-cache.spec.ts` calls `withEdgeCache` and `createSubrequestCache` directly (fake `render`, fake `waitUntil`, a fake clock
  for `Date` only, the runtime's own Cache API); `route-headers.spec.ts` runs `cached` and `forwardCacheClass` through React
  Router's own request handler on a hand-made server build, for a document and for its `.data` URL; `entry.spec.ts` calls the
  Worker through `exports.default.fetch` (id, log line, the real `VISITOR_LIMITER`, Sentry); `layout.spec.ts` asks the Worker
  for `/`, the 404 pages, `/:net`, the document shell and `robots.txt`. A 404 page is class `short`, so it is stored: a test
  that needs a cache miss asks for a path nobody else does.
- Recorded mainnet ledgers (XRPL, XRPL AMM cases, Xahau), copied from `data-api-new` and kept as `.json.gz`, are in
  `test/fixtures/ledgers/`; `test/fixtures/PROVENANCE.md` says where each directory came from. Tests read them with
  `loadTx(set, hash)` and `allTxs(set)` from `test/support/ledgers.ts` (Node `fs`, test-only; `tsconfig.cloudflare.json`
  has no `node` types on purpose, so `test/support/node-modules.d.ts` declares the two modules that file uses).
- Recorded transaction metadata for the runtime check is in `test/fixtures/runtime/`: the AMMDeposit
  `83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B` of ledger 107671558, from
  `data-api-new/packages/shared/test/fixtures/xrpl/recorded/107671558.json.gz`.

`@cloudflare/vitest-plugin` is the renamed `@cloudflare/vitest-pool-workers` (that package is deprecated and its
last release, 0.23.0, only accepts Vitest 4). The API and configuration are the same.

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

## Deploying

Not automated yet (no CI in this repository). A deploy is `pnpm deploy:staging` or `pnpm deploy:production`, with
the real data API hosts in `wrangler.jsonc` and `DATA_API_KEY` set as a secret on the Worker (`x-explorer-staging`,
`x-explorer-production`).
