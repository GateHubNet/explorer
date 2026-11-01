import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import { windowOf } from "../../app/domain/window";
import type { LastValidated, MintedPage, NetworkSupply } from "../../app/server/api-types";
import { checkMintedPage, checkSupply } from "../../app/server/supply-shape";
import { generate, isSupplyGenerated } from "../../scripts/http-fixtures";
import { SUPPLY_ROW_LISTS, supplyFixtures } from "../../scripts/supply-fixtures";
import { dataApiFile, type NetworkName } from "../support/upstream-core";

// The answers of D7's two routes that scripts/supply-fixtures.ts makes up (E12 spec 11): the rules of data-api's docs/api-reference.md (`GET /v2/network/supply` and `.../minted`, feat/explorer-data-2
// at 31e97efaa1a6e098435b666e8893c79a0c4bee66) are worked out here again from the answers themselves, with BigNumber, and checked. The inputs are those `generate()` hands over (the newest ledger
// of its own map), never the files on disk.

type Net = NetworkName;
const NETS: Net[] = ["xrpl", "xahau"];
const NATIVE = { xrpl: "XRP", xahau: "XAH" } as const;

const generated = generate();

const SUPPLY = (net: Net) => `${net}/data-api/network/supply.json`;
const MINTED = "xahau/data-api/network/supply/minted@end=2026-10-17&interval=day&limit=1000&start=2026-07-20.json";

function textOf(path: string): string {
  const text = generated.get(path);
  if (text === undefined) throw new Error(`generate() writes no ${path}`);
  return text;
}
const supplyOf = (net: Net): NetworkSupply => JSON.parse(textOf(SUPPLY(net))) as NetworkSupply;
const mintedOf = (): MintedPage => JSON.parse(textOf(MINTED)) as MintedPage;
const lastOf = (net: Net): LastValidated => JSON.parse(textOf(`${net}/data-api/last_validated.json`)) as LastValidated;

const big = (text: string) => new BigNumber(text);
const seconds = (time: string) => Date.parse(time) / 1000;

describe("the supply snapshot", () => {
  it("is ledger 107,720,688 on XRPL, about 50 minutes before last_validated, and the newest ledger on Xahau", () => {
    const xrpl = supplyOf("xrpl");
    expect(xrpl.ledger_index).toBe(107_720_688);
    // The recorded ledger closed at 16:11:02; last_validated (107,721,455) is at 17:01:12.
    const behind = seconds(lastOf("xrpl").close_time) - seconds(xrpl.close_time);
    expect(behind).toBeGreaterThanOrEqual(2700);
    expect(behind).toBeLessThanOrEqual(3300);

    const xahau = supplyOf("xahau");
    expect(xahau.ledger_index).toBe(26_596_843);
    expect(String(xahau.ledger_index)).toBe(lastOf("xahau").ledger_index);
    expect(xahau.close_time).toBe(lastOf("xahau").close_time);
  });

  it("was written 107 s (XRPL) and 29 s (Xahau) after its ledger closed", () => {
    expect(seconds(supplyOf("xrpl").computed_at) - seconds(supplyOf("xrpl").close_time)).toBe(107);
    expect(seconds(supplyOf("xahau").computed_at) - seconds(supplyOf("xahau").close_time)).toBe(29);
  });

  it.each(NETS)("%s: circulating is total less escrowed, and the reserves add up, exactly", (net) => {
    const s = supplyOf(net);
    expect(big(s.circulating.amount).toFixed()).toBe(big(s.total).minus(s.escrowed.amount).toFixed());
    const r = s.reserves!;
    expect(big(r.amount).toFixed()).toBe(big(r.base).times(r.accounts).plus(big(r.increment).times(r.owner_count)).toFixed());
  });

  it("burns, on the XRP Ledger, exactly 100 billion XRP less the total, and has no coverage for it", () => {
    const s = supplyOf("xrpl");
    expect(big(s.burned.amount).toFixed()).toBe(big("100000000000").minus(s.total).toFixed());
    expect("coverage" in s.burned).toBe(false);
  });

  it("is, on XRPL, D7's example: its figures, counts and coverages (the built reference's: from ledger 28,685,313 on every part, the reserves incomplete)", () => {
    const s = supplyOf("xrpl");
    expect([s.currency, s.total, s.burned.amount, s.escrowed.amount, s.escrowed.escrows, s.circulating.amount]).toEqual([
      "XRP",
      "99985312374.716318",
      "14687625.283682",
      "35212847105.402318",
      12879,
      "64772465269.314",
    ]);
    expect([s.amm!.amount, s.amm!.pools]).toEqual(["46218377.402915", 14594]);
    expect([s.reserves!.amount, s.reserves!.accounts, s.reserves!.owner_count, s.reserves!.base, s.reserves!.increment]).toEqual(["9810004", 6410280, 16998620, "1", "0.2"]);
    expect(s.minted).toBeUndefined();
    expect([s.escrowed.coverage, s.circulating.coverage, s.amm!.coverage]).toEqual(Array(3).fill({ from_ledger_index: 28685313, complete: true }));
    expect(s.reserves!.coverage).toEqual({ from_ledger_index: 28685313, complete: false });
  });

  it("is, on Xahau, D7's example: its figures and counts, every coverage from ledger 1 and complete", () => {
    const s = supplyOf("xahau");
    expect([s.currency, s.total, s.burned.amount, s.escrowed.amount, s.escrowed.escrows, s.circulating.amount]).toEqual([
      "XAH",
      "613401782.117306",
      "2318.640227",
      "18406227.318004",
      2140,
      "594995554.799302",
    ]);
    expect([s.reserves!.amount, s.reserves!.accounts, s.reserves!.owner_count]).toEqual(["268973.2", 186412, 412806]);
    const parts = [s.burned, s.minted!, s.escrowed, s.circulating, s.reserves!];
    for (const part of parts) expect(part.coverage).toEqual({ from_ledger_index: 1, complete: true });
  });

  it("has Xahau's minted as the sum of its sources, and no amm there; XRPL has an amm and no minted", () => {
    const s = supplyOf("xahau");
    const m = s.minted!;
    expect(big(m.amount).toFixed()).toBe(big(m.rewards).plus(m.import).plus(m.genesis_mint).toFixed());
    expect([m.amount, m.rewards, m.import, m.genesis_mint]).toEqual(["49425551.616207", "41203318.512207", "8102233.104", "120000"]);
    expect(s.amm).toBeUndefined();
    expect(supplyOf("xrpl").amm).toBeDefined();
  });

  it("keeps D7's key order, which the files do not sort away", () => {
    expect(Object.keys(supplyOf("xrpl"))).toEqual(["result", "ledger_index", "close_time", "computed_at", "currency", "total", "burned", "escrowed", "circulating", "amm", "reserves"]);
    expect(Object.keys(supplyOf("xahau"))).toEqual(["result", "ledger_index", "close_time", "computed_at", "currency", "total", "burned", "minted", "escrowed", "circulating", "reserves"]);
    expect(Object.keys(supplyOf("xahau").minted!)).toEqual(["amount", "rewards", "import", "genesis_mint", "coverage"]);
    expect(Object.keys(supplyOf("xrpl").reserves!)).toEqual(["amount", "accounts", "owner_count", "base", "increment", "coverage"]);
    expect(Object.keys(mintedOf())).toEqual(["result", "coverage", "count", "rows"]);
    expect(Object.keys(mintedOf().rows[0]!)).toEqual(["date", "amount", "rewards", "import", "genesis_mint"]);
  });

  it.each(NETS)("%s: passes the client's own shape check", (net) => {
    expect(checkSupply(supplyOf(net), "/v2/network/supply", NATIVE[net])).toEqual(supplyOf(net));
  });
});

describe("Xahau's minted days", () => {
  const page = mintedOf();
  const window = windowOf("2026-10-17", "90d");

  it("has the 90 days of the network page's window, oldest first, one row each, and no marker", () => {
    expect(window.start).toBe("2026-07-20");
    expect(page.rows.map((row) => row.date)).toEqual(window.buckets.map((day) => `${day}T00:00:00Z`));
    expect(page.rows).toHaveLength(90);
    expect(page.count).toBe(90);
    expect("marker" in page).toBe(false);
    expect(page.coverage).toEqual({ from_ledger_index: 1, complete: true });
    // The fees of the same window exist: the burned card and the minted card ask for the same days.
    expect(generated.has("xahau/data-api/network/fees@end=2026-10-17&interval=day&limit=1000&start=2026-07-20.json")).toBe(true);
  });

  it("has one GenesisMint day, 2026-09-14, and each amount the exact sum of its sources", () => {
    const withGenesis = page.rows.filter((row) => big(row.genesis_mint).gt(0));
    expect(withGenesis.map((row) => [row.date, row.genesis_mint])).toEqual([["2026-09-14T00:00:00Z", "40000"]]);
    for (const row of page.rows) {
      expect(row.amount, row.date).toBe(big(row.rewards).plus(row.import).plus(row.genesis_mint).toFixed());
    }
  });

  it("has rewards every day (25,000 to 35,000 XAH, six decimals at most) and imports on about four days in five (500 to 8,000)", () => {
    const [today, ...earlier] = [...page.rows].reverse();
    for (const row of earlier) {
      expect(big(row.rewards).gte(25_000) && big(row.rewards).lt(35_000), row.date).toBe(true);
      expect(big(row.rewards).decimalPlaces()!, row.date).toBeLessThanOrEqual(6);
      if (big(row.import).gt(0)) expect(big(row.import).gte(500) && big(row.import).lt(8_000), row.date).toBe(true);
    }
    const importDays = earlier.filter((row) => big(row.import).gt(0)).length;
    expect(importDays / earlier.length).toBeGreaterThan(0.7);
    expect(importDays / earlier.length).toBeLessThan(0.9);
    // The running day is the day so far: about a third of a day's rewards.
    expect(today!.date).toBe("2026-10-17T00:00:00Z");
    expect(big(today!.rewards).gte(25_000 / 3 - 1) && big(today!.rewards).lt(35_000 / 3 + 1)).toBe(true);
  });

  it("writes amounts as D7 does: no trailing zeros, no exponent, no sign", () => {
    for (const row of page.rows) {
      for (const text of [row.amount, row.rewards, row.import, row.genesis_mint]) expect(text).toMatch(/^(0|[1-9]\d*)(\.\d*[1-9])?$/);
    }
  });

  it("is a lot less than what the snapshot says Xahau minted since its first ledger", () => {
    const total = page.rows.reduce((sum, row) => sum.plus(row.amount), big("0"));
    expect(total.lt(supplyOf("xahau").minted!.amount)).toBe(true);
  });

  it("passes the client's own shape check", () => {
    expect(checkMintedPage(page, "/v2/network/supply/minted")).toEqual(page);
  });

  it("is written one row to a line", () => {
    const lines = textOf(MINTED).split("\n");
    expect(lines.filter((line) => line.trim().startsWith('{ "date"') || line.trim().startsWith('{"date"'))).toHaveLength(90);
    expect(SUPPLY_ROW_LISTS).toEqual(["rows"]);
  });
});

describe("the generator", () => {
  it("writes the XRP Ledger no minted file: its page does not ask for the days", () => {
    expect([...generated.keys()].filter((path) => path.startsWith("xrpl/") && isSupplyGenerated(path))).toEqual([SUPPLY("xrpl")]);
  });

  it("names, in isSupplyGenerated, every generated supply file and nothing else", () => {
    expect([...generated.keys()].filter(isSupplyGenerated).sort()).toEqual([MINTED, SUPPLY("xahau"), SUPPLY("xrpl")].sort());
    for (const path of generated.keys()) {
      if (!isSupplyGenerated(path)) continue;
      expect(path).toMatch(/^(xrpl|xahau)\/data-api\/network\/supply(\.json|\/minted@[^/]+\.json)$/);
    }
    // Others near it: the fees, the volumes and the NFT volume of the network are not its.
    for (const path of ["xrpl/data-api/network/fees@end=2026-10-17&interval=day&limit=1000&start=2026-07-20.json", "xahau/data-api/network/nft_volume@live=day.json", "xrpl/data-api/network/supply_other.json", "xrpl/data-api/network/supplyx/minted.json", "xrpl/node/supply.json", "xrpl/data-api/supply.json"]) {
      expect(isSupplyGenerated(path), path).toBe(false);
    }
    for (const path of [SUPPLY("xrpl"), SUPPLY("xahau"), MINTED]) expect(isSupplyGenerated(path), path).toBe(true);
  });

  it("finds its files by the paths the Worker asks for", () => {
    expect(dataApiFile("xrpl", "/v2/network/supply", "")).toBe(SUPPLY("xrpl"));
    expect(dataApiFile("xahau", "/v2/network/supply/minted", "start=2026-07-20&limit=1000&interval=day&end=2026-10-17")).toBe(MINTED);
  });

  it("gives the same output twice", () => {
    for (const net of NETS) {
      const snapshot = { ledger_index: supplyOf(net).ledger_index, close_time: supplyOf(net).close_time };
      expect(JSON.stringify(supplyFixtures(net, lastOf(net), snapshot))).toBe(JSON.stringify(supplyFixtures(net, lastOf(net), snapshot)));
    }
  });
});
