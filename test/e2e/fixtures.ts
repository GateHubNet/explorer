// The recorded mainnet objects the suite looks at (test/fixtures/http/, the fixture server's files). They are old and final, so
// they are the same on a real stack that has the history, which is how the suite runs against one (E2E_DATA_API_URL).

/** A plain XRP payment, rBbW6i…W5jh to rDFDjd…fy48, in XRPL ledger 102,186,243 (transaction 63 of 90). */
export const XRPL_PAYMENT = "AACAFCFEBB5C970049A576CBFE6EF544A47EE3ADBA99122FA43234D18D5FFD40";
export const XRPL_PAYMENT_LEDGER = 102186243;

/** A Remit on Xahau: a hash the XRP Ledger does not have. */
export const XAHAU_REMIT = "8C50C44787A12B785AA62377D0AFA6C4711E8E07EF68BA6E83DC286F7EE79AAF";

/** An XRPL ledger with an expanded recording (66 transactions). */
export const XRPL_LEDGER = 107720688;

/** The newest ledger of the XRPL fixtures (`last_validated`): its Next is disabled. A real stack's newest is another one. */
export const XRPL_HEAD_LEDGER = 107721455;

/** The only two consecutive ledgers of the recordings, on Xahau: 26540187 and the one after it. */
export const XAHAU_LEDGER = 26540187;
export const XAHAU_LEDGER_NEXT = 26540188;

/** An active XRPL account with six recorded transactions (pages of 4 and 2), two payments (1 and 1) and three trades (2 and 1). */
export const XRPL_ACCOUNT = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";

/** An active Xahau account. */
export const XAHAU_ACCOUNT = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";

/** A deleted XRPL account: the index has its creation and its recorded AccountDelete, the node has no account (README "Upstream fixtures"). */
export const XRPL_DELETED = "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC";

/** Valid, and in no recording: neither the index nor the node has it. */
export const NEVER_FUNDED = "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC";

/** Well formed, and nothing has it. */
export const NO_SUCH_TRANSACTION = "0".repeat(64);

/**
 * Whether the suite runs against a real stack or a deployed Worker (E2E_DATA_API_URL, E2E_BASE_URL) and not the fixtures. The
 * recorded ledgers and transactions are the same there; what the fixtures hold by hand is not (the account files: six transactions in
 * two pages, a balance of 10.001625 XRP, an address nobody funded), so the tests that read those say `test.skip(LIVE, ...)`.
 */
export const LIVE = Boolean(process.env.E2E_DATA_API_URL || process.env.E2E_BASE_URL);

export const count = (n: number) => n.toLocaleString("en-US");
