.PHONY: bootstrap dev seed-dev prod prod-down test-milestone infra-up infra-down migrate makemigrations superuser api-schema api-client api-check test test-backend test-frontend lint format format-check typecheck build check docker-build

bootstrap:
	cd backend && uv sync
	cd frontend && corepack enable && pnpm install --frozen-lockfile
	cd frontend && pnpm exec playwright install chromium

dev:
	docker compose up --build

seed-dev:
	docker compose exec -T backend uv run --no-sync python manage.py seed_dev

prod:
	docker compose --env-file .env.production -f compose.prod.yaml up --build -d

prod-down:
	docker compose --env-file .env.production -f compose.prod.yaml down

test-milestone: check
	cd frontend && pnpm test:e2e:cross-browser
	cd frontend && pnpm test:lighthouse

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
	cd backend && TEST_DATABASE_URL= uv run python manage.py spectacular --settings=config.settings.test --file ../contracts/openapi.yaml --validate

api-client: api-schema
	cd backend && uv run python manage.py generate_property_taxonomy --output ../frontend/src/features/catalog/property-taxonomy.ts
	cd frontend && pnpm exec prettier --write src/features/catalog/property-taxonomy.ts
	cd frontend && pnpm api:generate

api-check: api-client
	cd frontend && pnpm api:lint
	git diff --exit-code -- contracts/openapi.yaml frontend/src/lib/api/schema.d.ts frontend/src/features/catalog/property-taxonomy.ts

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
