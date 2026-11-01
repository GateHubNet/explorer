import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import {
  TOKEN_SAMPLE_CURRENCY,
  TOKEN_SAMPLE_ISSUER,
  TOKEN_SAMPLE_OTHER_ISSUER,
  tokenCoverageSample,
  tokenRowSample,
  tokensSample,
  TOKENS_MARKER,
} from "../../../test/support/token-samples";
import { LAYOUT_XAHAU, LAYOUT_XRPL, LAYOUT_XRPL_TESTNET, mountPage, routedPage } from "../../../test/support/under-network";
import { shortAddress } from "../../domain/format";
import { NO_NAMES, type NameMap } from "../../domain/names";
import { parseTokensParams } from "../../domain/token-params";
import type { TokensResponse } from "../../server/api-types";
import { tokensPage, type TokensInput, type TokensNet, type TokensPageData } from "../../server/token-view";
import { NO_FEATURES } from "../features";
import { NamesProvider } from "../names";
import { TokensPage } from "./TokensPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---- The world of the tests: the list's page data as the view builder writes it, drawn under the `/:net` layout ----------------------------------------------------------------

const FEATURES = { ...NO_FEATURES, tokens: true };
const XRPL: TokensNet = { ...LAYOUT_XRPL, features: FEATURES };
const XAHAU: TokensNet = { ...LAYOUT_XAHAU, features: FEATURES };
const TESTNET: TokensNet = { ...LAYOUT_XRPL_TESTNET, features: FEATURES };

/** The page data of the list at `query` for `answer` (D6's sample unless one is given; `null` is the search that was too long), as the loader hands it to the page. */
function build(query = "", answer: TokensResponse | null = tokensSample(), over: Partial<TokensInput> = {}): TokensPageData {
  return tokensPage({ net: XRPL, params: parseTokensParams(new URLSearchParams(query), { mptAvailable: false }), mptAvailable: false, answer, names: NO_NAMES, ...over });
}

/** The page in a data router at its own URL, drawn in the browser; the names are the route's (`NamesProvider`), as the route draws them. */
function mount(data: TokensPageData, { at = "/xrpl/tokens", network = LAYOUT_XRPL, names = {} }: { at?: string; network?: typeof LAYOUT_XRPL; names?: NameMap } = {}) {
  return mountPage(
    <NamesProvider names={names}>
      <TokensPage data={data} />
    </NamesProvider>,
    "routes/net.tokens",
    { at, network, features: FEATURES },
  );
}

const rows = () => within(screen.getByRole("table", { name: "Issued tokens" })).getAllByRole("row").slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole("cell");
const texts = (nodes: Iterable<Element>) => [...nodes].map((node) => node.textContent);

/** A page of twenty rows of a list of 1,284: the second page, so that both links of the pager are there. */
const secondPage = (): TokensResponse =>
  tokensSample({
    total: 1284,
    total_below: 48206,
    count: 20,
    marker: "M3",
    tokens: Array.from({ length: 20 }, (_, at) => tokenRowSample({ rank: 21 + at, currency: `T${at + 10}`, code: `T${at + 10}`, issuer: TOKEN_SAMPLE_OTHER_ISSUER, name: undefined })),
  });

// ---- The head ----------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("TokensPage: the heading, the kind tabs and the tiles", () => {
  it("has the breadcrumb, the h1 and the intro, on the network's name", () => {
    mount(build());
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "XRPL" }).getAttribute("href")).toBe("/xrpl");
    expect(crumbs.getByText("Tokens").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tokens");
    expect(screen.getByText("Tokens on XRPL, ranked by holders. Names come from each issuer's toml.").tagName).toBe("P");
  });

  it("says Xahau's and the sandbox's names", () => {
    mount(build("", tokensSample(), { net: XAHAU }), { at: "/xahau/tokens", network: LAYOUT_XAHAU });
    expect(screen.getByText("Tokens on Xahau, ranked by holders. Names come from each issuer's toml.")).toBeTruthy();
    cleanup();
    mount(build("", tokensSample(), { net: TESTNET }), { network: LAYOUT_XRPL_TESTNET });
    expect(screen.getByText("Tokens on XRPL Testnet, ranked by holders. Names come from each issuer's toml.")).toBeTruthy();
  });

  it("draws the kind tabs as a named group: Issued tokens current, MPT disabled and soon on XRPL, with the source line", () => {
    const { container } = mount(build());
    const group = screen.getByRole("group", { name: "Kind of token" });
    const issued = within(group).getByRole("link", { name: "Issued tokens" });
    expect(issued.getAttribute("href")).toBe("/xrpl/tokens");
    expect(issued.getAttribute("aria-current")).toBe("true");
    expect(within(group).getAllByRole("link")).toHaveLength(1);
    const mpt = container.querySelector(".is-disabled")!;
    expect(mpt.tagName).toBe("SPAN");
    expect(mpt.getAttribute("aria-disabled")).toBe("true");
    expect(mpt.textContent).toBe("MPTsoon");
    expect(screen.getByText("/v2/tokens?kind=issued&min_holders=10")).toBeTruthy();
  });

  it("explains the disabled MPT tab on Xahau in a note that describes it", () => {
    const { container } = mount(build("", tokensSample(), { net: XAHAU }), { at: "/xahau/tokens", network: LAYOUT_XAHAU });
    const note = screen.getByText("MPT isn't enabled on Xahau.");
    expect(container.querySelector(".is-disabled")!.getAttribute("aria-describedby")).toBe(note.id);
    expect(container.querySelector(".is-disabled .soon")).toBeNull();
  });

  it("names the source line without min_holders under all", () => {
    mount(build("all=1"));
    expect(screen.getByText("/v2/tokens?kind=issued")).toBeTruthy();
  });

  it("draws the three tiles of the totals", () => {
    mount(build());
    const totals = screen.getByRole("region", { name: "Totals" });
    expect([...totals.querySelectorAll(".stat")].map((tile) => texts(tile.children))).toEqual([
      ["Tokens with 10+ holders", "9", "6 more have fewer than 10 holders"],
      ["Holders", "4,321", "accounts holding at least one issued token"],
      ["Volume, 24 h", "243.5 XRP", "DEX and AMM trades of every pair"],
    ]);
    expect(totals.querySelectorAll(".stat--figure")).toHaveLength(3);
  });

  it("draws Xahau's volume in XAH with DEX words, and a dash where D6 has no figure", () => {
    const answer = tokensSample({ totals: { tokens: 15, tokens_with_10_holders: 9, native_volume: "1234567.89" } });
    mount(build("", answer, { net: XAHAU }), { at: "/xahau/tokens", network: LAYOUT_XAHAU });
    const totals = screen.getByRole("region", { name: "Totals" });
    expect([...totals.querySelectorAll(".stat")].map((tile) => texts(tile.children).slice(1))).toEqual([
      ["9", "6 more have fewer than 10 holders"],
      ["—", "accounts holding at least one issued token"],
      ["1.23M XAH", "DEX trades of every pair"],
    ]);
  });

  it("draws dashes under the same labels when D6 has no totals yet", () => {
    mount(build("", { result: "success", coverage: tokenCoverageSample(), kind: "issued", count: 0, tokens: [] }));
    const totals = screen.getByRole("region", { name: "Totals" });
    expect([...totals.querySelectorAll(".stat")].map((tile) => [tile.children[0]!.textContent, tile.children[1]!.textContent])).toEqual([
      ["Tokens with 10+ holders", "—"],
      ["Holders", "—"],
      ["Volume, 24 h", "—"],
    ]);
  });
});

// ---- The table -----------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("TokensPage: the issued tokens", () => {
  it("is a card with a named table of the board's columns, in the network's currency", () => {
    mount(build());
    const card = screen.getByRole("region", { name: "Issued tokens" });
    expect(card.tagName).toBe("SECTION");
    const table = screen.getByRole("table", { name: "Issued tokens" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["#", "Token", "Issuer", "Holders", "Supply", "Price (XRP)", "Volume 24 h (XRP)", "Listed in the issuer's toml"]);
    expect(rows()).toHaveLength(2);
    cleanup();
    mount(build("", tokensSample(), { net: XAHAU }), { at: "/xahau/tokens", network: LAYOUT_XAHAU });
    expect(texts(within(screen.getByRole("table", { name: "Issued tokens" })).getAllByRole("columnheader")).slice(5, 7)).toEqual(["Price (XAH)", "Volume 24 h (XAH)"]);
  });

  it("draws a row: the rank, the token as one link with its coin, code and name, the issuer, and the figures", () => {
    mount(build());
    const [first] = rows();
    const [rank, token, issuer, holders, supply, price, volume, listed] = cells(first!);
    expect(rank!.textContent).toBe("1");
    const link = within(token!).getByRole("link");
    expect(link.getAttribute("href")).toBe(`/xrpl/token/RLUSD.${TOKEN_SAMPLE_ISSUER}`);
    expect(within(token!).getAllByRole("link")).toHaveLength(1);
    // The coin is decoration, and carries the code's first three characters; the name stands under the code.
    const coin = link.querySelector(".amm__coins")!;
    expect(coin.getAttribute("aria-hidden")).toBe("true");
    expect(coin.textContent).toBe("RLU");
    expect(link.querySelectorAll(".amm__coin")).toHaveLength(1);
    expect(link.querySelector(".tokens__code")!.textContent).toBe("RLUSD");
    expect(link.querySelector(".tokens__name")!.textContent).toBe("Ripple USD");
    expect(within(issuer!).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${TOKEN_SAMPLE_ISSUER}`);
    expect(texts([holders!, supply!, price!, volume!])).toEqual(["120", "7,320", "0.4", "150"]);
    expect(listed!.textContent).toBe("listed in the issuer's toml");
  });

  it("writes a hex code as its text with the hex in the title and in words only a screen reader reads, in the link's name", () => {
    mount(build());
    const [, token] = cells(rows()[0]!);
    const code = token!.querySelector(".tokens__code")!;
    expect(code.getAttribute("title")).toBe(TOKEN_SAMPLE_CURRENCY);
    const hidden = token!.querySelector(".sr")!;
    expect(hidden.textContent).toBe(`, currency code ${TOKEN_SAMPLE_CURRENCY}`);
    expect(within(token!).getByRole("link").textContent).toContain(`RLUSD, currency code ${TOKEN_SAMPLE_CURRENCY}`);
    expect(within(token!).getByRole("link", { name: new RegExp(`^RLUSD\\s*, currency code ${TOKEN_SAMPLE_CURRENCY}\\s*Ripple USD$`) })).toBeTruthy();
  });

  it("writes a 3-character code with no title and no hidden words, and a token with no name and no price as the row of the board", () => {
    mount(build());
    const [rank, token, , holders, supply, price, volume, listed] = cells(rows()[1]!);
    expect(rank!.textContent).toBe("2");
    expect(token!.querySelector(".tokens__code")!.hasAttribute("title")).toBe(false);
    expect(token!.querySelector(".sr")).toBeNull();
    expect(token!.querySelector(".tokens__name")).toBeNull();
    expect(texts([holders!, supply!, price!, volume!])).toEqual(["60", "1,860", "—", "0"]);
    expect(listed!.textContent).toBe("—not listed in the issuer's toml");
  });

  it("draws a code its own path cannot name as text, not as a link", () => {
    const answer = tokensSample({ tokens: [tokenRowSample({ currency: "U|D", code: "U|D", name: undefined })] });
    mount(build("", answer));
    const [, token] = cells(rows()[0]!);
    expect(within(token!).queryByRole("link")).toBeNull();
    expect(token!.querySelector(".tokens__code")!.textContent).toBe("U|D");
  });

  it("draws the issuer by its name, with the mark that says how it is known, when the names have one", () => {
    const names: NameMap = { [TOKEN_SAMPLE_ISSUER]: { name: { text: "Ripple", kind: "verified" }, domain: "ripple.com", labels: [] } };
    mount(build(), { names });
    const [, , first] = cells(rows()[0]!);
    expect(within(first!).getByRole("link").textContent).toContain("Ripple");
    expect(within(first!).getByRole("link").textContent).toContain("verified name");
    // The other issuer has no name: its short address.
    const [, , second] = cells(rows()[1]!);
    expect(within(second!).getByRole("link").textContent).toBe(shortAddress(TOKEN_SAMPLE_OTHER_ISSUER));
  });

  it("says what the toml listing is by an icon and words, and a dash with words for a token that is not listed", () => {
    const { container } = mount(build());
    const [yes, no] = [...container.querySelectorAll(".table__row:not(.table__head)")].map((row) => row.lastElementChild!);
    expect(yes!.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(yes!.querySelector(".sr")!.textContent).toBe(" in the issuer's toml");
    expect(no!.querySelector("svg")).toBeNull();
    expect(no!.querySelector(".sr")!.textContent).toBe("not listed in the issuer's toml");
  });

  it("has the note under the table, the definitions of the figures in the network's currency, and no coverage note when it is complete", () => {
    const { container } = mount(build("", secondPage()));
    expect(screen.getByText("Showing 21–40 of 1,284 tokens with 10 or more holders")).toBeTruthy();
    expect(screen.getByText("Holders: accounts with a positive balance. Supply: the sum of their balances. Price: the last trade against XRP.")).toBeTruthy();
    expect(container.querySelector(".coverage-note")).toBeNull();
  });

  it("says the index starts at a ledger when the coverage is not complete, directly under the table, with the ledger as a link", () => {
    const answer = tokensSample({ coverage: tokenCoverageSample({ from_ledger_index: 107874617, complete: false }) });
    const { container } = mount(build("", answer));
    const note = screen.getByRole("note");
    expect(note.textContent).toBe("Covers ledger #107,874,617 onwards: earlier trust lines are not in the index yet.");
    expect(within(note).getByRole("link").getAttribute("href")).toBe("/xrpl/ledger/107874617");
    // The first thing in the card's foot, which is the first thing after the table.
    const foot = container.querySelector(".card__foot")!;
    expect(foot.querySelector(".tokens__notes")!.firstElementChild).toBe(note);
  });

  it("has the pager: Previous and More tokens as links with their hrefs on a middle page, Previous disabled on the first", () => {
    mount(build(`marker=M2&back=M1`, secondPage()));
    const pager = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: "Previous" }).getAttribute("href")).toBe("/xrpl/tokens?marker=M1");
    expect(within(pager).getByRole("link", { name: "More tokens" }).getAttribute("href")).toBe("/xrpl/tokens?marker=M3&back=M2.M1");
    cleanup();
    mount(build());
    const first = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(first).queryByRole("link", { name: "Previous" })).toBeNull();
    expect(first.querySelector('[aria-disabled="true"]')!.textContent).toBe("Previous");
    expect(within(first).getByRole("link", { name: "More tokens" }).getAttribute("href")).toBe(`/xrpl/tokens?marker=${TOKENS_MARKER}`);
  });
});

// ---- The search -------------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("TokensPage: the search and Show all", () => {
  it("is a GET form to the list: a visible label on the field named q, a Search button, the search as typed", () => {
    mount(build("q=USD", tokensSample({ total: 12, total_below: 3 })));
    const field = screen.getByLabelText("Code, name or issuer") as HTMLInputElement;
    expect(field.getAttribute("name")).toBe("q");
    expect(field.type).toBe("search");
    expect(field.value).toBe("USD");
    // The label is visible: it is not the screen-reader-only class.
    expect(screen.getByText("Code, name or issuer").className).not.toContain("sr");
    const form = field.closest("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/xrpl/tokens");
    expect(within(form).getByRole("button", { name: "Search" }).getAttribute("type")).toBe("submit");
    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(field.hasAttribute("aria-describedby")).toBe(false);
    expect(form.querySelector('input[type="hidden"]')).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("carries all=1 as a hidden field after the search, so that Search keeps it", () => {
    mount(build("all=1"));
    const form = (screen.getByLabelText("Code, name or issuer") as HTMLInputElement).closest("form")!;
    const hidden = form.querySelector('input[type="hidden"]') as HTMLInputElement;
    expect([hidden.name, hidden.value]).toEqual(["all", "1"]);
    // After the field: the query a submit writes is q, then all, the canonical order.
    expect(form.querySelector("input[name=q]")!.compareDocumentPosition(hidden) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws the message of a search that was too long, tied to the field, with no table, no note and no pager", () => {
    const q = "x".repeat(65);
    mount(build(`q=${q}`, null));
    const field = screen.getByLabelText("Code, name or issuer") as HTMLInputElement;
    expect(field.value).toBe(q);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Search for at most 64 characters");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(alert.id);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
    expect(screen.queryByText(/Showing|matches/)).toBeNull();
    expect(screen.queryByText(/Holders: accounts/)).toBeNull();
    // The tiles stay, as dashes.
    expect(texts(screen.getByRole("region", { name: "Totals" }).querySelectorAll(".stat__value"))).toEqual(["—", "—", "—"]);
  });

  it("has Show all with the number it hides as a link beside the form, and the way back under all", () => {
    mount(build("", secondPage()));
    expect(screen.getByRole("link", { name: "Show all (48,206 hidden)" }).getAttribute("href")).toBe("/xrpl/tokens?all=1");
    cleanup();
    mount(build("q=USD&all=1", tokensSample({ total_below: undefined })));
    expect(screen.getByRole("link", { name: "Hide tokens with fewer than 10 holders" }).getAttribute("href")).toBe("/xrpl/tokens?q=USD");
    expect(screen.queryByRole("link", { name: /Show all/ })).toBeNull();
  });

  it("says how many tokens match a search, and links the same search under all to the matches among the tokens with fewer holders", () => {
    mount(build("q=USD", tokensSample({ total: 12, total_below: 3 })));
    const note = screen.getByText(/^12 matches/);
    expect(note.textContent).toBe("12 matches · 3 more among tokens with fewer than 10 holders");
    const more = within(note).getByRole("link", { name: "3 more among tokens with fewer than 10 holders" });
    expect(more.getAttribute("href")).toBe("/xrpl/tokens?q=USD&all=1");
    // The link is told from the words around it by more than its colour (axe: link-in-text-block).
    expect(more.className).toBe("tokens__more");
  });

  it("says the search matched nothing, with the words of the board, and has no rows", () => {
    mount(build("q=zzz", tokensSample({ total: 0, total_below: 0, count: 0, marker: undefined, tokens: [] })));
    expect(screen.getByText("No issued tokens match “zzz”.")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Issued tokens" })).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Issued tokens" })).queryAllByRole("row")).toHaveLength(1);
    expect(screen.getByText("0 matches")).toBeTruthy();
  });
});

// ---- Shape of the page ------------------------------------------------------------------------------------------------------------------------------------------------------

describe("TokensPage: as a page", () => {
  it("never fetches", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    mount(build());
    mount(build("q=USD", tokensSample({ total: 12, total_below: 3 })));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is the same on the server as in the browser", async () => {
    const { container, errors } = await serverThenHydrated(routedPage(<TokensPage data={build("", secondPage())} />, { at: "/xrpl/tokens", features: FEATURES }));
    expect(errors).toEqual([]);
    expect(within(container).getByRole("table", { name: "Issued tokens" })).toBeTruthy();
  });

  it("is the same on the server as in the browser for the search that was too long, and for the disabled tab with a note", async () => {
    const { errors } = await serverThenHydrated(routedPage(<TokensPage data={build(`q=${"x".repeat(65)}`, null)} />, { at: "/xrpl/tokens", features: FEATURES }));
    expect(errors).toEqual([]);
    const xahau = await serverThenHydrated(routedPage(<TokensPage data={build("", tokensSample(), { net: XAHAU })} />, { at: "/xahau/tokens", network: LAYOUT_XAHAU, features: FEATURES }));
    expect(xahau.errors).toEqual([]);
  });
});
