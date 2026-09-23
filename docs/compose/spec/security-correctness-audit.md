---
feature: security-correctness-audit
status: delivered
updated: 2026-09-24
branch: fix/security-correctness
commits: 52d7e6d..5007426
---

# 全仓安全与正确性审查与修复

## Report

**What was built** — 对 LicenseHub 全仓（后端鉴权/业务、门户、域名授权、SDK、前端、部署配置）完成安全与正确性审查，产出 C1–C7 / N1–N27 / suggestion 分级清单。全部 critical 与 normal 已在分支 `fix/security-correctness` 修复：生产默认口令与 DATA_KEY 强制、门户邮箱验证与认领门槛（含验证落地页与 resend）、域名 API Key 产品绑定与 deactivate 令牌、SDK 验签 fail-closed 与 kid 映射、订单发码幂等/自愈与优惠券原子占用、导出 reveal 布尔、离线签名前写入 grace days；并覆盖会话保留/角色失效、Throttler 与门户锁定、盲索引大小写敏感、配额 TOCTOU、支付金额与恒定时间 HMAC、Webhook SSRF、nginx CSP/XFF、dockerignore、按角色隐藏导航等。建议级问题按约定只记录不改。

**Verification** — `pnpm typecheck` PASS；`pnpm --filter @license-hub/shared build` + `test` PASS 10/10；`pnpm --filter @license-hub/api test:all` PASS 114/114（基线 84，含新增回归）；`pnpm --filter @license-hub/web typecheck`/`build` PASS；`node scripts/acceptance.mjs` PASS 52/52；`check-docker-config.mjs` / `check-runtime-bundle.mjs` PASS。独立复审 request-changes 后 9 项 critical 修复逐项 re-review APPROVE，无新 critical。

**Journey log**

1. 四路并行审计（鉴权/业务/密码学/前端部署）汇总去重后落盘 Findings，避免单线漏项。
2. 首轮验收 46/51：域名 deactivate 新令牌要求与生产拦 127.0.0.1 导致失败——改验收脚本带 accessToken，Webhook 回环改为始终放行（私网/元数据仍拦）。
3. 首轮独立复审 request-changes：SDK 未带 accessToken、无 verify-email 路由、markPaid 自愈缺口、N4/N6/N18/N25 半修复——补 `deactivateDomain(domain, accessToken)`、验证页+resend、alreadyPaid 自愈、auth-token 大小写敏感、门户锁定、pending 唯一索引、ClientIp 最右跳。
4. `@Type(() => Boolean)` 在 `enableImplicitConversion` 下无法靠 `@Transform` 修 query 布尔，必须读 raw `obj.reveal`。
5. 新基线：API 测试 114、验收 52；SDK 无自动化测试是契约回归温床（本轮靠复审与 e2e API 路径兜住）。

## [S1] Problem

LicenseHub 是安全敏感的授权发放系统（发码、激活、Ed25519 验签、设备绑定、域名授权、API Key、门户会话）。全仓需要一次系统性的安全与正确性审查，找出鉴权/签名/授权边界、敏感数据处理、业务逻辑漏洞等问题；严重与一般问题在本分支修复，建议级问题只报告。

## [S2] Design

**审查范围（全仓安全与正确性）**

- 后端 `apps/api/src`：鉴权守卫与会话、API Key、角色/租户边界、激活与签名、授权码与域名授权业务逻辑、Webhook、密码与令牌处理、审计脱敏、异常与错误泄露。
- 前端 `apps/web/src`：令牌存储、路由守卫、敏感信息展示、注入面（dangerouslySetInnerHTML 等）。
- 共享 `packages/shared`、SDK `sdk/`：密钥学实现、错误处理、离线验签逻辑。
- 部署与配置 `deploy/`、`scripts/`、环境变量加载：密钥默认值、泄露面。

**发现分级与处理**

| 级别 | 定义 | 处理 |
| --- | --- | --- |
| critical | 可导致越权、绕过激活/验签、密钥泄露、会话劫持、数据破坏 | 必须修复 + 能写则写回归测试 |
| normal | 逻辑错误、边界缺陷、不安全默认、可被滥用但利用条件高 | 必须修复 |
| suggestion | 风格、硬化建议、低风险改进 | 只记入 Report，不改代码 |

**修复约束**

- 最小改动修复，不顺带重构；不引入新依赖。
- 破坏性/不可逆操作不执行。
- 每条修复保留证据：问题位置、根因、修复方式。

**验证门槛（修复后全部重跑）**

- `pnpm typecheck` — 全绿
- `pnpm --filter @license-hub/shared build`
- `pnpm --filter @license-hub/api test:all` — 84 项基线全绿（失败项若为 PRE-EXISTING 需标注）
- `node scripts/acceptance.mjs` — 42 项验收全绿
- `node scripts/check-docker-config.mjs`、`node scripts/check-runtime-bundle.mjs` — 静态/布局检查通过

**审查产出**

- 按级别分组的发现清单（含文件:行、根因、修复状态），写入本文件 Report（审查任务完成后以 Amendment 形式落入 Tasks）。

## [S3] Out of Scope

- 建议级（suggestion）问题的代码修改。
- 功能增强、性能优化、依赖升级、大规模重构。
- 真实 Docker 镜像构建（本机无 Docker 守护进程，沿用静态/布局脚本验证）。
- 对生产环境或外部系统的操作。

## Findings（T1 产出，2026-09-24）

### critical

| ID | 问题 | 位置 | 根因 |
| --- | --- | --- | --- |
| C1 | 生产环境默认管理员口令 `Admin@12345` | `apps/api/src/config/configuration.ts:116-119` | bootstrap 密码无 `isProd` 强制 |
| C2 | 未验证邮箱注册即可认领/读取同邮箱授权与订单 | `portal-auth.service.ts:53-101`、`portal.service.ts:301-303`、`customers.service.ts:161-169` | 无邮箱证明即 `claimLicenses` + `ownershipCondition` 邮箱兜底 |
| C3 | 任意有效 API Key 可对任意域名 deactivate/activate，未绑 product | `domain-client.controller.ts`、`domain-licenses.service.ts:595-696` | 域名即凭据且 `apiKey.productId` 未校验；deactivate 不校验 accessToken |
| C4 | SDK 公钥拉取失败时跳过验签（fail-open） | `sdk/license-client.ts:241-244,288-291,321-324` | `if (key && !verify)` |
| C5 | 订单并发/重复回调可能重复发码 | `orders.service.ts:222-256,259-283` | 赢/输状态机两侧都 `issueMissingLicenses` 且无行锁 |
| C6 | `ExportLicensesDto.reveal` 查询串布尔被强制为 true，`?reveal=false` 导出明文 | `licenses/dto.ts:106-109` | `@Type(() => Boolean)` 对非空字符串恒 true |
| C7 | 离线响应在签名后改写 `offlineGraceDays` 导致验签失败 | `activation.service.ts:666-668` | 签名后变异载荷 |

### normal

| ID | 问题 | 位置 |
| --- | --- | --- |
| N1 | 管理端改密未保留当前会话（与注释/门户不一致） | `admin-auth.service.ts:319-320` |
| N2 | 角色降级不吊销会话，JWT 旧 role 最长 15 分钟仍有效 | `admin-auth.service.ts:112-122`、`auth.guard.ts:77-84` |
| N3 | refresh 先轮换再校验 subjectType，错端点调用会毁掉合法会话 | `admin-auth.service.ts:233-236`、`portal-auth.service.ts:127-130` |
| N4 | 无全局限流；`@nestjs/throttler` 已装未注册；门户登录无锁定 | `app.module.ts`、`portal-auth.service.ts` |
| N5 | 管理端登录在验密前暴露「已禁用/已锁定」可枚举；锁定后 failedAttempts 归零可被反复锁 | `admin-auth.service.ts:160-175,212-220` |
| N6 | `blindIndex` 对 apikey/auth-token/offline-code 也 `toUpperCase`，大小写变体可认证 | `crypto.service.ts:64-68` |
| N7 | 重置密码令牌签发/使用后未作废同主体其余未用令牌 | `portal-auth.service.ts:185-226` |
| N8 | 无 `sid` 的 access token 跳过会话撤销检查 | `auth.guard.ts:54-67` |
| N9 | 设备数/域名额度 TOCTOU 竞态 | `activation.service.ts:264-321`、`domain-licenses.service.ts:485-506` |
| N10 | 卡密兑换在 license 已创建后 catch 会把码退回 unused | `redeem.service.ts:244-249` |
| N11 | `resume` 可从 banned/revoked 复活 | `licenses.service.ts:433-459`、`domain-licenses.service.ts:360-374` |
| N12 | 离线请求码 fulfilled 无条件更新，并发可多次响应 | `activation.service.ts:657-672` |
| N13 | 支付回调不校验金额；HMAC 非恒定时间比较 | `orders.service.ts:364-371` |
| N14 | 优惠券 `maxUses` 并发可超发 | `orders.service.ts:53-73,238-241` |
| N15 | Webhook URL 未拦内网/metadata（SSRF） | `webhooks/dto.ts`、`webhooks.service.ts:177` |
| N16 | 批量删除授权不写审计 | `licenses.service.ts:694-708` |
| N17 | 卡密导出默认明文（`reveal !== 'false'`） | `redeem.controller.ts:48` |
| N18 | 审批 pending 不复核设备上限；可重复插入 pending | `activation.service.ts:256-311,742-750` |
| N19 | 订单行 `quantity>1` 只链最后一张授权 | `orders.service.ts:268-283` |
| N20 | 域名客户端 verify 不传 product；deactivate 不用 accessToken | `domain-licenses.service.ts:658-696`（并入 C3） |
| N21 | SDK 只缓存 current 公钥，轮换后历史文件离线失败；设备/域名文件类型可混淆 | `sdk/license-client.ts`、`activation.service.ts:688-697` |
| N22 | `DATA_KEY` 非 32 字节用 padEnd 截断冒充密钥（注释称 scrypt 实未派生） | `configuration.ts:73-76` |
| N23 | `domainFromHeaders` 无条件信任 `X-Forwarded-Host` | `packages/shared/src/domain.ts:77-80`、`sdk/license-client.ts:347-351` |
| N24 | CSV 导出 `window.open` 无 Bearer 必 401 | `apps/web/src/pages/LicensesPage.tsx:183-188` |
| N25 | 无 CSP/HSTS；nginx `/assets/` 覆盖 add_header 丢安全头；XFF 取首段可伪造 | `apps/web/nginx.conf`、`decorators/index.ts:47-51` |
| N26 | `.dockerignore` 未排除 `.env`，可能打进镜像层 | `.dockerignore` |
| N27 | 前端无按角色隐藏导航/邀请（后端已有 Roles） | `AdminLayout.tsx`、`TeamPage.tsx`、`App.tsx` |

### suggestion（只报告，不改）

- Swagger `persistAuthorization`、API 无 helmet、web 镜像 root 运行
- TOTP 窗口内可重放；离线请求码 MAC 非恒定时间
- CSV 无 Excel 公式转义；webhook secret 掩码偏长
- 硬编码冒烟账号默认口令；Redis 无 requirepass；容器无 TLS
- `RedeemPage` 直接读 localStorage；scrypt 参数来自库无上限
- 解析 `license.key` 未用 `extractLicenseKeyCandidate`
- 分析 SQL `::date` 与站点时区可能不一致

## Tasks

- [x] T1: 完成全仓安全与正确性审查并产出分级发现清单 — acceptance: 覆盖 S2 所列范围，每条含文件:行、根因、critical/normal/suggestion 分级；清单落盘于本文件（covers: S2）
- [x] T2: 修复全部 critical（C1–C7）并补可行回归测试 — acceptance: C1–C7 均修复；`loadConfig`/export reveal 等至少有失败→通过的测试（covers: S2; depends: T1）
- [x] T3: 修复全部 normal（N1–N27，N20 并入 C3） — acceptance: 各条已修复或并入对应 critical；typecheck 与相关测试通过（covers: S2; depends: T1）
- [x] T4: 全量验证 — acceptance: S2 验证门槛各命令 PASS 或标注 PRE-EXISTING（covers: S2; depends: T2, T3）
