import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { classicAddressToXAddress } from "ripple-address-codec";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Segment } from "../../domain/describe";
import { shortAddress, shortHash } from "../../domain/format";
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
import { RouteErrorScreen } from "../pages/RouteErrorScreen";
import { useNetwork } from "../use-network";
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

  it("is in a region that a keyboard can reach and scroll, named like the table: its rows may hold nothing else to focus (axe: scrollable-region-focusable)", () => {
    render(<DataTable label="Open offers" columns={columns} rows={rows} rowKey={(r) => r.hash} minWidth={900} />);
    const region = screen.getByRole("region", { name: "Open offers" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.className).toContain("table-scroll");
    expect(within(region).getByRole("table", { name: "Open offers" })).toBeTruthy();
  });

  it("is that region when it is empty too, where the note is what it holds", () => {
    render(<DataTable label="Open offers" columns={columns} rows={[]} rowKey={(r) => r.hash} empty="No offers." />);
    const region = screen.getByRole("region", { name: "Open offers" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(within(region).getByText("No offers.")).toBeTruthy();
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

  it("shows Network, Markets and AMM as labels with a soon tag, not as links", () => {
    renderInRouter(<Header net={XRPL} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    for (const label of ["Network", "Markets", "AMM"]) {
      const item = within(nav).getByText(label);
      expect(item.closest("a")).toBeNull();
      expect(item.closest("li")!.textContent).toContain("soon");
    }
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).not.toContain("Network");
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

  it("shows anything else as something that went wrong, without the message of the error", () => {
    renderInRouter(<RouteErrorScreen error={new Error("secret internal detail")} net={XRPL} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Something went wrong");
    expect(document.body.textContent).not.toContain("secret internal detail");
  });
});
