import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { loadConfig } from '../../src/config/configuration';

export interface TestContext {
  app: NestFastifyApplication;
  server: unknown;
}

/** 启动完整应用实例：内存 PGlite + 自动迁移 + 真实守卫/管道/过滤器。 */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ genReqId: () => randomUUID() }),
    { logger: false, rawBody: true },
  );
  await configureApp(app, loadConfig());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, server: app.getHttpServer() };
}

export async function closeTestApp(ctx: TestContext): Promise<void> {
  await ctx.app.close();
}