import { randomBytes } from 'node:crypto';

/** 解析 `15m` / `30d` / `12h` / `45s` 这类时长。 */
export function parseDuration(input: string | undefined, fallbackMs: number): number {
  if (!input) return fallbackMs;
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(input.trim());
  if (!m) return fallbackMs;
  const value = Number(m[1]);
  const unit = (m[2] ?? 'ms').toLowerCase();
  const table: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (table[unit] ?? 1);
}

export type DatabaseDriver = 'postgres' | 'pglite';

export interface AppConfig {
  env: string;
  isProd: boolean;
  port: number;
  appOrigin: string;
  timezone: string;
  swaggerEnabled: boolean;
  logLevel: string;

  database: {
    driver: DatabaseDriver;
    url: string;
    pgliteDir: string;
    autoMigrate: boolean;
  };
  redis: { url: string | null; queueEnabled: boolean };

  security: {
    jwtSecret: string;
    licensePepper: string;
    dataKey: Buffer;
    accessTokenTtlMs: number;
    refreshTokenTtlMs: number;
    trialDefaultDays: number;
    selfUnbindPer30d: number;
  };

  bootstrap: { email: string; password: string };

  smtp: {
    host: string | null;
    port: number;
    secure: boolean;
    user: string | null;
    password: string | null;
    from: string;
  };
}

function required(name: string, value: string | undefined, isProd: boolean, devFallback?: string): string {
  if (value && value.trim().length > 0) return value.trim();
  if (isProd) throw new Error('缺少必需的环境变量：' + name);
  if (devFallback !== undefined) return devFallback;
  throw new Error('缺少环境变量：' + name);
}

/**
 * 校验并「自愈」连接串类环境变量。
 *
 * 实战事故：`openssl rand -base64 24` 生成的密码含 `/`（或 @ : ? #），直接拼进
 * `postgres://user:口令@host:5432/db` 后 URL 解析失败，容器启动即崩，日志里只有一句
 * `TypeError: Invalid URL (ERR_INVALID_URL)` —— 排查成本极高。
 *
 * 策略：先按原样解析；失败时尝试只对「口令部分」做百分号编码（语义等价，PostgreSQL 收
 * 到的还是原口令）；仍失败才抛错，并给出可执行的修法。自愈时打印警告，提示换成 URL 安全口令。
 */
function resolveParsableUrl(name: string, url: string): string {
  const ok = (candidate: string): boolean => {
    try {
      return Boolean(new URL(candidate).hostname);
    } catch {
      return false;
    }
  };

  if (ok(url)) return url;

  const repaired = encodeUserInfoPassword(url);
  if (repaired && ok(repaired)) {
    console.warn(
      '[config] ' + name + ' 里的口令含未编码的特殊字符（常见于 openssl rand -base64 的输出），' +
      '已按百分号编码后继续使用。建议改用 URL 安全口令：openssl rand -hex 24，' +
      '并在数据库里同步修改该账号口令。',
    );
    return repaired;
  }

  throw new Error(
    name + ' 无法解析为 URL。请检查连接串格式，以及口令里是否含 / @ : ? # 等需要百分号编码的字符' +
    '（/ → %2F、+ → %2B、= → %3D、@ → %40）。也可用 openssl rand -hex 24 生成 URL 安全口令。',
  );
}

/** 仅重写 `scheme://user:password@host` 中的 password 段，其余原样保留。 */
function encodeUserInfoPassword(url: string): string | null {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url);
  if (!scheme) return null;
  const rest = url.slice(scheme[0].length);
  const at = rest.lastIndexOf('@');
  if (at <= 0) return null;
  const userinfo = rest.slice(0, at);
  const tail = rest.slice(at + 1);
  const colon = userinfo.indexOf(':');
  if (colon === -1) return null;
  const user = userinfo.slice(0, colon);
  const password = userinfo.slice(colon + 1);
  if (!password) return null;
  // RFC 3986 userinfo 允许 unreserved + sub-delims；'@' 与 '/' 必须编码
  const encoded = password.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=]/g, (char) =>
    '%' + char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  return scheme[0] + user + ':' + encoded + '@' + tail;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';

  const rawDataKey = required('DATA_KEY', env.DATA_KEY, isProd, Buffer.alloc(32, 7).toString('base64'));
  let dataKey: Buffer;
  try {
    dataKey = Buffer.from(rawDataKey, 'base64');
  } catch {
    throw new Error('DATA_KEY 必须是 base64 字符串');
  }
  if (dataKey.length !== 32) {
    // 生产环境必须是严格 32 字节密钥，禁止静默补齐/截断（N22）
    if (isProd) throw new Error('DATA_KEY 解码后必须是 32 字节（base64 编码 44 字符）');
    // 仅开发环境：允许非 base64 的 32 字符口令，补齐/截断到 32 字节
    dataKey = Buffer.from(rawDataKey.padEnd(32, '0').slice(0, 32), 'utf8');
  }

  const driver = (env.DATABASE_DRIVER ?? (isProd ? 'postgres' : 'pglite')) as DatabaseDriver;
  if (driver !== 'postgres' && driver !== 'pglite') {
    throw new Error('DATABASE_DRIVER 只能是 postgres 或 pglite');
  }

  const jwtSecret = required('JWT_SECRET', env.JWT_SECRET, isProd, 'dev-only-jwt-secret-' + randomBytes(8).toString('hex'));
  if (isProd && jwtSecret.length < 32) throw new Error('JWT_SECRET 至少需要 32 个字符');

  // 连接串必须在启动时就能解析：否则容器会以 ERR_INVALID_URL 崩溃重启，日志难懂
  const rawDatabaseUrl = env.DATABASE_URL ?? 'postgres://licensehub:licensehub@localhost:5432/licensehub';
  const databaseUrl = driver === 'postgres' ? resolveParsableUrl('DATABASE_URL', rawDatabaseUrl) : rawDatabaseUrl;
  const rawRedisUrl = env.REDIS_URL && env.REDIS_URL.trim() !== '' ? env.REDIS_URL.trim() : null;
  const redisUrl = rawRedisUrl ? resolveParsableUrl('REDIS_URL', rawRedisUrl) : null;

  return {
    env: nodeEnv,
    isProd,
    port: Number(env.APP_PORT ?? 3000),
    appOrigin: env.APP_ORIGIN ?? 'http://localhost:5273',
    timezone: env.TIMEZONE ?? 'Asia/Shanghai',
    swaggerEnabled: (env.SWAGGER_ENABLED ?? (isProd ? 'false' : 'true')) === 'true',
    logLevel: env.LOG_LEVEL ?? 'info',

    database: {
      driver,
      url: databaseUrl,
      pgliteDir: env.PGLITE_DIR ?? './.data/pglite',
      autoMigrate: (env.AUTO_MIGRATE ?? 'true') === 'true',
    },
    redis: {
      url: redisUrl,
      queueEnabled: (env.QUEUE_ENABLED ?? 'false') === 'true',
    },

    security: {
      jwtSecret,
      licensePepper: required('LICENSE_PEPPER', env.LICENSE_PEPPER, isProd, 'dev-only-license-pepper'),
      dataKey,
      accessTokenTtlMs: parseDuration(env.ACCESS_TOKEN_TTL, 15 * 60_000),
      refreshTokenTtlMs: parseDuration(env.REFRESH_TOKEN_TTL, 30 * 86_400_000),
      trialDefaultDays: Number(env.TRIAL_DEFAULT_DAYS ?? 14),
      selfUnbindPer30d: Number(env.SELF_UNBIND_PER_30D ?? 3),
    },

    bootstrap: {
      email: env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@licensehub.local',
      // 生产必须显式设置初始管理员密码，且禁止沿用公开示例口令（C1）
      password: (() => {
        const password = required('BOOTSTRAP_ADMIN_PASSWORD', env.BOOTSTRAP_ADMIN_PASSWORD, isProd, 'Admin@12345');
        if (isProd && password === 'Admin@12345') {
          throw new Error('BOOTSTRAP_ADMIN_PASSWORD 不能使用默认示例口令 Admin@12345');
        }
        return password;
      })(),
    },

    smtp: {
      host: env.SMTP_HOST && env.SMTP_HOST.trim() !== '' ? env.SMTP_HOST.trim() : null,
      port: Number(env.SMTP_PORT ?? 465),
      secure: (env.SMTP_SECURE ?? 'true') === 'true',
      user: env.SMTP_USER?.trim() || null,
      password: env.SMTP_PASSWORD?.trim() || null,
      from: env.SMTP_FROM ?? 'LicenseHub <no-reply@example.com>',
    },
  };
}

export const CONFIG_TOKEN = 'APP_CONFIG';