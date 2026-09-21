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
pnpm dev                                    # 同时启动 api(3000) 与 web(5173)
~~~

默认管理员：`admin@licensehub.local` / `Admin@12345`（首次启动后请立即修改）。

- 管理后台：http://localhost:5173/admin
- 用户门户：http://localhost:5173/portal
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
✅ 76 项测试全绿（9 单元 + 67 e2e，真实 HTTP 请求 + 真实 Postgres 语义的 PGlite）
✅ API / Web / 共享包 类型检查 0 错误，生产构建通过
✅ 实测链路：上架产品 → 配策略 → 发码（单个/批量/CSV）→ 客户端激活 → 本地 Ed25519 验签 → 心跳 → 解绑 → 吊销
✅ 管理端页面：概览、产品与策略、授权管理、客户、订单、卡密（实测 0 console 错误）
✅ 用户门户：注册/登录/找回密码、我的授权与设备自助解绑、我的订单、卡密兑换、账号中心
✅ Docker Compose 与 nginx 配置就绪（本机无 Docker，未做真实镜像构建）
✅ 定时任务：过期置失效 / 到期提醒（幂等）/ Webhook 投递 / 日志清理，均可手动触发
✅ Webhook：HMAC 签名 + 退避重试 + 投递日志与重放（线上冒烟已验签通过）
🚧 待完成：团队与角色管理页面、Docker 实机构建验证（见 docs/ROADMAP.md）
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

常用命令：

~~~bash
pnpm typecheck                              # 全仓类型检查
pnpm --filter @license-hub/api test:all     # 单元 + e2e（自动建库迁移，无需外部依赖）
pnpm --filter @license-hub/web build        # 前端生产构建
~~~

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