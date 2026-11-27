#!/bin/sh
set -eu

network="drive-clone-ci-$(date +%s)-$$"
database="${network}-postgres"
localstack="${network}-localstack"
worker="${network}-worker"
changed_files=$(git diff --name-only --diff-filter=ACMR HEAD; git ls-files --others --exclude-standard)
network_created=0
database_created=0
localstack_created=0
worker_created=0
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$worker_created" -eq 1 ] && ! docker rm -fv "$worker" >/dev/null; then
    echo "No se pudo eliminar el trabajador aislado: $worker" >&2
    status=1
  fi
  if [ "$localstack_created" -eq 1 ] && ! docker rm -fv "$localstack" >/dev/null; then
    echo "No se pudo eliminar LocalStack aislado: $localstack" >&2
    status=1
  fi
  if [ "$database_created" -eq 1 ] && ! docker rm -fv "$database" >/dev/null; then
    echo "No se pudo eliminar el contenedor PostgreSQL aislado: $database" >&2
    status=1
  fi
  if [ "$network_created" -eq 1 ] && ! docker network rm "$network" >/dev/null; then
    echo "No se pudo eliminar la red de pruebas aisladas: $network" >&2
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker network create "$network" >/dev/null
network_created=1
docker run -d --name "$database" --network "$network" \
  -e POSTGRES_DB=drive -e POSTGRES_USER=drive -e POSTGRES_PASSWORD=drive-ci-password \
  --tmpfs /var/lib/postgresql/data:rw,size=1g \
  postgres:17.7-bookworm >/dev/null
database_created=1

docker run -d --name "$localstack" --network "$network" --network-alias localstack \
  -e SERVICES=s3,sqs -e AWS_DEFAULT_REGION=us-east-1 \
  --tmpfs /var/lib/localstack:rw,size=1g \
  localstack/localstack:4.10.0 >/dev/null
localstack_created=1

ready=0
for attempt in $(seq 1 40); do
  if docker exec "$database" pg_isready -U drive -d drive >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "PostgreSQL aislado no alcanzó estado listo." >&2
  exit 1
fi

ready=0
for attempt in $(seq 1 60); do
  if docker exec "$localstack" curl -fsS http://localhost:4566/_localstack/health >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "LocalStack aislado no alcanzó estado listo." >&2
  exit 1
fi

docker run --rm --network "$network" -v "$PWD:/app" -v "$HOME/.npm:/root/.npm" \
  -w /app \
  -e DATABASE_URL="postgresql://drive:drive-ci-password@${database}:5432/drive" \
  -e SESSION_SECRET=drive-ci-session-secret-at-least-32-characters \
  -e CORS_ORIGIN=http://127.0.0.1:8080 \
  -e AWS_ENDPOINT=http://localstack:4566 \
  -e CHANGED_FILES="$changed_files" \
  node:24.21.0-bookworm-slim sh -c \
  'set -eu
  if [ ! -x node_modules/.bin/vitest ]; then npm ci --prefer-offline --no-audit --fund=false; fi
  for file in $CHANGED_FILES; do
    case "$file" in
      *.ts|*.tsx|*.js|*.mjs|*.cjs|*.json|*.yml|*.yaml|*.md|*.mdx|*.css)
        ./node_modules/.bin/prettier --check "$file" ;;
      *.sh) sh -n "$file" ;;
    esac
    case "$file" in
      *.ts|*.tsx|*.js|*.mjs|*.cjs|*.sh|*.yml|*.yaml|*.toml|*.json|*.css)
        [ "$file" = "package-lock.json" ] && continue
        lines=$(wc -l < "$file")
        [ "$lines" -le 150 ] || { echo "Límite excedido: $file ($lines líneas)" >&2; exit 1; } ;;
    esac
  done &&
  npm run lint && npm run typecheck && npm run contracts:check &&
  npm run migrate && npm run bootstrap -w @drive-clone/server && npm test'

docker run -d --name "$worker" --network "$network" -v "$PWD:/app" -w /app \
  -e DATABASE_URL="postgresql://drive:drive-ci-password@${database}:5432/drive" \
  -e AWS_ENDPOINT=http://localstack:4566 \
  node:24.21.0-bookworm-slim npm run worker -w @drive-clone/server >/dev/null
worker_created=1

docker run --rm --network "$network" -v "$PWD:/app" -w /app \
  -e DATABASE_URL="postgresql://drive:drive-ci-password@${database}:5432/drive" \
  -e SESSION_SECRET=drive-ci-session-secret-at-least-32-characters \
  -e CORS_ORIGIN=http://127.0.0.1:8080 -e AWS_ENDPOINT=http://localstack:4566 \
  -e RUN_UPLOAD_INTEGRATION=true -e RUN_FILES_INTEGRATION=true \
  node:24.21.0-bookworm-slim npm run test:integration

docker stop "$worker" >/dev/null
docker run --rm --network "$network" -v "$PWD:/app" -w /app \
  -e DATABASE_URL="postgresql://drive:drive-ci-password@${database}:5432/drive" \
  -e SESSION_SECRET=drive-ci-session-secret-at-least-32-characters \
  -e CORS_ORIGIN=http://127.0.0.1:8080 -e AWS_ENDPOINT=http://localstack:4566 \
  -e RUN_UPLOAD_FAILURES=true node:24.21.0-bookworm-slim sh -c \
  'npm run test:integration &&
   RUN_DELETION_INTEGRATION=true npx vitest run --config vitest.integration.config.ts --maxWorkers=1 apps/server/src/modules/deletions'
