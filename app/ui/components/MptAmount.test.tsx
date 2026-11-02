import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { MptAmount } from "./MptAmount";

afterEach(cleanup);

// An MPT amount (spec 5, decision 14): the issuance ID and the integer value, raw, as D5's MPT amount object has them; E14 adds the issuer, the scaled value, the ticker and the link.
const ID = "0000012A8C5E7C1D9C2F3B4A5D6E7F8091A2B3C4D5E6F708";
const routed = (ui: ReactElement) => <MemoryRouter>{ui}</MemoryRouter>;

describe("MptAmount", () => {
  it("draws raw grouped units and the first 8 hex digits, the full ID in title", () => {
    const { container } = render(<MptAmount id={ID} units="2500000" />);
    expect(container.textContent).toBe("2,500,000 units of MPT 0000012A…");
    const amount = container.firstElementChild!;
    expect(amount.getAttribute("title")).toBe(`MPT ${ID}`);
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
    expect(container.querySelector(".mptamount")!.getAttribute("title")).toBe(`MPT ${ID}`);
  });

  it("links nothing for a null href, as for none: MPT is off", () => {
    const { container } = render(<MptAmount id={ID} units="1" href={null} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("1 units of MPT 0000012A…");
  });

  describe("with the scaled value", () => {
    it("draws the value and the ticker: '1,240,000.00 HTF'", () => {
      const { container } = render(<MptAmount id={ID} units="124000000" value="1240000.00" ticker="HTF" />);
      expect(container.textContent).toBe("1,240,000.00 HTF");
      expect(container.querySelector(".mptamount")!.classList.contains("mono")).toBe(true);
    });

    it("says 'units' when the issuance has no ticker", () => {
      const { container } = render(<MptAmount id={ID} units="124000000" value="1240000.00" />);
      expect(container.textContent).toBe("1,240,000.00 units");
    });

    it("keeps the decimals the scale writes and groups the integer part only", () => {
      expect(render(<MptAmount id={ID} units="1" value="0.000000000000001" ticker="HTF" />).container.textContent).toBe("0.000000000000001 HTF");
      cleanup();
      expect(render(<MptAmount id={ID} units="1" value="-1005.890000" ticker="HTF" />).container.textContent).toBe("−1,005.890000 HTF");
    });

    it("links the ticker, or 'units', and only with href; the title names the issuance, and the issuer when it is known", () => {
      const { container, rerender } = render(<MptAmount id={ID} units="5" value="0.05" ticker="HTF" />);
      expect(container.querySelector("a")).toBeNull();

      rerender(routed(<MptAmount id={ID} units="5" value="0.05" ticker="HTF" issuer="rIssuer" href={`/xrpl/mpt/${ID}`} />));
      const link = screen.getByRole("link");
      expect(link.getAttribute("href")).toBe(`/xrpl/mpt/${ID}`);
      expect(link.textContent).toBe("HTF");
      expect(container.textContent).toBe("0.05 HTF");
      expect(container.querySelector(".mptamount")!.getAttribute("title")).toBe(`MPT ${ID} issued by rIssuer`);

      rerender(routed(<MptAmount id={ID} units="5" value="0.05" href={`/xrpl/mpt/${ID}`} />));
      expect(screen.getByRole("link").textContent).toBe("units");
    });

    it("keeps the issuer's ticker as text and out of every attribute", () => {
      const hostile = `"><img src=x onerror=alert(1)>`;
      const { container } = render(routed(<MptAmount id={ID} units="5" value="0.05" ticker={hostile} href={`/xrpl/mpt/${ID}`} />));
      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toBe(`0.05 ${hostile}`);
      for (const element of container.querySelectorAll("*")) {
        for (const name of element.getAttributeNames()) expect(element.getAttribute(name), name).not.toContain("onerror");
      }
    });
  });

  it("falls back to the raw words when there is a ticker and no value (a scale above 19): the units, as the ledger holds them", () => {
    const { container } = render(<MptAmount id={ID} units="2500000" ticker="HTF" />);
    expect(container.textContent).toBe("2,500,000 units of MPT 0000012A…");
  });

  it("puts the issuer in the title of the raw form too", () => {
    const { container } = render(<MptAmount id={ID} units="1" issuer="rIssuer" />);
    expect(container.querySelector(".mptamount")!.getAttribute("title")).toBe(`MPT ${ID} issued by rIssuer`);
  });
});
