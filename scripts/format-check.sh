#!/bin/sh
set -eu

if ! command -v git >/dev/null 2>&1; then
  echo "format:check requiere git en el contenedor Node." >&2
  exit 2
fi

base="${BASE_REF:-HEAD}"
if [ "$base" = "HEAD" ]; then
  files=$(git diff --name-only --diff-filter=ACMR HEAD; git ls-files --others --exclude-standard)
else
  files=$(git diff --name-only --diff-filter=ACMR "$base"...HEAD)
fi
printf '%s\n' "$files" |
  grep -E '\.(ts|tsx|js|mjs|cjs|json|yml|yaml)$' |
  xargs -r ./node_modules/.bin/prettier --check
