import { getEnv } from "../server/env";

import type { Route } from "./+types/home";

// A placeholder; Task 9 of the plan replaces it with the redirect to /xrpl.
export function loader({ context }: Route.LoaderArgs) {
  return { build: getEnv(context).BUILD_ID };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <h1>explorer</h1>
      <p data-build={loaderData.build}>XRPL and Xahau block explorer. Coming soon.</p>
    </main>
  );
}
