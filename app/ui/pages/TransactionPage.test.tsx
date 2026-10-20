import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider, StaticRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { formatUtc, shortAddress } from "../../domain/format";
import type { TransactionPageData } from "../../server/transaction-view";
import { OBJECTS_SHOWN, TransactionPage } from "./TransactionPage";

afterEach(cleanup);

const XRPL = { id: "xrpl", name: "XRPL", native: "XRP", software: "rippled" } as const;
const XAHAU = { id: "xahau", name: "Xahau", native: "XAH", software: "xahaud" } as const;
const ALICE = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";
const BOB = "rNYbL8WZKKNNni5rb2MzcxnAEgkQC5Kq5";
const POOL = "rAtRwrVakWQaGpzxtqgJZDb3Tg7t32rXT";
const HASH = "67F91E110D4E3E6C2E6DA3D42EDFB36D9860D024406F58A12CDDF09B65057C31";
const PREVIOUS = "AA".repeat(32);
const NEXT = "BB".repeat(32);
const USD = { currency: "USD", issuer: "rA7wzfRjziBcrbFwErG1t2sdVofKQmg95" };

/** A Payment of 1,250 USD through an AMM pool, at place 12 of 84 in its ledger. */
function transaction(extra: Partial<TransactionPageData> = {}): TransactionPageData {
  return {
    kind: "transaction",
    origin: "index",
    hash: HASH,
    ctid: "C66B4E2C000C0000",
    ledgerIndex: 107695660,
    closeTime: 1792251771,
    position: { index: 12, count: 84 },
    type: "Payment",
    title: "Payment",
    ok: true,
    result: { code: "tesSUCCESS", ok: true, text: "The transaction was applied and is final." },
    sentence: [
      { t: "account", v: ALICE },
      { t: "text", v: " paid " },
      { t: "amount", value: "1250.00", ...USD },
      { t: "text", v: " to " },
      { t: "account", v: BOB },
      { t: "text", v: "." },
    ],
    summary: "rJF2Xa…Qvg paid 1,250.00 USD to rNYbL8…Kq5.",
    flow: [
      { role: "sender", account: ALICE, label: "Sender", amount: { value: "512.402115", currency: "XRP" } },
      { role: "pool", account: POOL, label: "XRP/USD AMM pool", amount: { value: "1250.00", ...USD } },
      { role: "destination", account: BOB, label: "Destination · tag 104882", amount: { value: "1250.00", ...USD } },
    ],
    account: ALICE,
    fee: "0.000012",
    sequence: 46118302,
    details: [
      { label: "Destination", value: [{ t: "account", v: BOB }] },
      { label: "Amount", value: [{ t: "amount", value: "1250.00", ...USD }] },
      { label: "Send max", value: [{ t: "amount", value: "520", currency: "XRP" }] },
    ],
    memos: [{ text: "Invoice 2291", hex: false, note: "text/plain" }],
    changes: [
      { account: ALICE, currency: "XRP", value: "-512.402127", after: "12480.256114", role: "sender" },
      { account: POOL, currency: "XRP", value: "512.402115", after: "1804220.553901", role: "pool" },
      { account: POOL, ...USD, value: "-1250.00", after: "4401122.18", role: "pool" },
      { account: BOB, currency: "USD", issuer: USD.issuer, value: "1250.00", after: "3860.25", role: "destination" },
    ],
    objects: [
      { change: "modified", type: "AccountRoot", index: "11".repeat(32), account: ALICE },
      { change: "modified", type: "RippleState", index: "22".repeat(32) },
      { change: "created", type: "Offer", index: "33".repeat(32), account: BOB },
      { change: "deleted", type: "Ticket", index: "44".repeat(32), account: ALICE },
    ],
    neighbours: { previous: { position: 11, hash: PREVIOUS }, next: { position: 13, hash: NEXT } },
    raw: {
      tx: '{\n  "TransactionType": "Payment"\n}',
      meta: '{\n  "TransactionResult": "tesSUCCESS"\n}',
      binary: { state: "ready", tx: "12000022000000002402BFB59E", meta: "201C0000000C6012" },
    },
    ...extra,
  };
}

function renderPage(data: TransactionPageData, network: typeof XRPL | typeof XAHAU = XRPL) {
  const router = createMemoryRouter([{ path: "*", element: <TransactionPage network={network} data={data} /> }], {
    initialEntries: [`/${network.id}/tx/${data.hash}`],
  });
  return render(<RouterProvider router={router} />);
}

/** The label of every row of a details list, and the text of its value. */
function detailRows(card: HTMLElement): Record<string, string> {
  const rows: Record<string, string> = {};
  for (const row of card.querySelectorAll(".kv")) rows[row.querySelector("dt")!.textContent!] = row.querySelector("dd")!.textContent!.replace(/\s+/g, " ").trim();
  return rows;
}
const detailsCard = () => screen.getByRole("region", { name: "Details" });

describe("TransactionPage: the head", () => {
  it("names the kind of transaction and shows the result as an icon and words, with the code", () => {
    renderPage(transaction());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Payment");
    const pill = document.querySelector(".pill")!;
    expect(pill.textContent).toContain("Success");
    expect(pill.textContent).toContain("tesSUCCESS");
    expect(pill.querySelector("svg")).not.toBeNull();
  });

  it("shows a failure as a cross and the result code, never as a success", () => {
    renderPage(transaction({ ok: false, result: { code: "tecKILLED", ok: false, text: "Nothing was traded." }, flow: null }));
    const pill = document.querySelector(".pill")!;
    expect(pill.className).toContain("pill--bad");
    expect(pill.textContent).toBe("tecKILLED");
    expect(pill.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("Success")).toBeNull();
  });

  it("gives the raw type beside a title that is not it", () => {
    renderPage(transaction({ type: "OfferCreate", title: "Offer" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Offer");
    expect(document.querySelector(".page-head .type")?.textContent).toBe("OfferCreate");
  });

  it("does not repeat the type when the title is it", () => {
    renderPage(transaction());
    expect(document.querySelector(".page-head .type")).toBeNull();
  });

  it("shows when it happened in UTC, and its age once the browser knows the time", () => {
    renderPage(transaction());
    const head = document.querySelector(".page-head")!;
    expect(head.textContent).toContain("2026-10-17 15:42:51 UTC");
    expect(head.textContent).toMatch(/· \d+ (s|min|h|d) ago/);
  });

  it("prints no age on the server: the stored page is the same for everybody", () => {
    const html = renderToString(
      <RouterProviderFor>
        <TransactionPage network={XRPL} data={transaction()} />
      </RouterProviderFor>,
    );
    expect(html).toContain("2026-10-17 15:42:51 UTC");
    expect(html).not.toMatch(/\d+ (s|min|h|d) ago/);
  });

  it("has the crumbs XRPL / Ledger / the short hash, and a link to the raw data", () => {
    renderPage(transaction());
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" })).getAllByRole("listitem");
    expect(crumbs.map((li) => li.textContent?.replace("/", ""))).toEqual(["XRPL", "Ledger 107,695,660", "67F91E…7C31"]);
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Ledger 107,695,660" }).getAttribute("href")).toBe("/xrpl/ledger/107695660");
    expect(screen.getByRole("link", { name: "Raw JSON" }).getAttribute("href")).toBe("#raw");
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });
});

/** The pages link, so they need a router; on the server a static one. */
function RouterProviderFor({ children }: { children: ReactElement }) {
  return <StaticRouter location="/xrpl/tx/AB">{children}</StaticRouter>;
}

describe("TransactionPage: the summary", () => {
  it("is the sentence, with its accounts as links, and the flow under it", () => {
    renderPage(transaction());
    const summary = screen.getByRole("region", { name: "Summary" });
    const sentence = summary.querySelector("p.sentence")!;
    expect(sentence.textContent).toBe(`${shortAddress(ALICE)} paid 1,250.00 USD to ${shortAddress(BOB)}.`);
    expect(within(sentence as HTMLElement).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([`/xrpl/account/${ALICE}`, `/xrpl/account/${BOB}`]);
    expect(within(summary).getByRole("group", { name: "Flow of funds" })).toBeTruthy();
  });

  it("has no flow for a transaction that moved nothing", () => {
    renderPage(transaction({ flow: null }));
    expect(screen.queryByRole("group", { name: "Flow of funds" })).toBeNull();
  });

  it("repeats the reason of a failure in the sentence, as the description made it", () => {
    renderPage(
      transaction({
        ok: false,
        result: { code: "tecPATH_DRY", ok: false, text: "No path had enough liquidity." },
        flow: null,
        sentence: [{ t: "account", v: ALICE }, { t: "text", v: " tried to pay 5 XRP." }, { t: "text", v: " No path had enough liquidity." }],
      }),
    );
    expect(screen.getByRole("region", { name: "Summary" }).textContent).toContain("tried to pay 5 XRP. No path had enough liquidity.");
  });
});

describe("TransactionPage: the details", () => {
  it("lists hash, CTID, ledger, date and account first, then the type's own details, the fee, the sequence and the memo", () => {
    renderPage(transaction());
    expect(Object.keys(detailRows(detailsCard()))).toEqual([
      "Hash",
      "CTID",
      "Ledger",
      "Date",
      "Account",
      "Destination",
      "Amount",
      "Send max",
      "Fee",
      "Sequence",
      "Memo",
    ]);
  });

  it("gives the whole hash and CTID with a button to copy each", () => {
    renderPage(transaction());
    const rows = detailRows(detailsCard());
    expect(rows.Hash).toBe(HASH);
    expect(rows.CTID).toBe("C66B4E2C000C0000");
    expect(within(detailsCard()).getByRole("button", { name: "Copy hash" })).toBeTruthy();
    expect(within(detailsCard()).getByRole("button", { name: "Copy CTID" })).toBeTruthy();
  });

  it("leaves the CTID row out for a place that has none", () => {
    renderPage(transaction({ ctid: null }));
    expect(Object.keys(detailRows(detailsCard()))).not.toContain("CTID");
  });

  it("links the ledger and says where in it the transaction is", () => {
    renderPage(transaction());
    expect(detailRows(detailsCard()).Ledger).toBe("#107,695,660 · transaction 12 of 84");
    expect(within(detailsCard()).getByRole("link", { name: "#107,695,660" }).getAttribute("href")).toBe("/xrpl/ledger/107695660");
  });

  it("says only where in the ledger when it does not know how many there are", () => {
    renderPage(transaction({ position: { index: 12, count: null } }));
    expect(detailRows(detailsCard()).Ledger).toBe("#107,695,660 · transaction 12");
  });

  it("shows the date, the full account and the full destination (an account on a line of its own is not shortened)", () => {
    renderPage(transaction());
    const rows = detailRows(detailsCard());
    expect(rows.Date).toContain(formatUtc(1792251771));
    expect(rows.Account).toBe(ALICE);
    expect(rows.Destination).toBe(BOB);
    expect(within(detailsCard()).getByRole("link", { name: BOB }).getAttribute("href")).toBe(`/xrpl/account/${BOB}`);
    expect(rows.Amount).toBe("1,250.00 USD");
    expect(rows["Send max"]).toBe("520 XRP");
  });

  it("shows the fee as burned, in the network's currency, and the sequence with separators", () => {
    renderPage(transaction());
    const rows = detailRows(detailsCard());
    expect(rows.Fee).toBe("0.000012 XRP · burned");
    expect(rows.Sequence).toBe("46,118,302");
  });

  it("shows the memo and its format", () => {
    renderPage(transaction());
    expect(detailRows(detailsCard()).Memo).toBe("Invoice 2291 · text/plain");
  });

  it("says when a memo is hex, and shows each memo in a row of its own", () => {
    renderPage(transaction({ memos: [{ text: "00FF10", hex: true, note: "" }, { text: "Hello", hex: false, note: "" }] }));
    const rows = [...detailsCard().querySelectorAll(".kv")].filter((row) => row.querySelector("dt")!.textContent === "Memo");
    expect(rows.map((row) => row.querySelector("dd")!.textContent)).toEqual(["00FF10 · hex", "Hello"]);
  });

  it("leaves out the sequence, the memo and the fee row's twin when there are none", () => {
    renderPage(transaction({ sequence: null, memos: [] }));
    const labels = Object.keys(detailRows(detailsCard()));
    expect(labels).not.toContain("Sequence");
    expect(labels).not.toContain("Memo");
  });

  it("is in XAH on Xahau, with links to Xahau", () => {
    renderPage(transaction(), XAHAU);
    expect(detailRows(detailsCard()).Fee).toBe("0.000012 XAH · burned");
    expect(within(detailsCard()).getByRole("link", { name: "#107,695,660" }).getAttribute("href")).toBe("/xahau/ledger/107695660");
  });
});

describe("TransactionPage: the balance changes", () => {
  const table = () => screen.getByRole("table", { name: "Balance changes" });
  const cells = (row: HTMLElement) => within(row).getAllByRole("cell");

  it("has a row per change under Account, Currency, Change and Balance after", () => {
    renderPage(transaction());
    const rows = within(table()).getAllByRole("row");
    expect(within(rows[0]!).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Account", "Currency", "Change", "Balance after"]);
    expect(rows).toHaveLength(5);
  });

  it("shows the sign: a gain with a plus sign in the success colour, a loss with a minus sign", () => {
    renderPage(transaction());
    const rows = within(table()).getAllByRole("row").slice(1);
    expect(cells(rows[0]!)[2]!.textContent).toBe("−512.402127");
    expect(cells(rows[1]!)[2]!.textContent).toBe("+512.402115");
    expect(cells(rows[1]!)[2]!.querySelector(".amt--pos")).not.toBeNull();
    expect(cells(rows[0]!)[2]!.querySelector(".amt--pos")).toBeNull();
    expect(cells(rows[3]!)[2]!.textContent).toBe("+1,250.00");
  });

  it("shows the balance after, and the currency of each row", () => {
    renderPage(transaction());
    const rows = within(table()).getAllByRole("row").slice(1);
    expect(rows.map((row) => cells(row)[1]!.querySelector(".mono")!.textContent)).toEqual(["XRP", "XRP", "USD", "USD"]);
    expect(rows.map((row) => cells(row)[3]!.textContent)).toEqual(["12,480.256114", "1,804,220.553901", "4,401,122.18", "3,860.25"]);
  });

  it("links the accounts and marks the sender, the destination and the pool", () => {
    renderPage(transaction());
    const rows = within(table()).getAllByRole("row").slice(1);
    expect(cells(rows[0]!)[0]!.textContent).toBe(`${shortAddress(ALICE)}sender`);
    expect(cells(rows[1]!)[0]!.textContent).toBe(`${shortAddress(POOL)}AMM pool`);
    expect(cells(rows[3]!)[0]!.textContent).toBe(`${shortAddress(BOB)}destination`);
    expect(within(cells(rows[0]!)[0]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${ALICE}`);
  });

  it("shows the other side of the trust line of an issued currency in the open, so that two currencies of one code can be told apart", () => {
    renderPage(transaction());
    const rows = within(table()).getAllByRole("row").slice(1);
    const usd = cells(rows[3]!)[1]!;
    expect(usd.textContent).toBe(`USDwith ${shortAddress(USD.issuer)}`);
    const link = within(usd).getByRole("link");
    expect(link.getAttribute("href")).toBe(`/xrpl/account/${USD.issuer}`);
    expect(link.getAttribute("title")).toBe(USD.issuer);
    // The native currency has none.
    expect(cells(rows[0]!)[1]!.textContent).toBe("XRP");
    expect(within(cells(rows[0]!)[1]!).queryByRole("link")).toBeNull();
  });

  it("says 'with' and not 'issuer': in the issuer's own row the other side of the line is the holder", () => {
    renderPage(transaction());
    const rows = within(table()).getAllByRole("row").slice(1);
    expect(cells(rows[3]!)[1]!.textContent).not.toMatch(/issu/i);
  });

  it("gives the code of a currency that is shown as text, on hover", () => {
    const hex = "524C555344000000000000000000000000000000";
    renderPage(transaction({ changes: [{ account: BOB, currency: hex, issuer: USD.issuer, value: "3", after: "4", role: "destination" }] }));
    const cell = cells(within(table()).getAllByRole("row")[1]!)[1]!;
    expect(cell.textContent).toBe(`RLUSDwith ${shortAddress(USD.issuer)}`);
    expect(cell.querySelector("[title]")?.getAttribute("title")).toBe(hex);
  });

  it("says that the sender's native change includes the fee", () => {
    renderPage(transaction());
    expect(screen.getByText(/the sender.s XRP change includes the fee/i)).toBeTruthy();
    cleanup();
    renderPage(transaction(), XAHAU);
    expect(screen.getByText(/the sender.s XAH change includes the fee/i)).toBeTruthy();
  });

  it("says so when no balance changed", () => {
    renderPage(transaction({ changes: [] }));
    expect(screen.getByText("No balances changed.")).toBeTruthy();
  });

  it("scrolls inside its card when the screen is narrow (a table with a minimum width)", () => {
    renderPage(transaction());
    expect(table().style.minWidth).not.toBe("");
    expect(table().closest(".table-scroll")).not.toBeNull();
  });

  it("is never narrower than its tracks at their least, the gaps and the padding of a row: or the numbers are cut and the rows' borders end early", () => {
    renderPage(transaction());
    const tracks = [...table().style.getPropertyValue("--cols").matchAll(/minmax\((\d+)px,[^)]*\)|(\d+)px/g)].map((m) => Number(m[1] ?? m[2]));
    expect(tracks).toHaveLength(4);
    const least = tracks.reduce((sum, track) => sum + track, 0) + (tracks.length - 1) * 16 + 32;
    expect(Number.parseFloat(table().style.minWidth)).toBeGreaterThanOrEqual(least);
  });
});

describe("TransactionPage: the context", () => {
  const context = () => screen.getByRole("complementary", { name: "Context" });

  it("says what the result means", () => {
    renderPage(transaction());
    expect(context().textContent).toContain("Result");
    expect(context().textContent).toContain("tesSUCCESS");
    expect(context().textContent).toContain("The transaction was applied and is final.");
  });

  it("links the transactions before and after it in the ledger, by their place", () => {
    renderPage(transaction());
    const nav = within(context()).getByRole("navigation", { name: "Transactions in this ledger" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Previous · #11", "Next · #13"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([`/xrpl/tx/${PREVIOUS}`, `/xrpl/tx/${NEXT}`]);
    expect(within(context()).getByRole("link", { name: "#107,695,660" }).getAttribute("href")).toBe("/xrpl/ledger/107695660");
  });

  it("shows a missing neighbour as disabled, not as a link: the first and the last of a ledger", () => {
    renderPage(transaction({ neighbours: { previous: null, next: { position: 1, hash: NEXT } } }));
    const nav = within(context()).getByRole("navigation", { name: "Transactions in this ledger" });
    expect(within(nav).getAllByRole("link")).toHaveLength(1);
    const disabled = nav.querySelector('[aria-disabled="true"]')!;
    expect(disabled.textContent).toBe("Previous · first in ledger");
    expect(disabled.getAttribute("href")).toBeNull();
    cleanup();

    renderPage(transaction({ neighbours: { previous: { position: 82, hash: PREVIOUS }, next: null } }));
    const end = within(screen.getByRole("complementary", { name: "Context" })).getByRole("navigation", { name: "Transactions in this ledger" });
    expect(end.querySelector('[aria-disabled="true"]')?.textContent).toBe("Next · last in ledger");
  });

  it("lists the ledger objects it touched: what happened to which kind, and whose", () => {
    renderPage(transaction());
    const items = within(screen.getByRole("list", { name: "Ledger objects touched" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      `ModifiedAccountRoot${shortAddress(ALICE)}`,
      "ModifiedRippleState",
      `CreatedOffer${shortAddress(BOB)}`,
      `DeletedTicket${shortAddress(ALICE)}`,
    ]);
    expect(within(items[0]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${ALICE}`);
  });

  it("shows the first few objects and holds the rest back behind a control that shows them, with no request", () => {
    const many = Array.from({ length: OBJECTS_SHOWN + 5 }, (_, i) => ({ change: "modified" as const, type: `Type${i}`, index: String(i).padStart(64, "0") }));
    renderPage(transaction({ objects: many }));
    const list = screen.getByRole("list", { name: "Ledger objects touched" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(OBJECTS_SHOWN);
    const more = screen.getByText(`Show 5 more`);
    expect(more.closest("details")).not.toBeNull();
    expect(more.closest("details")!.textContent).toContain(`Type${OBJECTS_SHOWN + 4}`);
  });

  it("says so when it touched nothing", () => {
    renderPage(transaction({ objects: [] }));
    expect(context().textContent).toContain("No ledger objects.");
  });
});

describe("TransactionPage: a transaction shown from the node", () => {
  const fromNode = () =>
    transaction({
      origin: "node",
      neighbours: null,
      position: { index: 12, count: null },
      raw: { tx: "{}", meta: "{}", binary: { state: "pending" } },
    });

  it("says it is not in the index yet", () => {
    renderPage(fromNode());
    expect(screen.getByText("Not in the index yet, shown from the network")).toBeTruthy();
  });

  it("has no previous and next, and says they appear once the transaction is indexed", () => {
    renderPage(fromNode());
    const context = screen.getByRole("complementary", { name: "Context" });
    expect(within(context).queryByRole("navigation", { name: "Transactions in this ledger" })).toBeNull();
    expect(context.textContent).toContain("Previous and next transactions appear once the transaction is indexed.");
  });

  it("says in its Binary tab that the binary form appears once the transaction is indexed", () => {
    renderPage(fromNode());
    fireEvent.click(screen.getByRole("tab", { name: "Binary" }));
    expect(screen.getByRole("tabpanel").textContent).toContain("The binary form appears once the transaction is indexed.");
  });

  it("does not show the note for a transaction of the index", () => {
    renderPage(transaction());
    expect(screen.queryByText(/Not in the index yet/)).toBeNull();
  });
});

describe("TransactionPage: the order of its cards", () => {
  // The desktop board puts the raw card in the left column and the margin on the right: a grid does that (pages.css). The page order is
  // the phone's (TransactionMobile): details, balance changes, what is in the margin, the raw data last.
  it("is details, balance changes, the margin, the raw data", () => {
    renderPage(transaction());
    const grid = document.querySelector(".txgrid")!;
    expect(grid).not.toBeNull();
    const names = [...grid.children].map((child) => child.getAttribute("aria-label") ?? child.querySelector("h2")?.textContent);
    expect(names).toEqual(["Details", "Balance changes", "Context", "Raw transaction data"]);
    expect([...grid.children].map((child) => child.className.split(" ").find((c) => c.startsWith("txgrid__")))).toEqual([
      "txgrid__details",
      "txgrid__balance",
      "txgrid__aside",
      "txgrid__raw",
    ]);
  });
});

describe("TransactionPage: the raw data", () => {
  it("is a card you can jump to, with the three tabs Transaction, Metadata and Binary", () => {
    renderPage(transaction());
    const card = document.getElementById("raw")!;
    expect(card).not.toBeNull();
    expect(within(card).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Transaction", "Metadata", "Binary"]);
    expect(within(card).getByRole("tabpanel").textContent).toContain("TransactionType");
  });

  it("has a heading of its own for the stacked panels to sit under", () => {
    const html = renderToString(
      <RouterProviderFor>
        <TransactionPage network={XRPL} data={transaction()} />
      </RouterProviderFor>,
    );
    const raw = html.slice(html.indexOf('id="raw"'));
    expect(raw.indexOf("<h2")).toBeGreaterThanOrEqual(0);
    expect(raw.indexOf("<h2")).toBeLessThan(raw.indexOf("<h3"));
    expect(raw).toContain(">Raw data</h2>");
  });

  it("says under Binary when the index has no binary form for this type of transaction", () => {
    renderPage(transaction({ raw: { tx: "{}", meta: "{}", binary: { state: "unsupported" } } }));
    fireEvent.click(screen.getByRole("tab", { name: "Binary" }));
    const panel = screen.getByRole("tabpanel");
    expect(panel.textContent).toContain("The index has no binary form for this type of transaction.");
    expect(panel.textContent).not.toMatch(/try again|reload/i);
    expect(panel.getAttribute("tabindex")).toBe("0");
  });

  it("tells a page stored for 30 s to be tried again in a minute, not reloaded", () => {
    renderPage(transaction({ raw: { tx: "{}", meta: "{}", binary: { state: "failed" } } }));
    fireEvent.click(screen.getByRole("tab", { name: "Binary" }));
    expect(screen.getByRole("tabpanel").textContent).toBe("The binary form could not be loaded just now. Try again in a minute.");
  });

  it("shows the hex of the transaction and of its metadata under Binary", () => {
    renderPage(transaction());
    fireEvent.click(screen.getByRole("tab", { name: "Binary" }));
    const text = screen.getByRole("tabpanel").textContent!;
    expect(text).toContain("12000022000000002402BFB59E");
    expect(text).toContain("201C0000000C6012");
  });

  it("says under Binary when the binary form could not be loaded", () => {
    renderPage(transaction({ raw: { tx: "{}", meta: "{}", binary: { state: "failed" } } }));
    fireEvent.click(screen.getByRole("tab", { name: "Binary" }));
    expect(screen.getByRole("tabpanel").textContent).toContain("The binary form could not be loaded just now.");
  });

  it("has all three on the server's page, for a browser that never runs the script", () => {
    const html = renderToString(
      <RouterProviderFor>
        <TransactionPage network={XRPL} data={transaction()} />
      </RouterProviderFor>,
    );
    expect(html).toContain("TransactionType");
    expect(html).toContain("TransactionResult");
    expect(html).toContain("12000022000000002402BFB59E");
  });
});
