import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  // `/`: a redirect to the visitor's last network.
  index("routes/index.tsx"),
  route("robots.txt", "routes/robots[.]txt.ts"),
  // `/:net`: the layout every page of a network sits in (header, footer, the network's accent). The pages are its children.
  route(":net", "routes/net.tsx", [
    index("routes/net._index.tsx"),
    route("ledger/:id", "routes/net.ledger.$id.tsx"),
    route("tx/:id", "routes/net.tx.$id.tsx"),
    route("account/:address", "routes/net.account.$address.tsx"),
    // A resource route: a CSV of the account's payments, not a page. React Router runs its own loader only.
    route("account/:address/payments.csv", "routes/net.account.$address.payments[.csv].ts"),
    route("search", "routes/net.search.tsx"),
  ]),
  // Anything else.
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
