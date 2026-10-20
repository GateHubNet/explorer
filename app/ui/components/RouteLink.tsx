import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * A link to a route of the app, by the path a view builder wrote (`/xrpl/account/r…`): React Router's `Link`, so that a click is a
 * client-side navigation and, without the script, a plain `<a href>`. The chart kit uses it for the label of a `BarList` item that has an
 * `href`: the kit may not import `react-router` itself (`test/unit/charts-bundle.test.ts`), and reaches the router through the components.
 */
export function RouteLink({ to, className, title, children }: { to: string; className?: string; title?: string; children: ReactNode }) {
  return (
    <Link to={to} className={className} title={title}>
      {children}
    </Link>
  );
}
