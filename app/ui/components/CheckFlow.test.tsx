import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { shortAddress } from "../../domain/format";
import { nameViewOf, type NameMap } from "../../domain/names";
import { NamesProvider } from "../names";
import { CheckFlow, type CheckFlowData } from "./CheckFlow";

afterEach(cleanup);

const SOURCE = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";
const DESTINATION = "rNYbL8WZKKNNni5rb2MzcxnAEgkQC5Kq5";
const ISSUER = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

// The board's words (Check.dc.html): the source pays when the check is cashed, the check is up to its SendMax, the destination can cash it.
const FLOW: CheckFlowData = {
  source: { account: SOURCE, line: "Pays when the check is cashed" },
  check: { title: "Check · expires Oct 19, 2026", line: "up to 1,250.00 USD", issuer: ISSUER },
  destination: { account: DESTINATION, tag: 104882, line: "Can cash up to 1,250.00 USD" },
};

const routed = (ui: ReactElement) => <MemoryRouter>{ui}</MemoryRouter>;
const nodes = () => [...screen.getByRole("group").querySelectorAll(".flow__node")] as HTMLElement[];

describe("CheckFlow", () => {
  it("is a group of three nodes in order, source, the check and destination, each with its label and its line", () => {
    render(routed(<CheckFlow net="xrpl" flow={FLOW} />));
    const [source, check, destination] = nodes();
    expect(nodes()).toHaveLength(3);
    expect(source!.querySelector(".flow__label")!.textContent).toBe("Source");
    expect(source!.textContent).toContain("Pays when the check is cashed");
    expect(check!.querySelector(".flow__label")!.textContent).toBe("Check · expires Oct 19, 2026");
    expect(check!.textContent).toContain("up to 1,250.00 USD");
    expect(destination!.querySelector(".flow__label")!.textContent).toBe("Destination · tag 104882");
    expect(destination!.textContent).toContain("Can cash up to 1,250.00 USD");
  });

  it("is drawn on the transaction flow's styles: .flow, its nodes and its two arrows, which a screen reader skips", () => {
    render(routed(<CheckFlow net="xrpl" flow={FLOW} />));
    const group = screen.getByRole("group");
    expect(group.classList.contains("flow")).toBe(true);
    const arrows = group.querySelectorAll(".flow__arrow");
    expect(arrows).toHaveLength(2);
    for (const arrow of arrows) expect(arrow.getAttribute("aria-hidden")).toBe("true");
    // The check is set apart from the two ends, as a pool is in the flow of a transaction.
    expect(nodes().map((node) => node.classList.contains("flow__node--via"))).toEqual([false, true, false]);
    // Node, arrow, node, arrow, node.
    expect([...group.children].map((child) => (child.classList.contains("flow__arrow") ? "arrow" : "node"))).toEqual(["node", "arrow", "node", "arrow", "node"]);
  });

  it("links the source and the destination to their accounts, as boxes' own links, and the issuer within the check's line", () => {
    render(routed(<CheckFlow net="xahau" flow={FLOW} />));
    const [source, check, destination] = nodes();
    const sourceLink = within(source!).getByRole("link");
    expect(sourceLink.getAttribute("href")).toBe(`/xahau/account/${SOURCE}`);
    expect(sourceLink.textContent).toBe(shortAddress(SOURCE));
    // A direct child of its box: the flow's 44 px target rule (`.flow__node > a`) is for it.
    expect(sourceLink.parentElement).toBe(source);
    expect(within(destination!).getByRole("link").parentElement).toBe(destination);
    expect(within(destination!).getByRole("link").getAttribute("href")).toBe(`/xahau/account/${DESTINATION}`);

    const issuer = within(check!).getByRole("link");
    expect(issuer.getAttribute("href")).toBe(`/xahau/account/${ISSUER}`);
    expect(issuer.closest(".checkflow__issuer")!.textContent).toBe(`issued by ${shortAddress(ISSUER)}`);
  });

  it("draws the issuer as an account link of the page: its name and mark when the page has them (C15)", () => {
    const names: NameMap = {
      [ISSUER]: nameViewOf({ address: ISSUER, display_name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example" })!,
    };
    render(routed(<NamesProvider names={names}><CheckFlow net="xrpl" flow={FLOW} /></NamesProvider>));
    const issuer = screen.getByRole("link", { name: "Northpeak Treasury verified name" });
    expect(issuer.classList.contains("acct")).toBe(true);
    expect(issuer.querySelector(".namemark--verified")).not.toBeNull();
    expect(issuer.closest(".checkflow__issuer")!.textContent).toContain("issued by Northpeak Treasury");
    // The others stay addresses: only the issuer was named.
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("leaves out 'issued by' when the check has no issuer (a check for the native currency), and the tag when there is none", () => {
    const native: CheckFlowData = {
      source: FLOW.source,
      check: { title: "Check · no expiry", line: "up to 500 XRP" },
      destination: { account: DESTINATION, line: "Can cash up to 500 XRP" },
    };
    render(routed(<CheckFlow net="xrpl" flow={native} />));
    const [, check, destination] = nodes();
    expect(check!.querySelector(".checkflow__issuer")).toBeNull();
    expect(check!.textContent).not.toContain("issued by");
    expect(within(check!).queryAllByRole("link")).toHaveLength(0);
    expect(destination!.querySelector(".flow__label")!.textContent).toBe("Destination");
  });

  it("draws the same on the server and in the browser, with nothing that depends on a clock", async () => {
    expect(renderToString(routed(<CheckFlow net="xrpl" flow={FLOW} />))).toContain("Pays when the check is cashed");
    const { errors, container } = await serverThenHydrated(routed(<CheckFlow net="xrpl" flow={FLOW} />));
    expect(errors).toEqual([]);
    expect(container.querySelectorAll(".flow__node")).toHaveLength(3);
  });
});
