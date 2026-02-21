FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json agent-service.ts ./
COPY lib/ lib/

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- --post-data='{}' --header='Content-Type: application/json' http://localhost:8787/agent || exit 1

CMD ["npx", "tsx", "agent-service.ts"]
