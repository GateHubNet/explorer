import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyTextButton } from "./CopyTextButton";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CopyTextButton", () => {
  it("is a button with its label that copies what getText gives when it is clicked, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    let text = "first";
    render(<CopyTextButton getText={() => text}>Copy link</CopyTextButton>);

    const button = screen.getByRole("button", { name: "Copy link" });
    expect(button.getAttribute("type")).toBe("button");
    // Asked at the click, not at the render: the address of a page is known to the browser only.
    text = "second";
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Copied"));
    expect(writeText).toHaveBeenCalledWith("second");
  });

  it("says when it could not copy", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<CopyTextButton getText={() => "x"}>Copy</CopyTextButton>);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/could not copy/i));
  });

  it("says so too when there is no clipboard at all", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    render(<CopyTextButton getText={() => "x"}>Copy</CopyTextButton>);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/could not copy/i));
  });

  it("is a 36 px button like the page's others, and says nothing before it is used", () => {
    render(<CopyTextButton getText={() => "x"}>Copy</CopyTextButton>);
    expect(screen.getByRole("button").className).toContain("btn");
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
