#!/bin/sh
# Starts the built Worker under workerd (`wrangler dev`) on 0.0.0.0:$PORT, as test/e2e/stack.ts does.
#
# The Worker reads these names from the container's environment, through an env file that only this process can read. A name
# that is not set keeps the value of the build, which is wrangler.jsonc's top level: its data API hosts are placeholders, so
# XRPL_DATA_API_URL, XAHAU_DATA_API_URL and DATA_API_KEY must be set. No other variable of the container reaches the Worker
# (CLOUDFLARE_INCLUDE_PROCESS_ENV=false in the image).
set -eu

NAMES="XRPL_DATA_API_URL XAHAU_DATA_API_URL XRPL_NODE_URL XAHAU_NODE_URL DATA_API_KEY SENTRY_DSN
VALIDATORS AMM_DATA MARKETS ACCOUNT_ANALYTICS AMM_PAGES"

umask 077
env_file="$(mktemp)"
for name in $NAMES; do
  value="$(printenv "$name" || true)"
  if [ -n "$value" ]; then
    # A double-quoted dotenv value: a backslash and a double quote are escaped.
    escaped="$(printf '%s' "$value" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
    printf '%s="%s"\n' "$name" "$escaped" >> "$env_file"
  fi
done

exec wrangler dev \
  --config build/server/wrangler.json \
  --ip 0.0.0.0 \
  --port "${PORT:-8080}" \
  --persist-to /app/state \
  --env-file "$env_file" \
  --show-interactive-dev-session=false \
  --log-level "${WRANGLER_LOG_LEVEL:-info}"
