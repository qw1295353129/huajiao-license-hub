import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
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
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PortalModule } from './modules/portal/portal.module';
import { RedeemModule } from './modules/redeem/redeem.module';
import { SettingsModule } from './modules/settings/settings.module';
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
    CustomersModule,
    RedeemModule,
    OrdersModule,
    CouponsModule,
    PortalModule,
    HealthModule,
  ],
  controllers: [AuditController],
  providers: [
    // 顺序即执行顺序：先认证，再鉴权，最后审计
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}