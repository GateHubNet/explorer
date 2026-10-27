// Small, valid answers of the NFT routes of the data API (D3), and of the node's NFT commands, for the tests of the client (test/worker/data-api.spec.ts,
// test/worker/node-rpc.spec.ts) and of its shape checks (app/server/nft-shape.test.ts). XRPL values, in the shapes of data-api-new/docs/api-reference.md at
// feat/explorer-data-2 da5ce14, "NFTs" (the reference's own examples are the model: real answers over the recorded mainnet ledgers, with addresses that exist), and of the
// node's answers of 2026-10-24 (Clio's `nft_info` of s1.ripple.com, xahaud's `ledger_entry` of xahau.network). Each sample is `(over?) => T`: a new object on every call,
// with a shallow override. A test that needs a case the sample does not have builds it from the sample.
//
// Not for `app/`, and not the fixtures of the e2e suite (scripts/ makes those). The types are api-types.ts's, so that a sample that stopped being what the reference
// promises, or a type that did, fails `pnpm typecheck`. An answer sample has `result: "success"` before `coverage`, as the API writes it; the types leave that key out.

import type {
  Coverage,
  Nft,
  NftAnswer,
  NftCollection,
  NftCollectionAnswer,
  NftCollectionDay,
  NftCollectionDays,
  NftCollectionsPage,
  NftEvent,
  NftEventsPage,
  NftHolder,
  NftHoldersPage,
  NftOffer,
  NftOffersPage,
  NftSale,
  NftSalesPage,
  NftsPage,
  NftVolume,
  NftVolumeRow,
  NodeNftInfo,
  NodeUriToken,
} from "../../app/server/api-types";

/** An NFT of the recorded mainnet ledgers: its issuer (taxon 10), the account that holds it, the one that sold it, a broker, the sale's transaction and its offer. */
export const NFT_ID = "00081388EA968E3C54EE59C8FFBAF0944A3B8AD4797AB032EF22952605AD2A91";
export const NFT_ISSUER = "r4PP7gwuVfxzLPWFiJXjLUtvzA7F97CzT3";
export const NFT_OWNER = "rnKd8CYrXwMoGn4R48onJGLShh1PcrFrTx";
export const NFT_SELLER = "rhv9jFwfWfH4Cd1uX4b3ACkdgDKASFz7Dz";
export const NFT_BROKER = "rpx9JThQ2y37FaGeeJP7PXDUVEXY3PHZSC";
export const NFT_TX_HASH = "BADF36AA20CD32067693C83EE5755BEFB8D1A1E82DEE83E1E67FFD6100712E56";
export const NFT_OFFER_ID = "D6DBB6452D44459FDA013C79708D2E699EA2340D5444AC1695FF621A80FDFBDE";
/** Another collection's issuer, and an NFT of it (taxon 0). */
export const OTHER_ISSUER = "rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy";
export const OTHER_NFT_ID = "00190BB8DAEF366CB05EE8DCC919EF9A1AA24DD22B3D62C9D848920A0669E96F";
/** A URIToken of Xahau, and its issuer, which is its collection. */
export const URI_TOKEN_ID = "9613336614047483F3AEC00173139D88FE9BA70720CAC2B46E12711A71A9AAE9";
export const URI_TOKEN_ISSUER = "rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb";
export const URI_TOKEN_OWNER = "rBkEp8W1yhBGLrvHFKKyrmSvniMFVJbPPg";
/** A marker, as the API writes one: base64url. */
export const NFT_MARKER = "WzEwNzg3ODc3NSwxMDQsMV0";

/** What an answer is of: the index starts at the first recorded ledger, so it is not whole. */
export const coverageSample = (over: Partial<Coverage> = {}): Coverage => ({ from_ledger_index: 107874617, complete: false, ...over });

/** An answer: `result` before the rest, as the API writes it. */
type Body<T> = { result: "success" } & T;

// ---- The objects -----------------------------------------------------------------------------------------------------------------------------------------------

/** `GET /v2/nfts/{nft_id}`: an NFT held by `NFT_OWNER`, bought for 10 XRP, its mint before the first indexed ledger. */
export const nftSample = (over: Partial<Nft> = {}): Nft => ({
  nft_id: NFT_ID,
  kind: "nftoken",
  issuer: NFT_ISSUER,
  taxon: 10,
  serial: 95234705,
  flags: 8,
  transfer_fee: 5000,
  owner: NFT_OWNER,
  owner_since: { ledger_index: 107874617, tx_hash: NFT_TX_HASH, executed_time: "2026-10-24T16:08:12Z" },
  burned: false,
  sale_count: 1,
  last_sale: {
    amount: "10",
    currency: "XRP",
    converted_amount: "10",
    ledger_index: 107874617,
    tx_hash: NFT_TX_HASH,
    executed_time: "2026-10-24T16:08:12Z",
  },
  ...over,
});

/** A URIToken of Xahau: no taxon, serial or transfer fee, and a digest; sold for 4200 XAH. */
export const uriTokenSample = (over: Partial<Nft> = {}): Nft => ({
  nft_id: URI_TOKEN_ID,
  kind: "uritoken",
  issuer: URI_TOKEN_ISSUER,
  flags: 0,
  owner: URI_TOKEN_OWNER,
  owner_since: { ledger_index: 26763778, tx_hash: "01772F1C2E379A2213EDDFF939ABB3FE59C2B309244EC442EA1515761605C20C", executed_time: "2026-10-24T15:36:02Z" },
  digest: "772B38763E8E603AEE9BBB2026B8E9B97537ECC8867E46D042630C0B326B8736",
  burned: false,
  sale_count: 1,
  last_sale: {
    amount: "4200",
    currency: "XAH",
    converted_amount: "4200",
    ledger_index: 26763778,
    tx_hash: "01772F1C2E379A2213EDDFF939ABB3FE59C2B309244EC442EA1515761605C20C",
    executed_time: "2026-10-24T15:36:02Z",
  },
  ...over,
});

/** The brokered sale of the reference's history example, with every key an event can have for a sale. */
export const nftEventSample = (over: Partial<NftEvent> = {}): NftEvent => ({
  nft_id: OTHER_NFT_ID,
  kind: "nftoken",
  issuer: OTHER_ISSUER,
  taxon: 0,
  serial: 107604335,
  ledger_index: 107879497,
  tx_index: 49,
  event_index: 2,
  tx_hash: "0FD0FDC75F37C1B1CCA1DE4517785B35422E3C81D6543ADA094B04A5DBC7E56C",
  tx_type: "NFTokenAcceptOffer",
  executed_time: "2026-10-24T21:30:41Z",
  event: "sale",
  account: NFT_BROKER,
  from: "rfivr3BK17R28wnVwpQQhSDvo2A2fmnEje",
  to: "rLCscV9iDJpvje4ZCKxGjYAMNtBA1Ltauk",
  offer_id: "05BC61CFB58ABA8969C852FBF907CC687A442AD3ED64FB30EA41149ECD0F6780",
  is_sell_offer: true,
  amount: "150",
  currency: "XRP",
  converted_amount: "150",
  broker: NFT_BROKER,
  broker_fee: "2.3835",
  royalty_est: "4.428495",
  ...over,
});

/** The first sale of the reference's `GET /v2/nft_sales` example: direct, 10 XRP, a 5% royalty to the issuer. */
export const nftSaleSample = (over: Partial<NftSale> = {}): NftSale => ({
  nft_id: NFT_ID,
  kind: "nftoken",
  issuer: NFT_ISSUER,
  taxon: 10,
  serial: 95234705,
  ledger_index: 107874617,
  tx_index: 299,
  event_index: 1,
  tx_hash: NFT_TX_HASH,
  executed_time: "2026-10-24T16:08:12Z",
  seller: NFT_SELLER,
  buyer: NFT_OWNER,
  mode: "direct",
  amount: "10",
  currency: "XRP",
  converted_amount: "10",
  royalty_est: "0.5",
  ...over,
});

/** A bid for `000813886E50B2960CF48DCB644E85B412C660B4E1B01A87C283F9E6066AB54B`, open to one account until 05:22 UTC. */
export const nftOfferSample = (over: Partial<NftOffer> = {}): NftOffer => ({
  offer_id: "3CD49EC73A6F77B3D365B97FEAC58825EE08F1342C25BBD53A6B34062E242A2E",
  is_sell_offer: false,
  owner: "rMTaAGVd77vAbzDv8qhoMgnZR1T5R3w6Wq",
  amount: "6.29",
  currency: "XRP",
  destination: NFT_BROKER,
  expiration: "2026-10-25T05:22:08Z",
  created_ledger: 107886233,
  created_tx_hash: "8909E8347369B44ABBF43928670913097FC97C946D695F5DC17939759DBDD03E",
  created_time: "2026-10-25T04:52:11Z",
  ...over,
});

/** The collection of an issuer and a taxon: one NFT, held by one account, sold once for 10 XRP. */
export const collectionSample = (over: Partial<NftCollection> = {}): NftCollection => ({
  issuer: NFT_ISSUER,
  taxon: 10,
  kind: "nftoken",
  supply: 1,
  holders: 1,
  minted: 0,
  burned: 0,
  sales_count: 1,
  volume_native: "10",
  last_ledger: 107874617,
  ...over,
});

/** The collection of a Xahau issuer: no taxon, and its mints in the index. */
export const uriTokenCollectionSample = (over: Partial<NftCollection> = {}): NftCollection => ({
  issuer: URI_TOKEN_ISSUER,
  kind: "uritoken",
  supply: 5,
  holders: 3,
  minted: 1,
  burned: 0,
  sales_count: 1,
  volume_native: "4200",
  first_mint: { ledger_index: 26689211, tx_hash: "3D9B20E130D7498E98FB3499BD4C2AC4CCDB3D11FFBFEA8F9B7FB844DDF33426", executed_time: "2026-10-21T13:29:11Z" },
  last_mint: { ledger_index: 26689211, tx_hash: "3D9B20E130D7498E98FB3499BD4C2AC4CCDB3D11FFBFEA8F9B7FB844DDF33426", executed_time: "2026-10-21T13:29:11Z" },
  last_ledger: 26771798,
  ...over,
});

/** The day of the reference's `/stats` example: one sale of 10 XRP. */
export const collectionDaySample = (over: Partial<NftCollectionDay> = {}): NftCollectionDay => ({
  date: "2026-10-24T00:00:00Z",
  sales_count: 1,
  volume_native: "10",
  avg_price_native: "10",
  min_price_native: "10",
  mints: 0,
  burns: 0,
  ...over,
});

export const holderSample = (over: Partial<NftHolder> = {}): NftHolder => ({ owner: NFT_OWNER, held: 1, ...over });

/** The live row of the reference's `GET /v2/network/nft_volume?live=day` example: three collections, four sales (one in an asset with no rate). */
export const nftVolumeRowSample = (over: Partial<NftVolumeRow> = {}): NftVolumeRow => ({
  components: [
    { issuer: OTHER_ISSUER, taxon: 0, count: 1, amount: "150", rate: "1.0000000", converted_amount: "150" },
    { issuer: NFT_ISSUER, taxon: 10, count: 1, amount: "10", rate: "1.0000000", converted_amount: "10" },
    { issuer: "rDeizxSRo6JHjKnih9ivpPkyD2EgXQvhSB", taxon: 26, count: 1, amount: "0.000001", rate: "1.0000000", converted_amount: "0.000001" },
  ],
  count: 4,
  exchange: { currency: "XRP" },
  total: "160.000001",
  exchange_rate: "1.0000000",
  start_time: "2026-10-24T04:52:12Z",
  end_time: "2026-10-25T04:52:12Z",
  ...over,
});

// ---- The answers -----------------------------------------------------------------------------------------------------------------------------------------------

export const nftAnswerSample = (over: Partial<NftAnswer> = {}): Body<NftAnswer> => ({ result: "success", coverage: coverageSample(), nft: nftSample(), ...over });

export const nftEventsPageSample = (over: Partial<NftEventsPage> = {}): Body<NftEventsPage> => ({
  result: "success",
  coverage: coverageSample(),
  count: 1,
  events: [nftEventSample()],
  ...over,
});

export const nftOffersPageSample = (over: Partial<NftOffersPage> = {}): Body<NftOffersPage> => ({
  result: "success",
  coverage: coverageSample(),
  count: 1,
  offers: [nftOfferSample()],
  ...over,
});

/** An account's NFTs, or a collection's: the sample NFT, and the page behind it. */
export const nftsPageSample = (over: Partial<NftsPage> = {}): Body<NftsPage> => ({
  result: "success",
  coverage: coverageSample(),
  count: 1,
  marker: NFT_MARKER,
  nfts: [nftSample()],
  ...over,
});

export const nftSalesPageSample = (over: Partial<NftSalesPage> = {}): Body<NftSalesPage> => ({
  result: "success",
  coverage: coverageSample(),
  count: 1,
  marker: NFT_MARKER,
  sales: [nftSaleSample()],
  ...over,
});

export const nftHoldersPageSample = (over: Partial<NftHoldersPage> = {}): Body<NftHoldersPage> => ({
  result: "success",
  coverage: coverageSample(),
  count: 1,
  holders: [holderSample()],
  ...over,
});

export const nftCollectionsPageSample = (over: Partial<NftCollectionsPage> = {}): Body<NftCollectionsPage> => ({
  result: "success",
  coverage: coverageSample(),
  total: 25,
  count: 1,
  marker: "WzEwLCJyNFBQN2d3dVZmeHpMUFdGaUpYakxVdHZ6QTdGOTdDelQzIiwxMF0",
  collections: [collectionSample()],
  ...over,
});

export const nftCollectionAnswerSample = (over: Partial<NftCollectionAnswer> = {}): Body<NftCollectionAnswer> => ({
  result: "success",
  coverage: coverageSample(),
  collection: collectionSample(),
  ...over,
});

export const nftCollectionDaysSample = (over: Partial<NftCollectionDays> = {}): Body<NftCollectionDays> => ({
  result: "success",
  coverage: coverageSample(),
  count: 1,
  days: [collectionDaySample()],
  ...over,
});

/** `nft_volume` of a rolling period (one row), or of days (`rows` as many as there are). */
export const nftVolumeSample = (over: Partial<NftVolume> = {}): Body<NftVolume> => ({
  result: "success",
  coverage: coverageSample(),
  count: 1,
  rows: [nftVolumeRowSample()],
  ...over,
});

// ---- The node's answers ------------------------------------------------------------------------------------------------------------------------------------------

/** The NFT of Clio's `nft_info` answer of 2026-10-24: issuer `rGxWAWXg8okZh29ojBRvEMpN5peQRV16Xu`, taxon 500, serial 106293080, a 5% transfer fee, a URI of `ipfs://…/96.json`. */
export const NODE_NFT_ID = "00081388AF09C1D4B4D1E8031467F3508DFFADABEA73255FA9ECC9070655E758";

/** What the reader makes of that answer (the node's own has `validated` and `status` besides). */
export const nodeNftInfoSample = (over: Partial<NodeNftInfo> = {}): NodeNftInfo => ({
  nft_id: NODE_NFT_ID,
  ledger_index: 107671930,
  owner: "rfxioGqxazNZt3sbeVSZtziEQBHHJAXXjE",
  is_burned: false,
  flags: 8,
  transfer_fee: 5000,
  issuer: "rGxWAWXg8okZh29ojBRvEMpN5peQRV16Xu",
  nft_taxon: 500,
  nft_serial: 106293080,
  uri: "697066733A2F2F6261667962656963696A356672347537666F79756235376E7A6764736D66646B766B796D336F6C793363746D32736C6335636671793337716F6F792F39362E6A736F6E",
  ...over,
});

/** What the reader makes of the `URIToken` entry that xahau.network answered `ledger_entry` with on 2026-10-24 (its `Remarks` are not read). */
export const nodeUriTokenSample = (over: Partial<NodeUriToken> = {}): NodeUriToken => ({
  index: URI_TOKEN_ID,
  ledger_index: 26829859,
  Owner: "rLEUHuVCd8o9XmKn3nk8oGwYS3QEpUjo3e",
  Issuer: URI_TOKEN_ISSUER,
  URI: "6F64696E73657965733A726176656E3A76323A3030346230353234",
  Digest: "772B38763E8E603AEE9BBB2026B8E9B97537ECC8867E46D042630C0B326B8736",
  Flags: 0,
  ...over,
});
