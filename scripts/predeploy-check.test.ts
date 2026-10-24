import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { unstable_readConfig } from "wrangler";

import { FEATURE_VARS } from "../app/ui/features";
import { allSwitches } from "../test/support/switches";
import { checkBuild, deployProblems } from "./predeploy-guard";

// The guard that stands between `react-router build` and `wrangler deploy` (README, "The pipeline and deploying"). It reads the config the
// Cloudflare Vite plugin wrote for the build (build/server/wrangler.json) and refuses a deploy that would publish placeholder upstream hosts,
// plain-http upstreams, a Worker that is reachable on workers.dev, or an environment other than the one asked for. These are fake configs:
// nothing here deploys.

type Config = Record<string, unknown>;

/** What the plugin writes for a build with `CLOUDFLARE_ENV=<env>` once the hosts are real, as far as the guard reads it. */
function good(env = "sandbox", overrides: Config = {}): Config {
  return {
    name: `x-explorer-${env}`,
    targetEnvironment: env,
    workers_dev: false,
    preview_urls: false,
    vars: {
      XRPL_DATA_API_URL: "https://xrpl.data.example.com",
      XAHAU_DATA_API_URL: "https://xahau.data.example.com",
      XRPL_NODE_URL: "https://s1.ripple.com:51234/",
      XAHAU_NODE_URL: "https://xahau.network/",
      ...allSwitches("off"),
      BUILD_ID: "abc1234",
    },
    ...overrides,
  };
}

/** `good` with some of its vars replaced. */
function withVars(vars: Record<string, unknown>, env = "sandbox"): Config {
  return good(env, { vars: { ...(good(env).vars as Config), ...vars } });
}

describe("deployProblems", () => {
  it("passes the config of the environment asked for, with real https hosts", () => {
    expect(deployProblems(good("sandbox"), "sandbox")).toEqual([]);
    expect(deployProblems(good("production"), "production")).toEqual([]);
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

    it("does not take a real host that only mentions invalid for a placeholder", () => {
      expect(deployProblems(withVars({ XRPL_DATA_API_URL: "https://invalid.example.com/" }), "sandbox")).toEqual([]);
      expect(deployProblems(withVars({ XRPL_DATA_API_URL: "https://notinvalid.com" }), "sandbox")).toEqual([]);
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
    it("refuses a build for another environment than the one asked for", () => {
      const problems = deployProblems(good("production"), "sandbox");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("production");
      expect(problems[0]).toContain("sandbox");
      expect(deployProblems(good("sandbox"), "production")).toHaveLength(1);
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
    expect(checkBuild(root({ config: good("production") }), "sandbox").problems).toHaveLength(1);
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
