# Fixture provenance

Everything here was copied, byte for byte, from the `GateHubNet/data-api-new` repository (a sibling checkout,
`../data-api-new`), except `runtime/amm-deposit.meta.json`, which is one transaction's metadata cut out of a copied
ledger (it is identical to that transaction's `metaData`). Nothing is generated or edited by hand. The ledgers are mainnet recordings: each
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
