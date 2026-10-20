import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { RouteLink } from "./RouteLink";

afterEach(cleanup);

describe("RouteLink", () => {
  it("is a link to the path it is given, in the HTML the Worker prints", () => {
    const html = renderToString(
      <MemoryRouter>
        <RouteLink to="/xrpl/account/rJF2XaN4q9D9E2hzK5qJ6kAn7rR7yGfQvg">rJF2Xa…fQvg</RouteLink>
      </MemoryRouter>,
    );
    expect(html).toContain('href="/xrpl/account/rJF2XaN4q9D9E2hzK5qJ6kAn7rR7yGfQvg"');
    expect(html).toMatch(/^<a [^>]*>rJF2Xa…fQvg<\/a>$/);
  });

  it("takes a class and a title, and no other attribute but the router's own", () => {
    render(
      <MemoryRouter>
        <RouteLink to="/xrpl/ledger/1" className="barlist__link" title="Ledger 1">
          one
        </RouteLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "one" });
    expect(link.getAttribute("href")).toBe("/xrpl/ledger/1");
    expect(link.className).toBe("barlist__link");
    expect(link.getAttribute("title")).toBe("Ledger 1");
    expect(Array.from(link.attributes, (attribute) => attribute.name).filter((name) => name !== "data-discover").sort()).toEqual(["class", "href", "title"]);
  });

  it("navigates in the app, without a page load, as a React Router link does", () => {
    const router = createMemoryRouter(
      [
        { path: "/xrpl/markets/XRP/USD", element: <RouteLink to="/xrpl/account/rA">trader</RouteLink> },
        { path: "/xrpl/account/:address", element: <p>account page</p> },
      ],
      { initialEntries: ["/xrpl/markets/XRP/USD"] },
    );
    render(<RouterProvider router={router} />);
    fireEvent.click(screen.getByRole("link", { name: "trader" }));
    expect(router.state.location.pathname).toBe("/xrpl/account/rA");
    expect(screen.getByText("account page")).toBeTruthy();
  });
});
