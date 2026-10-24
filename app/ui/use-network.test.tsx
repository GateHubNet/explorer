import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { renderUnderNetwork } from "../../test/support/under-network";
import { NO_FEATURES } from "./features";
import { NETWORK_ROUTE_ID, ROOT_ROUTE_ID, useEnvironment, useFeatures } from "./use-network";

afterEach(cleanup);

const XRPL = {
  id: "xrpl",
  kind: "mainnet",
  name: "XRPL",
  label: "XRPL mainnet",
  longName: "the XRP Ledger",
  dexName: "the XRP Ledger DEX",
  native: "XRP",
  ctidNetworkId: 0,
  other: "xahau",
  hasAmm: true,
  displays: ["native", "usd"],
} as const;

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

function EnvironmentProbe() {
  return <p>{`environment:${useEnvironment()}`}</p>;
}

describe("useEnvironment", () => {
  it("is the id the root has in the route tree", () => {
    expect(ROOT_ROUTE_ID).toBe("root");
  });

  it("gives the root's environment", async () => {
    const router = createMemoryRouter(
      [{ id: ROOT_ROUTE_ID, path: "/", loader: () => ({ environment: "sandbox" }), element: <EnvironmentProbe /> }],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByText("environment:sandbox")).toBeTruthy();
  });

  it("takes a value the root should not hold for development", async () => {
    const router = createMemoryRouter(
      [{ id: ROOT_ROUTE_ID, path: "/", loader: () => ({ environment: "Sandbox" }), element: <EnvironmentProbe /> }],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByText("environment:development")).toBeTruthy();
  });

  it("gives development without root data, without a router, and never throws", () => {
    const withoutRoot = createMemoryRouter([{ path: "*", element: <EnvironmentProbe />, ErrorBoundary: () => <p>threw</p> }]);
    render(<RouterProvider router={withoutRoot} />);
    expect(screen.queryByText("threw")).toBeNull();
    expect(screen.getByText("environment:development")).toBeTruthy();
    cleanup();

    const emptyRoot = createMemoryRouter(
      [{ id: ROOT_ROUTE_ID, path: "/", loader: () => ({}), hydrateFallbackElement: <p>loading</p>, element: <EnvironmentProbe /> }],
      { initialEntries: ["/"], hydrationData: { loaderData: { [ROOT_ROUTE_ID]: {} } } },
    );
    render(<RouterProvider router={emptyRoot} />);
    expect(screen.getByText("environment:development")).toBeTruthy();
    cleanup();

    render(<EnvironmentProbe />);
    expect(screen.getByText("environment:development")).toBeTruthy();
  });

  it("is the environment the test helper's root route carries, and development where it has none", async () => {
    renderUnderNetwork(<EnvironmentProbe />, NO_FEATURES, { environment: "production" });
    expect(await screen.findByText("environment:production")).toBeTruthy();
    cleanup();

    renderUnderNetwork(<EnvironmentProbe />, NO_FEATURES);
    expect(await screen.findByText("environment:development")).toBeTruthy();
  });
});
