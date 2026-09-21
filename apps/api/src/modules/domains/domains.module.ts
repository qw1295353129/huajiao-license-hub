import { Module } from '@nestjs/common';
import { ActivationModule } from '../activation/activation.module';
import { ProductsModule } from '../products/products.module';
import { DomainClientController } from './domain-client.controller';
import { DomainLicensesController } from './domain-licenses.controller';
import { DomainLicensesService } from './domain-licenses.service';
import { PortalDomainsController } from './portal-domains.controller';

/**
 * 域名授权模块：与「授权码」完全独立的第二条授权线。
 * 授权码管设备；域名授权管站点，客户填域名即可激活，不需要授权码。
 */
@Module({
  imports: [ProductsModule, ActivationModule],
  controllers: [DomainLicensesController, DomainClientController, PortalDomainsController],
  providers: [DomainLicensesService],
  exports: [DomainLicensesService],
})
export class DomainsModule {}
