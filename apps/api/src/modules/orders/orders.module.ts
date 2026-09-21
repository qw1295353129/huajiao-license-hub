import { Module } from '@nestjs/common';
import { LicensesModule } from '../licenses/licenses.module';
import { ProductsModule } from '../products/products.module';
import { OrdersController } from './orders.controller';
import { PaymentController } from './payment.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [ProductsModule, LicensesModule],
  controllers: [OrdersController, PaymentController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
