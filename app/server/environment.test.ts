import { describe, expect, it, vi } from "vitest";

import { withEnvironmentHeaders } from "./environment";

const sandbox = { ENVIRONMENT: "sandbox" } as const;

describe("withEnvironmentHeaders", () => {
  it("adds noindex in the sandbox, to the same response", () => {
    const response = new Response("page", { status: 404, headers: { "Content-Type": "text/html", "X-Cache": "HIT" } });

    const answered = withEnvironmentHeaders(response, sandbox);

    expect(answered).toBe(response);
    expect(answered.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(answered.status).toBe(404);
    expect(answered.headers.get("Content-Type")).toBe("text/html");
    expect(answered.headers.get("X-Cache")).toBe("HIT");
  });

  it("sets noindex over a value the response already has", () => {
    const answered = withEnvironmentHeaders(new Response(null, { headers: { "X-Robots-Tag": "all" } }), sandbox);
    expect(answered.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("copies a response whose headers are immutable, keeping its status, headers and body", () => {
    // Like the answer of a fetch() or a copy from the Cache API, a redirect made by Response.redirect has read-only headers.
    const redirect = Response.redirect("https://x/", 302);
    expect(() => redirect.headers.set("X-Probe", "1")).toThrow(TypeError);

    const answered = withEnvironmentHeaders(redirect, sandbox);

    expect(answered).not.toBe(redirect);
    expect(answered.status).toBe(302);
    expect(answered.headers.get("Location")).toBe("https://x/");
    expect(answered.headers.get("X-Robots-Tag")).toBe("noindex");
    // The original is left as it was.
    expect(redirect.headers.has("X-Robots-Tag")).toBe(false);
  });

  it("copies the body of an immutable response, with its status text and every header", async () => {
    const response = new Response("the body", { status: 503, statusText: "Unavailable", headers: { "Retry-After": "10", "X-Cache": "STALE" } });
    vi.spyOn(response.headers, "set").mockImplementation(() => {
      throw new TypeError("Can't modify immutable headers.");
    });

    const answered = withEnvironmentHeaders(response, sandbox);

    expect(answered).not.toBe(response);
    expect(answered.status).toBe(503);
    expect(answered.statusText).toBe("Unavailable");
    expect(answered.headers.get("Retry-After")).toBe("10");
    expect(answered.headers.get("X-Cache")).toBe("STALE");
    expect(answered.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await answered.text()).toBe("the body");
  });

  it.each(["development", "production"] as const)("changes nothing in %s", (ENVIRONMENT) => {
    const response = new Response("page", { headers: { "Content-Type": "text/html" } });
    const redirect = Response.redirect("https://x/", 302);

    expect(withEnvironmentHeaders(response, { ENVIRONMENT })).toBe(response);
    expect(response.headers.has("X-Robots-Tag")).toBe(false);
    expect(withEnvironmentHeaders(redirect, { ENVIRONMENT })).toBe(redirect);
    expect(redirect.headers.has("X-Robots-Tag")).toBe(false);
  });

  it("leaves the noindex a response has of its own where it is, outside the sandbox", () => {
    // The images and the CSVs say noindex in every environment.
    const image = new Response(null, { headers: { "X-Robots-Tag": "noindex" } });
    expect(withEnvironmentHeaders(image, { ENVIRONMENT: "production" }).headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("reads a value that is no environment as development", () => {
    const response = new Response("page");
    expect(withEnvironmentHeaders(response, { ENVIRONMENT: "Sandbox" as never })).toBe(response);
    expect(response.headers.has("X-Robots-Tag")).toBe(false);
  });
});
