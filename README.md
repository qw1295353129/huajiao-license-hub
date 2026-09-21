# LicenseHub · 软件授权管理系统

> 面向 **个人开发者 / 独立软件作者** 的授权（License）发放与运营平台：发码、激活、设备绑定、续期、防盗版、看数据。
> 单机 Docker 一键部署，数据完全自持。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 19 + TypeScript + Vite 8 + React Router 7 + TanStack Query |
| UI | HeroUI v3 + Tailwind CSS v4 + Recharts + lucide-react |
| 后端 | NestJS 12（Fastify 适配器）+ Drizzle ORM |
| 数据库 | PostgreSQL 17（本地开发/测试可用内置 PGlite，免安装） |
| 队列/缓存 | Redis 7 + BullMQ（未配置 Redis 时自动降级为进程内实现） |
| 部署 | Docker Compose（postgres + redis + api + web/nginx + 迁移作业） |

## 快速开始（无需 Docker / 无需安装 PostgreSQL）

~~~bash
pnpm install
pnpm --filter @license-hub/api db:migrate   # 建表（默认使用内置 PGlite，数据落在 apps/api/.data/）
pnpm --filter @license-hub/api db:seed      # 写入演示数据 + 默认管理员
pnpm dev                                    # 同时启动 api(3000) 与 web(5273)
~~~

默认管理员：`admin@licensehub.local` / `Admin@12345`（首次启动后请立即修改）。

> **端口说明**：前端固定用 **5273**，不是 Vite 默认的 5173 —— 5173 经常被其它本地项目占用
> （本机上是另一个授权系统），端口不一致会导致打开错误的站点、误以为"登录不了"。
> 需要换端口：前端设 `VITE_DEV_PORT`，后端同步改 `APP_ORIGIN`。

- 管理后台：http://localhost:5273/admin
- 用户门户：http://localhost:5273/portal
- 接口文档：http://localhost:3000/docs
- 健康检查：http://localhost:3000/api/health

## 生产部署

~~~bash
cd deploy
cp .env.example .env      # 修改所有 CHANGE_ME 项
docker compose up -d --build
~~~

详见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 目录结构

~~~
license-hub/
├── apps/api          NestJS 后端（管理端 API + 用户门户 API + 客户端授权 API）
├── apps/web          React 管理后台 + 用户门户
├── packages/shared   前后端共享类型、枚举、常量
├── deploy/           Dockerfile / docker-compose / nginx / 环境变量样例
└── docs/             PRD、架构、数据模型、API、安全、部署、路线图
~~~

## 当前状态（M1–M6 已完成并验证）

~~~text
✅ 84 项测试全绿（9 单元 + 75 e2e，真实 HTTP 请求 + 真实 Postgres 语义的 PGlite）
✅ API / Web / 共享包 类型检查 0 错误，生产构建通过
✅ 实测链路：上架产品 → 配策略 → 发码（单个/批量/CSV）→ 客户端激活 → 本地 Ed25519 验签 → 心跳 → 解绑 → 吊销
✅ 管理端页面：概览、产品与策略、授权管理、客户、订单、卡密（实测 0 console 错误）
✅ 用户门户：注册/登录/找回密码、我的授权与设备自助解绑、我的订单、卡密兑换、账号中心
✅ Docker Compose 与 nginx 配置就绪（本机无 Docker，未做真实镜像构建）
✅ 定时任务：过期置失效 / 到期提醒（幂等）/ Webhook 投递 / 日志清理，均可手动触发
✅ Webhook：HMAC 签名 + 退避重试 + 投递日志与重放（线上冒烟已验签通过）
✅ 团队与角色：按最小权限分配、会话即时失效、保留至少一个 owner
🚧 待完成：Docker 实机构建验证（本机无 Docker 守护进程，见 docs/ROADMAP.md）
~~~

## 客户端接入（三步）

~~~bash
# 1) 后台创建 API Key（只显示一次明文），2) 后台创建一条授权，3) 跑演示
node sdk/demo.mjs <API_KEY> <LICENSE_KEY> http://localhost:3000
~~~

业务代码里只需引入 §sdk/license-client.ts§（零依赖，浏览器 / Node / Electron / Tauri 通用）：

~~~ts
const client = new LicenseClient({ baseUrl, apiKey, product: 'my-app', publicKey });
const res = await client.activate(licenseKey, { fingerprint, os, appVersion });
if (res.ok) {
  const offline = await client.checkOffline(res.licenseFile); // 不联网也能判定
  if (!offline.valid) enterLimitedMode(offline.reason);
}
~~~

## 验证（全部可在无 Docker、无 PostgreSQL 的机器上跑）

~~~bash
pnpm typecheck                                   # 全仓类型检查
pnpm --filter @license-hub/api test:all          # 单元 + e2e：84 项
node scripts/acceptance.mjs                      # 端到端验收：全新数据库跑通全部业务流程（42 项）
node scripts/check-docker-config.mjs             # Dockerfile / compose 静态一致性
node scripts/check-runtime-bundle.mjs            # 复现镜像文件布局，验证迁移与启动可用
node scripts/ui-smoke.cjs                        # 浏览器冒烟（管理端 10 页）
node scripts/portal-smoke.cjs                    # 浏览器冒烟（用户门户）
node sdk/demo.mjs <API_KEY> <LICENSE_KEY>        # 客户端接入演示
~~~

### 验收覆盖（scripts/acceptance.mjs，42 项）

首次启动自动建表 + 引导管理员 → 上架产品/策略 → 生成卡密并导出 CSV → 客户注册兑换 →
客户端激活（Ed25519 验签 + 篡改拒绝）→ 心跳续期 → 设备超限拒绝 → 门户自助解绑换机 →
到期提醒（幂等）→ 续费延期 → 订单支付自动发码 → 退款吊销 → Webhook 投递与消费方验签 →
到期自动失效 → 看板/审计/待办 → 安全边界（未登录/错 Key/受众隔离/越权 404）。

### Docker 部署验证说明

本机没有 Docker 守护进程，因此**未执行真实 image build**。已用两种方式逼近验证：

1. §check-docker-config.mjs§：Dockerfile 中每个 COPY 源路径真实存在，compose 的服务依赖、卷、
   迁移作业命令与 Dockerfile 一致；
2. §check-runtime-bundle.mjs§：按 Dockerfile 运行阶段的 COPY 清单复制出同样的文件布局，
   在其中执行迁移作业并启动 API、登录、建产品 —— 这一步真实发现了「镜像缺少
   §apps/api/node_modules§ 导致容器启动即崩」的问题（pnpm 符号链接布局所致），已修复。

在有 Docker 的机器上，请执行：

~~~bash
cd deploy && cp .env.example .env   # 替换全部 CHANGE_ME
docker compose up -d --build
docker compose logs -f api          # 看到 "LicenseHub API 已启动" 即成功
~~~

常用命令：

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/PRD.md](docs/PRD.md) | 产品定位、角色、功能清单、补充建议、非目标 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 后端架构、模块划分、关键流程、部署拓扑 |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | 数据库表结构与状态机 |
| [docs/API.md](docs/API.md) | 三类 API 全量端点 |
| [docs/SECURITY.md](docs/SECURITY.md) | 威胁模型、密钥管理、授权码存储与签名 |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Docker 部署、备份、升级 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 里程碑与验收标准 |