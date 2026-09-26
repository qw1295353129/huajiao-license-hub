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
# ⚠️ 数据库/Redis 口令必须用 -hex：它们会被拼进 postgres:// / redis:// 连接串，
#    base64 输出里的 “/” 会让连接串解析失败，api 容器直接起不来（ERR_INVALID_URL）
openssl rand -hex 24      # POSTGRES_PASSWORD
openssl rand -hex 24      # REDIS_PASSWORD

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

## 9. 故障排查：部署完登录不进去

先分清页面上的报错文案，再对症处理：

| 页面提示 | 含义 | 处理 |
| --- | --- | --- |
| 网络异常，请检查后端服务是否已启动 | 前端 nginx 起来了，但 `/api` 请求到不了 api 容器（多为 api 崩了/没起来） | 看第 2 步日志 |
| 邮箱或密码不正确 | 账号存在，密码不匹配（改过 `.env` 里的密码也不会自动更新库里已有账号） | 用 `admin-cli reset` 重置 |
| 账号已锁定，请 X 分钟后再试 | 连续 5 次密码错误，锁 15 分钟（按账号，不是按 IP） | 等 15 分钟，或 `admin-cli unlock` |
| 操作过于频繁，请稍后再试 | 登录接口限流：10 次 / 分钟 / IP | 等 1 分钟再试 |

### 1) 看容器与账号状态

~~~bash
docker compose ps
docker compose logs --tail=100 api | grep -E "已启动|初始化管理员|失败|Error"
# 库里到底有没有管理员、有没有被锁
docker compose exec -T postgres psql -U licensehub -d licensehub \
  -c "select email, role, status, failed_attempts, locked_until, totp_enabled from admins;"
# 容器里实际生效的初始账号（能看清有没有多余空格/被 Compose 插值吃掉的 $）
docker compose exec -T api printenv BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
# 绕开浏览器直接打一次登录，拿到真实状态码与报错
curl -i -X POST http://127.0.0.1:8080/api/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<你的邮箱>","password":"<你的密码>"}'
~~~

### 2) 运维 CLI（进不去后台时的唯一出路）

`BOOTSTRAP_ADMIN_*` **只在 `admins` 表为空时**创建初始账号：改 `.env` 重新部署不会改已有账号的密码。
需要重置/解锁时用内置 CLI（重新 build 过 api 镜像后可用）：

~~~bash
docker compose exec api node dist/db/admin-cli.js list
docker compose exec api node dist/db/admin-cli.js unlock --email admin@example.com
docker compose exec api node dist/db/admin-cli.js reset  --email admin@example.com                 # 随机新密码，打印一次
docker compose exec api node dist/db/admin-cli.js reset  --email admin@example.com --password '新密码'
docker compose exec api node dist/db/admin-cli.js disable-2fa --email admin@example.com             # 认证器丢了时
~~~

`reset` 会同时吊销该账号的全部会话（旧令牌立即失效）。

### 3) 启动就失败的常见原因（api 容器反复重启）

- **`.env` 里的 POSTGRES_PASSWORD 与数据卷里已初始化的口令不一致**（实测最常见，表现为前端能打开但登录 502）：
  - 典型触发：`init-env.sh` / `install.sh --force` 重新生成了口令，但 `pgdata` 卷还在；
    或多次 `up` 之间改过 `.env` 口令。
  - 症状：`migrate` 与 `api` 日志均出现 `password authentication failed for user "licensehub"`（FATAL 28P01），
    api 反复重启，nginx 报 `502` / `connect() failed`。
  - **全新部署、数据可丢**（最快）：
    ~~~bash
    cd deploy && docker compose down -v   # ⚠️ 删数据卷
    bash init-env.sh                      # 重新生成 .env（口令与新卷一致）
    docker compose up -d --build
    ~~~
  - **数据要留**：用当前 `.env` 里的新口令去改数据库里的口令（见第 4 节 ALTER USER），
    或把 `.env` 的 `POSTGRES_PASSWORD` 改回数据卷当初初始化时用的旧口令。
- **`.env` 里的 POSTGRES_PASSWORD / REDIS_PASSWORD 含 `/`（`openssl rand -base64` 的典型输出）**：
  它们被拼进 `postgres://user:口令@postgres:5432/db` 后 URL 解析失败，api 容器报
  `TypeError: Invalid URL (ERR_INVALID_URL)` 后退出 → 前端能打开但登录 502。
  修法：`openssl rand -hex 24` 生成新口令 + `ALTER USER licensehub WITH PASSWORD '新口令';`（见下）；
- `BOOTSTRAP_ADMIN_PASSWORD` 仍为示例口令 `Admin@12345` → 生产直接拒绝启动；
- `JWT_SECRET` 少于 32 字符；`DATA_KEY` 不是 base64 的 32 字节；
- `.env` 里的口令含未转义的 `$`（Compose 会当变量插值，实际值与你写的不同）→ 用 `printenv` 核对；
- `migrate` 作业失败（`docker compose logs migrate`）→ api 永远等不到启动条件；
- 数据卷残留了上一次部署的库：账号还是旧密码，见第 2 节 `admin-cli reset`。

### 4) 把数据库口令换成 URL 安全的（数据不丢）

~~~bash
NEW_PW=$(openssl rand -hex 24); echo "新口令（记下来，等会填进 .env）：$NEW_PW"
# 容器内本地连接默认 trust，直接改即可；若提示要密码，见下面「走 TCP」的写法
docker compose exec -T postgres psql -U licensehub -d licensehub \
  -c "ALTER USER licensehub WITH PASSWORD '$NEW_PW';"

# 走 TCP（本地 trust 不可用时）：用当前 .env 里的旧口令认证
docker compose exec -T -e PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)" postgres \
  psql -h 127.0.0.1 -U licensehub -d licensehub -c "ALTER USER licensehub WITH PASSWORD '$NEW_PW';"
~~~

把 `POSTGRES_PASSWORD=` / `REDIS_PASSWORD=` 改成新口令，再 `docker compose up -d`（改了 env 只重建容器，不会删数据卷）。

## 10. 反向代理实测备忘（宝塔 / 已有 nginx）

服务器上 80/443 已被宝塔等面板占用时，**不要**再让 compose 把 web 映射到 80/443，
保持默认 `WEB_PORT=8080`，由面板站点反代到 `http://127.0.0.1:8080` 即可。实测可用的关键头：

~~~nginx
location ^~ / {
  proxy_pass http://127.0.0.1:8080;
  proxy_set_header Host $http_host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-Host $host;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
}
~~~

注意：
- `APP_ORIGIN` 必须写成最终对外地址（如 `https://lic.example.com`），否则 CORS 与邮件链接会错；
- 面板层已做 HTTP→HTTPS 跳转时，容器内 nginx 的 HSTS 可保留（仅 HTTPS 响应生效）；
- 若面板「禁止访问敏感文件」规则拦掉了 `/.env*` 等，正好是期望行为，无需改。


