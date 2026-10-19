import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HomePageData } from "../../server/home-view";
import type { LiveControls } from "../use-live-controls";
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
      expect(row.style.transform).toBe(`translate(0px, -${ROW}px)`);
    }
    const [newTx, ...oldTxs] = txRows();
    expect(newTx!.classList.contains("is-entering")).toBe(true);
    expect(oldTxs.every((row) => !row.classList.contains("is-entering") && row.style.transform === `translate(0px, -${ROW}px)`)).toBe(true);
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

// ---------------------------------------------------------------------------------------------------------------------------
// What the visitor can do about the updates: a visible pause (WCAG 2.2.2), no refresh under a pointer or a focus in a table, and a
// quiet signal when the updates cannot reach the page.

describe("HomePage, the live controls", () => {
  const controls = (over: Partial<LiveControls> = {}): LiveControls => ({
    paused: false,
    held: false,
    notice: "",
    failures: 0,
    onTogglePause: vi.fn(),
    onHold: vi.fn(),
    ...over,
  });
  const showing = (live?: LiveControls) => renderInRouter(<HomePage network={XRPL} data={data()} live={live} />);
  const status = () => screen.getByRole("status");

  it("has no pause, no status and no hold when the page is not given any (every other use of it)", () => {
    showing();
    expect(screen.queryByRole("button", { name: /live updates/ })).toBeNull();
    expect(document.querySelector(".hero__live")).toBeNull();
  });

  it("has a real button that pauses and resumes the updates: its label says what it will do, it is 44 px by the stylesheet, and it is not also a pressed toggle", () => {
    const live = controls();
    showing(live);
    const button = screen.getByRole("button", { name: "Pause live updates" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    // A button whose name changes with its state must not also say it is pressed: a screen reader would say "Resume live updates, pressed".
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    expect(button.className).toContain("live-toggle");
    expect(button.classList.contains("is-paused")).toBe(false);
    fireEvent.click(button);
    expect(live.onTogglePause).toHaveBeenCalledTimes(1);

    cleanup();
    showing(controls({ paused: true }));
    const resume = screen.getByRole("button", { name: "Resume live updates" });
    expect(resume.hasAttribute("aria-pressed")).toBe(false);
    // What the stylesheet fills the button for, and the dot that says the page is live says it is not.
    expect(resume.classList.contains("is-paused")).toBe(true);
    expect(document.querySelector(".hero__dot")!.classList.contains("is-paused")).toBe(true);
  });

  it("is next to the hero's status, in the same row", () => {
    showing(controls());
    const button = screen.getByRole("button", { name: "Pause live updates" });
    const row = button.closest(".hero__status-row")!;
    expect(row).not.toBeNull();
    expect(row.querySelector(".hero__status")).not.toBeNull();
  });

  it("is not in the server's HTML, where it could do nothing, and its status element is", () => {
    const router = createMemoryRouter([{ path: "*", element: <HomePage network={XRPL} data={data()} live={controls()} /> }], { initialEntries: ["/xrpl"] });
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).not.toContain("Pause live updates");
    expect(html).toMatch(/<span[^>]*role="status"[^>]*><\/span>/);
  });

  describe("the status", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
    afterEach(() => vi.useRealTimers());

    type Say = { failures: number; paused: boolean; notice: string };
    let say!: (next: Partial<Say>) => void;
    function Counting() {
      const [state, set] = useState<Say>({ failures: 0, paused: false, notice: "" });
      say = (next) => act(() => set((was) => ({ ...was, ...next })));
      return <HomePage network={XRPL} data={data()} live={controls(state)} />;
    }
    const mountCounting = () => renderInRouter(<Counting />);
    const setFailures = (failures: number) => say({ failures });

    it("says nothing while the updates work, and after one failure", () => {
      mountCounting();
      expect(status().textContent).toBe("");
      setFailures(1);
      expect(status().textContent).toBe("");
    });

    it("says, after two failures in a row, that the updates are paused and retrying, in visible text", () => {
      mountCounting();
      setFailures(1);
      setFailures(2);
      expect(status().textContent).toBe("Live updates paused, retrying…");
      expect(document.querySelector(".hero__dot")!.classList.contains("is-paused")).toBe(true);
      // Visible, and not removed from the page for the eye: no `sr` class, no hiding.
      expect(status().classList.contains("sr")).toBe(false);
      expect(status().hasAttribute("hidden")).toBe(false);
    });

    it("changes its text on these transitions only: a third failure does not touch it, so a screen reader hears it once", () => {
      mountCounting();
      setFailures(2);
      const changes: string[] = [];
      const observer = new MutationObserver((records) => records.forEach((record) => changes.push(record.type)));
      observer.observe(status(), { childList: true, characterData: true, subtree: true });
      setFailures(3);
      setFailures(4);
      setFailures(5);
      expect(changes).toEqual([]);
      observer.disconnect();
    });

    it("says that the updates are back, when they are, and then says nothing again", () => {
      mountCounting();
      setFailures(2);
      setFailures(0);
      expect(status().textContent).toBe("Live updates reconnected");
      act(() => void vi.advanceTimersByTime(3999));
      expect(status().textContent).toBe("Live updates reconnected");
      act(() => void vi.advanceTimersByTime(1));
      expect(status().textContent).toBe("");
      expect(document.querySelector(".hero__dot")!.classList.contains("is-paused")).toBe(false);
    });

    it("does not say 'reconnected' after a single failure that cleared, which was never announced", () => {
      mountCounting();
      setFailures(1);
      setFailures(0);
      expect(status().textContent).toBe("");
    });

    it("is a status of the page and not an alert, set up before anything changes it, and the same element for good", () => {
      mountCounting();
      const element = status();
      expect(element.getAttribute("role")).toBe("status");
      setFailures(2);
      expect(status()).toBe(element);
      setFailures(0);
      expect(status()).toBe(element);
    });

    it("says what the visitor has just done with the pause button, which is announced once for each press, from the same element", () => {
      mountCounting();
      const element = status();
      say({ paused: true, notice: "Live updates paused" });
      expect(status()).toBe(element);
      expect(element.textContent).toBe("Live updates paused");
      say({ paused: false, notice: "Live updates resumed" });
      expect(element.textContent).toBe("Live updates resumed");
      say({ notice: "" });
      expect(element.textContent).toBe("");
    });

    it("does not say that it is retrying while the visitor has paused it, and does not say 'reconnected' for a pause", () => {
      mountCounting();
      setFailures(2);
      expect(status().textContent).toBe("Live updates paused, retrying…");
      say({ paused: true, notice: "Live updates paused" });
      expect(status().textContent).toBe("Live updates paused");
      say({ notice: "" });
      // Nothing is being retried: the line is quiet, and the failures that were are still counted for when it is resumed.
      expect(status().textContent).toBe("");
      expect(document.querySelector(".hero__dot")!.classList.contains("is-paused")).toBe(true);
    });
  });

  describe("holding the updates while the visitor is on a table", () => {
    const ledgers = () => screen.getByRole("region", { name: "Latest ledgers, scrollable table" });
    const transactions = () => screen.getByRole("region", { name: "Latest transactions, scrollable table" });
    const holds = (live: LiveControls) => (live.onHold as ReturnType<typeof vi.fn>).mock.calls.map(([held]) => held);

    /** What a mouse click on a spot of a table that is not a link does: it focuses the scroll region (tabindex 0), and the browser says that is not `:focus-visible`. */
    function focusLikeAMouse(element: HTMLElement) {
      const matches = HTMLElement.prototype.matches;
      vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (this: HTMLElement, selector: string) {
        return selector === ":focus-visible" ? false : matches.call(this, selector);
      });
      act(() => element.focus());
    }

    it("holds while a mouse is over either table, and lets go when it leaves", () => {
      const live = controls();
      showing(live);
      fireEvent.pointerEnter(ledgers(), { pointerType: "mouse" });
      fireEvent.pointerLeave(ledgers(), { pointerType: "mouse" });
      fireEvent.pointerEnter(transactions(), { pointerType: "mouse" });
      fireEvent.pointerLeave(transactions(), { pointerType: "mouse" });
      expect(holds(live)).toEqual([true, false, true, false]);
    });

    it("holds while a link in a table has focus, and lets go when focus leaves the table (not when it moves inside it)", () => {
      const live = controls();
      showing(live);
      const links = within(ledgers()).getAllByRole("link");
      act(() => links[0]!.focus());
      act(() => links[1]!.focus());
      expect(holds(live).at(-1)).toBe(true);
      act(() => within(transactions()).getAllByRole("link")[0]!.focus());
      expect(holds(live).at(-1)).toBe(true);
      act(() => (document.activeElement as HTMLElement).blur());
      expect(holds(live).at(-1)).toBe(false);
    });

    it("holds while the keyboard has focus on a table's scroll region, which is how a keyboard scrolls it", () => {
      const live = controls();
      showing(live);
      // (happy-dom says `:focus-visible` for an element focused from script, as a browser does after a key.)
      act(() => ledgers().focus());
      expect(holds(live).at(-1)).toBe(true);
      act(() => ledgers().blur());
      expect(holds(live).at(-1)).toBe(false);
    });

    it("does not hold for a click that put focus on a table's scroll region: that is not keyboard focus, and would stay after the pointer left", () => {
      const live = controls();
      showing(live);
      focusLikeAMouse(ledgers());
      expect(document.activeElement).toBe(ledgers());
      expect(holds(live).some(Boolean)).toBe(false);
      // The mouse that clicked is over the table, so the hold is the pointer's; when it leaves, nothing is left holding.
      fireEvent.pointerEnter(ledgers(), { pointerType: "mouse" });
      fireEvent.pointerLeave(ledgers(), { pointerType: "mouse" });
      expect(holds(live).at(-1)).toBe(false);
    });

    it("lets go of the hold a link had when focus moves to the scroll region by a click", () => {
      const live = controls();
      showing(live);
      act(() => within(ledgers()).getAllByRole("link")[0]!.focus());
      expect(holds(live).at(-1)).toBe(true);
      focusLikeAMouse(ledgers());
      expect(holds(live).at(-1)).toBe(false);
    });

    it("does not let go while the other kind of hold is still there: a mouse left, a link in the table still has focus", () => {
      const live = controls();
      showing(live);
      act(() => within(ledgers()).getAllByRole("link")[0]!.focus());
      fireEvent.pointerEnter(ledgers(), { pointerType: "mouse" });
      fireEvent.pointerLeave(ledgers(), { pointerType: "mouse" });
      expect(holds(live).every(Boolean)).toBe(true);
      act(() => (document.activeElement as HTMLElement).blur());
      expect(holds(live).at(-1)).toBe(false);
    });

    it("is not for a finger: a touch is not a pointer that stays over a table", () => {
      const live = controls();
      showing(live);
      fireEvent.pointerEnter(ledgers(), { pointerType: "touch" });
      expect(holds(live)).toEqual([]);
    });

    it("tells nobody when there is nobody to tell", () => {
      showing();
      expect(() => fireEvent.pointerEnter(ledgers(), { pointerType: "mouse" })).not.toThrow();
    });

    it("lets go when the page goes away, so that a page that replaces it (the other network's home) is not held by the one that left", () => {
      const live = controls();
      let remount!: () => void;
      function Keyed() {
        const [network, setNetwork] = useState<typeof XRPL | typeof XAHAU>(XRPL);
        remount = () => act(() => setNetwork(XAHAU));
        return <HomePage key={network.id} network={network} data={data()} live={live} />;
      }
      renderInRouter(<Keyed />);
      fireEvent.pointerEnter(ledgers(), { pointerType: "mouse" });
      act(() => within(transactions()).getAllByRole("link")[0]!.focus());
      expect(holds(live).at(-1)).toBe(true);

      remount();
      expect(holds(live).at(-1)).toBe(false);
    });

    it("lets go when the page is unmounted", () => {
      const live = controls();
      const { unmount } = showing(live);
      fireEvent.pointerEnter(ledgers(), { pointerType: "mouse" });
      unmount();
      expect(holds(live).at(-1)).toBe(false);
    });
  });

  describe("saying that the page is held", () => {
    it("shows, in visible text in the hero's row, that the updates wait while the visitor looks at a table, and not otherwise", () => {
      showing(controls());
      expect(screen.queryByText("Paused while you look at the table")).toBeNull();
      cleanup();
      showing(controls({ held: true }));
      const held = screen.getByText("Paused while you look at the table");
      expect(held.closest(".hero__status-row")).not.toBeNull();
      expect(held.className).toContain("hero__held");
      // The dot goes quiet with it.
      expect(document.querySelector(".hero__dot")!.classList.contains("is-paused")).toBe(true);
    });

    it("is not in the status element, nor in any live region: a pointer moving over the tables is not announced", () => {
      showing(controls({ held: true }));
      const held = screen.getByText("Paused while you look at the table");
      expect(held.closest("[role=status], [aria-live]")).toBeNull();
      expect(status().textContent).toBe("");
    });

    it("is not said for a page without controls", () => {
      showing();
      expect(screen.queryByText("Paused while you look at the table")).toBeNull();
    });
  });
});
