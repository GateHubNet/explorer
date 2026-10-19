# Validators and amendments pages: design (E6)

Date: 2026-10-19. Status: proposed. Sub-project E6 of the explorer program. Repository: `GateHubNet/x-explorer`, branch `feat/explorer-pages`.

## Context

The foundation (`2026-10-17-explorer-foundation-design.md`, built, with the rulings in `../decisions/2026-10-18-explorer-foundation.md`) serves the home, ledger, transaction, account and search pages from one Cloudflare Worker (React Router 8.4, framework mode). The network dashboard spec (E2, `2026-10-19-network-dashboard-design.md`) adds `/{net}/network` and the parts every later page uses:

- the **chart kit** (`app/ui/charts/`): lines with a domain, steps and reference lines, `ShareBar`, `Meter`, `StatTile figure`, the Chart/Table toggle, the hover and keyboard layer;
- the **generalised live refresh**: `createLiveOnScreen({ order, merge })` (`app/ui/live-page.ts`), `useLiveControls`, `useLiveRows` on both axes;
- the **one-URL-per-view rule**: a query string that is not the canonical form of what it names is a 302 to that form, class `short`; only the default view is indexable;
- the **failure hold** (`holdFailure: true` on a subrequest);
- the **feature switches** (E2 §6.1): one per-environment Worker variable each, `app/ui/features.ts`, `net.features`, `useFeatures()`, `cacheGeneration(env)` and the pre-deploy guard, among them `VALIDATORS`, which replaces the earlier constant `VALIDATORS_PAGE_LIVE` and gates the validators and amendments pages and every link into them;
- the `navSection` route handle (§6.2), the generic `keepLoaded(next, shown, parts)` of `live-page.ts` (§6.3), the route-missing rule of `data-api.ts` (§6.4), the one `Anchor` type (`anchor.lastValidated`, §6.5), the running-bucket rule with `TimeSeriesData.forming` (§6.6, §2.3), and the README's cumulative `live-home` list (§6.9).

**Build order and shared pieces.** The program is built in the order D1, D2, E2, E3, E4, E6, E5. E6 uses E2's pieces above, E3's cache class `minute` (`2026-10-19-markets-design.md` §2.5) and E4's `TimeSeriesData.extras` (`2026-10-19-account-analytics-design.md` §3.2) as their owners define them, and redefines none. E6 defines the `Countdown` component (2.4), which E5 uses. Where a kit component needs a prop it does not have, the prop is added (E2 §2.11: "their props may grow; their files are not forked"); section 7 lists each one.

This spec adds four pages:

- `/{net}/validators`, the list, with the network overview tiles;
- `/{net}/validators/{key}`, one validator;
- `/{net}/amendments`, the list;
- `/{net}/amendments/{name}`, one amendment.

The approved boards are `2026-10-17-explorer-mock/Validators.dc.html`, `Validator.dc.html`, `Amendments.dc.html` and `Amendment.dc.html`, plus the validators card of `Network.dc.html`. Their sample data is placeholder, and their validators (`northpeak.example` and the rest) are fictional. The real pages show the validators the data API serves. No validator, domain or key is written into the explorer's code.

The data comes from the data API's sub-project D1, `data-api-new/docs/superpowers/specs/2026-10-19-validators-amendments-design.md` (branch `feat/explorer-data`, not built yet). D1 defines six routes (its section 3):

| Short | Route | D1 |
|---|---|---|
| S | `/v2/network/validators/summary` | 3.1 |
| L | `/v2/network/validators` | 3.2 |
| D | `/v2/network/validators/{key}` | 3.3 |
| VV | `/v2/network/validators/{key}/validations` | 3.4 |
| A | `/v2/network/amendments` | 3.5 |
| AD | `/v2/network/amendments/{name}` | 3.6 |

It also defines the status rules (enabled, majority, voting, obsolete, unknown; more than 80%; a hold of 14 days on XRPL and 5 days on Xahau) and its section 4 maps the boards to its fields. This spec uses the same letters. D1 also carries the five additions an earlier draft of this spec asked for (G1 to G5, section 9.5): a validator's accounts, the XLS URL, the list envelope on AD, unknown amendments among a validator's votes, and an optional majority ledger and transaction.

## Decisions (from the owner)

| Topic | Decision |
|---|---|
| Scope | Full: the validators list, the validator page, the amendments list, the amendment page, and the network overview tiles of the Validators board. |
| Model | Pages like xrpscan's. |
| Data | Extend the data API (D1). The explorer reads it over HTTP like everything else. |
| Networks | Both, XRPL and Xahau. |
| Mock | The four boards are approved. Their sample data is placeholder. |
| Process | Auto-mode build after this spec and its plan are reviewed. |

## Owner decisions to confirm

The product choices of this spec and its departures from the approved boards. Each is built as written unless the owner says otherwise.

| Choice | Why |
|---|---|
| The four pages, their images and the network page's links to them are off in staging and production (`VALIDATORS` `"off"`) until D1 has served that environment on both networks for at least two hours (section 10). | Before D1 there is nothing to show, and votes and tallies take about two hours to fill. |
| The validators filters are a form with an "Apply" button, not filtering as you type (section 3.1). | One URL per view, rendered in the Worker; no render per keystroke; a field never changes the page by itself (WCAG 3.2.2). |
| A "Listed by" filter by publisher, shown with two or more publishers (section 3.1). | The owner's list of filters. Xahau has one publisher, so it has none. |
| Every matching validator on one page, in D1's order: no paging and no sorting control (section 3.2). | About 150 rows at most; one URL per view, as xrpscan has it. |
| "Last seen" reads "< 1 min ago" under a minute, not "3 s ago" (section 2.4). | The list's data can be 55 s old. |
| "Other" in the versions bar groups older releases and validators whose version is not known (section 3.1). | The bar's five slots; the table lists each version. |
| A version keeps its colour as releases come and go: the colour follows the version string, never its rank among the newest (section 3.1). | A colour that moved with every release would mislabel the bar between visits. |
| Refresh every ledger (4 s) on a validator page, every 10 s on the validators list and every minute on the amendment pages (section 2.3). | Each page's data changes at that pace or more slowly. |
| "4 signing keys seen by the data API", not "signing key rotated 3 times" (section 4.6). | D1 counts the keys it has stored, a lower bound of the rotations. |
| "First seen" reads "Feb 2, 2022 · first seen by the data API" (section 4.6). | D1's first seen is its deployment's. |
| UNL membership lists every publisher, listed or not listed (section 4.1). | It shows which list is missing the validator. |
| 20 recent validations, signed to the second, with a "Not indexed yet" state, not 10 to the millisecond (section 4.1). | The foundation's list size; D1 serves `signing_time` in seconds, and `validated: unknown` exists. |
| The daily agreement axis starts at 99%, or at 95%, 90%, 50% or 0% when a day is lower (section 4.1). | A line under the axis would be lost. |
| A verified validator's TOML file is a link; an unverified domain never is (section 2.8). | The file is the evidence, and anyone can put any domain in a manifest. |
| Every sentence says "more than 80%" and uses D1's `needed`, not "80%", "holds at least 80%" or the board's spare count (sections 2.6, 6.2). | The protocol's rule; the board's numbers overstate the spare votes by one. |
| An "Unknown" status chip on the amendments list, shown when an unknown amendment exists (section 5.1). | D1's fifth status. |
| Page Up and Page Down move a day on the yes-votes chart, not Shift + arrow (section 6.2). | The ARIA slider pattern's large step. |
| No search by validator key or amendment name in the site search (Non-goals). | A 64-hex input already means a transaction or a ledger hash; a third meaning is a follow-up of its own. |
| The validator page links the accounts its verified domain lists, as "Accounts {domain} lists" (section 4.1). | D1 serves them from a TOML that verified; the wording claims nothing more. |

## Goals

- The four pages show every element of their boards from D1's data, on both networks, server-rendered, with their charts in the stored HTML and readable without JavaScript.
- Every URL names one view. Validator keys, amendment names and filters each have one canonical form, and every other spelling redirects to it before any call it does not need.
- An open page stays current, at a pace that suits its data: every ledger on a validator page, every 10 s on the validators list, every minute on the amendment pages. The refresh, pause, hold and motion rules are the home page's.
- No age or countdown is ever in stored HTML. Ages and countdowns tick in the browser from absolute times, and an age is never shown more precisely than the data can be fresh.
- A failing D1 call costs the card that needs it, not the page, unless the page cannot exist without it.
- The data API sees one cached call per route (and per validator or amendment), never one per filter. Filters are applied in the Worker to one shared list.
- The pages ship safely before D1 is deployed: switched off, and answering 503s that are never stored if switched on in front of an API without D1.

## Non-goals

- Search that resolves validator keys or amendment names. A 64-hex input already means a transaction or a ledger hash (foundation §6), and an amendment ID is 64 hex too. Adding a third meaning changes the disambiguation and is a follow-up of its own.
- Sorting the validators table by column, CSV links, and the original's `/manifests` and `/reports` routes (they stay out of scope, as in D1).
- Validator names beyond the domain, countries, ASN, a topology map. D1 reads only `[[VALIDATORS]].public_key` from the TOML (D1 Non-goals).
- On the network page: domains instead of keys, and "N of the UNL signed". E6 changes only that card's links (section 1.5).
- A link-preview image of the two lists. Like the home and network pages, a list is out of date too soon to be a picture.
- Node-local facts (`vetoed`), predictions of fee voting, and notifications.

---

## 1. Routes and URLs

### 1.1 Routes

All four are children of the `/:net` layout in `app/routes.ts`, after `search`:

| Path | Route module (id `routes/…`) | Edge class | Indexable |
|---|---|---|---|
| `/{net}/validators` | `net.validators.tsx` | `live` (5 s + 30 s) | the default view only (1.4) |
| `/{net}/validators/{key}` | `net.validators.$key.tsx` | `live-home` (1 s + 2 s); with `?marker=`: `slow`, TTL 300 s | yes; marker pages `noindex, follow` |
| `/{net}/amendments` | `net.amendments.tsx` | `minute` (60 s + 30 s, E3's class) | the default view only |
| `/{net}/amendments/{name}` | `net.amendments.$name.tsx` | `minute` | yes |
| `/og/{net}/{validator\|amendment}/{id}.png` | the existing image route, two more kinds | `slow` | no |

Each module exports `loader`, `clientLoader` (2.3), `meta`, `headers = forwardCacheClass`, `handle` (1.5) and the component. Section 2.1 gives the reasons for each class. While E2's `VALIDATORS` switch is off, each of the four answers a 404 of class `short` before any call (section 10).

`/{net}/validators/summary` is not D1's summary: `summary` is not a key, so it is a 404 without a call (1.2).

### 1.2 Validator keys

D1's `{key}` takes a master key, a signing key (base58, `n…`) or 66 hex digits, and resolves a signing key through its manifest map (D1 3.3). **The canonical URL names the master key in base58**, as D1's `validation_public_key` writes it.

`parseValidatorKey(raw)` in `app/domain/validator-key.ts` is pure, uses `ripple-address-codec` (already a dependency) and runs before any call:

| Input (the path segment, exact) | Result | Response |
|---|---|---|
| A base58 node public key: `decodeNodePublic` accepts it (version byte `0x1C`, checksum, 33 bytes whose first byte is `0x02`, `0x03` or `0xED`) | `{ key }` | the loader calls D with it |
| 66 hex digits, any case, whose first byte is `0x02`, `0x03` or `0xED` | `{ key: encodeNodePublic(bytes), from: "hex" }` | 302 to `/{net}/validators/{base58}` with the same query string, class `immutable`, no call (a pure conversion, like X-address to classic address) |
| anything else (`summary`, a classic address, a truncated key) | `null` | 404 of class `short`, "validator {first 40 characters}", no call |

**A signing key.** The string alone cannot tell a master key from a signing key. The loader asks D for the key. When D's `validation_public_key` is not the key in the URL, the answer is a 302 to `/{net}/validators/{validation_public_key}`, with the same query string, class `slow`. A signing key belongs to one master key for good, but the mapping comes from D1's data, so it is kept for an hour, not a year.

**404.** D answers 404 `Validator not found`: the key is neither in D1's directory nor in `validator_seen` (D1 3.3). That is a route-specific message, so E2's route-missing rule keeps it `not_found`. The page is the not-found page of class `short`, "We couldn't find validator nHUkp7…wrZ6 on XRPL". It carries the offer "Look for it on Xahau", which links to `/{other}/validators/{key}`, as the ledger page offers a hash on the other network. A D 400 for a key that passed `parseValidatorKey` is the API's fault: a 503 through `upstreamOutage`, never a stored 404 (foundation ruling). A `Cannot GET` 404 (an API without D1) is kind `server` by E2's rule, so a 503 too (section 10).

### 1.3 Amendment names and IDs

D1's `{name}` takes a name (exact, else case-insensitive when that is unique) or a 64-hex ID in any case (D1 3.6). **The canonical URL names the amendment as D1 names it.** That is `name` exactly, in its case (`fixNFTokenNegOffer`, `AMM`). An amendment with no known name (status `unknown`, or a node that lacks the name, D1 F10) is named by its `id`, in upper case.

`parseAmendmentRef(raw)` in `app/domain/amendment-ref.ts` is pure and runs before any call:

| Input (exact) | Result |
|---|---|
| 64 hex digits, any case | `{ id: upper-cased }`. It is tested first, because a hex string that starts with a letter also matches the name pattern. |
| `^[A-Za-z][A-Za-z0-9_]{0,63}$` (every name of rippled's and xahaud's feature lists has this form: `fix1201`, `NonFungibleTokensV1_1`, `fix240819`) | `{ name }` |
| anything else | `null`: a 404 of class `short`, "amendment {first 40 characters}", no call |

The loader calls AD with what the URL holds (the upper-cased ID, or the name as typed). Then:

- When the URL is not the canonical name of the row AD returns (a case variant, an ID of a named amendment, a lower-case ID), the answer is a 302 to `/{net}/amendments/{name ?? id}`, class `slow`. The mapping is data, and an unknown ID may get a name later. The answer says only where the amendment lives, so it is cheap to keep for an hour.
- AD's 404 `amendment not found` (a route-specific message, `not_found` by E2's rule) is the not-found page of class `short`, "We couldn't find amendment XChainBridge on Xahau", with the offer "Look for it on XRPL" (`/{other}/amendments/{same segment}`). Many names exist on one network only. A 400 for a ref that passed the parser, and a `Cannot GET` 404, are 503s.

### 1.4 Query parameters, canonical form and indexing

Each loader reads only its own parameters. The E2 rule applies to all four pages: when the query string is not exactly the canonical form of the view it names, the loader answers a 302 to that form, `cacheClassHeaders("short")`, as the account page tidies `?tab=`. The canonical form drops:

- defaults;
- empty values;
- unknown values;
- repeats (the first one is read);
- unknown parameters.

It orders the rest as the tables below list them. An unknown parameter is dropped here, as on the network page and unlike the foundation's pages, for the same reason: a made-up query string would otherwise be a page and a render of its own.

**`/{net}/validators`**

| Parameter | Values | Default | Canonical | Checked against |
|---|---|---|---|---|
| `scope` | `unl`, `all` | `unl` | lower case; `unl` dropped | itself (pure) |
| `publisher` | a publisher id of S `unl.publishers[].id` (`vl.ripple.com`) | none | the id as S writes it; a case variant becomes it; an unknown id is dropped | S |
| `amendment` | an amendment in status `majority`, `voting` or `unknown`, as A names it (1.3's canonical form) | none | a case variant or the ID of a named one becomes the name; any other value (unknown, or an amendment in another status) is dropped | A |
| `q` | text | none | trimmed; empty dropped; more than 100 characters cut to the first 100 (D1's limit) | itself |

The pure part (`scope`, `q`, unknown parameters, repeats, order) is checked before any call. The parts that need data are checked once S and A have answered. One 302 carries both. When S or A has failed, its parameter is kept as given and applied as given (3.2). The page is then degraded, so it is not stored, and the next render checks again.

**`/{net}/amendments`**

| Parameter | Values | Default | Canonical |
|---|---|---|---|
| `status` | `majority`, `voting`, `enabled`, `obsolete`, `unknown` (D1's words, one vocabulary from API to URL; the chips say "Activating", "Voting", "Activated", "Obsolete", "Unknown") | all | lower case; one value; others dropped |

**`/{net}/validators/{key}`**: `marker` and `back`, as on the account page. `marker` must pass `isMarker`, else the answer is a 404 of class `short`, "that page of the validator's validations". `back` is the trail of newer markers (`parseTrail`), and is dropped without a `marker`.

**`/{net}/amendments/{name}`**: no parameter. Any query string is a 302 to the bare path.

**Indexing.** These URLs are indexable, with a canonical URL on the request's origin and `og:*` tags:

- `/{net}/validators`;
- `/{net}/amendments`;
- `/{net}/validators/{master key}` without a marker;
- `/{net}/amendments/{canonical}`.

Every other view (a scope, a filter, a status, a marker) is `noindex, follow`, with no canonical link and no `og:*` tags, as E2's non-default views and the account's marker pages are.

**Helpers** (`app/domain/validators-params.ts`, `app/domain/amendments-params.ts`; pure, small, imported by pages for their links):

- `parseValidatorsParams(search)` and `validatorsHref(net, params)`;
- `validatorHref(net, key, { marker?, back? })`;
- `parseAmendmentsParams(search)` and `amendmentsHref(net, { status? })`;
- `amendmentHref(net, nameOrId)`.

### 1.5 Navigation, breadcrumbs and the E2 link

- **Header.** The four pages belong to "Network". They use E2's `navSection` route handle as it is: the four routes export `handle = { navSection: "network" }`, as E2's network route does. The header's Network link gets `.is-current` on all five: `aria-current="page"` on `/{net}/network`, the section's own index route, and `aria-current="true"` on the four, which are inside its section.
- **Breadcrumbs** follow the boards. "Network" links to `/{net}/network`:

  | Page | Breadcrumb |
  |---|---|
  | List | `XRPL / Network / Validators` |
  | Validator | `XRPL / Network / Validators / {domain, or the short key in mono}` |
  | List | `XRPL / Network / Amendments` |
  | Amendment | `XRPL / Network / Amendments / {name, or the short ID}`, in mono |

- **Cross links** from the boards:
  - the validators list has "Amendments →";
  - the amendments list has "Validators →";
  - the validator page has "All amendments →";
  - the amendment page has "All validators →" (`?scope=all`).
- **The network page's links.** E2's `VALIDATORS` switch gates them. As E2 §6.1 says, a page's links that depend on a switch come from its view builder, in its data: `net.features.validators` decides, and each href is a string or `null`. While it is on:
  - E2's "All validators" is a link to `/{net}/validators?scope=all`: the card counts every validator the collectors heard, so its link opens the All scope;
  - the five "First seen" keys of the network page's validators card are links to `/{net}/validators/{key}`, which E6 adds to E2's view builder (`network-view.ts`) and `NetworkPage.tsx`. `/v2/ledgers/{hash}/validations` writes master keys, and a signing key there redirects (1.2).

  The values and when they change are in section 10.

### 1.6 Files

| File | |
|---|---|
| `app/routes/net.validators.tsx`, `net.validators.$key.tsx`, `net.amendments.tsx`, `net.amendments.$name.tsx` | The four routes |
| `app/domain/validator-key.ts`, `amendment-ref.ts`, `validators-params.ts`, `amendments-params.ts` | Pure parsing and links (1.2–1.4) |
| `app/server/validators-view.ts`, `validator-view.ts`, `amendments-view.ts`, `amendment-view.ts` | The view builders, one per page. Pure; unit-tested. |
| `app/server/validator-facts.ts` | What the builders share: score and fee text, version labels, domain status, amendment status (2.5, 2.6) |
| `app/ui/pages/ValidatorsPage.tsx`, `ValidatorPage.tsx`, `AmendmentsPage.tsx`, `AmendmentPage.tsx` | Draw the data. They never fetch. |
| `app/ui/components/Countdown.tsx` | Time until an absolute moment, ticking in the browser (2.4). E6 owns it; E5 uses it. |

Changes elsewhere:

- `data-api.ts`, `api-types.ts`: the six calls (2.1);
- `cache-class.ts`: the TTL constants of 2.1;
- `networks.ts`: `software: "rippled" | "xahaud"`, which `PublicNetwork` and `NetworkInfo` carry;
- `meta.ts`: four builders and two image kinds (section 8);
- `card-data.ts` and the image route: two card kinds;
- `format.ts`: `formatDate`, `formatDateTime`, `untilText`;
- `RelativeTime.tsx`: `coarse`;
- `use-live-refresh.ts`: `everyMs`;
- `icons.tsx`: shield, clock, ballot, minus-circle, question, latest, external;
- `network-view.ts` and `NetworkPage.tsx`: the five key links, each an href or `null` (1.5);
- the chart kit (section 7);
- `scripts/bundle-budget.ts`;
- the fixture generator;
- the README: a new section "Validators and amendments" (the routes, the switch, the classes, the refresh rates), the validator page appended to E2's cumulative list of `live-home` pages, the "Upstream fixtures" rows and the staging checklist.

The switch `VALIDATORS`, `app/ui/features.ts`, the `navSection` handle and the header's reading of it, `keepLoaded`, `Anchor` and `forming` are E2's; the class `minute` is E3's; `extras` is E4's. E6 adds none of them. E6 turns `VALIDATORS` on at the top level of `wrangler.jsonc` (E2 ships it off there until these pages exist).

---

## 2. What the four pages share

### 2.1 Calls, cache classes and edge classes

Every call goes to the data API through `clientsFor(context, net)` and the subrequest cache. No page calls the node.

| Call | Query | Subrequest class, kept | Why |
|---|---|---|---|
| `lastValidated` | | `live`, kept 2 s (`HOME_CALL_TTL_SECONDS`, the home page's key) | The live pages' `order` (2.3). It is shared with home and network, so it costs nothing new. |
| S `validatorsSummary()` | | `live`, kept 10 s (`VALIDATORS_CALL_TTL_SECONDS`) | D1 rebuilds its directory at most every 10 s (D1 3.0), so keeping it for less buys nothing. Keeping it for more holds back the seen counts, the negative UNL and the next flag ledger, which change within a minute or every flag ledger. 10 s is under D1's `max-age=30`, the bound D1 allows (D1 §4). |
| L `validators({ scope: "all", limit: 1000 })` | `limit=1000&scope=all` | `live`, kept 10 s | The same directory. One call per network serves every view of the list (3.2). |
| D `validator(key)` | | `live`, kept 10 s | The same directory: last seen and the newest validation change every ledger, but only as often as D1 rebuilds. |
| VV `validatorValidations(key, { limit: 20 })` | `limit=20` | `live`, kept 2 s (`VALIDATIONS_CALL_TTL_SECONDS`) | D1 reads it per request (D1 §9), and a new row arrives every ledger. 2 s is under D1's `max-age=5`. |
| VV with a marker | `limit=20&marker=…` | `slow`, kept 300 s (`VALIDATIONS_MARKER_TTL_SECONDS`) | Older rows do not change, apart from `validated: "unknown"` becoming `matches` once the ledger is indexed. D1's bound is `max-age=300`. |
| A `amendments()` | | `minute` (E3's class, kept 60 s) | Tallies and statuses change once per flag ledger (about every 15 min). 60 s bounds how late a new round shows, and is D1's `max-age=60`. One call per network serves the amendments list, the validator page and the validators list's filter (no `status` parameter: the builders filter). |
| AD `amendment(ref)` | | `minute` | As A. AD carries A's envelope (`ledger_index`, `rules`, `round`, `next_flag_ledger`, D1's G3), so the amendment page needs no A. |

`VALIDATORS_CALL_TTL_SECONDS = 10`, `VALIDATIONS_CALL_TTL_SECONDS = 2` and `VALIDATIONS_MARKER_TTL_SECONDS = 300` go in `cache-class.ts`. Each call asked for with a TTL has a cache entry of its own (`[kept N s]`), as E2's do. The amendment calls take `minute` as it is and need no constant.

**Calls per page** (made side by side):

| Page | Calls |
|---|---|
| Validators list | `lastValidated`, S, L, A |
| Validator page | `lastValidated`, D, VV, S, A |
| Validator page with a marker | D, VV with the marker |
| Amendments list | `lastValidated`, A |
| Amendment page | `lastValidated`, AD, S |

**Edge classes and why**

| Page | Class | Why |
|---|---|---|
| Validators list | `live`, 5 s + 30 s | What changes every ledger on it (last seen) is shown coarsely (2.4). The rest changes with D1's 10 s directory or more slowly. The open page asks every 10 s (2.3). With single flight a view renders at most once per 5 s per Worker instance, from calls that are almost always warm. |
| Validator page | `live-home`, 1 s + 2 s | Its recent validations follow the chain: a row per ledger, and the open page asks every 4 s, as the home and network pages do. With `live` a beat could get a copy 35 s old, and rows would come in steps of ten. A view exists only while someone has the validator open. Its calls are kept 2 to 60 s, so a render costs at most one VV call every 2 s per instance. E6 appends the validator page to E2's cumulative README list of the pages that follow the chain, and to the class's comment. |
| Validator page, `?marker=` | `slow` with `ttl: 300` | Old rows, read from a call kept 300 s. No live state on it (4.5). |
| Amendments list, amendment page | `minute` (60 s fresh, 30 s stale, E3's class) | The data changes once per flag ledger. Countdowns tick in the browser. A render a minute per view per instance is enough, and the open page asks every minute. |

**Worst-case age of what is shown**: what D1 holds, plus what the Worker keeps, plus the edge's fresh and stale time.

| Page | Worst-case age |
|---|---|
| Validators list | 10 + 10 + 35 = 55 s |
| Validator page | VV: 0 + 2 + 3 = 5 s; D: 10 + 10 + 3 = 23 s |
| Amendment pages | 10 + 60 + 90 = 160 s |

Section 2.4 shows ages to suit these bounds.

**Client methods** (`data-api.ts`; hand-written types in `api-types.ts` from the built `docs/api-reference.md` of `data-api-new`'s `feat/explorer-data` at the commit the plan pins, which documents D1 §3 as built, G1 to G5 included): `validatorsSummary`, `validators(q)`, `validator(key)`, `validatorValidations(key, q)`, `amendments()` and `amendment(ref)`. The optional fields are optional in the types: `domain_verification.accounts`, `xls_url`, `majority.ledger_index` and `majority.tx_hash`. Each method takes `{ ttl?, holdFailure? }`, and each checks its answer's shape inside the cached load:

- lists are lists;
- times are text;
- native amounts are decimal strings;
- `score` is text of four decimals;
- keys are base58 node keys (or `''` where D1 allows it);
- IDs are 64 hex.

A malformed 200 is an `UpstreamError` of kind `server` and is not stored, as `tx-shape.ts` does. The six paths are not in `api/openapi.yaml` until D1 is merged and `pnpm api:sync` runs, so they go in E2's `PENDING_PATHS`, outside the compile-time check. `test/unit/pending-paths.test.ts` fails once the sync brings them in, and says to move them into `PATHS`.

### 2.2 The loaders

Each live page's loader:

1. `requireNetwork`. With `VALIDATORS` off, a 404 of class `short` and no call (section 10). Then the pure checks of 1.2–1.4. A pure redirect or a pure 404 makes no call.
2. Side by side, all awaited with `Promise.allSettled`, every call with `holdFailure: true` (E2 §6.8: every page that polls opts in for every upstream call, as the home and network pages do). Card-level calls are raced against E2's 4.5 s deadline from the start of the loader. Past it the card is `failed` with the reason "took too long". Page-level calls (`lastValidated`, D, AD, and A on the amendments list) are not raced: the data API's own 5 s limit ends them, and they are the page.
3. Page-level failures, once everything has settled (nothing runs on behind an answered request):
   - `lastValidated` failing is `upstreamOutage(err, "the network")`;
   - D or AD follow 1.2, 1.3 and section 10;
   - A on the amendments list is `upstreamOutage`;
   - on the validators list, S, L and A all failing is `upstreamOutage` too: a list with none of them has nothing to show (3.3).
4. The data-dependent redirects (1.2–1.4).
5. The view builder. Every failed card is logged (`logProblem`), and the request is marked degraded (`markDegraded(context, reasons)`). A degraded answer is a 200 that is never stored.
6. `cached({ ...page, anchor: { lastValidated }, build: BUILD_ID }, class, opts)`, with E2's `Anchor` type.

Nothing is streamed or deferred. As on the network page, an open tab fetches the answer again whole on every beat. Cards hold `Loaded<T>` (`account-view.ts`: `ok`, `missing`, `failed`) or a view of their own with a `failed` state.

### 2.3 Live refresh

All four pages refresh while they are open, with E2's machinery as it is:

- a module-level `onScreen = createLiveOnScreen({ order, merge })`;
- a `clientLoader` that calls `onScreen.reload(scope, serverLoader)`;
- `useEffect(() => onScreen.show(scope, loaderData))`;
- the page keyed by `scope`, so another view is a first render and is not animated.

The `/:net` layout already says `onlyWhenParamsChange`, so a beat is one request for the route alone.

| Page | Beat (`useLiveRefresh({ everyMs })`) | `order` | `scope` | `merge` |
|---|---|---|---|---|
| Validator page | 4 s (`LIVE_REFRESH_MS`) | `d => d.anchor.lastValidated` (the ledger index of `lastValidated`) | `${net}/validators/${key}` | `keepLoaded(next, shown, ["recent", "summary", "amendments"])` (VV, S, A) |
| Validators list | 10 s (`VALIDATORS_REFRESH_MS`) | the same | `${net}/validators${canonical search}` | `keepLoaded(next, shown, ["summary", "list", "amendments"])` (S, with the tiles and the versions card made from it; L; A) |
| Amendments list | 60 s (`AMENDMENTS_REFRESH_MS`) | the same | `${net}/amendments${canonical search}` | none (A is the page) |
| Amendment page | 60 s | the same | `${net}/amendments/${canonical}` | `keepLoaded(next, shown, ["summary"])` (S) |

- **`everyMs`** is the one growth of `useLiveRefresh`. It is the base interval, default `LIVE_REFRESH_MS`. The backoff doubles from it up to `max(LIVE_REFRESH_MAX_MS, 4 × everyMs)`, so 60 s for the 4 s and 10 s pages, as today, and 240 s for the 60 s pages. The 10 s give-up, pause, hold and visibility rules are unchanged.
- **`keepLoaded`** is E2's generic merge in `live-page.ts`, used as it is: a beat whose answer has a named part `failed`, where the page on screen has it loaded, keeps the shown part, and a part that has never loaded shows its error. Each route passes its parts in its `merge`, as the table says.
- **The live row.** Under the `<h1>` each page has E2's status row, 44 px high from the start:
  - the live dot and "Live · updates every ledger" (validator page), "Live · updates every 10 s" (validators list) or "Live · updates every minute" (amendments);
  - then `LiveStatus` (the one `role="status"`), the held note and `LiveToggle` ("Pause live updates" / "Resume live updates", WCAG 2.2.2).

  The pause is one `sessionStorage` key for the tab, shared with home and network.
- **What moves.** Tables are `DataTable live`:
  - validators keyed by master key;
  - recent validations by ledger index and hash;
  - the amendments table and the two vote tables by amendment ID and by master key.

  New rows enter and moved rows slide, as on the home page. Figures and tiles are `LiveValue` with their text as the token. A chart whose `token` changed gets the plot mark of E2 §2.9. `prefers-reduced-motion: reduce` keeps the colours alone. There is no `aria-live`.
- **Hold.** A mouse or pen over a live table, or keyboard focus on a link or button in it, holds the page (the home rules, `holdsFocus`). The row then says "Paused while you look at the table". Charts do not hold.
- **The marker view** of a validator (4.5) does not refresh. It is history. It shares the route module, so the `clientLoader` exists, but it hands a marker view straight to `serverLoader()` without `onScreen`, and the page does not start `useLiveRefresh` or show the live row.

### 2.4 Times, ages and countdowns

The stored HTML carries absolute times, never an age or a countdown. All times are UTC.

| Kind | Component | Server's text (stored) | Browser's text |
|---|---|---|---|
| Age | `RelativeTime` | the absolute time, e.g. `15:42:51 UTC` | `3 s ago`, `4 min ago`, `2 h ago`, `5 d ago` (`relativeTime`) |
| Coarse age | `RelativeTime coarse={N}` (new prop) | as above | under N seconds: `< 1 min ago` (N = 60) or `< 5 min ago` (N = 300); from N on, as above |
| Countdown | `Countdown` (new): `at` (unix seconds), `approx`, `past`, `fallback` | `fallback`, e.g. `expected 15:53 UTC`, or `expected Oct 23, 2026` | `in ~11 min`, `in 4 days`, or `past` once the moment has gone |

- **Ticking.** `Countdown` uses `RelativeTime`'s shared one-second timer: one timer per page, none while the tab is hidden, `noClock` on the server and at hydration, and a `<time dateTime>` with the absolute time as its `title`.
- **`untilText(atMs, nowMs, { approx })`** is new in `format.ts`:

  | Time left | Text |
  |---|---|
  | 0 or less | the caller's `past` |
  | under 60 s | `under a minute` |
  | under 60 min | `N min`, rounded up |
  | under 48 h | `N h`, rounded down |
  | from 48 h | `N days`, rounded to the nearest day |

  `approx` puts `~` before the number. The flag ledger is an estimate, so it uses `approx`. A majority's activation is a set moment and does not.
- **Coarse ages** are where the data can be older than the age it would show (2.1). The validators list's "Last seen" uses N = 60 (its data can be 55 s old). The amendment page's vote tables use N = 300 (160 s). The validator page shows its last validation precisely from VV (5 s), and falls back to D's `last_seen` with N = 60 when VV failed.
- **Dates.** `formatDate(iso)` gives `Oct 9, 2026` and `formatDateTime(iso)` gives `Oct 9, 2026, 09:34 UTC`. Both are new in `format.ts`, with a fixed month table, deterministic. The kit's `labels.ts` uses the same table.

**Every countdown and timeline**

| Where | Source | Countdown (`past` text) | Absolute text beside it |
|---|---|---|---|
| Validators: tile "Next flag ledger"; amendments: rules paragraph | S, A or AD (its envelope) `next_flag_ledger.expected` | `in ~11 min` (`due now`) | `#107,748,352`, never a link (a future ledger) |
| "Activating, in N days" pill (lists, amendment page, validator page's votes) | `majority.expected_activation` | `Activating, in 4 days` (`Activating, at the next flag ledger`) | server: `Activating, expected Oct 23` |
| "Activates on" (amendment page), "Activating soon" (list) | the same | `in 4 days` | `on or soon after Oct 23, 2026, 09:34 UTC`: D1 enables it at the first flag ledger after that time, in the ledger after it (D1 2.7) |
| "Majority since" | `majority.since`, `majority.ledger_index` | none | `Oct 9, 2026 · ledger #107,540,993`; `Oct 9, 2026` alone when D1 has no indexed EnableAmendment for it, so no `ledger_index` (G5) |
| "Held for N days" | A's or AD's `rules.majority_hold_seconds` ÷ 86,400 | none | `14 days` (XRPL), `5 days` (Xahau). Never hard-coded. |
| History timeline (6.4) | AD `history[]`, newest first | the pending "Enabled, expected" item uses the activation countdown | event, date, ledger, transaction |
| Validator "First seen" | D `first_seen` | none | `Feb 2, 2022 · first seen by the data API` |
| Validator "Last seen", list "Last seen", vote tables | VV newest `first_datetime`, D or L or AD `last_seen` | ages as above | absolute on hover |

### 2.5 Statuses: icon and text

Every status is an icon and a word, never colour alone (foundation §7.1). It uses `Pill` (tones `ok`, `bad`, `neutral`) or the board's quiet `.st` text with an icon. Colour is only for `ok` and `bad`, which come with their icon.

| Status | Source | Shown as |
|---|---|---|
| Domain verified | `domain_verification.status = verified` | check-circle, `--ok`, "verified" (list), "Domain verified" (validator page) |
| Domain not verified | `unverified` | alert-circle, `--muted`, "not verified"; the validator page adds the reason (4.2) |
| Domain not checked yet | `pending` | clock, `--muted`, "not checked yet" |
| No domain | no `domain` | the short key in mono, with "no domain" under it; no badge |
| UNL | `unl` | shield, the `.tag`, "UNL", with "Listed by vl.ripple.com and unl.xrplf.org" as visually hidden text after the word (the board's `title` is kept for the mouse; it is not the accessible name) |
| Negative UNL | `negative_unl` | minus-circle tag, "Negative UNL" |
| Latest version | `version_latest` | the latest icon, `--ok`, "latest" |
| Agreement incomplete | `agreement_*.incomplete` | info icon, `--muted`, "incomplete" under the figure |
| Fee vote against now | `fee_vote` against S `fees` | list: `↑` or `↓` after the value, `aria-hidden`, with ", higher than now" or ", lower than now" as visually hidden text. Validator page: `neutral` pills with an arrow or an equals icon, "Higher", "Lower", "Same". |
| Amendment vote | `yes`, `no`, `none` | `ok` pill with a check, "Yes"; `neutral` pill with a cross, "No"; an outlined pill with a dash, "No recent vote" |
| Amendment `enabled` | | `ok` pill, check-circle, "Activated"; with `retired: true`, plus a `.tag` "retired" |
| Amendment `majority` | | `.pill.info` (accent wash), clock, "Activating, in 4 days" (Countdown) |
| Amendment `voting` | | `neutral` pill, ballot, "Voting" |
| Amendment `obsolete` | | outlined pill, minus-circle, "Obsolete" |
| Amendment `unknown` | | outlined pill, question, "Unknown" |
| Validation `matches` / `different` / `unknown` | VV `validated` | `ok` "Matches" / `bad` "Different hash" / `neutral` "Not indexed yet" |
| Validation kind | VV `full` | text "Full" / "Partial" |
| Publisher list | S `unl.publishers[].status` | `ok` and on the list: check, "listed". `ok` and off the list: dash, "not listed". `expired` or `unavailable`: the notice of 3.1. |
| Majority in a round | AD `rounds[].passes` | check, "Yes" / dash, "No" |

The `.pill.info` wash is `color-mix(in srgb, var(--accent) 12%, var(--surface))` with `--fg` text. `tokens.test.ts` gains that pair for both accents in both modes at 4.5:1 or better. The board's `.off` pill is the outlined style (`--muted` text, 1 px `--border` ring) and is added to `components.css`.

### 2.6 Numbers and text

The builders make every text from D1's exact strings with `bignumber.js`. No float reaches a label.

| Value | Rule | Example |
|---|---|---|
| Agreement | `score` × 100, 2 decimals (D1's 4 decimals make it exact) | `"0.9998"` → `99.98%`; `"1.0000"` → `100.00%`; no `score` → `—` |
| Ledgers counted | `missed`, `total`, `partial` with separators | `4 missed of 22,096 validated ledgers · 1 partial` |
| Base fee | whole native units × 10⁶, a whole number of drops | `"0.00001"` → `10 drops` |
| Reserves | whole native units (`formatAmount`) | `1 XRP`, `0.2 XRP` |
| Version | `version`; on Xahau `version_build` adds ` · build 4119` on the validator page only | `3.4.1`, `2026.10.13` |
| Yes share | `yes` ÷ `trusted` × 100: 1 decimal for text, 2 for chart values; `trusted` 0 → `—` | `88.6%` |
| Shares of versions | whole percent in bar labels (`<1%` under 0.5), 1 decimal in the table | `88%`, `87.8%` |
| Keys | `shortHash`: 6 + `…` + 4 | `nHUkp7…wrZ6` |
| Counts | `formatAmount` | `22,096` |

**More than 80%.** D1's rule is that an amendment passes when `yes > ⌊trusted × 80 / 100⌋`, or `yes ≥ 1` when `trusted = 1` (D1 F7). With two or more trusted validators that means more than 80%. Every sentence says "more than 80%" and uses D1's `needed` (`threshold + 1`). The meters' threshold tick sits at `rules.threshold_percent`.

### 2.7 Failures, the common rule

- A card that failed shows `SectionError` ("Couldn't load {what}." and Retry) in place of its content.
- Retry is E3's `useRetry()` (`app/ui/use-retry.ts`: `useRevalidator().revalidate()`, the explorer's own `.data` URL). It works while the visitor has paused the updates. Within the failure hold it gets the held failure, and the next beat after the hold gets a fresh answer.
- Tiles whose call failed show "—" with "Couldn't load" under it, and one `SectionError` under the tile grid.
- A part that only adds context (fee arrows, a countdown, publisher names) is left out silently. The card's note says what is missing ("Fee votes are not compared with the current fees: they could not be loaded").
- The tables per page are in 3.3, 4.4, 5.3 and 6.6.

### 2.8 Links

| Target | Rule |
|---|---|
| A ledger | `/{net}/ledger/{index}`, named by the number it shows (`#107,748,095`; the foundation's naming rule). Linked: voting ledgers (`fee_vote.ledger_index`, `amendment_votes.ledger_index`, `round.ledger_index`, `votes.ledger_index`), flag ledgers (`rounds[].flag_ledger`), `majority.ledger_index` (when present), `enabled.ledger_index`, history events, a validator's newest validation (`current_index`) and each recent validation's ledger. Never a future ledger: the next flag ledger is text. |
| A transaction | `/{net}/tx/{hash}`: `majority.tx_hash` (when present), `enabled.tx_hash` (when `source = ledger`), each `history[].tx_hash`. The text is "EnableAmendment 1717BD…A20A". Without `majority.tx_hash` (G5) no transaction is named for the majority. |
| A validator | `/{net}/validators/{validation_public_key}` |
| An amendment | `/{net}/amendments/{name ?? id}` |
| An account | `/{net}/account/{address}` for each of D's `domain_verification.accounts` (G1): the addresses a TOML that verified lists. Each is checked again as a classic address with a valid checksum, because it goes into a link. None drawn when the field is absent. |
| The XLS document | `xls_url` when the amendment has one (G2). The tag reads "XLS-30". The builder links it only when it is an `https` URL on `github.com` under `/XRPLF/XRPL-Standards/` (D1's own rule, checked again because it goes into a link). The link is `target="_blank" rel="noopener noreferrer"`, with the external icon and "(opens in a new tab)" as visually hidden text. Without `xls_url` the tag is plain text. |
| A validator's TOML | `domain_verification.toml_url`, only when `status = verified`, and only when it is `https://{domain}/.well-known/{xrp-ledger.toml\|xahau.toml}` with the validator's own domain (checked in the builder; otherwise no link). `target="_blank" rel="noopener noreferrer nofollow"`, with the external icon and text. An unverified domain is never a link: anyone can put any domain in a manifest. |

---

## 3. The validators list, `/{net}/validators`

### 3.1 Layout and content

From the top, as on the board. On a phone the same order, in one column.

| Element | Content |
|---|---|
| Heading row | `<h1>` "Validators". The intro: "The default UNL is the list of validators {rippled\|xahaud} trusts out of the box, published by {vl.ripple.com and unl.xrplf.org}. All adds every other validator whose validations reached the data API in the last 24 hours." (software from `networks.ts`, publishers from S, left out when S failed). On the right, "Amendments →". Then the live row (2.3). |
| Publisher notice | Only when a publisher of S is `expired` or `unavailable`. A `Notice` with an icon: "vl.ripple.com's list expired on Apr 6, 2027. The data API still uses it, as a node would rather use an old list than none." / "unl.xrplf.org has not been fetched yet ({last_error})." When every publisher is unavailable it adds "No validator is trusted until one is." (D1 §7). |
| Network overview (`section aria-label="Network overview"`) | Six `StatTile figure`, grid `repeat(auto-fit, minmax(min(300px, 100%), 1fr))` (the board's; one column on a phone): |
| | 1. "Validators seen, last 24 h": `seen_24h`; sub "35 on the default UNL, 107 others". |
| | 2. "On the default UNL": `unl_seen_24h / trusted` ("35 / 35"); sub "seen in 24 h, of those listed by vl.ripple.com and unl.xrplf.org". |
| | 3. "Quorum": "28 of 35"; sub "validations a ledger needs", plus " · the node reports 27" when `quorum.node` is present and differs. |
| | 4. "Negative UNL": the count. The sub names up to three, each a link to its page ("northpeak.example is discounted while it is offline", "and 2 more"), or "no validator discounted". It adds "· {name} to be disabled" or "re-enabled at the next flag ledger" from `negative_unl_pending`. Names come from L's rows (by key); a key L does not have is shown short. |
| | 5. "Base / owner reserve": "1 / 0.2 XRP"; sub "base fee 10 drops". |
| | 6. "Next flag ledger": "#107,748,352"; sub Countdown "in ~11 min" + " · fee and amendment votes are counted there". |
| Validator software versions | `ChartCard` with `ShareBar` (section 7). Rows "UNL" (the trusted UNL) and "All" (seen in 24 h). The label column shows the row's total ("35 validators"). Segments are the **four newest versions** in S `versions[]` (D1 lists them newest first), drawn newest first. **A colour follows the version, never its rank**: each version string has its own slot of 1 to 4 (3.2), which it keeps while newer releases arrive and older ones leave, so the colour of `3.4.1` does not move when `3.5.0` appears. "Other" (`--series-other`) is every older version plus `versions_unknown`. A segment is labelled under itself only at 18% or more (the kit's rule). Legend. % axis. The table view (the card's own, `table` prop): Version, UNL, UNL share, All, All share, one row per version of `versions[]` plus "Unknown", each with its group's swatch. Note: "Each validator's version as it reports it in its validations. "Other" groups releases older than {4th} and validators whose version is not known. Latest release on the UNL: {latest_version}." |
| Validators card | `<h2>` "Validators" and the source line `/v2/network/validators`. |
| | **Filters.** First, "Which validators": a segmented control of links (`aria-current="true"` on the current one, 32 px to look at with a 44 px target, E2's `netswitch` pattern): "UNL {n}" and "All {n}", counted from L's rows. The links keep the other filters. |
| | Then one `<form method="get" role="search" aria-label="Filter validators">` holding: |
| | • the search field (`name="q"`, visually hidden label "Search validators by domain or key", placeholder "Domain or key"); |
| | • "Listed by" (`name="publisher"`, a `<select>` with "any publisher" and S's ids), shown only when S lists two or more publishers; |
| | • "Votes yes for" (`name="amendment"`, a `<select>` with "any amendment" and A's `majority`, `voting` and `unknown` rows in A's order, labelled "{name or short ID} · {pct}%"); |
| | • a hidden `scope=all` when it applies; |
| | • the "Apply" button (44 px). |
| | Without JavaScript it is a plain GET form, and the canonical redirect tidies its empty fields. With JavaScript its `onSubmit` navigates straight to `validatorsHref(...)`, with `preventScrollReset`, so no redirect is needed. When a filter is set, a "Clear filters" link leads to the scope alone. |
| | **Table** (`DataTable live`, min-width 980 px, scrolling inside the card), columns as the board: |
| | • **Validator**: the domain (or the short key in mono) as a link, the domain status, the UNL tag, the Negative UNL tag, and under it the short master key or "no domain". |
| | • **Version**: mono, and "latest" when it is. |
| | • **Agreement 24 h**: right-aligned, with "incomplete" under it when it is. |
| | • **Fee votes · base / owner / fee**: "1 / 0.2 / 12↑", or "—" (visually hidden "no fee vote recorded"). |
| | • **Amendment votes**: a `<details>` "3 yes" listing each yes as an amendment link, or "0 yes". |
| | • **Last seen**: `RelativeTime coarse={60}`, or "not seen" when there is no `last_seen`. |
| | **Footer**: "35 validators" (or "4 matches") · "in the order of their domain, then their key" · "Fee votes in XRP / XRP / drops; ↑ ↓ against the current value". An empty result reads "No validators match these filters." with the Clear link. |

### 3.2 Loader and view builder

Calls: `lastValidated`, S, L, A (2.1). The view builder is `validatorsPage({ network, params, summary, list, amendments })` in `validators-view.ts`.

| Part | Rule |
|---|---|
| Rows | L's `validators[]`, in D1's order (domain first, by domain in lower case, then the master key; then those without a domain, by key). `scope=unl` keeps the rows with `unl: true`. `publisher` keeps the rows whose `unl_lists` holds it. `amendment` keeps the rows whose `amendment_votes.yes[]` holds its `id` (the ID comes from A; when A failed, the param is matched against `yes[].id` and `yes[].name` as given). `q` keeps the rows where the lower-cased `q` is a substring of the lower-cased `domain`, `validation_public_key` or `signing_key`: the rule of D1's `q`, applied in the Worker so that every search reads the one cached list. |
| No paging | Every matching row is on the page, as xrpscan has it: about 35 on the UNL and 150 in All on XRPL. L is asked once with `limit=1000`, D1's maximum. If L answers with a `marker` (more than 1,000 validators), the footer adds "The first 1,000 validators in this order are shown." The list is not paged in the explorer. |
| No sorting control | The order is D1's, the board's. Sorting by a column is a non-goal. |
| Counts | "UNL {n}" and "All {n}" are counted from L's rows (`unl: true`, and all) before `publisher`, `amendment` and `q` apply, so a chip says how many its scope holds. The footer gives the filtered count. |
| Overview | From S (3.1). `negative_unl[]` names come from L's rows. |
| Versions | 3.1. The rows' totals are the sums of their segments. Shares use `bignumber.js`. Fewer than four versions means fewer segments, and no "Other" when it would be empty. |
| Version slots | A version's own slot is 1 + (E2's FNV-1a hash of the version string mod 4). The four shown versions take their slots from the oldest to the newest: each its own slot when it is free, else the next free one (1 to 4, cyclically). So a newer release never takes an older one's colour: when it hashes to a slot in use, it moves, not the older one. A colour changes only when the version that once moved it leaves the four. The same version string has the same slot on both networks and in every scope. |
| Fee arrows | Each of `fee_vote.reserve_base`, `.reserve_inc`, `.base_fee` against S `fees`, compared as numbers with BigNumber. No arrows without S. |
| Amendment names | A yes entry shows `name` when L gives one, else the short ID. |
| Options | Publishers from S. Amendments from A. Each option's value is the canonical param (1.4). |
| Tokens | The versions chart carries E2's FNV-1a `token` over what it draws. |

### 3.3 Failures

| What failed | Page | Stored |
|---|---|---|
| `lastValidated` | 503 with `Retry-After`; an open page keeps itself | no |
| S, L and A all fail (an API without D1 is this case: each answers `Cannot GET`, kind `server` by E2's rule, section 10) | 503 with `Retry-After`: a list with none of them has nothing to show | no |
| S | The six tiles "—" and "Couldn't load the network overview" with Retry. The versions card shows `SectionError`. The intro has no publishers. "Listed by" is hidden. The fee arrows are left out and the footer says so. A `publisher` param is applied as given. | no (degraded) |
| L | The validators card shows "Couldn't load the validators" with Retry in place of the table. The filters stay, and the chips have no counts. | no |
| A | "Votes yes for" is hidden. An `amendment` param still filters, as given. | no |
| Any card past the 4.5 s deadline | That card, "took too long" | no |

### 3.4 Deviations from the board

| Board | Here | Why |
|---|---|---|
| The list filters as you type | A form with an "Apply" button | One URL per view, rendered in the Worker. No navigation per keystroke (each would be a render). A change of a field never changes the page by itself (WCAG 3.2.2). |
| "Votes yes for" options written in the board | A's `majority`, `voting` and `unknown` amendments | Real data |
| No publisher filter | "Listed by", with two or more publishers | The owner's list of filters. Xahau has one publisher, so it has none. |
| 12 rows with Previous and Next | Every matching row | About 150 rows at most. One URL per view. xrpscan shows them all. |
| "3 s ago" | "< 1 min ago" under a minute | The data can be 55 s old (2.1) |
| "Other" groups older releases | Older releases and unknown versions | The bar's five slots. The table lists each version. |
| "Negative UNL: 1, validator discounted…" | Names it, with a link | S gives the key, and L the domain |
| "…reached our servers…" | "…reached the data API…" | Says whose servers |
| No live row | E2's live row | The page refreshes, and WCAG 2.2.2 wants a pause |

---

## 4. The validator page, `/{net}/validators/{key}`

### 4.1 Layout and content

| Element | Content |
|---|---|
| Breadcrumb, live row | 1.5, 2.3 |
| Identity (`section aria-label="Validator"`) | "Validator" above an `<h1>`: the domain, or the short master key in mono. Beside it the domain status, the UNL tag and the Negative UNL tag. Under it the verification note (4.2). The source line on the right. |
| | "Master public key": in full, mono, wrapping, with a copy button ("Copy master public key"). |
| | A grid (`repeat(auto-fit, minmax(min(240px, 100%), 1fr))`): |
| | • "Current signing key": short, with copy, the full key as its `title`. |
| | • "Manifest sequence": `manifest.sequence`, with "4 signing keys seen by the data API" (or "one signing key seen"). |
| | • "UNL membership": one line per publisher of S, "listed" or "not listed" (2.5). Without S, the publishers of `unl_lists` as "listed", or "On no default list". A negative-UNL member adds "On the negative UNL since ledger #N", with `first_ledger` from S. |
| | • "Version": the version, "latest", and on Xahau "build N". |
| | • "First seen": `formatDate(first_seen)` with "first seen by the data API" (D1: by this deployment). |
| | • "Last seen": an age, with "last validation, ledger #N" (a link). Both come from VV's newest row when VV loaded, else from D's `last_seen` and `current_index`. |
| | • "Accounts {domain} lists": a link per address of D's `domain_verification.accounts` (2.8), shown only when the field is present, which D1 serves only for a TOML that verified. |
| Agreement (`section aria-label="Agreement"`) | Three `StatTile figure`: "Agreement, 1 h", "24 h", "30 days". The figure is the score. The sub is "4 missed of 22,096 validated ledgers", with " · 1 partial" and the incomplete status when they apply. Without a score: "—", "No validated ledgers counted yet". |
| Daily agreement | `ChartCard` "Daily agreement with validated ledgers, last 30 days": a `LineChart`, one series, slot 1, end dot, no area. `format: percent`. |
| | **The axis start** is 99% when every day is at 99% or more. Otherwise it is the highest of 95%, 90%, 50% and 0% at or below the lowest day. The note says it: "The axis starts at 99%." |
| | **Tooltip**: one of E4's `extras`, "Ledgers", without `format`: "4 missed of 22,096 validated ledgers", with " · incomplete" for an incomplete day. A day without a score is a gap. The newest day, when it is `T`'s UTC day, is still running and is marked "so far" (E2's `forming: true`), as on every time-series chart (E2 §6.6). |
| | **Table** (the card's own): Day (UTC), Agreement, Validated ledgers, Missed, Partial, Complete ("yes"; "no, hours missing"), newest first. |
| | **Notes**: "Share of the validated ledgers this validator signed with the same hash. Partial validations do not count toward agreement." and, when any day is incomplete, "Incomplete days are missing some hours of the data API's record." The plot summary names the lowest day (section 7). |
| Fee votes | Card "Fee votes". A table: Setting, Its vote, Now, Against now, with rows Base reserve, Owner reserve (native units) and Base fee (drops). The pills are those of 2.5. Note: "Fee votes are counted on flag ledgers, every {flag_interval} ledgers (A `rules`; without A, "on flag ledgers"). Its vote is from voting ledger #V." (a link). Without a record (`fee_vote` absent): "No fee vote recorded in the last 24 hours." Without S: the Now and Against now cells are "—", and the note says why. |
| Amendment votes | Card "Amendment votes" with "All amendments →". A table: Amendment (link), Status, Its vote. |
| | **Rows**: D's `amendment_votes.votes[]`, in D's order, with statuses `majority`, `voting` and `unknown` (G4): "Yes", "No" or "No recent vote" from each entry's `vote`. The rows do not depend on A. |
| | **Status text** from A: "Activating, in 4 days" (Countdown on `expected_activation`), "Voting · 11.4% yes". Without A: D's status word alone. |
| | **Note**: "Amendments still being voted on. A validator that does not vote yes counts as no. Its votes of voting ledger #V." A record that does not exist reads "No vote recorded in the last 24 hours". |
| Recent validations | Card "Recent validations", source line `/v2/network/validators/{key}/validations`. `DataTable live`, min-width 720 px, 20 rows: |
| | • **Ledger**: link `#107,748,183`. |
| | • **Ledger hash**: short, mono, `--muted`. Not a link: a hash that differs is no validated ledger. |
| | • **Signed (UTC)**: `signing_time` as `15:42:51`, with `Oct 18, ` before it when its UTC day is not the newest row's. |
| | • **Kind**: "Full" or "Partial". |
| | • **Matches validated ledger**: 2.5; "Different hash" carries the validated hash short in its visually hidden text. |
| | **Footer**: "Newest first. Partial validations do not count toward agreement. The data API keeps 7 days." and the `Pager` (Newer, Older) of the account page, from VV's `marker` and the `back` trail. |

### 4.2 The verification note

| `domain_verification` | Note |
|---|---|
| `verified` | "The {xrp-ledger.toml\|xahau.toml} at {domain} lists this master key." The file name is a link to `toml_url` (2.8). Plus "Checked {formatDateTime(checked)}." |
| `unverified`, reason `not_listed` | "The {file} at {domain} does not list this master key." |
| `toml_invalid` | "The {file} at {domain} could not be read as TOML." |
| `too_large` | "The {file} at {domain} is larger than 256 KiB." |
| `http_status` | "{domain} answered HTTP {status_code} for its {file}." |
| `dns_error`, `connect_error`, `tls_error`, `timeout` | "{domain} could not be reached ({the DNS lookup failed\|the connection failed\|TLS failed\|it timed out}). The data API tries again within the hour." |
| `redirect_rejected`, `blocked_address` | "{domain} sent the request where the data API does not follow." |
| `domain_invalid` | "The manifest's domain is not a valid domain name." |
| `manifest_unverified` | "The manifest that names this domain could not be verified." |
| `pending` | "The domain has not been checked yet." |
| absent (no domain) | no note |

An unknown reason (a newer D1) reads "The domain could not be verified." The sentences live in `validator-facts.ts` and are pinned by a test.

### 4.3 Loader and view builder

1. `requireNetwork`. Then `parseValidatorKey` (1.2), and the `marker` and `back` checks (1.4). A marker goes to 4.5.
2. Side by side: `lastValidated`, D, VV (`limit=20`), S, A.
3. D decides the page: 404 (1.2, section 10), 503, or the signing-key redirect.
4. `validatorPage({ network, validator, recent, summary, amendments })` in `validator-view.ts`. It uses the rules of 2.5, 2.6 and 4.1 and the shared pieces of `validator-facts.ts`.
5. `cached(..., "live-home")`.

### 4.4 Failures

| What failed | Page | Stored |
|---|---|---|
| `lastValidated` | 503 | no |
| D 404 `Validator not found` | 404, class `short`, with the other-network offer | yes (30 s) |
| D 400, 5xx, timeout, or a `Cannot GET` 404 (no D1, section 10) | 503 | no |
| VV | Recent validations card shows "Couldn't load the recent validations" with Retry. Last seen falls back to D, coarse. | no (degraded) |
| S | Fee votes Now and Against now "—". UNL membership from D alone. No negative-UNL ledger. | no |
| A | The amendment votes' Status from D's word alone; the fee votes' note says "on flag ledgers" without the interval | no |

### 4.5 Older validations (`?marker=`)

Older validations are history, as an account behind a marker is.

- **Calls.** D (for the heading and the canonical key) and VV with the marker. D fails as on the first page (4.4); any other VV failure is a 503. The page has the breadcrumb, the `<h1>` with the domain status and tags, and the Recent validations card. It has no live row, no tiles and no other card.
- **Cache.** Class `slow` with `ttl: 300`. The page is `noindex, follow`, with no canonical link and no `og:*` tags. It does not refresh (2.3).
- **404.** A marker that `isMarker` refuses, a VV 400 (D1's `invalid marker`), or a page with no rows (the 7 days have passed it) is a 404 of class `short`, "that page of the validator's validations", as on the account page.
- **Redirects.** A signing key or a hex key redirects first, keeping `marker` and `back`.

### 4.6 Deviations from the board

| Board | Here | Why |
|---|---|---|
| "signing key rotated 3 times" | "4 signing keys seen by the data API" | D1 counts the signing keys it has stored. That is a lower bound of the rotations, not their number. |
| "First seen 2 Feb 2022" | "Feb 2, 2022 · first seen by the data API" | D1's first seen is the deployment's |
| UNL membership lists the publishers that list it | Every publisher, listed or not listed | Shows which list is missing it |
| 10 recent validations, signed to the millisecond | 20, to the second, with a "Not indexed yet" state | The foundation's list size. D1 maps `signing_time` (seconds). `validated: unknown` exists. |
| The axis always starts at 99% | 99%, or lower when a day is lower | A line under the axis would be lost |
| Domain shown without a link | The TOML linked when verified | It is the evidence. An unverified domain is never a link. |

---

## 5. The amendments list, `/{net}/amendments`

### 5.1 Layout and content

| Element | Content |
|---|---|
| Heading row | `<h1>` "Amendments", with the intro "Changes to the {XRPL\|Xahau} protocol. Each one activates only after the validators on the default UNL vote it in." On the right, "Validators →". Then the live row. |
| Activating soon (`section aria-label="Activating soon"`, the board's accent border) | One line per `majority` row, in A's order (by `expected_activation`). The card is left out when there is none. |
| | **Line**: "**{name}** activates on or soon after {formatDateTime(expected_activation)}, {Countdown}, if it keeps more than 80%". |
| | **Under it**: "{yes} of {trusted} UNL validators vote yes · majority since {formatDate(since)}, held for {14\|5} days before it activates". |
| | "Votes and history →" links to the amendment. |
| Rules | "Validators vote in the ledger before every flag ledger, once every {flag_interval} ledgers. An amendment that keeps more than {threshold_percent}% of the UNL for {hold} days in a row is enabled at the flag ledger that follows, by an EnableAmendment pseudo-transaction in the ledger after it. Next flag ledger #{n} {Countdown}." |
| All amendments | `<h2>` and the source line. Status chips, as links (`amendmentsHref`): All, Activating (`majority`), Voting, Activated (`enabled`), Obsolete, and Unknown only when `counts.unknown > 0`. Each shows its count from A `counts`, and the current one is `aria-current="true"`. |
| | **Table** (`DataTable live`, min-width 1000 px, 56 px rows): |
| | • **#**: the position in the list shown. |
| | • **Amendment**: the name, or the short ID in mono, as a link; the XLS tag (2.8); the "retired" tag. |
| | • **Introduced**: mono, or "—". |
| | • **Consensus, UNL**: a `Meter small` (6 px) for `majority`, `voting` and `unknown`, with "{pct} · {yes} / {trusted} UNL" under it and the tick at `threshold_percent`. Otherwise "—" (visually hidden "no vote running"). |
| | • **Status**: 2.5. |
| | • **Enabled on**: `formatDate(enabled.date)` over a ledger link; for a retired amendment "Always on" (visually hidden "retired: always on, not listed in the ledger"); otherwise "—". |
| | **Footer**: "{n} amendments" · "the tick on each bar marks 80%". |

### 5.2 Loader and view builder

Calls: `lastValidated` and A. `amendmentsPage({ network, amendments, status })` keeps A's order (D1 3.5: `majority`, `voting`, `unknown`, `enabled`, `obsolete`) and the rows of the chosen status. Every row is on the page: about 120 on XRPL. **No paging**: a status chip narrows the list, as xrpscan shows it whole.

### 5.3 Failures

The page is A. A failing, an API without D1 included (`Cannot GET`, kind `server` by E2's rule, section 10), is a 503. The page has no card-level call.

### 5.4 Deviations from the board

| Board | Here | Why |
|---|---|---|
| "if it keeps 80%"; "holds at least 80%" | "more than 80%" | D1's rule (2.6) |
| "held for 14 days" | From `rules` | 5 days on Xahau |
| 14 rows with Previous and Next | The whole list | About 120 rows. One URL per view. |
| No "Unknown" chip | Shown when there is one | D1's fifth status |
| "…activates through an EnableAmendment…" | "…is enabled at the flag ledger that follows, by an EnableAmendment pseudo-transaction in the ledger after it" | D1 2.7: in the ledger after the flag ledger |

---

## 6. The amendment page, `/{net}/amendments/{name}`

### 6.1 Layout and content

| Element | Content |
|---|---|
| Breadcrumb, live row | 1.5, 2.3 |
| Identity (`section aria-label="Amendment"`) | "Amendment" above an `<h1 class="mono">` with the name. For a nameless amendment the `<h1>` is "Unknown amendment" and the ID follows. Beside it the status pill. The source line. |
| | "Amendment ID": in full, wrapping, with "Copy amendment ID". |
| | A grid: |
| | • "Specification": the XLS tag (2.8). Without one: "No XLS", plus " · fix amendments have none" for a name starting with `fix`. |
| | • "Introduced in": "{rippled\|xahaud} {introduced}", or "Not known". |
| | • By status: |
| | — `majority`: "Majority since" (2.4) and "Activates on" (2.4, "if it holds"); |
| | — `enabled`: "Enabled on" `formatDateTime(enabled.date)` with ledger and transaction links, or "before the indexed history" when `source = metadata`; for a retired amendment "Always on: {xahaud} applies it although the ledger does not list it"; |
| | — `obsolete`: "Current software can no longer vote it in."; |
| | — `unknown`: "No name is known for this ID, from the data API's metadata or its node." |
| | **Description** (when D1 has one): the sentence, with the board's tag "hand-kept metadata, not read from the ledger". |
| Consensus | For `majority`, `voting` and `unknown`: the whole card of 6.2. For `enabled` and `obsolete`, which have no `votes` (D1 3.5), only its chart and chart table, and only when `rounds` is not empty (enabled within the last 30 days); otherwise no card. |
| History | 6.4 |
| Votes of the UNL validators | 6.5 |
| Other validators, not on the UNL | 6.5 |

### 6.2 Consensus

- **Figure**: the yes share (44 px), with the `Meter` (12 px) beside it. The threshold tick is at `threshold_percent`, labelled "80%". The meter's label is "{yes} of {trusted} UNL validators vote yes, {pct}; more than 80% needed".
- **Sentence 1**:
  - with `yes ≥ needed`: "{yes} of {trusted} UNL validators vote yes; {needed} are needed."
  - otherwise: "{yes} of {trusted} UNL validators vote yes; {needed − yes} more are needed."

  When `trusted < unl_size` it says "of the {trusted} UNL validators with a recent vote".
- **Sentence 2**:
  - `majority`: "{spare} can change their vote before it loses majority." (`spare = yes − needed`), or "One vote less and it loses majority." when spare is 0. Then "Majority since {date} at ledger #{n}; activates on or soon after {date} if it holds.", without " at ledger #{n}" when `majority.ledger_index` is absent (G5).
  - `voting`, `unknown`: "Votes of voting ledger #{V}, {formatDateTime(round.date)}."
- **Chart**: `ChartCard` "Yes votes per flag ledger, % of the UNL, last 30 days":
  - a `LineChart curve="step"`, slot 1, on a `flag` axis (one point per round, evenly spaced; buckets are the rounds' `date`);
  - values: `yes ÷ trusted × 100` to 2 decimals, `null` when `trusted` is 0;
  - the axis starts at 50%, or at 0% when a round is lower, and the note says which;
  - `references: [{ value: threshold_percent, label: "80% threshold" }]`;
  - one of E4's `extras` per round, "Round", without `format`: "flag ledger #{flag_ledger} · {yes} of {trusted} UNL validators · majority" (or "no majority", from `passes`);
  - the cursor's `pageStep` is the number of rounds in the newest 24 hours, so Page Up and Page Down move a day.
- **Chart table** (the card's own, "changes only", as the board): one row per round where `yes` or `trusted` changed, and the first round, newest first. Columns: From flag ledger (link), Date (UTC), Yes ("29 / 35"), Share, Majority (2.5). Note: "One row per change in the yes count; the count holds until the next row." With no rounds the card says "No voting rounds recorded in the last 30 days."
- The card's notes: "One point per flag ledger, every {flag_interval} ledgers. The axis starts at 50%." (or "at 0%", by the rule above). The interval, the threshold and the hold come from AD's own envelope (`rules`, G3), so the card does not depend on another call.

### 6.3 Size of the answer

`rounds` holds about 2,600 entries for 30 days (D1 3.6), so the page carries about 2,600 values, dates and round texts (the "Round" extra). In return:

- the step path has one vertex per change (section 7);
- the table holds only the changes;
- the loader data holds strings only.

`test/worker/amendment-page.spec.ts` pins the document of a full 30-day fixture at under 150,000 B gzipped. AD itself, about 260 KB of JSON, is read from the subrequest cache, kept 60 s.

### 6.4 History

Card "History", source line `/v2/network/amendments/{name}`. An `<ol>`, newest first:

- for `majority`, first a pending item with a dashed ring: "Enabled, expected", "{formatDateTime(expected_activation)}, if the majority holds" ({Countdown}), "No transaction yet";
- then each `history[]` event:
  - "Got majority" with `tfGotMajority` in faint mono and a filled `--series-1` dot;
  - "Lost majority" with `tfLostMajority` and an outlined `--border-strong` dot;
  - "Enabled" with a filled `--ok` dot and a check icon;

  each with `formatDate(date) · ledger #{n}` and "EnableAmendment {short hash}" as links. The dots are `aria-hidden`: the label says what each is.
- An enabled amendment without events (`source = metadata`) has one item: "Enabled {date}{, ledger #n}" with "Before the indexed history".
- Note: "Each change of majority is an EnableAmendment pseudo-transaction, in the ledger after a flag ledger."

### 6.5 Votes

- **Votes of the UNL validators**: card head "{yes} yes · {no} no{ · {none} without a recent vote}, on {publishers of S}". `DataTable live` in a scroll region (max-height 470 px, sticky head), min-width 640 px. Columns:
  - Validator (link; domain, or short key in mono);
  - Vote (2.5);
  - Version (mono), with "its version lacks it" in `--faint` when `version_supports` is false;
  - Last seen (`RelativeTime coarse={300}`).

  Rows are `unl_votes[]` in D1's order (the validators list's).
- **Other validators, not on the UNL**: a `<details>` (closed by default) whose `<summary>` (48 px) reads "Other validators, not on the UNL · {y} of {n} vote yes · their votes do not count". It holds the same table of `other_votes[]`. Its footer: "Showing {n} of the {others_seen_24h} other validators seen in the last 24 hours: those with a vote recorded. All validators →" (to `?scope=all`). Without S, the "of the N … seen" clause is left out.

### 6.6 Failures

| What failed | Page | Stored |
|---|---|---|
| `lastValidated` | 503 | no |
| AD 404 `amendment not found` | 404 `short`, with the other-network offer | yes (30 s) |
| AD otherwise, a `Cannot GET` 404 included (no D1, section 10) | 503 | no |
| S | No "on {publishers}". No "of the N … seen". | no |

The voting rules, the round and the next flag ledger come with AD (its envelope, G3), so they fail only with the page.

### 6.7 Deviations from the board

| Board | Here | Why |
|---|---|---|
| "— 0 more needed"; "28 yes votes make 80%, so 1 can change their vote" | D1's `needed` = ⌊0.8 × trusted⌋ + 1; "{spare} can change their vote" | The protocol's rule (2.6). The board's numbers would overstate the spare by one. |
| Shift + arrow moves a day | Page Up / Page Down | The ARIA slider pattern's large step |
| History source `/v2/transactions?type=EnableAmendment` | AD `history` | D1 serves it |
| "…in a flag ledger" | "…in the ledger after a flag ledger" | D1 F6 |
| Description placeholder | D1's `description`, or nothing | Real data |

---

## 7. Chart kit and component additions

Each is a new prop or option, added with tests, in the kit's own files (E2 §2.11). Nothing is forked.

| Where | Addition | Used by |
|---|---|---|
| `ChartCard` | `table?: ReactNode`: the card's own table view in place of `ChartTable`, still behind the Chart/Table radios and still the full equivalent of the chart | versions, daily agreement, yes votes |
| `TimeAxis` `unit: "flag"` | E2 defines the unit. Its labels are fixed here: x labels are days (`Oct 16`, picked as E2 §2.4 picks them), tooltip and table dates are `formatDateTime` | yes votes |
| `geometry.ts` | A step path emits a vertex only where the value changes, so 2,600 rounds with 5 changes is a path of about 12 commands | yes votes |
| `Cursor` | `pageStep?: number`: Page Up and Page Down move that many buckets; `aria-keyshortcuts` names them | yes votes |
| Plot summary (`labels.ts`) | `extreme: "highest" \| "lowest"` (default `highest`): agreement names its lowest day ("Lowest Oct 3, 99.31%; latest Oct 19, 99.98%") | daily agreement |
| `useLiveRefresh` | `everyMs` (2.3) | all four pages |
| `RelativeTime` | `coarse?: number` (2.4) | lists, vote tables |
| `Countdown` (new, `app/ui/components/`) | 2.4 | tiles, pills, history |
| `Meter` | `small` exists (E2: 12 px, 6 px small). Its `label` is the visible text's equivalent. | both amendment pages |

E6 also uses E4's `TimeSeriesData.extras` (the daily agreement's "Ledgers" and the yes votes' "Round", read in the tooltip and the slider's `aria-valuetext`; the cards' own `table` replaces `ChartTable`, so they have no column there) and E2's `TimeSeriesData.forming` (the daily agreement's running day). It adds no per-bucket field of its own.

---

## 8. SEO and link previews

| Page | `<title>` | Description | Image |
|---|---|---|---|
| Validators (default view) | `Validators · XRPL · explorer` | "The validators of XRPL: the default UNL and every validator seen in the last 24 hours, with their domains, software versions, agreement, and fee and amendment votes." | none |
| Validator | `Validator {domain, or the short key} · XRPL · explorer` | "{name} is a validator of XRPL{, on the default UNL (listed by vl.ripple.com and unl.xrplf.org)}{, running rippled 3.4.1}. {Its domain is verified.\|Its domain is not verified.\|} Agreement, fee and amendment votes, and recent validations." | `/og/{net}/validator/{master key}.png` |
| Amendments (default view) | `Amendments · XRPL · explorer` | "Every amendment of XRPL: which are enabled, which have a majority and when they activate, and how the default UNL votes on the rest." | none |
| Amendment | `Amendment AMM · XRPL · explorer` (or `Amendment 98433D…CA76`) | By status: "AMM is enabled on XRPL since Mar 22, 2024 (ledger 86,836,481)." / "AMM has had a majority of XRPL's default UNL since Oct 9, 2026 and activates on or soon after Oct 23, 2026 if it holds." / "4 of 35 validators of XRPL's default UNL vote for XChainBridge; 29 are needed." (`votes.needed`, so the description does not depend on A) / "fixNFTokenNegOffer is obsolete on XRPL: current software can no longer vote it in." / "An amendment of XRPL with no known name: its votes and history." Then D1's `description` when present. | `/og/{net}/amendment/{name}.png` |

Notes:

- The descriptions hold no age and no countdown. They are rebuilt at each render from data at most a few minutes old.
- The canonical and `og:url` are on the request's origin (foundation ruling).
- Other views are `noindex, follow` (1.4).

**Images.** The image route gains the kinds `validator` and `amendment`. They use the same parsing, clients and builders as the pages, drawn by the existing renderer (no change to `card.tsx`):

| Kind | Card | Id rules | Class |
|---|---|---|---|
| `validator` | kind "Validator"; headline the domain, or the short key in mono; parties: the master key; note "On the default UNL · domain verified · rippled 3.4.1" (the parts that apply); footer the network | base58 master key. Hex is a 302 (`immutable`) to base58. A signing key is a 302 (`slow`) to the master's image after D. An invalid key or D's 404 is a 404 `short`. | `slow` (UNL, version and verification change rarely) |
| `amendment` | kind "Amendment"; headline the name or short ID, in mono; note the status ("Enabled on Mar 22, 2024", "Majority since Oct 9, 2026 · activates on or soon after Oct 23, 2026", "Voting · 4 of 35 UNL validators vote yes", "Obsolete", "Unknown amendment"); footer "XLS-30 · introduced in rippled 1.12.0" (the parts that apply); footer end the short ID | 1.3's parser. A non-canonical id is a 302 (`slow`) to the canonical image after AD. AD's 404 is a 404 `short`. | `slow` |

A query string on an image URL is still a 302 to the bare path. While `VALIDATORS` is off, both kinds are a 404 of class `short` before any call (section 10). D's or AD's own not-found message is the 404 above; a `Cannot GET` 404 is kind `server` by E2's rule, so the route's 503, never stored. Other failures are the route's 503s. `meta.ts`'s `ImageKind` gains both kinds.

---

## 9. Data interface

Field by field, what each element reads. Times are D1's formats (D1 3.0), converted to unix seconds in the builders for `RelativeTime` and `Countdown`.

### 9.1 Validators list

| Element | Call: field |
|---|---|
| Intro publishers | S `unl.publishers[].id` |
| Publisher notice | S `unl.publishers[].status`, `.expiration`, `.last_error`, `.last_error_at` |
| Tile 1 | S `validators.seen_24h`, `.unl_seen_24h`, `.others_seen_24h` |
| Tile 2 | S `validators.unl_seen_24h`, `unl.trusted`, `unl.publishers[].id` |
| Tile 3 | S `quorum.value`, `.unl_size`, `.node` |
| Tile 4 | S `negative_unl[].validation_public_key`, `negative_unl_pending`; L `domain` by key |
| Tile 5 | S `fees.reserve_base`, `.reserve_inc`, `.base_fee` |
| Tile 6 | S `next_flag_ledger.ledger_index`, `.expected` |
| Versions | S `versions[]` (`version`, `unl`, `all`), `versions_unknown`, `latest_version` |
| Scope chips | L rows, counted (`unl`) |
| Filters | S `unl.publishers[].id`; A rows with `status` `majority`, `voting`, `unknown` (`id`, `name`, `votes.pct`) |
| Row: name, sub, link | L `domain`, `validation_public_key` |
| Row: badges | L `domain_verification.status`, `unl`, `unl_lists`, `negative_unl` |
| Row: version | L `version`, `version_latest` |
| Row: agreement | L `agreement_24h.score`, `.incomplete` |
| Row: fee votes | L `fee_vote.reserve_base`, `.reserve_inc`, `.base_fee`; S `fees` |
| Row: amendment votes | L `amendment_votes.yes[]` (`id`, `name`) |
| Row: last seen | L `last_seen` |
| Filtering | L `unl`, `unl_lists`, `amendment_votes.yes[].id`, `domain`, `validation_public_key`, `signing_key`; L `marker` (more than 1,000) |

### 9.2 Validator page

| Element | Call: field |
|---|---|
| Heading, badges, canonical key | D `domain`, `domain_verification`, `unl`, `negative_unl`, `validation_public_key` |
| Verification note | D `domain_verification.status`, `.reason`, `.status_code`, `.toml_url`, `.checked` |
| Master, signing key | D `validation_public_key`, `signing_key` |
| Manifest | D `manifest.sequence`, `.signing_keys_seen` |
| UNL membership | D `unl_lists`; S `unl.publishers[].id`; S `negative_unl[].first_ledger` |
| Version | D `version`, `version_build`, `version_latest` |
| First and last seen | D `first_seen`, `last_seen`, `current_index`; VV `validations[0].first_datetime`, `.ledger_index` |
| Agreement tiles | D `agreement_1h`, `agreement_24h`, `agreement_30d` (`score`, `missed`, `total`, `partial`, `incomplete`) |
| Daily agreement | D `daily_agreement[]` (`date`, `score`, `missed`, `total`, `partial`, `incomplete`) |
| Fee votes | D `fee_vote` (`ledger_index`, `base_fee`, `reserve_base`, `reserve_inc`); S `fees` |
| Amendment votes | D `amendment_votes.ledger_index`, `.votes[]` (`id`, `name`, `status`, `vote`), `.yes[]`; A rows (`majority.expected_activation`, `votes.pct`) |
| Recent validations | VV `validations[]` (`ledger_index`, `ledger_hash`, `validated`, `validated_hash`, `full`, `signing_time`), `marker` |
| Accounts | D `domain_verification.accounts` (G1) |

### 9.3 Amendments list

| Element | Call: field |
|---|---|
| Activating soon | A rows in status `majority`: `name`/`id`, `majority.expected_activation`, `majority.since`, `votes.yes`, `votes.trusted`; `rules.majority_hold_seconds`, `rules.threshold_percent` |
| Rules paragraph | A `rules.flag_interval`, `.threshold_percent`, `.majority_hold_seconds`; `next_flag_ledger.ledger_index`, `.expected` |
| Chips | A `counts` |
| Rows | A `id`, `name`, `status`, `retired`, `introduced`, `xls`, `xls_url` (G2), `votes.pct`, `.yes`, `.trusted`, `majority.expected_activation`, `enabled.date`, `enabled.ledger_index` |

### 9.4 Amendment page

| Element | Call: field |
|---|---|
| Heading, ID, status | AD `name`, `id`, `status`, `retired`, `majority.expected_activation` |
| Specification, introduced, description | AD `xls`, `xls_url` (G2), `introduced`, `description`; the network's `software` |
| Majority, activation | AD `majority.since`, `.ledger_index` and `.tx_hash` (both optional, G5), `.expected_activation` |
| Enabled | AD `enabled.date`, `.ledger_index`, `.tx_hash`, `.source` |
| Consensus figure and sentences | AD `votes.yes`, `.trusted`, `.needed`, `.pct`, `.ledger_index`; AD's envelope (G3) `round.unl_size`, `round.date`, `rules.threshold_percent`, `rules.majority_hold_seconds` |
| Chart and its table | AD `rounds[]` (`ledger_index`, `flag_ledger`, `date`, `yes`, `trusted`, `passes`); AD's envelope `rules.threshold_percent`, `rules.flag_interval` |
| History | AD `history[]` (`event`, `ledger_index`, `date`, `tx_hash`) |
| UNL votes | AD `unl_votes[]` (`validation_public_key`, `domain`, `vote`, `version`, `version_supports`, `last_seen`); S `unl.publishers[].id` |
| Other votes | AD `other_votes[]`; S `validators.others_seen_24h` |
| Countdowns | AD `majority.expected_activation`; AD's envelope `next_flag_ledger.expected` |

### 9.5 What D1 adds for these pages

An earlier draft of this spec listed five gaps in D1. All five are part of D1, and E6 uses them as D1 serves them:

| # | D1 serves | E6 uses it for |
|---|---|---|
| G1 | `domain_verification.accounts`: the `[[ACCOUNTS]].address` entries of a TOML that verified (valid checksum, at most 10), read by the same fetcher under the same SSRF rules; absent when there are none | "Accounts {domain} lists" on the validator page (4.1, 2.8) |
| G2 | an optional `xls_url` in the amendment metadata (`https`, host `github.com`, path under `/XRPLF/XRPL-Standards/`, checked at boot), on A and AD | the XLS link (2.8) |
| G3 | the list envelope on AD: `ledger_index`, `rules`, `round`, `next_flag_ledger` | the amendment page without a call to A (2.1, 6) |
| G4 | `unknown` amendments in D's `amendment_votes.votes[]` | the validator page's vote rows without A (4.1) |
| G5 | `majority.ledger_index` and `majority.tx_hash` only when the EnableAmendment is indexed | the majority's ledger and transaction are left out when absent (2.4, 2.8, 6.2) |

Nothing else on the four boards lacks a field. The overview's "Other" grouping, the negative-UNL names, the filters, the counts and the "changes only" table are the explorer's own work over D1's fields. They are not gaps.

---

## 10. Before and after D1 is deployed

**Decision: E2's `VALIDATORS` switch gates the four pages, their images and every link to them. Inside it, as the fallback, a D1 route that does not exist is an outage, never a stored 404. No runtime detection.**

- **`VALIDATORS`** is one of E2's feature switches, with E2's mechanism as it is (E2 introduces it in place of the earlier `VALIDATORS_PAGE_LIVE` constant, off everywhere until these pages exist). E6 sets it `"on"` at the top level (development, tests); `staging` and `production` stay `"off"` until D1 has served that environment on both networks for at least two hours (Rollout). It is part of E2's `cacheGeneration(env)`, so a flip never meets a page stored under the other value.

  | | `VALIDATORS` off | `VALIDATORS` on |
  |---|---|---|
  | The four pages, `/og/{net}/validator/…`, `/og/{net}/amendment/…` | 404, class `short`, no call | the pages |
  | The network page's "All validators" | E2's "soon" style | E2's link to `/{net}/validators?scope=all` |
  | The network page's five "First seen" keys | text | links to `/{net}/validators/{key}` (1.5) |

  Nothing else links to the four pages: the header's Network link goes to the network page. The four pages link to each other.
- **The fallback inside the switch.** With the switch on in front of an API without D1, every D1 route answers `404 Cannot GET …`. E2's route-missing rule (`data-api.ts`) makes that kind `server`: an outage, held by the failure hold and never stored. So a mistaken flip serves "try again" pages that are never stored:

  | Page | Answer |
  |---|---|
  | Validators list | S, L and A all fail: 503 (3.3) |
  | Validator page | D fails: 503 (4.4) |
  | Amendments list | A fails: 503 (5.3) |
  | Amendment page | AD fails: 503 (6.6) |
  | Images | D or AD fails: 503, not stored |

  A route's own not-found message (`Validator not found`, `amendment not found`) stays `not_found` by the same rule, so a real 404 is stored, for 30 s, only where D1 answers. The pages come right within seconds of D1's deploy, without an explorer change.
- **While D1 fills** (D1 Rollout, step 3), the pages draw what D1 has: absent fields and D1's own flags.

  | Data | How long D1 takes | How the page shows it |
  |---|---|---|
  | Votes and tallies | about 1–2 hours | "No vote recorded", an empty chart: "No voting rounds recorded in the last 30 days" |
  | Versions | up to 17 minutes | "Unknown" |
  | 30-day agreement | 30 days | "incomplete" |
  | Domain checks | a few minutes | "not checked yet" |

  These states are fixtures and tests of their own (Testing). They are not error paths.
- **Why a switch, and the fallback too.** The switch keeps visitors from being led to pages that would say "try again", costs no probe call, and lets staging go on before production from one commit. The fallback makes a flip ahead of D1 safe.

---

## Testing

**Unit (Vitest, `unit` project)**

| File | Covers |
|---|---|
| `app/domain/validator-key.test.ts` | Base58 master and signing keys accepted. A wrong checksum, a wrong version byte (a classic address, `nH…` truncated), a 32-byte key, `summary` and the empty string refused. 66 hex in upper and lower case with prefixes `02`, `03` and `ED` converted to the right base58 (pairs taken from D1's recorded manifests or generated with `ripple-address-codec`). Other prefixes refused. 64 and 68 hex refused. |
| `app/domain/amendment-ref.test.ts` | 64 hex in any case to an upper-case ID. A hex string starting with a letter is an ID, not a name. Real names (`fix1201`, `NonFungibleTokensV1_1`, `fix240819`, `XChainBridge`) accepted. Names with `-`, `.`, spaces or a leading digit, and 65 characters, refused. |
| `app/domain/validators-params.test.ts`, `amendments-params.test.ts` | The canonical form of every query string: defaults, empties, unknown values and parameters, repeats, order, `q` trimmed and cut at 100 (by characters, not UTF-16 units). `validatorsHref` and `amendmentsHref` round-trip through the parsers. |
| `app/server/validators-view.test.ts` | Each filter and their combination; `q` over domain, master key and signing key, in any case. Scope counts. Order kept. The data-dependent canonicalisation (publisher case, amendment by ID to name, a non-voting amendment dropped). S or A missing (param applied as given). The 1,000-row note. Tiles: quorum with and without `node`, negative UNL names and pending. Versions: four newest, "Other" with unknown, fewer than four versions, shares exact. Fee arrows. Agreement text and incomplete. Coarse-age inputs as unix seconds. Tokens. No float in any string. |
| `app/server/validator-view.test.ts` | Every verification sentence (4.2) and an unknown reason. The TOML link check (an `https` URL on another host, a path that is not `.well-known`, `http:` are not linked). UNL membership with and without S. Last seen from VV, else from D. Manifest wording (1 key, n keys). Agreement tiles without a score. The axis start rule at its boundaries (all at or above 99, 98.99, 94.9, 49, 0). Daily table rows. Fee votes with and without a record, and without S. Amendment votes from D's `votes[]` with an unknown amendment as Yes, No and No recent vote; the status text with A and without it. The accounts line with and without `domain_verification.accounts`, and an invalid address in it skipped. Validations: time with and without the date prefix, the three `validated` states. Pager links. |
| `app/server/amendments-view.test.ts` | Order and status filter. Rank. Meters only for `majority`, `voting`, `unknown`. Retired rows. Enabled-on from the ledger and from metadata. Activating-soon lines for 0, 1 and 2 majorities. The rules paragraph from `rules` (XRPL 14 days, Xahau 5). |
| `app/server/amendment-view.test.ts` | Each status's identity grid. The consensus sentences for yes < needed, = needed, > needed, `trusted` 1 and 0, `trusted < unl_size`. The step series and its "Round" extra. The majority sentence and history with and without `majority.ledger_index` and `tx_hash`. The XLS link check (`xls_url` on another host or path is not linked). `pageStep` from the newest 24 h. The axis start. The changes-only table (yes changes, trusted changes, the first round). History newest first with the pending item. Metadata-only enabled. Vote headers with and without S. `version_supports`. |
| `app/server/validator-facts.test.ts` | Score, fee and version text (2.6). Amendment status labels (2.5). "More than 80%" wording. |
| `app/domain/format.test.ts` | `untilText` at every boundary (0, 59 s, 60 s, 59 min 1 s, 47 h 59 min, 48 h, 3.5 days), with and without `approx`. `formatDate` and `formatDateTime`. |
| `test/unit/tokens.test.ts` | The `.pill.info` wash pair and the `.off` pill text on both accents and both modes |
| `test/unit/validators-bundle.test.ts` | The four routes' browser files import nothing from `app/server` at run time, nor `ripple-address-codec` (the parsers are loader-only) |
| `test/unit/pending-paths.test.ts` | The six D1 paths, while pending |
| `test/unit/validators-fixtures.test.ts` | The synthetic fixtures obey D1's rules (below) |

**Components (`components` project, happy-dom)**

- `ValidatorsPage.test.tsx`, `ValidatorPage.test.tsx`, `AmendmentsPage.test.tsx` and `AmendmentPage.test.tsx`: every card state of their failure tables, every status of 2.5 as icon and text, and the filters as links and a form (the "Apply" form submits to `validatorsHref`). Also: the details disclosures, the Pager, a marker page without the live row, the Xahau variants (no "Listed by", "build N", "Always on", 5 days), and the empty and filling states of section 10.
- `Countdown.test.tsx`: the server text, hydration without mismatch, ticking, `past`, a hidden tab. `RelativeTime` gains the `coarse` cases.
- Kit additions (section 7): `ChartCard` with `table` (the radios swap to it; it replaces `ChartTable`); E4's `extras` on a step line over a `flag` axis, in the tooltip and `aria-valuetext`; step-path compression (`geometry.test.ts`: 2,600 values with 5 changes give 12 commands); `pageStep` keys; `extreme: "lowest"`.
- `use-live-refresh.test.tsx`: `everyMs` and its backoff cap. `keepLoaded` itself is E2's and tested there; `routes-wiring.test.tsx` checks the parts each route passes.
- `Header` on the four routes: `aria-current="true"` through E2's `navSection` handle (`"page"` stays the network page's). `network-view.test.ts` and `NetworkPage.test.tsx`: the five key links as hrefs with `VALIDATORS` on and as text (`null`) with it off.
- `routes-wiring.test.tsx` gains the four routes: the `clientLoader`, the scope per view, a failed refresh keeping the page, and a marker view that never refreshes (its `clientLoader` bypasses `onScreen`).

**Worker (`worker` project, `@cloudflare/vitest-pool-workers`)**

| File | Checks |
|---|---|
| `test/worker/validators-page.spec.ts` | The page and its `.data` URL stored as `live`. Every canonical redirect (302, `short`), pure ones with no upstream call (`mock.requests` empty). Exactly the calls of 2.1, with their keys (`[kept 10 s]` for S and L, the class `minute` for A, the home page's `[kept 2 s]` for `lastValidated`) and stored `max-age`. One L call serves `?scope=all`, `?q=…` and `?amendment=…` in a row (one upstream request across three renders). Each card failure is a 200 with its `SectionError`, `Cache-Control: no-store`, not stored. S, L and A all answering `Cannot GET` → 503, not stored; S alone answering it fails its cards. `lastValidated` failing → 503. HTML holds the share bar's segments and both views. |
| `test/worker/validator-page.spec.ts` | `live-home`. Hex → base58 302 `immutable` with no call. A signing key → 302 `slow` to the master, with the query string kept. An invalid key → 404 `short` with no call. D `Validator not found` → 404 `short` with the offer. D `Cannot GET` → 503. D 400 → 503. VV, S or A failing degrades its card. A marker page: `slow` with a 300 s TTL, `noindex, follow`, no canonical, only D and VV called, an invalid marker or VV 400 or an empty page → 404. The holds: every call of the page was made with `holdFailure` (two renders within 5 s with a failing VV make one upstream request). |
| `test/worker/amendments-page.spec.ts` | `minute`. Status redirects. A failing → 503, a `Cannot GET` A included. |
| `test/worker/amendment-page.spec.ts` | Ref redirects: case variant, ID of a named one, lower-case ID of a nameless one, all `slow`. An invalid ref → 404 with no call. `minute`. Exactly `lastValidated`, AD and S called (no A). AD `amendment not found` → 404 `short` with the offer. AD `Cannot GET` → 503. S failing degrades. Any query string → 302. **The full 30-day fixture's document is under 150,000 B gzipped.** |
| `test/worker/validators-off.spec.ts` | In E2's `worker-off` project (every switch off, E2 §6.1): each of the four pages and the image route for both kinds is a 404 of class `short` with no upstream call (`mock.requests` empty); the network page's "All validators" is "soon" and its five keys are text. The `worker` project, with `VALIDATORS` on at the top level, runs the pages. |
| `test/worker/og.spec.ts` | Both kinds: canonical ids, the redirects, 404s, class `slow`, a PNG of 1200 × 630; a `Cannot GET` from D or AD → 503, not stored |
| `test/worker/meta.spec.ts` | Titles, descriptions per status, canonical and `og:*` on default views, `noindex, follow` and none of them on the others |
| `test/worker/data-api.spec.ts` | The six methods' paths, queries, classes and TTLs. A malformed 200 for each is a `server` error and not stored. |

**Fixtures.** D1's answers come from weeks of collected validations and votes, so they are not recorded. They are **generated**, like E2's synthetic aggregates, by `scripts/validators-fixtures.ts`, which `make-http-fixtures.ts` calls. It is seeded per network and route (mulberry32). D1 is built before E6, so it follows the shapes, key orders and rules of the built `docs/api-reference.md` of `data-api-new`'s `feat/explorer-data` at a commit the plan pins (read with `git show`, never a checkout), not the spec text:

- **The fleet.** XRPL has 35 UNL validators and 25 others. Xahau has 31 and 10. The master and signing keys are valid node public keys encoded with `ripple-address-codec` from seeded bytes. The domains are `*.example` (RFC 2606), so no real operator is ever implied. Every case of the pages is present:
  - verified, each `unverified` reason, `pending`, no domain;
  - on two lists, on one, on none, on the negative UNL with a pending re-enable;
  - no fee vote, a higher and a lower one;
  - incomplete agreement, no score;
  - a UNL member never seen;
  - a signing key that resolves to its master;
  - a verified validator whose TOML lists accounts (`domain_verification.accounts`, G1);
  - a validator voting on the `unknown` amendment, so its D answer's `votes[]` holds an `unknown` entry (G4);
  - Xahau builds.
- **The amendments** are real names with their real IDs: `SHA-512Half(name)`, computed by the generator, and checked by the fixtures test against D1 F9's known pairs. Their statuses, votes and dates are synthetic:
  - XRPL: one `majority` with 30 days of rounds (about 2,600) and a got/lost/got history; three `voting` with 3 days of rounds (a deployment that has run three days); `enabled` from the ledger and from metadata; `obsolete`; one `unknown` with no name; `xls_url` on the amendments that have an XLS (G2);
  - Xahau: `majority` without an indexed EnableAmendment, so without `majority.ledger_index` and `tx_hash` (G5), `voting`, `enabled`, `retired`, with `introduced` in xahaud's date form;
  - every AD file carries A's envelope (G3).
- **Files**, per network (named by the request, as the other fixtures):
  - `data-api/network/validators/summary.json`;
  - `data-api/network/validators@limit=1000&scope=all.json`;
  - `data-api/network/validators/<KEY>.json` for every row, and one `<SIGNING_KEY>.json` holding its master's answer;
  - `.../<KEY>/validations@limit=20.json`, and one marker page;
  - `data-api/network/amendments.json`;
  - `data-api/network/amendments/<NAME|ID>.json` for each.
- **Filling states** (section 10) are overrides in the specs, not files.

`test/fixtures/PROVENANCE.md` gains a section, "Synthetic validators and amendments". It names the generator, the seeds, and the pinned `feat/explorer-data` commit whose `docs/api-reference.md` the shapes follow. The README's "Upstream fixtures" table marks the files "generator (synthetic)". `pnpm fixtures:check` and `scripts/http-fixtures.test.ts` cover them. Once D1 is on staging, the e2e suite against the real stack (`E2E_DATA_API_URL`) catches any drift from real answers.

**End to end (Playwright)**

Where E2's `E2E_FEATURES_OFF` lists `VALIDATORS` (a run against staging or production before the switch is on there), the tests below that need the pages skip themselves, and `validators.spec.ts` runs the off-case instead: the four pages are 404s, and "All validators" is "soon".

- `test/e2e/validators.spec.ts`:
  - from the network page, "All validators" lands on `/xrpl/validators?scope=all`, and a first-seen key on its validator;
  - the default list;
  - "All" changes the URL to `?scope=all`, adds `noindex` and drops the canonical link, and Back restores them;
  - a search through the form, with JavaScript (no redirect is requested) and without it (`contextFor`; the redirect tidies empty fields);
  - "Votes yes for" and "Listed by" (XRPL), none of "Listed by" on Xahau;
  - Clear filters;
  - a row leads to the validator page;
  - the versions chart's Table radio works without JavaScript;
  - the validator page: copy buttons, the agreement slider's arrows change `aria-valuetext`, Older and Newer, and a hex key URL lands on the base58 URL.
- `test/e2e/amendments.spec.ts`:
  - the status chips;
  - the activating-soon line links to the amendment;
  - the yes-votes chart: Page Up moves a day, and the Table radio shows the changes-only table;
  - the Other validators disclosure;
  - a lower-case ID URL lands on the name URL;
  - a ledger link and an EnableAmendment link lead to their pages;
  - countdowns are absolute text with JavaScript off, and tick with it on.
- `test/e2e/validators-live.spec.ts`, in the `live` project, alone, after the others (it changes the fixture server's answers):
  - a new validation enters the validator page's table with `.is-entering`, and only the route's `.data` URL is asked for;
  - reduced motion moves nothing;
  - pause and resume;
  - the table hold;
  - a 503 keeps the page and shows "Live updates paused, retrying…" after two;
  - with `/v2/network/amendments` overridden to 503 before the validators list loads, "Votes yes for" is missing; once the override is removed it appears by itself within the hold plus a beat. An open list whose beat then fails keeps its select (`keepLoaded`).

**Accessibility.** `a11y.spec.ts` (axe, WCAG 2.2 AA tags; the gate is no violation of impact serious or critical):

| Pages | Matrix |
|---|---|
| `/xrpl/validators`, `/xrpl/validators/{a verified UNL validator}`, `/xrpl/amendments`, `/xrpl/amendments/{the majority one}` | 1280 px and 375 px × the four theme settings (light and dark by system; dark and light chosen by the toggle against the other system theme) |
| `/xahau/validators`, `/xrpl/validators?scope=all&q=…` with no match, an unverified validator without domain, a marker page, `/xahau/amendments`, an enabled amendment, an unknown one, every table view on, a page with a failed card, the amendment page with the slider focused and its tooltip shown, the Other validators disclosure open | the two system themes |

`landmark-unique` covers the filter form's search landmark next to the header's. The 375 px runs check that no page scrolls sideways: tables and the chart of 30 days scroll inside their cards.

**Bundle.** `PAGES` in `scripts/bundle-budget.ts` gains `validators` (`routes/net.validators`), `validator` (`routes/net.validators.$key`), `amendments` (`routes/net.amendments`) and `amendment` (`routes/net.amendments.$name`), and `scripts/check-bundle.test.ts` follows. The gate stays 150,000 B gzipped per page. The target is E2's 145,000 B. If a page is over it, E2's decided fallback applies: `Cursor` and the tooltip load with `import()` on the first `pointerenter` or `focusin` of a plot. The check counts a page's entry, root, layout and route chunks with their static imports; it does not count the route manifest. With `routeDiscovery: "initial"` the manifest every page loads grows by four routes. That growth of the shared base is E2's recorded risk, with a measurement step in E2's plan; E6's plan repeats that measurement with its four routes, and E6 claims no check of its own for it.

---

## Rollout

| Step | What ships | Behaviour |
|---|---|---|
| 1. D1 | Built and deployed in `data-api-new` (its Rollout: migrate, syncer, API), staging then production, both networks. It goes to a persistent environment only after the owner has merged `feat/amm-data` there (D1's deploy-order rule). | The six routes answer, and fill over hours (votes) to 30 days (agreement) |
| 2. E2, E3, E4 | E2 with the kit, the live page, the hold, the feature switches with `VALIDATORS`, `navSection`, `keepLoaded`, `Anchor` and the route-missing rule; E3 with `minute`; E4 with `extras` and `forming` | The network page; "All validators" says "soon" while `VALIDATORS` is off |
| 3. E6 | Everything in this spec. `VALIDATORS` goes `"on"` at the top level and stays `"off"` in staging and production. The six paths are in `PENDING_PATHS`. | Staging and production are unchanged: the four pages and their images are 404s, and nothing links to them. The suites run the pages against the fixtures. |
| 4. Staging on | `VALIDATORS` `"on"` for staging (a deploy), once D1 has served staging on both networks for at least two hours (votes and tallies back-filled, D1's estimate) | The pages, their images and the network page's links appear on staging at once (the cache generation). The e2e suite runs against the staging stack, and the staging checklist below is worked through. |
| 5. `pnpm api:sync` | After D1 is merged: `pending-paths.test.ts` fails, and the paths move to `PATHS` | None |
| 6. Production on | `VALIDATORS` `"on"` for production (a deploy), by the same rule. `NetworkPage.test.tsx` covers the card's links with the switch on and off (Testing); an e2e test that follows "All validators" to `?scope=all` runs where the switch is on. | The network page links to the validators list and to each first-seen validator |

**Rolling back** is `VALIDATORS` `"off"` and a deploy.

Before production, the staging checklist (README) gains:

- the four pages on both networks against the staging stack, and the image of a validator and of an amendment;
- the hold seen in `wrangler tail` (one failing call per 5 s per instance while a card fails);
- one L request per 10 s per instance whatever the filters (`wrangler tail`);
- a page answered 503, not stored, against an API without D1;
- the four bundle figures.
