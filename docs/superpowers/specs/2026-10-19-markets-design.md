# Markets and market pair: design (E3)

Date: 2026-10-19. Status: proposed. Sub-project E3 of the explorer program. Repository: `GateHubNet/x-explorer`, branch `feat/explorer-pages`.

## Context

The foundation (`2026-10-17-explorer-foundation-design.md`, built, with the rulings in `../decisions/2026-10-18-explorer-foundation.md`) serves the home, ledger, transaction, account and search pages from one Cloudflare Worker (React Router 8.4, framework mode). The home page follows the chain (README, "Live updates").

E2 (`2026-10-19-network-dashboard-design.md`) adds the network dashboard and, for every later page:

- the **chart kit** (`app/ui/charts/`), which already holds `Candles` with its volume pane, `InlineBar` for order-book depth, `Sparkline`, `Meter` and `BarList`;
- the **generalised live refresh**: `createLiveOnScreen`, `useLiveControls`, the failure hold (`holdFailure`);
- the **canonical query redirect**, and the rule that only the default view is indexable;
- the **shared mechanisms** of E2 §6: the switches (`app/ui/features.ts`, `cacheGeneration`), the header's `navSection`, the generic `keepLoaded`, the "Cannot GET" rule for a route the data API does not have, the `Anchor`, `windowOf` and the running-bucket rule, and the README's `live-home` list.

E3 uses all of it as it is. Where a kit component needs a prop it lacks, the prop is added, as E2 §2.11 allows; no file is forked (section 4.4).

**Build order.** E3 is built after E2 and before E4, E6 and E5 (the order is D1, D2, E2, E3, E4, E6, E5). So E3 defines the pieces it shares with the later pages, and they reference them without redefining them (section 4.6): `app/domain/asset.ts` with the canonical case rule, `app/domain/paging.ts`, the node's full `amm_info` reader and `AmmInfo` type in both forms, the `amm_info` fixture derivation, the derived swap and trade rows, the cache class `minute`, `formatChange`, `LiveStateNotice`, `BarList`'s `href`, `marketHref` and the natural orientation, and `pairCandles`. E3 adds the `MARKETS` switch. E5, built last, adds `poolLink` and moves the pair page's pool card onto it (E5 §5.3).

This spec adds two pages:

- `/{net}/markets`: every DEX pair with trades in a period;
- `/{net}/markets/{base}/{counter}`: one pair, with its price, candles, trades, order book and most active traders.

The approved boards are `2026-10-17-explorer-mock/Markets.dc.html` and `MarketPair.dc.html`. Their sample data is made up.

The data comes from four places:

| Source | What | State |
|---|---|---|
| `data-api-new` `main`, `docs/api-reference.md` | `/v2/exchanges/{base}/{counter}` (trades, `interval` candles, `reduce`), `/v2/active_accounts/{base}/{counter}` | deployed |
| D2, `data-api-new/.worktrees/explorer-data/docs/superpowers/specs/2026-10-19-account-market-aggregates-design.md` | `GET /v2/network/markets`, the one-call markets table (D2 §7). Its AMM share is D2b's ("AMM data additions", built on `main` after the owner merges `feat/amm-data`); D2 keeps only the contract that the AMM fields are absent until the window's data is complete. | proposed |
| `data-api-new` branch `feat/amm-data` | the `amm=include\|exclude\|only` filter of the exchange routes and `amm_account` on a swap | not merged |
| the network's node | the order book (`book_offers`) and the AMM pool (`amm_info`) | new calls in `app/server/node-rpc.ts` |

## Decisions (from the owner)

| Topic | Decision |
|---|---|
| Program | The network, markets and AMM pages and new validators, amendments and account-analytics pages, as seven sub-projects: D1 (validators and amendments data) and D2 (account and market aggregates) in `data-api-new`, E2 to E6 in this repository. This spec is E3. |
| Mock | The boards are approved. Their sample data is placeholder. |
| Process | Auto-mode build after this spec and its plan are reviewed. |
| Markets table | One call: D2's `/v2/network/markets`. |

## Owner decisions to confirm

Product choices of this spec, and its deviations from the approved Markets and MarketPair boards. Each line is this spec's choice; the owner confirms it or changes it before the build.

| Topic | This spec's choice | Why |
|---|---|---|
| Board text (D2 §9) | The source captions name the routes that serve each element, and the Markets footnote reads "Volume in XRP: the XRP side of pairs against XRP, other pairs at the period's rate" (`XAH` on Xahau). For the owner to confirm, in D2, E3 and E4 alike. | The board's captions were placeholders, and D2's `native_volume` rule is what the column holds. |
| Quote filter | "Quote USD" lists the pairs with USD on either side, re-oriented so USD is the counter (the board: orientation unchanged) | The filter then lists pairs priced in USD. |
| Natural orientation | The counter is the side that ranks better in `QUOTE_RANK` (USD, EUR, GBP, JPY, CNY, AUD, CAD, CHF, KRW; RLUSD, USDC, USDT; BTC, ETH; then the native currency), so XRP/USD, not the API's stored USD/XRP. Every page shows a pair this way. | People read a market priced in the better-known currency; one orientation across the markets, account and AMM pages. |
| Text filter and tiles | The text filter narrows the rows; the tiles stay those of the view, and the count line says what is shown (the board: tiles follow the filter) | Tiles are exact sums made in the Worker, and the browser does no decimal arithmetic. |
| Sorting | Plain headers with `aria-sort` in the server's HTML; the sort buttons appear after hydration | No control that does nothing without JavaScript. |
| Selectors | Period, Quote, Trades and the candle interval are segmented links with `aria-current` (the board: `aria-pressed` buttons) | They work without JavaScript, and each view has a URL (E2's rule). |
| Period note | the markets page says the window's start and end, "Figures cover Oct 18, 11:00 to Oct 19, 11:42 UTC" (the board has no "as of") | D2's windows start on an hour, and the page does not refresh itself, so it says how old it is. |
| Sparkline end dot | 8 px, the kit's (the board: 6 px) | The chart kit is shared by every page. |
| AMM share and Via on Xahau | no AMM share column and no Via column on Xahau (the board: columns of "—" and "Book"); the tile says "Xahau has no AMM" | A column that is the same in every row says nothing. |
| AMM parts on XRPL | the AMM share tile and column, the Trades filter, the Via column, the pool card's share and the AMM intro words shown only while E2's `AMM_DATA` switch is on (the board: always) | They need the index to hold every swap of the window; the owner turns the switch on once it does. |
| Issuers under a pair | as text, not links | One 44 px target per row. The pair page links each issuer. |
| Markets page refresh | none: no live updates, no pause control; the period note gives the window's end | A table that moves while the visitor sorts and filters is worse than one that says how old it is. Its data changes once a minute at most. |
| Pairs per period | `limit=1000` (D2 suggests 5000); the footnote says when more qualify | It bounds the page's weight (about 450 KB of data at 1,000 rows). |
| Pair page live controls | the pair page follows the chain, with the live row and `LiveToggle` (the board: no live controls) | WCAG 2.2.2 needs a pause for content that moves by itself. |
| Orientations | both orientations of a pair are pages; "Show USD/XRP" is a link to the inverted URL (the board: a button that flips in place); only the natural orientation is indexable | It works without JavaScript and is a URL that can be shared. |
| Indexing | of the pair pages, only the natural orientation's default view of a pair with at least one trade is indexable; the inverted orientation and a pair with offers but no trade are `noindex, follow`, though each is a page's default view (the program's rule makes every default view indexable) | The inverted page repeats the natural one in the other unit, and a pair without a trade has no market to show. |
| Order book | 10 levels per side, on one depth scale for both sides (the board: 6 levels, a scale per side); its source line adds "· ledger #N" | 60 offers per side fill 10 levels in a liquid book, bars on one scale can be compared, and a book kept through a failed beat says how old it is. |
| Candle cursor | E2's slider and readout, with no live region (the board: each candle a button, the readout `aria-live`) | The kit's one hover and keyboard layer (E2 §2.6). |
| AMM pool card | shown only when the node's `amm_info` finds a pool for the pair (the board: always on XRPL); its link is "Pool account →" to the account page until E5's pool pages exist, then "Pool page →" where `AMM_PAGES` is on | A pair without a pool has no card; the pool page is E5's. |
| Trade paging | `Pager` with Newer and Older (the board: "Older →") | The foundation's paging (foundation §7.1). |
| Trade times | "2026-10-17 15:42:51", date included, header "Time (UTC)" (the board: "15:42:51") | The list spans days, and a marker page spans years. |
| Trade amounts | exact (`formatAmount`) (the board: compacted, "1.2K") | Table cells hold exact decimal strings (E2 §2.4). |
| Most active traders | always all trades, said in a note (the board's sample follows the Trades filter); the pair's AMM pool is left out of the list | `active_accounts` has no `amm` filter. The pool is the other side of every swap, so it would lead every list of a pair with a pool. |
| Open Graph image | none for a pair or the markets page | A price on a card is wrong within a ledger, unfurlers keep images for days, and crawlers would cost a render per pair. |

## Goals

- `/{net}/markets` and `/{net}/markets/{base}/{counter}` show every element of their boards from real data. The cached HTML holds the tables and charts, and they read without JavaScript.
- Every pair has exactly one URL per orientation and view. Anything malformed is a 404 before any upstream call.
- An open pair page follows the chain like the home page: new trades, the order book and the price move in. It uses the same refresh, controls and motion rules.
- The pages ship behind the `MARKETS` switch, off where the data API lacks D2's markets route, and on by a deploy once it has it.
- The AMM share, the Trades filter and the AMM marker on trades appear where E2's `AMM_DATA` switch is on, which the owner turns on once the API there has the AMM data complete.
- The data API and the node see bounded load: the markets set is read at most once a minute per view, and an open pair page is rendered no more often than an open home page.
- The pieces E3 shares with E4 and E5 are defined here, once (section 4.6).

## Non-goals

- Token names, logos and issuer names (no source).
- A depth chart other than the board's bars behind the book's rows.
- Placing or cancelling offers, wallet connect.
- Markets of a past date. Custom candle ranges or more than 60 candles. Candles in another currency.
- Volumes in a display currency. D2 offers `exchange_currency`, but the Markets board has no selector for it.
- Search by currency or pair.
- An Open Graph image of a pair or of the markets page (section 4.5).
- The AMM pool page. That is E5; the pair page links to it once it exists (section 3.1).
- Changes to the data API. Everything E3 needs is in D2, `feat/amm-data` or D2b; what is missing is listed in section 5.

---

## 1. Routes and pair ids

### 1.1 Files

| File | |
|---|---|
| `app/routes/net.markets.tsx` | Route `markets` under `:net` (route id `routes/net.markets`). `loader`, `meta`, `headers = forwardCacheClass`, `handle`, the component. No `clientLoader`: the page does not refresh itself (section 2.5). |
| `app/routes/net.markets.$base.$counter.tsx` | Route `markets/:base/:counter` (route id `routes/net.markets.$base.$counter`). `loader`, `clientLoader`, `meta`, `headers = forwardCacheClass`, `handle`, the component. |
| `app/domain/asset.ts` | **E3's, shared with the later pages**: `parseAssetText`, `assetText` (the URL form), `apiAssetText` (the API's `CUR+issuer`), `canonicalPair`, `sameAsset`, with the rules of sections 1.2 and 1.3, the canonical case rule included. Pure. Used by E3's pair routes and by E5's pool routes and `?asset=` filter. |
| `app/domain/market-pair.ts` | **E3's, shared with E4 and E5.** Pure and safe for the browser. `marketHref(net, base, counter, params?)`, `naturalOrientation(a, b, native)`, `QUOTE_RANK`. Called in the Worker (loaders, view builders), here and by E4's DEX table and E5's pool cards and pages. The pages get every href and label as a string in their data, so `asset.ts`, which checks issuer checksums with `ripple-address-codec`, never enters their browser bundle (`test/unit/markets-bundle.test.ts`). |
| `app/domain/paging.ts` | **E3's, shared with E5**: `trailPaging(page, href)`, the account page's Newer/Older rule taken out of `pagingOf` (section 3.6). |
| `app/domain/market-params.ts` | Pure. The period, quote, trades and interval tables. `parseMarketsParams` / `marketsHref` and `parsePairParams` / `pairQuery`: the canonical query form of each page. |
| `app/server/pair-route.ts` | `parsePairPath(network, rawPath)`: validation and the canonical path (section 1.3). Uses `parseAssetText` and `isValidClassicAddress`. |
| `app/server/markets-view.ts` | The view builder of the markets page, `marketsPage`. Pure; unit-tested. |
| `app/server/pair-view.ts` | The view builder of the pair page. `pairPage` and one function per part: `bookOf`, `tradesOf`, `candlesOf`, `candleWindow`, `statsOf`, `poolOf`, `tradersOf`, `existenceOf`. Pure; unit-tested. |
| `app/ui/pages/MarketsPage.tsx`, `app/ui/pages/MarketPairPage.tsx` | Draw the pages from their data. They never fetch. |
| `app/ui/components/LiveStateNotice.tsx` | **E3's, shared**: the account page's node notice, moved here with its text as props (section 4.4). |
| `app/ui/use-retry.ts` | `useRetry()`, moved out of `AccountPage.tsx` (body unchanged), because `LiveStateNotice` and both pages use it. E4 uses it from here. |

Other files that change:

- `app/routes.ts`: the two routes.
- `app/ui/features.ts`, `env.ts`, `wrangler.jsonc`, the switch's tests: the `MARKETS` switch (section 4.1).
- `data-api.ts`, `api-types.ts`: section 4.3.
- `node-rpc.ts`: section 4.2.
- `cache-class.ts`: the class `minute`, section 2.5.
- `meta.ts`: `marketsMeta`, `pairMeta`.
- `format.ts`: `formatPrice`, `formatChange`.
- `route-handle.ts` (`NavSection` gains `"markets"`) and `Header.tsx` (the Markets link), section 4.5.
- The chart kit props of section 4.4. `AccountPage.tsx` imports `LiveStateNotice` and `useRetry` from their new places.
- `account-view.ts`: `pagingOf` calls `trailPaging`; `MAX_TRAIL` and `parseTrail` move to `paging.ts` and are re-exported, so the account page's imports and tests stay.
- `scripts/bundle-budget.ts`: both pages join `PAGES`.
- `test/support/upstream-core.ts`: the node subjects of section 6.
- The fixture generator (`scripts/market-fixtures.ts`, `scripts/derived-trades.ts`, `scripts/amm-info-fixtures.ts`), the node fixture recorder (`scripts/record-node-fixtures.ts`) and the README ("The markets pages", section 4.6).

### 1.2 The asset in the URL

A pair is two path segments, `{base}/{counter}`, each one asset written in **the explorer's one asset form**. E3 defines it in `app/domain/asset.ts`, and E5's pool routes (`/{net}/amm/{base}/{counter}`) and its `?asset=` filter use it as it is, so a market and a pool name an asset the same way:

| Asset | URL form | Example |
|---|---|---|
| The native currency | its code alone: `XRP` on XRPL, `XAH` on Xahau | `/xrpl/markets/XRP/USD.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq` |
| An issued currency with a standard 3-character code | `CUR.issuer`, the code in upper case (section 1.3) | `USD.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq` |
| An issued currency with a text code (4 to 20 printable ASCII characters, stored as the ledger's left-aligned, zero-padded 40-hex form) | the text, `.issuer` | `RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De`, which is the currency `524C555344000000000000000000000000000000` |
| Any other 40-hex code, LP tokens included | the hex in upper case, `.issuer` (for an LP token, the pool account) | `03F5BC4D66B44AEAD668A84F094E08C8C13F5EE2.rGuYK1v7kyrKEa86wPN2M9CHpT9LiWFr5m` |
| The other network's code as an issued currency | `XAH.issuer` on XRPL, `XRP.issuer` on Xahau | `/xahau/markets/XRP.rIssuer…/XAH` |

**`app/domain/asset.ts`** (pure; it checks issuer checksums with `ripple-address-codec`, so it stays in the Worker and the tests):

```ts
/** An asset as the explorer holds it: the native code alone, or a currency as the ledger holds it (3 characters, or 40 hex digits in upper case) and its issuer. */
interface Asset { currency: string; issuer?: string }
/** The asset a text names on `network`, or null. Reads `.`, `+`, a space (a raw `+` in a query string) and `|` as the separator. */
function parseAssetText(text: string, network: { native: "XRP" | "XAH" }): Asset | null;
/** The URL form: the native code; `CUR.issuer` with a standard code upper-cased, a text code as its text, any other code as upper-case hex. */
function assetText(asset: Asset): string;
/** The API's form: the native code, or `CUR+issuer` with a text code as its 40 hex digits. */
function apiAssetText(asset: Asset): string;
/** The pair in the API's stored order: lexicographic on the lower-cased `currency+issuer` text (the native currency's text is its code). */
function canonicalPair(a: Asset, b: Asset): [Asset, Asset];
function sameAsset(a: Asset, b: Asset): boolean;
```

`parseAssetText` refuses: more than one separator; a code that is none of the forms above; a code containing `|` (the API splits on it); 40 hex digits that are all zero (the native code); the native code with an issuer; any other code without an issuer, or with an issuer that is not a classic address with a valid checksum (an X-address is not one). A text is canonical exactly when `assetText(parseAssetText(text))` gives it back; a caller that finds otherwise redirects to that form (section 1.3, and E5's pool routes and filter).

`.` is the separator: it is in no currency code and needs no escaping, in a path or a query. A dot in a path is safe in this stack: `/robots.txt`, `…/payments.csv` and `/og/….png` are Worker routes already, and React Router strips its own `.data` suffix before it matches. The API is always sent `apiAssetText`, `CUR+issuer` with a text code as its hex. The client's `segment()` escapes the `+` in a path, `URLSearchParams` writes it as `%2B` in a query, and the API decodes both.

### 1.3 Canonical forms and redirects

`parsePairPath` reads the request's raw path, decodes each segment, reads it with `parseAssetText`, and returns either the two assets with the canonical path or "not a pair". The canonical path is `marketHref`'s, made from `assetText`.

| Input | Canonical | Answer |
|---|---|---|
| Another separator: `+`, `%2B`, a space or `\|` (`parseAssetText` reads them) | `.` | 302 to the canonical path |
| A standard 3-character code in lower or mixed case (`usd.r…`, `xrp`) | upper case. The data API upper-cases currency codes (`splitAsset` in its `asset-param.ts`), so `usd` and `USD` are one market there and only the upper-case one has a page. **This is the canonical case rule of `asset.ts`**: `assetText` writes it, so it holds everywhere an asset is in a URL, E5's `?asset=` and `/amm/{base}/{counter}` included. | 302 |
| A text code | kept as written: its letters are the currency's bytes, so `rlusd` is not `RLUSD` | |
| A 40-hex code that is a text code, or the ledger's standard form of a 3-character code (zeros with the three ASCII bytes at bytes 12 to 14) | the text (`assetText`) | 302 |
| Any other 40-hex code in lower case | upper-case hex | 302 |
| The inverted pair (`USD.rhub…/XRP`) | itself | 200. Both orientations are pages. The API inverts a pair asked for in reverse, and the "Show USD/XRP" link leads there. Only the natural orientation (section 1.5) is indexable. |
| Canonical path, non-canonical query | section 1.6 | 302 |

A path redirect carries the canonical query too, so one redirect gives the one URL. Its class is `immutable` when only the path changed, and `short` when the query changed too. A query-only redirect is `short`, as E2's.

**Encoding.** `marketHref` writes each segment with `encodeURIComponent`. So a code with a character a path cannot hold as it is (`#`, `?`, `%`, `^`, `{`, `}`, `<`, `>`, `[`, `]`) is escaped. The redirect check compares the request's raw path with that encoded form, so a needlessly escaped character is redirected too.

### 1.4 Validation and 404s

These checks run before any upstream call. Each failure is a 404 of class `short`, `noindex`, made with `cached({ notFound: … }, "short", { status: 404 })`. The not-found page reads "We couldn't find a market for {what was asked, cut to 40 characters} on XRPL".

| Rule | 404 when |
|---|---|
| Switch | `MARKETS` is off (section 4.1): every markets URL, both pages and every view, is the not-found page "We couldn't find the markets pages on XRPL". |
| Segments | Not exactly two after `markets/`. A third segment is the `*` route's 404. |
| Asset | `parseAssetText` refuses it (section 1.2): more than one separator, a code that is none of the forms above, a code containing `\|` (the API splits on it), 40 hex digits that are all zero (the native code). |
| Native | The network's native code with an issuer (`XRP.r…` on XRPL, `XAH.r…` on Xahau). |
| Issued | Any other code without an issuer, or with an issuer that is not a classic address with a valid checksum (`isValidClassicAddress`; an X-address is not one). |
| Pair | The same asset on both sides (`sameAsset`). |
| Network | `requireNetwork`, as every page. |
| Query | A `marker` that is not one (`isMarker`), as the account page. |

**After the calls.** A well-formed pair can still not exist.

- **404 `short`:** the index has no trade of the pair, and the node's book is empty on both sides. With a Trades filter (section 1.6) the filtered list may be empty while the pair has other trades. In that case the first page without the filter (`limit=1`) is asked before the 404 (section 3.3, call #10). The not-found page reads "We couldn't find a market for XRP/USD (USD issued by rXYZ…) on XRPL" and has the search box.
- **503 (`upstreamOutage`), not stored:** the trades are empty and the book could not be read. The page cannot tell an empty market from a failure.
- **Never a 200 page that says the market does not exist.**

A page behind a marker is a 404 when the API refuses the marker (400) or there is nothing behind it, as the account page.

### 1.5 Natural orientation

The data API stores a pair in a lexicographic order of the lower-cased `currency+issuer` text. So XRP against GateHub USD is stored as USD/XRP, priced about 0.41 XRP per USD. People read that market as XRP/USD. `naturalOrientation(a, b, native)` picks the display orientation. It is pure and needs no knowledge of the API's order: the explorer asks the API in the orientation it shows, and the API inverts.

1. The **counter** (the currency the price is in) is the side that ranks better in `QUOTE_RANK`, by display code (`formatCurrency`, so a 40-hex code that decodes to `RLUSD` ranks as `RLUSD`):

   | Rank | Codes |
   |---|---|
   | 1 to 9 | `USD`, `EUR`, `GBP`, `JPY`, `CNY`, `AUD`, `CAD`, `CHF`, `KRW` |
   | 10 to 12 | `RLUSD`, `USDC`, `USDT` |
   | 13, 14 | `BTC`, `ETH` |
   | 15 | the native currency (`XRP` or `XAH`) |
   | unranked | everything else, LP tokens included |

   A ranked side beats an unranked one, and a lower rank beats a higher one.
2. On a tie (the same code with two issuers, or two unranked codes): the side whose lower-cased code, then lower-cased issuer, sorts first is the **base**.

This gives XRP/USD, XRP/RLUSD, BTC/USD, EUR/USD, ETH/BTC, LIONS/XRP, EVR/XAH and XAH/USD. `naturalOrientation` returns `{ base, counter, inverted }`. `inverted` says whether the order asked for is the reverse of the natural one.

**One orientation everywhere.** Every display of a pair in the explorer uses `naturalOrientation`: the markets table, the pair page's heading and its natural URL, E4's DEX table (bought and sold in the displayed base), and E5's pool cards and pool pages. None orders a pair another way (native first, the API's stored order) for display. `canonicalPair` is for talking to the API only.

### 1.6 Search parameters

**Markets page.**

| Parameter | Values | Default | API |
|---|---|---|---|
| `period` | `24h`, `7d`, `30d` | `24h` | `period=day`, `7day`, `30day` |
| `quote` | XRPL: `xrp`, `usd`, `eur`, `btc`. Xahau: `xah`, `usd`. | none ("All") | filtered and re-oriented in the view builder (section 2.4) |
| `trades` | `book`, `amm` | none ("All") | `amm=exclude`, `only`. XRPL only, and only while `AMM_DATA` is on (section 4.1). |

**Pair page.**

| Parameter | Values | Default | API |
|---|---|---|---|
| `interval` | `15m`, `1h`, `4h`, `1d`, `1w` | `1h` | `interval=15minute`, `1hour`, `4hour`, `1day`, `7day` |
| `trades` | `book`, `amm` | none | as above, on the trades, candles and 24 h calls |
| `marker`, `back` | the account page's paging (section 3.6) | none | `marker` |

**One URL per view** (E2 §1.2):

- The loaders read only these parameters.
- A query string that is not exactly the canonical form of what it names gets a 302 to the canonical URL, class `short`.
- The canonical form drops defaults, unknown values, repeats and unknown parameters, and orders the rest as in the tables above.
- On a pair page behind a marker, `interval` is dropped (that page has no chart). `back` without `marker` is dropped.
- `quote` and `trades` values are lower case.

`trades` depends on the switch, not on data. On Xahau, and on XRPL while `AMM_DATA` is off, it is an unknown parameter: the canonical redirect drops it, before any call.

**Indexing.**

- Indexable: the default view of the markets page, and the default view of a pair in its natural orientation with at least one trade in the index. Each has a canonical URL and `og:*` tags (section 4.5).
- Everything else is `noindex, follow`, with no canonical link and no `og:*`: every other view, an inverted pair, a page behind a marker, and a pair that has offers but no trade. That is E2's rule.

The selectors are links, their hrefs made by `marketsHref` and `marketHref` in the view builders, so they work without JavaScript. With JavaScript they are client-side navigations with `preventScrollReset`.

---

## 2. The markets page

### 2.1 Layout and content

From the top, as on the board. On a phone the same order, in one column. Every table scrolls inside its card.

| Element | Content |
|---|---|
| Heading | `<h1>` "Markets". The intro: XRPL with `AMM_DATA` on reads "Trades on the XRP Ledger DEX: order-book crossings and swaps against AMM pools." XRPL with it off reads "Trades on the XRP Ledger DEX." (the explorer does not know whether the index holds the swaps, so it says neither). Xahau reads "Trades on the Xahau DEX. Xahau has no AMM, so every trade is an order-book crossing." |
| Filters (`role="group" aria-label="Filters"`) | "Period": 24 h, 7 days, 30 days. "Quote": All and the network's codes. "Trades": All, Order book, AMM (XRPL with `AMM_DATA` on only). Each is a segmented control of links, the current one `aria-current="true"`, 32 px to look at with a 44 px target (the `netswitch` pattern, as E2). Then the text filter: a search field labelled "Filter pairs", placeholder "Filter by currency or issuer". It works in the browser only (section 2.6), so it is not in the server's HTML; the row is 44 px high from the start, so adding it moves nothing. |
| Period note | "Figures cover Oct 18, 11:00 to Oct 19, 11:42 UTC: the 24 hours from the start of an hour, recomputed every minute." For 7 and 30 days: "…recomputed every five minutes". Made from the answer's `start_time` and `end_time` with E2's month table. |
| Totals (`section aria-label="Totals"`), `StatTile figure` | (1) "DEX volume": Σ `native_volume` of the rows listed, `compactNumber` and the native code, sub "last 24 hours, pairs listed". (2) "Trades": Σ `count` of the rows listed, sub the same. (3) "Pairs shown": the number of rows listed, sub "of 1,840 with trades" (`totals.pairs_traded`). (4) "AMM share of volume": on XRPL with `AMM_DATA` on, `totals.amm_share` as a whole percent, sub "swaps against AMM pools"; when the answer has no `totals.amm_share` (D2's own rule: absent while the window's AMM data is incomplete), "—", sub "not complete for this period yet". On Xahau "—", sub "Xahau has no AMM". On XRPL with `AMM_DATA` off the tile is left out. The grid is E2's `repeat(auto-fit, minmax(150px, 1fr))`. |
| Pairs (`section class="card"`, `h2` "Pairs") | The source line `/v2/network/markets?period=day`, with `&amm=exclude` or `&amm=only` in a filtered view. The table (below), then a count line, then the footnote. |
| Count line | "214 pairs, by volume, largest first". After filtering or sorting: "Showing 12 of 214 pairs, by change, largest first". It is a `role="status"` element that is always in the page and changes only when the visitor filters or sorts. This page does not refresh itself, so it has no other status. |
| Footnote | Left: "Pairs with at least 10 trades in the period. Volume in XRP: the XRP side of pairs against XRP, other pairs at the period's rate." (D2 §9's wording, for the owner to confirm; `XAH` on Xahau). When `totals.pairs` is more than the rows served, it adds "The 1,000 pairs with the most volume of 2,140." Right: "Prices are counter per base." |

**The table** (`DataTable`, rows 56 px, `minWidth` 1060 px). The columns:

| Column | Content |
|---|---|
| `#` | The row's place in the current sort. |
| Pair | A link to the pair page in the row's orientation, "XRP / USD" in `--fg`. The link is the cell's whole block, at least 44 px high. Under it, the issuers as text (not links, so a row has one target): "USD rhub8V…3wq" for each issued side, joined by " · ". |
| Last price | `formatPrice(last)` |
| Change | A triangle icon (up or down, `aria-hidden`) and the signed text, "+2.38%" or "−2.38%", in `--muted`. No icon for 0.00%. |
| Low – high | "2.389 – 2.4501", `formatPrice` of each. |
| Volume (XRP) | `compactNumber(native_volume)`, or "—" without one. |
| Trades | `count`, grouped. |
| AMM share | XRPL with `AMM_DATA` on only. "—" in every row when the answer has no `amm_share`. Otherwise a `Meter` (small, decorative) and the text: "34%" (whole percent, half up), "<1%" for a share above 0 and below 0.5%, "0%" for 0 with a pool, "no pool" for 0 with `amm_pool` false. A share above 0 without a pool (the pool was deleted in the window) shows its percent. |
| 7 days | E2's `Sparkline` of the 7 closes. Its label comes from the view builder: "7-day price, from 2.38 to 2.44, +2.5%", or "No trades in the last 7 days". |

The server's HTML holds the first 100 rows (`FIRST_ROWS`, as the ledger page). "Show all 214" shows the rest without a request. The loader data holds every row served (at most 1,000).

A row gets no link when its pair would not pass `parsePairPath`, for example a standard 3-character code with lower-case letters, which the data API cannot be asked for (it upper-cases such codes). Such a row is listed as text.

**Empty states.**

- The API has no set yet (`count: 0` and no `totals`): the table area says "No market figures yet for this period. The data API computes them every minute.", and the tiles are left out.
- A quote filter with no row: "No XRP pairs with at least 10 trades in the last 24 hours."
- The text filter with no row: "No pairs match “{text}”." (the board's).

### 2.2 Deviations from the board

| Board | Here | Why |
|---|---|---|
| Caption `/v2/exchanges/{base}/{counter}?reduce=true&amm=…` | `/v2/network/markets?period=day[&amm=…]` | **For the owner to confirm** (D2 §9): the caption names the route that serves the table. |
| Footnote "Volume in XRP at each trade's rate" | "Volume in XRP: the XRP side of pairs against XRP, other pairs at the period's rate" | **For the owner to confirm** (D2 §9): D2's `native_volume` rule (D2 §3.3). |
| Period, Quote and Trades as `aria-pressed` buttons | segmented links with `aria-current` | They work without JavaScript, and each view has a URL (E2). |
| Quote matches either side, orientation unchanged | matches either side, and the row is re-oriented so the chosen currency is the counter | "Quote USD" then lists pairs priced in USD. |
| Pair orientation as in the sample | the natural orientation (section 1.5) | The sample data was placeholder; the API's own order is lexicographic. |
| The text filter changes the tiles | the tiles stay those of the view; the count line says what is shown | Tiles are exact sums made in the Worker, and the browser does no decimal arithmetic. |
| Sort buttons in the server's HTML | plain headers with `aria-sort`; the buttons appear after hydration | No control that does nothing without JavaScript. |
| AMM share column on Xahau, all "—" | left out on Xahau | A column of dashes says nothing; the Xahau tile says why. |
| AMM tile and column always on XRPL | only while `AMM_DATA` is on (section 4.1) | The share needs every swap of the window in the index (D2b). |
| No "as of" | the period note with the window's start and end | D2's windows start on an hour (D2 §7.1). |
| Issuers under the pair | the same, as text, not links | One 44 px target per row. The pair page links each issuer. |
| End dot 6 px | E2's `Sparkline` (8 px dot) | The kit is shared. |

Every line of this table is also in "Owner decisions to confirm" at the top.

### 2.3 The data call

| # | Call | Query | Subrequest class, kept | Feeds | On failure |
|---|---|---|---|---|---|
| 1 | `/v2/network/markets` | `period={p}&limit=1000[&amm=exclude\|only]` | `minute` (60 s) | everything | 503 (`upstreamOutage`): the page cannot be built without it. A "Cannot GET" 404 (an API without D2) is kind `server` by E2's rule (E2 §6.4), so it is a 503 too, held and never stored. |

That is the whole page. It is D2's "one call for the Markets table".

- `min_trades` is not sent: the default, 10, is what the footnote says.
- `limit=1000` instead of D2 §9's `5000` bounds the page's weight (section 2.4). The footnote says when more pairs qualify.
- `amm` is sent only for a `trades` filter, which exists only while `AMM_DATA` is on.
- `networkMarkets` checks the answer's shape inside the cached load, as E2 does: `markets` is a list; prices, volumes, `amm_share` and `change` are decimal text; `sparkline` is a list of `{ date, close? }`; `totals`, when present, is an object. A malformed 200 is an `UpstreamError` of kind `server` and is not stored.
- `/v2/network/markets` is not in `api/openapi.yaml` yet, so it goes in E2's `PENDING_PATHS`.

### 2.4 Loader and view builder

1. `requireNetwork`, the `MARKETS` switch (a 404 while it is off, section 1.4), then the canonical-query redirect (section 1.6). No call is made before these.
2. Call #1. On failure, `upstreamOutage(err, "the markets")`.
3. `marketsPage({ network, params, answer })`.
4. `cached(page, "minute")`.

The page does not poll, so call #1 does not opt in to the failure hold (E2 §6.8).

Nothing is streamed: it is one call.

**View builder rules** (`markets-view.ts`, exact arithmetic with `bignumber.js`, `DECIMAL_PLACES` 80):

| Part | Rule |
|---|---|
| Orientation | Without `quote`: the natural orientation of each row's two assets. With `quote` Q: only the rows with Q's display code on either side, oriented with Q as the counter. When both sides are Q, the natural orientation. |
| Inverting a row | `last' = 1/last`, `open' = 1/open`, `high' = 1/low`, `low' = 1/high`, each to 8 significant digits, half up. `change' = (open ÷ last − 1) × 100` from the API's own strings, 2 decimals, half up. The base and counter volumes swap. `native_volume` and `count` are kept. Each sparkline close becomes `1/close` (8 significant digits); a missing one stays missing. |
| Prices | `formatPrice`: 8 significant digits, half up, trailing zeros dropped, grouped, never in exponent form. |
| Ranks | Per sort key (last price, change, volume, trades), each row's position in an exact ascending sort. A tie keeps the API's order. A row without `native_volume` sorts last on volume in either direction. The browser sorts by these integers and never compares decimals. |
| Tiles | Σ over the rows listed, exact; then `compactNumber`. |
| AMM | `on` (XRPL, `AMM_DATA` on), `off` (XRPL, `AMM_DATA` off: the AMM fields are not read, whatever the answer holds), `none` (Xahau, whatever the answer says: D2 serves `"0.0000"` there). With `on`, a missing `totals.amm_share` or `amm_share` reads "—" (section 2.1): the switch says the parts are shown, D2's field says whether this window's figure is complete. |
| Search text | Per row, lower case: the display codes as "base/counter", the raw codes and the issuers. The text filter matches a substring of it. |
| Window | `start_time` and `end_time` as unix seconds and as the note's text. Absent when there is no set. |
| Size | A row in the loader data is about 450 bytes, so 1,000 rows are about 450 KB of JSON in the document. That is within what a large ledger page already carries (README, "Ledger list"). |

### 2.5 Caching: the class `minute`

**New class `minute`:**

| Fresh at the edge | Stale while one render refreshes it | Browser `Cache-Control` | Used for |
|---|---|---|---|
| 60 s | 30 s | `max-age=0, must-revalidate` | the markets page and its `.data` URL; the subrequests `network/markets`, `active_accounts` and the long-interval candles (section 3.5) |

D2 sets this cadence. Its sets change every minute (24 h) or every five minutes (7 and 30 days), and its answers carry `Cache-Control: private, max-age=60`. D2 §9 asks for "a class 'minute' next to the foundation's classes". `live` (5 s + 30 s) would render the page twelve times for every set change. `slow` (1 hour) would hide twelve.

**Worst-case age** for 24 h is about 3.5 minutes: the set's minute, plus 60 s kept, plus 60 s fresh and 30 s stale at the edge. The period note shows the window's end, so the age can always be seen.

**No live refresh.** A page that moves under a table of hundreds of rows, which the visitor is sorting and filtering, is worse than a page that says how old it is. Its data changes once a minute at most. So it has no `clientLoader`, no `useLiveRefresh`, and no pause control (nothing moves by itself, so WCAG 2.2.2 does not apply).

**E3 adds it, and it is the one "kept 60 s" of the program.** A subrequest of class `minute` is kept 60 s (its edge TTL), as every class's subrequests are kept for their edge TTL. Anything the explorer keeps for 60 s uses this class, with no TTL constant of its own: E3's calls here, E4's analytics calls, E5's aggregates (in place of an `AMM_AGGREGATE_TTL_SECONDS`), and E6's amendment pages and calls. E3 adds it to `cache-class.ts` with its comment; the later specs use it as it is.

**Renders.** There are 3 periods × 5 quotes × 3 trades filters, so at most 45 XRPL views and 9 Xahau views. Each renders at most once a minute per Worker instance (single flight). Each render reads one subrequest, kept 60 s.

### 2.6 Filtering and sorting in the browser

- **Text filter.** After hydration (the `useSyncExternalStore` flag `LiveToggle` uses), the field filters the rows by a lower-case substring of each row's search text. It covers all the rows served, not only the first 100. The tiles do not change. The count line says what is shown. The text is not in the URL: every typed string would otherwise be a stored page and a call.
- **Sorting.** After hydration the headers Last price, Change, Volume and Trades become buttons, each 44 px high and filling its header. A press sorts by that column, largest first; a second press reverses. The header carries `aria-sort`, and an arrow (`aria-hidden`) shows the direction. The count line names the sort. The server's order is by volume, largest first, which is the API's order. Sorting uses the ranks of section 2.4 only.
- Both work on the loaded data. Neither makes a request or touches a decimal.

---

## 3. The market pair page

### 3.1 Layout and content

From the top, in the board's order. On a phone the same order, in one column. The cards that sit side by side wrap (`flex: 999 1 600px` and `1 1 340px`).

| Element | Content |
|---|---|
| Breadcrumb and live row | Left: "XRPL / Markets / XRP/USD" (`Breadcrumbs`). Right: the live dot and "Live · updates every ledger", `LiveStatus`, the held note and `LiveToggle`. These are E2's heading-row parts and classes, and the row is 44 px high from the start. |
| Pair summary (`section aria-label="Pair summary"`) | `<h1>` "XRP / USD" (display codes; "LP token" for an LP token). Then a link "Show USD/XRP" to the inverted pair, keeping `interval` and `trades`. Then the issuer line: "USD issued by rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq · XRP is native". Each issuer is a full address, in mono, linking to `/{net}/account/{issuer}`. An undecodable 40-hex code is written out in full there. Then the price, the change and the stats (below). |
| Price | The last trade's price, `formatPrice`, at `clamp(32px, 9vw, 52px)`, then "USD per XRP". Then the change: a triangle icon and "+1.84%" or "−1.84%" in `--muted`, then "24 h" in `--faint`. |
| Stats | "24 h high", "24 h low", "VWAP 24 h" (`formatPrice`); "Volume XRP", "Volume USD" (`compactNumber`); "Trades 24 h" (grouped). Labels in `--faint`, values in mono. |
| Filters (XRPL with `AMM_DATA` on) | "Trades": All, Order book, AMM, as links. The note "Applies to the chart, the 24 h figures and the trade list." |
| Price (`ChartCard`, `h2` "Price") | Source `/v2/exchanges/{base}/{counter}?interval=1hour` (the current interval's API name). The interval control: 15 m, 1 h, 4 h, 1 d, 1 w, as links (`role="group" aria-label="Candle interval"`). The readout: the time, then O H L C, "Volume 1.6M XRP", "694 trades" (latest by default; it follows the cursor). E2's `Candles` with the volume pane, legend "Closed higher / Closed lower / Volume (XRP)", and the Chart/Table toggle. |
| Recent trades (`h2`) | Source `/v2/exchanges/{base}/{counter}?descending=true`. The table (section 3.6), then `Pager` (Newer, Older). |
| Order book (`h2`) | Source "live from the node · book_offers · ledger #107,721,455". The table (section 3.4), then the note "Asks on top, bids below; the bar is the size on the book up to that price." On XRPL it adds "AMM pool liquidity is not in this book; see the pool." |
| AMM pool card (XRPL, when the node has a pool for the pair) | Title "XRP/USD AMM pool", source "live from the node · amm_info". Then: "Reserves" ("1.80M XRP · 4.40M USD"), "Pool price" ("2.4393 USD", the counter reserve over the base reserve, which is the fee-free spot price), "Trading fee" ("0.300%"), and, with `AMM_DATA` on, "Share of pair volume, 24 h" ("34%"). Its link, made in the view builder, is "Pool account →" to `/{net}/account/{pool}`. E5 is built after E3; its `poolLink(net, pool, ammPages)` then decides this link with its other inbound links ("Pool page →" to `/{net}/amm/{pool}` while `AMM_PAGES` is on), and E5's plan moves the card onto it (E5 §5.3). The card is a `section`; only its link is a link. |
| Most active traders, 24 h (`h2`) | Source `/v2/active_accounts/{base}/{counter}`. A `BarList` of the top 5: the account (a link to its page, `BarList`'s `href`) and "6.1M XRP · 312 trades". Then the note "5 of 1,204 accounts that traded XRP/USD in the last 24 hours, by XRP volume. A trade counts for its buyer and its seller." With a Trades filter on, the note adds "All trades: this list has no filter." When the pair's AMM pool (#8's `account`) is among the accounts, it is left out of the list and the note adds "The XRP/USD AMM pool, the other side of every swap, is left out." |

Each card's source line is the board's faint mono line: paths only, never a host or a key.

### 3.2 Deviations from the board

| Board | Here | Why |
|---|---|---|
| Captions | the routes that serve each element. The pool card gains "live from the node · amm_info". | **For the owner to confirm** (D2 §9). The board's pair captions already named the right routes; they now show the route with `{base}/{counter}`, not the codes, so a 40-hex code does not overflow the card's head. |
| No live controls | the live row, with `LiveToggle` | The page follows the chain, so WCAG 2.2.2 needs a pause, and the home and network pages have it. |
| "Show USD/XRP" as a button that flips the page in place | a link to the inverted URL | It works without JavaScript and is a URL that can be shared. |
| Interval and Trades as `aria-pressed` buttons | links with `aria-current` | E2 |
| Each candle a button; a readout with `aria-live="polite"` | E2's `Cursor` slider and readout; no live region | E2 §2.6 |
| 6 levels per side | 10 per side | The 60 offers read per side fill 10 levels in a liquid book. |
| Depth bars scaled per side | one scale for both sides | Bars on one scale can be compared, asks with bids. |
| "live from the node · book_offers" | adds "· ledger #N" | A book that is kept through a failed beat (section 3.10) says how old it is. |
| "Via" column on Xahau, all "Book" | left out on Xahau, and on XRPL while `AMM_DATA` is off | Section 4.1 |
| Pool card always shown on XRPL | only when `amm_info` finds a pool | A pair without a pool has no card. |
| Pool card a link to the pool page | "Pool account" until E5; then E5's `poolLink`: "Pool page" while `AMM_PAGES` is on, else "Pool account" | E5 owns the pool page and its switch. |
| Trade time "15:42:51" | "2026-10-17 15:42:51" in mono, header "Time (UTC)" | The list spans days, and a marker page spans years. |
| Trade amounts compacted ("1.2K") | exact (`formatAmount`) | Table cells hold exact decimal strings (E2 §2.4). The book and the stats, which are summaries, use `compactNumber`. |
| "Older →" | `Pager` (Newer, Older) | Foundation §7.1 |
| "Most active traders, 24 h" follows the Trades filter in the sample | always all trades, said in a note; the pair's AMM pool left out | `active_accounts` has no `amm` filter; the pool is the other side of every swap. |

Every line of this table is also in "Owner decisions to confirm" at the top.

### 3.3 Data calls

`T` is `anchor.closeTime` (E2's `Anchor`, E2 §6.5), the close time of `last_validated` in unix seconds: the windows follow the index, and the tests get fixed query strings. `T₁` is the start of `T`'s minute minus 24 hours. `{b}/{c}` is the pair in the orientation of the URL; the API inverts when that is not its own. `[&amm=]` is the page's Trades filter, sent only when set (`exclude` or `only`; never `include`, so the keys are the same before and after `feat/amm-data`).

| # | Call | Query | Subrequest class, kept | Shared with | Feeds | On failure |
|---|---|---|---|---|---|---|
| 1 | `/v2/last_validated` | | `live`, kept 2 s (`HOME_CALL_TTL_SECONDS`) | the home and network pages (the same key) | the anchor, `T` | 503 (`upstreamOutage`) |
| 2 | `/v2/exchanges/{b}/{c}` | `descending=true&limit=20[&amm=]` | `live`, kept 2 s (`HOME_CALL_TTL_SECONDS`) | | trades, last price, existence, Older | 503 (`upstreamOutage`) |
| 3 | `/v2/exchanges/{b}/{c}` | `reduce=true&start={T₁}[&amm=]` | `live` (5 s) | | the 24 h stats, the change | stats "—" and `SectionError` |
| 4 | `/v2/exchanges/{b}/{c}`, `pairCandles` | `interval={api}&start={S}&limit=61[&amm=]` | 15 m, 1 h: `live` (5 s); 4 h, 1 d, 1 w: `minute` (60 s) | | the candles | card failed |
| 5 | `/v2/active_accounts/{b}/{c}` | | `minute` (60 s), cut to the top 10 inside the load | | the traders card | card failed |
| 6 | node `book_offers` | `taker_gets={b}`, `taker_pays={c}`, `ledger_index=validated`, `limit=60` | `live`, kept 2 s | the inverted pair (as its bids) | asks | book "Live state unavailable" |
| 7 | node `book_offers` | `taker_gets={c}`, `taker_pays={b}`, the same | `live`, kept 2 s | the inverted pair (as its asks) | bids | the same |
| 8 | node `amm_info` (XRPL), the pair form (`ammInfoByPair`) | `asset`, `asset2` in the natural orientation, whatever the URL's | `live` (5 s) | the inverted pair | the pool card, the pool account for the traders card | `not_found`: no card. Otherwise the card says "Live state unavailable". |
| 9 | `/v2/exchanges/{b}/{c}` (XRPL, `AMM_DATA` on) | `reduce=true&start={T₁}&amm=only`, or `amm=exclude` when the page's filter is `amm` | `live` (5 s) | | the pool card's share | share "—" "Couldn't load", degraded |
| 10 | `/v2/exchanges/{b}/{c}` | `descending=true&limit=1` (no `amm`) | `live` (5 s) | | existence, only when a filtered #2 and the book are empty | 503 |

- `S` is the start of the bucket that holds `T`, minus 59 buckets (section 3.5).
- Every call of the page passes `holdFailure: true`, the node's included (E2 §1.7, §6.8: the page polls). An open page asks every 4 s, so a failing upstream must not be called by every beat of every tab.
- Card calls and the chains of section 3.7 are raced against E2's 4.5 s deadline from the start of the loader. Past it the card is `failed`, with the reason "took too long". The node's own limit is 3 s.
- On Xahau, #8 and #9 are not made. On XRPL, #9 is not made while `AMM_DATA` is off.
- A "Cannot GET" 404 from any data API call is kind `server` (E2 §6.4): an outage for #1 and #2, a failed card for the others. The page has no rule of its own for it.

### 3.4 The order book

**Sides.** For the pair base/counter as shown:

- **Asks** are offers that sell base for counter: `TakerGets` is base, `TakerPays` is counter (#6). Their price is `pays ÷ gets`, in counter per base, and they are listed ascending.
- **Bids** are offers that buy base with counter: `TakerGets` is counter, `TakerPays` is base (#7). Their price is `gets ÷ pays`, and they are listed descending.

The node returns each book best first. So the inverted page's asks are this page's bids, from the same cache entries.

**Levels** (`bookOf`, exact, `DECIMAL_PLACES` 80):

1. The price is computed from the offer's full `TakerGets` and `TakerPays` (its quality). Then it is cut to 8 significant digits, half up; that text is the level's price.
2. The size uses the funded amounts: `taker_gets_funded` and `taker_pays_funded` when present, else the full amounts. An offer whose funded amount is 0 is skipped.
3. Offers whose prices have the same text merge into one level. Its size is the sum of the base sizes: funded `TakerGets` for asks, funded `TakerPays` for bids.
4. The first 10 levels per side (`BOOK_LEVELS`) are kept.
5. "Total" is the cumulative base size from the best price out.
6. The depth bar's width is total ÷ the larger of the two sides' last totals.
7. The spread is the best ask minus the best bid, at 8 significant digits. It reads "—" when either side is empty or the difference is not above 0.

Sizes and totals are shown with `compactNumber`, prices with `formatPrice`. Native amounts come from the node client in whole units (section 4.2).

**The table.** One `<table>` (`aria-label` "Order book") with the columns Price, {base} and Total, plus a visually hidden "Side" column whose cells say "Ask" or "Bid". Each row's side is then in text, not only in its place and its wash. The asks are a `tbody`, best ask last, nearest the middle (as on the board). Then a middle row: the last trade's price on the left and "spread 0.0018" on the right. Then the bids, best first.

Each row has an `InlineBar` (E2): `--down-wash` for asks, `--up-wash` for bids, from the row's end, `aria-hidden`. Rows are 28 px, and the card does not scroll. A side with no offer shows one row, "No asks" or "No bids".

**Failure: "Live state unavailable".**

- When either call fails (or passes its deadline), the card shows `LiveStateNotice` (section 4.4), with no `role`. The title is the default, "Live state unavailable". The body reads "The network node did not answer, so the order book is missing. Trades and prices on this page are from the explorer's index and are not affected." A Retry follows.
- One side alone is never shown: half a book misreads as a one-sided market.
- The request is marked degraded and not stored.
- The pool card uses the same notice, with "…so the pool's reserves and fee are missing."

### 3.5 The candles

**The window.** Sixty buckets (`CANDLE_COUNT`) end with the bucket that holds `T`. The newest bucket is the one forming: candle charts of a live market show it, and the readout and the tooltip mark it "so far".

| `interval` | API | Bucket (the API's alignment) | 60 buckets |
|---|---|---|---|
| `15m` | `15minute` | the clock's quarter hours, UTC | 15 hours |
| `1h` | `1hour` | the clock's hours | 2.5 days |
| `4h` | `4hour` | 00, 04, 08, 12, 16, 20 UTC | 10 days |
| `1d` | `1day` | UTC days (`Nday` counts from 2013-01-01) | 60 days |
| `1w` | `7day` | weeks from Monday 00:00 UTC | 60 weeks |

`candleWindow(T, interval)` returns the 60 bucket starts (`YYYY-MM-DDTHH:mm:ssZ`, oldest first) and `S`, the first. The call (#4) gives `start=S` and no `end`, so its key changes once per bucket, not once per ledger. It asks for `limit=61`: when the index is a moment ahead of `T` and a new bucket has begun, that 61st candle lies outside the axis and is ignored (E2 §1.5: a row outside the window is ignored).

The candles are aligned to the bucket list by `start`. A bucket without a candle is `null`, drawn as a gap: the API serves only buckets with trades.

**Into the kit** (`CandleData`, E2 §2.3):

- each candle is `{ o, h, l, c, v, n }`: `open`, `high`, `low`, `close` (the API's 8-significant-digit text), `v` = `base_volume` (exact), `n` = `String(count)`;
- `format { kind: "price", unit: counter code }` and `volume { kind: "amount", unit: base code }`;
- `axis.unit` is `"minute"` for 15 m, `"hour"` for 1 h and 4 h, `"day"` and `"week"` for the others;
- `forming` (a `boolean`, as `TimeSeriesData.forming` in E2 §2.3) is `true`: the last bucket is the running one;
- `token` is E2's FNV-1a hash of what is drawn.

**Labels.** X labels are "17:15" (15 m), "16:00" (1 h, 4 h), "Oct 16" (1 d) and "Oct 12" (1 w). The readout reads "Oct 17, 2026, 17:00 UTC · so far" for the forming bucket, "Week of Oct 12, 2026" for a week.

**Table view.** The columns are Time (UTC), Open, High, Low, Close, Volume ({base}) and Trades, newest first. Prices use `formatPrice`, volumes are full.

**Empty.** "No trades in these 60 hours" ("…15 hours", "…10 days", "…60 days", "…60 weeks").

**Why two classes.** A short interval's forming candle changes with every trade, and its 60 buckets are a small read: `live` (5 s), like the page's other `live` calls. Sixty days or weeks of a busy pair aggregate millions of trades, and only the forming bucket changes: `minute` (60 s) bounds both the read rate and how late that one candle is.

### 3.6 Trades and paging

**Columns** (`DataTable live`, rows 42 px, `minWidth` 720 px):

| Column | Content |
|---|---|
| Time (UTC) | "2026-10-17 15:42:51", mono. It links to `/{net}/tx/{hash}`. The link's name starts with its visible text, followed by a visually hidden ", transaction 76018A…D8AB" (WCAG 2.5.3). |
| Side | A 6 px dot (`--up` or `--down`, `aria-hidden`) and the text "Buy" or "Sell". The side is the taker's: Buy when `taker` is `buyer`, Sell when `taker` is `seller`, "—" otherwise. |
| Price | `formatPrice(rate)` |
| {base} | `formatAmount(base_amount)` |
| {counter} | `formatAmount(counter_amount)` |
| Taker | `AccountLink`, the short address, linking to the account page |
| Via | XRPL with `AMM_DATA` on only. A tag "AMM" when the row has `amm_account` (a swap; the API puts the pool there), "Book" otherwise. Text, not colour. |

Rows are keyed by `ledger_index:tx_index:node_index`, which is the API's key and is unique.

**Paging** follows the account page exactly (README, "Newer and Older"):

- The first page is the newest 20.
- Older is the answer's `marker`. A page reached with one remembers the way back in `?marker=M3&back=M2.M1`, nearest first, at most ten (`MAX_TRAIL`, `parseTrail`).
- The second page's Newer is the first page.
- `trades` is kept in these links: a marker belongs to the list it came from.
- The rule is `trailPaging`, with `marketHref` as the href. `pagingOf` of the account page calls it and keeps its signature.

**`app/domain/paging.ts`** (E3's; E5's lists use it as it is). Pure:

```ts
export const MAX_TRAIL = 10;                       // moved from account-view.ts, which re-exports it
export function parseTrail(back: string | null): string[];   // moved too: markers joined by ".", at most MAX_TRAIL, else []
export interface Paging { newerHref: string | null; olderHref: string | null }
/**
 * Newer and Older for a page reached with `marker` (none on the first page) and the trail `back` of the pages before it, nearest first.
 * `next` is the answer's marker. `href` makes the URL of a page of the same list: no marker for the first page.
 */
export function trailPaging(
  page: { marker?: string; back: readonly string[]; next?: string },
  href: (to: { marker?: string; back: readonly string[] }) => string,
): Paging;
```

Newer is `null` on the first page, the first page when `back` is empty, else `back[0]` with `back.slice(1)`. Older is `null` without `next`, else `next` with `[marker, ...back]` cut to `MAX_TRAIL` (or `[]` from the first page). These are the account page's rules as `pagingOf` has them today; its tests pass unchanged.

### 3.7 Loader and view builder

1. `requireNetwork`; the `MARKETS` switch (a 404 while it is off, section 1.4); `parsePairPath` (404 or redirect, section 1.3); the canonical-query redirect (section 1.6). No call is made before these.
2. With a `marker`: the page behind a marker (section 3.11).
3. Side by side, all awaited with `Promise.allSettled`:
   - #2, #5, #6, #7, #8;
   - the anchor chain: #1, then #3 and #4;
   - the AMM chain, on XRPL while `AMM_DATA` is on: #1, then #9.
4. #1 or #2 failed: `upstreamOutage(err, "the market")`, after everything has settled, so nothing runs on behind an answered request.
5. Existence (section 1.4): `existenceOf(trades, book, unfiltered?)`. #10 is asked only in its one case.
6. `pairPage(...)` builds the data. Every failed card is logged (`logProblem`) and marks the request degraded (`markDegraded(context, reasons)`). An absent pool and the AMM parts left out by the switch are answers, not failures.
7. `cached({ ...page, anchor: anchorOf(last), build: BUILD_ID }, "live-home")`.

**Nothing is streamed or deferred** (E2 §1.6): the page is one answer that an open tab fetches again every beat.

**View builder rules** (`pair-view.ts`):

| Part | Rule |
|---|---|
| Last price | The rate of #2's first row, with its `executed_time`. Without a trade: "—" and "No trades yet". When the newest trade is more than 24 hours older than `T`, the price shows "last trade 2026-10-03". |
| Change, 24 h | `(last ÷ open − 1) × 100`, `open` from #3, 2 decimals, half up, with a sign. "—" when #3 has `count` 0. Both prices follow the Trades filter, so they describe the same trades. |
| Stats | From #3: `high`, `low`, `vwap`, `base_volume`, `counter_volume`, `count`. With `count` 0, the prices read "—", the volumes and trades "0", and a note reads "No trades in the last 24 hours." |
| Pool | From #8. The reserves come from `amount` and `amount2` (whole units, section 4.2), oriented to the page. The price is the counter reserve ÷ the base reserve, 8 significant digits. The fee is `trading_fee ÷ 1000`, with 3 decimals, plus "%" (300 is "0.300%"). The share (with `AMM_DATA` on) is from #9 and #3: with the page's filter `amm`, #9 is `exclude` and the share is `#3.base_volume ÷ (#3.base_volume + #9.base_volume)`; with `book`, #9 is `only` and the share is `#9.base_volume ÷ (#9.base_volume + #3.base_volume)`; with no filter (`include`), #9 is `only` and the share is `#9.base_volume ÷ #3.base_volume`. Whole percent, half up, "<1%" as on the markets page, "—" for a denominator of 0. |
| Traders | #5's `accounts`, already sorted by base volume, without the pair's pool account when #8 answered a pool and the account is among them; then the first 5. This needs no switch: before the AMM merge the index records no swap, so the pool is never among them, and after it the pool leads every list of a pair with a pool, `AMM_DATA` on or not. When #8 has no answer, nothing is left out. The bar is `base_volume ÷` the first shown's. The tip is "{compact} {base} · {count} trades". The note's total is `count`; it adds the pool sentence of section 3.1 when the pool was left out. |
| Indexable | Natural orientation, default query, no marker, and #2 (or #10) has a trade. |
| Tokens | Every card and chart carries a `token`: E2's FNV-1a of what it draws. |
| Anchor | `anchorOf(last)` (E2 §6.5): `{ lastValidated, closeTime }` |

The browser gets this data, never a node or API answer: the trimmed book offers and the API rows stay in the Worker (`test/unit/markets-bundle.test.ts`).

### 3.8 Caching

**Edge class: `live-home` (1 s + 2 s), the class of the pages that follow the chain** (E2 §1.7). E3 appends the pair page to the class's cumulative list in `cache-class.ts` and the README (E2 §6.9), which then reads home, network and the pair page.

- The book changes with every ledger and an open tab asks every 4 s. With `live` (5 s + 30 s) a beat could be given a copy 35 s old.
- The trades list and the book are kept 2 s, like the home page's lists. So the worst-case age is the home page's, about 5 s.

**The cost is bounded.**

- **Renders.** With single flight, at most about one render per second per Worker instance per pair view that someone has open. A view nobody watches is rendered only when it is asked for.
- **Upstream per render.** Two node `book_offers` calls and one `amm_info` call (kept 2 s and 5 s, and shared between orientations); #1 and #2 (kept 2 s, #1 shared with the home and network pages); #3, #4 and #9 (5 s; #4 60 s for long intervals); #5 (60 s).
- **Failures.** The failure hold (E2) stops a failing upstream from being called by every beat.

**In `cache-class.ts`**:

- the class `minute` (section 2.5), new;
- `HOME_CALL_TTL_SECONDS`, `MARKER_PAGE_CLASS`, already there.

### 3.9 Failures, card by card

| What failed | Page | Stored |
|---|---|---|
| #1 or #2 | 503 with `Retry-After`. The edge serves the stored copy if there is one. An open page keeps itself (section 3.10). | no |
| #2 empty and the book unreadable | 503 (section 1.4) | no |
| #3 | The six stats read "—", with one `SectionError` under them, "Couldn't load the 24 h figures". The change reads "—". | no (degraded) |
| #4 | The price card: `SectionError` "Couldn't load the price chart", in place of the views and the toggle | no |
| #5 | The traders card: `SectionError` "Couldn't load the most active traders" | no |
| #6 or #7 | The book: "Live state unavailable", with Retry | no |
| #8, other than `not_found` | The pool card: "Live state unavailable", with Retry | no |
| #8 `not_found` | No pool card | yes (an answer) |
| #9 | The share reads "—" "Couldn't load" | no (degraded) |
| `AMM_DATA` off (XRPL), or Xahau | No #9: no Trades filter, no Via column, no share | yes (an answer) |

Retry is `useRevalidator().revalidate()`, the explorer's own `.data` URL, as on the account page. It works while the visitor has paused the updates. A Retry pressed within the failure hold gets the held failure; the next beat after it gets a fresh answer (E2).

The node notices are `LiveStateNotice` without its `role` (section 4.4): `LiveStatus` stays the page's one status (E2), and a notice changes only between the first render and a Retry, because `keepLoaded` keeps a card once loaded (section 3.10). So nothing is announced every beat.

### 3.10 Live updates

The pair page uses E2's generalisation as it is. Nothing new polls.

| Piece | Pair page |
|---|---|
| `createLiveOnScreen({ order, merge })` | `order = d => d.anchor.lastValidated` (E2 §6.5); `merge = (next, shown) => keepLoaded(next, shown, PAIR_PARTS)` (E2 §6.3) |
| scope | `` `${net}/markets/${base}/${counter}${canonical search}` ``, so a refresh of another view never stands in for this one |
| `useLiveRefresh`, `useLiveControls` | as they are: 4 s while visible, backoff 4 to 60 s, the 10 s give-up, pause, hold, visibility, the build reload |
| wiring | as `net.network.tsx`: a module-level `onScreen`, `clientLoader` → `onScreen.reload(scope, serverLoader)`, `useEffect(() => onScreen.show(scope, loaderData))`, the page keyed by `scope` |

The page is keyed by scope, so an interval, filter or orientation change remounts it. That is a first render, and it is not animated. The `/:net` layout's `onlyWhenParamsChange` makes a beat one request: `/{net}/markets/{base}/{counter}.data?…&_routes=routes%2Fnet.markets.%24base.%24counter`.

**The merge: E2's `keepLoaded` over the page's parts.** `PAIR_PARTS` (in the route module) names the parts of the pair page's data a beat may keep, each a `LivePart`: `stats` (#3), `candles` (#4), `traders` (#5), `book` (#6 and #7, one part: half a book is never shown), `pool` (#8) and `share` (#9). A beat whose answer has a part `failed`, where the page shows it loaded, keeps the shown part. The book and pool name their ledger, so a kept one says how old it is. A part that has never loaded shows its error. The trades list and the summary price come from #2, which fails the whole answer, and the page then keeps itself (E2). No merge of the page's own is written.

**What moves on a beat** (CSS and the existing script; nothing new):

| Part | How |
|---|---|
| Trades | `DataTable live`: a new trade enters at the top (`is-entering`), the others slide on y, the oldest leaves |
| Price, change, stats, spread, the book's and pool's ledger numbers | `LiveValue` with the shown text as its token |
| Book levels, pool figures | Redrawn in place, not animated. They change with every ledger, and motion there would never stop. |
| Candles | Memo'd on the token. A changed token redraws in place **without** E2's plot mark (`mark={false}`, section 4.4). The forming candle changes with every trade, and the ring would flash every beat. |
| Traders | `BarList`, redrawn in place |

`prefers-reduced-motion: reduce` keeps the colours alone, as on the home page. There is no `aria-live` region: `LiveStatus` is the page's one `role="status"`.

**Hold.** A mouse or pen over, or keyboard focus in (E2's `holdsFocus` rules), the trades table or the traders list holds the page. Those are the parts with links. The row then says "Paused while you look at the trades" or "…at the traders". The book and the chart have no links and do not hold.

### 3.11 Pages behind a marker

`?marker=…` is old history.

- **Awaited whole**, class `MARKER_PAGE_CLASS` (`slow`, 1 hour; foundation ruling 1), `noindex, follow`, no canonical, no `og:*`.
- **One call:** #2 with the marker (and `amm` when filtered).
- **Shown:** the breadcrumb, the `<h1>`, the issuer line, the note "Older trades of XRP/USD. The price, chart and order book are on the market's page." (linking to the first page), and the trades card full width with its `Pager`.
- **Not shown:** no live row, no `clientLoader` refresh (the component starts the live hook only for `mode: "live"`), no node call.
- An API 400 for the marker, or an empty page, is a 404 `short`.

---

## 4. Shared

### 4.1 The switches: `MARKETS` and `AMM_DATA`

Both are E2's mechanism (E2 §6.1): a Worker variable, "on" or "off", per environment, in the cache generation, checked by the pre-deploy guard.

**`MARKETS` (E3 adds it).** It joins `FEATURE_VARS` in `app/ui/features.ts` (as `markets`), `Env`, every environment block of `wrangler.jsonc` and the switch tests.

- "On" at the top level (development and tests) from E3's build. "Off" in staging and production until the data API there serves `/v2/network/markets` with D2's gauges at their marks (section 7, D2 §16.4); then "on" by a commit and a deploy.
- Off, it is a page-level switch: both routes and every view of them answer the not-found page, a 404 of class `short`, before any call (section 1.4). The header's Markets item is the "soon" label (section 4.5).
- Every link into the markets pages from another page is a link only while it is on, and the "soon" style otherwise: E4's DEX table and E5's market links read `net.features.markets` in their view builders (or `useFeatures()` where the link is not in page data). They import `marketHref` and need no constant of their own.

**`AMM_DATA` (E2's).** The AMM parts of these pages are: the Trades filter, the Via column, the AMM share column and tile, the pool card's share, and the intro's "swaps against AMM pools" words. They are shown on XRPL only while `AMM_DATA` is on. The owner turns it on in an environment once its data API has merged `feat/amm-data`, re-ingested its history with the AMM parser and back-filled (and D2b serves the AMM share).

| | `AMM_DATA` off | `AMM_DATA` on |
|---|---|---|
| Markets page | no Trades filter (a `trades` parameter is dropped by the canonical redirect), no AMM share tile or column, the plain intro | the parts. A window whose answer has no `amm_share` (D2's own rule: absent until every ledger of the window was parsed with AMM data) shows "—" in the tile and the column. |
| Pair page | no Trades filter, no Via column, no share on the pool card, and no #9 call | the parts, and #9 for the share |
| Xahau | never: `hasAmm` (E2's `networks.ts`) is false, whatever the switch. D2's `"0.0000"` there is ignored. | |

The parts are left out, not shown as "unknown", while the switch is off. Nothing asks the API whether it has AMM data: no route probe and no markets call made for that.

### 4.2 Node client additions (`app/server/node-rpc.ts`)

E3 adds `bookOffers`, and the whole `amm_info` reader with both of its forms: `ammInfoByPair`, which the pair page uses, and `ammInfo`, the pool-account form E5's pages use. E5 uses the reader and the `AmmInfo` type as they are.

```ts
/** An amount as the explorer reads it: native amounts converted from drops to whole units at this boundary. */
interface NodeAmount { currency: string; issuer?: string; value: string }
interface BookOffer { account: string; sequence: number; gets: NodeAmount; pays: NodeAmount; getsFunded?: NodeAmount; paysFunded?: NodeAmount }
interface Book { ledgerIndex: number; offers: BookOffer[] }

/** rippled's v1 `amm_info` result, as the explorer reads it. Field names are the node's; amounts are `NodeAmount`s, times unix seconds. */
interface AmmInfo {
  account: string;                           // the pool account
  amount: NodeAmount;                        // native in whole units
  amount2: NodeAmount;
  asset_frozen?: boolean;
  asset2_frozen?: boolean;
  lp_token: NodeAmount;                      // currency (40 hex), issuer = the pool, value = the LP supply
  trading_fee: number;                       // units of 1/100000 (300 is 0.300%)
  vote_slots: { account: string; trading_fee: number; vote_weight: number }[];   // [] when the node leaves it out
  auction_slot?: {
    account?: string;                        // absent: an open slot
    auth_accounts: string[];                 // [] when the node leaves it out
    discounted_fee: number;
    expiration: number;                      // the node's ISO time, as unix seconds
    price: NodeAmount;
    time_interval: number;                   // 0 to 20
  };
  ledger_index: number;                      // the validated ledger it was read at
}

bookOffers(gets: Asset, pays: Asset, opts?: { ttl?: number; holdFailure?: boolean }): Promise<Book>;
ammInfo(pool: string, opts?: { ttl?: number; holdFailure?: boolean }): Promise<AmmInfo>;
ammInfoByPair(asset: Asset, asset2: Asset, opts?: { ttl?: number; holdFailure?: boolean }): Promise<AmmInfo>;
```

- **`book_offers`**: `{ taker_gets, taker_pays, ledger_index: "validated", limit: 60 }` (`BOOK_OFFERS_LIMIT`). 60 is the default of both rippled and Clio, inside the limits of both.
  - An asset is `{ currency: net.native }` for the native currency, else `{ currency, issuer }` with the code as the ledger holds it: a standard code as its three characters, any other as its 40 hex digits (a text code's hex, as `apiAssetText` writes it).
  - The answer must say `validated: true` and have an `offers` list, or it is a `server` error (a book has no "not found").
  - Each offer is trimmed in `read` to the fields above before it is cached, so a cached book is small.
  - A native amount (drops text) becomes whole units with `dropsToNative`, as times are converted at this boundary.
- **`amm_info`**, one reader for both forms:
  - pool form (`ammInfo`): `{ amm_account, ledger_index: "validated" }`; pair form (`ammInfoByPair`): `{ asset, asset2, ledger_index: "validated" }`, the assets written as for `book_offers`;
  - the answer must say `validated: true`; native amounts (drops text) become whole units with `dropsToNative`, and the slot's ISO `expiration` unix seconds, at this boundary, as for every node time; a missing `vote_slots` or `auth_accounts` becomes `[]`;
  - checks, else a `server` error: the amounts are amounts; `trading_fee` is an integer from 0 to 1000; `time_interval` an integer from 0 to 20; for the pool form, `account` is the pool asked for; for the pair form, the assets of `amount` and `amount2` are the two asked for, in either order;
  - `actNotFound` (the account is not a pool, or the pair has none) and `actMalformed` (an address that holds no account, such as a deleted pool's) are `not_found`. The Worker has checked the address or the pair, so both mean "no such pool". The plan's first `amm_info` task checks both answers against the configured node before the reader is written; if the node answers otherwise, the mapping follows what it answers;
  - the pair page never calls it on Xahau, and neither does any page: `hasAmm` is false there.
- **Errors.** `MALFORMED_REQUEST` gains `srcCurMalformed`, `srcIsrMalformed`, `dstAmtMalformed`, `dstIsrMalformed`, `badMarket` and `issueMalformed`, as `bad_request`. The pair has been validated, so the page treats them as a failure of the node: the card is unavailable, and the error is logged.
- **Cache.** The class is `live`. `ttl` uses the existing `ttlOverride` with its own key. `holdFailure` is passed to E2's `cache.json` option.
- The foundation spec named `book_offers` and `amm_info` as the node calls to come (§1). The pair page uses `account`, `amount`, `amount2`, `trading_fee` and `ledger_index` of `AmmInfo`; E5 reads the rest.

### 4.3 Data API client additions (`data-api.ts`, `api-types.ts`)

| Method | Path | Returns | Class |
|---|---|---|---|
| `pairExchanges(b, c, q: ListQuery & { amm? }, opts?)` | `/v2/exchanges/{base}/{counter}` | `Page<"exchanges", PairExchange>` | `listClass(q)`; `ttl` and `holdFailure` on the first page |
| `pairCandles(b, c, q: { interval, start, end?, limit, amm?, descending? }, opts?: { cls?, ttl?, holdFailure? })` | the same, `interval=` | `Page<"exchanges", Candle>` | `opts.cls`, default `live`: the pair page passes `minute` for long intervals; E5's swap-volume chart passes `slow` with E2's `PERIOD_CALL_TTL_SECONDS` and an `end` |
| `pairReduce(b, c, q: { start, amm? }, opts?)` | the same, `reduce=true` | `ReducedRow` (the one row) | `live` |
| `activeAccounts(b, c, opts?)` | `/v2/active_accounts/{base}/{counter}` | `{ count, exchanges_count, accounts }` with the first 10 accounts | `minute` |
| `networkMarkets(q: { period, limit, amm? })` | `/v2/network/markets` (in `PENDING_PATHS`) | `MarketsResponse`. A "Cannot GET" 404 is kind `server` by E2's client rule (E2 §6.4); the method adds no 404 handling of its own. | `minute` |

- `pairCandles` is the one candle method of the explorer. `end` is optional and inclusive at its precision (the API's rule); the pair page sends none, so its key changes once per bucket (section 3.5). E5 uses it as it is, under this name.
- `PairExchange` is the raw trade of the reference with `amm_account?` last (`feat/amm-data`).
- `Candle` and `ReducedRow` follow the main reference's key orders.
- `MarketsResponse` follows D2's built `docs/api-reference.md` on `feat/explorer-data` at the commit the plan pins (D2 §7; D2 is built before E3).
- An asset segment is `apiAssetText(asset)` (`CUR+issuer`, a text code as its hex) and goes through the client's `segment()`.
- Every answer's shape is checked inside the cached load (E2 §1.4): lists, decimal text, a reduce answer with exactly one row.

### 4.4 Chart kit use, and the props that grow

The pages use `Candles` (with its volume pane, `Cursor`, `HoverGroup` and table view), `InlineBar`, `Sparkline`, `Meter`, `BarList`, `ChartCard` and `StatTile figure`. Other parts:

- `DataTable` (`live`, `compact`), `LiveValue`, `LiveStatus` and `LiveToggle`;
- `Pager`, `Breadcrumbs`, `SectionError` and `AccountLink`;
- `LiveStateNotice` (below).

**`LiveStateNotice`** (`app/ui/components/LiveStateNotice.tsx`, E3's, shared). The account page's node notice, moved out of `AccountPage.tsx` with its markup (`notice notice--warning`, the alert icon, the title, the body, the Retry button) and made general:

```ts
function LiveStateNotice(props: {
  title?: string;          // default "Live state unavailable"
  children: ReactNode;     // the body: what is missing, and what is not affected
  role?: "status";         // the account page passes it, as today; a live page passes none (its LiveStatus is the one status)
}): JSX.Element;
```

Its Retry is `useRetry()` (`useRevalidator().revalidate()`, "Retrying…" while it runs), moved with it to `app/ui/use-retry.ts`. The account page's notice renders exactly as before. Any later page's node notice is this component with its own text (E5's pool page's "Live state unavailable; shown from the index").

E2 §2.11 lets props grow and forbids forking files. E3 adds:

| Component or type | Addition | Default keeps E2's behaviour |
|---|---|---|
| `TimeAxis.unit` | `"minute"`: 15-minute buckets, labels "17:15" | yes |
| `CandleData` | `forming?: boolean`: the last bucket is still forming; the readout and the tooltip say "so far" (E2 §2.3's words) | yes |
| `Candles` | `mark?: boolean` (default `true`): `false` redraws a changed token without the plot's ring | yes |
| `BarList` | items' `href?: string`: the item's label is a `Link` to it; the bar stays `aria-hidden` and is not a target. E3's traders use it; E5's fee votes too. | yes |
| `BarList` | `tip?: "share" \| "count"` (default `"share"`): `"count"` reads "{value} · {count} trades", and `share` is then optional | yes |
| `Meter` | `decorative?: boolean`: `aria-hidden` and no `role="img"`, for a meter whose cell carries its value in text | yes |
| `ValueKind "price"` | always shown with `formatPrice`, never compacted, in ticks, readouts, tooltips and tables | it is E2's kind; this fixes its text |

New in `app/domain/format.ts`:

- `formatPrice(value: string)`: 8 significant digits, half up, trailing zeros dropped, grouped, never in exponent form.
- `formatChange(value: string)`: a percent change as text, without the "%": rounded half up to 2 decimals, "+" before a positive value, U+2212 before a negative one, "0.00" for zero ("+2.38", "−2.38"). Callers add "%". E4's value table uses it as it is.

### 4.5 SEO, Open Graph, links, navigation

| | Markets | Pair |
|---|---|---|
| `<title>` | "XRPL markets · explorer". A non-default view adds the view: "XRPL markets · last 7 days · USD · AMM swaps · explorer". | "XRP/USD · USD rhub8V…3wq · XRPL market · explorer": the pair, then each issued side's code and short issuer. A view adds "· 4 h candles", "· order-book trades", "· AMM swaps", "· older trades". |
| Description | "Every pair traded on the XRP Ledger DEX with at least 10 trades in the last 24 hours: last price, change, range, volume and a 7-day trend." (Xahau: "the Xahau DEX") | "Price, candles, recent trades, order book and most active traders of XRP/USD on the XRP Ledger DEX. USD issued by rhub8V…3wq." |
| Numbers in the description | none: the page is stored for a minute | none: the page is stored for a second |
| Indexable view | canonical on the request's origin; `og:title`, `og:description`, `og:url`, `og:type=website`, `og:site_name`; `twitter:card=summary` | the same |
| Other views | `noindex, follow`, no canonical, no `og:*` | the same |

**Open Graph image: none, and no `pair` kind.** A card with a price would be wrong within a ledger, and unfurlers keep an image for days. A card without one says no more than the title. Each pair URL would cost a Satori render, and crawlers walk thousands of pairs. Home and network have none either. `/og/{net}/pair/…` stays a 404, as any unknown kind.

**Links.** The links out of these pages:

- Markets rows go to the pair page in the row's orientation.
- On the pair page: issuers, takers, traders and the pool account go to `/{net}/account/{address}`; trade times go to `/{net}/tx/{hash}`; the breadcrumb goes to `/{net}` and `/{net}/markets`; "Show {counter}/{base}" goes to the inverted pair.

**Navigation.**

- "Markets" in the header becomes a link to `/{net}/markets` while `MARKETS` is on, and stays the "soon" label while it is off (E2 §6.2).
- Both routes export `handle = { navSection: "markets" }`, with E2's `navSection` (E2 §6.2); E3 widens `NavSection` to `"network" | "markets"`. The header then gives the item `.is-current` on both pages, `aria-current="page"` on `/{net}/markets` (the section's own page, any query), and `aria-current="true"` on a pair page (a page inside the section).
- The network switch is unchanged: it leads to the other network's home.

### 4.6 What E3 defines for the later sub-projects

E4, E6 and E5 are built after E3 and use these as they are; none redefines them.

| Piece | Where | Defined in | Used by |
|---|---|---|---|
| The asset form and the canonical case rule (`parseAssetText`, `assetText`, `apiAssetText`, `canonicalPair`, `sameAsset`) | `app/domain/asset.ts` | sections 1.2, 1.3 | E5's pool routes, pair form and `?asset=` |
| `marketHref`, `naturalOrientation`, `QUOTE_RANK` | `app/domain/market-pair.ts` | sections 1.1, 1.3, 1.5 | E4's DEX table, E5's pool cards, pages and market links |
| `trailPaging`, `MAX_TRAIL`, `parseTrail` | `app/domain/paging.ts` | section 3.6 | the account page, E5's lists |
| `AmmInfo`, `ammInfo`, `ammInfoByPair` | `app/server/node-rpc.ts` | section 4.2 | E5's pool pages |
| `pairCandles` (with `end`) | `app/server/data-api.ts` | section 4.3 | E5's swap-volume chart |
| The cache class `minute` (60 s + 30 s; subrequests kept 60 s) | `app/server/cache-class.ts` | section 2.5 | E4's analytics calls, E5's aggregates, E6's amendment pages |
| `formatChange` | `app/domain/format.ts` | section 4.4 | E4's value table |
| `LiveStateNotice`, `useRetry` | `app/ui/components/LiveStateNotice.tsx`, `app/ui/use-retry.ts` | section 4.4 | the account page; E4 (`useRetry`); E5's node notices |
| `BarList` items' `href` | the chart kit | section 4.4 | E5's fee votes |
| The `MARKETS` switch | `app/ui/features.ts` (E2's mechanism) | section 4.1 | the header, E4's and E5's market links |
| The `amm_info` fixture derivation, both `SUBJECT_PARAMS` forms | `scripts/amm-info-fixtures.ts`, `test/support/upstream-core.ts` | section 6 | E5's pool fixtures |
| The derived swap and trade rows of the recorded AMM ledgers | `scripts/derived-trades.ts` | section 6 | E5's swaps fixtures |

**README.** E3 adds the section "The markets pages" (after E2's "The network page"): the two pages, the asset form and its redirects, the natural orientation, the calls and their classes, the `MARKETS` and `AMM_DATA` behaviour, the node calls and the live pair page. It appends the pair page to the `live-home` list (E2 §6.9) and its row to "Switches".

---

## 5. Data interface

**Markets page**, all from `/v2/network/markets?period=&limit=1000[&amm=]` (D2 §7):

| Board element | Fields |
|---|---|
| Period | `period` (the request); the note: `start_time`, `end_time` |
| Quote, text filter | the explorer, over `base_currency`, `base_issuer`, `counter_currency`, `counter_issuer` |
| Trades (All / Order book / AMM) | `amm` (request); shown on XRPL while `AMM_DATA` is on |
| Tile DEX volume, Trades | Σ `native_volume`, Σ `count` of the rows listed |
| Tile Pairs shown | rows listed; "of `totals.pairs_traded` with trades"; the footnote's "of `totals.pairs`" |
| Tile AMM share of volume | `totals.amm_share` (read only while `AMM_DATA` is on; "—" when absent) |
| Pair, issuers | `base_*`, `counter_*`, oriented (section 2.4) |
| Last price, Change, Low – high | `last`, `change`, `low`, `high` (inverted when shown inverted) |
| Volume (native) | `native_volume` ("—" without one) |
| Trades | `count` |
| AMM share | `amm_share`, `amm_pool` (read only while `AMM_DATA` is on) |
| 7 days | `sparkline[].close` (7 days, `close` absent for a day without one) |

**Pair page:**

| Board element | Source | Fields |
|---|---|---|
| Pair, issuers | the URL | the two assets |
| Last price | `/v2/exchanges/{b}/{c}?descending=true&limit=20` | `exchanges[0].rate`, `executed_time` |
| Change 24 h | that, and `?reduce=true&start=` | `rate`; `open`, `count` |
| 24 h high, low, VWAP, volumes, trades | `?reduce=true&start=` | `high`, `low`, `vwap`, `base_volume`, `counter_volume`, `count` |
| Trades filter | `amm` on the three exchange calls (`feat/amm-data`) | |
| Price chart, readout, volume pane | `?interval=&start=&limit=61` | `start`, `open`, `high`, `low`, `close`, `base_volume`, `count` |
| Recent trades | `?descending=true&limit=20[&marker=]` | `executed_time`, `tx_hash`, `buyer`, `seller`, `taker`, `rate`, `base_amount`, `counter_amount`, `amm_account?`, `ledger_index`, `tx_index`, `node_index`; `marker` |
| Order book, depth, spread | node `book_offers` ×2 | `offers[].TakerGets`, `TakerPays`, `taker_gets_funded?`, `taker_pays_funded?`, `Account`, `Sequence`; `ledger_index`, `validated` |
| AMM pool card | node `amm_info`, pair form | `account`, `amount`, `amount2`, `trading_fee`; `ledger_index` |
| Share of pair volume | `?reduce=true&start=&amm=only` (and `exclude`) | `base_volume` |
| Most active traders | `/v2/active_accounts/{b}/{c}` | `accounts[].account`, `base_volume`, `count`; `count`; the pool account from `amm_info` |
| The AMM parts | E2's `AMM_DATA` switch (section 4.1) | no call |
| The anchor `T` | `/v2/last_validated` | `ledger_index`, `close_time` |

**Not used, and why.** These were read for this spec and are not called:

- `/v2/exchange_rates`, `/v2/normalize`: the pair page shows amounts in the pair's own currencies; native values come from D2's `native_volume`.
- `exchange_volume` components: the markets config only (5 XRPL markets, 1 on Xahau), which D2 replaced for this table.
- `/v2/amm/pools/{base}/{counter}` (`feat/amm-data`): the node's `amm_info` gives the live pool today, whichever branch the API runs. E5 uses the API's pool data for its own page.

**Missing, and where it comes from:**

| Missing | E3 meanwhile | Where it comes from |
|---|---|---|
| The markets table itself | `MARKETS` stays off where the data API lacks it (section 7) | D2 §7 |
| AMM share per pair and in total, and a trustworthy AMM filter | the AMM parts left out while `AMM_DATA` is off (section 4.1) | D2b, built after the owner merges `feat/amm-data`; D2 keeps the contract that the fields are absent until the window's data is complete |
| The `amm` filter and `amm_account` on trades | no Via column, no Trades filter while `AMM_DATA` is off | `feat/amm-data` |
| The order book | read from the node | the node (`book_offers`), an addition in `node-rpc.ts` |
| The pool's reserves and fee | read from the node | the node (`amm_info`, pair form), an addition in `node-rpc.ts` |
| An `amm` filter on `active_accounts` | the traders card ignores the Trades filter and says so | not needed; if wanted, `data-api-new` adds it |
| Paging on `active_accounts` | the top 5, with the total | not needed |
| Pairs with a lower-case standard 3-character code | listed without a link | the data API upper-cases such codes; not needed |
| Token names, logos, issuer names | codes and addresses | no source (foundation non-goal) |

---

## 6. Testing

**Unit (Vitest, `unit` project).**

| File | Covers |
|---|---|
| `app/domain/asset.test.ts` | `parseAssetText` for the native code (alone, lower case, with an issuer), standard codes in every case (upper-cased by `assetText`), text codes to hex and back, hex codes, every separator (`.`, `+`, a space, `\|`), two separators, `\|` in a code, all-zero hex, a bad checksum, an X-address issuer. `assetText` and `apiAssetText` round trips. `canonicalPair` against the pairs the fixtures' API answers order, and the reference's own example (`USD+r…`/`XRP`). `sameAsset`. |
| `app/domain/paging.test.ts` | `trailPaging`: the rules moved from `pagingOf`, whose tests still pass; `parseTrail` and `MAX_TRAIL` from their new place |
| `app/server/pair-route.test.ts` | Every row of sections 1.3 and 1.4, on top of `asset.test.ts`. `MARKETS` off: a 404 for every path. The native code alone and in lower case. `XRP.issuer` (404 on XRPL, valid on Xahau) and `XAH.issuer` (the reverse). 3-character codes with symbols, and one containing `\|` (404). A standard code upper-cased, a text code kept as written (`rlusd` is not `RLUSD`). 40-hex in lower case. 40-hex of a text code or a standard code becomes the text. LP tokens. All-zero hex. A bad checksum, an X-address issuer. `+`, `%2B` and `\|` become `.`. Two separators. The same asset on both sides. An escaped character that needs none. The redirect class (path only `immutable`, with the query `short`). |
| `app/domain/market-pair.test.ts` | `naturalOrientation` for every rank case and tie (XRP/USD, XRP/RLUSD by hex, EUR/USD, ETH/BTC, LIONS/XRP, EVR/XAH, two USD issuers, two unranked codes, LP tokens). `marketHref` round trips through `parsePairPath`, with the query of each page. |
| `app/domain/market-params.test.ts` | The canonical form of every query string of both pages: defaults, unknown values, repeats, unknown parameters, order, `trades` on Xahau, `interval` behind a marker, `back` without `marker`. |
| `app/server/markets-view.test.ts` | Orientation and inversion, exact: 8 significant digits, high and low swapped, `change` recomputed, volumes swapped, the sparkline inverted with its gaps. Quote filtering and re-orientation (both sides Q). Ranks, with ties and missing native volume. Exact tile sums. The AMM states from the switch (`on`, `off` with the fields present and ignored, `none` with Xahau's `"0.0000"` ignored), and "—" when `on` and the fields are absent. `amm_share` text at every boundary. The sparkline label. Rows that cannot be linked. The empty set. The `totals.pairs > count` note. No float in any string. |
| `app/server/pair-view.test.ts` | The book: both sides from hand-made `book_offers` answers; the price from full amounts and the size from funded ones; zero-funded offers skipped; equal prices merged; native conversion on either side; cumulative totals; the shared depth scale; the spread and its "—" cases; the inverted page from the same answers. `candleWindow` for every interval (Monday weeks, `T` on a boundary, 4 h clock buckets, the 2013-01-01 day count), alignment, gaps, the 61st candle ignored, `forming`. Trades: side, Via, keys, time text. Stats, the change and its empty case. The pool: price, fee text, share in each filter. Traders: the pool account left out when #8 names it, kept when #8 failed, the note's sentence. `existenceOf` for every row of section 1.4. Indexable. Tokens. |
| `app/server/meta.test.ts` | `marketsMeta` and `pairMeta`: titles, descriptions, canonical, `noindex` cases. |
| `app/domain/format.test.ts` | `formatPrice` (8 significant digits, half up, trailing zeros, exponent input, grouping) and `formatChange`. |
| `app/server/cache-class.test.ts` | `minute` (60 s + 30 s, its `Cache-Control`; a subrequest kept 60 s). |
| `app/ui/features.test.ts`, `scripts/predeploy-check.test.ts` | `MARKETS` among the switches: `featuresOf`, the cache generation, the guard refusing a missing or misspelt value |
| `test/unit/markets-bundle.test.ts` | Both routes' browser files import nothing from `app/server` and no address codec at run time. |
| `test/unit/pending-paths.test.ts` | Gains `/v2/network/markets`. |
| `test/unit/market-fixtures.test.ts` | The derived trade rows re-derive from the recorded ledgers. The synthetic answers obey the rules below. The recorded node answers are what PROVENANCE says (method, params, ledger). |

**Components (`components` project, happy-dom).**

- **`MarketsPage.test.tsx`**:
  - the first 100 rows and "Show all";
  - the text filter, after hydration only, with the count line's text (a `role="status"` that changes only on input);
  - the sort buttons, after hydration only, with `aria-sort`, reversal, and ranks only (no decimal parsing in the component);
  - the empty states;
  - the AMM column and tile on, off and on Xahau;
  - the link-less row.
- **`MarketPairPage.test.tsx`**:
  - every card state of section 3.9, the node notice's text and Retry;
  - the `LiveValue` tokens;
  - the trades hold and its release on unmount;
  - the Via column, the Trades filter and the share on and off (`AMM_DATA`);
  - the invert link keeping its parameters;
  - the pool card's link as the data gives it ("Pool page" and "Pool account");
  - the marker page (no live row);
  - the book table's hidden side cells.
- **The merge**: `keepLoaded` with `PAIR_PARTS` keeps a shown book, pool, share, stats, candles or traders through a beat that failed it (E2's `live-page.test.ts` covers `keepLoaded` itself).
- **`LiveStateNotice.test.tsx`**: the account page's notice unchanged (text, `role="status"`, Retry); a notice with another title and body and no role.
- **`routes-wiring.test.tsx`** gains the pair route: the `clientLoader`, the scope per view, a failed refresh keeping the page, and no live hook behind a marker.
- **The kit's component tests** gain the props of section 4.4: `"minute"` labels, `forming` text, `mark={false}` (a new token touches no ring), `BarList` items' `href` (a link on the label, none on the bar), `BarList tip="count"`, `Meter decorative`, prices never compacted.
- **`Header`**: Markets as "soon" with `MARKETS` off, as a link with it on, `aria-current="page"` on `/xrpl/markets` and `"true"` on a pair page (E2's `navSection`).

**Worker (`worker` project, recorded, derived and synthetic fixtures).**

`test/worker/markets-page.spec.ts`, through `pageClient`:

| Covers | Checks |
|---|---|
| Class | The page and its `.data` URL are stored as `minute`. |
| Redirects | The canonical redirects (302, `short`). |
| Calls | Exactly #1 per view, with its query (`mock.requests`). None before validation. |
| Failures | A 503 of #1 and its "Cannot GET" 404 (`null` override) are 503s, not stored. A malformed 200 is not stored. |
| Content | The tables and sparklines in the HTML. Xahau without the AMM column. The empty set. |

`test/worker/market-pair.spec.ts`:

| Covers | Checks |
|---|---|
| Validation | Every 404 of section 1.4 with **no upstream call**. The redirects and their classes. |
| Classes | The live page and its `.data` URL as `live-home`; a marker page as `slow`; a 404 as `short`. |
| Calls | Exactly the calls of section 3.3 per view, with query strings from the recorded `last_validated`. #1 under the home page's `[kept 2 s]` key; #2, #6 and #7 under `[kept 2 s]` keys. #4 as `minute` (kept 60 s) for `4h`, `1d` and `1w`. An inverted pair hits the natural page's `book_offers` and `amm_info` entries. No #8 or #9 on Xahau. Every call made with `holdFailure`. |
| Existence | 404 with an empty list and book. 503 with an empty list and a failing node. #10 only with a filter. |
| Card failures | Each card failure is a 200 with its notice or `SectionError` in the HTML, `Cache-Control: no-store`, not stored. The book shows "Live state unavailable" for a failing node and for a 3 s timeout. |
| AMM parts | With `AMM_DATA` on (the top level): the Via column, the Trades filter and the share, and #9. A failing #9: the share "Couldn't load", not stored. Traders without the pool account. |
| No JavaScript needed | The HTML holds the candles, the volume columns, the book, the trades and both chart views. |
| Meta | Natural default indexable. Inverted, filtered, marker and offer-only pairs `noindex, follow` (also in `meta.spec.ts`). |

`test/worker/markets-off.spec.ts`, in E2's `worker-off` project (every switch off): both routes, every view, answer the 404 with no upstream call; the header's Markets is "soon". With `MARKETS` on and `AMM_DATA` off (a load context with those values, in `market-pair.spec.ts`): no Via, no Trades filter, no share, no #9 call, and a `trades` parameter dropped by the canonical redirect on both pages.

`test/worker/market-pair-live.spec.ts` (a file of its own, for a fresh isolate):

- a herd of concurrent requests for one pair is rendered once;
- the `.data` URL is stored for 1 s with the build;
- two renders within 5 s with a failing `book_offers` make one node call (`statusesOf`; the failure hold).

`test/worker/node-rpc.spec.ts` gains:

- `bookOffers`: the request body, native and issued assets, the drops conversion, trimming, `validated` required, the new malformed codes as `bad_request`;
- `ammInfo` and `ammInfoByPair`: their bodies (`amm_account`; `asset` and `asset2`), one reader: drops to whole units, the ISO `expiration` to unix seconds, `vote_slots` and `auth_accounts` defaulted to `[]`, `validated` required, the pool account checked (pool form) and the assets of `amount` and `amount2` checked against the pair asked for (pair form), `trading_fee` and `time_interval` ranges, `actNotFound` and `actMalformed` as `not_found`.

`test/worker/data-api.spec.ts` gains the classes and TTLs of the new calls, `pairCandles` with and without `end` and with each `cls`, and `networkMarkets` throwing kind `server` on the API's "Cannot GET" 404 (E2's rule).

**Fixtures.** Written by `pnpm fixtures:sync` (a new `scripts/market-fixtures.ts`, called from `make-http-fixtures.ts`), and checked by `pnpm fixtures:check` and `scripts/http-fixtures.test.ts`. The node answers are recorded once by a new `scripts/record-node-fixtures.ts`, which only reads from public nodes.

| Files (below `test/fixtures/http/<net>/`) | Source |
|---|---|
| XRPL `data-api/exchanges/XRP/524C…+rMxCKb…@descending=true&limit=20.json` and its inverted twin, its marker pages, and `&amm=exclude` / `&amm=only` | **derived** by `scripts/derived-trades.ts` (below): the XRP/RLUSD trades of the recorded AMM ledgers, the pool swaps of `swap_payment_xrp_iou`, `swap_offercreate_xrp_iou` and `payment_pool_and_book` (with `amm_account`), and that case's order-book trade. |
| XRPL `…/4C494F4E53…+rGHtf1…/XRP@…` | **derived**: the recorded LIONS/XRP trades the account fixtures already use |
| the candles (`interval=`, each interval), `reduce=true`, `active_accounts` of those pairs | **derived**: aggregated from those trades by the reference's rules (whole buckets, 8-significant-digit prices, exact sums, native legs above 0.0005) |
| Xahau EVR/XAH trades and aggregates | **synthetic** (Xahau's recordings hold no trade) |
| `data-api/network/markets@[amm=…&]limit=1000&period=….json` (3 periods × 3 filters on XRPL, 3 periods on Xahau; the query sorted, as every file) | **synthetic**. The rows of the derived pairs are computed from their derived trades, with seeded other pairs. The default fixtures include `amm_share` (D2b's API), which the top level's `AMM_DATA: "on"` reads; one period's answer without the AMM fields is an override, for the "—" case. |
| `node/book_offers/<gets>_<pays>@limit=60.json`, both sides of each pair | **recorded** from `https://s1.ripple.com:51234/` and `https://xahau.network/` |
| `node/amm_info/<POOL>.json` and `node/amm_info/<asset>_<asset2>.json` for each pool of `AMM_INFO_POOLS`: E3 lists XRP/RLUSD (pool `rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3`) | **derived** by `scripts/amm-info-fixtures.ts` (below). One answer per pool, written under both subjects. A pair or account without a pool (LIONS/XRP, an ordinary account, a deleted pool) has no file and gets the node's `actNotFound`. |

**Generator and naming rules.**

- The synthetic generator is E2's: mulberry32, seeded per network and endpoint, following the reference. The markets shape is D2's built `docs/api-reference.md` on `feat/explorer-data`, at the commit the plan pins (D2 is built before E3), not D2's spec text. `feat/amm-data` sets `amm_account`; D2b's reference, once written, sets `amm_share` (until then D2's contract for the absent AMM fields, which the plan names).
- `test/support/upstream-core.ts` gains node subjects, the two forms of `amm_info` included:
  - `SUBJECT_PARAMS` gains `amm_info: ["amm_account"]`: a pool-form request's subject is the pool account;
  - a request without `amm_account` (the pair form) has the subject `<asset>_<asset2>`, and `book_offers` has `<taker_gets>_<taker_pays>`; `nodeSubject` builds both from the request's asset objects;
  - an asset is written in the API's form: the native code, or `CUR+issuer` with the code as the ledger holds it (`apiAssetText`);
  - the missing-file answers: `amm_info` gets `actNotFound` (`NODE_ABSENT`); `book_offers` gets an empty book (`offers: []`, `validated: true`) at the newest recorded ledger, which is what a node says for a book nobody offers in;
  - data API path segments are named by their decoded text, as now.

**`scripts/derived-trades.ts`** (E3's; E5's swaps fixtures use it). `derivedExchanges(ledgers)` turns recorded ledgers into `/v2/exchanges` rows by the reference's rules: an order-book trade from each consumed or changed offer node of a transaction's metadata; a swap from the pool's own balance changes, with `amm_account` the pool and its `buyer`/`seller` as the reference sets them; amounts exact, `rate` at the reference's precision, the reference's key order, keyed by `ledger_index`, `tx_index` and `node_index`. It reads `ledgers/xrpl-amm/`, `ledgers/xrpl/` and `ledgers/xrpl-extra/`, and the pool hops by the rules of `app/domain/parse/amm-hops.ts`. `market-fixtures.ts` writes the pair lists, candles, `reduce` and `active_accounts` from its rows; E5's `/v2/amm/pools/<POOL>/swaps` files are its rows of that pool.

**`scripts/amm-info-fixtures.ts`** (E3's; E5 adds its featured live pools to `AMM_INFO_POOLS`). For each pool, the state its newest recorded transaction left, served at the newest recorded ledger: the amounts from its `AccountRoot` and its reserve trust lines; the LP token, the trading fee, the vote slots and the auction slot from its `AMM` node; `time_interval` worked out from the slot's expiration and that ledger's close time; `validated: true`. It writes the answer twice, under the pool-form subject (`<POOL>`) and the pair-form subject (`<asset>_<asset2>`, the pair in the natural orientation, as the pair page asks).

**Provenance.**

- `test/fixtures/PROVENANCE.md` gains "Recorded node answers": the node URL, the time, each answer's `ledger_index`, and the recorder's command.
- E2's "Synthetic aggregates" gains the markets rows, and a "Derived trades and pool states" section names the recorded cases, `derived-trades.ts` and `amm-info-fixtures.ts`.
- The README's "Upstream fixtures" table marks each kind ("recorder", "generator (derived)", "generator (synthetic)").

Book states the recordings may not hold are the view builder's unit tests, with hand-made answers in the test: partial funding, equal prices, zero funding, an empty side. The end-to-end suite against a real stack (`E2E_DATA_API_URL`) catches drift from real answers.

**End to end (Playwright).**

`test/e2e/markets.spec.ts`:

- "Markets" in the header leads to `/xrpl/markets` in one document, with `aria-current="page"` (skipped, with the "soon" label checked instead, when `E2E_FEATURES_OFF` lists `MARKETS`);
- "7 days" sets `?period=7d`, adds `noindex` and drops the canonical link, and Back restores them;
- "Quote XRP" re-orients a row (its link goes to the inverted pair);
- the text filter narrows the rows and the status line says so;
- a sort press sets `aria-sort` and reorders;
- "Show all";
- with JavaScript off (`contextFor`) the table and sparklines are there and no filter field is;
- a row leads to its pair page.

`test/e2e/market-pair.spec.ts`:

- the interval control changes the URL and the chart;
- "Show RLUSD/XRP" goes to the inverted pair, which is `noindex`;
- Older and Newer on the trades keep `trades`, and the marker page has no live row;
- an issuer leads to its account page, a trade time to its transaction;
- the pointer over the candles shows the readout, and Tab to the slider with Arrow Left changes `aria-valuetext`;
- with JavaScript off, the chart, book and trades are there;
- the Via column and the Trades filter with the default fixtures; the test skips itself when `E2E_FEATURES_OFF` lists `AMM_DATA` (E2 §6.1), and then checks that both are absent;
- the traders card does not list the XRP/RLUSD pool account.

`test/e2e/market-pair-live.spec.ts`, in the `live` project, alone after the others (it changes the fixture server's answers):

- a new trade arrives through the fixture server: it enters with `.is-entering`, the price ticks in, and only the route's `.data` URL is asked for;
- reduced motion: no transform;
- pause and resume;
- the trades hold;
- `book_offers` overridden to fail: "Live state unavailable" on a fresh load, and a shown book kept through a failing beat;
- a 503 of the page keeps it, and "Live updates paused, retrying…" appears after two;
- `/v2/network/markets` overridden away (the API's "Cannot GET"): the markets page answers 503, and the pair pages are unaffected (they do not call it).

**Accessibility.** `a11y.spec.ts`, axe with the WCAG 2.2 AA tags. The gate is no violation of impact serious or critical.

| Pages | Matrix |
|---|---|
| `/xrpl/markets`, `/xrpl/markets/XRP/RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De` | 1280 px and 375 px × the four theme settings (light and dark by system; dark and light chosen by the toggle against the other system theme) |
| `/xahau/markets`, `/xrpl/markets?period=30d&quote=usd`, the inverted pair, a pair behind a marker, a pair with the node failing, the pair 404, the markets page with the text filter in use, the pair with the candle slider focused | the two system themes |

`landmark-unique` and the ARIA "needs review" test cover both pages too.

**Bundle.** `PAGES` in `scripts/bundle-budget.ts` gains `{ name: "markets", route: "routes/net.markets" }` and `{ name: "market-pair", route: "routes/net.markets.$base.$counter" }`, and `scripts/check-bundle.test.ts` follows. The gate stays 150,000 B gzip.

- Targets: markets **140,000 B** or less (no cursor, no live code), pair **146,000 B** or less.
- If the pair page builds over its target, E2's decided fallback applies: `Cursor` and the tooltip are loaded with `import()` on the first `pointerenter` or `focusin` of a plot.

---

## 7. Rollout

| Step | What ships | Behaviour |
|---|---|---|
| 1. E3 built (after E2, before E4), while `feat/amm-data` is unmerged | Everything in this spec. `networkMarkets` in `PENDING_PATHS`. The fixtures of section 6. Switches: `MARKETS` "on" at the top level and "off" in staging and production; `AMM_DATA` as E2 left it ("on" at the top level, "off" in staging and production). | Deployable anywhere: where `MARKETS` is off, the markets URLs are 404s without a call and the header says "soon". The suites run the pages with every part. |
| 2. D2 deployed to **staging** (syncer first, then the API, D2 §16) | | `pair_hourly` fills its 31 days in minutes and the markets sets appear. D2 §16.4 names the gauges that gate `MARKETS`: wait for `syncer_pair_hourly_missing_hours` = 0 and `syncer_markets_live_age_seconds{period="day"}` under 120. (`rates_daily` and the rollups do not feed the markets table.) |
| 3. `MARKETS` on in **staging** | `"on"` in `env.staging.vars` (a commit), `pnpm deploy:staging` | The Markets link and pages appear at once (the cache generation, E2 §6.1). The end-to-end suite runs against staging (`E2E_BASE_URL`, `E2E_FEATURES_OFF=AMM_DATA`, and once `E2E_DATA_API_URL` against the staging stack), plus the staging checklist below. With `AMM_DATA` off: no Via, no Trades filter, no AMM tile or column, the plain intro. |
| 4. D2 deployed to **production**, with the same gauges | | |
| 5. `MARKETS` on in **production** | `"on"` in `env.production.vars` (a commit), `pnpm deploy:production` | The Markets link goes live. `MARKETS` is never on where the data API lacks `/v2/network/markets`: the markets page would answer 503 (a missing route is an outage, E2 §6.4). Rolling back is "off" and a deploy. |
| 6. `feat/amm-data` merged into `data-api-new` `main` and deployed, history re-ingested with the AMM parser and back-filled, D2b deployed | no explorer change yet | The markets answers carry `amm_share` once each window's ledgers are all AMM-parsed (D2's own rule). |
| 7. The owner turns `AMM_DATA` on, per environment (E2's rollout, step 3) | a commit and a deploy | The AMM parts appear on both pages at once. A period whose answer still lacks `amm_share` shows "—" in the tile and the column. |
| 8. Then, in the explorer | `pnpm api:sync` (the commit names the source commit). `pending-paths.test.ts` fails, and `networkMarkets` moves from `PENDING_PATHS` to `PATHS`. | none |
| 9. E5, built last | E5's own switch, `AMM_PAGES` (E5 §1.4); E5's plan moves the pool card onto `poolLink` (E5 §5.3), and E5's market links use `marketHref` behind `MARKETS` | The pool card's link becomes "Pool page" where `AMM_PAGES` is on. |

**The staging checklist (README) gains:**

- `book_offers` and `amm_info` against the deployed nodes: `limit: 60` accepted; funded fields present for a partly funded offer; xahaud takes `{ "currency": "XAH" }` for its native side.
- The node call rate with pair pages open (`wrangler tail`): about two `book_offers` per 2 s per watched pair per instance, and the failure hold on a failing node.
- The markets page's age: the period note's end within about two minutes of now for 24 h.
- The HTML weight of `/xrpl/markets?period=30d` (1,000 rows).
- The AMM parts appearing after `AMM_DATA` is turned on (step 7), and the traders card without the pool account.
- The bundle figures of both pages.
