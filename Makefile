.PHONY: help bootstrap dev dev-down seed-dev prod prod-down test-milestone infra-up infra-down migrate makemigrations superuser api-schema api-client api-check test test-backend test-frontend lint format format-check typecheck build check docker-build

bootstrap: ## Install backend/frontend dependencies and Playwright Chromium.
	cd backend && uv sync
	cd frontend && corepack enable && pnpm install --frozen-lockfile
	cd frontend && pnpm exec playwright install chromium

dev: ## Build and run the development stack with Docker Compose (foreground).
	docker compose up --build

dev-down: ## Stop and remove development containers and networks; keep volumes.
	docker compose down

seed-dev: ## Seed development data in the running Compose backend.
	docker compose exec -T backend uv run --no-sync python manage.py seed_dev

prod: ## Build and start the production stack using .env.production (background).
	docker compose --env-file .env.production -f compose.prod.yaml up --build -d

prod-down: ## Stop and remove production containers and networks; keep volumes.
	docker compose --env-file .env.production -f compose.prod.yaml down

test-milestone: check ## Run all checks, cross-browser Playwright tests, and Lighthouse audits.
	cd frontend && pnpm test:e2e:cross-browser
	cd frontend && pnpm test:lighthouse

infra-up: ## Start PostgreSQL and Redis in the background for host development.
	docker compose up -d postgres redis

infra-down: dev-down ## Alias for dev-down; stops the entire development stack, including PostgreSQL and Redis.

migrate: ## Apply Django database migrations from the host.
	cd backend && uv run python manage.py migrate

makemigrations: ## Generate Django migration files for model changes.
	cd backend && uv run python manage.py makemigrations

superuser: ## Interactively create a Django administrator account from the host.
	cd backend && uv run python manage.py createsuperuser

api-schema: ## Regenerate and validate contracts/openapi.yaml using test settings.
	cd backend && TEST_DATABASE_URL= uv run python manage.py spectacular --settings=config.settings.test --file ../contracts/openapi.yaml --validate

api-client: api-schema ## Regenerate the OpenAPI schema, TypeScript API types, and property taxonomy.
	cd backend && uv run python manage.py generate_property_taxonomy --output ../frontend/src/features/catalog/property-taxonomy.ts
	cd frontend && pnpm exec prettier --write src/features/catalog/property-taxonomy.ts
	cd frontend && pnpm api:generate

api-check: api-client ## Regenerate and lint API artifacts; fail if tracked generated files differ.
	cd frontend && pnpm api:lint
	git diff --exit-code -- contracts/openapi.yaml frontend/src/lib/api/schema.d.ts frontend/src/features/catalog/property-taxonomy.ts

test-backend: ## Run pytest with coverage and a missing-lines report.
	cd backend && uv run pytest --cov --cov-report=term-missing

test-frontend: ## Run frontend unit and component tests once with Vitest.
	cd frontend && pnpm test

test: test-backend test-frontend ## Run backend and frontend tests.

lint: ## Run Ruff and frontend lint, style, and asset checks.
	cd backend && uv run ruff check .
	cd frontend && pnpm lint

format: ## Rewrite backend and frontend files with Ruff and Prettier formatting.
	cd backend && uv run ruff format .
	cd frontend && pnpm format

format-check: ## Check Ruff and Prettier formatting without rewriting files.
	cd backend && uv run ruff format --check .
	cd frontend && pnpm format:check

typecheck: ## Run backend mypy and frontend TypeScript checks.
	cd backend && uv run mypy apps config
	cd frontend && pnpm typecheck

build: ## Generate frontend route types, type-check, and build for production.
	cd frontend && pnpm build

check: lint format-check typecheck test api-check build ## Run lint, formatting, types, tests, API drift checks, and frontend build.

docker-build: ## Build all three Docker images and verify backend volume write permissions.
	docker build -f backend/Dockerfile -t app-backend .
	docker run --rm --entrypoint sh \
		--mount type=volume,destination=/app/backend/media \
		--mount type=volume,destination=/var/lib/celery \
		app-backend -c 'touch media/.write-check /var/lib/celery/.write-check'
	docker build -f frontend/Dockerfile -t app-frontend .
	docker build -f infra/nginx/Dockerfile -t app-gateway .

# Add a trailing ## description to each target to include it in make help.
help: ## Show available commands and their descriptions.
	@printf 'Usage: make <target>\n\nAvailable targets:\n'
	@awk 'BEGIN { FS = ":.*## " } /^[a-zA-Z0-9_-]+:.*## / { printf "  %-18s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
