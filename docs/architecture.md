# Architecture

## System shape

This repository is a modular Django monolith with a separately built, server-rendered React
Router application. PostgreSQL is the system of record. Redis provides cache and Celery
transport. The browser and API are presented on the same origin: Nginx routes domain API paths to
Django and document requests to the React runtime.

TorobRent deliberately has no product domain. `accounts` owns the replaceable user identity
foundation, `system` owns operational probes, and `common` owns cross-cutting transport behavior.

## Backend module contract

Add each domain capability as one Django app under `backend/apps/`. A module owns its models,
migrations, admin, API serializers/views, selectors, services, and tasks.

- Views and serializers translate HTTP input/output; they do not contain workflows.
- Selectors perform reusable reads and return querysets or immutable results.
- Services own writes, authorization-sensitive workflows, and transaction boundaries.
- Tasks call services and must be idempotent. Queue dispatch happens with `transaction.on_commit`.
- Cross-module writes call the owning module's public service rather than changing its models.
- Avoid generic `utils` dumping grounds; cross-cutting primitives belong in `apps.common` only when
  at least two modules need them.

The HTTP application runs under ASGI. Use Django's async interfaces for I/O-bound request work;
keep transaction-heavy domain operations synchronous and bridge them explicitly when needed.
Introduce an outbox or independent services only when a measured requirement justifies the
operational cost.

## Frontend module contract

`src/app` owns providers and routing, `src/features` owns user-facing capabilities,
`src/components/ui` contains design primitives, and `src/lib` contains infrastructure adapters.

- All server calls pass through `src/lib/api/client.ts` and generated OpenAPI types.
- TanStack Query owns remote state. Component state remains local; do not duplicate API data in a
  global client store.
- Feature modules may import shared UI and infrastructure, but shared code must not import features.
- Zod validates browser-only data and untrusted values that are not already represented by the API
  schema.

## Deployment contract

Build backend and frontend as separate images. Run web, worker, and an explicit migration/release
job from the backend image. Do not let every web replica run migrations. Route `/api`, `/admin`, and
`/static` to Django and all other paths to the React runtime. PostgreSQL and Redis must be managed,
backed up, and monitored outside these application images.
