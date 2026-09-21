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

## 当前状态（M1 / M2 已完成并验证）

~~~text
✅ 29 项测试全绿（9 单元 + 20 e2e，真实 HTTP 请求 + 真实 Postgres 语义的 PGlite）
✅ API / Web / 共享包 类型检查 0 错误，生产构建通过
✅ 实测：登录 → JWT → 看板聚合 → 审计日志（真实数据链路已打通）
✅ Docker Compose 与 nginx 配置就绪（本机无 Docker，未做真实镜像构建）
🚧 授权发码、激活校验、订单卡密、业务页面：见 docs/ROADMAP.md
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