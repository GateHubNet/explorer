# Explorer program: network, markets, AMM, validators, amendments, account analytics

This page ties together the seven specs written on 2026-10-19 (plus one follow-up, D2b) for the owner's review. Each spec stands on
its own. This page lists them, gives the order they are built in, and records the decisions that cut across them. Every spec opens
with an **"Owner decisions to confirm"** table: the product choices and the deviations from the approved mock, one line each. Those
tables are the review checklist.

## The sub-projects

| # | Repo | Spec | What it builds | Needs |
|---|---|---|---|---|
| D1 | data-api-new | `docs/superpowers/specs/2026-10-19-validators-amendments-design.md` (branch `feat/explorer-data`) | Validator versions and manifest domains collected; a `validators` worker (UNL lists, domain checks, hourly agreement); a hand-kept amendment list; `/v2/network/validators[/summary\|/{key}[/validations]]`, `/v2/network/amendments[/{name}]` | — |
| D2 | data-api-new | `docs/superpowers/specs/2026-10-19-account-market-aggregates-design.md` (same branch) | Daily native rates; `/v2/accounts/{a}/analytics/{balances,balance_changes,counterparties,exchanges}`; `interval` on `stats/{family}` and `reports`; `/v2/network/markets` | D1 (migration order) |
| D2b | data-api-new | a section of the D2 spec | AMM share in the markets set, swaps in the account aggregates, 24 h AMM fee estimates, the range of computed AMM days | the owner merging `feat/amm-data` into data-api-new `main` |
| E2 | x-explorer | `2026-10-19-network-dashboard-design.md` | `/{net}/network`; the **shared chart kit**; the shared mechanisms (feature switches, `navSection`, `keepLoaded`, the "Cannot GET" rule, `Anchor`, `windowOf`, `typeGroups`, the failure hold) | existing API |
| E3 | x-explorer | `2026-10-19-markets-design.md` | `/{net}/markets`, `/{net}/markets/{base}/{counter}` (candles, trades, live order book); shared `asset.ts`, `paging.ts`, the `amm_info` reader, the `minute` class | D2 |
| E4 | x-explorer | `2026-10-19-account-analytics-design.md` | The account page's Analytics tab | D2 |
| E6 | x-explorer | `2026-10-19-validators-amendments-pages-design.md` | `/{net}/validators[/{key}]`, `/{net}/amendments[/{name}]`, the network overview tiles | D1 |
| E5 | x-explorer | `2026-10-19-amm-pools-design.md` | `/{net}/amm`, `/{net}/amm/{pool}` | `feat/amm-data` merged and deployed; D2b for two details |

The mock boards are in `2026-10-17-explorer-mock/`: Network, Markets, MarketPair, Amm, AmmPool (approved 2026-10-17), and Validators,
Validator, Amendments, Amendment, AccountAnalytics (approved 2026-10-19).

**Build order:** D1, D2, E2, E3, E4, E6, E5. Then D2b after the owner merges `feat/amm-data`. Each sub-project gets its own
implementation plan and a reviewed build in auto mode. Nothing is merged or pushed without the owner.

## Decisions that cut across the specs (made while cross-checking them; listed for the owner)

1. **One switch mechanism.** Every page or feature that is not ready everywhere yet has an on/off Worker variable per environment:
   `MARKETS`, `ACCOUNT_ANALYTICS`, `VALIDATORS`, `AMM_PAGES`, `AMM_DATA`. They are on locally and in tests, and off in staging and
   production until the data API there has what the feature needs. The pre-deploy guard checks them, and they are part of the edge
   cache key, so a flip never serves a page stored under the other value. An off page answers 404 and its links read "soon".
2. **One AMM signal.** AMM-derived figures and wording appear only while `AMM_DATA` is on. The owner turns it on for an environment once
   its data API has the AMM data merged, re-ingested and back-filled.
3. **One pair orientation.** Every page shows a pair the same way round (E3's natural orientation: XRP/USD, LIONS/XRP).
4. **The running bucket is included everywhere**, marked "so far". "30 days" is today and the 29 days before it, on every page.
5. **One set of transaction-type groups per network**, so a type keeps its colour from page to page. Xahau uses the network board's
   groups, which changes the analytics board's.
6. **The data API's AMM pieces wait for the AMM merge** (D2b). D2 neither depends on `feat/amm-data` nor edits it, and it carries a
   merge recipe for the owner.
7. **Dropped for now:**
   - pool counts, total value locked and pool rankings;
   - a per-swap fee and filtering pools by currency or issuer alone;
   - a Xahau USD view of the network page;
   - an "Other" row in payment volume;
   - the open-ledger queue capacity.
8. **D1 was widened before planning.** It now covers validator accounts from their verified `xrp-ledger.toml`, a link to each
   amendment's XLS document, and three smaller fields the pages need.

## Constraints for the owner

- **Deploy order of D1:** the AMM branch rewrites the first migration file in place, and the migration runner refuses a file whose
  checksum changed. A database created before that merge must therefore be recreated, which would lose the validator history D1
  collects (it cannot be recomputed). So deploy D1 to a lasting environment only after merging `feat/amm-data`, or accept the loss.
- **Production timelines:**
  - The AMM pages wait for the AMM re-ingest and back-fill, which the AMM branch estimates at weeks on mainnet without a node of our own.
  - D1's 30-day agreement and amendment charts fill over 30 days on a fresh database.
  - D2's 7-day and 30-day market sets need 31 days of trades.
- **New egress:** the syncer needs outbound HTTPS to validator domains, through a guarded fetcher.
- **Budgets:** every page's initial JavaScript must stay under 150 KB gzip. The analytics view (about 148 KB estimated) is the tightest.
  Each spec names its fallbacks.
- **Fixtures:** the explorer's aggregate fixtures are generated, not recorded; only an end-to-end run against a real stack checks
  them against real answers. D1 and D2 are built first, so the explorer's fixtures follow their built API reference.
