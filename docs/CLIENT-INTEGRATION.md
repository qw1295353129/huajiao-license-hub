# 客户端对接教程

> 面向「接入 LicenseHub 的软件作者」：从零把授权接进你的桌面软件 / 网站。
> 服务端部署见 [DEPLOYMENT.md](DEPLOYMENT.md)，接口清单见 [API.md](API.md)。

## 0. 先选一条线

LicenseHub 有**两条完全独立的授权线**，按你的软件形态选一条（也可以都接）：

| | 授权码（设备） | 域名授权（站点） |
| --- | --- | --- |
| 适合 | 桌面软件、Electron、CLI、插件（装在机器上） | 网站、SaaS、WordPress 插件（跑在域名上） |
| 凭据 | 用户输入的 16 位授权码 | **域名本身**，用户无需输入任何码 |
| 用户怎么拿到 | 你发码 / 订单自动发码 / 卡密兑换 | 你在后台给他的域名开通授权 |
| 额度 | 设备台数 | 域名个数 |
| 接口前缀 | `/api/v1/*` | `/api/v1/domain/*` |

两条线都只需要一个东西：**接口密钥（API Key）**，它标识"是哪个软件在调用"，和用户的授权码不是一回事。

---

## 1. 准备工作（5 分钟）

1. 后台 **产品与策略** → 新建产品 → 建套餐（填有效期、设备数 / 域名数、功能点）
2. 后台 **接口密钥** → 新建密钥 → 勾选作用域（最小权限）：
   - 桌面软件：`license:activate`、`license:verify`、`license:deactivate`、`license:read`
   - 网站：同上（域名接口共用这几个作用域）
   - 需要发试用再勾 `license:trial`
3. 把密钥存到服务端环境变量，例如 `LICENSEHUB_API_KEY`

> ⚠️ **密钥不要硬编码进客户端**。桌面软件可以用，但更稳妥的是让你的服务端代理激活请求；网站必须放在服务端。

---

## 2. 桌面软件接入（授权码）

### 2.1 全流程

~~~text
用户输入授权码
   ↓
POST /api/v1/activate        ← 绑定这台设备，拿到「签名授权文件 + 短期令牌」
   ↓ 本地保存 license.json（授权文件）与 token
正常使用（每个心跳周期）
   ↓
POST /api/v1/verify          ← 用 token 快路径；失效则回退授权码
   ↓ 返回 entitlements（到期时间、功能点、剩余次数）
换电脑时
   ↓
POST /api/v1/deactivate      ← 释放这台设备（或让用户在门户自助解绑）
~~~

### 2.2 用官方 SDK（推荐，零依赖，Node / Electron / Tauri）

SDK 就在仓库里：`sdk/license-client.ts`（也可直接复制进你的项目）。

~~~ts
import { LicenseClient, fingerprintFrom } from './license-client';

const client = new LicenseClient({
  baseUrl: 'https://lic.example.com',
  apiKey: process.env.LICENSEHUB_API_KEY!,   // 若走自建代理，这里填代理地址即可
  product: 'my-app',
  // 建议内置公钥：首次启动无需联网也能验签
  publicKey: 'MCowBQYDK2VwAyEA...',
});

// 1) 激活
const device = {
  fingerprint: await fingerprintFrom([await getInstallId(), os.hostname()]),
  name: os.hostname(),
  os: os.platform() + ' ' + os.release(),
  appVersion: app.getVersion(),
};
const res = await client.activate(userInputKey, device);
if (!res.ok) return showError(res.message);        // 见第 5 节错误码处理
await store.save({ licenseFile: res.licenseFile, accessToken: res.accessToken, licenseKey: userInputKey });

// 2) 启用功能点
if (res.entitlements.features?.includes('pro-mode')) enableProMode();

// 3) 定时心跳（建议每 6~24 小时 + 每次启动）
const check = await client.verify({ accessToken, licenseKey, device });
if (!check.ok || !check.valid) enterLimitedMode(check.reason);

// 4) 纯离线判断（断网也能用）
const offline = await client.checkOffline(licenseFile);
~~~

> SDK 的规范化 JSON、Ed25519 验签与服务端完全一致，`activate` 返回的授权文件它已经替你验过一次。

### 2.3 不用 SDK：裸 HTTP

~~~bash
# 激活
curl -X POST https://lic.example.com/api/v1/activate \
  -H "X-Api-Key: lh_live_xxx" -H "Content-Type: application/json" \
  -d '{"licenseKey":"XXXX-XXXX-XXXX-XXXX","product":"my-app",
       "device":{"fingerprint":"a1b2c3d4e5f6...","name":"DESKTOP-01","os":"Windows 11","appVersion":"1.2.0"}}'
~~~

响应（节选）：

~~~json
{
  "valid": true,
  "accessToken": "eyJhbGciOi...",
  "expiresIn": 259200,
  "licenseFile": {
    "v": 1, "kid": "lk-2026-09-01", "licenseId": "8f1c...",
    "product": "my-app", "plan": "pro-yearly",
    "customer": "buyer@example.com",
    "issuedAt": "2026-09-22T02:00:00.000Z",
    "validFrom": "2026-09-22T02:00:00.000Z",
    "expiresAt": "2027-09-22T02:00:00.000Z",
    "perpetual": false,
    "features": ["pro-mode", "export-pdf"],
    "maxDevices": 3, "deviceFingerprint": "a1b2c3d4e5f6...",
    "offlineGraceDays": 7, "remainingUsages": null,
    "nonce": "9f2b1c3d", "sig": "base64url..."
  },
  "entitlements": {
    "valid": true, "status": "active", "licenseType": "subscription",
    "expiresAt": "2027-09-22T02:00:00.000Z", "features": ["pro-mode", "export-pdf"],
    "maxDevices": 3, "activeDevices": 1, "heartbeatIntervalHours": 24, "offlineGraceDays": 7
  }
}
~~~

### 2.4 自己实现验签（任何语言）

签名规则只有两条，务必按它实现：

1. 把授权文件**去掉 `sig` 字段**后，按**键名字典序**序列化成**无空白**的 JSON；
2. 用 `/api/v1/public-key` 给的 Ed25519 公钥（SPKI，base64url）验证 `sig`（base64url）。

~~~js
// Node / Electron
const { createPublicKey, verify } = require('node:crypto');
const canonical = (v) => JSON.stringify(sortDeep(v));   // sortDeep: 数组保序、对象按键排序
const key = createPublicKey({ key: Buffer.from(publicKey, 'base64url'), format: 'der', type: 'spki' });
const ok = verify(null, Buffer.from(canonical(payload)), key, Buffer.from(sig, 'base64url'));
~~~

~~~python
# Python
import json, base64
from cryptography.hazmat.primitives.serialization import load_der_public_key
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

def canonical(v):
    return json.dumps(v, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

def verify(file: dict, public_key_b64url: str) -> bool:
    sig = base64.urlsafe_b64decode(file["sig"] + "==")
    payload = {k: v for k, v in file.items() if k != "sig"}
    key = load_der_public_key(base64.urlsafe_b64decode(public_key_b64url + "=="))
    try:
        key.verify(sig, canonical(payload).encode())
        return True
    except Exception:
        return False
~~~

~~~csharp
// C# / .NET
using System.Security.Cryptography;
using System.Text.Json;

static bool Verify(JsonElement file, string publicKeyB64Url)
{
    var sig = Base64UrlDecode(file.GetProperty("sig").GetString()!);
    var map = file.EnumerateObject()
        .Where(p => p.Name != "sig")
        .OrderBy(p => p.Name, StringComparer.Ordinal)
        .ToDictionary(p => p.Name, p => p.Value);
    var canonical = JsonSerializer.Serialize(map);          // 注意：不要缩进
    using var ecdsa = ECDsa.Create();
    ecdsa.ImportSubjectPublicKeyInfo(Base64UrlDecode(publicKeyB64Url), out _);
    return ecdsa.VerifyData(System.Text.Encoding.UTF8.GetBytes(canonical), sig,
        HashAlgorithmName.SHA512);                          // Ed25519：.NET 5+ 直接支持
}
~~~

~~~go
// Go
import ("crypto/ed25519"; "crypto/x509"; "encoding/base64"; "encoding/json"; "sort")

func verify(file map[string]any, pubB64 string) bool {
    sigB64 := file["sig"].(string)
    delete(file, "sig")
    canonical, _ := json.Marshal(sortedMap(file))       // 键排序后序列化
    raw, _ := base64.RawURLEncoding.DecodeString(pubB64)
    pub, err := x509.ParsePKIXPublicKey(raw)
    if err != nil { return false }
    sig, _ := base64.RawURLEncoding.DecodeString(sigB64)
    return ed25519.Verify(pub.(ed25519.PublicKey), canonical, sig)
}
~~~

**验签必须做**：不做的话，用户改一下本地 `expiresAt` 就能白嫖。

### 2.5 离线激活（无网 / 内网机器）

~~~text
① 离线机调用 POST /api/v1/offline/request  → 得到 request_code（含 HMAC 校验位）
② 用户把 request_code 发给你（邮件/微信）
③ 你在后台「授权管理 → 离线签发」粘贴 → 得到 response_code
④ 用户把 response_code 填回软件 → 软件调用 POST /api/v1/offline/activate 验签落地
~~~

request_code 7 天有效、只能用一次；授权文件里的 `offlineGraceDays` 决定离线可用时长。

---

## 3. 网站 / 插件接入（域名授权）

### 3.1 全流程

~~~text
你在后台「域名授权」→ 开通（选套餐 + 填客户邮箱 + 域名）   ①
   ↓
客户在自己网站后台「填域名 → 点激活」
   ↓
POST /api/v1/domain/activate  ← 只需域名，不需要任何授权码   ②
   ↓ 返回签名授权文件（type=domain）
POST /api/v1/domain/verify    ← 建议每次请求带缓存校验，或每日定时   ③
~~~

### 3.2 PHP（WordPress 插件场景）

~~~php
<?php
function lh_activate(string $domain): array {
    $ch = curl_init(getenv('LICENSEHUB_URL') . '/api/v1/domain/activate');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'X-Api-Key: ' . getenv('LICENSEHUB_API_KEY'),
        ],
        CURLOPT_POSTFIELDS => json_encode(['domain' => $domain, 'product' => 'my-plugin']),
        CURLOPT_TIMEOUT => 10,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = json_decode($body, true) ?: [];
    return ['ok' => $code === 201, 'data' => $data, 'status' => $code];
}

// 域名直接取当前站点（已归一化，无需自己清洗）
$host = parse_url(home_url(), PHP_URL_HOST);
$result = lh_activate($host);
if (!$result['ok']) {
    // 429 / 404 时不要立刻停用站点：给 3~7 天宽限期（见授权文件 offlineGraceDays）
    update_option('lh_last_error', $result['data']['code'] ?? 'UNKNOWN');
} else {
    update_option('lh_license_file', $result['data']['licenseFile']);
    update_option('lh_expires_at', $result['data']['entitlements']['expiresAt']);
}
~~~

### 3.3 Node / Express 中间件

~~~ts
import { LicenseClient, currentDomainFromHeaders } from './license-client';

const client = new LicenseClient({ baseUrl, apiKey, product: 'my-saas' });
const cache = new Map<string, { valid: boolean; at: number }>();

app.use(async (req, res, next) => {
  const domain = currentDomainFromHeaders(req.headers);       // 自动归一化
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < 6 * 3600_000) {            // 缓存 6 小时，别每次请求都打授权服务
    return hit.valid ? next() : res.status(403).send('域名未授权');
  }
  const check = await client.verifyDomain({ domain });
  const valid = check.ok && check.body?.valid === true;
  cache.set(domain, { valid, at: Date.now() });
  if (!valid) return res.status(403).json({ error: '域名未授权', code: check.reason });
  next();
});
~~~

### 3.4 规则速查

| 规则 | 说明 |
| --- | --- |
| 归一化 | `https://WWW.Example.com:8443/path` → `example.com`（自动做，客户端不用管） |
| 子域 | 套餐开启「允许子域名」时，授权 `example.com` 覆盖 `*.example.com`；不覆盖 `notexample.com` |
| 唯一性 | 同一域名不能被两张授权同时占用 |
| 失败降级 | 拿不到授权服务（超时/5xx）时**不要立即停用**，用本地缓存的授权文件 + 宽限期 |
| 缓存 | 域名校验建议缓存 1~24 小时，避免给自己服务器添压力 |

---

## 4. 设备指纹怎么生成

目标：**同一台机器稳定不变，不同机器不重复，且不侵犯隐私**。

✅ 推荐：安装时生成一个 UUID 持久化保存（注册表 / `~/Library/Application Support/...` / `%APPDATA%`），
再用 SHA-256 哈希（可拼上主机名、CPU 型号等次要因子）。

~~~ts
const fingerprint = await fingerprintFrom([installId, os.hostname()]);   // SDK 自带
~~~

❌ 不要用：MAC 地址（会变、可伪造、隐私敏感）、硬盘序列号（换盘即失效）、IP（会变）。
换机器/重装系统导致指纹变化时，让用户在门户自助解绑（每 30 天 3 次，可配置），或你在后台清空设备。

---

## 5. 错误码与处理建议

| HTTP | code | 客户端应该怎么做 |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | 参数写错了，看 `message`（域名格式、设备指纹太短等） |
| 401 | `API_KEY_INVALID` | **你的密钥配错了**，不是用户问题；打日志告警 |
| 401 | `UNAUTHENTICATED` | 令牌过期且授权码也没传 → 让用户重新输入授权码 |
| 403 | `SCOPE_MISSING` | 该接口没勾对应作用域；去后台给密钥补勾 |
| 403 | `DEVICE_BLACKLISTED` | 设备被封禁，提示联系客服 |
| 404 | `LICENSE_NOT_FOUND` | 授权码不存在（或域名未授权：`DOMAIN_NOT_AUTHORIZED`，提示用户去开通） |
| 409 | `DEVICE_LIMIT_REACHED` | 设备数满 → 引导用户"解绑旧设备"或到门户自助解绑 |
| 409 | `TRIAL_ALREADY_USED` | 该设备已领过试用 |
| 409 | `DOMAIN_LIMIT_REACHED` / `DOMAIN_ALREADY_AUTHORIZED` | 域名额度满 / 该域名已被别人占用 |
| 410 | `LICENSE_EXPIRED` / `LICENSE_REVOKED` / `LICENSE_SUSPENDED` | 进入**受限模式**（只读、禁止导出），保留购买引导 |
| 429 | `RATE_LIMITED` | 退避重试（指数退避），不要死循环 |

**心跳失败不要立刻锁死用户**：先看本地授权文件是否仍在 `expiresAt + offlineGraceDays` 内，在宽限期内继续放行并提示"网络异常，请检查连接"。

---

## 6. 常见问题

**Q：用户说"提示已被占用 / 设备数超限"怎么办？**
让用户在门户「我的授权 → 管理设备 → 解绑」，或你在后台该授权上「清空设备绑定」。默认每 30 天可自助解绑 3 次（系统设置里可改）。

**Q：用户换了电脑，授权码还能用吗？**
能。先解绑旧设备（或后台清空），再用同一授权码激活即可；不释放旧设备时会撞 `DEVICE_LIMIT_REACHED`。

**Q：怎么写测试用例？**
后台建一个"测试产品 + 测试套餐"，发一张授权码，用 `sdk/demo.mjs` 跑一遍：
~~~bash
node sdk/demo.mjs <API_KEY> <LICENSE_KEY> https://lic.example.com
~~~
它会依次演示 激活 → 本地验签 → 篡改拒绝 → 心跳 → 解绑 → 域名激活 → 子域覆盖 → 未授权域名拒绝。

**Q：支持浮动授权 / 并发用户数吗？**
当前是设备维度（一台设备一个名额）。并发限制可用"设备数 + 心跳"近似：把心跳间隔调到 15 分钟，超过 N 台同时心跳即视为超限。

**Q：客户端要内置公钥吗？**
建议内置（`publicKey` 选项）。这样首次启动无需联网即可验签；轮换密钥时旧公钥仍能验证历史授权文件。

**Q：能限制功能点吗？**
能。套餐里配功能点（如 `pro-mode`、`export-pdf`），激活后 `entitlements.features` 返回数组，按它开关功能。

---

## 7. 最小可用清单（照抄即可）

- [ ] 后台建好产品 / 套餐 / 接口密钥（作用域勾全）
- [ ] 客户端：输入授权码 → `activate` → 保存 `licenseFile` + `accessToken` + 授权码
- [ ] 客户端：**验签**（Ed25519，见 2.4）
- [ ] 客户端：启动时 + 每 6~24 小时 `verify` 一次；失败按第 5 节降级
- [ ] 客户端：提供「解绑本机」按钮 → `deactivate`
- [ ] 服务端：密钥放环境变量，不要进客户端仓库
- [ ] 网站：域名校验加 1~24 小时缓存 + 宽限期降级