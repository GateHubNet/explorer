// The issuances and the recorded transactions of the MPT fixtures (scripts/mpt-fixtures.ts), written out: pure, literal IDs and hashes with nothing from `scripts/`, `app/` or the file system in it,
// so that the Worker specs, the unit tests, the generator and the end-to-end suite alike can name them (a Worker spec cannot import `scripts/`, which reads files; the end-to-end project lists
// this file, and its helper reads the fixture files itself). `scripts/mpt-fixtures.ts` imports it and re-exports it, and test/unit/mpt-fixtures.test.ts pins every literal against the generator
// and the recordings: the made-up IDs are the IDs of seeded issuers and sequences, the recorded ones are those of D9's manifest.
//
// The ten issuances (XRPL; Xahau has none):
//
//   htf             the recorded `issuance_create` (XAU, "Tokenized Gold (XAU)"; 63 holders over two pages of holders, one locked and one with escrow, and 28 transfers of every kind)
//   shortKeys       the recorded `issuance_create_short_keys` (metadata in XLS-89's short keys, a transfer fee of 5%)
//   noMetadata      made up: no metadata, no ticker, no name
//   rawMetadata     made up: metadata that is not JSON (a URL as text), so it does not decode and does not conform
//   nonConforming   made up: metadata that decodes and does not conform, with the longest texts an issuer can write
//   destroyed       made up: destroyed, no holders
//   lockedAll       made up: every balance locked by the issuer
//   escrow          made up: HTF, "Harborline Treasury Fund", with escrowed amounts; its answers say the coverage is not complete
//   nodeOnly        made up: no answer of the index, only the node's `ledger_entry` (and the active account's `account_objects`): the index lacks it, the page falls back to the node
//   nowhere         made up: no answer anywhere, not even the node's
//
// and the nine recorded transactions (D9's manifest `cases`; the file names its ledger and hash).

export const MPT_FIXTURE_IDS = {
  htf: "03F907F270631F5CC5E1A2E556F42D017F52CEE7EA30AF80",
  shortKeys: "05AC2E9BD957F450A34D46B9F70983D04DB415D20EC3A1DF",
  noMetadata: "063CE265100CDE164FCDC230295289E54EC83FB8069F8190",
  rawMetadata: "06317180FEDED5FDB0AD570C07A3C70FB8C73C6D01EBB3D9",
  nonConforming: "064566B45FFD9F400BCAB0E855C8E6B21ED11C5418D3970F",
  destroyed: "05FD87AC5F2F37D1CCC5A00C1D7F966B4630E931F5B3A752",
  lockedAll: "056533FBD134390DB03F8D2B50A622C9C9063697920D2062",
  escrow: "05A2797960352D719D5E3750339599019B1D381BBBFAE058",
  nodeOnly: "05F2B2597438324FE86D08A8B9D4FB58FBABF72EAAD24B44",
  nowhere: "0596818DFF26852BE4B424F1BB107D2B79C11E89CC2663BC",
} as const;

export const MPT_RECORDED = {
  issuance_create: { ledger: 99337721, hash: "68D137B937AE7C6EF558DBDDC307B3BC6FADEB3C2F038DDAA3D36BF93C1FDF9E" },
  issuance_create_short_keys: { ledger: 106427568, hash: "B95BDC99AF0F038B7B60FC60BE5C70BCD87F5182C68E6BF97F996739E6CEAEA1" },
  payment_mint: { ledger: 105827909, hash: "4D9BB2A0B0289D36A995B10AB17D5BE9B19E961B777AFDE29D84CC59384E74F6" },
  payment_transfer_fee: { ledger: 99251687, hash: "80C74925827B059CA14F2C7C4E01F8DE37C5502648CE20DE90B35827E73D503E" },
  issuance_set_lock_holder: { ledger: 107211753, hash: "C166A16A2188E5BBD9EE2D73BEE9798515027FF894F5FBA91FA01BE5819F8EC3" },
  authorize_holder: { ledger: 105827852, hash: "B9DEF907D9D931A316C89EAB3278EC8C55AFFF86BDBFF475188A537AE1426530" },
  clawback_full: { ledger: 105916048, hash: "01D099632560B0D854D1843A064E61148AD5A131A4866279D0AB8CF9ACF71D6B" },
  escrow_create: { ledger: 107211745, hash: "4DFC30E6EE88AF6CE5718368A5F599158809E05584AF86C2E8E8101229A50523" },
  clawback_issued: { ledger: 85885429, hash: "C2071343FB6CB00E495F50BD319B773D7461435E5B19F8EF0E1E2AF2853824D8" },
} as const satisfies Record<string, { ledger: number; hash: string }>;
