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

filter_legacy_files() {
  printf '%s\n' "$files" |
    while IFS= read -r file; do
      [ -n "$file" ] || continue
      case "$file" in
        apps/server/src/app.ts|apps/server/src/modules/files/*|apps/web/src/pages/*|packages/contracts/*|docs/decisiones.md)
          git cat-file -e "$base:$file" 2>/dev/null && continue
          ;;
      esac
      printf '%s\n' "$file"
    done
}

selected_files=$(filter_legacy_files)
printf '%s\n' "$selected_files" | grep -E '\.sh$' | xargs -r -n1 sh -n
printf '%s\n' "$selected_files" |
  grep -E '\.(ts|tsx|js|mjs|cjs|json|yml|yaml|md|mdx|css|html)$' |
  xargs -r ./node_modules/.bin/prettier --check
