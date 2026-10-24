# MPT page and the token list's MPT tab: design (E14)

Date: 2026-10-24. Status: proposed (2026-10-24), program 2, sub-project E14. Repository `GateHubNet/x-explorer`, branch
`feat/explorer-pages-2`.

- **Boards** (`2026-10-24-explorer-mock/`): `Mpt.dc.html` (one issuance), `Tokens.dc.html` with `kind=mpt` and `TokensMpt.dc.html`
  (the MPT tab, on XRPL Testnet). For what changes on them: `Transaction.dc.html`, `Account.dc.html`. Their sample data is made up.
- **Data:** data API sub-project D9, `docs/superpowers/specs/2026-10-17-mpt-data-design.md` (revised 2026-10-24) in `data-api`, branch
  `feat/explorer-data-2`; "D9 §n" below are its sections. The token list's envelope is D6's (`2026-10-24-issued-tokens-design.md` there).
- **Builds on**, and redefines none of: E7 `2026-10-24-sandbox-environment-design.md` (the sandbox, the testnets' names and the badge),
  E8 `2026-10-24-nft-pages-design.md` (`checkCoverage`, `coverageNote`, `CoverageNote`, the `Coverage` type, the `*-link.ts` and
  one-URL-per-view patterns, the search sequence of E8 §7), E9 `2026-10-24-display-names-design.md` (display names in `AccountLink`, a
  loader's `collectAddresses` and one names call `loadNames`), E10 `2026-10-24-ledger-object-pages-design.md` (the escrow page, the
  `hasDelegation` network fact this spec's `hasMpt` follows, and the minimal `MptAmount`, which this spec extends), E11
  `2026-10-24-token-pages-design.md` (`/{net}/tokens`, its kind tabs, the Tokens nav item, the `TOKENS` switch). Built last, after E9.
- **Overview:** `2026-10-24-explorer-program-2-overview.md`.

## Owner decisions to confirm

The product choices of this spec and its departures from the boards. Each is built as written unless the owner says otherwise.

| # | Choice | Recommendation and why |
|---|---|---|
| 1 | **Deferred:** the board's "Holders over time" card is left out; the Holders tile's line reads "accounts holding HTF" instead of "+N in 90 days". | As the brief: the chart needs a daily statistics job. |
| 2 | The Locked tile is what the issuer has locked (D9 `locked_amount`); an amount in escrow (the ledger's `LockedAmount`) is added to its line when above 0 ("…; 12,000.00 HTF in escrow"). | Yes: the board's wording, and escrow is a different thing. |
| 3 | The Flags card's intro is "What the issuer allows, as the issuance says now." instead of "Set when the issuance was created. They cannot change."; "Can trade" reads "The issuer allows HTF on the DEX. MPT trading isn't enabled on XRPL yet." (and the list's Trade pill title likewise). | Yes: DynamicMPT (possibly on XRPL Testnet) lets flags change, and MPTokensV2 is not enabled. |
| 4 | "All 3,412 holders →" and "Older →" open pages of their own, `/{net}/mpt/{ID}/holders` (50 a page) and `/{net}/mpt/{ID}/transfers` (20 a page), with Newer and Older. | Two pagers cannot share one URL (E8's rule). |
| 5 | MPT amounts outside the MPT page (a transaction's sentence, flow, details and balance changes; an account's Transactions and Payments tabs and Tokens card; an escrow's amount) are scaled and named by ticker from one `GET /v2/mpt?ids=` call per page. Without an answer they read "2,500,000 units of MPT 0000012A…". | Yes: the amounts are the ledger's integers; the scale lives in the issuance. |
| 6 | An account's MPT holdings go on its **Tokens card**, read from the node's `account_objects` (the `MPToken` entries the page already loads), not from the index's `/v2/accounts/{a}/mpt`. Issuances the account owns are counted ("MPT issuances") and listed on the Objects tab, each linking to its page. | Yes: current and complete, no new call; the index's list has a coverage. |
| 7 | **Node fallback:** when D9 answers 404, the page reads `ledger_entry` (`mpt_issuance`): header with the issuance ID, the tiles but Holders, the flags, and the metadata as hex (and its text when it is UTF-8 text, not decoded as XLS-89), under "Not in the index yet, shown from the network". Holders and transfers are still asked of the index. | Yes: the brief's node rule; one metadata decoder (the API's). |
| 8 | Metadata links: only `https://` URLs and `hostname/path` (read as `https://`) are links, with `rel="noopener noreferrer nofollow ugc"`; anything else is text. The icon is a link, never loaded. | Yes: the metadata is the issuer's, unchecked. |
| 9 | The transfers' Kind words: Transfer (payments, issuing and redeeming, as the board's footnote says), Clawback, Lock, Unlock, Escrow, Escrow finished, Escrow cancelled. | The board's words, with the kinds it did not show. |
| 10 | Search: 48 hex digits go to `/{net}/mpt/{ID}` without a call (nothing else is 48 hex digits). | Yes. |
| 11 | Xahau: `/xahau/mpt/{ID}` is the board's "MPT isn't enabled on Xahau" page as a 404 (class `short`, no call) with "Open it on XRPL"; the MPT tab is disabled with "MPT isn't enabled on Xahau." and `?kind=mpt` there is a 302 to the issued list. | The board, with a status that says nothing is there. |
| 12 | A link-preview image for the MPT page (kind `mpt`); the holders and transfers pages have tags without an image. | As E5 and E8 (images of things). |
| 13 | A `Clawback` sentence for issued tokens too ("clawed back 50 USD from {holder}"), since the type had none. | Yes: one handler per type. |
| 14 | No page polls. Classes: the MPT page and the MPT tab `minute`, from the network `short` (60 s), behind a marker `MARKER_PAGE_CLASS`. | D9's aggregate changes at the aggregator's tick; nothing on the boards is live. |
| 15 | The MPT tab's search is the API's `q` (a GET form), not the board's filtering of one page. | As E8 decision 6. |
| 16 | `MPT` goes on in an environment once D9 is deployed there and its `syncer_mpt_state_lag_ledgers` is near 0, before the reprocess has made the coverage complete. | The coverage notes say what is missing (E8 decision 17). |
| 17 | **Consistency pass:** `MptAmount` is E10's minimal component (issuance ID and integer value, raw), which E14 extends with the scale, the ticker and the link; the 48-hex search is an extension of E8's search sequence. | E10 is built first and shows MPT escrows; one search sequence for the program. |

## Context

**What the explorer shows of MPTs today.** `parse/types.ts` says MPT amounts are not modelled: `parseAmount` returns nothing for
`{ mpt_issuance_id, value }`, so an MPT payment's sentence shows the amount as JSON text, the flow and the balance changes leave the
MPT out (`parse/balance-changes.ts` reads `AccountRoot` and `RippleState` only), and the four MPT transaction types fall to
`describeUnknown` ("submitted an MPTokenIssuanceSet" and a table of fields). The account page counts `MPToken` and `MPTokenIssuance`
objects by their raw type names, and its Payments tab has no MPT rows (the data API dropped them until D9).

**Facts of D9 that shape this design** (D9 §2, §7): amounts are the ledger's integers, scaled by the issuance's `asset_scale`; the
issuance answer carries decoded metadata, `metadata_hex` and `metadata_conforms`; `/v2/mpt/{ID}` is 404 for an issuance created
less than a tick ago or whose state is outside the coverage (D9 decision 13); every list carries D3's `coverage`; the token list is D6's
`/v2/tokens` with `kind=mpt`; `GET /v2/mpt?ids=` answers ticker, name and scale for up to 100 IDs; Xahau has no MPT.

## Goal

`/{net}/mpt/{ID}` and the MPT tab of `/{net}/tokens` show every element of the Mpt and Tokens (MPT) boards that the data fills,
server-rendered and readable without JavaScript; every MPT amount and issuance ID the explorer shows reads in its token's units and leads
to its page while `MPT` is on; on both networks, in production and the sandbox.

## Scope and non-goals

**In:** the MPT page and its holders and transfers pages; the MPT tab of the token list; MPT amounts in `parse/` and `describe/`, the
transaction page, the account page (Tokens card, Objects tab, Transactions and Payments tabs) and the escrow page; describe handlers for
`MPTokenIssuanceCreate`, `MPTokenIssuanceDestroy`, `MPTokenIssuanceSet`, `MPTokenAuthorize`, `Clawback`, and MPT payments; search; the
link preview; the switch `MPT`.

**Not in:** the holders-over-time chart (deferred); token prices or volumes of MPTs (none exist); an issuer's list of its issuances on
the account page (the MPT tab's `q=<address>` serves it); fetching or showing an issuer's icon; checking metadata against the issuer's
domain; MPT trading views (MPTokensV2 is not enabled).

## 1. Routes

### 1.1 Files

| URL | Route file | What |
|---|---|---|
| `/{net}/mpt/{ID}` | `routes/net.mpt.$id.tsx` | one issuance (section 3) |
| `/{net}/mpt/{ID}/holders` | `routes/net.mpt.$id.holders.tsx` | all its holders, 50 a page |
| `/{net}/mpt/{ID}/transfers` | `routes/net.mpt.$id.transfers.tsx` | its transfers, newest first, 20 a page |
| `/{net}/tokens?kind=mpt` | E11's `routes/net.tokens.tsx` | the MPT tab (section 4); E11 owns the route, E14 its MPT branch |
| `/og/{net}/mpt/{ID}.png` | the image route, kind `mpt` | section 9 |

`routes.ts` lists `mpt/:id`, `mpt/:id/holders` and `mpt/:id/transfers` under `:net`. The three pages set `navSection: "tokens"` (the
header's Tokens item is current, as on the board). **Other files:** `app/domain/mpt.ts` (pure, browser-safe: `isMptId`, `mptPath`,
`scaleUnits(units, scale)`, `transferFeeText(fee)`, `safeLink(text)`, `ASSET_CLASS_WORDS`, `MPT_FLAG_WORDS`); `app/domain/mpt-link.ts`
(`mptLink(net, id, features)`: the MPT page while `features.mpt`, else `null`, as `nft-link.ts`); `app/domain/mpt-params.ts`
(`parseMptParams`, `parseMptListParams`, `mptHoldersHref`, `mptTransfersHref`); the view builders `app/server/mpt-view.ts` (`mptPage`,
`mptHoldersPage`, `mptTransfersPage`, `mptTokensTab`, `mptAmountsOf`, `resolveMpt`); `app/server/mpt-shape.ts`; the tags
`app/server/meta-mpt.ts`; the pages `app/ui/pages/MptPage.tsx`, `MptHoldersPage.tsx`, `MptTransfersPage.tsx`, `NoMptPage.tsx`;
the components `app/ui/components/MptLink.tsx`, `MptFlags.tsx` (new) and E10's `MptAmount.tsx` (extended, section 5.1); the MPT body of
E11's list `app/ui/pages/MptTable.tsx`.

### 1.2 URLs and parameters

One URL per view: anything but the canonical form is a 302 to it (class `short`, before any call), as E8 §1.2.

| Page | Parameters, in order | Default |
|---|---|---|
| the MPT page | none | |
| holders | `marker`, `back` | the first page |
| transfers | `marker`, `back` | the first page |
| the MPT tab | E11's (`kind=mpt`, then `q`, `marker`, `back`) | |

Newer and Older use `trailPaging` (`?marker=M3&back=M2.M1`). The MPT page's "Older →" links to `/{net}/mpt/{ID}/transfers?marker=<M>`
with the marker of its 8-row call (a marker is a key, whatever the page size), and "All N holders →" to `/{net}/mpt/{ID}/holders`.

### 1.3 Validation and redirects (before any call)

| Request | Answer |
|---|---|
| any route above, or the image, while `MPT` is off | 404 "We couldn't find the MPT pages on {network}", class `short`, no call |
| `/xahau/mpt/{x}` (Xahau and Xahau Testnet), 48 hex digits | 404 with `NoMptPage` (section 3.6), class `short`, no call, `noindex` |
| `{x}` not 48 hex digits | 404, class `short`, no call |
| an ID in lower or mixed case | 302 to the upper-case URL, `immutable` |
| a `marker` that fails `isMarker`, one the API refuses (400), or with nothing behind it | 404, class `short` |
| `?kind=mpt` on Xahau, or while `MPT` is off | 302 to the issued list (`/{net}/tokens`), `short` |

## 2. Data

### 2.1 Calls

`DataApi` (`app/server/data-api.ts`) gains, each with its shape check inside the cached load (section 2.3):

| Method | Path | Class |
|---|---|---|
| `mpt(id)` | `/v2/mpt/{issuanceId}` | `minute` |
| `mptHolders(id, { limit, marker? })` | `/v2/mpt/{issuanceId}/holders` | `minute`; behind a marker `MARKER_PAGE_CLASS` (`listClass`) |
| `mptTransfers(id, { descending: true, limit, marker? })` | `/v2/mpt/{issuanceId}/transfers` | the same |
| `mptLookup(ids)` | `/v2/mpt?ids=…` (1–100, sorted and deduplicated before the call, so a page's key is stable) | `slow` |
| `tokens({ kind: "mpt", q?, limit, marker? })` | E11's call with `kind: "mpt"` | E11's (`minute`) |

`NodeRpc` (`app/server/node-rpc.ts`) gains `mptIssuance(id)`: `ledger_entry` with `{ mpt_issuance: id, ledger_index: "validated" }`
(class `live`); it needs `validated: true` and an `MPTokenIssuance` node whose `Issuer` and `Sequence` make the ID asked for;
`entryNotFound` is `not_found`, `invalidParams` is `bad_request`. The paths go into `PENDING_PATHS` until `pnpm api:sync` brings D9's
`openapi.yaml`, then into `PATHS`.

### 2.2 Types (`app/server/api-types.ts`, by hand from D9 §7)

`MptFlags` (`locked, can_lock, require_auth, can_escrow, can_trade, can_transfer, can_clawback`), `MptMetadata` (`ticker?, name?,
desc?, icon?, asset_class?, asset_subclass?, issuer_name?, uris?: { uri: string; category?: string; title?: string }[],
additional_info?: unknown`), `MptIssuance`, `MptIssuanceAnswer` (`{ coverage: Coverage; issuance: MptIssuance }`), `MptHolder`,
`MptHoldersPage`, `MptTransferKind`, `MptTransfer`, `MptTransfersPage`, `MptSummary`, `MptLookup` (`{ issuances: (MptSummary |
{ mpt_issuance_id: string })[] }`), `MptTokenRow` (D9 §7.1's row) and `MptTokensTotals`; the node's `NodeMptIssuance`. `Coverage` is
E8's.

### 2.3 Shapes (`app/server/mpt-shape.ts`)

`checkMptIssuance`, `checkMptHoldersPage`, `checkMptTransfersPage`, `checkMptLookup(body, ids)` (one entry per ID asked, in order, each
the ID asked), `checkMptTokens` (E11 calls it for `kind=mpt`). They use E8's `checkCoverage` and `isIsoTime`, and check: IDs are 48
upper-case hex digits (they go into paths); amounts are integer text (`/^\d{1,19}$/`); `asset_scale` a whole number 0–19 (the ledger
allows 0–255; above 19 is shown unscaled, section 5.1); `transfer_fee` 0–50000; addresses are classic addresses; a holders or
transfers page belongs to the issuance asked for only by its URL (the rows carry no ID). A failed check is kind `server`.

### 2.4 Names and amounts on every page

- **Names** (E9): each loader collects the addresses its page shows with `collectAddresses(…)` (E9 §3.1) and makes one
  `loadNames(api, addresses, ctx)` call (E9 §3.2), `names` in its page data; a failure shows addresses (E9's rule).
- **MPT amounts:** each loader that shows MPT amounts outside an MPT answer collects the page's issuance IDs (`mptAmountsOf`: amount
  segments, flow amounts, balance changes, touched `MPToken` and `MPTokenIssuance` objects, payment rows, Tokens card rows) and makes one
  `mptLookup` call, only while `MPT` is on (off, the route may not exist: section 7). At most 100 IDs; beyond, the rest stay in units.
  `resolveMpt(view, lookup)` fills each MPT amount's `value` (scaled) and `ticker`; an ID the lookup answers bare, or a failed lookup,
  leaves units (section 5.1). A failed lookup is logged and marks the page degraded (`markDegraded`), so it is not stored.

## 3. The MPT page, `/{net}/mpt/{ID}`

### 3.1 Layout (the board, top to bottom)

- **Breadcrumb:** {network} / Tokens / {ticker, else "MPT"}.
- **Header card:** the token circle (the ticker's first letter, else "?", `.tok.none`), the heading (the metadata's `name`, else the
  ticker, else "MPT 0000012A…3F09"), the ticker pill and the "MPT" pill; "Issued by {AccountLink}" and, when the heading or ticker came
  from the metadata, "· name and ticker from the issuance's metadata"; the "Issuer account" link; the Issuance ID in full (mono) with
  `CopyTextButton`; the source caption `/v2/mpt/{issuanceId}`. A destroyed issuance gets a `Notice`: "This issuance was destroyed in
  ledger #N." (`last_ledger`, linked). An issuance whose every balance is locked gets a `Notice`: "The issuer has locked every HTF balance."
- **Figures** (six `StatTile`s, the board's order; HTF stands for the ticker, else "units"):

| Tile | Value | Line |
|---|---|---|
| Outstanding | `outstanding_amount` scaled | "HTF held by holders, 36.4% of the max amount" / "HTF held by holders; no max amount is set" |
| Max amount | `maximum_amount` scaled, or "Not set" | "HTF, fixed when the issuance was created" / "Up to the ledger's limit" |
| Locked | `locked_amount` scaled | "HTF in N holder balance(s) the issuer has locked" / "Every balance is locked" / "Nothing is locked" / "The issuer cannot lock HTF" (`can_lock` false and nothing locked); then "; 12,000.00 HTF in escrow" when `escrowed_amount` > 0 |
| Holders | `holders` | "accounts holding HTF" |
| Transfer fee | `transferFeeText` ("0.10%", "None") | "charged when holders send HTF to each other" / "holders pay no fee to send HTF" |
| Asset scale | `asset_scale` | "Amounts are integers scaled by 10⁻²: 1 HTF is 100 on the ledger." / scale 0: "Amounts are whole numbers: 1 HTF is 1 on the ledger." |

- **Flags card** (`MptFlags`): the intro of decision 3; six rows, the board's order and words (Can lock, Require auth, Can escrow, Can
  trade, Can transfer, Can clawback), each "Yes" or "No" with its line, the ticker in place of HTF; the `locked` flag is the Notice above,
  not a row. Source caption `/v2/mpt/{issuanceId}`.
- **Metadata card:** the board's intro ("What the issuer wrote into the issuance, decoded. Nothing here is checked against the issuer's
  domain."), then one row per decoded field in XLS-89's order, labelled with its long key: `ticker`, `name`, `desc`, `icon` (a link, by
  decision 8), `asset_class` with its words (`rwa` "rwa (real-world asset)", `memes` "memes", `wrapped` "wrapped (a token of another
  chain)", `gaming`, `defi` "defi (decentralised finance)", `other`), `asset_subclass` as written, `issuer_name`, `uris` (each "{title} ·
  {host/path}", a link by decision 8, its category in `title`), `additional_info` (an object as indented JSON in a `.code` block, cut to
  2,000 characters; a string as text). When `metadata_conforms` is false: "This metadata doesn't follow XLS-89, so some of it may be
  missing here." Then the `<details>` "Raw metadata, as hex (N bytes)" with the hex. No metadata: "The issuer wrote no metadata." Hex that
  did not decode: "The metadata isn't JSON." with its text when `decodeHex` (describe helpers' rule) reads it, then the hex.
- **Top holders** (`DataTable`, 10 rows, `mptHolders(id, { limit: 10 })`): #, Holder (`AccountLink`), Balance (HTF) (`amount +
  escrowed_amount` scaled; "incl. 12.00 in escrow" under it when escrowed), Share of outstanding (the kit's `InlineBar` and the percent,
  two decimals), Balance state (a "Locked" pill with the board's title, else "Can move"). Under it: "The top 10 hold 61.25% of the
  outstanding HTF." and "All 3,412 holders →"; the `CoverageNote` (`coverageNote(coverage, "holders")`, then, as E11 does for trust
  lines, "A holder whose balance has not changed since is not listed yet.").
- **Recent transfers** (`DataTable`, 8 rows, `mptTransfers(id, { descending: true, limit: 8 })`): Time (UTC), Kind (decision 9), From,
  To, Amount (HTF), Transaction (`HashLink`). A lock or unlock of every balance has To "every holder"; a lock's amount is muted (the
  board's colour). Under it: the board's footnote with the issuer's display name, "Older →", and the `CoverageNote` (words "transfers").
- **Empty states:** no holder: "Nobody holds HTF." (and "yet in the index" when coverage is incomplete); no transfer: "No transfers of HTF
  in the index." with the note.

### 3.2 The loader and its modes

1. Validate (1.3). `api.mpt(id)`; at once and beside it `mptHolders(id, { limit: 10 })` and `mptTransfers(id, { descending: true, limit:
   8 })`.
2. **Indexed** (`mpt` answered): `loadNames` over the issuer, the holders and the transfers' parties (at most 27 addresses); then
   `mptPage(...)`. Class `minute`.
3. **From the network** (`mpt` is `not_found`): `node.mptIssuance(id)`. Found: `mptPage` in node mode (decision 7): the tiles from the
   node's fields (Holders "—" with "not in the index yet"), the flags, the metadata as hex and text, the holders and transfers cards from
   their calls when they answered (they 404 when D9 has no row: then each card says "Not in the index yet."). Class `short`, TTL 60 s.
   `entryNotFound`: 404 "We couldn't find this MPT on {network}" with the search box, class `short`. A destroyed issuance the index never
   saw is not on the node either: the same 404.
4. **Failures:** `mpt` failing otherwise (5xx, 429, timeout, a bad shape) is a 503 (`upstreamOutage`); the node failing in mode 3 is a
   503. A holders or transfers call that fails is that card's `SectionError` with Retry, the page served and not stored
   (`markDegraded`). The names call never fails the page (E9).

### 3.3 View builder rules (`mptPage`)

- **Scale:** `scaleUnits(units, scale)` is `BigNumber(units).shiftedBy(-scale)` written with `scale` decimals (the board's "1,240,000.00")
  through `formatAmount`; a scale above 19 is shown unscaled with "units". Compact figures (the tab) use `compactNumber` of the scaled value.
- **Percent:** outstanding of max with one decimal; a holder's share with two, from the exact integers (BigNumber); "<0.01%" below.
- **The top-10 line:** the sum of the ten rows' balances over `outstanding_amount`, two decimals; left out when fewer than two rows.
- **Text from the metadata** is text, escaped by React; nothing of it reaches an attribute but a link's `href` that `safeLink` accepted.
  `safeLink(text)`: `https://…` as it is; `host/path` (no scheme, a host with a dot) as `https://host/path`; anything else `null`.
- **Kinds:** `payment` → Transfer, `clawback` → Clawback, `lock` → Lock, `unlock` → Unlock, `escrow_create` → Escrow, `escrow_finish` →
  Escrow finished, `escrow_cancel` → Escrow cancelled.

### 3.4 The holders and transfers pages

`MptHoldersPage`: the header card's first line (token circle, name, ticker, "MPT", issuer) linking back to the MPT page, then the
holders table of 3.1 with 50 rows, Newer and Older, the coverage note. `MptTransfersPage`: the same head, the transfers table with 20
rows, Newer and Older, the note. Each calls `mpt(id)` (for the scale, ticker and outstanding; `minute`, shared with the MPT page's
entry) beside its list. `mpt` 404 → the page reads the node as 3.2 step 3 for the head only. First page `minute`; behind a marker
`MARKER_PAGE_CLASS`, `noindex, follow`, no canonical.

### 3.5 Both networks and the sandbox

XRPL and XRPL Testnet have MPT (`Network.hasMpt`, a fact E14 adds to E7's network facts in `networks.ts` beside `hasAmm` and E10's
`hasDelegation`: true on XRPL and XRPL Testnet, false on Xahau and Xahau Testnet). The
sandbox's pages are the same with E7's names ("XRPL Testnet") and badge; XRPL Testnet may have DynamicMPT, which changes nothing here
(decision 3's wording already allows it).

### 3.6 Xahau

`NoMptPage` is the board's Xahau state: breadcrumb {network} / Tokens / MPT, the heading "MPT isn't enabled on Xahau", "MPTs exist only
on XRPL, so there is nothing at this issuance ID on Xahau.", the ID (mono), "← Back to tokens" and the link "Open it on XRPL"
(`/xrpl/mpt/{ID}`; in the sandbox the same path, XRPL Testnet). A 404 of class `short`, `noindex`, no call. The board's button that
switches the network in place is a link: the explorer's network is in the path.

## 4. The MPT tab of the token list

E11 (§2.2, "the kind tabs and E14's seam") builds `/{net}/tokens` with `TOKEN_KINDS = ["issued", "mpt"]`, `parseTokensParams`, the
tab model `kindTabs(net, kind, mptAvailable)`, and a `TokensPage` that draws the tabs, the tiles and the coverage notice from the page
data and the body by kind. E14 fills the seam:

- **`mptAvailable`** is `features.mpt && net.hasMpt`; with it, `kind=mpt` is a view (E11 drops it otherwise: the 302 of 1.3), the
  "MPT" tab is a link, and `parseTokensParams` keeps `kind`, `q`, `marker` and `back` for it (`all` is an issued-only parameter and is
  dropped). Off on XRPL the tab is E11's "soon"; on Xahau E11's disabled tab with "MPT isn't enabled on Xahau."
- **The loader's `mpt` branch:** E11's call #1 with `kind: "mpt"`, `limit: 20`, `q`, `marker` (`minute`, as every view of the page);
  the client's `tokens()` type widens to `kind: "issued" | "mpt"`, and the answer is checked with `checkMptTokens` (2.3) for that kind.
  Then `loadNames` for the page's issuers. A failure is E11's (503; a refused marker 404).
- **`mptTokensTab(...)`** (in `mpt-view.ts`) gives `TokensPage` its MPT data:
  - **Intro:** "Tokens on {network}, ranked by holders. Tickers and names come from each issuance's metadata."
  - **Tiles** (from `totals`): "MPT issuances" (`issuances`, "on {network}, with any number of holders"), "Holders" (`holders`,
    "accounts holding at least one MPT"), "Transfers, 24 h" (`transfers_24h`, "MPT payments between accounts").
  - **`MptTable`** (`app/ui/pages/MptTable.tsx`, the board's columns, in `DataTable`): # (`rank`), Token (the circle, ticker and
    name; without a ticker "No metadata" and the short ID with the full ID in `title`; a link by `mptLink`), Issuer (`AccountLink`),
    Holders, Outstanding (compact, scaled), Max amount (compact, or "not set" faint), Flags (pills in the board's order Transfer, Trade,
    Lock, Clawback, Escrow, Auth for `can_transfer`, `can_trade`, `can_lock`, `can_clawback`, `can_escrow`, `require_auth`, each with
    the board's title, Trade's of decision 3; "none" when none), Transfers 24 h.
  - **Search:** E11's GET form, with the board's MPT label and placeholder ("Ticker, name, issuer or issuance ID"); empty: "No MPTs
    match “{q}”."; the note "N matches" from `total` with `q`, else "Showing 1–20 of N issuances".
  - **Footnote:** the board's flags legend, with Trade's words of decision 3. **Pager:** E11's (trail paging).
  - **Coverage:** E11's notice from the answer's `coverage` (E8's `coverageNote`, words "issuances").
  - **Source caption** `/v2/tokens?kind=mpt`.

## 5. MPT amounts elsewhere

### 5.1 The model

- `parse/types.ts`: `MptAmount = { mpt_issuance_id: string; value: string }`; `Amount = string | IssuedAmount | MptAmount` (the comment
  "MPT amounts are not modelled" goes). `BalanceChange` gains `mpt?: true` (then `currency` is the ID, `value` and `after` are units).
- `describe/types.ts`: `Segment` gains `{ t: "mpt"; id: string; units?: string; value?: string; ticker?: string }`: with `units` an
  amount, without a reference to the issuance; `value` and `ticker` are filled by `resolveMpt` in the Worker. `FlowAmount` becomes
  `{ value; currency; issuer? } | { mpt: string; units: string; value?: string; ticker?: string }`.
- `describe/helpers.ts`: `parseMptAmount(raw)` (an object with a 48-hex `mpt_issuance_id` and integer `value`); `amountSegment` and
  `fieldValue` give an `mpt` segment for one, so every handler that shows an amount field (escrows, checks, generic details) shows MPTs.
- **Rendering**: E10's `MptAmount.tsx` (props `{ id, units, href? }`, drawn raw), extended with `value?` and `ticker?`: with `value`,
  `formatAmount(value)` and the ticker (or "units"), the full ID and the issuer on hover; without, E10's "{units} units of MPT
  0000012A…"; `href` from `mptLink` (the MPT page; none while `MPT` is off, so the amount is text). `Sentence.tsx` and `Flow.tsx` draw
  `t: "mpt"` with it, and the escrow page passes its `value`, `ticker` and `href` now; a reference segment draws the ticker, else
  "MPT 0000012A…".

### 5.2 Parse

- `parse/balance-changes.ts`: an `MPToken` node whose `MPTAmount` changed gives the holder's entry (`account` the holder, `currency` the
  ID, `issuer` the issuer from the ID, `value` the change, `after` the new `MPTAmount`, `mpt: true`); an `MPTokenIssuance` node whose
  `OutstandingAmount` changed gives the issuer's entry (the change negated, no `issuer`, `mpt: true`). The transaction page tags the
  issuer's row "Issuer". (The data API writes a mirror row per holder instead (D9 §4.3); the page shows one issuer row, the net change.)
- `parse/objects.ts`: `MPToken` (account: `Account`) and `MPTokenIssuance` (account: `Issuer`) among the touched objects, with their
  issuance ID for the link.
- The issuer of an ID is decoded in the Worker (`mptIssuerOf(id)` in `describe/helpers.ts`, with `ripple-address-codec`, which
  `describe/` already reaches); `app/domain/mpt.ts` stays free of the codec.

### 5.3 Describe handlers (`describe/mpt.ts`, `mptHandlers`; and `payment.ts`)

Each through `verb`, so a failure reads "tried to …". `{mpt}` is a reference segment, `{amount}` an MPT amount segment, `{account}` an
account segment.

| Type | Title | Sentence after the sender | Details |
|---|---|---|---|
| `MPTokenIssuanceCreate` | MPT issuance | "created the MPT {mpt}" (ID from `meta.mpt_issuance_id`) | Issuance ID, Asset scale, Max amount (scaled by the transaction's own `AssetScale`; "Not set"), Transfer fee, Flags (`tfMPTCanLock`, `tfMPTRequireAuth`, `tfMPTCanEscrow`, `tfMPTCanTrade`, `tfMPTCanTransfer`, `tfMPTCanClawback`), Metadata ("N bytes") |
| `MPTokenIssuanceDestroy` | MPT issuance | "destroyed the MPT {mpt}" | Issuance ID |
| `MPTokenIssuanceSet` | MPT lock | `tfMPTLock` with `Holder`: "locked {account}'s balance of {mpt}"; without: "locked every balance of {mpt}"; `tfMPTUnlock`: "unlocked …"; neither (DynamicMPT): "changed the MPT {mpt}" (title "MPT issuance") | Issuance ID, Holder, Flags, and any other field (`genericDetails`) |
| `MPTokenAuthorize` | MPT authorization | no `Holder`: "opted in to hold {mpt}", with `tfMPTUnauthorize` "stopped holding {mpt}"; with `Holder`: "authorized {account} to hold {mpt}", with `tfMPTUnauthorize` "took back {account}'s authorization to hold {mpt}" | Issuance ID, Holder, Flags |
| `Clawback` | Clawback | MPT: "clawed back {amount} from {account(Holder)}"; issued token: "clawed back {amount} from {account(Amount.issuer)}", the amount shown with the sender as its issuer (the field's `issuer` names the holder) | Amount, Holder |
| `Payment` with an MPT `Amount` | Payment | the sender is the ID's issuer: "issued {amount} to {account}"; otherwise "sent {amount} to {account}"; the delivered amount from `meta.delivered_amount` / `DeliveredAmount`, else `Amount` (not partial), as for other payments | Amount, Delivered when it differs, Send max (an MPT amount), Destination tag, flags |

The flow of an MPT payment is sender → destination with the MPT amounts; the clawback's is holder → issuer. `headlineAmount` and
`rowSentence` (`describe/row.ts`) take MPT amounts, so the account's Transactions tab and the home page's list show them.

### 5.4 Pages

- **Transaction page** (`transaction-view.ts`): after `describe`, `mptAmountsOf` collects the IDs, the loader makes the lookup (2.4),
  `resolveMpt` fills the segments, flow and balance changes. **Class:** the page stays `immutable` when every ID was answered with a scale;
  with an ID answered bare or a failed lookup it is `short` (30 s), never `immutable`, so units are not kept for a year. While `MPT` is off,
  no lookup: units, and the page keeps its class (nothing better will come until the switch flips, which is a new cache generation).
  The touched objects `MPToken` and `MPTokenIssuance` link to the MPT page.
- **Account page** (`account-view.ts`):
  - `OWNED_LABELS` gains `["MPToken", "MPT holding", "MPT holdings"]` and `["MPTokenIssuance", "MPT issuance", "MPT issuances"]`.
  - **Tokens card:** `tokensOf` gains the account's `MPToken` entries of `account_objects` (not truncated beyond the objects' own
    truncation note): one row each, the MPT amount (`MPTAmount` + `LockedAmount`, with "Locked" when `lsfMPTLocked`), the ticker, the
    issuer's display name, a link to the MPT page; after the trust lines, in issuance ID order.
  - **Objects tab** (`OBJECT_FIELDS`): `MPToken`: the MPT (reference), Balance, In escrow (when above 0), Locked, Authorized;
    `MPTokenIssuance`: the MPT, Outstanding, Max amount, Asset scale, Transfer fee.
  - **Payments tab:** a row with `mpt_issuance_id` shows its amount as an MPT amount; the CSV is the API's.
  - One lookup for the page (header, card, the tab's rows), class `slow`; the page keeps its classes (`live` first page; a failed lookup
    marks it degraded, 2.4).
- **Escrow page** (E10): an escrow whose `Amount` is an MPT shows it through `MptAmount`, with the lookup of its loader.
- **Home and ledger pages:** their transaction rows use `rowSentence`; an MPT amount there is shown in units (no lookup on the live
  pages, which poll), with a link to the MPT page.

## 6. Caching

| Page | Class | Note |
|---|---|---|
| the MPT page, indexed | `minute` | D9's aggregate changes at the tick |
| the MPT page, from the network | `short`, TTL 60 s | |
| holders, transfers: first page | `minute` | |
| holders, transfers: behind a marker | `MARKER_PAGE_CLASS` (`slow`) | `noindex, follow` |
| the MPT tab | E11's list class (`minute`); behind a marker `MARKER_PAGE_CLASS` | |
| `NoMptPage`, 404s, redirects but the case one | `short` | |
| the case redirect | `immutable` | |
| a transaction page with an unresolved MPT | `short` | 5.4 |
| the image | `slow`; from the network `short` 60 s | section 9 |

Calls keep the classes of 2.1. No page polls, so no call asks for the failure hold.

## 7. The switch `MPT`

Appended last to `FEATURE_VARS` (`MPT`) and `FEATURE_NAME` (`mpt`), with `Env.MPT`, an entry in every block of `wrangler.jsonc` (top
level `"on"`, `sandbox` and `production` `"off"`), `TOP_LEVEL_SWITCHES`, and the README's tables. While off:

- the routes of 1.1 and the `mpt` image are the 404 of 1.3, no call;
- the MPT tab is E11's disabled "soon" control, and `?kind=mpt` the 302;
- `mptLink` gives `null`: an MPT amount or reference is text, never a link;
- no `mptLookup` call anywhere (the route may be missing upstream: a `Cannot GET` would be an outage), so MPT amounts read in units;
- search treats 48 hex digits as it does today (the help page).

What does not wait for the switch: the parse and describe changes of section 5 (they need no data API), so an MPT payment reads
"sent 2,500,000 units of MPT 0000012A… to …" instead of JSON from E14's deploy on. **Turning it on** in an environment: D9 is deployed
there, `/v2/tokens?kind=mpt` answers, and `syncer_mpt_state_lag_ledgers` is near 0 (decision 16); a commit, a deploy. **The pre-deploy
guard** refuses `MPT` "on" with `TOKENS` anything but "on" (the tab and the breadcrumb live on E11's page). Rolling back is "off" and a
deploy. The switch is in the cache generation.

## 8. Search

E14 extends E8's search sequence (E8 §7) at its first step and changes nothing else in it: `classify` (`app/domain/search.ts`) gains
`{ kind: "mpt", id }` for exactly 48 hex digits (either case, no `0x`), checked before the other hex rules. With `mpt` on and a network
with MPT (`net.hasMpt`): a 302 to `/{net}/mpt/{ID}`, class `short`, no call; on Xahau: the 302 goes to the Xahau page of 1.3 (which
says MPT isn't there). While off: the help page, as today. Hints (`search-hints.ts`): "MPT issuance ID". The help text adds "an MPT
issuance ID (48 hex digits)". The header's placeholder stays as E8 left it ("Address, hash, ledger, CTID or NFT id" while `NFTS` is on).

## 9. SEO and the link preview

- **Tags** (`meta-mpt.ts`, its own module per the bundle rule): the MPT page "HTF · Harborline Treasury Fund · MPT · XRPL · explorer"
  (without metadata "MPT 0000012A…3F09 · XRPL · explorer"), description "MPT issued by {issuer's display name or short address}:
  18,204,511.20 HTF outstanding, 3,412 holders · XRPL", canonical `/{net}/mpt/{ID}`, `og:image`, `twitter:card=summary_large_image`;
  from the network `noindex`. The holders and transfers pages: "Holders of HTF · …" / "Transfers of HTF · …", canonical on the first
  page, `noindex, follow` behind a marker, no image. `NoMptPage` `noindex`.
- **The image** `/og/{net}/mpt/{ID}.png` (`ImageKind` gains `mpt`; `mptCard` in `card-data.ts` from `mptPage`'s facts): kind "MPT", the
  big line the ticker (or the short ID), the name, the issuer, "18.2M HTF outstanding · 3,412 holders", the footer "Created 9 Oct 2025"
  when known. Validation and the lower-case 302 as for the page; while off, on Xahau or for a bad ID a 404 `short`, no call; `issuance not
  found` and not on the node a 404 `short`; from the network `short` 60 s; a failure a 503, not stored.

## 10. Accessibility

Tables have captions (visually hidden where the card's heading says it); the share meter is `aria-hidden` beside its percent in text;
"Locked" carries its meaning in text, not only colour; the Flags rows say Yes or No in text; the copy button has "Copy issuance ID";
the raw metadata `<details>` has a summary that names its size; a disabled tab is `aria-disabled` with its note `aria-describedby`; links
that leave the site say "(opens a new tab)" in a visually hidden span, as the board; 44 px targets on touch. Each page is checked with axe
in both themes at desktop and phone width.

## 11. Fixtures

**Recorded.** `test/fixtures/ledgers/` gains XRPL mainnet ledgers holding (the recording manifest's `cases`): an
`MPTokenIssuanceCreate` with XLS-89 metadata and one with short keys, an MPT payment that issues, one between holders with a transfer
fee, an `MPTokenIssuanceSet` lock of one holder, an `MPTokenAuthorize` (holder), an MPT `Clawback`, an MPT `EscrowCreate`, and an issued-token
`Clawback`. Xahau: none. `http-fixtures.ts` derives their `data-api/transactions/<HASH>.json` (and binary, node) files as for every
recorded transaction.

**Synthetic** (a seeded generator `scripts/mpt-fixtures.ts`, called by `pnpm fixtures:sync`, around the recorded issuances, made by D9's
rules where the recordings say something):

| Path below `xrpl/` | Holds |
|---|---|
| `data-api/mpt/<ID>.json` | the recorded issuances (one with decoded metadata, one with short keys); made-up ones: without metadata, with metadata that is not JSON, one that does not conform, one destroyed, one with every balance locked, one with escrow |
| `data-api/mpt/<ID>/holders@limit=10.json`, `@limit=50[&marker=<M>].json` | the holders, two pages for the first issuance |
| `data-api/mpt/<ID>/transfers@descending=true&limit=8.json`, `@descending=true&limit=20[&marker=<M>].json` | every kind, a lock of every balance, two pages |
| `data-api/mpt@ids=<…>.json` | the lookups of the recorded transaction pages and the active account, one with a bare ID |
| `data-api/tokens@kind=mpt&limit=20[&marker=<M>].json`, `@kind=mpt&limit=20&q=HTF.json`, `@kind=mpt&limit=20&q=zzz.json` | the MPT tab: two pages, a match, none; coverage incomplete on one |
| `node/ledger_entry/mpt_issuance_<ID>.json` | an issuance the index 404s (the node fallback); one `entryNotFound` |
| `data-api/accounts/<active>/payments@…`, `node/account_objects/<active>.json` (by hand) | MPT payment rows; two `MPToken` entries and one `MPTokenIssuance` |

Xahau needs no file: its MPT routes are not called. `pnpm fixtures:check` covers the generator; `test/unit/mpt-fixtures.test.ts` counts
the rows and checks the files against `mpt-shape.ts`.

## 12. Testing

- **Unit** (`pnpm test`): `mpt.test.ts` (`isMptId`, `scaleUnits` at scales 0, 2, 15, 19 and above, `transferFeeText`, `safeLink` on
  `https:`, `host/path`, `javascript:`, `http:`, `ipfs:`, data and empty), `mpt-params.test.ts`, `mpt-link.test.ts` (on and off);
  `describe.test.ts` (every row of 5.3, both outcomes; issued-token clawback; MPT payment issued and sent; a failed one), `parse.test.ts` (MPT
  balance changes, issuer row, objects; snapshots); `mpt-view.test.ts` (every tile line of 3.1, the flags, each metadata state, shares,
  the top-10 line, kinds, node mode, destroyed, locked); `mpt-shape.test.ts`; `transaction-view.test.ts` (resolution, the class rule,
  off); `account-view.test.ts` (Tokens card MPT rows, owned labels, objects rows); `meta.test.ts` (`meta-mpt`); `search.test.ts` (48 hex
  on, off, Xahau); `card-data.test.ts` (`mptCard`); the components `MptAmount`, `MptFlags`, `MptLink`, `MptTable`.
- **Worker** (`test/worker/`): `mpt.spec.ts` (every row of 1.3 and 3.2: indexed, from the network, not found, failures per card, the
  degraded marks, the classes; holders and transfers paging), `mpt-off.spec.ts` (the 404s, the tab, no lookup call, units),
  `data-api.spec.ts` (each new call's path and class, the lookup's sorted IDs), `og` tests for kind `mpt`, the tokens spec of E11 for the
  MPT branch.
- **End to end** (Playwright + axe, `test/e2e/mpt.spec.ts`; skipped when `MPT` is in `E2E_FEATURES_OFF`): the MPT page (tiles, flags,
  metadata with its links and raw hex, holders, transfers, the links to the two pages and their paging), the node fallback page, the Xahau
  page, the MPT tab (search, pager, flags, the disabled tab on Xahau), a transaction with an MPT payment (scaled amount, its link), the
  account's Tokens card; axe on each, both themes, phone width.
- **Bundle:** `mpt`, `mpt-holders` and `mpt-transfers` are lookup pages (150,000 bytes gzip with the manifest, rows added to `PAGES` in
  `scripts/bundle-budget.ts`); they draw no chart (the kit's `InlineBar` only). `test/unit/mpt-bundle.test.ts` holds the pages to no
  runtime import from `app/server`, `app/domain/describe`, `app/domain/parse` or `ripple-*`. The transaction and account pages gain
  `MptAmount` (small) and must stay under their budgets; their figures are recorded in "The client bundle check".

## 13. README sections to update

"Switches" (`MPT`, its row, conditions and the guard), "The data API and the node" (the calls of 2.1, `mptIssuance`, `PENDING_PATHS`),
"The cache classes" (the pages of section 6), "The UI and the routes" (the routes), a new "MPT pages" section (sections 3 and 4), "The
transaction page" (MPT amounts, the class rule), "The account page" (Tokens card, objects), "Search", "SEO and link previews" (kind
`mpt`), "Upstream fixtures" (the rows of section 11), "End-to-end tests", "The client bundle check" (the new pages and figures).

## Rollout

1. E14 merges with `MPT` "off" in the sandbox and production; the parse and describe changes go live with it (section 7).
2. Per environment, once D9 serves there (decision 16): `MPT` "on" for that block of `wrangler.jsonc`, a deploy. The coverage notes show
   until D9's reprocess from MPTokensV1's enable ledger is done.

## Dependencies

- **D9** (all MPT routes, `kind=mpt`, `?ids=`), on **D6**'s `/v2/tokens` and **D3**'s coverage.
- **E11** (the tokens page, its kind control, the `TOKENS` switch the guard requires), **E9** (names), **E8** (`checkCoverage`,
  `CoverageNote`, the link and paging patterns, the search sequence), **E7** (the sandbox networks and their facts table), **E10** (the
  escrow page that shows MPT escrows, its `MptAmount`, which E14 extends, and `hasDelegation`'s pattern).
