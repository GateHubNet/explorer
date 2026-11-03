import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { allSwitches } from "../../../test/support/switches";
import { renderUnderNetwork } from "../../../test/support/under-network";
import { featuresOf, NO_FEATURES, type Features } from "../features";
import { MptLink } from "./MptLink";

afterEach(cleanup);

const ID = "0000012A8C5E7C1D9C2F3B4A5D6E7F8091A2B3C4D5E6F708";

/** `ui` under the `/:net` layout whose data holds `features`: what `useFeatures()` reads. */
const renderWith = (ui: ReactElement, features: Features) => renderUnderNetwork(ui, features, { path: "/xrpl/tx/AB" });

describe("MptLink", () => {
  const on = featuresOf(allSwitches("on"));

  it("is a link to the issuance's page named for its ticker, the whole ID in its title, while MPT is on", async () => {
    renderWith(<MptLink net="xrpl" id={ID} ticker="HTF" />, on);
    const link = await screen.findByRole("link", { name: "HTF" });
    expect(link.getAttribute("href")).toBe(`/xrpl/mpt/${ID}`);
    expect(link.getAttribute("title")).toBe(`MPT ${ID}`);
    expect(link.classList.contains("mptlink")).toBe(true);
  });

  it("says 'MPT' and the first 8 digits of the ID when there is no ticker", async () => {
    renderWith(<MptLink net="xahau" id={ID} />, on);
    const link = await screen.findByRole("link", { name: "MPT 0000012A…" });
    expect(link.getAttribute("href")).toBe(`/xahau/mpt/${ID}`);
  });

  it("is the words as text, with no link, while MPT is off or without the layout's data", async () => {
    renderWith(<MptLink net="xrpl" id={ID} ticker="HTF" />, { ...on, mpt: false });
    await screen.findByText("HTF");
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();
    renderWith(<MptLink net="xrpl" id={ID} />, { ...NO_FEATURES, mpt: false });
    await screen.findByText("MPT 0000012A…");
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();
    const router = createMemoryRouter([{ path: "*", element: <MptLink net="xrpl" id={ID} ticker="HTF" /> }], { initialEntries: ["/xrpl/tx/AB"] });
    render(<RouterProvider router={router} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps the issuer's ticker as text: markup in it is not markup, and it reaches no attribute", async () => {
    const hostile = `"><img src=x onerror=alert(1)>`;
    const { container } = renderWith(<MptLink net="xrpl" id={ID} ticker={hostile} />, on);
    await screen.findByRole("link");
    expect(container.querySelector("img")).toBeNull();
    const link = container.querySelector("a")!;
    expect(link.textContent).toBe(hostile);
    for (const name of link.getAttributeNames()) expect(link.getAttribute(name), name).not.toContain("onerror");
  });
});
