#!/bin/sh
set -eu

# Load stack provisioning helper (defines variables and cleanup function)
. "$(dirname "$0")/e2e-stack.sh"

# Register cleanup for the created stack
trap cleanup_stack EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Create Docker network (helper already created it, but keep for idempotency)
# docker network create "$network" > /dev/null  # already done in helper

# PostgreSQL and LocalStack containers are started by the helper
# Wait for services readiness (helper already waited, but re‑check in case)
ready=0
for attempt in $(seq 1 60); do
  if docker exec "$postgres" pg_isready -U drive -d drive > /dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" -eq 1 ] || { echo "PostgreSQL isolated not ready." >&2; exit 1; }

ready=0
for attempt in $(seq 1 90); do
  if docker exec "$localstack" curl -fsS http://localhost:4566/_localstack/health > /dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" -eq 1 ] || { echo "LocalStack isolated not ready." >&2; exit 1; }

# Build monorepo
docker run --rm --network "$network" -v "$PWD:/app" -w /app node:24.21.0-bookworm-slim sh -c \
  'npm ci --prefer-offline --no-audit --fund=false && npm run build'

# Determine Playwright version and image
playwright_version=$(docker run --rm -v "$PWD:/app" -w /app node:24.21.0-bookworm-slim \
  node -p "require('./node_modules/@playwright/test/package.json').version")
playwright_image="mcr.microsoft.com/playwright:v${playwright_version}-noble"

# Run migrations and bootstrap
docker run --rm --network "$network" -v "$PWD:/app" -w /app \
  -e DATABASE_URL=postgresql://drive:e2e-password@${postgres}:5432/drive \
  -e AWS_ENDPOINT=http://localstack:4566 -e AWS_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test \
  node:24.21.0-bookworm-slim npm run migrate -w @drive-clone/server

docker run --rm --network "$network" -v "$PWD:/app" -w /app \
  -e DATABASE_URL=postgresql://drive:e2e-password@${postgres}:5432/drive \
  -e AWS_ENDPOINT=http://localstack:4566 -e AWS_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test \
  node:24.21.0-bookworm-slim npm run bootstrap -w @drive-clone/server

# Start API server
docker run -d --name "$api" --network "$network" --network-alias api \
  -v "$PWD:/app" -w /app \
  -e DATABASE_URL=postgresql://drive:e2e-password@${postgres}:5432/drive \
  -e SESSION_SECRET=drive-e2e-session-secret-at-least-32-characters \
  -e CORS_ORIGIN=http://web:8080 \
  -e AWS_ENDPOINT=http://localstack:4566 -e AWS_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test \
  -e TEMP_DIR=/tmp/drive-clone-e2e-temp \
  node:24.21.0-bookworm-slim sh -c 'mkdir -p "$TEMP_DIR" && npm run dev -w @drive-clone/server' > /dev/null

# Start worker
docker run -d --name "$worker" --network "$network" -v "$PWD:/app" -w /app \
  -e DATABASE_URL=postgresql://drive:e2e-password@${postgres}:5432/drive \
  -e AWS_ENDPOINT=http://localstack:4566 -e AWS_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test \
  -e TEMP_DIR=/tmp/drive-clone-e2e-temp \
  node:24.21.0-bookworm-slim sh -c 'mkdir -p "$TEMP_DIR" && npm run worker -w @drive-clone/server' > /dev/null

# Wait for API health
ready=0
for attempt in $(seq 1 60); do
  if docker exec "$api" node -e "fetch('http://localhost:3000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" > /dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" -eq 1 ] || { docker logs "$api"; echo "API isolated not ready." >&2; exit 1; }

# Start frontend web server
docker run -d --name "$web" --network "$network" --network-alias web \
  -p 127.0.0.1:8080:8080 \
  -v "$PWD/infra/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$PWD/apps/web/dist:/usr/share/nginx/html:ro" \
  nginx:1.29.4-alpine@sha256:4870c12cd2ca986de501a804b4f506ad3875a0b1874940ba0a2c7f763f1855b2 > /dev/null

# Prepare reports directory
mkdir -p reports/e2e
rm -rf reports/e2e

# Run Playwright tests
docker run --rm --network "$network" -v "$PWD:/app" -w /app \
  -e BASE_URL=http://web:8080 -e E2E_STATE_DIR="/tmp/${prefix}-state" \
  "$playwright_image" sh -c '
    set +e
    node node_modules/@playwright/test/cli.js test
    result=$?
    node scripts/summarize-e2e.mjs
    summary=$?
    [ "$result" -eq 0 ] || exit $result
    exit $summary
  '
