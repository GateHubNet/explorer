import type { Config } from "@react-router/dev/config";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // The manifest of every route is in the first page, and nothing is asked for later. The default ("lazy") fetches
  // `/__manifest?paths=...` as links come into view or are hovered: with nine routes that buys nothing, and each such request
  // is a Worker invocation that is never stored and counts against the visitor limit (60 renders per 10 s per address).
  routeDiscovery: { mode: "initial" },
} satisfies Config;
