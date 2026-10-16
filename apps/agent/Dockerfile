FROM node:22-alpine

# Build context is the output of `turbo prune @octree/agent --docker` (see scripts/deploy.sh)
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

COPY json/ .
# --prod skips the monorepo root's tooling (all devDependencies); the store lives in a cache mount, not the image
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm install --frozen-lockfile --prod --filter @octree/agent

COPY full/ .

WORKDIR /app/apps/agent

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8787/health || exit 1

CMD ["npx", "tsx", "agent-service.ts"]
