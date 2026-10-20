// The D1 calls of the validators and amendments pages as the upstream mock names them (upstream-core.ts, "Override keys"): what the worker specs of those
// pages fail, count and wait for. One spelling for every spec, so that a key the pages stop asking for shows up as an unused override, not as a typo.

/** The anchor of every live page (the home page's key). */
export const LAST_VALIDATED = "GET /v2/last_validated";
/** S: the summary. */
export const SUMMARY = "GET /v2/network/validators/summary";
/** L: every validator, asked for once per network, whatever the view. */
export const LIST = "GET /v2/network/validators?limit=1000&scope=all";
/** A: the amendments. */
export const AMENDMENTS = "GET /v2/network/amendments";

/** D: one validator, by the key the URL names. */
export const validatorCall = (key: string) => `GET /v2/network/validators/${key}`;

/** VV: a validator's newest validations, or the page after `marker`. */
export const validationsCall = (key: string, marker?: string) =>
  `GET /v2/network/validators/${key}/validations?limit=20${marker === undefined ? "" : `&marker=${marker}`}`;
