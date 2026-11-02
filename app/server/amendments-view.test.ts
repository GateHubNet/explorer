import { describe, expect, it } from "vitest";

import { amendmentsSample, UNKNOWN_ID } from "../../test/support/d1-samples";
import { shortHash } from "../domain/format";
import type { NetworkInfo } from "../ui/networks";
import type { AmendmentRow, AmendmentsList } from "./api-types";
import { amendmentsPage, type AmendmentsPageData } from "./amendments-view";
import { unixOf, type TextPart } from "./validator-facts";

// ---- The world of the tests ------------------------------------------------------------------------------------------------------------------

const XRPL: NetworkInfo = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" };
const XAHAU: NetworkInfo = { id: "xahau", kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX", native: "XAH", software: "xahaud" };

/** A copy of an object without some of its keys (D1 leaves a key out; it never sends `null`). */
function without<T extends object, K extends keyof T>(object: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...object };
  for (const key of keys) delete copy[key];
  return copy;
}

type Input = Parameters<typeof amendmentsPage>[0];
const build = (over: Partial<Input> = {}): AmendmentsPageData => amendmentsPage({ network: XRPL, amendments: amendmentsSample(), ...over });

/** The sample's rows by name (the unnamed one is `UNKNOWN_ID`). */
const rowOf = (name: string): AmendmentRow => {
  const row = amendmentsSample().amendments.find((amendment) => (amendment.name ?? amendment.id) === name);
  expect(row, name).toBeDefined();
  return row!;
};

/** A majority of its own: the sample's, renamed, with its own votes and moment. */
function majority(name: string, over: Partial<AmendmentRow> = {}): AmendmentRow {
  return { ...rowOf("XChainBridge"), id: name.padEnd(64, "0").toUpperCase(), name, ...over };
}

/** A sentence made of parts, as the server prints it: a countdown is its `fallback`. */
const plain = (parts: readonly TextPart[]): string => parts.map((part) => (typeof part === "string" ? part : "countdown" in part ? part.countdown.fallback : part.text)).join("");

const listWith = (amendments: AmendmentRow[], counts?: Partial<AmendmentsList["counts"]>): AmendmentsList => {
  const sample = amendmentsSample();
  const by = (status: string) => amendments.filter((row) => row.status === status).length;
  return {
    ...sample,
    amendments,
    count: amendments.length,
    counts: { majority: by("majority"), voting: by("voting"), unknown: by("unknown"), enabled: by("enabled"), obsolete: by("obsolete"), ...counts },
  };
};

const SENTENCE = "Validators vote in the ledger before every flag ledger, once every 256 ledgers.";

// ---- The rows ----------------------------------------------------------------------------------------------------------------------------

describe("amendmentsPage: the rows", () => {
  it("keeps A's order and every row, ranked by their position in the list shown", () => {
    const page = build();
    expect(page.rows.map((row) => row.id)).toEqual(amendmentsSample().amendments.map((row) => row.id));
    expect(page.rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(page.rows.map((row) => row.status.status)).toEqual(["majority", "voting", "unknown", "enabled", "enabled"]);
  });

  it("keeps the rows of the chosen status only, in A's order, ranked from 1 again", () => {
    const enabled = build({ status: "enabled" });
    expect(enabled.status).toBe("enabled");
    expect(enabled.rows.map((row) => [row.rank, row.name.text])).toEqual([
      [1, "AMM"],
      [2, "fix1201"],
    ]);
    const voting = build({ status: "voting" });
    expect(voting.rows.map((row) => [row.rank, row.name.text])).toEqual([[1, "DID"]]);
    expect(build({ status: "obsolete" }).rows).toEqual([]);
    // No status is all of them.
    expect(build().status).toBeUndefined();
  });

  it("names a row by its name, else by its short ID in mono, and links to the amendment by the same segment", () => {
    const [bridge, , nameless] = build().rows;
    expect(bridge!.name).toEqual({ text: "XChainBridge", mono: false });
    expect(bridge!.href).toBe("/xrpl/amendments/XChainBridge");
    expect(nameless!.name).toEqual({ text: shortHash(UNKNOWN_ID), mono: true });
    expect(nameless!.href).toBe(`/xrpl/amendments/${UNKNOWN_ID}`);
    expect(build({ network: XAHAU }).rows[0]!.href).toBe("/xahau/amendments/XChainBridge");
  });

  it("shows when it was introduced as D1 writes it, else a dash", () => {
    const rows = build().rows;
    expect(rows.map((row) => row.introduced)).toEqual(["1.12.0", "1.12.0", "—", "1.12.0", "0.80.0"]);
    const xahau = build({ network: XAHAU, amendments: listWith([{ ...rowOf("DID"), introduced: "2023.10.30" }]) });
    expect(xahau.rows[0]!.introduced).toBe("2023.10.30");
  });

  it("makes the XLS tag a link only for a document on github.com under /XRPLF/XRPL-Standards/ (checked again: it goes into a link)", () => {
    const rows = build().rows;
    expect(rows[0]!.xls).toEqual({ text: "XLS-38", href: "https://github.com/XRPLF/XRPL-Standards/discussions/92" });
    expect(rows[3]!.xls).toEqual({ text: "XLS-30", href: "https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0030-automated-market-maker" });
    // No XLS, no tag.
    expect(rows[1]!.xls).toBeNull();
    const row = (xls_url: string | undefined) => build({ amendments: listWith([{ ...rowOf("AMM"), xls_url }]) }).rows[0]!.xls;
    // The tag stays, as text, when the URL is another host's, another repository's, not https, or not there.
    for (const url of ["https://example.com/XRPLF/XRPL-Standards/x", "https://github.com/other/repo", "http://github.com/XRPLF/XRPL-Standards/x", "javascript:alert(1)", "https://github.com.evil.example/XRPLF/XRPL-Standards/x", undefined]) {
      expect(row(url), String(url)).toEqual({ text: "XLS-30", href: null });
    }
    // A URL without a tag has nothing to show.
    expect(build({ amendments: listWith([without(rowOf("AMM"), "xls")]) }).rows[0]!.xls).toBeNull();
  });
});

describe("amendmentsPage: the consensus meter", () => {
  it("is there for majority, voting and unknown, with the yes share as its value and the rules' threshold as its tick", () => {
    const [bridge, did, nameless] = build().rows;
    expect(bridge!.meter).toEqual({
      data: { value: "88.57", max: "100", threshold: { value: "80", label: "80%" }, label: "31 of 35 UNL validators vote yes, 88.6%; more than 80% needed" },
      text: "88.6% · 31 / 35 UNL",
    });
    expect(did!.meter!.data.value).toBe("11.43");
    expect(did!.meter!.text).toBe("11.4% · 4 / 35 UNL");
    expect(nameless!.meter!.data.value).toBe("0.00");
    expect(nameless!.meter!.text).toBe("0.0% · 0 / 35 UNL");
  });

  it("is not there for enabled and obsolete, whatever else the row has", () => {
    const obsolete: AmendmentRow = { id: "A".repeat(64), name: "fixNFTokenNegOffer", status: "obsolete", introduced: "1.9.0", votes: rowOf("DID").votes };
    const rows = build({ amendments: listWith([...amendmentsSample().amendments, obsolete]) }).rows;
    expect(rows.map((row) => row.meter === null)).toEqual([false, false, false, true, true, true]);
  });

  it("is not there for a row with no round stored yet, or whose round had no trusted validators", () => {
    const rows = build({ amendments: listWith([without(rowOf("DID"), "votes"), { ...rowOf("DID"), votes: { ledger_index: 107748095, yes: 0, trusted: 0, needed: 1, pct: 0 } }]) }).rows;
    expect(rows.map((row) => row.meter)).toEqual([null, null]);
    expect(rows.map((row) => row.status)).toEqual([
      { status: "voting", share: "—" },
      { status: "voting", share: "—" },
    ]);
  });

  it("puts the tick where the network's rules put it", () => {
    const list = amendmentsSample({ rules: { threshold_percent: 75, majority_hold_seconds: 432000, flag_interval: 256 } });
    const meter = build({ amendments: list }).rows[0]!.meter!;
    expect(meter.data.threshold).toEqual({ value: "75", label: "75%" });
    expect(meter.data.label).toBe("31 of 35 UNL validators vote yes, 88.6%; more than 75% needed");
  });
});

describe("amendmentsPage: the status", () => {
  it("is the view of 2.5, made once by the builder: a moment for a majority, a share for voting and unknown, retired for an enabled one", () => {
    const [bridge, did, nameless, amm] = build().rows;
    expect(bridge!.status).toEqual({ status: "majority", activation: { at: unixOf("2026-10-31T15:54:20Z"), fallback: "expected Oct 31" } });
    expect(did!.status).toEqual({ status: "voting", share: "11.4%" });
    expect(nameless!.status).toEqual({ status: "unknown", share: "0.0%" });
    expect(amm!.status).toEqual({ status: "enabled", retired: false });
  });
});

describe("amendmentsPage: retired rows", () => {
  const retired: AmendmentRow = { id: "6E739F4F8B07BED29FC9FF440DA3C301CD14A180DF45819F658FEC2F7DE31427", name: "XahauGenesis", status: "enabled", retired: true, introduced: "2023.10.30" };

  it("are always on: not listed in the ledger, with nothing to link", () => {
    const row = build({ network: XAHAU, amendments: listWith([retired]) }).rows[0]!;
    expect(row.retired).toBe(true);
    expect(row.enabled).toBe("always");
    expect(row.status).toEqual({ status: "enabled", retired: true });
    expect(row.meter).toBeNull();
  });

  // D1 serves `enabled` for a retired name only when the ledger lists it: the row then reads like any enabled amendment, with its retired tag (as the amendment page does).
  it("read like any enabled amendment when D1 serves its EnableAmendment from the ledger: the date over the link, and the retired tag", () => {
    const row = build({ network: XAHAU, amendments: listWith([{ ...retired, enabled: { ledger_index: 5, date: "2023-10-30T12:00:00Z", tx_hash: "A".repeat(64), source: "ledger" } }]) }).rows[0]!;
    expect(row.enabled).toEqual({ date: "Oct 30, 2023", ledger: { text: "#5", href: "/xahau/ledger/5" } });
    expect(row.status).toEqual({ status: "enabled", retired: true });
  });

  it("read like any enabled amendment when D1 serves its day from the metadata file: the date alone, and the retired tag", () => {
    const row = build({ network: XAHAU, amendments: listWith([{ ...retired, enabled: { ledger_index: 5, date: "2023-10-30", source: "metadata" } }]) }).rows[0]!;
    expect(row.enabled).toEqual({ date: "Oct 30, 2023", ledger: null });
    expect(row.status).toEqual({ status: "enabled", retired: true });
    // An `enabled` with no day is a dash, as for any enabled amendment: not "always", which says the ledger does not list it.
    expect(build({ network: XAHAU, amendments: listWith([{ ...retired, enabled: { source: "metadata" } }]) }).rows[0]!.enabled).toEqual({ date: "—", ledger: null });
  });

  it("are the only rows that say so", () => {
    expect(build().rows.map((row) => row.retired)).toEqual([false, false, false, false, false]);
  });
});

describe("amendmentsPage: enabled on", () => {
  it("is the date over a link to the ledger, when the EnableAmendment is in the ledger", () => {
    const amm = build().rows[3]!;
    expect(amm.enabled).toEqual({ date: "Oct 19, 2026", ledger: { text: "#107,747,841", href: "/xrpl/ledger/107747841" } });
  });

  it("is the date alone when it comes from the metadata file, even where the file names a ledger", () => {
    const fix = build().rows[4]!;
    expect(fix.enabled).toEqual({ date: "Feb 3, 2025", ledger: null });
  });

  it("is a dash for an enabled amendment with no date, and nothing for the others", () => {
    const row = build({ amendments: listWith([{ id: "B".repeat(64), name: "fixOdd", status: "enabled" }, { id: "C".repeat(64), name: "fixOdder", status: "enabled", enabled: { source: "metadata" } }]) }).rows;
    expect(row.map((r) => r.enabled)).toEqual([{ date: "—", ledger: null }, { date: "—", ledger: null }]);
    const [bridge, did, nameless] = build().rows;
    expect([bridge!.enabled, did!.enabled, nameless!.enabled]).toEqual([null, null, null]);
  });
});

// ---- Activating soon ---------------------------------------------------------------------------------------------------------------------

describe("amendmentsPage: activating soon", () => {
  it("has no line when no amendment has a majority", () => {
    expect(build({ amendments: listWith(amendmentsSample().amendments.filter((row) => row.status !== "majority")) }).activating).toEqual([]);
  });

  it("has one line for one majority: the name as a link, the moment, a countdown without a server text, and the rule", () => {
    const [line, ...others] = build().activating;
    expect(others).toEqual([]);
    expect(line!.name).toEqual({ text: "XChainBridge", mono: false });
    expect(line!.href).toBe("/xrpl/amendments/XChainBridge");
    expect(line!.line).toEqual([
      " activates on or soon after Oct 31, 2026, 15:54 UTC",
      { countdown: { at: unixOf("2026-10-31T15:54:20Z"), fallback: "", past: "at the next flag ledger", lead: ", " } },
      ", if it keeps more than 80%",
    ]);
    // The server prints no countdown, and no comma left hanging.
    expect(plain(line!.line)).toBe(" activates on or soon after Oct 31, 2026, 15:54 UTC, if it keeps more than 80%");
    expect(line!.under).toBe("31 of 35 UNL validators vote yes · majority since Oct 17, 2026, held for 14 days before it activates");
  });

  it("has a line for each of two majorities, in A's order", () => {
    const second = majority("fixSecond", { votes: { ledger_index: 107748095, yes: 29, trusted: 35, needed: 29, pct: 82.86 }, majority: { since: "2026-10-18T08:00:00Z", expected_activation: "2026-11-01T08:00:00Z" } });
    const page = build({ amendments: listWith([majority("fixFirst"), second, rowOf("DID")]) });
    expect(page.activating.map((a) => a.name.text)).toEqual(["fixFirst", "fixSecond"]);
    expect(page.activating[1]!.under).toBe("29 of 35 UNL validators vote yes · majority since Oct 18, 2026, held for 14 days before it activates");
    expect(plain(page.activating[1]!.line)).toBe(" activates on or soon after Nov 1, 2026, 08:00 UTC, if it keeps more than 80%");
  });

  it("names an amendment nobody named by its short ID in mono, and links by its ID", () => {
    const page = build({ amendments: listWith([majority("x", { name: undefined, id: UNKNOWN_ID })]) });
    expect(page.activating[0]!.name).toEqual({ text: shortHash(UNKNOWN_ID), mono: true });
    expect(page.activating[0]!.href).toBe(`/xrpl/amendments/${UNKNOWN_ID}`);
  });

  it("says how long the network holds a majority, from the rules: 14 days on XRPL, 5 on Xahau", () => {
    expect(build().activating[0]!.under).toContain("held for 14 days before it activates");
    const xahau = amendmentsSample({ rules: { threshold_percent: 80, majority_hold_seconds: 432000, flag_interval: 256 } });
    expect(build({ network: XAHAU, amendments: xahau }).activating[0]!.under).toContain("held for 5 days before it activates");
    const one = amendmentsSample({ rules: { threshold_percent: 80, majority_hold_seconds: 86400, flag_interval: 256 } });
    expect(build({ amendments: one }).activating[0]!.under).toContain("held for 1 day before it activates");
  });

  it("says 'more than' the rules' threshold, never the bare number", () => {
    const list = amendmentsSample({ rules: { threshold_percent: 75, majority_hold_seconds: 1209600, flag_interval: 256 } });
    expect(plain(build({ amendments: list }).activating[0]!.line)).toContain(", if it keeps more than 75%");
  });

  it("leaves a majority row with no majority out: there is no moment to say", () => {
    expect(build({ amendments: listWith([without(rowOf("XChainBridge"), "majority")]) }).activating).toEqual([]);
  });

  it("leaves the votes out of the second line when the row has none", () => {
    const page = build({ amendments: listWith([without(rowOf("XChainBridge"), "votes")]) });
    expect(page.activating[0]!.under).toBe("majority since Oct 17, 2026, held for 14 days before it activates");
  });
});

// ---- The rules paragraph -----------------------------------------------------------------------------------------------------------------

describe("amendmentsPage: the rules", () => {
  it("is §5.1's paragraph from the rules, with the next flag ledger as text and a countdown to its estimated time", () => {
    const { rules } = build();
    expect(rules).toEqual([
      `${SENTENCE} An amendment that keeps more than 80% of the UNL for 14 days in a row is enabled at the flag ledger that follows, by an EnableAmendment pseudo-transaction in the ledger after it. Next flag ledger #107,748,352`,
      " ",
      { countdown: { at: unixOf("2026-10-19T16:05:28Z"), fallback: "expected 16:05 UTC", past: "due now", approx: true } },
      ".",
    ]);
    expect(plain(rules)).toMatch(/Next flag ledger #107,748,352 expected 16:05 UTC\.$/);
  });

  it("never links the flag ledger: it is a ledger that does not exist yet", () => {
    expect(build().rules.every((part) => typeof part === "string" || "countdown" in part)).toBe(true);
  });

  it("is Xahau's: its interval, its threshold and its five days", () => {
    const xahau = amendmentsSample({ rules: { threshold_percent: 80, majority_hold_seconds: 432000, flag_interval: 256 }, next_flag_ledger: { ledger_index: 26596864, voting_ledger: 26596863, expected: "2026-10-17T17:48:35Z" } });
    expect(plain(build({ network: XAHAU, amendments: xahau }).rules)).toBe(
      `${SENTENCE} An amendment that keeps more than 80% of the UNL for 5 days in a row is enabled at the flag ledger that follows, by an EnableAmendment pseudo-transaction in the ledger after it. Next flag ledger #26,596,864 expected 17:48 UTC.`,
    );
  });

  it("takes the interval and the threshold from the rules", () => {
    const list = amendmentsSample({ rules: { threshold_percent: 75, majority_hold_seconds: 172800, flag_interval: 1024 } });
    const text = plain(build({ amendments: list }).rules);
    expect(text).toContain("once every 1,024 ledgers.");
    expect(text).toContain("keeps more than 75% of the UNL for 2 days in a row");
  });

  it("has the flag ledger without a countdown when the data API has no time for it, and no sentence about it without a flag ledger", () => {
    const flag = amendmentsSample().next_flag_ledger!;
    const noTime = plain(build({ amendments: amendmentsSample({ next_flag_ledger: without(flag, "expected") }) }).rules);
    expect(noTime).toMatch(/Next flag ledger #107,748,352\.$/);
    const none = build({ amendments: without(amendmentsSample(), "next_flag_ledger") }).rules;
    expect(plain(none)).toMatch(/in the ledger after it\.$/);
    expect(plain(none)).not.toContain("Next flag ledger");
  });
});

// ---- The chips ---------------------------------------------------------------------------------------------------------------------------

describe("amendmentsPage: the status chips", () => {
  it("are All, Activating, Voting, Activated and Obsolete, each a link with its count from A, and Unknown only when there is one", () => {
    const { chips } = build();
    expect(chips).toEqual([
      { label: "All", count: 5, href: "/xrpl/amendments", current: true },
      { label: "Activating", count: 1, href: "/xrpl/amendments?status=majority", current: false },
      { label: "Voting", count: 1, href: "/xrpl/amendments?status=voting", current: false },
      { label: "Activated", count: 2, href: "/xrpl/amendments?status=enabled", current: false },
      { label: "Obsolete", count: 0, href: "/xrpl/amendments?status=obsolete", current: false },
      { label: "Unknown", count: 1, href: "/xrpl/amendments?status=unknown", current: false },
    ]);
  });

  it("have no Unknown chip when A counts none", () => {
    const list = listWith(amendmentsSample().amendments.filter((row) => row.status !== "unknown"));
    expect(list.counts.unknown).toBe(0);
    expect(build({ amendments: list }).chips.map((chip) => chip.label)).toEqual(["All", "Activating", "Voting", "Activated", "Obsolete"]);
  });

  it("count all of A's amendments in All, whatever the view shows", () => {
    expect(build({ status: "voting" }).chips[0]!.count).toBe(5);
    expect(build({ amendments: listWith(amendmentsSample().amendments, { enabled: 87, voting: 4 }) }).chips.map((chip) => chip.count)).toEqual([93, 1, 4, 87, 0, 1]);
  });

  it("mark the view on screen with `current`, and no other", () => {
    expect(build({ status: "enabled" }).chips.filter((chip) => chip.current).map((chip) => chip.label)).toEqual(["Activated"]);
    expect(build({ status: "majority" }).chips.filter((chip) => chip.current).map((chip) => chip.label)).toEqual(["Activating"]);
    expect(build({ status: "unknown" }).chips.filter((chip) => chip.current).map((chip) => chip.label)).toEqual(["Unknown"]);
    expect(build().chips.filter((chip) => chip.current).map((chip) => chip.label)).toEqual(["All"]);
  });

  it("link on the network of the page", () => {
    expect(build({ network: XAHAU }).chips.map((chip) => chip.href)).toEqual([
      "/xahau/amendments",
      "/xahau/amendments?status=majority",
      "/xahau/amendments?status=voting",
      "/xahau/amendments?status=enabled",
      "/xahau/amendments?status=obsolete",
      "/xahau/amendments?status=unknown",
    ]);
  });
});

// ---- The heading, the footer, and the strings --------------------------------------------------------------------------------------------

describe("amendmentsPage: the heading and the footer", () => {
  it("says what the page is for its network, and links to the validators", () => {
    expect(build().intro).toBe("Changes to the XRPL protocol. Each one activates only after the validators on the default UNL vote it in.");
    expect(build({ network: XAHAU }).intro).toBe("Changes to the Xahau protocol. Each one activates only after the validators on the default UNL vote it in.");
    expect(build().hrefs).toEqual({ validators: "/xrpl/validators" });
    expect(build({ network: XAHAU }).hrefs.validators).toBe("/xahau/validators");
  });

  it("counts the amendments shown and says what the tick is", () => {
    expect(build().footer).toEqual(["5 amendments", "the tick on each bar marks 80%"]);
    expect(build({ status: "voting" }).footer).toEqual(["1 amendment", "the tick on each bar marks 80%"]);
    expect(build({ status: "obsolete" }).footer).toEqual(["0 amendments", "the tick on each bar marks 80%"]);
    const many = Array.from({ length: 1234 }, (_, i) => ({ ...rowOf("AMM"), id: String(i).padStart(64, "0"), name: `fix${i}` }));
    expect(build({ amendments: listWith(many) }).footer[0]).toBe("1,234 amendments");
  });

  it("names the tick's place from the rules", () => {
    const list = amendmentsSample({ rules: { threshold_percent: 75, majority_hold_seconds: 1209600, flag_interval: 256 } });
    expect(build({ amendments: list }).footer[1]).toBe("the tick on each bar marks 75%");
  });

  it("carries the network it was built for, and nothing of A's envelope but what it drew", () => {
    const page = build({ network: XAHAU });
    expect(page.network).toEqual(XAHAU);
    expect(Object.keys(page).sort()).toEqual(["activating", "chips", "footer", "hrefs", "intro", "network", "rows", "rules"]);
    expect(Object.keys(build({ status: "voting" })).sort()).toEqual(["activating", "chips", "footer", "hrefs", "intro", "network", "rows", "rules", "status"]);
  });
});

describe("amendmentsPage: no float in a string", () => {
  it("puts no float in any string", () => {
    const odd = [majority("fixThird", { votes: { ledger_index: 107748095, yes: 1, trusted: 3, needed: 3, pct: 33.33 } }), { ...rowOf("DID"), votes: { ledger_index: 107748095, yes: 2, trusted: 3, needed: 3, pct: 66.67 } }];
    const pages = [
      build(),
      build({ network: XAHAU, amendments: amendmentsSample({ rules: { threshold_percent: 80, majority_hold_seconds: 432000, flag_interval: 256 } }) }),
      build({ amendments: listWith(odd) }),
      build({ amendments: amendmentsSample({ rules: { threshold_percent: 80, majority_hold_seconds: 100_000, flag_interval: 256 } }) }),
    ];
    for (const data of pages) expect(JSON.stringify(data)).not.toMatch(/\d\.\d{5,}/);
    // Thirds are exact to the digit that is written: 33.3%, 66.7%, and 33.33 and 66.67 for the bars.
    expect(pages[2]!.rows.map((row) => row.meter?.text)).toEqual(["33.3% · 1 / 3 UNL", "66.7% · 2 / 3 UNL"]);
    expect(pages[2]!.rows.map((row) => row.meter?.data.value)).toEqual(["33.33", "66.67"]);
  });

  it("writes a hold that is not whole days to one decimal", () => {
    const text = build({ amendments: amendmentsSample({ rules: { threshold_percent: 80, majority_hold_seconds: 100_000, flag_interval: 256 } }) }).activating[0]!.under;
    expect(text).toContain("held for 1.2 days before it activates");
  });
});
