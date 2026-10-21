import { readFileSync } from "node:fs";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AMM_HOLDER, AMM_ISSUER, AMM_MARKER, AMM_OTHER, AMM_POOL, ammPoolAccount, ammPoolSample, ammPoolsSample } from "../../../test/support/amm-samples";
import { serverThenHydrated } from "../../../test/support/hydrate";
import { valueImports } from "../../../test/support/value-imports";
import { ammPoolHref } from "../../domain/amm-params";
import type { Asset } from "../../domain/asset";
import { compactNumber, shortAddress } from "../../domain/format";
import { ammListPage, noAmmPage, type AmmListInput, type AmmListPageData, type NoAmmPageData } from "../../server/amm-view";
import type { AmmPool, AmmVolumeComponent, AmmVolumeRow, LastValidated, Page } from "../../server/api-types";
import { NO_FEATURES } from "../features";
import { AmmListPage } from "./AmmListPage";
import { NoAmmPage } from "./NoAmmPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---- The world of the tests: T is Oct 17, the live set ends at 17:01 UTC -----------------------------------------------------------------------------

const RL = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const RLUSD = "524C555344000000000000000000000000000000";
const RLUSD_TEXT = `RLUSD.${RL}`;
const rlusd: Asset = { currency: RLUSD, issuer: RL };
const xrp: Asset = { currency: "XRP" };

const XRPL: AmmListInput["net"] = { id: "xrpl", native: "XRP", features: { ...NO_FEATURES, ammPages: true, markets: true } };

const fulfilled = <T,>(value: T): PromiseFulfilledResult<T> => ({ status: "fulfilled", value });
const rejected = (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason });

const LAST: LastValidated = {
  result: "success",
  ledger_index: "107721455",
  ledger_hash: "68A33146F46A7B154CACA4034837D9A7AFEC0C46F7D963D6FD61F5CF87DAD092",
  parent_hash: "5FA71FCC25A865DA7569108807E031AFB3E1CD03A8CE078BC1AA534C8E546BE8",
  close_time: "2026-10-17T17:01:12Z",
};

/** XRP/RLUSD as the API stores it (RLUSD/XRP), its slot held until after the data's "now", its creation ingested. */
const XRP_RLUSD = ammPoolSample({
  amm_account: AMM_POOL,
  base_currency: RLUSD,
  base_issuer: RL,
  counter_currency: "XRP",
  reserve_base: "2417282.053464318",
  reserve_counter: "1847691.034536",
  trading_fee: 300,
  value_native: "3612345.5",
  auction_slot: { holder: AMM_HOLDER, price: "12.5", discounted_fee: 30, expiration: "2026-10-18T09:00:00Z" },
  created_ledger: 86800123,
});
/** USD/XRP with no swaps in the last 24 hours (no component) and no slot holder: Volume "0", the slot "Open". */
const USD_XRP = ammPoolSample({ amm_account: AMM_OTHER, auction_slot: undefined, value_native: "5000" });
/** USD/RLUSD, two issued currencies: no component may be swaps that could not be priced ("—"); no value, no fee, no creation. */
const USD_RLUSD = ammPoolSample({
  amm_account: ammPoolAccount(7),
  base_currency: "USD",
  base_issuer: AMM_ISSUER,
  counter_currency: RLUSD,
  counter_issuer: RL,
  value_native: undefined,
  trading_fee: undefined,
  created_ledger: undefined,
  auction_slot: undefined,
});
/** A deleted XRP pool: the "Deleted" tag, its reserves unknown. */
const DELETED = ammPoolSample({ amm_account: ammPoolAccount(8), deleted: true, reserve_base: undefined, reserve_counter: undefined, value_native: undefined, auction_slot: undefined });

const component = (over: Partial<AmmVolumeComponent> = {}): AmmVolumeComponent => ({
  amm_account: AMM_POOL,
  base: rlusd,
  counter: xrp,
  count: 61,
  amount: "708895.8293",
  rate: "1.3059729",
  converted_amount: "542810.5",
  ...over,
});

const liveOf = (components: AmmVolumeComponent[]): Page<"rows", AmmVolumeRow> => ({
  result: "success",
  count: 1,
  rows: [
    {
      components,
      count: 1284,
      exchange: { currency: "XRP" },
      total: "893025.375",
      exchange_rate: "1.0000000",
      start_time: "2026-10-16T17:01:00Z",
      end_time: "2026-10-17T17:01:00Z",
    },
  ],
});

/** One row for each day from Sep 18 to Oct 16: the total is the day of the month in XRP, and the count twice that. */
function history(): Page<"rows", AmmVolumeRow> {
  const rows: AmmVolumeRow[] = [];
  for (let at = Date.UTC(2026, 8, 18); at <= Date.UTC(2026, 9, 16); at += 86_400_000) {
    const day = new Date(at).getUTCDate();
    rows.push({
      components: [],
      count: day * 2,
      exchange: { currency: "XRP" },
      total: `${day * 1000}.5`,
      exchange_rate: "1.0000000",
      start_time: new Date(at).toISOString().replace(".000", ""),
      end_time: new Date(at + 86_400_000).toISOString().replace(".000", ""),
    });
  }
  return { result: "success", count: rows.length, rows };
}

const POOLS: AmmPool[] = [XRP_RLUSD, USD_XRP, USD_RLUSD, DELETED];

/** The builder's input: a page reached with a marker (so both directions of the pager are links), every call answering. */
function inputOf(over: Partial<AmmListInput> = {}): AmmListInput {
  return {
    net: XRPL,
    asset: null,
    deleted: true,
    marker: "M1",
    back: [],
    last: fulfilled(LAST),
    pools: fulfilled(ammPoolsSample({ marker: AMM_MARKER, count: POOLS.length, pools: POOLS })),
    live: fulfilled(liveOf([component()])),
    history: fulfilled(history()),
    ...over,
  };
}

/** The page data, as the loader hands it to the page: the view builder's output of the input. */
const build = (over: Partial<AmmListInput> = {}): AmmListPageData => ammListPage(inputOf(over)).page;

/** The page in a data router at its own URL, drawn in the browser. `loader` counts the revalidations a Retry asks for. */
function mount(data: AmmListPageData, at = "/xrpl/amm") {
  const loader = vi.fn(() => null);
  const router = createMemoryRouter([{ id: "amm", path: "*", element: <AmmListPage data={data} />, loader }], {
    initialEntries: [at],
    hydrationData: { loaderData: { amm: null } },
  });
  return { router, loader, ...render(<RouterProvider router={router} />) };
}

/** A file of app/ui, by its path from this one. (Given as a variable: Vite would turn `new URL("x.css", import.meta.url)` written out into an asset's URL.) */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const routed = (ui: ReactElement, at = "/xrpl/amm") => <RouterProvider router={createMemoryRouter([{ path: "*", element: ui }], { initialEntries: [at] })} />;

const poolsCard = () => screen.getByRole("region", { name: "Pools" });
const rowsOf = () => within(within(poolsCard()).getByRole("table", { name: "Pools" })).getAllByRole("row").slice(1);
const cellsOf = (row: HTMLElement) => within(row).getAllByRole("cell");

// ---- The list --------------------------------------------------------------------------------------------------------------------------------------

describe("AmmListPage: the heading and the filter", () => {
  it("has the h1 and the board's intro", () => {
    mount(build());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("AMM pools");
    expect(screen.getByText("Automated market maker pools on the XRP Ledger. Swaps against them also count as DEX trades.").tagName).toBe("P");
  });

  it("is a GET form to the list, with a labelled field, the checkbox and the button, in a group named Filters", () => {
    const { container } = mount(build({ asset: { asset: rlusd, text: RLUSD_TEXT }, deleted: false }));
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/xrpl/amm");
    const group = screen.getByRole("group", { name: "Filters" });
    expect(form.contains(group)).toBe(true);

    const field = within(group).getByLabelText("Pools with this asset") as HTMLInputElement;
    expect(field.name).toBe("asset");
    expect(field.placeholder).toBe("XRP or RLUSD.rMxCK…");
    expect(field.value).toBe(RLUSD_TEXT);
    expect(field.hasAttribute("aria-invalid")).toBe(false);
    expect(field.hasAttribute("aria-describedby")).toBe(false);

    const box = within(group).getByRole("checkbox", { name: "Include deleted pools" }) as HTMLInputElement;
    // P26: the canonical form reads `deleted=1`; the default "on" would be dropped and the filter would do nothing.
    expect([box.name, box.value, box.checked]).toEqual(["deleted", "1", false]);
    const button = within(group).getByRole("button", { name: "Show pools" });
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.closest("form")).toBe(form);
  });

  it("checks the box when the deleted pools are included", () => {
    mount(build({ deleted: true }));
    expect((screen.getByRole("checkbox", { name: "Include deleted pools" }) as HTMLInputElement).checked).toBe(true);
  });

  it("ties the asset error to the field, which is invalid, and keeps what was typed", () => {
    const data = build({ asset: { error: "usd.rNope" }, pools: null });
    mount(data);
    const field = screen.getByLabelText("Pools with this asset") as HTMLInputElement;
    expect(field.value).toBe("usd.rNope");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const message = document.getElementById(field.getAttribute("aria-describedby")!)!;
    expect(message.textContent).toBe("Write an asset as XRP, or as a currency and its issuer: RLUSD.rMxCK…");
    // No pools were asked for: no Pools card, and nothing claims to have failed.
    expect(screen.queryByRole("region", { name: "Pools" })).toBeNull();
    expect(screen.queryByText(/load the pools/)).toBeNull();
  });

  it("submits the asset and deleted=1 to the list as a client-side navigation", async () => {
    const { router } = mount(build({ deleted: false }));
    fireEvent.change(screen.getByLabelText("Pools with this asset"), { target: { value: "XRP" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Include deleted pools" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Show pools" })));
    expect(router.state.location.pathname + router.state.location.search).toBe("/xrpl/amm?asset=XRP&deleted=1");
  });

  it("starts the form again from the page it shows when the page's data changes (back, or a new filter)", () => {
    const shown = build({ asset: { asset: rlusd, text: RLUSD_TEXT }, deleted: false });
    const next = build({ asset: null, deleted: true });
    function Switching() {
      const [data, setData] = useState(shown);
      return (
        <>
          <button type="button" onClick={() => setData(next)}>
            Next page
          </button>
          <AmmListPage data={data} />
        </>
      );
    }
    render(routed(<Switching />));
    fireEvent.change(screen.getByLabelText("Pools with this asset"), { target: { value: "typed, not submitted" } });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect((screen.getByLabelText("Pools with this asset") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("checkbox", { name: "Include deleted pools" }) as HTMLInputElement).checked).toBe(true);
  });

  it("works without JavaScript: the Worker's HTML is a plain GET form with the named fields", () => {
    const html = renderToString(routed(<AmmListPage data={build({ asset: { asset: rlusd, text: RLUSD_TEXT }, deleted: true })} />));
    const printed = document.createElement("div");
    printed.innerHTML = html;
    const form = printed.querySelector("form")!;
    expect([form.getAttribute("method"), form.getAttribute("action")]).toEqual(["get", "/xrpl/amm"]);
    // What a browser without the script submits: the field and the box by their names, with the values the page shows, and the button.
    const field = form.querySelector('input[name="asset"]')!;
    expect(field.getAttribute("value")).toBe(RLUSD_TEXT);
    const box = form.querySelector('input[type="checkbox"]')!;
    expect([box.getAttribute("name"), box.getAttribute("value"), box.hasAttribute("checked")]).toEqual(["deleted", "1", true]);
    expect(form.querySelector('button[type="submit"]')!.textContent).toBe("Show pools");
  });
});

describe("AmmListPage: the totals", () => {
  it("draws the three tiles of the live set and the time it was read", () => {
    mount(build());
    const totals = screen.getByRole("region", { name: "Totals" });
    const tiles = [...totals.querySelectorAll(".stat")].map((tile) => [...tile.children].map((part) => part.textContent));
    expect(tiles).toEqual([
      ["Swap volume, 24 h", `${compactNumber("893025.375")} XRP`, "1,284 swaps"],
      ["Pools with swaps, 24 h", "1", "that could be priced in XRP"],
      ["Busiest pool, 24 h", "XRP / RLUSD", `${compactNumber("542810.5")} XRP of swaps`],
    ]);
    expect(totals.querySelectorAll(".stat--figure")).toHaveLength(3);
    // The busiest pool is a link to its page; the other figures are text.
    expect(within(totals).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["XRP / RLUSD", ammPoolHref("xrpl", AMM_POOL)]]);
    expect(screen.getByText("As of 17:01 UTC.")).toBeTruthy();
  });

  it("keeps the three labels over dashes, with one SectionError under them, when the live set failed", () => {
    mount(build({ live: rejected(new Error("503")) }));
    const totals = screen.getByRole("region", { name: "Totals" });
    const tiles = [...totals.querySelectorAll(".stat")].map((tile) => [...tile.children].map((part) => part.textContent));
    expect(tiles).toEqual([
      ["Swap volume, 24 h", "—"],
      ["Pools with swaps, 24 h", "—"],
      ["Busiest pool, 24 h", "—"],
    ]);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual(["Couldn’t load the 24-hour volume.Retry"]);
    expect(screen.queryByText(/^As of/)).toBeNull();
  });
});

describe("AmmListPage: the chart", () => {
  it("is the chart card of the 30 days, with its source line, a table view and the Swaps of each day", () => {
    mount(build());
    const card = screen.getByRole("region", { name: "AMM swap volume per day, in XRP, last 30 days" });
    expect(within(card).getByText("/v2/network/amm_volume?interval=day")).toBeTruthy();
    expect(within(card).getByRole("radio", { name: "Chart" })).toBeTruthy();
    expect(card.querySelector(".chart__view")!.children.length).toBeGreaterThan(0);
    const table = card.querySelector(".chart__table")!;
    expect(within(table as HTMLElement).getAllByRole("columnheader").map((header) => header.textContent)).toContain("Swaps");
  });

  it("is the card's SectionError, under the same title and source line, when the days failed", () => {
    mount(build({ history: rejected(new Error("took too long")) }));
    const card = screen.getByRole("region", { name: "AMM swap volume per day, in XRP, last 30 days" });
    expect(within(card).getByText("/v2/network/amm_volume?interval=day")).toBeTruthy();
    expect(within(card).getByRole("alert").textContent).toContain("Couldn’t load the swap volume.");
    expect(within(card).queryByRole("radio")).toBeNull();
  });

  it("asks the route for its data again on Retry", async () => {
    const { loader } = mount(build({ last: rejected(new Error("503")), history: null }));
    const card = screen.getByRole("region", { name: "AMM swap volume per day, in XRP, last 30 days" });
    await act(async () => void fireEvent.click(within(card).getByRole("button", { name: "Retry" })));
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("AmmListPage: the pools", () => {
  it("is a card named Pools with its source line and the board's columns, Value in the native currency", () => {
    mount(build());
    const card = poolsCard();
    expect(within(card).getByText("/v2/amm/pools · ordered by value")).toBeTruthy();
    const table = within(card).getByRole("table", { name: "Pools" });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Pool", "Value (XRP)", "Reserves", "Fee", "Volume 24 h", "Auction slot", "Created"]);
    // DataTable's scroll region, which a keyboard can reach.
    expect(table.closest('[role="region"][tabindex="0"]')!.getAttribute("aria-label")).toBe("Pools, scrollable table");
  });

  it("shows a pool's pair as a link to its page, the account and issuers under it, and the coins hidden from assistive technology", () => {
    const { container } = mount(build());
    const [first] = rowsOf();
    const pool = cellsOf(first!)[0]!;
    expect(within(pool).getByRole("link", { name: "XRP / RLUSD" }).getAttribute("href")).toBe(ammPoolHref("xrpl", AMM_POOL));
    expect(pool.textContent).toContain(`${shortAddress(AMM_POOL)} · RLUSD ${shortAddress(RL)}`);
    const coins = container.querySelectorAll(".amm__coins");
    expect(coins).toHaveLength(POOLS.length);
    for (const pair of coins) expect(pair.getAttribute("aria-hidden")).toBe("true");
    expect([...coins[0]!.children].map((coin) => coin.textContent)).toEqual(["XRP", "RLU"]);
  });

  it("draws each row's figures as the view builder wrote them: the value, the reserves, the fee, the volume, the slot and the creation", () => {
    mount(build());
    const [rlusdRow, usdRow, tokenRow, deletedRow] = rowsOf().map(cellsOf);
    // XRP / RLUSD: the reserves in display order (the XRP first), the fee of 300 as 0.300%, its component's volume, the holder and the ledger, linked.
    expect(rlusdRow!.slice(1).map((cell) => cell.textContent)).toEqual([
      compactNumber("3612345.5"),
      `${compactNumber("1847691.034536")} XRP${compactNumber("2417282.053464318")} RLUSD`,
      "0.300%",
      compactNumber("542810.5"),
      shortAddress(AMM_HOLDER),
      "#86,800,123",
    ]);
    expect(within(rlusdRow![5]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${AMM_HOLDER}`);
    expect(within(rlusdRow![6]!).getByRole("link").getAttribute("href")).toBe("/xrpl/ledger/86800123");
    // USD / XRP: a pool that holds XRP with no component had no swaps ("0"); no holder is "Open", a status with its icon.
    expect(usdRow![4]!.textContent).toBe("0");
    expect(usdRow![5]!.textContent).toBe("Open");
    expect(usdRow![5]!.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(within(usdRow![5]!).queryByRole("link")).toBeNull();
    // USD / RLUSD: no value, fee, volume or creation known.
    expect([1, 3, 4, 6].map((at) => tokenRow![at]!.textContent)).toEqual(["—", "—", "—", "—"]);
    expect(within(tokenRow![6]!).queryByRole("link")).toBeNull();
    // The deleted pool: unknown reserves are dashes.
    expect(deletedRow![2]!.textContent).toBe("——");
  });

  it("tags a deleted pool with E3's tag, an icon and the word, and no other pool", () => {
    mount(build());
    const tags = within(poolsCard()).getAllByText("Deleted");
    expect(tags).toHaveLength(1);
    const tag = tags[0]!.closest(".tag")!;
    // P27: E6's `.tag tag--icon`, which aligns the icon; no class of its own.
    expect(tag.className).toBe("tag tag--icon");
    expect(tag.textContent).toBe("Deleted");
    expect(tag.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(rowsOf()[3]!.contains(tag)).toBe(true);
  });

  it("pages with Previous and More pools, keeping the window where it is", async () => {
    const { router } = mount(build(), "/xrpl/amm?deleted=1&marker=M1");
    const nav = within(poolsCard()).getByRole("navigation", { name: "Pagination" });
    expect(within(nav).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Previous", "/xrpl/amm?deleted=1"],
      ["More pools", `/xrpl/amm?deleted=1&marker=${AMM_MARKER}&back=M1`],
    ]);
    await act(async () => void fireEvent.click(within(nav).getByRole("link", { name: "More pools" })));
    expect(router.state.location.search).toBe(`?deleted=1&marker=${AMM_MARKER}&back=M1`);
    expect(router.state.preventScrollReset).toBe(true);
  });

  it("says under the table what Value and Volume 24 h are", () => {
    mount(build());
    expect(within(poolsCard()).getByText(
      "Value is twice the XRP reserve, or twice a reserve at its daily XRP rate. Volume 24 h is the swap volume of the last 24 hours in XRP, as of 17:01 UTC.",
    )).toBeTruthy();
  });

  it("says what an empty page of a filter is", () => {
    mount(build({ asset: { asset: rlusd, text: RLUSD_TEXT }, marker: undefined, pools: fulfilled(ammPoolsSample({ marker: undefined, count: 0, pools: [] })) }));
    expect(within(poolsCard()).getByText(`No pools have ${RLUSD_TEXT}.`)).toBeTruthy();
    expect(rowsOf()).toEqual([]);
  });

  it("is the card's SectionError when the pools failed, the rest of the page standing", () => {
    mount(build({ pools: rejected(new Error("503")) }));
    const card = poolsCard();
    expect(within(card).getByRole("alert").textContent).toContain("Couldn’t load the pools.");
    expect(within(card).queryByRole("table")).toBeNull();
    expect(within(card).queryByRole("navigation")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByText("As of 17:01 UTC.")).toBeTruthy();
  });

  it("dashes the Volume column and says so in the card when the live set failed", () => {
    mount(build({ live: rejected(new Error("503")) }));
    const card = poolsCard();
    expect(within(card).getByText("Couldn’t load the 24-hour volume")).toBeTruthy();
    expect(rowsOf().map((row) => cellsOf(row)[4]!.textContent)).toEqual(["—", "—", "—", "—"]);
    expect(within(card).getByText("Value is twice the XRP reserve, or twice a reserve at its daily XRP rate.")).toBeTruthy();
  });

  it("wraps a long figure inside its cell, so that it never widens the table (compact numbers stop at T)", () => {
    const css = read("../pages.css").replace(/\/\*[\s\S]*?\*\//g, "");
    // On the table's scroll region, which every cell inherits it from (the cell's class is the chart kit's, which pages.css must not define).
    const rule = /(?:^|\})\s*\.amm__table\s*\{([^}]*)\}/.exec(css);
    expect(rule, "a rule for the pools table").not.toBeNull();
    expect(rule![1]).toMatch(/overflow-wrap:\s*anywhere/);
    // The figure is all there, digit for digit: wrapped by the stylesheet, not cut by the page.
    const huge = ammPoolSample({ ...XRP_RLUSD, reserve_base: "1e+96" });
    mount(build({ pools: fulfilled(ammPoolsSample({ marker: undefined, count: 1, pools: [huge] })) }));
    const reserves = cellsOf(rowsOf()[0]!)[2]!;
    expect(reserves.textContent).toContain(`${compactNumber("1e+96")} RLUSD`);
    expect(compactNumber("1e+96").length).toBeGreaterThan(90);
  });

  it("gives the form's checkbox label and button, and the pager's buttons, 44 px targets", () => {
    const css = read("../pages.css").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const selector of [".amm__check", ".amm__submit", ".amm__foot .pager .btn"]) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rule = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
      expect(rule?.[1], selector).toMatch(/min-height:\s*44px/);
    }
  });

  it("is the same on the server as in the browser", async () => {
    const { html, errors } = await serverThenHydrated(routed(<AmmListPage data={build()} />));
    expect(html).toContain("AMM pools");
    expect(errors).toEqual([]);
  });
});

// ---- Xahau --------------------------------------------------------------------------------------------------------------------------------------

describe("NoAmmPage", () => {
  const markets = (on: boolean): NoAmmPageData => noAmmPage({ id: "xahau", features: { ...NO_FEATURES, ammPages: true, markets: on } });

  it("says that Xahau has no AMM, under the heading and its own intro", () => {
    render(routed(<NoAmmPage data={markets(true)} />, "/xahau/amm"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("AMM pools");
    expect(screen.getByText("Automated market maker pools.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Xahau has no AMM" })).toBeTruthy();
    expect(screen.getByText("The AMM amendment is not part of Xahau, so there are no pools to show. Trades on Xahau are order-book crossings.")).toBeTruthy();
    // Nothing of the list: no form, no totals, no table.
    expect(screen.queryByRole("group", { name: "Filters" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("links Xahau's markets while that page is on, and the XRPL pools", () => {
    render(routed(<NoAmmPage data={markets(true)} />, "/xahau/amm"));
    expect(screen.getByRole("link", { name: "See Xahau markets →" }).getAttribute("href")).toBe("/xahau/markets");
    expect(screen.getByRole("link", { name: "Switch to XRPL pools" }).getAttribute("href")).toBe("/xrpl/amm");
  });

  it("shows the markets in the header's soon style, not as a link, while that page is off", () => {
    render(routed(<NoAmmPage data={markets(false)} />, "/xahau/amm"));
    expect(screen.queryByRole("link", { name: /See Xahau markets/ })).toBeNull();
    const soon = screen.getByText("See Xahau markets →").closest(".nav-item")!;
    expect(soon.className).toBe("nav-item is-soon");
    expect(soon.getAttribute("aria-disabled")).toBe("true");
    expect(soon.querySelector(".soon")!.textContent).toBe("soon");
    expect(screen.getByRole("link", { name: "Switch to XRPL pools" }).getAttribute("href")).toBe("/xrpl/amm");
  });

  it("draws its icon hidden from assistive technology", () => {
    const { container } = render(routed(<NoAmmPage data={markets(true)} />, "/xahau/amm"));
    const icons = container.querySelectorAll("svg");
    expect(icons.length).toBeGreaterThan(0);
    for (const svg of icons) expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("is the same on the server as in the browser", async () => {
    const { errors } = await serverThenHydrated(routed(<NoAmmPage data={markets(false)} />, "/xahau/amm"));
    expect(errors).toEqual([]);
  });
});

// ---- What the browser runs ------------------------------------------------------------------------------------------------------------------------

describe("the files of the AMM pages that run in the browser", () => {
  // A client-side navigation draws these pages in the browser: they get strings from the view builder (app/server/amm-view.ts, which value-imports the issuer
  // checksums) and never fetch. A type import is erased and costs nothing; a value import is the bug.
  const FORBIDDEN = [/\/server\//, /\/describe(\/|$)/, /\/parse(\/|$)/, /\/asset$/, /ripple-/];

  it.each(["./AmmListPage.tsx", "./NoAmmPage.tsx", "../components/Pager.tsx"])("%s imports nothing of the server, describe, parse, asset or ripple-* as a value", (file) => {
    expect(valueImports(read(file)).filter((from) => FORBIDDEN.some((pattern) => pattern.test(from)))).toEqual([]);
  });

  it("is checked by patterns that catch each of those", () => {
    const source = [
      `import { ammListPage } from "../../server/amm-view";`,
      `import type { AmmListPageData } from "../../server/amm-view";`,
      `import { describe } from "../../domain/describe";`,
      `import { parseTx } from "../../domain/parse/tx";`,
      `import { assetText } from "../../domain/asset";`,
      `import { isValidClassicAddress } from "ripple-address-codec";`,
      `import { ammListPath } from "../../domain/amm-params";`,
    ].join("\n");
    expect(valueImports(source).filter((from) => FORBIDDEN.some((pattern) => pattern.test(from)))).toEqual([
      "../../server/amm-view",
      "../../domain/describe",
      "../../domain/parse/tx",
      "../../domain/asset",
      "ripple-address-codec",
    ]);
  });
});
