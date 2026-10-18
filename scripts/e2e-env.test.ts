import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { chromiumToUse, formatEnvFile, isExpectedConsoleError, isStackWorkdir, perNetwork, upstreamUrls } from "./e2e-env";

// The two switches of the end-to-end suite that name a real stack, and the browser it launches when the one this Playwright
// wants is not installed.

describe("perNetwork", () => {
  it("puts the network's id where {net} is, as often as it is there", () => {
    expect(perNetwork("https://{net}.data.example.com/{net}", "xahau")).toBe("https://xahau.data.example.com/xahau");
    expect(perNetwork("https://{net}.data.example.com", "xrpl")).toBe("https://xrpl.data.example.com");
  });

  it("leaves a URL without it alone: one URL for both networks", () => {
    expect(perNetwork("http://localhost:3000", "xrpl")).toBe("http://localhost:3000");
    expect(perNetwork("http://localhost:3000", "xahau")).toBe("http://localhost:3000");
  });
});

describe("upstreamUrls", () => {
  it("points the four variables at the fixture server, each network under a path of its own", () => {
    expect(upstreamUrls({}, "http://127.0.0.1:4000")).toEqual({
      XRPL_DATA_API_URL: "http://127.0.0.1:4000/xrpl",
      XAHAU_DATA_API_URL: "http://127.0.0.1:4000/xahau",
      XRPL_NODE_URL: "http://127.0.0.1:4000/xrpl-node",
      XAHAU_NODE_URL: "http://127.0.0.1:4000/xahau-node",
    });
  });

  it("takes the real stack's two URLs when the environment names them, one pair per network", () => {
    const env = { E2E_DATA_API_URL: "https://{net}.data.example.com", E2E_NODE_URL: "https://{net}-node.example.com/" };
    expect(upstreamUrls(env, "http://127.0.0.1:4000")).toEqual({
      XRPL_DATA_API_URL: "https://xrpl.data.example.com",
      XAHAU_DATA_API_URL: "https://xahau.data.example.com",
      XRPL_NODE_URL: "https://xrpl-node.example.com/",
      XAHAU_NODE_URL: "https://xahau-node.example.com/",
    });
  });

  it("needs no fixture server for a real stack, and uses it for none", () => {
    const urls = upstreamUrls({ E2E_DATA_API_URL: "http://localhost:3000", E2E_NODE_URL: "http://localhost:5005" }, undefined);
    expect(Object.values(urls)).toEqual(["http://localhost:3000", "http://localhost:3000", "http://localhost:5005", "http://localhost:5005"]);
  });

  it("refuses one of the two without the other: half a real stack would be half fixtures", () => {
    expect(() => upstreamUrls({ E2E_DATA_API_URL: "http://localhost:3000" }, "http://127.0.0.1:4000")).toThrow(/both or neither/);
    expect(() => upstreamUrls({ E2E_NODE_URL: "http://localhost:5005" }, "http://127.0.0.1:4000")).toThrow(/both or neither/);
  });

  it("treats an empty variable as not set", () => {
    expect(upstreamUrls({ E2E_DATA_API_URL: "", E2E_NODE_URL: "" }, "http://127.0.0.1:4000").XRPL_DATA_API_URL).toBe("http://127.0.0.1:4000/xrpl");
  });
});

describe("chromiumToUse", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A browsers directory holding a headless shell of each revision given. */
  function registry(...revisions: number[]): string {
    const root = mkdtempSync(join(tmpdir(), "t15b-browsers-"));
    dirs.push(root);
    for (const revision of revisions) {
      const dir = join(root, `chromium_headless_shell-${revision}`, "chrome-headless-shell-mac-arm64");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "chrome-headless-shell"), "#!/bin/sh\n");
      chmodSync(join(dir, "chrome-headless-shell"), 0o755);
      // What is not the executable.
      writeFileSync(join(dir, "ABOUT"), "x");
    }
    return root;
  }
  const wanted = (root: string, revision: number) => join(root, `chromium-${revision}`, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium");
  /** The full Chromium of a revision, installed (what `playwright install chromium --no-shell` leaves). */
  function installFull(root: string, revision: number): string {
    const path = wanted(root, revision);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "#!/bin/sh\n");
    return path;
  }
  const shellOf = (root: string, revision: number) => join(root, `chromium_headless_shell-${revision}`, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
  const INSTALL = "pnpm exec playwright install chromium";

  it("is the browser of E2E_CHROMIUM when one is named, in a pipeline too, without a warning", () => {
    const root = registry(1248);
    expect(chromiumToUse({ executablePath: wanted(root, 1248), env: { E2E_CHROMIUM: "/opt/chrome/chrome" } })).toEqual({ executablePath: "/opt/chrome/chrome" });
    expect(chromiumToUse({ executablePath: wanted(root, 1248), env: { E2E_CHROMIUM: "/opt/chrome/chrome", CI: "true" } })).toEqual({ executablePath: "/opt/chrome/chrome" });
  });

  it("is nothing when the headless shell this Playwright wants is installed: its own choice stands", () => {
    const root = registry(1243, 1248);
    expect(chromiumToUse({ executablePath: wanted(root, 1248), env: {} })).toEqual({});
    expect(chromiumToUse({ executablePath: wanted(root, 1248), env: { CI: "true" } })).toEqual({});
  });

  it("is the full Chromium of the wanted revision when that is installed and its headless shell is not, before any older shell", () => {
    const root = registry(1243);
    const full = installFull(root, 1248);
    // No warning and no error: it is the revision that was wanted, in a pipeline as well.
    expect(chromiumToUse({ executablePath: full, env: {} })).toEqual({ executablePath: full });
    expect(chromiumToUse({ executablePath: full, env: { CI: "true" } })).toEqual({ executablePath: full });
  });

  it("is the newest older headless shell, with a warning naming both revisions and the command that installs the right one, on a developer's machine", () => {
    const root = registry(1200, 1243, 1100);
    const choice = chromiumToUse({ executablePath: wanted(root, 1248), env: {} });
    expect(choice.executablePath).toBe(shellOf(root, 1243));
    expect(choice.error).toBeUndefined();
    expect(choice.warning).toContain("1248");
    expect(choice.warning).toContain("1243");
    expect(choice.warning).toContain(INSTALL);
    expect(choice.warning).toContain(shellOf(root, 1243));
  });

  it("compares revisions as numbers", () => {
    const root = registry(999, 1243);
    expect(chromiumToUse({ executablePath: wanted(root, 1248), env: {} }).executablePath).toContain("chromium_headless_shell-1243");
  });

  it("is an error in a pipeline (CI is set): it names what to run, and what to set to take the older browser all the same", () => {
    const root = registry(1243);
    const choice = chromiumToUse({ executablePath: wanted(root, 1248), env: { CI: "true" } });
    expect(choice.executablePath).toBeUndefined();
    expect(choice.warning).toBeUndefined();
    expect(choice.error).toContain(INSTALL);
    expect(choice.error).toContain("E2E_ALLOW_OLDER_CHROMIUM=1");
    expect(choice.error).toContain("1248");
    expect(choice.error).toContain("1243");
  });

  it("takes the older browser in a pipeline only when E2E_ALLOW_OLDER_CHROMIUM=1, and still warns", () => {
    const root = registry(1243);
    const choice = chromiumToUse({ executablePath: wanted(root, 1248), env: { CI: "1", E2E_ALLOW_OLDER_CHROMIUM: "1" } });
    expect(choice.executablePath).toBe(shellOf(root, 1243));
    expect(choice.error).toBeUndefined();
    expect(choice.warning).toContain(INSTALL);
    // Not for any other value.
    for (const value of ["", "0", "true", "yes"]) {
      expect(chromiumToUse({ executablePath: wanted(root, 1248), env: { CI: "1", E2E_ALLOW_OLDER_CHROMIUM: value } }).error).toContain(INSTALL);
    }
  });

  it("does not take CI=0, CI=false or an empty CI for a pipeline", () => {
    const root = registry(1243);
    for (const CI of ["", "0", "false"]) {
      expect(chromiumToUse({ executablePath: wanted(root, 1248), env: { CI } }).executablePath).toBe(shellOf(root, 1243));
    }
  });

  it("prefers the full wanted Chromium to an older shell in a pipeline as well", () => {
    const root = registry(1243);
    const full = installFull(root, 1248);
    expect(chromiumToUse({ executablePath: full, env: { CI: "true" } })).toEqual({ executablePath: full });
  });

  it("is nothing when none is installed, so that Playwright says what to run", () => {
    expect(chromiumToUse({ executablePath: wanted(registry(), 1248), env: {} })).toEqual({});
    expect(chromiumToUse({ executablePath: wanted(registry(), 1248), env: { CI: "true" } })).toEqual({});
  });

  it("looks where PLAYWRIGHT_BROWSERS_PATH says", () => {
    const root = registry(1243);
    expect(chromiumToUse({ executablePath: join("/elsewhere", "chromium-1248", "chrome"), env: { PLAYWRIGHT_BROWSERS_PATH: root } }).executablePath).toContain("chromium_headless_shell-1243");
  });
});

describe("formatEnvFile", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** What `wrangler dev --env-file <file>` makes of the file: wrangler's own loader (dotenv, then dotenv-expand), the config's directory being `dir`. */
  async function throughWrangler(dir: string, file: string): Promise<Record<string, string>> {
    const { unstable_getVarsForDev } = await import("wrangler");
    const vars = unstable_getVarsForDev(join(dir, "wrangler.json"), [file], {}, undefined, true);
    return Object.fromEntries(Object.entries(vars).map(([name, binding]) => [name, String((binding as { value: unknown }).value)]));
  }
  function workdir(): string {
    const dir = mkdtempSync(join(tmpdir(), "t15b-envfile-"));
    dirs.push(dir);
    return dir;
  }

  // Values a key or a URL may hold that dotenv-expand would rewrite: `$NAME` and `${NAME}`, from the file or from the process.
  const TRICKY = {
    DATA_API_KEY: "pa$$word$XRPL_NODE_URL${HOME}end",
    XRPL_NODE_URL: "https://node.example/a?b=1&c=$d#frag",
    XAHAU_NODE_URL: 'say "hi" it\'s # not a comment $x',
    SENTRY_DSN: 'a "b" `c` $d',
    OTHER: "it's `fine` # not a comment",
    XRPL_DATA_API_URL: "  padded  ",
    XAHAU_DATA_API_URL: "plain",
  };

  it("is read back by wrangler as it was written, whatever the value holds", async () => {
    const dir = workdir();
    const file = join(dir, "worker.env");
    writeFileSync(file, formatEnvFile(TRICKY));
    expect(await throughWrangler(dir, file)).toEqual(TRICKY);
  });

  it("is what makes it so: the same values written bare are rewritten by wrangler", async () => {
    const dir = workdir();
    const file = join(dir, "worker.env");
    writeFileSync(file, Object.entries(TRICKY).map(([name, value]) => `${name}=${value}`).join("\n") + "\n");
    expect((await throughWrangler(dir, file)).DATA_API_KEY).not.toBe(TRICKY.DATA_API_KEY);
  });

  it("is the only file read: a .dev.vars next to the config is ignored once an env file is given", async () => {
    const dir = workdir();
    writeFileSync(join(dir, ".dev.vars"), "DATA_API_KEY=from-dev-vars\nONLY_THERE=1\n");
    const file = join(dir, "worker.env");
    writeFileSync(file, formatEnvFile({ DATA_API_KEY: "from-the-run" }));
    expect(await throughWrangler(dir, file)).toEqual({ DATA_API_KEY: "from-the-run" });
  });

  it("refuses what no quoting can carry over: a line break, a backslash, all three quotes, and a name that is not one", () => {
    expect(() => formatEnvFile({ DATA_API_KEY: "a\nb" })).toThrow(/DATA_API_KEY/);
    expect(() => formatEnvFile({ DATA_API_KEY: "a\rb" })).toThrow(/DATA_API_KEY/);
    expect(() => formatEnvFile({ DATA_API_KEY: "a\\b" })).toThrow(/DATA_API_KEY/);
    expect(() => formatEnvFile({ DATA_API_KEY: "a\"b'c`d" })).toThrow(/DATA_API_KEY/);
    expect(() => formatEnvFile({ "NOT A NAME": "x" })).toThrow(/NOT A NAME/);
  });
});

describe("isStackWorkdir", () => {
  it("is true for the directory the stack made under the temporary directory, and for nothing else", () => {
    const tmp = join(tmpdir(), "t15b-tmp-root");
    expect(isStackWorkdir(join(tmp, "x-explorer-e2e-AbC123"), tmp)).toBe(true);
    expect(isStackWorkdir(join(tmp, "other-AbC123"), tmp)).toBe(false);
    expect(isStackWorkdir(join(tmp, "..", "x-explorer-e2e-AbC123"), tmp)).toBe(false);
    expect(isStackWorkdir(tmp, tmp)).toBe(false);
    expect(isStackWorkdir(join(tmp, "x-explorer-e2e-AbC123", "state"), tmp)).toBe(false);
    expect(isStackWorkdir("/", tmp)).toBe(false);
    expect(isStackWorkdir(join(tmp, "sub", "x-explorer-e2e-AbC123"), tmp)).toBe(false);
  });
});

describe("isExpectedConsoleError", () => {
  const failed = (status: number) => `Failed to load resource: the server responded with a status of ${status} (${status === 404 ? "Not Found" : "Service Unavailable"})`;
  const page = "http://127.0.0.1:8832";

  it("is a 404 the browser logs for a page or a client-side navigation to a thing that is not there", () => {
    expect(isExpectedConsoleError({ text: failed(404), url: `${page}/xrpl/tx/${"0".repeat(64)}` })).toBe(true);
    expect(isExpectedConsoleError({ text: failed(404), url: `${page}/xrpl/search.data?q=ABC` })).toBe(true);
    expect(isExpectedConsoleError({ text: failed(404), url: `${page}/nonet/ledger/1` })).toBe(true);
  });

  it("is not a 404 of a file of the build, nor of the route manifest: those are bugs", () => {
    expect(isExpectedConsoleError({ text: failed(404), url: `${page}/assets/root-AbC123.js` })).toBe(false);
    expect(isExpectedConsoleError({ text: failed(404), url: `${page}/assets/styles-AbC123.css` })).toBe(false);
    expect(isExpectedConsoleError({ text: failed(404), url: `${page}/__manifest?p=%2Fxrpl` })).toBe(false);
  });

  it("is not an answer of the server that is broken, whatever it was asked for", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      for (const path of ["/xrpl/ledger/1", "/xrpl/ledger/1.data", "/__manifest", "/assets/a.js", "/og/xrpl/tx/x.png"]) {
        expect(isExpectedConsoleError({ text: failed(status), url: `${page}${path}` }), `${status} ${path}`).toBe(false);
      }
    }
  });

  it("is not a request that did not get an answer at all, nor any other error of the console", () => {
    expect(isExpectedConsoleError({ text: "Failed to load resource: net::ERR_FAILED", url: `${page}/xrpl/search.data` })).toBe(false);
    expect(isExpectedConsoleError({ text: "Warning: Text content did not match.", url: `${page}/xrpl` })).toBe(false);
    expect(isExpectedConsoleError({ text: failed(404), url: "" })).toBe(false);
  });
});
