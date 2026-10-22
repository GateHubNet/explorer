#!/bin/sh
# Starts the built Worker under workerd (`wrangler dev`) on 0.0.0.0:$PORT, as test/e2e/stack.ts does.
#
# The Worker's variables and secrets come from the container's environment, through an env file that only this process can read
# (write-env-file.sh: which names, and how each value is carried over unchanged). A name that is not set keeps the value of the build,
# which is wrangler.jsonc's top level: its data API hosts are placeholders, so XRPL_DATA_API_URL, XAHAU_DATA_API_URL and DATA_API_KEY
# must be set. No other variable of the container reaches the Worker (CLOUDFLARE_INCLUDE_PROCESS_ENV=false in the image).
set -eu

umask 077
env_file="$(mktemp)"
"$(dirname "$0")/write-env-file.sh" "$env_file"

exec wrangler dev \
  --config build/server/wrangler.json \
  --ip 0.0.0.0 \
  --port "${PORT:-8080}" \
  --persist-to /app/state \
  --env-file "$env_file" \
  --show-interactive-dev-session=false \
  --log-level "${WRANGLER_LOG_LEVEL:-info}"
