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
| `pnpm fixtures:sync` | Write the generated upstream fixtures of `test/fixtures/http/` from the recorded ledgers (see "Upstream fixtures"); names files that no longer belong, never deletes |
| `pnpm fixtures:check` | Change nothing; fail when those files are not what the generator writes (`scripts/http-fixtures.test.ts` does the same inside `pnpm test`) |
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
| `data-api.ts`, `api-types.ts` | `createDataApi(net, env, cache)`: typed `/v2` calls with the `X-API-Key` header, a 5 s limit and no redirects. The answers' types are written by hand from the data API's `docs/api-reference.md`, because `api/openapi.yaml` has parameters but no response schemas. The endpoint paths are checked against the generated `openapi.d.ts`, so a path that leaves the API fails `pnpm typecheck`. `transaction(hash)` and `transactionBinary(hash)` (`binary=true`: `tx` and `meta` as hex) are the same path with and without that flag. |
| `node-rpc.ts` | `createNodeRpc(net, cache)`: JSON-RPC to rippled or xahaud (`tx`, `ledger`, `account_info`, `account_objects`, `server_state`), 3 s limit. Times the node counts from 2000-01-01 are returned as unix seconds. |
| `upstream.ts` | `UpstreamError` (`not_found`, `bad_request`, `rate_limited`, `server`, `timeout`, `network`; `status`, `retryAfter`) and the deadline both clients use. |
| `cache-class.ts` | The five cache classes with their TTLs and `Cache-Control` values, and the `SubrequestCache` interface both clients take. |
| `edge-cache.ts` | The page-level edge cache and visitor limit (`withEdgeCache`), the subrequest cache the clients take (`createSubrequestCache`), and what loaders and routes use to name a page's class (`cached`, `forwardCacheClass`, `cacheClassHeaders`). |
| `logging.ts` | The request id and the one log line per request (`withRequestLog`), and Sentry, loaded only for a Worker that has a `SENTRY_DSN` (`withSentryWhenConfigured`). |
| `clients.ts` | `clientsFor(context, net)`: the data API client and the node client of a network, over the request's subrequest cache. What a loader calls. |
| `network-route.ts` | `requireNetwork(context, params)` (the `:net` segment as a `Network`, or a 404 of class `short`), `publicNetwork(net)` (what may go to the browser: no URLs), `readNetworkCookie(header)`. |
| `loader-errors.ts` | `upstreamFailure(err, what)`: what a loader throws for a failed upstream call: 404 `short` for `not_found`/`bad_request`, 503 with `Retry-After` for the rest, anything else rethrown. |
| `capture.ts` | `handleLoaderError`, the `handleError` of `app/entry.server.tsx`: one log line per loader error and, with a `SENTRY_DSN`, Sentry. |
| `resolve.ts` | What a search input names: `resolveCtid(api, net, ctid)` (the hash at a CTID's place in its ledger, or the other network it belongs to, or `null`) and `findHash(api, node, hash)` (a transaction, a ledger, both or neither; the node is asked when the data API has neither). They return "nothing" for a thing that is not there and throw the `UpstreamError` of a failure, so a caller can tell a 404 from a 503. An answer that cannot be right is a failure too: a 200 for a hash without its `tx`, a ledger's list that is not a list, a hash in it that is not 64 hex digits (it goes into a redirect and a path). |
| `transaction-view.ts` | What the transaction page shows (`transactionPage`): worked out from a transaction of the data API (`txFromIndex`) or the node (`txFromNode`), the hashes of its ledger (`neighboursOf`) and the binary form (`binaryOf`). See "The transaction page". |

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
  `useNetwork()`) with the home page (`routes/net._index.tsx`), the ledger page (`routes/net.ledger.$id.tsx`), the transaction page
  (`routes/net.tx.$id.tsx`) and search (`routes/net.search.tsx`) under it, and `*` (`routes/not-found.tsx`). A page is a child of `routes/net.tsx` in `routes.ts`. Its loader gets the
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

## Home and ledger pages

`/{net}` (`routes/net._index.tsx`) and `/{net}/ledger/{index|hash}` (`routes/net.ledger.$id.tsx`) are children of the `/:net`
layout. Each loader asks the data API (and, for a ledger the index lacks, the node), hands the answers to a view builder in
`app/server/` and returns the result with `cached(...)`; the page component in `app/ui/pages/` only draws it. The browser never
gets a transaction's JSON, only what a row shows, so the parsing and summary code (`describe/`, `parse/`) stays in the Worker.

| | Loader | View builder | Page |
|---|---|---|---|
| Home | `last_validated`, `network/fees` (8) and `transactions` (8) side by side, then `ledgers/{latest}` for the supply | `homePage` (`home-view.ts`): tiles, ledger rows (counts and close times from the fees rows), transaction rows (`headlineAmount`), the hero's examples | `HomePage` |
| Ledger | `ledgers/{id}?expand=true` and `last_validated` side by side; the node's `ledger` when the index says not found | `ledgerPage` (`ledger-view.ts`): header, counts by type and result, fees (exact, as drops), accounts created, one row per transaction (`rowSentence` of `describe`), the raw header | `LedgerPage` |

- **Cache classes.** Home: `live-home`. Ledger: `immutable` unless its index is the newest validated one (then `live`); a ledger
  shown from the node is `short` with a 60 s TTL and the note "Not in the index yet, shown from the network"; a ledger neither
  has, and an id that is neither an index nor a hash, is a 404 of class `short`. A lower-case or mixed-case hash, and an index with
  leading zeros, are 302 redirects (class `immutable`) to the one URL an object has. Failures of the data API are 503s through
  `upstreamFailure`, so the edge serves a stale copy or its busy page; the node is asked only for "not found", never for an
  outage. A call a page cannot do without but the visitor did not ask for (the newest ledger, the home page's lists) goes through
  `upstreamOutage`, which makes even its "not found" a 503. Both loaders wait for all their side-by-side calls before they throw, so
  nothing is left running behind an answered request.
- **No deferred data.** An `immutable` page is stored for a year, so everything is loaded in the loader.
- **Ledger list.** Every transaction is in the loader data; the page shows the first 100 (`FIRST_ROWS`) and "Show all N" shows the
  rest without a request. The type filter works on the whole list: a button for each of the seven commonest types, "Other" for the
  rest. A ledger of 1,500 transactions is about 740 KB of HTML.
- **Ages.** The stored HTML carries close times (`17:01:12`, `at 17:01:12 UTC`), never an age: `RelativeTime` fills in "3 s ago" in
  the browser (one shared timer, none while the tab is hidden), because a page is stored for seconds or for a year.
- **Tables** (`DataTable`) scroll inside their card below their `minWidth`, which must be at least the sum of the tracks, the gaps
  and the padding of a row, or the rows' borders and hover end early.

## The transaction page

`/{net}/tx/{hash|ctid}` (`routes/net.tx.$id.tsx`) is a child of the `/:net` layout like the ledger page: the loader asks the clients, `app/server/transaction-view.ts` (`transactionPage`) works the page out, `cached(...)` names the class, and `app/ui/pages/TransactionPage.tsx` draws it
(with `Flow` for the money's way and `RawTabs` for the raw data). The page data holds the sentence (segments), the flow, the
details, the balance changes, the objects touched and the neighbours; the transaction's own JSON reaches the browser only as the
text of the raw tabs (`raw.tx`, `raw.meta`), so `describe/` and `parse/` stay in the Worker (`test/unit/transaction-bundle.test.ts`
fails if the page's files import them as values).

| Request | Answer | Class |
|---|---|---|
| a hash in upper case, found by the data API | the page; the transaction, `?binary=true` and `/v2/ledgers/{index}?transactions=true` (for the neighbours) are asked for | `immutable` |
| the same, and the binary call failed | the page, its Binary tab saying "The binary form could not be loaded just now." | `short` (30 s), never `immutable` |
| the same, and the ledger's list failed, was "not found", or does not hold the transaction at its place | 503 (`upstreamOutage`): a missing neighbour would be stored for a year | not stored |
| the data API says "not found" | the node's `tx`; a transaction in a validated ledger is shown with "Not in the index yet, shown from the network", **without** previous/next and Binary (they say they appear once it is indexed) | `short`, TTL 60 s |
| neither has it, or the node's answer is not validated | 404 with the search box and "Search on {other network}" (`/{other}/search?q={HASH}`) | `short` (30 s), `noindex` |
| any other failure of the data API (5xx, 429, timeout, a 200 without a usable transaction) | 503, the node is not asked | not stored |
| a hash in another case | 302 to the upper-case URL, nobody asked | `immutable` |
| a CTID of this network | 302 to `/{net}/tx/{HASH}` (`resolveCtid`); a CTID that names nothing, or of a network id that is neither XRPL's nor Xahau's, is a 404 | `immutable` redirect, `short` 404 |
| a CTID of the other network | 200: the page the search shows ("That CTID is on Xahau", with the link), nobody asked; `noindex, follow` | `short` |
| anything else (also `0x` + hash) | 404, nobody asked | `short` |

- **Position.** "transaction 12 of 66" uses the number the ledger page's `#` column shows (`TransactionIndex`, counted from 0), and
  Previous / Next are `#11` and `#13`. They link to `/{net}/tx/{HASH}` of the neighbours in the ledger's list, which has only
  hashes, so a link shows a position and no type. At either end of the ledger the link is shown disabled ("first in ledger").
- **Binary.** The API's hex is the serialization itself (it re-hashes to the transaction hash), so the Worker never encodes: the
  Binary tab shows the hex of the transaction (the blob the hash is taken over) and of its metadata.
- **Raw tabs without JavaScript.** All three panels are in the page, one under the other, each under a heading; once the script has
  run they become a tablist (real buttons, arrow keys, Home and End) with one panel and a Copy button. The server's markup and the
  first client render are the same, so nothing mismatches.
- **The sender's native change** in Balance changes is the whole change of its balance, fee included (the page says so; the fee has
  a row of its own). A change shows a plus sign in the success colour or a minus sign; the roles (sender, destination, AMM pool)
  are tags beside the account.
- **No age** is in the stored page (`RelativeTime` fills it in in the browser), and nothing is streamed.

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

## Tests

- `unit` project: `app/**/*.test.ts` (not under `app/ui`), `scripts/**/*.test.ts` and `test/unit/**/*.test.ts`, in Node.
  (`test/unit` is typechecked with `scripts/` by `tsconfig.node.json`, which has the Node types; `tsconfig.cloudflare.json`
  leaves it out. A test that reads files, such as the route scan and the token check, goes there. The same Node config also
  holds the few `app/` and `test/support/` files that `scripts/` and the Node tests import: `upstream-core.ts`, `fixture-server.ts`,
  `app/server/api-types.ts` and `app/domain/parse/types.ts`; `fixture-server.ts` is the one file `tsconfig.cloudflare.json` leaves out.)
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
  for `/`, the 404 pages, `/:net` (the home page now, so against the recorded upstream), the document shell and `robots.txt`. A 404 page is class `short`, so it is stored: a test
  that needs a cache miss asks for a path nobody else does. `upstream.spec.ts` tests the upstream mock (see "Upstream fixtures"). `home.spec.ts`, `ledger.spec.ts`, `search.spec.ts` and `transaction.spec.ts` ask for the pages
  through `pageClient` (`test/support/pages.ts`: the page, the HTML as text, anchors, table rows, the class and TTL the entry stored a
  page under); `resolve.spec.ts` calls `resolveCtid` and `findHash` with a data API client and a node client of its own. `transaction.spec.ts` covers the transaction page and its redirects, 404s, node fallback and 503s (failures first, one transaction per override); `app/server/transaction-view.test.ts` the view builder over recorded transactions; `test/unit/transaction-bundle.test.ts` and `transaction-css.test.ts` what the page may import and what its stylesheet must keep. The
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
`test/unit/http-fixtures.test.ts` checks the hand-written files against the recordings and against each other.

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
function `(req: Request) => Response`, a `Response` (cloned for every request), `null` (as if there were no fixture), or a JSON
body (a data API's, or a node's `result`). An unknown key throws. `dataApiError(status, message)` and `nodeError(code)` make
the servers' errors.

**In the end-to-end suite:** `startFixtureServer(port)` (`test/support/fixture-server.ts`, Node only, `port` 0 for any) serves the
same fixtures at `<url>/xrpl` and `<url>/xahau` (data API) and `<url>/xrpl-node` and `<url>/xahau-node` (JSON-RPC), so the two
networks differ in URL, and in the Worker's cache keys, even on one origin. It returns `{ url, requests, close() }`. A request
reaches a file only through names made of safe pieces (no `.`/`..`, `/`, `\`, `%`, `?`, `#` in a path segment, a node's subject
or its other parameters: `isSafePart` in `upstream-core.ts`), and the reader (`fileReader`) takes no path that resolves, or links,
outside `test/fixtures/http/`; either lock alone stops a request from reading another file.

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
