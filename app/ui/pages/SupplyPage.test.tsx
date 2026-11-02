import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import BigNumber from "bignumber.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import xahauFees from "../../../test/fixtures/http/xahau/data-api/network/fees@end=2026-10-17&interval=day&limit=1000&start=2026-07-20.json";
import xahauMinted from "../../../test/fixtures/http/xahau/data-api/network/supply/minted@end=2026-10-17&interval=day&limit=1000&start=2026-07-20.json";
import xahauSupply from "../../../test/fixtures/http/xahau/data-api/network/supply.json";
import xrplFees from "../../../test/fixtures/http/xrpl/data-api/network/fees@end=2026-10-17&interval=day&limit=1000&start=2026-07-20.json";
import xrplSupply from "../../../test/fixtures/http/xrpl/data-api/network/supply.json";
import { supplySample } from "../../../test/support/d7-samples";
import { serverThenHydrated } from "../../../test/support/hydrate";
import { LAYOUT_XAHAU, LAYOUT_XRPL, LAYOUT_XRPL_TESTNET, mountPage, routedPage } from "../../../test/support/under-network";
import type { FeeBucketRow, LastValidated, MintedPage, NetworkSupply, Page } from "../../server/api-types";
import { supplyPage, type SupplyPageData } from "../../server/supply-view";
import { NO_FEATURES } from "../features";
import { SupplyPage } from "./SupplyPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---- The world of the tests: T is 2026-10-17, the newest ledger closed at 17:01:12 UTC, and the snapshots are the fixtures of Task 2 (XRPL's ledger 107,720,688 closed at 16:11:02, Xahau's 26,596,843 at 17:47:11) ----

const FIXTURES = {
  xrpl: { supply: xrplSupply as unknown as NetworkSupply, fees: xrplFees as unknown as Page<"rows", FeeBucketRow> },
  xahau: { supply: xahauSupply as unknown as NetworkSupply, fees: xahauFees as unknown as Page<"rows", FeeBucketRow> },
};
const MINTED = xahauMinted as unknown as MintedPage;

const LAST: LastValidated = {
  result: "success",
  ledger_index: "107721455",
  ledger_hash: "2F7C1D5A9B3E4F60A8D2C71B5E9F3A4D6C8B0E1F2A3B4C5D6E7F8A9B0C1D2E3F",
  parent_hash: "9A8B7C6D5E4F30211203F4E5D6C7B8A998877665544332211FFEEDDCCBBAA990",
  close_time: "2026-10-17T17:01:12Z",
};
const NETS = {
  xrpl: { id: "xrpl", name: "XRPL", native: "XRP", hasAmm: true },
  xahau: { id: "xahau", name: "Xahau", native: "XAH", hasAmm: false },
} as const;

const fulfilled = <V,>(value: V): PromiseFulfilledResult<V> => ({ status: "fulfilled", value });
const rejected = (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason });

interface Over {
  supply?: NetworkSupply;
  last?: LastValidated;
  fees?: PromiseSettledResult<Page<"rows", FeeBucketRow>>;
  minted?: PromiseSettledResult<MintedPage>;
}

/** The page data of a network as the view builder writes it from the fixtures, or from what `over` replaces. */
function build(which: "xrpl" | "xahau" = "xrpl", over: Over = {}): SupplyPageData {
  const net = NETS[which];
  const cards = {
    anchor: fulfilled(over.last ?? LAST),
    fees: over.fees ?? fulfilled(FIXTURES[which].fees),
    ...(which === "xahau" ? { minted: over.minted ?? fulfilled(MINTED) } : {}),
  };
  return supplyPage(net, over.supply ?? FIXTURES[which].supply, cards).page;
}

const LAYOUTS = { xrpl: LAYOUT_XRPL, xahau: LAYOUT_XAHAU };
const pathOf = (data: SupplyPageData) => `/${data.network.id}/supply`;

/** The page in a data router at its own URL, drawn in the browser. `loader` counts the revalidations a Retry asks for. */
const mount = (data: SupplyPageData, network = LAYOUTS[data.network.id as "xrpl" | "xahau"]) =>
  mountPage(<SupplyPage data={data} />, "routes/net.supply", { at: pathOf(data), network, features: NO_FEATURES });

const routed = (data: SupplyPageData, network = LAYOUTS[data.network.id as "xrpl" | "xahau"]) => routedPage(<SupplyPage data={data} />, { at: pathOf(data), network, features: NO_FEATURES });

const texts = (nodes: Iterable<Element>) => [...nodes].map((node) => node.textContent);
const tilesOf = (container: HTMLElement) => [...container.querySelectorAll(".stat")];
const tileNamed = (container: HTMLElement, label: string) => tilesOf(container).find((tile) => tile.querySelector(".stat__label")!.textContent === label)!;

// ---- The head ---------------------------------------------------------------------------------------------------------------------------------------------

describe("SupplyPage: the heading and the snapshot line", () => {
  it("has the breadcrumb, the h1 and the intro, on the network's name", () => {
    mount(build());
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "XRPL" }).getAttribute("href")).toBe("/xrpl");
    expect(crumbs.getByRole("link", { name: "Network" }).getAttribute("href")).toBe("/xrpl/network");
    expect(crumbs.getByText("Supply").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Supply");
    expect(screen.getByText("How much XRP exists, how much is burned and escrowed, and how much circulates.").tagName).toBe("P");
    cleanup();
    mount(build("xahau"));
    expect(screen.getByRole("link", { name: "Xahau" }).getAttribute("href")).toBe("/xahau");
    expect(screen.getByText("How much XAH exists, how much is minted, burned and escrowed, and how much circulates.")).toBeTruthy();
  });

  it("says the sandbox's names in the breadcrumb and the intro's currency stays", () => {
    const testnet = supplyPage({ ...NETS.xrpl, name: "XRPL Testnet" }, supplySample("xrpl"), {
      anchor: fulfilled(LAST),
      fees: fulfilled(FIXTURES.xrpl.fees),
    }).page;
    mount(testnet, LAYOUT_XRPL_TESTNET);
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "XRPL Testnet" }).getAttribute("href")).toBe("/xrpl");
    expect(screen.getByText("Where the 100 billion XRP are")).toBeTruthy();
  });

  it("draws the snapshot line with its ledger link, the time of the snapshot and the source", () => {
    const { container } = mount(build());
    const line = container.querySelector(".supply__snapshot")!;
    const [sentence, source] = [...line.children];
    // The time is the snapshot's own (16:11), not the newest ledger's (17:01).
    expect(sentence!.textContent).toBe("Snapshot at ledger #107,720,688 · Oct 17, 2026, 16:11 UTC · updated hourly");
    expect(source!.textContent).toBe("/v2/network/supply");
    const link = within(sentence as HTMLElement).getByRole("link", { name: "#107,720,688" });
    expect(link.getAttribute("href")).toBe("/xrpl/ledger/107720688");
    cleanup();
    const xahau = mount(build("xahau"));
    expect(xahau.container.querySelector(".supply__snapshot span")!.textContent).toBe("Snapshot at ledger #26,596,843 · Oct 17, 2026, 17:47 UTC · updated hourly");
    expect(screen.getByRole("link", { name: "#26,596,843" }).getAttribute("href")).toBe("/xahau/ledger/26596843");
  });

  it("shows the stale warning only when the snapshot is stale", () => {
    // The newest ledger closed 5 hours after the snapshot's.
    mount(build("xrpl", { last: { ...LAST, close_time: "2026-10-17T21:11:02Z" } }));
    const warning = screen.getByText("This snapshot is 5 hours older than the newest ledger: the data API has not computed a newer one.");
    expect(warning.closest(".notice")!.className).toContain("notice--warning");
    cleanup();
    // Exactly three hours is not stale, and nor is a snapshot without an anchor to compare with.
    mount(build("xrpl", { last: { ...LAST, close_time: "2026-10-17T19:11:02Z" } }));
    expect(screen.queryByText(/older than the newest ledger/)).toBeNull();
    cleanup();
    mount(build("xrpl", { last: { ...LAST, close_time: "2026-10-17T17:01:12Z" } }));
    expect(screen.queryByText(/older than the newest ledger/)).toBeNull();
    expect(document.querySelector(".notice--warning")).toBeNull();
  });
});

// ---- The bar ----------------------------------------------------------------------------------------------------------------------------------------------

describe("SupplyPage: the bar", () => {
  it("draws XRPL's compact bar in its card, with the legend, the text, the burned line and the bracket", () => {
    const { container } = mount(build());
    const card = screen.getByRole("region", { name: "Where the 100 billion XRP are" });
    expect(card.querySelector(".chart__source")!.textContent).toBe("/v2/network/supply");
    expect(texts(within(within(card).getByRole("list", { name: "Legend" })).getAllByRole("listitem"))).toEqual(["Burned", "Escrowed", "Circulating supply"]);
    expect(within(card).getByText("100,000,000,000 XRP were created in the first ledger and no more can be made. Every transaction burns a little as its fee, so the total supply only shrinks.").tagName).toBe("P");

    // The line over the bar says the sliver, with its figure bold.
    const burned = card.querySelector(".supply__burned")!;
    expect(burned.textContent).toBe("Burned 14.69M XRP · 0.015% of the 100 billion, a sliver at this scale");
    expect(texts(burned.querySelectorAll("b"))).toEqual(["Burned 14.69M XRP"]);

    // The bar: compact, three segments in the slots of the board, the first as wide as its share and the labels (two lines) only under the segments of 18% or more.
    expect(card.querySelector(".share.share--compact")).not.toBeNull();
    const segments = [...card.querySelectorAll(".share__seg")];
    expect(segments.map((segment) => segment.getAttribute("data-slot"))).toEqual(["2", "3", "1"]);
    expect(segments[0]!.getAttribute("style")).toContain("width: 0.015%");
    const labels = [...card.querySelectorAll(".share__label")];
    expect(labels.map((label) => [label.querySelector("b")!.textContent, label.querySelector(".share__caption")!.textContent])).toEqual([
      ["Escrowed", "35.21B XRP · 35.2%"],
      ["Circulating supply", "64.77B XRP · 64.8%"],
    ]);
    expect(container.querySelectorAll(".share__axis")).toHaveLength(0);

    // The bracket starts where circulating does, 35.228% along, and runs to the end.
    const part = card.querySelector<HTMLElement>(".supply__part")!;
    expect(part.style.marginLeft).toBe("35.228%");
    expect(part.querySelector(".supply__bracket")!.getAttribute("aria-hidden")).toBe("true");
    expect(part.querySelector(".supply__part-text")!.textContent).toBe("Part of circulating: 46.22M XRP in AMM pools (0.071% of circulating) · 9.81M XRP held as account reserves (0.015% of circulating)");
    expect(texts(part.querySelectorAll("b"))).toEqual(["46.22M XRP", "9.81M XRP"]);
    // Escrowed is complete: no note.
    expect(card.querySelector(".coverage-note")).toBeNull();
  });

  it("draws Xahau's bar: no burned line, the escrowed segment without a label, and no AMM", () => {
    mount(build("xahau"));
    const card = screen.getByRole("region", { name: "Where the XAH are" });
    expect(texts(within(within(card).getByRole("list", { name: "Legend" })).getAllByRole("listitem"))).toEqual(["Escrowed", "Circulating supply"]);
    expect(within(card).getByText(/^Xahau has no 100 billion cap: its supply grows by minting, through rewards, Import and GenesisMint, and shrinks a little as fees are burned\./).tagName).toBe("P");
    expect(card.querySelector(".supply__burned")).toBeNull();
    expect([...card.querySelectorAll(".share__seg")].map((segment) => segment.getAttribute("data-slot"))).toEqual(["3", "1"]);
    // Escrowed is 3%, under the 18% a label needs: the legend, the tooltip and the tile name it.
    expect(texts(card.querySelectorAll(".share__label b"))).toEqual(["Circulating supply"]);
    expect(card.querySelector(".share__caption")!.textContent).toBe("595.00M XAH · 97.0%");
    expect(card.querySelector(".supply__part-text")!.textContent).toBe("Part of circulating: 268.97K XAH held as account reserves (0.045% of circulating) · no AMM on Xahau");
    expect(card.querySelector<HTMLElement>(".supply__part")!.style.marginLeft).toBe("3.001%");
  });

  it("puts the escrowed coverage note under the bar when the history of escrows is incomplete", () => {
    const supply = supplySample("xrpl", { escrowed: { amount: "35212847105.402318", escrows: 12879, coverage: { from_ledger_index: 99413505, complete: false } } });
    mount(build("xrpl", { supply }));
    const card = screen.getByRole("region", { name: "Where the 100 billion XRP are" });
    const note = card.querySelector(".coverage-note")!;
    expect(note.getAttribute("role")).toBe("note");
    expect(note.textContent).toBe("Covers ledger #99,413,505 onwards: earlier escrows are not in the index yet.");
    expect(within(note as HTMLElement).getByRole("link", { name: "#99,413,505" }).getAttribute("href")).toBe("/xrpl/ledger/99413505");
    // The note is the last thing in the card.
    expect(card.lastElementChild).toBe(note);
  });

  it("says every segment in words, to a screen reader and to the keyboard, with the names the labels have (the colours alone name nothing)", () => {
    const { container } = mount(build());
    // The bar is one image whose label says each segment with its exact amount and share: the burned sliver, which has no label of its own, included.
    const image = container.querySelector<HTMLElement>('.share__rows[role="img"]')!;
    expect(image.getAttribute("aria-label")).toBe(
      "Where the 100 billion XRP are: Burned 14,687,625.283682 XRP (0.015% of the 100 billion XRP); Escrowed 35,212,847,105.402318 XRP (35.21% of the 100 billion XRP); Circulating supply 64,772,465,269.314 XRP (64.77% of the 100 billion XRP)",
    );
    // After hydration the slider names the segment it is on, and arrow keys move it.
    const slider = screen.getByRole("slider", { name: "Where the 100 billion XRP are, segment by segment" });
    expect(slider.getAttribute("aria-valuetext")).toBe("Burned, 14,687,625.283682 XRP (0.015% of the 100 billion XRP)");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider.getAttribute("aria-valuetext")).toBe("Escrowed, 35,212,847,105.402318 XRP (35.21% of the 100 billion XRP)");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider.getAttribute("aria-valuetext")).toBe("Circulating supply, 64,772,465,269.314 XRP (64.77% of the 100 billion XRP)");
    // Each segment's exact figure is also a tile of its own, under the same name (the bar has no table: decision 7).
    const tileValue = (label: string) => tileNamed(container, label).querySelector(".stat__value")!.textContent!.replace(/ XRP$/, "");
    for (const [name, amount] of [["Burned", "14687625.283682"], ["Escrowed", "35212847105.402318"], ["Circulating supply", "64772465269.314"]] as const) {
      expect(new BigNumber(tileValue(name).replaceAll(",", "")).isEqualTo(amount), name).toBe(true);
      expect(image.getAttribute("aria-label"), name).toContain(`${name} ${new BigNumber(amount).toFormat()} XRP`);
    }
    // The tooltip says the same, with the name next to its swatch.
    const tip = container.querySelector(".share__tip")!;
    expect(tip.textContent).toBe("Circulating supply64,772,465,269.314 XRP 64.77% of the 100 billion XRP");
  });
});

// ---- The tiles --------------------------------------------------------------------------------------------------------------------------------------------

describe("SupplyPage: the tiles", () => {
  it("draws XRPL's six in the board's order, each with an aside, the exact figure with a muted fraction, and the currency", () => {
    const { container } = mount(build());
    const grid = screen.getByRole("region", { name: "Supply figures" });
    expect(grid.className).toContain("stat-grid--wide");
    const tiles = tilesOf(container);
    expect(tiles.map((tile) => tile.querySelector(".stat__label")!.textContent)).toEqual(["Total supply", "Burned", "Escrowed", "Circulating supply", "In AMM pools", "Account reserves"]);
    expect(tiles.map((tile) => tile.querySelector(".stat__aside")!.textContent)).toEqual(["≈ 99.99B", "≈ 14.69M", "≈ 35.21B", "≈ 64.77B", "≈ 46.22M", "≈ 9.81M"]);
    expect(tiles.map((tile) => tile.querySelector(".stat__value")!.textContent)).toEqual([
      "99,985,312,374.716318 XRP",
      "14,687,625.283682 XRP",
      "35,212,847,105.402318 XRP",
      "64,772,465,269.314000 XRP",
      "46,218,377.402915 XRP",
      "9,810,004.000000 XRP",
    ]);
    // The fraction, with its point, is its own element; the whole and the currency are not in it.
    const total = tileNamed(container, "Total supply");
    expect(total.querySelector(".supply__fraction")!.textContent).toBe(".716318");
    expect(total.querySelector(".supply__currency")!.textContent).toBe("XRP");
    expect(tileNamed(container, "Total supply").classList.contains("stat--figure")).toBe(true);
  });

  it("gives each tile its formula, its definition and its sub line, from the answer", () => {
    const { container } = mount(build());
    const notes = (label: string) => texts(tileNamed(container, label).querySelectorAll(".supply__notes > :not(.coverage-note)"));
    expect(notes("Total supply")).toEqual(["= 100,000,000,000 − burned", "All the XRP that exists: 100 billion XRP less what has been burned."]);
    expect(notes("Burned")).toEqual(["XRP destroyed as transaction fees, since the first ledger."]);
    expect(notes("Escrowed")).toEqual(["XRP held in escrows.", "in 12,879 escrows"]);
    expect(notes("Circulating supply")).toEqual(["= total supply − escrowed", "The total supply less what is escrowed."]);
    expect(notes("In AMM pools")).toEqual(["XRP held by 14,594 AMM pools. Part of the circulating supply."]);
    expect(notes("Account reserves")).toEqual([
      "= 6,410,280 × 1 + 16,998,620 × 0.2",
      "XRP accounts must keep: 1 XRP each, and 0.2 XRP for every object they own. Part of the circulating supply.",
    ]);
    // The formula is the kit's mono line.
    expect(tileNamed(container, "Circulating supply").querySelector(".stat__formula")!.textContent).toBe("= total supply − escrowed");
  });

  it("puts a coverage note in the tile of a part whose history is incomplete, and only there", () => {
    const { container } = mount(build());
    // The fixture's reserves are the only incomplete part.
    expect(container.querySelectorAll(".stat .coverage-note")).toHaveLength(1);
    const note = tileNamed(container, "Account reserves").querySelector(".coverage-note")!;
    expect(note.textContent).toBe("Covers ledger #28,685,313 onwards: earlier account changes are not in the index yet.");
    expect(within(note as HTMLElement).getByRole("link", { name: "#28,685,313" }).getAttribute("href")).toBe("/xrpl/ledger/28685313");
  });

  it("draws a figure that is not known as a dash with the reason, and no aside", () => {
    const supply = supplySample("xrpl");
    delete supply.reserves;
    const { container } = mount(build("xrpl", { supply }));
    const tile = tileNamed(container, "Account reserves");
    expect(tile.querySelector(".stat__value")!.textContent).toBe("—");
    expect(tile.querySelector(".stat__aside")).toBeNull();
    expect(tile.querySelector(".stat__head")).toBeNull();
    expect(texts(tile.querySelectorAll(".supply__notes > *"))).toEqual(["XRP that accounts must keep as reserves. Part of the circulating supply.", "Not known at this ledger."]);
  });

  it("draws Xahau's six: the minted tile after the total, no AMM, and the notes of its parts", () => {
    const { container } = mount(build("xahau"));
    expect(texts(container.querySelectorAll(".stat__label"))).toEqual(["Total supply", "Minted, last 90 days", "Burned", "Escrowed", "Circulating supply", "Account reserves"]);
    const minted = tileNamed(container, "Minted, last 90 days");
    expect(minted.querySelector(".stat__value")!.textContent).toBe("2,981,418.527222 XAH");
    expect(minted.querySelector(".stat__aside")!.textContent).toBe("≈ 2.98M");
    expect(texts(minted.querySelectorAll(".supply__notes > *"))).toEqual(["New XAH from rewards, Import and GenesisMint."]);
    // Xahau has no 100 billion cap, so no formula for its total.
    expect(texts(tileNamed(container, "Total supply").querySelectorAll(".supply__notes > *"))).toEqual(["All the XAH that exists. No 100 billion cap: Xahau's supply grows by minting."]);
    expect(container.querySelectorAll(".stat .coverage-note")).toHaveLength(0);
  });

  it("draws the minted tile as a dash when the minted days could not be loaded, and says why", () => {
    const { container } = mount(build("xahau", { minted: rejected(new Error("boom")) }));
    const minted = tileNamed(container, "Minted, last 90 days");
    expect(minted.querySelector(".stat__value")!.textContent).toBe("—");
    expect(texts(minted.querySelectorAll(".supply__notes > *"))).toEqual(["New XAH from rewards, Import and GenesisMint.", "Couldn't load the minted days."]);
  });

  it("draws a figure of 40 digits whole: nothing is cut or rounded, and the figure and its parts are the elements the stylesheet breaks anywhere", () => {
    const total = `${"9".repeat(30)}.123456`;
    const supply = supplySample("xrpl", { total });
    const { container } = mount(build("xrpl", { supply }));
    const tile = tileNamed(container, "Total supply");
    expect(tile.querySelector(".stat__value")!.textContent).toBe("999,999,999,999,999,999,999,999,999,999.123456 XRP");
    expect(tile.querySelector(".supply__figure")).not.toBeNull();
    expect(tile.querySelector(".supply__fraction")!.textContent).toBe(".123456");
  });
});

// ---- The cards --------------------------------------------------------------------------------------------------------------------------------------------

describe("SupplyPage: the burned card", () => {
  it("is a card with the title, the source, the chart, its table and the summary with the figure in bold", () => {
    const { container } = mount(build());
    const card = screen.getByRole("region", { name: "XRP burned per day" });
    expect(card.querySelector("#burned-title")!.textContent).toBe("XRP burned per day");
    expect(card.querySelector(".chart__source")!.textContent).toBe("/v2/network/fees?interval=day");
    // The Chart / Table toggle: two native radios, the chart checked.
    const toggle = within(card).getByRole("group", { name: "XRP burned per day: view" });
    expect(within(toggle).getAllByRole("radio").map((radio) => [radio.getAttribute("value"), (radio as HTMLInputElement).defaultChecked])).toEqual([
      ["chart", true],
      ["table", false],
    ]);
    const summary = card.querySelector(".chart__summary")!;
    expect(summary.textContent).toBe("Last 90 days: 3,466.85 XRP burned as fees, 38.71 XRP a day on average. Highest: 194.91 XRP on Oct 15.");
    expect(texts(summary.querySelectorAll("b"))).toEqual(["3,466.85 XRP"]);
    // 90 columns, one series: the chart's slider reads days.
    expect(card.querySelectorAll(".plot__marks")).toHaveLength(1);
    // The table: a day and "Burned, XRP", the newest first (90 rows), today "so far".
    const table = within(card).getByRole("table", { name: "Burned per day" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["Day (UTC)", "Burned, XRP"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(90);
    expect(texts(within(rows[0]!).getAllByRole("cell"))).toEqual(["Oct 17, 2026, so far", "21.803244"]);
    expect(container.querySelector("#minted-title")).toBeNull();
  });

  it("is Xahau's burned in XAH", () => {
    mount(build("xahau"));
    const card = screen.getByRole("region", { name: "XAH burned per day" });
    expect(card.querySelector(".chart__summary")!.textContent).toBe("Last 90 days: 427.36 XAH burned as fees, 4.77 XAH a day on average. Highest: 25.22 XAH on Oct 1.");
    expect(texts(within(within(card).getByRole("table", { name: "Burned per day" })).getAllByRole("columnheader"))).toEqual(["Day (UTC)", "Burned, XAH"]);
  });
});

describe("SupplyPage: the minted card", () => {
  it("is Xahau's only, with the legend, the summary, the table of sources and the notes", () => {
    const { container } = mount(build("xahau"));
    const card = screen.getByRole("region", { name: "XAH minted per day, by source" });
    expect(card.querySelector(".chart__source")!.textContent).toBe("/v2/network/supply/minted?interval=day");
    expect(texts(within(within(card).getByRole("list", { name: "Legend" })).getAllByRole("listitem"))).toEqual(["Rewards", "Import", "GenesisMint"]);
    expect(card.querySelector(".chart__summary")!.textContent).toBe("Last 90 days: 2.98M XAH minted (Rewards 2.65M, Import 293K, GenesisMint 40K), 33.3K a day on average.");
    const table = within(card).getByRole("table", { name: "Minted per day" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["Day (UTC)", "Rewards", "Import", "GenesisMint", "Total, XAH"]);
    expect(within(table).getAllByRole("row")).toHaveLength(91);
    // The notes: the snapshot's own sentence of what the index holds and the board's note on the three sources.
    expect(texts(card.querySelectorAll(".chart__notes p"))).toEqual([
      "Since ledger #1: 49,425,551.616207 XAH minted: 41,203,318.512207 as rewards, 8,102,233.104 by Import, 120,000 by GenesisMint.",
      "Rewards are paid to accounts that claim them. Import mints XAH for XRP burned on XRPL. GenesisMint is minted by governance.",
    ]);
    // Complete coverage: no note under the card.
    expect(container.querySelectorAll(".coverage-note")).toHaveLength(0);
    cleanup();
    // XRPL mints nothing, so it has no such card.
    mount(build());
    expect(screen.queryByRole("region", { name: /minted per day/ })).toBeNull();
  });

  it("puts the coverage note of the days under the card, outside its notes (a paragraph is not drawn inside a paragraph)", () => {
    const { container } = mount(build("xahau", { minted: fulfilled({ ...MINTED, coverage: { from_ledger_index: 26_000_000, complete: false } }) }));
    const card = screen.getByRole("region", { name: "XAH minted per day, by source" });
    const note = container.querySelector(".supply__stack > .coverage-note")!;
    expect(note.textContent).toBe("Covers ledger #26,000,000 onwards: earlier mints are not in the index yet.");
    expect(card.nextElementSibling).toBe(note);
    expect(card.querySelector(".coverage-note")).toBeNull();
    expect(container.querySelectorAll("p p")).toHaveLength(0);
  });

  it("names its sources in words beside the marks: slots 3 and 5 are under 3:1 on white, so the legend, the table, the summary and the slider carry the meaning (ruling C8)", () => {
    mount(build("xahau"));
    const card = screen.getByRole("region", { name: "XAH minted per day, by source" });
    // The legend keys are the three slots of the board, each with its name.
    expect([...card.querySelectorAll(".legend__swatch")].map((swatch) => swatch.getAttribute("data-slot"))).toEqual(["1", "3", "5"]);
    expect(texts(card.querySelectorAll(".legend__item"))).toEqual(["Rewards", "Import", "GenesisMint"]);
    // The table says each source in its own column, the day of the one GenesisMint in the window included.
    const table = within(card).getByRole("table", { name: "Minted per day" });
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => texts(within(row).getAllByRole("cell")));
    expect(rows.find((cells) => cells[0] === "Sep 14, 2026")).toEqual(["Sep 14, 2026", "33,356.536235", "0", "40,000", "73,356.536235"]);
    // The chart is one image that points to the table, and its slider says the day with each source by name.
    expect(card.querySelector(".plot__marks")!.getAttribute("aria-label")).toMatch(/^XAH minted per day, by source, Jul 20 to Oct 17, 2026\..* Choose Table for every value\.$/);
    expect(card.querySelector('[role="slider"]')!.getAttribute("aria-valuetext")).toBe("Oct 17, 2026, so far: 13.6K XAH; Rewards 11.2K XAH; Import 2,466.56 XAH; GenesisMint 0 XAH");
    // The summary above names them too.
    expect(card.querySelector(".chart__summary")!.textContent).toContain("Rewards 2.65M, Import 293K, GenesisMint 40K");
  });
});

describe("SupplyPage: a card that failed", () => {
  it("is told in its place with a Retry that asks the route again, and the rest of the page stands", () => {
    const { container, loader } = mount(build("xrpl", { fees: rejected(new Error("data API GET /v2/network/fees answered 500")) }));
    const card = screen.getByRole("region", { name: "XRP burned per day" });
    // The title and the source stay; the toggle, the summary, the chart and the table do not.
    expect(card.querySelector(".chart__source")!.textContent).toBe("/v2/network/fees?interval=day");
    expect(card.querySelector(".chart__toggle")).toBeNull();
    expect(card.querySelector(".chart__summary")).toBeNull();
    expect(within(card).queryByRole("table")).toBeNull();
    const alert = within(card).getByRole("alert");
    expect(alert.textContent).toBe("Couldn’t load XRP burned per day.Retry");
    // The reason (an error's own words) is the loader's to log, not the page's to print.
    expect(card.textContent).not.toContain("answered 500");
    // The bar and the tiles are all there.
    expect(screen.getByRole("region", { name: "Where the 100 billion XRP are" })).toBeTruthy();
    expect(tilesOf(container)).toHaveLength(6);
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    expect(loader).not.toHaveBeenCalled();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("is Xahau's minted card too, each with its own error, while the other card stands", () => {
    const { container } = mount(build("xahau", { minted: rejected(new Error("boom")) }));
    const minted = screen.getByRole("region", { name: "XAH minted per day, by source" });
    expect(within(minted).getByRole("alert").textContent).toBe("Couldn’t load XAH minted per day.Retry");
    expect(within(minted).queryByRole("list", { name: "Legend" })).toBeNull();
    expect(container.querySelectorAll(".coverage-note")).toHaveLength(0);
    // The burned card is fine, and so is the minted tile's dash.
    expect(within(screen.getByRole("region", { name: "XAH burned per day" })).queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("fails both cards when the newest ledger could not be read, whatever the calls answered", () => {
    mount(build("xahau", { last: { ...LAST, close_time: "yesterday" } }));
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual(["Couldn’t load XAH burned per day.Retry", "Couldn’t load XAH minted per day.Retry"]);
    expect(screen.queryByText(/older than the newest ledger/)).toBeNull();
    expect(screen.getByRole("region", { name: "Where the XAH are" })).toBeTruthy();
  });
});

// ---- Server and browser -----------------------------------------------------------------------------------------------------------------------------------

describe("SupplyPage: the page is the same on the server as in the browser", () => {
  it.each(["xrpl", "xahau"] as const)("hydrates %s without a mismatch", async (which) => {
    const { html, errors } = await serverThenHydrated(routed(build(which)));
    expect(html).toContain("Supply");
    expect(errors).toEqual([]);
  });

  it("hydrates a page with a stale warning, a coverage note and a failed card without a mismatch", async () => {
    const supply = { ...FIXTURES.xahau.supply, escrowed: { amount: "18406227.318004", escrows: 1, coverage: { from_ledger_index: 99, complete: false } } };
    const data = build("xahau", { supply, last: { ...LAST, close_time: "2026-10-18T09:00:00Z" }, minted: rejected(new Error("boom")) });
    const { html, container, errors } = await serverThenHydrated(routed(data));
    expect(html).toContain("This snapshot is");
    expect(container.textContent).toContain("Couldn’t load XAH minted per day.Retry");
    expect(container.textContent).toContain("Covers ledger #99 onwards: earlier escrows are not in the index yet.");
    expect(container.querySelector(".supply__stack > .coverage-note")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("prints the bar, the tiles and both cards in the HTML the Worker stores, with no script", async () => {
    const { html } = await serverThenHydrated(routed(build("xahau")));
    for (const text of ["Where the XAH are", "Total supply", "XAH burned per day", "XAH minted per day, by source", "Rewards are paid to accounts"]) expect(html).toContain(text);
    // Both views of a card are in the HTML: the chart and its table.
    expect(html).toContain('role="table"');
    expect(html).toContain("plot__marks");
    expect(html).toContain("share--compact");
  });
});
