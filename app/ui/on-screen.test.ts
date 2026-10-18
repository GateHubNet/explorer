import { describe, expect, it } from "vitest";

import { createOnScreen } from "./on-screen";

// A revalidation that fails would replace the page with the error screen (React Router drops the route's data and shows its boundary).
// `createOnScreen` is what the home route's `clientLoader` uses to hand back what the page already shows instead.

const failure = () => Promise.reject(new Error("503"));

describe("createOnScreen", () => {
  it("returns what the load returns", async () => {
    const onScreen = createOnScreen<string>();
    onScreen.show("xrpl", "shown");
    expect(await onScreen.reload("xrpl", async () => "fresh")).toBe("fresh");
  });

  it("hands back what the page shows when the load fails, so that the page stays", async () => {
    const onScreen = createOnScreen<string>();
    onScreen.show("xrpl", "shown");
    expect(await onScreen.reload("xrpl", failure)).toBe("shown");
  });

  it("lets a failure through when nothing of that page is on screen: a navigation to the page gets the error screen, as before", async () => {
    const onScreen = createOnScreen<string>();
    await expect(onScreen.reload("xrpl", failure)).rejects.toThrow("503");

    onScreen.show("xahau", "the other network's page");
    await expect(onScreen.reload("xrpl", failure)).rejects.toThrow("503");
  });

  it("forgets the page when it leaves the screen", async () => {
    const onScreen = createOnScreen<string>();
    const leave = onScreen.show("xrpl", "shown");
    leave();
    await expect(onScreen.reload("xrpl", failure)).rejects.toThrow("503");
  });

  it("does not let an old page's leaving forget the page that replaced it", async () => {
    const onScreen = createOnScreen<string>();
    const leaveOld = onScreen.show("xrpl", "old");
    onScreen.show("xrpl", "new");
    leaveOld();
    expect(await onScreen.reload("xrpl", failure)).toBe("new");
  });

  it("does not hide a redirect: a thrown Response is React Router's to follow", async () => {
    const onScreen = createOnScreen<string>();
    onScreen.show("xrpl", "shown");
    const redirect = new Response(null, { status: 302, headers: { Location: "/xahau" } });
    await expect(onScreen.reload("xrpl", () => Promise.reject(redirect))).rejects.toBe(redirect);
  });

  it("takes a thrown 503 for the failure it is, as it does an ErrorResponse", async () => {
    const onScreen = createOnScreen<string>();
    onScreen.show("xrpl", "shown");
    expect(await onScreen.reload("xrpl", () => Promise.reject(new Response("busy", { status: 503 })))).toBe("shown");
  });

  it("keeps the page when the answer is behind it, so that an old stored copy never takes the page back", async () => {
    const onScreen = createOnScreen<number>({ behind: (next, shown) => next < shown });
    onScreen.show("xrpl", 107);
    expect(await onScreen.reload("xrpl", async () => 100)).toBe(107);
    expect(await onScreen.reload("xrpl", async () => 107)).toBe(107);
    expect(await onScreen.reload("xrpl", async () => 108)).toBe(108);
    // Another page: nothing to compare with.
    expect(await onScreen.reload("xahau", async () => 5)).toBe(5);
  });
});
