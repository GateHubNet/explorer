# NFT pages: design (E8)

Date: 2026-10-24. Status: proposed (2026-10-24), program 2, sub-project E8. Repository `GateHubNet/x-explorer`, branch
`feat/explorer-pages-2`.

- **Boards** (`2026-10-24-explorer-mock/`): `Nfts.dc.html`, `NftCollection.dc.html`, `Nft.dc.html`; and, for what changes on them,
  `Account.dc.html`, `Transaction.dc.html`, `Main.dc.html` (search). Their sample data is made up.
- **Data:** data API sub-project D3, `docs/superpowers/specs/2026-10-17-nft-data-design.md` (revised 2026-10-24) in `data-api`, branch
  `feat/explorer-data-2`. Section numbers "D3 §n" below are that spec's.
- **Program:** `2026-10-24-explorer-program-2-overview.md`. Built after E7 (`2026-10-24-sandbox-environment-design.md`: "sandbox", the
  testnet networks) and before E9 (display names), so every address here is today's `AccountLink`; E9 adds names everywhere.
- **Models:** `2026-10-19-amm-pools-design.md` (E5: list and detail pages behind a switch, the node as a fallback) and
  `2026-10-19-network-dashboard-design.md` (E2: the chart kit, switches, `windowOf`).

## Owner decisions to confirm

The product choices of this spec and its departures from the boards. Each is built as written unless the owner says otherwise.

| # | Choice | Why / recommendation |
|---|---|---|
| 1 | Routes: `/{net}/nfts`, `/{net}/nfts/sales`, `/{net}/nfts/{issuer}/{taxon}` (XRPL) and `/{net}/nfts/{issuer}` (Xahau), `/{net}/nft/{ID}` (section 1). | One URL per collection key on each network; the collection sits under the list, as a pool under `/amm`. |
| 2 | "Older sales →" opens a sales page of its own; "More collections →" pages the table in place, and a page behind its marker shows the table only. | Two independent pagers cannot share one URL. |
| 3 | **Not on the board:** a Holders tab on the collection page (holder, NFTs held, share of supply). | The brief asks for sales, holders and tokens tabs; D3 serves holders cheaply. Recommend yes. |
| 4 | **Not on the Account board:** an NFTs tab on the account page (`?tab=nfts`, "URITokens" on Xahau), from the index; the Objects tab's NFT rows link to it and to the NFT pages (section 6). | An account's NFTs need a paged list; the Objects tab is the node's 400 objects, NFT pages of up to 32 NFTs each. Recommend yes. |
| 5 | The chart's measure switch (Volume, Sales, Average price, Lowest price) and the sort direction are links (`?measure=`, `?order=asc`). | One URL per view, works without JavaScript; the four measures are one cached call. |
| 6 | "Collections of an issuer" and "Held by an account" take one exact address (a GET form), not a substring. | The API filters by an exact address; filtering one page in the browser would hide the pages behind it. |
| 7 | Open offers come from the index for an indexed NFT (the board's source) and from the node only for an NFT shown from the network. | One source per mode; the coverage note says when the NFT's history starts after its mint. |
| 8 | The XRPL fallback reads Clio's `nft_info` (the configured `s1.ripple.com:51234` is Clio). Against a node without it, an NFT the index lacks is a 404. | rippled cannot look an NFT up by id. E7 (built first) makes the XRPL node a Clio in every deployed environment (E7 decision 9: Ripple's testnet Clio in the sandbox). |
| 9 | A 64-hex search asks the index for a transaction, a ledger and an NFT side by side, then the node; two or more found is the choice page. | An NFT id and a hash look alike; asking costs one more call only for unknown hashes. |
| 10 | Prices stay in their currency, with "≈ 96 XRP" under an issued-currency price when the API converts it; royalty in the native currency when the sale is converted, else in the price's currency. | The brief: conversion only where rate data exists (D2's daily rates via D3). |
| 11 | Coverage: one faint line under each list or figure whose `coverage.complete` is false ("Covers ledger #96,100,001 onwards…"), per NFT on the NFT page. | The brief's notice; one shared component (`CoverageNote`) later features reuse. |
| 12 | The history hides offer events unless "Show offer events" (`?offers=1`); the offers one transaction removed are one row ("2 offers removed by the sale"). | The board's default and its row. |
| 13 | A link-preview image for the NFT page only (kind `nft`); the list and collection pages have tags without an image. | As E5 (images of things, not lists); a collection's key does not fit the image route's one id. |
| 14 | Recent sales on the list are 10 rows (the board shows 8); Xahau keeps the board's Sale and Royalty columns ("direct", "—"). | A round page; the board's columns. |
| 15 | No page polls or refreshes itself. Classes: the list and a collection `minute`, an indexed NFT `live`, a burned one `slow`, one from the network `short` (60 s). | The data changes at the aggregator's minute; nothing on the boards is live. |
| 16 | The top collections read `/v2/network/nft_volume?live=…` (the API's parameter), not the board caption's `period=`. | D3 keeps the volume routes' contract. |
| 17 | `NFTS` goes on in an environment once D3 serves both networks there and its lag gauges are near 0, before the history is complete. | The coverage notes say what is missing; waiting for the full re-ingest would hold the pages back for days. |
| 18 | The account header's "URI token(s)" count becomes "URIToken(s)". | The glossary's word. |

## Context

**What the explorer shows of NFTs today.**
- `app/domain/describe/nft.ts` writes the sentences and details of the five XRPL NFT types; `describe/xahau.ts` those of the five URIToken
  types and `Remit`. NFT ids appear only as text details (`NFT`, `URIToken ID`, `Sell offer`, `Buy offer`); a mint names no id.
- The account page counts owned objects (`NFT page`, `NFT offer`, `URI token`) and lists them on the Objects tab (`objectRows`): an
  `NFTokenPage` shows "NFTs: 32", an `NFTokenOffer` and a `URIToken` show no fields.
- Search treats 64 hex digits as a transaction or a ledger (`findHash`).
- The header has no NFTs item; the boards put "NFTs" after AMM.

**Facts of D3 that shape this design** (D3 §5): collections are keyed by issuer and taxon on XRPL and by issuer on Xahau; the NFT detail is
folded from the NFT's events at read time (fresh at commit), the collection rows are rebuilt by the aggregator about every five minutes;
lists and aggregates carry `coverage {from_ledger_index, complete}`; prices are in their own currency with `converted_amount` where a daily
rate exists; `nft_volume` has the live periods `day`, `7day`, `30day`; the API reads no node.

## Goals

- `/{net}/nfts`, a collection and an NFT show every element of the three boards that the data fills, server-rendered, readable without
  JavaScript, charts included, on both networks with each network's words (NFT / URIToken).
- Every NFT id the explorer shows (sentences, details, objects, holdings, search) leads to the NFT's page while `NFTS` is on.
- An NFT the index does not have yet is shown from the network; a URI is shown, decoded, and never fetched.
- Every list and figure says where its history starts until the index holds it all.
- Each page's initial JavaScript stays under 150,000 bytes gzip.

## Non-goals

- Fetching a URI, images, metadata, names of collections or NFTs, rarity, floor prices.
- An account's NFT activity list (`/v2/accounts/{a}/nft_history` exists; no board shows it).
- Live refresh; CSV links; collection images; display names (E9).

## 1. Routes

### 1.1 Files

| Path | Route file | Handle |
|---|---|---|
| `/{net}/nfts` | `routes/net.nfts._index.tsx` | `navSection: "nfts"` |
| `/{net}/nfts/sales` | `routes/net.nfts.sales.tsx` | `navSection: "nfts"` |
| `/{net}/nfts/{issuer}` and `/{net}/nfts/{issuer}/{taxon}` | `routes/net.nfts.$issuer.$taxon.tsx`, registered as `nfts/:issuer/:taxon?` | `navSection: "nfts"` |
| `/{net}/nft/{id}` | `routes/net.nft.$id.tsx` | `navSection: "nfts"` |
| `/og/{net}/nft/{ID}.png` | the image route, kind `nft` | |

`routes.ts` lists `nfts`, `nfts/sales` (a static segment, ranked above the dynamic one), `nfts/:issuer/:taxon?` and `nft/:id` under `:net`.
`NavSection` gains `"nfts"`; `Header`'s `NAV` gains `{ label: "NFTs", to: (net) => \`/${net.id}/nfts\`, section: "nfts", feature: "nfts" }`
after AMM (the label is "NFTs" on both networks, as on the boards; the pages' headings say "URITokens" on Xahau).

**The header, built in three steps** toward the boards' order less what is not built (the boards' "Accounts" item and the menu's Nodes):
Ledgers, Transactions, Tokens, Network ▾ (Overview, Validators, Amendments, Supply), Markets, AMM, NFTs. Today's items are Ledgers,
Transactions, Network, Markets, AMM. **E8** appends NFTs (last); **E11** inserts Tokens between Transactions and Network; **E12** turns
Network into the disclosure menu; E13 and E14 add no item. Each step keeps the items the earlier ones added.

**Other files.** `app/domain/nft-params.ts` (pure: `parseNftsParams`, `parseNftSalesParams`, `parseCollectionParams`, `parseNftParams`,
`nftsHref`, `nftSalesHref`, `collectionHref`, `nftHref`, `collectionLabel`, `NFT_MEASURES`, `NFT_PERIODS`, `COLLECTION_TABS`);
`app/domain/nft-link.ts` (`nftLink(net, id, features)` and `collectionLink(net, key, features)`: the one place inbound links are decided, as
`pool-link.ts`); `app/domain/nft-id.ts` (`decodeNftId(id)`: flags, transfer fee, issuer, scrambled and plain taxon, serial;
`NFT_FLAG_LABELS` per network; `uriText(hex)`); the view builders `app/server/nfts-view.ts` (`nftsListPage`, `nftSalesPage`),
`app/server/nft-collection-view.ts` (`nftCollectionPage`, `collectionDaySeries`), `app/server/nft-view.ts` (`nftPage`, `nftModeOf`,
`NFT_MODE_CLASS`, `historyRows`, `offerRows`); `app/server/nft-shape.ts` and `app/server/coverage.ts` (`checkCoverage`, `coverageNote`); the
tags `app/server/meta-nfts.ts`, `meta-nft-collection.ts`, `meta-nft.ts`; the pages `app/ui/pages/NftsPage.tsx`, `NftSalesPage.tsx`,
`NftCollectionPage.tsx`, `NftPage.tsx`; the components `app/ui/components/CoverageNote.tsx`, `NftGlyph.tsx`, `NftLink.tsx`.

### 1.2 URLs and parameters

One URL per view: a query that is not exactly its view's canonical form is a 302 to it (class `short`, before any call). Defaults are
dropped, unknown values and parameters dropped, the first of a repeat read, `back` without `marker` dropped, the order below kept.

| Page | Parameters, in order | Default |
|---|---|---|
| the list | `period` (`day`, `7day`, `30day`), `issuer` (a classic address), `sort` (`volume`, `supply`, `holders`), `order` (`asc`), `marker`, `back` | `day`, none, `volume`, descending |
| older sales | `marker`, `back` | the first page |
| a collection | `measure` (`volume`, `sales`, `avg`, `low`), `tab` (`sales`, `nfts`, `holders`), `owner` (an address; `nfts` tab), `burned` (`1`; `nfts` tab), `marker`, `back` | `volume`, `sales` |
| an NFT | `offers` (`1`: offer events in the history), `marker`, `back` | offer events hidden |

A page behind a `marker` drops `period` and `measure` (it has no tiles or chart). Newer and Older use `trailPaging` (`?marker=M3&back=M2.M1`).

### 1.3 Validation and redirects (before any call)

| Request | Answer |
|---|---|
| any route above, or the image, while `NFTS` is off | 404 "We couldn't find the NFT pages on XRPL" (Xahau: "the URIToken pages"), class `short`, no call |
| `/{net}/nfts/{x}` where `x` is not a classic address with a good checksum, a taxon that is not a decimal UInt32 | 404, class `short` |
| a taxon with leading zeros (`01`) | 302 to the plain number, `immutable` |
| `/xrpl/nfts/{issuer}` (no taxon) | 302 to `/xrpl/nfts?issuer={issuer}`, `short` |
| `/xahau/nfts/{issuer}/{taxon}` | 302 to `/xahau/nfts/{issuer}`, `short` |
| `/{net}/nft/{x}`, `x` not 64 hex digits | 404, class `short` |
| an id in lower or mixed case | 302 to the upper-case URL, `immutable` |
| a `marker` that fails `isMarker`, one the API refuses (400), or with nothing behind it | 404, class `short` |
| an `owner` or `issuer` that is not a classic address | 200, the form with "Write a classic address (r…)." under the field (`aria-invalid`), no call for that list; `noindex, follow` |

### 1.4 The switch `NFTS`

Appended last to `FEATURE_VARS` (`NFTS`) and `FEATURE_NAME` (`nfts`), with `Env.NFTS`, an entry in every block of `wrangler.jsonc` (top
level `"on"`, `sandbox` and `production` `"off"`), `TOP_LEVEL_SWITCHES`, and the README's tables. While off: every route and image above is
the 404, no call; the header's NFTs item is the "soon" label; the account page's NFTs tab is the disabled "soon" tab; `nftLink` and
`collectionLink` give `null`, so an NFT id is plain monospace text (shortened, with the full id in `title`) and a collection plain text;
search asks no NFT question and its hints keep their words. The switch is in the cache generation, so a flip never meets a page stored under
the other value.

## 2. The list, `/{net}/nfts`

### 2.1 Layout and content (`NftsPage`, from `nftsListPage`)

- **Heading** "NFTs" / "URITokens" and the board's intro per network ("Non-fungible tokens (NFTokens) on the XRP Ledger: sales, collections
  and their holders. A collection is an issuer and a taxon." / "URITokens, the non-fungible tokens of Xahau: … A collection is everything one
  issuer minted.").
- **Period** links (`SegmentedLinks`: 24 h, 7 days, 30 days), "The period sets the totals and the top collections."
- **Four tiles** (`StatGrid` of `StatTile figure`), from #2: "Sales volume, 24 h" (the row's `total`, compact, "XRP"; note "sales in XRP and
  in tokens with a daily XRP rate"), "Sales, 24 h" (the row's `count`; note "direct and brokered" / "URITokenBuy"), "Collections traded,
  24 h" (the number of components; note "of 38,511 collections", #5's `total`), "Average sale, 24 h" (`total` ÷ the components' summed
  `count`, BigNumber, whole native units; note "volume ÷ sales"; "—" with no rated sale).
- **Chart** `ChartCard` "Sales volume per day, in XRP, last 30 days", source `/v2/network/nft_volume?interval=day`: `ColumnChart` single,
  one bucket per UTC day of E2's `windowOf(T, "30d")`, the running day `forming`, the extra "Sales" (each row's `count`), the table view.
  A day without a row is `null` while `pendingCount` says it is not computed (the API's backfill), else 0; the note says which days are not
  computed (`pendingNote`).
- **Top collections** `ChartCard` "Top collections, 24 h", source `/v2/network/nft_volume?live=day`: `BarList` of the five largest
  components, label `collectionLabel` ("rLULtF…mB3R · taxon 1" / "rEvRt8…Lk2P"), `href` the collection, sublabel "412 sales", the tip
  "181K XRP · 43.9%" (share of the row's total). "No sales in the last 24 hours." when there are none.
- **Recent sales** table (`DataTable`, 10 rows, newest first), source `/v2/nft_sales?descending=true`: Time (`When`: the UTC time linking
  the transaction, the age by `RelativeTime` in the browser), NFT / URIToken (`NftGlyph` and `NftLink`: "#4,127" on XRPL with the short id
  under it, the short id on Xahau), Collection (`collectionLabel`, a link), Price (`Amount`, and "≈ 96 XRP" under it when the currency is
  not native and `converted_amount` is there), Seller → buyer (two `AccountLink`s, "to" for screen readers), Sale (`direct` / `brokered`
  tag), Royalty, est. (XRPL; "Royalty" on Xahau, always "—"). The note per network (the board's). "Older sales →" is `nftSalesHref(net,
  marker)` with the call's marker; left out without one.
- **Collections** table, source `/v2/nft_collections?sort=…`: the GET form "Collections of an issuer" (`issuer`, placeholder "Issuer
  address (r…)") and "Show"; columns Collection (glyph, issuer short link to the collection, under it "taxon 1" / "every URIToken of this
  issuer"), Supply, Holders, Minted / burned, Sales, Volume (XRP) (`volume_native` compact), Last mint (the day of `last_mint`, "—"). Supply,
  Holders and Volume headers are sort links with `aria-sort` and an arrow; the current one's link flips `order`. The board's note
  ("Collections are named by issuer and taxon: … Volume and sales are all time; supply counts tokens not burned."). Pager: "More
  collections →" (`?…&marker=`), and on a page behind a marker "← Newer" too. "No collection of {issuer} in the index." when a filter finds
  none.
- **Coverage notes** under the chart, the top collections, the recent sales and the collections table, each from its own call's
  `coverage` (section 8).

### 2.2 Calls (first page)

All side by side, each card's call raced against `CARD_DEADLINE_MS`, awaited with `Promise.allSettled`; nothing deferred, nothing polled.

| # | Call | Kept (class) | Feeds | If it fails |
|---|---|---|---|---|
| 1 | `last_validated` | 2 s, the home page's entry | T, the chart's window | the chart: "Couldn't load the sales volume" |
| 2 | `nftVolume({ live: period })` → `/v2/network/nft_volume?live=day\|7day\|30day` | 60 s (`minute`) | tiles, top collections | tiles "—" with one `SectionError` "Couldn't load the totals."; top collections "Couldn't load the top collections" |
| 3 | `nftVolume({ interval: "day", start: W₀, end: W₁, limit: 1000 })`, after #1 | 300 s (`slow`, `PERIOD_CALL_TTL_SECONDS`) | the chart | as #1 |
| 4 | `nftSales({ descending: true, limit: 10 })` | 5 s (`live`) | recent sales | "Couldn't load the recent sales" |
| 5 | `nftCollections({ limit: 20, sort, descending, issuer? })` | 60 s (`minute`) | collections, the "of N" note | "Couldn't load the collections"; the tile's note left out |

A failed card is told in its place and logged (`logProblem`), and the request is degraded (`markDegraded`): served, not stored. Retry is
`useRetry`. A page behind a marker makes call #5 alone (with the marker), awaited whole, class `MARKER_PAGE_CLASS`, titled "More NFT
collections"; its failure is a 503 (`upstreamOutage`). A "Cannot GET" (an API without D3 behind a switch that is on) is kind `server`: a
failed card or a 503, never a stored 404.

### 2.3 Older sales, `/{net}/nfts/sales`

The breadcrumb "XRPL / NFTs / Sales", the heading "NFT sales" / "URITokens sales", the recent-sales table of 2.1 with 20 rows a page
(`nftSales({ descending: true, limit: 20, marker? })`), Newer and Older, the coverage note. The first page is class `minute`, a page behind a
marker `MARKER_PAGE_CLASS`; a failure is a 503.

## 3. A collection, `/{net}/nfts/{issuer}[/{taxon}]`

### 3.1 Layout and content (`NftCollectionPage`, from `nftCollectionPage`)

- **Breadcrumb** "XRPL / NFTs / rLULtF…mB3R · taxon 1" (Xahau "Xahau / URITokens / rEvRt8…Lk2P").
- **Header card**: `NftGlyph` (large), `<h1>` "Collection rLULtF…mB3R · taxon 1" / "URITokens of rEvRt8…Lk2P", the tag "NFToken collection" /
  "URIToken collection"; Issuer (full address, link, `CopyButton`), Taxon (XRPL), "First mint {date} · last mint {date}" (each a link to
  its transaction; a part left out when absent).
- **Six stats** (`StatGrid`): Supply ("10,000 minted · 0 burned"), Holders ("accounts holding one or more"), Sales ("all time"), Volume
  (`volume_native` compact, "all time, at daily rates"), Average sale, 30 days (Σ volume ÷ Σ rated sales of #3's days, whole units;
  "1,412 sales"), Lowest sale, 30 days (the lowest `min_price_native` of #3; "a sale, not an open offer"); "—" for a figure without data.
- **Chart** `ChartCard`, title by measure ("Sales volume per day, in XRP, last 30 days", "Sales per day…", "Average sale price per day, in
  XRP…", "Lowest sale price per day, in XRP…"), source `/v2/nft_collections/{key}/stats`, the measure links, `ColumnChart` single over
  E2's 30-day window, extras "Sales", "Volume", "Average", "Lowest" and "Minted" (`mints`), the running day `forming`. A day without a row had
  no activity (query-time stats have no uncomputed days): 0 sales, `null` average and lowest. Note "One bar a UTC day. A day with no sale has
  no average or lowest price."
- **Tabs** (`Tabs`, links): Sales, NFTs (URITokens), Holders. Each 20 rows, Newer and Older, its coverage note:
  - **Sales**: Time (UTC date and time, linking the transaction), NFT (glyph, "#4,127" link; Xahau the short id), Price (and "≈"), Seller →
    buyer, Sale, Royalty, est.
  - **NFTs**: the GET form "Held by an account" (`owner`) and the checkbox "Include burned" (`burned=1`) with "Show"; columns NFT (glyph,
    serial link, the short id under it), Owner (`AccountLink`, or a "burned" tag), Sales (`sale_count`), Last sale (`Amount`, "—"), Flags
    (tags: "transferable", "burnable", "only XRP", "mutable", and "5% fee" from `transfer_fee`; Xahau "burnable"), Minted (the day of
    `minted`, "—" when not indexed). "No NFT of this collection is held by {owner}." for an empty filter.
  - **Holders**: Holder (`AccountLink`), NFTs held (`held`), Share of supply (`held` ÷ `supply`, one decimal, "<0.1%").
- The board's note per network under the tabs ("A collection is every NFT of one issuer and one taxon. Names and images live in each NFT's
  metadata, which the explorer does not fetch, so tokens are shown by serial and id.").

### 3.2 Calls

| # | Call | Kept (class) | Feeds | If it fails |
|---|---|---|---|---|
| 1 | `nftCollection(key)` → `/v2/nft_collections/{issuer}[/{taxon}]` | 60 s (`minute`) | header, stats, `supply` | `collection not found`: 404 "We couldn't find NFT collection rLULtF…mB3R · taxon 1 on XRPL"; anything else: 503 |
| 2 | `last_validated` | 2 s | T | the chart and the 30-day stats: "Couldn't load the daily figures" |
| 3 | `nftCollectionStats(key, { start: W₀, end: W₁ })`, after #2 | 300 s (`slow`) | chart, the two 30-day stats | as #2 |
| 4 | the tab: `nftCollectionSales(key, { descending: true, limit: 20, marker? })`, `nftCollectionNfts(key, { limit: 20, owner?, includeBurned?, marker? })` or `nftCollectionHolders(key, { limit: 20, marker? })` | `live`; `MARKER_PAGE_CLASS` behind a marker | the tab | "Couldn't load the sales" (the NFTs, the holders); the tabs stay links |

The page is class `minute`; degraded when a card failed. A page behind a marker is the breadcrumb, the header card without its dates, "Back
to the collection" and the tab's rows, titled "Older sales of rLULtF…mB3R · taxon 1": #1 and #4 only, awaited, `MARKER_PAGE_CLASS`.

## 4. An NFT, `/{net}/nft/{ID}`

### 4.1 Modes (`nftModeOf`)

| #1 index | #2 node | Mode | Shown | Class |
|---|---|---|---|---|
| the NFT, with an owner | not asked | indexed | everything | `live` |
| the NFT, burned | not asked | burned | everything, the "burned" tag, "Burned {date} by {account}" in place of the owner, no open offers | `slow` |
| the NFT without an owner (no indexed event names it) | the NFT | indexed, owner from the network | everything, the owner "read from the network at ledger #N" | `live` |
| the same | failed or `not_found` | indexed, owner unknown | everything, Owner "Not in the index yet" | `live`; degraded when #2 failed |
| `nft not found` | the NFT | from the network | `Notice` "Not in the index yet, shown from the network. Its history appears once the index has it."; the header and details from the node, open offers from the node, no history | `short`, 60 s, `noindex` |
| `nft not found` | burned (`nft_info` `is_burned`) | from the network, burned | as above with the "burned" tag and no offers | `short`, 60 s, `noindex` |
| `nft not found` | `not_found` | none | 404 "We couldn't find NFT 00081388…101F on XRPL" ("URIToken" on Xahau), suggestion "Search on Xahau" (`/{other}/search?q={ID}`) | `short` |
| failed (5xx, 429, a malformed 200, a "Cannot GET") | | | 503 (`upstreamOutage`) | not stored |

The node reader: XRPL `nftInfo(id)` (Clio `nft_info`, `ledger_index: "validated"`; `objectNotFound` and `entryNotFound` are `not_found`;
`unknownCmd` and `notImpl`, a node that is not Clio, are `not_found` too, logged once per Worker instance: decision 8), Xahau `uriToken(id)`
(`ledger_entry` with `index`, `validated`; `entryNotFound` is `not_found`, an entry that is not a `URIToken` too). Both kept 5 s (`live`),
times in unix seconds and drops as whole units at the boundary, as `node-rpc.ts` does.

### 4.2 Layout and content (`NftPage`, from `nftPage`)

- **Breadcrumb** "XRPL / NFTs / rLULtF…mB3R · taxon 1 / #4,127" (Xahau "… / A1F04C77…3D10"). The collection crumb comes from the
  NFT (or, from the network, from the decoded id or the entry's `Issuer`).
- **Header card**: the "No preview" box ("The explorer shows the URI but does not fetch what it points to."); `<h1>` "NFT #4,127" /
  "URIToken A1F04C77…"; tags "NFToken" / "URIToken" and "burned"; "Serial 4,127 of the collection {link}" / "Minted by the issuer of
  {link}"; the id in full with `CopyButton`; Owner (`AccountLink`, "since {date and time}" linking `owner_since`'s transaction); Last sale
  (`Amount` and "≈", "20 Oct 2026 · sold 7 times"; "Never sold" with `sale_count` 0).
- **Details** (`DetailList`, source `/v2/nfts/{ID}`): Issuer; Taxon · serial (XRPL); Minted ("#86,201,334 · 14 Mar 2024 · by {minter}",
  and "to {account}" when not the minter; "Before ledger #N, not in the index" when `minted` is absent and coverage is incomplete); Transfer
  fee ("5.000% of every sale goes to the issuer", "None") / Royalty ("None: URITokens carry no transfer fee"); URI (`uriText`: the hex
  decoded as UTF-8 when it is printable text, else the hex, never a link; "Decoded from hex. Not fetched."); Flags (each with ✓ or –, a
  screen-reader "yes"/"no": XRPL "Burnable by issuer", "Only XRP", "Transferable", "Mutable URI"; Xahau "Burnable by issuer").
- **The id** card: XRPL "The id, decoded" from `decodeNftId` (Flags, Transfer fee "5,000 = 5.000% royalty", Issuer (20 bytes), Taxon
  scrambled, Sequence "serial 4,127 of the issuer"), and "The taxon is stored scrambled with the sequence; the explorer unscrambles it, as
  rippled does."; Xahau the board's paragraph, Digest (short, `title` full; "—"), Ledger entry "URIToken".
- **Open offers** (source `/v2/nfts/{ID}/offers`, or "the network" in that mode): Side (`sell`/`buy` tag), Amount, By, Only for (the
  destination, "anyone" for a sell offer without one, "—" for a buy offer), Expires (the UTC date, "never", and an "expired" tag when it is
  before the close time of the ledger #1 was read at), Created (the ledger, a link). The note per network (the board's). "No open offers."
  An NFT shown from the network: XRPL `nftSellOffers(id)` and `nftBuyOffers(id)` (rippled/Clio `nft_sell_offers`, `nft_buy_offers`, limit 50,
  `objectNotFound` is none; "Showing the first 50" when a marker comes back), Xahau the entry's `Amount` and `Destination`.
- **History** (source `/v2/nfts/{ID}/history?descending=true`): the link "Show offer events" / "Hide offer events" (`?offers=1`), columns
  Time, Event (tag: "mint", "sale", "transfer", "burn", "URI change", "offer create", "offer cancel", "offer removed"), Accounts (`Sentence`
  segments, below), Amount, Transaction (short hash link). 20 a page, Newer and Older, the note "Newest first. A sale's price is the offer it
  accepted; a transfer moves the token without a price." and the coverage note.

`historyRows` writes the Accounts cell: a mint "by {account}, to {to}"; a sale "{from} → {to}", with " · broker {broker}, fee {broker_fee}";
a transfer "{from} → {to}", with " · by Remit" for a `Remit` and " · an accepted offer of 0" for an `NFTokenAcceptOffer`; a burn "by
{account}", with " · owned by {from}" when they differ; a URI change "by {account}"; an offer "{sell|buy} offer by {account}", with " · only
for {destination}"; a cancel "… cancelled"; a removal "… removed by the sale" (the burn, a transfer, or "removed"). The `offer_removed`
events of one transaction with the same `removed_by` are one row ("2 offers removed by the sale"). Without `?offers=1` the call passes
`event=mint,burn,modify,sale,transfer`.

### 4.3 Calls

| # | Call | Kept (class) | Feeds |
|---|---|---|---|
| 1 | `nft(id)` → `/v2/nfts/{ID}` | `live` | the mode, the header, the details |
| 2 | node `nftInfo(id)` / `uriToken(id)`, after #1, only in the modes that ask | `live` | the owner, or everything from the network |
| 3 | `nftOffers(id, { limit: 50 })`, indexed modes; the node's offers from the network | `live` | open offers |
| 4 | `nftHistory(id, { descending: true, limit: 20, event?, marker? })`, indexed modes | `live`; `MARKER_PAGE_CLASS` behind a marker | history |

#3 and #4 start with #1; a failure of either is its card's `SectionError` ("Couldn't load the open offers", "… the history"), logged and
degraded. A page behind a marker is the breadcrumb, the header card without owner and last sale, "Back to the NFT" and the history rows.

## 5. Shared pieces

- **`NftLink`** (`app/ui/components/NftLink.tsx`): an NFT id as a link (`nftLink`), its text "#4,127" when a serial is given, else the id
  shortened (`00081388…101F`, mono), the full id in `title`; plain text while `nftLink` gives `null`.
- **`NftGlyph`**: the board's two-character glyph, `aria-hidden` (the issuer's characters 2–3 for a collection, the serial's last two
  digits for an NFT, the id's first two for a URIToken).
- **`collectionLabel(key)`**: "rLULtF…mB3R · taxon 1" / "rEvRt8…Lk2P" (breadcrumbs, titles, labels, 404s).
- **Network words** (`nftWords(net)`): `token` ("NFT" / "URIToken"), `tokens` ("NFTs" / "URITokens"), `kindTag`, the notes; XRPL Testnet and
  Xahau Testnet take their mainnet's (E7's network facts).

## 6. The account and transaction pages

### 6.1 The account page
- **The NFTs tab** (`?tab=nfts`, label "NFTs" / "URITokens"; `ACCOUNT_TABS` gains `nfts` before `analytics`; while `NFTS` is off the
  disabled "soon" tab, and `?tab=nfts` a 302 to the account without a call, as Analytics). The list is streamed like the other tabs:
  `accountNfts(address, { limit: 20, marker? })` (`live`; `MARKER_PAGE_CLASS` behind a marker), rows by collection then serial: NFT
  (`NftGlyph`, `NftLink`), Collection (`collectionLabel`, a link), Last sale, Minted. "This account holds no NFTs in the index." when empty,
  the coverage note under it. `TabList` gains `{ tab: "nfts"; rows; paging; coverage }`, `TAB_WHAT.nfts` "NFTs".
- **The Objects tab** (`objectRows`, read live from the node): `NFTokenPage` keeps "NFTs: 32" and, while `NFTS` is on, adds "See the
  account's NFTs" (`?tab=nfts`); `NFTokenOffer` gains NFT (`NftLink` of its `NFTokenID`), Side, Amount, Only for, Expires; `URIToken` gains
  URIToken (`NftLink` of its `index`), Issuer, and Sell offer (`Amount`, with "only for {Destination}") when it has one.
- **Owned objects** labels: "URI token(s)" becomes "URIToken(s)" (decision 18).

### 6.2 The transaction page
`Segment` gains `{ t: "nft"; v: string; serial?: number }`, which `Sentence` renders with `NftLink`. The describe handlers put the NFT in the
details as that segment: `NFTokenBurn`, `NFTokenCreateOffer` (`NFTokenID`), `URITokenBurn`, `URITokenBuy`, `URITokenCreateSellOffer`,
`URITokenCancelSellOffer` (`URITokenID`), `Remit` (each of `URITokenIDs`); and, worked out from the metadata by two new pure helpers of
`app/domain/parse/`, `mintedNftIds(meta)` (the ids added over the union of the `NFTokenPage` diffs, D3 §2.1's rule) for `NFTokenMint`, the
created `URIToken`'s index for `URITokenMint` and `Remit`'s `MintURIToken`, and `acceptedNftId(meta)` (the `NFTokenID` of a deleted
`NFTokenOffer`) for `NFTokenAcceptOffer`, each as the detail "NFT" / "URIToken". The mint sentence reads "minted NFT {nft}" when the id is
known. `describe/` and `parse/` stay in the Worker (`transaction-bundle.test.ts`); the page receives segments.

## 7. Search

**The search sequence of program 2** is defined here; E10 and E14 extend it at the points named below and redefine nothing:

1. `classify` (`app/domain/search.ts`) decides by the text's shape, as today. E14 adds one shape: exactly 48 hex digits, an MPT issuance
   ID, checked before the other hex rules (a 302 to the MPT page, no call).
2. For 64 hex digits, `findHash` asks **the index** side by side: the transaction, the ledger, the NFT (E8, `api.nft`), the ledger object
   (E10, `api.ledgerObject`).
3. Only when the index has none of them, **the node** side by side: `tx`, `ledger`, the NFT (E8, `nftInfo` / `uriToken`), the ledger
   entry (E10, `ledgerEntry`, tracked types only).
4. One found: a 302 to its page. Two or more: the choice page. None: the 404 with "Search on {other network}".

Each question is asked only while its switch is on (`NFTS`, `LEDGER_OBJECTS`). The failure rules stay: something found wins over a
failure of another question; the node is not asked in place of a failed index.

- **`findHash(api, node, hash, { nfts })`** (`app/server/resolve.ts`): E8's part of steps 2 and 3. One found: a 302 to it
  (`/{net}/nft/{HASH}` for an NFT). Two or more: the choice page (`SearchChoicePage` gains the row "NFT #4,127 of rLULtF…mB3R · taxon 1" /
  "URIToken of rEvRt8…Lk2P", with "burned" when it is). `HashMatches` gains `nft?: { kind: "nftoken" | "uritoken"; issuer: string;
  taxon?: number; serial?: number; burned: boolean }`.
- **Hints and words**: with `nfts`, the 64-hex hint is "Transaction, ledger or NFT" (Xahau "… or URIToken"); the header box's placeholder is
  "Address, hash, ledger, CTID or NFT id" (the board's), the home page's hero "Address, transaction hash, ledger index, CTID or NFT id"; the
  help text adds "an NFT or URIToken id (64 hex digits)". `SearchBox` reads `useFeatures()`.

## 8. Coverage notes

`checkCoverage(body)` (`app/server/coverage.ts`) checks `coverage` inside each call's cached load: an object with `complete` a boolean and
`from_ledger_index`, when present, a positive whole number; anything else makes the answer kind `server`. `coverageNote(coverage, words)`
gives `null` when complete, else the text "Covers ledger #96,100,001 onwards: earlier {words} are not in the index yet." (`words` is the
list's: "NFT sales", "collections", "NFT activity"; without `from_ledger_index`, "The index does not hold this history yet."), with the ledger
as a link. `CoverageNote` (`app/ui/components/CoverageNote.tsx`) draws it as one faint line with the info icon (`role="note"`) directly
under its list or figure. On the NFT page the history and offers use the NFT's own coverage ("This NFT's history in the index starts at
ledger #N: …"). Later features (E10, E11, E12, E14) reuse `Coverage`, `checkCoverage`, `coverageNote` and `CoverageNote` as defined here.

## 9. Caching

| Page | Class | Note |
|---|---|---|
| `/{net}/nfts`, first page | `minute` | the volume live sets and the collections change at the aggregator's minute |
| `/{net}/nfts`, behind a marker; `/nfts/sales` behind a marker | `MARKER_PAGE_CLASS` (`slow`) | `noindex, follow` |
| `/{net}/nfts/sales`, first page | `minute` | |
| a collection | `minute`; behind a marker `MARKER_PAGE_CLASS` | |
| an NFT | by mode (4.1): `live`, `slow` (burned), `short` 60 s (from the network) | |
| redirects, 404s, form errors | `short` | |

Calls keep their own classes (2.2, 3.2, 4.3). No call asks for the failure hold (no page polls).

## 10. SEO, link previews, accessibility

- **Tags.** The list: "NFTs · XRPL · explorer" ("URITokens · Xahau · explorer"), a description without figures, canonical, `og:*` without
  image; another period, a filter, a sort or a marker: `noindex, follow`, no canonical. Older sales: `noindex, follow`. A collection:
  "Collection rLULtF…mB3R · taxon 1 · XRPL · explorer", canonical keeps `tab` unless `sales`, another measure or a filter `noindex, follow`.
  An NFT: "NFT #4,127 of rLULtF…mB3R · taxon 1 · XRPL · explorer" ("(burned)" after the name), description "Owned by rHciXf…JrHC · last
  sold for 1,250 XRP · XRPL", canonical `/{net}/nft/{ID}`, `og:image` and `twitter:card=summary_large_image`; from the network `noindex`.
- **The image** `/og/{net}/nft/{ID}.png` (`ImageKind` gains `nft`; `nftCard` in `card-data.ts` from the same facts as `nftMeta`): kind
  "NFT" / "URIToken", the headline "#4,127" or the short id, the collection, the owner, a note "Last sale 1,250 XRP" or "Burned", the footer
  "Minted 14 Mar 2024". Class `slow` (`max-age=300`); from the network `short` 60 s; `nft not found` everywhere a 404 `short`; validation and
  the lower-case 302 as for transactions; a failure a 503, not stored.
- **Accessibility.** Tables have captions (visually hidden where the card's heading says it), sort headers `aria-sort`, the "to" of seller →
  buyer in a visually hidden span, the glyphs `aria-hidden`, the flags' state in text, tabs and toggles as links with `aria-current`, the
  forms' errors `aria-describedby`, 44 px targets on touch. Each page is checked with axe in both themes at desktop and phone width.

## 11. Data interface

- **`DataApi`** (`app/server/data-api.ts`) gains, each with its shape check inside the cached load: `nftVolume(q: VolumeQuery | { live:
  NftPeriod }, opts?)`, `nftSales(q)`, `nftCollections(q: { limit; sort?; descending?; issuer?; marker? })`, `nftCollection(key)`,
  `nftCollectionStats(key, { start; end })`, `nftCollectionSales(key, q)`, `nftCollectionNfts(key, q & { owner?; includeBurned? })`,
  `nftCollectionHolders(key, q)`, `nft(id)`, `nftOffers(id, q)`, `nftHistory(id, q & { event? })`, `accountNfts(address, q)`. A collection
  key is `{ issuer; taxon?: number }`, sent as `/{issuer}` or `/{issuer}/{taxon}`. List calls use `listClass` (a marker page is
  `MARKER_PAGE_CLASS`). The paths go into `PENDING_PATHS` until `pnpm api:sync` brings D3's `openapi.yaml`, then into `PATHS`.
- **`NodeRpc`** (`app/server/node-rpc.ts`) gains `nftInfo(id)`, `nftSellOffers(id)`, `nftBuyOffers(id)` (XRPL) and `uriToken(id)` (Xahau),
  each checking that the answer is the NFT asked for and `validated` (Clio's `nft_info` carries `validated`).
- **Types** (`app/server/api-types.ts`, by hand from D3 §5): `Coverage`, `Nft`, `NftEvent`, `NftSale`, `NftOffer`, `NftCollection`,
  `NftCollectionDay`, `NftHolder`, `NftVolumeRow`, `NftVolumeComponent`, `NftEventKind`; the node's `NodeNftInfo`, `NodeNftOffer`,
  `NodeUriToken`.
- **Shapes** (`app/server/nft-shape.ts`): `checkNft`, `checkNftEventsPage`, `checkNftSalesPage`, `checkNftOffersPage`,
  `checkCollectionsPage` (with `total`), `checkCollection`, `checkCollectionDays`, `checkHoldersPage`, `checkNftVolume(body, mode)`; they use
  `isDecimalText`, `isIsoTime` of `aggregate-shape.ts` and `checkCoverage`, and check that ids are 64 upper-case hex digits (they go into
  paths) and that a page's NFTs belong to the collection asked for.
- **Not in the data:** collection names and images, open-offer floors, an account's NFT count (the tab says "Showing 20", not a total).

## 12. Bundle

Each page is a lookup page (budget 150,000 bytes gzip with the manifest, `pnpm check:bundle`). The list draws `ColumnChart` and `BarList`;
the collection `ColumnChart`; the NFT page no chart. `test/unit/nft-bundle.test.ts` holds the four pages to: no runtime import from
`app/server`, `app/domain/describe`, `app/domain/parse` or `ripple-*`; `NftPage` imports nothing of `app/ui/charts/`; `nft-id.ts` (which the
NFT page's builder uses in the Worker) is not imported by a page. The figures of the day go into "The client bundle check".

## 13. Testing

- **Unit** (`pnpm test`, project `unit`): `nft-params.test.ts` (every canonical form and redirect of 1.2 and 1.3), `nft-link.test.ts`,
  `nft-id.test.ts` (the decode against every recorded mint's fields, unscrambling, the flags per network, `uriText` on text, binary and
  empty), `nfts-view.test.ts`, `nft-collection-view.test.ts` (30-day figures, `null` days, the share), `nft-view.test.ts` (every mode of
  4.1, the history cells, grouped removals, expired offers), `nft-shape.test.ts`, `coverage.test.ts`, `card-data.test.ts` (`nftCard`),
  `meta.test.ts` (the three builders), `resolve.test.ts` (`findHash` with NFTs: one, two, three found, failures), the parse helpers
  (`mintedNftIds`, `acceptedNftId`) on the recordings, `describe.test.ts` (the `nft` segments), `account-view.test.ts` (the object rows),
  `nft-bundle.test.ts`.
- **Components**: `NftsPage.test.tsx`, `NftCollectionPage.test.tsx`, `NftPage.test.tsx`, `CoverageNote`, `NftLink` (link and off forms),
  `Sentence` with an `nft` segment; rendered as the Worker prints them and hydrated.
- **Worker** (`test/worker/`): `nfts-list.spec.ts` (calls, classes, each card's failure, markers, the form errors), `nft-collection.spec.ts`
  (both key forms, the redirects, tabs, filters, 404, 503), `nft.spec.ts` (each mode against the fixture node, `unknownCmd`, the class per
  mode), `search.spec.ts` (NFT ids), `account.spec.ts` (the tab and objects), `og.spec.ts` (kind `nft`), `meta.spec.ts`, `data-api.spec.ts`
  (each call's class and path), and `nfts-off.spec.ts` in the `worker-off` project (every route and image a 404 without a call, the header's
  "soon", plain ids, the account tab "soon", search without the NFT question).
- **End-to-end** (`test/e2e/`): `nfts.spec.ts` on both networks: the list (period, sort, filter, older sales), a collection (measure,
  tabs, filter, burned), an NFT (indexed, burned, from the network, offer events), search by an NFT id and by an id that is also a
  transaction, the account NFTs tab, the transaction page's NFT link, without JavaScript too; `a11y.spec.ts` adds the four pages in both
  themes; `og.spec.ts` the NFT image; `client-meta.spec.ts` no manifest request between the new routes. Skipped while `E2E_FEATURES_OFF`
  lists `NFTS`, whose off-case is checked instead.

## 14. Fixtures

- **Recordings.** New sets, by the recorder of the existing ones: `test/fixtures/ledgers/xrpl-nft/` (an `NFTokenCreateOffer` sell and buy, an
  `NFTokenCancelOffer`, a brokered `NFTokenAcceptOffer` with a transfer fee, a sale in an issued currency, an `NFTokenBurn` that removes
  offers, an `NFTokenModify` if one is found) and `xahau-nft/` (`URITokenCreateSellOffer`, `URITokenBurn`, a `URITokenMint` with `Amount`),
  beside the NFT types already recorded (`NFTokenMint`, `NFTokenAcceptOffer`, `NFTokenBurn`, `URITokenMint`, `URITokenBuy`,
  `URITokenCancelSellOffer`, `Remit`). `PROVENANCE.md` gains their table.
- **Generator.** `scripts/nft-derive.ts` works the events out of the recordings by D3 §2's rules (a port, pinned to the D3 commit in
  `PROVENANCE.md`), and `scripts/nft-fixtures.ts`, called by `scripts/http-fixtures.ts`, writes:
  - derived: `data-api/nfts/<ID>.json`, `…/history@descending=true&limit=20[&event=…][&marker=…].json`, `…/offers@limit=50.json` for each
    recorded NFT (one featured per network with two history pages and offers; one burned); `data-api/accounts/<address>/nfts@limit=20.json`
    for the hand-written accounts (empty where they hold none) and one holder;
  - synthetic, seeded around the derived NFTs: `data-api/nft_collections@limit=20&sort=…[&descending=false][&issuer=…][&marker=…].json`
    (about 60 collections on XRPL in 3 pages, 12 on Xahau), `nft_collections/<issuer>[/<taxon>].json` for the featured collection and two
    more, its `/stats@end=2026-10-17&start=<W₀>.json` (30 days, two quiet), `/sales@…`, `/nfts@…` (one burned, one filtered by owner),
    `/holders@…`; `data-api/nft_sales@descending=true&limit=10.json` and `limit=20` pages; `data-api/network/nft_volume@live=<period>.json`
    and `@end=2026-10-17&interval=day&limit=1000&start=<W₀>.json`; coverage `complete: false` on Xahau's files and `true` on XRPL's, so both
    states are rendered;
  - node: `node/nft_info/<ID>.json` (Clio's shape, with `validated`) for the featured NFT and one the index lacks, `node/nft_sell_offers/…`,
    `node/nft_buy_offers/…`, `node/ledger_entry/<ID>.json` for a URIToken the index lacks; an id with no file answers `objectNotFound` /
    `entryNotFound`.
- `pnpm fixtures:check` covers them; `test/unit/nft-fixtures.test.ts` checks that the synthetic files agree with the derived ones (the
  featured collection's sales include the derived sale; supply and holders match its NFT files).

## 15. Rollout

1. Build behind `NFTS` (on at the top level and in the tests, off in `sandbox` and `production`).
2. Per environment, after D3 is deployed there on both networks (migration, parser, aggregator), its `nft_*` lag gauges are near 0 and the
   routes answer: a commit turns `NFTS` on for that block of `wrangler.jsonc`, and a deploy. Coverage notes show until the re-ingest of
   D3 §8 completes; nothing changes when it does.
3. Rolling back is `"off"` and a deploy.

**README sections to update:** "Switches" (the `NFTS` row, its gates and its condition), "The data API and the node" (the new files and calls,
the node's NFT readers), "The cache classes" (what uses `minute` and `slow`), "The UI and the routes" (the four routes, `navSection`), a new
section "NFTs" in the style of "AMM pools" (routes, parameters, validation, modes, calls, switch, image, tags, fixtures, bundle, tests), "The
account page" (the NFTs tab, the Objects rows), "The transaction page" (NFT links), "Search" (NFT ids), "SEO and link previews" (the tags,
image kind `nft`), "Tests", "Upstream fixtures" (the new files and recordings), "End-to-end tests", "The client bundle check" (the figures).
