import { describe, expect, it } from "vitest";

import { amendmentsSample, SAMPLE_KEYS, validatorRowSample } from "../../test/support/d1-samples";
import type { AmendmentRow, DomainVerification } from "./api-types";
import {
  accountLinks,
  amendmentStatusView,
  compareFee,
  dropsText,
  joinAnd,
  ledgersText,
  moreThan,
  nativeText,
  scoreText,
  shareText,
  statusWord,
  tomlFileOf,
  tomlLink,
  unixOf,
  verificationNote,
  versionText,
  xlsLink,
  yesPercentText,
  yesPercentValue,
  type TextPart,
} from "./validator-facts";

/** The text a note reads as, links and all. */
function plain(parts: readonly TextPart[] | null): string | null {
  if (parts === null) return null;
  return parts.map((part) => (typeof part === "string" ? part : "text" in part ? part.text : "")).join("");
}

describe("unixOf", () => {
  it("reads D1's three forms of time as unix seconds", () => {
    expect(unixOf("2026-10-23T09:34:00Z")).toBe(1792748040);
    expect(unixOf("2026-10-19T19:15:52.489Z")).toBe(1792437352); // the milliseconds are dropped, not rounded
    expect(unixOf("2025-02-03")).toBe(1738540800); // a day is its UTC midnight
  });

  it("reads a time with no zone as UTC, as the date functions do", () => {
    expect(unixOf("2026-10-23T09:34:00")).toBe(1792748040);
    expect(unixOf("2026-10-23 09:34:00")).toBe(1792748040);
  });

  it.each(["", "soon", "12", "Oct 23", "2026-13-45", "2026-10-23T25:00:00Z"])("is NaN for %j, which is not a time", (text) => {
    expect(unixOf(text)).toBeNaN();
  });
});

describe("scoreText", () => {
  it.each([
    ["0.9998", "99.98%"],
    ["1.0000", "100.00%"],
    ["0.0000", "0.00%"],
    ["0.5", "50.00%"],
    [undefined, "—"],
  ])("scoreText(%j) is %s", (score, text) => {
    expect(scoreText(score)).toBe(text);
  });

  it("is a dash for what is not a number", () => {
    expect(scoreText("")).toBe("—");
    expect(scoreText("high")).toBe("—");
  });

  it("rounds half up, exactly", () => {
    expect(scoreText("0.99995")).toBe("100.00%");
    expect(scoreText("0.99994")).toBe("99.99%");
  });
});

describe("ledgersText", () => {
  it("writes ledger counts with and without partial", () => {
    expect(ledgersText({ missed: 4, total: 22096, partial: 1 })).toBe("4 missed of 22,096 validated ledgers · 1 partial");
    expect(ledgersText({ missed: 4, total: 22096, partial: 0 })).toBe("4 missed of 22,096 validated ledgers");
    expect(ledgersText({ missed: 0, total: 1_234_567, partial: 12 })).toBe("0 missed of 1,234,567 validated ledgers · 12 partial");
  });
});

describe("dropsText and nativeText", () => {
  it("writes fees and reserves exactly", () => {
    expect(dropsText("0.00001")).toBe("10 drops");
    expect(dropsText("0.000012")).toBe("12 drops");
    expect(dropsText("0.000001")).toBe("1 drop");
    expect(dropsText("0")).toBe("0 drops");
    expect(dropsText("1")).toBe("1,000,000 drops");
    expect(nativeText("1", "XRP")).toBe("1 XRP");
    expect(nativeText("0.2", "XRP")).toBe("0.2 XRP");
    expect(nativeText("10000", "XAH")).toBe("10,000 XAH");
  });

  it("writes a number once, whatever zeros D1's text carries", () => {
    expect(dropsText("0.000010")).toBe("10 drops");
    expect(nativeText("1.0", "XRP")).toBe("1 XRP");
    expect(nativeText("0.20", "XRP")).toBe("0.2 XRP");
  });

  it("does not write a number as a float", () => {
    // 0.1 + 0.2 and 1e-7 × 1e6 are where doubles go wrong; the text goes through a decimal type.
    expect(dropsText("0.0000003")).toBe("0.3 drops");
    expect(dropsText("1e-5")).toBe("10 drops");
  });

  it("is a dash for what is not a number, with no unit after it", () => {
    expect(dropsText("")).toBe("—");
    expect(dropsText("ten")).toBe("—");
    expect(dropsText("0x10")).toBe("—");
    expect(nativeText("", "XRP")).toBe("—");
    expect(nativeText("lots", "XAH")).toBe("—");
  });
});

describe("versionText", () => {
  it("writes a Xahau build only when asked", () => {
    const xahau = { version: "2026.10.13", version_build: 4119 };
    expect(versionText(xahau, true)).toBe("2026.10.13 · build 4119");
    expect(versionText(xahau, false)).toBe("2026.10.13");
    expect(versionText({ version: "3.4.1" }, true)).toBe("3.4.1");
    expect(versionText({ version: "3.4.1", version_build: 0 }, true)).toBe("3.4.1");
  });

  it("has no text for a validator that reported no version", () => {
    expect(versionText({}, true)).toBeNull();
    expect(versionText({ version_build: 4119 }, true)).toBeNull();
    expect(versionText({ version: "" }, false)).toBeNull();
  });
});

describe("yes shares", () => {
  it("writes yes shares, with — for no trusted validators", () => {
    expect(yesPercentText(31, 35)).toBe("88.6%");
    expect(yesPercentValue(31, 35)).toBe("88.57");
    expect(yesPercentText(0, 0)).toBe("—");
    expect(yesPercentValue(0, 0)).toBeNull();
  });

  it("keeps the decimals when there is nothing to round", () => {
    expect(yesPercentText(0, 35)).toBe("0.0%");
    expect(yesPercentValue(0, 35)).toBe("0.00");
    expect(yesPercentText(35, 35)).toBe("100.0%");
    expect(yesPercentValue(35, 35)).toBe("100.00");
  });

  it("rounds half up, exactly", () => {
    expect(yesPercentText(1, 16)).toBe("6.3%"); // 6.25
    expect(yesPercentValue(1, 16)).toBe("6.25");
    expect(yesPercentValue(1, 32)).toBe("3.13"); // 3.125
    expect(yesPercentText(1, 3)).toBe("33.3%");
    expect(yesPercentText(2, 3)).toBe("66.7%");
    expect(yesPercentValue(2, 3)).toBe("66.67");
  });

  it("is a dash for a negative count or one that is not a number", () => {
    expect(yesPercentText(-1, 35)).toBe("—");
    expect(yesPercentText(Number.NaN, 35)).toBe("—");
    expect(yesPercentText(1, Number.NaN)).toBe("—");
    expect(yesPercentValue(1, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("shareText", () => {
  it("writes table shares with one decimal", () => {
    expect(shareText(878, 1000)).toBe("87.8%");
    expect(shareText(30, 34)).toBe("88.2%");
    expect(shareText(1, 8)).toBe("12.5%");
    expect(shareText(0, 34)).toBe("0.0%");
    expect(shareText(34, 34)).toBe("100.0%");
  });

  it("is a dash for a share of nothing", () => {
    expect(shareText(0, 0)).toBe("—");
    expect(shareText(3, 0)).toBe("—");
  });
});

describe("compareFee", () => {
  it("compares fee votes as numbers", () => {
    expect(compareFee("0.000012", "0.00001")).toBe("higher");
    expect(compareFee("0.000005", "0.00001")).toBe("lower");
    expect(compareFee("0.2", "0.2")).toBe("same");
    expect(compareFee("1", "1.0")).toBe("same");
    expect(compareFee("10", "9")).toBe("higher"); // not as text
    expect(compareFee("0.00001", "0.000010")).toBe("same");
  });

  it("is never a claim about what it cannot compare", () => {
    // D1's fees are checked to be decimals before a builder sees them, so this is not reached; it must still not throw.
    expect(() => compareFee("n/a", "1")).not.toThrow();
    expect(compareFee("n/a", "1")).toBe("same");
  });
});

describe("moreThan and joinAnd", () => {
  it("says more than 80%", () => {
    expect(moreThan(80)).toBe("more than 80%");
    expect(moreThan(66.5)).toBe("more than 66.5%");
  });

  it("joins a list the way a sentence does", () => {
    expect(joinAnd([])).toBe("");
    expect(joinAnd(["a"])).toBe("a");
    expect(joinAnd(["a", "b"])).toBe("a and b");
    expect(joinAnd(["a", "b", "c"])).toBe("a, b and c");
    expect(joinAnd(["vl.ripple.com", "unl.xrplf.org"])).toBe("vl.ripple.com and unl.xrplf.org");
    expect(joinAnd(["a", "b", "c", "d"])).toBe("a, b, c and d");
  });
});

describe("tomlFileOf", () => {
  it("names the file each network's domains publish", () => {
    expect(tomlFileOf("rippled")).toBe("xrp-ledger.toml");
    expect(tomlFileOf("xahaud")).toBe("xahau.toml");
  });
});

describe("tomlLink", () => {
  const verified = (toml_url: string): DomainVerification => ({ status: "verified", toml_url });

  it.each([
    ["https://other.example/.well-known/xrp-ledger.toml"],
    ["https://a.example/xrp-ledger.toml"],
    ["http://a.example/.well-known/xrp-ledger.toml"],
    ["https://a.example/.well-known/xahau.toml"],
  ])("does not link the TOML %s for a.example on XRPL", (url) => {
    expect(tomlLink({ status: "verified", toml_url: url } as DomainVerification, "a.example", "rippled")).toBeNull();
  });

  it.each([
    ["https://a.example.evil.example/.well-known/xrp-ledger.toml"],
    ["https://evil.example/a.example/.well-known/xrp-ledger.toml"],
    ["https://a.example:8443/.well-known/xrp-ledger.toml"],
    ["https://user@a.example/.well-known/xrp-ledger.toml"],
    ["https://a.example/.well-known/xrp-ledger.toml?x=1"],
    ["https://a.example/.well-known/xrp-ledger.toml#x"],
    ["https://A.example/.well-known/xrp-ledger.toml"],
    ["https://a.example/.well-known/xrp-ledger.toml/"],
    [" https://a.example/.well-known/xrp-ledger.toml"],
  ])("does not link %s either: only the exact address of the validator's own domain", (url) => {
    expect(tomlLink(verified(url), "a.example", "rippled")).toBeNull();
  });

  it("links a verified TOML, never an unverified one", () => {
    expect(tomlLink(verified("https://a.example/.well-known/xrp-ledger.toml"), "a.example", "rippled")).toBe("https://a.example/.well-known/xrp-ledger.toml");
    expect(tomlLink(verified("https://a.example/.well-known/xahau.toml"), "a.example", "xahaud")).toBe("https://a.example/.well-known/xahau.toml");
    // The same address, not verified: anyone can put any domain in a manifest.
    const address = "https://a.example/.well-known/xrp-ledger.toml";
    expect(tomlLink({ status: "unverified", reason: "not_listed", toml_url: address, checked: "2026-10-19T19:14:12.750Z" }, "a.example", "rippled")).toBeNull();
    expect(tomlLink({ status: "pending", toml_url: address }, "a.example", "rippled")).toBeNull();
  });

  it("has no link without a domain or without a verification", () => {
    const address = "https://a.example/.well-known/xrp-ledger.toml";
    expect(tomlLink(verified(address), undefined, "rippled")).toBeNull();
    expect(tomlLink(verified(address), "", "rippled")).toBeNull();
    expect(tomlLink(undefined, "a.example", "rippled")).toBeNull();
  });

  it("does not build an address out of a domain that is not a host name", () => {
    // The check compares text, and a domain with a path in it would make the "own domain" address a different host's.
    expect(tomlLink(verified("https://a.example/x/.well-known/xrp-ledger.toml"), "a.example/x", "rippled")).toBeNull();
    expect(tomlLink(verified("https://a.example@evil.example/.well-known/xrp-ledger.toml"), "a.example@evil.example", "rippled")).toBeNull();
  });
});

describe("xlsLink", () => {
  const repo = "https://github.com/XRPLF/XRPL-Standards/";

  it("links XLS documents only on github.com under /XRPLF/XRPL-Standards/", () => {
    expect(xlsLink(`${repo}tree/master/XLS-0030-automated-market-maker`)).toBe(`${repo}tree/master/XLS-0030-automated-market-maker`);
    expect(xlsLink(`${repo}discussions/92`)).toBe(`${repo}discussions/92`);
    expect(xlsLink(repo)).toBe(repo);
  });

  it.each([
    undefined,
    "",
    "XLS-30",
    "http://github.com/XRPLF/XRPL-Standards/discussions/92",
    "https://gitlab.com/XRPLF/XRPL-Standards/discussions/92",
    "https://github.com.evil.example/XRPLF/XRPL-Standards/discussions/92",
    "https://evil.example/https://github.com/XRPLF/XRPL-Standards/discussions/92",
    "https://github.com@evil.example/XRPLF/XRPL-Standards/discussions/92",
    "https://user@github.com/XRPLF/XRPL-Standards/discussions/92",
    "https://github.com:8443/XRPLF/XRPL-Standards/discussions/92",
    "https://github.com/XRPLF/other-repo/discussions/92",
    "https://github.com/OtherOrg/XRPL-Standards/discussions/92",
    "https://github.com/XRPLF/XRPL-Standards",
    "https://github.com/XRPLF/XRPL-Standards-fork/discussions/92",
    "https://github.com/XRPLF/XRPL-Standards/../other-repo/discussions/92",
    "https://github.com/XRPLF/XRPL-Standards/%2e%2e/other-repo/x",
    "javascript:alert(1)//github.com/XRPLF/XRPL-Standards/",
  ])("does not link %j", (url) => {
    expect(xlsLink(url)).toBeNull();
  });
});

describe("accountLinks", () => {
  const ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
  const OTHER = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";

  it("links each address to the account page of the network", () => {
    expect(accountLinks("xrpl", [ADDRESS, OTHER])).toEqual([
      { address: ADDRESS, href: `/xrpl/account/${ADDRESS}` },
      { address: OTHER, href: `/xrpl/account/${OTHER}` },
    ]);
    expect(accountLinks("xahau", [ADDRESS])).toEqual([{ address: ADDRESS, href: `/xahau/account/${ADDRESS}` }]);
  });

  it("skips an account that is not a classic address, and has no line without the field", () => {
    const bad = ["", "not an address", `${ADDRESS.slice(0, -1)}X`, "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyT", SAMPLE_KEYS[0], "javascript:alert(1)", `/${ADDRESS}`];
    expect(accountLinks("xrpl", [ADDRESS, ...bad, OTHER])).toEqual([
      { address: ADDRESS, href: `/xrpl/account/${ADDRESS}` },
      { address: OTHER, href: `/xrpl/account/${OTHER}` },
    ]);
    expect(accountLinks("xrpl", undefined)).toBeNull();
  });

  it("has no line when nothing is left to link", () => {
    expect(accountLinks("xrpl", [])).toBeNull();
    expect(accountLinks("xrpl", ["not an address"])).toBeNull();
  });
});

describe("verificationNote", () => {
  const DOMAIN = "a.example";
  const unverified = (reason: string | undefined, extra: Partial<DomainVerification> = {}): DomainVerification => ({
    status: "unverified",
    ...(reason === undefined ? {} : { reason }),
    toml_url: `https://${DOMAIN}/.well-known/xrp-ledger.toml`,
    checked: "2026-10-19T19:14:12.750Z",
    ...extra,
  });

  // Every row of the spec's 4.2, with the file name per network.
  const FILES = [
    ["rippled", "xrp-ledger.toml"],
    ["xahaud", "xahau.toml"],
  ] as const;

  describe.each(FILES)("on %s, the file is %s", (software, file) => {
    const CASES: [string, DomainVerification, string][] = [
      ["verified", { status: "verified", toml_url: `https://${DOMAIN}/.well-known/${file}`, checked: "2026-10-19T19:15:52.489Z", verified: "2026-10-19T19:15:52.489Z" }, `The ${file} at ${DOMAIN} lists this master key. Checked Oct 19, 2026, 19:15 UTC.`],
      ["not_listed", unverified("not_listed"), `The ${file} at ${DOMAIN} does not list this master key.`],
      ["toml_invalid", unverified("toml_invalid"), `The ${file} at ${DOMAIN} could not be read as TOML.`],
      ["too_large", unverified("too_large"), `The ${file} at ${DOMAIN} is larger than 256 KiB.`],
      ["http_status", unverified("http_status", { status_code: 503 }), `${DOMAIN} answered HTTP 503 for its ${file}.`],
      ["dns_error", unverified("dns_error"), `${DOMAIN} could not be reached (the DNS lookup failed). The data API tries again within the hour.`],
      ["connect_error", unverified("connect_error"), `${DOMAIN} could not be reached (the connection failed). The data API tries again within the hour.`],
      ["tls_error", unverified("tls_error"), `${DOMAIN} could not be reached (TLS failed). The data API tries again within the hour.`],
      ["timeout", unverified("timeout"), `${DOMAIN} could not be reached (it timed out). The data API tries again within the hour.`],
      ["redirect_rejected", unverified("redirect_rejected"), `${DOMAIN} sent the request where the data API does not follow.`],
      ["blocked_address", unverified("blocked_address"), `${DOMAIN} sent the request where the data API does not follow.`],
      ["domain_invalid", unverified("domain_invalid"), "The manifest's domain is not a valid domain name."],
      ["manifest_unverified", unverified("manifest_unverified"), "The manifest that names this domain could not be verified."],
      ["pending", { status: "pending", toml_url: `https://${DOMAIN}/.well-known/${file}` }, "The domain has not been checked yet."],
    ];

    it.each(CASES)("says %s", (_name, dv, sentence) => {
      expect(plain(verificationNote(dv, DOMAIN, software))).toBe(sentence);
    });

    it("links the file name of a verified domain, to its own address and with nofollow", () => {
      const toml_url = `https://${DOMAIN}/.well-known/${file}`;
      expect(verificationNote({ status: "verified", toml_url, checked: "2026-10-19T19:15:52.489Z" }, DOMAIN, software)).toEqual([
        "The ",
        { text: file, href: toml_url, external: "nofollow" },
        ` at ${DOMAIN} lists this master key. Checked Oct 19, 2026, 19:15 UTC.`,
      ]);
    });
  });

  it("links no file name that is not the validator's own, even for a domain that verified", () => {
    const parts = verificationNote({ status: "verified", toml_url: "https://other.example/.well-known/xrp-ledger.toml", checked: "2026-10-19T19:15:52.489Z" }, DOMAIN, "rippled");
    expect(parts).toEqual([`The xrp-ledger.toml at ${DOMAIN} lists this master key. Checked Oct 19, 2026, 19:15 UTC.`]);
    // The Xahau file on XRPL is another network's file.
    expect(verificationNote({ status: "verified", toml_url: `https://${DOMAIN}/.well-known/xahau.toml`, checked: "2026-10-19T19:15:52.489Z" }, DOMAIN, "rippled")).toEqual([
      `The xrp-ledger.toml at ${DOMAIN} lists this master key. Checked Oct 19, 2026, 19:15 UTC.`,
    ]);
  });

  it("links nothing for a domain that did not verify", () => {
    for (const reason of ["not_listed", "toml_invalid", "too_large", "http_status", "dns_error", "timeout", "domain_invalid", undefined]) {
      const parts = verificationNote(unverified(reason, { status_code: 404 }), DOMAIN, "rippled");
      expect(parts?.every((part) => typeof part === "string")).toBe(true);
    }
  });

  it("does not say when a verified domain was checked without the time", () => {
    expect(plain(verificationNote({ status: "verified", toml_url: `https://${DOMAIN}/.well-known/xrp-ledger.toml` }, DOMAIN, "rippled"))).toBe(
      `The xrp-ledger.toml at ${DOMAIN} lists this master key.`,
    );
  });

  it.each([
    ["a reason a newer D1 sends", unverified("quantum_error")],
    ["no reason at all", unverified(undefined)],
    ["an HTTP status without its code", unverified("http_status")],
  ])("says the domain could not be verified for %s", (_name, dv) => {
    expect(plain(verificationNote(dv, DOMAIN, "rippled"))).toBe("The domain could not be verified.");
  });

  it("says the same for a status a newer D1 sends", () => {
    const dv = { status: "revoked", toml_url: `https://${DOMAIN}/.well-known/xrp-ledger.toml` } as unknown as DomainVerification;
    expect(plain(verificationNote(dv, DOMAIN, "rippled"))).toBe("The domain could not be verified.");
  });

  it("has no note without a domain", () => {
    expect(verificationNote(undefined, undefined, "rippled")).toBeNull();
    expect(verificationNote(unverified("not_listed"), undefined, "rippled")).toBeNull();
    expect(verificationNote(unverified("not_listed"), "", "rippled")).toBeNull();
  });

  it("has no note for a domain the data API sent no verification of", () => {
    expect(verificationNote(undefined, DOMAIN, "rippled")).toBeNull();
  });

  it("reads the fixture's verified validator", () => {
    const row = validatorRowSample();
    expect(plain(verificationNote(row.domain_verification, row.domain, "rippled"))).toBe(
      "The xrp-ledger.toml at northpeak.example lists this master key. Checked Oct 19, 2026, 19:15 UTC.",
    );
  });
});

describe("amendmentStatusView", () => {
  const rows = amendmentsSample().amendments;
  const row = (status: string): AmendmentRow => rows.find((r) => r.status === status)!;
  const base: AmendmentRow = { id: "A".repeat(64), status: "unknown" };

  it("maps each amendment status to its view", () => {
    // The sample's majority row: XChainBridge, 31 of 35, expected to activate on 2026-10-31.
    expect(amendmentStatusView(row("majority"))).toEqual({ status: "majority", activation: { at: 1793462060, fallback: "expected Oct 31" } });
    expect(amendmentStatusView(row("enabled"))).toEqual({ status: "enabled", retired: false });
    expect(amendmentStatusView(row("voting"))).toEqual({ status: "voting", share: "11.4%" });
    expect(amendmentStatusView(row("unknown"))).toEqual({ status: "unknown", share: "0.0%" });
    expect(amendmentStatusView({ ...base, status: "obsolete" })).toEqual({ status: "obsolete" });
  });

  it("writes a majority's day from its activation, in UTC", () => {
    const at = (expected_activation: string) =>
      amendmentStatusView({ ...base, status: "majority", majority: { since: "2026-10-09T09:34:00Z", expected_activation } });
    expect(at("2026-10-23T09:34:00Z")).toEqual({ status: "majority", activation: { at: 1792748040, fallback: "expected Oct 23" } });
    // The day is the UTC day whatever the clock of the machine: a minute either side of midnight.
    expect(at("2026-10-23T23:59:00Z")).toMatchObject({ activation: { fallback: "expected Oct 23" } });
    expect(at("2026-10-24T00:00:00Z")).toMatchObject({ activation: { fallback: "expected Oct 24" } });
    expect(at("2026-01-02T00:30:00Z")).toMatchObject({ activation: { fallback: "expected Jan 2" } });
  });

  it("keeps the retired flag of an enabled amendment, and ignores whatever else its fields say", () => {
    expect(amendmentStatusView({ ...base, status: "enabled", retired: true })).toEqual({ status: "enabled", retired: true });
    // From the metadata file, with a day only; with nothing at all (the type allows both).
    expect(amendmentStatusView({ ...base, status: "enabled", enabled: { source: "metadata" } })).toEqual({ status: "enabled", retired: false });
    expect(amendmentStatusView({ ...base, status: "enabled", enabled: { date: "2025-02-03", source: "metadata" } })).toEqual({ status: "enabled", retired: false });
    expect(amendmentStatusView({ ...base, status: "enabled" })).toEqual({ status: "enabled", retired: false });
  });

  it("is a majority with no moment to count down to when the row has none", () => {
    // A `majority` row without `majority` is not what D1 serves, but the type allows it: no throw, and no invented date.
    // `at` is NaN, which `Countdown` draws as nothing, and the fallback is empty.
    const view = amendmentStatusView({ ...base, status: "majority" });
    expect(view).toEqual({ status: "majority", activation: { at: Number.NaN, fallback: "" } });
    const odd = amendmentStatusView({ ...base, status: "majority", majority: { since: "2026-10-09T09:34:00Z", expected_activation: "soon" } });
    expect(odd).toEqual({ status: "majority", activation: { at: Number.NaN, fallback: "" } });
  });

  it("has no share before a round is stored", () => {
    expect(amendmentStatusView({ ...base, status: "voting" })).toEqual({ status: "voting", share: "—" });
    expect(amendmentStatusView({ ...base, status: "unknown" })).toEqual({ status: "unknown", share: "—" });
    expect(amendmentStatusView({ ...base, status: "voting", votes: { ledger_index: 1, yes: 0, trusted: 0, needed: 1, pct: 0 } })).toEqual({ status: "voting", share: "—" });
  });

  it("is unknown for a status a newer D1 sends", () => {
    expect(amendmentStatusView({ ...base, status: "frozen" as never })).toEqual({ status: "unknown", share: "—" });
  });
});

describe("statusWord", () => {
  it.each([
    ["enabled", "Activated"],
    ["majority", "Activating"],
    ["voting", "Voting"],
    ["obsolete", "Obsolete"],
    ["unknown", "Unknown"],
  ] as const)("calls %s %s", (status, word) => {
    expect(statusWord(status)).toBe(word);
  });

  it("calls a status a newer D1 sends Unknown", () => {
    expect(statusWord("frozen" as never)).toBe("Unknown");
  });
});
