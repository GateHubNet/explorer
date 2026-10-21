import { describe, expect, it } from "vitest";

import { AMM_ID, amendmentDetailSample, SAMPLE_KEYS, summarySample, UNKNOWN_ID, XCB_ID } from "../../test/support/d1-samples";
import { tokenOf } from "../domain/fnv";
import { shortHash } from "../domain/format";
import type { NetworkInfo } from "../ui/networks";
import type { Loaded } from "./account-view";
import type { AmendmentDetail, AmendmentRoundPoint, AmendmentVote, ValidatorsSummary } from "./api-types";
import { amendmentPage, yesVotesPageStep, type AmendmentPageData } from "./amendment-view";
import { amendmentStatusView, unixOf, type TextPart } from "./validator-facts";

// ---- The world of the tests ------------------------------------------------------------------------------------------------------------------

const XRPL: NetworkInfo = { id: "xrpl", name: "XRPL", native: "XRP", software: "rippled" };
const XAHAU: NetworkInfo = { id: "xahau", name: "Xahau", native: "XAH", software: "xahaud" };

const DID_ID = "DB432C3A09D9D5DFC7859F39AE5FF767ABC59AED0A9FB441E83B814D8946C109";
const FIX1201_ID = "B4D44CC3111ADD964E846FC57760C8B50FFCD5A82C86A72756F6B058DDDF96AD";
const OBSOLETE_ID = "A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90";
const MAJORITY_TX = "F78430ADBAF1464366DC4AAA169171604FFD56A9BB28F27835A80EDB455F7ED4";
const ENABLE_TX = "F5AFF7C2C2CD3F3CD74221F3D78C190BAAF45B3A6867CD165CB0253679EE0C6E";

const OK: Loaded<ValidatorsSummary> = { state: "ok", value: summarySample() };

/** A copy of an object without some of its keys (D1 leaves a key out; it never sends `null`). */
function without<T extends object, K extends keyof T>(object: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...object };
  for (const key of keys) delete copy[key];
  return copy;
}

type Input = Parameters<typeof amendmentPage>[0];
const build = (over: Partial<AmendmentDetail> = {}, input: Partial<Omit<Input, "amendment">> = {}): AmendmentPageData =>
  amendmentPage({ network: XRPL, amendment: amendmentDetailSample(over), summary: OK, ...input });

/** The page of an amendment that is `over` the sample with those keys left out (D1 leaves a key out; it never sends `null`). */
const buildWithout = (amendment: AmendmentDetail, input: Partial<Omit<Input, "amendment">> = {}): AmendmentPageData => amendmentPage({ network: XRPL, amendment, summary: OK, ...input });

/** A sentence made of parts, as the server prints it: a countdown is its `fallback`. */
const plain = (parts: readonly TextPart[]): string => parts.map((part) => (typeof part === "string" ? part : "countdown" in part ? part.countdown.fallback : part.text)).join("");

/** The grid as `[label, text]`. */
const gridOf = (page: AmendmentPageData): [string, string][] => page.identity.grid.map((row) => [row.label, plain(row.value)]);

const sentencesOf = (page: AmendmentPageData): string[] => page.consensus!.votes!.sentences.map(plain);

/** The vote tables of a page that has them (an amendment still voted on); a page with the note instead fails the test. */
function tablesOf(page: AmendmentPageData): Exclude<AmendmentPageData["votes"], { note: string }> {
  if ("note" in page.votes) throw new Error(`no vote tables: "${page.votes.note}"`);
  return page.votes;
}

/** The links among some parts. */
const linksOf = (parts: readonly TextPart[]) => parts.filter((part): part is Extract<TextPart, { href: string }> => typeof part !== "string" && "href" in part);

// ---- Rounds ------------------------------------------------------------------------------------------------------------------------------

const T0 = Date.parse("2026-10-17T00:00:00Z");
const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");

/** A round of the 30 days: `index` makes its ledgers, `ms` its close time. `threshold` and `passes` follow D1's rule (more than ⌊trusted × 80 ÷ 100⌋, at least 1 for one trusted). */
function roundAt(index: number, yes: number, trusted: number, ms: number): AmendmentRoundPoint {
  const threshold = Math.max(1, Math.floor((trusted * 80) / 100));
  return {
    ledger_index: 100_000 + 256 * index - 1,
    flag_ledger: 100_000 + 256 * index,
    date: iso(ms),
    yes,
    trusted,
    threshold,
    passes: trusted === 1 ? yes >= 1 : yes > threshold,
  };
}

/** One round an hour, from `T0`, with the yes votes given (and `trusted` 35 unless a pair says otherwise). */
const hourly = (...rounds: (number | [number, number])[]): AmendmentRoundPoint[] =>
  rounds.map((each, index) => {
    const [yes, trusted] = typeof each === "number" ? [each, 35] : each;
    return roundAt(index + 1, yes, trusted, T0 + index * HOUR);
  });

// ---- One amendment of each status --------------------------------------------------------------------------------------------------------------

/** The sample (XChainBridge, with a majority) without what only a majority has. */
function stripped(): AmendmentDetail {
  const detail = amendmentDetailSample();
  delete detail.votes;
  delete detail.majority;
  return detail;
}

const votingCase = (): AmendmentDetail => ({
  ...stripped(),
  id: DID_ID,
  name: "DID",
  status: "voting",
  introduced: "1.12.0",
  xls: undefined,
  xls_url: undefined,
  description: undefined,
  votes: { ledger_index: 107748095, yes: 4, trusted: 35, needed: 29, pct: 11.43 },
  round: { ledger_index: 107748095, date: "2026-10-19T15:48:20Z", unl_size: 35, trusted: 35, threshold: 28, needed: 29, observed: 35 },
  rounds: hourly(0, 2, 4),
  history: [],
});

const enabledCase = (): AmendmentDetail => ({
  ...stripped(),
  id: AMM_ID,
  name: "AMM",
  status: "enabled",
  introduced: "1.12.0",
  xls: "XLS-30",
  xls_url: "https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0030-automated-market-maker",
  description: undefined,
  enabled: { ledger_index: 107747841, date: "2026-03-22T15:31:24Z", tx_hash: ENABLE_TX, source: "ledger" },
  rounds: [],
  history: [{ event: "enabled", ledger_index: 107747841, date: "2026-03-22T15:31:24Z", tx_hash: ENABLE_TX }],
});

const metadataCase = (): AmendmentDetail => ({
  ...stripped(),
  id: FIX1201_ID,
  name: "fix1201",
  status: "enabled",
  introduced: "0.80.0",
  xls: undefined,
  xls_url: undefined,
  description: undefined,
  enabled: { ledger_index: 90000001, date: "2025-02-03", source: "metadata" },
  rounds: [],
  history: [],
});

const retiredCase = (): AmendmentDetail => ({
  ...stripped(),
  id: OBSOLETE_ID,
  name: "CryptoConditions",
  status: "enabled",
  retired: true,
  introduced: "2023.9.13",
  xls: undefined,
  xls_url: undefined,
  description: undefined,
  rounds: [],
  history: [],
});

const obsoleteCase = (): AmendmentDetail => ({
  ...stripped(),
  id: OBSOLETE_ID,
  name: "fixNFTokenNegOffer",
  status: "obsolete",
  introduced: "1.10.0",
  xls: undefined,
  xls_url: undefined,
  description: undefined,
  rounds: [],
  history: [],
});

const unknownCase = (): AmendmentDetail => {
  const detail: AmendmentDetail = {
    ...stripped(),
    id: UNKNOWN_ID,
    status: "unknown",
    votes: { ledger_index: 107748095, yes: 0, trusted: 35, needed: 29, pct: 0 },
    rounds: hourly(0, 0, 0),
    history: [],
  };
  delete detail.name;
  delete detail.introduced;
  delete detail.xls;
  delete detail.xls_url;
  delete detail.description;
  return detail;
};

/** The sample as it is: XChainBridge with a majority. */
const majorityCase = (): AmendmentDetail => amendmentDetailSample();

// ---- The identity (6.1) ------------------------------------------------------------------------------------------------------------------

describe("amendmentPage: the identity grid", () => {
  const SPECIFICATION_LINK = { text: "XLS-38", href: "https://github.com/XRPLF/XRPL-Standards/discussions/92", external: "plain" };

  it.each([
    [
      "majority",
      majorityCase(),
      XRPL,
      [
        ["Specification", "XLS-38"],
        ["Introduced in", "rippled 3.4.1"],
        ["Majority since", `Oct 17, 2026 · ledger #107,704,833 · EnableAmendment ${shortHash(MAJORITY_TX)}`],
        ["Activates on", "on or soon after Oct 31, 2026, 15:54 UTC, if it holds"],
      ],
    ],
    [
      "voting",
      votingCase(),
      XRPL,
      [
        ["Specification", "No XLS"],
        ["Introduced in", "rippled 1.12.0"],
      ],
    ],
    [
      "enabled",
      enabledCase(),
      XRPL,
      [
        ["Specification", "XLS-30"],
        ["Introduced in", "rippled 1.12.0"],
        ["Enabled on", `Mar 22, 2026, 15:31 UTC · ledger #107,747,841 · EnableAmendment ${shortHash(ENABLE_TX)}`],
      ],
    ],
    [
      "enabled from metadata",
      metadataCase(),
      XRPL,
      [
        ["Specification", "No XLS · fix amendments have none"],
        ["Introduced in", "rippled 0.80.0"],
        ["Enabled on", "Feb 3, 2025 · ledger #90,000,001 · before the indexed history"],
      ],
    ],
    [
      "retired",
      retiredCase(),
      XAHAU,
      [
        ["Specification", "No XLS"],
        ["Introduced in", "xahaud 2023.9.13"],
        ["Status", "Always on: xahaud applies it although the ledger does not list it"],
      ],
    ],
    [
      "obsolete",
      obsoleteCase(),
      XRPL,
      [
        ["Specification", "No XLS · fix amendments have none"],
        ["Introduced in", "rippled 1.10.0"],
        ["Status", "Current software can no longer vote it in."],
      ],
    ],
    [
      "unknown",
      unknownCase(),
      XRPL,
      [
        ["Specification", "No XLS"],
        ["Introduced in", "Not known"],
        ["Status", "No name is known for this ID, from the data API's metadata or its node."],
      ],
    ],
  ])("writes the identity grid of %s", (_name, amendment, network, grid) => {
    expect(gridOf(buildWithout(amendment, { network }))).toEqual(grid);
  });

  it("names the amendment, or says it is unknown and leaves its ID to the page; the canonical path is the name, else the ID", () => {
    const named = build();
    expect(named.identity.heading).toBe("XChainBridge");
    expect(named.identity.id).toBe(XCB_ID);
    expect(named.canonical).toBe("XChainBridge");
    const nameless = buildWithout(unknownCase());
    expect(nameless.identity.heading).toBe("Unknown amendment");
    expect(nameless.identity.id).toBe(UNKNOWN_ID);
    expect(nameless.canonical).toBe(UNKNOWN_ID);
    // A nameless amendment of any status is "Unknown amendment".
    const voting = votingCase();
    delete voting.name;
    expect(buildWithout(voting).identity.heading).toBe("Unknown amendment");
    expect(buildWithout(voting).canonical).toBe(DID_ID);
  });

  it("hands the status pill the list's view of it", () => {
    for (const amendment of [majorityCase(), votingCase(), enabledCase(), retiredCase(), obsoleteCase(), unknownCase()]) {
      expect(buildWithout(amendment).identity.status).toEqual(amendmentStatusView(amendment));
    }
    expect(buildWithout(retiredCase()).identity.status).toEqual({ status: "enabled", retired: true });
    expect(build().identity.status).toEqual({ status: "majority", activation: { at: unixOf("2026-10-31T15:54:20Z"), fallback: "expected Oct 31" } });
  });

  it("gives the description D1 has, else nothing", () => {
    expect(build().identity.description).toBe("Made up for the samples: bridges between two ledgers.");
    expect(buildWithout(votingCase()).identity.description).toBeNull();
    expect(build({ description: "" }).identity.description).toBeNull();
  });

  it("links the XLS tag to the document, and the link opens in a new tab", () => {
    expect(build().identity.grid[0]!.value).toEqual([SPECIFICATION_LINK]);
  });

  it.each([
    ["https://github.com/XRPLF/XRPL-Standards/discussions/92", true],
    ["https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0030-automated-market-maker", true],
    ["https://example.com/XRPLF/XRPL-Standards/x", false],
    ["https://github.com/other/repo", false],
    ["https://github.com/XRPLF/other-repo/x", false],
    ["http://github.com/XRPLF/XRPL-Standards/x", false],
    ["javascript:alert(1)", false],
    ["https://github.com.evil.example/XRPLF/XRPL-Standards/x", false],
    ["https://github.com/XRPLF/XRPL-Standards/../../evil", false],
    ["https://user@github.com/XRPLF/XRPL-Standards/x", false],
    [undefined, false],
  ])("links the XLS only on github.com under /XRPLF/XRPL-Standards/: %s", (url, linked) => {
    const value = build({ xls_url: url }).identity.grid[0]!.value;
    // The tag stays, as text, where the address cannot be trusted; it never turns into "No XLS".
    expect(value).toHaveLength(1);
    if (linked) expect(linksOf(value)).toEqual([{ text: "XLS-38", href: new URL(url!).href, external: "plain" }]);
    else expect(value).toEqual(["XLS-38"]);
  });

  it("says 'No XLS' for an amendment without a tag, and the fix amendments have none", () => {
    expect(gridOf(buildWithout({ ...votingCase(), name: "fixAMMOverflowOffer" }))[0]).toEqual(["Specification", "No XLS · fix amendments have none"]);
    expect(gridOf(buildWithout({ ...votingCase(), name: "DID" }))[0]).toEqual(["Specification", "No XLS"]);
    // Only a name that starts with `fix`: not one that has it inside, and not a nameless one.
    expect(gridOf(buildWithout({ ...votingCase(), name: "PrefixFix" }))[0]).toEqual(["Specification", "No XLS"]);
    expect(gridOf(buildWithout(unknownCase()))[0]).toEqual(["Specification", "No XLS"]);
    // An address with no tag has nothing to show.
    expect(gridOf(build({ xls: undefined }))[0]).toEqual(["Specification", "No XLS"]);
  });

  it("names the software of the network that introduced it", () => {
    expect(gridOf(build({ introduced: "1.9.0" }))[1]).toEqual(["Introduced in", "rippled 1.9.0"]);
    expect(gridOf(build({ introduced: "2026.10.13" }, { network: XAHAU }))[1]).toEqual(["Introduced in", "xahaud 2026.10.13"]);
    expect(gridOf(build({ introduced: undefined }))[1]).toEqual(["Introduced in", "Not known"]);
  });

  it("links the ledger and the transaction of the majority and of the enabling", () => {
    const since = build().identity.grid[2]!.value;
    expect(linksOf(since)).toEqual([
      { text: "#107,704,833", href: "/xrpl/ledger/107704833" },
      { text: `EnableAmendment ${shortHash(MAJORITY_TX)}`, href: `/xrpl/tx/${MAJORITY_TX}` },
    ]);
    const enabled = buildWithout(enabledCase()).identity.grid[2]!.value;
    expect(linksOf(enabled)).toEqual([
      { text: "#107,747,841", href: "/xrpl/ledger/107747841" },
      { text: `EnableAmendment ${shortHash(ENABLE_TX)}`, href: `/xrpl/tx/${ENABLE_TX}` },
    ]);
    // A metadata date names no transaction: the indexed history does not have it.
    expect(linksOf(buildWithout(metadataCase()).identity.grid[2]!.value)).toEqual([{ text: "#90,000,001", href: "/xrpl/ledger/90000001" }]);
  });

  it("counts down to the activation, after the words that say when, and says nothing once the moment cannot be read", () => {
    const value = build().identity.grid[3]!.value;
    expect(value).toEqual([
      "on or soon after Oct 31, 2026, 15:54 UTC, if it holds",
      { countdown: { at: unixOf("2026-10-31T15:54:20Z"), fallback: "", past: "at the next flag ledger", lead: " · " } },
    ]);
    const unreadable = build({ majority: { since: "2026-10-17T15:54:20Z", expected_activation: "soon" } }).identity.grid[3]!.value;
    expect(unreadable).toEqual(["on or soon after soon, if it holds"]);
  });

  it("names a retired amendment that the ledger lists by the ledger's enabling, not as one it does not list", () => {
    // D1: a retired name has `enabled` only when the ledger has it, so "although the ledger does not list it" would be false.
    const listed: AmendmentDetail = { ...retiredCase(), enabled: { ledger_index: 5, date: "2024-01-02T03:04:05Z", tx_hash: ENABLE_TX, source: "ledger" } };
    const page = buildWithout(listed, { network: XAHAU });
    expect(page.identity.grid.map((row) => row.label)).toEqual(["Specification", "Introduced in", "Enabled on"]);
    expect(page.identity.status).toEqual({ status: "enabled", retired: true });
  });

  it("does not throw for an enabled amendment with no `enabled`, or with one that has nothing in it", () => {
    expect(gridOf(buildWithout({ ...enabledCase(), enabled: undefined }))[2]).toEqual(["Enabled on", "—"]);
    expect(gridOf(buildWithout({ ...enabledCase(), enabled: { source: "ledger" } }))[2]).toEqual(["Enabled on", "—"]);
    expect(gridOf(buildWithout({ ...metadataCase(), enabled: { source: "metadata" } }))[2]).toEqual(["Enabled on", "before the indexed history"]);
    expect(gridOf(buildWithout({ ...metadataCase(), enabled: { source: "metadata", date: "2025-02-03" } }))[2]).toEqual(["Enabled on", "Feb 3, 2025 · before the indexed history"]);
  });

  it("does not throw for a majority without its `majority`", () => {
    const page = buildWithout({ ...majorityCase(), majority: undefined });
    expect(gridOf(page)).toEqual([
      ["Specification", "XLS-38"],
      ["Introduced in", "rippled 3.4.1"],
    ]);
    expect(page.history.pending).toBeNull();
    expect(page.identity.status).toEqual({ status: "majority", activation: { at: Number.NaN, fallback: "" } });
  });
});

// ---- Consensus (6.2): the figure, the meter and the sentences ------------------------------------------------------------------------------------

/** The sample's tally and round with `t` for the votes; the UNL is as large as `trusted` unless `unlSize` says it is larger (validators with no recent vote). */
function tallied(t: { yes: number; trusted: number; needed: number }, unlSize = t.trusted): Partial<AmendmentDetail> {
  const { round } = amendmentDetailSample();
  return { votes: { ledger_index: 107748095, ...t, pct: 0 }, round: { ...round!, unl_size: unlSize, trusted: t.trusted, needed: t.needed } };
}

describe("amendmentPage: the consensus sentences", () => {
  it.each([
    [{ yes: 4, trusted: 35, needed: 29 }, "4 of 35 UNL validators vote yes; 25 more are needed."],
    [{ yes: 29, trusted: 35, needed: 29 }, "29 of 35 UNL validators vote yes; 29 are needed."],
    [{ yes: 31, trusted: 35, needed: 29 }, "31 of 35 UNL validators vote yes; 29 are needed."],
    [{ yes: 0, trusted: 1, needed: 1 }, "0 of 1 UNL validators vote yes; 1 more is needed."],
    // Edges the brief's four do not reach: one vote short, and a single trusted validator that has voted.
    [{ yes: 28, trusted: 35, needed: 29 }, "28 of 35 UNL validators vote yes; 1 more is needed."],
    [{ yes: 1, trusted: 1, needed: 1 }, "1 of 1 UNL validators vote yes; 1 is needed."],
  ])("sentence 1 for %j", (tally, sentence) => {
    expect(sentencesOf(build(tallied(tally)))[0]).toBe(sentence);
  });

  it("says the same of a voting amendment and of an unknown one", () => {
    expect(sentencesOf(buildWithout(votingCase()))[0]).toBe("4 of 35 UNL validators vote yes; 25 more are needed.");
    expect(sentencesOf(buildWithout(unknownCase()))[0]).toBe("0 of the 35 UNL validators with a recent vote vote yes; 29 more are needed.");
  });

  it("says 'of the 33 UNL validators with a recent vote' when trusted is under unl_size", () => {
    expect(sentencesOf(build(tallied({ yes: 4, trusted: 33, needed: 27 }, 36)))[0]).toBe("4 of the 33 UNL validators with a recent vote vote yes; 23 more are needed.");
    expect(sentencesOf(build(tallied({ yes: 31, trusted: 33, needed: 27 }, 36)))[0]).toBe("31 of the 33 UNL validators with a recent vote vote yes; 27 are needed.");
    // At unl_size, or over it, every validator of the UNL has a vote.
    expect(sentencesOf(build(tallied({ yes: 4, trusted: 36, needed: 29 }, 36)))[0]).toBe("4 of 36 UNL validators vote yes; 25 more are needed.");
  });

  it("writes the figure as the yes share to one decimal, and the meter with the rules' threshold", () => {
    const { votes } = build(tallied({ yes: 31, trusted: 35, needed: 29 })).consensus!;
    expect(votes!.figure).toBe("88.6%");
    expect(votes!.meter).toEqual({
      value: "88.57",
      max: "100",
      threshold: { value: "80", label: "80%" },
      label: "31 of 35 UNL validators vote yes, 88.6%; more than 80% needed",
    });
    const xahau = build({ ...tallied({ yes: 1, trusted: 8, needed: 7 }), rules: { threshold_percent: 75, majority_hold_seconds: 432000, flag_interval: 256 } }, { network: XAHAU });
    expect(xahau.consensus!.votes!.meter.threshold).toEqual({ value: "75", label: "75%" });
    expect(xahau.consensus!.votes!.meter.label).toBe("1 of 8 UNL validators vote yes, 12.5%; more than 75% needed");
  });

  it("shows — and a null series value for trusted 0", () => {
    const page = build({ ...tallied({ yes: 0, trusted: 0, needed: 1 }), rounds: [roundAt(1, 0, 0, T0), roundAt(2, 0, 0, T0 + HOUR)] });
    const { votes, chart, table } = page.consensus!;
    expect(votes!.figure).toBe("—");
    expect(votes!.meter.value).toBe("0");
    expect(votes!.meter.label).toBe("0 of 0 UNL validators vote yes, —; more than 80% needed");
    expect(chart!.series[0]!.values).toEqual([null, null]);
    expect(table.map((row) => row.share)).toEqual(["—"]);
    expect(table.map((row) => row.yes)).toEqual(["0 / 0"]);
  });

  it("says the spare votes, and 'One vote less and it loses majority.' at 0", () => {
    const spare = (yes: number) => plain(build(tallied({ yes, trusted: 35, needed: 29 })).consensus!.votes!.sentences[1]!);
    // yes 31, needed 29: the two above the line can change their vote.
    expect(spare(31)).toMatch(/^2 can change their vote before it loses majority\. /);
    expect(spare(30)).toMatch(/^1 can change their vote before it loses majority\. /);
    expect(spare(29)).toMatch(/^One vote less and it loses majority\. /);
    // Over the line it has none to spare: sentence 1 says how many more are needed, and sentence 2 goes on to the majority.
    expect(spare(28)).toMatch(/^Majority since /);
    expect(spare(28)).not.toMatch(/can change|One vote less|-/);
  });

  it("writes the majority sentence with the ledger a link, and without ' at ledger' when D1 has no ledger", () => {
    const page = build(tallied({ yes: 31, trusted: 35, needed: 29 }));
    const second = page.consensus!.votes!.sentences[1]!;
    expect(plain(second)).toBe(
      "2 can change their vote before it loses majority. Majority since Oct 17, 2026 at ledger #107,704,833; activates on or soon after Oct 31, 2026, 15:54 UTC if it holds.",
    );
    expect(linksOf(second)).toEqual([{ text: "#107,704,833", href: "/xrpl/ledger/107704833" }]);
    const bare = build({ ...tallied({ yes: 31, trusted: 35, needed: 29 }), majority: { since: "2026-10-17T15:54:20Z", expected_activation: "2026-10-31T15:54:20Z" } });
    expect(plain(bare.consensus!.votes!.sentences[1]!)).toBe(
      "2 can change their vote before it loses majority. Majority since Oct 17, 2026; activates on or soon after Oct 31, 2026, 15:54 UTC if it holds.",
    );
    expect(linksOf(bare.consensus!.votes!.sentences[1]!)).toEqual([]);
    // Without the transaction, no transaction is named for the majority.
    const noTx = build({ majority: { since: "2026-10-17T15:54:20Z", ledger_index: 107704833, expected_activation: "2026-10-31T15:54:20Z" } });
    expect(plain(noTx.identity.grid[2]!.value)).toBe("Oct 17, 2026 · ledger #107,704,833");
    expect(plain(bare.identity.grid[2]!.value)).toBe("Oct 17, 2026");
    expect(plain(build().identity.grid[2]!.value)).toContain("EnableAmendment");
  });

  it("writes the votes of the voting ledger for a voting amendment and an unknown one", () => {
    const voting = buildWithout(votingCase());
    expect(sentencesOf(voting)[1]).toBe("Votes of voting ledger #107,748,095, Oct 19, 2026, 15:48 UTC.");
    expect(linksOf(voting.consensus!.votes!.sentences[1]!)).toEqual([{ text: "#107,748,095", href: "/xrpl/ledger/107748095" }]);
    expect(sentencesOf(buildWithout(unknownCase()))[1]).toBe("Votes of voting ledger #107,748,095, Oct 19, 2026, 15:48 UTC.");
    // Two sentences, no more.
    expect(voting.consensus!.votes!.sentences).toHaveLength(2);
  });

  it("is a card with no figure for a majority, voting or unknown amendment that has no tally yet", () => {
    for (const amendment of [{ ...majorityCase(), votes: undefined }, { ...votingCase(), votes: undefined }, { ...unknownCase(), votes: undefined }]) {
      const consensus = buildWithout(amendment).consensus;
      expect(consensus).not.toBeNull();
      expect(consensus!.votes).toBeNull();
    }
    // The chart is still there, from the rounds.
    expect(buildWithout({ ...votingCase(), votes: undefined }).consensus!.chart).not.toBeNull();
  });

  it("does not throw for an answer with no round, no flag ledger and no ledger of its own", () => {
    const bare = without(majorityCase(), "round", "next_flag_ledger", "ledger_index") as AmendmentDetail;
    const page = buildWithout(bare);
    // No round to compare `trusted` with: the plain wording.
    expect(sentencesOf(page)[0]).toBe("31 of 35 UNL validators vote yes; 29 are needed.");
    const voting = without(votingCase(), "round", "next_flag_ledger", "ledger_index") as AmendmentDetail;
    // Voting ledger known, round (and its date) not.
    expect(sentencesOf(buildWithout(voting))[1]).toBe("Votes of voting ledger #107,748,095.");
  });

  it("has no consensus figure for an enabled or obsolete amendment", () => {
    expect(buildWithout({ ...enabledCase(), rounds: hourly(30, 31) }).consensus!.votes).toBeNull();
    expect(buildWithout({ ...obsoleteCase(), rounds: hourly(1, 2) }).consensus!.votes).toBeNull();
  });
});

// ---- Consensus: the chart and its table ------------------------------------------------------------------------------------------------------

describe("amendmentPage: the yes votes chart", () => {
  it("builds the step series with its Round extra, the 80% reference and the page step from the newest 24 h", () => {
    const rounds = [roundAt(1, 0, 35, T0), roundAt(2, 29, 35, T0 + 2 * HOUR), roundAt(3, 31, 35, T0 + 30 * HOUR)];
    const chart = build({ rounds }).consensus!.chart!;
    expect(chart.axis).toEqual({ unit: "flag", buckets: rounds.map((round) => round.date) });
    expect(chart.series).toEqual([{ id: "yes", label: "Yes votes", slot: 1, values: ["0.00", "82.86", "88.57"] }]);
    expect(chart.format).toEqual({ kind: "percent" });
    expect(chart.references).toEqual([{ value: "80", label: "80% threshold" }]);
    expect(chart.extras).toEqual([
      {
        id: "round",
        label: "Round",
        tooltip: "value",
        values: [
          "flag ledger #100,256 · 0 of 35 UNL validators · no majority",
          "flag ledger #100,512 · 29 of 35 UNL validators · majority",
          "flag ledger #100,768 · 31 of 35 UNL validators · majority",
        ],
      },
    ]);
    // Only the newest round is within a day of the newest.
    expect(chart.pageStep).toBe(1);
    expect(chart.token).toMatch(/^[0-9a-f]{8}$/);
  });

  it("takes the references from the rules' threshold, whatever it is", () => {
    const chart = build({ rules: { threshold_percent: 66, majority_hold_seconds: 432000, flag_interval: 256 } }).consensus!.chart!;
    expect(chart.references).toEqual([{ value: "66", label: "66% threshold" }]);
  });

  it("starts the axis at 50%, or at 0% when a round is lower", () => {
    const start = (...yes: number[]) => build({ rounds: hourly(...yes) }).consensus!;
    expect(start(20, 25, 29).chart!.domain).toEqual({ min: "50" });
    expect(start(20, 25, 29).notes[0]).toBe("One point per flag ledger, every 256 ledgers. The axis starts at 50%.");
    // 17 of 35 is 48.57%: lower than 50, so the axis starts at 0.
    expect(start(17, 25, 29).chart!.domain).toEqual({ min: "0" });
    expect(start(17, 25, 29).notes[0]).toBe("One point per flag ledger, every 256 ledgers. The axis starts at 0%.");
    // 18 of 35 is 51.43%.
    expect(start(18).chart!.domain).toEqual({ min: "50" });
  });

  it("compares the value as it is drawn, to two decimals, and exactly at 50", () => {
    const start = (yes: number, trusted: number) => build({ rounds: hourly([yes, trusted]) }).consensus!.chart!.domain;
    expect(start(1, 2)).toEqual({ min: "50" }); // 50.00
    expect(start(4999, 10_000)).toEqual({ min: "0" }); // 49.99
    expect(start(49_999, 100_000)).toEqual({ min: "50" }); // 49.999 is drawn as 50.00: it is not under the axis
    expect(start(0, 35)).toEqual({ min: "0" });
    // A round of no trusted validators has no value, so it cannot be lower.
    expect(start(0, 0)).toEqual({ min: "50" });
  });

  it("says the interval from the network's own rules", () => {
    const xahau = build({ rules: { threshold_percent: 80, majority_hold_seconds: 432000, flag_interval: 128 }, rounds: hourly(29, 31) }, { network: XAHAU });
    expect(xahau.consensus!.notes[0]).toBe("One point per flag ledger, every 128 ledgers. The axis starts at 50%.");
    expect(build().consensus!.notes[1]).toBe("One row per change in the yes count; the count holds until the next row.");
    expect(build().consensus!.notes).toHaveLength(2);
  });

  it("keeps only the changes in the chart table: yes changes, trusted changes, the first round", () => {
    const rounds = hourly(0, 0, [25, 35], 29, 29, 31, [31, 36], [31, 36]);
    const { table } = build({ rounds }).consensus!;
    // Newest first.
    expect(table).toEqual([
      { from: { text: "#101,792", href: "/xrpl/ledger/101792" }, date: "Oct 17, 2026, 06:00 UTC", yes: "31 / 36", share: "86.1%", passes: true },
      { from: { text: "#101,536", href: "/xrpl/ledger/101536" }, date: "Oct 17, 2026, 05:00 UTC", yes: "31 / 35", share: "88.6%", passes: true },
      { from: { text: "#101,024", href: "/xrpl/ledger/101024" }, date: "Oct 17, 2026, 03:00 UTC", yes: "29 / 35", share: "82.9%", passes: true },
      { from: { text: "#100,768", href: "/xrpl/ledger/100768" }, date: "Oct 17, 2026, 02:00 UTC", yes: "25 / 35", share: "71.4%", passes: false },
      { from: { text: "#100,256", href: "/xrpl/ledger/100256" }, date: "Oct 17, 2026, 00:00 UTC", yes: "0 / 35", share: "0.0%", passes: false },
    ]);
  });

  it("has one row for rounds that never change", () => {
    const { table } = build({ rounds: hourly(29, 29, 29, 29) }).consensus!;
    expect(table.map((row) => row.from.text)).toEqual(["#100,256"]);
  });

  it("holds 2,600 rounds as 2,600 points and a handful of rows", () => {
    const rounds: AmendmentRoundPoint[] = [];
    for (let index = 0; index < 2_600; index += 1) {
      const yes = index < 400 ? 0 : index < 900 ? 12 : index < 1_500 ? 25 : index < 2_000 ? 29 : index < 2_599 ? 31 : 33;
      rounds.push(roundAt(index + 1, yes, 35, T0 + index * 16 * 60_000));
    }
    const page = build({ rounds });
    const { chart, table } = page.consensus!;
    expect(chart!.axis.buckets).toHaveLength(2_600);
    expect(chart!.series[0]!.values).toHaveLength(2_600);
    expect(chart!.extras![0]!.values).toHaveLength(2_600);
    expect(table).toHaveLength(6);
    // 16 minutes apart: 90 rounds fit in 24 h (the one exactly 24 h before the newest is not within it).
    expect(chart!.pageStep).toBe(90);
  });

  it("changes its token with a value or a round text, so a live page redraws", () => {
    const token = (rounds: AmendmentRoundPoint[]) => build({ rounds }).consensus!.chart!.token;
    const base = hourly(10, 20, 30);
    expect(token(base)).toBe(token(hourly(10, 20, 30)));
    expect(token(base)).not.toBe(token(hourly(10, 20, 31)));
    // A round that passes or fails changes the extra but not the value.
    expect(token(base)).not.toBe(token(base.map((round, index) => (index === 2 ? { ...round, flag_ledger: round.flag_ledger + 1 } : round))));
    // The token is of the data without itself and without the page step.
    const { token: own, pageStep: _step, ...data } = build({ rounds: base }).consensus!.chart!;
    expect(own).toBe(tokenOf(data));
  });

  it("has no chart, no rows and no notes without rounds, and says so for a voting amendment", () => {
    const { consensus } = buildWithout({ ...votingCase(), rounds: [] });
    expect(consensus).not.toBeNull();
    expect(consensus!.chart).toBeNull();
    expect(consensus!.table).toEqual([]);
    expect(consensus!.notes).toEqual([]);
    expect(consensus!.votes).not.toBeNull();
  });

  it("has a chart and its table for an enabled or obsolete amendment that has rounds, and no card without them", () => {
    const enabled = buildWithout({ ...enabledCase(), rounds: hourly(25, 29, 31) }).consensus!;
    expect(enabled.votes).toBeNull();
    expect(enabled.chart!.series[0]!.values).toEqual(["71.43", "82.86", "88.57"]);
    expect(enabled.table).toHaveLength(3);
    expect(buildWithout({ ...obsoleteCase(), rounds: hourly(1) }).consensus!.chart).not.toBeNull();
    expect(buildWithout(enabledCase()).consensus).toBeNull();
    expect(buildWithout(metadataCase()).consensus).toBeNull();
    expect(buildWithout(obsoleteCase()).consensus).toBeNull();
    expect(buildWithout(retiredCase()).consensus).toBeNull();
  });
});

describe("yesVotesPageStep", () => {
  const at = (...hours: number[]): AmendmentRoundPoint[] => hours.map((hour, index) => roundAt(index + 1, 0, 35, T0 + hour * HOUR));

  it("counts the rounds whose date is within 24 h of the newest round's, the newest included", () => {
    // One an hour for 48 h: the newest and the 23 before it.
    expect(yesVotesPageStep(at(...Array.from({ length: 49 }, (_, hour) => hour)))).toBe(24);
    expect(yesVotesPageStep(at(0, 1, 2))).toBe(3);
    expect(yesVotesPageStep(at(0))).toBe(1);
  });

  it("leaves out the round exactly 24 h before the newest: n rounds make n steps, one day", () => {
    expect(yesVotesPageStep(at(0, 24))).toBe(1);
    expect(yesVotesPageStep(at(0, 1, 24))).toBe(2);
    // A second less than 24 h before is within it.
    const rounds = [roundAt(1, 0, 35, T0 + 1_000), roundAt(2, 0, 35, T0 + 24 * HOUR)];
    expect(yesVotesPageStep(rounds)).toBe(2);
  });

  it("measures from the newest, whatever the order", () => {
    // The newest is hour 36: hour 24 is 12 h before it (within), hour 12 exactly 24 h (not), hour 0 is 36 h (not).
    expect(yesVotesPageStep(at(24, 0, 12, 36))).toBe(2);
    expect(yesVotesPageStep(at(36, 24, 12, 0))).toBe(2);
  });

  it("is 0 where no round or no date can be read, which turns the page keys off", () => {
    expect(yesVotesPageStep([])).toBe(0);
    expect(yesVotesPageStep([{ ...roundAt(1, 0, 35, T0), date: "yesterday" }])).toBe(0);
    // A round whose date cannot be read is not counted; the others are.
    expect(yesVotesPageStep([{ ...roundAt(1, 0, 35, T0), date: "yesterday" }, roundAt(2, 0, 35, T0)])).toBe(1);
  });

  it("is the page step of the chart", () => {
    const rounds = hourly(1, 2, 3, 4);
    expect(build({ rounds }).consensus!.chart!.pageStep).toBe(yesVotesPageStep(rounds));
  });
});

// ---- History (6.4) -----------------------------------------------------------------------------------------------------------------------

describe("amendmentPage: the history", () => {
  it("lists history newest first, with the pending item for a majority", () => {
    const { history } = build();
    expect(history.pending).toEqual({ when: "Oct 31, 2026, 15:54 UTC, if the majority holds", countdown: { at: unixOf("2026-10-31T15:54:20Z") } });
    expect(history.events).toEqual([
      {
        event: "got_majority",
        label: "Got majority",
        date: "Oct 17, 2026",
        ledger: { text: "#107,704,833", href: "/xrpl/ledger/107704833" },
        tx: { text: `EnableAmendment ${shortHash(MAJORITY_TX)}`, href: `/xrpl/tx/${MAJORITY_TX}` },
      },
      {
        event: "lost_majority",
        label: "Lost majority",
        date: "Aug 30, 2026",
        ledger: { text: "#106,600,001", href: "/xrpl/ledger/106600001" },
        tx: { text: `EnableAmendment ${shortHash("322F9E58EDBEEB643D949CF33F3FD6D0049E537B493EB08D262446CBD9C189E1")}`, href: "/xrpl/tx/322F9E58EDBEEB643D949CF33F3FD6D0049E537B493EB08D262446CBD9C189E1" },
      },
      {
        event: "got_majority",
        label: "Got majority",
        date: "Aug 20, 2026",
        ledger: { text: "#106,500,001", href: "/xrpl/ledger/106500001" },
        tx: { text: `EnableAmendment ${shortHash("62C1656A2A1702F45C414DB330DBBEA25FDA830A80131B0C56BE514A7B6B68B1")}`, href: "/xrpl/tx/62C1656A2A1702F45C414DB330DBBEA25FDA830A80131B0C56BE514A7B6B68B1" },
      },
    ]);
    expect(history.note).toBe("Each change of majority is an EnableAmendment pseudo-transaction, in the ledger after a flag ledger.");
  });

  it("writes the same history whether or not the majority has its ledger and transaction", () => {
    // The events carry their own ledgers and transactions; the majority's own (G5) is only in the grid and in the sentence.
    const full = build().history;
    const bare = build({ majority: { since: "2026-10-17T15:54:20Z", expected_activation: "2026-10-31T15:54:20Z" } }).history;
    expect(bare).toEqual(full);
  });

  it("has no pending item unless the amendment has a majority", () => {
    expect(buildWithout(votingCase()).history.pending).toBeNull();
    expect(buildWithout(enabledCase()).history.pending).toBeNull();
    expect(buildWithout(obsoleteCase()).history.pending).toBeNull();
    // A `majority` that D1 left on an amendment of another status (it should not) waits for nothing: the status decides.
    const leftover = { since: "2026-10-17T15:54:20Z", expected_activation: "2026-10-31T15:54:20Z" };
    expect(buildWithout({ ...votingCase(), majority: leftover }).history.pending).toBeNull();
    expect(buildWithout({ ...votingCase(), majority: leftover }).identity.grid.map((row) => row.label)).toEqual(["Specification", "Introduced in"]);
    // An expected activation that is not a time has nothing to count down to.
    expect(build({ majority: { since: "2026-10-17T15:54:20Z", expected_activation: "soon" } }).history.pending).toBeNull();
  });

  it("lists an enabled amendment's EnableAmendment, with its transaction", () => {
    const { events } = buildWithout(enabledCase()).history;
    expect(events).toEqual([
      {
        event: "enabled",
        label: "Enabled",
        date: "Mar 22, 2026",
        ledger: { text: "#107,747,841", href: "/xrpl/ledger/107747841" },
        tx: { text: `EnableAmendment ${shortHash(ENABLE_TX)}`, href: `/xrpl/tx/${ENABLE_TX}` },
      },
    ]);
  });

  it("has one item for an amendment enabled from the metadata: its date, its ledger if known, and no transaction", () => {
    const { events } = buildWithout(metadataCase()).history;
    expect(events).toEqual([{ event: "enabled", label: "Enabled", date: "Feb 3, 2025", ledger: { text: "#90,000,001", href: "/xrpl/ledger/90000001" }, tx: null }]);
    // Either of date and ledger may be missing from the file.
    expect(buildWithout({ ...metadataCase(), enabled: { source: "metadata", date: "2025-02-03" } }).history.events).toEqual([
      { event: "enabled", label: "Enabled", date: "Feb 3, 2025", ledger: null, tx: null },
    ]);
    expect(buildWithout({ ...metadataCase(), enabled: { source: "metadata", ledger_index: 7 } }).history.events).toEqual([
      { event: "enabled", label: "Enabled", date: "—", ledger: { text: "#7", href: "/xrpl/ledger/7" }, tx: null },
    ]);
  });

  it("puts the metadata's enabling above any events the index does have, and never twice", () => {
    const events = buildWithout({ ...metadataCase(), history: majorityCase().history }).history.events;
    expect(events.map((event) => event.event)).toEqual(["enabled", "got_majority", "lost_majority", "got_majority"]);
    expect(events[0]!.tx).toBeNull();
    // An indexed `enabled` event is the item: the metadata's would say the same twice.
    const indexed = buildWithout({ ...metadataCase(), history: enabledCase().history }).history.events;
    expect(indexed.map((event) => event.event)).toEqual(["enabled"]);
    expect(indexed[0]!.tx).not.toBeNull();
  });

  it("has no event for a retired amendment the ledger never listed, an obsolete one or a voting one", () => {
    expect(buildWithout(retiredCase()).history.events).toEqual([]);
    expect(buildWithout(obsoleteCase()).history.events).toEqual([]);
    expect(buildWithout(votingCase()).history.events).toEqual([]);
  });

  it("leaves out an event it has no word for, rather than naming it wrongly", () => {
    const [first, ...rest] = majorityCase().history;
    const history = [first!, { ...first!, event: "frozen" }, ...rest];
    expect(build({ history }).history.events.map((event) => event.event)).toEqual(["got_majority", "lost_majority", "got_majority"]);
  });

  it("links the ledgers of the network the page is of", () => {
    expect(build({}, { network: XAHAU }).history.events[0]!.ledger).toEqual({ text: "#107,704,833", href: "/xahau/ledger/107704833" });
    expect(build({}, { network: XAHAU }).history.events[0]!.tx!.href).toBe(`/xahau/tx/${MAJORITY_TX}`);
  });
});

// ---- Votes (6.5) -------------------------------------------------------------------------------------------------------------------------

describe("amendmentPage: a status a newer D1 sends", () => {
  // `amendmentStatusView` reads a word it does not know as `unknown`: the pill says "Unknown", and the page is drawn as for D1's unknown, which is voted on.
  const frozen = (): AmendmentDetail => ({ ...votingCase(), status: "frozen" });

  it("is Unknown, with the votes, the consensus and the history of an amendment still voted on", () => {
    const page = buildWithout(frozen());
    expect(page.identity.status).toEqual({ status: "unknown", share: "11.4%" });
    expect(tablesOf(page).unl).toHaveLength(5);
    expect(sentencesOf(page)).toEqual(["4 of 35 UNL validators vote yes; 25 more are needed.", "Votes of voting ledger #107,748,095, Oct 19, 2026, 15:48 UTC."]);
    expect(page.meta.description).toBe("4 of 35 validators of XRPL's default UNL vote for DID; 29 are needed.");
  });

  it("does not say no name is known for an amendment that has one; one that has none says it", () => {
    expect(gridOf(buildWithout(frozen()))).toEqual([
      ["Specification", "No XLS"],
      ["Introduced in", "rippled 1.12.0"],
    ]);
    const nameless = frozen();
    delete nameless.name;
    expect(gridOf(buildWithout(nameless)).at(-1)).toEqual(["Status", "No name is known for this ID, from the data API's metadata or its node."]);
  });
});

describe("amendmentPage: the votes", () => {
  it("has no tables for an enabled or an obsolete amendment, which is no longer voted on, whatever D1 lists: the note in their place", () => {
    // D1 still lists the validators of an amendment that is no longer voted on, each "no" or without a recent vote (the AMM fixture's: 33 no, 2 none).
    for (const amendment of [enabledCase(), metadataCase(), retiredCase(), obsoleteCase()]) expect(amendment.unl_votes.length, amendment.name).toBeGreaterThan(0);
    const enabled = { note: "An enabled amendment is no longer voted on." };
    expect(buildWithout(enabledCase()).votes).toEqual(enabled);
    expect(buildWithout(metadataCase()).votes).toEqual(enabled);
    expect(buildWithout(retiredCase()).votes).toEqual(enabled);
    expect(buildWithout(obsoleteCase()).votes).toEqual({ note: "Current software can no longer vote for it, so no votes are shown." });
    // Without S as well: the note does not depend on it.
    expect(buildWithout(enabledCase(), { summary: { state: "failed" } }).votes).toEqual(enabled);
  });

  it("has the tables for an amendment still voted on: a majority, a voting one and an unknown one", () => {
    for (const amendment of [majorityCase(), votingCase(), unknownCase()]) {
      const { unl, others } = tablesOf(buildWithout(amendment));
      expect(unl.map((row) => row.key), amendment.status).toEqual(SAMPLE_KEYS.slice(0, 5));
      expect(others.map((row) => row.key), amendment.status).toEqual([SAMPLE_KEYS[7], SAMPLE_KEYS[8]]);
    }
  });

  it("lists the UNL's votes and the others' in D1's order", () => {
    const { unl, others } = tablesOf(build());
    expect(unl.map((row) => row.key)).toEqual(SAMPLE_KEYS.slice(0, 5));
    expect(others.map((row) => row.key)).toEqual([SAMPLE_KEYS[7], SAMPLE_KEYS[8]]);
    expect(unl.map((row) => row.vote)).toEqual(["yes", "yes", "yes", "no", "none"]);
    expect(others.map((row) => row.vote)).toEqual(["yes", "no"]);
  });

  it("names a validator by its domain, else by its short key in mono, and links its page on the network", () => {
    const [northpeak, , nameless] = tablesOf(build()).unl;
    expect(northpeak!.name).toEqual({ text: "northpeak.example", mono: false });
    expect(northpeak!.href).toBe(`/xrpl/validators/${SAMPLE_KEYS[0]}`);
    expect(nameless!.name).toEqual({ text: shortHash(SAMPLE_KEYS[2]), mono: true });
    expect(tablesOf(build({}, { network: XAHAU })).unl[0]!.href).toBe(`/xahau/validators/${SAMPLE_KEYS[0]}`);
  });

  it("gives the version as reported, the seconds it was last seen at, and nothing for what D1 does not have", () => {
    const rows = tablesOf(build()).unl;
    expect(rows[0]!.version).toBe("3.4.1");
    expect(rows[0]!.lastSeen).toBe(unixOf("2026-10-19T15:53:19.750Z"));
    expect(Number.isInteger(rows[0]!.lastSeen)).toBe(true);
    // A validator that reported no version.
    expect(rows[4]!.version).toBeNull();
    const never: AmendmentVote = { validation_public_key: SAMPLE_KEYS[0], vote: "none" };
    expect(tablesOf(build({ unl_votes: [never] })).unl[0]).toEqual({ key: SAMPLE_KEYS[0], name: { text: shortHash(SAMPLE_KEYS[0]), mono: true }, href: `/xrpl/validators/${SAMPLE_KEYS[0]}`, vote: "none", version: null, lacks: false, lastSeen: null });
    expect(tablesOf(build({ unl_votes: [{ ...never, last_seen: "never" }] })).unl[0]!.lastSeen).toBeNull();
    expect(tablesOf(build({ unl_votes: [{ ...never, version: "" }] })).unl[0]!.version).toBeNull();
  });

  it("marks a validator whose version lacks it", () => {
    // The sample's amendment was introduced in 3.4.1: 3.4.0 does not have it.
    const { unl, others } = tablesOf(build());
    expect(unl.map((row) => row.lacks)).toEqual([false, false, true, true, false]);
    expect(unl.map((row) => row.version)).toEqual(["3.4.1", "3.4.1", "3.4.0", "3.4.0", null]);
    expect(others.map((row) => row.lacks)).toEqual([false, false]);
    // `version_supports` absent (a version or an introduction not known) is not a claim.
    const unknown: AmendmentVote = { validation_public_key: SAMPLE_KEYS[0], vote: "yes", version: "3.4.0" };
    expect(tablesOf(build({ unl_votes: [unknown] })).unl[0]!.lacks).toBe(false);
  });

  it("writes vote counts, with publishers and others seen only with S", () => {
    const page = build();
    expect(tablesOf(page).counts).toEqual({ yes: 3, no: 1, none: 1, otherYes: 1 });
    expect(page.summary).toEqual({ state: "ok", publishers: ["unl.xrplf.org", "vl.ripple.com"], othersSeen: 20 });
    // Without S the counts stand and the page leaves out what S adds; a `missing` answer is a failure to this page.
    for (const summary of [{ state: "failed" }, { state: "missing" }] as const) {
      const without = build({}, { summary });
      expect(without.summary).toEqual({ state: "failed" });
      expect(without.votes).toEqual(page.votes);
    }
  });

  it("counts every vote of the UNL, and the yes votes of the others", () => {
    const vote = (key: number, v: AmendmentVote["vote"]): AmendmentVote => ({ validation_public_key: SAMPLE_KEYS[key]!, vote: v });
    const page = build({ unl_votes: [vote(0, "yes"), vote(1, "yes"), vote(2, "no"), vote(3, "none"), vote(4, "none"), vote(5, "none")], other_votes: [vote(6, "no"), vote(7, "no")] });
    expect(tablesOf(page).counts).toEqual({ yes: 2, no: 1, none: 3, otherYes: 0 });
    expect(tablesOf(build({ unl_votes: [], other_votes: [] })).counts).toEqual({ yes: 0, no: 0, none: 0, otherYes: 0 });
  });

  it("reads the publishers and the others seen from S, in S's order", () => {
    const summary: Loaded<ValidatorsSummary> = { state: "ok", value: summarySample({ validators: { seen_24h: 90, unl_seen_24h: 30, others_seen_24h: 60, all: 91 } }) };
    expect(build({}, { summary }).summary).toEqual({ state: "ok", publishers: ["unl.xrplf.org", "vl.ripple.com"], othersSeen: 60 });
  });
});

// ---- §8: the title and the description ---------------------------------------------------------------------------------------------------

describe("amendmentPage: the title and the description", () => {
  // The sample's descriptions are D1's; the cases here have none, so the sentences are §8's alone.
  const CASES = [
    ["majority", { ...majorityCase(), description: undefined }, "Amendment XChainBridge · XRPL · explorer", "XChainBridge has had a majority of XRPL's default UNL since Oct 17, 2026 and activates on or soon after Oct 31, 2026 if it holds."],
    ["voting", votingCase(), "Amendment DID · XRPL · explorer", "4 of 35 validators of XRPL's default UNL vote for DID; 29 are needed."],
    ["enabled", enabledCase(), "Amendment AMM · XRPL · explorer", "AMM is enabled on XRPL since Mar 22, 2026 (ledger 107,747,841)."],
    ["enabled from metadata", metadataCase(), "Amendment fix1201 · XRPL · explorer", "fix1201 is enabled on XRPL since Feb 3, 2025 (ledger 90,000,001)."],
    ["retired", retiredCase(), "Amendment CryptoConditions · XRPL · explorer", "CryptoConditions is enabled on XRPL."],
    ["obsolete", obsoleteCase(), "Amendment fixNFTokenNegOffer · XRPL · explorer", "fixNFTokenNegOffer is obsolete on XRPL: current software can no longer vote it in."],
    ["unknown", unknownCase(), "Amendment 98433D…CA76 · XRPL · explorer", "An amendment of XRPL with no known name: its votes and history."],
  ] as const;

  it.each(CASES)("writes §8's title and description for %s", (_name, amendment, title, description) => {
    expect(buildWithout(amendment).meta).toEqual({ title, description });
  });

  it("names the network and the numbers of the page", () => {
    const xahau = buildWithout(votingCase(), { network: XAHAU });
    expect(xahau.meta.title).toBe("Amendment DID · Xahau · explorer");
    expect(xahau.meta.description).toBe("4 of 35 validators of Xahau's default UNL vote for DID; 29 are needed.");
  });

  it("says 'is needed' for a single vote, as the card does", () => {
    expect(build({ ...tallied({ yes: 0, trusted: 1, needed: 1 }), status: "voting", majority: undefined }).meta.description).toMatch(/^0 of 1 validators of XRPL's default UNL vote for XChainBridge; 1 is needed\./);
  });

  it("follows D1's description with its own", () => {
    expect(build().meta.description).toBe(
      "XChainBridge has had a majority of XRPL's default UNL since Oct 17, 2026 and activates on or soon after Oct 31, 2026 if it holds. Made up for the samples: bridges between two ledgers.",
    );
    expect(buildWithout({ ...unknownCase(), description: "Seen in the node's list." }).meta.description).toBe("An amendment of XRPL with no known name: its votes and history. Seen in the node's list.");
  });

  it("names a nameless amendment of any status by its short ID", () => {
    const voting = votingCase();
    delete voting.name;
    expect(buildWithout(voting).meta.title).toBe(`Amendment ${shortHash(DID_ID)} · XRPL · explorer`);
    expect(buildWithout(voting).meta.description).toBe(`4 of 35 validators of XRPL's default UNL vote for ${shortHash(DID_ID)}; 29 are needed.`);
  });

  it("does not claim what the answer does not say", () => {
    // No round stored: no numbers to quote.
    expect(buildWithout({ ...votingCase(), votes: undefined }).meta.description).toBe("The validators of XRPL's default UNL are voting on DID.");
    // A majority without its dates, an enabled amendment without its date or ledger.
    expect(buildWithout({ ...majorityCase(), description: undefined, majority: undefined }).meta.description).toBe("XChainBridge has a majority of XRPL's default UNL.");
    expect(buildWithout({ ...enabledCase(), enabled: { source: "ledger" } }).meta.description).toBe("AMM is enabled on XRPL.");
    expect(buildWithout({ ...enabledCase(), enabled: { source: "ledger", ledger_index: 12 } }).meta.description).toBe("AMM is enabled on XRPL (ledger 12).");
  });

  it("has no age and no countdown in it", () => {
    for (const [, amendment] of CASES) {
      const { title, description } = buildWithout(amendment).meta;
      expect(`${title} ${description}`).not.toMatch(/\b(ago|in \d+ (min|h|days))\b|~|\bin about\b/);
    }
  });
});

// ---- The page as a whole -----------------------------------------------------------------------------------------------------------------

describe("amendmentPage: the whole page", () => {
  it("carries the network it was built for", () => {
    expect(build().network).toBe(XRPL);
    expect(build({}, { network: XAHAU }).network).toBe(XAHAU);
  });

  it("is a pure function of its input: the same input gives the same page", () => {
    expect(build()).toEqual(build());
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it("does not change what it is given", () => {
    const amendment = amendmentDetailSample();
    const before = JSON.stringify(amendment);
    amendmentPage({ network: XRPL, amendment, summary: OK });
    expect(JSON.stringify(amendment)).toBe(before);
  });

  it("puts no float in any string: shares have the decimals the rules say, and no more", () => {
    const strings: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
    };
    // A share that does not divide evenly: 1 of 3.
    const rounds = hourly([1, 3], [2, 3], [1, 7]);
    walk(build({ ...tallied({ yes: 1, trusted: 3, needed: 3 }), rounds }));
    walk(buildWithout(votingCase()));
    expect(strings.length).toBeGreaterThan(50);
    for (const text of strings) expect(text, text).not.toMatch(/\d\.\d{3,}/);
    expect(build({ ...tallied({ yes: 1, trusted: 3, needed: 3 }), rounds }).consensus!.chart!.series[0]!.values).toEqual(["33.33", "66.67", "14.29"]);
  });

  it("builds the page of 2,600 rounds quickly enough to run in a request", () => {
    const rounds: AmendmentRoundPoint[] = [];
    for (let index = 0; index < 2_600; index += 1) rounds.push(roundAt(index + 1, index % 36, 35, T0 + index * 16 * 60_000));
    const started = performance.now();
    build({ rounds });
    // Loose, for a suite that runs on a loaded shared machine: the real figure is a few milliseconds, and this catches a build gone far wrong, not a slow machine.
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
