import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOnScreen } from "./on-screen";

// A revalidation that fails would replace the page with the error screen (React Router drops the route's data and shows its boundary).
// `createOnScreen` is what the home route's `clientLoader` uses to hand back what the page already shows instead; it also counts the
// refreshes that did not work, which the page's polling (backoff) and its "paused" signal read.

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

  it("does not hide a redirect: a thrown 3xx Response is React Router's to follow", async () => {
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

  it("does not hide an abort: a navigation that interrupted the refresh is not a failure of it", async () => {
    const onScreen = createOnScreen<string>();
    onScreen.show("xrpl", "shown");
    const aborted = new DOMException("The operation was aborted.", "AbortError");
    await expect(onScreen.reload("xrpl", () => Promise.reject(aborted))).rejects.toBe(aborted);
    expect(onScreen.failures()).toBe(0);
  });
});

describe("refusing an answer", () => {
  it("keeps the page when the answer is one `refuse` says no to, so that an old stored copy never takes the page back", async () => {
    const onScreen = createOnScreen<number>({ refuse: (next, shown) => next < shown });
    onScreen.show("xrpl", 107);
    expect(await onScreen.reload("xrpl", async () => 100)).toBe(107);
    expect(await onScreen.reload("xrpl", async () => 107)).toBe(107);
    expect(await onScreen.reload("xrpl", async () => 108)).toBe(108);
    // Another page: nothing to compare with.
    expect(await onScreen.reload("xahau", async () => 5)).toBe(5);
  });

  it("counts a refused answer as a refresh that did not work", async () => {
    const onScreen = createOnScreen<number>({ refuse: (next, shown) => next < shown });
    onScreen.show("xrpl", 107);
    await onScreen.reload("xrpl", async () => 100);
    expect(onScreen.failures()).toBe(1);
    await onScreen.reload("xrpl", async () => 108);
    expect(onScreen.failures()).toBe(0);
  });
});

describe("merging an answer", () => {
  // The page is made of parts that can fail on their own; `merge` is how a page keeps the ones it has when the next answer lacks them.
  const merge = (next: string, shown: string) => `${next}+${shown}`;

  it("hands the page the merge of the answer and what it shows, when the answer is accepted and its page is on screen", async () => {
    const onScreen = createOnScreen<string>({ merge });
    onScreen.show("xrpl", "shown");
    expect(await onScreen.reload("xrpl", async () => "fresh")).toBe("fresh+shown");
    expect(onScreen.failures()).toBe(0);
  });

  it("merges with what the page shows, not with the page that was shown before it", async () => {
    const onScreen = createOnScreen<string>({ merge });
    onScreen.show("xrpl", "old");
    onScreen.show("xrpl", "new");
    expect(await onScreen.reload("xrpl", async () => "fresh")).toBe("fresh+new");
  });

  it("does not merge an answer that `refuse` says no to: the page keeps what it shows", async () => {
    const mine = vi.fn((next: number, shown: number) => Math.max(next, shown));
    const onScreen = createOnScreen<number>({ refuse: (next, shown) => next < shown, merge: mine });
    onScreen.show("xrpl", 107);
    expect(await onScreen.reload("xrpl", async () => 100)).toBe(107);
    expect(mine).not.toHaveBeenCalled();
  });

  it("does not merge for a page that is not on screen (a navigation, another scope), nor for a load that failed", async () => {
    const mine = vi.fn(merge);
    const onScreen = createOnScreen<string>({ merge: mine });
    expect(await onScreen.reload("xrpl", async () => "fresh")).toBe("fresh");
    onScreen.show("xahau", "another network's page");
    expect(await onScreen.reload("xrpl", async () => "fresh")).toBe("fresh");
    expect(await onScreen.reload("xahau", failure)).toBe("another network's page");
    expect(mine).not.toHaveBeenCalled();
  });

  it("asks for the merge after the refusal, so that a refused answer is never merged and an accepted one is merged once", async () => {
    const calls: string[] = [];
    const onScreen = createOnScreen<number>({
      refuse: (next, shown) => (calls.push(`refuse ${next}`), next < shown),
      merge: (next, shown) => (calls.push(`merge ${next}`), Math.max(next, shown)),
    });
    onScreen.show("xrpl", 10);
    await onScreen.reload("xrpl", async () => 9);
    await onScreen.reload("xrpl", async () => 11);
    expect(calls).toEqual(["refuse 9", "refuse 11", "merge 11"]);
  });
});

describe("counting the refreshes that did not work", () => {
  it("counts consecutive failures, and a success starts the count again", async () => {
    const onScreen = createOnScreen<string>();
    onScreen.show("xrpl", "shown");
    expect(onScreen.failures()).toBe(0);
    await onScreen.reload("xrpl", failure);
    await onScreen.reload("xrpl", failure);
    expect(onScreen.failures()).toBe(2);
    await onScreen.reload("xrpl", async () => "fresh");
    expect(onScreen.failures()).toBe(0);
  });

  it("tells whoever is listening, once for each change, and not for a count that stays", async () => {
    const onScreen = createOnScreen<string>();
    onScreen.show("xrpl", "shown");
    const listener = vi.fn();
    const stop = onScreen.subscribe(listener);
    await onScreen.reload("xrpl", async () => "fresh");
    expect(listener).not.toHaveBeenCalled();
    await onScreen.reload("xrpl", failure);
    await onScreen.reload("xrpl", failure);
    await onScreen.reload("xrpl", async () => "fresh");
    expect(listener).toHaveBeenCalledTimes(3);
    stop();
    await onScreen.reload("xrpl", failure);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("starts from nothing when a page appears or leaves, and does not count a failure that nothing was on screen for", async () => {
    const onScreen = createOnScreen<string>();
    const leave = onScreen.show("xrpl", "shown");
    await onScreen.reload("xrpl", failure);
    expect(onScreen.failures()).toBe(1);
    leave();
    expect(onScreen.failures()).toBe(0);
    await expect(onScreen.reload("xrpl", failure)).rejects.toThrow();
    expect(onScreen.failures()).toBe(0);
    onScreen.show("xrpl", "shown");
    await onScreen.reload("xrpl", failure);
    onScreen.show("xahau", "another network");
    expect(onScreen.failures()).toBe(0);
  });
});

describe("a refresh that does not settle", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  it("is given up after 10 s: the page stays, the refresh counts as failed, and a late answer is ignored", async () => {
    const onScreen = createOnScreen<string>();
    onScreen.show("xrpl", "shown");
    let answer!: (value: string) => void;
    const hung = new Promise<string>((resolve) => (answer = resolve));
    const outcome = onScreen.reload("xrpl", () => hung);

    await vi.advanceTimersByTimeAsync(9999);
    let settled = false;
    void outcome.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe("shown");
    expect(onScreen.failures()).toBe(1);
    // The answer that comes after is nobody's: nothing is thrown, nothing changes.
    answer("too late");
    await Promise.resolve();
    expect(onScreen.failures()).toBe(1);
  });

  it("leaves no timer behind for a refresh that answered", async () => {
    const onScreen = createOnScreen<string>();
    onScreen.show("xrpl", "shown");
    await onScreen.reload("xrpl", async () => "fresh");
    await onScreen.reload("xrpl", failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is not a limit on a navigation to the page: with nothing on screen the load is waited for", async () => {
    const onScreen = createOnScreen<string>();
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve("arrived"), 30_000));
    const outcome = onScreen.reload("xrpl", () => slow);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await outcome).toBe("arrived");
  });

  it("takes the limit from its options", async () => {
    const onScreen = createOnScreen<string>({ timeoutMs: 1000 });
    onScreen.show("xrpl", "shown");
    const outcome = onScreen.reload("xrpl", () => new Promise<string>(() => {}));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toBe("shown");
  });
});
