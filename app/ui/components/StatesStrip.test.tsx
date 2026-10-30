import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatesStrip, type StateItem } from "./StatesStrip";

afterEach(cleanup);

// The board's words for an escrow's states (Escrow.dc.html), in its order.
const STATES = [
  { id: "pending", label: "Pending", meaning: "Locked: FinishAfter has not passed yet." },
  { id: "can_be_finished", label: "Can be finished", meaning: "FinishAfter has passed: anyone can finish it." },
  { id: "can_be_cancelled", label: "Can be cancelled", meaning: "CancelAfter has passed: anyone can cancel it." },
  { id: "finished", label: "Finished", meaning: "Paid to the destination, then removed." },
  { id: "cancelled", label: "Cancelled", meaning: "Returned to the owner, then removed." },
] as const;
const items = (current: string | null): StateItem[] => STATES.map((state) => ({ ...state, current: state.id === current }));

describe("StatesStrip", () => {
  it("is a list named States, one item per state in the order given, each with its label and its meaning", () => {
    render(<StatesStrip states={items("pending")} what="escrow" />);
    const list = screen.getByRole("list", { name: "States" });
    const entries = within(list).getAllByRole("listitem");
    expect(entries).toHaveLength(5);
    entries.forEach((entry, index) => {
      expect(entry.textContent).toContain(STATES[index]!.label);
      expect(entry.textContent).toContain(STATES[index]!.meaning);
    });
  });

  it("marks the current state with aria-current and · this escrow, and none for a removed object", () => {
    const { rerender } = render(<StatesStrip states={items("can_be_finished")} what="escrow" />);
    const current = document.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain("Can be finished");
    expect(current[0]!.textContent).toContain("· this escrow");
    expect(document.body.textContent!.match(/· this escrow/g)).toHaveLength(1);

    // An object removed by another kind of transaction is in none of the states: nothing is marked.
    rerender(<StatesStrip states={items(null)} what="escrow" />);
    expect(document.querySelector("[aria-current]")).toBeNull();
    expect(document.body.textContent).not.toContain("· this");
  });

  it("says what the object is in the mark: · this check", () => {
    render(<StatesStrip states={items("pending")} what="check" />);
    expect(screen.getByText(/· this check/)).toBeTruthy();
  });

  it("is a static legend: nothing in it is a button, a link or a switch", () => {
    render(<StatesStrip states={items("pending")} what="escrow" />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
