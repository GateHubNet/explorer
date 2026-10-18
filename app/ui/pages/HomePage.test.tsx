import { act, cleanup, render, screen, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HomePageData } from "../../server/home-view";
import { HomePage } from "./HomePage";

const XRPL = { id: "xrpl", name: "XRPL", native: "XRP" } as const;
const XAHAU = { id: "xahau", name: "Xahau", native: "XAH" } as const;
const ALICE = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";
const HASH = "67F91E110D4E3E6C2E6DA3D42EDFB36D9860D024406F58A12CDDF09B65057C31";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderInRouter(ui: ReactElement) {
  const router = createMemoryRouter([{ path: "*", element: ui }], { initialEntries: ["/xrpl"] });
  return render(<RouterProvider router={router} />);
}

const data = (extra: Partial<HomePageData> = {}): HomePageData => ({
  latest: { index: 107695660, hash: "AB".repeat(32), closeTime: 1792256472, supply: "99985312446.118204" },
  txCount: 84,
  average: { transactions: 78, ledgers: 8 },
  fees: { total: "0.001284", average: "0.000015", max: "0.00012" },
  ledgers: [
    { index: 107695660, txCount: 84, closeTime: 1792256472 },
    { index: 107695659, txCount: 1200, closeTime: 1792256468 },
  ],
  transactions: [
    { type: "Payment", hash: HASH, account: ALICE, amount: { value: "1250.00", currency: "USD", issuer: ALICE }, ok: true, code: "tesSUCCESS", date: 1792256472 },
    { type: "TrustSet", hash: "CB".repeat(32), account: ALICE, amount: null, ok: false, code: "tecNO_LINE", date: 1792256468 },
  ],
  examples: [{ kind: "Ledger", label: "107,695,660", title: "107695660", href: "/xrpl/ledger/107695660" }],
  ...extra,
});

describe("HomePage", () => {
  it("shows the four tiles with their figures and notes", () => {
    renderInRouter(<HomePage network={XRPL} data={data()} />);
    const tiles = within(screen.getByRole("region", { name: "Network at a glance" }));
    expect(tiles.getByText("Latest validated ledger")).toBeTruthy();
    expect(tiles.getByText("#107,695,660")).toBeTruthy();
    expect(tiles.getByText("84")).toBeTruthy();
    expect(tiles.getByText("average 78 over the last 8")).toBeTruthy();
    expect(tiles.getByText("0.001284 XRP")).toBeTruthy();
    expect(tiles.getByText("average 0.000015 · max 0.00012 per transaction")).toBeTruthy();
    // The supply in whole units, every digit on hover.
    const supply = tiles.getByText("99,985,312,446 XRP");
    expect(supply.parentElement?.getAttribute("title")).toBe("99,985,312,446.118204 XRP");
  });

  it("says so when the newest ledger has not been counted yet", () => {
    renderInRouter(<HomePage network={XRPL} data={data({ txCount: null, fees: null, average: null })} />);
    const tiles = within(screen.getByRole("region", { name: "Network at a glance" }));
    expect(tiles.getAllByText("—")).toHaveLength(2);
    expect(tiles.getAllByText("not counted yet")).toHaveLength(2);
  });

  it("lists the ledgers with thousands separators and the transactions with their amounts and results", () => {
    renderInRouter(<HomePage network={XRPL} data={data()} />);
    const ledgers = within(screen.getByRole("table", { name: "Latest ledgers" })).getAllByRole("row").slice(1);
    expect(ledgers.map((row) => within(row).getAllByRole("cell").slice(0, 3).map((cell) => cell.textContent))).toEqual([
      ["#107,695,660", "84", "17:01:12"],
      ["#107,695,659", "1,200", "17:01:08"],
    ]);
    const [ok, bad] = within(screen.getByRole("table", { name: "Latest transactions" })).getAllByRole("row").slice(1);
    expect(within(ok!).getByText("1,250.00 USD")).toBeTruthy();
    expect(within(ok!).getByText("Success")).toBeTruthy();
    expect(within(bad!).getByText("—")).toBeTruthy();
    expect(within(bad!).getByText("tecNO_LINE")).toBeTruthy();
  });

  it("has the cards the header's links lead to, and a link to the ledger in each", () => {
    renderInRouter(<HomePage network={XRPL} data={data()} />);
    expect(document.getElementById("latest-ledgers")).toBeTruthy();
    expect(document.getElementById("latest-transactions")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Latest ledger →" }).getAttribute("href")).toBe("/xrpl/ledger/107695660");
    expect(screen.getByRole("link", { name: "All in ledger #107,695,660 →" }).getAttribute("href")).toBe("/xrpl/ledger/107695660");
  });

  it("has the hero: the network's headline, the search box and the examples, named for screen readers", () => {
    renderInRouter(<HomePage network={XAHAU} data={data()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Explore Xahau");
    expect(screen.getByRole("search")).toBeTruthy();
    const example = screen.getByRole("link", { name: "Ledger 107,695,660" });
    expect(example.getAttribute("href")).toBe("/xrpl/ledger/107695660");
    expect(example.getAttribute("title")).toBe("107695660");
  });

  it("leaves the examples out when there are none", () => {
    renderInRouter(<HomePage network={XRPL} data={data({ examples: [] })} />);
    expect(screen.queryByText("Try")).toBeNull();
  });

  it("says what is missing instead of drawing an empty table", () => {
    renderInRouter(<HomePage network={XRPL} data={data({ ledgers: [], transactions: [] })} />);
    expect(screen.getByText("No ledgers yet.")).toBeTruthy();
    expect(screen.getByText("No transactions yet.")).toBeTruthy();
  });

  it("prints the close times and no ages on the server, because the page is stored", () => {
    const router = createMemoryRouter([{ path: "*", element: <HomePage network={XRPL} data={data()} /> }], { initialEntries: ["/xrpl"] });
    // A static render of the route's element is enough: what matters is that no clock was read.
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).not.toMatch(/\d+ (s|min|h|d) ago/);
    expect(html).toContain("at 17:01:12 UTC");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// The page follows the chain: what happens to what is on it when the loader's data changes in the browser.

describe("HomePage, when its data changes", () => {
  const ROW = 46;
  /** The page, with a way to give it the next ledger's data from outside, as React Router does after a revalidation. */
  let update!: (next: HomePageData) => void;
  function Host({ first, network = XRPL }: { first: HomePageData; network?: typeof XRPL | typeof XAHAU }) {
    const [current, setCurrent] = useState(first);
    update = (next) => act(() => setCurrent(next));
    return <HomePage network={network} data={current} />;
  }

  /** The next ledger: one more at the top of the ledgers, new transactions, new figures. */
  const next = (): HomePageData => {
    const before = data();
    return data({
      latest: { ...before.latest, index: 107695661, closeTime: before.latest.closeTime + 4, supply: "99985312446.117204" },
      txCount: 91,
      average: { transactions: 79, ledgers: 8 },
      fees: { total: "0.001301", average: "0.000015", max: "0.00012" },
      ledgers: [{ index: 107695661, txCount: 91, closeTime: before.latest.closeTime + 4 }, ...before.ledgers],
      transactions: [
        { type: "OfferCreate", hash: "DD".repeat(32), account: ALICE, amount: null, ok: true, code: "tesSUCCESS", date: before.latest.closeTime + 4 },
        ...before.transactions,
      ],
      examples: [{ kind: "Ledger", label: "107,695,661", title: "107695661", href: "/xrpl/ledger/107695661" }],
    });
  };

  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const siblings = this.parentElement ? Array.from(this.parentElement.children) : [];
      const top = this.getAttribute("role") === "table" ? 0 : siblings.indexOf(this) * ROW;
      return { top, bottom: top + ROW, left: 0, right: 0, width: 0, height: ROW, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
  });

  const mount = (first = data(), network: typeof XRPL | typeof XAHAU = XRPL) => {
    const router = createMemoryRouter([{ path: "*", element: <Host first={first} network={network} /> }], { initialEntries: ["/xrpl"] });
    return render(<RouterProvider router={router} />);
  };
  const ledgerRows = () => within(screen.getByRole("table", { name: "Latest ledgers" })).getAllByRole("row").slice(1);
  const txRows = () => within(screen.getByRole("table", { name: "Latest transactions" })).getAllByRole("row").slice(1);

  it("animates nothing on the first render", () => {
    const { container } = mount();
    expect(container.querySelector(".is-entering, .is-changed")).toBeNull();
    expect(container.querySelector('[style*="transform"], [style*="transition"]')).toBeNull();
    const html = renderToString(<RouterProvider router={createMemoryRouter([{ path: "*", element: <HomePage network={XRPL} data={data()} /> }], { initialEntries: ["/xrpl"] })} />);
    expect(html).not.toMatch(/is-entering|is-changed/);
  });

  it("brings the new ledger and the new transaction in at the top and moves the rows that were there", () => {
    const { container } = mount();
    update(next());

    expect(ledgerRows().map((row) => row.textContent?.slice(0, 12))).toEqual(["#107,695,661", "#107,695,660", "#107,695,659"]);
    const [newLedger, ...oldLedgers] = ledgerRows();
    expect(newLedger!.classList.contains("is-entering")).toBe(true);
    for (const row of oldLedgers) {
      expect(row.classList.contains("is-entering")).toBe(false);
      expect(row.style.transform).toBe(`translateY(-${ROW}px)`);
    }
    const [newTx, ...oldTxs] = txRows();
    expect(newTx!.classList.contains("is-entering")).toBe(true);
    expect(oldTxs.every((row) => !row.classList.contains("is-entering") && row.style.transform === `translateY(-${ROW}px)`)).toBe(true);
    // Rows are keyed by ledger index and by transaction hash.
    expect(newLedger!.getAttribute("data-key")).toBe("107695661");
    expect(newTx!.getAttribute("data-key")).toBe("DD".repeat(32));
    expect(container.querySelectorAll(".table__row.is-entering")).toHaveLength(2);
  });

  it("ticks in the figures that changed and leaves the ones that did not alone", () => {
    const { container } = mount();
    update(next());
    const tile = (label: string) => screen.getByText(label).closest(".stat") as HTMLElement;

    // Changed: the latest ledger, the transactions in it, the fees burned (and the notes under the last two).
    for (const label of ["Latest validated ledger", "Transactions per ledger", "Fees burned, last ledger"]) {
      expect(tile(label).querySelector(".stat__value .is-changed"), label).not.toBeNull();
    }
    expect(tile("Transactions per ledger").querySelector(".stat__sub .is-changed")).not.toBeNull();
    expect(tile("Latest validated ledger").querySelector(".stat__value")!.textContent).toBe("#107,695,661");
    // The supply is shown in whole units: a few drops burned in the new ledger do not change what the tile says, so nothing moves.
    expect(tile("Total supply").querySelector(".is-changed")).toBeNull();
    // The hero's line.
    const status = container.querySelector(".hero__status")!;
    expect(status.querySelector(".is-changed")).not.toBeNull();
    expect(status.textContent).toContain("#107,695,661");
    // The hero's example chips: the ledger one has a new label.
    expect(container.querySelector(".examples .is-changed")).not.toBeNull();
  });

  it("animates the supply when a whole unit has burned", () => {
    mount();
    const later = next();
    update({ ...later, latest: { ...later.latest, supply: "99985312445.9" } });
    expect(screen.getByText("Total supply").closest(".stat")!.querySelector(".stat__value .is-changed")).not.toBeNull();
  });

  it("animates nothing when the data is the same ledger again, though every object is new", () => {
    const { container } = mount();
    update(data());
    expect(container.querySelector(".is-entering, .is-changed")).toBeNull();
    expect(container.querySelector('[style*="transform"]')).toBeNull();
    expect(frames).toHaveLength(0);
  });

  it("moves nothing for a visitor who asks for less motion: the rows are marked, no row is transformed", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion"), media: query, addEventListener() {}, removeEventListener() {} }));
    const { container } = mount();
    update(next());
    expect(container.querySelectorAll(".table__row.is-entering")).toHaveLength(2);
    expect(container.querySelector('[style*="transform"], [style*="transition"]')).toBeNull();
    expect(frames).toHaveLength(0);
  });

  it("puts nothing in a live region: a screen reader is not told every four seconds", () => {
    const { container } = mount();
    update(next());
    // (The search box has a region of its own for its hints; what changes every few seconds is the status line, the tiles and the tables.)
    for (const part of [".hero__status", ".stat-grid", ".cols"]) {
      expect(container.querySelector(`${part} [aria-live], ${part} [role=status], ${part} [role=alert], ${part} [role=log]`), part).toBeNull();
      expect(container.querySelector(`${part}[aria-live]`), part).toBeNull();
    }
  });

  it("keeps the links of the changed values pointing at the new ledger", () => {
    mount();
    update(next());
    expect(screen.getByRole("link", { name: "Latest ledger →" }).getAttribute("href")).toBe("/xrpl/ledger/107695661");
    expect(screen.getByRole("link", { name: "All in ledger #107,695,661 →" }).getAttribute("href")).toBe("/xrpl/ledger/107695661");
    expect(screen.getByRole("link", { name: "Ledger 107,695,661" }).getAttribute("href")).toBe("/xrpl/ledger/107695661");
  });
});
