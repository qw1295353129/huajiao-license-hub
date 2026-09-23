import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './common/guards/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { ConfigModule } from './config/config.module';
import { CryptoModule } from './crypto/crypto.module';
import { DbModule } from './db/db.module';
import { ActivationModule } from './modules/activation/activation.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { CustomersModule } from './modules/customers/customers.module';
import { DomainsModule } from './modules/domains/domains.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PortalModule } from './modules/portal/portal.module';
import { RedeemModule } from './modules/redeem/redeem.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuditController } from './modules/audit/audit.controller';
import { AuthModule } from './modules/auth/auth.module';
import { LicensesModule } from './modules/licenses/licenses.module';
import { ProductsModule } from './modules/products/products.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule,
    CryptoModule,
    DbModule,
    AuditModule,
    AnalyticsModule,
    AuthModule,
    ProductsModule,
    LicensesModule,
    ApiKeysModule,
    ActivationModule,
    SettingsModule,
    NotificationsModule,
    WebhooksModule,
    TasksModule,
    CustomersModule,
    RedeemModule,
    OrdersModule,
    CouponsModule,
    DomainsModule,
    PortalModule,
    HealthModule,
    // 全局限流（N4）：默认 100 次/60s；登录等敏感路由用 @Throttle 收紧到 10 次/60s。
    // 测试环境跳过，避免 e2e 高频登录被限流。
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
  ],
  controllers: [AuditController],
  providers: [
    // 顺序即执行顺序：先认证，再鉴权，最后审计
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}