import { isRouteErrorResponse } from "react-router";
import { describe, expect, it } from "vitest";

import { allSwitches } from "../../test/support/switches";
import { featuresOf } from "../ui/features";
import { createLoadContext, type Env } from "./env";
import { networkOf } from "./networks";
import { publicNetwork, readNetworkCookie, requireNetwork } from "./network-route";

const env: Env = {
  ENVIRONMENT: "development",
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  BUILD_ID: "test-build",
  ...allSwitches("off"),
  VISITOR_LIMITER: { limit: async () => ({ success: true }) },
};
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const context = createLoadContext(env, ctx);

describe("requireNetwork", () => {
  it("gives the network of the :net segment, with the URLs of this deployment", () => {
    const net = requireNetwork(context, { net: "xahau" });
    expect(net).toEqual(networkOf("xahau", env));
    expect(net.dataApiUrl).toBe("https://xahau.data.example.invalid");
  });

  it.each(["doge", "XRPL", "", "constructor", "__proto__", "xrpl "])("throws a 404 of class short for %j", (segment) => {
    let thrown: unknown;
    try {
      requireNetwork(context, { net: segment });
    } catch (error) {
      thrown = error;
    }
    const { data, init } = thrown as { data: unknown; init: { status?: number; headers?: HeadersInit } };
    expect(init.status).toBe(404);
    expect(new Headers(init.headers).get("X-Cache-Class")).toBe("short");
    expect(data).toEqual({ notFound: `network ${JSON.stringify(segment)}` });
  });

  it("leaves a bidi control out of the segment it says was asked for (echoOf)", () => {
    let thrown: unknown;
    try {
      requireNetwork(context, { net: "\u202Eltpx\u0085" });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { data: unknown }).data).toEqual({ notFound: 'network "ltpx"' });
  });

  it("throws the same 404 when the route has no :net at all", () => {
    expect(() => requireNetwork(context, {})).toThrow();
  });
});

describe("publicNetwork", () => {
  it("is what may be sent to the browser: no data API URL, no node URL", () => {
    const shown = publicNetwork(networkOf("xrpl", env));
    expect(shown).toEqual({ id: "xrpl", name: "XRPL", native: "XRP", ctidNetworkId: 0, other: "xahau", hasAmm: true, software: "rippled", features: featuresOf(allSwitches("off")) });
    expect(JSON.stringify(shown)).not.toContain("invalid");
  });
});

describe("readNetworkCookie", () => {
  it.each([
    ["net=xahau", "xahau"],
    ["net=xrpl", "xrpl"],
    ["theme=dark; net=xahau; other=1", "xahau"],
    ["a=1;net=xahau", "xahau"],
  ])("reads %j as %s", (header, id) => {
    expect(readNetworkCookie(header)).toBe(id);
  });

  it.each([null, "", "net=", "net=doge", "net=XAHAU", "xnet=xahau", "net=xahau2", "net=constructor", "a=net=xahau"])(
    "reads %j as nothing",
    (header) => {
      expect(readNetworkCookie(header)).toBeUndefined();
    },
  );

  it("is not an error response", () => {
    // (a guard that the helper is plain data: nothing here throws a Response)
    expect(isRouteErrorResponse(readNetworkCookie("net=xrpl"))).toBe(false);
  });
});
