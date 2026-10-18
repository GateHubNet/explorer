import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RawTabs, type RawTab } from "./RawTabs";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const tabs: RawTab[] = [
  { id: "tx", label: "Transaction", text: '{\n  "TransactionType": "Payment"\n}' },
  { id: "meta", label: "Metadata", text: '{\n  "TransactionResult": "tesSUCCESS"\n}' },
  { id: "binary", label: "Binary", text: "Transaction\n1200002200000000", wrap: true },
];

describe("RawTabs on the server, and before the browser has run it", () => {
  // Without JavaScript the tabs cannot switch, so nothing is hidden: all three are on the page, one under the other.
  const html = renderToString(<RawTabs label="Raw data" tabs={tabs} />);

  it("shows all three panels, each under a heading of its name, and no tab buttons that would do nothing", () => {
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("<button");
    for (const tab of tabs) expect(html).toContain(`>${tab.label}</h3>`);
    expect(html).toContain("TransactionType");
    expect(html).toContain("TransactionResult");
    expect(html).toContain("1200002200000000");
  });

  it("hydrates to what the server printed, without a mismatch", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    await act(async () => {
      hydrateRoot(container, <RawTabs label="Raw data" tabs={tabs} />);
    });
    expect(errors).not.toHaveBeenCalled();
    container.remove();
  });
});

describe("RawTabs in the browser", () => {
  it("becomes a tab list of real buttons with one panel, the first", async () => {
    render(<RawTabs label="Raw data" tabs={tabs} />);
    const list = await screen.findByRole("tablist", { name: "Raw data" });
    const buttons = within(list).getAllByRole("tab");
    expect(buttons.map((button) => button.textContent)).toEqual(["Transaction", "Metadata", "Binary"]);
    for (const button of buttons) expect(button.tagName).toBe("BUTTON");
    expect(buttons.map((button) => button.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(buttons.map((button) => button.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);

    const panel = screen.getByRole("tabpanel");
    expect(panel.textContent).toContain("TransactionType");
    expect(panel.getAttribute("aria-labelledby")).toBe(buttons[0]!.id);
    expect(buttons[0]!.getAttribute("aria-controls")).toBe(panel.id);
    expect(screen.queryByText(/TransactionResult/)).toBeNull();
  });

  it("shows the panel of the tab that is clicked", async () => {
    render(<RawTabs label="Raw data" tabs={tabs} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Metadata" }));
    expect(screen.getByRole("tab", { name: "Metadata" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toContain("TransactionResult");
    expect(screen.queryByText(/TransactionType/)).toBeNull();
  });

  it("moves with the arrow keys, Home and End, wrapping round", async () => {
    render(<RawTabs label="Raw data" tabs={tabs} />);
    const first = await screen.findByRole("tab", { name: "Transaction" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Metadata" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Metadata" }));

    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("tab", { name: "Binary" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Transaction" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Binary" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(screen.getByRole("tab", { name: "Transaction" }).getAttribute("aria-selected")).toBe("true");
  });

  it("copies the text of the panel that is showing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<RawTabs label="Raw data" tabs={tabs} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Metadata" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(tabs[1]!.text));
  });

  it("makes the text of a panel a keyboard-reachable region named for its tab", async () => {
    render(<RawTabs label="Raw data" tabs={tabs} />);
    const region = await screen.findByRole("region", { name: "Transaction" });
    expect(region.tagName).toBe("PRE");
    expect(region.getAttribute("tabindex")).toBe("0");
  });

  it("wraps the text of a panel that asks for it (a blob of hex has no spaces to break at)", async () => {
    render(<RawTabs label="Raw data" tabs={tabs} />);
    expect((await screen.findByRole("region", { name: "Transaction" })).className).not.toContain("code--wrap");
    fireEvent.click(screen.getByRole("tab", { name: "Binary" }));
    expect(screen.getByRole("region", { name: "Binary" }).className).toContain("code--wrap");
  });

  it("shows a note instead of text for a tab that has one, and offers no copy for it", async () => {
    const withNote: RawTab[] = [tabs[0]!, { id: "binary", label: "Binary", note: "The binary form could not be loaded just now." }];
    render(<RawTabs label="Raw data" tabs={withNote} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Binary" }));
    expect(screen.getByRole("tabpanel").textContent).toContain("The binary form could not be loaded just now.");
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Transaction" }));
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("shows the note too in the server's markup, under the heading of its tab", () => {
    const html = renderToString(<RawTabs label="Raw data" tabs={[{ id: "binary", label: "Binary", note: "Shown once the transaction is indexed." }]} />);
    expect(html).toContain(">Binary</h3>");
    expect(html).toContain("Shown once the transaction is indexed.");
  });
});
