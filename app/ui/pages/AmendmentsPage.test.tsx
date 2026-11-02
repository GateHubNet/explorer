import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { amendmentsSample, UNKNOWN_ID } from "../../../test/support/d1-samples";
import { serverThenHydrated } from "../../../test/support/hydrate";
import { amendmentsHref } from "../../domain/amendments-params";
import { amendmentsPage, type AmendmentsPageData } from "../../server/amendments-view";
import type { AmendmentRow, AmendmentsList } from "../../server/api-types";
import type { NetworkInfo } from "../networks";
import type { LiveControls } from "../use-live-controls";
import { AmendmentsPage } from "./AmendmentsPage";

// ---- The world of the tests ------------------------------------------------------------------------------------------------------------------

const XRPL: NetworkInfo = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" };
const XAHAU: NetworkInfo = { id: "xahau", kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX", native: "XAH", software: "xahaud" };

/** 2026-10-19 16:00:00 UTC: five minutes before the flag ledger of the sample (16:05:28), and a little under twelve days before the majority's activation (Oct 31, 15:54). */
const NOW = Date.UTC(2026, 9, 19, 16, 0, 0);

beforeEach(() => {
  // `Date` alone: the countdowns read the clock, the rest of the test's timers are real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** A copy of an object without some of its keys (D1 leaves a key out; it never sends `null`). */
function without<T extends object, K extends keyof T>(object: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...object };
  for (const key of keys) delete copy[key];
  return copy;
}

const OBSOLETE: AmendmentRow = { id: "D".repeat(64), name: "fixNFTokenNegOffer", status: "obsolete", introduced: "1.9.0" };
const RETIRED: AmendmentRow = { id: "6E739F4F8B07BED29FC9FF440DA3C301CD14A180DF45819F658FEC2F7DE31427", name: "XahauGenesis", status: "enabled", retired: true, introduced: "2023.10.30" };

/** The sample's five amendments, in D1's order, and an obsolete one: every status the table can show. */
const everyStatus = (): AmendmentsList => {
  const sample = amendmentsSample();
  return { ...sample, count: 6, counts: { ...sample.counts, obsolete: 1 }, amendments: [...sample.amendments, OBSOLETE] };
};

type Input = Parameters<typeof amendmentsPage>[0];
const build = (over: Partial<Input> = {}): AmendmentsPageData => amendmentsPage({ network: XRPL, amendments: everyStatus(), ...over });

/** What the route hands the page: the builder's data, the anchor the loader read and the build. */
const loaded = (data: AmendmentsPageData) => ({ ...data, anchor: { lastValidated: 107748183, closeTime: NOW / 1000 }, build: "test-build" });

const controls = (over: Partial<LiveControls> = {}): LiveControls => ({
  paused: false,
  held: false,
  notice: "",
  failures: 0,
  onTogglePause: vi.fn(),
  onHold: vi.fn(),
  ...over,
});

/** The page in a data router, drawn in the browser at once. */
function mount(data: AmendmentsPageData, props: { live?: LiveControls } = {}) {
  const router = createMemoryRouter([{ path: "*", element: <AmendmentsPage data={loaded(data)} live={props.live ?? controls()} />, loader: () => null }], {
    initialEntries: [amendmentsHref(data.network.id, data.status === undefined ? {} : { status: data.status })],
    hydrationData: { loaderData: { "0": null } },
  });
  return { router, ...render(<RouterProvider router={router} />) };
}

const routed = (ui: ReactElement, at = "/xrpl/amendments") => <RouterProvider router={createMemoryRouter([{ path: "*", element: ui }], { initialEntries: [at] })} />;
/** The page as the Worker prints it, into the stored HTML. */
const htmlOf = (data: AmendmentsPageData, live = controls()) => renderToString(routed(<AmendmentsPage data={loaded(data)} live={live} />));

const table = () => screen.getByRole("table", { name: "Amendments" });
const scroll = () => screen.getByRole("region", { name: "Amendments, scrollable table" });
/** The row of the amendment whose link says `name`. */
const rowOf = (name: string | RegExp) => within(table()).getByRole("link", { name }).closest<HTMLElement>('[role="row"]')!;
const cellsOf = (row: HTMLElement) => within(row).getAllByRole("cell");
const text = (element: Element | undefined) => element?.textContent ?? "";
/** The text of stored HTML as a reader gets it: the tags and React's comment markers between two text nodes taken out. */
const textOfHtml = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
/** The words of the visible text of an element: the hidden ones (`.sr`) are in `textContent` too, so a test that wants them says so. */
const words = (element: Element) => text(element).replace(/\s+/g, " ").trim();

// ---- The heading and the live row --------------------------------------------------------------------------------------------------------

describe("AmendmentsPage, the heading", () => {
  it("has the breadcrumb XRPL / Network / Amendments, the first two links, the last the page", () => {
    mount(build());
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["XRPL/", "Network/", "Amendments"]);
    expect(crumbs.getByRole("link", { name: "XRPL" }).getAttribute("href")).toBe("/xrpl");
    expect(crumbs.getByRole("link", { name: "Network" }).getAttribute("href")).toBe("/xrpl/network");
    expect(crumbs.getByText("Amendments").getAttribute("aria-current")).toBe("page");
  });

  it("has the one h1, the builder's intro and the link to the validators", () => {
    mount(build());
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Amendments"]);
    expect(screen.getByText("Changes to the XRPL protocol. Each one activates only after the validators on the default UNL vote it in.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Validators →" }).getAttribute("href")).toBe("/xrpl/validators");
  });

  it("is Xahau's on Xahau: its name, and the link to its own validators", () => {
    mount(build({ network: XAHAU }));
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Xahau" }).getAttribute("href")).toBe("/xahau");
    expect(screen.getByText(/^Changes to the Xahau protocol\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Validators →" }).getAttribute("href")).toBe("/xahau/validators");
  });

  it("has the live row under the heading: the dot and 'Live · updates every minute'", () => {
    const { container } = mount(build());
    const row = container.querySelector(".hero__status-row")!;
    expect(row.querySelector(".hero__status")!.textContent).toBe("Live · updates every minute");
    expect(row.compareDocumentPosition(screen.getByRole("heading", { level: 1 })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("says 'Paused while you look at the table' while held, with the pause button beside it", async () => {
    const { container } = mount(build(), { live: controls({ held: true }) });
    expect(container.querySelector(".hero__held")!.textContent).toBe("Paused while you look at the table");
    expect(container.querySelector(".hero__dot")!.classList.contains("is-paused")).toBe(true);
    expect(await screen.findByRole("button", { name: "Pause live updates" })).toBeTruthy();
  });

  it("has a pause button that calls the page's handler", async () => {
    const live = controls();
    mount(build(), { live });
    fireEvent.click(await screen.findByRole("button", { name: "Pause live updates" }));
    expect(live.onTogglePause).toHaveBeenCalledTimes(1);
  });
});

// ---- Activating soon ---------------------------------------------------------------------------------------------------------------------

describe("AmendmentsPage, activating soon", () => {
  const card = () => screen.getByRole("region", { name: "Activating soon" });

  it("is a card of its own, named, with the amendment as a link, the moment, the countdown and the rule", () => {
    mount(build());
    expect(words(card().querySelector(".amendments__soonline")!)).toBe("XChainBridge activates on or soon after Oct 31, 2026, 15:54 UTC, in 12 days, if it keeps more than 80%");
    expect(within(card()).getAllByRole("link", { name: "XChainBridge" })[0]!.getAttribute("href")).toBe("/xrpl/amendments/XChainBridge");
    expect(text(card().querySelector(".amendments__soonunder")!)).toBe("31 of 35 UNL validators vote yes · majority since Oct 17, 2026, held for 14 days before it activates");
  });

  it("has a link to the amendment's votes and history, named for the amendment it leads to", () => {
    mount(build());
    const link = within(card()).getByRole("link", { name: "Votes and history of XChainBridge →" });
    expect(link.getAttribute("href")).toBe("/xrpl/amendments/XChainBridge");
    expect(link.textContent).toBe("Votes and history of XChainBridge →");
    expect(link.querySelector(".sr")!.textContent).toBe(" of XChainBridge");
  });

  it("has a line for each amendment with a majority, in A's order", () => {
    const second: AmendmentRow = { ...amendmentsSample().amendments[0]!, id: "E".repeat(64), name: "fixSecond", majority: { since: "2026-10-18T08:00:00Z", expected_activation: "2026-11-01T08:00:00Z" } };
    const list = everyStatus();
    mount(build({ amendments: { ...list, amendments: [list.amendments[0]!, second, ...list.amendments.slice(1)], counts: { ...list.counts, majority: 2 } } }));
    expect(card().querySelectorAll("li")).toHaveLength(2);
    expect(Array.from(card().querySelectorAll(".amendments__soonname"), text)).toEqual(["XChainBridge", "fixSecond"]);
    expect(within(card()).getAllByRole("link", { name: /^Votes and history of / }).map((link) => link.getAttribute("href"))).toEqual(["/xrpl/amendments/XChainBridge", "/xrpl/amendments/fixSecond"]);
  });

  it("names an amendment nobody named by its short ID, in mono", () => {
    const list = everyStatus();
    const nameless: AmendmentRow = { ...without(list.amendments[0]!, "name"), id: UNKNOWN_ID };
    mount(build({ amendments: { ...list, amendments: [nameless, ...list.amendments.slice(1)] } }));
    const name = card().querySelector(".amendments__soonname")!;
    expect(name.textContent).toBe("98433D…CA76");
    expect(name.classList.contains("mono")).toBe(true);
    expect(name.getAttribute("href")).toBe(`/xrpl/amendments/${UNKNOWN_ID}`);
  });

  it("is left out when no amendment has a majority", () => {
    const list = everyStatus();
    mount(build({ amendments: { ...list, amendments: list.amendments.filter((row) => row.status !== "majority") } }));
    expect(screen.queryByRole("region", { name: "Activating soon" })).toBeNull();
  });

  it("is there on a view of another status too: it is about A, not about the list shown", () => {
    mount(build({ status: "enabled" }));
    expect(card()).toBeTruthy();
  });

  it("says 'at the next flag ledger' when the moment has passed", () => {
    vi.setSystemTime(Date.UTC(2026, 10, 1, 0, 0, 0));
    mount(build());
    expect(words(card().querySelector(".amendments__soonline")!)).toBe("XChainBridge activates on or soon after Oct 31, 2026, 15:54 UTC, at the next flag ledger, if it keeps more than 80%");
  });
});

// ---- The rules ---------------------------------------------------------------------------------------------------------------------------

describe("AmendmentsPage, the rules", () => {
  const rules = () => screen.getByText(/^Validators vote in the ledger before every flag ledger/);

  it("is the paragraph of the builder, with the countdown to the next flag ledger ticking in the browser", () => {
    mount(build());
    expect(words(rules())).toBe(
      "Validators vote in the ledger before every flag ledger, once every 256 ledgers. An amendment that keeps more than 80% of the UNL for 14 days in a row is enabled at the flag ledger that follows, by an EnableAmendment pseudo-transaction in the ledger after it. Next flag ledger #107,748,352 in ~6 min.",
    );
  });

  it("never links the flag ledger: it does not exist yet", () => {
    mount(build());
    expect(within(rules()).queryAllByRole("link")).toEqual([]);
    expect(screen.queryByRole("link", { name: /107,748,352/ })).toBeNull();
  });

  it("says 'due now' when the flag ledger's time has come", () => {
    vi.setSystemTime(Date.UTC(2026, 9, 19, 16, 10, 0));
    mount(build());
    expect(words(rules())).toMatch(/Next flag ledger #107,748,352 due now\.$/);
  });

  it("is Xahau's: five days", () => {
    const xahau = { ...everyStatus(), rules: { threshold_percent: 80, majority_hold_seconds: 432000, flag_interval: 256 } };
    mount(build({ network: XAHAU, amendments: xahau }));
    expect(words(rules())).toContain("for 5 days in a row");
  });
});

// ---- The chips ---------------------------------------------------------------------------------------------------------------------------

describe("AmendmentsPage, the status chips", () => {
  const group = () => screen.getByRole("group", { name: "Filter by status" });

  it("are links, each with its count, All first, and the view on screen marked aria-current", () => {
    mount(build());
    const links = within(group()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["All 6", "Activating 1", "Voting 1", "Activated 2", "Obsolete 1", "Unknown 1"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/xrpl/amendments",
      "/xrpl/amendments?status=majority",
      "/xrpl/amendments?status=voting",
      "/xrpl/amendments?status=enabled",
      "/xrpl/amendments?status=obsolete",
      "/xrpl/amendments?status=unknown",
    ]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual(["true", null, null, null, null, null]);
  });

  it("marks the chosen status, and no other", () => {
    mount(build({ status: "enabled" }));
    const current = within(group())
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "true");
    expect(current.map((link) => link.textContent)).toEqual(["Activated 2"]);
  });

  it("has no Unknown chip when A counts none", () => {
    const list = everyStatus();
    mount(build({ amendments: { ...list, counts: { ...list.counts, unknown: 0 }, amendments: list.amendments.filter((row) => row.status !== "unknown") } }));
    expect(within(group()).queryByRole("link", { name: /^Unknown/ })).toBeNull();
    expect(within(group()).getAllByRole("link")).toHaveLength(5);
  });

  it("are on the network of the page", () => {
    mount(build({ network: XAHAU }));
    expect(within(group()).getByRole("link", { name: "Voting 1" }).getAttribute("href")).toBe("/xahau/amendments?status=voting");
  });

  it("have the card's title and its source above them", () => {
    mount(build());
    const card = screen.getByRole("heading", { level: 2, name: "All amendments" }).closest("section")!;
    expect(card.querySelector(".chart__source")!.textContent).toBe("/v2/network/amendments");
    expect(card.contains(group())).toBe(true);
  });
});

// ---- The table ---------------------------------------------------------------------------------------------------------------------------

describe("AmendmentsPage, the table", () => {
  it("has the board's columns, and one row for each amendment in A's order, each keyed by its ID", () => {
    const { container } = mount(build());
    const header = within(table()).getAllByRole("row")[0]!;
    expect(within(header).getAllByRole("columnheader").map(text)).toEqual(["#", "Amendment", "Introduced", "Consensus, UNL", "Status", "Enabled on"]);
    const rows = within(table()).getAllByRole("row").slice(1);
    expect(rows.map((row) => text(cellsOf(row)[0]))).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(Array.from(container.querySelectorAll('[role="row"][data-key]'), (row) => row.getAttribute("data-key"))).toEqual(everyStatus().amendments.map((row) => row.id));
  });

  it("is a live table that scrolls inside its card, its rows 56 px high by the page's own class", () => {
    mount(build());
    expect(scroll().classList.contains("amendments__table")).toBe(true);
    expect(scroll().getAttribute("tabindex")).toBe("0");
    expect(table().style.minWidth).toBe("1000px");
  });

  it("names an amendment as a link to its page: the name, else the short ID in mono", () => {
    mount(build());
    const bridge = within(table()).getByRole("link", { name: "XChainBridge" });
    expect(bridge.getAttribute("href")).toBe("/xrpl/amendments/XChainBridge");
    expect(bridge.classList.contains("mono")).toBe(false);
    const nameless = within(table()).getByRole("link", { name: "98433D…CA76" });
    expect(nameless.getAttribute("href")).toBe(`/xrpl/amendments/${UNKNOWN_ID}`);
    expect(nameless.classList.contains("mono")).toBe(true);
  });

  it("shows when it was introduced in mono, or a dash", () => {
    mount(build());
    expect(text(cellsOf(rowOf("DID"))[2])).toBe("1.12.0");
    expect(cellsOf(rowOf("DID"))[2]!.querySelector(".mono")).toBeTruthy();
    expect(text(cellsOf(rowOf("98433D…CA76"))[2])).toBe("—");
  });

  it("tells a screen reader which cell has no vote running, with the dash for the eye", () => {
    mount(build());
    const cell = cellsOf(rowOf("AMM"))[3]!;
    expect(text(cell)).toBe("—no vote running");
    expect(cell.querySelector(".sr")!.textContent).toBe("no vote running");
    expect(cell.querySelector(".meter")).toBeNull();
  });
});

describe("AmendmentsPage, the XLS tag", () => {
  it("is a link to the document that opens a new tab, with the external icon and its words for a screen reader", () => {
    mount(build());
    const cell = cellsOf(rowOf("XChainBridge"))[1]!;
    const link = within(cell).getByRole("link", { name: "XLS-38 (opens in a new tab)" });
    expect(link.getAttribute("href")).toBe("https://github.com/XRPLF/XRPL-Standards/discussions/92");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.querySelector("svg.extlink__icon")).toBeTruthy();
    expect(link.querySelector(".sr")!.textContent).toBe(" (opens in a new tab)");
    expect(link.closest(".tag")).toBeTruthy();
  });

  it("is text, and no link, when the document is not one the page may link to", () => {
    const list = everyStatus();
    const odd = list.amendments.map((row) => (row.name === "AMM" ? { ...row, xls_url: "https://example.com/XRPLF/XRPL-Standards/x" } : row));
    mount(build({ amendments: { ...list, amendments: odd } }));
    const cell = cellsOf(rowOf("AMM"))[1]!;
    expect(within(cell).queryByRole("link", { name: /XLS-30/ })).toBeNull();
    const tag = cell.querySelector(".tag")!;
    expect(tag.textContent).toBe("XLS-30");
    expect(tag.querySelector("a")).toBeNull();
  });

  it("is text for an amendment whose metadata has no document URL", () => {
    const list = everyStatus();
    mount(build({ amendments: { ...list, amendments: list.amendments.map((row) => (row.name === "AMM" ? without(row, "xls_url") : row)) } }));
    expect(cellsOf(rowOf("AMM"))[1]!.querySelector(".tag a")).toBeNull();
    expect(cellsOf(rowOf("AMM"))[1]!.querySelector(".tag")!.textContent).toBe("XLS-30");
  });

  it("is not there for an amendment with no XLS", () => {
    mount(build());
    expect(cellsOf(rowOf("DID"))[1]!.querySelector(".tag")).toBeNull();
  });
});

describe("AmendmentsPage, the consensus bar", () => {
  it("is a small decorative meter with its threshold tick, and the share in words under it", () => {
    mount(build());
    const cell = cellsOf(rowOf("XChainBridge"))[3]!;
    const meter = cell.querySelector(".meter")!;
    expect(meter.classList.contains("meter--small")).toBe(true);
    expect(meter.classList.contains("meter--threshold")).toBe(true);
    // Decorative: the words under it say the numbers once, so the bar is hidden from a screen reader and has no name of its own.
    expect(meter.getAttribute("aria-hidden")).toBe("true");
    expect(meter.getAttribute("role")).toBeNull();
    expect(meter.getAttribute("aria-label")).toBeNull();
    expect((meter.querySelector(".meter__fill") as HTMLElement).style.width).toBe("88.57%");
    expect((meter.querySelector(".meter__tick") as HTMLElement).style.left).toBe("80%");
    expect(text(cell.querySelector(".amendments__share")!)).toBe("88.6% · 31 / 35 UNL");
  });

  it("is there for voting and unknown too, and only for the three", () => {
    mount(build());
    expect(text(cellsOf(rowOf("DID"))[3]!.querySelector(".amendments__share")!)).toBe("11.4% · 4 / 35 UNL");
    expect(text(cellsOf(rowOf("98433D…CA76"))[3]!.querySelector(".amendments__share")!)).toBe("0.0% · 0 / 35 UNL");
    const bars = within(table())
      .getAllByRole("row")
      .slice(1)
      .map((row) => cellsOf(row)[3]!.querySelector(".meter") !== null);
    expect(bars).toEqual([true, true, true, false, false, false]);
  });
});

describe("AmendmentsPage, the status", () => {
  const pill = (name: string) => cellsOf(rowOf(name))[4]!.querySelector(".pill")!;

  it("is an icon and a word for every status, never a colour alone", () => {
    mount(build());
    const expected: Array<[string, string, string]> = [
      ["XChainBridge", "Activating, in 12 days", "pill--info"],
      ["DID", "Voting", "pill--neutral"],
      ["98433D…CA76", "Unknown", "pill--off"],
      ["AMM", "Activated", "pill--ok"],
      ["fix1201", "Activated", "pill--ok"],
      ["fixNFTokenNegOffer", "Obsolete", "pill--off"],
    ];
    for (const [name, word, tone] of expected) {
      const element = pill(name);
      expect(element.textContent, name).toBe(word);
      expect(element.classList.contains(tone), name).toBe(true);
      expect(element.querySelector("svg"), `${name} has an icon`).toBeTruthy();
    }
  });

  it("is, on the server and at hydration, 'Activating, expected Oct 31': a stored page holds no countdown", () => {
    const stored = textOfHtml(htmlOf(build()));
    expect(stored).toContain("Activating, expected Oct 31");
    expect(stored).not.toMatch(/Activating, in \d+/);
  });

  it("has the tag 'retired' beside 'Activated' for a retired amendment, once", () => {
    const list = everyStatus();
    mount(build({ network: XAHAU, amendments: { ...list, amendments: [...list.amendments, RETIRED] } }));
    const cell = cellsOf(rowOf("XahauGenesis"))[4]!;
    expect(cell.querySelector(".pill")!.textContent).toBe("Activated");
    expect(Array.from(cell.querySelectorAll(".tag"), text)).toEqual(["retired"]);
    expect(Array.from(table().querySelectorAll(".tag"), text).filter((tag) => tag === "retired")).toHaveLength(1);
  });
});

describe("AmendmentsPage, enabled on", () => {
  const enabledCell = (name: string) => cellsOf(rowOf(name))[5]!;

  it("is the date over a link to the ledger it was enabled in", () => {
    mount(build());
    const cell = enabledCell("AMM");
    expect(text(cell.querySelector(".amendments__date")!)).toBe("Oct 19, 2026");
    const link = within(cell).getByRole("link", { name: "#107,747,841" });
    expect(link.getAttribute("href")).toBe("/xrpl/ledger/107747841");
    expect(link.classList.contains("mono")).toBe(true);
  });

  it("is the date alone, with no link, when it comes from the metadata file", () => {
    mount(build());
    const cell = enabledCell("fix1201");
    expect(text(cell)).toBe("Feb 3, 2025");
    expect(within(cell).queryByRole("link")).toBeNull();
  });

  it("is 'Always on' for a retired amendment, with the reason for a screen reader", () => {
    const list = everyStatus();
    mount(build({ network: XAHAU, amendments: { ...list, amendments: [...list.amendments, RETIRED] } }));
    const cell = enabledCell("XahauGenesis");
    expect(text(cell)).toBe("Always onretired: always on, not listed in the ledger");
    expect(cell.querySelector(".sr")!.textContent).toBe("retired: always on, not listed in the ledger");
    expect(within(cell).queryByRole("link")).toBeNull();
  });

  it("is the date over its ledger, not 'Always on', for a retired amendment the ledger lists", () => {
    const list = everyStatus();
    const listed: AmendmentRow = { ...RETIRED, enabled: { ledger_index: 5, date: "2023-10-30T12:00:00Z", tx_hash: "A".repeat(64), source: "ledger" } };
    mount(build({ network: XAHAU, amendments: { ...list, amendments: [...list.amendments, listed] } }));
    const cell = enabledCell("XahauGenesis");
    expect(text(cell)).toBe("Oct 30, 2023#5");
    expect(within(cell).getByRole("link", { name: "#5" }).getAttribute("href")).toBe("/xahau/ledger/5");
    expect(cell.querySelector(".sr")).toBeNull();
    // The retired tag stays beside its status.
    expect(Array.from(cellsOf(rowOf("XahauGenesis"))[4]!.querySelectorAll(".tag"), text)).toEqual(["retired"]);
  });

  it("is a dash for an amendment that is not enabled, with the words for a screen reader", () => {
    mount(build());
    for (const name of ["XChainBridge", "DID", "fixNFTokenNegOffer"]) {
      const cell = enabledCell(name);
      expect(text(cell), name).toBe("—not enabled");
      expect(cell.querySelector(".sr")!.textContent, name).toBe("not enabled");
    }
  });
});

describe("AmendmentsPage, the footer and an empty view", () => {
  it("counts the amendments and says what the tick is", () => {
    const { container } = mount(build());
    expect(text(container.querySelector(".card__foot")!)).toBe("6 amendments · the tick on each bar marks 80%");
  });

  it("says so when the chosen status has no amendment", () => {
    const list = everyStatus();
    const { container } = mount(build({ status: "obsolete", amendments: { ...list, amendments: list.amendments.filter((row) => row.status !== "obsolete"), counts: { ...list.counts, obsolete: 0 } } }));
    expect(within(table()).getAllByRole("row")).toHaveLength(1);
    expect(text(container.querySelector(".table__empty")!)).toBe("No amendments with this status.");
    expect(text(container.querySelector(".card__foot")!)).toBe("0 amendments · the tick on each bar marks 80%");
  });
});

// ---- Holding the page --------------------------------------------------------------------------------------------------------------------

describe("AmendmentsPage, the table's hold", () => {
  const holds = (live: LiveControls) => (live.onHold as ReturnType<typeof vi.fn>).mock.calls.map(([held]) => held);

  it("holds while a mouse is over the table, and lets go when it leaves", () => {
    const live = controls();
    mount(build(), { live });
    fireEvent.pointerEnter(scroll(), { pointerType: "mouse" });
    fireEvent.pointerLeave(scroll(), { pointerType: "mouse" });
    expect(holds(live)).toEqual([true, false]);
  });

  it("is not for a finger", () => {
    const live = controls();
    mount(build(), { live });
    fireEvent.pointerEnter(scroll(), { pointerType: "touch" });
    expect(holds(live)).toEqual([]);
  });

  it("holds while keyboard focus is on a link in the table, and lets go when it leaves it", () => {
    const live = controls();
    mount(build(), { live });
    act(() => within(scroll()).getAllByRole("link")[0]!.focus());
    expect(holds(live).at(-1)).toBe(true);
    act(() => (document.activeElement as HTMLElement).blur());
    expect(holds(live).at(-1)).toBe(false);
  });

  it("does not hold for the chips, the activating card or the rules", () => {
    const live = controls();
    mount(build(), { live });
    fireEvent.pointerEnter(screen.getByRole("group", { name: "Filter by status" }), { pointerType: "mouse" });
    fireEvent.pointerEnter(screen.getByRole("region", { name: "Activating soon" }), { pointerType: "mouse" });
    act(() => within(screen.getByRole("region", { name: "Activating soon" })).getAllByRole("link")[0]!.focus());
    expect(holds(live)).toEqual([]);
  });

  it("lets go when the page goes away, whatever was held", () => {
    const live = controls();
    const { unmount } = mount(build(), { live });
    fireEvent.pointerEnter(scroll(), { pointerType: "mouse" });
    expect(holds(live).at(-1)).toBe(true);
    unmount();
    expect(holds(live).at(-1)).toBe(false);
  });
});

// ---- The page follows the chain ----------------------------------------------------------------------------------------------------------

describe("AmendmentsPage, when its data changes", () => {
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
  });

  let update!: (next: AmendmentsPageData) => void;
  function Host({ first }: { first: AmendmentsPageData }) {
    const [current, setCurrent] = useState(first);
    update = (next) => act(() => setCurrent(next));
    return <AmendmentsPage data={loaded(current)} live={controls()} />;
  }
  const mountHost = (first = build()) => render(routed(<Host first={first} />));

  it("animates nothing on the first render, on the server or in the browser", () => {
    const { container } = mountHost();
    expect(container.querySelector(".is-entering, .is-changed")).toBeNull();
    expect(htmlOf(build())).not.toMatch(/is-entering|is-changed/);
  });

  it("brings a new amendment in as an entering row and leaves the others", () => {
    const { container } = mountHost();
    const list = everyStatus();
    const added: AmendmentRow = { id: "F".repeat(64), name: "fixNew", status: "voting", introduced: "3.5.0", votes: { ledger_index: 107748200, yes: 1, trusted: 35, needed: 29, pct: 2.86 } };
    update(build({ amendments: { ...list, amendments: [list.amendments[0]!, added, ...list.amendments.slice(1)], counts: { ...list.counts, voting: 2 } } }));
    expect(Array.from(container.querySelectorAll(".is-entering"), (row) => row.getAttribute("data-key"))).toEqual(["F".repeat(64)]);
  });

  it("ticks in the share of the amendment whose votes changed, and of no other", () => {
    const { container } = mountHost();
    const list = everyStatus();
    update(build({ amendments: { ...list, amendments: list.amendments.map((row) => (row.name === "DID" ? { ...row, votes: { ...row.votes!, yes: 5, pct: 14.29 } } : row)) } }));
    expect(Array.from(container.querySelectorAll(".amendments__share .is-changed"), text)).toEqual(["14.3% · 5 / 35 UNL"]);
  });

  it("moves the chips' current mark with the view, with the page keyed by the route", () => {
    mountHost();
    update(build({ status: "voting" }));
    const current = within(screen.getByRole("group", { name: "Filter by status" }))
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "true");
    expect(current.map(text)).toEqual(["Voting 1"]);
  });
});

// ---- The stored HTML ---------------------------------------------------------------------------------------------------------------------

describe("AmendmentsPage, as the Worker prints it and the browser takes it over", () => {
  it("hydrates without a mismatch, in the stored HTML's words", async () => {
    const { html, container, errors } = await serverThenHydrated(routed(<AmendmentsPage data={loaded(build())} live={controls()} />));
    expect(errors).toEqual([]);
    expect(textOfHtml(html)).toContain("Next flag ledger #107,748,352 expected 16:05 UTC.");
    expect(container.querySelectorAll('[aria-label="Amendments"] [role="row"]')).toHaveLength(7);
  });

  it("holds the whole page in the HTML, with the server's words for the countdowns and no age or countdown", () => {
    const html = htmlOf(build());
    for (const part of ["Activating soon", "All amendments", "XChainBridge", "98433D…CA76", "fix1201", "expected 16:05 UTC"]) expect(html).toContain(part);
    const stored = textOfHtml(html);
    expect(stored).toContain("Activating, expected Oct 31");
    expect(stored).not.toMatch(/\bago\b/);
    expect(stored).not.toMatch(/in ~\d+ min/);
    expect(stored).not.toMatch(/in \d+ days/);
    expect(stored).not.toMatch(/at the next flag ledger|due now/);
  });

  it("holds the activating line without a comma left hanging: the countdown's lead goes with its words", () => {
    const html = htmlOf(build());
    const line = /<span class="amendments__soonline">([\s\S]*?)<\/span><span class="amendments__soonunder">/.exec(html)![1]!;
    expect(line.replace(/<[^>]*>/g, "")).toBe("XChainBridge activates on or soon after Oct 31, 2026, 15:54 UTC, if it keeps more than 80%");
  });

  it("hydrates a page with a retired amendment, an empty view and the Xahau words too", async () => {
    const list = everyStatus();
    for (const data of [build({ network: XAHAU, amendments: { ...list, amendments: [...list.amendments, RETIRED] } }), build({ status: "obsolete", amendments: { ...list, amendments: [] } })]) {
      const { errors } = await serverThenHydrated(routed(<AmendmentsPage data={loaded(data)} live={controls()} />));
      expect(errors).toEqual([]);
    }
  });
});
