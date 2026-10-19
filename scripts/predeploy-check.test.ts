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
function good(env = "staging", overrides: Config = {}): Config {
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
function withVars(vars: Record<string, unknown>, env = "staging"): Config {
  return good(env, { vars: { ...(good(env).vars as Config), ...vars } });
}

describe("deployProblems", () => {
  it("passes the config of the environment asked for, with real https hosts", () => {
    expect(deployProblems(good("staging"), "staging")).toEqual([]);
    expect(deployProblems(good("production"), "production")).toEqual([]);
  });

  describe("the upstream URLs", () => {
    it.each(["XRPL_DATA_API_URL", "XAHAU_DATA_API_URL", "XRPL_NODE_URL", "XAHAU_NODE_URL"])("refuses a placeholder in %s, and names it", (name) => {
      const problems = deployProblems(withVars({ [name]: `https://${name.toLowerCase()}.example.invalid` }), "staging");
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
      expect(deployProblems(withVars({ XRPL_DATA_API_URL: url }), "staging")).toHaveLength(1);
    });

    it("does not take a real host that only mentions invalid for a placeholder", () => {
      expect(deployProblems(withVars({ XRPL_DATA_API_URL: "https://invalid.example.com/" }), "staging")).toEqual([]);
      expect(deployProblems(withVars({ XRPL_DATA_API_URL: "https://notinvalid.com" }), "staging")).toEqual([]);
    });

    it.each(["http://xrpl.data.example.com", "ftp://xrpl.data.example.com", "wss://xrpl.data.example.com", "xrpl.data.example.com", "//xrpl.data.example.com", "not a url", ""])(
      "refuses %j, which is not an https URL",
      (url) => {
        const problems = deployProblems(withVars({ XRPL_NODE_URL: url }), "staging");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("XRPL_NODE_URL");
      },
    );

    it.each([undefined, null, 443, true, {}, ["https://xrpl.data.example.com"]])("refuses %j, which is not a string", (value) => {
      const problems = deployProblems(withVars({ XAHAU_NODE_URL: value }), "staging");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("XAHAU_NODE_URL");
    });

    it("refuses a var that is missing, and a config with no vars at all", () => {
      const vars = { ...(good().vars as Config) };
      delete vars.XAHAU_DATA_API_URL;
      expect(deployProblems(good("staging", { vars }), "staging")).toHaveLength(1);
      const { vars: _gone, ...bare } = good();
      expect(deployProblems(bare, "staging").length).toBeGreaterThanOrEqual(4);
      expect(deployProblems(good("staging", { vars: "x" }), "staging").length).toBeGreaterThanOrEqual(4);
    });

    it("says every problem at once", () => {
      const problems = deployProblems(
        withVars({ XRPL_DATA_API_URL: "https://a.example.invalid", XAHAU_DATA_API_URL: "http://b.example.com", XRPL_NODE_URL: "https://c.invalid" }),
        "staging",
      );
      expect(problems).toHaveLength(3);
    });
  });

  // The switches (spec 6.1, README "Switches"): a Worker variable each, "on" or "off", in every environment. A build with one missing,
  // misspelt as a value or set under a wrong name would serve the other page than the one the owner decided on.
  describe("the switches", () => {
    it("passes a build whose switches are each on or off, whichever", () => {
      expect(deployProblems(withVars(allSwitches("on")), "staging")).toEqual([]);
      expect(deployProblems(withVars({ ...allSwitches("off"), [FEATURE_VARS[0]]: "on" }, "production"), "production")).toEqual([]);
    });

    it.each(FEATURE_VARS)("refuses %s missing, and names it", (name) => {
      const vars = { ...(good().vars as Config) };
      delete vars[name];
      const problems = deployProblems(good("staging", { vars }), "staging");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(name);
      expect(problems[0]).toContain('"on" or "off"');
    });

    it.each(["yes", "ON", "On", "true", "1", "", " on", "on ", true, 1, null, {}])("refuses the value %j of a switch", (value) => {
      for (const name of FEATURE_VARS) {
        const problems = deployProblems(withVars({ [name]: value }), "staging");
        expect(problems, name).toHaveLength(1);
        expect(problems[0]).toContain(name);
        expect(problems[0]).toContain('"on" or "off"');
      }
    });

    it('refuses a var that is not a switch but is "on" or "off", which is a misspelt switch', () => {
      for (const value of ["on", "off"]) {
        const problems = deployProblems(withVars({ MARKET: value }), "staging");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("MARKET");
        expect(problems[0]).toContain('"on" or "off"');
        expect(problems[0]).toContain("not a switch");
        expect(problems[0]).toContain(`the switches are ${FEATURE_VARS.join(", ")}`);
        expect(problems[0]).toContain("a misspelt one?");
      }
    });

    it("lets a var that is not a switch have any other value", () => {
      expect(deployProblems(withVars({ SENTRY_DSN: "", SOMETHING: "ON", OTHER: 3, YES: "yes" }), "staging")).toEqual([]);
    });

    it("says every problem at once, in the order: missing, not on or off, not a switch", () => {
      const vars: Config = { ...(good().vars as Config), ...allSwitches("off"), VALIDATORS: "yes", MARKET: "on" };
      delete vars.AMM_DATA;
      const problems = deployProblems(good("staging", { vars }), "staging");
      expect(problems).toHaveLength(3);
      expect(problems[0]).toContain("AMM_DATA");
      expect(problems[1]).toContain("VALIDATORS");
      expect(problems[2]).toContain("MARKET");
    });

    it("refuses every switch of a config with no vars at all", () => {
      const { vars: _gone, ...bare } = good();
      const problems = deployProblems(bare, "staging").join("\n");
      for (const name of FEATURE_VARS) expect(problems).toContain(name);
    });
  });

  describe("the environment", () => {
    it("refuses a build for another environment than the one asked for", () => {
      const problems = deployProblems(good("production"), "staging");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("production");
      expect(problems[0]).toContain("staging");
      expect(deployProblems(good("staging"), "production")).toHaveLength(1);
    });

    it("refuses a build that is for no environment (the top level's config, which is local development)", () => {
      const { targetEnvironment: _none, ...topLevel } = good("staging", { name: "x-explorer" });
      const problems = deployProblems(topLevel, "staging");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("CLOUDFLARE_ENV=staging");
      expect(deployProblems(good("staging", { targetEnvironment: null }), "staging")).toHaveLength(1);
      expect(deployProblems(good("staging", { targetEnvironment: "" }), "staging")).toHaveLength(1);
    });

    it.each(["", "prod", "Staging", "STAGING", "development", "staging ", undefined])("refuses to be asked for %j", (asked) => {
      const problems = deployProblems(good("staging"), asked as string);
      expect(problems.length).toBeGreaterThanOrEqual(1);
      expect(problems.join("\n")).toContain("staging or production");
    });
  });

  describe("workers.dev", () => {
    it.each([{ workers_dev: true }, { workers_dev: undefined }, { workers_dev: "false" }, { workers_dev: 0 }])("refuses %j", (change) => {
      const problems = deployProblems(good("staging", change), "staging");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("workers_dev");
    });

    it.each([{ preview_urls: true }, { preview_urls: undefined }, { preview_urls: "false" }])("refuses %j", (change) => {
      const problems = deployProblems(good("staging", change), "staging");
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("preview_urls");
    });
  });

  it.each([null, undefined, "config", 42, [], [good()]])("fails closed on a config that is %j", (config) => {
    expect(deployProblems(config, "staging").length).toBeGreaterThanOrEqual(1);
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
    const result = checkBuild(root(), "staging");
    expect(result.problems).toEqual([]);
    expect(result.summary).toContain("x-explorer-staging");
  });

  it("refuses a build with a switch missing", () => {
    const vars = { ...(good().vars as Config) };
    delete vars.AMM_DATA;
    const problems = checkBuild(root({ config: good("staging", { vars }) }), "staging").problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("AMM_DATA");
  });

  it("refuses a build with a placeholder, and one for another environment", () => {
    expect(checkBuild(root({ config: withVars({ XRPL_DATA_API_URL: "https://x.example.invalid" }) }), "staging").problems).toHaveLength(1);
    expect(checkBuild(root({ config: good("production") }), "staging").problems).toHaveLength(1);
  });

  it("refuses when there is no build", () => {
    const problems = checkBuild(root({ config: null }), "staging").problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("build/server/wrangler.json");
  });

  it.each(["", "{", "null", "[]", "42", '"text"'])("refuses a build config that reads as %j", (raw) => {
    expect(checkBuild(root({ raw }), "staging").problems.length).toBeGreaterThanOrEqual(1);
  });

  // `wrangler deploy` takes the config from this redirect. Without it, or if it leads elsewhere, it would deploy wrangler.jsonc's top level
  // (the placeholders, and no environment), whatever the build file says.
  it("refuses when wrangler deploy would not be sent to this build", () => {
    const missing = checkBuild(root({ redirect: null }), "staging").problems;
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain(".wrangler/deploy/config.json");
    expect(checkBuild(root({ redirect: "../../build/other/wrangler.json" }), "staging").problems).toHaveLength(1);
    expect(checkBuild(root({ redirect: "../../wrangler.jsonc" }), "staging").problems).toHaveLength(1);
  });

  it("accepts the redirect written as an absolute path, and refuses one that is not a path", () => {
    const dir = root({ redirect: null });
    mkdirSync(join(dir, ".wrangler", "deploy"), { recursive: true });
    writeFileSync(join(dir, ".wrangler", "deploy", "config.json"), JSON.stringify({ configPath: join(dir, "build", "server", "wrangler.json") }));
    expect(checkBuild(dir, "staging").problems).toEqual([]);
    writeFileSync(join(dir, ".wrangler", "deploy", "config.json"), JSON.stringify({ configPath: 5 }));
    expect(checkBuild(dir, "staging").problems).toHaveLength(1);
    writeFileSync(join(dir, ".wrangler", "deploy", "config.json"), "{");
    expect(checkBuild(dir, "staging").problems).toHaveLength(1);
  });
});

// ---- The command ---------------------------------------------------------------------------------------------------------------------

const script = fileURLToPath(new URL("./predeploy-check.ts", import.meta.url));
const run = (entry: string, ...args: string[]) => spawnSync("pnpm", ["exec", "tsx", entry, ...args], { encoding: "utf8", cwd: dirname(script) });

describe("the command", () => {
  it("exits 0 and says what it checked for a build that may be deployed", () => {
    const result = run(script, "staging", root());
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("x-explorer-staging");
  });

  it("exits 1 and says why for a placeholder", () => {
    const result = run(script, "staging", root({ config: withVars({ XAHAU_DATA_API_URL: "https://xahau.data.example.invalid" }) }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("XAHAU_DATA_API_URL");
    expect(result.stderr).toContain("refusing to deploy");
  });

  it("exits 1 for an http URL, and for a build of another environment", () => {
    expect(run(script, "production", root({ config: withVars({ XRPL_NODE_URL: "http://node.example.com" }, "production") })).status).toBe(1);
    const other = run(script, "production", root({ config: good("staging") }));
    expect(other.status).toBe(1);
    expect(other.stderr).toContain("staging");
  });

  it("exits 1 when there is no build at all", () => {
    expect(run(script, "staging", root({ config: null })).status).toBe(1);
  });

  it.each([[[]], [["prod"]], [["staging", "extra", "more"]]])("refuses to run with the arguments %j", (args) => {
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
    const refused = run(entry, "staging", root({ config: withVars({ XRPL_DATA_API_URL: "https://x.example.invalid" }) }));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("XRPL_DATA_API_URL");
    expect(run(entry, "staging", root()).status).toBe(0);
  });
});

// ---- What the repository says ---------------------------------------------------------------------------------------------------------

describe("the deploy scripts and wrangler.jsonc", () => {
  const project = fileURLToPath(new URL("..", import.meta.url));
  const scripts = (JSON.parse(readFileSync(join(project, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

  // The guard is only a guard if it sits between the build and the deploy, joined with `&&` so that its exit code stops the deploy.
  it.each(["staging", "production"] as const)("deploy:%s builds for the environment, runs the guard for it, and only then deploys", (env) => {
    const steps = scripts[`deploy:${env}`]!.split("&&").map((step) => step.trim());
    expect(steps).toEqual([`CLOUDFLARE_ENV=${env} react-router build`, `tsx scripts/predeploy-check.ts ${env}`, "wrangler deploy"]);
  });

  // Not on workers.dev (the Cache API does nothing there), in the environments that are deployed.
  it.each(["staging", "production"] as const)("the %s environment is not served from workers.dev, nor from preview URLs", (env) => {
    const config = unstable_readConfig({ config: join(project, "wrangler.jsonc"), env });
    expect(config.targetEnvironment).toBe(env);
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
  });
});
