#!/bin/sh
# Writes the Worker's variables and secrets from this process's environment to the env file $1, for `wrangler dev --env-file`
# (docker/entrypoint.sh). Each value must reach the Worker as it is, so the file is written the way scripts/e2e-env.ts formatEnvFile
# writes the end-to-end suite's. Wrangler reads it with dotenv, then dotenv-expand, which rewrites `$NAME` and `${NAME}`. Each value is
# quoted with the first of ", ' and ` that it does not contain, because dotenv unescapes no quote inside quotes, and every `$` is written
# `\$`, which dotenv-expand reads back as `$`. A value that holds a line break or a backslash (dotenv turns `\n` into a line break), or all
# three quotes, cannot be carried over: it is refused by name and nothing is written. Only the names below are written, none of them
# empty. test/unit/docker-env-file.test.ts reads the file back with wrangler's own loader.
set -eu

NAMES="XRPL_DATA_API_URL XAHAU_DATA_API_URL XRPL_NODE_URL XAHAU_NODE_URL DATA_API_KEY SENTRY_DSN
VALIDATORS AMM_DATA MARKETS ACCOUNT_ANALYTICS AMM_PAGES"

nl='
'
cr="$(printf '\r')"

contains() {
  case "$1" in
    *"$2"*) return 0 ;;
    *) return 1 ;;
  esac
}

refuse() {
  echo "write-env-file: $1 $2, which an env file cannot carry" >&2
  exit 1
}

lines=""
for name in $NAMES; do
  # A command substitution drops every trailing line break, so the value is read with a sentinel after it; then the sentinel and
  # printenv's own line break are taken off, and a line break the value ends with is still there to be refused.
  value="$(printenv "$name" && printf x)" || continue
  value="${value%x}"
  value="${value%"$nl"}"
  [ -n "$value" ] || continue
  if contains "$value" "$nl" || contains "$value" "$cr" || contains "$value" "\\"; then
    refuse "$name" "holds a line break or a backslash"
  fi
  if ! contains "$value" '"'; then
    quote='"'
  elif ! contains "$value" "'"; then
    quote="'"
  elif ! contains "$value" '`'; then
    quote='`'
  else
    refuse "$name" "holds every kind of quote"
  fi
  escaped="$(printf '%s' "$value" | sed 's/\$/\\$/g')"
  lines="$lines$name=$quote$escaped$quote$nl"
done

printf '%s' "$lines" > "$1"
