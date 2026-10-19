import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { NO_FEATURES } from "./features";
import { NETWORK_ROUTE_ID, useFeatures } from "./use-network";

afterEach(cleanup);

const XRPL = { id: "xrpl", name: "XRPL", native: "XRP", ctidNetworkId: 0, other: "xahau", hasAmm: true } as const;

function Probe() {
  return <p>{JSON.stringify(useFeatures())}</p>;
}

describe("useFeatures", () => {
  it("gives the switches the /:net layout loaded", async () => {
    const router = createMemoryRouter(
      [{ id: NETWORK_ROUTE_ID, path: "/:net", loader: () => ({ network: { ...XRPL, features: { validators: true, ammData: false } } }), element: <Probe /> }],
      { initialEntries: ["/xrpl"] },
    );
    render(<RouterProvider router={router} />);
    expect(JSON.parse((await screen.findByText(/validators/)).textContent!)).toEqual({ validators: true, ammData: false });
  });

  it("is the id the layout has in the route tree", () => {
    expect(NETWORK_ROUTE_ID).toBe("routes/net");
  });

  it("gives NO_FEATURES without the layout, and does not throw", () => {
    const router = createMemoryRouter([{ path: "*", element: <Probe />, ErrorBoundary: () => <p>threw</p> }]);
    render(<RouterProvider router={router} />);
    expect(screen.queryByText("threw")).toBeNull();
    expect(JSON.parse(screen.getByText(/validators/).textContent!)).toEqual(NO_FEATURES);
  });

  it("gives NO_FEATURES to a component rendered under no router at all, and does not throw", () => {
    render(<Probe />);
    expect(JSON.parse(screen.getByText(/validators/).textContent!)).toEqual(NO_FEATURES);
  });

  it("gives NO_FEATURES where the layout's data has no network (an unknown network's error page)", () => {
    const router = createMemoryRouter(
      [{ id: NETWORK_ROUTE_ID, path: "/:net", loader: () => ({}), hydrateFallbackElement: <p>loading</p>, element: <Probe /> }],
      { initialEntries: ["/doge"], hydrationData: { loaderData: { [NETWORK_ROUTE_ID]: {} } } },
    );
    render(<RouterProvider router={router} />);
    expect(JSON.parse(screen.getByText(/validators/).textContent!)).toEqual(NO_FEATURES);
  });
});
