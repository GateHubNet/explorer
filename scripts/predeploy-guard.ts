// What `pnpm deploy:sandbox` and `pnpm deploy:production` check between `react-router build` and `wrangler deploy` (the command is
// predeploy-check.ts; this file is what it and its tests share).
//
// The Cloudflare Vite plugin writes build/server/wrangler.json for the environment `CLOUDFLARE_ENV` names, flattened to the top level (its
// routes, name and vars among them), and `wrangler deploy` follows .wrangler/deploy/config.json to it. Nothing else stops a deploy of what is in
// it. The guard refuses, with every reason it finds, when:
//
//  - an upstream URL is a placeholder (`*.invalid`: wrangler.jsonc's top level holds `*.example.invalid`, and a Worker deployed with them
//    answers every page with a 503) or is not an https URL, or is missing;
//  - a switch (app/ui/features.ts, README "Switches") is missing from the build's vars, is not exactly "on" or "off", or a var that is not a
//    switch has the value "on" or "off" (a misspelt switch, such as `MARKET`: the page it should gate would be served as if it were off);
//  - `AMM_PAGES` is "on" while `AMM_DATA` is not: the AMM pages are all AMM data, so (spec 10) the pages go on in an environment only once the data is on there;
//  - the build is not for the environment asked for (or for none: the top level is local development);
//  - the Worker would be served from workers.dev (`workers_dev`, `preview_urls`), where the Cache API does nothing;
//  - the build is wired to the other environment, or to none (DEPLOYED, KNOWN_NODES; sandbox spec 4): its `ENVIRONMENT` is not the environment's
//    name, a data API URL is not the environment's own, a node is a public node of the other kind of network (a testnet answer served from
//    production, or a mainnet answer from the sandbox) or of the other network (the Xahau variable naming an XRPL node), or its `routes` are not
//    exactly the custom domain of the environment's host. A node on a host the guard does not know (GateHub's own) is not judged. The guard cannot
//    tell a Clio from a rippled: that the XRPL node of a deployed environment is a Clio is for the README's checklists;
//  - `wrangler deploy` would not be sent to this build file, in which case it would deploy something else (wrangler.jsonc's top level).
//
// It fails closed: a build that is missing, that does not parse, or that is not an object is a refusal, never a pass. Secrets cannot be
// checked here (they are not in the build); the README says to set `DATA_API_KEY` with `wrangler secret put`.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { FEATURE_VARS } from "../app/ui/features";

/** The environments of wrangler.jsonc that are deployed. */
export const ENVIRONMENTS = ["sandbox", "production"] as const;

/** The vars that name an upstream: each network's data API and node. */
export const UPSTREAM_VARS = ["XRPL_DATA_API_URL", "XAHAU_DATA_API_URL", "XRPL_NODE_URL", "XAHAU_NODE_URL"] as const;

/** What each deployed environment must be: its host, its data APIs and the kind of network it shows. */
export const DEPLOYED = {
  sandbox: {
    host: "explorer.sandbox.gatehub.net",
    kind: "testnet",
    dataApi: { XRPL_DATA_API_URL: "https://xrpl.data.sandbox.gatehub.net", XAHAU_DATA_API_URL: "https://xahau.data.sandbox.gatehub.net" },
  },
  production: {
    host: "explorer.gatehub.net",
    kind: "mainnet",
    dataApi: { XRPL_DATA_API_URL: "https://xrpl.data.gatehub.net", XAHAU_DATA_API_URL: "https://xahau.data.gatehub.net" },
  },
} as const;

/**
 * The public nodes the guard knows, by host: s1.ripple.com, s2.ripple.com, xrplcluster.com, xrpl.ws (XRPL mainnet); xahau.network (Xahau
 * mainnet); clio.altnet.rippletest.net, s.altnet.rippletest.net, testnet.xrpl-labs.com (XRPL Testnet); xahau-test.net (Xahau Testnet). A node on a
 * host that is not here (GateHub's own) is not judged by the environment it is in.
 */
export const KNOWN_NODES: Readonly<Record<string, { network: "xrpl" | "xahau"; kind: "mainnet" | "testnet" }>> = {
  "s1.ripple.com": { network: "xrpl", kind: "mainnet" },
  "s2.ripple.com": { network: "xrpl", kind: "mainnet" },
  "xrplcluster.com": { network: "xrpl", kind: "mainnet" },
  "xrpl.ws": { network: "xrpl", kind: "mainnet" },
  "xahau.network": { network: "xahau", kind: "mainnet" },
  "clio.altnet.rippletest.net": { network: "xrpl", kind: "testnet" },
  "s.altnet.rippletest.net": { network: "xrpl", kind: "testnet" },
  "testnet.xrpl-labs.com": { network: "xrpl", kind: "testnet" },
  "xahau-test.net": { network: "xahau", kind: "testnet" },
};

type Deployed = keyof typeof DEPLOYED;

/** The two networks of an environment, by the variables that name their data API and their node. */
const NETWORKS = [
  { network: "xrpl", name: "XRPL", dataApi: "XRPL_DATA_API_URL", node: "XRPL_NODE_URL" },
  { network: "xahau", name: "Xahau", dataApi: "XAHAU_DATA_API_URL", node: "XAHAU_NODE_URL" },
] as const;

/** How a network of a kind is called in a message (sandbox spec 5, `label`). */
const LABELS = {
  xrpl: { mainnet: "XRPL mainnet", testnet: "XRPL Testnet" },
  xahau: { mainnet: "Xahau mainnet", testnet: "Xahau Testnet" },
} as const;

/** The build's config and the redirect that sends `wrangler deploy` to it, below the project root. */
export const BUILT_CONFIG = join("build", "server", "wrangler.json");
export const DEPLOY_REDIRECT = join(".wrangler", "deploy", "config.json");

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** `value` as it is quoted in a message: cut short, so that a long one stays readable. */
const quoted = (value: unknown): string => {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}…` : text);
};

/** The problem with an upstream URL, if it has one. A host under `.invalid` never resolves (RFC 6761): it is a placeholder. */
function urlProblem(name: string, value: unknown, environment: string): string | undefined {
  const where = `Put the real one in env.${environment}.vars of wrangler.jsonc.`;
  if (typeof value !== "string" || value === "") return `${name} is not set (${quoted(value)}). ${where}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${name} is not a URL (${quoted(value)}). ${where}`;
  }
  if (url.protocol !== "https:") return `${name} is not an https URL (${quoted(value)}): the data API key and the answers must not travel in the clear. ${where}`;
  // `new URL` lower-cases the host; a name may end in a dot.
  const host = url.hostname.replace(/\.$/, "");
  if (host === "invalid" || host.endsWith(".invalid")) {
    return `${name} is a placeholder (${quoted(value)}): *.invalid never resolves, so every page would be a 503. ${where}`;
  }
  return undefined;
}

const SWITCH_VALUES = '"on" or "off"';

/** The reasons the switches among `vars` are wrong, in the order: missing, not exactly "on" or "off", a var that is not a switch but has such a value. */
function switchProblems(vars: Record<string, unknown>, environment: string): string[] {
  const where = `Put ${SWITCH_VALUES} in env.${environment}.vars of wrangler.jsonc.`;
  const names: readonly string[] = FEATURE_VARS;
  const isOnOff = (value: unknown) => value === "on" || value === "off";
  return [
    ...FEATURE_VARS.filter((name) => !Object.hasOwn(vars, name)).map((name) => `${name} is not set: every switch must be ${SWITCH_VALUES}. ${where}`),
    ...FEATURE_VARS.filter((name) => Object.hasOwn(vars, name) && !isOnOff(vars[name])).map(
      (name) => `${name} is ${quoted(vars[name])}, not exactly ${SWITCH_VALUES}. ${where}`,
    ),
    ...Object.keys(vars)
      .filter((name) => isOnOff(vars[name]) && !names.includes(name))
      .map(
        (name) =>
          `${name} is ${quoted(vars[name])} (${SWITCH_VALUES} is what a switch is set to), but it is not a switch; the switches are ${FEATURE_VARS.join(", ")}: a misspelt one? ` +
          `Rename it in env.${environment}.vars of wrangler.jsonc, or give it another value.`,
      ),
  ];
}

/**
 * The reasons a combination of switches is wrong, each switch being fine on its own. `AMM_PAGES` on needs `AMM_DATA` on (spec 10): every AMM page reads
 * the data that switch gates, so pages on over data that is off would be served from an index the environment has not got. An `AMM_DATA` that is
 * missing or is not "on" counts as off (and has its reason from `switchProblems` as well, which comes first); an `AMM_PAGES` that is not exactly "on" is off.
 */
function crossSwitchProblems(vars: Record<string, unknown>): string[] {
  return vars.AMM_PAGES === "on" && vars.AMM_DATA !== "on" ? ["AMM_PAGES is on but AMM_DATA is off: the AMM pages need the AMM data"] : [];
}

/** `ENVIRONMENT` must be the name of the environment: it is what decides whether the pages show mainnets or testnets. */
function environmentProblem(vars: Record<string, unknown>, environment: Deployed): string | undefined {
  const where = `Put "${environment}" in env.${environment}.vars of wrangler.jsonc.`;
  const value = vars.ENVIRONMENT;
  if (value === undefined) return `ENVIRONMENT is not set. ${where}`;
  return value === environment ? undefined : `ENVIRONMENT is ${quoted(value)}, but the build is for ${environment}. ${where}`;
}

/**
 * The problem with a data API URL that `urlProblem` found nothing wrong with, so that it is an https URL: it must be the environment's own, on its origin
 * and with no path (`new URL` gives an origin without the default port, in lower case).
 */
function dataApiProblem(name: string, value: string, network: (typeof NETWORKS)[number], environment: Deployed): string | undefined {
  const wanted = DEPLOYED[environment].dataApi[network.dataApi];
  const url = new URL(value);
  if (url.origin === wanted && (url.pathname === "" || url.pathname === "/")) return undefined;
  return `${name} is ${quoted(value)}, but the ${environment} data API of ${network.name} is ${wanted}. Put it in env.${environment}.vars of wrangler.jsonc.`;
}

/**
 * The problem with a node URL that `urlProblem` found nothing wrong with, if its host is a public node the guard knows (`KNOWN_NODES`): it must be a node of
 * this variable's own network, and of the kind of network the environment shows. Any other host passes.
 */
function nodeProblem(name: string, value: string, network: (typeof NETWORKS)[number], environment: Deployed): string | undefined {
  // `new URL` lower-cases the host; a name may end in a dot.
  const host = new URL(value).hostname.replace(/\.$/, "");
  if (!Object.hasOwn(KNOWN_NODES, host)) return undefined;
  const node = KNOWN_NODES[host]!;
  const kind = DEPLOYED[environment].kind;
  const wanted = LABELS[network.network][kind];
  const of = LABELS[node.network][node.kind];
  const put = `Put a node of ${wanted} in env.${environment}.vars of wrangler.jsonc.`;
  if (node.network !== network.network) return `${name} names ${host}, a node of ${of}, not of ${network.name}. ${put}`;
  if (node.kind !== kind) {
    const shows = environment === "sandbox" ? "the sandbox" : environment;
    return `${name} names ${host}, a node of ${of}, but ${shows} shows ${wanted}. ${put}`;
  }
  return undefined;
}

/**
 * The reasons the routes of the build are not exactly `[{ "pattern": <the environment's host>, "custom_domain": true }]`: none; a route to another
 * pattern (each one, beside the right route too); the host as a route that is not a custom domain (a bare string is not one). `routes` is the build's,
 * as the Vite plugin wrote them into build/server/wrangler.json; a value that is not a list is taken as one route, so that it is refused for what it says.
 */
function routeProblems(routes: unknown, environment: Deployed): string[] {
  const { host } = DEPLOYED[environment];
  const add = `add "routes": [{ "pattern": "${host}", "custom_domain": true }] to env.${environment} of wrangler.jsonc`;
  const list: unknown[] = Array.isArray(routes) ? routes : routes === undefined || routes === null ? [] : [routes];
  if (list.length === 0) return [`the build has no route for ${host}: ${add}`];
  return list.flatMap((route) => {
    const pattern = typeof route === "string" ? route : isObject(route) ? route.pattern : undefined;
    if (pattern !== host) {
      return [`the build has a route to ${typeof pattern === "string" ? pattern : quoted(route)}, which is not ${host}: ${add}`];
    }
    return isObject(route) && route.custom_domain === true ? [] : [`the route to ${host} is not a custom domain: ${add}`];
  });
}

/**
 * Every reason the config of a build must not be deployed as the Worker of `asked`; empty when it may be. `config` is whatever the build file
 * parsed to, `asked` whatever the command was given: neither is trusted. `routes` are the build's routes, which are `config.routes` unless a caller gives
 * others (the Vite plugin writes them into the build file, so `checkBuild` gives none).
 */
export function deployProblems(config: unknown, asked: unknown, routes: unknown = isObject(config) ? config.routes : undefined): string[] {
  const problems: string[] = [];
  const environments = ENVIRONMENTS.join(" or ");
  const known = typeof asked === "string" && (ENVIRONMENTS as readonly string[]).includes(asked);
  if (!known) problems.push(`the environment to deploy is ${quoted(asked)}; it must be ${environments}`);
  if (!isObject(config)) {
    problems.push(`the build's config is ${quoted(config)}, not an object`);
    return problems;
  }

  const target = config.targetEnvironment;
  if (typeof target !== "string" || target === "") {
    problems.push(
      `the build is not for an environment (it has no targetEnvironment: it is the top level of wrangler.jsonc, local development)` +
        (known ? `; build with CLOUDFLARE_ENV=${asked}` : ""),
    );
  } else if (known && target !== asked) {
    problems.push(`the build is for the environment ${quoted(target)}, but ${quoted(asked)} was asked for; build with CLOUDFLARE_ENV=${asked}`);
  }

  const vars = isObject(config.vars) ? config.vars : {};
  const environment = known ? String(asked) : "<env>";
  const urlsFine = new Set<string>();
  for (const name of UPSTREAM_VARS) {
    const problem = urlProblem(name, vars[name], environment);
    if (problem) problems.push(problem);
    else urlsFine.add(name);
  }

  // The switches: a Worker variable each, "on" or "off", in every environment; then the ones that must not be on together with another off.
  problems.push(...switchProblems(vars, environment), ...crossSwitchProblems(vars));

  // Reachable on <name>.<subdomain>.workers.dev, the Worker would be a second site that renders every request and calls the data API
  // (the Cache API does nothing there). Both must be false in the build, not merely not true.
  for (const name of ["workers_dev", "preview_urls"] as const) {
    if (config[name] !== false) {
      problems.push(`${name} is ${quoted(config[name])} in the build; it must be false (env.${environment} of wrangler.jsonc), so that the Worker is served from its own host only`);
    }
  }

  // What the deployed environment must be, after all the rules above: the environment's own name, data APIs, kind of nodes and custom domain, so that a
  // build wired to the other environment is refused. An upstream URL that was refused above is not judged again. For an environment that is not known
  // there is nothing to compare with, and the reason is the first one.
  if (known) {
    const deployed = asked as Deployed;
    const problem = environmentProblem(vars, deployed);
    if (problem) problems.push(problem);
    for (const network of NETWORKS) {
      const value = vars[network.dataApi];
      const wrong = urlsFine.has(network.dataApi) && typeof value === "string" ? dataApiProblem(network.dataApi, value, network, deployed) : undefined;
      if (wrong) problems.push(wrong);
    }
    for (const network of NETWORKS) {
      const value = vars[network.node];
      const wrong = urlsFine.has(network.node) && typeof value === "string" ? nodeProblem(network.node, value, network, deployed) : undefined;
      if (wrong) problems.push(wrong);
    }
    problems.push(...routeProblems(routes, deployed));
  }
  return problems;
}

export interface BuildCheck {
  problems: string[];
  /** What was checked, for the line that says it passed. */
  summary: string;
}

/** The path `wrangler deploy` is sent to by the redirect below `root`, or a reason it is not sent anywhere. */
function redirectTarget(root: string): { target: string } | { problem: string } {
  const file = join(root, DEPLOY_REDIRECT);
  const missing = `${DEPLOY_REDIRECT.replaceAll("\\", "/")} is not there or does not name a config, so wrangler deploy would not deploy ${BUILT_CONFIG.replaceAll("\\", "/")}`;
  if (!existsSync(file)) return { problem: missing };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { problem: missing };
  }
  if (!isObject(parsed) || typeof parsed.configPath !== "string" || parsed.configPath === "") return { problem: missing };
  return { target: resolve(dirname(file), parsed.configPath) };
}

/** The same file by its real path (a link, a path with `..`), or the path as it is when it cannot be resolved. */
function realOrSame(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * `deployProblems` for the build below `root`: reads build/server/wrangler.json, and checks that `.wrangler/deploy/config.json` sends
 * `wrangler deploy` to that very file.
 */
export function checkBuild(root: string, asked: unknown): BuildCheck {
  const built = join(root, BUILT_CONFIG);
  const shown = BUILT_CONFIG.replaceAll("\\", "/");
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(built, "utf8"));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      problems: [missing ? `there is no build: ${shown} does not exist (build with CLOUDFLARE_ENV=${String(asked)} react-router build)` : `${shown} cannot be read as JSON`],
      summary: "",
    };
  }

  const problems = deployProblems(config, asked);
  const redirect = redirectTarget(root);
  if ("problem" in redirect) problems.push(redirect.problem);
  else if (realOrSame(redirect.target) !== realOrSame(built)) {
    problems.push(`wrangler deploy would be sent to ${redirect.target} (${DEPLOY_REDIRECT.replaceAll("\\", "/")}), not to ${shown}`);
  }

  // Said only of a build that passed, which is for an environment that is known.
  if (problems.length > 0 || typeof asked !== "string" || !Object.hasOwn(DEPLOYED, asked)) return { problems, summary: "" };
  const environment = asked as Deployed;
  const name = isObject(config) && typeof config.name === "string" ? config.name : "?";
  const shows = DEPLOYED[environment].kind === "testnet" ? "XRPL Testnet and Xahau Testnet" : "XRPL and Xahau";
  const upstreams = environment === "sandbox" ? "the sandbox's" : "production's";
  return {
    problems,
    summary:
      `${shown} is the Worker ${name} for ${environment} (${shows}) on ${DEPLOYED[environment].host}; ` +
      `its upstreams are ${upstreams}, every switch is on or off, and it is not served from workers.dev`,
  };
}
