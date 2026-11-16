# Build context is the repo root (see infra/compose.yaml).
FROM node:22-alpine AS web
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/web apps/web
COPY apps/api/package.json apps/api/package.json
RUN npm ci
RUN npm -w apps/web run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci --omit=dev -w apps/api
COPY apps/api/src apps/api/src
COPY --from=web /repo/apps/web/dist /app/web
# Node strips the TypeScript types itself (22.18+), so there is no API build step.
CMD ["node", "apps/api/src/server.ts"]
