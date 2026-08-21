FROM node:24.19.0-alpine AS base
WORKDIR /app/frontend
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS development
COPY frontend/ .
EXPOSE 5173
CMD ["pnpm", "dev"]

FROM development AS build
RUN pnpm build

FROM nginx:1.30.4-alpine AS production
COPY infra/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html
ENV BACKEND_UPSTREAM=backend:8000
EXPOSE 80
