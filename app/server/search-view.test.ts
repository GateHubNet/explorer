import { describe, expect, it } from "vitest";

import { NO_FEATURES } from "../ui/features";
import { choicePage, ctidNotFoundPage, hashNotFoundPage, helpPage, objectMatchHref, otherNetworkPage, shownQuery } from "./search-view";

const HASH = "4BC50C9B0D8515D3EAAE1E74B29A95804346C491EE1A95BF25E4AAB854A6A651";
const ISSUER = "rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy";
const XAHAU = { id: "xahau", name: "Xahau" } as const;
const XRPL = { id: "xrpl", name: "XRPL" } as const;
/** The network a choice is made on, as the route gives it: its id, its switches and whether its ledger has delegation (what an object's row leads to depends on them). */
const NETWORK = { id: "xrpl", hasDelegation: true, features: { ...NO_FEATURES, ledgerObjects: true, delegation: true } } as const;

describe("shownQuery", () => {
  it("trims what was typed", () => {
    expect(shownQuery("  hello \n")).toBe("hello");
    expect(shownQuery("")).toBe("");
  });

  it("cuts a long input short, with an ellipsis", () => {
    expect(shownQuery("x".repeat(200))).toBe("x".repeat(200));
    expect(shownQuery("x".repeat(201))).toBe(`${"x".repeat(200)}…`);
  });
});

describe("the pages", () => {
  it("builds the choice from the hash and what was found", () => {
    expect(choicePage(HASH, { tx: { ledgerIndex: 5, type: "Payment" }, ledger: { index: 6, closeTime: 7 } }, NETWORK)).toEqual({
      kind: "choice",
      hash: HASH,
      tx: { ledgerIndex: 5, type: "Payment" },
      ledger: { index: 6, closeTime: 7 },
    });
  });

  it("builds the choice of a transaction, a ledger and an NFT, the NFT's row in the words of the network's tokens", () => {
    const tx = { ledgerIndex: 5, type: "Payment" };
    const ledger = { index: 6, closeTime: 7 };
    expect(choicePage(HASH, { tx, ledger, nft: { kind: "nftoken", issuer: ISSUER, taxon: 1, serial: 4127, burned: false } }, NETWORK)).toEqual({
      kind: "choice",
      hash: HASH,
      tx,
      ledger,
      nft: { token: "NFT", detail: "#4,127 of rLxc1b…rwMy · taxon 1", burned: false },
    });
  });

  it("builds the choice of two of them, whichever two: the rows that were not found are not there", () => {
    const tx = { ledgerIndex: 5, type: "Payment" };
    const ledger = { index: 6, closeTime: 7 };
    const nft = { kind: "nftoken", issuer: ISSUER, taxon: 0, serial: 1, burned: false } as const;

    const withTx = choicePage(HASH, { tx, nft }, NETWORK);
    expect(withTx).toEqual({ kind: "choice", hash: HASH, tx, nft: { token: "NFT", detail: "#1 of rLxc1b…rwMy · taxon 0", burned: false } });
    expect(withTx).not.toHaveProperty("ledger");

    const withLedger = choicePage(HASH, { ledger, nft }, NETWORK);
    expect(withLedger).toEqual({ kind: "choice", hash: HASH, ledger, nft: { token: "NFT", detail: "#1 of rLxc1b…rwMy · taxon 0", burned: false } });
    expect(withLedger).not.toHaveProperty("tx");

    // Without an NFT it is what it was: the transaction and the ledger, and no `nft` key.
    expect(choicePage(HASH, { tx, ledger }, NETWORK)).not.toHaveProperty("nft");
  });

  it("says 'burned' of a burned NFT, and names a URIToken by its issuer alone: it has no serial and no taxon", () => {
    const tx = { ledgerIndex: 5, type: "URITokenMint" };
    expect(choicePage(HASH, { tx, nft: { kind: "nftoken", issuer: ISSUER, taxon: 4294967295, serial: 1234567, burned: true } }, NETWORK)).toMatchObject({
      nft: { token: "NFT", detail: "#1,234,567 of rLxc1b…rwMy · taxon 4,294,967,295", burned: true },
    });
    expect(choicePage(HASH, { tx, nft: { kind: "uritoken", issuer: ISSUER, burned: false } }, NETWORK)).toMatchObject({
      nft: { token: "URIToken", detail: "of rLxc1b…rwMy", burned: false },
    });
    expect(choicePage(HASH, { tx, nft: { kind: "uritoken", issuer: ISSUER, burned: true } }, NETWORK)).toMatchObject({ nft: { token: "URIToken", burned: true } });
  });

  it("names an NFT without a serial or a taxon by its issuer alone", () => {
    expect(choicePage(HASH, { tx: { ledgerIndex: 5, type: "Payment" }, nft: { kind: "nftoken", issuer: ISSUER, burned: false } }, NETWORK)).toMatchObject({
      nft: { token: "NFT", detail: "of rLxc1b…rwMy" },
    });
  });

  it("builds the choice of a transaction and an object, the object's row with the owner short, where it leads and whether it was removed", () => {
    const tx = { ledgerIndex: 5, type: "Payment" };
    expect(choicePage(HASH, { tx, object: { type: "Escrow", account: ISSUER, deleted: false } }, NETWORK)).toEqual({
      kind: "choice",
      hash: HASH,
      tx,
      object: { noun: "escrow", detail: "of rLxc1b…rwMy", href: `/xrpl/escrows/${HASH}`, removed: false },
    });
    expect(choicePage(HASH, { tx, object: { type: "Check", account: ISSUER, deleted: true } }, NETWORK)).toMatchObject({
      object: { noun: "check", href: `/xrpl/checks/${HASH}`, removed: true },
    });
    expect(choicePage(HASH, { tx, object: { type: "PayChannel", account: ISSUER, deleted: false } }, NETWORK)).toMatchObject({
      object: { noun: "payment channel", href: `/xrpl/payment-channels/${HASH}`, removed: false },
    });
  });

  it("names a delegation by its delegator, and leads to the Delegation tab while it is in the ledger, to the account page once removed (E10Δ3)", () => {
    const tx = { ledgerIndex: 5, type: "DelegateSet" };
    expect(choicePage(HASH, { tx, object: { type: "Delegate", account: ISSUER, deleted: false } }, NETWORK)).toMatchObject({
      object: { noun: "delegation", detail: "of rLxc1b…rwMy", href: `/xrpl/account/${ISSUER}?tab=delegation`, removed: false },
    });
    expect(choicePage(HASH, { tx, object: { type: "Delegate", account: ISSUER, deleted: true } }, NETWORK)).toMatchObject({
      object: { noun: "delegation", detail: "of rLxc1b…rwMy", href: `/xrpl/account/${ISSUER}`, removed: true },
    });
  });

  it("leads the row of a delegation of a network without delegation to the account page, and still says what it is", () => {
    const xahau = { id: "xahau", hasDelegation: false, features: NETWORK.features } as const;
    expect(choicePage(HASH, { tx: { ledgerIndex: 5, type: "DelegateSet" }, object: { type: "Delegate", account: ISSUER, deleted: false } }, xahau)).toMatchObject({
      object: { noun: "delegation", detail: "of rLxc1b…rwMy", href: `/xahau/account/${ISSUER}`, removed: false },
    });
  });

  it("builds the choice of an NFT and an object: both rows, the NFT's before the object's", () => {
    const page = choicePage(HASH, { nft: { kind: "nftoken", issuer: ISSUER, taxon: 0, serial: 1, burned: false }, object: { type: "Escrow", account: ISSUER, deleted: false } }, NETWORK);
    expect(Object.keys(page)).toEqual(["kind", "hash", "nft", "object"]);
  });

  it("builds the help from what was typed", () => {
    expect(helpPage("hello")).toEqual({ kind: "help", query: "hello" });
  });

  it("carries the link to the tokens when it is given, and has no key for it when it is not (E11 spec 5.3)", () => {
    const tokens = { href: "/xrpl/tokens?q=RLUSD", label: "Look for “RLUSD” among tokens →" };
    expect(helpPage("RLUSD", tokens)).toEqual({ kind: "help", query: "RLUSD", tokens });
    expect(helpPage("RLUSD", undefined)).not.toHaveProperty("tokens");
    expect(helpPage("RLUSD")).not.toHaveProperty("tokens");
  });

  it("builds the offer of a CTID of the other network", () => {
    expect(otherNetworkPage("c10ac4a1000c5359", "C10AC4A1000C5359", XAHAU)).toEqual({
      kind: "other-network",
      query: "c10ac4a1000c5359",
      ctid: "C10AC4A1000C5359",
      other: XAHAU,
    });
  });

  it("offers the same hash on the other network when a hash is not found, in upper case whatever was typed", () => {
    expect(hashNotFoundPage(HASH.toLowerCase(), HASH, XAHAU, { net: "xrpl", nfts: false, ledgerObjects: false })).toEqual({
      kind: "not-found",
      query: HASH.toLowerCase(),
      what: "transaction or ledger 4BC50C…A651",
      suggestion: { href: `/xahau/search?q=${HASH}`, label: "Search on Xahau" },
    });
    expect(hashNotFoundPage(HASH, HASH, XRPL, { net: "xahau", nfts: false, ledgerObjects: false })).toMatchObject({
      suggestion: { href: `/xrpl/search?q=${HASH}`, label: "Search on XRPL" },
    });
  });

  it("says what was looked for as the search asked it: with NFTS on an NFT too, a URIToken on Xahau", () => {
    expect(hashNotFoundPage(HASH, HASH, XAHAU, { net: "xrpl", nfts: true, ledgerObjects: false })).toMatchObject({ what: "transaction, ledger or NFT 4BC50C…A651" });
    expect(hashNotFoundPage(HASH, HASH, XRPL, { net: "xahau", nfts: true, ledgerObjects: false })).toMatchObject({ what: "transaction, ledger or URIToken 4BC50C…A651" });
  });

  it("does not offer the other network for a CTID, which says which network it is from", () => {
    const missing = ctidNotFoundPage("C10AC4A1000C5359", "C10AC4A1000C5359", 21337, true);
    expect(missing).toEqual({ kind: "not-found", query: "C10AC4A1000C5359", what: "transaction C10AC4A1000C5359" });
    expect(missing).not.toHaveProperty("suggestion");

    const unknown = ctidNotFoundPage("C000000100000001", "C000000100000001", 1, false);
    expect(unknown).toEqual({
      kind: "not-found",
      query: "C000000100000001",
      message: "C000000100000001 is for network id 1, which this explorer does not cover.",
    });
    expect(unknown).not.toHaveProperty("suggestion");
  });
});

describe("objectMatchHref: where a search that found an object leads", () => {
  const ESCROW = { type: "Escrow", account: ISSUER, deleted: false } as const;
  const DELEGATE = { ...ESCROW, type: "Delegate" } as const;
  const on = { ...NO_FEATURES, ledgerObjects: true, delegation: true };
  /** XRPL, which has delegation, with the switches `features` says. */
  const xrpl = (features = on) => ({ id: "xrpl", hasDelegation: true, features }) as const;
  /** Xahau, whose ledger has none. */
  const xahau = (features = on) => ({ id: "xahau", hasDelegation: false, features }) as const;

  it.each([
    ["an escrow", { ...ESCROW }, `/xrpl/escrows/${HASH}`],
    ["a check", { ...ESCROW, type: "Check" }, `/xrpl/checks/${HASH}`],
    ["a payment channel", { ...ESCROW, type: "PayChannel" }, `/xrpl/payment-channels/${HASH}`],
    // An object that was deleted still has its page: it says so.
    ["a removed escrow", { ...ESCROW, deleted: true }, `/xrpl/escrows/${HASH}`],
    ["a removed check", { ...ESCROW, type: "Check", deleted: true }, `/xrpl/checks/${HASH}`],
    ["a removed payment channel", { ...ESCROW, type: "PayChannel", deleted: true }, `/xrpl/payment-channels/${HASH}`],
  ] as const)("leads %s to its page", (_what, object, href) => {
    expect(objectMatchHref(xrpl(), HASH, object)).toBe(href);
  });

  it("leads a delegation to its delegator's Delegation tab while DELEGATION is on", () => {
    expect(objectMatchHref(xrpl(), HASH, DELEGATE)).toBe(`/xrpl/account/${ISSUER}?tab=delegation`);
  });

  it("leads a delegation to its delegator's account page while DELEGATION is off, with LEDGER_OBJECTS on (C23)", () => {
    expect(objectMatchHref(xrpl({ ...NO_FEATURES, ledgerObjects: true, delegation: false }), HASH, DELEGATE)).toBe(`/xrpl/account/${ISSUER}`);
  });

  it("leads a removed delegation to its delegator's account page, with DELEGATION on or off: the tab lists the delegations in the ledger now (E10Δ3)", () => {
    for (const delegation of [true, false]) {
      expect(objectMatchHref(xrpl({ ...NO_FEATURES, ledgerObjects: true, delegation }), HASH, { ...DELEGATE, deleted: true })).toBe(`/xrpl/account/${ISSUER}`);
    }
  });

  it("leads a delegation of a network without delegation to the account page, with DELEGATION on: the account route would send the tab there (Network.hasDelegation)", () => {
    expect(objectMatchHref(xahau(), HASH, DELEGATE)).toBe(`/xahau/account/${ISSUER}`);
    expect(objectMatchHref(xahau(), HASH, { ...DELEGATE, deleted: true })).toBe(`/xahau/account/${ISSUER}`);
  });

  it("keeps the network, and the hash as it is given", () => {
    expect(objectMatchHref(xahau(), HASH, ESCROW)).toBe(`/xahau/escrows/${HASH}`);
    expect(objectMatchHref(xrpl(), HASH, ESCROW)).toBe(`/xrpl/escrows/${HASH}`);
  });
});
