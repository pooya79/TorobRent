FROM ghcr.io/astral-sh/uv:0.12.5 AS uv

FROM python:3.14.7-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_LINK_MODE=copy
WORKDIR /app/backend
COPY --from=uv /uv /uvx /bin/
COPY backend/pyproject.toml backend/uv.lock ./

FROM base AS development
RUN uv sync --locked
COPY backend/ .
EXPOSE 8000

FROM base AS production
RUN uv sync --locked --no-dev --no-editable
COPY backend/ .
RUN uv run --no-sync python manage.py collectstatic --noinput --settings=config.settings.base
RUN install -d -o 65534 -g 65534 /app/backend/media /var/lib/celery
USER 65534:65534
EXPOSE 8000
CMD ["uv", "run", "--no-sync", "uvicorn", "config.asgi:application", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
