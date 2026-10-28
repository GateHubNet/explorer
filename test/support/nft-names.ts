// The NFT pages' fixtures (README "NFTs", "Upstream fixtures") as the Playwright process names them: the generated NFTs of test/fixtures/http/*/data-api/nfts and the nodes' NFT
// answers. Each is the case of test/support/nft-case-rules.ts that its name says, which the Worker's specs find in the files by those rules; the Playwright process cannot read the files
// the way Vite does, so the ids are written here, and test/worker/nft-fixtures.spec.ts ("the e2e suite's constants") fails when a regeneration moves one of them. Pure data, no
// environment: that spec imports this file too.

/** An NFT of each case the NFT page draws (`NftCase`): `featured` has two pages of history and one sale, `unowned` an owner only the node can say, `network` and `networkBurned` are the node's alone. */
export const XRPL_NFT = {
  featured: "00190BB8DAEF366CB05EE8DCC919EF9A1AA24DD22B3D62C9D848920A0669E96F",
  burned: "0019000040FEFE9E7C73D4F8A4DC7A7A09DD13B724827F9442666327061B0D8C",
  unowned: "000813886E50B2960CF48DCB644E85B412C660B4E1B01A87C283F9E6066AB54B",
  network: "00010000397CCDAB554D69B034DBB4042C29C6B714F0504560FB4B5105E502FD",
  networkBurned: "00091388AF09C1D4B4D1E8031467F3508DFFADABEA73255F982A735A0655E613",
  missing: "00190BB8DAEF366CB05EE8DCC919EF9A1AA24DD22B3D62C9EF2E630B0669E970",
} as const;
/** The same on Xahau, whose URITokens are no ledger entry once burned: there is no `networkBurned`. */
export const XAHAU_NFT = {
  featured: "9613336614047483F3AEC00173139D88FE9BA70720CAC2B46E12711A71A9AAE9",
  burned: "F636CA189EF358200F80EE78744EB5876224B2F0A8F3DC97BC36A325DA4D3C46",
  unowned: "35B8D52858E0463C0F0FCCC73EFBE1D308F0AF71112035C4D45777EB9115E93D",
  network: "06CF2C55017B289AA55FAFBE2AED6BC481568B7828910F89FADF6F23A95D85AD",
  missing: "9613336614047483F3AEC00173139D88FE9BA70720CAC2B46E12711A71A9AAE8",
} as const;

/** A collection of each case (`CollectionCase`): the featured NFT's, one nothing was ever sold in, and a third that has sales (Xahau's has one sale that no daily rate converts: its stats say "none with a daily XAH rate"). */
export const XRPL_COLLECTION = {
  featured: { issuer: "rLxc1bt5defiLJ9gaZEJqQWnNKYNawrwMy", taxon: 0 },
  quiet: { issuer: "ravC5cZreMZuKEWSrpra5nkWnfzPmrabec", taxon: 0 },
  other: { issuer: "r4PP7gwuVfxzLPWFiJXjLUtvzA7F97CzT3", taxon: 10 },
} as const;
export const XAHAU_COLLECTION = {
  featured: { issuer: "rodinGM9xiKq7rDDnLPyieREkqGJ6zKyb" },
  quiet: { issuer: "r4k1jdyThSDbPwbNrpiuqNCoRJ61y9N4Wj" },
  other: { issuer: "rNk6oeGA4BKsCraCEMg2g5YkbegcXFtPGV" },
} as const;

/** The NFTokenAcceptOffer of transaction.spec.ts and the NFT it accepted: the transaction page's link leads to that NFT's page, which no NFT file holds (the page is a 404 of its own). */
export const NFT_ACCEPT_OFFER = "423839F3B288D53874DAECE9AE3ACCE2A23E20E2C16E5DA594F425907D9E2052";
export const NFT_ACCEPTED = "00081388AF09C1D4B4D1E8031467F3508DFFADABEA73255F370449870655E6D8";
