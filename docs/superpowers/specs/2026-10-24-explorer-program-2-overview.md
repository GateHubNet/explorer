# Explorer program 2: NFTs, names, ledger objects, delegation, tokens, supply, validators map, MPT

This page ties together the specs written on 2026-10-24 for the owner's review: one data API spec and one explorer spec for each of
eight features. Each spec stands on its own and opens with an **"Owner decisions to confirm"** table, which is the review
checklist. This page lists the specs, gives the build order, and records the decisions that cut across them.

The designs are the boards approved on 2026-10-24 in `2026-10-24-explorer-mock/` (the Explorer Design Mock). The words are the
glossaries' (`GLOSSARY.md` in both repositories, aligned on 2026-10-24: **display name**, **verified name**, **account name**,
**account network name**, **unverified domain**, **label**).

## The sub-projects

| # | Repo | Spec | What it builds | Needs |
|---|---|---|---|---|
| D-env | data-api | `docs/superpowers/specs/2026-10-24-testnet-profiles-design.md` | Network profiles for XRPL Testnet and Xahau Testnet | — |
| E7 | explorer | `2026-10-24-sandbox-environment-design.md` | "staging" renamed "sandbox"; real hosts; per-environment network facts; the Testnet badge | D-env |
| D3 | data-api | `docs/superpowers/specs/2026-10-17-nft-data-design.md` (revised) | NFT and URIToken events, owners, collections, sales, daily volume; `/v2/nfts*`, `/v2/nft_collections*`, `/v2/nft_sales`, `/v2/network/nft_volume` | — |
| E8 | explorer | `2026-10-24-nft-pages-design.md` | `/{net}/nfts`, collection and NFT pages; NFT ids in search | D3 |
| D4 | data-api | `docs/superpowers/specs/2026-10-24-display-names-design.md` | Account toml checks, the per-domain toml store, `/v2/account_names` | PR #20 (names, labels, account state) |
| E9 | explorer | `2026-10-24-display-names-design.md` | Display names and label marks wherever an address is shown; the account header | D4 |
| D5 | data-api | `docs/superpowers/specs/2026-10-24-ledger-objects-delegation-design.md` | Escrow, check and payment channel state and history; delegation | — |
| E10 | explorer | `2026-10-24-ledger-object-pages-design.md` | Escrow, check and payment channel pages; delegation on accounts and transactions | D5, E9 |
| D6 | data-api | `docs/superpowers/specs/2026-10-24-issued-tokens-design.md` | The token aggregate, `/v2/tokens`, `/v2/tokens/{currency}.{issuer}[/holders\|/transfers]` | PR #20 (trust-line and account state), D4 (toml currencies) |
| E11 | explorer | `2026-10-24-token-pages-design.md` | `/{net}/tokens`, `/{net}/token/{currency}.{issuer}`; the Tokens nav item | D6, E9 |
| D7 | data-api | `docs/superpowers/specs/2026-10-24-supply-design.md` | `/v2/network/supply` (XRPL and Xahau) | D5 (escrowed), PR #20 (reserves) |
| E12 | explorer | `2026-10-24-supply-page-design.md` | `/{net}/supply`; the Network menu | D7 |
| D8 | data-api | `docs/superpowers/specs/2026-10-24-validator-toml-details-design.md` | Validator countries, principals and toml details; `/v2/network/validators/countries` | D4 (toml store) |
| E13 | explorer | `2026-10-24-validators-map-design.md` | The validators map and countries table; the validator's toml card | D8 |
| D9 | data-api | `docs/superpowers/specs/2026-10-17-mpt-data-design.md` (revised) | MPT issuances and holders; `kind=mpt` on `/v2/tokens`; `/v2/mpt/{issuanceId}…` | D6 (token list) |
| E14 | explorer | `2026-10-24-mpt-page-design.md` | `/{net}/mpt/{issuanceId}`; the token list's MPT tab; MPT amounts in transactions | D9, E11 |

Data API specs live in `data-api` (branch `feat/explorer-data-2`); explorer specs in this repository (branch `feat/explorer-pages-2`).

**Build order** (the owner's, 2026-10-24): environments (D-env, E7), then NFTs (D3, E8), names (D4, E9), ledger objects and
delegation (D5, E10), tokens (D6, E11), supply (D7, E12), validators map (D8, E13), MPT (D9, E14). Each sub-project gets an
implementation plan and a reviewed build. Nothing is merged or pushed without the owner.

## Decisions that cut across the specs

1. **The data API work stacks on PR #20** (`feat/account-investigation-data`): it brings the account names and labels, the account
   state (with the Domain field) and the trust-line state that names, tokens and supply build on, and it has taken migrations
   005–010, shared-database migrations 001–002 and parser versions 3–4. Program 2 numbers its migrations and parser versions after
   those, in build order; if #20 takes more numbers before it merges, the plans renumber. Each sub-project's PR targets the previous
   one's branch and is retargeted to `master` once #20 merges.
2. **One switch per feature** in the explorer, the mechanism of program 1: `NFTS`, `NAMES`, `LEDGER_OBJECTS`, `DELEGATION`,
   `TOKENS`, `SUPPLY`, `VALIDATORS_MAP`, `MPT`. On at the top level and in tests; off in the sandbox and production until that
   environment's data API serves the feature. An off page answers 404 and its links read "soon".
3. **Names reach pages through one batch call.** `GET /v2/account_names?addresses=…` (up to 100) answers each address's display
   name and its kind, the domain, the account name and account network name, and any labels. Every explorer loader collects its
   page's addresses and makes one cached call; components never fetch. This amends ADR-0014, which served names only on
   `/v2/accounts/{address}`. A failed names call never fails a page: it shows addresses, as today.
4. **Display name order:** verified name, else account name, else unverified domain. Labels add a warning mark beside the name and a
   banner on the account's page; nothing more.
5. **State comes from history** (ADR-0015's approach): owners, holders and object state are rebuilt from transaction metadata, so
   they are complete only once the index holds the feature's history from its amendment (and, in the end, from ledger 32570). New
   list and aggregate answers carry `"coverage": { "from_ledger_index", "complete" }`; the explorer shows a short notice under a
   list whose coverage isn't complete. A detail page reads current state from the node when the index doesn't have the object.
6. **Deferred, by the owner's decision:** the nodes crawler, the nodes and node pages and the nodes map; distribution; charts that
   need a new daily statistics job (token holders and supply over time, MPT holders over time, escrow release forecasts); the
   network-wide escrows list. The header's Network menu lists only built pages.

## Constraints for the owner

- **Reprocessing.** Every data API feature adds tables that only fill from re-ingested history: NFTs from XRPL ledger 75,443,457
  (Xahau from its first ledger), delegation and token escrows from 107,524,865, MPT from 99,226,369 (about 8.5 M ledgers), Xahau's
  minting tables from its first ledger, tokens and supply from each network's first ledger. Reprocessing once, after the
  program's last parser version, is far cheaper than once per feature. The final answer is the full-history load from ledger 32,570
  that ADR-0015 plans. Until then, each list says where its coverage starts.
- **Deploy order per feature:** migration, then syncer, then API, then the explorer's switch. Each spec names the condition for
  turning its switch on: a first sweep done, a job live, or coverage complete.
- **New egress.** The names worker fetches the toml of every domain an account names, tens of thousands of hosts, through the
  guarded fetcher. `GH_DOMAIN_VERIFICATION=false` turns it off.
- **ClickHouse privileges.** The token aggregate swaps whole generations, so the syncer's ClickHouse user needs `DROP PARTITION`.
- **Nodes.** The explorer's XRPL node must be a Clio server (the NFT page's fallback uses `nft_info`) in production and in the
  sandbox. The public testnet Clio throttles quick requests, so GateHub's own is better.
- **The sandbox** gets its own data API stack and ClickHouse server. It starts at the current testnet ledger with no backfill. A
  testnet reset means dropping its databases, which loses the sandbox's per-network account names.
- **One wire change to an existing route.** A delegated transaction's fee is booked to the delegate who paid it, not to the
  account. Today `balance_changes` gets this wrong. It is recorded as an ADR-0010 item.
- **Inputs needed from the owner:**
  - the page a visitor follows to ask GateHub to change a name (the names spec);
  - the testnets' amendment majority hold periods (the testnet profiles spec).
- **Budgets:** ruling R19 stands: a page's initial JavaScript stays under 150 KB gzip for lookup pages and 160 KB for dashboards
  (validators, validator, supply). The world map's dots are a static SVG asset that adds no JavaScript.
