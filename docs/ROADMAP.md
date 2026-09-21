# 路线图与验收标准

> 每个里程碑都必须「可运行 + 可验证」。✅ = 已实现并有测试/实测证据；🚧 = 进行中。

## M1 · 骨架与基础设施 ✅
- [x] pnpm workspace：`apps/api`、`apps/web`、`packages/shared`
- [x] NestJS 12（Fastify）启动、全局校验/异常/日志、`GET /api/health`、`/docs`（OpenAPI）
- [x] Drizzle schema（28 张表）+ 迁移；**双驱动**：生产 PostgreSQL / 本地与测试 PGlite（WASM）
- [x] 依赖注入阶段自动迁移（`AUTO_MIGRATE`），容器无需额外步骤
- [x] React 19 + Vite 8 + HeroUI v3 + Tailwind v4 外壳、路由、请求层（自动刷新令牌）
- [x] Docker：多阶段 Dockerfile（非 root + tini + healthcheck）、docker-compose（postgres/redis/migrate/api/web）、nginx 反代、备份恢复脚本
- **证据**：全仓类型检查 0 错误；前后端生产构建通过；`GET /api/health` 实测 200 且含数据库延迟；
  `test:all` 26 项测试全绿；`docker-compose.yml` 通过 YAML 解析校验（本机无 Docker，未做真实镜像构建）

## M2 · 认证与权限 ✅
- [x] 管理员登录：scrypt 口令、JWT access（15m）+ refresh（30d，轮换 + 只存哈希）
- [x] TOTP 双因素（RFC 6238，零依赖实现）：setup / enable / disable
- [x] 登录失败 5 次锁定 15 分钟；账号枚举防护（统一错误码）
- [x] 会话管理：列表 / 踢下线 / 改密后撤销全部会话
- [x] RBAC：owner / admin / support / readonly + `@Roles` 守卫（错误信息含所需角色）
- [x] 审计：`@Audit` 拦截器 + 递归脱敏 + 审计查询接口
- **证据**：auth e2e 13 项 + 单元测试 9 项全绿（含锁定、2FA、轮换重放、越权、审计）

## M3 · 授权核心 ✅
- [x] 授权码编解码规则（Crockford 风格、去易混字符、掩码、容错归一化）——前后端共用
- [x] 授权码三重存储方案（HMAC 盲索引 + AES-256-GCM 密文 + 掩码）与加密服务
- [x] 数据表与索引（唯一盲索引、部分唯一索引防重复绑定）
- [x] 产品 / 策略 / 功能点 / 版本发布 CRUD（§/api/admin/products§ 系列）
- [x] 发码：单条、批量（分块插入，最多 5000）、CSV 导入（含 dryRun 预检）、CSV 导出（掩码/明文两种）
- [x] 状态流转：吊销 / 暂停 / 恢复 / 封禁 / 延期 / 清空设备 / 换发，全部写 §license_events§ 与审计
- [x] 管理界面：产品与策略页、授权管理页（筛选、统计卡、行内操作、详情与事件流、批量结果导出）
- **证据**：licensing e2e 20 项全绿——含「批量 200 条码不重复」「列表/导出默认不含明文」「明文查看写审计」
  「关联子查询计数回归」；实测界面 0 console 错误

## M4 · 激活链路 ✅
- [x] Ed25519 签名密钥生成/加密存储/公钥分发（seed 已产出 kid=lk-2026-09）
- [x] 规范化 JSON 签名与验签（键序无关），单元测试覆盖篡改检测
- [ ] `/api/v1/activate | verify | deactivate | trial` + API Key 鉴权与限流
- [ ] 设备绑定与超限策略、设备黑名单、离线激活（request/response code）
- **验收标准**：脚本完成 激活→心跳→超限拒绝→解绑→再激活；授权文件能被独立脚本验签

## M5 · 商业化
- [ ] 客户账号与门户（注册/登录/找回密码/我的授权/设备解绑/订单/卡密兑换）
- [ ] 订单（手工确认、支付回调幂等、自动发码、退款吊销）、优惠券、卡密批次

## M6 · 运营与集成
- [x] 看板聚合接口（KPI + 30 天趋势 + 最近操作 + 即将到期）
- [ ] 邮箱通知与到期提醒定时任务（T-7/T-3/T-1）
- [ ] Webhook 签名投递 + 重试 + 投递日志
- [ ] 设置中心、签名密钥轮换、团队与角色管理界面

## M7 · 前端页面
- [x] 登录页（含双因素步骤）、控制台外壳、路由守卫、401 自动刷新
- [x] 概览页（KPI 卡片 + 趋势图 + 最近操作 + 即将到期）
- [ ] 产品/授权/客户/订单/卡密/设备/Webhook/审计/设置 页面（当前为占位页，接口就绪后接入）