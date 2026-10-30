import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { permissionChip } from "../../domain/permissions";
import { PermissionChip } from "./PermissionChip";

afterEach(cleanup);

describe("PermissionChip", () => {
  it("draws a transaction type by its name, with the kind and the words as title, and the words in text for a screen reader", () => {
    const { container } = render(<PermissionChip chip={permissionChip("Payment")} />);
    const chip = container.firstElementChild!;
    expect(chip.classList.contains("permchip")).toBe(true);
    // The plain chip is the transaction type's; the narrower rights and the unknown ones are the modifiers.
    expect(chip.className).toBe("permchip");
    expect(chip.getAttribute("title")).toBe("Transaction type. Any Payment transaction");
    expect(chip.firstChild!.textContent).toBe("Payment");
    const words = chip.querySelector(".sr");
    expect(words!.textContent).toContain("Any Payment transaction");
    // The title is for a pointer; a screen reader gets the same in the text.
    expect(chip.textContent).toBe("Payment: Any Payment transaction");
  });

  it("draws a narrower right by its name, styled apart from a transaction type", () => {
    const { container } = render(<PermissionChip chip={permissionChip("TrustlineFreeze")} />);
    const chip = container.firstElementChild!;
    expect(chip.classList.contains("permchip--granular")).toBe(true);
    expect(chip.className).toBe("permchip permchip--granular");
    expect(chip.getAttribute("title")).toBe("Narrower right. Only freezing trust lines, within TrustSet");
    expect(chip.querySelector(".sr")!.textContent).toContain("Only freezing trust lines, within TrustSet");
  });

  it("draws a permission this explorer does not know by its number, and says so", () => {
    const { container } = render(<PermissionChip chip={permissionChip(12345)} />);
    const chip = container.firstElementChild!;
    expect(chip.className).toBe("permchip permchip--unknown");
    expect(chip.firstChild!.textContent).toBe("Permission 12345");
    expect(chip.getAttribute("title")).toBe("A permission this explorer does not know (value 12345)");
    expect(chip.querySelector(".sr")!.textContent).toContain("A permission this explorer does not know (value 12345)");
  });

  it("has no link, button or control: it is a word with a tooltip", () => {
    const { container } = render(<PermissionChip chip={permissionChip("Payment")} />);
    expect(container.querySelector("a, button, [tabindex]")).toBeNull();
  });
});
