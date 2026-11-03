import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MPT_SAMPLE_HASH, MPT_SAMPLE_HOLDER, MPT_SAMPLE_ID, MPT_SAMPLE_ISSUER, MPT_SAMPLE_OTHER_HOLDER, mptCoverageSample, mptHolderSample, mptHoldersSample, mptIssuanceSample, mptLockSample, mptSample, mptTransferSample, mptTransfersSample } from "../../../test/support/mpt-samples";
import { LAYOUT_XAHAU, LAYOUT_XRPL, LAYOUT_XRPL_TESTNET, mountPage } from "../../../test/support/under-network";
import { NO_NAMES, type NameMap, type NamesPart } from "../../domain/names";
import type { Loaded } from "../../server/account-view";
import type { MptIssuance, NodeMptIssuance } from "../../server/api-types";
import { mptPage, noMptPage, type MptPageData, type MptSource } from "../../server/mpt-view";
import { NO_FEATURES } from "../features";
import { NamesProvider } from "../names";
import { MptPage } from "./MptPage";
import { NoMptPage } from "./NoMptPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The MPT page's data as the view builder writes it (`mptPage`), drawn under the `/:net` layout: the head, the notices, the six figures, the two cards of flags and metadata, the top holders and
// the recent transfers, each of the last two on its own failing or missing, and the page that says MPT is not on Xahau.

const FEATURES = { ...NO_FEATURES, tokens: true, mpt: true };
const PATH = `/xrpl/mpt/${MPT_SAMPLE_ID}`;
const ok = <T,>(value: T): Loaded<T> => ({ state: "ok", value });
const indexed = (over: Partial<MptIssuance> = {}): MptSource => ({ origin: "index", answer: mptSample({ issuance: mptIssuanceSample(over) }) });
const fromNode = (over: Partial<NodeMptIssuance> = {}): MptSource => ({
  origin: "node",
  node: { LedgerEntryType: "MPTokenIssuance", Issuer: MPT_SAMPLE_ISSUER, Sequence: 298, Flags: 0x22, AssetScale: 2, OutstandingAmount: "1820451120", ...over },
  ledgerIndex: 107_795_512,
  id: MPT_SAMPLE_ID,
});

function build(over: Partial<Parameters<typeof mptPage>[0]> = {}): MptPageData {
  return mptPage({ net: LAYOUT_XRPL, source: indexed(), holders: ok(mptHoldersSample()), transfers: ok(mptTransfersSample()), names: NO_NAMES, ...over });
}

function mount(data: MptPageData, { at = PATH, network = LAYOUT_XRPL, names = {} }: { at?: string; network?: typeof LAYOUT_XRPL; names?: NameMap } = {}) {
  return mountPage(
    <NamesProvider names={names}>
      <MptPage data={data} />
    </NamesProvider>,
    "routes/net.mpt.$id",
    { at, network, features: FEATURES },
  );
}

const card = (name: string) => screen.getByRole("region", { name });
const rowsOf = (table: HTMLElement) => within(table).getAllByRole("row").slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole("cell");
const texts = (nodes: Iterable<Element>) => [...nodes].map((node) => node.textContent);

describe("MptPage: the head", () => {
  it("has the breadcrumb, with the ticker as the current page", () => {
    mount(build());
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "XRPL" }).getAttribute("href")).toBe("/xrpl");
    // The MPT pages exist only where the MPT tab is a view, so the crumb leads there (the whole-branch review's M4), not to the issued list where no MPT is listed.
    expect(crumbs.getByRole("link", { name: "Tokens" }).getAttribute("href")).toBe("/xrpl/tokens?kind=mpt");
    expect(crumbs.getByText("HTF").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("XRPL/Tokens/HTF");
  });

  it("is the h1 of the name with the ticker and MPT tags, the coin's letter, the issuer in full, and the words that say where the name came from", () => {
    const { container } = mount(build());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Harborline Treasury Fund");
    expect(texts(container.querySelectorAll(".token-page__name .tag"))).toEqual(["HTF", "MPT"]);
    expect(container.querySelector(".amm__coin")!.textContent).toBe("H");
    expect(container.querySelector(".amm__coins")!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Issued by")).toBeTruthy();
    expect(screen.getByRole("link", { name: MPT_SAMPLE_ISSUER }).getAttribute("href")).toBe(`/xrpl/account/${MPT_SAMPLE_ISSUER}`);
    expect(screen.getByText("· name and ticker from the issuance's metadata")).toBeTruthy();
  });

  it("names the issuer by what the route's names say of it", () => {
    mount(build(), { names: { [MPT_SAMPLE_ISSUER]: { name: { text: "Harborline Capital", kind: "verified" }, domain: "harborline.example", labels: [] } } });
    expect(screen.getAllByRole("link").some((link) => link.getAttribute("href") === `/xrpl/account/${MPT_SAMPLE_ISSUER}` && /Harborline Capital/.test(link.textContent ?? ""))).toBe(true);
  });

  it("has the issuer's account button, the whole issuance ID in mono, a button that copies it, and the source line", () => {
    const { container } = mount(build());
    expect(screen.getByRole("link", { name: "Issuer account" }).getAttribute("href")).toBe(`/xrpl/account/${MPT_SAMPLE_ISSUER}`);
    expect(screen.getByText("Issuance ID")).toBeTruthy();
    expect(container.querySelector(".mpt__idtext")!.textContent).toBe(MPT_SAMPLE_ID);
    expect(container.querySelector(".mpt__idtext")!.classList.contains("mono")).toBe(true);
    expect(screen.getByRole("button", { name: "Copy issuance ID" })).toBeTruthy();
    expect(screen.getAllByText(`/v2/mpt/${MPT_SAMPLE_ID}`).length).toBeGreaterThan(0);
  });

  it("copies the ID", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    mount(build());
    fireEvent.click(screen.getByRole("button", { name: "Copy issuance ID" }));
    await screen.findByText("Copied");
    expect(writeText).toHaveBeenCalledWith(MPT_SAMPLE_ID);
    vi.unstubAllGlobals();
  });

  it("is headed by 'MPT' and the ID's start and end, with a '?' coin and no ticker tag and no 'from the metadata', where the issuance has no ticker or name", () => {
    const { container } = mount(build({ source: indexed({ ticker: undefined, name: undefined, metadata: undefined, metadata_hex: undefined, metadata_conforms: undefined }) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(`MPT ${MPT_SAMPLE_ID.slice(0, 8)}…${MPT_SAMPLE_ID.slice(-4)}`);
    expect(container.querySelector(".amm__coin")!.textContent).toBe("?");
    expect(texts(container.querySelectorAll(".token-page__name .tag"))).toEqual(["MPT"]);
    expect(container.textContent).not.toContain("from the issuance's metadata");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("XRPL/Tokens/MPT");
  });

  it("has the sandbox's names in the breadcrumb", () => {
    mount(build({ net: LAYOUT_XRPL_TESTNET }), { network: LAYOUT_XRPL_TESTNET });
    expect(screen.getByRole("link", { name: "XRPL Testnet" }).getAttribute("href")).toBe("/xrpl");
  });
});

describe("MptPage: the notices", () => {
  it("has none for an ordinary issuance", () => {
    const { container } = mount(build());
    expect(container.querySelector(".notice")).toBeNull();
  });

  it("says a destroyed issuance was destroyed in a ledger that is a link to it", () => {
    mount(build({ source: indexed({ destroyed: true, last_ledger: 107795512 }) }));
    const notice = screen.getByText(/This issuance was destroyed in ledger/).closest(".notice") as HTMLElement;
    expect(notice.textContent).toBe("This issuance was destroyed in ledger #107,795,512.");
    expect(within(notice).getByRole("link", { name: "#107,795,512" }).getAttribute("href")).toBe("/xrpl/ledger/107795512");
    expect(notice.classList.contains("notice--warning")).toBe(true);
  });

  it("says the issuer has locked every balance, with the ticker", () => {
    mount(build({ source: indexed({ flags: { ...mptIssuanceSample().flags, locked: true } }) }));
    expect(screen.getByText("The issuer has locked every HTF balance.").closest(".notice")!.classList.contains("notice--warning")).toBe(true);
  });

  it("says an issuance read from the network is not in the index yet, as an information", () => {
    mount(build({ source: fromNode(), holders: { state: "missing" }, transfers: { state: "missing" } }));
    expect(screen.getByText("Not in the index yet, shown from the network").closest(".notice")!.classList.contains("notice--info")).toBe(true);
  });
});

describe("MptPage: the figures", () => {
  it("are six tiles, each with its label, its value and its line", () => {
    const { container } = mount(build());
    const tiles = [...container.querySelectorAll(".stat")].map((tile) => [tile.querySelector(".stat__label")!.textContent, tile.querySelector(".stat__value")!.textContent, tile.querySelector(".stat__sub")!.textContent]);
    expect(tiles).toEqual([
      ["Outstanding", "18,204,511.20", "HTF held by holders, 36.4% of the max amount"],
      ["Max amount", "50,000,000.00", "HTF, fixed when the issuance was created"],
      ["Locked", "1,240,000.00", "HTF in 1 holder balance the issuer has locked"],
      ["Holders", "3,412", "accounts holding HTF"],
      ["Transfer fee", "0.10%", "charged when holders send HTF to each other"],
      ["Asset scale", "2", "Amounts are integers scaled by 10⁻²: 1 HTF is 100 on the ledger."],
    ]);
    expect(screen.getByRole("region", { name: "Figures" })).toBeTruthy();
  });
});

describe("MptPage: the flags", () => {
  it("are a card of six rows with Yes and No in text", () => {
    mount(build());
    const flags = card("Flags");
    expect(within(flags).getByText("What the issuer allows, as the issuance says now.")).toBeTruthy();
    const rows = within(flags).getAllByRole("listitem");
    expect(rows).toHaveLength(6);
    expect(texts(rows.map((row) => row.querySelector(".pill")!))).toEqual(["Yes", "Yes", "No", "Yes", "Yes", "Yes"]);
    expect(within(flags).getByText("The issuer allows HTF on the DEX. MPT trading isn't enabled on XRPL yet.")).toBeTruthy();
  });
});

describe("MptPage: the metadata", () => {
  const metadataCard = () => card("Metadata");

  it("lists the decoded fields by their long key, a link only where the builder made one, and the raw hex in a disclosure that names its size", () => {
    mount(build());
    const metadata = metadataCard();
    expect(within(metadata).getByText("What the issuer wrote into the issuance, decoded. Nothing here is checked against the issuer's domain.")).toBeTruthy();
    const keys = texts(metadata.querySelectorAll("dt"));
    expect(keys).toEqual(["ticker", "name", "desc", "icon", "asset_class", "asset_subclass", "issuer_name", "uris"]);
    const values = texts(metadata.querySelectorAll("dd"));
    expect(values[4]).toBe("rwa (real-world asset)");
    const summary = metadata.querySelector("details.mpt__hex > summary")!;
    expect(summary.textContent).toBe("Raw metadata, as hex (16 bytes)");
    expect(metadata.querySelector("details pre")!.textContent).toBe("7B227469636B6572223A22485446227D");
    expect(metadata.querySelector("details")!.hasAttribute("open")).toBe(false);
  });

  it("opens a link the issuer wrote in a new tab, without referrer or opener, not followed, with the words for a screen reader and the category in its title", () => {
    mount(build());
    const links = within(metadataCard()).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://harborline.example/htf/icon.png", "https://harborline.example/htf"]);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow ugc");
      expect(link.querySelector(".sr")!.textContent).toBe(" (opens a new tab)");
    }
    expect(links[1]!.getAttribute("title")).toBe("website");
    expect(links[1]!.textContent).toContain("Fund page · harborline.example/htf");
    expect(links[0]!.getAttribute("title")).toBeNull();
  });

  it("says metadata that does not follow XLS-89 may be missing something, and keeps what it has", () => {
    mount(build({ source: indexed({ metadata_conforms: false }) }));
    expect(within(metadataCard()).getByText("This metadata doesn't follow XLS-89, so some of it may be missing here.")).toBeTruthy();
    expect(within(metadataCard()).getAllByRole("term").length).toBeGreaterThan(0);
  });

  it("says that for metadata that decoded to nothing, with no list", () => {
    mount(build({ source: indexed({ metadata: {}, metadata_conforms: false, metadata_hex: "7B7D" }) }));
    expect(within(metadataCard()).getByText("This metadata doesn't follow XLS-89, so some of it may be missing here.")).toBeTruthy();
    expect(metadataCard().querySelector("dl")).toBeNull();
    expect(metadataCard().querySelector("summary")!.textContent).toBe("Raw metadata, as hex (2 bytes)");
  });

  it("draws additional_info as indented JSON in a block a keyboard can scroll", () => {
    mount(build({ source: indexed({ metadata: { additional_info: { a: "1", b: { c: 2 } } } }) }));
    const block = metadataCard().querySelector("pre.mpt__json")!;
    expect(block.textContent).toBe(JSON.stringify({ a: "1", b: { c: 2 } }, null, 2));
    expect(block.getAttribute("tabindex")).toBe("0");
    expect(block.getAttribute("role")).toBe("region");
  });

  it("says the issuer wrote no metadata", () => {
    mount(build({ source: indexed({ metadata: undefined, metadata_hex: undefined, metadata_conforms: undefined }) }));
    expect(within(metadataCard()).getByText("The issuer wrote no metadata.")).toBeTruthy();
    expect(metadataCard().querySelector("details")).toBeNull();
  });

  it("says the metadata is not JSON where it did not decode, with its text when it reads as text, and then the hex", () => {
    const hex = "68747470733A2F2F6578616D706C652E6F7267";
    mount(build({ source: indexed({ metadata: undefined, metadata_hex: hex, metadata_conforms: false }) }));
    const metadata = metadataCard();
    expect(within(metadata).getByText("The metadata isn't JSON.")).toBeTruthy();
    expect(metadata.querySelector("pre.mpt__json")!.textContent).toBe("https://example.org");
    expect(metadata.querySelector("summary")!.textContent).toBe("Raw metadata, as hex (19 bytes)");
    // The text is text, not a link: nothing here was made safe.
    expect(within(metadata).queryByRole("link")).toBeNull();
  });

  it("draws bytes that are no text as the hex alone", () => {
    mount(build({ source: indexed({ metadata: undefined, metadata_hex: "FFFE00", metadata_conforms: false }) }));
    expect(metadataCard().querySelector("pre.mpt__json")).toBeNull();
    expect(metadataCard().querySelector("details pre")!.textContent).toBe("FFFE00");
  });

  it("says what the node wrote, as written, and that the index decodes it later", () => {
    mount(build({ source: fromNode({ MPTokenMetadata: "68656C6C6F" }), holders: { state: "missing" }, transfers: { state: "missing" } }));
    const metadata = metadataCard();
    expect(within(metadata).getByText("Read from the network as written; the index decodes it once it holds this issuance.")).toBeTruthy();
    expect(within(metadata).queryByText("The metadata isn't JSON.")).toBeNull();
    expect(metadata.querySelector("pre.mpt__json")!.textContent).toBe("hello");
    expect(metadata.querySelector("summary")!.textContent).toBe("Raw metadata, as hex (5 bytes)");
  });

  it("puts no metadata text in an attribute but a safe href", () => {
    const hostile = `"><img src=x onerror=alert(1)>`;
    const script = "javascript:alert(1)";
    const { container } = mount(
      build({
        source: indexed({
          ticker: undefined,
          name: hostile,
          metadata: {
            name: hostile,
            desc: hostile,
            icon: script,
            asset_class: hostile,
            asset_subclass: hostile,
            issuer_name: hostile,
            uris: [{ uri: script, title: hostile, category: hostile }, { uri: "https://good.example/x", title: hostile, category: hostile }],
            additional_info: { k: hostile },
          },
        }),
      }),
    );
    // Markup is text: no element came out of it.
    expect(container.querySelector("img")).toBeNull();
    // No attribute of the page holds a piece of it, and the only absolute links are https ones.
    for (const element of container.querySelectorAll("*")) {
      for (const attribute of element.getAttributeNames()) {
        const value = element.getAttribute(attribute)!;
        expect(value, `${element.tagName} ${attribute}`).not.toContain("<img");
        expect(value, `${element.tagName} ${attribute}`).not.toContain("javascript:");
        expect(value, `${element.tagName} ${attribute}`).not.toContain("onerror");
      }
    }
    const external = [...container.querySelectorAll<HTMLAnchorElement>("a[href]")].map((link) => link.getAttribute("href")!).filter((href) => /^[a-z]+:/i.test(href));
    expect(external).toEqual(["https://good.example/x"]);
    // And it is all there as text.
    expect(container.textContent).toContain(hostile);
    expect(container.textContent).toContain(script);
  });

  it("leaves a long unbroken name, description and link words whole in the page: the stylesheet breaks them", () => {
    const long = "w".repeat(128);
    mount(build({ source: indexed({ name: long, metadata: { name: long, desc: "d".repeat(200), uris: [{ uri: "https://long.example/x", title: "t".repeat(100) }] } }) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(long);
    expect(metadataCard().textContent).toContain("d".repeat(200));
    expect(metadataCard().textContent).toContain(`${"t".repeat(100)} · long.example/x`);
  });
});

describe("MptPage: the top holders", () => {
  it("is a named table with the board's columns, the rank, the account, the balance with its escrow under it, the share and the state", () => {
    mount(build());
    const holders = card("Top holders");
    const table = within(holders).getByRole("table", { name: "Top holders" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["#", "Holder", "Balance (HTF)", "Share of outstanding", "Balance state"]);
    const [first, second] = rowsOf(table);
    expect(cells(first!)[0]!.textContent).toBe("1");
    expect(within(cells(first!)[1]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${MPT_SAMPLE_HOLDER}`);
    expect(cells(first!)[2]!.textContent).toBe("6,120,400.00");
    expect(cells(first!)[3]!.textContent).toBe("33.62%");
    expect(cells(first!)[4]!.textContent).toBe("Can move");
    expect(cells(second!)[2]!.textContent).toBe("2,500,010.00incl. 10.00 in escrow");
    expect(cells(second!)[4]!.textContent).toBe("Locked");
    expect(within(holders).getByText(`/v2/mpt/${MPT_SAMPLE_ID}/holders`)).toBeTruthy();
  });

  it("draws the share as a decorative meter beside the percent that says it, the percent first", () => {
    mount(build());
    const meter = card("Top holders").querySelector(".meter")!;
    expect(meter.getAttribute("aria-hidden")).toBe("true");
    expect(meter.hasAttribute("role")).toBe(false);
    const cell = cells(rowsOf(within(card("Top holders")).getByRole("table", { name: "Top holders" }))[0]!)[3]!;
    expect(cell.firstElementChild!.firstElementChild!.textContent).toBe("33.62%");
    expect((card("Top holders").querySelectorAll(".meter__fill")[0] as HTMLElement).style.width).toBe("100%");
  });

  it("says Locked in a pill with its title and Can move in words: the state is never a colour alone", () => {
    mount(build());
    const [first, second] = rowsOf(within(card("Top holders")).getByRole("table", { name: "Top holders" }));
    expect(cells(second!)[4]!.querySelector("span[title]")!.getAttribute("title")).toBe("The issuer has locked this balance, so it cannot move.");
    expect(cells(second!)[4]!.querySelector(".pill")!.textContent).toBe("Locked");
    expect(cells(first!)[4]!.querySelector(".pill")).toBeNull();
  });

  it("has the top line, the link to all the holders and, while the index is incomplete, the coverage note and the line that follows it", () => {
    mount(build({ holders: ok(mptHoldersSample({ coverage: mptCoverageSample({ complete: false }) })) }));
    const holders = card("Top holders");
    expect(within(holders).getByText(/^The top 2 hold /)).toBeTruthy();
    expect(within(holders).getByRole("link", { name: "All 3,412 holders →" }).getAttribute("href")).toBe(`${PATH}/holders`);
    const note = within(holders).getByRole("note");
    expect(note.textContent).toBe("Covers ledger #99,226,369 onwards: earlier holders are not in the index yet.");
    expect(within(note).getByRole("link", { name: "#99,226,369" }).getAttribute("href")).toBe("/xrpl/ledger/99226369");
    expect(within(holders).getByText("A holder whose balance has not changed since is not listed yet.")).toBeTruthy();
  });

  it("has no note when the index is complete", () => {
    mount(build());
    expect(within(card("Top holders")).queryByRole("note")).toBeNull();
    expect(within(card("Top holders")).queryByText(/not listed yet/)).toBeNull();
  });

  it("says nobody holds the token, and 'yet in the index' while the index is incomplete", () => {
    mount(build({ holders: ok(mptHoldersSample({ holders: [], count: 0, marker: undefined, coverage: mptCoverageSample({ complete: false }) })) }));
    expect(within(card("Top holders")).getByText("Nobody holds HTF yet in the index.")).toBeTruthy();
  });

  it("is told 'Not in the index yet.' where the index has no rows for the issuance", () => {
    mount(build({ holders: { state: "missing" } }));
    expect(within(card("Top holders")).getByText("Not in the index yet.")).toBeTruthy();
    expect(within(card("Top holders")).queryByRole("table")).toBeNull();
  });

  it("is told in its place, with a Retry that asks the route again, and the rest of the page stands", () => {
    const { loader } = mount(build({ holders: { state: "failed" } }));
    const alert = within(card("Top holders")).getByRole("alert");
    expect(alert.textContent).toBe("Couldn’t load the top holders.Retry");
    expect(within(card("Top holders")).queryByRole("table")).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(loader).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Harborline Treasury Fund");
    expect(within(card("Recent transfers")).getByRole("table", { name: "Recent transfers" })).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

describe("MptPage: the recent transfers", () => {
  it("is a named table with the board's columns, the time in two lines, the kind, the parties, the amount and the transaction", () => {
    mount(build());
    const transfers = card("Recent transfers");
    const table = within(transfers).getByRole("table", { name: "Recent transfers" });
    expect(texts(within(table).getAllByRole("columnheader"))).toEqual(["Time (UTC)", "Kind", "From", "To", "Amount (HTF)", "Transaction"]);
    const [payment, lock] = rowsOf(table);
    expect(cells(payment!)[0]!.textContent).toBe("2026-10-24" + "14:11:05");
    expect(cells(payment!)[1]!.textContent).toBe("Transfer");
    expect(within(cells(payment!)[2]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${MPT_SAMPLE_HOLDER}`);
    expect(within(cells(payment!)[3]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${MPT_SAMPLE_OTHER_HOLDER}`);
    expect(cells(payment!)[4]!.textContent).toBe("25,000.00");
    expect(within(cells(payment!)[5]!).getByRole("link").getAttribute("href")).toBe(`/xrpl/tx/${MPT_SAMPLE_HASH}`);
    expect(cells(lock!)[1]!.textContent).toBe("Lock");
    expect(cells(lock!)[3]!.textContent).toBe("every holder");
    expect(within(cells(lock!)[3]!).queryByRole("link")).toBeNull();
    expect(cells(lock!)[4]!.querySelector(".muted")!.textContent).toBe("18,204,511.20");
    expect(cells(payment!)[4]!.querySelector(".muted")).toBeNull();
  });

  it("has the board's footnote with the issuer by its name, Older with the marker of its call, and the coverage note of the transfers", () => {
    const names: NamesPart = { state: "ok", map: { [MPT_SAMPLE_ISSUER]: { name: { text: "Harborline", kind: "verified" }, domain: "harborline.example", labels: [] } } };
    mount(build({ names, transfers: ok(mptTransfersSample({ coverage: mptCoverageSample({ complete: false }) })) }), { names: names.map });
    const transfers = card("Recent transfers");
    expect(within(transfers).getByText(/^Newest first\. A transfer from /).textContent).toBe(
      "Newest first. A transfer from Harborline issues new HTF. A clawback takes HTF back. A lock stops a balance from moving; its amount is the balance locked.",
    );
    expect(within(transfers).getByRole("link", { name: "Older →" }).getAttribute("href")).toMatch(new RegExp(`^${PATH}/transfers\\?marker=`));
    expect(within(transfers).getByRole("note").textContent).toBe("Covers ledger #99,226,369 onwards: earlier transfers are not in the index yet.");
  });

  it("has no Older where the call had no marker, and says there is no transfer in the index", () => {
    mount(build({ transfers: ok(mptTransfersSample({ transfers: [], count: 0, marker: undefined })) }));
    const transfers = card("Recent transfers");
    expect(within(transfers).queryByRole("link", { name: "Older →" })).toBeNull();
    expect(within(transfers).getByText("No transfers of HTF in the index.")).toBeTruthy();
  });

  it("is told 'Not in the index yet.' where the index has no rows, and in its place with a Retry where the call failed", () => {
    mount(build({ transfers: { state: "missing" } }));
    expect(within(card("Recent transfers")).getByText("Not in the index yet.")).toBeTruthy();
    cleanup();
    const { loader } = mount(build({ transfers: { state: "failed" } }));
    const alert = within(card("Recent transfers")).getByRole("alert");
    expect(alert.textContent).toBe("Couldn’t load the recent transfers.Retry");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(loader).toHaveBeenCalled();
  });
});

describe("MptPage: as a page", () => {
  it("never fetches", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    mount(build());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says a lock and a clawback in words in the Kind column: a muted amount is not the only sign", () => {
    mount(build({ transfers: ok(mptTransfersSample({ transfers: [mptLockSample(), mptTransferSample({ kind: "clawback" })] })) }));
    const rows = rowsOf(within(card("Recent transfers")).getByRole("table", { name: "Recent transfers" }));
    expect(texts(rows.map((row) => cells(row)[1]!))).toEqual(["Lock", "Clawback"]);
  });
});

describe("NoMptPage", () => {
  const xahau = (kind: "mainnet" | "testnet" = "mainnet") => noMptPage({ id: "xahau", kind, other: "xrpl" }, MPT_SAMPLE_ID);

  it("is the board's Xahau state: the heading, the sentence, the ID in mono, the way back and the link that opens it on XRPL", () => {
    const { container } = mountPage(<NoMptPage data={xahau()} />, "routes/net.mpt.$id", { at: `/xahau/mpt/${MPT_SAMPLE_ID}`, network: LAYOUT_XAHAU, features: FEATURES });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("MPT isn't enabled on Xahau");
    expect(screen.getByText("MPTs exist only on XRPL, so there is nothing at this issuance ID on Xahau.")).toBeTruthy();
    expect(container.querySelector(".mpt__idtext")!.textContent).toBe(MPT_SAMPLE_ID);
    expect(container.querySelector(".mpt__idtext")!.classList.contains("mono")).toBe(true);
    expect(screen.getByRole("link", { name: "← Back to tokens" }).getAttribute("href")).toBe("/xahau/tokens");
    expect(screen.getByRole("link", { name: "Open it on XRPL" }).getAttribute("href")).toBe(`/xrpl/mpt/${MPT_SAMPLE_ID}`);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("Xahau/Tokens/MPT");
  });

  it("says XRPL Testnet and Xahau Testnet in the sandbox, and leads to the same path", () => {
    mountPage(<NoMptPage data={xahau("testnet")} />, "routes/net.mpt.$id", { at: `/xahau/mpt/${MPT_SAMPLE_ID}`, network: { ...LAYOUT_XAHAU, kind: "testnet", name: "Xahau Testnet" }, features: FEATURES });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("MPT isn't enabled on Xahau Testnet");
    expect(screen.getByText("MPTs exist only on XRPL Testnet, so there is nothing at this issuance ID on Xahau Testnet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open it on XRPL Testnet" }).getAttribute("href")).toBe(`/xrpl/mpt/${MPT_SAMPLE_ID}`);
  });
});
