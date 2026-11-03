import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { redirectToCanonical } from "../server/pair-route";
import { staticClosure, valueImports } from "../../test/support/value-imports";
import { mptHoldersHref, mptTransfersHref, parseMptListParams, parseMptParams } from "./mpt-params";
import { queryOf } from "./query-of";

const ID = "0000012A2ADB0B3959D60A6E6991F729E1918B7163925230";

describe("parseMptParams", () => {
  it("has the canonical query of no parameter whatever the query says: the MPT page takes none", () => {
    for (const search of ["", "?", "?x=1", "x=1", "?marker=M2&back=M1", "?kind=mpt&q=HTF"]) expect(parseMptParams(search), search).toEqual({ canonical: "" });
  });
});

describe("parseMptListParams", () => {
  it("has no marker, no trail and the canonical query of nothing for the first page, whatever else the query holds", () => {
    expect(parseMptListParams("")).toEqual({ back: [], canonical: "" });
    expect(parseMptListParams("?")).toEqual({ back: [], canonical: "" });
    expect(parseMptListParams("?x=1")).toEqual({ back: [], canonical: "" });
    expect(parseMptListParams("?limit=5&kind=mpt")).toEqual({ back: [], canonical: "" });
  });

  it("drops a trail that has no marker behind it", () => {
    expect(parseMptListParams("?back=M1")).toEqual({ back: [], canonical: "" });
    expect(parseMptListParams("?back=M1.M2&x=1")).toEqual({ back: [], canonical: "" });
  });

  it("takes the first marker and the trail behind it, writes them in that order, and leaves out what it does not know", () => {
    expect(parseMptListParams("?b=1&marker=M2&back=M1&marker=M9")).toEqual({ marker: "M2", back: ["M1"], canonical: "marker=M2&back=M1" });
    expect(parseMptListParams("?back=M1.M0&marker=M2")).toEqual({ marker: "M2", back: ["M1", "M0"], canonical: "marker=M2&back=M1.M0" });
    expect(parseMptListParams("marker=M2")).toEqual({ marker: "M2", back: [], canonical: "marker=M2" });
    // A repeated `back` is read at its first value too.
    expect(parseMptListParams("?marker=M2&back=M1&back=M9")).toEqual({ marker: "M2", back: ["M1"], canonical: "marker=M2&back=M1" });
  });

  it("drops a trail that is none: a piece that is no marker, or more than the trail can remember", () => {
    expect(parseMptListParams("?marker=M2&back=M1.not a marker")).toEqual({ marker: "M2", back: [], canonical: "marker=M2" });
    expect(parseMptListParams("?marker=M2&back=")).toEqual({ marker: "M2", back: [], canonical: "marker=M2" });
    const eleven = Array.from({ length: 11 }, (_, at) => `M${at}`).join(".");
    expect(parseMptListParams(`?marker=M2&back=${eleven}`)).toEqual({ marker: "M2", back: [], canonical: "marker=M2" });
    const ten = Array.from({ length: 10 }, (_, at) => `M${at}`);
    expect(parseMptListParams(`?marker=M2&back=${ten.join(".")}`).back).toEqual(ten);
  });

  // C23: the raw marker is returned, an empty one too. The loader checks `isMarker` and answers a 404 before it compares the query; the params module does not decide that.
  it("returns the marker as it was given, an empty one and one that is no marker included, for the loader to refuse", () => {
    expect(parseMptListParams("?marker=")).toEqual({ marker: "", back: [], canonical: "marker=" });
    expect(parseMptListParams("?marker=&back=M1")).toEqual({ marker: "", back: ["M1"], canonical: "marker=&back=M1" });
    expect(parseMptListParams("?marker=not%20a%20marker").marker).toBe("not a marker");
    expect(parseMptListParams("?marker=a%2Fb").marker).toBe("a/b");
  });

  it("writes a canonical query that a URL parser leaves as it is, so that a redirect to it ends", () => {
    const parsed = parseMptListParams("?marker=M2&back=M1");
    const href = mptHoldersHref("xrpl", ID, parsed);
    expect(new URL(`https://h${href}`).search).toBe(`?${parsed.canonical}`);
    expect(redirectToCanonical({ path: `/xrpl/mpt/${ID}/holders`, search: queryOf(`https://h${href}`) }, { path: `/xrpl/mpt/${ID}/holders`, search: parsed.canonical })).toBeNull();
  });

  it("is what redirectToCanonical compares: a query that is not canonical is a 302 to the canonical one, in the class short", () => {
    const path = `/xrpl/mpt/${ID}/transfers`;
    const asked = "b=1&marker=M2&back=M1&marker=M9";
    const response = redirectToCanonical({ path, search: asked }, { path, search: parseMptListParams(asked).canonical });
    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe(`${path}?marker=M2&back=M1`);
    expect(redirectToCanonical({ path, search: "marker=M2&back=M1" }, { path, search: parseMptListParams("marker=M2&back=M1").canonical })).toBeNull();
    expect(redirectToCanonical({ path, search: "" }, { path, search: parseMptListParams("").canonical })).toBeNull();
  });
});

describe("mptHoldersHref and mptTransfersHref", () => {
  it("write the page's path with the ID in upper case, and no query for the first page", () => {
    expect(mptHoldersHref("xrpl", ID)).toBe(`/xrpl/mpt/${ID}/holders`);
    expect(mptTransfersHref("xrpl", ID)).toBe(`/xrpl/mpt/${ID}/transfers`);
    expect(mptHoldersHref("xrpl", ID.toLowerCase(), {})).toBe(`/xrpl/mpt/${ID}/holders`);
    expect(mptTransfersHref("xahau", ID, { back: [] })).toBe(`/xahau/mpt/${ID}/transfers`);
  });

  it("write the marker, then the trail behind it, joined by dots, and a trail only behind a marker", () => {
    expect(mptHoldersHref("xrpl", ID, { marker: "M3" })).toBe(`/xrpl/mpt/${ID}/holders?marker=M3`);
    expect(mptHoldersHref("xrpl", ID, { marker: "M3", back: [] })).toBe(`/xrpl/mpt/${ID}/holders?marker=M3`);
    expect(mptHoldersHref("xrpl", ID, { marker: "M3", back: ["M2", "M1"] })).toBe(`/xrpl/mpt/${ID}/holders?marker=M3&back=M2.M1`);
    expect(mptTransfersHref("xrpl", ID, { marker: "M3", back: ["M2", "M1"] })).toBe(`/xrpl/mpt/${ID}/transfers?marker=M3&back=M2.M1`);
    expect(mptTransfersHref("xrpl", ID, { back: ["M2"] })).toBe(`/xrpl/mpt/${ID}/transfers`);
  });

  it("are what the params read back: a link's query is the canonical query of its own view", () => {
    for (const p of [{}, { marker: "M3" }, { marker: "M3", back: ["M2", "M1"] }]) {
      const href = mptHoldersHref("xrpl", ID, p);
      const query = href.includes("?") ? href.slice(href.indexOf("?")) : "";
      expect(parseMptListParams(query).canonical, href).toBe(query.replace(/^\?/, ""));
    }
  });
});

describe("the browser bundle", () => {
  // mpt-params.ts is drawn in the browser (the pages import the hrefs). Its one file with a value import beyond the MPT helpers is paging.ts, whose only import is `server/marker.ts`: the leaf of
  // `isMarker` that the NFT and token pages allow. Nothing of the Worker's, of the describe and parse trees or of the codec is in the closure.
  const appDir = new URL("../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

  it("loads the MPT helpers, paging, the query helpers and the marker leaf, and no codec, no describe or parse file and no other file of the Worker", () => {
    expect(valueImports(read("domain/mpt-params.ts"))).toEqual(["./mpt", "./paging", "./query-of"]);
    const closure = staticClosure(appDir, "domain/mpt-params.ts");
    expect(closure).toEqual(["domain/mpt-params.ts", "domain/mpt.ts", "domain/paging.ts", "domain/query-of.ts", "server/marker.ts"]);
    for (const file of closure) {
      for (const specifier of valueImports(read(file))) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/ripple-|describe|parse|server\/(?!marker)/);
      }
    }
  });
});
