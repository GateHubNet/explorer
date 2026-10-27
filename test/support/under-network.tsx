import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { vi, type Mock } from "vitest";

import type { PublicNetwork } from "../../app/server/network-route";
import type { Environment } from "../../app/ui/environment";
import { NO_FEATURES, type Features } from "../../app/ui/features";
import type { NetworkRouteHandle } from "../../app/ui/route-handle";
import { NETWORK_ROUTE_ID, ROOT_ROUTE_ID } from "../../app/ui/use-network";

// What the component tests of app/ui share to draw a component as the app does, under the `/:net` layout: the layout's data holds the network and
// this deployment's switches, which `useNetwork()` and `useFeatures()` read (the header's items, a sentence's or a flow's pool link, an account's LP
// tokens). Without the layout `useFeatures()` gives `NO_FEATURES`, so a test of a switch that is on needs this.

/** The layout's network when a test names none: XRPL, as `publicNetwork` gives it but for the switches, which are the test's. */
export const LAYOUT_XRPL: Omit<PublicNetwork, "features"> = {
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
  software: "rippled",
  displays: ["native", "usd"],
};
/** Xahau as the layout's network (`UnderNetworkOptions.network`). */
export const LAYOUT_XAHAU: Omit<PublicNetwork, "features"> = {
  ...LAYOUT_XRPL,
  id: "xahau",
  name: "Xahau",
  label: "Xahau mainnet",
  longName: "Xahau",
  dexName: "the Xahau DEX",
  native: "XAH",
  ctidNetworkId: 21337,
  other: "xrpl",
  hasAmm: false,
  software: "xahaud",
  displays: ["native"],
};
/** The XRPL Testnet, the sandbox's network: its names are the sandbox's, which the pages say in sentences (`longName`). */
export const LAYOUT_XRPL_TESTNET: Omit<PublicNetwork, "features"> = {
  ...LAYOUT_XRPL,
  kind: "testnet",
  name: "XRPL Testnet",
  label: "XRPL Testnet",
  longName: "XRPL Testnet",
  dexName: "the XRPL Testnet DEX",
  ctidNetworkId: 1,
  displays: ["native"],
};
/** The switches of the NFT pages' tests: `NFTS` on, every other off. */
export const NFTS_ON: Features = { ...NO_FEATURES, nfts: true };

export interface UnderNetworkOptions {
  /** The URL the router starts at: `/{network}` by default. */
  path?: string;
  /** The network of the layout's data, over XRPL's (Xahau's id and name, say). `features` is the test's, whatever this holds. */
  network?: Partial<Omit<PublicNetwork, "features">>;
  /** The `handle` of the page's route, as a page names its section of the header (`navSection`). */
  handle?: NetworkRouteHandle;
  /** The environment of the root's data, which `useEnvironment()` reads: the root route (`ROOT_ROUTE_ID`) is only there when this is given, as without a root in a test. */
  environment?: Environment;
  /**
   * Gives the router the data of its routes at once, as the document gives them to the browser (its hydration data): the layout's, the root's when there is an `environment`, and
   * `null` for the page's route. No loader runs before the page draws, so a test reads it without `findBy…`, and a render of the same router to a string
   * (`underNetworkRouter` into `serverThenHydrated`) prints what the browser then takes over.
   */
  hydrated?: boolean;
  /** The page's route: its `id` (what the hydration data of a `hydrated` router is keyed by) and a `loader`, which a Retry (`useRetry`) revalidates: a test passes a mock and counts its calls. */
  page?: { id: string; loader?: () => null };
}

/**
 * The router of `ui` as the page of a route under the `/:net` layout (`NETWORK_ROUTE_ID`) whose data holds the network with `features`: on the network's own path (the index)
 * and on any path below it (`*`). With an `environment` the layout sits in the root route (`ROOT_ROUTE_ID`) whose data holds it, for `useEnvironment()`. Without `hydrated` the
 * layout's loader runs first.
 */
export function underNetworkRouter(ui: ReactElement, features: Features, { path, network, handle, environment, hydrated = false, page }: UnderNetworkOptions = {}) {
  const shown: PublicNetwork = { ...LAYOUT_XRPL, ...network, features };
  const layout = {
    id: NETWORK_ROUTE_ID,
    path: "/:net",
    loader: () => ({ network: shown }),
    element: <Outlet />,
    children: [
      { index: true, element: ui, handle },
      { path: "*", element: ui, handle, ...(page === undefined ? {} : { id: page.id, ...(page.loader === undefined ? {} : { loader: page.loader }) }) },
    ],
  };
  // The root of the app is a pathless route around the layout; it carries the environment, as app/root.tsx's loader does.
  const routes = environment === undefined ? [layout] : [{ id: ROOT_ROUTE_ID, loader: () => ({ environment }), element: <Outlet />, children: [layout] }];
  const loaderData = {
    ...(environment === undefined ? {} : { [ROOT_ROUTE_ID]: { environment } }),
    [NETWORK_ROUTE_ID]: { network: shown },
    ...(page === undefined ? {} : { [page.id]: null }),
  };
  return createMemoryRouter(routes, { initialEntries: [path ?? `/${shown.id}`], ...(hydrated ? { hydrationData: { loaderData } } : {}) });
}

/**
 * `ui` drawn as the page of a route under the `/:net` layout (`underNetworkRouter`). The layout's loader runs first unless the options say `hydrated`, so a test waits for what
 * `ui` draws (`findBy…`). The router is in the result.
 */
export function renderUnderNetwork(ui: ReactElement, features: Features, options: UnderNetworkOptions = {}): RenderResult & { router: ReturnType<typeof underNetworkRouter> } {
  const router = underNetworkRouter(ui, features, options);
  return { router, ...render(<RouterProvider router={router} />) };
}

/** Where and as what a page of the NFT pages is drawn: its URL, the layout's network and switches. */
export interface PageOptions {
  at: string;
  network?: Omit<PublicNetwork, "features">;
  features?: Features;
}

/**
 * A page test's mount: `ui` at `at` in a router that has its data at once (`hydrated`), the page's route named `id` with a `loader` that counts the revalidations a Retry asks for
 * (`loader` is in the result). The network is XRPL's and the switches `NFTS_ON` unless the options say otherwise.
 */
export function mountPage(ui: ReactElement, id: string, { at, network = LAYOUT_XRPL, features = NFTS_ON }: PageOptions): ReturnType<typeof renderUnderNetwork> & { loader: Mock<() => null> } {
  const loader = vi.fn(() => null);
  return { loader, ...renderUnderNetwork(ui, features, { path: at, network, hydrated: true, page: { id, loader } }) };
}

/** A page test's server render: the element of `mountPage`'s router (without a loader), for `renderToString` and `serverThenHydrated`. */
export function routedPage(ui: ReactElement, { at, network = LAYOUT_XRPL, features = NFTS_ON }: PageOptions): ReactElement {
  return <RouterProvider router={underNetworkRouter(ui, features, { path: at, network, hydrated: true })} />;
}
