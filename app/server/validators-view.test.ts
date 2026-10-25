import { describe, expect, it } from "vitest";

import { amendmentsSample, SAMPLE_KEYS, SAMPLE_SIGNING_KEYS, summarySample, UNKNOWN_ID, validatorRowSample, XCB_ID } from "../../test/support/d1-samples";
import { fnv1a32 } from "../domain/fnv";
import { shortHash } from "../domain/format";
import { sharePercent } from "../domain/percent";
import type { ValidatorsParams } from "../domain/validators-params";
import type { NetworkInfo } from "../ui/networks";
import type { Loaded } from "./account-view";
import type { AmendmentsList, UnlPublisher, ValidatorRow, ValidatorsList, ValidatorsSummary } from "./api-types";
import type { TextPart } from "./validator-facts";
import { validatorsPage, versionSlots, type ValidatorsPageData } from "./validators-view";

// ---- The world of the tests ------------------------------------------------------------------------------------------------------------------

const XRPL: NetworkInfo = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" };
const XAHAU: NetworkInfo = { id: "xahau", kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX", native: "XAH", software: "xahaud" };

const XRPL_TESTNET: NetworkInfo = { id: "xrpl", kind: "testnet", name: "XRPL Testnet", label: "XRPL Testnet", longName: "XRPL Testnet", dexName: "the XRPL Testnet DEX", native: "XRP", software: "rippled" };
const XAHAU_TESTNET: NetworkInfo = { id: "xahau", kind: "testnet", name: "Xahau Testnet", label: "Xahau Testnet", longName: "Xahau Testnet", dexName: "the Xahau Testnet DEX", native: "XAH", software: "xahaud" };

/** Xahau Testnet's fixed list as the data API serves it (D-env §5): the publisher `local`, with no site, no key and no expiration. */
const FIXED_LIST: UnlPublisher = { id: "local", url: "", public_key: "", status: "ok", sequence: 1, version: 1, fetched: "2026-10-19T15:51:26.114Z", validators: 4, seen_24h: 4 };

const ok = <T>(value: T): Loaded<T> => ({ state: "ok", value });
const FAILED: Loaded<never> = { state: "failed" };
const MISSING: Loaded<never> = { state: "missing" };

/** A copy of an object without some of its keys (D1 leaves a key out; it never sends `null`). */
function without<T extends object, K extends keyof T>(object: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...object };
  for (const key of keys) delete copy[key];
  return copy;
}

const DID_ID = amendmentsSample().amendments.find((row) => row.name === "DID")!.id;
const [KEY_NORTH, KEY_SHORE, KEY_TIDE, KEY_NAMELESS, KEY_QUIET, KEY_FIFTH] = SAMPLE_KEYS.slice(0, 6) as [string, string, string, string, string, string];

/**
 * Five validators in D1's order. `northpeak` is on both lists and votes yes on two amendments (one has no name); `shoreline` is on one list and votes yes on XChainBridge
 * without L naming it; `tidewater` is off the UNL and votes for nothing; `nameless` has no domain and votes yes on DID; `quiet` is a member of the UNL that was never seen.
 */
function fleet(): ValidatorRow[] {
  const north = validatorRowSample();
  const shore = validatorRowSample({
    validation_public_key: KEY_SHORE,
    domain: "shoreline.example",
    signing_key: SAMPLE_SIGNING_KEYS[1],
    unl_lists: ["vl.ripple.com"],
    amendment_votes: { ledger_index: 107748095, yes: [{ id: XCB_ID }] },
  });
  const tide = validatorRowSample({
    validation_public_key: KEY_TIDE,
    domain: "tidewater.example",
    signing_key: SAMPLE_SIGNING_KEYS[2],
    unl: false,
    unl_lists: [],
    version: "3.4.0",
    version_latest: false,
    amendment_votes: { ledger_index: 107748095, yes: [] },
  });
  const nameless: ValidatorRow = {
    ...without(validatorRowSample(), "domain", "domain_verification"),
    validation_public_key: KEY_NAMELESS,
    signing_key: SAMPLE_SIGNING_KEYS[3],
    unl: false,
    unl_lists: [],
    amendment_votes: { ledger_index: 107748095, yes: [{ id: DID_ID, name: "DID" }] },
  };
  const quiet: ValidatorRow = {
    validation_public_key: KEY_QUIET,
    agreement_1h: { missed: 0, total: 0, incomplete: true, partial: 0 },
    agreement_24h: { missed: 0, total: 0, incomplete: true, partial: 0 },
    unl: true,
    agreement_30d: { missed: 0, total: 0, incomplete: true, partial: 0 },
    unl_lists: ["unl.xrplf.org", "vl.ripple.com"],
    negative_unl: false,
  };
  return [north, shore, tide, nameless, quiet];
}

const listOf = (validators: ValidatorRow[], marker?: string): ValidatorsList => ({ result: "success", count: validators.length, ...(marker !== undefined && { marker }), validators });

type Input = Parameters<typeof validatorsPage>[0];

function build(over: Partial<Input> = {}): ValidatorsPageData {
  return validatorsPage({
    network: XRPL,
    params: { scope: "unl" },
    summary: ok(summarySample()),
    list: ok(listOf(fleet())),
    amendments: ok(amendmentsSample()),
    ...over,
  });
}

/** The parts that must have loaded. */
function shown(data: ValidatorsPageData) {
  if (data.summary.state !== "ok" || data.list.state !== "ok" || data.amendments.state !== "ok") throw new Error("a part did not load");
  return { summary: data.summary, list: data.list, amendments: data.amendments };
}
const summaryOf = (data: ValidatorsPageData) => {
  if (data.summary.state !== "ok") throw new Error("the summary did not load");
  return data.summary;
};
const listPart = (data: ValidatorsPageData) => {
  if (data.list.state !== "ok") throw new Error("the list did not load");
  return data.list;
};
const keysOf = (data: ValidatorsPageData): string[] => listPart(data).rows.map((row) => row.validation_public_key);

/** The text a sentence of parts reads as, links and countdowns included (a countdown reads as its fallback). */
function plain(parts: readonly TextPart[]): string {
  return parts.map((part) => (typeof part === "string" ? part : "countdown" in part ? part.countdown.fallback : part.text)).join("");
}

const summaryWith = (over: Partial<ValidatorsSummary>): Loaded<ValidatorsSummary> => ok(summarySample(over));
const amendmentsWith = (over: Partial<AmendmentsList>): Loaded<AmendmentsList> => ok(amendmentsSample(over));

// ---- Filters ---------------------------------------------------------------------------------------------------------------------------------

type FilterCase = [name: string, over: Partial<Input>, expected: string[]];

const FILTER_CASES: FilterCase[] = [
  ["the default scope: the UNL (a member never seen too)", { params: { scope: "unl" } }, [KEY_NORTH, KEY_SHORE, KEY_QUIET]],
  ["scope all", { params: { scope: "all" } }, [KEY_NORTH, KEY_SHORE, KEY_TIDE, KEY_NAMELESS, KEY_QUIET]],
  ["a publisher", { params: { scope: "all", publisher: "unl.xrplf.org" } }, [KEY_NORTH, KEY_QUIET]],
  ["a publisher with S failed, as given", { params: { scope: "all", publisher: "vl.ripple.com" }, summary: FAILED }, [KEY_NORTH, KEY_SHORE, KEY_QUIET]],
  ["a publisher that no row has", { params: { scope: "all", publisher: "nobody.example" } }, []],
  ["an amendment by name, through its ID from A (a row L does not name it in is kept)", { params: { scope: "all", amendment: "XChainBridge" } }, [KEY_NORTH, KEY_SHORE]],
  ["an amendment by the ID of one nobody named", { params: { scope: "all", amendment: UNKNOWN_ID } }, [KEY_NORTH]],
  ["an amendment by name without A, as given: only rows whose yes entry carries the name", { params: { scope: "all", amendment: "XChainBridge" }, amendments: FAILED }, [KEY_NORTH]],
  ["an amendment by ID without A, as given", { params: { scope: "all", amendment: XCB_ID }, amendments: FAILED }, [KEY_NORTH, KEY_SHORE]],
  ["an amendment with A missing, as given", { params: { scope: "all", amendment: "DID" }, amendments: MISSING }, [KEY_NAMELESS]],
  ["q in a domain, in any case", { params: { scope: "all", q: "TIDEWATER" } }, [KEY_TIDE]],
  ["q in a master key, in any case", { params: { scope: "all", q: KEY_NAMELESS.slice(5, 14).toUpperCase() } }, [KEY_NAMELESS]],
  ["q in a signing key, in any case", { params: { scope: "all", q: SAMPLE_SIGNING_KEYS[1].slice(4, 12).toLowerCase() } }, [KEY_SHORE]],
  ["q that nothing holds", { params: { scope: "all", q: "no-such-validator" } }, []],
  [
    "a combination: scope, publisher, amendment and q",
    { params: { scope: "all", publisher: "vl.ripple.com", amendment: "XChainBridge", q: "example" } },
    [KEY_NORTH, KEY_SHORE],
  ],
  ["a combination that excludes everything", { params: { scope: "unl", publisher: "unl.xrplf.org", amendment: "XChainBridge", q: "shoreline" } }, []],
];

describe("validatorsPage: the filters", () => {
  it.each(FILTER_CASES)("filters by %s", (_name, over, expected) => {
    const data = build(over);
    expect(keysOf(data)).toEqual(expected);
    expect(listPart(data).empty).toBe(expected.length === 0);
  });

  it("counts UNL and All before the other filters, and keeps D1's order", () => {
    const rows = fleet();
    // D1's order is the list's: it is not sorted again (this list is not in the order of its domains).
    const backwards = [rows[2]!, rows[0]!, rows[4]!, rows[1]!, rows[3]!];
    const data = build({ params: { scope: "all", publisher: "unl.xrplf.org", amendment: "XChainBridge", q: "north" }, list: ok(listOf(backwards)) });
    expect(listPart(data).counts).toEqual({ unl: 3, all: 5 });
    expect(keysOf(data)).toEqual([KEY_NORTH]);

    expect(keysOf(build({ params: { scope: "all" }, list: ok(listOf(backwards)) }))).toEqual([KEY_TIDE, KEY_NORTH, KEY_QUIET, KEY_SHORE, KEY_NAMELESS]);
    expect(keysOf(build({ params: { scope: "unl" }, list: ok(listOf(backwards)) }))).toEqual([KEY_NORTH, KEY_QUIET, KEY_SHORE]);
  });

  it("notes the first 1,000 when the list has a marker", () => {
    const withMarker = listPart(build({ list: ok(listOf(fleet(), "WzEwMDAsIm5IQiJd")) }));
    expect(withMarker.footer).toContain("The first 1,000 validators in this order are shown.");
    const without = listPart(build());
    expect(without.footer.join(" ")).not.toContain("first 1,000");
  });
});

// ---- The intro, the notices and the filter options -------------------------------------------------------------------------------------------

describe("validatorsPage: intro, notices and options", () => {
  it("writes the intro from the network's software and S's publishers", () => {
    expect(plain(build().intro)).toBe(
      "The default UNL is the list of validators rippled trusts out of the box, published by unl.xrplf.org and vl.ripple.com. All adds every other validator whose validations reached the data API in the last 24 hours.",
    );
    const onePublisher: UnlPublisher = { ...summarySample().unl.publishers[1]! };
    const xahau = build({ network: XAHAU, summary: summaryWith({ unl: { trusted: 31, publishers: [onePublisher] } }) });
    expect(plain(xahau.intro)).toContain("list of validators xahaud trusts out of the box, published by vl.ripple.com. All adds");
  });

  it("leaves the publishers out of the intro without S, and with a summary that lists none", () => {
    const noPublishers = "The default UNL is the list of validators rippled trusts out of the box. All adds every other validator whose validations reached the data API in the last 24 hours.";
    expect(plain(build({ summary: FAILED }).intro)).toBe(noPublishers);
    expect(plain(build({ summary: MISSING }).intro)).toBe(noPublishers);
    expect(plain(build({ summary: summaryWith({ unl: { trusted: 0, publishers: [] } }) }).intro)).toBe(noPublishers);
  });

  it("notices an expired publisher and one not fetched yet, and says so when none is left", () => {
    // The sample: unl.xrplf.org expired (and its last fetch failed), vl.ripple.com current.
    expect(summaryOf(build()).notices).toEqual(["unl.xrplf.org's list expired on Oct 18, 2026. The data API still uses it, as a node would rather use an old list than none."]);

    const [expired, current] = summarySample().unl.publishers as [UnlPublisher, UnlPublisher];
    const unavailable = (over: Partial<UnlPublisher>): UnlPublisher => ({ ...without(expired, "expiration", "fetched", "sequence", "version", "validators", "seen_24h", "last_error", "last_error_at"), status: "unavailable", ...over });
    const one = summaryOf(build({ summary: summaryWith({ unl: { trusted: 35, publishers: [unavailable({ last_error: "dns_error" }), current] } }) })).notices;
    expect(one).toEqual(["unl.xrplf.org has not been fetched yet (dns_error)."]);

    const noError = summaryOf(build({ summary: summaryWith({ unl: { trusted: 35, publishers: [unavailable({}), current] } }) })).notices;
    expect(noError).toEqual(["unl.xrplf.org has not been fetched yet."]);

    const both = summaryOf(
      build({ summary: summaryWith({ unl: { trusted: 0, publishers: [unavailable({ last_error: "timeout" }), unavailable({ id: "vl.ripple.com", url: "https://vl.ripple.com" })] } }) }),
    ).notices;
    expect(both).toEqual(["unl.xrplf.org has not been fetched yet (timeout).", "vl.ripple.com has not been fetched yet.", "No validator is trusted until one is."]);

    // Expired without the moment it expired on: no date is made up.
    const undated = summaryOf(build({ summary: summaryWith({ unl: { trusted: 35, publishers: [without(expired, "expiration"), current] } }) })).notices;
    expect(undated).toEqual(["unl.xrplf.org's list has expired. The data API still uses it, as a node would rather use an old list than none."]);
  });

  it("has no notice when every list is current", () => {
    const [, current] = summarySample().unl.publishers as [UnlPublisher, UnlPublisher];
    expect(summaryOf(build({ summary: summaryWith({ unl: { trusted: 35, publishers: [current] } }) })).notices).toEqual([]);
  });

  it("offers the publishers of S when there are two or more, and none otherwise", () => {
    expect(summaryOf(build()).publishers).toEqual([
      { value: "unl.xrplf.org", label: "unl.xrplf.org" },
      { value: "vl.ripple.com", label: "vl.ripple.com" },
    ]);
    const [, current] = summarySample().unl.publishers as [UnlPublisher, UnlPublisher];
    expect(summaryOf(build({ summary: summaryWith({ unl: { trusted: 35, publishers: [current] } }) })).publishers).toBeNull();
    expect(summaryOf(build({ summary: summaryWith({ unl: { trusted: 0, publishers: [] } }) })).publishers).toBeNull();
  });

  it("labels local Fixed list in the select and on a row", () => {
    const [, current] = summarySample().unl.publishers as [UnlPublisher, UnlPublisher];
    const summary = summaryWith({ unl: { trusted: 39, publishers: [current, FIXED_LIST] } });
    const both = validatorRowSample({ unl_lists: ["local", "vl.ripple.com"] });
    const data = build({ network: XAHAU_TESTNET, summary, list: ok(listOf([both])) });
    // The value is the id (it is what `?publisher=` takes); only the words are the label.
    expect(summaryOf(data).publishers).toEqual([
      { value: "vl.ripple.com", label: "vl.ripple.com" },
      { value: "local", label: "Fixed list" },
    ]);
    expect(listPart(data).rows.map((row) => row.unlPublishers)).toEqual([["Fixed list", "vl.ripple.com"]]);
  });

  it("words the UNL tag of a row on the fixed list as 'the fixed list', not as the label", () => {
    const fixed = validatorRowSample({ unl_lists: ["local"] });
    const both = validatorRowSample({ validation_public_key: KEY_SHORE, unl_lists: ["local", "vl.altnet.rippletest.net"] });
    const data = build({ network: XAHAU_TESTNET, list: ok(listOf([fixed, both])) });
    expect(listPart(data).rows.map((row) => row.listedBy)).toEqual(["Listed by the fixed list", "Listed by vl.altnet.rippletest.net and the fixed list"]);
  });

  it("still filters by the id local, not by its label", () => {
    const [, current] = summarySample().unl.publishers as [UnlPublisher, UnlPublisher];
    const summary = summaryWith({ unl: { trusted: 39, publishers: [current, FIXED_LIST] } });
    const fixed = validatorRowSample({ unl_lists: ["local"] });
    const published = validatorRowSample({ validation_public_key: KEY_SHORE, unl_lists: ["vl.ripple.com"] });
    const list = ok(listOf([fixed, published]));
    expect(keysOf(build({ network: XAHAU_TESTNET, summary, list, params: { scope: "unl", publisher: "local" } }))).toEqual([KEY_NORTH]);
    expect(keysOf(build({ network: XAHAU_TESTNET, summary, list, params: { scope: "unl", publisher: "Fixed list" } }))).toEqual([]);
  });

  it("gives local no notice, with any status", () => {
    const [expired, current] = summarySample().unl.publishers as [UnlPublisher, UnlPublisher];
    const local = (over: Partial<UnlPublisher>): UnlPublisher => ({ ...FIXED_LIST, ...over });
    for (const fixed of [local({}), local({ status: "expired", expiration: "2026-10-18T15:54:20Z" }), local({ status: "expired" }), local({ status: "unavailable", last_error: "timeout" })]) {
      // Alone, and beside a current list: no notice, and not "No validator is trusted until one is." either.
      expect(summaryOf(build({ summary: summaryWith({ unl: { trusted: 4, publishers: [fixed] } }) })).notices).toEqual([]);
      expect(summaryOf(build({ summary: summaryWith({ unl: { trusted: 39, publishers: [current, fixed] } }) })).notices).toEqual([]);
    }
    // The other lists keep theirs: local is left out of the notices, and of the check that none of the lists is fetched.
    expect(expired.id).toBe("unl.xrplf.org");
    expect(summaryOf(build({ summary: summaryWith({ unl: { trusted: 39, publishers: [expired, FIXED_LIST] } }) })).notices).toEqual([
      "unl.xrplf.org's list expired on Oct 18, 2026. The data API still uses it, as a node would rather use an old list than none.",
    ]);
  });

  it("says 'of those on the fixed list' when local is the only list, and 'listed by … and on the fixed list' beside others", () => {
    const [, current] = summarySample().unl.publishers as [UnlPublisher, UnlPublisher];
    const subOf = (publishers: UnlPublisher[]) => plain(tilesOf(build({ network: XAHAU_TESTNET, summary: summaryWith({ unl: { trusted: 4, publishers } }) }))[1]!.sub);
    expect(subOf([FIXED_LIST])).toBe("seen in 24 h, of those on the fixed list");
    expect(subOf([current, FIXED_LIST])).toBe("seen in 24 h, of those listed by vl.ripple.com and on the fixed list");
  });

  it("writes the testnet intro", () => {
    const altnet: UnlPublisher = { ...summarySample().unl.publishers[1]!, id: "vl.altnet.rippletest.net", url: "https://vl.altnet.rippletest.net" };
    const xrpl = build({ network: XRPL_TESTNET, summary: summaryWith({ unl: { trusted: 5, publishers: [altnet] } }) });
    expect(plain(xrpl.intro)).toBe(
      "The default UNL is the list of validators the nodes of XRPL Testnet trust, published by vl.altnet.rippletest.net. All adds every other validator whose validations reached the data API in the last 24 hours.",
    );
    const xahau = build({ network: XAHAU_TESTNET, summary: summaryWith({ unl: { trusted: 4, publishers: [FIXED_LIST] } }) });
    expect(plain(xahau.intro)).toBe(
      "The default UNL is the list of validators the nodes of Xahau Testnet trust, fixed in their configuration. All adds every other validator whose validations reached the data API in the last 24 hours.",
    );
    // Without S, a testnet's intro names no one either.
    expect(plain(build({ network: XAHAU_TESTNET, summary: FAILED }).intro)).toBe(
      "The default UNL is the list of validators the nodes of Xahau Testnet trust. All adds every other validator whose validations reached the data API in the last 24 hours.",
    );
  });

  it("offers the amendments being decided, in A's order, with the name or the short ID and the share of yes", () => {
    expect(shown(build()).amendments.options).toEqual([
      { value: "XChainBridge", label: "XChainBridge · 88.6%" },
      { value: "DID", label: "DID · 11.4%" },
      { value: UNKNOWN_ID, label: `${shortHash(UNKNOWN_ID)} · 0.0%` },
    ]);
  });

  it("follows A's order whatever it is, leaves out enabled and obsolete ones, and writes a dash for a share it has no round for", () => {
    const rows = amendmentsSample().amendments;
    const [majority, voting, unknown, enabled] = rows as [(typeof rows)[number], (typeof rows)[number], (typeof rows)[number], (typeof rows)[number]];
    const obsolete = { id: "7".repeat(64), name: "fixOld", status: "obsolete" as const };
    const noRound = { id: "5".repeat(64), name: "Fresh", status: "voting" as const };
    const options = shown(build({ amendments: amendmentsWith({ amendments: [enabled, noRound, obsolete, unknown, majority, voting] }) })).amendments.options;
    expect(options).toEqual([
      { value: "Fresh", label: "Fresh · —" },
      { value: UNKNOWN_ID, label: `${shortHash(UNKNOWN_ID)} · 0.0%` },
      { value: "XChainBridge", label: "XChainBridge · 88.6%" },
      { value: "DID", label: "DID · 11.4%" },
    ]);
  });

  it("does not offer an amendment of a status a newer D1 sends: this build cannot say it is being voted on (the filter drops it too)", () => {
    const rows = amendmentsSample().amendments;
    const frozen = { ...rows[1]!, id: "8".repeat(64), name: "Frozen", status: "frozen" };
    const options = shown(build({ amendments: amendmentsWith({ amendments: [...rows, frozen] }) })).amendments.options;
    expect(options.map((option) => option.value)).toEqual(["XChainBridge", "DID", UNKNOWN_ID]);
  });
});

// ---- Links ------------------------------------------------------------------------------------------------------------------------------------

describe("validatorsPage: the links of the page", () => {
  it("links the scopes with the other filters kept, and clears to the scope alone", () => {
    const data = build({ params: { scope: "all", publisher: "vl.ripple.com", amendment: "XChainBridge", q: "north peak" } });
    expect(data.hrefs).toEqual({
      amendments: "/xrpl/amendments",
      action: "/xrpl/validators",
      scope: {
        unl: "/xrpl/validators?publisher=vl.ripple.com&amendment=XChainBridge&q=north+peak",
        all: "/xrpl/validators?scope=all&publisher=vl.ripple.com&amendment=XChainBridge&q=north+peak",
      },
      clear: "/xrpl/validators?scope=all",
    });
  });

  it("has no Clear link on a view with no filter, and none for the scope alone", () => {
    expect(build().hrefs).toEqual({ amendments: "/xrpl/amendments", action: "/xrpl/validators", scope: { unl: "/xrpl/validators", all: "/xrpl/validators?scope=all" }, clear: null });
    expect(build({ params: { scope: "all" } }).hrefs.clear).toBeNull();
  });

  it("writes the paths of the network it is given", () => {
    const data = build({ network: XAHAU, params: { scope: "all", q: "north" } });
    expect(data.hrefs.amendments).toBe("/xahau/amendments");
    expect(data.hrefs.action).toBe("/xahau/validators");
    expect(data.hrefs.scope.unl).toBe("/xahau/validators?q=north");
    expect(listPart(data).rows.map((row) => row.href)).toEqual([`/xahau/validators/${KEY_NORTH}`]);
    expect(listPart(data).rows[0]!.yes[1]!.href).toBe("/xahau/amendments/XChainBridge");
  });
});

// ---- Tiles ------------------------------------------------------------------------------------------------------------------------------------

const tilesOf = (data: ValidatorsPageData) => summaryOf(data).tiles;

describe("validatorsPage: the six tiles", () => {
  const spec = (over: Partial<ValidatorsSummary> = {}) =>
    summaryWith({ validators: { seen_24h: 142, unl_seen_24h: 35, others_seen_24h: 107, all: 143 }, quorum: { value: 28, unl_size: 35, negative_unl: 0 }, negative_unl: [], negative_unl_pending: undefined, ...over });

  it("writes the six tiles", () => {
    const tiles = tilesOf(build({ summary: spec() }));
    expect(tiles.map((tile) => tile.label)).toEqual([
      "Validators seen, last 24 h",
      "On the default UNL",
      "Quorum",
      "Negative UNL",
      "Base / owner reserve",
      "Next flag ledger",
    ]);
    expect(tiles.map((tile) => tile.value)).toEqual(["142", "35 / 35", "28 of 35", "0", "1 / 0.2 XRP", "#107,748,352"]);
    expect(tiles.map((tile) => plain(tile.sub))).toEqual([
      "35 on the default UNL, 107 others",
      "seen in 24 h, of those listed by unl.xrplf.org and vl.ripple.com",
      "validations a ledger needs",
      "no validator discounted",
      "base fee 10 drops",
      "expected 16:05 UTC · fee and amendment votes are counted there",
    ]);
  });

  it("counts with separators and says '1 other' for one", () => {
    const tiles = tilesOf(build({ summary: spec({ validators: { seen_24h: 1234, unl_seen_24h: 1233, others_seen_24h: 1, all: 1300 } }) }));
    expect(tiles[0]).toMatchObject({ value: "1,234" });
    expect(plain(tiles[0]!.sub)).toBe("1,233 on the default UNL, 1 other");
    expect(tiles[1]!.value).toBe("1,233 / 35");
  });

  it("lists no publisher in the second tile's sub when S has none", () => {
    const tiles = tilesOf(build({ summary: spec({ unl: { trusted: 0, publishers: [] } }) }));
    expect(plain(tiles[1]!.sub)).toBe("seen in 24 h, of those listed");
  });

  it("adds what the node reports to the quorum only when it differs", () => {
    const sub = (quorum: ValidatorsSummary["quorum"]) => plain(tilesOf(build({ summary: spec({ quorum }) }))[2]!.sub);
    expect(sub({ value: 28, unl_size: 35, negative_unl: 0 })).toBe("validations a ledger needs");
    expect(sub({ value: 28, unl_size: 35, negative_unl: 0, node: 28 })).toBe("validations a ledger needs");
    expect(sub({ value: 28, unl_size: 35, negative_unl: 0, node: 27 })).toBe("validations a ledger needs · the node reports 27");
  });

  it("names the validators of the negative UNL by their domain in L, a link each, and by their short key otherwise", () => {
    const rows = fleet();
    // `shoreline` is the one on the negative UNL, and L names it.
    rows[1] = { ...rows[1]!, negative_unl: true };
    const summary = spec({ negative_unl: [{ validation_public_key: KEY_SHORE, first_ledger: 107747000 }], quorum: { value: 28, unl_size: 35, negative_unl: 1 } });
    const [, , , tile] = tilesOf(build({ summary, list: ok(listOf(rows)) }));
    expect(tile!.value).toBe("1");
    expect(tile!.sub).toEqual([{ text: "shoreline.example", href: `/xrpl/validators/${KEY_SHORE}` }, " is discounted while it is offline"]);

    // A key L does not have is shown short, in mono, and so is one whose row has no domain; so is every name when L failed.
    const fifth = { validation_public_key: KEY_FIFTH, first_ledger: 107747001 };
    const unnamed = tilesOf(build({ summary: spec({ negative_unl: [fifth] }), list: ok(listOf(rows)) }))[3]!;
    expect(unnamed.sub[0]).toEqual({ text: shortHash(KEY_FIFTH), href: `/xrpl/validators/${KEY_FIFTH}`, mono: true });
    const nameless = tilesOf(build({ summary: spec({ negative_unl: [{ validation_public_key: KEY_NAMELESS, first_ledger: 1 }] }), list: ok(listOf(rows)) }))[3]!;
    expect(nameless.sub[0]).toEqual({ text: shortHash(KEY_NAMELESS), href: `/xrpl/validators/${KEY_NAMELESS}`, mono: true });
    const noList = tilesOf(build({ summary, list: FAILED }))[3]!;
    expect(noList.sub[0]).toEqual({ text: shortHash(KEY_SHORE), href: `/xrpl/validators/${KEY_SHORE}`, mono: true });
  });

  it("names up to three and counts the rest", () => {
    const member = (key: string) => ({ validation_public_key: key, first_ledger: 1 });
    const two = tilesOf(build({ summary: spec({ negative_unl: [member(KEY_NORTH), member(KEY_SHORE)] }) }))[3]!;
    expect(two.value).toBe("2");
    expect(plain(two.sub)).toBe("northpeak.example and shoreline.example are discounted while they are offline");

    const three = tilesOf(build({ summary: spec({ negative_unl: [member(KEY_NORTH), member(KEY_SHORE), member(KEY_TIDE)] }) }))[3]!;
    expect(plain(three.sub)).toBe("northpeak.example, shoreline.example and tidewater.example are discounted while they are offline");

    const five = tilesOf(build({ summary: spec({ negative_unl: SAMPLE_KEYS.slice(0, 5).map(member) }) }))[3]!;
    expect(five.value).toBe("5");
    expect(plain(five.sub)).toBe(`northpeak.example, shoreline.example, tidewater.example and 2 more are discounted while they are offline`);
    // Each of the three is a link to the validator's page.
    expect(five.sub.filter((part) => typeof part !== "string")).toHaveLength(3);
  });

  it("adds the validator about to be disabled or re-enabled", () => {
    const member = { validation_public_key: KEY_SHORE, first_ledger: 1 };
    const reenable = tilesOf(build({ summary: spec({ negative_unl: [member], negative_unl_pending: { to_reenable: KEY_SHORE } }) }))[3]!;
    expect(plain(reenable.sub)).toBe("shoreline.example is discounted while it is offline · shoreline.example to be re-enabled at the next flag ledger");
    expect(reenable.sub.filter((part) => typeof part !== "string")).toHaveLength(2);

    const disable = tilesOf(build({ summary: spec({ negative_unl_pending: { to_disable: KEY_TIDE } }) }))[3]!;
    expect(plain(disable.sub)).toBe("no validator discounted · tidewater.example to be disabled at the next flag ledger");

    const both = tilesOf(build({ summary: spec({ negative_unl: [member], negative_unl_pending: { to_disable: KEY_NORTH, to_reenable: KEY_SHORE } }) }))[3]!;
    expect(plain(both.sub)).toBe(
      "shoreline.example is discounted while it is offline · northpeak.example to be disabled and shoreline.example to be re-enabled at the next flag ledger",
    );
  });

  it("writes the reserves in the network's currency and the base fee in drops", () => {
    const xrpl = tilesOf(build())[4]!;
    expect([xrpl.value, plain(xrpl.sub)]).toEqual(["1 / 0.2 XRP", "base fee 10 drops"]);
    const xahau = tilesOf(build({ network: XAHAU, summary: spec({ fees: { base_fee: "0.000001", reserve_base: "1", reserve_inc: "0.2" } }) }))[4]!;
    expect([xahau.value, plain(xahau.sub)]).toEqual(["1 / 0.2 XAH", "base fee 1 drop"]);
    const big = tilesOf(build({ summary: spec({ fees: { base_fee: "0.00001", reserve_base: "10000", reserve_inc: "2.5" } }) }))[4]!;
    expect(big.value).toBe("10,000 / 2.5 XRP");
  });

  it("counts down to the next flag ledger, an estimate, and says what is counted there", () => {
    const sub = tilesOf(build())[5]!.sub;
    expect(sub).toEqual([
      { countdown: { at: Date.UTC(2026, 9, 19, 16, 5, 28) / 1000, fallback: "expected 16:05 UTC", past: "due now", approx: true } },
      " · fee and amendment votes are counted there",
    ]);
    // The fallback is the UTC time of the moment, to the minute, with a leading zero.
    const early = tilesOf(build({ summary: summaryWith({ next_flag_ledger: { ledger_index: 256, voting_ledger: 255, expected: "2026-10-19T04:07:59Z" } }) }))[5]!;
    expect(early.value).toBe("#256");
    expect((early.sub[0] as { countdown: { fallback: string } }).countdown.fallback).toBe("expected 04:07 UTC");
  });

  it("says what a tile shows when the summary has left its figure out", () => {
    const noFees = tilesOf(build({ summary: ok(without(summarySample(), "fees")) }));
    expect([noFees[4]!.value, plain(noFees[4]!.sub)]).toEqual(["—", "not known yet"]);

    const noFlag = tilesOf(build({ summary: ok(without(summarySample(), "next_flag_ledger")) }));
    expect([noFlag[5]!.value, plain(noFlag[5]!.sub)]).toEqual(["—", "not known yet"]);

    // A flag ledger whose time is not known yet: the ledger is there, the countdown is not.
    const noTime = tilesOf(build({ summary: summaryWith({ next_flag_ledger: { ledger_index: 107748352, voting_ledger: 107748351 } }) }));
    expect(noTime[5]!.value).toBe("#107,748,352");
    expect(noTime[5]!.sub).toEqual(["fee and amendment votes are counted there"]);

    // Nothing else of the page is lost with them.
    expect(summaryOf(build({ summary: ok(without(summarySample(), "fees", "next_flag_ledger", "latest_version", "negative_unl_pending")) })).tiles).toHaveLength(6);
  });
});

// ---- Versions ---------------------------------------------------------------------------------------------------------------------------------

describe("versionSlots", () => {
  it("keeps each version's colour when a newer release arrives", () => {
    const before = versionSlots(["3.4.1", "3.4.0", "3.3.0", "3.2.0"]);
    const after = versionSlots(["3.5.0", "3.4.1", "3.4.0", "3.3.0"]);
    for (const v of ["3.4.1", "3.4.0", "3.3.0"]) expect(after.get(v)).toBe(before.get(v));
  });

  it("gives each version its own slot, 1 + its FNV-1a hash mod 4, when it is free", () => {
    const slots = versionSlots(["3.4.1", "3.4.0", "3.3.0", "3.2.0"]);
    for (const [version, slot] of slots) expect(slot).toBe(1 + (fnv1a32(version) % 4));
    expect([...slots.values()].sort()).toEqual([1, 2, 3, 4]);
  });

  it("moves the newer one, to the next free slot after its own, cyclically, when two hash to the same slot", () => {
    // 3.4.1 and 3.5.0 both hash to slot 2; the older keeps it, and 3.5.0 goes 3 (taken by 3.4.0), 4 (taken by 3.3.0), 1.
    const slots = versionSlots(["3.5.0", "3.4.1", "3.4.0", "3.3.0"]);
    expect(Object.fromEntries(slots)).toEqual({ "3.5.0": 1, "3.4.1": 2, "3.4.0": 3, "3.3.0": 4 });
  });

  it("shows only the four newest, so that an older version has no slot", () => {
    const slots = versionSlots(["3.5.0", "3.4.1", "3.4.0", "3.3.0", "3.2.0", "3.1.0"]);
    expect([...slots.keys()]).toEqual(["3.5.0", "3.4.1", "3.4.0", "3.3.0"]);
  });

  it("takes fewer slots for fewer versions, and none for none", () => {
    expect([...versionSlots(["3.4.1"]).values()]).toEqual([1 + (fnv1a32("3.4.1") % 4)]);
    expect(versionSlots([]).size).toBe(0);
  });

  it("changes a colour only when the version that moved it leaves the four", () => {
    // 3.5.0 moved off slot 2 because 3.4.1 holds it. Once 3.4.1 is gone from the four, 3.5.0 has its own slot.
    const crowded = versionSlots(["3.5.0", "3.4.1", "3.4.0", "3.3.0"]);
    const later = versionSlots(["3.6.0", "3.5.0", "3.4.0", "3.3.0"]);
    expect(crowded.get("3.5.0")).toBe(1);
    expect(later.get("3.4.0")).toBe(crowded.get("3.4.0"));
    expect(later.get("3.3.0")).toBe(crowded.get("3.3.0"));
    expect(later.get("3.5.0")).toBe(2); // its own, as 3.4.1 no longer holds it
  });
});

const VERSIONS: ValidatorsSummary["versions"] = [
  { version: "3.5.0", unl: 10, all: 12 },
  { version: "3.4.1", unl: 20, all: 30 },
  { version: "3.4.0", unl: 3, all: 8 },
  { version: "3.3.0", unl: 1, all: 4 },
  { version: "3.2.0", unl: 1, all: 5 },
  { version: "3.1.0", unl: 0, all: 2 },
];

const versionsOf = (data: ValidatorsPageData) => summaryOf(data).versions;

describe("validatorsPage: the versions", () => {
  const six = () => build({ summary: summaryWith({ versions: VERSIONS, versions_unknown: { unl: 2, all: 7 }, latest_version: "3.4.1" }) });

  it("shows the four newest versions with Other for older and unknown ones, and exact shares", () => {
    const { chart, table, notes } = versionsOf(six());
    expect(chart.rows.map((row) => [row.id, row.label, row.total])).toEqual([
      ["unl", "UNL", "37"],
      ["all", "All", "68"],
    ]);
    const segments = (id: string) => chart.rows.find((row) => row.id === id)!.segments.map((segment) => [segment.id, segment.label, segment.slot, segment.value]);
    expect(segments("unl")).toEqual([
      ["3.5.0", "3.5.0", 1, "10"],
      ["3.4.1", "3.4.1", 2, "20"],
      ["3.4.0", "3.4.0", 3, "3"],
      ["3.3.0", "3.3.0", 4, "1"],
      ["other", "Other", "other", "3"],
    ]);
    expect(segments("all")).toEqual([
      ["3.5.0", "3.5.0", 1, "12"],
      ["3.4.1", "3.4.1", 2, "30"],
      ["3.4.0", "3.4.0", 3, "8"],
      ["3.3.0", "3.3.0", 4, "4"],
      ["other", "Other", "other", "14"],
    ]);

    // Each row's total is the sum of its segments, and the bar's whole percents come from the kit's own rule.
    for (const row of chart.rows) expect(row.segments.reduce((sum, segment) => sum + Number(segment.value), 0)).toBe(Number(row.total));
    expect(sharePercent("10", "37")).toBe("27%");
    expect(sharePercent("1", "68")).toBe("1%");

    // The table has one row for each version of S, and Unknown; shares have one decimal.
    expect(table).toEqual([
      { version: "3.5.0", slot: 1, unl: "10", unlShare: "27.0%", all: "12", allShare: "17.6%" },
      { version: "3.4.1", slot: 2, unl: "20", unlShare: "54.1%", all: "30", allShare: "44.1%" },
      { version: "3.4.0", slot: 3, unl: "3", unlShare: "8.1%", all: "8", allShare: "11.8%" },
      { version: "3.3.0", slot: 4, unl: "1", unlShare: "2.7%", all: "4", allShare: "5.9%" },
      { version: "3.2.0", slot: "other", unl: "1", unlShare: "2.7%", all: "5", allShare: "7.4%" },
      { version: "3.1.0", slot: "other", unl: "0", unlShare: "0.0%", all: "2", allShare: "2.9%" },
      { version: "Unknown", slot: "other", unl: "2", unlShare: "5.4%", all: "7", allShare: "10.3%" },
    ]);
    expect(notes).toEqual([
      "Each validator's version as it reports it in its validations.",
      "“Other” groups releases older than 3.3.0 and validators whose version is not known.",
      "Latest release on the UNL: 3.4.1.",
    ]);
  });

  it("gives the sample's three versions their slots, newest first, and the unknown ones in Other", () => {
    const { chart, table } = versionsOf(build());
    const unl = chart.rows[0]!;
    // The sample: 3.5.0-rc1 (0 on the UNL, 3 in all), 3.4.1 (30, 40), 3.4.0 (4, 9), and 1 and 2 that report none.
    expect(unl.segments.map((segment) => [segment.id, segment.slot, segment.value])).toEqual([
      ["3.5.0-rc1", 4, "0"],
      ["3.4.1", 2, "30"],
      ["3.4.0", 3, "4"],
      ["other", "other", "1"],
    ]);
    expect(unl.total).toBe("35");
    expect(table.map((row) => row.version)).toEqual(["3.5.0-rc1", "3.4.1", "3.4.0", "Unknown"]);
  });

  it("draws fewer segments for fewer versions, and no Other when it is empty", () => {
    const two = versionsOf(
      build({ summary: summaryWith({ versions: [{ version: "3.4.1", unl: 30, all: 40 }, { version: "3.4.0", unl: 5, all: 9 }], versions_unknown: { unl: 0, all: 0 }, latest_version: "3.4.1" }) }),
    );
    for (const row of two.chart.rows) expect(row.segments.map((segment) => segment.id)).toEqual(["3.4.1", "3.4.0"]);
    expect(two.chart.rows.map((row) => row.total)).toEqual(["35", "49"]);
    expect(two.table.map((row) => row.version)).toEqual(["3.4.1", "3.4.0", "Unknown"]);
    // Four versions or fewer, none unknown: nothing to say of Other.
    expect(two.notes).toEqual(["Each validator's version as it reports it in its validations.", "Latest release on the UNL: 3.4.1."]);

    // Other is left out of a row where it is 0, and kept in the other.
    const mixed = versionsOf(build({ summary: summaryWith({ versions: [{ version: "3.4.1", unl: 30, all: 40 }], versions_unknown: { unl: 0, all: 3 } }) }));
    expect(mixed.chart.rows[0]!.segments.map((segment) => segment.id)).toEqual(["3.4.1"]);
    expect(mixed.chart.rows[1]!.segments.map((segment) => segment.id)).toEqual(["3.4.1", "other"]);
    expect(mixed.chart.rows.map((row) => row.total)).toEqual(["30", "43"]);
  });

  it("says what Other is when four versions or fewer are listed and some validators report none", () => {
    const four: ValidatorsSummary["versions"] = VERSIONS.slice(0, 4);
    const withUnknown = versionsOf(build({ summary: summaryWith({ versions: four, versions_unknown: { unl: 0, all: 1 }, latest_version: "3.5.0" }) }));
    expect(withUnknown.notes).toEqual([
      "Each validator's version as it reports it in its validations.",
      "“Other” is the validators whose version is not known.",
      "Latest release on the UNL: 3.5.0.",
    ]);
    // Exactly four, none unknown: no Other at all.
    const exact = versionsOf(build({ summary: summaryWith({ versions: four, versions_unknown: { unl: 0, all: 0 } }) }));
    expect(exact.chart.rows[0]!.segments.map((segment) => segment.id)).toEqual(["3.5.0", "3.4.1", "3.4.0", "3.3.0"]);
    expect(exact.notes).toEqual(["Each validator's version as it reports it in its validations.", "Latest release on the UNL: 3.4.1."]);
  });

  it("leaves the latest release out of the notes when S has none", () => {
    const { notes } = versionsOf(build({ summary: ok(without(summarySample(), "latest_version")) }));
    expect(notes.join(" ")).not.toContain("Latest release");
  });

  it("draws nothing for a network with no versions, and the Unknown row alone in the table", () => {
    const { chart, table } = versionsOf(build({ summary: summaryWith({ versions: [], versions_unknown: { unl: 0, all: 0 } }) }));
    expect(chart.rows.map((row) => [row.total, row.segments])).toEqual([
      ["0", []],
      ["0", []],
    ]);
    expect(table).toEqual([{ version: "Unknown", slot: "other", unl: "0", unlShare: "—", all: "0", allShare: "—" }]);
  });

  it("keeps a version's colour on the chart and the table when a newer release arrives", () => {
    const slotsOf = (versions: ValidatorsSummary["versions"]) => {
      const { chart, table } = versionsOf(build({ summary: summaryWith({ versions, versions_unknown: { unl: 0, all: 0 } }) }));
      const bar = new Map(chart.rows[1]!.segments.map((segment) => [segment.id, segment.slot]));
      return { bar, table: new Map(table.map((row) => [row.version, row.slot])) };
    };
    const before = slotsOf([
      { version: "3.4.1", unl: 30, all: 40 },
      { version: "3.4.0", unl: 4, all: 9 },
      { version: "3.3.0", unl: 1, all: 4 },
      { version: "3.2.0", unl: 1, all: 2 },
    ]);
    const after = slotsOf([
      { version: "3.5.0", unl: 2, all: 3 },
      { version: "3.4.1", unl: 28, all: 37 },
      { version: "3.4.0", unl: 4, all: 9 },
      { version: "3.3.0", unl: 1, all: 4 },
      { version: "3.2.0", unl: 1, all: 2 },
    ]);
    for (const v of ["3.4.1", "3.4.0", "3.3.0"]) {
      expect(after.bar.get(v)).toBe(before.bar.get(v));
      expect(after.table.get(v)).toBe(before.table.get(v));
    }
    // 3.2.0 left the four: it is in Other now, in the bar and in the table's swatch.
    expect(after.table.get("3.2.0")).toBe("other");
  });
});

// ---- The rows -----------------------------------------------------------------------------------------------------------------------------------

const rowOf = (data: ValidatorsPageData, key: string) => {
  const row = listPart(data).rows.find((candidate) => candidate.validation_public_key === key);
  if (row === undefined) throw new Error(`no row ${key}`);
  return row;
};

describe("validatorsPage: the rows", () => {
  const all = (over: Partial<Input> = {}) => build({ params: { scope: "all" }, ...over });

  it("names a validator by its domain and gives its short master key beneath, or the short key in mono and 'no domain'", () => {
    const data = all();
    expect(rowOf(data, KEY_NORTH)).toMatchObject({
      name: { text: "northpeak.example", mono: false },
      href: `/xrpl/validators/${KEY_NORTH}`,
      sub: shortHash(KEY_NORTH),
      domainStatus: "verified",
      unl: true,
      unlPublishers: ["unl.xrplf.org", "vl.ripple.com"],
      listedBy: "Listed by unl.xrplf.org and vl.ripple.com",
      negativeUnl: false,
      version: { text: "3.4.1", latest: true },
    });
    expect(rowOf(data, KEY_NAMELESS)).toMatchObject({
      name: { text: shortHash(KEY_NAMELESS), mono: true },
      href: `/xrpl/validators/${KEY_NAMELESS}`,
      sub: "no domain",
      domainStatus: null,
      unl: false,
      unlPublishers: [],
      listedBy: "",
    });
  });

  it("carries the domain status of each kind, and the Negative UNL mark", () => {
    const rows = fleet();
    rows[1] = { ...rows[1]!, domain_verification: { status: "unverified", reason: "not_listed", toml_url: "https://shoreline.example/.well-known/xrp-ledger.toml" }, negative_unl: true };
    rows[2] = { ...rows[2]!, domain_verification: { status: "pending", toml_url: "https://tidewater.example/.well-known/xrp-ledger.toml" } };
    const data = build({ params: { scope: "all" }, list: ok(listOf(rows)) });
    expect(rowOf(data, KEY_SHORE)).toMatchObject({ domainStatus: "unverified", negativeUnl: true });
    expect(rowOf(data, KEY_TIDE)).toMatchObject({ domainStatus: "pending", negativeUnl: false });
    // A row with a domain and no verification record says nothing of the domain.
    rows[0] = without(rows[0]!, "domain_verification");
    expect(rowOf(build({ params: { scope: "all" }, list: ok(listOf(rows)) }), KEY_NORTH).domainStatus).toBeNull();
  });

  it("writes the version as the validator reports it, and a dash for none (with no build number: that is the validator page's)", () => {
    const rows = fleet();
    rows[0] = { ...rows[0]!, version: "2026.10.13", version_build: 4119, version_latest: false };
    const data = build({ params: { scope: "all" }, list: ok(listOf(rows)) });
    expect(rowOf(data, KEY_NORTH).version).toEqual({ text: "2026.10.13", latest: false });
    expect(rowOf(data, KEY_QUIET).version).toEqual({ text: "—", latest: false });
  });

  it("writes agreement, incomplete and the yes list", () => {
    const rows = fleet();
    rows[0] = { ...rows[0]!, agreement_24h: { missed: 3, total: 21600, score: "0.9998", incomplete: false, partial: 0 } };
    rows[1] = { ...rows[1]!, agreement_24h: { missed: 0, total: 900, score: "1.0000", incomplete: true, partial: 0 } };
    rows[2] = { ...rows[2]!, agreement_24h: { missed: 0, total: 0, incomplete: true, partial: 0 } };
    const data = build({ params: { scope: "all" }, list: ok(listOf(rows)) });
    expect(rowOf(data, KEY_NORTH).agreement).toEqual({ text: "99.98%", incomplete: false });
    expect(rowOf(data, KEY_SHORE).agreement).toEqual({ text: "100.00%", incomplete: true });
    expect(rowOf(data, KEY_TIDE).agreement).toEqual({ text: "—", incomplete: true });

    // The yes list: the name when L gives one, else the short ID, each a link to the amendment's page by name or by ID, in L's order.
    expect(rowOf(data, KEY_NORTH).yes).toEqual([
      { label: shortHash(UNKNOWN_ID), href: `/xrpl/amendments/${UNKNOWN_ID}` },
      { label: "XChainBridge", href: "/xrpl/amendments/XChainBridge" },
    ]);
    expect(rowOf(data, KEY_SHORE).yes).toEqual([{ label: shortHash(XCB_ID), href: `/xrpl/amendments/${XCB_ID}` }]);
    expect(rowOf(data, KEY_TIDE).yes).toEqual([]);
    // A validator with no vote record has no yes.
    expect(rowOf(data, KEY_QUIET).yes).toEqual([]);
  });

  it("gives last seen as unix seconds, and null for a validator never seen", () => {
    const data = all();
    expect(rowOf(data, KEY_NORTH).lastSeen).toBe(Date.UTC(2026, 9, 19, 19, 24, 52) / 1000); // the sample's .750 is dropped
    expect(Number.isInteger(rowOf(data, KEY_NORTH).lastSeen)).toBe(true);
    expect(rowOf(data, KEY_QUIET).lastSeen).toBeNull();
    // A time that is not one is not a moment either.
    const rows = fleet();
    rows[0] = { ...rows[0]!, last_seen: "not a time" };
    expect(rowOf(build({ params: { scope: "all" }, list: ok(listOf(rows)) }), KEY_NORTH).lastSeen).toBeNull();
  });
});

// ---- Fee votes ----------------------------------------------------------------------------------------------------------------------------------

describe("validatorsPage: fee votes", () => {
  const withVote = (vote: { base_fee: string; reserve_base: string; reserve_inc: string } | undefined): Partial<Input> => {
    const rows = fleet();
    rows[0] = vote === undefined ? without(rows[0]!, "fee_vote") : { ...rows[0]!, fee_vote: { ledger_index: 107748095, ...vote } };
    return { list: ok(listOf(rows)) };
  };
  const cellsOf = (over: Partial<Input>) => rowOf(build(over), KEY_NORTH).fees;

  it("puts fee arrows against S: base reserve, owner reserve, then the fee in drops", () => {
    expect(cellsOf(withVote({ base_fee: "0.000012", reserve_base: "1", reserve_inc: "0.2" }))).toEqual([
      { text: "1", against: "same" },
      { text: "0.2", against: "same" },
      { text: "12", against: "higher" },
    ]);
    expect(cellsOf(withVote({ base_fee: "0.000008", reserve_base: "5", reserve_inc: "0.1" }))).toEqual([
      { text: "5", against: "higher" },
      { text: "0.1", against: "lower" },
      { text: "8", against: "lower" },
    ]);
  });

  it("compares as numbers, not as text", () => {
    expect(cellsOf(withVote({ base_fee: "0.0000100", reserve_base: "1.0", reserve_inc: "0.20" }))).toEqual([
      { text: "1", against: "same" },
      { text: "0.2", against: "same" },
      { text: "10", against: "same" },
    ]);
  });

  it("writes the amounts with separators", () => {
    expect(cellsOf(withVote({ base_fee: "0.0012", reserve_base: "10000", reserve_inc: "2" }))?.map((cell) => cell.text)).toEqual(["10,000", "2", "1,200"]);
  });

  it("has no cells for a validator with no fee vote on record", () => {
    expect(cellsOf(withVote(undefined))).toBeNull();
    expect(rowOf(build({ params: { scope: "all" } }), KEY_QUIET).fees).toBeNull();
  });

  it("puts no arrow without S, and says why in the footer", () => {
    const vote = withVote({ base_fee: "0.000012", reserve_base: "1", reserve_inc: "0.2" });
    for (const summary of [FAILED, MISSING]) {
      const data = build({ ...vote, summary });
      const cells = rowOf(data, KEY_NORTH).fees!;
      expect(cells.map((cell) => cell.text)).toEqual(["1", "0.2", "12"]);
      for (const cell of cells) expect(cell).not.toHaveProperty("against");
      expect(listPart(data).footer).toContain("Fee votes are not compared with the current fees: they could not be loaded");
      expect(listPart(data).footer.join(" ")).not.toContain("against the current value");
    }
  });

  it("puts no arrow when S does not know the current fees yet, and says so", () => {
    const data = build({ ...withVote({ base_fee: "0.000012", reserve_base: "1", reserve_inc: "0.2" }), summary: ok(without(summarySample(), "fees")) });
    for (const cell of rowOf(data, KEY_NORTH).fees!) expect(cell).not.toHaveProperty("against");
    expect(listPart(data).footer).toContain("Fee votes are not compared with the current fees: they are not known yet");
  });
});

// ---- The footer ---------------------------------------------------------------------------------------------------------------------------------

describe("validatorsPage: the footer and the counts", () => {
  const footerOf = (over: Partial<Input>) => listPart(build(over)).footer;

  it("counts the validators shown, in the order and the units of the board", () => {
    expect(footerOf({ params: { scope: "all" } })).toEqual([
      "5 validators",
      "in the order of their domain, then their key",
      "Fee votes in XRP / XRP / drops; ↑ ↓ against the current value",
    ]);
    expect(footerOf({ params: { scope: "unl" } })[0]).toBe("3 validators");
    expect(footerOf({ network: XAHAU, params: { scope: "all" } })[2]).toBe("Fee votes in XAH / XAH / drops; ↑ ↓ against the current value");
  });

  it("says '1 validator' for one, and '1 match' for one match", () => {
    const rows = fleet();
    expect(footerOf({ list: ok(listOf(rows.slice(0, 1))), params: { scope: "unl" } })[0]).toBe("1 validator");
    expect(footerOf({ params: { scope: "all", q: "tidewater" } })[0]).toBe("1 match");
  });

  it("says matches whenever a filter beyond the scope is set, and 0 matches for none", () => {
    expect(footerOf({ params: { scope: "all", q: "example" } })[0]).toBe("3 matches");
    expect(footerOf({ params: { scope: "all", publisher: "vl.ripple.com" } })[0]).toBe("3 matches");
    expect(footerOf({ params: { scope: "all", amendment: "XChainBridge" } })[0]).toBe("2 matches");
    expect(footerOf({ params: { scope: "all", q: "none-of-them" } })[0]).toBe("0 matches");
    expect(footerOf({ list: ok(listOf([])), params: { scope: "unl" } })[0]).toBe("0 validators");
  });

  it("writes the count with a separator", () => {
    const many = Array.from({ length: 1234 }, (_, i) => ({ ...validatorRowSample(), validation_public_key: `nHFill${String(i).padStart(4, "0")}` }));
    expect(listPart(build({ list: ok(listOf(many)) })).footer[0]).toBe("1,234 validators");
  });

  it("marks an empty result", () => {
    const empty = listPart(build({ params: { scope: "all", q: "none-of-them" } }));
    expect(empty.empty).toBe(true);
    expect(empty.rows).toEqual([]);
    expect(listPart(build()).empty).toBe(false);
  });
});

// ---- Degrading ------------------------------------------------------------------------------------------------------------------------------------

describe("validatorsPage: each part on its own", () => {
  it("fails S alone", () => {
    for (const summary of [FAILED, MISSING]) {
      const data = build({ summary, params: { scope: "all", publisher: "unl.xrplf.org" } });
      expect(data.summary).toEqual({ state: "failed" });
      expect(data.list.state).toBe("ok");
      expect(data.amendments.state).toBe("ok");
      expect(plain(data.intro)).not.toContain("published by");
      // The publisher is applied as given, and the chips still count.
      expect(keysOf(data)).toEqual([KEY_NORTH, KEY_QUIET]);
      expect(listPart(data).counts).toEqual({ unl: 3, all: 5 });
    }
  });

  it("fails L alone, and keeps the filters and the paths", () => {
    for (const list of [FAILED, MISSING]) {
      const data = build({ list, params: { scope: "all", q: "north" } });
      expect(data.list).toEqual({ state: "failed" });
      expect(data.summary.state).toBe("ok");
      expect(data.amendments.state).toBe("ok");
      expect(data.hrefs.scope.unl).toBe("/xrpl/validators?q=north");
      expect(data.params).toEqual({ scope: "all", q: "north" });
      // The negative UNL tile still names its validators, by their short keys.
      expect(summaryOf(data).tiles[3]!.sub[0]).toMatchObject({ text: shortHash(KEY_FIFTH), mono: true });
    }
  });

  it("fails A alone, and applies the amendment as given", () => {
    for (const amendments of [FAILED, MISSING]) {
      const data = build({ amendments, params: { scope: "all", amendment: "DID" } });
      expect(data.amendments).toEqual({ state: "failed" });
      expect(data.summary.state).toBe("ok");
      expect(keysOf(data)).toEqual([KEY_NAMELESS]);
    }
  });

  it("fails all three without throwing, with the page's own words still there", () => {
    const data = build({ summary: FAILED, list: FAILED, amendments: FAILED });
    expect([data.summary.state, data.list.state, data.amendments.state]).toEqual(["failed", "failed", "failed"]);
    expect(data.network).toEqual(XRPL);
    expect(data.hrefs.amendments).toBe("/xrpl/amendments");
    expect(plain(data.intro)).toContain("The default UNL is the list of validators rippled trusts");
  });

  it("hands the network and the params on as they came", () => {
    const params: ValidatorsParams = { scope: "all", q: "a" };
    const data = build({ params, network: XAHAU });
    expect(data.params).toBe(params);
    expect(data.network).toBe(XAHAU);
  });
});

// ---- Tokens and floats -------------------------------------------------------------------------------------------------------------------------

describe("validatorsPage: the chart's token", () => {
  const tokenOfChart = (over: Partial<ValidatorsSummary> = {}) => versionsOf(build({ summary: summaryWith(over) })).chart.token;

  it("is the same for the same data", () => {
    expect(tokenOfChart()).toBe(tokenOfChart());
    expect(tokenOfChart()).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes with any value the bar draws", () => {
    const base = tokenOfChart();
    const sample = summarySample();
    const bump = (index: number, key: "unl" | "all") => sample.versions.map((v, i) => (i === index ? { ...v, [key]: v[key] + 1 } : v));
    expect(tokenOfChart({ versions: bump(1, "unl") })).not.toBe(base);
    expect(tokenOfChart({ versions: bump(2, "all") })).not.toBe(base);
    expect(tokenOfChart({ versions_unknown: { unl: 2, all: 2 } })).not.toBe(base);
    // A newer release changes what is drawn (its segment, and the colours with it).
    expect(tokenOfChart({ versions: [{ version: "3.6.0", unl: 1, all: 1 }, ...sample.versions] })).not.toBe(base);
    // So does a version that is renamed, with the same counts.
    expect(tokenOfChart({ versions: sample.versions.map((v, i) => (i === 2 ? { ...v, version: "3.4.2" } : v)) })).not.toBe(base);
  });

  it("does not change with what the bar does not draw", () => {
    const base = tokenOfChart();
    expect(tokenOfChart({ updated: "2026-10-19T15:55:20.222Z", close_time: "2026-10-19T15:55:12Z", ledger_index: 107748190 })).toBe(base);
    expect(tokenOfChart({ quorum: { value: 27, unl_size: 34, negative_unl: 2 }, fees: { base_fee: "0.00002", reserve_base: "2", reserve_inc: "0.4" } })).toBe(base);
    expect(tokenOfChart({ latest_version: "3.5.0" })).toBe(base);
    // Not the list, nor the amendments, nor the filters.
    const other = versionsOf(build({ params: { scope: "all", q: "x" }, list: FAILED, amendments: FAILED })).chart.token;
    expect(other).toBe(base);
  });
});

describe("validatorsPage: no float in a string", () => {
  it("puts no float in any string", () => {
    const pages = [
      build({ params: { scope: "all" } }),
      build({ params: { scope: "all" }, network: XAHAU, summary: summaryWith({ fees: { base_fee: "0.000001", reserve_base: "1", reserve_inc: "0.2" } }) }),
      build({ summary: FAILED, list: FAILED, amendments: FAILED }),
      build({ summary: summaryWith({ versions: VERSIONS, versions_unknown: { unl: 2, all: 7 } }), list: ok(listOf(fleet(), "WzEwMDAsIm5IQiJd")) }),
    ];
    for (const data of pages) expect(JSON.stringify(data)).not.toMatch(/\d\.\d{5,}/);
  });
});
