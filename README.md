# TorobRent

TorobRent is a smart rental search platform that aggregates, normalizes, and ranks property
listings from multiple sources.

## Quick start

Requirements: Docker with Compose. Run:

```bash
cp .env.example .env
make dev
```

Open the React application at <http://localhost:5173>, Django admin at
<http://localhost:8000/admin/>, and API documentation at <http://localhost:8000/api/docs/>.

For host-based development, install Python 3.14, Node 24, `uv`, and Corepack, then run
`make bootstrap`, `make infra-up`, `make migrate`, and start the backend/frontend processes.

Useful commands are documented in [docs/development.md](docs/development.md). Architectural and
transport decisions are in [docs/architecture.md](docs/architecture.md) and
[docs/api-contract.md](docs/api-contract.md).

## Production containers

Copy `.env.production.example` to a secure, untracked environment file, replace every placeholder,
and run:

```bash
docker compose --env-file .env.production -f compose.prod.yaml up --build -d
```

The production stack runs PostgreSQL and Redis without publishing their ports, applies migrations,
serves Django's ASGI application with Uvicorn, runs a Celery worker, and exposes the nginx-hosted frontend on
`APP_PORT` (port 80 by default). Terminate TLS at a reverse proxy or load balancer in front of it.
