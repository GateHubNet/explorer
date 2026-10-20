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
the recordings cannot give are synthetic, and have a section of their own at the end. So have the markets pages' files: their markets tables and Xahau's EVR/XAH
are synthetic ("Synthetic aggregates"), and XRPL's pair files and the pools' `amm_info` answers are derived from the recorded trades ("Derived trades and pool states").
The validators and amendments pages' files are synthetic too ("Synthetic validators and amendments").

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
| `network/markets@limit=1000&period=<day\|7day\|30day>.json`, and on XRPL `network/markets@amm=<exclude\|only>&limit=1000&period=….json` | the markets table of each period (9 files on XRPL, 3 on Xahau), one set of the reference's markets job at T, made of every trade below: the seeded pairs, and on XRPL every pair of the derived trades ("Derived trades and pool states"), on Xahau EVR/XAH. The window is from the hour a period before T (`floorHour(T) − P`) to T; a trade counts when its native leg is above 0.0005; the pairs with 10 trades or more are listed (fewer than the `limit` of 1,000 qualify, so `totals.pairs` is `count`), by native volume, then by the pair, the pairs without one last by count, then by the pair; prices are the 8 significant digits of the stored rates (`toPrecision(8)`, `"0.50000000"`), `change` of the exact rates; the sparkline the 7 days that end with the day of T, a day without a trade carrying the close before it. About 40 rows (24 hours), 83 (7 days) and 159 (30 days) on XRPL, 11, 23 and 41 on Xahau | both networks; the filters on XRPL |
| `exchanges/EVR+rEvernodee8dJLaFsujS6q1EiXvZYmHXr8/XAH@...`, `active_accounts/EVR+rEvernodee8dJLaFsujS6q1EiXvZYmHXr8/XAH.json` | the pair page's data API calls of Xahau's EVR/XAH (as XRPL's pairs have them, without `amm`): 167 synthetic trades from the first week of the weekly candles to T, 20 to a page newest first; the candles of the five intervals; the 24-hour row; the accounts of the day before T | Xahau only |

**The markets tables and Xahau's pair.** `scripts/market-fixtures.ts` (`marketFixtures()`, called by `generate()`; the reference's rules are in `scripts/market-aggregates.ts`) draws them from two more streams of `scripts/synthetic.ts`:
`seedOf(net, "network/markets")` for each network's seeded pairs (every pair first: its two assets, each with a code from the generator's list and an issuer that
`ripple-address-codec` encodes from 20 seeded bytes (no drawn token takes the code of a recorded pair, XRPL's derived ones or Xahau's EVR/XAH, in any case), a value in native coins, a tier and a pool; then the trades of each pair day by day, from the day before the 30-day window
to T), and `seedOf("xahau", "exchanges/EVR+rEvernodee8dJLaFsujS6q1EiXvZYmHXr8/XAH")` for EVR/XAH's trades (at the ledgers of the Xahau chain, one every 4 s back from the newest
recorded one, among 24 seeded accounts, the taker never the provider; the third newest has an XAH leg of 0.0004, so it is listed and in the active accounts but in no aggregate). The tiers make about 40
pairs busy enough for the 24 hours, 42 more for 7 days, 75 more for 30 days and 30 that trade but are never listed (XRPL; 10, 12, 18 and 8 on Xahau). Some pairs are there on
purpose, on both networks: `usd` (a lower-case standard code), EUR/USD and USD/USD of two issuers beside the native pairs of their assets (the only seeded codes a recorded
pair has too, with issuers of their own), XAG/XAU (two assets without a native pair: no `native_volume`), MEMEX, a token worth about 3.2e-7 native coins (prices in exponent
form, as `precision8` writes them), and ZAR (stored with the native currency as base). The aggregates are made of the trades by the reference's rules (the commits above; the
rules are listed at the head of `scripts/market-aggregates.ts`), so the counts, sums, prices,
closes and native volumes agree with the trades they are of, and the filtered sets are the order book's and the swaps' parts of the same trades. The AMM fields follow D2's
absent-field contract (section 8 of the design, D2b.1): present because the set is known; `amm_share` is the AMM part of the pair's base volume over all the trades of the
window, the same in every filter's set; `amm_pool` whether the pair has a pool (a seeded pair has one by a draw, and some pools have no swap: a share of `"0.0000"` and `true`);
`totals.amm_share` is Σ native volume × share ÷ Σ native volume over the set's pairs with a native volume, of the exact shares, rounded once to 4 decimals (D2b.1 gives the
formula, not the rounding); on Xahau `"0.0000"` and `false`. `amm` is in a filtered answer only (`exclude`, `only`); the answer without a filter has none, which the client
reads as the default.

**Invented, and not checked against anything real:** every count and every amount; the prices (XRP at about 2.4 USD, XAH at about 0.04 USD, BTC at 96,000 USD, 0.92 EUR to the dollar, EVR
at 0.14 USD, RVN at 0.03 USD) and their daily drift; the volumes and the shares of the components; the pools and their accounts; the validators' keys, the collector's key and the
columns of a validation beyond the ones the page reads (`count`, `flags`, `full`, `signing_time`, the fee and reserve columns, `reporter_public_key`, `ephemeral_public_key`); the
weekday and trend of the activity; Xahau's snapshot (16 of 24 expected); the seeded pairs of the markets tables, their issuers, values, trades, pools and swaps; EVR/XAH's
trades, accounts, transaction hashes (no transaction of them is served) and price (about 2.4 XAH). The reference does not say what a `fee_stats` marker is, so the snapshot has none. A USD row's `exchange_rate`
is the USD one native coin buys, by the same reading as a component's `rate`; nothing reads it. Only an end-to-end run against a real stack (`E2E_DATA_API_URL`) checks these
files against real answers.

**What keeps them true.** `test/unit/network-fixtures.test.ts` reads the files and checks them against the rules above, runs the data API client's own checks
(`app/server/aggregate-shape.ts`) on every answer, works out the requests the page makes from the spec's table of calls and `windowOf`, and fails when a request finds no file or a
file is never asked for. `scripts/http-fixtures.test.ts` fails when a file is not what the generator writes. The synthetic files have a size budget of their own in
`test/unit/http-fixtures.test.ts`. The markets pages' files are checked in the same way by `test/unit/market-generated.test.ts` (the requests of spec 3.3 and the markets
calls worked out from `candleWindow` and `dayWindowStart`, the fixture server's answers, the client's checks, and every figure against the trades it is made of) and
`test/worker/market-fixtures.spec.ts` (the data API client's own requests in the Workers runtime); `isMarketGenerated` names them, and they have a budget of their own
(about 0.86 MiB, 81 files).

## Derived trades and pool states: the markets pages' XRPL files and `http/xrpl/node/amm_info/`

Not recorded and not made up: worked out from the trades and pool states of the recorded XRPL ledgers (the three sets above), as the data API and the node would serve them
for those ledgers. Three generators, all called by `generate()` (`pnpm fixtures:sync`):

- `scripts/derived-trades.ts` (`derivedExchanges`): the `/v2/exchanges` rows of the recorded transactions, an order-book trade for each Offer node a successful Payment or
  OfferCreate consumed and a swap for each pool it moved, by the rules of the data API's parsers (ported, never imported; the paths are in its head). `invertedExchange` gives
  a row of the pair asked the other way round, from the rate the trade stored (200 decimals, then 8 significant digits), which the 8 digits it serves do not give back.
- `scripts/market-fixtures.ts`, by the rules of `scripts/market-aggregates.ts`: for XRP/RLUSD and LIONS/XRP, each in both orientations, the pair page's data API calls of spec 3.3 for the default view, from those rows:
  the trades 20 to a page, newest first, with the pages their markers name (`descending=true&limit=20[&marker=…]`), the candles of the five intervals
  (`interval=<api>&limit=61&start=<S>`, S the first bucket of `candleWindow(T, interval)`), the 24-hour row (`reduce=true&start=2026-10-16T17:01:00Z`) and #9's
  `amm=only` row, the active accounts of the day before T (`active_accounts/<base>/<counter>.json`); for XRP/RLUSD in its natural orientation also the lists, candles and
  24-hour rows of `amm=exclude` and `amm=only`, and the one-row probe (`descending=true&limit=1`). Every recorded pair goes into XRPL's markets tables too.
- `scripts/amm-info-fixtures.ts` (`ammInfoFixtures`): the node's `amm_info` of the XRP/RLUSD pool `rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3`, asked by its account
  (`node/amm_info/rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3.json`) and by its pair (`node/amm_info/XRP_524C…+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De.json`): the state its newest
  recorded transaction left (AccountRoot balance, RLUSD line, AMM node), served at the newest recorded ledger, 107721455, in rippled's API v1 shape.

T is the close time of the newest recorded ledger, `last_validated` (XRPL 2026-10-17T17:01:12Z, Xahau 2026-10-17T17:47:11Z).

| | Repository, ref | Commit | For |
|---|---|---|---|
| `packages/shared/src/parsers/exchanges.parser.ts`, `amm.parser.ts`, `util/quality.ts`; `apps/api/src/exchanges/exchange-object.ts`, `apps/api/src/common/format.ts`; `docs/api-reference.md` | `data-api-new`, `feat/amm-data` | `c3e23026b3405fc2fd27fc897e724df4dfe106f1` | the trades: an order-book trade and a swap against a pool, the row and its key order, `amm_account` (the pool, the last key of a swap), the `amm` filter (`include`, `exclude`, `only`) of the lists, the candles and `reduce` |
| `apps/api/src/exchanges/exchange-aggregate.ts`, `exchange-intervals.ts`, `exchanges.service.ts`; `apps/api/src/active-accounts/*`; `packages/shared/src/query/decimal.ts`; `docs/api-reference.md` | `data-api-new`, `feat/explorer-data` | `7d495ab50cc7ad9b1434ab8e28b2ca5f7cbde13e` (the merge of D2) | the candles, the reduced row and the active accounts made of the trades, the markers of the pages; and the markets table (`markets-object.ts`, `packages/shared/src/aggregate/markets-live.job.ts`), with "Synthetic aggregates" |
| `docs/superpowers/specs/2026-10-19-account-market-aggregates-design.md`, sections 7, 8 and D2b.1 | `data-api-new`, `feat/explorer-data` | `7d495ab50cc7ad9b1434ab8e28b2ca5f7cbde13e` | the AMM fields of the markets table under D2's absent-field contract |

Read with `git -C ../data-api-new show <commit>:<path>`, never checked out.

The recorded cases behind the rows:

| Pair (stored) | Trades | Ledgers | What they are |
|---|---|---|---|
| RLUSD/XRP (`524C555344000000000000000000000000000000+rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De/XRP`; the explorer shows it XRP/RLUSD) | 37, from 2026-02-12 to T, 8 of them in the 24 hours before T | 17 of the three sets | 33 order-book trades; 4 swaps against the pool `rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3`, the `xrpl-amm` cases `swap_payment_xrp_iou` (`52E2AD5B…`, ledger 107694747), `offercreate_autobridged_pool_leg` (`F9F304F7…`, 107698980), `swap_offercreate_xrp_iou` (`5081561D…`, 107699656) and `payment_pool_and_book` (`8014250A…`, 107713744), the last two in the 24 hours before T |
| LIONS/XRP (`4C494F4E53000000000000000000000000000000+rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS/XRP`) | 3, no swap | 107506489, 107720115, 107720688 | the offers of the XRPL active account `rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh` (README, "Upstream fixtures") |

What follows from the recordings: XRP/RLUSD has 8 trades in the 24-hour window, so the 24-hour markets table does not list it (10 are needed) and the `amm=only` tables never do
(4 swaps); its 7-day and 30-day rows of all trades and of the order book's are made of its trades. Its active accounts include the pool, which bought and sold in the day.
LIONS/XRP has no swap, so its `amm=only` 24-hour row is the reference's row of zeros.

Where these differ from the data API: an amount is written with `toFixed()` (derived-trades.ts says why: the API's parsers write the exponent form of a tiny amount, which
the client reads either way); the sums of the aggregates are exact, and an amount the API's exact sums could not hold (more than 30 decimal places, from 1e36) stops the
generator rather than fall back to floats, as the API would (none does); a trade's stored rate is known to its 8 served digits, which is all an aggregate shows of it, and the
`change` of a market, which the reference computes from the exact rates, is worked out at both ends of what the 8 digits leave open: the generator stops if the two round
apart (they agree for every recorded pair). The AMM fields of the markets tables follow D2's absent-field contract as in "Synthetic aggregates".

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

## Synthetic validators and amendments: `http/<net>/data-api/network/validators…` and `…/amendments…`

Nothing in these files is recorded or copied. The validators and amendments pages (E6) read the six routes of D1, which the data API builds from weeks of collected
validations, vote records, validator lists and domain checks: no recording of a few ledgers can give them, so `scripts/validators-fixtures.ts` makes them up and
`pnpm fixtures:sync` writes them (`generate()` in `scripts/http-fixtures.ts` calls `validatorsFixtures(net, last, ledgerValidations)` for each network, after
`networkFixtures`, with the bodies of the ledger validations that call made, in memory). The figures are invented; the shapes, the key names and orders, the sort orders and
the rules that tie one figure to another follow the data API's reference:

| | Repository, ref | Commit | For |
|---|---|---|---|
| `docs/api-reference.md`, "Validators and amendments" | `data-api-new`, `feat/explorer-data` | `7d495ab50cc7ad9b1434ab8e28b2ca5f7cbde13e` | the six routes' answers: keys and their order ("Keys of …, in order"), formats, D1's rules (the list's order, the summary's counts, the quorum, `needed`, `passes`, `pct`, the amendments' statuses and order, G1–G5) |
| `apps/api/src/validators/*.ts`, `packages/shared/src/validators/consensus.ts`, `server-version.ts` | `data-api-new`, `feat/explorer-data` | `7d495ab50cc7ad9b1434ab8e28b2ca5f7cbde13e` | read for what the reference leaves to the builders: the windows of agreement, `sfServerVersion`, the votes of `unl_votes` and `other_votes` |

Read with `git -C ../data-api-new show <commit>:<path>`, never checked out. The client's types (`app/server/api-types.ts`) and checks (`app/server/validators-shape.ts`) follow
the same commit, and every file passes them.

**Generator and seeds.** `scripts/validators-fixtures.ts`, over `scripts/synthetic.ts`: one stream `mulberry32(seedOf(net, route))` for each network and each of
`network/validators` (the fleet: keys, domains, accounts, first sightings, manifests), `network/validators/summary` (the publishers' keys and fetch times),
`network/validators/{key}` (the hours of agreement), `network/validators/{key}/validations` (the rows of validations) and `network/amendments` (the unknown amendment's ID,
who votes for what, the rounds). Only integer arithmetic and the four IEEE operations are used on the numbers, BigNumber for `score` and `pct`, so every Node writes the
same bytes. The anchor is the newest recorded ledger (`last_validated`: XRPL 107721455 at 2026-10-17T17:01:12Z, Xahau 26596843 at 17:47:11Z); a ledger closes every 3.9 s
on XRPL and every 4 s on Xahau, E2's figures (`network-fixtures.ts`, 22,150 and 21,600 ledgers a day), so `next_flag_ledger.expected` and every date of a ledger follow
from its index.

| Files below `http/<net>/data-api/network/` | What |
|---|---|
| `validators/summary.json` | the summary, counted from the list: 35 trusted and 25 others seen on XRPL, 31 and 10 on Xahau; the publishers `unl.xrplf.org` and `vl.ripple.com` (XRPL), `vl.xahau.org` (Xahau), with seeded keys; the quorum by rippled's rule, `node` on XRPL only; one validator on the negative UNL, about to be re-enabled |
| `validators@limit=1000&scope=all.json` | every validator in D1's order, a row to a line. First the validators of the ledger validations of `networkFixtures` (35 on XRPL, 25 on Xahau, in the order they were first seen, so every key the network page shows has a page), then seeded ones (`encodeNodePublic` of `0xED` and 32 bytes; signing keys `0x02`/`0x03` and 32 bytes). Each case the pages draw: a verified domain, one with `[[ACCOUNTS]]` (G1), every reason of `unverified` (spec 4.2), `pending`, no domain; on two lists, on one, on none; never seen; on the negative UNL; no vote record, a higher and a lower fee vote; an old version that lacks an amendment, a release candidate, no version, an unrecognised `server_version`, Xahau's builds; a partial newest validation; one last seen 5 hours ago, one first seen 20 minutes ago (no score yet) |
| `validators/<KEY>.json` | each row's answer: the row, its votes on every amendment being decided (G4: the unknown one too), its manifest and its 30 days; and `<SIGNING_KEY>.json` of one validator, its master's answer (D answers a signing key) |
| `validators/<KEY>/validations@limit=20.json` | each validator's 20 newest validations (none for the member never seen), all `matches` (the newest recorded ledger by its own hash); one validator's page has a `marker`, and its second page `…@limit=20&marker=<M>.json` holds a row of a ledger the index has a gap at (`unknown`, its newest), a fork (`different`, with the indexed hash `matches`) and a partial validation |
| `amendments.json` | XRPL: `MPTokensV1` (majority), `DynamicNFT`, `XChainBridge`, `PermissionedDomains` (voting), an unknown ID, `DID`, `AMM` (enabled by an indexed EnableAmendment), `fix1201` (enabled, as the metadata says), `fixNFTokenNegOffer` (obsolete). Xahau: `Remit` (majority), `URIToken` (voting), `Import` (indexed), `Hooks` (metadata), `XahauGenesis` (retired), `introduced` in xahaud's date versions. IDs are SHA-512Half of the names |
| `amendments/<NAME>.json`, `amendments/<ID>.json` | each amendment's answer, by its name and, a byte copy, by its ID (the unknown one by its ID only), with the list's envelope (G3). XRPL's majority has 30 days of rounds (about 2,600) and a got/lost/got history, the last got 10 days before the anchor, so it activates in 4; the others not enabled have 3 days of rounds (the spec's "deployment that has run three days"); a tally holds from round to round and changes at a few points only (the runs of the got/lost/got story, half-way through a majority's 3 days, a third and two thirds of a vote's climb, where the trusted count moves, and the newest round: 4 changes in the majority's 30 days, 1 to 3 in 3 days), as a deployment records them and as the spec sizes the page (6.3, 7); Xahau's majority was got before the indexed history, so it has no `majority.ledger_index` or `tx_hash` (G5) and no history |

**Invented, and not checked against anything real:** every key but the given validators', every domain (`*.example`, RFC 2606: no operator is implied), the accounts of G1, the
publishers' keys, sequences and dates; the hours of agreement and their scores; the versions and their counts; the vote records and fee votes; the amendments' statuses,
votes, rounds, dates, ledgers, `introduced`, descriptions and `xls_url` paths (under `https://github.com/XRPLF/XRPL-Standards/`, as G2 wants), and the hashes of their
EnableAmendment transactions and of every ledger but the recorded ones (no transaction or ledger page serves them). Where the rules leave a choice open: the files sort their
keys as every generated fixture does (the generator builds every object in the reference's order, which the test checks); one hour of the 30 days has no final record, so
`agreement_30d` and that day are `incomplete` for every validator (D1's `incomplete` is the window's, not the validator's); the voting amendments have 3 days of rounds while
the majority has 30, as the spec asks, though D1 would give every amendment being decided the same rounds. Filling states (spec section 10) are overrides in the specs,
not files. Only an end-to-end run against a real stack (`E2E_DATA_API_URL`) checks these files against real answers.

**What keeps them true.** `test/unit/validators-fixtures.test.ts` works D1's rules out again from the answers (the validators' order and the summary's counts and versions, F7 for
every round and tally, `pct`, the amendments' order, the envelope of every amendment answer, the votes against the records, the server versions decoded), checks every object's
keys against the reference's order, runs the client's checks on every answer, and holds every case by the rules of `test/support/validators-case-rules.ts`, the ones
`test/support/validators-cases.ts` finds a validator or an amendment of a case by for the worker specs (over the files, never by a fixed key). `scripts/http-fixtures.test.ts` fails when a file is not what the generator writes.
`isValidatorsGenerated` names the files, and they have a budget of their own in `test/unit/http-fixtures.test.ts` (239 files, about 2.7 MiB).
