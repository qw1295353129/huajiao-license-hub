# API 一览

统一前缀 `/api`。响应约定：

- 成功：`200/201` 直接返回数据对象或用 `{ items, total, page, pageSize }` 的分页体
- 失败：`{ code: "LICENSE_REVOKED", message: "授权已被吊销", details?: {...}, requestId: "..." }`
- 时间统一 ISO-8601 UTC 字符串；金额以 **分** 为单位的整数存储与传输

认证方式：

| 分组 | 认证 | 说明 |
| --- | --- | --- |
| `/api/admin/*` | `Authorization: Bearer <accessToken>` | 管理员 JWT，含 `role` | 
| `/api/portal/*` | `Authorization: Bearer <accessToken>` | 客户 JWT，audience=`customer` |
| `/api/v1/*` | `X-Api-Key: lh_live_xxx` | 接入应用密钥，按 scope 授权 |
| `/api/health`, `/api/metrics`, `/api/v1/public-key` | 无 | 公开 |

## 1. 管理端 `/api/admin`

### 认证
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/login` | `{email,password,totp?}`；开启 2FA 时先返回 `{ requires2fa: true }` |
| POST | `/auth/refresh` | 刷新令牌（轮换，旧 refresh 立即失效） |
| POST | `/auth/logout` | 注销当前会话 |
| GET | `/auth/me` | 当前管理员信息与权限 |
| POST | `/auth/2fa/setup` | 生成 TOTP 密钥与 otpauth URI（含二维码数据） |
| POST | `/auth/2fa/enable` | 校验一次动态码后启用 |
| POST | `/auth/2fa/disable` | 需密码 + 动态码 |
| GET | `/auth/sessions` / DELETE `/auth/sessions/:id` | 会话列表 / 踢下线 |
| POST | `/auth/password` | 修改自己的密码 |

### 产品 / 策略 / 功能点 / 版本
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/products` | 列表（含授权数统计）/ 新建 |
| GET/PATCH/DELETE | `/products/:id` | 详情 / 修改 / 归档 |
| GET/POST | `/products/:id/plans` | 策略列表 / 新建 |
| PATCH/DELETE | `/plans/:id` | 修改 / 归档策略 |
| GET/POST | `/products/:id/features` | 功能点列表 / 新建 |
| DELETE | `/features/:id` | 删除功能点 |
| GET/POST | `/products/:id/releases` | 版本发布记录 |

### 授权
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/licenses` | 筛选：`productId, planId, status, customerEmail, q, expiringInDays, page, pageSize, sort` |
| POST | `/licenses` | 单条创建（可指定自定义码或自动生成） |
| POST | `/licenses/batch` | 批量生成 `{productId, planId, count, prefix?, durationDays?, maxDevices?, note?}` |
| POST | `/licenses/import` | CSV 导入（multipart 或 JSON 数组） |
| GET | `/licenses/export` | 导出 CSV（筛选条件同列表；授权码列可选是否含明文） |
| GET | `/licenses/:id` | 详情（含设备、事件、订单关联） |
| GET | `/licenses/:id/reveal` | **解密返回授权码明文**（记审计日志，限 owner/admin） |
| PATCH | `/licenses/:id` | 修改到期时间、设备数、功能点、备注、绑定客户 |
| POST | `/licenses/:id/revoke` / `suspend` / `resume` / `ban` | 状态流转（带原因，写事件与审计） |
| POST | `/licenses/:id/extend` | `{days}` 延期 |
| POST | `/licenses/:id/reset-devices` | 清空全部设备绑定 |
| POST | `/licenses/:id/reissue` | 换发新码（旧码作废，保留历史） |
| GET | `/licenses/:id/activations` | 设备绑定列表 |
| DELETE | `/activations/:id` | 强制解绑某设备 |
| POST | `/licenses/:id/offline-response` | 用离线请求码换签发响应码 |
| GET | `/licenses/:id/events` | 生命周期事件 |

### 客户
| 方法 | 路径 |
| --- | --- |
| GET/POST | `/customers` |
| GET/PATCH | `/customers/:id` |
| POST | `/customers/:id/reset-password` |
| POST | `/customers/:id/block` / `unblock` |
| GET | `/customers/:id/licenses` |

### 订单 / 优惠券 / 卡密
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/orders` | 筛选：状态、时间、客户 |
| GET | `/orders/:id` | 详情（含明细与关联授权） |
| POST | `/orders` | 手工建单（线下收款场景） |
| POST | `/orders/:id/mark-paid` | 标记已支付并 **自动发码** |
| POST | `/orders/:id/refund` | 退款（可选同时吊销授权） |
| POST | `/orders/:id/cancel` | 取消 |
| GET/POST | `/coupons` · PATCH `/coupons/:id` | 优惠券 |
| GET/POST | `/redeem-batches` | 卡密批次（创建即生成 N 条卡密） |
| GET | `/redeem-batches/:id/codes` | 批次内卡密（掩码） |
| GET | `/redeem-batches/:id/export` | 导出卡密 CSV（含明文，记审计） |
| POST | `/redeem-codes/:id/void` | 作废单条卡密 |

### 集成与运维
| 方法 | 路径 |
| --- | --- |
| GET/POST/DELETE | `/api-keys`（创建时明文只返回一次） |
| GET/POST/PATCH/DELETE | `/webhooks` · POST `/webhooks/:id/test` · GET `/webhooks/:id/deliveries` |
| GET | `/audit-logs`（筛选：actor、action、target、时间） |
| GET | `/dashboard/summary` · `/dashboard/timeseries?days=30` · `/dashboard/breakdown` |
| GET | `/devices` · POST `/devices/:id/blacklist` · DELETE `/devices/:id/blacklist` |
| GET/PATCH | `/settings`（分组读写） |
| GET/POST | `/signing-keys` · POST `/signing-keys/:id/rotate` |
| GET/POST/PATCH | `/team`（管理员账号，仅 owner） |
| GET | `/email-logs` |

## 2. 用户门户 `/api/portal`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/register` | 注册（可在设置中关闭） |
| POST | `/auth/login` · `/auth/refresh` · `/auth/logout` | |
| POST | `/auth/forgot-password` · `/auth/reset-password` | 邮件重置 |
| GET/PATCH | `/me` | 资料 / 修改姓名与密码 |
| GET | `/licenses` | 我的授权（掩码、到期、剩余设备名额） |
| GET | `/licenses/:id` | 授权详情 + 功能点 |
| GET | `/licenses/:id/devices` | 设备列表 |
| DELETE | `/licenses/:id/devices/:activationId` | 自助解绑（每 30 天限 N 次） |
| POST | `/redeem` | `{code}` 卡密兑换 → 生成/绑定授权 |
| GET | `/orders` · `/orders/:id` | 我的订单 |
| GET | `/downloads` | 可用下载（按已购产品过滤） |

## 3. 客户端授权 API `/api/v1`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/public-key` | 当前签名公钥与 kid（客户端内置或运行时拉取） |
| POST | `/activate` | `{licenseKey, product, device:{fingerprint,name,os,appVersion}}` → `{ accessToken, licenseFile, entitlements }` |
| POST | `/verify` | `{licenseKey?|accessToken?, device:{fingerprint}}` → `{ valid, reason?, entitlements, licenseFile? }` |
| POST | `/deactivate` | `{licenseKey, device:{fingerprint}}` |
| GET | `/entitlements` | 查询权益（不消耗绑定名额） |
| POST | `/trial` | `{product, device, email?}` → 试用授权 |
| POST | `/offline/request` | `{licenseKey?, product, device}` → `{ requestCode, expiresAt }` |
| POST | `/offline/activate` | `{requestCode, responseCode}` → `{ licenseFile }` |
| GET | `/version-check` | `?product=&channel=` → 最新版本与下载地址 |

### 域名授权

Web 应用 / 插件 / SaaS 场景把授权绑定到**域名**而不是设备：

~~~bash
# 激活（域名会归一化：去协议/端口/路径、小写、去 www、IDN 转 punycode）
curl -X POST https://lic.example.com/api/v1/activate-domain \
  -H "X-Api-Key: lh_live_xxx" -H "Content-Type: application/json" \
  -d '{"licenseKey":"XXXX-XXXX-XXXX-XXXX","domain":"https://www.Shop.Example.com:8443/admin"}'
# → {"domain":"shop.example.com","entitlements":{"domainCount":1,"maxDomains":2},...}

# 心跳（服务端每次请求或每日定时调用）
curl -X POST .../api/v1/verify-domain -d '{"licenseKey":"...","domain":"shop.example.com"}'
~~~

规则：

- 域名额度由策略/授权的 §maxDomains§ 决定，**0 表示关闭域名授权**；
- §allowSubdomains=true§ 时，授权 §example.com§ 覆盖 §*.example.com§，但**不覆盖** §notexample.com§；
- 同一域名的不同写法（大小写、www、端口、路径）视为同一域名，重复激活幂等、不重复占额度；
- 域名授权与设备授权**互不占用额度**，同一张授权可同时用于桌面端与网站；
- 事件：§domain.bound§ / §domain.unbound§ 会推送到 Webhook。

### 授权文件（licenseFile）格式

~~~json
{
  "v": 1,
  "kid": "lk-2026-01",
  "licenseId": "8f1c...",
  "product": "myapp",
  "plan": "pro-yearly",
  "customer": "user@example.com",
  "issuedAt": "2026-09-21T10:00:00Z",
  "expiresAt": "2027-09-21T10:00:00Z",
  "perpetual": false,
  "features": ["pro-mode", "export-pdf"],
  "maxDevices": 3,
  "deviceFingerprint": "sha256:...",
  "offlineGraceDays": 14,
  "nonce": "9f2b...",
  "sig": "base64url(Ed25519(payload))"
}
~~~

`sig` 覆盖除自身外的全部字段的规范化 JSON（键按字典序、无空白）。客户端内置公钥即可离线验签。

### 错误码

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | 参数不合法 |
| 401 | `UNAUTHENTICATED` / `API_KEY_INVALID` | 未登录 / 密钥无效 |
| 403 | `FORBIDDEN` / `SCOPE_MISSING` / `DEVICE_BLACKLISTED` | 权限不足 / 设备被封 |
| 404 | `LICENSE_NOT_FOUND` | 授权不存在（不区分格式错误，防枚举） |
| 409 | `DEVICE_LIMIT_REACHED` / `LICENSE_ALREADY_BOUND` | 设备超限 / 已绑定其它账号 |
| 410 | `LICENSE_EXPIRED` / `LICENSE_REVOKED` / `LICENSE_SUSPENDED` | 状态失效 |
| 429 | `RATE_LIMITED` | 触发限流 |
| 5xx | `INTERNAL_ERROR` | 服务端异常（带 requestId） |