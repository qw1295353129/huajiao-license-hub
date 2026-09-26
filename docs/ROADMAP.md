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
  `test:all` 26 项测试全绿；真实服务器 `docker compose up -d --build` 构建并启动全栈（postgres/redis/migrate/api/web healthy，
  HTTPS 域名登录全链路通过）

## M2 · 认证与权限 ✅
- [x] **会话即时失效**：全局守卫在验签后校验会话是否被撤销/过期 —— 改密、停用、踢下线后旧 access token 立即失效
      （原先无状态 JWT 在 15 分钟有效期内仍可用，属真实安全缺口，已由 team e2e 用例锁死）
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
- [x] `/api/v1/activate | verify | deactivate | trial` + API Key 鉴权与限流
- [x] 设备绑定与超限策略、设备黑名单、离线激活（request/response code）
- **验收标准**：脚本完成 激活→心跳→超限拒绝→解绑→再激活；授权文件能被独立脚本验签

## M5 · 商业化 ✅
- [x] 客户账号：注册 / 登录 / 令牌轮换 / 找回密码（一次性令牌 + 邮件）/ 改密注销其它会话
- [x] 用户门户页面：我的授权（含设备自助解绑与配额）、我的订单、卡密兑换、账号中心
- [x] 订单：手工建单、优惠券折扣、标记支付自动发码（幂等）、退款自动吊销、缺码补发
- [x] 支付回调：HMAC-SHA256 验签 + §payment_events(provider,event_id)§ 事件去重 + 幂等发码
- [x] 卡密：批次生成（最多 5000）、掩码列表、CSV 导出（含明文，写审计）、单张/整批作废、门户兑换（条件更新抢占防并发）
- [x] 优惠券：百分比 / 固定金额、限次、限时、限策略
- [x] 客户管理：列表统计（授权数/订单数/累计消费）、详情、封禁、重置密码
- [x] 站点设置：开关自助注册、默认货币、试用天数、自助解绑次数
- **证据**：portal e2e 14 项全绿（含回调重放去重、卡密并发抢占、越权 404、令牌一次性）；
  实测真实链路：注册 → 建单支付 → 自动发码 2 条 → 门户可见 → 生成 5 张卡密；门户 4 页 + 管理端 6 页 0 console 错误

## M5.5 · 域名授权 ✅
- [x] 归一化与匹配规则（去协议/端口/路径/www、IDN→punycode、子域覆盖）——共享包 + 单测 8 项
- [x] §license_domains§ 表 + §plans/licenses.maxDomains / allowSubdomains§（迁移 0001）
- [x] 客户端 API：§activate-domain§ / §verify-domain§ / §deactivate-domain§
- [x] 额度控制、幂等重复激活、与设备授权互不占额、§domain.bound/unbound§ Webhook
- [x] 管理端：域名列表、强制解绑、清空；门户：域名可见 + 自助解绑
- [x] SDK 域名方法 + 服务端取域名工具 §currentDomainFromHeaders§
- [x] 修复：到期提醒按**站点时区**比较日期（原先用数据库会话时区，跨零点会算错一天）
- **证据**：domain e2e 12 项全绿；验收脚本含域名断言（激活/子域覆盖/未授权拒绝/额度），总 52/52

## M6 · 运营与集成 ✅
- [x] 看板聚合接口（KPI + 30 天趋势 + 最近操作 + 即将到期）
- [x] 邮件通知：模板化（欢迎/发码/订单/到期/重置/解绑/兑换）、未配置 SMTP 时只记日志
- [x] 定时任务（@nestjs/schedule）：过期置失效（每 10 分钟）、到期提醒（每天 09:00 站点时区）、
      Webhook 投递（每分钟）、日志与会话清理（每天 03:00），并提供 §POST /admin/tasks/run§ 手动触发
- [x] Webhook：端点 CRUD、事件订阅、HMAC-SHA256 签名（时间戳防重放）、退避重试、投递日志、单条/批量重放、事件入队去重
- [x] 设置页：站点设置、注册开关、试用天数、自助解绑配额、到期提醒天数、签名密钥查看/生成/轮换
- [x] 设备页：绑定记录（批准/解绑）、设备注册表（封禁/解封）
- [x] 审计页：动作/操作者/目标筛选 + 变更 diff 展开
- [x] Webhook 页：端点管理、测试投递、投递日志与重放
- [x] 团队与角色：§GET/POST/PATCH /admin/team§、重置密码、停用、防自锁（保留至少一个 owner）+ 团队页面

## M7 · 交付与验收 ✅
- [x] 端到端验收脚本 §scripts/acceptance.mjs§：全新数据库上跑通 PRD 成功标准（52 项断言）
- [x] Docker 静态一致性检查 + 镜像文件布局充分性检查（发现并修复镜像缺少 workspace node_modules 的问题）
- [x] 真实服务器 Docker Compose 构建部署验证（含宝塔反代 + HTTPS 全链路）
- [x] 客户端 SDK 与可运行演示 §sdk/§
- [x] 浏览器冒烟脚本（管理端 / 门户）
- **验收标准**：§node scripts/acceptance.mjs§ 全绿；§test:all§ 132 项全绿

## M8 · 前端页面 ✅
- [x] 登录页（含双因素步骤）、控制台外壳、路由守卫、401 自动刷新
- [x] 概览页（KPI 卡片 + 趋势图 + 最近操作 + 即将到期）
- [x] 产品/授权/客户/订单/卡密/设备/Webhook/审计/设置/团队/域名 页面（含详情抽屉与行内操作，实测 0 console 错误）
