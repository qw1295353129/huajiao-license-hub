import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { AppConfig } from './config/configuration';

/** main.ts 与 e2e 测试共用同一套应用配置，避免测试与生产行为漂移。 */
export async function configureApp(app: INestApplication, config: AppConfig): Promise<void> {
  app.setGlobalPrefix('api');
  app.enableCors({ origin: [config.appOrigin], credentials: true, exposedHeaders: ['X-Request-Id'] });
  // API 自身安全头；CSP 由前端 nginx 承担（避免与 Swagger UI / 本地联调冲突过严）
  const fastifyApp = app as unknown as NestFastifyApplication;
  await fastifyApp.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));
  app.useGlobalFilters(new AllExceptionsFilter());
}

export function setupSwagger(app: INestApplication, options: { persistAuthorization?: boolean } = {}): void {
  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('LicenseHub API')
    .setDescription('软件授权管理系统 · 管理端 / 用户门户 / 客户端授权接口')
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'admin')
    .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'api-key')
    .build());
  // 生产默认不把 Bearer 写入浏览器 localStorage（suggestion：persistAuthorization）
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: options.persistAuthorization ?? false },
  });
}