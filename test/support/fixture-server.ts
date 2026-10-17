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
// Node only: it is not imported from anything that runs in the Workers runtime.

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";

import { createUpstream, type FixtureFiles, type SeenRequest, type UpstreamBases } from "./upstream-core";

const ROOT = new URL("../fixtures/http/", import.meta.url);

/** The fixture files on disk. A path with a `.` or `..` segment is none of ours, whatever a request asked for. */
const onDisk: FixtureFiles = {
  async read(path) {
    if (path.includes("\\") || path.includes("\0") || path.split("/").some((segment) => segment === ".." || segment === ".")) {
      return undefined;
    }
    try {
      return await readFile(fileURLToPath(new URL(path, ROOT)), "utf8");
    } catch {
      return undefined;
    }
  },
};

export interface FixtureServer {
  /** `http://127.0.0.1:<port>`, the origin the base paths above hang from. */
  url: string;
  /** Every request answered, in order. */
  requests: SeenRequest[];
  /** Stops listening and drops the open connections. */
  close(): Promise<void>;
}

async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Starts the server on `port` (0 for any free port) on the loopback address. */
export async function startFixtureServer(port: number): Promise<FixtureServer> {
  let handle: ReturnType<typeof createUpstream>["handle"] | undefined;

  const server = createServer(async (incoming, outgoing) => {
    try {
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
  const upstream = createUpstream({ files: onDisk, bases, primary: "xrpl" });
  handle = upstream.handle;

  return {
    url,
    requests: upstream.requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
