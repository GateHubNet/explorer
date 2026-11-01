import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ammLiveVolumeSample, ammPoolAccount, ammPoolSample, ammPoolsSample, AMM_POOL } from "../../../test/support/amm-samples";
import { serverThenHydrated } from "../../../test/support/hydrate";
import {
  holdersSample,
  tokenDetailSample,
  tokenHolderSample,
  tokenMarketSample,
  tokenSample,
  tokenTransferSample,
  TOKEN_SAMPLE_CURRENCY,
  TOKEN_SAMPLE_ISSUER,
  TOKEN_SAMPLE_OTHER_ISSUER,
  transfersSample,
} from "../../../test/support/token-samples";
import { LAYOUT_XAHAU, LAYOUT_XRPL, LAYOUT_XRPL_TESTNET, mountPage, routedPage } from "../../../test/support/under-network";
import { NO_NAMES, type NameMap } from "../../domain/names";
import type { Loaded } from "../../server/account-view";
import type { TokenDetail } from "../../server/api-types";
import { tokenPage, type TokenInput, type TokenPageData, type TokensNet } from "../../server/token-view";
import { NO_FEATURES } from "../features";
import { NamesProvider } from "../names";
import { TokenPage } from "./TokenPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---- The world of the tests: the token page's data as the view builder writes it, drawn under the `/:net` layout -------------------------------------------------------------------

const FEATURES = { ...NO_FEATURES, tokens: true, markets: true, ammPages: true };
const XRPL: TokensNet = { ...LAYOUT_XRPL, features: FEATURES };
const XAHAU: TokensNet = { ...LAYOUT_XAHAU, features: FEATURES };
const TESTNET: TokensNet = { ...LAYOUT_XRPL_TESTNET, features: FEATURES };
const ASSET = { currency: TOKEN_SAMPLE_CURRENCY, issuer: TOKEN_SAMPLE_ISSUER };
const PATH = `/xrpl/token/RLUSD.${TOKEN_SAMPLE_ISSUER}`;

const ok = <T,>(value: T): Loaded<T> => ({ state: "ok", value });
const FAILED = { state: "failed" } as const;

/** A pool holding the token against XRP. */
const poolOf = (n: number) => ammPoolSample({ amm_account: n === 0 ? AMM_POOL : ammPoolAccount(n), base_currency: TOKEN_SAMPLE_CURRENCY, base_issuer: TOKEN_SAMPLE_ISSUER, counter_currency: "XRP" });

/** The page data of a token with every call answered, unless the input says otherwise. */
function build(over: Partial<TokenInput> = {}): TokenPageData {
  const volume = ammLiveVolumeSample();
  return tokenPage({
    net: XRPL,
    asset: ASSET,
    answer: tokenSample(),
    mode: "first",
    params: { back: [] },
    holders: ok(holdersSample()),
    transfers: ok(transfersSample()),
    pools: ok(ammPoolsSample({ pools: [poolOf(0)], count: 1, marker: undefined })),
    ammVolume: ok({ ...volume, rows: [{ ...volume.rows[0]!, components: [{ ...volume.rows[0]!.components[0]!, converted_amount: "100" }] }] }),
    accountInfo: null,
    names: NO_NAMES,
    ...over,
  }).page;
}

/** The same with the token replaced by `over`'s. */
const withToken = (over: Partial<TokenDetail>, rest: Partial<TokenInput> = {}) => build({ answer: tokenSample({ token: tokenDetailSample(over) }), ...rest });

/** The page in a data router at its own URL, drawn in the browser; the names are the route's (`NamesProvider`), as the route draws them. `loader` counts the revalidations a Retry asks for. */
function mount(data: TokenPageData, { at = PATH, network = LAYOUT_XRPL, names = {} }: { at?: string; network?: typeof LAYOUT_XRPL; names?: NameMap } = {}) {
  return mountPage(
    <NamesProvider names={names}>
      <TokenPage data={data} />
    </NamesProvider>,
    "routes/net.token.$token",
    { at, network, features: FEATURES },
  );
}

const card = (name: string) => screen.getByRole("region", { name });
const rowsOf = (table: HTMLElement) => within(table).getAllByRole("row").slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole("cell");
const texts = (nodes: Iterable<Element>) => [...nodes].map((node) => node.textContent);

// ---- The header ----------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("TokenPage: the header card", () => {
  it("has the breadcrumb, with the code as the current page", () => {
    mount(build());
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "XRPL" }).getAttribute("href")).toBe("/xrpl");
    expect(crumbs.getByRole("link", { name: "Tokens" }).getAttribute("href")).toBe("/xrpl/tokens");
    expect(crumbs.getByText("RLUSD").getAttribute("aria-current")).toBe("page");
  });

  it("is the toml's name as the h1, the code in a tag with the hex in its title and in hidden words, and the Issued token tag", () => {
    const { container } = mount(build());
    const header = screen.getByRole("region", { name: "Ripple USD" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Ripple USD");
    const code = header.querySelector(".token-page__code")!;
    expect(code.firstElementChild!.textContent).toBe("RLUSD");
    expect(code.firstElementChild!.getAttribute("title")).toBe(TOKEN_SAMPLE_CURRENCY);
    expect(code.querySelector(".sr")!.textContent).toBe(`, currency code ${TOKEN_SAMPLE_CURRENCY}`);
    expect(within(header).getByText("Issued token").className).toBe("tag");
    // The coin is decoration, with the code's first three characters.
    expect(container.querySelector(".token-page__coin")!.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".token-page__coin")!.textContent).toBe("RLU");
  });

  it("copies the hex of the code, and a 3-character code has no hex to copy", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount(build());
    fireEvent.click(screen.getByRole("button", { name: "Copy hex" }));
    expect(writeText).toHaveBeenCalledWith(TOKEN_SAMPLE_CURRENCY);
    cleanup();
    mount(withToken({ currency: "USD", code: "USD", toml: undefined }, { asset: { currency: "USD", issuer: TOKEN_SAMPLE_ISSUER } }));
    expect(screen.queryByRole("button", { name: "Copy hex" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("USD");
    expect(document.querySelector(".token-page__code .sr")).toBeNull();
    expect(document.querySelector(".token-page__code span")!.hasAttribute("title")).toBe(false);
  });

  it("names the issuer in full, by its name where the names have one, and leads to its account", () => {
    mount(build());
    const issued = screen.getByText("Issued by").closest("p")!;
    expect(within(issued).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${TOKEN_SAMPLE_ISSUER}`);
    expect(within(issued).getByRole("link").textContent).toBe(TOKEN_SAMPLE_ISSUER);
    expect(screen.getByRole("link", { name: "Issuer account" }).getAttribute("href")).toBe(`/xrpl/account/${TOKEN_SAMPLE_ISSUER}`);
    cleanup();
    const names: NameMap = { [TOKEN_SAMPLE_ISSUER]: { name: { text: "Ripple", kind: "verified" }, domain: "ripple.com", labels: [] } };
    mount(build({ names: { state: "ok", map: names } }), { names });
    expect(within(screen.getByText("Issued by").closest("p")!).getByRole("link").textContent).toContain("Ripple");
  });

  it("opens the toml file in a new tab without handing the page over, and says so in words only a screen reader reads", () => {
    mount(build());
    // The header's button; the toml card has a link to the same file, named by its address.
    const link = within(screen.getByRole("region", { name: "Ripple USD" })).getByRole("link", { name: /^xrp-ledger\.toml/ });
    expect(link.getAttribute("href")).toBe("https://ripple.com/.well-known/xrp-ledger.toml");
    expect(link.className).toBe("btn");
    expect(link.getAttribute("target")).toBe("_blank");
    const rel = link.getAttribute("rel")!.split(" ");
    expect(rel).toEqual(expect.arrayContaining(["noopener", "nofollow"]));
    expect(link.querySelector(".sr")!.textContent).toBe(" (opens in a new tab)");
    expect(link.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("has no toml button for a token with no https: toml_url, and Xahau's button is its xahau.toml", () => {
    mount(withToken({ toml_url: "javascript:alert(1)" }));
    expect(screen.queryByRole("link", { name: /\.toml/ })).toBeNull();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
    cleanup();
    mount(withToken({ toml_url: "https://ripple.com/.well-known/xahau.toml" }, { net: XAHAU, pools: null, ammVolume: null }), { at: "/xahau/token/RLUSD", network: LAYOUT_XAHAU });
    expect(within(screen.getByRole("region", { name: "Ripple USD" })).getByRole("link", { name: /^xahau\.toml/ }).getAttribute("href")).toBe("https://ripple.com/.well-known/xahau.toml");
  });

  it("shows the source line", () => {
    mount(build());
    expect(within(screen.getByRole("region", { name: "Ripple USD" })).getByText(`/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}`).className).toBe("chart__source");
  });
});

// ---- The figures ---------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("TokenPage: the figures", () => {
  it("are five tiles named Figures: the supply, holders, trust lines, price with its change as an arrow and words, and the volume", () => {
    const { container } = mount(build());
    const figures = screen.getByRole("region", { name: "Figures" });
    expect([...figures.querySelectorAll(".stat")].map((tile) => texts(tile.children))).toEqual([
      ["Supply", "7,320", "RLUSD, the sum of all holders' balances"],
      ["Holders", "120", "accounts with a positive balance"],
      ["Trust lines", "150", "30 of them with a zero balance"],
      ["Price", "0.4 XRP", "−20.00% in 24 h"],
      ["Volume, 24 h", "150 XRP", "35 trades on the DEX and AMM"],
    ]);
    // The arrow is a picture and the words say the sign.
    const delta = figures.querySelector(".stat__delta")!;
    expect(delta.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll(".stat--figure")).toHaveLength(5);
  });

  it("say the day of the last trade, or no trade, under the price", () => {
    mount(withToken({ price_change: undefined, price_time: "2026-10-03T12:00:00Z" }));
    expect(texts(screen.getByRole("region", { name: "Figures" }).querySelectorAll(".stat")[3]!.children)).toEqual(["Price", "0.4 XRP", "last trade Oct 3"]);
    cleanup();
    mount(withToken({ price: undefined }));
    expect(texts(screen.getByRole("region", { name: "Figures" }).querySelectorAll(".stat")[3]!.children)).toEqual(["Price", "—", "No trade against XRP in 30 days"]);
  });

  it("have the coverage note of the trust lines directly under them, with the ledger as a link", () => {
    const answer = tokenSample({ coverage: { from_ledger_index: 107874617, complete: false } });
    // The transfers' own coverage is complete here, so the figures' note is the only one.
    mount(build({ answer, transfers: ok(transfersSample({ coverage: { from_ledger_index: 1, complete: true } })) }));
    const note = screen.getByRole("note");
    expect(note.textContent).toBe("Covers ledger #107,874,617 onwards: earlier trust lines are not in the index yet.");
    expect(within(note).getByRole("link").getAttribute("href")).toBe("/xrpl/ledger/107874617");
    expect(card("Figures").nextElementSibling).toBe(note);
    expect(card("Recent transfers").querySelector(".coverage-note")).toBeNull();
  });

  it("have no coverage note when it is complete", () => {
    const { container } = mount(withToken({ holders: 120 }, { transfers: ok(transfersSample({ coverage: { from_ledger_index: 1, complete: true } })) }));
    expect(container.querySelector(".coverage-note")).toBeNull();
  });
});

// ---- The toml card -------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("TokenPage: the toml card", () => {
  it("is the listed entry: where it is, as a link to the file, and the list of its fields", () => {
    mount(
      withToken({
        toml: { name: "Ripple USD", desc: "A US dollar stablecoin", icon: "https://ripple.com/icon.png", display_decimals: 2, attestation: "https://ripple.com/attest.pdf" },
      }),
    );
    const toml = card("From ripple.com's toml");
    expect(toml.textContent).toContain("The [[CURRENCIES]] entry for RLUSD in ripple.com/.well-known/xrp-ledger.toml (opens in a new tab).");
    expect(within(toml).getByRole("link", { name: /^ripple\.com\/\.well-known\/xrp-ledger\.toml/ }).getAttribute("href")).toBe("https://ripple.com/.well-known/xrp-ledger.toml");
    const list = toml.querySelector("dl")!;
    expect([...list.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["code", "issuer", "name", "desc", "icon", "display_decimals", "attestation", "asset_class", "Currency code in hex"].filter((label) => label !== "asset_class"));
    const value = (label: string) => [...list.querySelectorAll(".kv")].find((kv) => kv.querySelector("dt")!.textContent === label)!.querySelector("dd")!;
    expect(value("code").textContent).toBe("RLUSD");
    expect(value("issuer").textContent).toBe(TOKEN_SAMPLE_ISSUER);
    expect(within(value("issuer")).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${TOKEN_SAMPLE_ISSUER}`);
    expect(value("name").textContent).toBe("Ripple USD");
    expect(value("display_decimals").textContent).toBe("2");
    // An icon and an attestation are links to another site, in a new tab, and never an image.
    for (const label of ["icon", "attestation"]) {
      const link = within(value(label)).getByRole("link");
      expect(link.getAttribute("href")).toMatch(/^https:\/\/ripple\.com\//);
      expect(link.getAttribute("target")).toBe("_blank");
    }
    expect(toml.querySelector("img")).toBeNull();
    // Every link out of the card is to another site (https:), opens a new tab without handing the page over, and is not for a search engine to follow.
    const out = [...toml.querySelectorAll("a[target]")];
    expect(out).toHaveLength(3);
    for (const link of out) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")!.split(" ")).toEqual(expect.arrayContaining(["noopener", "nofollow"]));
    }
    expect(value("Currency code in hex").textContent).toBe(`${TOKEN_SAMPLE_CURRENCY}Codes other than three letters are stored on the ledger as 40 hex characters.`);
  });

  it("says the toml also lists the issuer when its name is a verified one of the domain", () => {
    const names: NameMap = { [TOKEN_SAMPLE_ISSUER]: { name: { text: "Ripple", kind: "verified" }, domain: "ripple.com", labels: [] } };
    mount(build({ names: { state: "ok", map: names } }), { names });
    expect(card("From ripple.com's toml").textContent).toContain("The toml also lists the issuer, which makes its name verified.");
    cleanup();
    mount(build());
    expect(card("From ripple.com's toml").textContent).not.toContain("also lists the issuer");
  });

  it("says a domain's toml does not list the token, and that an issuer with no domain has none", () => {
    mount(withToken({ listed: false, toml: undefined }));
    expect(card("From ripple.com's toml").textContent).toBe("From ripple.com's toml" + "ripple.com's toml has no [[CURRENCIES]] entry for RLUSD by this issuer.");
    expect(screen.queryByRole("term")).toBeNull();
    cleanup();
    mount(withToken({ domain: undefined, toml_url: undefined, listed: false, toml: undefined }));
    expect(card("The issuer's toml").textContent).toContain("The issuer's account names no domain, so no toml describes RLUSD.");
  });

  it("makes a link of nothing but an https: URL: anything else the issuer wrote is text, and nothing is an image", () => {
    const hostile = {
      name: '<img src=x onerror="alert(1)">',
      desc: "<script>alert(1)</script> https://evil.example/a",
      icon: "javascript:alert(1)",
      symbol: "data:text/html;base64,PHNjcmlwdD4=",
      attestation: "https://user:pw@evil.example/x",
    };
    const { container } = mount(withToken({ toml: hostile, domain: 'evil.example/x"onmouseover="alert(1)', toml_url: "javascript:alert(1)" }));
    const toml = card(`From evil.example/x"onmouseover="alert(1)'s toml`);
    const list = toml.querySelector("dl")!;
    const value = (label: string) => [...list.querySelectorAll(".kv")].find((kv) => kv.querySelector("dt")!.textContent === label)!.querySelector("dd")!;
    for (const label of ["name", "desc", "icon", "symbol", "attestation"]) expect(value(label).querySelector("a"), label).toBeNull();
    expect(value("icon").textContent).toBe("javascript:alert(1)");
    expect(value("name").textContent).toBe('<img src=x onerror="alert(1)">');
    // Every link of the page leads to this site or to an https: URL; there is no image, no script and no src.
    for (const link of container.querySelectorAll("a[href]")) expect(link.getAttribute("href"), link.outerHTML).toMatch(/^(\/|https:\/\/)/);
    expect(container.querySelector("img, script, [src], [srcset], iframe, object, embed")).toBeNull();
    expect(container.innerHTML).not.toContain("<img");
  });
});

// ---- The issuer's settings -----------------------------------------------------------------------------------------------------------------------------------------------------

describe("TokenPage: the issuer's settings", () => {
  it("are six rows: an icon, the name, a pill with the word and the sentence of the token", () => {
    const { container } = mount(build());
    const settings = card("Issuer settings");
    expect(within(settings).getByText("Set on the issuer's account. They apply to every holder of RLUSD.")).toBeTruthy();
    const rows = [...settings.querySelectorAll("li")];
    expect(rows.map((row) => texts(row.querySelectorAll(".token-setting__head > *")))).toEqual([
      ["Transfer fee", "0.2%"],
      ["Global freeze", "Off"],
      ["No freeze", "Set"],
      ["Clawback", "Allowed"],
      ["Require auth", "Off"],
      ["Default ripple", "On"],
    ]);
    expect(rows[3]!.querySelector(".token-setting__sentence")!.textContent).toBe("The issuer can take RLUSD back from a holder's trust line.");
    // Each row has its icon, a picture; the word is in the pill.
    for (const row of rows) expect(row.querySelector(".token-setting__icon svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(rows.every((row) => row.querySelector(".pill") !== null)).toBe(true);
    expect(settings.textContent).not.toContain("Read live from the network");
    expect(container.querySelectorAll(".token-setting")).toHaveLength(6);
  });

  it("says where the rows were read from when they came from the node", () => {
    mount(withToken({ issuer_settings: undefined }, { accountInfo: ok({ account_data: { LedgerEntryType: "AccountRoot", Account: TOKEN_SAMPLE_ISSUER, Balance: "1", Flags: 0x00800000, OwnerCount: 0, Sequence: 1, PreviousTxnID: "A".repeat(64), PreviousTxnLgrSeq: 1 }, ledger_index: 1, validated: true }) }));
    const settings = card("Issuer settings");
    expect(within(settings).getByText("Read live from the network")).toBeTruthy();
    expect(texts(settings.querySelectorAll(".token-setting .pill"))).toEqual(["None", "Off", "Not set", "Not allowed", "Off", "On"]);
    expect(within(settings).getByText("the network").className).toBe("chart__source");
  });

  it("says the settings couldn't be read, with a Retry when the node failed and without one when it has no such account", () => {
    const { loader } = mount(withToken({ issuer_settings: undefined }, { accountInfo: FAILED }));
    const settings = card("Issuer settings");
    const alert = within(settings).getByRole("alert");
    expect(alert.textContent).toBe("The issuer's settings couldn't be read.Retry");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(loader).toHaveBeenCalled();
    cleanup();
    mount(withToken({ issuer_settings: undefined }, { accountInfo: { state: "missing" } }));
    expect(within(card("Issuer settings")).queryByRole("alert")).toBeNull();
    expect(within(card("Issuer settings")).getByText("The issuer's settings couldn't be read.")).toBeTruthy();
    expect(within(card("Issuer settings")).queryByRole("button")).toBeNull();
  });
});

// ---- The markets and the AMM pools ---------------------------------------------------------------------------------------------------------------------------------------------

describe("TokenPage: the markets", () => {
  it("is a named table of the board's columns: the pair as a link to the pair page, the counter's issuer, the last price, the volume and the trades", () => {
    mount(build());
    const markets = card("Markets");
    const table = within(markets).getByRole("table", { name: "Markets" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["Pair", "Last price", "Volume 24 h (XRP)", "Trades"]);
    const [native, issued] = rowsOf(table);
    expect(texts(cells(native!))).toEqual(["RLUSD / XRP", "0.4 XRP", "65", "13"]);
    expect(within(cells(native!)[0]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/markets/XRP/RLUSD.${TOKEN_SAMPLE_ISSUER}`);
    expect(cells(issued!)[0]!.textContent).toBe(`RLUSD / USDUSD by ${TOKEN_SAMPLE_OTHER_ISSUER.slice(0, 6)}…${TOKEN_SAMPLE_OTHER_ISSUER.slice(-4)}`);
    expect(within(cells(issued!)[0]!).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      `/xrpl/markets/RLUSD.${TOKEN_SAMPLE_ISSUER}/USD.${TOKEN_SAMPLE_OTHER_ISSUER}`,
      `/xrpl/account/${TOKEN_SAMPLE_OTHER_ISSUER}`,
    ]);
    expect(within(markets).getByText("Prices are the counter currency per RLUSD. DEX and AMM trades of the last 24 hours.")).toBeTruthy();
    expect(within(markets).getByText(`/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER} · last 24 h`)).toBeTruthy();
  });

  it("draws the pair as text while the markets pages are off", () => {
    mount(build({ net: { ...XRPL, features: { ...FEATURES, markets: false } } }));
    const [native] = rowsOf(within(card("Markets")).getByRole("table", { name: "Markets" }));
    expect(within(cells(native!)[0]!).queryByRole("link")).toBeNull();
    expect(cells(native!)[0]!.textContent).toBe("RLUSD / XRP");
  });

  it("says the token had no trades when it has no pair, and Xahau's words are DEX only in XAH", () => {
    mount(withToken({ markets: [] }, { net: XAHAU, pools: null, ammVolume: null }), { at: "/xahau/token/RLUSD", network: LAYOUT_XAHAU });
    const markets = card("Markets");
    expect(within(markets).getByText("RLUSD had no trades in the last 24 hours.")).toBeTruthy();
    expect(within(markets).getByText("Prices are the counter currency per RLUSD. DEX trades of the last 24 hours.")).toBeTruthy();
    expect(texts(within(markets).getAllByRole("columnheader"))[2]).toBe("Volume 24 h (XAH)");
  });
});

describe("TokenPage: the AMM pools", () => {
  it("is a named table: the pool as a link to its page with its coins, the value, the fee, the volume of the day, and the footnote in the native currency", () => {
    const { container } = mount(build());
    const pools = card("AMM pools");
    const table = within(pools).getByRole("table", { name: "AMM pools" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["Pool", "Value (XRP)", "Trading fee", "Volume 24 h"]);
    const [row] = rowsOf(table);
    expect(texts(cells(row!))).toEqual(["XRPRLUXRP / RLUSD", "5,000", "0.500%", "100"]);
    expect(within(cells(row!)[0]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/amm/${AMM_POOL}`);
    expect(container.querySelector(".token-page__poolname .amm__coins")!.getAttribute("aria-hidden")).toBe("true");
    expect(within(pools).getByText("Value and volume in XRP.")).toBeTruthy();
    expect(within(pools).getByText(`/v2/amm/pools?asset=${TOKEN_SAMPLE_CURRENCY}+${TOKEN_SAMPLE_ISSUER}`)).toBeTruthy();
    expect(within(pools).queryByRole("link", { name: /All pools/ })).toBeNull();
  });

  it("leads to all the pools with the token when there are more than five, and says when the volume could not be had", () => {
    const six = ammPoolsSample({ pools: [0, 1, 2, 3, 4, 5].map(poolOf), count: 6, marker: undefined });
    mount(build({ pools: ok(six), ammVolume: FAILED }));
    const pools = card("AMM pools");
    expect(rowsOf(within(pools).getByRole("table", { name: "AMM pools" }))).toHaveLength(5);
    expect(within(pools).getByRole("link", { name: "All pools with RLUSD →" }).getAttribute("href")).toBe(`/xrpl/amm?asset=RLUSD.${TOKEN_SAMPLE_ISSUER}`);
    expect(within(pools).getByText("Couldn't load the 24-hour volume")).toBeTruthy();
    expect(texts(pools.querySelectorAll(".table__row:not(.table__head) .table__cell:last-child"))).toEqual(["—", "—", "—", "—", "—"]);
  });

  it("says no pool holds the token", () => {
    mount(build({ pools: ok(ammPoolsSample({ pools: [], count: 0, marker: undefined })) }));
    expect(within(card("AMM pools")).getByText("No AMM pool holds RLUSD.")).toBeTruthy();
  });

  it("is Xahau's note in the pools' place, with no table and no call", () => {
    mount(withToken({}, { net: XAHAU, pools: null, ammVolume: null }), { at: "/xahau/token/RLUSD", network: LAYOUT_XAHAU });
    const pools = card("AMM pools");
    expect(pools.textContent).toContain("Xahau has no AMM, so RLUSD trades only on the order book here.");
    expect(within(pools).queryByRole("table")).toBeNull();
  });

  it("says the sandbox's name in that note", () => {
    mount(withToken({}, { net: { ...TESTNET, ...LAYOUT_XAHAU, name: "Xahau Testnet" }, pools: null, ammVolume: null }), { at: "/xahau/token/RLUSD", network: LAYOUT_XAHAU });
    expect(card("AMM pools").textContent).toContain("Xahau Testnet has no AMM, so RLUSD trades only on the order book here.");
  });
});

// ---- The holders ---------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("TokenPage: the top holders", () => {
  it("is a named table: the rank, the holder as an account link, the balance, and the share as a meter beside its percent", () => {
    const { container } = mount(build());
    const holders = card("Top holders");
    const table = within(holders).getByRole("table", { name: "Top holders" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["#", "Holder", "Balance (RLUSD)", "Share of supply"]);
    const [first, , third] = rowsOf(table);
    expect(texts(cells(first!).filter((_, at) => at !== 1))).toEqual(["1", "40.5", "0.55%"]);
    expect(within(cells(first!)[1]!).getAllByRole("link")[0]!.getAttribute("href")).toBe("/xrpl/account/rrrrrrrrrrrrrrrrrrcJYjXAZjD");
    expect(cells(third!)[3]!.textContent).toBe("0.53%");
    // The meter is a picture: the percent beside it says the value.
    const meter = holders.querySelector(".meter")!;
    expect(meter.getAttribute("aria-hidden")).toBe("true");
    expect(meter.hasAttribute("role")).toBe(false);
    expect(container.querySelectorAll(".meter")).toHaveLength(3);
    expect((holders.querySelectorAll(".meter__fill")[0] as HTMLElement).style.width).toBe("100%");
  });

  it("marks a frozen line with an icon and the word", () => {
    mount(build());
    const [first, second] = rowsOf(within(card("Top holders")).getByRole("table", { name: "Top holders" }));
    const frozen = cells(first!)[1]!.querySelector(".st")!;
    expect(frozen.textContent).toBe("Frozen");
    expect(frozen.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(cells(second!)[1]!.querySelector(".st")).toBeNull();
  });

  it("has the sentence about the top holders and the way to all of them, with the count of the holders", () => {
    mount(build());
    const holders = card("Top holders");
    expect(within(holders).getByText("The top 3 hold 1.62% of the supply.")).toBeTruthy();
    expect(within(holders).getByRole("link", { name: "All 120 holders →" }).getAttribute("href")).toBe(`${PATH}/holders`);
    expect(within(holders).getByText(`/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}/holders`)).toBeTruthy();
  });

  it("says no account holds the token", () => {
    mount(build({ holders: ok(holdersSample({ holders: [], count: 0, marker: undefined })) }));
    const holders = card("Top holders");
    expect(within(holders).getByText("No account holds RLUSD.")).toBeTruthy();
    expect(within(holders).queryByRole("link", { name: /All/ })).toBeNull();
  });

  it("draws a single holder's sentence", () => {
    mount(build({ holders: ok(holdersSample({ holders: [tokenHolderSample({ share: "1.000000" })], count: 1, marker: undefined })) }));
    expect(within(card("Top holders")).getByText("The top holder holds 100.00% of the supply.")).toBeTruthy();
  });
});

// ---- The transfers -------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("TokenPage: the recent transfers", () => {
  it("is a named table: the time in UTC on two lines, the parties as account links, the amount and the transaction", () => {
    mount(build());
    const transfers = card("Recent transfers");
    const table = within(transfers).getByRole("table", { name: "Recent transfers" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["Time (UTC)", "From", "To", "Amount (RLUSD)", "Transaction"]);
    const [first, second] = rowsOf(table);
    const [time, from, to, amount, tx] = cells(first!);
    expect(time!.textContent).toBe("2026-10-2414:21:42");
    expect(within(from!).getByRole("link").getAttribute("href")).toBe("/xrpl/account/rfaF3eu2m192LkHKdxRfzd68oEC1paa57");
    expect(within(to!).getByRole("link").getAttribute("href")).toBe("/xrpl/account/rMPwy3Ntx56Nyc2fKGNm7VRWdmpHSB92Z7");
    expect(amount!.textContent).toBe("0.002");
    expect(within(tx!).getByRole("link").getAttribute("href")).toBe("/xrpl/tx/3EBBB8672ADA7B5EADBE3878740346DD60B667D4919E1084D2E140238F0D2044");
    expect(cells(second!)[3]!.textContent).toBe("0.2121364558499999");
    expect(within(transfers).getByText(`/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}/transfers`)).toBeTruthy();
  });

  it("tags a payment from the issuer Issued and one to it Redeemed, each with an icon and the word", () => {
    const answer = transfersSample({
      transfers: [tokenTransferSample({ source: TOKEN_SAMPLE_ISSUER }), tokenTransferSample({ destination: TOKEN_SAMPLE_ISSUER, hash: "B".repeat(64) }), tokenTransferSample({ hash: "C".repeat(64) })],
    });
    mount(build({ transfers: ok(answer) }));
    const rows = rowsOf(within(card("Recent transfers")).getByRole("table", { name: "Recent transfers" }));
    const tag = (row: HTMLElement) => cells(row)[3]!.querySelector(".st");
    expect(tag(rows[0]!)!.textContent).toBe("Issued");
    expect(tag(rows[1]!)!.textContent).toBe("Redeemed");
    expect(tag(rows[2]!)).toBeNull();
    expect(tag(rows[0]!)!.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("has the footnote about the issuer, the transfers' own coverage note and the pager with Newer disabled on the first page", () => {
    mount(build());
    const transfers = card("Recent transfers");
    expect(within(transfers).getByText("Newest first. A transfer from rMxCKb…m5De issues new RLUSD; one to it redeems RLUSD.")).toBeTruthy();
    expect(within(transfers).getByRole("note").textContent).toBe("Covers ledger #11,999,941 onwards: earlier transfers are not in the index yet.");
    const pager = within(transfers).getByRole("navigation", { name: "Pagination" });
    expect(within(pager).queryByRole("link", { name: "Newer" })).toBeNull();
    expect(pager.querySelector('[aria-disabled="true"]')!.textContent).toBe("Newer");
    expect(within(pager).getByRole("link", { name: "Older" }).getAttribute("href")).toMatch(new RegExp(`^${PATH}\\?marker=`));
  });

  it("says nothing has been delivered yet", () => {
    mount(build({ transfers: ok(transfersSample({ transfers: [], count: 0, marker: undefined })) }));
    expect(within(card("Recent transfers")).getByText("No payment has delivered RLUSD yet.")).toBeTruthy();
  });
});

// ---- A card that failed --------------------------------------------------------------------------------------------------------------------------------------------------------

describe("TokenPage: a card that failed", () => {
  it.each([
    ["Top holders", { holders: FAILED }, "Couldn’t load the top holders.Retry"],
    ["Recent transfers", { transfers: FAILED }, "Couldn’t load the transfers.Retry"],
    ["AMM pools", { pools: FAILED }, "Couldn’t load the AMM pools.Retry"],
  ] satisfies Array<[string, Partial<TokenInput>, string]>)("is told in its place, with a Retry that asks the route again, and the rest of the page stands: %s", (title, over, words) => {
    const { loader } = mount(build(over));
    const alert = within(card(title)).getByRole("alert");
    expect(alert.textContent).toBe(words);
    expect(within(card(title)).queryByRole("table")).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(loader).toHaveBeenCalled();
    // The other cards are there.
    for (const other of ["Markets", "Issuer settings", "Top holders", "Recent transfers"].filter((name) => name !== title)) expect(card(other)).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

// ---- Behind a marker -----------------------------------------------------------------------------------------------------------------------------------------------------------

describe("TokenPage: a page of older transfers", () => {
  const older = (over: Partial<TokenInput> = {}) => build({ mode: "older", params: { marker: "M1", back: [] }, holders: null, pools: null, ammVolume: null, ...over });

  it("is the header, a way back to the first page and the older transfers: no figures, no other card", () => {
    mount(older(), { at: `${PATH}?marker=M1` });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Ripple USD");
    expect(screen.getByRole("link", { name: "Back to RLUSD" }).getAttribute("href")).toBe(PATH);
    expect(card("Older transfers")).toBeTruthy();
    for (const name of ["Figures", "Markets", "AMM pools", "Top holders", "Issuer settings", "From ripple.com's toml"]) expect(screen.queryByRole("region", { name }), name).toBeNull();
    const pager = within(card("Older transfers")).getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: "Newer" }).getAttribute("href")).toBe(PATH);
  });

  it("has Xahau's note nowhere", () => {
    mount(older({ net: XAHAU }), { at: "/xahau/token/RLUSD?marker=M1", network: LAYOUT_XAHAU });
    expect(screen.queryByText(/has no AMM/)).toBeNull();
  });
});

// ---- Shape of the page ---------------------------------------------------------------------------------------------------------------------------------------------------------

describe("TokenPage: as a page", () => {
  it("never fetches", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    mount(build());
    mount(build({ mode: "older", params: { marker: "M1", back: [] }, holders: null, pools: null, ammVolume: null }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("names every table, and draws no chart: the share's meter is the only graphic of the kit", () => {
    const { container } = mount(build());
    expect(screen.getAllByRole("table").map((table) => table.getAttribute("aria-label"))).toEqual(["Markets", "AMM pools", "Top holders", "Recent transfers"]);
    expect(container.querySelector("canvas, .chart, .plot")).toBeNull();
  });

  it("is the same on the server as in the browser, with a failed card, on Xahau, and for the older transfers", async () => {
    const first = await serverThenHydrated(routedPage(<TokenPage data={build({ holders: FAILED })} />, { at: PATH, features: FEATURES }));
    expect(first.errors).toEqual([]);
    expect(within(first.container).getByRole("table", { name: "Recent transfers" })).toBeTruthy();
    const xahau = await serverThenHydrated(routedPage(<TokenPage data={withToken({}, { net: XAHAU, pools: null, ammVolume: null })} />, { at: "/xahau/token/RLUSD", network: LAYOUT_XAHAU, features: FEATURES }));
    expect(xahau.errors).toEqual([]);
    const older = await serverThenHydrated(routedPage(<TokenPage data={build({ mode: "older", params: { marker: "M1", back: [] }, holders: null, pools: null, ammVolume: null })} />, { at: `${PATH}?marker=M1`, features: FEATURES }));
    expect(older.errors).toEqual([]);
  });
});
