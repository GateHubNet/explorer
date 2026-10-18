import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HomeLoaderData } from "../server/home-view";
import { createHomeOnScreen } from "./home-live";

// A deploy while the home page is open: the Worker answering is of a new build, the code in the browser is the old one. Data of a new shape
// must not be drawn by old code, so the page reloads, once. (The data says which build made it, `HomeLoaderData.build`.)

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
