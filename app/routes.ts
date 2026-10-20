import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  // `/`: a redirect to the visitor's last network.
  index("routes/index.tsx"),
  route("robots.txt", "routes/robots[.]txt.ts"),
  // `/:net`: the layout every page of a network sits in (header, footer, the network's accent). The pages are its children.
  route(":net", "routes/net.tsx", [
    index("routes/net._index.tsx"),
    route("network", "routes/net.network.tsx"),
    route("markets", "routes/net.markets.tsx"),
    route("ledger/:id", "routes/net.ledger.$id.tsx"),
    route("tx/:id", "routes/net.tx.$id.tsx"),
    route("account/:address", "routes/net.account.$address.tsx"),
    // A resource route: a CSV of the account's payments, not a page. React Router runs its own loader only.
    route("account/:address/payments.csv", "routes/net.account.$address.payments[.csv].ts"),
    route("search", "routes/net.search.tsx"),
    route("validators", "routes/net.validators.tsx"),
    route("validators/:key", "routes/net.validators.$key.tsx"),
    route("amendments", "routes/net.amendments.tsx"),
    route("amendments/:name", "routes/net.amendments.$name.tsx"),
  ]),
  // A resource route: the link-preview image of a transaction, ledger or account (`/og/xrpl/tx/{hash}.png`). Outside `:net`: no layout.
  route("og/:net/:kind/:id.png", "routes/og.$net.$kind.$id[.png].tsx"),
  // Anything else.
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
