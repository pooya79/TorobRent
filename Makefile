.PHONY: bootstrap dev prod prod-down demo demo-down demo-reset demo-clean test-demo test-milestone infra-up infra-down migrate makemigrations superuser api-schema api-client api-check test test-backend test-frontend lint format format-check typecheck build check docker-build

DEMO_COMPOSE = docker compose -p torobrent-demo --env-file .env.demo -f compose.demo.yaml

bootstrap:
	cd backend && uv sync
	cd frontend && corepack enable && pnpm install --frozen-lockfile

dev:
	docker compose up --build

prod:
	docker compose --env-file .env.production -f compose.prod.yaml up --build -d

prod-down:
	docker compose --env-file .env.production -f compose.prod.yaml down

.env.demo:
	cp .env.demo.example .env.demo

demo: .env.demo
	$(DEMO_COMPOSE) up --build --wait
	@. ./.env.demo; printf '%s\n' \
		"Application: http://localhost:$${DEMO_APP_PORT:-5173}" \
		"Admin:       http://localhost:$${DEMO_APP_PORT:-5173}/admin/" \
		"Mailpit:     http://localhost:$${DEMO_MAILPIT_PORT:-8025}" \
		"Liveness:    http://localhost:$${DEMO_APP_PORT:-5173}/api/v1/system/live/" \
		"Readiness:   http://localhost:$${DEMO_APP_PORT:-5173}/api/v1/system/ready/" \
		'Submitter:   submitter@torobrent.local / demo-submitter' \
		'Operator:    operator@torobrent.local / demo-operator'

demo-down: .env.demo
	$(DEMO_COMPOSE) down --remove-orphans

demo-reset: .env.demo
	@printf '%s\n' 'WARNING: deleting only torobrent-demo database and media volumes.'
	$(DEMO_COMPOSE) down --volumes --remove-orphans
	$(MAKE) demo

demo-clean: .env.demo
	@printf '%s\n' 'WARNING: uninstalling only torobrent-demo containers, volumes, and local images.'
	$(DEMO_COMPOSE) down --volumes --remove-orphans --rmi local

test-demo:
	./scripts/demo-smoke.sh

test-milestone: check
	cd frontend && pnpm test:e2e:milestone
	cd frontend && pnpm test:lighthouse
	$(MAKE) test-demo

infra-up:
	docker compose up -d postgres redis

infra-down:
	docker compose down

migrate:
	cd backend && uv run python manage.py migrate

makemigrations:
	cd backend && uv run python manage.py makemigrations

superuser:
	cd backend && uv run python manage.py createsuperuser

api-schema:
	cd backend && uv run python manage.py spectacular --settings=config.settings.test --file ../contracts/openapi.yaml --validate

api-client: api-schema
	cd frontend && pnpm api:generate

api-check: api-client
	cd frontend && pnpm api:lint
	git diff --exit-code -- contracts/openapi.yaml frontend/src/lib/api/schema.d.ts

test-backend:
	cd backend && uv run pytest --cov --cov-report=term-missing

test-frontend:
	cd frontend && pnpm test

test: test-backend test-frontend

lint:
	cd backend && uv run ruff check .
	cd frontend && pnpm lint

format:
	cd backend && uv run ruff format .
	cd frontend && pnpm format

format-check:
	cd backend && uv run ruff format --check .
	cd frontend && pnpm format:check

typecheck:
	cd backend && uv run mypy apps config
	cd frontend && pnpm typecheck

build:
	cd frontend && pnpm build

check: lint format-check typecheck test api-check build

docker-build:
	docker build -f backend/Dockerfile -t app-backend .
	docker run --rm --entrypoint sh \
		--mount type=volume,destination=/app/backend/media \
		--mount type=volume,destination=/var/lib/celery \
		app-backend -c 'touch media/.write-check /var/lib/celery/.write-check'
	docker build -f frontend/Dockerfile -t app-frontend .
	docker build -f infra/nginx/Dockerfile -t app-gateway .
