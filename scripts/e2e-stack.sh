#!/bin/sh
set -eu

# Helper script to provision the isolated Docker stack for E2E tests.
# Returns exported variables: prefix, network, postgres, localstack, api, worker, web

prefix="drive-clone-e2e-$(date +%s)-$$"
network="${prefix}-network"
postgres="${prefix}-postgres"
localstack="${prefix}-localstack"
api="${prefix}-api"
worker="${prefix}-worker"
web="${prefix}-web"

export prefix network postgres localstack api worker web

# Create network
docker network create "$network" > /dev/null

# Start PostgreSQL (tmpfs for fast I/O)
docker run -d --name "$postgres" --network "$network" \
  -e POSTGRES_DB=drive -e POSTGRES_USER=drive -e POSTGRES_PASSWORD=e2e-password \
  --tmpfs /var/lib/postgresql/data:rw,size=1g postgres:17.7-bookworm > /dev/null

# Start LocalStack (S3 + SQS)
docker run -d --name "$localstack" --network "$network" --network-alias localstack \
  -e SERVICES=s3,sqs -e AWS_DEFAULT_REGION=us-east-1 \
  --tmpfs /var/lib/localstack:rw,size=1g localstack/localstack:4.10.0 > /dev/null

# Wait for PostgreSQL ready
ready=0
for attempt in $(seq 1 60); do
  if docker exec "$postgres" pg_isready -U drive -d drive > /dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" -eq 1 ] || { echo "PostgreSQL isolated not ready." >&2; exit 1; }

# Wait for LocalStack health
ready=0
for attempt in $(seq 1 90); do
  if docker exec "$localstack" curl -fsS http://localhost:4566/_localstack/health > /dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" -eq 1 ] || { echo "LocalStack isolated not ready." >&2; exit 1; }

# Helper cleanup (to be called by the caller script)
cleanup_stack() {
  status=$?
  trap - EXIT INT TERM
  for c in "$web" "$worker" "$api" "$localstack" "$postgres"; do
    docker rm -f "$c" > /dev/null 2>&1 || status=1
  done
  docker network rm "$network" > /dev/null 2>&1 || status=1
  exit "$status"
}

# Export cleanup function name so caller can trap it
export -f cleanup_stack
