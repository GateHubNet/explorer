# Validators Map and the Validator's Toml Card (E13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show where the validators are on `/{net}/validators` (a dot-grid world map with one circle per server country, a countries table, "Unknown location: N", a Country filter and the country under each row) and what a validator's verified toml says on `/{net}/validators/{key}`, from D8's `toml` fields, behind the switch `VALIDATORS_MAP`.

**Architecture:** No new data API call: L (`scope=all`, `limit=1000`) and D carry D8's `toml`. A generator ported from the mock kit (`scripts/world-map*.ts`) writes two committed files: the dots as a static SVG asset (`app/ui/map/world-dots.svg`, fetched once through Vite's `?url` and drawn with `<use>`, so no byte of it is in any page's JavaScript or HTML) and the server-only country table (`app/server/countries.ts`). Pure view builders count the map from L's rows and build the toml card from D; the components only draw. `country` is one more parameter of E6's one-URL-per-view rule.

**Tech Stack:** React Router 8.4 (framework mode) on Cloudflare Workers, React 19, TypeScript, Vite 8 (`?url` assets), `bignumber.js`, Vitest (`unit`, `components` with happy-dom, `worker`, `worker-off`), Playwright with axe, `tsx` for scripts.

**Spec:** `docs/superpowers/specs/2026-10-24-validators-map-design.md` (cited "spec §n"; the plan argues from the spec, executors read both). Data: D8, `data-api` `docs/superpowers/specs/2026-10-24-validator-toml-details-design.md` (cited "D8 §n").

**Worktree and branch:** `/Users/golobitch/github.com/GateHubNet/x-explorer-worktrees/explorer-pages-2`, branch `feat/explorer-pages-2`. Before Task 1: the plans of E7, E8, E9, E10, E11 and E12 are built on this branch, and D8 is complete on the data API worktree `DAPI=/Users/golobitch/github.com/GateHubNet/data-api-worktrees/explorer-data-2` (branch `feat/explorer-data-2`), which is only read (`git -C "$DAPI" …`), never changed. Nothing is pushed.

## Global Constraints

- **The switch `VALIDATORS_MAP`** (feature `validatorsMap`) is feature-level: appended last to `FEATURE_VARS` (after E12's `SUPPLY`; verify), `"on"` at the top level of `wrangler.jsonc` and in the tests, `"off"` in `sandbox` and `production`. Off: no countries card, no Country select, no place under a row, no toml card (E6's accounts line instead); `country` is an unknown parameter (dropped by the 302). The loaders make the same calls either way.
- **No new data API call**, no new route, no header item (the Validators page is reached through E12's Network menu). D4's `GET /v2/toml/{domain}` and D8's `/v2/network/validators/countries` are never called.
- **Budgets (ruling R19):** the validators and validator pages are dashboards, 160,000 bytes of first-load JavaScript gzipped (`BUDGETS.dashboard`; `PAGES` already names both `"dashboard"`: no change there). The map adds no JavaScript to any page: `world-dots.svg` is never imported as a module, `app/server/countries.ts` is imported only by `app/server/*` and route loaders.
- **Pure view builders:** no I/O, no clock, no `Intl` (names are ordered by `COUNTRIES[code].order`); counts with `count`, shares with `shareText` (`bignumber.js`, one decimal); no float reaches a label.
- **One URL per view (E6):** the canonical order becomes `scope`, `publisher`, `amendment`, `country`, `q`; `country` is two ASCII letters made upper case, or `unknown` (any case); with the switch off or a code not in `COUNTRY_CODES` (`UK`, `ZZ`) it is dropped by the first, pure 302 (class `short`, no call). A view with `country` is `noindex, follow`, with no canonical link and no `og:*`.
- **Words** (glossary): "Server country" (never location, geolocation), "Owner country" (never nationality), "Unknown location" (never unlocated), "toml". Every copy string is the spec's, quoted in the task that draws it.
- **Names and links come from earlier sub-projects only:** account names through E9's `AccountLink` inside the page's `NamesProvider` (E9's one names call of the validator page, unchanged: it already collects `grid.accounts`); token links only through E11's `tokenLink`; a verified toml file through E6's `tomlLink` and `ExternalLink nofollow`. A `unl` URL is text (its host), never a link.
- **Browser files** (pages, components, `app/domain/*`) import nothing of `app/server` as a value (`test/unit/validators-bundle.test.ts`); the map component never fetches.
- E2–E12 pieces are never forked or redefined: a missing prop is added in its own file (**Growth**: `DataTable.rowProps`).
- Fixtures are synthetic and seeded; domains `*.example`; `pnpm fixtures:check` stays green.
- Before every commit `pnpm verify` (api:check, typecheck, test, build, check:bundle) exits 0; after a task that touches a page, `pnpm test:e2e` too. Commits: Conventional Commits (`feat(ui): …`, `feat(server): …`, `test: …`, `docs: …`), a body saying why, the last line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Name the files in `git add` (never `-A`), never `--amend`, never touch `.claude/`.

## Review Focus

1. **A hand-made query string:** `?country=de`, `?country=Unknown`, `?country=uk`, `?country=zz`, `?country=DE&country=FR`, `?q=x&country=DE&scope=all`, and any `country` with the switch off. Expected: one 302 (`short`, no upstream call) to `?country=DE`, `?country=unknown`, the view without it (twice), `?country=DE`, `?scope=all&country=DE&q=x`, and the view without it. Pinned by Task 4 `validators-params.test.ts` and `validators-page.spec.ts` ("is a pure redirect: …") and its loader-off case.
2. **L failing, truncated, or without any country** (an API without D8, or before D8's first read). Expected: the card's `SectionError` with the Country select hidden and a `country` of the URL kept in a hidden field (degraded, not stored); the first 1,000 counted with E6's sentence; the dots, no circle, "No validator's toml gives a server country yet." and "Unknown location: N". Pinned by Task 5 `validator-map-view.test.ts` ("answers an L with no row placed: …", "says when L was truncated") and the `validators-page-failures.spec.ts` cases of Tasks 6 and 7.
3. **A code this build does not place** (a new ISO assignment before the table is regenerated). Expected: a table row named by its code, no circle, the note "1 validator is in a country the map does not place: QQ.", nothing failing. Pinned by Task 1 `validators-shape.test.ts` (any `^[A-Z]{2}$` passes) and Task 5 ("an unplaced code").
4. **Keyboard and no JavaScript:** one Tab stop on the map, arrows and Home/End move focus west to east, Escape hides the tooltip; without JavaScript every circle and table name is a working link. Pinned by Task 7 `ValidatorsMapCard.test.tsx` and Task 11's e2e "without JavaScript".
5. **The toml card's odd states:** not read yet, `{}`, a `network` naming another network (an XRPL `testnet` on mainnet; none in the sandbox), Xahau's `"21337"`, an unparsable `unl`, a 40-hex code, an entry without an issuer, `TOKENS` off. Pinned by Task 9 `validator-view.test.ts` (`tomlCardOf`) and `validator-facts.test.ts`.

---

## Consumed from earlier plans

Names as their specs fix them; read each in its file before using it.

| Piece | From | Where |
| --- | --- | --- |
| The pages, loaders, `ValidatorsParams`, `parseValidatorsParams`, `validatorsHref`, `canonicalValidatorsParams`, `validatorsPage`, `ValidatorsPageData`, `ValidatorRowView`, `filtered`/`hasFilter`, `validatorPage`, `ValidatorLiveData`, `VALIDATORS_PARTS`, `VALIDATOR_PARTS`, `FilterSelect`/`FilterForm`/`viewOf` (local to `ValidatorsPage.tsx`), `validatorsMeta` | E6 | `app/domain/validators-params.ts`, `app/server/validators-view.ts`, `app/server/validator-view.ts`, `app/routes/net.validators*.tsx`, `app/ui/pages/Validator*Page.tsx`, `app/server/meta-validators.ts` |
| `count`, `shareText`, `joinAnd`, `DASH`, `TextPart`, `tomlFileOf`, `tomlLink`, `accountLinks`, `valueOf` | E6 | `app/server/validator-facts.ts` (E9 may have moved the unverified sentences to `app/server/toml-words.ts`; these stay) |
| `DataTable` (`compact`, `live`, `maxHeight`), `Meter` (`small`, `decorative`), `SectionError`, `Parts`, `ExternalLink`, `useHolds`/`HoldHandlers`, `keepLoaded`, `createLiveOnScreen`, `formatDate`, `formatCurrency` | E2, E6 | `app/ui/components/*`, `app/ui/charts/Meter.tsx`, `app/ui/use-hold.ts`, `app/ui/live-page.ts`, `app/domain/time-words.ts`, `app/domain/format.ts` |
| `NetworkKind` (`"mainnet" \| "testnet"`), `Network.kind`, the `sandbox` block of `wrangler.jsonc`, "staging" gone | E7 | `app/ui/environment.ts`, `app/server/networks.ts` |
| `AccountLink` (props unchanged), `NamesProvider`; the validator page's names call over `grid.accounts` with `holdFailure`, `names` in its page data and merged by `mergeNamesPart` (E9 Task 8); `scripts/names-fixtures.ts` (collects `network/validators@*`, so the validators' `domain_verification.accounts` are named) | E9 | `app/ui/components/AccountLink.tsx`, `app/ui/names.tsx`, `app/server/names-load.ts`, `app/routes/net.validators.$key.tsx` |
| `tokenLink(net: string, asset: Asset, features: Features): string \| null` (an LP token's pool; else the token page while `features.tokens`; else `null`), `parseTokenPath(network: { native: NativeCode }, decoded: string): TokenPath` (`{ kind: "token"; asset; canonical }`, `"lp"`, `"native"`, `"none"`), `Features.tokens`; Worker-only (it imports `asset.ts`), so E13 calls it from a view builder | E11 | `app/domain/token-params.ts` |
| `FEATURE_VARS` ending in `SUPPLY`; the switch steps as E8–E12 did them | E8–E12 | `app/ui/features.ts` and the files of Task 3 |
| `createLoadContext(env, ctx)` and the direct loader call of `account-analytics.spec.ts` ("with a load context of its own") | E2, E4 | `app/server/env.ts`, `test/worker/account-analytics.spec.ts` |
| D8's answers: `toml` last on a list row (`owner_country?`, `server_country?`, `network?`, `unl?`) and on the detail (plus `principals?`, `modified?`, `accounts_listed?`, `currencies?` `{ code, issuer? }`, `currencies_listed?`, `fetched?`); D8's 250 codes | D8 | `$DAPI/docs/api-reference.md`, `$DAPI/docs/openapi.yaml` |

---

### Task 1: D8's description, the `toml` types, their shape checks and the fixtures

**Files:**
- Modify: `api/openapi.yaml` and `app/server/openapi.d.ts` (`pnpm api:sync`), `app/server/api-types.ts`, `app/server/validators-shape.ts`, `app/server/validators-shape.test.ts`, `scripts/validators-fixtures.ts`, `test/fixtures/http/{xrpl,xahau}/data-api/network/validators*.json` (regenerated), `test/fixtures/PROVENANCE.md` ("Synthetic validators and amendments"), `test/support/validators-case-rules.ts`, `test/unit/validators-fixtures.test.ts`

**Interfaces:**
- Consumes: D8 at `PIN`.
- Produces (every later task):

```ts
// app/server/api-types.ts
/** What a validator's verified toml says about it (D8 §4.1): each key absent when the file gives no valid value; `{}` when it gives none. */
export interface ValidatorToml { owner_country?: string; server_country?: string; network?: string; unl?: string }
/** The detail's `toml` (D8 §4.2): the row's, then its domain's facts from the toml store. */
export interface ValidatorTomlDetail extends ValidatorToml {
  principals?: string[]; modified?: string; accounts_listed?: number;
  currencies?: { code: string; issuer?: string }[]; currencies_listed?: number; fetched?: string;
}
// ValidatorRow gains `toml?: ValidatorToml` (last); ValidatorDetail becomes
// `interface ValidatorDetail extends Omit<ValidatorRow, "amendment_votes" | "toml"> { …; toml?: ValidatorTomlDetail }`
```

  - Shape checks (`Shape.validator`, spec §3): `toml` an object when present; `owner_country`, `server_country` match `^[A-Z]{2}$`; `network`, `unl` text; on the detail `principals` a list of text, `accounts_listed`, `currencies_listed` whole numbers, `currencies` rows with `code` text and an optional `issuer` text, `modified` and `fetched` text. A malformed 200 is kind `server` and not stored (E6). A `network` this build has no name for passes.
  - Fixtures (spec §9), on both networks, in `scripts/validators-fixtures.ts`: the verified members in list order get `toml` by these rules:
    - server countries drawn (seeded, `seedOf(net, "toml")`) from XRPL `US DE NL GB FR CH SG JP CA FI SE IE AU HK KR ES PL NO IN XK`, Xahau `NL DE FI SE US GB FR SG JP AU NO EE`, weighted so the first three lead; `owner_country` the server's or another of the pool; `network` `"main"` (both networks, so Xahau's `"21337"` is a case of its own); `unl` `https://vl.ripple.com` (XRPL) or `https://vl.xahau.org` (Xahau);
    - **F**, the first verified member with accounts, gets a `toml` with all four fields and, on its detail, `principals: ["Mara Lindqvist", "Tomas Okafor"]`, `modified: "2026-10-02T00:00:00Z"`, `accounts_listed` = its `domain_verification.accounts` length + 2, `currencies: [{ code: "USD", issuer: <its first account> }, { code: "4E50555344000000000000000000000000000000", issuer: <the same> }, { code: "EUR" }]`, `currencies_listed: 5`, `fetched` (an instant of receipt half an hour before the newest ledger);
    - the other verified members, in list order, numbered from 1: no. 1 has no `toml` (not read yet); no. 2 `{}`; no. 3 a country and no `network`, its detail `principals: ["North Peak Ops"]` and `fetched`; on XRPL no. 4 `network: "testnet"` and no. 5 `server_country: "XK"`; on Xahau no. 4 `network: "21337"`; from no. 6 on every 6th has no `server_country` (so "Unknown location" counts more than the unverified validators); the rest get drawn values, and their details carry the row's `toml` alone.
    - No new address: E9's `names-fixtures.ts` already names every `domain_verification.accounts`; `pnpm fixtures:check` proves `account_names.json` unchanged.
  - Case rules (`VALIDATOR_CASE_RULES`, found by `test/support/validators-cases.ts` as E6's are): `toml-full` (the detail's `toml.principals` and `currencies`), `toml-not-read` (verified, no `toml`), `toml-empty` (`toml` with no key), `toml-no-network` (a `server_country`, no `network`), `toml-other-network` (XRPL: `network` `"testnet"`), `toml-network-id` (Xahau: `network` `"21337"`), `toml-xk` (XRPL: `server_country` `"XK"`), `unknown-location` (seen, no `server_country`).

- [ ] **Step 1: Pin and sync.** `PIN=$(git -C "$DAPI" log -1 --format=%H feat/explorer-data-2 -- docs/api-reference.md docs/openapi.yaml)`; read D8's sections with `git -C "$DAPI" show "$PIN:docs/api-reference.md"` (where it and the spec's examples differ, the reference wins); then `DATA_API_REPO=$DAPI pnpm api:sync`. `api/openapi.yaml` gains `/v2/network/validators/countries` and the `country` parameter; `pnpm api:check` passes.
- [ ] **Step 2: Write the failing tests.** `validators-shape.test.ts`: `it('accepts toml on a row: full, {}, a code it has no name for, a network it has no name for')`; `it('refuses a toml that is not an object, a country in lower case or of three letters, a network that is not text')`; `it('accepts the detail\'s facts and refuses principals that are not text, a negative count, a currency without a code')`. `validators-fixtures.test.ts`: `it.each` the eight cases on their networks (each has at least one row); `it('has more unknown-location rows than unverified ones')`; `it('has the full toml facts on one detail per network')`.
- [ ] **Step 3: Run them to verify they fail.** `pnpm test -- validators-shape validators-fixtures`: FAIL.
- [ ] **Step 4: Implement** the types, the checks, the generator's rules; `pnpm fixtures:sync`; `PROVENANCE.md` says what the `toml` fields follow (D8 at `PIN`, the pools, the cases).
- [ ] **Step 5: Run the tests to verify they pass**: `pnpm fixtures:check`, `pnpm verify`.
- [ ] **Step 6: Commit.** `git add api/openapi.yaml app/server/openapi.d.ts app/server/api-types.ts app/server/validators-shape.ts app/server/validators-shape.test.ts scripts/validators-fixtures.ts test/fixtures/http test/fixtures/PROVENANCE.md test/support/validators-case-rules.ts test/unit/validators-fixtures.test.ts` — `feat(server): D8's toml on the validator answers, checked, with synthetic fixtures` (body names `PIN`).

---

### Task 2: The world map: data, generator and the two generated files

**Files:**
- Create: `scripts/world-map-data.ts`, `scripts/world-map-core.ts`, `scripts/world-map.ts`, `scripts/world-map.test.ts`, `app/ui/map/world-dots.svg` (generated), `app/server/countries.ts` (generated)
- Modify: `package.json` (`"map:sync": "tsx scripts/world-map.ts"`, `"map:check": "tsx scripts/world-map.ts --check"`), `README.md` ("Scripts")

**Interfaces:**
- Consumes: nothing.
- Produces (Tasks 4–9):

```ts
// scripts/world-map-data.ts (the kit's data, from now on the source)
export const LAND: Readonly<Record<string, readonly (readonly [number, number])[]>>;   // [lon, lat] polygons, below
export const WATER: Readonly<Record<string, readonly (readonly [number, number])[]>>;
/** [code, name, lat, lon] for the 250 codes, sorted by code. */
export const COUNTRY_POINTS: readonly (readonly [code: string, name: string, lat: number, lon: number])[];
/** The board's 55 hub points' codes, in the kit's order. */
export const BOARD_CODES: readonly string[];

// scripts/world-map-core.ts (pure: the command and the test import it)
export const VIEW_BOX = "0 0 1000 378";
export const K = 1000 / 360;
export function isLand(lon: number, lat: number): boolean;        // in a LAND polygon and in no WATER polygon, even-odd ray casting
export function dotsPath(): string;                               // every 2.5° cell centre on land, row by row from lat 76.75, `M${x.toFixed(1)} ${y.toFixed(1)}h0` joined
export function pointOf(lat: number, lon: number): { x: number; y: number }; // x = (lon + 180) × K, y = (78 − lat) × K clamped to 0…378, each Number(v.toFixed(1))
export function worldDotsSvg(): string;                           // the whole text of app/ui/map/world-dots.svg
export function countriesModule(): string;                        // the whole text of app/server/countries.ts
export const OUTPUTS: readonly { path: string; text: () => string }[];  // the two files, paths from the repository root
export function staleOutputs(root: string): string[];             // the paths whose file is missing or differs

// app/server/countries.ts (generated)
export const COUNTRIES: Readonly<Record<string, { name: string; x: number; y: number; order: number }>>;
export const COUNTRY_CODES: ReadonlySet<string>;
```

  - `scripts/world-map.ts` is only the command (the repository's api-sync rule, ruling R5): `map:sync` writes `OUTPUTS`; `map:check` writes nothing, prints the stale paths and sets exit code 1 when any.
  - `world-dots.svg` is `<!-- Generated by scripts/world-map.ts (pnpm map:sync): do not edit. -->`, a newline, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 378"><path id="dots" d="{dotsPath()}" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>` and a newline.
  - `countries.ts` is `// Generated by scripts/world-map.ts (pnpm map:sync): do not edit.`, then `COUNTRIES` as one line per code in code order (`  DE: { name: "Germany", x: 528.9, y: 74.4, order: 84 },`), then `export const COUNTRY_CODES: ReadonlySet<string> = new Set(Object.keys(COUNTRIES));`. `order` is the code's place (from 0) when the names are sorted with `new Intl.Collator("en").compare` at generation time.
  - **Codes:** exactly D8's 250 (`ISO_COUNTRY_CODES` of D8's Task 2): the 250 below, the 249 ISO 3166-1 alpha-2 codes assigned on 2026-10-24 and `XK` last.

```
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW
SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ
UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK
```

  - **Names** (written literally in `COUNTRY_POINTS`; ruling R3): the CLDR English name, as `new Intl.DisplayNames(["en"], { type: "region" }).of(code)` gives it under Node 24 (`Bosnia & Herzegovina`, `Côte d’Ivoire`, `Congo - Kinshasa`, `Türkiye`, `Kosovo` for `XK`), except the short form for `HK` "Hong Kong", `MO` "Macao", `PS` "Palestine", `MM` "Myanmar". This gives the board's 55 names as the kit writes them.
  - **Points:** the 55 board points below, exactly; every other code its CIA World Factbook "Geographic coordinates" (public domain; `https://www.cia.gov/the-world-factbook/field/geographic-coordinates/`, degrees and minutes as `deg + min / 60`, to 2 decimals, south and west negative). Codes the Factbook has no entry of its own for (ruling R4): `AX` 60.2, 19.9; `BQ` 12.2, −68.3; `GF` 4.0, −53.0; `GP` 16.3, −61.6; `MQ` 14.7, −61.0; `RE` −21.1, 55.5; `YT` −12.8, 45.2; `PS` the Factbook's West Bank entry 32.0, 35.25; `UM` its Wake Island entry 19.28, 166.6; `SJ` its Svalbard entry 78.0, 20.0. If the Factbook page cannot be fetched, stop and report BLOCKED naming it (never write coordinates as the Factbook's that were not read there).
  - The kit's polygons, copied as they are (`world-map-data.ts`):

```ts
export const LAND: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  north_america: [[-156.5, 71.3], [-151, 70.4], [-141, 69.6], [-133, 69.5], [-128, 70.2], [-120, 69.3], [-114, 68.4], [-108, 68.2], [-102, 67.8], [-98, 68], [-94.5, 69.3], [-90.5, 68.4], [-87, 67.3], [-89, 64], [-93, 61], [-94.5, 59], [-92.5, 57], [-88, 56.5], [-85, 55.2], [-82, 52.9], [-79.5, 51.5], [-79, 55], [-77.5, 57], [-77.8, 60], [-78, 62.3], [-74, 62.2], [-71, 61], [-69.5, 59], [-67, 58.4], [-65, 60.3], [-64, 58], [-61.5, 56], [-57.5, 53.8], [-55.7, 52.3], [-57, 51.5], [-60, 50.2], [-66, 50], [-70, 48], [-65, 48.6], [-64.5, 47], [-61, 46], [-60, 45.5], [-66, 43.5], [-70, 43.7], [-70.5, 41.7], [-74, 40.5], [-76, 39], [-75.5, 37.5], [-76.3, 35], [-77.9, 34], [-81, 31.5], [-80, 27], [-80.3, 25.3], [-81.8, 26], [-82.8, 28], [-84, 30], [-86, 30.4], [-89.5, 30.2], [-89.3, 29], [-91, 29.3], [-94, 29.6], [-97.3, 27.5], [-97.5, 25], [-97.7, 22], [-95.5, 18.8], [-94, 18.2], [-91, 18.8], [-90.5, 21], [-87, 21.5], [-87.6, 18.5], [-88.2, 16], [-86, 15.9], [-83.3, 15], [-83.6, 11], [-81.8, 9], [-79.5, 9.5], [-77.4, 8.5], [-78.4, 8], [-80.3, 7.4], [-82, 8.2], [-84, 9.5], [-85.7, 10.8], [-87.5, 13], [-91.5, 14], [-94, 16], [-96.5, 15.7], [-101, 17.3], [-105.5, 20.3], [-105.5, 22.5], [-108.5, 25.5], [-111, 28], [-112.8, 31.5], [-114.8, 31.8], [-113, 29], [-110.5, 24.5], [-109.9, 22.9], [-112, 24.8], [-115, 28], [-116.5, 31.5], [-117.1, 32.5], [-118.5, 34], [-120.6, 34.6], [-122.5, 37.5], [-124, 40.4], [-124.6, 43], [-124, 46.3], [-124.7, 48.4], [-123, 49], [-126, 50], [-128, 51.5], [-130.5, 54.5], [-133, 57], [-136.5, 58.5], [-140, 59.8], [-145, 60.3], [-148, 60.5], [-151.5, 59.2], [-154, 58], [-158, 57], [-162.5, 55], [-164.5, 54.6], [-161, 56], [-157.5, 58.6], [-162, 58.6], [-164, 60], [-165.5, 62], [-164.5, 63.2], [-161, 64.5], [-165, 64.5], [-168, 65.6], [-164, 66.5], [-162, 66.8], [-163.7, 68.2], [-166.2, 68.9], [-162, 70.2]],
  baffin: [[-90, 72], [-80, 73.7], [-70, 70.5], [-62, 66.5], [-64.5, 63.5], [-68, 62], [-72, 63.5], [-78, 64.3], [-74, 66.5], [-81, 69], [-85, 70]],
  victoria: [[-118, 69], [-101, 69], [-101, 73], [-114, 73]],
  devon: [[-125, 72], [-117, 75.5], [-105, 76.5], [-92, 76.5], [-80, 76.5], [-80, 74.5], [-92, 74.5], [-110, 74.5], [-123, 71.5]],
  greenland: [[-73, 78], [-66, 76], [-58, 75.5], [-56, 72.5], [-53.5, 70], [-51, 68.5], [-53.5, 66.5], [-50.5, 63], [-48.5, 61], [-44, 59.8], [-42, 61.5], [-40, 64.5], [-35, 66], [-31, 68.3], [-24, 70], [-21.8, 72.5], [-18.5, 75], [-18.5, 78], [-20, 82], [-40, 83.5], [-60, 82]],
  newfoundland: [[-59.3, 47.6], [-56, 51.6], [-55.5, 49.8], [-52.7, 47.5], [-53.6, 46.6]],
  cuba: [[-85, 21.9], [-82, 23.2], [-77, 22.2], [-74.2, 20.2], [-77.7, 19.9], [-80, 21.8]],
  hispaniola: [[-74.4, 18.5], [-72.8, 19.9], [-70, 19.7], [-68.4, 18.6], [-71.4, 17.6]],
  south_america: [[-80, 10], [-75, 11], [-71, 12], [-63, 10.5], [-60, 8], [-52, 5], [-50, 0], [-44, -2], [-35, -5], [-35, -9], [-39, -14], [-39, -18], [-41, -22], [-48, -26], [-48.5, -28], [-53, -34], [-58, -35], [-57, -38], [-62, -39], [-65, -42], [-65, -46], [-68, -50], [-69, -52], [-68.5, -55], [-71, -54], [-74, -50], [-75, -45], [-73.5, -38], [-71.5, -30], [-70.5, -18], [-75, -15], [-77, -12], [-81, -6], [-80, -1], [-78, 2], [-77, 7]],
  eurasia: [[-9.5, 37], [-9.5, 43.5], [-1.5, 43.5], [-1.5, 46], [-4.5, 48], [-1.5, 49.5], [1.5, 50.5], [4, 51.5], [5, 53], [8.5, 54], [8, 57], [10.5, 57.7], [10.5, 55], [12.5, 54.5], [14, 54], [19, 54.5], [21, 55.5], [21, 57], [24, 57.5], [24, 59.4], [29, 60], [23, 60], [21.5, 61], [21.5, 63.5], [25, 65], [22, 65.8], [17.5, 62.5], [19, 60], [16.5, 57], [14.5, 56], [12.5, 56], [11, 58.5], [10.5, 59.5], [8, 58], [5.5, 58.8], [5, 62], [10, 64], [14, 67.5], [17, 69.5], [23, 70.5], [28, 71], [31, 70], [33, 69.3], [41, 67], [37, 66], [34.5, 64.5], [37, 64], [44, 66], [44, 68.5], [53, 68.5], [60, 69.5], [68, 68.5], [69, 73], [73, 72.5], [74, 69], [80, 73.5], [87, 75], [100, 76], [104, 77.7], [113, 76], [113, 73.5], [130, 71], [140, 72.5], [150, 71.5], [160, 70], [170, 70], [180, 69], [180, 65], [178, 64.5], [173, 61], [163, 60], [163, 58], [156.5, 51], [156, 57], [160, 61], [155, 59.5], [143, 59.5], [137, 54], [141, 53], [140, 48], [135, 43.5], [131, 42.5], [129.5, 40], [129, 35], [126.5, 34.5], [126.3, 37.5], [124.5, 39.8], [121.5, 40.8], [118, 39], [119, 37.2], [122.5, 37.4], [120, 35], [121, 32], [122, 30], [119.5, 25], [115, 22.5], [110, 21], [108, 21.5], [106, 19], [109, 15], [109, 11.5], [105, 8.6], [104.8, 10.5], [102, 12.5], [100.8, 13.5], [100, 10], [100.3, 7], [102.5, 6], [103.5, 4], [104.2, 1.4], [101, 2.8], [100, 5], [98.3, 8], [98.5, 10], [97.8, 15], [97.5, 17], [94.5, 16], [94.2, 19], [92.5, 21.5], [90, 22], [87, 21.5], [86, 20], [84, 18], [80, 15], [80, 10], [77.5, 8], [76, 10], [73.5, 16], [72.7, 21], [70, 21], [68.5, 23.5], [66.5, 25.3], [61.5, 25.2], [57, 25.8], [56.3, 26.5], [56.3, 24], [59.8, 22.5], [57.5, 18.9], [55, 17], [52, 15.5], [48, 14], [43.5, 12.7], [42.5, 15], [39, 21.5], [35, 28], [34.5, 29.5], [32.5, 30], [32.3, 31.2], [34.3, 31.3], [35, 33], [35.8, 35.5], [36, 36.8], [34, 36.2], [30, 36.3], [27.3, 37], [26.3, 39.2], [26.2, 40.5], [26, 40.8], [24, 40.5], [23.5, 38], [22.5, 36.5], [21.5, 37], [20.5, 39.5], [19.5, 41.5], [18.5, 42.5], [15.5, 44], [13.6, 45.6], [12.3, 45.3], [12.5, 44], [14, 42], [16, 41.5], [18.5, 40], [16.5, 38.5], [15.7, 38], [16, 39.5], [15.5, 40], [12, 41.8], [10.5, 43], [8.8, 44.4], [7.5, 43.8], [6, 43], [4, 43.5], [3.2, 42.5], [3, 41.8], [0.8, 41], [0, 39.5], [-0.5, 38.3], [-2, 36.7], [-5.5, 36], [-6.5, 36.8], [-8.8, 37]],
  great_britain: [[-5.7, 50], [1.5, 51], [1.7, 52.7], [0, 53.5], [-1.5, 55], [-2, 57.6], [-3.5, 58.6], [-5, 58.6], [-6.2, 56.6], [-5.5, 55.3], [-3, 54.8], [-3.4, 53.4], [-4.7, 52.8], [-5.3, 51.8], [-3, 51.4]],
  ireland: [[-10, 51.6], [-6, 52], [-6, 54], [-7.3, 55.3], [-8.5, 55.2], [-10, 54.2]],
  iceland: [[-24, 65.5], [-22, 66.4], [-16, 66.5], [-13.6, 65], [-15, 64.3], [-18.7, 63.4], [-22.7, 63.8]],
  sicily: [[12.4, 38], [15.6, 38.3], [15.1, 36.7]],
  africa: [[-17, 21], [-16, 24], [-13, 27.5], [-10, 29.5], [-9.5, 32.5], [-6.5, 34], [-5.5, 35.8], [-2, 35.1], [1, 36.5], [5, 36.8], [10, 37.3], [11, 36.8], [10, 34.5], [11, 33.2], [15, 32.3], [19, 30.3], [20, 32], [23, 32.6], [25, 31.7], [29, 30.9], [32.3, 31.2], [32.5, 30], [33.5, 27.5], [35.5, 24], [37.2, 21], [38.5, 18], [39.5, 15.5], [42.5, 13], [43.3, 11.5], [44.5, 10.4], [51, 11.8], [51, 10.5], [49, 6], [47, 4], [43, -1], [40.5, -2.5], [39, -6], [39.5, -10], [40.5, -14.5], [37, -17.5], [35.3, -22], [35.5, -24], [32.8, -26], [32.5, -29], [30, -31.3], [27.5, -33.5], [25, -34], [22, -34.2], [20, -34.8], [18.4, -34], [18, -32], [16.5, -28.6], [15, -26.5], [14.4, -23], [13, -20], [11.8, -17], [12, -13], [13.5, -11], [13, -8.5], [12.2, -6], [11.8, -3.5], [9, -1], [9.5, 1], [9.7, 3.5], [8.5, 4.5], [6, 4.3], [4.5, 6.3], [2, 6.2], [-2, 4.8], [-4.5, 5.2], [-7.5, 4.3], [-9.5, 5.4], [-11.5, 6.9], [-13.3, 8.5], [-15, 10.8], [-16.7, 12.5], [-17.5, 14.7], [-16.5, 16.5], [-16, 19]],
  madagascar: [[44, -25], [47, -25], [49.5, -17], [50.5, -15.5], [49.3, -12], [47, -14], [44.4, -16.5], [43.6, -21.5]],
  sri_lanka: [[79.8, 8], [80.2, 9.8], [81.9, 7.5], [81, 6], [80, 6.2]],
  japan: [[130, 31], [131.5, 31.4], [132, 33.8], [135, 33.5], [137, 34.5], [140, 35], [141, 38], [142, 39.5], [141.4, 41.4], [140, 40.5], [139.5, 38], [137, 37], [135.5, 35.6], [132.5, 35.5], [130.9, 34]],
  hokkaido: [[140, 42], [141.5, 42.5], [143.5, 42], [145.5, 43.3], [142, 45.4], [140, 43.3]],
  sakhalin: [[142, 46], [143.5, 46.5], [143, 50], [143.2, 54], [142.5, 54.3], [142, 50]],
  taiwan: [[120.2, 22.6], [121, 22], [122, 25], [121.5, 25.3]],
  luzon: [[120, 18.5], [122.3, 18.5], [122, 16], [124, 13.8], [121, 13.8], [120, 16]],
  visayas: [[122, 10], [122, 11.6], [125, 12.4], [125.5, 10], [123.5, 9.3]],
  mindanao: [[122, 7], [126.5, 7], [126.2, 9.5], [125, 9], [123, 8.5]],
  sumatra: [[95.3, 5.6], [97.5, 5.2], [100.5, 2], [103.8, -1], [106, -3], [105.8, -5.8], [104.5, -5.8], [102, -4], [100, -1], [98.5, 1.7], [96, 3.8]],
  java: [[105.2, -6.8], [108, -6.3], [111, -6.5], [114.5, -7.7], [114.4, -8.7], [110, -8.1], [106, -7.4]],
  borneo: [[109, 1.5], [110, 1.7], [111, 2.8], [113.5, 4], [115.5, 5.2], [117, 7], [119, 5], [118, 4.3], [117.5, 1], [118.8, 1], [117, -1], [116.5, -3.5], [114.5, -3.8], [111, -3], [110, -1.8], [109, 0]],
  sulawesi: [[119, -5.5], [120.5, -5.5], [120.5, -2.5], [121.5, -1], [123, -0.8], [125, 1.5], [124.5, 0.5], [120.5, 0.5], [119.8, -0.5], [119, -3]],
  new_guinea: [[131, -1], [134, -0.8], [137, -1.5], [141, -2.6], [145.7, -4.8], [148, -8], [150.5, -10.5], [147, -10], [144, -7.7], [141, -9.2], [138.5, -8.3], [137.8, -5.3], [135, -4.3], [132.5, -4]],
  australia: [[113.5, -22], [114, -26.5], [115, -34], [117.5, -35], [123, -33.8], [126, -32.3], [131, -31.5], [134, -32.8], [137.5, -35.5], [138, -33], [140, -38], [144, -38.3], [146.5, -39], [150, -37.5], [153, -32], [153.5, -28], [153, -25], [150.5, -22.5], [146.5, -19], [145.4, -15], [143.5, -14], [142.5, -10.7], [141.5, -13], [141.5, -17], [140, -17.7], [136, -15], [136.7, -12.2], [132.5, -11.4], [130, -13], [129, -14.9], [126, -14], [122.5, -17], [121, -19.5], [117, -20.7]],
  tasmania: [[144.6, -40.7], [148.3, -40.9], [148, -43.2], [146, -43.6]],
  nz_north: [[172.7, -34.4], [174.5, -36], [176, -37.5], [178.5, -37.7], [177, -39.5], [176, -41.3], [174.8, -41.3], [175, -39.5], [173.8, -39.2], [174.5, -37]],
  nz_south: [[172.7, -40.5], [174.2, -41.6], [173, -43.5], [171, -44.7], [169, -46.6], [166.5, -46], [168, -44], [170.5, -42.7]],
};
export const WATER: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  caspian: [[47, 44.5], [50, 46.5], [53, 47], [54, 45], [51, 44.3], [53, 42], [52.8, 40.5], [54, 37.3], [51, 36.6], [49, 38], [49.5, 40.3], [47.5, 42.5]],
  black_sea: [[28, 41.2], [28.5, 43.5], [30, 45.5], [31, 46.6], [33.5, 46], [35, 45.3], [36.5, 45.4], [38, 47], [39.5, 47], [38, 45], [37.5, 44.5], [40, 43.4], [41.6, 41.6], [38, 40.9], [35, 42], [33, 42], [31, 41.2]],
  persian_gulf: [[48, 30], [50, 29.8], [51, 28], [53, 27], [56.3, 26.6], [56.3, 25], [54, 24], [52, 24], [51, 25.5], [50.3, 26.5], [49, 27.5]],
};
```

  - The board's 55 hub points (`[code, name, lat, lon]`, the kit's order, which `BOARD_CODES` keeps): `["US", "United States", 39.8, -98.6], ["CA", "Canada", 54, -100], ["MX", "Mexico", 23.6, -102.5], ["BR", "Brazil", -10.8, -52.9], ["AR", "Argentina", -35.4, -65.2], ["CL", "Chile", -33.5, -70.7], ["CO", "Colombia", 4.6, -74.1], ["PE", "Peru", -9.2, -75], ["GB", "United Kingdom", 53, -1.8], ["IE", "Ireland", 53.2, -8], ["IS", "Iceland", 64.9, -18.6], ["PT", "Portugal", 39.6, -8], ["ES", "Spain", 40.2, -3.6], ["FR", "France", 46.6, 2.4], ["BE", "Belgium", 50.6, 4.6], ["NL", "Netherlands", 52.2, 5.3], ["LU", "Luxembourg", 49.8, 6.1], ["DE", "Germany", 51.2, 10.4], ["CH", "Switzerland", 46.8, 8.2], ["AT", "Austria", 47.6, 14.1], ["IT", "Italy", 42.8, 12.6], ["DK", "Denmark", 56, 9.5], ["NO", "Norway", 61, 9], ["SE", "Sweden", 60.1, 15], ["FI", "Finland", 62, 26], ["EE", "Estonia", 58.6, 25], ["LT", "Lithuania", 55.2, 23.9], ["PL", "Poland", 52.1, 19.4], ["CZ", "Czechia", 49.8, 15.5], ["RO", "Romania", 45.9, 24.9], ["UA", "Ukraine", 49, 31.4], ["TR", "Türkiye", 39, 35.2], ["RU", "Russia", 61.5, 100], ["KZ", "Kazakhstan", 48, 67], ["IL", "Israel", 31.4, 35], ["SA", "Saudi Arabia", 24, 45], ["AE", "United Arab Emirates", 24.3, 54.3], ["EG", "Egypt", 26.8, 30.8], ["NG", "Nigeria", 9.1, 8.7], ["KE", "Kenya", 0.2, 37.9], ["ZA", "South Africa", -29, 25], ["IN", "India", 21, 78], ["CN", "China", 35, 104], ["HK", "Hong Kong", 22.3, 114.2], ["TW", "Taiwan", 23.7, 121], ["KR", "South Korea", 36.5, 127.9], ["JP", "Japan", 36.2, 138.3], ["TH", "Thailand", 15.9, 100.9], ["VN", "Vietnam", 14.1, 108.3], ["MY", "Malaysia", 4.2, 102], ["SG", "Singapore", 1.35, 103.8], ["ID", "Indonesia", -2.5, 118], ["PH", "Philippines", 12.9, 121.8], ["AU", "Australia", -25.3, 133.8], ["NZ", "New Zealand", -41, 174]`.

- [ ] **Step 1: Write the failing test** `scripts/world-map.test.ts` (the `unit` project), with `ISO_CODES` (the 250 above, literal) and `KIT_POINTS` (the kit's projected points, literal): `US: [226.1, 106.1], CA: [222.2, 66.7], MX: [215.3, 151.1], BR: [353.1, 246.7], AR: [318.9, 315], CL: [303.6, 309.7], CO: [294.2, 203.9], PE: [291.7, 242.2], GB: [495, 69.4], IE: [477.8, 68.9], IS: [448.3, 36.4], PT: [477.8, 106.7], ES: [490, 105], FR: [506.7, 87.2], BE: [512.8, 76.1], NL: [514.7, 71.7], LU: [516.9, 78.3], DE: [528.9, 74.4], CH: [522.8, 86.7], AT: [539.2, 84.4], IT: [535, 97.8], DK: [526.4, 61.1], NO: [525, 47.2], SE: [541.7, 49.7], FI: [572.2, 44.4], EE: [569.4, 53.9], LT: [566.4, 63.3], PL: [553.9, 71.9], CZ: [543.1, 78.3], RO: [569.2, 89.2], UA: [587.2, 80.6], TR: [597.8, 108.3], RU: [777.8, 45.8], KZ: [686.1, 83.3], IL: [597.2, 129.4], SA: [625, 150], AE: [650.8, 149.2], EG: [585.6, 142.2], NG: [524.2, 191.4], KE: [605.3, 216.1], ZA: [569.4, 297.2], IN: [716.7, 158.3], CN: [788.9, 119.4], HK: [817.2, 154.7], TW: [836.1, 150.8], KR: [855.3, 115.3], JP: [884.2, 116.1], TH: [780.3, 172.5], VN: [800.8, 177.5], MY: [783.3, 205], SG: [788.3, 212.9], ID: [827.8, 223.6], PH: [838.3, 180.8], AU: [871.7, 286.9], NZ: [983.3, 330.6]`.
  - `it('writes outputs that are current')`: `staleOutputs(repoRoot)` is `[]` (as `http-fixtures.test.ts` checks the fixtures, in memory).
  - `it('places the 250 codes D8 accepts, and no other')`: the codes of `COUNTRY_POINTS` equal `ISO_CODES`, each `^[A-Z]{2}$`, unique, named, `UK`, `EU`, `ZZ` absent; every `pointOf` inside 0…1000 × 0…378.
  - `it('keeps the board\'s 55 points and names')`: for each `BOARD_CODES` code, its name is the kit's and `pointOf` is within 0.1 of `KIT_POINTS` (`Math.abs(a − b) <= 0.1 + 1e-9`).
  - `it('projects by hand')`: `pointOf(0, 0)` is `{ x: 500, y: 216.7 }`; `pointOf(-90, 0).y` is 378 (clamped: Antarctica on the bottom edge); `pointOf(78, -180)` is `{ x: 0, y: 0 }`.
  - `it('draws the kit\'s 2,374 dots')`: `dotsPath()` holds 2,374 `M` segments, is 32,104 characters long and starts with `M316.0 3.5h0M322.9 3.5h0M329.9 3` (the port need not match `worldmap.json` byte for byte: JavaScript's `toFixed` rounds an exact tie up where Python rounds it to even, so a few dots differ by 0.1).
  - `it('writes the svg the page draws')`: `worldDotsSvg()` starts with the generated-file line, holds `viewBox="0 0 1000 378"`, `<path id="dots"`, `stroke="currentColor"`, `stroke-width="3.4"`, `stroke-linecap="round"`.
  - `it('orders the names in English')`: in `COUNTRIES` (imported from `app/server/countries.ts`), `order` is a permutation of 0…249; `AF` (Afghanistan) is 0, `AX` (Åland Islands) 1, `AL` (Albania) 2, as `Intl.Collator("en")` puts them; `TR` (Türkiye) sits between `TN` (Tunisia) and `TM` (Turkmenistan).
- [ ] **Step 2: Run it to verify it fails.** `pnpm test -- world-map`: FAIL, modules missing.
- [ ] **Step 3: Implement** the three scripts and the data; fetch the Factbook coordinates; `pnpm map:sync`; the two `package.json` scripts and the README's "Scripts" rows.
- [ ] **Step 4: Run it to verify it passes**; `pnpm map:check` exits 0; `pnpm verify`.
- [ ] **Step 5: Commit.** `git add scripts/world-map-data.ts scripts/world-map-core.ts scripts/world-map.ts scripts/world-map.test.ts app/ui/map/world-dots.svg app/server/countries.ts package.json README.md` — `feat(server): the world map's dots and country table, generated in TypeScript` (body: ported from the mock kit, which is not in the repository; the Factbook's public-domain points; the pipeline needs no Python).

---

### Task 3: The switch `VALIDATORS_MAP`

**Files:**
- Modify: `app/ui/features.ts`, `app/ui/features.test.ts`, `app/server/env.ts` (`Env`), `app/server/env.test.ts` (the cache-generation strings), `wrangler.jsonc` (every block and the head comment), `vitest.config.ts` (`TOP_LEVEL_SWITCHES`), `scripts/predeploy-check.test.ts` (the misspelling case), `test/worker/features-off.spec.ts` (its cache-generation string), `README.md` (Configuration's switch list, "Switches" tables, `E2E_FEATURES_OFF`'s names, the guard's list), and wherever E8–E12 listed their switches beside these

**Interfaces:**
- Consumes: E12's `FEATURE_VARS`.
- Produces: `FEATURE_VARS` ends `…, "SUPPLY", "VALIDATORS_MAP"`; `FEATURE_NAME.VALIDATORS_MAP = "validatorsMap"`; `Features.validatorsMap: boolean`; `Env.VALIDATORS_MAP: "on" | "off"`; `"VALIDATORS_MAP": "on"` at the top level, `"off"` in `sandbox` and `production`.

- [ ] **Step 1: Write the failing tests.** `features.test.ts`: `describe("the VALIDATORS_MAP switch")` with `it("is the switch after SUPPLY, and its feature is validatorsMap")` (the order of every earlier switch as a prefix of both lists, as AMM_PAGES's test does), `it("is on only for \"on\"")`, `it("turns nothing else on, and nothing else turns it on")`. `env.test.ts` and `features-off.spec.ts`: the sorted generation strings end `…,VALIDATORS=…,VALIDATORS_MAP=…`. `predeploy-check.test.ts`: `it('refuses a misspelt VALIDATOR_MAP: "on" as a var that is not a switch, naming VALIDATORS_MAP among the switches')` and its sandbox/production pass cases.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement** every place of the Files list (E2's steps; spec §6). The README's Switches row: `VALIDATORS_MAP` (`validatorsMap`, E13): the validators map, the Country filter, the country under each row and the validator's toml card; `"on"` top level, `"off"` sandbox and production; goes on in an environment once its data API serves D8 on both networks and `syncer_validators_toml_fields_total{outcome="read"}` has grown there; rolling back is `"off"` and a deploy; under `VALIDATORS` off it shows nothing, so no guard rule.
- [ ] **Step 4: Run them to verify they pass**: `pnpm verify`.
- [ ] **Step 5: Commit.** `git add` the files above — `feat(ui): the VALIDATORS_MAP switch`.

---

### Task 4: The `country` parameter of the validators list

**Files:**
- Modify: `app/domain/validators-params.ts`, `app/domain/validators-params.test.ts`, `app/routes/net.validators.tsx` (the pure part), `app/server/validators-view.ts` (`filtered`, `hasFilter`), `app/server/validators-view.test.ts`, `app/server/meta-validators.ts`, `app/server/meta.test.ts`, `test/worker/validators-page.spec.ts`
- Create: `test/worker/validators-map-off.spec.ts`

**Interfaces:**
- Consumes: Task 2's `COUNTRY_CODES`; Task 3's `features.validatorsMap`; Task 1's `ValidatorRow.toml`.
- Produces (Tasks 5–7, 11):

```ts
// app/domain/validators-params.ts (browser-safe)
export interface ValidatorsParams { scope: ValidatorScope; publisher?: string; amendment?: string; country?: string; q?: string }
export const UNKNOWN_COUNTRY = "unknown";
/** The server's rule (spec §2): `country` is kept only while the switch is on (`codes` not null) and when it is `unknown` or in `codes`. */
export function withCountry(params: ValidatorsParams, codes: ReadonlySet<string> | null): ValidatorsParams;
```

  `tidy` (and so `parseValidatorsParams`, `validatorsHref`, `canonicalValidatorsParams`) reads `country`: `^[A-Za-z]{2}$` upper-cased, `unknown` in any case as `unknown`, anything else dropped; `validatorsHref` writes `scope`, `publisher`, `amendment`, `country`, `q`. `canonicalValidatorsParams` keeps `country` as given.
  - The loader: `const pure = withCountry(parseValidatorsParams(search), net.features.validatorsMap ? COUNTRY_CODES : null)`, before the pure redirect, so a country change is part of the first, call-free 302.
  - `filtered` keeps, with `country` set, the rows whose `toml?.server_country` is it, and with `unknown` the rows without one; with the scope and the other filters. `hasFilter` counts `country` (footer "matches", "Clear filters" clears it).
  - `validatorsMeta`: a view with `country` is `noindex, follow`, no canonical, no `og:*`.

- [ ] **Step 1: Write the failing tests.** `validators-params.test.ts`: `it.each` `country=de`→`DE`, `UNKNOWN`→`unknown`, `deu`, `d3`, `12`, `` → dropped; `it("orders scope, publisher, amendment, country, q")`; `it("reads the first of two countries")`; `describe("withCountry")`: off (`null`) drops it, `UK` and `ZZ` (not in the codes) dropped, `DE` and `unknown` kept. `validators-view.test.ts`: `it("keeps the rows of a country, and those of unknown location, with the scope")`; `it("counts country as a filter")`. `meta.test.ts`: `it("makes a country view noindex, follow without canonical or og")`. `validators-page.spec.ts` (`describe("the country parameter")`, Review Focus 1): `it("is a pure redirect: ?country=de, Unknown, uk, zz, two countries and the order, each one 302 of class short with no call")` (Locations `/xrpl/validators?country=DE`, `?country=unknown`, `/xrpl/validators`, `/xrpl/validators`, `?country=DE`, `?scope=all&country=DE&q=x`); `it("lists the validators of DE, and those of unknown location")` (the fixture's L rows grouped: the page's rows are exactly them; the footer says "matches"); `it("is noindex on a country view")`. `validators-map-off.spec.ts` (`worker-off`, ruling R2): `it("leaves E6's 404 for every view with a country, with no call")` (`/xrpl/validators?country=DE`, `/xahau/validators?country=unknown`: 404, class `short`, `mock.requests` empty) and, in `validators-page.spec.ts`, `describe("with VALIDATORS_MAP off (the route's loader, with a load context of its own)")`: `it("redirects ?country=DE to the view without it, with no call")` (the loader called with `createLoadContext({ ...env, VALIDATORS_MAP: "off" }, ctx)`, as `account-analytics.spec.ts` does).
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass**: `pnpm verify`.
- [ ] **Step 5: Commit.** `git add` the files above — `feat(ui): a country parameter on the validators list`.

---

### Task 5: The map's view builder

**Files:**
- Create: `app/server/validator-map-view.ts`, `app/server/validator-map-view.test.ts`

**Interfaces:**
- Consumes: Task 2's `COUNTRIES`; Task 4's `validatorsHref` with `country`, `UNKNOWN_COUNTRY`; E6's `count`, `shareText`, `tomlFileOf`, `joinAnd`.
- Produces (Tasks 6, 7): spec §4.2's `ValidatorMapView`, `CountryRowView`, `CircleView`, with two fields added: `file: "xrp-ledger.toml" | "xahau.toml"` (the attribution's) and `limited: string | null` (E6's sentence "The first 1,000 validators in this order are shown." when L has a `marker`), and:

```ts
export function validatorMapOf(input: { network: NetworkInfo; params: ValidatorsParams; rows: readonly ValidatorRow[]; truncated: boolean }): ValidatorMapView;
```

  Exact values (spec §4.2): a row's country is `toml.server_country`; counts per country `validators` and `unl` (`unl: true`); rows ordered validators desc, then UNL desc, then `COUNTRIES[code].order` (a code it lacks after the named ones, by code); `total` every row; `share` `shareText(n, total)` (`"19.0%"`); `meter` `{ value: String(n), max: String(largest) }`; circles only for codes in `COUNTRIES`, largest first; `left` `${(x / 10).toFixed(2)}%`, `top` `${(y / 3.78).toFixed(2)}%`; `size` `Number(Math.max(10, 44 * Math.sqrt(n / largest)).toFixed(1))`; `label` `"Germany: 16 validators, 5 on the UNL"` (`1 validator`); `tip.counts` `"16 validators · 5 on the UNL"`; `tip.share` `"11.3% of the validators in All"`; `tip.hint` `"Select to show only this country in the list"`, chosen `"Select to show every country again"`; `href` `validatorsHref(net, { ...params, country: code })`, the chosen one's the view without `country`; `current` on the chosen; `dim` on the others while one is chosen; `order` the circle codes by `x`, then `y`; `unknown.count` `count(n)`, `href` `validatorsHref(net, { ...params, country: "unknown" })` when `n > 0`; `chosen` `{ name, clear }` (`name` the country's name, its code when unnamed, `"Unknown location"` for `unknown`); `unplaced` `"1 validator is in a country the map does not place: QQ."` / `"3 validators are in countries the map does not place: QQ and QZ."`; `options` every country of `rows` by `order` (`{ value: code, label: name }`), the chosen one added when it has no row (ruling R8), then `{ value: "unknown", label: "Unknown location" }` when the unknown count is above 0 or it is chosen.

- [ ] **Step 1: Write the failing test** `validator-map-view.test.ts` (rows built in the test; spec §10): `it("counts and orders the countries")`; `it("writes shares of All, unknown included")`; `it("sizes circles by area: the largest 44, none below 10")` (16 and 1 → 44 and 11; 27 and 1 → 44 and 10); `it("places a circle by the table's point")` (DE → `"52.89%"`, `"19.68%"`); `it("orders the circles west to east")`; `it("keeps the other parameters in every href, and the chosen country's clears it")`; `it("dims the others while one is chosen")`; `it("links unknown location only when there is one")`; `it("lists an unplaced code in the table, without a circle, with the note")` (Review Focus 3, `QQ`); `it("offers the countries by name, the chosen one, then unknown location")`; `it("answers an empty list")`; `it("answers an L with no row placed: no circle, no row, every validator unknown")` (Review Focus 2); `it("says when L was truncated")`; `it("names the file of the network")`.
- [ ] **Step 2: Run it to verify it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it to verify it passes**: `pnpm verify`.
- [ ] **Step 5: Commit.** `git add app/server/validator-map-view.ts app/server/validator-map-view.test.ts` — `feat(server): the validators map's view, counted from the list`.

---

### Task 6: The list page's data: the map part, the place, the Country select, the empty-UNL sentence

**Files:**
- Modify: `app/server/validators-view.ts` (`validatorsPage`, `ValidatorsPageData`, `ValidatorRowView`, `listOf`), `app/server/validators-view.test.ts`, `app/routes/net.validators.tsx` (features to the builder; `VALIDATORS_PARTS`), `app/ui/pages/ValidatorsPage.tsx` (`FilterForm`, `viewOf`, `ValidatorCell`, the empty state), `app/ui/pages/ValidatorsPage.test.tsx`, `test/worker/validators-page.spec.ts`, `test/worker/validators-page-failures.spec.ts`

**Interfaces:**
- Consumes: Task 5's `validatorMapOf`; Task 4.
- Produces (Task 7):
  - `validatorsPage` input gains `features: Pick<Features, "validatorsMap">`; `ValidatorsPageData.map: ({ state: "ok" } & ValidatorMapView) | { state: "failed" } | { state: "off" }` (ruling R1: `off`, not `null`), built from **all** of L's rows (`truncated: list.marker !== undefined`); `"failed"` when L failed.
  - `VALIDATORS_PARTS = ["summary", "list", "amendments", "map"]`: a beat whose L failed keeps the map with the list.
  - `ValidatorRowView.place: string | null`: the row's `toml.server_country` as its name (its code when unnamed), `null` without one or with the switch off.
  - The `list` ok state gains `unlEmpty: { text: string; link: { text: string; href: string } } | null`: with `scope` `unl` and a chosen country that has rows in All but none on the UNL, `"No validator in {name} is on the default UNL."` and `"Show the {n} in All"` → the same view with `scope: "all"`; else `null`.
  - `ValidatorsPage.tsx`: `FilterSelect name="country" label="Country" anyLabel="all countries"` with `map.options`, after "Votes yes for", while `map.state === "ok"`; while the map failed and `params.country` is set, a hidden `country` field (E6's rule for an undrawn filter); `viewOf` reads `country`; the row's sub-line is the short key, then ` · {place}` in a span that is not mono; the empty card shows `unlEmpty` (text, then the link) in place of "No validators match these filters." when set.

- [ ] **Step 1: Write the failing tests.** `validators-view.test.ts`: `it("gives the map from every row of L, whatever the chip and filters")`; `it("has the map off with the switch off, failed with L failed")`; `it("names the place of a row, and none without a server country or with the switch off")`; `it("says no validator of the country is on the default UNL, with a link to All")`. `ValidatorsPage.test.tsx`: `it("draws the Country select after Votes yes for, with the view's value")`; `it("keeps a country in a hidden field when the map failed")`; `it("draws the place after the short key")`; `it("draws the empty-UNL sentence and its link")`. `validators-page.spec.ts`: `it("shows each row's country and selects DE in the Country select on ?country=DE")`; the loader-off describe gains `it("has the map off and no place with VALIDATORS_MAP off")`. `validators-page-failures.spec.ts`: `it("hides the Country select and keeps ?country=DE in a hidden field when L fails")` (degraded, not stored).
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass**: `pnpm verify`, `pnpm test:e2e -- validators`.
- [ ] **Step 5: Commit.** `git add` the files above — `feat(ui): the validators list's Country filter and each validator's country`.

---

### Task 7: The countries card

**Files:**
- Create: `app/ui/pages/ValidatorsMapCard.tsx`, `app/ui/pages/ValidatorsMapCard.test.tsx`
- Modify: `app/ui/components/DataTable.tsx` (**Growth**: `rowProps`) and its test, `app/ui/pages/ValidatorsPage.tsx` (the card's place and its hold), `app/ui/pages/ValidatorsPage.test.tsx`, `app/ui/pages.css`, `test/unit/validators-bundle.test.ts`, `test/worker/validators-page.spec.ts`, `test/worker/validators-page-failures.spec.ts`

**Interfaces:**
- Consumes: Task 6's `ValidatorsPageData.map`; Task 2's `world-dots.svg`; E2's `DataTable`, `Meter`, `SectionError`, `useHolds`.
- Produces:

```ts
// DataTable gains (E2 §2.11: props grow)
rowProps?: (row: Row, index: number) => { className?: string; onPointerEnter?: () => void; onPointerLeave?: () => void };
// ValidatorsMapCard.tsx
export function ValidatorsMapCard(props: { map: ValidatorsPageData["map"]; holds: HoldHandlers; onRetry: () => void; retrying: boolean }): JSX.Element | null; // null while "off"
/** The tooltip's CSS transform beside a circle (the board's rule, ruling R10): horizontally -14px when left < 14 %, calc(-100% + 14px) when left > 86 %, else -50 %; below by size/2 + 8 px when top < 42 %, else above (calc(-100% - (size/2 + 8)px)). */
export function tipTransform(circle: Pick<CircleView, "left" | "top" | "size">): string;
```

  The card (spec §4.1, §4.3), between the overview tiles and the versions card: `<section className="card vmapcard" aria-labelledby="validators-map-title" {...holds}>` (the page passes `holds("countries")`); head `<h2 id="validators-map-title">Where validators are</h2>` and the source line `/v2/network/validators`; when chosen, "The list below shows **{name}**" and a "Clear country" `Link` to `chosen.clear`. The map: `.vmap` (`aspect-ratio: 1000 / 378`) holding `<svg className="vmap__dots" viewBox="0 0 1000 378" preserveAspectRatio="none" aria-hidden="true" focusable="false"><use href={`${dotsUrl}#dots`} /></svg>` (`import dotsUrl from "../map/world-dots.svg?url"`), then one `Link` per circle (`preventScrollReset`, `aria-label` the label, `aria-current="true"` when chosen, `tabIndex` 0 on the chosen one else the largest and −1 on the rest, style `left`, `top`, `--d: {size}px`), in a `div role="group" aria-label="Map of validators by country" aria-describedby` the attribution's id; the tooltip (`aria-hidden`, never in the server's HTML) on hover or focus of a circle, hidden by Escape. Keyboard once hydrated: ArrowRight/ArrowDown the next of `order`, ArrowLeft/ArrowUp the previous, Home/End the first and last; Enter follows the link. The table: `DataTable compact live label="Validators by country" maxHeight={282}`, rows keyed by code, columns Country (a `Link` to `href`, `aria-current="true"` on the chosen), Validators, On UNL (end), Share (`Meter small decorative` and the text); `rowProps` highlights the circle while the pointer is over a row, and a circle's hover or focus highlights its row; the chosen row has the accent wash. Footer: the legend (a swatch "Validators, located by their toml", "Circle area shows the count") and "Unknown location: **{count}** validators" (a `Link` to `unknown.href` when set), then `limited`. Attribution `<p id>`: "Validator locations come from `server_country` in each validator's verified {file}. A validator without a verified toml, or whose toml gives no valid `server_country`, has an unknown location." and `unplaced`. No circle: the table's empty text "No validator's toml gives a server country yet.". Failed: `SectionError what="where validators are"` with Retry in place of map and table.
  - CSS (`pages.css`): `.vmap__dots { color: var(--border-strong) }`; circles a round 1.5 px `--accent` border over `color-mix(in srgb, var(--accent) 25%, transparent)`, `width`/`height` `var(--d)`, centred (`translate(-50%, -50%)`), a transparent `::after` 6 px wider on every side; current a 2.5 px `--fg` ring; highlighted a 2 px `--fg` ring, raised; dim `opacity: .35`; `.vmapcard` a container: below 560 px the circles are `max(8px, calc(var(--d) * 0.6))`; the table `flex: 1 1 400px` beside the map, under it when narrow; a highlighted row `--sunken`. No motion beyond the highlight.

- [ ] **Step 1: Write the failing tests.** `ValidatorsMapCard.test.tsx` (spec §10, Review Focus 4): `it("draws each circle as a link with its name, and aria-current on the chosen one")`; `it("is one Tab stop: the chosen circle, else the largest")`; `it("moves focus west to east with the arrows, and to the ends with Home and End")`; `it("shows the tooltip on focus and hover, and hides it on Escape")`; `it("highlights the row of a hovered circle and the circle of a hovered row")`; `it("links the unknown chip, and draws no link at 0")`; `it("draws the empty state and the unplaced note")`; `it("draws SectionError when the map failed, and nothing when off")`; `it("places the tooltip by the board's rule")` (`tipTransform` at left 10 %, 50 %, 90 % and top 20 %, 60 %). `DataTable` test: `it("spreads rowProps on each row")`. `ValidatorsPage.test.tsx`: `it("draws the card between the tiles and the versions")`. `validators-bundle.test.ts`: `ValidatorsMapCard.tsx` imports nothing of `app/server` as a value. `validators-page.spec.ts`: `it("counts the map from L's rows, on both networks")` (the card's table rows equal the fixture's rows grouped by `toml.server_country`, the unknown count the rest); `it("draws the dots by <use> of the asset, never the path itself")` (the HTML matches `/<use href="[^"]*world-dots[^"]*\.svg#dots"/` and does not contain `M316.0 3.5h0`). `validators-page-failures.spec.ts`: `it("says Couldn't load where validators are when L fails, degraded")`.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass**: `pnpm verify`, `pnpm test:e2e -- validators`.
- [ ] **Step 5: Commit.** `git add` the files above — `feat(ui): the validators map and countries table`.

---

### Task 8: The bundle check knows the map's asset

**Files:**
- Modify: `scripts/bundle-budget.ts`, `scripts/check-bundle.test.ts`, `README.md` ("The client bundle check": the two problems and the measured figures)

**Interfaces:**
- Consumes: Task 2's `app/ui/map/world-dots.svg`; Task 7's import of it.
- Produces:

```ts
export const MAP_ASSET = /^assets\/world-dots-[\w-]+\.svg$/;
/** The first 32 characters of the `d` attribute of the dots' path: what no script of the build may hold. */
export function dotsNeedleOf(svg: string): string;
export function checkBundle(dir: string, options?: { dotsNeedle?: string }): BundleReport; // default needle read from app/ui/map/world-dots.svg beside the scripts
```

  Two new problems (spec §1.4): `${file} holds the world map's dots, which belong in assets/world-dots-*.svg alone` for every `.js` file of the build that holds the needle; `the build has ${n} assets/world-dots-*.svg files, not one` when there is not exactly one.

- [ ] **Step 1: Write the failing tests** (`check-bundle.test.ts`): `fakeBuild` gains `map?: boolean` (default true: `assets/world-dots-abc123.svg` holding a path that starts with the test's needle), and every existing build passes as before; `it("fails a script that holds the dots, and names it")`; `it("takes the dots in the svg itself, and in a stylesheet")`; `it("fails a build without the map's asset, and one with two")`; `it("reads the needle from the d attribute")` (`dotsNeedleOf`).
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Measure and run**: `pnpm build && pnpm check:bundle` passes; record the validators and validator pages' figures (both dashboards, 160,000 B) and the asset's gzipped size in the README's table, as E6 did; `pnpm verify`.
- [ ] **Step 5: Commit.** `git add scripts/bundle-budget.ts scripts/check-bundle.test.ts README.md` — `feat(ui): the bundle check keeps the map's dots in their asset`.

---

### Task 9: The toml card's view builder

**Files:**
- Modify: `app/server/validator-facts.ts`, `app/server/validator-facts.test.ts`, `app/server/validator-view.ts` (`TomlCardView`, `tomlCardOf`, `validatorPage`, `ValidatorLiveData`), `app/server/validator-view.test.ts`

**Interfaces:**
- Consumes: Task 1's `ValidatorTomlDetail`; Task 2's `COUNTRIES`; Task 3's `Features.validatorsMap`; E6's `tomlLink`, `tomlFileOf`, `accountLinks`, `count`, `joinAnd`; `formatDate`, `formatCurrency`; E7's `NetworkKind`; E11's `tokenLink`, `parseTokenPath`, `Features.tokens`.
- Produces (Task 10):

```ts
// validator-facts.ts
export type TomlNetworkKind = "mainnet" | "testnet" | "devnet";
/** The name of a toml's `network` value (compared lower-case; spec §5.2): rippled main, mainnet → XRPL mainnet; testnet → XRPL Testnet; devnet → XRPL Devnet;
 *  xahaud main, mainnet, xahau, 21337 → Xahau mainnet; testnet, 21338 → Xahau Testnet; anything else null. */
export function tomlNetworkName(value: string, software: Network["software"]): { name: string; kind: TomlNetworkKind } | null;
/** The host of a toml's `unl` (`new URL(unl).host`), null when it does not parse. */
export function unlHostOf(unl: string): string | null;
/** Where a toml currency's code leads: with an issuer, `parseTokenPath(network, `${code}.${issuer}`)`; for kind "token", `tokenLink(net, path.asset, features)`; null without an issuer, for any other kind (an LP token, the native code, none), or while TOKENS is off. */
export function tomlCurrencyHref(net: string, entry: { code: string; issuer?: string }, network: Pick<NetworkInfo, "native">, features: Features): string | null;

// validator-view.ts: spec §5.2's TomlCardView, and
export function tomlCardOf(input: { network: NetworkInfo & { kind: NetworkKind }; validator: ValidatorDetail; features: Features }): TomlCardView | null;
// validatorPage's input gains `features: Features` and its `network` the `kind`; ValidatorLiveData gains `toml: TomlCardView | null`.
```

  `tomlCardOf` is `null` with the switch off, without a domain, or when `domain_verification.status` is not `verified`. Otherwise (spec §5.1):
  - `title` `"From {domain}'s toml"`; `file` `tomlFileOf(software)`; `href` E6's `tomlLink(dv, domain, software)` (ruling R7);
  - `checks`: `["The validator's manifest names ", domain, "."]` and `["The [[VALIDATORS]] list in ", domain, "'s ", file, " includes this master key."]` (as `TextPart[]`, plain strings);
  - `facts`: `null` when D's row has no `toml` (not read yet); else, in this order and each only when given except Server country: Owner country (`[name]`); Server country (`[name]`, or `["Not given"]` with sub `["so its location is unknown"]`); Network (`[value]`, `mono`, sub `[name]` or `["{name}, not this network"]` when its kind is not the page network's, `null` for an unnamed value); On a UNL, says the toml (`["Yes · ", host]`, `mono` meaning the last part is mono (ruling R9), sub `["its own claim; UNL membership above is from the lists"]`; left out when the host does not parse); Principals (`[joinAnd(principals)]`); Last modified (`[formatDate(modified)]`, sub `["from [METADATA]"]`). A country name comes from `COUNTRIES`, else the code;
  - `accounts` (ruling R6: drawn whenever `domain_verification.accounts` has an address, in the not-read state too): `addresses` from `accountLinks`, `listed` `` `${count(accounts_listed ?? addresses.length)} listed:` ``, `more` `` `and ${count(accounts_listed − addresses.length)} more` `` when above; `null` without an address;
  - `currencies` (read state only): items `{ text: formatCurrency(code), href: tomlCurrencyHref(…) }` in D's order, `more` `` `and ${count(currencies_listed − items.length)} more` `` when above; `null` when none.

- [ ] **Step 1: Write the failing tests** (Review Focus 5). `validator-facts.test.ts`: `it.each` every value of `tomlNetworkName` on both softwares, case-insensitively, and `"foo"`, `"21337"` on rippled → null; `unlHostOf("https://vl.ripple.com/x")` → `"vl.ripple.com"`, `"not a url"` → null; `tomlCurrencyHref` for `USD.r…` with TOKENS on and off, a 40-hex code, a code without an issuer, an LP-token code. `validator-view.test.ts` (`describe("tomlCardOf")`): `it("is null with the switch off, without a domain, and for an unverified or pending domain")`; `it("draws the head, the checks and the accounts, and says nothing more, while not read")`; `it("draws Server country Not given alone for {}")`; `it("draws every fact of a full toml, in order, with its words")`; `it("names another network's value, and says not this network on mainnet")` (`testnet` on XRPL mainnet → sub `"XRPL Testnet, not this network"`; in the sandbox, `kind: "testnet"`, → `"XRPL Testnet"`; Xahau `"21337"` → `"Xahau mainnet"`; `"foo"` → no sub); `it("leaves out an unl that does not parse")`; `it("says and N more for accounts and currencies")`; `it("links a currency only through tokenLink")`; `it("links the toml only by tomlLink")` (a `toml_url` that is not the domain's canonical file → `href: null`).
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass**: `pnpm verify`.
- [ ] **Step 5: Commit.** `git add` the files above — `feat(server): the view of a validator's toml card`.

---

### Task 10: The toml card on the validator page

**Files:**
- Create: `app/ui/pages/ValidatorTomlCard.tsx`, `app/ui/pages/ValidatorTomlCard.test.tsx`
- Modify: `app/ui/pages/ValidatorPage.tsx`, `app/ui/pages/ValidatorPage.test.tsx`, `app/routes/net.validators.$key.tsx` (`features` and the network's `kind` to `validatorPage`), `app/ui/pages.css`, `test/unit/validators-bundle.test.ts`, `test/worker/validator-page.spec.ts`

**Interfaces:**
- Consumes: Task 9's `TomlCardView`, `ValidatorLiveData.toml`; E9's `AccountLink`; E6's `ExternalLink`, `Parts`, `CheckIcon`.
- Produces: `export function ValidatorTomlCard({ card, net }: { card: TomlCardView; net: string }): JSX.Element`, drawn by `ValidatorPage` between the identity section and the agreement tiles when `data.toml !== null`; while it is drawn, the grid's "Accounts {domain} lists" fact is not (it moved into the card); with `toml` null the page is E6's.

  The card (spec §5.1): `<section className="card validator__toml" aria-labelledby="validator-toml-title">`; head `<h2 id="validator-toml-title">{title}</h2>`, the source line `/v2/network/validators/{key}`, and when `href` is set "View toml →" as `ExternalLink nofollow` with `<span className="sr">, {file}</span>`; "Domain, verified both ways" and the two checks, each with `CheckIcon` (`aria-hidden`) and `<span className="sr">Passed: </span>`; then either "The data API has not read this toml's details yet." (facts `null`) or the facts grid (`repeat(auto-fit, minmax(min(170px, 100%), 1fr))`, label, value via `Parts` with the mono rule, sub); under a rule the lists: "Accounts [[ACCOUNTS]]" with `listed`, an `AccountLink` per address and `more`; "Currencies [[CURRENCIES]]" with each item a `Link` when `href` is set, else mono text, and `more`; each list left out when `null`.

- [ ] **Step 1: Write the failing tests.** `ValidatorTomlCard.test.tsx`: `it("draws the head, the View toml link with its hidden file name, and the two passed checks")`; `it("draws the facts in order, a mono value and its sub")`; `it("says the data API has not read the details yet")`; `it("draws each account by AccountLink, and and N more")`; `it("links a currency only when it has an href")`. `ValidatorPage.test.tsx`: `it("draws the toml card between the identity and the agreement tiles, and moves the accounts line into it")`; `it("keeps E6's accounts line without a card")`. `validators-bundle.test.ts`: `ValidatorTomlCard.tsx` imports nothing of `app/server` as a value. `validator-page.spec.ts`: `it("draws the card of a verified validator from D")` (the `toml-full` case: its title, the facts' words, "View toml" to the toml file, the accounts' names from E9's fixture); `it("draws no card for an unverified validator")`; `it("says not read yet for a verified validator without toml")` (`toml-not-read`); `it("draws no card on a page of older validations")` (`?marker=`, spec §5.3); the loader-off describe (`VALIDATORS_MAP: "off"`) `it("has no toml card and keeps the accounts line")`.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to verify they pass**: `pnpm verify`, `pnpm test:e2e -- validators`.
- [ ] **Step 5: Commit.** `git add` the files above — `feat(ui): what a validator's verified toml says, on its page`.

---

### Task 11: End to end, accessibility, README, the full check and the rollout

**Files:**
- Modify: `test/e2e/validators.spec.ts`, `test/e2e/a11y.spec.ts`, `README.md` ("Validators and amendments": the countries card, the `country` parameter and its place in the canonical order, the toml card, the asset, the "Files" and "Tests" lists; "Switches"; "Upstream fixtures": the `toml` fields)

**Interfaces:**
- Consumes: everything above.
- Produces: the e2e cases of spec §10 and the documents.

- [ ] **Step 1: Write the e2e tests** (skipped and off-cased with `VALIDATORS_MAP` in `E2E_FEATURES_OFF`, as E6's are with `VALIDATORS`): `it("draws the map, and serves its asset as svg kept a year")` (the `<use>` target answers 200, `image/svg+xml`, `Cache-Control: public, max-age=31536000, immutable`); `it("narrows the list by a circle, a table link, the chip and the select")` (each goes to `?country=…`, the rows are that country's, circle and row current, "Clear country" back); `it("moves through the circles with the keyboard")` (Tab reaches one circle, the arrows move focus and show the tooltip, Enter follows); `it("works without JavaScript")` (a context with `javaScriptEnabled: false`: a circle's and a table name's links work; Review Focus 4); `it("shows the validator's toml card, its View toml link and its account names")`. `a11y.spec.ts`: axe on `/xrpl/validators`, `/xrpl/validators?country=DE`, `/xahau/validators` and the `toml-full` validator's page, in light and dark.
- [ ] **Step 2: Run them**: `pnpm test:e2e` passes; with `E2E_FEATURES_OFF=VALIDATORS_MAP` the new cases are skipped and the off-cases pass.
- [ ] **Step 3: The README** (spec §12), every section above.
- [ ] **Step 4: The full check**: `pnpm install` (only if `node_modules` is missing), `pnpm verify`, `pnpm fixtures:check`, `pnpm map:check`, `pnpm test:e2e`: every one exits 0.
- [ ] **Step 5: Write the deploy notes** (in the commit body and the task report) (spec Rollout): (1) D8 is deployed on both networks of the environment (migration 016, syncer, API), and `syncer_validators_toml_fields_total{outcome="read"}` has grown there (D8 re-reads the verified files within an hour); (2) set `"VALIDATORS_MAP": "on"` in that environment's block of `wrangler.jsonc` by a commit and a deploy (sandbox: by hand, as E7 says); turned on too early, every validator shows as unknown location, nothing breaks; (3) rolling back is `"off"` and a deploy; (4) the switch is in the cache generation, so the deploy that flips it serves fresh pages; no fixture, data or edge purge is needed.
- [ ] **Step 6: Commit.** `git add test/e2e/validators.spec.ts test/e2e/a11y.spec.ts README.md` — `test: the validators map and toml card end to end, and the README` (body: the deploy notes of Step 5).

---

## Rulings

- **R1 (spec §4.2 vs E2's `keepLoaded`).** `ValidatorsPageData.map`'s off state is `{ state: "off" }`, not `null`, and `"map"` joins `VALIDATORS_PARTS`: `keepLoaded` requires every part it names to have a `state`, and a map left out of the parts would show a failed card beside a kept list after a beat whose L failed (contrary to spec §4.5's third row, which says the card is kept).
- **R2 (spec §10's `validators-map-off.spec.ts` vs the `worker-off` project).** `worker-off` turns every switch off, `VALIDATORS` too, and then every validators view is E6's 404: that spec pins that a `country` changes nothing of it. The case production runs first, `VALIDATORS` on and `VALIDATORS_MAP` off, is tested in the `worker` project by calling the loaders with `createLoadContext({ ...env, VALIDATORS_MAP: "off" }, ctx)` (`account-analytics.spec.ts`'s precedent): the 302 dropping `country`, no map, no place, no toml card, E6's accounts line.
- **R3 (spec §1.1, names).** "CLDR's short form where it has one" is read as the CLDR English name, with the short form only for `HK`, `MO`, `PS` and `MM`, whose standard names carry a qualifier: CLDR's other short forms ("US", "UK", "Bosnia") are abbreviations the board does not use, and the rule reproduces the board's 55 names.
- **R4 (spec §1.1, points).** Ten ISO codes have no World Factbook entry of their own; their points are fixed in Task 2 (seven territories' own coordinates; `PS`, `UM`, `SJ` from the Factbook's West Bank, Wake Island and Svalbard entries).
- **R5 (spec §1.1, files).** The generator's functions are in `scripts/world-map-core.ts` and `scripts/world-map.ts` is only the command, the repository's rule for commands (api-sync, check-bundle): a module that runs on import cannot be imported by its test.
- **R6 (spec §5.1 "Not read yet").** The card's Accounts list is drawn whenever `domain_verification.accounts` has an address, in the not-read state too: E6's accounts line moves into the card while the switch is on, and D1's accounts are not D8's to wait for.
- **R7 (spec §5.2 `href`).** The card's link to the file is E6's `tomlLink` (the canonical `https://{domain}/.well-known/{file}` of a verified domain), stricter than "toml_url when it is an https URL", and E6's `ExternalLink nofollow` (`noopener noreferrer nofollow`).
- **R8 (spec §4.2 `options`).** A chosen country with no row is added to the select's options, as the unknown option is, so the select shows the view it is on.
- **R9 (spec §5.2 `facts[].mono`).** `mono` means the value's last part is mono: the whole value for Network, the host after "Yes · " for the UNL.
- **R10 (spec §4.3 tooltip).** The flip rule is the board's, written out in Task 7 (`tipTransform`).
- **Additions to spec §4.2's interface:** `ValidatorMapView.file` (the attribution's file name) and `limited` (E6's sentence for a truncated L), and `validatorMapOf`'s `truncated` input.
