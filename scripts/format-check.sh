#!/bin/sh
set -eu

if ! command -v git >/dev/null 2>&1; then
  echo "format:check requiere git en el contenedor Node." >&2
  exit 2
fi

for script in scripts/*.sh; do
  [ -f "$script" ] && sh -n "$script"
done

base=
if git show-ref --verify --quiet refs/remotes/origin/main; then
  base=$(git merge-base HEAD origin/main) || base=HEAD
elif [ -n "${BASE_REF:-}" ] && git rev-parse --verify "${BASE_REF}^{commit}" >/dev/null 2>&1; then
  base=$(git merge-base HEAD "$BASE_REF" 2>/dev/null) || base="$BASE_REF"
fi

if [ -n "$base" ]; then
  changed_files=$(git diff --name-only --diff-filter=ACMR "$base" --; git ls-files --others --exclude-standard)
else
  changed_files=$(git diff --name-only --diff-filter=ACMR HEAD; git ls-files --others --exclude-standard)
fi

owned_files='
.github/workflows/ci.yml
.gitleaks.toml
.prettierrc.json
eslint.config.js
vitest.config.ts
vitest.integration.config.ts
apps/web/tsconfig.json
docs/controles-calidad.md
docs/decisiones.md
README.md
'
files=$(printf '%s\n%s\n' "$owned_files" "$changed_files" | sed '/^$/d' | sort -u)
prettier_files=
toml_files=
for file in $files; do
  case "$file" in
    package-lock.json|reports/*|node_modules/*|*/node_modules/*|dist/*|*/dist/*|coverage/*|*/coverage/*|apps/server/src/generated/*|packages/contracts/generated/*|*.tsbuildinfo)
      continue
      ;;
  esac
  [ -f "$file" ] || continue
  case "$file" in
    *.sh) sh -n "$file" ;;
    *.toml) toml_files="$toml_files $file" ;;
    *.ts|*.tsx|*.js|*.mjs|*.cjs|*.json|*.yml|*.yaml|*.md|*.mdx|*.css|*.html)
      prettier_files="$prettier_files $file"
      ;;
  esac
done

if [ -n "$prettier_files" ]; then
  printf '%s\n' $prettier_files | xargs -r ./node_modules/.bin/prettier --check
fi
if [ -n "$toml_files" ]; then
  printf '%s\n' $toml_files | xargs -r ./node_modules/.bin/prettier --plugin=prettier-plugin-toml --check
fi
