import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDisclosureMenu } from "./use-disclosure-menu";

// The behaviour a header menu has once the page is live (supply spec 2.4): the `<details>` already opens and closes by itself, and works without any of this. The hook adds what a
// disclosure does not do alone: Escape, a pointer outside, focus leaving, a navigation, a link chosen in the panel (beyond spec 2.4: the final review's finding 4) and one open menu at a time.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A menu as Header draws one: a `details` with its `data-menu`, a `summary` and links. */
function Menu({ name, open }: { name: string; open?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDisclosureMenu(ref);
  return (
    <details ref={ref} className="menu" data-menu={name} {...(open ? { open: true } : {})}>
      <summary>{name} menu</summary>
      <ul>
        <li>
          <a href={`#${name}-1`}>{name} first</a>
        </li>
        <li>
          <a href={`#${name}-2`}>{name} second</a>
        </li>
      </ul>
    </details>
  );
}

function Page({ names = ["network"], open }: { names?: string[]; open?: string }) {
  return (
    <>
      <button type="button">outside</button>
      {names.map((name) => (
        <Menu key={name} name={name} open={open === name} />
      ))}
    </>
  );
}

function mount(ui = <Page />, path = "/xrpl/network") {
  const router = createMemoryRouter([{ path: "*", element: ui }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const menu = (name = "network") => document.querySelector<HTMLDetailsElement>(`details[data-menu="${name}"]`)!;
const summaryOf = (name = "network") => screen.getByText(`${name} menu`);

describe("useDisclosureMenu", () => {
  it("Escape closes the open menu and focuses its summary", () => {
    mount();
    fireEvent.click(summaryOf());
    expect(menu().open).toBe(true);
    const link = screen.getByRole("link", { name: "network second" });
    act(() => link.focus());

    fireEvent.keyDown(link, { key: "Escape" });
    expect(menu().open).toBe(false);
    expect(document.activeElement).toBe(summaryOf());

    // From the summary too, and a key other than Escape does nothing.
    fireEvent.click(summaryOf());
    expect(menu().open).toBe(true);
    fireEvent.keyDown(summaryOf(), { key: "ArrowDown" });
    fireEvent.keyDown(summaryOf(), { key: "Tab" });
    expect(menu().open).toBe(true);
    fireEvent.keyDown(summaryOf(), { key: "Escape" });
    expect(menu().open).toBe(false);
  });

  it("leaves focus alone on Escape when the menu is closed, or when focus is not in it", () => {
    mount();
    const outside = screen.getByRole("button", { name: "outside" });
    act(() => outside.focus());
    fireEvent.keyDown(outside, { key: "Escape" });
    expect(document.activeElement).toBe(outside);

    // Open, with focus elsewhere: an Escape that does not come from inside is not the menu's.
    fireEvent.click(summaryOf());
    act(() => outside.focus());
    fireEvent.keyDown(outside, { key: "Escape" });
    expect(menu().open).toBe(true);
    expect(document.activeElement).toBe(outside);
  });

  it("a pointer down outside closes it and leaves focus where it was", () => {
    mount();
    fireEvent.click(summaryOf());
    const link = screen.getByRole("link", { name: "network first" });
    act(() => link.focus());

    // Inside: the summary, a link, and the panel's own text keep it open.
    fireEvent.pointerDown(summaryOf());
    fireEvent.pointerDown(link);
    expect(menu().open).toBe(true);

    fireEvent.pointerDown(document.body);
    expect(menu().open).toBe(false);
    expect(document.activeElement).toBe(link);

    // A menu that is closed stays closed under a pointer down, and a pointer down on another element closes an open one just the same.
    fireEvent.pointerDown(screen.getByRole("button", { name: "outside" }));
    expect(menu().open).toBe(false);
    fireEvent.click(summaryOf());
    fireEvent.pointerDown(screen.getByRole("button", { name: "outside" }));
    expect(menu().open).toBe(false);
  });

  it("focus leaving closes it; a window blur does not", () => {
    mount();
    const outside = screen.getByRole("button", { name: "outside" });
    fireEvent.click(summaryOf());
    const first = screen.getByRole("link", { name: "network first" });
    const second = screen.getByRole("link", { name: "network second" });
    act(() => first.focus());

    // Focus moving inside the menu keeps it open: Tab from one item to the next.
    fireEvent.focusOut(first, { relatedTarget: second });
    fireEvent.focusOut(summaryOf(), { relatedTarget: first });
    expect(menu().open).toBe(true);
    // A window blur (the visitor goes to another window or tab) has no `relatedTarget`: the menu is as they left it.
    fireEvent.focusOut(first, { relatedTarget: null });
    expect(menu().open).toBe(true);

    fireEvent.focusOut(first, { relatedTarget: outside });
    expect(menu().open).toBe(false);
  });

  it("closes when focus really moves to an element outside", () => {
    mount();
    fireEvent.click(summaryOf());
    act(() => screen.getByRole("link", { name: "network first" }).focus());
    expect(menu().open).toBe(true);
    act(() => screen.getByRole("button", { name: "outside" }).focus());
    expect(menu().open).toBe(false);
  });

  it("a navigation closes it, a change of the query too", async () => {
    const router = mount(<Page />, "/xrpl/validators");
    fireEvent.click(summaryOf());
    expect(menu().open).toBe(true);

    // The same location (a revalidation, a re-render) leaves it open.
    await act(() => router.revalidate());
    expect(menu().open).toBe(true);

    await act(() => router.navigate("/xrpl/supply"));
    expect(menu().open).toBe(false);

    fireEvent.click(summaryOf());
    expect(menu().open).toBe(true);
    await act(() => router.navigate("/xrpl/supply?x=1"));
    expect(menu().open).toBe(false);

    // The fragment alone is not a new page.
    fireEvent.click(summaryOf());
    await act(() => router.navigate("/xrpl/supply?x=1#top"));
    expect(menu().open).toBe(true);
  });

  it("choosing a link in the panel closes it, and the link still goes where it goes", () => {
    mount();
    fireEvent.click(summaryOf());
    const link = screen.getByRole("link", { name: "network second" });
    act(() => link.focus());

    // `fireEvent` answers whether the click was left alone: a link that is followed is not prevented.
    expect(fireEvent.click(link)).toBe(true);
    expect(menu().open).toBe(false);
    // Focus is not moved: the link is on its way to a new page, where focus starts over.
    expect(document.activeElement).not.toBe(summaryOf());
  });

  it("choosing the link of the page you are on closes it too, and focus goes to the summary, since no navigation follows to take it out of a panel that is hidden now", () => {
    mount();
    fireEvent.click(summaryOf());
    const link = screen.getByRole("link", { name: "network first" });
    link.setAttribute("aria-current", "page");
    act(() => link.focus());

    expect(fireEvent.click(link)).toBe(true);
    expect(menu().open).toBe(false);
    expect(document.activeElement).toBe(summaryOf());
  });

  it("a click elsewhere in the panel leaves it open", () => {
    mount();
    fireEvent.click(summaryOf());
    fireEvent.click(menu().querySelector("ul")!);
    fireEvent.click(menu().querySelector("li")!);
    expect(menu().open).toBe(true);
    // The summary still toggles it: a click on it is not a link chosen.
    fireEvent.click(summaryOf());
    expect(menu().open).toBe(false);
  });

  it("keeps a menu the visitor opened before the page was live", () => {
    // The server's HTML has the details open (the visitor pressed the summary before hydration): the first run of the hook is that page, not a navigation.
    mount(<Page open="network" />);
    expect(menu().open).toBe(true);
  });

  it("opening one menu closes the others", () => {
    mount(<Page names={["network", "more"]} />);
    fireEvent.click(summaryOf("network"));
    expect(menu("network").open).toBe(true);
    expect(menu("more").open).toBe(false);

    fireEvent.click(summaryOf("more"));
    expect(menu("more").open).toBe(true);
    expect(menu("network").open).toBe(false);

    // By the property too, which is what the `toggle` event follows.
    act(() => {
      menu("network").open = true;
    });
    expect(menu("network").open).toBe(true);
    expect(menu("more").open).toBe(false);
  });

  it("hovering opens nothing", () => {
    mount();
    for (const target of [summaryOf(), menu(), screen.getByRole("link", { name: "network first", hidden: true })]) {
      fireEvent.pointerEnter(target, { pointerType: "mouse" });
      fireEvent.pointerOver(target, { pointerType: "mouse" });
      fireEvent.mouseEnter(target);
      fireEvent.mouseOver(target);
      fireEvent.focus(target);
    }
    expect(menu().open).toBe(false);
  });

  it("takes its listeners off the document when the menu goes", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    mount();
    const added = add.mock.calls.filter(([type]) => type === "pointerdown");
    expect(added).toHaveLength(1);
    cleanup();
    expect(remove.mock.calls.filter(([type, handler]) => type === "pointerdown" && handler === added[0]![1])).toHaveLength(1);
  });
});
