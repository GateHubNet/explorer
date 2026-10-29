import { readdirSync, readFileSync } from "node:fs";
import { isValidClassicAddress } from "ripple-address-codec";
import { describe, expect, it } from "vitest";

// http-fixtures.ts first: the generators it joins (names-fixtures.ts among them) are loaded through it, as `pnpm fixtures:sync` loads them.
import { HTTP, isAmmGenerated, isAnalyticsGenerated, isHandWritten, isMarketGenerated, isNftGenerated, isSynthetic, isValidatorsGenerated } from "../../scripts/http-fixtures";
import { deletedAccounts, FIXED_NAMES, isNamesGenerated, NAMES_SEEDED_MAX, NAMES_SOURCES, namesAnswers, namesFixtures, seededAddresses } from "../../scripts/names-fixtures";
import { fnv1a32 } from "../../app/domain/fnv";
import { collectAddresses } from "../../app/server/names-collect";
import type { AccountNameEntry, AccountNamesResponse, TomlAnswer, TomlData } from "../../app/server/api-types";
import { checkAccountNames, checkToml } from "../../app/server/names-shape";
import { dataApiFile, type NetworkName } from "../support/upstream-core";

// What the display names' fixtures promise the pages of E9 and the end-to-end suite: `account_names.json` and `toml/<domain>.json` of each network, which
// scripts/names-fixtures.ts writes (`pnpm fixtures:sync`) as D4 would answer them (data-api-new `feat/explorer-data-2` at 3feb11a, docs/api-reference.md, "Account names and
// tomls"; the display-name rule of apps/api/src/names/display-name.ts). The fixed cases are the plan's (decision 11), as the controller's ruling Δ1 amends them: a deleted
// account has no domain, so Xahau's `saltmarsh.example` is an active account's.

const NETS: NetworkName[] = ["xrpl", "xahau"];
type Json = Record<string, any>;

/** Every file of a network on disk (paths below test/fixtures/http/), the names' own among them: the generator leaves those out itself. */
function filesOf(net: NetworkName): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(new URL(`${net}/`, HTTP), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = `${entry.parentPath.slice(HTTP.pathname.length)}/${entry.name}`.replace(/^\//, "");
    files.set(path, readFileSync(new URL(path, HTTP), "utf8"));
  }
  return files;
}

const files = { xrpl: filesOf("xrpl"), xahau: filesOf("xahau") };
const answers = { xrpl: namesAnswers("xrpl", files.xrpl), xahau: namesAnswers("xahau", files.xahau) };
const namesPath = (net: NetworkName) => `${net}/data-api/account_names.json`;
const tomlPath = (net: NetworkName, domain: string) => dataApiFile(net, `/v2/toml/${domain}`, "")!;
const onDisk = (path: string): string => readFileSync(new URL(path, HTTP), "utf8");
const namesOf = (net: NetworkName): Record<string, AccountNameEntry> => JSON.parse(onDisk(namesPath(net)));
const tomlOf = (net: NetworkName, domain: string): TomlData | undefined => {
  const path = tomlPath(net, domain);
  return files[net].has(path) ? (JSON.parse(files[net].get(path)!) as TomlAnswer).toml : undefined;
};

// D4's key orders (apps/api/src/names/account-names-object.ts and toml-object.ts at 3feb11a).
const ENTRY_KEYS = ["address", "display_name", "domain", "account_name", "account_network_name", "labels"];
const DISPLAY_NAME_KEYS = ["text", "kind"];
const LABEL_ORDER = ["scam", "spam", "advisory"];
const LABEL_KEYS = ["description", "source", "url"];
const TOML_BODY_KEYS = ["result", "toml"];
const TOML_KEYS = ["domain", "toml_url", "status", "reason", "status_code", "checked", "fetched", "modified", "expires", "accounts", "currencies", "principals", "validators"];
const TOML_ACCOUNT_KEYS = ["address", "desc"];
const TOML_CURRENCY_KEYS = ["code", "issuer", "display_decimals", "symbol", "name", "desc"];

/** An instant of receipt as D4 writes it, to the millisecond. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TOML_URL = { xrpl: (domain: string) => `https://${domain}/.well-known/xrp-ledger.toml`, xahau: (domain: string) => `https://${domain}/.well-known/xahau.toml` };

// ---- The fixed cases -------------------------------------------------------------------------------------------------------------

const NP = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const HARBOR = "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC";
const NP_PARENT = "rpiFwLYi6Gb1ESHYorn2QG1WU5vw2u4exQ";
const HARBOR_PARENT = "rURtT5MMFzSUR54MAq9MKfzBoezTBZbKns";
const TW = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";
const XAHAU_DELETED = "rMoPk1MiYJbmdNL8xr5s11r7jrxzBhJWLD";
const HOOKFIELD = "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8";
/** An active Xahau account the fixtures show (it paid the active account in the newest recorded ledger), which Δ1 gives the failed toml. */
const SALTMARSH = "rJ5mvuNKjbjdghjCn5AGXXJFhJGgqdg9Q5";

const EXPECTED: Record<NetworkName, Record<string, AccountNameEntry>> = {
  xrpl: {
    [NP]: { address: NP, display_name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example" },
    [HARBOR]: {
      address: HARBOR,
      display_name: { text: "Harborline Exchange", kind: "account" },
      account_name: "Harborline Exchange",
      account_network_name: "hot wallet",
      labels: { advisory: { description: "Test label: withdrawals paused", source: "GateHub", url: "https://status.example/harborline" } },
    },
    [NP_PARENT]: { address: NP_PARENT, labels: { spam: { description: "Test label" } } },
    [HARBOR_PARENT]: { address: HARBOR_PARENT, display_name: { text: "lowtide.example", kind: "domain" }, domain: "lowtide.example", labels: { scam: { description: "Test label" } } },
  },
  xahau: {
    [TW]: { address: TW, display_name: { text: "Tidewater Reserve", kind: "verified" }, domain: "tidewater.example" },
    [XAHAU_DELETED]: { address: XAHAU_DELETED, labels: { scam: { description: "Test label" } } },
    [HOOKFIELD]: { address: HOOKFIELD, display_name: { text: "Hookfield Labs", kind: "account" }, account_name: "Hookfield Labs" },
    [SALTMARSH]: { address: SALTMARSH, display_name: { text: "saltmarsh.example", kind: "domain" }, domain: "saltmarsh.example" },
  },
};

/** The `ok` toml of a fixed verified domain: its account with its `desc`, two currencies of that account, the principals and `modified`. */
const verifiedToml = (net: NetworkName, domain: string, address: string, desc: string, prefix: string, dollar: string): TomlData => ({
  domain,
  toml_url: TOML_URL[net](domain),
  status: "ok",
  checked: expect.stringMatching(INSTANT),
  fetched: expect.stringMatching(INSTANT),
  modified: "2026-10-02T00:00:00Z",
  accounts: [{ address, desc }],
  currencies: [
    { code: `${prefix}USD`, issuer: address, display_decimals: 2, name: dollar },
    { code: `${prefix}EUR`, issuer: address },
  ],
  principals: ["Mara Lindqvist", "Tomas Okafor"],
});

const EXPECTED_TOMLS: Record<NetworkName, Record<string, TomlData>> = {
  xrpl: {
    "northpeak.example": verifiedToml("xrpl", "northpeak.example", NP, "Northpeak Treasury", "NP", "Northpeak Dollar"),
    // an `ok` toml that does not list the account: it lists nobody, and D4 leaves an empty list out
    "lowtide.example": { domain: "lowtide.example", toml_url: TOML_URL.xrpl("lowtide.example"), status: "ok", checked: expect.stringMatching(INSTANT), fetched: expect.stringMatching(INSTANT) },
  },
  xahau: {
    "tidewater.example": verifiedToml("xahau", "tidewater.example", TW, "Tidewater Reserve", "TW", "Tidewater Dollar"),
    // a definite failure carries nothing but the check
    "saltmarsh.example": {
      domain: "saltmarsh.example",
      toml_url: TOML_URL.xahau("saltmarsh.example"),
      status: "failed",
      reason: "http_status",
      status_code: 404,
      checked: expect.stringMatching(INSTANT),
    },
  },
};

// ---- The seeded states -----------------------------------------------------------------------------------------------------------

type State = "verified" | "named" | "domain" | "none";
/** The plan's shares: `fnv1a32("<net>:<address>") % 40`, 0–7 verified, 8–12 named by GateHub, 13–16 domain not verified, the rest nothing. */
function hashState(net: NetworkName, address: string): State {
  const at = fnv1a32(`${net}:${address}`) % 40;
  return at < 8 ? "verified" : at < 13 ? "named" : at < 17 ? "domain" : "none";
}
const SHARES: Record<State, number> = { verified: 8 / 40, named: 5 / 40, domain: 4 / 40, none: 23 / 40 };

const stateOf = (entry: AccountNameEntry | undefined): State =>
  entry?.display_name === undefined ? "none" : entry.display_name.kind === "verified" ? "verified" : entry.display_name.kind === "account" ? "named" : "domain";

describe.each(NETS)("the names of %s", (net) => {
  const names = namesOf(net);
  const entries = Object.values(names);
  const seeded = seededAddresses(net, files[net]);
  const deleted = deletedAccounts(net, files[net]);
  const fixed = new Set(FIXED_NAMES[net].map((name) => name.address));

  it("are written by the generator as they are on disk, one entry to a line, sorted by address: lines = entries + 2", () => {
    const written = new Map(namesFixtures(net, files[net]));
    for (const [path, text] of written) expect(onDisk(path), path).toBe(text);
    const text = written.get(namesPath(net))!;
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.trimEnd().split("\n")).toHaveLength(entries.length + 2);
    expect(Object.keys(names)).toEqual([...Object.keys(names)].sort());
    for (const [address, entry] of Object.entries(names)) expect(entry.address).toBe(address);
  });

  it("pass the client's check, each entry for its own address, and every toml for its own domain", () => {
    for (const [address, entry] of Object.entries(names)) {
      const body: AccountNamesResponse = { result: "success", count: 1, account_names: [entry] };
      expect(() => checkAccountNames(body, [address]), address).not.toThrow();
      expect(isValidClassicAddress(address), address).toBe(true);
    }
    for (const { path, value } of answers[net].filter(({ path }) => path.includes("/toml/"))) {
      const domain = path.slice(path.lastIndexOf("/") + 1, -".json".length);
      expect(() => checkToml(value as TomlAnswer, domain), path).not.toThrow();
    }
  });

  it("have the fixed cases as the plan's table and ruling Δ1 say, with their tomls", () => {
    for (const [address, entry] of Object.entries(EXPECTED[net])) expect(names[address], address).toEqual(entry);
    for (const [domain, toml] of Object.entries(EXPECTED_TOMLS[net])) expect(tomlOf(net, domain), domain).toEqual(toml);
    expect(Object.keys(tomlOf(net, net === "xrpl" ? "lowtide.example" : "saltmarsh.example")!)).toEqual(
      net === "xrpl" ? ["domain", "toml_url", "status", "checked", "fetched"] : ["domain", "toml_url", "status", "reason", "status_code", "checked"],
    );
    expect([...fixed].sort()).toEqual(Object.keys(EXPECTED[net]).sort());
  });

  it("have D4's key orders, on the objects before they are written", () => {
    const keys = (object: object, order: readonly string[], what: string) => expect(Object.keys(object), what).toEqual(order.filter((key) => key in object));
    for (const { path, value } of answers[net]) {
      if (path === namesPath(net)) {
        for (const entry of Object.values(value as Record<string, Json>)) {
          keys(entry, ENTRY_KEYS, entry.address);
          if (entry.display_name) keys(entry.display_name, DISPLAY_NAME_KEYS, `${entry.address} display_name`);
          if (entry.labels) {
            keys(entry.labels, LABEL_ORDER, `${entry.address} labels`);
            for (const label of Object.values(entry.labels as Record<string, object>)) keys(label, LABEL_KEYS, `${entry.address} label`);
          }
        }
        continue;
      }
      keys(value as object, TOML_BODY_KEYS, path);
      const toml = (value as TomlAnswer).toml;
      keys(toml, TOML_KEYS, path);
      for (const account of toml.accounts ?? []) keys(account, TOML_ACCOUNT_KEYS, `${path} account`);
      for (const currency of toml.currencies ?? []) keys(currency, TOML_CURRENCY_KEYS, `${path} currency`);
      // D4 leaves an empty list out
      for (const list of ["accounts", "currencies", "principals", "validators"] as const) if (list in toml) expect((toml[list] as unknown[]).length, `${path} ${list}`).toBeGreaterThan(0);
    }
  });

  it("follow D4's display-name rule: verified when the toml of the domain lists the address (its desc, or the domain), else the operator's name, else the domain", () => {
    for (const entry of entries) {
      const toml = entry.domain === undefined ? undefined : tomlOf(net, entry.domain);
      const listing = toml?.accounts?.find((account) => account.address === entry.address);
      const name = entry.account_name ?? entry.account_network_name;
      if (listing && entry.domain) {
        const desc = [...(listing.desc ?? "")];
        expect(entry.display_name, entry.address).toEqual({ text: desc.length >= 1 && desc.length <= 64 ? listing.desc : entry.domain, kind: "verified" });
        expect(toml!.status, entry.address).toBe("ok");
      } else if (name !== undefined) {
        expect(entry.display_name, entry.address).toEqual({ text: name, kind: "account" });
      } else if (entry.domain !== undefined) {
        expect(entry.display_name, entry.address).toEqual({ text: entry.domain, kind: "domain" });
      } else {
        expect(entry.display_name, entry.address).toBeUndefined();
      }
      // only addresses with something to show are written
      expect(Object.keys(entry).length, entry.address).toBeGreaterThan(1);
    }
  });

  it("give every verified entry's domain an `ok` toml that lists its address, and every toml a domain an entry names", () => {
    const domains = new Set(entries.map((entry) => entry.domain).filter((domain) => domain !== undefined));
    for (const entry of entries.filter((each) => each.display_name?.kind === "verified")) {
      const toml = tomlOf(net, entry.domain!);
      expect(toml?.status, entry.address).toBe("ok");
      expect(toml?.fetched, entry.address).toMatch(INSTANT);
      expect(toml?.accounts?.map((account) => account.address), entry.address).toContain(entry.address);
    }
    for (const { path } of answers[net].filter(({ path }) => path.includes("/toml/"))) {
      expect(domains.has(path.slice(path.lastIndexOf("/") + 1, -".json".length)), path).toBe(true);
    }
  });

  it("seed up to NAMES_SEEDED_MAX addresses, collected from the files of each source in turn, by path, none of them fixed", () => {
    const prefix = `${net}/data-api/`;
    const paths = [...files[net].keys()].filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length)).sort();
    const inOrder = NAMES_SOURCES.flatMap((source, at) => paths.filter((path) => source.test(path) && !NAMES_SOURCES.slice(0, at).some((earlier) => earlier.test(path))));
    expect(inOrder.some((path) => path.includes("@binary=true"))).toBe(false);
    const collected = collectAddresses(...inOrder.map((path) => JSON.parse(files[net].get(prefix + path)!)));
    expect(seeded).toEqual(collected.filter((address) => !fixed.has(address)).slice(0, NAMES_SEEDED_MAX));
    // neither network reaches the cap: XRPL has 400 addresses besides the fixed ones, Xahau 86
    expect(seeded.length).toBe(net === "xrpl" ? 400 : 86);
    // every entry is a fixed or a seeded address
    for (const address of Object.keys(names)) expect(fixed.has(address) || seeded.includes(address), address).toBe(true);
  });

  it("give each seeded address the state its hash picks, but a deleted account no domain", () => {
    const counts: Record<State, number> = { verified: 0, named: 0, domain: 0, none: 0 };
    for (const address of seeded) {
      const picked = hashState(net, address);
      const state = stateOf(names[address]);
      if (deleted.has(address) && (picked === "verified" || picked === "domain")) expect(state, address).toBe("none");
      else expect(state, address).toBe(picked);
      counts[state]++;
      if (state === "named") expect(names[address]!.account_name, address).toEqual(expect.any(String));
      // a seeded name has no labels
      expect(names[address]?.labels, address).toBeUndefined();
    }
    for (const state of ["verified", "named", "domain", "none"] as const) {
      const share = SHARES[state] * seeded.length;
      expect(counts[state], `${state}: ${counts[state]} of ${seeded.length}`).toBeGreaterThanOrEqual(Math.floor(share * 0.5));
      expect(counts[state], `${state}: ${counts[state]} of ${seeded.length}`).toBeLessThanOrEqual(Math.ceil(share * 1.5));
    }
    // some named addresses have an account network name (the hash's bit 8), some do not
    const named = seeded.filter((address) => stateOf(names[address]) === "named");
    expect(named.some((address) => names[address]!.account_network_name !== undefined)).toBe(true);
    expect(named.some((address) => names[address]!.account_network_name === undefined)).toBe(true);
    for (const address of named) expect(names[address]!.account_network_name !== undefined, address).toBe((fnv1a32(`${net}:${address}`) & 0x100) !== 0);
  });

  it("give a seeded address a domain of its own, `{word}-{hex4}.example`", () => {
    const domains = seeded.map((address) => names[address]?.domain).filter((domain) => domain !== undefined);
    expect(domains.length).toBeGreaterThan(0);
    for (const domain of domains) expect(domain).toMatch(/^[a-z]+-[0-9a-f]{4}\.example$/);
    const all = entries.map((entry) => entry.domain).filter((domain) => domain !== undefined);
    expect(new Set(all).size).toBe(all.length);
  });

  it("list the first seeded verified address by sort without its desc, so that its name is its domain, and every other with its desc", () => {
    const verified = seeded.filter((address) => stateOf(names[address]) === "verified").sort();
    expect(verified.length).toBeGreaterThan(1);
    const [first, ...rest] = verified;
    const listed = (address: string) => tomlOf(net, names[address]!.domain!)!.accounts!.find((account) => account.address === address)!;
    expect(listed(first!)).toEqual({ address: first });
    expect(names[first!]!.display_name).toEqual({ text: names[first!]!.domain, kind: "verified" });
    for (const address of rest) {
      expect(listed(address).desc, address).toEqual(expect.any(String));
      expect(names[address]!.display_name!.text, address).toBe(listed(address).desc);
    }
  });

  it("give every second seeded domain-not-verified address by sort an `ok` toml that lists nobody, and the others no toml (`toml not found`)", () => {
    const unverified = seeded.filter((address) => stateOf(names[address]) === "domain").sort();
    expect(unverified.length).toBeGreaterThan(1);
    unverified.forEach((address, at) => {
      const toml = tomlOf(net, names[address]!.domain!);
      if (at % 2 === 1) {
        expect(toml, address).toBeDefined();
        expect(Object.keys(toml!), address).toEqual(["domain", "toml_url", "status", "checked", "fetched"]);
        expect(toml!.status).toBe("ok");
      } else {
        expect(toml, address).toBeUndefined();
      }
    });
  });

  it("tell a deleted account by the fixtures' marks, and give none a domain: the hand-written deleted account among them", () => {
    expect(deleted.has(net === "xrpl" ? HARBOR : XAHAU_DELETED)).toBe(true);
    for (const active of [NP, TW, NP_PARENT, HARBOR_PARENT, HOOKFIELD, SALTMARSH]) expect(deleted.has(active), active).toBe(false);
    for (const address of deleted) expect(names[address]?.domain, address).toBeUndefined();
    if (net === "xrpl") {
      // the AMM pool SNK/XRP, deleted in the recordings: its account's AccountRoot is gone, and the pool says `deleted`
      expect(deleted.has("rGLnUKdptCVobJKEkrwxtdyGZ98Evdmqdz")).toBe(true);
    }
  });
});

describe("the names files", () => {
  it("are what isNamesGenerated names, and no other generator's or the hand-written files", () => {
    for (const net of NETS) {
      const paths = answers[net].map(({ path }) => path);
      expect(paths).toContain(`${net}/data-api/account_names.json`);
      for (const path of paths) {
        expect(isNamesGenerated(path), path).toBe(true);
        for (const other of [isHandWritten, isSynthetic, isMarketGenerated, isAmmGenerated, isAnalyticsGenerated, isNftGenerated, isValidatorsGenerated]) expect(other(path), `${other.name} ${path}`).toBe(false);
      }
      const named = [...files[net].keys()].filter(isNamesGenerated);
      expect(named.sort()).toEqual([...paths].sort());
    }
    expect(isNamesGenerated("xrpl/data-api/toml/northpeak.example.json")).toBe(true);
    expect(isNamesGenerated("xahau/data-api/account_names.json")).toBe(true);
    expect(isNamesGenerated("xrpl/data-api/account_names@addresses=rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh.json")).toBe(false);
    expect(isNamesGenerated("xrpl/data-api/accounts/rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh.json")).toBe(false);
    expect(isNamesGenerated("xrpl/node/toml/northpeak.example.json")).toBe(false);
  });

  it("are the same for the same input, and leave the names files they are given out", () => {
    for (const net of NETS) {
      expect(namesAnswers(net, files[net])).toEqual(answers[net]);
      const without = new Map([...files[net]].filter(([path]) => !isNamesGenerated(path)));
      expect(namesFixtures(net, without)).toEqual(namesFixtures(net, files[net]));
    }
  });

  it("give the active accounts the domains their account_info names (`Domain`, hex of the ASCII text)", () => {
    for (const [net, address, domain] of [["xrpl", NP, "northpeak.example"], ["xahau", TW, "tidewater.example"]] as const) {
      const hex = JSON.parse(onDisk(`${net}/node/account_info/${address}.json`)).result.account_data.Domain as string;
      expect(Buffer.from(hex, "hex").toString("ascii")).toBe(domain);
      expect(hex).toBe(hex.toUpperCase());
      expect(namesOf(net)[address]!.domain).toBe(domain);
    }
  });
});
