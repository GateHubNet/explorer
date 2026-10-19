// The upstream fixtures behind a small Node HTTP server, for the end-to-end suite: `wrangler dev` is pointed at it
// instead of at the data API and the nodes. It answers exactly as `mockUpstream()` does (upstream-core.ts), from the same
// files, and has no Workers runtime in it.
//
// Each network sits under its own base path, so the URLs (and the keys of the Worker's subrequest cache) differ even
// though the origin is one:
//
//   <url>/xrpl         XRPL data API     (<url>/xrpl/v2/last_validated)
//   <url>/xahau        Xahau data API
//   <url>/xrpl-node    XRPL node         (JSON-RPC: POST <url>/xrpl-node)
//   <url>/xahau-node   Xahau node
//
// A test that needs the chain to move on (the home page follows it) changes what the upstreams answer for a while, as `mockUpstream` does:
// `PUT <url>/__fixture/overrides` with a JSON object of override keys (upstream-core.ts) to the answers to give, `DELETE` to go back to the
// recorded ones. Another process than the stack's (a test of the suite) asks it over HTTP; `override()` does the same in-process. JSON cannot
// carry a failing `Response`, so over HTTP an error is written `{ "$error": { "status": 503, "message": "unavailable" } }`, and the control
// path turns it into the data API's own error answer (`dataApiError`); test/e2e/fixture-control.ts has it as `unavailable()`.
//
// Node only: it is not imported from anything that runs in the Workers runtime.

import { readFile, realpath } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createUpstream, dataApiError, type FixtureFiles, type Overrides, type SeenRequest, type Upstream, type UpstreamBases } from "./upstream-core";

const ROOT = new URL("../fixtures/http/", import.meta.url);

/**
 * The files below `root`. upstream-core.ts only asks for paths made of pieces that are safe in a file name; this is the
 * second lock, and it does not rely on the first: a path with an escape (`%`), a backslash, `?`, `#` or NUL, or that
 * resolves outside `root` (a prefix of its name does not make a sibling directory part of it), or whose real file does (a
 * link), is no fixture.
 */
export function fileReader(root: URL): FixtureFiles {
  const base = resolve(fileURLToPath(root));
  const inside = base + sep;
  let realBase: Promise<string> | undefined;
  return {
    async read(path) {
      if (/[\\%?#\0]/.test(path)) return undefined;
      const target = resolve(base, path);
      if (!target.startsWith(inside)) return undefined;
      try {
        const real = await realpath(target);
        realBase ??= realpath(base);
        if (!real.startsWith(`${await realBase}${sep}`)) return undefined;
        return await readFile(real, "utf8");
      } catch {
        return undefined;
      }
    },
  };
}

const onDisk = fileReader(ROOT);

export interface FixtureServer {
  /** `http://127.0.0.1:<port>`, the origin the base paths above hang from. */
  url: string;
  /** Every request answered, in order, whichever answers were in force. */
  requests: SeenRequest[];
  /**
   * Answers with `overrides` (JSON bodies, keys as for `mockUpstream`, the unprefixed ones XRPL's) instead of the recorded answers
   * wherever they name one, replacing any earlier ones; `null` goes back to the recorded answers. A key that is none throws.
   */
  override(overrides: Overrides | null): void;
  /** Stops listening and drops the open connections. */
  close(): Promise<void>;
}

const CONTROL_PATH = "/__fixture/overrides";

/** What an override that is an error is written as over HTTP, where it cannot be a `Response`: `{ "$error": { status, message?, headers? } }`. */
interface ErrorOverride {
  $error: { status: number; message?: string; headers?: Record<string, string> };
}

function isErrorOverride(value: unknown): value is ErrorOverride {
  if (typeof value !== "object" || value === null || !("$error" in value)) return false;
  const { $error } = value;
  return typeof $error === "object" && $error !== null && "status" in $error && Number.isInteger($error.status) && ($error.status as number) >= 400 && ($error.status as number) <= 599;
}

/** The overrides as they came over HTTP, with each error written as above made the `Response` the data API would give. */
function revived(overrides: Overrides): Overrides {
  return Object.fromEntries(
    Object.entries(overrides).map(([key, value]) => [
      key,
      isErrorOverride(value) ? dataApiError(value.$error.status, value.$error.message ?? "unavailable", value.$error.headers) : value,
    ]),
  );
}

async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Starts the server on `port` (0 for any free port) on the loopback address. */
export async function startFixtureServer(port: number): Promise<FixtureServer> {
  let handle: Upstream["handle"] | undefined;
  /** Set once the server listens, when the bases are known. */
  let swap: ((overrides: Overrides | null) => void) | undefined;

  /**
   * The control path. It is for the suite's own tests and nothing else: a web page that was open in the browser under test must not be
   * able to change what the Worker is told, so it wants a JSON content type and a header, which a page can send to another origin only
   * after a preflight this server never answers.
   */
  async function control(request: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    const reply = (status: number, message?: string) => {
      outgoing.writeHead(status, message === undefined ? {} : { "Content-Type": "text/plain" });
      outgoing.end(message);
    };
    const method = request.method ?? "GET";
    if (method !== "PUT" && method !== "DELETE") return reply(405, "PUT or DELETE");
    if (request.headers["x-fixture-control"] !== "1") return reply(403, "a fixture control request carries X-Fixture-Control: 1");
    if (method === "DELETE") {
      swap!(null);
      return reply(204);
    }
    if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return reply(403, "the overrides are application/json");
    }
    try {
      const parsed: unknown = JSON.parse((await bodyOf(request)).toString("utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new TypeError("the overrides are a JSON object of override keys");
      swap!(revived(parsed as Overrides));
    } catch (error) {
      return reply(400, error instanceof Error ? error.message : String(error));
    }
    return reply(204);
  }

  const server = createServer(async (incoming, outgoing) => {
    try {
      if (new URL(incoming.url ?? "/", "http://127.0.0.1").pathname === CONTROL_PATH) return await control(incoming, outgoing);
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const method = incoming.method ?? "GET";
      const body = method === "GET" || method === "HEAD" ? undefined : await bodyOf(incoming);
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const request = new Request(new URL(incoming.url ?? "/", origin), { method, headers, body });
      const response = (await handle!(request)) ?? new Response(JSON.stringify({ result: "error", message: "not an upstream of the fixture server" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.writeHead(500, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify({ result: "error", message: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const bases: UpstreamBases = {
    xrpl: { dataApi: `${url}/xrpl`, node: `${url}/xrpl-node` },
    xahau: { dataApi: `${url}/xahau`, node: `${url}/xahau-node` },
  };
  const requests: SeenRequest[] = [];
  const upstreamWith = (overrides?: Overrides) => createUpstream({ files: onDisk, bases, primary: "xrpl", overrides, requests });
  const recorded = upstreamWith();
  handle = recorded.handle;
  swap = (overrides) => {
    // Made before it is used: a key that is none throws here and leaves the answers as they were.
    handle = (overrides === null ? recorded : upstreamWith(overrides)).handle;
  };

  return {
    url,
    requests,
    override: (overrides) => swap!(overrides),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
