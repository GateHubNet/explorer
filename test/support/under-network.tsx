import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";

import type { PublicNetwork } from "../../app/server/network-route";
import type { Environment } from "../../app/ui/environment";
import type { Features } from "../../app/ui/features";
import type { NetworkRouteHandle } from "../../app/ui/route-handle";
import { NETWORK_ROUTE_ID, ROOT_ROUTE_ID } from "../../app/ui/use-network";

// What the component tests of app/ui share to draw a component as the app does, under the `/:net` layout: the layout's data holds the network and
// this deployment's switches, which `useNetwork()` and `useFeatures()` read (the header's items, a sentence's or a flow's pool link, an account's LP
// tokens). Without the layout `useFeatures()` gives `NO_FEATURES`, so a test of a switch that is on needs this.

/** The layout's network when a test names none: XRPL, as `publicNetwork` gives it but for the switches, which are the test's. */
const XRPL: Omit<PublicNetwork, "features"> = { id: "xrpl", name: "XRPL", native: "XRP", ctidNetworkId: 0, other: "xahau", hasAmm: true, software: "rippled" };

export interface UnderNetworkOptions {
  /** The URL the router starts at: `/{network}` by default. */
  path?: string;
  /** The network of the layout's data, over XRPL's (Xahau's id and name, say). `features` is the test's, whatever this holds. */
  network?: Partial<Omit<PublicNetwork, "features">>;
  /** The `handle` of the page's route, as a page names its section of the header (`navSection`). */
  handle?: NetworkRouteHandle;
  /** The environment of the root's data, which `useEnvironment()` reads: the root route (`ROOT_ROUTE_ID`) is only there when this is given, as without a root in a test. */
  environment?: Environment;
}

/**
 * `ui` as the page of a route under the `/:net` layout (`NETWORK_ROUTE_ID`) whose data holds the network with `features`: on the network's own
 * path (the index) and on any path below it (`*`). The layout's loader runs first, so a test waits for what `ui` draws (`findBy…`). With an
 * `environment` the layout sits in the root route (`ROOT_ROUTE_ID`) whose data holds it, for `useEnvironment()`.
 */
export function renderUnderNetwork(ui: ReactElement, features: Features, { path, network, handle, environment }: UnderNetworkOptions = {}): RenderResult {
  const shown: PublicNetwork = { ...XRPL, ...network, features };
  const layout = {
    id: NETWORK_ROUTE_ID,
    path: "/:net",
    loader: () => ({ network: shown }),
    element: <Outlet />,
    children: [
      { index: true, element: ui, handle },
      { path: "*", element: ui, handle },
    ],
  };
  // The root of the app is a pathless route around the layout; it carries the environment, as app/root.tsx's loader does.
  const routes = environment === undefined ? [layout] : [{ id: ROOT_ROUTE_ID, loader: () => ({ environment }), element: <Outlet />, children: [layout] }];
  const router = createMemoryRouter(routes, { initialEntries: [path ?? `/${shown.id}`] });
  return render(<RouterProvider router={router} />);
}
