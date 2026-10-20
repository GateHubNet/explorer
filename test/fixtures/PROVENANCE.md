# Fixture provenance

Everything here was copied, byte for byte, from the `GateHubNet/data-api-new` repository (a sibling checkout,
`../data-api-new`), except `runtime/amm-deposit.meta.json`, which is one transaction's metadata cut out of a copied
ledger (it is identical to that transaction's `metaData`), and the two `-extra` sets, which were recorded for this
repository (the last section). Nothing is generated or edited by hand. The ledgers are mainnet recordings: each
`<index>.json.gz` is the full `result` of the rippled API v1 request
`{ command: 'ledger', ledger_index, transactions: true, expand: true }` (the ledger under `ledger`, its
transactions under `ledger.transactions`, each with its `hash` and its metadata as `metaData`). They are kept
compressed, as in the source. Only the ledgers and `manifest.json` were copied; the source directories also hold
`server_definitions.json` and `server_info.json`, which the explorer does not use.

`data-api-new` checkout at copy time: branch `feat/amm-data`, commit `5a65f007b89116ddaabaaab08771ce122c9da0a8`
(`git -C ../data-api-new rev-parse HEAD`), clean for these paths. The "Last changed in" column is the commit that
last touched the source directory, which is the one that put these exact files there.

| Here | Source path in `data-api-new` | Last changed in | Recorded from | Recorded at | Validated head |
|---|---|---|---|---|---|
| `ledgers/xrpl/` (9 ledgers + `manifest.json`) | `packages/shared/test/fixtures/xrpl/recorded/` | `75bea47e536ce4b0c4ce70d3bc70a40cb6f407d2` | `wss://s2.ripple.com` | 2026-10-15T11:53:06Z | 107671609 |
| `ledgers/xrpl-amm/` (16 ledgers + `manifest.json`) | `packages/shared/test/fixtures/xrpl/amm/` | `5418babdcebe24bc3545fd7cd1d1052342420d6b` | `wss://s2.ripple.com` | 2026-10-17T12:50:24Z | 107717584 |
| `ledgers/xahau/` (6 ledgers + `manifest.json`) | `packages/shared/test/fixtures/xahau/recorded/` | `75bea47e536ce4b0c4ce70d3bc70a40cb6f407d2` | `wss://xahau.network` | 2026-10-15T12:28:12Z | 26541064 |
| `runtime/amm-deposit.meta.json` | the metadata of AMMDeposit `83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B`, taken from `xrpl/recorded/107671558.json.gz` | as `ledgers/xrpl/` | as `ledgers/xrpl/` | as `ledgers/xrpl/` | as `ledgers/xrpl/` |

What each set holds (details in `data-api-new/packages/shared/test/fixtures/README.md`):

- `ledgers/xrpl/`: one ledger per XRPL transaction type the recording looked for (AMMCreate, AMMDeposit,
  AMMWithdraw, NFTokenMint, NFTokenAcceptOffer, AccountDelete, CheckCash, TicketCreate, EscrowFinish), found by
  scanning 3000 ledgers. The manifest's `found` maps each type to its ledger and transaction hash.
- `ledgers/xrpl-amm/`: 16 ledgers, each holding one named AMM case (swaps through a pool, deposits, withdrawals,
  vote, bid, create, LP-token transfer). The manifest's `cases` maps a case name to its ledger, hash, transaction
  type and a note that says which pool moved and how; `txs` maps each hash to `{ledger, type, result}`.
- `ledgers/xahau/`: one ledger per Xahau transaction type the recording looked for (ClaimReward, GenesisMint,
  Invoke, Remit, URITokenBuy, URITokenMint). `Import` and `SetHook` were not found in the window.

To add a transaction that is not here (the plan's later tasks may need one), record it in `data-api-new` with
`record-fixtures --txs <hash>`, copy the new ledger file and the merged manifest the same way, and add its row above.

## Recorded for this repository: `ledgers/xrpl-extra/` and `ledgers/xahau-extra/`

These hold the transaction types of spec section 7.3 that no set above contains and that the scan found. Six more
were missing and are in no set, because 3000 ledgers did not hold them: they are listed after the table below and
tested with hand-written transactions. SignerListSet was missing too and was deliberately not recorded (see the end of
this section). Which types were missing was worked out from the transactions themselves (every transaction of
`ledgers/xrpl/`, `ledgers/xrpl-amm/` and `ledgers/xahau/`, not the manifests' `found` maps, which list only some).
The recorded ones are mainnet ledgers in the same format as above, written by the same recorder, `data-api-new`'s
`packages/shared/scripts/record-fixtures.ts`, which only reads from public nodes. It ran from the worktree
`data-api-new/.worktrees/feat-rate-limit-keys` (branch `feat/rate-limit-keys`, clean, commit
`ff659c95c6ce9fbf12e6745c91984fedc5f3ca16`; the script was last changed in `75bea47e536ce4b0c4ce70d3bc70a40cb6f407d2`),
one run at a time, in its default sequential mode, walking back from the validated head for at most 3000 ledgers:

```
pnpm --dir <data-api-new>/.worktrees/feat-rate-limit-keys --filter @gatehub/data-api-shared exec \
  ts-node scripts/record-fixtures.ts --network <xrpl|xahau> --endpoint <endpoint> \
  --out "$PWD/test/fixtures/ledgers/<xrpl-extra|xahau-extra>" --want <types> --scan 3000
```

The recorder also writes `server_definitions.json` and `server_info.json`; they were deleted, as the other sets do
not hold them (the explorer does not use them). `manifest.json` is the recorder's, unedited: `found` maps a type to its
ledger and first successful transaction, and `missing` lists what the scan did not find.

| Here | Wanted | Recorded from | Recorded at | Validated head | Found (ledger: transaction) |
|---|---|---|---|---|---|
| `ledgers/xrpl-extra/` (4 ledgers + `manifest.json`) | EscrowCreate, EscrowCancel, PaymentChannelCreate, PaymentChannelFund, PaymentChannelClaim, CheckCancel, NFTokenBurn, AMMDelete | `wss://s2.ripple.com` | 2026-10-17T17:50:50Z | 107721797 | EscrowCreate 107720688: `E033B3615C85BF65972B7AE3569937D1135FB9E39F5F7D5F6CF7BEFF77F25FC4`; EscrowCancel 107720549: `9C4D48A7F44A7A58DEBE2F31525966684E74A51F407BD7A837A41326BB3C9743`; CheckCancel 107720115: `10CEF6273B6C4476E86169B7BB1723BF3CD2CFD948B1A732450543B2270AD87E`; NFTokenBurn 107721455: `401D8E59D6F14FD1AEC3D4A295C32D32A195AF36ECB91AAB4D3DE03D6B5C38CA` |
| `ledgers/xahau-extra/` (1 ledger + `manifest.json`) | SetHook, URITokenCancelSellOffer, Import | `wss://xahau.network` | 2026-10-17T19:05:53Z | 26596911 | SetHook 26596843: `01A4FDA81686D9AA9AD53C82CB36CE6377CB91374B3CA8AC858198D100E45275` |

Not found in 3000 ledgers, so not in any set, and tested with hand-written transactions in
`app/domain/describe/describe.test.ts` (written the way a node sends them, with the metadata the test needs):

- XRPL: PaymentChannelCreate, PaymentChannelFund, PaymentChannelClaim, AMMDelete.
- Xahau: URITokenCancelSellOffer, Import.

SignerListSet is missing from the copied ledgers too, and is in no set: it was not looked for in the recording (the
decision was to leave it hand-written), so its tests in `describe.test.ts` use hand-written transactions as well.

## Derived, not copied: `http/`

`http/<net>/` is not a copy of anything: it holds the data API's and the nodes' answers worked out from the ledgers above
(`pnpm fixtures:sync`, `scripts/http-fixtures.ts`), and, written by hand, the account files and `server_state` (the README's
"Upstream fixtures" says which is which, and `test/unit/http-fixtures.test.ts` checks the hand-written ones against the
recordings). Its transactions are the recorded ones; the creation data of its accounts and its `server_state` are invented. The files of the network page that
the recordings cannot give are synthetic, and have a section of their own at the end.

The account page asks the node for `account_objects` with `limit: 400` (the largest page), and a fixture is found by all the
parameters of a request but its subject, so each active account has the same file twice: `node/account_objects/<ACCOUNT>.json`
and `<ACCOUNT>@limit=400.json` (a byte copy; `test/unit/account-fixtures.test.ts` keeps them equal).

Before the account page says an address was never activated it asks the data API for one row of the address's history
(`/v2/accounts/<address>/transactions?limit=1`), so the never-funded address has a file for that request too:

| Here | What it is | Derived from | Kept equal by |
|---|---|---|---|
| `http/xrpl/data-api/accounts/rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC/transactions@limit=1.json` and the same path under `http/xahau/` | the one-row probe of the history of the never-funded address: an empty page, `{ count: 0, result: "success", transactions: [] }` (written by hand, like the account files; the address is in no recording) | a byte copy of `transactions@descending=true&limit=20.json` in the same directory, which is an empty page too | `test/unit/account-fixtures.test.ts` |

## Copied for the `?binary=true` fixtures: `definitions/xahau/`

| Here | Source path in `data-api-new` | `data-api-new` commit at copy time | Last changed in |
|---|---|---|---|
| `definitions/xahau/server_definitions.json` | `packages/shared/test/fixtures/xahau/recorded/server_definitions.json` | `3e5db7073e08425da46a8a0cedcf1c4db2799278` (`git -C ../data-api-new rev-parse HEAD`) | `75bea47e536ce4b0c4ce70d3bc70a40cb6f407d2` |

Copied byte for byte (`cmp` reports no difference). It is the `server_definitions` result of a Xahau node (`wss://xahau.network`,
recorded 2026-10-15 with the ledgers of `ledgers/xahau/`). `scripts/http-fixtures.ts` builds the codec's `XrplDefinitions` from it
to serialize the Xahau transactions into `http/xahau/data-api/transactions/<HASH>@binary=true.json`; XRPL uses the definitions
`ripple-binary-codec` ships. `ripple-binary-codec` (2.11.0) is a devDependency of the generator and its tests: the app and the
Worker never import it. `scripts/http-fixtures.test.ts` re-hashes every generated blob (SHA-512Half of `54584E00` and the
serialized transaction) to the transaction's hash, so a blob that is not the real serialization fails the test.

## Synthetic aggregates: the network page's `http/` files

Nothing in these files is recorded or copied. The network page (`/{net}/network`) asks the data API for aggregates over months (`stats`, the daily fees, the
payment, trade and AMM volumes), for the syncer's fee snapshot, and for the validations of its newest ledger. None of that can be worked out from a few recorded
ledgers, so `scripts/network-fixtures.ts` makes it up, and `pnpm fixtures:sync` writes it (`scripts/http-fixtures.ts` calls the generator for each network). The numbers
are invented; the shapes, the key names, the sort orders and the rules that tie one number to another follow the data API's reference. The text is that of the other
generated files (`fixtureText`, sorted keys) with one exception: each row of a list (a stats row, a day's fees, a fee snapshot, a volume row with its components, a
validation) is one line, as a transaction is in the recorded files.

**Generator and seeds.** `scripts/network-fixtures.ts`, over `scripts/synthetic.ts`: `mulberry32(seedOf(net, endpoint))`, where `seedOf` is the FNV-1a hash (`app/domain/fnv.ts`)
of its parts joined by a space. One stream for each network and each of these endpoints, drawn in the order of the dates, from the first day any window needs (`P₀` of `1y`, spec 1.5)
to the running day: `stats/type`, `stats/metric`, `network/fees`, `network/exchange_rate` (the daily USD price of the native coin,
shared by the three volumes), `network/payment_volume`, `network/exchange_volume`, `network/amm_volume` (its pools' accounts first) and `ledgers/validations`. The numbers use
no function an engine may round differently (no `Math.sin`, `Math.exp` or fractional power), so every Node writes the same bytes; `scripts/http-fixtures.test.ts` fails when the files and the generator part ways.

**What they follow.**

| | Repository, ref | Commit | For |
|---|---|---|---|
| `docs/api-reference.md` | `data-api-new`, `main` | `ff659c95c6ce9fbf12e6745c91984fedc5f3ca16` | the shapes of Network (`fees`, `fee_stats`, `exchange_volume`, `payment_volume`), Validations and Stats |
| `docs/api-reference.md` | `data-api-new`, `feat/amm-data` | `c3e23026b3405fc2fd27fc897e724df4dfe106f1` | `amm_volume` |
| `packages/shared/config/markets/xrpl.json` (version 1), `.../xahau.json` (version 3) | `data-api-new`, `main` | `ff659c95c6ce9fbf12e6745c91984fedc5f3ca16` | the trade markets and payment currencies that are the volume components; copied into the generator (`MARKETS`) |

Read with `git -C ../data-api-new show <commit>:<path>`, never checked out. `feat/amm-data` is not merged: `amm_volume` is in `PENDING_PATHS` (`app/server/pending-paths.ts`) and
the fixtures hold it because the top level of `wrangler.jsonc` and the tests have `AMM_DATA` on (the `worker-off` project never asks for it).

**The markets pages' aggregates** (`network/markets`, and the pair routes of the markets pages). The data API client's types (`app/server/api-types.ts`: `MarketsResponse`,
`MarketRow`, `PairExchange`, `Candle`, `ReducedRow`, `ActiveAccounts`) and the checks it runs inside its cached loads (`app/server/aggregate-shape.ts`: `checkMarkets`,
`checkPairExchanges`, `checkCandles`, `checkReduce`, `checkActiveAccounts`) follow these, and so do the synthetic `network/markets@…` files and the derived pair files the markets
fixtures make; read with the same `git -C ../data-api-new show <commit>:<path>`.

| | Repository, ref | Commit | For |
|---|---|---|---|
| `docs/api-reference.md` | `data-api-new`, `feat/explorer-data` | `7d495ab50cc7ad9b1434ab8e28b2ca5f7cbde13e` (the merge of D2) | **the markets shape**: the section `GET /v2/network/markets` (keys, formats, `period`, `limit`, the display currency's `exchange`, `exchange_rate` and `converted_volume`, the empty answer of a database with no set yet). Its `change` is optional, as the reference has it (the design's key list has it required) |
| `docs/superpowers/specs/2026-10-19-account-market-aggregates-design.md` | `data-api-new`, `feat/explorer-data` | `7d495ab50cc7ad9b1434ab8e28b2ca5f7cbde13e` | the **places of the AMM keys** (section 7: `amm` after `period`, `totals.amm_share` after `converted_volume`, `amm_share` and `amm_pool` before `sparkline`) and their **formats** (section D2b.1: a share is a string with exactly 4 decimals, `amm_pool` a boolean, both present only when known, `"0.0000"` and `false` on Xahau). The reference at that commit serves no AMM field |
| `docs/api-reference.md` | `data-api-new`, `feat/amm-data` | `c3e23026b3405fc2fd27fc897e724df4dfe106f1` | the `amm` filter (`include`, `exclude`, `only`) of the exchange lists and `amm_account` on a swap, which is the last key of a trade |
| `docs/api-reference.md` | `data-api-new`, `main` | `ff659c95c6ce9fbf12e6745c91984fedc5f3ca16` | the pair routes `GET /v2/exchanges/{base}/{counter}` (trades, `interval` candles, `reduce`) and `GET /v2/active_accounts/{base}/{counter}`; their sections are the same at `7d495ab` |

The API writes a price, a rate or a vwap with `toPrecision(8)` of BigNumber (`apps/api/src/common/format.ts`, `precision8`), and a sum with its `toString()`, so a figure below 1e-6 or
from 1e8 is in exponent form (`"1.2000000e-7"`): the checks take those (`isNumberText`), and the fixtures may hold one. Nothing in the aggregates is recorded.

| Files below `http/<net>/data-api/` | What | Here |
|---|---|---|
| `ledgers/<HASH>/validations@limit=1000.json` | two files, the two newest recorded ledgers (the end-to-end suite moves the chain back by one): 35 validations on XRPL, 25 on Xahau. A validator's key is `encodeNodePublic` of `0xED` and 32 seeded bytes; the same validators sign both ledgers; `first_datetime` is the close time plus 0 to 400 ms | both networks |
| `network/fee_stats@descending=true&limit=1&start=2026-10-17.json` | one snapshot 2 s before the close of the newest ledger. XRPL: open ledger fee and minimum fee 0.00001 (10 drops), queue 0, 84 in the open ledger, 96 expected, as the board shows them | both networks |
| `stats/type@...`, `stats/metric@...`, `network/fees@end=...&interval=day...` | for `7d`, `30d`, `90d` and `1y` (days, weeks from Monday for `1y`; `fees` always days); zero counts left out; `transaction_count` is the sum of the type columns and is the `tx_count` of `fees`; about 22,150 ledgers a day on XRPL and 21,600 on Xahau; the running day is pro rata to the close time of the newest ledger (17:01:12 and 17:47:11) | both networks |
| `network/payment_volume@...`, `network/exchange_volume@...` | the native currency and the markets config's payment currencies; its trade markets. Sorted by converted amount, `rate = amount / converted_amount` to 8 significant digits; day files end on 2026-10-16 (a day counts an hour after it ended), a week adds up its days and the running week has the days so far; USD rows (XRPL) are the native rows at a seeded daily rate, with the same amounts | both networks; USD on XRPL |
| `network/amm_volume@...` | 3 seeded pools with seeded accounts, two against XRP and one between two issued currencies | XRPL only |

**Invented, and not checked against anything real:** every count and every amount; the prices (XRP at about 2.4 USD, XAH at about 0.04 USD, BTC at 96,000 USD, 0.92 EUR to the dollar, EVR
at 0.14 USD, RVN at 0.03 USD) and their daily drift; the volumes and the shares of the components; the pools and their accounts; the validators' keys, the collector's key and the
columns of a validation beyond the ones the page reads (`count`, `flags`, `full`, `signing_time`, the fee and reserve columns, `reporter_public_key`, `ephemeral_public_key`); the
weekday and trend of the activity; Xahau's snapshot (16 of 24 expected). The reference does not say what a `fee_stats` marker is, so the snapshot has none. A USD row's `exchange_rate`
is the USD one native coin buys, by the same reading as a component's `rate`; nothing reads it. Only an end-to-end run against a real stack (`E2E_DATA_API_URL`) checks these
files against real answers.

**What keeps them true.** `test/unit/network-fixtures.test.ts` reads the files and checks them against the rules above, runs the data API client's own checks
(`app/server/aggregate-shape.ts`) on every answer, works out the requests the page makes from the spec's table of calls and `windowOf`, and fails when a request finds no file or a
file is never asked for. `scripts/http-fixtures.test.ts` fails when a file is not what the generator writes. The synthetic files have a size budget of their own in
`test/unit/http-fixtures.test.ts`.

## Recorded node answers: `http/<net>/node/book_offers/`

These six files are recorded, not derived and not made up: the markets pages read the order book of a pair from the node (`book_offers`), a book is the
state of one ledger, and nothing in the recorded ledgers above gives it. `scripts/record-node-fixtures.ts` asked the public nodes for the six books below and
wrote each whole JSON-RPC answer with `fixtureText` (keys sorted, an offer to a line; nothing added, left out or edited, so what the node says beside `result`
is in the file). The command only reads (`book_offers` is a read-only method) and writes nothing but these six files:

```
pnpm exec tsx scripts/record-node-fixtures.ts
```

It is the "recorder" kind of the README's "Upstream fixtures", and `pnpm fixtures:sync` leaves the files alone (`isHandWritten` in `scripts/http-fixtures.ts`). The
request is the one the app makes (`app/server/node-rpc.ts`): `{ taker_gets, taker_pays, ledger_index: "validated", limit: 60 }`, 60 being `BOOK_OFFERS_LIMIT`, so a
book of more than 60 offers is cut at the 60 best (best price first, the node's order). The worker specs and the end-to-end stack read the files through the
upstream mock, which finds one by `nodeFile` (`test/support/upstream-core.ts`).

| Network | Node | Recorded | What it says |
|---|---|---|---|
| XRPL | `https://s1.ripple.com:51234/` | 2026-10-20, 08:36:57 to 08:37:00 UTC | a Clio server: no `validated` in `result` (it serves validated ledgers only), and a top-level `warnings` entry (id 2001, "This is a clio server...") |
| Xahau | `https://xahau.network/` | 2026-10-20, 08:37:00 UTC | `validated: true` in `result` |

The native asset is written `XRP` on XRPL and `XAH` on Xahau (`XRP` is refused on Xahau); RLUSD and LIONS are asked for as the ledger holds them, 40 hex digits.
The four XRPL books were read at one ledger (the same index and ledger hash), so the pair page's two orientations agree; the two Xahau books likewise. The recorder
refuses to write books of one network that are of different ledgers (a ledger closes every few seconds): it asks that network once more, and a second miss writes nothing.

| File below `http/` | Method | `taker_gets` | `taker_pays` | `limit` | `ledger_index` | `result.ledger_index` | Offers | Answered (UTC) |
|---|---|---|---|---|---|---|---|---|
| `xrpl/node/book_offers/XRP_524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De@limit=60.json` | `book_offers` | `XRP` | `524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De` | `60` | `validated` | `107780245` | 60 | 08:36:58.685 |
| `xrpl/node/book_offers/524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De_XRP@limit=60.json` | `book_offers` | `524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De` | `XRP` | `60` | `validated` | `107780245` | 60 | 08:36:59.522 |
| `xrpl/node/book_offers/4C494F4E53000000000000000000000000000000+rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS_XRP@limit=60.json` | `book_offers` | `4C494F4E53000000000000000000000000000000+rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS` | `XRP` | `60` | `validated` | `107780245` | 3 | 08:36:59.894 |
| `xrpl/node/book_offers/XRP_4C494F4E53000000000000000000000000000000+rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS@limit=60.json` | `book_offers` | `XRP` | `4C494F4E53000000000000000000000000000000+rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS` | `60` | `validated` | `107780245` | 37 | 08:37:00.092 |
| `xahau/node/book_offers/EVR+rEvernodee8dJLaFsujS6q1EiXvZYmHXr8_XAH@limit=60.json` | `book_offers` | `EVR+rEvernodee8dJLaFsujS6q1EiXvZYmHXr8` | `XAH` | `60` | `validated` | `26660112` | 60 | 08:37:00.437 |
| `xahau/node/book_offers/XAH_EVR+rEvernodee8dJLaFsujS6q1EiXvZYmHXr8@limit=60.json` | `book_offers` | `XAH` | `EVR+rEvernodee8dJLaFsujS6q1EiXvZYmHXr8` | `60` | `validated` | `26660112` | 60 | 08:37:00.591 |

The ledgers these books were read at are not among the recorded ledgers of `ledgers/` (those were recorded on 2026-10-15 and 2026-10-17), and nothing relates
the two: a page that shows a book beside a recorded ledger shows two moments. The offers are real (real accounts, real prices); the books are thin on one side
(XRP for LIONS has 37 offers, LIONS for XRP only 3). Run the command again only to refresh the recording on purpose: the books move, so the files and this table
change together, in one commit.

**What keeps them true.** `test/unit/market-fixtures.test.ts` reads this table: it fails when a row's file, request (method and parameters) or `result.ledger_index`
is not what the file holds, when `validated` is anything but true or absent, when an offer is not of the assets asked for, when the books of a network are not of
one ledger, when a file is not in `fixtureText`'s layout, and when a file is in `node/book_offers/` and has no row. The six books and the rules the recorder keeps
(`acceptAnswer`, `checkOneLedger`) are in `test/support/book-fixtures.ts`, which the recorder and the test share and the test tries without a network; this table is the
independent pin of the pairs. `scripts/http-fixtures.test.ts` fails when the generator would write or report one of them.
