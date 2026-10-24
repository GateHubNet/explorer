# Sandbox Environment (E7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Worker codebase serves production (`explorer.gatehub.net`, XRPL and Xahau mainnet) and the sandbox (`explorer.sandbox.gatehub.net`, XRPL Testnet and Xahau Testnet), each from its own Worker, custom domain, data APIs and nodes; in the sandbox every network name is the testnet's, the header says "Testnet", the CTIDs carry the testnets' ids and nothing is indexed; "staging" is renamed "sandbox" everywhere outside the history.

**Architecture:** One Worker variable, `ENVIRONMENT` (`"development"` at the top level, `"sandbox"`, `"production"`), decides the kind of network shown: a pure `app/ui/environment.ts` maps it, the root route's loader hands it to the browser, and the facts of a network (`app/server/networks.ts`) and its names (`app/ui/networks.ts`) become tables by kind. Pages keep reading the layout's network, so most of them change nothing; the few that write a network in words of their own read the new fields. The pre-deploy guard learns each deployed environment's host, data APIs, node kind and route; a response wrapper adds `X-Robots-Tag: noindex` in the sandbox outside the edge cache; the cache generation names the environment. A third Workers test project, `worker-sandbox`, draws the pages with `ENVIRONMENT: "sandbox"` over the existing (mainnet) fixtures.

**Tech Stack:** React Router 8.4 (framework mode) on Cloudflare Workers, React 19, TypeScript, Vitest (`unit`, `components` with happy-dom, `worker`, `worker-off`, and the new `worker-sandbox` in workerd), Playwright with axe, wrangler 4 (`unstable_readConfig`), `@sentry/cloudflare`.

**Spec:** `docs/superpowers/specs/2026-10-24-sandbox-environment-design.md` (cited "§n", its decisions "D<n>"; the plan argues from the spec, executors read both). The data API's side is data-api `docs/superpowers/specs/2026-10-24-testnet-profiles-design.md` (D-env); its plan is `docs/superpowers/plans/2026-10-24-testnet-profiles.md` there.

**Branch:** `feat/explorer-pages-2` in `/Users/golobitch/github.com/GateHubNet/x-explorer-worktrees/explorer-pages-2`. E7 is the first sub-project of the explorer track. It adds no data API call and syncs nothing (`api/openapi.yaml` and `app/server/openapi.d.ts` are unchanged; D-env adds no route); it can be built and tested before D-env is deployed (§16). E8 (NFTs) follows on this branch and relies on this plan's names (section "Interfaces later plans use", at the end).

## Global Constraints

- Install once, in Task 1: `pnpm install --frozen-lockfile` (its postinstall runs `wrangler types`); `pnpm exec playwright install chromium` if the end-to-end suite needs it.
- Before every commit `pnpm verify` exits 0 (api:check, typecheck, test with every project, build, check:bundle) and `pnpm fixtures:check` still passes (no fixture changes in this plan). Tasks 4 to 10 also run `pnpm test:e2e`: the suite runs the top level, development, whose pages must not change.
- Commits: Conventional Commits with the repo's scopes (`refactor(sandbox): …`, `feat(sandbox): …`, `ci(sandbox): …`, `test(sandbox): …`, `docs(sandbox): …`), a body that says why, and the last line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--amend`, never `git add -A` or `git add .` (name the files), never touch `.claude/`. Delete nothing you did not create.
- The three environments, exactly (§1):

  | | top level | `sandbox` | `production` |
  |---|---|---|---|
  | Worker `name` | `x-explorer` | `x-explorer-sandbox` | `x-explorer-production` |
  | route (custom domain) | none | `explorer.sandbox.gatehub.net` | `explorer.gatehub.net` |
  | `ENVIRONMENT` | `"development"` | `"sandbox"` | `"production"` |
  | `XRPL_DATA_API_URL` | `https://xrpl.data.example.invalid` | `https://xrpl.data.sandbox.gatehub.net` | `https://xrpl.data.gatehub.net` |
  | `XAHAU_DATA_API_URL` | `https://xahau.data.example.invalid` | `https://xahau.data.sandbox.gatehub.net` | `https://xahau.data.gatehub.net` |
  | `XRPL_NODE_URL` | `https://s1.ripple.com:51234/` | `https://clio.altnet.rippletest.net:51234/` | `https://s1.ripple.com:51234/` |
  | `XAHAU_NODE_URL` | `https://xahau.network/` | `https://xahau-test.net/` | `https://xahau.network/` |
  | `VISITOR_LIMITER` namespace | `1000` | `1001` | `1002` |

  Every block lists `ENVIRONMENT` and the five switches (`vars` are not inherited); the switches stay "on" at the top level and "off" in `sandbox` and `production` (D3). The XRPL node of a deployed environment must be a Clio (D9).
- The names, exactly (§5): mainnet `xrpl` `XRPL` / `XRPL mainnet` / `the XRP Ledger` / `the XRP Ledger DEX`; mainnet `xahau` `Xahau` / `Xahau mainnet` / `Xahau` / `the Xahau DEX`; testnet `xrpl` `XRPL Testnet` / `XRPL Testnet` / `XRPL Testnet` / `the XRPL Testnet DEX`; testnet `xahau` `Xahau Testnet` / `Xahau Testnet` / `Xahau Testnet` / `the Xahau Testnet DEX` (`name` / `label` / `longName` / `dexName`).
- The facts, exactly (§5): mainnet `xrpl` `XRP`, CTID 0, AMM, `rippled`, displays `["native", "usd"]`; mainnet `xahau` `XAH`, 21337, no AMM, `xahaud`, `["native"]`; testnet `xrpl` `XRP`, 1, AMM, `rippled`, `["native"]`; testnet `xahau` `XAH`, 21338, no AMM, `xahaud`, `["native"]`. `other`, `dataApiUrlVar`, `nodeUrlVar` are the same in both kinds; the paths stay `/xrpl` and `/xahau`.
- Amounts keep their codes `XRP` and `XAH` (D5). No URL of one environment appears in the other's pages, and no link between them (D7).
- No page text writes a network as a literal (`"XRPL"`, `"Xahau"`, "the XRP Ledger", "mainnet"): it reads `name`, `label`, `longName` or `dexName` of the page's network, or the names table by kind. The top level (development) shows the mainnet names, so every existing test of a mainnet word stays.
- `app/ui/environment.ts` imports nothing; `app/ui/networks.ts` imports types only. Browser files import nothing of `app/server` as values (the bundle tests of `test/unit/*-bundle.test.ts`).
- After Task 1, the word "staging" appears nowhere in `app/`, `workers/`, `scripts/`, `test/` (but `test/fixtures/`), `.github/`, `README.md`, `wrangler.jsonc`, `package.json`, `playwright.config.ts`, `vitest.config.ts`, `vite.config.ts` (D14); a test that must name it builds it from halves (`"stag" + "ing"`). `GLOSSARY.md`, `docs/` and the git history keep their words.
- Budgets (ruling R19): every page under 150,000 bytes gzip (lookup pages) or 160,000 (dashboards), with the manifest; `pnpm check:bundle`.

## Review Focus

1. **Xahau Testnet's fixed list in the validators answers.** D-env's publisher `local` has `url: ""`, `public_key: ""` and no `expiration`; today's shape check refuses an empty `url`, so every validators page and the network page's validators card would be a 503 in the sandbox. It must pass the check, read "Fixed list", and get no notice. Pinned by Task 9 `validators-shape.test.ts` ("accepts the fixed list local, with an empty url and public_key") and `validators-view.test.ts` ("gives local no notice").
2. **A deploy wired to the other environment.** A production build with a testnet node or a sandbox data API, a sandbox build with a mainnet node, a node of the wrong network, a missing or wrong `ENVIRONMENT`, a route to the other host: each must be refused, every reason printed. Pinned by Task 2's `predeploy-check.test.ts` cases and `wrangler.jsonc`'s blocks passing the guard.
3. **`noindex` on everything the sandbox serves, and only there.** A copy from the edge cache (headers immutable), a redirect, a 404, an image, `robots.txt` and a `.data` URL must carry `X-Robots-Tag: noindex` in the sandbox; development and production pages must not gain it. Pinned by Task 10 (`withEnvironmentHeaders` copies an immutable response; the sandbox spec's `X-Cache: HIT` case; `layout.spec.ts` "no X-Robots-Tag on a page").
4. **CTIDs across environments.** In the sandbox a CTID ending `0001` resolves on `/xrpl`, `535A` on `/xahau`, and `0000`/`5359` are "not covered"; in production and development the reverse; the transaction page shows `…0001`/`…535A`. Pinned by Task 4 (`networkIdOfCtid` table, the sandbox spec's search and transaction cases, `search.spec.ts` "a CTID of XRPL Testnet is not covered").
5. **Pages with no network data of their own.** An unknown network (`/xrp`), the not-found page and the root error page have no `/:net` data: in the sandbox they must still name the testnets in the switch and show the badge, and `useEnvironment()` without root data must give `"development"` without throwing. Pinned by Task 3 (`useEnvironment` cases), Task 5 (the sandbox spec's `/xrp` case) and Task 7 (the badge on `/xrp` and on the root error boundary).

---

### Task 1: "staging" becomes "sandbox"

**Files:**
- Modify: `wrangler.jsonc` (the `staging` block becomes `sandbox`, `x-explorer-staging` becomes `x-explorer-sandbox`; its values stay until Task 2; the head comment's words), `package.json` (`"deploy:sandbox": "CLOUDFLARE_ENV=sandbox react-router build && tsx scripts/predeploy-check.ts sandbox && wrangler deploy"` in place of `deploy:staging`), `scripts/predeploy-guard.ts` (`ENVIRONMENTS = ["sandbox", "production"] as const`; head comment), `scripts/predeploy-check.ts` (usage `predeploy-check <sandbox|production> [project root]`; comment), `scripts/predeploy-check.test.ts` (`good("sandbox")` and every other case), `scripts/build-id.ts` (comment: `deploy:sandbox`), `scripts/e2e-env.ts` (comments: "the sandbox's" stack, "a run against the sandbox or production"), `playwright.config.ts` (comment: `E2E_BASE_URL` tests "a deployed Worker"), `test/e2e/stack.ts` (comment: what `pnpm deploy:sandbox` leaves behind), `test/e2e/validators.spec.ts` (comment: "a sandbox or production that has the switch off"), `test/worker/meta.spec.ts` (`https://sandbox.explorer.example` in the origin test), `app/server/edge-cache.ts` (comment: "Assumption to confirm on the sandbox"), `README.md` (each of its 59 places: "sandbox" where it names the environment or its commands, the checklist titled "Sandbox checklist" for now; Task 11 splits it)
- Create: `test/unit/no-staging.test.ts`

**Interfaces:**
- Produces: the environment name `sandbox` in `ENVIRONMENTS`, `wrangler.jsonc` and `package.json` (every later plan adds its switch "off" to the `sandbox` block); `test/unit/no-staging.test.ts` (later plans must keep it green).

- [ ] **Step 1: Install.** `pnpm install --frozen-lockfile`.
- [ ] **Step 2: Write the failing test.**
  ```ts
  // test/unit/no-staging.test.ts
  const WORD = new RegExp(`\\b${"stag"}${"ing"}\\b`, "i");   // two halves: the file does not find itself
  const PLACES = ["app", "workers", "scripts", "test", ".github", "README.md", "wrangler.jsonc", "package.json",
    "playwright.config.ts", "vitest.config.ts", "vite.config.ts"];                // directories walked; test/fixtures and node_modules skipped
  it("finds the word where it is", () => expect(hits("a\nb " + "stag" + "ing c\n")).toEqual([2]));
  it("is not in the code, the scripts, the tests or the README", () => expect(allHits()).toEqual([]));   // ["README.md:12", …] on failure
  ```
- [ ] **Step 3: Run it to verify it fails.** `pnpm test test/unit/no-staging` → FAIL listing `wrangler.jsonc`, `package.json`, `README.md`, `scripts/…`, `test/…`, `app/server/edge-cache.ts`.
- [ ] **Step 4: Rename** in every file of the list.
- [ ] **Step 5: Run the tests to verify they pass.** `pnpm test test/unit/no-staging scripts/predeploy-check` → PASS; `pnpm verify` → exit 0.
- [ ] **Step 6: Commit.**
  ```bash
  git add wrangler.jsonc package.json scripts/predeploy-guard.ts scripts/predeploy-check.ts scripts/predeploy-check.test.ts scripts/build-id.ts \
    scripts/e2e-env.ts playwright.config.ts test/e2e/stack.ts test/e2e/validators.spec.ts test/worker/meta.spec.ts app/server/edge-cache.ts \
    README.md test/unit/no-staging.test.ts
  git commit -F- <<'EOF'
  refactor(sandbox): the staging environment is the sandbox

  The glossary's word for the deployed test environment is "sandbox"; a test keeps the old word out of
  the code, the scripts, the tests and the README, so the rename stays complete (D14).

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```

---

### Task 2: The deployed blocks, and the guard that holds them

**Files:**
- Modify: `wrangler.jsonc` (the three blocks of the Global Constraints' table: `ENVIRONMENT`, the real hosts, the node URLs, `"routes": [{ "pattern": <host>, "custom_domain": true }]` in `sandbox` and `production`; the head comment says what each block is and loses "until the hosts are decided" and "They have no routes yet", §3), `app/server/env.ts` (`ENVIRONMENT: "development" | "sandbox" | "production"` in `Env`), `vitest.config.ts` (`ENVIRONMENT: "development"` in `testBindings`), every hand-built `Env` of the tests (`ENVIRONMENT: "development"`), `scripts/predeploy-guard.ts`, `scripts/predeploy-check.test.ts`, `.github/workflows/release.yml` (the comment of step 3: the guard passes once the secrets are set; the deploy stays behind `CLOUDFLARE_DEPLOY`, D10), `README.md` ("The pipeline and deploying": the guard's rules below, "Hosts and routes" with the real hosts and routes, and the summary line)

**Interfaces:**
- Consumes: Task 1's environment names.
- Produces, `scripts/predeploy-guard.ts`:
  ```ts
  /** What each deployed environment must be: its host, its data APIs and the kind of network it shows. */
  export const DEPLOYED = {
    sandbox: { host: "explorer.sandbox.gatehub.net", kind: "testnet",
      dataApi: { XRPL_DATA_API_URL: "https://xrpl.data.sandbox.gatehub.net", XAHAU_DATA_API_URL: "https://xahau.data.sandbox.gatehub.net" } },
    production: { host: "explorer.gatehub.net", kind: "mainnet",
      dataApi: { XRPL_DATA_API_URL: "https://xrpl.data.gatehub.net", XAHAU_DATA_API_URL: "https://xahau.data.gatehub.net" } },
  } as const;
  /** The public nodes the guard knows, by host: s1.ripple.com, s2.ripple.com, xrplcluster.com, xrpl.ws (XRPL mainnet); xahau.network (Xahau
   *  mainnet); clio.altnet.rippletest.net, s.altnet.rippletest.net, testnet.xrpl-labs.com (XRPL Testnet); xahau-test.net (Xahau Testnet). */
  export const KNOWN_NODES: Readonly<Record<string, { network: "xrpl" | "xahau"; kind: "mainnet" | "testnet" }>>;
  /** `routes` defaults to config.routes; Step 1 decides whether checkBuild passes wrangler.jsonc's own (see there). */
  export function deployProblems(config: unknown, asked: unknown, routes?: unknown): string[];
  ```
  The new rules, for an environment that is known, each with every reason printed, each after today's rules (§4):
  - `ENVIRONMENT`: missing → `ENVIRONMENT is not set. Put "<env>" in env.<env>.vars of wrangler.jsonc.`; another value → `ENVIRONMENT is "<value>", but the build is for <env>. Put "<env>" in env.<env>.vars of wrangler.jsonc.` (the value through `quoted`).
  - Each data API URL, when today's URL rule found nothing (Ruling 11): `new URL(v).origin` equal to `DEPLOYED[env].dataApi[name]` and a path of `""` or `/`, else `<NAME> is "<value>", but the <env> data API of <XRPL|Xahau> is <url>. Put it in env.<env>.vars of wrangler.jsonc.`
  - Each node URL on a host of `KNOWN_NODES`, when today's rule found nothing: of the variable's own network, else `<NAME> names <host>, a node of <its label>, not of <XRPL|Xahau>. Put a node of <wanted label> in env.<env>.vars of wrangler.jsonc.`; else of the environment's kind, else `<NAME> names <host>, a node of <its label>, but <the sandbox|production> shows <wanted label>. Put a node of <wanted label> in env.<env>.vars of wrangler.jsonc.` Labels: `XRPL mainnet`, `Xahau mainnet`, `XRPL Testnet`, `Xahau Testnet`. A host not in the table (GateHub's own node) passes.
  - `routes` exactly `[{ "pattern": <host>, "custom_domain": true }]`: none → `the build has no route for <host>: add "routes": [{ "pattern": "<host>", "custom_domain": true }] to env.<env> of wrangler.jsonc`; a route to another pattern → `the build has a route to <pattern>, which is not <host>: <the same add instruction>`; the host without `custom_domain: true` → `the route to <host> is not a custom domain: <the same add instruction>`.
  - The summary: `<build file> is the Worker <name> for <env> (<XRPL Testnet and Xahau Testnet | XRPL and Xahau>) on <host>; its upstreams are <the sandbox's | production's>, every switch is on or off, and it is not served from workers.dev`.

- [ ] **Step 1: Find where the route lives in a build.** `CLOUDFLARE_ENV=sandbox pnpm build`, then `node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync("build/server/wrangler.json", "utf8")).routes))'`, and `pnpm exec wrangler deploy --dry-run` (no deploy happens). If the routes are in the built file, `checkBuild` passes nothing and `deployProblems` reads `config.routes`. If the Vite plugin leaves them out, `checkBuild` passes `unstable_readConfig({ config: join(root, "wrangler.jsonc"), env: asked }).routes` as `routes`, and README's guard paragraph says so (§4). Write which in the task report.
- [ ] **Step 2: Write the failing tests.**
  ```ts
  // predeploy-check.test.ts. good(env) builds the environment's exact values: name x-explorer-<env>, targetEnvironment, workers_dev and
  // preview_urls false, routes [{ pattern: DEPLOYED[env].host, custom_domain: true }], vars ENVIRONMENT, DEPLOYED[env].dataApi, the node
  // URLs of the Global Constraints' table, every switch "off", BUILD_ID.
  it("passes the config of each deployed environment", () => { expect(deployProblems(good("sandbox"), "sandbox")).toEqual([]); … });
  it.each([[undefined, 'ENVIRONMENT is not set. Put "sandbox" in env.sandbox.vars of wrangler.jsonc.'],
           ["production", 'ENVIRONMENT is "production", but the build is for sandbox. Put "sandbox" in env.sandbox.vars of wrangler.jsonc.']])(…);
  it("refuses the data API of the other environment, and one with a path", …);
  //   sandbox with XRPL_DATA_API_URL https://xrpl.data.gatehub.net → 'XRPL_DATA_API_URL is "https://xrpl.data.gatehub.net", but the sandbox
  //   data API of XRPL is https://xrpl.data.sandbox.gatehub.net. Put it in env.sandbox.vars of wrangler.jsonc.'; …/v2 refused; a trailing / passes
  it("refuses a node of the other kind, both ways", …);
  //   sandbox XRPL_NODE_URL https://s1.ripple.com:51234/ → 'XRPL_NODE_URL names s1.ripple.com, a node of XRPL mainnet, but the sandbox shows
  //   XRPL Testnet. Put a node of XRPL Testnet in env.sandbox.vars of wrangler.jsonc.'; production with https://clio.altnet.rippletest.net:51234/ →
  //   '…, a node of XRPL Testnet, but production shows XRPL mainnet. …'
  it("refuses a node of the other network", …);
  //   sandbox XAHAU_NODE_URL https://clio.altnet.rippletest.net:51234/ → 'XAHAU_NODE_URL names clio.altnet.rippletest.net, a node of XRPL
  //   Testnet, not of Xahau. Put a node of Xahau Testnet in env.sandbox.vars of wrangler.jsonc.'
  it("lets a node it does not know pass", …);           // https://node.gatehub.example/ in either variable
  it("refuses no route, a route to the other host, and a route that is not a custom domain", …);   // the three texts above
  it("keeps one reason for a placeholder or a plain-http URL", …);   // the existing single-reason cases still have length 1
  it("says what it checked", …);                        // checkBuild's summary for sandbox and for production, exactly
  // "the deploy scripts and wrangler.jsonc": both blocks of wrangler.jsonc pass the guard as unstable_readConfig reads them
  //   (deployProblems(config, env) is []); the top level has ENVIRONMENT "development", no routes and the .invalid data API hosts
  ```
- [ ] **Step 3: Run them to verify they fail.** `pnpm test scripts/predeploy-check` → FAIL (no `DEPLOYED`; the new rules pass everything).
- [ ] **Step 4: Implement** the table, the rules, the summary, the blocks, `Env.ENVIRONMENT`, the binding, the comment and the README paragraphs.
- [ ] **Step 5: Run the tests to verify they pass.** `pnpm test scripts/predeploy-check test/unit/no-staging`, then `pnpm verify` → exit 0. `CLOUDFLARE_ENV=sandbox pnpm build && pnpm exec tsx scripts/predeploy-check.ts sandbox` prints the summary and exits 0 (the same for production); never run `wrangler deploy`.
- [ ] **Step 6: Commit.**
  ```bash
  git add wrangler.jsonc app/server/env.ts vitest.config.ts scripts/predeploy-guard.ts scripts/predeploy-check.test.ts .github/workflows/release.yml README.md
  git add <each test file whose hand-built Env gained ENVIRONMENT, by name, as `git status --short` lists them>
  git commit -F- <<'EOF'
  ci(sandbox): the sandbox and production blocks with their hosts, and a guard that knows them

  Each deployed environment now names its custom domain, its data APIs, its nodes and ENVIRONMENT. The
  guard refuses a build whose environment, data API, node kind or network, or route is another
  environment's, so a testnet answer can never be served from production, nor the reverse.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```

---

### Task 3: The environment, in the Worker and the browser

**Files:**
- Create: `app/ui/environment.ts`, `app/ui/environment.test.ts`
- Modify: `app/root.tsx` (a `loader` and `shouldRevalidate`, §6), `app/ui/use-network.ts` (`useEnvironment`), `app/ui/use-network.test.tsx`, `test/support/under-network.tsx` (an `environment` option), `test/worker/layout.spec.ts`

**Interfaces:**
- Consumes: Task 2 `Env.ENVIRONMENT`.
- Produces:
  ```ts
  // app/ui/environment.ts (no imports)
  export type Environment = "development" | "sandbox" | "production";
  export type NetworkKind = "mainnet" | "testnet";
  /** Anything but "sandbox" or "production" is development: a deployed build has the exact value (the guard). */
  export function environmentOf(value: unknown): Environment;
  /** The sandbox shows the testnets; development and production the mainnets. */
  export function networkKindOf(environment: Environment): NetworkKind;
  // app/root.tsx
  export type RootLoaderData = { environment: Environment };
  export function loader({ context }: Route.LoaderArgs): RootLoaderData;   // environmentOf(getEnv(context).ENVIRONMENT); names no cache class
  export const shouldRevalidate = () => false;
  // app/ui/use-network.ts
  export const ROOT_ROUTE_ID = "root";
  /** useRouteLoaderData(ROOT_ROUTE_ID)?.environment through environmentOf; "development" where the data or the router is missing; never throws. */
  export function useEnvironment(): Environment;
  // test/support/under-network.tsx: UnderNetworkOptions.environment?: Environment — a root route (id "root", loader () => ({ environment }))
  // around the layout, for the component tests of Tasks 5–7
  ```

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // environment.test.ts (the components project runs app/ui/**, Ruling 3)
  it("reads the three values", () => expect(["development", "sandbox", "production"].map(environmentOf)).toEqual(["development", "sandbox", "production"]));
  it("takes anything else for development", () =>
    expect([undefined, "", "stag" + "ing", "Sandbox", 1].map(environmentOf)).toEqual(Array(5).fill("development")));
  it("shows the testnets in the sandbox only", () =>
    expect((["development", "sandbox", "production"] as const).map(networkKindOf)).toEqual(["mainnet", "testnet", "mainnet"]));
  // use-network.test.tsx
  it("useEnvironment gives the root's environment", …);              // a root route (ROOT_ROUTE_ID) whose loader gives { environment: "sandbox" }
  it("useEnvironment gives development without root data, without a router, and never throws", …);
  // layout.spec.ts
  it("hands the browser the environment in the root's data", …);
  //   GET /xrpl.data?_routes=root: 200, the body contains '"environment"' and '"development"'
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/environment app/ui/use-network` → FAIL (modules missing).
- [ ] **Step 3: Implement** the module, the root loader and the hook (the hook mirrors `useFeatures`: a `try` around `useRouteLoaderData`), and the test helper's option.
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm test app/ui/environment app/ui/use-network test/worker/layout`, then `pnpm verify` (the root's data adds about 30 bytes to each document) → exit 0.
- [ ] **Step 5: Commit.**
  ```bash
  git add app/ui/environment.ts app/ui/environment.test.ts app/root.tsx app/ui/use-network.ts app/ui/use-network.test.tsx \
    test/support/under-network.tsx test/worker/layout.spec.ts
  git commit -F- <<'EOF'
  feat(sandbox): ENVIRONMENT decides the kind of network, and reaches the browser through the root

  The error pages, the not-found route and the network switch have no /:net data of their own, so the
  root's loader carries the environment to them; it is never fetched again on a navigation.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```

---

### Task 4: The facts of a network per environment, and the CTIDs

**Files:**
- Modify: `app/server/networks.ts` (+ `networks.test.ts`), `app/ui/networks.ts` (adds `NETWORK_NAMES`; the rest of the file changes in Task 5), `app/server/resolve.ts`, `app/routes/net.tx.$id.tsx`, `app/routes/net.search.tsx`, `app/routes/net.ledger.$id.tsx`, `app/routes/net.amm.$pool.tsx`, `app/routes/net.validators.$key.tsx`, `app/routes/net.amendments.$name.tsx`, `app/routes/net.account.$address.tsx` (each names the other network from `networkOf(net.other, getEnv(context))` instead of `findNetwork(id)`), `test/support/under-network.tsx` and every hand-built `Network` / `PublicNetwork` of the tests (the mainnet values of the new fields), `test/worker/search.spec.ts`, `vitest.config.ts` (the `worker-sandbox` project)
- Create: `test/worker/environment-sandbox.spec.ts`

**Interfaces:**
- Consumes: Task 3 `environmentOf`, `networkKindOf`, `NetworkKind`.
- Produces (E10 adds `hasDelegation` and E14 `hasMpt` to `NetworkEntry`, one value per kind and network, beside `hasAmm`):
  ```ts
  // app/ui/networks.ts (pure: type imports only)
  export const NETWORK_NAMES: Record<NetworkKind, Record<NetworkId, { name: string; label: string; longName: string; dexName: string }>>;
  // app/server/networks.ts; the head comment: "the only place that knows a network's URLs and facts; the names are app/ui/networks.ts's"
  export interface Network {
    id: NetworkId; kind: NetworkKind; name: string; label: string; longName: string; dexName: string;
    native: "XRP" | "XAH"; ctidNetworkId: 0 | 21337 | 1 | 21338; dataApiUrl: string; nodeUrl: string; other: NetworkId;
    hasAmm: boolean; software: "rippled" | "xahaud"; displays: readonly Display[]; features: Features;
  }
  type NetworkEntry = Pick<Network, "id" | "kind" | "native" | "ctidNetworkId" | "other" | "hasAmm" | "software" | "displays"> & {
    dataApiUrlVar: "XRPL_DATA_API_URL" | "XAHAU_DATA_API_URL"; nodeUrlVar: "XRPL_NODE_URL" | "XAHAU_NODE_URL" };
  const NETWORKS: Record<NetworkKind, Record<NetworkId, NetworkEntry>>;
  /** NETWORKS[networkKindOf(environmentOf(env.ENVIRONMENT))][id] with its names, the URLs and featuresOf(env). */
  export function networkOf(id: NetworkId, env: Env): Network;
  /** The network of that kind whose ctidNetworkId it is, else undefined. */
  export function networkIdOfCtid(networkId: number, kind: NetworkKind): NetworkId | undefined;
  export function isNetworkId(s: string): s is NetworkId;   // unchanged
  ```
  `Display` is `import type` from `app/domain/network-params.ts`. `PublicNetwork` (`network-route.ts`) carries the new fields to the browser as it is (no URL). `resolveCtid` decides the owner with `networkIdOfCtid(decoded.networkId, net.kind)`; the transaction and search routes' "covered" tests pass `net.kind`; the transaction page's CTID already comes from `network.ctidNetworkId` (§7.4).
  The `worker-sandbox` project: `sandboxBindings = { ...testBindings, ENVIRONMENT: "sandbox" }` (the top level's URLs and switches, so every page can be drawn over the existing fixtures, Ruling 13), `include: ["test/worker/**/*-sandbox.spec.ts"]`, `provide: { workerBindings: sandboxBindings }`; `worker` excludes `*-sandbox.spec.ts` as it excludes `*-off.spec.ts`. Later plans add a `*-sandbox.spec.ts` case only where their page says something per kind.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // networks.test.ts
  it.each([["development", "mainnet"], ["production", "mainnet"], ["sandbox", "testnet"], ["Sandbox", "mainnet"]])(
    "networkOf in %s gives the %s facts and names", (environment, kind) => …);   // each cell of the Global Constraints' tables, both ids
  it("knows the network of a CTID id by kind", () => {
    expect([networkIdOfCtid(0, "mainnet"), networkIdOfCtid(21337, "mainnet"), networkIdOfCtid(1, "testnet"), networkIdOfCtid(21338, "testnet")])
      .toEqual(["xrpl", "xahau", "xrpl", "xahau"]);
    expect([networkIdOfCtid(0, "testnet"), networkIdOfCtid(21338, "mainnet"), networkIdOfCtid(2, "testnet")]).toEqual([undefined, undefined, undefined]);
  });
  it("gives every network of a kind a CTID id of its own", …);
  // search.spec.ts (development)
  it("says a CTID of XRPL Testnet is for network id 1, which this explorer does not cover", …);   // /xrpl/search?q=encodeCtid(107720688, 17, 1)
  // environment-sandbox.spec.ts (new; its own visitor addresses, 198.51.100.x)
  it("/xrpl/tx: the breadcrumb says XRPL Testnet and the CTID ends 0001", …);   // `CTID ${encodeCtid(102186243, 63, 1)}` for PAYMENT (transaction.spec.ts)
  it("/xahau/tx: the CTID ends 535A", …);                                       // `CTID ${encodeCtid(26540613, 88, 21338)}` for REMIT
  it("search: a CTID of XRPL Testnet redirects to its transaction", …);         // encodeCtid(107720688, 17, 1): 302 to search.spec.ts's hash
  it("search: a mainnet CTID is not covered", …);   // encodeCtid(107720688, 17, 0): "… is for network id 0, which this explorer does not cover."
  it("search: a CTID of Xahau Testnet on /xrpl offers Xahau Testnet", …);      // encodeCtid(26540187, 5, 21338): the offer names "Xahau Testnet"
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/networks` → FAIL (`networkIdOfCtid` takes one argument; no `kind`).
- [ ] **Step 3: Implement** the tables, `networkOf`, `networkIdOfCtid`, the routes' changes and the project.
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm test app/server/networks test/worker/search test/worker/resolve`, `pnpm exec vitest run --project worker-sandbox`, then `pnpm verify` and `pnpm test:e2e` → exit 0.
- [ ] **Step 5: Commit.**
  ```bash
  git add app/server/networks.ts app/server/networks.test.ts app/ui/networks.ts app/server/resolve.ts app/routes/net.tx.\$id.tsx app/routes/net.search.tsx \
    app/routes/net.ledger.\$id.tsx app/routes/net.amm.\$pool.tsx app/routes/net.validators.\$key.tsx app/routes/net.amendments.\$name.tsx \
    app/routes/net.account.\$address.tsx test/support/under-network.tsx test/worker/search.spec.ts test/worker/environment-sandbox.spec.ts vitest.config.ts
  git add <each test file whose hand-built Network or PublicNetwork gained the new fields, by name, as `git status --short` lists them>
  git commit -F- <<'EOF'
  feat(sandbox): a network's facts and names by kind, and CTIDs of the testnets

  In the sandbox the layout's network is XRPL Testnet or Xahau Testnet: its CTID ids are 1 and 21338,
  and a mainnet CTID is one this explorer does not cover. A worker-sandbox project draws the pages with
  ENVIRONMENT "sandbox" over the existing fixtures.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```

---

### Task 5: The names where there is no layout data

**Files:**
- Modify: `app/ui/networks.ts` (§5's API; `NETWORK_CHOICES` and `DEFAULT_NETWORK` go), `app/ui/components/NetworkSwitch.tsx`, `app/root.tsx` (`ErrorBoundary`, `meta` description), `app/routes/net.tsx` (`meta`, `ErrorBoundary`), `app/routes/not-found.tsx`, `app/server/meta.ts` (`metaContext` from the layout), `app/routes/net.search.tsx` (`meta`), the clientLoaders of `app/routes/net.network.tsx`, `net.validators.tsx`, `net.validators.$key.tsx`, `net.amendments.tsx`, `net.amendments.$name.tsx`, `app/ui/components/components.test.tsx`, `app/server/meta.test.ts`, `app/ui/routes-wiring.test.tsx`, `test/worker/environment-sandbox.spec.ts`
- Create: `app/ui/networks.test.ts`

**Interfaces:**
- Consumes: Task 3 `useEnvironment`, `networkKindOf`, `NetworkKind`, `ROOT_ROUTE_ID`; Task 4 `NETWORK_NAMES`, `isNetworkId`, the layout's `PublicNetwork`.
- Produces, `app/ui/networks.ts`:
  ```ts
  export type NetworkBrief = { id: NetworkId; kind: NetworkKind; name: string; label: string; longName: string; dexName: string };
  export type NetworkInfo = NetworkBrief & Pick<PublicNetwork, "native" | "software">;
  /** The two networks of a kind, in the switch's order (xrpl, xahau). */
  export function networkChoices(kind: NetworkKind): readonly NetworkBrief[];
  export function findNetwork(segment: string | undefined, kind: NetworkKind): NetworkBrief | undefined;
  export const DEFAULT_NETWORK_ID: NetworkId = "xrpl";
  ```
  Where each name comes from (§6): `NetworkSwitch` lists `networkChoices(networkKindOf(useEnvironment()))`; `root.tsx`'s and `net.tsx`'s `ErrorBoundary` and `not-found.tsx` draw `findNetwork(segment ?? DEFAULT_NETWORK_ID, networkKindOf(useEnvironment()))` (the not-found loader keeps `net: isNetworkId(first) ? first : DEFAULT_NETWORK_ID`); `net.tsx`'s `meta` tells an unknown network by `isNetworkId(params.net ?? "")`; `metaContext(net, matches)` returns the `/:net` layout's `network` (from `matches`, with its `origin`) when its id is `net`, else `undefined`; `net.search.tsx`'s `meta` names `metaContext(params.net, matches)?.network`; the five clientLoaders test `isNetworkId(params.net ?? "")` and use `params.net` as the id (Ruling 4); `root.tsx`'s `meta` describes `Look up any ledger, transaction or account on ${a.longName} and ${b.longName}.` over `networkChoices(networkKindOf(loaderData?.environment ?? "development"))`. `Shell`, `Header`, `SearchBox`, `NotFoundPage` and `RouteErrorScreen` keep taking a `NetworkBrief`.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // networks.test.ts (components project)
  it("has the names table", () => expect(NETWORK_NAMES).toEqual({ mainnet: { xrpl: {…}, xahau: {…} }, testnet: { xrpl: {…}, xahau: {…} } }));   // the Global Constraints' names
  it("lists each kind's networks in the switch's order", () =>
    expect(networkChoices("testnet").map((n) => [n.id, n.kind, n.name])).toEqual([["xrpl", "testnet", "XRPL Testnet"], ["xahau", "testnet", "Xahau Testnet"]]));
  it("finds a segment by kind, and nothing else", () => {
    expect(findNetwork("xahau", "testnet")?.longName).toBe("Xahau Testnet");
    expect([findNetwork("xrp", "mainnet"), findNetwork(undefined, "testnet"), findNetwork("XRPL", "mainnet")]).toEqual([undefined, undefined, undefined]);
  });
  // components.test.tsx
  it("NetworkSwitch names the testnets in the sandbox and the mainnets elsewhere", …);   // renderUnderNetwork(…, { environment: "sandbox" }) and none
  // meta.test.ts
  it("metaContext takes the layout's network, with its testnet names", …);   // layout data { network: <XRPL Testnet PublicNetwork>, origin }:
  //   network.name "XRPL Testnet"; suffixOf(it) "XRPL Testnet · explorer"; transactionMeta's description ends "· XRPL Testnet ledger 102,186,243";
  //   no layout match, or a layout of another id: undefined
  // routes-wiring.test.tsx: describe("root.tsx") (Ruling 12)
  it("describes the environment's networks", …);   // meta with loaderData { environment: "sandbox" }: "… on XRPL Testnet and Xahau Testnet.";
  //   with none: "… on the XRP Ledger and Xahau."
  it("draws its error page with the environment's switch", …);   // ErrorBoundary under root data "sandbox": "XRPL Testnet", "Xahau Testnet"
  // environment-sandbox.spec.ts
  it("/xrpl: the switch reads XRPL Testnet and Xahau Testnet", …);
  it("/xrpl/tx: the title ends XRPL Testnet · explorer and the description says XRPL Testnet ledger", …);   // PAYMENT, Ruling 9
  it("/xrp: the unknown network's page names the testnets in its switch", …);
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/ui/networks app/server/meta` → FAIL (`networkChoices` is not exported; `metaContext` gives "XRPL").
- [ ] **Step 3: Implement** the module and every place of the list.
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm verify` and `pnpm test:e2e` → exit 0 (the development pages keep their names).
- [ ] **Step 5: Commit.**
  ```bash
  git add app/ui/networks.ts app/ui/networks.test.ts app/ui/components/NetworkSwitch.tsx app/ui/components/components.test.tsx app/root.tsx \
    app/routes/net.tsx app/routes/not-found.tsx app/server/meta.ts app/server/meta.test.ts app/routes/net.search.tsx app/routes/net.network.tsx \
    app/routes/net.validators.tsx app/routes/net.validators.\$key.tsx app/routes/net.amendments.tsx app/routes/net.amendments.\$name.tsx \
    app/ui/routes-wiring.test.tsx test/worker/environment-sandbox.spec.ts
  git commit -F- <<'EOF'
  feat(sandbox): the switch, the error pages and the tags name the environment's networks

  Places outside the /:net layout's data read the names table by the root's environment, and the tags
  of a page read the layout's network, so the sandbox says XRPL Testnet and Xahau Testnet everywhere.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```

---

### Task 6: The words that name a network

**Files:**
- Modify: `app/ui/pages/HomePage.tsx` (hero `Explore ${network.longName}`; status line `{network.label} · ledger …`; `HOME_TITLES` goes) and `app/routes/net._index.tsx` (`homeMeta(\`Explore ${ctx.network.longName}\`, ctx)`), `app/server/card-data.ts` (`labelOf` reads `network.label`), `app/ui/pages/AmmListPage.tsx` (intro `Automated market maker pools on ${longName}. …`, from `useNetwork()`), `app/server/meta-amm-list.ts` (`Automated market maker pools on ${ctx.network.longName}: …`), `app/routes/net.amm.$pool.tsx` (the note `${net.name} has no AMM, so this pool exists only on ${other.longName}.`), `app/server/markets-view.ts` (`introOf(ammState, network)` and the "AMM share" tile's sub `${network.name} has no AMM`), `app/server/meta-markets.ts`, `app/server/meta-pair.ts` (`network.dexName`; `DEX_NAMES` goes from `meta.ts`, and from `META_EXPORTS` of `test/unit/meta-bundle.test.ts`), `app/server/analytics-view.ts` (`dexWording` takes `name`: `Order-book trades only; ${name} has no AMM.`), and what the grep of §7.1 found (Ruling 5): `app/ui/pages/NetworkPage.tsx` (`${network.name} network`; `NETWORK_TITLES` goes), `app/ui/pages/network-volume.ts` (`ammWording(amm, networkName)`: the `none` texts `order book only, no AMM on ${networkName}` and `${networkName} has no AMM; …`), `app/ui/pages/NoAmmPage.tsx` (`${name} has no AMM`, `The AMM amendment is not part of ${name} … Trades on ${name} …`, `See ${name} markets →`, `Switch to ${other.name} pools`, from `useNetwork()` and `findNetwork(network.other, network.kind)`), `app/ui/pages/RouteErrorScreen.tsx` (`This explorer covers ${a.name} and ${b.name}.` over `networkChoices(net.kind)`); the tests of each, and `test/worker/environment-sandbox.spec.ts`

**Interfaces:**
- Consumes: Task 4's `Network` fields; Task 5's `NetworkBrief`, `NetworkInfo`, `networkChoices`, `findNetwork`, `metaContext`.
- Produces: no new names; `HOME_TITLES`, `DEX_NAMES` and `NETWORK_TITLES` are gone (later plans write `network.longName`, `network.dexName`, `network.name`).

- [ ] **Step 1: Write the failing tests** (each for a mainnet and a testnet network; the mainnet texts are today's):
  ```ts
  // HomePage.test.tsx: "Explore XRPL Testnet" and "XRPL Testnet · ledger"; "Explore the XRP Ledger" and "XRPL mainnet · ledger"
  // card-data.test.ts: networkLabel "XRPL Testnet" for a testnet network, "XRPL mainnet" for a mainnet one (§12)
  // AmmListPage.test.tsx and meta-amm-list (meta.test.ts): "… on XRPL Testnet" / "… on the XRP Ledger"
  // markets-view.test.ts: "Trades on the XRPL Testnet DEX: order-book crossings and swaps against AMM pools." (on),
  //   "Trades on the XRPL Testnet DEX." (off), "Trades on the Xahau Testnet DEX. Xahau Testnet has no AMM, so every trade is an order-book
  //   crossing." (none), and the tile's "Xahau Testnet has no AMM"; meta-markets and meta-pair descriptions with "the XRPL Testnet DEX"
  // analytics-view.test.ts: dexWording of Xahau Testnet → { hint: "order book", lead: "Order-book trades only; Xahau Testnet has no AMM." }
  // NetworkPage.test.tsx: the h1 "XRPL Testnet network" (and "XRPL network"); network-volume.test.ts: the none wording with "Xahau Testnet"
  // components.test.tsx: NoAmmPage under Xahau Testnet: "Xahau Testnet has no AMM", "See Xahau Testnet markets →", "Switch to XRPL Testnet pools";
  //   RouteErrorScreen with an unknown network and a testnet net: "… This explorer covers XRPL Testnet and Xahau Testnet."
  // environment-sandbox.spec.ts
  it("/xrpl: Explore XRPL Testnet, and the status line says XRPL Testnet · ledger", …);
  it("/xahau/amm/{pool}: Xahau Testnet has no AMM, so this pool exists only on XRPL Testnet.", …);   // the pool of amm-pool.spec.ts's Xahau case
  it("/og/xrpl/tx/{hash}.png renders", …);   // PAYMENT: 200, image/png (the pill's words are card-data.test.ts's)
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/card-data app/server/markets-view app/server/analytics-view app/ui/pages` → FAIL (mainnet words in testnet cases).
- [ ] **Step 3: Implement** every place of the list.
- [ ] **Step 4: Grep once more.** `grep -rnE 'XRP Ledger|mainnet|"XRPL"|"Xahau"|on Xahau|Xahau (has|markets)|XRPL pools' app --include='*.ts' --include='*.tsx' | grep -v '\.test\.'`: what is left is a comment, a type, the names table of `app/ui/networks.ts`, or a description of a transaction type (`app/domain/describe/`); move anything else to a field and say so in the task report.
- [ ] **Step 5: Run the tests to verify they pass.** `pnpm verify` and `pnpm test:e2e` → exit 0.
- [ ] **Step 6: Commit.**
  ```bash
  git add app/ui/pages app/routes/net._index.tsx app/routes/net.amm.\$pool.tsx app/server/card-data.ts app/server/card-data.test.ts app/server/meta.ts \
    app/server/meta.test.ts app/server/meta-amm-list.ts app/server/meta-markets.ts app/server/meta-pair.ts app/server/markets-view.ts \
    app/server/markets-view.test.ts app/server/analytics-view.ts app/server/analytics-view.test.ts app/ui/components/components.test.tsx \
    test/unit/meta-bundle.test.ts test/worker/environment-sandbox.spec.ts
  git commit -F- <<'EOF'
  feat(sandbox): the pages that name a network in their own words read its name, label, long name and DEX

  "XRPL mainnet", "the XRP Ledger" and "Xahau has no AMM" were written out; they now come from the page's
  network, so the home page, the link previews, the AMM and markets pages say XRPL Testnet in the sandbox
  (D11).

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```

---

### Task 7: The Testnet badge

**Files:**
- Modify: `app/ui/components/Pill.tsx` (tone `testnet`), `app/ui/components/Header.tsx`, `app/ui/components.css` (`.pill--testnet`, `.hdr__brandgroup`), `app/ui/tokens.css` (the three tokens in the light block and in both dark blocks), `test/unit/tokens.test.ts`, `test/unit/pages-css.test.ts`, `app/ui/components/components.test.tsx`, `app/ui/routes-wiring.test.tsx`, `test/worker/environment-sandbox.spec.ts`, `test/worker/layout.spec.ts`

**Interfaces:**
- Consumes: Task 3 `useEnvironment`, `networkKindOf`.
- Produces: `PillTone` gains `"testnet"`. `Header` wraps the brand link in `<div className="hdr__brandgroup">` (display flex, align-items center, gap 10px: the board's group, Ruling 6) and, when `networkKindOf(useEnvironment())` is `"testnet"`, draws `<Pill tone="testnet" icon={null}>Testnet</Pill>` right after the link, inside the group; no `title` (D4). The group never hides the badge: on a phone the brand's name goes (as today), and the mark, the badge and the switch stay. Tokens (§7.2): light `--testnet-fg: #7A4306`, `--testnet-bg: #FDF0D5`, `--testnet-border: #EBC985`; dark (both blocks) `#F5C866`, `#33240A`, `#5C4316`. `.pill--testnet`: `font-size: 11.5px; font-weight: 600; letter-spacing: .02em; padding: 2px 8px; border-radius: 999px; background: var(--testnet-bg); color: var(--testnet-fg); border: 1px solid var(--testnet-border)`.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // tokens.test.ts
  it("has the testnet badge's tokens in light and both dark blocks", …);   // the six values above (lower-cased, as block() reads them)
  it("keeps the badge's text above 7:1 in light and 9.5:1 in dark", …);   // contrast(fg, bg) ≥ 7 light; ≥ 9.5 in each dark block (7.06 and 9.54)
  // pages-css.test.ts
  it("draws the testnet pill as the board's .tnet", …);   // rule(componentsCss, ".pill--testnet") holds the declarations above
  // components.test.tsx
  it("Pill testnet has no icon of its own", …);           // <span class="pill pill--testnet">Testnet</span>
  it("Header shows the badge after the brand under a sandbox root, and not under production, development or none", …);
  //   renderUnderNetwork(<Header …/>, …, { environment }): the .hdr__brandgroup's children are the brand link, then the pill; no title attribute
  // routes-wiring.test.tsx
  it("the root error page shows the badge in the sandbox", …);
  // environment-sandbox.spec.ts
  it("/xrpl and /xrp show the badge in the server-rendered header", …);   // 'pill--testnet' and ">Testnet<" in the HTML of both
  // layout.spec.ts (development)
  it("shows no Testnet badge", …);
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test test/unit/tokens test/unit/pages-css app/ui/components` → FAIL.
- [ ] **Step 3: Implement** the tone, the tokens, the CSS and the header.
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm verify` and `pnpm test:e2e` (its axe scans run development, which has no badge; `tokens.test.ts` pins the badge's contrast) → exit 0.
- [ ] **Step 5: Commit.**
  ```bash
  git add app/ui/components/Pill.tsx app/ui/components/Header.tsx app/ui/components.css app/ui/tokens.css test/unit/tokens.test.ts \
    test/unit/pages-css.test.ts app/ui/components/components.test.tsx app/ui/routes-wiring.test.tsx test/worker/environment-sandbox.spec.ts test/worker/layout.spec.ts
  git commit -F- <<'EOF'
  feat(sandbox): a Testnet badge after the logo on every page of the sandbox

  The board's badge, in the server-rendered header of every page, the error pages included, with tokens
  of its own in light and dark (7.1:1 and 9.5:1). No tooltip: the word says it, and a tooltip is out of
  reach by keyboard and touch (D4).

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```

---

### Task 8: No USD view on a testnet

**Files:**
- Modify: `app/domain/network-params.ts` (+ `network-params.test.ts`), `app/routes/net.network.tsx` (loader and clientLoader), `app/server/network-view.ts` (`displays: net.displays`), `app/ui/pages/NetworkPage.tsx` (`networkHref(network, …)`) and `NetworkPage.test.tsx`, `app/ui/routes-wiring.test.tsx`, `test/worker/environment-sandbox.spec.ts`

**Interfaces:**
- Consumes: Task 4 `Network.displays`.
- Produces (`DISPLAYS` and `displaysOf` go, §7.5):
  ```ts
  /** The part of a network the views need: the id, for the path, and its displays. */
  export type NetworkViews = Pick<Network, "id" | "displays">;   // import type
  /** Every display there is, for a caller that has no network's facts (the network page's clientLoader, Ruling 4). */
  export const ALL_DISPLAYS: readonly Display[] = ["native", "usd"];
  export function parseNetworkParams(query: string, net: NetworkViews): { params: NetworkParams; canonical: string };
  export function networkHref(net: NetworkViews, params: Partial<NetworkParams>): string;
  export function networkScope(net: NetworkViews, params: NetworkParams): string;
  ```
  `in=usd` is a view only where `net.displays` has `"usd"`; elsewhere the loader's canonical redirect drops it (302, `cacheClassHeaders("short")`, before any call). `USD_ISSUER` stays (production XRPL). The page offers the currency control only with more than one display (as today). The markets pages' quote filter is unchanged.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // network-params.test.ts
  const TESTNET_XRPL = { id: "xrpl", displays: ["native"] } as const;
  it("drops in=usd where the network has no USD view", () =>
    expect(parseNetworkParams("in=usd&period=7d", TESTNET_XRPL)).toEqual({ params: { period: "7d", display: "native" }, canonical: "period=7d" }));
  it("keeps in=usd on mainnet XRPL", …);   // { id: "xrpl", displays: ["native", "usd"] }: canonical "in=usd"; networkHref(…) "/xrpl/network?in=usd"
  // NetworkPage.test.tsx: a testnet network's page has no USD link
  // environment-sandbox.spec.ts
  it("/xrpl/network?in=usd is a short 302 to /xrpl/network, with no upstream call", …);   // Location /xrpl/network; mock.requests is []
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/domain/network-params` → FAIL (the second argument is an id).
- [ ] **Step 3: Implement** the module and its callers.
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm verify` and `pnpm test:e2e` → exit 0.
- [ ] **Step 5: Commit.**
  ```bash
  git add app/domain/network-params.ts app/domain/network-params.test.ts app/routes/net.network.tsx app/server/network-view.ts \
    app/ui/pages/NetworkPage.tsx app/ui/pages/NetworkPage.test.tsx app/ui/routes-wiring.test.tsx test/worker/environment-sandbox.spec.ts
  git commit -F- <<'EOF'
  feat(sandbox): the network page's USD view exists only where the network has it

  The USD of the view is GateHub's mainnet issuer, and the testnets have no such market (D6), so the
  views a network has are a fact of the network and ?in=usd on a testnet redirects to the view without it.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```

---

### Task 9: The validators pages and Xahau Testnet's fixed list

**Files:**
- Modify: `app/server/validator-facts.ts` (+ `validator-facts.test.ts`), `app/server/validators-view.ts` (+ `validators-view.test.ts`), `app/server/validator-view.ts` (+ `validator-view.test.ts`), `app/server/meta-validator.ts` (+ its case in `meta.test.ts`), `app/server/validators-shape.ts` (+ `validators-shape.test.ts`)

**Interfaces:**
- Consumes: Task 5 `NetworkInfo` (with `kind`, `name`, `software`); D-env's `local` publisher (§5 there: `{ id: "local", url: "", public_key: "", status: "ok", sequence, version, fetched, validators, seen_24h }`, no `expiration`).
- Produces, `validator-facts.ts`:
  ```ts
  export const LOCAL_PUBLISHER = "local";
  /** "Fixed list" for local, the id otherwise (D12). */
  export function publisherLabel(id: string): string;
  /** "" | "on the fixed list" | "listed by A and B" | "listed by A and on the fixed list" (Ruling 7). */
  export function listedByText(ids: readonly string[]): string;
  /** The intro's first sentence (§7.6): mainnet `The default UNL is the list of validators ${software} trusts out of the box<source>.`,
   *  testnet `The default UNL is the list of validators the nodes of ${name} trust<source>.`; <source> is ", published by <joinAnd of the
   *  ids but local>", ", fixed in their configuration" (local alone), ", published by … and fixed in their configuration" (both), or "". */
  export function unlIntro(network: Pick<NetworkInfo, "kind" | "name" | "software">, publisherIds: readonly string[]): string;
  ```
  Uses: the "Listed by" select's options `{ value: id, label: publisherLabel(id) }`; a row's `unlPublishers` and the validator page's `identity.unlPublishers`, `membership[].publisher` and `meta.publishers` hold labels; the intro is `${unlIntro(…)} All adds every other validator whose validations reached the data API in the last 24 hours.`; the UNL tile's sub-line is `seen in 24 h, of those ${listedByText(ids)}` (`seen in 24 h, of those listed` with no ids, as today); `meta-validator.ts` writes `, on the default UNL (${listedByText(publishers)})`; `noticesOf` leaves `local` out (no notice, and not counted in "No validator is trusted until one is."). `validators-shape.ts` checks a publisher's `id` with `isName` and its `url` and `public_key` as strings that may be empty (Ruling 2).

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // validator-facts.test.ts
  it("labels the fixed list", () => expect([publisherLabel("local"), publisherLabel("vl.ripple.com")]).toEqual(["Fixed list", "vl.ripple.com"]));
  it("says who lists", () => expect([[], ["local"], ["vl.ripple.com", "unl.xrplf.org"], ["vl.altnet.rippletest.net", "local"]].map(listedByText))
    .toEqual(["", "on the fixed list", "listed by vl.ripple.com and unl.xrplf.org", "listed by vl.altnet.rippletest.net and on the fixed list"]));
  it("words the intro per kind", …);
  //   mainnet rippled ["vl.ripple.com", "unl.xrplf.org"]: "The default UNL is the list of validators rippled trusts out of the box, published by
  //   vl.ripple.com and unl.xrplf.org."; testnet "XRPL Testnet" ["vl.altnet.rippletest.net"]: "The default UNL is the list of validators the
  //   nodes of XRPL Testnet trust, published by vl.altnet.rippletest.net."; testnet "Xahau Testnet" ["local"]: "… the nodes of Xahau Testnet
  //   trust, fixed in their configuration."
  // validators-shape.test.ts
  it("accepts the fixed list local, with an empty url and public_key and no expiration", …);   // summarySample with that publisher passes
  it("still refuses a publisher whose url is not text", …);                                    // url 5: UpstreamError "server"
  // validators-view.test.ts
  it("labels local Fixed list in the select and on a row", …);   // two publishers (one local): option { value: "local", label: "Fixed list" }
  it("gives local no notice", …);                                // local with any status: notices []
  it("says 'of those on the fixed list' when local is the only list", …);
  it("writes the testnet intro", …);
  // validator-view.test.ts
  it("names local Fixed list in the membership line and the UNL tag", …);   // { publisher: "Fixed list", listed: true }; unlPublishers ["Fixed list"]
  // meta.test.ts: a local-listed validator's description holds "on the default UNL (on the fixed list)"
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/validator-facts app/server/validators-shape app/server/validators-view app/server/validator-view` → FAIL (`publisherLabel` missing; an empty `url` refused).
- [ ] **Step 3: Implement** the three functions and their uses, and the shape check.
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm verify` and `pnpm test:e2e` → exit 0 (the mainnet texts are unchanged).
- [ ] **Step 5: Commit.**
  ```bash
  git add app/server/validator-facts.ts app/server/validator-facts.test.ts app/server/validators-view.ts app/server/validators-view.test.ts \
    app/server/validator-view.ts app/server/validator-view.test.ts app/server/meta-validator.ts app/server/meta.test.ts \
    app/server/validators-shape.ts app/server/validators-shape.test.ts
  git commit -F- <<'EOF'
  feat(sandbox): Xahau Testnet's fixed validator list reads "Fixed list"

  The data API lists the fixed list as the publisher local, with an empty url and key and no expiration
  (D-env §5). The shape check takes it, the pages call it "Fixed list" and give it no notice, and the
  intro says whom a testnet's nodes trust.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```

---

### Task 10: Robots, the cache generation and Sentry

**Files:**
- Create: `app/server/environment.ts`, `app/server/environment.test.ts`
- Modify: `workers/app.ts`, `app/server/env.ts` (`cacheGeneration`; its doc comment), `app/server/env.test.ts`, `test/worker/features-off.spec.ts` (the generation's text), `test/worker/edge-cache.spec.ts`, `app/server/logging.ts` (Sentry's `environment`), `test/worker/entry.spec.ts`, `test/worker/environment-sandbox.spec.ts`, `test/worker/layout.spec.ts`

**Interfaces:**
- Consumes: Task 3 `environmentOf`; Task 8's redirect (a sandbox case below).
- Produces:
  ```ts
  // app/server/environment.ts
  /** In the sandbox, `response` with `X-Robots-Tag: noindex`: the same object when its headers can be changed, else a copy (`new Response(body, response)`)
   *  with the header, for a response whose headers are immutable (one from the Cache API, a redirect). Elsewhere `response` as it is. */
  export function withEnvironmentHeaders(response: Response, env: Pick<Env, "ENVIRONMENT">): Response;
  // app/server/env.ts
  export function cacheGeneration(env: Env): string;   // `${BUILD_ID}:${environmentOf(ENVIRONMENT)}:${sorted switches}` (§8)
  ```
  `workers/app.ts` wraps what `withEdgeCache` returns, inside `withRequestLog`: nothing stored differs between environments, and a stored copy gets the header on the way out. `withSentry`'s options gain `environment: e.ENVIRONMENT`. `robots.txt` is the same in every environment.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // environment.test.ts (unit)
  it("adds noindex in the sandbox, to the same response", …);
  it("copies a response whose headers are immutable, keeping its status, headers and body", …);   // Response.redirect("https://x/", 302)
  it("changes nothing in development and production", …);         // no X-Robots-Tag; the same object
  // env.test.ts and features-off.spec.ts
  it("names the environment in the generation", () =>
    expect(cacheGeneration({ ...env, ENVIRONMENT: "sandbox" })).toBe("test-build:sandbox:ACCOUNT_ANALYTICS=on,AMM_DATA=on,AMM_PAGES=off,MARKETS=on,VALIDATORS=off"));
  //   the existing exact strings gain ":development"; sandbox, production and development generations all differ
  // edge-cache.spec.ts
  it("keys the same call under the sandbox's and production's data APIs apart", …);
  //   two data API clients over recordingCache(), at https://xrpl.data.sandbox.gatehub.net and https://xrpl.data.gatehub.net, ask one path: two keys
  // entry.spec.ts: the Sentry options toMatchObject({ dsn, release: env.BUILD_ID, environment: env.ENVIRONMENT })
  // environment-sandbox.spec.ts
  it.each(["/xrpl", "/xrpl/ledger/107720688.data?_routes=routes%2Fnet.ledger.%24id", "/robots.txt", `/og/xrpl/tx/${PAYMENT}.png`,
    "/xrpl/nothing-here", "/xrpl/network?in=usd"])(
    "%s carries X-Robots-Tag: noindex", …);                          // a page, a .data URL, robots.txt, an image, a 404, a redirect
  it("a page served from the edge cache carries it too", …);         // the second GET of /xrpl/ledger/107720688 (ledger.spec.ts's) is X-Cache: HIT and noindex
  // layout.spec.ts (development)
  it("has no X-Robots-Tag on a page", …);
  ```
- [ ] **Step 2: Run them to verify they fail.** `pnpm test app/server/environment app/server/env` → FAIL.
- [ ] **Step 3: Implement** the wrapper, the entry, the generation and Sentry's option.
- [ ] **Step 4: Run the tests to verify they pass.** `pnpm verify` and `pnpm test:e2e` → exit 0.
- [ ] **Step 5: Commit.**
  ```bash
  git add app/server/environment.ts app/server/environment.test.ts workers/app.ts app/server/env.ts app/server/env.test.ts \
    test/worker/features-off.spec.ts test/worker/edge-cache.spec.ts app/server/logging.ts test/worker/entry.spec.ts \
    test/worker/environment-sandbox.spec.ts test/worker/layout.spec.ts
  git commit -F- <<'EOF'
  feat(sandbox): the sandbox is noindex, its environment is in the cache generation and in Sentry

  Every response of the sandbox says noindex, a stored copy included, while robots.txt stays the same so
  that link previews still unfurl (D2). The environment changes what a page says, like a switch, so it
  is part of the edge key; Sentry tells the sandbox's events apart.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```

---

### Task 11: The README, the bundle figures, the verification and the rollout

**Files:**
- Modify: `README.md` (§14, all of it: "Getting started" (the top level's placeholders are on purpose; developing against the sandbox: `.dev.vars` with its four URLs, `ENVIRONMENT=sandbox` and its key); "Scripts" (`pnpm deploy:sandbox`, `pnpm deploy:production`); "Configuration" (an `ENVIRONMENT` row; the URLs per environment, the Global Constraints' table; `DATA_API_KEY` on `x-explorer-sandbox` and `x-explorer-production`); "Switches" (the values table's `sandbox` column; the conditions say "the environment's data API"; "Adding a switch" step 3 names `sandbox`; the sandbox's rule for a condition that asks for complete coverage, D15, §9); "The data API and the node" (`networks.ts`' facts by kind, the names in `app/ui/networks.ts`; the XRPL node must be a Clio, §10); "SEO and link previews" (the sandbox's `X-Robots-Tag`; the pill); "Tests" (the `worker-sandbox` project and its `*-sandbox.spec.ts` files); "End-to-end tests" (`E2E_BASE_URL` and `E2E_DATA_API_URL` are for production: the fixtures are mainnet data); "The pipeline and deploying" (secrets per environment; a new "The sandbox" paragraph: what it is for, and the reset runbook of §11 with `BUILD_ID=$(git rev-parse --short=12 HEAD)-reset<n> pnpm deploy:sandbox`); the checklists: "Sandbox checklist" replaced by the **sandbox checklist**, the **production checks** and the **build figures**, each item of today kept with "sandbox" or "production" as §14's table sends it, plus §14's new items (the sandbox's certificate; the badge, names and a CTID of each testnet on a page of each kind; `curl -sI https://explorer.sandbox.gatehub.net/xrpl | grep -i x-robots-tag`; `nft_info` answering `objectNotFound`, not `unknownCmd`, on the sandbox's and production's XRPL nodes; Sentry's `environment: sandbox`; how and when the production checks run, §14's last paragraph)), and the client bundle figures of this commit beside "The client bundle check"

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Measure.** `pnpm build && pnpm check:bundle`; write every page's figure and the manifest's size beside "The client bundle check", with the E7 commit, and compare with the figures written there before (the names table, `useEnvironment`, the testnet tone's CSS and the root data: under a kilobyte, §13).
- [ ] **Step 2: Write the README** as listed.
- [ ] **Step 3: Run the whole verification.**
  ```bash
  pnpm verify            # api:check, typecheck, test (unit, components, worker, worker-off, worker-sandbox), build, check:bundle
  pnpm fixtures:check    # unchanged
  pnpm test:e2e          # development, mainnet fixtures; its a11y scans do not see the badge (tokens.test.ts pins its contrast)
  ```
  Every command exits 0, and `test/unit/no-staging.test.ts` passes over the rewritten README.
- [ ] **Step 4: Commit.**
  ```bash
  git add README.md
  git commit -F- <<'EOF'
  docs(sandbox): the sandbox in the README, its checklist, the production checks and the bundle figures

  The end-to-end suite's fixtures are mainnet data, so the old staging checklist splits into what the
  sandbox can show (the environment) and what needs mainnet data (production), plus the build figures
  any commit has (D8).

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```
- [ ] **Step 5: Write the rollout in the task report** (§15; the owner does it, nothing of it is done by the plan): D-env deployed first (the sandbox's data APIs answer on `xrpl.data.sandbox.gatehub.net` and `xahau.data.sandbox.gatehub.net`, with the sandbox explorer's key in their `GH_API_KEYS` and `GH_RATE_LIMIT_KEYS`); then `pnpm exec wrangler secret put DATA_API_KEY --env sandbox` (and `SENTRY_DSN`, optional), `pnpm deploy:sandbox` (the guard passes) and the sandbox checklist; the switches on in the sandbox one by one by their conditions (§9); production once its data APIs answer: `wrangler secret put DATA_API_KEY --env production`, `pnpm deploy:production` with every switch off, the production checks, and the release workflow's deploy only once `CLOUDFLARE_DEPLOY` is `true`. If a Worker named `x-explorer-staging` exists in the Cloudflare account, the owner removes it in the dashboard (§2). After a testnet reset: the sandbox deployed again with a new build id (§11).

---

## Interfaces later plans use

- `wrangler.jsonc`'s blocks `sandbox` (`x-explorer-sandbox`) and `production`; each new switch is added "off" to both and "on" at the top level and in `TOP_LEVEL_SWITCHES` (Task 2). Plans after E7 say `sandbox`, never the old word (`test/unit/no-staging.test.ts`).
- `app/ui/environment.ts`: `Environment`, `NetworkKind`, `environmentOf`, `networkKindOf`; `app/ui/use-network.ts`: `useEnvironment`, `ROOT_ROUTE_ID` (Task 3).
- `app/server/networks.ts`: `Network.kind`, `label`, `longName`, `dexName`, `displays`, `ctidNetworkId: 0 | 21337 | 1 | 21338`; `NetworkEntry` in `NETWORKS[kind][id]`, where E10 adds `hasDelegation` and E14 `hasMpt` (true on XRPL and XRPL Testnet, false on both Xahau networks); `networkOf(id, env)` by environment; `networkIdOfCtid(networkId, kind)` (Task 4). The node URLs per environment are the Global Constraints' table; the sandbox's XRPL node is Ripple's testnet Clio, on which E8's `nft_info` fallback answers (D9).
- `app/ui/networks.ts`: `NETWORK_NAMES`, `NetworkBrief`, `NetworkInfo`, `networkChoices(kind)`, `findNetwork(segment, kind)`, `DEFAULT_NETWORK_ID` (Tasks 4–5). Page words read the layout's network, never a literal (Task 6).
- The `worker-sandbox` Vitest project and its `test/worker/**/*-sandbox.spec.ts` files (Task 4); `renderUnderNetwork(…, { environment })` (Task 3).
- `publisherLabel`, `listedByText`, `unlIntro`, `LOCAL_PUBLISHER` in `app/server/validator-facts.ts` (Task 9); `withEnvironmentHeaders` (Task 10).

## Rulings

1. **Facts of later sub-projects.** `hasDelegation` (E10) and `hasMpt` (E14) are not added here: §5 says those sub-projects add them to this table.
2. **The shape check takes the fixed list.** D-env §5 serves `local` with `url: ""` and `public_key: ""`; `validators-shape.ts` refused an empty `url` (`isName`). The earlier spec in build order, D-env, wins: both fields are checked as strings that may be empty (Task 9).
3. **Where the tests of `app/ui/` run.** `vitest.config.ts` puts `app/ui/**` in the `components` project (happy-dom), so §12's "unit" tests of `app/ui/environment.ts` and `app/ui/networks.ts` run there.
4. **The clientLoaders.** §6 names `isNetworkId(params.net)` for the network page's clientLoader; the four other clientLoaders that used `findNetwork(params.net)` only for its id do the same. The network page's clientLoader has no network facts, so it reads the query against `ALL_DISPLAYS`; on a testnet a `?in=usd` scope never matches the page on screen, and the server's redirect answers (Task 8).
5. **The words §7.1's grep finds.** Besides §7.1's table: `NETWORK_TITLES` (the network page's h1), `NoAmmPage`, `network-volume.ts`'s `none` wording, the markets page's AMM tile and `RouteErrorScreen`'s "covers XRPL and Xahau" read the names too (Task 6).
6. **The badge's group.** The header had no element around the brand link; the board's flex group becomes `.hdr__brandgroup` around the link and the badge (Task 7).
7. **Sentences about the lists.** §7.6 gives the intro for one publisher and for the fixed list alone; `unlIntro` and `listedByText` also word both together ("published by … and fixed in their configuration", "listed by … and on the fixed list"), and the validator's description reads "(on the fixed list)" (Task 9).
8. **The README in three steps.** The mechanical rename is Task 1 (the no-staging test reads the README), the guard's paragraphs are Task 2, the restructure of §14 is Task 11.
9. **The title of `/xrpl` in the sandbox** is the home page's own, "Explore XRPL Testnet · explorer" (its `meta` wins over the layout's); §12's "`<title>` XRPL Testnet · explorer" is pinned on a transaction page's suffix (Task 5) and the hero's words (Task 6).
10. **`network-params.ts` takes the network's views.** `parseNetworkParams`, `networkHref` and `networkScope` take `NetworkViews` (`id` and `displays`) instead of an id, since §7.5 makes the displays a fact of the network (Task 8).
11. **One reason per variable in the guard.** The data API and node rules apply to a URL that today's placeholder and https rule found nothing in, so a placeholder stays one reason and the existing tests keep their counts (Task 2).
12. **The root's tests live in `app/ui/routes-wiring.test.tsx`**, since no Vitest project picks up `app/*.test.tsx` (Tasks 5, 7).
13. **The `worker-sandbox` bindings** are the top level's (placeholder URLs, every switch on) with `ENVIRONMENT: "sandbox"`: the existing mainnet fixtures stand in for testnet data (§12), and no test reaches a deployed data API.
14. **The cache generation names the normalised environment** (`environmentOf`), so an unexpected value keys as development, the kind it shows (Task 10).
