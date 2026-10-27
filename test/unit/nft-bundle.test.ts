import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { staticClosure, valueImports } from "../support/value-imports";

// The NFT pages are drawn in the browser too (a client-side navigation renders them there), and they never fetch: the view builders (`app/server/nfts-view.ts`, which
// value-imports `network-view.ts` and the glyph characters of `NftGlyph.tsx`) put every href, label and figure in the page data, and the NFT ids are decoded in the Worker
// (`domain/nft-id.ts`, which the NFT page's builder uses and no page imports). So the files the browser runs for these pages import none of the Worker's code as a value: nothing
// of `app/server` (the marker alphabet, an import-free leaf, aside), of the describe and parse trees, of `domain/nft-id.ts`, of `domain/asset.ts` or of `ripple-*`. `nft-params.ts` and
// `nft-link.ts` are among them, and so are the tags' builders, `meta-nfts.ts` and `meta-nft-sales.ts`: a page's `meta` is part of its route module. A type import is erased and costs nothing; a value import is
// the bug. (The routes import the server for their loaders; React Router drops a loader and what only it uses from the browser's build, and `pnpm check:bundle` holds the result to
// the budget, in `scripts/bundle-budget.ts`.) The NFT's page draws no chart (the kit's charts are none of its closure), and its URI is text: it imports no link or image of the Worker's.

const appDir = new URL("../../app/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

/** A specifier of what belongs to the Worker alone: app/server, the describe and parse trees, `domain/nft-id.ts`, `domain/asset.ts` and the `ripple-*` packages. */
const SERVER_ONLY = [/\/server\//, /\/describe(\/|$)/, /\/parse(\/|$)/, /\/nft-id$/, /\/asset$/, /ripple-/];
const serverOnly = (from: string) => SERVER_ONLY.some((pattern) => pattern.test(from));

/** The files of the pages, the table they share, and the links and the params that the pages are made with. */
const PAGE_FILES = ["ui/pages/NftsPage.tsx", "ui/pages/NftSalesPage.tsx", "ui/pages/NftCollectionPage.tsx", "ui/pages/NftPage.tsx", "ui/components/NftSalesTable.tsx", "domain/nft-params.ts", "domain/nft-link.ts"];

/** The pages that draw the shared sales table, whose closure the table, the pager and the coverage note are looked for in. */
const PAGES = ["ui/pages/NftsPage.tsx", "ui/pages/NftSalesPage.tsx", "ui/pages/NftCollectionPage.tsx"];

/** The tags' builders, which the browser runs as the routes' `meta`. They are files of app/server that import nothing of it but `./meta`. */
const META_FILES = ["server/meta-nfts.ts", "server/meta-nft-sales.ts", "server/meta-nft-collection.ts", "server/meta-nft.ts"];

/** What a file the browser loads may reach of the Worker's own files: the marker alphabet (`server/marker.ts`, an import-free leaf, which `parseTrail` reads markers with). */
const LEAVES = ["server/marker.ts"];

/** The files of a closure that are the Worker's code: app/server (the allowed leaves aside), the describe and parse trees, nft-id.ts, asset.ts and market-pair.ts. */
const workerFiles = (closure: string[], allowed: string[]) =>
  closure.filter(
    (path) =>
      (/^server\//.test(path) && !allowed.includes(path)) ||
      /^domain\/(describe|parse)\//.test(path) ||
      path === "domain/nft-id.ts" ||
      path === "domain/asset.ts" ||
      path === "domain/market-pair.ts",
  );

describe("the files of the NFT pages that run in the browser", () => {
  it.each(PAGE_FILES)("%s imports nothing of the server, describe, parse, nft-id, asset or ripple-* as a value", (file) => {
    expect(valueImports(read(file)).filter(serverOnly)).toEqual([]);
  });

  it.each(PAGE_FILES)("%s loads none of those through the files it imports either: of app/server it reaches only the marker alphabet, a leaf", (file) => {
    const closure = staticClosure(appDir, file);
    expect(closure).toContain(file);
    expect(workerFiles(closure, LEAVES)).toEqual([]);
    // No file it reaches loads a ripple-* package either.
    expect(closure.flatMap((path) => valueImports(read(path))).filter((from) => /ripple-/.test(from))).toEqual([]);
    expect(valueImports(read("server/marker.ts"))).toEqual([]);
  });

  it.each(META_FILES)("%s, which the browser runs as `meta`, imports nothing of ripple-*, describe, parse, nft-id or domain/asset, and of app/server only ./meta", (file) => {
    const imports = valueImports(read(file));
    expect(imports.filter((from) => /ripple-|\/describe(\/|$)|\/parse(\/|$)|\/nft-id$|\/asset$/.test(from))).toEqual([]);
    expect(imports.filter((from) => from.startsWith("./") || /^\.\.\/server(\/|$)/.test(from))).toEqual(["./meta"]);
    const closure = staticClosure(appDir, file);
    expect(workerFiles(closure, [...LEAVES, file, "server/meta.ts"])).toEqual([]);
    expect(closure.flatMap((path) => valueImports(read(path))).filter((from) => /ripple-/.test(from))).toEqual([]);
  });

  it.each(PAGES)("%s draws with the kit's charts, the table and the pager, and the shared sales table", (file) => {
    const closure = staticClosure(appDir, file);
    expect(closure).toEqual(expect.arrayContaining(["ui/components/DataTable.tsx", "ui/components/Pager.tsx", "ui/components/NftSalesTable.tsx", "ui/components/CoverageNote.tsx"]));
  });

  it("has the list draw the column chart and the bar list, the collection the column chart alone, and the older sales no chart at all", () => {
    expect(staticClosure(appDir, "ui/pages/NftsPage.tsx")).toEqual(expect.arrayContaining(["ui/charts/ColumnChart.tsx", "ui/charts/BarList.tsx", "ui/charts/ChartCard.tsx"]));
    const collection = staticClosure(appDir, "ui/pages/NftCollectionPage.tsx");
    expect(collection).toEqual(expect.arrayContaining(["ui/charts/ColumnChart.tsx", "ui/charts/ChartCard.tsx", "ui/charts/ChartTable.tsx"]));
    expect(collection).not.toContain("ui/charts/BarList.tsx");
    expect(staticClosure(appDir, "ui/pages/NftSalesPage.tsx").filter((path) => path.startsWith("ui/charts/"))).toEqual([]);
  });

  it("has the NFT's page draw no chart at all, and no server file, but the table, the pager and the coverage note of the lists it shares", () => {
    const page = staticClosure(appDir, "ui/pages/NftPage.tsx");
    expect(page.filter((path) => path.startsWith("ui/charts/"))).toEqual([]);
    expect(page).toEqual(expect.arrayContaining(["ui/components/DataTable.tsx", "ui/components/Pager.tsx", "ui/components/CoverageNote.tsx", "ui/components/NftGlyph.tsx", "ui/components/Sentence.tsx"]));
    // The page's own text is the builder's: it never decodes an id, and the URI is text it was given.
    expect(page).not.toContain("domain/nft-id.ts");
    expect(page).not.toContain("ui/components/LinkedText.tsx");
    expect(page).not.toContain("ui/components/NftSalesTable.tsx");
    expect(valueImports(read("ui/pages/NftPage.tsx")).filter((from) => /\/charts\//.test(from))).toEqual([]);
  });

  it("has the NFT's page draw the URI with no link component: it imports none that could make one of text", () => {
    const imports = valueImports(read("ui/pages/NftPage.tsx"));
    expect(imports.filter((from) => /LinkedText|linkify|Linkified/i.test(from))).toEqual([]);
  });

  it("sees the Worker's code where a file does load it: the view builder reaches the windows, the exact numbers and the server", () => {
    const builder = staticClosure(appDir, "server/nfts-view.ts");
    expect(workerFiles(builder, LEAVES)).toEqual(expect.arrayContaining(["server/nfts-view.ts", "server/network-view.ts", "server/exact.ts"]));
  });

  it("is checked by filters that see each of those, and not a file named like one", () => {
    const source = [
      `import { nftsListPage } from "../../server/nfts-view";`,
      `import type { NftsPageData } from "../../server/nfts-view";`,
      `import { describeTx } from "../../domain/describe";`,
      `import { parseTx } from "../domain/parse/index";`,
      `import { decodeNftId } from "../../domain/nft-id";`,
      `import { parseAssetText } from "../../domain/asset";`,
      `import { isValidClassicAddress } from "ripple-address-codec";`,
      `import { formatAmount } from "../../domain/format";`,
      `import { nftsHref } from "../../domain/nft-params";`,
      `import { type NftId } from "../../domain/nft-id";`,
    ].join("\n");
    expect(valueImports(source).filter(serverOnly)).toEqual([
      "../../server/nfts-view",
      "../../domain/describe",
      "../domain/parse/index",
      "../../domain/nft-id",
      "../../domain/asset",
      "ripple-address-codec",
    ]);
    expect(["../../domain/nft-ids", "../domain/nft-id-like", "../server-like", "../../domain/parser", "../../domain/describes"].filter(serverOnly)).toEqual([]);
  });
});
