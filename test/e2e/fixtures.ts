import { readFileSync } from "node:fs";

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

// The AMM pages' featured pools (README "AMM pools", "Upstream fixtures"): real pools of the recorded XRPL ledgers, named in their natural orientation.
// Each page is checked against its own fixtures only: the pool page's day rows, candles and live set are seeded, and are not E3's derived trades of the
// same pair (the markets pages').

/** XRP/RLUSD: every period of the pool page (30 days, 90 days, a year), swaps and liquidity events in two pages each, its `amm_info` by its account. */
export const XRP_RLUSD_POOL = "rhWTXC2m2gGGA9WozUaoMm6kLAVPb1tcS3";

/** SNK/XRP, the pool a withdrawal emptied: the index has it `deleted`, and it is on the fourth page of the list with the deleted pools included. */
export const SNK_XRP_POOL = "rGLnUKdptCVobJKEkrwxtdyGZ98Evdmqdz";
/** SNK's issuer: the list's form finds the deleted pool by `SNK.rDDYXY…` with "Include deleted pools". */
export const SNK_ISSUER = "rDDYXY17rzuF44gVAAQ9MB6GRQFkvWSccm";
/** The ledger of the withdrawal that emptied SNK/XRP, the last that touched it (its `last_ledger`). */
export const SNK_XRP_LAST_LEDGER = 100132150;

/** A Payment that swapped through the XRP/RLUSD pool: its flow's pool step and its sentence's pair lead to the pool's page while AMM_PAGES is on. */
export const SWAP_THROUGH_POOL = "52E2AD5B382D4588BECF6A743E7AE5C84D49A5C06968EC7700E8333BF41E1C60";

/**
 * Whether the suite runs against a real stack or a deployed Worker (E2E_DATA_API_URL, E2E_BASE_URL) and not the fixtures. The
 * recorded ledgers and transactions are the same there; what the fixtures hold by hand is not (the account files: six transactions in
 * two pages, a balance of 10.001625 XRP, an address nobody funded), so the tests that read those say `test.skip(LIVE, ...)`.
 */
export const LIVE = Boolean(process.env.E2E_DATA_API_URL || process.env.E2E_BASE_URL);

export const count = (n: number) => n.toLocaleString("en-US");

interface FixtureName {
  display_name?: { text: string; kind: string };
  account_network_name?: string;
  labels?: Record<string, unknown>;
}

const fixtureNames = (net: "xrpl" | "xahau") =>
  JSON.parse(readFileSync(new URL(`../fixtures/http/${net}/data-api/account_names.json`, import.meta.url), "utf8")) as Record<string, FixtureName | undefined>;

/**
 * The name the network's names fixtures (`account_names.json`, synthetic: test/fixtures/PROVENANCE.md) give an account, the text a page draws it by (display names): `undefined`
 * for an account they give none. A real stack has names of its own, so a test that reads this does not check it against one (`LIVE`).
 */
export function fixtureNameOf(net: "xrpl" | "xahau", address: string): string | undefined {
  return fixtureNames(net)[address]?.display_name?.text;
}

/**
 * The `<title>` of an account's page, with `lead` before it (the Analytics tab's "Analytics · "), as a pattern (display names spec 7): `Account {name} ({short address}) · {network} · explorer`
 * for an account the fixtures give a verified name and no label, which a title may say. A real stack has names of its own (and not this account's), so against one it is the shape alone:
 * the short address, with a name before it or none. An account the fixtures name otherwise (labelled, a domain's name, a network name) has no such title: the test that asked fails.
 */
export function accountTitle(net: "xrpl" | "xahau", address: string, lead = ""): RegExp {
  const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const suffix = ` · ${net === "xrpl" ? "XRPL" : "Xahau"} · explorer`;
  if (LIVE) return new RegExp(`^${escaped(lead)}Account (?:.+ \\()?${escaped(short)}\\)?${escaped(suffix)}$`);
  const entry = fixtureNames(net)[address];
  if (entry?.display_name?.kind !== "verified" || Object.keys(entry.labels ?? {}).length > 0 || entry.account_network_name !== undefined) {
    throw new Error(`the fixtures give ${address} no verified name without a label or a network name, so its title has none`);
  }
  return new RegExp(`^${escaped(`${lead}Account ${entry.display_name.text} (${short})${suffix}`)}$`);
}
