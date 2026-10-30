// The Worker's first request, made before the first test of a spec file that asks the Worker for pages (`pageClient`, or
// `exports.default.fetch` directly). The first request of a file loads the whole app, React Router's server build and every
// route module: about 0.85 s on a developer's machine and 2.5 to 5 s on a CI runner, so the first test of a file ran into
// vitest's 5 s limit ("Test timed out in 5000ms") for work that was not its own. Made in a hook with a budget of its own,
// every test times only its requests. A file that never asks the Worker does not call this, and loads nothing.
//
// It is a request through `exports.default.fetch`, as a test's is, and not an `import()` of the server build from the test: that
// loaded the same modules by another way, and with many files at once workerd exited ("Worker exited unexpectedly").

import { exports } from "cloudflare:workers";
import { beforeAll } from "vitest";

/** Loading the routes on a busy CI runner, with a margin over the 5 s seen there. */
const WARM_TIMEOUT_MS = 30_000;

/**
 * The root: React Router answers it (the redirect to a network's home), and the edge cache neither stores it nor counts it
 * against the visitor limit (`UNCACHED_PATHS`), so it leaves nothing behind for a test to find: no entry, and no late `put` in
 * `waitUntil` for a test that watches the cache's writes. It reads no upstream.
 */
const WARM_PATH = "/";

/** Registers a `beforeAll` in the calling file that asks the Worker for a page, so that its first test finds the app loaded. */
export function warmWorker(): void {
  beforeAll(async () => {
    // Not followed: the network's home would ask the upstream, which no file has mocked yet.
    const response = await exports.default.fetch(`https://explorer.test${WARM_PATH}`, { redirect: "manual" });
    await response.arrayBuffer();
  }, WARM_TIMEOUT_MS);
}
