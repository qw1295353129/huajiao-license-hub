# syntax=docker/dockerfile:1
# 构建上下文必须是仓库根目录（需要 pnpm workspace 与 lockfile）：
#   docker build -f apps/api/Dockerfile -t licensehub-api .
# ---------------------------------------------------------------- 构建阶段
FROM node:24-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate

WORKDIR /app
# 先只拷贝依赖清单，最大化利用构建缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts=false

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @license-hub/shared build \
 && pnpm --filter @license-hub/api exec nest build

# ---------------------------------------------------------------- 运行阶段
FROM node:24-alpine AS runner

RUN apk add --no-cache tini curl \
 && addgroup -S -g 1001 licensehub \
 && adduser -S -u 1001 -G licensehub licensehub

ENV NODE_ENV=production \
    APP_PORT=3000 \
    DATABASE_DRIVER=postgres \
    AUTO_MIGRATE=true

WORKDIR /app
# 运行期需要：编译产物、迁移 SQL、生产依赖。
# ⚠️ 必须连同各 workspace 包的 node_modules 一起拷贝：
# pnpm 使用符号链接布局，apps/api/node_modules/* 指向 ../../../node_modules/.pnpm/*，
# 只拷根 node_modules 会让 require('dotenv') 之类的解析在容器里直接失败（曾由 scripts/check-runtime-bundle.mjs 发现）。
COPY --from=builder --chown=licensehub:licensehub /app/node_modules ./node_modules
COPY --from=builder --chown=licensehub:licensehub /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=licensehub:licensehub /app/package.json ./package.json
COPY --from=builder --chown=licensehub:licensehub /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder --chown=licensehub:licensehub /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=licensehub:licensehub /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=licensehub:licensehub /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=licensehub:licensehub /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=licensehub:licensehub /app/apps/api/drizzle ./apps/api/drizzle

USER licensehub
WORKDIR /app/apps/api

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]