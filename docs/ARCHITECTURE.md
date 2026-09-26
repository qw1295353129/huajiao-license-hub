# 后端架构设计

## 1. 为什么是这套架构

| 需求 | 选型 | 理由 |
| --- | --- | --- |
| 一个人维护、功能齐全的后台 | **NestJS 12** | 模块/守卫/拦截器/依赖注入开箱即用，DTO 校验与 OpenAPI 一体化，长期可维护 |
| 授权接口要被客户端高频调用 | **Fastify 适配器** | 比 Express 快 2~3 倍，适合心跳类高频小请求 |
| 数据一致性（发码、退款、吊销） | **PostgreSQL 17 + 事务** | 强一致、行锁、唯一索引防重复发码 |
| 类型安全 + 可审计 SQL | **Drizzle ORM** | Schema 即 TypeScript，迁移是可读 SQL，出问题能直接改库 |
| 免安装本地开发/测试 | **PGlite（WASM Postgres）** | 同一套 schema 与迁移文件，本地零依赖跑通全链路测试 |
| 异步任务（邮件/Webhook/到期扫描） | **BullMQ + Redis** | 有重试、退避、死信；未配置 Redis 自动降级为进程内调度 |

**降级策略**：`REDIS_URL` 为空时，限流、队列、缓存自动切换到进程内实现。单机个人运营完全够用；
需要多实例时再填 `REDIS_URL` 即可，无需改代码。

## 2. 进程与模块拓扑

~~~
┌──────────────────────── apps/api (NestJS, Fastify) ────────────────────────┐
│                                                                            │
│  ┌── 接入层 ────────────────────────────────────────────────────────────┐  │
│  │ /api/admin   管理后台 API   JwtAuthGuard + RolesGuard + AuditInterceptor│
│  │ /api/portal  用户门户 API   JwtAuthGuard(audience=customer)            │  │
│  │ /api/v1      客户端授权 API ApiKeyGuard + ThrottlerGuard               │  │
│  │ /api/health  /api/metrics  /docs (OpenAPI)                            │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ┌── 领域模块 ───────────────────────────────────────────────────────────┐  │
│  │ AuthModule          管理员/客户 登录、刷新、TOTP、会话、RBAC            │  │
│  │ ProductsModule      产品、策略(plan)、功能点、版本发布                  │  │
│  │ LicensingModule     发码、状态机、批量操作、CSV 导入导出、签名           │  │
│  │ ActivationModule    激活/校验/解绑/试用/离线激活（客户端面）             │  │
│  │ DevicesModule       设备注册表、黑名单、解绑配额                        │  │
│  │ CustomersModule     客户资料、自助门户                                 │  │
│  │ OrdersModule        订单、支付提供方适配器、退款吊销                    │  │
│  │ Billing 辅助        CouponsModule、RedeemModule（卡密）                 │  │
│  │ NotifyModule        邮件模板渲染、SMTP、发送日志                        │  │
│  │ WebhooksModule      订阅、HMAC 签名投递、重试、投递日志                 │  │
│  │ ApiKeysModule       接入方密钥与作用域                                 │  │
│  │ AuditModule         审计日志查询与写入                                  │  │
│  │ AnalyticsModule     看板聚合、时间序列、异常检测                        │  │
│  │ SettingsModule      站点设置、签名密钥轮换                              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ┌── 基础设施 ───────────────────────────────────────────────────────────┐  │
│  │ DbModule      Drizzle(pg | pglite)  · 迁移执行器                        │  │
│  │ QueueModule   BullMQ | InProcess  · 定时任务(@nestjs/schedule)          │  │
│  │ CacheModule   限流存储、公钥缓存                                        │  │
│  │ CryptoModule  AES-256-GCM、HMAC 盲索引、Ed25519 签名、scrypt 口令        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
~~~

## 3. 关键流程

### 3.1 客户端激活（在线）

~~~
App ──POST /api/v1/activate {license_key, device, app_version}──▶ API
                                                   │
       ┌───────────────────────────────────────────┴────────────────────────────┐
       │ 1. ApiKeyGuard 校验 X-Api-Key（作用域含 license:activate）              │
       │ 2. 限流：按 apiKey + license 前缀 + IP 三维度                           │
       │ 3. 授权码 → HMAC 盲索引查库；未命中直接 404（不区分"格式对但不存在"）    │
       │ 4. 状态机校验：revoked/banned → 拒绝；suspended → 拒绝；expired → 拒绝   │
       │ 5. 设备黑名单校验 → 拒绝                                                │
       │ 6. 绑定设备：已绑定则更新 last_seen；未绑定则检查设备数上限              │
       │    ├─ 未超限 → 新增 activation 行                                       │
       │    └─ 超限   → 按策略：拒绝 / 踢掉最久未使用设备                        │
       │ 7. 生成 entitlements（功能点、到期时间、剩余次数、心跳间隔）             │
       │ 8. Ed25519 签名 → license_file（含 kid / issued_at / expires_at / nonce）│
       │ 9. 返回 access_token（JWT，短期）+ license_file                          │
       │ 10. 异步：写 license_events、触发 webhook license.activated             │
       └────────────────────────────────────────────────────────────────────────┘
~~~

### 3.2 心跳校验（`POST /api/v1/verify`）
- 入参可用 `access_token`（快路径，免查码）或 `license_key`（慢路径）
- 返回最新权益；若已过期/被吊销，返回 `valid=false` + 原因码，客户端据此降级为受限模式
- 触发 `verification_logs`（保留 90 天，定时清理）与 `licenses.last_verified_at` 更新

### 3.3 离线激活

~~~
离线机: 生成 request_code = base64url(payload) + HMAC 校验位
        payload = {product, device_fingerprint, license_key?, app_version, nonce, ts}
   │  （用户手动复制）
   ▼
运营者: 后台粘贴 request_code → 选择授权 → 服务端签发 response_code
        response_code = base64url(license_file) （Ed25519 签名）
   │  （用户手动复制回离线机）
   ▼
离线机: 用内置公钥验签 → 落地 license 文件，宽限期内可离线运行
~~~

### 3.4 下单到发码（幂等）

`POST /api/portal/orders` → 创建订单（pending） → 支付提供方回调/webhook
→ `payment_events` 表按 `provider + event_id` **唯一索引去重**
→ 事务内：订单置 paid、生成授权、发邮件（进入队列）、触发 `order.paid` webhook。

### 3.5 到期与提醒（定时任务）
- 每 10 分钟：把 `expires_at < now` 的授权置为 `expired`，触发 `license.expired`
- 每天 09:00（站点时区）：扫描 T-7/T-3/T-1 到期授权 → 发提醒邮件
- 每天 03:00：清理过期 verification_logs、过期会话、失败 webhook 归档

## 4. 横切关注点

| 关注点 | 实现 |
| --- | --- |
| 统一响应 | 成功直接返回数据；失败 `{ code, message, details?, requestId }` |
| 参数校验 | 全局 `ValidationPipe({whitelist, forbidNonWhitelisted, transform})` + class-validator |
| 认证 | 管理端 `Authorization: Bearer <accessToken>`；客户端 `X-Api-Key` |
| 授权 | `@Roles('owner','admin')` + RolesGuard；`@RequireScopes('license:read')` + ScopesGuard |
| 审计 | `@Audit('license.revoke')` + AuditInterceptor 记录 diff（脱敏后） |
| 限流 | 全局默认 300/min；登录 10/min；激活 30/min；校验 120/min（可配） |
| 日志 | 结构化 JSON，含 requestId、actor、耗时；敏感字段脱敏 |
| 可观测 | `/api/health`（DB/队列/邮件）、`/api/metrics`（Prometheus 文本） |
| 错误追踪 | 全局异常过滤器，5xx 记录堆栈并携带 requestId 返回 |

## 5. 部署拓扑

~~~
                ┌──────────── nginx (web 容器) ────────────┐
   浏览器 ──────▶│ 静态资源(React) + /api 反代到 api:3000   │
                └──────────────────┬───────────────────────┘
                                   │
                            ┌──────▼──────┐        ┌────────────┐
   客户端 SDK ──────────────▶│  api 容器   │───────▶│  postgres  │
                            │ (NestJS)    │        │  (volume)  │
                            └──────┬──────┘        └────────────┘
                                   │
                            ┌──────▼──────┐
                            │  redis 容器 │
                            └─────────────┘
   一次性作业：migrate 容器（`node dist/db/migrate-cli.js`）→ api 启动前完成建表
~~~

- 所有容器非 root 运行，healthcheck 就绪后再启动依赖方
- 数据卷：`pgdata`（PostgreSQL）、`redisdata`（Redis AOF）
