import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { unstable_readConfig } from "wrangler";

import { FEATURE_VARS } from "../app/ui/features";
import { allSwitches } from "../test/support/switches";
import { checkBuild, DEPLOYED, deployProblems, KNOWN_NODES } from "./predeploy-guard";

// The guard that stands between `react-router build` and `wrangler deploy` (README, "The pipeline and deploying"). It reads the config the
// Cloudflare Vite plugin wrote for the build (build/server/wrangler.json) and refuses a deploy that would publish placeholder upstream hosts,
// plain-http upstreams, a Worker that is reachable on workers.dev, an environment other than the one asked for, or one wired to the other
// environment (its ENVIRONMENT, data APIs, nodes or route). These are fake configs: nothing here deploys.

type Config = Record<string, unknown>;

type Environment = keyof typeof DEPLOYED;

/** The nodes each deployed environment names (Global Constraints of the plan, spec 1): Ripple's testnet Clio and Xahau Testnet's node, or the mainnet ones. */
const NODE_URLS = {
  sandbox: { XRPL_NODE_URL: "https://clio.altnet.rippletest.net:51234/", XAHAU_NODE_URL: "https://xahau-test.net/" },
  production: { XRPL_NODE_URL: "https://s1.ripple.com:51234/", XAHAU_NODE_URL: "https://xahau.network/" },
} as const;

/** What the plugin writes for a build with `CLOUDFLARE_ENV=<env>`, as far as the guard reads it: the environment's own host, data APIs, nodes and route. */
function good(env: Environment = "sandbox", overrides: Config = {}): Config {
  return {
    name: `x-explorer-${env}`,
    targetEnvironment: env,
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: DEPLOYED[env].host, custom_domain: true }],
    vars: {
      ENVIRONMENT: env,
      ...DEPLOYED[env].dataApi,
      ...NODE_URLS[env],
      ...allSwitches("off"),
      BUILD_ID: "abc1234",
    },
    ...overrides,
  };
}

/** `good` with some of its vars replaced. */
function withVars(vars: Record<string, unknown>, env: Environment = "sandbox"): Config {
  return good(env, { vars: { ...(good(env).vars as Config), ...vars } });
}

/** `good` without the vars named. */
function withoutVars(names: string[], env: Environment = "sandbox"): Config {
  const vars = { ...(good(env).vars as Config) };
  for (const name of names) delete vars[name];
  return good(env, { vars });
}

/** The instruction every route reason ends with. */
const addRoute = (env: Environment) =>
  `add "routes": [{ "pattern": "${DEPLOYED[env].host}", "custom_domain": true }] to env.${env} of wrangler.jsonc`;

describe("deployProblems", () => {
  it("passes the config of each deployed environment", () => {
    expect(deployProblems(good("sandbox"), "sandbox")).toEqual([]);
    expect(deployProblems(good("production"), "production")).toEqual([]);
  });

  // The table the rules read, pinned to the plan's (spec 1 and 4): good() is built from it, so only a literal copy can notice a slip in it.
  it("knows the host, the data APIs and the kind of network of each deployed environment", () => {
    expect(DEPLOYED).toEqual({
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
    });
  });

  it("knows the public nodes by host, with their network and kind", () => {
    const hosts = (network: string, kind: string) =>
      Object.entries(KNOWN_NODES)
        .filter(([, node]) => node.network === network && node.kind === kind)
        .map(([host]) => host)
        .sort();
    expect(hosts("xrpl", "mainnet")).toEqual(["s1.ripple.com", "s2.ripple.com", "xrpl.ws", "xrplcluster.com"]);
    expect(hosts("xahau", "mainnet")).toEqual(["xahau.network"]);
    expect(hosts("xrpl", "testnet")).toEqual(["clio.altnet.rippletest.net", "s.altnet.rippletest.net", "testnet.xrpl-labs.com"]);
    expect(hosts("xahau", "testnet")).toEqual(["xahau-test.net"]);
    expect(Object.keys(KNOWN_NODES)).toHaveLength(9);
  });

  describe("the upstream URLs", () => {
    it.each(["XRPL_DATA_API_URL", "XAHAU_DATA_API_URL", "XRPL_NODE_URL", "XAHAU_NODE_URL"])("refuses a placeholder in %s, and names it", (name) => {
      const problems = deployProblems(withVars({ [name]: `https://${name.toLowerCase()}.example.invalid` }), "sandbox");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(name);
      expect(problems[0]).toContain(".invalid");
    });

    it.each([
      "https://xrpl.data.example.invalid",
      "https://xrpl.data.example.invalid/",
      "https://xrpl.data.example.invalid:8443/v2",
      "https://XRPL.DATA.EXAMPLE.INVALID",
      "https://xrpl.data.example.invalid.",
      "https://invalid",
      "https://user:pass@host.invalid/",
    ])("refuses the placeholder %s", (url) => {
      expect(deployProblems(withVars({ XRPL_DATA_API_URL: url }), "sandbox")).toHaveLength(1);
    });

    // A node of a host the guard does not know (GateHub's own) is not judged by the environment rules, so what remains is the placeholder rule.
    it("does not take a real host that only mentions invalid for a placeholder", () => {
      expect(deployProblems(withVars({ XRPL_NODE_URL: "https://invalid.example.com/" }), "sandbox")).toEqual([]);
      expect(deployProblems(withVars({ XRPL_NODE_URL: "https://notinvalid.com" }), "sandbox")).toEqual([]);
    });

    it.each(["http://xrpl.data.example.com", "ftp://xrpl.data.example.com", "wss://xrpl.data.example.com", "xrpl.data.example.com", "//xrpl.data.example.com", "not a url", ""])(
      "refuses %j, which is not an https URL",
      (url) => {
        const problems = deployProblems(withVars({ XRPL_NODE_URL: url }), "sandbox");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("XRPL_NODE_URL");
      },
    );

    it.each([undefined, null, 443, true, {}, ["https://xrpl.data.example.com"]])("refuses %j, which is not a string", (value) => {
      const problems = deployProblems(withVars({ XAHAU_NODE_URL: value }), "sandbox");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("XAHAU_NODE_URL");
    });

    it("refuses a var that is missing, and a config with no vars at all", () => {
      const vars = { ...(good().vars as Config) };
      delete vars.XAHAU_DATA_API_URL;
      expect(deployProblems(good("sandbox", { vars }), "sandbox")).toHaveLength(1);
      const { vars: _gone, ...bare } = good();
      expect(deployProblems(bare, "sandbox").length).toBeGreaterThanOrEqual(4);
      expect(deployProblems(good("sandbox", { vars: "x" }), "sandbox").length).toBeGreaterThanOrEqual(4);
    });

    it("says every problem at once", () => {
      const problems = deployProblems(
        withVars({ XRPL_DATA_API_URL: "https://a.example.invalid", XAHAU_DATA_API_URL: "http://b.example.com", XRPL_NODE_URL: "https://c.invalid" }),
        "sandbox",
      );
      expect(problems).toHaveLength(3);
    });
  });

  // The switches (spec 6.1, README "Switches"): a Worker variable each, "on" or "off", in every environment. A build with one missing,
  // misspelt as a value or set under a wrong name would serve the other page than the one the owner decided on.
  describe("the switches", () => {
    it("passes a build whose switches are each on or off, whichever", () => {
      expect(deployProblems(withVars(allSwitches("on")), "sandbox")).toEqual([]);
      expect(deployProblems(withVars({ ...allSwitches("off"), [FEATURE_VARS[0]]: "on" }, "production"), "production")).toEqual([]);
    });

    it.each(FEATURE_VARS)("refuses %s missing, and names it", (name) => {
      const vars = { ...(good().vars as Config) };
      delete vars[name];
      const problems = deployProblems(good("sandbox", { vars }), "sandbox");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(name);
      expect(problems[0]).toContain('"on" or "off"');
    });

    it.each(["yes", "ON", "On", "true", "1", "", " on", "on ", true, 1, null, {}])("refuses the value %j of a switch", (value) => {
      for (const name of FEATURE_VARS) {
        const problems = deployProblems(withVars({ [name]: value }), "sandbox");
        expect(problems, name).toHaveLength(1);
        expect(problems[0]).toContain(name);
        expect(problems[0]).toContain('"on" or "off"');
      }
    });

    it('refuses a var that is not a switch but is "on" or "off", which is a misspelt switch', () => {
      for (const value of ["on", "off"]) {
        const problems = deployProblems(withVars({ MARKET: value }), "sandbox");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("MARKET");
        expect(problems[0]).toContain('"on" or "off"');
        expect(problems[0]).toContain("not a switch");
        expect(problems[0]).toContain(`the switches are ${FEATURE_VARS.join(", ")}`);
        expect(problems[0]).toContain("a misspelt one?");
      }
    });

    // MARKETS (E3): a sandbox or production build must say it, and say it right.
    describe("MARKETS", () => {
      it("passes a build whose MARKETS is on or off", () => {
        expect(deployProblems(withVars({ MARKETS: "on" }), "sandbox")).toEqual([]);
        expect(deployProblems(withVars({ MARKETS: "off" }, "production"), "production")).toEqual([]);
      });

      it("refuses a build without MARKETS, and names it", () => {
        const vars = { ...(good().vars as Config) };
        delete vars.MARKETS;
        const problems = deployProblems(good("sandbox", { vars }), "sandbox");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("MARKETS is not set");
        expect(problems[0]).toContain('"on" or "off"');
      });

      it('refuses MARKETS: "yes"', () => {
        const problems = deployProblems(withVars({ MARKETS: "yes" }, "production"), "production");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("MARKETS");
        expect(problems[0]).toContain('"yes"');
        expect(problems[0]).toContain('not exactly "on" or "off"');
      });

      it('refuses a misspelt MARKET: "on" as a var that is not a switch, naming MARKETS among the switches', () => {
        const problems = deployProblems(withVars({ MARKET: "on" }), "sandbox");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("MARKET is");
        expect(problems[0]).toContain("not a switch");
        expect(problems[0]).toContain("MARKETS");
        expect(problems[0]).toContain("a misspelt one?");
      });

      it("refuses a build with MARKETS missing and MARKET set instead, with both reasons", () => {
        const vars: Config = { ...(good().vars as Config), MARKET: "on" };
        delete vars.MARKETS;
        const problems = deployProblems(good("sandbox", { vars }), "sandbox");
        expect(problems).toHaveLength(2);
        expect(problems[0]).toContain("MARKETS is not set");
        expect(problems[1]).toContain("MARKET is");
      });
    });

    // ACCOUNT_ANALYTICS (E4): the account page's Analytics tab. A sandbox or production build must say it, and say it right.
    describe("ACCOUNT_ANALYTICS", () => {
      it("passes a build whose ACCOUNT_ANALYTICS is on or off, and the passing configs carry it", () => {
        expect((good("sandbox").vars as Config).ACCOUNT_ANALYTICS).toBe("off");
        expect((good("production").vars as Config).ACCOUNT_ANALYTICS).toBe("off");
        expect(deployProblems(withVars({ ACCOUNT_ANALYTICS: "on" }), "sandbox")).toEqual([]);
        expect(deployProblems(withVars({ ACCOUNT_ANALYTICS: "off" }, "production"), "production")).toEqual([]);
      });

      it("refuses a build without ACCOUNT_ANALYTICS, and names it", () => {
        const vars = { ...(good().vars as Config) };
        delete vars.ACCOUNT_ANALYTICS;
        const problems = deployProblems(good("sandbox", { vars }), "sandbox");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("ACCOUNT_ANALYTICS is not set");
        expect(problems[0]).toContain('"on" or "off"');
      });

      it('refuses ACCOUNT_ANALYTICS: "yes", and names it', () => {
        const problems = deployProblems(withVars({ ACCOUNT_ANALYTICS: "yes" }, "production"), "production");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("ACCOUNT_ANALYTICS");
        expect(problems[0]).toContain('"yes"');
        expect(problems[0]).toContain('not exactly "on" or "off"');
      });

      it('refuses a misspelt ACCOUNT_ANALYTIC: "on" as a var that is not a switch, naming ACCOUNT_ANALYTICS among the switches', () => {
        const problems = deployProblems(withVars({ ACCOUNT_ANALYTIC: "on" }), "sandbox");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("ACCOUNT_ANALYTIC is");
        expect(problems[0]).toContain("not a switch");
        expect(problems[0]).toContain("ACCOUNT_ANALYTICS");
        expect(problems[0]).toContain("a misspelt one?");
      });
    });

    // AMM_PAGES (E5): the AMM pool pages. A sandbox or production build must say it, say it right, and never have the pages on over data that is off.
    describe("AMM_PAGES", () => {
      const NEEDS_DATA = "AMM_PAGES is on but AMM_DATA is off: the AMM pages need the AMM data";

      it("passes a build whose AMM_PAGES is off or on, and the passing configs carry it, off", () => {
        expect((good("sandbox").vars as Config).AMM_PAGES).toBe("off");
        expect((good("production").vars as Config).AMM_PAGES).toBe("off");
        expect(deployProblems(good("sandbox"), "sandbox")).toEqual([]);
        expect(deployProblems(withVars(allSwitches("on")), "sandbox")).toEqual([]);
        expect(deployProblems(withVars(allSwitches("on"), "production"), "production")).toEqual([]);
        expect(deployProblems(withVars({ AMM_PAGES: "off" }, "production"), "production")).toEqual([]);
      });

      it("refuses a build without AMM_PAGES, and names it", () => {
        const vars = { ...(good().vars as Config) };
        delete vars.AMM_PAGES;
        const problems = deployProblems(good("sandbox", { vars }), "sandbox");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("AMM_PAGES is not set");
        expect(problems[0]).toContain('"on" or "off"');
      });

      it('refuses AMM_PAGES: "yes", and names it', () => {
        const problems = deployProblems(withVars({ AMM_PAGES: "yes" }, "production"), "production");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("AMM_PAGES");
        expect(problems[0]).toContain('"yes"');
        expect(problems[0]).toContain('not exactly "on" or "off"');
      });

      it('refuses a misspelt AMM_PAGE: "on" as a var that is not a switch, naming AMM_PAGES among the switches', () => {
        const problems = deployProblems(withVars({ AMM_PAGE: "on" }), "sandbox");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("AMM_PAGE is");
        expect(problems[0]).toContain("not a switch");
        expect(problems[0]).toContain("AMM_PAGES");
        expect(problems[0]).toContain("a misspelt one?");
      });

      // Spec 10: AMM_PAGES goes on in an environment only once AMM_DATA is on there. The pages are all AMM data.
      it.each(["sandbox", "production"] as const)("refuses AMM_PAGES on with AMM_DATA off in %s, with that reason alone", (env) => {
        expect(deployProblems(withVars({ AMM_PAGES: "on", AMM_DATA: "off" }, env), env)).toEqual([NEEDS_DATA]);
      });

      it("accepts AMM_PAGES on with AMM_DATA on, and AMM_PAGES off with AMM_DATA either way", () => {
        expect(deployProblems(withVars({ AMM_PAGES: "on", AMM_DATA: "on" }), "sandbox")).toEqual([]);
        expect(deployProblems(withVars({ AMM_PAGES: "off", AMM_DATA: "on" }), "sandbox")).toEqual([]);
        expect(deployProblems(withVars({ AMM_PAGES: "off", AMM_DATA: "off" }), "sandbox")).toEqual([]);
      });

      it("gives the reason after the switches' own, when AMM_DATA is missing or is not on or off, and only for AMM_PAGES exactly on", () => {
        const vars: Config = { ...(good().vars as Config), AMM_PAGES: "on" };
        delete vars.AMM_DATA;
        const missing = deployProblems(good("sandbox", { vars }), "sandbox");
        expect(missing).toHaveLength(2);
        expect(missing[0]).toContain("AMM_DATA is not set");
        expect(missing[1]).toBe(NEEDS_DATA);

        const yes = deployProblems(withVars({ AMM_PAGES: "on", AMM_DATA: "yes" }), "sandbox");
        expect(yes).toHaveLength(2);
        expect(yes[0]).toContain("AMM_DATA");
        expect(yes[1]).toBe(NEEDS_DATA);

        // AMM_PAGES that is not exactly "on" is refused for itself, and does not claim the pages are on.
        for (const value of ["ON", "yes", true]) {
          const problems = deployProblems(withVars({ AMM_PAGES: value, AMM_DATA: "off" }), "sandbox");
          expect(problems, String(value)).toHaveLength(1);
          expect(problems[0]).not.toBe(NEEDS_DATA);
        }
      });
    });

    it("lets a var that is not a switch have any other value", () => {
      expect(deployProblems(withVars({ SENTRY_DSN: "", SOMETHING: "ON", OTHER: 3, YES: "yes" }), "sandbox")).toEqual([]);
    });

    it("says every problem at once, in the order: missing, not on or off, not a switch", () => {
      const vars: Config = { ...(good().vars as Config), ...allSwitches("off"), VALIDATORS: "yes", MARKET: "on" };
      delete vars.AMM_DATA;
      const problems = deployProblems(good("sandbox", { vars }), "sandbox");
      expect(problems).toHaveLength(3);
      expect(problems[0]).toContain("AMM_DATA");
      expect(problems[1]).toContain("VALIDATORS");
      expect(problems[2]).toContain("MARKET");
    });

    it("refuses every switch of a config with no vars at all", () => {
      const { vars: _gone, ...bare } = good();
      const problems = deployProblems(bare, "sandbox").join("\n");
      for (const name of FEATURE_VARS) expect(problems).toContain(name);
    });
  });

  describe("the environment", () => {
    // A build of the other environment is wired to it as well (its ENVIRONMENT, data APIs, nodes and route), so it has more than this one reason: "the other
    // environment" below says all of them.
    it("refuses a build for another environment than the one asked for", () => {
      const problems = deployProblems(good("production"), "sandbox");
      expect(problems).toContain('the build is for the environment "production", but "sandbox" was asked for; build with CLOUDFLARE_ENV=sandbox');
      expect(problems.length).toBeGreaterThanOrEqual(1);
      expect(deployProblems(good("sandbox"), "production")).toContain(
        'the build is for the environment "sandbox", but "production" was asked for; build with CLOUDFLARE_ENV=production',
      );
    });

    it("refuses a build that is for no environment (the top level's config, which is local development)", () => {
      const { targetEnvironment: _none, ...topLevel } = good("sandbox", { name: "x-explorer" });
      const problems = deployProblems(topLevel, "sandbox");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("CLOUDFLARE_ENV=sandbox");
      expect(deployProblems(good("sandbox", { targetEnvironment: null }), "sandbox")).toHaveLength(1);
      expect(deployProblems(good("sandbox", { targetEnvironment: "" }), "sandbox")).toHaveLength(1);
    });

    it.each(["", "prod", "Sandbox", "SANDBOX", "development", "sandbox ", "stag" + "ing", undefined])("refuses to be asked for %j", (asked) => {
      const problems = deployProblems(good("sandbox"), asked as string);
      expect(problems.length).toBeGreaterThanOrEqual(1);
      expect(problems.join("\n")).toContain("sandbox or production");
    });
  });

  describe("workers.dev", () => {
    it.each([{ workers_dev: true }, { workers_dev: undefined }, { workers_dev: "false" }, { workers_dev: 0 }])("refuses %j", (change) => {
      const problems = deployProblems(good("sandbox", change), "sandbox");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("workers_dev");
    });

    it.each([{ preview_urls: true }, { preview_urls: undefined }, { preview_urls: "false" }])("refuses %j", (change) => {
      const problems = deployProblems(good("sandbox", change), "sandbox");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("preview_urls");
    });
  });

  // What each deployed environment must be (spec 4): its ENVIRONMENT, its data APIs, the kind and the network of its nodes, its route. Every reason is printed,
  // after the older rules' own. The messages are the owner's only help at a refused deploy, so they are pinned whole.
  describe("ENVIRONMENT", () => {
    it.each([
      [undefined, 'ENVIRONMENT is not set. Put "sandbox" in env.sandbox.vars of wrangler.jsonc.'],
      ["production", 'ENVIRONMENT is "production", but the build is for sandbox. Put "sandbox" in env.sandbox.vars of wrangler.jsonc.'],
    ])("refuses ENVIRONMENT %j, with that reason alone", (value, reason) => {
      expect(deployProblems(withVars({ ENVIRONMENT: value }), "sandbox")).toEqual([reason]);
    });

    it("refuses a build without ENVIRONMENT, and one that is for production but says sandbox", () => {
      expect(deployProblems(withoutVars(["ENVIRONMENT"], "production"), "production")).toEqual([
        'ENVIRONMENT is not set. Put "production" in env.production.vars of wrangler.jsonc.',
      ]);
      expect(deployProblems(withVars({ ENVIRONMENT: "sandbox" }, "production"), "production")).toEqual([
        'ENVIRONMENT is "sandbox", but the build is for production. Put "production" in env.production.vars of wrangler.jsonc.',
      ]);
    });

    it.each(["development", "Sandbox", "sandbox ", "", "stag" + "ing", 7, null, true])("refuses the value %j, quoted as it is", (value) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      expect(deployProblems(withVars({ ENVIRONMENT: value }), "sandbox")).toEqual([
        `ENVIRONMENT is ${JSON.stringify(text)}, but the build is for sandbox. Put "sandbox" in env.sandbox.vars of wrangler.jsonc.`,
      ]);
    });

    it("cuts a long value short", () => {
      const problems = deployProblems(withVars({ ENVIRONMENT: "x".repeat(200) }), "sandbox");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`"${"x".repeat(80)}…"`);
      expect(problems[0]).not.toContain("x".repeat(81));
    });
  });

  describe("the data APIs", () => {
    it("refuses the data API of the other environment, and one with a path", () => {
      expect(deployProblems(withVars({ XRPL_DATA_API_URL: "https://xrpl.data.gatehub.net" }), "sandbox")).toEqual([
        'XRPL_DATA_API_URL is "https://xrpl.data.gatehub.net", but the sandbox data API of XRPL is https://xrpl.data.sandbox.gatehub.net. Put it in env.sandbox.vars of wrangler.jsonc.',
      ]);
      expect(deployProblems(withVars({ XAHAU_DATA_API_URL: "https://xahau.data.sandbox.gatehub.net" }, "production"), "production")).toEqual([
        'XAHAU_DATA_API_URL is "https://xahau.data.sandbox.gatehub.net", but the production data API of Xahau is https://xahau.data.gatehub.net. Put it in env.production.vars of wrangler.jsonc.',
      ]);
      expect(deployProblems(withVars({ XRPL_DATA_API_URL: "https://xrpl.data.sandbox.gatehub.net/v2" }), "sandbox")).toEqual([
        'XRPL_DATA_API_URL is "https://xrpl.data.sandbox.gatehub.net/v2", but the sandbox data API of XRPL is https://xrpl.data.sandbox.gatehub.net. Put it in env.sandbox.vars of wrangler.jsonc.',
      ]);
    });

    it.each(["https://xrpl.data.sandbox.gatehub.net", "https://xrpl.data.sandbox.gatehub.net/", "https://XRPL.data.sandbox.gatehub.net/", "https://xrpl.data.sandbox.gatehub.net:443/"])(
      "passes %s, which is the origin with no path",
      (url) => {
        expect(deployProblems(withVars({ XRPL_DATA_API_URL: url }), "sandbox")).toEqual([]);
      },
    );

    it.each([
      "https://xrpl.data.sandbox.gatehub.net:8443/",
      "https://xrpl.data.sandbox.gatehub.net.evil.example/",
      "https://data.sandbox.gatehub.net/",
      "https://xahau.data.sandbox.gatehub.net/",
      "https://xrpl.data.example.com/",
    ])("refuses %s, which is not the sandbox data API of XRPL", (url) => {
      const problems = deployProblems(withVars({ XRPL_DATA_API_URL: url }), "sandbox");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("but the sandbox data API of XRPL is https://xrpl.data.sandbox.gatehub.net.");
    });

    it("says nothing more about a data API that the older rules already refused", () => {
      for (const url of ["https://xrpl.data.example.invalid", "http://xrpl.data.sandbox.gatehub.net", "not a url", ""]) {
        const problems = deployProblems(withVars({ XRPL_DATA_API_URL: url }), "sandbox");
        expect(problems, url).toHaveLength(1);
        expect(problems[0], url).not.toContain("data API of XRPL");
      }
      expect(deployProblems(withoutVars(["XAHAU_DATA_API_URL"]), "sandbox")).toHaveLength(1);
    });
  });

  describe("the nodes", () => {
    it("refuses a node of the other kind, both ways", () => {
      expect(deployProblems(withVars({ XRPL_NODE_URL: "https://s1.ripple.com:51234/" }), "sandbox")).toEqual([
        'XRPL_NODE_URL names s1.ripple.com, a node of XRPL mainnet, but the sandbox shows XRPL Testnet. Put a node of XRPL Testnet in env.sandbox.vars of wrangler.jsonc.',
      ]);
      expect(deployProblems(withVars({ XRPL_NODE_URL: "https://clio.altnet.rippletest.net:51234/" }, "production"), "production")).toEqual([
        'XRPL_NODE_URL names clio.altnet.rippletest.net, a node of XRPL Testnet, but production shows XRPL mainnet. Put a node of XRPL mainnet in env.production.vars of wrangler.jsonc.',
      ]);
      expect(deployProblems(withVars({ XAHAU_NODE_URL: "https://xahau.network/" }), "sandbox")).toEqual([
        'XAHAU_NODE_URL names xahau.network, a node of Xahau mainnet, but the sandbox shows Xahau Testnet. Put a node of Xahau Testnet in env.sandbox.vars of wrangler.jsonc.',
      ]);
      expect(deployProblems(withVars({ XAHAU_NODE_URL: "https://xahau-test.net/" }, "production"), "production")).toEqual([
        'XAHAU_NODE_URL names xahau-test.net, a node of Xahau Testnet, but production shows Xahau mainnet. Put a node of Xahau mainnet in env.production.vars of wrangler.jsonc.',
      ]);
    });

    it("refuses a node of the other network", () => {
      expect(deployProblems(withVars({ XAHAU_NODE_URL: "https://clio.altnet.rippletest.net:51234/" }), "sandbox")).toEqual([
        'XAHAU_NODE_URL names clio.altnet.rippletest.net, a node of XRPL Testnet, not of Xahau. Put a node of Xahau Testnet in env.sandbox.vars of wrangler.jsonc.',
      ]);
      expect(deployProblems(withVars({ XRPL_NODE_URL: "https://xahau.network/" }, "production"), "production")).toEqual([
        'XRPL_NODE_URL names xahau.network, a node of Xahau mainnet, not of XRPL. Put a node of XRPL mainnet in env.production.vars of wrangler.jsonc.',
      ]);
    });

    it("gives the network as the reason when the node is of the other network and of the other kind", () => {
      expect(deployProblems(withVars({ XAHAU_NODE_URL: "https://s1.ripple.com:51234/" }), "sandbox")).toEqual([
        'XAHAU_NODE_URL names s1.ripple.com, a node of XRPL mainnet, not of Xahau. Put a node of Xahau Testnet in env.sandbox.vars of wrangler.jsonc.',
      ]);
    });

    it("passes every known node in the variable of its network, in the environment of its kind", () => {
      for (const [host, node] of Object.entries(KNOWN_NODES)) {
        const env: Environment = node.kind === "testnet" ? "sandbox" : "production";
        const own = node.network === "xrpl" ? "XRPL_NODE_URL" : "XAHAU_NODE_URL";
        const other = node.network === "xrpl" ? "XAHAU_NODE_URL" : "XRPL_NODE_URL";
        const otherEnv: Environment = env === "sandbox" ? "production" : "sandbox";
        expect(deployProblems(withVars({ [own]: `https://${host}/` }, env), env), host).toEqual([]);
        expect(deployProblems(withVars({ [own]: `https://${host}:51234/` }, env), env), `${host} with a port`).toEqual([]);
        expect(deployProblems(withVars({ [own]: `https://${host}/` }, otherEnv), otherEnv), `${host} in ${otherEnv}`).toHaveLength(1);
        expect(deployProblems(withVars({ [other]: `https://${host}/` }, env), env), `${host} as ${other}`).toHaveLength(1);
      }
    });

    it("reads the host as the URL does: any case, a trailing dot, a port, a path", () => {
      expect(deployProblems(withVars({ XRPL_NODE_URL: "https://S1.Ripple.COM./" }), "sandbox")).toHaveLength(1);
      expect(deployProblems(withVars({ XRPL_NODE_URL: "https://s1.ripple.com:443/some/path?x=1" }), "sandbox")).toHaveLength(1);
      expect(deployProblems(withVars({ XRPL_NODE_URL: "https://user:pass@s1.ripple.com/" }), "sandbox")).toHaveLength(1);
    });

    it("lets a node it does not know pass", () => {
      for (const name of ["XRPL_NODE_URL", "XAHAU_NODE_URL"]) {
        for (const env of ["sandbox", "production"] as const) {
          expect(deployProblems(withVars({ [name]: "https://node.gatehub.example/" }, env), env), `${name} in ${env}`).toEqual([]);
        }
      }
      // A name that is only a prefix, a suffix or a part of a known host is not that host; a name that Object has too is not in the table.
      for (const host of ["s1.ripple.com.example", "evil-s1.ripple.com", "ripple.com", "constructor", "toString", "__proto__"]) {
        expect(deployProblems(withVars({ XRPL_NODE_URL: `https://${host}/` }), "sandbox"), host).toEqual([]);
      }
    });

    it("says nothing more about a node that the older rules already refused", () => {
      for (const url of ["https://s1.ripple.com.invalid/", "http://s1.ripple.com:51234/", "s1.ripple.com", ""]) {
        const problems = deployProblems(withVars({ XRPL_NODE_URL: url }), "sandbox");
        expect(problems, url).toHaveLength(1);
        expect(problems[0], url).not.toContain("a node of");
      }
    });
  });

  describe("the route", () => {
    it("refuses no route, a route to the other host, and a route that is not a custom domain", () => {
      const none = `the build has no route for explorer.sandbox.gatehub.net: ${addRoute("sandbox")}`;
      const { routes: _gone, ...without } = good("sandbox");
      expect(deployProblems(without, "sandbox")).toEqual([none]);
      expect(deployProblems(good("sandbox", { routes: [] }), "sandbox")).toEqual([none]);
      expect(deployProblems(good("sandbox", { routes: null }), "sandbox")).toEqual([none]);

      expect(deployProblems(good("sandbox", { routes: [{ pattern: "explorer.gatehub.net", custom_domain: true }] }), "sandbox")).toEqual([
        `the build has a route to explorer.gatehub.net, which is not explorer.sandbox.gatehub.net: ${addRoute("sandbox")}`,
      ]);
      expect(deployProblems(good("production", { routes: [{ pattern: "explorer.sandbox.gatehub.net", custom_domain: true }] }), "production")).toEqual([
        `the build has a route to explorer.sandbox.gatehub.net, which is not explorer.gatehub.net: ${addRoute("production")}`,
      ]);

      const notCustom = `the route to explorer.sandbox.gatehub.net is not a custom domain: ${addRoute("sandbox")}`;
      expect(deployProblems(good("sandbox", { routes: [{ pattern: "explorer.sandbox.gatehub.net" }] }), "sandbox")).toEqual([notCustom]);
      expect(deployProblems(good("sandbox", { routes: [{ pattern: "explorer.sandbox.gatehub.net", custom_domain: false }] }), "sandbox")).toEqual([notCustom]);
      expect(deployProblems(good("sandbox", { routes: [{ pattern: "explorer.sandbox.gatehub.net", custom_domain: "true" }] }), "sandbox")).toEqual([notCustom]);
      expect(deployProblems(good("sandbox", { routes: ["explorer.sandbox.gatehub.net"] }), "sandbox")).toEqual([notCustom]);
    });

    it("refuses a route to a pattern of the host, a route beside the right one, and a route that is not a route", () => {
      for (const pattern of ["explorer.sandbox.gatehub.net/*", "*.sandbox.gatehub.net", "Explorer.Sandbox.Gatehub.Net", "sandbox.gatehub.net"]) {
        const problems = deployProblems(good("sandbox", { routes: [{ pattern, custom_domain: true }] }), "sandbox");
        expect(problems, pattern).toEqual([`the build has a route to ${pattern}, which is not explorer.sandbox.gatehub.net: ${addRoute("sandbox")}`]);
      }
      const right = { pattern: "explorer.sandbox.gatehub.net", custom_domain: true };
      expect(deployProblems(good("sandbox", { routes: [right, { pattern: "explorer.gatehub.net", custom_domain: true }] }), "sandbox")).toEqual([
        `the build has a route to explorer.gatehub.net, which is not explorer.sandbox.gatehub.net: ${addRoute("sandbox")}`,
      ]);
      expect(deployProblems(good("sandbox", { routes: ["explorer.gatehub.net/*"] }), "sandbox")).toHaveLength(1);
      for (const routes of [{}, "explorer.gatehub.net", 5, true, [{}], [5], [null], [{ zone_name: "gatehub.net" }]]) {
        expect(deployProblems(good("sandbox", { routes }), "sandbox").length, JSON.stringify(routes)).toBeGreaterThanOrEqual(1);
      }
    });

    it("passes the route with a zone as well, which a custom domain may name", () => {
      const route = { pattern: "explorer.sandbox.gatehub.net", custom_domain: true, zone_name: "gatehub.net" };
      expect(deployProblems(good("sandbox", { routes: [route] }), "sandbox")).toEqual([]);
    });

    it("reads the routes it is given, which are the config's when it is given none", () => {
      const { routes: _gone, ...without } = good("sandbox");
      expect(deployProblems(without, "sandbox", [{ pattern: "explorer.sandbox.gatehub.net", custom_domain: true }])).toEqual([]);
      expect(deployProblems(good("sandbox"), "sandbox", [])).toEqual([`the build has no route for explorer.sandbox.gatehub.net: ${addRoute("sandbox")}`]);
      expect(deployProblems(good("sandbox"), "sandbox", undefined)).toEqual([]);
    });
  });

  describe("a build wired to the other environment", () => {
    it("says every reason at once, after the older rules' own", () => {
      const problems = deployProblems(good("production"), "sandbox");
      expect(problems).toEqual([
        'the build is for the environment "production", but "sandbox" was asked for; build with CLOUDFLARE_ENV=sandbox',
        'ENVIRONMENT is "production", but the build is for sandbox. Put "sandbox" in env.sandbox.vars of wrangler.jsonc.',
        'XRPL_DATA_API_URL is "https://xrpl.data.gatehub.net", but the sandbox data API of XRPL is https://xrpl.data.sandbox.gatehub.net. Put it in env.sandbox.vars of wrangler.jsonc.',
        'XAHAU_DATA_API_URL is "https://xahau.data.gatehub.net", but the sandbox data API of Xahau is https://xahau.data.sandbox.gatehub.net. Put it in env.sandbox.vars of wrangler.jsonc.',
        'XRPL_NODE_URL names s1.ripple.com, a node of XRPL mainnet, but the sandbox shows XRPL Testnet. Put a node of XRPL Testnet in env.sandbox.vars of wrangler.jsonc.',
        'XAHAU_NODE_URL names xahau.network, a node of Xahau mainnet, but the sandbox shows Xahau Testnet. Put a node of Xahau Testnet in env.sandbox.vars of wrangler.jsonc.',
        `the build has a route to explorer.gatehub.net, which is not explorer.sandbox.gatehub.net: ${addRoute("sandbox")}`,
      ]);
      expect(deployProblems(good("sandbox"), "production")).toHaveLength(7);
    });

    it("puts the older rules first: a placeholder, a switch, workers.dev, then the new ones", () => {
      const problems = deployProblems(
        withVars({ XRPL_DATA_API_URL: "https://a.example.invalid", MARKETS: "yes", ENVIRONMENT: "production" }, "sandbox"),
        "sandbox",
      );
      expect(problems).toHaveLength(3);
      expect(problems[0]).toContain("XRPL_DATA_API_URL is a placeholder");
      expect(problems[1]).toContain("MARKETS");
      expect(problems[2]).toContain("ENVIRONMENT");
    });

    it("has no reason of the new kinds for an environment it does not know", () => {
      for (const asked of ["stag" + "ing", "development", undefined]) {
        const problems = deployProblems(good("sandbox"), asked);
        expect(problems.join("\n"), String(asked)).not.toMatch(/ENVIRONMENT|data API of|a node of|route/);
      }
    });
  });

  describe("a placeholder or a plain-http URL", () => {
    // One reason each, in each environment: the new rules do not say the same thing a second time.
    it.each(["sandbox", "production"] as const)("keeps one reason for each of the four URLs of %s", (env) => {
      for (const name of ["XRPL_DATA_API_URL", "XAHAU_DATA_API_URL", "XRPL_NODE_URL", "XAHAU_NODE_URL"]) {
        for (const url of [`https://${name.toLowerCase()}.example.invalid`, "http://node.gatehub.example/"]) {
          const problems = deployProblems(withVars({ [name]: url }, env), env);
          expect(problems, `${name} ${url}`).toHaveLength(1);
          expect(problems[0]).toContain(name);
        }
      }
    });
  });

  it.each([null, undefined, "config", 42, [], [good()]])("fails closed on a config that is %j", (config) => {
    expect(deployProblems(config, "sandbox").length).toBeGreaterThanOrEqual(1);
  });
});

// ---- The files -----------------------------------------------------------------------------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), "fw-predeploy-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let made = 0;
/** A project root in a directory of its own: a build, and the redirect `wrangler deploy` follows to it. */
function root({ config = good() as unknown, raw, redirect = "../../build/server/wrangler.json" as string | null }: { config?: unknown; raw?: string; redirect?: string | null } = {}) {
  const dir = join(scratch, `root-${++made}`);
  mkdirSync(join(dir, "build", "server"), { recursive: true });
  if (config !== null) writeFileSync(join(dir, "build", "server", "wrangler.json"), raw ?? JSON.stringify(config));
  if (redirect !== null) {
    mkdirSync(join(dir, ".wrangler", "deploy"), { recursive: true });
    writeFileSync(join(dir, ".wrangler", "deploy", "config.json"), JSON.stringify({ configPath: redirect, auxiliaryWorkers: [] }));
  }
  return dir;
}

describe("checkBuild", () => {
  it("passes a build whose config is for the environment asked for and which wrangler deploy will follow to", () => {
    const result = checkBuild(root(), "sandbox");
    expect(result.problems).toEqual([]);
    expect(result.summary).toContain("x-explorer-sandbox");
  });

  // The Vite plugin writes the environment's routes into build/server/wrangler.json (README, "The pipeline and deploying"), so checkBuild reads them there
  // and passes the guard no routes of its own.
  it("says what it checked", () => {
    expect(checkBuild(root(), "sandbox").summary).toBe(
      "build/server/wrangler.json is the Worker x-explorer-sandbox for sandbox (XRPL Testnet and Xahau Testnet) on explorer.sandbox.gatehub.net; " +
        "its upstreams are the sandbox's, every switch is on or off, and it is not served from workers.dev",
    );
    const production = checkBuild(root({ config: good("production") }), "production");
    expect(production.problems).toEqual([]);
    expect(production.summary).toBe(
      "build/server/wrangler.json is the Worker x-explorer-production for production (XRPL and Xahau) on explorer.gatehub.net; " +
        "its upstreams are production's, every switch is on or off, and it is not served from workers.dev",
    );
  });

  it("refuses a build whose route is another environment's, and one with no route", () => {
    const wrong = checkBuild(root({ config: good("sandbox", { routes: [{ pattern: "explorer.gatehub.net", custom_domain: true }] }) }), "sandbox").problems;
    expect(wrong).toEqual([`the build has a route to explorer.gatehub.net, which is not explorer.sandbox.gatehub.net: ${addRoute("sandbox")}`]);
    const { routes: _gone, ...without } = good("production");
    expect(checkBuild(root({ config: without }), "production").problems).toEqual([`the build has no route for explorer.gatehub.net: ${addRoute("production")}`]);
  });

  it("refuses a build with a switch missing", () => {
    const vars = { ...(good().vars as Config) };
    delete vars.AMM_DATA;
    const problems = checkBuild(root({ config: good("sandbox", { vars }) }), "sandbox").problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("AMM_DATA");
  });

  it("refuses a build with AMM_PAGES on over AMM_DATA off, and passes it with both on", () => {
    const refused = checkBuild(root({ config: withVars({ AMM_PAGES: "on", AMM_DATA: "off" }) }), "sandbox").problems;
    expect(refused).toEqual(["AMM_PAGES is on but AMM_DATA is off: the AMM pages need the AMM data"]);
    expect(checkBuild(root({ config: withVars({ AMM_PAGES: "on", AMM_DATA: "on" }) }), "sandbox").problems).toEqual([]);
  });

  it("refuses a build with a placeholder, and one for another environment", () => {
    expect(checkBuild(root({ config: withVars({ XRPL_DATA_API_URL: "https://x.example.invalid" }) }), "sandbox").problems).toHaveLength(1);
    const other = checkBuild(root({ config: good("production") }), "sandbox").problems;
    expect(other.length).toBeGreaterThanOrEqual(1);
    expect(other.join("\n")).toContain('the build is for the environment "production", but "sandbox" was asked for');
  });

  it("refuses when there is no build", () => {
    const problems = checkBuild(root({ config: null }), "sandbox").problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("build/server/wrangler.json");
  });

  it.each(["", "{", "null", "[]", "42", '"text"'])("refuses a build config that reads as %j", (raw) => {
    expect(checkBuild(root({ raw }), "sandbox").problems.length).toBeGreaterThanOrEqual(1);
  });

  // `wrangler deploy` takes the config from this redirect. Without it, or if it leads elsewhere, it would deploy wrangler.jsonc's top level
  // (the placeholders, and no environment), whatever the build file says.
  it("refuses when wrangler deploy would not be sent to this build", () => {
    const missing = checkBuild(root({ redirect: null }), "sandbox").problems;
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain(".wrangler/deploy/config.json");
    expect(checkBuild(root({ redirect: "../../build/other/wrangler.json" }), "sandbox").problems).toHaveLength(1);
    expect(checkBuild(root({ redirect: "../../wrangler.jsonc" }), "sandbox").problems).toHaveLength(1);
  });

  it("accepts the redirect written as an absolute path, and refuses one that is not a path", () => {
    const dir = root({ redirect: null });
    mkdirSync(join(dir, ".wrangler", "deploy"), { recursive: true });
    writeFileSync(join(dir, ".wrangler", "deploy", "config.json"), JSON.stringify({ configPath: join(dir, "build", "server", "wrangler.json") }));
    expect(checkBuild(dir, "sandbox").problems).toEqual([]);
    writeFileSync(join(dir, ".wrangler", "deploy", "config.json"), JSON.stringify({ configPath: 5 }));
    expect(checkBuild(dir, "sandbox").problems).toHaveLength(1);
    writeFileSync(join(dir, ".wrangler", "deploy", "config.json"), "{");
    expect(checkBuild(dir, "sandbox").problems).toHaveLength(1);
  });
});

// ---- The command ---------------------------------------------------------------------------------------------------------------------

const script = fileURLToPath(new URL("./predeploy-check.ts", import.meta.url));
const run = (entry: string, ...args: string[]) => spawnSync("pnpm", ["exec", "tsx", entry, ...args], { encoding: "utf8", cwd: dirname(script) });

describe("the command", () => {
  it("exits 0 and says what it checked for a build that may be deployed", () => {
    const result = run(script, "sandbox", root());
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("x-explorer-sandbox");
  });

  it("exits 1 and says why for a placeholder", () => {
    const result = run(script, "sandbox", root({ config: withVars({ XAHAU_DATA_API_URL: "https://xahau.data.example.invalid" }) }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("XAHAU_DATA_API_URL");
    expect(result.stderr).toContain("refusing to deploy");
  });

  it("exits 1 for an http URL, and for a build of another environment", () => {
    expect(run(script, "production", root({ config: withVars({ XRPL_NODE_URL: "http://node.example.com" }, "production") })).status).toBe(1);
    const other = run(script, "production", root({ config: good("sandbox") }));
    expect(other.status).toBe(1);
    expect(other.stderr).toContain("sandbox");
  });

  it("exits 1 when there is no build at all", () => {
    expect(run(script, "sandbox", root({ config: null })).status).toBe(1);
  });

  it.each([[[]], [["prod"]], [["sandbox", "extra", "more"]]])("refuses to run with the arguments %j", (args) => {
    const result = run(script, ...args);
    expect(result.status).not.toBe(0);
  });

  // The check-bundle lesson: a gate that decided whether it was "the command" by comparing paths printed nothing and exited 0 through a link.
  // This one does not ask.
  it.each(["file", "directory"] as const)("still refuses when it is reached through a link to the %s", (kind) => {
    const dir = mkdtempSync(join(scratch, "link-"));
    let entry: string;
    if (kind === "file") {
      entry = join(dir, "predeploy-check.ts");
      symlinkSync(script, entry);
    } else {
      symlinkSync(dirname(script), join(dir, "linked-scripts"));
      entry = join(dir, "linked-scripts", "predeploy-check.ts");
    }
    const refused = run(entry, "sandbox", root({ config: withVars({ XRPL_DATA_API_URL: "https://x.example.invalid" }) }));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("XRPL_DATA_API_URL");
    expect(run(entry, "sandbox", root()).status).toBe(0);
  });
});

// ---- What the repository says ---------------------------------------------------------------------------------------------------------

describe("the deploy scripts and wrangler.jsonc", () => {
  const project = fileURLToPath(new URL("..", import.meta.url));
  const scripts = (JSON.parse(readFileSync(join(project, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

  // The guard is only a guard if it sits between the build and the deploy, joined with `&&` so that its exit code stops the deploy.
  it.each(["sandbox", "production"] as const)("deploy:%s builds for the environment, runs the guard for it, and only then deploys", (env) => {
    const steps = scripts[`deploy:${env}`]!.split("&&").map((step) => step.trim());
    expect(steps).toEqual([`CLOUDFLARE_ENV=${env} react-router build`, `tsx scripts/predeploy-check.ts ${env}`, "wrangler deploy"]);
  });

  // Not on workers.dev (the Cache API does nothing there), in the environments that are deployed.
  it.each(["sandbox", "production"] as const)("the %s environment is not served from workers.dev, nor from preview URLs", (env) => {
    const config = unstable_readConfig({ config: join(project, "wrangler.jsonc"), env });
    expect(config.targetEnvironment).toBe(env);
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
  });

  // The blocks that are deployed pass the guard as wrangler reads them: the same table is the guard's and the file's, and the test is what keeps them one.
  it.each(["sandbox", "production"] as const)("the %s block passes the guard", (env) => {
    const config = unstable_readConfig({ config: join(project, "wrangler.jsonc"), env });
    expect(deployProblems(config, env)).toEqual([]);
    expect(config.name).toBe(`x-explorer-${env}`);
    expect(config.routes).toEqual([{ pattern: DEPLOYED[env].host, custom_domain: true }]);
    expect((config.vars as Record<string, unknown>).ENVIRONMENT).toBe(env);
  });

  it("does not let the block of one environment pass for the other", () => {
    for (const [built, asked] of [["sandbox", "production"], ["production", "sandbox"]] as const) {
      expect(deployProblems(unstable_readConfig({ config: join(project, "wrangler.jsonc"), env: built }), asked).length).toBeGreaterThanOrEqual(7);
    }
  });

  // The top level is local development and the tests: the development environment, no route, and data API hosts that never resolve.
  it("has ENVIRONMENT development, no route and .invalid data APIs at the top level", () => {
    const config = unstable_readConfig({ config: join(project, "wrangler.jsonc") });
    const vars = config.vars as Record<string, string>;
    expect(config.name).toBe("x-explorer");
    expect(vars.ENVIRONMENT).toBe("development");
    expect(config.routes ?? []).toEqual([]);
    expect(new URL(vars.XRPL_DATA_API_URL!).hostname.endsWith(".invalid")).toBe(true);
    expect(new URL(vars.XAHAU_DATA_API_URL!).hostname.endsWith(".invalid")).toBe(true);
  });

  // ACCOUNT_ANALYTICS (README "Switches"): on in development and the tests (the top level), off in sandbox and production until D2's gauges
  // `syncer_rates_daily_missing_days` and `syncer_account_rollups_pending_accounts` are 0 there. A flip is a commit, so it is read from the file.
  it("has ACCOUNT_ANALYTICS on at the top level and off in sandbox and production", () => {
    const vars = (env?: string) => unstable_readConfig({ config: join(project, "wrangler.jsonc"), env }).vars as Record<string, unknown>;
    expect(vars().ACCOUNT_ANALYTICS).toBe("on");
    expect(vars("sandbox").ACCOUNT_ANALYTICS).toBe("off");
    expect(vars("production").ACCOUNT_ANALYTICS).toBe("off");
  });

  // AMM_PAGES (README "Switches"): on in development and the tests (the top level), off in sandbox and production until AMM_DATA is on there and `feat/amm-data`
  // is merged, re-ingested and back-filled. A flip is a commit, so it is read from the file. In no block is it on over an AMM_DATA that is off (the guard's rule).
  it("has AMM_PAGES on at the top level and off in sandbox and production, and never on over AMM_DATA off", () => {
    const vars = (env?: string) => unstable_readConfig({ config: join(project, "wrangler.jsonc"), env }).vars as Record<string, unknown>;
    expect(vars().AMM_PAGES).toBe("on");
    expect(vars("sandbox").AMM_PAGES).toBe("off");
    expect(vars("production").AMM_PAGES).toBe("off");
    for (const env of [undefined, "sandbox", "production"]) {
      if (vars(env).AMM_PAGES === "on") expect(vars(env).AMM_DATA, env ?? "top level").toBe("on");
    }
  });
});
