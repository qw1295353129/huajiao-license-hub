import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomersModule } from '../customers/customers.module';
import { RedeemModule } from '../redeem/redeem.module';
import { PortalAuthController } from './portal-auth.controller';
import { PortalAuthService } from './portal-auth.service';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
  imports: [AuthModule, CustomersModule, RedeemModule],
  controllers: [PortalAuthController, PortalController],
  providers: [PortalAuthService, PortalService],
  exports: [PortalAuthService, PortalService],
})
export class PortalModule {}
