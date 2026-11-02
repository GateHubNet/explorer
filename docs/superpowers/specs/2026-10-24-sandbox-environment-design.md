# Sandbox environment: design (E7)

Status: proposed (2026-10-24), program 2, sub-project E7. Repository: `GateHubNet/x-explorer`, branch `feat/explorer-pages-2`.

- Mock: `2026-10-24-explorer-mock/TokensMpt.dc.html` (the Tokens board with `environment="sandbox"`), whose header is the target:
  the "Testnet" badge after the logo (`.tnet`), "XRPL Testnet" / "Xahau Testnet" in the network switch, the breadcrumbs and the
  sentences. `Tokens.dc.html` has the `environment` property (`renderVals()`: `netName`, `xrplName`, `xahauName`, `sandbox`).
  `LinkPreview.dc.html` has the card's pill ("XRPL mainnet").
- The data API's side: data-api `docs/superpowers/specs/2026-10-24-testnet-profiles-design.md` (D-env), built first.
- The program: `2026-10-24-explorer-program-2-overview.md`. The switches, the pre-deploy guard and the cache generation are E2's
  (`2026-10-19-network-dashboard-design.md` §6.1); the deploy is the foundation's spec 13 (`2026-10-17-explorer-foundation-design.md`).
- The words: `GLOSSARY.md`, "Environments and networks" (**production**, **sandbox**, **network**; "staging" is a word to avoid).

## Owner decisions to confirm

| # | Choice | Recommendation and why |
|---|---|---|
| 1 | One Worker variable, `ENVIRONMENT`: `"development"` (top level), `"sandbox"`, `"production"`. The sandbox shows testnets, the other two mainnets (section 5). | The facts of a network (names, CTID id, USD display) follow from it, in one table. The top level shows mainnets because every fixture is mainnet data. |
| 2 | The sandbox answers every response with `X-Robots-Tag: noindex`; `robots.txt` stays the same in both environments (section 8). | Test-network pages out of search results, while link previews (whose crawlers read `robots.txt`) still unfurl for the people testing. |
| 3 | The five program-1 switches start "off" in the sandbox, and go on by their own conditions, measured on the sandbox's data API (section 9). Every program-2 switch is added "off" there. | As for production; the sandbox's data API starts empty. |
| 4 | The badge as on the board, without the board's `title` tooltip ("Sandbox: explorer.sandbox.gatehub.net"). | A tooltip is not reachable by keyboard or touch, and the word already says it. |
| 5 | Amounts keep their codes: XRP and XAH, not "test XRP". | The badge and the network names say "Testnet" on every page; the ledger's own currency code is XRP. |
| 6 | No USD view on the testnets: `?in=usd` on `/{net}/network` redirects to the view without it (section 7.5). | Its USD is GateHub's mainnet issuer; the testnets have no such market. |
| 7 | A mainnet CTID searched in the sandbox gets today's sentence, "… is for network id 0, which this explorer does not cover.", with no link to production (section 7.7). | No URL of the other environment in the code. |
| 8 | The "Staging checklist" splits into a **sandbox checklist** (the environment: hosts, caches, holds, switch flips) and **production checks** (what needs mainnet data), plus **build figures** (section 14). The end-to-end suite is no longer run against a deployed sandbox. | The fixtures and most checks name mainnet accounts, pools and pairs, which the sandbox's testnets do not have. |
| 9 | The sandbox's XRPL node is Ripple's testnet Clio, `https://clio.altnet.rippletest.net:51234/`; production keeps `https://s1.ripple.com:51234/`, also a Clio. The XRPL node of every deployed environment must be a Clio (section 4). | E8's NFT pages fall back to Clio's `nft_info`; a rippled answers it `unknownCmd`. No Clio serves Xahau, so that fallback does not exist on either Xahau network. |
| 10 | Sandbox deploys stay by hand (`pnpm deploy:sandbox`); the release workflow deploys production only, as today. | No change to the release pipeline in this sub-project. |
| 11 | The home page's status line and the link preview's pill say "XRPL mainnet" in production and "XRPL Testnet" in the sandbox (section 7.3). | The board's pill; "XRPL Testnet mainnet" would be wrong. |
| 12 | Xahau Testnet's fixed validator list (D-env's publisher `local`) reads "Fixed list" (section 7.6). | The data API's id `local` means nothing to a visitor. |
| 13 | After a testnet reset, the sandbox is deployed again with a new build id (section 11). | Its edge and subrequest caches hold ledgers of the old chain for up to a year. |
| 14 | A unit test keeps the word "staging" out of the code, the scripts, the tests and the README (section 2). | The rename is complete only if it stays complete. |
| 15 | **Consistency pass:** in the sandbox, a program-2 switch whose condition asks for complete coverage (E10's `DELEGATION`, E12's `SUPPLY`) goes on once the sandbox's data API serves the feature, with its coverage notes (section 9). | The testnets' coverage is never complete (D-env §12), so the condition could never hold there. |

## Goal

The same Worker code serves production (`explorer.gatehub.net`, XRPL and Xahau mainnet) and the sandbox (`explorer.sandbox.gatehub.net`,
XRPL Testnet and Xahau Testnet), each from its own Worker on its own custom domain, with its own data APIs and nodes. In the sandbox every
place that names a network names the testnet, the header says "Testnet", the CTIDs carry the testnets' ids, and nothing is indexed.
"Staging" is renamed "sandbox" everywhere outside the history.

## Scope

- The rename, file by file.
- `wrangler.jsonc`: the three blocks with their real hosts, routes, data API URLs, node URLs and `ENVIRONMENT`.
- The pre-deploy guard: what it checks now.
- The facts of a network per environment (`app/server/networks.ts`), and how the environment reaches the browser.
- What the pages say in the sandbox: names, the badge, titles, link previews, the home page, the network page's views, search,
  the validators pages' fixed list.
- Robots, caches, Sentry; the switches' values in the sandbox; a testnet reset.
- Tests: a `worker-sandbox` project; the guard's tests; README sections.

## Non-goals

- A third deployed environment, Devnet, or a different network per environment (the paths stay `/xrpl` and `/xahau`).
- Running the end-to-end suite against testnet data, and testnet fixtures. The sandbox is exercised by the `worker-sandbox` project over
  the existing (mainnet) fixtures, and by the sandbox checklist.
- A link between the environments, a "switch to production" control.
- A deploy of the sandbox from CI.
- Any data API call: E7 adds none.

## 1. Environments and hosts

| | Top level | `sandbox` | `production` |
|---|---|---|---|
| Worker (`name`) | `x-explorer` | `x-explorer-sandbox` | `x-explorer-production` |
| Route | none | `explorer.sandbox.gatehub.net` (custom domain) | `explorer.gatehub.net` (custom domain) |
| `ENVIRONMENT` | `"development"` | `"sandbox"` | `"production"` |
| Networks | XRPL, Xahau (mainnet facts) | XRPL Testnet, Xahau Testnet | XRPL, Xahau |
| `XRPL_DATA_API_URL` | `https://xrpl.data.example.invalid` | `https://xrpl.data.sandbox.gatehub.net` | `https://xrpl.data.gatehub.net` |
| `XAHAU_DATA_API_URL` | `https://xahau.data.example.invalid` | `https://xahau.data.sandbox.gatehub.net` | `https://xahau.data.gatehub.net` |
| `XRPL_NODE_URL` | `https://s1.ripple.com:51234/` | `https://clio.altnet.rippletest.net:51234/` | `https://s1.ripple.com:51234/` |
| `XAHAU_NODE_URL` | `https://xahau.network/` | `https://xahau-test.net/` | `https://xahau.network/` |
| `VISITOR_LIMITER` namespace | `1000` | `1001` (staging's) | `1002` |
| `DATA_API_KEY` secret | `.dev.vars` | the sandbox data API's key | the production data API's key |

The top level keeps its placeholder data API hosts on purpose: local development and the tests never reach a deployed data API by
accident. To develop against the sandbox, `.dev.vars` holds the sandbox's four URLs, `ENVIRONMENT=sandbox` and the sandbox key
(README, "Getting started").

## 2. The rename

"staging" becomes "sandbox" in every file below; the history (git, the CHANGELOG git-cliff makes) and `docs/superpowers/` keep their
words, and `GLOSSARY.md` keeps "staging" as a word to avoid.

| File | What changes |
|---|---|
| `wrangler.jsonc` | the `staging` block becomes `sandbox`, `x-explorer-staging` becomes `x-explorer-sandbox`; the head comment (section 3) |
| `package.json` | `deploy:staging` becomes `deploy:sandbox`: `CLOUDFLARE_ENV=sandbox react-router build && tsx scripts/predeploy-check.ts sandbox && wrangler deploy` |
| `scripts/predeploy-guard.ts` | `ENVIRONMENTS = ["sandbox", "production"] as const`; the head comment; section 4 |
| `scripts/predeploy-check.ts` | usage `predeploy-check <sandbox\|production> [project root]`; comment |
| `scripts/predeploy-check.test.ts` | `good("sandbox")`, every `"staging"`; the new cases of section 4 |
| `scripts/build-id.ts` | comment: `deploy:sandbox` |
| `scripts/e2e-env.ts` | comments: "the sandbox's" stack, "a run against the sandbox or production" |
| `playwright.config.ts` | comment: `E2E_BASE_URL` tests "a deployed Worker" |
| `test/e2e/stack.ts` | comment: what `pnpm deploy:sandbox` leaves behind |
| `test/e2e/validators.spec.ts` | comment: "a sandbox or production that has the switch off" |
| `test/worker/meta.spec.ts` | `https://staging.explorer.example` becomes `https://sandbox.explorer.example` (the origin test) |
| `app/server/edge-cache.ts` | comment: "Assumption to confirm on the sandbox" |
| `README.md` | about 59 places; section 14 |
| `.github/workflows/release.yml` | the comment that the guard refuses production until its hosts are set: it now passes once the secrets are set, and the deploy stays behind `CLOUDFLARE_DEPLOY` |

`test/unit/no-staging.test.ts` (new) reads `app/`, `workers/`, `scripts/`, `test/` (not `test/fixtures/`), `.github/`, `README.md`,
`wrangler.jsonc`, `package.json`, `playwright.config.ts`, `vitest.config.ts`, `vite.config.ts` and fails on `/\bstaging\b/i` in any of
them, naming the file and line; it builds its pattern from two halves, so it does not find itself.

A Worker named `x-explorer-staging` was never deployable (the guard refused its placeholder hosts). If one exists in the Cloudflare
account all the same, the owner removes it in the dashboard; nothing in the repository refers to it.

## 3. `wrangler.jsonc`

Every block lists `ENVIRONMENT` and the switches (`vars` are not inherited). The `sandbox` block:

```jsonc
"sandbox": {
	"name": "x-explorer-sandbox",
	"workers_dev": false,
	"preview_urls": false,
	"routes": [{ "pattern": "explorer.sandbox.gatehub.net", "custom_domain": true }],
	"vars": {
		"ENVIRONMENT": "sandbox",
		"XRPL_DATA_API_URL": "https://xrpl.data.sandbox.gatehub.net",
		"XAHAU_DATA_API_URL": "https://xahau.data.sandbox.gatehub.net",
		"XRPL_NODE_URL": "https://clio.altnet.rippletest.net:51234/",
		"XAHAU_NODE_URL": "https://xahau-test.net/",
		"VALIDATORS": "off",
		"AMM_DATA": "off",
		"MARKETS": "off",
		"ACCOUNT_ANALYTICS": "off",
		"AMM_PAGES": "off"
	},
	"ratelimits": [{ "name": "VISITOR_LIMITER", "namespace_id": "1001", "simple": { "limit": 60, "period": 10 } }]
}
```

`production` is the same with its column of section 1 (`"routes": [{ "pattern": "explorer.gatehub.net", "custom_domain": true }]`,
namespace `1002`). The top level gets `"ENVIRONMENT": "development"` and no route. The head comment loses "until the hosts are decided"
and "They have no routes yet", and says what each block is (section 1).

`explorer.sandbox.gatehub.net` is two labels below the zone, outside Universal SSL's `*.gatehub.net`; a Workers custom domain issues
the certificate for its own host. The sandbox checklist confirms it (section 14).

## 4. The pre-deploy guard

`deployProblems(config, asked)` keeps every rule it has and adds these, each with every reason printed. The expected values are one
table in `scripts/predeploy-guard.ts`:

```ts
/** What each deployed environment must be: its host, its data APIs and the kind of network it shows. */
export const DEPLOYED = {
  sandbox: { host: "explorer.sandbox.gatehub.net", kind: "testnet",
    dataApi: { XRPL_DATA_API_URL: "https://xrpl.data.sandbox.gatehub.net", XAHAU_DATA_API_URL: "https://xahau.data.sandbox.gatehub.net" } },
  production: { host: "explorer.gatehub.net", kind: "mainnet",
    dataApi: { XRPL_DATA_API_URL: "https://xrpl.data.gatehub.net", XAHAU_DATA_API_URL: "https://xahau.data.gatehub.net" } },
} as const;
```

| Rule | Message (`<env>` is the environment asked for) |
|---|---|
| `ENVIRONMENT` is exactly the environment's name | `ENVIRONMENT is "<value>", but the build is for <env>. Put "<env>" in env.<env>.vars of wrangler.jsonc.` (and `ENVIRONMENT is not set …`) |
| each data API URL is exactly the environment's, on the origin (`new URL(v).origin` equal and a path of `""` or `/`) | `XRPL_DATA_API_URL is "<value>", but the <env> data API of XRPL is https://xrpl.data.sandbox.gatehub.net. …` |
| a node URL on a known public host is of the environment's kind and of its own network | `XRPL_NODE_URL names s1.ripple.com, a node of XRPL mainnet, but the sandbox shows XRPL Testnet. …`; `XAHAU_NODE_URL names clio.altnet.rippletest.net, a node of XRPL Testnet, not of Xahau. …` |
| `routes` is exactly `[{ "pattern": <host>, "custom_domain": true }]` | `the build has no route for explorer.sandbox.gatehub.net: add "routes": [{ "pattern": "explorer.sandbox.gatehub.net", "custom_domain": true }] to env.sandbox of wrangler.jsonc` (and one for a route to another host) |

The known public nodes (`KNOWN_NODES`, host → network and kind): `s1.ripple.com`, `s2.ripple.com`, `xrplcluster.com`, `xrpl.ws` (XRPL
mainnet); `xahau.network` (Xahau mainnet); `clio.altnet.rippletest.net`, `s.altnet.rippletest.net`, `testnet.xrpl-labs.com` (XRPL Testnet);
`xahau-test.net` (Xahau Testnet). A host not in the table (GateHub's own node) passes on this rule. The guard cannot tell a Clio from a
rippled: README says the XRPL node must be a Clio (decision 9), and the checklists ask for an `nft_info` answer (section 14).

The placeholder and https rules stay for all four URLs. The summary line becomes `… is the Worker x-explorer-sandbox for sandbox (XRPL
Testnet and Xahau Testnet) on explorer.sandbox.gatehub.net; its upstreams are the sandbox's, every switch is on or off, and it is not
served from workers.dev`. If the plan's `wrangler deploy --dry-run` finds that the Vite plugin leaves `routes` out of
`build/server/wrangler.json`, the route rule reads the environment's block of `wrangler.jsonc` (with `unstable_readConfig`, which the
tests already use) instead, and the plan says so.

## 5. The facts of a network per environment

**The environment.** `Env` (`app/server/env.ts`) gains `ENVIRONMENT: "development" | "sandbox" | "production"`. A new pure module
`app/ui/environment.ts` (browser-safe, no imports):

```ts
export type Environment = "development" | "sandbox" | "production";
export type NetworkKind = "mainnet" | "testnet";
/** Anything but "sandbox" or "production" is development: a deployed build has the exact value (the guard). */
export function environmentOf(value: unknown): Environment;
/** The sandbox shows the testnets; development and production the mainnets. */
export function networkKindOf(environment: Environment): NetworkKind;
```

**The names** move to `app/ui/networks.ts` (pure, the browser's), as a table by kind:

| | `name` | `label` | `longName` | `dexName` |
|---|---|---|---|---|
| mainnet `xrpl` | `XRPL` | `XRPL mainnet` | `the XRP Ledger` | `the XRP Ledger DEX` |
| mainnet `xahau` | `Xahau` | `Xahau mainnet` | `Xahau` | `the Xahau DEX` |
| testnet `xrpl` | `XRPL Testnet` | `XRPL Testnet` | `XRPL Testnet` | `the XRPL Testnet DEX` |
| testnet `xahau` | `Xahau Testnet` | `Xahau Testnet` | `Xahau Testnet` | `the Xahau Testnet DEX` |

```ts
export type NetworkBrief = { id: NetworkId; kind: NetworkKind; name: string; label: string; longName: string; dexName: string };
export const NETWORK_NAMES: Record<NetworkKind, Record<NetworkId, Omit<NetworkBrief, "id" | "kind">>>;
/** The two networks of a kind, in the switch's order (xrpl, xahau). */
export function networkChoices(kind: NetworkKind): readonly NetworkBrief[];
export function findNetwork(segment: string | undefined, kind: NetworkKind): NetworkBrief | undefined;
export const DEFAULT_NETWORK_ID: NetworkId = "xrpl";
```

`NETWORK_CHOICES` and `DEFAULT_NETWORK` go; `DEX_NAMES` (`app/server/meta.ts`) goes for `dexName`; `HOME_TITLES` (`HomePage.tsx`)
becomes `` `Explore ${network.longName}` `` ("Explore the XRP Ledger", "Explore Xahau", "Explore XRPL Testnet", "Explore Xahau Testnet").

**The facts** (`app/server/networks.ts`): `NETWORKS` becomes `Record<NetworkKind, Record<NetworkId, NetworkEntry>>`, and `Network` gains
`kind`, `label`, `longName`, `dexName` and `displays`:

| | `native` | `ctidNetworkId` | `hasAmm` | `software` | `displays` |
|---|---|---|---|---|---|
| mainnet `xrpl` | `XRP` | 0 | true | `rippled` | `["native", "usd"]` |
| mainnet `xahau` | `XAH` | 21337 | false | `xahaud` | `["native"]` |
| testnet `xrpl` | `XRP` | 1 | true | `rippled` | `["native"]` |
| testnet `xahau` | `XAH` | 21338 | false | `xahaud` | `["native"]` |

(XRPL Testnet has the AMM amendment, Xahau Testnet does not: D-env section 13. The ids were read from the nodes on 2026-10-24.)
`ctidNetworkId` is typed `0 | 21337 | 1 | 21338`. `other`, `dataApiUrlVar` and `nodeUrlVar` are the same in both kinds. Later
sub-projects add facts of their own to this table, one value per kind and network, beside `hasAmm`: E10 `hasDelegation`, E14 `hasMpt`
(both true on XRPL and XRPL Testnet, false on Xahau and Xahau Testnet).

- `networkOf(id, env)` takes `NETWORKS[networkKindOf(environmentOf(env.ENVIRONMENT))][id]`, with the URLs and `features` as today.
- `networkIdOfCtid(networkId, kind)`: the network of that kind whose `ctidNetworkId` it is, else `undefined`. `resolveCtid` and the
  transaction route pass `net.kind`.
- `isNetworkId` is unchanged: the paths are the same in every environment.
- `PublicNetwork` (`network-route.ts`) carries the new fields to the browser (no URL, as today).
- The file's head comment: "the only place that knows a network's URLs and facts; the names are `app/ui/networks.ts`'s".

## 6. The environment in the browser

Components outside the `/:net` layout's data (the root error page, the not-found route, the switch's other network, `meta` of routes
that do not read the layout) need the kind. The root route gets a loader:

```ts
// app/root.tsx
export function loader({ context }: Route.LoaderArgs) {
  return { environment: environmentOf(getEnv(context).ENVIRONMENT) };
}
export const shouldRevalidate = () => false;
```

It names no cache class (the page's class stands, as for the layout's loader), is never fetched again on a navigation, and adds about 30
bytes to each document. `useEnvironment()` (`app/ui/use-network.ts`) reads `useRouteLoaderData("root")?.environment`, gives
`"development"` where the data is missing (a component test, no router) and never throws, like `useFeatures()`.

Where each name comes from:

| Place | Today | After |
|---|---|---|
| `NetworkSwitch` | `NETWORK_CHOICES` | `networkChoices(networkKindOf(useEnvironment()))` |
| `Header`, `SearchBox`, pages under `/:net` | `net.name` of the layout's network | unchanged: the layout's network is the environment's |
| `metaContext(net, matches)` (`meta.ts`) | `findNetwork(net)` | the `/:net` layout's `network` from `matches` (its loader data already holds the environment's names) |
| route `meta` functions using `findNetwork(params.net)` (`net.network.tsx`, `net.validators.tsx`, `net.validators.$key.tsx`, `net.amendments.tsx`, `net.amendments.$name.tsx`, `net.search.tsx`, `net.tsx`) | static names | `metaContext`'s network, or `findNetwork(params.net, kind)` with the kind from the root match |
| loaders naming the other network (`net.ledger.$id.tsx`, `net.tx.$id.tsx`, `net.search.tsx` `nameOf`; `net.amm.$pool.tsx`, `net.validators.$key.tsx`, `net.amendments.$name.tsx`, `net.account.$address.tsx` `findNetwork(net.other)`) | `findNetwork(id)` | `networkOf(id, env)` (they have `env`) |
| `net.network.tsx` `clientLoader` | `findNetwork(params.net)` for the id | `isNetworkId(params.net)` |
| `root.tsx` `ErrorBoundary`, `net.tsx` `ErrorBoundary`, `not-found.tsx` | `DEFAULT_NETWORK`, `findNetwork(segment)` | `findNetwork(segment ?? DEFAULT_NETWORK_ID, networkKindOf(useEnvironment()))` |
| `root.tsx` `meta` description | "… on the XRP Ledger and Xahau." | "… on XRPL Testnet and Xahau Testnet." in the sandbox, from the root data |

## 7. What the pages say

### 7.1 Names

Every place that reads `network.name` says "XRPL Testnet" or "Xahau Testnet" in the sandbox with no change of its own: breadcrumbs,
`<title>` (`suffixOf`: "XRPL Testnet · explorer"), descriptions, the search box ("Search XRPL Testnet"), the not-found page ("We couldn't
find transaction … on XRPL Testnet."), "Search on Xahau Testnet" offers, the CTID offer. The places that write a network in words of
their own read the new fields:

| Place | Production | Sandbox |
|---|---|---|
| `HomePage.tsx` hero title | `Explore the XRP Ledger` | `Explore XRPL Testnet` |
| `HomePage.tsx` status line (`{network.name} mainnet · ledger …`) | `XRPL mainnet · ledger 107,695,660 validated …` | `XRPL Testnet · ledger 21,795,728 validated …` (`network.label`) |
| `card-data.ts` `labelOf` (the card's pill) | `XRPL mainnet` | `XRPL Testnet` (`network.label`) |
| `AmmListPage.tsx` intro, `meta-amm-list.ts` description | "Automated market maker pools on the XRP Ledger…" | "… on XRPL Testnet…" (`longName` of the XRPL network) |
| `net.amm.$pool.tsx` note (Xahau) | "Xahau has no AMM, so this pool exists only on the XRP Ledger." | "Xahau Testnet has no AMM, so this pool exists only on XRPL Testnet." |
| `markets-view.ts` intro, `meta-markets.ts`, `meta-pair.ts` | "Trades on the XRP Ledger DEX…" | "Trades on the XRPL Testnet DEX…" (`dexName`) |
| `analytics-view.ts` `dexWording` | "Order-book trades only; Xahau has no AMM." | "…; Xahau Testnet has no AMM." |

The plan greps `XRP Ledger`, `mainnet` and the literal `"XRPL"` / `"Xahau"` in `app/` once more and moves each such string to a field.

### 7.2 The badge

`Header.tsx`: right after the brand link, inside the same flex group as on the board, when `networkKindOf(useEnvironment())` is
`"testnet"`:

```tsx
<Pill tone="testnet" icon={null}>Testnet</Pill>
```

`Pill` gains the tone `testnet` (`.pill--testnet`); the badge is in the server-rendered header of every page, the error pages included.
It stays at every width: on a phone the brand's name goes (as today) and the mark, the badge and the switch remain. New tokens in
`tokens.css`, from the board's `.tnet`: light `--testnet-fg: #7A4306`, `--testnet-bg: #FDF0D5`, `--testnet-border: #EBC985`; dark
`#F5C866`, `#33240A`, `#5C4316` (in both dark blocks). Contrast: 7.1:1 light, 9.5:1 dark (WCAG AA for text, pinned in `tokens.test.ts`).
`.pill--testnet` is 11.5 px, weight 600, letter-spacing .02em, padding 2px 8px, radius 999px, as the board. No `title` (decision 4).

### 7.3 Link previews

The card is drawn as today with `networkLabel` "XRPL Testnet" (decision 11); the network's accent is unchanged. `og:site_name` stays
`explorer`. The image route takes its network from `networkOf(segment, env)`, so the card's words and the CTID of a transaction card are
the sandbox's.

### 7.4 Transactions and CTIDs

`transactionPage` computes the CTID from `network.ctidNetworkId`: a sandbox transaction's CTID ends `0001` (XRPL Testnet) or `535A`
(Xahau Testnet). Nothing else on the transaction page changes.

### 7.5 The network page's USD view

`DISPLAYS` (`app/domain/network-params.ts`) goes: `displaysOf`, `parseNetworkParams` and the canonical query read the network's
`displays`. On a testnet `?in=usd` is not a view: the loader's canonical redirect drops it (302, class `short`), and the page offers no
USD control. `USD_ISSUER` stays (production XRPL only). The markets pages' quote filter (`usd`, `eur`, `btc`) narrows by currency code
and stays on both kinds.

### 7.6 The validators pages and Xahau Testnet's fixed list

D-env gives Xahau Testnet one publisher, `local` (its fixed `[validators]` list), with an empty `url` and no `expiration`. A helper
`publisherLabel(id)` (`app/server/validator-facts.ts`) is `"Fixed list"` for `local` and the id otherwise; every place that shows a
publisher's id uses it: the "Listed by" select (`validators-view.ts`), the membership line of a validator (`validator-view.ts`),
`meta-validator.ts` and the validator's card. The UNL tile's sub-line reads "seen in 24 h, of those on the fixed list" where `local` is
the only list. `noticesOf` gives `local` no notice (a fixed list is never expired or unavailable). The list's
intro (`validators-view.ts` line 414) becomes, per kind:

- mainnet (unchanged): "The default UNL is the list of validators rippled trusts out of the box, published by vl.ripple.com and
  unl.xrplf.org. …"
- testnet: "The default UNL is the list of validators the nodes of XRPL Testnet trust, published by vl.altnet.rippletest.net. …"; with
  only the fixed list: "The default UNL is the list of validators the nodes of Xahau Testnet trust, fixed in their configuration. …"

These pages are behind `VALIDATORS`, off in the sandbox until it is turned on there (section 9).

### 7.7 Search

`resolveCtid` reads the kind: in the sandbox a CTID ending `0001` resolves on `/xrpl`, `535A` on `/xahau`; `0000` and `5359` (the
mainnets) are "not covered" and get today's sentence (decision 7). In production `0001` and `535A` are the ones not covered. Hashes,
addresses and ledger indexes search as today, against the environment's data APIs.

### 7.8 States

No new state. The not-found page, the error screens, the "soon" header items and the coverage notices of later sub-projects read the
environment's names. A 404 for an unknown network (`/xrp/…`) keeps its words and shows the badge in the sandbox.

## 8. Robots, caches and Sentry

- **Robots.** `workers/app.ts` wraps the response of `withEdgeCache` with `withEnvironmentHeaders(response, env)`
  (`app/server/environment.ts`, new): in the sandbox it sets `X-Robots-Tag: noindex` on every response (pages, `.data`, images, CSVs,
  `robots.txt`, redirects, errors), copying the response when its headers are immutable (one that came from the Cache API). It sits
  outside the edge cache, so a stored copy gets it too, and nothing stored differs between the environments. In production and
  development it changes nothing (the images and CSVs keep their own `noindex`). `robots.txt` is the same everywhere.
- **The cache generation.** `cacheGeneration(env)` becomes `` `${BUILD_ID}:${ENVIRONMENT}:${switches}` ``
  (`3f2a9c1:sandbox:ACCOUNT_ANALYTICS=off,…`). The deployed environments are already apart (the edge key holds the host), but the
  environment changes what a page says, like a switch, so a local Worker whose `.dev.vars` moves between environments never serves the
  other's pages. The two tests that spell the generation out (`features-off.spec.ts`, `env.test.ts`) change.
- **The subrequest cache.** Both Workers are on the `gatehub.net` zone and may share its Cache API. The subrequest key already holds the
  upstream URL (`GET ${base}${url}`, `POST ${net.nodeUrl} …`), and the guard makes every upstream differ between the environments
  (section 4), so a testnet answer is never read in production. `test/worker/edge-cache.spec.ts` pins it: the same call under the sandbox's
  and production's URLs has two keys.
- **Sentry.** `withSentry` gets `environment: e.ENVIRONMENT` beside `dsn` and `release`, so the sandbox's events are told apart.

## 9. Switches in the sandbox

Every switch is a var of each block, as today. In the sandbox:

| Switch | Value at E7 | Goes "on" when (on the sandbox's data API, by a commit and `pnpm deploy:sandbox`) |
|---|---|---|
| `VALIDATORS` | off | D1 has served the sandbox on both testnets for two hours (the votes and tallies of the testnets back-filled) |
| `AMM_DATA` | off | the sandbox's data API has the AMM data from its first ledger (it is built from images that include it) and D2b's gauge `syncer_markets_live_amm_share_known` is 1 |
| `MARKETS` | off | `/v2/network/markets` answers and D2 §16.4's gauges are at their marks |
| `ACCOUNT_ANALYTICS` | off | `syncer_rates_daily_missing_days` and `syncer_account_rollups_pending_accounts` are 0 |
| `AMM_PAGES` | off | `AMM_DATA` is on there |

The program-2 switches (`NFTS`, `NAMES`, `LEDGER_OBJECTS`, `DELEGATION`, `TOKENS`, `SUPPLY`, `VALIDATORS_MAP`, `MPT`) are added by their
own sub-projects, "off" in the sandbox and production. README's conditions lose their mainnet-only words where they apply to the sandbox
("re-ingested from ledger 86795265" is production's condition). **A condition that asks for complete coverage** (`DELEGATION`'s and
`SUPPLY`'s) does not apply in the sandbox: the sandbox's data API indexes from its first boot and its coverage is never complete
(D-env §12), so there such a switch goes on once the sandbox's data API serves the feature on both testnets, and the pages show their
coverage notes (decision 15).

## 10. The node calls on testnets

The node client is unchanged. What it calls answers on the sandbox's nodes (checked 2026-10-24): `clio.altnet.rippletest.net` is Clio
2.8.0 with `network_id` 1 and the whole testnet history (ledgers 209–21796150), and answers `server_state`, `account_info`,
`book_offers` (`srcIsrMalformed` for a bad issuer), `amm_info` (`actMalformed`) and `nft_info` (`objectNotFound` for an unknown id);
`xahau-test.net` answers `server_info` (21338). The Clio drops connections after a few quick requests; the failure hold (E2) covers
those seconds, and GateHub replaces it with its own Clio when it has one.

**Clio for XRPL, everywhere.** E8's NFT pages ask the XRPL node for `nft_info`, which only a Clio serves (a rippled answers
`unknownCmd`: `s.altnet.rippletest.net`, `testnet.xrpl-labs.com` and `xrplcluster.com` did). The XRPL node of the sandbox and of
production must therefore be a Clio: `s1.ripple.com` and `s2.ripple.com` are (Clio 2.8.0, 2026-10-24); a GateHub node that replaces one
must be too. No Clio serves Xahau (`xahau.network` and `xahau-test.net` run xahaud), so that fallback does not exist on either Xahau
network. README's "The data API and the node" says this; the checklists check it (section 14).

## 11. A testnet reset

A reset restarts the testnet's ledger indexes under other hashes (D-env section 11: the data API's syncer halts, and its operator drops
and recreates the database). The sandbox's caches still hold the old chain: a ledger page, a transaction and their subrequests are
stored for up to a year (`immutable`). The runbook (README, "The sandbox"): once the data API serves the new chain, deploy the sandbox
with a new build id, `BUILD_ID=$(git rev-parse --short=12 HEAD)-reset<n> pnpm deploy:sandbox` (`resolveBuildId` takes `BUILD_ID` from
the environment). The edge and subrequest keys both start with the build id, so nothing of the old chain is read again; the old entries
expire by themselves.

## 12. Tests

**Unit** (`unit`, Node):

- `app/ui/environment.test.ts`: `environmentOf` (the three values; `undefined`, `""`, `"staging"` and `"Sandbox"` are development);
  `networkKindOf`.
- `app/ui/networks.test.ts` (new): the names table; `networkChoices` order; `findNetwork` per kind; unknown segment.
- `app/server/networks.test.ts`: `networkOf` per environment (the facts table of section 5, each cell); `networkIdOfCtid(1, "testnet")`
  is `xrpl`, `(0, "testnet")` undefined, `(21338, "mainnet")` undefined; every `ctidNetworkId` unique within a kind.
- `app/server/env.test.ts`: the generation with `ENVIRONMENT`.
- `app/server/card-data.test.ts`: the pill says `XRPL Testnet` for a testnet network.
- `app/server/meta.test.ts`: titles and descriptions of a testnet network ("· XRPL Testnet ledger N", "XRPL Testnet · explorer").
- `app/domain/network-params.test.ts`: `in=usd` is dropped for `displays: ["native"]`.
- `app/server/validators-view.test.ts`, `validator-view.test.ts`: `local` is "Fixed list"; the testnet intro with a publisher and with
  only the fixed list; no notice for `local`.
- `app/server/search-view.test.ts` and `resolve` tests: the CTIDs of section 7.7.
- `scripts/predeploy-check.test.ts`: every case renamed; new cases for each rule of section 4 (`ENVIRONMENT` missing and wrong; a data API
  URL of the other environment; a path after the host; `XRPL_NODE_URL` of mainnet in the sandbox and of the testnet in production;
  `XAHAU_NODE_URL` on an XRPL host; no route, a route to the other host, `custom_domain` missing); `good(env)` builds the environment's
  exact values; an unknown node host passes.
- `test/unit/no-staging.test.ts` (section 2).
- `test/unit/tokens.test.ts`: the three testnet tokens in light and both dark blocks, and their contrast.

**Components** (happy-dom): `Header` shows the badge under a root data of `"sandbox"`, not under `"production"`, `"development"` or none;
`NetworkSwitch` names the testnets in the sandbox; `Pill` `testnet`.

**Workers runtime.** A third Workers project, `worker-sandbox` in `vitest.config.ts`: the bindings of `worker` with
`ENVIRONMENT: "sandbox"` (the switches as the top level's, so every page can be drawn), running `test/worker/**/*-sandbox.spec.ts`,
which `worker` and `worker-off` leave out. The existing fixtures stand in for testnet data. `test/worker/environment-sandbox.spec.ts`:

- `/xrpl`: the badge in the header; the switch reads "XRPL Testnet" and "Xahau Testnet"; `<title>` "XRPL Testnet · explorer"; "Explore
  XRPL Testnet"; the status line "XRPL Testnet · ledger …".
- `X-Robots-Tag: noindex` on a page, its `.data`, `robots.txt`, an image, a 404, a redirect, and on a second request served from the edge
  cache (`X-Cache: HIT`).
- `/xrpl/tx/{hash}`: breadcrumb "XRPL Testnet", the CTID ends `0001`; `/xahau/tx/{hash}` ends `535A`; the tags' description ends
  "· XRPL Testnet ledger N".
- `/xrpl/search?q=<CTID …0000>`: "… is for network id 0, which this explorer does not cover."; a CTID `…0001` redirects to its transaction.
- `/xrpl/network?in=usd` is a 302 to `/xrpl/network`.
- `/og/xrpl/tx/{hash}.png` renders (its card data's pill is "XRPL Testnet", checked through the card builder).
- An unknown network `/xrp` and the root error page show the badge.

`worker` (development) adds the reverse: no badge, no `X-Robots-Tag` on a page. `test/worker/edge-cache.spec.ts`: the subrequest keys of
section 8.

**End to end.** No new spec and no new project: the suite runs the top level (development, mainnet facts) as today, and its a11y scans
do not see the badge, whose contrast `tokens.test.ts` pins. `E2E_BASE_URL` keeps working against any deployed Worker; README says it is
meant for production (section 14).

**Fixtures.** None new; `pnpm fixtures:check` is unchanged.

## 13. Bundle budget

The client gains the names table (about 0.3 KB), `useEnvironment`, the `testnet` tone's CSS and the root loader's data (inline, about 30
bytes). Every page stays under its budget (150,000 bytes for the lookup pages, 160,000 for the dashboards, with the manifest: ruling R19);
`pnpm check:bundle` on the E7 commit writes the figures beside "The client bundle check".

## 14. README

- **Getting started**: the top level's placeholders are on purpose; developing against the sandbox (`.dev.vars` with its four URLs,
  `ENVIRONMENT=sandbox`, its key).
- **Scripts**: `pnpm deploy:sandbox`, `pnpm deploy:production`.
- **Configuration**: an `ENVIRONMENT` row; the URLs per environment (section 1's table); `DATA_API_KEY` on `x-explorer-sandbox` and
  `x-explorer-production`.
- **Switches**: the values table's `staging` column becomes `sandbox`; the conditions say "the environment's data API"; "Adding a switch"
  step 3 names `sandbox`.
- **The data API and the node**: `networks.ts`' row (facts per kind; names in `app/ui/networks.ts`); "the XRPL node must be a Clio"
  (section 10).
- **SEO and link previews**: the sandbox's `X-Robots-Tag`; the pill.
- **Tests**: the `worker-sandbox` project and its file names.
- **End-to-end tests**: `E2E_BASE_URL` and `E2E_DATA_API_URL` are for production (the fixtures are mainnet data).
- **The pipeline and deploying**: the rename; "Hosts and routes" with the real hosts and routes (no longer "when they are named"); the
  guard's new rules; secrets per environment; a new "The sandbox" paragraph (what it is for, the reset runbook of section 11).
- **The checklists.** "Staging checklist" is replaced by three lists. Each item of today keeps its text, with "staging" made "sandbox"
  or "production"; where it goes:

| Today's item | Goes to |
|---|---|
| Hosts and routes; secrets | both checklists (each environment's) |
| The Cache API accepts the key host; the failure hold (both items); a switch flip is a miss at the edge; the node's call rate with pair pages open; the markets page's age; the validators pages' failure hold; one L request per 10 s; in-flight sharing and the failure hold (analytics); the AMM switch in the cache generation; the list's pages (AMM) | sandbox checklist |
| A page answered 503, not stored, against an API without D1 | sandbox checklist, with a local Worker against a stack without D1 (the sandbox's API has D1) |
| The network page's views; the validations of the newest ledger; the validators and amendments pages | both: the sandbox for the structure (on the testnets' own data, no `?in=usd`, the counts of the testnets' lists), production for the specs against its stack |
| IPv6 visitors; the edge cache filled through query strings | production checks (they need real traffic) |
| Run the end-to-end suite; the markets pages' node calls (RLUSD, EVR); the HTML weight of `/xrpl/markets?period=30d`; the AMM parts after `AMM_DATA` is on; the size of a majority amendment's page; the heavy account's four periods; the late counterparties; `robots.txt`; every AMM pool item (state against the node, 90-day chart, deleted pool, pair redirect, pool image) | production checks |
| `actNotFound` and `actMalformed` from the configured node | both (each environment's node) |
| Every bundle figure item | build figures (any environment: the commit being deployed) |

New items: in the **sandbox checklist**, the certificate of `explorer.sandbox.gatehub.net` (a second-level name); the badge, the names
and a CTID of each testnet on a page of each kind; `curl -sI https://explorer.sandbox.gatehub.net/xrpl | grep -i x-robots-tag`;
`nft_info` from the sandbox's XRPL node answers `objectNotFound` for an unknown id, not `unknownCmd`; Sentry's events carry
`environment: sandbox`. In the **production checks**, the same `nft_info` check on production's XRPL node. Production checks run
before a switch goes on in production: against the deployed production Worker (`E2E_BASE_URL=https://explorer.gatehub.net
E2E_WORKERS=1 E2E_FEATURES_OFF=…`) and, for what the switch gates, a local Worker on the production stack
(`E2E_DATA_API_URL=https://{net}.data.gatehub.net E2E_NODE_URL=… E2E_DATA_API_KEY=… pnpm test:e2e`, the top level's switches on).

## 15. Rollout

1. D-env is deployed: the sandbox's data API serves both testnets on `xrpl.data.sandbox.gatehub.net` and `xahau.data.sandbox.gatehub.net`,
   with the sandbox explorer's key in its `GH_API_KEYS` and `GH_RATE_LIMIT_KEYS`.
2. E7 is merged. The owner sets `wrangler secret put DATA_API_KEY --env sandbox` (and `SENTRY_DSN`, optional), runs `pnpm deploy:sandbox`
   (the guard passes) and goes through the sandbox checklist.
3. The switches go on in the sandbox one by one, by their conditions (section 9).
4. Production: once its data API answers on `xrpl.data.gatehub.net` and `xahau.data.gatehub.net`, `wrangler secret put DATA_API_KEY --env
   production`, `pnpm deploy:production` with every switch off, the production checks; the release workflow deploys only once the owner
   sets `CLOUDFLARE_DEPLOY` to `true`.

## 16. Dependencies

- **D-env** (data API): the testnet profiles, the sandbox hosts, CTID ids 1 and 21338, the `local` publisher of Xahau Testnet, the empty
  testnet markets (no USD), and its reset runbook. E7 can be built and tested before D-env is deployed (the tests use fixtures); its
  sandbox deploy waits for D-env's.
- **E8** relies on section 10: Clio as the XRPL node in both environments, no `nft_info` on Xahau.
- **Every program-2 explorer spec** adds its switch "off" to the `sandbox` block, reads network names from the layout's network (never a
  literal "XRPL"), and adds a `*-sandbox.spec.ts` case only where its page says something per kind.
