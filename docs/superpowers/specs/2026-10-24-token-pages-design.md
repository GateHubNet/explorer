# Token pages: design (E11)

Status: proposed (2026-10-24), program 2, sub-project E11. Repository `GateHubNet/x-explorer`, branch `feat/explorer-pages-2`.

- Boards: `2026-10-24-explorer-mock/Tokens.dc.html` (the list), `TokensMpt.dc.html` (its MPT tab, built by E14), `Token.dc.html` (one
  token), `Account.dc.html` (the Tokens card). Their data is made up.
- Program: `2026-10-24-explorer-program-2-overview.md`. The data side is D6, data-api
  `docs/superpowers/specs/2026-10-24-issued-tokens-design.md` (the routes, fields and rules this spec reads; "D6 §n" below).
- Built after E9 (`2026-10-24-display-names-design.md`: display names in `AccountLink`, the one names call per loader, label marks)
  and E10. Uses as their owners define them: E8's coverage pieces (`Coverage`, `checkCoverage` and `coverageNote` in
  `app/server/coverage.ts`, the `CoverageNote` component); E2's switches, `navSection` and chart kit; E3's `app/domain/asset.ts`, `marketHref`,
  `naturalOrientation`, the class `minute`, `useRetry`; E5's `poolLink`, `ammPools`, the live `ammVolume`, `Pager` labels; E7's
  sandbox and network names. E12 owns the header's Network menu, E14 the MPT tab's content.

## Owner decisions to confirm

| # | Choice | Recommendation |
|---|---|---|
| 1 | The board's "Supply over time" and "Holders over time" charts, the Holders tile's "+N in 90 days" and the `…/stats?interval=day` captions are left out: they need a daily statistics job (owner's cut). | Deferred. |
| 2 | The token page's first tile reads **"Supply"**, as the list's column, not "Circulating" (the glossary's word for the native currency less escrow). | As written. |
| 3 | The toml card reads the token answer's `toml` (`/v2/tokens/{token}`, built by D6 from D4's toml store), without a second call to D4's `/v2/toml/{domain}`; the entry's `icon` is a link, never drawn (no third-party image on the page). | As written: one call, the same store. |
| 4 | "Order book pairs" becomes **"Markets"**: the token's pairs of the last 24 h (DEX and AMM trades) from the token answer, one call, not a `reduce` per pair. | As written. |
| 5 | The AMM pools card shows the 5 most valuable pools with the token (`/v2/amm/pools?asset=`), their 24 h volume from the live AMM volume, and "All pools with {CODE} →". | As written. |
| 6 | Price is the last trade against the native currency in 24 h, else in 30 days ("last trade Oct 3"), else "—"; the change only from 24 h. | As written. |
| 7 | List tiles: "Holders" counts accounts holding **any** issued token; "Volume, 24 h" is the whole DEX's (every pair). | As written (D6 decision 8). |
| 8 | 20 tokens a page (the board shows 12); the search is a GET form answered by the API; "Show all" is a link (`?all=1`). | As written. |
| 9 | Ranks come from the API; the list is a ranking rebuilt every minute, so a token can move between pages. | As written. |
| 10 | "All N holders →" opens `/{net}/token/{token}/holders`, 50 a page. | As written. |
| 11 | Recent transfers: 20, newest first, Older/Newer on the token page (`?marker`), rows from or to the issuer tagged "Issued" / "Redeemed". | As written. |
| 12 | A token the index does not know is a 404 with a coverage note and the issuer's account (no node fallback); the issuer's settings come from the node when the index has none. | As written. |
| 13 | An LP token's URL redirects to its pool page. | As written. |
| 14 | The MPT tab is drawn disabled: "soon" on XRPL until E14, the board's note on Xahau. | As written. |
| 15 | Links into token pages: the account page's Tokens card (a line the account owes on links to the account's own token), the "issued by" lines of the pair and pool pages, and a search for `CUR.issuer`. | As written. |
| 16 | "Tokens" sits in the header after Transactions, before Network (the boards' "Accounts" item is not built; E8 §1.1 gives the header's three steps). | As written: the board's place. |
| 17 | A link-preview image for a token (`/og/{net}/token/{token}.png`). | As written. |
| 18 | E8's `CoverageNote` under the list, the token's figures, its holders and its transfers while their coverage is not complete. | As written: E8's one note. |

## Goal

`/{net}/tokens` and `/{net}/token/{currency}.{issuer}` show every element of the Tokens and Token boards that D6 can fill,
server-rendered and readable without JavaScript, with display names for issuers and holders; every place that shows an issued token's
code can lead to its page. The pages ship off behind `TOKENS` and change nothing until it is set.

## Scope and non-goals

In scope: the three routes (list, token, holders), their loaders, views and components; the `TOKENS` switch; the header item; links
from the account, pair and pool pages; search; tags and the link-preview image; fixtures and tests.

Not in scope:
- Supply and holders over time (decision 1). MPT rows, the MPT tab's content and `/{net}/mpt/…` (E14).
- Token logos (the toml `icon` is not drawn), price charts on the token page (the pair page has them), a display currency.
- Tokens in the transaction page's amounts, the markets table's codes, live hints in the search box for `CUR.issuer`.
- An issuer's list of its tokens on its account page (a `?q={address}` link would do it later).

---

## 1. Routes

### 1.1 Files

| File | |
|---|---|
| `app/routes/net.tokens.tsx` | `route("tokens", …)` under `:net`: the list. `loader`, `meta`, `headers = forwardCacheClass`, `handle = { navSection: "tokens" }`. |
| `app/routes/net.token.$token.tsx` | `route("token/:token", …)`: one token, its transfers' pages. |
| `app/routes/net.token.$token.holders.tsx` | `route("token/:token/holders", …)`: all holders. |
| `app/domain/token-params.ts` | Pure: `parseTokensParams`, `tokensHref`, `parseTokenPath`, `tokenHref`, `tokenHoldersHref`, `tokenLink`, `TOKEN_KINDS`. |
| `app/server/token-view.ts` | View builders: `tokensPage`, `tokenPage`, `tokenHoldersPage`, and their parts (`priceView`, `settingsRows`, `tomlCard`, `marketRows`, `poolRows`, `transferRows`). Pure; unit-tested. |
| `app/server/token-shape.ts` | Shape checks of D6's four answers, run inside the cached loads. |
| `app/server/meta-tokens.ts`, `meta-token.ts` | The tags (one module per page, the README's rule). |
| `app/ui/pages/TokensPage.tsx`, `TokenPage.tsx`, `TokenHoldersPage.tsx` | Draw the pages from their data; never fetch. |

Changes elsewhere: `data-api.ts`, `api-types.ts`, `pending-paths.ts` (§9); `features.ts`, `env.ts`, `wrangler.jsonc`,
`vitest.config.ts` (`TOKENS`, §1.4); `route-handle.ts` (`NavSection` gains `"tokens"`); `Header.tsx` (§5.1); `AccountPage.tsx`,
the pair page's side card, the pool card (§5.2); `search-view.ts`, `SearchPage.tsx` (§5.3); `card-data.ts`, the og route, `ImageKind`
(§7.2); `scripts/bundle-budget.ts`; the fixture generator (§12); `loader-errors.ts` (the 404's `note`, E5's, reused); the README.

### 1.2 URLs and parameters

| Path | Parameters, in canonical order | Defaults |
|---|---|---|
| `/{net}/tokens` | `kind` (`mpt`, reserved for E14), `q` (a search, trimmed, at most 64 characters), `all` (`1`: also tokens with fewer than 10 holders), `marker`, `back` | the issued tokens with 10 or more holders |
| `/{net}/token/{token}` | `marker`, `back` (the transfers' trail) | |
| `/{net}/token/{token}/holders` | `marker`, `back` | |

**`{token}`** is E3's asset form (`assetText`): `CODE.issuer`, a 3-character code in upper case, a text code as its text
(`NPUSD.r…`), any other code as 40 upper-case hex digits. `parseTokenPath` reads it with `parseAssetText` (so `+`, `|` and a space are
read as the separator, and 40 hex digits are accepted and decoded), and the canonical path is `tokenHref(net, asset)`; the data API is
sent `{currency}.{issuer}` with the currency as the ledger holds it (D6 §5.2). Each loader reads only its parameters and answers a
302 to the canonical URL otherwise (`redirectToCanonical` of `pair-route.ts`: `immutable` when only the path differs, `short` when
the query does), dropping unknown parameters, empty values, repeats, `back` without `marker`, and `kind=mpt` while E14 has not made it
a view.

### 1.3 Validation, not found, redirects

Everything a URL carries is checked before any call: the asset (`parseTokenPath`), a marker (`isMarker`), a trail (`parseTrail`),
`q` (at most 64 characters).

| Request | Answer | Class |
|---|---|---|
| any token route while `TOKENS` is off | 404 "We couldn't find the token pages on {network}", no call | `short` |
| `{token}` that is not an asset with an issuer (`XRP` alone included) | 404, no call; for the native code the note "XRP is XRPL's own currency, not an issued token." | `short` |
| `{token}` in another spelling (`usd.r…`, the hex of `NPUSD`, the hex of `USD`, `NPUSD+r…`) | 302 to the canonical path, no call | `immutable` |
| an LP token (`03…` hex) | 302 to `poolLink(net, issuer, features)`: the pool page, or the account page while `AMM_PAGES` is off; no call | `slow` |
| `/{net}/tokens?q=` longer than 64 characters | the list with the field's message "Search for at most 64 characters" and no list call; `noindex, follow` | `short` |
| D6 answers `token not found` | 404 "We couldn't find {CODE} issued by {short issuer} on {network}", suggestion "Open the issuer's account"; while D6's coverage is not complete, the note `coverageNote(coverage, "trust lines")` and "A token whose trust lines have not changed since is not listed yet." (an error answer has no `coverage`, so it comes from a `limit=1` list call made only for this 404, class `minute`) | `short` |
| D6 fails (5xx, 429, timeout, a malformed 200, a 400 for a path the loader checked, the "Cannot GET" 404 of an API without D6) | 503 through `upstreamOutage` | not stored |
| a marker D6 refuses (400), or a marker page with nothing behind it | 404 | `short` |

### 1.4 The `TOKENS` switch

A page-level switch of E2's mechanism: `TOKENS` appended to `FEATURE_VARS` (after the switches program 2 added before it), `tokens`
in `Features`, an `Env` field, an entry in every block of `wrangler.jsonc` (`"on"` at the top level and in the tests, `"off"` in
`sandbox` and `production`), `TOP_LEVEL_SWITCHES`, the README's tables, the pre-deploy guard's misspelling test, and its
`*-off.spec.ts`. While off: the three routes and the token images are 404 without a call, the header item reads "soon", and every
token link is what it was before E11 (§5). It goes on in an environment once that environment's data API serves D6 with a live
generation (`syncer_tokens_live` 1, `syncer_tokens_lag_ledgers` under 300).

`tokenLink(net, asset, features)` is the one place that decides where a token's code leads: the token page while `features.tokens`,
else nothing (the code stays text). An LP token's code keeps going to its pool (`poolLink`).

---

## 2. The list, `/{net}/tokens`

### 2.1 Layout and content

From the top, as on the board; one column on a phone.

| Element | Content |
|---|---|
| Breadcrumb | "{network} / Tokens" |
| Heading | `<h1>` "Tokens"; intro "Tokens on {network}, ranked by holders. Names come from each issuer's toml." |
| Kind tabs | `SegmentedLinks` "Kind of token": "Issued tokens" (current) and "MPT" (§2.2); source line `/v2/tokens?kind=issued&min_holders=10` (or without `min_holders` under `?all=1`) |
| Tiles (`StatGrid` "Totals") | "Tokens with 10+ holders": `totals.tokens_with_10_holders`, sub "{tokens − that} more have fewer than 10 holders". "Holders": `totals.holders`, sub "accounts holding at least one issued token". "Volume, 24 h": `totals.native_volume` compact with the native code, sub "DEX and AMM trades of every pair" (Xahau: "DEX trades of every pair"); "—" without it. |
| Coverage note | E8's `CoverageNote` with `coverageNote(coverage, "trust lines")` ("Covers ledger #N onwards: earlier trust lines are not in the index yet.", the ledger a link), directly under the table (E8's placement); nothing when `complete` |
| Card "Issued tokens" | Filters: the GET form (field "Code, name or issuer", a "Search" button, 44 px) and the link "Show all ({n} hidden)" / "Hide tokens with fewer than 10 holders". The `DataTable` (columns below). Under it: the note ("Showing 1–20 of 1,284 tokens with 10 or more holders"; with `q`, "12 matches · 3 more among tokens with fewer than 10 holders", the second part a link to the same search with `all=1`), the footnote "Holders: accounts with a positive balance. Supply: the sum of their balances. Price: the last trade against {native}." and `Pager` ("Previous" / "More tokens"). Empty: "No issued tokens match “{q}”." |

**A row.**

| Column | Content |
|---|---|
| # | `rank` |
| Token | the coin (`PairCoins` with one code, `aria-hidden`), the display code (`formatCurrency`; a hex code that decodes is shown as its text with the hex in `title` and in a visually hidden sentence), the toml `name` under it; one link, `tokenHref` |
| Issuer | `AccountLink` (E9: the display name, its verified, "Named by GateHub" or "not verified" mark, the label mark, the address on hover) |
| Holders | `holders`, grouped digits |
| Supply | `supply`, `compactNumber` |
| Price ({native}) | `price`, `formatPrice`; "—" without one |
| Volume 24 h ({native}) | `native_volume`, compact; "—" without one |
| Listed in the issuer's toml | `listed`: the icon and "listed" (with "in the issuer's toml" visually hidden); else "—" with "not listed in the issuer's toml" hidden |

### 2.2 The kind tabs and E14's seam

`TOKEN_KINDS = ["issued", "mpt"]`. `parseTokensParams(search, net)` returns `kind`: `issued`, or `mpt` only where the view builder
is told MPT is available (`mptAvailable`, false in E11). The tab model `kindTabs(net, kind, mptAvailable)` gives "Issued tokens" as a
link and "MPT" as a link when available, else disabled: "soon" on a network that has MPT (XRPL, its testnet), and on Xahau disabled
with the board's note "MPT isn't enabled on Xahau." (`aria-describedby`). `TokensPage` draws the tabs, the tiles and the coverage
notice from the page data whatever the kind, and the body by kind: `IssuedTable` here; E14 adds `MptTable`, the `mpt` branch of the
loader (the same call with `kind=mpt`), its tiles and its `MPT` switch, and sets `mptAvailable`. The list call, the trail, the search
form and the notice are shared.

### 2.3 Data calls

| # | Call | Class | Feeds | On failure |
|---|---|---|---|---|
| 1 | `/v2/tokens` with `kind=issued`, `limit=20`, `min_holders=10` (left out under `all=1`), `q`, `marker` | `minute` | tiles, notice, table, note | 503 (the page is this call), 404 for a refused marker |
| 2 | E9's names call for the page's issuers | E9's | display names | addresses, as E9 says |

### 2.4 The loader

`requireNetwork`; switch off: 404. The canonical redirect. A `q` too long: the page with its message, no call. Call #1; then the
names call: E9's `collectAddresses(…)` over the rows' issuers and `loadNames(api, addresses, ctx)`, with `names` in the page data (E9
§3). `tokensPage(...)`; `cached(page, "minute")` for the first page and behind a marker alike: the ranking changes with the
API's minute (E5's reasoning for the pools list).

---

## 3. The token page, `/{net}/token/{token}`

### 3.1 Layout and content

From the top, as on the board; on a phone one column, the paired cards folding (`flex: 1 1 420px`).

| Element | Content |
|---|---|
| Breadcrumb | "{network} / Tokens / {CODE}" |
| Header card | The coin. `<h1>` the toml `name`, else the display code. A tag with the display code (hex: the decoded text, the hex in `title` and in a hidden sentence, and a `CopyTextButton` for the hex); a tag "Issued token". "Issued by" `AccountLink` of the issuer. Buttons: "Issuer account" (`/{net}/account/{issuer}`) and, with a `toml_url`, "{xrp-ledger.toml or xahau.toml}" opening it in a new tab (`rel="noopener nofollow"`, "(opens a new tab)" hidden). Source line `/v2/tokens/{currency}.{issuer}`. |
| Coverage note | as on the list (`"trust lines"`), under the figures |
| Figures (`StatGrid` "Figures") | "Supply": `supply` exact (`formatAmount`), sub "{CODE}, the sum of all holders' balances". "Holders": `holders`, sub "accounts with a positive balance". "Trust lines": `trust_lines`, sub "{trust_lines − holders} of them with a zero balance". "Price": "{price} {native}", sub "▲ +0.12% in 24 h" (icon and text) or "last trade Oct 3" (a `price_time` older than the 24 h) or "No trade against {native} in 30 days" with "—". "Volume, 24 h": `native_volume` compact, sub "{trades} trades on the DEX and AMM" (Xahau: "on the DEX"). |
| Toml card | Listed: "From {domain}'s toml", "The `[[CURRENCIES]]` entry for {CODE} in {host}/.well-known/{file}." and, when E9's names call gives the issuer a verified name of that domain, "The toml also lists the issuer, which makes its name verified."; a `DetailList` of `code`, `issuer`, then the entry's fields in D6's order (`name`, `desc`, `icon` as a link, `symbol`, `display_decimals`, `asset_class`, `asset_subclass`, `attestation`, an `https:` URL as a link, anything else as text), and "Currency code in hex" with the board's sentence for a hex code. With a domain but not listed: "{domain}'s toml has no `[[CURRENCIES]]` entry for {CODE} by this issuer." Without a domain: "The issuer's account names no domain, so no toml describes {CODE}." |
| Issuer settings card | "Set on the issuer's account. They apply to every holder of {CODE}." Six rows, each an icon, the name, a `Pill` and the board's sentence: Transfer fee ("None" / "0.2%"), Global freeze (On/Off), No freeze (Set/Not set), Clawback (Allowed/Not allowed), Require auth (On/Off), Default ripple (On/Off). From `issuer_settings`; without it, from the node's `account_info` (§3.2 #7), with the caption "Read live from the network"; when both lack it, "The issuer's settings couldn't be read." |
| Markets card | "Markets", source line `/v2/tokens/{currency}.{issuer} · last 24 h`. Columns Pair ("{CODE} / {COUNTER}", the counter's issuer under it as `AccountLink`), Last price ("{last} {COUNTER}"), Volume 24 h ({native}), Trades. The pair links to `marketHref(net, …)` in E3's natural orientation while `MARKETS` is on. Footnote "Prices are the counter currency per {CODE}. DEX and AMM trades of the last 24 hours." (Xahau: "DEX trades"). Empty: "{CODE} had no trades in the last 24 hours." |
| AMM pools card (XRPL) | "AMM pools", source line `/v2/amm/pools?asset={CODE}.{issuer}`. The first 5 pools of the answer (by value): Pool (the pair in E3's natural orientation, `poolLink`), Value ({native}, compact; "—"), Trading fee (`300` → `0.300%`), Volume 24 h (the pool's component of the live AMM volume, compact; "0" for a native pool without one, "—" otherwise, E5's rule). "All pools with {CODE} →" to `/{net}/amm?asset={token}` when the answer has more than 5 (while `AMM_PAGES` is on). Empty: "No AMM pool holds {CODE}." Footnote "Value and volume in XRP." |
| AMM card (Xahau) | the board's "Xahau has no AMM, so {CODE} trades only on the order book here." |
| Top holders card | "Top holders", source line `…/holders`. Columns #, Holder (`AccountLink`), Balance ({CODE}, `formatAmount`), Share of supply (the kit's `Meter`, `aria-hidden`, scaled to the first holder's share, and "11.73%"). A frozen line has a "Frozen" tag. Under it: "The top 10 hold 39.15% of the supply." (the sum of the ten shares, as percent with 2 decimals) and "All {holders} holders →" (`tokenHoldersHref`). Empty: "No account holds {CODE}." |
| Recent transfers card | "Recent transfers", source line `…/transfers`. Columns Time (UTC, `formatUtc`), From, To (`AccountLink`), Amount ({CODE}), Transaction (`HashLink`, short). A row from the issuer has the tag "Issued", one to it "Redeemed". Footnote "Newest first. A transfer from {issuer's display name} issues new {CODE}; one to it redeems {CODE}." `Pager` (Newer / Older, the trail). Under it the transfers answer's `CoverageNote` (`"transfers"`). Empty: "No payment has delivered {CODE} yet." |

### 3.2 Data calls

| # | Call | Class | Feeds | On failure |
|---|---|---|---|---|
| 1 | `/v2/tokens/{t}` | `minute` | header, figures, toml, settings, markets | 404 / 503 (§1.3) |
| 2 | `/v2/tokens/{t}/holders?limit=10` | `minute` | top holders | the card's `SectionError` |
| 3 | `/v2/tokens/{t}/transfers?descending=true&limit=20` | `live` | transfers | the card's `SectionError` |
| 4 | `/v2/amm/pools?asset={CUR}+{issuer}&limit=20` (XRPL) | `minute`: the key of the AMM list filtered by the token | pools | the card's `SectionError` |
| 5 | `/v2/network/amm_volume?live=day` (XRPL) | `minute`, shared with the AMM pages | pools' 24 h volume | the column "—" and the card's note "Couldn't load the 24-hour volume" |
| 6 | E9's names call: the issuer, the 10 holders, the transfers' parties, the markets' counter issuers (at most 71 addresses) | E9's | display names | addresses |
| 7 | the node's `account_info` of the issuer, only when #1 has no `issuer_settings` | `live` | settings | the settings card's message |

### 3.3 The loader and its modes

1. `requireNetwork`; switch off: 404. `parseTokenPath`: not an asset, a native code, an LP token or another spelling are answered
   without a call (§1.3). The canonical-query redirect.
2. **First page**: #1 to #5 side by side with `Promise.allSettled`, each raced against E2's 4.5 s card deadline; #1's not-found or
   failure decides the page (§1.3); then #7 if needed, then #6. `tokenPage(...)`; a failed card is logged and marks the page degraded.
   `cached(page, "live")`.
3. **Behind a marker** (`?marker=…`): #1, #3 with the marker (`MARKER_PAGE_CLASS`) and #6 for its parties; the page is the header card
   and the transfers card only, with a link back to the first page; `noindex, follow`; `cached(page, MARKER_PAGE_CLASS)`. A refused
   marker or an empty page is a 404.

### 3.4 View builder rules (`tokenPage`)

| Part | Rule |
|---|---|
| Display code | `formatCurrency(currency)`; D6's `code` is not needed for display |
| Figures | exact strings through BigNumber; `trust_lines − holders` with BigNumber; no float in any text |
| Price sub | `price_change` present: arrow icon and text by sign; else `price_time` (UTC date); else none |
| Settings | `issuer_settings` mapped to the six rows; the node's `account_info` mapped with the account page's flag tables (per network) and `TransferRate` by D6's formula |
| Markets | D6's order; each pair's natural orientation for its href only, the row stays "{CODE} / {COUNTER}" |
| Pools | the answer's first five (it is ordered by value); the live components joined by `amm_account` (E5's join) |
| Holders | `share × 100` to 2 decimals; the meter's width relative to the first row's share |
| Transfers | the "Issued"/"Redeemed" tag by `source` / `destination` equal to the issuer; paging by `trailPaging` with `tokenHref` |
| Names | every address the page shows goes into the one names call: E9's `collectAddresses(…)` over the shown parts, then `loadNames(api, addresses, ctx)`; `AccountLink` (E9's props) draws them |

### 3.5 Failures

| What failed | Page | Stored |
|---|---|---|
| #2, #3 or #4 | the card's `SectionError` with Retry (`useRetry`) | no (degraded) |
| #5 | the pools' volume column "—" and its note | no |
| #6 | addresses instead of names (E9) | as E9 says |
| #7 | the settings card's message | no |

---

## 4. The holders page, `/{net}/token/{token}/holders`

The breadcrumb "{network} / Tokens / {CODE} / Holders", `<h1>` "Holders of {CODE}", a line "{holders} accounts hold {supply} {CODE}"
with a link back to the token, the holders answer's `CoverageNote` (`"trust lines"`), and the table of the top holders card with 50 rows a page and two more columns:
Limit (the holder's limit) and Status ("Frozen", "Authorized" when the issuer requires authorisation). `Pager` ("Previous" / "More
holders", the trail). Calls: `/v2/tokens/{t}` (`minute`, the header), `/v2/tokens/{t}/holders?limit=50[&marker]` (`minute`), E9's
names call (the 50 holders and the issuer). `cached(page, "minute")` behind a marker too (a ranking, not history); `noindex, follow`
behind a marker. Failures: the token call as §1.3; the holders call fails the card (`SectionError`), degraded.

---

## 5. Links, navigation and search

### 5.1 The header

`NAV` gains `{ label: "Tokens", to: (net) => `/${net.id}/tokens`, section: "tokens", feature: "tokens" }`, placed after Transactions
and before Network, the board's order (E11's step of the header's three, E8 §1.1: E8 added NFTs last before it, E12 turns Network into
the menu after it). `aria-current="page"` on the list, `"true"` on a token or holders page (the routes' `navSection`). While `TOKENS` is
off it is the "soon" label.

### 5.2 Links into and out of the pages

| From | To | Condition |
|---|---|---|
| Header "Tokens" | `/{net}/tokens` | `TOKENS` |
| Account page, Tokens card: a line's code | `tokenLink`: the token (code, counterparty) when the balance is 0 or above, the token (code, this account) when it is below 0 (the account is that line's issuer); an LP token keeps `poolLink` | `TOKENS` |
| Pair page (E3) and pool page (E5): "{CUR} issued by {issuer}" | `tokenLink` on the code | `TOKENS` |
| Account page, "How we know" currencies (E9 §6.2) and the validator's toml card (E13) | `tokenLink` on a code whose entry has an issuer | `TOKENS` |
| Search: `CUR.issuer` | the token page (§5.3) | `TOKENS` |
| List: a token, an issuer | the token page; the account page | |
| Token page: issuer, holders, transfer parties, counter issuers | the account page | |
| Token page: a market | the pair page (`marketHref`) | `MARKETS`, else text |
| Token page: a pool | `poolLink` | |
| Token page: a transfer | `/{net}/tx/{hash}` | |
| Token page: "All N holders", the toml file | the holders page; the domain's toml (new tab) | |

### 5.3 Search

`/{net}/search?q=` keeps `classify` as it is. When it gives `none` and `TOKENS` is on: a text that `parseAssetText` reads as an issued
asset is a 302 to its token page (`short`, no call; the page answers its own 404), an LP token's to its pool; any other text of 1 to
64 characters gets, on the help page, the link "Look for “{q}” among tokens →" (`/{net}/tokens?q={q}`). The README's search table
gains both rows. The header's live hints do not change.

---

## 6. Caching

| Answer | Class | Why |
|---|---|---|
| `/{net}/tokens`, any view | `minute` | D6's list changes with the aggregator's minute; the subrequest is `minute` too |
| `/{net}/token/{token}` | `live` | its transfers are the newest payments, as an account's first page |
| the same behind a marker | `MARKER_PAGE_CLASS` | older transfers are history (the account page's ruling) |
| `/{net}/token/{token}/holders` | `minute` | a ranking rebuilt every minute |
| canonical redirects | `immutable` (path only) / `short` | `redirectToCanonical` |
| LP-token redirect | `slow` | a pool account does not change |
| 404s, the too-long search | `short` | |
| degraded answers, 5xx | not stored | |

No new class or constant. Keys shared with other pages: #4 with the AMM list filtered by the token, #5 with both AMM pages.

---

## 7. SEO and the link-preview image

### 7.1 Tags (`meta-tokens.ts`, `meta-token.ts`)

| Page | Tags |
|---|---|
| `/{net}/tokens` | title "Tokens · XRPL · explorer"; description "Issued tokens on the XRP Ledger, ranked by holders: supply, price, 24-hour volume and whether each issuer's toml lists it." (no figures: the page is kept a minute); canonical `/{net}/tokens`; `og:*`, `twitter:card=summary`, no image |
| the list searched, with `all=1`, or behind a marker | "Tokens matching “q”" / "All tokens" / "More tokens" · XRPL · explorer; `noindex, follow`, no canonical, no `og:*` |
| `/{net}/token/{token}` | title "{name} ({CODE}) · XRPL · explorer" (without a name, "{CODE} by {issuer short}"); description "{CODE}, issued by {issuer short} on XRPL: holders, supply, price, markets, the issuer's settings and recent transfers."; canonical `tokenHref`; `og:*` with the image, `twitter:card=summary_large_image` |
| behind a marker | "Older transfers of {CODE} · …"; `noindex, follow`, no canonical, no `og:*` |
| `/{net}/token/{token}/holders` | "Holders of {CODE} · …"; canonical on its first page; `noindex, follow` behind a marker |

### 7.2 The image: kind `token`

`/og/{net}/token/{token}.png`, `{token}` the canonical path segment. Another spelling: 302 to the canonical image (`immutable`, no
call); not an asset, an LP token, or `TOKENS` off: 404 `short`, no call. Data: call #1 (the same key). The card: kind "Issued token",
headline the name or the code, parties the issuer, note "{holders} holders · supply {compact supply} {CODE}", footer "Listed in
{domain}'s toml" or "Issued token on {network}". Class `slow` (1 h, `max-age=300`): its figures change. `token not found`: 404
`short`; a failure: 503, not stored. `tokenCard` in `card-data.ts`, from the same facts as `meta-token.ts`.

### 7.3 Accessibility

Statuses are icon and text ("listed", "Frozen", "Issued", the price arrow, the settings' pills). Targets are 44 px (tabs, the form's
button, "Show all", pagers, copy buttons). Tables are `DataTable` with their names. Coins and meters are `aria-hidden`, their facts
beside them. The search field has a visible label and its error is tied with `aria-describedby`. The disabled MPT tab says why.

---

## 8. Components

Reused as they are: `Breadcrumbs`, `Card`, `StatGrid`/`StatTile`, `DataTable`, `SegmentedLinks`, `Pager` (E5's `labels`),
`AccountLink` (E9), `CoverageNote` (E8), `Amount`, `HashLink`, `DetailList`, `Pill`, `CopyTextButton`, `SectionError`, `PairCoins` (one
code), the kit's `Meter`. New and small: `ListedMark` (the toml listing status) and `SettingRow` (icon, name, pill, sentence), both in
`TokenPage.tsx`'s folder of parts. No chart is loaded.

---

## 9. Data interface

**Client** (`data-api.ts`, types in `api-types.ts` from D6 §5): `tokens(q: { kind: "issued"; limit: number; minHolders?: number;
q?: string; marker?: string })` (`minute`), `token(asset)` (`minute`, `unwrap: "token"` keeping `coverage`, `ledger_index`),
`tokenHolders(asset, { limit, marker? })` (`minute`), `tokenTransfers(asset, { descending: true; limit; marker? })` (`live`, a marker
page `MARKER_PAGE_CLASS`). The path segment is `segment("token", `${currency}.${issuer}`)`. Until `pnpm api:sync` brings D6's routes,
`PENDING_PATHS` holds `tokens: "/v2/tokens"`, `token: "/v2/tokens/{token}"`, `tokenHolders: "/v2/tokens/{token}/holders"`,
`tokenTransfers: "/v2/tokens/{token}/transfers"`. `token-shape.ts` checks inside the cached loads: lists where lists belong, amounts
and prices as decimal text, counts and ranks as whole numbers, booleans, issuers and holders as valid addresses, and `coverage`
through E8's `checkCoverage` (`app/server/coverage.ts`); a malformed 200 is kind `server` and is not stored. `token not found` is `not_found`; a
"Cannot GET" is `server` (E2's rule).

| Element | Source (fields) |
|---|---|
| List: tiles | `totals` (`tokens`, `tokens_with_10_holders`, `holders`, `native_volume`) |
| List: note, "Show all" | `total`, `total_below`, `count`, `marker` |
| List: rows | `rank`, `currency`, `issuer`, `holders`, `supply`, `price`, `native_volume`, `listed`, `name` |
| Coverage notes | `coverage` of each answer (E8's `Coverage` type) |
| Token: header, toml | `currency`, `issuer`, `toml.name`, `domain`, `toml_url`, `listed`, `toml.*` |
| Token: figures | `supply`, `holders`, `trust_lines`, `price`, `price_change`, `price_time`, `native_volume`, `trades` |
| Token: settings | `issuer_settings.*`; node `account_info.account_data` (`Flags`, `TransferRate`) |
| Token: markets | `markets[]` (`counter_currency`, `counter_issuer`, `count`, `native_volume`, `last`, `last_time`) |
| Token: pools | `/v2/amm/pools` (`amm_account`, the pair, `value_native`, `trading_fee`); `amm_volume` live (`components[].amm_account`, `converted_amount`) |
| Holders | `holders[]` (`rank`, `holder`, `balance`, `share`, `limit`, `frozen`, `authorized`), `supply` |
| Transfers | `transfers[]` (`hash`, `executed_time`, `source`, `destination`, `amount`) |
| Names | E9's answer per address |

## 10. Both networks and the sandbox

XRPL and Xahau run the same pages. Xahau: prices and volumes in XAH, "DEX trades" in the sub-lines and footnotes, no AMM calls (#4,
#5) and the board's AMM note, the MPT tab's note, its toml file `xahau.toml`, its flag names (the account page's per-network table).
The sandbox (E7) shows "XRPL Testnet" and "Xahau Testnet" in every network name above and runs the same code against its data APIs;
`TOKENS` is off there until its data API serves D6. `hasAmm` decides the AMM card, nothing else is network-specific.

---

## 11. Testing

**Unit (`unit`).** `app/domain/token-params.test.ts`: the canonical form of each query (order, defaults, `back` without `marker`,
`kind=mpt` dropped, a long `q`), `parseTokenPath` and `tokenHref` for a 3-character code in lower case, a text code, its hex, the hex
of a standard code, a non-decodable hex, an LP token, the native code, the separators; `tokenLink` with `tokens` on, off and
`NO_FEATURES`. `app/server/token-view.test.ts`: tiles with and without `native_volume`; the note with and without `q`, `all` and
`total_below`; ranks; the price sub's three forms; settings from D6 and from `account_info` on both networks (Xahau's clawback bit);
the toml card's three states and its URL rows; markets' order and hrefs; pools joined with the live components ("0" and "—"); shares and
the top-10 sum; transfers' tags; the marker page. `meta.test.ts`, `card-data.test.ts` (the tags and `tokenCard`); the pre-deploy guard's
`TOKENS` cases; `pending-paths.test.ts`; `test/unit/token-bundle.test.ts` (the three routes import nothing of `app/server` at run time).

**Components (`components`).** `TokensPage.test.tsx` (every state, the tabs with MPT "soon" and Xahau's note, the form's error, the empty
search), `TokenPage.test.tsx` (every card, every failure, Xahau, the toml states, a marker page), `TokenHoldersPage.test.tsx`; the header
("soon", link, current); the account page's token links on and off (both signs, an LP token); the pair and pool pages' code links.

**Worker (`worker`).** `test/worker/tokens.spec.ts` and `token.spec.ts`: classes of §6; the redirects of §1.3 without a call; exactly
the calls of §2.3 and §3.2 (`mock.requests`), #4's key equal to the AMM list's; each card failure a 200 with its `SectionError`, not
stored; the 404 with and without the coverage note; a "Cannot GET" a 503; a refused marker a 404. `test/worker/tokens-off.spec.ts`
(`worker-off`): every token route and image a 404 without a call, the header's "soon", the account card without links.
`data-api.spec.ts`: the four methods' classes and keys; `og.spec.ts`: the `token` image.

**End to end.** `test/e2e/tokens.spec.ts`: the header item leads to the list with `aria-current`; 20 rows, "More tokens" and "Previous";
a search, its "more among tokens with fewer than 10 holders" link, "Show all"; a token link to its page; the toml card, settings,
markets links to the pair page, a pool link, "All N holders" and its pages; transfers' Older and Newer; `usd.r…` and a hex URL
redirected; an LP token to its pool; a token not found with its note; `/xahau/tokens` and a Xahau token (XAH, the AMM note); search for
`CUR.issuer`; with JavaScript off, the form, the links and the pagers work. `test/e2e/tokens-live.spec.ts` (the `live` project):
holders overridden to 503 shows the card's error, Retry brings it back. `client-meta.spec.ts` and `og.spec.ts` gain the pages.
Skipped where `E2E_FEATURES_OFF` lists `TOKENS` (its off-case runs instead).

**Accessibility.** `a11y.spec.ts`, WCAG 2.2 AA, no serious or critical violation: `/xrpl/tokens` and the featured token at 1280 and
375 px in the four theme settings; the searched list, `all=1`, a marker page, the holders page, a Xahau token and the 404 in the two
system themes.

**Bundle.** `PAGES` gains `tokens` (`routes/net.tokens`), `token` (`routes/net.token.$token`) and `token-holders`
(`routes/net.token.$token.holders`), all `lookup` (150,000 B gzip). No chart beyond `Meter`; the plan records the figures.

## 12. Fixtures

D6's answers cannot be recorded (no D6 deployment yet), so they are **generated** by `scripts/token-fixtures.ts`, called from
`make-http-fixtures.ts`, checked by `pnpm fixtures:check`, provenance in `test/fixtures/PROVENANCE.md` ("Token answers", the D6 spec
and commit followed):

| Files below `<net>/data-api/` | Kind |
|---|---|
| `tokens@kind=issued&limit=20&min_holders=10[&marker=M].json` (3 pages), `…&q=USD`, `…&q=<an issuer>`, `tokens@kind=issued&limit=20[&marker=M].json` (all), `tokens@kind=issued&limit=1&min_holders=10.json` (the 404's coverage) | synthetic: about 60 seeded tokens with 10+ holders and 40 below, around the featured ones; ranks, counts and totals by D6's rules |
| `tokens/<CUR>.<issuer>.json`, `…/holders@limit=10.json`, `…/holders@limit=50[&marker=M].json` | synthetic around real issuers; holders real addresses of the recordings first, then seeded |
| `tokens/<CUR>.<issuer>/transfers@descending=true&limit=20[&marker=M].json` | derived from the recorded payments that delivered the featured tokens where the recordings have them, seeded otherwise |

**Featured tokens.** XRPL: RLUSD by `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De` (a text code, listed, clawback allowed, its pools file
`amm/pools@asset=524C…+rMx…&limit=20.json` and the live AMM volume exist already), USD by `rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B` (a
3-character code, a transfer fee, not listed), LIONS by its recorded issuer (no domain, no `issuer_settings`: the node fixture's
`account_info` serves them), a token with 4 holders, and the XRP/RLUSD pool's LP token (the redirect). Xahau: EVR by
`rEvernodee8dJLaFsujS6q1EiXvZYmHXr8` (listed, XAH price) and one unlisted seeded token. A token without a file is the API's 404
`token not found` (the fixture server's not-found bodies gain it). The names of the pages' addresses join E9's names fixtures.
`test/unit/token-fixtures.test.ts` checks the key orders, ranks and markers, counts against rows, `share` against `supply`, and that every
issuer and holder is a valid address.

## 13. README and rollout

**README**: a section "Tokens" (the routes, their classes, calls and failures, the switch, the MPT seam); the switches' tables and
`TOKENS`' condition; the header's items; "The account page" (the Tokens card's links); "Search" (two rows); "SEO and link previews"
(the tags and the `token` image kind); "Upstream fixtures" (§12's rows); "The client bundle check" (the three pages' figures); the
sandbox checklist (E7's split): the list against `/v2/tokens` (pages concatenate, no token twice within a minute), a token's settings
against `account_info`, the image; the production checks: a token's supply against the node's `gateway_balances` for two issuers once
D6's coverage is complete (never in the sandbox, D-env §12), an LP redirect (no testnet pool is a fixture's).

| Step | |
|---|---|
| 1. E11 ships | `TOKENS` on at the top level, off in the sandbox and production; D6's paths in `PENDING_PATHS`; the suites run against the fixtures |
| 2. D6 deployed to the sandbox's data APIs, first generation live | `TOKENS` on for the sandbox (a commit), the sandbox checklist (the end-to-end suite is not run against the sandbox: E7 decision 8) |
| 3. `pnpm api:sync` | D6's paths move to `PATHS` |
| 4. D6 in production, generation live, lag small | `TOKENS` on for production: the pages, the header item and the token links appear at once (the switch is in the cache generation) |
| 5. E14 | the MPT tab and `kind=mpt` |
