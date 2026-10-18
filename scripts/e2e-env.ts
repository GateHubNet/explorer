// What the end-to-end suite reads from the environment (playwright.config.ts, test/e2e/stack.ts). Node only; no Playwright import, so
// that the Vitest `unit` project can test it.

import { existsSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

type NetworkId = "xrpl" | "xahau";

/** The URL of one network from the URL the environment gives: `{net}` is the network's id (`xrpl`, `xahau`). */
export function perNetwork(url: string, net: NetworkId): string {
  return url.replaceAll("{net}", net);
}

export interface UpstreamUrls {
  XRPL_DATA_API_URL: string;
  XAHAU_DATA_API_URL: string;
  XRPL_NODE_URL: string;
  XAHAU_NODE_URL: string;
}

/**
 * The upstream variables of the Worker under test. `E2E_DATA_API_URL` and `E2E_NODE_URL` name a real stack (data-api-new's
 * docker-compose, staging); `{net}` in either stands for each network's id, and one without it is used for both networks. With neither
 * set, the fixture server's four base paths (test/support/fixture-server.ts).
 */
export function upstreamUrls(env: Record<string, string | undefined>, fixtureUrl: string | undefined): UpstreamUrls {
  const dataApi = env.E2E_DATA_API_URL || undefined;
  const node = env.E2E_NODE_URL || undefined;
  if ((dataApi === undefined) !== (node === undefined)) {
    throw new Error("E2E_DATA_API_URL and E2E_NODE_URL go together: set both or neither");
  }
  if (dataApi !== undefined && node !== undefined) {
    return {
      XRPL_DATA_API_URL: perNetwork(dataApi, "xrpl"),
      XAHAU_DATA_API_URL: perNetwork(dataApi, "xahau"),
      XRPL_NODE_URL: perNetwork(node, "xrpl"),
      XAHAU_NODE_URL: perNetwork(node, "xahau"),
    };
  }
  if (fixtureUrl === undefined) throw new Error("no fixture server to point the Worker at");
  return {
    XRPL_DATA_API_URL: `${fixtureUrl}/xrpl`,
    XAHAU_DATA_API_URL: `${fixtureUrl}/xahau`,
    XRPL_NODE_URL: `${fixtureUrl}/xrpl-node`,
    XAHAU_NODE_URL: `${fixtureUrl}/xahau-node`,
  };
}

/**
 * The browser to launch when it is not the one Playwright would pick by itself.
 *
 * `E2E_CHROMIUM` names an executable. Otherwise Playwright's own choice stands (`undefined`), unless the revision of Chromium that
 * this version of Playwright wants is not installed (`pnpm exec playwright install chromium` fetches it) while an older one is: then
 * the newest headless shell in the browsers directory is used, which is what a machine whose browsers were installed by an earlier
 * Playwright has. `executablePath` is `chromium.executablePath()`, from which the directory and the wanted revision are read.
 */
export function chromiumToUse(options: { executablePath: string; env: Record<string, string | undefined> }): string | undefined {
  const { executablePath, env } = options;
  if (env.E2E_CHROMIUM) return env.E2E_CHROMIUM;

  const parts = executablePath.split(sep);
  const at = parts.findIndex((part) => /^chromium-\d+$/.test(part));
  const configured = env.PLAYWRIGHT_BROWSERS_PATH;
  const root = configured && configured !== "0" ? configured : at > 0 ? parts.slice(0, at).join(sep) : undefined;
  if (root === undefined) return undefined;
  const wanted = at >= 0 ? Number(parts[at]!.slice("chromium-".length)) : undefined;
  if (wanted !== undefined && existsSync(join(root, `chromium_headless_shell-${wanted}`))) return undefined;

  let installed: string[];
  try {
    installed = readdirSync(root).filter((name) => /^chromium_headless_shell-\d+$/.test(name));
  } catch {
    return undefined;
  }
  installed.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const name of installed) {
    for (const platformDir of readdirSync(join(root, name))) {
      for (const file of ["chrome-headless-shell", "chrome-headless-shell.exe"]) {
        const candidate = join(root, name, platformDir, file);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}
