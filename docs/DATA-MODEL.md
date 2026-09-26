# 数据模型

所有表均含 `id (uuid, pk)`、`created_at`、`updated_at`（除日志类表）。命名使用 snake_case。

## 1. 账号与鉴权

### admins — 后台操作者
| 列 | 类型 | 说明 |
| --- | --- | --- |
| email | text unique | 登录名 |
| name | text | 昵称 |
| password_hash | text | scrypt(N=16384,r=8,p=1) 编码串 |
| role | enum | owner / admin / support / readonly |
| totp_secret_enc | text null | AES-256-GCM 加密的 TOTP 密钥 |
| totp_enabled | bool | 是否已启用双因素 |
| status | enum | active / disabled |
| failed_attempts / locked_until | int / timestamptz | 登录爆破防护 |
| last_login_at / last_login_ip | | |

### sessions — 统一会话表（管理员与客户共用）
`subject_type (admin|customer)`、`subject_id`、`refresh_token_hash`（只存哈希）、`user_agent`、`ip`、
`expires_at`、`revoked_at`、`rotated_from`。刷新即轮换，旧 token 立即失效。

### customers — 终端用户
`email unique`、`password_hash null`（可仅凭卡密使用）、`name`、`status (active/blocked)`、
`email_verified_at`、`notes`、`metadata jsonb`。

### auth_tokens — 一次性令牌（邮箱验证 / 找回密码）
`subject_type (admin|customer)`、`subject_id`、`purpose (verify_email|reset_password)`、
`token_hash`（只存哈希）、`expires_at`、`used_at`。用后即废，过期自动清理。

## 2. 产品与策略

### products
`slug unique`、`name`、`description`、`logo_url`、`website_url`、`status (draft/active/archived)`、`metadata jsonb`。

### product_features
`product_id`、`key`（如 `pro-mode`）、`name`、`description`；唯一索引 `(product_id, key)`。

### product_releases
`product_id`、`version`、`channel (stable/beta/alpha)`、`notes`、`download_url`、`published_at`。

### plans — 授权策略
| 列 | 说明 |
| --- | --- |
| product_id / code / name | 归属与标识 |
| license_type | trial / subscription / perpetual / duration / consumable |
| duration_days | 有效天数（perpetual 为 null） |
| max_devices | 最大设备数（0=不限） |
| offline_grace_days | 离线宽限天数 |
| heartbeat_interval_hours | 客户端心跳间隔建议值 |
| over_limit_policy | reject / kick_oldest |
| require_device_approval | 新设备是否需人工审批 |
| feature_keys | jsonb 数组，授权下发的功能点 |
| max_usages | 次数卡总次数（consumable） |
| status | active / archived |

## 3. 授权

### licenses
| 列 | 说明 |
| --- | --- |
| product_id / plan_id | 归属 |
| key_lookup | **HMAC-SHA256(密钥椒, 规范化授权码)**，唯一索引，用于查询（不可逆） |
| key_enc | **AES-256-GCM 密文**，仅在"复制授权码"接口解密返回 |
| key_masked | 展示用掩码，如 `LHAB-****-****-7K2M` |
| status | issued / active / expired / suspended / revoked / banned |
| customer_id / customer_email | 归属客户（可空） |
| max_devices / activation_count | 设备额度与已用 |
| valid_from / expires_at | expires_at 为 null 表示永久 |
| feature_keys | jsonb，可覆盖策略默认值 |
| remaining_usages | 次数卡剩余 |
| source | manual / batch / order / redeem / trial / import / api |
| notes / metadata | 运营备注 |
| last_verified_at | 最近心跳时间 |

### license_activations — 设备绑定
`license_id`、`device_id`、`status (active/deactivated/blocked)`、`activated_at`、`deactivated_at`、
`last_seen_at`、`ip`、`app_version`、`os`。部分唯一索引 `(license_id, device_id) where status='active'`。

### devices — 设备注册表
`fingerprint_hash unique`（HMAC，不存原始指纹）、`product_id`、`os`、`app_version`、
`first_seen_at`、`last_seen_at`、`blacklisted`、`blacklist_reason`、`metadata jsonb`。

### license_events — 授权生命周期事件
`license_id`、`type (created/activated/verified/deactivated/extended/suspended/revoked/expired/reissued)`、
`actor_type (admin/customer/system/api)`、`actor_id`、`payload jsonb`、`ip`。

### verification_logs — 心跳明细（保留 90 天）
`license_id`、`device_id`、`result (valid/invalid_expired/invalid_revoked/over_limit)`、`ip`、`at`。

### trials — 试用防刷台账
`fingerprint_hash`、`product_id`、`email_hash null`、`first_trial_at`、`count`；唯一索引 `(fingerprint_hash, product_id)`。

### offline_requests — 离线激活
`license_id`、`device_id`、`request_code`（唯一）、`response_code null`、`status (pending/fulfilled/expired)`、`expires_at`。

## 3.5 域名授权（独立于授权码）

### domain_licenses — 域名授权主表
`product_id / plan_id`、`customer_id / customer_email`、`status`（同 licenses 状态机）、
`max_domains`、`allow_subdomains`、`valid_from / expires_at`、`feature_keys`、`notes`。
与 `licenses` 完全独立，不占用设备额度。

### authorized_domains — 已绑定域名
`domain_license_id`、`domain`（归一化后，全局唯一索引）、`bound_at`、`bound_by`、`last_verified_at`、`status (active/released)`。

### domain_events — 域名授权事件
`domain_license_id`、`domain_id null`、`type (created/activated/verified/deactivated/extended/suspended/revoked/domain.bound/domain.unbound)`、
`actor_type`、`actor_id`、`payload jsonb`。

## 4. 商业化

### orders / order_items
orders：`order_no unique`、`customer_id`、`email`、`status (pending/paid/cancelled/refunded)`、
`currency`、`subtotal / discount / total`、`coupon_id`、`provider`、`provider_ref`、`paid_at`、`metadata jsonb`。
order_items：`order_id`、`product_id`、`plan_id`、`quantity`、`unit_price`、`license_id null`（发码后回填）。

### payment_events — 支付回调幂等表
`provider`、`event_id`、`order_id`、`payload jsonb`；唯一索引 `(provider, event_id)`。

### coupons
`code unique`、`type (percent/fixed)`、`value`、`max_uses / used_count`、`valid_from / valid_until`、
`applies_to jsonb`（产品/策略白名单）、`status`。

### redeem_batches / redeem_codes — 卡密
批量：`name`、`product_id`、`plan_id`、`quantity`、`expires_at`、`created_by`。
卡密：`code_lookup`（HMAC，唯一）、`code_enc`（AES-GCM）、`code_masked`、`batch_id`、
`status (unused/used/void)`、`used_by_customer_id`、`used_at`、`license_id null`。

## 5. 集成与运维

### api_keys — 接入方密钥
`name`、`key_lookup`（HMAC，唯一）、`key_enc`、`key_masked`、`product_id null`、
`scopes jsonb`（如 `["license:activate","license:verify"]`）、`status`、`last_used_at`、`expires_at`。

### webhook_endpoints / webhook_deliveries
端点：`url`、`secret_enc`、`events jsonb`、`status`、`description`。
投递：`endpoint_id`、`event`、`payload jsonb`、`status (pending/success/failed)`、`attempts`、
`response_code`、`response_body`、`next_retry_at`、`delivered_at`。

### audit_logs
`actor_type`、`actor_id`、`actor_email`、`action`（如 `license.revoke`）、`target_type`、`target_id`、
`ip`、`user_agent`、`diff jsonb`（before/after，密码类字段不记录）、`request_id`。

### email_logs
`to`、`template`、`subject`、`status (queued/sent/failed)`、`error`、`provider_message_id`、`related_type/id`。

### signing_keys — 授权文件签名密钥
`kid`（唯一，如 `lk-2026-01`）、`algo (ed25519)`、`public_key`（base64url）、`private_key_enc`（AES-GCM）、
`status (active/retired)`、`rotated_at`。同一时刻仅一把 active。

### settings — 键值设置
`key unique`、`value jsonb`、`updated_at`。分组：site / auth / smtp / security / licensing / webhook。

## 6. 状态机

~~~
licenses:  issued ──activate──▶ active ──到期──▶ expired
              │                   │  ▲              │
              │                   │  └──resume──────┤
              └──suspend──────────┴──▶ suspended ───┘
                          revoke ──▶ revoked（终态，可恢复为 suspended）
                          ban    ──▶ banned（终态）
orders:    pending ──paid──▶ paid ──refund──▶ refunded
              └──cancel──▶ cancelled
redeem_codes: unused ──redeem──▶ used
                 └──void──────▶ void
devices:   注册 ──▶ active ──解绑──▶ deactivated ； ──拉黑──▶ blacklisted
~~~

## 7. 索引与约束要点
- `licenses.key_lookup` 唯一 —— 授权码查重、防重复发放
- `authorized_domains.domain` 全局唯一 —— 同一域名不能被两张域名授权同时占用
- `license_activations(license_id, device_id) where status='active'` 部分唯一 —— 防并发重复绑定
- `payment_events(provider, event_id)` 唯一 —— 支付回调幂等
- `offline_requests.request_code` 唯一 —— 离线请求防伪造/防重放
- `verification_logs(license_id, at desc)` —— 心跳查询与保留策略清理
- `audit_logs(created_at desc)`、`(target_type, target_id)` —— 审计检索
- 所有外键 `on delete restrict`，避免误删产品导致授权悬空
