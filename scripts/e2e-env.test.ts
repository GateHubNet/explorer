import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { chromiumToUse, perNetwork, upstreamUrls } from "./e2e-env";

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

  it("is the browser of E2E_CHROMIUM when one is named", () => {
    const root = registry(1248);
    expect(chromiumToUse({ executablePath: wanted(root, 1248), env: { E2E_CHROMIUM: "/opt/chrome/chrome" } })).toBe("/opt/chrome/chrome");
  });

  it("is nothing when the browser this Playwright wants is installed: its own choice stands", () => {
    const root = registry(1243, 1248);
    expect(chromiumToUse({ executablePath: wanted(root, 1248), env: {} })).toBeUndefined();
  });

  it("is the newest headless shell installed when the wanted one is not", () => {
    const root = registry(1200, 1243, 1100);
    expect(chromiumToUse({ executablePath: wanted(root, 1248), env: {} })).toBe(join(root, "chromium_headless_shell-1243", "chrome-headless-shell-mac-arm64", "chrome-headless-shell"));
  });

  it("compares revisions as numbers", () => {
    const root = registry(999, 1243);
    expect(chromiumToUse({ executablePath: wanted(root, 1248), env: {} })).toContain("chromium_headless_shell-1243");
  });

  it("is nothing when none is installed, so that Playwright says what to run", () => {
    expect(chromiumToUse({ executablePath: wanted(registry(), 1248), env: {} })).toBeUndefined();
  });

  it("looks where PLAYWRIGHT_BROWSERS_PATH says", () => {
    const root = registry(1243);
    expect(chromiumToUse({ executablePath: join("/elsewhere", "chromium-1248", "chrome"), env: { PLAYWRIGHT_BROWSERS_PATH: root } })).toContain("chromium_headless_shell-1243");
  });
});
