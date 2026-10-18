import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import type { FlowStep } from "../../domain/describe";
import { shortAddress } from "../../domain/format";
import { Flow } from "./Flow";

afterEach(cleanup);

const ALICE = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";
const BOB = "rNYbL8WZKKNNni5rb2MzcxnAEgkQC5Kq5";
const POOL = "rAtRwrVakWQaGpzxtqgJZDb3Tg7t32rXT";
const USD = { currency: "USD", issuer: "rA7wzfRjziBcrbFwErG1t2sdVofKQmg95" };

const steps: FlowStep[] = [
  { role: "sender", account: ALICE, label: "Sender", amount: { value: "512.402115", currency: "XRP" } },
  { role: "pool", account: POOL, label: "XRP/USD AMM pool", amount: { value: "1250.00", ...USD } },
  { role: "destination", account: BOB, label: "Destination · tag 104882", amount: { value: "1250.00", ...USD } },
];

function renderInRouter(ui: ReactElement) {
  const router = createMemoryRouter([{ path: "*", element: ui }], { initialEntries: ["/xrpl/tx/AB"] });
  return render(<RouterProvider router={router} />);
}

describe("Flow", () => {
  it("is a group named for what it shows, with a node per step in order", () => {
    renderInRouter(<Flow net="xrpl" steps={steps} />);
    const group = screen.getByRole("group", { name: "Flow of funds" });
    const nodes = group.querySelectorAll(".flow__node");
    expect([...nodes].map((node) => node.querySelector(".flow__label")?.textContent)).toEqual([
      "Sender",
      "XRP/USD AMM pool",
      "Destination · tag 104882",
    ]);
  });

  it("links each account, shortened, to its page on the network", () => {
    renderInRouter(<Flow net="xahau" steps={steps} />);
    const links = within(screen.getByRole("group")).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([shortAddress(ALICE), shortAddress(POOL), shortAddress(BOB)]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([`/xahau/account/${ALICE}`, `/xahau/account/${POOL}`, `/xahau/account/${BOB}`]);
  });

  it("shows what the sender gave up as a loss, what the destination got as a gain, and what a pool paid out as it is", () => {
    renderInRouter(<Flow net="xrpl" steps={steps} />);
    const [sender, pool, destination] = [...screen.getByRole("group").querySelectorAll(".flow__node")] as HTMLElement[];
    expect(sender!.querySelector(".amt")?.textContent).toBe("−512.402115 XRP");
    expect(sender!.querySelector(".amt")?.classList.contains("amt--pos")).toBe(false);
    expect(pool!.querySelector(".amt")?.textContent).toBe("1,250.00 USD");
    expect(pool!.textContent).toContain("pays out");
    expect(destination!.querySelector(".amt")?.textContent).toBe("+1,250.00 USD");
    expect(destination!.querySelector(".amt")?.classList.contains("amt--pos")).toBe(true);
  });

  it("separates the nodes by arrows that screen readers skip", () => {
    renderInRouter(<Flow net="xrpl" steps={steps} />);
    const arrows = screen.getByRole("group").querySelectorAll(".flow__arrow");
    expect(arrows).toHaveLength(2);
    for (const arrow of arrows) expect(arrow.getAttribute("aria-hidden")).toBe("true");
  });

  it("sets a pool or an offer apart from the two ends", () => {
    renderInRouter(<Flow net="xrpl" steps={steps} />);
    const nodes = [...screen.getByRole("group").querySelectorAll(".flow__node")];
    expect(nodes.map((node) => node.classList.contains("flow__node--via"))).toEqual([false, true, false]);
  });

  it("leaves out the amount of a step that has none, and the link of one without an account", () => {
    renderInRouter(<Flow net="xrpl" steps={[{ role: "sender", account: ALICE, label: "Sender" }, { role: "offer", account: "", label: "DEX offer" }]} />);
    const nodes = [...screen.getByRole("group").querySelectorAll(".flow__node")];
    expect(nodes[0]!.querySelector(".amt")).toBeNull();
    expect(nodes[1]!.querySelector("a")).toBeNull();
  });

  it("writes an amount of an unreadable currency code as text", () => {
    renderInRouter(
      <Flow net="xrpl" steps={[{ role: "destination", account: BOB, label: "Destination", amount: { value: "3", currency: "524C555344000000000000000000000000000000", issuer: USD.issuer } }]} />,
    );
    expect(screen.getByRole("group").querySelector(".amt")?.textContent).toBe("+3 RLUSD");
  });
});
