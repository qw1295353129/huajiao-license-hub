# 部署指南（Docker）

## 1. 组成

| 容器 | 镜像 | 作用 | 端口 |
| --- | --- | --- | --- |
| `postgres` | postgres:17-alpine | 数据库，数据卷 `pgdata` | 内网 5432 |
| `redis` | redis:7-alpine | 队列 / 限流 / 缓存 | 内网 6379 |
| `migrate` | api 镜像 | 一次性执行迁移后退出 | - |
| `api` | 本地构建 | NestJS 服务 | 内网 3000 |
| `web` | 本地构建 | nginx 托管前端 + 反代 `/api` | **宿主 8080** |

## 2. 首次部署

~~~bash
git clone <你的仓库> license-hub && cd license-hub/deploy
cp .env.example .env

# 生成强随机密钥（把输出填进 .env）
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 48   # LICENSE_PEPPER
openssl rand -base64 32   # DATA_KEY（base64，32 字节）
openssl rand -base64 24   # POSTGRES_PASSWORD

docker compose up -d --build
docker compose logs -f api     # 看到 "LicenseHub API 已启动" 即成功
~~~

访问 `http://<服务器IP>:8080`，用 `.env` 中的 `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` 登录，
**登录后第一件事：改密码 + 开启 TOTP**。

## 3. 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | 是 | production |
| `APP_PORT` | 否 | 默认 3000 |
| `APP_ORIGIN` | 是 | 前端访问地址（CORS 与邮件链接用），如 `https://lic.example.com` |
| `DATABASE_URL` | 是 | `postgres://user:pass@postgres:5432/licensehub` |
| `DATABASE_DRIVER` | 否 | `postgres`（默认）或 `pglite`（无 PG 的单机模式） |
| `REDIS_URL` | 否 | 留空则使用进程内队列/限流（单实例可用） |
| `JWT_SECRET` | 是 | 至少 32 字符 |
| `LICENSE_PEPPER` | 是 | 授权码盲索引密钥，**变更后旧码将无法查询** |
| `DATA_KEY` | 是 | base64 的 32 字节 AES-256-GCM 主密钥 |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | 否 | 默认 `15m` / `30d` |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | 首次 | 首次启动自动创建 owner |
| `SMTP_*` | 否 | 未配置则邮件只写日志 |
| `SWAGGER_ENABLED` | 否 | 默认 `true`，生产建议 `false` |
| `TIMEZONE` | 否 | 默认 `Asia/Shanghai`（到期提醒按此计算） |
| `WEB_PORT` | 否 | 宿主端口，默认 8080 |

## 4. 常用运维命令

~~~bash
docker compose ps
docker compose logs -f api
docker compose exec api node -e "console.log(process.version)"
docker compose run --rm migrate          # 手动跑迁移
docker compose exec postgres pg_dump -U licensehub licensehub > backup.sql
docker compose up -d --build api web     # 只更新应用
docker compose down                      # 停止（保留数据卷）
docker compose down -v                   # ⚠️ 连数据一起删
~~~

备份与恢复脚本见 `deploy/scripts/backup.sh`、`deploy/scripts/restore.sh`。

## 5. 反向代理与 HTTPS

内置 nginx 已处理静态资源与 `/api` 反代。若前面还有一层（宝塔/Caddy/Cloudflare）：

- 转发到宿主 `8080`，保留 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto`
- 客户端授权接口 `/api/v1/*` 建议**不要**开启人机校验或缓存
- 开启 gzip/br，静态资源长缓存（文件名带 hash）

## 6. 单机免 Docker 安装（可选）

适合没有 Docker 的小主机：

~~~bash
pnpm install && pnpm build
export DATABASE_DRIVER=pglite PGLITE_DIR=/var/lib/licensehub/pg
node apps/api/dist/main.js        # 数据库即本地目录，无需安装 PostgreSQL
~~~

该模式下 `REDIS_URL` 可留空，队列降级为进程内实现（单实例）。

## 7. 升级

1. `docker compose run --rm migrate`（迁移向后兼容，先迁移再换应用）
2. `docker compose up -d --build api web`
3. 回滚：`git checkout <旧版本>` 后重新 build；数据库回滚用备份恢复

## 8. 资源与容量

| 规模 | 配置 | 说明 |
| --- | --- | --- |
| 个人（< 5k 授权，< 50 心跳/秒） | 2C4G | 单机 compose 足够 |
| 中小（< 5万授权） | 4C8G + 独立 PG | 建议开启 Redis、把 PG 拆出去 |
| 更大 | 多 api 实例 + 外部 PG/Redis | 应用无状态，直接水平扩容 |
