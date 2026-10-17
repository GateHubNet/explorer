import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import type { HomePageData } from "../../server/home-view";
import { HomePage } from "./HomePage";

const XRPL = { id: "xrpl", name: "XRPL", native: "XRP" } as const;
const XAHAU = { id: "xahau", name: "Xahau", native: "XAH" } as const;
const ALICE = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";
const HASH = "67F91E110D4E3E6C2E6DA3D42EDFB36D9860D024406F58A12CDDF09B65057C31";

afterEach(cleanup);

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
