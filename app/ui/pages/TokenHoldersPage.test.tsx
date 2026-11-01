import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { HOLDERS_MARKER, holdersSample, tokenDetailSample, tokenHolderSample, tokenSample, TOKEN_SAMPLE_CURRENCY, TOKEN_SAMPLE_ISSUER } from "../../../test/support/token-samples";
import { LAYOUT_XAHAU, LAYOUT_XRPL, mountPage, routedPage } from "../../../test/support/under-network";
import { NO_NAMES, type NameMap } from "../../domain/names";
import type { Loaded } from "../../server/account-view";
import type { TokenDetail, TokenHoldersResponse } from "../../server/api-types";
import { tokenHoldersPage, type TokenHoldersInput, type TokenHoldersPageData, type TokensNet } from "../../server/token-view";
import { NO_FEATURES } from "../features";
import { NamesProvider } from "../names";
import { TokenHoldersPage } from "./TokenHoldersPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The holders page's data as the view builder writes it (`tokenHoldersPage`), drawn under the `/:net` layout: the head with its line and its way back, the table of the holders with the
// Limit and Status columns, the coverage note and the pager, and a holders list that failed.

const FEATURES = { ...NO_FEATURES, tokens: true, markets: true, ammPages: true };
const XRPL: TokensNet = { ...LAYOUT_XRPL, features: FEATURES };
const XAHAU: TokensNet = { ...LAYOUT_XAHAU, features: FEATURES };
const ASSET = { currency: TOKEN_SAMPLE_CURRENCY, issuer: TOKEN_SAMPLE_ISSUER };
const TOKEN_PATH = `/xrpl/token/RLUSD.${TOKEN_SAMPLE_ISSUER}`;
const PATH = `${TOKEN_PATH}/holders`;

const ok = <T,>(value: T): Loaded<T> => ({ state: "ok", value });
const FAILED = { state: "failed" } as const;

/** The page data of the first page of RLUSD's holders, unless the input says otherwise. */
function build(over: Partial<TokenHoldersInput> = {}): TokenHoldersPageData {
  return tokenHoldersPage({ net: XRPL, asset: ASSET, answer: tokenSample(), holders: ok(holdersSample()), params: { back: [] }, names: NO_NAMES, ...over }).page;
}

/** The same with the token replaced by `over`'s fields. */
const withToken = (over: Partial<TokenDetail>, rest: Partial<TokenHoldersInput> = {}) => build({ answer: tokenSample({ token: tokenDetailSample(over) }), ...rest });

/** The page in a data router at its own URL, drawn in the browser; the names are the route's (`NamesProvider`). `loader` counts the revalidations a Retry asks for. */
function mount(data: TokenHoldersPageData, { at = PATH, network = LAYOUT_XRPL, names = {} }: { at?: string; network?: typeof LAYOUT_XRPL; names?: NameMap } = {}) {
  return mountPage(
    <NamesProvider names={names}>
      <TokenHoldersPage data={data} />
    </NamesProvider>,
    "routes/net.token.$token.holders",
    { at, network, features: FEATURES },
  );
}

const card = (name: string) => screen.getByRole("region", { name });
const rowsOf = (table: HTMLElement) => within(table).getAllByRole("row").slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole("cell");
const texts = (nodes: Iterable<Element>) => [...nodes].map((node) => node.textContent);

describe("TokenHoldersPage: the head", () => {
  it("has the breadcrumb, with the token as a link and Holders as the current page", () => {
    mount(build());
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "XRPL" }).getAttribute("href")).toBe("/xrpl");
    expect(crumbs.getByRole("link", { name: "Tokens" }).getAttribute("href")).toBe("/xrpl/tokens");
    expect(crumbs.getByRole("link", { name: "RLUSD" }).getAttribute("href")).toBe(TOKEN_PATH);
    expect(crumbs.getByText("Holders").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("XRPL/Tokens/RLUSD/Holders");
  });

  it("is the h1 Holders of RLUSD, the line of how many hold how much, the issuer in full, and the way back to the token", () => {
    mount(build());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Holders of RLUSD");
    expect(screen.getByText("120 accounts hold 7,320 RLUSD")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to RLUSD" }).getAttribute("href")).toBe(TOKEN_PATH);
    // The issuer: its account, named by the route's names where they have one.
    expect(screen.getByText("Issued by")).toBeTruthy();
    expect(screen.getAllByRole("link").some((link) => link.getAttribute("href") === `/xrpl/account/${TOKEN_SAMPLE_ISSUER}`)).toBe(true);
  });

  it("names the issuer by what the route's names say of it", () => {
    mount(build(), { names: { [TOKEN_SAMPLE_ISSUER]: { name: { text: "Ripple", kind: "verified" }, domain: "ripple.com", labels: [] } } });
    expect(screen.getAllByRole("link").some((link) => link.getAttribute("href") === `/xrpl/account/${TOKEN_SAMPLE_ISSUER}` && /Ripple/.test(link.textContent ?? ""))).toBe(true);
  });

  it("is Xahau's on Xahau: the breadcrumb and the way back lead to its token", () => {
    mount(build({ net: XAHAU }), { at: `/xahau/token/RLUSD.${TOKEN_SAMPLE_ISSUER}/holders`, network: LAYOUT_XAHAU });
    expect(screen.getByRole("link", { name: "Tokens" }).getAttribute("href")).toBe("/xahau/tokens");
    expect(screen.getByRole("link", { name: "Back to RLUSD" }).getAttribute("href")).toBe(`/xahau/token/RLUSD.${TOKEN_SAMPLE_ISSUER}`);
  });
});

describe("TokenHoldersPage: the holders", () => {
  it("is a named table with the columns of the top holders and two more: Limit and Status", () => {
    mount(build());
    const holders = card("Holders");
    const table = within(holders).getByRole("table", { name: "Holders" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["#", "Holder", "Balance (RLUSD)", "Share of supply", "Limit", "Status"]);
    const [first, , third] = rowsOf(table);
    expect(texts(cells(first!).filter((_, at) => at !== 1 && at !== 5))).toEqual(["1", "40.5", "0.55%", "1,000,000"]);
    expect(within(cells(first!)[1]!).getAllByRole("link")[0]!.getAttribute("href")).toBe("/xrpl/account/rrrrrrrrrrrrrrrrrrcJYjXAZjD");
    expect(cells(third!)[3]!.textContent).toBe("0.53%");
    expect(within(holders).getByText(`/v2/tokens/${TOKEN_SAMPLE_CURRENCY}.${TOKEN_SAMPLE_ISSUER}/holders`)).toBeTruthy();
  });

  it("draws the share as a meter that is a picture, beside the percent that says it", () => {
    const { container } = mount(build());
    const meter = card("Holders").querySelector(".meter")!;
    expect(meter.getAttribute("aria-hidden")).toBe("true");
    expect(meter.hasAttribute("role")).toBe(false);
    expect(container.querySelectorAll(".meter")).toHaveLength(3);
    expect((card("Holders").querySelectorAll(".meter__fill")[0] as HTMLElement).style.width).toBe("100%");
  });

  it("says a frozen line is Frozen and an approved one Authorized, each with an icon and the word, in the Status column and not beside the holder", () => {
    mount(build({ answer: tokenSample({ token: tokenDetailSample({ issuer_settings: { ...tokenDetailSample().issuer_settings!, require_auth: true } }) }) }));
    const [first, second, third] = rowsOf(within(card("Holders")).getByRole("table", { name: "Holders" }));
    const status = (row: HTMLElement) => cells(row)[5]!;
    expect(status(first!).textContent).toBe("Frozen");
    expect(status(first!).querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(status(third!).textContent).toBe("Authorized");
    expect(status(third!).querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    // A line with neither has no word, and the dash says so to a screen reader.
    expect(status(second!).textContent).toBe("—none");
    expect(status(second!).querySelector(".sr")!.textContent).toBe("none");
    // The holder's cell is the holder alone.
    expect(cells(first!)[1]!.querySelector(".st")).toBeNull();
  });

  it("says both words for a line that is frozen and approved", () => {
    mount(
      build({
        answer: tokenSample({ token: tokenDetailSample({ issuer_settings: { ...tokenDetailSample().issuer_settings!, require_auth: true } }) }),
        holders: ok(holdersSample({ holders: [tokenHolderSample({ frozen: true, authorized: true })] })),
      }),
    );
    const [row] = rowsOf(within(card("Holders")).getByRole("table", { name: "Holders" }));
    expect(cells(row!)[5]!.textContent).toBe("FrozenAuthorized");
  });

  it("explains the columns, and carries the coverage note of the trust lines directly in the foot when the index is not complete", () => {
    mount(build({ holders: ok(holdersSample({ coverage: { complete: false, from_ledger_index: 93663334 } })) }));
    const holders = card("Holders");
    expect(within(holders).getByText("Largest balance first. Limit is the most a holder's trust line can hold. Authorized is shown only where the issuer must approve each trust line.")).toBeTruthy();
    expect(holders.textContent).toContain("Covers ledger #93,663,334 onwards: earlier trust lines are not in the index yet.");
    cleanup();
    mount(build());
    expect(card("Holders").textContent).not.toContain("Covers ledger");
  });

  it("has Previous and More holders, a link where there is a page and a disabled button where there is none", () => {
    mount(build());
    const pager = within(within(card("Holders")).getByRole("navigation", { name: "Pagination" }));
    expect(pager.getByRole("link", { name: "More holders" }).getAttribute("href")).toBe(`${PATH}?marker=${HOLDERS_MARKER}`);
    expect(pager.queryByRole("link", { name: "Previous" })).toBeNull();
    expect(pager.getByText("Previous").closest("[aria-disabled]")?.getAttribute("aria-disabled")).toBe("true");
    cleanup();

    mount(build({ params: { marker: HOLDERS_MARKER, back: [] }, holders: ok(holdersSample({ marker: undefined })) }), { at: `${PATH}?marker=${HOLDERS_MARKER}` });
    const second = within(within(card("Holders")).getByRole("navigation", { name: "Pagination" }));
    expect(second.getByRole("link", { name: "Previous" }).getAttribute("href")).toBe(PATH);
    expect(second.queryByRole("link", { name: "More holders" })).toBeNull();
  });

  it("continues the ranks on page 2 as D6 gives them", () => {
    const second: TokenHoldersResponse = holdersSample({ holders: [tokenHolderSample({ rank: 51, holder: "rA" }), tokenHolderSample({ rank: 52, holder: "rB" })] });
    mount(build({ holders: ok(second), params: { marker: HOLDERS_MARKER, back: [] } }), { at: `${PATH}?marker=${HOLDERS_MARKER}` });
    const rows = rowsOf(within(card("Holders")).getByRole("table", { name: "Holders" }));
    expect(rows.map((row) => cells(row)[0]!.textContent)).toEqual(["51", "52"]);
  });

  it("says no account holds the token", () => {
    mount(build({ holders: ok(holdersSample({ holders: [], count: 0, marker: undefined })) }));
    expect(within(card("Holders")).getByText("No account holds RLUSD.")).toBeTruthy();
  });
});

describe("TokenHoldersPage: a holders list that failed", () => {
  it("is told in its place, with a Retry that asks the route again, and the head stands", () => {
    const { loader } = mount(build({ holders: FAILED }));
    const alert = within(card("Holders")).getByRole("alert");
    expect(alert.textContent).toBe("Couldn’t load the holders.Retry");
    expect(within(card("Holders")).queryByRole("table")).toBeNull();
    expect(within(card("Holders")).queryByRole("navigation", { name: "Pagination" })).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(loader).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Holders of RLUSD");
    expect(screen.getByRole("link", { name: "Back to RLUSD" })).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

describe("TokenHoldersPage: as a page", () => {
  it("never fetches", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    mount(build());
    mount(build({ holders: FAILED }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("names its table, and draws no chart: the share's meter is the only graphic of the kit", () => {
    const { container } = mount(build());
    expect(screen.getAllByRole("table").map((table) => table.getAttribute("aria-label"))).toEqual(["Holders"]);
    expect(container.querySelector("canvas, .chart, .plot")).toBeNull();
  });

  it("draws a token whose toml gives no name by its code, and one with hex in it by its text", () => {
    mount(withToken({ toml: undefined }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Holders of RLUSD");
  });

  it("is the same on the server as in the browser, with a failed list, a page behind a marker and on Xahau", async () => {
    const first = await serverThenHydrated(routedPage(<TokenHoldersPage data={build()} />, { at: PATH, features: FEATURES }));
    expect(first.errors).toEqual([]);
    expect(within(first.container).getByRole("table", { name: "Holders" })).toBeTruthy();
    const failed = await serverThenHydrated(routedPage(<TokenHoldersPage data={build({ holders: FAILED })} />, { at: PATH, features: FEATURES }));
    expect(failed.errors).toEqual([]);
    const behind = await serverThenHydrated(routedPage(<TokenHoldersPage data={build({ params: { marker: HOLDERS_MARKER, back: [] } })} />, { at: `${PATH}?marker=${HOLDERS_MARKER}`, features: FEATURES }));
    expect(behind.errors).toEqual([]);
    const xahau = await serverThenHydrated(routedPage(<TokenHoldersPage data={build({ net: XAHAU })} />, { at: `/xahau/token/RLUSD.${TOKEN_SAMPLE_ISSUER}/holders`, network: LAYOUT_XAHAU, features: FEATURES }));
    expect(xahau.errors).toEqual([]);
  });
});
