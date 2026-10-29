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
 * An unknown network: a 404 page drawn without the upstream (no file has mocked it yet when this runs). A 404 page is stored
 * (class `short`), so the path is nobody else's.
 */
const WARM_PATH = "/warm-the-worker";

/** Registers a `beforeAll` in the calling file that asks the Worker for a page, so that its first test finds the app loaded. */
export function warmWorker(): void {
  beforeAll(async () => {
    // The documentation range (RFC 3849), apart from the addresses of the files: the visitor limit is per address.
    const response = await exports.default.fetch(`https://explorer.test${WARM_PATH}`, { headers: { "CF-Connecting-IP": "2001:db8:ffff::1" } });
    await response.arrayBuffer();
  }, WARM_TIMEOUT_MS);
}
