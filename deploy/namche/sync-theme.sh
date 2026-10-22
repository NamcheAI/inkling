#!/bin/sh
# Copies the Namche theme from @namche/design-tokens (NamcheAI/design-kit),
# where it is generated from the brand tokens, into themes/namche.json.
# Usage: deploy/namche/sync-theme.sh <design-tokens version>
set -eu
version="${1:?usage: $0 <design-tokens version>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
(cd "$work" && npm pack --silent "@namche/design-tokens@${version}" >/dev/null)
tar -xzf "$work"/namche-design-tokens-*.tgz -C "$work" package/integrations/inkling-theme.json
jq '."$schema" = "../theme.schema.json"' "$work/package/integrations/inkling-theme.json" \
  > "$root/themes/namche.json"
echo "themes/namche.json <- @namche/design-tokens@${version}"
