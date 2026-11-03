import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MPT_FIXTURE_IDS } from "../../../test/support/mpt-case-rules";
import { mptFlagsSample, mptTokenRowSample, mptTokensSample, MPT_SAMPLE_ID, MPT_SAMPLE_ISSUER } from "../../../test/support/mpt-samples";
import { LAYOUT_XRPL, mountPage } from "../../../test/support/under-network";
import { shortAddress } from "../../domain/format";
import type { NameMap } from "../../domain/names";
import { mptTokensTab, type MptRowView } from "../../server/mpt-view";
import { NO_FEATURES } from "../features";
import { NamesProvider } from "../names";
import { MptTable } from "./MptTable";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The MPT tab's table (E14 spec 4): the board's columns in the kit's `DataTable`, drawn from the rows the view builder writes (`mptTokensTab`). It imports nothing of the Worker at run time (test/unit/token-bundle.test.ts).

const FEATURES = { ...NO_FEATURES, tokens: true, mpt: true };
const NET = { ...LAYOUT_XRPL, features: FEATURES };

/** The rows of a list of `over`'s, as the view builder writes them. */
const rowsOf = (...over: Array<Parameters<typeof mptTokenRowSample>[0]>): MptRowView[] =>
  mptTokensTab(mptTokensSample({ tokens: over.map((one) => mptTokenRowSample(one)) }), { net: NET }).mpt!.rows;

function mount(rows: readonly MptRowView[], { empty = null, names = {} }: { empty?: string | null; names?: NameMap } = {}) {
  return mountPage(
    <NamesProvider names={names}>
      <MptTable net="xrpl" rows={rows} caption="MPTs" empty={empty} />
    </NamesProvider>,
    "routes/net.tokens",
    { at: "/xrpl/tokens?kind=mpt", network: LAYOUT_XRPL, features: FEATURES },
  );
}

const table = () => screen.getByRole("table", { name: "MPTs" });
const body = () => within(table()).getAllByRole("row").slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole("cell");
const texts = (nodes: Iterable<Element>) => [...nodes].map((node) => node.textContent);

describe("MptTable: the columns", () => {
  it("is a named table of the board's columns", () => {
    mount(rowsOf({}));
    expect(texts(within(table()).getAllByRole("columnheader"))).toEqual(["#", "Token", "Issuer", "Holders", "Outstanding", "Max amount", "Flags", "Transfers 24 h"]);
    // The kit's table: a region a keyboard can scroll, named for the table.
    expect(screen.getByRole("region", { name: "MPTs, scrollable table" })).toBeTruthy();
    expect(body()).toHaveLength(1);
  });

  it("draws a row: the rank, the token as one link with its coin, ticker and name, the issuer, and the figures", () => {
    mount(rowsOf({}));
    const [rank, token, issuer, holders, outstanding, max, flags, transfers] = cells(body()[0]!);
    expect(rank!.textContent).toBe("1");
    const link = within(token!).getByRole("link");
    expect(link.getAttribute("href")).toBe(`/xrpl/mpt/${MPT_SAMPLE_ID}`);
    expect(within(token!).getAllByRole("link")).toHaveLength(1);
    // The coin is decoration (`aria-hidden`): the ticker's first letter; the name stands under the ticker.
    const coin = link.querySelector(".amm__coins")!;
    expect(coin.getAttribute("aria-hidden")).toBe("true");
    expect(coin.textContent).toBe("H");
    expect(link.querySelector(".mpttab__code")!.textContent).toBe("HTF");
    expect(link.querySelector(".mpttab__name")!.textContent).toBe("Harborline Treasury Fund");
    expect(within(issuer!).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${MPT_SAMPLE_ISSUER}`);
    expect(texts([holders!, outstanding!, max!, transfers!])).toEqual(["3,412", "18.2M", "50M", "412"]);
    expect(flags!.querySelectorAll(".pill")).toHaveLength(5);
  });

  it("draws the issuer by its name, with the mark that says how it is known, when the names have one, and by its short address otherwise", () => {
    const names: NameMap = { [MPT_SAMPLE_ISSUER]: { name: { text: "Harborline", kind: "verified" }, domain: "harborline.example", labels: [] } };
    mount(rowsOf({}), { names });
    const [, , issuer] = cells(body()[0]!);
    expect(within(issuer!).getByRole("link").textContent).toContain("Harborline");
    expect(within(issuer!).getByRole("link").textContent).toContain("verified name");
    cleanup();
    mount(rowsOf({}));
    expect(within(cells(body()[0]!)[2]!).getByRole("link").textContent).toBe(shortAddress(MPT_SAMPLE_ISSUER));
  });
});

describe("MptTable: the Token cell", () => {
  it("is the no-metadata cell without a ticker: 'No metadata', the short ID with the full ID in its title, a '?' coin, and still the link", () => {
    mount(rowsOf({ ticker: undefined, name: undefined, mpt_issuance_id: MPT_FIXTURE_IDS.noMetadata }));
    const [, token] = cells(body()[0]!);
    const link = within(token!).getByRole("link");
    expect(link.getAttribute("href")).toBe(`/xrpl/mpt/${MPT_FIXTURE_IDS.noMetadata}`);
    expect(link.querySelector(".amm__coins")!.textContent).toBe("?");
    expect(link.querySelector(".mpttab__code")!.textContent).toBe("No metadata");
    const id = link.querySelector(".mpttab__id")!;
    expect(id.textContent).toBe(`${MPT_FIXTURE_IDS.noMetadata.slice(0, 8)}…${MPT_FIXTURE_IDS.noMetadata.slice(-4)}`);
    expect(id.getAttribute("title")).toBe(`Issuance ID ${MPT_FIXTURE_IDS.noMetadata}`);
    expect(link.querySelector(".mpttab__name")).toBeNull();
  });

  it("has a ticker with no name as the ticker alone", () => {
    mount(rowsOf({ name: undefined }));
    const link = within(cells(body()[0]!)[1]!).getByRole("link");
    expect(link.querySelector(".mpttab__code")!.textContent).toBe("HTF");
    expect(link.querySelector(".mpttab__name")).toBeNull();
    expect(link.querySelector(".mpttab__id")).toBeNull();
  });

  it("is text, not a link, for a row with no href (a switch that is off)", () => {
    const off = mptTokensTab(mptTokensSample(), { net: { ...NET, features: { ...FEATURES, mpt: false } } }).mpt!.rows;
    mount(off);
    const [, token] = cells(body()[0]!);
    expect(within(token!).queryByRole("link")).toBeNull();
    expect(token!.querySelector(".mpttab__code")!.textContent).toBe("HTF");
  });

  it("draws the issuer's text as text: markup in a ticker or a name is shown, never parsed, and the long name has nowhere to break but the edge of its cell (pages.css)", () => {
    const name = `${"W".repeat(128)}`;
    mount(rowsOf({ ticker: '<img src=x onerror="alert(1)">', name }));
    const [, token] = cells(body()[0]!);
    expect(token!.querySelector("img")).toBeNull();
    expect(token!.querySelector(".mpttab__code")!.textContent).toBe("<img src=x onerr");
    expect(token!.querySelector(".mpttab__name")!.textContent).toBe(name);
  });
});

describe("MptTable: Max amount and Flags", () => {
  it("says 'not set' in faint where the issuance has no maximum", () => {
    mount(rowsOf({ maximum_amount: undefined }));
    const [, , , , , max] = cells(body()[0]!);
    const cell = within(max!).getByText("not set");
    expect(cell.className).toContain("faint");
    expect(rowsOf({ maximum_amount: undefined })[0]!.max).toBeNull();
  });

  it("draws a pill for each flag, in the board's order, each in a span with its title; neutral and with no icon, so a word and never a colour alone", () => {
    mount(rowsOf({ flags: mptFlagsSample({ can_escrow: true }) }));
    const pills = [...cells(body()[0]!)[6]!.querySelectorAll(".pill")];
    expect(texts(pills)).toEqual(["Transfer", "Trade", "Lock", "Clawback", "Escrow", "Auth"]);
    expect(pills.map((pill) => pill.parentElement!.getAttribute("title"))).toEqual([
      "Holders can send it to each other",
      "The issuer allows it on the DEX. MPT trading isn't enabled on XRPL yet.",
      "The issuer can lock balances",
      "The issuer can take it back",
      "It can be held in escrows",
      "Holders need the issuer's approval",
    ]);
    for (const pill of pills) {
      expect(pill.className).toContain("pill--neutral");
      expect(pill.querySelector("svg")).toBeNull();
    }
  });

  it("says 'none' in faint for an issuance with no ability", () => {
    mount(rowsOf({ flags: mptFlagsSample({ can_lock: false, require_auth: false, can_trade: false, can_transfer: false, can_clawback: false }) }));
    const [, , , , , , flags] = cells(body()[0]!);
    expect(flags!.querySelectorAll(".pill")).toHaveLength(0);
    expect(within(flags!).getByText("none").className).toContain("faint");
  });
});

describe("MptTable: no rows", () => {
  it("says what the table is empty of, under the header row", () => {
    mount([], { empty: "No MPTs match “zzz”." });
    expect(screen.getByText("No MPTs match “zzz”.")).toBeTruthy();
    expect(within(table()).queryAllByRole("row")).toHaveLength(1);
  });

  it("says nothing without a message", () => {
    const { container } = mount([]);
    expect(container.querySelector(".table__empty")).toBeNull();
  });
});
