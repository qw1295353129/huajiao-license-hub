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
      url: env.DATABASE_URL ?? 'postgres://licensehub:licensehub@localhost:5432/licensehub',
      pgliteDir: env.PGLITE_DIR ?? './.data/pglite',
      autoMigrate: (env.AUTO_MIGRATE ?? 'true') === 'true',
    },
    redis: {
      url: env.REDIS_URL && env.REDIS_URL.trim() !== '' ? env.REDIS_URL.trim() : null,
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