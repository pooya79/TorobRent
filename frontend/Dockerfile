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
ARG VITE_NESHAN_MAP_KEY=""
ARG VITE_MAP_ADAPTER="neshan"
ARG VITE_OPENSTREETMAP_TILE_URL=""
ENV VITE_NESHAN_MAP_KEY=$VITE_NESHAN_MAP_KEY
ENV VITE_MAP_ADAPTER=$VITE_MAP_ADAPTER
ENV VITE_OPENSTREETMAP_TILE_URL=$VITE_OPENSTREETMAP_TILE_URL
RUN pnpm build

FROM base AS production-dependencies
RUN pnpm install --prod --frozen-lockfile

FROM node:24.19.0-alpine AS production
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
COPY --from=production-dependencies /app/frontend/node_modules ./node_modules
COPY --from=build /app/frontend/build ./build
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000
CMD ["./node_modules/.bin/react-router-serve", "./build/server/index.js"]
