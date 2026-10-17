import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import { forwardCacheClass } from "./server/edge-cache";
import { PRODUCT_NAME } from "./ui/brand";
import { Shell } from "./ui/components/Shell";
import { FONT_PRELOADS } from "./ui/fonts";
import { DEFAULT_NETWORK } from "./ui/networks";
import { errorMeta, RouteErrorScreen } from "./ui/pages/RouteErrorScreen";
import styles from "./ui/styles.css?url";
import { THEME_SCRIPT } from "./ui/theme-script";

import type { Route } from "./+types/root";

// The root route's error boundary can show a thrown 404, whose cache class must reach the document (see edge-cache.ts).
export const headers = forwardCacheClass;

export const links: Route.LinksFunction = () => [...FONT_PRELOADS, { rel: "stylesheet", href: styles }];

export const meta: Route.MetaFunction = ({ error }) =>
  error
    ? errorMeta(error)
    : [
        { title: PRODUCT_NAME },
        { name: "description", content: "Look up any ledger, transaction or account on the XRP Ledger and Xahau." },
      ];

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

// Errors outside `/:net` (it has a boundary of its own): the page frame of the default network around the error.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <Shell net={DEFAULT_NETWORK}>
      <RouteErrorScreen error={error} net={DEFAULT_NETWORK} />
    </Shell>
  );
}
