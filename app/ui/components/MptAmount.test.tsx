import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { MptAmount } from "./MptAmount";

afterEach(cleanup);

// An MPT amount (spec 5, decision 14): the issuance ID and the integer value, raw, as D5's MPT amount object has them. E14 adds the scale, the ticker and the link.
const ID = "0000012A8C5E7C1D9C2F3B4A5D6E7F8091A2B3C4D5E6F708";
const routed = (ui: ReactElement) => <MemoryRouter>{ui}</MemoryRouter>;

describe("MptAmount", () => {
  it("draws raw grouped units and the first 8 hex digits, the full ID in title", () => {
    const { container } = render(<MptAmount id={ID} units="2500000" />);
    expect(container.textContent).toBe("2,500,000 units of MPT 0000012A…");
    const amount = container.firstElementChild!;
    expect(amount.getAttribute("title")).toBe(ID);
    expect(amount.classList.contains("mono")).toBe(true);
    expect(amount.classList.contains("mptamount")).toBe(true);
  });

  it("does not scale the value, and keeps every digit of a big one", () => {
    const { container } = render(<MptAmount id={ID} units="9223372036854775807" />);
    expect(container.textContent).toBe("9,223,372,036,854,775,807 units of MPT 0000012A…");
  });

  it("links the ID when href is given and not otherwise", () => {
    const { container, rerender } = render(<MptAmount id={ID} units="1" />);
    expect(container.querySelector("a")).toBeNull();

    rerender(routed(<MptAmount id={ID} units="1" href="/xrpl/mpt/0000012A" />));
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/xrpl/mpt/0000012A");
    expect(link.textContent).toBe("0000012A…");
    // The words stay outside the link; the title of the whole is still the full ID.
    expect(container.textContent).toBe("1 units of MPT 0000012A…");
    expect(container.querySelector(".mptamount")!.getAttribute("title")).toBe(ID);
  });
});
