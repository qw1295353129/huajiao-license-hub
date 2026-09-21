import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { AppConfig } from './config/configuration';

/** main.ts 与 e2e 测试共用同一套应用配置，避免测试与生产行为漂移。 */
export function configureApp(app: INestApplication, config: AppConfig): void {
  app.setGlobalPrefix('api');
  app.enableCors({ origin: [config.appOrigin], credentials: true, exposedHeaders: ['X-Request-Id'] });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));
  app.useGlobalFilters(new AllExceptionsFilter());
}

export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('LicenseHub API')
    .setDescription('软件授权管理系统 · 管理端 / 用户门户 / 客户端授权接口')
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'admin')
    .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'api-key')
    .build());
  SwaggerModule.setup('docs', app, document, { swaggerOptions: { persistAuthorization: true } });
}