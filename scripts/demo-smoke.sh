#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DEMO_APP_PORT="${DEMO_SMOKE_APP_PORT:-55173}"
export DEMO_MAILPIT_PORT="${DEMO_SMOKE_MAILPIT_PORT:-58025}"
compose=(
  docker compose
  -p torobrent-demo-smoke
  --env-file "${repository_root}/.env.demo.example"
  -f "${repository_root}/compose.demo.yaml"
)

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${compose[@]}" up --build --wait
"${compose[@]}" exec -T backend .venv/bin/python manage.py seed_demo
"${compose[@]}" exec -T backend .venv/bin/python manage.py seed_demo
"${compose[@]}" exec -T backend .venv/bin/python manage.py shell -c \
  "from apps.accounts.models import User; from apps.catalog.models import Listing, Property; assert Property.objects.count() == 60; assert Listing.objects.count() == 80; assert User.objects.get(email='submitter@torobrent.local').check_password('demo-submitter'); assert User.objects.get(email='operator@torobrent.local').check_password('demo-operator')"
"${compose[@]}" exec -T backend .venv/bin/python scripts/demo_persona_smoke.py http://nginx

"${compose[@]}" exec -T backend .venv/bin/python manage.py shell -c \
  "from apps.accounts.models import User; from apps.catalog.models import Listing; from apps.submissions.models import Submission; User.objects.create_user('restart-marker@torobrent.local', 'restart-marker'); Submission.objects.filter(state='changes_requested').update(state='draft'); Listing.objects.filter(source_reference='DEMO-001').update(description='restart-marker')"
"${compose[@]}" exec -T backend sh -c "printf restart-marker > media/restart-marker"
"${compose[@]}" down --remove-orphans
"${compose[@]}" up --wait
"${compose[@]}" exec -T backend .venv/bin/python manage.py shell -c \
  "from apps.accounts.models import User; from apps.catalog.models import Listing; from apps.submissions.models import Submission; assert User.objects.filter(email='restart-marker@torobrent.local').exists(); assert Submission.objects.filter(state='draft').count() == 2; assert Listing.objects.get(source_reference='DEMO-001').description == 'restart-marker'"
"${compose[@]}" exec -T backend test -f media/restart-marker

"${compose[@]}" down --volumes --remove-orphans
"${compose[@]}" up --wait
"${compose[@]}" exec -T backend .venv/bin/python manage.py shell -c \
  "from apps.accounts.models import User; from apps.catalog.models import Listing, Property; from apps.submissions.models import Submission; assert not User.objects.filter(email='restart-marker@torobrent.local').exists(); assert Property.objects.count() == 60; assert Listing.objects.count() == 80; assert Submission.objects.filter(state='changes_requested').count() == 1; assert Listing.objects.get(source_reference='DEMO-001').description != 'restart-marker'"
if "${compose[@]}" exec -T backend test -e media/restart-marker; then
  echo "reset retained the media marker" >&2
  exit 1
fi

echo "Demo smoke passed: idempotent seed, persona access, persistent restart, and scoped reset."
