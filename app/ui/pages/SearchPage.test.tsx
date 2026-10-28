import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { NFTS_ON, renderUnderNetwork } from "../../../test/support/under-network";
import type { SearchPageData } from "../../server/search-view";
import { SearchPage } from "./SearchPage";

const XRPL = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX" } as const;
const XAHAU = { id: "xahau", kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX" } as const;
const HASH = "4BC50C9B0D8515D3EAAE1E74B29A95804346C491EE1A95BF25E4AAB854A6A651";
const CTID = "C10AC4A1000C5359";

afterEach(cleanup);

function renderPage(network: typeof XRPL | typeof XAHAU, data: SearchPageData) {
  const element: ReactElement = <SearchPage network={network} data={data} />;
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries: [`/${network.id}/search`] });
  return render(<RouterProvider router={router} />);
}

const linkTo = (href: string) => screen.getAllByRole("link").find((a) => a.getAttribute("href") === href);

describe("the choice between a transaction and a ledger", () => {
  const choice: SearchPageData = {
    kind: "choice",
    hash: HASH,
    tx: { ledgerIndex: 107695660, type: "OfferCreate" },
    ledger: { index: 107695661, closeTime: 1792256472 },
  };

  it("links to the transaction and to the ledger, and says what each is", () => {
    renderPage(XRPL, choice);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Transaction or ledger?");

    const matches = within(screen.getByRole("list", { name: "Matches" }));
    const [tx, ledger] = matches.getAllByRole("link");
    expect(tx!.getAttribute("href")).toBe(`/xrpl/tx/${HASH}`);
    expect(tx!.textContent).toBe("TransactionOfferCreate in ledger #107,695,660");
    expect(ledger!.getAttribute("href")).toBe(`/xrpl/ledger/${HASH}`);
    expect(ledger!.textContent).toBe("Ledger#107,695,661, closed 2026-10-17 17:01:12 UTC");
  });

  it("shows the whole hash and names the network", () => {
    renderPage(XAHAU, choice);
    expect(screen.getByText(HASH)).toBeTruthy();
    expect(screen.getByText(/both a transaction and a ledger on Xahau/)).toBeTruthy();
    expect(linkTo(`/xahau/tx/${HASH}`)).toBeTruthy();
    expect(linkTo(`/xahau/ledger/${HASH}`)).toBeTruthy();
  });
});

describe("the choice with an NFT", () => {
  const tx = { ledgerIndex: 107695660, type: "OfferCreate" };
  const ledger = { index: 107695661, closeTime: 1792256472 };
  const nft = { token: "NFT", detail: "#4,127 of rLxc1b…rwMy · taxon 1", burned: false };
  const rowsOf = () => within(screen.getByRole("list", { name: "Matches" })).getAllByRole("link");

  it("is a row for the NFT that leads to its page, beside the transaction's", () => {
    renderPage(XRPL, { kind: "choice", hash: HASH, tx, nft });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Transaction or NFT?");
    expect(screen.getByText(/both a transaction and an NFT on XRPL/)).toBeTruthy();

    const [txRow, nftRow] = rowsOf();
    expect(txRow!.getAttribute("href")).toBe(`/xrpl/tx/${HASH}`);
    expect(nftRow!.getAttribute("href")).toBe(`/xrpl/nft/${HASH}`);
    expect(nftRow!.textContent).toBe("NFT#4,127 of rLxc1b…rwMy · taxon 1");
    expect(linkTo(`/xrpl/ledger/${HASH}`)).toBeUndefined();
  });

  it("is three rows when the hash is a transaction, a ledger and an NFT, in that order", () => {
    renderPage(XRPL, { kind: "choice", hash: HASH, tx, ledger, nft });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Transaction, ledger or NFT?");
    expect(screen.getByText(/This hash is a transaction, a ledger and an NFT on XRPL\. Which one do you want\?/)).toBeTruthy();
    expect(rowsOf().map((row) => row.getAttribute("href"))).toEqual([`/xrpl/tx/${HASH}`, `/xrpl/ledger/${HASH}`, `/xrpl/nft/${HASH}`]);
  });

  it("is a ledger and an NFT, with the ledger's own words", () => {
    renderPage(XRPL, { kind: "choice", hash: HASH, ledger, nft });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Ledger or NFT?");
    expect(rowsOf().map((row) => row.getAttribute("href"))).toEqual([`/xrpl/ledger/${HASH}`, `/xrpl/nft/${HASH}`]);
  });

  it("tags a burned NFT with the word 'burned' in the row, not as a colour", () => {
    renderPage(XRPL, { kind: "choice", hash: HASH, tx, nft: { ...nft, burned: true } });
    const row = rowsOf()[1]!;
    expect(row.textContent).toBe("NFT#4,127 of rLxc1b…rwMy · taxon 1burned");
    expect(within(row).getByText("burned").className).toBe("tag");
    expect(rowsOf()[0]!.textContent).not.toContain("burned");
  });

  it("calls a Xahau token a URIToken, in the heading, the sentence and the row", () => {
    renderPage(XAHAU, { kind: "choice", hash: HASH, tx, nft: { token: "URIToken", detail: "of rodinG…zKyb", burned: false } });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Transaction or URIToken?");
    expect(screen.getByText(/both a transaction and a URIToken on Xahau/)).toBeTruthy();
    expect(rowsOf()[1]!.getAttribute("href")).toBe(`/xahau/nft/${HASH}`);
    expect(rowsOf()[1]!.textContent).toBe("URITokenof rodinG…zKyb");
  });
});

describe("the help text", () => {
  it("lists what can be searched for and keeps what was typed in the box", () => {
    renderPage(XRPL, { kind: "help", query: "hello" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No match");
    expect(screen.getByText("Nothing on XRPL looks like “hello”.")).toBeTruthy();

    const items = within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "An account address, starting with r, or an X-address",
      "A transaction or ledger hash: 64 hexadecimal characters",
      "A ledger index, such as 107695660",
      "A CTID: C followed by 15 hexadecimal characters",
    ]);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("hello");
  });

  it("adds the NFT id with NFTS on, after the hash, and only then", () => {
    renderUnderNetwork(<SearchPage network={XRPL} data={{ kind: "help", query: "hello" }} />, NFTS_ON, { path: "/xrpl/search", hydrated: true });
    const items = within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "An account address, starting with r, or an X-address",
      "A transaction or ledger hash: 64 hexadecimal characters",
      "An NFT or URIToken id: 64 hexadecimal characters",
      "A ledger index, such as 107695660",
      "A CTID: C followed by 15 hexadecimal characters",
    ]);
  });

  it("is a prompt, not a complaint, when nothing was typed", () => {
    renderPage(XAHAU, { kind: "help", query: "" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Search Xahau");
    expect(screen.queryByText(/looks like/)).toBeNull();
    expect(screen.getByText("Enter an address, a transaction or ledger hash, a ledger index or a CTID.")).toBeTruthy();
    expect(screen.getByRole("list")).toBeTruthy();
  });

  it("names what a hash can be as the search asks it with NFTS on: a transaction, a ledger or an NFT (a URIToken on Xahau)", () => {
    renderUnderNetwork(<SearchPage network={XRPL} data={{ kind: "help", query: "" }} />, NFTS_ON, { path: "/xrpl/search", hydrated: true });
    expect(screen.getByText("Enter an address, a transaction, ledger or NFT hash, a ledger index or a CTID.")).toBeTruthy();
    cleanup();
    renderUnderNetwork(<SearchPage network={XAHAU} data={{ kind: "help", query: "" }} />, NFTS_ON, { network: { id: "xahau", name: "Xahau" }, path: "/xahau/search", hydrated: true });
    expect(screen.getByText("Enter an address, a transaction, ledger or URIToken hash, a ledger index or a CTID.")).toBeTruthy();
  });
});

describe("a CTID of the other network", () => {
  it("offers the transaction there", () => {
    renderPage(XRPL, { kind: "other-network", query: CTID, ctid: CTID, other: XAHAU });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("That CTID is on Xahau");
    expect(screen.getByText(`${CTID} belongs to Xahau, so it is not a transaction on XRPL.`)).toBeTruthy();
    expect(linkTo(`/xahau/tx/${CTID}`)?.textContent).toBe("Open the transaction on Xahau");
    expect(linkTo("/xrpl")?.textContent).toBe("Go to the XRPL home");
  });
});

describe("a 404", () => {
  it("says what was not found, keeps the typed text in the box and offers the other network", () => {
    renderPage(XRPL, {
      kind: "not-found",
      query: HASH,
      what: "transaction or ledger 4BC50C…A651",
      suggestion: { href: `/xahau/search?q=${HASH}`, label: "Search on Xahau" },
    });
    expect(screen.getByText("We couldn’t find transaction or ledger 4BC50C…A651 on XRPL.")).toBeTruthy();
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(HASH);
    expect(linkTo(`/xahau/search?q=${HASH}`)?.textContent).toBe("Search on Xahau");
  });

  it("shows its own message instead, and offers nothing when it has no suggestion", () => {
    renderPage(XAHAU, { kind: "not-found", query: CTID, message: `${CTID} is for network id 1, which this explorer does not cover.` });
    expect(screen.getByText(`${CTID} is for network id 1, which this explorer does not cover.`)).toBeTruthy();
    expect(screen.queryByText(/Search on/)).toBeNull();
    expect(linkTo("/xahau")?.textContent).toBe("Go to the Xahau home");
  });
});
