#!/bin/sh
set -eu

if ! command -v git >/dev/null 2>&1; then
  echo "check:file-lines requiere git en el contenedor Node." >&2
  exit 2
fi

base="${BASE_REF:-HEAD}"
if [ "$base" = "HEAD" ]; then
  files=$(git diff --name-only --diff-filter=ACMR HEAD; git ls-files --others --exclude-standard)
else
  files=$(git diff --name-only --diff-filter=ACMR "$base"...HEAD)
fi

printf '%s\n' "$files" | while IFS= read -r file; do
  case "$file" in
    *.ts|*.tsx|*.js|*.mjs|*.cjs|*.sh|*.yml|*.yaml|*.toml|*.json|Dockerfile|*.Dockerfile)
      [ "$file" = "package-lock.json" ] && continue
      [ -f "$file" ] || continue
      lines=$(wc -l < "$file")
      if [ "$lines" -gt 150 ]; then
        printf 'Límite excedido: %s (%s líneas; máximo 150)\n' "$file" "$lines" >&2
        exit 1
      fi
      ;;
  esac
done
