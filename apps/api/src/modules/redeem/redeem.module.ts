import { Module } from '@nestjs/common';
import { LicensesModule } from '../licenses/licenses.module';
import { ProductsModule } from '../products/products.module';
import { RedeemController } from './redeem.controller';
import { RedeemService } from './redeem.service';

@Module({
  imports: [ProductsModule, LicensesModule],
  controllers: [RedeemController],
  providers: [RedeemService],
  exports: [RedeemService],
})
export class RedeemModule {}
