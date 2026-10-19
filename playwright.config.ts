import { chromium, defineConfig, devices } from "@playwright/test";

import { chromiumToUse } from "./scripts/e2e-env";

// The end-to-end suite (spec 12). It runs against the BUILT Worker under `wrangler dev`, with the data API and the nodes replaced by the
// fixture server unless E2E_DATA_API_URL and E2E_NODE_URL name a real stack; test/e2e/stack.ts starts and stops all of it, and README.md
// ("End-to-end tests") has the switches. `E2E_BASE_URL` skips that and tests a Worker that is already running (a deployed staging).

// The specs that change what the fixture server answers while they run. They are the `live` project's and no other's: a later plan's
// `*-live.spec.ts` is in it without an edit here.
const LIVE_SPECS = ["**/live-home.spec.ts", "**/*-live.spec.ts"];

const port = Number(process.env.E2E_PORT ?? 8832);
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;

// The config is read again in every worker process; say things once.
const inMainProcess = process.env.TEST_WORKER_INDEX === undefined;
const browser = chromiumToUse({ executablePath: chromium.executablePath(), env: process.env });
if (browser.error) throw new Error(`[e2e] ${browser.error}`);
if (browser.warning && inMainProcess) console.error(browser.warning);
const executablePath = browser.executablePath;

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "**/*.spec.ts",
  // Every test is independent: it has its own context, and its own visitor address for the Worker's rate limit (test/e2e/support.ts).
  fullyParallel: true,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 4,
  // A test that passes on the second try is a test that fails: no retries, here or in a pipeline.
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: LIVE_SPECS },
    // The home page and the network page follow the chain, and their tests move the fixture server's chain on (or take an answer away): for a
    // while every page the Worker renders would show it, so no other test is running. It runs alone, after the others have passed
    // (`--no-deps` runs it without them). One test at a time, across its files too (`workers: 1`; `fullyParallel: false` keeps the tests of a
    // file in one worker but lets two files run at once): they share the fixture server, and a PUT of one test replaces what another put.
    { name: "live", use: { ...devices["Desktop Chrome"] }, testMatch: LIVE_SPECS, fullyParallel: false, workers: 1, dependencies: ["chromium"] },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "node --import tsx test/e2e/stack.ts",
        url: `${baseURL}/robots.txt`,
        // Never a server somebody else left: it would not be the build under test.
        reuseExistingServer: false,
        // The build, the Worker and its start.
        timeout: 180_000,
        // Its SIGTERM handler stops wrangler, closes the fixture server and removes the run's state directory.
        gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
        stdout: "pipe",
        stderr: "pipe",
      },
});
