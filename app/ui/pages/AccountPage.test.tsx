import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, createStaticHandler, createStaticRouter, RouterProvider, StaticRouterProvider } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalyticsPeriod } from "../../domain/analytics-params";
import { shortAddress } from "../../domain/format";
import { NO_NAMES, nameViewOf, type NameMap, type NamesPart } from "../../domain/names";
import { accountNameHeader, type NameHeader, type NameHeaderInput } from "../../server/account-name-view";
import type { AccountAnalyticsPageData, AccountHeader, AccountListPageData, AccountNftRow, AccountPageData, Loaded, NeverActivatedData, ObjectRow, TabList, TxRow } from "../../server/account-view";
import type { AnalyticsData } from "../../server/analytics-view";
import type { AccountNameEntry, TomlAnswer } from "../../server/api-types";
import xrplNames from "../../../test/fixtures/http/xrpl/data-api/account_names.json";
import northpeakToml from "../../../test/fixtures/http/xrpl/data-api/toml/northpeak.example.json";
import lowtideToml from "../../../test/fixtures/http/xrpl/data-api/toml/lowtide.example.json";
import { serverThenHydrated } from "../../../test/support/hydrate";
import { allSwitches } from "../../../test/support/switches";
import { LAYOUT_XAHAU, LAYOUT_XRPL, mountPage, NFTS_ON, renderUnderNetwork, routedPage } from "../../../test/support/under-network";
import { featuresOf, NO_FEATURES, type Features } from "../features";
import { NamesProvider } from "../names";
import { AccountPage, NeverActivatedPage } from "./AccountPage";

afterEach(cleanup);

// The address a request to ask GateHub for a name goes to (`NAME_REQUEST_URL`, brand.ts): the owner has not given one, so it is `null`, and a test sets one.
const brand = vi.hoisted(() => ({ nameRequestUrl: null as string | null }));
vi.mock("../brand", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../brand")>()),
  get NAME_REQUEST_URL() {
    return brand.nameRequestUrl;
  },
}));
afterEach(() => {
  brand.nameRequestUrl = null;
});

// The analytics view is a chunk of its own that the page loads with `import()` (spec 5). Here it is a stand-in that counts its loads (each run of
// its factory) and its mounts; AccountAnalytics.test.tsx tests the view itself. A test that looks at the page before the body is there holds
// the body (`holdBody`): the stand-in suspends until the hold is released, and every test of the view starts and ends with none. Vitest runs a
// mock's factory once and keeps the module until the mock is registered again (`vi.doMock`), and a second `import()` of it while a load is still
// running never settles, so a test of the view does not end before the load it started (`chunk.loading`).
const chunk = vi.hoisted(() => {
  const chunk = {
    loads: 0,
    mounts: [] as string[],
    /** Settles when the stand-in's latest load has finished. */
    loading: Promise.resolve(),
    /** While there is one, the stand-in suspends on it: the body is not there yet, and its `Suspense` shows its fallback. */
    hold: null as { until: Promise<void>; release: () => void } | null,
    /** The stand-in's module, loaded afresh each time it is called. */
    load: async () => {
      chunk.loads += 1;
      const load = import("react").then(({ createElement, use, useEffect }) => {
        function AccountAnalytics({ network, analytics }: { network: { native: string }; analytics: { period: string } }) {
          const hold = chunk.hold;
          if (hold) use(hold.until);
          useEffect(() => {
            chunk.mounts.push(analytics.period);
          }, []);
          return createElement("section", { "aria-label": "Analytics view", "data-period": analytics.period }, `The ${analytics.period} view in ${network.native}`);
        }
        return { default: AccountAnalytics };
      });
      chunk.loading = load.then(() => undefined);
      return load;
    },
  };
  return chunk;
});
vi.mock("./AccountAnalytics", () => chunk.load());

/** Holds the analytics body back until the returned function is called. */
function holdBody(): () => void {
  let resolve!: () => void;
  const hold = {
    until: new Promise<void>((settle) => (resolve = settle)),
    release: () => {
      if (chunk.hold === hold) chunk.hold = null;
      resolve();
    },
  };
  chunk.hold = hold;
  return hold.release;
}

const XRPL = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" } as const;
const XAHAU = { id: "xahau", kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX", native: "XAH", software: "xahaud" } as const;
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
  name: null,
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
  names: NO_NAMES,
});

function data(over: Partial<AccountListPageData> = {}): AccountListPageData {
  return { kind: "account", mode: "live", address: ADDRESS, native: "XRP", tab: "transactions", tag: null, qr: QR, analyticsTab: true, header: header(), list: transactions(), names: NO_NAMES, ...over };
}

const NFT_ID = "00081388AF09C1D4B4D1E8031467F3508DFFADABEA73255F370449870655E6D8";
const URI_ID = "9613336614047483F3AEC00173139D88FE9BA70720CAC2B46E12711A71A9AAE9";

/** An NFT the account holds: serial 4,127 of the collection of `ISSUER`, taxon 7, last sold for 20 XRP. */
const nftRow = (over: Partial<AccountNftRow> = {}): AccountNftRow => ({
  key: NFT_ID,
  nft: { id: NFT_ID, serial: 4127, glyph: "27" },
  collection: { label: `${shortAddress(ISSUER)} · taxon 7`, key: { issuer: ISSUER, taxon: 7 } },
  lastSale: { value: "20", currency: "XRP" },
  minted: "Oct 25, 2026",
  ...over,
});

/** A Xahau URIToken the account holds: no serial, its collection the issuer's. */
const uriRow = (over: Partial<AccountNftRow> = {}): AccountNftRow => ({
  key: URI_ID,
  nft: { id: URI_ID, glyph: "96" },
  collection: { label: shortAddress(ISSUER), key: { issuer: ISSUER } },
  lastSale: { value: "1500", currency: "XAH" },
  minted: "—",
  ...over,
});

const nftsTab = (
  rows: AccountNftRow[] = [nftRow()],
  paging: { newerHref: string | null; olderHref: string | null } = { newerHref: null, olderHref: `/xrpl/account/${ADDRESS}?tab=nfts&marker=M1` },
  coverage: Extract<TabList, { tab: "nfts" }>["coverage"] = null,
): TabList => ({ state: "ok", tab: "nfts", rows, paging, coverage, names: NO_NAMES });

/** A promise that never settles: a part of the analytics that has not streamed in. */
const pending = <T,>(): Promise<T> => new Promise<T>(() => {});

function analyticsOf(period: AnalyticsPeriod = "30d"): AnalyticsData {
  return { period, frame: pending(), value: pending(), sent: pending(), changes: pending(), counterparties: pending(), balances: pending(), pairs: pending() };
}

/** The analytics view's page. Its header has the tokens and the owned objects, which the view does not show all the same. */
function analyticsPage(over: Partial<AccountAnalyticsPageData> = {}): AccountAnalyticsPageData {
  return { kind: "account", mode: "live", address: ADDRESS, native: "XRP", tab: "analytics", tag: null, qr: QR, analyticsTab: true, header: header(), analytics: analyticsOf(), names: NO_NAMES, ...over };
}

function renderInRouter(ui: ReactElement, loader: () => null = () => null) {
  const router = createMemoryRouter([{ path: "*", element: ui, loader }], { initialEntries: [`/xrpl/account/${ADDRESS}`] });
  return { router, ...render(<RouterProvider router={router} />) };
}

/** The page under the `/:net` layout whose data holds `features`, as the app has it: what `useFeatures()` reads (the AMM pool links). */
const renderUnderLayout = (ui: ReactElement, features: Features) => renderUnderNetwork(ui, features, { path: `/xrpl/account/${ADDRESS}` });

// The list panels are a chunk of their own (`lazy`: AccountListPanels.tsx). The Worker's streaming render waits for it, and so does the browser; the
// `renderToString` of the tests that compare the server's page with the browser's cannot wait, and throws while it is not loaded. A first render loads
// it, and React keeps it for the rest of the file: one is made before the tests, so that each passes on its own too.
beforeAll(async () => {
  renderInRouter(<AccountPage network={XRPL} data={data()} />);
  await screen.findByRole("table", { name: "Transactions" });
  cleanup();
});

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
    renderInRouter(<AccountPage network={XRPL} data={data({ mode: "history", header: { status: "history", name: null } })} />);
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

// ---------------------------------------------------------------------------------------------------------------------------
// The name header (display names spec 6.1 to 6.4). The headers are what `accountNameHeader` makes of the fixtures' entries (test/fixtures/http/xrpl/data-api): the page draws what it is given.

const NAME_ENTRIES = xrplNames as unknown as Record<string, AccountNameEntry>;
/** XRPL's verified "Northpeak Treasury" (northpeak.example, whose toml lists it). */
const NORTHPEAK = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
/** A deleted account GateHub names "Harborline Exchange · hot wallet", with an advisory label (source GateHub, an https link). */
const HARBORLINE = "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC";
/** An account with a spam label and no name. */
const SPAMMED = "rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ";
/** An account whose Domain is lowtide.example, which its toml does not list, with a scam label. */
const LOWTIDE = "rURtT5MMFzSUR54MAq9MKfzBoezTBZbKns";
const NORTHPEAK_TOML: Loaded<TomlAnswer> = { state: "ok", value: northpeakToml as TomlAnswer };
const LOWTIDE_TOML: Loaded<TomlAnswer> = { state: "ok", value: lowtideToml as TomlAnswer };

/** The header of `address` as the loader builds it from the fixtures' entry for it. */
const headerOf = (address: string, over: Partial<NameHeaderInput> = {}): NameHeader =>
  accountNameHeader({ address, entry: NAME_ENTRIES[address], liveDomain: null, toml: null, network: { software: "rippled", id: "xrpl" }, ...over });

/** The page of `address`, whose header (an active account on the node unless `over` says otherwise) holds `name`; the node's domain is `domain`. */
function namedPage(address: string, name: NameHeader | null, domain: string | null, over: Partial<AccountHeader> = {}): AccountListPageData {
  const ok = header().live as Extract<AccountHeader["live"], { state: "ok" }>;
  return data({ address, header: header({ name, live: { ...ok, domain }, ...over }), qr: { ...QR, content: address } });
}

/** The header of an account that was deleted: the node has nothing of it. */
const DELETED: Partial<AccountHeader> = { status: "deleted", live: { state: "none" }, balance: null, tokens: { state: "none" }, owned: null };

const h1 = () => screen.getByRole("heading", { level: 1 });
const kindLine = () => document.querySelector(".account-head__kind")!;
const how = () => document.querySelector("details.disc") as HTMLDetailsElement;

describe("the name header: a verified name", () => {
  const page = () => namedPage(NORTHPEAK, headerOf(NORTHPEAK, { liveDomain: "northpeak.example", toml: NORTHPEAK_TOML }), "northpeak.example");

  it("is the h1 with its seal and its words, the address under it with its buttons, and the domain as a link that follows no one", async () => {
    renderInRouter(<AccountPage network={XRPL} data={page()} />);
    await screen.findByRole("heading", { level: 1 });
    // The one h1 is the name, and its accessible name says how it is known; the address is not part of it.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(h1().getAttribute("class")).toBe("account-head__name");
    expect(h1().textContent).toBe("Northpeak Treasury verified name");
    expect(h1().querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("heading", { level: 1, name: "Northpeak Treasury verified name" })).toBeTruthy();

    // The address under it, in mono, with the copy and QR buttons next to it; the label above both.
    const row = document.querySelector(".account-id__address")!;
    expect(row.querySelector(".mono")!.textContent).toBe(NORTHPEAK);
    expect(h1().compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(row as HTMLElement).getByRole("button", { name: "Copy address" })).toBeTruthy();
    expect(row.querySelector("details.qr")).not.toBeNull();
    expect(screen.getByText("Account", { selector: ".account-id__label" })).toBeTruthy();

    const link = within(kindLine() as HTMLElement).getByRole("link", { name: "northpeak.example (opens in a new tab)" });
    expect(kindLine().textContent).toBe("Verified name · domain northpeak.example (opens in a new tab)");
    expect(link.getAttribute("href")).toBe("https://northpeak.example");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("has 'How we know' closed, a native disclosure with its words in the summary, and two passed checks, when it was checked and the facts once it is opened", async () => {
    renderInRouter(<AccountPage network={XRPL} data={page()} />);
    await screen.findByRole("heading", { level: 1 });
    const disclosure = how();
    expect(disclosure.hasAttribute("open")).toBe(false);
    const summary = disclosure.querySelector(":scope > summary")!;
    expect(summary.textContent).toBe("How we know");
    expect(summary.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");

    disclosure.open = true;
    expect(disclosure.hasAttribute("open")).toBe(true);
    const checks = [...disclosure.querySelectorAll("ul > li")];
    expect(checks.map((check) => check.textContent)).toEqual([
      "Passed: The account's Domain field is northpeak.example.",
      "Passed: northpeak.example/.well-known/xrp-ledger.toml (opens in a new tab) lists this address under [[ACCOUNTS]], and its desc gives the name.",
    ]);
    // A check is a shape and words: the tick is decoration, "Passed: " is what a screen reader hears first.
    for (const check of checks) {
      expect(check.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
      expect(check.querySelector(".sr")!.textContent).toBe("Passed: ");
    }
    expect(checks[0]!.querySelector("strong, b")!.textContent).toBe("northpeak.example");
    const file = checks[1]!.querySelector("a")!;
    expect(file.getAttribute("href")).toBe("https://northpeak.example/.well-known/xrp-ledger.toml");
    expect(file.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect([...checks[1]!.querySelectorAll(".mono")].map((mono) => mono.textContent)).toEqual(["northpeak.example/.well-known/xrp-ledger.toml", "[[ACCOUNTS]]", "desc"]);
    expect(disclosure.textContent).toContain("Checked Oct 17, 2026, 06:00 UTC");
  });

  it("lists what else the toml says, each row only when it has one: the principals, the currencies as text in mono, and the date from [METADATA]", async () => {
    renderInRouter(<AccountPage network={XRPL} data={page()} />);
    await screen.findByRole("heading", { level: 1 });
    expect(how().textContent).toContain("What else that toml says");
    const facts = how().querySelector("dl.toml-facts")!;
    const rows = [...facts.querySelectorAll(":scope > div")].map((row) => [row.querySelector("dt")!.textContent, row.querySelector("dd")!.textContent]);
    expect(rows).toEqual([
      ["Principals", "Mara Lindqvist and Tomas Okafor"],
      ["Currencies", "NPUSD NPEUR"],
      ["Last modified", "Oct 2, 2026 from [METADATA]"],
    ]);
    const currencies = [...facts.querySelectorAll("dd")[1]!.children];
    expect(currencies.map((currency) => currency.className)).toEqual(["mono", "mono"]);
    // Plain text for now: E11 makes them links when `TOKENS` is on.
    expect(facts.querySelectorAll("a")).toHaveLength(0);
  });

  it("has no row for what the toml does not give: a date, the principals, the currencies, and no box at all when it gives none of them", async () => {
    const { modified: _modified, ...withoutDate } = NORTHPEAK_TOML.value.toml;
    const given = (toml: TomlAnswer["toml"]) => ({ state: "ok", value: { result: "success", toml } }) as const;
    const { unmount } = renderInRouter(<AccountPage network={XRPL} data={namedPage(NORTHPEAK, headerOf(NORTHPEAK, { liveDomain: "northpeak.example", toml: given(withoutDate) }), "northpeak.example")} />);
    await screen.findByRole("heading", { level: 1 });
    expect([...how().querySelectorAll("dl.toml-facts dt")].map((dt) => dt.textContent)).toEqual(["Principals", "Currencies"]);
    unmount();
    cleanup();

    const { principals: _principals, currencies: _currencies, ...bare } = withoutDate;
    renderInRouter(<AccountPage network={XRPL} data={namedPage(NORTHPEAK, headerOf(NORTHPEAK, { liveDomain: "northpeak.example", toml: given(bare) }), "northpeak.example")} />);
    await screen.findByRole("heading", { level: 1 });
    expect(how().querySelector(".toml-facts")).toBeNull();
    expect(how().textContent).not.toContain("What else that toml says");
  });

  it("says the name is the domain when the toml gives no desc, and leaves out the facts and the time when it gave nothing", async () => {
    const entry: AccountNameEntry = { address: NORTHPEAK, display_name: { text: "northpeak.example", kind: "verified" }, domain: "northpeak.example" };
    const name = accountNameHeader({ address: NORTHPEAK, entry, liveDomain: "northpeak.example", toml: { state: "missing" }, network: { software: "rippled", id: "xrpl" } });
    renderInRouter(<AccountPage network={XRPL} data={namedPage(NORTHPEAK, name, "northpeak.example")} />);
    await screen.findByRole("heading", { level: 1 });
    expect(h1().textContent).toBe("northpeak.example verified name");
    const checks = [...how().querySelectorAll("ul > li")].map((check) => check.textContent);
    expect(checks[1]).toBe("Passed: northpeak.example/.well-known/xrp-ledger.toml (opens in a new tab) lists this address under [[ACCOUNTS]]. It gives no desc, so the name is the domain.");
    expect(how().textContent).not.toContain("Checked");
    expect(how().querySelector(".toml-facts")).toBeNull();
    expect(how().textContent).not.toContain("What else that toml says");
  });

  it("is on the server's page as it is in the browser: the disclosure is there, closed, with its words, for a reader without script", async () => {
    const element = <AccountPage network={XRPL} data={page()} />;
    const handler = createStaticHandler([{ path: "*", element }]);
    const context = await handler.query(new Request(`http://explorer.test/xrpl/account/${NORTHPEAK}`));
    if (context instanceof Response) throw new Error("expected a render");
    const html = renderToString(<StaticRouterProvider router={createStaticRouter(handler.dataRoutes, context)} context={context} hydrate={false} />);
    expect(html).toContain('<details class="disc">');
    expect(html).toContain("<summary>How we know");
    expect(html).toContain("The account&#x27;s Domain field is");
    expect(html).toContain("Mara Lindqvist and Tomas Okafor");
    expect(html).not.toMatch(/<details class="disc" open/);
  });
});

describe("the name header: a name GateHub gave", () => {
  // The fixture's account is deleted, so the node has no domain for it, and the entry has none.
  const deleted = (name = headerOf(HARBORLINE)) => namedPage(HARBORLINE, name, null, DELETED);

  it("is the link text as the h1 with the tag, its label's mark, 'Named by GateHub · no domain set', and the help sentence with no link while there is no address to ask", async () => {
    renderInRouter(<AccountPage network={XRPL} data={deleted()} />);
    await screen.findByRole("heading", { level: 1 });
    expect(h1().textContent).toBe("Harborline Exchange · hot wallet named by GateHub labelled advisory by GateHub");
    expect(document.querySelector(".account-id__address .mono")!.textContent).toBe(HARBORLINE);
    expect(kindLine().textContent).toBe("Named by GateHub · no domain set");
    const help = screen.getByText(/GateHub names accounts that have no verified name/);
    expect(help.textContent).toBe(
      "GateHub names accounts that have no verified name, such as an exchange's hot wallet. If this name is wrong, or an account you run should have one, ask GateHub to change it.",
    );
    expect(within(help).queryByRole("link")).toBeNull();
    // No disclosure for a name that is not verified by a toml.
    expect(document.querySelector("details.disc")).toBeNull();
  });

  it("makes 'ask GateHub to change it' a link once there is an address to ask", async () => {
    brand.nameRequestUrl = "https://gatehub.example/names";
    renderInRouter(<AccountPage network={XRPL} data={deleted()} />);
    const help = (await screen.findByText(/GateHub names accounts that have no verified name/)) as HTMLElement;
    const link = within(help).getByRole("link", { name: "ask GateHub to change it (opens in a new tab)" });
    expect(link.getAttribute("href")).toBe("https://gatehub.example/names");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(help.textContent).toMatch(/ask GateHub to change it \(opens in a new tab\)\.$/);
  });

  it("says its domain with the state of its check when it names one: the mark carries the sentence of what the toml said", async () => {
    // The account is named by GateHub and names a domain whose toml does not list it.
    const entry: AccountNameEntry = { ...NAME_ENTRIES[HARBORLINE]!, domain: "lowtide.example" };
    const name = headerOf(HARBORLINE, { entry, liveDomain: "lowtide.example", toml: LOWTIDE_TOML });
    renderInRouter(<AccountPage network={XRPL} data={namedPage(HARBORLINE, name, "lowtide.example")} />);
    await screen.findByRole("heading", { level: 1 });
    const sentence =
      "This account names lowtide.example in its Domain field, but lowtide.example's xrp-ledger.toml does not list the account. The explorer shows the domain, without vouching for it.";
    expect(kindLine().textContent).toBe("Named by GateHub · domain lowtide.example not verified");
    expect(kindLine().querySelector(".mono")!.textContent).toBe("lowtide.example");
    const mark = kindLine().querySelector(".st")!;
    expect(mark.textContent).toBe("not verified");
    // The mouse has it as the mark's title; everyone else has it as a line of text, as for a name that is only the domain, between the kind and the help.
    expect(mark.getAttribute("title")).toBe(sentence);
    const lines = [...document.querySelectorAll(".account-head__kind")].map((line) => line.textContent);
    expect(lines).toEqual(["Named by GateHub · domain lowtide.example not verified", sentence, expect.stringMatching(/^GateHub names accounts that have no verified name/)]);
    // Nobody vouches for it: no link to it.
    expect(kindLine().querySelector("a")).toBeNull();
  });

  it("does not say the sentence again for a domain that is only not checked yet: its words are the mark's", async () => {
    const entry: AccountNameEntry = { ...NAME_ENTRIES[HARBORLINE]!, domain: "lowtide.example" };
    // The index has the domain, the node shows another one: nothing is known of that one yet.
    const name = headerOf(HARBORLINE, { entry, liveDomain: "other.example", toml: null });
    renderInRouter(<AccountPage network={XRPL} data={namedPage(HARBORLINE, name, "other.example")} />);
    await screen.findByRole("heading", { level: 1 });
    expect(kindLine().textContent).toBe("Named by GateHub · domain other.example not checked yet");
    expect([...document.querySelectorAll(".account-head__kind")]).toHaveLength(2);
  });
});

// A link in a sentence is told from the words around it by more than its colour (WCAG 1.4.1): the stylesheet underlines the links of the header's lines, checks and banners. Axe cannot
// say it of these (the hidden "(opens in a new tab)" of an `ExternalLink` makes its check incomplete), so each link the header draws is held to the selectors that underline. That
// components.css has a rule that underlines each of them is test/unit/account-css.test.ts's (this environment reads no stylesheet).
describe("the links of the name header", () => {
  const underlined = [".account-head__kind a", ".disc__checks a", ".notice--warning a"];
  /** The links the name header and the banners draw: not the activation line's or the tabs'. */
  const headerLinks = () => [...document.querySelectorAll<HTMLAnchorElement>(".account-id__top a, .account-head__kind a, details.disc a, .notice--warning a")];

  it.each([
    ["a verified name: its domain, and the toml in the checks", () => namedPage(NORTHPEAK, headerOf(NORTHPEAK, { liveDomain: "northpeak.example", toml: NORTHPEAK_TOML }), "northpeak.example"), ["https://northpeak.example", "https://northpeak.example/.well-known/xrp-ledger.toml"]],
    ["a name GateHub gave, with its label's banner and the address to ask", () => namedPage(HARBORLINE, headerOf(HARBORLINE), null, DELETED), ["https://gatehub.example/names", "https://status.example/harborline"]],
  ] as const)("holds every link of %s to a rule that underlines", async (_state, page, hrefs) => {
    brand.nameRequestUrl = "https://gatehub.example/names";
    renderInRouter(<AccountPage network={XRPL} data={page()} />);
    await screen.findByRole("heading", { level: 1 });
    const links = headerLinks();
    expect(links.map((link) => link.getAttribute("href"))).toEqual(expect.arrayContaining([...hrefs]));
    for (const link of links) expect(underlined.some((selector) => link.matches(selector)), `${link.getAttribute("href")} is underlined`).toBe(true);
  });
});

describe("the name header: a domain that is not verified", () => {
  const page = () => namedPage(LOWTIDE, headerOf(LOWTIDE, { liveDomain: "lowtide.example", toml: LOWTIDE_TOML }), "lowtide.example");

  it("is the domain as the h1 with the visible tag 'not verified', the sentence of 6.3 under the address, and no link to the domain", async () => {
    renderInRouter(<AccountPage network={XRPL} data={page()} />);
    await screen.findByRole("heading", { level: 1 });
    expect(h1().textContent).toBe("lowtide.example not verified labelled scam by GateHub");
    expect(h1().querySelector(".unv")!.textContent).toBe("not verified");
    expect(document.querySelector(".account-id__address .mono")!.textContent).toBe(LOWTIDE);
    expect(kindLine().textContent).toBe(
      "This account names lowtide.example in its Domain field, but lowtide.example's xrp-ledger.toml does not list the account. The explorer shows the domain, without vouching for it.",
    );
    expect(document.querySelector(".account-head__kind a")).toBeNull();
    expect(document.querySelector("details.disc")).toBeNull();
    // The activation line does not say the domain again.
    expect(screen.getByText(/Activated on/).closest("p")!.textContent).not.toContain("domain");
  });

  it("keeps its banner, with no source and no link when the label has none", async () => {
    renderInRouter(<AccountPage network={XRPL} data={page()} />);
    await screen.findByRole("heading", { level: 1 });
    const banner = screen.getByText("Labelled scam by GateHub").closest(".notice") as HTMLElement;
    expect(banner.textContent).toBe("Labelled scam by GateHubTest label");
    expect(within(banner).queryByRole("link")).toBeNull();
  });
});

describe("the name header: no name", () => {
  it("is today's h1, the address, and a domain on the activation line that was not checked yet, saying so in words", async () => {
    // The names batch has nothing for this account, and the node says its domain is example.com.
    const name = accountNameHeader({ address: ADDRESS, entry: undefined, liveDomain: "example.com", toml: null, network: { software: "rippled", id: "xrpl" } });
    renderInRouter(<AccountPage network={XRPL} data={data({ header: header({ name }) })} />);
    expect(await screen.findByRole("heading", { level: 1, name: ADDRESS })).toBeTruthy();
    expect(h1().className).toBe("mono");
    const meta = screen.getByText(/Activated on/).closest("p")!;
    expect(meta.textContent).toBe(`Activated on 2019-03-14 18:40:00 UTC by ${shortAddress(PARENT)} with 25 XRP · domain example.com not checked yet`);
    expect(meta.querySelector("span.mono")!.textContent).toBe("example.com");
    expect(meta.querySelector(".st")!.textContent).toBe("not checked yet");
    expect(within(meta).queryAllByRole("link")).toHaveLength(2);
    expect(document.querySelector(".account-head__kind")).toBeNull();
    expect(document.querySelector("details.disc")).toBeNull();
  });

  it("writes a Domain that is no domain as text, with no mark", async () => {
    const name = accountNameHeader({ address: ADDRESS, entry: undefined, liveDomain: "https://example.com", toml: null, network: { software: "rippled", id: "xrpl" } });
    renderInRouter(<AccountPage network={XRPL} data={namedPage(ADDRESS, name, "https://example.com")} />);
    const meta = (await screen.findByText(/Activated on/)).closest("p")!;
    expect(meta.textContent).toMatch(/ · domain https:\/\/example\.com$/);
    expect(meta.querySelector(".st")).toBeNull();
  });

  it("is today's page for a header the names call left out (the switch is off, or the call failed)", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data({ header: header({ name: null }) })} />);
    await screen.findByRole("heading", { level: 1, name: ADDRESS });
    expect(screen.getByText(/Activated on/).closest("p")!.textContent).toMatch(/ · domain example\.com$/);
    expect(document.querySelector(".st")).toBeNull();
    expect(document.querySelector(".notice--warning")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe(`XRPL/Accounts/${shortAddress(ADDRESS)}`);
  });

  it("keeps the address as the h1 for an account that has labels only, with the label's mark and its banner", async () => {
    renderInRouter(<AccountPage network={XRPL} data={namedPage(SPAMMED, headerOf(SPAMMED), null)} />);
    await screen.findByRole("heading", { level: 1 });
    expect(h1().className).toBe("mono");
    expect(h1().textContent).toBe(`${SPAMMED} labelled spam by GateHub`);
    expect(h1().querySelector(".labelmark svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Labelled spam by GateHub").closest(".notice--warning")).not.toBeNull();
    // The copy and QR buttons are beside the h1, not in it.
    expect(h1().querySelector("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy address" })).toBeTruthy();
  });
});

describe("the label banners", () => {
  const harborline = () => namedPage(HARBORLINE, headerOf(HARBORLINE), null, DELETED);

  it("is one warning notice for each label: its title, its description, 'Source: GateHub' and 'Details', a link that follows no one", async () => {
    renderInRouter(<AccountPage network={XRPL} data={harborline()} />);
    await screen.findByRole("heading", { level: 1 });
    const banners = [...document.querySelectorAll(".notice--warning")].filter((notice) => notice.textContent!.includes("Labelled"));
    expect(banners).toHaveLength(1);
    const banner = banners[0] as HTMLElement;
    expect(banner.querySelector(".notice__title")!.textContent).toBe("Labelled advisory by GateHub");
    expect(banner.textContent).toContain("Test label: withdrawals paused");
    expect(within(banner).getByText("Source: GateHub")).toBeTruthy();
    const details = within(banner).getByRole("link", { name: "Details (opens in a new tab)" });
    expect(details.getAttribute("href")).toBe("https://status.example/harborline");
    expect(details.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    // A banner is no heading: the page keeps its one h1 and its order of headings.
    expect(banner.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("is after the breadcrumb and before the header's card, a deleted account's too, which keeps its own banner above the breadcrumb", async () => {
    renderInRouter(<AccountPage network={XRPL} data={harborline()} />);
    await screen.findByRole("heading", { level: 1 });
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    const label = screen.getByText("Labelled advisory by GateHub").closest(".notice")!;
    const card = document.querySelector(".account-card")!;
    const deleted = screen.getByText("Deleted").closest(".notice")!;
    const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(deleted, crumbs)).toBe(true);
    expect(follows(crumbs, label)).toBe(true);
    expect(follows(label, card)).toBe(true);
  });

  it("is one for each label, in the API's order, whatever the labels' keys", async () => {
    const entry: AccountNameEntry = {
      address: SPAMMED,
      labels: { scam: { description: "First", source: "GateHub", url: "https://status.example/a" }, spam: { description: "Second" }, advisory: { description: "Third", url: "http://status.example/c" } },
    };
    renderInRouter(<AccountPage network={XRPL} data={namedPage(SPAMMED, headerOf(SPAMMED, { entry }), null)} />);
    await screen.findByRole("heading", { level: 1 });
    const banners = [...document.querySelectorAll(".notice--warning")];
    expect(banners.map((banner) => banner.querySelector(".notice__title")!.textContent)).toEqual(["Labelled scam by GateHub", "Labelled spam by GateHub", "Labelled advisory by GateHub"]);
    expect(h1().textContent).toBe(`${SPAMMED} labelled scam, spam and advisory by GateHub`);
    // Only an https link is a link.
    expect(within(banners[0] as HTMLElement).getByRole("link", { name: /Details/ })).toBeTruthy();
    expect(within(banners[2] as HTMLElement).queryByRole("link")).toBeNull();
    expect(banners[2]!.textContent).not.toContain("Details");
  });
});

describe("the name header: the breadcrumb and the activation line", () => {
  it("ends the breadcrumb with the link text, cut by the stylesheet and not here, in place of the short address", async () => {
    renderInRouter(<AccountPage network={XRPL} data={namedPage(HARBORLINE, headerOf(HARBORLINE), null, DELETED)} />);
    await screen.findByRole("heading", { level: 1 });
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.textContent).toBe("XRPL/Accounts/Harborline Exchange · hot wallet");
    const last = crumbs.querySelector("[aria-current='page']")!;
    expect(last.querySelector(".acct__name")!.textContent).toBe("Harborline Exchange · hot wallet");
    expect(last.classList.contains("mono")).toBe(false);
  });

  it("keeps the short address in the breadcrumb of an account with no name, and of one with labels only", async () => {
    renderInRouter(<AccountPage network={XRPL} data={namedPage(SPAMMED, headerOf(SPAMMED), null)} />);
    await screen.findByRole("heading", { level: 1 });
    const last = screen.getByRole("navigation", { name: "Breadcrumb" }).querySelector("[aria-current='page']")!;
    expect(last.textContent).toBe(shortAddress(SPAMMED));
    expect(last.classList.contains("mono")).toBe(true);
  });

  it("drops the domain from the activation line when the name's lines say it: a verified name's and a GateHub-named account's", async () => {
    renderInRouter(<AccountPage network={XRPL} data={namedPage(NORTHPEAK, headerOf(NORTHPEAK, { liveDomain: "northpeak.example", toml: NORTHPEAK_TOML }), "northpeak.example")} />);
    const meta = (await screen.findByText(/Activated on/)).closest("p")!;
    expect(meta.textContent).toBe(`Activated on 2019-03-14 18:40:00 UTC by ${shortAddress(PARENT)} with 25 XRP`);
  });

  it("draws the activator by the page's names, as every account link is: a provider above the page holds them", async () => {
    const view = nameViewOf({ address: PARENT, display_name: { text: "Copperfield Payments", kind: "verified" }, domain: "copperfield.example" })!;
    const names: NameMap = { [PARENT]: view };
    renderInRouter(
      <NamesProvider names={names}>
        <AccountPage network={XRPL} data={data({ names: { state: "ok", map: names } })} />
      </NamesProvider>,
    );
    const meta = (await screen.findByText(/Activated on/)).closest("p")!;
    const link = within(meta).getByRole("link", { name: "Copperfield Payments verified name" });
    expect(link.getAttribute("href")).toBe(`/xrpl/account/${PARENT}`);
  });

  it("names the toml file xahau.toml on Xahau", async () => {
    const name = accountNameHeader({
      address: NORTHPEAK,
      entry: NAME_ENTRIES[NORTHPEAK],
      liveDomain: "northpeak.example",
      toml: NORTHPEAK_TOML,
      network: { software: "xahaud", id: "xahau" },
    });
    renderInRouter(<AccountPage network={XAHAU} data={namedPage(NORTHPEAK, name, "northpeak.example")} />);
    await screen.findByRole("heading", { level: 1 });
    expect(how().querySelector("a")!.getAttribute("href")).toBe("https://northpeak.example/.well-known/xahau.toml");
  });
});

describe("the name header: a page of old history", () => {
  it("is the name and the labels only: the h1, its marks, the banners, and no line, no disclosure", async () => {
    // A page behind a marker is stored for good: its header is the entry's name and labels (`brief`), never a domain.
    const name = accountNameHeader({ address: HARBORLINE, entry: NAME_ENTRIES[HARBORLINE], liveDomain: null, toml: null, network: { software: "rippled", id: "xrpl" }, brief: true });
    renderInRouter(<AccountPage network={XRPL} data={data({ address: HARBORLINE, mode: "history", header: { status: "history", name }, qr: { ...QR, content: HARBORLINE } })} />);
    await screen.findByRole("heading", { level: 1 });
    expect(h1().textContent).toBe("Harborline Exchange · hot wallet named by GateHub labelled advisory by GateHub");
    expect(screen.getByText("Labelled advisory by GateHub")).toBeTruthy();
    expect(document.querySelector(".account-head__kind")).toBeNull();
    expect(screen.queryByText(/GateHub names accounts that have no verified name/)).toBeNull();
    expect(document.querySelector("details.disc")).toBeNull();
    expect(screen.getByText(/does not show the balance or the live state/)).toBeTruthy();
  });
});

describe("the names of the list", () => {
  const view = nameViewOf({ address: BOB, display_name: { text: "Copperfield Payments", kind: "verified" }, domain: "copperfield.example" })!;
  const named = (): NamesPart => ({ state: "ok", map: { [BOB]: view } });
  const asNamed = (rows: TxRow[] = [txRow()]): TabList => ({ ...(transactions(rows) as Extract<TabList, { state: "ok"; tab: "transactions" }>), names: named() });

  it("draws the accounts of a list by the names of the list's own data, not the page's", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data({ list: asNamed() })} />);
    const table = await screen.findByRole("table", { name: "Transactions" });
    const link = within(table).getByRole("link", { name: "Copperfield Payments verified name" });
    expect(link.getAttribute("href")).toBe(`/xrpl/account/${BOB}`);
    expect(link.getAttribute("title")).toBe(`Verified by copperfield.example · ${BOB}`);
  });

  it("draws the accounts of a list that streams in by the names that came with it", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data({ list: Promise.resolve(asNamed()) })} />);
    expect(await screen.findByRole("link", { name: "Copperfield Payments verified name" })).toBeTruthy();
  });

  it("draws the short address for an account the list's names do not hold", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data({ list: transactions() })} />);
    const table = await screen.findByRole("table", { name: "Transactions" });
    expect(within(table).getByRole("link", { name: shortAddress(BOB) })).toBeTruthy();
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

// AMM_PAGES (AMM spec 5.3): while it is on, an LP token's pool and a pool account's own page lead to the pool page; while it is off, the page is
// as it was, with the pool's account link. The account page reads the switch with `useFeatures()`, from the layout's data.
describe("the links to the AMM pool page", () => {
  const AMM_ON = { ...NO_FEATURES, ammPages: true };
  const AMM_OFF = { ...featuresOf(allSwitches("on")), ammPages: false };
  const LINE = "This account is an AMM pool. See the pool →";
  const ok = header().live as Extract<AccountHeader["live"], { state: "ok" }>;
  /** The header of a pool account: the node names its `amm` flag (account-view.ts's flags of an AccountRoot). */
  const poolAccount = (over: Partial<AccountHeader> = {}) => header({ live: { ...ok, flags: [{ id: "amm", label: "AMM pool account" }] }, ...over });
  const tokensCard = async () => (await screen.findByRole("heading", { name: "Tokens" })).closest("section")!;

  it("makes an LP token's 'AMM pool r…' one link to the pool page while it is on", async () => {
    renderUnderLayout(<AccountPage network={XRPL} data={data()} />, AMM_ON);
    const card = await tokensCard();
    const link = within(card).getByRole("link", { name: `AMM pool ${shortAddress(POOL)}` });
    expect(link.getAttribute("href")).toBe(`/xrpl/amm/${POOL}`);
    expect(link.closest(".token__issuer")!.textContent).toBe(`AMM pool ${shortAddress(POOL)}`);
    // The pool's account page is not linked from the card; the other token's issuer still is.
    expect(within(card).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([`/xrpl/account/${ISSUER}`, `/xrpl/amm/${POOL}`]);
  });

  it("keeps an LP token's pool as 'AMM pool' and the account link while it is off, and without the layout's data", async () => {
    renderUnderLayout(<AccountPage network={XRPL} data={data()} />, AMM_OFF);
    let card = await tokensCard();
    expect(within(card).getByRole("link", { name: shortAddress(POOL) }).getAttribute("href")).toBe(`/xrpl/account/${POOL}`);
    expect(card.querySelector(".token__issuer a[href*='/amm/']")).toBeNull();
    expect(card.innerHTML).not.toContain("/xrpl/amm/");
    cleanup();
    renderInRouter(<AccountPage network={XRPL} data={data()} />);
    card = await tokensCard();
    expect(within(card).getByRole("link", { name: shortAddress(POOL) }).getAttribute("href")).toBe(`/xrpl/account/${POOL}`);
    expect(card.innerHTML).not.toContain("/xrpl/amm/");
  });

  it("says under the address of a pool account that it is one, with a link to its pool page, while it is on", async () => {
    renderUnderLayout(<AccountPage network={XRPL} data={data({ address: POOL, header: poolAccount() })} />, AMM_ON);
    const line = (await screen.findByText(/This account is an AMM pool\./)).closest("p")!;
    expect(line.textContent).toBe(LINE);
    const link = within(line).getByRole("link", { name: "See the pool →" });
    expect(link.getAttribute("href")).toBe(`/xrpl/amm/${POOL}`);
    expect(within(line).getAllByRole("link")).toHaveLength(1);
    // Under the address: after the address's own block, before the activation.
    const card = screen.getByRole("region", { name: "Account" });
    const order = [card.querySelector(".account-id__top")!, line, screen.getByText(/Activated on/).closest("p")!];
    for (let i = 1; i < order.length; i += 1) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The flag stays where the flags are.
    expect(document.querySelector(".account-flags")!.textContent).toContain("AMM pool account");
  });

  it("says nothing of the pool page on a pool account while it is off, or without the layout's data", async () => {
    renderUnderLayout(<AccountPage network={XRPL} data={data({ address: POOL, header: poolAccount() })} />, AMM_OFF);
    await screen.findByText("AMM pool account");
    expect(screen.queryByText(/This account is an AMM pool/)).toBeNull();
    expect(screen.queryByRole("link", { name: "See the pool →" })).toBeNull();
    cleanup();
    renderInRouter(<AccountPage network={XRPL} data={data({ address: POOL, header: poolAccount() })} />);
    await screen.findByText("AMM pool account");
    expect(screen.queryByText(/This account is an AMM pool/)).toBeNull();
  });

  it("has no pool line when the node did not answer (the flag comes from account_info), on a deleted account, or on an account that is no pool", async () => {
    for (const live of [{ state: "unavailable" }, { state: "none" }] as const) {
      renderUnderLayout(<AccountPage network={XRPL} data={data({ address: POOL, header: poolAccount({ live, owned: null, nodeProblem: live.state === "unavailable" }) })} />, AMM_ON);
      await screen.findByRole("heading", { level: 1, name: POOL });
      expect(screen.queryByText(/This account is an AMM pool/), live.state).toBeNull();
      cleanup();
    }
    renderUnderLayout(<AccountPage network={XRPL} data={data({ address: POOL, header: poolAccount({ status: "deleted", live: { state: "none" }, balance: null, tokens: { state: "none" }, owned: null }) })} />, AMM_ON);
    await screen.findByRole("heading", { level: 1, name: POOL });
    expect(screen.queryByText(/This account is an AMM pool/)).toBeNull();
    cleanup();
    renderUnderLayout(<AccountPage network={XRPL} data={data()} />, AMM_ON);
    await screen.findByText("Requires destination tag");
    expect(screen.queryByText(/This account is an AMM pool/)).toBeNull();
  });
});

describe("the tabs", () => {
  /** The tab bar's links: text, href, aria-current and rel. */
  async function tabLinks() {
    const nav = await screen.findByRole("navigation", { name: "Account activity" });
    return within(nav)
      .getAllByRole("link")
      .map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current"), a.getAttribute("rel")]);
  }

  it("are links, one is current, and the NFTs and Analytics lead to their views (Analytics rel=nofollow), while NFTS and ACCOUNT_ANALYTICS are on", async () => {
    renderUnderLayout(<AccountPage network={XRPL} data={data({ tab: "payments" })} />, NFTS_ON);
    expect(await tabLinks()).toEqual([
      ["Transactions", `/xrpl/account/${ADDRESS}`, null, null],
      ["Payments", `/xrpl/account/${ADDRESS}?tab=payments`, "page", null],
      ["Trades", `/xrpl/account/${ADDRESS}?tab=trades`, null, null],
      ["Offers", `/xrpl/account/${ADDRESS}?tab=offers`, null, null],
      ["Objects", `/xrpl/account/${ADDRESS}?tab=objects`, null, null],
      ["NFTs", `/xrpl/account/${ADDRESS}?tab=nfts`, null, null],
      ["Analytics", `/xrpl/account/${ADDRESS}?tab=analytics`, null, "nofollow"],
    ]);
    expect(screen.queryByText("soon")).toBeNull();
  });

  it("show Analytics as a disabled tab that says 'soon' while ACCOUNT_ANALYTICS is off", async () => {
    renderInRouter(<AccountPage network={XRPL} data={data({ tab: "payments", analyticsTab: false })} />);
    expect((await tabLinks()).map(([label]) => label)).toEqual(["Transactions", "Payments", "Trades", "Offers", "Objects"]);
    const nav = screen.getByRole("navigation", { name: "Account activity" });
    const soon = within(nav).getByText("Analytics").parentElement!;
    expect(soon.getAttribute("aria-disabled")).toBe("true");
    expect(soon.textContent).toBe("Analyticssoon");
    expect(soon.tagName).toBe("SPAN");
    expect(nav.innerHTML).not.toContain("tab=analytics");
  });

  it("lead to the analytics view from a page of old history too: the view is live mode", async () => {
    const history = data({ mode: "history", header: { status: "history", name: null }, list: transactions([txRow()], { newerHref: `/xrpl/account/${ADDRESS}`, olderHref: null }) });
    renderInRouter(<AccountPage network={XRPL} data={history} />);
    expect((await tabLinks()).at(-1)).toEqual(["Analytics", `/xrpl/account/${ADDRESS}?tab=analytics`, null, "nofollow"]);
  });

  it("lead to the analytics view on the network of the page", async () => {
    renderInRouter(<AccountPage network={XAHAU} data={data({ native: "XAH" })} />);
    expect((await tabLinks()).at(-1)).toEqual(["Analytics", `/xahau/account/${ADDRESS}?tab=analytics`, null, "nofollow"]);
  });

  describe("the NFTs tab", () => {
    const NFTS_OFF: Features = { ...NFTS_ON, nfts: false };

    it("is a link between Objects and Analytics, called NFTs, the current one on its own page, while NFTS is on", async () => {
      renderUnderLayout(<AccountPage network={XRPL} data={data({ tab: "nfts", list: nftsTab() })} />, NFTS_ON);
      const links = await tabLinks();
      expect(links.map(([label]) => label)).toEqual(["Transactions", "Payments", "Trades", "Offers", "Objects", "NFTs", "Analytics"]);
      expect(links.filter(([, , current]) => current !== null)).toEqual([["NFTs", `/xrpl/account/${ADDRESS}?tab=nfts`, "page", null]]);
      expect(screen.queryByText("soon")).toBeNull();
    });

    it("is called URITokens on Xahau, and leads to the tab on the network of the page", async () => {
      renderUnderLayout(<AccountPage network={XAHAU} data={data({ native: "XAH", tab: "nfts", list: nftsTab() })} />, NFTS_ON);
      const links = await tabLinks();
      expect(links.find(([label]) => label === "URITokens")).toEqual(["URITokens", `/xahau/account/${ADDRESS}?tab=nfts`, "page", null]);
      expect(links.map(([label]) => label)).not.toContain("NFTs");
    });

    it("is a link from every tab, and from a page of old history, where the live state is not", async () => {
      const history = data({ mode: "history", header: { status: "history", name: null }, list: transactions([txRow()], { newerHref: `/xrpl/account/${ADDRESS}`, olderHref: null }) });
      renderUnderLayout(<AccountPage network={XRPL} data={history} />, NFTS_ON);
      expect((await tabLinks()).find(([label]) => label === "NFTs")).toEqual(["NFTs", `/xrpl/account/${ADDRESS}?tab=nfts`, null, null]);
    });

    it.each([
      ["XRPL", XRPL, "NFTs"],
      ["Xahau", XAHAU, "URITokens"],
    ])("is a disabled tab that says 'soon', not a link, while NFTS is off: on %s too", async (_name, network, label) => {
      renderUnderLayout(<AccountPage network={network} data={data({ tab: "payments", native: network.native })} />, NFTS_OFF);
      const nav = await screen.findByRole("navigation", { name: "Account activity" });
      expect((await tabLinks()).map(([text]) => text)).not.toContain(label);
      const soon = within(nav).getByText(label).parentElement!;
      expect(soon.getAttribute("aria-disabled")).toBe("true");
      expect(soon.textContent).toBe(`${label}soon`);
      expect(soon.tagName).toBe("SPAN");
      expect(nav.innerHTML).not.toContain("tab=nfts");
    });

    it("is 'soon' without the layout's data too: every switch is off there", async () => {
      renderInRouter(<AccountPage network={XRPL} data={data()} />);
      const nav = await screen.findByRole("navigation", { name: "Account activity" });
      expect(within(nav).getByText("NFTs").parentElement!.textContent).toBe("NFTssoon");
      expect(nav.innerHTML).not.toContain("tab=nfts");
    });
  });
});

// Each test of the view stands alone (the stand-in `chunk`, at the top of this file): it starts with no hold and no mounts, and it ends with the
// page unmounted, any hold released and the stand-in's load finished.
describe("the analytics view", () => {
  beforeEach(() => {
    chunk.mounts.length = 0;
  });
  afterEach(async () => {
    cleanup();
    chunk.hold?.release();
    await chunk.loading;
  });

  it("is warmed by the Analytics tab: its chunk is loaded when the pointer enters the tab or the tab takes the focus, and not before", async () => {
    // A load of the chunk of its own, whatever the tests before this one loaded.
    vi.doMock("./AccountAnalytics", () => chunk.load());
    const before = chunk.loads;
    renderInRouter(<AccountPage network={XRPL} data={data()} />);
    const nav = await screen.findByRole("navigation", { name: "Account activity" });
    const tab = within(nav).getByRole("link", { name: "Analytics" });
    // Drawing the page, the other tabs among it, loads nothing.
    fireEvent.pointerEnter(within(nav).getByRole("link", { name: "Payments" }));
    fireEvent.focus(within(nav).getByRole("link", { name: "Payments" }));
    await act(async () => {});
    expect(chunk.loads).toBe(before);

    fireEvent.pointerEnter(tab);
    await waitFor(() => expect(chunk.loads).toBe(before + 1));
    await act(async () => chunk.loading);

    vi.doMock("./AccountAnalytics", () => chunk.load());
    fireEvent.focus(tab);
    await waitFor(() => expect(chunk.loads).toBe(before + 2));
    await act(async () => chunk.loading);
    // The visitor did not go there: no view was drawn.
    expect(chunk.mounts).toEqual([]);
  });

  it("is the notices, the breadcrumbs and the account card, then the Activity card with the tabs and the filters, then the lazy body in its own Suspense", async () => {
    const release = holdBody();
    renderInRouter(<AccountPage network={XRPL} data={analyticsPage({ tag: 7 })} />);
    const activity = await screen.findByRole("region", { name: "Activity" });
    const viewStatuses = () => screen.getAllByRole("status").filter((status) => !status.closest(".account-card"));
    try {
      expect(screen.getByRole("heading", { level: 1, name: ADDRESS })).toBeTruthy();
      expect(screen.getByText("Destination tag 7")).toBeTruthy();
      expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();

      // No Holdings margin: neither the tokens nor the owned objects, though the header has both.
      expect(document.querySelector('aside[aria-label="Holdings"]')).toBeNull();
      expect(screen.queryByRole("heading", { name: "Tokens" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Owned objects" })).toBeNull();
      expect(document.querySelector(".cols")).toBeNull();

      // The Activity card: the tabs, Analytics current, and the filter row under them; no list.
      const nav = within(activity).getByRole("navigation", { name: "Account activity" });
      const current = within(nav).getByRole("link", { name: "Analytics" });
      expect(current.getAttribute("aria-current")).toBe("page");
      expect(current.getAttribute("href")).toBe(`/xrpl/account/${ADDRESS}?tab=analytics`);
      const filters = within(activity).getByRole("group", { name: "Analytics filters" });
      expect(nav.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(activity).queryByRole("table")).toBeNull();
      expect(screen.queryByText(/Loading transactions/)).toBeNull();

      // The body is below the card. Until it is there (its chunk loading, here the body held) it is a frame hidden from assistive technology:
      // the filter row's status is the view's one status (spec 3.11), and it says the view is loading. (The account card's copy button has a
      // status of its own, on every tab.)
      const waiting = screen.getByText("Loading…").closest("[aria-hidden]");
      expect(waiting?.getAttribute("aria-hidden")).toBe("true");
      expect(activity.contains(waiting)).toBe(false);
      expect(activity.compareDocumentPosition(waiting!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(viewStatuses().map((status) => status.textContent)).toEqual(["Loading analytics…"]);
      expect(screen.queryByRole("region", { name: "Analytics view" })).toBeNull();
    } finally {
      await act(async () => release());
    }

    const body = await screen.findByRole("region", { name: "Analytics view" });
    expect(body.textContent).toBe("The 30d view in XRP");
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(activity.contains(body)).toBe(false);
    expect(activity.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(viewStatuses().map((status) => status.className)).toEqual(["analytics-filters__note"]);
  });

  it("keys the body by the period: another period is drawn afresh, new data of the same period is not", async () => {
    let setPage!: (page: AccountPageData) => void;
    function Switching() {
      const [current, set] = useState<AccountPageData>(analyticsPage());
      setPage = set;
      return <AccountPage network={XRPL} data={current} />;
    }
    renderInRouter(<Switching />);
    await screen.findByRole("region", { name: "Analytics view" });
    expect(chunk.mounts).toEqual(["30d"]);

    await act(async () => setPage(analyticsPage()));
    expect(chunk.mounts).toEqual(["30d"]);

    await act(async () => setPage(analyticsPage({ analytics: analyticsOf("90d") })));
    expect((await screen.findByRole("region", { name: "Analytics view" })).getAttribute("data-period")).toBe("90d");
    expect(chunk.mounts).toEqual(["30d", "90d"]);
  });

  it("has the Live state unavailable notice with its Retry above it when the node did not answer, as the other tabs do", async () => {
    renderInRouter(<AccountPage network={XRPL} data={analyticsPage({ header: header({ live: { state: "unavailable" }, owned: null, tokens: { state: "none" }, nodeProblem: true }) })} />);
    const notice = (await screen.findByText("Live state unavailable")).closest<HTMLElement>(".notice")!;
    expect(notice.getAttribute("role")).toBe("status");
    expect(within(notice).getByRole("button", { name: "Retry" })).toBeTruthy();
    const body = await screen.findByRole("region", { name: "Analytics view" });
    expect(notice.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
      names: NO_NAMES,
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
      names: NO_NAMES,
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
      names: NO_NAMES,
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
    const offers = (n: number, truncated: boolean): TabList => ({ state: "ok", tab: "offers", ledgerIndex: 107695660, rows: rows(n), truncated, names: NO_NAMES });
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
      names: NO_NAMES,
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

describe("the NFTs", () => {
  /** The page as the app has it on `net`: under the layout whose data holds the network and the switches (NFTS is on unless a test says), which the NFT links read. */
  const mount = (ui: ReactElement, net: "xrpl" | "xahau" = "xrpl", features: Features = NFTS_ON) =>
    renderUnderNetwork(ui, features, { path: `/${net}/account/${ADDRESS}?tab=nfts`, network: net === "xrpl" ? LAYOUT_XRPL : LAYOUT_XAHAU });
  const xrpl = (list: TabList | Promise<TabList>) => <AccountPage network={XRPL} data={data({ tab: "nfts", list })} />;
  const xahau = (list: TabList | Promise<TabList>) => <AccountPage network={XAHAU} data={data({ tab: "nfts", native: "XAH", list })} />;

  it("are a table of the NFT, its collection, the last sale and the day of the mint", async () => {
    mount(xrpl(nftsTab([nftRow(), nftRow({ key: "2".repeat(64), nft: { id: "2".repeat(64), serial: 5, glyph: "05" }, lastSale: null, minted: "—" })])));
    const table = await screen.findByRole("table", { name: "NFTs" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toBe("NFTCollectionLast saleMinted");
    const first = rows[1]!;
    expect(first.textContent).toContain("27");
    expect(first.textContent).toContain("#4,127");
    expect(first.textContent).toContain("00081388…E6D8");
    expect(first.textContent).toContain(`${shortAddress(ISSUER)} · taxon 7`);
    expect(first.textContent).toContain("20 XRP");
    expect(first.textContent).toContain("Oct 25, 2026");
    // The second has no sale and no mint to tell: dashes.
    expect(within(rows[2]!).getAllByText("—")).toHaveLength(2);
  });

  it("link the NFT to its page, with the whole id as its title, and the collection to its page", async () => {
    mount(xrpl(nftsTab()));
    const row = within(await screen.findByRole("table", { name: "NFTs" })).getAllByRole("row")[1]!;
    const nft = within(row).getByRole("link", { name: "#4,127" });
    expect(nft.getAttribute("href")).toBe(`/xrpl/nft/${NFT_ID}`);
    expect(nft.getAttribute("title")).toBe(NFT_ID);
    const collection = within(row).getByRole("link", { name: `${shortAddress(ISSUER)} · taxon 7` });
    expect(collection.getAttribute("href")).toBe(`/xrpl/nfts/${ISSUER}/7`);
    expect(within(row).getAllByRole("link")).toHaveLength(2);
    // The glyph is decoration: the NFT is named beside it.
    expect(row.querySelector(".nft-glyph")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("show the last sale as the price it was made at, with no conversion and no '≈'", async () => {
    mount(xrpl(nftsTab([nftRow({ lastSale: { value: "1.50", currency: "USD", issuer: ISSUER } })])));
    const row = within(await screen.findByRole("table", { name: "NFTs" })).getAllByRole("row")[1]!;
    expect(row.textContent).toContain("1.50 USD");
    expect(row.textContent).not.toContain("≈");
    expect(document.body.textContent).not.toContain("≈");
  });

  it("are the URITokens of Xahau: a table of that name, the short id for the token, no serial, its collection the issuer's", async () => {
    mount(xahau(nftsTab([uriRow()], { newerHref: null, olderHref: null })), "xahau");
    const table = await screen.findByRole("table", { name: "URITokens" });
    const rows = within(table).getAllByRole("row");
    expect(rows[0]!.textContent).toBe("URITokenCollectionLast saleMinted");
    const token = within(rows[1]!).getByRole("link", { name: "96133366…AAE9" });
    expect(token.getAttribute("href")).toBe(`/xahau/nft/${URI_ID}`);
    expect(token.getAttribute("title")).toBe(URI_ID);
    expect(rows[1]!.textContent).not.toContain("#");
    expect(within(rows[1]!).getByRole("link", { name: shortAddress(ISSUER) }).getAttribute("href")).toBe(`/xahau/nfts/${ISSUER}`);
    expect(rows[1]!.textContent).toContain("1,500 XAH");
    expect(screen.getByText("Showing 1 URIToken")).toBeTruthy();
  });

  it("keep the API's order and count what the page lists", async () => {
    const rows = [nftRow({ key: "B".repeat(64), nft: { id: "B".repeat(64), serial: 9, glyph: "09" } }), nftRow({ key: "A".repeat(64), nft: { id: "A".repeat(64), serial: 100, glyph: "00" } }), nftRow({ key: "C".repeat(64), nft: { id: "C".repeat(64), serial: 3, glyph: "03" } })];
    mount(xrpl(nftsTab(rows)));
    const table = await screen.findByRole("table", { name: "NFTs" });
    expect(within(table).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("link")[0]!.textContent)).toEqual(["#9", "#100", "#3"]);
    expect(screen.getByText("Showing 3 NFTs")).toBeTruthy();
  });

  it("say in the footer how many the page shows, not a total the index does not give, in the network's words", async () => {
    mount(xrpl(nftsTab([nftRow(), nftRow({ key: "B".repeat(64), nft: { id: "B".repeat(64), serial: 9, glyph: "09" } })])));
    const table = await screen.findByRole("table", { name: "NFTs" });
    const foot = screen.getByText("Showing 2 NFTs");
    expect(table.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    mount(xahau(nftsTab([uriRow(), uriRow({ key: "C".repeat(64), nft: { id: "C".repeat(64), glyph: "CC" } })])), "xahau");
    expect(await screen.findByText("Showing 2 URITokens")).toBeTruthy();
    expect(screen.queryByText(/^Showing \d+ NFTs?$/)).toBeNull();
  });

  it("have a pager: Older is a link to the next page of the tab, Newer is disabled on the first page", async () => {
    mount(xrpl(nftsTab()));
    const pager = await screen.findByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: "Older" }).getAttribute("href")).toBe(`/xrpl/account/${ADDRESS}?tab=nfts&marker=M1`);
    expect(within(pager).queryByRole("link", { name: "Newer" })).toBeNull();
    expect(screen.getByText("Showing 1 NFT")).toBeTruthy();
  });

  it("say so when the account holds none, in the network's words, and say nothing of a coverage that is whole", async () => {
    mount(xrpl(nftsTab([], { newerHref: null, olderHref: null })));
    expect(await screen.findByText("This account holds no NFTs in the index.")).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
    cleanup();
    mount(xahau(nftsTab([], { newerHref: null, olderHref: null })), "xahau");
    expect(await screen.findByText("This account holds no URITokens in the index.")).toBeTruthy();
  });

  it("have the coverage note under the table, with the ledger it starts at as a link to that ledger", async () => {
    mount(xrpl(nftsTab([nftRow()], { newerHref: null, olderHref: null }, { before: "Covers ledger ", ledger: 96100001, after: " onwards: earlier NFTs are not in the index yet." })));
    const note = await screen.findByRole("note");
    expect(note.textContent).toBe("Covers ledger #96,100,001 onwards: earlier NFTs are not in the index yet.");
    expect(within(note).getByRole("link", { name: "#96,100,001" }).getAttribute("href")).toBe("/xrpl/ledger/96100001");
    // Under the list, before its footer.
    const table = screen.getByRole("table", { name: "NFTs" });
    expect(table.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(screen.getByText("Showing 1 NFT")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("show the note of the empty list too: a list that is empty because the index starts late says so", async () => {
    mount(xrpl(nftsTab([], { newerHref: null, olderHref: null }, { before: "The index does not hold this history yet.", ledger: null, after: "" })));
    expect(await screen.findByText("This account holds no NFTs in the index.")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toBe("The index does not hold this history yet.");
  });

  it("show a placeholder in the network's words until the list streams in", async () => {
    let settle!: (list: TabList) => void;
    const list = new Promise<TabList>((resolve) => (settle = resolve));
    mount(xrpl(list));
    expect(await screen.findByText("Loading NFTs…")).toBeTruthy();
    settle(nftsTab());
    expect(await screen.findByRole("table", { name: "NFTs" })).toBeTruthy();
    cleanup();
    mount(xahau(new Promise<TabList>(() => {})), "xahau");
    expect(await screen.findByText("Loading URITokens…")).toBeTruthy();
  });

  it("say 'Couldn’t load NFTs' with a Retry that fetches the route's own data again", async () => {
    const { loader: mounted } = mountPage(<AccountPage network={XRPL} data={data({ tab: "nfts", list: Promise.resolve<TabList>({ state: "failed", what: "NFTs" }) })} />, "account", { at: `/xrpl/account/${ADDRESS}?tab=nfts` });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn’t load NFTs.");
    const calls = mounted.mock.calls.length;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mounted.mock.calls.length).toBe(calls + 1));
  });

  it("say what failed in the network's words when the list's own promise is refused", async () => {
    const refused = Promise.reject(new Error("no")) as Promise<TabList>;
    refused.catch(() => {});
    mount(xahau(refused), "xahau");
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t load URITokens.");
  });

  it("are a page of old history behind a marker, with the tabs and the table and no live state", async () => {
    const history = data({
      tab: "nfts",
      mode: "history",
      header: { status: "history", name: null },
      list: nftsTab([nftRow()], { newerHref: `/xrpl/account/${ADDRESS}?tab=nfts`, olderHref: null }),
    });
    mount(<AccountPage network={XRPL} data={history} />);
    expect(await screen.findByRole("table", { name: "NFTs" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Newer" }).getAttribute("href")).toBe(`/xrpl/account/${ADDRESS}?tab=nfts`);
    expect(screen.getByText(/does not show the balance or the live state/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Tokens" })).toBeNull();
  });

  it("are the same on the server as in the browser, on both networks and when empty", async () => {
    for (const [net, element] of [
      ["xrpl", xrpl(nftsTab([nftRow()], { newerHref: null, olderHref: null }, { before: "Covers ledger ", ledger: 5, after: " onwards: earlier NFTs are not in the index yet." }))],
      ["xahau", xahau(nftsTab([uriRow()], { newerHref: null, olderHref: null }))],
      ["xrpl", xrpl(nftsTab([], { newerHref: null, olderHref: null }))],
    ] as const) {
      const at = `/${net}/account/${ADDRESS}?tab=nfts`;
      const { errors } = await serverThenHydrated(routedPage(element, { at, network: net === "xrpl" ? LAYOUT_XRPL : LAYOUT_XAHAU }));
      expect(errors, net).toEqual([]);
    }
  });
});

describe("the NFT objects", () => {
  const mount = (rows: ObjectRow[], net: "xrpl" | "xahau" = "xrpl", features: Features = NFTS_ON) => {
    const list: TabList = { state: "ok", tab: "objects", rows, trustLines: 0, offers: 0, truncated: false, ledgerIndex: 107695660, names: NO_NAMES };
    const network = net === "xrpl" ? XRPL : XAHAU;
    return renderUnderNetwork(<AccountPage network={network} data={data({ tab: "objects", native: network.native, list })} />, features, {
      path: `/${net}/account/${ADDRESS}?tab=objects`,
      network: net === "xrpl" ? LAYOUT_XRPL : LAYOUT_XAHAU,
    });
  };
  const page: ObjectRow = { key: "N1", type: "NFTokenPage", fields: [{ label: "NFTs", value: [{ t: "text", v: "32" }] }], tx: TX, link: { label: "See the account’s NFTs", href: `/xrpl/account/${ADDRESS}?tab=nfts` } };
  const offer: ObjectRow = {
    key: "F1",
    type: "NFTokenOffer",
    fields: [
      { label: "NFT", value: [{ t: "nft", v: NFT_ID }] },
      { label: "Side", value: [{ t: "text", v: "Sell" }] },
      { label: "Amount", value: [{ t: "amount", value: "25", currency: "XRP" }] },
      { label: "Only for", value: [{ t: "account", v: BOB }] },
      { label: "Expires", value: [{ t: "text", v: "2026-10-14 17:46:40 UTC" }] },
    ],
    tx: null,
  };
  const token: ObjectRow = {
    key: URI_ID,
    type: "URIToken",
    fields: [
      { label: "URIToken", value: [{ t: "nft", v: URI_ID }] },
      { label: "Issuer", value: [{ t: "account", v: ISSUER }] },
      { label: "Sell offer", value: [{ t: "amount", value: "1500", currency: "XAH" }, { t: "text", v: ", only for " }, { t: "account", v: BOB }] },
    ],
    tx: null,
  };
  const items = async () => (await screen.findAllByRole("listitem")).filter((item) => item.classList.contains("object"));

  it("leads from an NFT page to the account's NFTs, keeping 'NFTs: 32'", async () => {
    mount([page]);
    const [item] = await items();
    expect(item!.textContent).toContain("NFTs32");
    expect(within(item!).getByRole("link", { name: "See the account’s NFTs" }).getAttribute("href")).toBe(`/xrpl/account/${ADDRESS}?tab=nfts`);
    expect(within(item!).getByRole("link", { name: /Last changed in/ }).getAttribute("href")).toBe(`/xrpl/tx/${TX}`);
  });

  it("has no such link when the loader gave the row none: NFTS is off", async () => {
    const { link: _link, ...bare } = page;
    mount([bare], "xrpl", { ...NFTS_ON, nfts: false });
    const [item] = await items();
    expect(item!.textContent).toContain("NFTs32");
    expect(within(item!).queryByRole("link", { name: /See the account/ })).toBeNull();
  });

  it("shows an NFT offer's NFT as a link to the NFT, its side, amount, who it is only for and when it expires", async () => {
    mount([offer]);
    const [item] = await items();
    expect([...item!.querySelectorAll(".object__field")].map((field) => field.textContent)).toEqual(["NFT00081388…E6D8", "SideSell", "Amount25 XRP", `Only for${shortAddress(BOB)}`, "Expires2026-10-14 17:46:40 UTC"]);
    const link = within(item!).getByRole("link", { name: "00081388…E6D8" });
    expect(link.getAttribute("href")).toBe(`/xrpl/nft/${NFT_ID}`);
    expect(link.getAttribute("title")).toBe(NFT_ID);
    expect(within(item!).getByRole("link", { name: shortAddress(BOB) })).toBeTruthy();
  });

  it("shows a URIToken as a link to the token, its issuer and its sell offer, only for the account it is offered to", async () => {
    mount([token], "xahau");
    const [item] = await items();
    expect([...item!.querySelectorAll(".object__field")].map((field) => field.textContent)).toEqual(["URIToken96133366…AAE9", `Issuer${shortAddress(ISSUER)}`, `Sell offer1,500 XAH, only for ${shortAddress(BOB)}`]);
    expect(within(item!).getByRole("link", { name: "96133366…AAE9" }).getAttribute("href")).toBe(`/xahau/nft/${URI_ID}`);
    expect(within(item!).getByRole("link", { name: shortAddress(BOB) }).getAttribute("href")).toBe(`/xahau/account/${BOB}`);
  });

  it("shows the NFT ids as text, in mono with the whole id as the title, while NFTS is off: no link to an NFT page", async () => {
    const { container } = mount([offer, token], "xrpl", { ...NFTS_ON, nfts: false });
    const found = await items();
    expect(found).toHaveLength(2);
    expect(container.querySelector("a[href*='/nft/']")).toBeNull();
    for (const [id, short] of [[NFT_ID, "00081388…E6D8"], [URI_ID, "96133366…AAE9"]] as const) {
      const text = container.querySelector(`span.mono[title="${id}"]`);
      expect(text!.textContent).toBe(short);
    }
  });
});

describe("a page of old history", () => {
  it("shows no balance and no live state, no margin, and a link to the first page", async () => {
    const history = data({
      mode: "history",
      header: { status: "history", name: null },
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
