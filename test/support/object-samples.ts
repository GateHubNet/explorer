// Small, valid answers of D5's routes (escrows, checks, payment channels, delegations and the object lookup) for the tests of the client (test/worker/data-api.spec.ts) and of its
// shape checks (app/server/object-shape.test.ts). XRPL values, in the shapes of data-api-new/docs/api-reference.md "Ledger objects" of feat/explorer-data-2 at 0c2e58c (the
// reference's own examples are the model: real answers over the recorded mainnet ledgers, with addresses that exist). Each sample is `(over?) => T`: a new object on every call,
// with a shallow override. A test that needs a case the sample does not have builds it from the sample.
//
// Not for `app/`, and not the fixtures of the e2e suite (scripts/ makes those). The types are api-types.ts's, so that a sample that stopped being what the reference promises, or a
// type that did, fails `pnpm typecheck`. An answer sample has `result: "success"` before `coverage`, as the API writes it.

import type {
  CheckAnswer,
  Coverage,
  DelegationsPage,
  EscrowAnswer,
  LedgerObjectRef,
  ObjectAmount,
  ObjectHistoryPage,
  PaymentChannelAnswer,
} from "../../app/server/api-types";

/** The ID of each object of the samples: an escrow of 0.5 XRP, a check for 1 RLUSD, a channel of 1 XRP, a delegation. */
export const ESCROW_ID = "B95064B1A92F02EE009E6BDFB369CF476FB925BB8615456970E38774034A5D30";
export const CHECK_ID = "60FCB1E8C72A695CBB6BDF718D30AF2310A9BED6D3F6D92F54C0E429186D1A42";
export const CHANNEL_ID = "E22CCE8FA636C8BDF1C3C4AA17FD604B8FDE268E4F6BF9022B5336536F5B69EA";
export const DELEGATION_ID = "E63226B764F4D7C198DBF8E4DE0F5DA4F9C1AC449C2927F2150C0B731E020851";
/** The owner of the escrow and the destination, an issuer of a token, the delegating account and the delegate. */
export const ESCROW_OWNER = "rNeJW71pMjKy42j5jn7vnWZAbmuU6SKs6V";
export const ESCROW_DESTINATION = "rGtW2dWHmHQ3f65pfbjYF5PbFbdZwgwuqW";
export const TOKEN_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
export const DELEGATOR = "rnt8PbBFT7idcLyj9PNgxjZi9Z1RiRX3QL";
export const DELEGATE = "rw2X2GFePFiLDdcQw6iELFfUEw1hPqAGcK";
/** A transaction hash, the ID of an MPT issuance (a sequence and `ESCROW_OWNER`'s 20 bytes: 48 digits) and a marker as the API writes one. */
export const OBJECT_TX_HASH = "BF93E9B72AE372BCEB27781CA58C4ABE7E51EE9F5D254D02B83C92EC1A22AE53";
export const MPT_ISSUANCE_ID = "0000012A95A7A415885FFF5E78A9B0A51C3EAF118ACD071A";
export const OBJECT_MARKER = "WzEwNzk0NTQzOCw5OF0";

/** What an answer is of: the index starts at the first recorded ledger and holds the object's whole history. */
export const objectCoverageSample = (over: Partial<Coverage> = {}): Coverage => ({ from_ledger_index: 102145584, complete: true, ...over });

/** An MPT amount as D5 writes it: the issuance ID in `currency` and again as the last key, the issuer read from it, the raw units. */
export const mptAmountSample = (over: Partial<ObjectAmount> = {}): ObjectAmount => ({
  currency: MPT_ISSUANCE_ID,
  issuer: ESCROW_OWNER,
  value: "500",
  mpt_issuance_id: MPT_ISSUANCE_ID,
  ...over,
});

/** `GET /v2/escrows/{escrow_id}`: a timed escrow of 0.5 XRP past its `cancel_after`, with the one event that made it. */
export const escrowAnswerSample = (over: Partial<EscrowAnswer> = {}): EscrowAnswer => ({
  result: "success",
  coverage: objectCoverageSample(),
  ledger_index: 107972102,
  close_time: "2026-10-29T03:50:41Z",
  escrow: {
    escrow_id: ESCROW_ID,
    account: ESCROW_OWNER,
    sequence: 107896555,
    destination: ESCROW_DESTINATION,
    amount: { currency: "XRP", value: "0.5" },
    finish_after: "2026-10-25T16:50:01Z",
    cancel_after: "2026-10-25T17:49:01Z",
    source_tag: 2610250016,
    status: "can_be_cancelled",
    created: { ledger_index: 107897249, time: "2026-10-25T16:49:20Z", tx_hash: OBJECT_TX_HASH },
  },
  history: [
    {
      event: "create",
      ledger_index: 107897249,
      time: "2026-10-25T16:49:20Z",
      tx_hash: OBJECT_TX_HASH,
      tx_type: "EscrowCreate",
      account: ESCROW_OWNER,
      result: "tesSUCCESS",
      amount: { currency: "XRP", value: "0.5" },
    },
  ],
  ...over,
});

/** `GET /v2/checks/{check_id}`: a check for 1 RLUSD that nobody cashed before it expired. */
export const checkAnswerSample = (over: Partial<CheckAnswer> = {}): CheckAnswer => ({
  result: "success",
  coverage: objectCoverageSample(),
  ledger_index: 107972102,
  close_time: "2026-10-29T03:50:41Z",
  check: {
    check_id: CHECK_ID,
    account: "r9CaVb4X1JVQoi6Q8Gw5cznAMRFARJDWyN",
    sequence: 106635339,
    destination: "rBi1QrVjwaNofisZAQnovoXdHkS73FG1tJ",
    send_max: { currency: "524C555344000000000000000000000000000000", issuer: TOKEN_ISSUER, value: "1" },
    expiration: "2026-10-16T17:49:51Z",
    invoice_id: "AB9E9A322F4A89059C5402523B218CA53745DE3672A109BD14BB1A186640AD36",
    source_tag: 804681468,
    status: "expired",
    created: { ledger_index: 107698980, time: "2026-10-16T16:50:02Z", tx_hash: "CCDBCADF2DE0EF5E85A3332C4CADE9A0C28F3B5E7220C4890E27D196415D0326" },
  },
  history: [
    {
      event: "create",
      ledger_index: 107698980,
      time: "2026-10-16T16:50:02Z",
      tx_hash: "CCDBCADF2DE0EF5E85A3332C4CADE9A0C28F3B5E7220C4890E27D196415D0326",
      tx_type: "CheckCreate",
      account: "r9CaVb4X1JVQoi6Q8Gw5cznAMRFARJDWyN",
      result: "tesSUCCESS",
      send_max: { currency: "524C555344000000000000000000000000000000", issuer: TOKEN_ISSUER, value: "1" },
      expiration: "2026-10-16T17:49:51Z",
    },
  ],
  ...over,
});

/** `GET /v2/payment_channels/{channel_id}`: a channel of 1 XRP claimed from once; its two events, newest first, each with `amount` and `balance`. */
export const paymentChannelAnswerSample = (over: Partial<PaymentChannelAnswer> = {}): PaymentChannelAnswer => ({
  result: "success",
  coverage: objectCoverageSample(),
  ledger_index: 107972102,
  close_time: "2026-10-29T03:50:41Z",
  payment_channel: {
    channel_id: CHANNEL_ID,
    account: "rQQQrUdN1cLdNmxH4dHfKgmX5P4kf3ZrM",
    sequence: 61531741,
    destination: "rLggTEwmTe3eJgyQbCSk4wQazow2TeKrtR",
    amount: { currency: "XRP", value: "1" },
    balance: { currency: "XRP", value: "0.032185" },
    remaining: { currency: "XRP", value: "0.967815" },
    settle_delay: 1209600,
    public_key: "03D63CA73239D94AAF52574A20E3BC26CBDB811CA55A5914FAA28836F079CE0DC3",
    status: "open",
    opened_with: { currency: "XRP", value: "1" },
    funds: 0,
    claims: 1,
    created: { ledger_index: 107624182, time: "2026-10-13T08:05:31Z", tx_hash: "E8A8466AF9E1E5E6339F1EAC64A9B8AD7AB4BE42613605511EDC80E1FCD34127" },
  },
  history: [
    {
      event: "claim",
      ledger_index: 107641123,
      time: "2026-10-14T02:25:30Z",
      tx_hash: "886A9054CD78D4C2F1250999F8D65DB3048F8FC9AFB24523AD755B29797AC790",
      tx_type: "PaymentChannelClaim",
      account: "rLggTEwmTe3eJgyQbCSk4wQazow2TeKrtR",
      result: "tesSUCCESS",
      amount: { currency: "XRP", value: "1" },
      balance: { currency: "XRP", value: "0.032185" },
      balance_change: { currency: "XRP", value: "0.032185" },
    },
    {
      event: "create",
      ledger_index: 107624182,
      time: "2026-10-13T08:05:31Z",
      tx_hash: "E8A8466AF9E1E5E6339F1EAC64A9B8AD7AB4BE42613605511EDC80E1FCD34127",
      tx_type: "PaymentChannelCreate",
      account: "rQQQrUdN1cLdNmxH4dHfKgmX5P4kf3ZrM",
      result: "tesSUCCESS",
      amount: { currency: "XRP", value: "1" },
      balance: { currency: "XRP", value: "0" },
      settle_delay: 1209600,
    },
  ],
  ...over,
});

/** `/history?limit=1` of an escrow: its `create` event (an escrow's, which is what the default events are), and the marker of the page after it. */
export const historySample = (over: Partial<ObjectHistoryPage> = {}): ObjectHistoryPage => ({
  result: "success",
  coverage: objectCoverageSample(),
  ledger_index: 107972102,
  close_time: "2026-10-29T03:50:41Z",
  count: 1,
  marker: OBJECT_MARKER,
  history: [
    {
      event: "create",
      ledger_index: 107945438,
      time: "2026-10-27T22:14:51Z",
      tx_hash: "3D7F58900F76F6B50D7B5BB1988D9E3C4E33744928B14DE1106848FFA9A3343C",
      tx_type: "EscrowCreate",
      account: "rfd4xkXuigdGJV2XYkbosFzBQaLsc6M8Vm",
      result: "tesSUCCESS",
      amount: { currency: "XRB", issuer: "rD9ixf7RRUKuKVFTsZa3fZGAN6HtNziPKa", value: "75000" },
    },
  ],
  ...over,
});

/** `GET /v2/accounts/{address}/delegations`: one delegation `DELEGATOR` gave `DELEGATE`, for its offers. */
export const delegationsSample = (over: Partial<DelegationsPage> = {}): DelegationsPage => ({
  result: "success",
  coverage: objectCoverageSample(),
  ledger_index: 107972102,
  close_time: "2026-10-29T03:50:41Z",
  count: 1,
  delegations: [
    {
      delegation_id: DELEGATION_ID,
      account: DELEGATOR,
      authorize: DELEGATE,
      permissions: [
        { permission: "OfferCreate", kind: "transaction" },
        { permission: "OfferCancel", kind: "transaction" },
      ],
      updated: { ledger_index: 107558036, time: "2026-10-10T09:03:20Z", tx_hash: "4250B72A5AB63CEB5501CFDDA3B4C9765B85941BB6AECE9720FC6C0D5F524B66" },
      created: { ledger_index: 107558036, time: "2026-10-10T09:03:20Z", tx_hash: "4250B72A5AB63CEB5501CFDDA3B4C9765B85941BB6AECE9720FC6C0D5F524B66" },
    },
  ],
  ...over,
});

/** `ledger_object` of `GET /v2/ledger_objects/{object_id}`, the delegation above (the part under that key is what the client returns). */
export const ledgerObjectSample = (over: Partial<LedgerObjectRef> = {}): LedgerObjectRef => ({
  object_id: DELEGATION_ID,
  object_type: "Delegate",
  account: DELEGATOR,
  deleted: false,
  ledger_index: 107558036,
  ...over,
});
