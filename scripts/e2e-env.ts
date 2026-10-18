// What the end-to-end suite reads from the environment (playwright.config.ts, test/e2e/stack.ts). Node only; no Playwright import, so
// that the Vitest `unit` project can test it.

import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

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
 * The port of the fixture server in a run that has one. It is fixed, not any free port, so that the tests (other processes than the
 * stack's) know where to ask it to change what it answers (test/e2e/fixture-control.ts): `E2E_FIXTURE_PORT`, else the Worker's port plus
 * two (the inspector has the one after it). Never 5173.
 */
export function fixturePort(env: Record<string, string | undefined>): number {
  const worker = Number(env.E2E_PORT ?? 8832);
  const given = env.E2E_FIXTURE_PORT;
  if (given !== undefined && given.trim() === "") {
    throw new Error("E2E_FIXTURE_PORT is set but empty: give it a port, or leave it unset for the Worker's port plus two");
  }
  const port = given === undefined ? worker + 2 : Number(given);
  if (port === 5173) throw new Error("the fixture server's port is 5173, which another dev server keeps");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${given === undefined ? `E2E_PORT + 2 (${port})` : `E2E_FIXTURE_PORT=${given}`} is not a port for the fixture server`);
  }
  return port;
}

export interface ChromiumChoice {
  /** The browser to launch; absent when Playwright's own choice stands. */
  executablePath?: string;
  /** To print, loudly, to stderr: a browser other than the wanted one is being used. */
  warning?: string;
  /** Why there is no browser to use (a pipeline refuses an older one); the config throws it. */
  error?: string;
}

/** Whether the environment is a pipeline's: `CI` set to something other than nothing, `0` or `false`. */
const inPipeline = (env: Record<string, string | undefined>) => Boolean(env.CI) && env.CI !== "0" && env.CI?.toLowerCase() !== "false";

const INSTALL = "pnpm exec playwright install chromium";

/**
 * The browser to launch when it is not the one Playwright would pick by itself. `executablePath` is `chromium.executablePath()`, from
 * which the browsers directory (or `PLAYWRIGHT_BROWSERS_PATH`) and the revision this Playwright wants are read. In this order:
 *
 * 1. `E2E_CHROMIUM` names an executable: that one, with no warning.
 * 2. The headless shell of the wanted revision is installed: nothing (Playwright's own choice).
 * 3. The full Chromium of the wanted revision is installed (`playwright install chromium --no-shell`): that one, before any older shell.
 * 4. An older headless shell is installed (a machine whose browsers an earlier Playwright put there): the newest one, with a loud warning
 *    naming both revisions and the command that installs the right one. In a pipeline (`CI`) that is an error unless
 *    `E2E_ALLOW_OLDER_CHROMIUM=1`: a pipeline has no reason to test in a browser it did not choose.
 * 5. Nothing is installed: nothing, so that Playwright says what to run.
 */
export function chromiumToUse(options: { executablePath: string; env: Record<string, string | undefined> }): ChromiumChoice {
  const { executablePath, env } = options;
  if (env.E2E_CHROMIUM) return { executablePath: env.E2E_CHROMIUM };

  const parts = executablePath.split(sep);
  const at = parts.findIndex((part) => /^chromium-\d+$/.test(part));
  const configured = env.PLAYWRIGHT_BROWSERS_PATH;
  const root = configured && configured !== "0" ? configured : at > 0 ? parts.slice(0, at).join(sep) : undefined;
  if (root === undefined) return {};
  const wanted = at >= 0 ? Number(parts[at]!.slice("chromium-".length)) : undefined;
  if (wanted !== undefined && existsSync(join(root, `chromium_headless_shell-${wanted}`))) return {};
  if (existsSync(executablePath)) return { executablePath };

  let installed: string[];
  try {
    installed = readdirSync(root).filter((name) => /^chromium_headless_shell-\d+$/.test(name));
  } catch {
    return {};
  }
  installed.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const name of installed) {
    for (const platformDir of readdirSync(join(root, name))) {
      for (const file of ["chrome-headless-shell", "chrome-headless-shell.exe"]) {
        const candidate = join(root, name, platformDir, file);
        if (!existsSync(candidate)) continue;
        const found = name.split("-")[1];
        const both = `this Playwright wants Chromium revision ${wanted ?? "(unknown)"}, which is not installed; revision ${found} is`;
        if (inPipeline(env) && env.E2E_ALLOW_OLDER_CHROMIUM !== "1") {
          return {
            error: `${both}. A pipeline tests in the browser it chose: install it with \`${INSTALL}\`, or set E2E_ALLOW_OLDER_CHROMIUM=1 to take revision ${found} all the same.`,
          };
        }
        return {
          executablePath: candidate,
          warning: [
            "!".repeat(100),
            `WARNING: ${both}.`,
            `WARNING: the end-to-end suite runs in the older one (${candidate}); what it finds may differ from a pipeline's.`,
            `WARNING: install the right one with: ${INSTALL}`,
            "!".repeat(100),
          ].join("\n"),
        };
      }
    }
  }
  return {};
}

/**
 * A directory made by the end-to-end stack: directly under the system's temporary directory, and named for it. Nothing else is ever
 * removed by the stack.
 */
export function isStackWorkdir(path: string, tmp: string): boolean {
  const resolved = resolve(path);
  return dirname(resolved) === resolve(tmp) && basename(resolved).startsWith("x-explorer-e2e-");
}

/**
 * The file `wrangler dev --env-file` reads the Worker's variables from. Wrangler runs every value through dotenv-expand, which rewrites
 * `$NAME` and `${NAME}` (from the file, or from the environment): a key or a URL with a `$` in it would reach the Worker changed. Each
 * value is quoted, with `$` escaped as `\$` (which dotenv-expand reads back as `$`). dotenv does not unescape a quote inside quotes, so the
 * quote is the first of `"`, `'` and a backtick that the value does not contain (the choice the Vite plugin makes for the same reason).
 * scripts/e2e-env.test.ts reads the file with wrangler's own loader. A line break or a backslash (dotenv turns `\n` into a line break) and
 * a value with all three quotes cannot be carried over, so they are refused, by name, rather than corrupted.
 */
export function formatEnvFile(values: Record<string, string>): string {
  return (
    Object.entries(values)
      .map(([name, value]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`${name} is not a name of a variable`);
        if (/[\r\n\\]/.test(value)) throw new Error(`${name} holds a line break or a backslash, which an env file cannot carry`);
        const quote = ['"', "'", "`"].find((candidate) => !value.includes(candidate));
        if (quote === undefined) throw new Error(`${name} holds every kind of quote, which an env file cannot carry`);
        return `${name}=${quote}${value.replaceAll("$", "\\$")}${quote}`;
      })
      .join("\n") + "\n"
  );
}

/**
 * Whether a message the browser's console logged as an error is one a test of the suite means to cause. The browser logs every response
 * with an error status (`Failed to load resource: the server responded with a status of 404`), including the 404 of a page for a thing
 * that is not there (a document, or the `.data` request of a client-side navigation to it), which the tests that ask for one assert in
 * the page. That is the whole exemption: a 404 of a file of the build (`/assets/`) or of the route manifest, any other status (a 5xx of
 * a `.data` request is a page that broke), a request that got no answer and any other error are failures.
 */
export function isExpectedConsoleError(message: { text: string; url: string }): boolean {
  if (!/^Failed to load resource: the server responded with a status of 404\b/.test(message.text)) return false;
  let pathname: string;
  try {
    pathname = new URL(message.url).pathname;
  } catch {
    return false;
  }
  return !pathname.startsWith("/assets/") && pathname !== "/__manifest";
}
