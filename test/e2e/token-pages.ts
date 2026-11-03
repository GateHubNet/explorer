// What the specs of the token pages share (tokens.spec.ts, tokens-live.spec.ts, names-pages.ts and a11y.spec.ts's block of them): the tokens the pages look at, found in the fixtures' files
// (scripts/token-fixtures.ts) by the rules of test/support/token-case-rules.ts, never from a table of tokens, and the pages' own data read back from the files, so that a count or a name
// the specs expect is the fixtures' and not a number written here. The Worker's specs find the same cases with the same rules (test/support/token-cases.ts), but through
// `import.meta.glob`, which only Vite knows, so the Playwright process reads the files itself, with Node's `fs`. The answers are D6's, generated (test/fixtures/PROVENANCE.md, "Token
// answers"); nothing here calls any of them recorded.

import { readdirSync, readFileSync } from "node:fs";

import type { TokenAnswer, TokenDetail, TokenHoldersResponse, TokensResponse, TokenTransfersResponse } from "../../app/server/api-types";
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
} from "../support/token-case-rules";
import type { Net } from "./names-pages";

export type { TokenCase, TokenCaseResult, TokenMarkerResult };

const ROOT = new URL("../fixtures/http/", import.meta.url);

const namesIn = (directory: URL): string[] => {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
};

const cache = new Map<Net, TokenSources>();

/** What the rules read, from the network's files; read once. Each file is a path below `<net>/data-api/`, as `isTokenSource` takes it. */
function sourcesOf(net: Net): TokenSources {
  let sources = cache.get(net);
  if (sources === undefined) {
    const base = new URL(`${net}/data-api/`, ROOT);
    const paths: string[] = [];
    for (const name of namesIn(base)) if (isTokenSource(name)) paths.push(name);
    for (const directory of ["tokens", "amm"]) {
      for (const name of namesIn(new URL(`${directory}/`, base))) {
        if (isTokenSource(`${directory}/${name}`)) paths.push(`${directory}/${name}`);
        else if (directory === "tokens") {
          for (const file of namesIn(new URL(`${directory}/${name}/`, base))) if (isTokenSource(`${directory}/${name}/${file}`)) paths.push(`${directory}/${name}/${file}`);
        }
      }
    }
    sources = tokenSourcesOf(paths.map((path) => [path, readFileSync(new URL(path, base), "utf8")] as const));
    cache.set(net, sources);
  }
  return sources;
}

/** The token of `which`: as the ledger holds it, and `path`, its canonical URL segment. Throws when the network's fixtures hold none. */
export function tokenCase(net: Net, which: TokenCase): TokenCaseResult {
  const found = resolveTokenCase(net, which, sourcesOf(net));
  if (found === undefined) throw new Error(`the ${net} fixtures have no ${which} token`);
  return found;
}

/** A token whose holders have a second page (its canonical URL segment) and that page's marker. */
export function holdersMarker(net: Net): TokenMarkerResult {
  const found = resolveHoldersMarker(sourcesOf(net));
  if (found === undefined) throw new Error(`the ${net} fixtures have no token with a second page of holders`);
  return found;
}

/** A token whose transfers have a second page (its canonical URL segment) and that page's marker. */
export function transfersMarker(net: Net): TokenMarkerResult {
  const found = resolveTransfersMarker(sourcesOf(net));
  if (found === undefined) throw new Error(`the ${net} fixtures have no token with a second page of transfers`);
  return found;
}

/**
 * The list's answer the fixtures hold for a view, as the data API gives it: its 20 tokens, its totals and the marker of the next page. `q` is a search, `all` the view with the tokens of
 * fewer than 10 holders (the file names write the query sorted by name: `tokens@kind=issued&limit=20&min_holders=10&q=USD.json`). The first page of the default view is `listOf(net)`.
 */
export function listOf(net: Net, { q, all = false }: { q?: string; all?: boolean } = {}): TokensResponse {
  const name = `tokens@kind=issued&limit=20${all ? "" : "&min_holders=10"}${q === undefined ? "" : `&q=${q}`}.json`;
  return JSON.parse(readFileSync(new URL(`${net}/data-api/${name}`, ROOT), "utf8")) as TokensResponse;
}

/** The detail the fixtures hold of a token (`tokens/<CUR>.<issuer>.json`), by the case or, for a token the case rules do not name, by its currency and issuer. */
export function detailOf(net: Net, which: TokenCase | { currency: string; issuer: string }): TokenDetail {
  const { currency, issuer } = typeof which === "string" ? tokenCase(net, which) : which;
  const file = new URL(`${net}/data-api/tokens/${currency}.${issuer}.json`, ROOT);
  return (JSON.parse(readFileSync(file, "utf8")) as TokenAnswer).token;
}

/** A token's own holders, its first page of 50 (`tokens/<CUR>.<issuer>/holders@limit=50.json`), as the data API gives it. */
export function holdersOf(net: Net, which: TokenCase): TokenHoldersResponse {
  const { currency, issuer } = tokenCase(net, which);
  const sources = sourcesOf(net);
  const page = sources.holders.get(`${currency}.${issuer}`);
  if (page === undefined) throw new Error(`the ${net} fixtures have no holders of the ${which} token`);
  return page;
}

/** A token's transfers, its first page of 20 (`tokens/<CUR>.<issuer>/transfers@descending=true&limit=20.json`), as the data API gives it. */
export function transfersOf(net: Net, which: TokenCase): TokenTransfersResponse {
  const { currency, issuer } = tokenCase(net, which);
  const page = sourcesOf(net).transfers.get(`${currency}.${issuer}`);
  if (page === undefined) throw new Error(`the ${net} fixtures have no transfers of the ${which} token`);
  return page;
}
