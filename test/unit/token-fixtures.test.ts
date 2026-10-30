import { readFileSync } from "node:fs";

import BigNumber from "bignumber.js";
import { isValidClassicAddress } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

import { assetText, sameAsset, type Asset } from "../../app/domain/asset";
import type { AmmPool, IssuedTokenRow, TokenAnswer, TokenHolder, TokenHoldersResponse, TokensResponse, TokenTransfer, TokenTransfersResponse } from "../../app/server/api-types";
import { checkToken, checkTokenHolders, checkTokens, checkTokenTransfers } from "../../app/server/token-shape";
import { dataApiLastValidated, encodeMarker, generate, inLedgerOrder, isTokenGenerated, readLedgers, txMarker, type RawLedger } from "../../scripts/http-fixtures";
import { NAMES_SOURCES } from "../../scripts/names-fixtures";
import { FEATURED_XRPL_TOKENS, tokenFixtures } from "../../scripts/token-fixtures";
import { resolveHoldersMarker, resolveTokenCase, resolveTransfersMarker, TOKEN_CASE_NET, TOKEN_CASES, tokenPath, tokenSourcesOf, type TokenSources } from "../support/token-case-rules";
import { createUpstream, dataApiFile, type NetworkName } from "../support/upstream-core";

// The token pages' fixtures (scripts/token-fixtures.ts; test/fixtures/PROVENANCE.md, "Token answers"), as `generate()` writes them, against the keys and rules of D6 (data-api
// `feat/explorer-data-2` at 2fb4183, docs/api-reference.md, "Tokens") and the client's shape checks, which are the one place that says what an answer of D6 must hold.

type Json = Record<string, any>;
const NETS: NetworkName[] = ["xrpl", "xahau"];

const generated = generate();
/** A network's token files: the path below `<net>/data-api/` and the text. */
const tokenFiles = (net: NetworkName): Array<[path: string, text: string]> =>
  [...generated].filter(([path]) => path.startsWith(`${net}/data-api/tokens`)).map(([path, text]) => [path.slice(`${net}/data-api/`.length), text]);
const read = (net: NetworkName, path: string): Json => {
  const text = generated.get(`${net}/data-api/${path}`);
  if (text === undefined) throw new Error(`no file ${net}/data-api/${path}`);
  return JSON.parse(text) as Json;
};
const list = (net: NetworkName, query: string): TokensResponse => read(net, `tokens@${query}.json`) as TokensResponse;

/** Each page of a list: the first, then the file its marker names, until a page has none. A page that goes on has a file. */
function pagesOf<T extends { marker?: string }>(first: T, next: (marker: string) => T): T[] {
  const pages = [first];
  for (let page = first; page.marker !== undefined; pages.push(page)) page = next(page.marker);
  return pages;
}
const listPages = (net: NetworkName, filter: "" | "&min_holders=10"): TokensResponse[] => {
  // The file's name has its query sorted: `kind`, `limit`, `marker`, `min_holders`.
  const named = (marker?: string) => `kind=issued&limit=20${marker === undefined ? "" : `&marker=${marker}`}${filter}`;
  return pagesOf(list(net, named()), (marker) => list(net, named(marker)));
};
const everyToken = (net: NetworkName): IssuedTokenRow[] => listPages(net, "").flatMap((page) => page.tokens);

/** A network's tokens with a page: the file's `<CUR>.<issuer>` and its answer. */
const details = (net: NetworkName): Array<[segment: string, answer: TokenAnswer]> =>
  tokenFiles(net).flatMap(([path, text]) => {
    const segment = /^tokens\/([^/]+)\.json$/.exec(path)?.[1];
    return segment === undefined ? [] : [[segment, JSON.parse(text) as TokenAnswer]];
  });
const holderPages = (net: NetworkName, segment: string): TokenHoldersResponse[] =>
  pagesOf(read(net, `tokens/${segment}/holders@limit=50.json`) as TokenHoldersResponse, (marker) => read(net, `tokens/${segment}/holders@limit=50&marker=${marker}.json`) as TokenHoldersResponse);
const transferPages = (net: NetworkName, segment: string): TokenTransfersResponse[] =>
  pagesOf(
    read(net, `tokens/${segment}/transfers@descending=true&limit=20.json`) as TokenTransfersResponse,
    (marker) => read(net, `tokens/${segment}/transfers@descending=true&limit=20&marker=${marker}.json`) as TokenTransfersResponse,
  );

const sources = (net: NetworkName): TokenSources => {
  const prefix = `${net}/data-api/`;
  return tokenSourcesOf([...generated].filter(([path]) => path.startsWith(prefix)).map(([path, text]) => [path.slice(prefix.length), text] as const));
};

/** D6's key lines ("Keys of …, in order"), copied from the reference at the pin: a key marked `?` can be missing. */
const KEY_LINES = {
  coverage: "from_ledger_index?, complete",
  listAnswer: "result, coverage, kind, ledger_index?, close_time?, totals?, total?, total_below?, count, marker?, tokens",
  totals: "tokens, tokens_with_10_holders, holders?, native_volume?",
  row: "rank, currency, code?, issuer, holders, trust_lines, supply, price?, price_change?, price_time?, native_volume?, trades?, domain?, listed, name?",
  tokenAnswer: "result, coverage, ledger_index, close_time, token",
  token: "currency, code?, issuer, holders, trust_lines, supply, price?, price_change?, price_time?, native_volume?, trades?, domain?, toml_url?, listed, toml?, issuer_settings?, markets, last_ledger",
  toml: "name?, desc?, icon?, symbol?, display_decimals?, asset_class?, asset_subclass?, attestation?",
  settings: "transfer_fee, global_freeze, no_freeze, allow_trust_line_clawback, require_auth, default_ripple",
  market: "counter_currency, counter_issuer?, count, volume, counter_volume, native_volume?, last, change?, last_time, amm_pool?",
  holdersAnswer: "result, coverage, ledger_index, close_time, supply, count, marker?, holders",
  holder: "rank, holder, balance, share, limit, frozen, authorized",
  transfersAnswer: "result, coverage, count, marker?, transfers",
  transfer: "hash, ledger_index, executed_time, source, destination, amount, source_tag?, destination_tag?",
} as const;

/** Throws unless `value`'s keys are the line's, in its order, every key without `?` there. */
function expectKeys(value: Json, line: string, where: string): void {
  const keys = line.split(", ");
  const names = keys.map((key) => key.replace(/\?$/, ""));
  const present = Object.keys(value);
  expect(present, where).toEqual(names.filter((name) => present.includes(name)));
  for (const key of keys) if (!key.endsWith("?")) expect(present, `${where}: ${key}`).toContain(key);
}

/** Which of D6's four answers a token file holds, by its name below `<net>/data-api/`. */
function routeOf(path: string): { route: "list" | "token" | "holders" | "transfers"; segment?: string } {
  if (path.startsWith("tokens@")) return { route: "list" };
  const match = /^tokens\/([^/]+?)(?:\/(holders|transfers)@.+)?\.json$/.exec(path);
  if (match === null) throw new Error(`${path}: no route of D6's`);
  return { route: (match[2] as "holders" | "transfers" | undefined) ?? "token", segment: match[1]! };
}

/** D6's order of the list: `holders` descending, then `issuer`, then `currency`. */
const inListOrder = (a: IssuedTokenRow, b: IssuedTokenRow): number => b.holders - a.holders || (a.issuer < b.issuer ? -1 : a.issuer > b.issuer ? 1 : 0) || (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0);

/** D6's search: a classic address is the tokens of that issuer; anything else a part of the code, the name or the domain (any case), the whole currency, or the start of the issuer. */
function matches(row: IssuedTokenRow, q: string): boolean {
  if (isValidClassicAddress(q)) return row.issuer === q;
  const within = (text: string | undefined) => text !== undefined && text.toLowerCase().includes(q.toLowerCase());
  return within(row.code) || within(row.name) || within(row.domain) || row.currency.toLowerCase() === q.toLowerCase() || row.issuer.startsWith(q);
}

/** `balance` over `supply`, rounded half up to 6 decimals, in whole numbers: not the generator's arithmetic. */
function shareOf(balance: string, supply: string): string {
  const scale = Math.max(balance.split(".")[1]?.length ?? 0, supply.split(".")[1]?.length ?? 0);
  const units = (text: string) => BigInt(text.replace(".", "") + "0".repeat(scale - (text.split(".")[1]?.length ?? 0)));
  const [b, s] = [units(balance), units(supply)];
  const millionths = (b * 2_000_000n + s) / (2n * s);
  return `${millionths / 1_000_000n}.${String(millionths % 1_000_000n).padStart(6, "0")}`;
}

const sumOf = (texts: readonly string[]): string => texts.reduce((sum, text) => sum.plus(text), new BigNumber(0)).toFixed();

describe.each(NETS)("%s", (net) => {
  it(`every file holds D6's keys in their order`, () => {
    for (const [path, text] of tokenFiles(net)) {
      const body = JSON.parse(text) as Json;
      const { route } = routeOf(path);
      expectKeys(body.coverage, KEY_LINES.coverage, `${path} coverage`);
      if (route === "list") {
        expectKeys(body, KEY_LINES.listAnswer, path);
        expectKeys(body.totals, KEY_LINES.totals, `${path} totals`);
        for (const row of body.tokens) expectKeys(row, KEY_LINES.row, `${path} rank ${row.rank}`);
      } else if (route === "token") {
        expectKeys(body, KEY_LINES.tokenAnswer, path);
        expectKeys(body.token, KEY_LINES.token, `${path} token`);
        if (body.token.toml !== undefined) expectKeys(body.token.toml, KEY_LINES.toml, `${path} toml`);
        if (body.token.issuer_settings !== undefined) expectKeys(body.token.issuer_settings, KEY_LINES.settings, `${path} issuer_settings`);
        for (const market of body.token.markets) expectKeys(market, KEY_LINES.market, `${path} market ${market.counter_currency}`);
      } else if (route === "holders") {
        expectKeys(body, KEY_LINES.holdersAnswer, path);
        for (const holder of body.holders) expectKeys(holder, KEY_LINES.holder, `${path} rank ${holder.rank}`);
      } else {
        expectKeys(body, KEY_LINES.transfersAnswer, path);
        for (const transfer of body.transfers) expectKeys(transfer, KEY_LINES.transfer, `${path} ${transfer.hash}`);
      }
    }
  });

  // The client's shape checks say what an answer of D6 must hold (P1). The checks delete a key they cannot read, so what they got is compared with what they gave.
  it("every file passes the client's shape check of its route, and keeps every key", () => {
    const counted = { list: 0, token: 0, holders: 0, transfers: 0 };
    for (const [path, text] of tokenFiles(net)) {
      const { route, segment } = routeOf(path);
      const body = JSON.parse(text) as Json;
      if (route === "list") checkTokens(body, path);
      else if (route === "token") {
        const dot = segment!.lastIndexOf(".");
        checkToken(body, path, { currency: segment!.slice(0, dot), issuer: segment!.slice(dot + 1) });
      } else if (route === "holders") checkTokenHolders(body, path);
      else checkTokenTransfers(body, path);
      expect(body, path).toEqual(JSON.parse(text));
      counted[route]++;
    }
    expect(counted.list).toBeGreaterThanOrEqual(11);
    expect(counted.token).toBe(net === "xrpl" ? 4 : 2);
    expect(counted.holders).toBeGreaterThan(counted.token);
    expect(counted.transfers).toBeGreaterThanOrEqual(counted.token);
  });

  it("every answer says the coverage from the first recorded ledger, never complete, and the list, the detail and the holders are as of the newest ledger", () => {
    const ledgers = readLedgers(net);
    const coverage = { from_ledger_index: Number(ledgers[0]!.ledger.ledger_index), complete: false };
    const last = dataApiLastValidated(ledgers.at(-1)!);
    for (const [path, text] of tokenFiles(net)) {
      const body = JSON.parse(text) as Json;
      expect(body.coverage, path).toEqual(coverage);
      if (routeOf(path).route === "transfers") continue;
      expect([body.ledger_index, body.close_time], path).toEqual([Number(last.ledger_index), last.close_time]);
    }
  });

  it("the fixture server answers an unknown token as the files do: 404s for it and its holders, and an empty page of transfers with the same coverage", async () => {
    const upstream = createUpstream({
      files: { read: async () => undefined },
      bases: { xrpl: { dataApi: "http://f.test/xrpl", node: "http://f.test/xrpl-node" }, xahau: { dataApi: "http://f.test/xahau", node: "http://f.test/xahau-node" } },
      primary: "xrpl",
    });
    const get = async (path: string) => (await upstream.handle(new Request(`http://f.test/${net}${path}`, { headers: { "X-API-Key": "k" } })))!;
    const token = "ZZZ.rrrrrrrrrrrrrrrrrrrrBZbvji";
    const transfers = await get(`/v2/tokens/${token}/transfers?descending=true&limit=20`);
    expect(transfers.status).toBe(200);
    const body = (await transfers.json()) as TokenTransfersResponse;
    expect(body).toEqual({ result: "success", coverage: list(net, "kind=issued&limit=1&min_holders=10").coverage, count: 0, transfers: [] });
    expect(() => checkTokenTransfers(body, "transfers")).not.toThrow();
  });

  it("ranks run on across marker pages, and pages concatenate without a token twice", () => {
    const families: Array<["" | "&min_holders=10", number]> = [
      ["&min_holders=10", 3],
      ["", 5],
    ];
    for (const [filter, pages] of families) {
      const shown = listPages(net, filter);
      expect(shown.length, filter).toBe(pages);
      const rows = shown.flatMap((page) => page.tokens);
      expect(rows.map((row) => row.rank), filter).toEqual(rows.map((_, at) => at + 1));
      expect(new Set(rows.map((row) => `${row.currency}.${row.issuer}`)).size, filter).toBe(rows.length);
      expect(rows, filter).toEqual([...rows].sort(inListOrder));
      for (const [at, page] of shown.entries()) {
        expect(page.count, filter).toBe(page.tokens.length);
        if (at < pages - 1) {
          expect(page.count, filter).toBe(20);
          const last = page.tokens.at(-1)!;
          // The marker holds the kind and the key of the last row, as D6's example does.
          expect(page.marker, filter).toBe(encodeMarker(["issued", last.holders, last.issuer, last.currency]));
        } else expect(page, filter).not.toHaveProperty("marker");
      }
    }
    // Every marker page is one of these: no page of a list is left out of it.
    const reached = listPages(net, "&min_holders=10").length + listPages(net, "").length;
    expect(tokenFiles(net).filter(([path]) => /^tokens@kind=issued&limit=20(&marker=[^&]+)?(&min_holders=10)?\.json$/.test(path)).length).toBe(reached);
  });

  it("total, total_below and totals agree with the rows", () => {
    const all = everyToken(net);
    const above = all.filter((row) => row.holders >= 10);
    const below = all.filter((row) => row.holders < 10);
    expect([above.length, below.length]).toEqual([60, 40]);
    for (const page of listPages(net, "&min_holders=10")) {
      expect([page.total, page.total_below]).toEqual([above.length, below.length]);
      expect(page.tokens.every((row) => row.holders >= 10)).toBe(true);
    }
    for (const page of listPages(net, "")) {
      expect(page.total).toBe(all.length);
      expect(page).not.toHaveProperty("total_below");
    }
    // The first page's first row, for the 404's coverage.
    const one = list(net, "kind=issued&limit=1&min_holders=10");
    expect([one.count, one.total, one.total_below, one.tokens]).toEqual([1, above.length, below.length, [above[0]]]);
    expect(one.marker).toBeDefined();

    // `totals` describe the whole kind, whatever the filters: in every list, and the same.
    const sum = all.reduce((total, row) => total + row.holders, 0);
    const lists = tokenFiles(net).filter(([path]) => path.startsWith("tokens@")).map(([, text]) => JSON.parse(text) as TokensResponse);
    for (const each of lists) expect(each.totals).toEqual(lists[0]!.totals);
    const totals = lists[0]!.totals!;
    expect([totals.tokens, totals.tokens_with_10_holders]).toEqual([all.length, above.length]);
    expect(totals.holders).toBeGreaterThanOrEqual(Math.max(...all.map((row) => row.holders)));
    expect(totals.holders).toBeLessThanOrEqual(sum);
    expect(totals.native_volume).toBe(sumOf(all.map((row) => row.native_volume ?? "0")));
  });

  it("the searches hold what D6's rule selects, ranked among themselves, and `q=USD` has more below 10 holders", () => {
    const all = everyToken(net);
    const issuer = net === "xrpl" ? "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B" : "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8";
    for (const q of ["USD", issuer]) {
      const selected = all.filter((row) => matches(row, q));
      const above = selected.filter((row) => row.holders >= 10);
      const page = list(net, `kind=issued&limit=20&min_holders=10&q=${q}`);
      expect(page.tokens.map(({ rank: _rank, ...row }) => row), q).toEqual(above.slice(0, 20).map(({ rank: _rank, ...row }) => row));
      expect(page.tokens.map((row) => row.rank), q).toEqual(page.tokens.map((_, at) => at + 1));
      expect([page.count, page.total, page.total_below], q).toEqual([above.length, above.length, selected.length - above.length]);
      // A search's first page is its whole answer: nothing behind it needs a file.
      expect(page, q).not.toHaveProperty("marker");
      expect(above.length, q).toBeGreaterThan(1);
    }
    // The "more among tokens with fewer than 10 holders" of `q=USD`, and its link to the same search with `all=1`.
    const selected = all.filter((row) => matches(row, "USD"));
    const every = list(net, "kind=issued&limit=20&q=USD");
    expect(list(net, "kind=issued&limit=20&min_holders=10&q=USD").total_below).toBeGreaterThan(0);
    expect(every.tokens.map(({ rank: _rank, ...row }) => row)).toEqual(selected.map(({ rank: _rank, ...row }) => row));
    expect(every.tokens.map((row) => row.rank)).toEqual(selected.map((_, at) => at + 1));
    expect([every.count, every.total]).toEqual([selected.length, selected.length]);
    expect(every).not.toHaveProperty("total_below");
    expect(every).not.toHaveProperty("marker");
  });

  it("the lists' first page draws both a price in exponent form and a row with no price, and the list holds a price from each set", () => {
    const first = list(net, "kind=issued&limit=20&min_holders=10").tokens;
    expect(first.some((row) => /e-\d+$/.test(row.price ?? ""))).toBe(true);
    expect(first.some((row) => row.price === undefined)).toBe(true);
    const all = everyToken(net);
    // A price from the day set has its change, one from the 30-day set a time and no change, and neither has a change without a price.
    expect(all.some((row) => row.price !== undefined && row.price_change !== undefined)).toBe(true);
    expect(all.some((row) => row.price !== undefined && row.price_change === undefined && row.price_time !== undefined)).toBe(true);
    expect(all.some((row) => /e\+\d+$/.test(row.price ?? ""))).toBe(true);
    for (const row of all) {
      if (row.price === undefined) expect([row.price_change, row.price_time, row.native_volume, row.trades], row.currency).toEqual([undefined, undefined, "0", 0]);
      else {
        expect(row.price_time, row.currency).toBeDefined();
        // 8 significant digits, whichever form.
        expect(row.price.replace(/e.*$/, "").replace(".", "").replace(/^0+/, "").length, `${row.currency} ${row.price}`).toBe(8);
      }
      expect(row.trust_lines, row.currency).toBeGreaterThanOrEqual(row.holders);
      if (row.holders === 0) expect(row.supply, row.currency).toBe("0");
      if (row.name !== undefined) expect(row.listed, row.currency).toBe(true);
      if (row.listed) expect(row.domain, row.currency).toBeDefined();
    }
    // Each form of a currency: 3 characters, a text of 40 hex digits with its code, a hex with none, and a code with a space.
    expect(all.some((row) => /^[A-Z0-9]{3}$/.test(row.currency) && row.code === row.currency)).toBe(true);
    expect(all.some((row) => /^[0-9A-F]{40}$/.test(row.currency) && row.code !== undefined)).toBe(true);
    expect(all.some((row) => /^[0-9A-F]{40}$/.test(row.currency) && row.code === undefined)).toBe(true);
    expect(all.some((row) => row.code?.includes(" "))).toBe(true);
  });

  it("every holder's share is its balance over supply, 6 decimals half up, and holders are ordered by balance", () => {
    for (const [segment, { token }] of details(net)) {
      const pages = holderPages(net, segment);
      const rows: TokenHolder[] = pages.flatMap((page) => page.holders);
      expect(rows.length, segment).toBe(token.holders);
      expect(token.holders, segment).toBeLessThanOrEqual(100);
      expect(rows.map((row) => row.rank), segment).toEqual(rows.map((_, at) => at + 1));
      expect(new Set(rows.map((row) => row.holder)).size, segment).toBe(rows.length);
      // The supply is the exact sum of the balances, on every page and in the detail.
      expect(token.supply, segment).toBe(sumOf(rows.map((row) => row.balance)));
      for (const page of pages) {
        expect(page.supply, segment).toBe(token.supply);
        expect(page.count, segment).toBe(page.holders.length);
      }
      for (const [at, row] of rows.entries()) {
        expect(row.share, `${segment} ${row.holder}`).toBe(shareOf(row.balance, token.supply));
        expect(row.holder, segment).not.toBe(token.issuer);
        if (at === 0) continue;
        const before = rows[at - 1]!;
        // By the balance as a double, then by the holder.
        expect(Number(before.balance) > Number(row.balance) || (Number(before.balance) === Number(row.balance) && before.holder < row.holder), `${segment} rank ${row.rank}`).toBe(true);
      }
      // A page that goes on has the marker of its last row; only the last page has none.
      for (const [at, page] of pages.entries()) {
        const last = page.holders.at(-1)!;
        if (at < pages.length - 1) expect(page.marker, segment).toBe(encodeMarker([Number(last.balance), last.holder]));
        else expect(page, segment).not.toHaveProperty("marker");
      }
      // The token page's ten: the first ten, with the marker of the tenth when there are more.
      const ten = read(net, `tokens/${segment}/holders@limit=10.json`) as TokenHoldersResponse;
      expect(ten.holders, segment).toEqual(rows.slice(0, 10));
      expect(ten.count, segment).toBe(ten.holders.length);
      if (rows.length > 10) expect(ten.marker, segment).toBe(encodeMarker([Number(rows[9]!.balance), rows[9]!.holder]));
      else expect(ten, segment).not.toHaveProperty("marker");
    }
  });

  it("a token's holders are the recordings' real addresses first, then seeded ones", () => {
    const ledgers = readLedgers(net);
    const known = new Set<string>();
    for (const raw of ledgers) for (const text of JSON.stringify(raw.ledger.transactions).match(/"r[1-9A-HJ-NP-Za-km-z]{24,34}"/g) ?? []) known.add(text.slice(1, -1));
    const featured = net === "xrpl" ? "524C555344000000000000000000000000000000.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" : "EVR.rEvernodee8dJLaFsujS6q1EiXvZYmHXr8";
    const rows = holderPages(net, featured).flatMap((page) => page.holders);
    const real = rows.findIndex((row) => !known.has(row.holder));
    const firstSeeded = real === -1 ? rows.length : real;
    expect(firstSeeded).toBeGreaterThan(10);
    expect(rows.slice(firstSeeded).every((row) => !known.has(row.holder))).toBe(true);
  });

  it("every issuer, holder, source and destination is a valid classic address", () => {
    let seen = 0;
    const valid = (address: string, where: string) => {
      expect(isValidClassicAddress(address), `${where}: ${address}`).toBe(true);
      seen++;
    };
    for (const [path, text] of tokenFiles(net)) {
      const body = JSON.parse(text) as Json;
      for (const row of body.tokens ?? []) valid(row.issuer, path);
      if (body.token !== undefined) {
        valid(body.token.issuer, path);
        for (const market of body.token.markets) if (market.counter_issuer !== undefined) valid(market.counter_issuer, path);
      }
      for (const row of body.holders ?? []) valid(row.holder, path);
      for (const row of body.transfers ?? []) {
        valid(row.source, path);
        valid(row.destination, path);
      }
    }
    expect(seen).toBeGreaterThan(300);
  });

  it("a token's page says what its list row says, its figures are its markets', and its markets are in D6's order", () => {
    const all = new Map(everyToken(net).map((row) => [`${row.currency}.${row.issuer}`, row]));
    const asOf = Date.parse(list(net, "kind=issued&limit=1&min_holders=10").close_time!);
    for (const [segment, { token, ledger_index }] of details(net)) {
      const row = all.get(segment);
      expect(row, segment).toBeDefined();
      for (const key of ["currency", "code", "issuer", "holders", "trust_lines", "supply", "price", "price_change", "price_time", "native_volume", "trades", "domain", "listed"] as const) {
        expect(token[key], `${segment} ${key}`).toEqual(row![key]);
      }
      expect(row!.name, segment).toBe(token.toml?.name);
      expect(segment, segment).toBe(`${token.currency}.${token.issuer}`);
      expect(token.last_ledger, segment).toBeLessThanOrEqual(ledger_index);
      // The toml is the listed entry's and the toml's URL the domain's.
      if (token.toml !== undefined) expect(token.listed, segment).toBe(true);
      expect(token.toml_url, segment).toBe(token.domain === undefined ? undefined : `https://${token.domain}/.well-known/${net === "xrpl" ? "xrp-ledger" : "xahau"}.toml`);

      const { markets } = token;
      if (token.native_volume !== "0" || markets.length > 0) {
        expect(token.native_volume, segment).toBe(sumOf(markets.map((market) => market.native_volume ?? "0")));
        expect(token.trades, segment).toBe(markets.reduce((sum, market) => sum + market.count, 0));
      }
      const native = markets.find((market) => market.counter_issuer === undefined);
      if (native !== undefined) {
        expect(native.counter_currency, segment).toBe(net === "xrpl" ? "XRP" : "XAH");
        expect([token.price, token.price_change, token.price_time], segment).toEqual([native.last, native.change, native.last_time]);
        expect(native.native_volume, segment).toBe(native.counter_volume);
      } else if (token.price !== undefined) {
        // The last trade of the 30-day set, not the day's: its time and no change.
        expect(token.price_change, segment).toBeUndefined();
        expect(asOf - Date.parse(token.price_time!), segment).toBeGreaterThan(86_400_000);
      }
      for (const [at, market] of markets.entries()) {
        expect(Date.parse(market.last_time), segment).toBeLessThanOrEqual(asOf);
        expect(asOf - Date.parse(market.last_time), segment).toBeLessThanOrEqual(86_400_000);
        if (at === 0) continue;
        const before = markets[at - 1]!;
        const [x, y] = [new BigNumber(before.native_volume ?? -1), new BigNumber(market.native_volume ?? -1)];
        expect(x.gt(y) || (x.eq(y) && before.count >= market.count), `${segment} ${market.counter_currency}`).toBe(true);
      }
    }
  });

  it("transfers are newest first with the markers of their rows, from two different accounts, and within the coverage", () => {
    const ledgers = readLedgers(net);
    const from = Number(ledgers[0]!.ledger.ledger_index);
    const to = Number(ledgers.at(-1)!.ledger.ledger_index);
    const places = recordedPlaces(ledgers);
    for (const [segment] of details(net)) {
      const pages = transferPages(net, segment);
      const rows = pages.flatMap((page) => page.transfers);
      expect(rows.length, segment).toBeGreaterThan(0);
      expect(new Set(rows.map((row) => row.hash)).size, segment).toBe(rows.length);
      for (const [at, row] of rows.entries()) {
        expect(row.source, segment).not.toBe(row.destination);
        expect(row.ledger_index, segment).toBeGreaterThanOrEqual(from);
        expect(row.ledger_index, segment).toBeLessThanOrEqual(to);
        if (at > 0) expect(rows[at - 1]!.ledger_index, segment).toBeGreaterThanOrEqual(row.ledger_index);
      }
      for (const [at, page] of pages.entries()) {
        expect(page.count, segment).toBe(page.transfers.length);
        if (at === pages.length - 1) expect(page, segment).not.toHaveProperty("marker");
        else {
          const last = page.transfers.at(-1)!;
          expect(page.marker, segment).toBe(txMarker(last.ledger_index, places.get(last.hash) ?? markerTxIndex(page.marker!)));
          expect(page.count, segment).toBe(20);
        }
      }
    }
  });

  it("has every TokenCase on its network, with its URL segment as `assetText` writes it, and no other network's", () => {
    const own = TOKEN_CASES.filter((which) => TOKEN_CASE_NET[which] === net);
    const of = sources(net);
    for (const which of own) {
      const found = resolveTokenCase(net, which, of);
      expect(found, which).toBeDefined();
      expect(found!.path, which).toBe(assetText({ currency: found!.currency, issuer: found!.issuer }));
    }
    for (const which of TOKEN_CASES.filter((each) => TOKEN_CASE_NET[each] !== net)) expect(resolveTokenCase(net, which, of), which).toBeUndefined();
    // Every row's segment is `assetText`'s, whatever form its currency has.
    for (const row of everyToken(net)) expect(tokenPath(row), row.currency).toBe(assetText({ currency: row.currency, issuer: row.issuer }));
  });

  it("has a token with a second page of holders, and the list a second page", () => {
    const of = sources(net);
    const holders = resolveHoldersMarker(of);
    expect(holders).toBeDefined();
    expect(of.list?.marker).toBeDefined();
    if (net === "xrpl") expect(resolveTransfersMarker(of)?.token).toBe("RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De");
    else expect(resolveTransfersMarker(of)).toBeUndefined();
  });

  it("the same output whatever order the files are written in", () => {
    const inputOf = (each: NetworkName) => {
      const ledgers = readLedgers(each);
      return { ledgers, last: dataApiLastValidated(ledgers.at(-1)!), pools: each === "xrpl" ? poolsOfFiles() : [] };
    };
    const input = inputOf(net);
    const text = (entries: ReturnType<typeof tokenFixtures>) => new Map(entries.map(({ path, query, value }) => [dataApiFile(net, path, query), JSON.stringify(value)]));
    const once = text(tokenFixtures(net, input));
    // No file is written twice.
    expect(once.size).toBe(tokenFixtures(net, input).length);
    // The other network first, and the recordings and the pools the other way round: a file is drawn from a seed of its own, not from what was drawn before it.
    tokenFixtures(net === "xrpl" ? "xahau" : "xrpl", inputOf(net === "xrpl" ? "xahau" : "xrpl"));
    const again = text(tokenFixtures(net, { ...input, ledgers: [...input.ledgers].reverse().map(reversedLedger), pools: [...input.pools].reverse() }));
    expect([...again.keys()].sort()).toEqual([...once.keys()].sort());
    for (const [path, value] of once) expect(again.get(path), path).toBe(value);
  });
});

/** The transaction index of every recorded payment: a marker's second number. */
function recordedPlaces(ledgers: readonly RawLedger[]): Map<string, number> {
  const places = new Map<string, number>();
  for (const raw of ledgers) for (const tx of inLedgerOrder(raw)) places.set(tx.hash, tx.metaData.TransactionIndex);
  return places;
}
/** The transaction index a marker names, for a seeded row. */
const markerTxIndex = (marker: string): number => (JSON.parse(Buffer.from(marker, "base64url").toString("utf8")) as [number, number])[1];
/** A ledger with its transactions the other way round. */
const reversedLedger = (raw: RawLedger): RawLedger => ({ ...raw, ledger: { ...raw.ledger, transactions: [...raw.ledger.transactions].reverse() } });
/** Every pool, from the AMM generator's files. */
const poolsOfFiles = (): AmmPool[] =>
  [...generated].filter(([path]) => /^xrpl\/data-api\/amm\/pools\/r[^/]+\.json$/.test(path)).map(([, text]) => (JSON.parse(text) as { pool: AmmPool }).pool);

describe("the featured tokens", () => {
  const token = (net: NetworkName, which: (typeof TOKEN_CASES)[number]) => {
    const found = resolveTokenCase(net, which, sources(net))!;
    return { found, answer: read(net, `tokens/${found.currency}.${found.issuer}.json`) as TokenAnswer };
  };

  it("are the ones the plan names", () => {
    expect(token("xrpl", "rlusd").found).toEqual({ currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", path: "RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De" });
    expect(token("xrpl", "usd").found).toEqual({ currency: "USD", issuer: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B", path: "USD.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B" });
    expect(token("xrpl", "lions").found).toEqual({ currency: "4C494F4E53000000000000000000000000000000", issuer: "rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS", path: "LIONS.rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS" });
    expect(token("xrpl", "few-holders").answer.token.holders).toBe(4);
    expect(token("xahau", "evr").found).toEqual({ currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8", path: "EVR.rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" });
    expect(token("xahau", "xahau-unlisted").answer.token.listed).toBe(false);
  });

  it("the LP token is the XRP/RLUSD pool's: its `03…` currency and its account", () => {
    const lp = resolveTokenCase("xrpl", "lp", sources("xrpl"))!;
    expect(lp).toEqual({ currency: "03B245BE580EC4F4386A751C084489EC4B514A2F", issuer: "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3", path: "03B245BE580EC4F4386A751C084489EC4B514A2F.rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3" });
    expect(generated.has(`xrpl/data-api/tokens/${lp.currency}.${lp.issuer}.json`)).toBe(false);
  });

  it("LIONS' settings are the node's: its `account_info` is recorded, with a domain and flags the data API's answer leaves out", () => {
    const { answer } = token("xrpl", "lions");
    expect(answer.token).not.toHaveProperty("issuer_settings");
    expect(answer.token).not.toHaveProperty("domain");
    expect(answer.token).not.toHaveProperty("toml_url");
    const recorded = JSON.parse(readFileSync(new URL("../fixtures/http/xrpl/node/account_info/rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS.json", import.meta.url), "utf8")) as Json;
    expect(recorded.result.account_data.Account).toBe("rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS");
    expect(recorded.result.status).toBe("success");
    expect(generated.has("xrpl/node/account_info/rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS.json")).toBe(false);
  });

  it("every featured XRPL token's markets flag the pools that exist, and every pools file holds what `amm_pool` says", () => {
    for (const asset of FEATURED_XRPL_TOKENS) {
      const answer = read("xrpl", `tokens/${asset.currency}.${asset.issuer}.json`) as TokenAnswer;
      const pools = (read("xrpl", `amm/pools@asset=${asset.currency}+${asset.issuer}&limit=20.json`) as { pools: AmmPool[] }).pools;
      const held: Asset = { currency: asset.currency, issuer: asset.issuer };
      for (const market of answer.token.markets) {
        const counter: Asset = market.counter_issuer === undefined ? { currency: market.counter_currency } : { currency: market.counter_currency, issuer: market.counter_issuer };
        const inPool = pools.some((pool) => {
          const [base, other]: Asset[] = [
            pool.base_issuer === undefined ? { currency: pool.base_currency } : { currency: pool.base_currency, issuer: pool.base_issuer },
            pool.counter_issuer === undefined ? { currency: pool.counter_currency } : { currency: pool.counter_currency, issuer: pool.counter_issuer },
          ];
          return (sameAsset(base!, held) && sameAsset(other!, counter)) || (sameAsset(other!, held) && sameAsset(base!, counter));
        });
        expect(market.amm_pool, `${asset.currency} / ${market.counter_currency}`).toBe(inPool);
      }
    }
    expect((read("xrpl", `tokens/${FEATURED_XRPL_TOKENS[0]!.currency}.${FEATURED_XRPL_TOKENS[0]!.issuer}.json`) as TokenAnswer).token.markets.some((market) => market.amm_pool)).toBe(true);
  });

  it("RLUSD's transfers are the newest recorded payments that delivered it; a token without any is seeded, and EVR's one recorded payment is its newest", () => {
    const delivered = (ledgers: readonly RawLedger[], currency: string, issuer: string): TokenTransfer[] => {
      const rows: TokenTransfer[] = [];
      for (const raw of [...ledgers].reverse()) {
        for (const tx of [...inLedgerOrder(raw)].reverse()) {
          const amount = (tx.metaData.DeliveredAmount ?? tx.Amount) as { currency?: string; issuer?: string; value?: string } | string | undefined;
          if (tx.TransactionType !== "Payment" || tx.metaData.TransactionResult !== "tesSUCCESS" || tx.Account === tx.Destination) continue;
          if (typeof amount !== "object" || amount.currency !== currency || amount.issuer !== issuer) continue;
          rows.push({
            hash: tx.hash,
            ledger_index: Number(raw.ledger.ledger_index),
            executed_time: "",
            source: tx.Account,
            destination: tx.Destination as string,
            amount: new BigNumber(amount.value!).toFixed(),
            ...(tx.SourceTag !== undefined && { source_tag: tx.SourceTag as number }),
            ...(tx.DestinationTag !== undefined && { destination_tag: tx.DestinationTag as number }),
          });
        }
      }
      return rows;
    };
    const blank = (row: TokenTransfer) => ({ ...row, executed_time: "" });

    const rlusd = resolveTokenCase("xrpl", "rlusd", sources("xrpl"))!;
    const ledgers = readLedgers("xrpl");
    const rows = transferPages("xrpl", `${rlusd.currency}.${rlusd.issuer}`).flatMap((page) => page.transfers);
    expect(rows.length).toBe(40);
    expect(rows.map(blank)).toEqual(delivered(ledgers, rlusd.currency, rlusd.issuer).slice(0, 40));
    expect(transferPages("xrpl", `${rlusd.currency}.${rlusd.issuer}`).length).toBe(2);

    const evr = resolveTokenCase("xahau", "evr", sources("xahau"))!;
    const recorded = delivered(readLedgers("xahau"), evr.currency, evr.issuer);
    const evrRows = transferPages("xahau", `${evr.currency}.${evr.issuer}`).flatMap((page) => page.transfers);
    expect(recorded.length).toBeGreaterThan(0);
    expect(evrRows.slice(0, recorded.length).map(blank)).toEqual(recorded);
    expect(evrRows.length).toBeGreaterThan(recorded.length);

    // A row from the issuer is an issue, one to it a redemption: a seeded token shows each.
    const usd = resolveTokenCase("xrpl", "usd", sources("xrpl"))!;
    const usdRows = transferPages("xrpl", `${usd.currency}.${usd.issuer}`).flatMap((page) => page.transfers);
    expect(usdRows.some((row) => row.source === usd.issuer)).toBe(true);
    expect(usdRows.some((row) => row.destination === usd.issuer)).toBe(true);
    expect(usdRows.some((row) => row.destination_tag === 0)).toBe(true);
  });

  it("holds each state a holder can be in, and each state of the toml card", () => {
    const first = (net: NetworkName, which: (typeof TOKEN_CASES)[number]) => {
      const { found } = token(net, which);
      return holderPages(net, `${found.currency}.${found.issuer}`).flatMap((page) => page.holders);
    };
    expect(first("xrpl", "rlusd").slice(0, 10).some((row) => row.frozen)).toBe(true);
    expect(token("xahau", "xahau-unlisted").answer.token.issuer_settings?.require_auth).toBe(true);
    expect(first("xahau", "xahau-unlisted").some((row) => row.authorized)).toBe(true);
    expect(first("xahau", "xahau-unlisted").some((row) => !row.authorized)).toBe(true);
    // Listed, a domain and not listed, and no domain; a token with no market.
    expect(token("xrpl", "rlusd").answer.token.toml).toBeDefined();
    expect(token("xrpl", "usd").answer.token.domain).toBeDefined();
    expect(token("xrpl", "usd").answer.token).not.toHaveProperty("toml");
    expect(token("xrpl", "few-holders").answer.token.markets).toEqual([]);
    expect(token("xrpl", "few-holders").answer.token).not.toHaveProperty("price");
    // LIONS' price is in the exponent form, and its market's `last` with it.
    expect(token("xrpl", "lions").answer.token.price).toMatch(/e-\d+$/);
  });
});

describe("the files", () => {
  it("are named by isTokenGenerated, which is true of no other generated file", () => {
    const named = [...generated.keys()].filter(isTokenGenerated);
    const own = NETS.flatMap((net) => tokenFiles(net).map(([path]) => `${net}/data-api/${path}`));
    expect(named.sort()).toEqual(own.sort());
    expect(isTokenGenerated("xrpl/data-api/tokens@kind=issued&limit=20.json")).toBe(true);
    expect(isTokenGenerated("xrpl/data-api/tokens/USD.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B.json")).toBe(true);
    expect(isTokenGenerated("xrpl/data-api/amm/pools@asset=USD+rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B&limit=20.json")).toBe(false);
  });

  it("put the list's issuers before the tokens' own files in the names' sources, after every other source", () => {
    const list = "tokens@kind=issued&limit=20.json";
    const detail = "tokens/USD.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B.json";
    const at = (path: string) => NAMES_SOURCES.findIndex((source) => source.test(path));
    expect(at(list)).toBe(NAMES_SOURCES.length - 2);
    expect(at(detail)).toBe(NAMES_SOURCES.length - 1);
  });

  it("are written in D6's key order, a row to a line", () => {
    const text = generated.get("xrpl/data-api/tokens@kind=issued&limit=1&min_holders=10.json")!;
    expect(text.indexOf('"result"')).toBeLessThan(text.indexOf('"coverage"'));
    expect(text.indexOf('"coverage"')).toBeLessThan(text.indexOf('"kind"'));
    expect(text).toMatch(/\n {4}\{"rank":1,"currency":"[^"]+",/);
  });

  it("name D6's commit and spec in PROVENANCE.md, with the recorded answer, and README.md lists them", () => {
    const provenance = readFileSync(new URL("../fixtures/PROVENANCE.md", import.meta.url), "utf8");
    const section = provenance.split(/^## /m).find((part) => part.startsWith("Token answers"));
    expect(section, 'PROVENANCE.md has a section "Token answers"').toBeDefined();
    for (const name of ["2fb4183", "docs/superpowers/specs/2026-10-24-issued-tokens-design.md", "docs/api-reference.md", "scripts/token-fixtures.ts"]) expect(section, name).toContain(name);
    const recorded = provenance.split(/^## /m).find((part) => part.startsWith("Recorded node answers"))!;
    expect(recorded).toContain("xrpl/node/account_info/rGHtf1GTfXEXSPxmZfnQrUMGUpajYqAuzS.json");
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    expect(readme).toContain("`data-api/tokens@kind=issued&limit=20");
    expect(readme).toContain("`scripts/token-fixtures.ts`");
  });
});
