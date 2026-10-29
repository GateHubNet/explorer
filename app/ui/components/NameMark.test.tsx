import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LabelMark, NameMark } from "./NameMark";

afterEach(cleanup);

// The marks beside an account's name (E9, spec 4.2): a shape and a word each, so that meaning is never colour alone. The icons are decorative
// (`aria-hidden`); the words are visually hidden (`.sr`) except the domain's, which is a visible tag.

const svgs = (container: HTMLElement) => Array.from(container.querySelectorAll("svg"));

describe("NameMark", () => {
  it("verified: the seal-check icon in the --ok mark, and the hidden words 'verified name'", () => {
    const { container } = render(<NameMark kind="verified" />);
    const mark = container.querySelector(".namemark")!;
    expect(mark.classList.contains("namemark--verified")).toBe(true);
    expect(mark.classList.contains("namemark--account")).toBe(false);
    expect(container.querySelector(".sr")!.textContent).toBe("verified name");
    expect(container.textContent).toBe("verified name");
    expect(svgs(container)).toHaveLength(1);
  });

  it("account: the tag icon in the --muted mark, and the hidden words 'named by GateHub'", () => {
    const { container } = render(<NameMark kind="account" />);
    const mark = container.querySelector(".namemark")!;
    expect(mark.classList.contains("namemark--account")).toBe(true);
    expect(mark.classList.contains("namemark--verified")).toBe(false);
    expect(container.querySelector(".sr")!.textContent).toBe("named by GateHub");
    expect(container.textContent).toBe("named by GateHub");
    expect(svgs(container)).toHaveLength(1);
  });

  it("domain: the small visible tag 'not verified' (.unv), and no icon and no hidden words", () => {
    const { container } = render(<NameMark kind="domain" />);
    const tag = container.querySelector(".unv")!;
    expect(tag.textContent).toBe("not verified");
    expect(tag.classList.contains("sr")).toBe(false);
    expect(container.querySelector(".sr")).toBeNull();
    expect(container.querySelector(".namemark")).toBeNull();
    expect(svgs(container)).toHaveLength(0);
    expect(container.textContent).toBe("not verified");
  });

  it("draws the board's two icons: the seal with its check, the tag with its hole, 14 px at a stroke of 2.2, and hides them from assistive technology", () => {
    const seal = render(<NameMark kind="verified" />).container.querySelector("svg")!;
    expect(seal.getAttribute("aria-hidden")).toBe("true");
    expect(seal.getAttribute("focusable")).toBe("false");
    expect([seal.getAttribute("width"), seal.getAttribute("height"), seal.getAttribute("stroke-width"), seal.getAttribute("stroke")]).toEqual(["14", "14", "2.2", "currentColor"]);
    expect(Array.from(seal.querySelectorAll("path")).map((path) => path.getAttribute("d"))).toEqual([
      "M12 2.5l2.4 1.8 3 .1.9 2.8 2.4 1.9-.9 2.9.9 2.9-2.4 1.9-.9 2.8-3 .1L12 21.5l-2.4-1.8-3-.1-.9-2.8L3.3 15l.9-2.9-.9-2.9 2.4-1.9.9-2.8 3-.1z",
      "m8.5 12 2.4 2.4 4.6-4.8",
    ]);
    cleanup();

    const tag = render(<NameMark kind="account" />).container.querySelector("svg")!;
    expect(tag.getAttribute("aria-hidden")).toBe("true");
    expect(tag.getAttribute("focusable")).toBe("false");
    expect([tag.getAttribute("width"), tag.getAttribute("height"), tag.getAttribute("stroke-width"), tag.getAttribute("stroke")]).toEqual(["14", "14", "2.2", "currentColor"]);
    expect(tag.querySelector("path")!.getAttribute("d")).toBe("M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z");
    expect(tag.querySelector("circle")!.getAttribute("r")).toBe("1.5");
  });
});

describe("LabelMark", () => {
  it("one label: the alert icon in the --bad mark, and the hidden words 'labelled scam by GateHub'", () => {
    const { container } = render(<LabelMark labels={["scam"]} />);
    expect(container.querySelector(".labelmark")).not.toBeNull();
    expect(container.querySelector(".sr")!.textContent).toBe("labelled scam by GateHub");
    expect(container.textContent).toBe("labelled scam by GateHub");
    expect(svgs(container)).toHaveLength(1);
  });

  it("several labels are joined as a sentence does: 'labelled scam and spam by GateHub', 'scam, spam and advisory'", () => {
    expect(render(<LabelMark labels={["scam", "spam"]} />).container.textContent).toBe("labelled scam and spam by GateHub");
    cleanup();
    expect(render(<LabelMark labels={["scam", "spam", "advisory"]} />).container.textContent).toBe("labelled scam, spam and advisory by GateHub");
  });

  it("hides its icon from assistive technology, at 14 px", () => {
    const icon = render(<LabelMark labels={["scam"]} />).container.querySelector("svg")!;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("focusable")).toBe("false");
    expect([icon.getAttribute("width"), icon.getAttribute("height")]).toEqual(["14", "14"]);
  });

  it("is nothing for no label", () => {
    const { container } = render(<LabelMark labels={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
