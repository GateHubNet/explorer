import { describe, expect, it } from "vitest";

import { NAMES_OFF, NO_NAMES, type NamesPart, type NameView } from "../../domain/names";
import type { HomeLoaderData } from "../../server/home-view";
import { mergeHomeBeat } from "./home-beat";

// What the home page shows for a beat of the live page (the route's `createLiveOnScreen` merge): the beat's answer, with the names of the beat before kept when the beat's names
// call failed (`keepLoaded`, display names spec 3.4) and the names of rows that left the page kept for the rows that stay (`mergeNames`). Fictional names.

const FIRST = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const SECOND = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const THIRD = "rLUEXYuLiQptky37CqLcm9USQpPiz5rkpD";

const verified = (text: string, domain: string): NameView => ({ name: { text, kind: "verified" }, domain, labels: [] });
const NORTHPEAK = verified("Northpeak Treasury", "northpeak.example");
const TIDEWATER = verified("Tidewater Reserve", "tidewater.example");
const HARBORLINE: NameView = { name: { text: "Harborline Exchange", kind: "account" }, network: "hot wallet", labels: ["advisory"] };

const part = (state: NamesPart["state"], map: NamesPart["map"] = {}): NamesPart => ({ state, map });

/** A page at ledger `index`, made by build `build`, whose rows are the accounts and whose names part is `names`. */
function page(index: number, accounts: string[], names: NamesPart, build = "abc1234"): HomeLoaderData {
  return {
    build,
    latest: { index, hash: "AB".repeat(32), closeTime: 1792256472 + index, supply: "99985312446.118204" },
    txCount: 84,
    average: { transactions: 78, ledgers: 2 },
    fees: { total: "0.001284", average: "0.000015", max: "0.00012" },
    ledgers: [{ index, txCount: 84, closeTime: 1792256472 + index }],
    transactions: accounts.map((account, i) => ({
      type: "Payment",
      hash: `${index}${i}`.padStart(64, "0"),
      account,
      amount: null,
      ok: true,
      code: "tesSUCCESS",
      date: 1792256472 + index,
    })),
    examples: [],
    names,
  };
}

describe("mergeHomeBeat", () => {
  it("keeps the names part that is shown when the beat's names call failed: ok, with the earlier map, and the rest from the beat", () => {
    const shown = page(100, [FIRST, SECOND], part("ok", { [FIRST]: NORTHPEAK, [SECOND]: HARBORLINE }));
    const next = page(101, [THIRD, FIRST], part("failed"));

    const merged = mergeHomeBeat(next, shown);

    expect(merged.names.state).toBe("ok");
    expect(merged.names.map).toEqual({ [FIRST]: NORTHPEAK, [SECOND]: HARBORLINE });
    // The rows and the tiles are the beat's: only the names are kept.
    expect(merged.latest.index).toBe(101);
    expect(merged.transactions.map((row) => row.account)).toEqual([THIRD, FIRST]);
  });

  it("keeps the earlier map, not the beat's half answer, when the call failed for some of the addresses: a failed part with entries is replaced by the one shown", () => {
    const shown = page(100, [FIRST], part("ok", { [FIRST]: NORTHPEAK }));
    const next = page(101, [FIRST, SECOND], part("failed", { [SECOND]: TIDEWATER }));

    const merged = mergeHomeBeat(next, shown);

    expect(merged.names.state).toBe("ok");
    expect(merged.names.map).toEqual({ [FIRST]: NORTHPEAK });
  });

  it("merges the maps when the beat's names arrived: the beat's entry wins, the rows that left keep theirs", () => {
    const shown = page(100, [FIRST, SECOND], part("ok", { [FIRST]: NORTHPEAK, [SECOND]: HARBORLINE }));
    const updated = verified("Northpeak Custody", "northpeak.example");
    const next = page(101, [FIRST, THIRD], part("ok", { [FIRST]: updated, [THIRD]: TIDEWATER }));

    const merged = mergeHomeBeat(next, shown);

    expect(merged.names.state).toBe("ok");
    expect(merged.names.map).toEqual({ [FIRST]: updated, [SECOND]: HARBORLINE, [THIRD]: TIDEWATER });
  });

  it("takes the beat's names as they are when nothing was shown yet to keep", () => {
    const next = page(101, [FIRST], part("ok", { [FIRST]: NORTHPEAK }));
    expect(mergeHomeBeat(next, page(100, [], NO_NAMES)).names).toEqual({ state: "ok", map: { [FIRST]: NORTHPEAK } });
  });

  it("stays failed when the beat failed and the page shows no names either: there is nothing to keep, and the half answer is not thrown away", () => {
    const shown = page(100, [FIRST], part("failed"));
    const next = page(101, [FIRST, SECOND], part("failed", { [SECOND]: TIDEWATER }));

    const merged = mergeHomeBeat(next, shown);

    expect(merged.names.state).toBe("failed");
    expect(merged.names.map).toEqual({ [SECOND]: TIDEWATER });
  });

  it("gets its names from the beat after a beat that failed: the page that showed the failure shows the names that arrive", () => {
    const shown = page(100, [FIRST], part("failed"));
    const next = page(101, [FIRST], part("ok", { [FIRST]: NORTHPEAK }));
    expect(mergeHomeBeat(next, shown).names).toEqual({ state: "ok", map: { [FIRST]: NORTHPEAK } });
  });

  it("stays off when the beat has the switch off: no map of the page before is carried over", () => {
    const shown = page(100, [FIRST], part("ok", { [FIRST]: NORTHPEAK }));
    const merged = mergeHomeBeat(page(101, [FIRST], NAMES_OFF), shown);
    expect(merged.names).toEqual({ state: "off", map: {} });
    expect(merged.names).toBe(NAMES_OFF);
  });

  it("changes nothing else of the beat: the answer is the beat's but for the names", () => {
    const shown = page(100, [FIRST], part("ok", { [FIRST]: NORTHPEAK }));
    const next = page(101, [SECOND], part("failed"));
    const { names: _kept, ...rest } = mergeHomeBeat(next, shown);
    const { names: _failed, ...expected } = next;
    expect(rest).toEqual(expected);
  });
});
