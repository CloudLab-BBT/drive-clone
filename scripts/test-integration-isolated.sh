#!/bin/sh
set -eu

network="drive-clone-ci-$(date +%s)-$$"
database="${network}-postgres"
cleanup() {
  docker rm -f "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" \
  -e POSTGRES_DB=drive -e POSTGRES_USER=drive -e POSTGRES_PASSWORD=drive-ci-password \
  postgres:17.7-bookworm >/dev/null

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

docker run --rm --network "$network" -v "$PWD:/app" -w /app \
  -e DATABASE_URL="postgresql://drive:drive-ci-password@${database}:5432/drive" \
  -e SESSION_SECRET=drive-ci-session-secret-at-least-32-characters \
  -e CORS_ORIGIN=http://127.0.0.1:8080 \
  node:24.21.0-bookworm-slim sh -c \
  'apt-get update -qq && apt-get install -y -qq git && git config --global --add safe.directory /app && npm ci && npm run migrate && npm run check && npm run test:integration'
