import { describe, expect, it } from "vitest";

import { tokenOf } from "../../domain/fnv";
import { shortAddress } from "../../domain/format";
import { listedAccount } from "../../domain/listed-account";
import { NAMES_OFF, NO_NAMES, type NamesPart, type NameView } from "../../domain/names";
import type { LivePairData, OlderPairData, PairPageData } from "../../server/pair-view";
import { mergePairBeat, PAIR_PARTS } from "./pair-beat";

// What the market pair page shows for a beat of the live page (the route's `createLiveOnScreen` merge): the beat's answer, with every part that failed in the beat and is loaded on screen
// kept (`keepLoaded` over `PAIR_PARTS`: the names part among them, display names spec 3.4), and the names of accounts that left the page kept for the ones that stay (`mergeNames`).
// Fictional names.

const FIRST = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const SECOND = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const THIRD = "rLUEXYuLiQptky37CqLcm9USQpPiz5rkpD";

const verified = (text: string, domain: string): NameView => ({ name: { text, kind: "verified" }, domain, labels: [] });
const NORTHPEAK = verified("Northpeak Treasury", "northpeak.example");
const TIDEWATER = verified("Tidewater Reserve", "tidewater.example");
const HARBORLINE: NameView = { name: { text: "Harborline Exchange", kind: "account" }, network: "hot wallet", labels: ["advisory"] };

const part = (state: NamesPart["state"], map: NamesPart["map"] = {}): NamesPart => ({ state, map });

/** A live page at ledger `index`, made by build `build`, with the names part `names`; the parts that can fail are loaded. */
function live(index: number, names: NamesPart, over: Partial<LivePairData> = {}, build = "abc1234"): LivePairData {
  return {
    mode: "live",
    head: {
      title: "XRP/USD",
      heading: "XRP / USD",
      base: "XRP",
      counter: "USD",
      issuers: [],
      natives: ["XRP"],
      issued: [],
      issuedBy: "",
      invert: { label: "Show USD/XRP", href: "/xrpl/markets/USD/XRP" },
      firstPage: "/xrpl/markets/XRP/USD",
    },
    anchor: { lastValidated: index, closeTime: 1792256472 + index },
    build,
    indexable: true,
    view: [],
    ammParts: true,
    filters: { trades: null, interval: [] },
    price: { text: `2.${index}`, unit: "USD per XRP", note: null, token: `price-${index}` },
    stats: { state: "ok", items: [{ label: "24 h high", value: `${index}` }], note: null, change: null, token: `stats-${index}` },
    candles: { state: "ok", data: { axis: { unit: "hour", buckets: [] }, candles: [], format: { kind: "price", unit: "USD" }, volume: { kind: "amount", unit: "XRP" }, token: "c" }, source: "/v2/exchanges", empty: null },
    trades: { rows: [], paging: { newerHref: null, olderHref: null }, source: "/v2/exchanges", empty: "No trades yet." },
    book: { state: "failed", source: "live from the node · book_offers" },
    pool: { state: "missing" },
    share: { state: "off" },
    traders: tradersOf([FIRST], {}),
    names,
    ...over,
  };
}

/** The traders card a view builder makes (`tradersOf`) of `accounts` with the names `names`: a bar for each, written through `listedAccount`. */
function tradersOf(accounts: string[], names: NamesPart["map"] = {}): Extract<LivePairData["traders"], { state: "ok" }> {
  const items = accounts.map((account, at) => ({ id: account, ...listedAccount(account, names), href: `/xrpl/account/${account}`, value: String(1000 - at), count: String(10 - at) }));
  const format = { kind: "amount", unit: "XRP" } as const;
  return { state: "ok", data: { items, format, token: tokenOf({ items, format }) }, note: "", source: "/v2/active_accounts/{base}/{counter}" };
}

const older = (names: NamesPart = NO_NAMES): OlderPairData => ({
  mode: "older",
  head: live(1, NO_NAMES).head,
  build: "abc1234",
  view: ["older trades"],
  ammParts: true,
  note: { text: "Older trades of XRP/USD.", link: "the market's page", href: "/xrpl/markets/XRP/USD" },
  trades: live(1, NO_NAMES).trades,
  names,
});

describe("PAIR_PARTS", () => {
  it("is the parts of the page that can fail on their own, and the names", () => {
    expect([...PAIR_PARTS]).toEqual(["stats", "candles", "traders", "book", "pool", "share", "names"]);
  });
});

describe("mergePairBeat", () => {
  it("keeps the names part that is shown when the beat's names call failed: ok, with the earlier map, and the rest from the beat", () => {
    const shown = live(100, part("ok", { [FIRST]: NORTHPEAK, [SECOND]: HARBORLINE }));
    const next = live(101, part("failed"));

    const merged = mergePairBeat(next, shown);

    if (merged.mode !== "live") throw new Error("live");
    expect(merged.names.state).toBe("ok");
    expect(merged.names.map).toEqual({ [FIRST]: NORTHPEAK, [SECOND]: HARBORLINE });
    // The prices and the anchor are the beat's: only the names (and the parts that failed) are kept.
    expect(merged.anchor.lastValidated).toBe(101);
    expect(merged.price.text).toBe("2.101");
  });

  it("keeps the earlier map, not the beat's half answer, when the call failed for some of the addresses", () => {
    const shown = live(100, part("ok", { [FIRST]: NORTHPEAK }));
    const next = live(101, part("failed", { [SECOND]: TIDEWATER }));

    const merged = mergePairBeat(next, shown);

    if (merged.mode !== "live") throw new Error("live");
    expect(merged.names.state).toBe("ok");
    expect(merged.names.map).toEqual({ [FIRST]: NORTHPEAK });
  });

  it("merges the maps when the beat's names arrived: the beat's entry wins, and the accounts that left keep theirs", () => {
    const shown = live(100, part("ok", { [FIRST]: NORTHPEAK, [SECOND]: HARBORLINE }));
    const updated = verified("Northpeak Custody", "northpeak.example");
    const next = live(101, part("ok", { [FIRST]: updated, [THIRD]: TIDEWATER }));

    const merged = mergePairBeat(next, shown);

    if (merged.mode !== "live") throw new Error("live");
    expect(merged.names).toEqual({ state: "ok", map: { [FIRST]: updated, [SECOND]: HARBORLINE, [THIRD]: TIDEWATER } });
  });

  it("takes the beat's names as they are when nothing was shown yet to keep", () => {
    const next = live(101, part("ok", { [FIRST]: NORTHPEAK }));
    const merged = mergePairBeat(next, live(100, NO_NAMES));
    expect(merged).toMatchObject({ names: { state: "ok", map: { [FIRST]: NORTHPEAK } } });
  });

  it("stays failed when the beat failed and the page shows no names either: there is nothing to keep, and the half answer is not thrown away", () => {
    const shown = live(100, part("failed"));
    const next = live(101, part("failed", { [SECOND]: TIDEWATER }));

    const merged = mergePairBeat(next, shown);

    if (merged.mode !== "live") throw new Error("live");
    expect(merged.names).toEqual({ state: "failed", map: { [SECOND]: TIDEWATER } });
  });

  it("gets its names from the beat after a beat that failed", () => {
    const merged = mergePairBeat(live(101, part("ok", { [FIRST]: NORTHPEAK })), live(100, part("failed")));
    expect(merged).toMatchObject({ names: { state: "ok", map: { [FIRST]: NORTHPEAK } } });
  });

  it("stays off when the beat has the switch off: no map of the page before is carried over", () => {
    const merged = mergePairBeat(live(101, NAMES_OFF), live(100, part("ok", { [FIRST]: NORTHPEAK })));
    if (merged.mode !== "live") throw new Error("live");
    expect(merged.names).toEqual({ state: "off", map: {} });
    expect(merged.names).toBe(NAMES_OFF);
  });

  it("still keeps the other parts that failed in the beat and are loaded on screen, with the names part kept too", () => {
    const shown = live(100, part("ok", { [FIRST]: NORTHPEAK }), { book: { state: "ok", source: "s", ledger: "100", asks: [], bids: [], spread: "—", token: "b" } });
    const next = live(101, part("failed"), { book: { state: "failed", source: "s" } });

    const merged = mergePairBeat(next, shown);

    if (merged.mode !== "live") throw new Error("live");
    expect(merged.book).toBe(shown.book);
    expect(merged.names.map).toEqual({ [FIRST]: NORTHPEAK });
  });

  it("changes nothing else of the beat: the answer is the beat's but for the names and the bars they are written in", () => {
    const shown = live(100, part("ok", { [FIRST]: NORTHPEAK }));
    const next = live(101, part("failed"));
    const { names: _kept, traders: _named, ...rest } = mergePairBeat(next, shown) as LivePairData;
    const { names: _failed, traders: _plain, ...expected } = next;
    expect(rest).toEqual(expected);
  });

  describe("the traders' bars, which the view builder writes with the names it had", () => {
    const labelsOf = (page: PairPageData) => {
      if (page.mode !== "live" || page.traders.state !== "ok") throw new Error("traders");
      return page.traders.data.items.map((item) => [item.label, item.mark?.kind ?? null]);
    };

    it("are named again from the names the page keeps when the beat's names call failed: the bars do not lose a name the table's links keep", () => {
      const shown = live(100, part("ok", { [FIRST]: NORTHPEAK }), { traders: tradersOf([FIRST, SECOND], { [FIRST]: NORTHPEAK }) });
      // The beat's call failed, so its bars were written without names.
      const next = live(101, part("failed"), { traders: tradersOf([FIRST, SECOND]) });
      expect(labelsOf(next)).toEqual([[`${shortAddress(FIRST)}`, null], [`${shortAddress(SECOND)}`, null]]);

      const merged = mergePairBeat(next, shown);

      expect(labelsOf(merged)).toEqual([["Northpeak Treasury", "verified"], [`${shortAddress(SECOND)}`, null]]);
      // The token follows what is drawn, so the list redraws.
      if (merged.mode !== "live" || merged.traders.state !== "ok" || next.mode !== "live" || next.traders.state !== "ok") throw new Error("traders");
      expect(merged.traders.data.token).not.toBe(next.traders.data.token);
      expect(merged.traders.data.token).toBe(tradersOf([FIRST, SECOND], { [FIRST]: NORTHPEAK }).data.token);
      // The rest of the bars is the beat's.
      expect(merged.traders.data.items.map((item) => [item.id, item.value, item.count])).toEqual(next.traders.data.items.map((item) => [item.id, item.value, item.count]));
    });

    it("name the beat's new accounts from the names of the accounts that left, and keep what the beat named", () => {
      const shown = live(100, part("ok", { [SECOND]: HARBORLINE }), { traders: tradersOf([SECOND], { [SECOND]: HARBORLINE }) });
      const next = live(101, part("ok", { [FIRST]: NORTHPEAK }), { traders: tradersOf([FIRST, SECOND], { [FIRST]: NORTHPEAK }) });
      expect(labelsOf(mergePairBeat(next, shown))).toEqual([["Northpeak Treasury", "verified"], ["Harborline Exchange · hot wallet", "account"]]);
    });

    it("are the beat's own object when no bar changes: the same token, and nothing to redraw", () => {
      const shown = live(100, part("ok", { [THIRD]: TIDEWATER }), { traders: tradersOf([FIRST], {}) });
      const next = live(101, part("failed"), { traders: tradersOf([FIRST]) });
      const merged = mergePairBeat(next, shown);
      if (merged.mode !== "live") throw new Error("live");
      expect(merged.traders).toBe(next.traders);
    });

    it("are not touched when the switch is off, and not made when the traders could not be loaded", () => {
      const shown = live(100, part("ok", { [FIRST]: NORTHPEAK }), { traders: tradersOf([FIRST], { [FIRST]: NORTHPEAK }) });
      const off = live(101, NAMES_OFF, { traders: tradersOf([FIRST]) });
      expect(mergePairBeat(off, shown)).toMatchObject({ traders: off.traders });
      const failedTraders = live(101, part("failed"), { traders: { state: "failed", source: "/v2/active_accounts/{base}/{counter}" } });
      expect(mergePairBeat(failedTraders, shown)).toMatchObject({ traders: shown.traders });
    });
  });

  it("is the beat as it is when either page is not a live one: a page behind a marker never shows itself here", () => {
    const next: PairPageData = older(part("ok", { [FIRST]: NORTHPEAK }));
    expect(mergePairBeat(next, live(100, part("ok", { [SECOND]: HARBORLINE })))).toBe(next);
    const beat = live(101, part("failed"));
    expect(mergePairBeat(beat, older(part("ok", { [FIRST]: NORTHPEAK })))).toBe(beat);
  });
});
