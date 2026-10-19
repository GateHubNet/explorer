import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HomeLoaderData } from "../server/home-view";
import { createLiveOnScreen, keepLoaded, type LivePart } from "./live-page";

// A deploy while a live page is open: the Worker answering is of a new build, the code in the browser is the old one. Data of a new shape
// must not be drawn by old code, so the page reloads, once. (The data says which build made it, `HomeLoaderData.build`.) The home page is the
// live page these cases run against: its `order` is the ledger it shows.

const page = (build: string, index: number) => ({ build, latest: { index } }) as HomeLoaderData;

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
  sessionStorage.clear();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(() => {
  sessionStorage.clear();
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "visibilityState");
});

function setup(storage: () => Storage | undefined = () => sessionStorage) {
  const reload = vi.fn();
  const onScreen = createLiveOnScreen<HomeLoaderData>({ order: (data) => data.latest.index, deps: { reload, storage } });
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

// A reload throws away what the visitor is typing, in the hero's search box or anywhere: the page waits until they are not.
describe("a deploy while the visitor is typing", () => {
  const field = (tag: "input" | "textarea", type?: string): HTMLInputElement => {
    const element = document.createElement(tag);
    if (type) element.setAttribute("type", type);
    document.body.appendChild(element);
    return element as HTMLInputElement;
  };
  const type = (element: HTMLInputElement | HTMLTextAreaElement, text: string) => {
    element.value = text;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const leave = (element: HTMLElement) => {
    element.blur();
    element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  };
  const refused = async (onScreen: ReturnType<typeof setup>["onScreen"], index = 101) => {
    await onScreen.reload("xrpl", async () => page("def5678", index));
  };

  it("does not reload while a text field has focus, and reloads when it is blurred and empty", async () => {
    const { onScreen, reload } = setup();
    onScreen.show("xrpl", page("abc1234", 100));
    const search = field("input", "search");
    search.focus();
    await refused(onScreen);
    expect(reload).not.toHaveBeenCalled();
    leave(search);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload while a field holds text, blurred or not, and reloads when it is emptied", async () => {
    const { onScreen, reload } = setup();
    onScreen.show("xrpl", page("abc1234", 100));
    const search = field("input", "search");
    search.focus();
    type(search, "rJF2Xan");
    leave(search);
    await refused(onScreen);
    expect(reload).not.toHaveBeenCalled();
    type(search, "rJF2Xan..");
    expect(reload).not.toHaveBeenCalled();
    type(search, "");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a textarea", () => field("textarea")],
    ["an input with no type", () => field("input")],
    ["an email field", () => field("input", "email")],
  ])("waits for any text field of the page, not only the hero's: %s", async (_name, make) => {
    const { onScreen, reload } = setup();
    onScreen.show("xrpl", page("abc1234", 100));
    const element = make();
    type(element, "text");
    await refused(onScreen);
    expect(reload).not.toHaveBeenCalled();
    type(element, "");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("waits for an editable element, too", async () => {
    const { onScreen, reload } = setup();
    onScreen.show("xrpl", page("abc1234", 100));
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    // (happy-dom has no layout of editing: the property a browser derives from the attribute.)
    Object.defineProperty(editable, "isContentEditable", { value: true });
    editable.textContent = "text";
    document.body.appendChild(editable);
    await refused(onScreen);
    expect(reload).not.toHaveBeenCalled();
    editable.textContent = "";
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("is not held up by what is not for typing: a focused button, a checkbox, an empty field that has no focus", async () => {
    const { onScreen, reload } = setup();
    onScreen.show("xrpl", page("abc1234", 100));
    field("input", "search");
    const checkbox = field("input", "checkbox");
    checkbox.focus();
    await refused(onScreen);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads when the tab is hidden, whatever is in the field: the visitor is not looking", async () => {
    const { onScreen, reload } = setup();
    onScreen.show("xrpl", page("abc1234", 100));
    const search = field("input", "search");
    search.focus();
    type(search, "rJF2Xan");
    await refused(onScreen);
    expect(reload).not.toHaveBeenCalled();
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not stack its waiting: many refused answers while the visitor types are one reload when they stop", async () => {
    const { onScreen, reload } = setup();
    onScreen.show("xrpl", page("abc1234", 100));
    const search = field("input", "search");
    search.focus();
    await refused(onScreen, 101);
    await refused(onScreen, 102);
    await refused(onScreen, 103);
    leave(search);
    expect(reload).toHaveBeenCalledTimes(1);
    // Nothing is listening any more: more events reload nothing.
    type(search, "");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("notes that it has reloaded when it does, not when it starts to wait, so that a page left before then is not counted as reloaded for", async () => {
    const { onScreen, reload } = setup();
    onScreen.show("xrpl", page("abc1234", 100));
    const search = field("input", "search");
    search.focus();
    await refused(onScreen);
    expect(sessionStorage.getItem("explorer:build-reloads")).toBeNull();
    leave(search);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem("explorer:build-reloads")!)).toEqual(["abc1234>def5678"]);
  });

  it("reloads at once, as before, when nobody is typing", async () => {
    const { onScreen, reload } = setup();
    onScreen.show("xrpl", page("abc1234", 100));
    await refused(onScreen);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

// What a live page says is older: the `order` it was made with. The home page's is its ledger, the network page's the last validated ledger.
describe("a refresh of a live page: what is older", () => {
  type Data = { build: string; order: number; label: string };
  const data = (order: number, label = "", build = "abc1234"): Data => ({ build, order, label });
  const make = (merge?: (next: Data, shown: Data) => Data) => {
    const reload = vi.fn();
    const onScreen = createLiveOnScreen<Data>({
      order: (d) => d.order,
      merge,
      deps: { reload, storage: () => sessionStorage },
    });
    return { onScreen, reload };
  };

  it("refuses an answer with a lower order, and counts it as a refresh that did not work", async () => {
    const { onScreen, reload } = make();
    const shown = data(100);
    onScreen.show("xrpl", shown);
    expect(await onScreen.reload("xrpl", async () => data(99))).toBe(shown);
    expect(onScreen.failures()).toBe(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("accepts an answer with an equal order", async () => {
    const { onScreen } = make();
    onScreen.show("xrpl", data(100));
    const same = data(100, "again");
    expect(await onScreen.reload("xrpl", async () => same)).toBe(same);
    expect(onScreen.failures()).toBe(0);
  });

  it("compares nothing for a scope that is not on screen", async () => {
    const { onScreen } = make();
    onScreen.show("xrpl?period=30d", data(100));
    const other = data(5);
    expect(await onScreen.reload("xrpl?period=1y", async () => other)).toBe(other);
  });

  describe("the merge", () => {
    const merged = data(0, "merged");

    it("is called with (next, shown) for an accepted answer of the scope on screen, and what it returns is what reload returns", async () => {
      const merge = vi.fn(() => merged);
      const { onScreen } = make(merge);
      const shown = data(100, "shown");
      const next = data(101, "next");
      onScreen.show("xrpl", shown);
      expect(await onScreen.reload("xrpl", async () => next)).toBe(merged);
      expect(merge).toHaveBeenCalledTimes(1);
      expect(merge).toHaveBeenCalledWith(next, shown);
      expect(onScreen.failures()).toBe(0);
    });

    it("is not called for an answer that is refused: not for a lower order, not for another build", async () => {
      const merge = vi.fn(() => merged);
      const { onScreen } = make(merge);
      const shown = data(100, "shown");
      onScreen.show("xrpl", shown);
      expect(await onScreen.reload("xrpl", async () => data(99))).toBe(shown);
      expect(await onScreen.reload("xrpl", async () => data(101, "", "def5678"))).toBe(shown);
      expect(merge).not.toHaveBeenCalled();
    });

    it("is not called for a scope that is not on screen (a navigation), nor for a failed load", async () => {
      const merge = vi.fn(() => merged);
      const { onScreen } = make(merge);
      const next = data(101, "next");
      expect(await onScreen.reload("xrpl", async () => next)).toBe(next);
      onScreen.show("xrpl", data(100, "shown"));
      expect(await onScreen.reload("xahau", async () => next)).toBe(next);
      await onScreen.reload("xrpl", () => Promise.reject(new Error("503")));
      expect(merge).not.toHaveBeenCalled();
    });
  });
});

// The merge of every live page whose parts can fail on their own (spec 6.3).
describe("keepLoaded", () => {
  type D = { a: LivePart; b: LivePart; x: LivePart };
  const part = (state: string, v?: number): LivePart & { v?: number } => ({ state, v });
  const page = (a: LivePart, b: LivePart, x: LivePart = part("ok")): D => ({ a, b, x });

  it("takes a part that failed in the answer from the page on screen, and the rest from the answer", () => {
    const next = page(part("failed"), part("ok", 2));
    const shown = page(part("ok", 1), part("ok", 1));
    const kept = keepLoaded(next, shown, ["a", "b"]);
    expect(kept.a).toBe(shown.a);
    expect(kept.b).toBe(next.b);
    expect(kept.x).toBe(next.x);
    expect(kept).not.toBe(next);
  });

  it("shows the failure of a part that has never loaded: it failed in both", () => {
    const next = page(part("failed"), part("ok", 2));
    const shown = page(part("failed"), part("ok", 1));
    const kept = keepLoaded(next, shown, ["a", "b"]);
    expect(kept.a).toBe(next.a);
  });

  it("leaves a part alone that `parts` does not name", () => {
    const next = page(part("ok", 2), part("ok", 2), part("failed"));
    const shown = page(part("ok", 1), part("ok", 1), part("ok", 1));
    const kept = keepLoaded(next, shown, ["a", "b"]);
    expect(kept.x).toBe(next.x);
  });

  it("returns the answer itself when nothing is kept", () => {
    const next = page(part("ok", 2), part("ok", 2));
    expect(keepLoaded(next, page(part("ok", 1), part("failed")), ["a", "b"])).toBe(next);
    // Failed in the answer and in nothing else but a part that is not named.
    const unnamed = page(part("ok", 2), part("ok", 2), part("failed"));
    expect(keepLoaded(unnamed, page(part("ok"), part("ok"), part("ok")), ["a", "b"])).toBe(unnamed);
    expect(keepLoaded(next, next, [])).toBe(next);
  });

  it.each(["off", "missing"])("takes %s for an answer that replaces a part that was loaded", (state) => {
    const next = page(part(state), part("ok", 2));
    const shown = page(part("ok", 1), part("ok", 1));
    const kept = keepLoaded(next, shown, ["a", "b"]);
    expect(kept.a).toBe(next.a);
    expect(kept).toBe(next);
  });

  it("keeps a part that is missing, which is an answer, when the next one failed", () => {
    const next = page(part("failed"), part("ok", 2));
    const shown = page(part("missing"), part("ok", 1));
    const kept = keepLoaded(next, shown, ["a", "b"]);
    expect(kept.a).toBe(shown.a);
    expect(kept.a.state).toBe("missing");
  });
});
