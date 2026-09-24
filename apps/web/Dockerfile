# syntax=docker/dockerfile:1
# 构建上下文必须是仓库根目录：
#   docker build -f apps/web/Dockerfile -t licensehub-web .
FROM node:24-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @license-hub/shared build \
 && pnpm --filter @license-hub/web build

# 非 root 运行 nginx（suggestion）：官方 unprivileged 镜像，监听 8080
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1
