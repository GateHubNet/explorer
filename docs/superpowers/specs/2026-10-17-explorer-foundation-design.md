# Explorer foundation: design

Date: 2026-10-17. Status: proposed. Sub-project 1 of the public explorer program. Repository: `GateHubNet/x-explorer`.

## Context

The GateHub Data API (repository `GateHubNet/data-api-new`) indexes XRPL and Xahau into ClickHouse and serves the Ripple v2 endpoints (its `docs/api-reference.md`). Everything a block explorer shows from history is already there: ledgers, transactions, account history, payments, DEX trades and candles, rates, network fees and volumes, validations and stats. AMM data is being added there (its `docs/superpowers/specs/2026-10-17-amm-data-design.md`).

This program builds a **public explorer** on top of it, in the spirit of xrpscan or bithomp, for both networks. The explorer lives in this repository, `x-explorer`, and talks to the data API only over HTTP. It is split into five sub-projects, each with its own spec, plan and build:

| # | Sub-project | Depends on |
|---|---|---|
| 1 | **Foundation and core lookup** (this spec): the app, its Worker, the network switch, search, and the ledger, transaction and account pages | the data API as it is, plus its per-key rate limit (section 5) |
| 2 | Network dashboard | 1 |
| 3 | Markets and DEX | 1 |
| 4 | Account analytics | 1 |
| 5 | AMM pools | 1, and the AMM data work in `data-api-new` |

Sub-projects 2 to 4 only need sub-project 1, so their order is open.

**The approved mock** is the visual reference for every sub-project: an 11-board design canvas at <https://claude.ai/artifact/LgETuDtW2YoDqSc2GazWDj>, private to its owner. Its sources are kept next to this spec in `2026-10-17-explorer-mock/` (one `.dc.html` file per board plus `canvas.json`). Sample data in the mock is made up. The boards that belong to this sub-project are `Main` (home and search), `Ledger`, `Transaction`, `Account`, `TransactionMobile` and `LinkPreview`. `Network`, `Markets`, `MarketPair`, `Amm` and `AmmPool` belong to sub-projects 2, 3 and 5.

## Decisions (from the user)

| Topic | Decision |
|---|---|
| Audience | A public explorer for anyone: polished, fast, safe to expose. |
| Scope | Five sub-projects as above; this spec covers only the foundation and core lookup. |
| Stack | Open choice. Chosen: **React Router v7 in framework mode on Cloudflare Workers** (approach A over Astro islands and Hono + server JSX). |
| Rendering | Search engines and link previews matter: pages are rendered on the server. |
| Hosting | Cloudflare. |
| Repository | Its own repository, `~/github.com/GateHubNet/x-explorer`, not a package of the data API's workspace. |
| Live account state | The Worker reads it from the node over JSON-RPC. The data API is not extended for it. |
| Transaction parsing | The explorer's own code on top of `ripple-lib-transactionparser`; nothing is shared with or published from `data-api-new`. |
| Look | Neutral explorer with a small "by GateHub" credit, light and dark themes, one accent per network. The mock is approved. |

## Goals

- Pasting any ledger index, ledger hash, transaction hash, CTID, classic address or X-address lands on the right page of the right network.
- Pages arrive server-rendered with real content, a data-built title and description, and an Open Graph image, so a pasted link previews in Slack and X.
- Most page views are served from the edge cache; a traffic spike does not push the data API into 429s.
- Sub-projects 2 to 5 add routes, data sources and charts without reworking anything built here.

## Non-goals

- The network dashboard, markets, account analytics and AMM pages (sub-projects 2 to 5).
- Login, wallet connect, translations.
- Token names and logos, validator names (the API has no source for either).
- An order book, totals on the account tabs, a sitemap.
- Changes to the data API beyond the rate limit of section 5, which is specified and built in `data-api-new`.

## 1. Architecture

One Cloudflare Worker serves server-rendered pages, the loader data that client-side navigations fetch, and the Open Graph images. The repository is a single pnpm project.

```
x-explorer/
  app/routes/                     one module per URL: a loader (runs in the Worker) and the page
  app/server/                     Worker-only code, never sent to the browser
    networks.ts                   xrpl | xahau → data API base URL, node JSON-RPC URL, native currency, CTID network id
    data-api.ts                   typed /v2 client; types generated from api/openapi.yaml; key from the DATA_API_KEY secret
    node-rpc.ts                   JSON-RPC client: tx, ledger, account_info, account_objects, server_state (later book_offers, amm_info)
    edge-cache.ts                 Cloudflare Cache API wrapper: cache key and TTL class per response
  app/domain/                     pure code used by server and browser, no I/O
    search.ts                     classify a search input (section 6)
    ctid.ts                       encode and decode CTIDs
    parse/                        balance changes, AMM pool hops, objects touched, accounts created (section 1.1)
    describe/                     per-type summary sentence and flow (section 7.3)
    format.ts                     amounts, currency codes, dates
    results.ts                    plain-language text for result codes
  app/ui/                         the mock's design system (section 8): tokens, header, tables, pills, stat tiles
  app/og/                         Open Graph image rendering
  api/openapi.yaml                copy of the data API's OpenAPI document (section 12)
  scripts/api-sync.ts             refreshes that copy and the generated types
  test/fixtures/                  recorded mainnet transactions and API/node responses, with their provenance
  docs/superpowers/specs/         this spec and the mock
  vite.config.ts, wrangler.jsonc, package.json
```

Built with Vite and `@cloudflare/vite-plugin`, deployed with Wrangler.

**Boundaries**

- Pages never call the data API or the node. Only loaders do, and only through `app/server/*`.
- `app/domain` has no I/O, so search rules, parsing and transaction summaries are unit-tested on their own.
- `app/ui` takes data as props and never fetches.
- `app/server/networks.ts` is the only place that knows a network's URLs. Adding a network is one entry there.

### 1.1 Parsing transactions

`app/domain/parse/` turns a transaction's JSON and metadata into what the pages show:

- **Balance changes**: `parseBalanceChanges` of `ripple-lib-transactionparser`, per account and currency. The sender's native change is the full change of its balance, fee included, and the fee is shown on its own line. (The data API's `source_balance_changes` of a payment leave the fee out; the transaction page says which it shows.)
- **AMM pool hops**: an `AccountRoot` node whose fields include `AMMID` is a pool. Its change in each asset (the `AccountRoot` balance for the native asset, the trust line with the issuer for an issued one, sign flipped when the pool is the high account) gives what went into and out of the pool. LP-token lines (currency starting with `03`) are not reserves. These are the rules the data API's AMM parser uses, written down in its AMM design.
- **Objects touched**: the created, modified and deleted nodes of the metadata, by entry type.
- **Accounts created**: created `AccountRoot` nodes.

The first plan task proves `ripple-lib-transactionparser` bundles and runs in the Workers runtime; if it does not, `parse/` computes balance changes from the metadata itself and the reason is written down. The tests of section 12 pin the cases where the explorer's numbers are known to differ from the data API's rows.

## 2. URLs and routes

The network is the first path segment, so every link is unambiguous and every URL is its own cache key.

| Path | Page | Cache class | Indexable |
|---|---|---|---|
| `/` | redirect to `/{last network}` (cookie `net`, default `xrpl`) | never cached | no |
| `/{net}` | home | live | yes |
| `/{net}/ledger/{index\|hash}` | ledger | immutable (live for the newest ledger) | yes |
| `/{net}/tx/{hash}` | transaction | immutable | yes |
| `/{net}/tx/{ctid}` | redirect to `/{net}/tx/{hash}` | immutable | no |
| `/{net}/account/{address}` | account (`?tab=transactions\|payments\|trades\|offers\|objects`, `?marker=…`) | live; marker pages immutable | yes; marker pages `noindex, follow` |
| `/{net}/search?q=…` | resolves and redirects, or shows a choice or a not-found page | short | `noindex, follow` |
| `/og/{net}/{tx\|ledger\|account}/{id}.png` | Open Graph image | immutable (account: slow) | no |

`{net}` is `xrpl` or `xahau`; anything else is a 404. Switching network on a detail page goes to the other network's home. A hash in a URL is upper-cased by redirect, so each object has one canonical URL. Sub-projects 2 to 5 add `/{net}/network`, `/{net}/markets[/{base}/{counter}]`, `/{net}/account/{address}?tab=analytics` and `/{net}/amm[/{pool}]` without changing these.

## 3. Data sources

Loaders fetch in parallel. A part of a page that is slower than its header (an account's tab list) is returned as a deferred promise and streams in after the header renders.

| Page | Data API | Node |
|---|---|---|
| Home | `/v2/last_validated`; `/v2/ledgers/{latest}` (total supply); `/v2/network/fees?descending=true&limit=8` (the newest 8 ledgers with their transaction count, close time and fees burned: the ledger object of `/v2/ledgers` carries neither); `/v2/transactions?descending=true&limit=8` | none |
| Ledger | `/v2/ledgers/{id}?expand=true`. Counts by type and by result, and accounts created, are computed in the Worker from the transactions and their metadata. Next is disabled at `last_validated`. | fallback only (section 10) |
| Transaction | `/v2/transactions/{hash}`. Balance changes, pool hops and objects touched come from `parse/`; the summary from `describe/`. The previous and next transaction in the ledger come from `/v2/ledgers/{index}?transactions=true` (hashes only, cached immutable), so those links show positions, not types. | fallback only |
| Account | `/v2/accounts/{a}` (creation: parent, initial balance, inception); `/v2/accounts/{a}/balances`; `/v2/accounts/{a}/orders`; the active tab: `/transactions`, `/payments` or `/exchanges` with `descending=true&limit=20&marker=…` | `account_info` (sequence, flags, domain, regular key, owner count); `account_objects` (escrows, checks, payment channels, NFT pages, tickets); `server_state` (reserves, below) |

**CTIDs.** A CTID decodes to a ledger index, a transaction index and a network id (`app/domain/ctid.ts`). The Worker reads `/v2/ledgers/{index}?transactions=true`, takes the hash at that position and redirects to `/{net}/tx/{hash}`. A CTID whose network id belongs to the other network gets a page that offers the switch.

**Reserves.** The reserve shown on the account page is `base + owner_count × increment`, from `validated_ledger.reserve_base` and `reserve_inc` of the node's `server_state`, cached for 5 minutes, never hard-coded.

## 4. Caching

All responses go through `edge-cache.ts`, which uses the Cloudflare Cache API (`caches.default`). The cache key is the request URL plus the build ID, so a deploy invalidates every entry at once.

| Class | Used for | Edge TTL | Browser |
|---|---|---|---|
| immutable | validated ledgers and transactions, list pages reached with a marker (markers are stable under new data), their Open Graph images | 1 year | `max-age=60` for HTML, `max-age=31536000, immutable` for images |
| live | home, the newest ledger, the account header and live state, first pages of lists | 3 s (home) to 5 s (account), `stale-while-revalidate=30` | `max-age=0, must-revalidate` |
| slow | an account's creation info, account Open Graph images | 1 hour | `max-age=300` |
| short | search pages, a 404 for a well-formed id | 30 s | `max-age=0` |

Error responses (5xx, 429, timeouts) are never cached. Loader data for client-side navigation uses the same key and class as the HTML of that URL.

**Subrequest cache.** Data API and node responses are cached inside the Worker by request URL and body, with the class of what they return, so pages share data (the home page and a ledger page reuse a ledger header).

The Cache API does not work on `*.workers.dev` hosts, so staging runs on a custom domain too.

## 5. Rate limiting

Behind Cloudflare, every visitor's request reaches the data API from Cloudflare's shared egress addresses. The API counts `GH_RATE_LIMIT` requests (600) per client address and route per window, so the explorer would hit 429 under real traffic.

**Prerequisite in the data API.** `data-api-new` adds `GH_RATE_LIMIT_KEYS`: requests made with a listed key are counted per key, with that key's own limit, instead of per client address. It is specified and built there (`data-api-new/docs/superpowers/specs/2026-10-17-rate-limit-keys-design.md`). The explorer's `DATA_API_KEY` is a listed key.

**Visitors.** The Worker's rate-limiting binding (`ratelimits` in the Wrangler config) caps requests that miss the edge cache per visitor IP. It starts at 60 per 10 seconds; an over-limit visitor gets a 429 page with `Retry-After`. Cached responses are not limited.

**Node.** Only account pages and the fallbacks of section 10 call the node, and its answers are cached for 5 seconds (`server_state` for 5 minutes).

## 6. Search

`app/domain/search.ts` holds the rules. The browser uses them for instant hints; the Worker uses them to resolve `/{net}/search?q=…`.

| Input (trimmed) | Classified as | Resolution in the Worker |
|---|---|---|
| 1 to 10 digits | ledger index | redirect to `/{net}/ledger/{n}` |
| 64 hex digits | transaction or ledger hash | try `/v2/transactions/{h}`, then `/v2/ledgers/{h}`; redirect to the one that exists; if both exist, a page with both; if neither, the not-found flow of section 10 |
| `C` or `c` + 15 hex digits | CTID | section 3 |
| classic address with a valid checksum | account | redirect to `/{net}/account/{a}` |
| X-address | account and destination tag | redirect to the classic address with `?tag=…`, shown as a note on the page |
| anything else | no match | the help text of the mock |

Checksums and X-addresses use `ripple-address-codec`. Hints appear as you type without any network call. The form submits to `/{net}/search?q=…`, so search works before JavaScript loads. `/` focuses the search box, except while another field has focus.

## 7. Pages

### 7.1 Shared behaviour

- **Network** comes from the URL. The accent colour, the native currency and the network pill follow it. The last network used is remembered in the `net` cookie, which only `/` reads.
- **Theme** follows `prefers-color-scheme`; a toggle overrides it and stores the choice in `localStorage`. An inline script in `<head>` applies it before first paint, so cached HTML is the same for everyone and nothing flashes.
- **Lists** are newest first, 20 per page, with Newer and Older buttons driven by the API's markers. No list shows a total in v1.
- **Values.** Amounts are the API's exact decimal strings with thousands separators, never floats; amounts the explorer computes itself use `bignumber.js`. A 40-hex currency code is shown as ASCII when it decodes to printable text, as "LP token" when it starts with `03`, otherwise as its first 8 hex digits. Times are UTC, with relative time beside them.
- **Statuses** are an icon plus text, never colour alone.

### 7.2 Page content

The mock boards are the layout reference. In short:

- **Home**: the search hero with examples, four tiles (latest ledger, transactions in it, fees burned, total supply), latest ledgers and latest transactions.
- **Ledger**: header fields, previous and next, success/failure bar, accounts created, filter by transaction type (client-side over the loaded transactions), the transaction table, the raw ledger header. The mock's DEX-trade count is dropped: counting offer crossings needs the full exchange parser.
- **Transaction**: type and result, the summary sentence and flow, details, balance changes, ledger objects touched, previous and next in the ledger, raw Transaction / Metadata / Binary.
- **Account**: address with copy and QR, activation, flags, sequence, last activity, balance with reserve, tokens, owned-object counts, tabs (Transactions, Payments with a CSV link, Trades, Offers, Objects). The Analytics tab shows as "soon" until sub-project 4. The counts on the mock's tabs are dropped (see Non-goals).

### 7.3 Transaction summaries

`describe/` maps a transaction (JSON and metadata, plus the output of `parse/`) to a sentence, a flow (sender → path → destination, where one applies) and the detail fields to show. It covers in v1:

- XRPL: Payment (direct, cross-currency, partial), OfferCreate, OfferCancel, TrustSet, AccountSet, AccountDelete, SetRegularKey, SignerListSet, EscrowCreate/Finish/Cancel, PaymentChannelCreate/Fund/Claim, CheckCreate/Cash/Cancel, TicketCreate, NFTokenMint/Burn/CreateOffer/CancelOffer/AcceptOffer, AMMCreate/Deposit/Withdraw/Vote/Bid/Delete.
- Xahau: ClaimReward, SetHook, Invoke, URITokenMint/Burn/Buy/CreateSellOffer/CancelSellOffer, Remit, Import.
- Any other type: "{account} submitted a {Type}" and a table of its fields.

A failed transaction reads "Tried to …" followed by the plain-language text of its result code (`results.ts`). Swaps through AMM pools in a payment's path are shown as a pool hop, from `parse/`.

## 8. Visual design

The mock defines the system; these are its tokens.

| Token | Light | Dark |
|---|---|---|
| page background | `#F5F6F8` | `#0B0E12` |
| surface | `#FFFFFF` | `#12161C` |
| sunken | `#EEF0F3` | `#181D24` |
| border / strong | `#E1E4E9` / `#CDD2D9` | `#232A33` / `#323B46` |
| text / muted / faint | `#0F1217` / `#4F5864` / `#646D7A` | `#E7EBF0` / `#A3ACB9` / `#8D97A5` |
| success text / background | `#17733F` / `#E3F3E9` | `#5BD08F` / `#10281B` |
| failure text / background | `#B42318` / `#FCEBE9` | `#F28B80` / `#30161A` |
| accent, XRPL | `#2F5BEA` | links: the accent mixed 55% with white |
| accent, Xahau | `#B45309` | links: the accent mixed 55% with white |

- **Type**: Geist for text and Geist Mono for hashes, addresses and amounts (tabular figures in columns), self-hosted from the build rather than loaded from Google Fonts.
- **Shape**: cards with a 1 px border and 12 px radius, 46 px table rows, 44 px minimum touch targets, 1240 px maximum content width, 20 px side gutter (16 px on phones).
- **Charts** (used from sub-project 2 on, defined here so every sub-project shares them): series colours, in this fixed order, `#2a78d6`, `#eb6834`, `#1baf7a`, `#eda100`, `#e87ba4` in light and `#3987e5`, `#d95926`, `#199e70`, `#c98500`, `#d55181` in dark, plus a neutral grey for "Other". Up/down is `#2a78d6`/`#e34948` (dark `#3987e5`/`#e66767`). Both sets passed the dataviz palette validator against the surfaces above in both modes. Three light-mode series are below 3:1 contrast, so a chart that uses them needs visible labels or a table view, as the mock's stacked chart has.
- **Phones**: tables scroll inside their card, the header collapses to logo, network pill, search and menu, as on the `TransactionMobile` board.

## 9. SEO and link previews

- Every indexable page has a `<title>` and meta description built from its data (e.g. "Payment of 1,250.00 USD from rJF2… to rNYb… · XRPL ledger 107,695,660"), a canonical URL, and Open Graph and Twitter card tags.
- `og:image` points to `/og/{net}/{kind}/{id}.png`, rendered at 1200 × 630 with Satori and resvg-wasm in the layout of the `LinkPreview` board, with the fonts bundled.
- Search and marker pages are `noindex, follow`; the 404 page is `noindex`. `robots.txt` allows everything else. No sitemap in v1.

## 10. Errors

| Case | Behaviour |
|---|---|
| The API has no such transaction or ledger | The Worker asks the node (`tx` or `ledger`). If the node has it validated, the page renders from the node's data with the note "Not in the index yet, shown from the network", cached for 60 s so the indexed version takes over. This covers history before the backfill and the seconds before ingest. |
| Neither has it | 404 page with the search box and what was searched. Cached 30 s. |
| The address was never funded | 404 page "This address has never been activated". |
| The account was deleted | History renders with a "Deleted" banner (the API knows the account; the node answers `actNotFound`). |
| The API answers 429 or 5xx, or times out (5 s; node 3 s) | A stale cached copy if there is one; else a 503 page with `Retry-After`. |
| One section of a page fails | The rest renders; that section says "Couldn't load … Retry", and Retry refetches it in the browser. |
| The node is down on an account page | History renders; the live sections say "Live state unavailable". |

The Worker logs each request with a request ID to Workers observability. Sentry (`@sentry/cloudflare`) is wired in and off unless `SENTRY_DSN` is set.

## 11. Configuration

Wrangler environments `staging` and `production`, each with:

| Name | Kind | Example |
|---|---|---|
| `XRPL_DATA_API_URL`, `XAHAU_DATA_API_URL` | variable | `https://xrpl.data.<domain>`, `https://xahau.data.<domain>` |
| `XRPL_NODE_URL`, `XAHAU_NODE_URL` | variable | default public JSON-RPC nodes (`https://s1.ripple.com:51234/`, `https://xahau.network/`), replaced by GateHub's nodes when they are reachable over HTTPS |
| `DATA_API_KEY` | secret | the key listed in the API's `GH_RATE_LIMIT_KEYS` |
| `SENTRY_DSN` | secret, optional | empty |
| visitor limit | `ratelimits` binding | 60 per 10 s |

The product name is a placeholder ("explorer") held in one constant, and the hosts are `explorer-staging.<domain>` and `explorer.<domain>` until named.

## 12. Testing

- **Unit (Vitest)**: `search`, `ctid`, `format`, `results`, `parse/` and `describe/`. The `parse/` and `describe/` tests are snapshot tests over real mainnet transactions in `test/fixtures/tx/`, copied from `data-api-new/packages/shared/test/fixtures/xrpl/recorded`; `test/fixtures/PROVENANCE.md` records the source repository, path and commit of every copied file. A covered type with no recording, Xahau's included, is recorded with `data-api-new`'s `record-fixtures --txs` and copied in the same way. The `parse/` tests also pin where the explorer's balance changes differ from the data API's rows (the fee, at least).
- **Loaders (`@cloudflare/vitest-pool-workers`)**: run in the Workers runtime against recorded API and node responses in `test/fixtures/http/`. They cover every route's cache class and headers, CTID resolution, the 64-hex disambiguation, the node fallback and each error row of section 10.
- **End to end (Playwright)**: against `wrangler dev`, by default with the data API and the node replaced by a small fixture server that serves `test/fixtures/http/`. Setting `E2E_DATA_API_URL` and `E2E_NODE_URL` runs the same suite against a running `data-api-new` stack (its docker-compose) or staging. Flows: search to a transaction, ledger previous and next, account tabs and paging, the network switch, theme toggle without a flash, an Open Graph image renders, and an axe accessibility check on every page.
- **The API description**: `api/openapi.yaml` is a copy of `data-api-new/docs/openapi.yaml`. `pnpm api:sync` copies it from a local checkout (`$DATA_API_REPO`, default `../data-api-new`) and regenerates the types with `openapi-typescript`; the commit message names the source commit. CI regenerates the types from the committed copy and fails if they differ, and the end-to-end suite against staging catches drift between the copy and the running API.

## 13. Deployment and rollout

1. `data-api-new` ships `GH_RATE_LIMIT_KEYS` and the explorer's key is issued.
2. Deploy the explorer to staging on its custom domain and run the end-to-end suite against it, with the real staging API and node.
3. Production.

The pipeline must run the unit, loader and end-to-end suites and the type check of section 12, then `wrangler deploy --env <env>`. This repository has no CI yet; which CI system runs the pipeline is decided with the plan. The explorer depends on no private package, so the pipeline needs no npm token.

## 14. Targets

- Time to first byte under 100 ms from the edge cache, and under 800 ms at p75 on a cache miss.
- Under 150 KB of gzipped JavaScript on the home, ledger, transaction and account pages.
- WCAG 2.2 AA: real buttons, links and labels, keyboard access to every control, statuses as icon plus text, checked contrast.
