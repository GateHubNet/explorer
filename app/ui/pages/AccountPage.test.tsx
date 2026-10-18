import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, createStaticHandler, createStaticRouter, RouterProvider, StaticRouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { shortAddress } from "../../domain/format";
import type { AccountHeader, AccountPageData, NeverActivatedData, TabList, TxRow } from "../../server/account-view";
import { AccountPage, NeverActivatedPage } from "./AccountPage";

afterEach(cleanup);

const XRPL = { id: "xrpl", name: "XRPL", native: "XRP" } as const;
const XAHAU = { id: "xahau", name: "Xahau", native: "XAH" } as const;
const ADDRESS = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";
const PARENT = "rYogZ7oXMbYEWXrCQXHDKwe8mLqLDoaWm";
const BOB = "rNYbL8WZKKNNni5rb2MzcxnAEgkQC5Kq5";
const POOL = "rAtRwrVakWQaGpzxtqgJZDb3Tg7t32rXT";
const ISSUER = "rA7wzfRjziBcrbFwErG1t2sdVofKQmg95";
const TX = "67F91E110D4E3E6C2E6DA3D42EDFB36D9860D024406F58A12CDDF09B65057C31";
const QR = { size: 25, path: "M0 0h7v1h-7zM0 1h1v1h-1z", content: ADDRESS, tag: null };
const X_ADDRESS = "XVMgJSRJAMekfCw3mHHsRUbqYqWuZ2qXW7DhMWWpGmjhqyr";

const header = (over: Partial<AccountHeader> = {}): AccountHeader => ({
  status: "active",
  activation: { time: 1552588800, parent: PARENT, initialBalance: "25", txHash: TX },
  live: {
    state: "ok",
    ledgerIndex: 107695660,
    sequence: 46118303,
    flags: [{ id: "requireDestTag", label: "Requires destination tag" }],
    regularKey: true,
    domain: "example.com",
    lastActive: { ledgerIndex: 107695600, hash: TX, time: 1792251771 },
  },
  balance: { native: "12480.256114", available: "12477.856114", reserve: { total: "2.4", base: "1", increment: "0.2", objects: 7 } },
  tokens: {
    state: "ok",
    truncated: false,
    items: [
      { currency: "USD", issuer: ISSUER, value: "3120.50", lp: false },
      { currency: `03${"AB".repeat(19)}`, issuer: POOL, value: "1042.77", lp: true },
    ],
  },
  owned: {
    counts: [
      { type: "RippleState", label: "trust lines", count: 4 },
      { type: "Offer", label: "offers", count: 2 },
      { type: "Escrow", label: "escrow", count: 1 },
    ],
    truncated: false,
  },
  nodeProblem: false,
  ...over,
});

const txRow = (over: Partial<TxRow> = {}): TxRow => ({
  hash: TX,
  ledgerIndex: 107695660,
  time: 1792251771,
  type: "Payment",
  what: [
    { t: "text", v: "Sent " },
    { t: "amount", value: "1250.00", currency: "USD", issuer: ISSUER },
    { t: "text", v: " to " },
    { t: "account", v: BOB },
  ],
  change: { value: "-512.402127", currency: "XRP", more: 0 },
  ok: true,
  code: "tesSUCCESS",
  ...over,
});

const transactions = (
  rows: TxRow[] = [txRow()],
  paging: { newerHref: string | null; olderHref: string | null } = { newerHref: null, olderHref: `/xrpl/account/${ADDRESS}?marker=M1` },
): TabList => ({
  state: "ok",
  tab: "transactions",
  rows,
  paging,
});

function data(over: Partial<AccountPageData> = {}): AccountPageData {
  return { kind: "account", mode: "live", address: ADDRESS, native: "XRP", tab: "transactions", tag: null, qr: QR, header: header(), list: transactions(), ...over };
}

function renderInRouter(ui: ReactElement, loader: () => null = () => null) {
  const router = createMemoryRouter([{ path: "*", element: ui, loader }], { initialEntries: [`/xrpl/account/${ADDRESS}`] });
  return { router, ...render(<RouterProvider router={router} />) };
}

describe("the header", () => {
  it("shows the address as the page's title, with a copy button, a QR code in a closed details, and a picture of the address", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data()} />);
    expect(await screen.findByRole("heading", { level: 1, name: ADDRESS })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy address" })).toBeTruthy();

    const details = document.querySelector("details.qr") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByRole("img", { name: `QR code of the address ${ADDRESS}` })).toBeTruthy();
    expect(details.querySelector(".qr__code path")!.getAttribute("d")).toBe(QR.path);
    expect(details.querySelector("summary")!.getAttribute("aria-label")).toBe("Show QR code");

    const identicon = document.querySelector("svg.identicon")!;
    expect(identicon.getAttribute("aria-hidden")).toBe("true");
    expect(identicon.querySelector("path")!.getAttribute("d")).toMatch(/^M\d \dh1v1h-1z/);
  });

  it("labels the QR code of the address, and says what is in it when it is the X-address of an address with a destination tag", async () => {
    const { unmount } = renderInRouter(<AccountPage network={XRPL} data={data()} />);
    await screen.findByRole("heading", { level: 1 });
    const plain = document.querySelector("details.qr")!;
    expect(within(plain as HTMLElement).getByRole("img", { name: `QR code of the address ${ADDRESS}` })).toBeTruthy();
    expect(plain.textContent).toContain("Scan it with a wallet to get the address.");
    unmount();

    renderInRouter(<AccountPage network={XRPL} data={data({ tag: 104882, qr: { ...QR, content: X_ADDRESS, tag: 104882 } })} />);
    await screen.findByRole("heading", { level: 1 });
    const tagged = document.querySelector("details.qr") as HTMLElement;
    expect(within(tagged).getByRole("img", { name: `QR code of the X-address ${X_ADDRESS}, which is the address with destination tag 104882` })).toBeTruthy();
    expect(tagged.textContent).toContain("Scan it with a wallet to get the address and destination tag 104882.");
  });

  it("says when and by whom it was activated, with its domain as text", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data()} />);
    const meta = (await screen.findByText(/Activated on/)).closest("p")!;
    expect(meta.textContent).toBe(`Activated on 2019-03-14 18:40:00 UTC by ${shortAddress(PARENT)} with 25 XRP · domain example.com`);
    expect(within(meta).getByRole("link", { name: "2019-03-14 18:40:00 UTC" }).getAttribute("href")).toBe(`/xrpl/tx/${TX}`);
    expect(within(meta).getByRole("link", { name: shortAddress(PARENT) }).getAttribute("href")).toBe(`/xrpl/account/${PARENT}`);
    // The domain is a claim of the account, not a link of the explorer's.
    expect(within(meta).queryAllByRole("link")).toHaveLength(2);
  });

  it("says nothing of an activation the index does not have but that it does not have", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data({ header: header({ activation: null }) })} />);
    expect(await screen.findByText("Activation is not in the index.")).toBeTruthy();
  });

  it("shows the flags, the regular key, the sequence and the last activity, linked to the transaction", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data()} />);
    await screen.findByText("Requires destination tag");
    const flags = document.querySelector(".account-flags")!;
    expect(flags.textContent).toContain("Requires destination tag");
    expect(flags.textContent).toContain("Regular key set");
    expect(flags.textContent).toContain("Sequence 46,118,303");
    const last = flags.querySelector("a")!;
    expect(last.getAttribute("href")).toBe(`/xrpl/tx/${TX}`);
    // The time is on the element; what it shows in the browser is an age that ticks.
    expect(last.querySelector("time")!.getAttribute("title")).toBe("2026-10-17 15:42:51 UTC");
  });

  it("shows the balance, what is available and the reserve it is made of", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data()} />);
    const panel = (await screen.findByText("XRP balance")).parentElement!;
    expect(panel.textContent).toBe("XRP balance12,480.256114Available 12,477.856114Reserve 2.4 XRP = 1 base + 7 objects × 0.2");
  });

  it("holds no link in the balance panel on plain --sunken (the Xahau accent is under 4.5:1 there); the panel that has one is the soft one", async () => {
    const { unmount } = renderInRouter(<AccountPage network={XRPL} data={data()} />);
    await screen.findByText("XRP balance");
    expect(document.querySelector(".account-balance")!.querySelectorAll("a")).toHaveLength(0);
    expect(document.querySelector(".account-balance")!.classList.contains("account-balance--soft")).toBe(false);
    unmount();
    renderInRouter(<AccountPage network={XRPL} data={data({ mode: "history", header: { status: "history" } })} />);
    await screen.findByText(/does not show the balance/);
    const panel = document.querySelector(".account-balance")!;
    expect(panel.querySelectorAll("a")).toHaveLength(1);
    expect(panel.classList.contains("account-balance--soft")).toBe(true);
  });

  it("uses the network's currency, and says 'object' for one", async () => {
    renderInRouter(<AccountPage network={XAHAU} data={data({ native: "XAH", header: header({ balance: { native: "5", available: "3.8", reserve: { total: "1.2", base: "1", increment: "0.2", objects: 1 } } }) })} />);
    const panel = (await screen.findByText("XAH balance")).parentElement!;
    expect(panel.textContent).toContain("Reserve 1.2 XAH = 1 base + 1 object × 0.2");
  });

  it("leaves out the available balance and the reserve when the node could not give them, and says the balance could not be read when it has none", async () => {
    const { unmount } = renderInRouter(<AccountPage network={XRPL} data={data({ header: header({ balance: { native: "25", available: null, reserve: null } }) })} />);
    const panel = (await screen.findByText("XRP balance")).parentElement!;
    expect(panel.textContent).toBe("XRP balance25");
    unmount();
    renderInRouter(<AccountPage network={XRPL} data={data({ header: header({ balance: null }) })} />);
    expect(await screen.findByText("The balance could not be read.")).toBeTruthy();
  });

  it("is the same on the server as in the browser: hydrating what the server printed changes nothing, and it prints no age", async () => {
    const element = <AccountPage network={XRPL} data={data({ list: transactions() })} />;
    const handler = createStaticHandler([{ path: "*", element }]);
    const context = await handler.query(new Request(`http://explorer.test/xrpl/account/${ADDRESS}`));
    if (context instanceof Response) throw new Error("expected a render");
    const html = renderToString(<StaticRouterProvider router={createStaticRouter(handler.dataRoutes, context)} context={context} hydrate={false} />);
    expect(html).toContain(`<h1 class="mono">${ADDRESS}</h1>`);
    expect(html).toContain("2026-10-17 15:42:51 UTC");
    expect(html).not.toMatch(/\d+ (s|min|h|d) ago/);

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const router = createMemoryRouter([{ path: "*", element }], { initialEntries: [`/xrpl/account/${ADDRESS}`] });
    await act(async () => {
      hydrateRoot(container, <RouterProvider router={router} />);
    });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    container.remove();
  });
});

describe("the notes above the page", () => {
  it("shows a deleted account with a banner and no balance, tokens or owned objects", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data({ header: header({ status: "deleted", live: { state: "none" }, balance: null, tokens: { state: "none" }, owned: null }) })} />);
    expect(await screen.findByText("Deleted")).toBeTruthy();
    expect(screen.getByText(/This account was deleted from the ledger/)).toBeTruthy();
    expect(screen.getByText("The account no longer exists.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Tokens" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Owned objects" })).toBeNull();
    expect(screen.queryByText(/Sequence/)).toBeNull();
  });

  it("says the live state is unavailable, with a Retry that fetches the page's data again", async () => {
    const loader = vi.fn(() => null);
    renderInRouter(<AccountPage network={XRPL} data={data({ header: header({ live: { state: "unavailable" }, owned: null, nodeProblem: true }) })} />, loader);
    expect(await screen.findByText("Live state unavailable")).toBeTruthy();
    expect(screen.queryByText(/Sequence/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Owned objects" })).toBeNull();
    const calls = loader.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loader.mock.calls.length).toBe(calls + 1));
  });

  it("shows the destination tag of an X-address, and none when there is not one", async () => {
    const { unmount } = renderInRouter(<AccountPage network={XRPL} data={data({ tag: 104882 })} />);
    expect(await screen.findByText("Destination tag 104882")).toBeTruthy();
    expect(screen.getByText(/enter/).textContent).toContain("104882");
    unmount();
    renderInRouter(<AccountPage network={XRPL} data={data({ tag: null })} />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText(/Destination tag/)).toBeNull();
  });
});

describe("the margin", () => {
  it("lists the tokens with their code as text, an LP token with its pool, and the issuer as a link", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data()} />);
    const card = (await screen.findByRole("heading", { name: "Tokens" })).closest("section")!;
    expect(card.textContent).toContain("2 trust lines");
    expect(card.textContent).toContain("USD");
    expect(card.textContent).toContain("3,120.50");
    expect(card.textContent).toContain("LP token");
    expect(card.textContent).toContain("AMM pool");
    expect(card.textContent).toContain("1,042.77");
    expect(within(card).getByRole("link", { name: shortAddress(ISSUER) }).getAttribute("href")).toBe(`/xrpl/account/${ISSUER}`);
    expect(within(card).getByRole("link", { name: shortAddress(POOL) }).getAttribute("href")).toBe(`/xrpl/account/${POOL}`);
  });

  it("puts the tokens after the tenth under 'Show N more'", async () => {
    const items = Array.from({ length: 13 }, (_, i) => ({ currency: "USD", issuer: `rIssuer${i}`, value: String(i), lp: false }));
    renderInRouter(<AccountPage network={XRPL} data={data({ header: header({ tokens: { state: "ok", items, truncated: false } }) })} />);
    const more = (await screen.findByText("Show 3 more")).closest("details")!;
    expect(more.open).toBe(false);
    expect(more.querySelectorAll(".token")).toHaveLength(3);
  });

  it("says when the list of tokens may be longer, and when there are none", async () => {
    const { unmount } = renderInRouter(<AccountPage network={XRPL} data={data({ header: header({ tokens: { state: "ok", items: [{ currency: "USD", issuer: ISSUER, value: "1", lp: false }], truncated: true } }) })} />);
    expect(await screen.findByText("first 1 trust line")).toBeTruthy();
    unmount();
    renderInRouter(<AccountPage network={XRPL} data={data({ header: header({ tokens: { state: "ok", items: [], truncated: false } }) })} />);
    expect(await screen.findByText("No tokens.")).toBeTruthy();
  });

  it("says 'Couldn’t load tokens' with a Retry when the index failed on them", async () => {
    const loader = vi.fn(() => null);
    renderInRouter(<AccountPage network={XRPL} data={data({ header: header({ tokens: { state: "failed" } }) })} />, loader);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn’t load tokens");
    const calls = loader.mock.calls.length;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loader.mock.calls.length).toBe(calls + 1));
  });

  it("counts the owned objects by type, and where they were read", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data()} />);
    const card = (await screen.findByRole("heading", { name: "Owned objects" })).closest("section")!;
    const tiles = [...card.querySelectorAll("li.tile")].map((tile) => tile.textContent);
    expect(tiles).toEqual(["4trust lines", "2offers", "1escrow"]);
    expect(card.textContent).toContain("Read live from the network at ledger #107,695,660.");
  });

  it("says when the counts are of the first page of objects only", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data({ header: header({ owned: { counts: [{ type: "RippleState", label: "trust lines", count: 400 }], truncated: true } }) })} />);
    expect(await screen.findByText(/Counted over the first 400 objects/)).toBeTruthy();
  });
});

describe("the tabs", () => {
  it("are links, one is current, and Analytics is a disabled tab that says 'soon'", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data({ tab: "payments" })} />);
    const nav = await screen.findByRole("navigation", { name: "Account activity" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")])).toEqual([
      ["Transactions", `/xrpl/account/${ADDRESS}`, null],
      ["Payments", `/xrpl/account/${ADDRESS}?tab=payments`, "page"],
      ["Trades", `/xrpl/account/${ADDRESS}?tab=trades`, null],
      ["Offers", `/xrpl/account/${ADDRESS}?tab=offers`, null],
      ["Objects", `/xrpl/account/${ADDRESS}?tab=objects`, null],
    ]);
    const soon = within(nav).getByText("Analytics").parentElement!;
    expect(soon.getAttribute("aria-disabled")).toBe("true");
    expect(soon.textContent).toBe("Analyticssoon");
    expect(soon.tagName).toBe("SPAN");
  });
});

describe("the transactions", () => {
  it("are a table with the date and time, type, what happened, the change and the result", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data({ list: transactions([txRow(), txRow({ hash: "AA".repeat(32), ok: false, code: "tecPATH_PARTIAL", change: { value: "0.5", currency: "XRP", more: 2 } })]) })} />);
    const table = await screen.findByRole("table", { name: "Transactions" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toBe("Date (UTC)TypeWhat happenedChange (XRP)Result");
    const first = rows[1]!.textContent!;
    expect(first).toContain("2026-10-1");
    expect(first).toContain("Payment");
    expect(first).toContain(`Sent 1,250.00 USD to ${shortAddress(BOB)}`);
    expect(first).toContain("−512.402127 XRP");
    expect(first).toContain("Success");
    expect(rows[2]!.textContent).toContain("+0.5 XRP");
    expect(rows[2]!.querySelector(".change > .faint")!.textContent).toBe("+2 more");
    expect(rows[2]!.textContent).toContain("tecPATH_PARTIAL");
    expect(within(rows[1]!).getAllByRole("link")[0]!.getAttribute("href")).toBe(`/xrpl/tx/${TX}`);
  });

  it("have a pager: Older is a link, Newer is disabled on the first page", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data()} />);
    const pager = await screen.findByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: "Older" }).getAttribute("href")).toBe(`/xrpl/account/${ADDRESS}?marker=M1`);
    expect(within(pager).queryByRole("link", { name: "Newer" })).toBeNull();
    expect(within(pager).getByText("Newer").closest("[aria-disabled]")!.getAttribute("aria-disabled")).toBe("true");
  });

  it("say so when there are none", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data({ list: transactions([], { newerHref: null, olderHref: null }) })} />);
    expect(await screen.findByText("No transactions yet.")).toBeTruthy();
  });
});

describe("a list that streams in", () => {
  it("shows a placeholder until the promise settles, then the list", async () => {
    let settle!: (list: TabList) => void;
    const list = new Promise<TabList>((resolve) => (settle = resolve));
    renderInRouter(<AccountPage network={XRPL} data={data({ list })} />);

    // The header is there, and the list is a placeholder.
    expect(await screen.findByRole("heading", { level: 1, name: ADDRESS })).toBeTruthy();
    expect(screen.getByText("Loading transactions…")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Transactions" })).toBeNull();

    settle(transactions());
    expect(await screen.findByRole("table", { name: "Transactions" })).toBeTruthy();
    expect(screen.queryByText("Loading transactions…")).toBeNull();
  });

  it("says 'Couldn’t load transactions' with a Retry that fetches the route's own data again, in the browser", async () => {
    const loader = vi.fn(() => null);
    const list: TabList = { state: "failed", what: "transactions" };
    renderInRouter(<AccountPage network={XRPL} data={data({ list: Promise.resolve(list) })} />, loader);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn’t load transactions.");
    // The header is there.
    expect(screen.getByRole("heading", { level: 1, name: ADDRESS })).toBeTruthy();
    const calls = loader.mock.calls.length;
    const retry = within(alert).getByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    await waitFor(() => expect(loader.mock.calls.length).toBe(calls + 1));
  });

  it("says the same for a list that is not a promise (a page with a marker)", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data({ list: { state: "failed", what: "payments" }, tab: "payments" })} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t load payments.");
  });
});

describe("the other tabs", () => {
  it("lists payments with the direction, the counterparty, the signed amount and the tag, and a link to the explorer's CSV", async () => {
    const list: TabList = {
      state: "ok",
      tab: "payments",
      csvHref: `/xrpl/account/${ADDRESS}/payments.csv`,
      paging: { newerHref: `/xrpl/account/${ADDRESS}?tab=payments`, olderHref: null },
      rows: [
        { hash: TX, time: 1792251771, direction: "sent", counterparty: BOB, amount: { value: "-1250.00", currency: "USD", issuer: ISSUER }, tag: 104882 },
        { hash: "AA".repeat(32), time: 1792200000, direction: "received", counterparty: PARENT, amount: { value: "2000", currency: "XRP" }, tag: null },
      ],
    };
    renderInRouter(<AccountPage network={XRPL} data={data({ tab: "payments", list })} />);
    const table = await screen.findByRole("table", { name: "Payments" });
    const rows = within(table).getAllByRole("row");
    expect(rows[0]!.textContent).toBe("Date (UTC)DirectionCounterpartyDeliveredTag");
    expect(rows[1]!.textContent).toContain("Sent");
    expect(rows[1]!.textContent).toContain(shortAddress(BOB));
    expect(rows[1]!.textContent).toContain("−1,250.00 USD");
    expect(rows[1]!.textContent).toContain("104882");
    expect(rows[2]!.textContent).toContain("Received");
    expect(rows[2]!.textContent).toContain("+2,000 XRP");

    const csv = screen.getByRole("link", { name: "Download CSV" });
    expect(csv.getAttribute("href")).toBe(`/xrpl/account/${ADDRESS}/payments.csv`);
    expect(csv.hasAttribute("download")).toBe(true);
    // A crawler does not follow it: each crawl would cost an upstream CSV of up to 1000 rows.
    expect(csv.getAttribute("rel")).toBe("nofollow");
    expect(screen.getByRole("link", { name: "Newer" }).getAttribute("href")).toBe(`/xrpl/account/${ADDRESS}?tab=payments`);
  });

  it("lists trades with the pair, the side, the amount, the price and the counterparty", async () => {
    const list: TabList = {
      state: "ok",
      tab: "trades",
      paging: { newerHref: null, olderHref: null },
      rows: [
        {
          hash: TX,
          time: 1792251771,
          side: "sell",
          pair: { base: { currency: "XRP" }, counter: { currency: "USD", issuer: ISSUER } },
          amount: { value: "512.402115", currency: "XRP" },
          price: { value: "2.4395", currency: "USD", issuer: ISSUER },
          counterparty: POOL,
        },
      ],
    };
    renderInRouter(<AccountPage network={XRPL} data={data({ tab: "trades", list })} />);
    const row = within(await screen.findByRole("table", { name: "Trades" })).getAllByRole("row")[1]!;
    expect(row.textContent).toContain("XRP/USD");
    expect(row.textContent).toContain("Sell");
    expect(row.textContent).toContain("512.402115 XRP");
    expect(row.textContent).toContain("2.4395 USD");
    expect(row.textContent).toContain(shortAddress(POOL));
  });

  it("lists open offers with the rate, read live", async () => {
    const list: TabList = {
      state: "ok",
      tab: "offers",
      ledgerIndex: 107695660,
      truncated: false,
      rows: [
        { side: "sell", quantity: { value: "500", currency: "XRP" }, total: { value: "1240.00", currency: "USD", issuer: ISSUER }, rate: { value: "2.48", quote: "USD", per: "XRP" }, sequence: 46118301 },
        { side: "buy", quantity: { value: "0", currency: "XRP" }, total: { value: "5", currency: "USD" }, rate: null, sequence: 3 },
      ],
    };
    renderInRouter(<AccountPage network={XRPL} data={data({ tab: "offers", list })} />);
    const rows = within(await screen.findByRole("table", { name: "Open offers" })).getAllByRole("row");
    expect(rows[1]!.textContent).toBe("Sell500 XRP1,240.00 USD2.48 USD / XRP46,118,301");
    expect(rows[2]!.textContent).toContain("—");
    expect(screen.getByText("Open offers, read live at ledger #107,695,660")).toBeTruthy();
    expect(screen.getByText("All 2 open offers")).toBeTruthy();
  });

  it("says 'Showing the first N open offers' and gives no total when the API's page was full, and 'All 1 open offer' for one", async () => {
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ side: "sell" as const, quantity: { value: "1", currency: "XRP" }, total: { value: "2", currency: "USD" }, rate: { value: "2", quote: "USD", per: "XRP" }, sequence: i + 1 }));
    const offers = (n: number, truncated: boolean): TabList => ({ state: "ok", tab: "offers", ledgerIndex: 107695660, rows: rows(n), truncated });
    const { unmount } = renderInRouter(<AccountPage network={XRPL} data={data({ tab: "offers", list: offers(200, true) })} />);
    expect(await screen.findByText("Showing the first 200 open offers")).toBeTruthy();
    expect(screen.queryByText(/All 200/)).toBeNull();
    unmount();
    renderInRouter(<AccountPage network={XRPL} data={data({ tab: "offers", list: offers(1, false) })} />);
    expect(await screen.findByText("All 1 open offer")).toBeTruthy();
  });

  it("lists objects with their fields, and says when the node has more than the first page", async () => {
    const list: TabList = {
      state: "ok",
      tab: "objects",
      truncated: true,
      trustLines: 4,
      offers: 2,
      ledgerIndex: 107695660,
      rows: [
        {
          key: "E1",
          type: "Escrow",
          fields: [
            { label: "Amount", value: [{ t: "amount", value: "1000", currency: "XRP" }] },
            { label: "To", value: [{ t: "account", v: BOB }] },
          ],
          tx: TX,
        },
        { key: "T1", type: "Ticket", fields: [{ label: "Ticket sequence", value: [{ t: "text", v: "77" }] }], tx: null },
      ],
    };
    renderInRouter(<AccountPage network={XRPL} data={data({ tab: "objects", list })} />);
    const items = (await screen.findAllByRole("listitem")).filter((item) => item.classList.contains("object"));
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Escrow");
    expect(items[0]!.textContent).toContain("Amount1,000 XRP");
    expect(within(items[0]!).getByRole("link", { name: shortAddress(BOB) })).toBeTruthy();
    expect(within(items[0]!).getByRole("link", { name: /Last changed in/ }).getAttribute("href")).toBe(`/xrpl/tx/${TX}`);
    expect(items[1]!.querySelector("a.object__tx")).toBeNull();
    expect(screen.getByText("Showing the first 400 objects")).toBeTruthy();
    expect(screen.getByText(/Trust lines \(4\) and offers \(2\) have their own places/)).toBeTruthy();
  });
});

describe("a page of old history", () => {
  it("shows no balance and no live state, no margin, and a link to the first page", async () => {
    const history = data({
      mode: "history",
      header: { status: "history" },
      list: transactions([txRow()], { newerHref: `/xrpl/account/${ADDRESS}`, olderHref: `/xrpl/account/${ADDRESS}?marker=M2&back=M1` }),
    });
    renderInRouter(<AccountPage network={XRPL} data={history} />);
    expect(await screen.findByRole("heading", { level: 1, name: ADDRESS })).toBeTruthy();
    expect(screen.getByText(/does not show the balance or the live state/)).toBeTruthy();
    // Neither does it say when the account was activated: that is as old as the page, and the index may not know it.
    expect(screen.queryByText(/Activat/)).toBeNull();
    expect(screen.getByRole("link", { name: "See them on the account’s first page" }).getAttribute("href")).toBe(`/xrpl/account/${ADDRESS}`);
    expect(screen.queryByRole("heading", { name: "Tokens" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Owned objects" })).toBeNull();
    expect(screen.queryByText(/Sequence/)).toBeNull();
    expect(screen.queryByText("Live state unavailable")).toBeNull();
    // The history itself is the same.
    expect(screen.getByRole("table", { name: "Transactions" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Newer" }).getAttribute("href")).toBe(`/xrpl/account/${ADDRESS}`);
  });
});

describe("NeverActivatedPage", () => {
  const never: NeverActivatedData = { kind: "never-activated", address: ADDRESS, other: { id: "xahau", name: "Xahau" } };

  it("says the address has never been activated and offers the other network", async () => {
    const router = createMemoryRouter([{ path: "*", element: <NeverActivatedPage network={XRPL} data={never} /> }], { initialEntries: [`/xrpl/account/${ADDRESS}`] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByText(/This address has never been activated on XRPL/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Not activated" })).toBeTruthy();
    expect(screen.getByText(ADDRESS)).toBeTruthy();
    expect(screen.getByRole("link", { name: `Look for ${shortAddress(ADDRESS)} on Xahau` }).getAttribute("href")).toBe(`/xahau/account/${ADDRESS}`);
    expect(screen.getByRole("link", { name: "Go to the XRPL home" }).getAttribute("href")).toBe("/xrpl");
  });
});
