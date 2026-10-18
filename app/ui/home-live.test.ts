import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HomeLoaderData } from "../server/home-view";
import { createHomeOnScreen } from "./home-live";

// A deploy while the home page is open: the Worker answering is of a new build, the code in the browser is the old one. Data of a new shape
// must not be drawn by old code, so the page reloads, once. (The data says which build made it, `HomeLoaderData.build`.)

const page = (build: string, index: number) => ({ build, latest: { index } }) as HomeLoaderData;

beforeEach(() => sessionStorage.clear());
afterEach(() => sessionStorage.clear());

function setup(storage: () => Storage | undefined = () => sessionStorage) {
  const reload = vi.fn();
  const onScreen = createHomeOnScreen({ reload, storage });
  return { onScreen, reload };
}

describe("a refresh of the home page", () => {
  it("renders the answer of the build the page was loaded with, and does not reload", async () => {
    const { onScreen, reload } = setup();
    onScreen.show("xrpl", page("abc1234", 100));
    const next = page("abc1234", 101);
    expect(await onScreen.reload("xrpl", async () => next)).toBe(next);
    expect(reload).not.toHaveBeenCalled();
    expect(onScreen.failures()).toBe(0);
  });

  it("reloads the document once when the answer is of another build, and keeps the page meanwhile", async () => {
    const { onScreen, reload } = setup();
    const shown = page("abc1234", 100);
    onScreen.show("xrpl", shown);
    expect(await onScreen.reload("xrpl", async () => page("def5678", 101))).toBe(shown);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload twice for the same pair of builds, so that a skew that stays cannot make a loop", async () => {
    const { onScreen, reload } = setup();
    const shown = page("abc1234", 100);
    onScreen.show("xrpl", shown);
    await onScreen.reload("xrpl", async () => page("def5678", 101));
    expect(await onScreen.reload("xrpl", async () => page("def5678", 102))).toBe(shown);
    expect(await onScreen.reload("xrpl", async () => page("def5678", 103))).toBe(shown);
    expect(reload).toHaveBeenCalledTimes(1);
    // It is the marker of this tab that remembers, so a page that came back from the reload with the same pair does not reload again either.
    const second = setup();
    second.onScreen.show("xrpl", shown);
    await second.onScreen.reload("xrpl", async () => page("def5678", 104));
    expect(second.reload).not.toHaveBeenCalled();
  });

  it("counts the refresh it did not draw as one that did not work, so that the page can say so and slow down", async () => {
    const { onScreen } = setup();
    onScreen.show("xrpl", page("abc1234", 100));
    await onScreen.reload("xrpl", async () => page("def5678", 101));
    expect(onScreen.failures()).toBe(1);
  });

  it("reloads again for another pair of builds", async () => {
    const { onScreen, reload } = setup();
    onScreen.show("xrpl", page("abc1234", 100));
    await onScreen.reload("xrpl", async () => page("def5678", 101));
    onScreen.show("xrpl", page("def5678", 101));
    await onScreen.reload("xrpl", async () => page("0f0f0f0", 102));
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not reload when it cannot remember that it did: a reload loop is worse than an old page", async () => {
    for (const storage of [
      () => {
        throw new Error("storage is blocked");
      },
      () => undefined,
      () =>
        ({
          getItem: () => null,
          setItem: () => {
            throw new Error("quota");
          },
        }) as unknown as Storage,
    ]) {
      const { onScreen, reload } = setup(storage);
      const shown = page("abc1234", 100);
      onScreen.show("xrpl", shown);
      expect(await onScreen.reload("xrpl", async () => page("def5678", 101))).toBe(shown);
      expect(reload).not.toHaveBeenCalled();
    }
  });

  it("copes with a marker that is not what it wrote", async () => {
    sessionStorage.setItem("explorer:build-reloads", "{not json");
    const { onScreen, reload } = setup();
    onScreen.show("xrpl", page("abc1234", 100));
    await onScreen.reload("xrpl", async () => page("def5678", 101));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the page when the answer is older than the ledger it shows, whatever its build says", async () => {
    const { onScreen, reload } = setup();
    const shown = page("abc1234", 100);
    onScreen.show("xrpl", shown);
    expect(await onScreen.reload("xrpl", async () => page("abc1234", 90))).toBe(shown);
    expect(reload).not.toHaveBeenCalled();
    expect(onScreen.failures()).toBe(1);
  });

  it("compares nothing for another network's page: a switch from XRPL to Xahau is a navigation, and its ledger is not 'older'", async () => {
    const { onScreen, reload } = setup();
    onScreen.show("xrpl", page("abc1234", 107_000_000));
    const xahau = page("abc1234", 26_000_000);
    expect(await onScreen.reload("xahau", async () => xahau)).toBe(xahau);
    expect(reload).not.toHaveBeenCalled();
  });
});
