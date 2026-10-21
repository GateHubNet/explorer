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
So are the accounts' answers for the Analytics tab (`data-api/accounts/<address>/stats/` and `.../analytics/`): synthetic, anchored to the hand-written account files ("Synthetic
aggregates").
The validators and amendments pages' files are synthetic too ("Synthetic validators and amendments"). The AMM pages' files (`data-api/amm/`) and the featured pools'
`amm_info` answers are derived from the recorded pools ("AMM answers"), but for the pool page's day rows, the pairs' AMM-only candles and the live AMM volume, which are
synthetic (the same section, "The synthetic part").

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

**The Analytics tab's answers** (`http/<net>/data-api/accounts/<address>/stats/` and `.../analytics/`). The account page's Analytics tab (E4) asks for an account's months of
aggregates valued at rates: calls 1 to 6 of the E4 spec, section 2.3 (`stats/value`, `stats/transactions`, `analytics/balance_changes`, `analytics/counterparties`,
`analytics/balances`, `analytics/exchanges`), which the recorded ledgers cannot give. `scripts/analytics-fixtures.ts` (`analyticsFixtures(net, T)`, called by `generate()`) makes
them up for the active, the deleted and the never-funded account of each network (README.md, "Upstream fixtures"), for the windows of the four periods at T (`analyticsWindow`;
T is the UTC day of the recorded `last_validated`, 2026-10-17 on both networks): 6 calls × 4 periods × 3 accounts, 72 files a network, 144 in all, each named by its request
(`stats/value@interval=day&limit=1000&start=2026-09-18.json` … `analytics/exchanges@limit=6&start=2025-07-01.json`; All from the month of the account's `inception`, T's month
for the never-funded address). The never-funded address has the empty answers D2 gives an address it does not know.

| | Repository, ref | Commit | For |
|---|---|---|---|
| `docs/api-reference.md`: `GET /v2/accounts/{address}/stats/{family}` with "`interval` on `stats/{family}`", and "Account analytics" | `data-api-new`, `feat/explorer-data` | `7d495ab50cc7ad9b1434ab8e28b2ca5f7cbde13e` (the merge of D2; `ANALYTICS_REFERENCE_COMMIT` in the generator) | the shapes, keys, formats, windows, row rules and sort orders |
| `apps/api/src/accounts/account-analytics-object.ts`, `packages/shared/src/query/valuation.ts`, `packages/shared/src/query/decimal.ts` | the same | the same | what the reference leaves open: the groups a value is worked out per (17 significant digits of the quotient, half up; sums exact), the ranking of the lines, the native volume of a pair without a native side |

Read with `git -C ../data-api-new show <commit>:<path>`, never checked out. The client's types and checks (`app/server/api-types.ts`, `app/server/analytics-shape.ts`) follow
the same commit.

*Generator and seeds.* One stream for each network, account and endpoint, `mulberry32(seedOf(net, account, endpoint))` (`scripts/synthetic.ts`): `stats/value` draws the
tokens' daily rates; `stats/transactions` the transactions sent that move nothing but their fee, and which payments and offers fail; `analytics/balances` the first day of
each token line the account holds; `analytics/counterparties` the accounts it pays and is paid by (20 seeded bytes each, `encodeAccountID`) and the payments;
`analytics/exchanges` (Xahau's USD issuer first, the same way) the trades; `analytics/balance_changes` the fees, escrows, rippled payments, rewards and what the deleted account
held when it was deleted. Only integer arithmetic and the four operations of IEEE doubles go into the draws.

*What they follow.* One history per account, made day by day from its `inception` to T and then cut to each window and bucketed by its interval with `bignumber.js`: a
30-day file's days are the 90-day file's, a week or a month adds up its days, and a level (a balance, the account's value) is its last day's. Every balance change is a leg of
something in that history: a payment (`payment_source`, `payment_destination`), a trade (`exchange`, both sides), an escrow, a payment rippled through a trust line
(`intermediary`, in and out), a reward or the deletion (no change type), or the fee of a transaction the account sent (`transaction_cost`, so a bucket's count is its
`transaction_count`; a failed transaction pays its fee and moves nothing else). The lines' balances are the sums of their changes, and the counterparties and pairs are the
payments and trades of the same history. The answers follow the reference's rules: `stats/value` has a row for every bucket from the account's first; `stats/transactions` only
for the buckets with a transaction sent, its result counts adding up to its type counts; the totals of `balance_changes` are the sums of its rows, in D2's order of the types,
with `net_value` = `in_value − out_value`; the lines are ranked native first, then by value at T; counterparties by `total_value`, then the account; pairs, in their stored
order (`canonicalPair`), by `native_volume`; the window is widened to whole buckets with an exclusive `end` (the day after T for counterparties and exchanges). Values follow
D2's valuation: the native coin is worth itself, a token amount its amount over the day's rate (units per native coin), cut to 17 significant digits for each group (a day, a
change type and an asset; a counterparty, a side, an asset and a day; a pair's day), and the sums are exact. Every amount and value is a plain decimal, as `toString` writes it
(the generator stops at one the API would write in exponent form), and a row is one line (`ANALYTICS_ROW_LISTS`).

*Anchored to the account fixtures*, which the generator reads and never writes: the active account's native line ends at its `node/account_info` balance (XRPL 10.001625, Xahau
9,351.039221) and each token line at its `balances.json` value (XRPL's LIONS 48,329.908117603, Xahau's EVR 28,437,367.3675102); the deleted account's native balance is 0 from
the day of its deletion on (the newest row of its hand-written history, 2026-10-15 on both networks: XRPL's recorded AccountDelete, Xahau's newest recorded transaction), when an
AccountDelete pays `server_state`'s `reserve_inc` as its fee and sends the rest away (no change type), and it does nothing after it; an account's first day is the day of its
creation's `inception`, when the creation's `parent` pays it the creation's `initial_balance` at the `inception`'s second, as the header shows it (XRPL 25 and 10 XRP,
Xahau 25 and 15 XAH); the native balance stays at or above `server_state`'s reserve (`reserve_base`, and `reserve_inc` for each trust line) until a deletion. The history is
made backwards, from the anchors to the first day, and a change the balances could not have had did not happen: a payment or an offer the account sent then failed for want of
funds (`tecUNFUNDED_PAYMENT`, `tecUNFUNDED_OFFER`), and anything else is dropped. What the history leaves on the first day differs from the initial balance, and one payment a
minute after the activation settles it: from one of the account's counterparties when the history needs more (XRPL's deleted account, Xahau's active one), to one when it
needs less (XRPL's active account, Xahau's deleted one). So the parent's row of All's counterparties is the initial balance, one payment at the inception; Xahau's active
account's parent is also EVR's issuer, and its row holds the EVR too. A token line opens with the account's TrustSet and a payment from the token's issuer of what the history
leaves at its first day.

*On purpose:* the XRPL active account trades USD of `rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq` against XRP in its last 45 days (stored USD/XRP, shown XRP/USD by E3's natural
orientation), LIONS against XRP, and LIONS against that USD in the same 45 days (LIONS/USD, a pair without a native side, whose `native_volume` is LIONS' volume at its rate
of each day); Xahau's trades USD of a seeded issuer against XAH in its last 40 days (stored USD/XAH, shown XAH/USD) and EVR against XAH, and nothing against USD but XAH;
neither holds USD at T, so a line of 0 is served. The XRPL active account has a failed transaction in the 30 days. Xahau's active account is paid small sums by some thirty accounts,
as its recorded history shows, and both Xahau accounts claim rewards (`ClaimReward`, XAH with no change type). The deleted accounts hold no token and never trade.

*Invented, and not checked against anything real:* every count, amount, time, rate (LIONS at about 6,318 a XRP, the price of its recorded trades; GateHub's USD at 2.4 a XRP,
Xahau's USD at 0.04 a XAH and EVR at 0.285714 a XAH, the prices of the network page's fixtures), counterparty and issuer of the histories. The histories do not hold the recorded
transactions of the accounts' hand-written lists, which are a handful of days, so the Transactions and the Analytics tabs do not show the same days. Only an end-to-end run
against a real stack checks them against real answers.

*What keeps them true.* `test/unit/analytics-fixtures.test.ts` works the requests out from the E4 spec's table of calls and `analyticsWindow`, fails for a file that is asked for
and not written or written and not asked for, runs the client's checks (`app/server/analytics-shape.ts`) on every answer, and checks the rules and the anchors above against the
files, and the four periods against each other; `scripts/http-fixtures.test.ts` fails when a file is not what the generator writes. `isAnalyticsGenerated`
(`scripts/http-fixtures.ts`) names them, and they count against the synthetic files' budget in `test/unit/http-fixtures.test.ts` (144 files, 327,126 bytes, about 0.31 MiB;
with the network page's 2.3 MiB, below its 2.7 MiB). `analyticsOpenings` gives the test each funded account's opening payment alone.

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
  recorded transaction left (AccountRoot balance, RLUSD line, AMM node), served at the newest recorded ledger, 107721455, in rippled's API v1 shape. E5 adds three more
  pools to its list, `AMM_INFO_POOLS` ("AMM answers").

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

## AMM answers: `http/xrpl/data-api/amm/` and the featured pools' `http/xrpl/node/amm_info/`, with their synthetic day rows, candles and live volume

The data API's answers of the AMM pool routes (E5) for the recorded XRPL ledgers. Not recorded (the data API's `main` has no AMM routes, and its AMM branch's e2e seeds are
16 ledgers months apart) and, but for the synthetic part below, not made up: worked out from the pools the recorded ledgers of the three XRPL sets (`ledgers/xrpl-amm/`,
`ledgers/xrpl/`, `ledgers/xrpl-extra/`) hold, as the data API would serve them for those ledgers. Generated by `generate()` (`pnpm fixtures:sync`), from:

- `scripts/amm-derive.ts` (`deriveAmm`): every pool the transactions touched, with its states (the reference's PoolState, every value carried forward), its liquidity events
  and its votes and bids, by the rules of the data API's AMM oracle (ported, never imported: an AccountRoot with `AMMID`, an AMM node, or a reserve line by its `lsfAMMNode`
  rule names a pool), and each pool folded from its states: the newest value of each field, `deleted` and `last_ledger` of its newest state, `created_ledger` and `created_by`
  of a create event in the recordings, `value_native` 2 × the native reserve (`valueText`: 8 significant digits, a plain decimal), none for a deleted pool. Over the 16
  `xrpl-amm` ledgers alone it finds what the reference's e2e suites say they hold: 102 pools, one deleted, 148 states, 8 liquidity events, a vote and a bid (and
  `derivedExchanges` 138 swaps). Over the three sets: 136 pools (135 live, 50 of them with a value), 193 states, 11 liquidity events, a vote, a bid and 180 swaps.
- `scripts/amm-fixtures.ts` (`ammFixtures`): the files below; the swaps are E3's swap rows (`derivedExchanges`, scripts/derived-trades.ts, "Derived trades and pool
  states": the exchanges with `amm_account`, the pool's own changes), filtered to the pool. Its synthetic part ("The synthetic series", "The live volume") writes the
  day rows, candles and live volume of "The synthetic part" below.
- `scripts/amm-info-fixtures.ts` (E3's derivation, "Derived trades and pool states"): `amm_info` of the featured live pools whose nodes the recordings hold, E5's entries of
  `AMM_INFO_POOLS`, each asset as its recorded AMM node has it, in the natural orientation.

| | Repository, ref | Commit | For |
|---|---|---|---|
| `docs/api-reference.md` ("AMM"); `apps/api/src/amm/amm-objects.ts` | `data-api-new`, `feat/amm-data` | `c3e23026b3405fc2fd27fc897e724df4dfe106f1` | the objects and their key orders, the list's order, the 404 rule, `value_native` (`valueText`) |
| `apps/api/src/amm/amm-paging.ts`; `apps/api/src/amm/amm-pools.service.ts` | same | same | `carryForward`; the list's marker (`encodePoolsMarker` of the stored `value_native`, a Float64, and the account) |
| `packages/shared/test/amm-oracle.ts` (ported); `packages/shared/src/aggregate/amm-pools.job.ts` | same | same | the states, liquidity events and votes and bids of a transaction; the pool from its states, `created_*`, `value_native` |
| `apps/api/test/amm-pools.e2e-spec.ts`, `amm-events.e2e-spec.ts` | same | same | what the 16 `xrpl-amm` ledgers hold (the counts above), the derivation's check |

Read with `git -C ../data-api-new show <commit>:<path>`, never checked out.

| Files below `http/xrpl/` | What |
|---|---|
| `data-api/amm/pools/<POOL>.json` | `{ result, pool }` for each of the 136 pools, the deleted SNK/XRP pool too (`deleted: true`, no `value_native`) |
| `data-api/amm/pools@limit=20.json`, `…@limit=20&marker=<M>.json` | the 135 live pools in 7 pages, by `value_native` descending (the stored Float64), the 85 without a value last, then by account; a page's marker is the base64url JSON `[value, account]` of its last pool (`null` for a pool without a value) |
| `data-api/amm/pools@include_deleted=true&limit=20.json`, `…@include_deleted=true&limit=20&marker=<M>.json` | all 136 pools, the deleted SNK/XRP among them, in 7 pages in the same order and with the same markers (the API's `include_deleted` drops its `deleted = 0` and nothing else): SNK/XRP has no value, so it is among the pools without one, by account, on the fourth page |
| `data-api/amm/pools@asset=XRP&limit=20.json`, `…@asset=524C…+rMx…&limit=20.json`, `…@asset=SNK+rDDYXY17rzuF44gVAAQ9MB6GRQFkvWSccm&include_deleted=true&limit=20.json` | the first page of each filter: the live pools with the native currency (20 and a marker), with RLUSD (4), and with SNK, the deleted ones included (SNK/XRP) |
| `data-api/amm/pools/<A>/<B>.json` | each featured pool by its pair, in both orders, each side its API text (`XRP`, `524C…+rMx…`) |
| `data-api/amm/pools/<POOL>/swaps@descending=true&limit=20[&marker=<M>].json`, `/liquidity@…`, `/governance@…` | each featured pool's rows, newest first: split into two pages when there are two or more (the newer half, rounded up, with the marker of its last row; then the rest), so the pager has a page to go to; an event's marker is `[ledger_index, tx_index]`, a swap's the exchanges' `[ledger_index, tx_index, node_index]` |
| `data-api/amm/pools/<POOL>/liquidity@event=create&limit=1.json` | each featured pool's create event (DVR/XRP's), or an empty list |
| `node/amm_info/<POOL>.json`, `node/amm_info/<asset>_<asset2>.json` | `amm_info` of USDC/RLUSD, XRP/USD and DVR/XRP, by account and by pair, beside E3's XRP/RLUSD |

The featured pools, real pools of the recordings, named in the natural orientation:

| Pool | Account | What the recordings hold of it |
|---|---|---|
| XRP/RLUSD (stored RLUSD/XRP) | `rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3` | 7 states: 4 swaps (107694747, 107698980, 107699656, 107713744), two deposits (107698848, 107703707) and a withdrawal (107711512); no creation |
| USDC/RLUSD (stored RLUSD/USDC) | `rfWfhoLj3LiaBpoxus3h7pEF8jXDMtyGqb` | a swap (102186243) and a withdrawal (105257303); no native side, so no value |
| VOX/XRP (`VOX🗽`, stored VOX/XRP) | `rhEypxvxNXMdMTd3GXpb6gTN1jvb4h3nef` | only the AMMVote of 107644916, which shows its AMM node and neither its account nor its VOX line: no reserves, no value, and no `amm_info` (the node's answer is `actNotFound`, the page's "gone" mode) |
| XRP/USD (Bitstamp's USD, `rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B`; stored USD/XRP) | `rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am` | the AMMBid of 106084525, and 3 swaps in 107506489 |
| DVR/XRP | `rUAEvY1XNvnkurE9RunV7u3yjh3jQsQPsG` | its AMMCreate, 107612573 (2026-10-12T19:36:41Z), by `rEh4WnsrdmE7V1XeTsWi5dM7FHH8hYuea3` |
| SNK/XRP | `rGLnUKdptCVobJKEkrwxtdyGZ98Evdmqdz` | the AMMWithdraw of 100132150 that emptied and deleted it |

Where these differ from the data API: an issued amount is written with `toFixed()` where the parser writes `toString()` (the exponent form below 1e-6 and from 1e21; no
amount of the recordings is in that range, so the texts are the same), as the swaps of derived-trades.ts are; a pool without the native currency has no `value_native`, where
the API values it at the daily native rate of one of its assets, which the recordings do not give; and the featured pools' lists are split into two pages, where the API
would serve their few rows on one.

### The synthetic part: the day rows, the AMM-only candles and the live volume

The pool page's charts read months of a pool's day rows and its pair's AMM-only candles, and both pages read the live AMM volume; the recordings hold a few days of the
pools. So `scripts/amm-fixtures.ts` makes them up with E2's seeded generator (`scripts/synthetic.ts`), at T, the UTC day of the newest recorded ledger (2026-10-17; it
closed at 17:01:12Z), in the pages' windows (E2's `windowOf`: the 30 and 90 days to T, from 2026-09-18 and 2026-07-20, and the 52 weeks from Monday 2025-10-20):

- **One daily series per featured pool but VOX/XRP** (P3: only its vote is recorded), drawn from `mulberry32(seedOf(<POOL>, "history"))`, `<POOL>` the pool account,
  backwards from the derived pool: from 2025-10-01, or the recorded creation day when that is later (DVR/XRP, 2026-10-12), to T, or the deletion day when that is earlier
  (SNK/XRP, 2025-11-11). A day is active or quiet (no row) by a draw; the creation, the deletion, T, each day of a recorded liquidity event and XRP/RLUSD's 2026-10-10 are
  active. An active day's swaps, drawn once, make its row and its candle. Each swap is at the pool's closing price of the day (counter per base, 8 significant digits; on
  the day a withdrawal emptied the pool, the price just before it), and its native leg is above the 0.0005 the aggregates leave out. The row has the swaps' count, what went
  into the pool by side, each side's estimate (volume × `trading_fee` / 100000, exact; neither on XRP/RLUSD's 2026-10-10, a synthetic day made for the spec's one day
  without an estimate: see "differs" below), the day's recorded liquidity events of the pool (a creation counts as a deposit), and the closing reserves, `lp_supply`, `trading_fee` and
  `value_native` (2 × the native reserve, `valueText`; none for USDC/RLUSD, nor on the day of the deletion, which closes in the deleted pool's state). The day before closes
  with the day's swaps and liquidity taken back, so the last day closes in the derived state (T for a live pool: the day so far) and every earlier day follows from it. A
  draw steers that walk: the base reserve of each day before is pulled towards a triangle wave below the derived one, so the price moves and the reserves stay positive.
  DVR/XRP's recordings end with its creation, so its swaps are round trips and the walk lands on nothing before the creation. Over the whole series: XRP/RLUSD 334 rows,
  USDC/RLUSD 213, XRP/USD 274, DVR/XRP 5, SNK/XRP 26.
- **VOX/XRP's empty answers.** It has no series, but the index has its states, so the API answers its pool page's day rows with empty lists, not `pool not found`
  (docs/api-reference.md "AMM", "Empty and 404"): its 90 days (the page's default period) have empty day rows, an empty carry-in and last day, and no AMM candles, each
  without a marker, so its "gone" page is whole under the fixtures. The real API would also serve 2026-10-14, the day of its recorded vote, as a row (amm_daily writes one
  for every day a transaction touches the pool); the fixtures leave that row out so that the "gone" page has no series (P3).
- **The live set**, `network/amm_volume@live=day.json`, drawn from `mulberry32(seedOf("xrpl", "amm_volume", "live"))`, a pool at a time in account order: the rolling day
  from 2026-10-16T17:01:00Z to 2026-10-17T17:01:00Z (the aggregator's minute), a component for each of the 50 live pools with the native currency but VOX/XRP (the pages'
  pool without swaps); the issued-only pools (USDC/RLUSD among them) have none, a synthetic choice so that the list has a pool whose 24-hour volume is "—" (see "differs"
  below). A component's native volume is a share of the pool's native reserve, its base volume that at
  the pool's price (a draw for the one pool whose other reserve the recordings do not hold), 1,534 swaps and 893,025.375 XRP in all.

Which files (P2 of E5 scopes them: the 1.3 MiB of every period of every pool would not fit a reviewable budget):

| Pool | Windows (day rows and candles) | Carry-ins | Last day |
|---|---|---|---|
| XRP/RLUSD | 30 days, 90 days, 1 year (`7day` candles) | the three | yes |
| USDC/RLUSD, XRP/USD | 90 days | 90 days | yes |
| DVR/XRP | 30 days (its creation inside it) | the three, each empty | yes |
| SNK/XRP | 30 days and 90 days (empty), 1 year (its deletion inside it) | the three: its deletion day for the 30 and 90 days | yes (empty) |
| VOX/XRP | 90 days, both empty (no series) | 90 days, empty | yes (empty) |

| Files below `http/xrpl/` | What |
|---|---|
| `data-api/amm/pools/<POOL>/history@end=2026-10-17&interval=day&limit=1000&start=<W₀>.json` | the rows whose day is from W₀ to T, oldest first (W₀ 2026-09-18, 2026-07-20 or 2025-10-20) |
| `data-api/amm/pools/<POOL>/history@descending=true&end=<W₀ − 1 day>&interval=day&limit=1.json` | the carry-in: the newest row on or before the day before W₀, with the marker of its day (the base64url JSON of its start in unix seconds) when older rows exist; else `days: []` |
| `data-api/amm/pools/<POOL>/history@end=2026-10-16&interval=day&limit=1&start=2026-10-16.json` | the last whole day's row, or `days: []` |
| `data-api/exchanges/<B>/<C>@amm=only&end=2026-10-17&interval=<1day or 7day>&limit=400&start=<W₀>.json` | the series' swaps as candles, `<B>/<C>` the pool's stored pair, each side its `apiAssetText` (`524C…+rMx…/XRP`); a candle for each day (week from Monday) with swaps |
| `data-api/network/amm_volume@live=day.json` | the live set above |

| | Repository, ref | Commit | For |
|---|---|---|---|
| `docs/api-reference.md` ("AMM": `/history?interval=day`; `/v2/network/amm_volume`; `/v2/exchanges/{base}/{counter}`, "Candles") | `data-api-new`, `feat/amm-data` | `c3e23026b3405fc2fd27fc897e724df4dfe106f1` | the PoolDay and its key order, the window of the days (a day whose start is within `start` and `end`), the live row and its AMM component |
| `packages/shared/src/aggregate/amm-daily.job.ts` | same | same | a day's figures: what went in by side, the estimates (input × fee / 100000, left out when a swap into the side had no known fee, which happens only before the pool's first known fee, `"0"` when none went in), the liquidity flows (a creation a deposit, a clawback a withdrawal, a deletion neither), the closing state and its value |
| `apps/api/src/amm/amm-pools.service.ts` (`days`); `apps/api/src/common/pagination.ts` | same | same | the days' marker: the start of the last day of a page, unix seconds (`encodeMarker`), when the page is not the last |
| `apps/api/src/network/volume-object.ts`; `apps/api/src/network/volume.service.ts` (`live`) | same | same | the live row (`components, count, exchange, total, exchange_rate, start_time, end_time`) and its AMM component (`amm_account, base, counter, count, amount, rate, converted_amount`), sorted by converted amount then account; `rate` amount / converted at 8 digits |
| `scripts/market-aggregates.ts` (`candlesOf`, E3's port; "Derived trades and pool states" names its commits) | this repository | | the candles from the swaps: open and close, high and low, exact sums, `buy_volume` the base the takers bought, buckets from `start`, weeks from Monday |

Where the synthetic part differs from what the API would serve for real pools: the fee never changes and no taker holds the auction slot, so an estimate is the volume ×
the fee; XRP/RLUSD's 2026-10-10 has neither estimate in the middle of a series with estimates around it, which the API cannot serve (amm-daily.job.ts leaves an estimate
out only for a swap with no known fee, so only before the pool's first known fee): a synthetic day, made for the spec's one day without an estimate; the live set has no
component for USDC/RLUSD or the other issued-only pools, a synthetic choice for the list's "—" case, where the API would list USDC/RLUSD converted through RLUSD, whose
rate the XRP/RLUSD market and pool give (it leaves out only a pool with no rate on either side); every swap of a day is at the day's closing price, so a candle's prices
are within the rounding of its amounts of one another; the series do not hold the pools'
recorded swaps (the Swaps tabs list those) and are not E3's derived XRP/RLUSD trades and candles (P33: each page is checked against its own fixtures); the live set is
drawn apart from the series; its converted amounts are whole 64ths of a coin, so that the API's sum of doubles (`String(total)`) is exact; and SNK/XRP's dust reserves (the
0.0000851206393053295 SNK and 0.021974 XRP its last withdrawal took) give base estimates in BigNumber's exponent form (`1.250946e-8`), as the API writes such a sum. VOX/XRP's
90 days are empty, where the API would hold a row for 2026-10-14, the day of its recorded vote (amm-daily.job.ts has a row for every day a transaction touched the pool):
a row with no swap and no liquidity, the vote's fee and LP supply, and no reserves (only the AMM node is recorded). The fixtures leave that row out so that VOX/XRP's
"gone" page has no series (P3).

**What keeps them true.** `test/unit/amm-fixtures.test.ts` checks the derivation against the reference's counts over the `xrpl-amm` ledgers, the featured pools' roles, the
reference's key orders, amounts, numbers, `value_native`, stored pair order and liquidity signs (against each transaction's own nodes), the list's order and markers, the
filters, the pair forms, the tabs' pages, and the featured pools' `amm_info` against the derived pools (two derivations of the same nodes), and runs the client's checks
(`app/server/amm-shape.ts`) on every answer. For the synthetic part it checks the windows and their nesting, the carry-ins and their markers, the creation and the
deletion, T's closing state against the derived pool, the liquidity of each day against the recorded events, the estimates, `value_native`, each candle against its day
and each week against its days, the reserves' walk against the candles and the rows, the live set's components, order, sums and rates, and the key orders.
`scripts/http-fixtures.test.ts` fails when a file is not what the generator writes. `isAmmGenerated` (`scripts/http-fixtures.ts`) names the files, which have a size budget
of their own in `test/unit/http-fixtures.test.ts` (224 files, 655,466 bytes, about 0.63 MiB, of which the 39 synthetic files are 513,235 bytes).
