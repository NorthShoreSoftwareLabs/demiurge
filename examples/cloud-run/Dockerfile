# Builds the Demiurge Node adapter's production output for Cloud Run.
#
# Build context is the monorepo root, because this workspace package depends
# on the sibling `@demiurgejs/core` package through `workspace:*`:
#
#   docker build -f examples/cloud-run/Dockerfile -t demiurge-cloud-run .
#
# The runtime stage never keeps local state. Cloud Run can start, stop, and
# replace this container at any time, so nothing written to its filesystem
# after boot is expected to survive.

FROM node:22-alpine AS builder
WORKDIR /repo

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core packages/core
COPY examples/cloud-run examples/cloud-run

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @demiurgejs/core build
# `vite build` generates this example's typed route manifest itself
# (see the plugin's `buildStart` hook), so no separate route-generation
# step runs here.
RUN pnpm --filter @demiurge-examples/cloud-run build

# `pnpm deploy` resolves `workspace:*` into real files instead of symlinks and
# prunes devDependencies, so the runtime stage below needs nothing from the
# monorepo layout above.
RUN pnpm --filter @demiurge-examples/cloud-run deploy --prod /deploy

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /deploy/package.json ./package.json
COPY --from=builder /deploy/server.js ./server.js
COPY --from=builder /deploy/dist ./dist
COPY --from=builder /deploy/node_modules ./node_modules

# Cloud Run sets PORT and calls the container over it; nothing here hardcodes
# a port. HOST defaults to 0.0.0.0 in server.js, the address a container must
# listen on for the platform to reach it. ALLOWED_HOSTS must name the
# deployed Cloud Run hostname (see the README) once this image runs there.
EXPOSE 8080
CMD ["node", "server.js"]
