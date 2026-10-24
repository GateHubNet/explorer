import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AMM_ID, amendmentDetailSample, SAMPLE_KEYS, summarySample, UNKNOWN_ID, XCB_ID } from "../../../test/support/d1-samples";
import { serverThenHydrated } from "../../../test/support/hydrate";
import type { Loaded } from "../../server/account-view";
import { amendmentPage, type AmendmentPageData } from "../../server/amendment-view";
import type { AmendmentDetail, AmendmentRoundPoint, ValidatorsSummary } from "../../server/api-types";
import type { NetworkInfo } from "../networks";
import type { LiveControls } from "../use-live-controls";
import { AmendmentPage } from "./AmendmentPage";

// ---- The world of the tests ------------------------------------------------------------------------------------------------------------------

const XRPL: NetworkInfo = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" };
const XAHAU: NetworkInfo = { id: "xahau", kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX", native: "XAH", software: "xahaud" };

/** 2026-10-19 16:00:00 UTC: a little under twelve days before the sample's activation (Oct 31, 15:54), 401 s after its voters were last seen (15:53:19.750). */
const NOW = Date.UTC(2026, 9, 19, 16, 0, 0);
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

beforeEach(() => {
  // `Date` alone: the countdowns and the ages read the clock, the rest of the test's timers are real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const DID_ID = "DB432C3A09D9D5DFC7859F39AE5FF767ABC59AED0A9FB441E83B814D8946C109";
const FIX1201_ID = "B4D44CC3111ADD964E846FC57760C8B50FFCD5A82C86A72756F6B058DDDF96AD";
const RETIRED_ID = "6E739F4F8B07BED29FC9FF440DA3C301CD14A180DF45819F658FEC2F7DE31427";
const OBSOLETE_ID = "36799EA497B1369B170805C078AEFE6188345F9B3E324C21E9CA3FF574E3C3D6";
const ENABLE_TX = "F5AFF7C2C2CD3F3CD74221F3D78C190BAAF45B3A6867CD165CB0253679EE0C6E";

const OK: Loaded<ValidatorsSummary> = { state: "ok", value: summarySample() };
const FAILED: Loaded<ValidatorsSummary> = { state: "failed" };

/** The sample (XChainBridge, with a majority) without what only a majority has, and without the keys a case leaves out (D1 leaves a key out; it never sends `null`). */
function sample(over: Partial<AmendmentDetail>, ...absent: (keyof AmendmentDetail)[]): AmendmentDetail {
  const detail: AmendmentDetail = { ...amendmentDetailSample(), ...over };
  for (const key of ["votes", "majority"] as const) if (!(key in over)) delete detail[key];
  for (const key of absent) delete detail[key];
  return detail;
}

/** Rounds an hour apart up to the sample's newest, with the yes votes given (35 trusted). */
const hourly = (...yes: number[]): AmendmentRoundPoint[] =>
  yes.map((count, index) => ({
    ledger_index: 107_740_000 + 256 * index - 1,
    flag_ledger: 107_740_000 + 256 * index,
    date: iso(NOW - (yes.length - index) * 3_600_000),
    yes: count,
    trusted: 35,
    threshold: 28,
    passes: count > 28,
  }));

const votingCase = (): AmendmentDetail =>
  sample(
    {
      id: DID_ID,
      name: "DID",
      status: "voting",
      introduced: "1.12.0",
      votes: { ledger_index: 107748095, yes: 4, trusted: 35, needed: 29, pct: 11.43 },
      round: { ledger_index: 107748095, date: "2026-10-19T15:48:20Z", unl_size: 35, trusted: 35, threshold: 28, needed: 29, observed: 35 },
      rounds: hourly(2, 4, 4),
      history: [],
    },
    "xls",
    "xls_url",
    "description",
  );

const enabledCase = (): AmendmentDetail =>
  sample({
    id: AMM_ID,
    name: "AMM",
    status: "enabled",
    introduced: "1.12.0",
    xls: "XLS-30",
    xls_url: "https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0030-automated-market-maker",
    description: "Automated market makers in the decentralized exchange.",
    enabled: { ledger_index: 107747841, date: "2026-03-22T15:31:24Z", tx_hash: ENABLE_TX, source: "ledger" },
    rounds: [],
    history: [{ event: "enabled", ledger_index: 107747841, date: "2026-03-22T15:31:24Z", tx_hash: ENABLE_TX }],
  });

const metadataCase = (): AmendmentDetail =>
  sample(
    { id: FIX1201_ID, name: "fix1201", status: "enabled", introduced: "0.80.0", enabled: { ledger_index: 90000001, date: "2025-02-03", source: "metadata" }, rounds: [], history: [] },
    "xls",
    "xls_url",
    "description",
  );

const retiredCase = (): AmendmentDetail =>
  sample({ id: RETIRED_ID, name: "XahauGenesis", status: "enabled", retired: true, introduced: "2023.10.30", rounds: [], history: [] }, "xls", "xls_url", "description");

const obsoleteCase = (): AmendmentDetail =>
  sample({ id: OBSOLETE_ID, name: "fixNFTokenNegOffer", status: "obsolete", introduced: "1.9.0", rounds: [], history: [] }, "xls", "xls_url", "description");

const unknownCase = (): AmendmentDetail =>
  sample(
    { id: UNKNOWN_ID, status: "unknown", votes: { ledger_index: 107748095, yes: 0, trusted: 35, needed: 29, pct: 0 }, rounds: hourly(0, 0, 0), history: [] },
    "name",
    "introduced",
    "xls",
    "xls_url",
    "description",
  );

const build = (amendment: AmendmentDetail = amendmentDetailSample(), summary: Loaded<ValidatorsSummary> = OK, network: NetworkInfo = XRPL): AmendmentPageData =>
  amendmentPage({ network, amendment, summary });

/** What the route hands the page: the builder's data, the anchor the loader read and the build. */
const loaded = (data: AmendmentPageData) => ({ ...data, anchor: { lastValidated: 107748183, closeTime: NOW / 1000 }, build: "test-build" });

const controls = (over: Partial<LiveControls> = {}): LiveControls => ({
  paused: false,
  held: false,
  notice: "",
  failures: 0,
  onTogglePause: vi.fn(),
  onHold: vi.fn(),
  ...over,
});

const routed = (ui: ReactElement, at = "/xrpl/amendments/XChainBridge") => <RouterProvider router={createMemoryRouter([{ path: "*", element: ui }], { initialEntries: [at] })} />;

/** The page in a router, drawn in the browser at once. */
const mount = (data: AmendmentPageData, live = controls()) => render(routed(<AmendmentPage data={loaded(data)} live={live} />));

/** The page as the Worker prints it, into the stored HTML. */
const htmlOf = (data: AmendmentPageData) => renderToString(routed(<AmendmentPage data={loaded(data)} live={controls()} />));

const text = (element: Element | null | undefined) => (element?.textContent ?? "").replace(/\s+/g, " ").trim();
/** The text of stored HTML as a reader gets it: the tags and React's comment markers between two text nodes taken out. */
const textOfHtml = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

const identity = () => screen.getByRole("region", { name: "Amendment" });
/** The grid of the identity as `[label, value]`. */
const facts = () =>
  Array.from(identity().querySelectorAll(".amendment__grid > *"), (fact) => [text(fact.firstElementChild), text(fact.lastElementChild)] as const);
const consensus = () => screen.queryByRole("region", { name: "Consensus" });
const history = () => screen.getByRole("region", { name: "History" });
const votes = () => screen.getByRole("region", { name: "Votes of the UNL validators" });
const table = (name: string) => screen.getByRole("table", { name });
/** The rows of a table as arrays of cell texts, the header first. */
const rowsOf = (name: string) => within(table(name)).getAllByRole("row").map((row) => Array.from(row.querySelectorAll('[role="cell"], [role="columnheader"]'), text));

// ---- The heading and the live row ------------------------------------------------------------------------------------------------------------

describe("AmendmentPage, the heading", () => {
  it("has the breadcrumb XRPL / Network / Amendments / XChainBridge, the name in mono and the current page", () => {
    mount(build());
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["XRPL/", "Network/", "Amendments/", "XChainBridge"]);
    expect(crumbs.getByRole("link", { name: "XRPL" }).getAttribute("href")).toBe("/xrpl");
    expect(crumbs.getByRole("link", { name: "Network" }).getAttribute("href")).toBe("/xrpl/network");
    expect(crumbs.getByRole("link", { name: "Amendments" }).getAttribute("href")).toBe("/xrpl/amendments");
    const current = crumbs.getByText("XChainBridge");
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.classList.contains("mono")).toBe(true);
  });

  it("has 'Amendment' over the one h1, the name in mono, with the status pill beside it and the source line", () => {
    mount(build());
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings.map((h) => h.textContent)).toEqual(["XChainBridge"]);
    expect(headings[0]!.classList.contains("mono")).toBe(true);
    expect(within(identity()).getByText("Amendment")).toBeTruthy();
    // The pill counts down in the browser: the activation is a little under twelve days away.
    expect(text(identity().querySelector(".pill"))).toBe("Activating, in 12 days");
    expect(within(identity()).getByText("/v2/network/amendments/{name}")).toBeTruthy();
  });

  it("names a nameless amendment 'Unknown amendment', with its short ID after it, and its short ID in the breadcrumb", () => {
    mount(build(unknownCase()));
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Unknown amendment");
    expect(h1.classList.contains("mono")).toBe(false);
    const short = h1.nextElementSibling!;
    expect(short.textContent).toBe("98433D…CA76");
    expect(short.classList.contains("mono")).toBe(true);
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByText("98433D…CA76").getAttribute("aria-current")).toBe("page");
    expect(crumbs.getByText("98433D…CA76").classList.contains("mono")).toBe(true);
    expect(text(identity().querySelector(".pill"))).toBe("Unknown");
  });

  it("has the live row after the breadcrumb: the dot, 'Live · updates every minute' and the button", () => {
    const { container } = mount(build());
    const row = container.querySelector(".hero__status-row")!;
    expect(row.previousElementSibling?.getAttribute("aria-label")).toBe("Breadcrumb");
    expect(text(row.querySelector(".hero__status"))).toBe("Live · updates every minute");
    expect(within(row as HTMLElement).getByRole("button", { name: "Pause live updates" })).toBeTruthy();
  });

  it("says in the live row that the page waits while the visitor is on a table", () => {
    const { container } = mount(build(), controls({ held: true }));
    expect(text(container.querySelector(".hero__held"))).toBe("Paused while you look at the table");
  });
});

// ---- The identity (6.1) ----------------------------------------------------------------------------------------------------------------------

describe("AmendmentPage, the identity", () => {
  it("has the ID in full with a button that copies it", () => {
    mount(build());
    expect(within(identity()).getByText("Amendment ID")).toBeTruthy();
    expect(text(identity().querySelector(".amendment__id"))).toBe(XCB_ID);
    expect(within(identity()).getByRole("button", { name: "Copy amendment ID" })).toBeTruthy();
  });

  it.each([
    [
      "majority",
      amendmentDetailSample,
      [
        ["Specification", "XLS-38 (opens in a new tab)"],
        ["Introduced in", "rippled 3.4.1"],
        ["Majority since", "Oct 17, 2026 · ledger #107,704,833 · EnableAmendment F78430…7ED4"],
        ["Activates on", "on or soon after Oct 31, 2026, 15:54 UTC, if it holds · in 12 days"],
      ],
    ],
    [
      "voting",
      votingCase,
      [
        ["Specification", "No XLS"],
        ["Introduced in", "rippled 1.12.0"],
      ],
    ],
    [
      "enabled",
      enabledCase,
      [
        ["Specification", "XLS-30 (opens in a new tab)"],
        ["Introduced in", "rippled 1.12.0"],
        ["Enabled on", "Mar 22, 2026, 15:31 UTC · ledger #107,747,841 · EnableAmendment F5AFF7…0C6E"],
      ],
    ],
    [
      "enabled from metadata",
      metadataCase,
      [
        ["Specification", "No XLS · fix amendments have none"],
        ["Introduced in", "rippled 0.80.0"],
        ["Enabled on", "Feb 3, 2025 · ledger #90,000,001 · before the indexed history"],
      ],
    ],
    [
      "obsolete",
      obsoleteCase,
      [
        ["Specification", "No XLS · fix amendments have none"],
        ["Introduced in", "rippled 1.9.0"],
        ["Status", "Current software can no longer vote it in."],
      ],
    ],
    [
      "unknown",
      unknownCase,
      [
        ["Specification", "No XLS"],
        ["Introduced in", "Not known"],
        ["Status", "No name is known for this ID, from the data API's metadata or its node."],
      ],
    ],
  ] as const)("draws the grid of %s", (_status, amendment, grid) => {
    mount(build(amendment()));
    expect(facts()).toEqual(grid);
  });

  it("draws a retired amendment of Xahau as always on, with its Activated pill and the retired tag", () => {
    mount(build(retiredCase(), OK, XAHAU));
    expect(facts().at(-1)).toEqual(["Status", "Always on: xahaud applies it although the ledger does not list it"]);
    expect(text(identity().querySelector(".pill"))).toBe("Activated");
    expect(within(identity()).getByText("retired").classList.contains("tag")).toBe(true);
  });

  it("links the XLS document in a new tab, and the ledger and the transaction of the majority", () => {
    mount(build());
    const xls = within(identity()).getByRole("link", { name: "XLS-38 (opens in a new tab)" });
    expect(xls.getAttribute("href")).toBe("https://github.com/XRPLF/XRPL-Standards/discussions/92");
    expect(xls.getAttribute("target")).toBe("_blank");
    expect(xls.getAttribute("rel")).toBe("noopener noreferrer");
    expect(within(identity()).getByRole("link", { name: "#107,704,833" }).getAttribute("href")).toBe("/xrpl/ledger/107704833");
    expect(within(identity()).getByRole("link", { name: "EnableAmendment F78430…7ED4" }).getAttribute("href")).toBe(
      "/xrpl/tx/F78430ADBAF1464366DC4AAA169171604FFD56A9BB28F27835A80EDB455F7ED4",
    );
  });

  it("has D1's description with the board's tag, and no description block without one", () => {
    mount(build());
    const about = identity().querySelector(".amendment__about")!;
    expect(text(about.firstElementChild)).toBe("Description hand-kept metadata, not read from the ledger");
    expect(within(about as HTMLElement).getByText("hand-kept metadata, not read from the ledger").classList.contains("tag")).toBe(true);
    expect(text(about.querySelector("p"))).toBe("Made up for the samples: bridges between two ledgers.");
    cleanup();
    mount(build(votingCase()));
    expect(identity().querySelector(".amendment__about")).toBeNull();
    expect(within(identity()).queryByText("Description")).toBeNull();
  });
});

// ---- Consensus (6.2) -------------------------------------------------------------------------------------------------------------------------

const CHART_TITLE = "Yes votes per flag ledger, % of the UNL, last 30 days";
const CHANGES = "Yes votes per flag ledger, changes only";

describe("AmendmentPage, the consensus", () => {
  it("has the yes share and its meter, named for a screen reader, with the tick's label", () => {
    mount(build());
    const card = consensus()!;
    expect(text(card.querySelector(".amendment__share"))).toBe("88.6%");
    const meter = within(card).getByRole("img", { name: "31 of 35 UNL validators vote yes, 88.6%; more than 80% needed" });
    expect(text(meter.querySelector(".meter__label"))).toBe("80%");
    expect(meter.classList.contains("meter--small")).toBe(false);
  });

  it("says how the vote stands and how long the majority has held, with the ledger as a link", () => {
    mount(build());
    const card = consensus()!;
    expect(text(card.querySelector(".amendment__tally"))).toBe("31 of the 35 UNL validators with a recent vote vote yes; 29 are needed.");
    const since = card.querySelector(".amendment__since")!;
    expect(text(since)).toBe(
      "2 can change their vote before it loses majority. Majority since Oct 17, 2026 at ledger #107,704,833; activates on or soon after Oct 31, 2026, 15:54 UTC if it holds.",
    );
    expect(within(since as HTMLElement).getByRole("link", { name: "#107,704,833" }).getAttribute("href")).toBe("/xrpl/ledger/107704833");
  });

  it("says how many more a voting amendment needs, and the voting ledger its votes are of", () => {
    mount(build(votingCase()));
    const card = consensus()!;
    expect(text(card.querySelector(".amendment__tally"))).toBe("4 of 35 UNL validators vote yes; 25 more are needed.");
    expect(text(card.querySelector(".amendment__since"))).toBe("Votes of voting ledger #107,748,095, Oct 19, 2026, 15:48 UTC.");
  });

  it("draws the yes votes as a step line in a chart card with the Chart/Table toggle, Page Up and Page Down moving a day", () => {
    const { container } = mount(build());
    const card = consensus()!;
    const chart = within(card).getByRole("region", { name: CHART_TITLE });
    expect(within(chart).getByRole("heading", { name: CHART_TITLE })).toBeTruthy();
    expect(within(chart).getByRole("radio", { name: "Chart" })).toBeTruthy();
    expect(within(chart).getByRole("radio", { name: "Table" })).toBeTruthy();
    // One series, drawn as steps (each segment level or upright), with a vertex only where the value changes: two changes in three rounds, four segments.
    const points = [...chart.querySelector("path.line")!.getAttribute("d")!.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)] as const);
    const segments = points.slice(1).map((point, index) => [points[index]!, point] as const);
    expect(segments).toHaveLength(4);
    expect(segments.every(([[x0, y0], [x1, y1]]) => x0 === x1 || y0 === y1)).toBe(true);
    expect(container.querySelector('[role="slider"]')!.getAttribute("aria-keyshortcuts")).toBe("PageUp PageDown");
    expect(Array.from(chart.querySelectorAll(".chart__notes p"), text)).toEqual([
      "One point per flag ledger, every 256 ledgers. The axis starts at 0%.",
      "One row per change in the yes count; the count holds until the next row.",
    ]);
  });

  it("has the chart's own table: the changes only, newest first, the majority as an icon and a word", () => {
    mount(build());
    expect(rowsOf(CHANGES)).toEqual([
      ["From flag ledger", "Date (UTC)", "Yes", "Share", "Majority"],
      ["#107,748,096", "Oct 19, 2026, 15:48 UTC", "31 / 35", "88.6%", "Yes"],
      ["#107,747,584", "Oct 19, 2026, 15:14 UTC", "29 / 35", "82.9%", "Yes"],
      ["#107,543,296", "Oct 9, 2026, 15:54 UTC", "0 / 35", "0.0%", "No"],
    ]);
    const rows = within(table(CHANGES)).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[4]!.querySelector("svg")?.getAttribute("aria-hidden"))).toEqual(["true", "true", "true"]);
    expect(rows.map((row) => within(row).getAllByRole("cell")[4]!.firstElementChild!.className)).toEqual(["st st--ok", "st st--ok", "st st--quiet"]);
    expect(within(rows[0]!).getByRole("link", { name: "#107,748,096" }).getAttribute("href")).toBe("/xrpl/ledger/107748096");
  });

  it("says there were no rounds in place of the chart, and keeps the figure and the sentences", () => {
    mount(build({ ...votingCase(), rounds: [] }));
    const card = consensus()!;
    expect(within(card).getByText("No voting rounds recorded in the last 30 days.")).toBeTruthy();
    expect(within(card).queryByRole("region", { name: CHART_TITLE })).toBeNull();
    expect(text(card.querySelector(".amendment__share"))).toBe("11.4%");
  });

  it("draws the chart alone for an amendment that has no tally yet", () => {
    mount(build(sample({ ...votingCase() }, "votes")));
    const card = consensus()!;
    expect(card.querySelector(".amendment__share")).toBeNull();
    expect(card.querySelector(".meter")).toBeNull();
    expect(card.querySelector(".amendment__tally")).toBeNull();
    expect(within(card).getByRole("region", { name: CHART_TITLE })).toBeTruthy();
  });

  it("draws the chart alone for an amendment enabled within the 30 days, and no card for one enabled or obsolete before them", () => {
    mount(build({ ...enabledCase(), rounds: hourly(30, 31) }));
    expect(consensus()!.querySelector(".amendment__share")).toBeNull();
    expect(within(consensus()!).getByRole("region", { name: CHART_TITLE })).toBeTruthy();
    for (const amendment of [enabledCase(), obsoleteCase(), metadataCase()]) {
      cleanup();
      mount(build(amendment));
      expect(consensus()).toBeNull();
      expect(screen.queryByText("No voting rounds recorded in the last 30 days.")).toBeNull();
    }
  });
});

// ---- History (6.4) ---------------------------------------------------------------------------------------------------------------------------

describe("AmendmentPage, the history", () => {
  const items = () => within(history()).getAllByRole("listitem");

  it("lists the enabling a majority waits for, then the changes of majority, newest first, each with its ledger and transaction", () => {
    mount(build());
    expect(items().map((item) => Array.from(item.querySelectorAll(".amendment__eventtext > *"), text))).toEqual([
      ["Enabled, expected", "Oct 31, 2026, 15:54 UTC, if the majority holds · in 12 days", "No transaction yet"],
      ["Got majority tfGotMajority", "Oct 17, 2026 · ledger #107,704,833", "EnableAmendment F78430…7ED4"],
      ["Lost majority tfLostMajority", "Aug 30, 2026 · ledger #106,600,001", "EnableAmendment 322F9E…89E1"],
      ["Got majority tfGotMajority", "Aug 20, 2026 · ledger #106,500,001", "EnableAmendment 62C165…68B1"],
    ]);
    const lost = items()[2]!;
    expect(within(lost).getByRole("link", { name: "#106,600,001" }).getAttribute("href")).toBe("/xrpl/ledger/106600001");
    expect(within(lost).getByRole("link", { name: "EnableAmendment 322F9E…89E1" }).getAttribute("href")).toBe(
      "/xrpl/tx/322F9E58EDBEEB643D949CF33F3FD6D0049E537B493EB08D262446CBD9C189E1",
    );
    expect(within(history()).getByText("tfLostMajority").classList.contains("mono")).toBe(true);
    expect(text(history().querySelector(".amendment__note"))).toBe("Each change of majority is an EnableAmendment pseudo-transaction, in the ledger after a flag ledger.");
    expect(within(history()).getByText("/v2/network/amendments/{name}")).toBeTruthy();
  });

  it("marks each item with a dot a screen reader does not read: dashed for the pending one, filled for a majority, outlined for its loss", () => {
    mount(build());
    const dots = items().map((item) => item.querySelector(".amendment__dot")!);
    expect(dots.map((dot) => dot.getAttribute("aria-hidden"))).toEqual(["true", "true", "true", "true"]);
    expect(dots.map((dot) => dot.className)).toEqual([
      "amendment__dot amendment__dot--pending",
      "amendment__dot amendment__dot--got",
      "amendment__dot amendment__dot--lost",
      "amendment__dot amendment__dot--got",
    ]);
  });

  it("marks the enabling with a check, and has no pending item once enabled", () => {
    mount(build(enabledCase()));
    expect(items()).toHaveLength(1);
    const dot = items()[0]!.querySelector(".amendment__dot")!;
    expect(dot.className).toBe("amendment__dot amendment__dot--enabled");
    expect(dot.querySelector("svg")).toBeTruthy();
    expect(text(items()[0]!.querySelector(".amendment__eventlabel"))).toBe("Enabled");
  });

  it("has one item for an amendment the metadata file enables: its day and ledger, before the indexed history, with no transaction", () => {
    mount(build(metadataCase()));
    expect(items().map((item) => Array.from(item.querySelectorAll(".amendment__eventtext > *"), text))).toEqual([["Enabled", "Feb 3, 2025 · ledger #90,000,001", "Before the indexed history"]]);
    expect(within(history()).queryByRole("link", { name: /EnableAmendment/ })).toBeNull();
  });

  it("says so when the index has nothing for it", () => {
    mount(build(votingCase()));
    expect(within(history()).queryByRole("list")).toBeNull();
    expect(within(history()).getByText("No EnableAmendment for it in the indexed history.")).toBeTruthy();
  });
});

// ---- Votes (6.5) -----------------------------------------------------------------------------------------------------------------------------

describe("AmendmentPage, the votes of the UNL validators", () => {
  const head = () => text(votes().querySelector(".amendment__count"));

  it("counts the votes in the head and names the publishers of S", () => {
    mount(build());
    expect(head()).toBe("3 yes · 1 no · 1 without a recent vote, on unl.xrplf.org and vl.ripple.com");
  });

  it("names no publisher without S", () => {
    mount(build(amendmentDetailSample(), FAILED));
    expect(head()).toBe("3 yes · 1 no · 1 without a recent vote");
  });

  it("leaves out 'without a recent vote' when every validator voted", () => {
    const amendment = amendmentDetailSample();
    mount(build({ ...amendment, unl_votes: amendment.unl_votes.map((vote) => (vote.vote === "none" ? { ...vote, vote: "no" as const } : vote)) }));
    expect(head()).toBe("3 yes · 2 no, on unl.xrplf.org and vl.ripple.com");
  });

  it.each([
    ["an enabled amendment", enabledCase, "An enabled amendment is no longer voted on."],
    ["an amendment enabled from the metadata file", metadataCase, "An enabled amendment is no longer voted on."],
    ["an obsolete amendment", obsoleteCase, "Current software can no longer vote for it, so no votes are shown."],
  ])("has the builder's note in the tables' place for %s, which is no longer voted on, though D1 lists its validators", (_name, amendment, note) => {
    expect(amendment().unl_votes.length).toBeGreaterThan(0);
    mount(build(amendment()));
    const card = screen.getByRole("region", { name: "Votes" });
    expect(card.classList.contains("amendment__votes")).toBe(true);
    expect(text(card.querySelector(".amendment__novotes"))).toBe(note);
    // No table, no count of "no" votes in a head, and no disclosure of the other validators.
    expect(screen.queryByRole("table", { name: "Votes of the UNL validators" })).toBeNull();
    expect(screen.queryByRole("table", { name: "Votes of other validators" })).toBeNull();
    expect(card.querySelector(".amendment__count, details")).toBeNull();
    expect(textOfHtml(htmlOf(build(amendment())))).not.toMatch(/\d+ yes · \d+ no|Other validators, not on the UNL/);
  });

  it("lists every UNL validator in D1's order: the link to its page, its vote, its version and when it was last seen", () => {
    mount(build());
    // 401 s ago: past the 5 coarse minutes, the age itself.
    expect(rowsOf("Votes of the UNL validators")).toEqual([
      ["Validator", "Vote", "Version", "Last seen"],
      ["northpeak.example", "Yes", "3.4.1", "6 min ago"],
      ["shoreline.example", "Yes", "3.4.1", "6 min ago"],
      ["nHUQGz…U1pv", "Yes", "3.4.0 its version lacks it", "6 min ago"],
      ["nHBZUm…pJaD", "No", "3.4.0 its version lacks it", "6 min ago"],
      ["nHUZzK…g2kQ", "No recent vote", "—", "6 min ago"],
    ]);
    const rows = within(table("Votes of the UNL validators")).getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByRole("link", { name: "northpeak.example" }).getAttribute("href")).toBe(`/xrpl/validators/${SAMPLE_KEYS[0]}`);
    expect(within(rows[0]!).getByRole("link", { name: "northpeak.example" }).classList.contains("mono")).toBe(false);
    expect(within(rows[2]!).getByRole("link", { name: "nHUQGz…U1pv" }).classList.contains("mono")).toBe(true);
    expect(within(rows[2]!).getByText("its version lacks it").className).toBe("amendment__lacks");
    expect(within(rows[0]!).getByText("3.4.1").classList.contains("mono")).toBe(true);
  });

  it("is no finer than 5 minutes for a validator seen a moment ago", () => {
    const amendment = amendmentDetailSample();
    mount(build({ ...amendment, unl_votes: [{ ...amendment.unl_votes[0]!, last_seen: iso(NOW - 120_000) }] }));
    expect(rowsOf("Votes of the UNL validators")[1]![3]).toBe("< 5 min ago");
  });

  it("is a live table, its rows keyed by master key, in a region 470 px high at most and 640 px wide at least", () => {
    const { container } = mount(build());
    expect(Array.from(table("Votes of the UNL validators").querySelectorAll('[role="row"][data-key]'), (row) => row.getAttribute("data-key"))).toEqual(SAMPLE_KEYS.slice(0, 5));
    const region = screen.getByRole("region", { name: "Votes of the UNL validators, scrollable table" });
    expect(region.style.maxHeight).toBe("470px");
    expect(region.classList.contains("table-scroll--capped")).toBe(true);
    expect(region.classList.contains("amendment__table")).toBe(true);
    expect(table("Votes of the UNL validators").style.minWidth).toBe("640px");
    expect(container.querySelector(".amendment__votes")).toBe(votes());
  });

  it("holds the page while a mouse is over a vote table or focus is on a link in it, and not for the chart", () => {
    const live = controls();
    mount(build(), live);
    const held = () => (live.onHold as ReturnType<typeof vi.fn>).mock.calls.map(([value]) => value);
    fireEvent.pointerEnter(consensus()!, { pointerType: "mouse" });
    fireEvent.pointerEnter(screen.getByRole("region", { name: CHART_TITLE }), { pointerType: "mouse" });
    expect(held()).toEqual([]);
    const region = screen.getByRole("region", { name: "Votes of the UNL validators, scrollable table" });
    fireEvent.pointerEnter(region, { pointerType: "mouse" });
    fireEvent.pointerLeave(region, { pointerType: "mouse" });
    expect(held()).toEqual([true, false]);
    act(() => within(region).getAllByRole("link")[0]!.focus());
    expect(held().at(-1)).toBe(true);
    act(() => (document.activeElement as HTMLElement).blur());
    expect(held().at(-1)).toBe(false);
  });
});

describe("AmendmentPage, the other validators", () => {
  const disclosure = () => votes().querySelector("details")!;

  it("are in a disclosure, closed, whose summary says how many of them vote yes and that their votes do not count", () => {
    mount(build());
    expect(disclosure().open).toBe(false);
    expect(text(disclosure().querySelector("summary"))).toBe("Other validators, not on the UNL · 1 of 2 vote yes · their votes do not count");
    expect(rowsOf("Votes of other validators")).toEqual([
      ["Validator", "Vote", "Version", "Last seen"],
      ["tidewater.example", "Yes", "3.4.1", "6 min ago"],
      ["nHU6XW…8srx", "No", "3.5.0", "6 min ago"],
    ]);
    expect(Array.from(table("Votes of other validators").querySelectorAll('[role="row"][data-key]'), (row) => row.getAttribute("data-key"))).toEqual([SAMPLE_KEYS[7], SAMPLE_KEYS[8]]);
  });

  it("says in its footer how many of the other validators seen they are, with the link to all validators", () => {
    mount(build());
    expect(text(disclosure().querySelector(".amendment__foot"))).toBe(
      "Showing 2 of the 20 other validators seen in the last 24 hours: those with a vote recorded. All validators →",
    );
    expect(within(disclosure()).getByRole("link", { name: "All validators →" }).getAttribute("href")).toBe("/xrpl/validators?scope=all");
  });

  it("leaves out the number seen without S, and says 'validator' for one", () => {
    mount(build(amendmentDetailSample(), FAILED));
    expect(text(disclosure().querySelector(".amendment__foot"))).toBe("Showing 2 other validators: those with a vote recorded. All validators →");
    cleanup();
    const amendment = amendmentDetailSample();
    mount(build({ ...amendment, other_votes: amendment.other_votes.slice(0, 1) }, FAILED));
    expect(text(disclosure().querySelector(".amendment__foot"))).toBe("Showing 1 other validator: those with a vote recorded. All validators →");
  });

  it("holds the page while a mouse is over their table", () => {
    const live = controls();
    mount(build(), live);
    fireEvent.pointerEnter(screen.getByRole("region", { name: "Votes of other validators, scrollable table" }), { pointerType: "mouse" });
    expect((live.onHold as ReturnType<typeof vi.fn>).mock.calls.map(([value]) => value)).toEqual([true]);
  });
});

// ---- Xahau ------------------------------------------------------------------------------------------------------------------------------------

describe("AmendmentPage, on Xahau", () => {
  it("counts down Xahau's 5 days of a majority, in the grid and in the history, under Xahau's breadcrumb", () => {
    const remit = sample({
      id: "0D8BF22FF7570D58598D1EF19EBB6E142AD46E59A223FD3816262FBB69345BEA",
      name: "Remit",
      status: "majority",
      introduced: "2025.2.6",
      votes: { ledger_index: 26596607, yes: 27, trusted: 29, needed: 24, pct: 93.1 },
      majority: { since: iso(NOW), expected_activation: iso(NOW + 5 * DAY) },
      rules: { threshold_percent: 80, majority_hold_seconds: 432000, flag_interval: 256 },
      history: [],
    });
    mount(build(remit, OK, XAHAU));
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Xahau" }).getAttribute("href")).toBe("/xahau");
    expect(facts()).toContainEqual(["Introduced in", "xahaud 2025.2.6"]);
    expect(facts()).toContainEqual(["Activates on", "on or soon after Oct 24, 2026, 16:00 UTC, if it holds · in 5 days"]);
    expect(text(within(history()).getAllByRole("listitem")[0]!.querySelector(".amendment__when"))).toBe("Oct 24, 2026, 16:00 UTC, if the majority holds · in 5 days");
    expect(text(identity().querySelector(".pill"))).toBe("Activating, in 5 days");
  });
});

// ---- The page follows the chain -------------------------------------------------------------------------------------------------------------

describe("AmendmentPage, when its data changes", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
  });

  let update!: (next: AmendmentPageData) => void;
  function Host({ first }: { first: AmendmentPageData }) {
    const [current, setCurrent] = useState(first);
    update = (next) => act(() => setCurrent(next));
    return <AmendmentPage data={loaded(current)} live={controls()} />;
  }

  it("animates nothing on the first render, on the server or in the browser", () => {
    const { container } = render(routed(<Host first={build()} />));
    expect(container.querySelector(".is-entering, .is-changed")).toBeNull();
    expect(htmlOf(build())).not.toMatch(/is-entering|is-changed/);
  });

  it("brings a new voter in as an entering row, and ticks in the yes share and the head that changed", () => {
    const { container } = render(routed(<Host first={build()} />));
    const amendment = amendmentDetailSample();
    const voter = { validation_public_key: SAMPLE_KEYS[5], domain: "harbor.example", vote: "yes" as const, version: "3.4.1", version_supports: true, last_seen: amendment.unl_votes[0]!.last_seen };
    update(build({ ...amendment, unl_votes: [...amendment.unl_votes, voter], votes: { ...amendment.votes!, yes: 32, pct: 91.43 } }));
    expect(Array.from(container.querySelectorAll(".is-entering"), (row) => row.getAttribute("data-key"))).toEqual([SAMPLE_KEYS[5]]);
    expect(Array.from(container.querySelectorAll(".amendment__share .is-changed, .amendment__count .is-changed"), text)).toEqual([
      "91.4%",
      "4 yes · 1 no · 1 without a recent vote, on unl.xrplf.org and vl.ripple.com",
    ]);
  });
});

// ---- The stored HTML -------------------------------------------------------------------------------------------------------------------------

describe("AmendmentPage, as the Worker prints it and the browser takes it over", () => {
  it.each([
    ["a majority", () => build()],
    ["a nameless amendment", () => build(unknownCase())],
    ["a retired amendment of Xahau", () => build(retiredCase(), OK, XAHAU)],
    ["an amendment enabled from the metadata file, without S", () => build(metadataCase(), FAILED)],
  ])("hydrates %s without a mismatch", async (_name, data) => {
    const { errors } = await serverThenHydrated(routed(<AmendmentPage data={loaded(data())} live={controls()} />));
    expect(errors).toEqual([]);
  });

  it("holds the whole page in the HTML, with absolute times where the browser has ages and countdowns", () => {
    const html = htmlOf(build());
    const stored = textOfHtml(html);
    for (const part of ["Votes of the UNL validators", "Other validators, not on the UNL", "tidewater.example", "History", "From flag ledger"]) {
      expect(stored).toContain(part);
    }
    expect(stored).toContain("Activating, expected Oct 31");
    expect(stored).toContain("on or soon after Oct 31, 2026, 15:54 UTC, if it holds");
    expect(stored).toContain("Oct 31, 2026, 15:54 UTC, if the majority holds");
    expect(stored).toContain("No transaction yet");
    expect(html).toContain(">2026-10-19 15:53:19 UTC</time>");
    expect(stored).not.toMatch(/\bago\b/);
    expect(stored).not.toMatch(/\bin \d+ (days?|h|min)\b/);
    expect(stored).not.toContain("in ~");
    expect(stored).not.toContain("at the next flag ledger");
  });
});
