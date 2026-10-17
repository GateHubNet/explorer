import { afterEach, describe, expect, it } from "vitest";

import { networkCookie, networkCookieScript } from "./network-cookie";

afterEach(() => {
  document.cookie = "net=; Path=/; Max-Age=0";
});

describe("the network cookie", () => {
  it("is net=<id> for a year, for the whole site, and sent only to our own pages", () => {
    expect(networkCookie("xahau")).toBe("net=xahau; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(networkCookie("xrpl")).toBe("net=xrpl; Path=/; Max-Age=31536000; SameSite=Lax");
  });

  it("is written by an inline script that does just that", () => {
    const script = networkCookieScript("xahau");
    expect(script).toContain("document.cookie=");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(script)();
    expect(document.cookie).toContain("net=xahau");
  });

  it("cannot be turned into other script by an id that is not a network", () => {
    const script = networkCookieScript('xahau";alert(1);"' as never);
    expect(script.match(/alert/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(() => new Function(script)).not.toThrow();
    // The whole value stays inside one string literal.
    expect(script).toBe(`document.cookie=${JSON.stringify(networkCookie('xahau";alert(1);"' as never))}`);
  });
});
