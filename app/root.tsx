import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import { forwardCacheClass } from "./server/edge-cache";
import { getEnv } from "./server/env";
import { PRODUCT_NAME } from "./ui/brand";
import { Shell } from "./ui/components/Shell";
import { environmentOf, networkKindOf, type Environment } from "./ui/environment";
import { FONT_PRELOADS } from "./ui/fonts";
import { DEFAULT_NETWORK_ID, findNetwork, networkChoices } from "./ui/networks";
import { errorMeta, RouteErrorScreen } from "./ui/pages/RouteErrorScreen";
import styles from "./ui/styles.css?url";
import { THEME_SCRIPT } from "./ui/theme-script";
import { useEnvironment } from "./ui/use-network";

import type { Route } from "./+types/root";

// The root route's error boundary can show a thrown 404, whose cache class must reach the document (see edge-cache.ts).
export const headers = forwardCacheClass;

/** The loader data of the root route: what components outside the `/:net` layout's data need (`useEnvironment()`, app/ui/use-network.ts). */
export type RootLoaderData = { environment: Environment };

/**
 * The environment of this deployment, for the error pages, the not-found route and the network switch, which have no `/:net` data of their own.
 * It names no cache class: the page's class stands, as for the `/:net` layout's loader.
 */
export function loader({ context }: Route.LoaderArgs): RootLoaderData {
  return { environment: environmentOf(getEnv(context).ENVIRONMENT) };
}

// The environment does not change while a visitor is on the page: the root's data is fetched with the document and never again, so a navigation
// (or the home page's refresh every few seconds) makes no request for it.
export const shouldRevalidate = () => false;

export const links: Route.LinksFunction = () => [...FONT_PRELOADS, { rel: "stylesheet", href: styles }];

// The description names the networks of the environment (the root's own data: no `/:net` layout above it). Without the data (the loader failed) it is the mainnets'.
export const meta: Route.MetaFunction = ({ error, loaderData }) => {
  if (error) return errorMeta(error);
  const [a, b] = networkChoices(networkKindOf(loaderData?.environment ?? "development"));
  return [
    { title: PRODUCT_NAME },
    { name: "description", content: `Look up any ledger, transaction or account on ${a.longName} and ${b.longName}.` },
  ];
};

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is added to <html> by THEME_SCRIPT before anything is drawn, so the server does not render it (and
    // React is told not to mind the difference).
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        {/* Before the stylesheet, so the stored theme is on <html> when the first styles apply. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

// Errors outside `/:net` (it has a boundary of its own): the page frame of the default network, as the environment names it, around the error.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const net = findNetwork(DEFAULT_NETWORK_ID, networkKindOf(useEnvironment()));
  return (
    <Shell net={net}>
      <RouteErrorScreen error={error} net={net} />
    </Shell>
  );
}
