import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { staticClosure, valueImports } from "../../test/support/value-imports";
import { collectAddresses } from "./names-collect";

// The addresses are those of names.test.ts: fictional accounts with the real checksum.
const A = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const B = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const C = "rrrrrrrrrrrrrrrrrrrrBZbvji";
const D = "rLUEXYuLiQptky37CqLcm9USQpPiz5rkpD";

describe("collectAddresses", () => {
  it("is every classic address once, in the order first met, over arrays and objects", () => {
    expect(collectAddresses({ a: A, b: [B, A] }, "x", C)).toEqual([A, B, C]);
  });

  it("is empty for nothing to walk", () => {
    expect(collectAddresses()).toEqual([]);
    expect(collectAddresses([], {}, null, undefined, 7, true)).toEqual([]);
  });

  it("goes depth first, and through the keys of an object in order", () => {
    expect(collectAddresses([[A, [B]], C])).toEqual([A, B, C]);
    expect(collectAddresses({ z: A, a: { m: B, b: C }, k: D })).toEqual([A, B, C, D]);
  });

  it("takes an address given as a part itself", () => {
    expect(collectAddresses(A, [B], A)).toEqual([A, B]);
  });

  it("reads the values of an object, not its keys", () => {
    expect(collectAddresses({ [A]: B })).toEqual([B]);
  });

  it("skips a string whose checksum is wrong", () => {
    const wrong = `${A.slice(0, -1)}j`;
    // They have the form of an address, so it is the checksum that refuses them.
    for (const text of [wrong, A.toLowerCase()]) expect(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(text)).toBe(true);
    expect(collectAddresses([wrong, B, A.toLowerCase()])).toEqual([B]);
  });

  it("skips an X-address, and a string that holds an address among other text", () => {
    const xAddress = "XVPcpSm47b1CZkf5AkKM9a84dQHe3m4sBhsrA4XtnBECTAc";
    expect(collectAddresses([xAddress, ` ${A}`, `${A} `, `pay ${A}`, `${A}?dt=1`, "r", ""])).toEqual([]);
  });

  it("never parses a string: JSON text that holds an address is not walked", () => {
    expect(collectAddresses(`{"a":"${A}"}`, [`["${B}"]`], { memo: `{"to":"${C}"}` })).toEqual([]);
  });

  it("walks an object met twice once, and ends on a cycle", () => {
    let reads = 0;
    const shared = {
      get b() {
        reads += 1;
        return B;
      },
    };
    expect(collectAddresses({ x: shared, y: [shared, A], z: shared })).toEqual([B, A]);
    expect(reads).toBe(1);

    const loop: Record<string, unknown> = { a: A };
    loop.self = loop;
    loop.list = [loop, C];
    expect(collectAddresses(loop)).toEqual([A, C]);
  });

  it("walks an object that two parts share once, too", () => {
    const shared = { a: B };
    expect(collectAddresses({ first: shared }, [A, shared])).toEqual([B, A]);
  });
});

describe("names-collect.ts", () => {
  const appDir = new URL("../", import.meta.url);

  // Task 4's fixture script (Node-typed, in tsconfig.node.json) imports collectAddresses, and that project cannot take a file that imports env.ts, edge-cache.ts
  // or deadline.ts (Worker-typed). The composite project also needs every file a file imports, a type import included, to be in its `include`: so this file
  // imports nothing of the tree at all, only the address codec.
  it("imports the address codec and nothing of the tree, not even a type, so that it is a leaf", () => {
    const source = readFileSync(new URL("server/names-collect.ts", appDir), "utf8");
    expect(valueImports(source)).toEqual(["ripple-address-codec"]);
    expect([...source.matchAll(/^(?:import|export)\s[^;]*?\bfrom\s+["']([^"']+)["']/gms)].map((match) => match[1])).toEqual(["ripple-address-codec"]);
    expect([...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)]).toEqual([]);
  });

  it("loads no other file of the tree, so no Worker-typed one", () => {
    expect(staticClosure(appDir, "server/names-collect.ts")).toEqual(["server/names-collect.ts"]);
  });
});
