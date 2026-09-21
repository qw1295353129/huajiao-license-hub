import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { Public } from '../../common/decorators';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';

interface HealthPayload {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  driver: string;
  database: { ok: boolean; latencyMs: number; error?: string };
  redis: { configured: boolean; queueEnabled: boolean };
  smtp: { configured: boolean };
  time: string;
}

const startedAt = Date.now();

@ApiTags('system')
@Public() // 健康检查必须免认证：容器 healthcheck、探针、反代都要能直接访问
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  @Get()
  @ApiOperation({ summary: '健康检查（含数据库连通性）' })
  async health(): Promise<HealthPayload> {
    const begin = Date.now();
    let ok = true;
    let error: string | undefined;
    try {
      await this.handle.db.execute(sql`select 1`);
    } catch (err) {
      ok = false;
      error = err instanceof Error ? err.message : String(err);
    }
    const latencyMs = Date.now() - begin;
    return {
      status: ok ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      driver: this.handle.driver,
      database: { ok, latencyMs, ...(error ? { error } : {}) },
      redis: { configured: this.config.redis.url !== null, queueEnabled: this.config.redis.queueEnabled },
      smtp: { configured: this.config.smtp.host !== null },
      time: new Date().toISOString(),
    };
  }
}