import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './app.setup';
import { loadEnvFiles } from './config/load-env';
import { loadConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  loadEnvFiles();
  const config = loadConfig();
  const logger = new Logger('Bootstrap');

  const adapter = new FastifyAdapter({
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024,
    genReqId: () => randomUUID(),
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: config.isProd ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug'],
    // 保留原始请求体：支付回调的 HMAC 验签必须基于「收到的字节」而不是重新序列化的 JSON
    rawBody: true,
  });

  configureApp(app, config);
  app.enableShutdownHooks();

  if (config.swaggerEnabled) {
    setupSwagger(app, { persistAuthorization: !config.isProd });
    logger.log('接口文档：http://localhost:' + config.port + '/docs');
  }

  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.log('LicenseHub API 已启动：http://localhost:' + config.port + '/api/health  （' + config.env + '）');
}

void bootstrap();