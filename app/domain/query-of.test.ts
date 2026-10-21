import { describe, expect, it } from "vitest";

import { queryOf } from "./query-of";

describe("queryOf", () => {
  it("takes the raw query of a URL, without the question mark", () => {
    expect(queryOf("https://e.test/xrpl/network?period=1y&in=usd")).toBe("period=1y&in=usd");
    expect(queryOf("https://e.test/xrpl/network")).toBe("");
    expect(queryOf("https://e.test/xrpl/network?")).toBe("");
  });

  it("leaves out the pair React Router adds to a data request", () => {
    expect(queryOf("https://e.test/xrpl/network.data?period=1y&_routes=routes%2Fnet.network")).toBe("period=1y");
    expect(queryOf("https://e.test/xrpl/network.data?_routes=routes%2Fnet.network")).toBe("");
    expect(queryOf("https://e.test/xrpl/network.data?_routes=routes%2Fnet.network&period=1y&in=usd")).toBe("period=1y&in=usd");
    expect(queryOf("https://e.test/xrpl/network.data?period=1y&_routes=a%2Cb&in=usd")).toBe("period=1y&in=usd");
  });

  it("keeps what is not canonical as it came, so that the loader can tell", () => {
    expect(queryOf("https://e.test/xrpl/network?period=1y&")).toBe("period=1y&");
    expect(queryOf("https://e.test/xrpl/network?period=%37d")).toBe("period=%37d");
    expect(queryOf("https://e.test/xrpl/network?x=1")).toBe("x=1");
  });

  it("stops at a fragment, and keeps a pair that only starts with _routes", () => {
    expect(queryOf("/xrpl/network?period=1y#top")).toBe("period=1y");
    expect(queryOf("/xrpl/network?_routes_x=1&period=1y")).toBe("_routes_x=1&period=1y");
  });
});
