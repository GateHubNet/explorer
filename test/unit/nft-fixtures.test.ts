import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import BigNumber from "bignumber.js";
import { decodeAccountID, isValidClassicAddress } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

// http-fixtures.ts first: the generators it joins (nft-fixtures.ts among them) import it in turn.
import { HTTP, isHandWritten, isNftGenerated, isoTime, LEDGERS, readLedgerSet, unixOf, type RawLedger, type RawTx } from "../../scripts/http-fixtures";
import { deriveNfts, parseNftTransaction, type DerivedNft } from "../../scripts/nft-derive";
import { featureCoverage, itemCoverage, listNft, nftAnswers, nftFixtures, nftWorld, NFT_ACCOUNTS, NFT_CASE_TXS, NFT_SETS, OWN_EVENTS, uriTokenId } from "../../scripts/nft-fixtures";
import { decodeNftId } from "../../app/domain/nft-id";
import { windowOf } from "../../app/domain/window";
import type { Nft, NftEvent, NftEventKind } from "../../app/server/api-types";
import { checkCollection, checkCollectionDays, checkCollectionsPage, checkHoldersPage, checkNft, checkNftEventsPage, checkNftOffersPage, checkNftSalesPage, checkNftsPage, checkNftVolume } from "../../app/server/nft-shape";
import { encodeNftId, NFT_CASES, resolveCollectionCase, resolveHolder, resolveNftCase, type NftCase, type NftSources, type NodeNft } from "../support/nft-case-rules";
import { createUpstream, dataApiFile, nodeFile, type NetworkName } from "../support/upstream-core";

// What the NFT fixtures promise the tests that use them: the data API's answers (D3, data-api-new `feat/explorer-data-2` at PIN da5ce14) that scripts/nft-fixtures.ts writes
// (`pnpm fixtures:sync`), worked out by scripts/nft-derive.ts, a port of D3's parser, fold and open offers, from the NFT ledgers D3 recorded (`ledgers/xrpl-nft/`,
// `ledgers/xahau-nft/`), and the nodes' answers for the NFTs the index lacks (test/fixtures/PROVENANCE.md, "NFT answers"). The expected events of the recorded cases are D3's
// own (packages/shared/src/parsers/nft.parser.spec.ts at PIN), written down here from the transactions, apart from the port.

const NETS: NetworkName[] = ["xrpl", "xahau"];
type Json = Record<string, any>;

// ---- The recordings ------------------------------------------------------------------------------------------------------------

const ledgers: Record<NetworkName, RawLedger[]> = { xrpl: readLedgerSet(NFT_SETS.xrpl), xahau: readLedgerSet(NFT_SETS.xahau) };
const manifests = Object.fromEntries(
  NETS.map((net) => [net, JSON.parse(readFileSync(new URL(`${NFT_SETS[net]}/manifest.json`, LEDGERS), "utf8")) as { cases: Record<string, { ledger: number; hash: string; type: string; burn?: { ledger: number; hash: string } }> }]),
) as Record<NetworkName, { cases: Record<string, { ledger: number; hash: string; type: string; burn?: { ledger: number; hash: string } }> }>;
const txs = Object.fromEntries(NETS.map((net) => [net, new Map(ledgers[net].flatMap((raw) => raw.ledger.transactions.map((tx) => [tx.hash, { raw, tx }] as const)))])) as Record<
  NetworkName,
  Map<string, { raw: RawLedger; tx: RawTx }>
>;
const caseTx = (net: NetworkName, name: string): RawTx => txs[net].get(manifests[net].cases[name]!.hash)!.tx;

const derived = { xrpl: deriveNfts("xrpl", ledgers.xrpl), xahau: deriveNfts("xahau", ledgers.xahau) };
const worlds = { xrpl: nftWorld("xrpl"), xahau: nftWorld("xahau") };
const answers = nftAnswers();
const files = new Map(nftFixtures());
const parsed = (path: string): any => JSON.parse(files.get(path)!);

/** A recorded transaction with its metadata and fields changed by `edit` (the originals are not written to). */
function variant(tx: RawTx, edit: (tx: Json, meta: Json) => void): RawTx {
  const copy = structuredClone(tx) as RawTx;
  edit(copy, copy.metaData);
  return copy;
}
/** The body (`ModifiedNode`, … contents) of `AffectedNodes[index]`. */
const body = (meta: Json, index: number): Json => {
  const wrapper = meta.AffectedNodes[index];
  return wrapper[Object.keys(wrapper)[0]!];
};

// ---- D3's expected events of the recorded cases -----------------------------------------------------------------------------------

interface Known {
  id: string;
  issuer: string;
  taxon?: number;
  serial?: number;
}
/** What an NFT's id decodes to, written down from the recorded transactions, not from the decoder (D3's `NFTS`). */
const NFTS = {
  mint: { id: "0019000040FEFE9E7C73D4F8A4DC7A7A09DD13B724827F945B2680E5061B0D4A", issuer: "ravC5cZreMZuKEWSrpra5nkWnfzPmrabec", taxon: 0, serial: 102436170 },
  mintWithOffer: { id: "00181F40AF09C1D4B4D1E8031467F3508DFFADABEA73255FBE9F0F960655EBFA", issuer: "rGxWAWXg8okZh29ojBRvEMpN5peQRV16Xu", taxon: 3, serial: 106294266 },
  mintOnBehalf: { id: "001861A86D2DF313DD3688E9B156F47B99A8C80F4692DF244CEB911005FC3176", issuer: "rwxH6YD51ygruAtDWixsgH5UUu6hmUi3AC", taxon: 1, serial: 100413814 },
  burn: { id: "0019000040FEFE9E7C73D4F8A4DC7A7A09DD13B724827F9442666327061B0D8C", issuer: "ravC5cZreMZuKEWSrpra5nkWnfzPmrabec", taxon: 0, serial: 102436236 },
  burnRemovesOffers: { id: "00081388CFF1C6E01236757983B2F73D2A57B94FB165D29473F38DB90663D71D", issuer: "rKxWWCEDrwTWn9A8QxgKDW4VhwuCcd8W7f", taxon: 1, serial: 107206429 },
  modify: { id: "00191F4072D67B49A7ED6E16B05851CF77CDC8475B5FD73836412B5105A01DC4", issuer: "rB7UyKs9SwS4pX87tqtMjq4XRiEhkBfmuH", taxon: 14, serial: 94379460 },
  sellOffer: { id: "000813886E50B2960CF48DCB644E85B412C660B4E1B01A87C283F9E6066AB54B", issuer: "rBhJrnrN8Q6FQyDwg6ZrtoBa2QCicCEzug", taxon: 0, serial: 107656523 },
  buyOffer: { id: "0008138882D0F98C64A1A0E6D15053589771AD08B8C13D53A655402C00000492", issuer: "rUv6Bmw6GRQHgJaiVcXnnNFCeTMKUE6FCa", taxon: 1, serial: 1170 },
  cancelled: { id: "001813881F9C83FE46F4EEC59D5E8C0B017F1791F856B88214F8C43106111595", issuer: "rst9Sq8mVxK8b7BbgFs4VmnVtfm7N2qN4j", taxon: 1, serial: 101782933 },
  soldBySellOffer: { id: "00081388EA968E3C54EE59C8FFBAF0944A3B8AD4797AB032EF22952605AD2A91", issuer: "r4PP7gwuVfxzLPWFiJXjLUtvzA7F97CzT3", taxon: 10, serial: 95234705 },
  soldByBuyOffer: { id: "000803E88ACAA32313BB87F729EF7DA56BD13C57BE46E3C8B0730F290481ED98", issuer: "rDeizxSRo6JHjKnih9ivpPkyD2EgXQvhSB", taxon: 26, serial: 75623832 },
  brokered: { id: "00190BB8DAEF366CB05EE8DCC919EF9A1AA24DD22B3D62C9D848920A0669E96F", issuer: "rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy", taxon: 0, serial: 107604335 },
  soldForIssued: { id: "00081388048ECA9BA1C412A6BFFEEA29E21873E92DE6B3F3EA90AAA805041E13", issuer: "rRamaNFTdhr1q7gjsDK1Q4baffxHUQfQ9", taxon: 6, serial: 84155923 },
  transferred: { id: "0018C350C7DEC772B41E9496AA92D148C4FD64D239AA62985D24F44D05B7F6B4", issuer: "rKDFM3xaC3B7ijWkX4iHcMTcLFgxW2dK74", taxon: 2, serial: 95942324 },
  splitMint: { id: "00181F40AF09C1D4B4D1E8031467F3508DFFADABEA73255F79ED9C910655EBF7", issuer: "rGxWAWXg8okZh29ojBRvEMpN5peQRV16Xu", taxon: 3, serial: 106294263 },
} satisfies Record<string, Known>;

const RODIN = "rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb";
const SELLER = "r9gvUQxtV98nRAM26aknj4h6RXKyXCLMVS";
const BROKER = "rpx9JThQ2y37FaGeeJP7PXDUVEXY3PHZSC";
const XRPLAY = { currency: "5852506C61790000000000000000000000000000", issuer: "rfUefeHzBZQGEs66znmX9rV6S9viGbxv9v" };
const EVR = { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" };
const URI_TOKENS = {
  minted: { id: "E87FD7E7FDACFA2CE1DC37AD805A7295F84459D4911EAC79160F0D9E34BB6520", issuer: "rPSpGgNCgSzfvyW1PveBL62Ph5VZFcQt6E" },
  listed: { id: "35B8D52858E0463C0F0FCCC73EFBE1D308F0AF71112035C4D45777EB9115E93D", issuer: RODIN },
  cancelled: { id: "335AD14EDA481A2B0BB89F792EF6D137A48010DF29D4F90B8BD9B18DF6994FC8", issuer: RODIN },
  bought: { id: "9613336614047483F3AEC00173139D88FE9BA70720CAC2B46E12711A71A9AAE9", issuer: RODIN },
  boughtForEvr: { id: "494E26BE7766A7DB12912C51055C0106DA39401BF2E60E86611FD00E48CDE99F", issuer: "rNk6oeGA4BKsCraCEMg2g5YkbegcXFtPGV" },
  burned: { id: "F636CA189EF358200F80EE78744EB5876224B2F0A8F3DC97BC36A325DA4D3C46", issuer: "r4gUH2cjAfXGFTBUXBnspYWpj4nprzgQgH" },
  burnedByIssuer: { id: "AB9EB74AAAF6437F3E368A312E3432D8D7BF548A997D1378186FB371178E40DF", issuer: "rKXEKqg6V3rtiZZiJ97zHkm9Due5xrtRhW" },
  remitted: { id: "D615854CB2571F4F2EB1F0B23944996187519BCC5CA4CB700C692917A76200A9", issuer: RODIN },
  remitMinted: { id: "099E410166351A8C94AE6D76154CBF301C609282EAE659C1BF08AF46936867BF", issuer: RODIN },
  reminted: { id: "E5ECD96D609E8E7C29C967D3D2FA542AE58FC9A05B9C4EAE7BFF608A7D0306A2", issuer: "r4k1jdyThSDbPwbNrpiuqNCoRJ61y9N4Wj" },
} satisfies Record<string, Known>;

/** One event the transaction of a case must give: the NFT, its place in the transaction, and the keys beyond the NFT's own that it has. `uri: "tx"` is the transaction's own URI. */
type Expected = [nft: Known, index: number, event: NftEventKind, fields: Partial<NftEvent> & { uri?: string }];
const TX_URI = "tx";
const unix = (value: number): string => isoTime(value);

const XRPL_CASES: Record<string, Expected[]> = {
  mint: [[NFTS.mint, 0, "mint", { account: "ravC5cZreMZuKEWSrpra5nkWnfzPmrabec", to: "ravC5cZreMZuKEWSrpra5nkWnfzPmrabec", uri: TX_URI }]],
  // The created node has no Amount (a zero native amount is not stored): the transaction's "0" is the amount.
  mint_with_offer: [
    [NFTS.mintWithOffer, 0, "mint", { account: "rKqqb5QZXVAL3VqXJL6obfRGeHou1DtyBV", to: "rKqqb5QZXVAL3VqXJL6obfRGeHou1DtyBV", uri: TX_URI }],
    [
      NFTS.mintWithOffer,
      1,
      "offer_create",
      {
        account: "rKqqb5QZXVAL3VqXJL6obfRGeHou1DtyBV",
        offer_id: "7175449248947D620AD9BABE1396971F1185DF6C2DEE282A588AF3A06BD6CFDC",
        is_sell_offer: true,
        amount: "0",
        currency: "XRP",
        destination: "rfin4yze7ZEygheDjknACfNFHYCLG43W7R",
        expiration: unix(1794113527),
      },
    ],
  ],
  mint_on_behalf: [[NFTS.mintOnBehalf, 0, "mint", { account: "riMCiWg8QBej6Y3osDVt3u8FJWo2ephuN", to: "riMCiWg8QBej6Y3osDVt3u8FJWo2ephuN", uri: TX_URI }]],
  burn: [[NFTS.burn, 0, "burn", { account: "ravC5cZreMZuKEWSrpra5nkWnfzPmrabec", from: "ravC5cZreMZuKEWSrpra5nkWnfzPmrabec" }]],
  burn_removes_offers: [
    [
      NFTS.burnRemovesOffers,
      0,
      "offer_removed",
      {
        account: "rKxWWCEDrwTWn9A8QxgKDW4VhwuCcd8W7f",
        offer_id: "C2EC7B13B82DDD2DB3E226B1812D953EE6EF6619EB04B712CD5554740289DB0E",
        is_sell_offer: true,
        amount: "4",
        currency: "XRP",
        destination: BROKER,
        removed_by: "burn",
      },
    ],
    [NFTS.burnRemovesOffers, 1, "burn", { account: "rKxWWCEDrwTWn9A8QxgKDW4VhwuCcd8W7f", from: "rKxWWCEDrwTWn9A8QxgKDW4VhwuCcd8W7f" }],
  ],
  modify: [[NFTS.modify, 0, "modify", { account: "rB7UyKs9SwS4pX87tqtMjq4XRiEhkBfmuH", uri: TX_URI }]],
  sell_offer_create: [
    [
      NFTS.sellOffer,
      0,
      "offer_create",
      { account: "rHhvUexKKSJZG9vuZKX2kNendG2TXoavG9", offer_id: "D6697EB570D95FBE80C369A2CCD9CF21CE04258B04829638313820058FE8CAEE", is_sell_offer: true, amount: "19.98", currency: "XRP", destination: BROKER },
    ],
  ],
  buy_offer_create: [
    [
      NFTS.buyOffer,
      0,
      "offer_create",
      {
        account: "rB1q8i6QaAJgSQdvbxGsP4pxsUv6QeTEWm",
        offer_id: "00FF9CF6539F6D9D0EB5B7FE487E0FA9B19AD7124B2B6D64D4F48E7CCFBAF972",
        is_sell_offer: false,
        amount: "8.11",
        currency: "XRP",
        destination: BROKER,
        expiration: unix(1792990326),
      },
    ],
  ],
  offer_cancel: [
    [
      NFTS.cancelled,
      0,
      "offer_cancel",
      {
        account: "rf7Db55CXcWgqmHnb1Pjx1WVGNCqMNsyZ",
        offer_id: "C094C217BD0396C55630195FA2C8677CF0D3961C8950BC50D827C036B532A9CF",
        is_sell_offer: false,
        amount: "146.25",
        currency: "XRP",
        destination: BROKER,
        expiration: unix(1793496181),
      },
    ],
  ],
  sale_by_sell_offer: [
    [
      NFTS.soldBySellOffer,
      0,
      "offer_removed",
      {
        account: "rhv9jFwfWfH4Cd1uX4b3ACkdgDKASFz7Dz",
        offer_id: "D6DBB6452D44459FDA013C79708D2E699EA2340D5444AC1695FF621A80FDFBDE",
        is_sell_offer: true,
        amount: "10",
        currency: "XRP",
        destination: "rnKd8CYrXwMoGn4R48onJGLShh1PcrFrTx",
        expiration: unix(1792858961),
        removed_by: "sale",
      },
    ],
    [
      NFTS.soldBySellOffer,
      1,
      "sale",
      {
        account: "rnKd8CYrXwMoGn4R48onJGLShh1PcrFrTx",
        from: "rhv9jFwfWfH4Cd1uX4b3ACkdgDKASFz7Dz",
        to: "rnKd8CYrXwMoGn4R48onJGLShh1PcrFrTx",
        offer_id: "D6DBB6452D44459FDA013C79708D2E699EA2340D5444AC1695FF621A80FDFBDE",
        is_sell_offer: true,
        amount: "10",
        currency: "XRP",
        converted_amount: "10",
        royalty_est: "0.5",
      },
    ],
  ],
  sale_by_buy_offer: [
    [
      NFTS.soldByBuyOffer,
      0,
      "offer_removed",
      {
        account: "r47kUrvGHkHgxLi1KedaHzdUvbR9GTreEe",
        offer_id: "0ABE2264B31E8A9C7D483866EE1CCE4621E861F7D8A07F06E8B019F51CC54617",
        is_sell_offer: false,
        amount: "0.000001",
        currency: "XRP",
        removed_by: "sale",
      },
    ],
    [
      NFTS.soldByBuyOffer,
      1,
      "sale",
      {
        account: "rDeizxSRo6JHjKnih9ivpPkyD2EgXQvhSB",
        from: "rDeizxSRo6JHjKnih9ivpPkyD2EgXQvhSB",
        to: "r47kUrvGHkHgxLi1KedaHzdUvbR9GTreEe",
        offer_id: "0ABE2264B31E8A9C7D483866EE1CCE4621E861F7D8A07F06E8B019F51CC54617",
        is_sell_offer: false,
        amount: "0.000001",
        currency: "XRP",
        converted_amount: "0.000001",
      },
    ],
  ],
  // FINDINGS 4: (150000000 - 2383500) x 3000 / 100000 = 4428495 drops, the rise of the issuer's balance; the sale names the sell offer (Ruling 14).
  brokered_sale_royalty: [
    [
      NFTS.brokered,
      0,
      "offer_removed",
      {
        account: "rfivr3BK17R28wnVwpQQhSDvo2A2fmnEje",
        offer_id: "05BC61CFB58ABA8969C852FBF907CC687A442AD3ED64FB30EA41149ECD0F6780",
        is_sell_offer: true,
        amount: "147.6165",
        currency: "XRP",
        destination: BROKER,
        removed_by: "sale",
      },
    ],
    [
      NFTS.brokered,
      1,
      "offer_removed",
      {
        account: "rLCscV9iDJpvje4ZCKxGjYAMNtBA1Ltauk",
        offer_id: "0DF63F5C3FCC30EE52E2622E64406E050A9F6A8537A4E74C6F1263ABDED88BBE",
        is_sell_offer: false,
        amount: "150",
        currency: "XRP",
        destination: BROKER,
        removed_by: "sale",
      },
    ],
    [
      NFTS.brokered,
      2,
      "sale",
      {
        account: BROKER,
        from: "rfivr3BK17R28wnVwpQQhSDvo2A2fmnEje",
        to: "rLCscV9iDJpvje4ZCKxGjYAMNtBA1Ltauk",
        offer_id: "05BC61CFB58ABA8969C852FBF907CC687A442AD3ED64FB30EA41149ECD0F6780",
        is_sell_offer: true,
        amount: "150",
        currency: "XRP",
        converted_amount: "150",
        broker: BROKER,
        broker_fee: "2.3835",
        royalty_est: "4.428495",
      },
    ],
  ],
  // A price in an issued currency has no rate on the recordings, so no converted amount; the issuer who sells gets no royalty.
  sale_issued_currency: [
    [
      NFTS.soldForIssued,
      0,
      "offer_removed",
      {
        account: "rRamaNFTdhr1q7gjsDK1Q4baffxHUQfQ9",
        offer_id: "58A18F1CF52EA11A65CFC2F1C168908C4AF315A08ECA5FA238A40A0D01A67CE8",
        is_sell_offer: true,
        amount: "100",
        currency: XRPLAY.currency,
        amount_issuer: XRPLAY.issuer,
        removed_by: "sale",
      },
    ],
    [
      NFTS.soldForIssued,
      1,
      "sale",
      {
        account: "rLTavNLNKhA1kf8KMfW5U4Q1TNGSUNdint",
        from: "rRamaNFTdhr1q7gjsDK1Q4baffxHUQfQ9",
        to: "rLTavNLNKhA1kf8KMfW5U4Q1TNGSUNdint",
        offer_id: "58A18F1CF52EA11A65CFC2F1C168908C4AF315A08ECA5FA238A40A0D01A67CE8",
        is_sell_offer: true,
        amount: "100",
        currency: XRPLAY.currency,
        amount_issuer: XRPLAY.issuer,
      },
    ],
  ],
  // The offer is removed by an NFTokenAcceptOffer, so the offer is removed `sale`; the NFT moves with no price: a transfer.
  transfer_zero_amount: [
    [
      NFTS.transferred,
      0,
      "offer_removed",
      {
        account: "riMCiWg8QBej6Y3osDVt3u8FJWo2ephuN",
        offer_id: "54BADD751BFBEA1B178D0E766506F9AA712AD1D453EDB165B1E8D78C4356FFE2",
        is_sell_offer: true,
        amount: "0",
        currency: "XRP",
        destination: "r4Xgqy68ykjLEJAkFQ7EaFs8VEdSiWkSeX",
        removed_by: "sale",
      },
    ],
    [
      NFTS.transferred,
      1,
      "transfer",
      {
        account: "r4Xgqy68ykjLEJAkFQ7EaFs8VEdSiWkSeX",
        from: "riMCiWg8QBej6Y3osDVt3u8FJWo2ephuN",
        to: "r4Xgqy68ykjLEJAkFQ7EaFs8VEdSiWkSeX",
        offer_id: "54BADD751BFBEA1B178D0E766506F9AA712AD1D453EDB165B1E8D78C4356FFE2",
        is_sell_offer: true,
      },
    ],
  ],
  page_split_with_mint: [
    [NFTS.splitMint, 0, "mint", { account: "rKqqb5QZXVAL3VqXJL6obfRGeHou1DtyBV", to: "rKqqb5QZXVAL3VqXJL6obfRGeHou1DtyBV", uri: TX_URI }],
    [
      NFTS.splitMint,
      1,
      "offer_create",
      {
        account: "rKqqb5QZXVAL3VqXJL6obfRGeHou1DtyBV",
        offer_id: "CC22C15F44B8B424D655E220EB6B431B8525B4CEED6EDCEF80C0FE90552DF12A",
        is_sell_offer: true,
        amount: "0",
        currency: "XRP",
        destination: "rfin4yze7ZEygheDjknACfNFHYCLG43W7R",
        expiration: unix(1794113527),
      },
    ],
  ],
};

/** The Xahau transactions of D3's spec that are not manifest cases: by hash, as D3's spec names them. */
const XAHAU_EXTRA = {
  evernodeBuy: { ledger: 26763618, hash: "30B0FE015F9CE2BACE93D95385CD8EA70AD68EB4B6380655C6352FBF1B5897D6", type: "URITokenBuy" },
  burnByIssuer: { ledger: 26763618, hash: "82BF1D1E762335802A0552A13414904B3350FA2CD1404D10A64763BF6B183BBA", type: "URITokenBurn" },
};

const XAHAU_CASES: Record<string, Expected[]> = {
  uritoken_mint: [[URI_TOKENS.minted, 0, "mint", { account: "rPSpGgNCgSzfvyW1PveBL62Ph5VZFcQt6E", to: "rPSpGgNCgSzfvyW1PveBL62Ph5VZFcQt6E", uri: TX_URI }]],
  uritoken_sell_offer_create: [[URI_TOKENS.listed, 0, "offer_create", { account: SELLER, offer_id: URI_TOKENS.listed.id, is_sell_offer: true, amount: "2200", currency: "XAH" }]],
  uritoken_sell_offer_cancel: [[URI_TOKENS.cancelled, 0, "offer_cancel", { account: SELLER, offer_id: URI_TOKENS.cancelled.id, is_sell_offer: true, amount: "1800", currency: "XAH" }]],
  // FINDINGS 2: the price is the transaction's Amount, which the seller received; it is the ask here (no buy above an ask was found).
  uritoken_buy_above_ask: [
    [URI_TOKENS.bought, 0, "offer_removed", { account: SELLER, offer_id: URI_TOKENS.bought.id, is_sell_offer: true, amount: "4200", currency: "XAH", removed_by: "sale" }],
    [
      URI_TOKENS.bought,
      1,
      "sale",
      {
        account: "rBkEp8W1yhBGLrvHFKKyrmSvniMFVJbPPg",
        from: SELLER,
        to: "rBkEp8W1yhBGLrvHFKKyrmSvniMFVJbPPg",
        offer_id: URI_TOKENS.bought.id,
        is_sell_offer: true,
        amount: "4200",
        currency: "XAH",
        converted_amount: "4200",
      },
    ],
  ],
  uritoken_burn_with_offer: [
    [URI_TOKENS.burned, 0, "offer_removed", { account: "r4gUH2cjAfXGFTBUXBnspYWpj4nprzgQgH", offer_id: URI_TOKENS.burned.id, is_sell_offer: true, amount: "0.0001", currency: EVR.currency, amount_issuer: EVR.issuer, removed_by: "burn" }],
    [URI_TOKENS.burned, 1, "burn", { account: "r4gUH2cjAfXGFTBUXBnspYWpj4nprzgQgH", from: "r4gUH2cjAfXGFTBUXBnspYWpj4nprzgQgH" }],
  ],
  // A Remit's payments are not the price of anything, and its Destination is the new owner.
  remit_transfer: [
    [URI_TOKENS.remitted, 0, "offer_removed", { account: SELLER, offer_id: URI_TOKENS.remitted.id, is_sell_offer: true, amount: "3350", currency: "XAH", removed_by: "transfer" }],
    [URI_TOKENS.remitted, 1, "transfer", { account: SELLER, from: SELLER, to: "rAucmWmE8yiueemhmrGh5MyD2mNjXfpQp" }],
  ],
  remit_mint: [[URI_TOKENS.remitMinted, 0, "mint", { account: RODIN, to: SELLER, uri: TX_URI }]],
  uritoken_remint: [[URI_TOKENS.reminted, 0, "mint", { account: "r4k1jdyThSDbPwbNrpiuqNCoRJ61y9N4Wj", to: "r4k1jdyThSDbPwbNrpiuqNCoRJ61y9N4Wj", uri: TX_URI }]],
};
/** The burn that the re-mint of `uritoken_remint` follows: one id, two lives. */
const XAHAU_REMINT_BURN: Expected[] = [[URI_TOKENS.reminted, 0, "burn", { account: "r4k1jdyThSDbPwbNrpiuqNCoRJ61y9N4Wj", from: "r4k1jdyThSDbPwbNrpiuqNCoRJ61y9N4Wj" }]];

/** Every event of `net`'s NFTs that transaction `hash` made, by its place in the transaction. */
function eventsOfTx(net: NetworkName, hash: string): NftEvent[] {
  return derived[net].flatMap((each) => each.events).filter((e) => e.tx_hash === hash).sort((a, b) => a.event_index - b.event_index);
}

/** The event the table promises: the NFT's own keys, the keys beyond them, and the columns the transaction gives apart (`tx`). */
function expectedEvent(net: NetworkName, [nft, index, event, fields]: Expected, tx: RawTx): Omit<NftEvent, "ledger_index" | "tx_index" | "tx_hash" | "tx_type" | "executed_time"> {
  return {
    nft_id: nft.id,
    kind: net === "xrpl" ? "nftoken" : "uritoken",
    issuer: nft.issuer,
    ...(nft.taxon !== undefined && { taxon: nft.taxon, serial: nft.serial }),
    event_index: index,
    event,
    ...fields,
    ...(fields.uri === TX_URI && { uri: (tx.URI ?? (tx.MintURIToken as Json | undefined)?.URI) as string }),
  };
}

function checkCase(net: NetworkName, hash: string, ledger: number, type: string, expected: Expected[]): void {
  const { raw, tx } = txs[net].get(hash)!;
  const actual = eventsOfTx(net, hash);
  expect(actual.map(({ ledger_index, tx_index, tx_hash, tx_type, executed_time, ...rest }) => rest)).toEqual(expected.map((each) => expectedEvent(net, each, tx)));
  for (const event of actual) {
    expect(event).toMatchObject({ ledger_index: ledger, tx_index: tx.metaData.TransactionIndex, tx_hash: hash, tx_type: type, executed_time: isoTime(unixOf(raw.ledger.close_time)) });
  }
}

describe.each(NETS)("%s: deriveNfts gives D3's events for every recorded case", (net) => {
  const cases = net === "xrpl" ? XRPL_CASES : XAHAU_CASES;
  const manifest = manifests[net].cases;

  it.each(Object.keys(cases))("%s", (name) => {
    const found = manifest[name];
    expect(found, `the manifest has the case ${name}`).toBeDefined();
    checkCase(net, found!.hash, found!.ledger, found!.type, cases[name]!);
  });

  if (net === "xahau") {
    it("uritoken_remint's burn: one id, two lives, with the mint after it", () => {
      const link = manifest.uritoken_remint!.burn!;
      checkCase(net, link.hash, link.ledger, "URITokenBurn", XAHAU_REMINT_BURN);
      expect(link.ledger).toBeLessThan(manifest.uritoken_remint!.ledger);
      const life = derived.xahau.find((each) => each.id === URI_TOKENS.reminted.id)!;
      expect(life.events.map((e) => e.event)).toEqual(["burn", "mint"]);
      expect(life.nft).toMatchObject({ burned: false, owner: "r4k1jdyThSDbPwbNrpiuqNCoRJ61y9N4Wj" });
      expect(life.nft).not.toHaveProperty("burned_at");
    });

    it("a buy in an issued currency (Evernode): the price is that amount, the seller the issuer, and no converted price", () => {
      const { hash, ledger, type } = XAHAU_EXTRA.evernodeBuy;
      const priced = { amount: "0.0011", currency: EVR.currency, amount_issuer: EVR.issuer };
      checkCase(net, hash, ledger, type, [
        [URI_TOKENS.boughtForEvr, 0, "offer_removed", { account: URI_TOKENS.boughtForEvr.issuer, offer_id: URI_TOKENS.boughtForEvr.id, is_sell_offer: true, removed_by: "sale", ...priced }],
        [
          URI_TOKENS.boughtForEvr,
          1,
          "sale",
          { account: "r9fT9gsDG4Zyodz9E2U6RG4Z3e4RD7tBa", from: URI_TOKENS.boughtForEvr.issuer, to: "r9fT9gsDG4Zyodz9E2U6RG4Z3e4RD7tBa", offer_id: URI_TOKENS.boughtForEvr.id, is_sell_offer: true, ...priced },
        ],
      ]);
    });

    it("a burn by the issuer of a token another account owns: from is the owner, account the sender", () => {
      const { hash, ledger, type } = XAHAU_EXTRA.burnByIssuer;
      checkCase(net, hash, ledger, type, [[URI_TOKENS.burnedByIssuer, 0, "burn", { account: URI_TOKENS.burnedByIssuer.issuer, from: "rLn3CeVysKVcrW1VSaiK5GCwxRm1FDXTN3" }]]);
    });
  }

  it("lists every case of D3's table that the manifest has, and the manifest has no other case the table lacks", () => {
    const named = Object.keys(manifest).sort();
    // D3 did not find an `offer_removed_other` or an `uritoken_mint_with_offer` on mainnet (its FINDINGS, "Not found"): the manifest has no such case.
    expect(named).toEqual(Object.keys(cases).sort());
  });
});

describe("the figures D3's FINDINGS check", () => {
  // FINDINGS 4 (xrpl/nft): the issuer's balance rose by 4428495 drops, (150000000 - 2383500) x 3000 / 100000; FINDINGS 2 (xahau/uritoken): the buy is at the ask, 4200 XAH. FINDINGS.md is
  // not copied: the figures are written down here, with their source.
  const DROPS = 1_000_000n;
  it("the brokered sale's royalty is 4,428,495 drops, '4.428495'", () => {
    const sale = eventsOfTx("xrpl", manifests.xrpl.cases.brokered_sale_royalty!.hash).find((e) => e.event === "sale")!;
    expect(((150_000_000n - 2_383_500n) * 3_000n) / 100_000n).toBe(4_428_495n);
    expect(sale.royalty_est).toBe("4.428495");
    expect(sale.amount).toBe("150");
    expect(sale.broker_fee).toBe("2.3835");
    expect(BigInt(Math.round(Number(sale.royalty_est) * Number(DROPS)))).toBe(4_428_495n);
  });

  it("the URITokenBuy at the ask is 4200 XAH", () => {
    const sale = eventsOfTx("xahau", manifests.xahau.cases.uritoken_buy_above_ask!.hash).find((e) => e.event === "sale")!;
    expect(sale).toMatchObject({ amount: "4200", currency: "XAH", converted_amount: "4200" });
    expect(caseTx("xahau", "uritoken_buy_above_ask").Amount).toBe("4200000000");
  });
});

// ---- The port over every transaction of the recordings -------------------------------------------------------------------------

describe.each(NETS)("%s: the port gives each NFT transaction of the recorded ledgers its events, and every other transaction none", (net) => {
  it("numbers the events of a transaction from 0, with ids of 64 upper-case hex digits, and never writes to its input", () => {
    let checked = 0;
    for (const raw of ledgers[net]) {
      for (const tx of raw.ledger.transactions) {
        const before = JSON.stringify(tx);
        const { events, skipped } = parseNftTransaction(net, tx);
        expect(JSON.stringify(tx)).toBe(before);
        expect(skipped).toBe(0);
        expect(events.map((e) => e.event_index)).toEqual(events.map((_, i) => i));
        for (const e of events) {
          expect(e.nft_id).toMatch(/^[0-9A-F]{64}$/);
          expect(e.kind).toBe(net === "xrpl" ? "nftoken" : "uritoken");
        }
        checked += events.length;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("follows the rules of D3's spec for each type", () => {
    const counts: Record<string, number> = {};
    const last = <T>(list: readonly T[]): T => list[list.length - 1]!;
    for (const raw of ledgers[net]) {
      for (const tx of raw.ledger.transactions) {
        const type = tx.TransactionType;
        const { events } = parseNftTransaction(net, tx);
        const names = events.map((e) => e.event);
        const of = (name: string) => events.filter((e) => e.event === name);
        const succeeded = tx.metaData.TransactionResult === "tesSUCCESS";
        if (succeeded) counts[type] = (counts[type] ?? 0) + 1;
        const isNft = net === "xrpl" ? type.startsWith("NFToken") : type.startsWith("URIToken") || type === "Remit";
        if (!succeeded || !isNft) {
          expect(names, `${type} ${tx.hash}`).toEqual([]);
        } else if (type === "NFTokenMint") {
          expect(names.filter((n) => n !== "offer_create")).toEqual(["mint"]);
          expect(of("offer_create")).toHaveLength(tx.Amount === undefined ? 0 : 1);
          expect(names[0]).toBe("mint");
        } else if (type === "NFTokenBurn") {
          expect(of("burn").map((e) => e.nft_id)).toEqual([tx.NFTokenID]);
          expect(of("offer_removed").every((e) => e.removed_by === "burn")).toBe(true);
          expect(last(names)).toBe("burn");
        } else if (type === "NFTokenModify") {
          expect(of("modify").map((e) => e.nft_id)).toEqual([tx.NFTokenID]);
          expect(events).toHaveLength(1);
        } else if (type === "NFTokenAcceptOffer") {
          const moved = events.filter((e) => e.event === "sale" || e.event === "transfer");
          expect(moved).toHaveLength(1);
          expect(names.filter((n) => n !== "offer_removed")).toHaveLength(1);
          expect(last(names)).toBe(moved[0]!.event);
          expect(of("offer_removed").every((e) => e.removed_by === "sale")).toBe(true);
          expect(of("offer_removed")).toHaveLength(tx.NFTokenSellOffer && tx.NFTokenBuyOffer ? 2 : 1);
        } else if (type === "NFTokenCreateOffer") {
          expect(names).toEqual(["offer_create"]);
          expect(events[0]!.is_sell_offer).toBe(((tx.Flags as number) & 1) === 1 ? 1 : 0);
          expect(events[0]!.account).toBe(tx.Account);
          expect(events[0]!.nft_id).toBe(tx.NFTokenID);
        } else if (type === "NFTokenCancelOffer") {
          expect(names.every((n) => n === "offer_cancel")).toBe(true);
          expect(events.every((e) => (tx.NFTokenOffers as string[]).includes(e.offer_id))).toBe(true);
          expect(events.length).toBeGreaterThan(0);
        } else if (type === "URITokenMint") {
          expect(names.filter((n) => n !== "offer_create")).toEqual(["mint"]);
          expect(of("offer_create")).toHaveLength(tx.Amount === undefined ? 0 : 1);
          expect(events[0]).toMatchObject({ account: tx.Account, issuer: tx.Account, to_account: tx.Account });
        } else if (type === "URITokenBurn") {
          expect(of("burn").map((e) => e.nft_id)).toEqual([tx.URITokenID]);
          expect(of("offer_removed").every((e) => e.removed_by === "burn")).toBe(true);
          expect(last(names)).toBe("burn");
          expect(last(events).account).toBe(tx.Account);
        } else if (type === "URITokenBuy") {
          expect(names).toEqual(["offer_removed", "sale"]);
          expect(of("offer_removed")[0]!.removed_by).toBe("sale");
          expect(of("sale")[0]).toMatchObject({ nft_id: tx.URITokenID, account: tx.Account, to_account: tx.Account });
        } else if (type === "URITokenCreateSellOffer") {
          expect(names).toEqual(["offer_create"]);
          expect(events[0]).toMatchObject({ nft_id: tx.URITokenID, account: tx.Account });
        } else if (type === "URITokenCancelSellOffer") {
          expect(names).toEqual(["offer_cancel"]);
          expect(events[0]).toMatchObject({ nft_id: tx.URITokenID, account: tx.Account });
        } else if (type === "Remit") {
          expect(of("transfer").map((e) => e.nft_id)).toEqual([...((tx.URITokenIDs as string[] | undefined) ?? [])].sort());
          expect(of("mint")).toHaveLength(tx.MintURIToken === undefined ? 0 : 1);
          expect(of("offer_removed").every((e) => e.removed_by === "transfer")).toBe(true);
          expect(of("sale")).toEqual([]);
        }
      }
    }
    // The recorded ledgers' successful NFT transactions are all seen (D3's FINDINGS 1: 12 mints and 2 burns on XRPL).
    if (net === "xrpl") {
      expect(counts).toMatchObject({ NFTokenMint: 12, NFTokenBurn: 2, NFTokenModify: 1, NFTokenAcceptOffer: 5, NFTokenCreateOffer: 121, NFTokenCancelOffer: 8 });
    } else {
      expect(counts).toMatchObject({ URITokenMint: 7, URITokenBurn: 8, URITokenBuy: 2, URITokenCreateSellOffer: 2, URITokenCancelSellOffer: 1, Remit: 3 });
    }
  });

  it("gives a Xahau URIToken no taxon, serial or transfer fee, and its offers name the token", () => {
    if (net === "xrpl") return;
    for (const each of derived.xahau) {
      expect(each.nft).not.toHaveProperty("taxon");
      expect(each.nft).not.toHaveProperty("serial");
      expect(each.nft).not.toHaveProperty("transfer_fee");
      for (const e of each.events) {
        expect(e).not.toHaveProperty("taxon");
        if (["offer_create", "offer_cancel", "offer_removed", "sale"].includes(e.event)) expect([e.offer_id, e.is_sell_offer]).toEqual([each.id, true]);
        else expect(e).not.toHaveProperty("offer_id");
      }
    }
  });
});

// ---- D3's amendments, one by one --------------------------------------------------------------------------------------------

describe("the port reads a failed transaction, a page and an offer as D3's controller rulings say", () => {
  /** A ledger of one transaction, the header of the recorded ledger it came from. */
  const ledgerOf = (raw: RawLedger, tx: RawTx): RawLedger => ({ ...raw, ledger: { ...raw.ledger, transactions: [tx] } });
  const recorded = (net: NetworkName, name: string) => txs[net].get(manifests[net].cases[name]!.hash)!;
  const syntheticHash = (name: string, hash: string): string => createHash("sha256").update(`${name}:${hash}`).digest("hex").toUpperCase();
  /** D3's `expireAcceptedOffer` (packages/shared/test/synthetic-tec-expired-accept.ts at PIN): the metadata rippled writes when the accepted sell offer had expired, `tecEXPIRED`. */
  const EXPIRED_AT = 846173000;
  function expireAcceptedOffer(meta: Json): void {
    const kept: Json[] = [];
    for (const wrapper of meta.AffectedNodes as Json[]) {
      const op = Object.keys(wrapper)[0]!;
      const node = wrapper[op];
      if (node.LedgerEntryType === "NFTokenPage") continue;
      if (node.LedgerEntryType === "AccountRoot") {
        const account = node.FinalFields.Account;
        // the seller (the offer's owner): its reserve only, no payment; the buyer (the sender): the fee only
        if (account === "rhv9jFwfWfH4Cd1uX4b3ACkdgDKASFz7Dz") {
          node.FinalFields.Balance = node.PreviousFields.Balance;
          node.PreviousFields = { OwnerCount: node.PreviousFields.OwnerCount };
        } else if (account === "rnKd8CYrXwMoGn4R48onJGLShh1PcrFrTx") {
          node.FinalFields.Balance = String(BigInt(node.PreviousFields.Balance) - 12n);
        } else {
          continue; // the issuer: no royalty is paid
        }
      }
      if (node.LedgerEntryType === "NFTokenOffer") node.FinalFields.Expiration = EXPIRED_AT;
      kept.push(wrapper);
    }
    meta.AffectedNodes = kept;
    meta.TransactionResult = "tecEXPIRED";
  }

  it("synthetic-tec-expired-accept (D3's): the expired offer a tecEXPIRED NFTokenAcceptOffer deletes is removed_by other, and is its only event", () => {
    const { raw, tx } = recorded("xrpl", "sale_by_sell_offer");
    const expired = variant(tx, (copy, meta) => {
      expireAcceptedOffer(meta);
      copy.hash = syntheticHash("synthetic-tec-expired-accept", tx.hash);
    });
    expect(expired.metaData.TransactionResult).toBe("tecEXPIRED");
    const [one] = deriveNfts("xrpl", [ledgerOf(raw, expired)]);
    expect(deriveNfts("xrpl", [ledgerOf(raw, expired)])).toHaveLength(1);
    expect(one!.id).toBe(NFTS.soldBySellOffer.id);
    expect(one!.events).toEqual([
      {
        nft_id: NFTS.soldBySellOffer.id,
        kind: "nftoken",
        issuer: NFTS.soldBySellOffer.issuer,
        taxon: 10,
        serial: 95234705,
        ledger_index: Number(raw.ledger.ledger_index),
        tx_index: tx.metaData.TransactionIndex,
        event_index: 0,
        tx_hash: expired.hash,
        tx_type: "NFTokenAcceptOffer",
        executed_time: isoTime(unixOf(raw.ledger.close_time)),
        event: "offer_removed",
        account: "rhv9jFwfWfH4Cd1uX4b3ACkdgDKASFz7Dz",
        offer_id: "D6DBB6452D44459FDA013C79708D2E699EA2340D5444AC1695FF621A80FDFBDE",
        is_sell_offer: true,
        amount: "10",
        currency: "XRP",
        destination: "rnKd8CYrXwMoGn4R48onJGLShh1PcrFrTx",
        expiration: isoTime(EXPIRED_AT + 946_684_800),
        removed_by: "other",
      },
    ]);
    // Nothing moved: no owner, no sale, no open offer (an `offer_removed` is not an offer to list).
    expect(one!.nft).toMatchObject({ burned: false, sale_count: 0 });
    expect(one!.nft).not.toHaveProperty("owner");
    expect(one!.offers).toEqual([]);

    // The same metadata read as a success is an offer the accept consumed: the result alone makes the removal `other`.
    const succeeded = variant(expired, (_tx, meta) => (meta.TransactionResult = "tesSUCCESS"));
    expect(parseNftTransaction("xrpl", succeeded).events.map((e) => [e.event, e.removed_by])).toEqual([["offer_removed", "sale"]]);
    // An expired offer priced with an MPT amount is skipped and counted, as in a successful transaction.
    const mpt = variant(expired, (_tx, meta) => {
      const offer = (meta.AffectedNodes as Json[]).find((w) => w.DeletedNode?.LedgerEntryType === "NFTokenOffer")!;
      offer.DeletedNode.FinalFields.Amount = { mpt_issuance_id: "0000012FFD9EE5DA93AC614B4DB94D7E0FCE415CA51BED47", value: "1" };
    });
    expect(parseNftTransaction("xrpl", mpt)).toEqual({ events: [], skipped: 1 });
  });

  it("a failed transaction gives no event of its pages or of an offer it creates, and the offers it deletes are removed by other, in node order", () => {
    const failed = (tx: RawTx, drop?: (wrapper: Json) => boolean) =>
      variant(tx, (_copy, meta) => {
        meta.TransactionResult = "tecOBJECT_NOT_FOUND";
        if (drop) meta.AffectedNodes = (meta.AffectedNodes as Json[]).filter((wrapper) => !drop(wrapper));
      });
    // synthetic-failed-mint, -failed-offer-create: a page that gains a token, a created offer.
    for (const name of ["mint", "sell_offer_create"]) {
      const tx = failed(recorded("xrpl", name).tx);
      expect((tx.metaData.AffectedNodes as Json[]).some((w) => w.CreatedNode?.LedgerEntryType === "NFTokenOffer" || w.ModifiedNode?.LedgerEntryType === "NFTokenPage")).toBe(true);
      expect(parseNftTransaction("xrpl", tx)).toEqual({ events: [], skipped: 0 });
    }
    // synthetic-failed-accept: the brokered sale with its pages still moving the NFT and the two offers it deletes left out.
    const accept = recorded("xrpl", "brokered_sale_royalty").tx;
    expect(parseNftTransaction("xrpl", failed(accept, (w) => w.DeletedNode?.LedgerEntryType === "NFTokenOffer"))).toEqual({ events: [], skipped: 0 });
    const withOffers = parseNftTransaction("xrpl", failed(accept));
    expect(withOffers.events.map((e) => [e.event_index, e.event, e.removed_by, e.is_sell_offer])).toEqual([
      [0, "offer_removed", "other", 1],
      [1, "offer_removed", "other", 0],
    ]);
    // The recorded failed URITokenMint touches no URIToken, so it gives none (the Xahau recording holds one: tecINSUFFICIENT_RESERVE).
    const failedMints = [...txs.xahau.values()].filter(({ tx }) => tx.TransactionType === "URITokenMint" && tx.metaData.TransactionResult !== "tesSUCCESS");
    expect(failedMints).toHaveLength(1);
    expect(parseNftTransaction("xahau", failedMints[0]!.tx)).toEqual({ events: [], skipped: 0 });
    // and on a URIToken that its failure kept: the same, a `tec` result alone is no event
    expect(parseNftTransaction("xahau", variant(caseTx("xahau", "uritoken_mint"), (_t, meta) => (meta.TransactionResult = "tecINSUFFICIENT_RESERVE")))).toEqual({ events: [], skipped: 0 });
  });

  it("removed_by is named by the removing transaction: an AccountDelete's is other, a cancel's is no removal", () => {
    const cancel = recorded("xrpl", "offer_cancel").tx;
    expect(parseNftTransaction("xrpl", cancel).events.map((e) => [e.event, e.removed_by])).toEqual([["offer_cancel", ""]]);
    const deleted = variant(cancel, (copy) => (copy.TransactionType = "AccountDelete"));
    expect(parseNftTransaction("xrpl", deleted).events.map((e) => [e.event, e.removed_by, e.account])).toEqual([["offer_removed", "other", "rf7Db55CXcWgqmHnb1Pjx1WVGNCqMNsyZ"]]);
  });

  it("an NFT that moves with a page deleted and merged forward is the sale or the burn, not a mint", () => {
    // synthetic-page-merge-forward: the burn's page is deleted after the burn took a token off it; its FinalFields lack the token, its PreviousFields have it.
    const burn = variant(recorded("xrpl", "burn").tx, (_tx, meta) => {
      const page = body(meta, 0);
      const before: Json[] = page.PreviousFields.NFTokens;
      const left: Json[] = page.FinalFields.NFTokens;
      const next = `${page.LedgerIndex.slice(0, 40)}FFFFFFFFFFFFFFFFFFFFFFFF`;
      const own = [{ NFToken: { NFTokenID: `${NFTS.burn.id.slice(0, -2)}F0`, URI: "697066733A2F2F4F574E" } }];
      meta.AffectedNodes[0] = { DeletedNode: { LedgerEntryType: "NFTokenPage", LedgerIndex: page.LedgerIndex, FinalFields: { Flags: 0, NFTokens: left, NextPageMin: next }, PreviousFields: { NFTokens: before } } };
      meta.AffectedNodes.push({ ModifiedNode: { LedgerEntryType: "NFTokenPage", LedgerIndex: next, FinalFields: { Flags: 0, NFTokens: [...own, ...left], PreviousPageMin: page.LedgerIndex }, PreviousFields: { NFTokens: own } } });
    });
    expect(parseNftTransaction("xrpl", burn).events.map((e) => [e.event, e.nft_id, e.from_account])).toEqual([["burn", NFTS.burn.id, "ravC5cZreMZuKEWSrpra5nkWnfzPmrabec"]]);
    // synthetic-sale-merge-forward: the same for the seller's page of the sale
    const sale = variant(recorded("xrpl", "sale_by_sell_offer").tx, (_tx, meta) => {
      const page = body(meta, 0);
      const before: Json[] = page.PreviousFields.NFTokens;
      const left: Json[] = page.FinalFields.NFTokens;
      const next = `${page.LedgerIndex.slice(0, 40)}FFFFFFFFFFFFFFFFFFFFFFFF`;
      const own = [{ NFToken: { NFTokenID: `${NFTS.soldBySellOffer.id.slice(0, -2)}F0`, URI: "697066733A2F2F4F574E" } }];
      meta.AffectedNodes[0] = { DeletedNode: { LedgerEntryType: "NFTokenPage", LedgerIndex: page.LedgerIndex, FinalFields: { Flags: 0, NFTokens: left }, PreviousFields: { NFTokens: before } } };
      meta.AffectedNodes.push({ ModifiedNode: { LedgerEntryType: "NFTokenPage", LedgerIndex: next, FinalFields: { Flags: 0, NFTokens: [...own, ...left] }, PreviousFields: { NFTokens: own } } });
    });
    expect(parseNftTransaction("xrpl", sale)).toEqual(parseNftTransaction("xrpl", recorded("xrpl", "sale_by_sell_offer").tx));
    expect(parseNftTransaction("xrpl", sale).events.map((e) => e.event)).toEqual(["offer_removed", "sale"]);
    // synthetic-burn-last-token: a page deleted with its last token in its FinalFields, none in PreviousFields
    const last = variant(recorded("xrpl", "burn").tx, (_tx, meta) => {
      const page = body(meta, 0);
      const burned = (page.PreviousFields.NFTokens as Json[]).find((e) => e.NFToken.NFTokenID === NFTS.burn.id)!;
      meta.AffectedNodes[0] = { DeletedNode: { LedgerEntryType: "NFTokenPage", LedgerIndex: page.LedgerIndex, FinalFields: { Flags: 0, NFTokens: [burned] } } };
    });
    expect(parseNftTransaction("xrpl", last).events.map((e) => [e.event, e.nft_id])).toEqual([["burn", NFTS.burn.id]]);
  });

  it("a page whose only change is a link has no previous tokens, and its tokens are not minted (synthetic-link-only-page)", () => {
    const tokens = (body(recorded("xrpl", "mint").tx.metaData, 0).FinalFields.NFTokens as Json[]).slice(0, 3);
    const cancel = recorded("xrpl", "offer_cancel").tx;
    const linked = variant(cancel, (_tx, meta) => {
      const key = "40FEFE9E7C73D4F8A4DC7A7A09DD13B724827F94";
      meta.AffectedNodes.push({
        ModifiedNode: {
          LedgerEntryType: "NFTokenPage",
          LedgerIndex: `${key}24827F945D1B3E9A061B0001`,
          FinalFields: { Flags: 0, NFTokens: tokens, NextPageMin: `${key}24827F945D1B3E9A061B0002` },
          PreviousFields: { NextPageMin: `${key}24827F945D1B3E9A061B0003` },
        },
      });
    });
    expect(parseNftTransaction("xrpl", linked)).toEqual(parseNftTransaction("xrpl", cancel));
  });

  it("an MPT amount skips its event and counts it", () => {
    const mptAmount = { mpt_issuance_id: "0000012FFD9EE5DA93AC614B4DB94D7E0FCE415CA51BED47", value: "100" };
    // an offer, a mint's offer, and an accepted offer, each priced in an MPT
    const offer = variant(recorded("xrpl", "sell_offer_create").tx, (tx, meta) => {
      tx.Amount = mptAmount;
      body(meta, 4).NewFields.Amount = mptAmount;
    });
    expect(parseNftTransaction("xrpl", offer)).toEqual({ events: [], skipped: 1 });
    const mint = variant(recorded("xrpl", "mint_with_offer").tx, (tx, meta) => {
      tx.Amount = mptAmount;
      body(meta, 2).NewFields.Amount = mptAmount;
    });
    const parsedMint = parseNftTransaction("xrpl", mint);
    expect(parsedMint.events.map((e) => e.event)).toEqual(["mint"]);
    expect(parsedMint.skipped).toBe(1);
    const accept = variant(recorded("xrpl", "sale_by_sell_offer").tx, (_tx, meta) => (body(meta, 6).FinalFields.Amount = mptAmount));
    expect(parseNftTransaction("xrpl", accept)).toEqual({ events: [], skipped: 2 });
    // and on Xahau: a URIToken's offer, its mint's offer, and a buy
    const uriOffer = variant(recorded("xahau", "uritoken_sell_offer_create").tx, (tx, meta) => {
      tx.Amount = mptAmount;
      body(meta, 0).FinalFields.Amount = mptAmount;
    });
    expect(parseNftTransaction("xahau", uriOffer)).toEqual({ events: [], skipped: 1 });
  });

  it("an Amount that was added to a URIToken is an offer only in a URITokenCreateSellOffer; a free mint offers at the transaction's Amount", () => {
    const listing = recorded("xahau", "uritoken_sell_offer_create").tx;
    expect(parseNftTransaction("xahau", listing).events.map((e) => [e.event, e.amount])).toEqual([["offer_create", "2200"]]);
    // a SetRemarks of a token with an offer shows the same node (an Amount in FinalFields, none in PreviousFields): no event
    expect(parseNftTransaction("xahau", variant(listing, (tx) => (tx.TransactionType = "SetRemarks")))).toEqual({ events: [], skipped: 0 });
    // an Amount that changed is listed with its old value, whatever the transaction
    const relist = variant(listing, (tx, meta) => {
      tx.TransactionType = "SetRemarks";
      const node = Object.values(meta.AffectedNodes[0])[0] as Json;
      node.PreviousFields.Amount = "1800000000";
    });
    expect(parseNftTransaction("xahau", relist).events.map((e) => [e.event, e.amount])).toEqual([["offer_create", "2200"]]);
    // synthetic-uritoken-free-mint-with-offer: the transaction offers the token for nothing; the created entry has the Destination but no Amount
    const free = variant(caseTx("xahau", "uritoken_mint"), (tx, meta) => {
      tx.Amount = "0";
      tx.Destination = "rAucmWmE8yiueemhmrGh5MyD2mNjXfpQp";
      Object.assign((Object.values(meta.AffectedNodes.find((w: Json) => w.CreatedNode?.LedgerEntryType === "URIToken"))[0] as Json).NewFields, { Destination: tx.Destination });
    });
    expect(parseNftTransaction("xahau", free).events.map((e) => [e.event, e.amount, e.destination])).toEqual([
      ["mint", "", ""],
      ["offer_create", "0", "rAucmWmE8yiueemhmrGh5MyD2mNjXfpQp"],
    ]);
  });

  it("rounds a native royalty down to a whole drop, and has none for an NFT without a transfer fee or when the issuer is a party", () => {
    const { tx } = recorded("xrpl", "sale_by_sell_offer");
    const sale = (edited: RawTx) => parseNftTransaction("xrpl", edited).events.find((e) => e.event === "sale")!;
    // 10000011 drops x 5000 / 100000 = 500000.55 drops: 500000 drops, not 500001
    expect(sale(variant(tx, (_t, meta) => (body(meta, 6).FinalFields.Amount = "10000011")))).toMatchObject({ amount: "10.000011", royalty_est: "0.5" });
    // the id with a fee of 0
    const noFee = JSON.parse(JSON.stringify(tx).split(NFTS.soldBySellOffer.id).join(`00080000${NFTS.soldBySellOffer.id.slice(8)}`)) as RawTx;
    expect(sale(noFee)).toMatchObject({ transfer_fee: 0, amount: "10", royalty_est: "" });
    // the issuer's own page gains the NFT: the issuer is the buyer
    const issuerBuys = variant(tx, (_t, meta) => {
      const page = body(meta, 1);
      page.LedgerIndex = `${Buffer.from(decodeAccountID(NFTS.soldBySellOffer.issuer)).toString("hex").toUpperCase()}${page.LedgerIndex.slice(40)}`;
    });
    expect(sale(issuerBuys)).toMatchObject({ to_account: NFTS.soldBySellOffer.issuer, transfer_fee: 5000, royalty_est: "" });
  });
});

// ---- The files -----------------------------------------------------------------------------------------------------------------

/** The keys of the objects, in the reference's order (docs/api-reference.md "NFTs" at PIN, apps/api/src/nft/nft-objects.ts). */
const COVERAGE_KEYS = ["from_ledger_index", "complete"];
const NFT_KEYS = ["nft_id", "kind", "issuer", "taxon", "serial", "flags", "transfer_fee", "owner", "owner_since", "uri", "digest", "minted", "burned", "burned_at", "sale_count", "last_sale"];
const POINT_KEYS = ["ledger_index", "tx_hash", "executed_time"];
const MINTED_KEYS = [...POINT_KEYS, "by", "to"];
const BURNED_AT_KEYS = [...POINT_KEYS, "by"];
const LAST_SALE_KEYS = ["amount", "currency", "amount_issuer", "converted_amount", "ledger_index", "tx_hash", "executed_time"];
/** An NFT in a list (an account's, a collection's) has no converted price on its last sale (D3's list rule). */
const LIST_LAST_SALE_KEYS = LAST_SALE_KEYS.filter((key) => key !== "converted_amount");
const EVENT_KEYS = [
  "nft_id", "kind", "issuer", "taxon", "serial", "ledger_index", "tx_index", "event_index", "tx_hash", "tx_type", "executed_time", "event", "account", "from", "to", "offer_id",
  "is_sell_offer", "amount", "currency", "amount_issuer", "converted_amount", "destination", "expiration", "broker", "broker_fee", "royalty_est", "removed_by", "uri",
];
const OFFER_KEYS = ["offer_id", "is_sell_offer", "owner", "amount", "currency", "amount_issuer", "destination", "expiration", "created_ledger", "created_tx_hash", "created_time"];
const NFT_BODY_KEYS = ["result", "coverage", "nft"];
const EVENTS_BODY_KEYS = ["result", "coverage", "count", "marker", "events"];
const OFFERS_BODY_KEYS = ["result", "coverage", "count", "marker", "offers"];
const NFTS_BODY_KEYS = ["result", "coverage", "count", "marker", "nfts"];

/** A file of the collections, the sales or the NFT volume: what scripts/nft-fixtures.ts calls its aggregates. */
const isAggregate = (path: string): boolean => /\/data-api\/(nft_collections[@/]|nft_sales@|network\/nft_volume@)/.test(path);
const ordered = (object: object, order: readonly string[]): string[] => order.filter((key) => key in object);
const kindOf = (path: string): "detail" | "history" | "offers" | "account" | "aggregate" | "node" => {
  if (/\/data-api\/nfts\/[0-9A-F]{64}\.json$/.test(path)) return "detail";
  if (/\/data-api\/nfts\/[0-9A-F]{64}\/history@/.test(path)) return "history";
  if (/\/data-api\/nfts\/[0-9A-F]{64}\/offers@/.test(path)) return "offers";
  if (/\/data-api\/accounts\/[^/]+\/nfts@/.test(path)) return "account";
  if (isAggregate(path)) return "aggregate";
  return "node";
};
const answersOf = (kind: ReturnType<typeof kindOf>) => answers.filter(({ path }) => kindOf(path) === kind);

// The keys of the collections' and the volume's objects, in the reference's order (`Keys of a collection`, `of a collection day`, `of a holder`, `of an NFT sale`, `of an NFT volume
// component` and the answers' lines; the row is the row of the other volumes: components, count, exchange, total, exchange_rate, start_time, end_time).
const COLLECTION_KEYS = ["issuer", "taxon", "kind", "supply", "holders", "minted", "burned", "sales_count", "volume_native", "first_mint", "last_mint", "last_ledger"];
const DAY_KEYS = ["date", "sales_count", "volume_native", "avg_price_native", "min_price_native", "mints", "burns"];
const HOLDER_KEYS = ["owner", "held"];
const SALE_KEYS = [
  "nft_id", "kind", "issuer", "taxon", "serial", "ledger_index", "tx_index", "event_index", "tx_hash", "executed_time", "seller", "buyer", "mode", "amount", "currency", "amount_issuer",
  "converted_amount", "broker", "broker_fee", "royalty_est",
];
const VOLUME_ROW_KEYS = ["components", "count", "exchange", "total", "exchange_rate", "start_time", "end_time"];
const VOLUME_COMPONENT_KEYS = ["issuer", "taxon", "count", "amount", "rate", "converted_amount"];
const COLLECTIONS_BODY_KEYS = ["result", "coverage", "total", "count", "marker", "collections"];
const COLLECTION_BODY_KEYS = ["result", "coverage", "collection"];
const HOLDERS_BODY_KEYS = ["result", "coverage", "count", "marker", "holders"];
const SALES_BODY_KEYS = ["result", "coverage", "count", "marker", "sales"];
const STATS_BODY_KEYS = ["result", "coverage", "count", "days"];
const VOLUME_BODY_KEYS = ["result", "coverage", "count", "marker", "rows"];

/** The client's check (nft-shape.ts) of an aggregate file, by the route it answers: `path` is below test/fixtures/http/. */
function checkAggregateFile(path: string, body: unknown): void {
  const [net] = path.split("/") as [NetworkName];
  const rest = path.slice(`${net}/data-api/`.length);
  if (rest.startsWith("nft_collections@")) checkCollectionsPage(body, path);
  else if (rest.startsWith("nft_sales@")) checkNftSalesPage(body, path);
  else if (rest.startsWith("network/nft_volume@")) checkNftVolume(body, path, rest.includes("live=") ? "live" : "daily");
  else if (/\/stats@/.test(rest)) checkCollectionDays(body, path);
  else if (/\/sales@/.test(rest)) checkNftSalesPage(body, path);
  else if (/\/holders@/.test(rest)) checkHoldersPage(body, path);
  else if (/\/nfts@/.test(rest)) checkNftsPage(body, path, { issuer: rest.split("/")[1]!, ...(net === "xrpl" && { taxon: Number(rest.split("/")[2]) }) });
  else checkCollection(body, path);
}

/** The keys of an aggregate answer and of the objects in it, before serialization, in the reference's order (a key an object has no value for is left out). */
function expectAggregateKeys(path: string, answer: Json): void {
  const keys = (object: object, order: readonly string[], what: string): void => expect(Object.keys(object), `${path} ${what}`).toEqual(order.filter((key) => key in object));
  const rest = path.slice(path.indexOf("/data-api/") + "/data-api/".length);
  if (rest.startsWith("nft_collections@")) {
    keys(answer, COLLECTIONS_BODY_KEYS, "answer");
    for (const collection of answer.collections as Json[]) {
      keys(collection, COLLECTION_KEYS, "collection");
      for (const point of ["first_mint", "last_mint"]) if (collection[point]) keys(collection[point], POINT_KEYS, point);
    }
  } else if (rest.startsWith("nft_sales@") || /\/sales@/.test(rest)) {
    keys(answer, SALES_BODY_KEYS, "answer");
    for (const sale of answer.sales as Json[]) keys(sale, SALE_KEYS, "sale");
  } else if (rest.startsWith("network/nft_volume@")) {
    keys(answer, VOLUME_BODY_KEYS, "answer");
    for (const row of answer.rows as Json[]) {
      keys(row, VOLUME_ROW_KEYS, "row");
      for (const component of row.components as Json[]) keys(component, VOLUME_COMPONENT_KEYS, "component");
    }
  } else if (/\/stats@/.test(rest)) {
    keys(answer, STATS_BODY_KEYS, "answer");
    for (const day of answer.days as Json[]) keys(day, DAY_KEYS, "day");
  } else if (/\/holders@/.test(rest)) {
    keys(answer, HOLDERS_BODY_KEYS, "answer");
    for (const holder of answer.holders as Json[]) keys(holder, HOLDER_KEYS, "holder");
  } else if (/\/nfts@/.test(rest)) {
    keys(answer, NFTS_BODY_KEYS, "answer");
    for (const nft of answer.nfts as Json[]) {
      keys(nft, NFT_KEYS, "nft");
      if (nft.last_sale) keys(nft.last_sale, LIST_LAST_SALE_KEYS, "last_sale");
    }
  } else {
    keys(answer, COLLECTION_BODY_KEYS, "answer");
    keys(answer.collection, COLLECTION_KEYS, "collection");
    for (const point of ["first_mint", "last_mint"]) if (answer.collection[point]) keys(answer.collection[point], POINT_KEYS, point);
  }
}


describe("the files", () => {
  it("are named by the requests the pages make, one answer each", () => {
    expect(new Set(answers.map((a) => a.path)).size).toBe(answers.length);
    expect(files.size).toBe(answers.length);
    for (const net of NETS) {
      const world = worlds[net];
      const every = new Set(answers.map((a) => a.path));
      for (const each of world.nfts) {
        const id = each.id;
        for (const [path, query] of [
          [`/v2/nfts/${id}`, ""],
          [`/v2/nfts/${id}/history`, "descending=true&limit=20"],
          [`/v2/nfts/${id}/history`, `descending=true&event=${OWN_EVENTS.join(",")}&limit=20`],
          [`/v2/nfts/${id}/offers`, "limit=50"],
        ] as const) {
          expect(every.has(dataApiFile(net, path, query)!), `${net} ${path}?${query}`).toBe(true);
        }
      }
      const accounts = NFT_ACCOUNTS[net];
      for (const account of [accounts.active, accounts.deleted, accounts.unfunded]) expect(every.has(dataApiFile(net, `/v2/accounts/${account}/nfts`, "limit=20")!)).toBe(true);
    }
  });

  it("passes the client's shape checks (nft-shape.ts), on both networks", () => {
    let checked = 0;
    for (const [path, text] of files) {
      const kind = kindOf(path);
      const body = JSON.parse(text);
      if (kind === "detail") checkNft(body, path);
      else if (kind === "history") checkNftEventsPage(body, path);
      else if (kind === "offers") checkNftOffersPage(body, path);
      else if (kind === "account") checkNftsPage(body, path);
      else if (kind === "aggregate") checkAggregateFile(path, body);
      else continue;
      checked++;
    }
    expect(checked).toBe(answers.length - answersOf("node").length);
    expect(checked).toBeGreaterThan(1000);
  });

  it.each(NETS)("%s: writes every object's keys in the reference's order, before serialization (a list's last_sale without converted_amount)", (net) => {
    const mine = answers.filter(({ path }) => path.startsWith(`${net}/`));
    for (const { path, value } of mine) {
      const kind = kindOf(path);
      const answer = value as Json;
      if (kind === "node") continue;
      expect(Object.keys(answer.coverage), path).toEqual(ordered(answer.coverage, COVERAGE_KEYS));
      const nftKeys = (nft: Json, lastSale: readonly string[]) => {
        expect(Object.keys(nft), path).toEqual(ordered(nft, NFT_KEYS));
        for (const [key, order] of [["owner_since", POINT_KEYS], ["minted", MINTED_KEYS], ["burned_at", BURNED_AT_KEYS], ["last_sale", lastSale]] as const) {
          if (nft[key]) expect(Object.keys(nft[key]), `${path} ${key}`).toEqual(ordered(nft[key], order));
        }
      };
      if (kind === "detail") {
        expect(Object.keys(answer), path).toEqual(NFT_BODY_KEYS.filter((key) => key in answer));
        nftKeys(answer.nft, LAST_SALE_KEYS);
      } else if (kind === "account") {
        expect(Object.keys(answer), path).toEqual(NFTS_BODY_KEYS.filter((key) => key in answer));
        for (const nft of answer.nfts) {
          nftKeys(nft, LIST_LAST_SALE_KEYS);
          expect(nft.last_sale ?? {}, path).not.toHaveProperty("converted_amount");
        }
      } else if (kind === "history") {
        expect(Object.keys(answer), path).toEqual(EVENTS_BODY_KEYS.filter((key) => key in answer));
        for (const event of answer.events) expect(Object.keys(event), path).toEqual(ordered(event, EVENT_KEYS));
      } else if (kind === "aggregate") {
        expectAggregateKeys(path, answer);
      } else {
        expect(Object.keys(answer), path).toEqual(OFFERS_BODY_KEYS.filter((key) => key in answer));
        for (const offer of answer.offers) expect(Object.keys(offer), path).toEqual(ordered(offer, OFFER_KEYS));
      }
    }
    expect(mine.length).toBeGreaterThan(20);
  });

  it("never write a null or an undefined, and write an amount as text", () => {
    const walk = (value: unknown, path: string): void => {
      expect(value, path).not.toBeNull();
      expect(value, path).not.toBeUndefined();
      if (Array.isArray(value)) value.forEach((item, at) => walk(item, `${path}[${at}]`));
      else if (typeof value === "object") for (const [key, item] of Object.entries(value as object)) walk(item, `${path}.${key}`);
    };
    for (const { path, value } of answers) {
      walk(value, path);
      if (kindOf(path) !== "node") {
        for (const event of ((value as Json).events ?? []) as Json[]) for (const key of ["amount", "broker_fee", "royalty_est", "converted_amount"]) if (key in event) expect(typeof event[key], `${path} ${key}`).toBe("string");
      }
    }
  });

  it("gives the same output for the same input", () => {
    const second = nftFixtures();
    expect(second.map(([path]) => path)).toEqual([...files.keys()]);
    for (const [path, text] of second) expect(files.get(path), path).toBe(text);
    expect(nftAnswers()).toEqual(answers);
  });

  it("is what isNftGenerated names, none of it written by hand, and nothing on disk that it names is missing from the generator", () => {
    for (const path of files.keys()) {
      expect(isNftGenerated(path), path).toBe(true);
      expect(isHandWritten(path), path).toBe(false);
    }
    const onDisk = readdirSync(HTTP, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `${entry.parentPath.slice(HTTP.pathname.length)}/${entry.name}`.replace(/^\//, ""))
      .filter(isNftGenerated);
    expect(onDisk.sort()).toEqual([...files.keys()].sort());
    // the hand-written accounts' other files are still theirs
    expect(isNftGenerated("xrpl/data-api/accounts/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh/balances.json")).toBe(false);
    expect(isHandWritten("xrpl/data-api/accounts/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh/balances.json")).toBe(true);
    expect(isHandWritten("xrpl/node/account_info/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh.json")).toBe(true);
  });

  it("has an NFT list for every hand-written account, empty where it holds none, and the mock answers the same empty page for an address with no file", async () => {
    for (const net of NETS) {
      const handWritten = readdirSync(new URL(`${net}/data-api/accounts/`, HTTP), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      const accounts = NFT_ACCOUNTS[net];
      expect(handWritten).toEqual([accounts.active, accounts.deleted, accounts.unfunded].sort());
      for (const account of handWritten) {
        const page = parsed(dataApiFile(net, `/v2/accounts/${account}/nfts`, "limit=20")!);
        expect(page.count).toBe(page.nfts.length);
        if (account !== accounts.active) expect(page.nfts).toEqual([]);
      }
      // D3 answers an address that holds none with an empty page, and the mock does so for an address it has no file for (upstream-core's NFT_COVERAGE): the same page.
      const upstream = createUpstream({
        files: { read: async () => undefined },
        bases: { xrpl: { dataApi: "https://xrpl.data.example.invalid", node: "https://s1.ripple.com:51234/" }, xahau: { dataApi: "https://xahau.data.example.invalid", node: "https://xahau.network/" } },
        primary: net,
      });
      const response = await upstream.handle(new Request(`https://${net}.data.example.invalid/v2/accounts/${accounts.unfunded}/nfts?limit=20`, { headers: { "X-API-Key": "k" } }));
      expect(await response!.json()).toEqual(parsed(dataApiFile(net, `/v2/accounts/${accounts.unfunded}/nfts`, "limit=20")!));
    }
  });
});

// ---- The derivation's own figures ----------------------------------------------------------------------------------------------

describe.each(NETS)("%s: the derived NFTs", (net) => {
  const recorded = derived[net];

  it("are the NFTs and URITokens the recorded transactions give an event of, each once, sorted by id", () => {
    expect(recorded.map((each) => each.id)).toEqual([...new Set(recorded.map((each) => each.id))].sort());
    // D3's e2e suites seed these ledgers: 275 NFTs have events on XRPL (12 minted, 4 sold, 2 burned) and 18 URITokens on Xahau.
    expect(recorded.length).toBe(net === "xrpl" ? 275 : 18);
    for (const each of recorded) {
      expect(each.events.length).toBeGreaterThan(0);
      expect(each.events).toEqual([...each.events].sort((a, b) => a.ledger_index - b.ledger_index || a.tx_index - b.tx_index || a.event_index - b.event_index));
      expect(each.nft.nft_id).toBe(each.id);
    }
  });

  it("decode as their ids say (XRPL), and a URIToken's id is the hash of its issuer and URI (Xahau)", () => {
    for (const each of recorded) {
      if (net === "xrpl") {
        const decoded = decodeNftId(each.id);
        expect(each.nft).toMatchObject({ issuer: decoded.issuer, taxon: decoded.taxon, serial: decoded.serial, flags: decoded.flags, transfer_fee: decoded.transferFee });
        expect(encodeNftId({ flags: decoded.flags, transferFee: decoded.transferFee, issuer: decoded.issuer, taxon: decoded.taxon, serial: decoded.serial })).toBe(each.id);
      } else {
        const mint = each.events.find((e) => e.event === "mint");
        if (mint !== undefined) expect(uriTokenId(each.nft.issuer, mint.uri!)).toBe(each.id);
      }
    }
  });

  it("have an owner, a burn or neither as the newest of their events say (the fold)", () => {
    for (const each of recorded) {
      const own = each.events.filter((e) => ["mint", "sale", "transfer", "burn"].includes(e.event));
      const newest = own.at(-1);
      if (newest === undefined) {
        expect(each.nft).not.toHaveProperty("owner");
        expect(each.nft.burned).toBe(false);
      } else if (newest.event === "burn") {
        expect(each.nft).toMatchObject({ burned: true, burned_at: { by: newest.account } });
        expect(each.nft).not.toHaveProperty("owner");
      } else {
        expect(each.nft).toMatchObject({ burned: false, owner: newest.to });
      }
      expect(each.nft.sale_count).toBe(each.events.filter((e) => e.event === "sale").length);
    }
  });

  it("list as open offers the newest event of each offer id, when it creates one, newest first", () => {
    for (const each of recorded) {
      const latest = new Map<string, NftEvent>();
      for (const e of each.events) if (["offer_create", "offer_cancel", "offer_removed"].includes(e.event)) latest.set(e.offer_id!, e);
      const open = [...latest.values()].filter((e) => e.event === "offer_create").reverse();
      expect(each.offers.map((offer) => offer.offer_id).sort()).toEqual(open.map((e) => e.offer_id!).sort());
      for (const offer of each.offers) {
        const made = open.find((e) => e.offer_id === offer.offer_id)!;
        expect(offer).toMatchObject({ is_sell_offer: made.is_sell_offer, owner: made.account, amount: made.amount, created_ledger: made.ledger_index, created_tx_hash: made.tx_hash });
      }
      expect(each.offers.map((offer) => offer.created_ledger)).toEqual([...each.offers.map((offer) => offer.created_ledger)].sort((a, b) => b - a));
    }
    // the XRPL NFT with a buy and a sell offer open (D3's offers example): 6.29 XRP for it, 19.98 XRP asked
    if (net === "xrpl") {
      expect(recorded.find((each) => each.id === NFTS.sellOffer.id)!.offers.map((offer) => [offer.is_sell_offer, offer.amount])).toEqual([[false, "6.29"], [true, "19.98"]]);
    }
  });

  it("fold with the same figures as D3's examples (the reference's)", () => {
    if (net === "xrpl") {
      const sold = recorded.find((each) => each.id === NFTS.soldBySellOffer.id)!;
      expect(sold.nft).toEqual({
        nft_id: NFTS.soldBySellOffer.id,
        kind: "nftoken",
        issuer: "r4PP7gwuVfxzLPWFiJXjLUtvzA7F97CzT3",
        taxon: 10,
        serial: 95234705,
        flags: 8,
        transfer_fee: 5000,
        owner: "rnKd8CYrXwMoGn4R48onJGLShh1PcrFrTx",
        owner_since: { ledger_index: 107874617, tx_hash: "BADF36AA20CD32067693C83EE5755BEFB8D1A1E82DEE83E1E67FFD6100712E56", executed_time: "2026-10-24T16:08:12Z" },
        burned: false,
        sale_count: 1,
        last_sale: { amount: "10", currency: "XRP", converted_amount: "10", ledger_index: 107874617, tx_hash: "BADF36AA20CD32067693C83EE5755BEFB8D1A1E82DEE83E1E67FFD6100712E56", executed_time: "2026-10-24T16:08:12Z" },
      });
    } else {
      const bought = recorded.find((each) => each.id === URI_TOKENS.bought.id)!;
      expect(bought.nft).toEqual({
        nft_id: URI_TOKENS.bought.id,
        kind: "uritoken",
        issuer: RODIN,
        flags: 0,
        owner: "rBkEp8W1yhBGLrvHFKKyrmSvniMFVJbPPg",
        owner_since: { ledger_index: 26763778, tx_hash: "01772F1C2E379A2213EDDFF939ABB3FE59C2B309244EC442EA1515761605C20C", executed_time: "2026-10-24T15:36:02Z" },
        digest: "772B38763E8E603AEE9BBB2026B8E9B97537ECC8867E46D042630C0B326B8736",
        burned: false,
        sale_count: 1,
        last_sale: { amount: "4200", currency: "XAH", converted_amount: "4200", ledger_index: 26763778, tx_hash: "01772F1C2E379A2213EDDFF939ABB3FE59C2B309244EC442EA1515761605C20C", executed_time: "2026-10-24T15:36:02Z" },
      });
    }
  });

  it("have D3's coverage over the recorded world: the set's first ledger, and complete when the first indexed event is a mint", () => {
    const world = worlds[net];
    const from = Number(ledgers[net][0]!.ledger.ledger_index);
    expect(world.from).toBe(from);
    for (const each of world.nfts) {
      const detail = parsed(dataApiFile(net, `/v2/nfts/${each.id}`, "")!);
      expect(detail.coverage).toEqual({ from_ledger_index: from, complete: each.events[0]!.event === "mint" });
      for (const query of ["descending=true&limit=20", `descending=true&event=${OWN_EVENTS.join(",")}&limit=20`]) {
        expect(parsed(dataApiFile(net, `/v2/nfts/${each.id}/history`, query)!).coverage).toEqual(detail.coverage);
      }
      expect(parsed(dataApiFile(net, `/v2/nfts/${each.id}/offers`, "limit=50")!).coverage).toEqual(detail.coverage);
      expect(itemCoverage(from, each)).toEqual(detail.coverage);
    }
    // some are complete and some are not, so that both states are drawn; never complete:true alone (D3 always sends the ledger)
    const completes = world.nfts.map((each) => itemCoverage(from, each).complete);
    expect(completes).toContain(true);
    expect(completes).toContain(false);
    for (const each of world.nfts) expect(itemCoverage(from, each).from_ledger_index).toBe(from);
  });
});

// ---- The featured NFT ----------------------------------------------------------------------------------------------------------

describe.each(NETS)("%s: the featured NFT", (net) => {
  const world = worlds[net];
  const featured = world.nfts.find((each) => each.id === world.featured)!;
  const history = (query: string) => parsed(dataApiFile(net, `/v2/nfts/${world.featured}/history`, query)!);
  const recordedRows = derived[net].find((each) => each.id === world.featured)!;

  it("is the NFT of the case's transaction", () => {
    const hash = manifests[net].cases[NFT_CASE_TXS[net].featured]!.hash;
    expect(recordedRows.events.some((e) => e.tx_hash === hash && e.event === "sale")).toBe(true);
    expect(world.featured).toBe(net === "xrpl" ? NFTS.brokered.id : URI_TOKENS.bought.id);
    expect(world.unowned).toBe(net === "xrpl" ? NFTS.sellOffer.id : URI_TOKENS.listed.id);
  });

  it("has two pages of history, the second behind the first's marker, and the event filter one", () => {
    const first = history("descending=true&limit=20");
    expect(first.count).toBe(20);
    expect(first.events).toHaveLength(20);
    expect(typeof first.marker).toBe("string");
    const last = first.events.at(-1);
    expect(first.marker).toBe(Buffer.from(JSON.stringify([last.ledger_index, last.tx_index, last.event_index])).toString("base64url"));
    const second = history(`descending=true&limit=20&marker=${first.marker}`);
    expect(second.count).toBeGreaterThan(0);
    expect(second.count).toBeLessThan(20);
    expect(second).not.toHaveProperty("marker");
    // the pages are the whole history, newest first, each once
    const all = [...first.events, ...second.events] as NftEvent[];
    expect(all.map((e) => [e.ledger_index, e.tx_index, e.event_index])).toEqual(featured.events.map((e) => [e.ledger_index, e.tx_index, e.event_index]).reverse());
    expect(all).toHaveLength(featured.events.length);
    // the filter the NFT page asks for without the offer events: the sale, one page
    const own = history(`descending=true&event=${OWN_EVENTS.join(",")}&limit=20`);
    expect(own).not.toHaveProperty("marker");
    expect(own.events.map((e: NftEvent) => e.event)).toEqual(["sale"]);
    expect(own.count).toBe(1);
  });

  it("has older offer events before its first recorded event, in recorded ledgers, ending with the creation of the offers its sale removed", () => {
    const padding = featured.events.slice(0, featured.events.length - recordedRows.events.length);
    expect(padding).toHaveLength(net === "xrpl" ? 24 : 20);
    expect(padding.map((e) => e.event).every((event) => event === "offer_create" || event === "offer_cancel")).toBe(true);
    const firstRecorded = recordedRows.events[0]!;
    const set = new Map(ledgers[net].map((raw) => [Number(raw.ledger.ledger_index), raw]));
    const places = new Set<string>();
    for (const e of padding) {
      expect(e.ledger_index).toBeLessThan(firstRecorded.ledger_index);
      const raw = set.get(e.ledger_index)!;
      expect(raw, `${e.ledger_index} is a recorded ledger`).toBeDefined();
      // a place no recorded transaction has: past the ledger's own
      expect(e.tx_index).toBeGreaterThanOrEqual(raw.ledger.transactions.length);
      expect(e.executed_time).toBe(isoTime(unixOf(raw.ledger.close_time)));
      expect(e.tx_hash).toMatch(/^[0-9A-F]{64}$/);
      places.add(`${e.ledger_index}:${e.tx_index}`);
    }
    expect(places.size).toBe(padding.length);
    // The offers of a URIToken are all the token's own (one offer id): Xahau's end is checked below.
    if (net === "xahau") return;
    // the offers the recorded sale removed were created at the amounts it removed them at, by the same accounts
    for (const removed of recordedRows.events.filter((e) => e.event === "offer_removed")) {
      const created = padding.find((e) => e.event === "offer_create" && e.offer_id === removed.offer_id)!;
      expect(created, removed.offer_id).toBeDefined();
      expect(created).toMatchObject({ account: removed.account, amount: removed.amount, currency: removed.currency, is_sell_offer: removed.is_sell_offer });
      expect(created.destination).toBe(removed.destination);
      expect(created.expiration).toBe(removed.expiration);
      expect(padding.filter((e) => e.offer_id === removed.offer_id).map((e) => e.event)).toEqual(["offer_create"]);
    }
    // every cancel follows the creation of the offer it cancels, with its amount and expiration; no offer is made twice
    const made = new Map<string, NftEvent>();
    for (const e of padding) {
      if (e.event === "offer_create") {
        expect(made.has(e.offer_id!), e.offer_id).toBe(false);
        made.set(e.offer_id!, e);
      } else {
        const created = made.get(e.offer_id!);
        expect(created, `a cancel of ${e.offer_id} follows its creation`).toBeDefined();
        expect(e).toMatchObject({ account: created!.account, amount: created!.amount, is_sell_offer: created!.is_sell_offer });
        expect(e.expiration).toBe(created!.expiration);
      }
    }
  });

  it("has the offers that stay open: XRPL two bids, one expired before the recordings end and one not; Xahau none (the sale removed the token's only offer)", () => {
    const offers = parsed(dataApiFile(net, `/v2/nfts/${world.featured}/offers`, "limit=50")!);
    if (net === "xahau") {
      expect(offers.offers).toEqual([]);
      expect(offers.count).toBe(0);
      return;
    }
    expect(offers.offers).toHaveLength(2);
    const head = unixOf(ledgers.xrpl.at(-1)!.ledger.close_time);
    const expirations = offers.offers.map((offer: Json) => Date.parse(offer.expiration) / 1000).sort((a: number, b: number) => a - b);
    expect(expirations[0]).toBeLessThan(head);
    expect(expirations[1]).toBeGreaterThan(head + 300 * 86400);
    for (const offer of offers.offers) expect(offer).toMatchObject({ is_sell_offer: false, currency: "XRP", destination: BROKER });
  });

  it("is a URIToken's relisting, cancelling and relisting at last the price its sale removed (Xahau)", () => {
    if (net === "xrpl") return;
    const padding = featured.events.slice(0, 20);
    let standing: string | undefined;
    for (const e of padding) {
      if (e.event === "offer_create") standing = e.amount;
      else {
        expect(standing, "a cancel follows an offer").toBeDefined();
        expect(e.amount).toBe(standing);
        standing = undefined;
      }
      expect([e.account, e.is_sell_offer, e.offer_id]).toEqual([SELLER, true, world.featured]);
    }
    expect(padding.at(-1)).toMatchObject({ event: "offer_create", amount: "4200" });
  });
});

// ---- The places of the events --------------------------------------------------------------------------------------------------

describe.each(NETS)("%s: the places of the events", (net) => {
  const world = worlds[net];
  const real = new Map(ledgers[net].map((raw) => [Number(raw.ledger.ledger_index), raw]));
  const recorded = new Set(derived[net].flatMap((each) => each.events.map((e) => `${e.nft_id}:${e.ledger_index}:${e.tx_index}:${e.event_index}`)));
  const every = world.nfts.flatMap((each) => each.events);
  const isRecorded = (e: NftEvent): boolean => recorded.has(`${e.nft_id}:${e.ledger_index}:${e.tx_index}:${e.event_index}`);

  it("are a unique (ledger_index, tx_index, event_index) across every NFT of the world, so that a sales list can join on it", () => {
    const keys = every.map((e) => `${e.ledger_index}:${e.tx_index}:${e.event_index}`);
    expect(new Set(keys).size).toBe(every.length);
  });

  it("have one transaction hash and type for a (ledger_index, tx_index), whichever NFT the event is of", () => {
    const by = new Map<string, { hash: string; type: string }>();
    for (const e of every) {
      const key = `${e.ledger_index}:${e.tx_index}`;
      const seen = by.get(key);
      if (seen === undefined) by.set(key, { hash: e.tx_hash, type: e.tx_type });
      else expect(seen, key).toEqual({ hash: e.tx_hash, type: e.tx_type });
    }
    // and one (ledger_index, tx_index) is one hash: no two places share a hash
    const hashes = new Map<string, string>();
    for (const [key, { hash }] of by) {
      expect(hashes.get(hash) ?? key, hash).toBe(key);
      hashes.set(hash, key);
    }
  });

  it("are a recorded transaction's for a recorded event and past the ledger's own transactions for a synthetic one", () => {
    let synthetic = 0;
    for (const e of every) {
      const raw = real.get(e.ledger_index);
      expect(raw, `${e.ledger_index} is a recorded ledger`).toBeDefined();
      if (isRecorded(e)) {
        expect(raw!.ledger.transactions.find((tx) => tx.metaData.TransactionIndex === e.tx_index)?.hash).toBe(e.tx_hash);
      } else {
        synthetic++;
        expect(e.tx_index, `${e.event} of ${e.nft_id}`).toBeGreaterThanOrEqual(raw!.ledger.transactions.length);
        expect(e.executed_time).toBe(isoTime(unixOf(raw!.ledger.close_time)));
      }
    }
    expect(synthetic).toBeGreaterThan(50);
    expect(every.length - synthetic).toBe(derived[net].reduce((sum, each) => sum + each.events.length, 0));
  });
});

// ---- The active account's holdings ---------------------------------------------------------------------------------------------

describe.each(NETS)("%s: the active account's holdings (synthetic, C12)", (net) => {
  const world = worlds[net];
  const active = NFT_ACCOUNTS[net].active;
  const list = parsed(dataApiFile(net, `/v2/accounts/${active}/nfts`, "limit=20")!);

  it("are listed by collection and serial, are what the account holds in the index, and are in the recorded ledgers", () => {
    expect(list.nfts.map((nft: Nft) => nft.nft_id)).toEqual(world.holdings);
    expect(list.nfts).toHaveLength(net === "xrpl" ? 3 : 2);
    expect(world.nfts.filter((each) => each.nft.owner === active && !each.nft.burned).map((each) => each.id).sort()).toEqual([...world.holdings].sort());
    const set = new Set(ledgers[net].map((raw) => Number(raw.ledger.ledger_index)));
    for (const id of world.holdings) {
      const each = world.nfts.find((candidate) => candidate.id === id)!;
      expect(derived[net].some((recorded) => recorded.id === id), "not a recorded NFT").toBe(false);
      for (const e of each.events) expect(set.has(e.ledger_index), `${id} ${e.event}`).toBe(true);
      expect(each.nft.owner).toBe(active);
      // each has a history of its own, files like any NFT's
      expect(files.has(dataApiFile(net, `/v2/nfts/${id}`, "")!)).toBe(true);
    }
    const order = list.nfts.map((nft: Nft) => [nft.issuer, nft.taxon ?? 0, nft.serial ?? 0, nft.nft_id] as const);
    expect(order).toEqual([...order].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1] || a[2] - b[2] || (a[3] < b[3] ? -1 : 1))));
  });

  it("include one of the featured NFT's collection that the active account owns (the collection's owner filter needs it)", () => {
    const featured = world.nfts.find((each) => each.id === world.featured)!.nft;
    const sibling = list.nfts.find((nft: Nft) => nft.issuer === featured.issuer && (nft.taxon ?? 0) === (featured.taxon ?? 0));
    expect(sibling).toBeDefined();
    expect(sibling.nft_id).not.toBe(world.featured);
  });

  it("drop the converted price of the last sale in the list, and keep it in the detail", () => {
    const sold = list.nfts.filter((nft: Nft) => nft.last_sale !== undefined);
    expect(sold.length).toBeGreaterThan(0);
    for (const nft of sold) {
      expect(nft.last_sale).not.toHaveProperty("converted_amount");
      const detail = parsed(dataApiFile(net, `/v2/nfts/${nft.nft_id}`, "")!).nft as Nft;
      expect(detail.last_sale).toHaveProperty("converted_amount");
      expect(listNft(detail)).toEqual(nft);
    }
  });

  it("start with a mint or not: the history of one that starts with its mint is whole", () => {
    const complete = world.holdings.map((id) => itemCoverage(world.from, world.nfts.find((each) => each.id === id)!).complete);
    expect(complete.every(Boolean)).toBe(true);
    for (const id of world.holdings) expect(world.nfts.find((each) => each.id === id)!.events[0]).toMatchObject({ event: "mint" });
  });
});

describe("the holdings of XRPL", () => {
  it("are two siblings of the featured NFT (one bought for 20 XRP, one minted to the account) and one the account issued and changed the URI of", () => {
    const world = worlds.xrpl;
    const byId = (id: string): DerivedNft => world.nfts.find((each) => each.id === id)!;
    const [own, ...siblings] = world.holdings.map(byId);
    expect(own!.nft.issuer).toBe(NFT_ACCOUNTS.xrpl.active);
    expect(own!.events.map((e) => e.event)).toEqual(["mint", "modify"]);
    expect(own!.nft.uri).toBe(own!.events[1]!.uri);
    expect(own!.nft.uri).not.toBe(own!.events[0]!.uri);
    expect(siblings.map((each) => each.nft.issuer)).toEqual([NFTS.brokered.issuer, NFTS.brokered.issuer]);
    const bought = siblings.find((each) => each.nft.sale_count === 1)!;
    expect(bought.events.map((e) => e.event)).toEqual(["mint", "offer_create", "offer_removed", "sale"]);
    expect(bought.events[3]).toMatchObject({ from: NFTS.brokered.issuer, to: NFT_ACCOUNTS.xrpl.active, amount: "20", converted_amount: "20" });
    expect(bought.events[3]).not.toHaveProperty("royalty_est");
    // the removal and the sale are one transaction
    expect(bought.events[2]!.tx_hash).toBe(bought.events[3]!.tx_hash);
    expect(bought.events[2]!.tx_index).toBe(bought.events[3]!.tx_index);
    const gifted = siblings.find((each) => each.nft.sale_count === 0)!;
    expect(gifted.events.map((e) => [e.event, e.to])).toEqual([["mint", NFT_ACCOUNTS.xrpl.active]]);
    for (const each of siblings) expect(each.nft).toMatchObject({ taxon: NFTS.brokered.taxon, transfer_fee: 3000, flags: 25 });
  });
});

describe("the holdings of Xahau", () => {
  it("are a token of the featured token's issuer, bought for 1,500 XAH, and one the account issued itself, with the ids their issuers and URIs make", () => {
    const world = worlds.xahau;
    const [own, bought] = world.holdings.map((id) => world.nfts.find((each) => each.id === id)!);
    expect(own!.nft.issuer).toBe(NFT_ACCOUNTS.xahau.active);
    expect(own!.events.map((e) => e.event)).toEqual(["mint"]);
    expect(bought!.nft.issuer).toBe(RODIN);
    expect(bought!.events.map((e) => e.event)).toEqual(["mint", "offer_create", "offer_removed", "sale"]);
    expect(bought!.events[3]).toMatchObject({ from: RODIN, to: NFT_ACCOUNTS.xahau.active, amount: "1500", currency: "XAH", converted_amount: "1500" });
    for (const each of [own!, bought!]) expect(uriTokenId(each.nft.issuer, each.events[0]!.uri!)).toBe(each.id);
    expect(bought!.nft.digest).toMatch(/^[0-9A-F]{64}$/);
    expect(own!.nft).not.toHaveProperty("digest");
  });
});

// ---- The cases of the pages --------------------------------------------------------------------------------------------------

/** What the rules read, from the generator's files (test/support/nft-cases.ts reads the committed files with the same rules). */
const sourcesCache = new Map<NetworkName, NftSources>();
function sourcesOf(net: NetworkName): NftSources {
  const cached = sourcesCache.get(net);
  if (cached !== undefined) return cached;
  const nfts = new Map<string, any>();
  const histories = new Map<string, any>();
  const paged = new Set<string>();
  const node = new Map<string, NodeNft>();
  const holdings = new Map<string, any>();
  for (const [path, text] of files) {
    if (!path.startsWith(`${net}/`)) continue;
    const rest = path.slice(net.length + 1);
    let match: RegExpExecArray | null;
    if ((match = /^data-api\/nfts\/([0-9A-F]{64})\.json$/.exec(rest))) nfts.set(match[1]!, JSON.parse(text));
    else if ((match = /^data-api\/nfts\/([0-9A-F]{64})\/history@descending=true&limit=20\.json$/.exec(rest))) histories.set(match[1]!, JSON.parse(text));
    else if ((match = /^data-api\/nfts\/([0-9A-F]{64})\/history@descending=true&limit=20&marker=[^/]+\.json$/.exec(rest))) paged.add(match[1]!);
    else if ((match = /^node\/nft_info\/([0-9A-F]{64})\.json$/.exec(rest))) {
      const { result } = JSON.parse(text);
      node.set(match[1]!, { issuer: result.issuer, taxon: result.nft_taxon, serial: result.nft_serial, burned: result.is_burned });
    } else if ((match = /^node\/ledger_entry\/([0-9A-F]{64})\.json$/.exec(rest))) node.set(match[1]!, { issuer: JSON.parse(text).result.node.Issuer, burned: false });
    else if ((match = /^data-api\/accounts\/([^/]+)\/nfts@limit=20\.json$/.exec(rest))) holdings.set(match[1]!, JSON.parse(text));
  }
  const made = { nfts, histories, pagedHistories: paged, node, holdings };
  sourcesCache.set(net, made);
  return made;
}

describe.each(NETS)("%s: holds every NftCase", (net) => {
  const sources = sourcesOf(net);
  const world = worlds[net];
  const burnTx = net === "xrpl" ? manifests.xrpl.cases.burn!.hash : manifests.xahau.cases.uritoken_burn_with_offer!.hash;
  const wanted = (which: NftCase): string | undefined => {
    switch (which) {
      case "featured":
        return world.featured;
      case "unowned":
        return world.unowned;
      case "burned":
        // XRPL: `burn`'s NFT; Xahau has no `burn` case, its burned NFT is `uritoken_burn_with_offer`'s URIToken
        return derived[net].find((each) => each.events.some((e) => e.tx_hash === burnTx && e.event === "burn"))!.id;
      default:
        return undefined;
    }
  };

  it.each(NFT_CASES.filter((which) => which !== "network-burned" || net === "xrpl"))("%s", (which) => {
    const found = resolveNftCase(net, which, sources);
    expect(found, `the ${net} fixtures have a ${which} NFT`).toBeDefined();
    const id = wanted(which);
    if (id !== undefined) expect(found!.id).toBe(id);
    expect(found!.id).toMatch(/^[0-9A-F]{64}$/);
    expect(isValidClassicAddress(found!.issuer)).toBe(true);
    if (net === "xrpl") {
      const decoded = decodeNftId(found!.id);
      expect(found).toEqual({ id: found!.id, issuer: decoded.issuer, serial: decoded.serial, taxon: decoded.taxon });
    } else {
      expect(found).toEqual({ id: found!.id, issuer: found!.issuer });
    }
    const indexed = sources.nfts.has(found!.id);
    const known = sources.node.has(found!.id);
    expect(
      { indexed, known },
      which,
    ).toEqual(
      {
        featured: { indexed: true, known: false },
        burned: { indexed: true, known: false },
        unowned: { indexed: true, known: true },
        network: { indexed: false, known: true },
        "network-burned": { indexed: false, known: true },
        missing: { indexed: false, known: false },
      }[which],
    );
  });

  it("finds the network NFT of Xahau among the URITokens the index lacks, and no network-burned one: a burned URIToken is no ledger entry", () => {
    if (net === "xrpl") {
      expect(sources.node.get(resolveNftCase(net, "network-burned", sources)!.id)!.burned).toBe(true);
      return;
    }
    expect(resolveNftCase(net, "network-burned", sources)).toBeUndefined();
    expect([...sources.node.values()].every((entry) => !entry.burned)).toBe(true);
  });

  it("names the featured NFT's collection in the missing id, and an account that holds NFTs", () => {
    const missing = resolveNftCase(net, "missing", sources)!;
    const featured = resolveNftCase(net, "featured", sources)!;
    expect(missing.issuer).toBe(featured.issuer);
    if (net === "xrpl") expect(missing).toMatchObject({ taxon: featured.taxon, serial: featured.serial! + 1 });
    expect(resolveHolder(sources)).toBe(NFT_ACCOUNTS[net].active);
  });

  it("resolves a case from the data alone: with the featured NFT's second page gone there is no featured NFT", () => {
    expect(resolveNftCase(net, "featured", { ...sources, pagedHistories: new Set() })).toBeUndefined();
    expect(resolveNftCase(net, "unowned", { ...sources, node: new Map() })).toBeUndefined();
    expect(resolveHolder({ ...sources, holdings: new Map() })).toBeUndefined();
  });
});

describe("the node's files", () => {
  const nodeJson = (net: NetworkName, method: string, params: Record<string, unknown>): any => parsed(nodeFile(net, method, params)!).result;

  it("give XRPL's unowned NFT the owner of its sell offer, in Clio's shape", () => {
    const id = worlds.xrpl.unowned;
    const info = nodeJson("xrpl", "nft_info", { nft_id: id, ledger_index: "validated" });
    const offer = worlds.xrpl.nfts.find((each) => each.id === id)!.offers.find((o) => o.is_sell_offer)!;
    const decoded = decodeNftId(id);
    expect(info).toEqual({
      nft_id: id,
      ledger_index: expect.any(Number),
      owner: offer.owner,
      is_burned: false,
      flags: decoded.flags,
      transfer_fee: decoded.transferFee,
      issuer: decoded.issuer,
      nft_taxon: decoded.taxon,
      nft_serial: decoded.serial,
      uri: expect.stringMatching(/^(?:[0-9A-F]{2})+$/),
      validated: true,
      status: "success",
    });
    // it last changed before the index began
    expect(info.ledger_index).toBeLessThan(worlds.xrpl.from);
  });

  it("give XRPL a token of the recorded pages that the index has no event of, with a sell and a buy offer, and a burned NFT with no URI", () => {
    const sources = sourcesOf("xrpl");
    const network = resolveNftCase("xrpl", "network", sources)!;
    const info = nodeJson("xrpl", "nft_info", { nft_id: network.id, ledger_index: "validated" });
    expect(info).toMatchObject({ is_burned: false, validated: true, issuer: network.issuer, nft_taxon: network.taxon, nft_serial: network.serial });
    // its owner is the owner of the page it is on, in a recorded ledger
    const page = ledgers.xrpl.find((raw) => Number(raw.ledger.ledger_index) === info.ledger_index)!;
    expect(JSON.stringify(page.ledger.transactions.map((tx) => tx.metaData))).toContain(network.id);
    expect(worlds.xrpl.nfts.some((each) => each.id === network.id)).toBe(false);
    for (const [method, flags] of [["nft_sell_offers", 1], ["nft_buy_offers", 0]] as const) {
      const result = nodeJson("xrpl", method, { nft_id: network.id, ledger_index: "validated", limit: 50 });
      expect(result).toMatchObject({ nft_id: network.id, validated: true, status: "success" });
      expect(result.offers).toHaveLength(1);
      expect(result.offers[0]).toMatchObject({ flags, nft_offer_index: expect.stringMatching(/^[0-9A-F]{64}$/) });
      expect(isValidClassicAddress(result.offers[0].owner)).toBe(true);
    }
    const burned = resolveNftCase("xrpl", "network-burned", sources)!;
    const gone = nodeJson("xrpl", "nft_info", { nft_id: burned.id, ledger_index: "validated" });
    expect(gone).toMatchObject({ is_burned: true, validated: true });
    expect(gone).not.toHaveProperty("uri");
    expect(isValidClassicAddress(gone.owner)).toBe(true);
  });

  it("give Xahau's unowned URIToken the owner of its offer, with the offer in drops, and a token the index lacks with none", () => {
    const entry = (id: string) => nodeJson("xahau", "ledger_entry", { index: id, ledger_index: "validated" });
    const unowned = worlds.xahau.nfts.find((each) => each.id === worlds.xahau.unowned)!;
    const offer = unowned.offers[0]!;
    const said = entry(unowned.id);
    expect(said).toMatchObject({ index: unowned.id, validated: true, status: "success" });
    expect(said.node).toMatchObject({ LedgerEntryType: "URIToken", Owner: offer.owner, Issuer: unowned.nft.issuer, Digest: unowned.nft.digest, Flags: unowned.nft.flags, Amount: "2200000000", index: unowned.id });
    const network = resolveNftCase("xahau", "network", sourcesOf("xahau"))!;
    const lacking = entry(network.id);
    expect(lacking.node).toMatchObject({ LedgerEntryType: "URIToken", Issuer: network.issuer });
    expect(lacking.node).not.toHaveProperty("Amount");
    expect(uriTokenId(lacking.node.Issuer, lacking.node.URI)).toBe(network.id);
    expect(worlds.xahau.nfts.some((each) => each.id === network.id)).toBe(false);
  });

  it("have no file for an id the fixtures do not hold: the node answers it objectNotFound or entryNotFound, as the mock does", () => {
    for (const net of NETS) {
      const missing = resolveNftCase(net, "missing", sourcesOf(net))!;
      const method = net === "xrpl" ? "nft_info" : "ledger_entry";
      expect(files.has(nodeFile(net, method, net === "xrpl" ? { nft_id: missing.id, ledger_index: "validated" } : { index: missing.id, ledger_index: "validated" })!)).toBe(false);
      expect(files.has(dataApiFile(net, `/v2/nfts/${missing.id}`, "")!)).toBe(false);
    }
  });
});

// ---- The synthetic aggregates ----------------------------------------------------------------------------------------------------

/** D3's feature coverage as the fixtures give it (C5): XRPL's is complete from the network's first ledger, Xahau's starts where the recordings do. */
const FEATURE_COVERAGE: Record<NetworkName, { from_ledger_index: number; complete: boolean }> = { xrpl: { from_ledger_index: 32570, complete: true }, xahau: { from_ledger_index: 26533927, complete: false } };
/** T: the UTC day of the newest ledger of the network's other sets (the recorded `last_validated`), and the window of 30 days it gives (`windowOf`). */
const todayOf = (net: NetworkName): string => (JSON.parse(readFileSync(new URL(`${net}/data-api/last_validated.json`, HTTP), "utf8")) as { close_time: string }).close_time.slice(0, 10);
const collectionPathOf = (nft: { issuer: string; taxon?: number } | Json): string => (nft.taxon === undefined ? nft.issuer : `${nft.issuer}/${nft.taxon}`);

/** The pages of a list from its first query, each behind the marker of the one before: every page, and the rows of them all. */
function walkPages(net: NetworkName, path: string, query: string, list: string): { rows: Json[]; pages: Json[] } {
  const pages: Json[] = [];
  for (let marker: string | undefined; ; ) {
    const page = parsed(dataApiFile(net, path, `${query}${marker === undefined ? "" : `&marker=${marker}`}`)!);
    expect(page.count).toBe(page[list].length);
    pages.push(page);
    marker = page.marker;
    if (marker === undefined) return { rows: pages.flatMap((each) => each[list] as Json[]), pages };
  }
}

/** The marker the data API writes for a list's page: the base64url JSON of the key values of its last row. */
const markerOf = (...key: Array<string | number>): string => Buffer.from(JSON.stringify(key)).toString("base64url");

describe.each(NETS)("%s: the synthetic aggregates", (net) => {
  const world = worlds[net];
  const featuredNft = world.nfts.find((each) => each.id === world.featured)!.nft;
  const key = collectionPathOf(featuredNft);
  const T = todayOf(net);
  const window = windowOf(T, "30d");
  const collectionNfts = world.nfts.filter((each) => collectionPathOf(each.nft) === key);

  const walk = (path: string, query: string, list: string) => walkPages(net, path, query, list);

  it("the featured collection's sales include the derived sale, and its supply and holders match its NFT files", () => {
    const { collection } = parsed(dataApiFile(net, `/v2/nft_collections/${key}`, "")!);
    expect(collection).toMatchObject({ issuer: featuredNft.issuer, kind: featuredNft.kind });
    expect(collection.supply).toBe(collectionNfts.filter((each) => !each.nft.burned).length);
    expect(collection.holders).toBe(new Set(collectionNfts.filter((each) => !each.nft.burned && each.nft.owner !== undefined).map((each) => each.nft.owner)).size);
    const sale = derived[net].find((each) => each.id === world.featured)!.events.find((e) => e.event === "sale")!;
    const { rows, pages } = walk(`/v2/nft_collections/${key}/sales`, "descending=true&limit=20", "sales");
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((each) => each.tx_hash)).toContain(sale.tx_hash);
    expect(rows).toHaveLength(collection.sales_count);
  });

  it("the list pages concatenate to every collection once, in each sort's order, ties by issuer and taxon", () => {
    for (const sort of ["volume", "supply", "holders"] as const) {
      for (const ascending of [false, true]) {
        const { rows, pages } = walk("/v2/nft_collections", `limit=20&sort=${sort}${ascending ? "&descending=false" : ""}`, "collections");
        const label = `${sort} ${ascending ? "ascending" : "descending"}`;
        expect(pages.length, label).toBeGreaterThanOrEqual(net === "xrpl" ? 3 : 2);
        for (const page of pages) expect(page.total, label).toBe(rows.length);
        const keys = rows.map((row) => `${row.issuer}/${row.taxon ?? ""}`);
        expect(new Set(keys).size, label).toBe(rows.length);
        const value = (row: Json): number => Number(sort === "volume" ? row.volume_native : row[sort]);
        for (let at = 1; at < rows.length; at++) {
          const [a, b] = [rows[at - 1]!, rows[at]!];
          const order = ascending ? value(a) - value(b) : value(b) - value(a);
          const tie = a.issuer < b.issuer ? -1 : a.issuer > b.issuer ? 1 : (a.taxon ?? 0) - (b.taxon ?? 0);
          expect(order < 0 || (order === 0 && tie < 0), `${label} at ${at}`).toBe(true);
        }
        expect(keys, label).toContain(`${featuredNft.issuer}/${featuredNft.taxon ?? ""}`);
      }
    }
  });

  it("the live day row's total is the sum of its components' converted amounts, and count is at least their counts", () => {
    for (const period of ["day", "7day", "30day"]) {
      const { rows } = parsed(dataApiFile(net, "/v2/network/nft_volume", `live=${period}`)!);
      expect(rows).toHaveLength(1);
      const [row] = rows as Json[];
      const total = (row!.components as Json[]).reduce((sum, component) => sum.plus(component.converted_amount), new BigNumber(0));
      expect(row!.total, period).toBe(total.toFixed());
      expect(row!.count, period).toBeGreaterThanOrEqual((row!.components as Json[]).reduce((sum, component) => sum + component.count, 0));
    }
  });

  it("the stats days hold six quiet days, and days with several events that put the average and the lowest price to work", () => {
    const { days } = parsed(dataApiFile(net, `/v2/nft_collections/${key}/stats`, `end=${T}&start=${window.start}`)!) as { days: Json[] };
    expect(window.buckets).toHaveLength(30);
    const has = (bucket: string): boolean => days.some((day) => day.date === `${bucket}T00:00:00Z`);
    expect(window.buckets.filter((bucket) => !has(bucket))).toHaveLength(6);
    // the first and the last day of the window have a row, so the chart has bars at both ends
    expect([has(window.buckets[0]!), has(window.buckets.at(-1)!)]).toEqual([true, true]);

    // what the days must be made of, from the sales list alone: every sale of the collection, with and without a price in the native currency
    const sales = walk(`/v2/nft_collections/${key}/sales`, "descending=true&limit=20", "sales").rows;
    const prices = sales.filter((sale) => sale.converted_amount !== undefined).map((sale) => sale.converted_amount as string);
    expect(sales.length - prices.length).toBe(1);

    // an independent computation, in integers: millionths of the native currency (a price has at most six decimals), the average half up
    const micro = (text: string): bigint => {
      const [whole = "0", fraction = ""] = text.split(".");
      return BigInt(whole + fraction.padEnd(6, "0"));
    };
    const text = (millionths: bigint): string => `${millionths / 1_000_000n}.${String(millionths % 1_000_000n).padStart(6, "0")}`.replace(/\.?0+$/, "");
    const pairs = prices.flatMap((a, at) => prices.slice(at + 1).map((b) => [a, b] as const));

    // a day with two sales that both have a price: its volume is their sum, its lowest the smaller one and its average half their sum
    const doubled = days.filter((day) => day.sales_count === 2 && day.avg_price_native !== day.volume_native);
    expect(doubled).toHaveLength(2);
    for (const day of doubled) {
      const found = pairs.filter(([a, b]) => micro(a) + micro(b) === micro(day.volume_native));
      expect(found.length, day.date).toBeGreaterThanOrEqual(1);
      const [a, b] = found[0]!;
      expect(day.min_price_native, day.date).toBe(text(micro(a) < micro(b) ? micro(a) : micro(b)));
      expect(day.avg_price_native, day.date).toBe(text((micro(a) + micro(b) + 1n) / 2n));
      expect(day.min_price_native, day.date).not.toBe(day.avg_price_native);
    }
    // one of them has two sales of different prices and nothing else; the other has a mint too
    expect(doubled.map((day) => day.mints).sort()).toEqual([0, 1]);
    expect(doubled.every((day) => day.burns === 0)).toBe(true);

    // a day with a rated sale and an unrated one: two sales, the volume and the average and the lowest price are the one price's
    const mixed = days.filter((day) => day.sales_count === 2 && day.avg_price_native === day.volume_native);
    expect(mixed).toHaveLength(1);
    expect(prices).toContain(mixed[0]!.volume_native);
    expect(mixed[0]).toMatchObject({ avg_price_native: mixed[0]!.volume_native, min_price_native: mixed[0]!.volume_native, mints: 0, burns: 0 });

    // every other day with a sale has one, and no row is a day with nothing in it
    for (const day of days.filter((each) => !doubled.includes(each) && !mixed.includes(each))) expect(day.sales_count, day.date).toBeLessThanOrEqual(1);
    expect(days.filter((day) => day.sales_count === 0 && day.mints === 0 && day.burns === 0)).toHaveLength(0);
  });

  it("every synthetic file passes its shape check", () => {
    let checked = 0;
    for (const [path, text] of files) {
      if (!path.startsWith(`${net}/`) || !isAggregate(path)) continue;
      checkAggregateFile(path, JSON.parse(text));
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe.each(NETS)("%s: the aggregates agree with the NFT files and with each other", (net) => {
  const world = worlds[net];
  const T = todayOf(net);
  const window = windowOf(T, "30d");
  /** What the files give of every NFT of the world: its detail and its whole history, oldest first. */
  const fromFiles = world.nfts.map((each) => ({
    nft: parsed(dataApiFile(net, `/v2/nfts/${each.id}`, "")!).nft as Json,
    events: walkPages(net, `/v2/nfts/${each.id}/history`, "descending=true&limit=20", "events").rows.reverse(),
  }));
  const groups = new Map<string, typeof fromFiles>();
  for (const each of fromFiles) groups.set(collectionPathOf(each.nft), [...(groups.get(collectionPathOf(each.nft)) ?? []), each]);
  const listed = walkPages(net, "/v2/nft_collections", "limit=20&sort=volume", "collections").rows;
  const point = (e: Json) => ({ ledger_index: e.ledger_index, tx_hash: e.tx_hash, executed_time: e.executed_time });
  const sum = (values: Iterable<string>): string => [...values].reduce((total, value) => total.plus(value), new BigNumber(0)).toFixed();

  it("lists each collection of the NFT files as D3's aggregator counts it from their events, and every other collection in a shape that holds together", () => {
    expect(listed.length).toBeGreaterThan(groups.size);
    const byKey = new Map(listed.map((row) => [collectionPathOf(row), row]));
    for (const [key, nfts] of groups) {
      const events = nfts.flatMap((each) => each.events);
      const mints = events.filter((e) => e.event === "mint").sort((a, b) => a.ledger_index - b.ledger_index || a.tx_index - b.tx_index || a.event_index - b.event_index);
      const sales = events.filter((e) => e.event === "sale");
      const held = nfts.filter((each) => !each.nft.burned);
      expect(byKey.get(key), key).toEqual({
        issuer: nfts[0]!.nft.issuer,
        ...(nfts[0]!.nft.taxon !== undefined && { taxon: nfts[0]!.nft.taxon }),
        kind: nfts[0]!.nft.kind,
        supply: held.length,
        holders: new Set(held.flatMap((each) => (each.nft.owner === undefined ? [] : [each.nft.owner]))).size,
        minted: mints.length,
        burned: events.filter((e) => e.event === "burn").length,
        sales_count: sales.length,
        volume_native: sum(sales.flatMap((e) => (e.converted_amount === undefined ? [] : [e.converted_amount]))),
        ...(mints.length > 0 && { first_mint: point(mints[0]!), last_mint: point(mints.at(-1)!) }),
        last_ledger: Math.max(...events.map((e) => e.ledger_index)),
      });
    }
    for (const row of listed) {
      if (groups.has(collectionPathOf(row))) continue;
      expect(row.holders, collectionPathOf(row)).toBeLessThanOrEqual(row.supply);
      expect(row.kind).toBe(net === "xrpl" ? "nftoken" : "uritoken");
      expect(row.taxon === undefined).toBe(net === "xahau");
      expect("first_mint" in row).toBe("last_mint" in row);
      if (row.first_mint !== undefined) {
        expect(row.first_mint.ledger_index).toBeLessThanOrEqual(row.last_mint.ledger_index);
        expect(row.last_ledger).toBeGreaterThanOrEqual(row.last_mint.ledger_index);
        expect(row.minted).toBeGreaterThanOrEqual(row.supply);
      }
      if (row.sales_count === 0) expect(row.volume_native, collectionPathOf(row)).toBe("0");
    }
  });

  it("has ties to break: collections of one supply, one number of holders and a volume of 0", () => {
    for (const [value, sort] of [["supply", "supply"], ["holders", "holders"], ["volume_native", "volume"]] as const) {
      const counts = new Map<string, number>();
      for (const row of listed) counts.set(String(row[value]), (counts.get(String(row[value])) ?? 0) + 1);
      expect(Math.max(...counts.values()), sort).toBeGreaterThan(2);
    }
    expect(listed.some((row) => row.volume_native === "0")).toBe(true);
    expect(listed.some((row) => row.volume_native !== "0")).toBe(true);
  });

  it("marks each page of the list with the sort value, the issuer and the taxon of its last row", () => {
    for (const sort of ["volume", "supply", "holders"]) {
      for (const query of [`limit=20&sort=${sort}`, `descending=false&limit=20&sort=${sort}`]) {
        const { pages } = walkPages(net, "/v2/nft_collections", query, "collections");
        pages.slice(0, -1).forEach((page, at) => {
          const last = page.collections.at(-1) as Json;
          const value = sort === "volume" ? Number(last.volume_native) : last[sort];
          expect(page.marker, `${query} page ${at}`).toBe(markerOf(value, last.issuer, last.taxon ?? 0));
          expect(page.collections, query).toHaveLength(20);
        });
        expect(pages.at(-1)).not.toHaveProperty("marker");
      }
    }
  });

  it("filters the list by issuer: the featured NFT's issuer has the collections it has (two on XRPL, one on Xahau), another account none", () => {
    const featured = world.nfts.find((each) => each.id === world.featured)!.nft;
    const own = listed.filter((row) => row.issuer === featured.issuer);
    expect(own).toHaveLength(net === "xrpl" ? 2 : 1);
    for (const sort of ["volume", "supply", "holders"]) {
      for (const ascending of [false, true]) {
        const query = `issuer=${featured.issuer}&limit=20&sort=${sort}${ascending ? "&descending=false" : ""}`;
        const page = parsed(dataApiFile(net, "/v2/nft_collections", query)!);
        expect(page).toMatchObject({ total: own.length, count: own.length });
        expect(page.collections.map(collectionPathOf).sort()).toEqual(own.map(collectionPathOf).sort());
        expect(page).not.toHaveProperty("marker");
        const none = parsed(dataApiFile(net, "/v2/nft_collections", `issuer=${NFT_ACCOUNTS[net].unfunded}&limit=20&sort=${sort}${ascending ? "&descending=false" : ""}`)!);
        expect(none).toMatchObject({ total: 0, count: 0, collections: [] });
      }
    }
  });

  it("gives the three cases a page of their own: the collection, its stats, sales, NFTs (and with an owner) and holders, and no other collection one", () => {
    const pages = [...files.keys()].filter((path) => path.startsWith(`${net}/data-api/nft_collections/`) && !/@/.test(path.split("/").at(-1)!));
    expect(pages).toHaveLength(3);
    const sources = sourcesOf(net);
    const featured = resolveNftCase(net, "featured", sources);
    const details = new Map(pages.map((path) => [collectionPathOf(parsed(path).collection), parsed(path).collection as Json]));
    const found = Object.fromEntries((["featured", "quiet", "other"] as const).map((which) => [which, resolveCollectionCase(which, featured, details as never)]));
    expect(found.featured).toEqual({ issuer: featured!.issuer, ...(featured!.taxon !== undefined && { taxon: featured!.taxon }) });
    expect(new Set(Object.values(found).map((each) => collectionPathOf(each!))).size).toBe(3);
    expect(details.get(collectionPathOf(found.quiet!))!.sales_count).toBe(0);
    expect(details.get(collectionPathOf(found.other!))!.sales_count).toBeGreaterThan(0);
    for (const place of Object.values(found)) {
      const base = `/v2/nft_collections/${collectionPathOf(place!)}`;
      for (const [path, query] of [
        [base, ""],
        [`${base}/stats`, `end=${T}&start=${window.start}`],
        [`${base}/sales`, "descending=true&limit=20"],
        [`${base}/nfts`, "limit=20"],
        [`${base}/nfts`, `limit=20&owner=${NFT_ACCOUNTS[net].active}`],
        [`${base}/holders`, "limit=20"],
      ] as const) expect(files.has(dataApiFile(net, path, query)!), `${path}?${query}`).toBe(true);
    }
    // a case is found from the data alone: with no featured NFT there is no featured collection, with none unsold or none sold there is no quiet or other one
    expect(resolveCollectionCase("featured", undefined, details as never)).toBeUndefined();
    const sold = new Map([...details].map(([path, collection]) => [path, { ...collection, sales_count: 3 }]));
    expect(resolveCollectionCase("quiet", featured, sold as never)).toBeUndefined();
    expect(resolveCollectionCase("other", featured, new Map([...details].map(([path, collection]) => [path, { ...collection, sales_count: 0 }])) as never)).toBeUndefined();
    // the burned toggle is the featured collection's (it has a burned NFT); a collection's list has the NFTs of its own collection only, and the burned ones when asked
    const base = `/v2/nft_collections/${collectionPathOf(found.featured!)}`;
    const plain = walkPages(net, `${base}/nfts`, "limit=20", "nfts").rows;
    const withBurned = walkPages(net, `${base}/nfts`, "include_burned=true&limit=20", "nfts").rows;
    expect(plain.some((nft) => nft.burned)).toBe(false);
    expect(withBurned.filter((nft) => nft.burned)).toHaveLength(1);
    expect(withBurned.filter((nft) => !nft.burned)).toEqual(plain);
  });

  it("lists a collection's NFTs, owned NFTs and holders as its NFT files say, and its days add up to its totals", () => {
    const featured = world.nfts.find((each) => each.id === world.featured)!.nft;
    const key = collectionPathOf(featured);
    const base = `/v2/nft_collections/${key}`;
    const nfts = groups.get(key)!;
    const bySerial = (a: Json, b: Json): number => (a.serial ?? 0) - (b.serial ?? 0) || (a.nft_id < b.nft_id ? -1 : 1);
    const inList = (nft: Json): Json => (nft.last_sale === undefined ? nft : { ...nft, last_sale: Object.fromEntries(Object.entries(nft.last_sale).filter(([name]) => name !== "converted_amount")) });
    expect(walkPages(net, `${base}/nfts`, "limit=20", "nfts").rows).toEqual(nfts.map((each) => each.nft).filter((nft) => !nft.burned).sort(bySerial).map(inList));
    const active = NFT_ACCOUNTS[net].active;
    expect(walkPages(net, `${base}/nfts`, `limit=20&owner=${active}`, "nfts").rows).toEqual(nfts.map((each) => each.nft).filter((nft) => !nft.burned && nft.owner === active).sort(bySerial).map(inList));
    expect(walkPages(net, `${base}/nfts`, `limit=20&owner=${active}`, "nfts").rows.length).toBeGreaterThan(0);

    const holders = walkPages(net, `${base}/holders`, "limit=20", "holders").rows;
    const counted = new Map<string, number>();
    for (const { nft } of nfts) if (!nft.burned && nft.owner !== undefined) counted.set(nft.owner, (counted.get(nft.owner) ?? 0) + 1);
    expect(holders).toEqual([...counted].map(([owner, held]) => ({ owner, held })).sort((a, b) => b.held - a.held || (a.owner < b.owner ? -1 : 1)));

    for (const [path, group] of groups) {
      if (!files.has(dataApiFile(net, `/v2/nft_collections/${path}/stats`, `end=${T}&start=${window.start}`)!)) continue;
      const collection = parsed(dataApiFile(net, `/v2/nft_collections/${path}`, "")!).collection;
      const { days } = parsed(dataApiFile(net, `/v2/nft_collections/${path}/stats`, `end=${T}&start=${window.start}`)!);
      expect(days.map((day: Json) => day.date), path).toEqual([...days.map((day: Json) => day.date)].sort());
      for (const day of days as Json[]) {
        expect(window.buckets, path).toContain(day.date.slice(0, 10));
        expect(day.sales_count + day.mints + day.burns, `${path} ${day.date}: a row is a day with a sale, a mint or a burn`).toBeGreaterThan(0);
        if (day.avg_price_native !== undefined) expect(new BigNumber(day.min_price_native).isLessThanOrEqualTo(day.avg_price_native)).toBe(true);
      }
      expect(days.reduce((total: number, day: Json) => total + day.sales_count, 0), path).toBe(collection.sales_count);
      expect(sum(days.map((day: Json) => day.volume_native)), path).toBe(collection.volume_native);
      expect(days.reduce((total: number, day: Json) => total + day.mints, 0), path).toBe(collection.minted);
      expect(days.reduce((total: number, day: Json) => total + day.burns, 0), path).toBe(collection.burned);
      expect(group.length).toBeGreaterThan(0);
    }
  });

  it("lists the sales of the network and of the featured collection newest first, each sale once, from the sale events of the NFT files", () => {
    const everySale = fromFiles.flatMap((each) => each.events.filter((e) => e.event === "sale")).sort((a, b) => b.ledger_index - a.ledger_index || b.tx_index - a.tx_index || b.event_index - a.event_index);
    const toSale = (e: Json): Json => ({
      nft_id: e.nft_id, kind: e.kind, issuer: e.issuer, taxon: e.taxon, serial: e.serial, ledger_index: e.ledger_index, tx_index: e.tx_index, event_index: e.event_index, tx_hash: e.tx_hash,
      executed_time: e.executed_time, seller: e.from, buyer: e.to, mode: e.broker === undefined ? "direct" : "brokered", amount: e.amount, currency: e.currency, amount_issuer: e.amount_issuer,
      converted_amount: e.converted_amount, broker: e.broker, broker_fee: e.broker_fee, royalty_est: e.royalty_est,
    });
    const defined = (object: Json): Json => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
    const network = walkPages(net, "/v2/nft_sales", "descending=true&limit=20", "sales");
    expect(network.rows).toEqual(everySale.map((e) => defined(toSale(e))));
    expect(network.pages.length).toBe(2);
    expect(new Set(network.rows.map((sale) => `${sale.ledger_index}:${sale.tx_index}:${sale.event_index}`)).size).toBe(network.rows.length);
    // the first page of ten (the list page's), and the pages of twenty behind its marker (the older sales' page behind the list's "Older sales")
    const ten = parsed(dataApiFile(net, "/v2/nft_sales", "descending=true&limit=10")!);
    expect(ten.sales).toEqual(network.rows.slice(0, 10));
    expect(ten.marker).toBe(markerOf(ten.sales[9].ledger_index, ten.sales[9].tx_index, ten.sales[9].event_index));
    const behindTen = walkPages(net, "/v2/nft_sales", `descending=true&limit=20&marker=${ten.marker}`, "sales");
    expect(behindTen.rows).toEqual(network.rows.slice(10));
    const [first] = network.pages;
    expect(first.marker).toBe(markerOf(first.sales[19].ledger_index, first.sales[19].tx_index, first.sales[19].event_index));
    // the featured collection's sales: its own, and the first page the network's too, so that one marker serves both
    const featured = world.nfts.find((each) => each.id === world.featured)!.nft;
    const own = walkPages(net, `/v2/nft_collections/${collectionPathOf(featured)}/sales`, "descending=true&limit=20", "sales");
    expect(own.rows).toEqual(network.rows.filter((sale) => sale.issuer === featured.issuer && sale.taxon === featured.taxon));
    expect(own.pages[0]).toEqual(first);
    expect(own.pages[0].marker).toBe(first.marker);
    expect(own.pages).toHaveLength(2);
    // a sale that has no converted price is in the lists (the XRPlay and EVR sales), and a brokered one, the derived one, is too
    expect(network.rows.some((sale) => sale.converted_amount === undefined)).toBe(true);
    if (net === "xrpl") expect(network.rows.some((sale) => sale.mode === "brokered")).toBe(true);
    // the traded NFTs' sales are the newest of the network, each of the first twenty rows the featured collection's
    expect(first.sales.every((sale: Json) => sale.issuer === featured.issuer && sale.taxon === featured.taxon)).toBe(true);
  });

  it("is a volume whose rolling rows nest, whose days are the window's computed ones, and whose collections are the list's", () => {
    const live = Object.fromEntries(["day", "7day", "30day"].map((period) => [period, parsed(dataApiFile(net, "/v2/network/nft_volume", `live=${period}`)!).rows[0] as Json]));
    const head = Date.parse(JSON.parse(readFileSync(new URL(`${net}/data-api/last_validated.json`, HTTP), "utf8")).close_time) / 1000;
    const end = Math.floor(head / 60) * 60;
    for (const [period, days] of [["day", 1], ["7day", 7], ["30day", 30]] as const) {
      expect(live[period]).toMatchObject({ exchange: { currency: net === "xrpl" ? "XRP" : "XAH" }, exchange_rate: "1.0000000", start_time: isoTime(end - days * 86_400), end_time: isoTime(end) });
    }
    const amountOf = (row: Json, component: Json): string => (row.components as Json[]).find((each) => collectionPathOf(each) === collectionPathOf(component))?.amount ?? "0";
    for (const [narrow, wide] of [["day", "7day"], ["7day", "30day"]]) {
      expect(live[wide]!.count).toBeGreaterThanOrEqual(live[narrow]!.count);
      expect(new BigNumber(live[wide]!.total).isGreaterThanOrEqualTo(live[narrow]!.total)).toBe(true);
      for (const component of live[narrow]!.components as Json[]) expect(new BigNumber(amountOf(live[wide]!, component)).isGreaterThanOrEqualTo(component.amount)).toBe(true);
    }
    const daily = parsed(dataApiFile(net, "/v2/network/nft_volume", `end=${T}&interval=day&limit=1000&start=${window.start}`)!);
    // the running day is not computed yet (the newest ledger closes after 01:00 UTC), so its row is not there: the window's other 29 are
    expect(daily.rows.map((row: Json) => row.start_time.slice(0, 10))).toEqual(window.buckets.slice(0, -1));
    expect(daily.count).toBe(daily.rows.length);
    const known = new Set(listed.map(collectionPathOf));
    for (const row of [...daily.rows, ...Object.values(live)] as Json[]) {
      const where = `${row.start_time} to ${row.end_time}`;
      const converted = (row.components as Json[]).map((component) => component.converted_amount as string);
      expect(row.total, where).toBe(sum(converted));
      expect(converted.map(Number), where).toEqual([...converted.map(Number)].sort((a, b) => b - a));
      for (const component of row.components as Json[]) {
        expect(known.has(collectionPathOf(component)), `${where}: ${collectionPathOf(component)} is a collection of the list`).toBe(true);
        expect(component).toMatchObject({ rate: "1.0000000" });
        expect(component.amount).toBe(component.converted_amount);
      }
      expect(row.count, where).toBeGreaterThanOrEqual((row.components as Json[]).reduce((total, component) => total + component.count, 0));
    }
    // a sale in an issued currency is in the count of its row and in no component: some row has more sales than its components count
    expect(([...daily.rows, ...Object.values(live)] as Json[]).some((row) => row.count > row.components.reduce((total: number, component: Json) => total + component.count, 0))).toBe(true);
    // the collections' own totals are at least what the window shows of them: the volume is a view, not a part, of the lists
    for (const row of daily.rows as Json[]) expect(Date.parse(row.end_time) - Date.parse(row.start_time)).toBe(86_400_000);
  });
});

describe("the feature's coverage", () => {
  it("Xahau's coverage is incomplete and XRPL's complete, on every aggregate, every account's NFT list and the mock's empty page", async () => {
    for (const net of NETS) {
      const mine = [...files].filter(([path]) => path.startsWith(`${net}/`) && (isAggregate(path) || kindOf(path) === "account"));
      expect(mine.length).toBeGreaterThan(30);
      for (const [path, text] of mine) expect(JSON.parse(text).coverage, path).toEqual(FEATURE_COVERAGE[net]);
      expect(featureCoverage(net)).toEqual(FEATURE_COVERAGE[net]);
      const upstream = createUpstream({
        files: { read: async () => undefined },
        bases: { xrpl: { dataApi: "https://xrpl.data.example.invalid", node: "https://s1.ripple.com:51234/" }, xahau: { dataApi: "https://xahau.data.example.invalid", node: "https://xahau.network/" } },
        primary: net,
      });
      const response = await upstream.handle(new Request(`https://${net}.data.example.invalid/v2/accounts/${NFT_ACCOUNTS[net].unfunded}/nfts?limit=20`, { headers: { "X-API-Key": "k" } }));
      expect(((await response!.json()) as Json).coverage).toEqual(FEATURE_COVERAGE[net]);
    }
    // Xahau's starts where the recordings do, and a per-NFT file keeps D3's item rule over the recorded world: the first recorded ledger, whatever the network's feature says
    expect(FEATURE_COVERAGE.xahau.from_ledger_index).toBe(worlds.xahau.from);
    for (const net of NETS) {
      for (const each of worlds[net].nfts) expect(parsed(dataApiFile(net, `/v2/nfts/${each.id}`, "")!).coverage, each.id).toEqual({ from_ledger_index: worlds[net].from, complete: each.events[0]!.event === "mint" });
    }
  });
});

describe("encodeNftId", () => {
  it("is the inverse of decodeNftId, taking the product of the scramble exactly", () => {
    for (const fields of [
      { flags: 8, transferFee: 5000, issuer: NFTS.soldBySellOffer.issuer, taxon: 10, serial: 95234705 },
      { flags: 0, transferFee: 0, issuer: NFTS.mint.issuer, taxon: 0, serial: 0 },
      { flags: 0xffff, transferFee: 50000, issuer: NFTS.brokered.issuer, taxon: 4294967295, serial: 4294967295 },
    ]) {
      const decoded = decodeNftId(encodeNftId(fields));
      expect(decoded).toMatchObject({ flags: fields.flags, transferFee: fields.transferFee, issuer: fields.issuer, taxon: fields.taxon, serial: fields.serial });
    }
  });
});
