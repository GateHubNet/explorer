# Display names (E9): design

Status: proposed (2026-10-24), program 2, sub-project E9. Repository `GateHubNet/x-explorer`, branch `feat/explorer-pages-2`.

- **Boards** (`2026-10-24-explorer-mock/`): `AccountNames.dc.html` (the four states: verified with "How we know", named by GateHub,
  domain not verified, no name; a transaction table with names), `Account.dc.html` (names in every table, the header's domain line),
  `Delegation.dc.html` and `Validator.dc.html` (names in context). AccountNames is a gallery of states, not a page: it has no route.
- **Data**: the data API's D4, `data-api/docs/superpowers/specs/2026-10-24-display-names-design.md` (branch `feat/explorer-data-2`):
  `GET /v2/account_names` (its 5.2) and `GET /v2/toml/{domain}` (its 6).
- **Related**: the foundation (`2026-10-17-explorer-foundation-design.md`), E6 (`2026-10-19-validators-amendments-pages-design.md`:
  the validator page's accounts line, `DomainStatus`, `ExternalLink`, the verification note), E8 (`2026-10-24-nft-pages-design.md`,
  built before this), E10, E11 and E13 (`2026-10-24-validators-map-design.md`), which use what this adds; the program overview
  (`2026-10-24-explorer-program-2-overview.md`).

## Owner decisions to confirm

| # | Choice | Recommendation |
|---|---|---|
| 1 | A names call that fails or is late (1.5 s) never fails a page: it shows addresses, as today, and is served and not stored (degraded), with a log line. | Accept |
| 2 | A page of class `immutable` that shows names (a transaction, a closed ledger) is kept at the edge 1 hour (`NAMED_PAGE_TTL_SECONDS`), not a year, while `NAMES` is on, so a new label or name shows within about an hour. | Accept |
| 3 | One names call per awaited part and one per streamed section that shows accounts: the account page makes two (header, list); its Analytics view one per card with accounts. One call for the whole page would hold the header for the list. | Accept |
| 4 | At most 400 addresses of a page get names (four calls of 100 side by side); the rest show addresses (a ledger with more than about 200 transactions). | Accept |
| 5 | A link reads the display name, then ` · ` and the account network name when there is one, for every kind (the board does this for "Harborline Exchange · hot wallet"). | Accept |
| 6 | The hover title of a verified name names its domain, "Verified by northpeak.example · r…", where the board says "Verified name · r…": a toml's `desc` can claim any name, the domain cannot be faked. | Accept |
| 7 | Server-built text: the account page's own title, description and link-preview card use its name when it is verified or named by GateHub, and say a label in words; transaction and ledger titles, cards and the sentence summary (`plainText`) keep short addresses; a chart label that links to an account shows the name and its mark; issuer texts in a page's body use the name when verified or named by GateHub and unlabelled. | Accept |
| 8 | "How we know" is closed by default; the board draws it open. | Accept |
| 9 | The domain is a link (`rel="noopener noreferrer nofollow"`) only when it is verified; an unverified domain is text (the Account board links it). | Accept |
| 10 | The toml facts (principals, currencies, last modified) are shown for a verified domain only. Currencies are plain text until E11 makes them token links. | Accept |
| 11 | "Ask GateHub to change it" needs a URL from the owner (`NAME_REQUEST_URL` in `app/ui/brand.ts`); without one the sentence has no link. | Owner to give the URL |
| 12 | Labels: one warning banner per label on the labelled account's page (title, description, source, link), and a warning mark beside the name or address everywhere. The boards do not draw either. | Accept |
| 13 | `NAMES` is `"off"` in the sandbox and production until that environment's data API has D4 deployed, its seed run and its first toml sweep done (`syncer_tomls_due` near 0). | Accept |

## Goal

Wherever the explorer shows an account, it shows the account's **display name** with a mark of its kind instead of the shortened
address, and the full address on hover; a labelled address gets a warning mark, and its page a banner. The account page's header says
the name, the account network name, the domain and its state, how the name is known, and what the domain's toml says.

## Non-goals

Search by name (the data API has no name index; the search box is unchanged); a page of names; editing names; names in CSV files (the
payments CSV is the API's) and in the raw JSON tabs; names on the never-activated 404 page; a name in a transaction's link preview.

## 1. What changes, where

The places that show an address today, and what each becomes. "Link" means `AccountLink` (section 4.1), which reads the names of its
section (3.4); "plain" means `plainNameOf` (3.3): the name when verified or named by GateHub and unlabelled, else the short address.

| Page (route) | Where accounts show | Collected from (3.1) | Calls |
|---|---|---|---|
| Home (`/{net}`) | the transactions table (`HomePage.tsx`, Account) | `rows[].account` | one, `holdFailure`, kept by `keepLoaded` (3.4) |
| Ledger (`/{net}/ledger/{id}`) | the transactions table, Accounts created | the rows' accounts, `accountsCreated` (the shown ones) | one; `immutable` kept 1 h |
| Transaction (`/{net}/tx/{id}`) | the sentence (`Sentence`), `Flow`, details (`AccountLink full`), balance changes (account, issuer), affected objects | `description.sentence`, `flow`, `details`, the changes, the objects; never the raw JSON | one; `immutable` kept 1 h; the node fallback too |
| Account (`/{net}/account/{a}`) | the header (the account, parent, token issuers), the tab's list (sentence segments, counterparties) | header: the address, `activation.parent`, `tokens.items[].issuer`; list: its rows | two (header, list); one on a page behind a marker |
| Account, Analytics tab | counterparties (rows), balances (issuer sublabels), exchanges (issuer texts) | each card's rows | one per card that has accounts, inside the card's deadline |
| AMM pool (`/{net}/amm/{pool}`) | pool account (`full`), creator, LP holders, votes (`BarList`), takers, providers | the page's parts | one |
| AMM list (`/{net}/amm`) | issuer texts | the rows' issuers | one; plain |
| Markets (`/{net}/markets`) | issuer texts | the rows' issuers | one; plain |
| Market pair (`/{net}/markets/{b}/{c}`) | takers, active accounts (`BarList`), issuer texts | the page's parts | one, `holdFailure`, `keepLoaded` |
| Validator (`/{net}/validators/{key}`) | the accounts line, `ValidatorPage.tsx:226` (`shortAddress` in a `Link`, becomes `AccountLink`) | `grid.accounts` | one, `holdFailure`, `keepLoaded` |
| NFT pages (E8) | issuer, owners, sellers, buyers, minters | E8's view parts | one per awaited part, as above |
| Link preview `/og/{net}/account/{a}.png` | the headline | the address | one |

Later pages (E10 objects and delegation, E11 tokens, E13's toml card, E14) use the same helper and component.

## 2. Data API calls

### 2.1 Client (`app/server/data-api.ts`)

`PENDING_PATHS` gains `accountNames: "/v2/account_names"` and `toml: "/v2/toml/{domain}"` until `pnpm api:sync` brings them into
`PATHS` (`test/unit/pending-paths.test.ts` says when).

- `accountNames(addresses: readonly string[], opts?: FreshOptions): Promise<AccountNamesResponse>`: 1 to 100 classic addresses, sent
  as given (`loadNames` sorts them), `?addresses=a,b,…`. Class `minute` (the data API reloads names every 60 s and says
  `max-age=60`). Checked inside the load by `checkAccountNames(body, addresses)` (`app/server/names-shape.ts`): `count` and the list's
  length equal the addresses asked, each entry's `address` is the one asked at its place, `display_name` (when present) has a
  non-empty `text` and a `kind` string, `labels` (when present) an object of `{ description: string, source?, url? }`. A failure is
  kind `server` and is never stored. A `kind` this build does not know (a newer API) is read as no name, not as an error.
- `toml(domain: string): Promise<TomlAnswer>`: class `slow` (a toml is read at most daily). `toml not found` is `not_found` (not
  checked yet); `checkToml(body, domain)` checks the `domain`, the `status`, the lists' shapes.
- Types (`app/server/api-types.ts`), written from D4's 5.2 and 6: `DisplayNameKind = "verified" | "account" | "domain"`,
  `AccountNameEntry { address; display_name?: { text; kind }; domain?; account_name?; account_network_name?; labels?: Record<string,
  LabelData> }`, `LabelData { description; source?; url? }`, `AccountNamesResponse { result; count; account_names }`, `TomlAnswer {
  result; toml: { domain; toml_url; status: "ok" | "failed"; reason?; status_code?; checked; fetched?; modified?; expires?; accounts?;
  currencies?; principals?; validators? } }`. `AccountData` is left as it is: the page reads names from the batch, not from
  `/v2/accounts/{address}`'s `account_name`.

### 2.2 Cache

| What | Class | Notes |
|---|---|---|
| `accountNames` | `minute` (60 s) | key: the sorted addresses; polled pages pass `holdFailure: true` |
| `toml` | `slow` (1 h) | |
| A page of class `immutable` with names | `immutable`, edge TTL `NAMED_PAGE_TTL_SECONDS` = 3600 (`app/server/cache-class.ts`) while `NAMES` is on | `cached(page, "immutable", { ttl })`: the transaction page and a closed ledger's page; the subrequests under them keep their own class |
| Every other page | its class as today | a page of `live`, `live-home`, `minute`, `slow` or `short` is kept less than an hour already |

Worst case for a new label to show on a transaction page: the page's hour, plus the names call's minute, plus the data API's minute.

## 3. The names helper

### 3.1 `collectAddresses(...parts: unknown[]): string[]` (`app/server/names-load.ts`)

Walks the plain data it is given (arrays and objects, depth first, keys in order) and keeps every string that is a classic address
(`/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/` and `isValidClassicAddress`), once each, in the order first met. A loader passes the parts of its
page data that it shows (section 1), never a raw transaction or metadata, so that only addresses on the screen are named. The walk
is pure and runs in the Worker only (it imports the address codec).

### 3.2 `loadNames(api, addresses, ctx): Promise<NamesResult>` (`app/server/names-load.ts`)

- `ctx`: `{ context, request, features, holdFailure?, deadlineMs? }`; `NAMES_DEADLINE_MS` = 1,500 by default; a streamed section
  passes what is left of its own deadline.
- With `features.names` off: `{ part: { state: "off", map: {} }, entries: new Map() }`, and no call.
- The first `NAMES_MAX_ADDRESSES` (400) addresses, sorted, in chunks of `NAMES_BATCH_LIMIT` (100), one `accountNames` call each, side by
  side. No addresses: no call, `state: "ok"`.
- Never rejects. A call that fails or misses the deadline: `markDegraded(context, "names could not be loaded")`, `logProblem(…)`, and
  the answers that did arrive are used; `state: "failed"` when any failed.
- Returns `part: NamesPart` (`{ state: "ok" | "off" | "failed"; map: NameMap }`, which goes to the browser) and `entries:
  ReadonlyMap<string, AccountNameEntry>` (Worker only: the account header reads the labels' descriptions and the domain from it).

### 3.3 The view (`app/domain/names.ts`, pure, browser-safe)

```ts
export type NameKind = "verified" | "account" | "domain";
export interface NameView {
  name?: { text: string; kind: NameKind };   // absent for an address that has labels only
  network?: string;                          // the account network name
  domain?: string;                           // the account domain; verified exactly when name.kind is "verified"
  labels: string[];                          // label keys in the API's order: scam, spam, advisory (an unknown one kept as written)
}
export type NameMap = Readonly<Record<string, NameView>>;
```

- `nameViewOf(entry)`: `null` for an entry with no display name, no account network name and no label (most addresses), so the map
  holds only addresses with something to show.
- `linkTextOf(view)`: `name.text`, then ` · ` and `network` when it is set and is not the text itself (decision 5).
- `nameTitleOf(view, address)`: `Verified by {domain} · {address}`, `Named by GateHub · {address}`, `Domain not verified · {address}`,
  or the address; then ` · Labelled {scam and spam} by GateHub` when labelled (decision 6).
- `plainNameOf(view)`: `linkTextOf(view)` when `name.kind` is `verified` or `account` and there is no label, else `null`.
- `mergeNames(next, shown)`: `shown`'s entries under `next`'s (for a live page that keeps rows of an earlier beat).

### 3.4 Getting names to components (`app/ui/names.tsx`)

Components never fetch: names reach them in page data.

- Each loader puts `names: NamesPart` in its page data (a streamed section in its own data), and the page wraps what it draws in
  `<NamesProvider names={data.names.map}>`; a streamed list in `<Await>` wraps its rows in one more, which adds to the outer map.
- `useNameOf(address): NameView | undefined` reads the nearest provider; outside one (a test, an error page) every address is unnamed.
- **Live pages** (home, market pair, validator) name `names` among the parts of `keepLoaded(next, shown, parts)`: a beat whose names
  call failed keeps the names on screen; the page's merge also runs `mergeNames` so that rows kept from an earlier beat keep theirs.

## 4. Components

### 4.1 `AccountLink` (`app/ui/components/AccountLink.tsx`)

Props unchanged (`net`, `address`, `full?`, `variant?`). It reads `useNameOf(address)`:

- **No view**: as today (`shortAddress`, or the whole address with `full`; mono; the address as the title when shortened).
- **A name**: `<Link className={cx("acct", variant === "chip" && "ent")} title={nameTitleOf(view, address)}>` holding
  `<span className="acct__name">{linkTextOf(view)}</span>`, `<NameMark kind/>`, and `<LabelMark labels/>` when labelled. Not mono. With
  `full`, the whole address follows in `<span className="acct__address mono">` inside the link, so the details row "Account" still
  shows it.
- **Labels only**: the short (or full) address as today, with `<LabelMark>` and the label words in the title.
- The name is cut by CSS (`text-overflow: ellipsis` on `.acct__name`, as table cells do), never in the data; the mark stays visible.

### 4.2 Marks (`app/ui/components/NameMark.tsx`)

| Mark | Drawn | Accessible text |
|---|---|---|
| `NameMark kind="verified"` | the board's seal-check icon, `--ok` | visually hidden "verified name" |
| `NameMark kind="account"` | the board's tag icon, `--muted` | visually hidden "named by GateHub" |
| `NameMark kind="domain"` | the board's small "not verified" tag (`.unv`), text | its own text |
| `LabelMark labels` | `AlertIcon`, `--bad` | visually hidden "labelled scam by GateHub" (the labels joined with `joinAnd`) |

Icons are `aria-hidden`; meaning is never colour alone (shape, and the hidden or visible word). A link's accessible name is its text
and the marks' words: "Northpeak Treasury verified name". `AccountLink`'s title is for the mouse only (the full address is also on the
account page).

### 4.3 The chart kit

`BarListData.items[]` gains `mark?: { kind?: NameKind; labels: string[] }` (`app/ui/charts/types.ts`); `BarList` draws `NameMark` and
`LabelMark` after the label (the kit may import `app/ui/components/*`). The view builders of the pair page (active accounts) and the
AMM pool page (votes) set `label: linkTextOf(view)`, `sublabel: shortAddress(address)` and `mark` for a named item; an unnamed one is
unchanged. Issuer sublabels (`SmallMultiples` panels of the Analytics balances card, the network and markets views' `sublabel`s) and
issuer texts in the page body (`issued` of the pair, markets and AMM views, the Analytics exchanges' `issued`) use `plainNameOf`, else
the short address. The kit's token covers `mark` (it is part of what a chart draws).

### 4.4 Styles

`components.css`: `.acct` (inline flex, gap 4 px, `min-width: 0`), `.acct__name` (ellipsis), `.acct__address`, `.namemark`
(`--ok`/`--muted`), `.unv` (the board's tag), `.labelmark` (`--bad`), the account header's `.account-head__name`, `.account-head__kind`,
`.disc` (the board's disclosure, a chevron that turns), `.toml-facts`. Contrast of the marks on both themes in `tokens.test.ts`; 44 px
targets are the links', not the marks'; forced colours keep the icons (`currentColor`).

## 5. Loaders

Each loader of section 1: after the calls it awaits, `collectAddresses(…its shown parts)`, `loadNames(…)`, and `names` in its data.
Specifics:

- **Home, market pair, validator** (live, polled): `holdFailure: true` on the names call (README "The failure hold"); `names` in
  `keepLoaded`'s parts. The home page's Account example (a search hint) keeps the short address.
- **Ledger, transaction**: `cached(page, "immutable", net.features.names ? { ttl: NAMED_PAGE_TTL_SECONDS } : {})`. A page from the
  node (`short`, `FROM_NODE_TTL`) is named too.
- **Account, first page**: the header's call after the header's calls (the address, the parent, the token issuers), awaited with the
  header; the toml call (6.5) starts as soon as `account_info` gives a domain, beside the rest, with the deadline of the last ledger's
  lookup (1.5 s). A deleted account has no `account_info`: its domain is the header call's entry's, and the toml call follows that
  call. The list's names call runs inside the list's promise after its rows, within `LIST_DEADLINE_MS`; the list's data carries its
  `names`.
- **Account, behind a marker**: one call for the address and the list's rows, awaited (the page is stored an hour).
- **Account, Analytics view**: the header's call as on the first page (no token issuers: no holdings); in `loadAnalytics`, each card
  whose rows hold accounts (counterparties, balances, exchanges) calls `loadNames` inside its promise, before its deadline.
- **Link preview of an account**: `loadNames(api, [address])`; the image keeps class `slow`.
- **E8's NFT pages**: their loaders pass their shown parts; nothing else changes in them.

## 6. The account page header

### 6.1 Layout, per state (the AccountNames board)

The header block (`app/ui/components/AccountNameBlock.tsx`, used by `AccountPage.tsx` for the list tabs, the Analytics view and the
page behind a marker) has the identicon and "Account" as today, then:

| State | `<h1>` | Under it |
|---|---|---|
| Verified | link text + `NameMark verified` (+ `LabelMark`) | the address (mono) with copy and QR buttons; "Verified name · domain [northpeak.example](https://northpeak.example)"; "How we know" (6.2) |
| Named by GateHub | link text + `NameMark account` (+ `LabelMark`) | the address with its buttons; "Named by GateHub · no domain set", or "· domain {d}" with `DomainStatus`; the help sentence: "GateHub names accounts that have no verified name, such as an exchange's hot wallet. If this name is wrong, or an account you run should have one, ask GateHub to change it." (the last words a link to `NAME_REQUEST_URL`, decision 11) |
| Domain not verified | the domain + `NameMark domain` (+ `LabelMark`) | the address with its buttons; the sentence of 6.3 |
| No name | the address with its buttons, as today (+ `LabelMark`) | the activation line as today, its "· domain {d}" with `DomainStatus pending` when it is a well-formed domain the index has not checked |

The account network name is in the link text (decision 5). The activation line ("Activated on … by {parent} with …") stays; it drops
its "· domain" part when the line under the `<h1>` names the domain. The breadcrumb's last item is the link text (cut by CSS) instead
of the short address. The balance and holdings are unchanged.

**The domain shown** is the node's (`live.domain`, today's `decodeDomain`), lower-cased for comparison; without live state (deleted, or
the node did not answer) it is the entry's `domain`. Its state: **verified** when the entry's kind is `verified` and its `domain` is
that domain; **not verified** when the entry's `domain` is that domain and the toml has a row; **pending** ("not checked yet") when it
is a well-formed domain and the entry has another or none (the index is behind, the account is dormant since before the history, or the
toml was never read: `toml not found`); **none** (text only, no mark) when it is not a well-formed domain (`https://…`, an IPFS hash).

### 6.2 How we know (verified)

`<details className="disc"><summary>How we know</summary>`, closed by default (decision 8), keyboard-operable as a native disclosure:

- A list of two passed checks, each with the check icon and a visually hidden "Passed: ": "The account's Domain field is
  **northpeak.example**." and "[northpeak.example/.well-known/xrp-ledger.toml](toml_url) lists this address under `[[ACCOUNTS]]`, and
  its `desc` gives the name." (when the name is the domain: "…under `[[ACCOUNTS]]`. It gives no `desc`, so the name is the domain.").
  The file is `xahau.toml` on Xahau (`tomlFileOf(network.software)`). The link is `ExternalLink` with `nofollow`.
- "Checked {date, time UTC}" from the toml's `checked`, when the toml call answered.
- **What else that toml says** (decision 10), the board's facts list, each row only when present and the box only when any:
  **Principals** (the names, `joinAnd`), **Currencies** (each `code` through `formatCurrency`, mono, plain text; E11 makes each a link
  through its `tokenLink` to `/{net}/token/{currency}.{issuer}` when `TOKENS` is on and the entry has an issuer), **Last modified** (`formatDate(modified)` and
  "from `[METADATA]`").

### 6.3 Domain not verified: the sentence

Built by `app/server/toml-words.ts` (the sentences of E6's `unverifiedSentence` move there, with the subject, "this master key" or
"this account", as a parameter; the validator note keeps its words):

| Toml | Sentence |
|---|---|
| `ok` (it does not list the account) | "This account names lowtide.example in its Domain field, but lowtide.example's xrp-ledger.toml does not list the account. The explorer shows the domain, without vouching for it." (the board's) |
| `failed` | "This account names lowtide.example in its Domain field, but its xrp-ledger.toml could not be read: {E6's reason words}. The explorer shows the domain, without vouching for it." |
| `toml not found` | the state is pending (6.1), not this one |
| the call failed | the first sentence's first clause and "The explorer shows the domain, without vouching for it." |

The same sentence is the `title` of the `DomainStatus` mark where the domain is on the activation line.

### 6.4 The label banner

Above the header section, after the breadcrumb: one `Notice tone="warning"` per label, in the API's order (decision 12), title
"Labelled {label} by GateHub", body the `description`, then "Source: {source}" when given, and "Details" as an `ExternalLink` with
`nofollow` when the `url` is `https://` (anything else is not linked). A deleted account keeps it. The `<h1>` carries `LabelMark` too.

### 6.5 The view builder

`accountNameHeader(input): NameHeader` (`app/server/account-name-view.ts`, pure, unit-tested), with `input`: `address`, `entry?:
AccountNameEntry` (from `NamesResult.entries`), `liveDomain: string | null`, `toml: Loaded<TomlAnswer> | null` (null: no domain to ask
about), `network` (software, id). `NameHeader`: `title` (`{ text, kind, network? }` or `null` for the address), `labels` (banner views),
`labelMarks`, `domainLine` (`{ text, state, href?, note? }`), `howWeKnow` (or `null`), `facts` (or `null`), `help` (`"named"` or
`null`). `AccountHeader` gains `name: NameHeader | null` (`null` with `NAMES` off or a failed header call).

### 6.6 Failures

| Failure | Shows | Page |
|---|---|---|
| The header's names call failed or was late | today's header (address, activation line, domain as text) | degraded |
| The list's names call failed | the list with addresses | degraded (the list section's rule) |
| The toml call failed (not `not_found`) | the name and its state from the batch; "How we know" without "Checked" and facts; the sentence of 6.3's last row | degraded |
| `toml not found` | pending (6.1) | not degraded |
| The node did not answer | the domain from the entry | degraded as today |

## 7. Server-built text

| Text | With names (decision 7) |
|---|---|
| Account page `<title>` | `Account {plain} ({short}) · {suffix}` when `plainNameOf` gives one, else today's |
| Account page description | today's, after "GateHub has labelled this address {labels}." when labelled, and with "Verified by {domain}." or "Named by GateHub." when named |
| Account link preview (`accountCard`) | `headline` the plain name (text font) with `parties: [address]` (mono), else the address as today; `note` "Verified by {domain}" or "Named by GateHub", then today's "Activated …"; a labelled account's `note` starts "Warning: labelled {labels} by GateHub" |
| Transaction and ledger titles, descriptions, cards, `plainText` | short addresses, as today (kept long, shared out of context, no room for a mark) |
| `BarList` labels that link to an account | the link text and its mark (4.3) |
| Issuer sublabels and issuer texts in a page's body | `plainNameOf`, else the short address |
| `aria-label`s that name an account (`AccountLink` has none) | unchanged |

## 8. The switch `NAMES`

`FEATURE_VARS` gains `NAMES` (last), `FEATURE_NAME` `names`; `Env`, every block of `wrangler.jsonc`, `TOP_LEVEL_SWITCHES`, the README's
tables, the cache-generation strings of `features-off.spec.ts` and `env.test.ts` (README "Adding a switch"). Values: top level `"on"`,
`sandbox` `"off"`, `production` `"off"`. A feature-level switch: no route answers 404 and no nav link reads "soon".

With it off: no names call and no toml call; `AccountLink`, `BarList`, the header, the titles and cards are today's; immutable pages
keep their year. Turned on in an environment by a commit and a deploy once that environment's data API serves `/v2/account_names` and
`/v2/toml/{domain}`, D4's seed has run and `syncer_tomls_due` is near 0 there (decision 13); rolling back is `"off"` and a deploy.

## 9. Both networks and the sandbox

Nothing is per network in the explorer but the toml file's name (`xrp-ledger.toml`, `xahau.toml`, from `network.software`) in "How we
know" and the sentences. Names come from each network's data API: an address can have a verified name on one network and not the other
(its Domain is per network), and the same account name and labels on both. The sandbox (E7) reads the testnets' data APIs; few testnet
accounts have names, and nothing changes in the code.

## 10. Fixtures

- `scripts/names-fixtures.ts` (seeded, synthetic; run by `pnpm fixtures:sync`, checked by `pnpm fixtures:check`) writes, for each
  network, `test/fixtures/http/<net>/data-api/account_names.json`: `{ "<address>": <entry> }` in D4's key order, one entry per line,
  for the addresses the other fixtures show (the hand-written accounts and their parents and token issuers, the eight newest
  transactions' parties, the pair pages' takers and active accounts, the AMM pages' accounts, the validators' toml accounts, the
  transactions the e2e suite opens). A seeded hash picks the state: about one in five verified, one in eight named by GateHub (half with
  an account network name), one in ten domain not verified, the rest nothing; and fixed cases: one active hand-written account per
  network verified (with principals, two currencies and `modified`), one named by GateHub, one domain not verified, one labelled `scam`,
  one labelled `advisory` with `source` and `url`, one with a label only. Names are fictional and domains `*.example`, as E6's
  validators.
- `test/fixtures/http/<net>/data-api/toml/<domain>.json`: `ok` files for the verified domains (listing their accounts with `desc`, one
  without `desc`), an `ok` file that does not list its account, a `failed` `http_status` 404 one; one domain with no file (`toml not
  found`).
- `test/support/upstream-core.ts` answers `GET /v2/account_names` by composing (as `dataApiAbsent` composes a 404): the addresses parsed
  as D4 parses them (its three 400 messages), each entry from `account_names.json` or `{ "address": … }`, in order, `count`. The
  fixture server and `mockUpstream` share it; an override replaces it (`unavailable()` for a failure).
- README "Upstream fixtures": rows for both files, by "generator (synthetic)"; `test/unit/names-fixtures.test.ts` checks every entry's
  shape, that each named fixture account has a toml file when verified, and the line counts.

## 11. Tests

**Unit** (`pnpm test`): `names.test.ts` (`nameViewOf`, `linkTextOf`, `nameTitleOf`, `plainNameOf`, `mergeNames`, an unknown kind or
label); `names-load.test.ts` (collect order and dedupe, no raw JSON, invalid strings skipped; sorted chunks of 100; the 400 cap; off:
no call; a failure and a late answer: addresses, degraded, logged; one chunk failing); `names-shape.test.ts`; `account-name-view.test.ts`
(every row of 6.1, 6.3 and 6.6; https-only label links; `desc` absent); `toml-words.test.ts`; `AccountLink.test.tsx` (each kind,
labels only, `full`, chip, accessible name, title); `NameMark.test.tsx`; `BarList.test.tsx` (`mark`); `AccountPage.test.tsx` (the
header per state, the banner, "How we know" closed and opened, the facts, the help link with and without `NAME_REQUEST_URL`);
`meta.test.ts` and `card-data.test.ts` (7); `features.test.ts` and the guard (the misspelt `NAME`).

**Worker** (`test/worker/`): per page of section 1, one names call per part with the sorted addresses, class `minute`, `holdFailure` on
the polled pages; the transaction and closed-ledger pages stored with a 1-hour edge TTL; a failed names call: addresses, not stored;
the account page's two calls and its toml call; `names-off.spec.ts` (the `worker-off` project): no call, today's pages, a year for
immutable pages.

**End-to-end** (`test/e2e/names.spec.ts`, skipped when `featuresOff(process.env)` has `NAMES`), on XRPL and Xahau: the account page in
each state (`<h1>`, marks, the address under it, hover title, "How we know" opening, the facts, the banner); a transaction page's
sentence, flow and details with names and titles; the home table; a page whose names call the fixture server fails (`unavailable()`):
addresses, and a reload is a `MISS` (not stored). `a11y.spec.ts` gains the verified account with "How we know" open, the labelled
account, the domain-not-verified account and a transaction with names (axe: no violations; the links' accessible names include the
mark words; the disclosure is reachable and operable by keyboard).

## 12. Bundle budget

What the browser loads more: `names.tsx` (a context), `NameMark.tsx` (four marks, two icons), `AccountLink`'s branch, and on the account
page `AccountNameBlock.tsx` with the disclosure: about 1.5 KB gzipped on pages with accounts, about 3 KB on the account page. Every page
stays under 150,000 bytes gzipped (the network page, the closest, draws no account and does not import them). `pnpm check:bundle`
measures; the README's figures are updated. `collectAddresses` and `loadNames` are Worker-only (`app/server/`), so the address codec
does not reach the browser (`test/unit/account-bundle.test.ts` and the module-graph check).

## 13. README

A section "Display names" (sections 3 and 4: the helper, the provider, the marks, the cap, the failures); "Switches" (the `NAMES` row,
values, conditions); "The data API and the node" (`accountNames`, `toml`, `names-load.ts`, `names-shape.ts`, `account-name-view.ts`,
`toml-words.ts`); "The cache classes" (`accountNames` `minute`, `NAMED_PAGE_TTL_SECONDS`); "The account page" (the header block, the
banner, "How we know", the two calls, the domain line); "Home and ledger pages", "The transaction page", "Account analytics", "The
markets pages", "AMM pools", "Validators and amendments" (each: where names show, its call); "SEO and link previews" (section 7);
"Upstream fixtures"; "End-to-end tests"; "The client bundle check" (figures).

## 14. Dependencies

- **D4** (`/v2/account_names`, `/v2/toml/{domain}`, deployed with its seed and first sweep before `NAMES` goes on), which stacks on PR
  #20 (account names, network names and labels).
- **E8**: its NFT pages exist and are named here. **E6**: `DomainStatus`, `ExternalLink`, `unverifiedSentence` (moved to
  `toml-words.ts`), the validator accounts line. **E7**: the environment names (`sandbox`).
- **Relied on by** E10 (objects and delegation), E11 (token pages; it makes the currencies of 6.2 links), E13 (the toml card's accounts
  through the validator page's call), E14: `AccountLink`, `collectAddresses`, `loadNames`, `NamesProvider` as defined here.
