import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, Outlet, RouterProvider, type UIMatch } from "react-router";
import { classicAddressToXAddress } from "ripple-address-codec";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Segment } from "../../domain/describe";
import { shortAddress, shortHash } from "../../domain/format";
import { allSwitches } from "../../../test/support/switches";
import { THEME_STORAGE_KEY } from "../theme-script";
import { AccountLink } from "./AccountLink";
import { Amount } from "./Amount";
import { Breadcrumbs } from "./Breadcrumbs";
import { Card } from "./Card";
import { CopyButton } from "./CopyButton";
import { DataTable } from "./DataTable";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { HashLink, LedgerLink } from "./HashLink";
import { NetworkSwitch } from "./NetworkSwitch";
import { Notice } from "./Notice";
import { Pager } from "./Pager";
import { Pill, ResultPill } from "./Pill";
import { SearchBox } from "./SearchBox";
import { SectionError } from "./SectionError";
import { Sentence } from "./Sentence";
import { Shell } from "./Shell";
import { StatGrid, StatTile } from "./StatTile";
import { Tabs } from "./Tabs";
import { ThemeToggle } from "./ThemeToggle";
import { TypeTag } from "./TypeTag";
import { LATEST_LEDGERS_ID, LATEST_TRANSACTIONS_ID } from "../anchors";
import { PRODUCT_NAME } from "../brand";
import { NotFoundPage } from "../pages/NotFoundPage";
import { errorMeta, RouteErrorScreen } from "../pages/RouteErrorScreen";
import { FEATURE_VARS, featuresOf, NO_FEATURES, type Features } from "../features";
import { navSectionOf, type NetworkRouteHandle } from "../route-handle";
import { NETWORK_ROUTE_ID, useNetwork } from "../use-network";
import { DetailList } from "./DetailList";

const XRPL = { id: "xrpl", name: "XRPL", native: "XRP", ctidNetworkId: 0, other: "xahau" } as const;
const XAHAU = { id: "xahau", name: "Xahau", native: "XAH", ctidNetworkId: 21337, other: "xrpl" } as const;

const ADDRESS = "rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x";
const HASH = "67F91E110D4E3E6C2E6DA3D42EDFB36D9860D024406F58A12CDDF09B65057C31";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
  try {
    localStorage.clear();
  } catch {
    // no storage in this environment
  }
});

/** Components that link or submit need a data router around them, as they have in the app. */
function renderInRouter(ui: ReactElement, path = "/xrpl") {
  const router = createMemoryRouter([{ path: "*", element: ui }], { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe("Pill", () => {
  it("shows an icon and the text, never the colour alone", () => {
    const { container } = render(<Pill tone="ok">Success</Pill>);
    const pill = screen.getByText("Success").closest(".pill")!;
    expect(pill.className).toContain("pill--ok");
    const icon = pill.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).toBe("Success");
  });

  it("has a different icon for a failure, and takes one of its own", () => {
    const { rerender } = render(<Pill tone="bad">tecPATH_DRY</Pill>);
    const failure = document.querySelector(".pill svg")!.innerHTML;
    rerender(<Pill tone="ok">Success</Pill>);
    expect(document.querySelector(".pill svg")!.innerHTML).not.toBe(failure);

    rerender(<Pill tone="neutral" icon={<svg data-testid="own" aria-hidden="true" />}>Pending</Pill>);
    expect(screen.getByTestId("own")).toBeTruthy();
  });

  it("ResultPill says Success for tesSUCCESS and shows the code of a failure", () => {
    const { rerender } = render(<ResultPill ok code="tesSUCCESS" />);
    expect(screen.getByText("Success")).toBeTruthy();
    expect(screen.queryByText("tesSUCCESS")).toBeNull();

    rerender(<ResultPill ok code="tesSUCCESS" showCode />);
    expect(screen.getByText("tesSUCCESS")).toBeTruthy();

    rerender(<ResultPill ok={false} code="tecPATH_DRY" />);
    expect(screen.getByText("tecPATH_DRY").closest(".pill")!.className).toContain("pill--bad");
    expect(screen.queryByText("Success")).toBeNull();
  });
});

describe("TypeTag", () => {
  it("shows the transaction type", () => {
    render(<TypeTag type="OfferCreate" />);
    expect(screen.getByText("OfferCreate").className).toContain("type");
  });
});

describe("Amount", () => {
  it("is the value through formatAmount and the currency through formatCurrency", () => {
    const { container } = render(<Amount value="1250.00" currency="USD" />);
    expect(container.textContent).toBe("1,250.00 USD");
  });

  it("writes an exponent out in full and never shows an e", () => {
    const { container } = render(<Amount value="9999999999999999e79" currency="XRP" />);
    const text = container.textContent!;
    expect(text).toMatch(/^\d{1,3}(,\d{3})+ XRP$/);
    expect(text.replace(/[, ]|XRP/g, "")).toBe(`9999999999999999${"0".repeat(79)}`);
  });

  it("shows a 40-hex currency as text, as LP token, or as its first 8 digits, with the code on hover", () => {
    const solo = "534F4C4F00000000000000000000000000000000";
    const lp = "03A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3";
    const opaque = "FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00";
    const { container, rerender } = render(<Amount value="5" currency={solo} />);
    expect(container.textContent).toBe("5 SOLO");
    expect(container.querySelector("[title]")!.getAttribute("title")).toBe(solo);
    rerender(<Amount value="5" currency={lp} />);
    expect(container.textContent).toBe("5 LP token");
    rerender(<Amount value="5" currency={opaque} />);
    expect(container.textContent).toBe("5 FF00FF00\u2026");
  });

  it("keeps the real minus sign and can mark a gain with a plus and the success colour", () => {
    const { container, rerender } = render(<Amount value="-512.402115" currency="XRP" signed />);
    expect(container.textContent).toBe("−512.402115 XRP");
    expect(container.firstElementChild!.className).not.toContain("amt--pos");

    rerender(<Amount value="1250.00" currency="USD" signed />);
    expect(container.textContent).toBe("+1,250.00 USD");
    expect(container.firstElementChild!.className).toContain("amt--pos");

    rerender(<Amount value="0" currency="USD" signed />);
    expect(container.textContent).toBe("0 USD");
  });

  it("names the issuer of an issued currency on hover", () => {
    const { container } = render(<Amount value="5" currency="USD" issuer={ADDRESS} />);
    expect(container.querySelector("[title]")!.getAttribute("title")).toContain(ADDRESS);
  });
});

describe("AccountLink, HashLink and LedgerLink", () => {
  it("link to the account of the network, shortened with the whole address on hover", () => {
    renderInRouter(<AccountLink net="xahau" address={ADDRESS} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(`/xahau/account/${ADDRESS}`);
    expect(link.textContent).toBe(shortAddress(ADDRESS));
    expect(link.textContent).toBe(`${ADDRESS.slice(0, 6)}\u2026${ADDRESS.slice(-4)}`);
    expect(link.getAttribute("title")).toBe(ADDRESS);
    expect(link.className).toContain("mono");
  });

  it("show the whole address on request, and as a chip", () => {
    renderInRouter(<AccountLink net="xrpl" address={ADDRESS} full variant="chip" />);
    const link = screen.getByRole("link");
    expect(link.textContent).toBe(ADDRESS);
    expect(link.className).toContain("ent");
  });

  it("link a hash to its transaction or ledger page", () => {
    renderInRouter(
      <>
        <HashLink net="xrpl" kind="tx" hash={HASH} />
        <HashLink net="xahau" kind="ledger" hash={HASH} full />
      </>,
    );
    const [tx, ledger] = screen.getAllByRole("link");
    expect(tx!.getAttribute("href")).toBe(`/xrpl/tx/${HASH}`);
    expect(tx!.textContent).toBe(`${HASH.slice(0, 6)}…${HASH.slice(-4)}`);
    expect(ledger!.getAttribute("href")).toBe(`/xahau/ledger/${HASH}`);
    expect(ledger!.textContent).toBe(HASH);
  });

  it("link a ledger index with thousands separators", () => {
    renderInRouter(<LedgerLink net="xrpl" index={107695660} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/xrpl/ledger/107695660");
    expect(link.textContent).toBe("#107,695,660");
  });
});

describe("Sentence", () => {
  const segments: Segment[] = [
    { t: "account", v: ADDRESS },
    { t: "text", v: " paid " },
    { t: "amount", value: "1250.00", currency: "USD", issuer: "rA7wzfRjziBcrbFwErG1t2sdVofKQmg95" },
    { t: "text", v: " to " },
    { t: "account", v: "rNYbL8WZKKNNni5rb2MzcxnAEgkQC5Kq5" },
    { t: "text", v: " through " },
    { t: "pool", v: "rAtRwrVakWQaGpzxtqgJZDb3Tg7t32rXT", pair: "XRP/USD" },
    { t: "text", v: "." },
  ];

  it("renders text, accounts as links, amounts through formatAmount and pools as a link with their pair", () => {
    const { container } = renderInRouter(<Sentence net="xrpl" segments={segments} />);
    expect(container.textContent).toBe(
      `${shortAddress(ADDRESS)} paid 1,250.00 USD to ${shortAddress("rNYbL8WZKKNNni5rb2MzcxnAEgkQC5Kq5")} through XRP/USD.`,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      `/xrpl/account/${ADDRESS}`,
      "/xrpl/account/rNYbL8WZKKNNni5rb2MzcxnAEgkQC5Kq5",
      "/xrpl/account/rAtRwrVakWQaGpzxtqgJZDb3Tg7t32rXT",
    ]);
    expect(links[2]!.textContent).toBe("XRP/USD");
  });

  it("formats an amount that arrives in exponent form", () => {
    const { container } = renderInRouter(
      <Sentence net="xrpl" segments={[{ t: "amount", value: "1e-7", currency: "XRP" }]} />,
    );
    expect(container.textContent).toBe("0.0000001 XRP");
  });

  it("with `compact`, shows accounts and pools as plain links, the same links without the chip's box", () => {
    const { container } = renderInRouter(<Sentence net="xrpl" segments={segments} compact />);
    expect(container.querySelector(".ent")).toBeNull();
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      `/xrpl/account/${ADDRESS}`,
      "/xrpl/account/rNYbL8WZKKNNni5rb2MzcxnAEgkQC5Kq5",
      "/xrpl/account/rAtRwrVakWQaGpzxtqgJZDb3Tg7t32rXT",
    ]);
    expect(container.textContent).toContain("through XRP/USD.");
  });

  it("without it, accounts and pools are chips", () => {
    const { container } = renderInRouter(<Sentence net="xrpl" segments={segments} />);
    expect(container.querySelectorAll(".ent")).toHaveLength(3);
  });
});

describe("CopyButton", () => {
  it("copies the value and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<CopyButton value={HASH} label="hash" />);
    const button = screen.getByRole("button", { name: "Copy hash" });
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Copied"));
    expect(writeText).toHaveBeenCalledWith(HASH);
  });

  it("says when it could not copy", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<CopyButton value={HASH} label="hash" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy hash" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/could not copy/i));
  });
});

describe("Card and StatTile", () => {
  it("labels a card by its title", () => {
    render(
      <Card title="Latest ledgers" action={<a href="/xrpl/ledger/1">Latest ledger</a>}>
        body
      </Card>,
    );
    const card = screen.getByRole("region", { name: "Latest ledgers" });
    expect(within(card).getByRole("heading", { level: 2 }).textContent).toBe("Latest ledgers");
    expect(within(card).getByRole("link").textContent).toBe("Latest ledger");
    expect(card.textContent).toContain("body");
  });

  it("carries an id on its root element, for a link to it (#latest-ledgers)", () => {
    const { container, rerender } = render(
      <Card id={LATEST_LEDGERS_ID} title="Latest ledgers">
        body
      </Card>,
    );
    const card = screen.getByRole("region", { name: "Latest ledgers" });
    expect(card.id).toBe("latest-ledgers");
    expect(container.firstElementChild).toBe(card);
    expect(container.querySelectorAll("#latest-ledgers")).toHaveLength(1);

    rerender(
      <Card as="div" id={LATEST_TRANSACTIONS_ID}>
        body
      </Card>,
    );
    expect(container.firstElementChild!.id).toBe("latest-transactions");
  });

  it("has no id unless it is given one", () => {
    const { container } = render(<Card title="Latest ledgers">body</Card>);
    expect(container.firstElementChild!.hasAttribute("id")).toBe(false);
  });

  it("shows a tile's label, value and note", () => {
    const { container } = render(<StatTile label="Fees burned" value="0.001284 XRP" sub="base fee 0.00001 XRP" />);
    expect(container.textContent).toContain("Fees burned");
    expect(container.textContent).toContain("0.001284 XRP");
    expect(container.textContent).toContain("base fee 0.00001 XRP");
  });

  it("keeps the home page's tile as it was: the mono 22 px style, no figure class, no delta, no trend", () => {
    const { container } = render(<StatTile label="Fees burned" value="0.001284 XRP" sub="base fee 0.00001 XRP" />);
    const tile = container.firstElementChild!;
    expect(tile.className).toBe("stat");
    expect(Array.from(tile.children, (part) => part.className)).toEqual(["stat__label", "stat__value", "stat__sub"]);
  });

  it("is a figure tile with the sans style of the network pages when asked", () => {
    const { container } = render(<StatTile figure label="Transactions" value="45.5M" />);
    expect(container.firstElementChild!.className).toBe("stat stat--figure");
    expect(container.querySelector(".stat__value")!.textContent).toBe("45.5M");
  });

  it("shows a delta after the value and before the sub: an up triangle, hidden from a screen reader, then the signed text", () => {
    const text = "+3.2%, 30 full days to Oct 16 vs the 30 before";
    const { container } = render(<StatTile figure label="Transactions" value="45.5M" delta={{ text, sign: 1 }} sub="in the window" />);
    expect(Array.from(container.firstElementChild!.children, (part) => part.className)).toEqual(["stat__label", "stat__value", "stat__delta", "stat__sub"]);
    const delta = container.querySelector(".stat__delta")!;
    expect(delta.textContent).toBe(text);
    const icons = delta.querySelectorAll("svg");
    expect(icons).toHaveLength(1);
    expect(icons[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(icons[0]!.getAttribute("viewBox")).toBe("0 0 10 10");
    // Up is the triangle with its point at the top (the board's path).
    expect(icons[0]!.querySelector("path")!.getAttribute("d")).toBe("M5 1.5 9 8H1z");
  });

  it("points the triangle down for a fall", () => {
    const { container } = render(<StatTile figure label="Transactions" value="45.5M" delta={{ text: "−1.8%, 30 full days to Oct 16 vs the 30 before", sign: -1 }} />);
    const icons = container.querySelectorAll(".stat__delta svg");
    expect(icons).toHaveLength(1);
    expect(icons[0]!.querySelector("path")!.getAttribute("d")).toBe("M5 8.5 1 2h8z");
    expect(container.querySelector(".stat__delta")!.textContent).toBe("−1.8%, 30 full days to Oct 16 vs the 30 before");
  });

  it("shows no triangle for a delta of 0: the text alone", () => {
    const { container } = render(<StatTile figure label="Transactions" value="45.5M" delta={{ text: "0.0%, 30 full days to Oct 16 vs the 30 before", sign: 0 }} />);
    expect(container.querySelector(".stat__delta")!.textContent).toBe("0.0%, 30 full days to Oct 16 vs the 30 before");
    expect(container.querySelector(".stat__delta svg")).toBeNull();
  });

  it("shows no delta element without a delta", () => {
    const { container } = render(<StatTile figure label="Transactions" value="45.5M" sub="in the window" />);
    expect(container.querySelector(".stat__delta")).toBeNull();
  });

  it("puts a trend last, after the sub, as it is given", () => {
    const { container } = render(
      <StatTile figure label="Price" value="2.44" delta={{ text: "+2.5%", sign: 1 }} sub="7 days" trend={<svg role="img" aria-label="7-day price" />} />,
    );
    expect(Array.from(container.firstElementChild!.children, (part) => part.className)).toEqual(["stat__label", "stat__value", "stat__delta", "stat__sub", "stat__trend"]);
    expect(container.querySelector(".stat__trend [role='img']")!.getAttribute("aria-label")).toBe("7-day price");
  });

  it("shows a source under the note, in .stat__source, and none without one", () => {
    const path = "/v2/accounts/{a}/analytics/counterparties";
    const { container } = render(<StatTile figure label="Counterparties" value="48" sub="accounts it paid or was paid by" source={path} />);
    expect(container.querySelector(".stat__source")!.textContent).toBe(path);
    expect(Array.from(container.firstElementChild!.children, (part) => part.className)).toEqual(["stat__label", "stat__value", "stat__sub", "stat__source"]);
    expect(container.firstElementChild!.hasAttribute("aria-busy")).toBe(false);

    const { container: bare } = render(<StatTile figure label="Counterparties" value="48" sub="accounts it paid or was paid by" />);
    expect(bare.querySelector(".stat__source")).toBeNull();
  });

  it("puts the source last, the tile's own line under the delta, the note and the trend", () => {
    const { container } = render(
      <StatTile figure label="Price" value="2.44" delta={{ text: "+2.5%", sign: 1 }} sub="7 days" trend={<svg role="img" aria-label="7-day price" />} source="/v2/price" />,
    );
    expect(Array.from(container.firstElementChild!.children, (part) => part.className)).toEqual([
      "stat__label",
      "stat__value",
      "stat__delta",
      "stat__sub",
      "stat__trend",
      "stat__source",
    ]);
  });

  it("is busy before its data: aria-busy, and an empty figure that is still in the tile", () => {
    const { container } = render(<StatTile figure busy label="Account value" value="12,345 XRP" source="/v2/accounts/{a}/stats/value?interval=day" />);
    const tile = container.firstElementChild!;
    expect(tile.getAttribute("aria-busy")).toBe("true");
    expect(tile.className).toBe("stat stat--figure");
    expect(container.querySelector(".stat__value")!.textContent).toBe("");
    expect(container.querySelector(".stat__label")!.textContent).toBe("Account value");
    expect(container.querySelector(".stat__source")!.textContent).toBe("/v2/accounts/{a}/stats/value?interval=day");
    expect(container.textContent).not.toContain("12,345");
  });

  it("has no busy mark when it is not busy, whether busy is false or left out", () => {
    for (const busy of [undefined, false]) {
      const { container, unmount } = render(<StatTile label="Fees paid" value="0.00001 XRP" busy={busy} />);
      expect(container.firstElementChild!.hasAttribute("aria-busy")).toBe(false);
      expect(container.querySelector(".stat__value")!.textContent).toBe("0.00001 XRP");
      unmount();
    }
  });
});

describe("DataTable", () => {
  type Row = { hash: string; type: string; fee: string };
  const rows: Row[] = [
    { hash: "AAAA", type: "Payment", fee: "0.000012" },
    { hash: "BBBB", type: "OfferCreate", fee: "0.00001" },
  ];
  const columns = [
    { id: "type", header: "Type", width: "120px", cell: (r: Row) => <TypeTag type={r.type} /> },
    { id: "hash", header: "Hash", width: "minmax(100px, 1fr)", cell: (r: Row) => r.hash },
    { id: "fee", header: "Fee (XRP)", width: "90px", align: "end" as const, cell: (r: Row) => r.fee },
  ];

  it("is a table with named columns and one row per item, in the order given", () => {
    render(<DataTable label="Transactions" columns={columns} rows={rows} rowKey={(r) => r.hash} />);
    const table = screen.getByRole("table", { name: "Transactions" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Type", "Hash", "Fee (XRP)"]);
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows.map((row) => within(row).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["Payment", "AAAA", "0.000012"],
      ["OfferCreate", "BBBB", "0.00001"],
    ]);
  });

  it("lays its columns out with the widths given and aligns numbers to the end", () => {
    render(<DataTable label="Transactions" columns={columns} rows={rows} rowKey={(r) => r.hash} minWidth={640} />);
    const table = screen.getByRole("table");
    expect(table.style.getPropertyValue("--cols")).toBe("120px minmax(100px, 1fr) 90px");
    expect(table.style.minWidth).toBe("640px");
    expect(within(table).getAllByRole("columnheader")[2]!.className).toContain("is-end");
  });

  it("says so when there is nothing to show", () => {
    render(<DataTable label="Transactions" columns={columns} rows={[]} rowKey={(r) => r.hash} empty="No transactions." />);
    expect(screen.getByText("No transactions.")).toBeTruthy();
  });

  it("is in a region that a keyboard can reach and scroll, named for the table: its rows may hold nothing else to focus (axe: scrollable-region-focusable)", () => {
    render(<DataTable label="Open offers" columns={columns} rows={rows} rowKey={(r) => r.hash} minWidth={900} />);
    const region = screen.getByRole("region", { name: "Open offers, scrollable table" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.className).toContain("table-scroll");
    expect(within(region).getByRole("table", { name: "Open offers" })).toBeTruthy();
  });

  it("is that region when it is empty too, where the note is what it holds", () => {
    render(<DataTable label="Open offers" columns={columns} rows={[]} rowKey={(r) => r.hash} empty="No offers." />);
    const region = screen.getByRole("region", { name: "Open offers, scrollable table" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(within(region).getByText("No offers.")).toBeTruthy();
  });

  it("has rows of 34 px when compact, the header row among them, and none of that when it is not", () => {
    const { rerender } = render(<DataTable label="Transactions" columns={columns} rows={rows} rowKey={(r) => r.hash} />);
    expect(document.querySelectorAll(".table--compact")).toHaveLength(0);
    rerender(<DataTable label="Transactions" columns={columns} rows={rows} rowKey={(r) => r.hash} compact />);
    const table = screen.getByRole("table", { name: "Transactions" });
    expect(within(table).getAllByRole("row").map((row) => row.classList.contains("table--compact"))).toEqual([true, true, true]);
    expect(within(table).getAllByRole("row")[0]!.className).toContain("table__head");
  });

  it("scrolls up and down in a region of the height asked for, and without a cap is as it was", () => {
    const { rerender } = render(<DataTable label="Transactions" columns={columns} rows={rows} rowKey={(r) => r.hash} />);
    const region = screen.getByRole("region", { name: "Transactions, scrollable table" });
    expect(region.getAttribute("style")).toBeNull();
    expect(region.classList.contains("table-scroll--capped")).toBe(false);
    rerender(<DataTable label="Transactions" columns={columns} rows={rows} rowKey={(r) => r.hash} maxHeight={300} />);
    expect(region.style.maxHeight).toBe("300px");
    expect(region.classList.contains("table-scroll--capped")).toBe(true);
    expect(region.getAttribute("tabindex")).toBe("0");
  });

  // axe: landmark-unique. A card is a `section` named by its title, which is a region landmark, and the scroll region of a table in it
  // is one too: two regions with one name, which a screen reader's list of landmarks cannot tell apart.
  it("does not take the name of the card it is in", () => {
    render(
      <Card title="Latest ledgers">
        <DataTable label="Latest ledgers" columns={columns} rows={rows} rowKey={(r) => r.hash} />
      </Card>,
    );
    expect(screen.getAllByRole("region")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Latest ledgers" }).tagName).toBe("SECTION");
    expect(screen.getByRole("region", { name: "Latest ledgers, scrollable table" })).toBeTruthy();
    expect(screen.getAllByRole("table", { name: "Latest ledgers" })).toHaveLength(1);
  });
});

describe("Tabs", () => {
  const items = [
    { id: "transactions", label: "Transactions", href: "?tab=transactions" },
    { id: "payments", label: "Payments", href: "?tab=payments" },
    { id: "analytics", label: "Analytics", soon: true },
  ];

  it("links the tabs, marks the current one and shows a soon tab as a disabled label", () => {
    renderInRouter(<Tabs label="Account activity" items={items} current="payments" />);
    const nav = screen.getByRole("navigation", { name: "Account activity" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Transactions", "Payments"]);
    expect(links[1]!.getAttribute("aria-current")).toBe("page");
    expect(links[0]!.getAttribute("aria-current")).toBeNull();
    const soon = within(nav).getByText("Analytics").closest("[aria-disabled]")!;
    expect(soon.getAttribute("aria-disabled")).toBe("true");
    expect(soon.textContent).toContain("soon");
    expect(soon.tagName).not.toBe("A");
  });

  it("gives a link its rel, and calls its onIntent once when the pointer enters it and once when it takes the focus", () => {
    const onIntent = vi.fn();
    const withIntent = [...items.slice(0, 2), { id: "analytics", label: "Analytics", href: "?tab=analytics", rel: "nofollow", onIntent }];
    renderInRouter(<Tabs label="Account activity" items={withIntent} current="payments" />);
    const nav = screen.getByRole("navigation", { name: "Account activity" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("rel")])).toEqual([
      ["Transactions", null],
      ["Payments", null],
      ["Analytics", "nofollow"],
    ]);
    expect(onIntent).not.toHaveBeenCalled();

    fireEvent.pointerEnter(links[2]!);
    expect(onIntent).toHaveBeenCalledTimes(1);
    fireEvent.focus(links[2]!);
    expect(onIntent).toHaveBeenCalledTimes(2);
    // The other tabs have none: entering them warms nothing.
    fireEvent.pointerEnter(links[0]!);
    fireEvent.focus(links[0]!);
    expect(onIntent).toHaveBeenCalledTimes(2);
  });
});

describe("Pager", () => {
  it("links Newer and Older, and shows a missing direction as disabled", () => {
    renderInRouter(<Pager olderHref="?marker=abc" />);
    const nav = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(nav).getByRole("link", { name: /Older/ }).getAttribute("href")).toBe("/xrpl?marker=abc");
    expect(within(nav).queryByRole("link", { name: /Newer/ })).toBeNull();
    expect(within(nav).getByText(/Newer/).closest("[aria-disabled]")!.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("Breadcrumbs", () => {
  it("links the ancestors and marks the last item as the current page", () => {
    renderInRouter(
      <Breadcrumbs
        items={[
          { label: "XRPL", href: "/xrpl" },
          { label: "Ledger 107,695,660", href: "/xrpl/ledger/107695660" },
          { label: "67F91E…7C31", mono: true },
        ]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/xrpl", "/xrpl/ledger/107695660"]);
    expect(within(nav).getByText("67F91E…7C31").getAttribute("aria-current")).toBe("page");
  });
});

describe("Notice and SectionError", () => {
  it("shows a notice with an icon and its text", () => {
    const { container } = render(
      <Notice tone="warning" title="Deleted">
        This account was deleted.
      </Notice>,
    );
    expect(container.textContent).toContain("Deleted");
    expect(container.textContent).toContain("This account was deleted.");
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("announces a section that failed, and retries on the button", () => {
    const onRetry = vi.fn();
    render(<SectionError what="transactions" onRetry={onRetry} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Couldn’t load transactions");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says what it is told to, in place of the words it makes from what failed", () => {
    render(<SectionError what="AMM swaps" message="AMM swaps couldn’t be loaded." onRetry={() => {}} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("AMM swaps couldn’t be loaded.");
    expect(alert.textContent).not.toContain("Couldn’t load AMM swaps");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("disables Retry while it is retrying", () => {
    render(<SectionError what="transactions" onRetry={() => {}} retrying />);
    expect(screen.getByRole("button", { name: /Retry/ }).hasAttribute("disabled")).toBe(true);
  });
});

describe("NetworkSwitch", () => {
  it("links both networks' homes and marks the current one", () => {
    renderInRouter(<NetworkSwitch net="xahau" />);
    const group = screen.getByRole("group", { name: "Network" });
    const links = within(group).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/xrpl", "/xahau"]);
    expect(links.map((a) => a.textContent)).toEqual(["XRPL", "Xahau"]);
    expect(links[1]!.getAttribute("aria-current")).toBe("true");
    expect(links[0]!.getAttribute("aria-current")).toBeNull();
  });
});

describe("SearchBox", () => {
  it("is a GET form to /{net}/search with the query in q, so it works before JavaScript loads", () => {
    renderInRouter(<SearchBox net={XAHAU} />, "/xahau");
    const form = screen.getByRole("search");
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/xahau/search");
    const input = within(form).getByRole("searchbox", { name: /Search Xahau/ });
    expect(input.getAttribute("name")).toBe("q");
  });

  it("shows what the input looks like as you type: a ledger index", async () => {
    renderInRouter(<SearchBox net={XRPL} />);
    const input = screen.getByRole("searchbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "107695660" } });
    const hint = await screen.findByRole("link", { name: /Ledger #107,695,660/ });
    expect(hint.getAttribute("href")).toBe("/xrpl/ledger/107695660");
    expect(hint.textContent).toContain("XRPL");
  });

  it("hints an address, trimmed", async () => {
    renderInRouter(<SearchBox net={XRPL} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: `  ${ADDRESS}  ` } });
    const hint = await screen.findByRole("link", { name: /Account/ });
    expect(hint.getAttribute("href")).toBe(`/xrpl/account/${ADDRESS}`);
  });

  it("hints an X-address as its account, with the destination tag", async () => {
    renderInRouter(<SearchBox net={XRPL} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: classicAddressToXAddress(ADDRESS, 104882, false) } });
    const hint = await screen.findByRole("link", { name: /Account/ });
    expect(hint.getAttribute("href")).toBe(`/xrpl/account/${ADDRESS}?tag=104882`);
    expect(hint.textContent).toContain("104882");
  });

  it("hints a hash or a CTID by sending it to the search, which knows what exists", async () => {
    renderInRouter(<SearchBox net={XRPL} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: HASH.toLowerCase() } });
    const hash = await screen.findByRole("link", { name: /Transaction or ledger/ });
    expect(hash.getAttribute("href")).toBe(`/xrpl/search?q=${HASH}`);

    fireEvent.change(input, { target: { value: "c66b4e4c00450000" } });
    const ctid = await screen.findByRole("link", { name: /CTID/i });
    expect(ctid.getAttribute("href")).toBe("/xrpl/search?q=C66B4E4C00450000");
  });

  it("says what it can search for when the input is none of those, and shows no hints for an empty box", async () => {
    renderInRouter(<SearchBox net={XRPL} variant="hero" />);
    const input = screen.getByRole("searchbox");
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.change(input, { target: { value: "hello" } });
    await screen.findByText(/looks like that/);
    expect(screen.getByText(/looks like that/).textContent).toContain("XRPL");
    fireEvent.change(input, { target: { value: "" } });
    await waitFor(() => expect(screen.queryByText(/looks like that/)).toBeNull());
  });

  it("closes the hints when focus leaves the box or Escape is pressed, and opens them again on return", async () => {
    renderInRouter(
      <>
        <SearchBox net={XRPL} />
        <button type="button">elsewhere</button>
      </>,
    );
    const input = screen.getByRole("searchbox");
    const elsewhere = screen.getByRole("button", { name: "elsewhere" });
    const hint = () => screen.queryByRole("link", { name: /Ledger #107,695,660/ });

    act(() => input.focus());
    fireEvent.change(input, { target: { value: "107695660" } });
    await screen.findByRole("link", { name: /Ledger #107,695,660/ });

    act(() => elsewhere.focus());
    expect(hint()).toBeNull();
    act(() => input.focus());
    expect(hint()).not.toBeNull();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(hint()).toBeNull();
    fireEvent.change(input, { target: { value: "107695661" } });
    await screen.findByRole("link", { name: /Ledger #107,695,661/ });
  });

  it("keeps focus in the box when a hint is pressed, so the press is not lost to the hints closing", async () => {
    renderInRouter(<SearchBox net={XRPL} />);
    const input = screen.getByRole("searchbox");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "107695660" } });
    const hint = await screen.findByRole("link", { name: /Ledger #107,695,660/ });
    expect(fireEvent.mouseDown(hint)).toBe(false); // default prevented: no blur
  });

  it("closes the hints once a hint was followed or the form was submitted", async () => {
    renderInRouter(<SearchBox net={XRPL} />);
    const input = screen.getByRole("searchbox");
    const hint = () => screen.queryByRole("link", { name: /Ledger #107,695,660/ });

    act(() => input.focus());
    fireEvent.change(input, { target: { value: "107695660" } });
    fireEvent.click(await screen.findByRole("link", { name: /Ledger #107,695,660/ }));
    expect(hint()).toBeNull();
    expect(document.activeElement).not.toBe(input);

    act(() => input.focus());
    expect(hint()).not.toBeNull();
    fireEvent.submit(screen.getByRole("search"));
    expect(hint()).toBeNull();
  });

  it("is focused by / from anywhere on the page", () => {
    renderInRouter(<SearchBox net={XRPL} />);
    const input = screen.getByRole("searchbox");
    expect(document.activeElement).not.toBe(input);
    const press = fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(input);
    expect(press).toBe(false); // preventDefault: the slash is not typed into the box
  });

  it("is not focused by / while another field has focus, and the slash is typed there", () => {
    renderInRouter(
      <>
        <label>
          Other
          <input aria-label="Other" />
        </label>
        <textarea aria-label="Notes" />
        <SearchBox net={XRPL} />
      </>,
    );
    const search = screen.getByRole("searchbox");
    for (const field of [screen.getByLabelText("Other"), screen.getByLabelText("Notes")]) {
      field.focus();
      const press = fireEvent.keyDown(field, { key: "/" });
      expect(document.activeElement).toBe(field);
      expect(document.activeElement).not.toBe(search);
      expect(press).toBe(true); // not prevented
    }
  });

  it("ignores / with a modifier, and while an IME composes", () => {
    renderInRouter(<SearchBox net={XRPL} />);
    const input = screen.getByRole("searchbox");
    fireEvent.keyDown(document.body, { key: "/", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "/", metaKey: true });
    fireEvent.keyDown(document.body, { key: "/", isComposing: true });
    expect(document.activeElement).not.toBe(input);
  });

  it("leaves / alone when it was told not to claim it (a second box on the page)", () => {
    renderInRouter(<SearchBox net={XRPL} shortcut={false} />);
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).not.toBe(screen.getByRole("searchbox"));
  });

  it("shows the / key as a hint in the header and a Search button in the hero", () => {
    const { unmount } = renderInRouter(<SearchBox net={XRPL} variant="header" />);
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
    expect(document.querySelector(".search__key")!.textContent).toBe("/");
    unmount();
    renderInRouter(<SearchBox net={XRPL} variant="hero" />);
    expect(screen.getByRole("button", { name: "Search" }).getAttribute("type")).toBe("submit");
  });

  it("starts with the query it was given", () => {
    renderInRouter(<SearchBox net={XRPL} initialQuery="hello" />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("hello");
  });
});

describe("ThemeToggle", () => {
  it("renders the same markup for every visitor (the cached HTML is shared)", () => {
    const plain = renderToString(<ThemeToggle />);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    document.documentElement.dataset.theme = "dark";
    expect(renderToString(<ThemeToggle />)).toBe(plain);
    expect(plain).not.toContain("aria-pressed");
  });

  it("switches to dark from light, applies it to the page and remembers it", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "Dark theme" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("starts from the system theme when the visitor has not chosen", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "Dark theme" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("still switches when storage is blocked", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("Header and Shell", () => {
  it("puts a network's accent on everything under it, and links the switch to the other network's home", () => {
    const { container } = renderInRouter(
      <Shell net={XAHAU}>
        <p>page</p>
      </Shell>,
      "/xahau",
    );
    const shell = container.querySelector("[data-net]")!;
    expect(shell.getAttribute("data-net")).toBe("xahau");
    const header = within(shell as HTMLElement).getByRole("banner");
    const switchLinks = within(within(header).getByRole("group", { name: "Network" })).getAllByRole("link");
    expect(switchLinks.map((a) => a.getAttribute("href"))).toEqual(["/xrpl", "/xahau"]);
    expect(header.querySelector("form")!.getAttribute("action")).toBe("/xahau/search");
  });

  describe("the navigation", () => {
    /** The header at `path`, under a route whose `handle` is the one given: how a page says which section of the header it is in. */
    function renderHeaderAt(path: string, handle?: NetworkRouteHandle, net: typeof XRPL | typeof XAHAU = XRPL) {
      const router = createMemoryRouter([{ path: "*", element: <Header net={net} />, handle }], { initialEntries: [path] });
      render(<RouterProvider router={router} />);
      return within(screen.getByRole("navigation", { name: "Main" }));
    }

    /** The header as the `/:net` layout renders it, with the layout's data holding every switch on, or every one off. */
    async function renderHeaderWithLayout(on: boolean) {
      return renderHeaderWithFeatures(featuresOf(Object.fromEntries(FEATURE_VARS.map((name) => [name, on ? "on" : "off"]))));
    }

    /**
     * The header under the `/:net` layout whose data holds `features`, at `path`, on a page whose route has `handle`: the layout route
     * carries the switches, its child (the index, and `*` for any deeper path) the page and the section it names.
     */
    async function renderHeaderWithFeatures(features: Features, path = "/xrpl", handle?: NetworkRouteHandle) {
      const page = { element: <Header net={XRPL} />, handle };
      const router = createMemoryRouter(
        [
          {
            id: NETWORK_ROUTE_ID,
            path: "/:net",
            loader: () => ({ network: { ...XRPL, features } }),
            element: <Outlet />,
            children: [{ index: true, ...page }, { path: "*", ...page }],
          },
        ],
        { initialEntries: [path] },
      );
      render(<RouterProvider router={router} />);
      return within(await screen.findByRole("navigation", { name: "Main" }));
    }

    function expectSoon(nav: ReturnType<typeof within>, label: string) {
      const item = nav.getByText(label).closest(".nav-item")!;
      expect(item.classList.contains("is-soon")).toBe(true);
      expect(item.tagName).not.toBe("A");
      expect(item.getAttribute("aria-disabled")).toBe("true");
      expect(item.textContent).toContain("soon");
      expect(nav.queryByRole("link", { name: new RegExp(`^${label}`) })).toBeNull();
    }

    it("links Network to the network page and marks it as the current page there", () => {
      const nav = renderHeaderAt("/xrpl/network", { navSection: "network" });
      const link = nav.getByRole("link", { name: "Network" });
      expect(link.getAttribute("href")).toBe("/xrpl/network");
      expect(link.getAttribute("aria-current")).toBe("page");
      expect(link.classList.contains("is-current")).toBe(true);
      expect(link.classList.contains("is-soon")).toBe(false);
    });

    it("links Network to the page of the network the header is on", () => {
      const nav = renderHeaderAt("/xahau/network", { navSection: "network" }, XAHAU);
      expect(nav.getByRole("link", { name: "Network" }).getAttribute("href")).toBe("/xahau/network");
    });

    it("keeps the network page current under any query", () => {
      const nav = renderHeaderAt("/xrpl/network?period=1y", { navSection: "network" });
      const link = nav.getByRole("link", { name: "Network" });
      expect(link.getAttribute("aria-current")).toBe("page");
      expect(link.classList.contains("is-current")).toBe(true);
    });

    it('names the section on its other pages with aria-current="true"', () => {
      const nav = renderHeaderAt("/xrpl/validators", { navSection: "network" });
      const link = nav.getByRole("link", { name: "Network" });
      expect(link.getAttribute("href")).toBe("/xrpl/network");
      expect(link.getAttribute("aria-current")).toBe("true");
      expect(link.classList.contains("is-current")).toBe(true);
    });

    it("leaves Network a plain link on a page that names no section", () => {
      const nav = renderHeaderAt("/xrpl/ledger/1");
      const link = nav.getByRole("link", { name: "Network" });
      expect(link.getAttribute("href")).toBe("/xrpl/network");
      expect(link.hasAttribute("aria-current")).toBe(false);
      expect(link.classList.contains("is-current")).toBe(false);
    });

    it("takes the section from a parent route when the deepest route names none", () => {
      const router = createMemoryRouter(
        [
          {
            path: "/xrpl",
            handle: { navSection: "network" } satisfies NetworkRouteHandle,
            element: (
              <>
                <Header net={XRPL} />
                <Outlet />
              </>
            ),
            children: [{ path: "deeper", element: <p>deeper</p>, handle: { heroSearch: false } satisfies NetworkRouteHandle }],
          },
        ],
        { initialEntries: ["/xrpl/deeper"] },
      );
      render(<RouterProvider router={router} />);
      const link = within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Network" });
      expect(link.classList.contains("is-current")).toBe(true);
      expect(link.getAttribute("aria-current")).toBe("true");
    });

    it("marks no section by the path alone: a route has to say so", () => {
      const nav = renderHeaderAt("/xrpl/network");
      const link = nav.getByRole("link", { name: "Network" });
      expect(link.hasAttribute("aria-current")).toBe(false);
      expect(link.classList.contains("is-current")).toBe(false);
    });

    it("keeps the hrefs of Ledgers and Transactions, and marks neither as current", () => {
      const nav = renderHeaderAt("/xrpl/network", { navSection: "network" });
      const ledgers = nav.getByRole("link", { name: "Ledgers" });
      const transactions = nav.getByRole("link", { name: "Transactions" });
      expect(ledgers.getAttribute("href")).toBe(`/xrpl#${LATEST_LEDGERS_ID}`);
      expect(transactions.getAttribute("href")).toBe(`/xrpl#${LATEST_TRANSACTIONS_ID}`);
      for (const link of [ledgers, transactions]) {
        expect(link.hasAttribute("aria-current")).toBe(false);
        expect(link.classList.contains("is-current")).toBe(false);
      }
    });

    // Markets (E3) leads to the markets page while MARKETS is on; AMM is still a later sub-project's label.
    it("shows Markets and AMM as labels with a soon tag, not as links, without the layout's data (every switch off)", () => {
      const nav = renderHeaderAt("/xrpl");
      expectSoon(nav, "Markets");
      expectSoon(nav, "AMM");
    });

    it("shows Markets as a label with a soon tag with every switch off in the layout's data, and AMM too", async () => {
      const nav = await renderHeaderWithLayout(false);
      expectSoon(nav, "Markets");
      expectSoon(nav, "AMM");
    });

    it("links Markets to the markets page of the network, with every switch on, while AMM is still a label with a soon tag", async () => {
      const nav = await renderHeaderWithLayout(true);
      const link = nav.getByRole("link", { name: "Markets" });
      expect(link.getAttribute("href")).toBe("/xrpl/markets");
      expect(link.classList.contains("is-soon")).toBe(false);
      expect(link.hasAttribute("aria-disabled")).toBe(false);
      expect(link.textContent).not.toContain("soon");
      expectSoon(nav, "AMM");
    });

    it("shows Markets as a label with a soon tag while MARKETS is off, whatever the other switches are", async () => {
      expectSoon(await renderHeaderWithFeatures({ ...featuresOf(allSwitches("on")), markets: false }), "Markets");
      cleanup();
      expectSoon(await renderHeaderWithFeatures({ ...NO_FEATURES, validators: true, ammData: true }), "Markets");
    });

    it("links Markets while only MARKETS is on", async () => {
      const nav = await renderHeaderWithFeatures({ ...NO_FEATURES, markets: true });
      expect(nav.getByRole("link", { name: "Markets" }).getAttribute("href")).toBe("/xrpl/markets");
    });

    it("keeps Markets current on the markets page under any query", async () => {
      const nav = await renderHeaderWithFeatures(featuresOf(allSwitches("on")), "/xrpl/markets?period=7d", { navSection: "markets" });
      const link = nav.getByRole("link", { name: "Markets" });
      expect(link.getAttribute("href")).toBe("/xrpl/markets");
      expect(link.getAttribute("aria-current")).toBe("page");
      expect(link.classList.contains("is-current")).toBe(true);
      // The section is Markets alone: Network is not current.
      const network = nav.getByRole("link", { name: "Network" });
      expect(network.hasAttribute("aria-current")).toBe(false);
      expect(network.classList.contains("is-current")).toBe(false);
    });

    it('names the markets section on a pair page with aria-current="true"', async () => {
      const nav = await renderHeaderWithFeatures(
        featuresOf(allSwitches("on")),
        "/xrpl/markets/XRP/RLUSD.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
        { navSection: "markets" },
      );
      const link = nav.getByRole("link", { name: "Markets" });
      expect(link.getAttribute("aria-current")).toBe("true");
      expect(link.classList.contains("is-current")).toBe(true);
    });

    it("leaves Markets a plain link on a page that names no section, and on the network page", async () => {
      const elsewhere = await renderHeaderWithFeatures(featuresOf(allSwitches("on")), "/xrpl/markets");
      const link = elsewhere.getByRole("link", { name: "Markets" });
      expect(link.hasAttribute("aria-current")).toBe(false);
      expect(link.classList.contains("is-current")).toBe(false);
      cleanup();
      const network = await renderHeaderWithFeatures(featuresOf(allSwitches("on")), "/xrpl/network", { navSection: "network" });
      const markets = network.getByRole("link", { name: "Markets" });
      expect(markets.hasAttribute("aria-current")).toBe(false);
      expect(markets.classList.contains("is-current")).toBe(false);
      expect(network.getByRole("link", { name: "Network" }).getAttribute("aria-current")).toBe("page");
    });

    it("marks nothing current on a markets page while MARKETS is off (the item is a label)", async () => {
      const nav = await renderHeaderWithFeatures({ ...featuresOf(allSwitches("on")), markets: false }, "/xrpl/markets", { navSection: "markets" });
      expectSoon(nav, "Markets");
      expect(nav.getByRole("link", { name: "Network" }).hasAttribute("aria-current")).toBe(false);
    });

    it("links Markets to the page of the network the header is on", async () => {
      const router = createMemoryRouter(
        [
          {
            id: NETWORK_ROUTE_ID,
            path: "/:net",
            loader: () => ({ network: { ...XAHAU, features: featuresOf(allSwitches("on")) } }),
            element: <Header net={XAHAU} />,
          },
        ],
        { initialEntries: ["/xahau"] },
      );
      render(<RouterProvider router={router} />);
      const nav = within(await screen.findByRole("navigation", { name: "Main" }));
      expect(nav.getByRole("link", { name: "Markets" }).getAttribute("href")).toBe("/xahau/markets");
    });

    it("shows AMM as a label with a soon tag, not as a link, without the layout's data and with every switch on", async () => {
      expectSoon(renderHeaderAt("/xrpl"), "AMM");
      cleanup();
      expectSoon(await renderHeaderWithLayout(true), "AMM");
    });

    it("links Network with every switch off, since it has none", async () => {
      const nav = await renderHeaderWithLayout(false);
      expect(nav.getByRole("link", { name: "Network" }).getAttribute("href")).toBe("/xrpl/network");
    });
  });

  describe("navSectionOf", () => {
    const match = (handle: unknown): UIMatch => ({ id: "route", pathname: "/", params: {}, loaderData: undefined, handle });

    it("is undefined without matches", () => {
      expect(navSectionOf([])).toBeUndefined();
    });

    it("is undefined when no match names a section, whatever its handle is", () => {
      expect(navSectionOf([match(undefined), match(null), match("network"), match({}), match({ heroSearch: true })])).toBeUndefined();
    });

    it("is the section of the deepest match that names one", () => {
      expect(navSectionOf([match({ navSection: "network" }), match(undefined), match({ heroSearch: true })])).toBe("network");
      expect(navSectionOf([match(undefined), match({ navSection: "network" })])).toBe("network");
      // Two different names (the second is a later sub-project's), so that the order shows.
      expect(navSectionOf([match({ navSection: "network" }), match({ navSection: "markets" })])).toBe("markets");
      expect(navSectionOf([match({ navSection: "markets" }), match({ navSection: "network" })])).toBe("network");
    });
  });

  it("can leave the search out (the home page has its own)", () => {
    renderInRouter(<Header net={XRPL} search={false} />);
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("links the logo to the network's home, under the product's name", () => {
    renderInRouter(<Header net={XAHAU} />);
    const home = screen.getByRole("link", { name: new RegExp(`${PRODUCT_NAME} home`, "i") });
    expect(home.getAttribute("href")).toBe("/xahau");
  });

  it("opens and closes the menu on phones with a real button", () => {
    renderInRouter(<Header net={XRPL} />);
    const menu = screen.getByRole("button", { name: "Menu" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });

  it("has a skip link to the main content", () => {
    const { container } = renderInRouter(
      <Shell net={XRPL}>
        <p>page</p>
      </Shell>,
    );
    const skip = container.querySelector("a.skip-link")!;
    expect(skip.getAttribute("href")).toBe("#main");
    expect(container.querySelector("main#main")).not.toBeNull();
  });
});

describe("Footer", () => {
  it("carries the product name and the GateHub credit", () => {
    render(<Footer />);
    const footer = screen.getByRole("contentinfo");
    expect(footer.textContent).toContain(PRODUCT_NAME);
    expect(footer.textContent).toContain("by GateHub");
  });
});

describe("StatGrid and DetailList", () => {
  it("names the row of tiles", () => {
    render(
      <StatGrid label="Network at a glance">
        <StatTile label="Total supply" value="99,985,312,446 XRP" />
      </StatGrid>,
    );
    expect(within(screen.getByRole("region", { name: "Network at a glance" })).getByText("Total supply")).toBeTruthy();
  });

  it("is the home page's grid unless it is narrow", () => {
    const { container } = render(
      <StatGrid label="Network at a glance">
        <StatTile label="Total supply" value="99,985,312,446 XRP" />
      </StatGrid>,
    );
    expect(container.firstElementChild!.className).toBe("stat-grid");
  });

  it("is narrow for tiles of a figure each: more of them in a row", () => {
    const { container } = render(
      <StatGrid label="Totals" narrow>
        <StatTile figure label="Transactions" value="45.5M" />
      </StatGrid>,
    );
    expect(container.firstElementChild!.className).toBe("stat-grid stat-grid--narrow");
    expect(screen.getByRole("region", { name: "Totals" })).toBe(container.firstElementChild);
  });

  it("lists labels and values as a description list", () => {
    const { container } = render(
      <DetailList
        rows={[
          { label: "Closed", value: "2026-10-17 15:42:51 UTC" },
          { label: "Fees burned", value: <Amount value="0.001284" currency="XRP" /> },
        ]}
      />,
    );
    expect([...container.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Closed", "Fees burned"]);
    expect([...container.querySelectorAll("dd")].map((dd) => dd.textContent)).toEqual(["2026-10-17 15:42:51 UTC", "0.001284 XRP"]);
  });
});

describe("useNetwork", () => {
  function Probe() {
    const network = useNetwork();
    return <p>{`${network.name} ${network.native} ${network.ctidNetworkId}`}</p>;
  }

  it("gives the network the /:net layout loaded", async () => {
    const router = createMemoryRouter(
      [{ id: "routes/net", path: "/:net", loader: () => ({ network: XAHAU }), element: <Probe /> }],
      { initialEntries: ["/xahau"] },
    );
    render(<RouterProvider router={router} />);
    expect((await screen.findByText(/Xahau/)).textContent).toBe("Xahau XAH 21337");
  });

  it("says what is missing when used outside the layout", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const router = createMemoryRouter([{ path: "*", element: <Probe />, ErrorBoundary: () => <p>no layout</p> }]);
    render(<RouterProvider router={router} />);
    expect(screen.getByText("no layout")).toBeTruthy();
  });
});

describe("NotFoundPage", () => {
  it("says what was not found on which network, offers the search box and a way home", () => {
    renderInRouter(<NotFoundPage net={XAHAU} what="ledger 99999999999" />, "/xahau");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Not found");
    expect(screen.getByText(/We couldn.t find ledger 99999999999 on Xahau/)).toBeTruthy();
    expect(screen.getByRole("searchbox").closest("form")!.getAttribute("action")).toBe("/xahau/search");
    expect(screen.getByRole("link", { name: /Xahau home/ }).getAttribute("href")).toBe("/xahau");
  });

  it("is not a second search landmark next to the header's (two of the same name fail an accessibility check)", () => {
    renderInRouter(
      <Shell net={XRPL}>
        <NotFoundPage net={XRPL} what="x" />
      </Shell>,
    );
    expect(screen.getAllByRole("search")).toHaveLength(1);
    expect(screen.getAllByRole("searchbox")).toHaveLength(2);
  });

  it("puts what was typed back in the search box", () => {
    renderInRouter(<NotFoundPage net={XRPL} what="transaction X" query={HASH} />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(HASH);
  });

  it("takes a title, a message of its own and a suggestion (a link to the same search on the other network)", () => {
    renderInRouter(
      <NotFoundPage
        net={XRPL}
        title="Address not activated"
        message="This address has never been activated."
        suggestion={{ href: `/xahau/search?q=${HASH}`, label: "Search on Xahau" }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Address not activated");
    expect(screen.getByText("This address has never been activated.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Search on Xahau" }).getAttribute("href")).toBe(`/xahau/search?q=${HASH}`);
  });

  it("does not claim the / key from the header's search box", () => {
    renderInRouter(<NotFoundPage net={XRPL} what="x" />);
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).not.toBe(screen.getByRole("searchbox"));
  });
});

describe("RouteErrorScreen", () => {
  const response = (status: number, data: unknown) => ({ status, statusText: String(status), internal: false, data });

  it("shows a 404 that a loader threw with what was not found", () => {
    renderInRouter(<RouteErrorScreen error={response(404, { notFound: "ledger 99" })} net={XRPL} />);
    expect(screen.getByText(/We couldn.t find ledger 99 on XRPL/)).toBeTruthy();
  });

  it("offers the same search on the other network when the loader threw the offer with the 404", () => {
    const suggestion = { href: `/xahau/search?q=${HASH}`, label: "Search on Xahau" };
    renderInRouter(<RouteErrorScreen error={response(404, { notFound: "ledger 67F91E…7C31", suggestion })} net={XRPL} />);
    expect(screen.getByText(/We couldn.t find ledger 67F91E…7C31 on XRPL/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Search on Xahau" }).getAttribute("href")).toBe(`/xahau/search?q=${HASH}`);
  });

  it.each([
    ["an address on another site", { href: "https://example.com/x", label: "Search on Xahau" }],
    ["a protocol-relative address", { href: "//example.com/x", label: "Search on Xahau" }],
    ["a script", { href: "javascript:alert(1)", label: "Search on Xahau" }],
    ["no label", { href: "/xahau/search?q=1" }],
    ["a label that is not text", { href: "/xahau/search?q=1", label: 5 }],
    ["nothing but text", "/xahau/search?q=1"],
  ])("leaves out an offer that is %s", (_what, suggestion) => {
    renderInRouter(<RouteErrorScreen error={response(404, { notFound: "ledger 99", suggestion })} net={XRPL} />);
    expect(screen.getByText(/We couldn.t find ledger 99 on XRPL/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Search on|Xahau/ })).toBeNull();
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).not.toContain("https://example.com/x");
  });

  it("shows any other 404 as a page that does not exist", () => {
    renderInRouter(<RouteErrorScreen error={response(404, "Not Found")} net={XRPL} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Page not found");
  });

  it("says a network that does not exist is not one, without blaming XRPL", () => {
    renderInRouter(<RouteErrorScreen error={response(404, { notFound: 'network "doge"' })} net={XRPL} unknownNetwork="doge" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Network not found");
    expect(screen.getByText(/There is no network called .doge./)).toBeTruthy();
    expect(screen.queryByText(/on XRPL/)).toBeNull();
  });

  it("shows a 503 as temporarily unavailable, with a way to try again", () => {
    renderInRouter(<RouteErrorScreen error={response(503, { unavailable: "ledger 99" })} net={XRPL} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Temporarily unavailable");
    expect(screen.getByRole("link", { name: "Try again" })).toBeTruthy();
  });

  // A client-side navigation over the visitor limit gets the entry's 429 page for its `.data` URL. It has no X-Remix-Response, so React Router
  // throws an ErrorResponse(429, ..., the page's text): headers are gone, so the wait travels in the page (a meta tag the entry writes).
  describe("a 429, the visitor being over the limit", () => {
    const limitedPage = (seconds: number) =>
      `<!doctype html><html><head><meta name="robots" content="noindex"><meta name="retry-after" content="${seconds}"><title>Too many requests</title></head><body></body></html>`;

    it("says so, and to try again in a moment, instead of that something went wrong", () => {
      renderInRouter(<RouteErrorScreen error={response(429, "Too Many Requests")} net={XRPL} />);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Too many requests");
      expect(screen.getByText(/Try again in a moment/)).toBeTruthy();
      expect(document.body.textContent).not.toContain("Something went wrong");
      expect(screen.getByRole("link", { name: "Try again" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Go to the XRPL home" }).getAttribute("href")).toBe("/xrpl");
    });

    it("names the wait when the entry's page does", () => {
      renderInRouter(<RouteErrorScreen error={response(429, limitedPage(10))} net={XRPL} />);
      expect(screen.getByText(/Try again in 10 seconds/)).toBeTruthy();
      expect(document.body.textContent).not.toContain("Try again in a moment");
    });

    it("names the wait of a thrown 429 that carries one, and says 1 second in the singular", () => {
      const first = renderInRouter(<RouteErrorScreen error={response(429, { retryAfter: 30 })} net={XRPL} />);
      expect(screen.getByText(/Try again in 30 seconds/)).toBeTruthy();
      first.unmount();
      renderInRouter(<RouteErrorScreen error={response(429, { retryAfter: 1 })} net={XRPL} />);
      expect(screen.getByText(/Try again in 1 second\./)).toBeTruthy();
    });

    it.each([0, -3, 2.5, 100_000, Number.NaN, "10", null, undefined])("does not take %j for a wait, and says a moment", (value) => {
      renderInRouter(<RouteErrorScreen error={response(429, { retryAfter: value })} net={XRPL} />);
      expect(screen.getByText(/Try again in a moment/)).toBeTruthy();
    });

    it("does not take a wait from text that only looks like one", () => {
      renderInRouter(<RouteErrorScreen error={response(429, '<p>retry-after: 10</p><meta name="retry-after" content="0">')} net={XRPL} />);
      expect(screen.getByText(/Try again in a moment/)).toBeTruthy();
    });

    it("titles the page for the tab and keeps it out of the index", () => {
      const tags = errorMeta(response(429, "x"));
      expect(tags).toContainEqual({ title: `Too many requests · ${PRODUCT_NAME}` });
      expect(tags).toContainEqual({ name: "robots", content: "noindex" });
    });
  });

  it("shows anything else as something that went wrong, without the message of the error", () => {
    renderInRouter(<RouteErrorScreen error={new Error("secret internal detail")} net={XRPL} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Something went wrong");
    expect(document.body.textContent).not.toContain("secret internal detail");
  });
});
