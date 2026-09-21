# 安全设计

授权系统本身就是"印钞机的钥匙"，安全等级要高于普通业务后台。

## 1. 威胁模型

| 威胁 | 场景 | 对策 |
| --- | --- | --- |
| 拖库 | 数据库被导出 | 授权码仅存 AES-256-GCM 密文 + HMAC 盲索引，无明文；口令用 scrypt |
| 授权码枚举 | 攻击者暴力猜码 | 码空间 ≥ 2^60（16 位 Crockford Base32）、接口限流、失败计数与告警 |
| 一码多机 | 用户共享授权 | 设备指纹绑定 + 设备数上限 + 异常检测（同码多 IP） |
| 中间人改包 | 篡改激活响应 | 授权文件 Ed25519 签名，客户端离线验签，不信任传输层 |
| 后台被盗 | 管理员口令泄漏 | TOTP 双因素 + 登录锁定 + 会话可踢 + 全量审计 |
| 私钥泄漏 | 签名私钥外泄 | 签名密钥轮换（kid），旧公钥保留供历史授权验签 |
| 重放支付回调 | 伪造支付成功 | `payment_events(provider,event_id)` 唯一索引幂等 + 提供方签名校验 |
| Webhook 伪造 | 伪造事件推送 | HMAC-SHA256 签名 + 时间戳（5 分钟窗口）+ 事件 ID 去重 |
| 内部误操作 | 误删产品/授权 | 外键 restrict、软删除（归档）、审计日志可回溯、导出备份 |

## 2. 口令与密钥

### 口令哈希
- 算法：**scrypt**（Node 内置 `crypto.scrypt`），参数 `N=16384, r=8, p=1, keylen=64`，16 字节随机盐
- 存储格式：`scrypt$N$r$p$salt_b64$hash_b64`，便于未来参数升级与逐条重哈希
- 校验使用 `timingSafeEqual`，防时序侧信道
- 登录失败 5 次锁定 15 分钟（可配），失败与锁定写审计

### 授权码存储（三重表示）
| 列 | 用途 | 是否可逆 |
| --- | --- | --- |
| `key_lookup` = HMAC-SHA256(`LICENSE_PEPPER`, 规范化码) | 唯一索引、激活时查询 | 否（单向） |
| `key_enc` = AES-256-GCM(`DATA_KEY`, 码) | 后台"显示授权码"、"导出 CSV" | 是（需服务端密钥） |
| `key_masked` | 列表展示 `LHAB-****-****-7K2M` | 部分可见 |

- `LICENSE_PEPPER`、`DATA_KEY` 来自环境变量，**不入库、不进镜像**
- 规范化：去连字符、大写、去除易混字符（I/L/O/U → 不生成），保证同一码只有一种哈希
- 「显示明文」与「导出明文 CSV」接口：仅 owner/admin、写审计日志（含 IP 与 UA）

### 授权文件签名
- **Ed25519**（Node 内置 `crypto.generateKeyPairSync('ed25519')`），私钥以 AES-GCM 加密后入库
- `kid` 标识密钥版本；`GET /api/v1/public-key` 公开当前与历史公钥
- 轮换：新建密钥置为 active，旧密钥置为 retired（仍可验签，不能新签）

### 令牌
- Access token：JWT HS256，15 分钟，含 `sub/aud/role/jti/iat/exp`
- Refresh token：32 字节随机串，**只存 SHA-256 哈希**，30 天，刷新即轮换并记录链
- 会话表支持"查看登录设备 / 踢下线 / 注销全部"

## 3. 传输与运行时

- 生产必须 HTTPS（nginx 终结 TLS，开启 HSTS）
- 安全响应头：`X-Content-Type-Options`、`X-Frame-Options: DENY`、`Referrer-Policy`、CSP
- CORS：默认仅允许 `APP_ORIGIN` 白名单
- 请求体大小限制 1MB（CSV 导入 8MB），超时 15s
- 全局 `ValidationPipe`：`whitelist + forbidNonWhitelisted + transform`，杜绝脏字段入库
- ORM 参数化查询（Drizzle），无字符串拼接 SQL
- 日志脱敏：`password`、`token`、`licenseKey`、`apiKey`、`secret` 一律 `***`
- 容器非 root 运行，只读根文件系统（除 `/tmp` 与数据卷）

## 4. 限流与防滥用

| 维度 | 默认值 | 说明 |
| --- | --- | --- |
| 全局 | 300 次/分钟/IP | 兜底 |
| 登录 | 10 次/分钟/IP + 5 次失败锁定 | 防爆破 |
| 客户注册 | 5 次/小时/IP | 防刷号 |
| `/api/v1/activate` | 30 次/分钟/API Key | 正常客户端远低于此 |
| `/api/v1/verify` | 120 次/分钟/API Key | 心跳 |
| 卡密兑换 | 10 次/小时/账号 | 防猜卡密 |
| 公开字典接口 | 60 次/分钟/IP | `public-key`、`version-check` |

失败计数（授权码不存在/已吊销）在 `verification_logs` 中按 IP 聚合，超过阈值在看板"异常面板"高亮。

## 5. 审计

记录范围：所有管理端写操作 + 登录/登出/改密/2FA 变更 + 授权码明文查看 + 导出。

字段：`actor_type, actor_id, actor_email, action, target_type, target_id, ip, user_agent, request_id, diff`。

`diff` 存储 `{ before: {...}, after: {...} }`，自动剔除敏感字段。审计日志**只读**，不提供删除接口。

## 6. 数据保护与备份

- 备份：`pg_dump` 每日 + `deploy/scripts/backup.sh`（保留 14 天，可推送到异地）
- 环境变量与数据卷分开存放；`.env` 不入库不入镜像
- 建议开启 Postgres 每日快照与 `deploy/scripts/restore.sh` 演练

## 7. 安全清单（上线前自查）

- [ ] 所有 `CHANGE_ME` 已替换（`JWT_SECRET`、`LICENSE_PEPPER`、`DATA_KEY`、`POSTGRES_PASSWORD`）
- [ ] 默认管理员口令已修改，并已启用 TOTP
- [ ] 站点 HTTPS 生效，`APP_ORIGIN` 与 `CORS_ORIGINS` 已收紧
- [ ] `NODE_ENV=production`、`SWAGGER_ENABLED=false`（或加访问控制）
- [ ] 备份任务已配置并验证可恢复
- [ ] 邮件发信已配置 SPF/DKIM（降低进垃圾箱概率）
