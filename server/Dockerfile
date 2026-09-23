# build stage
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

ENV PNPM_CONFIG_STORE_DIR=/pnpm/store

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# production stage
FROM node:20-alpine AS runner

RUN apk add --no-cache tini

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

ENV PNPM_CONFIG_STORE_DIR=/pnpm/store

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

COPY --from=docs --chown=node:node \
  BUSINESS_RULES.md SYSTEM_OPERATIONS_GUIDE.md TROUBLESHOOTING.md \
  ./docs/

USER node

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]