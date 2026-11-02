# Validators map and the validator's toml card (E13): design

Status: proposed (2026-10-24), program 2, sub-project E13. Repository `x-explorer`, branch `feat/explorer-pages-2`.

- Boards: `2026-10-24-explorer-mock/Validators.dc.html` (the card "Where validators are": the dot-grid map, the countries table,
  "Unknown location: N", the legend and attribution; the Country filter; the country under each row) and `Validator.dc.html` (the card
  "From {domain}'s toml"). Of the Validators board only the map and the countries table are built: nodes are not (owner, 2026-10-24).
- Data: D8, `data-api/docs/superpowers/specs/2026-10-24-validator-toml-details-design.md` (`toml` on the validator rows and the
  detail, the `country` filter, `/v2/network/validators/countries`), on D1's routes.
- Builds on: E6 `2026-10-19-validators-amendments-pages-design.md` (the two pages, their loaders, classes, one-URL-per-view rule and
  live refresh), E9 `2026-10-24-display-names-design.md` (display names, `AccountLink`, the one names call), E11
  `2026-10-24-token-pages-design.md` (token links, `TOKENS`), E7 `2026-10-24-sandbox-environment-design.md` (the sandbox and its
  networks). Overview: `2026-10-24-explorer-program-2-overview.md`.

## Owner decisions to confirm

| # | Decision (and deviation from the board) | Recommendation |
| --- | --- | --- |
| 1 | The map and the countries table are counted in the Worker from L (`scope=all`, `limit=1000`), which the page already loads, instead of calling `/v2/network/validators/countries`: a country's figure is always the number of rows its click shows. The card's source line reads `/v2/network/validators`. | Keep |
| 2 | A circle and a country's name in the table are **links** (`?country=DE`), with `aria-current`, not `<button aria-pressed>`: a URL per view (E6's rule), and it works without JavaScript. | Keep |
| 3 | The map is one Tab stop; the arrow keys move between circles, west to east. The table holds every country as a link and is the full keyboard and screen-reader path. | Keep |
| 4 | A circle's **area** is proportional to its count (diameter 44 px × √(n / largest), at least 10 px), not the board's 10 + 34 × √(n / largest), which makes one validator look a quarter of 27. The legend's "Circle area shows the count" is then true. | Keep |
| 5 | The map always counts every validator of All, whatever the UNL / All chip; a click keeps the chip. On UNL, a country with no UNL validator shows "No validator in {country} is on the default UNL" and a link to All. | Keep |
| 6 | "Unknown location: N" links to the validators without a location (`?country=unknown`), and "Unknown location" is the last option of the Country select. | Keep |
| 7 | The attribution names only the toml (no DB-IP sentence: nodes are not built). | As the brief |
| 8 | Every ISO country has a point (the World Factbook's public-domain coordinates; the board's 55 hub points kept). A code the explorer's table lacks gets a table row named by its code, no circle, and a note under the map. | Keep |
| 9 | The toml card is drawn only for a verified domain (the note under the heading already says why another is not). A fact the toml leaves out is not drawn, except Server country ("Not given"), which explains an unknown location. | Keep |
| 10 | No "Servers [[SERVERS]]" cell (nodes deferred). Accounts: every account D serves (up to 10) with its display name, "and N more" only beyond them, not the board's two and "and 1 more". The card's source line is `/v2/network/validators/{key}`, not `/v2/toml/{domain}`. | Keep |
| 11 | "Network": the toml's value as written, with a name for the known values ("XRPL mainnet") and ", not this network" when it names another. "On a UNL, says the toml": the host of its `unl` URL, as text, never a link. | Keep |
| 12 | The dots are a static asset (`/assets/world-dots-<hash>.svg`) drawn with `<use>`: no byte of the 32 KB path in any page's JavaScript or HTML, one request cached for a year. | Keep |
| 13 | The countries card holds the live page while the pointer or keyboard focus is in it, as the live tables do. | Keep |

## Goal

The validators list shows where the validators are: one circle per server country on a dot-grid world map, sized by the number of
validators, with a tooltip on hover and focus, a countries table beside it that follows the map, "Unknown location: N", and a click
that narrows the list to a country. The validator page shows what the validator's verified toml says about it. Both from the data
API's D8 fields, server-rendered, on both networks, in production and the sandbox, behind the switch `VALIDATORS_MAP`.

## Scope and non-goals

In: the countries card and the Country filter of `/{net}/validators`, the country under each row, the toml card of
`/{net}/validators/{key}`, the generated map and country table, the switch.

Not in: nodes, the nodes map, IP geolocation (DB-IP), `[[SERVERS]]`; countries on the network page or in the validator's link
preview; search by country; a map on a phone that is more than the table's companion (the table carries the data there).

## 1. The world map: what the explorer owns

### 1.1 The generator

The mock kit's `worldmap.py` (rough land outlines sampled every 2.5°, one SVG path of zero-length segments) becomes TypeScript in this
repository, so that the pipeline needs no Python:

| File | Holds |
| --- | --- |
| `scripts/world-map-data.ts` | `LAND` and `WATER` (the kit's polygons, `[lon, lat][]`, copied as they are), and `COUNTRY_POINTS`: `[code, name, lat, lon]` for the 250 codes D8 accepts (the 249 ISO 3166-1 alpha-2 codes assigned on 2026-10-24, and `XK`). Names are the English short names (CLDR's short form where it has one: "Hong Kong", "Türkiye"); points are the board's 55 hub points where it has one, else the CIA World Factbook's "Geographic coordinates" (public domain). |
| `scripts/world-map.ts` | The generator: `pnpm map:sync` writes the two outputs; `pnpm map:check` changes nothing and exits 1 when either differs from what it would write. |
| `scripts/world-map.test.ts` | In `pnpm test` (the `unit` project): the outputs are current (the check, in memory, as `http-fixtures.test.ts` does for the fixtures), and the rules below. |

The projection is the kit's, kept exactly: equirectangular into a box of 1000 × 378 (`viewBox="0 0 1000 378"`), longitude −180…180,
latitude 78…−58, `K = 1000 / 360`, `x = (lon + 180) × K`, `y = (78 − lat) × K`. A dot is drawn at the centre of each 2.5° cell whose
centre is in a `LAND` polygon and in no `WATER` polygon (even-odd ray casting), as `M{x} {y}h0` with one decimal (`toFixed(1)`); the
dots are joined into one path (2,374 dots, 32,104 characters, 6.3 KB gzipped). A country's point uses the same projection, with
`y` clamped to 0…378 (Antarctica sits on the bottom edge). The port need not reproduce the kit's `worldmap.json` byte for byte; from now
on the TypeScript is the source.

**Outputs** (each starts with a line saying it is generated by `scripts/world-map.ts` and must not be edited):

- `app/ui/map/world-dots.svg`:
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 378"><path id="dots" d="M316.0 3.5h0…" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>`
- `app/server/countries.ts`: `export const COUNTRIES: Readonly<Record<string, { name: string; x: number; y: number; order: number }>>`
  (x and y in the box, one decimal; `order` the place of the name in English alphabetical order, from `Intl.Collator("en")` at
  generation time, so that the view builders sort without `Intl`) and `export const COUNTRY_CODES: ReadonlySet<string>`.

**The test's rules**: 250 codes, each `^[A-Z]{2}$`, unique, with a name and a point inside the box; `UK`, `EU` and `ZZ` absent; every
point of the board's 55 equal to the kit's (to 0.1); a few projections by hand (0°, 0° is `500.0, 216.7`).

### 1.2 Drawing the dots

```tsx
import dotsUrl from "../map/world-dots.svg?url";
// …
<svg className="vmap__dots" viewBox="0 0 1000 378" preserveAspectRatio="none" aria-hidden="true" focusable="false">
  <use href={`${dotsUrl}#dots`} />
</svg>
```

- `?url` makes Vite emit the file into `build/client/assets/` with a hash in its name (it is far above the 4 KB inline limit), and
  gives the same URL string to the Worker's render and the browser's, as `styles.css?url` and the fonts do. `public/_headers` already
  keeps `/assets/*` for a year. The page's HTML holds only the `<use>`; the browser fetches the file once.
- The dots take `currentColor` from the `<use>`, which the stylesheet sets to `--border-strong` (the board's), in light and dark.
- The box is reserved before the file arrives (`.vmap { aspect-ratio: 1000 / 378 }`), so nothing moves; without the file the circles
  still stand on a blank box.

### 1.3 The country table on the server

`COUNTRIES` is imported only by the view builders (`app/server/`), which turn codes into names and points; a page receives text and
percentages. `test/unit/validators-bundle.test.ts` already keeps `app/server` out of the pages' browser files.

A **code without a point** can only be one `COUNTRIES` lacks: a code the data API accepts that this build does not know (a new ISO
assignment before the table is regenerated). Its row in the table is named by its code, it has no circle, and a note under the map
says "1 validator is in a country the map does not place: XY." Nothing fails.

### 1.4 What it costs

| | Before | With E13 |
| --- | --- | --- |
| Any page's JavaScript | | nothing of the map: the asset is not imported as a module, `countries.ts` is server-only |
| Validators page JavaScript | 148,246 bytes gzipped (E6's figure; program 2's earlier work adds its share) | + the card's component (about 2–3 KB), well under the 160,000 dashboard budget |
| Validators page HTML | | + about 25 circle links and table rows (about 2 KB gzipped) |
| One request | | `world-dots-<hash>.svg`, 6.3 KB gzipped, then cached |

`pnpm check:bundle` gains two problems (`scripts/bundle-budget.ts`, tested in `scripts/check-bundle.test.ts`): a `.js` file of
`build/client` that holds the first 32 characters of the dots path (read from `app/ui/map/world-dots.svg`), and a build without
exactly one `assets/world-dots-*.svg`.

## 2. Routes and URLs

No new route. `/{net}/validators` gains one parameter; `/{net}/validators/{key}` none.

`country` (`app/domain/validators-params.ts`): `ValidatorsParams.country?: string`, an upper-case code or `unknown`.

| Step | Rule |
| --- | --- |
| Pure (`parseValidatorsParams`, browser-safe) | Two ASCII letters, any case, become upper case; `unknown` in any case becomes `unknown`; anything else is dropped. |
| Server, before any call (`withCountry(params, codes)` in the loader) | Dropped when `VALIDATORS_MAP` is off (`codes` is `null`: an unknown parameter), or when the code is not in `COUNTRY_CODES` (`uk`, `zz`). |

The canonical order becomes `scope`, `publisher`, `amendment`, `country`, `q`. A query that is not canonical is E6's 302 of class
`short`; the country part needs no data, so it is part of the first, pure redirect. A view with a `country` is not the default view:
`noindex, follow`, no canonical link and no `og:*` (E6 1.4, `meta-validators.ts`). The live page's scope (`scopeOf`) is the
canonical href, so a refresh of one country's view never stands in for another's.

## 3. Data

- **No new call.** L (`validators({ scope: "all", limit: 1000 })`, kept 10 s) carries `toml` on its rows; D (`validator(key)`) carries
  the detail's `toml`. E6's calls, classes, deadlines and edge classes are unchanged; `PATHS` and `PENDING_PATHS` too.
- **Types** (`app/server/api-types.ts`, from D8's `docs/api-reference.md` at the commit the plan pins):
  `ValidatorRow.toml?: ValidatorToml` (`owner_country?`, `server_country?`, `network?`, `unl?`), and
  `ValidatorDetail.toml?: ValidatorTomlDetail` (those, plus `principals?: string[]`, `modified?`, `accounts_listed?`,
  `currencies?: { code: string; issuer?: string }[]`, `currencies_listed?`, `fetched?`).
- **Shape checks** (`validators-shape.ts`, inside the cached load): `toml` is an object when present; a country is `^[A-Z]{2}$`; the
  texts are strings; `principals` an array of strings; the counts non-negative integers; `modified` and `fetched` text. A malformed
  200 is kind `server` and not stored (E6's rule). A `network` value this build has no name for passes (it is shown as written).
- **Names** of the toml card's accounts come from E9's one names call of the validator page (E9 §1: `collectAddresses` over
  `grid.accounts`, from `domain_verification.accounts`, then `loadNames` with `holdFailure`, `names` in `keepLoaded`). E13 keeps that
  collection as it is: the same addresses are drawn in the grid with the switch off and in the toml card with it on, by `AccountLink`.
- **No header item**: the Validators page is reached through E12's Network menu (E8 §1.1's steps); E13 adds none.

## 4. The validators list

### 4.1 The countries card

Between the network overview tiles and the versions card, as on the board. A `section className="card vmapcard"
aria-labelledby="validators-map-title"`:

| Element | Content |
| --- | --- |
| Head | `<h2>` "Where validators are", source line `/v2/network/validators`. When a country is chosen, on the right: "The list below shows **Germany**" and a "Clear country" link (the view without `country`). |
| Map | 1.2's dots, then one circle per placed country (4.3), then the tooltip. `role="group"`, `aria-label="Map of validators by country"`, `aria-describedby` the attribution. |
| Table | Beside the map on a wide card (`flex: 1 1 400px`), under it on a narrow one. `DataTable compact`, label "Validators by country", `maxHeight` 282, columns: **Country** (a link, as the circle's; `aria-current="true"` on the chosen one), **Validators**, **On UNL** (end-aligned), **Share** (the kit's `Meter small decorative`, value n over the largest n, and the text "19.0%", n over every validator of All). Rows in the order of 4.2. |
| Footer | The legend: a swatch "Validators, located by their toml", "Circle area shows the count". The chip "Unknown location: **17** validators", a link to `?country=unknown` (keeping the scope and other filters) when the count is above 0. |
| Attribution | "Validator locations come from `server_country` in each validator's verified {xrp-ledger.toml\|xahau.toml}. A validator without a verified toml, or whose toml gives no valid `server_country`, has an unknown location." Then the unplaced note (1.3) when there is one. |

### 4.2 The view builder

`validatorMapOf({ network, params, rows })` in `app/server/validator-map-view.ts` (pure: no I/O, no clock, no `Intl`; unit-tested),
called by `validatorsPage` with **all** of L's rows (before the scope chip and the filters). Its result is
`ValidatorsPageData.map: ({ state: "ok" } & ValidatorMapView) | { state: "failed" } | null` (`failed` when L failed, `null` with the
switch off), and `"map"` joins nothing in `VALIDATORS_PARTS`: it is drawn from `list`, which `keepLoaded` already keeps.

```ts
export interface ValidatorMapView {
  total: number;                       // every row of L (the All count)
  circles: CircleView[];               // placed countries, the largest first (painted under the smaller ones)
  rows: CountryRowView[];              // every country with a validator
  unknown: { count: string; href: string | null };   // href null when 0
  chosen: { name: string; clear: string } | null;
  unplaced: string | null;             // the note of 1.3
  options: { value: string; label: string }[];       // the Country select (4.4)
  order: string[];                     // circle codes west to east (x, then y): the arrow keys' order
}
export interface CountryRowView {
  code: string; name: string; href: string; current: boolean;
  validators: string; unl: string; share: string; meter: { value: string; max: string };
}
export interface CircleView {
  code: string; href: string; current: boolean; dim: boolean;      // dim: another country is chosen
  left: string; top: string;           // "52.89%", "19.68%": x / 10, y / 3.78
  size: number;                        // diameter in px at full width: max(10, 44 × √(n / largest)), one decimal
  label: string;                       // "Germany: 16 validators, 5 on the UNL"
  tip: { name: string; counts: string; share: string; hint: string };
}
```

- A row's country is `toml.server_country`; a row without one is unknown. Counts per country: `validators` (rows), `unl` (rows with
  `unl: true`). Order: validators desc, then UNL desc, then the name's `order`.
- `share` is n over `total` (unknown included), with `shareText` (`bignumber.js`, one decimal); counts with `count`.
- `href` is `validatorsHref(net, { ...params, country: code })`; for the chosen country it is the view without `country` (a second
  click shows every country again, as on the board).
- `tip.counts` "16 validators · 5 on the UNL"; `tip.share` "11.3% of the validators in All"; `tip.hint` "Select to show only this
  country in the list" or, chosen, "Select to show every country again".
- `options`: every country of `rows`, by name (`order`), labelled with its name, then `{ value: "unknown", label: "Unknown
  location" }` when the unknown count is above 0 or it is the chosen value.

### 4.3 The map component

`ValidatorsMapCard` in `app/ui/pages/ValidatorsMapCard.tsx` draws 4.1 from `data.map`; it never fetches. It holds one piece of
browser state, the **highlighted** code (from a circle or a table row), so the two follow each other:

- **Circles** are React Router `Link`s with `preventScrollReset`, absolutely placed at `left`/`top` and centred, a round border in
  `--accent` over a 25% wash of it, `aria-label` the circle's `label`, `aria-current="true"` when chosen (a 2.5 px ring in `--fg`),
  `dim` at 35% opacity. Their size is `--d` px; in a card narrower than 560 px (a container query) it is 0.6 × `--d`, at least 8 px. A
  transparent `::after` 6 px wider on every side makes the target bigger; the table's links are the same targets at full size (WCAG
  2.5.8's equivalent).
- **Keyboard**: one circle has `tabIndex 0` (the chosen one, else the largest), the others `-1` (also in the server's HTML). Once
  hydrated, ArrowRight / ArrowDown move focus to the next circle of `order`, ArrowLeft / ArrowUp to the previous, Home / End to the first
  and last; Enter follows the link. Without JavaScript the table's links reach every country.
- **Tooltip** (hover or focus of a circle; Escape hides it): name, counts, share, hint, placed beside the circle and flipped near the
  box's edges (the board's rule), `aria-hidden` (the link's name says the same). None in the server's HTML.
- **Table sync**: pointer over a row highlights its circle (a 2 px `--fg` ring, raised); pointer over or focus on a circle highlights
  its row (`--sunken`). The chosen row has the accent wash. `DataTable` gets one optional prop for this, `rowProps?: (row, index) =>
  { className?: string; onPointerEnter?: () => void; onPointerLeave?: () => void }` (E2 §2.11: props grow, files are not forked).
- **Live**: E6's 10 s beat redraws the card from new data; circles and rows are keyed by code (`DataTable live`). The card spreads
  `holds("countries")` (`useHolds`), so the pointer over it or keyboard focus in it holds the page, as the live tables do.
- **Motion**: none beyond the highlight; `prefers-reduced-motion` changes nothing here.

### 4.4 The list and the filter

- **Filter**: `filtered()` in `validators-view.ts` keeps, with `country` set, the rows whose `toml.server_country` is it; `unknown`
  keeps those without. It applies with the scope and the other filters. `hasFilter` counts `country`, so the footer says "matches" and
  "Clear filters" clears it too.
- **The Country select** in the filter form: E6's `FilterSelect name="country" label="Country" anyLabel="all countries"` with
  `map.options`, after "Votes yes for". The form's other rules are E6's (Apply, a plain GET without JavaScript).
- **The row's place**: `ValidatorRowView.place: string | null`, the country's name (or its code, 1.3), drawn after the short key in
  the row's sub-line ("nHUkp7…wrZ6 · Finland"), as on the board.
- **Empty**: E6's "No validators match these filters." With the UNL chip, a chosen country that has validators but none on the UNL
  reads instead "No validator in {name} is on the default UNL." with the link "Show the {n} in All" (the same view with `scope=all`).

### 4.5 States and failures

| Case | Card |
| --- | --- |
| L failed (E6: "Couldn't load the validators") | `SectionError` "Couldn't load where validators are" with Retry, in place of the map and table; the Country select is hidden; a `country` in the URL is kept and the list card fails as E6 says. Degraded, not stored. |
| L answered, no row has a country (D8 not yet read the files, or an API without D8) | The dots, no circle, the table's empty text "No validator's toml gives a server country yet.", "Unknown location: 142". Not a failure. |
| A beat fails with the card shown | E6's `keepLoaded` already keeps `list`, from which the card is drawn. |
| More than 1,000 validators (L has a `marker`) | The card counts the first 1,000, and its footer adds E6's sentence. |

There is no loading state (the page is rendered whole in the Worker, as E6's), no coverage notice (the toml facts are not ledger
history, so D8's answers carry no `coverage`), and no new not-found case (a bad `country` is dropped by the 302).

### 4.6 Deviations from the board (beyond the table above)

| Board | Here | Why |
| --- | --- | --- |
| Tooltip "142 validators seen" share | "of the validators in All" | All includes UNL members not seen in 24 h |
| "Click to show…" hint | "Select to show…" | Keyboard and touch too |
| Country select without "Unknown location" | With it, when there are such validators | The chip's view needs a select value |

## 5. The validator page: the toml card

### 5.1 Layout and content

`ValidatorTomlCard` (`app/ui/pages/ValidatorTomlCard.tsx`, drawing `data.toml`; it never fetches): a `section className="card
validator__toml" aria-labelledby="validator-toml-title"` between the identity section and the agreement tiles, only for a **verified**
domain with `VALIDATORS_MAP` on. While on, E6's grid line "Accounts {domain} lists" moves into this
card (it stays as it is with the switch off).

| Element | Content |
| --- | --- |
| Head | `<h2>` "From {domain}'s toml", source line `/v2/network/validators/{key}`. On the right "View toml →", a link to `domain_verification.toml_url` with the visually hidden ", {xrp-ledger.toml\|xahau.toml}", `rel="nofollow noopener"` (E6 2.8: a verified toml is a link). |
| "Domain, verified both ways" | Two lines, each with the check icon and a visually hidden "Passed: ": "The validator's manifest names {domain}." and "The `[[VALIDATORS]]` list in {domain}'s {file} includes this master key." |
| Facts grid (`repeat(auto-fit, minmax(min(170px, 100%), 1fr))`) | **Owner country**: its name. **Server country**: its name, or "Not given" with "so its location is unknown". **Network**: the value in mono, with its name under it ("XRPL mainnet"), and ", not this network" when it names another (5.2). **On a UNL, says the toml**: "Yes · " and the `unl` URL's host in mono, with "its own claim; UNL membership above is from the lists". **Principals**: the names, "Mara Lindqvist and Tomas Okafor" (`joinAnd`). **Last modified**: `formatDate(modified)` with "from `[METADATA]`". A fact the toml does not give is not drawn, except Server country. |
| Lists (under a rule) | **Accounts `[[ACCOUNTS]]`**: "{accounts_listed} listed:" and an `AccountLink` (E9: the display name, the full address on hover, the label mark) for each address of `domain_verification.accounts`, then "and N more" when `accounts_listed` is above the addresses shown. **Currencies `[[CURRENCIES]]`**: each code as `formatCurrency` shows it, through E11's `tokenLink(net, { currency, issuer }, features)` (the token page while `TOKENS` is on, else text) when the entry has an issuer and a code `parseTokenPath` accepts, else plain mono text; "and N more" when `currencies_listed` is above them. Each list is left out when empty. |
| Not read yet | When D's row has no `toml` (D8 has not read the file since it was verified): the head and the two checks, then "The data API has not read this toml's details yet." |

### 5.2 The view builder

`tomlCardOf({ network, validator, features })` in `app/server/validator-view.ts` (pure), giving `ValidatorLiveData.toml:
TomlCardView | null` (`null` with the switch off, without a domain, or when `domain_verification.status` is not `verified`):

```ts
export interface TomlCardView {
  title: string;                         // "From northpeak.example's toml"
  file: string;                          // "xrp-ledger.toml"
  href: string | null;                   // toml_url when it is an https URL
  checks: TextPart[][];
  facts: { label: string; value: TextPart[]; sub: TextPart[] | null; mono: boolean }[] | null;   // null: not read yet
  accounts: { listed: string; addresses: string[]; more: string | null } | null;
  currencies: { items: { text: string; href: string | null }[]; more: string | null } | null;
}
```

- Country names from `COUNTRIES` (a code it lacks is shown as the code).
- `tomlNetworkName(value, software)` in `validator-facts.ts` (the values of D4's `tomlNetworkNames`, which D8 serves lower-cased as the
  file's claim, unchecked: the comparison is the explorer's): rippled
  `main`, `mainnet` → "XRPL mainnet"; `testnet` → "XRPL Testnet"; `devnet` → "XRPL Devnet"; xahaud `main`, `mainnet`, `xahau`,
  `21337` → "Xahau mainnet"; `testnet`, `21338` → "Xahau Testnet"; anything else no name. ", not this network" when the name's kind (mainnet, Testnet, Devnet) is not the
  page's network's (E7's network facts: mainnet in production, Testnet in the sandbox).
- The UNL host is `new URL(unl).host`; an unparsable value leaves the fact out.
- No `Intl`: dates with `time-words.ts`, counts with `count`.

### 5.3 States

The card depends on D alone, which decides the page (E6 4.4): it cannot fail on its own. The names of its accounts follow E9 (a failed
names call shows short addresses, never fails the page). The page of older validations (`?marker=`) has no card.

## 6. The switch `VALIDATORS_MAP`

- A **feature-level** switch (`app/ui/features.ts`: appended last to `FEATURE_VARS`, `FEATURE_NAME.VALIDATORS_MAP =
  "validatorsMap"`), with E2's steps: `Env`, every block of `wrangler.jsonc`, `TOP_LEVEL_SWITCHES`, the README's tables, the guard's
  misspelling case, a `*-off.spec.ts`, and the e2e skip.
- **Off**: no countries card, no Country select, no place under a row, no toml card (E6's accounts line instead); `country` is an
  unknown parameter (dropped by the 302). The loader makes the same calls either way (L and D carry `toml` regardless).
- **On under `VALIDATORS` off**: nothing to show, so no guard rule is needed.
- Values: `"on"` at the top level (development, tests); `"off"` in the sandbox and production until that environment's data API serves
  D8 on both networks and its `syncer_validators_toml_fields_total{outcome="read"}` has grown (D8 re-reads the verified files within
  an hour of its deploy, most within minutes). Turned on too early, the card shows every validator as unknown location: no error, nothing wrong but empty.
  Rolling back is `"off"` and a deploy.

## 7. Networks and the sandbox

- Xahau: `xahau.toml` in the attribution, the card's title line and "View toml"; network names of 5.2.
- The sandbox (E7): XRPL Testnet and Xahau Testnet, their own data APIs and fleets; a testnet's validators' files usually say
  `testnet` (or `21338`), named "XRPL Testnet" / "Xahau Testnet" with no "not this network". The map, the country codes and the
  generated files are the same everywhere.
- No node fallback: these facts exist only in the data API.

## 8. SEO, link previews, search

- Views with `country` are `noindex, follow` (2). The default view's tags are unchanged.
- No change to the validator's link-preview card and none to search.

## 9. Fixtures

`scripts/validators-fixtures.ts` (E6's synthetic generator, D8's shapes) gains, on both networks:

- `toml` on the list's verified rows, from a seeded pool of codes (about 20 countries on XRPL, 12 on Xahau, so the board's look): every
  case the pages draw, among them a verified row without `toml` (not read yet), one with `{}`, one with a country but no `network`, a
  row in `XK`, a Xahau `network` of `"21337"`, an XRPL `testnet` (the "not this network" case), and enough rows without a country for
  an unknown count above 0;
- the detail's `toml` extras for the fleet's first validators: principals, `modified`, `accounts_listed` above the served accounts,
  currencies with and without an issuer, one 40-hex code;
- E9's names answers for the accounts those details list.

`test/fixtures/PROVENANCE.md` ("Synthetic validators and amendments") says what they follow. `pnpm fixtures:check` covers them.

## 10. Testing

**Unit (Node)**

- `scripts/world-map.test.ts` (1.1).
- `validators-params.test.ts`: `country` parsing (case, `unknown`, three letters, digits), `withCountry` (off, a code not in the table),
  the canonical order, repeats.
- `validator-map-view.test.ts`: counts and order, shares, sizes (largest 44, smallest at least 10), `order` west to east, hrefs keep the
  other parameters, the chosen country's href clears it, `dim`, unknown and its href, an unplaced code, options sorted by `order`, an
  empty list, no row placed.
- `validators-view.test.ts`: the country filter with each scope and the other filters, the place, the empty-UNL sentence, `hasFilter`.
- `validator-view.test.ts` and `validator-facts.test.ts`: `tomlCardOf` for each state (not verified, not read yet, `{}`, full), every
  network name and the "not this network" case, the UNL host, the accounts' and currencies' "and N more", token links on and off.
- `validators-shape.test.ts`: `toml` accepted and refused shapes.
- `test/unit/validators-bundle.test.ts`: `ValidatorsMapCard.tsx`, `ValidatorTomlCard.tsx` and `validators-params.ts` import nothing
  of `app/server` as a value; `scripts/check-bundle.test.ts`: the two map problems (1.4).

**Components (happy-dom)**: `ValidatorsMapCard.test.tsx` (circles are links with names and `aria-current`, one Tab stop, the arrow
keys, Home / End, the tooltip on focus and hover and Escape, the row highlight both ways, the chip link, the empty state, the unplaced
note); `ValidatorsPage.test.tsx` (the card's place, the Country select, the place line); `ValidatorPage.test.tsx` (the toml card's
states).

**Worker** (`worker` project): `validators-page.spec.ts` (the map's counts equal L's rows grouped, for both networks; `?country=DE`
filters; `?country=de` is a 302 to `DE`; `?country=zz` a 302 without it; `?country=unknown`; the order of the parameters; `noindex` on a
country view), `validators-page-failures.spec.ts` (L failing: the card's `SectionError`, the select hidden, degraded),
`validator-page.spec.ts` (the card from D; not drawn for an unverified domain), and in `worker-off`
`validators-map-off.spec.ts` (no card, no select, `?country=DE` a 302 to the view without it, E6's accounts line).

**End to end** (`test/e2e/validators.spec.ts`, skipped and off-cased with `VALIDATORS_MAP` in `E2E_FEATURES_OFF`):

- the map draws, the asset answers 200 with `image/svg+xml` and `Cache-Control: public, max-age=31536000, immutable`;
- a click on a circle and on a table link goes to `?country=…`, the list shows that country's rows, the circle and row are current,
  "Clear country" goes back; the chip opens the unknown view; the Country select with Apply;
- the keyboard: Tab reaches one circle, the arrows move focus and show the tooltip, Enter follows;
- without JavaScript (a context with `javaScriptEnabled: false`): the circles and table links work;
- the validator page's toml card, its "View toml" link and its account names.

`a11y.spec.ts` adds axe runs on `/xrpl/validators`, `/xrpl/validators?country=DE`, `/xahau/validators` and a validator page with the
card, in light and dark.

## 11. Bundle budget

Every page's initial JavaScript stays under its budget (the validators and validator pages are dashboards, 160,000 bytes; the others
150,000). The map adds no JavaScript to any page (1.4); the validators page gains its card's component, the validator page the toml
card's (a few hundred bytes). The plan measures them with `pnpm build && pnpm check:bundle` and records the figures in the README's
table, as E6 did.

## 12. README

- "Scripts": `pnpm map:sync`, `pnpm map:check`.
- "Switches": the `VALIDATORS_MAP` rows (what it gates, its values, when it goes on).
- "Validators and amendments": the countries card (counted from L, links, keyboard, the hold), the `country` parameter and its place in
  the canonical order, the toml card, the asset; "Files" and "Tests" lists.
- "Upstream fixtures": the `toml` fields of the synthetic validators.
- "The client bundle check": the two map problems and the measured figures.

## Rollout

1. Built after D8 and E9 (E11 for the token links; without it the currencies are plain text). The switch is `"off"` in the sandbox and
   production when merged.
2. Turned on per environment by a commit and a deploy once its data API serves D8 (6).

## Dependencies

- **D8** (data API): `toml` on the validator rows and the detail; nothing else of it is called.
- **E6** as built (pages, loaders, `FilterSelect`, `useHolds`, `DataTable`); **E9** (`AccountLink` with display names, `loadNames`, the
  validator page's names call); **E11** (`tokenLink`, `parseTokenPath`, `TOKENS`); **E7** (the sandbox, the network facts used by "not
  this network").
- D4's `GET /v2/toml/{domain}` is not called: D carries what the card shows.
- The mock kit's `worldmap.py` (rough polygons, the 55 points) is the source of `scripts/world-map-data.ts`.
