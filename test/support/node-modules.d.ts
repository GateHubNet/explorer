// The two Node modules test/support/ledgers.ts reads fixtures with. `tsconfig.cloudflare.json` (which covers app/
// and test/) deliberately has no `node` types: with them, DOM and Node would both declare `setTimeout` and friends
// for the app's code. Declaring these two modules lets that one test-only file typecheck without them.

declare module "node:fs" {
  export function readdirSync(path: URL): string[];
  export function readFileSync(path: URL): Uint8Array & { toString(encoding: "utf8"): string };
  export function readFileSync(path: URL, encoding: "utf8"): string;
}

declare module "node:zlib" {
  export function gunzipSync(buffer: Uint8Array): Uint8Array & { toString(encoding: "utf8"): string };
}
