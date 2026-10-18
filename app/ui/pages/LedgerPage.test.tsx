import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LedgerPageData, LedgerRow } from "../../server/ledger-view";
import { FIRST_ROWS, LedgerPage } from "./LedgerPage";

const XRPL = { id: "xrpl", name: "XRPL", native: "XRP" } as const;
const ALICE = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";
const BOB = "rNYbL8WZKKNNni5rb2MzcxnAEgkQC5Kq5";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderInRouter(ui: ReactElement) {
  const router = createMemoryRouter([{ path: "*", element: ui }], { initialEntries: ["/xrpl/ledger/107720688"] });
  return render(<RouterProvider router={router} />);
}

const hashOf = (i: number) => (i + 1).toString(16).toUpperCase().padStart(64, "0");

function row(i: number, type: string, code = "tesSUCCESS"): LedgerRow {
  return {
    index: i,
    type,
    hash: hashOf(i),
    account: ALICE,
    what: [
      { t: "text", v: code === "tesSUCCESS" ? "Sent " : "Tried to send " },
      { t: "amount", value: "5", currency: "XRP" },
      { t: "text", v: " to " },
      { t: "account", v: BOB },
    ],
    ok: code === "tesSUCCESS",
    code,
    fee: "0.00001",
  };
}

/** A ledger whose transactions have the given types, in this order, and whose failures are the `failed` positions. */
function ledger(types: string[], failed: number[] = [], extra: Partial<LedgerPageData> = {}): LedgerPageData {
  const rows = types.map((type, i) => row(i, type, failed.includes(i) ? "tecPATH_DRY" : "tesSUCCESS"));
  const counts = new Map<string, number>();
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
  return {
    origin: "index",
    header: {
      index: 107720688,
      hash: "11EF780A54D66662233920C6318B19D60DAD5F644E687AAEC0F829B82142BC02",
      parentHash: "1B116BF6AAB5938BFCF58E5F64DA46B691E3420D6EBEEA25EAE1017766147200",
      closeTime: 1792253462,
      resolution: 10,
      supply: "99985590049.656326",
      accountHash: "CD13165529B32B4151F059707674853F484467D0E06EC6C4A9DF658C32D68B4B",
      transactionHash: "C70DCCA6D031A318EEAD867B202F7AC8BD463FDA3A865C924882561785EF6694",
    },
    hasNext: true,
    txCount: rows.length,
    succeeded: rows.length - failed.length,
    failures: failed.length ? [{ code: "tecPATH_DRY", count: failed.length }] : [],
    types: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type, count]) => ({ type, count })),
    accountsCreated: [],
    fees: rows.length ? { total: "0.0001", min: "0.00001", max: "0.00001" } : null,
    rows,
    raw: '{\n  "ledger_index": 107720688\n}',
    ...extra,
  };
}

/** The rows of the transactions table, without its header. */
function tableRows() {
  const table = screen.getByRole("table", { name: "Transactions" });
  return within(table).getAllByRole("row").slice(1);
}

const pressed = () => screen.getAllByRole("button").filter((button) => button.getAttribute("aria-pressed") === "true");

describe("LedgerPage: show all", () => {
  it("shows the first 100 rows and a 'Show all' button that shows the rest without asking for anything", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    renderInRouter(<LedgerPage network={XRPL} data={ledger(Array.from({ length: 1500 }, () => "OfferCreate"))} />);

    expect(FIRST_ROWS).toBe(100);
    expect(tableRows()).toHaveLength(100);
    expect(screen.getByText("Showing 100 of 1,500, in ledger order")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show all 1,500" }));
    expect(tableRows()).toHaveLength(1500);
    expect(screen.getByText("Showing 1,500 of 1,500, in ledger order")).toBeTruthy();
    // Nothing was fetched, and the button can take the extra rows away again, so that focus has somewhere to stay.
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show first 100" }));
    expect(tableRows()).toHaveLength(100);
  });

  it("has no button for a ledger of 100 transactions or fewer", () => {
    renderInRouter(<LedgerPage network={XRPL} data={ledger(Array.from({ length: 100 }, () => "Payment"))} />);
    expect(tableRows()).toHaveLength(100);
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
    expect(screen.getByText("Showing 100 of 100, in ledger order")).toBeTruthy();
  });

  it("lists the rows in the order of the ledger, with their position", () => {
    renderInRouter(<LedgerPage network={XRPL} data={ledger(["Payment", "OfferCreate", "TrustSet"])} />);
    const positions = tableRows().map((r) => within(r).getAllByRole("cell")[0]!.textContent);
    expect(positions).toEqual(["0", "1", "2"]);
  });
});

describe("LedgerPage: filter by type", () => {
  const types = [
    ...Array.from({ length: 5 }, () => "Payment"),
    ...Array.from({ length: 3 }, () => "OfferCreate"),
    "TrustSet",
    "TrustSet",
    "AccountSet",
  ];

  it("starts with All, and a button per type with its count", () => {
    renderInRouter(<LedgerPage network={XRPL} data={ledger(types)} />);
    const buttons = within(screen.getByRole("group", { name: "Filter by type" })).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["All 11", "Payment 5", "OfferCreate 3", "TrustSet 2", "AccountSet 1"]);
    expect(pressed().map((button) => button.textContent)).toEqual(["All 11"]);
    expect(tableRows()).toHaveLength(11);
  });

  it("shows only the rows of the type pressed, in their order, and says how many", () => {
    renderInRouter(<LedgerPage network={XRPL} data={ledger(types)} />);
    fireEvent.click(screen.getByRole("button", { name: /^TrustSet/ }));
    expect(pressed().map((button) => button.textContent)).toEqual(["TrustSet 2"]);
    const rows = tableRows();
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(within(r).getAllByRole("cell")[1]!.textContent).toBe("TrustSet");
    expect(screen.getByText("Showing 2 of 2, in ledger order")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(tableRows()).toHaveLength(11);
  });

  it("filters the whole ledger, not only the rows on show", () => {
    const many = [...Array.from({ length: 150 }, () => "OfferCreate"), "Payment", "Payment"];
    renderInRouter(<LedgerPage network={XRPL} data={ledger(many)} />);
    expect(tableRows()).toHaveLength(100);
    // The two payments are at the end of the ledger, beyond the 100 on show.
    fireEvent.click(screen.getByRole("button", { name: /^Payment/ }));
    expect(tableRows()).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
  });

  it("groups the rarest types in 'Other' when there are more than seven", () => {
    const kinds = ["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8", "I9"];
    // A1 has 9 transactions, B2 8, ... I9 1: the commonest seven get a button, H8 (2) and I9 (1) share Other.
    const rowsOf = kinds.flatMap((type, i) => Array.from({ length: 9 - i }, () => type));
    renderInRouter(<LedgerPage network={XRPL} data={ledger(rowsOf)} />);
    const buttons = within(screen.getByRole("group", { name: "Filter by type" })).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["All 45", "A1 9", "B2 8", "C3 7", "D4 6", "E5 5", "F6 4", "G7 3", "Other 3"]);
    fireEvent.click(screen.getByRole("button", { name: /^Other/ }));
    const shown = tableRows().map((r) => within(r).getAllByRole("cell")[1]!.textContent);
    expect(shown.sort()).toEqual(["H8", "H8", "I9"]);
  });

  it("has no filter for a ledger without transactions", () => {
    renderInRouter(<LedgerPage network={XRPL} data={ledger([])} />);
    expect(screen.queryByRole("group", { name: "Filter by type" })).toBeNull();
    expect(screen.getByText("No transactions in this ledger.")).toBeTruthy();
    expect(screen.queryByText(/^Showing/)).toBeNull();
  });
});

describe("LedgerPage: from one ledger to the next", () => {
  /** The same page for another ledger, as React Router leaves it when only `:id` changes: the component is reused. */
  const another = (types: string[], hash: string, index: number): LedgerPageData => {
    const data = ledger(types);
    return { ...data, header: { ...data.header, hash, index } };
  };
  const next = another(Array.from({ length: 300 }, () => "TrustSet"), "AB".repeat(32), 107720689);

  it("starts the next ledger on All and the first 100 rows, whatever was chosen on the one before", () => {
    const first = ledger([...Array.from({ length: 250 }, () => "OfferCreate"), "Payment", "Payment", "Payment"]);
    const view = (data: LedgerPageData) => (
      <MemoryRouter>
        <LedgerPage network={XRPL} data={data} />
      </MemoryRouter>
    );
    const { rerender } = render(view(first));
    fireEvent.click(screen.getByRole("button", { name: "Show all 253" }));
    fireEvent.click(screen.getByRole("button", { name: /^Payment/ }));
    expect(pressed().map((button) => button.textContent)).toEqual(["Payment 3"]);
    expect(tableRows()).toHaveLength(3);

    // Next ledger: it has no Payment button at all.
    rerender(view(next));
    expect(pressed().map((button) => button.textContent)).toEqual(["All 300"]);
    expect(tableRows()).toHaveLength(FIRST_ROWS);
    expect(screen.getByText("Showing 100 of 300, in ledger order")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show all 300" })).toBeTruthy();
  });

  it("does not carry 'Show all' over: a 1,500-row ledger after a 300-row one shows 100 rows", () => {
    const view = (data: LedgerPageData) => (
      <MemoryRouter>
        <LedgerPage network={XRPL} data={data} />
      </MemoryRouter>
    );
    const { rerender } = render(view(next));
    fireEvent.click(screen.getByRole("button", { name: "Show all 300" }));
    expect(tableRows()).toHaveLength(300);

    rerender(view(another(Array.from({ length: 1500 }, () => "OfferCreate"), "CD".repeat(32), 107720690)));
    expect(tableRows()).toHaveLength(FIRST_ROWS);
    expect(screen.getByRole("button", { name: "Show all 1,500" })).toBeTruthy();
  });

  it("keeps the choice while it is the same ledger that is drawn again (its data revalidated)", () => {
    const view = (data: LedgerPageData) => (
      <MemoryRouter>
        <LedgerPage network={XRPL} data={data} />
      </MemoryRouter>
    );
    const { rerender } = render(view(next));
    fireEvent.click(screen.getByRole("button", { name: "Show all 300" }));
    rerender(view({ ...next }));
    expect(tableRows()).toHaveLength(300);
  });

  it("marks the raw header as the .raw block whose summary the stylesheet gives an inset focus ring", () => {
    const { container } = renderInRouter(<LedgerPage network={XRPL} data={ledger(["Payment"])} />);
    const details = container.querySelector("details");
    expect(details?.classList.contains("raw")).toBe(true);
    expect(details?.classList.contains("card")).toBe(true);
    expect(details?.querySelector(":scope > summary")).not.toBeNull();
  });
});

describe("LedgerPage: the rest", () => {
  it("links the rows to their transactions and accounts, and a failure reads 'Tried to' with its code in the result column", () => {
    renderInRouter(<LedgerPage network={XRPL} data={ledger(["Payment", "Payment"], [1])} />);
    const [ok, bad] = tableRows();
    expect(within(ok!).getAllByRole("link").map((link) => link.getAttribute("href"))).toContain(`/xrpl/tx/${hashOf(0)}`);
    expect(within(ok!).getByText("Success")).toBeTruthy();
    expect(within(bad!).getByText("tecPATH_DRY")).toBeTruthy();
    expect(within(bad!).getByText(/^Tried to send/)).toBeTruthy();
    const links = within(bad!).getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links).toContain(`/xrpl/tx/${hashOf(1)}`);
    expect(links).toContain(`/xrpl/account/${ALICE}`);
    expect(links).toContain(`/xrpl/account/${BOB}`);
  });

  it("shows the accounts of a sentence as plain links in the table, where the chip's box would crowd the row", () => {
    const { container } = renderInRouter(<LedgerPage network={XRPL} data={ledger(["Payment"])} />);
    const [first] = tableRows();
    const links = within(first!).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toContain(`/xrpl/account/${BOB}`);
    expect(container.querySelector(".ent")).toBeNull();
  });

  it("shows the result bar only when something failed, and counts what failed by code", () => {
    const { container } = renderInRouter(<LedgerPage network={XRPL} data={ledger(["Payment", "Payment", "Payment", "Payment"], [3])} />);
    expect(container.querySelector(".bar__bad")).not.toBeNull();
    expect(screen.getByText("3 succeeded · 1 failed (", { exact: false })).toBeTruthy();
    cleanup();
    const clean = renderInRouter(<LedgerPage network={XRPL} data={ledger(["Payment", "Payment"])} />);
    expect(clean.container.querySelector(".bar__bad")).toBeNull();
    expect(screen.getByText("2 succeeded")).toBeTruthy();
  });

  it("lists the accounts created, a few of them, and counts the rest", () => {
    const accounts = Array.from({ length: 7 }, (_, i) => `rAccount${i}xxxxxxxxxxxxxxxxxxxxxxxxx`);
    renderInRouter(<LedgerPage network={XRPL} data={ledger(["Payment"], [], { accountsCreated: accounts })} />);
    const aside = screen.getByRole("complementary", { name: "Results" });
    expect(within(aside).getAllByRole("link")).toHaveLength(5);
    expect(within(aside).getByText("and 2 more")).toBeTruthy();
    expect(within(aside).getByText("7")).toBeTruthy();
  });

  it("shows a dash for a close time resolution it does not know", () => {
    const data = ledger(["Payment"]);
    renderInRouter(<LedgerPage network={XRPL} data={{ ...data, header: { ...data.header, resolution: Number.NaN } }} />);
    expect(screen.getByText("Close time resolution").nextElementSibling?.textContent).toBe("—");
  });

  it("notes that a ledger came from the node", () => {
    renderInRouter(<LedgerPage network={XRPL} data={ledger(["Payment"], [], { origin: "node" })} />);
    expect(screen.getByText("Not in the index yet, shown from the network")).toBeTruthy();
    expect(screen.getByText(/JSON from the network’s node/)).toBeTruthy();
  });

  it("disables next at the newest ledger and previous at ledger 1", () => {
    const newest = ledger(["Payment"], [], { hasNext: false });
    renderInRouter(<LedgerPage network={XRPL} data={newest} />);
    expect(screen.queryByRole("link", { name: "107,720,689, next ledger" })).toBeNull();
    expect(screen.getByLabelText("107,720,689, next ledger (not validated yet)").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("link", { name: "107,720,687, previous ledger" }).getAttribute("href")).toBe("/xrpl/ledger/107720687");
    cleanup();

    const first = ledger(["Payment"], [], { header: { ...newest.header, index: 1 } });
    renderInRouter(<LedgerPage network={XRPL} data={first} />);
    expect(screen.queryByRole("link", { name: /previous ledger$/ })).toBeNull();
    expect(screen.getByRole("link", { name: "2, next ledger" }).getAttribute("href")).toBe("/xrpl/ledger/2");
  });

  // WCAG 2.5.3 (Label in Name, axe: label-content-name-mismatch): somebody who says what they see ("click 107,720,687") must
  // reach the control, so the accessible name has to contain the visible text.
  it("names the previous and next links, and the disabled one, with the number they show in them", () => {
    renderInRouter(<LedgerPage network={XRPL} data={ledger(["Payment"], [])} />);
    for (const [name, shown] of [
      ["107,720,687, previous ledger", "107,720,687"],
      ["107,720,689, next ledger", "107,720,689"],
    ] as const) {
      const link = screen.getByRole("link", { name });
      expect(link.textContent).toBe(shown);
    }
    cleanup();

    renderInRouter(<LedgerPage network={XRPL} data={ledger(["Payment"], [], { hasNext: false })} />);
    const disabled = screen.getByLabelText("107,720,689, next ledger (not validated yet)");
    expect(disabled.textContent).toBe("107,720,689");
    expect(disabled.getAttribute("aria-label")!.startsWith(disabled.textContent!)).toBe(true);
  });

  // A name cannot be given to an element with no role (axe: aria-prohibited-attr, "needs review"): the one that leads nowhere is a link
  // that is not available, which is what `role="link"` with `aria-disabled` says, and a screen reader then reads its name.
  it("is a disabled link, so that its name is read, when the ledger it would lead to is not validated yet", () => {
    renderInRouter(<LedgerPage network={XRPL} data={ledger(["Payment"], [], { hasNext: false })} />);
    const disabled = screen.getByRole("link", { name: "107,720,689, next ledger (not validated yet)" });
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    expect(disabled.hasAttribute("href")).toBe(false);
    expect(disabled.tagName).toBe("SPAN");
  });
});
