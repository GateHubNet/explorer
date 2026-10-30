// The tokens of the fixtures (scripts/token-fixtures.ts, `pnpm fixtures:sync`) that the worker specs need: a token of each case the token pages draw, and the markers of the lists' second
// pages. Each case is found in the files' data by its rule in token-case-rules.ts (the rules the fixtures test checks the generator with), never from a table of tokens, so a change of the
// generator's seeds moves nothing here. Read from the fixture files themselves (Vite bundles them, as object-cases.ts and validators-cases.ts do), not through the client under test. The
// end-to-end suite cannot use this file (`import.meta.glob` is Vite's): it reads the same files with `fs` and hands them to the same rules.

import type { NetworkId } from "../../app/server/networks";
import {
  isTokenSource,
  resolveHoldersMarker,
  resolveTokenCase,
  resolveTransfersMarker,
  tokenSourcesOf,
  type TokenCase,
  type TokenCaseResult,
  type TokenMarkerResult,
  type TokenSources,
} from "./token-case-rules";

export { TOKEN_CASES, type TokenCase, type TokenCaseResult, type TokenMarkerResult } from "./token-case-rules";

const ROOT = "../fixtures/http/";
const files = import.meta.glob(
  [
    "../fixtures/http/*/data-api/tokens/*.json",
    "../fixtures/http/*/data-api/tokens/*/holders@limit=50.json",
    "../fixtures/http/*/data-api/tokens/*/transfers@descending=true&limit=20.json",
    "../fixtures/http/*/data-api/tokens@kind=issued&limit=20&min_holders=10.json",
    "../fixtures/http/*/data-api/amm/pools@asset=*&limit=20.json",
  ],
  { query: "?raw", import: "default" },
) as Record<string, () => Promise<string>>;

const cache = new Map<NetworkId, Promise<TokenSources>>();

/** What the rules read, from the network's files; read once. */
function sourcesOf(net: NetworkId): Promise<TokenSources> {
  let sources = cache.get(net);
  if (sources === undefined) {
    const prefix = `${ROOT}${net}/data-api/`;
    sources = (async () => {
      const paths = Object.keys(files).filter((path) => path.startsWith(prefix) && isTokenSource(path.slice(prefix.length)));
      return tokenSourcesOf(await Promise.all(paths.map(async (path) => [path.slice(prefix.length), await files[path]!()] as const)));
    })();
    cache.set(net, sources);
  }
  return sources;
}

/** The token of `which` on `net`: as the ledger holds it, and `path`, its canonical URL segment. Throws when the network's fixtures hold none. */
export async function tokenCase(net: NetworkId, which: TokenCase): Promise<TokenCaseResult> {
  const found = resolveTokenCase(net, which, await sourcesOf(net));
  if (found === undefined) throw new Error(`the ${net} fixtures have no ${which} token`);
  return found;
}

/** The marker of the list's second page (`/v2/tokens?kind=issued&limit=20&min_holders=10`). */
export async function tokensMarker(net: NetworkId): Promise<string> {
  const marker = (await sourcesOf(net)).list?.marker;
  if (marker === undefined) throw new Error(`the ${net} fixtures have no second page of tokens`);
  return marker;
}

/** A token (its canonical URL segment) whose transfers have a second page, and that page's marker. Only XRPL's RLUSD has one. */
export async function transfersMarker(net: NetworkId): Promise<TokenMarkerResult> {
  const found = resolveTransfersMarker(await sourcesOf(net));
  if (found === undefined) throw new Error(`the ${net} fixtures have no token with a second page of transfers`);
  return found;
}

/** A token (its canonical URL segment) whose holders have a second page, and that page's marker. */
export async function holdersMarker(net: NetworkId): Promise<TokenMarkerResult> {
  const found = resolveHoldersMarker(await sourcesOf(net));
  if (found === undefined) throw new Error(`the ${net} fixtures have no token with a second page of holders`);
  return found;
}
