import { createRequestHandler } from "react-router";

import { createLoadContext, type Env } from "../app/server/env";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, createLoadContext(env, ctx));
  },
} satisfies ExportedHandler<Env>;
