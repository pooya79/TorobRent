.PHONY: bootstrap dev prod prod-down infra-up infra-down migrate makemigrations superuser api-schema api-client api-check test test-backend test-frontend lint format format-check typecheck build check docker-build

bootstrap:
	cd backend && uv sync
	cd frontend && corepack enable && pnpm install --frozen-lockfile

dev:
	docker compose up --build

prod:
	docker compose --env-file .env.production -f compose.prod.yaml up --build -d

prod-down:
	docker compose --env-file .env.production -f compose.prod.yaml down

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
	docker build -f frontend/Dockerfile -t app-frontend .
	docker build -f infra/nginx/Dockerfile -t app-gateway .
