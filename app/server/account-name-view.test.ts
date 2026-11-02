import { describe, expect, it } from "vitest";

import { accountNameHeader, isProperlyFormedDomain, type NameHeaderInput } from "./account-name-view";
import type { Loaded } from "./account-view";
import { NO_FEATURES } from "../ui/features";
import type { AccountNameEntry, TomlAnswer, TomlData } from "./api-types";

// The header of the account page, built from one address's entry of the names batch, the domain the node shows, and the toml of that domain (E9, spec 6.1 to 6.6). One test for
// each row of the AccountNames board's states (6.1) and of the failures (6.6). Names and domains are fictional.

const ADDRESS = "rrrrrrrrrrrrrrrrrrrpnkLzyT5b";
const ISSUER = "rrrrrrrrrrrrrrrrrrrpaEDEVjEj";
const TOKENS_ON = { ...NO_FEATURES, tokens: true };
/** The networks of the headers: every switch off, as the page was before E11 (the currencies are text), unless a test says `TOKENS_ON`. */
const XRPL: NameHeaderInput["network"] = { software: "rippled", id: "xrpl", native: "XRP", features: NO_FEATURES };
const XAHAU: NameHeaderInput["network"] = { software: "xahaud", id: "xahau", native: "XAH", features: NO_FEATURES };

const WITHOUT_VOUCHING = "The explorer shows the domain, without vouching for it.";

/** The toml of northpeak.example as the data API read it: the account listed, two currencies, two principals, a date. */
function tomlOf(toml: Partial<TomlData> = {}): Loaded<TomlAnswer> {
  return {
    state: "ok",
    value: {
      result: "success",
      toml: {
        domain: "northpeak.example",
        toml_url: "https://northpeak.example/.well-known/xrp-ledger.toml",
        status: "ok",
        checked: "2026-10-24T07:12:09.410Z",
        fetched: "2026-10-24T07:12:09.410Z",
        modified: "2026-10-02T00:00:00Z",
        accounts: [{ address: ADDRESS, desc: "Northpeak Treasury" }],
        currencies: [{ code: "NPUSD", issuer: ISSUER, display_decimals: 2, name: "Northpeak Dollar" }, { code: "NPEUR" }],
        principals: ["Mara Lindqvist", "Tomas Okafor"],
        ...toml,
      },
    },
  };
}

/**
 * What the facts say of the currencies of `tomlOf`: the toml's code as D4 gives it (`currency`), the text the explorer writes for it (`code`), the issuer where the toml names one, and where
 * the code leads (`href`: none while `TOKENS` is off, as in these headers).
 */
const NORTHPEAK_CURRENCIES = [
  { currency: "NPUSD", code: "NPUSD", issuer: ISSUER, href: null },
  { currency: "NPEUR", code: "NPEUR", href: null },
];

/** The entry of an account whose name northpeak.example's toml vouches for. */
const verified = (entry: Partial<AccountNameEntry> = {}): AccountNameEntry => ({
  address: ADDRESS,
  display_name: { text: "Northpeak Treasury", kind: "verified" },
  domain: "northpeak.example",
  ...entry,
});

/** The entry of an account that names a domain nothing vouches for. */
const unvouched = (domain = "lowtide.example", entry: Partial<AccountNameEntry> = {}): AccountNameEntry => ({
  address: ADDRESS,
  display_name: { text: domain, kind: "domain" },
  domain,
  ...entry,
});

/** A header's input: the northpeak account on XRPL, the node showing the entry's domain, and its toml read. */
function inputOf(rest: Partial<NameHeaderInput> = {}): NameHeaderInput {
  return { address: ADDRESS, entry: verified(), liveDomain: "northpeak.example", toml: tomlOf(), network: XRPL, ...rest };
}

describe("accountNameHeader: a verified name", () => {
  it("has the name, the domain as a link, and how we know", () => {
    const header = accountNameHeader(inputOf());
    expect(header.title).toEqual({ text: "Northpeak Treasury", kind: "verified" });
    expect(header.domainLine).toEqual({ text: "northpeak.example", state: "verified", href: "https://northpeak.example" });
    expect(header.howWeKnow).toEqual({
      domain: "northpeak.example",
      tomlHref: "https://northpeak.example/.well-known/xrp-ledger.toml",
      tomlText: "northpeak.example/.well-known/xrp-ledger.toml",
      descGivesName: true,
      checked: "Oct 24, 2026, 07:12 UTC",
    });
    expect(header.labels).toEqual([]);
    expect(header.labelMarks).toEqual([]);
    expect(header.help).toBeNull();
  });

  it("says the name is the domain when the toml gives no desc: the name is then the domain", () => {
    const header = accountNameHeader(inputOf({ entry: verified({ display_name: { text: "northpeak.example", kind: "verified" } }) }));
    expect(header.title).toEqual({ text: "northpeak.example", kind: "verified" });
    expect(header.howWeKnow?.descGivesName).toBe(false);
  });

  it("names xahau.toml on Xahau", () => {
    const header = accountNameHeader(inputOf({ network: XAHAU }));
    expect(header.howWeKnow?.tomlHref).toBe("https://northpeak.example/.well-known/xahau.toml");
    expect(header.howWeKnow?.tomlText).toBe("northpeak.example/.well-known/xahau.toml");
  });

  it("has when the toml was checked, when the toml answered", () => {
    expect(accountNameHeader(inputOf()).howWeKnow).toHaveProperty("checked", "Oct 24, 2026, 07:12 UTC");
    expect(accountNameHeader(inputOf({ toml: tomlOf({ checked: "2026-10-25T13:05:44.100Z" }) })).howWeKnow).toHaveProperty("checked", "Oct 25, 2026, 13:05 UTC");
  });

  it("has no time, and no facts, when the toml call failed: the name and its state come from the batch", () => {
    const header = accountNameHeader(inputOf({ toml: { state: "failed" } }));
    expect(header.title).toEqual({ text: "Northpeak Treasury", kind: "verified" });
    expect(header.domainLine?.state).toBe("verified");
    expect(header.howWeKnow).not.toBeNull();
    expect(header.howWeKnow).not.toHaveProperty("checked");
    expect(header.facts).toBeNull();
  });

  it("has no time, and no facts, when there is no toml answer to read (the toml is not found, or was not asked for)", () => {
    for (const toml of [{ state: "missing" } as const, null]) {
      const header = accountNameHeader(inputOf({ toml }));
      expect(header.domainLine?.state).toBe("verified");
      expect(header.howWeKnow).not.toHaveProperty("checked");
      expect(header.facts).toBeNull();
    }
  });

  it("has the facts of the toml: the principals, both currencies with the issuer where it names one, and the date", () => {
    expect(accountNameHeader(inputOf()).facts).toEqual({
      principals: "Mara Lindqvist and Tomas Okafor",
      currencies: NORTHPEAK_CURRENCIES,
      modified: "Oct 2, 2026",
    });
  });

  it("writes the currencies as the explorer writes them everywhere (a hex code is its text)", () => {
    const hex = "4E50474246000000000000000000000000000000"; // "NPGBF"
    const header = accountNameHeader(inputOf({ toml: tomlOf({ currencies: [{ code: hex, issuer: ISSUER }] }) }));
    // The raw code is kept beside its text.
    expect(header.facts?.currencies).toEqual([{ currency: hex, code: "NPGBF", issuer: ISSUER, href: null }]);
  });

  // The toml is the domain owner's text: a bidi control in a principal's name or a currency's code would turn the words around it in the facts' sentence. The words the header
  // shows are without them; the raw code is kept for the token link.
  it("takes the bidi and format controls out of the principals and the currencies' text, and keeps the raw code", () => {
    const header = accountNameHeader(inputOf({ toml: tomlOf({ principals: ["\u202EMara\u202C Lindqvist", "Tomas\u2066 Okafor\u2069"], currencies: [{ code: "NP\u200FUSD", issuer: ISSUER }] }) }));
    expect(header.facts?.principals).toBe("Mara Lindqvist and Tomas Okafor");
    expect(header.facts?.currencies).toEqual([{ currency: "NP\u200FUSD", code: "NPUSD", issuer: ISSUER, href: null }]);
  });

  describe("the token links of the currencies (E11 spec 5.2)", () => {
    const withTokens = (over: Partial<NameHeaderInput> = {}) => accountNameHeader(inputOf({ network: { ...XRPL, features: TOKENS_ON }, ...over }));
    const hrefsOf = (header: ReturnType<typeof accountNameHeader>) => header.facts?.currencies?.map((currency) => currency.href);

    it("links a currency that has an issuer to its token page, as the token page's path reads its code (a text code is its hex), and leaves one without an issuer as text", () => {
      expect(hrefsOf(withTokens())).toEqual([`/xrpl/token/NPUSD.${ISSUER}`, null]);
    });

    it("links a code the toml writes as hex and as the 3 characters, in any case, to the one canonical page", () => {
      const toml = tomlOf({
        currencies: [
          { code: "4E50474246000000000000000000000000000000", issuer: ISSUER },
          { code: "USD", issuer: ISSUER },
          { code: "usd", issuer: ISSUER },
        ],
      });
      expect(hrefsOf(withTokens({ toml }))).toEqual([`/xrpl/token/NPGBF.${ISSUER}`, `/xrpl/token/USD.${ISSUER}`, `/xrpl/token/USD.${ISSUER}`]);
    });

    it("is Xahau's on Xahau", () => {
      expect(hrefsOf(withTokens({ network: { ...XAHAU, features: TOKENS_ON } }))).toEqual([`/xahau/token/NPUSD.${ISSUER}`, null]);
    });

    it("leaves every code as text while TOKENS is off", () => {
      expect(hrefsOf(accountNameHeader(inputOf()))).toEqual([null, null]);
    });

    it("leaves a code the token page's path does not read as text: a native code, a control in it, a separator, a code too long, an issuer that is no address", () => {
      const toml = tomlOf({
        currencies: [
          { code: "XRP", issuer: ISSUER },
          { code: "NP\u200FUSD", issuer: ISSUER },
          { code: "NP.USD", issuer: ISSUER },
          { code: "A".repeat(41), issuer: ISSUER },
          { code: "NPUSD", issuer: "not-an-address" },
        ],
      });
      expect(hrefsOf(withTokens({ toml }))).toEqual([null, null, null, null, null]);
    });

    it("links an LP token's code to nothing: it is no token of the toml's", () => {
      const toml = tomlOf({ currencies: [{ code: `03${"AB".repeat(19)}`, issuer: ISSUER }] });
      expect(hrefsOf(withTokens({ toml }))).toEqual([null]);
    });
  });

  it("has only the facts that are there, and none when none is", () => {
    expect(accountNameHeader(inputOf({ toml: tomlOf({ currencies: undefined, modified: undefined }) })).facts).toEqual({ principals: "Mara Lindqvist and Tomas Okafor" });
    expect(accountNameHeader(inputOf({ toml: tomlOf({ principals: undefined, modified: undefined }) })).facts).toEqual({
      currencies: NORTHPEAK_CURRENCIES,
    });
    expect(accountNameHeader(inputOf({ toml: tomlOf({ principals: undefined, currencies: undefined }) })).facts).toEqual({ modified: "Oct 2, 2026" });
    expect(accountNameHeader(inputOf({ toml: tomlOf({ principals: undefined, currencies: undefined, modified: undefined }) })).facts).toBeNull();
    expect(accountNameHeader(inputOf({ toml: tomlOf({ principals: [], currencies: [], modified: undefined }) })).facts).toBeNull();
  });

  it("shows the facts and the time of the last good read when the latest check failed within the grace (a transient failure keeps the old content)", () => {
    const blip = tomlOf({ status: "failed", reason: "http_status", status_code: 503, checked: "2026-10-25T07:00:00.250Z", fetched: "2026-10-24T07:12:09.410Z" });
    const header = accountNameHeader(inputOf({ toml: blip }));
    expect(header.domainLine?.state).toBe("verified");
    expect(header.howWeKnow).toHaveProperty("checked", "Oct 24, 2026, 07:12 UTC");
    expect(header.facts).toEqual({
      principals: "Mara Lindqvist and Tomas Okafor",
      currencies: NORTHPEAK_CURRENCIES,
      modified: "Oct 2, 2026",
    });
  });

  it("shows neither facts nor a time when the latest check failed and there is no last good read", () => {
    const gone = tomlOf({ status: "failed", reason: "http_status", status_code: 404, checked: "2026-10-25T07:00:00.250Z", fetched: undefined });
    const header = accountNameHeader(inputOf({ toml: gone }));
    expect(header.domainLine?.state).toBe("verified");
    expect(header.howWeKnow).not.toBeNull();
    expect(header.howWeKnow).not.toHaveProperty("checked");
    expect(header.facts).toBeNull();
  });

  it("is verified when the node writes the domain in upper case", () => {
    const header = accountNameHeader(inputOf({ liveDomain: "NorthPeak.Example" }));
    expect(header.domainLine).toEqual({ text: "northpeak.example", state: "verified", href: "https://northpeak.example" });
    expect(header.howWeKnow?.domain).toBe("northpeak.example");
    expect(header.howWeKnow?.tomlHref).toBe("https://northpeak.example/.well-known/xrp-ledger.toml");
    expect(header.howWeKnow?.descGivesName).toBe(true);
    // The name that is the domain is still the domain: the case of the node's text does not make the desc.
    const plain = accountNameHeader(inputOf({ liveDomain: "NorthPeak.Example", entry: verified({ display_name: { text: "northpeak.example", kind: "verified" } }) }));
    expect(plain.howWeKnow?.descGivesName).toBe(false);
  });

  it("is verified by the entry's domain when the node did not answer (no live domain)", () => {
    const header = accountNameHeader(inputOf({ liveDomain: null }));
    expect(header.domainLine).toEqual({ text: "northpeak.example", state: "verified", href: "https://northpeak.example" });
    expect(header.howWeKnow).not.toBeNull();
  });

  it("is not verified by a domain the node shows if the entry's is another (the index is behind): the domain is pending", () => {
    const header = accountNameHeader(inputOf({ liveDomain: "newhome.example", toml: null }));
    expect(header.domainLine).toEqual({ text: "newhome.example", state: "pending", note: "Not checked yet." });
    expect(header.howWeKnow).toBeNull();
    expect(header.facts).toBeNull();
    expect(header.title).toEqual({ text: "Northpeak Treasury", kind: "verified" });
  });

  it("has the labels' marks beside the name", () => {
    const header = accountNameHeader(inputOf({ entry: verified({ labels: { advisory: { description: "Withdrawals paused" } } }) }));
    expect(header.labelMarks).toEqual(["advisory"]);
    expect(header.title).toEqual({ text: "Northpeak Treasury", kind: "verified" });
  });
});

describe("accountNameHeader: named by GateHub", () => {
  const named = (entry: Partial<AccountNameEntry> = {}): AccountNameEntry => ({
    address: ADDRESS,
    display_name: { text: "Harborline Exchange", kind: "account" },
    account_name: "Harborline Exchange",
    ...entry,
  });

  it("has no domain line, and the help sentence, when the account has no domain", () => {
    const header = accountNameHeader({ address: ADDRESS, entry: named(), liveDomain: null, toml: null, network: XRPL });
    expect(header.title).toEqual({ text: "Harborline Exchange", kind: "account" });
    expect(header.domainLine).toBeNull();
    expect(header.howWeKnow).toBeNull();
    expect(header.facts).toBeNull();
    expect(header.help).toBe("named");
  });

  it("has the account network name in the title, when it is set and is not the name", () => {
    const header = accountNameHeader({ address: ADDRESS, entry: named({ account_network_name: "hot wallet" }), liveDomain: null, toml: null, network: XRPL });
    expect(header.title).toEqual({ text: "Harborline Exchange", kind: "account", network: "hot wallet" });
    const same = accountNameHeader({ address: ADDRESS, entry: named({ account_network_name: "Harborline Exchange" }), liveDomain: null, toml: null, network: XRPL });
    expect(same.title).toEqual({ text: "Harborline Exchange", kind: "account" });
  });

  it("has its domain not verified, with the sentence, when the toml does not list the account", () => {
    const toml = tomlOf({ domain: "harborline.example", accounts: [{ address: ISSUER }], principals: undefined });
    const header = accountNameHeader({ address: ADDRESS, entry: named({ domain: "harborline.example" }), liveDomain: "harborline.example", toml, network: XRPL });
    expect(header.title).toEqual({ text: "Harborline Exchange", kind: "account" });
    expect(header.domainLine).toEqual({
      text: "harborline.example",
      state: "not-verified",
      note: `This account names harborline.example in its Domain field, but harborline.example's xrp-ledger.toml does not list the account. ${WITHOUT_VOUCHING}`,
    });
    expect(header.domainLine).not.toHaveProperty("href");
    expect(header.howWeKnow).toBeNull();
    expect(header.facts).toBeNull();
    expect(header.help).toBe("named");
  });
});

describe("accountNameHeader: a domain that is not verified", () => {
  const notVerified = (toml: Loaded<TomlAnswer> | null, network = XRPL, entry = unvouched()) =>
    accountNameHeader({ address: ADDRESS, entry, liveDomain: "lowtide.example", toml, network });

  const lowtide = (toml: Partial<TomlData> = {}) =>
    tomlOf({ domain: "lowtide.example", toml_url: "https://lowtide.example/.well-known/xrp-ledger.toml", accounts: [{ address: ISSUER, desc: "Lowtide Pier" }], ...toml });

  it("is the domain, as text, with the sentence of a toml that does not list the account", () => {
    const header = notVerified(lowtide());
    expect(header.title).toEqual({ text: "lowtide.example", kind: "domain" });
    expect(header.domainLine).toEqual({
      text: "lowtide.example",
      state: "not-verified",
      note: `This account names lowtide.example in its Domain field, but lowtide.example's xrp-ledger.toml does not list the account. ${WITHOUT_VOUCHING}`,
    });
    expect(header.domainLine).not.toHaveProperty("href");
    expect(header.howWeKnow).toBeNull();
    expect(header.facts).toBeNull();
    expect(header.help).toBeNull();
  });

  it("shows no facts of a toml that does not list the account (they are for a verified domain)", () => {
    expect(notVerified(lowtide({ principals: ["Ines Brandt"] })).facts).toBeNull();
  });

  it("says why the toml could not be read, when the check failed", () => {
    const header = notVerified(lowtide({ status: "failed", reason: "dns_error", accounts: undefined, principals: undefined, currencies: undefined, fetched: undefined, modified: undefined }));
    expect(header.domainLine).toEqual({
      text: "lowtide.example",
      state: "not-verified",
      note: `This account names lowtide.example in its Domain field, but its xrp-ledger.toml could not be read: the DNS lookup failed. ${WITHOUT_VOUCHING}`,
    });
  });

  it("says only that the account names the domain, when the toml call failed", () => {
    const header = notVerified({ state: "failed" });
    expect(header.title).toEqual({ text: "lowtide.example", kind: "domain" });
    expect(header.domainLine).toEqual({
      text: "lowtide.example",
      state: "not-verified",
      note: `This account names lowtide.example in its Domain field. ${WITHOUT_VOUCHING}`,
    });
  });

  it("names xahau.toml on Xahau, in all three sentences", () => {
    const sentence = (toml: Loaded<TomlAnswer>) => notVerified(toml, XAHAU).domainLine?.note;
    expect(sentence(lowtide())).toBe(`This account names lowtide.example in its Domain field, but lowtide.example's xahau.toml does not list the account. ${WITHOUT_VOUCHING}`);
    expect(sentence(lowtide({ status: "failed", reason: "http_status", status_code: 503 }))).toBe(
      `This account names lowtide.example in its Domain field, but its xahau.toml could not be read: the server answered HTTP 503. ${WITHOUT_VOUCHING}`,
    );
    expect(sentence({ state: "failed" })).toBe(`This account names lowtide.example in its Domain field. ${WITHOUT_VOUCHING}`);
  });

  it("is the entry's domain, as text, when the node did not answer (no live domain)", () => {
    const header = accountNameHeader({ address: ADDRESS, entry: unvouched(), liveDomain: null, toml: lowtide(), network: XRPL });
    expect(header.domainLine?.text).toBe("lowtide.example");
    expect(header.domainLine?.state).toBe("not-verified");
    expect(header.domainLine).not.toHaveProperty("href");
  });

  it("has the labels' marks beside the domain", () => {
    const header = notVerified(lowtide(), XRPL, unvouched("lowtide.example", { labels: { spam: { description: "Dust" } } }));
    expect(header.title).toEqual({ text: "lowtide.example", kind: "domain" });
    expect(header.labelMarks).toEqual(["spam"]);
  });
});

describe("accountNameHeader: pending (not checked yet)", () => {
  it("is a well formed live domain that the entry does not name: the index is behind, or the account was dormant", () => {
    const header = accountNameHeader({ address: ADDRESS, entry: { address: ADDRESS }, liveDomain: "newhome.example", toml: null, network: XRPL });
    expect(header.title).toBeNull();
    expect(header.domainLine).toEqual({ text: "newhome.example", state: "pending", note: "Not checked yet." });
    expect(header.domainLine).not.toHaveProperty("href");
    expect(header.howWeKnow).toBeNull();
    expect(header.facts).toBeNull();
    expect(header.help).toBeNull();
  });

  it("is the same for an account the batch has no entry for at all", () => {
    const header = accountNameHeader({ address: ADDRESS, liveDomain: "newhome.example", toml: null, network: XRPL });
    expect(header.domainLine).toEqual({ text: "newhome.example", state: "pending", note: "Not checked yet." });
  });

  it("is a live domain that the entry's other domain does not match", () => {
    const header = accountNameHeader({ address: ADDRESS, entry: unvouched("oldhome.example"), liveDomain: "newhome.example", toml: null, network: XRPL });
    expect(header.domainLine).toEqual({ text: "newhome.example", state: "pending", note: "Not checked yet." });
    expect(header.title).toEqual({ text: "oldhome.example", kind: "domain" });
  });

  it("is a domain whose toml was never read (toml not found), even when the entry names it", () => {
    const header = accountNameHeader({ address: ADDRESS, entry: unvouched(), liveDomain: "lowtide.example", toml: { state: "missing" }, network: XRPL });
    expect(header.domainLine).toEqual({ text: "lowtide.example", state: "pending", note: "Not checked yet." });
    expect(header.howWeKnow).toBeNull();
  });

  it("is a domain the entry names with no display name: the data API could not read its toml store, so nothing is known (unknown is not 'not verified')", () => {
    const entry: AccountNameEntry = { address: ADDRESS, domain: "lowtide.example" };
    const header = accountNameHeader({ address: ADDRESS, entry, liveDomain: "lowtide.example", toml: tomlOf({ domain: "lowtide.example", accounts: [{ address: ISSUER }] }), network: XRPL });
    expect(header.title).toBeNull();
    expect(header.domainLine).toEqual({ text: "lowtide.example", state: "pending", note: "Not checked yet." });
    expect(header.howWeKnow).toBeNull();
    expect(header.facts).toBeNull();
    // The same with a toml call that failed, and with no live domain.
    expect(accountNameHeader({ address: ADDRESS, entry, liveDomain: "lowtide.example", toml: { state: "failed" }, network: XRPL }).domainLine?.state).toBe("pending");
    expect(accountNameHeader({ address: ADDRESS, entry, liveDomain: null, toml: { state: "failed" }, network: XRPL }).domainLine?.state).toBe("pending");
  });

  it("is a domain the entry names whose toml was not asked for (the builder is given no answer to say anything of)", () => {
    const header = accountNameHeader({ address: ADDRESS, entry: unvouched(), liveDomain: "lowtide.example", toml: null, network: XRPL });
    expect(header.domainLine).toEqual({ text: "lowtide.example", state: "pending", note: "Not checked yet." });
  });

  // The page always asks for the toml of the domain the node shows, so when the index is behind the builder has an answer for a domain the entry does not name: whatever it says,
  // it says nothing of the entry's, and the sentence "does not list the account" would be false.
  describe("a domain the node shows and the entry does not name, with the toml of the shown domain answered (the index is behind)", () => {
    const newhome = { domain: "newhome.example", toml_url: "https://newhome.example/.well-known/xrp-ledger.toml" };
    const tomls: [string, Loaded<TomlAnswer>][] = [
      ["a toml that lists the account", tomlOf({ ...newhome })],
      ["a toml whose check failed, with the content of a good read", tomlOf({ ...newhome, status: "failed", reason: "timeout", checked: "2026-10-25T07:00:00.250Z" })],
      ["a toml whose check failed, with no content", tomlOf({ ...newhome, status: "failed", reason: "http_status", status_code: 404, fetched: undefined, accounts: undefined, principals: undefined })],
      ["a toml call that failed", { state: "failed" }],
    ];
    const entries: [string, AccountNameEntry, { text: string; kind: string }][] = [
      ["a verified name for another domain", verified(), { text: "Northpeak Treasury", kind: "verified" }],
      ["another domain that nothing vouches for", unvouched("oldhome.example"), { text: "oldhome.example", kind: "domain" }],
      ["a name from GateHub and another domain", { address: ADDRESS, display_name: { text: "Harborline Exchange", kind: "account" }, domain: "oldhome.example" }, { text: "Harborline Exchange", kind: "account" }],
      ["a name from GateHub and no domain", { address: ADDRESS, display_name: { text: "Harborline Exchange", kind: "account" } }, { text: "Harborline Exchange", kind: "account" }],
    ];
    const rows = entries.flatMap(([entryWhat, entry, title]) => tomls.map(([tomlWhat, toml]): [string, AccountNameEntry, Loaded<TomlAnswer>, { text: string; kind: string }] => [`${entryWhat} and ${tomlWhat}`, entry, toml, title]));

    it.each(rows)("is pending, with no how we know and no facts: %s", (_what, entry, toml, title) => {
      const header = accountNameHeader({ address: ADDRESS, entry, liveDomain: "newhome.example", toml, network: XRPL });
      expect(header.domainLine).toEqual({ text: "newhome.example", state: "pending", note: "Not checked yet." });
      expect(header.howWeKnow).toBeNull();
      expect(header.facts).toBeNull();
      expect(header.title).toEqual(title);
    });
  });

  it("is a domain beside a name of a kind this build does not know, which is no name: nothing is known, whatever the toml says", () => {
    const entry: AccountNameEntry = { address: ADDRESS, display_name: { text: "Curated Name", kind: "curated" }, domain: "lowtide.example" };
    const lowtide = tomlOf({ domain: "lowtide.example", toml_url: "https://lowtide.example/.well-known/xrp-ledger.toml", accounts: [{ address: ISSUER }] });
    const failed = tomlOf({ domain: "lowtide.example", toml_url: "https://lowtide.example/.well-known/xrp-ledger.toml", status: "failed", reason: "timeout" });
    for (const toml of [lowtide, failed, { state: "failed" } as const]) {
      const header = accountNameHeader({ address: ADDRESS, entry, liveDomain: "lowtide.example", toml, network: XRPL });
      expect(header.title).toBeNull();
      expect(header.domainLine).toEqual({ text: "lowtide.example", state: "pending", note: "Not checked yet." });
      expect(header.howWeKnow).toBeNull();
      expect(header.facts).toBeNull();
    }
  });
});

describe("accountNameHeader: a domain that is no domain", () => {
  it("is text with no mark when it is a URL: no state, no link, no note", () => {
    const header = accountNameHeader({ address: ADDRESS, entry: { address: ADDRESS }, liveDomain: "https://x.com", toml: null, network: XRPL });
    expect(header.domainLine).toEqual({ text: "https://x.com", state: "none" });
    expect(header.domainLine).not.toHaveProperty("href");
    expect(header.domainLine).not.toHaveProperty("note");
    expect(header.howWeKnow).toBeNull();
    expect(header.facts).toBeNull();
  });

  it("keeps the text of an IPFS hash as the account wrote it, in its case", () => {
    const hash = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
    const header = accountNameHeader({ address: ADDRESS, liveDomain: hash, toml: null, network: XRPL });
    expect(header.domainLine).toEqual({ text: hash, state: "none" });
  });

  it("is none for a name that is not well formed, also beside a name from the batch", () => {
    for (const bad of ["localhost", "a.b", "-bad.example", "bad-.example", "under_score.example", "192.0.2.1", "x.com/path", "x.com:8080", "sp ace.example"]) {
      const header = accountNameHeader({ address: ADDRESS, entry: verified(), liveDomain: bad, toml: null, network: XRPL });
      expect(header.domainLine, bad).toEqual({ text: bad, state: "none" });
    }
  });
});

describe("accountNameHeader: an account with no domain", () => {
  it("has no domain line, no how we know and no facts, for a deleted account whose entry has no domain (the data API gives a deleted account none)", () => {
    const deleted = accountNameHeader({ address: ADDRESS, entry: { address: ADDRESS, labels: { scam: { description: "Fake giveaway" } } }, liveDomain: null, toml: null, network: XRPL });
    expect(deleted.domainLine).toBeNull();
    expect(deleted.howWeKnow).toBeNull();
    expect(deleted.facts).toBeNull();
    // A deleted account keeps its labels (6.4).
    expect(deleted.labelMarks).toEqual(["scam"]);
    expect(deleted.labels).toHaveLength(1);
  });

  it("has nothing at all without an entry, and with an entry nothing is said of", () => {
    const empty = { title: null, labels: [], labelMarks: [], domainLine: null, howWeKnow: null, facts: null, help: null };
    expect(accountNameHeader({ address: ADDRESS, liveDomain: null, toml: null, network: XRPL })).toEqual(empty);
    expect(accountNameHeader({ address: ADDRESS, entry: { address: ADDRESS }, liveDomain: null, toml: null, network: XRPL })).toEqual(empty);
  });

  it("shows the entry's domain when there is no live domain, whatever the reason (the general rule: the node's, else the entry's)", () => {
    const header = accountNameHeader({ address: ADDRESS, entry: unvouched(), liveDomain: null, toml: { state: "failed" }, network: XRPL });
    expect(header.domainLine?.text).toBe("lowtide.example");
    expect(header.domainLine?.state).toBe("not-verified");
  });

  it("shows the node's domain over the entry's", () => {
    const header = accountNameHeader({ address: ADDRESS, entry: unvouched("oldhome.example"), liveDomain: "newhome.example", toml: null, network: XRPL });
    expect(header.domainLine?.text).toBe("newhome.example");
  });
});

describe("accountNameHeader: the title", () => {
  it("is the name without its bidi controls, and null for a name that was nothing else", () => {
    const entry: AccountNameEntry = { address: ADDRESS, display_name: { text: "\u202ENorthpeak\u202C Treasury", kind: "account" }, account_network_name: "\u2067hot wallet\u2069" };
    expect(accountNameHeader({ address: ADDRESS, entry, liveDomain: null, toml: null, network: XRPL }).title).toEqual({ text: "Northpeak Treasury", kind: "account", network: "hot wallet" });
    const controls: AccountNameEntry = { address: ADDRESS, display_name: { text: "\u202E\u202C", kind: "account" } };
    expect(accountNameHeader({ address: ADDRESS, entry: controls, liveDomain: null, toml: null, network: XRPL }).title).toBeNull();
  });

  it("is null for an address with no name, and for a kind this build does not know", () => {
    expect(accountNameHeader({ address: ADDRESS, entry: { address: ADDRESS, account_network_name: "hot wallet" }, liveDomain: null, toml: null, network: XRPL }).title).toBeNull();
    const curated: AccountNameEntry = { address: ADDRESS, display_name: { text: "Curated Name", kind: "curated" } };
    const header = accountNameHeader({ address: ADDRESS, entry: curated, liveDomain: null, toml: null, network: XRPL });
    expect(header.title).toBeNull();
    expect(header.help).toBeNull();
  });
});

describe("accountNameHeader: the label banners", () => {
  const labelled = (labels: AccountNameEntry["labels"]): NameHeaderInput => ({ address: ADDRESS, entry: { address: ADDRESS, labels }, liveDomain: null, toml: null, network: XRPL });

  it("has one banner for each label, in the entry's order, with the words and the source", () => {
    const header = accountNameHeader(
      labelled({
        scam: { description: "Fake giveaway", source: "Harbor compliance desk", url: "https://harborline.example/reports/1" },
        spam: { description: "Dust payments", source: "Harbor compliance desk" },
        advisory: { description: "Named in a warning" },
      }),
    );
    expect(header.labelMarks).toEqual(["scam", "spam", "advisory"]);
    expect(header.labels).toEqual([
      { label: "scam", title: "Labelled scam by GateHub", description: "Fake giveaway", source: "Harbor compliance desk", href: "https://harborline.example/reports/1" },
      { label: "spam", title: "Labelled spam by GateHub", description: "Dust payments", source: "Harbor compliance desk" },
      { label: "advisory", title: "Labelled advisory by GateHub", description: "Named in a warning" },
    ]);
    expect(header.labels[1]).not.toHaveProperty("href");
    expect(header.labels[2]).not.toHaveProperty("source");
  });

  it("keeps a label this build does not know, as written, and a description that is empty", () => {
    const header = accountNameHeader(labelled({ sanctioned: { description: "" } }));
    expect(header.labelMarks).toEqual(["sanctioned"]);
    expect(header.labels).toEqual([{ label: "sanctioned", title: "Labelled sanctioned by GateHub", description: "" }]);
  });

  it("links a label's url only when it is https", () => {
    const hrefOf = (url: string) => accountNameHeader(labelled({ scam: { description: "Fake", url } })).labels[0]!;
    expect(hrefOf("https://harborline.example/reports/1")).toHaveProperty("href", "https://harborline.example/reports/1");
    for (const url of ["http://harborline.example/reports/1", "javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://harborline.example/r", "//harborline.example/r", "harborline.example/r", "not a url", ""]) {
      expect(hrefOf(url), url).not.toHaveProperty("href");
    }
    // The link is the URL as the browser parses it, not the text as given: "https:host/x" reports https but would resolve as a relative link on an https page, and leading spaces survive.
    expect(hrefOf("https:host/x")).toHaveProperty("href", "https://host/x");
    expect(hrefOf("  https://status.example/x")).toHaveProperty("href", "https://status.example/x");
    expect(hrefOf("https://status.example")).toHaveProperty("href", "https://status.example/");
    // The banner is still there, with its words, when the link is not drawn.
    expect(hrefOf("javascript:alert(1)")).toEqual({ label: "scam", title: "Labelled scam by GateHub", description: "Fake" });
  });
});

describe("accountNameHeader: the page behind a marker (brief)", () => {
  it("gives only the title and the labels", () => {
    const entry = verified({ labels: { scam: { description: "Fake giveaway", url: "https://harborline.example/reports/1" } } });
    const header = accountNameHeader(inputOf({ entry, brief: true }));
    expect(header).toEqual({
      title: { text: "Northpeak Treasury", kind: "verified" },
      labels: [{ label: "scam", title: "Labelled scam by GateHub", description: "Fake giveaway", href: "https://harborline.example/reports/1" }],
      labelMarks: ["scam"],
      domainLine: null,
      howWeKnow: null,
      facts: null,
      help: null,
    });
  });

  it("gives no help sentence for a name from GateHub", () => {
    const entry: AccountNameEntry = { address: ADDRESS, display_name: { text: "Harborline Exchange", kind: "account" } };
    expect(accountNameHeader({ address: ADDRESS, entry, liveDomain: null, toml: null, network: XRPL, brief: true }).help).toBeNull();
    expect(accountNameHeader({ address: ADDRESS, entry, liveDomain: null, toml: null, network: XRPL }).help).toBe("named");
  });

  it("is the same as the full header in what it does give", () => {
    const entry = verified({ account_network_name: "treasury", labels: { advisory: { description: "Paused" } } });
    const full = accountNameHeader(inputOf({ entry }));
    const brief = accountNameHeader(inputOf({ entry, brief: true }));
    expect(brief.title).toEqual(full.title);
    expect(brief.labels).toEqual(full.labels);
    expect(brief.labelMarks).toEqual(full.labelMarks);
  });
});

describe("isProperlyFormedDomain", () => {
  it.each(["northpeak.example", "a.io", "x-y.z-w.example", "sub.domain.example.com", "UPPER.Example", "1a.example", "a".repeat(63) + ".example"])("accepts %s", (domain) => {
    expect(isProperlyFormedDomain(domain)).toBe(true);
  });

  it.each([
    "",
    "a.b",
    "abc",
    "localhost",
    "-a.example",
    "a-.example",
    "a..example",
    ".example",
    "example.",
    "a.example1",
    "a.e-x",
    "x.com/path",
    "https://x.com",
    "x.com:8080",
    "user@x.com",
    "under_score.example",
    "sp ace.example",
    "192.0.2.1",
    "münchen.example",
    "a".repeat(64) + ".example",
  ])("refuses %j", (domain) => {
    expect(isProperlyFormedDomain(domain)).toBe(false);
  });

  it("takes 128 characters, refuses 129, and takes 4", () => {
    const at = (length: number) => `${"a".repeat(63)}.${"b".repeat(length - 63 - 1 - 1 - 7)}.example`;
    expect(at(128)).toHaveLength(128);
    expect(isProperlyFormedDomain(at(128))).toBe(true);
    expect(isProperlyFormedDomain(at(129))).toBe(false);
    expect(isProperlyFormedDomain("a.io")).toBe(true);
  });
});
