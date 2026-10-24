import { fileURLToPath } from "node:url";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { configDefaults, defineConfig } from "vitest/config";

import { FEATURE_VARS, type FeatureVar } from "./app/ui/features.ts";

// The switches at the top level of wrangler.jsonc, which the `worker` project runs with (README, "Switches"). A switch is "on" here from
// the moment the code it gates is built (`VALIDATORS`, `AMM_DATA`, `MARKETS`, `ACCOUNT_ANALYTICS`, `AMM_PAGES`). The `satisfies` fails until a new switch is
// listed. The `worker-off` project does not read this: it sets every switch of `FEATURE_VARS` "off".
const TOP_LEVEL_SWITCHES = { VALIDATORS: "on", AMM_DATA: "on", MARKETS: "on", ACCOUNT_ANALYTICS: "on", AMM_PAGES: "on" } satisfies Record<FeatureVar, "on" | "off">;

// Pinned for the worker projects, so that a developer's .dev.vars (a real key, a Sentry DSN, a local
// data API) cannot change what the tests do or where they send requests.
const testBindings = {
  ENVIRONMENT: "development",
  XRPL_DATA_API_URL: "https://xrpl.data.example.invalid",
  XAHAU_DATA_API_URL: "https://xahau.data.example.invalid",
  XRPL_NODE_URL: "https://s1.ripple.com:51234/",
  XAHAU_NODE_URL: "https://xahau.network/",
  DATA_API_KEY: "test-key",
  SENTRY_DSN: "",
  BUILD_ID: "test-build",
  ...TOP_LEVEL_SWITCHES,
};

// `~/` is `app/`, as in tsconfig.cloudflare.json. The projects below are not built from vite.config.ts, so
// they do not see its `resolve.tsconfigPaths`; each lists the alias itself.
const resolve = { alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) } };

// The `worker-off` project's bindings: the same, with every switch of `FEATURE_VARS` "off".
const offBindings = { ...testBindings, ...Object.fromEntries(FEATURE_VARS.map((name) => [name, "off"])) };

// The `worker-sandbox` project's bindings: the top level's (its placeholder URLs and its switches, so that every page can be drawn over the
// existing fixtures, which are mainnet data standing in for the testnets') with `ENVIRONMENT` "sandbox". No test reaches a deployed data API.
const sandboxBindings = { ...testBindings, ENVIRONMENT: "sandbox" };

export default defineConfig({
  // The root config is the Worker projects' (`worker`, `worker-off` and `worker-sandbox`, below): they share its one Vite server, and so its one React Router
  // plugin. That plugin removes and rewrites `.react-router/types` each time a server starts, and two of them starting together raced on the
  // directory (ENOTEMPTY, EINVAL: `pnpm test` sometimes failed to start). What tells the projects apart is the `workerBindings` each is
  // `provide`d, which the Workers plugin reads for its Miniflare. `unit` and `components` have servers of their own and do not extend this.
  plugins: [
    cloudflareTest(({ inject }) => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: inject<Record<string, string>>("workerBindings") },
    })),
    reactRouter(),
  ],
  resolve,
  test: {
    // Process the stylesheet, so that `styles.css?url` in root.tsx is a real URL as it is in the build.
    css: true,
    // Every dependency goes through Vite: workerd cannot load what Node would (extensionless imports inside node_modules, such as
    // @opentelemetry/api's, which @sentry/cloudflare needs). The Workers plugin sets this on its own project; the children here share the
    // root's server and read the root's test options, so it is written out.
    server: { deps: { inline: true } },
    // CommonJS packages that require() ES modules cannot be loaded as they are in workerd, so
    // Vite pre-bundles them, as it does in the production build.
    deps: {
      optimizer: {
        ssr: { enabled: true, include: ["ripple-address-codec"] },
      },
    },
    projects: [
      {
        // Pure code: Node. (The components of app/ui need a DOM and are the `components` project.)
        extends: false,
        resolve,
        test: {
          name: "unit",
          environment: "node",
          include: ["app/**/*.test.ts", "scripts/**/*.test.ts", "test/unit/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "app/ui/**"],
        },
      },
      {
        // Components and the browser-side code of app/ui: happy-dom.
        extends: false,
        resolve,
        test: {
          name: "components",
          environment: "happy-dom",
          include: ["app/ui/**/*.test.{ts,tsx}"],
        },
      },
      {
        // Loaders and the Worker entry: the Workers runtime (workerd), on the app's own Worker config.
        test: {
          name: "worker",
          include: ["test/worker/**/*.spec.ts"],
          // The files of the projects below.
          exclude: [...configDefaults.exclude, "test/worker/**/*-off.spec.ts", "test/worker/**/*-sandbox.spec.ts"],
          provide: { workerBindings: testBindings },
        },
      },
      {
        // The same Worker with every switch "off" (spec 6.1): the off-case of a page or a feature, in files named `*-off.spec.ts`.
        test: {
          name: "worker-off",
          include: ["test/worker/**/*-off.spec.ts"],
          provide: { workerBindings: offBindings },
        },
      },
      {
        // The Worker as the sandbox runs it: `ENVIRONMENT` "sandbox", so that the facts and names are the testnets' (sandbox spec 5), in files named
        // `*-sandbox.spec.ts`. A page gets a case here only where it says something per kind of network.
        test: {
          name: "worker-sandbox",
          include: ["test/worker/**/*-sandbox.spec.ts"],
          provide: { workerBindings: sandboxBindings },
        },
      },
    ],
  },
});
