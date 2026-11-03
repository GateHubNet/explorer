import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { MptPageData } from "../../server/mpt-view";
import { MptFlags } from "./MptFlags";

afterEach(cleanup);

const flags: MptPageData["flags"] = {
  intro: "What the issuer allows, as the issuance says now.",
  rows: [
    { label: "Can lock", yes: true, line: "The issuer can lock one holder's balance, or all of HTF, so it cannot move." },
    { label: "Require auth", yes: false, line: "Any account can hold HTF without the issuer's approval." },
    { label: "Can escrow", yes: true, line: "HTF can be held in escrows." },
    { label: "Can trade", yes: false, line: "The issuer does not allow HTF on the DEX." },
    { label: "Can transfer", yes: true, line: "Holders can send HTF to each other, not only back to the issuer." },
    { label: "Can clawback", yes: false, line: "The issuer cannot take HTF back." },
  ],
};

describe("MptFlags", () => {
  it("draws the intro and the six rows in order, each with its label, Yes or No in text, and its line", () => {
    const { container } = render(<MptFlags flags={flags} />);
    expect(container.querySelector(".mptflags__intro")!.textContent).toBe("What the issuer allows, as the issuance says now.");
    const rows = [...container.querySelectorAll<HTMLElement>("li")];
    expect(rows.map((row) => [row.querySelector(".mptflags__label")!.textContent, row.querySelector(".pill")!.textContent, row.querySelector(".mptflags__line")!.textContent])).toEqual([
      ["Can lock", "Yes", "The issuer can lock one holder's balance, or all of HTF, so it cannot move."],
      ["Require auth", "No", "Any account can hold HTF without the issuer's approval."],
      ["Can escrow", "Yes", "HTF can be held in escrows."],
      ["Can trade", "No", "The issuer does not allow HTF on the DEX."],
      ["Can transfer", "Yes", "Holders can send HTF to each other, not only back to the issuer."],
      ["Can clawback", "No", "The issuer cannot take HTF back."],
    ]);
  });

  it("says Yes and No in words, not in the pill's colour alone: a 'Yes' has its check, a 'No' is a plain pill without an icon", () => {
    const { container } = render(<MptFlags flags={flags} />);
    const [yes, no] = [...container.querySelectorAll<HTMLElement>(".pill")] as [HTMLElement, HTMLElement];
    expect(yes.classList.contains("pill--ok")).toBe(true);
    expect(yes.querySelector("svg")).not.toBeNull();
    expect(no.classList.contains("pill--neutral")).toBe(true);
    expect(no.querySelector("svg")).toBeNull();
    expect(within(container).getAllByText("Yes")).toHaveLength(3);
    expect(within(container).getAllByText("No")).toHaveLength(3);
  });

  it("is a list of six, for a screen reader", () => {
    const { container } = render(<MptFlags flags={flags} />);
    expect(container.querySelector("ul")!.children).toHaveLength(6);
  });

  it("draws the words as text: markup in a line is not markup", () => {
    const hostile = `"><img src=x onerror=alert(1)>`;
    const { container } = render(<MptFlags flags={{ intro: "x", rows: [{ label: "Can lock", yes: true, line: `${hostile} can be held in escrows.` }] }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".mptflags__line")!.textContent).toBe(`${hostile} can be held in escrows.`);
  });
});
