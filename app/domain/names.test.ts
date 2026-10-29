import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { staticClosure, valueImports } from "../../test/support/value-imports";
import type { AccountNameEntry } from "../server/api-types";
import { shortAddress } from "./format";
import {
  labelWords,
  linkTextOf,
  mergeNames,
  mergeNamesPart,
  NAMES_OFF,
  nameTitleOf,
  nameViewOf,
  NO_NAMES,
  plainNameOf,
  shownIssuer,
  vouchedByOf,
  type NameMap,
  type NamesPart,
  type NameView,
} from "./names";

// Fictional names and `*.example` domains, as the data API's reference writes them.
const A = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const B = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const C = "rrrrrrrrrrrrrrrrrrrrBZbvji";
const D = "rLUEXYuLiQptky37CqLcm9USQpPiz5rkpD";
const E = "rBg5JN5ShW8ZRV1TJhxVJRYcXVbPGC3ARi";

const verified: AccountNameEntry = { address: A, display_name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example" };
const named: AccountNameEntry = {
  address: B,
  display_name: { text: "Harborline Exchange", kind: "account" },
  account_name: "Harborline Exchange",
  account_network_name: "hot wallet",
  labels: { advisory: { description: "Withdrawals paused" } },
};

describe("nameViewOf", () => {
  it("reads a verified name, its domain and no network", () => {
    expect(nameViewOf(verified)).toEqual({ name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example", labels: [] });
  });

  it("reads the account network name and the labels, in the API's order", () => {
    expect(nameViewOf(named)).toEqual({ name: { text: "Harborline Exchange", kind: "account" }, network: "hot wallet", labels: ["advisory"] });
    const all: AccountNameEntry = {
      address: E,
      labels: { scam: { description: "d" }, spam: { description: "" }, advisory: { description: "d", source: "s", url: "https://x.example/a" } },
    };
    expect(nameViewOf(all)!.labels).toEqual(["scam", "spam", "advisory"]);
  });

  it("reads a domain name that nothing vouches for, with its domain", () => {
    expect(nameViewOf({ address: D, display_name: { text: "lowtide.example", kind: "domain" }, domain: "lowtide.example" })).toEqual({
      name: { text: "lowtide.example", kind: "domain" },
      domain: "lowtide.example",
      labels: [],
    });
  });

  it("is null for an address nothing names: no display name, no network name, no label", () => {
    expect(nameViewOf({ address: E })).toBeNull();
    expect(nameViewOf({ address: E, labels: {} })).toBeNull();
  });

  it("is null for an entry that has a domain and no display name, which is D4's answer when it could not read its toml store", () => {
    expect(nameViewOf({ address: E, domain: "x.example" })).toBeNull();
  });

  it("reads an unknown kind as no name, and keeps what else the entry has", () => {
    expect(nameViewOf({ address: E, display_name: { text: "X", kind: "curated" } })).toBeNull();
    expect(nameViewOf({ address: E, display_name: { text: "X", kind: "curated" }, labels: { spam: { description: "d" } } })).toEqual({ labels: ["spam"] });
    expect(nameViewOf({ address: E, display_name: { text: "X", kind: "curated" }, account_network_name: "cold" })).toEqual({ network: "cold", labels: [] });
  });

  it("has labels alone for an address that has labels only", () => {
    expect(nameViewOf({ address: E, labels: { scam: { description: "d" }, spam: { description: "d" } } })).toEqual({ labels: ["scam", "spam"] });
  });

  it("keeps an unknown label as written", () => {
    expect(nameViewOf({ address: E, labels: { phishing: { description: "d" } } })).toEqual({ labels: ["phishing"] });
  });

  it("has no network for an empty one, and no name for a verified one that has no domain to name", () => {
    expect(nameViewOf({ address: E, account_network_name: "" })).toBeNull();
    expect(nameViewOf({ address: E, display_name: { text: "X", kind: "verified" } })).toBeNull();
    expect(nameViewOf({ address: E, display_name: { text: "X", kind: "verified" }, domain: "" })).toBeNull();
  });

  it("does not write a key it has no value for", () => {
    expect(Object.keys(nameViewOf({ address: E, labels: { scam: { description: "d" } } })!)).toEqual(["labels"]);
  });
});

describe("linkTextOf", () => {
  it("is the name, then the network after a dot when there is one", () => {
    expect(linkTextOf(nameViewOf(verified)!)).toBe("Northpeak Treasury");
    expect(linkTextOf(nameViewOf(named)!)).toBe("Harborline Exchange · hot wallet");
  });

  it("is the name alone when the network is the name itself", () => {
    expect(linkTextOf(nameViewOf({ address: C, display_name: { text: "hot wallet", kind: "account" }, account_network_name: "hot wallet" })!)).toBe("hot wallet");
  });

  it("is empty when there is no name, so that a caller draws the address", () => {
    expect(linkTextOf(nameViewOf({ address: E, account_network_name: "cold" })!)).toBe("");
    expect(linkTextOf(nameViewOf({ address: E, labels: { scam: { description: "d" } } })!)).toBe("");
  });
});

describe("nameTitleOf", () => {
  it("says who verified a verified name, and its address", () => {
    expect(nameTitleOf(nameViewOf(verified)!, A)).toBe(`Verified by northpeak.example · ${A}`);
  });

  it("says a name was given by GateHub, and the labels after it", () => {
    expect(nameTitleOf(nameViewOf(named)!, B)).toBe(`Named by GateHub · ${B} · Labelled advisory by GateHub`);
  });

  it("says a domain is not verified", () => {
    expect(nameTitleOf(nameViewOf({ address: D, display_name: { text: "lowtide.example", kind: "domain" }, domain: "lowtide.example" })!, D)).toBe(
      `Domain not verified · ${D}`,
    );
  });

  it("is the address when there is no name, and the labels follow it", () => {
    expect(nameTitleOf(nameViewOf({ address: E, account_network_name: "cold" })!, E)).toBe(E);
    expect(nameTitleOf(nameViewOf({ address: E, labels: { scam: { description: "d" }, spam: { description: "d" } } })!, E)).toBe(
      `${E} · Labelled scam and spam by GateHub`,
    );
  });

  it("joins three labels as a sentence does", () => {
    const all = nameViewOf({ address: E, labels: { scam: { description: "" }, spam: { description: "" }, advisory: { description: "" } } })!;
    expect(nameTitleOf(all, E)).toBe(`${E} · Labelled scam, spam and advisory by GateHub`);
  });
});

describe("plainNameOf", () => {
  it("is the link text of a verified or a GateHub-named account that has no label", () => {
    expect(plainNameOf(nameViewOf(verified)!)).toBe("Northpeak Treasury");
    expect(plainNameOf(nameViewOf({ ...named, labels: undefined })!)).toBe("Harborline Exchange · hot wallet");
  });

  it("is null when the name is labelled, a domain nothing vouches for, absent, or the view is", () => {
    expect(plainNameOf(nameViewOf(named)!)).toBeNull();
    expect(plainNameOf(nameViewOf({ address: D, display_name: { text: "lowtide.example", kind: "domain" }, domain: "lowtide.example" })!)).toBeNull();
    expect(plainNameOf(nameViewOf({ address: E, account_network_name: "cold" })!)).toBeNull();
    expect(plainNameOf(undefined)).toBeNull();
  });

  it("reads like the brief's three", () => {
    expect([plainNameOf(nameViewOf(verified)!), plainNameOf(nameViewOf(named)!), plainNameOf(undefined)]).toEqual(["Northpeak Treasury", null, null]);
  });
});

describe("vouchedByOf", () => {
  it("says who verified a verified name, and that GateHub gave an account's, whatever labels it has", () => {
    expect(vouchedByOf(nameViewOf(verified)!)).toBe("Verified by northpeak.example");
    expect(vouchedByOf(nameViewOf(named)!)).toBe("Named by GateHub");
    expect(vouchedByOf(nameViewOf({ ...verified, labels: { scam: { description: "d" } } })!)).toBe("Verified by northpeak.example");
  });

  it("is null for a name only the account's domain gives, a label or a network name alone, and no view", () => {
    expect(vouchedByOf(nameViewOf({ address: D, display_name: { text: "lowtide.example", kind: "domain" }, domain: "lowtide.example" })!)).toBeNull();
    expect(vouchedByOf(nameViewOf({ address: E, labels: { spam: { description: "d" } } })!)).toBeNull();
    expect(vouchedByOf(nameViewOf({ address: E, account_network_name: "cold" })!)).toBeNull();
    expect(vouchedByOf(undefined)).toBeNull();
  });

  it("is the words the hover title starts with", () => {
    expect(nameTitleOf(nameViewOf(verified)!, A)).toBe(`${vouchedByOf(nameViewOf(verified)!)} · ${A}`);
    expect(nameTitleOf(nameViewOf({ ...named, labels: undefined })!, B)).toBe(`${vouchedByOf(nameViewOf(named)!)} · ${B}`);
  });
});

describe("shownIssuer", () => {
  it("is the short address when the map has no name for it", () => {
    expect(shownIssuer(E, {})).toBe(shortAddress(E));
  });

  it("is the plain name when the map has one, and the short address when the name is labelled or not vouched for", () => {
    const names: NameMap = { [A]: nameViewOf(verified)!, [B]: nameViewOf(named)!, [E]: { labels: ["scam"] } };
    expect(shownIssuer(A, names)).toBe("Northpeak Treasury");
    expect(shownIssuer(B, names)).toBe(shortAddress(B));
    expect(shownIssuer(E, names)).toBe(shortAddress(E));
  });
});

describe("labelWords", () => {
  it("joins the labels as a sentence does", () => {
    expect(labelWords([])).toBe("");
    expect(labelWords(["scam"])).toBe("scam");
    expect(labelWords(["scam", "spam"])).toBe("scam and spam");
    expect(labelWords(["scam", "spam", "advisory"])).toBe("scam, spam and advisory");
  });
});

describe("NAMES_OFF and NO_NAMES", () => {
  it("are the part of a page with the switch off, and the part of a page with nothing to name", () => {
    expect(NAMES_OFF).toEqual({ state: "off", map: {} });
    expect(NO_NAMES).toEqual({ state: "ok", map: {} });
  });

  it("are frozen, with their maps, because they are shared", () => {
    for (const part of [NAMES_OFF, NO_NAMES]) {
      expect(Object.isFrozen(part)).toBe(true);
      expect(Object.isFrozen(part.map)).toBe(true);
    }
  });
});

const v0: NameView = { name: { text: "Old", kind: "account" }, labels: [] };
const v1: NameView = { name: { text: "New", kind: "account" }, labels: [] };
const v2: NameView = { name: { text: "Other", kind: "verified" }, domain: "other.example", labels: [] };

describe("mergeNames", () => {
  it("keeps the shown entries under the next ones", () => {
    expect(mergeNames({ a: v1 }, { a: v0, b: v2 })).toEqual({ a: v1, b: v2 });
  });

  it("changes neither map", () => {
    const next: NameMap = { a: v1 };
    const shown: NameMap = { a: v0, b: v2 };
    mergeNames(next, shown);
    expect(next).toEqual({ a: v1 });
    expect(shown).toEqual({ a: v0, b: v2 });
  });
});

describe("mergeNamesPart", () => {
  const ok = (map: NameMap): NamesPart => ({ state: "ok", map });

  it("takes the next part's state and both maps", () => {
    expect(mergeNamesPart({ state: "failed", map: {} }, ok({ b: v2 }))).toEqual({ state: "failed", map: { b: v2 } });
    expect(mergeNamesPart(ok({ a: v1 }), ok({ a: v0, b: v2 }))).toEqual({ state: "ok", map: { a: v1, b: v2 } });
  });

  it("leaves a part with the switch off as it is", () => {
    expect(mergeNamesPart(NAMES_OFF, ok({ b: v2 }))).toBe(NAMES_OFF);
  });
});

describe("the browser bundle", () => {
  // names.ts is drawn wherever an account shows, so it is pure: it imports the data API's types (erased) and two pure domain files, nothing of app/server.
  const appDir = new URL("../", import.meta.url);

  it("imports no value from the server, and loads only pure files of the domain", () => {
    const source = readFileSync(new URL("domain/names.ts", appDir), "utf8");
    expect(valueImports(source).sort()).toEqual(["./format", "./join-and"]);
    expect(staticClosure(appDir, "domain/names.ts").filter((file) => file.startsWith("server/"))).toEqual([]);
  });

  // Every page that draws an account loads names.ts. time-words.ts (dates, the countdown's words) is for the pages that draw those: through names.ts it was a file
  // of its own on all the others (353 bytes gzipped, found by the bundle check when AccountLink began to read names).
  it("does not load time-words.ts, which the pages that draw an account have no use for", () => {
    expect(staticClosure(appDir, "domain/names.ts")).not.toContain("domain/time-words.ts");
  });
});
