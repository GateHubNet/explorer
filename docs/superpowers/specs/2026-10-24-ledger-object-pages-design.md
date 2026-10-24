# Ledger object pages and delegation: design (E10)

Date: 2026-10-24. Status: proposed (2026-10-24), program 2, sub-project E10. Repository `GateHubNet/x-explorer`, branch
`feat/explorer-pages-2`.

- Boards (approved): `2026-10-24-explorer-mock/Escrow.dc.html`, `Check.dc.html`, `PayChannel.dc.html`, `Delegation.dc.html`,
  `Account.dc.html` (the Objects tab's "Open escrow →"), `Transaction.dc.html` and `TransactionMobile.dc.html`.
- Data: D5, `data-api/docs/superpowers/specs/2026-10-24-ledger-objects-delegation-design.md` (its sections are cited as D5 §n).
- Builds on: the foundation (`2026-10-17-explorer-foundation-design.md`), the switches and chart kit of E2
  (`2026-10-19-network-dashboard-design.md`), the account tabs and streaming of the foundation and E4, E7's sandbox network facts, and
  **E9** (`2026-10-24-display-names-design.md`): every address on these pages is shown through E9's `AccountLink` with its display name,
  and each loader makes E9's one batch names call. Overview: `2026-10-24-explorer-program-2-overview.md`.

## Owner decisions to confirm

| # | Choice or deviation | Recommendation |
|---|---|---|
| 1 | Routes are plural, as the brief names them (`/{net}/escrows/{id}`, `/{net}/checks/{id}`, `/{net}/payment-channels/{id}`), unlike the singular `account`, `tx`, `ledger`. Plus `/{net}/escrows/{owner}/{sequence}`, a redirect to the escrow's ID (how `EscrowFinish` names it). | Accept |
| 2 | The board's "All escrows →" link is left out: the network-wide list is deferred. | Accept |
| 3 | The board's "States" strip is labelled "Mock only"; it is built as a static legend of the type's states with the current one marked, not as a switch. | Keep it (or drop it) |
| 4 | The board's "Read live at ledger #N" becomes "As of ledger #N, {time}" for what the index serves; "Read live from the network" is said only of an object read from the node. | Accept |
| 5 | The "Sent by" row, the "sent it on behalf of" sentence and the `DelegateSet` sentences come from the transaction itself and are shown whatever `DELEGATION` says; only the links into the Delegation tab are gated. | Accept |
| 6 | Wording: "Harborline Ops sent it on behalf of Northpeak Treasury." (the brief's words) instead of the board's "…on Northpeak Treasury's behalf", which reads badly after an address with no name. | Accept |
| 7 | The Delegation tab has no count in its label (the API has no totals, as for the other tabs), and each of its two lists shows up to 200 rows without paging ("Showing the first 200" when there are more). | Accept |
| 8 | An object page shows the newest 50 events of its history (oldest first among them), with Newer and Older links for the rest; the board shows every event. | Accept |
| 9 | No link-preview image for the object pages (meta tags, `twitter:card=summary`, as the home page); images can be added later as kinds of the image route. | Accept |
| 10 | "Owner reserve" is the network's current owner reserve (`server_state`), also on a removed object, with the board's words for "released". | Accept |
| 11 | The Objects tab names the source ("From") of an incoming escrow, check or channel (the account is its destination) and lists the account's `Delegate` entries with a link to the Delegation tab. | Accept |
| 12 | A payment channel past its `CancelAfter` or `Expiration` but still in the ledger is shown as "Closing" ("any transaction on it closes it"); the board has no state for it (D5 decision 6). | Accept |
| 13 | Pill gains a `warn` tone (amber) for "Can be cancelled", "Expired" and "Closing", with the board's amber tokens (reused if E9 added them for labels). | Accept |
| 14 | **Consistency pass:** an MPT amount (a token escrow's) is drawn by a minimal `MptAmount` defined here (the issuance ID and the integer value, raw, "2,500,000 units of MPT 0000012A…"); E14, built later, extends it with the scale and ticker from `GET /v2/mpt?ids=` and the link to its MPT page. | Accept: E10 shows MPT escrows before E14 exists. |

## Context

What exists in this repository:

- The account page's **Objects** tab lists an account's live entries from the node (`account_objects`, `limit: 400`; `objectRows` in
  `account-view.ts`): escrows, checks, payment channels, NFT pages, tickets, signer lists, preauthorizations, each with its fields and the
  transaction that last changed it. Nothing links to an object.
- **`describe/`** has handlers for the escrow, check and channel types (`escrow.ts`, `checks.ts`, `paychan.ts`); `DelegateSet` falls to
  `describeUnknown`, and a transaction's `Delegate` field is shown as a generic detail.
- The transaction page lists **ledger objects touched** (`objectsTouched`) as type and account, unlinked.
- The node client (`node-rpc.ts`) has `tx`, `ledger`, `account_info`, `account_objects`, `server_state` and the markets calls; no
  `ledger_entry`.
- Display names (E9) and the sandbox networks (E7) are built before E10.

## Goals

1. An escrow, a check and a payment channel each have a page: state, status, details and history, from the index (D5), from the node when
   the index has no row of the object, and from history once the object is removed.
2. Delegation: the account page's Delegation tab (XRPL only), the transaction page's "Sent by" row and sentence, a `DelegateSet` sentence
   (and its empty-permissions form), and `Delegate` handled for every transaction type.
3. Links into the pages from the Objects tab, the objects touched of a transaction, the describe sentences and search.

## Non-goals

- The network-wide escrows list and any chart of escrows over time (deferred by the owner).
- Pages for other ledger objects (tickets, DIDs, credentials, oracles, NFT offers): later families.
- A Delegate page of its own: a delegation is shown on its accounts' Delegation tabs.
- Link-preview images for these pages (decision 9).

## 1. Routes

### 1.1 Files (`app/routes.ts`, children of `:net`)

| Route | File | Page |
|---|---|---|
| `escrows/:id` | `routes/net.escrows.$id.tsx` | `app/ui/pages/EscrowPage.tsx` |
| `escrows/:owner/:sequence` | `routes/net.escrows.$owner.$sequence.tsx` | none: a redirect |
| `checks/:id` | `routes/net.checks.$id.tsx` | `app/ui/pages/CheckPage.tsx` |
| `payment-channels/:id` | `routes/net.payment-channels.$id.tsx` | `app/ui/pages/PaymentChannelPage.tsx` |

Each exports `headers = forwardCacheClass` and a `meta` from its own `meta-<page>.ts` (`meta-escrow.ts`, `meta-check.ts`,
`meta-payment-channel.ts`). The three pages share `app/ui/pages/LedgerObjectFrame.tsx` (breadcrumb, title row, banners, states strip, the
two-column grid of Details and History). The account page's Delegation tab is `?tab=delegation` of `/{net}/account/{address}`.

### 1.2 Requests and answers (the escrow page; the check and channel pages are the same with their own words)

| Request | Answer | Class |
|---|---|---|
| `LEDGER_OBJECTS` off | the not-found page, no call | `short` |
| an id that is not 64 hex digits (also with `0x`) | 404, no call | `short` |
| 64 hex digits not in upper case | 302 to the upper-case URL, no call | `immutable` |
| a `marker` that `isMarker` refuses, or one the API refuses (400), or with nothing behind it | 404 | `short` |
| the index has it, in the ledger | the page (`origin: "index"`) | `live` |
| the index has it, removed | the page with the removed banner | `slow` |
| the same, reached with `?marker=` (older events) | the page with that page of history; `noindex, follow` | `MARKER_PAGE_CLASS` |
| the index says `escrow not found`; the node's `ledger_entry` has an `Escrow` at that ID | the page from the node (`origin: "node"`), no history, with its notice | `live` |
| the same, and the node has a `Check` or `PayChannel` there | 302 to that type's page | `short` |
| the same, and the node has another type or `entryNotFound` | 404 "We couldn't find escrow 5B9C0E…D21F on XRPL", with "Search on Xahau" (`/{other}/search?q={ID}`) | `short`, `noindex` |
| any other failure of the data API (5xx, 429, timeout, a 400 for a well-formed ID, a `Cannot GET` route) | 503 (`upstreamOutage`), the node not asked | not stored |
| the node fails after the index's 404 | 503 | not stored |
| `server_state` fails (the reserve) | the page without the "Owner reserve" row, marked degraded | served, not stored |
| the names call fails or is late | the page with addresses (E9) | served, not stored |

`/{net}/escrows/{owner}/{sequence}`: `owner` a classic address with a valid checksum and `sequence` a decimal UInt32 written the one way
(no sign, no leading zero) → 302 to `/{net}/escrows/{ID}`, `ID = escrowKeylet(owner, sequence)` (`app/server/keylet.ts`:
SHA-512Half over `0x0075`, the decoded AccountID and the big-endian sequence, with Web Crypto's SHA-512 and `ripple-address-codec`'s
`decodeAccountID`; Worker-only), class `immutable`, no upstream call; anything else, or the switch off, a 404 `short`.

## 2. Data calls

### 2.1 Data API client (`app/server/data-api.ts`)

| Method | Path | Class |
|---|---|---|
| `escrow(id)` | `/v2/escrows/{id}` | `live` |
| `escrowHistory(id, { descending: true, limit: 50, marker })` | `/v2/escrows/{id}/history` | `MARKER_PAGE_CLASS` |
| `check(id)`, `checkHistory(id, q)` | `/v2/checks/{id}[/history]` | `live`, `MARKER_PAGE_CLASS` |
| `paymentChannel(id)`, `paymentChannelHistory(id, q)` | `/v2/payment_channels/{id}[/history]` | `live`, `MARKER_PAGE_CLASS` |
| `accountDelegations(address, { direction, limit: 200 })` | `/v2/accounts/{address}/delegations` | `live` |
| `ledgerObject(id)` | `/v2/ledger_objects/{id}` | `live` |

The paths go in `PENDING_PATHS` until `pnpm api:sync` brings them into `PATHS`. Response types in `api-types.ts`: `Coverage`,
`ObjectAmount` (`{ currency, issuer?, value, mpt_issuance_id? }`), `ObjectRef` (`{ ledger_index, time, tx_hash, tx_type? }`),
`EscrowObject`, `CheckObject`, `PaymentChannelObject`, `ObjectEvent` (the common keys and each type's optional ones), `EscrowAnswer`,
`CheckAnswer`, `PaymentChannelAnswer` (`coverage`, `ledger_index`, `close_time`, the object, `history`, `history_marker?`),
`ObjectHistoryPage`, `Delegation`, `DelegationPermission` (`{ permission, kind: "transaction" | "granular" | "unknown",
transaction_type? }`), `DelegationsPage`, `LedgerObjectRef`; `Coverage` is E8's type. `object-shape.ts` checks each answer inside the
cached load (`checkObjectAnswer(kind, body)`, `checkObjectHistory`, `checkDelegations`, `checkLedgerObject`): IDs of 64 hex digits,
accounts classic addresses with a valid checksum (they go into links), amounts with decimal-text values (`isDecimalText`), times ISO
(`isIsoTime`), statuses and events from D5's lists, and `coverage` through E8's `checkCoverage` (`app/server/coverage.ts`). A 200 that
fails is kind `server`, never stored.

### 2.2 Node client (`app/server/node-rpc.ts`)

`ledgerEntry(index)`: `ledger_entry { index, ledger_index: "validated" }`, class `live`; `entryNotFound` is `not_found`, `validated` must be
`true`; returns `{ node: LedgerObject, index, ledger_index }`. Its times stay Ripple-epoch inside `node` (the fields are the ledger's); the
view builder converts them (`RIPPLE_EPOCH_OFFSET`). `serverState()` (existing) gives the owner reserve.

### 2.3 Names

E9's helper (`app/server/names-load.ts`): after its awaited calls, each loader passes the parts of its page data it shows (the object's
account and destination, an amount's issuer, every event's account and delegate, the breadcrumb's owner) to `collectAddresses(…)`, then
`loadNames(api, addresses, ctx)`, and puts `names` (E9's `NamesPart`) in its data; `AccountLink` renders display names, the full address
on hover. The Delegation tab's list makes its own call inside the list's promise, after its rows and within the list's deadline (E9 §5,
"Account, first page"). A names call that fails or is late shows addresses and marks the page degraded (E9 decision 1).

## 3. Loaders

`requireNetwork`, the switch, the ID's shape, then:

1. **Index**: the object's call (and, with `?marker=`, its history call) in parallel with `serverState()`.
2. **Node fallback** on `not_found` only: `ledgerEntry(id)`; the type decides page, redirect or 404 (1.2).
3. **Names**: one call after the addresses are known.
4. **View builder** (pure, section 4) with `now` = the answer's `close_time` (index) or the request time (node, a `live` page), then
   `cached(page, class)`.

The marker trail follows the account tabs: `?marker=M&back=…` with `trailPaging` (`app/domain/paging.ts`); the API's marker runs towards
older events, the first page has none.

## 4. View builders (`app/server/`, pure, unit-tested)

| File | Exports |
|---|---|
| `ledger-object-view.ts` | `ObjectSource` (`{ origin: "index"; answer; history? }` or `{ origin: "node"; entry; ledgerIndex; now }`), `fromNodeEntry(kind, entry, native)` (the node's fields as D5's object shape: drops to whole units, Ripple-epoch to unix), `timelineOf`, `removedBannerOf`, `asOfNoteOf`, `reserveOf` (the coverage line is E8's `coverageNote`) |
| `escrow-view.ts` | `escrowPage(source, opts)` → `EscrowPageData` |
| `check-view.ts` | `checkPage(source, opts)` → `CheckPageData` |
| `payment-channel-view.ts` | `paymentChannelPage(source, opts)` → `PaymentChannelPageData` |
| `delegation-view.ts` | `delegationLists(given, held)` → the tab's rows |
| `app/domain/object-status.ts` | `escrowStatus`, `checkStatus`, `channelStatus`: D5 §5.2's rules, for objects read from the node (an index answer's `status` is used as it is; a test pins that both agree on the recorded objects) |
| `app/domain/object-link.ts` | `OBJECT_KINDS` (`Escrow` ↔ `escrows`, `Check` ↔ `checks`, `PayChannel` ↔ `payment-channels`), `objectHref(net, ref, features)` (a path, or `null` while `LEDGER_OBJECTS` is off) |
| `app/domain/permissions.ts` | `GRANULAR_PERMISSIONS` (the 12 names, the transaction type each narrows, the board's words: "Only freezing trust lines, within TrustSet"), `permissionChip(value)` |

Page data holds strings and unix seconds, never ages: the page writes times with `formatUtc` and puts `RelativeTime` (past) or `Countdown`
(future) beside them, so the stored page is the same at any age. Amounts are exact strings for `Amount`.

### 4.1 Common parts

- **Title row**: the type, the status pill (tone per status below), and "Created {time} · {age}" (index, creation known), "Created before
  ledger #N" (index, `created` absent: N is `coverage.from_ledger_index`), or "Last changed in ledger #N" (node: `PreviousTxnLgrSeq`, with
  `PreviousTxnID` linked; for an escrow or a check, which are never modified, that is the creation).
- **Removed banner** (`Notice`, an object whose `removed` is set): "Removed from the ledger in ledger #N by {tx_type} {hash}" and the
  type's sentence ("Finished on {time}; the 1,000 XRP went to the destination."), then "This page shows it from history: its last state
  before it was removed."
- **As-of note** under Details: index "As of ledger #N, {time}."; node "Read live from the network at ledger #N."; removed "From history:
  the escrow's last state, before ledger #N removed it."
- **Coverage note** under History: E8's `coverageNote(coverage, "events of this escrow")` drawn by `CoverageNote`, from the answer's
  per-object coverage (D5: complete when the feature's is or the creation is indexed), so it shows only when the creation is not in the
  index: "Covers ledger #N onwards: earlier events of this escrow are not in the index yet." A node object has no coverage of its own and
  gets E8's text for none: "The index does not hold this history yet."
- **States strip** (`StatesStrip`): the type's states in the board's order with their one-line meanings, the current one marked
  (`aria-current="true"`, "· this escrow"). A `removed` object (deleted by another transaction type) marks none and its pill says "Removed".
- **Timeline** (`Timeline`): the history events oldest first, each with its type tag, title, time, what it did, "by {account}" (and "sent
  by {delegate}" when delegated), its hash and ledger; then, after the newest event, the type's marks (a time that passed, an outlined dot)
  and what can still happen (dashed), placed by time, as on the boards. Footnote: "Oldest first. Filled dots are transactions; dashed ones
  are what can still happen." With more events than shown: Newer and Older links.
- **Owner reserve**: `server_state`'s `reserve_inc` in the native currency, with "Held from the owner's balance while the escrow exists;
  released when it is finished or cancelled." or, removed, "Released to the owner when the escrow was removed."

### 4.2 Escrow

| Status (D5) | Pill | Status line |
|---|---|---|
| `pending` | info "Pending" | "Can be finished by {anyone / anyone with the fulfillment} after {FinishAfter}" + "That is {in N}. Until then the {amount} stay locked. From {CancelAfter} it can no longer be finished, only cancelled." |
| `can_be_finished` | ok "Can be finished" | "Can be finished by … until {CancelAfter}" (or "with no end" without one) and the board's second line |
| `can_be_cancelled` | warn "Can be cancelled" | "Can be cancelled: CancelAfter has passed" … |
| `finished` | ok "Finished" | "Finished: {amount} delivered to the destination" … |
| `cancelled` | neutral "Cancelled" | "Cancelled: {amount} returned to the owner" … |
| `removed` | off "Removed" | "Removed from the ledger by {tx_type}" |

- Summary sentence: "{owner} locked {amount} for {destination} on {day}." (`Sentence` segments; "on {day}" left out when the creation is
  not known).
- **Window bar** (`WindowBar`, chart kit): Pending (creation to FinishAfter), Can be finished (FinishAfter to CancelAfter, or open-ended),
  Can be cancelled (from CancelAfter, open-ended); bounds Created, FinishAfter, CancelAfter; the mark "Now · {as-of time}", or "Finished ·"
  / "Cancelled ·" at the removal. A segment the escrow does not have is left out (no FinishAfter: no Pending; no CancelAfter: no Can be
  cancelled). Without a known creation the bar starts at the earlier of FinishAfter and the as-of time, with no Created bound. Each segment
  is a focusable button with its range in its label; the tooltip (range, length) is the kit's; the sr-only line repeats the mark.
- Details: Escrow ID (ledger object ID, copy), Owner (source), Destination, Amount (an MPT amount through `MptAmount`, section 5: its
  raw units and the issuance ID; E14 adds the scale, the ticker and the link), Can be finished after (`FinishAfter`), Can be cancelled after (`CancelAfter`), Condition
  (copy; "None: time-based only" without one), Fulfillment (a finished conditional escrow), Destination tag, Source tag, Transfer rate (a
  token escrow, as a percent), Owner reserve. Hints are the board's.
- Marks and what can happen, per status, as the board: `pending` → "EscrowFinish · Not finished yet · from {FinishAfter}" and
  "EscrowCancel · Not cancelled · from {CancelAfter}"; `can_be_finished` → "FinishAfter · Passed" and the two; `can_be_cancelled` →
  "FinishAfter · Passed", "CancelAfter · Passed", "EscrowCancel · Not cancelled yet"; `finished`, `cancelled` → the passed marks before the
  removing event.

### 4.3 Check

| Status | Pill |
|---|---|
| `open` | info "Open" |
| `expired` | warn "Expired" (and the banner "Expired, but still in the ledger": "An expired check is not removed on its own. It stays until someone sends a CheckCancel, which anyone can do now; until then it holds {reserve} of the source's reserve.") |
| `cashed` | ok "Cashed" |
| `cancelled` | neutral "Cancelled" |
| `removed` | off "Removed" |

Summary: "{source} wrote a check for up to {SendMax} to {destination} on {day}.", the status line, and the three-node flow (`CheckFlow`,
on `Flow`'s styles): Source ("Pays when the check is cashed" / "−{delivered}" / "Paid nothing"), the check ("Check · expires {day}" /
"cashed" / "cancelled" / "expired", "up to {SendMax}", "issued by {issuer}"), Destination ("· tag {n}", "Can cash up to …" / "+{delivered}"
/ "Received nothing" / "Can no longer cash it"). Details: Check ID, Source, Destination, Can be cashed for (`SendMax`, with its issuer and
the hint "Nothing is set aside…"), Delivered (cashed), Expires (`Expiration`), Invoice ID (copy), Destination tag, Source tag, Owner
reserve. Marks: `open` → "CheckCash · Not cashed yet · until {Expiration}" and "CheckCancel · Not cancelled · the source: any time ·
anyone: after {Expiration}"; `expired` → "Expiration · Passed", "CheckCancel · Not cancelled yet".

### 4.4 Payment channel

| Status | Pill |
|---|---|
| `open` | info "Open" |
| `closing` | warn "Closing" |
| `closed` | neutral "Closed" |
| `removed` | off "Removed" |

Summary: "{source} opened a payment channel to {destination} on {day}, with {amount} deposited in all.", the status line ("Open: {remaining}
of {amount} left to pay out", "Closing: claims can still be redeemed until {the earlier of Expiration and CancelAfter}", or, past it, "any
transaction on the channel now closes it", "Closed: {balance} paid out, {remaining} returned to the source"), the deposit bar (`ShareBar`,
one row: Paid out and Left, or Returned to the source once closed, with "{n}% of the deposit" under each) and the board's paragraph on
claims. Details: Channel ID, Source, Destination, Deposited (`Amount`; hint from `opened_with` and `funds`: "1,000 XRP when it was opened, 2
fundings added later"), Paid out (`Balance`; "in {claims} claims redeemed on the ledger"), Left / Returned to the source (`remaining`),
Settle delay (words and seconds), Public key (copy), Expires (`Expiration`, set), Closes by (`CancelAfter`, set), Destination tag, Owner
reserve. Events: Opened, Funded ("Added {amount_change}; {amount} deposited in all."), Claim redeemed ("Paid out {balance_change} more;
{balance} in all so far."), Close requested ("…set its expiration to {expiration}"), Renewed, Closed, Removed. Marks: `open` → "Not closed
· by {CancelAfter} at the latest" or "No end time set"; `closing` → "Not closed yet · from {expiration}".

### 4.5 Node-read objects

`fromNodeEntry` gives the same object shape without `created`, `removed`, `opened_with`, `funds` or `claims`; the status comes from
`object-status.ts` at the request time; the page has no history list (only the marks and what can happen), the node note and the coverage
note, and its title row says "Last changed in ledger #N".

## 5. Components

Reused: `Breadcrumbs` ("{Net} / Accounts / {owner} / Escrow"), `Card`, `DetailList`, `CopyButton`, `AccountLink` (E9), `Amount`, `Pill`,
`Notice`, `RelativeTime`, `Countdown`, `HashLink`, `LedgerLink`, `TypeTag`, `Sentence`, `ShareBar`, `SectionError`, E8's `CoverageNote`,
the Newer/Older links of the account tabs. New:

| Component | Where | What |
|---|---|---|
| `StatesStrip` | `app/ui/components/` | an ordered list of states and meanings, the current one marked; no script |
| `Timeline` | `app/ui/components/` | `TimelineItem` = `{ kind: "tx" \| "mark" \| "next"; type; title; at?: number; whenText?: string; what: Segment[]; by?: string; delegate?: string; hash?: string; ledger?: number }`; an `<ol>` with the dot styles of the board |
| `WindowBar` | `app/ui/charts/` | `WindowBarData` (`segments`: `id`, `label`, `slot`, `from`, `to` (unix seconds as text, `null` for open), `range`, `length`; `bounds`; `mark`; `token`), kit rules: the builder's numbers, the kit's geometry and tooltip, a table view not needed (the Details list has the times) |
| `CheckFlow` | `app/ui/components/` | three nodes and two arrows with `.flow` styles |
| `PermissionChip` | `app/ui/components/` | a permission's name, styled for a transaction type or a narrower right, its words as `title` and in an sr-only text |
| `MptAmount` | `app/ui/components/MptAmount.tsx` | the explorer's MPT amount, minimal here: props `{ id, units, href? }` (the issuance ID and the integer value of D5's MPT amount object, D5 §5.1), drawn raw as "{units, grouped} units of MPT {first 8 hex digits}…" in mono with the full ID in `title`, the ID a link when `href` is given. E10 gives no `href` (the MPT page is E14's); E14 extends the component (scaled `value`, `ticker`, `href` from its `mptLink`) and uses it on every page |
| `Pill` tone `warn` | existing | amber (`--amb`, `--amb-bg`, light and dark, contrast checked by `tokens.test.ts`) |

## 6. Delegation

### 6.1 The account page's Delegation tab (XRPL only)

- `ACCOUNT_TABS` gains `"delegation"` before `"analytics"`. On a network without delegation (`Network.hasDelegation`, beside `hasAmm`:
  XRPL and XRPL Testnet `true`, Xahau and Xahau Testnet `false`) the tab is not shown and `?tab=delegation` is a 302 to the account URL
  (`short`). On XRPL with `DELEGATION` off it is the disabled "soon" tab, as Analytics is, and the query a 302 without a call. A `marker`
  on it is a 302 to the URL without it (it has no pages).
- **Loader**: with the header as for every tab, the two calls `accountDelegations(a, { direction: "given", limit: 200 })` and `"held"`, in
  parallel, streamed with the 4.5 s deadline; a failure of either is "Couldn't load delegations" with Retry (served, not stored). The
  names call takes their accounts.
- **Content** (the board): the intro ("A delegation lets another account, the delegate, send some kinds of transaction on this account's
  behalf. Each permission is a transaction type or one narrower right, and a delegation grants up to 10.") with the chip legend; "Permissions
  given" (Delegate, Permissions with chips and "3 of 10", Granted in: the `updated.tx_hash` linked, Date (UTC)) and its note ("Each
  delegation given is a Delegate object {name} owns, so these {n} count toward its reserve. A new DelegateSet for the same delegate replaces
  its whole list."); "Permissions held" (On behalf of, Permissions, Granted in, Date). Empty: "No account may send transactions on {name}'s
  behalf." / "{name} may not send transactions on any other account's behalf." A list with a `marker`: "Showing the first 200". A
  `coverage` that is not complete: `CoverageNote` with `coverageNote(coverage, "delegations")` under each list (E8 §8).
- **Rows** (`delegationLists`): `permissions` through `permissionChip`; an `unknown` one shows its number ("Permission 70001").

### 6.2 The transaction page

- `describe()` gains, for a transaction with a `Delegate` field: `Description.delegate` (the address) and `Description.sentBy` =
  `{delegate} sent it on behalf of {account}.` (two account segments), which the page puts after the sentence in the same paragraph;
  `"Delegate"` joins `COMMON_FIELDS`, so no type lists it as a generic detail. `Summary` and `Description` gain `note?: Segment[]`, a line the
  page shows under the sentence.
- `TransactionPageData` gains `delegate: string | null`, `sentBy: Segment[] | null` and `note: Segment[] | null`. The page adds, after the
  "Account" row, **"Sent by"**: the delegate in full, and "The delegate signed this transaction and paid its fee, using a permission
  {account} gave it." with "View the delegation" (`/{net}/account/{account}?tab=delegation`) while `DELEGATION` is on. The Fee row reads
  "· paid by the delegate, burned". Xahau never has the field, so never the row.
- **`DelegateSet`** (`app/domain/describe/delegation.ts`, merged in `index.ts`): title "Delegation"; with permissions,
  "{account} let {authorize} send {Payment}, {TrustlineAuthorize} and {TrustlineFreeze} on its behalf" (a new segment
  `{ t: "permission"; name; kind; words }`, drawn as `PermissionChip`, joined by `listOf`), note "This replaces any permissions {account}
  had given {authorize} before; it does not add to them."; with an empty list, "{account} removed every permission it had given
  {authorize}". Failed: "tried to let …" / "tried to remove …" and the result's text. Details: Delegate, Permissions (chips and "n of 10"),
  then `closingDetails`.
- **Lists** (`rowSentence`, the home, ledger and account lists): a delegated transaction's row ends "· sent by {delegate}"; on the
  delegate's own account page "· sent by this account as its delegate". `changeOf` in `account-view.ts` tests the fee against the fee
  payer (`tx.Delegate ?? tx.Account`), not the sender.

## 7. Links into the pages

| From | Link | While |
|---|---|---|
| Objects tab: an `Escrow`, `Check`, `PayChannel` row | "Open escrow →", "Open check →", "Open payment channel →" to the object's page by its `index` | `LEDGER_OBJECTS` on (else no button) |
| Objects tab: a `Delegate` row (new fields: Delegate, On behalf of, Permissions "n of 10") | "View delegation →" to `?tab=delegation` of the delegator | `DELEGATION` on |
| Objects tab: an incoming object (destination = the account) | a "From" field with its account | always (`objectRows(objects, native, address)`) |
| Transaction page, ledger objects touched | the entry links its page (`objectHref`); a `Delegate` entry the delegator's Delegation tab | the switches |
| `EscrowCreate`, `CheckCreate`, `PaymentChannelCreate` | a detail "Escrow" / "Check" / "Channel" with the created node's ID | `LEDGER_OBJECTS` (else the ID as text) |
| `EscrowFinish`, `EscrowCancel` | "escrow 57978925" in the sentence: by the deleted node's `LedgerIndex`, else Xahau's `EscrowID`, else `/escrows/{owner}/{sequence}` (a failed one) | `LEDGER_OBJECTS` |
| `CheckCash`, `CheckCancel` | "a check" in the sentence and the "Check ID" detail, by `CheckID` | `LEDGER_OBJECTS` |
| `PaymentChannelFund`, `PaymentChannelClaim` | "channel 3F9A21…B7C4" and the "Channel" detail, by `Channel` | `LEDGER_OBJECTS` |

The sentence links use a new segment `{ t: "object"; kind: "escrow" | "check" | "payment-channel"; ref: { id } | { owner; sequence }; v }`:
`Sentence` renders it as a link through `objectHref` and `useFeatures()` (as it does pools), and as plain text while the switch is off.
Every `switch` over `Segment.t` (`Sentence`, `plainText` of `transaction-view.ts`, `rowSentence`, the image route's text) handles `object`
and `permission`; the compiler's exhaustiveness check finds them.

## 8. Search

E10 extends E8's search sequence (E8 §7) at its two points and changes nothing else in it: while `LEDGER_OBJECTS` is on, `findHash`
(`app/server/resolve.ts`) adds `ledgerObject(id)` to the index's questions (beside the transaction, the ledger and E8's NFT) and, when the
index has none of them, `ledgerEntry(id)` (tracked types only) to the node's (beside `tx`, `ledger` and E8's NFT readers). An object: 302 to
its page (a `Delegate`: its delegator's Delegation tab while `DELEGATION` is on, else the account page). Two or more found: E8's choice
page, with a row per object. The help text and the search hints (`search-hints.ts`) add the objects to E8's words for 64 hex digits:
"Transaction, ledger, NFT, escrow, check or payment channel" (each part only while its switch is on). Failures keep E8's rules (a failure
that leaves the question open is a 503).

## 9. Caching

| Page or call | Class |
|---|---|
| object in the ledger (index or node) | `live` |
| removed object | `slow` (history below the frontier can still be backfilled or reprocessed, so not `immutable`) |
| a page of older events (`?marker=`) | `MARKER_PAGE_CLASS` |
| owner/sequence redirect, upper-case redirect | `immutable` |
| not found, switch off, bad ID | `short` |
| Delegation tab | `live`, as the account's first pages |

## 10. Switches

`LEDGER_OBJECTS` (`ledgerObjects`) and `DELEGATION` (`delegation`), appended last to `FEATURE_VARS` and `FEATURE_NAME`, with `Env`, every
block of `wrangler.jsonc`, `TOP_LEVEL_SWITCHES`, the README tables, their guard cases and `*-off.spec.ts` files (README, "Adding a switch").

| Variable | Gates | Top level | `sandbox` | `production` |
|---|---|---|---|---|
| `LEDGER_OBJECTS` | the three routes and the redirect (404 `short` without a call while off), every link of section 7 but the Delegate ones, the object lookup in search | `"on"` | `"off"` | `"off"` |
| `DELEGATION` | the Delegation tab ("soon" while off), the links to it (Sent by row, objects touched, Objects tab, search) | `"on"` | `"off"` | `"off"` |

They go on in an environment when its data API serves D5 on both networks; `DELEGATION` also when the D5 re-ingest from 107,524,865 is done
there (the delegations answer `complete: true`), except in the sandbox, whose coverage is never complete (E7 §9, decision 15: there it goes
on with its coverage notes). The two are independent. The pre-deploy guard needs no new rule. **Not gated** (decision 5, a rule): the
"Sent by" row, the "sent it on behalf of" sentence, the `DelegateSet` sentences and the rows' "· sent by" tail describe the transaction
itself and show whatever `DELEGATION` says; only the links into the Delegation tab follow the switch.

## 11. SEO

`meta-escrow.ts`, `meta-check.ts`, `meta-payment-channel.ts`: title "Escrow 5B9C0E…D21F · XRPL", description "Escrow of 1,000 XRP from
{owner} to {destination} · pending · XRPL" (display names when E9's map has them, else short addresses; no ages), canonical
`/{net}/escrows/{ID}`, `og:*`, `twitter:card=summary`, no image (decision 9). A page of older events: `noindex, follow`, no canonical, no
`og:*`. The 404s: `noindex`. The Delegation tab: the account page's tags with `?tab=delegation` in the canonical URL (as other tabs).

## 12. Both networks and the sandbox

- XRPL and Xahau both have escrows, checks and payment channels (Xahau's in XAH, and issued-token escrows and channels with
  PaychanAndEscrowForTokens); the pages are the same. Token amounts show their issuer; an MPT escrow's amount is E10's `MptAmount`
  (its raw units and the issuance ID; E14 adds the scale, the ticker and the link).
- Delegation exists on XRPL only (`hasDelegation`); Xahau account pages have no tab and transactions no "Sent by" row (the board's note).
- The sandbox (E7) shows XRPL Testnet and Xahau Testnet with the same rules; `hasDelegation` is a fact E10 adds to E7's network facts
  table (`app/server/networks.ts`, one value per kind and network, section 6.1).

## 13. Fixtures

- **Recorded ledgers**: `test/fixtures/ledgers/xrpl-objects/` and `xahau-objects/`, the ledgers of D5's Task 1 recordings (D5 §11),
  copied with their manifest and listed in `test/fixtures/PROVENANCE.md`.
- **Derived** (`scripts/object-fixtures.ts`, with `scripts/object-derive.ts` implementing D5 §2.2 and §5: the rows, the objects, the
  events and the status at the newest recorded ledger's close time; called by `scripts/http-fixtures.ts`): `data-api/escrows/<ID>.json`,
  `data-api/checks/<ID>.json`, `data-api/payment_channels/<ID>.json` for every recorded object; `data-api/ledger_objects/<ID>.json`;
  `data-api/transactions/<HASH>.json` for every recorded object transaction, `DelegateSet` and delegated transaction;
  `node/ledger_entry/<ID>.json` for each object still open at the newest recorded ledger, and one open object with **no** index file (the
  node fallback); `node/ledger_entry/<ID>.json` answering `entryNotFound` for the not-found case (the default).
- **Synthetic** (seeded, `scripts/object-fixtures.ts`): the states the recordings cannot give, on IDs of their own: an escrow
  `can_be_cancelled` and one `cancelled`, a check `expired`, a channel `closing`, a channel with 120 events (three pages:
  `history@descending=true&limit=50&marker=<M>.json`), and an index answer with `complete: false` and no `created`.
- **By hand**: the active XRPL account's `node/account_objects` gains an escrow, a check, a channel and a `Delegate`; its
  `data-api/accounts/<A>/delegations@direction=given&limit=200.json` and `…held…` (three given, two held, as the board), and an account with
  none (both empty) and one with `complete: false`.

## 14. Tests

- **Unit**: each view builder per status of its board (escrow 5 + removed, check 4 + removed, channel 3 + removed), from the index and from
  the node; `object-status.ts`' truth table and its agreement with the derived answers; the window bar's segments with and without each
  time; the timeline's marks and next steps; `escrowKeylet` against every recorded `EscrowCreate`'s created node; describe: `DelegateSet`
  both forms and failed, a delegated `Payment` and a delegated `tec` (`sentBy`, no generic `Delegate` detail), the object segments of the
  nine types with each `ref` form, `rowSentence`'s tail on and off the delegate's page; `objectRows` (links, From, Delegate rows);
  `findHash` with objects; `permissionChip`; the meta builders; the shape checks (a bad account, amount, status or event is kind `server`);
  `MptAmount.test.tsx` (raw grouped units, the ID in `title`, with and without `href`).
- **Worker** (`test/worker/`): `ledger-objects.spec.ts` (every row of 1.2, classes, the marker trail, the redirect), `delegation.spec.ts`
  (the tab's calls, classes, Xahau's 302, failures), `data-api.spec.ts` (each new call's path, query order and class), `node-rpc` for
  `ledgerEntry`; `ledger-objects-off.spec.ts` and `delegation-off.spec.ts` (404s and 302s with no call, links absent, "soon").
- **End-to-end** (`test/e2e/`, Playwright and axe): `ledger-objects.spec.ts` (each page in each recorded or synthetic state, the removed
  banner, the node fallback, the not-found page and its other-network offer, the owner/sequence redirect, Older and Newer, the links from a
  transaction's sentence and objects touched and from the Objects tab, phone width with no horizontal scroll), `delegation.spec.ts` (the tab
  on XRPL with both lists, absent on Xahau, a delegated payment's Sent by row and sentence, a `DelegateSet` with permissions and an empty
  one), the new pages in `a11y.spec.ts`; specs skip themselves when `E2E_FEATURES_OFF` lists their switch.
- **Bundle**: `PAGES` gains `escrow`, `check` and `payment-channel` (routes `routes/net.escrows.$id`, `routes/net.checks.$id`,
  `routes/net.payment-channels.$id`), budget `lookup` (150 KB); the account page stays within its own; `describe/`, `parse/` and the keylet
  stay in the Worker (no `AffectedNodes`, `TransactionType` or `FinalFields` in `build/client`; `permissions.ts` holds names and words only).
  The route manifest grows by four routes, which every page's figure includes.

## 15. README sections to update

"Switches" (two rows, conditions, the cache-generation examples that spell the names), "The data API and the node" (the new calls and
`ledgerEntry`, the `app/server` table: `ledger-object-view.ts`, the three page views, `delegation-view.ts`, `object-shape.ts`,
`keylet.ts`), "The UI and the routes" (the routes and the manifest's route count), "The transaction page" (Sent by, objects touched,
`DelegateSet`), "The account page" (the Objects tab's links and From, the Delegation tab), a new "Ledger object pages" section (the table of
1.2, the views, caching), "Search", "SEO and link previews" (three `meta-*.ts`, no image), "Upstream fixtures" (the new rows), "End-to-end
tests" and "The client bundle check" (the three pages).

## Rollout

Built after E9, on D5's routes. Merged with both switches on at the top level and off in the sandbox and production; each goes on in an
environment by a commit and a deploy once section 10's condition holds there. Rolling back is `"off"` and a deploy.
