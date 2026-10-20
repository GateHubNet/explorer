// Small, valid answers of D1's six routes (validators and amendments), for the unit and component tests of the client, the view builders and the pages. XRPL values, in the
// shapes of data-api-new/docs/api-reference.md at feat/explorer-data 7d495ab, "Validators and amendments" (the reference's own examples are the model). Each sample is
// `(over?: Partial<T>) => T`: a new object on every call, with a shallow override. A test that needs a case the sample does not have (a validator that was never seen, a
// majority without its transaction, an amendment nobody named) overrides the key that makes it, or builds the case from the sample.
//
// Not for `app/`, and not the fixtures of the e2e suite (scripts/validators-fixtures.ts makes those): the domains are `*.example`, the keys are the reference's own (valid
// node public keys), and the amendments are real names with their real IDs (SHA-512Half of the name) and made-up votes and dates.

import type {
  AmendmentDetail,
  AmendmentRow,
  AmendmentsList,
  ValidatorDetail,
  ValidatorRow,
  ValidatorsSummary,
  ValidatorValidationsPage,
} from "../../app/server/api-types";

/** Master keys (`nH…`, Ed25519): valid node public keys, each with a valid checksum. */
export const SAMPLE_KEYS = [
  "nHBFpmLgxtyCSPCW4fWLgqwefcLBuQdkU7R6FNQVF2B5czacYLLA",
  "nHUkKoJy83JptKcB56T38wQwjvH3EVYdcvwAfLDHwH7QBkLEv4nD",
  "nHUQGzW4J3ZH3mms7Dhf6FyuJWXGYzX5A8sYwnX4TWwRYdkJU1pv",
  "nHBZUmz9mhzGE2XnNd1S3LAxwT7NMwToY2SsdAMBYfaemcr3pJaD",
  "nHUZzKfNLsYGbfKCqEqgy2uk76JZqoHWQjt2wrm5t39Jads1g2kQ",
  "nHUH2dDP9pG4fbUza2gV5Uzq1cprSQvuNLQbRagPW6uVnUA4qwdP",
  "nHUdgUruVBHqz9osBhZFz4yKvE1r68NDmpewqYDau3NPJiPnHm76",
  "nHBSrmG2Ng7SERr69XRdEsP1qLfENMmbn4oc7SN6bZJjkadfqnKC",
  "nHU6XWBJQH7SQuDmC59hwWLmbN2uWUGBzm2pU698DuHnVDE68srx",
] as const;

/** Signing keys (`n9…`, secp256k1): valid node public keys too. */
export const SAMPLE_SIGNING_KEYS = [
  "n9Licf177qJUupBi7K4zt6ZTVToMGYgYZqCyTQSkmTSjywumRWso",
  "n9KvdobdhFC7Xwjshw7CxpWdfh8FFU3RHrFEYtpapEGkg3kANxTd",
  "n9K1XhRwDoN8U2h49cSSzr8DLGNaoYmBdijREixAeM9rbWHjNSMv",
  "n9MQ1UFdKJmDsDsBauDdZ5VP6LjjDtnhzZ1NiKG6N5Rg8Pm75ncB",
] as const;

/** The amendments' IDs: SHA-512Half of the name, upper case. */
export const AMM_ID = "8CC0774A3BF66D1D22E76BBDA8E8A232E6B6313834301B3B23E8601196AE6455";
export const XCB_ID = "C98D98EE9616ACD36E81FDEB8D41D349BF5F1B41DD64A0ABC1FE9AA5EA267E9C";
/** An amendment that the node lists and nobody has named: it has an ID and no name. */
export const UNKNOWN_ID = "98433DD001A5737F773D74F8CA2A25A065089C73B2E611C760BAF369E4FECA76";
const DID_ID = "DB432C3A09D9D5DFC7859F39AE5FF767ABC59AED0A9FB441E83B814D8946C109";
const FIX1201_ID = "B4D44CC3111ADD964E846FC57760C8B50FFCD5A82C86A72756F6B058DDDF96AD";

const GENESIS_ACCOUNT = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const TX_HASH = "F78430ADBAF1464366DC4AAA169171604FFD56A9BB28F27835A80EDB455F7ED4";
const ENABLE_TX_HASH = "F5AFF7C2C2CD3F3CD74221F3D78C190BAAF45B3A6867CD165CB0253679EE0C6E";

// ---- The summary ---------------------------------------------------------------------------------------------------------------------------------

export function summarySample(over: Partial<ValidatorsSummary> = {}): ValidatorsSummary {
  return {
    result: "success",
    ledger_index: 107748183,
    close_time: "2026-10-19T15:54:12Z",
    validators: { seen_24h: 54, unl_seen_24h: 34, others_seen_24h: 20, all: 55 },
    unl: {
      trusted: 35,
      threshold: 1,
      publishers: [
        {
          id: "unl.xrplf.org",
          url: "https://unl.xrplf.org",
          public_key: "ED42AEC58B701EEBB77356FFFEC26F83C1F0407263530F068C7C73D392C7E06FD1",
          status: "expired",
          sequence: 2026070302,
          version: 1,
          expiration: "2026-10-18T15:54:20Z",
          fetched: "2026-10-12T15:54:20.380Z",
          validators: 34,
          seen_24h: 33,
          last_error: "http_status",
          last_error_at: "2026-10-19T15:44:19.620Z",
        },
        {
          id: "vl.ripple.com",
          url: "https://vl.ripple.com",
          public_key: "ED2677ABFFD1B33AC6FBC3062B71F1E8397C1505E1C42C64D11AD1B28FF73F4734",
          status: "ok",
          sequence: 85,
          version: 1,
          expiration: "2027-04-07T15:54:20Z",
          fetched: "2026-10-19T15:51:26.114Z",
          validators: 35,
          seen_24h: 34,
        },
      ],
    },
    quorum: { value: 28, unl_size: 35, negative_unl: 1, node: 28 },
    negative_unl: [{ validation_public_key: SAMPLE_KEYS[5], first_ledger: 107747000 }],
    negative_unl_pending: { to_reenable: SAMPLE_KEYS[5] },
    fees: { base_fee: "0.00001", reserve_base: "1", reserve_inc: "0.2" },
    next_flag_ledger: { ledger_index: 107748352, voting_ledger: 107748351, expected: "2026-10-19T16:05:28Z" },
    latest_version: "3.4.1",
    versions: [
      { version: "3.5.0-rc1", unl: 0, all: 3 },
      { version: "3.4.1", unl: 30, all: 40 },
      { version: "3.4.0", unl: 4, all: 9 },
    ],
    versions_unknown: { unl: 1, all: 2 },
    agreement_through: "2026-10-19T15:00:00Z",
    votes_through_ledger: 107748095,
    updated: "2026-10-19T15:54:20.222Z",
    ...over,
  };
}

// ---- A validator --------------------------------------------------------------------------------------------------------------------------------

/** The amendments `northpeak.example` votes yes for: one nobody has named, and XChainBridge. */
const yesEntries = () => [{ id: UNKNOWN_ID }, { id: XCB_ID, name: "XChainBridge" }];

/** `northpeak.example`: on both lists, domain verified (and listing an account), running the latest version, voting for the default fees and two amendments. */
export function validatorRowSample(over: Partial<ValidatorRow> = {}): ValidatorRow {
  return {
    validation_public_key: SAMPLE_KEYS[0],
    domain: "northpeak.example",
    current_index: 107748183,
    agreement_1h: { missed: 1, total: 900, score: "0.9989", incomplete: false, partial: 1 },
    agreement_24h: { missed: 2, total: 21600, score: "0.9999", incomplete: false, partial: 1 },
    partial: false,
    unl: true,
    agreement_30d: { missed: 3, total: 43200, score: "0.9999", incomplete: true, partial: 2 },
    signing_key: SAMPLE_SIGNING_KEYS[0],
    domain_verification: {
      status: "verified",
      toml_url: "https://northpeak.example/.well-known/xrp-ledger.toml",
      checked: "2026-10-19T19:15:52.489Z",
      verified: "2026-10-19T19:15:52.489Z",
      accounts: [GENESIS_ACCOUNT],
    },
    unl_lists: ["unl.xrplf.org", "vl.ripple.com"],
    negative_unl: false,
    version: "3.4.1",
    version_latest: true,
    server_version: "1745992596280311808",
    fee_vote: { ledger_index: 107748095, base_fee: "0.00001", reserve_base: "1", reserve_inc: "0.2" },
    amendment_votes: { ledger_index: 107748095, yes: yesEntries() },
    first_seen: "2026-07-21T19:25:53.000Z",
    last_seen: "2026-10-19T19:24:52.750Z",
    ...over,
  };
}

/** The same validator, as `GET /v2/network/validators/{key}` answers: a vote on every amendment still being decided, its manifest and four of its 30 days. */
export function validatorDetailSample(over: Partial<ValidatorDetail> = {}): ValidatorDetail {
  return {
    ...validatorRowSample(),
    // Takes the place of the row's `amendment_votes` (D1 keeps it where the row has it), with the vote on every amendment being decided added.
    amendment_votes: {
      ledger_index: 107748095,
      yes: yesEntries(),
      votes: [
        { id: XCB_ID, name: "XChainBridge", status: "majority", vote: "yes" },
        { id: UNKNOWN_ID, status: "voting", vote: "yes" },
        { id: DID_ID, name: "DID", status: "voting", vote: "no" },
        { id: "2".repeat(64), status: "unknown", vote: "no" },
      ],
    },
    manifest: { sequence: 2, signing_key: SAMPLE_SIGNING_KEYS[0], signing_keys_seen: 2, domain: "northpeak.example" },
    daily_agreement: [
      { date: "2026-09-20", missed: 0, total: 0, incomplete: true, partial: 0 },
      { date: "2026-10-17", missed: 0, total: 4500, score: "1.0000", incomplete: true, partial: 0 },
      { date: "2026-10-18", missed: 1, total: 21600, score: "1.0000", incomplete: false, partial: 1 },
      { date: "2026-10-19", missed: 2, total: 17100, score: "0.9999", incomplete: true, partial: 1 },
    ],
    result: "success",
    ...over,
  };
}

/** A page of four validations: a partial one, a fork (a different hash of one ledger, then the indexed one), and one recorded under two keys. `marker` says there are more. */
export function validationsSample(over: Partial<ValidatorValidationsPage> = {}): ValidatorValidationsPage {
  return {
    result: "success",
    validation_public_key: SAMPLE_KEYS[0],
    count: 4,
    marker: "WzEwNzc0ODAwNSwiMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwNjZDMUFBNSJd",
    validations: [
      {
        ledger_index: 107748007,
        ledger_hash: "00000000000000000000000000000000000000000000000000000000066C1AA7",
        validated: "matches",
        full: false,
        signing_key: SAMPLE_SIGNING_KEYS[2],
        signing_time: "2026-10-19T16:26:20Z",
        first_datetime: "2026-10-19T16:26:20.250Z",
        last_datetime: "2026-10-19T16:26:20.250Z",
        count: 1,
      },
      {
        ledger_index: 107748006,
        ledger_hash: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        validated: "different",
        validated_hash: "00000000000000000000000000000000000000000000000000000000066C1AA6",
        full: true,
        signing_key: SAMPLE_SIGNING_KEYS[2],
        signing_time: "2026-10-19T16:26:16Z",
        first_datetime: "2026-10-19T16:26:16.500Z",
        last_datetime: "2026-10-19T16:26:16.500Z",
        count: 1,
      },
      {
        ledger_index: 107748006,
        ledger_hash: "00000000000000000000000000000000000000000000000000000000066C1AA6",
        validated: "matches",
        full: true,
        signing_key: SAMPLE_SIGNING_KEYS[2],
        signing_time: "2026-10-19T16:26:16Z",
        first_datetime: "2026-10-19T16:26:16.250Z",
        last_datetime: "2026-10-19T16:26:16.750Z",
        count: 2,
      },
      {
        ledger_index: 107748005,
        ledger_hash: "00000000000000000000000000000000000000000000000000000000066C1AA5",
        validated: "matches",
        full: true,
        signing_key: SAMPLE_SIGNING_KEYS[3],
        signing_time: "2026-10-19T16:26:12Z",
        first_datetime: "2026-10-19T16:26:12.250Z",
        last_datetime: "2026-10-19T16:26:12.750Z",
        count: 3,
      },
    ],
    ...over,
  };
}

// ---- Amendments ----------------------------------------------------------------------------------------------------------------------------------

/** XChainBridge, with a majority since 4 days: everything an amendment of the list can have. */
function majorityRow(): AmendmentRow {
  return {
    id: XCB_ID,
    name: "XChainBridge",
    status: "majority",
    introduced: "1.12.0",
    xls: "XLS-38",
    xls_url: "https://github.com/XRPLF/XRPL-Standards/discussions/92",
    description: "Made up for the samples: bridges between two ledgers.",
    node_supported: true,
    votes: { ledger_index: 107748095, yes: 31, trusted: 35, needed: 29, pct: 88.57 },
    majority: { since: "2026-10-17T15:54:20Z", ledger_index: 107704833, tx_hash: TX_HASH, expected_activation: "2026-10-31T15:54:20Z" },
  };
}

const envelope = () =>
  ({
    ledger_index: 107748183,
    rules: { threshold_percent: 80, majority_hold_seconds: 1209600, flag_interval: 256 },
    round: { ledger_index: 107748095, date: "2026-10-19T15:48:20Z", unl_size: 36, trusted: 35, threshold: 28, needed: 29, observed: 35 },
    next_flag_ledger: { ledger_index: 107748352, voting_ledger: 107748351, expected: "2026-10-19T16:05:28Z" },
  }) satisfies Pick<AmendmentsList, "ledger_index" | "rules" | "round" | "next_flag_ledger">;

/** One of each kind that matters to the board: a majority, an amendment enabled from the ledger, one enabled from the metadata file, one being voted on, and one nobody named. */
export function amendmentsSample(over: Partial<AmendmentsList> = {}): AmendmentsList {
  return {
    result: "success",
    ...envelope(),
    counts: { enabled: 2, majority: 1, voting: 1, obsolete: 0, unknown: 1 },
    count: 5,
    amendments: [
      majorityRow(),
      {
        id: AMM_ID,
        name: "AMM",
        status: "enabled",
        introduced: "1.12.0",
        xls: "XLS-30",
        xls_url: "https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0030-automated-market-maker",
        description: "Made up for the samples: automated market makers.",
        node_supported: true,
        enabled: { ledger_index: 107747841, date: "2026-10-19T15:31:24Z", tx_hash: ENABLE_TX_HASH, source: "ledger" },
      },
      { id: FIX1201_ID, name: "fix1201", status: "enabled", introduced: "0.80.0", enabled: { ledger_index: 90000001, date: "2025-02-03", source: "metadata" } },
      {
        id: DID_ID,
        name: "DID",
        status: "voting",
        introduced: "1.12.0",
        node_supported: true,
        votes: { ledger_index: 107748095, yes: 4, trusted: 35, needed: 29, pct: 11.43 },
      },
      { id: UNKNOWN_ID, status: "unknown", node_supported: true, votes: { ledger_index: 107748095, yes: 0, trusted: 35, needed: 29, pct: 0 } },
    ],
    ...over,
  };
}

/** XChainBridge, as `GET /v2/network/amendments/{name}` answers: the envelope of the list, the row, five voters of the UNL and two others, three rounds and the history. */
export function amendmentDetailSample(over: Partial<AmendmentDetail> = {}): AmendmentDetail {
  return {
    ...envelope(),
    ...majorityRow(),
    unl_votes: [
      { validation_public_key: SAMPLE_KEYS[0], domain: "northpeak.example", vote: "yes", version: "3.4.1", version_supports: true, last_seen: "2026-10-19T15:53:19.750Z" },
      { validation_public_key: SAMPLE_KEYS[1], domain: "shoreline.example", vote: "yes", version: "3.4.1", version_supports: true, last_seen: "2026-10-19T15:53:19.750Z" },
      { validation_public_key: SAMPLE_KEYS[2], vote: "yes", version: "3.4.0", version_supports: false, last_seen: "2026-10-19T15:53:19.750Z" },
      { validation_public_key: SAMPLE_KEYS[3], vote: "no", version: "3.4.0", version_supports: false, last_seen: "2026-10-19T15:53:19.750Z" },
      { validation_public_key: SAMPLE_KEYS[4], vote: "none", last_seen: "2026-10-19T15:53:19.750Z" },
    ],
    other_votes: [
      { validation_public_key: SAMPLE_KEYS[7], domain: "tidewater.example", vote: "yes", version: "3.4.1", version_supports: true, last_seen: "2026-10-19T15:53:19.750Z" },
      { validation_public_key: SAMPLE_KEYS[8], vote: "no", version: "3.5.0", version_supports: true, last_seen: "2026-10-19T15:53:19.750Z" },
    ],
    rounds: [
      { ledger_index: 107543295, flag_ledger: 107543296, date: "2026-10-09T15:54:20Z", yes: 0, trusted: 35, threshold: 28, passes: false },
      { ledger_index: 107747583, flag_ledger: 107747584, date: "2026-10-19T15:14:12Z", yes: 29, trusted: 35, threshold: 28, passes: true },
      { ledger_index: 107748095, flag_ledger: 107748096, date: "2026-10-19T15:48:20Z", yes: 31, trusted: 35, threshold: 28, passes: true },
    ],
    history: [
      { event: "got_majority", ledger_index: 106500001, date: "2026-08-20T15:54:20Z", tx_hash: "62C1656A2A1702F45C414DB330DBBEA25FDA830A80131B0C56BE514A7B6B68B1" },
      { event: "lost_majority", ledger_index: 106600001, date: "2026-08-30T15:54:20Z", tx_hash: "322F9E58EDBEEB643D949CF33F3FD6D0049E537B493EB08D262446CBD9C189E1" },
      { event: "got_majority", ledger_index: 107704833, date: "2026-10-17T15:54:25Z", tx_hash: TX_HASH },
    ],
    result: "success",
    ...over,
  };
}
