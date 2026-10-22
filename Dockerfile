# syntax=docker/dockerfile:1
#
# The explorer in a container: the built Worker (`react-router build`: build/server, build/client) run by workerd through
# `wrangler dev`, as the end-to-end suite runs it (test/e2e/stack.ts). Production runs on Cloudflare (`pnpm deploy:production`);
# this image is for self-hosting and local use. Its Cache API and rate limiter are workerd's local ones, kept in /app/state.
# The Worker's variables and secrets come from the container's environment (docker/entrypoint.sh, README "The container image").
#
#   docker build -t explorer .
#   docker run -p 8080:8080 -e XRPL_DATA_API_URL=... -e XAHAU_DATA_API_URL=... -e DATA_API_KEY=... explorer

# The Worker is JavaScript and assets, the same on every platform: it is built once, on the build machine's own platform.
FROM --platform=$BUILDPLATFORM node:24.22.1-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.6.3 --activate
# The whole project before the install: its postinstall hook runs `wrangler types`, which reads wrangler.jsonc.
COPY . .
# The short git commit of the build (README "Configuration"); the context has no .git, so the release workflow passes it.
ARG BUILD_ID=dev
RUN pnpm install --frozen-lockfile \
  && BUILD_ID="$BUILD_ID" pnpm build \
  && node -p "require('wrangler/package.json').version" > /app/wrangler-version

# The runtime is per platform: wrangler brings the workerd binary of the platform it is installed on.
FROM node:24.22.1-bookworm-slim
WORKDIR /app
COPY --from=builder /app/wrangler-version /tmp/wrangler-version
# The wrangler of the lockfile, so that what runs here is what the tests ran.
RUN npm install --global --no-fund --no-audit "wrangler@$(cat /tmp/wrangler-version)" \
  && rm /tmp/wrangler-version \
  && npm cache clean --force
COPY --from=builder /app/build ./build
COPY docker/entrypoint.sh ./entrypoint.sh
RUN mkdir -p /app/state && chown -R node:node /app
USER node
ENV PORT=8080 \
  WRANGLER_SEND_METRICS=false \
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=true \
  CLOUDFLARE_INCLUDE_PROCESS_ENV=false
EXPOSE 8080
# robots.txt is answered by the Worker itself, without a call to the data API.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/robots.txt').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["/app/entrypoint.sh"]
