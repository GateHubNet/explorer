// What the end-to-end suite runs against, started by Playwright's `webServer` (playwright.config.ts) and stopped by it:
//
//   fixture server  test/support/fixture-server.ts, the recorded answers of the data API and of the nodes (test/fixtures/http/),
//                   unless E2E_DATA_API_URL and E2E_NODE_URL name a real stack;
//   the Worker      the BUILT Worker (`react-router build`: build/server, build/client), run by `wrangler dev`, so what is tested is
//                   what the Cloudflare Vite plugin makes and `wrangler deploy` uploads, with its static assets, its `_headers`,
//                   its rate-limit binding and its Cache API. (`vite preview` would run the same build; `wrangler dev` is the
//                   command spec 12 names.)
//
// The upstream URLs, the key and the state of the run are made here and given to the Worker through a file of its own in a
// temporary directory, never through the repository: no .dev.vars is written, and a developer's own one (which `pnpm build` copies
// into build/server) is not read, because `--env-file` turns that lookup off. The directory (the Worker's persisted state: its Cache
// API and everything else it keeps) is new for every run and removed at the end, so a page stored by an earlier run cannot hide
// what the code does now.
//
//   E2E_PORT            the Worker's port (default 8832); the inspector takes the next one. Never 5173.
//   E2E_DATA_API_URL    a real data API instead of the fixtures; both of these or neither. `{net}` stands for `xrpl` / `xahau`:
//   E2E_NODE_URL        `https://{net}.data.example.com` is two URLs, a URL without it is used for both networks.
//   E2E_DATA_API_KEY    the key a real data API wants (X-API-Key); the fixtures take any non-empty one.
//   E2E_SKIP_BUILD=1    use build/ as it is (the pipeline has just made it with `pnpm verify`); otherwise it is built first.
//   E2E_VERBOSE=1       show the Worker's and wrangler's own log lines (one per request).
//
// For the tests of this file (test/unit/e2e-stack.test.ts): E2E_STACK_ROOT names another project root, with a build/ and a
// node_modules/.bin/wrangler of its own (a stand-in), so that the stack can be run without a build and with a wrangler that fails.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { formatEnvFile, isStackWorkdir, upstreamUrls } from "../../scripts/e2e-env";
import { type FixtureServer, startFixtureServer } from "../support/fixture-server";

const root = process.env.E2E_STACK_ROOT ?? fileURLToPath(new URL("../../", import.meta.url));

const log = (message: string) => console.log(`[e2e stack] ${message}`);

async function main(): Promise<void> {
  const env = process.env;
  const port = Number(env.E2E_PORT ?? 8832);
  if (!Number.isInteger(port) || port <= 0 || port === 5173) throw new Error(`E2E_PORT is not a port of the suite's own: ${env.E2E_PORT}`);
  const real = Boolean(env.E2E_DATA_API_URL || env.E2E_NODE_URL);

  let fixtures: FixtureServer | undefined;
  let workdir: string | undefined;
  let worker: ChildProcess | undefined;
  let stopping = false;

  // Only the directory made here, and only if it is where it should be. Safe to call again.
  const removeWorkdir = () => {
    if (workdir && isStackWorkdir(workdir, tmpdir())) rmSync(workdir, { recursive: true, force: true });
  };
  const cleanup = async () => {
    // Not one that has ended already, by itself or from the signal that went to its whole group: there is no 'exit' to wait for.
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          worker?.kill("SIGKILL");
          resolve();
        }, 5000);
        worker!.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    await fixtures?.close().catch(() => undefined);
    removeWorkdir();
  };
  const stop = (code: number) => {
    if (stopping) return;
    stopping = true;
    void cleanup().finally(() => process.exit(code));
  };
  process.on("SIGTERM", () => stop(0));
  process.on("SIGINT", () => stop(0));
  // The directory holds the key. Whatever ends the process (an exit, an exception nobody caught), it does not outlive it.
  process.on("exit", removeWorkdir);

  try {
    if (!real) {
      fixtures = await startFixtureServer(0);
      log(`fixture server ${fixtures.url}`);
    } else {
      log(`real stack: ${env.E2E_DATA_API_URL} / ${env.E2E_NODE_URL}`);
    }
    const urls = upstreamUrls(env, fixtures?.url);
    const key = env.E2E_DATA_API_KEY || (real ? "" : "e2e-fixture-key");
    if (!key) throw new Error("E2E_DATA_API_KEY is needed against a real stack");

    if (env.E2E_SKIP_BUILD === "1") {
      const config = join(root, "build/server/wrangler.json");
      if (!existsSync(config)) throw new Error("E2E_SKIP_BUILD=1, but there is no build: run pnpm build");
      // What `pnpm deploy:staging` leaves behind has that environment's name and vars flattened into it: not the Worker under test.
      const target = (JSON.parse(readFileSync(config, "utf8")) as { targetEnvironment?: string }).targetEnvironment;
      if (target) throw new Error(`E2E_SKIP_BUILD=1, but build/ is a build for the environment "${target}": run pnpm build`);
    } else {
      log("pnpm build");
      // A build for a Cloudflare environment would flatten that environment into the Worker; this one is the top level's.
      const { CLOUDFLARE_ENV: _ignored, ...buildEnv } = env;
      const built = spawnSync("pnpm", ["build"], { cwd: root, env: buildEnv, stdio: "inherit" });
      if (built.status !== 0) throw new Error("pnpm build failed");
    }

    workdir = mkdtempSync(join(tmpdir(), "x-explorer-e2e-"));
    const envFile = join(workdir, "worker.env");
    // Created private (the key is in it), in a directory that is the owner's alone.
    writeFileSync(envFile, formatEnvFile({ ...urls, DATA_API_KEY: key }), { mode: 0o600 });

    log(`wrangler dev on ${port}, state in ${workdir}`);
    worker = spawn(
      join(root, "node_modules/.bin/wrangler"),
      [
        "dev",
        "--config", "build/server/wrangler.json",
        "--ip", "127.0.0.1",
        "--port", String(port),
        "--inspector-port", String(port + 1),
        "--persist-to", join(workdir, "state"),
        "--env-file", envFile,
        "--show-interactive-dev-session=false",
        // The Worker logs a line for every request (and wrangler another); E2E_VERBOSE=1 lets them through.
        ...(env.E2E_VERBOSE === "1" ? [] : ["--log-level", "error"]),
      ],
      {
        cwd: root,
        stdio: "inherit",
        env: {
          ...env,
          // Giving `--env-file` is what stops wrangler from reading a .dev.vars next to the build. Wrangler reads that file when
          // CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV is true, which is its default; it is set here so that a value inherited from the
          // developer's shell cannot turn it off (the Worker would then run on the placeholder hosts of wrangler.jsonc), and the
          // process environment is kept out of the Worker's variables.
          CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "true",
          CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
          WRANGLER_SEND_METRICS: "false",
          NO_COLOR: "1",
        },
      },
    );
    // wrangler could not be started at all (not there, not executable): nothing will ever answer.
    worker.once("error", (error) => {
      console.error(`[e2e stack] wrangler could not be started: ${error.message}`);
      stop(1);
    });
    worker.once("exit", (code, signal) => {
      if (!stopping) {
        log(`wrangler dev ended (${signal ?? code})`);
        stop(1);
      }
    });
  } catch (error) {
    console.error(`[e2e stack] ${error instanceof Error ? error.message : String(error)}`);
    stop(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
