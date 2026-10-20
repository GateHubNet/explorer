import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { valueImports } from "../support/value-imports";

// The markets pages are drawn in the browser too (a client-side navigation renders them there), and the pages never fetch and get strings: the
// view builders (`app/server/markets-view.ts`, which value-imports `app/domain/asset.ts` and `market-pair.ts`, and with them the issuer
// checksums of `ripple-address-codec`) put every href, label and rank in the page data. So the files the browser runs for these pages import
// none of that as a value. `app/server/meta.ts` is one of them: a page's `meta` is part of its route module, and it builds the markets tags from
// the view words the builder wrote. A type import is erased and costs nothing; a value import is the bug. (The route, `app/routes/net.markets.tsx`,
// imports the server for its loader; React Router drops the loader and what only it uses from the browser's build, and `pnpm check:bundle` holds
// the result to the budget.)

const appDir = new URL("../../app/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

const SERVER = (from: string) => /(^|\/)server(\/|$)/.test(from);
const ASSET_CODE = (from: string) => /ripple-/.test(from) || /(^|\/)domain\/asset(\.ts)?$/.test(from) || /(^|\/)domain\/market-pair(\.ts)?$/.test(from);

describe("the files of the markets pages that run in the browser", () => {
  it.each(["ui/pages/MarketsPage.tsx", "ui/pages/MarketPairPage.tsx", "ui/components/LiveStateNotice.tsx", "ui/use-retry.ts"])(
    "%s imports nothing of the server, ripple-*, domain/asset or domain/market-pair as a value",
    (file) => {
      expect(valueImports(read(file)).filter((from) => SERVER(from) || ASSET_CODE(from))).toEqual([]);
    },
  );

  it("server/meta.ts, which the browser runs as `meta`, imports nothing of ripple-*, domain/asset or domain/market-pair as a value", () => {
    expect(valueImports(read("server/meta.ts")).filter(ASSET_CODE)).toEqual([]);
  });

  it("is checked by filters that see each of those, and not a file named like one", () => {
    const source = [
      `import { marketsPage } from "../../server/markets-view";`,
      `import type { MarketsPageData } from "../../server/markets-view";`,
      `import { parseAssetText } from "../../domain/asset";`,
      `import { marketHref } from "../domain/market-pair";`,
      `import { isValidClassicAddress } from "ripple-address-codec";`,
      `import { formatPrice } from "../../domain/format";`,
      `import { PERIODS } from "../../domain/market-params";`,
    ].join("\n");
    expect(valueImports(source).filter((from) => SERVER(from) || ASSET_CODE(from))).toEqual([
      "../../server/markets-view",
      "../../domain/asset",
      "../domain/market-pair",
      "ripple-address-codec",
    ]);
    expect(["../../domain/assets", "../domain/market-pairs", "../server-like", "../../domain/market-params"].filter((from) => SERVER(from) || ASSET_CODE(from))).toEqual([]);
  });
});
