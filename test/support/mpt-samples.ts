// Small, valid answers of D9's MPT routes (an issuance, its holders and its transfers, the lookup of several issuances and the MPT list of the token tab) for the tests of the client
// (test/worker/data-api.spec.ts) and of its shape checks (app/server/mpt-shape.test.ts). XRPL values, in the shapes of the examples of D9's spec section 7 (data-api `feat/explorer-data-2` at
// c9a2fc0ffd41b3ad7e5b78fbb73b220f38700f30), with IDs and addresses that exist: the issuance is `HTF`, "Harborline Treasury Fund". Each sample is `(over?) => T`: a new object on every call,
// with a shallow override. A test that needs a case the sample does not have builds it from the sample.
//
// Not for `app/`, and not the fixtures of the e2e suite (scripts/mpt-fixtures.ts makes those). The types are api-types.ts's, so that a sample that stopped being what the reference promises,
// or a type that did, fails `pnpm typecheck`. An answer sample has `result: "success"` before `coverage`, as the API writes it (the types leave that key out, so the samples are typed
// `T & { result: "success" }`).

import { mptIdOf } from "../../app/domain/mpt-id";
import type {
  Coverage,
  MptFlags,
  MptHolder,
  MptHoldersPage,
  MptIssuance,
  MptIssuanceAnswer,
  MptLookup,
  MptSummary,
  MptTokenRow,
  MptTokensPage,
  MptTransfer,
  MptTransfersPage,
} from "../../app/server/api-types";

/** The issuer of the samples' issuance, and two accounts that hold it. */
export const MPT_SAMPLE_ISSUER = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
export const MPT_SAMPLE_HOLDER = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
export const MPT_SAMPLE_OTHER_HOLDER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
/** `HTF`'s ID: the issuance of the sequence 298 of the issuer. */
export const MPT_SAMPLE_ID = mptIdOf(298, MPT_SAMPLE_ISSUER);
/** Two more issuances, in sorted order after `HTF`'s (sequence 299 and 300), for a lookup and a list of three. */
export const MPT_SAMPLE_SECOND_ID = mptIdOf(299, MPT_SAMPLE_ISSUER);
export const MPT_SAMPLE_THIRD_ID = mptIdOf(300, MPT_SAMPLE_ISSUER);
/** A transaction hash of the transfers. */
export const MPT_SAMPLE_HASH = "A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90";
/** A marker as a list writes one (the base64url of the key of its last row). */
export const MPT_HOLDERS_MARKER = "WyI2MTIwNDAwMDAiLCJyQmJXNmlkQWlkelVKdWs3NkZZcXIzNDdQYng5b1c1amgiXQ";
export const MPT_TRANSFERS_MARKER = "WzEwNzc5NTQxMCwzMV0";

/** The coverage of every answer but the lookup's: the index holds MPT since the ledger MPTokensV1 was enabled in. */
export const mptCoverageSample = (over: Partial<Coverage> = {}): Coverage => ({ from_ledger_index: 99226369, complete: true, ...over });

/** HTF's flags: it can lock, requires authorization, can trade and transfer, and can claw back; it cannot escrow, and no balance is locked. */
export const mptFlagsSample = (over: Partial<MptFlags> = {}): MptFlags => ({
  locked: false,
  can_lock: true,
  require_auth: true,
  can_escrow: false,
  can_trade: true,
  can_transfer: true,
  can_clawback: true,
  ...over,
});

/** `HTF`, in full, with the metadata D9 decoded (XLS-89's long keys, in D9's order). */
export const mptIssuanceSample = (over: Partial<MptIssuance> = {}): MptIssuance => ({
  mpt_issuance_id: MPT_SAMPLE_ID,
  issuer: MPT_SAMPLE_ISSUER,
  sequence: 298,
  ticker: "HTF",
  name: "Harborline Treasury Fund",
  asset_scale: 2,
  maximum_amount: "5000000000",
  outstanding_amount: "1820451120",
  escrowed_amount: "0",
  locked_amount: "124000000",
  locked_holders: 1,
  holders: 3412,
  transfer_fee: 100,
  flags: mptFlagsSample(),
  metadata: {
    ticker: "HTF",
    name: "Harborline Treasury Fund",
    desc: "Tokenized short-term treasuries.",
    icon: "harborline.example/htf/icon.png",
    asset_class: "rwa",
    asset_subclass: "treasury",
    issuer_name: "Harborline Capital",
    uris: [{ uri: "harborline.example/htf", category: "website", title: "Fund page" }],
  },
  metadata_hex: "7B227469636B6572223A22485446227D",
  metadata_conforms: true,
  created_ledger: 99412004,
  created_time: "2025-10-09T11:20:31Z",
  created_tx_hash: MPT_SAMPLE_HASH,
  last_ledger: 107795512,
  destroyed: false,
  ...over,
});

/** `GET /v2/mpt/{issuanceId}`. */
export const mptSample = (over: Partial<MptIssuanceAnswer> = {}): MptIssuanceAnswer & { result: "success" } => ({
  result: "success",
  coverage: mptCoverageSample(),
  issuance: mptIssuanceSample(),
  ...over,
});

/** A holder of HTF: 6,120,400.00 HTF, nothing in escrow. */
export const mptHolderSample = (over: Partial<MptHolder> = {}): MptHolder => ({
  holder: MPT_SAMPLE_HOLDER,
  amount: "612040000",
  escrowed_amount: "0",
  locked: false,
  authorized: true,
  ...over,
});

/** `GET /v2/mpt/{id}/holders?limit=2`: two holders and a marker. */
export const mptHoldersSample = (over: Partial<MptHoldersPage> = {}): MptHoldersPage & { result: "success" } => ({
  result: "success",
  coverage: mptCoverageSample(),
  count: 2,
  marker: MPT_HOLDERS_MARKER,
  holders: [mptHolderSample(), mptHolderSample({ holder: MPT_SAMPLE_OTHER_HOLDER, amount: "250000000", escrowed_amount: "1000", locked: true })],
  ...over,
});

/** A payment of 25,000.00 HTF: `source` and `destination`, no fee. */
export const mptTransferSample = (over: Partial<MptTransfer> = {}): MptTransfer => ({
  ledger_index: 107795410,
  tx_index: 31,
  tx_hash: MPT_SAMPLE_HASH,
  executed_time: "2026-10-24T14:11:05Z",
  tx_type: "Payment",
  kind: "payment",
  source: MPT_SAMPLE_HOLDER,
  destination: MPT_SAMPLE_OTHER_HOLDER,
  amount: "2500000",
  ...over,
});

/** A lock of every balance: no `destination`, and the `amount` is what is outstanding. */
export const mptLockSample = (over: Partial<MptTransfer> = {}): MptTransfer => ({
  ledger_index: 107795400,
  tx_index: 2,
  tx_hash: MPT_SAMPLE_HASH,
  executed_time: "2026-10-24T14:10:41Z",
  tx_type: "MPTokenIssuanceSet",
  kind: "lock",
  source: MPT_SAMPLE_ISSUER,
  amount: "1820451120",
  ...over,
});

/** `GET /v2/mpt/{id}/transfers?descending=true&limit=2`: a payment and a lock of every balance, and a marker. */
export const mptTransfersSample = (over: Partial<MptTransfersPage> = {}): MptTransfersPage & { result: "success" } => ({
  result: "success",
  coverage: mptCoverageSample(),
  count: 2,
  marker: MPT_TRANSFERS_MARKER,
  transfers: [mptTransferSample(), mptLockSample()],
  ...over,
});

/** What `?ids=` says of HTF. */
export const mptSummarySample = (over: Partial<MptSummary> = {}): MptSummary => ({
  mpt_issuance_id: MPT_SAMPLE_ID,
  issuer: MPT_SAMPLE_ISSUER,
  ticker: "HTF",
  name: "Harborline Treasury Fund",
  asset_scale: 2,
  maximum_amount: "5000000000",
  outstanding_amount: "1820451120",
  holders: 3412,
  transfer_fee: 100,
  flags: mptFlagsSample(),
  destroyed: false,
  ...over,
});

/** `GET /v2/mpt?ids=<HTF's, the second>`: HTF's summary, and the second ID alone (the index has no state for it). The IDs are in the order asked. */
export const mptLookupSample = (over: Partial<MptLookup> = {}): MptLookup & { result: "success" } => ({
  result: "success",
  count: 2,
  issuances: [mptSummarySample(), { mpt_issuance_id: MPT_SAMPLE_SECOND_ID }],
  ...over,
});

/** A row of the MPT list: HTF, the most held. */
export const mptTokenRowSample = (over: Partial<MptTokenRow> = {}): MptTokenRow => {
  const { destroyed: _destroyed, ...summary } = mptSummarySample();
  return { rank: 1, ...summary, transfers_24h: 412, ...over };
};

/** `GET /v2/tokens?kind=mpt&limit=20&q=HTF`: one row of 214 issuances, with the totals of the kind. */
export const mptTokensSample = (over: Partial<MptTokensPage> = {}): MptTokensPage & { result: "success" } => ({
  result: "success",
  coverage: mptCoverageSample(),
  kind: "mpt",
  ledger_index: 107795512,
  close_time: "2026-10-24T14:20:01Z",
  totals: { issuances: 214, holders: 9862, transfers_24h: 2415 },
  total: 1,
  count: 1,
  tokens: [mptTokenRowSample()],
  ...over,
});
