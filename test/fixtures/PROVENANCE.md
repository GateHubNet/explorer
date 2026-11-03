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
| `ledgers/xrpl-nft/` (11 ledgers + `manifest.json`) | `packages/shared/test/fixtures/xrpl/nft/` at D3's `da5ce14ccfe9e429aacaf5ab6672eac15ce0d1de` (`PIN`, see below) | `f4789b565ed866939cee34d4a728cc2eff928751` | `wss://s2.ripple.com` | 2026-10-26T16:05:15Z | 107918450 |
| `ledgers/xahau-nft/` (9 ledgers + `manifest.json`) | `packages/shared/test/fixtures/xahau/uritoken/` at `PIN` | `ed8edd3fed57ac5b8b9cd120ae88e51a59f5a81b` | `wss://xahau.network` | 2026-10-26T15:30:01Z | 26811706 |
| `ledgers/xrpl-objects/` (22 ledgers + `manifest.json`) | `packages/shared/test/fixtures/xrpl/objects/` at D5's `0c2e58c3995cb3fdc240c3bf89dea9c4ab1e8adb` (`PIN` of E10, see below) | `c3fe181141f62cbabb24693f26771eb228f8c2d5` | `wss://s2.ripple.com` | 2026-10-29T04:51:57.628Z | 107973016 |
| `ledgers/xahau-objects/` (12 ledgers + `manifest.json`) | `packages/shared/test/fixtures/xahau/objects/` at the same commit | `9a56f23cc8693bedc00acd5ca494138a018396a2` | `wss://xahau.network` | 2026-10-29T04:56:33.429Z | 26873124 |
| `ledgers/xrpl-mpt/` (27 ledgers + `manifest.json`) | `packages/shared/test/fixtures/xrpl/mpt/` at D9's `c9a2fc0ffd41b3ad7e5b78fbb73b220f38700f30` (`PIN` of E14, see below) | `f84869828d70954353cf1e7b574bfdda6a1e05a2` | `wss://s2.ripple.com` | 2026-10-31T15:51:37.413Z | 108026259 |
| `runtime/amm-deposit.meta.json` | the metadata of AMMDeposit `83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B`, taken from `xrpl/recorded/107671558.json.gz` | as `ledgers/xrpl/` | as `ledgers/xrpl/` | as `ledgers/xrpl/` | as `ledgers/xrpl/` |

The two `-nft` sets were copied later and from another checkout: D3's worktree, branch `feat/explorer-data-2`, commit `da5ce14ccfe9e429aacaf5ab6672eac15ce0d1de` (`PIN`), read with
`git show` (`git -C <D3 worktree> show da5ce14:packages/shared/test/fixtures/<xrpl/nft|xahau/uritoken>/<file>`), byte for byte, the `.json.gz` ledgers and `manifest.json` only: not
`server_definitions.json`, `server_info.json` or `FINDINGS.md`. They are newer than every other set (mainnet 2026-10-24 and 25, where the rest end on 2026-10-17): see "NFT answers".

The two `-objects` sets were copied for E10 (the ledger-object pages) from D5's worktree, branch `feat/explorer-data-2`, at commit `0c2e58c3995cb3fdc240c3bf89dea9c4ab1e8adb`
(D5's last, E10's `PIN`), read with `git show` (`git -C <D5 worktree> show 0c2e58c:packages/shared/test/fixtures/<xrpl|xahau>/objects/<file>`, never `cp` from the tree, which another
session was changing), byte for byte (each file's blob is the pin's), the `.json.gz` ledgers and `manifest.json` only: not `server_definitions.json`, `server_info.json` or `FINDINGS.md`.
"Last changed in" is `git -C <D5 worktree> log -1 --format=%H 0c2e58c -- packages/shared/test/fixtures/<xrpl|xahau>/objects` for each directory. They are not among `SETS`
(scripts/http-fixtures.ts): most of their ledgers are newer than the head of the other sets (2026-10-17), which `last_validated` and every page built on it would follow (plan
Ruling 7); see "Ledger object answers".

The `-mpt` set was copied for E14 (the MPT pages) from D9's worktree, branch `feat/explorer-data-2`, at commit `c9a2fc0ffd41b3ad7e5b78fbb73b220f38700f30` (D9's last, E14's `PIN`), read with `git show`
(`git -C <D9 worktree> show c9a2fc0ffd41b3ad7e5b78fbb73b220f38700f30:packages/shared/test/fixtures/xrpl/mpt/<file>`), byte for byte (each `.json.gz` blob is the pin's), the 27 ledgers only: not
`server_definitions.json`, `server_info.json` or `FINDINGS.md`, and not D9's `manifest.json`: this set's own holds two keys, `source` (where the files came from, as the table says) and `cases`, D9's 22 cases verbatim
(a name, its ledger, hash, transaction type and a note). It is not among `SETS` either (plan ruling C2): `readLedgers` feeds the markets, pools and tokens generators, and D9's recordings are whole ledgers (2,100 transactions), so putting it there would move 62 generated
files under every market, pool and token test (measured on a scratch copy of the real `generate()`: 16 `exchanges/`, 4 `network/`, 9 `amm/`, 31 `tokens`, the names and `ledger-hashes.json`). `scripts/mpt-fixtures.ts` reads it through `readLedgerSet`,
and `test/support/ledgers.ts` has it as `FixtureSet` `xrpl-mpt`. See "MPT answers".

What each set holds (details in `data-api-new/packages/shared/test/fixtures/README.md`):

- `ledgers/xrpl/`: one ledger per XRPL transaction type the recording looked for (AMMCreate, AMMDeposit,
  AMMWithdraw, NFTokenMint, NFTokenAcceptOffer, AccountDelete, CheckCash, TicketCreate, EscrowFinish), found by
  scanning 3000 ledgers. The manifest's `found` maps each type to its ledger and transaction hash.
- `ledgers/xrpl-amm/`: 16 ledgers, each holding one named AMM case (swaps through a pool, deposits, withdrawals,
  vote, bid, create, LP-token transfer). The manifest's `cases` maps a case name to its ledger, hash, transaction
  type and a note that says which pool moved and how; `txs` maps each hash to `{ledger, type, result}`.
- `ledgers/xahau/`: one ledger per Xahau transaction type the recording looked for (ClaimReward, GenesisMint,
  Invoke, Remit, URITokenBuy, URITokenMint). `Import` and `SetHook` were not found in the window.
- `ledgers/xrpl-nft/`: 11 ledgers, 107874617 to 107886233 (about 12 hours of 2026-10-24 and 25), each holding one named case of D3's NFT parser (a mint, with an offer, on behalf of
  an issuer, with a page split; a burn, one that removes offers; a modify; a sell and a buy offer; a cancel; four sales: by a sell offer, by a buy offer, brokered with a royalty,
  in an issued currency; a transfer with no price). The manifest's `cases` maps a case name to its ledger, hash, transaction type and a note; `txs` maps each hash to
  `{ledger, type, result}`. The ledgers hold 121 `NFTokenCreateOffer`s, 12 mints, 5 accepts, 8 cancels, a burn pair and a modify.
- `ledgers/xahau-nft/`: 9 ledgers, 26533927 to 26774724 (2026-10-21 to 25), the cases of D3's URIToken parser (a mint, a sell offer made and cancelled, a `URITokenBuy`, a burn that
  removes an offer, a `Remit` that moves a token, a `Remit` that mints one, a burn and a re-mint of one id). `uritoken_mint_with_offer` was not found.

- `ledgers/xrpl-objects/`: 22 ledgers, 102145584 to 107972102 (2026-02-10 to 10-29), each holding one of the 19 cases of D5's object parser or one of the three transactions that
  support them (the manifest's `cases` and `txs`): escrows timed, conditional (a token), finished without a fulfillment, cancelled by a third party, of a token created and finished;
  checks of XRP and of RLUSD created, cashed for an amount and of a token, cancelled by the source; channels created, funded with an `Expiration`, claimed for the first time,
  asked to close by the source, closed by the destination, renewed, closed after expiring; the one `DelegateSet` found on the network (`rnt8Pb…` to `rw2X2G…`) and a delegated
  Batch inner `OfferCreate`. Six of them are ledgers of the sets above too (107670360, 107671568, 107698980, 107699656, 107703707, 107711512), byte for byte. Ledger 106179366
  holds 191 successful `EscrowCancel`s: the case's (a third party) and 190 of token-escrow testers.
- `ledgers/xahau-objects/`: 12 ledgers, 8852809 to 26399329 (2024-09-30 to 2026-10-09), the 11 cases of Xahau (an escrow created to itself, finished by its owner, finished with an
  `EscrowID`, cancelled by a third party, of a token; a check created and cashed with `DeliverMin`; a channel created and claimed, and a token channel created and claimed) and one
  supporting token cash.

- `ledgers/xrpl-mpt/`: 27 ledgers of XRPL mainnet, 85885429 to 107541378 (2024-02-11 to 2026-10-09), 2,100 transactions, 1.25 MB gzipped (1.28 MB with the manifest), each holding one of the 22 cases of D9's MPT parser
  (the manifest's `cases`: issuances created with every field, with short keys, with a URL as metadata and with no maximum; a lock of one holder and its unlock, a lock of every balance, a destroy; an opt-in, an
  authorization by the issuer and an opt-out; payments that move a balance between holders, mint, redeem, pay a transfer fee, come before `fixMPTDeliveredAmount` or fail; clawbacks in full and in part, and one of an issued token; an escrow created and
  finished), three supporting transactions and the three ledgers that enabled MPT's amendments. Nine of the 22 are the explorer's `MPT_RECORDED` (`test/support/mpt-case-rules.ts`); the rest are read by later
  tasks through `loadManifest("xrpl-mpt")` and `loadTx`. D9's `FINDINGS.md` lists no case as not found (`escrow_cancel` is the testnet's, not recorded here).

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
synthetic (the same section, "The synthetic part"). The NFT pages' files (`data-api/nfts/`, `data-api/accounts/<address>/nfts@…`, `data-api/nft_collections…`, `data-api/nft_sales@…`, `data-api/network/nft_volume@…`,
`node/nft_info/`, `node/nft_sell_offers/`, `node/nft_buy_offers/`, `node/ledger_entry/`) are derived from the two `-nft` sets, around some synthetic and hand-made parts ("NFT answers"),
the collections, the sales and the volume among them.
The display names and the tomls (`data-api/account_names.json`, `data-api/toml/`) are synthetic, fictional names and `*.example` domains made up for the addresses the other
files show ("Synthetic names and tomls").

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

Read with `git -C ../data-api-new show <commit>:<path>`, never checked out. `feat/amm-data` was not merged when these were made; it is in data-api-new `main` since
9dbbd8a, whose `openapi.yaml` the client's `PATHS` follow. The fixtures hold `amm_volume` because the top level of `wrangler.jsonc` and the tests have `AMM_DATA` on (the
`worker-off` project never asks for it).

**The markets pages' aggregates** (`network/markets`, and the pair routes of the markets pages). The data API client's types (`app/server/api-types.ts`: `MarketsResponse`,
`MarketRow`, `PairExchange`, `Candle`, `ReducedRow`, `ActiveAccounts`) and the checks it runs inside its cached loads (`app/server/aggregate-shape.ts`: `checkMarkets`,
`checkPairExchanges`, `checkCandles`, `checkReduce`, `checkActiveAccounts`) follow these, and so do the synthetic `network/markets@…` files and the derived pair files the markets
fixtures make; read with the same `git -C ../data-api-new show <commit>:<path>`.

| | Repository, ref | Commit | For |
|---|---|---|---|
| `docs/api-reference.md` | `data-api-new`, `feat/explorer-data` | `7d495ab50cc7ad9b1434ab8e28b2ca5f7cbde13e` (the merge of D2) | **the markets shape**: the section `GET /v2/network/markets` (keys, formats, `period`, `limit`, the display currency's `exchange`, `exchange_rate` and `converted_volume`, the empty answer of a database with no set yet). Its `change` is optional, as the reference has it (the design's key list has it required) |
| `docs/superpowers/specs/2026-10-19-account-market-aggregates-design.md` | `data-api-new`, `feat/explorer-data` | `7d495ab50cc7ad9b1434ab8e28b2ca5f7cbde13e` | the **places of the AMM keys** (section 7: `amm` after `period`, `totals.amm_share` after `converted_volume`, `amm_share` and `amm_pool` before `sparkline`) and their **formats** (section D2b.1: a share is a string with exactly 4 decimals, `amm_pool` a boolean, both present only when known, `"0.0000"` and `false` on Xahau). The reference at that commit serves no AMM field |
| `docs/api-reference.md` | `data-api-new`, `feat/amm-data` | `c3e23026b3405fc2fd27fc897e724df4dfe106f1` | the `amm` filter (`include`, `exclude`, `only`) of the exchange lists and `amm_account` on a swap, which is the last key of a trade |
| `docs/superpowers/specs/2026-10-19-account-market-aggregates-design.md`, `docs/api-reference.md` | `data-api-new`, `main` | `9dbbd8a5b5ad99254c2b000433b05fba1501bba3` (D2b merged, with the owner's decisions on D2b.1) | **`amm` in every answer**: echoed after `period`, `include` when the request has none, the answer without a set too |
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
formula, not the rounding); on Xahau `"0.0000"` and `false`. `amm` is in every answer, after `period`: the filter asked for, or `include` without one (D2b.1 as data-api-new
`9dbbd8a` settles it); the client reads it of a filtered answer only.

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

## Recorded node answers: `http/<net>/node/book_offers/` and `http/xrpl/node/account_info/rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS.json`

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

### The `account_info` of LIONS' issuer

One more recorded answer, for the token pages (E11, "Token answers" below): D6 has no row for LIONS' issuer in the fixtures, so the token page reads its settings from the node. One JSON-RPC POST
of `{"method":"account_info","params":[{"account":"rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS","ledger_index":"validated"}]}`, a read-only method, and the whole answer written with `fixtureText` at
`nodeFile`'s path (keys sorted; nothing added, left out or edited, so the Clio server's `warnings` and `account_flags` are in the file). It was made once, by a throwaway script, not by
`scripts/record-node-fixtures.ts`, which records the books; `pnpm fixtures:sync` leaves it alone (`node/account_info/` is `isHandWritten`). Run again, it would read another ledger.

| Network | Node | Answered (UTC) | `result.ledger_index` | File below `http/` |
|---|---|---|---|---|
| XRPL | `https://s1.ripple.com:51234/` (a Clio server) | 2026-10-30, 21:01:25.503 | `108009034` | `xrpl/node/account_info/rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS.json` |

That ledger is newer than the head of the recordings, and nothing relates the two, as with the books. The account is real: its `Domain` and flags are the node's, and the data API's answer for
LIONS leaves out `domain` and `issuer_settings` on purpose, as an issuer the state tables do not hold yet.

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
the same commit, and every file passes them. The `toml` of a validator (E13) follows D8, which is one commit of its own:

| | Repository, ref | Commit | For |
|---|---|---|---|
| `docs/api-reference.md`, "Validators and amendments": `toml` on a validator row and on the answer for one | `data-api`, `feat/explorer-data-2` | `cbd6c51caccfdc28c678f8b620e2f8a4b45c5e09` | the keys of `toml` and their order ("Keys of toml on a validator row", "Keys of toml on the validator answer"), when a key or the whole `toml` is absent and when it is `{}`, what the detail adds from the toml store (D8 §4.1, §4.2) |
| `docs/openapi.yaml` | the same commit | `cbd6c51caccfdc28c678f8b620e2f8a4b45c5e09` | `api/openapi.yaml` and `app/server/openapi.d.ts`, synced from this commit (`git show` into a scratch `docs/`, `DATA_API_REPO=<scratch> pnpm api:sync`) and not from the branch tip, which holds routes of later work (E13 Ruling C1) |

`PIN` of E13 is that commit. The sync is not a clean addition: the document gains `/v2/network/validators/countries` and the `country` parameter of the list, and two path
blocks (`/v2/account_names`, `/v2/toml/{domain}`) moved up (142 lines of diff); the explorer calls neither new route.

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

**The `toml` of a verified validator (E13, `tomlsOf` in `scripts/validators-fixtures.ts`).** D8 gives `toml` to a validator whose domain is `verified` and has been read by its checker,
and to no other, so only the verified validators have one, in both the list and the answer for one; the rest of the fleet has none. They are drawn from a stream of their own,
`mulberry32(seedOf(net, "toml"))`, so nothing else in the files moves. The verified validators in the list's order get:

| | `toml` of the row | The detail adds |
|---|---|---|
| **F**, the first verified validator with `[[ACCOUNTS]]` (`birchridge` on XRPL, `kestrelbay` on Xahau) | all four keys: `owner_country`, `server_country`, `network` `"main"`, `unl` | `principals` `["Mara Lindqvist", "Tomas Okafor"]`, `modified` `2026-10-02T00:00:00Z`, `accounts_listed` the served accounts + 2 (D8: the store's facts can be a check newer or older than the row's), `currencies` `USD` and the 40-hex `4E50555344…` (NPUSD) of its first account and `EUR` with no issuer, `currencies_listed` 5, `fetched` half an hour before the newest ledger |
| no. 1 of the others | none: a verified domain whose file is not read yet | |
| no. 2 | `{}`: the entry gives none of the four | |
| no. 3 | a country and no `network` | `principals` `["North Peak Ops"]`, `fetched` |
| no. 4 | `network` `"testnet"` on XRPL (the "not this network" case), `"21337"` on Xahau (its network ID, which is its mainnet) | |
| no. 5 | XRPL only: `server_country` `XK` (Kosovo, which has no ISO code of its own) | |
| no. 7, the long one (E13 C8, E11's I1) | `server_country` `GS` (a 38-character name), a 32-character `network`, a `unl` host of 200 characters in labels of up to 63, all `*.example` | `principals` of one name of 100 characters, one currency of a 40-character code without an issuer, `currencies_listed` 1, `fetched` |
| no. 6 and every 6th after (12, 18, …) | no `server_country` (the other keys as drawn), so that "Unknown location" counts more than the validators whose domain does not verify | |
| the others | drawn values: `network` `"main"`, `unl` the network's publisher list (`https://vl.ripple.com`, `https://vl.xahau.org`), `server_country` from the pool below, `owner_country` the same one 7 times in 10 and another of the pool otherwise | the row's `toml` alone |

The pools are XRPL's `US DE NL GB FR CH SG JP CA FI SE IE AU HK KR ES PL NO IN XK` and Xahau's `NL DE FI SE US GB FR SG JP AU NO EE`, the first three of each weighing 10, 8 and 6 and the
others 1 (the first three then lead: XRPL's US 9, DE 6, NL 4; Xahau's DE 6, FI 5, NL 4). The numbers are the plan's ("numbered from 1", F taken out). No address is new: F's currencies
name its own first account, which E9's `names-fixtures.ts` already names, and `pnpm fixtures:check` shows `account_names.json` unchanged. No domain is new either; every `unl` is a publisher
of the network or a `*.example` host. The cases are rules of `test/support/validators-case-rules.ts`: `toml-full`, `toml-not-read`, `toml-empty`, `toml-no-network`, `toml-other-network`
(XRPL), `toml-network-id` (Xahau), `toml-xk` (XRPL), `toml-long` and `unknown-location`.

**Invented, and not checked against anything real:** every key but the given validators', every domain (`*.example`, RFC 2606: no operator is implied), the accounts of G1, the
publishers' keys, sequences and dates; every `toml` (the countries, the principals' names, the currencies, the dates of `modified` and `fetched`); the hours of agreement and their scores; the versions and their counts; the vote records and fee votes; the amendments' statuses,
votes, rounds, dates, ledgers, `introduced`, descriptions and `xls_url` paths (under `https://github.com/XRPLF/XRPL-Standards/`, as G2 wants), and the hashes of their
EnableAmendment transactions and of every ledger but the recorded ones (no transaction or ledger page serves them). Where the rules leave a choice open: the files sort their
keys as every generated fixture does (the generator builds every object in the reference's order, which the test checks); one hour of the 30 days has no final record, so
`agreement_30d` and that day are `incomplete` for every validator (D1's `incomplete` is the window's, not the validator's); the voting amendments have 3 days of rounds while
the majority has 30, as the spec asks, though D1 would give every amendment being decided the same rounds. Filling states (spec section 10) are overrides in the specs,
not files. Only an end-to-end run against a real stack (`E2E_DATA_API_URL`) checks these files against real answers.

**What keeps them true.** `test/unit/validators-fixtures.test.ts` works D1's rules out again from the answers (the validators' order and the summary's counts and versions, F7 for
every round and tally, `pct`, the amendments' order, the envelope of every amendment answer, the votes against the records, the server versions decoded), checks every object's
keys against the reference's order (the `toml` of a row and of a detail too), runs the client's checks on every answer, and holds every case by the rules of `test/support/validators-case-rules.ts`, the ones
`test/support/validators-cases.ts` finds a validator or an amendment of a case by for the worker specs (over the files, never by a fixed key). `scripts/http-fixtures.test.ts` fails when a file is not what the generator writes.
`isValidatorsGenerated` names the files, and they have a budget of their own in `test/unit/http-fixtures.test.ts` (239 files, 2,884,903 bytes, about 2.75 MiB; the `toml` added about 15.7 KB).

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
- **The computed range of a page of days** (D2b.4): every page of days has `computed_start` and `computed_end` after `result`, the part of its request's window that the
  data API has computed. The synthetic data API has computed every day from 2025-10-01, where the series start (`amm_daily`'s back-fill starts at the first pool
  activity), to T, for every pool: a window's page has its start to T, a carry-in (no `start`) 2025-10-01 to its end, the last day that day. So VOX/XRP's empty pages,
  DVR/XRP's before its creation and SNK/XRP's after its deletion are computed quiet days, as the API would serve them.
- **The live set**, `network/amm_volume@live=day.json`, drawn from `mulberry32(seedOf("xrpl", "amm_volume", "live"))`, a pool at a time in account order: the rolling day
  from 2026-10-16T17:01:00Z to 2026-10-17T17:01:00Z (the aggregator's minute), a component for each of the 50 live pools with the native currency but VOX/XRP (the pages'
  pool without swaps); the issued-only pools (USDC/RLUSD among them) have none, a synthetic choice so that the list has a pool whose 24-hour volume is "—" (see "differs"
  below). A component's native volume is a share of the pool's native reserve, its base volume that at
  the pool's price (a draw for the one pool whose other reserve the recordings do not hold), 1,534 swaps and 893,025.375 XRP in all. Each component has D2b.3's
  `fees_est`, its converted amount × the pool's `trading_fee` / 100000 in doubles, written by `String` (the API writes the stored Float64), and the row the sum of the
  components' (4,098.12715171875 XRP). The recordings show the fee of 6 of the 50 pools; the others' fees are drawn from 0 to 1000 from
  `mulberry32(seedOf("xrpl", "amm_volume", "live", "fees"))`, a stream of its own, so the other draws of the set are what they were before D2b.

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
| `data-api/amm/pools/<POOL>/history@end=2026-10-17&interval=day&limit=1000&start=<W₀>.json` | the rows whose day is from W₀ to T, oldest first (W₀ 2026-09-18, 2026-07-20 or 2025-10-20); computed from W₀ to T |
| `data-api/amm/pools/<POOL>/history@descending=true&end=<W₀ − 1 day>&interval=day&limit=1.json` | the carry-in: the newest row on or before the day before W₀, with the marker of its day (the base64url JSON of its start in unix seconds) when older rows exist; else `days: []`; computed from 2025-10-01 to W₀ − 1 day |
| `data-api/amm/pools/<POOL>/history@end=2026-10-16&interval=day&limit=1&start=2026-10-16.json` | the last whole day's row, or `days: []`; computed 2026-10-16 to 2026-10-16 |
| `data-api/exchanges/<B>/<C>@amm=only&end=2026-10-17&interval=<1day or 7day>&limit=400&start=<W₀>.json` | the series' swaps as candles, `<B>/<C>` the pool's stored pair, each side its `apiAssetText` (`524C…+rMx…/XRP`); a candle for each day (week from Monday) with swaps |
| `data-api/network/amm_volume@live=day.json` | the live set above |

| | Repository, ref | Commit | For |
|---|---|---|---|
| `docs/api-reference.md` ("AMM": `/history?interval=day`; `/v2/network/amm_volume`; `/v2/exchanges/{base}/{counter}`, "Candles") | `data-api-new`, `feat/amm-data` | `c3e23026b3405fc2fd27fc897e724df4dfe106f1` | the PoolDay and its key order, the window of the days (a day whose start is within `start` and `end`), the live row and its AMM component |
| `packages/shared/src/aggregate/amm-daily.job.ts` | same | same | a day's figures: what went in by side, the estimates (input × fee / 100000, left out when a swap into the side had no known fee, which happens only before the pool's first known fee, `"0"` when none went in), the liquidity flows (a creation a deposit, a clawback a withdrawal, a deletion neither), the closing state and its value |
| `apps/api/src/amm/amm-pools.service.ts` (`days`); `apps/api/src/common/pagination.ts` | same | same | the days' marker: the start of the last day of a page, unix seconds (`encodeMarker`), when the page is not the last |
| `apps/api/src/network/volume-object.ts`; `apps/api/src/network/volume.service.ts` (`live`) | same | same | the live row (`components, count, exchange, total, exchange_rate, start_time, end_time`) and its AMM component (`amm_account, base, counter, count, amount, rate, converted_amount`), sorted by converted amount then account; `rate` amount / converted at 8 digits |
| `docs/api-reference.md` (`/v2/network/amm_volume`, "`fees_est`"; `/history`, "The days the figures are computed for"); `apps/api/src/network/volume-object.ts` (`toVolumeRow`); `apps/api/src/amm/amm-pools.service.ts` | `data-api-new`, `main` | `9dbbd8a5b5ad99254c2b000433b05fba1501bba3` (D2b) | `fees_est` last in the live day's component and row (`String` of the stored double; the row's only when every listed component has one), and `computed_start`, `computed_end` after `result` of a page of days |
| `scripts/market-aggregates.ts` (`candlesOf`, E3's port; "Derived trades and pool states" names its commits) | this repository | | the candles from the swaps: open and close, high and low, exact sums, `buy_volume` the base the takers bought, buckets from `start`, weeks from Monday |

Where the synthetic part differs from what the API would serve for real pools: the fee never changes and no taker holds the auction slot, so an estimate is the volume ×
the fee; XRP/RLUSD's 2026-10-10 has neither estimate in the middle of a series with estimates around it, which the API cannot serve (amm-daily.job.ts leaves an estimate
out only for a swap with no known fee, so only before the pool's first known fee): a synthetic day, made for the spec's one day without an estimate; the live set has no
component for USDC/RLUSD or the other issued-only pools, a synthetic choice for the list's "—" case, where the API would list USDC/RLUSD converted through RLUSD, whose
rate the XRP/RLUSD market and pool give (it leaves out only a pool with no rate on either side); the live set's fee estimates are its volume × the fee, where the
API sums each swap's input × the fee in force for it, and most of the fees are drawn (the API would carry each pool's fee in from before the window); every swap of a day is at the day's closing price, so a candle's prices
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
and each week against its days, the reserves' walk against the candles and the rows, the live set's components, order, sums, rates and fee estimates, the
computed range of every page of days, and the key orders.
`scripts/http-fixtures.test.ts` fails when a file is not what the generator writes. `isAmmGenerated` (`scripts/http-fixtures.ts`) names the files, which have a size budget
of their own in `test/unit/http-fixtures.test.ts` (231 files, 709,489 bytes, about 0.68 MiB, of which the 39 synthetic files are 516,361 bytes).

## NFT answers: `http/<net>/data-api/nfts/`, `…/accounts/<address>/nfts@…`, the collections, the sales and the volume, and the nodes' `nft_info`, `nft_sell_offers`, `nft_buy_offers` and `ledger_entry`

The data API's answers (D3: `GET /v2/nfts/{id}`, its `/history` and `/offers`, `GET /v2/accounts/{address}/nfts`, `GET /v2/nft_collections` and the routes of a collection,
`GET /v2/nft_sales`, `GET /v2/network/nft_volume`) and the nodes' answers for the NFTs the index lacks (E8, the NFT pages).
Not recorded: worked out from the NFT ledgers D3 recorded (`ledgers/xrpl-nft/`, `ledgers/xahau-nft/`, above), as D3's index would hold them, around some synthetic and hand-made parts
below. Generated by `generate()` (`pnpm fixtures:sync`), from `scripts/nft-derive.ts` (the port) and `scripts/nft-fixtures.ts` (the files), which `scripts/http-fixtures.ts` joins
as it joins the AMM pages' generator. The ledgers are read through `readLedgerSet` and are not among `SETS`: they are newer than T (2026-10-17, the UTC day of the newest ledger of
the other sets, which `last_validated`, the lists of ledgers and transactions and every synthetic aggregate follow), so they are not served as ledgers or as transactions, and
`last_validated` stays where it was. **The events keep their recorded times**, 2026-10-24 and 25 on XRPL and 2026-10-21 to 25 on Xahau, after T; so a link from an NFT's page to the
ledger or the transaction of one of its events is a 404 in the fixtures. What is dated by T, the windows of the stats and of the volume (the 30 days to 2026-10-17), does not meet the
events: the days of a collection's stats are its events moved into the window ("The synthetic parts").

### The port

`PIN` is `da5ce14ccfe9e429aacaf5ab6672eac15ce0d1de`, D3's `feat/explorer-data-2` (data-api-new), read with `git show <PIN>:<path>`, never checked out or imported:

| Path at `PIN` | Last changed in | For |
|---|---|---|
| `packages/shared/src/parsers/nft.parser.ts` | `f4789b5` | the events of a transaction (§2), as D3's controller rulings amended them (below) |
| `packages/shared/src/aggregate/nft-state.ts` | `4a5740c` | `foldNftEvents`: the owner, the burn, the URI, the sales and the creation of an NFT from its events |
| `apps/api/src/nft/nft-objects.ts` | `6532806` | the objects (`toNftObject`, `toNftEventObject`, `toNftOfferObject`), their key orders and which keys are left out |
| `apps/api/src/nft/nfts.service.ts` | `d0c1ab0` | the open offers: the newest event of each `offer_id` among the offer events, kept when it is an `offer_create`, newest first; the per-NFT coverage from the first event |
| `apps/api/src/common/feature-coverage.service.ts` | `86391c4` | `itemCoverage`: the feature's coverage, complete also when the item's creation is indexed |
| `packages/shared/src/query/nft-prices.ts` | `6532806` | the converted price of a sale: a price in the native currency is itself |
| `packages/shared/src/parsers/nft.parser.spec.ts`, `packages/shared/test/synthetic-tec-expired-accept.ts` | `f4789b5` | the expected events of every recorded case (`test/unit/nft-fixtures.test.ts` writes them down again), and `synthetic-tec-expired-accept` |
| `apps/api/src/nft/nft-collections.service.ts`, `apps/api/src/nft/nft-sales.service.ts` | `d0c1ab0` | the collections list's order (the value of the sort, then issuer and taxon ascending, whichever way it runs) and its marker `[value, issuer, taxon_key]`, the lists of a collection (its NFTs by serial then id, `[serial, nft_id]`; its holders by `held` descending then owner, `[held, owner]`; its sales and the network's by `(ledger_index, tx_index, event_index)`), the stats' days (`toCollectionDayObject`'s average and lowest price) |
| `packages/shared/src/aggregate/nft-collections.job.ts` | `ae3af9a` | what a collection row counts: `supply` the NFTs not burned, `holders` the distinct non-empty owners of those, `minted` and `burned` the mint and burn events, `first_mint` and `last_mint` the oldest and newest mint (left out with none), `sales_count` every sale, `volume_native` the converted prices summed, `last_ledger` the newest event |
| `apps/api/src/network/volume-object.ts` | `d0c1ab0` | the NFT volume's row: a component for each collection with a rated sale (`issuer, taxon?, count, amount, rate, converted_amount`, `rate` `1.0000000`, the largest first), the row's `count` every sale of the window, its `total` the components' sum |
| `docs/api-reference.md` ("NFTs", "Coverage") | `da5ce14` | the key orders, the coverage rules, the examples the tests compare with |

The amendments the port has: a failed (`tec`) transaction gives only its deleted `NFTokenOffer` nodes, each an `offer_removed` by `other` (rippled deletes the expired offers a failed
accept met; the recorded Xahau `URITokenMint` that failed, `tecINSUFFICIENT_RESERVE`, touches no URIToken and gives no event); the before ids of a modified or deleted `NFTokenPage` are
its `PreviousFields.NFTokens` when it has them, else its `FinalFields.NFTokens` (the neighbour of a split changes only a link); `removed_by` is named by the removing transaction
(`sale`, `burn`, `transfer`, else `other`); an MPT amount skips its event and counts it; an `Amount` added to a URIToken, which is not in `PreviousFields`, is an `offer_create` only in a
`URITokenCreateSellOffer`, and a `URITokenMint` whose entry leaves out a native zero offers it at the transaction's `Amount`. What is not ported, because no fixture reads it: the
roles an event gives an account (the account history, `GET /v2/accounts/{address}/nft_history`, which no page shows), and the owners an NFT ever had.

Where the port differs from the data API: **a sale in an issued currency has no `converted_amount`** (the data API converts it at the issued asset's rate of the day, `native_rates_daily`,
which the recordings do not give: the XRPlay and EVR sales are the "no rate that day" state), and a sale in the native currency is its own price.

What the recordings give: XRPL 275 NFTs and 295 events (131 offers created, 137 cancelled, 12 mints, 7 removals, 4 sales, a transfer, 2 burns and a modify), Xahau 18 URITokens and 26
events; with the synthetic parts below, 282 NFTs (275 + 3 + 4) and 388 events on XRPL, 24 (18 + 2 + 4) and 113 on Xahau. 12 of the recorded XRPL NFTs and 4 of the Xahau ones start with
their mint (19 and 10 with the holdings and the traded NFTs below): the others' histories start in the middle.

### The files

| Files below `http/<net>/` | What |
|---|---|
| `data-api/nfts/<ID>.json` | `{ result, coverage, nft }` for each NFT |
| `data-api/nfts/<ID>/history@descending=true&limit=20.json`, `…&event=mint,burn,modify,sale,transfer&limit=20.json` (each also `…&marker=<M>.json` when it has a second page) | the whole history, and the history without the offer events (what the NFT page asks for unless it shows them), newest first, 20 to a page; a marker is the base64url JSON `[ledger_index, tx_index, event_index]` of the last row |
| `data-api/nfts/<ID>/offers@limit=50.json` | the open offers (an empty list for an NFT with none) |
| `data-api/accounts/<A>/nfts@limit=20.json` | the NFTs an account holds, ordered by collection (issuer, taxon) and serial, a last sale without `converted_amount` (D3's list rule); for the three hand-written accounts of each network, empty for the deleted and the never-funded ones |
| `data-api/nft_collections@limit=20&sort=<volume\|supply\|holders>[&descending=false][&marker=<M>].json` | the collections list: every collection, in each sort, descending and (with the text `descending=false`, C2) ascending, 20 to a page; XRPL 46 collections in 3 pages, Xahau 22 in 2; the marker is the base64url JSON `[sort value, issuer, taxon]` (the taxon 0 on Xahau) |
| `data-api/nft_collections@issuer=<I>&limit=20&sort=…[&descending=false].json` | the list filtered by issuer, for each sort and way: the featured NFT's issuer (two collections on XRPL, one on Xahau) and an account that issued none (`NFT_ACCOUNTS.unfunded`: `total: 0`) |
| `data-api/nft_collections/<issuer>[/<taxon>].json` and below it `stats@end=<T>&start=<W₀>.json`, `sales@descending=true&limit=20[&marker=<M>].json`, `nfts@limit=20.json` (also `include_burned=true&limit=20` for the featured one, and `limit=20&owner=<A>` for each), `holders@limit=20.json` | the three collections that have a page of their own: the featured NFT's, one that was never sold and one that was ("The cases of the pages"); the collection, its 30 days of stats, its sales newest first, its NFTs by serial (a last sale without `converted_amount`, C10), its NFTs held by the active account (C12), its holders |
| `data-api/nft_sales@descending=true&limit=10.json`, `…&limit=20[&marker=<M>].json` | the sales of the network, newest first: the list page's ten (its marker, the one "Older sales" carries), the pages of twenty from the start, and the pages of twenty behind the ten's marker |
| `data-api/network/nft_volume@live=day.json`, `…@live=7day.json`, `…@live=30day.json`, `…@end=2026-10-17&interval=day&limit=1000&start=2026-09-18.json` | the NFT volume: the three rolling periods to the minute of T's close (2026-10-17T17:01:00Z on XRPL, 17:47:00Z on Xahau), and the 29 computed days of the 30 to T (not the running day) |
| XRPL `node/nft_info/<ID>.json`, `node/nft_sell_offers/<ID>@limit=50.json`, `node/nft_buy_offers/<ID>@limit=50.json`; Xahau `node/ledger_entry/<ID>.json` | the nodes' answers below |

1,349 files, 1,008,932 bytes (about 0.96 MiB, under the budget of 1.0 MiB): XRPL 1,195 files of 756,075 bytes (1,129 of 282 NFTs, 575,554 bytes: a detail, two histories and the offers each, and
the featured NFT's second page; 58 aggregates, 175,404; 3 account lists; 5 node answers), Xahau 154 of 252,857 (97 of 24 NFTs, 123,307; 52 aggregates, 125,981; 3 lists; 2 node answers). Of the
aggregates, the collections lists are most (XRPL 30 files of 92,177 bytes, Xahau 24 of 52,955). They
are `isNftGenerated` in `scripts/http-fixtures.ts`, which `isHandWritten` leaves to the generator (an account's directory is hand-written, but for its analytics answers and these), and they
have a size budget of their own in `test/unit/http-fixtures.test.ts` (at most 1.0 MiB, outside the recorded files'). A row of a list is a line (`fixtureText`'s `rowLists`: `events`, `offers`,
`nfts`, `collections`, `sales`, `holders`, `days`, `rows`).

**Coverage.** A per-NFT file (the detail, the history with and without the offer events, the offers) has D3's item coverage over the recorded world: `from_ledger_index` is the first
recorded ledger of the set (XRPL 107874617, Xahau 26533927; D3 never sends `{ complete: true }` alone) and `complete` is whether the NFT's first indexed event is its mint
(`itemCoverage`). **Every other answer of a network agrees** (C5 and the ruling on Task 5's fourth concern): the aggregates (the collections, a collection and its lists, the sales, the
volume), an account's NFT list, and the upstream mock's empty page for an address with no file (`NFT_COVERAGE` in `test/support/upstream-core.ts`) all carry the feature's coverage,
`FEATURE_COVERAGE` in `scripts/nft-fixtures.ts`: XRPL `{ from_ledger_index: 32570, complete: true }` ("a feature as old as the network" in D3's "Coverage": the network's first ledger,
32,570), Xahau `{ from_ledger_index: 26533927, complete: false }` (D3 would need its ledger 1), so that both states are drawn. D3 itself would not mix XRPL's complete feature coverage with
the incomplete per-NFT coverage the item rule gives over these recordings (which start at 107874617): the two never meet in one D3, so the XRPL files are invented answers in that respect;
`test/unit/nft-fixtures.test.ts` checks that every file of a network says the same and compares the mock's page with the files'.

### The synthetic parts (seeded with `mulberry32(seedOf(<net>, "nfts", <what>))`, `scripts/synthetic.ts`)

- **The featured NFT** (`brokered_sale_royalty`'s on XRPL, `00190BB8…E96F`; `uritoken_buy_above_ask`'s on Xahau, `96133366…AAE9`) has older offer events (`"padding"`) before its first recorded
  one, so that its history has two pages (no recorded NFT has more than three events: Ruling 6) and its `marker` file exists. Each has a place of its own in one of the
  recorded ledgers before the sale (a random ledger, its time the ledger's close time, its hash drawn; the transaction index is the place's, below). XRPL, 24 events: ten offers made and cancelled
  (four sell offers of the seller relisting it, six bids), two bids that stay open (the first expired an hour after it was made, which is before the recordings end; the second lasts a
  year), and last the creation of the two offers the recorded sale removed, with their recorded owners, amounts and destinations: the history then has 27 events (20 and 7) and the offers
  file the two open bids; the filtered history is the sale alone. Xahau, 20 events: the owner listing the token, relisting it and cancelling the offer, ending with the offer at 4,200 XAH
  that the recorded sale removed (a URIToken has one sell offer, all of its events name the token as the offer, so none is open after the sale): 22 events, 20 and 2.
- **The active account's holdings** (C12; `"holdings"`): the account of `holderCase` (`rBbW6id…` on XRPL, `rHktfGU…` on Xahau) has no NFT in the recordings, so its list and the NFT pages of
  what it holds are seeded, each NFT with a history of its own in the recorded ledgers. XRPL, three: two of the featured NFT's collection (one minted by its issuer, listed for 20 XRP and
  bought by the account, the issuer being the seller so no royalty; one minted to the account), and one the account issued itself (taxon 7) and changed the URI of. Xahau, two: a token
  of the featured token's issuer, minted, listed at 1,500 XAH and bought by the account, and one the account issued itself. Their ids are computed (XRPL `encodeNftId`; a URIToken's
  is the SHA-512Half of `0x0055`, the issuer and the URI, which every recorded token's is), their URIs are `https://nft.example/…` (and `odinseyes:raven:v2:00…` for the issuer who
  uses it), their digests drawn.
- **The places of the synthetic events** (a review finding of Task 5, done here): a synthetic event goes in a recorded ledger at a transaction index **no recorded transaction has**, the
  next one past the ledger's own transactions (the ledger's count, then one more for each place the world has given in it, whichever NFT it is for: `drawSlots`), so that
  `(ledger_index, tx_index, event_index)` is a unique key over every NFT of the world and a `(ledger_index, tx_index)` is one transaction, with one hash, whichever NFT's event names it
  (the events of one transaction, an offer's removal and the sale that took it, share a place and a hash). The sales lists, which join the NFTs' events on that key, need it. Task 5 drew
  the index among the ledger's own, which could be one a recorded event had; the generator was changed, so the featured NFT's padding and the holdings have other indexes (and every
  draw after the first has moved: their hashes, amounts and offers are others), the featured NFT's second page of history is behind another marker (its file was renamed), and the
  files were regenerated. `test/unit/nft-fixtures.test.ts` ("the places of the events") checks the key, the hash and the indexes.
- **The featured collection's traded NFTs** (`"traded"`): so that the featured NFT's collection has a list of sales with a page behind its marker (the recordings give it two sales, the
  holdings one) and the network's has a second page, four more NFTs of the collection change hands. XRPL: siblings of the featured NFT (serials 11, 13, 15 and 17 below it, its flags and
  3% transfer fee), minted to the issuer, listed by their owner and bought, 4, 5, 5 and 5 times (19 sales; each sale is three events: the offer, its removal and the sale, so 14 to 16
  events an NFT, one page of history), by six accounts that buy more than one of them; the royalty (D3's `royaltyOf`) is there from the second sale on, the issuer being the first seller;
  the second NFT's third sale is priced in the XRPlay token, which has no rate (a sale in no volume), and the one with four sales is burned by its owner after them, so that the collection
  has a burned NFT. Xahau: the same for URITokens of the featured token's issuer (their ids from their URIs, burnable, the token's one offer named by every event), the third sale of
  the second priced in EVR. Their sales are in the newest of the recorded ledgers, after the newest sale of any other collection, so the newest sales of the network are the featured
  collection's: its sales list and the network's have the same first twenty rows, and one marker leads to the second page of both (`salesMarker`).
- **The synthetic collections** (`"collections"`): the list has the world's collections (XRPL 26, Xahau 15, each counted from its NFTs and their events by D3's rules) and some made up,
  XRPL 20 and Xahau 7 (46 and 22 in all), so that the list has more than a page and the sorts have a long tail and ties: a supply from a tier (1 to 25,000, a third exactly the tier's, so
  that several share it), holders at most the supply, burned NFTs, an average price from a tier (1 to 400 coins) and a quarter of them unsold (a volume of 0), minted before the index
  began (no indexed mint, no `first_mint` and `last_mint`) or with the mints in the recorded ledgers, a last ledger there too. The first synthetic collection of XRPL is another taxon of the
  featured NFT's issuer, so that the filter by issuer finds two. A collection that is made up has no page of its own, and no NFT of it is in the files: its link is the 404 `collection
  not found`. The list has 46 and 22 collections where the plan said about 60 and 12: the world's own are 26 and 15, and the budget (1.0 MiB) is the other bound.
- **The days of the stats** (`"days"`): the recordings are dated after T, so none of a collection's events is in the 30 days to T; each of the three collections' sales, mints and burns is
  moved into the window, to a day drawn for it, so that the days add up to the collection's own totals (sales, volume, mints and burns). The featured collection's days are drawn so that the
  average and the lowest price of a day, which the collection page's 30-day figures and chart read, are put to work (E8 Task 9; a day with one sale has an average equal to its lowest price):
  every day with an event is a row and every row has an event, three days have several (one with two rated sales, one with a rated sale and a sale in an issued
  currency, which has no rate, so that `sales_count` is 2 and the average is over the one price, and one with two rated sales and a mint; the two rated sales of the first and of the third have different prices, so that the lowest price is less than the average), and the days with no row (6, never the first or the last, which are
  2026-09-18 and T) are the days that those three took from the events. The two other collections' few events are on days drawn the same way, a sale in an issued currency alone on its
  day: a row with `sales_count: 1`, `volume_native: "0"` and no price.
- **The volume** (`"volume"`): a model of sales over the 31 days to the minute of T's close for the most traded collections of the list (XRPL 6, Xahau 5; 32 sales to the first, fewer to
  the others), at times and prices around each collection's own average price, one in sixteen priced in an issued currency, which has no rate. Every row is a view of it: the live
  periods count the sales since their start (so the 7-day row has the day's, the 30-day row the 7-day's), and each day of the window up to the last the route has computed (the newest
  ledger closes after 01:00 UTC, so the day before T; the running day is not there) counts its own. A component is a collection's rated sales; the row's `count` is every sale, so it can
  be more than the components'. Its collections are the list's, but its sales are not the NFTs': they are a market the NFT files do not hold (as the days of the stats are dated before
  the recordings), and not part of the collections' totals.
- **The hand-made node answers** (`"node"`), in Clio's and xahaud's shapes with `validated: true`: XRPL `nft_info` of the NFT without an owner (`sell_offer_create`'s, `00081388…B54B`:
  the node's owner is the owner of its sell offer, the only account that could have made one, and its `ledger_index` is before the index began; its URI is made up); `nft_info`
  of a token of the recorded `NFTokenPage` nodes that no event of the index names (the first by id with a URI, `00010000…02FD`: its owner is its page's, its `ledger_index` the
  recorded ledger of the page, its URI the page's) with one `nft_sell_offers` and one `nft_buy_offers` offer (made up: 60 XRP asked of one account; 47.7 USD bid until 5 days after
  the recordings end); and `nft_info` of a burned NFT the index has never seen (`is_burned: true`, a made-up serial of the collection `rGxWAW…` with taxon 500, no URI). Xahau
  `ledger_entry` of the unowned URIToken (`uritoken_sell_offer_create`'s, `35B8D528…E93D`: owner of its offer, the offer in drops, the digest of its events, a made-up URI) and of a token
  the index lacks (the featured token's issuer's, owned by an account of the recordings, no offer). Anything else the node answers `objectNotFound` (XRPL) or `entryNotFound` (Xahau),
  as `test/support/upstream-core.ts` does. Xahau has no burned counterpart: a burned URIToken is no ledger entry, so `network-burned` is XRPL's alone.

### The cases of the pages

`test/support/nft-cases.ts` (`nftCase`, `holderCase`) finds an NFT of each case in the committed files by the predicates of `test/support/nft-case-rules.ts`, never from a table of ids; the
unit test checks that they resolve to the NFTs of D3's cases:

| Case | Rule | XRPL | Xahau |
|---|---|---|---|
| `featured` | the NFT with a second page of history | `brokered_sale_royalty`'s | `uritoken_buy_above_ask`'s |
| `burned` | burned by the account that held it, the shortest history first | `burn`'s | `uritoken_burn_with_offer`'s (Xahau has no `burn` case: its other burned tokens were burned by their issuers) |
| `unowned` | indexed with no owner, not burned, and the node has it | `sell_offer_create`'s | `uritoken_sell_offer_create`'s |
| `network` | the node has it, the index does not | the recorded page's token | the made-up token |
| `network-burned` | the node says it is burned, the index has never seen it | the made-up burned NFT | none |
| `missing` | no file anywhere: the featured NFT's collection's next serial (XRPL), its id with another last digits (Xahau) | | |

`collectionCase(net, which)` in the same file finds a collection by `resolveCollectionCase`, from the collections that have a page of their own (`data-api/nft_collections/<issuer>[/<taxon>].json`)
and the featured NFT, and `collectionsMarker(net)` and `salesMarker(net)` read the `marker` of the first page of the collections list (`limit=20&sort=volume`) and of the sales
(`descending=true&limit=20`): the one that leads to the second page. The generator picks the three collections by their data, and the rules find them again in the files:

| Case | Rule | XRPL | Xahau |
|---|---|---|---|
| `featured` | the featured NFT's collection | `rLxc1b…/0` | `rodinG…` |
| `quiet` | a collection never sold (so none in 30 days) that has a holder, of the fewest NFTs the generator takes (6 at most) | `ravC5c…/0` (3 NFTs, one of them burned, one holder) | `r4k1jd…` (the token burned and minted again) |
| `other` | a collection that was sold, of the most sales | `r4PP7g…/10` (one sale, 10 XRP) | `rNk6oe…` (one sale, in EVR: no converted price) |

**What keeps them true.** `test/unit/nft-fixtures.test.ts` checks the port against D3's expected events of every recorded case (15 XRPL and 8 Xahau cases, and the non-case
transactions D3's spec names), D3's rules over every transaction of the recordings (the counts of its FINDINGS), the controller rulings one by one (`synthetic-tec-expired-accept` as a
`deriveNfts` case, a failed transaction, an `AccountDelete`'s removals, a deleted page that merged forward, a link-only page, MPT amounts, the URIToken offer gate and a free mint's
offer, the royalty's rounding), the fold, the open offers, the coverage, the featured NFT's pages and padding, the holdings, the reference's key orders on the objects before
serialization, the client's shape checks on every answer, the cases, and that `isNftGenerated` names the files and nothing else; for the aggregates, that each list's pages
concatenate to every collection once in the sort's order with ties by issuer and taxon (and each marker is `[value, issuer, taxon]` of the page's last row), that a collection's row is what its
NFT files' events count, that the three collections' lists and days are their NFT files', that the sales lists are every sale of the NFT files newest first (and the featured collection's first
page is the network's), that the volume's rolling rows nest and its rows are sums of their components, that every file of a network has the network's coverage, and the places of the events.
`test/worker/nft-fixtures.spec.ts` reads them in the Workers runtime with the data API client and the node client, the requests being theirs (the ascending lists by the text `descending=false`). `scripts/http-fixtures.test.ts` fails when a file is not what the generator writes.

## Ledger object answers: `http/<net>/data-api/escrows/`, `…/checks/`, `…/payment_channels/`, `…/ledger_objects/`, their transactions, and the nodes' `ledger_entry`

The data API's answers of D5 (`GET /v2/escrows/{id}` and its `/history`, the same for checks and payment channels, `GET /v2/ledger_objects/{id}`) for the ledger-object pages (E10), the
transactions behind them, and the nodes' `ledger_entry` of the objects still in the ledger. Not recorded: worked out from the objects ledgers D5 recorded (`ledgers/xrpl-objects/`,
`ledgers/xahau-objects/`, above), as D5's index would hold them, around some synthetic objects and transactions below. Generated by `generate()` (`pnpm fixtures:sync`), from
`scripts/object-derive.ts` (the port) and `scripts/object-fixtures.ts` (the files), which `scripts/http-fixtures.ts` joins per network. The ledgers are read through `readLedgerSet`
and are not among `SETS`, so `last_validated` stays where it was. **Every answer is as of the newest ledger of its set** (XRPL 107972102, 2026-10-29T03:50:41Z; Xahau 26399329,
2026-10-09T12:49:32Z: D5's "as of" and the close time a `status` is worked out at), which is newer than the explorer's head on XRPL (107721455), as D5's examples are.

### The port

E10's `PIN` is `0c2e58c3995cb3fdc240c3bf89dea9c4ab1e8adb`, D5's `feat/explorer-data-2` (data-api-new), read with `git show <PIN>:<path>`, never checked out or imported:

| Path at `PIN` | Last changed in | For |
|---|---|---|
| `packages/shared/src/parsers/object-changes.parser.ts` | `0ba8fb1` | the rows (D5 §2.1, §2.2): a row for every created, modified (with `PreviousFields`) or deleted `Escrow`, `Check`, `PayChannel` or `Delegate` node, its event by the table (`update` else), its stored fields without the thread and directory fields, the facts it takes from the transaction (`sequence`, `fulfillment`, `delivered`) |
| `packages/shared/src/ingest/build-rows.ts`, `packages/shared/src/parsers/parser.interface.ts` | `2e7fbc8`, `0c2e58c` | the columns a row gets from its transaction: place, hash, close time, type, result, sender (the zero account for an empty `Account`), `Delegate` |
| `apps/api/src/ledger-objects/object-views.ts` | `ef6674b` | the objects and events, their key orders, the keys left out (`compact`), the amounts (drops to whole units, an issued token as on the ledger, an MPT as the data API's MPT amount), a channel's zero balance, `remaining` and the changes |
| `apps/api/src/ledger-objects/object-status.ts` | `ef6674b` | the status at the answer's close time, and a deleted object's by its deleting event |
| `apps/api/src/ledger-objects/ledger-objects.service.ts`, `object-answers.ts` | `8d3da27`, `e33c538` | which rows a detail reads (the newest 51, each transaction once) and its creation (the page's, else the object's first), a history page after a marker, a channel's `funds` and `claims` over its whole history, the lookup (the newest row of an ID) |
| `apps/api/src/common/feature-coverage.service.ts`, `apps/api/src/common/pagination.ts` | `86391c4`, `d0c1ab0` | `itemCoverage` (the feature's coverage, complete when the object's creation is indexed), `paginate` and the marker (base64url JSON `[ledger_index, tx_index]`) |
| `packages/shared/test/synthetic-delegated.ts`, `packages/shared/src/parsers/object-changes.parser.spec.ts` | `e173d8e`, `af4e631` | `delegatedFrom` and `delegate_set_empty`, which C9's synthetic transactions follow (below) |
| `docs/api-reference.md` ("Ledger objects") | `0c2e58c` | the key orders, the rules, and the examples: the six object answers, the two lookups and Xahau's delegations of an account are real answers over these recordings, and `test/unit/object-fixtures.test.ts` compares the files with them, text for text |

What the recordings give: XRPL 217 objects in 221 rows (201 escrows, 191 of them cancelled and one finished without their creation indexed, nine checks, six channels and the one
delegation), Xahau 9 in 12 rows. The index leaves 190 of XRPL's cancels out (below): it holds 27 objects in 31 rows. **Coverage** (C8): the feature's coverage is the set's first ledger, not whole (`{ from_ledger_index: 102145584 | 8852809, complete: false }`: both
networks had these objects before the recordings), and an object whose creation is indexed has it complete; one created before has no `created` (escrow `8993DA09…`, finished in
107670360, is the reference's example of it). **One open recorded escrow and one open check** (the first of each by ID, `0F0EE149…` and `24BC04C8…`) have a node file and no index file
(no answer, no lookup): the node fallback (`escrow-node-only`, `check-node-only`).

### The files

| Files below `http/<net>/` | What |
|---|---|
| `data-api/escrows/<ID>.json`, `data-api/checks/<ID>.json`, `data-api/payment_channels/<ID>.json` | the object as of the set's newest ledger and its newest 50 events, newest first, with `history_marker` when there are more |
| `…/<ID>/history@descending=true&limit=50&marker=<M>.json` | the events behind each marker, newest first (the object page asks a page of 50 behind a marker); only `channel-long` has any |
| `data-api/ledger_objects/<ID>.json` | `{ result, ledger_object }` of every ID of the index (a delegation's too), and of the delegations the hand-written files list |
| `data-api/transactions/<HASH>.json`, `…@binary=true.json` | the transactions with a row of the index, a `Delegate` field or of type `DelegateSet` (C3), but those `generate()` serves already from `SETS`, and the synthetic ones (the synthetic objects' 10, not `channel-long`'s, and C9's 4); made as the sets' transactions are made, the binary form re-hashing to the hash |
| `data-api/ledgers/<index>@transactions=true.json` | the hashes of a ledger of those transactions that is not among `SETS` (XRPL 16, Xahau 12), in ledger order, which the transaction page reads for a transaction's neighbours, the synthetic transactions last |
| `node/ledger_entry/<ID>.json` | rippled's and xahaud's `ledger_entry` (`validated`, the set's newest ledger) of every object still in the ledger: its fields as its newest transaction left them, `Flags` and the directory pages a node fills in (`"0"`), a channel's zero `Balance`, and its thread (`PreviousTxnID`, `PreviousTxnLgrSeq`); Ripple-epoch times, drops |

268 files, 753,396 bytes (about 0.72 MiB, under the budget of 1.0 MiB): XRPL 210 files of 585,186 bytes (32 answers and 2 history pages, 90,077; 38 lookups, 10,320; 24 node
entries, 22,353; 49 transactions and their binary forms, 244,388, of which the synthetic objects' 10 are 18,294; 16 ledger lists, 218,048), Xahau 58 of 168,210 (9 answers, 9
lookups, 4 node entries, 12 transactions and their binary forms, 67,847, 12 ledger lists, 81,838). They are `isObjectGenerated` in `scripts/http-fixtures.ts` (`node/ledger_entry/` but
the NFT generator's URIToken entries, `nftLedgerEntryIds`, C5; and the transactions and ledger lists this generator writes), and have a size budget of their own in
`test/unit/http-fixtures.test.ts` (at most 1.0 MiB, outside the recorded files': C4). An object's events and an account's delegations are a row to a line (`OBJECT_ROW_LISTS`).

**The cancels left out** (the controller's ruling on Task 2's review). Ledger 106179366 holds 191 escrow cancels: the case `escrow_cancel` (a third party's cancel of `E81C0A08…`, the one
recorded cancelled escrow the index keeps) and 190 of the token-escrow testers, cancelling escrows created before the recordings. The index is left without those 190 (`leftOutOf`): no
row, no escrow answer, no lookup and no transaction file. They would be 190 escrows no case uses, with 0.9 MB of transactions behind their links, which the budget cannot hold (C4).

### The synthetic parts (XRPL, seeded with `mulberry32(seedOf("xrpl", "objects", <name>))`, `scripts/synthetic.ts`)

- **Objects** the recordings cannot give, each made of transactions written here and derived by the port as the recorded ones are (IDs are their keylets: an escrow's and a check's
  of owner and sequence, a channel's of owner, destination and sequence), each transaction in a recorded ledger that is not among `SETS` (whose lists are the recorded ones), at an
  index past the ledger's own (`placesOf`), with its type's fields, a fee and a `LastLedgerSequence` (no signature), the object's node as its metadata, and the hash of its
  serialization; each has a file, its binary form and its place in its ledger's list, so that every event's link opens (10 transactions), **but `channel-long`'s**: a paging fixture,
  its 120 events link to transactions that are not served and are in no ledger's list (`UNSERVED_SYNTHETIC`, a controller ruling: 250 KB of links nobody follows; made last, its
  places come after the others', so the lists have no gap). The active account (`rBbW6i…`,
  `OBJECTS_ACCOUNT`, test/e2e/fixtures.ts's `XRPL_ACCOUNT`) owns an escrow that can be cancelled (both its times passed, made in 107641123), one cancelled by its owner (made in
  107558036, cancelled in 107624182) and a channel asked to close (made in 107296498, claimed once in 107558036, its `Expiration` set in 107641123 a 30-day settle delay on), and is
  the destination of a check that expired a day after it was written (107641123): all four before the explorer's head (107721455),
  whose `account_objects` holds the three still in the ledger (C7). Others own an escrow pending until 2030 (no recorded XRPL escrow is pending at the as-of time), one that can be
  finished and has no `CancelAfter` (none is), an escrow of D5's synthetic MPT issuance (`0000012AB5F762798A53D543A014CAF8B297CFF8F2F937E8`, 250 units: none was found on the
  network, D5's FINDINGS (8)), and `channel-long`: created in the first recorded ledger and then claimed from (108 claims) and funded (11 funds) across 14 later ones, 120 events,
  so that its answer embeds 50 and two pages follow (50 and 20). The open ones have node entries too.
- **C9's transactions**, in the ledger of the recorded `DelegateSet` (107558036), at the indexes after its own (71 to 74), with files and appended to that ledger's list: a delegated
  `Payment` and a delegated `tec` (D5's `delegatedFrom` over the ledger's first successful XRP `Payment` between two accounts and its first `tec` `Payment`: the `Delegate`
  `rHb9CJAW…`, D5's `SYNTHETIC_DELEGATE`, pays the fee from a root appended to the metadata, the sender's balance keeps it), the `DelegateSet` with an empty list that deletes
  the recorded delegation (D5's `delegate_set_empty`, as the account's next transaction), and the same `DelegateSet` failed with `tecINSUFFICIENT_RESERVE` (its fee and sequence
  only). Their hash is that of their serialization (the binary form re-hashes to it), not D5's `syntheticHash`. They are not rows of the index: D5 never indexed them, so the recorded
  delegation stays as the reference has it (not deleted).

### Written by hand

- XRPL `node/account_objects/rBbW6i….json` (and its byte copy `…@limit=400.json`) gains the node entries of the three live synthetic objects (as their `node/ledger_entry/` files
  have them) and a `Delegate` (`Authorize` the first delegation given below, its three permissions), and `node/account_info/rBbW6i….json` its `OwnerCount` 4 (the trust line, the
  escrow, the channel and the delegation; the check is its sender's).
- XRPL `data-api/accounts/<A>/delegations@direction=given&limit=200.json` and `…held…`: `rBbW6i…` gives three (the Delegation board's: `Payment`, `TrustlineAuthorize` and
  `TrustlineFreeze`; eight; `TrustlineUnfreeze` and the two MPT locks) and holds two (`Payment`; `TrustSet`, `OfferCreate`, `OfferCancel`), its delegates' addresses drawn from
  `seedOf("xrpl", "objects", "delegations")`, the IDs their keylets, the times and ledgers on the board's days; the deleted account `r3Cger…` has none, and the never-funded one
  none with a coverage that is not whole. All as of 107972102 with the delegations' coverage, `{ from_ledger_index: 102145584, complete: true }` (the first ledger of the recordings
  is before the PermissionDelegation amendment). An account with no file is D5's empty page with the same coverage and ledger (`DELEGATIONS_AS_OF` in `test/support/upstream-core.ts`,
  C11; Xahau's is the reference's example).

### The cases of the pages

`test/support/object-cases.ts` (`objectCase(net, which)`) finds an object of each case in the committed files by the predicates of `test/support/object-case-rules.ts`, never from a table
of IDs; `test/unit/object-fixtures.test.ts` checks that they resolve, the first by ID of those a rule takes:

| Case | Rule | XRPL |
|---|---|---|
| `escrow-pending`, `escrow-finishable` | pending, of the native currency; can be finished | synthetic |
| `escrow-cancellable`, `escrow-cancelled` | can be cancelled, native, created indexed; cancelled, created indexed | the active account's (synthetic) |
| `escrow-finished`, `escrow-token`, `escrow-mpt` | finished with its creation; a token escrow with its creation; an MPT escrow | `FA8631A0…` (XRB); `1A137C89…`; synthetic |
| `escrow-incomplete` | finished, no `created`, coverage not whole (C8) | `8993DA09…` |
| `escrow-node-only`, `check-node-only` | a node entry of the type that has no answer | `0F0EE149…`, `24BC04C8…` |
| `check-open`, `check-expired`, `check-cashed`, `check-cancelled` | by status (open: native, created indexed) | `DA6BE164…`; synthetic (to the active account); `A13EFD94…`; `2C0D06B6…` |
| `channel-open`, `channel-closing`, `channel-closed`, `channel-long` | open with one page; closing by an `expiration`, created indexed; closed; more than one page (`markers`) | `E22CCE8F…`; the active account's (synthetic); `BA23FAA9…`; synthetic |
| `xahau-escrow`, `xahau-token-channel` (asked of Xahau) | an escrow in the ledger, native; a token channel | `B7083D00…`; `29FE7315…` (DHA) |
| `delegated-payment`, `delegated-tec`, `delegate-set-empty`, `delegate-set-failed` | the transaction (`id` its hash, `owner` its `Account`) | C9's |

**What keeps them true.** `test/unit/object-fixtures.test.ts` checks every answer, page and lookup with the client's shape checks (`app/server/object-shape.ts`) and the reference's key
lines, the reference's examples text for text, the statuses the recordings show, the coverage rule, each escrow's ID against its `EscrowCreate`'s created node and its keylet,
`channel-long`'s pages and markers, the synthetic objects and transactions, which transactions have a file and that each is at its place in its ledger's list, the cases, the
hand-written files against the generator's, that `isObjectGenerated` names the files and nothing else, and that a second run writes the same bytes. `scripts/http-fixtures.test.ts` fails
when a file is not what the generator writes.

## Token answers: `http/<net>/data-api/tokens@…` and `http/<net>/data-api/tokens/…`, with the featured tokens' pools files

The data API's answers of D6 (`GET /v2/tokens`, `GET /v2/tokens/{token}`, its `/holders` and its `/transfers`) for the token pages (E11). D6 has no deployment yet, so nothing here is recorded:
`scripts/token-fixtures.ts` generates them, `generate()` joins them per network, and `pnpm fixtures:sync` writes them with their keys in D6's order (`builtFixtureText`, not `fixtureText`, which
sorts them; a row to a line). They follow D6 at data-api `feat/explorer-data-2` commit **2fb4183** (2fb4183721af6df58dd345f4a6ef90a293ae70b0): its `docs/api-reference.md`, section "Tokens", and its
spec `docs/superpowers/specs/2026-10-24-issued-tokens-design.md`.

**Every answer** says the coverage `{ from_ledger_index: <the first recorded ledger of the network>, complete: false }` (XRPL 93663334, Xahau 26540187), and the list, the detail and the holders
are as of the newest recorded ledger (XRPL 107721455, 2026-10-17T17:01:12Z; Xahau 26596843, 2026-10-17T17:47:11Z). The upstream mock answers a token without a file as D6 does: 404
`token not found` for it and its holders, and for its transfers a 200 with no rows and that coverage (D6's transfers never answer 404). Its list without a file stays a missing route.

| Files below `<net>/data-api/` | Holds | Kind |
|---|---|---|
| `tokens@kind=issued&limit=20&min_holders=10.json`, `tokens@kind=issued&limit=20&marker=<M>&min_holders=10.json` | the 60 tokens with 10 holders or more, 3 pages | synthetic around the featured tokens |
| `tokens@kind=issued&limit=20[&marker=<M>].json` | all 100 tokens, 5 pages | the same rows |
| `tokens@kind=issued&limit=20&min_holders=10&q=USD.json`, `…&q=<an issuer>` | a search by its code and by an issuer (XRPL `rvYAfW…`, Xahau `rEvernode…`), ranked among what it selects, none behind the first page | the same rows |
| `tokens@kind=issued&limit=20&q=USD.json` | the search under `all=1`, the link of "more among tokens with fewer than 10 holders" | the same rows |
| `tokens@kind=issued&limit=1&min_holders=10.json` | the first row: a token page's 404 reads its coverage here | the same rows |
| `tokens/<CUR>.<issuer>.json` | each featured token: its toml, its issuer's settings, its markets | synthetic around real issuers |
| `tokens/<CUR>.<issuer>/holders@limit=10.json`, `…/holders@limit=50[&marker=<M>].json` | its holders, every one of them: the supply is their exact sum | real addresses of the recordings first, then seeded; balances, limits and flags synthetic |
| `tokens/<CUR>.<issuer>/transfers@descending=true&limit=20[&marker=<M>].json` | the payments that delivered it, newest first | derived where the recordings have them, seeded otherwise |
| `amm/pools@asset=<CUR>+<issuer>&limit=20.json` of USD, LIONS and TIN | the live pools holding the token, in the list's order (LIONS and TIN: none), which their token pages read beside RLUSD's existing file | derived: `scripts/amm-fixtures.ts`, `isAmmGenerated`, not this generator |

**The featured tokens.** Currency and issuer as the plan names them; the figures are made up.

| Network | Token | Issuer | What it is for |
|---|---|---|---|
| XRPL | `RLUSD` (`524C…`) | `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De` | a text code, listed with a full toml, clawback allowed, markets against XRP and two issued tokens; 96 holders, rank 1, a frozen one among the ten; a second page of transfers |
| XRPL | `USD` | `rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B` | a 3-character code, a transfer fee of `"0.2"`, a domain and not listed; 72 holders; a market with no native volume |
| XRPL | `LIONS` (`4C49…`) | `rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS` | no domain and no `issuer_settings`: the node's recorded `account_info` (above) serves them; a price in exponent form; 54 holders |
| XRPL | `TIN` | `rNwnk4Z6aDGGVcytB5NWeegHLZKbHRjdL3` (made up) | 4 holders, no price, no market, no domain |
| Xahau | `EVR` | `rEvernodee8dJLaFsujS6q1EiXvZYmHXr8` | listed, a price in XAH, a toml `icon` that is no `https:` URL; 88 holders |
| Xahau | `NOD` | `rsU3Rid6exHofd2D5xjewTJSYJe5QfKUiJ` (made up) | a domain and not listed, the issuer authorizes lines (`require_auth`), a price of the 30-day set (a time, no change, no market); 61 holders, ranks 50 and 51 tied on one balance, across the holders page's boundary (D6's tie, which the holder decides) |

The token pages' LP case is no file of these: it is the XRP/RLUSD pool's `lp_currency` and account, from the pools (`03B245BE…`, `rhWTXC2m…`), and D6 has no such token. The cases are found by their
rules in `test/support/token-case-rules.ts` (`rlusd`, `usd`, `lions`, `few-holders`, `lp`, `evr`, `xahau-unlisted`), never from a table, which `test/support/token-cases.ts` (the worker specs) and the
fixtures test share.

**Real, from the recordings** (the sets of `readLedgers`, not the NFT or objects sets): a featured token's first holders are the holders of its recorded trust lines, with a positive balance at the
end of the recordings, in the order they are first met (their balances are not the real ones), and `last_ledger` the newest ledger that changed one, or the newest of its transfers (a delivered payment changes a line). RLUSD's transfers are the newest 40 of the 61
recorded payments that delivered it (a successful `Payment` between two different accounts, its `DeliveredAmount` or else its `Amount`, its tags), so that a second page ends the list and every
marker has its file; EVR's first is its one such payment. USD and LIONS deliver nothing in the recordings (USD's are tec or to oneself), so theirs are seeded. The transactions behind the
transfers are not served, unless `generate()` serves them for another reason.

**Invented, and not checked against anything real:** the seeded tokens of each network (XRPL 96, Xahau 98) and their issuers (`r…` from seeded bytes, domains `*.example`), every count, supply, price, change,
volume, balance, limit and flag, the seeded transfers and their hashes, the tomls and the issuers' settings (RLUSD's domain `ripple.com`, USD's `bitstamp.net` and EVR's `evernode.org` are only words
on a card: nothing was read from them). Seeds: `mulberry32(seedOf(<net>, "tokens"))` for the seeded rows, and `seedOf(<net>, "tokens", <name>, "holders" | "markets" | "transfers" | "last_ledger")`
for a featured token (`scripts/synthetic.ts`). The first list page holds a price in exponent form (`"1.2000000e-7"`) and a row with no price, so the pages draw both; `totals.holders` is in every list.

**What keeps them true.** `test/unit/token-fixtures.test.ts`, over `generate()`'s files: D6's key lines in their order, and the client's shape checks (`app/server/token-shape.ts`) on every file;
ranks, markers against D6's three examples, and pages that concatenate; the tie; counts and totals against the rows; every search by D6's rule; every share against its balance and the supply, the supply against the balances; the
addresses; a token's page against its list row and its markets; transfers against the recordings; every case; the same output whatever the order. `isTokenGenerated` names the files, which have a budget
of their own in `test/unit/http-fixtures.test.ts` (0.3 MiB). `test/unit/amm-fixtures.test.ts` checks the pools files. `test/unit/upstream-core.test.ts` checks the mock's answers for a token without a file.

## Synthetic supply: `http/<net>/data-api/network/supply.json` and `http/xahau/data-api/network/supply/minted@…`

Nothing in these files is recorded or copied. The supply page (E12) reads two routes of D7, which the data API computes hourly from the whole history (the open escrows, the AMM pools, the
account states, the fees and the mints): no recording of a few ledgers can give them, so `scripts/supply-fixtures.ts` makes them up and `pnpm fixtures:sync` writes them (`generate()` in
`scripts/http-fixtures.ts` calls `supplyFixtures(net, last, snapshot)` for each network, after `validatorsFixtures`, and writes them with their keys in D7's order: `builtFixtureText`, not
`fixtureText`, which sorts them; the minted days a row to a line). They follow D7 at data-api `feat/explorer-data-2` commit **31e97efaa1a6e098435b666e8893c79a0c4bee66**, read with
`git -C ../data-api-worktrees/explorer-data-2 show 31e97ef…:<path>`, never checked out:

| | Repository, ref | Commit | For |
|---|---|---|---|
| `docs/api-reference.md`, `GET /v2/network/supply` and `GET /v2/network/supply/minted` | `data-api`, `feat/explorer-data-2` | `31e97efaa1a6e098435b666e8893c79a0c4bee66` | the answers' keys and their order ("Keys of …"), formats, the rules that tie one figure to another, the coverages of its two built examples |
| `docs/openapi.yaml` | the same commit | `31e97efaa1a6e098435b666e8893c79a0c4bee66` | `api/openapi.yaml` and `app/server/openapi.d.ts`, synced from this commit and not from the branch tip (plan Ruling C1) |

The client's types (`app/server/api-types.ts`, "Supply") and checks (`app/server/supply-shape.ts`) follow the same commit, and every file passes them.

| Files below `http/<net>/data-api/network/` | Holds |
|---|---|
| `supply.json` | **XRPL**: the snapshot at the recorded ledger **107,720,688** (closed 2026-10-17T16:11:02Z, about 50 minutes before `last_validated` 107,721,455 at 17:01:12Z, so the page does not call it stale), `computed_at` 107 s after the close; every figure and count of D7's XRP Ledger example (`total` `99985312374.716318`, `burned` `14687625.283682`, `escrowed` `35212847105.402318` in 12,879 escrows, `circulating` `64772465269.314`, `amm` `46218377.402915` in 14,594 pools, `reserves` `9810004` = 6,410,280 × 1 + 16,998,620 × 0.2). **Xahau**: the snapshot at the newest recorded ledger 26,596,843 (2026-10-17T17:47:11Z), `computed_at` 29 s after, D7's Xahau example's figures (`minted` `49425551.616207` = `rewards` `41203318.512207` + `import` `8102233.104` + `genesis_mint` `120000`; `burned` `2318.640227`; `escrowed` `18406227.318004` in 2,140 escrows; `circulating` `594995554.799302`; `reserves` `268973.2`; no `amm`) |
| `supply/minted@end=2026-10-17&interval=day&limit=1000&start=2026-07-20.json` (Xahau only) | the 90 days of the network page's window (`windowOf("2026-10-17", "90d")`), oldest first, one row each: rewards every day (25,000 to 35,000 XAH, six decimals), an import on about four days in five (500 to 8,000 XAH), `genesis_mint` `"40000"` on 2026-09-14 only, and the running day (2026-10-17) at about a third of a day's mint; `amount` the exact sum of the three; `count` 90, no `marker`, `coverage` `{ from_ledger_index: 1, complete: true }` |

The XRP Ledger mints nothing and its page does not ask for the days (spec 3.2: only when the snapshot has `minted`), so it has no minted file: a request for it gets the mock's answer for a route no fixture has, `Cannot GET`, a missing route.

**Coverages.** The built reference's, not those of D7's design spec §5.1 (plan Ruling C11): the spec's own note retracts them as ones that "cannot occur together" (the reserves starting above the
escrows). XRPL: `{ from_ledger_index: 28685313, complete: true }` for `escrowed`, `circulating` and `amm`, and `{ 28685313, false }` for `reserves`; its `burned` has none, as D7 leaves it out where
the network cannot mint. Xahau: `{ 1, true }` on every part and on the minted page. The page's note therefore reads "Since ledger #1" there.

**Seeds.** The minted days draw three numbers a day from `mulberry32(seedOf("xahau", "supply/minted"))` (`scripts/synthetic.ts`), whether the day uses them or not (the reward, whether the day has an
import, the import), so a day's amounts depend on its place in the window and on nothing else. Only integer arithmetic and the four IEEE operations are used on the numbers, BigNumber for the
text, so every Node writes the same bytes.

**Invented, and not checked against anything real:** every figure above (D7's examples are made-up figures "of a plausible day" themselves), the snapshots' ledgers' relation to them (the recorded
ledger 107,720,688 is real, its supply is not), `computed_at`, and the minted days. The 90 days add up to far less than the snapshot's `minted` (about 3.0 million XAH against 49 million): that total
is since ledger 1, the days are the last 90. The running day's third is a round figure: Xahau's newest ledger closed at 17:47, three quarters of the way through the day.

**What keeps them true.** `test/unit/supply-fixtures.test.ts`, over `generate()`'s files: D7's rules worked out again with BigNumber (`circulating` = `total` less `escrowed`, the reserves, XRPL's `burned`
= 100 billion less `total`, `minted` the sum of its sources, each day's `amount`), the figures and coverages of the examples, D7's key orders in the files, the snapshot's distance from `last_validated`, the
90 days of the window and the fees' (the same days), the one `GenesisMint` day, the client's shape checks on every file, and the same output twice. `isSupplyGenerated` names the files, which count against
the synthetic aggregates' size budget in `test/unit/http-fixtures.test.ts`.

## Synthetic names and tomls: `http/<net>/data-api/account_names.json` and `http/<net>/data-api/toml/`

Nothing in these files is recorded or copied. The display names (E9) read D4's two routes, which the data API builds from the operator's names and labels (ADR-0014), the
accounts' `Domain` and the tomls its `tomls` worker reads: no recording can give them, so `scripts/names-fixtures.ts` makes them up and `pnpm fixtures:sync` writes them
(`generate()` in `scripts/http-fixtures.ts` calls `namesFixtures(net, files)` for each network last, with every other file of the network, generated or written by hand). The
names are invented; the shapes, the key orders and the rule that picks a display name follow the data API:

| | Repository, ref | Commit | For |
|---|---|---|---|
| `docs/api-reference.md`, "Account names and tomls" | `data-api-new`, `feat/explorer-data-2` | `3feb11a` | the two answers: keys and their order, the 400 messages, `toml_url` on each network, what a definite failure carries, empty lists left out |
| `apps/api/src/names/display-name.ts`, `account-names-object.ts`, `toml-object.ts`, `account-names.controller.ts` | `data-api-new`, `feat/explorer-data-2` | `3feb11a` | `displayNameOf` (verified > account > domain; a `desc` of 1 to 64 code points, else the domain), the entry's and the toml's key orders, `parseAddresses` (which the upstream mock follows) |

Read with `git -C ../data-api-new show <commit>:<path>`, never checked out. The client's types (`app/server/api-types.ts`) and checks (`app/server/names-shape.ts`) follow the
same commit, and every entry and toml passes them.

**What is written.** `account_names.json` is `{ "<address>": <entry> }`, an entry to a line, sorted by address, only the addresses with something to show; the upstream mock
answers `GET /v2/account_names` with the entry of each address asked, or the address alone. `toml/<domain>.json` is the answer of `GET /v2/toml/{domain}`; a domain without a file
is `toml not found`. Every toml was checked (and an `ok` one read) at `2026-10-17T06:00:00.000Z`, the morning of T.

| Network | Address | Who it is | Name |
|---|---|---|---|
| XRPL | `rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh` | the active account | verified: `northpeak.example` (its `account_info` `Domain`, `6E6F…6C65`), whose `ok` toml lists it as "Northpeak Treasury", with the principals Mara Lindqvist and Tomas Okafor, `NPUSD` (2 decimals, "Northpeak Dollar") and `NPEUR` of this issuer, `modified` 2026-10-02 |
| XRPL | `r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC` | the deleted account | named by GateHub "Harborline Exchange", network name "hot wallet", label `advisory` ("Test label: withdrawals paused", source "GateHub", `https://status.example/harborline`) |
| XRPL | `rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ` | the active account's parent | label `spam` ("Test label") only |
| XRPL | `rURtT5MMFzSUR54MAq9MKfzBoezTBZbKns` | the deleted account's parent | domain not verified, `lowtide.example`, whose `ok` toml lists nobody; label `scam` ("Test label") |
| Xahau | `rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto` | the active account | verified: `tidewater.example` (`Domain` `7469…6C65`), "Tidewater Reserve", the toml as Northpeak's with `TWUSD` ("Tidewater Dollar") and `TWEUR` |
| Xahau | `rMoPk1MiYJbmdNL8xr5s11r7jrxzBhJWLD` | the deleted account | label `scam` ("Test label") only: a deleted account has no domain in D4 (plan Ruling 11) |
| Xahau | `rEvernodee8dJLaFsujS6q1EiXvZYmHXr8` | the accounts' parent | named by GateHub "Hookfield Labs", no network name |
| Xahau | `rJ5mvuNKjbjdghjCn5AGXXJFhJGgqdg9Q5` | an active account (it paid the active account in the newest recorded ledger) | domain not verified, `saltmarsh.example`, whose toml failed on a 404 (plan Ruling 11 moved it from the deleted account) |

**Generator and seeds.** The seeded addresses are the classic addresses of the files of `NAMES_SOURCES`, in its order (the hand-written accounts and balances, the eight newest
transactions, the served transactions, the accounts' first pages, the pairs' active accounts, the AMM pages, the validators list, the NFT sales, collections and NFTs, and last the token
lists, then the tokens' own files, each in order of its path), the fixed ones left out, up to 500: XRPL 500, where the cap cuts the tail (458 before the token files, then the list's 31 issuers
that were not among them and 11 holders of LIONS, the first token by path), Xahau 280. `fnv1a32("<net>:<address>") % 40` picks the state (0–7 verified, 8–12 named by GateHub, with a network name when bit 8 is set,
13–16 domain not verified, the rest nothing), and the hash the name (a word of 24 and one of 8) and the domain (the word and the hash's upper 16 bits in hex, `alder-1f2e.example`;
the generator fails on a domain two addresses would share). A verified domain's `ok` toml lists its account with its `desc` (the first by sort without one: its name is its
domain); every second unverified one by sort has an `ok` toml that lists nobody, the others none. An account the fixtures mark deleted (a transaction's `DeletedNode` of its
`AccountRoot`, an AMM pool the data API marks `deleted`, a hand-written account the node does not have: on XRPL `r3Cgerz…` and the SNK/XRP pool's `rGLnUK…`, on Xahau `rMoPk1…`)
gets no domain, so a seeded one is named by GateHub or not at all. XRPL: 109 verified, 53 named by GateHub (29 with a network name), 58 domain not verified, 280 nothing; Xahau: 48,
33 (19), 31, 168. Adding addresses moves the "first by sort" and the "every second by sort" among the others: E11's token files changed one name from its domain to its `desc` a network
and moved tomls of unverified domains, whose stale files were removed by hand as `pnpm fixtures:sync` reports them.

**Invented, and not checked against anything real:** every name, network name, label, domain, principal, currency and time, and the `Domain` of the two active accounts (the
recordings show none). No operator is implied: the names are fictional and the domains `*.example` (RFC 2606).

**What keeps them true.** `test/unit/names-fixtures.test.ts` runs the client's checks on every entry and toml, works D4's display-name rule out again for every entry, checks the
key orders on the objects before serialization, the fixed cases, the tomls of the verified domains, the seeded addresses and their shares, the deleted accounts, and the line
count of `account_names.json`; `test/unit/upstream-core.test.ts` checks the mock's composition of the names batch and its three 400s. `scripts/http-fixtures.test.ts` fails when a
file is not what the generator writes. `isNamesGenerated` names the files, and they have a budget of their own in `test/unit/http-fixtures.test.ts` (128 KiB a network).

## The API description: `api/openapi.yaml` and `app/server/openapi.d.ts`, synced from D9 (E14)

Not a fixture, and written here because the sync is a copy from the data API's repository that the explorer pins, as the ledgers above are. `pnpm api:sync` copies a data API checkout's `docs/openapi.yaml` and
generates `app/server/openapi.d.ts` from it; E14 syncs from D9's pin and not from the branch tip, which holds routes of later work (the rule of every plan since E11, and E14 Ruling C1):

| | Repository, ref | Commit | For |
|---|---|---|---|
| `docs/openapi.yaml` | `data-api`, `feat/explorer-data-2` | `c9a2fc0ffd41b3ad7e5b78fbb73b220f38700f30` (`PIN` of E14, read with `git show c9a2fc0ffd41b3ad7e5b78fbb73b220f38700f30:docs/openapi.yaml` into a scratch `docs/`, then `DATA_API_REPO=<scratch> pnpm api:sync`) | `api/openapi.yaml`, byte for byte, and `app/server/openapi.d.ts` generated from it |

The sync adds to E13's (D8's, `cbd6c51`) document: the five paths `/v2/accounts/{address}/mpt` (51 lines), `/v2/mpt`, `/v2/mpt/{issuanceId}`, `/v2/mpt/{issuanceId}/holders` and `/v2/mpt/{issuanceId}/transfers`
(168 lines for the four), so that the 99 `/v2` paths (and `/liveliness/healthz`) become 104; and the description edits that name MPT in five paths the document already had: the payments (`/v2/payments`
and `/v2/payments/{currency}`: an MPT payment has the issuance ID as its `currency` and `mpt_issuance_id` as its last key), the balance changes of an account and their analytics (the MPT balances, and
`clawback` among the change types) and `kind=mpt` of the tokens. The document has no response schemas (`components.schemas` is `{}`, as before), so no schema comes with the paths: the types of the MPT answers
are written by hand in `app/server/api-types.ts`. 340 lines of diff in `api/openapi.yaml` (285 added, 55 removed) and 255 in `app/server/openapi.d.ts` (245 added, 10 removed). No block moves, no path is lost and nothing of D8
is removed: `/v2/network/validators/countries` is still there. The explorer's client calls four of the five new paths (`PATHS` in `app/server/data-api.ts`; not the account's `/mpt`, which no page asks for)
and sends `kind=mpt` to `/v2/tokens`.

## MPT answers: `http/xrpl/data-api/mpt/`, `http/xrpl/data-api/mpt_lookup.json`, `http/xrpl/data-api/tokens@kind=mpt…`, the nine recorded transactions' files and `http/xrpl/node/ledger_entry/mpt_issuance_<ID>.json`

The data API's answers of D9 (`GET /v2/mpt/{id}`, its `/holders` and `/transfers`, `GET /v2/mpt?ids=` and `GET /v2/tokens?kind=mpt`) for the MPT pages and the token tab (E14), and the node's `ledger_entry` of an issuance the
index lacks. D9 has no deployment to record, so `scripts/mpt-fixtures.ts` generates them (`generate()` joins them for XRPL, after the token pages; Xahau has no MPT and no file), and `pnpm fixtures:sync` writes them with
D9's key orders (`builtFixtureText`, which sorts nothing: the keys of each answer are those of its "Keys of …" line of the reference, pinned by `test/unit/mpt-fixtures.test.ts` in the files themselves; the rows of the lists a
line each, `MPT_ROW_LISTS`). They follow D9 at data-api `feat/explorer-data-2` commit **c9a2fc0** (c9a2fc0ffd41b3ad7e5b78fbb73b220f38700f30): its `docs/api-reference.md`, section "MPT", and its spec
`docs/superpowers/specs/2026-10-17-mpt-data-design.md`, section 7; the metadata is decoded by a port of its `decodeMptMetadata` and `mptMetadataHexConforms` (`packages/shared/src/util/mpt-metadata.ts` at the same commit).

| Files below `xrpl/` | Holds | Kind |
|---|---|---|
| `data-api/transactions/<HASH>.json`, `…@binary=true.json`, `node/tx/<HASH>.json` (27 files, 83,659 bytes) | the nine transactions of `MPT_RECORDED` of D9's recordings (`ledgers/xrpl-mpt/`), served as every recorded transaction is (`dataApiTx`, `binaryTx`, `nodeTxResult`), but that the data API's JSON has no `mpt_issuance_id` in the metadata (it is the stored binary decoded again, which does not carry the key the node adds to a successful `MPTokenIssuanceCreate`: E14 ruling C10, a page reads the ID from the created node) | generator (derived) |
| `data-api/ledgers/<index>@transactions=true.json` (9 files, 63,039 bytes) | the hashes of the nine ledgers of those transactions, 747 in ledger order, which the transaction page reads for its neighbours. No plain ledger file: the pages do not ask for one | generator (derived) |
| `data-api/mpt/<ID>.json`, `…/holders@limit=10.json`, `…/transfers@descending=true&limit=8.json` (29 files with those below, 60,676 bytes) | the eight issuances that have an answer: `htf` and `shortKeys` are the recorded creates (the ID is the created node's; their ticker, name, scale, maximum, transfer fee and flags are what they were created with, their metadata decoded as D9 does, `metadata_conforms` as D9 judges it, `created_*` the recorded transaction's), the others made up | generator (derived and synthetic) |
| `data-api/mpt/<htf>/holders@limit=50.json`, `…&marker=<M>.json`; `…/transfers@descending=true&limit=20.json`, `…&marker=<M>.json`, and `…&limit=20&marker=<the 8th transfer's>.json` | `htf`'s 63 holders over two pages (50 and 13: one locked on its own, one with 1,250,000 in escrow) and its 28 transfers over two (20 and 8; plus the 20 behind the marker of the card's eight, rows 9 to 28, which its "Older →" opens): every kind of D9's seven, a lock and an unlock of every balance (no destination, the outstanding amount) among them, the transfer fee on top of a payment between two holders and none on a mint or a redemption, the newest five within a day of the newest ledger | generator (synthetic) |
| `data-api/mpt_lookup.json` (7,041 bytes) | `{ "<ID>": summary }` for the eight answered issuances and four that the recorded transactions touch (the mint, opt-in and clawback share `064E273A…`; the fee payment's `0598F6E0…`; the escrow's `0663EB64…`; the lock's `0663EACA…`): the mock composes `GET /v2/mpt?ids=` from it (E14 ruling C5; one table, because a file name has at most four IDs in it and each page's set of IDs differs). A summary of a recorded issuance is what the node in the recorded metadata says (`FinalFields`: scale, maximum, `OutstandingAmount`, fee, flags, metadata), and the lock's, whose transaction touches no issuance node, is made up around its ID; their `holders` are made up. `nodeOnly`, `nowhere` and E10's synthetic MPT escrow (`0000012AB5F7…`) are not in it, and are answered as the ID alone | generator (derived and synthetic) |
| `data-api/tokens@kind=mpt&limit=20.json`, `…&marker=<M>.json`, `…&limit=20&q=HTF.json`, `…&limit=20&q=zzz.json` (4 files, 12,353 bytes) | the MPT tab: 25 issuances over two pages (20 and 5), most holders first, then issuer, then ID (D9's order), the marker `["mpt", holders, issuer, id]` of the last row; the live issuances with a known state (not `destroyed`, not `nodeOnly`): the seven answered, the four of the lookup that have no page of their own, and 14 seeded fillers (invented tickers and names; none says HTF or zzz). Its totals are the whole kind's: 25 issuances, the holders about nine tenths of the rows' sum (accounts that hold several are counted once) and the payments of the day, the rows' sum. `q=HTF` finds `escrow`, "Harborline Treasury Fund" (the board's), whose coverage is not complete, and ranks it 1 among the match; `q=zzz` finds none. `coverage` is `{ from_ledger_index: 99226369, complete: true }` on the others | generator (synthetic) |
| `node/ledger_entry/mpt_issuance_<nodeOnly>.json` (2,168 bytes) | the node's `MPTokenIssuance` of `nodeOnly`: the recorded create's `AssetScale`, `Flags`, `MPTokenMetadata`, `MaximumAmount` and `TransferFee`, another sequence, the active account as the issuer, and an `OutstandingAmount` of 12,500,000; its key is rippled's (SHA-512Half of `0x007E` and the ID, checked against the recorded node). An issuance with no file (`nowhere`) is `entryNotFound` | generator (derived) |

**The issuances** (`MPT_FIXTURE_IDS`, `test/support/mpt-case-rules.ts`): `htf` (the recorded create of XAU), `shortKeys` (the recorded create with XLS-89's short keys; its decoded metadata has the long names, in D9's order),
and made up around seeded issuers (the classic addresses of seeded AccountIDs, so that no fixture names one: the names' sources leave these files out, ruling C4) `noMetadata`, `rawMetadata` (metadata that is a URL as text: it
does not decode, so there is no `metadata` and `metadata_conforms` is false), `nonConforming` (it decodes and conforms to nothing: a ticker in lower case, an asset class that is none, a 128-character name with no
space, a 200-character description, a 100-character title, and links of every kind an issuer can write, `javascript:`, `http:` and a bare host and path among them; E14 ruling C17), `destroyed` (no holder left),
`lockedAll` (the issuer locked every balance), `escrow` (HTF: holders with amounts in escrow and the three escrow kinds of transfer, its answers saying `complete: false`), `nodeOnly` (an issuance of the active account that
only the node has) and `nowhere` (nothing anywhere). The seven answered but `htf` have at most 8 holders and 8 transfers, so that the card's first page is all of them and no link leads to a file that is not there.

**What is invented, and not checked against anything real:** every holder, balance and transfer (hashes, ledgers, times: the ledger of a transfer goes back from the newest of the other sets, 107721455, at 4 seconds a ledger), the
counts of holders of the four issuances the recorded transactions touch, the 14 fillers, the sums the tab shows, and the answers' `last_ledger` (107721455). The balances of each issuance add up to its outstanding amount, below its maximum,
and the issuance's `escrowed_amount`, `locked_amount` and `locked_holders` are what its holders say (`test/unit/mpt-fixtures.test.ts`).

**By hand, for the active account** (`rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh`, E14 ruling C6): both `node/account_objects/<A>.json` and `…@limit=400.json` (byte copies) gain three entries after E10's five: an `MPToken` of `htf` (2,500,000
units and 500,000 in escrow, authorized) and one of the issuance of the recorded lock (`0663EACA…`: 45,000,000 units, `lsfMPTLocked` and authorized), and the `MPTokenIssuance` the account made, which is `nodeOnly`'s as the node
writes it; their keys are rippled's (SHA-512Half of `0x0074`, the issuance's key and the holder's AccountID, checked against a recorded node). `account_info` is untouched (`OwnerCount` 4), so these three are not counted in it.
The second page of its payments (`…&marker=WzEwNzYzNjY3Myw3OF0.json`) gains the `marker` of its last row (`WzEwMjE4NjI0Myw2M10`, `[102186243, 63]`) and a third page follows it with **one** MPT payment row, of the recorded
`payment_transfer_fee` (a transaction of two other accounts: no recording makes the active account a party of one, so the row is a payment in its list that it was not part of; `test/unit/http-fixtures.test.ts` skips the party check for
the nine hashes), its keys sorted as the other rows' are but `mpt_issuance_id`, last, as D9 has it, and its amounts the transaction's integer units. The plan asked for two rows; the other MPT payment of `MPT_RECORDED`, `payment_mint`
(ledger 105827909), is newer than the page it would follow, and the lists of the hand-written accounts are newest first across their pages (`test/unit/http-fixtures.test.ts`), so it has none. The first page and the page behind its marker are as they
were: `account.spec.ts` and the names' sources read them.

**What keeps them true.** `test/unit/mpt-fixtures.test.ts` runs the client's checks (`mpt-shape.ts`) on every answer, checks D9's key orders, the markers, the sums, the cases each issuance stands for, the lookup table against the recorded
transactions' IDs and the active account's page, and the hand-written files against the recordings; `test/unit/upstream-core.test.ts` checks the mock's composition of the lookup and its 400s and 404s; `scripts/http-fixtures.test.ts`
fails when a file is not what the generator writes. `isMptGenerated` names the files, and they have a budget of their own in `test/unit/http-fixtures.test.ts` (0.4 MiB: 71 files, 228,936 bytes).
