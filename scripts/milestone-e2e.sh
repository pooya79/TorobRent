#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mailpit_container="torobrent-milestone-mailpit-$$"
mailpit_smtp_port="${MILESTONE_MAILPIT_SMTP_PORT:-51025}"
mailpit_api_port="${MILESTONE_MAILPIT_API_PORT:-58025}"

cleanup() {
  docker rm --force "${mailpit_container}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [[ "${1:-}" == "--" ]]; then
  shift
fi

docker run --rm --detach \
  --name "${mailpit_container}" \
  --publish "127.0.0.1:${mailpit_smtp_port}:1025" \
  --publish "127.0.0.1:${mailpit_api_port}:8025" \
  axllent/mailpit:v1.30.7 >/dev/null

for _ in $(seq 1 60); do
  if curl --fail --silent "http://127.0.0.1:${mailpit_api_port}/api/v1/info" >/dev/null; then
    break
  fi
  sleep 0.25
done
curl --fail --silent "http://127.0.0.1:${mailpit_api_port}/api/v1/info" >/dev/null

cd "${repository_root}/frontend"
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend \
EMAIL_HOST=127.0.0.1 \
EMAIL_PORT="${mailpit_smtp_port}" \
EMAIL_USE_TLS=false \
E2E_MAILPIT_URL="http://127.0.0.1:${mailpit_api_port}" \
E2E_REQUIRE_MAILPIT=1 \
FRONTEND_ORIGIN=http://127.0.0.1:5173 \
CSRF_TRUSTED_ORIGINS=http://127.0.0.1:5173 \
pnpm exec playwright test --grep @milestone "$@"
E2E_SEED_DEMO=1 pnpm exec playwright test \
  tests/e2e/property-discovery.spec.ts --project=chromium "$@"
